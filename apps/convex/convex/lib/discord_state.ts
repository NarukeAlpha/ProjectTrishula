export const DISCORD_CONTEXT_SIZE = 10;
export const DISCORD_GATEWAY_HEARTBEAT_TTL_MS = 60_000;
export const DISCORD_LOOP_LEASE_MS = 120_000;
export const DISCORD_LOOP_ERROR_RETRY_DELAY_MS = 30_000;
export const DISCORD_MAX_LOOP_ERROR_ATTEMPTS = 4;
export const DISCORD_OUTBOX_DELIVERY_LEASE_MS = 30_000;
export const DISCORD_MAX_AUTONOMOUS_RECHECKS = 2;
export const DISCORD_MAX_OUTBOX_ATTEMPTS = 5;

export const DISCORD_CHANNEL_ROLES = [
  "conversation_monitor",
  "reply_target",
  "research_log",
] as const;

export type DiscordChannelRole = (typeof DISCORD_CHANNEL_ROLES)[number];
export type DiscordLoopMode = "messages" | "recheck";
export type DiscordReplyKind = "acknowledgement" | "research_log" | "final";

export interface DiscordMessageContext {
  messageId: string;
  sequence: number;
  authorId: string;
  authorName: string;
  content: string;
  isBot: boolean;
  replyToMessageId?: string;
  createdAt: number;
}

export interface DiscordMessageIdentity {
  guildId: string;
  authorId: string;
  authorName: string;
  content: string;
  isBot: boolean;
  replyToMessageId?: string;
  createdAt: number;
}

export interface DiscordFinalizationCandidate {
  runId: string;
  generation: number;
  status: "pending" | "sent" | "finalized" | "failed";
  finalizesLoop: boolean;
}

export interface DiscordAcknowledgementCandidate {
  sourceChannelId: string;
  guildId: string;
  channelId: string;
  replyKind?: DiscordReplyKind;
  finalizesLoop: boolean;
  status: "pending" | "sent" | "finalized" | "failed";
  replyToMessageId?: string;
}

export interface DiscordLoopStateSnapshot {
  generation: number;
  latestSequence: number;
  triggerThroughSequence: number;
  completedThroughSequence: number;
  recheckCount: number;
  recheckPending: boolean;
  lastRecheckHash?: string;
  activeRunId?: string;
  activeClaimId?: string;
  leaseExpiresAt?: number;
}

export interface DiscordLoopErrorRetrySnapshot {
  status: string;
  triggerThroughSequence: number;
  completedThroughSequence: number;
  activeRunId?: string;
  updatedAt: number;
  consecutiveErrorCount?: number;
}

export interface DiscordWindowBounds {
  mode: DiscordLoopMode;
  start: number;
  end: number;
}

export interface DiscordRecheckInput {
  requested: boolean;
  recheckCount: number;
  activeContextHash: string;
  newestContextHash: string;
  lastRecheckHash?: string;
}

export interface DiscordRoutingChannel {
  channelId: string;
  canSend: boolean;
  roles: readonly DiscordChannelRole[];
}

export function discordReplyTargetAllowsKind(
  replyKind: DiscordReplyKind,
  sourceChannelId: string,
  target: DiscordRoutingChannel,
): boolean {
  if (!target.canSend) return false;
  if (replyKind === "research_log") return target.roles.includes("research_log");
  return target.channelId === sourceChannelId || target.roles.includes("reply_target");
}

export function discordReplyKindMatchesFlags(
  replyKind: DiscordReplyKind,
  finalizesLoop: boolean,
  recheckRequested: boolean,
): boolean {
  return (replyKind === "final") === finalizesLoop
    && (replyKind === "final" || !recheckRequested);
}

export interface DiscordChannelRouting {
  replyChannelId: string;
  researchLogChannelId?: string;
}

export type DiscordRecheckDecision =
  | { accepted: true; nextRecheckCount: number }
  | {
      accepted: false;
      nextRecheckCount: number;
      reason: "not_requested" | "cap" | "same_context";
    };

export function normalizeDiscordChannelRoles(
  roles: readonly DiscordChannelRole[],
): DiscordChannelRole[] {
  const requested = new Set(roles);
  return DISCORD_CHANNEL_ROLES.filter((role) => requested.has(role));
}

