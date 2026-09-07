/* oxlint-disable anti-slop/no-conditional-empty-object-spread, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unknown-parameters, anti-slop/no-known-value-widening -- Convex mutations validate untrusted Pi JSON with strict Zod schemas and omit absent exact optional fields before persistence. */
import { v, type Infer } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api.js";
import type { Doc } from "./_generated/dataModel.js";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import { actorFromIdentity } from "./lib/auth.js";
import { normalizeDiscordForumCapabilities } from "./lib/discord_contract.js";
import { canonicalJson, sha256Hex } from "./lib/canonical_json.js";
import {
  commitThesisUpdates, loadThesisMemory, thesisSnapshot, thesisUpdatesMatchContext, thesisUpdatesSchema,
  type ThesisSnapshot,
} from "./lib/market_research_theses.js";
import {
  MARKET_RESEARCH_DELIVERY_LEASE_MS,
  MARKET_RESEARCH_DEFAULT_DATA_PROVIDER,
  MARKET_RESEARCH_EVIDENCE_RETENTION_MS,
  MARKET_RESEARCH_LEASE_MS,
  MARKET_RESEARCH_MAX_EVIDENCE_RECORD_BYTES,
  MARKET_RESEARCH_MAX_RESULT_BYTES,
  MARKET_RESEARCH_RECOVERY_BATCH_SIZE,
  acceptedResearchEvidenceCount,
  calendarSnapshotMeetsRequirements,
  canRecoverResearch,
  dueScheduleDecision,
  firstMissingDeliverySequence,
  hasCompleteCalendarDateCoverage,
  hasConfirmedPriorSession,
  isNonPublicHostname,
  manualEditionDisposition,
  manualTestEditionKey,
  mergeMarketResearchControlOptions,
  marketResearchDeploymentOwnerMatches,
  marketEditionLabel,
  mayDeleteRetainedEvidence,
  nextRetryAt,
  publicationCandidateDisposition,
  resolveCalendarWindow,
  researchDispatchId,
  scheduleDayEnabled,
  schedulerContinuation,
  shouldSkipUnstartedEdition,
  serializedUtf8Bytes,
  stableMarketResearchToken,
} from "./lib/market_research.js";
import {
  marketResearchPreferencesValidator,
  marketResearchSafeErrorValidator,
} from "./schema.js";

type Preferences = Infer<typeof marketResearchPreferencesValidator>;
type DatabaseReader = Pick<QueryCtx["db"], "query" | "get">;
type DatabaseWriter = Pick<MutationCtx, "db" | "scheduler">;

const idPattern = /^[A-Za-z0-9:._-]{1,256}$/;
const symbolPattern = /^[A-Z0-9.^=-]{1,20}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const MARKET_RESEARCH_MAX_EVIDENCE_PACKET_BYTES = 256 * 1_024;
const MARKET_RESEARCH_MAX_CALENDAR_BYTES = 512 * 1_024;
const MARKET_RESEARCH_MAX_CALENDAR_SESSIONS = 800;
const MARKET_RESEARCH_MAX_DELIVERY_PARTS = 500;
const MARKET_RESEARCH_RETENTION_DEFER_MS = 7 * 24 * 60 * 60 * 1_000;
const MARKET_RESEARCH_PUBLICATION_QUEUE_DEFER_MS = 5_000;
const MARKET_RESEARCH_CALENDAR_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1_000;
const OFFICIAL_CALENDAR_HOSTS = new Set([
  "nyse.com", "www.nyse.com", "sec.gov", "www.sec.gov",
  "nasdaq.com", "www.nasdaq.com", "cboe.com", "www.cboe.com",
]);

function isConfiguredMarketResearchOwner(ownerId: string): boolean {
  return marketResearchDeploymentOwnerMatches(ownerId, process.env.MARKET_RESEARCH_OWNER_ID);
}

function requireConfiguredMarketResearchOwner(ownerId: string): void {
  if (!isConfiguredMarketResearchOwner(ownerId)) throw new Error("market_research_disabled");
}
const PROHIBITED_BROKERAGE_LANGUAGE = /\b(?:placed|submitted|executed|bought|sold|entered|exited|cancelled|canceled|modified)\s+(?:an?\s+)?(?:order|position|trade)\b/i;
const REQUESTED_SOURCES = ["FinancialJuice", "Barchart", "ForexFactory", "Yahoo", "TradingView"] as const;
const TERMINAL_RESEARCH_ERRORS = new Set([
  "market_research_disabled",
  "forum_not_configured",
  "forum_wrong_channel_type",
  "forum_permissions_incomplete",
  "exa_not_configured",
  "exa_auth_failed",
  "exa_budget_exhausted",
  "exa_invalid_request",
  "exa_connect_zdr_incompatible",
  "source_rights_blocked",
  "market_data_not_configured",
  "market_data_stale",
  "market_data_conflict",
  "market_session_calendar_stale",
  "session_unknown",
  "evidence_below_minimum",
  "composition_auth_required",
  "composition_provider_not_ready",
  "composition_schema_invalid",
  "composition_citation_invalid",
]);

function storedPreferences(record: Doc<"marketResearchPreferences">): Preferences {
  const {
    _id,
    _creationTime,
    configurationSnapshotHash,
    ...preferences
  } = record;
  void _id;
  void _creationTime;
  void configurationSnapshotHash;
  return preferences;
}

