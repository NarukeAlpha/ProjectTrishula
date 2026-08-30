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
    isBot: z.boolean(),
    replyToMessageId: id.optional(),
    createdAt: timestamp,
  }).strict(),
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
    error: z.string().trim().min(1).max(1_000).optional(),
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
    replyToMessageId: id.optional(),
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
