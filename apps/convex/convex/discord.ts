import { v } from "convex/values";
import { z } from "zod";
import type { Doc } from "./_generated/dataModel.js";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import { actorFromIdentity, requireAllowedWorkosUserId } from "./lib/auth.js";
import { canonicalJson, sha256Hex } from "./lib/canonical_json.js";
import {
  normalizeDiscordForumCapabilities,
  projectPreNativeCheckpointRequest,
} from "./lib/discord_contract.js";
import { isMarketResearchForumIngress } from "./lib/market_research.js";
import {
  checkpointUtf8Bytes,
  nativeCheckpointView,
  restoreNativeCompaction,
  validateNativeCompaction,
  type NativeCheckpointView,
  type StoredNativeCompaction,
} from "./lib/discord_native_checkpoint.js";
import {
  DISCORD_AMBIENT_COOLDOWN_MS,
  DISCORD_AMBIENT_DEBOUNCE_MS,
  DISCORD_CONTEXT_SIZE,
  DISCORD_GATEWAY_HEARTBEAT_TTL_MS,
  DISCORD_LOOP_LEASE_MS,
  DISCORD_MAX_AUTONOMOUS_RECHECKS,
  DISCORD_MAX_OUTBOX_ATTEMPTS,
  DISCORD_OUTBOX_DELIVERY_LEASE_MS,
  discordClaimDecision,
  discordContextHash,
  discordDeliveryToken,
  discordDuplicateMessageMatches,
  discordMessageIngestDecision,
  discordLoopErrorRetryReady,
  discordNextLoopErrorCount,
  discordRecheckDecision,
  discordReplyKindMatchesFlags,
  discordReplyTargetAllowsKind,
  discordTrailingContextStart,
  normalizeDiscordChannelRoles,
  pendingDiscordMessageCount,
  hasPendingDiscordReply,
  hasSentDiscordFinalizer,
  isDeliveredDiscordAcknowledgement,
  isCurrentDiscordGeneration,
  resolveDiscordChannelRouting,
  type DiscordChannelRole,
  type DiscordImageAttachment,
  type DiscordMessageIdentity,
  type DiscordMessageContext,
  type DiscordRecheckInput,
  type DiscordTriggerKind,
} from "./lib/discord_state.js";
import {
  DISCORD_CONVERSATION_LEASE_MS,
  DISCORD_COMPACTION_THRESHOLD_TOKENS,
  DISCORD_MAX_RECENT_EVENT_COUNT,
  DISCORD_PERSONALITY_PROFILE,
  DISCORD_RECENT_TAIL_ESTIMATOR_VERSION,
  DISCORD_RECENT_TAIL_TOKEN_BUDGET,
  discordConversationId,
  discordConversationLeaseToken,
  discordPrivacyDeletionBlocked,
  discordSnowflakeUpperBound,
  isCurrentDiscordConversationFence,
  portableCheckpointRestorable,
  portableCheckpointSourceBatchSupported,
  selectDiscordCheckpointSourceBatch,
  portableConversationSummarySchema,
  portableSummaryEvidenceMatchesEvents,
  estimateDiscordCanonicalEventTokens,
  requireDiscordReplyContent,
  selectDiscordCanonicalTail,
  selectDiscordCheckpointTail,
  validatePortableCheckpointCandidate,
  DISCORD_PORTABLE_CHECKPOINT_MAX_BYTES,
  DISCORD_PORTABLE_CHECKPOINT_RETENTION_MS,
} from "./lib/discord_conversation.js";
import {
  discordChannelRoleValidator,
  discordChannelTypeValidator,
  discordImageAttachmentValidator,
  discordMarketChartValidator,
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
  canCreateForumPost: v.optional(v.boolean()),
  canSendInThreads: v.optional(v.boolean()),
  canReadThreadHistory: v.optional(v.boolean()),
  canAttachFiles: v.optional(v.boolean()),
  requiresTag: v.optional(v.boolean()),
  availableTags: v.optional(v.array(v.object({
    id: v.string(),
    name: v.string(),
    moderated: v.boolean(),
    emoji: v.optional(v.string()),
  }))),
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
  parentChannelId: v.optional(serviceId),
  messageId: serviceId,
  authorId: serviceId,
  authorName: v.string(),
  content: v.string(),
  images: v.optional(v.array(discordImageAttachmentValidator)),
  mentionsBot: v.boolean(),
  isBot: v.boolean(),
  replyToMessageId: v.optional(v.string()),
  nonce: v.optional(v.string()),
  payloadHash: v.optional(v.string()),
  createdAt: v.number(),
});
const loopStageValidator = v.union(
  v.literal("triaging"),
  v.literal("acknowledging"),
  v.literal("researching"),
  v.literal("drafting"),
  v.literal("catching_up"),
);
const durableStageFenceValidator = v.object({
  sourceChannelId: serviceId,
  runId: serviceId,
  channelGeneration: v.number(),
  conversationId: serviceId,
  epoch: v.number(),
  conversationGeneration: v.number(),
  routingGeneration: v.number(),
  turnId: serviceId,
  conversationLeaseToken: serviceId,
});
const DISCORD_ACTIVITY_HISTORY_PER_GUILD = 20;
const DISCORD_ACTIVITY_RETENTION_LIMIT = 500;
const DISCORD_NONCE_RETRY_WINDOW_MS = 5 * 60_000;

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
type DiscordAssistantConversationRecord = Omit<
  Doc<"discordAssistantConversations">,
  "_id" | "_creationTime"
>;
type DiscordConversationEventRecord = Omit<
  Doc<"discordConversationEvents">,
  "_id" | "_creationTime"
>;
type DiscordResearchArtifactPatch = Partial<Omit<
  Doc<"discordResearchArtifacts">,
  "_id" | "_creationTime"
>>;
type DiscordAssistantTurnPatch = Partial<Omit<
  Doc<"discordAssistantTurns">,
  "_id" | "_creationTime"
>>;
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

