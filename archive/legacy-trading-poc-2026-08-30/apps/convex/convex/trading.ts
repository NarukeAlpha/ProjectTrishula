import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api.js";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server.js";
import { actorFromIdentity } from "./lib/auth.js";
import { sha256Hex } from "./lib/canonical_json.js";
import {
  CREDENTIAL_VAULT_PROVIDER,
  credentialVaultAuditDetails,
  requireCredentialVaultOwnerId,
  requireOpaqueCredentialEnvelope,
  requireCredentialVaultRevision,
  type OpaqueCredentialEnvelope,
} from "./lib/credential_vault.js";
import { executionRequest } from "./lib/execution.js";
import {
  ROBINHOOD_OAUTH_TRANSACTION_TTL_MS,
  requireRobinhoodAuthorizationUrl,
  requireRobinhoodOAuthState,
} from "./lib/robinhood_oauth.js";
import { assertProposalApprovable } from "./lib/trade_approval.js";

type BrokerConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
type TradeProposalStatus =
  | "awaiting_confirmation"
  | "approved"
  | "rejected"
  | "expired"
  | "submitting"
  | "submitted"
  | "failed";

interface ConnectionStatusArguments {
  ownerId: string;
  status: BrokerConnectionStatus;
  label?: string;
  grantedScopes?: string[];
  errorCode?: string;
}

interface BrokerConnectionPatch {
  status: BrokerConnectionStatus;
  label?: string | undefined;
  grantedScopes: string[];
  errorCode?: string | undefined;
  lastVerifiedAt?: number;
  updatedAt: number;
}

interface BrokerConnectionInsert extends ConnectionStatusArguments {
  provider: "robinhood";
  grantedScopes: string[];
  createdAt: number;
  updatedAt: number;
  lastVerifiedAt?: number;
}

interface PortfolioPosition {
  symbol: string;
  quantity: number;
  price: number;
  marketValue: number;
  averageCost?: number;
  dayChange?: number;
  dayChangePercent?: number;
}

interface TradeProposalInsert {
  ownerId: string;
  stableId: string;
  threadStableId?: string;
  runStableId?: string;
  status: "awaiting_confirmation";
  symbol: string;
  side: "buy" | "sell";
  quantity?: number;
  notionalUsd?: number;
  orderType: "market" | "limit" | "stop" | "stop_limit";
  timeInForce: "day" | "gtc";
  limitPrice?: number;
  stopPrice?: number;
  estimatedPrice?: number;
  estimatedTotal?: number;
  reviewReference: string;
  fingerprint: string;
  idempotencyKey: string;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
}

interface TradeProposalPatch {
  status: "submitted" | "failed";
  brokerOrderId?: string | undefined;
  failureCode?: string | undefined;
  submittedAt?: number;
  updatedAt: number;
}

interface FinishProposalArguments {
  ownerId: string;
  proposalId: string;
  status: "submitted" | "failed";
  brokerOrderId?: string;
  errorCode?: string;
}

interface CredentialVaultRead {
  found: boolean;
  provider: "robinhood";
  revision: number;
  credential?: OpaqueCredentialEnvelope;
  updatedAt?: number;
}

interface CredentialVaultWriteResult {
  revision: number;
  updatedAt: number;
}

interface CredentialVaultDeleteResult {
  deleted: boolean;
  revision: number;
  updatedAt?: number;
}

interface CredentialVaultAuditInput {
  operation: "get" | "put" | "delete";
  revision: number;
  found: boolean;
  keyVersion?: number;
  algorithm?: "A256GCM";
}

interface BrokerOAuthTransaction {
  ownerId: string;
  expiresAt: number;
}

const provider = "robinhood" as const;
const pendingStatuses: ReadonlySet<TradeProposalStatus> = new Set([
  "awaiting_confirmation",
  "approved",
  "submitting",
]);

const connectionResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("authorization_required"),
    authorizationUrl: z.string().url().refine((value) => {
      try {
        requireRobinhoodAuthorizationUrl(value);
        return true;
      } catch {
        return false;
      }
    }, "Robinhood authorization URL is not trusted."),
  }),
  z.object({
    status: z.literal("connected"),
    label: z.string().trim().min(1).optional(),
    grantedScopes: z.array(z.string()).default([]),
  }),
  z.object({ status: z.literal("disconnected") }),
]);

