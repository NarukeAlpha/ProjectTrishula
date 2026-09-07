/* oxlint-disable anti-slop/no-unknown-parameters -- Serialized byte measurement is the I/O size boundary and intentionally accepts any JSON candidate. */
export const MARKET_RESEARCH_LEASE_MS = 2 * 60 * 1_000;
export const MARKET_RESEARCH_DELIVERY_LEASE_MS = 60 * 1_000;
export const MARKET_RESEARCH_RECOVERY_BATCH_SIZE = 25;
export const MARKET_RESEARCH_RECOVERY_MAX_BATCHES = 4;
export const MARKET_RESEARCH_SCHEDULER_MAX_CONTINUATIONS = 25;
export const MARKET_RESEARCH_MAX_EVIDENCE_RECORD_BYTES = 64 * 1_024;
export const MARKET_RESEARCH_MAX_RESULT_BYTES = 2 * 1_024 * 1_024;
export const MARKET_RESEARCH_EVIDENCE_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
export const MARKET_RESEARCH_RETRY_DELAYS_MS = [30_000, 120_000, 300_000, 900_000] as const;

export interface ScheduleConfiguration {
  ownerId: string;
  guildId: string;
  scheduleId: string;
  timezone: string;
  localHour: number;
  localMinute: number;
  lateEditionCutoffLocalTime: string;
}

export interface DueScheduleDecision {
  kind: "before" | "due" | "skipped_late";
  editionDate: string;
  scheduledFor: number;
  cutoffAt: number;
  scheduledKey: string;
}

export interface ExistingManualEdition {
  editionId: string;
  editionRevision: number;
  status: string;
}

export type ManualEditionDisposition =
  | { kind: "duplicate"; editionId: string }
  | {
    kind: "create";
    revision: number;
    trigger: "manual_publish" | "regeneration";
    parentEditionId: string | null;
  };

export function manualEditionDisposition(
  existing: ExistingManualEdition | null,
  regeneratePublishedEdition: boolean,
): ManualEditionDisposition {
  const rerunSkippedLate = existing?.status === "skipped_late" && !regeneratePublishedEdition;
  if (existing && !regeneratePublishedEdition && !rerunSkippedLate) {
    return { kind: "duplicate", editionId: existing.editionId };
  }
  if (regeneratePublishedEdition && existing?.status !== "published") {
    throw new Error("edition_already_exists");
  }
  return {
    kind: "create",
    revision: regeneratePublishedEdition || rerunSkippedLate
      ? (existing?.editionRevision ?? 0) + 1
      : 0,
    trigger: regeneratePublishedEdition ? "regeneration" : "manual_publish",
    parentEditionId: regeneratePublishedEdition || rerunSkippedLate
      ? existing?.editionId ?? null
      : null,
  };
}

export function scheduleDayEnabled(includeWeekends: boolean, weekday: string): boolean {
  return includeWeekends || (weekday !== "Sat" && weekday !== "Sun");
}

export function isMarketResearchForumIngress(
  forumChannelId: string | null | undefined,
  channelId: string,
  parentChannelId: string | null | undefined,
): boolean {
  return forumChannelId !== null
    && forumChannelId !== undefined
    && (forumChannelId === channelId || forumChannelId === parentChannelId);
}

export function marketResearchDeploymentOwnerMatches(
  ownerId: string,
  configuredOwnerId: string | undefined,
): boolean {
  const configured = configuredOwnerId?.trim();
  return configured !== undefined
    && /^[A-Za-z0-9:_-]{1,256}$/u.test(configured)
    && configured === ownerId;
}

export function schedulerContinuation(
  pageIsDone: boolean,
  continuation: number,
): { delayMs: number; continuation: number } | undefined {
  if (pageIsDone) return undefined;
  if (continuation < MARKET_RESEARCH_SCHEDULER_MAX_CONTINUATIONS) {
    return { delayMs: 0, continuation: continuation + 1 };
  }
  return { delayMs: 60_000, continuation: 0 };
}

export function shouldSkipUnstartedEdition(
  edition: { trigger: string; startedAt?: number; cutoffAt: number },
  now: number,
): boolean {
  return edition.trigger === "scheduled"
    && edition.startedAt === undefined
    && now >= edition.cutoffAt;
}

export type ResearchDispatchFailure = {
  code: "market_research_disabled" | "exa_not_configured" | "exa_auth_failed" | "exa_invalid_request" | "exa_connect_zdr_incompatible" | "market_session_calendar_stale" | "composition_auth_required" | "composition_provider_not_ready" | "composition_schema_invalid" | "composition_timeout" | "edition_lease_lost";
  retryable: boolean;
};

