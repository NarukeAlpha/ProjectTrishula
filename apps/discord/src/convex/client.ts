import { createHash } from "node:crypto";
import { z } from "zod";
import type { DiscordGatewayConfig } from "../config.js";
import {
  agentMessageSchema,
  convexMessageSchema,
  discoveredGuildSchema,
  marketChartSpecSchema,
  snowflakeSchema,
  stableIdSchema,
  storedMessageSchema,
  type AgentMessage,
  type ChannelReference,
  type ClaimedLoop,
  type ClaimLoopResponse,
  type DiscoveredGuild,
  type DurableRunFence,
  type LoopStage,
  type OutboxItem,
  type ReplyKind,
  type RunnableChannel,
  type StoredMessage,
} from "../contracts.js";
import {
  conversationIdentitySchema,
  durableConversationContextSchema,
  durableTurnRecoverySchema,
  frontmanPlanResponseSchema,
  frontmanResearchRequestSchema,
  frontmanResumeResponseSchema,
  portableCheckpointRequestSchema,
  portableCheckpointResponseSchema,
  researchFailureSchema,
  solResearchResponseSchema,
  type DurableTurnRecovery,
  type FrontmanPlanResponse,
  type FrontmanResearchRequest,
  type FrontmanResumeResponse,
  type ResearchFailure,
  type PortableCheckpointRequest,
  type PortableCheckpointResponse,
  type SolResearchResponse,
} from "../personality-contracts.js";
import {
  DISCORD_ACKNOWLEDGEMENT_MAX_CHARACTERS,
  DISCORD_FINAL_REPLY_MAX_CHARACTERS,
  normalizeDiscordContent,
  validDiscordContent,
} from "../content.js";

export const DISCORD_GATEWAY_PROTOCOL_HEADER = "x-trishula-discord-protocol";
export const DISCORD_GATEWAY_DURABLE_PROTOCOL = "durable-v1";
export const DISCORD_GATEWAY_NATIVE_PROTOCOL = "native-v2";

const operationSchema = z.enum([
  "syncGuilds",
  "ingestMessage",
  "claimLoop",
  "newestContext",
  "recordFrontmanPlan",
  "recordResearchStarted",
  "recordResearchResult",
  "recordFrontmanResume",
  "completeLoop",
  "heartbeat",
  "listRunnable",
  "nextPortableCheckpoint",
  "storePortableCheckpoint",
  "invalidateNativeCheckpoint",
  "enqueueReply",
  "beginReplyDelivery",
  "acknowledgeReply",
]);

type DiscordOperation = z.infer<typeof operationSchema>;

const monitoredChannelSchema = z
  .object({
    guildId: snowflakeSchema,
    channelId: snowflakeSchema,
    afterMessageId: snowflakeSchema.nullable(),
  })
  .strict();
const discordNonceSchema = stableIdSchema.refine(
  (value) => value.length <= 25,
  "Discord nonce exceeds 25 characters.",
);
const recoveryStageSchema = z.enum([
  "claimed", "planning", "planned", "ack_pending", "researching",
  "research_complete", "resuming", "drafted", "delivery_pending",
  "completed", "suppressed", "failed", "cancelled",
]);
const acknowledgementDeliverySchema = z.enum([
  "not_required", "pending", "sent", "uncertain",
]);

const syncResponseSchema = z
  .object({
    guildCount: z.number().int().nonnegative(),
    channelCount: z.number().int().nonnegative(),
    syncedAt: z.number().int().nonnegative(),
    monitoredChannels: z.array(monitoredChannelSchema),
  })
  .strict();

const ingestResponseSchema = z
  .object({
    accepted: z.literal(true),
    duplicate: z.boolean(),
    sequence: z.number().int().positive(),
    shouldSchedule: z.boolean(),
  })
  .strict();

const rawTurnRecoverySchema = z.object({
  stage: recoveryStageSchema,
  planPayload: z.string().optional(),
  resumePayload: z.string().optional(),
  resumeRequestId: stableIdSchema.optional(),
  acknowledgementDelivery: acknowledgementDeliverySchema.optional(),
  eligibleThroughSequence: z.number().int().positive().optional(),
  eligibleHumanRevision: z.number().int().nonnegative().optional(),
  eligibleContextHash: z.string().optional(),
  nextExplicitTriggerSequence: z.number().int().positive().optional(),
  research: z.object({
    requestId: stableIdSchema,
    normalizedRequest: z.string(),
    status: z.enum(["pending", "completed", "failed"]),
    packet: z.string().optional(),
    failureCode: z.string().optional(),
    failureDetail: z.string().optional(),
    failureRetryable: z.boolean().optional(),
    freshness: z.string().optional(),
    sourceUrls: z.array(z.string()),
    trustedChartArtifactId: stableIdSchema.optional(),
    trustedChartSpec: z.string().optional(),
    serializedBytes: z.number().int().nonnegative(),
    estimatedTokens: z.number().int().nonnegative(),
    tokenEstimatorVersion: z.literal(
      "js-tiktoken@1.0.21:o200k_base:gpt-5.6-sol-estimate:v1",
    ),
  }).strict().optional(),
}).strict();