const positionSchema = z.object({
  symbol: z.string().trim().min(1).max(16),
  quantity: z.number().finite(),
  price: z.number().finite(),
  marketValue: z.number().finite(),
  averageCost: z.number().finite().optional(),
  dayChange: z.number().finite().optional(),
  dayChangePercent: z.number().finite().optional(),
});

const portfolioResponseSchema = z.object({
  capturedAt: z.number().int().positive(),
  totalEquity: z.number().finite(),
  buyingPower: z.number().finite(),
  cash: z.number().finite(),
  dayChange: z.number().finite(),
  dayChangePercent: z.number().finite(),
  positions: z.array(positionSchema).max(1_000),
});

const executionResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("submitted"),
    brokerOrderId: z.string().trim().min(1),
  }),
  z.object({
    status: z.literal("failed"),
    errorCode: z.string().trim().min(1),
  }),
]);

function portfolioPosition(value: z.infer<typeof positionSchema>): PortfolioPosition {
  const result: PortfolioPosition = {
    symbol: value.symbol,
    quantity: value.quantity,
    price: value.price,
    marketValue: value.marketValue,
  };
  if (value.averageCost !== undefined) result.averageCost = value.averageCost;
  if (value.dayChange !== undefined) result.dayChange = value.dayChange;
  if (value.dayChangePercent !== undefined) result.dayChangePercent = value.dayChangePercent;
  return result;
}

async function parsedResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
  failureMessage: string,
): Promise<T> {
  if (!response.ok) throw new Error(failureMessage);
  const payload = await response.json();
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new Error(failureMessage);
  return parsed.data;
}

function authorizationState(authorizationUrl: string): string {
  const url = new URL(requireRobinhoodAuthorizationUrl(authorizationUrl));
  return requireRobinhoodOAuthState(url.searchParams.get("state") ?? "");
}

async function writeCredentialVaultAudit(
  ctx: MutationCtx,
  ownerId: string,
  input: {
    operation: "get" | "put" | "delete";
    revision: number;
    found: boolean;
    keyVersion?: number;
    algorithm?: "A256GCM";
  },
): Promise<void> {
  await ctx.db.insert("auditEvents", {
    ownerId,
    eventType: "broker.credential_vault",
    subjectId: CREDENTIAL_VAULT_PROVIDER,
    outcome: "accepted",
    details: credentialVaultAuditDetails(input),
    createdAt: Date.now(),
  });
}

export const getDashboard = query({
  args: {},
  handler: async (ctx) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const [connection, portfolio, proposals] = await Promise.all([
      ctx.db
        .query("brokerConnections")
        .withIndex("by_owner_provider", (index) =>
          index.eq("ownerId", actor.id).eq("provider", provider),
        )
        .unique(),
      ctx.db
        .query("portfolioSnapshots")
        .withIndex("by_owner_capturedAt", (index) =>
          index.eq("ownerId", actor.id),
        )
        .order("desc")
        .first(),
      ctx.db
        .query("tradeProposals")
        .withIndex("by_owner_updatedAt", (index) =>
          index.eq("ownerId", actor.id),
        )
        .order("desc")
        .take(20),
    ]);
    return {
      connection: connection
        ? {
            status: connection.status,
            label: connection.label,
            grantedScopes: connection.grantedScopes,
            lastVerifiedAt: connection.lastVerifiedAt,
            errorCode: connection.errorCode,
            updatedAt: connection.updatedAt,
          }
        : null,
      portfolio: portfolio
        ? {
            capturedAt: portfolio.capturedAt,
            totalEquity: portfolio.totalEquity,
            buyingPower: portfolio.buyingPower,
            cash: portfolio.cash,
            dayChange: portfolio.dayChange,
            dayChangePercent: portfolio.dayChangePercent,
            positions: portfolio.positions,
          }
        : null,
      proposals: proposals.filter(
        (proposal) =>
          pendingStatuses.has(proposal.status) && proposal.expiresAt > Date.now(),
      ),
    };
  },
});

function requireBrokerOAuthStateHash(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("Robinhood OAuth state hash is invalid.");
  }
  return value;
}

