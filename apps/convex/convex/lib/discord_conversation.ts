import { z } from "zod";

export const DISCORD_CONVERSATION_LEASE_MS = 120_000;
export const DISCORD_PORTABLE_CHECKPOINT_MAX_BYTES = 512 * 1_024;
export const DISCORD_PORTABLE_CHECKPOINT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const DISCORD_EPOCH_MS = 1_420_070_400_000;
const DISCORD_SNOWFLAKE_LOW_BITS = (1n << 22n) - 1n;

export function discordSnowflakeUpperBound(timestamp: number): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < DISCORD_EPOCH_MS) {
    throw new Error("Discord privacy boundary timestamp is invalid.");
  }
  return (
    (BigInt(timestamp - DISCORD_EPOCH_MS) << 22n)
    | DISCORD_SNOWFLAKE_LOW_BITS
  ).toString();
}

export function discordPrivacyDeletionBlocked(
  guildId: string,
  replies: readonly {
    guildId: string;
    sourceGuildId: string;
    status: string;
  }[],
): boolean {
  return replies.some((reply) =>
    (reply.guildId === guildId || reply.sourceGuildId === guildId)
    && (
      reply.status === "delivery_uncertain"
      || reply.status === "needs_reconciliation"
    )
  );
}
export const DISCORD_RECENT_TAIL_TOKEN_BUDGET = 20_000;
export const DISCORD_LUNA_CONTEXT_WINDOW = 272_000;
export const DISCORD_COMPACTION_THRESHOLD_TOKENS = 190_400;
export const DISCORD_MAX_RECENT_EVENT_COUNT = 2_000;
export const DISCORD_PORTABLE_CHECKPOINT_MAX_SOURCE_EVENT_COUNT = 5_000;
export const DISCORD_RECENT_TAIL_ESTIMATOR_VERSION =
  "utf8-bytes-div-3-plus-message-overhead:v1";

export const DISCORD_PERSONALITY_PROFILE = {
  personalityVersion: "trishula-discord-v1",
  systemPromptHash: "f1f979696d2c9f22d96b8370c3ff2c032ad7ee440dc6e79f6634a947b8c52cd1",
  capabilityProfileHash: "6f3622ba2fe1175602dcc05d0421a5399a729a63daba6ba3cd854ade9cc6b2be",
  lunaModel: "gpt-5.6-luna",
  lunaReasoningEffort: "xhigh",
  lunaServiceTier: "priority",
  solModel: "gpt-6-astra",
  solReasoningEffort: "max",
  solServiceTier: "priority",
} as const;

const stableEventId = z.string().trim().min(1).max(256)
  .regex(/^[A-Za-z0-9:_-]+$/);
const authorId = z.string().regex(/^\d{1,32}$/);
const sourceEventIds = z.array(stableEventId).min(1).max(64);
const isoDateTime = z.iso.datetime({ offset: true });

export const portableConversationSummarySchema = z.object({
  participants: z.array(z.object({
    authorId,
    displayName: z.string().trim().min(1).max(100).optional(),
  }).strict()).max(100),
  acceptedFacts: z.array(z.object({
    statement: z.string().trim().min(1).max(1_000),
    subjectAuthorId: authorId.optional(),
    assertedByAuthorId: authorId.optional(),
    sourceEventIds,
    asOf: isoDateTime.optional(),
    freshness: z.enum(["current", "limited", "unknown"]).optional(),
  }).strict()).max(100),
  corrections: z.array(z.object({
    rejectedStatement: z.string().trim().min(1).max(1_000),
    replacementStatement: z.string().trim().min(1).max(1_000),
    correctedByAuthorId: authorId.optional(),
    sourceEventIds,
    asOf: isoDateTime.optional(),
  }).strict()).max(100),
  unresolvedQuestions: z.array(z.object({
    question: z.string().trim().min(1).max(1_000),
    askedByAuthorId: authorId,
    sourceEventIds,
  }).strict()).max(100),
  commitments: z.array(z.object({
    statement: z.string().trim().min(1).max(1_000),
    owner: z.union([
      z.object({ kind: z.literal("assistant") }).strict(),
      z.object({ kind: z.literal("participant"), authorId }).strict(),
    ]),
    status: z.enum(["open", "resolved", "cancelled"]),
    sourceEventIds,
  }).strict()).max(100),
  conversationPreferences: z.array(z.object({
    statement: z.string().trim().min(1).max(1_000),
    authorId,
    sourceEventIds,
  }).strict()).max(100),
  sourceFreshnessNotes: z.array(z.object({
    statement: z.string().trim().min(1).max(1_000),
    sourceEventIds,
    asOf: isoDateTime.optional(),
    freshness: z.enum(["current", "limited", "unknown"]),
  }).strict()).max(100),
}).strict();

