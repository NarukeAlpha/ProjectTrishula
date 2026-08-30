import { httpRouter } from "convex/server";
import { z } from "zod";
import { internal } from "./_generated/api.js";
import { httpAction } from "./_generated/server.js";
import { canonicalJson, sha256Hex } from "./lib/canonical_json.js";
import type {
  AssistantPart,
  FinalAssistantMessage,
  PiEvent,
  ResultBatch,
  RunMetrics,
} from "./lib/invariants.js";
import {
  CREDENTIAL_VAULT_PROVIDER,
  MAX_CREDENTIAL_VAULT_CIPHERTEXT_LENGTH,
  MAX_CREDENTIAL_VAULT_FIELD_LENGTH,
} from "./lib/credential_vault.js";
import {
  requireRobinhoodOAuthCode,
  requireRobinhoodOAuthState,
  requireWebAppOrigin,
} from "./lib/robinhood_oauth.js";
import { executionRequest } from "./lib/execution.js";
import { authorizedServiceRequest, constantTimeEqual } from "./lib/service_auth.js";
import { discordGateway } from "./discord_http.js";

const jsonHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

const serviceJsonObjectSchema = z.record(z.string(), z.json());
type ServiceJsonObject = z.infer<typeof serviceJsonObjectSchema>;

const rawRunMetricSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  inputTokens: z.number().optional(),
  promptTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
  cachedTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  estimatedCostUsd: z.number().optional(),
  ttftMs: z.number().nullable().optional(),
  timeToFirstOutputMs: z.number().nullable().optional(),
  timeToFirstVisibleTextMs: z.number().optional(),
  runDurationMs: z.number().optional(),
  totalRunDurationMs: z.number().optional(),
  approximateOutputTps: z.number().nullable().optional(),
  outputTokensPerSecond: z.number().optional(),
}).strict();

const runMetricSchema = rawRunMetricSchema.transform((value): RunMetrics => {
  const result: RunMetrics = {};
  if (value.provider !== undefined) result.provider = value.provider;
  if (value.model !== undefined) result.model = value.model;
  if (value.inputTokens !== undefined) result.inputTokens = value.inputTokens;
  if (value.promptTokens !== undefined) result.promptTokens = value.promptTokens;
  if (value.cacheReadTokens !== undefined) result.cacheReadTokens = value.cacheReadTokens;
  if (value.cacheWriteTokens !== undefined) result.cacheWriteTokens = value.cacheWriteTokens;
  if (value.cachedTokens !== undefined) result.cachedTokens = value.cachedTokens;
  if (value.outputTokens !== undefined) result.outputTokens = value.outputTokens;
  if (value.totalTokens !== undefined) result.totalTokens = value.totalTokens;
  if (value.estimatedCostUsd !== undefined) result.estimatedCostUsd = value.estimatedCostUsd;
  if (value.ttftMs !== undefined) result.ttftMs = value.ttftMs;
  if (value.timeToFirstOutputMs !== undefined) result.timeToFirstOutputMs = value.timeToFirstOutputMs;
  if (value.timeToFirstVisibleTextMs !== undefined) result.timeToFirstVisibleTextMs = value.timeToFirstVisibleTextMs;
  if (value.runDurationMs !== undefined) result.runDurationMs = value.runDurationMs;
  if (value.totalRunDurationMs !== undefined) result.totalRunDurationMs = value.totalRunDurationMs;
  if (value.approximateOutputTps !== undefined) result.approximateOutputTps = value.approximateOutputTps;
  if (value.outputTokensPerSecond !== undefined) result.outputTokensPerSecond = value.outputTokensPerSecond;
  return result;
});

const rawAssistantPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }).strict(),
  z.object({
    type: z.literal("tool"),
    toolCallId: z.string(),
    name: z.string(),
    status: z.enum(["completed", "failed", "canceled"]),
    inputSummary: z.string().optional(),
    outputSummary: z.string().optional(),
    durationMs: z.number().optional(),
  }).strict(),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }).strict(),
]);

const assistantPartSchema = rawAssistantPartSchema.transform((value): AssistantPart => {
  if (value.type === "text") return value;
  if (value.type === "error") return value;
  const result: Extract<AssistantPart, { type: "tool" }> = {
    type: "tool",
    toolCallId: value.toolCallId,
    name: value.name,
    status: value.status,
  };
  if (value.inputSummary !== undefined) result.inputSummary = value.inputSummary;
  if (value.outputSummary !== undefined) result.outputSummary = value.outputSummary;
  if (value.durationMs !== undefined) result.durationMs = value.durationMs;
  return result;
});