export function classifyResearchDispatchFailure(
  failure: { status?: number; errorCode?: string; errorMessage?: string },
): ResearchDispatchFailure {
  switch (failure.errorCode) {
    case "market_research_disabled": return { code: "market_research_disabled", retryable: false };
    case "composition_auth_required": return { code: "composition_auth_required", retryable: false };
    case "composition_provider_not_ready": return { code: "composition_provider_not_ready", retryable: false };
    case "exa_not_configured": return { code: "exa_not_configured", retryable: false };
    case "exa_auth_failed": return { code: "exa_auth_failed", retryable: false };
    case "exa_invalid_request": return { code: "exa_invalid_request", retryable: false };
    case "exa_connect_zdr_incompatible": return { code: "exa_connect_zdr_incompatible", retryable: false };
    case "market_session_calendar_stale": return { code: "market_session_calendar_stale", retryable: false };
    case "actor_mismatch": return { code: "composition_auth_required", retryable: false };
    case "market_research_job_conflict": return { code: "edition_lease_lost", retryable: false };
    case "market_research_job_capacity": return { code: "composition_timeout", retryable: true };
  }
  if (failure.status !== undefined) {
    if (failure.status === 401 || failure.status === 403) {
      return { code: "composition_auth_required", retryable: false };
    }
    if (failure.status === 409) return { code: "edition_lease_lost", retryable: false };
    if (failure.status === 400 || failure.status === 422) {
      return { code: "composition_schema_invalid", retryable: false };
    }
    if (failure.status === 408 || failure.status === 425 || failure.status === 429 || failure.status >= 500) {
      return { code: "composition_timeout", retryable: true };
    }
    return { code: "composition_provider_not_ready", retryable: false };
  }
  if (/not configured|invalid/i.test(failure.errorMessage ?? "")) {
    return { code: "composition_provider_not_ready", retryable: false };
  }
  return { code: "composition_timeout", retryable: true };
}

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedDateParts(instant: number, timezone: string): ZonedDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
  };
}

function localToInstant(
  date: Pick<ZonedDateParts, "year" | "month" | "day">,
  hour: number,
  minute: number,
  timezone: string,
): number {
  const desiredUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0);
  let candidate = desiredUtc;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = zonedDateParts(candidate, timezone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const next = candidate + (desiredUtc - actualAsUtc);
    if (Math.abs(next - candidate) < 1_000) return next;
    candidate = next;
  }
  const verified = zonedDateParts(candidate, timezone);
  if (
    verified.year !== date.year
    || verified.month !== date.month
    || verified.day !== date.day
    || verified.hour !== hour
    || verified.minute !== minute
  ) throw new Error("session_unknown");
  return candidate;
}

export function marketSessionCloseInstant(
  date: string,
  localTime: string,
  timezone: string,
): number {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(localTime);
  if (!dateMatch || !timeMatch) throw new Error("session_unknown");
  return localToInstant({
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
  }, Number(timeMatch[1]), Number(timeMatch[2]), timezone);
}

function dateString(parts: Pick<ZonedDateParts, "year" | "month" | "day">): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function cutoffParts(value: string): [number, number] {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error("late_cutoff_exceeded");
  return [Number(match[1]), Number(match[2])];
}

export function scheduledEditionKey(
  configuration: Pick<ScheduleConfiguration, "ownerId" | "guildId" | "scheduleId">,
  editionDate: string,
): string {
  return `market-paper:${configuration.ownerId}:${configuration.guildId}:${configuration.scheduleId}:${editionDate}`;
}

export function dueScheduleDecision(
  configuration: ScheduleConfiguration,
  now: number,
): DueScheduleDecision {
  if (!Number.isSafeInteger(configuration.localHour) || configuration.localHour < 0 || configuration.localHour > 23) {
    throw new Error("session_unknown");
  }
  if (!Number.isSafeInteger(configuration.localMinute) || configuration.localMinute < 0 || configuration.localMinute > 59) {
    throw new Error("session_unknown");
  }
  const local = zonedDateParts(now, configuration.timezone);
  const editionDate = dateString(local);
  const scheduledFor = localToInstant(local, configuration.localHour, configuration.localMinute, configuration.timezone);
  const [cutoffHour, cutoffMinute] = cutoffParts(configuration.lateEditionCutoffLocalTime);
  const cutoffAt = localToInstant(local, cutoffHour, cutoffMinute, configuration.timezone);
  return {
    kind: now < scheduledFor ? "before" : now < cutoffAt ? "due" : "skipped_late",
    editionDate,
    scheduledFor,
    cutoffAt,
    scheduledKey: scheduledEditionKey(configuration, editionDate),
  };
}

