import { z } from "zod";
import {
  DISCORD_CONTEXT_SIZE,
  DISCORD_LOOP_LEASE_MS,
  DISCORD_MAX_AUTONOMOUS_RECHECKS,
  DISCORD_MAX_OUTBOX_ATTEMPTS,
  DISCORD_OUTBOX_DELIVERY_LEASE_MS,
} from "./discord_state.js";

export const DISCORD_SERVICE_CONTRACT = {
  contextSize: DISCORD_CONTEXT_SIZE,
  leaseMs: DISCORD_LOOP_LEASE_MS,
  maxAutonomousRechecks: DISCORD_MAX_AUTONOMOUS_RECHECKS,
  maxOutboxAttempts: DISCORD_MAX_OUTBOX_ATTEMPTS,
  outboxDeliveryLeaseMs: DISCORD_OUTBOX_DELIVERY_LEASE_MS,
} as const;

const id = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9:_-]+$/);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const discordAttachmentUrl = z.url().max(2_000).refine((value) => {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  return url.protocol === "https:"
    && url.username === ""
    && url.password === ""
    && url.port === ""
    && (hostname === "cdn.discordapp.com" || hostname === "media.discordapp.net")
    && url.pathname.startsWith("/attachments/");
}, "Discord attachment URL required.");
const discordImageAttachment = z.object({
  attachmentId: z.string().regex(/^\d{1,32}$/),
  url: discordAttachmentUrl,
  filename: z.string().trim().min(1).max(200),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  sizeBytes: z.number().int().positive().max(8 * 1024 * 1024),
  width: z.number().int().positive().max(8_192).optional(),
  height: z.number().int().positive().max(8_192).optional(),
}).strict().superRefine((image, context) => {
  if (
    image.width !== undefined
    && image.height !== undefined
    && image.width * image.height > 25_000_000
  ) {
    context.addIssue({ code: "custom", message: "Discord image dimensions are too large." });
  }
});
const discordMarketChart = z.object({
  symbol: z.string().trim().min(1).max(20).regex(/^[A-Z0-9.^=-]+$/i),
  title: z.string().trim().min(1).max(64).optional(),
  points: z.array(z.object({
    timestamp,
    close: z.number().finite().nonnegative(),
  }).strict()).min(2).max(240),
  tradingViewSymbol: z.string().trim().min(3).max(64)
    .regex(/^[A-Z0-9._!^-]{1,24}:[A-Z0-9._!^=-]{1,32}$/).optional(),
  interval: z.enum([
    "1m", "3m", "5m", "10m", "15m", "30m", "45m", "1h", "2h", "3h",
    "4h", "6h", "8h", "12h", "1D", "2D", "3D", "1W", "1M", "3M",
    "6M", "1Y",
  ]).optional(),
  range: z.enum([
    "1D", "5D", "1M", "3M", "6M", "1Y", "5Y", "ALL", "DTD", "WTD",
    "MTD", "YTD",
  ]).optional(),
  style: z.enum(["candle", "line", "area"]).optional(),
  includeVolume: z.boolean().optional(),
}).strict().superRefine((chart, context) => {
  for (let index = 1; index < chart.points.length; index += 1) {
    const previous = chart.points[index - 1];
    const current = chart.points[index];
    if (previous !== undefined && current !== undefined && current.timestamp <= previous.timestamp) {
      context.addIssue({
        code: "custom",
        path: ["points", index, "timestamp"],
        message: "Chart timestamps must increase.",
      });
    }
  }
  if (chart.interval !== undefined && chart.range !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["range"],
      message: "Choose a chart interval or range, not both.",
    });
  }
  if (
    chart.tradingViewSymbol === undefined
    && (
      chart.interval !== undefined
      || chart.range !== undefined
      || chart.style !== undefined
      || chart.includeVolume !== undefined
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["tradingViewSymbol"],
      message: "Provider chart options require a TradingView symbol.",
    });
  }
});
const permissions = z.object({
  viewChannels: z.boolean(),
  sendMessages: z.boolean(),
  readMessageHistory: z.boolean(),
  messageContent: z.boolean(),
}).strict();
const channel = z.object({
  channelId: id,
  name: z.string().trim().min(1).max(200),
  type: z.enum(["text", "announcement", "forum", "other"]),
  canView: z.boolean(),
  canSend: z.boolean(),
  canReadHistory: z.boolean(),
}).strict();
const guild = z.object({
  guildId: id,
  name: z.string().trim().min(1).max(200),
  iconUrl: z.string().url().max(2_000).optional(),
  permissions,
  channels: z.array(channel).max(500),
}).strict();

