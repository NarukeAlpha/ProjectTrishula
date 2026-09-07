/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unsafe-dictionary-type -- Zod refinements inspect their untrusted input only inside this canonical schema boundary. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { isNonPublicHostname } from "./public-url.js";

export const MARKET_RESEARCH_SCHEMA_VERSION = 1 as const;
export const MARKET_RESEARCH_MAX_EVIDENCE_BYTES = 256 * 1024;
export const MARKET_RESEARCH_MAX_CHECKPOINT_BYTES = 64 * 1024;
export const MARKET_RESEARCH_MAX_HIGHLIGHT_CHARACTERS = 2_000;

const id = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9:._-]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const symbol = z.string().trim().min(1).max(20).regex(/^[A-Z0-9.^=-]+$/);
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const isoDateTime = z.iso.datetime({ offset: true });
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const httpsUrl = z.url().max(2_000).superRefine((value, context) => {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.port !== ""
    || isNonPublicHostname(parsed.hostname)
  ) {
    context.addIssue({ code: "custom", message: "A public HTTPS URL is required." });
  }
});
const sourceIds = z.array(id).min(1).max(20).refine(
  (values) => new Set(values).size === values.length,
  "Source IDs must be unique.",
);

export const marketResearchSafeErrorCodeSchema = z.enum([
  "market_research_disabled",
  "forum_not_configured",
  "forum_wrong_channel_type",
  "forum_permissions_incomplete",
  "edition_already_exists",
  "edition_lease_lost",
  "exa_not_configured",
  "exa_auth_failed",
  "exa_budget_exhausted",
  "exa_rate_limited",
  "exa_unavailable",
  "exa_invalid_request",
  "exa_connect_zdr_incompatible",
  "source_rights_blocked",
  "source_unavailable",
  "market_data_not_configured",
  "market_data_stale",
  "market_data_conflict",
  "market_data_unavailable",
  "market_session_calendar_stale",
  "session_unknown",
  "evidence_below_minimum",
  "composition_auth_required",
  "composition_provider_not_ready",
  "composition_timeout",
  "composition_schema_invalid",
  "composition_citation_invalid",
  "chart_unavailable",
  "chart_artifact_expired",
  "discord_thread_create_failed",
  "discord_thread_reconcile_failed",
  "discord_thread_reconcile_ambiguous",
  "discord_reply_failed",
  "discord_permission_failed",
  "discord_rate_limited",
  "late_cutoff_exceeded",
]);

export type MarketResearchSafeErrorCode = z.infer<
  typeof marketResearchSafeErrorCodeSchema
>;

const retryableMarketResearchErrors = new Set<MarketResearchSafeErrorCode>([
  "exa_rate_limited",
  "exa_unavailable",
  "market_data_unavailable",
  "composition_timeout",
]);