function defaultPreferences(ownerId: string, guildId: string, nowIso: string): Preferences {
  return {
    schemaVersion: 1,
    preferenceId: `market-research-${guildId}`,
    scheduleId: `morning-market-${guildId}`,
    ownerId,
    guildId,
    enabled: false,
    forumChannelId: null,
    forumTagIds: [],
    timezone: "America/New_York",
    timezoneConfirmed: false,
    displayTimezones: ["America/New_York", "America/Puerto_Rico"],
    localHour: 8,
    localMinute: 0,
    primarySymbols: ["AAPL", "MSFT", "XOM", "COP", "NVDA", "AMD", "MU", "SPY", "QQQ"],
    symbolPriorities: [],
    sectorSymbols: ["XLE", "XLK", "SMH", "SOXX"],
    discoverySymbols: ["DIA", "IWM", "XLU", "CVX", "SLB", "OXY", "VST", "CEG", "NRG", "VRT", "ETN", "GEV", "AVGO", "ARM", "TSM", "ASML", "SNDK", "QCOM", "INTC", "MRVL", "AMZN", "GOOGL", "META", "TSLA", "ORCL"],
    followedSectors: ["technology", "semiconductors", "energy", "utilities"],
    trackedThemes: ["AI infrastructure", "power demand", "oil and gas"],
    macroTopics: ["rates", "dollar", "commodities", "index futures"],
    eventCategories: ["economic releases", "earnings", "corporate actions"],
    preferredDomains: [],
    excludedDomains: [],
    requestedSources: [...REQUESTED_SOURCES],
    reportSections: {
      overnightMacro: true,
      crossAsset: true,
      indexSector: true,
      calendar: true,
      primaryBoard: true,
      challengers: true,
      tickerDossiers: true,
      validation: true,
      afterOpen: true,
      requestedSources: true,
      dataQuality: true,
      sources: true,
    },
    maximumRankedSetups: 10,
    editionDepth: "full",
    includeWeekends: true,
    includeCharts: true,
    chartsAcceptancePassed: false,
    maximumCharts: 3,
    lateEditionCutoffLocalTime: "12:00",
    searchRequestBudget: 12,
    contentsPageBudget: 24,
    marketDataProviderId: MARKET_RESEARCH_DEFAULT_DATA_PROVIDER,
    marketSessionCalendarId: "nyse",
    durableTheses: [],
    sourcePolicyVersion: "source-policy-v1",
    promptVersion: "morning-paper-v1",
    revision: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function requireId(value: string, name: string): string {
  const normalized = value.trim();
  if (!idPattern.test(normalized)) throw new Error(`${name} is invalid.`);
  return normalized;
}

function requireBoundedString(value: string, name: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${name} is invalid.`);
  return normalized;
}

function requireLocalDate(value: string, name: string): string {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(parsed)
    || new Date(parsed).toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

function requireLocalTime(value: string, name: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`${name} is invalid.`);
  return value;
}

function requirePublicHttpsUrl(value: string, name: string): string {
  const normalized = requireBoundedString(value, name, 2_000);
  const parsed = new URL(normalized);
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.port
    || isNonPublicHostname(hostname)
  ) {
    throw new Error(`${name} is invalid.`);
  }
  return normalized;
}

function unique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new Error("The market-research timezone is invalid.");
  }
}

function validatePreferences(value: Preferences, ownerId: string): Preferences {
  if (value.schemaVersion !== 1 || value.ownerId !== ownerId) throw new Error("Market-research owner mismatch.");
  if (value.enabled) requireConfiguredMarketResearchOwner(ownerId);
  for (const field of ["preferenceId", "scheduleId", "guildId", "marketSessionCalendarId", "sourcePolicyVersion", "promptVersion"] as const) {
    requireId(value[field], field);
  }
  validateTimezone(value.timezone);
  for (const timezone of value.displayTimezones) validateTimezone(timezone);
  if (
    value.localHour < 0 || value.localHour > 23 || !Number.isSafeInteger(value.localHour)
    || value.localMinute < 0 || value.localMinute > 59 || !Number.isSafeInteger(value.localMinute)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.lateEditionCutoffLocalTime)
  ) throw new Error("The market-research schedule is invalid.");
  if (
    value.primarySymbols.length < 1 || value.primarySymbols.length > 10
    || value.sectorSymbols.length > 20
    || value.discoverySymbols.length > 40
    || !unique(value.primarySymbols)
    || !unique(value.sectorSymbols)
    || !unique(value.discoverySymbols)
    || ![...value.primarySymbols, ...value.sectorSymbols, ...value.discoverySymbols].every((symbol) => symbolPattern.test(symbol))
  ) throw new Error("The market-research symbol boards are invalid.");
  const allSymbols = new Set([...value.primarySymbols, ...value.sectorSymbols, ...value.discoverySymbols]);
  if (
    !unique(value.symbolPriorities.map((entry) => entry.symbol))
    || value.symbolPriorities.some((entry) => !allSymbols.has(entry.symbol) || !Number.isSafeInteger(entry.priority) || entry.priority < 0 || entry.priority > 100)
  ) throw new Error("Market-research symbol priorities are invalid.");
  if (
    value.requestedSources.length !== REQUESTED_SOURCES.length
    || !REQUESTED_SOURCES.every((source) => value.requestedSources.includes(source))
    || !unique(value.requestedSources)
  ) throw new Error("All requested sources are required.");
  if (
    value.searchRequestBudget < 12 || value.searchRequestBudget > 100
    || value.contentsPageBudget < 1 || value.contentsPageBudget > 100
    || !Number.isSafeInteger(value.maximumRankedSetups)
    || value.maximumRankedSetups < 1 || value.maximumRankedSetups > 10
    || value.maximumCharts < 0 || value.maximumCharts > 3
  ) throw new Error("Market-research budgets are invalid.");
  if (value.enabled && (!value.timezoneConfirmed || value.forumChannelId === null || value.marketDataProviderId === null)) {
    throw new Error("An enabled schedule requires confirmed timezone, forum, and market-data provider.");
  }
  if (value.forumTagIds.length > 5 || !unique(value.forumTagIds)) throw new Error("Forum tags are invalid.");
  if (value.durableTheses.length > 50) throw new Error("Durable theses are invalid.");
  return { ...value, editionDepth: "full" };
}

async function validateForum(
  ctx: { db: DatabaseReader },
  preferences: Preferences,
  requireAttachmentPermission = false,
): Promise<void> {
  if (preferences.forumChannelId === null) {
    if (preferences.enabled) throw new Error("forum_not_configured");
    return;
  }
  const channel = await ctx.db
    .query("discordChannels")
    .withIndex("by_owner_guild_channel", (index) => index
      .eq("ownerId", preferences.ownerId)
      .eq("guildId", preferences.guildId)
      .eq("channelId", preferences.forumChannelId ?? ""))
    .unique();
  if (!channel?.available) throw new Error("forum_not_configured");
  if (channel.type !== "forum") throw new Error("forum_wrong_channel_type");
  const capabilities = normalizeDiscordForumCapabilities(channel);
  if (
    !channel.canView
    || !capabilities.canCreateForumPost
    || !capabilities.canSendInThreads
    || !capabilities.canReadThreadHistory
    || (requireAttachmentPermission && preferences.includeCharts && !capabilities.canAttachFiles)
  ) throw new Error("forum_permissions_incomplete");
  const tags = new Map(capabilities.availableTags.map((tag) => [tag.id, tag]));
  for (const tagId of preferences.forumTagIds) {
    const tag = tags.get(tagId);
    if (!tag || tag.moderated) throw new Error("forum_permissions_incomplete");
  }
  if (capabilities.requiresTag && preferences.forumTagIds.length === 0) throw new Error("forum_permissions_incomplete");
}

async function preferenceByOwnerGuild(
  ctx: { db: DatabaseReader },
  ownerId: string,
  guildId: string,
) {
  return ctx.db
    .query("marketResearchPreferences")
    .withIndex("by_owner_guild", (index) => index.eq("ownerId", ownerId).eq("guildId", guildId))
    .unique();
}

async function editionByStableId(ctx: { db: DatabaseReader }, editionId: string) {
  return ctx.db
    .query("marketResearchEditions")
    .withIndex("by_editionId", (index) => index.eq("editionId", editionId))
    .unique();
}

async function boundedEditionDeliveries(
  ctx: { db: MutationCtx["db"] },
  editionId: string,
) {
  const deliveries = await ctx.db
    .query("marketResearchDeliveries")
    .withIndex("by_edition_sequence", (index) => index.eq("editionId", editionId))
    .order("asc")
    .take(MARKET_RESEARCH_MAX_DELIVERY_PARTS + 1);
  if (deliveries.length > MARKET_RESEARCH_MAX_DELIVERY_PARTS) {
    throw new Error("composition_schema_invalid");
  }
  return deliveries;
}

async function terminalizeUnsentDeliveries(
  ctx: { db: MutationCtx["db"] },
  editionId: string,
  code: Infer<typeof marketResearchSafeErrorValidator>,
  now: number,
): Promise<void> {
  const deliveries = await boundedEditionDeliveries(ctx, editionId);
  for (const delivery of deliveries) {
    if (delivery.status === "sent") continue;
    await ctx.db.patch(delivery._id, {
      status: "failed",
      deliveryWorkerId: undefined,
      deliveryToken: undefined,
      deliveryLeaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      lastErrorCode: code,
      lastErrorMessage: code,
      updatedAt: now,
    });
  }
}

async function previewByStableId(ctx: { db: DatabaseReader }, previewId: string) {
  return ctx.db
    .query("marketResearchPreviews")
    .withIndex("by_previewId", (index) => index.eq("previewId", previewId))
    .unique();
}

async function currentCalendarForOwner(
  ctx: { db: DatabaseReader },
  ownerId: string,
  calendarId: string,
) {
  return ctx.db
    .query("marketSessionCalendars")
    .withIndex("by_owner_calendar_updatedAt", (index) => index
      .eq("ownerId", ownerId)
      .eq("calendarId", calendarId))
    .order("desc")
    .first();
}

async function requireCalendarEnablementGate(
  ctx: { db: DatabaseReader },
  calendar: Doc<"marketSessionCalendars"> | null,
  preferences: Preferences,
  now: number,
): Promise<void> {
  const currentDate = dueScheduleDecision(preferences, now).editionDate;
  const nextYearEnd = `${Number(currentDate.slice(0, 4)) + 1}-12-31`;
  if (!calendarSnapshotMeetsRequirements(calendar, {
    now,
    maximumAgeMs: MARKET_RESEARCH_CALENDAR_MAX_AGE_MS,
    effectiveStart: currentDate,
    effectiveEnd: nextYearEnd,
    officialHosts: OFFICIAL_CALENDAR_HOSTS,
  })) throw new Error("market_session_calendar_stale");
  const overrides = await boundedCalendarOverrides(ctx, preferences.ownerId, preferences.marketSessionCalendarId, calendar);
  try {
    const window = resolveCalendarWindow(calendar, currentDate, now, preferences.timezone, overrides);
    if (!hasConfirmedPriorSession(window)) {
      throw new Error("market_session_calendar_stale");
    }
  } catch {
    throw new Error("market_session_calendar_stale");
  }
}

async function boundedCalendarOverrides(
  ctx: { db: DatabaseReader },
  ownerId: string,
  calendarId: string,
  calendar: Pick<Doc<"marketSessionCalendars">, "effectiveStart" | "effectiveEnd">,
) {
  const overrides = await ctx.db
    .query("marketSessionOverrides")
    .withIndex("by_owner_calendar_date", (index) => index
      .eq("ownerId", ownerId)
      .eq("calendarId", calendarId)
      .gte("date", calendar.effectiveStart)
      .lte("date", calendar.effectiveEnd))
    .take(MARKET_RESEARCH_MAX_CALENDAR_SESSIONS + 1);
  if (overrides.length > MARKET_RESEARCH_MAX_CALENDAR_SESSIONS) {
    throw new Error("market_session_calendar_stale");
  }
  return overrides;
}

interface FrozenSessionContext {
  sessionType: "OPEN" | "EARLY_CLOSE" | "CLOSED" | "UNKNOWN";
  editionLabel: "Morning Market Newspaper" | "Weekend Outlook" | "Market Holiday Outlook" | "Late Edition" | "Data unavailable";
  editionDate: string;
  timezone: string;
  configuredLocalTime: string;
  marketTime: string;
  previousSessionDate: string | null;
  previousSessionClose: string | null;
  nextSessionDate: string | null;
  calendarVersion: string;
  sourceIds: string[];
  evidence: Array<{
    evidenceId: string;
    kind: "calendar";
    provider: string;
    sourcePolicy: "approved" | "unavailable";
    title: string;
    url?: string;
    canonicalUrlHash?: string;
    providerTimestamp?: string;
    retrievedAt: string;
    sessionLabel: "regular" | "closed" | "unknown";
    freshness: "fresh" | "unknown";
    contentStatus: "available" | "failed";
    highlights: string[];
    normalizedClaims: string[];
    contentHash: string;
  }>;
}

async function frozenSessionContext(
  ctx: { db: DatabaseReader },
  preferences: Preferences,
  decision: ReturnType<typeof dueScheduleDecision>,
  now: number,
): Promise<FrozenSessionContext> {
  const calendar = await currentCalendarForOwner(ctx, preferences.ownerId, preferences.marketSessionCalendarId);
  let status: FrozenSessionContext["sessionType"] = "UNKNOWN";
  let calendarVersion = preferences.marketSessionCalendarId;
  let previousSessionDate: string | null = null;
  let previousSessionClose: string | null = null;
  let nextSessionDate: string | null = null;
  let calendarEvidence: FrozenSessionContext["evidence"][number] | undefined;
  const supplementalCalendarEvidence: FrozenSessionContext["evidence"] = [];
  if (calendarSnapshotMeetsRequirements(calendar, {
    now,
    maximumAgeMs: MARKET_RESEARCH_CALENDAR_MAX_AGE_MS,
    effectiveStart: decision.editionDate,
    effectiveEnd: decision.editionDate,
    officialHosts: OFFICIAL_CALENDAR_HOSTS,
  })) {
    const overrides = await boundedCalendarOverrides(
      ctx,
      preferences.ownerId,
      preferences.marketSessionCalendarId,
      calendar,
    );
    try {
      const window = resolveCalendarWindow(calendar, decision.editionDate, now, preferences.timezone, overrides);
      const activeOverride = overrides.find((override) =>
        override.date === decision.editionDate
        && override.effectiveStart <= now
        && now < override.effectiveEnd);
      status = window.session.status;
      calendarVersion = calendar.version;
      previousSessionDate = window.previousSession?.date ?? null;
      previousSessionClose = window.previousSessionClose === null
        ? null
        : new Date(window.previousSessionClose).toISOString();
      nextSessionDate = window.nextSession?.date ?? null;
      const sourceUrl = activeOverride?.sourceUrl ?? calendar.sourceUrl;
      const contentHash = activeOverride
        ? await sha256Hex(canonicalJson({
          overrideId: activeOverride.overrideId,
          date: activeOverride.date,
          status: activeOverride.status,
          regularOpen: activeOverride.regularOpen,
          regularClose: activeOverride.regularClose,
          earlyClose: activeOverride.earlyClose,
          reason: activeOverride.reason,
          sourceUrl: activeOverride.sourceUrl,
          effectiveStart: activeOverride.effectiveStart,
          effectiveEnd: activeOverride.effectiveEnd,
        }))
        : calendar.contentHash;
      const evidenceId = `calendar-${stableMarketResearchToken([
        preferences.ownerId,
        preferences.marketSessionCalendarId,
        calendarVersion,
        decision.editionDate,
        status,
        contentHash,
      ])}`;
      calendarEvidence = {
        evidenceId,
        kind: "calendar",
        provider: activeOverride ? "Owner-reviewed market-session override" : "NYSE market-session calendar",
        sourcePolicy: "approved",
        title: `${decision.editionDate} market-session classification`,
        url: sourceUrl,
        canonicalUrlHash: await sha256Hex(sourceUrl),
        providerTimestamp: new Date(activeOverride?.createdAt ?? calendar.retrievedAt).toISOString(),
        retrievedAt: new Date(now).toISOString(),
        sessionLabel: status === "CLOSED" ? "closed" : "regular",
        freshness: "fresh",
        contentStatus: "available",
        highlights: [],
        normalizedClaims: [`Reviewed calendar ${calendarVersion} classifies ${decision.editionDate} as ${status}.`],
        contentHash,
      };
      const relevantOverrideDocs = overrides.filter((override) =>
        override.overrideId !== activeOverride?.overrideId
        && override.effectiveStart <= now
        && now < override.effectiveEnd
        && override.date <= decision.editionDate
        && (previousSessionDate === null || override.date >= previousSessionDate));
      for (const override of relevantOverrideDocs) {
        const overrideHash = await sha256Hex(canonicalJson({
          overrideId: override.overrideId,
          date: override.date,
          status: override.status,
          regularOpen: override.regularOpen,
          regularClose: override.regularClose,
          earlyClose: override.earlyClose,
          reason: override.reason,
          sourceUrl: override.sourceUrl,
          effectiveStart: override.effectiveStart,
          effectiveEnd: override.effectiveEnd,
        }));
        supplementalCalendarEvidence.push({
          evidenceId: `calendar-override-${stableMarketResearchToken([override.overrideId, overrideHash])}`,
          kind: "calendar",
          provider: "Owner-reviewed market-session override",
          sourcePolicy: "approved",
          title: `${override.date} market-session override`,
          url: override.sourceUrl,
          canonicalUrlHash: await sha256Hex(override.sourceUrl),
          providerTimestamp: new Date(override.createdAt).toISOString(),
          retrievedAt: new Date(now).toISOString(),
          sessionLabel: override.status === "CLOSED" ? "closed" : "regular",
          freshness: "fresh",
          contentStatus: "available",
          highlights: [],
          normalizedClaims: [
            `Owner-reviewed override classifies ${override.date} as ${override.status}${override.earlyClose ? ` with a ${override.earlyClose} local close` : ""}.`,
          ],
          contentHash: overrideHash,
        });
      }
    } catch {
      status = "UNKNOWN";
    }
  }
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: preferences.timezone,
    weekday: "short",
  }).format(new Date(decision.scheduledFor));
  const weekend = weekday === "Sat" || weekday === "Sun";
  const editionLabel = marketEditionLabel(status, weekend, decision.scheduledFor, now);
  if (calendarEvidence === undefined) {
    const claim = `No reviewed official market-session calendar covers ${decision.editionDate}.`;
    calendarEvidence = {
      evidenceId: `calendar-unavailable-${stableMarketResearchToken([
        preferences.ownerId,
        preferences.marketSessionCalendarId,
        decision.editionDate,
      ])}`,
      kind: "calendar",
      provider: "Project Trishula calendar gate",
      sourcePolicy: "unavailable",
      title: `${decision.editionDate} market-session classification unavailable`,
      retrievedAt: new Date(now).toISOString(),
      sessionLabel: "unknown",
      freshness: "unknown",
      contentStatus: "failed",
      highlights: [],
      normalizedClaims: [claim],
      contentHash: await sha256Hex(claim),
    };
  }
  return {
    sessionType: status,
    editionLabel,
    editionDate: decision.editionDate,
    timezone: preferences.timezone,
    configuredLocalTime: new Date(decision.scheduledFor).toISOString(),
    marketTime: new Date(decision.scheduledFor).toISOString(),
    previousSessionDate,
    previousSessionClose,
    nextSessionDate,
    calendarVersion,
    sourceIds: [calendarEvidence.evidenceId, ...supplementalCalendarEvidence.map((item) => item.evidenceId)],
    evidence: [calendarEvidence, ...supplementalCalendarEvidence],
  };
}

async function recordEvent(
  ctx: { db: MutationCtx["db"] },
  edition: Pick<Doc<"marketResearchEditions">, "editionId" | "ownerId" | "guildId">,
  eventType: string,
  now: number,
  options: {
    stage?: Doc<"marketResearchEditions">["stage"];
    safeCode?: Doc<"marketResearchEditions">["lastErrorCode"];
    details?: Array<{ key: string; value: string }>;
  } = {},
): Promise<void> {
  await ctx.db.insert("marketResearchEvents", {
    eventId: `${edition.editionId}:${stableMarketResearchToken([eventType, now])}`,
    editionId: edition.editionId,
    ownerId: edition.ownerId,
    guildId: edition.guildId,
    eventType: requireBoundedString(eventType, "eventType", 100),
    ...(options.stage === undefined ? {} : { stage: options.stage }),
    ...(options.safeCode === undefined ? {} : { safeCode: options.safeCode }),
    details: (options.details ?? []).slice(0, 20).map((detail) => ({
      key: detail.key.slice(0, 100),
      value: detail.value.slice(0, 500),
    })),
    createdAt: now,
  });
}

function editionIdFor(scheduledKey: string, revision: number): string {
  return `mr-${stableMarketResearchToken([scheduledKey, revision])}`;
}

async function createEdition(
  ctx: DatabaseWriter,
  preferences: Preferences,
  configurationSnapshotHash: string,
  decision: ReturnType<typeof dueScheduleDecision>,
  session: FrozenSessionContext,
  trigger: Doc<"marketResearchEditions">["trigger"],
  editionRevision: number,
  now: number,
  baseEditionId?: string,
) {
  const editionId = editionIdFor(decision.scheduledKey, editionRevision);
  const skipped = decision.kind === "skipped_late";
  const value = {
    ownerId: preferences.ownerId,
    guildId: preferences.guildId,
    scheduleId: preferences.scheduleId,
    forumChannelId: preferences.forumChannelId ?? "",
    editionId,
    scheduledKey: decision.scheduledKey,
    editionRevision,
    ...(baseEditionId === undefined ? {} : { baseEditionId }),
    editionDate: decision.editionDate,
    timezone: preferences.timezone,
    sessionType: session.sessionType,
    editionLabel: session.editionLabel,
    calendarVersion: session.calendarVersion,
    sessionSourceIds: session.sourceIds,
    previousSessionDate: session.previousSessionDate,
    previousSessionClose: session.previousSessionClose,
    nextSessionDate: session.nextSessionDate,
    trigger,
    status: skipped ? "skipped_late" as const : "queued" as const,
    stage: "queued" as const,
    configurationRevision: preferences.revision,
    configurationSnapshotHash,
    configurationSnapshot: preferences,
    thesisMemory: await loadThesisMemory(ctx, preferences),
    promptVersion: preferences.promptVersion,
    sourcePolicyVersion: preferences.sourcePolicyVersion,
    generation: 0,
    publicationGeneration: 0,
    attempts: 0,
    exaRequestCount: 0,
    exaCostUsd: 0,
    sourceCount: session.evidence.length,
    acceptedSourceCount: acceptedResearchEvidenceCount(session.evidence),
    scheduledFor: decision.scheduledFor,
    cutoffAt: decision.cutoffAt,
    ...(skipped ? { lastErrorCode: "late_cutoff_exceeded" as const, completedAt: now } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await ctx.db.insert("marketResearchEditions", value);
  for (const evidence of session.evidence) {
    await ctx.db.insert("marketResearchEvidence", {
      ...evidence,
      editionId,
      checkpointSequence: 0,
      retentionExpiresAt: now + MARKET_RESEARCH_EVIDENCE_RETENTION_MS,
      createdAt: now,
    });
  }
  await recordEvent({ db: ctx.db }, value, skipped ? "edition_skipped_late" : "edition_enqueued", now, {
    stage: "queued",
    ...(skipped ? { safeCode: "late_cutoff_exceeded" as const } : {}),
  });
  if (!skipped) {
    await ctx.scheduler.runAfter(0, internal.market_research_dispatch.dispatchEdition, { editionId });
  }
  return value;
}

function toPiPreferences(preferences: Preferences) {
  return {
    ...preferences,
    symbolPriorities: Object.fromEntries(preferences.symbolPriorities.map((entry) => [entry.symbol, entry.priority])),
  };
}

interface ExaUsage {
  searchRequests: number;
  contentPages: number;
  costUsd: number;
  costStatus: "known" | "unknown";
}

function jobRequest(
  edition: Doc<"marketResearchEditions">,
  exaUsage: ExaUsage,
  retainedEvidenceIds: string[] = [],
) {
  if (!edition.claimId) throw new Error("edition_lease_lost");
  return {
    schemaVersion: 1 as const,
    dispatchId: researchDispatchId(edition.editionId, edition.generation),
    editionId: edition.editionId,
    ownerId: edition.ownerId,
    guildId: edition.guildId,
    generation: edition.generation,
    claimToken: edition.claimId,
    scheduledFor: new Date(edition.scheduledFor).toISOString(),
    resumeFrom: edition.resumeFrom === "researching"
      || edition.resumeFrom === "calculating"
      || edition.resumeFrom === "composing"
      ? edition.resumeFrom
      : "collecting" as const,
    configurationSnapshotHash: edition.configurationSnapshotHash,
    preferences: toPiPreferences(edition.configurationSnapshot),
    thesisMemory: edition.thesisMemory ?? [],
    exaUsage,
    retainedEvidenceIds: [...new Set([...edition.sessionSourceIds, ...retainedEvidenceIds])].slice(0, 500),
    session: {
      sessionType: edition.sessionType,
      editionLabel: edition.editionLabel,
      editionDate: edition.editionDate,
      timezone: edition.timezone,
      configuredLocalTime: new Date(edition.scheduledFor).toISOString(),
      marketTime: new Date(edition.scheduledFor).toISOString(),
      previousSessionDate: edition.previousSessionDate,
      previousSessionClose: edition.previousSessionClose,
      nextSessionDate: edition.nextSessionDate,
      calendarVersion: edition.calendarVersion,
      sourceIds: edition.sessionSourceIds,
    },
  };
}

function previewJobRequest(preview: Doc<"marketResearchPreviews">, exaUsage: ExaUsage) {
  if (!preview.claimId) throw new Error("edition_lease_lost");
  return {
    schemaVersion: 1 as const,
    dispatchId: researchDispatchId(preview.previewId, preview.generation),
    editionId: preview.previewId,
    ownerId: preview.ownerId,
    guildId: preview.guildId,
    generation: preview.generation,
    claimToken: preview.claimId,
    scheduledFor: new Date(preview.scheduledFor).toISOString(),
    resumeFrom: "collecting" as const,
    configurationSnapshotHash: preview.configurationSnapshotHash,
    preferences: toPiPreferences(preview.configurationSnapshot),
    thesisMemory: preview.thesisMemory ?? [],
    exaUsage,
    retainedEvidenceIds: preview.sessionSourceIds,
    session: {
      sessionType: preview.sessionType,
      editionLabel: preview.editionLabel,
      editionDate: preview.editionDate,
      timezone: preview.timezone,
      configuredLocalTime: new Date(preview.scheduledFor).toISOString(),
      marketTime: new Date(preview.scheduledFor).toISOString(),
      previousSessionDate: preview.previousSessionDate,
      previousSessionClose: preview.previousSessionClose,
      nextSessionDate: preview.nextSessionDate,
      calendarVersion: preview.calendarVersion,
      sourceIds: preview.sessionSourceIds,
    },
  };
}

function activePreviewLease(
  preview: Doc<"marketResearchPreviews">,
  generation: number,
  claimToken: string,
  now: number,
): boolean {
  return isConfiguredMarketResearchOwner(preview.ownerId)
    && preview.generation === generation
    && preview.claimId === claimToken
    && preview.leaseExpiresAt !== undefined
    && preview.leaseExpiresAt > now;
}

function activeResearchLease(
  edition: Doc<"marketResearchEditions">,
  generation: number,
  claimToken: string,
  now: number,
): boolean {
  return isConfiguredMarketResearchOwner(edition.ownerId)
    && edition.generation === generation
    && edition.claimId === claimToken
    && edition.leaseExpiresAt !== undefined
    && edition.leaseExpiresAt > now;
}

export const getPreferences = query({
  args: { guildId: v.string() },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    return preferenceByOwnerGuild(ctx, actor.id, requireId(args.guildId, "guildId"));
  },
});

export const savePreferences = mutation({
  args: { preferences: marketResearchPreferencesValidator },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const preferences = validatePreferences(args.preferences, actor.id);
    await validateForum(ctx, preferences, true);
    if (preferences.enabled) {
      const calendar = await currentCalendarForOwner(
        ctx,
        actor.id,
        preferences.marketSessionCalendarId,
      );
      await requireCalendarEnablementGate(ctx, calendar, preferences, Date.now());
    }
    const existing = await preferenceByOwnerGuild(ctx, actor.id, preferences.guildId);
    const nowIso = new Date().toISOString();
    const revision = existing === null ? 0 : existing.revision + 1;
    const normalized: Preferences = {
      ...preferences,
      ownerId: actor.id,
      revision,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
    const configurationSnapshotHash = await sha256Hex(canonicalJson(normalized));
    if (existing) await ctx.db.replace(existing._id, { ...normalized, configurationSnapshotHash });
    else await ctx.db.insert("marketResearchPreferences", { ...normalized, configurationSnapshotHash });
    return { ...normalized, configurationSnapshotHash };
  },
});

const calendarSessionValidator = v.object({
  date: v.string(),
  status: v.union(v.literal("OPEN"), v.literal("EARLY_CLOSE"), v.literal("CLOSED")),
  regularOpen: v.optional(v.string()),
  regularClose: v.optional(v.string()),
  earlyClose: v.optional(v.string()),
});

export const listSessionCalendars = query({
  args: {},
  handler: async (ctx) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    return ctx.db
      .query("marketSessionCalendars")
      .withIndex("by_owner_calendar_updatedAt", (index) => index.eq("ownerId", actor.id))
      .order("desc")
      .take(25);
  },
});

export const saveSessionCalendar = mutation({
  args: {
    calendarId: v.string(),
    version: v.string(),
    sourceUrl: v.string(),
    retrievedAt: v.number(),
    effectiveStart: v.string(),
    effectiveEnd: v.string(),
    contentHash: v.string(),
    sessions: v.array(calendarSessionValidator),
    reviewed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const calendarId = requireId(args.calendarId, "calendarId");
    const version = requireId(args.version, "version");
    const sourceUrl = requirePublicHttpsUrl(args.sourceUrl, "sourceUrl");
    const effectiveStart = requireLocalDate(args.effectiveStart, "effectiveStart");
    const effectiveEnd = requireLocalDate(args.effectiveEnd, "effectiveEnd");
    if (
      effectiveStart > effectiveEnd
      || !hashPattern.test(args.contentHash)
      || !Number.isSafeInteger(args.retrievedAt)
      || args.retrievedAt <= 0
      || args.retrievedAt > Date.now() + 5 * 60 * 1_000
      || args.sessions.length < 1
      || args.sessions.length > MARKET_RESEARCH_MAX_CALENDAR_SESSIONS
      || serializedUtf8Bytes(args) > MARKET_RESEARCH_MAX_CALENDAR_BYTES
    ) throw new Error("market_session_calendar_stale");
    const dates = new Set<string>();
    const sessions = args.sessions.map((session) => {
      const date = requireLocalDate(session.date, "session.date");
      if (date < effectiveStart || date > effectiveEnd || dates.has(date)) {
        throw new Error("market_session_calendar_stale");
      }
      dates.add(date);
      if (session.status === "OPEN" || session.status === "EARLY_CLOSE") {
        if (!session.regularOpen || !session.regularClose) throw new Error("market_session_calendar_stale");
        requireLocalTime(session.regularOpen, "session.regularOpen");
        requireLocalTime(session.regularClose, "session.regularClose");
      }
      if (session.status === "EARLY_CLOSE") {
        if (!session.earlyClose) throw new Error("market_session_calendar_stale");
        requireLocalTime(session.earlyClose, "session.earlyClose");
      } else if (session.earlyClose !== undefined) {
        throw new Error("market_session_calendar_stale");
      }
      return session;
    });
    if (!hasCompleteCalendarDateCoverage(sessions, effectiveStart, effectiveEnd)) {
      throw new Error("market_session_calendar_stale");
    }
    const existing = await ctx.db
      .query("marketSessionCalendars")
      .withIndex("by_owner_calendar_version", (index) => index
        .eq("ownerId", actor.id)
        .eq("calendarId", calendarId)
        .eq("version", version))
      .unique();
    if (existing) {
      if (existing.contentHash !== args.contentHash) throw new Error("market_session_calendar_stale");
      return { calendarId, version, duplicate: true as const };
    }
    const now = Date.now();
    await ctx.db.insert("marketSessionCalendars", {
      ownerId: actor.id,
      calendarId,
      version,
      sourceUrl,
      retrievedAt: args.retrievedAt,
      effectiveStart,
      effectiveEnd,
      contentHash: args.contentHash,
      sessions,
      reviewed: args.reviewed,
      createdAt: now,
      updatedAt: now,
    });
    return { calendarId, version, duplicate: false as const };
  },
});

export const saveSessionOverride = mutation({
  args: {
    calendarId: v.string(),
    date: v.string(),
    status: v.union(v.literal("OPEN"), v.literal("EARLY_CLOSE"), v.literal("CLOSED")),
    regularOpen: v.optional(v.string()),
    regularClose: v.optional(v.string()),
    earlyClose: v.optional(v.string()),
    reason: v.string(),
    sourceUrl: v.string(),
    effectiveStart: v.number(),
    effectiveEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const calendarId = requireId(args.calendarId, "calendarId");
    const date = requireLocalDate(args.date, "date");
    const reason = requireBoundedString(args.reason, "reason", 1_000);
    const sourceUrl = requirePublicHttpsUrl(args.sourceUrl, "sourceUrl");
    if (!OFFICIAL_CALENDAR_HOSTS.has(new URL(sourceUrl).hostname.toLowerCase())) {
      throw new Error("market_session_calendar_stale");
    }
    if (
      !Number.isSafeInteger(args.effectiveStart)
      || !Number.isSafeInteger(args.effectiveEnd)
      || args.effectiveStart <= 0
      || args.effectiveStart >= args.effectiveEnd
      || args.effectiveEnd - args.effectiveStart > 366 * 24 * 60 * 60 * 1_000
    ) throw new Error("market_session_calendar_stale");
    if (args.status === "OPEN" || args.status === "EARLY_CLOSE") {
      if (!args.regularOpen || !args.regularClose) throw new Error("market_session_calendar_stale");
      requireLocalTime(args.regularOpen, "regularOpen");
      requireLocalTime(args.regularClose, "regularClose");
    } else if (args.regularOpen !== undefined || args.regularClose !== undefined) {
      throw new Error("market_session_calendar_stale");
    }
    if (args.status === "EARLY_CLOSE") {
      if (!args.earlyClose) throw new Error("market_session_calendar_stale");
      requireLocalTime(args.earlyClose, "earlyClose");
    } else if (args.earlyClose !== undefined) {
      throw new Error("market_session_calendar_stale");
    }
    const overrideId = `mro-${stableMarketResearchToken([
      actor.id,
      calendarId,
      date,
      args.status,
      args.regularOpen ?? "",
      args.regularClose ?? "",
      args.earlyClose ?? "",
      reason,
      sourceUrl,
      args.effectiveStart,
      args.effectiveEnd,
    ])}`;
    const existing = await ctx.db
      .query("marketSessionOverrides")
      .withIndex("by_owner_overrideId", (index) => index
        .eq("ownerId", actor.id)
        .eq("overrideId", overrideId))
      .unique();
    if (existing) return { overrideId, duplicate: true as const };
    await ctx.db.insert("marketSessionOverrides", {
      overrideId,
      ownerId: actor.id,
      calendarId,
      date,
      status: args.status,
      ...(args.regularOpen === undefined ? {} : { regularOpen: args.regularOpen }),
      ...(args.regularClose === undefined ? {} : { regularClose: args.regularClose }),
      ...(args.earlyClose === undefined ? {} : { earlyClose: args.earlyClose }),
      reason,
      sourceUrl,
      effectiveStart: args.effectiveStart,
      effectiveEnd: args.effectiveEnd,
      createdAt: Date.now(),
    });
    return { overrideId, duplicate: false as const };
  },
});

export const setEnabled = mutation({
  args: { guildId: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const existing = await preferenceByOwnerGuild(ctx, actor.id, requireId(args.guildId, "guildId"));
    if (!existing) throw new Error("forum_not_configured");
    const next = validatePreferences({ ...storedPreferences(existing), enabled: args.enabled }, actor.id);
    await validateForum(ctx, next);
    if (next.enabled) {
      const calendar = await currentCalendarForOwner(ctx, actor.id, next.marketSessionCalendarId);
      await requireCalendarEnablementGate(ctx, calendar, next, Date.now());
    }
    const updatedAt = new Date().toISOString();
    const revision = existing.revision + 1;
    const snapshot: Preferences = { ...next, revision, updatedAt };
    const configurationSnapshotHash = await sha256Hex(canonicalJson(snapshot));
    await ctx.db.replace(existing._id, { ...snapshot, configurationSnapshotHash });
    return { enabled: args.enabled, revision, updatedAt };
  },
});

export const saveControlSettings = mutation({
  args: {
    guildId: v.string(),
    forumChannelId: v.union(v.string(), v.null()),
    forumTagIds: v.array(v.string()),
    timezone: v.string(),
    timezoneConfirmed: v.boolean(),
    localHour: v.number(),
    localMinute: v.number(),
    includeWeekends: v.boolean(),
    editionDepth: v.union(v.literal("full"), v.literal("concise")),
    maximumRankedSetups: v.number(),
    enabled: v.boolean(),
    marketDataProviderId: v.optional(v.union(v.literal("exa_financial_datasets"), v.null())),
    includeCharts: v.optional(v.boolean()),
    maximumCharts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const guildId = requireId(args.guildId, "guildId");
    const nowIso = new Date().toISOString();
    const existing = await preferenceByOwnerGuild(ctx, actor.id, guildId);
    const base = existing ? storedPreferences(existing) : defaultPreferences(actor.id, guildId, nowIso);
    const next = validatePreferences({
      ...base,
      ...mergeMarketResearchControlOptions(base, {
        marketDataProviderId: args.marketDataProviderId,
        includeCharts: args.includeCharts,
        maximumCharts: args.maximumCharts,
      }),
      marketDataProviderId: args.marketDataProviderId ?? base.marketDataProviderId ?? MARKET_RESEARCH_DEFAULT_DATA_PROVIDER,
      enabled: args.enabled,
      forumChannelId: args.forumChannelId,
      forumTagIds: args.forumTagIds,
      timezone: args.timezone,
      timezoneConfirmed: args.timezoneConfirmed,
      localHour: args.localHour,
      localMinute: args.localMinute,
      includeWeekends: args.includeWeekends,
      editionDepth: "full",
      maximumRankedSetups: args.maximumRankedSetups,
    }, actor.id);
    await validateForum(ctx, next);
    if (next.enabled) {
      const calendar = await currentCalendarForOwner(
        ctx,
        actor.id,
        next.marketSessionCalendarId,
      );
      await requireCalendarEnablementGate(ctx, calendar, next, Date.now());
    }
    if (existing && canonicalJson(next) === canonicalJson(base)) {
      return { ...base, configurationSnapshotHash: existing.configurationSnapshotHash };
    }
    next.revision = existing ? existing.revision + 1 : 0;
    next.updatedAt = nowIso;
    const configurationSnapshotHash = await sha256Hex(canonicalJson(next));
    if (existing) await ctx.db.replace(existing._id, { ...next, configurationSnapshotHash });
    else await ctx.db.insert("marketResearchPreferences", { ...next, configurationSnapshotHash });
    return { ...next, configurationSnapshotHash };
  },
});

export const getThesisMemory = query({
  args: { guildId: v.string() },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const guildId = requireId(args.guildId, "guildId");
    const notes = await ctx.db.query("marketResearchTheses")
      .withIndex("by_owner_guild_symbol", (index) => index.eq("ownerId", actor.id).eq("guildId", guildId))
      .collect();
    return notes.map((note) => ({ ...thesisSnapshot(note), history: note.history }));
  },
});

export const getStatus = query({
  args: { guildId: v.string() },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const guildId = requireId(args.guildId, "guildId");
    const [preferences, editions] = await Promise.all([
      preferenceByOwnerGuild(ctx, actor.id, guildId),
      ctx.db.query("marketResearchEditions")
        .withIndex("by_owner_guild_editionDate", (index) => index.eq("ownerId", actor.id).eq("guildId", guildId))
        .order("desc")
        .take(10),
    ]);
    const last = editions[0];
    return {
      preferences,
      current: last ? {
        editionId: last.editionId,
        editionDate: last.editionDate,
        status: last.status,
        stage: last.stage,
        lastErrorCode: last.lastErrorCode,
        sourceCount: last.sourceCount,
        acceptedSourceCount: last.acceptedSourceCount,
        exaCostUsd: last.exaCostUsd,
        forumUrl: last.threadId ? `https://discord.com/channels/${last.guildId}/${last.threadId}` : undefined,
        updatedAt: last.updatedAt,
      } : null,
    };
  },
});