const rawClaimResponseSchema = z.discriminatedUnion("claimed", [
  z
    .object({
      claimed: z.literal(false),
      reason: z.string().trim().min(1).max(100),
    })
    .strict(),
  z
    .object({
      claimed: z.literal(true),
      idempotent: z.boolean(),
      runId: stableIdSchema,
      generation: z.number().int().positive(),
      mode: z.enum(["messages", "recheck"]),
      channelName: z.string().trim().min(1).max(100),
      leaseExpiresAt: z.number().int().nonnegative(),
      windowStart: z.number().int().positive(),
      windowEnd: z.number().int().positive(),
      contextHash: z.string().trim().min(1).max(256),
      recheckCount: z.number().int().min(0).max(3),
      triggerKind: z.enum(["ambient", "mention", "recheck"]),
      conversation: conversationIdentitySchema,
      conversationGeneration: z.number().int().positive(),
      conversationLeaseToken: stableIdSchema,
      routingGeneration: z.number().int().positive(),
      durableContext: durableConversationContextSchema,
      recovery: rawTurnRecoverySchema.optional(),
      replyChannelId: snowflakeSchema,
      researchLogChannelId: snowflakeSchema.optional(),
      messages: z.array(convexMessageSchema).min(1).max(10),
    })
    .strict(),
]);

const newestContextResponseSchema = z
  .object({
    guildId: snowflakeSchema,
    channelId: snowflakeSchema,
    throughSequence: z.number().int().nonnegative(),
    triggerThroughSequence: z.number().int().nonnegative(),
    completedThroughSequence: z.number().int().nonnegative(),
    contextHash: z.string().trim().min(1).max(256),
    eligibleThroughSequence: z.number().int().nonnegative(),
    eligibleHumanRevision: z.number().int().nonnegative(),
    eligibleContextHash: z.string().trim().min(1).max(256),
    nextExplicitTriggerSequence: z.number().int().positive().optional(),
    catchUpMessages: z.array(convexMessageSchema).max(50),
    exact: z.boolean(),
    messages: z.array(convexMessageSchema).min(1).max(10),
  })
  .strict();

const heartbeatResponseSchema = z
  .object({
    gatewayAccepted: z.literal(true),
    loopAccepted: z.boolean().optional(),
    leaseExpiresAt: z.number().int().nonnegative().optional(),
    conversationLeaseExpiresAt: z.number().int().nonnegative().optional(),
    reason: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const completeLoopResponseSchema = z
  .object({
    accepted: z.literal(true),
    status: z.enum(["idle", "catching_up", "error"]),
    completedThroughSequence: z.number().int().nonnegative().optional(),
    pendingMessageCount: z.number().int().nonnegative(),
    recheckAccepted: z.boolean(),
    recheckReason: z.string().trim().min(1).max(100).optional(),
    recheckCount: z.number().int().nonnegative().optional(),
    maxRechecks: z.number().int().nonnegative().optional(),
  })
  .strict();

const runnableChannelSchema = z
  .object({
    guildId: snowflakeSchema,
    channelId: snowflakeSchema,
    status: z.string().trim().min(1).max(100),
    pendingMessageCount: z.number().int().nonnegative(),
    leaseExpired: z.boolean(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

const outboxItemSchema = z
  .object({
    outboxId: stableIdSchema,
    sourceGuildId: snowflakeSchema,
    sourceChannelId: snowflakeSchema,
    guildId: snowflakeSchema,
    channelId: snowflakeSchema,
    runId: stableIdSchema,
    generation: z.number().int().positive(),
    conversationId: stableIdSchema.optional(),
    epoch: z.number().int().positive().optional(),
    conversationGeneration: z.number().int().positive().optional(),
    routingGeneration: z.number().int().positive().optional(),
    turnId: stableIdSchema.optional(),
    conversationLeaseToken: stableIdSchema.optional(),
    replyKind: z.enum(["acknowledgement", "research_log", "final"]).optional(),
    status: z.enum(["pending", "sent"]),
    content: z.string()
      .refine((value) => validDiscordContent(value, DISCORD_FINAL_REPLY_MAX_CHARACTERS))
      .transform(normalizeDiscordContent),
    deliveryState: z.enum(["pending", "delivery_uncertain", "sent"]),
    chart: marketChartSpecSchema.optional(),
    replyToMessageId: snowflakeSchema.optional(),
    consumesThroughSequence: z.number().int().nonnegative().optional(),
    recheckRequested: z.boolean(),
    finalizesLoop: z.boolean(),
    discordMessageId: snowflakeSchema.optional(),
    deliveryToken: stableIdSchema.optional(),
    nonce: discordNonceSchema,
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    attempts: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    const replyKind = value.replyKind
      ?? (value.finalizesLoop ? "final" : "research_log");
    if (
      replyKind === "acknowledgement"
      && !validDiscordContent(value.content, DISCORD_ACKNOWLEDGEMENT_MAX_CHARACTERS)
    ) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Discord acknowledgement exceeds 320 Unicode characters.",
      });
    }
    if (value.status === "pending" && value.deliveryToken === undefined) {
      context.addIssue({
        code: "custom",
        message: "Pending replies require a delivery token.",
      });
    }
    if (value.status === "sent" && value.discordMessageId === undefined) {
      context.addIssue({
        code: "custom",
        message: "Sent replies require a Discord message ID.",
      });
    }
    const durableFields = [
      value.conversationId,
      value.epoch,
      value.conversationGeneration,
      value.routingGeneration,
      value.turnId,
      value.conversationLeaseToken,
    ];
    if (
      durableFields.some((field) => field !== undefined)
      && durableFields.some((field) => field === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "A durable outbox item requires a complete conversation fence.",
      });
    }
  });

const runnableResponseSchema = z
  .object({
    channels: z.array(runnableChannelSchema).max(50),
    replies: z.array(outboxItemSchema).max(50),
  })
  .strict();

const enqueueResponseSchema = z
  .object({
    accepted: z.literal(true),
    duplicate: z.boolean(),
    outboxId: stableIdSchema,
    status: z.enum([
      "pending", "sent", "finalized", "failed", "delivery_uncertain",
      "needs_reconciliation", "cancelled",
    ]),
  })
  .strict();

const acknowledgeResponseSchema = z
  .object({
    accepted: z.literal(true),
    duplicate: z.boolean(),
    status: z.enum(["pending", "sent", "failed", "delivery_uncertain"]),
    attempts: z.number().int().nonnegative().optional(),
  })
  .strict();
const durableStageResponseSchema = z.object({
  accepted: z.literal(true),
  duplicate: z.boolean(),
}).passthrough();
const portableCheckpointCandidateResponseSchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(false) }).strict(),
  z.object({
    available: z.literal(true),
    request: portableCheckpointRequestSchema,
  }).strict(),
]);
const portableCheckpointStoreResponseSchema = z.object({
  accepted: z.literal(true),
  duplicate: z.boolean(),
  checkpointId: stableIdSchema,
  status: z.enum(["candidate", "active", "superseded", "invalid", "expired"]),
}).passthrough();
const nativeCheckpointInvalidationResponseSchema = z.object({
  accepted: z.literal(true),
  invalidated: z.boolean(),
}).strict();