export function parseMarketResearchSafeErrorCode(value: unknown): MarketResearchSafeErrorCode | null {
  const parsed = marketResearchSafeErrorCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function isRetryableMarketResearchError(code: MarketResearchSafeErrorCode): boolean {
  return retryableMarketResearchErrors.has(code);
}

export const sourcePolicyStateSchema = z.enum([
  "approved",
  "evaluation_only",
  "permission_required",
  "blocked",
  "unavailable",
]);

export const requestedSourceSchema = z.enum([
  "FinancialJuice",
  "Barchart",
  "ForexFactory",
  "Yahoo",
  "TradingView",
]);

export const REQUESTED_SOURCES = requestedSourceSchema.options;

const reportSectionsSchema = z.object({
  overnightMacro: z.boolean(),
  crossAsset: z.boolean(),
  indexSector: z.boolean(),
  calendar: z.boolean(),
  primaryBoard: z.literal(true),
  challengers: z.boolean(),
  tickerDossiers: z.boolean(),
  validation: z.boolean(),
  afterOpen: z.boolean(),
  requestedSources: z.boolean(),
  dataQuality: z.literal(true),
  sources: z.literal(true),
}).strict();

export const marketResearchPreferencesSchema = z.object({
  schemaVersion: z.literal(MARKET_RESEARCH_SCHEMA_VERSION),
  preferenceId: id,
  scheduleId: id,
  ownerId: id,
  guildId: id,
  enabled: z.boolean(),
  forumChannelId: id.nullable(),
  forumTagIds: z.array(id).max(5),
  timezone: boundedText(100),
  timezoneConfirmed: z.boolean(),
  displayTimezones: z.array(boundedText(100)).min(1).max(5),
  localHour: z.number().int().min(0).max(23),
  localMinute: z.number().int().min(0).max(59),
  primarySymbols: z.array(symbol).min(1).max(10),
  symbolPriorities: z.record(symbol, z.number().int().min(0).max(100)),
  sectorSymbols: z.array(symbol).max(20),
  discoverySymbols: z.array(symbol).max(40),
  followedSectors: z.array(boundedText(80)).max(20),
  trackedThemes: z.array(boundedText(160)).max(20),
  macroTopics: z.array(boundedText(160)).max(20),
  eventCategories: z.array(boundedText(80)).max(20),
  preferredDomains: z.array(boundedText(253)).max(100),
  excludedDomains: z.array(boundedText(253)).max(100),
  requestedSources: z.array(requestedSourceSchema).length(5),
  reportSections: reportSectionsSchema,
  maximumRankedSetups: z.number().int().min(1).max(5),
  editionDepth: z.enum(["full", "concise"]),
  includeWeekends: z.boolean(),
  includeCharts: z.boolean(),
  chartsAcceptancePassed: z.boolean(),
  maximumCharts: z.number().int().min(0).max(3),
  lateEditionCutoffLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  searchRequestBudget: z.number().int().min(12).max(100),
  contentsPageBudget: z.number().int().min(1).max(100),
  exaMaxCostUsd: z.number().finite().positive().max(1_000).optional(),
  marketDataProviderId: id.nullable(),
  marketSessionCalendarId: id,
  durableTheses: z.array(z.object({
    thesisId: id,
    symbol,
    text: boundedText(1_000),
    priority: z.number().int().min(0).max(100),
    keyLevels: z.array(z.number().finite().positive()).max(20),
    invalidation: boundedText(500),
    expiresAt: isoDateTime.nullable(),
    status: z.enum(["active", "expired", "invalidated"]),
  }).strict()).max(50),
  sourcePolicyVersion: id,
  promptVersion: id,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
}).strict().superRefine((value, context) => {
  const uniqueFields: Array<[(string | number)[], (string | number)[]]> = [
    [["primarySymbols"], value.primarySymbols],
    [["sectorSymbols"], value.sectorSymbols],
    [["discoverySymbols"], value.discoverySymbols],
    [["requestedSources"], value.requestedSources],
    [["forumTagIds"], value.forumTagIds],
  ];
  for (const [path, values] of uniqueFields) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", path, message: "Values must be unique." });
    }
  }
  const configuredSymbols = new Set([
    ...value.primarySymbols,
    ...value.sectorSymbols,
    ...value.discoverySymbols,
  ]);
  for (const prioritySymbol of Object.keys(value.symbolPriorities)) {
    if (!configuredSymbols.has(prioritySymbol)) {
      context.addIssue({
        code: "custom",
        path: ["symbolPriorities", prioritySymbol],
        message: "A priority symbol must be configured.",
      });
    }
  }
  if (new Set(value.requestedSources).size !== REQUESTED_SOURCES.length) {
    context.addIssue({
      code: "custom",
      path: ["requestedSources"],
      message: "All requested sources are required.",
    });
  }
  if (value.enabled && (!value.timezoneConfirmed || value.forumChannelId === null)) {
    context.addIssue({
      code: "custom",
      path: [value.timezoneConfirmed ? "forumChannelId" : "timezoneConfirmed"],
      message: "An enabled schedule requires a confirmed timezone and forum.",
    });
  }
});

export type MarketResearchPreferencesV1 = z.infer<
  typeof marketResearchPreferencesSchema
>;