export const getControlStatuses = query({
  args: {},
  handler: async (ctx) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const preferences = await ctx.db
      .query("marketResearchPreferences")
      .withIndex("by_owner_guild", (index) => index.eq("ownerId", actor.id))
      .collect();
    return Promise.all(preferences.map(async (preference) => {
      const preview = await ctx.db.query("marketResearchPreviews")
        .withIndex("by_owner_guild_requestedAt", (index) => index
          .eq("ownerId", actor.id).eq("guildId", preference.guildId))
        .order("desc").first();
      const latest = await ctx.db
        .query("marketResearchEditions")
        .withIndex("by_owner_guild_editionDate", (index) => index
          .eq("ownerId", actor.id)
          .eq("guildId", preference.guildId))
        .order("desc")
        .first();
      return {
        guildId: preference.guildId,
        preferences: storedPreferences(preference),
        preview: preview && preview.expiresAt > Date.now() ? {
          previewId: preview.previewId,
          status: preview.status,
          requestedAt: preview.requestedAt,
          qualitySummary: preview.qualitySummary.slice(0, 30).map((line) => line.slice(0, 1_000)),
          safeFailure: preview.safeFailure,
          exaObservedCostUsd: preview.exaObservedCostUsd,
          exaCostEventCount: preview.exaCostEventCount,
          exaUnknownCostEventCount: preview.exaUnknownCostEventCount,
        } : null,
        current: latest ? {
          editionId: latest.editionId,
          editionDate: latest.editionDate,
          status: latest.status,
          stage: latest.stage,
          lastErrorCode: latest.lastErrorCode,
          sourceCount: latest.sourceCount,
          acceptedSourceCount: latest.acceptedSourceCount,
          exaCostUsd: latest.exaCostUsd,
          exaObservedCostUsd: latest.exaObservedCostUsd,
          exaCostEventCount: latest.exaCostEventCount,
          exaUnknownCostEventCount: latest.exaUnknownCostEventCount,
          forumUrl: latest.threadId ? `https://discord.com/channels/${latest.guildId}/${latest.threadId}` : undefined,
          updatedAt: latest.updatedAt,
        } : null,
      };
    }));
  },
});

export const manualTrigger = mutation({
  args: {
    guildId: v.string(),
    dryRun: v.boolean(),
    publish: v.boolean(),
    regeneratePublishedEdition: v.boolean(),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    requireConfiguredMarketResearchOwner(actor.id);
    if (args.dryRun === args.publish) throw new Error("Choose dryRun or publish.");
    const requestId = args.requestId === undefined ? undefined : requireId(args.requestId, "requestId");
    if (requestId !== undefined && (args.dryRun || args.regeneratePublishedEdition)) {
      throw new Error("A test request must publish a new edition.");
    }
    const preferences = await preferenceByOwnerGuild(ctx, actor.id, requireId(args.guildId, "guildId"));
    if (!preferences) throw new Error("market_research_disabled");
    const now = Date.now();
    const decision = dueScheduleDecision(preferences, now);
    if (args.dryRun) {
      const previewId = `MRP-${stableMarketResearchToken([actor.id, args.guildId, now])}`;
      const frozenPreferences = storedPreferences(preferences);
      const session = await frozenSessionContext(ctx, frozenPreferences, decision, now);
      await ctx.db.insert("marketResearchPreviews", {
        previewId,
        ownerId: actor.id,
        guildId: args.guildId,
        configurationSnapshotHash: preferences.configurationSnapshotHash,
        configurationSnapshot: frozenPreferences,
        thesisMemory: await loadThesisMemory(ctx, frozenPreferences),
        requestedAt: now,
        scheduledFor: decision.scheduledFor,
        sessionType: session.sessionType,
        editionLabel: session.editionLabel,
        editionDate: session.editionDate,
        timezone: session.timezone,
        calendarVersion: session.calendarVersion,
        sessionSourceIds: session.sourceIds,
        previousSessionDate: session.previousSessionDate,
        previousSessionClose: session.previousSessionClose,
        nextSessionDate: session.nextSessionDate,
        status: "queued",
        stage: "queued",
        generation: 0,
        attempts: 0,
        evidenceJson: JSON.stringify(session.evidence),
        qualitySummary: [
          "Preview is queued for the same isolated research and composition pipeline.",
          "It cannot publish, create delivery rows, or reserve the scheduled edition key.",
        ],
        expiresAt: now + 7 * 24 * 60 * 60 * 1_000,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.market_research_dispatch.dispatchPreview, { previewId });
      return {
        kind: "preview" as const,
        previewId,
        status: "queued" as const,
      };
    }
    if (preferences.forumChannelId === null) throw new Error("forum_not_configured");
    await validateForum(ctx, preferences);
    const manualDecision = {
      ...decision,
      kind: "due" as const,
      ...(requestId === undefined ? {} : {
        scheduledKey: manualTestEditionKey(preferences, requestId),
        scheduledFor: now,
      }),
    };
    const existing = await ctx.db
      .query("marketResearchEditions")
      .withIndex("by_owner_scheduledKey_revision", (index) => index
        .eq("ownerId", actor.id)
        .eq("scheduledKey", manualDecision.scheduledKey))
      .order("desc")
      .first();
    const disposition = manualEditionDisposition(existing, args.regeneratePublishedEdition);
    if (disposition.kind === "duplicate") {
      return { kind: "edition" as const, editionId: disposition.editionId, duplicate: true };
    }
    const session = await frozenSessionContext(ctx, storedPreferences(preferences), manualDecision, now);
    const edition = await createEdition(
      ctx,
      storedPreferences(preferences),
      preferences.configurationSnapshotHash,
      manualDecision,
      session,
      disposition.trigger,
      disposition.revision,
      now,
      disposition.parentEditionId ?? undefined,
    );
    return { kind: "edition" as const, editionId: edition.editionId, duplicate: false };
  },
});

export const cancelUnstarted = mutation({
  args: { editionId: v.string() },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const edition = await editionByStableId(ctx, requireId(args.editionId, "editionId"));
    if (!edition || edition.ownerId !== actor.id || edition.status !== "queued") throw new Error("edition_lease_lost");
    const now = Date.now();
    await ctx.db.patch(edition._id, { status: "cancelled", completedAt: now, updatedAt: now });
    await recordEvent(ctx, edition, "edition_cancelled", now);
    return { status: "cancelled" as const };
  },
});