const conversationFence = z.object({
  conversationId: id,
  epoch: z.number().int().positive(),
  generation: z.number().int().positive(),
  routingGeneration: z.number().int().positive(),
  turnId: id,
  leaseToken: id,
  eligibleHumanRevision: z.number().int().nonnegative().optional(),
}).strict();

const durableRunFence = z.object({
  runId: id,
  conversationId: id,
  epoch: z.number().int().positive(),
  conversationGeneration: z.number().int().positive(),
  routingGeneration: z.number().int().positive(),
  turnId: id,
  conversationLeaseToken: id,
}).strict();

const durableStageFence = z.object({
  sourceChannelId: id,
  runId: id,
  channelGeneration: z.number().int().positive(),
  conversationId: id,
  epoch: z.number().int().nonnegative(),
  conversationGeneration: z.number().int().positive(),
  routingGeneration: z.number().int().positive(),
  turnId: id,
  conversationLeaseToken: id,
}).strict();

const discordReplyContent = z.string().trim().min(1).refine(
  (value) => Array.from(value).length <= 2_000,
  "Discord reply content exceeds 2,000 Unicode characters.",
);

export const DISCORD_GATEWAY_PROTOCOL_HEADER = "x-trishula-discord-protocol";
export const DISCORD_GATEWAY_DURABLE_PROTOCOL = "durable-v1";

interface LegacyClaimLoopResult {
  claimed: true;
  idempotent: boolean;
  runId: string;
  generation: number;
  mode: "messages" | "recheck";
  channelName: string;
  leaseExpiresAt: number;
  windowStart: number;
  windowEnd: number;
  contextHash: string;
  recheckCount: number;
  triggerKind: "ambient" | "mention" | "recheck";
  replyChannelId: string;
  researchLogChannelId?: string;
  messages: readonly unknown[];
}

export function projectLegacyClaimLoopResponse<
  T extends LegacyClaimLoopResult | { claimed: false; reason: string },
>(result: T) {
  if (!result.claimed) return { claimed: false as const, reason: result.reason };
  const projected: LegacyClaimLoopResult = {
    claimed: true as const,
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
    replyChannelId: result.replyChannelId,
    messages: result.messages,
  };
  if (result.researchLogChannelId !== undefined) {
    projected.researchLogChannelId = result.researchLogChannelId;
  }
  return projected;
}

interface LegacyNewestContextResult {
  guildId: string;
  channelId: string;
  throughSequence: number;
  triggerThroughSequence: number;
  completedThroughSequence: number;
  contextHash: string;
  messages: readonly unknown[];
}

export function projectLegacyNewestContextResponse<T extends LegacyNewestContextResult>(
  result: T,
) {
  return {
    guildId: result.guildId,
    channelId: result.channelId,
    throughSequence: result.throughSequence,
    triggerThroughSequence: result.triggerThroughSequence,
    completedThroughSequence: result.completedThroughSequence,
    contextHash: result.contextHash,
    messages: result.messages,
  };
}

interface LegacyRunnableChannel {
  guildId: string;
  channelId: string;
  status: string;
  pendingMessageCount: number;
  leaseExpired: boolean;
  updatedAt: number;
}