export const marketResearchJobRequestSchema = z.object({
  schemaVersion: z.literal(MARKET_RESEARCH_SCHEMA_VERSION),
  dispatchId: id,
  editionId: id,
  ownerId: id,
  guildId: id,
  generation: z.number().int().positive(),
  claimToken: id,
  scheduledFor: isoDateTime,
  resumeFrom: z.enum([
    "collecting",
    "researching",
    "calculating",
    "composing",
  ]),
  configurationSnapshotHash: hash,
  preferences: marketResearchPreferencesSchema,
  retainedEvidenceIds: z.array(id).max(500),
  session: z.object({
    sessionType: z.enum(["OPEN", "EARLY_CLOSE", "CLOSED", "UNKNOWN"]),
    editionLabel: z.enum(["Morning Market Newspaper", "Weekend Outlook", "Market Holiday Outlook", "Late Edition", "Data unavailable"]),
    editionDate: localDate,
    timezone: boundedText(100),
    configuredLocalTime: isoDateTime,
    marketTime: isoDateTime,
    previousSessionDate: localDate.nullable(),
    previousSessionClose: isoDateTime.nullable(),
    nextSessionDate: localDate.nullable(),
    calendarVersion: id,
    sourceIds: sourceIds.or(z.array(id).length(0)),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.ownerId !== value.preferences.ownerId || value.guildId !== value.preferences.guildId) {
    context.addIssue({ code: "custom", message: "The job actor does not match its frozen preferences." });
  }
  if (value.dispatchId !== `${value.editionId}:research:${value.generation}`) {
    context.addIssue({ code: "custom", path: ["dispatchId"], message: "Invalid attempt-scoped dispatch ID." });
  }
  if (value.session.timezone !== value.preferences.timezone) {
    context.addIssue({ code: "custom", path: ["session", "timezone"], message: "Session timezone mismatch." });
  }
});

export const marketResearchJobParamsSchema = z.strictObject({ jobId: id });
export const marketResearchJobOwnerQuerySchema = z.strictObject({ ownerId: id });

export type MarketResearchJobRequest = z.infer<typeof marketResearchJobRequestSchema>;

export const contentStatusSchema = z.enum([
  "available",
  "cached",
  "delayed",
  "stale",
  "unknown",
  "blocked",
  "failed",
]);

export const marketResearchEvidenceItemSchema = z.object({
  evidenceId: id,
  kind: z.enum([
    "news",
    "official",
    "quote",
    "bar",
    "calculation",
    "calendar",
    "corporate_action",
    "source_status",
  ]),
  provider: boundedText(100),
  sourcePolicy: sourcePolicyStateSchema,
  title: boundedText(500).optional(),
  url: httpsUrl.optional(),
  canonicalUrlHash: hash.optional(),
  author: boundedText(200).optional(),
  publishedAt: isoDateTime.optional(),
  providerTimestamp: isoDateTime.optional(),
  retrievedAt: isoDateTime,
  sessionLabel: z.enum(["premarket", "regular", "after_hours", "closed", "unknown"]).optional(),
  freshness: z.enum(["fresh", "cached", "delayed", "stale", "unknown"]),
  contentStatus: contentStatusSchema,
  highlights: z.array(z.string().max(MARKET_RESEARCH_MAX_HIGHLIGHT_CHARACTERS)).max(20),
  normalizedClaims: z.array(boundedText(1_000)).max(30),
  requestId: id.optional(),
  costUsd: z.number().finite().nonnegative().max(1_000).optional(),
  contentHash: hash,
}).strict().superRefine((value, context) => {
  if (value.highlights.join("\n").length > MARKET_RESEARCH_MAX_HIGHLIGHT_CHARACTERS) {
    context.addIssue({ code: "custom", path: ["highlights"], message: "Highlights exceed the retained limit." });
  }
  if (value.kind === "quote" && (value.providerTimestamp === undefined || value.sessionLabel === undefined)) {
    context.addIssue({ code: "custom", message: "Quotes require a provider timestamp and session label." });
  }
});

export type MarketResearchEvidenceItem = z.infer<
  typeof marketResearchEvidenceItemSchema
>;

export const requestedSourceStatusSchema = z.object({
  source: requestedSourceSchema,
  status: z.enum(["contributed", "no_material_item", "unavailable", "disabled_by_policy"]),
  detail: boundedText(300),
  sourceIds: z.array(id).max(20),
}).strict();

export const marketSessionContextSchema = z.object({
  sessionType: z.enum(["OPEN", "EARLY_CLOSE", "CLOSED", "UNKNOWN"]),
  editionLabel: z.enum(["Morning Market Newspaper", "Weekend Outlook", "Market Holiday Outlook", "Late Edition", "Data unavailable"]),
  editionDate: localDate,
  timezone: boundedText(100),
  configuredLocalTime: isoDateTime,
  marketTime: isoDateTime,
  previousSessionDate: localDate.nullable(),
  previousSessionClose: isoDateTime.nullable(),
  nextSessionDate: localDate.nullable(),
  calendarVersion: id,
  sourceIds: sourceIds.or(z.array(id).length(0)),
}).strict();

export const morningPaperEvidenceSchema = z.object({
  schemaVersion: z.literal(MARKET_RESEARCH_SCHEMA_VERSION),
  editionId: id,
  generatedAt: isoDateTime,
  session: marketSessionContextSchema,
  primarySymbols: z.array(symbol).min(1).max(10),
  sectorSymbols: z.array(symbol).max(20),
  discoverySymbols: z.array(symbol).max(40),
  sourcePolicyVersion: id,
  requestedSourceStatus: z.array(requestedSourceStatusSchema).length(5),
  evidence: z.array(marketResearchEvidenceItemSchema).max(500),
  missingFields: z.array(boundedText(500)).max(200),
  conflicts: z.array(z.object({
    conflictId: id,
    field: boundedText(100),
    sourceIds: sourceIds,
    detail: boundedText(500),
  }).strict()).max(100),
  allowedSourceIds: z.array(id).max(500),
}).strict().superRefine((value, context) => {
  const evidenceIds = value.evidence.map((item) => item.evidenceId);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    context.addIssue({ code: "custom", path: ["evidence"], message: "Evidence IDs must be unique." });
  }
  const actualIds = new Set(evidenceIds);
  if (new Set(value.allowedSourceIds).size !== value.allowedSourceIds.length) {
    context.addIssue({ code: "custom", path: ["allowedSourceIds"], message: "Allowed source IDs must be unique." });
  }
  for (const allowed of value.allowedSourceIds) {
    if (!actualIds.has(allowed)) {
      context.addIssue({ code: "custom", path: ["allowedSourceIds"], message: "Allowed source ID is unknown." });
    }
  }
  const referencedIds = [
    ...value.session.sourceIds,
    ...value.requestedSourceStatus.flatMap((status) => status.sourceIds),
    ...value.conflicts.flatMap((conflict) => conflict.sourceIds),
  ];
  for (const referenced of referencedIds) {
    if (!actualIds.has(referenced)) {
      context.addIssue({ code: "custom", message: "Evidence packet references an unknown source ID." });
    }
  }
});