interface DiscordGuildRoutingView {
  conversationChannelId?: string;
  researchLogChannelId?: string;
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

interface DurableRecentEvent {
  eventId: string;
  ordinal: number;
  role: "human" | "assistant";
  authorId?: string;
  displayName?: string;
  content: string;
  createdAt: string;
}

interface DurableConversationTail {
  estimatorVersion: string;
  tokenBudget: number;
  estimatedTokens: number;
  compactedThroughOrdinal: number;
  omittedEventCount: number;
  complete: boolean;
  firstRetainedOrdinal?: number;
  lastRetainedOrdinal?: number;
}

interface DurableConversationContextView {
  sourceRevision: number;
  sourceHumanRevision: number;
  activeCheckpointId?: string;
  activeCheckpointSourceRevision?: number;
  activeCheckpointSourceContextHash?: string;
  activeCheckpointCompactedThroughOrdinal?: number;
  portableSummary?: z.infer<typeof portableConversationSummarySchema>;
  nativeCheckpoint?: NativeCheckpointView;
  recentEvents: DurableRecentEvent[];
  tail: DurableConversationTail;
}

interface PortableCheckpointSourceEventView {
  eventId: string;
  ordinal: number;
  role: "human" | "assistant";
  authorId?: string;
  displayName?: string;
  content: string;
  createdAt: string;
  freshness?: "current" | "limited" | "unknown";
}

interface PortableCheckpointConversationView {
  ownerId: string;
  ownerBindingVersion: number;
  guildId: string;
  conversationId: string;
  epoch: number;
  generation: number;
  routingGeneration: number;
  revision: number;
  personalityVersion: string;
  systemPromptHash: string;
  capabilityProfileHash: string;
  activeCheckpointId?: string;
  activeCheckpointSourceRevision?: number;
  activeCheckpointSourceContextHash?: string;
  activeCheckpointCompactedThroughOrdinal?: number;
}

interface PortableCheckpointRequestView {
  profile: "portable_checkpoint";
  requestId: string;
  conversation: PortableCheckpointConversationView;
  sourceContextHash: string;
  compactedThroughOrdinal: number;
  previousSummary?: z.infer<typeof portableConversationSummarySchema>;
  previousNativeCheckpoint?: NativeCheckpointView;
  sourceEvents: PortableCheckpointSourceEventView[];
  retainedRecentEventIds: string[];
  inputEstimatedTokens: number;
}

interface PublicConversationIdentityView {
  ownerId: string;
  ownerBindingVersion: number;
  guildId: string;
  conversationId: string;
  epoch: number;
  turnId: string;
  runId: string;
  generation: number;
  routingGeneration: number;
  revision: number;
  humanRevision: number;
  personalityVersion: string;
  systemPromptHash: string;
  capabilityProfileHash: string;
  activeCheckpointId?: string;
}

interface DurableRecoveryResearchView {
  requestId: string;
  normalizedRequest: string;
  status: Doc<"discordResearchArtifacts">["status"];
  packet?: string;
  failureCode?: string;
  failureDetail?: string;
  failureRetryable?: boolean;
  freshness?: string;
  sourceUrls: string[];
  trustedChartArtifactId?: string;
  trustedChartSpec?: string;
  serializedBytes: number;
  estimatedTokens: number;
  tokenEstimatorVersion: string;
}

interface DurableTurnRecoveryView {
  stage: Doc<"discordAssistantTurns">["stage"];
  planPayload?: string;
  resumePayload?: string;
  resumeRequestId?: string;
  acknowledgementDelivery?: string;
  eligibleThroughSequence?: number;
  eligibleHumanRevision?: number;
  eligibleContextHash?: string;
  nextExplicitTriggerSequence?: number;
  research?: DurableRecoveryResearchView;
}

const serializedJsonObjectSchema = z.record(z.string(), z.json());

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

function requireSerializedJson(value: string, maximumBytes: number, label: string): string {
  const normalized = value.trim();
  const bytes = new TextEncoder().encode(normalized).byteLength;
  if (!normalized || bytes > maximumBytes) throw new Error(`${label} is invalid.`);
  const parsed = serializedJsonObjectSchema.safeParse(JSON.parse(normalized));
  if (!parsed.success) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return normalized;
}

function requireDiscordImages(
  images: readonly DiscordImageAttachment[] | undefined,
): DiscordImageAttachment[] | undefined {
  if (images === undefined) return undefined;
  if (images.length === 0 || images.length > 4) {
    throw new Error("Discord image attachments are invalid.");
  }
  return images.map((image) => {
    const url = new URL(image.url);
    const hostname = url.hostname.toLowerCase();
    const width = image.width;
    const height = image.height;
    if (
      url.protocol !== "https:"
      || url.username !== ""
      || url.password !== ""
      || url.port !== ""
      || !["cdn.discordapp.com", "media.discordapp.net"].includes(hostname)
      || !url.pathname.startsWith("/attachments/")
      || !/^\d{1,32}$/.test(image.attachmentId)
      || image.sizeBytes <= 0
      || image.sizeBytes > 8 * 1_024 * 1_024
      || !image.filename.trim()
      || image.filename.length > 200
      || (width !== undefined && (!Number.isSafeInteger(width) || width <= 0 || width > 8_192))
      || (height !== undefined && (!Number.isSafeInteger(height) || height <= 0 || height > 8_192))
      || (width !== undefined && height !== undefined && width * height > 25_000_000)
    ) {
      throw new Error("Discord image attachment is invalid.");
    }
    const result: DiscordImageAttachment = {
      attachmentId: requireDiscordId(image.attachmentId, "attachmentId"),
      url: url.toString(),
      filename: image.filename.trim(),
      mediaType: image.mediaType,
      sizeBytes: image.sizeBytes,
    };
    if (width !== undefined) result.width = width;
    if (height !== undefined) result.height = height;
    return result;
  });
}

const MARKET_CHART_INTERVALS = [
  "1m", "3m", "5m", "10m", "15m", "30m", "45m", "1h", "2h", "3h",
  "4h", "6h", "8h", "12h", "1D", "2D", "3D", "1W", "1M", "3M", "6M",
  "1Y",
] as const;
const MARKET_CHART_RANGES = [
  "1D", "5D", "1M", "3M", "6M", "1Y", "5Y", "ALL", "DTD", "WTD", "MTD",
  "YTD",
] as const;
const MARKET_CHART_STYLES = ["candle", "line", "area"] as const;
type MarketChartInterval = (typeof MARKET_CHART_INTERVALS)[number];
type MarketChartRange = (typeof MARKET_CHART_RANGES)[number];
type MarketChartStyle = (typeof MARKET_CHART_STYLES)[number];

interface NormalizedMarketChart {
  symbol: string;
  title?: string;
  points: Array<{ timestamp: number; close: number }>;
  tradingViewSymbol?: string;
  interval?: MarketChartInterval;
  range?: MarketChartRange;
  style?: MarketChartStyle;
  includeVolume?: boolean;
}

function requireMarketChart(chart: {
  symbol: string;
  title?: string;
  points: Array<{ timestamp: number; close: number }>;
  tradingViewSymbol?: string;
  interval?: MarketChartInterval;
  range?: MarketChartRange;
  style?: MarketChartStyle;
  includeVolume?: boolean;
} | undefined) {
  if (chart === undefined) return undefined;
  const symbol = chart.symbol.trim().toUpperCase();
  const title = chart.title?.trim();
  const tradingViewSymbol = chart.tradingViewSymbol?.trim().toUpperCase();
  if (
    !/^[A-Z0-9.^=-]{1,20}$/.test(symbol)
    || (title !== undefined && (!title || title.length > 64))
    || (
      tradingViewSymbol !== undefined
      && !/^[A-Z0-9._!^-]{1,24}:[A-Z0-9._!^=-]{1,32}$/.test(
        tradingViewSymbol,
      )
    )
    || (
      chart.interval !== undefined
      && !MARKET_CHART_INTERVALS.includes(chart.interval)
    )
    || (
      chart.range !== undefined
      && !MARKET_CHART_RANGES.includes(chart.range)
    )
    || (
      chart.style !== undefined
      && !MARKET_CHART_STYLES.includes(chart.style)
    )
    || (chart.interval !== undefined && chart.range !== undefined)
    || (
      tradingViewSymbol === undefined
      && (
        chart.interval !== undefined
        || chart.range !== undefined
        || chart.style !== undefined
        || chart.includeVolume !== undefined
      )
    )
    || chart.points.length < 2
    || chart.points.length > 240
    || chart.points.some((point, index) => {
      const previous = chart.points[index - 1];
      return !Number.isSafeInteger(point.timestamp)
        || point.timestamp < 0
        || !Number.isFinite(point.close)
        || point.close < 0
        || (previous !== undefined && point.timestamp <= previous.timestamp);
    })
  ) {
    throw new Error("Discord market chart is invalid.");
  }
  const points = chart.points.map((point) => ({ ...point }));
  const result: NormalizedMarketChart = { symbol, points };
  if (title !== undefined) result.title = title;
  if (tradingViewSymbol !== undefined) {
    result.tradingViewSymbol = tradingViewSymbol;
  }
  if (chart.interval !== undefined) result.interval = chart.interval;
  if (chart.range !== undefined) result.range = chart.range;
  if (chart.style !== undefined) result.style = chart.style;
  if (chart.includeVolume !== undefined) {
    result.includeVolume = chart.includeVolume;
  }
  return result;
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

async function discordHistoryAfterMessageId(
  ctx: DiscordReader,
  ownerId: string,
  guildId: string,
  channelId: string,
): Promise<string | null> {
  const latestMessage = await ctx.db
    .query("discordMessages")
    .withIndex("by_owner_channel_sequence", (index) => index
      .eq("ownerId", ownerId)
      .eq("channelId", channelId))
    .order("desc")
    .first();
  if (latestMessage !== null) return latestMessage.messageId;
  const conversation = await assistantConversationByGuild(ctx, guildId);
  return conversation?.ownerId === ownerId
    ? conversation.privacyReconciliationAfterMessageId ?? null
    : null;
}

async function assistantConversationByGuild(
  ctx: DiscordReader,
  guildId: string,
): Promise<Doc<"discordAssistantConversations"> | null> {
  return ctx.db
    .query("discordAssistantConversations")
    .withIndex("by_guild", (index) => index.eq("guildId", guildId))
    .unique();
}

async function ensureAssistantConversation(
  ctx: DiscordWriter & DiscordReader,
  ownerId: string,
  guildId: string,
  now: number,
  options: {
    conversationChannelId?: string;
    researchLogChannelId?: string;
    migrationWatermarkSequence?: number;
  } = {},
): Promise<Doc<"discordAssistantConversations">> {
  const existing = await assistantConversationByGuild(ctx, guildId);
  if (existing !== null) {
    if (existing.ownerId !== ownerId) {
      throw new Error("Discord guild is already bound to another owner.");
    }
    return existing;
  }
  const conversationId = discordConversationId(guildId);
  const record: DiscordAssistantConversationRecord = {
    ownerId,
    ownerBindingVersion: 1,
    guildId,
    conversationId,
    epoch: 0,
    generation: 0,
    routingGeneration: 1,
    revision: 0,
    humanRevision: 0,
    nextOrdinal: 1,
    ...DISCORD_PERSONALITY_PROFILE,
    migrationWatermarkSequence: options.migrationWatermarkSequence ?? 0,
    createdAt: now,
    updatedAt: now,
  };
  if (options.conversationChannelId !== undefined) {
    record.conversationChannelId = options.conversationChannelId;
  }
  if (options.researchLogChannelId !== undefined) {
    record.researchLogChannelId = options.researchLogChannelId;
  }
  const id = await ctx.db.insert("discordAssistantConversations", record);
  const created = await ctx.db.get(id);
  if (created === null) throw new Error("Discord conversation could not be created.");
  return created;
}

export async function canonicalCheckpointSlice(
  ctx: DiscordReader,
  conversation: Doc<"discordAssistantConversations">,
  compactedThroughOrdinal: number,
) {
  const events = (await ctx.db
    .query("discordConversationEvents")
    .withIndex("by_conversation_epoch_ordinal", (index) => index
      .eq("conversationId", conversation.conversationId)
      .eq("epoch", conversation.epoch))
    .order("asc")
    .collect())
    .filter((event) => event.status === "committed"
      && event.ordinal <= compactedThroughOrdinal);
  const sourceContextHash = await sha256Hex(canonicalJson(events.map((event) => ({
    eventId: event.eventId,
    ordinal: event.ordinal,
    revision: event.revision,
    humanRevision: event.humanRevision,
    kind: event.kind,
    visibility: event.visibility,
    sourceChannelId: event.sourceChannelId ?? null,
    sourceMessageId: event.sourceMessageId ?? null,
    sourceSequence: event.sourceSequence ?? null,
    authorId: event.authorId ?? null,
    authorName: event.authorName ?? null,
    content: event.content ?? null,
    discordDeliveryId: event.discordDeliveryId ?? null,
    freshness: event.freshness ?? null,
    contextHash: event.contextHash,
  }))));
  return { events, sourceContextHash };
}

export async function durableConversationContext(
  ctx: DiscordWriter & DiscordReader,
  conversation: Doc<"discordAssistantConversations">,
  now: number,
  requiredSourceMessageIds: readonly string[] = [],
) {
  let portableSummary: z.infer<typeof portableConversationSummarySchema> | undefined;
  let nativeCheckpoint: NativeCheckpointView | undefined;
  let activeCheckpointId: string | undefined;
  let activeCheckpointSourceRevision: number | undefined;
  let activeCheckpointSourceContextHash: string | undefined;
  let compactedThroughOrdinal = 0;
  if (conversation.activeCheckpointId !== undefined) {
    const checkpoint = await ctx.db
      .query("discordCompactionCheckpoints")
      .withIndex("by_owner_checkpoint", (index) => index
        .eq("ownerId", conversation.ownerId)
        .eq("checkpointId", conversation.activeCheckpointId!))
      .unique();
    if (
      checkpoint !== null
      && portableCheckpointRestorable(checkpoint, {
        ...conversation,
        model: conversation.lunaModel,
      }, now)
      && checkpoint.serializedBytes <= DISCORD_PORTABLE_CHECKPOINT_MAX_BYTES
    ) {
      try {
        if (checkpointUtf8Bytes(checkpoint.portableSummary) > DISCORD_PORTABLE_CHECKPOINT_MAX_BYTES) {
          throw new Error("Portable checkpoint stored size exceeds the boundary.");
        }
        const parsedSummary = portableConversationSummarySchema.parse(
          JSON.parse(checkpoint.portableSummary),
        );
        const canonicalSlice = await canonicalCheckpointSlice(
          ctx,
          conversation,
          checkpoint.compactedThroughOrdinal,
        );
        if (
          canonicalSlice.sourceContextHash !== checkpoint.sourceContextHash
          || !portableSummaryEvidenceMatchesEvents(parsedSummary, canonicalSlice.events)
        ) {
          throw new Error("Portable checkpoint source evidence is not canonical.");
        }
        portableSummary = parsedSummary;
        if (checkpoint.nativeCompaction !== undefined) {
          try {
            const artifact = await restoreNativeCompaction(checkpoint.nativeCompaction, checkpoint.portableSummary);
            if (checkpoint.serializedBytes !== checkpointUtf8Bytes(checkpoint.portableSummary) + artifact.serializedBytes) {
              throw new Error("Native checkpoint stored size mismatch.");
            }
            nativeCheckpoint = nativeCheckpointView(checkpoint, artifact);
          } catch {
            // A valid portable summary remains usable if the optional opaque artifact is corrupt.
            await ctx.db.patch(checkpoint._id, {
              nativeCompaction: undefined,
              serializedBytes: checkpointUtf8Bytes(checkpoint.portableSummary),
              updatedAt: now,
            });
          }
        } else if (checkpoint.serializedBytes !== checkpointUtf8Bytes(checkpoint.portableSummary)) {
          throw new Error("Portable checkpoint stored size mismatch.");
        }
        activeCheckpointId = checkpoint.checkpointId;
        activeCheckpointSourceRevision = checkpoint.sourceRevision;
        activeCheckpointSourceContextHash = checkpoint.sourceContextHash;
        compactedThroughOrdinal = checkpoint.compactedThroughOrdinal;
      } catch {
        portableSummary = undefined;
        nativeCheckpoint = undefined;
        await ctx.db.patch(checkpoint._id, { status: "invalid", nativeCompaction: undefined, updatedAt: now });
        await ctx.db.patch(conversation._id, { activeCheckpointId: undefined, updatedAt: now });
      }
    } else {
      if (checkpoint !== null && checkpoint.status === "active") {
        await ctx.db.patch(checkpoint._id, {
          status: checkpoint.expiresAt <= now ? "expired" : "invalid",
          nativeCompaction: undefined,
          updatedAt: now,
        });
      }
      await ctx.db.patch(conversation._id, { activeCheckpointId: undefined, updatedAt: now });
    }
  }
  const events = await ctx.db
    .query("discordConversationEvents")
    .withIndex("by_conversation_epoch_ordinal", (index) => index
      .eq("conversationId", conversation.conversationId)
      .eq("epoch", conversation.epoch))
    .order("asc")
    .collect();
  const canonicalEvents = events
    .filter((event) => event.visibility === "conversation"
      && event.status === "committed"
      && event.ordinal > compactedThroughOrdinal
      && event.content !== undefined
      && (event.kind === "human_message"
        || event.kind === "assistant_ack"
        || event.kind === "assistant_final"));
  const requiredSources = new Set(requiredSourceMessageIds);
  const requiredEventIds = new Set(canonicalEvents
    .filter((event) => event.sourceMessageId !== undefined
      && requiredSources.has(event.sourceMessageId))
    .map((event) => event.eventId));
  const selection = selectDiscordCanonicalTail(canonicalEvents.map((event) => ({
    event,
    eventId: event.eventId,
    ordinal: event.ordinal,
    content: event.content!,
  })), {
    requiredEventIds,
    maximumEvents: DISCORD_MAX_RECENT_EVENT_COUNT,
    tokenBudget: activeCheckpointId === undefined
      ? DISCORD_COMPACTION_THRESHOLD_TOKENS
      : DISCORD_RECENT_TAIL_TOKEN_BUDGET,
  });
  const recentEvents: DurableRecentEvent[] = selection.events
    .map((event) => {
      const recentEvent: DurableRecentEvent = {
        eventId: event.event.eventId,
        ordinal: event.event.ordinal,
        role: event.event.kind === "human_message" ? "human" as const : "assistant" as const,
        content: event.event.content!,
        createdAt: new Date(event.event.createdAt).toISOString(),
      };
      if (event.event.authorId !== undefined) recentEvent.authorId = event.event.authorId;
      if (event.event.authorName !== undefined) recentEvent.displayName = event.event.authorName;
      return recentEvent;
    });
  const tail: DurableConversationTail = {
    estimatorVersion: DISCORD_RECENT_TAIL_ESTIMATOR_VERSION,
    tokenBudget: activeCheckpointId === undefined
      ? DISCORD_COMPACTION_THRESHOLD_TOKENS
      : DISCORD_RECENT_TAIL_TOKEN_BUDGET,
    estimatedTokens: selection.estimatedTokens,
    compactedThroughOrdinal,
    omittedEventCount: selection.omittedEventCount,
    complete: selection.complete,
  };
  if (selection.firstRetainedOrdinal !== undefined) {
    tail.firstRetainedOrdinal = selection.firstRetainedOrdinal;
  }
  if (selection.lastRetainedOrdinal !== undefined) {
    tail.lastRetainedOrdinal = selection.lastRetainedOrdinal;
  }
  const context: DurableConversationContextView = {
    sourceRevision: conversation.revision,
    sourceHumanRevision: conversation.humanRevision,
    recentEvents,
    tail,
  };
  if (activeCheckpointId !== undefined) context.activeCheckpointId = activeCheckpointId;
  if (activeCheckpointSourceRevision !== undefined) context.activeCheckpointSourceRevision = activeCheckpointSourceRevision;
  if (activeCheckpointSourceContextHash !== undefined) context.activeCheckpointSourceContextHash = activeCheckpointSourceContextHash;
  if (activeCheckpointId !== undefined) context.activeCheckpointCompactedThroughOrdinal = compactedThroughOrdinal;
  if (portableSummary !== undefined) context.portableSummary = portableSummary;
  if (nativeCheckpoint !== undefined) context.nativeCheckpoint = nativeCheckpoint;
  return context;
}

export async function stagedCheckpointContext(
  ctx: DiscordWriter & DiscordReader,
  conversation: Doc<"discordAssistantConversations">,
  now: number,
): Promise<DurableConversationContextView | undefined> {
  if (conversation.candidateCheckpointId === undefined) return undefined;
  const checkpoint = await ctx.db.query("discordCompactionCheckpoints")
    .withIndex("by_owner_checkpoint", (index) => index
      .eq("ownerId", conversation.ownerId).eq("checkpointId", conversation.candidateCheckpointId!))
    .unique();
  try {
    if (
      checkpoint === null
      || !portableCheckpointRestorable(checkpoint, { ...conversation, model: conversation.lunaModel }, now, "candidate")
      || checkpoint.sourceRevision !== conversation.revision
      || checkpoint.sourceGeneration !== conversation.generation
      || checkpoint.sourceRoutingGeneration !== conversation.routingGeneration
      || checkpoint.compactedThroughOrdinal >= conversation.nextOrdinal
    ) throw new Error("Staged checkpoint identity changed.");
    const summary = portableConversationSummarySchema.parse(JSON.parse(checkpoint.portableSummary));
    const canonicalSlice = await canonicalCheckpointSlice(ctx, conversation, checkpoint.compactedThroughOrdinal);
    if (canonicalSlice.sourceContextHash !== checkpoint.sourceContextHash
      || !portableSummaryEvidenceMatchesEvents(summary, canonicalSlice.events)) {
      throw new Error("Staged checkpoint source changed.");
    }
    const context: DurableConversationContextView = {
      sourceRevision: conversation.revision,
      sourceHumanRevision: conversation.humanRevision,
      portableSummary: summary,
      recentEvents: [],
      tail: {
        estimatorVersion: DISCORD_RECENT_TAIL_ESTIMATOR_VERSION,
        tokenBudget: DISCORD_RECENT_TAIL_TOKEN_BUDGET,
        estimatedTokens: 0,
        compactedThroughOrdinal: checkpoint.compactedThroughOrdinal,
        omittedEventCount: 0,
        complete: false,
      },
    };
    let actualBytes = checkpointUtf8Bytes(checkpoint.portableSummary);
    if (checkpoint.nativeCompaction !== undefined) {
      const artifact = await restoreNativeCompaction(checkpoint.nativeCompaction, checkpoint.portableSummary);
      actualBytes += artifact.serializedBytes;
      context.nativeCheckpoint = nativeCheckpointView(checkpoint, artifact);
    }
    if (actualBytes !== checkpoint.serializedBytes || actualBytes > DISCORD_PORTABLE_CHECKPOINT_MAX_BYTES) {
      throw new Error("Staged checkpoint size changed.");
    }
    return context;
  } catch {
    if (checkpoint !== null) await ctx.db.patch(checkpoint._id, {
      status: checkpoint.expiresAt <= now ? "expired" : "invalid", nativeCompaction: undefined, updatedAt: now,
    });
    await ctx.db.patch(conversation._id, { candidateCheckpointId: undefined, updatedAt: now });
    return undefined;
  }
}

function publicConversationIdentity(
  conversation: Doc<"discordAssistantConversations">,
  turnId: string,
  runId: string,
) {
  const identity: PublicConversationIdentityView = {
    ownerId: conversation.ownerId,
    ownerBindingVersion: conversation.ownerBindingVersion,
    guildId: conversation.guildId,
    conversationId: conversation.conversationId,
    epoch: conversation.epoch,
    turnId,
    runId,
    generation: conversation.generation,
    routingGeneration: conversation.routingGeneration,
    revision: conversation.revision,
    humanRevision: conversation.humanRevision,
    personalityVersion: conversation.personalityVersion,
    systemPromptHash: conversation.systemPromptHash,
    capabilityProfileHash: conversation.capabilityProfileHash,
  };
  if (conversation.activeCheckpointId !== undefined) {
    identity.activeCheckpointId = conversation.activeCheckpointId;
  }
  return identity;
}

interface DurableStageFenceInput {
  sourceChannelId: string;
  runId: string;
  channelGeneration: number;
  conversationId: string;
  epoch: number;
  conversationGeneration: number;
  routingGeneration: number;
  turnId: string;
  conversationLeaseToken: string;
}

async function durableStageState(
  ctx: DiscordWriter & DiscordReader,
  ownerId: string,
  guildId: string,
  fence: DurableStageFenceInput,
  now: number,
): Promise<{
  conversation: Doc<"discordAssistantConversations">;
  turn: Doc<"discordAssistantTurns">;
} | null> {
  const sourceChannelId = requireDiscordId(fence.sourceChannelId, "sourceChannelId");
  const runId = requireDiscordId(fence.runId, "runId");
  const turnId = requireDiscordId(fence.turnId, "turnId");
  const sourceState = await discordChannelState(ctx, ownerId, sourceChannelId);
  const conversation = await assistantConversationByGuild(ctx, guildId);
  if (
    sourceState === null
    || !isCurrentDiscordGeneration(sourceState, runId, fence.channelGeneration)
    || !activeLease(sourceState, now)
    || !isCurrentDiscordConversationFence(conversation, {
      ownerId,
      ownerBindingVersion: conversation?.ownerBindingVersion ?? -1,
      conversationId: requireDiscordId(fence.conversationId, "conversationId"),
      epoch: fence.epoch,
      generation: fence.conversationGeneration,
      routingGeneration: fence.routingGeneration,
      turnId,
      runId,
      leaseToken: requireDiscordId(fence.conversationLeaseToken, "conversationLeaseToken"),
    }, now)
  ) return null;
  const turn = await ctx.db
    .query("discordAssistantTurns")
    .withIndex("by_owner_turn", (index) => index
      .eq("ownerId", ownerId)
      .eq("turnId", turnId))
    .unique();
  if (
    turn === null
    || conversation === null
    || turn.ownerBindingVersion !== conversation.ownerBindingVersion
    || turn.guildId !== guildId
    || turn.conversationId !== conversation.conversationId
    || turn.epoch !== conversation.epoch
    || turn.runId !== runId
    || turn.conversationGeneration !== conversation.generation
    || turn.routingGeneration !== conversation.routingGeneration
  ) return null;
  return { conversation, turn };
}

async function appendInternalConversationEvent(
  ctx: DiscordWriter & DiscordReader,
  conversation: Doc<"discordAssistantConversations">,
  input: {
    eventId: string;
    turnId: string;
    runId: string;
    kind: "internal_plan" | "research_started" | "research_completed" | "research_failed";
    contextHash: string;
    researchArtifactId?: string;
  },
  now: number,
): Promise<boolean> {
  const existing = await ctx.db
    .query("discordConversationEvents")
    .withIndex("by_owner_event", (index) => index
      .eq("ownerId", conversation.ownerId)
      .eq("eventId", input.eventId))
    .unique();
  if (existing !== null) return false;
  const revision = conversation.revision + 1;
  const eventRecord: DiscordConversationEventRecord = {
    ownerId: conversation.ownerId,
    ownerBindingVersion: conversation.ownerBindingVersion,
    guildId: conversation.guildId,
    conversationId: conversation.conversationId,
    epoch: conversation.epoch,
    eventId: input.eventId,
    ordinal: conversation.nextOrdinal,
    revision,
    humanRevision: conversation.humanRevision,
    turnId: input.turnId,
    runId: input.runId,
    kind: input.kind,
    visibility: "internal",
    status: "committed",
    contextHash: input.contextHash,
    createdAt: now,
    committedAt: now,
    updatedAt: now,
  };
  if (input.researchArtifactId !== undefined) {
    eventRecord.researchArtifactId = input.researchArtifactId;
  }
  await ctx.db.insert("discordConversationEvents", eventRecord);
  await ctx.db.patch(conversation._id, {
    revision,
    nextOrdinal: conversation.nextOrdinal + 1,
    updatedAt: now,
  });
  return true;
}

async function durableTurnRecoveryPayload(
  ctx: DiscordReader,
  turn: Doc<"discordAssistantTurns">,
) {
  const artifacts = await ctx.db
    .query("discordResearchArtifacts")
    .withIndex("by_conversation_epoch_turn", (index) => index
      .eq("conversationId", turn.conversationId)
      .eq("epoch", turn.epoch)
      .eq("turnId", turn.turnId))
    .collect();
  const artifact = artifacts.sort((left, right) => right.updatedAt - left.updatedAt)[0];
  const replies = await ctx.db
    .query("discordOutbox")
    .withIndex("by_owner_run", (index) => index
      .eq("ownerId", turn.ownerId)
      .eq("runId", turn.runId))
    .collect();
  const acknowledgement = replies.find((reply) =>
    (reply.replyKind ?? (reply.finalizesLoop ? "final" : "research_log"))
      === "acknowledgement"
  );
  const acknowledgementDelivery = acknowledgement === undefined
    ? turn.acknowledgementDelivery
    : acknowledgement.status === "sent" || acknowledgement.status === "finalized"
      ? "sent" as const
      : acknowledgement.status === "delivery_uncertain"
        || acknowledgement.status === "needs_reconciliation"
        ? "uncertain" as const
        : "pending" as const;
  const recovery: DurableTurnRecoveryView = {
    stage: turn.stage,
  };
  if (turn.planPayload !== undefined) recovery.planPayload = turn.planPayload;
  if (turn.resumePayload !== undefined) recovery.resumePayload = turn.resumePayload;
  if (turn.resumeRequestId !== undefined) recovery.resumeRequestId = turn.resumeRequestId;
  if (acknowledgementDelivery !== undefined) {
    recovery.acknowledgementDelivery = acknowledgementDelivery;
  }
  if (turn.eligibleThroughSequence !== undefined) {
    recovery.eligibleThroughSequence = turn.eligibleThroughSequence;
  }
  if (turn.eligibleHumanRevision !== undefined) {
    recovery.eligibleHumanRevision = turn.eligibleHumanRevision;
  }
  if (turn.eligibleContextHash !== undefined) {
    recovery.eligibleContextHash = turn.eligibleContextHash;
  }
  if (turn.nextExplicitTriggerSequence !== undefined) {
    recovery.nextExplicitTriggerSequence = turn.nextExplicitTriggerSequence;
  }
  if (artifact !== undefined) {
    const research: DurableRecoveryResearchView = {
      requestId: artifact.requestId,
      normalizedRequest: artifact.normalizedResearchRequest,
      status: artifact.status,
      sourceUrls: artifact.sourceUrls,
      serializedBytes: artifact.serializedBytes,
      estimatedTokens: artifact.estimatedTokens,
      tokenEstimatorVersion: artifact.tokenEstimatorVersion,
    };
    if (artifact.packet !== undefined) research.packet = artifact.packet;
    if (artifact.failureCode !== undefined) research.failureCode = artifact.failureCode;
    if (artifact.failureDetail !== undefined) research.failureDetail = artifact.failureDetail;
    if (artifact.failureRetryable !== undefined) {
      research.failureRetryable = artifact.failureRetryable;
    }
    if (artifact.freshness !== undefined) research.freshness = artifact.freshness;
    if (artifact.trustedChartArtifactId !== undefined) {
      research.trustedChartArtifactId = artifact.trustedChartArtifactId;
    }
    if (artifact.trustedChartSpec !== undefined) {
      research.trustedChartSpec = artifact.trustedChartSpec;
    }
    recovery.research = research;
  }
  return recovery;
}

async function resetAssistantConversation(
  ctx: DiscordWriter & DiscordReader,
  conversation: Doc<"discordAssistantConversations">,
  now: number,
  reason: "owner_reset" | "ownership_transfer",
): Promise<number> {
  const oldEpoch = conversation.epoch;
  if (conversation.activeTurnId !== undefined) {
    const turn = await ctx.db
      .query("discordAssistantTurns")
      .withIndex("by_owner_turn", (index) => index
        .eq("ownerId", conversation.ownerId)
        .eq("turnId", conversation.activeTurnId!))
      .unique();
    if (turn !== null && !["completed", "suppressed", "failed", "cancelled"].includes(turn.stage)) {
      await ctx.db.patch(turn._id, {
        stage: "cancelled",
        failureCode: reason,
        completedAt: now,
        updatedAt: now,
      });
    }
  }
  if (conversation.activeRunId !== undefined) {
    const run = await ctx.db
      .query("discordLoopRuns")
      .withIndex("by_owner_run", (index) => index
        .eq("ownerId", conversation.ownerId)
        .eq("runId", conversation.activeRunId!))
      .unique();
    if (run !== null && !["completed", "error", "stale"].includes(run.status)) {
      await ctx.db.patch(run._id, {
        status: "stale",
        error: reason,
        completedAt: now,
        updatedAt: now,
      });
    }
  }
  const outbox = await ctx.db
    .query("discordOutbox")
    .withIndex("by_conversation_epoch", (index) => index
      .eq("conversationId", conversation.conversationId)
      .eq("epoch", oldEpoch))
    .collect();
  for (const reply of outbox) {
    if (reply.status === "pending") {
      await ctx.db.patch(reply._id, {
        status: "cancelled",
        lastError: reason,
        deliveryWorkerId: undefined,
        deliveryToken: undefined,
        deliveryLeaseExpiresAt: undefined,
        updatedAt: now,
      });
    } else if (reply.status === "delivery_uncertain") {
      await ctx.db.patch(reply._id, {
        status: "needs_reconciliation",
        lastError: reason,
        deliveryWorkerId: undefined,
        deliveryToken: undefined,
        deliveryLeaseExpiresAt: undefined,
        updatedAt: now,
      });
      await recordActivity(ctx, conversation.ownerId, {
        eventId: `${reply.outboxId}:delivery-reconciliation-required`,
        guildId: reply.sourceGuildId,
        channelId: reply.sourceChannelId,
        runId: reply.runId,
        eventType: "delivery_reconciliation_required",
        replyKind: reply.replyKind
          ?? (reply.finalizesLoop ? "final" : "research_log"),
      }, now);
    }
    if (reply.canonicalEventId !== undefined) {
      const event = await ctx.db
        .query("discordConversationEvents")
        .withIndex("by_owner_event", (index) => index
          .eq("ownerId", conversation.ownerId)
          .eq("eventId", reply.canonicalEventId!))
        .unique();
      if (event !== null && event.status === "pending") {
        await ctx.db.patch(event._id, { status: "failed", updatedAt: now });
      }
    }
  }
  const checkpoints = await ctx.db.query("discordCompactionCheckpoints")
    .withIndex("by_conversation_epoch_status", (index) => index.eq("conversationId", conversation.conversationId))
    .collect();
  for (const checkpoint of checkpoints) {
    if (checkpoint.ownerId !== conversation.ownerId) continue;
    await ctx.db.patch(checkpoint._id, {
      nativeCompaction: undefined,
      status: checkpoint.status === "active" || checkpoint.status === "candidate" ? "superseded" : checkpoint.status,
      updatedAt: now,
    });
  }
  await ctx.db.insert("discordConversationEvents", {
    ownerId: conversation.ownerId,
    ownerBindingVersion: conversation.ownerBindingVersion,
    guildId: conversation.guildId,
    conversationId: conversation.conversationId,
    epoch: oldEpoch,
    eventId: `${conversation.conversationId}:${oldEpoch}:reset:${conversation.generation + 1}`,
    ordinal: conversation.nextOrdinal,
    revision: conversation.revision + 1,
    humanRevision: conversation.humanRevision,
    kind: "reset",
    visibility: "internal",
    status: "committed",
    contextHash: discordContextHash([]),
    createdAt: now,
    committedAt: now,
    updatedAt: now,
  });
  const channelState = conversation.conversationChannelId === undefined
    ? null
    : await discordChannelState(ctx, conversation.ownerId, conversation.conversationChannelId);
  if (channelState !== null) {
    await ctx.db.patch(channelState._id, {
      generation: channelState.generation + 1,
      status: "idle",
      triggerThroughSequence: channelState.latestSequence,
      completedThroughSequence: channelState.latestSequence,
      recheckCount: 0,
      recheckPending: false,
      ...clearActiveLoop(),
      updatedAt: now,
    });
  }
  const newEpoch = oldEpoch + 1;
  await ctx.db.patch(conversation._id, {
    epoch: newEpoch,
    generation: conversation.generation + 1,
    routingGeneration: conversation.routingGeneration + 1,
    revision: 0,
    humanRevision: 0,
    nextOrdinal: 1,
    activeTurnId: undefined,
    activeRunId: undefined,
    activeLeaseToken: undefined,
    activeLeaseWorkerId: undefined,
    leaseExpiresAt: undefined,
    activeCheckpointId: undefined,
    candidateCheckpointId: undefined,
    migrationWatermarkSequence: channelState?.latestSequence
      ?? conversation.migrationWatermarkSequence,
    updatedAt: now,
  });
  return newEpoch;
}

function toMessageContext(message: Doc<"discordMessages">): DiscordMessageContext {
  const context: DiscordMessageContext = {
    messageId: message.messageId,
    sequence: message.sequence,
    authorId: message.authorId,
    authorName: message.authorName,
    content: message.content,
    mentionsBot: message.mentionsBot ?? false,
    isBot: message.isBot,
    createdAt: message.createdAt,
  };
  if (message.images !== undefined) context.images = message.images;
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
  preferSource = false,
) {
  const channels = await ctx.db
    .query("discordChannels")
    .withIndex("by_owner_guild_available_name", (index) => index
      .eq("ownerId", ownerId)
      .eq("guildId", guildId)
      .eq("available", true))
    .collect();
  const routing = resolveDiscordChannelRouting(sourceChannelId, channels);
  const source = channels.find((channel) => channel.channelId === sourceChannelId);
  return preferSource && source?.canSend
    ? { ...routing, replyChannelId: sourceChannelId }
    : routing;
}

function triggerKindForWindow(
  mode: "messages" | "recheck",
  windowStart: number,
  messages: readonly DiscordMessageContext[],
): DiscordTriggerKind {
  if (mode === "recheck") return "recheck";
  return messages.some((message) =>
    message.sequence >= windowStart && !message.isBot && message.mentionsBot
  )
    ? "mention"
    : "ambient";
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
  ctx: DiscordWriter & DiscordReader,
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
    } else if (reply.status === "delivery_uncertain") {
      await ctx.db.patch(reply._id, {
        status: "needs_reconciliation",
        lastError: error,
        deliveryWorkerId: undefined,
        deliveryToken: undefined,
        deliveryLeaseExpiresAt: undefined,
        updatedAt: now,
      });
    } else if (reply.status === "sent") {
      await ctx.db.patch(reply._id, { status: "finalized", updatedAt: now });
    }
    if (reply.canonicalEventId !== undefined && reply.status === "pending") {
      const event = await ctx.db
        .query("discordConversationEvents")
        .withIndex("by_owner_event", (index) => index
          .eq("ownerId", ownerId)
          .eq("eventId", reply.canonicalEventId!))
        .unique();
      if (event !== null && event.status === "pending") {
        await ctx.db.patch(event._id, { status: "failed", updatedAt: now });
      }
    }
  }
}