interface LegacyRunnableReply {
  outboxId: string;
  sourceGuildId: string;
  sourceChannelId: string;
  guildId: string;
  channelId: string;
  runId: string;
  generation: number;
  replyKind?: "acknowledgement" | "research_log" | "final" | undefined;
  status: "pending" | "sent";
  content: string;
  chart?: unknown;
  replyToMessageId?: string | undefined;
  consumesThroughSequence?: number | undefined;
  recheckRequested: boolean;
  finalizesLoop: boolean;
  discordMessageId?: string | undefined;
  deliveryToken?: string | undefined;
  attempts: number;
  createdAt: number;
}

interface LegacyRunnableResult {
  channels: readonly LegacyRunnableChannel[];
  replies: readonly LegacyRunnableReply[];
}

export function projectLegacyRunnableResponse<T extends LegacyRunnableResult>(result: T) {
  return {
    channels: result.channels.map((channel) => ({
      guildId: channel.guildId,
      channelId: channel.channelId,
      status: channel.status,
      pendingMessageCount: channel.pendingMessageCount,
      leaseExpired: channel.leaseExpired,
      updatedAt: channel.updatedAt,
    })),
    replies: result.replies.map((reply) => {
      const projected: LegacyRunnableReply = {
        outboxId: reply.outboxId,
        sourceGuildId: reply.sourceGuildId,
        sourceChannelId: reply.sourceChannelId,
        guildId: reply.guildId,
        channelId: reply.channelId,
        runId: reply.runId,
        generation: reply.generation,
        status: reply.status,
        content: reply.content,
        recheckRequested: reply.recheckRequested,
        finalizesLoop: reply.finalizesLoop,
        attempts: reply.attempts,
        createdAt: reply.createdAt,
      };
      if (reply.replyKind !== undefined) projected.replyKind = reply.replyKind;
      if (reply.chart !== undefined) projected.chart = reply.chart;
      if (reply.replyToMessageId !== undefined) {
        projected.replyToMessageId = reply.replyToMessageId;
      }
      if (reply.consumesThroughSequence !== undefined) {
        projected.consumesThroughSequence = reply.consumesThroughSequence;
      }
      if (reply.discordMessageId !== undefined) {
        projected.discordMessageId = reply.discordMessageId;
      }
      if (reply.deliveryToken !== undefined) {
        projected.deliveryToken = reply.deliveryToken;
      }
      return projected;
    }),
  };
}