export const retryEdition = mutation({
  args: { editionId: v.string() },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    requireConfiguredMarketResearchOwner(actor.id);
    const edition = await editionByStableId(ctx, requireId(args.editionId, "editionId"));
    if (!edition || edition.ownerId !== actor.id || !["failed", "partial", "retry_wait"].includes(edition.status)) {
      throw new Error("edition_lease_lost");
    }
    if (edition.lastErrorCode === "discord_thread_reconcile_ambiguous") throw new Error("discord_thread_reconcile_ambiguous");
    const now = Date.now();
    const resumeFrom = edition.threadId ? "publishing_replies" as const : edition.composedAt ? "ready_to_publish" as const : edition.resumeFrom ?? "collecting" as const;
    const status = edition.threadId || edition.composedAt ? "retry_wait" as const : "queued" as const;
    if (edition.threadId || edition.composedAt) {
      const deliveries = await boundedEditionDeliveries(ctx, edition.editionId);
      const firstMissing = firstMissingDeliverySequence(deliveries);
      if (firstMissing === undefined) throw new Error("edition_lease_lost");
      for (const delivery of deliveries) {
        if (delivery.status === "sent" || delivery.sequence < firstMissing) continue;
        await ctx.db.patch(delivery._id, {
          status: "pending",
          deliveryWorkerId: undefined,
          deliveryToken: undefined,
          deliveryLeaseExpiresAt: undefined,
          nextAttemptAt: now,
          lastErrorCode: undefined,
          lastErrorMessage: undefined,
          updatedAt: now,
        });
      }
    }
    await ctx.db.patch(edition._id, {
      status,
      stage: resumeFrom,
      resumeFrom,
      nextAttemptAt: now,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      updatedAt: now,
    });
    if (status === "queued") await ctx.scheduler.runAfter(0, internal.market_research_dispatch.dispatchEdition, { editionId: edition.editionId });
    await recordEvent(ctx, edition, "edition_retry_requested", now, { stage: resumeFrom });
    return { status, editionId: edition.editionId };
  },
});

export const requestReconciliation = mutation({
  args: { editionId: v.string() },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    requireConfiguredMarketResearchOwner(actor.id);
    const edition = await editionByStableId(ctx, requireId(args.editionId, "editionId"));
    if (
      !edition
      || edition.ownerId !== actor.id
      || edition.lastErrorCode !== "discord_thread_reconcile_ambiguous"
      || edition.threadId !== undefined
    ) throw new Error("discord_thread_reconcile_ambiguous");
    const starter = await ctx.db
      .query("marketResearchDeliveries")
      .withIndex("by_edition_sequence", (index) => index
        .eq("editionId", edition.editionId)
        .eq("sequence", 0))
      .unique();
    if (!starter || starter.kind !== "starter") throw new Error("discord_thread_reconcile_failed");
    const now = Date.now();
    await ctx.db.patch(starter._id, {
      status: "pending",
      deliveryWorkerId: undefined,
      deliveryToken: undefined,
      deliveryLeaseExpiresAt: undefined,
      nextAttemptAt: now,
      lastErrorCode: "discord_thread_reconcile_failed",
      lastErrorMessage: "discord_thread_reconcile_failed",
      updatedAt: now,
    });
    await ctx.db.patch(edition._id, {
      status: "retry_wait",
      stage: "creating_thread",
      publicationWorkerId: undefined,
      publicationToken: undefined,
      publicationLeaseExpiresAt: undefined,
      nextAttemptAt: now,
      lastErrorCode: "discord_thread_reconcile_failed",
      lastErrorMessage: "discord_thread_reconcile_failed",
      completedAt: undefined,
      updatedAt: now,
    });
    await recordEvent(ctx, edition, "operator_reconciliation_requested", now, {
      stage: "creating_thread",
      safeCode: "discord_thread_reconcile_failed",
    });
    return { editionId: edition.editionId, status: "retry_wait" as const };
  },
});

export const checkDueEditions = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    continuation: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const page = await ctx.db
      .query("marketResearchPreferences")
      .withIndex("by_enabled_updatedAt", (index) => index.eq("enabled", true))
      .paginate({
        cursor: args.cursor ?? null,
        numItems: MARKET_RESEARCH_RECOVERY_BATCH_SIZE,
      });
    let created = 0;
    let skipped = 0;
    let existing = 0;
    for (const preference of page.page) {
      if (!isConfiguredMarketResearchOwner(preference.ownerId)) continue;
      const decision = dueScheduleDecision(preference, now);
      if (decision.kind === "before") continue;
      const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone: preference.timezone,
        weekday: "short",
      }).format(new Date(decision.scheduledFor));
      if (!scheduleDayEnabled(preference.includeWeekends, weekday)) continue;
      const found = await ctx.db
        .query("marketResearchEditions")
        .withIndex("by_owner_scheduledKey_revision", (index) => index
          .eq("ownerId", preference.ownerId)
          .eq("scheduledKey", decision.scheduledKey)
          .eq("editionRevision", 0))
        .unique();
      if (found) { existing += 1; continue; }
      const session = await frozenSessionContext(ctx, storedPreferences(preference), decision, now);
      await createEdition(
        ctx,
        storedPreferences(preference),
        preference.configurationSnapshotHash,
        decision,
        session,
        "scheduled",
        0,
        now,
      );
      if (decision.kind === "skipped_late") skipped += 1;
      else created += 1;
    }
    const continuation = args.continuation ?? 0;
    const continuationPolicy = schedulerContinuation(page.isDone, continuation);
    if (continuationPolicy !== undefined) {
      await ctx.scheduler.runAfter(continuationPolicy.delayMs, internal.market_research.checkDueEditions, {
        cursor: page.continueCursor,
        continuation: continuationPolicy.continuation,
      });
    }
    return {
      scanned: page.page.length,
      created,
      skipped,
      existing,
      hasMore: !page.isDone,
    };
  },
});

export const MARKET_RESEARCH_MAX_COST_EVENTS_PER_CLAIM = 1_024;

export async function durableExaUsage(
  ctx: Pick<MutationCtx, "db">,
  ownerId: string,
  targetId: string,
): Promise<ExaUsage> {
  const bindings = await ctx.db.query("marketResearchCostBindings")
    .withIndex("by_owner_target_generation", (index) => index.eq("ownerId", ownerId).eq("targetId", targetId))
    .collect();
  const usage: ExaUsage = { searchRequests: 0, contentPages: 0, costUsd: 0, costStatus: "known" };
  for (const binding of bindings) {
    const events = await ctx.db.query("marketResearchCostEvents")
      .withIndex("by_binding_event", (index) => index.eq("bindingId", binding._id))
      .take(MARKET_RESEARCH_MAX_COST_EVENTS_PER_CLAIM + 1);
    const identifiedRequests = new Set<string>();
    let bindingCostUsd = 0;
    for (const event of events) {
      bindingCostUsd += event.costUsd ?? 0;
      if (event.costUsd === null) usage.costStatus = "unknown";
      const requestKey = event.requestId === undefined ? undefined : `${event.operation}:${event.requestId}`;
      if (requestKey !== undefined && identifiedRequests.has(requestKey)) continue;
      if (requestKey !== undefined) identifiedRequests.add(requestKey);
      if (event.operation === "search") usage.searchRequests += 1;
      if (event.operation === "contents") usage.contentPages += 1;
    }
    // Older events do not correlate an abandoned request with its late result.
    // Keep those unknown costs closed instead of granting a fresh retry allowance.
    if (events.length !== binding.eventCount || binding.unknownCostEventCount > 0) usage.costStatus = "unknown";
    usage.costUsd += Math.max(bindingCostUsd, binding.knownCostUsd);
  }
  return usage;
}

export const marketResearchCostEventSchema = z.object({
  eventId: z.string().regex(idPattern),
  operation: z.enum(["search", "contents", "financial_datasets"]),
  outcome: z.enum(["settled", "abandoned", "failed"]),
  costUsd: z.number().finite().min(0).max(1_000).nullable(),
  late: z.boolean(),
  observedAt: z.iso.datetime({ offset: true }).max(64),
  requestId: z.string().regex(idPattern).optional(),
}).strict().refine((event) => event.outcome !== "abandoned" || event.costUsd === null);

interface ExaCostBindingInput {
  ownerId: string;
  targetId: string;
  targetKind: "edition" | "preview";
  generation: number;
  claimToken: string;
}

// Only claim issuance creates this immutable accounting authorization. Unlike work leases,
// it survives generation changes so already-paid requests can report their final cost.
export async function registerExaCostBinding(
  ctx: Pick<MutationCtx, "db">,
  input: ExaCostBindingInput,
  now: number,
): Promise<void> {
  const { claimToken, ...binding } = input;
  await ctx.db.insert("marketResearchCostBindings", {
    ...binding,
    claimTokenHash: await sha256Hex(claimToken),
    eventCount: 0,
    knownCostUsd: 0,
    unknownCostEventCount: 0,
    createdAt: now,
  });
}

export async function persistExaCostEvent(
  ctx: Pick<MutationCtx, "db">,
  args: { ownerId: string; editionId: string; generation: number; claimToken: string; event: unknown },
) {
  const event = marketResearchCostEventSchema.safeParse(args.event);
  if (
    !event.success || !isConfiguredMarketResearchOwner(args.ownerId)
    || !idPattern.test(args.editionId) || !idPattern.test(args.claimToken)
    || !Number.isSafeInteger(args.generation) || args.generation < 1
  ) return { accepted: false as const };
  const binding = await ctx.db.query("marketResearchCostBindings")
    .withIndex("by_owner_target_generation", (index) => index
      .eq("ownerId", args.ownerId).eq("targetId", args.editionId).eq("generation", args.generation))
    .unique();
  if (!binding || binding.claimTokenHash !== await sha256Hex(args.claimToken)) {
    return { accepted: false as const };
  }
  const fingerprint = await sha256Hex(canonicalJson(event.data));
  const existing = await ctx.db.query("marketResearchCostEvents")
    .withIndex("by_binding_event", (index) => index.eq("bindingId", binding._id).eq("eventId", event.data.eventId))
    .unique();
  if (existing) return existing.fingerprint === fingerprint
    ? { accepted: true as const, duplicate: true as const }
    : { accepted: false as const };
  if (binding.eventCount >= MARKET_RESEARCH_MAX_COST_EVENTS_PER_CLAIM) return { accepted: false as const };
  const now = Date.now();
  const { requestId, ...costEvent } = event.data;
  await ctx.db.insert("marketResearchCostEvents", {
    ...costEvent, bindingId: binding._id, fingerprint, createdAt: now,
    ...(requestId === undefined ? {} : { requestId }),
  });
  await ctx.db.patch(binding._id, {
    eventCount: binding.eventCount + 1,
    knownCostUsd: binding.knownCostUsd + (event.data.costUsd ?? 0),
    unknownCostEventCount: binding.unknownCostEventCount + Number(event.data.costUsd === null),
  });
  const target = binding.targetKind === "preview"
    ? await previewByStableId(ctx, binding.targetId)
    : await editionByStableId(ctx, binding.targetId);
  // The immutable binding retains the bill even after preview retention removes its target.
  if (target?.ownerId === binding.ownerId) {
    await ctx.db.patch(target._id, {
      exaObservedCostUsd: (target.exaObservedCostUsd ?? 0) + (event.data.costUsd ?? 0),
      exaCostEventCount: (target.exaCostEventCount ?? 0) + 1,
      exaUnknownCostEventCount: (target.exaUnknownCostEventCount ?? 0) + Number(event.data.costUsd === null),
    });
  }
  return { accepted: true as const, duplicate: false as const };
}

export const recordExaCostEvent = internalMutation({
  args: {
    ownerId: v.string(), editionId: v.string(), generation: v.number(), claimToken: v.string(), event: v.any(),
  },
  handler: persistExaCostEvent,
});

export const claimResearch = internalMutation({
  args: { editionId: v.string(), workerId: v.string() },
  handler: async (ctx, args) => {
    const edition = await editionByStableId(ctx, requireId(args.editionId, "editionId"));
    if (!edition || !isConfiguredMarketResearchOwner(edition.ownerId)) return null;
    const now = Date.now();
    if (
      edition.status !== "queued"
      && !(edition.status === "retry_wait" && (edition.nextAttemptAt ?? Number.MAX_SAFE_INTEGER) <= now && !edition.composedAt)
    ) return null;
    if (shouldSkipUnstartedEdition(edition, now)) {
      await ctx.db.patch(edition._id, {
        status: "skipped_late",
        lastErrorCode: "late_cutoff_exceeded",
        lastErrorMessage: "late_cutoff_exceeded",
        completedAt: now,
        updatedAt: now,
      });
      await recordEvent(ctx, edition, "edition_skipped_late", now, {
        stage: "queued",
        safeCode: "late_cutoff_exceeded",
      });
      return null;
    }
    const generation = edition.generation + 1;
    const claimId = stableMarketResearchToken([edition.editionId, args.workerId, generation, now]);
    await registerExaCostBinding(ctx, {
      ownerId: edition.ownerId, targetId: edition.editionId, targetKind: "edition", generation, claimToken: claimId,
    }, now);
    await ctx.db.patch(edition._id, {
      status: "collecting",
      stage: "collecting",
      workerId: requireId(args.workerId, "workerId"),
      claimId,
      generation,
      leaseExpiresAt: now + MARKET_RESEARCH_LEASE_MS,
      attempts: edition.attempts + 1,
      startedAt: edition.startedAt ?? now,
      nextAttemptAt: undefined,
      updatedAt: now,
    });
    const claimed = await ctx.db.get(edition._id);
    if (!claimed) return null;
    await recordEvent(ctx, claimed, "research_claimed", now, { stage: "collecting" });
    return jobRequest(claimed, await durableExaUsage(ctx, claimed.ownerId, claimed.editionId));
  },
});

export const claimPreview = internalMutation({
  args: { previewId: v.string(), workerId: v.string() },
  handler: async (ctx, args) => {
    const preview = await previewByStableId(ctx, requireId(args.previewId, "previewId"));
    if (!preview || !isConfiguredMarketResearchOwner(preview.ownerId) || preview.status !== "queued") return null;
    const now = Date.now();
    const generation = preview.generation + 1;
    const claimId = stableMarketResearchToken([preview.previewId, args.workerId, generation, now]);
    await registerExaCostBinding(ctx, {
      ownerId: preview.ownerId, targetId: preview.previewId, targetKind: "preview", generation, claimToken: claimId,
    }, now);
    await ctx.db.patch(preview._id, {
      status: "running",
      stage: "collecting",
      generation,
      workerId: requireId(args.workerId, "workerId"),
      claimId,
      leaseExpiresAt: now + MARKET_RESEARCH_LEASE_MS,
      attempts: preview.attempts + 1,
      safeFailure: undefined,
      updatedAt: now,
    });
    const claimed = await ctx.db.get(preview._id);
    return claimed ? previewJobRequest(claimed, await durableExaUsage(ctx, claimed.ownerId, claimed.previewId)) : null;
  },
});

export const heartbeatResearch = internalMutation({
  args: {
    editionId: v.string(),
    generation: v.number(),
    claimToken: v.string(),
    stage: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const allowedStages = ["collecting", "researching", "calculating", "composing"] as const;
    const stage = allowedStages.find((candidate) => candidate === args.stage);
    if (!stage) return { accepted: false as const };
    if (args.editionId.startsWith("MRP-")) {
      const preview = await previewByStableId(ctx, requireId(args.editionId, "previewId"));
      if (!preview || !activePreviewLease(preview, args.generation, args.claimToken, now)) {
        return { accepted: false as const };
      }
      await ctx.db.patch(preview._id, {
        status: "running",
        stage,
        leaseExpiresAt: now + MARKET_RESEARCH_LEASE_MS,
        updatedAt: now,
      });
      return { accepted: true as const, leaseExpiresAt: now + MARKET_RESEARCH_LEASE_MS };
    }
    const edition = await editionByStableId(ctx, requireId(args.editionId, "editionId"));
    if (!edition || !activeResearchLease(edition, args.generation, args.claimToken, now)) return { accepted: false as const };
    await ctx.db.patch(edition._id, {
      status: stage,
      stage,
      leaseExpiresAt: now + MARKET_RESEARCH_LEASE_MS,
      resumeFrom: stage,
      updatedAt: now,
    });
    return { accepted: true as const, leaseExpiresAt: now + MARKET_RESEARCH_LEASE_MS };
  },
});