export interface MonitoredChannelCursor extends ChannelReference {
  afterMessageId: string | null;
}

export interface SyncGuildsResult {
  guildCount: number;
  channelCount: number;
  syncedAt: number;
  monitoredChannels: MonitoredChannelCursor[];
}

export interface RunIdentity extends ChannelReference {
  runId: string;
  generation: number;
  fence?: DurableRunFence | undefined;
}

type HeartbeatRunIdentity = Pick<
  RunIdentity,
  "channelId" | "runId" | "generation"
> & { stage?: LoopStage };
type DurableHeartbeatRunIdentity = HeartbeatRunIdentity & {
  conversationId?: string | undefined;
  epoch?: number | undefined;
  conversationGeneration?: number | undefined;
  routingGeneration?: number | undefined;
  turnId?: string | undefined;
  conversationLeaseToken?: string | undefined;
};

interface NewestContextRequestPayload {
  actorId: string;
  guildId: string;
  channelId: string;
  run?: {
    runId: string;
    conversationId: string;
    epoch: number;
    conversationGeneration: number;
    routingGeneration: number;
    turnId: string;
    conversationLeaseToken: string;
  } | undefined;
}

interface ResearchResultPayload {
  packet?: string | undefined;
  freshness?: string | undefined;
  sourceUrls: string[];
  trustedChartArtifactId?: string | undefined;
  trustedChartSpec?: string | undefined;
  failureCode?: string | undefined;
  failureDetail?: string | undefined;
  failureRetryable?: boolean | undefined;
  serializedBytes: number;
  estimatedTokens: number;
  tokenEstimatorVersion: string;
}

export interface GatewayHeartbeat {
  status: "online" | "degraded";
  botUserId?: string | undefined;
  botUserName?: string | undefined;
  connectedAt?: number | undefined;
  error?: string | undefined;
}

export interface NewestContext extends ChannelReference {
  throughSequence: number;
  triggerThroughSequence: number;
  completedThroughSequence: number;
  contextHash: string;
  eligibleThroughSequence: number;
  eligibleHumanRevision: number;
  eligibleContextHash: string;
  nextExplicitTriggerSequence?: number | undefined;
  catchUpMessages: AgentMessage[];
  exact: boolean;
  messages: AgentMessage[];
}

export interface CompleteLoopResult {
  status: "idle" | "catching_up" | "error";
  pendingMessageCount: number;
  recheckAccepted: boolean;
}

export interface CompleteLoopOptions {
  recheckRequested?: boolean;
  consumesThroughSequence?: number;
  suppressPendingReplies?: boolean;
  error?: string;
  retryable?: boolean;
}

export interface EnqueueReplyInput extends RunIdentity {
  targetChannelId: string;
  idempotencyKey: string;
  replyKind: ReplyKind;
  content: string;
  chart?: OutboxItem["chart"];
  replyToMessageId?: string | undefined;
  consumesThroughSequence?: number | undefined;
  recheckRequested: boolean;
  finalizesLoop: boolean;
}