export type MorningPaperEvidenceV1 = z.infer<typeof morningPaperEvidenceSchema>;

const citedTextSchema = z.object({
  text: boundedText(2_000),
  sourceIds,
}).strict();

const setupScoreSchema = z.object({
  catalyst: z.number().int().min(0).max(20),
  liquidityAndSpread: z.number().int().min(0).max(15),
  dailyAndHourlyBias: z.number().int().min(0).max(20),
  premarketStructure: z.number().int().min(0).max(15),
  levelQualityAndProximity: z.number().int().min(0).max(20),
  indexAndSectorConfirmation: z.number().int().min(0).max(10),
}).strict();

export const setupSchema = z.object({
  symbol,
  label: z.enum(["TOP WATCH", "WATCH", "WAIT FOR CONFIRMATION", "AVOID", "EXIT-RISK"]),
  score: z.number().int().min(0).max(100),
  components: setupScoreSchema,
  deductions: z.array(boundedText(300)).max(12),
  thesisLabel: z.enum(["VALIDATED", "PARTIALLY VALIDATED", "AT RISK", "INVALIDATED", "NO PRIOR THESIS"]),
  trigger: citedTextSchema,
  invalidation: citedTextSchema,
  firstResistanceOrTarget: citedTextSchema,
  rewardToRisk: citedTextSchema,
  noChase: citedTextSchema,
  indexOrSectorCondition: citedTextSchema,
  eventRisk: citedTextSchema,
  sourceIds,
}).strict().superRefine((value, context) => {
  const total = Object.values(value.components).reduce((sum, component) => sum + component, 0);
  if (value.score !== total) {
    context.addIssue({ code: "custom", path: ["score"], message: "Score must equal component total." });
  }
});