type PortableConversationSummary = z.infer<typeof portableConversationSummarySchema>;

export interface PortableSummaryEvidenceEvent {
  eventId: string;
  authorId?: string;
}

export function portableSummaryEvidenceMatchesEvents(
  summary: PortableConversationSummary,
  events: readonly PortableSummaryEvidenceEvent[],
): boolean {
  const eventsById = new Map(events.map((event) => [event.eventId, event]));
  const knownAuthorIds = new Set(events.flatMap((event) =>
    event.authorId === undefined ? [] : [event.authorId]
  ));
  const sourcesExist = (sourceIds: readonly string[]) =>
    sourceIds.every((eventId) => eventsById.has(eventId));
  const authorCitedOwnEvent = (authorId: string, sourceIds: readonly string[]) =>
    sourceIds.some((eventId) => eventsById.get(eventId)?.authorId === authorId);

  return summary.participants.every((participant) => knownAuthorIds.has(participant.authorId))
    && summary.acceptedFacts.every((fact) =>
      sourcesExist(fact.sourceEventIds)
      && (fact.subjectAuthorId === undefined || knownAuthorIds.has(fact.subjectAuthorId))
      && (
        fact.assertedByAuthorId === undefined
        || authorCitedOwnEvent(fact.assertedByAuthorId, fact.sourceEventIds)
      )
    )
    && summary.corrections.every((correction) =>
      sourcesExist(correction.sourceEventIds)
      && (
        correction.correctedByAuthorId === undefined
        || authorCitedOwnEvent(correction.correctedByAuthorId, correction.sourceEventIds)
      )
    )
    && summary.unresolvedQuestions.every((question) =>
      sourcesExist(question.sourceEventIds)
      && authorCitedOwnEvent(question.askedByAuthorId, question.sourceEventIds)
    )
    && summary.commitments.every((commitment) =>
      sourcesExist(commitment.sourceEventIds)
      && (
        commitment.owner.kind === "assistant"
        || authorCitedOwnEvent(commitment.owner.authorId, commitment.sourceEventIds)
      )
    )
    && summary.conversationPreferences.every((preference) =>
      sourcesExist(preference.sourceEventIds)
      && authorCitedOwnEvent(preference.authorId, preference.sourceEventIds)
    )
    && summary.sourceFreshnessNotes.every((note) => sourcesExist(note.sourceEventIds));
}

export function portableCheckpointSourceBatchSupported(sourceEventCount: number): boolean {
  return Number.isSafeInteger(sourceEventCount)
    && sourceEventCount > 0
    && sourceEventCount <= DISCORD_PORTABLE_CHECKPOINT_MAX_SOURCE_EVENT_COUNT;
}

export function discordConversationId(guildId: string): string {
  return `discord:${guildId}`;
}

export interface DiscordConversationFence {
  ownerId: string;
  ownerBindingVersion: number;
  guildId: string;
  conversationId: string;
  epoch: number;
  generation: number;
  routingGeneration: number;
  activeTurnId?: string;
  activeRunId?: string;
  activeLeaseToken?: string;
  leaseExpiresAt?: number;
}

export function isCurrentDiscordConversationFence(
  conversation: DiscordConversationFence | null,
  expected: Pick<
    DiscordConversationFence,
    | "ownerId"
    | "ownerBindingVersion"
    | "conversationId"
    | "epoch"
    | "generation"
    | "routingGeneration"
  > & { turnId: string; runId: string; leaseToken: string },
  now: number,
): boolean {
  return conversation !== null
    && conversation.ownerId === expected.ownerId
    && conversation.ownerBindingVersion === expected.ownerBindingVersion
    && conversation.conversationId === expected.conversationId
    && conversation.epoch === expected.epoch
    && conversation.generation === expected.generation
    && conversation.routingGeneration === expected.routingGeneration
    && conversation.activeTurnId === expected.turnId
    && conversation.activeRunId === expected.runId
    && conversation.activeLeaseToken === expected.leaseToken
    && conversation.leaseExpiresAt !== undefined
    && conversation.leaseExpiresAt > now;
}