export const discordGatewayRequestSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("syncGuilds"),
    actorId: id,
    instanceId: id,
    botUserId: id.optional(),
    botUserName: z.string().trim().min(1).max(200).optional(),
    connectedAt: timestamp.optional(),
    status: z.enum(["online", "degraded"]),
    error: z.string().trim().min(1).max(1_000).optional(),
    guilds: z.array(guild).max(100),
  }).strict(),
  z.object({
    operation: z.literal("ingestMessage"),
    actorId: id,
    guildId: id,
    channelId: id,
    messageId: id,
    authorId: id,
    authorName: z.string().trim().min(1).max(200),
    content: z.string().max(8_000),
    images: z.array(discordImageAttachment).max(4).optional(),
    mentionsBot: z.boolean(),
    isBot: z.boolean(),
    replyToMessageId: id.optional(),
    nonce: id.optional(),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    createdAt: timestamp,
  }).strict().superRefine((message, context) => {
    if (message.content.trim().length === 0 && (message.images?.length ?? 0) === 0) {
      context.addIssue({
        code: "custom",
        message: "A Discord message must include text or an image.",
        path: ["content"],
      });
    }
  }),
  z.object({
    operation: z.literal("claimLoop"),
    actorId: id,
    guildId: id,
    channelId: id,
    workerId: id,
    claimId: id,
  }).strict(),
  z.object({
    operation: z.literal("newestContext"),
    actorId: id,
    guildId: id,
    channelId: id,
    run: durableRunFence.optional(),
  }).strict(),
  z.object({
    operation: z.literal("recordFrontmanPlan"),
    actorId: id,
    guildId: id,
    fence: durableStageFence,
    requestId: id,
    action: z.enum(["silent", "reply", "clarify", "research"]),
    reasonCode: id,
    payload: z.string().trim().min(2).max(32 * 1_024),
  }).strict(),
  z.object({
    operation: z.literal("recordResearchStarted"),
    actorId: id,
    guildId: id,
    fence: durableStageFence,
    requestId: id,
    normalizedRequest: z.string().trim().min(2).max(16 * 1_024),
    inputContextHash: z.string().regex(/^[a-f0-9]{16,64}$/),
    pass: z.number().int().min(1).max(2),
  }).strict(),
  z.object({
    operation: z.literal("recordResearchResult"),
    actorId: id,
    guildId: id,
    fence: durableStageFence,
    requestId: id,
    packet: z.string().trim().min(2).max(16_384).optional(),
    failureCode: id.optional(),
    failureDetail: z.string().trim().min(1).max(500).optional(),
    failureRetryable: z.boolean().optional(),
    freshness: z.enum(["current", "limited", "unknown"]).optional(),
    sourceUrls: z.array(z.url().refine((value) => new URL(value).protocol === "https:")).max(12),
    trustedChartArtifactId: id.optional(),
    trustedChartSpec: z.string().trim().min(2).max(64 * 1_024).optional(),
    serializedBytes: z.number().int().min(0).max(16_384),
    estimatedTokens: z.number().int().nonnegative(),
    tokenEstimatorVersion: z.literal(
      "js-tiktoken@1.0.21:o200k_base:gpt-5.6-sol-estimate:v1",
    ),
  }).strict().superRefine((value, context) => {
    if ((value.packet === undefined) === (value.failureCode === undefined)) {
      context.addIssue({
        code: "custom",
        message: "A research result requires one packet or one failure.",
      });
    }
    if (
      value.failureCode === undefined
        ? value.failureDetail !== undefined || value.failureRetryable !== undefined
        : value.failureDetail === undefined || value.failureRetryable === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "A research failure requires bounded detail and retry classification.",
      });
    }
  }),
  z.object({
    operation: z.literal("recordFrontmanResume"),
    actorId: id,
    guildId: id,
    fence: durableStageFence,
    requestId: id,
    action: z.enum(["send", "suppress", "recheck"]),
    payload: z.string().trim().min(2).max(32 * 1_024),
    acknowledgementDelivery: z.enum(["not_required", "pending", "sent", "uncertain"]),
    replyHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    eligibleThroughSequence: z.number().int().positive(),
    eligibleHumanRevision: z.number().int().nonnegative(),
    eligibleContextHash: z.string().regex(/^[a-f0-9]{16,64}$/),
    nextExplicitTriggerSequence: z.number().int().positive().optional(),
  }).strict(),
  z.object({
    operation: z.literal("completeLoop"),
    actorId: id,
    channelId: id,
    runId: id,
    generation: z.number().int().positive(),
    conversation: conversationFence.optional(),
    outcome: z.enum(["completed", "error"]),
    recheckRequested: z.boolean().optional(),
    consumesThroughSequence: timestamp.optional(),
    suppressPendingReplies: z.boolean().optional(),
    error: z.string().trim().min(1).max(1_000).optional(),
    retryable: z.boolean().optional(),
  }).strict(),
  z.object({
    operation: z.literal("heartbeat"),
    actorId: id,
    instanceId: id,
    status: z.enum(["online", "degraded"]),
    botUserId: id.optional(),
    botUserName: z.string().trim().min(1).max(200).optional(),
    connectedAt: timestamp.optional(),
    error: z.string().trim().min(1).max(1_000).optional(),
    run: z.object({
      channelId: id,
      runId: id,
      generation: z.number().int().positive(),
      conversationId: id.optional(),
      epoch: z.number().int().positive().optional(),
      conversationGeneration: z.number().int().positive().optional(),
      routingGeneration: z.number().int().positive().optional(),
      turnId: id.optional(),
      conversationLeaseToken: id.optional(),
      stage: z.enum([
        "triaging",
        "acknowledging",
        "researching",
        "drafting",
        "catching_up",
      ]).optional(),
    }).strict().optional(),
  }).strict(),
  z.object({
    operation: z.literal("listRunnable"),
    actorId: id,
    workerId: id,
    limit: z.number().int().min(1).max(50).optional(),
  }).strict(),
  z.object({
    operation: z.literal("nextPortableCheckpoint"),
    actorId: id,
  }).strict(),
  z.object({
    operation: z.literal("storePortableCheckpoint"),
    actorId: id,
    guildId: id,
    conversationId: id,
    epoch: z.number().int().nonnegative(),
    expectedRevision: z.number().int().positive(),
    expectedGeneration: z.number().int().positive(),
    expectedRoutingGeneration: z.number().int().positive(),
    checkpointId: id,
    sourceContextHash: z.string().regex(/^[a-f0-9]{64}$/),
    toolPolicyHash: z.string().regex(/^[a-f0-9]{64}$/),
    compactedThroughOrdinal: z.number().int().positive(),
    portableSummary: z.string().trim().min(2).max(512 * 1_024),
    retainedRecentEventIds: z.array(id).max(2_000),
    inputTokens: z.number().int().positive(),
    outputTokens: z.number().int().nonnegative(),
    estimatedSavedTokens: z.number().int(),
  }).strict(),
  z.object({
    operation: z.literal("enqueueReply"),
    actorId: id,
    sourceChannelId: id,
    guildId: id,
    channelId: id,
    runId: id,
    generation: z.number().int().positive(),
    conversation: conversationFence.optional(),
    idempotencyKey: id,
    replyKind: z.enum(["acknowledgement", "research_log", "final"]).optional(),
    content: discordReplyContent,
    chart: discordMarketChart.optional(),
    replyToMessageId: id.optional(),
    consumesThroughSequence: timestamp.optional(),
    recheckRequested: z.boolean(),
    finalizesLoop: z.boolean(),
  }).strict().superRefine((value, context) => {
    const replyKind = value.replyKind
      ?? (value.finalizesLoop ? "final" : "research_log");
    if (
      replyKind === "acknowledgement"
      && Array.from(value.content).length > 320
    ) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Discord acknowledgement exceeds 320 Unicode characters.",
      });
    }
  }),
  z.object({
    operation: z.literal("beginReplyDelivery"),
    actorId: id,
    outboxId: id,
    deliveryToken: id,
  }).strict(),
  z.object({
    operation: z.literal("acknowledgeReply"),
    actorId: id,
    outboxId: id,
    deliveryToken: id,
    status: z.enum(["sent", "failed", "uncertain"]),
    discordMessageId: id.optional(),
    images: z.array(discordImageAttachment).max(4).optional(),
    error: z.string().trim().min(1).max(1_000).optional(),
    retryable: z.boolean().optional(),
  }).strict(),
]);

export type DiscordGatewayRequest = z.infer<typeof discordGatewayRequestSchema>;
export type DiscordGatewayOperation = DiscordGatewayRequest["operation"];

export interface DiscordGatewayErrorResponse {
  ok: false;
  operation?: DiscordGatewayOperation;
  error: string;
}

export interface DiscordGatewaySuccessResponse<T> {
  ok: true;
  operation: DiscordGatewayOperation;
  result: T;
}

export type DiscordGatewayResponse<T = unknown> =
  | DiscordGatewaySuccessResponse<T>
  | DiscordGatewayErrorResponse;