const tickerDossierSchema = z.object({
  symbol,
  thesisLabel: z.enum(["VALIDATED", "PARTIALLY VALIDATED", "AT RISK", "INVALIDATED", "NO PRIOR THESIS"]),
  summary: citedTextSchema,
  availableFields: z.array(boundedText(100)).max(50),
  unavailableFields: z.array(boundedText(100)).max(50),
  sourceIds,
}).strict();

export const editionSectionSchema = z.object({
  sectionId: id,
  sequence: z.number().int().nonnegative().max(100),
  kind: z.enum([
    "how_to_read",
    "overnight_macro",
    "cross_asset",
    "index_sector",
    "scheduled_events",
    "primary_board",
    "challengers",
    "ticker_dossiers",
    "validation",
    "after_open",
    "requested_sources",
    "data_quality",
    "sources",
  ]),
  heading: boundedText(100),
  markdown: z.string().trim().min(1).max(24_000),
  sourceIds: z.array(id).max(100),
}).strict();

export const chartRequestSchema = z.object({
  chartRequestId: id,
  editionId: id,
  sectionId: id,
  symbol,
  timeframe: z.enum(["5m", "15m", "60m", "daily", "weekly"]),
  start: isoDateTime,
  end: isoDateTime,
  session: z.enum(["premarket", "regular", "after_hours", "all"]),
  overlays: z.array(boundedText(100)).max(10),
  annotations: z.array(boundedText(300)).max(20),
  reason: boundedText(500),
  priority: z.number().int().min(0).max(100),
  sourceEvidenceIds: sourceIds,
  dataAsOf: isoDateTime,
}).strict();