export function discordConversationLeaseToken(
  conversationId: string,
  epoch: number,
  generation: number,
  turnId: string,
  workerId: string,
): string {
  const source = [conversationId, epoch, generation, turnId, workerId].join("\u001f");
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

export function discordUnicodeLength(value: string): number {
  return Array.from(value).length;
}

export function requireDiscordReplyContent(
  value: string,
  maximum = 2_000,
): string {
  const normalized = value.trim();
  if (!normalized || discordUnicodeLength(normalized) > maximum) {
    throw new Error(`Discord content must contain at most ${maximum} Unicode characters.`);
  }
  return normalized;
}

export interface DiscordCanonicalTailEvent {
  eventId: string;
  ordinal: number;
  content: string;
}

export interface DiscordCanonicalTailSelection<Event extends DiscordCanonicalTailEvent> {
  events: Event[];
  estimatedTokens: number;
  omittedEventCount: number;
  firstRetainedOrdinal?: number;
  lastRetainedOrdinal?: number;
  complete: boolean;
}

/**
 * Convex cannot load the provider tokenizer. This deliberately conservative,
 * versioned estimator lets it enforce a stable replay budget. Pi records its
 * exact research-packet estimator separately.
 */
export function estimateDiscordCanonicalEventTokens(
  event: DiscordCanonicalTailEvent,
): number {
  const serializedBytes = new TextEncoder().encode(JSON.stringify({
    eventId: event.eventId,
    ordinal: event.ordinal,
    content: event.content,
  })).byteLength;
  return Math.ceil(serializedBytes / 3) + 8;
}

export function selectDiscordCanonicalTail<Event extends DiscordCanonicalTailEvent>(
  orderedEvents: readonly Event[],
  options: {
    tokenBudget?: number;
    requiredEventIds?: ReadonlySet<string>;
    maximumEvents?: number;
  } = {},
): DiscordCanonicalTailSelection<Event> {
  const tokenBudget = options.tokenBudget ?? DISCORD_RECENT_TAIL_TOKEN_BUDGET;
  const maximumEvents = options.maximumEvents ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0) {
    throw new Error("Discord canonical tail token budget must be positive.");
  }
  if (!Number.isSafeInteger(maximumEvents) || maximumEvents <= 0) {
    throw new Error("Discord canonical tail event limit must be positive.");
  }
  for (let index = 1; index < orderedEvents.length; index += 1) {
    if (orderedEvents[index - 1]!.ordinal >= orderedEvents[index]!.ordinal) {
      throw new Error("Discord canonical tail events must use increasing ordinals.");
    }
  }

  const requiredEventIds = options.requiredEventIds ?? new Set<string>();
  const retained = new Set<string>();
  let estimatedTokens = 0;
  for (const event of orderedEvents) {
    if (!requiredEventIds.has(event.eventId)) continue;
    retained.add(event.eventId);
    estimatedTokens += estimateDiscordCanonicalEventTokens(event);
  }
  if (retained.size > maximumEvents) {
    throw new Error("Required Discord canonical events exceed the event limit.");
  }
  for (let index = orderedEvents.length - 1; index >= 0; index -= 1) {
    if (retained.size >= maximumEvents) break;
    const event = orderedEvents[index]!;
    if (retained.has(event.eventId)) continue;
    const eventTokens = estimateDiscordCanonicalEventTokens(event);
    if (estimatedTokens + eventTokens > tokenBudget) continue;
    retained.add(event.eventId);
    estimatedTokens += eventTokens;
  }

  const events = orderedEvents.filter((event) => retained.has(event.eventId));
  const selection: DiscordCanonicalTailSelection<Event> = {
    events,
    estimatedTokens,
    omittedEventCount: orderedEvents.length - events.length,
    complete: events.length === orderedEvents.length,
  };
  const firstEvent = events[0];
  const lastEvent = events.at(-1);
  if (firstEvent !== undefined) selection.firstRetainedOrdinal = firstEvent.ordinal;
  if (lastEvent !== undefined) selection.lastRetainedOrdinal = lastEvent.ordinal;
  return selection;
}

/** Selects the newest contiguous event suffix used after a portable checkpoint. */
export function selectDiscordCheckpointTail<Event extends DiscordCanonicalTailEvent>(
  orderedEvents: readonly Event[],
  options: { tokenBudget?: number; maximumEvents?: number } = {},
): DiscordCanonicalTailSelection<Event> {
  const tokenBudget = options.tokenBudget ?? DISCORD_RECENT_TAIL_TOKEN_BUDGET;
  const maximumEvents = options.maximumEvents ?? DISCORD_MAX_RECENT_EVENT_COUNT;
  if (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0) {
    throw new Error("Discord checkpoint tail token budget must be positive.");
  }
  if (!Number.isSafeInteger(maximumEvents) || maximumEvents <= 0) {
    throw new Error("Discord checkpoint tail event limit must be positive.");
  }
  for (let index = 1; index < orderedEvents.length; index += 1) {
    if (orderedEvents[index - 1]!.ordinal >= orderedEvents[index]!.ordinal) {
      throw new Error("Discord checkpoint tail events must use increasing ordinals.");
    }
  }

  let firstRetainedIndex = orderedEvents.length;
  let estimatedTokens = 0;
  for (let index = orderedEvents.length - 1; index >= 0; index -= 1) {
    if (orderedEvents.length - index > maximumEvents) break;
    const eventTokens = estimateDiscordCanonicalEventTokens(orderedEvents[index]!);
    if (estimatedTokens + eventTokens > tokenBudget) break;
    estimatedTokens += eventTokens;
    firstRetainedIndex = index;
  }
  const events = orderedEvents.slice(firstRetainedIndex);
  const selection: DiscordCanonicalTailSelection<Event> = {
    events,
    estimatedTokens,
    omittedEventCount: firstRetainedIndex,
    complete: firstRetainedIndex === 0,
  };
  if (events[0] !== undefined) selection.firstRetainedOrdinal = events[0].ordinal;
  if (events.at(-1) !== undefined) selection.lastRetainedOrdinal = events.at(-1)!.ordinal;
  return selection;
}