export function resolveDiscordChannelRouting(
  sourceChannelId: string,
  channels: readonly DiscordRoutingChannel[],
): DiscordChannelRouting {
  const source = channels.find((channel) => channel.channelId === sourceChannelId);
  const replyTarget = source?.canSend && source.roles.includes("reply_target")
    ? source
    : channels.find((channel) => channel.canSend && channel.roles.includes("reply_target"));
  const researchTarget = source?.canSend && source.roles.includes("research_log")
    ? source
    : channels.find((channel) => channel.canSend && channel.roles.includes("research_log"));
  const result: DiscordChannelRouting = {
    replyChannelId: replyTarget?.channelId ?? sourceChannelId,
  };
  if (researchTarget !== undefined) result.researchLogChannelId = researchTarget.channelId;
  return result;
}

export function pendingDiscordMessageCount(
  state: Pick<DiscordLoopStateSnapshot, "triggerThroughSequence" | "completedThroughSequence">,
): number {
  return Math.max(0, state.triggerThroughSequence - state.completedThroughSequence);
}

export function discordWindowBounds(
  state: Pick<
    DiscordLoopStateSnapshot,
    | "latestSequence"
    | "triggerThroughSequence"
    | "completedThroughSequence"
    | "recheckPending"
  >,
): DiscordWindowBounds | null {
  if (state.triggerThroughSequence > state.completedThroughSequence) {
    const start = state.completedThroughSequence + 1;
    return {
      mode: "messages",
      start,
      end: Math.min(state.triggerThroughSequence, start + DISCORD_CONTEXT_SIZE - 1),
    };
  }
  if (!state.recheckPending || state.latestSequence === 0) return null;
  return {
    mode: "recheck",
    start: Math.max(1, state.latestSequence - DISCORD_CONTEXT_SIZE + 1),
    end: state.latestSequence,
  };
}

export function discordCatchupWindows(
  throughSequence: number,
  completedThroughSequence = 0,
): DiscordWindowBounds[] {
  const windows: DiscordWindowBounds[] = [];
  for (
    let start = completedThroughSequence + 1;
    start <= throughSequence;
    start += DISCORD_CONTEXT_SIZE
  ) {
    windows.push({
      mode: "messages",
      start,
      end: Math.min(throughSequence, start + DISCORD_CONTEXT_SIZE - 1),
    });
  }
  return windows;
}

export function newestDiscordContext<T>(messages: readonly T[]): T[] {
  return messages.slice(-DISCORD_CONTEXT_SIZE);
}

export function discordTrailingContextStart(windowEnd: number): number {
  return Math.max(1, windowEnd - DISCORD_CONTEXT_SIZE + 1);
}

export function discordMessageIngestDecision(
  existingSequence: number | undefined,
  latestSequence: number,
  isBot: boolean,
): { duplicate: true; sequence: number; triggersLoop: false } | {
  duplicate: false;
  sequence: number;
  triggersLoop: boolean;
} {
  if (existingSequence !== undefined) {
    return { duplicate: true, sequence: existingSequence, triggersLoop: false };
  }
  return {
    duplicate: false,
    sequence: latestSequence + 1,
    triggersLoop: !isBot,
  };
}

export function discordDuplicateMessageMatches(
  existing: DiscordMessageIdentity,
  incoming: DiscordMessageIdentity,
): boolean {
  const commonFieldsMatch = existing.guildId === incoming.guildId
    && existing.content === incoming.content
    && existing.isBot === incoming.isBot
    && existing.replyToMessageId === incoming.replyToMessageId;
  if (!commonFieldsMatch) return false;

  // A sent acknowledgement records the bot reply before the Discord gateway can
  // deliver its message-create event. The event is authoritative for author and
  // timestamp metadata, but the Discord message ID and immutable content already
  // established the identity of this bot message.
  if (existing.isBot) return true;
  return existing.authorId === incoming.authorId
    && existing.authorName === incoming.authorName
    && existing.createdAt === incoming.createdAt;
}

export function hasSentDiscordFinalizer(
  replies: readonly DiscordFinalizationCandidate[],
  runId: string,
  generation: number,
): boolean {
  return replies.some((reply) => reply.runId === runId
    && reply.generation === generation
    && reply.status === "sent"
    && reply.finalizesLoop);
}