async function applyChannelRoles(
  ctx: DiscordWriter,
  ownerId: string,
  guildId: string,
  channel: Doc<"discordChannels">,
  roles: DiscordChannelRole[],
  now: number,
): Promise<void> {
  const wasMonitored = hasRole(channel, "conversation_monitor");
  const isMonitored = roles.includes("conversation_monitor");
  await ctx.db.patch(channel._id, { roles, updatedAt: now });
  let state = await discordChannelState(ctx, ownerId, channel.channelId);
  if (!state && isMonitored) {
    const stateId = await ctx.db.insert("discordChannelStates", {
      ownerId,
      guildId,
      channelId: channel.channelId,
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
  if (state && !wasMonitored && isMonitored) {
    await ctx.db.patch(state._id, {
      generation: state.generation + 1,
      status: "idle",
      triggerThroughSequence: state.latestSequence,
      completedThroughSequence: state.latestSequence,
      recheckCount: 0,
      recheckPending: false,
      lastRecheckHash: undefined,
      nextEligibleAt: undefined,
      lastError: undefined,
      consecutiveErrorCount: 0,
      ...clearActiveLoop(),
      updatedAt: now,
    });
  }
  if (!state || !wasMonitored || isMonitored) return;
  if (state.activeRunId !== undefined) {
    const run = await ctx.db
      .query("discordLoopRuns")
      .withIndex("by_owner_run", (index) => index
        .eq("ownerId", ownerId)
        .eq("runId", state.activeRunId!))
      .unique();
    if (run && !["completed", "error", "stale"].includes(run.status)) {
      await ctx.db.patch(run._id, { status: "stale", completedAt: now, updatedAt: now });
    }
    await invalidateRunOutbox(
      ctx,
      ownerId,
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
    nextEligibleAt: undefined,
    lastError: undefined,
    ...clearActiveLoop(),
    updatedAt: now,
  });
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
        const assistantConversation = await assistantConversationByGuild(ctx, guild.guildId);
        const channels = await ctx.db
          .query("discordChannels")
          .withIndex("by_owner_guild_available_name", (index) => index
            .eq("ownerId", actor.id)
            .eq("guildId", guild.guildId)
            .eq("available", true))
          .collect();
        const conversationChannelId = channels.find((channel) =>
          hasRole(channel, "conversation_monitor") && hasRole(channel, "reply_target")
        )?.channelId;
        const researchLogChannelId = channels.find((channel) =>
          hasRole(channel, "research_log")
        )?.channelId;
        const routing: DiscordGuildRoutingView = {};
        if (conversationChannelId !== undefined) {
          routing.conversationChannelId = conversationChannelId;
        }
        if (researchLogChannelId !== undefined) {
          routing.researchLogChannelId = researchLogChannelId;
        }
        return {
          guildId: guild.guildId,
          name: guild.name,
          iconUrl: guild.iconUrl,
          permissions: guild.permissions,
          routing,
          conversation: assistantConversation?.ownerId === actor.id
            ? {
                conversationId: assistantConversation.conversationId,
                epoch: assistantConversation.epoch,
                revision: assistantConversation.revision,
                humanRevision: assistantConversation.humanRevision,
                personalityVersion: assistantConversation.personalityVersion,
                models: {
                  luna: {
                    model: assistantConversation.lunaModel,
                    reasoningEffort: assistantConversation.lunaReasoningEffort,
                    serviceTier: assistantConversation.lunaServiceTier,
                  },
                  sol: {
                    model: assistantConversation.solModel,
                    reasoningEffort: assistantConversation.solReasoningEffort,
                    serviceTier: assistantConversation.solServiceTier,
                  },
                },
                lastSuccessfulActivityAt: assistantConversation.lastSuccessfulActivityAt,
              }
            : undefined,
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
              ...normalizeDiscordForumCapabilities(channel),
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
    await applyChannelRoles(ctx, actor.id, guildId, channel, roles, now);
    return { guildId, channelId, roles, updatedAt: now };
  },
});

export const setGuildRouting = mutation({
  args: {
    guildId: v.string(),
    conversationChannelId: v.union(v.string(), v.null()),
    researchLogChannelId: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const guildId = requireDiscordId(args.guildId, "guildId");
    const conversationChannelId = args.conversationChannelId === null
      ? null
      : requireDiscordId(args.conversationChannelId, "conversationChannelId");
    const researchLogChannelId = args.researchLogChannelId === null
      ? null
      : requireDiscordId(args.researchLogChannelId, "researchLogChannelId");
    if (
      conversationChannelId !== null
      && conversationChannelId === researchLogChannelId
    ) {
      throw new Error("Discord conversation and research-log channels must be different.");
    }
    const channels = await ctx.db
      .query("discordChannels")
      .withIndex("by_owner_guild_available_name", (index) => index
        .eq("ownerId", actor.id)
        .eq("guildId", guildId))
      .collect();
    const conversation = conversationChannelId === null ? undefined : channels.find((channel) =>
      channel.available && channel.channelId === conversationChannelId
    );
    const researchLog = researchLogChannelId === null ? undefined : channels.find((channel) =>
      channel.available && channel.channelId === researchLogChannelId
    );
    if (conversationChannelId !== null && !conversation) {
      throw new Error("Discord conversation channel not found.");
    }
    if (researchLogChannelId !== null && !researchLog) {
      throw new Error("Discord research-log channel not found.");
    }
    if (conversation && (!conversation.canView || !conversation.canReadHistory || !conversation.canSend)) {
      throw new Error("Discord conversation channel permissions are incomplete.");
    }
    if (researchLog && (!researchLog.canView || !researchLog.canSend)) {
      throw new Error("Discord research-log channel permissions are incomplete.");
    }

    const now = Date.now();
    const existingConversation = await assistantConversationByGuild(ctx, guildId);
    if (existingConversation !== null && existingConversation.ownerId !== actor.id) {
      throw new Error("Discord guild is already bound to another owner.");
    }
    for (const channel of channels) {
      const roles: DiscordChannelRole[] = [];
      if (channel.channelId === conversationChannelId) {
        roles.push("conversation_monitor", "reply_target");
      }
      if (channel.channelId === researchLogChannelId) roles.push("research_log");
      await applyChannelRoles(ctx, actor.id, guildId, channel, roles, now);
    }
    let durableConversation = existingConversation;
    if (conversationChannelId !== null) {
      const state = await discordChannelState(ctx, actor.id, conversationChannelId);
      const options: Parameters<typeof ensureAssistantConversation>[4] = {
        conversationChannelId,
        migrationWatermarkSequence: state?.latestSequence ?? 0,
      };
      if (researchLogChannelId !== null) options.researchLogChannelId = researchLogChannelId;
      durableConversation ??= await ensureAssistantConversation(
        ctx,
        actor.id,
        guildId,
        now,
        options,
      );
    }
    if (durableConversation !== null) {
      const routeChanged = durableConversation.conversationChannelId !== conversationChannelId
        || durableConversation.researchLogChannelId !== researchLogChannelId;
      if (routeChanged) {
        const surfaceChanged = durableConversation.conversationChannelId !== undefined
          && durableConversation.conversationChannelId !== conversationChannelId;
        const revision = durableConversation.revision + (surfaceChanged ? 1 : 0);
        const routingGeneration = durableConversation.routingGeneration + 1;
        if (durableConversation.activeTurnId !== undefined) {
          const activeTurn = await ctx.db
            .query("discordAssistantTurns")
            .withIndex("by_owner_turn", (index) => index
              .eq("ownerId", actor.id)
              .eq("turnId", durableConversation!.activeTurnId!))
            .unique();
          if (activeTurn !== null && !["completed", "suppressed", "failed", "cancelled"].includes(activeTurn.stage)) {
            await ctx.db.patch(activeTurn._id, {
              stage: "cancelled",
              failureCode: "routing_changed",
              completedAt: now,
              updatedAt: now,
            });
          }
        }
        if (surfaceChanged) {
          const sourceSurfaceChannelId = conversationChannelId
            ?? durableConversation.conversationChannelId;
          const surfaceEvent: DiscordConversationEventRecord = {
            ownerId: actor.id,
            ownerBindingVersion: durableConversation.ownerBindingVersion,
            guildId,
            conversationId: durableConversation.conversationId,
            epoch: durableConversation.epoch,
            eventId: `${durableConversation.conversationId}:${durableConversation.epoch}:surface:${routingGeneration}`,
            ordinal: durableConversation.nextOrdinal,
            revision,
            humanRevision: durableConversation.humanRevision,
            kind: "surface_changed",
            visibility: "internal",
            status: "committed",
            contextHash: discordContextHash([]),
            createdAt: now,
            committedAt: now,
            updatedAt: now,
          };
          if (sourceSurfaceChannelId !== undefined) {
            surfaceEvent.sourceChannelId = sourceSurfaceChannelId;
          }
          await ctx.db.insert("discordConversationEvents", surfaceEvent);
        }
        await ctx.db.patch(durableConversation._id, {
          conversationChannelId: conversationChannelId ?? undefined,
          researchLogChannelId: researchLogChannelId ?? undefined,
          routingGeneration,
          generation: durableConversation.generation + 1,
          revision,
          nextOrdinal: durableConversation.nextOrdinal + (surfaceChanged ? 1 : 0),
          activeTurnId: undefined,
          activeRunId: undefined,
          activeLeaseToken: undefined,
          activeLeaseWorkerId: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
        });
        durableConversation = await ctx.db.get(durableConversation._id);
      }
    }
    return {
      guildId,
      conversationChannelId,
      researchLogChannelId,
      conversationId: durableConversation?.conversationId,
      epoch: durableConversation?.epoch,
      routingGeneration: durableConversation?.routingGeneration,
      updatedAt: now,
    };
  },
});

export const resetGuildConversation = mutation({
  args: {
    guildId: v.string(),
    confirmGuildId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const guildId = requireDiscordId(args.guildId, "guildId");
    if (requireDiscordId(args.confirmGuildId, "confirmGuildId") !== guildId) {
      throw new Error("Reset confirmation must name the Discord guild.");
    }
    const conversation = await assistantConversationByGuild(ctx, guildId);
    if (conversation === null || conversation.ownerId !== actor.id) {
      throw new Error("Discord conversation not found.");
    }
    const now = Date.now();
    const epoch = await resetAssistantConversation(ctx, conversation, now, "owner_reset");
    return {
      guildId,
      conversationId: conversation.conversationId,
      epoch,
      generation: conversation.generation + 1,
      routingGeneration: conversation.routingGeneration + 1,
      resetAt: now,
    };
  },
});

export const deleteGuildConversationPrivacyData = mutation({
  args: {
    guildId: v.string(),
    confirmGuildId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const guildId = requireDiscordId(args.guildId, "guildId");
    if (requireDiscordId(args.confirmGuildId, "confirmGuildId") !== guildId) {
      throw new Error("Privacy-deletion confirmation must name the Discord guild.");
    }
    const conversation = await assistantConversationByGuild(ctx, guildId);
    if (conversation === null || conversation.ownerId !== actor.id) {
      throw new Error("Discord conversation not found.");
    }
    const now = Date.now();
    const ownerOutbox = await ctx.db.query("discordOutbox")
      .withIndex("by_owner_status_createdAt", (index) => index.eq("ownerId", actor.id))
      .collect();
    if (discordPrivacyDeletionBlocked(guildId, ownerOutbox)) {
      throw new Error(
        "Privacy deletion is blocked until uncertain Discord delivery is reconciled.",
      );
    }
    const epoch = await resetAssistantConversation(
      ctx,
      conversation,
      now,
      "owner_reset",
    );
    const ownerMessages = await ctx.db.query("discordMessages")
      .withIndex("by_owner_nonce", (index) => index.eq("ownerId", actor.id))
      .collect();
    const ownerChannelStates = await ctx.db.query("discordChannelStates")
      .withIndex("by_owner_channel", (index) => index.eq("ownerId", actor.id))
      .collect();
    const ownerRuns = await ctx.db.query("discordLoopRuns")
      .withIndex("by_owner_run", (index) => index.eq("ownerId", actor.id))
      .collect();
    const ownerActivity = await ctx.db.query("discordActivityEvents")
      .withIndex("by_owner_createdAt", (index) => index.eq("ownerId", actor.id))
      .collect();
    const tables = await Promise.all([
      ctx.db.query("discordConversationEvents")
        .withIndex("by_conversation_epoch_ordinal", (index) => index
          .eq("conversationId", conversation.conversationId))
        .collect(),
      ctx.db.query("discordAssistantTurns")
        .withIndex("by_conversation_epoch_stage", (index) => index
          .eq("conversationId", conversation.conversationId))
        .collect(),
      ctx.db.query("discordResearchArtifacts")
        .withIndex("by_conversation_epoch_turn", (index) => index
          .eq("conversationId", conversation.conversationId))
        .collect(),
      ctx.db.query("discordCompactionCheckpoints")
        .withIndex("by_conversation_epoch_status", (index) => index
          .eq("conversationId", conversation.conversationId))
        .collect(),
      Promise.resolve(ownerMessages.filter((message) => message.guildId === guildId)),
      Promise.resolve(ownerChannelStates.filter((state) => state.guildId === guildId)),
      Promise.resolve(ownerRuns.filter((run) => run.guildId === guildId)),
      Promise.resolve(ownerOutbox.filter((reply) =>
        reply.guildId === guildId || reply.sourceGuildId === guildId
      )),
      Promise.resolve(ownerActivity.filter((event) => event.guildId === guildId)),
    ]);
    for (const documents of tables) {
      for (const document of documents) await ctx.db.delete(document._id);
    }
    await ctx.db.patch(conversation._id, {
      revision: 0,
      humanRevision: 0,
      nextOrdinal: 1,
      activeTurnId: undefined,
      activeRunId: undefined,
      activeLeaseToken: undefined,
      activeLeaseWorkerId: undefined,
      leaseExpiresAt: undefined,
      activeCheckpointId: undefined,
      migrationWatermarkSequence: 0,
      privacyDeletedAt: now,
      privacyReconciliationAfterMessageId: discordSnowflakeUpperBound(now),
      updatedAt: now,
    });
    return {
      guildId,
      conversationId: conversation.conversationId,
      deletedRecords: tables.reduce((count, documents) => count + documents.length, 0),
      epoch,
      deletedAt: now,
    };
  },
});

export const transferGuildConversationOwnership = mutation({
  args: {
    guildId: v.string(),
    newOwnerId: v.string(),
    policy: v.literal("reset"),
  },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const guildId = requireDiscordId(args.guildId, "guildId");
    const newOwnerId = requireDiscordOwnerId(args.newOwnerId);
    const conversation = await assistantConversationByGuild(ctx, guildId);
    if (conversation === null || conversation.ownerId !== actor.id) {
      throw new Error("Discord conversation not found.");
    }
    if (newOwnerId === actor.id) throw new Error("Discord guild is already owned by this actor.");
    const now = Date.now();
    const epoch = await resetAssistantConversation(
      ctx,
      conversation,
      now,
      "ownership_transfer",
    );
    await ctx.db.patch(conversation._id, {
      ownerId: newOwnerId,
      ownerBindingVersion: conversation.ownerBindingVersion + 1,
      updatedAt: now,
    });
    return {
      guildId,
      conversationId: conversation.conversationId,
      epoch,
      ownerBindingVersion: conversation.ownerBindingVersion + 1,
      policy: args.policy,
      transferredAt: now,
    };
  },
});

export const migrateResearchModelToAstra = internalMutation({
  args: { actorId: serviceId },
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const conversations = await ctx.db.query("discordAssistantConversations")
      .withIndex("by_owner_guild", (index) => index.eq("ownerId", ownerId))
      .collect();
    let updated = 0;
    let alreadyAstra = 0;
    for (const conversation of conversations) {
      if (conversation.solModel === "gpt-5.6-sol") {
        // Only the active research-model metadata changes. Existing conversation
        // fences, reasoning settings, checkpoints, and historical artifacts remain intact.
        await ctx.db.patch(conversation._id, { solModel: "gpt-6-astra" });
        updated += 1;
      } else if (conversation.solModel === "gpt-6-astra") {
        alreadyAstra += 1;
      }
    }
    return {
      scanned: conversations.length,
      updated,
      alreadyAstra,
      unchanged: conversations.length - updated - alreadyAstra,
    };
  },
});

