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
  type ClaimLoopResponse,
  type DiscoveredGuild,
  type LoopStage,
  type OutboxItem,
  type ReplyKind,
  type RunnableChannel,
  type StoredMessage,
} from "../contracts.js";

const operationSchema = z.enum([
  "syncGuilds",
  "ingestMessage",
  "claimLoop",
  "newestContext",
  "completeLoop",
  "heartbeat",
  "listRunnable",
  "enqueueReply",
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
      channelName: z.string().trim().min(1).max(200),
      leaseExpiresAt: z.number().int().nonnegative(),
      windowStart: z.number().int().positive(),
      windowEnd: z.number().int().positive(),
      contextHash: z.string().trim().min(1).max(256),
      recheckCount: z.number().int().min(0).max(3),
      triggerKind: z.enum(["ambient", "mention", "recheck"]),
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
    messages: z.array(convexMessageSchema).min(1).max(10),
  })
  .strict();

const heartbeatResponseSchema = z
  .object({
    gatewayAccepted: z.literal(true),
    loopAccepted: z.boolean().optional(),
    leaseExpiresAt: z.number().int().nonnegative().optional(),
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
    replyKind: z.enum(["acknowledgement", "research_log", "final"]).optional(),
    status: z.enum(["pending", "sent"]),
    content: z.string().trim().min(1).max(2_000),
    chart: marketChartSpecSchema.optional(),
    replyToMessageId: snowflakeSchema.optional(),
    consumesThroughSequence: z.number().int().nonnegative().optional(),
    recheckRequested: z.boolean(),
    finalizesLoop: z.boolean(),
    discordMessageId: snowflakeSchema.optional(),
    deliveryToken: stableIdSchema.optional(),
    attempts: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
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
    status: z.enum(["pending", "sent", "finalized", "failed"]),
  })
  .strict();

const acknowledgeResponseSchema = z
  .object({
    accepted: z.literal(true),
    duplicate: z.boolean(),
    status: z.enum(["pending", "sent", "failed"]),
    attempts: z.number().int().nonnegative().optional(),
  })
  .strict();

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
}

type HeartbeatRunIdentity = Pick<
  RunIdentity,
  "channelId" | "runId" | "generation"
> & { stage?: LoopStage };

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

export interface RunnableWork {
  channels: RunnableChannel[];
  replies: OutboxItem[];
}

export interface AcknowledgeResult {
  status: "pending" | "sent" | "failed";
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
    authorName: message.authorName.slice(0, 100),
    content: message.content.slice(0, 4_000),
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
    const claim: ClaimLoopResponse = {
      claimed: true,
      guildId: channel.guildId,
      channelId: channel.channelId,
      idempotent: result.idempotent,
      runId: result.runId,
      generation: result.generation,
      mode: result.mode,
      channelName: result.channelName.slice(0, 100),
      leaseExpiresAt: result.leaseExpiresAt,
      windowStart: result.windowStart,
      windowEnd: result.windowEnd,
      contextHash: result.contextHash,
      recheckCount: result.recheckCount,
      triggerKind: result.triggerKind,
      replyChannelId: result.replyChannelId,
      messages: result.messages.map(toAgentMessage),
    };
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
      {
        channelId: run.channelId,
        runId: run.runId,
        generation: run.generation,
        stage,
      },
      signal,
    );
  }

  async renewRunLease(
    run: RunIdentity,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return this.heartbeat(
      { status: "online" },
      {
        channelId: run.channelId,
        runId: run.runId,
        generation: run.generation,
      },
      signal,
    );
  }

  private async heartbeat(
    gateway: GatewayHeartbeat,
    run?: HeartbeatRunIdentity,
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
    channel: ChannelReference,
    signal?: AbortSignal,
  ): Promise<NewestContext> {
    const result = await this.request(
      "newestContext",
      {
        actorId: this.config.discordOwnerId,
        ...channel,
      },
      newestContextResponseSchema,
      signal,
    );
    return {
      guildId: result.guildId,
      channelId: result.channelId,
      throughSequence: result.throughSequence,
      triggerThroughSequence: result.triggerThroughSequence,
      completedThroughSequence: result.completedThroughSequence,
      contextHash: result.contextHash,
      messages: result.messages.map(toAgentMessage),
    };
  }

  async completeLoop(
    identity: RunIdentity,
    outcome: "completed" | "error",
    options: CompleteLoopOptions = {},
    signal?: AbortSignal,
  ): Promise<CompleteLoopResult> {
    const result = await this.request(
      "completeLoop",
      {
        actorId: this.config.discordOwnerId,
        channelId: identity.channelId,
        runId: identity.runId,
        generation: identity.generation,
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
  ): Promise<void> {
    await this.request(
      "enqueueReply",
      {
        actorId: this.config.discordOwnerId,
        sourceChannelId: input.channelId,
        guildId: input.guildId,
        channelId: input.targetChannelId,
        runId: input.runId,
        generation: input.generation,
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
  }

  async listRunnable(
    workerId: string,
    signal?: AbortSignal,
  ): Promise<RunnableWork> {
    return this.request(
      "listRunnable",
      {
        actorId: this.config.discordOwnerId,
        workerId,
        limit: 50,
      },
      runnableResponseSchema,
      signal,
    );
  }

  async acknowledgeReply(
    item: Pick<OutboxItem, "outboxId" | "deliveryToken">,
    result: {
      status: "sent" | "failed";
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