export const morningPaperEditionSchema = z.object({
  schemaVersion: z.literal(MARKET_RESEARCH_SCHEMA_VERSION),
  editionId: id,
  editionDate: localDate,
  timezone: boundedText(100),
  asOf: isoDateTime,
  sessionType: z.enum(["OPEN", "EARLY_CLOSE", "CLOSED", "UNKNOWN"]),
  editionLabel: z.enum(["Morning Market Newspaper", "Weekend Outlook", "Market Holiday Outlook", "Late Edition", "Data unavailable"]),
  regime: z.enum(["RISK_ON", "MIXED", "RISK_OFF"]),
  regimeLines: z.array(citedTextSchema).length(5),
  topStories: z.array(citedTextSchema).min(3).max(5),
  scheduledEvents: z.array(citedTextSchema).max(20),
  marketContext: z.array(citedTextSchema).min(1).max(30),
  primaryBoard: z.array(setupSchema).max(10),
  challengers: z.array(setupSchema).max(3),
  tickerDossiers: z.array(tickerDossierSchema).min(1).max(40),
  validationRules: z.array(citedTextSchema).min(1).max(20),
  afterOpenChanges: z.array(citedTextSchema).max(20),
  requestedSourceStatus: z.array(requestedSourceStatusSchema).length(5),
  dataQuality: z.array(citedTextSchema).min(1).max(50),
  sections: z.array(editionSectionSchema).min(3).max(30),
  chartRequests: z.array(chartRequestSchema).max(3),
  sourceIds: z.array(id).min(1).max(500),
  noTradingAction: z.literal(true),
}).strict().superRefine((value, context) => {
  const primarySymbols = value.tickerDossiers.map((dossier) => dossier.symbol);
  if (new Set(primarySymbols).size !== primarySymbols.length) {
    context.addIssue({ code: "custom", path: ["tickerDossiers"], message: "Ticker dossiers must be unique." });
  }
  if (new Set(value.sourceIds).size !== value.sourceIds.length) {
    context.addIssue({ code: "custom", path: ["sourceIds"], message: "Edition source IDs must be unique." });
  }
  const allowed = new Set(value.sourceIds);
  const citedGroups = [
    ...value.regimeLines,
    ...value.topStories,
    ...value.scheduledEvents,
    ...value.marketContext,
    ...value.validationRules,
    ...value.afterOpenChanges,
    ...value.dataQuality,
  ];
  const setupGroups = [...value.primaryBoard, ...value.challengers];
  for (const claim of citedGroups) {
    for (const sourceId of claim.sourceIds) {
      if (!allowed.has(sourceId)) context.addIssue({ code: "custom", message: "Edition cites an unknown source ID." });
    }
  }
  for (const setup of setupGroups) {
    const setupSourceIds = [
      ...setup.sourceIds,
      ...setup.trigger.sourceIds,
      ...setup.invalidation.sourceIds,
      ...setup.firstResistanceOrTarget.sourceIds,
      ...setup.rewardToRisk.sourceIds,
      ...setup.noChase.sourceIds,
      ...setup.indexOrSectorCondition.sourceIds,
      ...setup.eventRisk.sourceIds,
    ];
    for (const sourceId of setupSourceIds) {
      if (!allowed.has(sourceId)) context.addIssue({ code: "custom", message: "A setup cites an unknown source ID." });
    }
    const expectedLabel = setup.score >= 85
      ? "TOP WATCH"
      : setup.score >= 75
        ? "WATCH"
        : setup.score >= 65
          ? "WAIT FOR CONFIRMATION"
          : "AVOID";
    if (setup.label !== "EXIT-RISK" && setup.label !== expectedLabel) {
      context.addIssue({ code: "custom", message: "A setup label does not match its score." });
    }
    if (setup.label === "EXIT-RISK" && setup.thesisLabel !== "AT RISK" && setup.thesisLabel !== "INVALIDATED") {
      context.addIssue({ code: "custom", message: "EXIT-RISK requires an at-risk or invalidated thesis." });
    }
  }
  for (const dossier of value.tickerDossiers) {
    for (const sourceId of [...dossier.sourceIds, ...dossier.summary.sourceIds]) {
      if (!allowed.has(sourceId)) context.addIssue({ code: "custom", message: "A ticker dossier cites an unknown source ID." });
    }
  }
  for (const section of value.sections) {
    for (const sourceId of section.sourceIds) {
      if (!allowed.has(sourceId)) context.addIssue({ code: "custom", message: "A section cites an unknown source ID." });
    }
  }
  for (const status of value.requestedSourceStatus) {
    for (const sourceId of status.sourceIds) {
      if (!allowed.has(sourceId)) context.addIssue({ code: "custom", message: "A requested-source status cites an unknown source ID." });
    }
  }
  const sectionIds = value.sections.map((section) => section.sectionId);
  if (new Set(sectionIds).size !== sectionIds.length) {
    context.addIssue({ code: "custom", path: ["sections"], message: "Section IDs must be unique." });
  }
  const requiredKinds = new Set(["primary_board", "data_quality", "sources"]);
  for (const section of value.sections) requiredKinds.delete(section.kind);
  if (requiredKinds.size > 0) {
    context.addIssue({ code: "custom", path: ["sections"], message: "Required edition sections are missing." });
  }
  const sectionOrder = [
    "how_to_read", "overnight_macro", "cross_asset", "index_sector",
    "scheduled_events", "primary_board", "challengers", "ticker_dossiers",
    "validation", "after_open", "requested_sources", "data_quality", "sources",
  ];
  const orderedSections = [...value.sections].sort((left, right) => left.sequence - right.sequence);
  if (
    new Set(value.sections.map((section) => section.sequence)).size !== value.sections.length
    || orderedSections.some((section, index) => section.sequence !== index)
    || orderedSections.some((section, index) => index > 0
      && sectionOrder.indexOf(section.kind) <= sectionOrder.indexOf(orderedSections[index - 1]?.kind ?? ""))
  ) {
    context.addIssue({ code: "custom", path: ["sections"], message: "Edition sections are out of order." });
  }
  const sectionIdSet = new Set(sectionIds);
  const chartRequestIds = new Set<string>();
  for (const [index, request] of value.chartRequests.entries()) {
    if (
      request.editionId !== value.editionId
      || !sectionIdSet.has(request.sectionId)
      || chartRequestIds.has(request.chartRequestId)
      || Date.parse(request.start) >= Date.parse(request.end)
    ) {
      context.addIssue({
        code: "custom",
        path: ["chartRequests", index],
        message: "Chart request identity, section, or time range is invalid.",
      });
    }
    chartRequestIds.add(request.chartRequestId);
    for (const sourceId of request.sourceEvidenceIds) {
      if (!allowed.has(sourceId)) {
        context.addIssue({
          code: "custom",
          path: ["chartRequests", index, "sourceEvidenceIds"],
          message: "A chart request cites an unknown source ID.",
        });
      }
    }
  }
});