export const createBrokerOAuthTransaction = internalMutation({
  args: {
    ownerId: v.string(),
    stateHash: v.string(),
  },
  handler: async (ctx, args) => {
    requireCredentialVaultOwnerId(args.ownerId);
    const stateHash = requireBrokerOAuthStateHash(args.stateHash);
    const previous = await ctx.db
      .query("brokerOAuthTransactions")
      .withIndex("by_owner_provider", (index) =>
        index.eq("ownerId", args.ownerId).eq("provider", provider),
      )
      .collect();
    for (const transaction of previous) await ctx.db.delete(transaction._id);
    const now = Date.now();
    return ctx.db.insert("brokerOAuthTransactions", {
      ownerId: args.ownerId,
      provider,
      stateHash,
      expiresAt: now + ROBINHOOD_OAUTH_TRANSACTION_TTL_MS,
      createdAt: now,
    });
  },
});

export const consumeBrokerOAuthTransaction = internalMutation({
  args: {
    stateHash: v.string(),
  },
  handler: async (ctx, args): Promise<BrokerOAuthTransaction | null> => {
    const stateHash = requireBrokerOAuthStateHash(args.stateHash);
    const transaction = await ctx.db
      .query("brokerOAuthTransactions")
      .withIndex("by_stateHash", (index) => index.eq("stateHash", stateHash))
      .unique();
    if (!transaction) return null;
    await ctx.db.delete(transaction._id);
    if (transaction.expiresAt <= Date.now()) return null;
    return {
      ownerId: transaction.ownerId,
      expiresAt: transaction.expiresAt,
    };
  },
});

export const getCredentialVault = internalQuery({
  args: {
    ownerId: v.string(),
    provider: v.literal("robinhood"),
  },
  handler: async (ctx, args): Promise<CredentialVaultRead> => {
    requireCredentialVaultOwnerId(args.ownerId);
    const record = await ctx.db
      .query("credentialVaults")
      .withIndex("by_owner_provider", (index) =>
        index.eq("ownerId", args.ownerId).eq("provider", args.provider),
      )
      .unique();
    const result: CredentialVaultRead = {
      found: record?.credential !== undefined,
      provider: args.provider,
      revision: record?.revision ?? 0,
    };
    if (record?.credential !== undefined) result.credential = record.credential;
    if (record?.updatedAt !== undefined) result.updatedAt = record.updatedAt;
    return result;
  },
});

export const recordCredentialVaultAudit = internalMutation({
  args: {
    ownerId: v.string(),
    provider: v.literal("robinhood"),
    operation: v.union(v.literal("get"), v.literal("put"), v.literal("delete")),
    revision: v.number(),
    found: v.boolean(),
    keyVersion: v.optional(v.number()),
    algorithm: v.optional(v.literal("A256GCM")),
  },
  handler: async (ctx, args) => {
    requireCredentialVaultOwnerId(args.ownerId);
    requireCredentialVaultRevision(args.revision);
    const auditInput: CredentialVaultAuditInput = {
      operation: args.operation,
      revision: args.revision,
      found: args.found,
    };
    if (args.keyVersion !== undefined) auditInput.keyVersion = args.keyVersion;
    if (args.algorithm !== undefined) auditInput.algorithm = args.algorithm;
    await writeCredentialVaultAudit(ctx, args.ownerId, auditInput);
  },
});

export const putCredentialVault = internalMutation({
  args: {
    ownerId: v.string(),
    provider: v.literal("robinhood"),
    credential: v.object({
      schemaVersion: v.literal(1),
      actorId: v.string(),
      provider: v.literal("robinhood"),
      keyVersion: v.number(),
      algorithm: v.literal("A256GCM"),
      iv: v.string(),
      ciphertext: v.string(),
      authTag: v.string(),
    }),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args): Promise<CredentialVaultWriteResult> => {
    requireCredentialVaultOwnerId(args.ownerId);
    const credential = requireOpaqueCredentialEnvelope(args.credential, args.ownerId);
    const expectedRevision = requireCredentialVaultRevision(args.expectedRevision);
    const existing = await ctx.db
      .query("credentialVaults")
      .withIndex("by_owner_provider", (index) =>
        index.eq("ownerId", args.ownerId).eq("provider", args.provider),
      )
      .unique();
    const currentRevision = existing?.revision ?? 0;
    if (currentRevision !== expectedRevision) {
      throw new Error("Credential vault revision conflict.");
    }
    const now = Date.now();
    const revision = requireCredentialVaultRevision(currentRevision + 1);
    if (existing) {
      await ctx.db.patch(existing._id, {
        credential,
        revision,
        updatedAt: now,
        deletedAt: undefined,
      });
    } else {
      await ctx.db.insert("credentialVaults", {
        ownerId: args.ownerId,
        provider: args.provider,
        credential,
        revision,
        createdAt: now,
        updatedAt: now,
      });
    }
    await writeCredentialVaultAudit(ctx, args.ownerId, {
      operation: "put",
      revision,
      found: true,
      keyVersion: credential.keyVersion,
      algorithm: credential.algorithm,
    });
    return { revision, updatedAt: now };
  },
});

