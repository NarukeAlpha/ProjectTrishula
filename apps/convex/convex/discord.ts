import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel.js";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import { actorFromIdentity, requireAllowedWorkosUserId } from "./lib/auth.js";
import {
  DISCORD_CONTEXT_SIZE,
  DISCORD_GATEWAY_HEARTBEAT_TTL_MS,
  DISCORD_LOOP_LEASE_MS,
  DISCORD_MAX_LOOP_ERROR_ATTEMPTS,
  DISCORD_MAX_AUTONOMOUS_RECHECKS,
  DISCORD_MAX_OUTBOX_ATTEMPTS,
  DISCORD_OUTBOX_DELIVERY_LEASE_MS,
  discordClaimDecision,
  discordContextHash,
  discordDeliveryToken,
  discordDuplicateMessageMatches,
  discordMessageIngestDecision,
  discordLoopErrorRetryReady,
  discordRecheckDecision,
  discordReplyKindMatchesFlags,
  discordReplyTargetAllowsKind,
  discordTrailingContextStart,
  normalizeDiscordChannelRoles,
  pendingDiscordMessageCount,
  hasPendingDiscordReply,
  hasSentDiscordFinalizer,
  isCurrentDiscordGeneration,
  resolveDiscordChannelRouting,
  type DiscordChannelRole,
  type DiscordMessageIdentity,
  type DiscordMessageContext,
  type DiscordRecheckInput,
} from "./lib/discord_state.js";
import {
  discordChannelRoleValidator,
  discordChannelTypeValidator,
  discordReplyKindValidator,
} from "./schema.js";

const serviceId = v.string();
const discordPermissionsValidator = v.object({
  viewChannels: v.boolean(),
  sendMessages: v.boolean(),
  readMessageHistory: v.boolean(),
  messageContent: v.boolean(),
});
const discordChannelSnapshotValidator = v.object({
  channelId: v.string(),
  name: v.string(),
  type: discordChannelTypeValidator,
  canView: v.boolean(),
  canSend: v.boolean(),
  canReadHistory: v.boolean(),
});
const discordGuildSnapshotValidator = v.object({
  guildId: v.string(),
  name: v.string(),
  iconUrl: v.optional(v.string()),
  permissions: discordPermissionsValidator,
  channels: v.array(discordChannelSnapshotValidator),
});
const discordMessageValidator = v.object({
  actorId: serviceId,
  guildId: serviceId,
  channelId: serviceId,
  messageId: serviceId,
  authorId: serviceId,
  authorName: v.string(),
  content: v.string(),
  isBot: v.boolean(),
  replyToMessageId: v.optional(v.string()),
  createdAt: v.number(),
});
const loopStageValidator = v.union(
  v.literal("triaging"),
  v.literal("acknowledging"),
  v.literal("researching"),
  v.literal("drafting"),
  v.literal("catching_up"),
);
const DISCORD_ACTIVITY_HISTORY_PER_GUILD = 20;
const DISCORD_ACTIVITY_RETENTION_LIMIT = 500;

type DiscordReader = { db: Pick<QueryCtx["db"], "query"> };
type DiscordWriter = Pick<MutationCtx, "db">;

type DiscordGatewayRecord = Omit<Doc<"discordGateways">, "_id" | "_creationTime">;
type DiscordGatewayUpdate = Pick<
  DiscordGatewayRecord,
  "instanceId" | "reportedStatus" | "lastHeartbeatAt" | "updatedAt"
> & Partial<Pick<
  DiscordGatewayRecord,
  "botUserId" | "botUserName" | "connectedAt" | "error"
>>;
type DiscordGuildRecord = Omit<Doc<"discordGuilds">, "_id" | "_creationTime">;
type DiscordMessageRecord = Omit<Doc<"discordMessages">, "_id" | "_creationTime">;
type DiscordOutboxRecord = Omit<Doc<"discordOutbox">, "_id" | "_creationTime">;
type DiscordActivityRecord = Omit<
  Doc<"discordActivityEvents">,
  "_id" | "_creationTime" | "ownerId" | "createdAt"
>;

interface RunnableOutboxReply {
  reply: Doc<"discordOutbox">;
  deliveryToken?: string;
}

interface DiscordGatewayView {
  status: "online" | "offline" | "degraded";
  connectedAt?: number;
  lastHeartbeatAt: number;
  botUserName?: string;
  error?: string;
}

interface DiscordActivityView {
  eventId: string;
  guildId: string;
  channelId: string;
  runId?: string;
  eventType: Doc<"discordActivityEvents">["eventType"];
  stage?: Doc<"discordActivityEvents">["stage"];
  replyKind?: Doc<"discordActivityEvents">["replyKind"];
  createdAt: number;
}

interface MonitoredChannelCursor {
  guildId: string;
  channelId: string;
  afterMessageId: string | null;
}

interface DiscordGatewayInput {
  status: "online" | "degraded";
  botUserId?: string;
  botUserName?: string;
  connectedAt?: number;
  error?: string;
}

function gatewayUpdate(
  instanceId: string,
  args: DiscordGatewayInput,
  now: number,
): DiscordGatewayUpdate {
  const value: DiscordGatewayUpdate = {
    instanceId,
    reportedStatus: args.status,
    lastHeartbeatAt: now,
    updatedAt: now,
  };
  if (args.botUserId !== undefined) value.botUserId = args.botUserId;
  if (args.botUserName?.trim()) value.botUserName = args.botUserName.trim();
  if (args.connectedAt !== undefined) value.connectedAt = args.connectedAt;
  if (args.error?.trim()) value.error = args.error.trim();
  return value;
}

function gatewayRecord(
  ownerId: string,
  instanceId: string,
  args: DiscordGatewayInput,
  now: number,
): DiscordGatewayRecord {
  return {
    ownerId,
    ...gatewayUpdate(instanceId, args, now),
    createdAt: now,
  };
}

function requireDiscordId(value: string, name: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9:_-]{1,256}$/.test(normalized)) {
    throw new Error(`${name} is invalid.`);
  }
  return normalized;
}

function requireDiscordOwnerId(value: string): string {
  return requireDiscordId(requireAllowedWorkosUserId(value), "actorId");
}