const finalAssistantMessageSchema = z.object({
  status: z.enum(["completed", "failed", "canceled"]),
  parts: z.array(assistantPartSchema),
  metrics: runMetricSchema.optional(),
}).strict().transform((value): FinalAssistantMessage => {
  const result: FinalAssistantMessage = {
    status: value.status,
    parts: value.parts,
  };
  if (value.metrics !== undefined) result.metrics = value.metrics;
  return result;
});

const rawPiEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text_delta"), text: z.string() }).strict(),
  z.object({
    type: z.literal("tool_start"),
    toolCallId: z.string(),
    name: z.string(),
    inputSummary: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal("tool_end"),
    toolCallId: z.string(),
    name: z.string(),
    ok: z.boolean(),
    outputSummary: z.string().optional(),
    durationMs: z.number(),
  }).strict(),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }).strict(),
  z.object({ type: z.literal("canceled") }).strict(),
  z.object({
    type: z.literal("completed"),
    metrics: runMetricSchema,
  }).strict(),
]);

const piEventSchema = rawPiEventSchema.transform((value): PiEvent => {
  if (value.type === "text_delta" || value.type === "canceled" || value.type === "error") {
    return value;
  }
  if (value.type === "completed") return value;
  if (value.type === "tool_start") {
    const result: Extract<PiEvent, { type: "tool_start" }> = {
      type: "tool_start",
      toolCallId: value.toolCallId,
      name: value.name,
    };
    if (value.inputSummary !== undefined) result.inputSummary = value.inputSummary;
    return result;
  }
  const result: Extract<PiEvent, { type: "tool_end" }> = {
    type: "tool_end",
    toolCallId: value.toolCallId,
    name: value.name,
    ok: value.ok,
    durationMs: value.durationMs,
  };
  if (value.outputSummary !== undefined) result.outputSummary = value.outputSummary;
  return result;
});

const rawServiceResultSchema = z.object({
  commandId: z.string(),
  runId: z.string(),
  assistantMessageId: z.string(),
  sequence: z.number(),
  payloadHash: z.string(),
  events: z.array(piEventSchema),
  finalMessage: finalAssistantMessageSchema.optional(),
}).strict();

const serviceResultSchema = rawServiceResultSchema.transform((value): ResultBatch => {
  const result: ResultBatch = {
    commandId: value.commandId,
    runId: value.runId,
    assistantMessageId: value.assistantMessageId,
    sequence: value.sequence,
    payloadHash: value.payloadHash,
    events: value.events,
  };
  if (value.finalMessage !== undefined) result.finalMessage = value.finalMessage;
  return result;
});
type ServiceResult = z.infer<typeof serviceResultSchema>;

const heartbeatSchema = z.object({
  commandId: z.string(),
  runId: z.string(),
}).strict();

const rawTradeProposalSchema = z.object({
  ownerId: z.string().trim().min(1),
  proposalId: z.string().trim().min(1),
  threadId: z.string().trim().min(1).optional(),
  runId: z.string().trim().min(1).optional(),
  symbol: z.string().trim().min(1).max(16),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().finite().positive().optional(),
  notionalUsd: z.number().finite().positive().optional(),
  orderType: z.enum(["market", "limit", "stop", "stop_limit"]),
  timeInForce: z.enum(["day", "gtc"]),
  limitPrice: z.number().finite().positive().optional(),
  stopPrice: z.number().finite().positive().optional(),
  estimatedPrice: z.number().finite().positive().optional(),
  estimatedTotal: z.number().finite().positive().optional(),
  reviewReference: z.string().trim().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().trim().min(1),
  expiresAt: z.number().int().positive(),
}).strict();

const credentialVaultOwnerId = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9:_-]+$/);
const credentialVaultCiphertext = z
  .string()
  .min(1)
  .max(MAX_CREDENTIAL_VAULT_CIPHERTEXT_LENGTH)
  .refine((value) => value.trim() === value, "Ciphertext must not have surrounding whitespace.");