export function stableMarketResearchToken(values: readonly (string | number)[]): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const item of values) {
    for (const character of String(item)) {
      const code = character.charCodeAt(0);
      first = Math.imul(first ^ code, 0x01000193);
      second = Math.imul(second ^ code, 0x85ebca6b);
    }
    first = Math.imul(first ^ 0x1f, 0x01000193);
    second = Math.imul(second ^ 0x1f, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

export function researchDispatchId(editionId: string, generation: number): string {
  return `${editionId}:research:${generation}`;
}

export function nextRetryAt(attempts: number, now: number, jitterSeed?: string): number | undefined {
  const delay = MARKET_RESEARCH_RETRY_DELAYS_MS[Math.max(0, attempts - 1)];
  if (delay === undefined) return undefined;
  if (jitterSeed === undefined) return now + delay;
  const hash = stableMarketResearchToken([jitterSeed, attempts]);
  const unit = Number.parseInt(hash.slice(0, 8), 16) / 0xffff_ffff;
  return now + Math.round(delay * (0.75 + unit * 0.5));
}

export function isTerminalMarketResearchStatus(status: string): boolean {
  return ["failed", "cancelled", "published", "skipped_late"].includes(status);
}

export function canRecoverResearch(
  record: { status: string; leaseExpiresAt?: number; nextAttemptAt?: number; lastErrorCode?: string },
  now: number,
): boolean {
  if (isTerminalMarketResearchStatus(record.status) || record.status === "partial") return false;
  if (record.lastErrorCode === "discord_thread_reconcile_ambiguous") return false;
  return (record.leaseExpiresAt !== undefined && record.leaseExpiresAt <= now)
    || (record.status === "retry_wait" && record.nextAttemptAt !== undefined && record.nextAttemptAt <= now);
}

export interface CalendarSession {
  date: string;
  status: "OPEN" | "EARLY_CLOSE" | "CLOSED";
  regularOpen?: string;
  regularClose?: string;
  earlyClose?: string;
}

export interface CalendarSnapshot {
  calendarId: string;
  version: string;
  sourceUrl: string;
  retrievedAt: number;
  effectiveStart: string;
  effectiveEnd: string;
  reviewed: boolean;
  sessions: readonly CalendarSession[];
}

export interface CalendarOverride {
  date: string;
  status: CalendarSession["status"];
  regularOpen?: string;
  regularClose?: string;
  earlyClose?: string;
  effectiveStart: number;
  effectiveEnd: number;
}

export interface ResolvedCalendarWindow {
  session: CalendarSession;
  previousSession: CalendarSession | null;
  previousSessionClose: number | null;
  nextSession: CalendarSession | null;
  currentOverride: CalendarOverride | null;
  relevantOverrides: CalendarOverride[];
}

export function hasConfirmedPriorSession(window: ResolvedCalendarWindow): boolean {
  return window.previousSession !== null && window.previousSessionClose !== null;
}

export interface ResearchEvidenceMetricCandidate {
  evidenceId: string;
  kind: string;
  sourcePolicy: string;
  freshness: string;
  contentStatus: string;
}

export function isAcceptedResearchEvidence(item: ResearchEvidenceMetricCandidate): boolean {
  return item.sourcePolicy === "approved"
    && !["calculation", "source_status"].includes(item.kind)
    && ["fresh", "cached", "delayed"].includes(item.freshness)
    && ["available", "cached", "delayed"].includes(item.contentStatus);
}

export function acceptedResearchEvidenceCount(items: readonly ResearchEvidenceMetricCandidate[]): number {
  const seen = new Set<string>();
  let count = 0;
  for (const item of items) {
    if (seen.has(item.evidenceId)) continue;
    seen.add(item.evidenceId);
    if (isAcceptedResearchEvidence(item)) count += 1;
  }
  return count;
}

function ipv4Octets(value: string): readonly [number, number, number, number] | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return null;
  const octets: readonly [number, number, number, number] = [
    Number(parts[0]),
    Number(parts[1]),
    Number(parts[2]),
    Number(parts[3]),
  ];
  if (octets.some((octet) => !Number.isSafeInteger(octet) || octet < 0 || octet > 255)) return null;
  return octets;
}

function isNonGlobalIpv4(octets: readonly [number, number, number, number]): boolean {
  const [first, second, third] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 0 && third === 2)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224;
}