export const deleteCredentialVault = internalMutation({
  args: {
    ownerId: v.string(),
    provider: v.literal("robinhood"),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args): Promise<CredentialVaultDeleteResult> => {
    requireCredentialVaultOwnerId(args.ownerId);
    const expectedRevision = requireCredentialVaultRevision(args.expectedRevision);
    const existing = await ctx.db
      .query("credentialVaults")
      .withIndex("by_owner_provider", (index) =>
        index.eq("ownerId", args.ownerId).eq("provider", args.provider),
      )
      .unique();
    const currentRevision = existing?.revision ?? 0;
    if (currentRevision !== expectedRevision) {
      throw new Error("Credential vault revision conflict.");
    }
    if (!existing?.credential) {
      const result: CredentialVaultDeleteResult = {
        deleted: false,
        revision: currentRevision,
      };
      if (existing?.updatedAt !== undefined) result.updatedAt = existing.updatedAt;
      return result;
    }
    const now = Date.now();
    const revision = requireCredentialVaultRevision(currentRevision + 1);
    const deletedCredential = existing.credential;
    await ctx.db.patch(existing._id, {
      credential: undefined,
      revision,
      updatedAt: now,
      deletedAt: now,
    });
    await writeCredentialVaultAudit(ctx, args.ownerId, {
      operation: "delete",
      revision,
      found: true,
      keyVersion: deletedCredential?.keyVersion,
      algorithm: deletedCredential?.algorithm,
    });
    return { deleted: true, revision, updatedAt: now };
  },
});

export const setConnectionStatus = internalMutation({
  args: {
    ownerId: v.string(),
    status: v.union(
      v.literal("disconnected"),
      v.literal("connecting"),
      v.literal("connected"),
      v.literal("error"),
    ),
    label: v.optional(v.string()),
    grantedScopes: v.optional(v.array(v.string())),
    errorCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("brokerConnections")
      .withIndex("by_owner_provider", (index) =>
        index.eq("ownerId", args.ownerId).eq("provider", provider),
      )
      .unique();
    const now = Date.now();
    const patch: BrokerConnectionPatch = {
      status: args.status,
      label: args.label,
      grantedScopes: args.grantedScopes ?? existing?.grantedScopes ?? [],
      errorCode: args.errorCode,
      updatedAt: now,
    };
    if (args.status === "connected") patch.lastVerifiedAt = now;
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    const insert: BrokerConnectionInsert = {
      ownerId: args.ownerId,
      provider,
      status: args.status,
      grantedScopes: args.grantedScopes ?? [],
      createdAt: now,
      updatedAt: now,
    };
    if (args.label !== undefined) insert.label = args.label;
    if (args.errorCode !== undefined) insert.errorCode = args.errorCode;
    if (args.status === "connected") insert.lastVerifiedAt = now;
    return ctx.db.insert("brokerConnections", insert);
  },
});