const credentialVaultRevision = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const credentialVaultEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  actorId: credentialVaultOwnerId,
  provider: z.literal(CREDENTIAL_VAULT_PROVIDER),
  keyVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  algorithm: z.literal("A256GCM"),
  iv: z.string().min(1).max(MAX_CREDENTIAL_VAULT_FIELD_LENGTH).refine(
    (value) => value.trim() === value,
    "IV must not have surrounding whitespace.",
  ),
  ciphertext: credentialVaultCiphertext,
  authTag: z.string().min(1).max(MAX_CREDENTIAL_VAULT_FIELD_LENGTH).refine(
    (value) => value.trim() === value,
    "Authentication tag must not have surrounding whitespace.",
  ),
}).strict();

const credentialVaultGetSchema = z.object({
  schemaVersion: z.literal(1),
  actorId: credentialVaultOwnerId,
  provider: z.literal(CREDENTIAL_VAULT_PROVIDER),
}).strict();

const credentialVaultPutSchema = z.object({
  schemaVersion: z.literal(1),
  actorId: credentialVaultOwnerId,
  provider: z.literal(CREDENTIAL_VAULT_PROVIDER),
  expectedRevision: credentialVaultRevision,
  credential: credentialVaultEnvelopeSchema,
}).strict();

const credentialVaultDeleteSchema = z.object({
  schemaVersion: z.literal(1),
  actorId: credentialVaultOwnerId,
  provider: z.literal(CREDENTIAL_VAULT_PROVIDER),
  expectedRevision: credentialVaultRevision,
}).strict();

const robinhoodConnectedResponseSchema = z.object({
  status: z.literal("connected"),
  label: z.string().trim().min(1).optional(),
  grantedScopes: z.array(z.string()).default([]),
}).strict();

const tradeProposalSchema = rawTradeProposalSchema.transform((value): TradeProposalArguments => {
  const result: TradeProposalArguments = {
    ownerId: value.ownerId,
    proposalId: value.proposalId,
    symbol: value.symbol,
    side: value.side,
    orderType: value.orderType,
    timeInForce: value.timeInForce,
    reviewReference: value.reviewReference,
    fingerprint: value.fingerprint,
    idempotencyKey: value.idempotencyKey,
    expiresAt: value.expiresAt,
  };
  if (value.threadId !== undefined) result.threadId = value.threadId;
  if (value.runId !== undefined) result.runId = value.runId;
  if (value.quantity !== undefined) result.quantity = value.quantity;
  if (value.notionalUsd !== undefined) result.notionalUsd = value.notionalUsd;
  if (value.limitPrice !== undefined) result.limitPrice = value.limitPrice;
  if (value.stopPrice !== undefined) result.stopPrice = value.stopPrice;
  if (value.estimatedPrice !== undefined) result.estimatedPrice = value.estimatedPrice;
  if (value.estimatedTotal !== undefined) result.estimatedTotal = value.estimatedTotal;
  return result;
});

interface ResultFailureBody {
  error: string;
  nextExpectedSequence?: number;
}

interface ResultSuccessBody {
  runId: string;
  acceptedThrough: number;
  status: "streaming" | "completed" | "failed" | "canceled";
  leaseExpiresAt?: number;
}

interface UnsignedResultPayload {
  commandId: string;
  runId: string;
  assistantMessageId: string;
  sequence: number;
  events: PiEvent[];
  finalMessage?: FinalAssistantMessage;
}

interface TradeProposalArguments {
  ownerId: string;
  proposalId: string;
  threadId?: string;
  runId?: string;
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
}

interface CredentialVaultGetResponse {
  schemaVersion: 1;
  credential: z.infer<typeof credentialVaultEnvelopeSchema> | null;
  revision: number;
}

interface CredentialVaultPutResponse {
  schemaVersion: 1;
  stored: true;
  revision: number;
}

interface CredentialVaultDeleteResponse {
  schemaVersion: 1;
  deleted: boolean;
  revision: number;
}

interface CredentialVaultAuditRequest {
  ownerId: string;
  provider: typeof CREDENTIAL_VAULT_PROVIDER;
  operation: "get";
  revision: number;
  found: boolean;
  keyVersion?: number;
  algorithm?: "A256GCM";
}

interface ConnectedConnectionRequest {
  ownerId: string;
  status: "connected";
  grantedScopes: string[];
  label?: string;
}