function expandedIpv6(value: string): readonly number[] | null {
  let normalized = value;
  if (normalized.includes(".")) {
    const tailStart = normalized.lastIndexOf(":") + 1;
    const ipv4 = ipv4Octets(normalized.slice(tailStart));
    if (!ipv4) return null;
    normalized = `${normalized.slice(0, tailStart)}${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const compressed = halves.length === 2;
  if ((!compressed && left.length !== 8) || (compressed && left.length + right.length >= 8)) return null;
  const omitted = compressed ? 8 - left.length - right.length : 0;
  const groups = [...left, ...Array.from({ length: omitted }, () => "0"), ...right]
    .map((part) => /^[\da-f]{1,4}$/u.test(part) ? Number.parseInt(part, 16) : Number.NaN);
  return groups.length === 8 && groups.every((group) => Number.isSafeInteger(group) && group >= 0 && group <= 0xffff)
    ? groups
    : null;
}

/** Returns true only when the hostname is an IP literal in a non-public range. */
export function isNonGlobalIpHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/u, "");
  const ipv4 = ipv4Octets(hostname);
  if (ipv4) return isNonGlobalIpv4(ipv4);
  if (!hostname.includes(":")) return false;
  if (hostname.includes("%")) return true;
  const groups = expandedIpv6(hostname);
  if (!groups) return true;
  const first = groups[0] ?? 0;
  const second = groups[1] ?? 0;
  const sixth = groups[5] ?? 0;
  const eighth = groups[7] ?? 0;
  const unspecifiedOrLoopback = groups.slice(0, 7).every((group) => group === 0) && eighth <= 1;
  const ipv4Compatible = groups.slice(0, 6).every((group) => group === 0);
  const ipv4Mapped = groups.slice(0, 5).every((group) => group === 0) && sixth === 0xffff;
  return unspecifiedOrLoopback
    || ipv4Compatible
    || ipv4Mapped
    || (first & 0xe000) !== 0x2000
    || (first & 0xfe00) === 0xfc00
    || (first & 0xffc0) === 0xfe80
    || (first & 0xffc0) === 0xfec0
    || (first & 0xff00) === 0xff00
    || (first === 0x2001 && second === 0x0002)
    || (first === 0x2001 && second === 0x0db8);
}

/** Returns true for hostnames that must never cross the public HTTPS boundary. */
export function isNonPublicHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/u, "");
  return hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || isNonGlobalIpHostname(hostname);
}

export type MarketSessionType = "OPEN" | "EARLY_CLOSE" | "CLOSED" | "UNKNOWN";
export type MarketEditionLabel = "Morning Market Newspaper" | "Weekend Outlook" | "Market Holiday Outlook" | "Late Edition" | "Data unavailable";

export function marketEditionLabel(
  sessionType: MarketSessionType,
  isWeekend: boolean,
  scheduledFor: number,
  now: number,
): MarketEditionLabel {
  if (sessionType === "UNKNOWN") return "Data unavailable";
  if (isWeekend) return "Weekend Outlook";
  if (sessionType === "CLOSED") return "Market Holiday Outlook";
  return now > scheduledFor + 60 * 60 * 1_000 ? "Late Edition" : "Morning Market Newspaper";
}

export interface CalendarCoverageRequirements {
  now: number;
  maximumAgeMs: number;
  effectiveStart: string;
  effectiveEnd: string;
  officialHosts: ReadonlySet<string>;
}

export function hasCompleteCalendarDateCoverage(
  sessions: readonly CalendarSession[],
  effectiveStart: string,
  effectiveEnd: string,
): boolean {
  const start = Date.parse(`${effectiveStart}T00:00:00Z`);
  const end = Date.parse(`${effectiveEnd}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return false;
  const dates = new Set(sessions.map((session) => session.date));
  if (dates.size !== sessions.length) return false;
  for (let cursor = start; cursor <= end; cursor += 24 * 60 * 60 * 1_000) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    if (!dates.has(date)) return false;
  }
  return true;
}