const evidenceRecordSchema = z.object({
  evidenceId: z.string().trim().min(1).max(256).regex(idPattern),
  kind: z.enum(["news", "official", "quote", "bar", "calculation", "calendar", "corporate_action", "source_status"]),
  provider: z.string().trim().min(1).max(100),
  sourcePolicy: z.enum(["approved", "evaluation_only", "permission_required", "blocked", "unavailable"]),
  title: z.string().trim().min(1).max(500).optional(),
  url: z.url().max(2_000).refine((value) => {
    try { requirePublicHttpsUrl(value, "url"); return true; }
    catch { return false; }
  }).optional(),
  canonicalUrlHash: z.string().regex(hashPattern).optional(),
  author: z.string().trim().min(1).max(200).optional(),
  publishedAt: z.iso.datetime({ offset: true }).optional(),
  providerTimestamp: z.iso.datetime({ offset: true }).optional(),
  retrievedAt: z.iso.datetime({ offset: true }),
  sessionLabel: z.enum(["premarket", "regular", "after_hours", "closed", "unknown"]).optional(),
  freshness: z.enum(["fresh", "cached", "delayed", "stale", "unknown"]),
  contentStatus: z.enum(["available", "cached", "delayed", "stale", "unknown", "blocked", "failed"]),
  highlights: z.array(z.string().max(2_000)).max(20),
  normalizedClaims: z.array(z.string().trim().min(1).max(1_000)).max(30),
  requestId: z.string().trim().min(1).max(256).regex(idPattern).optional(),
  costUsd: z.number().finite().nonnegative().max(1_000).optional(),
  contentHash: z.string().regex(hashPattern),
}).strict().superRefine((value, context) => {
  if (value.highlights.join("\n").length > 2_000) {
    context.addIssue({ code: "custom", path: ["highlights"], message: "Highlights exceed the retained limit." });
  }
  if (value.kind === "quote" && (value.providerTimestamp === undefined || value.sessionLabel === undefined)) {
    context.addIssue({ code: "custom", message: "Quotes require a provider timestamp and session label." });
  }
});

function retainedEvidenceItem(record: Doc<"marketResearchEvidence">): z.infer<typeof evidenceRecordSchema> {
  const { _id, _creationTime, editionId, checkpointSequence, retentionExpiresAt, createdAt, ...item } = record;
  void _id;
  void _creationTime;
  void editionId;
  void checkpointSequence;
  void retentionExpiresAt;
  void createdAt;
  return item;
}

export const appendEvidence = internalMutation({
  args: {
    editionId: v.string(),
    generation: v.number(),
    claimToken: v.string(),
    sequence: v.number(),
    evidence: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (!Number.isSafeInteger(args.sequence) || args.sequence < 0 || args.evidence.length > 64 || serializedUtf8Bytes(args.evidence) > MARKET_RESEARCH_MAX_EVIDENCE_RECORD_BYTES) {
      return { accepted: false as const };
    }
    const parsed = z.array(evidenceRecordSchema).safeParse(args.evidence);
    if (!parsed.success || new Set(parsed.data.map((item) => item.evidenceId)).size !== parsed.data.length) {
      return { accepted: false as const };
    }
    if (args.editionId.startsWith("MRP-")) {
      const preview = await previewByStableId(ctx, requireId(args.editionId, "previewId"));
      if (!preview || !activePreviewLease(preview, args.generation, args.claimToken, now)) {
        return { accepted: false as const };
      }
      let existing: z.infer<typeof evidenceRecordSchema>[];
      try {
        existing = z.array(evidenceRecordSchema).max(500).parse(JSON.parse(preview.evidenceJson) as unknown);
      } catch {
        return { accepted: false as const };
      }
      const byId = new Map(existing.map((item) => [item.evidenceId, item]));
      let inserted = 0;
      for (const item of parsed.data) {
        const retained = byId.get(item.evidenceId);
        if (retained && retained.contentHash !== item.contentHash) return { accepted: false as const };
        if (!retained) {
          byId.set(item.evidenceId, item);
          inserted += 1;
        }
      }
      const merged = [...byId.values()];
      if (merged.length > 500 || serializedUtf8Bytes(merged) > MARKET_RESEARCH_MAX_EVIDENCE_PACKET_BYTES) {
        return { accepted: false as const };
      }
      await ctx.db.patch(preview._id, {
        evidenceJson: JSON.stringify(merged),
        leaseExpiresAt: now + MARKET_RESEARCH_LEASE_MS,
        updatedAt: now,
      });
      return { accepted: true as const, inserted };
    }
    const edition = await editionByStableId(ctx, requireId(args.editionId, "editionId"));
    if (!edition || !activeResearchLease(edition, args.generation, args.claimToken, now)) return { accepted: false as const };
    const stored = await ctx.db.query("marketResearchEvidence")
      .withIndex("by_edition_checkpointSequence", (index) => index.eq("editionId", edition.editionId))
      .take(501);
    if (stored.length > 500) return { accepted: false as const };
    const storedById = new Map(stored.map((item) => [item.evidenceId, item]));
    const pending: typeof parsed.data = [];
    for (const item of parsed.data) {
      if (serializedUtf8Bytes(item) > MARKET_RESEARCH_MAX_EVIDENCE_RECORD_BYTES) return { accepted: false as const };
      const existing = storedById.get(item.evidenceId);
      if (existing) {
        if (existing.contentHash !== item.contentHash) return { accepted: false as const };
      } else {
        pending.push(item);
      }
    }
    const merged = [...stored.map(retainedEvidenceItem), ...pending];
    if (merged.length > 500 || serializedUtf8Bytes(merged) > MARKET_RESEARCH_MAX_EVIDENCE_PACKET_BYTES) {
      return { accepted: false as const };
    }
    let inserted = 0;
    for (const item of pending) {
      const normalizedItem = JSON.parse(JSON.stringify(item)) as Omit<
        Doc<"marketResearchEvidence">,
        "_id" | "_creationTime" | "editionId" | "checkpointSequence" | "createdAt"
      >;
      await ctx.db.insert("marketResearchEvidence", {
        ...normalizedItem,
        editionId: edition.editionId,
        checkpointSequence: args.sequence,
        retentionExpiresAt: now + MARKET_RESEARCH_EVIDENCE_RETENTION_MS,
        createdAt: now,
      });
      inserted += 1;
    }
    await ctx.db.patch(edition._id, {
      sourceCount: edition.sourceCount + inserted,
      acceptedSourceCount: edition.acceptedSourceCount + acceptedResearchEvidenceCount(pending),
      leaseExpiresAt: now + MARKET_RESEARCH_LEASE_MS,
      updatedAt: now,
    });
    return { accepted: true as const, inserted };
  },
});

export const loadEvidence = internalQuery({
  args: {
    editionId: v.string(),
    generation: v.number(),
    claimToken: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (args.editionId.startsWith("MRP-")) {
      const preview = await previewByStableId(ctx, requireId(args.editionId, "previewId"));
      if (!preview || !activePreviewLease(preview, args.generation, args.claimToken, now)) {
        return { accepted: false as const, evidence: [] };
      }
      try {
        const evidence = z.array(evidenceRecordSchema).max(500).parse(JSON.parse(preview.evidenceJson) as unknown);
        return serializedUtf8Bytes(evidence) <= MARKET_RESEARCH_MAX_EVIDENCE_PACKET_BYTES
          ? { accepted: true as const, evidence }
          : { accepted: false as const, evidence: [] };
      } catch {
        return { accepted: false as const, evidence: [] };
      }
    }
    const edition = await editionByStableId(ctx, requireId(args.editionId, "editionId"));
    if (!edition || !activeResearchLease(edition, args.generation, args.claimToken, now)) {
      return { accepted: false as const, evidence: [] };
    }
    const records = await ctx.db
      .query("marketResearchEvidence")
      .withIndex("by_edition_checkpointSequence", (index) => index.eq("editionId", edition.editionId))
      .order("asc")
      .take(501);
    const evidence = records.map(retainedEvidenceItem);
    if (evidence.length > 500 || serializedUtf8Bytes(evidence) > MARKET_RESEARCH_MAX_EVIDENCE_PACKET_BYTES) {
      return { accepted: false as const, evidence: [] };
    }
    return { accepted: true as const, evidence };
  },
});

const strictId = z.string().trim().min(1).max(256).regex(idPattern);
const strictHash = z.string().regex(hashPattern);
const strictSymbol = z.string().trim().min(1).max(20).regex(symbolPattern);
const strictLocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const strictIsoDateTime = z.iso.datetime({ offset: true });
const strictText = (maximum: number) => z.string().trim().min(1).max(maximum);
const strictSourceIds = z.array(strictId).min(1).max(20).refine(
  (values) => new Set(values).size === values.length,
  "Source IDs must be unique.",
);
const requestedSourceRecordSchema = z.object({
  source: z.enum(REQUESTED_SOURCES),
  status: z.enum(["contributed", "no_material_item", "unavailable", "disabled_by_policy"]),
  detail: strictText(300),
  sourceIds: z.array(strictId).max(20).refine((values) => new Set(values).size === values.length),
}).strict();
const sessionContextRecordSchema = z.object({
  sessionType: z.enum(["OPEN", "EARLY_CLOSE", "CLOSED", "UNKNOWN"]),
  editionLabel: z.enum(["Morning Market Newspaper", "Weekend Outlook", "Market Holiday Outlook", "Late Edition", "Data unavailable"]),
  editionDate: strictLocalDate,
  timezone: strictText(100),
  configuredLocalTime: strictIsoDateTime,
  marketTime: strictIsoDateTime,
  previousSessionDate: strictLocalDate.nullable(),
  previousSessionClose: strictIsoDateTime.nullable(),
  nextSessionDate: strictLocalDate.nullable(),
  calendarVersion: strictId,
  sourceIds: strictSourceIds.or(z.array(strictId).length(0)),
}).strict();
const evidencePacketRecordSchema = z.object({
  schemaVersion: z.literal(1),
  editionId: strictId,
  generatedAt: strictIsoDateTime,
  session: sessionContextRecordSchema,
  primarySymbols: z.array(strictSymbol).min(1).max(10),
  sectorSymbols: z.array(strictSymbol).max(20),
  discoverySymbols: z.array(strictSymbol).max(40),
  sourcePolicyVersion: strictId,
  requestedSourceStatus: z.array(requestedSourceRecordSchema).length(5),
  evidence: z.array(evidenceRecordSchema).max(500),
  missingFields: z.array(strictText(500)).max(200),
  conflicts: z.array(z.object({
    conflictId: strictId,
    field: strictText(100),
    sourceIds: strictSourceIds,
    detail: strictText(500),
  }).strict()).max(100),
  allowedSourceIds: z.array(strictId).max(500),
}).strict().superRefine((value, context) => {
  const actual = new Set(value.evidence.map((item) => item.evidenceId));
  if (actual.size !== value.evidence.length) {
    context.addIssue({ code: "custom", path: ["evidence"], message: "Evidence IDs must be unique." });
  }
  if (new Set(value.allowedSourceIds).size !== value.allowedSourceIds.length) {
    context.addIssue({ code: "custom", path: ["allowedSourceIds"], message: "Allowed source IDs must be unique." });
  }
  const references = [
    ...value.allowedSourceIds,
    ...value.session.sourceIds,
    ...value.requestedSourceStatus.flatMap((status) => status.sourceIds),
    ...value.conflicts.flatMap((conflict) => conflict.sourceIds),
  ];
  if (references.some((sourceId) => !actual.has(sourceId))) {
    context.addIssue({ code: "custom", message: "Evidence packet cites an unknown source ID." });
  }
  for (const symbols of [value.primarySymbols, value.sectorSymbols, value.discoverySymbols]) {
    if (new Set(symbols).size !== symbols.length) {
      context.addIssue({ code: "custom", message: "Evidence symbol boards must be unique." });
    }
  }
});
const unavailableClaim = /\b(?:unavailable|unverified|unknown|not (?:available|verified|confirmed)|cannot verify|could not verify|no reliable data)\b/i;
const optionalSourceIds = z.array(strictId).max(20).refine((values) => new Set(values).size === values.length);
const citedTextRecordSchema = z.object({ text: strictText(2_000), sourceIds: optionalSourceIds }).strict()
  .refine((value) => value.sourceIds.length > 0 || unavailableClaim.test(value.text), "Uncited text must disclose unavailable information.");
const setupRecordSchema = z.object({
  symbol: strictSymbol,
  label: z.enum(["TOP WATCH", "WATCH", "WAIT FOR CONFIRMATION", "AVOID", "EXIT-RISK"]),
  score: z.number().int().min(0).max(100),
  components: z.object({
    catalyst: z.number().int().min(0).max(20),
    liquidityAndSpread: z.number().int().min(0).max(15),
    dailyAndHourlyBias: z.number().int().min(0).max(20),
    premarketStructure: z.number().int().min(0).max(15),
    levelQualityAndProximity: z.number().int().min(0).max(20),
    indexAndSectorConfirmation: z.number().int().min(0).max(10),
  }).strict(),
  deductions: z.array(strictText(300)).max(12),
  thesisLabel: z.enum(["VALIDATED", "PARTIALLY VALIDATED", "AT RISK", "INVALIDATED", "NO PRIOR THESIS"]),
  trigger: citedTextRecordSchema,
  invalidation: citedTextRecordSchema,
  firstResistanceOrTarget: citedTextRecordSchema,
  rewardToRisk: citedTextRecordSchema,
  noChase: citedTextRecordSchema,
  indexOrSectorCondition: citedTextRecordSchema,
  eventRisk: citedTextRecordSchema,
  sourceIds: strictSourceIds,
}).strict().superRefine((value, context) => {
  const total = Object.values(value.components).reduce((sum, component) => sum + component, 0);
  const expectedLabel = value.score >= 85
    ? "TOP WATCH"
    : value.score >= 75
      ? "WATCH"
      : value.score >= 65
        ? "WAIT FOR CONFIRMATION"
        : "AVOID";
  if (value.score !== total || (value.label !== "EXIT-RISK" && value.label !== expectedLabel)) {
    context.addIssue({ code: "custom", message: "Setup score, components, or label is invalid." });
  }
  if (value.label === "EXIT-RISK" && !["AT RISK", "INVALIDATED"].includes(value.thesisLabel)) {
    context.addIssue({ code: "custom", message: "EXIT-RISK requires an at-risk thesis." });
  }
});
const dossierRecordSchema = z.object({
  symbol: strictSymbol,
  thesisLabel: z.enum(["VALIDATED", "PARTIALLY VALIDATED", "AT RISK", "INVALIDATED", "NO PRIOR THESIS"]),
  summary: citedTextRecordSchema,
  availableFields: z.array(strictText(100)).max(50),
  unavailableFields: z.array(strictText(100)).max(50),
  sourceIds: optionalSourceIds,
}).strict().refine((value) => value.sourceIds.length > 0
  || (value.availableFields.length === 0 && unavailableClaim.test(value.summary.text)), "Uncited dossiers must disclose unavailable information.");
const sectionKindSchema = z.enum([
  "how_to_read", "overnight_macro", "cross_asset", "index_sector", "scheduled_events",
  "primary_board", "challengers", "ticker_dossiers", "validation", "after_open",
  "requested_sources", "data_quality", "sources",
]);
const sectionRecordSchema = z.object({
  sectionId: strictId,
  sequence: z.number().int().nonnegative().max(100),
  kind: sectionKindSchema,
  heading: strictText(100),
  markdown: z.string().trim().min(1).max(24_000),
  sourceIds: z.array(strictId).max(100).refine((values) => new Set(values).size === values.length),
}).strict();

const chartRequestRecordSchema = z.object({
  chartRequestId: z.string().trim().min(1).max(256).regex(idPattern),
  editionId: z.string().trim().min(1).max(256).regex(idPattern),
  sectionId: z.string().trim().min(1).max(256).regex(idPattern),
  symbol: z.string().trim().min(1).max(20).regex(symbolPattern),
  timeframe: z.enum(["5m", "15m", "60m", "daily", "weekly"]),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  session: z.enum(["premarket", "regular", "after_hours", "all"]),
  overlays: z.array(z.string().trim().min(1).max(100)).max(10),
  annotations: z.array(z.string().trim().min(1).max(300)).max(20),
  reason: z.string().trim().min(1).max(500),
  priority: z.number().int().min(0).max(100),
  sourceEvidenceIds: z.array(z.string().trim().min(1).max(256).regex(idPattern)).min(1).max(20),
  dataAsOf: z.iso.datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (
    Date.parse(value.start) >= Date.parse(value.end)
    || new Set(value.sourceEvidenceIds).size !== value.sourceEvidenceIds.length
  ) context.addIssue({ code: "custom", message: "Invalid chart request range or source IDs." });
});

type PiChartRequest = z.infer<typeof chartRequestRecordSchema>;