function requireDiscordName(value: string, name: string, maximum = 200): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${name} is invalid.`);
  return normalized;
}

function requireDiscordContent(value: string): string {
  if (value.length > 8_000) throw new Error("Discord message content is too long.");
  return value;
}

function requireReplyContent(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 2_000) throw new Error("Discord reply content is invalid.");
  return normalized;
}

async function recordActivity(
  ctx: DiscordWriter,
  ownerId: string,
  event: DiscordActivityRecord,
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query("discordActivityEvents")
    .withIndex("by_owner_event", (index) => index
      .eq("ownerId", ownerId)
      .eq("eventId", event.eventId))
    .unique();
  if (existing) return;
  await ctx.db.insert("discordActivityEvents", {
    ownerId,
    ...event,
    createdAt: now,
  });
  const retained = await ctx.db
    .query("discordActivityEvents")
    .withIndex("by_owner_createdAt", (index) => index.eq("ownerId", ownerId))
    .order("desc")
    .take(DISCORD_ACTIVITY_RETENTION_LIMIT + 25);
  for (const stale of retained.slice(DISCORD_ACTIVITY_RETENTION_LIMIT)) {
    await ctx.db.delete(stale._id);
  }
}

async function discordChannel(
  ctx: DiscordReader,
  ownerId: string,
  guildId: string,
  channelId: string,
): Promise<Doc<"discordChannels"> | null> {
  return ctx.db
    .query("discordChannels")
    .withIndex("by_owner_guild_channel", (index) => index
      .eq("ownerId", ownerId)
      .eq("guildId", guildId)
      .eq("channelId", channelId))
    .unique();
}

async function discordChannelState(
  ctx: DiscordReader,
  ownerId: string,
  channelId: string,
): Promise<Doc<"discordChannelStates"> | null> {
  return ctx.db
    .query("discordChannelStates")
    .withIndex("by_owner_channel", (index) => index.eq("ownerId", ownerId).eq("channelId", channelId))
    .unique();
}

function toMessageContext(message: Doc<"discordMessages">): DiscordMessageContext {
  const context: DiscordMessageContext = {
    messageId: message.messageId,
    sequence: message.sequence,
    authorId: message.authorId,
    authorName: message.authorName,
    content: message.content,
    isBot: message.isBot,
    createdAt: message.createdAt,
  };
  if (message.replyToMessageId !== undefined) context.replyToMessageId = message.replyToMessageId;
  return context;
}

async function contextWindow(
  ctx: DiscordReader,
  ownerId: string,
  channelId: string,
  start: number,
  end: number,
): Promise<DiscordMessageContext[]> {
  const messages = await ctx.db
    .query("discordMessages")
    .withIndex("by_owner_channel_sequence", (index) => index
      .eq("ownerId", ownerId)
      .eq("channelId", channelId)
      .gte("sequence", start)
      .lte("sequence", end))
    .order("asc")
    .collect();
  return messages.map(toMessageContext);
}

async function newestContext(
  ctx: DiscordReader,
  ownerId: string,
  channelId: string,
): Promise<DiscordMessageContext[]> {
  const messages = await ctx.db
    .query("discordMessages")
    .withIndex("by_owner_channel_sequence", (index) => index
      .eq("ownerId", ownerId)
      .eq("channelId", channelId))
    .order("desc")
    .take(DISCORD_CONTEXT_SIZE);
  return messages.reverse().map(toMessageContext);
}

async function channelRouting(
  ctx: DiscordReader,
  ownerId: string,
  guildId: string,
  sourceChannelId: string,
) {
  const channels = await ctx.db
    .query("discordChannels")
    .withIndex("by_owner_guild_available_name", (index) => index
      .eq("ownerId", ownerId)
      .eq("guildId", guildId)
      .eq("available", true))
    .collect();
  return resolveDiscordChannelRouting(sourceChannelId, channels);
}

function hasRole(channel: Doc<"discordChannels">, role: DiscordChannelRole): boolean {
  return channel.roles.includes(role);
}

function clearActiveLoop() {
  return {
    activeRunId: undefined,
    activeClaimId: undefined,
    activeWorkerId: undefined,
    activeMode: undefined,
    activeWindowStart: undefined,
    activeWindowEnd: undefined,
    activeContextHash: undefined,
    leaseExpiresAt: undefined,
  };
}

function activeLease(state: Doc<"discordChannelStates">, now: number): boolean {
  return state.activeRunId !== undefined
    && state.leaseExpiresAt !== undefined
    && state.leaseExpiresAt > now;
}

async function invalidateRunOutbox(
  ctx: DiscordWriter,
  ownerId: string,
  runId: string,
  error: string,
  now: number,
): Promise<void> {
  const replies = await ctx.db
    .query("discordOutbox")
    .withIndex("by_owner_run", (index) => index.eq("ownerId", ownerId).eq("runId", runId))
    .collect();
  for (const reply of replies) {
    if (reply.status === "pending") {
      await ctx.db.patch(reply._id, {
        status: "failed",
        lastError: error,
        deliveryWorkerId: undefined,
        deliveryToken: undefined,
        deliveryLeaseExpiresAt: undefined,
        updatedAt: now,
      });
    } else if (reply.status === "sent") {
      await ctx.db.patch(reply._id, { status: "finalized", updatedAt: now });
    }
  }
}

function publicGateway(
  gateway: Doc<"discordGateways"> | null,
  now: number,
) {
  if (!gateway) return { status: "not_configured" as const };
  const stale = gateway.lastHeartbeatAt + DISCORD_GATEWAY_HEARTBEAT_TTL_MS < now;
  const status = stale
    ? "offline" as const
    : gateway.reportedStatus === "degraded"
      ? "degraded" as const
      : "online" as const;
  const result: DiscordGatewayView = {
    status,
    lastHeartbeatAt: gateway.lastHeartbeatAt,
  };
  if (gateway.connectedAt !== undefined) result.connectedAt = gateway.connectedAt;
  if (gateway.botUserName !== undefined) result.botUserName = gateway.botUserName;
  if (gateway.error !== undefined) result.error = gateway.error;
  return result;
}

function publicActivity(event: Doc<"discordActivityEvents">): DiscordActivityView {
  const result: DiscordActivityView = {
    eventId: event.eventId,
    guildId: event.guildId,
    channelId: event.channelId,
    eventType: event.eventType,
    createdAt: event.createdAt,
  };
  if (event.runId !== undefined) result.runId = event.runId;
  if (event.stage !== undefined) result.stage = event.stage;
  if (event.replyKind !== undefined) result.replyKind = event.replyKind;
  return result;
}

export const getControlPlane = query({
  args: {},
  handler: async (ctx) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const now = Date.now();
    const gateway = await ctx.db
      .query("discordGateways")
      .withIndex("by_owner", (index) => index.eq("ownerId", actor.id))
      .unique();
    const guilds = await ctx.db
      .query("discordGuilds")
      .withIndex("by_owner_available_name", (index) => index
        .eq("ownerId", actor.id)
        .eq("available", true))
      .collect();
    const activity = (await Promise.all(guilds.map((guild) => ctx.db
      .query("discordActivityEvents")
      .withIndex("by_owner_guild_createdAt", (index) => index
        .eq("ownerId", actor.id)
        .eq("guildId", guild.guildId))
      .order("desc")
      .take(DISCORD_ACTIVITY_HISTORY_PER_GUILD))))
      .flat()
      .sort((left, right) => right.createdAt - left.createdAt);

    return {
      gateway: publicGateway(gateway, now),
      activity: activity.map(publicActivity),
      guilds: await Promise.all(guilds.map(async (guild) => {
        const channels = await ctx.db
          .query("discordChannels")
          .withIndex("by_owner_guild_available_name", (index) => index
            .eq("ownerId", actor.id)
            .eq("guildId", guild.guildId)
            .eq("available", true))
          .collect();
        return {
          guildId: guild.guildId,
          name: guild.name,
          iconUrl: guild.iconUrl,
          permissions: guild.permissions,
          channels: await Promise.all(channels.map(async (channel) => {
            const state = await discordChannelState(ctx, actor.id, channel.channelId);
            const loop = state
              ? {
                  status: state.status,
                  pendingMessageCount: pendingDiscordMessageCount(state),
                  lastProcessedAt: state.lastProcessedAt,
                  error: state.lastError,
                }
              : {
                  status: "idle" as const,
                  pendingMessageCount: 0,
                };
            return {
              channelId: channel.channelId,
              name: channel.name,
              type: channel.type,
              canView: channel.canView,
              canSend: channel.canSend,
              canReadHistory: channel.canReadHistory,
              roles: channel.roles,
              loop,
            };
          })),
        };
      })),
    };
  },
});

export const setChannelRoles = mutation({
  args: {
    guildId: v.string(),
    channelId: v.string(),
    roles: v.array(discordChannelRoleValidator),
  },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const guildId = requireDiscordId(args.guildId, "guildId");
    const channelId = requireDiscordId(args.channelId, "channelId");
    const roles = normalizeDiscordChannelRoles(args.roles);
    const channel = await discordChannel(ctx, actor.id, guildId, channelId);
    if (!channel?.available) throw new Error("Discord channel not found.");
    if (roles.includes("conversation_monitor") && (!channel.canView || !channel.canReadHistory)) {
      throw new Error("Discord channel cannot be monitored with its current permissions.");
    }
    if ((roles.includes("reply_target") || roles.includes("research_log")) && !channel.canSend) {
      throw new Error("Discord channel does not allow the bot to send messages.");
    }

    const now = Date.now();
    const wasMonitored = hasRole(channel, "conversation_monitor");
    const isMonitored = roles.includes("conversation_monitor");
    await ctx.db.patch(channel._id, { roles, updatedAt: now });
    let state = await discordChannelState(ctx, actor.id, channelId);
    if (!state && isMonitored) {
      const stateId = await ctx.db.insert("discordChannelStates", {
        ownerId: actor.id,
        guildId,
        channelId,
        generation: 0,
        status: "idle",
        latestSequence: 0,
        triggerThroughSequence: 0,
        completedThroughSequence: 0,
        recheckCount: 0,
        recheckPending: false,
        consecutiveErrorCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      state = await ctx.db.get(stateId);
    }
    if (state && wasMonitored && !isMonitored) {
      if (state.activeRunId !== undefined) {
        const run = await ctx.db
          .query("discordLoopRuns")
          .withIndex("by_owner_run", (index) => index.eq("ownerId", actor.id).eq("runId", state.activeRunId!))
          .unique();
        if (run && !["completed", "error", "stale"].includes(run.status)) {
          await ctx.db.patch(run._id, { status: "stale", completedAt: now, updatedAt: now });
        }
        await invalidateRunOutbox(
          ctx,
          actor.id,
          state.activeRunId,
          "Source channel monitoring was disabled before delivery.",
          now,
        );
      }
      await ctx.db.patch(state._id, {
        generation: state.generation + 1,
        status: "idle",
        triggerThroughSequence: state.latestSequence,
        completedThroughSequence: state.latestSequence,
        recheckCount: 0,
        recheckPending: false,
        lastRecheckHash: undefined,
        lastError: undefined,
        ...clearActiveLoop(),
        updatedAt: now,
      });
    }
    return { guildId, channelId, roles, updatedAt: now };
  },
});

export const syncGuilds = internalMutation({
  args: {
    actorId: serviceId,
    instanceId: serviceId,
    botUserId: v.optional(serviceId),
    botUserName: v.optional(v.string()),
    connectedAt: v.optional(v.number()),
    status: v.union(v.literal("online"), v.literal("degraded")),
    error: v.optional(v.string()),
    guilds: v.array(discordGuildSnapshotValidator),
  },
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const instanceId = requireDiscordId(args.instanceId, "instanceId");
    const now = Date.now();
    const gateway = await ctx.db
      .query("discordGateways")
      .withIndex("by_owner", (index) => index.eq("ownerId", ownerId))
      .unique();
    const gatewayValue = gatewayUpdate(instanceId, args, now);
    if (gateway) {
      await ctx.db.patch(gateway._id, args.status === "online" && !args.error
        ? { ...gatewayValue, error: undefined }
        : gatewayValue);
    }
    else await ctx.db.insert("discordGateways", gatewayRecord(ownerId, instanceId, args, now));

    const knownGuilds = await ctx.db
      .query("discordGuilds")
      .withIndex("by_owner_available_name", (index) => index.eq("ownerId", ownerId))
      .collect();
    const knownChannels = await ctx.db
      .query("discordChannels")
      .withIndex("by_owner_guild_available_name", (index) => index.eq("ownerId", ownerId))
      .collect();
    for (const guild of knownGuilds) {
      if (guild.available) await ctx.db.patch(guild._id, { available: false, updatedAt: now });
    }
    for (const channel of knownChannels) {
      if (channel.available) await ctx.db.patch(channel._id, { available: false, updatedAt: now });
    }

    let channelCount = 0;
    for (const guildSnapshot of args.guilds) {
      const guildId = requireDiscordId(guildSnapshot.guildId, "guildId");
      const guild = await ctx.db
        .query("discordGuilds")
        .withIndex("by_owner_guild", (index) => index.eq("ownerId", ownerId).eq("guildId", guildId))
        .unique();
      const guildValue = {
        name: requireDiscordName(guildSnapshot.name, "guild name"),
        iconUrl: guildSnapshot.iconUrl,
        permissions: guildSnapshot.permissions,
        available: true,
        lastSeenAt: now,
        updatedAt: now,
      };
      if (guild) await ctx.db.patch(guild._id, guildValue);
      else {
        const guildRecord: DiscordGuildRecord = {
          ownerId,
          guildId,
          name: guildValue.name,
        permissions: guildValue.permissions,
          available: guildValue.available,
          lastSeenAt: guildValue.lastSeenAt,
          updatedAt: guildValue.updatedAt,
          createdAt: now,
        };
        if (guildSnapshot.iconUrl !== undefined) guildRecord.iconUrl = guildSnapshot.iconUrl;
        await ctx.db.insert("discordGuilds", guildRecord);
      }

      for (const channelSnapshot of guildSnapshot.channels) {
        const channelId = requireDiscordId(channelSnapshot.channelId, "channelId");
        const channel = await discordChannel(ctx, ownerId, guildId, channelId);
        const channelValue = {
          name: requireDiscordName(channelSnapshot.name, "channel name"),
          type: channelSnapshot.type,
          canView: channelSnapshot.canView,
          canSend: channelSnapshot.canSend,
          canReadHistory: channelSnapshot.canReadHistory,
          available: true,
          lastSeenAt: now,
          updatedAt: now,
        };
        if (channel) await ctx.db.patch(channel._id, channelValue);
        else await ctx.db.insert("discordChannels", {
          ownerId,
          guildId,
          channelId,
          roles: [],
          ...channelValue,
          createdAt: now,
        });
        channelCount += 1;
      }
    }
    const synchronizedChannels = await ctx.db
      .query("discordChannels")
      .withIndex("by_owner_guild_available_name", (index) => index.eq("ownerId", ownerId))
      .collect();
    const monitoredChannels: MonitoredChannelCursor[] = [];
    for (const channel of synchronizedChannels) {
      if (!channel.available || !hasRole(channel, "conversation_monitor")) continue;
      const latestMessage = await ctx.db
        .query("discordMessages")
        .withIndex("by_owner_channel_sequence", (index) => index
          .eq("ownerId", ownerId)
          .eq("channelId", channel.channelId))
        .order("desc")
        .first();
      const cursor: MonitoredChannelCursor = {
        guildId: channel.guildId,
        channelId: channel.channelId,
        afterMessageId: latestMessage?.messageId ?? null,
      };
      monitoredChannels.push(cursor);
    }
    return {
      guildCount: args.guilds.length,
      channelCount,
      syncedAt: now,
      monitoredChannels,
    };
  },
});

export const ingestMessage = internalMutation({
  args: discordMessageValidator.fields,
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const guildId = requireDiscordId(args.guildId, "guildId");
    const channelId = requireDiscordId(args.channelId, "channelId");
    const messageId = requireDiscordId(args.messageId, "messageId");
    const channel = await discordChannel(ctx, ownerId, guildId, channelId);
    if (!channel?.available || !hasRole(channel, "conversation_monitor")) {
      return { accepted: false as const, reason: "not_monitored" as const };
    }
    const existing = await ctx.db
      .query("discordMessages")
      .withIndex("by_owner_channel_message", (index) => index
        .eq("ownerId", ownerId)
        .eq("channelId", channelId)
        .eq("messageId", messageId))
      .unique();
    if (existing) {
      const incomingMessage: DiscordMessageIdentity = {
        guildId,
        authorId: args.authorId.trim(),
        authorName: args.authorName.trim(),
        content: args.content,
        isBot: args.isBot,
        createdAt: args.createdAt,
      };
      if (args.replyToMessageId !== undefined) {
        incomingMessage.replyToMessageId = args.replyToMessageId;
      }
      const duplicateMatches = discordDuplicateMessageMatches(existing, incomingMessage);
      if (!duplicateMatches) {
        return { accepted: false as const, reason: "message_id_conflict" as const };
      }
    }
    let state = await discordChannelState(ctx, ownerId, channelId);
    const now = Date.now();
    if (!state) {
      const stateId = await ctx.db.insert("discordChannelStates", {
        ownerId,
        guildId,
        channelId,
        generation: 0,
        status: "idle",
        latestSequence: 0,
        triggerThroughSequence: 0,
        completedThroughSequence: 0,
        recheckCount: 0,
        recheckPending: false,
        consecutiveErrorCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      state = await ctx.db.get(stateId);
    }
    if (!state) throw new Error("Discord channel state could not be created.");
    const decision = discordMessageIngestDecision(existing?.sequence, state.latestSequence, args.isBot);
    if (decision.duplicate) {
      return {
        accepted: true as const,
        duplicate: true,
        sequence: decision.sequence,
        shouldSchedule: false,
      };
    }

    const messageValue: DiscordMessageRecord = {
      ownerId,
      guildId,
      channelId,
      messageId,
      sequence: decision.sequence,
      authorId: requireDiscordId(args.authorId, "authorId"),
      authorName: requireDiscordName(args.authorName, "authorName"),
      content: requireDiscordContent(args.content),
      isBot: args.isBot,
      createdAt: args.createdAt,
      receivedAt: now,
    };
    if (args.replyToMessageId !== undefined) messageValue.replyToMessageId = args.replyToMessageId;
    await ctx.db.insert("discordMessages", messageValue);
    const running = activeLease(state, now);
    const startsNewChain = !args.isBot
      && !running
      && state.triggerThroughSequence <= state.completedThroughSequence;
    const triggerThroughSequence = args.isBot
      ? state.triggerThroughSequence
      : decision.sequence;
    const pendingCount = Math.max(0, triggerThroughSequence - state.completedThroughSequence);
    await ctx.db.patch(state._id, {
      latestSequence: decision.sequence,
      triggerThroughSequence,
      status: !args.isBot && !running
        ? pendingCount > DISCORD_CONTEXT_SIZE ? "catching_up" : "idle"
        : state.status,
      recheckCount: startsNewChain ? 0 : state.recheckCount,
      recheckPending: startsNewChain ? false : state.recheckPending,
      lastRecheckHash: startsNewChain ? undefined : state.lastRecheckHash,
      lastError: !args.isBot && !running ? undefined : state.lastError,
      consecutiveErrorCount: !args.isBot && !running
        ? 0
        : (state.consecutiveErrorCount ?? 0),
      updatedAt: now,
    });
    if (!args.isBot) {
      await recordActivity(ctx, ownerId, {
        eventId: `message:${messageId}:received`,
        guildId,
        channelId,
        eventType: "message_received",
      }, now);
    }
    return {
      accepted: true as const,
      duplicate: false,
      sequence: decision.sequence,
      shouldSchedule: decision.triggersLoop && !running,
    };
  },
});

export const claimLoop = internalMutation({
  args: {
    actorId: serviceId,
    guildId: serviceId,
    channelId: serviceId,
    workerId: serviceId,
    claimId: serviceId,
  },
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const guildId = requireDiscordId(args.guildId, "guildId");
    const channelId = requireDiscordId(args.channelId, "channelId");
    const workerId = requireDiscordId(args.workerId, "workerId");
    const claimId = requireDiscordId(args.claimId, "claimId");
    const channel = await discordChannel(ctx, ownerId, guildId, channelId);
    if (!channel?.available || !hasRole(channel, "conversation_monitor")) {
      return { claimed: false as const, reason: "not_monitored" as const };
    }
    const routing = await channelRouting(ctx, ownerId, guildId, channelId);
    const state = await discordChannelState(ctx, ownerId, channelId);
    if (!state) return { claimed: false as const, reason: "not_runnable" as const };
    const now = Date.now();

    const existingClaim = await ctx.db
      .query("discordLoopRuns")
      .withIndex("by_owner_claim", (index) => index.eq("ownerId", ownerId).eq("claimId", claimId))
      .unique();
    if (existingClaim) {
      if (
        state.activeClaimId === claimId
        && state.activeRunId === existingClaim.runId
        && state.generation === existingClaim.generation
        && activeLease(state, now)
      ) {
        const messages = await contextWindow(
          ctx,
          ownerId,
          channelId,
          discordTrailingContextStart(existingClaim.windowEnd),
          existingClaim.windowEnd,
        );
        return {
          claimed: true as const,
          idempotent: true,
          runId: existingClaim.runId,
          generation: existingClaim.generation,
          mode: existingClaim.mode,
          channelName: channel.name,
          leaseExpiresAt: existingClaim.leaseExpiresAt,
          windowStart: existingClaim.windowStart,
          windowEnd: existingClaim.windowEnd,
          contextHash: existingClaim.contextHash,
          recheckCount: existingClaim.recheckCount,
          ...routing,
          messages,
        };
      }
      return { claimed: false as const, reason: "claim_already_used" as const };
    }

    const expiredRecheck = state.activeRunId !== undefined
      && state.activeMode === "recheck"
      && state.leaseExpiresAt !== undefined
      && state.leaseExpiresAt <= now;
    const expiredReplies = state.activeRunId === undefined
      ? []
      : await ctx.db
        .query("discordOutbox")
        .withIndex("by_owner_run", (index) => index
          .eq("ownerId", ownerId)
          .eq("runId", state.activeRunId!))
        .collect();
    if (
      state.activeRunId !== undefined
      && state.leaseExpiresAt !== undefined
      && state.leaseExpiresAt <= now
      && hasSentDiscordFinalizer(expiredReplies, state.activeRunId, state.generation)
    ) {
      return { claimed: false as const, reason: "awaiting_finalization" as const };
    }
    const claim = discordClaimDecision({
      ...state,
      recheckPending: state.recheckPending || expiredRecheck,
    }, now);
    if (!claim.claimed) return { claimed: false as const, reason: claim.reason };
    const window = claim.window;

    if (state.activeRunId !== undefined) {
      const expiredRun = await ctx.db
        .query("discordLoopRuns")
        .withIndex("by_owner_run", (index) => index.eq("ownerId", ownerId).eq("runId", state.activeRunId!))
        .unique();
      if (expiredRun && !["completed", "error", "stale"].includes(expiredRun.status)) {
        await ctx.db.patch(expiredRun._id, { status: "stale", completedAt: now, updatedAt: now });
      }
      await invalidateRunOutbox(
        ctx,
        ownerId,
        state.activeRunId,
        "Source loop lease expired before delivery.",
        now,
      );
    }

    const messages = await contextWindow(
      ctx,
      ownerId,
      channelId,
      discordTrailingContextStart(window.end),
      window.end,
    );
    const contextHash = discordContextHash(messages);
    const generation = claim.generation;
    const leaseExpiresAt = now + DISCORD_LOOP_LEASE_MS;
    const runId = claimId;
    await ctx.db.insert("discordLoopRuns", {
      ownerId,
      guildId,
      channelId,
      runId,
      claimId,
      workerId,
      generation,
      mode: window.mode,
      status: "triaging",
      windowStart: window.start,
      windowEnd: window.end,
      contextHash,
      recheckCount: state.recheckCount,
      leaseExpiresAt,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(state._id, {
      generation,
      status: "triaging",
      activeRunId: runId,
      activeClaimId: claimId,
      activeWorkerId: workerId,
      activeMode: window.mode,
      activeWindowStart: window.start,
      activeWindowEnd: window.end,
      activeContextHash: contextHash,
      leaseExpiresAt,
      recheckPending: false,
      lastError: undefined,
      updatedAt: now,
    });
    await recordActivity(ctx, ownerId, {
      eventId: `${runId}:started`,
      guildId,
      channelId,
      runId,
      eventType: "loop_started",
      stage: "triaging",
    }, now);
    return {
      claimed: true as const,
      idempotent: false,
      runId,
      generation,
      mode: window.mode,
      channelName: channel.name,
      leaseExpiresAt,
      windowStart: window.start,
      windowEnd: window.end,
      contextHash,
      recheckCount: state.recheckCount,
      ...routing,
      messages,
    };
  },
});

export const getNewestContext = internalQuery({
  args: { actorId: serviceId, guildId: serviceId, channelId: serviceId },
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const guildId = requireDiscordId(args.guildId, "guildId");
    const channelId = requireDiscordId(args.channelId, "channelId");
    const channel = await discordChannel(ctx, ownerId, guildId, channelId);
    if (!channel?.available || !hasRole(channel, "conversation_monitor")) {
      throw new Error("Discord channel is not monitored.");
    }
    const state = await discordChannelState(ctx, ownerId, channelId);
    const messages = await newestContext(ctx, ownerId, channelId);
    return {
      guildId,
      channelId,
      throughSequence: state?.latestSequence ?? 0,
      triggerThroughSequence: state?.triggerThroughSequence ?? 0,
      completedThroughSequence: state?.completedThroughSequence ?? 0,
      contextHash: discordContextHash(messages),
      messages,
    };
  },
});

export const heartbeat = internalMutation({
  args: {
    actorId: serviceId,
    instanceId: serviceId,
    status: v.union(v.literal("online"), v.literal("degraded")),
    botUserId: v.optional(serviceId),
    botUserName: v.optional(v.string()),
    connectedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    run: v.optional(v.object({
      channelId: serviceId,
      runId: serviceId,
      generation: v.number(),
      stage: v.optional(loopStageValidator),
    })),
  },
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const instanceId = requireDiscordId(args.instanceId, "instanceId");
    const now = Date.now();
    const gateway = await ctx.db
      .query("discordGateways")
      .withIndex("by_owner", (index) => index.eq("ownerId", ownerId))
      .unique();
    const gatewayValue = gatewayUpdate(instanceId, args, now);
    if (gateway) {
      await ctx.db.patch(gateway._id, args.status === "online" && !args.error
        ? { ...gatewayValue, error: undefined }
        : gatewayValue);
    }
    else await ctx.db.insert("discordGateways", gatewayRecord(ownerId, instanceId, args, now));

    if (!args.run) return { gatewayAccepted: true, loopAccepted: undefined };
    const channelId = requireDiscordId(args.run.channelId, "channelId");
    const runId = requireDiscordId(args.run.runId, "runId");
    const state = await discordChannelState(ctx, ownerId, channelId);
    if (!state || !isCurrentDiscordGeneration(state, runId, args.run.generation)) {
      return { gatewayAccepted: true, loopAccepted: false as const, reason: "stale_generation" as const };
    }
    if (!activeLease(state, now)) {
      return { gatewayAccepted: true, loopAccepted: false as const, reason: "lease_expired" as const };
    }
    const run = await ctx.db
      .query("discordLoopRuns")
      .withIndex("by_owner_run", (index) => index.eq("ownerId", ownerId).eq("runId", runId))
      .unique();
    if (!run) return { gatewayAccepted: true, loopAccepted: false as const, reason: "run_not_found" as const };
    const leaseExpiresAt = now + DISCORD_LOOP_LEASE_MS;
    const nextStatus = args.run.stage;
    if (nextStatus === undefined) {
      await ctx.db.patch(state._id, { leaseExpiresAt, updatedAt: now });
      await ctx.db.patch(run._id, { leaseExpiresAt, updatedAt: now });
    } else {
      await ctx.db.patch(state._id, {
        status: nextStatus,
        leaseExpiresAt,
        updatedAt: now,
      });
      await ctx.db.patch(run._id, {
        status: nextStatus,
        leaseExpiresAt,
        updatedAt: now,
      });
    }
    if (nextStatus !== undefined && run.status !== nextStatus) {
      await recordActivity(ctx, ownerId, {
        eventId: `${runId}:stage:${nextStatus}`,
        guildId: state.guildId,
        channelId,
        runId,
        eventType: "stage_changed",
        stage: nextStatus,
      }, now);
    }
    return { gatewayAccepted: true, loopAccepted: true as const, leaseExpiresAt };
  },
});

export const completeLoop = internalMutation({
  args: {
    actorId: serviceId,
    channelId: serviceId,
    runId: serviceId,
    generation: v.number(),
    outcome: v.union(v.literal("completed"), v.literal("error")),
    recheckRequested: v.optional(v.boolean()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const channelId = requireDiscordId(args.channelId, "channelId");
    const runId = requireDiscordId(args.runId, "runId");
    const state = await discordChannelState(ctx, ownerId, channelId);
    if (
      !isCurrentDiscordGeneration(state, runId, args.generation)
      || !state
      || state.activeWindowEnd === undefined
      || state.activeContextHash === undefined
      || state.activeMode === undefined
    ) {
      return { accepted: false as const, reason: "stale_generation" as const };
    }
    const run = await ctx.db
      .query("discordLoopRuns")
      .withIndex("by_owner_run", (index) => index.eq("ownerId", ownerId).eq("runId", runId))
      .unique();
    if (!run) return { accepted: false as const, reason: "run_not_found" as const };
    const now = Date.now();
    const runReplies = await ctx.db
      .query("discordOutbox")
      .withIndex("by_owner_run", (index) => index.eq("ownerId", ownerId).eq("runId", runId))
      .collect();
    const hasPendingReply = runReplies.some((reply) => reply.status === "pending"
      && reply.generation === args.generation);
    const sentFinalReplies = runReplies.filter((reply) => reply.status === "sent"
      && reply.finalizesLoop
      && reply.generation === args.generation);
    const hasSentReply = sentFinalReplies.length > 0;
    if (!activeLease(state, now) && !hasSentReply) {
      return { accepted: false as const, reason: "lease_expired" as const };
    }
    if (args.outcome === "completed" && hasPendingReply) {
      return { accepted: false as const, reason: "pending_outbox" as const };
    }
    if (args.outcome === "error") {
      const error = args.error?.trim() || "Discord agent loop failed.";
      const consecutiveErrorCount = Math.min(
        DISCORD_MAX_LOOP_ERROR_ATTEMPTS,
        (state.consecutiveErrorCount ?? 0) + 1,
      );
      await ctx.db.patch(state._id, {
        status: "error",
        lastError: error,
        consecutiveErrorCount,
        ...clearActiveLoop(),
        updatedAt: now,
      });
      await ctx.db.patch(run._id, {
        status: "error",
        error,
        completedAt: now,
        updatedAt: now,
      });
      await invalidateRunOutbox(ctx, ownerId, runId, error, now);
      await recordActivity(ctx, ownerId, {
        eventId: `${runId}:failed`,
        guildId: state.guildId,
        channelId,
        runId,
        eventType: "loop_failed",
      }, now);
      return {
        accepted: true as const,
        status: "error" as const,
        pendingMessageCount: pendingDiscordMessageCount(state),
        recheckAccepted: false,
      };
    }

    const completedThroughSequence = state.activeMode === "messages"
      ? Math.max(state.completedThroughSequence, state.activeWindowEnd)
      : state.completedThroughSequence;
    const hasPendingMessages = state.triggerThroughSequence > completedThroughSequence;
    const messages = await newestContext(ctx, ownerId, channelId);
    const newestContextHash = discordContextHash(messages);
    const recheckInput: DiscordRecheckInput = {
      requested: sentFinalReplies.length > 0
        ? sentFinalReplies.some((reply) => reply.recheckRequested)
        : args.recheckRequested ?? false,
      recheckCount: state.recheckCount,
      activeContextHash: state.activeContextHash,
      newestContextHash,
    };
    if (state.lastRecheckHash !== undefined) recheckInput.lastRecheckHash = state.lastRecheckHash;
    const recheck = hasPendingMessages
      ? {
          accepted: false,
          nextRecheckCount: state.recheckCount,
          reason: "pending_messages" as const,
        }
      : discordRecheckDecision(recheckInput);
    const recheckPending = recheck.accepted;
    const catchingUp = hasPendingMessages || recheckPending;
    const nextState = catchingUp ? "catching_up" as const : "idle" as const;
    await ctx.db.patch(state._id, {
      status: nextState,
      completedThroughSequence,
      recheckCount: recheck.nextRecheckCount,
      recheckPending,
      lastRecheckHash: recheck.accepted ? newestContextHash : state.lastRecheckHash,
      lastProcessedAt: now,
      lastError: undefined,
      consecutiveErrorCount: 0,
      ...clearActiveLoop(),
      updatedAt: now,
    });
    await ctx.db.patch(run._id, {
      status: "completed",
      completedAt: now,
      updatedAt: now,
    });
    for (const reply of runReplies) {
      if (reply.status === "sent") {
        await ctx.db.patch(reply._id, { status: "finalized", updatedAt: now });
      }
    }
    await recordActivity(ctx, ownerId, {
      eventId: `${runId}:completed`,
      guildId: state.guildId,
      channelId,
      runId,
      eventType: "loop_completed",
    }, now);
    return {
      accepted: true as const,
      status: nextState,
      completedThroughSequence,
      pendingMessageCount: Math.max(0, state.triggerThroughSequence - completedThroughSequence),
      recheckAccepted: recheck.accepted,
      recheckReason: recheck.accepted ? undefined : recheck.reason,
      recheckCount: recheck.nextRecheckCount,
      maxRechecks: DISCORD_MAX_AUTONOMOUS_RECHECKS,
    };
  },
});

export const enqueueReply = internalMutation({
  args: {
    actorId: serviceId,
    sourceChannelId: serviceId,
    guildId: serviceId,
    channelId: serviceId,
    runId: serviceId,
    generation: v.number(),
    idempotencyKey: serviceId,
    replyKind: v.optional(discordReplyKindValidator),
    content: v.string(),
    replyToMessageId: v.optional(serviceId),
    recheckRequested: v.boolean(),
    finalizesLoop: v.boolean(),
  },
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const sourceChannelId = requireDiscordId(args.sourceChannelId, "sourceChannelId");
    const guildId = requireDiscordId(args.guildId, "guildId");
    const channelId = requireDiscordId(args.channelId, "channelId");
    const runId = requireDiscordId(args.runId, "runId");
    const idempotencyKey = requireDiscordId(args.idempotencyKey, "idempotencyKey");
    const replyKind = args.replyKind
      ?? (args.finalizesLoop ? "final" as const : "research_log" as const);
    const content = requireReplyContent(args.content);
    const sourceState = await discordChannelState(ctx, ownerId, sourceChannelId);
    if (!sourceState || !isCurrentDiscordGeneration(sourceState, runId, args.generation)) {
      return { accepted: false as const, reason: "stale_generation" as const };
    }
    if (!activeLease(sourceState, Date.now())) {
      return { accepted: false as const, reason: "lease_expired" as const };
    }
    if (sourceState.guildId !== guildId) {
      return { accepted: false as const, reason: "invalid_reply_target" as const };
    }
    const target = await discordChannel(ctx, ownerId, guildId, channelId);
    if (!target?.available || !target.canSend) {
      return { accepted: false as const, reason: "invalid_reply_target" as const };
    }
    const validTargetRole = discordReplyTargetAllowsKind(
      replyKind,
      sourceChannelId,
      target,
    );
    if (!validTargetRole) return { accepted: false as const, reason: "invalid_reply_target" as const };
    if ((replyKind === "final") !== args.finalizesLoop) {
      return { accepted: false as const, reason: "invalid_reply_kind" as const };
    }
    if (!discordReplyKindMatchesFlags(replyKind, args.finalizesLoop, args.recheckRequested)) {
      return { accepted: false as const, reason: "non_final_reply_cannot_recheck" as const };
    }
    const existing = await ctx.db
      .query("discordOutbox")
      .withIndex("by_owner_idempotency", (index) => index
        .eq("ownerId", ownerId)
        .eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing) {
      const existingReplyKind = existing.replyKind
        ?? (existing.finalizesLoop ? "final" : "research_log");
      const same = existing.sourceChannelId === sourceChannelId
        && existing.guildId === guildId
        && existing.channelId === channelId
        && existing.runId === runId
        && existing.generation === args.generation
        && existingReplyKind === replyKind
        && existing.content === content
        && existing.recheckRequested === args.recheckRequested
        && existing.finalizesLoop === args.finalizesLoop
        && existing.replyToMessageId === args.replyToMessageId;
      if (!same) return { accepted: false as const, reason: "idempotency_conflict" as const };
      return {
        accepted: true as const,
        duplicate: true,
        outboxId: existing.outboxId,
        status: existing.status,
      };
    }
    if (args.finalizesLoop) {
      const runReplies = await ctx.db
        .query("discordOutbox")
        .withIndex("by_owner_run", (index) => index.eq("ownerId", ownerId).eq("runId", runId))
        .collect();
      if (runReplies.some((reply) => reply.generation === args.generation && reply.finalizesLoop)) {
        return { accepted: false as const, reason: "final_reply_already_enqueued" as const };
      }
    }
    const now = Date.now();
    const outboxId = idempotencyKey;
    const outboxRecord: DiscordOutboxRecord = {
      ownerId,
      sourceGuildId: sourceState.guildId,
      sourceChannelId,
      guildId,
      channelId,
      outboxId,
      idempotencyKey,
      runId,
      generation: args.generation,
      replyKind,
      content,
      recheckRequested: args.recheckRequested,
      finalizesLoop: args.finalizesLoop,
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    if (args.replyToMessageId !== undefined) outboxRecord.replyToMessageId = args.replyToMessageId;
    await ctx.db.insert("discordOutbox", outboxRecord);
    await recordActivity(ctx, ownerId, {
      eventId: `${outboxId}:queued`,
      guildId,
      channelId: sourceChannelId,
      runId,
      eventType: "reply_queued",
      replyKind,
    }, now);
    return {
      accepted: true as const,
      duplicate: false,
      outboxId,
      status: "pending" as const,
    };
  },
});

async function ingestAcknowledgedBotReply(
  ctx: DiscordWriter,
  outbox: Doc<"discordOutbox">,
  discordMessageId: string,
  now: number,
): Promise<void> {
  const channel = await discordChannel(ctx, outbox.ownerId, outbox.guildId, outbox.channelId);
  if (!channel?.available || !hasRole(channel, "conversation_monitor")) return;
  const existing = await ctx.db
    .query("discordMessages")
    .withIndex("by_owner_channel_message", (index) => index
      .eq("ownerId", outbox.ownerId)
      .eq("channelId", outbox.channelId)
      .eq("messageId", discordMessageId))
    .unique();
  if (existing) {
    const acknowledgedReply: DiscordMessageIdentity = {
      guildId: outbox.guildId,
      authorId: "discord-bot",
      authorName: "Bot",
      content: outbox.content,
      isBot: true,
      createdAt: now,
    };
    if (outbox.replyToMessageId !== undefined) {
      acknowledgedReply.replyToMessageId = outbox.replyToMessageId;
    }
    if (!discordDuplicateMessageMatches(existing, acknowledgedReply)) {
      throw new Error("Discord acknowledgement conflicts with the stored message.");
    }
    return;
  }
  const state = await discordChannelState(ctx, outbox.ownerId, outbox.channelId);
  if (!state) return;
  const gateway = await ctx.db
    .query("discordGateways")
    .withIndex("by_owner", (index) => index.eq("ownerId", outbox.ownerId))
    .unique();
  const sequence = state.latestSequence + 1;
  const messageRecord: DiscordMessageRecord = {
    ownerId: outbox.ownerId,
    guildId: outbox.guildId,
    channelId: outbox.channelId,
    messageId: discordMessageId,
    sequence,
    authorId: gateway?.botUserId ?? "discord-bot",
    authorName: gateway?.botUserName ?? "Bot",
    content: outbox.content,
    isBot: true,
    createdAt: now,
    receivedAt: now,
  };
  if (outbox.replyToMessageId !== undefined) messageRecord.replyToMessageId = outbox.replyToMessageId;
  await ctx.db.insert("discordMessages", messageRecord);
  await ctx.db.patch(state._id, { latestSequence: sequence, updatedAt: now });
}

export const acknowledgeReply = internalMutation({
  args: {
    actorId: serviceId,
    outboxId: serviceId,
    deliveryToken: serviceId,
    status: v.union(v.literal("sent"), v.literal("failed")),
    discordMessageId: v.optional(serviceId),
    error: v.optional(v.string()),
    retryable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const outboxId = requireDiscordId(args.outboxId, "outboxId");
    const deliveryToken = requireDiscordId(args.deliveryToken, "deliveryToken");
    const outbox = await ctx.db
      .query("discordOutbox")
      .withIndex("by_owner_outbox", (index) => index.eq("ownerId", ownerId).eq("outboxId", outboxId))
      .unique();
    if (!outbox) return { accepted: false as const, reason: "outbox_not_found" as const };
    const now = Date.now();
    if (args.status === "sent") {
      if (!args.discordMessageId) {
        return { accepted: false as const, reason: "discord_message_id_required" as const };
      }
      const discordMessageId = requireDiscordId(args.discordMessageId, "discordMessageId");
      if (outbox.status === "sent" || outbox.status === "finalized") {
        return outbox.discordMessageId === discordMessageId
          ? { accepted: true as const, duplicate: true, status: "sent" as const }
          : { accepted: false as const, reason: "acknowledgement_conflict" as const };
      }
      if (outbox.deliveryToken !== deliveryToken) {
        return { accepted: false as const, reason: "stale_delivery_lease" as const };
      }
      const sourceState = await discordChannelState(ctx, ownerId, outbox.sourceChannelId);
      if (!isCurrentDiscordGeneration(sourceState, outbox.runId, outbox.generation)) {
        return { accepted: false as const, reason: "stale_generation" as const };
      }
      await ctx.db.patch(outbox._id, {
        status: "sent",
        attempts: outbox.attempts + 1,
        discordMessageId,
        lastError: undefined,
        deliveryWorkerId: undefined,
        deliveryToken: undefined,
        deliveryLeaseExpiresAt: undefined,
        sentAt: now,
        updatedAt: now,
      });
      await ingestAcknowledgedBotReply(ctx, outbox, discordMessageId, now);
      await recordActivity(ctx, ownerId, {
        eventId: `${outbox.outboxId}:sent`,
        guildId: outbox.sourceGuildId,
        channelId: outbox.sourceChannelId,
        runId: outbox.runId,
        eventType: "reply_sent",
        replyKind: outbox.replyKind
          ?? (outbox.finalizesLoop ? "final" : "research_log"),
      }, now);
      return { accepted: true as const, duplicate: false, status: "sent" as const };
    }

    if (outbox.status === "sent" || outbox.status === "finalized") {
      return { accepted: false as const, reason: "reply_already_sent" as const };
    }
    if (outbox.deliveryToken !== deliveryToken) {
      return { accepted: false as const, reason: "stale_delivery_lease" as const };
    }
    const sourceState = await discordChannelState(ctx, ownerId, outbox.sourceChannelId);
    if (!isCurrentDiscordGeneration(sourceState, outbox.runId, outbox.generation)) {
      return { accepted: false as const, reason: "stale_generation" as const };
    }
    const attempts = outbox.attempts + 1;
    const retryable = (args.retryable ?? false) && attempts < DISCORD_MAX_OUTBOX_ATTEMPTS;
    const status = retryable ? "pending" as const : "failed" as const;
    await ctx.db.patch(outbox._id, {
      status,
      attempts,
      lastError: args.error?.trim() || "Discord reply delivery failed.",
      deliveryWorkerId: undefined,
      deliveryToken: undefined,
      deliveryLeaseExpiresAt: undefined,
      updatedAt: now,
    });
    await recordActivity(ctx, ownerId, {
      eventId: `${outbox.outboxId}:failed:${attempts}`,
      guildId: outbox.sourceGuildId,
      channelId: outbox.sourceChannelId,
      runId: outbox.runId,
      eventType: "reply_failed",
      replyKind: outbox.replyKind
        ?? (outbox.finalizesLoop ? "final" : "research_log"),
    }, now);
    return { accepted: true as const, duplicate: false, status, attempts };
  },
});

export const listRunnable = internalMutation({
  args: { actorId: serviceId, workerId: serviceId, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const workerId = requireDiscordId(args.workerId, "workerId");
    const limit = Math.max(1, Math.min(50, Math.trunc(args.limit ?? 20)));
    const now = Date.now();
    const states = await ctx.db
      .query("discordChannelStates")
      .withIndex("by_owner_status_updatedAt", (index) => index.eq("ownerId", ownerId))
      .collect();
    const channels = [];
    for (const state of states.sort((left, right) => left.updatedAt - right.updatedAt)) {
      const leaseExpired = state.activeRunId !== undefined
        && state.leaseExpiresAt !== undefined
        && state.leaseExpiresAt <= now;
      const retryableError = discordLoopErrorRetryReady(state, now);
      const runnable = (!state.activeRunId || leaseExpired)
        && (state.status !== "error" || retryableError)
        && (state.triggerThroughSequence > state.completedThroughSequence
          || state.recheckPending
          || (leaseExpired && state.activeMode === "recheck"));
      if (!runnable) continue;
      if (leaseExpired && state.activeRunId !== undefined) {
        const runReplies = await ctx.db
          .query("discordOutbox")
          .withIndex("by_owner_run", (index) => index
            .eq("ownerId", ownerId)
            .eq("runId", state.activeRunId!))
          .collect();
        if (hasSentDiscordFinalizer(runReplies, state.activeRunId, state.generation)) continue;
      }
      const channel = await discordChannel(ctx, ownerId, state.guildId, state.channelId);
      if (!channel?.available || !hasRole(channel, "conversation_monitor")) continue;
      if (retryableError && state.consecutiveErrorCount === undefined) {
        await ctx.db.patch(state._id, { consecutiveErrorCount: 1 });
      }
      channels.push({
        guildId: state.guildId,
        channelId: state.channelId,
        status: state.status,
        pendingMessageCount: pendingDiscordMessageCount(state),
        leaseExpired,
        updatedAt: state.updatedAt,
      });
      if (channels.length >= limit) break;
    }

    const pendingReplies = await ctx.db
      .query("discordOutbox")
      .withIndex("by_owner_status_createdAt", (index) => index
        .eq("ownerId", ownerId)
        .eq("status", "pending"))
      .order("asc")
      .collect();
    const sentReplies = await ctx.db
      .query("discordOutbox")
      .withIndex("by_owner_status_createdAt", (index) => index
        .eq("ownerId", ownerId)
        .eq("status", "sent"))
      .order("asc")
      .collect();
    const replies: RunnableOutboxReply[] = [];
    for (const reply of [...pendingReplies, ...sentReplies]
      .sort((left, right) => left.createdAt - right.createdAt)) {
      const state = await discordChannelState(ctx, ownerId, reply.sourceChannelId);
      if (!isCurrentDiscordGeneration(state, reply.runId, reply.generation)) continue;
      if (reply.status === "sent") {
        if (!reply.finalizesLoop) continue;
        if (hasPendingDiscordReply(pendingReplies, reply.runId, reply.generation)) continue;
        replies.push({ reply });
        if (replies.length >= limit) break;
        continue;
      }
      if (!state || !activeLease(state, now)) continue;
      const deliveryLeaseActive = reply.deliveryToken !== undefined
        && reply.deliveryLeaseExpiresAt !== undefined
        && reply.deliveryLeaseExpiresAt > now;
      if (deliveryLeaseActive && reply.deliveryWorkerId !== workerId) continue;
      let deliveryToken = reply.deliveryToken;
      if (!deliveryLeaseActive || deliveryToken === undefined) {
        deliveryToken = discordDeliveryToken(workerId, reply.outboxId, reply.attempts + 1, now);
        await ctx.db.patch(reply._id, {
          deliveryWorkerId: workerId,
          deliveryToken,
          deliveryLeaseExpiresAt: now + DISCORD_OUTBOX_DELIVERY_LEASE_MS,
          updatedAt: now,
        });
      }
      replies.push({ reply, deliveryToken });
      if (replies.length >= limit) break;
    }
    return {
      channels,
      replies: replies.map(({ reply, deliveryToken }) => ({
        outboxId: reply.outboxId,
        sourceGuildId: reply.sourceGuildId,
        sourceChannelId: reply.sourceChannelId,
        guildId: reply.guildId,
        channelId: reply.channelId,
        runId: reply.runId,
        generation: reply.generation,
        status: reply.status === "sent" ? "sent" as const : "pending" as const,
        content: reply.content,
        replyToMessageId: reply.replyToMessageId,
        recheckRequested: reply.recheckRequested,
        finalizesLoop: reply.finalizesLoop,
        discordMessageId: reply.discordMessageId,
        deliveryToken,
        attempts: reply.attempts,
        createdAt: reply.createdAt,
      })),
    };
  },
});