export type MorningPaperEditionV1 = z.infer<typeof morningPaperEditionSchema>;

export const chartArtifactSchema = z.object({
  chartRequestId: id,
  status: z.enum(["rendered", "unavailable", "failed"]),
  filename: boundedText(255).optional(),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]).optional(),
  artifactTransport: z.enum(["in_process", "convex_storage"]),
  storageId: id.optional(),
  sha256: hash.optional(),
  byteLength: z.number().int().positive().max(8 * 1024 * 1024).optional(),
  width: z.number().int().positive().max(8_192).optional(),
  height: z.number().int().positive().max(8_192).optional(),
  altText: boundedText(1_024).optional(),
  dataAsOf: isoDateTime.optional(),
  sourceEvidenceIds: z.array(id).max(50),
  expiresAt: isoDateTime.optional(),
  errorCode: marketResearchSafeErrorCodeSchema.optional(),
}).strict();

export const deliveryPartSchema = z.object({
  deliveryId: id,
  idempotencyKey: id,
  sequence: z.number().int().nonnegative().max(10_000),
  kind: z.enum(["starter", "reply"]),
  content: z.string().trim().min(1).max(2_000),
  contentHash: hash,
  sourceSectionIds: z.array(id).max(30),
  chartAttachmentIds: z.array(id).max(3),
  nonce: id,
}).strict();

export const marketResearchJobResultSchema = z.object({
  schemaVersion: z.literal(MARKET_RESEARCH_SCHEMA_VERSION),
  dispatchId: id,
  editionId: id,
  generation: z.number().int().positive(),
  claimToken: id,
  evidence: morningPaperEvidenceSchema,
  edition: morningPaperEditionSchema,
  deliveries: z.array(deliveryPartSchema).min(1).max(500),
  exaRequestCount: z.number().int().nonnegative().max(100),
  exaCostUsd: z.number().finite().nonnegative().max(1_000),
  completedAt: isoDateTime,
}).strict().superRefine((value, context) => {
  if (value.editionId !== value.evidence.editionId || value.editionId !== value.edition.editionId) {
    context.addIssue({ code: "custom", message: "Result edition IDs do not match." });
  }
  const sequences = value.deliveries.map((delivery) => delivery.sequence);
  if (new Set(sequences).size !== sequences.length) {
    context.addIssue({ code: "custom", path: ["deliveries"], message: "Delivery sequences must be unique." });
  }
  const starters = value.deliveries.filter((delivery) => delivery.kind === "starter");
  if (starters.length !== 1 || starters[0]?.sequence !== 0) {
    context.addIssue({ code: "custom", path: ["deliveries"], message: "One sequence-zero starter is required." });
  }
});

export type MarketResearchJobResult = z.infer<typeof marketResearchJobResultSchema>;

export const marketResearchPreviewSchema = z.object({
  schemaVersion: z.literal(MARKET_RESEARCH_SCHEMA_VERSION),
  previewId: id.refine((value) => value.startsWith("MRP-"), "Preview namespace required."),
  ownerId: id,
  guildId: id,
  configurationSnapshotHash: hash,
  requestedAt: isoDateTime,
  status: z.enum(["queued", "running", "completed", "failed"]),
  safeFailure: marketResearchSafeErrorCodeSchema.optional(),
  qualitySummary: z.array(boundedText(300)).max(30),
  expiresAt: isoDateTime,
}).strict();

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

export function marketResearchFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function assertEvidencePacketSize(value: MorningPaperEvidenceV1): void {
  if (jsonByteLength(value) > MARKET_RESEARCH_MAX_EVIDENCE_BYTES) {
    throw new Error("evidence_below_minimum");
  }
}