export const nextPortableCheckpoint = internalMutation({
  args: { actorId: serviceId, nativeCompactionSupported: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const conversations = await ctx.db
      .query("discordAssistantConversations")
      .withIndex("by_owner_guild", (index) => index.eq("ownerId", ownerId))
      .collect();
    const unresolvedDeliveries = await Promise.all(
      (["delivery_uncertain", "needs_reconciliation"] as const).map((status) => ctx.db
        .query("discordOutbox")
        .withIndex("by_owner_status_createdAt", (index) => index
          .eq("ownerId", ownerId)
          .eq("status", status))
        .collect()),
    );
    const blockedGuildIds = new Set(unresolvedDeliveries.flat().flatMap((reply) => [
      reply.guildId,
      reply.sourceGuildId,
    ]));
    const now = Date.now();

    for (const conversation of conversations.toSorted((left, right) => left.updatedAt - right.updatedAt)) {
      if (
        conversation.activeTurnId !== undefined
        || conversation.leaseExpiresAt !== undefined
        || blockedGuildIds.has(conversation.guildId)
      ) continue;
      const active = await durableConversationContext(ctx, conversation, now);
      const staged = args.nativeCompactionSupported === true
        ? await stagedCheckpointContext(ctx, conversation, now)
        : undefined;
      const restored = staged ?? active;
      // Staged opaque artifacts have no independent active lineage on the wire. Until that
      // contract exists, staged progress carries the verified readable summary only.
      const previousNativeCheckpoint = args.nativeCompactionSupported === true && staged === undefined
        ? active.nativeCheckpoint
        : undefined;
      const compactedThroughOrdinal = restored.tail.compactedThroughOrdinal;
      const events = await ctx.db
        .query("discordConversationEvents")
        .withIndex("by_conversation_epoch_ordinal", (index) => index
          .eq("conversationId", conversation.conversationId)
          .eq("epoch", conversation.epoch))
        .order("asc")
        .collect();
      const visibleEvents = events
        .filter((event) => event.visibility === "conversation"
          && event.status === "committed"
          && event.ordinal > compactedThroughOrdinal
          && event.content !== undefined
          && (event.kind === "human_message"
            || event.kind === "assistant_ack"
            || event.kind === "assistant_final"))
        .map((event) => ({
          event,
          eventId: event.eventId,
          ordinal: event.ordinal,
          content: event.content!,
        }));
      const previousSummaryTokens = restored.portableSummary === undefined
        ? 0
        : Math.ceil(new TextEncoder().encode(JSON.stringify(restored.portableSummary)).byteLength / 3) + 8;
      const previousNativeTokens = previousNativeCheckpoint === undefined
        ? 0
        : Math.ceil(previousNativeCheckpoint.artifact.serializedBytes / 3) + 8;
      // Portable generation consumes the readable summary; native generation consumes
      // the opaque predecessor instead. Bound each call without double-counting them.
      const previousCallTokens = Math.max(previousSummaryTokens, previousNativeTokens);
      const currentEstimatedTokens = previousSummaryTokens
        + visibleEvents.reduce((total, event) => total + estimateDiscordCanonicalEventTokens(event), 0);
      if (staged === undefined && currentEstimatedTokens < DISCORD_COMPACTION_THRESHOLD_TOKENS) continue;

      const tail = selectDiscordCheckpointTail(visibleEvents, {
        tokenBudget: DISCORD_RECENT_TAIL_TOKEN_BUDGET,
        maximumEvents: DISCORD_MAX_RECENT_EVENT_COUNT,
      });
      if (tail.complete || tail.events.length === 0) continue;
      const retainedRecentEventIds = tail.events.map((event) => event.eventId);
      const previousContextBytes = checkpointUtf8Bytes(JSON.stringify({
        previousSummary: restored.portableSummary,
        previousNativeCheckpoint,
        retainedRecentEventIds,
      }));
      const allSourceEvents = visibleEvents.slice(0, visibleEvents.length - tail.events.length);
      if (args.nativeCompactionSupported !== true && !portableCheckpointSourceBatchSupported(allSourceEvents.length)) continue;
      const sourceEvents = args.nativeCompactionSupported === true ? selectDiscordCheckpointSourceBatch(visibleEvents, tail.events.length, {
        // Reserve the exact previous artifacts and retained IDs, plus bounded identity/hash metadata.
        maximumBytes: Math.min(900_000, 1_500_000 - previousContextBytes - 8_192),
        tokenBudget: DISCORD_COMPACTION_THRESHOLD_TOKENS - previousCallTokens,
      }) : allSourceEvents;
      const lastSourceEvent = sourceEvents.at(-1);
      if (lastSourceEvent === undefined) continue;
      const sourceSlice = await canonicalCheckpointSlice(
        ctx,
        conversation,
        lastSourceEvent.ordinal,
      );
      const checkpointId = [
        "checkpoint",
        conversation.guildId,
        conversation.epoch,
        conversation.revision,
        sourceSlice.sourceContextHash.slice(0, 16),
      ].join(":");
      const checkpointConversation: PortableCheckpointConversationView = {
        ownerId,
        ownerBindingVersion: conversation.ownerBindingVersion,
        guildId: conversation.guildId,
        conversationId: conversation.conversationId,
        epoch: conversation.epoch,
        generation: conversation.generation,
        routingGeneration: conversation.routingGeneration,
        revision: conversation.revision,
        personalityVersion: conversation.personalityVersion,
        systemPromptHash: conversation.systemPromptHash,
        capabilityProfileHash: conversation.capabilityProfileHash,
      };
      if (active.activeCheckpointId !== undefined) {
        checkpointConversation.activeCheckpointId = active.activeCheckpointId;
        checkpointConversation.activeCheckpointSourceRevision = active.activeCheckpointSourceRevision!;
        checkpointConversation.activeCheckpointSourceContextHash = active.activeCheckpointSourceContextHash!;
        checkpointConversation.activeCheckpointCompactedThroughOrdinal = active.activeCheckpointCompactedThroughOrdinal!;
      }
      const checkpointSourceEvents: PortableCheckpointSourceEventView[] = sourceEvents.map(
        ({ event }) => {
          const sourceEvent: PortableCheckpointSourceEventView = {
            eventId: event.eventId,
            ordinal: event.ordinal,
            role: event.kind === "human_message" ? "human" : "assistant",
            content: event.content!,
            createdAt: new Date(event.createdAt).toISOString(),
          };
          if (event.authorId !== undefined) sourceEvent.authorId = event.authorId;
          if (event.authorName !== undefined) sourceEvent.displayName = event.authorName;
          if (event.freshness !== undefined) sourceEvent.freshness = event.freshness;
          return sourceEvent;
        },
      );
      const request: PortableCheckpointRequestView = {
        profile: "portable_checkpoint" as const,
        requestId: checkpointId,
        conversation: checkpointConversation,
        sourceContextHash: sourceSlice.sourceContextHash,
        compactedThroughOrdinal: lastSourceEvent.ordinal,
        sourceEvents: checkpointSourceEvents,
        retainedRecentEventIds,
        inputEstimatedTokens: previousSummaryTokens + sourceEvents.reduce(
          (total, event) => total + estimateDiscordCanonicalEventTokens(event),
          0,
        ),
      };
      if (restored.portableSummary !== undefined) {
        request.previousSummary = restored.portableSummary;
      }
      if (previousNativeCheckpoint !== undefined) {
        request.previousNativeCheckpoint = previousNativeCheckpoint;
      }
      if (new TextEncoder().encode(JSON.stringify(request)).byteLength > 1_500_000) continue;
      return {
        available: true as const,
        request: args.nativeCompactionSupported === true ? request : projectPreNativeCheckpointRequest(request),
      };
    }
    return { available: false as const };
  },
});

export const storePortableCheckpoint = internalMutation({
  args: {
    actorId: serviceId,
    guildId: serviceId,
    conversationId: serviceId,
    epoch: v.number(),
    expectedRevision: v.number(),
    expectedGeneration: v.number(),
    expectedRoutingGeneration: v.number(),
    checkpointId: serviceId,
    sourceContextHash: v.string(),
    toolPolicyHash: v.string(),
    compactedThroughOrdinal: v.number(),
    portableSummary: v.string(),
    nativeCompaction: v.optional(v.any()),
    nativeCompactionSupported: v.optional(v.boolean()),
    retainedRecentEventIds: v.array(serviceId),
    inputTokens: v.number(),
    outputTokens: v.number(),
    estimatedSavedTokens: v.number(),
  },
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const guildId = requireDiscordId(args.guildId, "guildId");
    const conversationId = requireDiscordId(args.conversationId, "conversationId");
    const checkpointId = requireDiscordId(args.checkpointId, "checkpointId");
    const conversation = await assistantConversationByGuild(ctx, guildId);
    if (
      conversation === null
      || conversation.ownerId !== ownerId
      || conversation.conversationId !== conversationId
      || conversation.epoch !== args.epoch
      || conversation.revision !== args.expectedRevision
      || conversation.generation !== args.expectedGeneration
      || conversation.routingGeneration !== args.expectedRoutingGeneration
      || conversation.capabilityProfileHash !== args.toolPolicyHash
    ) {
      return { accepted: false as const, reason: "checkpoint_compare_and_set_lost" as const };
    }
    if (conversation.activeTurnId !== undefined || conversation.leaseExpiresAt !== undefined) {
      return { accepted: false as const, reason: "conversation_not_stable" as const };
    }
    for (const status of ["delivery_uncertain", "needs_reconciliation"] as const) {
      const unresolved = await ctx.db.query("discordOutbox")
        .withIndex("by_owner_status_createdAt", (index) => index.eq("ownerId", ownerId).eq("status", status))
        .collect();
      if (unresolved.some((reply) => reply.guildId === guildId || reply.sourceGuildId === guildId)) {
        return { accepted: false as const, reason: "conversation_not_stable" as const };
      }
    }
    if (
      !Number.isSafeInteger(args.compactedThroughOrdinal)
      || args.compactedThroughOrdinal <= 0
      || args.compactedThroughOrdinal >= conversation.nextOrdinal
      || args.retainedRecentEventIds.length > DISCORD_MAX_RECENT_EVENT_COUNT
    ) {
      return { accepted: false as const, reason: "checkpoint_invalid" as const };
    }
    let parsedSummary: z.infer<typeof portableConversationSummarySchema>;
    try {
      parsedSummary = portableConversationSummarySchema.parse(JSON.parse(args.portableSummary));
    } catch {
      return { accepted: false as const, reason: "checkpoint_invalid" as const };
    }
    if (args.toolPolicyHash !== conversation.capabilityProfileHash) {
      return { accepted: false as const, reason: "checkpoint_invalid" as const };
    }
    const canonicalSlice = await canonicalCheckpointSlice(
      ctx,
      conversation,
      args.compactedThroughOrdinal,
    );
    if (
      canonicalSlice.events.length === 0
      || canonicalSlice.sourceContextHash !== args.sourceContextHash
    ) {
      return { accepted: false as const, reason: "checkpoint_invalid" as const };
    }
    if (!portableSummaryEvidenceMatchesEvents(parsedSummary, canonicalSlice.events)) {
      return { accepted: false as const, reason: "checkpoint_invalid" as const };
    }
    const normalizedRetainedEventIds = args.retainedRecentEventIds.map((id) =>
      requireDiscordId(id, "eventId")
    );
    if (new Set(normalizedRetainedEventIds).size !== normalizedRetainedEventIds.length) {
      return { accepted: false as const, reason: "checkpoint_invalid" as const };
    }
    const retainedEvents = await Promise.all(normalizedRetainedEventIds.map((eventId) => ctx.db
      .query("discordConversationEvents")
      .withIndex("by_owner_event", (index) => index
        .eq("ownerId", ownerId)
        .eq("eventId", eventId))
      .unique()));
    if (retainedEvents.some((event) =>
      event === null
      || event.conversationId !== conversationId
      || event.epoch !== args.epoch
      || event.status !== "committed"
      || event.ordinal <= args.compactedThroughOrdinal
    )) {
      return { accepted: false as const, reason: "checkpoint_invalid" as const };
    }
    const canonicalRecentEvents = (await ctx.db
      .query("discordConversationEvents")
      .withIndex("by_conversation_epoch_ordinal", (index) => index
        .eq("conversationId", conversationId)
        .eq("epoch", args.epoch))
      .order("asc")
      .collect())
      .filter((event) => event.visibility === "conversation"
        && event.status === "committed"
        && event.ordinal > args.compactedThroughOrdinal
        && event.content !== undefined
        && (event.kind === "human_message"
          || event.kind === "assistant_ack"
          || event.kind === "assistant_final"));
    const retainedTail = selectDiscordCheckpointTail(
      canonicalRecentEvents.map((event) => ({
        eventId: event.eventId,
        ordinal: event.ordinal,
        content: event.content!,
      })),
    );
    const expectedRetainedEventIds = retainedTail.events.map((event) => event.eventId);
    if (args.nativeCompactionSupported !== true && (!retainedTail.complete || args.nativeCompaction !== undefined)) {
      return { accepted: false as const, reason: "checkpoint_native_protocol_required" as const };
    }
    if (canonicalJson(normalizedRetainedEventIds) !== canonicalJson(expectedRetainedEventIds)) {
      return { accepted: false as const, reason: "checkpoint_invalid" as const };
    }
    if (
      !Number.isSafeInteger(args.inputTokens)
      || args.inputTokens <= 0
      || !Number.isSafeInteger(args.outputTokens)
      || args.outputTokens < 0
      || !Number.isSafeInteger(args.estimatedSavedTokens)
      || args.estimatedSavedTokens !== args.inputTokens - args.outputTokens
    ) {
      return { accepted: false as const, reason: "checkpoint_invalid" as const };
    }
    const now = Date.now();
    let nativeCompaction: StoredNativeCompaction | undefined;
    try {
      if (args.nativeCompaction !== undefined) {
        nativeCompaction = await validateNativeCompaction(args.nativeCompaction, args.portableSummary);
        if (nativeCompaction.model !== conversation.lunaModel) throw new Error("Native checkpoint model mismatch.");
      }
    } catch {
      return { accepted: false as const, reason: "checkpoint_native_invalid" as const };
    }
    let serializedBytes = checkpointUtf8Bytes(args.portableSummary) + (nativeCompaction?.serializedBytes ?? 0);
    try {
      validatePortableCheckpointCandidate({
        sourceRevision: args.expectedRevision,
        currentRevision: conversation.revision,
        serializedBytes,
        createdAt: now,
        expiresAt: now + DISCORD_PORTABLE_CHECKPOINT_RETENTION_MS,
      });
    } catch {
      return { accepted: false as const, reason: "checkpoint_oversize" as const };
    }
    const checkpointStatus = retainedTail.complete ? "active" as const : "candidate" as const;
    if (nativeCompaction !== undefined) {
      // native-v2 proves only active opaque lineage, not staged or summary-backed
      // native input. Keep readable progress, but never activate a delta-only artifact
      // from a rolling-deployment Pi that did not include the previous summary.
      const unsupportedLineage = checkpointStatus === "candidate"
        || conversation.candidateCheckpointId !== undefined
        || (conversation.activeCheckpointId !== undefined
          && (await durableConversationContext(ctx, conversation, now)).nativeCheckpoint === undefined);
      if (unsupportedLineage) {
        nativeCompaction = undefined;
        serializedBytes = checkpointUtf8Bytes(args.portableSummary);
      }
    }
    const existing = await ctx.db
      .query("discordCompactionCheckpoints")
      .withIndex("by_owner_checkpoint", (index) => index
        .eq("ownerId", ownerId)
        .eq("checkpointId", checkpointId))
      .unique();
    if (existing !== null) {
      const same = existing.conversationId === conversationId
        && existing.epoch === args.epoch
        && existing.sourceRevision === args.expectedRevision
        && existing.sourceContextHash === args.sourceContextHash
        && existing.portableSummary === args.portableSummary
        && canonicalJson(existing.nativeCompaction ?? null) === canonicalJson(nativeCompaction ?? null);
      return same
        ? { accepted: true as const, duplicate: true, checkpointId, status: existing.status }
        : { accepted: false as const, reason: "checkpoint_id_conflict" as const };
    }
    if (checkpointStatus === "active" && conversation.activeCheckpointId !== undefined) {
      const active = await ctx.db
        .query("discordCompactionCheckpoints")
        .withIndex("by_owner_checkpoint", (index) => index
          .eq("ownerId", ownerId)
          .eq("checkpointId", conversation.activeCheckpointId!))
        .unique();
      if (active !== null && active.status === "active") {
        await ctx.db.patch(active._id, { status: "superseded", updatedAt: now });
      }
    }
    if (conversation.candidateCheckpointId !== undefined) {
      const staged = await ctx.db.query("discordCompactionCheckpoints")
        .withIndex("by_owner_checkpoint", (index) => index
          .eq("ownerId", ownerId).eq("checkpointId", conversation.candidateCheckpointId!))
        .unique();
      if (staged?.status === "candidate") await ctx.db.patch(staged._id, {
        status: "superseded", nativeCompaction: undefined, updatedAt: now,
      });
    }
    const checkpointRecord: Omit<Doc<"discordCompactionCheckpoints">, "_id" | "_creationTime"> = {
      ownerId,
      ownerBindingVersion: conversation.ownerBindingVersion,
      guildId,
      conversationId,
      epoch: args.epoch,
      checkpointId,
      schemaVersion: 1,
      implementationVersion: "portable-summary-v1",
      provider: "openai-codex",
      model: conversation.lunaModel,
      personalityVersion: conversation.personalityVersion,
      systemPromptHash: conversation.systemPromptHash,
      capabilityProfileHash: conversation.capabilityProfileHash,
      toolPolicyHash: args.toolPolicyHash,
      compactedThroughOrdinal: args.compactedThroughOrdinal,
      sourceRevision: args.expectedRevision,
      sourceGeneration: args.expectedGeneration,
      sourceRoutingGeneration: args.expectedRoutingGeneration,
      sourceContextHash: args.sourceContextHash,
      portableSummary: args.portableSummary,
      retainedRecentEventIds: normalizedRetainedEventIds,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      estimatedSavedTokens: args.estimatedSavedTokens,
      serializedBytes,
      storageProtection: "platform_default_unverified",
      status: checkpointStatus,
      expiresAt: now + DISCORD_PORTABLE_CHECKPOINT_RETENTION_MS,
      createdAt: now,
      updatedAt: now,
    };
    if (nativeCompaction !== undefined) checkpointRecord.nativeCompaction = nativeCompaction;
    await ctx.db.insert("discordCompactionCheckpoints", checkpointRecord);
    if (checkpointStatus === "active") {
      await ctx.db.patch(conversation._id, { activeCheckpointId: checkpointId, candidateCheckpointId: undefined, updatedAt: now });
    } else {
      // Advancing updatedAt moves this guild behind other ready guilds on the next pass.
      await ctx.db.patch(conversation._id, { candidateCheckpointId: checkpointId, updatedAt: now });
    }
    return {
      accepted: true as const,
      duplicate: false,
      checkpointId,
      status: checkpointStatus,
      serializedBytes,
      expiresAt: now + DISCORD_PORTABLE_CHECKPOINT_RETENTION_MS,
    };
  },
});

