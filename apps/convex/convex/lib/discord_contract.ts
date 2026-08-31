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
  }).strict(),
  z.object({
    operation: z.literal("completeLoop"),
    actorId: id,
    channelId: id,
    runId: id,
    generation: z.number().int().positive(),
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
    operation: z.literal("enqueueReply"),
    actorId: id,
    sourceChannelId: id,
    guildId: id,
    channelId: id,
    runId: id,
    generation: z.number().int().positive(),
    idempotencyKey: id,
    replyKind: z.enum(["acknowledgement", "research_log", "final"]).optional(),
    content: z.string().trim().min(1).max(2_000),
    chart: discordMarketChart.optional(),
    replyToMessageId: id.optional(),
    consumesThroughSequence: timestamp.optional(),
    recheckRequested: z.boolean(),
    finalizesLoop: z.boolean(),
  }).strict(),
  z.object({
    operation: z.literal("acknowledgeReply"),
    actorId: id,
    outboxId: id,
    deliveryToken: id,
    status: z.enum(["sent", "failed"]),
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