export const startRobinhoodConnection = action({
  args: {},
  handler: async (ctx) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    await ctx.runMutation(internal.trading.setConnectionStatus, {
      ownerId: actor.id,
      status: "connecting",
    });
    try {
      const response = await executionRequest(actor.id, "/connections/robinhood/start", {
        actorId: actor.id,
      });
      const result = await parsedResponse(
        response,
        connectionResponseSchema,
        "Robinhood authorization could not start.",
      );
      if (result.status === "authorization_required") {
        const authorizationUrl = requireRobinhoodAuthorizationUrl(result.authorizationUrl);
        const state = authorizationState(authorizationUrl);
        await ctx.runMutation(internal.trading.createBrokerOAuthTransaction, {
          ownerId: actor.id,
          stateHash: await sha256Hex(state),
        });
        return { status: result.status, authorizationUrl };
      }
      if (result.status === "connected") {
        const connectionArgs: ConnectionStatusArguments = {
          ownerId: actor.id,
          status: "connected",
          grantedScopes: result.grantedScopes,
        };
        if (result.label !== undefined) connectionArgs.label = result.label;
        await ctx.runMutation(internal.trading.setConnectionStatus, connectionArgs);
      }
      return result;
    } catch (error) {
      await ctx.runMutation(internal.trading.setConnectionStatus, {
        ownerId: actor.id,
        status: "error",
        errorCode: "authorization_start_failed",
      });
      throw error;
    }
  },
});

export const disconnectRobinhood = action({
  args: {},
  handler: async (ctx) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const response = await executionRequest(actor.id, "/connections/robinhood/disconnect", {
      actorId: actor.id,
    });
    await parsedResponse(
      response,
      connectionResponseSchema,
      "Robinhood could not be disconnected.",
    );
    await ctx.runMutation(internal.trading.setConnectionStatus, {
      ownerId: actor.id,
      status: "disconnected",
      grantedScopes: [],
    });
    await ctx.runMutation(internal.trading.invalidatePendingProposals, {
      ownerId: actor.id,
    });
    return { status: "disconnected" as const };
  },
});

export const invalidatePendingProposals = internalMutation({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const proposals = await ctx.db
      .query("tradeProposals")
      .withIndex("by_owner_updatedAt", (index) => index.eq("ownerId", args.ownerId))
      .collect();
    const pending = proposals.filter((proposal) => pendingStatuses.has(proposal.status));
    const now = Date.now();
    for (const proposal of pending) {
      await ctx.db.patch(proposal._id, {
        status: "expired",
        failureCode: "broker_disconnected",
        updatedAt: now,
      });
      await ctx.db.insert("auditEvents", {
        ownerId: args.ownerId,
        eventType: "trade.invalidated",
        subjectId: proposal.stableId,
        outcome: "rejected",
        details: [{ key: "reason", value: "broker_disconnected" }],
        createdAt: now,
      });
    }
    return { invalidated: pending.length };
  },
});

const proposalExpiryBatchSize = 256;

export const expireStaleProposals = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const proposals = await ctx.db
      .query("tradeProposals")
      .withIndex("by_status_expiresAt", (index) =>
        index.eq("status", "awaiting_confirmation").lte("expiresAt", now),
      )
      .take(proposalExpiryBatchSize);
    for (const proposal of proposals) {
      await ctx.db.patch(proposal._id, {
        status: "expired",
        failureCode: "proposal_expired",
        updatedAt: now,
      });
      await ctx.db.insert("auditEvents", {
        ownerId: proposal.ownerId,
        eventType: "trade.expired",
        subjectId: proposal.stableId,
        outcome: "rejected",
        details: [{ key: "reason", value: "proposal_expired" }],
        createdAt: now,
      });
    }
    if (proposals.length === proposalExpiryBatchSize) {
      await ctx.scheduler.runAfter(0, internal.trading.expireStaleProposals, {});
    }
    return { expired: proposals.length };
  },
});