export function calendarSnapshotMeetsRequirements(
  calendar: CalendarSnapshot | null,
  requirements: CalendarCoverageRequirements,
): calendar is CalendarSnapshot {
  if (
    calendar === null
    || !calendar.reviewed
    || calendar.retrievedAt < requirements.now - requirements.maximumAgeMs
    || calendar.effectiveStart > requirements.effectiveStart
    || calendar.effectiveEnd < requirements.effectiveEnd
    || !hasCompleteCalendarDateCoverage(
      calendar.sessions,
      calendar.effectiveStart,
      calendar.effectiveEnd,
    )
  ) return false;
  try {
    return requirements.officialHosts.has(new URL(calendar.sourceUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function resolveMarketSession(
  calendar: CalendarSnapshot | null,
  date: string,
  now: number,
  overrides: readonly CalendarOverride[] = [],
): CalendarSession {
  const activeOverrides = overrides.filter((candidate) =>
    candidate.date === date && candidate.effectiveStart <= now && now < candidate.effectiveEnd);
  if (activeOverrides.length > 1) throw new Error("session_unknown");
  const override = activeOverrides[0];
  if (override) {
    if (override.status === "CLOSED") return { date, status: "CLOSED" };
    if (!override.regularOpen || !override.regularClose) throw new Error("session_unknown");
    if (override.status === "EARLY_CLOSE" && !override.earlyClose) throw new Error("session_unknown");
    const resolved: CalendarSession = {
      date,
      status: override.status,
      regularOpen: override.regularOpen,
      regularClose: override.regularClose,
    };
    if (override.earlyClose !== undefined) resolved.earlyClose = override.earlyClose;
    return resolved;
  }
  if (
    calendar === null
    || !calendar.reviewed
    || date < calendar.effectiveStart
    || date > calendar.effectiveEnd
  ) throw new Error("session_unknown");
  const session = calendar.sessions.find((candidate) => candidate.date === date);
  if (!session) throw new Error("session_unknown");
  return session;
}

export function resolveCalendarWindow(
  calendar: CalendarSnapshot,
  date: string,
  now: number,
  timezone: string,
  overrides: readonly CalendarOverride[] = [],
): ResolvedCalendarWindow {
  const dates = new Set(calendar.sessions.map((session) => session.date));
  for (const override of overrides) {
    if (override.date >= calendar.effectiveStart && override.date <= calendar.effectiveEnd) dates.add(override.date);
  }
  const sessions = [...dates]
    .map((candidate) => resolveMarketSession(calendar, candidate, now, overrides))
    .sort((left, right) => left.date.localeCompare(right.date));
  const session = sessions.find((candidate) => candidate.date === date);
  if (!session) throw new Error("session_unknown");
  const openSessions = sessions.filter((candidate) => candidate.status !== "CLOSED");
  const previousSession = [...openSessions].reverse().find((candidate) => candidate.date < date) ?? null;
  const nextSession = openSessions.find((candidate) => candidate.date > date) ?? null;
  const previousCloseTime = previousSession?.status === "EARLY_CLOSE"
    ? previousSession.earlyClose
    : previousSession?.regularClose;
  if (previousSession !== null && previousCloseTime === undefined) throw new Error("session_unknown");
  const activeOverrides = overrides.filter((candidate) =>
    candidate.effectiveStart <= now && now < candidate.effectiveEnd);
  return {
    session,
    previousSession,
    previousSessionClose: previousSession && previousCloseTime
      ? marketSessionCloseInstant(previousSession.date, previousCloseTime, timezone)
      : null,
    nextSession,
    currentOverride: activeOverrides.find((candidate) => candidate.date === date) ?? null,
    relevantOverrides: activeOverrides.filter((candidate) =>
      candidate.date <= date && (previousSession === null || candidate.date >= previousSession.date)),
  };
}

export function serializedUtf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function mayDeleteRetainedEvidence(
  editionStatus: string | undefined,
  retentionExpiresAt: number,
  now: number,
): boolean {
  return retentionExpiresAt <= now
    && editionStatus !== undefined
    && isTerminalMarketResearchStatus(editionStatus);
}

export function firstMissingDeliverySequence(
  deliveries: readonly { sequence: number; status: string }[],
): number | undefined {
  return [...deliveries]
    .sort((left, right) => left.sequence - right.sequence)
    .find((delivery) => delivery.status !== "sent")
    ?.sequence;
}

export type PublicationCandidateDisposition =
  | "ready"
  | "defer_until_prior_delivery"
  | "terminal_invalid_state";

export function publicationCandidateDisposition(candidate: {
  deliverySequence: number;
  deliveryKind: string;
  firstMissingSequence: number | undefined;
  threadId: string | undefined;
  starterMessageId: string | undefined;
}): PublicationCandidateDisposition {
  if (candidate.firstMissingSequence !== candidate.deliverySequence) {
    return "defer_until_prior_delivery";
  }
  const kindMatchesSequence = candidate.deliverySequence === 0
    ? candidate.deliveryKind === "starter"
    : candidate.deliveryKind === "reply";
  if (
    !kindMatchesSequence
    || (
      candidate.deliverySequence > 0
      && (!candidate.threadId || !candidate.starterMessageId)
    )
  ) {
    return "terminal_invalid_state";
  }
  return "ready";
}