export const expirePortableCheckpoints = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let expired = 0;
    for (const status of ["candidate", "active", "superseded", "invalid"] as const) {
      const checkpoints = await ctx.db
        .query("discordCompactionCheckpoints")
        .withIndex("by_status_expiresAt", (index) => index
          .eq("status", status)
          .lte("expiresAt", now))
        .collect();
      for (const checkpoint of checkpoints) {
        await ctx.db.patch(checkpoint._id, {
          status: "expired",
          portableSummary: "{}",
          nativeCompaction: undefined,
          retainedRecentEventIds: [],
          serializedBytes: 2,
          updatedAt: now,
        });
        const conversation = await assistantConversationByGuild(ctx, checkpoint.guildId);
        if (conversation?.activeCheckpointId === checkpoint.checkpointId) {
          await ctx.db.patch(conversation._id, {
            activeCheckpointId: undefined,
            updatedAt: now,
          });
        }
        if (conversation?.candidateCheckpointId === checkpoint.checkpointId) {
          await ctx.db.patch(conversation._id, { candidateCheckpointId: undefined, updatedAt: now });
        }
        expired += 1;
      }
    }
    return { expired, expiredAt: now };
  },
});

export const invalidateNativeCheckpoint = internalMutation({
  args: {
    actorId: serviceId,
    guildId: serviceId,
    conversationId: serviceId,
    checkpointId: serviceId,
    epoch: v.number(),
    expectedOwnerBindingVersion: v.number(),
    expectedRevision: v.number(),
    expectedGeneration: v.number(),
    expectedRoutingGeneration: v.number(),
  },
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const conversation = await assistantConversationByGuild(ctx, requireDiscordId(args.guildId, "guildId"));
    if (
      conversation === null || conversation.ownerId !== ownerId
      || conversation.conversationId !== args.conversationId
      || conversation.epoch !== args.epoch
      || conversation.ownerBindingVersion !== args.expectedOwnerBindingVersion
      // Plan and research writes advance revision within this generation. A rejected
      // artifact still belongs to the same exact checkpoint and run identity below.
      || !Number.isSafeInteger(args.expectedRevision) || args.expectedRevision <= 0
      || args.expectedRevision > conversation.revision
      || conversation.generation !== args.expectedGeneration
      || conversation.routingGeneration !== args.expectedRoutingGeneration
      || (conversation.activeCheckpointId !== args.checkpointId && conversation.candidateCheckpointId !== args.checkpointId)
    ) return { accepted: false as const, reason: "checkpoint_compare_and_set_lost" as const };
    const checkpoint = await ctx.db.query("discordCompactionCheckpoints")
      .withIndex("by_owner_checkpoint", (index) => index
        .eq("ownerId", ownerId).eq("checkpointId", requireDiscordId(args.checkpointId, "checkpointId")))
      .unique();
    if (
      checkpoint === null || checkpoint.guildId !== conversation.guildId
      || checkpoint.conversationId !== conversation.conversationId || checkpoint.epoch !== conversation.epoch
      || checkpoint.ownerBindingVersion !== conversation.ownerBindingVersion
      || (checkpoint.status !== "active" && checkpoint.status !== "candidate")
    ) return { accepted: false as const, reason: "checkpoint_invalid" as const };
    const now = Date.now();
    const invalidated = checkpoint.nativeCompaction !== undefined;
    await ctx.db.patch(checkpoint._id, {
      nativeCompaction: undefined,
      nativeInvalidatedAt: now,
      serializedBytes: checkpointUtf8Bytes(checkpoint.portableSummary),
      status: checkpoint.status === "candidate" ? "invalid" : "active",
      updatedAt: now,
    });
    if (conversation.candidateCheckpointId === checkpoint.checkpointId) {
      await ctx.db.patch(conversation._id, { candidateCheckpointId: undefined, updatedAt: now });
    }
    return { accepted: true as const, invalidated };
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
      const boundConversation = await assistantConversationByGuild(ctx, guildId);
      if (boundConversation !== null && boundConversation.ownerId !== ownerId) {
        throw new Error("Discord guild is already bound to another owner.");
      }
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
          ...normalizeDiscordForumCapabilities(channelSnapshot),
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
      const cursor: MonitoredChannelCursor = {
        guildId: channel.guildId,
        channelId: channel.channelId,
        afterMessageId: await discordHistoryAfterMessageId(
          ctx,
          ownerId,
          channel.guildId,
          channel.channelId,
        ),
      };
      monitoredChannels.push(cursor);
    }
    const reconciliationReplies = (await Promise.all(
      (["delivery_uncertain", "needs_reconciliation"] as const).map((status) => ctx.db
        .query("discordOutbox")
        .withIndex("by_owner_status_createdAt", (index) => index
          .eq("ownerId", ownerId)
          .eq("status", status))
        .collect()),
    )).flat();
    const reconciliationChannelIds = new Set(
      reconciliationReplies.map((reply) => reply.channelId),
    );
    for (const channelId of reconciliationChannelIds) {
      if (monitoredChannels.some((cursor) => cursor.channelId === channelId)) continue;
      const channel = synchronizedChannels.find((candidate) =>
        candidate.channelId === channelId
        && candidate.available
        && candidate.canReadHistory
      );
      if (channel === undefined) continue;
      monitoredChannels.push({
        guildId: channel.guildId,
        channelId,
        afterMessageId: await discordHistoryAfterMessageId(
          ctx,
          ownerId,
          channel.guildId,
          channelId,
        ),
      });
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
    const newspaperPreferences = await ctx.db
      .query("marketResearchPreferences")
      .withIndex("by_owner_guild", (index) => index.eq("ownerId", ownerId).eq("guildId", guildId))
      .unique();
    if (isMarketResearchForumIngress(
      newspaperPreferences?.forumChannelId,
      channelId,
      args.parentChannelId,
    )) {
      return { accepted: false as const, reason: "market_research_forum" as const };
    }
    const channel = await discordChannel(ctx, ownerId, guildId, channelId);
    if (!channel?.available) {
      return { accepted: false as const, reason: "not_monitored" as const };
    }
    const now = Date.now();
    let state = await discordChannelState(ctx, ownerId, channelId);
    const monitored = hasRole(channel, "conversation_monitor");
    const directMention = !args.isBot && args.mentionsBot;
    const activeConversation = state !== null && activeLease(state, now);
    const possibleNonceReconciliation = args.isBot && args.nonce !== undefined;
    if (!monitored && !directMention && !activeConversation && !possibleNonceReconciliation) {
      return { accepted: false as const, reason: "not_monitored" as const };
    }
    const images = requireDiscordImages(args.images);
    const content = requireDiscordContent(args.content);
    if (!content.trim() && images === undefined) {
      return { accepted: false as const, reason: "empty_message" as const };
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
        content,
        mentionsBot: args.mentionsBot,
        isBot: args.isBot,
        createdAt: args.createdAt,
      };
      if (images !== undefined) incomingMessage.images = images;
      if (args.replyToMessageId !== undefined) {
        incomingMessage.replyToMessageId = args.replyToMessageId;
      }
      const duplicateMatches = discordDuplicateMessageMatches(existing, incomingMessage);
      if (!duplicateMatches) {
        return { accepted: false as const, reason: "message_id_conflict" as const };
      }
    }
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
      content,
      mentionsBot: args.mentionsBot,
      isBot: args.isBot,
      createdAt: args.createdAt,
      receivedAt: now,
    };
    if (images !== undefined) messageValue.images = images;
    if (args.replyToMessageId !== undefined) messageValue.replyToMessageId = args.replyToMessageId;
    if (args.nonce !== undefined) messageValue.nonce = requireDiscordId(args.nonce, "nonce");
    if (args.payloadHash !== undefined) messageValue.payloadHash = args.payloadHash;
    await ctx.db.insert("discordMessages", messageValue);
    if (args.isBot && args.nonce !== undefined) {
      const gateway = await ctx.db
        .query("discordGateways")
        .withIndex("by_owner", (index) => index.eq("ownerId", ownerId))
        .unique();
      const outbox = await ctx.db
        .query("discordOutbox")
        .withIndex("by_owner_nonce", (index) => index
          .eq("ownerId", ownerId)
          .eq("nonce", args.nonce))
        .unique();
      const candidatePayloadHash = outbox === null
        ? undefined
        : await sha256Hex(canonicalJson({
            guildId,
            channelId,
            content,
            chart: outbox.chart ?? null,
            replyToMessageId: args.replyToMessageId ?? null,
          }));
      const matches = outbox !== null
        && gateway?.botUserId === args.authorId
        && outbox.guildId === guildId
        && outbox.channelId === channelId
        && outbox.content === content
        && outbox.replyToMessageId === args.replyToMessageId
        && outbox.payloadHash !== undefined
        && candidatePayloadHash === outbox.payloadHash
        && (args.payloadHash === undefined || outbox.payloadHash === args.payloadHash);
      if (matches && outbox !== null) {
        if (outbox.status !== "sent" && outbox.status !== "finalized") {
          await ctx.db.patch(outbox._id, {
            status: "sent",
            discordMessageId: messageId,
            deliveryWorkerId: undefined,
            deliveryToken: undefined,
            deliveryLeaseExpiresAt: undefined,
            sentAt: now,
            updatedAt: now,
          });
          await commitCanonicalAssistantDelivery(ctx, outbox, messageId, now);
          if (outbox.turnId !== undefined) {
            const turn = await ctx.db
              .query("discordAssistantTurns")
              .withIndex("by_owner_turn", (index) => index
                .eq("ownerId", ownerId)
                .eq("turnId", outbox.turnId!))
              .unique();
            if (turn !== null) {
              await ctx.db.patch(turn._id, { deliveryState: "sent", updatedAt: now });
            }
          }
        } else if (outbox.discordMessageId !== messageId) {
          return { accepted: false as const, reason: "nonce_delivery_conflict" as const };
        }
      }
    }
    let assistantConversation = await assistantConversationByGuild(ctx, guildId);
    if (assistantConversation !== null && assistantConversation.ownerId !== ownerId) {
      throw new Error("Discord guild is already bound to another owner.");
    }
    if (assistantConversation === null && monitored) {
      assistantConversation = await ensureAssistantConversation(
        ctx,
        ownerId,
        guildId,
        now,
        {
          conversationChannelId: channelId,
          migrationWatermarkSequence: state.latestSequence,
        },
      );
    }
    const belongsToConversation = assistantConversation !== null
      && !args.isBot
      && decision.sequence > assistantConversation.migrationWatermarkSequence
      && (
        assistantConversation.conversationChannelId === channelId
        || directMention
        || assistantConversation.activeTurnId !== undefined
      );
    if (belongsToConversation && assistantConversation !== null) {
      const existingCanonical = await ctx.db
        .query("discordConversationEvents")
        .withIndex("by_conversation_source", (index) => index
          .eq("conversationId", assistantConversation!.conversationId)
          .eq("epoch", assistantConversation!.epoch)
          .eq("sourceChannelId", channelId)
          .eq("sourceMessageId", messageId))
        .unique();
      if (existingCanonical === null) {
        const revision = assistantConversation.revision + 1;
        const humanRevision = assistantConversation.humanRevision + 1;
        const messageContext: DiscordMessageContext = {
          messageId,
          sequence: decision.sequence,
          authorId: messageValue.authorId,
          authorName: messageValue.authorName,
          content: messageValue.content,
          mentionsBot: messageValue.mentionsBot ?? false,
          isBot: false,
          createdAt: messageValue.createdAt,
        };
        if (messageValue.images !== undefined) messageContext.images = messageValue.images;
        if (messageValue.replyToMessageId !== undefined) {
          messageContext.replyToMessageId = messageValue.replyToMessageId;
        }
        await ctx.db.insert("discordConversationEvents", {
          ownerId,
          ownerBindingVersion: assistantConversation.ownerBindingVersion,
          guildId,
          conversationId: assistantConversation.conversationId,
          epoch: assistantConversation.epoch,
          eventId: `${assistantConversation.conversationId}:${assistantConversation.epoch}:human:${channelId}:${messageId}`,
          ordinal: assistantConversation.nextOrdinal,
          revision,
          humanRevision,
          kind: "human_message",
          visibility: "conversation",
          status: "committed",
          sourceChannelId: channelId,
          sourceMessageId: messageId,
          sourceSequence: decision.sequence,
          authorId: messageValue.authorId,
          authorName: messageValue.authorName,
          authorIsBot: false,
          content: messageValue.content || "[Image attached]",
          contextHash: discordContextHash([messageContext]),
          createdAt: args.createdAt,
          committedAt: now,
          updatedAt: now,
        });
        await ctx.db.patch(assistantConversation._id, {
          revision,
          humanRevision,
          nextOrdinal: assistantConversation.nextOrdinal + 1,
          updatedAt: now,
        });
      }
    }
    const running = activeLease(state, now);
    const advancesTrigger = !args.isBot && (monitored || directMention);
    const startsNewChain = advancesTrigger
      && !running
      && state.triggerThroughSequence <= state.completedThroughSequence;
    const triggerThroughSequence = advancesTrigger
      ? decision.sequence
      : state.triggerThroughSequence;
    const alreadyPendingMention = advancesTrigger
      && !directMention
      && state.triggerThroughSequence > state.completedThroughSequence
      && await ctx.db
        .query("discordMessages")
        .withIndex("by_owner_channel_sequence", (index) => index
          .eq("ownerId", ownerId)
          .eq("channelId", channelId)
          .gte("sequence", state.completedThroughSequence + 1)
          .lte("sequence", state.triggerThroughSequence))
        .filter((filter) => filter.eq(filter.field("mentionsBot"), true))
        .first() !== null;
    const nextEligibleAt = advancesTrigger
      ? directMention || alreadyPendingMention
        ? now
        : Math.max(
            now + DISCORD_AMBIENT_DEBOUNCE_MS,
            (state.lastProcessedAt ?? 0) + DISCORD_AMBIENT_COOLDOWN_MS,
          )
      : state.nextEligibleAt;
    const pendingCount = Math.max(0, triggerThroughSequence - state.completedThroughSequence);
    await ctx.db.patch(state._id, {
      latestSequence: decision.sequence,
      triggerThroughSequence,
      nextEligibleAt,
      status: advancesTrigger && !running
        ? pendingCount > DISCORD_CONTEXT_SIZE ? "catching_up" : "idle"
        : state.status,
      recheckCount: startsNewChain ? 0 : state.recheckCount,
      recheckPending: startsNewChain ? false : state.recheckPending,
      lastRecheckHash: startsNewChain ? undefined : state.lastRecheckHash,
      lastError: advancesTrigger && !running ? undefined : state.lastError,
      consecutiveErrorCount: advancesTrigger && !running
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
      shouldSchedule: decision.triggersLoop && directMention && !running,
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
    if (!channel?.available) {
      return { claimed: false as const, reason: "not_monitored" as const };
    }
    const state = await discordChannelState(ctx, ownerId, channelId);
    if (!state) return { claimed: false as const, reason: "not_runnable" as const };
    const now = Date.now();
    let conversation = await assistantConversationByGuild(ctx, guildId);
    if (conversation !== null && conversation.ownerId !== ownerId) {
      return { claimed: false as const, reason: "owner_binding_conflict" as const };
    }
    conversation ??= await ensureAssistantConversation(
      ctx,
      ownerId,
      guildId,
      now,
      {
        conversationChannelId: channelId,
        migrationWatermarkSequence: state.completedThroughSequence,
      },
    );
    if (conversation === null) throw new Error("Discord conversation could not be acquired.");
    const hasPendingMessages = state.triggerThroughSequence > state.completedThroughSequence;
    if (
      !hasRole(channel, "conversation_monitor")
      && !hasPendingMessages
      && state.activeRunId === undefined
    ) {
      return { claimed: false as const, reason: "not_monitored" as const };
    }

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
        && conversation.activeTurnId === existingClaim.runId
        && conversation.activeRunId === existingClaim.runId
        && conversation.leaseExpiresAt !== undefined
        && conversation.leaseExpiresAt > now
      ) {
        const messages = await contextWindow(
          ctx,
          ownerId,
          channelId,
          discordTrailingContextStart(existingClaim.windowEnd),
          existingClaim.windowEnd,
        );
        const triggerKind = triggerKindForWindow(
          existingClaim.mode,
          existingClaim.windowStart,
          messages,
        );
        const routing = await channelRouting(
          ctx,
          ownerId,
          guildId,
          channelId,
          triggerKind === "mention",
        );
        const durableContext = await durableConversationContext(
          ctx,
          conversation,
          now,
          messages.filter((message) => !message.isBot).map((message) => message.messageId),
        );
        const activeTurnId = conversation.activeTurnId;
        const activeTurn = await ctx.db
          .query("discordAssistantTurns")
          .withIndex("by_owner_turn", (index) => index
            .eq("ownerId", ownerId)
            .eq("turnId", activeTurnId))
          .unique();
        const idempotentClaim = {
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
          triggerKind,
          conversation: publicConversationIdentity(
            conversation,
            conversation.activeTurnId,
            existingClaim.runId,
          ),
          conversationGeneration: conversation.generation,
          conversationLeaseToken: conversation.activeLeaseToken,
          routingGeneration: conversation.routingGeneration,
          durableContext,
          ...routing,
          messages,
        };
        if (activeTurn === null) return idempotentClaim;
        return {
          ...idempotentClaim,
          recovery: await durableTurnRecoveryPayload(ctx, activeTurn),
        };
      }
      return { claimed: false as const, reason: "claim_already_used" as const };
    }

    if (
      conversation.activeTurnId !== undefined
      && conversation.leaseExpiresAt !== undefined
      && conversation.leaseExpiresAt > now
    ) {
      return { claimed: false as const, reason: "guild_conversation_busy" as const };
    }

    const activeConversationId = conversation.conversationId;
    const activeConversationEpoch = conversation.epoch;
    const unresolvedDeliveries = await ctx.db
      .query("discordOutbox")
      .withIndex("by_conversation_epoch", (index) => index
        .eq("conversationId", activeConversationId)
        .eq("epoch", activeConversationEpoch))
      .collect();
    if (unresolvedDeliveries.some((reply) =>
      reply.status === "delivery_uncertain"
      || reply.status === "needs_reconciliation"
    )) {
      return { claimed: false as const, reason: "delivery_requires_reconciliation" as const };
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
    const expiredRun = state.activeRunId === undefined
      ? null
      : await ctx.db
        .query("discordLoopRuns")
        .withIndex("by_owner_run", (index) => index
          .eq("ownerId", ownerId)
          .eq("runId", state.activeRunId!))
        .unique();
    const expiredTurnId = conversation.activeTurnId;
    const expiredTurn = expiredTurnId === undefined
      ? null
      : await ctx.db
        .query("discordAssistantTurns")
        .withIndex("by_owner_turn", (index) => index
          .eq("ownerId", ownerId)
          .eq("turnId", expiredTurnId))
        .unique();
    if (
      state.activeRunId !== undefined
      && state.leaseExpiresAt !== undefined
      && state.leaseExpiresAt <= now
      && hasSentDiscordFinalizer(expiredReplies, state.activeRunId, state.generation)
    ) {
      return { claimed: false as const, reason: "awaiting_finalization" as const };
    }
    const recoverableExpiredTurn = expiredRun !== null
      && expiredTurn !== null
      && state.activeRunId === expiredRun.runId
      && conversation.activeRunId === expiredRun.runId
      && conversation.activeTurnId === expiredTurn.turnId
      && expiredTurn.runId === expiredRun.runId
      && !["completed", "suppressed", "failed", "cancelled"].includes(expiredTurn.stage)
      && !["completed", "error", "stale"].includes(expiredRun.status);
    const claim = discordClaimDecision({
      ...state,
      recheckPending: state.recheckPending || expiredRecheck,
    }, now);
    if (!claim.claimed) return { claimed: false as const, reason: claim.reason };
    const window = recoverableExpiredTurn
      ? {
          mode: expiredRun.mode,
          start: expiredRun.windowStart,
          end: expiredRun.windowEnd,
        }
      : claim.window;
    if (
      window.mode === "messages"
      && state.nextEligibleAt !== undefined
      && state.nextEligibleAt > now
    ) {
      return { claimed: false as const, reason: "debouncing" as const };
    }

    if (state.activeRunId !== undefined && !recoverableExpiredTurn) {
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
    const triggerKind = triggerKindForWindow(window.mode, window.start, messages);
    const routing = await channelRouting(
      ctx,
      ownerId,
      guildId,
      channelId,
      triggerKind === "mention",
    );
    const contextHash = discordContextHash(messages);
    const generation = claim.generation;
    const leaseExpiresAt = now + DISCORD_LOOP_LEASE_MS;
    const runId = recoverableExpiredTurn ? expiredRun!.runId : claimId;
    const turnId = recoverableExpiredTurn ? expiredTurn!.turnId : runId;
    if (!recoverableExpiredTurn && conversation.activeTurnId !== undefined) {
      if (expiredTurn !== null && !["completed", "suppressed", "failed", "cancelled"].includes(expiredTurn.stage)) {
        await ctx.db.patch(expiredTurn._id, {
          stage: "failed",
          failureCode: "conversation_lease_expired",
          completedAt: now,
          updatedAt: now,
        });
      }
    }
    const conversationGeneration = conversation.generation + 1;
    const conversationLeaseToken = discordConversationLeaseToken(
      conversation.conversationId,
      conversation.epoch,
      conversationGeneration,
      runId,
      workerId,
    );
    const conversationLeaseExpiresAt = now + DISCORD_CONVERSATION_LEASE_MS;
    const recoveredLoopStage = expiredTurn?.stage === "ack_pending"
      ? "acknowledging" as const
      : expiredTurn?.stage === "researching"
        ? "researching" as const
        : expiredTurn !== null
          && ["research_complete", "resuming", "drafted"].includes(expiredTurn.stage)
          ? "drafting" as const
          : "triaging" as const;
    if (recoverableExpiredTurn) {
      await ctx.db.patch(expiredRun!._id, {
        claimId,
        workerId,
        generation,
        status: recoveredLoopStage,
        leaseExpiresAt,
        completedAt: undefined,
        updatedAt: now,
      });
    } else {
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
    }
    await ctx.db.patch(state._id, {
      generation,
      status: recoverableExpiredTurn ? recoveredLoopStage : "triaging",
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
    if (recoverableExpiredTurn) {
      await ctx.db.patch(expiredTurn!._id, {
        channelGeneration: generation,
        conversationGeneration,
        routingGeneration: conversation.routingGeneration,
        updatedAt: now,
      });
      for (const reply of expiredReplies) {
        if (reply.status !== "pending") continue;
        await ctx.db.patch(reply._id, {
          generation,
          conversationGeneration,
          routingGeneration: conversation.routingGeneration,
          conversationLeaseToken,
          updatedAt: now,
        });
      }
    } else {
      await ctx.db.insert("discordAssistantTurns", {
        ownerId,
        ownerBindingVersion: conversation.ownerBindingVersion,
        guildId,
        conversationId: conversation.conversationId,
        epoch: conversation.epoch,
        turnId,
        runId,
        sourceChannelId: channelId,
        windowStart: window.start,
        windowEnd: window.end,
        triggerKind,
        channelGeneration: generation,
        conversationGeneration,
        routingGeneration: conversation.routingGeneration,
        baseRevision: conversation.revision,
        baseHumanRevision: conversation.humanRevision,
        inputContextHash: contextHash,
        stage: "claimed",
        planRequestId: `${runId}:frontman-plan`,
        lunaModel: conversation.lunaModel,
        lunaReasoningEffort: conversation.lunaReasoningEffort,
        lunaServiceTier: conversation.lunaServiceTier,
        personalityVersion: conversation.personalityVersion,
        systemPromptHash: conversation.systemPromptHash,
        capabilityProfileHash: conversation.capabilityProfileHash,
        autonomousPass: state.recheckCount,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(conversation._id, {
      generation: conversationGeneration,
      activeTurnId: turnId,
      activeRunId: runId,
      activeLeaseToken: conversationLeaseToken,
      activeLeaseWorkerId: workerId,
      leaseExpiresAt: conversationLeaseExpiresAt,
      updatedAt: now,
    });
    conversation = (await ctx.db.get(conversation._id)) ?? conversation;
    const activeTurn = recoverableExpiredTurn
      ? (await ctx.db.get(expiredTurn!._id)) ?? expiredTurn!
      : await ctx.db
        .query("discordAssistantTurns")
        .withIndex("by_owner_turn", (index) => index
          .eq("ownerId", ownerId)
          .eq("turnId", turnId))
        .unique();
    if (activeTurn === null) throw new Error("Discord turn recovery state is unavailable.");
    const durableContext = await durableConversationContext(
      ctx,
      conversation,
      now,
      messages.filter((message) => !message.isBot).map((message) => message.messageId),
    );
    await recordActivity(ctx, ownerId, {
      eventId: `${runId}:started`,
      guildId,
      channelId,
      runId,
      eventType: "loop_started",
      stage: "triaging",
    }, now);
    const claimedLoop = {
      claimed: true as const,
      idempotent: recoverableExpiredTurn,
      runId,
      generation,
      mode: window.mode,
      channelName: channel.name,
      leaseExpiresAt,
      windowStart: window.start,
      windowEnd: window.end,
      contextHash,
      recheckCount: state.recheckCount,
      triggerKind,
      conversation: publicConversationIdentity(conversation, turnId, runId),
      conversationGeneration,
      conversationLeaseToken,
      routingGeneration: conversation.routingGeneration,
      durableContext,
      ...routing,
      messages,
    };
    if (!recoverableExpiredTurn || activeTurn === null) return claimedLoop;
    return {
      ...claimedLoop,
      recovery: await durableTurnRecoveryPayload(ctx, activeTurn),
    };
  },
});

export const getNewestContext = internalMutation({
  args: {
    actorId: serviceId,
    guildId: serviceId,
    channelId: serviceId,
    run: v.optional(v.object({
      runId: serviceId,
      conversationId: serviceId,
      epoch: v.number(),
      conversationGeneration: v.number(),
      routingGeneration: v.number(),
      turnId: serviceId,
      conversationLeaseToken: serviceId,
    })),
  },
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const guildId = requireDiscordId(args.guildId, "guildId");
    const channelId = requireDiscordId(args.channelId, "channelId");
    const channel = await discordChannel(ctx, ownerId, guildId, channelId);
    const state = await discordChannelState(ctx, ownerId, channelId);
    if (!channel?.available || (!hasRole(channel, "conversation_monitor") && !state)) {
      throw new Error("Discord channel is not available to the bot.");
    }
    const messages = await newestContext(ctx, ownerId, channelId);
    if (args.run === undefined) {
      return {
        guildId,
        channelId,
        throughSequence: state?.latestSequence ?? 0,
        triggerThroughSequence: state?.triggerThroughSequence ?? 0,
        completedThroughSequence: state?.completedThroughSequence ?? 0,
        contextHash: discordContextHash(messages),
        eligibleThroughSequence: state?.latestSequence ?? 0,
        eligibleHumanRevision: 0,
        eligibleContextHash: discordContextHash(messages),
        catchUpMessages: [],
        exact: true,
        messages,
      };
    }
    const now = Date.now();
    const conversation = await assistantConversationByGuild(ctx, guildId);
    if (
      conversation === null
      || !isCurrentDiscordConversationFence(conversation, {
        ownerId,
        ownerBindingVersion: conversation?.ownerBindingVersion ?? 0,
        conversationId: args.run.conversationId,
        epoch: args.run.epoch,
        generation: args.run.conversationGeneration,
        routingGeneration: args.run.routingGeneration,
        turnId: args.run.turnId,
        runId: args.run.runId,
        leaseToken: args.run.conversationLeaseToken,
      }, now)
    ) {
      throw new Error("Discord conversation fence is stale.");
    }
    const turn = await ctx.db
      .query("discordAssistantTurns")
      .withIndex("by_owner_turn", (index) => index
        .eq("ownerId", ownerId)
        .eq("turnId", args.run!.turnId))
      .unique();
    if (turn === null || turn.runId !== args.run.runId) {
      throw new Error("Discord assistant turn was not found.");
    }
    const afterWatermark = await ctx.db
      .query("discordMessages")
      .withIndex("by_owner_channel_sequence", (index) => index
        .eq("ownerId", ownerId)
        .eq("channelId", channelId)
        .gt("sequence", turn.windowEnd))
      .order("asc")
      .collect();
    const nextExplicit = afterWatermark.find((message) => !message.isBot && message.mentionsBot);
    const eligibleThroughSequence = nextExplicit === undefined
      ? state?.latestSequence ?? turn.windowEnd
      : nextExplicit.sequence - 1;
    const catchUp = afterWatermark
      .filter((message) => message.sequence <= eligibleThroughSequence)
      .map(toMessageContext);
    const expectedCatchUpCount = Math.max(0, eligibleThroughSequence - turn.windowEnd);
    const exact = catchUp.length === expectedCatchUpCount
      && catchUp.every((message, index) => message.sequence === turn.windowEnd + index + 1);
    const canonicalHumans = await ctx.db
      .query("discordConversationEvents")
      .withIndex("by_conversation_epoch_ordinal", (index) => index
        .eq("conversationId", conversation.conversationId)
        .eq("epoch", conversation.epoch))
      .filter((filter) => filter.and(
        filter.eq(filter.field("kind"), "human_message"),
        filter.lte(filter.field("sourceSequence"), eligibleThroughSequence),
      ))
      .collect();
    const eligibleHumanRevision = canonicalHumans.reduce(
      (revision, event) => Math.max(revision, event.humanRevision),
      turn.baseHumanRevision,
    );
    const eligibleContextHash = discordContextHash([
      ...messages.filter((message) => message.sequence <= turn.windowEnd),
      ...catchUp,
    ]);
    await ctx.db.patch(turn._id, {
      eligibleThroughSequence,
      eligibleHumanRevision,
      eligibleContextHash,
      nextExplicitTriggerSequence: nextExplicit?.sequence,
      stage: "resuming",
      updatedAt: now,
    });
    return {
      guildId,
      channelId,
      throughSequence: state?.latestSequence ?? 0,
      triggerThroughSequence: state?.triggerThroughSequence ?? 0,
      completedThroughSequence: state?.completedThroughSequence ?? 0,
      contextHash: discordContextHash(messages),
      eligibleThroughSequence,
      eligibleHumanRevision,
      eligibleContextHash,
      nextExplicitTriggerSequence: nextExplicit?.sequence,
      catchUpMessages: catchUp,
      exact,
      messages,
    };
  },
});

export const recordFrontmanPlan = internalMutation({
  args: {
    actorId: serviceId,
    guildId: serviceId,
    fence: durableStageFenceValidator,
    requestId: serviceId,
    action: v.union(
      v.literal("silent"),
      v.literal("reply"),
      v.literal("clarify"),
      v.literal("research"),
    ),
    reasonCode: serviceId,
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const guildId = requireDiscordId(args.guildId, "guildId");
    const requestId = requireDiscordId(args.requestId, "requestId");
    const reasonCode = requireDiscordId(args.reasonCode, "reasonCode");
    const payload = requireSerializedJson(args.payload, 32 * 1_024, "frontman plan");
    const now = Date.now();
    const state = await durableStageState(ctx, ownerId, guildId, args.fence, now);
    if (state === null) {
      return { accepted: false as const, reason: "stale_conversation_generation" as const };
    }
    if (state.turn.planRequestId !== requestId) {
      return { accepted: false as const, reason: "stage_request_id_conflict" as const };
    }
    if (state.turn.planPayload !== undefined) {
      const duplicate = state.turn.planPayload === payload
        && state.turn.planAction === args.action
        && state.turn.planReasonCode === reasonCode;
      return duplicate
        ? { accepted: true as const, duplicate: true, stage: "planned" as const }
        : { accepted: false as const, reason: "stage_request_fingerprint_conflict" as const };
    }
    const contextHash = await sha256Hex(payload);
    await appendInternalConversationEvent(ctx, state.conversation, {
      eventId: `${state.conversation.conversationId}:${state.conversation.epoch}:plan:${requestId}`,
      turnId: state.turn.turnId,
      runId: state.turn.runId,
      kind: "internal_plan",
      contextHash,
    }, now);
    await ctx.db.patch(state.turn._id, {
      stage: "planned",
      planAction: args.action,
      planReasonCode: reasonCode,
      planPayload: payload,
      updatedAt: now,
    });
    return { accepted: true as const, duplicate: false, stage: "planned" as const };
  },
});

export const recordResearchStarted = internalMutation({
  args: {
    actorId: serviceId,
    guildId: serviceId,
    fence: durableStageFenceValidator,
    requestId: serviceId,
    normalizedRequest: v.string(),
    inputContextHash: v.string(),
    pass: v.number(),
  },
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const guildId = requireDiscordId(args.guildId, "guildId");
    const requestId = requireDiscordId(args.requestId, "requestId");
    const normalizedRequest = requireSerializedJson(
      args.normalizedRequest,
      16 * 1_024,
      "research request",
    );
    if (!Number.isSafeInteger(args.pass) || args.pass < 1 || args.pass > 2) {
      return { accepted: false as const, reason: "invalid_research_pass" as const };
    }
    const now = Date.now();
    const state = await durableStageState(ctx, ownerId, guildId, args.fence, now);
    if (state === null) {
      return { accepted: false as const, reason: "stale_conversation_generation" as const };
    }
    const existing = await ctx.db
      .query("discordResearchArtifacts")
      .withIndex("by_owner_request", (index) => index
        .eq("ownerId", ownerId)
        .eq("requestId", requestId))
      .unique();
    if (existing !== null) {
      const duplicate = existing.conversationId === state.conversation.conversationId
        && existing.epoch === state.conversation.epoch
        && existing.turnId === state.turn.turnId
        && existing.runId === state.turn.runId
        && existing.normalizedResearchRequest === normalizedRequest
        && existing.inputContextHash === args.inputContextHash;
      return duplicate
        ? { accepted: true as const, duplicate: true, artifactId: existing.requestId }
        : { accepted: false as const, reason: "stage_request_fingerprint_conflict" as const };
    }
    await ctx.db.insert("discordResearchArtifacts", {
      ownerId,
      ownerBindingVersion: state.conversation.ownerBindingVersion,
      guildId,
      conversationId: state.conversation.conversationId,
      epoch: state.conversation.epoch,
      turnId: state.turn.turnId,
      runId: state.turn.runId,
      requestId,
      normalizedResearchRequest: normalizedRequest,
      workerModel: DISCORD_PERSONALITY_PROFILE.solModel,
      reasoningEffort: DISCORD_PERSONALITY_PROFILE.solReasoningEffort,
      serviceTier: DISCORD_PERSONALITY_PROFILE.solServiceTier,
      profileVersion: "sol-research-v1",
      toolPolicyHash: state.conversation.capabilityProfileHash,
      inputContextHash: args.inputContextHash,
      sourceUrls: [],
      serializedBytes: 0,
      estimatedTokens: 0,
      tokenEstimatorVersion: "js-tiktoken@1.0.21:o200k_base:gpt-5.6-sol-estimate:v1",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    const contextHash = await sha256Hex(normalizedRequest);
    await appendInternalConversationEvent(ctx, state.conversation, {
      eventId: `${state.conversation.conversationId}:${state.conversation.epoch}:research-started:${requestId}`,
      turnId: state.turn.turnId,
      runId: state.turn.runId,
      kind: "research_started",
      contextHash,
      researchArtifactId: requestId,
    }, now);
    await ctx.db.patch(state.turn._id, {
      stage: "researching",
      researchRequestId: requestId,
      researchArtifactId: requestId,
      autonomousPass: args.pass,
      updatedAt: now,
    });
    return { accepted: true as const, duplicate: false, artifactId: requestId };
  },
});

export const recordResearchResult = internalMutation({
  args: {
    actorId: serviceId,
    guildId: serviceId,
    fence: durableStageFenceValidator,
    requestId: serviceId,
    packet: v.optional(v.string()),
    failureCode: v.optional(serviceId),
    failureDetail: v.optional(v.string()),
    failureRetryable: v.optional(v.boolean()),
    freshness: v.optional(v.union(
      v.literal("current"),
      v.literal("limited"),
      v.literal("unknown"),
    )),
    sourceUrls: v.array(v.string()),
    trustedChartArtifactId: v.optional(serviceId),
    trustedChartSpec: v.optional(v.string()),
    serializedBytes: v.number(),
    estimatedTokens: v.number(),
    tokenEstimatorVersion: serviceId,
  },
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const guildId = requireDiscordId(args.guildId, "guildId");
    const requestId = requireDiscordId(args.requestId, "requestId");
    if ((args.packet === undefined) === (args.failureCode === undefined)) {
      return { accepted: false as const, reason: "research_result_invalid" as const };
    }
    if (
      !Number.isSafeInteger(args.serializedBytes)
      || args.serializedBytes < 0
      || args.serializedBytes > 16_384
      || !Number.isSafeInteger(args.estimatedTokens)
      || args.estimatedTokens < 0
      || args.sourceUrls.length > 12
      || (args.packet !== undefined && args.sourceUrls.length === 0)
      || (args.packet !== undefined && args.freshness === undefined)
      || args.tokenEstimatorVersion
        !== "js-tiktoken@1.0.21:o200k_base:gpt-5.6-sol-estimate:v1"
    ) return { accepted: false as const, reason: "research_result_invalid" as const };
    for (const sourceUrl of args.sourceUrls) {
      const url = new URL(sourceUrl);
      if (url.protocol !== "https:") {
        return { accepted: false as const, reason: "research_result_invalid" as const };
      }
    }
    const packet = args.packet === undefined
      ? undefined
      : requireSerializedJson(args.packet, 16_384, "research packet");
    if (
      packet !== undefined
      && new TextEncoder().encode(packet).byteLength !== args.serializedBytes
    ) return { accepted: false as const, reason: "research_result_invalid" as const };
    const failureCode = args.failureCode === undefined
      ? undefined
      : requireDiscordId(args.failureCode, "failureCode");
    const failureDetail = args.failureDetail?.trim();
    if (
      failureCode === undefined
        ? failureDetail !== undefined || args.failureRetryable !== undefined
        : !failureDetail || failureDetail.length > 500 || args.failureRetryable === undefined
    ) return { accepted: false as const, reason: "research_result_invalid" as const };
    const trustedChartSpec = args.trustedChartSpec === undefined
      ? undefined
      : requireSerializedJson(args.trustedChartSpec, 64 * 1_024, "trusted chart spec");
    const now = Date.now();
    const state = await durableStageState(ctx, ownerId, guildId, args.fence, now);
    if (state === null) {
      return { accepted: false as const, reason: "stale_conversation_generation" as const };
    }
    const artifact = await ctx.db
      .query("discordResearchArtifacts")
      .withIndex("by_owner_request", (index) => index
        .eq("ownerId", ownerId)
        .eq("requestId", requestId))
      .unique();
    if (
      artifact === null
      || artifact.conversationId !== state.conversation.conversationId
      || artifact.epoch !== state.conversation.epoch
      || artifact.turnId !== state.turn.turnId
      || artifact.runId !== state.turn.runId
    ) return { accepted: false as const, reason: "research_artifact_not_found" as const };
    if (artifact.status !== "pending") {
      const duplicate = artifact.packet === packet
        && artifact.failureCode === failureCode
        && artifact.failureDetail === failureDetail
        && artifact.failureRetryable === args.failureRetryable
        && artifact.trustedChartSpec === trustedChartSpec
        && artifact.serializedBytes === args.serializedBytes
        && artifact.estimatedTokens === args.estimatedTokens;
      return duplicate
        ? { accepted: true as const, duplicate: true, artifactId: requestId }
        : { accepted: false as const, reason: "stage_request_fingerprint_conflict" as const };
    }
    const packetHash = await sha256Hex(packet ?? `failure:${failureCode}`);
    const artifactPatch: DiscordResearchArtifactPatch = {
      sourceUrls: args.sourceUrls,
      serializedBytes: args.serializedBytes,
      estimatedTokens: args.estimatedTokens,
      tokenEstimatorVersion: args.tokenEstimatorVersion,
      status: packet === undefined ? "failed" : "completed",
      updatedAt: now,
    };
    if (packet !== undefined) artifactPatch.packet = packet;
    if (failureCode !== undefined) artifactPatch.failureCode = failureCode;
    if (failureDetail !== undefined) artifactPatch.failureDetail = failureDetail;
    if (args.failureRetryable !== undefined) {
      artifactPatch.failureRetryable = args.failureRetryable;
    }
    if (args.freshness !== undefined) artifactPatch.freshness = args.freshness;
    if (args.trustedChartArtifactId !== undefined) {
      artifactPatch.trustedChartArtifactId = requireDiscordId(
        args.trustedChartArtifactId,
        "trustedChartArtifactId",
      );
    }
    if (trustedChartSpec !== undefined) artifactPatch.trustedChartSpec = trustedChartSpec;
    await ctx.db.patch(artifact._id, artifactPatch);
    await appendInternalConversationEvent(ctx, state.conversation, {
      eventId: `${state.conversation.conversationId}:${state.conversation.epoch}:research-result:${requestId}`,
      turnId: state.turn.turnId,
      runId: state.turn.runId,
      kind: packet === undefined ? "research_failed" : "research_completed",
      contextHash: packetHash,
      researchArtifactId: requestId,
    }, now);
    await ctx.db.patch(state.turn._id, {
      stage: "research_complete",
      researchArtifactId: requestId,
      researchPacketHash: packetHash,
      updatedAt: now,
    });
    return { accepted: true as const, duplicate: false, artifactId: requestId };
  },
});

export const recordFrontmanResume = internalMutation({
  args: {
    actorId: serviceId,
    guildId: serviceId,
    fence: durableStageFenceValidator,
    requestId: serviceId,
    action: v.union(v.literal("send"), v.literal("suppress"), v.literal("recheck")),
    payload: v.string(),
    acknowledgementDelivery: v.union(
      v.literal("not_required"),
      v.literal("pending"),
      v.literal("sent"),
      v.literal("uncertain"),
    ),
    replyHash: v.optional(v.string()),
    eligibleThroughSequence: v.number(),
    eligibleHumanRevision: v.number(),
    eligibleContextHash: v.string(),
    nextExplicitTriggerSequence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const guildId = requireDiscordId(args.guildId, "guildId");
    const requestId = requireDiscordId(args.requestId, "requestId");
    const payload = requireSerializedJson(args.payload, 32 * 1_024, "frontman resume");
    if (
      !Number.isSafeInteger(args.eligibleThroughSequence)
      || args.eligibleThroughSequence <= 0
      || !Number.isSafeInteger(args.eligibleHumanRevision)
      || args.eligibleHumanRevision < 0
      || !/^[a-f0-9]{16,64}$/.test(args.eligibleContextHash)
      || ((args.action === "send") !== (args.replyHash !== undefined))
      || (args.replyHash !== undefined && !/^[a-f0-9]{64}$/.test(args.replyHash))
    ) return { accepted: false as const, reason: "resume_result_invalid" as const };
    const now = Date.now();
    const state = await durableStageState(ctx, ownerId, guildId, args.fence, now);
    if (state === null) {
      return { accepted: false as const, reason: "stale_conversation_generation" as const };
    }
    if (state.turn.resumePayload !== undefined) {
      const duplicate = state.turn.resumeRequestId === requestId
        && state.turn.resumePayload === payload
        && state.turn.finalAction === args.action
        && state.turn.replyHash === args.replyHash;
      if (duplicate) {
        return { accepted: true as const, duplicate: true, stage: state.turn.stage };
      }
      if (
        state.turn.finalAction !== "recheck"
        || (state.turn.resumeAttempts?.length ?? 1) >= 2
      ) {
        return { accepted: false as const, reason: "stage_request_fingerprint_conflict" as const };
      }
    }
    const resumeAttempts = [
      ...(state.turn.resumeAttempts
        ?? (state.turn.resumePayload === undefined ? [] : [state.turn.resumePayload])),
      payload,
    ];
    const turnPatch: DiscordAssistantTurnPatch = {
      stage: args.action === "send"
        ? "drafted"
        : args.action === "suppress"
          ? "suppressed"
          : "research_complete",
      resumeRequestId: requestId,
      resumePayload: payload,
      resumeAttempts,
      finalAction: args.action,
      acknowledgementDelivery: args.acknowledgementDelivery,
      eligibleThroughSequence: args.eligibleThroughSequence,
      eligibleHumanRevision: args.eligibleHumanRevision,
      eligibleContextHash: args.eligibleContextHash,
      updatedAt: now,
    };
    if (args.replyHash !== undefined) turnPatch.replyHash = args.replyHash;
    if (args.nextExplicitTriggerSequence !== undefined) {
      turnPatch.nextExplicitTriggerSequence = args.nextExplicitTriggerSequence;
    }
    await ctx.db.patch(state.turn._id, turnPatch);
    return {
      accepted: true as const,
      duplicate: false,
      stage: args.action === "send"
        ? "drafted" as const
        : args.action === "suppress"
          ? "suppressed" as const
          : "research_complete" as const,
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
      conversationId: v.optional(serviceId),
      epoch: v.optional(v.number()),
      conversationGeneration: v.optional(v.number()),
      routingGeneration: v.optional(v.number()),
      turnId: v.optional(serviceId),
      conversationLeaseToken: v.optional(serviceId),
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
    const conversation = await assistantConversationByGuild(ctx, state.guildId);
    if (
      conversation === null
      || conversation.ownerId !== ownerId
      || conversation.activeRunId !== runId
      || conversation.activeTurnId !== (args.run.turnId ?? runId)
      || (args.run.conversationId !== undefined && (
        conversation.conversationId !== args.run.conversationId
        || conversation.epoch !== args.run.epoch
        || conversation.generation !== args.run.conversationGeneration
        || conversation.routingGeneration !== args.run.routingGeneration
        || conversation.activeLeaseToken !== args.run.conversationLeaseToken
      ))
    ) {
      return {
        gatewayAccepted: true,
        loopAccepted: false as const,
        reason: "stale_conversation_generation" as const,
      };
    }
    if (conversation.leaseExpiresAt === undefined || conversation.leaseExpiresAt <= now) {
      return {
        gatewayAccepted: true,
        loopAccepted: false as const,
        reason: "conversation_lease_expired" as const,
      };
    }
    const leaseExpiresAt = now + DISCORD_LOOP_LEASE_MS;
    const conversationLeaseExpiresAt = now + DISCORD_CONVERSATION_LEASE_MS;
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
    await ctx.db.patch(conversation._id, {
      leaseExpiresAt: conversationLeaseExpiresAt,
      updatedAt: now,
    });
    const turn = await ctx.db
      .query("discordAssistantTurns")
      .withIndex("by_owner_turn", (index) => index
        .eq("ownerId", ownerId)
        .eq("turnId", args.run!.turnId ?? runId))
      .unique();
    if (turn !== null && nextStatus !== undefined) {
      const turnStage = nextStatus === "triaging"
        ? "planning" as const
        : nextStatus === "acknowledging"
          ? "ack_pending" as const
          : nextStatus === "researching"
            ? "researching" as const
            : nextStatus === "drafting"
              ? "resuming" as const
              : "resuming" as const;
      await ctx.db.patch(turn._id, { stage: turnStage, updatedAt: now });
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
    return {
      gatewayAccepted: true,
      loopAccepted: true as const,
      leaseExpiresAt,
      conversationLeaseExpiresAt,
    };
  },
});

export const completeLoop = internalMutation({
  args: {
    actorId: serviceId,
    channelId: serviceId,
    runId: serviceId,
    generation: v.number(),
    conversation: v.optional(v.object({
      conversationId: serviceId,
      epoch: v.number(),
      generation: v.number(),
      routingGeneration: v.number(),
      turnId: serviceId,
      leaseToken: serviceId,
      eligibleHumanRevision: v.optional(v.number()),
    })),
    outcome: v.union(v.literal("completed"), v.literal("error")),
    recheckRequested: v.optional(v.boolean()),
    consumesThroughSequence: v.optional(v.number()),
    suppressPendingReplies: v.optional(v.boolean()),
    error: v.optional(v.string()),
    retryable: v.optional(v.boolean()),
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
    const conversation = await assistantConversationByGuild(ctx, state.guildId);
    if (
      conversation === null
      || conversation.ownerId !== ownerId
      || conversation.activeRunId !== runId
      || conversation.activeTurnId !== (args.conversation?.turnId ?? runId)
      || (args.conversation !== undefined && (
        conversation.conversationId !== args.conversation.conversationId
        || conversation.epoch !== args.conversation.epoch
        || conversation.generation !== args.conversation.generation
        || conversation.routingGeneration !== args.conversation.routingGeneration
        || conversation.activeLeaseToken !== args.conversation.leaseToken
      ))
    ) {
      return { accepted: false as const, reason: "stale_conversation_generation" as const };
    }
    const turn = await ctx.db
      .query("discordAssistantTurns")
      .withIndex("by_owner_turn", (index) => index
        .eq("ownerId", ownerId)
        .eq("turnId", args.conversation?.turnId ?? runId))
      .unique();
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
    const hasPendingReply = runReplies.some((reply) => (
      reply.status === "pending"
      || reply.status === "delivery_uncertain"
      || reply.status === "needs_reconciliation"
    ) && reply.generation === args.generation);
    const sentFinalReplies = runReplies.filter((reply) => reply.status === "sent"
      && reply.finalizesLoop
      && reply.generation === args.generation);
    const hasSentReply = sentFinalReplies.length > 0;
    if (!activeLease(state, now) && !hasSentReply) {
      return { accepted: false as const, reason: "lease_expired" as const };
    }
    if (
      (conversation.leaseExpiresAt === undefined || conversation.leaseExpiresAt <= now)
      && !hasSentReply
    ) {
      return { accepted: false as const, reason: "conversation_lease_expired" as const };
    }
    if (args.outcome === "completed" && hasPendingReply && !args.suppressPendingReplies) {
      return { accepted: false as const, reason: "pending_outbox" as const };
    }
    if (args.outcome === "error") {
      const error = args.error?.trim() || "Discord agent loop failed.";
      const consecutiveErrorCount = discordNextLoopErrorCount(
        state.consecutiveErrorCount,
        args.retryable ?? true,
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
      if (turn !== null) {
        await ctx.db.patch(turn._id, {
          stage: "failed",
          failureCode: error,
          completedAt: now,
          updatedAt: now,
        });
      }
      await ctx.db.patch(conversation._id, {
        activeTurnId: undefined,
        activeRunId: undefined,
        activeLeaseToken: undefined,
        activeLeaseWorkerId: undefined,
        leaseExpiresAt: undefined,
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

    const requestedContextThroughSequence = args.consumesThroughSequence
      ?? state.activeWindowEnd;
    if (
      !Number.isSafeInteger(requestedContextThroughSequence)
      || requestedContextThroughSequence < state.activeWindowEnd
      || requestedContextThroughSequence > state.latestSequence
    ) {
      return { accepted: false as const, reason: "invalid_context_cutoff" as const };
    }
    if (args.suppressPendingReplies) {
      await invalidateRunOutbox(
        ctx,
        ownerId,
        runId,
        "The final Discord reply was suppressed after the context changed.",
        now,
      );
    }
    const finalContextThroughSequence = sentFinalReplies.reduce(
      (throughSequence, reply) => Math.max(
        throughSequence,
        reply.consumesThroughSequence ?? state.activeWindowEnd!,
      ),
      requestedContextThroughSequence,
    );
    const completedThroughSequence = state.activeMode === "messages"
      ? Math.max(state.completedThroughSequence, finalContextThroughSequence)
      : state.completedThroughSequence;
    const hasPendingMessages = state.triggerThroughSequence > completedThroughSequence;
    const messages = await newestContext(ctx, ownerId, channelId);
    const newestContextHash = discordContextHash(messages);
    const recheckInput: DiscordRecheckInput = {
      requested: false,
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
      nextEligibleAt: catchingUp ? state.nextEligibleAt : undefined,
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
    if (turn !== null) {
      await ctx.db.patch(turn._id, {
        stage: args.suppressPendingReplies ? "suppressed" : "completed",
        finalAction: args.suppressPendingReplies ? "suppress" : "send",
        deliveryState: hasSentReply ? "sent" : "not_required",
        completedAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(conversation._id, {
      activeTurnId: undefined,
      activeRunId: undefined,
      activeLeaseToken: undefined,
      activeLeaseWorkerId: undefined,
      leaseExpiresAt: undefined,
      lastSuccessfulActivityAt: now,
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
    conversation: v.optional(v.object({
      conversationId: serviceId,
      epoch: v.number(),
      generation: v.number(),
      routingGeneration: v.number(),
      turnId: serviceId,
      leaseToken: serviceId,
      eligibleHumanRevision: v.optional(v.number()),
    })),
    idempotencyKey: serviceId,
    replyKind: v.optional(discordReplyKindValidator),
    content: v.string(),
    chart: v.optional(discordMarketChartValidator),
    replyToMessageId: v.optional(serviceId),
    consumesThroughSequence: v.optional(v.number()),
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
    const content = requireDiscordReplyContent(
      args.content,
      replyKind === "acknowledgement" ? 320 : 2_000,
    );
    const chart = requireMarketChart(args.chart);
    const now = Date.now();
    const sourceState = await discordChannelState(ctx, ownerId, sourceChannelId);
    if (!sourceState || !isCurrentDiscordGeneration(sourceState, runId, args.generation)) {
      return { accepted: false as const, reason: "stale_generation" as const };
    }
    if (!activeLease(sourceState, now)) {
      return { accepted: false as const, reason: "lease_expired" as const };
    }
    const conversation = await assistantConversationByGuild(ctx, guildId);
    if (conversation === null || conversation.ownerId !== ownerId) {
      return { accepted: false as const, reason: "conversation_not_found" as const };
    }
    if (args.conversation !== undefined && !isCurrentDiscordConversationFence(
      conversation,
      {
        ownerId,
        ownerBindingVersion: conversation.ownerBindingVersion,
        conversationId: requireDiscordId(args.conversation.conversationId, "conversationId"),
        epoch: args.conversation.epoch,
        generation: args.conversation.generation,
        routingGeneration: args.conversation.routingGeneration,
        turnId: requireDiscordId(args.conversation.turnId, "turnId"),
        runId,
        leaseToken: requireDiscordId(args.conversation.leaseToken, "leaseToken"),
      },
      now,
    )) {
      return { accepted: false as const, reason: "stale_conversation_generation" as const };
    }
    const turn = await ctx.db
      .query("discordAssistantTurns")
      .withIndex("by_owner_turn", (index) => index
        .eq("ownerId", ownerId)
        .eq("turnId", args.conversation?.turnId ?? runId))
      .unique();
    if (
      args.finalizesLoop
      && args.conversation?.eligibleHumanRevision !== undefined
      && turn?.eligibleHumanRevision !== args.conversation.eligibleHumanRevision
    ) {
      return { accepted: false as const, reason: "stale_human_revision" as const };
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
    if (replyKind !== "final" && (chart !== undefined || args.consumesThroughSequence !== undefined)) {
      return { accepted: false as const, reason: "invalid_reply_attachment" as const };
    }
    if (
      args.consumesThroughSequence !== undefined
      && (
        !Number.isSafeInteger(args.consumesThroughSequence)
        || args.consumesThroughSequence < (sourceState.activeWindowEnd ?? 0)
        || args.consumesThroughSequence > sourceState.latestSequence
      )
    ) {
      return { accepted: false as const, reason: "invalid_context_cutoff" as const };
    }
    if (!discordReplyKindMatchesFlags(replyKind, args.finalizesLoop, args.recheckRequested)) {
      return { accepted: false as const, reason: "non_final_reply_cannot_recheck" as const };
    }
    if (replyKind === "acknowledgement" && args.replyToMessageId !== undefined) {
      const priorAcknowledgements = await ctx.db
        .query("discordOutbox")
        .withIndex("by_owner_source_reply", (index) => index
          .eq("ownerId", ownerId)
          .eq("sourceChannelId", sourceChannelId)
          .eq("replyToMessageId", args.replyToMessageId))
        .collect();
      const delivered = priorAcknowledgements.find((reply) =>
        isDeliveredDiscordAcknowledgement(
          reply,
          sourceChannelId,
          guildId,
          channelId,
          args.replyToMessageId,
        )
      );
      if (delivered) {
        return {
          accepted: true as const,
          duplicate: true,
          outboxId: delivered.outboxId,
          status: delivered.status,
        };
      }
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
      if (
        replyKind === "acknowledgement"
        && isDeliveredDiscordAcknowledgement(
          existing,
          sourceChannelId,
          guildId,
          channelId,
          args.replyToMessageId,
        )
      ) {
        return {
          accepted: true as const,
          duplicate: true,
          outboxId: existing.outboxId,
          status: existing.status,
        };
      }
      const same = existing.sourceChannelId === sourceChannelId
        && existing.guildId === guildId
        && existing.channelId === channelId
        && existing.runId === runId
        && existing.generation === args.generation
        && existingReplyKind === replyKind
        && existing.content === content
        && JSON.stringify(existing.chart) === JSON.stringify(chart)
        && existing.recheckRequested === args.recheckRequested
        && existing.finalizesLoop === args.finalizesLoop
        && existing.replyToMessageId === args.replyToMessageId
        && existing.consumesThroughSequence === args.consumesThroughSequence;
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
    const outboxId = idempotencyKey;
    const payloadHash = await sha256Hex(canonicalJson({
      guildId,
      channelId,
      content,
      chart: chart ?? null,
      replyToMessageId: args.replyToMessageId ?? null,
    }));
    const nonce = (await sha256Hex(`discord-outbox:${ownerId}:${outboxId}`)).slice(0, 24);
    const canonicalKind = replyKind === "acknowledgement"
      ? "assistant_ack" as const
      : replyKind === "final"
        ? "assistant_final" as const
        : undefined;
    const canonicalEventId = canonicalKind === undefined
      ? undefined
      : `${conversation.conversationId}:${conversation.epoch}:${canonicalKind}:${outboxId}`;
    const canonicalOrdinal = canonicalKind === undefined ? undefined : conversation.nextOrdinal;
    const conversationLeaseToken = args.conversation?.leaseToken
      ?? conversation.activeLeaseToken;
    const outboxRecord: DiscordOutboxRecord = {
      ownerId,
      ownerBindingVersion: conversation.ownerBindingVersion,
      conversationId: conversation.conversationId,
      epoch: conversation.epoch,
      conversationGeneration: conversation.generation,
      routingGeneration: conversation.routingGeneration,
      turnId: args.conversation?.turnId ?? runId,
      sourceGuildId: sourceState.guildId,
      sourceChannelId,
      guildId,
      channelId,
      outboxId,
      idempotencyKey,
      nonce,
      payloadHash,
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
    if (conversationLeaseToken !== undefined) {
      outboxRecord.conversationLeaseToken = conversationLeaseToken;
    }
    if (canonicalEventId !== undefined) outboxRecord.canonicalEventId = canonicalEventId;
    if (canonicalOrdinal !== undefined) outboxRecord.canonicalOrdinal = canonicalOrdinal;
    if (args.replyToMessageId !== undefined) outboxRecord.replyToMessageId = args.replyToMessageId;
    if (chart !== undefined) outboxRecord.chart = chart;
    if (args.consumesThroughSequence !== undefined) {
      outboxRecord.consumesThroughSequence = args.consumesThroughSequence;
    }
    await ctx.db.insert("discordOutbox", outboxRecord);
    if (canonicalKind !== undefined && canonicalEventId !== undefined && canonicalOrdinal !== undefined) {
      await ctx.db.insert("discordConversationEvents", {
        ownerId,
        ownerBindingVersion: conversation.ownerBindingVersion,
        guildId,
        conversationId: conversation.conversationId,
        epoch: conversation.epoch,
        eventId: canonicalEventId,
        ordinal: canonicalOrdinal,
        revision: conversation.revision,
        humanRevision: conversation.humanRevision,
        turnId: args.conversation?.turnId ?? runId,
        runId,
        kind: canonicalKind,
        visibility: "conversation",
        status: "pending",
        sourceChannelId: channelId,
        content,
        contextHash: payloadHash,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(conversation._id, {
        nextOrdinal: conversation.nextOrdinal + 1,
        updatedAt: now,
      });
    }
    if (turn !== null) {
      const turnPatch: DiscordAssistantTurnPatch = {
        stage: "delivery_pending",
        deliveryState: "pending",
        updatedAt: now,
      };
      if (replyKind === "acknowledgement") {
        turnPatch.acknowledgementIdempotencyKey = idempotencyKey;
      } else if (replyKind === "final") {
        turnPatch.replyIdempotencyKey = idempotencyKey;
        turnPatch.replyHash = payloadHash;
      }
      await ctx.db.patch(turn._id, turnPatch);
    }
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
  images: DiscordImageAttachment[] | undefined,
  now: number,
): Promise<void> {
  const channel = await discordChannel(ctx, outbox.ownerId, outbox.guildId, outbox.channelId);
  if (!channel?.available) return;
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
      mentionsBot: false,
      isBot: true,
      createdAt: now,
    };
    if (images !== undefined) acknowledgedReply.images = images;
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
    mentionsBot: false,
    isBot: true,
    createdAt: now,
    receivedAt: now,
  };
  if (images !== undefined) messageRecord.images = images;
  if (outbox.replyToMessageId !== undefined) messageRecord.replyToMessageId = outbox.replyToMessageId;
  await ctx.db.insert("discordMessages", messageRecord);
  await ctx.db.patch(state._id, { latestSequence: sequence, updatedAt: now });
}

async function commitCanonicalAssistantDelivery(
  ctx: DiscordWriter & DiscordReader,
  outbox: Doc<"discordOutbox">,
  discordMessageId: string,
  now: number,
): Promise<void> {
  if (outbox.canonicalEventId === undefined) return;
  const event = await ctx.db
    .query("discordConversationEvents")
    .withIndex("by_owner_event", (index) => index
      .eq("ownerId", outbox.ownerId)
      .eq("eventId", outbox.canonicalEventId!))
    .unique();
  if (event === null) throw new Error("Canonical assistant event was not reserved.");
  if (event.status === "committed") {
    if (event.discordDeliveryId !== discordMessageId) {
      throw new Error("Canonical Discord delivery conflicts with the committed event.");
    }
    return;
  }
  const conversation = await assistantConversationByGuild(ctx, outbox.guildId);
  const currentEpoch = conversation !== null
    && conversation.ownerId === outbox.ownerId
    && conversation.ownerBindingVersion === outbox.ownerBindingVersion
    && conversation.conversationId === outbox.conversationId
    && conversation.epoch === outbox.epoch;
  const revision = currentEpoch ? conversation.revision + 1 : event.revision;
  await ctx.db.patch(event._id, {
    status: "committed",
    revision,
    discordDeliveryId: discordMessageId,
    committedAt: now,
    updatedAt: now,
  });
  if (currentEpoch) {
    await ctx.db.patch(conversation._id, {
      revision,
      lastSuccessfulActivityAt: now,
      updatedAt: now,
    });
  }
}

export const beginReplyDelivery = internalMutation({
  args: {
    actorId: serviceId,
    outboxId: serviceId,
    deliveryToken: serviceId,
  },
  handler: async (ctx, args) => {
    const ownerId = requireDiscordOwnerId(args.actorId);
    const outboxId = requireDiscordId(args.outboxId, "outboxId");
    const deliveryToken = requireDiscordId(args.deliveryToken, "deliveryToken");
    const outbox = await ctx.db
      .query("discordOutbox")
      .withIndex("by_owner_outbox", (index) => index
        .eq("ownerId", ownerId)
        .eq("outboxId", outboxId))
      .unique();
    if (outbox === null) {
      return { accepted: false as const, reason: "outbox_not_found" as const };
    }
    if (outbox.status === "sent" || outbox.status === "finalized") {
      return { accepted: false as const, reason: "reply_already_sent" as const };
    }
    if (outbox.status === "needs_reconciliation" || outbox.status === "cancelled") {
      return { accepted: false as const, reason: "delivery_requires_reconciliation" as const };
    }
    if (outbox.status === "failed") {
      return { accepted: false as const, reason: "reply_failed" as const };
    }
    if (outbox.deliveryToken !== deliveryToken) {
      return { accepted: false as const, reason: "stale_delivery_lease" as const };
    }
    const now = Date.now();
    const sourceState = await discordChannelState(ctx, ownerId, outbox.sourceChannelId);
    if (
      sourceState === null
      || !isCurrentDiscordGeneration(sourceState, outbox.runId, outbox.generation)
      || !activeLease(sourceState, now)
    ) {
      return { accepted: false as const, reason: "stale_generation" as const };
    }
    if (outbox.conversationId !== undefined) {
      const conversation = await assistantConversationByGuild(ctx, outbox.sourceGuildId);
      if (
        conversation === null
        || conversation.ownerId !== ownerId
        || conversation.ownerBindingVersion !== outbox.ownerBindingVersion
        || conversation.conversationId !== outbox.conversationId
        || conversation.epoch !== outbox.epoch
        || conversation.generation !== outbox.conversationGeneration
        || conversation.routingGeneration !== outbox.routingGeneration
        || conversation.activeTurnId !== outbox.turnId
        || conversation.activeRunId !== outbox.runId
        || conversation.activeLeaseToken !== outbox.conversationLeaseToken
        || conversation.leaseExpiresAt === undefined
        || conversation.leaseExpiresAt <= now
      ) {
        return { accepted: false as const, reason: "stale_conversation_generation" as const };
      }
    }
    if (outbox.status === "delivery_uncertain") {
      return {
        accepted: true as const,
        duplicate: true,
        status: "delivery_uncertain" as const,
        attempts: outbox.attempts,
      };
    }
    await ctx.db.patch(outbox._id, {
      status: "delivery_uncertain",
      attempts: outbox.attempts + 1,
      uncertainAt: now,
      updatedAt: now,
    });
    return {
      accepted: true as const,
      duplicate: false,
      status: "delivery_uncertain" as const,
      attempts: outbox.attempts + 1,
    };
  },
});

export const acknowledgeReply = internalMutation({
  args: {
    actorId: serviceId,
    outboxId: serviceId,
    deliveryToken: serviceId,
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("uncertain")),
    discordMessageId: v.optional(serviceId),
    images: v.optional(v.array(discordImageAttachmentValidator)),
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
    const images = requireDiscordImages(args.images);
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
      if (
        outbox.deliveryToken !== deliveryToken
        && outbox.status !== "delivery_uncertain"
        && outbox.status !== "needs_reconciliation"
      ) {
        return { accepted: false as const, reason: "stale_delivery_lease" as const };
      }
      const sourceState = await discordChannelState(ctx, ownerId, outbox.sourceChannelId);
      const currentConversation = await assistantConversationByGuild(ctx, outbox.guildId);
      const currentEpoch = currentConversation !== null
        && currentConversation.ownerId === ownerId
        && currentConversation.conversationId === outbox.conversationId
        && currentConversation.epoch === outbox.epoch;
      if (currentEpoch && !isCurrentDiscordGeneration(sourceState, outbox.runId, outbox.generation)) {
        return { accepted: false as const, reason: "stale_generation" as const };
      }
      await ctx.db.patch(outbox._id, {
        status: "sent",
        attempts: outbox.status === "pending" ? outbox.attempts + 1 : outbox.attempts,
        discordMessageId,
        lastError: undefined,
        deliveryWorkerId: undefined,
        deliveryToken: undefined,
        deliveryLeaseExpiresAt: undefined,
        sentAt: now,
        updatedAt: now,
      });
      await ingestAcknowledgedBotReply(ctx, outbox, discordMessageId, images, now);
      await commitCanonicalAssistantDelivery(ctx, outbox, discordMessageId, now);
      const turn = outbox.turnId === undefined
        ? null
        : await ctx.db
          .query("discordAssistantTurns")
          .withIndex("by_owner_turn", (index) => index
            .eq("ownerId", ownerId)
            .eq("turnId", outbox.turnId!))
          .unique();
      if (turn !== null) {
        await ctx.db.patch(turn._id, { deliveryState: "sent", updatedAt: now });
      }
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
    const attempts = outbox.status === "pending" ? outbox.attempts + 1 : outbox.attempts;
    if (args.status === "uncertain") {
      await ctx.db.patch(outbox._id, {
        status: "delivery_uncertain",
        attempts,
        uncertainAt: outbox.uncertainAt ?? now,
        lastError: args.error?.trim() || "Discord delivery outcome is uncertain.",
        deliveryWorkerId: undefined,
        deliveryToken: undefined,
        deliveryLeaseExpiresAt: undefined,
        updatedAt: now,
      });
      await recordActivity(ctx, ownerId, {
        eventId: `${outbox.outboxId}:delivery-uncertain`,
        guildId: outbox.sourceGuildId,
        channelId: outbox.sourceChannelId,
        runId: outbox.runId,
        eventType: "delivery_uncertain",
        replyKind: outbox.replyKind
          ?? (outbox.finalizesLoop ? "final" : "research_log"),
      }, now);
      return {
        accepted: true as const,
        duplicate: false,
        status: "delivery_uncertain" as const,
        attempts,
      };
    }
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
    if (!retryable && outbox.canonicalEventId !== undefined) {
      const event = await ctx.db
        .query("discordConversationEvents")
        .withIndex("by_owner_event", (index) => index
          .eq("ownerId", ownerId)
          .eq("eventId", outbox.canonicalEventId!))
        .unique();
      if (event !== null && event.status === "pending") {
        await ctx.db.patch(event._id, { status: "failed", updatedAt: now });
      }
    }
    if (!retryable && outbox.turnId !== undefined) {
      const turn = await ctx.db
        .query("discordAssistantTurns")
        .withIndex("by_owner_turn", (index) => index
          .eq("ownerId", ownerId)
          .eq("turnId", outbox.turnId!))
        .unique();
      if (turn !== null) {
        await ctx.db.patch(turn._id, {
          deliveryState: "failed",
          updatedAt: now,
        });
      }
    }
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
      const debounceReady = state.recheckPending
        || state.nextEligibleAt === undefined
        || state.nextEligibleAt <= now
        || (leaseExpired && state.activeMode === "recheck");
      const runnable = (!state.activeRunId || leaseExpired)
        && (state.status !== "error" || retryableError)
        && debounceReady
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
      if (
        !channel?.available
        || (
          !hasRole(channel, "conversation_monitor")
          && state.triggerThroughSequence <= state.completedThroughSequence
        )
      ) continue;
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
    const uncertainReplies = await ctx.db
      .query("discordOutbox")
      .withIndex("by_owner_status_createdAt", (index) => index
        .eq("ownerId", ownerId)
        .eq("status", "delivery_uncertain"))
      .order("asc")
      .collect();
    const replies: RunnableOutboxReply[] = [];
    for (const reply of [...pendingReplies, ...uncertainReplies, ...sentReplies]
      .sort((left, right) => left.createdAt - right.createdAt)) {
      if (
        reply.status === "delivery_uncertain"
        && (reply.uncertainAt ?? reply.updatedAt) + DISCORD_NONCE_RETRY_WINDOW_MS <= now
      ) {
        await ctx.db.patch(reply._id, {
          status: "needs_reconciliation",
          deliveryWorkerId: undefined,
          deliveryToken: undefined,
          deliveryLeaseExpiresAt: undefined,
          updatedAt: now,
        });
        await recordActivity(ctx, ownerId, {
          eventId: `${reply.outboxId}:delivery-reconciliation-required`,
          guildId: reply.sourceGuildId,
          channelId: reply.sourceChannelId,
          runId: reply.runId,
          eventType: "delivery_reconciliation_required",
          replyKind: reply.replyKind
            ?? (reply.finalizesLoop ? "final" : "research_log"),
        }, now);
        continue;
      }
      const state = await discordChannelState(ctx, ownerId, reply.sourceChannelId);
      if (!isCurrentDiscordGeneration(state, reply.runId, reply.generation)) continue;
      const conversation = reply.conversationId === undefined
        ? null
        : await assistantConversationByGuild(ctx, reply.sourceGuildId);
      if (
        reply.conversationId !== undefined
        && (
          conversation === null
          || conversation.ownerId !== ownerId
          || conversation.ownerBindingVersion !== reply.ownerBindingVersion
          || conversation.conversationId !== reply.conversationId
          || conversation.epoch !== reply.epoch
          || conversation.generation !== reply.conversationGeneration
          || conversation.routingGeneration !== reply.routingGeneration
          || conversation.activeTurnId !== reply.turnId
          || conversation.activeRunId !== reply.runId
          || conversation.activeLeaseToken !== reply.conversationLeaseToken
        )
      ) continue;
      if (reply.status === "sent") {
        if (!reply.finalizesLoop) continue;
        if (hasPendingDiscordReply(
          [...pendingReplies, ...uncertainReplies],
          reply.runId,
          reply.generation,
        )) continue;
        replies.push({ reply });
        if (replies.length >= limit) break;
        continue;
      }
      if (!state || !activeLease(state, now)) continue;
      let nonce = reply.nonce;
      let payloadHash = reply.payloadHash;
      if (nonce === undefined || payloadHash === undefined) {
        nonce = (await sha256Hex(`discord-outbox:${ownerId}:${reply.outboxId}`)).slice(0, 24);
        payloadHash = await sha256Hex(canonicalJson({
          guildId: reply.guildId,
          channelId: reply.channelId,
          content: reply.content,
          chart: reply.chart ?? null,
          replyToMessageId: reply.replyToMessageId ?? null,
        }));
        await ctx.db.patch(reply._id, { nonce, payloadHash, updatedAt: now });
      }
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
      replies.push({ reply: { ...reply, nonce, payloadHash }, deliveryToken });
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
        conversationId: reply.conversationId,
        epoch: reply.epoch,
        conversationGeneration: reply.conversationGeneration,
        routingGeneration: reply.routingGeneration,
        turnId: reply.turnId,
        conversationLeaseToken: reply.conversationLeaseToken,
        replyKind: reply.replyKind,
        status: reply.status === "sent" ? "sent" as const : "pending" as const,
        deliveryState: reply.status,
        content: reply.content,
        chart: reply.chart,
        replyToMessageId: reply.replyToMessageId,
        consumesThroughSequence: reply.consumesThroughSequence,
        recheckRequested: reply.recheckRequested,
        finalizesLoop: reply.finalizesLoop,
        discordMessageId: reply.discordMessageId,
        deliveryToken,
        nonce: reply.nonce,
        payloadHash: reply.payloadHash,
        attempts: reply.attempts,
        createdAt: reply.createdAt,
      })),
    };
  },
});