function json<TBody>(body: TBody, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function authorized(request: Request): boolean {
  return authorizedServiceRequest(request);
}

async function jsonBody(request: Request): Promise<ServiceJsonObject | null> {
  try {
    const parsed = serviceJsonObjectSchema.safeParse(await request.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function parsedBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T | null> {
  try {
    const parsed = schema.safeParse(await request.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function isCredentialVaultRevisionConflict(error: Error): boolean {
  return error.message === "Credential vault revision conflict.";
}

function brokerCallbackRedirect(status: "connected" | "failed"): Response {
  const location = new URL(
    status === "connected" ? "/broker/connected" : "/broker/failed",
    `${requireWebAppOrigin()}/`,
  );
  return new Response(null, {
    status: 303,
    headers: {
      "cache-control": "no-store",
      location: location.toString(),
      "referrer-policy": "no-referrer",
    },
  });
}

async function validatedResultPayload(
  body: ServiceJsonObject,
): Promise<ServiceResult | null> {
  const parsed = serviceResultSchema.safeParse(body);
  if (!parsed.success) return null;
  const payload = parsed.data;
  const unsignedPayload: UnsignedResultPayload = {
    commandId: payload.commandId,
    runId: payload.runId,
    assistantMessageId: payload.assistantMessageId,
    sequence: payload.sequence,
    events: payload.events,
  };
  if (payload.finalMessage !== undefined) unsignedPayload.finalMessage = payload.finalMessage;
  const calculated = await sha256Hex(canonicalJson(unsignedPayload));
  return constantTimeEqual(payload.payloadHash, calculated) ? payload : null;
}

export const runResults = httpAction(async (ctx, request) => {
  if (!authorized(request)) return json({ error: "Unauthorized." }, 401);
  const body = await jsonBody(request);
  if (!body) return json({ error: "Invalid JSON body." }, 400);
  const payload = await validatedResultPayload(body);
  if (!payload) return json({ error: "Invalid result payload hash." }, 400);
  try {
    const accepted = await ctx.runMutation(internal.results.acceptBatch, payload);
    if (!accepted.accepted) {
      const failure: ResultFailureBody = { error: accepted.reason };
      if (accepted.nextExpectedSequence !== undefined) {
        failure.nextExpectedSequence = accepted.nextExpectedSequence;
      }
      return json(failure, 409);
    }
    const success: ResultSuccessBody = {
      runId: payload.runId,
      acceptedThrough: accepted.acceptedThrough,
      status: accepted.status,
    };
    if (accepted.leaseExpiresAt !== undefined) success.leaseExpiresAt = accepted.leaseExpiresAt;
    return json(success);
  } catch {
    return json({ error: "Invalid result batch." }, 400);
  }
});

export const runHeartbeats = httpAction(async (ctx, request) => {
  if (!authorized(request)) return json({ error: "Unauthorized." }, 401);
  const body = await jsonBody(request);
  if (!body) return json({ error: "Invalid JSON body." }, 400);
  const parsed = heartbeatSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid heartbeat." }, 400);
  try {
    const accepted = await ctx.runMutation(internal.results.renewHeartbeat, parsed.data);
    return json(accepted);
  } catch {
    return json({ error: "Invalid heartbeat." }, 400);
  }
});

export const tradeProposals = httpAction(async (ctx, request) => {
  if (!authorized(request)) return json({ error: "Unauthorized." }, 401);
  try {
    const parsed = tradeProposalSchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: "Invalid trade proposal." }, 400);
    const proposalId = await ctx.runMutation(
      internal.trading.recordProposal,
      parsed.data,
    );
    return json({ accepted: true, proposalId }, 202);
  } catch {
    return json({ error: "Trade proposal could not be recorded." }, 400);
  }
});

export const credentialVaultGet = httpAction(async (ctx, request) => {
  if (!authorized(request)) return json({ error: "Unauthorized." }, 401);
  const body = await parsedBody(request, credentialVaultGetSchema);
  if (!body) return json({ error: "Invalid credential vault request." }, 400);
  const value = await ctx.runQuery(internal.trading.getCredentialVault, {
    ownerId: body.actorId,
    provider: body.provider,
  });
  const auditArgs: CredentialVaultAuditRequest = {
    ownerId: body.actorId,
    provider: body.provider,
    operation: "get",
    revision: value.revision,
    found: value.found,
  };
  if (value.credential !== undefined) {
    auditArgs.keyVersion = value.credential.keyVersion;
    auditArgs.algorithm = value.credential.algorithm;
  }
  await ctx.runMutation(internal.trading.recordCredentialVaultAudit, auditArgs);
  const response: CredentialVaultGetResponse = {
    schemaVersion: 1,
    credential: value.credential ?? null,
    revision: value.revision,
  };
  return json(response);
});

export const credentialVaultPut = httpAction(async (ctx, request) => {
  if (!authorized(request)) return json({ error: "Unauthorized." }, 401);
  const body = await parsedBody(request, credentialVaultPutSchema);
  if (!body) return json({ error: "Invalid credential vault request." }, 400);
  if (body.credential.actorId !== body.actorId) {
    return json({ error: "Credential actor does not match request actor." }, 400);
  }
  try {
    const value = await ctx.runMutation(internal.trading.putCredentialVault, {
      ownerId: body.actorId,
      provider: body.provider,
      credential: body.credential,
      expectedRevision: body.expectedRevision,
    });
    const response: CredentialVaultPutResponse = {
      schemaVersion: 1,
      stored: true,
      revision: value.revision,
    };
    return json(response);
  } catch (error) {
    return error instanceof Error && isCredentialVaultRevisionConflict(error)
      ? json({ error: "credential_vault_revision_conflict" }, 409)
      : json({ error: "Credential vault could not be stored." }, 400);
  }
});

export const credentialVaultDelete = httpAction(async (ctx, request) => {
  if (!authorized(request)) return json({ error: "Unauthorized." }, 401);
  const body = await parsedBody(request, credentialVaultDeleteSchema);
  if (!body) return json({ error: "Invalid credential vault request." }, 400);
  try {
    const value = await ctx.runMutation(internal.trading.deleteCredentialVault, {
      ownerId: body.actorId,
      provider: body.provider,
      expectedRevision: body.expectedRevision,
    });
    const response: CredentialVaultDeleteResponse = {
      schemaVersion: 1,
      deleted: value.deleted,
      revision: value.revision,
    };
    return json(response);
  } catch (error) {
    return error instanceof Error && isCredentialVaultRevisionConflict(error)
      ? json({ error: "credential_vault_revision_conflict" }, 409)
      : json({ error: "Credential vault could not be deleted." }, 400);
  }
});

export const robinhoodCallback = httpAction(async (ctx, request) => {
  let code: string;
  let state: string;
  try {
    const url = new URL(request.url);
    code = requireRobinhoodOAuthCode(url.searchParams.get("code") ?? "");
    state = requireRobinhoodOAuthState(url.searchParams.get("state") ?? "");
  } catch {
    return brokerCallbackRedirect("failed");
  }

  let ownerId: string | undefined;
  try {
    const transaction = await ctx.runMutation(
      internal.trading.consumeBrokerOAuthTransaction,
      { stateHash: await sha256Hex(state) },
    );
    if (!transaction) return brokerCallbackRedirect("failed");
    ownerId = transaction.ownerId;
    const response = await executionRequest(
      ownerId,
      "/connections/robinhood/complete",
      { actorId: ownerId, code, state },
    );
    if (!response.ok) throw new Error("Robinhood authorization could not finish.");
    const parsed = robinhoodConnectedResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Robinhood did not confirm the connection.");
    const connectionArgs: ConnectedConnectionRequest = {
      ownerId,
      status: "connected",
      grantedScopes: parsed.data.grantedScopes,
    };
    if (parsed.data.label !== undefined) connectionArgs.label = parsed.data.label;
    await ctx.runMutation(internal.trading.setConnectionStatus, connectionArgs);
    return brokerCallbackRedirect("connected");
  } catch {
    if (ownerId !== undefined) {
      await ctx.runMutation(internal.trading.setConnectionStatus, {
        ownerId,
        status: "error",
        errorCode: "authorization_callback_failed",
      });
    }
    return brokerCallbackRedirect("failed");
  }
});

const http = httpRouter();

http.route({ path: "/service/run-results", method: "POST", handler: runResults });
http.route({ path: "/service/run-heartbeats", method: "POST", handler: runHeartbeats });
http.route({
  path: "/service/trade-proposals",
  method: "POST",
  handler: tradeProposals,
});
http.route({
  path: "/service/broker-credentials/get",
  method: "POST",
  handler: credentialVaultGet,
});
http.route({
  path: "/service/broker-credentials/put",
  method: "POST",
  handler: credentialVaultPut,
});
http.route({
  path: "/service/broker-credentials/delete",
  method: "POST",
  handler: credentialVaultDelete,
});
http.route({
  path: "/broker/robinhood/callback",
  method: "GET",
  handler: robinhoodCallback,
});
http.route({ path: "/discord", method: "POST", handler: discordGateway });

export default http;