export interface PortableCheckpointCandidate {
  sourceRevision: number;
  currentRevision: number;
  serializedBytes: number;
  createdAt: number;
  expiresAt: number;
}

export function validatePortableCheckpointCandidate(
  candidate: PortableCheckpointCandidate,
): void {
  if (candidate.sourceRevision !== candidate.currentRevision) {
    throw new Error("Checkpoint source revision lost compare-and-set.");
  }
  if (
    candidate.serializedBytes < 1
    || candidate.serializedBytes > DISCORD_PORTABLE_CHECKPOINT_MAX_BYTES
  ) {
    throw new Error("Portable checkpoint exceeds the storage boundary.");
  }
  if (
    candidate.expiresAt !== candidate.createdAt + DISCORD_PORTABLE_CHECKPOINT_RETENTION_MS
  ) {
    throw new Error("Portable checkpoint retention deadline is invalid.");
  }
}

export function portableCheckpointRestorable(
  checkpoint: {
    ownerId: string;
    ownerBindingVersion: number;
    guildId: string;
    conversationId: string;
    epoch: number;
    personalityVersion: string;
    systemPromptHash: string;
    capabilityProfileHash: string;
    schemaVersion: number;
    implementationVersion: string;
    provider: string;
    model: string;
    toolPolicyHash: string;
    sourceRevision: number;
    status: string;
    expiresAt: number;
  },
  expected: {
    ownerId: string;
    ownerBindingVersion: number;
    guildId: string;
    conversationId: string;
    epoch: number;
    revision: number;
    model: string;
    capabilityProfileHash: string;
    personalityVersion?: string;
    systemPromptHash?: string;
  },
  now: number,
  requiredStatus: "active" | "candidate" = "active",
): boolean {
  return checkpoint.status === requiredStatus
    && checkpoint.expiresAt > now
    && checkpoint.ownerId === expected.ownerId
    && checkpoint.ownerBindingVersion === expected.ownerBindingVersion
    && checkpoint.guildId === expected.guildId
    && checkpoint.conversationId === expected.conversationId
    && checkpoint.epoch === expected.epoch
    && checkpoint.schemaVersion === 1
    && checkpoint.implementationVersion === "portable-summary-v1"
    && checkpoint.provider === "openai-codex"
    && checkpoint.model === expected.model
    && checkpoint.toolPolicyHash === expected.capabilityProfileHash
    && checkpoint.sourceRevision <= expected.revision
    && checkpoint.personalityVersion === (expected.personalityVersion ?? DISCORD_PERSONALITY_PROFILE.personalityVersion)
    && checkpoint.systemPromptHash === (expected.systemPromptHash ?? DISCORD_PERSONALITY_PROFILE.systemPromptHash)
    && checkpoint.personalityVersion === DISCORD_PERSONALITY_PROFILE.personalityVersion
    && checkpoint.systemPromptHash === DISCORD_PERSONALITY_PROFILE.systemPromptHash
    && checkpoint.capabilityProfileHash === DISCORD_PERSONALITY_PROFILE.capabilityProfileHash;
}

/** One deterministic prefix per scheduling pass; the unprocessed middle stays unactivated. */
export function selectDiscordCheckpointSourceBatch<T extends DiscordCanonicalTailEvent>(
  events: readonly T[],
  tailCount: number,
  options: { maximumBytes?: number; tokenBudget?: number } = {},
): T[] {
  const batch: T[] = [];
  let bytes = 0;
  let tokens = 0;
  for (const event of events.slice(0, Math.max(0, events.length - tailCount))) {
    const eventBytes = new TextEncoder().encode(JSON.stringify(event)).byteLength + 1;
    const eventTokens = estimateDiscordCanonicalEventTokens(event);
    if (
      batch.length >= DISCORD_PORTABLE_CHECKPOINT_MAX_SOURCE_EVENT_COUNT
      || bytes + eventBytes > (options.maximumBytes ?? 900_000)
      || tokens + eventTokens > (options.tokenBudget ?? DISCORD_COMPACTION_THRESHOLD_TOKENS)
    ) break;
    batch.push(event);
    bytes += eventBytes;
    tokens += eventTokens;
  }
  return batch;
}