const editionRecordSchema = z.object({
  schemaVersion: z.literal(1),
  editionId: strictId,
  editionDate: strictLocalDate,
  timezone: strictText(100),
  asOf: strictIsoDateTime,
  sessionType: z.enum(["OPEN", "EARLY_CLOSE", "CLOSED", "UNKNOWN"]),
  editionLabel: z.enum(["Morning Market Newspaper", "Weekend Outlook", "Market Holiday Outlook", "Late Edition", "Data unavailable"]),
  regime: z.enum(["RISK_ON", "MIXED", "RISK_OFF"]),
  regimeLines: z.array(citedTextRecordSchema).min(1).max(5),
  topStories: z.array(citedTextRecordSchema).max(5),
  scheduledEvents: z.array(citedTextRecordSchema).max(20),
  marketContext: z.array(citedTextRecordSchema).min(1).max(30),
  primaryBoard: z.array(setupRecordSchema).max(10),
  challengers: z.array(setupRecordSchema).max(3),
  tickerDossiers: z.array(dossierRecordSchema).max(40),
  validationRules: z.array(citedTextRecordSchema).min(1).max(20),
  afterOpenChanges: z.array(citedTextRecordSchema).max(20),
  requestedSourceStatus: z.array(requestedSourceRecordSchema).length(5),
  dataQuality: z.array(citedTextRecordSchema).min(1).max(50),
  sections: z.array(sectionRecordSchema).min(3).max(30),
  chartRequests: z.array(chartRequestRecordSchema).max(3),
  sourceIds: z.array(strictId).min(1).max(500).refine((values) => new Set(values).size === values.length),
  noTradingAction: z.literal(true),
}).strict().superRefine((value, context) => {
  const allowed = new Set(value.sourceIds);
  const cited = [
    ...value.regimeLines, ...value.topStories, ...value.scheduledEvents, ...value.marketContext,
    ...value.validationRules, ...value.afterOpenChanges, ...value.dataQuality,
    ...value.primaryBoard.flatMap((setup) => [
      { sourceIds: setup.sourceIds }, setup.trigger, setup.invalidation, setup.firstResistanceOrTarget,
      setup.rewardToRisk, setup.noChase, setup.indexOrSectorCondition, setup.eventRisk,
    ]),
    ...value.challengers.flatMap((setup) => [
      { sourceIds: setup.sourceIds }, setup.trigger, setup.invalidation, setup.firstResistanceOrTarget,
      setup.rewardToRisk, setup.noChase, setup.indexOrSectorCondition, setup.eventRisk,
    ]),
    ...value.tickerDossiers.flatMap((dossier) => [{ sourceIds: dossier.sourceIds }, dossier.summary]),
    ...value.requestedSourceStatus,
    ...value.sections,
    ...value.chartRequests.map((chart) => ({ sourceIds: chart.sourceEvidenceIds })),
  ];
  if (cited.some((claim) => claim.sourceIds.some((sourceId) => !allowed.has(sourceId)))) {
    context.addIssue({ code: "custom", message: "Edition cites an unknown source ID." });
  }
  const sectionOrder = sectionKindSchema.options;
  const ordered = [...value.sections].sort((left, right) => left.sequence - right.sequence);
  if (
    new Set(value.sections.map((section) => section.sectionId)).size !== value.sections.length
    || ordered.some((section, index) => section.sequence !== index)
    || ordered.some((section, index) => index > 0
      && sectionOrder.indexOf(section.kind) <= sectionOrder.indexOf(ordered[index - 1]?.kind ?? "how_to_read"))
    || !["primary_board", "data_quality", "sources"].every((kind) => value.sections.some((section) => section.kind === kind))
  ) context.addIssue({ code: "custom", path: ["sections"], message: "Edition sections are invalid." });
  const sectionIds = new Set(value.sections.map((section) => section.sectionId));
  if (
    new Set(value.primaryBoard.map((setup) => setup.symbol)).size !== value.primaryBoard.length
    || new Set(value.tickerDossiers.map((dossier) => dossier.symbol)).size !== value.tickerDossiers.length
    || new Set(value.chartRequests.map((chart) => chart.chartRequestId)).size !== value.chartRequests.length
    || value.chartRequests.some((chart) => chart.editionId !== value.editionId || !sectionIds.has(chart.sectionId))
  ) context.addIssue({ code: "custom", message: "Edition dossier or chart identity is invalid." });
  const positiveSetups = new Set(value.primaryBoard.filter((setup) =>
    (setup.label === "TOP WATCH" || setup.label === "WATCH")
    && setup.score >= 75
    && setup.thesisLabel !== "AT RISK"
    && setup.thesisLabel !== "INVALIDATED").map((setup) => setup.symbol));
  const primarySections = new Set(value.sections.filter((section) => section.kind === "primary_board")
    .map((section) => section.sectionId));
  if (value.chartRequests.some((chart) => !positiveSetups.has(chart.symbol) || !primarySections.has(chart.sectionId))) {
    context.addIssue({ code: "custom", path: ["chartRequests"], message: "Charts require a positive ranked setup in the primary board." });
  }
});

const deliveryRecordSchema = z.object({
  deliveryId: strictId,
  idempotencyKey: strictId,
  sequence: z.number().int().nonnegative().max(10_000),
  kind: z.enum(["starter", "reply"]),
  content: z.string().trim().min(1).max(2_000),
  contentHash: strictHash,
  sourceSectionIds: z.array(strictId).max(30).refine((values) => new Set(values).size === values.length),
  chartAttachmentIds: z.array(strictId).max(3).refine((values) => new Set(values).size === values.length),
  nonce: strictId,
}).strict();

const piResultRecordSchema = z.object({
  schemaVersion: z.literal(1),
  dispatchId: strictId,
  editionId: strictId,
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  claimToken: strictId,
  evidence: evidencePacketRecordSchema,
  edition: editionRecordSchema,
  deliveries: z.array(deliveryRecordSchema).min(1).max(500),
  exaRequestCount: z.number().int().nonnegative().max(100),
  exaCostUsd: z.number().finite().nonnegative().max(1_000),
  completedAt: strictIsoDateTime,
  thesisUpdates: thesisUpdatesSchema.optional(),
}).strict().superRefine((value, context) => {
  const operationalUnavailableEdition = value.edition.editionLabel === "Data unavailable"
    && value.evidence.evidence.some((item) =>
      item.evidenceId === "operational-market-data-unavailable"
      && item.kind === "source_status"
      && item.sourcePolicy === "unavailable"
      && item.contentStatus === "failed")
    && value.edition.primaryBoard.length === 0
    && value.edition.challengers.length === 0
    && value.edition.chartRequests.length === 0;
  if (
    value.editionId !== value.evidence.editionId
    || value.editionId !== value.edition.editionId
    || value.edition.editionDate !== value.evidence.session.editionDate
    || value.edition.timezone !== value.evidence.session.timezone
    || value.edition.sessionType !== value.evidence.session.sessionType
    || (value.edition.editionLabel !== value.evidence.session.editionLabel && !operationalUnavailableEdition)
    || value.edition.sourceIds.some((sourceId) => !value.evidence.allowedSourceIds.includes(sourceId))
  ) context.addIssue({ code: "custom", message: "Result edition and evidence do not match." });
  if (
    new Set(value.deliveries.map((delivery) => delivery.deliveryId)).size !== value.deliveries.length
    || new Set(value.deliveries.map((delivery) => delivery.idempotencyKey)).size !== value.deliveries.length
    || new Set(value.deliveries.map((delivery) => delivery.sequence)).size !== value.deliveries.length
    || value.deliveries.filter((delivery) => delivery.kind === "starter" && delivery.sequence === 0).length !== 1
  ) context.addIssue({ code: "custom", path: ["deliveries"], message: "Delivery identities are invalid." });
});

export const marketResearchEvidencePacketRecordSchema = evidencePacketRecordSchema;
export const marketResearchEditionRecordSchema = editionRecordSchema;
export const marketResearchPiResultRecordSchema = piResultRecordSchema;