export interface EnqueueReplyResult {
  status: "pending" | "sent" | "finalized" | "failed" | "delivery_uncertain" | "needs_reconciliation" | "cancelled";
}

export interface RunnableWork {
  channels: RunnableChannel[];
  replies: OutboxItem[];
}

export interface AcknowledgeResult {
  status: "pending" | "sent" | "failed" | "delivery_uncertain";
}

export interface NativeCheckpointInvalidation {
  guildId: string;
  conversationId: string;
  checkpointId: string;
  epoch: number;
  ownerBindingVersion: number;
  revision: number;
  generation: number;
  routingGeneration: number;
}

function stageFence(identity: RunIdentity) {
  if (identity.fence === undefined) {
    throw new Error("A durable stage write requires a conversation fence.");
  }
  return {
    sourceChannelId: identity.channelId,
    runId: identity.runId,
    channelGeneration: identity.generation,
    conversationId: identity.fence.conversationId,
    epoch: identity.fence.epoch,
    conversationGeneration: identity.fence.generation,
    routingGeneration: identity.fence.routingGeneration,
    turnId: identity.fence.turnId,
    conversationLeaseToken: identity.fence.leaseToken,
  };
}

function heartbeatRunIdentity(
  identity: RunIdentity,
  stage?: LoopStage,
): DurableHeartbeatRunIdentity {
  const run: DurableHeartbeatRunIdentity = {
    channelId: identity.channelId,
    runId: identity.runId,
    generation: identity.generation,
  };
  if (identity.fence !== undefined) {
    run.conversationId = identity.fence.conversationId;
    run.epoch = identity.fence.epoch;
    run.conversationGeneration = identity.fence.generation;
    run.routingGeneration = identity.fence.routingGeneration;
    run.turnId = identity.fence.turnId;
    run.conversationLeaseToken = identity.fence.leaseToken;
  }
  if (stage !== undefined) run.stage = stage;
  return run;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export class ConvexDiscordOperationError extends Error {
  constructor(
    readonly operation: DiscordOperation,
    readonly code: string,
    readonly status: number,
  ) {
    super(`Convex Discord ${operation} failed: ${code}.`);
    this.name = "ConvexDiscordOperationError";
  }
}

function toAgentMessage(
  message: z.infer<typeof convexMessageSchema>,
): AgentMessage {
  const result: z.input<typeof agentMessageSchema> = {
    messageId: message.messageId,
    sequence: message.sequence,
    authorId: message.authorId,
    authorName: message.authorName,
    content: message.content,
    mentionsBot: message.mentionsBot,
    createdAt: new Date(message.createdAt).toISOString(),
    isBot: message.isBot,
  };
  if (message.images !== undefined) result.images = message.images;
  if (message.replyToMessageId !== undefined) {
    result.replyToMessageId = message.replyToMessageId;
  }
  return agentMessageSchema.parse(result);
}

function toOutboxItem(
  reply: z.infer<typeof outboxItemSchema>,
): OutboxItem {
  let fence: DurableRunFence | undefined;
  if (reply.conversationId !== undefined) {
    fence = {
      conversationId: reply.conversationId,
      epoch: z.number().int().positive().parse(reply.epoch),
      generation: z.number().int().positive().parse(reply.conversationGeneration),
      routingGeneration: z.number().int().positive().parse(reply.routingGeneration),
      turnId: stableIdSchema.parse(reply.turnId),
      leaseToken: stableIdSchema.parse(reply.conversationLeaseToken),
    };
  }
  return {
    outboxId: reply.outboxId,
    sourceGuildId: reply.sourceGuildId,
    sourceChannelId: reply.sourceChannelId,
    guildId: reply.guildId,
    channelId: reply.channelId,
    runId: reply.runId,
    generation: reply.generation,
    fence,
    replyKind: reply.replyKind,
    status: reply.status,
    deliveryState: reply.deliveryState,
    content: reply.content,
    chart: reply.chart,
    replyToMessageId: reply.replyToMessageId,
    consumesThroughSequence: reply.consumesThroughSequence,
    recheckRequested: reply.recheckRequested,
    finalizesLoop: reply.finalizesLoop,
    discordMessageId: reply.discordMessageId,
    deliveryToken: reply.deliveryToken,
    nonce: reply.nonce,
    payloadHash: reply.payloadHash,
    attempts: reply.attempts,
    createdAt: reply.createdAt,
  };
}

function parseTurnRecovery(
  raw: z.infer<typeof rawTurnRecoverySchema>,
): DurableTurnRecovery {
  const plan = raw.planPayload === undefined
    ? undefined
    : frontmanPlanResponseSchema.parse(JSON.parse(raw.planPayload));
  const resume = raw.resumePayload === undefined
    ? undefined
    : frontmanResumeResponseSchema.parse(JSON.parse(raw.resumePayload));
  let research: DurableTurnRecovery["research"];
  if (raw.research !== undefined) {
    const normalizedRequest = frontmanResearchRequestSchema.parse(
      JSON.parse(raw.research.normalizedRequest),
    );
    let result: SolResearchResponse | ResearchFailure | undefined;
    if (raw.research.status === "completed") {
      if (raw.research.packet === undefined) {
        throw new Error("A completed research artifact does not contain its packet.");
      }
      const completedResearch: z.input<typeof solResearchResponseSchema> = {
        profile: "research",
        packet: JSON.parse(raw.research.packet),
        estimator: {
          package: "js-tiktoken",
          packageVersion: "1.0.21",
          encoding: "o200k_base",
          modelMapping: "gpt-5.6-sol-estimate",
          exact: false,
          version: raw.research.tokenEstimatorVersion,
          estimatedTokens: raw.research.estimatedTokens,
          serializedBytes: raw.research.serializedBytes,
        },
      };
      if (raw.research.trustedChartSpec !== undefined) {
        completedResearch.chart = marketChartSpecSchema.parse(
          JSON.parse(raw.research.trustedChartSpec),
        );
      }
      result = solResearchResponseSchema.parse(completedResearch);
    } else if (raw.research.status === "failed") {
      result = researchFailureSchema.parse({
        code: raw.research.failureCode,
        detail: raw.research.failureDetail,
        retryable: raw.research.failureRetryable,
      });
    }
    const recoveredResearch: NonNullable<DurableTurnRecovery["research"]> = {
      requestId: raw.research.requestId,
      normalizedRequest,
      status: raw.research.status,
    };
    if (result !== undefined) recoveredResearch.result = result;
    research = recoveredResearch;
  }
  const recoveryInput: z.input<typeof durableTurnRecoverySchema> = {
    stage: raw.stage,
  };
  if (plan !== undefined) recoveryInput.plan = plan;
  if (research !== undefined) recoveryInput.research = research;
  if (resume !== undefined) recoveryInput.resume = resume;
  if (raw.resumeRequestId !== undefined) {
    recoveryInput.resumeRequestId = raw.resumeRequestId;
  }
  if (raw.acknowledgementDelivery !== undefined) {
    recoveryInput.acknowledgementDelivery = raw.acknowledgementDelivery;
  }
  if (raw.eligibleThroughSequence !== undefined) {
    recoveryInput.eligibleThroughSequence = raw.eligibleThroughSequence;
  }
  if (raw.eligibleHumanRevision !== undefined) {
    recoveryInput.eligibleHumanRevision = raw.eligibleHumanRevision;
  }
  if (raw.eligibleContextHash !== undefined) {
    recoveryInput.eligibleContextHash = raw.eligibleContextHash;
  }
  if (raw.nextExplicitTriggerSequence !== undefined) {
    recoveryInput.nextExplicitTriggerSequence = raw.nextExplicitTriggerSequence;
  }
  return durableTurnRecoverySchema.parse(recoveryInput);
}

export class ConvexDiscordClient {
  private readonly endpoint: string;

  constructor(
    private readonly config: DiscordGatewayConfig,
    private readonly instanceId: string,
  ) {
    this.endpoint = `${config.convexSiteUrl}/discord`;
  }

  async syncGuilds(
    guilds: DiscoveredGuild[],
    gateway: GatewayHeartbeat,
    signal?: AbortSignal,
  ): Promise<SyncGuildsResult> {
    return this.request(
      "syncGuilds",
      {
        actorId: this.config.discordOwnerId,
        instanceId: this.instanceId,
        ...gateway,
        guilds: z.array(discoveredGuildSchema).max(100).parse(guilds),
      },
      syncResponseSchema,
      signal,
    );
  }

  async ingestMessage(
    message: StoredMessage,
    signal?: AbortSignal,
  ): Promise<{
    duplicate: boolean;
    sequence: number;
    shouldSchedule: boolean;
  }> {
    const result = await this.request(
      "ingestMessage",
      {
        actorId: this.config.discordOwnerId,
        ...storedMessageSchema.parse(message),
      },
      ingestResponseSchema,
      signal,
    );
    return result;
  }

  async claimLoop(
    channel: ChannelReference,
    workerId: string,
    claimId: string,
    signal?: AbortSignal,
  ): Promise<ClaimLoopResponse> {
    const result = await this.request(
      "claimLoop",
      {
        actorId: this.config.discordOwnerId,
        ...channel,
        workerId,
        claimId,
      },
      rawClaimResponseSchema,
      signal,
    );
    if (!result.claimed) return result;
    const fence: DurableRunFence = {
      conversationId: result.conversation.conversationId,
      epoch: result.conversation.epoch,
      generation: result.conversationGeneration,
      routingGeneration: result.routingGeneration,
      turnId: result.conversation.turnId,
      leaseToken: result.conversationLeaseToken,
    };
    let recovery: DurableTurnRecovery | undefined;
    let recoveryFailure: ClaimedLoop["recoveryFailure"];
    if (result.recovery !== undefined) {
      try {
        recovery = parseTurnRecovery(result.recovery);
      } catch {
        recoveryFailure = "invalid_persisted_recovery";
      }
    }
    const claim: ClaimedLoop = {
      claimed: true,
      guildId: channel.guildId,
      channelId: channel.channelId,
      idempotent: result.idempotent,
      runId: result.runId,
      generation: result.generation,
      mode: result.mode,
      channelName: result.channelName,
      leaseExpiresAt: result.leaseExpiresAt,
      windowStart: result.windowStart,
      windowEnd: result.windowEnd,
      contextHash: result.contextHash,
      recheckCount: result.recheckCount,
      triggerKind: result.triggerKind,
      conversation: result.conversation,
      conversationGeneration: result.conversationGeneration,
      conversationLeaseToken: result.conversationLeaseToken,
      routingGeneration: result.routingGeneration,
      durableContext: result.durableContext,
      fence,
      replyChannelId: result.replyChannelId,
      messages: result.messages.map(toAgentMessage),
    };
    if (recovery !== undefined) claim.recovery = recovery;
    if (recoveryFailure !== undefined) claim.recoveryFailure = recoveryFailure;
    if (result.researchLogChannelId !== undefined) {
      claim.researchLogChannelId = result.researchLogChannelId;
    }
    return claim;
  }

  async heartbeatGateway(
    gateway: GatewayHeartbeat,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.heartbeat(gateway, undefined, signal);
  }

  async heartbeatRun(
    run: RunIdentity,
    stage: LoopStage,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return this.heartbeat(
      { status: "online" },
      heartbeatRunIdentity(run, stage),
      signal,
    );
  }

  async renewRunLease(
    run: RunIdentity,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return this.heartbeat(
      { status: "online" },
      heartbeatRunIdentity(run),
      signal,
    );
  }

  private async heartbeat(
    gateway: GatewayHeartbeat,
    run?: DurableHeartbeatRunIdentity,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const result = await this.request(
      "heartbeat",
      {
        actorId: this.config.discordOwnerId,
        instanceId: this.instanceId,
        ...gateway,
        run,
      },
      heartbeatResponseSchema,
      signal,
    );
    return run === undefined || result.loopAccepted === true;
  }

  async newestContext(
    channel: ChannelReference & { fence?: DurableRunFence | undefined; runId?: string | undefined },
    signal?: AbortSignal,
  ): Promise<NewestContext> {
    const payload: NewestContextRequestPayload = {
      actorId: this.config.discordOwnerId,
      guildId: channel.guildId,
      channelId: channel.channelId,
    };
    if (channel.fence !== undefined) {
      payload.run = {
        runId: channel.runId ?? channel.fence.turnId,
        conversationId: channel.fence.conversationId,
        epoch: channel.fence.epoch,
        conversationGeneration: channel.fence.generation,
        routingGeneration: channel.fence.routingGeneration,
        turnId: channel.fence.turnId,
        conversationLeaseToken: channel.fence.leaseToken,
      };
    }
    const result = await this.request(
      "newestContext",
      payload,
      newestContextResponseSchema,
      signal,
    );
    const newest: NewestContext = {
      guildId: result.guildId,
      channelId: result.channelId,
      throughSequence: result.throughSequence,
      triggerThroughSequence: result.triggerThroughSequence,
      completedThroughSequence: result.completedThroughSequence,
      contextHash: result.contextHash,
      eligibleThroughSequence: result.eligibleThroughSequence,
      eligibleHumanRevision: result.eligibleHumanRevision,
      eligibleContextHash: result.eligibleContextHash,
      catchUpMessages: result.catchUpMessages.map(toAgentMessage),
      exact: result.exact,
      messages: result.messages.map(toAgentMessage),
    };
    if (result.nextExplicitTriggerSequence !== undefined) {
      newest.nextExplicitTriggerSequence = result.nextExplicitTriggerSequence;
    }
    return newest;
  }

  async recordFrontmanPlan(
    identity: RunIdentity,
    requestId: string,
    plan: FrontmanPlanResponse,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request(
      "recordFrontmanPlan",
      {
        actorId: this.config.discordOwnerId,
        guildId: identity.guildId,
        fence: stageFence(identity),
        requestId,
        action: plan.action,
        reasonCode: plan.reasonCode,
        payload: JSON.stringify(plan),
      },
      durableStageResponseSchema,
      signal,
    );
  }

  async recordResearchStarted(
    identity: RunIdentity,
    requestId: string,
    researchRequest: FrontmanResearchRequest,
    inputContextHash: string,
    pass: 1 | 2,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request(
      "recordResearchStarted",
      {
        actorId: this.config.discordOwnerId,
        guildId: identity.guildId,
        fence: stageFence(identity),
        requestId,
        normalizedRequest: JSON.stringify(researchRequest),
        inputContextHash,
        pass,
      },
      durableStageResponseSchema,
      signal,
    );
  }

  async recordResearchResult(
    identity: RunIdentity,
    requestId: string,
    research: SolResearchResponse | ResearchFailure,
    signal?: AbortSignal,
  ): Promise<void> {
    let result: ResearchResultPayload;
    if ("profile" in research) {
      result = {
        packet: JSON.stringify(research.packet),
        freshness: research.packet.freshness.status,
        sourceUrls: research.packet.sources.map((source) => source.url),
        trustedChartArtifactId: research.packet.trustedChart?.artifactId,
        trustedChartSpec: research.chart === undefined
          ? undefined
          : JSON.stringify(research.chart),
        serializedBytes: research.estimator.serializedBytes,
        estimatedTokens: research.estimator.estimatedTokens,
        tokenEstimatorVersion: research.estimator.version,
      };
    } else {
      result = {
        failureCode: research.code,
        failureDetail: research.detail,
        failureRetryable: research.retryable,
        sourceUrls: [],
        serializedBytes: 0,
        estimatedTokens: 0,
        tokenEstimatorVersion:
          "js-tiktoken@1.0.21:o200k_base:gpt-5.6-sol-estimate:v1",
      };
    }
    await this.request(
      "recordResearchResult",
      {
        actorId: this.config.discordOwnerId,
        guildId: identity.guildId,
        fence: stageFence(identity),
        requestId,
        ...result,
      },
      durableStageResponseSchema,
      signal,
    );
  }

  async recordFrontmanResume(
    identity: RunIdentity,
    requestId: string,
    resume: FrontmanResumeResponse,
    acknowledgementDelivery: "not_required" | "pending" | "sent" | "uncertain",
    newest: Pick<
      NewestContext,
      | "eligibleThroughSequence"
      | "eligibleHumanRevision"
      | "eligibleContextHash"
      | "nextExplicitTriggerSequence"
    >,
    signal?: AbortSignal,
  ): Promise<void> {
    const replyHash = resume.reply === undefined
      ? undefined
      : sha256(resume.reply);
    await this.request(
      "recordFrontmanResume",
      {
        actorId: this.config.discordOwnerId,
        guildId: identity.guildId,
        fence: stageFence(identity),
        requestId,
        action: resume.action,
        payload: JSON.stringify(resume),
        acknowledgementDelivery,
        replyHash,
        eligibleThroughSequence: newest.eligibleThroughSequence,
        eligibleHumanRevision: newest.eligibleHumanRevision,
        eligibleContextHash: newest.eligibleContextHash,
        nextExplicitTriggerSequence: newest.nextExplicitTriggerSequence,
      },
      durableStageResponseSchema,
      signal,
    );
  }

  async completeLoop(
    identity: RunIdentity,
    outcome: "completed" | "error",
    options: CompleteLoopOptions = {},
    signal?: AbortSignal,
  ): Promise<CompleteLoopResult> {
    const conversation = identity.fence === undefined
      ? undefined
      : {
          conversationId: identity.fence.conversationId,
          epoch: identity.fence.epoch,
          generation: identity.fence.generation,
          routingGeneration: identity.fence.routingGeneration,
          turnId: identity.fence.turnId,
          leaseToken: identity.fence.leaseToken,
          eligibleHumanRevision: identity.fence.eligibleHumanRevision,
        };
    const result = await this.request(
      "completeLoop",
      {
        actorId: this.config.discordOwnerId,
        channelId: identity.channelId,
        runId: identity.runId,
        generation: identity.generation,
        conversation,
        outcome,
        ...options,
      },
      completeLoopResponseSchema,
      signal,
    );
    return {
      status: result.status,
      pendingMessageCount: result.pendingMessageCount,
      recheckAccepted: result.recheckAccepted,
    };
  }

  async enqueueReply(
    input: EnqueueReplyInput,
    signal?: AbortSignal,
  ): Promise<EnqueueReplyResult> {
    const conversation = input.fence === undefined
      ? undefined
      : {
          conversationId: input.fence.conversationId,
          epoch: input.fence.epoch,
          generation: input.fence.generation,
          routingGeneration: input.fence.routingGeneration,
          turnId: input.fence.turnId,
          leaseToken: input.fence.leaseToken,
          eligibleHumanRevision: input.fence.eligibleHumanRevision,
        };
    const result = await this.request(
      "enqueueReply",
      {
        actorId: this.config.discordOwnerId,
        sourceChannelId: input.channelId,
        guildId: input.guildId,
        channelId: input.targetChannelId,
        runId: input.runId,
        generation: input.generation,
        conversation,
        idempotencyKey: input.idempotencyKey,
        replyKind: input.replyKind,
        content: input.content,
        chart: input.chart,
        replyToMessageId: input.replyToMessageId,
        consumesThroughSequence: input.consumesThroughSequence,
        recheckRequested: input.recheckRequested,
        finalizesLoop: input.finalizesLoop,
      },
      enqueueResponseSchema,
      signal,
    );
    return { status: result.status };
  }

  async listRunnable(
    workerId: string,
    signal?: AbortSignal,
  ): Promise<RunnableWork> {
    const result = await this.request(
      "listRunnable",
      {
        actorId: this.config.discordOwnerId,
        workerId,
        limit: 50,
      },
      runnableResponseSchema,
      signal,
    );
    return {
      channels: result.channels,
      replies: result.replies.map(toOutboxItem),
    };
  }

  async nextPortableCheckpoint(
    signal?: AbortSignal,
  ): Promise<PortableCheckpointRequest | null> {
    const result = await this.request(
      "nextPortableCheckpoint",
      { actorId: this.config.discordOwnerId },
      portableCheckpointCandidateResponseSchema,
      signal,
    );
    return result.available ? result.request : null;
  }

  async storePortableCheckpoint(
    request: PortableCheckpointRequest,
    response: PortableCheckpointResponse,
    signal?: AbortSignal,
  ): Promise<void> {
    const validatedRequest = portableCheckpointRequestSchema.parse(request);
    const validatedResponse = portableCheckpointResponseSchema.parse(response);
    if (
      validatedResponse.checkpointId !== validatedRequest.requestId
      || validatedResponse.estimator.inputEstimatedTokens
        !== validatedRequest.inputEstimatedTokens
    ) {
      throw new Error("Portable checkpoint response identity does not match its candidate.");
    }
    await this.request(
      "storePortableCheckpoint",
      {
        actorId: this.config.discordOwnerId,
        guildId: validatedRequest.conversation.guildId,
        conversationId: validatedRequest.conversation.conversationId,
        epoch: validatedRequest.conversation.epoch,
        expectedRevision: validatedRequest.conversation.revision,
        expectedGeneration: validatedRequest.conversation.generation,
        expectedRoutingGeneration: validatedRequest.conversation.routingGeneration,
        checkpointId: validatedResponse.checkpointId,
        sourceContextHash: validatedRequest.sourceContextHash,
        toolPolicyHash: validatedRequest.conversation.capabilityProfileHash,
        compactedThroughOrdinal: validatedRequest.compactedThroughOrdinal,
        portableSummary: JSON.stringify(validatedResponse.portableSummary),
        retainedRecentEventIds: validatedRequest.retainedRecentEventIds,
        inputTokens: validatedResponse.estimator.inputEstimatedTokens,
        outputTokens: validatedResponse.estimator.outputEstimatedTokens,
        estimatedSavedTokens: validatedResponse.estimator.estimatedSavedTokens,
        nativeCompaction: validatedResponse.nativeCompaction,
      },
      portableCheckpointStoreResponseSchema,
      signal,
    );
  }

  async invalidateNativeCheckpoint(
    invalidation: NativeCheckpointInvalidation,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request(
      "invalidateNativeCheckpoint",
      {
        actorId: this.config.discordOwnerId,
        guildId: invalidation.guildId,
        conversationId: invalidation.conversationId,
        checkpointId: invalidation.checkpointId,
        epoch: invalidation.epoch,
        expectedOwnerBindingVersion: invalidation.ownerBindingVersion,
        expectedRevision: invalidation.revision,
        expectedGeneration: invalidation.generation,
        expectedRoutingGeneration: invalidation.routingGeneration,
      },
      nativeCheckpointInvalidationResponseSchema,
      signal,
    );
  }

  async acknowledgeReply(
    item: Pick<OutboxItem, "outboxId" | "deliveryToken">,
    result: {
      status: "sent" | "failed" | "uncertain";
      discordMessageId?: string | undefined;
      images?: StoredMessage["images"];
      error?: string | undefined;
      retryable?: boolean | undefined;
    },
    signal?: AbortSignal,
  ): Promise<AcknowledgeResult> {
    if (item.deliveryToken === undefined) {
      throw new Error("A pending outbox reply does not have a delivery token.");
    }
    const response = await this.request(
      "acknowledgeReply",
      {
        actorId: this.config.discordOwnerId,
        outboxId: item.outboxId,
        deliveryToken: item.deliveryToken,
        ...result,
      },
      acknowledgeResponseSchema,
      signal,
    );
    return { status: response.status };
  }

  async beginReplyDelivery(
    item: Pick<OutboxItem, "outboxId" | "deliveryToken">,
    signal?: AbortSignal,
  ): Promise<void> {
    if (item.deliveryToken === undefined) {
      throw new Error("A pending outbox reply does not have a delivery token.");
    }
    await this.request(
      "beginReplyDelivery",
      {
        actorId: this.config.discordOwnerId,
        outboxId: item.outboxId,
        deliveryToken: item.deliveryToken,
      },
      z.object({
        accepted: z.literal(true),
        duplicate: z.boolean(),
        status: z.literal("delivery_uncertain"),
        attempts: z.number().int().positive(),
      }).strict(),
      signal,
    );
  }

  private async request<Output, Payload>(
    operation: DiscordOperation,
    payload: Payload,
    resultSchema: z.ZodType<Output>,
    signal?: AbortSignal,
  ): Promise<Output> {
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.convexSharedSecret}`,
        "content-type": "application/json",
        [DISCORD_GATEWAY_PROTOCOL_HEADER]: DISCORD_GATEWAY_NATIVE_PROTOCOL,
      },
      body: JSON.stringify({ operation, ...payload }),
      signal: combined,
    });
    const body: unknown = await response.json().catch(() => null);
    const errorEnvelope = z
      .object({
        ok: z.literal(false),
        operation: operationSchema.optional(),
        error: z.string().trim().min(1).max(1_000),
      })
      .strict()
      .safeParse(body);
    if (!response.ok || errorEnvelope.success) {
      const code = errorEnvelope.success
        ? errorEnvelope.data.error
        : `http_${response.status}`;
      throw new ConvexDiscordOperationError(operation, code, response.status);
    }
    const successEnvelope = z
      .object({
        ok: z.literal(true),
        operation: z.literal(operation),
        result: z.unknown(),
      })
      .strict()
      .parse(body);
    return resultSchema.parse(successEnvelope.result);
  }
}