export function hasPendingDiscordReply(
  replies: readonly DiscordFinalizationCandidate[],
  runId: string,
  generation: number,
): boolean {
  return replies.some((reply) => reply.runId === runId
    && reply.generation === generation
    && reply.status === "pending");
}

export function isDeliveredDiscordAcknowledgement(
  reply: DiscordAcknowledgementCandidate,
  sourceChannelId: string,
  guildId: string,
  channelId: string,
  replyToMessageId?: string,
): boolean {
  const replyKind = reply.replyKind
    ?? (reply.finalizesLoop ? "final" : "research_log");
  return replyKind === "acknowledgement"
    && (reply.status === "sent" || reply.status === "finalized")
    && reply.sourceChannelId === sourceChannelId
    && reply.guildId === guildId
    && reply.channelId === channelId
    && reply.replyToMessageId === replyToMessageId;
}

export function discordClaimDecision(
  state: DiscordLoopStateSnapshot,
  now: number,
):
  | { claimed: false; reason: "busy" | "not_runnable" }
  | { claimed: true; generation: number; window: DiscordWindowBounds } {
  const activeLease = state.activeRunId !== undefined
    && state.leaseExpiresAt !== undefined
    && state.leaseExpiresAt > now;
  if (activeLease) return { claimed: false, reason: "busy" };
  const window = discordWindowBounds(state);
  if (!window) return { claimed: false, reason: "not_runnable" };
  return {
    claimed: true,
    generation: state.generation + 1,
    window,
  };
}

export function discordLoopErrorRetryReady(
  state: DiscordLoopErrorRetrySnapshot,
  now: number,
): boolean {
  const attempts = state.consecutiveErrorCount ?? 1;
  return state.status === "error"
    && state.activeRunId === undefined
    && state.triggerThroughSequence > state.completedThroughSequence
    && attempts < DISCORD_MAX_LOOP_ERROR_ATTEMPTS
    && state.updatedAt + DISCORD_LOOP_ERROR_RETRY_DELAY_MS <= now;
}

export function discordNextLoopErrorCount(
  current: number | undefined,
  retryable: boolean,
): number {
  if (!retryable) return DISCORD_MAX_LOOP_ERROR_ATTEMPTS;
  return Math.min(DISCORD_MAX_LOOP_ERROR_ATTEMPTS, (current ?? 0) + 1);
}

export function isCurrentDiscordGeneration(
  state: Pick<DiscordLoopStateSnapshot, "generation" | "activeRunId"> | null,
  runId: string,
  generation: number,
): boolean {
  return state?.activeRunId === runId && state.generation === generation;
}

export function discordRecheckDecision(args: DiscordRecheckInput): DiscordRecheckDecision {
  if (!args.requested) {
    return { accepted: false, nextRecheckCount: args.recheckCount, reason: "not_requested" };
  }
  if (args.recheckCount >= DISCORD_MAX_AUTONOMOUS_RECHECKS) {
    return { accepted: false, nextRecheckCount: args.recheckCount, reason: "cap" };
  }
  if (
    args.newestContextHash === args.activeContextHash
    || args.newestContextHash === args.lastRecheckHash
  ) {
    return { accepted: false, nextRecheckCount: args.recheckCount, reason: "same_context" };
  }
  return { accepted: true, nextRecheckCount: args.recheckCount + 1 };
}

export function discordContextHash(messages: readonly DiscordMessageContext[]): string {
  return discordStableHash(messages.flatMap((message) => [
    message.messageId,
    message.sequence,
    message.authorId,
    message.authorName,
    message.content,
    message.isBot ? 1 : 0,
    message.replyToMessageId ?? "",
    message.createdAt,
  ]));
}

export function discordDeliveryToken(
  workerId: string,
  outboxId: string,
  attempt: number,
  now: number,
): string {
  return discordStableHash(["discord-delivery", workerId, outboxId, attempt, now]);
}

function discordStableHash(values: readonly (string | number)[]): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const item of values) {
    const value = String(item);
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193);
      second = Math.imul(second ^ code, 0x85ebca6b);
    }
    first = Math.imul(first ^ 0x1f, 0x01000193);
    second = Math.imul(second ^ 0x1f, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}