function parseStoredChartRequests(value: string): PiChartRequest[] {
  try {
    const parsed = z.array(chartRequestRecordSchema).max(3).safeParse(JSON.parse(value) as unknown);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function validateResult(result: unknown): {
  dispatchId: string;
  editionId: string;
  generation: number;
  claimToken: string;
  evidence: z.infer<typeof evidencePacketRecordSchema>;
  edition: z.infer<typeof editionRecordSchema>;
  deliveries: z.infer<typeof deliveryRecordSchema>[];
  chartRequests: PiChartRequest[];
  exaRequestCount: number;
  exaCostUsd: number;
  thesisUpdates: z.infer<typeof thesisUpdatesSchema>;
} {
  if (serializedUtf8Bytes(result) > MARKET_RESEARCH_MAX_RESULT_BYTES) throw new Error("composition_schema_invalid");
  const parsed = piResultRecordSchema.safeParse(result);
  if (!parsed.success || serializedUtf8Bytes(parsed.data.evidence) > MARKET_RESEARCH_MAX_EVIDENCE_PACKET_BYTES) {
    throw new Error("composition_schema_invalid");
  }
  return {
    dispatchId: parsed.data.dispatchId,
    editionId: parsed.data.editionId,
    generation: parsed.data.generation,
    claimToken: parsed.data.claimToken,
    evidence: parsed.data.evidence,
    edition: parsed.data.edition,
    deliveries: parsed.data.deliveries,
    chartRequests: parsed.data.edition.chartRequests,
    exaRequestCount: parsed.data.exaRequestCount,
    exaCostUsd: parsed.data.exaCostUsd,
    thesisUpdates: parsed.data.thesisUpdates ?? [],
  };
}

function resultMatchesFrozenConfiguration(
  result: ReturnType<typeof validateResult>,
  configuration: Preferences,
  thesisMemory: ThesisSnapshot[] = [],
): boolean {
  if (
    result.evidence.sourcePolicyVersion !== configuration.sourcePolicyVersion
    || result.evidence.primarySymbols.join("\0") !== configuration.primarySymbols.join("\0")
    || result.evidence.sectorSymbols.join("\0") !== configuration.sectorSymbols.join("\0")
    || result.evidence.discoverySymbols.join("\0") !== configuration.discoverySymbols.join("\0")
    || result.edition.primaryBoard.length > configuration.maximumRankedSetups
    || result.edition.tickerDossiers.some((dossier) => ![
      ...configuration.primarySymbols,
      ...configuration.discoverySymbols,
    ].includes(dossier.symbol))
    || result.edition.primaryBoard.some((setup) => !configuration.primarySymbols.includes(setup.symbol))
    || result.edition.challengers.some((setup) => !configuration.discoverySymbols.includes(setup.symbol))
    || (!configuration.includeCharts && result.chartRequests.length > 0)
    || result.chartRequests.length > configuration.maximumCharts
  ) return false;
  const durableThesisSymbols = new Set(configuration.durableTheses
    .filter((thesis) => thesis.status !== "expired")
    .map((thesis) => thesis.symbol));
  for (const thesis of thesisMemory) durableThesisSymbols.add(thesis.symbol);
  if ([...result.edition.primaryBoard, ...result.edition.challengers, ...result.edition.tickerDossiers]
    .some((item) => !durableThesisSymbols.has(item.symbol) && item.thesisLabel !== "NO PRIOR THESIS")) {
    return false;
  }
  if (PROHIBITED_BROKERAGE_LANGUAGE.test(JSON.stringify(result.edition))) return false;
  const enabledSectionKinds: Readonly<Record<string, boolean>> = {
    how_to_read: true,
    overnight_macro: configuration.reportSections.overnightMacro,
    cross_asset: configuration.reportSections.crossAsset,
    index_sector: configuration.reportSections.indexSector,
    scheduled_events: configuration.reportSections.calendar,
    primary_board: true,
    challengers: configuration.reportSections.challengers,
    ticker_dossiers: configuration.reportSections.tickerDossiers,
    validation: configuration.reportSections.validation,
    after_open: configuration.reportSections.afterOpen,
    requested_sources: configuration.reportSections.requestedSources,
    data_quality: true,
    sources: true,
  };
  return !result.edition.sections.some((section) => enabledSectionKinds[section.kind] === false);
}

export const completeComposition = internalMutation({
  args: { result: v.any() },
  handler: async (ctx, args) => {
    let result: ReturnType<typeof validateResult>;
    try { result = validateResult(args.result); }
    catch { return { accepted: false as const }; }
    const now = Date.now();
    if (result.editionId.startsWith("MRP-")) {
      const preview = await previewByStableId(ctx, result.editionId);
      if (
        !preview || !activePreviewLease(preview, result.generation, result.claimToken, now)
        || result.dispatchId !== researchDispatchId(preview.previewId, preview.generation)
        || result.evidence.session.sessionType !== preview.sessionType
        || result.evidence.session.editionLabel !== preview.editionLabel
        || result.evidence.session.editionDate !== preview.editionDate
        || result.evidence.session.timezone !== preview.timezone
        || result.evidence.session.calendarVersion !== preview.calendarVersion
        || result.evidence.session.sourceIds.join("\0") !== preview.sessionSourceIds.join("\0")
        || result.evidence.session.previousSessionDate !== preview.previousSessionDate
        || result.evidence.session.previousSessionClose !== preview.previousSessionClose
        || result.evidence.session.nextSessionDate !== preview.nextSessionDate
        || !resultMatchesFrozenConfiguration(result, preview.configurationSnapshot, preview.thesisMemory)
      ) return { accepted: false as const };
      let storedEvidence: z.infer<typeof evidenceRecordSchema>[];
      try {
        storedEvidence = z.array(evidenceRecordSchema).max(500).parse(JSON.parse(preview.evidenceJson) as unknown);
      } catch {
        return { accepted: false as const };
      }
      const storedById = new Map(storedEvidence.map((item) => [item.evidenceId, item]));
      const resultEvidenceIds = new Set(result.evidence.evidence.map((item) => item.evidenceId));
      const expectedExaRequestCount = result.evidence.evidence
        .filter((item) => item.evidenceId.startsWith("exa-search-slot-"))
        .length;
      const expectedCost = result.evidence.evidence.reduce((sum, item) => sum + (item.costUsd ?? 0), 0);
      if (
        result.evidence.evidence.some((item) => storedById.get(item.evidenceId)?.contentHash !== item.contentHash)
        || result.evidence.allowedSourceIds.some((sourceId) => !storedById.has(sourceId))
        || result.edition.sourceIds.some((sourceId) => !resultEvidenceIds.has(sourceId))
        || result.chartRequests.some((chart) => chart.sourceEvidenceIds.some((sourceId) => !storedById.has(sourceId)))
        || expectedExaRequestCount !== result.exaRequestCount
        || Math.abs(expectedCost - result.exaCostUsd) > 0.000_001
        || !resultEvidenceIds.has("exa-collection-complete")
      ) {
        return { accepted: false as const };
      }
      for (const delivery of result.deliveries) {
        if (await sha256Hex(delivery.content) !== delivery.contentHash) return { accepted: false as const };
      }
      const resultFingerprint = await sha256Hex(canonicalJson(args.result));
      if (preview.resultFingerprint !== undefined) {
        return preview.resultFingerprint === resultFingerprint
          ? { accepted: true as const, duplicate: true as const }
          : { accepted: false as const };
      }
      await ctx.db.patch(preview._id, {
        status: "completed",
        stage: "ready_to_publish",
        workerId: undefined,
        claimId: undefined,
        leaseExpiresAt: undefined,
        resultFingerprint,
        safeFailure: undefined,
        qualitySummary: [
          `${result.edition.editionLabel} composed without Discord delivery.`,
          `Regime: ${result.edition.regime}.`,
          `Evidence: ${result.evidence.evidence.length} retained records across ${result.exaRequestCount} Search slots.`,
          `Primary coverage: ${result.edition.tickerDossiers.filter((dossier) => preview.configurationSnapshot.primarySymbols.includes(dossier.symbol)).length}/${preview.configurationSnapshot.primarySymbols.length}.`,
          `Ranked setups: ${result.edition.primaryBoard.length}; delivery parts were validated and discarded for preview isolation.`,
          ...result.edition.topStories.slice(0, 5).map((story) => story.text.slice(0, 300)),
        ].slice(0, 30),
        updatedAt: now,
      });
      return { accepted: true as const };
    }
    const edition = await editionByStableId(ctx, result.editionId);
    if (
      !edition || !activeResearchLease(edition, result.generation, result.claimToken, now)
      || result.dispatchId !== researchDispatchId(edition.editionId, edition.generation)
      || result.editionId !== edition.editionId
      || result.evidence.session.sessionType !== edition.sessionType
      || result.evidence.session.editionLabel !== edition.editionLabel
      || result.evidence.session.editionDate !== edition.editionDate
      || result.evidence.session.timezone !== edition.timezone
      || result.evidence.session.calendarVersion !== edition.calendarVersion
      || result.evidence.session.sourceIds.join("\0") !== edition.sessionSourceIds.join("\0")
      || result.evidence.session.previousSessionDate !== edition.previousSessionDate
      || result.evidence.session.previousSessionClose !== edition.previousSessionClose
      || result.evidence.session.nextSessionDate !== edition.nextSessionDate
      || !resultMatchesFrozenConfiguration(result, edition.configurationSnapshot, edition.thesisMemory)
    ) return { accepted: false as const };
    const resultFingerprint = await sha256Hex(canonicalJson(args.result));
    const existingDeliveries = await ctx.db
      .query("marketResearchDeliveries")
      .withIndex("by_edition_sequence", (index) => index.eq("editionId", edition.editionId))
      .collect();
    if (existingDeliveries.length > 0) {
      return edition.resultFingerprint === resultFingerprint
        ? { accepted: true as const, duplicate: true as const }
        : { accepted: false as const };
    }
    const orderedDeliveries = [...result.deliveries].sort((left, right) => left.sequence - right.sequence);
    if (orderedDeliveries.some((delivery, index) => {
      const expectedId = index === 0
        ? `${edition.editionId}:starter`
        : `${edition.editionId}:reply:${String(index).padStart(4, "0")}`;
      return delivery.sequence !== index
        || (index === 0 ? delivery.kind !== "starter" : delivery.kind !== "reply")
        || delivery.deliveryId !== expectedId
        || delivery.idempotencyKey !== expectedId;
    }) || !orderedDeliveries[0]?.content.includes(`Edition ID: MR-${edition.editionId}`)) {
      return { accepted: false as const };
    }
    const sectionIds = new Set<string>();
    const chartsBySection = new Map<string, PiChartRequest[]>();
    const chartRequestIds = new Set<string>();
    for (const chart of result.chartRequests) {
      if (
        chart.editionId !== edition.editionId
        || chartRequestIds.has(chart.chartRequestId)
      ) return { accepted: false as const };
      chartRequestIds.add(chart.chartRequestId);
      const requests = chartsBySection.get(chart.sectionId) ?? [];
      requests.push(chart);
      chartsBySection.set(chart.sectionId, requests);
    }
    if (
      (!edition.configurationSnapshot.includeCharts && result.chartRequests.length > 0)
      || result.chartRequests.length > edition.configurationSnapshot.maximumCharts
    ) return { accepted: false as const };
    const normalizedSections: Array<{
      sectionId: string;
      sequence: number;
      kind: string;
      heading: string;
      markdown: string;
      sourceIds: string[];
      chartRequests: PiChartRequest[];
    }> = [];
    for (const [index, raw] of result.edition.sections.entries()) {
      const sectionId = String(raw.sectionId ?? "");
      const heading = String(raw.heading ?? "");
      const markdown = String(raw.markdown ?? "");
      const kind = String(raw.kind ?? "");
      const sequence = Number(raw.sequence ?? index);
      const sourceIds = Array.isArray(raw.sourceIds) ? raw.sourceIds.map(String) : [];
      if (
        !idPattern.test(sectionId) || sectionIds.has(sectionId)
        || !Number.isSafeInteger(sequence) || sequence < 0 || sequence > 100
        || heading.length < 1 || heading.length > 100
        || markdown.length < 1 || markdown.length > 24_000
        || kind.length < 1 || kind.length > 100
        || sourceIds.length > 100 || sourceIds.some((sourceId) => !idPattern.test(sourceId))
      ) {
        return { accepted: false as const };
      }
      sectionIds.add(sectionId);
      normalizedSections.push({
        sectionId,
        sequence,
        kind,
        heading,
        markdown,
        sourceIds,
        chartRequests: chartsBySection.get(sectionId) ?? [],
      });
    }
    if (
      new Set(normalizedSections.map((section) => section.sequence)).size !== normalizedSections.length
      || result.chartRequests.some((chart) => !sectionIds.has(chart.sectionId))
      || orderedDeliveries.some((delivery) => delivery.sourceSectionIds.some((sectionId) => !sectionIds.has(sectionId)))
    ) return { accepted: false as const };
    const storedEvidence = await ctx.db
      .query("marketResearchEvidence")
      .withIndex("by_edition_checkpointSequence", (index) => index.eq("editionId", edition.editionId))
      .take(500);
    const evidenceIds = new Set(storedEvidence.map((item) => item.evidenceId));
    const storedEvidenceById = new Map(storedEvidence.map((item) => [item.evidenceId, item]));
    const resultEvidenceIds = new Set(result.evidence.evidence.map((item) => item.evidenceId));
    const expectedExaRequestCount = result.evidence.evidence
      .filter((item) => item.evidenceId.startsWith("exa-search-slot-"))
      .length;
    const expectedCost = result.evidence.evidence.reduce((sum, item) => sum + (item.costUsd ?? 0), 0);
    if (
      result.evidence.evidence.some((item) => storedEvidenceById.get(item.evidenceId)?.contentHash !== item.contentHash)
      || result.evidence.allowedSourceIds.some((sourceId) => !evidenceIds.has(sourceId))
      || result.edition.sourceIds.some((sourceId) => !resultEvidenceIds.has(sourceId))
      || result.chartRequests.some((chart) => chart.sourceEvidenceIds.some((sourceId) => !evidenceIds.has(sourceId)))
      || expectedExaRequestCount !== result.exaRequestCount
      || Math.abs(expectedCost - result.exaCostUsd) > 0.000_001
      || !resultEvidenceIds.has("exa-collection-complete")
    ) {
      return { accepted: false as const };
    }
    const attachedChartIds = orderedDeliveries.flatMap((delivery) => delivery.chartAttachmentIds);
    if (
      new Set(attachedChartIds).size !== attachedChartIds.length
      || attachedChartIds.length !== result.chartRequests.length
      || attachedChartIds.some((chartId) => !chartRequestIds.has(chartId))
      || orderedDeliveries.some((delivery) => delivery.chartAttachmentIds.some((chartId) => {
        const chart = result.chartRequests.find((candidate) => candidate.chartRequestId === chartId);
        return chart === undefined || !delivery.sourceSectionIds.includes(chart.sectionId);
      }))
    ) return { accepted: false as const };
    for (const delivery of orderedDeliveries) {
      if (await sha256Hex(delivery.content) !== delivery.contentHash) return { accepted: false as const };
    }
    const validThesisUpdates = result.thesisUpdates.filter((update) => thesisUpdatesMatchContext(
      [update], edition, result.evidence.evidence, result.evidence.allowedSourceIds,
    ));
    const thesisCommit = await commitThesisUpdates(ctx, edition, validThesisUpdates, result.evidence.evidence, now);
    thesisCommit.skipped += result.thesisUpdates.length - validThesisUpdates.length;
    for (const section of normalizedSections) {
      const { chartRequests, ...storedSection } = section;
      await ctx.db.insert("marketResearchSections", {
        editionId: edition.editionId,
        ...storedSection,
        chartRequestsJson: JSON.stringify(chartRequests),
        createdAt: now,
      });
    }
    for (const delivery of orderedDeliveries) {
      await ctx.db.insert("marketResearchDeliveries", {
        editionId: edition.editionId,
        ownerId: edition.ownerId,
        ...delivery,
        status: "pending",
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    const displayLabel = result.edition.editionLabel === "Data unavailable" ? "Market Research" : result.edition.editionLabel;
    const forumTitle = `${displayLabel.slice(0, 48)} - ${result.edition.editionDate} - ${result.edition.regime}`.slice(0, 100);
    await ctx.db.patch(edition._id, {
      status: "ready_to_publish",
      stage: "ready_to_publish",
      workerId: undefined,
      claimId: undefined,
      leaseExpiresAt: undefined,
      resumeFrom: "ready_to_publish",
      composedAt: now,
      exaRequestCount: Math.max(0, Math.min(100, Math.trunc(result.exaRequestCount))),
      exaCostUsd: Math.max(0, Math.min(1_000, result.exaCostUsd)),
      expectedPartCount: result.deliveries.length,
      sentPartCount: 0,
      forumTitle,
      resultFingerprint,
      updatedAt: now,
    });
    await recordEvent(ctx, edition, "composition_accepted", now, {
      stage: "ready_to_publish",
      details: [
        { key: "durationMs", value: String(Math.max(0, now - edition.createdAt)) },
        { key: "retainedSourceCount", value: String(result.evidence.evidence.length) },
        { key: "acceptedSourceCount", value: String(acceptedResearchEvidenceCount(result.evidence.evidence)) },
        { key: "freshSourceCount", value: String(result.evidence.evidence.filter((item) => item.freshness === "fresh").length) },
        { key: "staleSourceCount", value: String(result.evidence.evidence.filter((item) => item.freshness === "stale").length) },
        { key: "blockedSourceCount", value: String(result.evidence.evidence.filter((item) => item.contentStatus === "blocked").length) },
        { key: "unavailableSourceCount", value: String(result.evidence.evidence.filter((item) => item.contentStatus === "failed").length) },
        {
          key: "primaryCoverage",
          value: `${result.edition.tickerDossiers.filter((dossier) => edition.configurationSnapshot.primarySymbols.includes(dossier.symbol)).length}/${edition.configurationSnapshot.primarySymbols.length}`,
        },
        { key: "exaCostUsd", value: result.exaCostUsd.toFixed(6) },
        { key: "thesesUpdated", value: String(thesisCommit.applied) },
        { key: "thesesSkipped", value: String(thesisCommit.skipped) },
      ],
    });
    return { accepted: true as const };
  },
});

export const failRun = internalMutation({
  args: {
    editionId: v.string(),
    generation: v.number(),
    claimToken: v.string(),
    code: marketResearchSafeErrorValidator,
    retryable: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (args.editionId.startsWith("MRP-")) {
      const preview = await previewByStableId(ctx, args.editionId);
      if (!preview || !activePreviewLease(preview, args.generation, args.claimToken, now)) {
        return { accepted: false as const };
      }
      await ctx.db.patch(preview._id, {
        status: "failed",
        workerId: undefined,
        claimId: undefined,
        leaseExpiresAt: undefined,
        safeFailure: args.code,
        qualitySummary: [
          `Preview stopped with safe failure ${args.code}.`,
          "No Discord thread, delivery row, edition row, or scheduled key was created.",
        ],
        updatedAt: now,
      });
      return { accepted: true as const, status: "failed" as const };
    }
    const edition = await editionByStableId(ctx, args.editionId);
    if (!edition || !activeResearchLease(edition, args.generation, args.claimToken, now)) return { accepted: false as const };
    const nextAttempt = args.retryable && !TERMINAL_RESEARCH_ERRORS.has(args.code)
      ? nextRetryAt(edition.attempts, now, edition.editionId)
      : undefined;
    const retry = nextAttempt !== undefined;
    await ctx.db.patch(edition._id, {
      status: retry ? "retry_wait" : "failed",
      workerId: undefined,
      claimId: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: nextAttempt,
      lastErrorCode: args.code,
      lastErrorMessage: args.code,
      completedAt: retry ? undefined : now,
      updatedAt: now,
    });
    await recordEvent(ctx, edition, retry ? "research_retry_wait" : "research_failed", now, {
      stage: edition.stage,
      safeCode: args.code,
    });
    return { accepted: true as const, status: retry ? "retry_wait" as const : "failed" as const };
  },
});

export const claimPublication = internalMutation({
  args: { ownerId: v.string(), workerId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = requireId(args.ownerId, "ownerId");
    if (!isConfiguredMarketResearchOwner(ownerId)) return { claimed: false as const };
    const workerId = requireId(args.workerId, "workerId");
    const now = Date.now();
    const candidates = await ctx.db
      .query("marketResearchDeliveries")
      .withIndex("by_owner_status_nextAttemptAt", (index) => index
        .eq("ownerId", ownerId)
        .eq("status", "pending")
        .lte("nextAttemptAt", now))
      .take(50);
    for (const delivery of candidates) {
      const edition = await editionByStableId(ctx, delivery.editionId);
      if (!edition) {
        await terminalizeUnsentDeliveries(
          ctx,
          delivery.editionId,
          "market_research_disabled",
          now,
        );
        continue;
      }
      if (
        edition.ownerId !== ownerId
        || !["ready_to_publish", "publishing_replies", "retry_wait", "creating_thread"].includes(edition.status)
        || edition.lastErrorCode === "discord_thread_reconcile_ambiguous"
      ) {
        await terminalizeUnsentDeliveries(
          ctx,
          edition.editionId,
          edition.lastErrorCode ?? "discord_reply_failed",
          now,
        );
        continue;
      }
      const ordered = await boundedEditionDeliveries(ctx, edition.editionId);
      const disposition = publicationCandidateDisposition({
        deliverySequence: delivery.sequence,
        deliveryKind: delivery.kind,
        firstMissingSequence: firstMissingDeliverySequence(ordered),
        threadId: edition.threadId,
        starterMessageId: edition.starterMessageId,
      });
      if (disposition === "defer_until_prior_delivery") {
        await ctx.db.patch(delivery._id, {
          nextAttemptAt: now + MARKET_RESEARCH_PUBLICATION_QUEUE_DEFER_MS,
          updatedAt: now,
        });
        continue;
      }
      if (disposition === "terminal_invalid_state") {
        const code = "discord_thread_reconcile_failed" as const;
        await terminalizeUnsentDeliveries(ctx, edition.editionId, code, now);
        await ctx.db.patch(edition._id, {
          status: "failed",
          publicationWorkerId: undefined,
          publicationToken: undefined,
          publicationLeaseExpiresAt: undefined,
          nextAttemptAt: undefined,
          lastErrorCode: code,
          lastErrorMessage: code,
          completedAt: now,
          updatedAt: now,
        });
        await recordEvent(ctx, edition, "publication_failed", now, {
          safeCode: code,
        });
        continue;
      }
      const active = edition.publicationLeaseExpiresAt !== undefined && edition.publicationLeaseExpiresAt > now;
      if (active && edition.publicationWorkerId !== workerId) {
        await ctx.db.patch(delivery._id, {
          nextAttemptAt: Math.max(
            now + MARKET_RESEARCH_PUBLICATION_QUEUE_DEFER_MS,
            edition.publicationLeaseExpiresAt ?? now,
          ),
          updatedAt: now,
        });
        continue;
      }
      const generation = active ? edition.publicationGeneration : edition.publicationGeneration + 1;
      const token = active && edition.publicationToken
        ? edition.publicationToken
        : stableMarketResearchToken([edition.editionId, workerId, generation, now]);
      await ctx.db.patch(edition._id, {
        status: delivery.sequence === 0 ? "creating_thread" : "publishing_replies",
        stage: delivery.sequence === 0 ? "creating_thread" : "publishing_replies",
        publicationGeneration: generation,
        publicationWorkerId: workerId,
        publicationToken: token,
        publicationLeaseExpiresAt: now + MARKET_RESEARCH_DELIVERY_LEASE_MS,
        updatedAt: now,
      });
      const deliveryToken = stableMarketResearchToken([delivery.deliveryId, workerId, generation, delivery.attempts + 1, now]);
      await ctx.db.patch(delivery._id, {
        status: "sending",
        attempts: delivery.attempts + 1,
        deliveryWorkerId: workerId,
        deliveryToken,
        deliveryLeaseExpiresAt: now + MARKET_RESEARCH_DELIVERY_LEASE_MS,
        updatedAt: now,
      });
      const sectionRecords = delivery.chartAttachmentIds.length === 0
        ? []
        : await ctx.db
          .query("marketResearchSections")
          .withIndex("by_edition_sequence", (index) => index.eq("editionId", edition.editionId))
          .take(30);
      const chartRequests = sectionRecords
        .flatMap((section) => parseStoredChartRequests(section.chartRequestsJson))
        .filter((chart) => delivery.chartAttachmentIds.includes(chart.chartRequestId));
      return {
        claimed: true as const,
        editionId: edition.editionId,
        guildId: edition.guildId,
        forumChannelId: edition.forumChannelId,
        forumTagIds: edition.configurationSnapshot.forumTagIds,
        forumTitle: edition.forumTitle ?? `Morning Market Newspaper - ${edition.editionDate}`,
        publicationGeneration: generation,
        publicationToken: token,
        threadId: edition.threadId,
        starterMessageId: edition.starterMessageId,
        lastErrorCode: delivery.lastErrorCode ?? edition.lastErrorCode,
        delivery: {
          deliveryId: delivery.deliveryId,
          sequence: delivery.sequence,
          kind: delivery.kind,
          content: delivery.content,
          contentHash: delivery.contentHash,
          nonce: delivery.nonce,
          chartAttachmentIds: delivery.chartAttachmentIds,
          chartRequests,
          deliveryToken,
          attempts: delivery.attempts + 1,
        },
      };
    }
    return { claimed: false as const };
  },
});

export const heartbeatPublication = internalMutation({
  args: { editionId: v.string(), publicationGeneration: v.number(), publicationToken: v.string() },
  handler: async (ctx, args) => {
    const edition = await editionByStableId(ctx, args.editionId);
    const now = Date.now();
    if (
      !edition || !isConfiguredMarketResearchOwner(edition.ownerId)
      || edition.publicationGeneration !== args.publicationGeneration
      || edition.publicationToken !== args.publicationToken
      || (edition.publicationLeaseExpiresAt ?? 0) <= now
    ) return { accepted: false as const };
    await ctx.db.patch(edition._id, { publicationLeaseExpiresAt: now + MARKET_RESEARCH_DELIVERY_LEASE_MS, updatedAt: now });
    return { accepted: true as const, leaseExpiresAt: now + MARKET_RESEARCH_DELIVERY_LEASE_MS };
  },
});

export const acknowledgePublication = internalMutation({
  args: {
    editionId: v.string(),
    publicationGeneration: v.number(),
    publicationToken: v.string(),
    deliveryId: v.string(),
    deliveryToken: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    discordThreadId: v.optional(v.string()),
    discordMessageId: v.optional(v.string()),
    code: v.optional(marketResearchSafeErrorValidator),
    retryable: v.optional(v.boolean()),
    retryAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const edition = await editionByStableId(ctx, args.editionId);
    const delivery = await ctx.db
      .query("marketResearchDeliveries")
      .withIndex("by_deliveryId", (index) => index.eq("deliveryId", args.deliveryId))
      .unique();
    const now = Date.now();
    if (
      !edition || !isConfiguredMarketResearchOwner(edition.ownerId)
      || !delivery || delivery.editionId !== edition.editionId
      || edition.publicationGeneration !== args.publicationGeneration
      || edition.publicationToken !== args.publicationToken
      || (edition.publicationLeaseExpiresAt ?? 0) <= now
      || delivery.deliveryToken !== args.deliveryToken
      || (delivery.deliveryLeaseExpiresAt ?? 0) <= now
    ) return { accepted: false as const };
    if (delivery.status === "sent") return { accepted: true as const, duplicate: true, status: edition.status };
    if (args.status === "failed") {
      const code = args.code ?? "discord_reply_failed";
      const policyRetryAt = args.retryable && delivery.attempts < 4
        ? nextRetryAt(delivery.attempts, now, delivery.deliveryId)
        : undefined;
      const retryAfterAt = args.retryAfterMs !== undefined
        && Number.isSafeInteger(args.retryAfterMs)
        && args.retryAfterMs >= 1_000
        && args.retryAfterMs <= 15 * 60 * 1_000
        ? now + args.retryAfterMs
        : undefined;
      const retryAt = policyRetryAt === undefined
        ? undefined
        : Math.max(policyRetryAt, retryAfterAt ?? 0);
      const partial = delivery.sequence > 0 && edition.threadId !== undefined && retryAt === undefined;
      await ctx.db.patch(delivery._id, {
        status: retryAt ? "pending" : "failed",
        ...(code === "discord_thread_reconcile_ambiguous" && args.discordMessageId !== undefined
          ? {
              discordThreadId: args.discordThreadId ?? edition.threadId,
              discordMessageId: args.discordMessageId,
            }
          : {}),
        deliveryWorkerId: undefined,
        deliveryToken: undefined,
        deliveryLeaseExpiresAt: undefined,
        nextAttemptAt: retryAt,
        lastErrorCode: code,
        lastErrorMessage: code,
        updatedAt: now,
      });
      await ctx.db.patch(edition._id, {
        status: code === "discord_thread_reconcile_ambiguous" ? "failed" : partial ? "partial" : retryAt ? "retry_wait" : "failed",
        publicationWorkerId: undefined,
        publicationToken: undefined,
        publicationLeaseExpiresAt: undefined,
        nextAttemptAt: retryAt,
        lastErrorCode: code,
        lastErrorMessage: code,
        completedAt: retryAt || partial ? undefined : now,
        updatedAt: now,
      });
      if (retryAt === undefined) {
        await terminalizeUnsentDeliveries(ctx, edition.editionId, code, now);
      }
      await recordEvent(
        ctx,
        edition,
        code === "discord_thread_reconcile_ambiguous"
          ? "duplicate_publication_incident"
          : partial
            ? "publication_partial"
            : "publication_failed",
        now,
        {
          safeCode: code,
          ...(args.discordMessageId === undefined
            ? {}
            : { details: [{ key: "earliestMessageId", value: args.discordMessageId }] }),
        },
      );
      return { accepted: true as const, duplicate: false, status: partial ? "partial" as const : retryAt ? "retry_wait" as const : "failed" as const };
    }
    if (!args.discordMessageId) return { accepted: false as const };
    if (delivery.kind === "starter" && !args.discordThreadId) return { accepted: false as const };
    if (delivery.kind === "reply" && args.discordThreadId !== undefined && args.discordThreadId !== edition.threadId) return { accepted: false as const };
    await ctx.db.patch(delivery._id, {
      status: "sent",
      discordThreadId: args.discordThreadId ?? edition.threadId,
      discordMessageId: args.discordMessageId,
      deliveryWorkerId: undefined,
      deliveryToken: undefined,
      deliveryLeaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      sentAt: now,
      updatedAt: now,
    });
    const sentPartCount = (edition.sentPartCount ?? 0) + 1;
    const complete = sentPartCount >= (edition.expectedPartCount ?? Number.MAX_SAFE_INTEGER);
    await ctx.db.patch(edition._id, {
      ...(delivery.kind === "starter" ? { threadId: args.discordThreadId, starterMessageId: args.discordMessageId } : {}),
      status: complete ? "published" : "publishing_replies",
      stage: complete ? "published" : "publishing_replies",
      sentPartCount,
      publicationWorkerId: undefined,
      publicationToken: undefined,
      publicationLeaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      ...(complete ? { publishedAt: now, completedAt: now } : {}),
      updatedAt: now,
    });
    const publicationDetails = [{ key: "sequence", value: String(delivery.sequence) }];
    if (complete) {
      publicationDetails.push(
        { key: "durationMs", value: String(Math.max(0, now - edition.createdAt)) },
        { key: "partCount", value: String(sentPartCount) },
      );
    }
    await recordEvent(ctx, edition, complete ? "edition_published" : "delivery_acknowledged", now, {
      stage: complete ? "published" : "publishing_replies",
      details: publicationDetails,
    });
    return { accepted: true as const, duplicate: false, status: complete ? "published" as const : "publishing_replies" as const };
  },
});

export const adoptReconciledStarter = internalMutation({
  args: {
    editionId: v.string(),
    publicationGeneration: v.number(),
    publicationToken: v.string(),
    discordThreadId: v.string(),
    starterMessageId: v.string(),
    contentHash: v.string(),
    duplicateIncident: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const edition = await editionByStableId(ctx, args.editionId);
    const starter = await ctx.db
      .query("marketResearchDeliveries")
      .withIndex("by_edition_sequence", (index) => index.eq("editionId", args.editionId).eq("sequence", 0))
      .unique();
    const now = Date.now();
    if (
      !edition || !isConfiguredMarketResearchOwner(edition.ownerId)
      || !starter || starter.contentHash !== args.contentHash
      || edition.publicationGeneration !== args.publicationGeneration
      || edition.publicationToken !== args.publicationToken
      || (edition.publicationLeaseExpiresAt ?? 0) <= now
    ) return { accepted: false as const };
    if (edition.threadId && edition.threadId !== args.discordThreadId) return { accepted: false as const, duplicateIncident: true };
    await ctx.db.patch(starter._id, {
      status: args.duplicateIncident ? "failed" : "sent",
      discordThreadId: args.discordThreadId,
      discordMessageId: args.starterMessageId,
      deliveryWorkerId: undefined,
      deliveryToken: undefined,
      deliveryLeaseExpiresAt: undefined,
      ...(args.duplicateIncident
        ? {
            lastErrorCode: "discord_thread_reconcile_ambiguous" as const,
            lastErrorMessage: "discord_thread_reconcile_ambiguous",
          }
        : {}),
      sentAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(edition._id, {
      threadId: args.discordThreadId,
      starterMessageId: args.starterMessageId,
      status: args.duplicateIncident ? "failed" : "publishing_replies",
      stage: args.duplicateIncident ? "creating_thread" : "publishing_replies",
      sentPartCount: Math.max(edition.sentPartCount ?? 0, 1),
      publicationWorkerId: undefined,
      publicationToken: undefined,
      publicationLeaseExpiresAt: undefined,
      ...(args.duplicateIncident
        ? {
            lastErrorCode: "discord_thread_reconcile_ambiguous" as const,
            lastErrorMessage: "discord_thread_reconcile_ambiguous",
            completedAt: now,
          }
        : {}),
      updatedAt: now,
    });
    if (args.duplicateIncident) {
      await terminalizeUnsentDeliveries(
        ctx,
        edition.editionId,
        "discord_thread_reconcile_ambiguous",
        now,
      );
    }
    await recordEvent(
      ctx,
      edition,
      args.duplicateIncident ? "duplicate_publication_incident" : "starter_reconciled",
      now,
      {
        stage: args.duplicateIncident ? "creating_thread" : "publishing_replies",
        ...(args.duplicateIncident
          ? {
              safeCode: "discord_thread_reconcile_ambiguous" as const,
              details: [{ key: "earliestThreadId", value: args.discordThreadId }],
            }
          : {}),
      },
    );
    return { accepted: true as const, duplicateIncident: args.duplicateIncident ?? false };
  },
});

export const recoverBatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const recoveredRequests: ReturnType<typeof jobRequest>[] = [];
    let scanned = 0;
    let deferred = 0;
    let rejected = 0;
    const statuses = ["collecting", "researching", "calculating", "composing"] as const;
    for (const status of statuses) {
      if (scanned >= MARKET_RESEARCH_RECOVERY_BATCH_SIZE) break;
      const expired = await ctx.db
        .query("marketResearchEditions")
        .withIndex("by_status_leaseExpiresAt", (index) => index
          .eq("status", status)
          .lte("leaseExpiresAt", now))
        .take(MARKET_RESEARCH_RECOVERY_BATCH_SIZE - scanned);
      for (const edition of expired) {
        scanned += 1;
        if (!isConfiguredMarketResearchOwner(edition.ownerId)) {
          await ctx.db.patch(edition._id, {
            status: "failed",
            workerId: undefined,
            claimId: undefined,
            leaseExpiresAt: undefined,
            lastErrorCode: "market_research_disabled",
            lastErrorMessage: "market_research_disabled",
            completedAt: now,
            updatedAt: now,
          });
          rejected += 1;
          continue;
        }
        if (!canRecoverResearch(edition, now)) { rejected += 1; continue; }
        const generation = edition.generation + 1;
        const claimId = stableMarketResearchToken([edition.editionId, "recovery", generation, now]);
        await registerExaCostBinding(ctx, {
          ownerId: edition.ownerId, targetId: edition.editionId, targetKind: "edition", generation, claimToken: claimId,
        }, now);
        await ctx.db.patch(edition._id, {
          status: edition.stage === "queued" ? "collecting" : edition.stage,
          workerId: "convex-recovery",
          claimId,
          generation,
          leaseExpiresAt: now + MARKET_RESEARCH_LEASE_MS,
          attempts: edition.attempts + 1,
          resumeFrom: edition.stage,
          updatedAt: now,
        });
        const recovered = await ctx.db.get(edition._id);
        if (recovered) {
          const evidence = await ctx.db
            .query("marketResearchEvidence")
            .withIndex("by_edition_checkpointSequence", (index) => index.eq("editionId", recovered.editionId))
            .take(500);
          recoveredRequests.push(jobRequest(recovered, await durableExaUsage(ctx, recovered.ownerId, recovered.editionId), evidence.map((item) => item.evidenceId)));
        }
      }
    }
    if (scanned < MARKET_RESEARCH_RECOVERY_BATCH_SIZE) {
      const retries = await ctx.db
        .query("marketResearchEditions")
        .withIndex("by_status_nextAttemptAt", (index) => index
          .eq("status", "retry_wait")
          .lte("nextAttemptAt", now))
        .take(MARKET_RESEARCH_RECOVERY_BATCH_SIZE - scanned);
      for (const edition of retries) {
        scanned += 1;
        if (!isConfiguredMarketResearchOwner(edition.ownerId)) {
          await ctx.db.patch(edition._id, {
            status: "failed",
            nextAttemptAt: undefined,
            lastErrorCode: "market_research_disabled",
            lastErrorMessage: "market_research_disabled",
            completedAt: now,
            updatedAt: now,
          });
          rejected += 1;
          continue;
        }
        if (edition.composedAt) { deferred += 1; continue; }
        if (!canRecoverResearch(edition, now)) { rejected += 1; continue; }
        const generation = edition.generation + 1;
        const claimId = stableMarketResearchToken([edition.editionId, "recovery", generation, now]);
        await registerExaCostBinding(ctx, {
          ownerId: edition.ownerId, targetId: edition.editionId, targetKind: "edition", generation, claimToken: claimId,
        }, now);
        await ctx.db.patch(edition._id, {
          status: edition.resumeFrom === "researching" || edition.resumeFrom === "calculating" || edition.resumeFrom === "composing" ? edition.resumeFrom : "collecting",
          stage: edition.resumeFrom ?? "collecting",
          workerId: "convex-recovery",
          claimId,
          generation,
          leaseExpiresAt: now + MARKET_RESEARCH_LEASE_MS,
          attempts: edition.attempts + 1,
          nextAttemptAt: undefined,
          updatedAt: now,
        });
        const recovered = await ctx.db.get(edition._id);
        if (recovered) {
          const evidence = await ctx.db
            .query("marketResearchEvidence")
            .withIndex("by_edition_checkpointSequence", (index) => index.eq("editionId", recovered.editionId))
            .take(500);
          recoveredRequests.push(jobRequest(recovered, await durableExaUsage(ctx, recovered.ownerId, recovered.editionId), evidence.map((item) => item.evidenceId)));
        }
      }
    }
    let previewRecovered = 0;
    if (scanned < MARKET_RESEARCH_RECOVERY_BATCH_SIZE) {
      const expiredPreviews = await ctx.db
        .query("marketResearchPreviews")
        .withIndex("by_status_leaseExpiresAt", (index) => index
          .eq("status", "running")
          .lte("leaseExpiresAt", now))
        .take(MARKET_RESEARCH_RECOVERY_BATCH_SIZE - scanned);
      for (const preview of expiredPreviews) {
        scanned += 1;
        if (!isConfiguredMarketResearchOwner(preview.ownerId)) {
          await ctx.db.patch(preview._id, {
            status: "failed",
            workerId: undefined,
            claimId: undefined,
            leaseExpiresAt: undefined,
            safeFailure: "market_research_disabled",
            updatedAt: now,
          });
          rejected += 1;
          continue;
        }
        await ctx.db.patch(preview._id, {
          status: "queued",
          stage: "queued",
          workerId: undefined,
          claimId: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
        });
        await ctx.scheduler.runAfter(0, internal.market_research_dispatch.dispatchPreview, {
          previewId: preview.previewId,
        });
        previewRecovered += 1;
      }
    }
    const expiredDeliveries = scanned >= MARKET_RESEARCH_RECOVERY_BATCH_SIZE
      ? []
      : await ctx.db
        .query("marketResearchDeliveries")
        .withIndex("by_status_deliveryLeaseExpiresAt", (index) => index
          .eq("status", "sending")
          .lte("deliveryLeaseExpiresAt", now))
        .take(MARKET_RESEARCH_RECOVERY_BATCH_SIZE - scanned);
    let publicationRecovered = 0;
    for (const delivery of expiredDeliveries) {
      const edition = await editionByStableId(ctx, delivery.editionId);
      if (
        !edition
        || !isConfiguredMarketResearchOwner(edition.ownerId)
        || edition.lastErrorCode === "discord_thread_reconcile_ambiguous"
      ) {
        const code = edition?.lastErrorCode === "discord_thread_reconcile_ambiguous"
          ? "discord_thread_reconcile_ambiguous"
          : "market_research_disabled";
        await terminalizeUnsentDeliveries(ctx, delivery.editionId, code, now);
        rejected += 1;
        continue;
      }
      await ctx.db.patch(delivery._id, {
        status: "pending",
        deliveryWorkerId: undefined,
        deliveryToken: undefined,
        deliveryLeaseExpiresAt: undefined,
        nextAttemptAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(edition._id, {
        status: "retry_wait",
        publicationWorkerId: undefined,
        publicationToken: undefined,
        publicationLeaseExpiresAt: undefined,
        nextAttemptAt: now,
        updatedAt: now,
      });
      publicationRecovered += 1;
    }
    return {
      scanned: scanned + expiredDeliveries.length,
      recovered: recoveredRequests.length + publicationRecovered + previewRecovered,
      deferred,
      rejected,
      researchRequests: recoveredRequests,
      hasMore: scanned + expiredDeliveries.length === MARKET_RESEARCH_RECOVERY_BATCH_SIZE,
    };
  },
});

export const expirePreviewsAndEvidence = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const previews = await ctx.db
      .query("marketResearchPreviews")
      .withIndex("by_expiresAt", (index) => index.lte("expiresAt", now))
      .take(25);
    for (const preview of previews) await ctx.db.delete(preview._id);
    const evidence = await ctx.db
      .query("marketResearchEvidence")
      .withIndex("by_retentionExpiresAt", (index) => index.lte("retentionExpiresAt", now))
      .take(25);
    let evidenceDeleted = 0;
    let evidenceDeferred = 0;
    for (const record of evidence) {
      const edition = await editionByStableId(ctx, record.editionId);
      if (mayDeleteRetainedEvidence(edition?.status, record.retentionExpiresAt, now)) {
        await ctx.db.delete(record._id);
        evidenceDeleted += 1;
      } else {
        await ctx.db.patch(record._id, {
          retentionExpiresAt: now + MARKET_RESEARCH_RETENTION_DEFER_MS,
        });
        evidenceDeferred += 1;
      }
    }
    return {
      previewsDeleted: previews.length,
      evidenceDeleted,
      evidenceDeferred,
      preservedEditionSummaries: true as const,
      preservedPublicationReceipts: true as const,
      hasMore: previews.length === 25 || evidence.length === 25,
    };
  },
});

export const getEditionForDispatch = internalQuery({
  args: { editionId: v.string() },
  handler: async (ctx, args) => editionByStableId(ctx, args.editionId),
});