export const savePortfolioSnapshot = internalMutation({
  args: {
    ownerId: v.string(),
    capturedAt: v.number(),
    totalEquity: v.number(),
    buyingPower: v.number(),
    cash: v.number(),
    dayChange: v.number(),
    dayChangePercent: v.number(),
    positions: v.array(
      v.object({
        symbol: v.string(),
        quantity: v.number(),
        price: v.number(),
        marketValue: v.number(),
        averageCost: v.optional(v.number()),
        dayChange: v.optional(v.number()),
        dayChangePercent: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) =>
    ctx.db.insert("portfolioSnapshots", {
      ownerId: args.ownerId,
      provider,
      capturedAt: args.capturedAt,
      totalEquity: args.totalEquity,
      buyingPower: args.buyingPower,
      cash: args.cash,
      dayChange: args.dayChange,
      dayChangePercent: args.dayChangePercent,
      positions: args.positions,
    }),
});

export const refreshPortfolio = action({
  args: {},
  handler: async (ctx) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const response = await executionRequest(actor.id, "/portfolio/refresh", {
      actorId: actor.id,
    });
    const portfolio = await parsedResponse(
      response,
      portfolioResponseSchema,
      "The Robinhood portfolio could not be refreshed.",
    );
    await ctx.runMutation(internal.trading.savePortfolioSnapshot, {
      ownerId: actor.id,
      capturedAt: portfolio.capturedAt,
      totalEquity: portfolio.totalEquity,
      buyingPower: portfolio.buyingPower,
      cash: portfolio.cash,
      dayChange: portfolio.dayChange,
      dayChangePercent: portfolio.dayChangePercent,
      positions: portfolio.positions.map(portfolioPosition),
    });
    await ctx.runMutation(internal.trading.setConnectionStatus, {
      ownerId: actor.id,
      status: "connected",
    });
    return portfolio;
  },
});

export const recordProposal = internalMutation({
  args: {
    ownerId: v.string(),
    proposalId: v.string(),
    threadId: v.optional(v.string()),
    runId: v.optional(v.string()),
    symbol: v.string(),
    side: v.union(v.literal("buy"), v.literal("sell")),
    quantity: v.optional(v.number()),
    notionalUsd: v.optional(v.number()),
    orderType: v.union(
      v.literal("market"),
      v.literal("limit"),
      v.literal("stop"),
      v.literal("stop_limit"),
    ),
    timeInForce: v.union(v.literal("day"), v.literal("gtc")),
    limitPrice: v.optional(v.number()),
    stopPrice: v.optional(v.number()),
    estimatedPrice: v.optional(v.number()),
    estimatedTotal: v.optional(v.number()),
    reviewReference: v.string(),
    fingerprint: v.string(),
    idempotencyKey: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("tradeProposals")
      .withIndex("by_owner_stableId", (index) =>
        index.eq("ownerId", args.ownerId).eq("stableId", args.proposalId),
      )
      .unique();
    if (existing) {
      if (existing.fingerprint !== args.fingerprint) {
        throw new Error("Proposal ID is already bound to different order details.");
      }
      return existing._id;
    }
    const now = Date.now();
    const insert: TradeProposalInsert = {
      ownerId: args.ownerId,
      stableId: args.proposalId,
      status: "awaiting_confirmation",
      symbol: args.symbol,
      side: args.side,
      orderType: args.orderType,
      timeInForce: args.timeInForce,
      reviewReference: args.reviewReference,
      fingerprint: args.fingerprint,
      idempotencyKey: args.idempotencyKey,
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    if (args.threadId !== undefined) insert.threadStableId = args.threadId;
    if (args.runId !== undefined) insert.runStableId = args.runId;
    if (args.quantity !== undefined) insert.quantity = args.quantity;
    if (args.notionalUsd !== undefined) insert.notionalUsd = args.notionalUsd;
    if (args.limitPrice !== undefined) insert.limitPrice = args.limitPrice;
    if (args.stopPrice !== undefined) insert.stopPrice = args.stopPrice;
    if (args.estimatedPrice !== undefined) insert.estimatedPrice = args.estimatedPrice;
    if (args.estimatedTotal !== undefined) insert.estimatedTotal = args.estimatedTotal;
    const proposalId = await ctx.db.insert("tradeProposals", insert);
    await ctx.db.insert("auditEvents", {
      ownerId: args.ownerId,
      eventType: "trade.proposed",
      subjectId: args.proposalId,
      outcome: "accepted",
      details: [
        { key: "symbol", value: args.symbol },
        { key: "side", value: args.side },
      ],
      createdAt: now,
    });
    return proposalId;
  },
});

export const markProposalApproved = internalMutation({
  args: {
    ownerId: v.string(),
    proposalId: v.string(),
    fingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const proposal = await ctx.db
      .query("tradeProposals")
      .withIndex("by_owner_stableId", (index) =>
        index.eq("ownerId", args.ownerId).eq("stableId", args.proposalId),
      )
      .unique();
    if (!proposal) throw new Error("Trade proposal not found.");
    const now = Date.now();
    try {
      assertProposalApprovable(proposal, args.fingerprint, now);
    } catch (error) {
      if (proposal.expiresAt <= now) {
        await ctx.db.patch(proposal._id, {
          status: "expired",
          updatedAt: now,
        });
      }
      throw error;
    }
    await ctx.db.patch(proposal._id, {
      status: "submitting",
      approvedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      ownerId: args.ownerId,
      eventType: "trade.approved",
      subjectId: args.proposalId,
      outcome: "accepted",
      details: [{ key: "fingerprint", value: args.fingerprint }],
      createdAt: now,
    });
    return {
      proposalId: proposal.stableId,
      fingerprint: proposal.fingerprint,
    };
  },
});

export const finishProposalSubmission = internalMutation({
  args: {
    ownerId: v.string(),
    proposalId: v.string(),
    status: v.union(v.literal("submitted"), v.literal("failed")),
    brokerOrderId: v.optional(v.string()),
    errorCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const proposal = await ctx.db
      .query("tradeProposals")
      .withIndex("by_owner_stableId", (index) =>
        index.eq("ownerId", args.ownerId).eq("stableId", args.proposalId),
      )
      .unique();
    if (!proposal) throw new Error("Trade proposal not found.");
    const now = Date.now();
    const patch: TradeProposalPatch = {
      status: args.status,
      brokerOrderId: args.brokerOrderId,
      failureCode: args.errorCode,
      updatedAt: now,
    };
    if (args.status === "submitted") patch.submittedAt = now;
    await ctx.db.patch(proposal._id, patch);
    await ctx.db.insert("auditEvents", {
      ownerId: args.ownerId,
      eventType: "trade.submission",
      subjectId: args.proposalId,
      outcome: args.status === "submitted" ? "accepted" : "failed",
      details: args.brokerOrderId
        ? [{ key: "brokerOrderId", value: args.brokerOrderId }]
        : [{ key: "errorCode", value: args.errorCode ?? "submission_failed" }],
      createdAt: now,
    });
  },
});

type ProposalExecutionResult =
  | { status: "submitted"; brokerOrderId: string }
  | { status: "failed"; errorCode: string };

export const approveProposal = action({
  args: { proposalId: v.string(), fingerprint: v.string() },
  handler: async (ctx, args): Promise<ProposalExecutionResult> => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const approved: { proposalId: string; fingerprint: string } =
      await ctx.runMutation(internal.trading.markProposalApproved, {
      ownerId: actor.id,
      proposalId: args.proposalId,
      fingerprint: args.fingerprint,
    });
    try {
      const response: Response = await executionRequest(actor.id, "/orders/execute", {
        actorId: actor.id,
        proposalId: approved.proposalId,
        fingerprint: approved.fingerprint,
      });
      const result: ProposalExecutionResult = await parsedResponse(
        response,
        executionResponseSchema,
        "The approved order could not be submitted.",
      );
      const finishArgs: FinishProposalArguments = {
        ownerId: actor.id,
        proposalId: args.proposalId,
        status: result.status,
      };
      if (result.status === "submitted") finishArgs.brokerOrderId = result.brokerOrderId;
      else finishArgs.errorCode = result.errorCode;
      await ctx.runMutation(internal.trading.finishProposalSubmission, finishArgs);
      return result;
    } catch (error) {
      await ctx.runMutation(internal.trading.finishProposalSubmission, {
        ownerId: actor.id,
        proposalId: args.proposalId,
        status: "failed",
        errorCode: "submission_failed",
      });
      throw error;
    }
  },
});

export const rejectProposal = mutation({
  args: { proposalId: v.string(), fingerprint: v.string() },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const proposal = await ctx.db
      .query("tradeProposals")
      .withIndex("by_owner_stableId", (index) =>
        index.eq("ownerId", actor.id).eq("stableId", args.proposalId),
      )
      .unique();
    if (!proposal) throw new Error("Trade proposal not found.");
    if (
      proposal.fingerprint !== args.fingerprint ||
      proposal.status !== "awaiting_confirmation"
    ) {
      throw new Error("Trade proposal is no longer available for rejection.");
    }
    const now = Date.now();
    await ctx.db.patch(proposal._id, { status: "rejected", updatedAt: now });
    await ctx.db.insert("auditEvents", {
      ownerId: actor.id,
      eventType: "trade.rejected",
      subjectId: proposal.stableId,
      outcome: "rejected",
      details: [{ key: "fingerprint", value: proposal.fingerprint }],
      createdAt: now,
    });
    return { status: "rejected" as const };
  },
});
