/* oxlint-disable anti-slop/no-conditional-empty-object-spread, anti-slop/no-known-value-widening, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unknown-parameters -- Exact optional evidence fields and caught provider causes are normalized before the runner persists them. */
import type { Logger } from "../runtime/logger.js";
import type { MorningPaperComposer } from "./composer.js";
import type { MarketResearchCallbacks } from "./convex-client.js";
import {
  marketResearchEvidenceItemSchema,
  marketResearchJobRequestSchema,
  marketResearchJobResultSchema,
  morningPaperEvidenceSchema,
  isRetryableMarketResearchError,
  parseMarketResearchSafeErrorCode,
  type MarketResearchEvidenceItem,
  type MarketResearchJobRequest,
  type MarketResearchJobResult,
  type MarketResearchSafeErrorCode,
  type MorningPaperEditionV1,
  type MorningPaperEvidenceV1,
} from "./contracts.js";
import { materializeDeliveryParts } from "./delivery.js";
import { MarketResearchExaError, classifyExaError } from "./exa-errors.js";
import type { MarketResearchExaClient } from "./exa-client.js";
import type { ContentEvidenceStatus, SearchEvidenceBatch } from "./exa-client.js";
import { calculateAnalytics } from "./analytics.js";
import {
  DisabledMarketDataProvider,
  type MarketBar,
  type CorporateAction,
  type MarketDataProvider,
  type MarketMover,
  type MarketSnapshot,
  type SessionStatus,
  validateBars,
  validateSessionStatus,
  validateSnapshots,
} from "./market-data.js";
import { buildResearchPlan, newsPublicationWindow } from "./research-plan.js";
import { boundedEvidencePacket, evidenceCheckpoints } from "./source-normalizer-evidence.js";
import {
  canonicalSourceUrl,
  deduplicateEvidence,
  normalizedContentFingerprint,
  sha256,
} from "./source-normalizer.js";
import {
  StaticSourcePolicy,
  initialRequestedSourceStatus,
  requestedSourceStatusFromEvidence,
  type SourcePolicy,
} from "./source-policy.js";

export interface MarketResearchRunnerReadiness {
  ready: boolean;
  reason?: string;
}

export interface MarketResearchRunner {
  initialize(): Promise<void>;
  readiness(): MarketResearchRunnerReadiness;
  run(request: MarketResearchJobRequest, signal?: AbortSignal): Promise<MarketResearchJobResult>;
  dispose(): Promise<void>;
}

export interface MarketResearchRunnerOptions {
  exaClient: (request: MarketResearchJobRequest) => MarketResearchExaClient;
  marketData?: MarketDataProvider;
  composer: MorningPaperComposer;
  callbacks: MarketResearchCallbacks;
  logger: Logger;
  sourcePolicy?: SourcePolicy;
  now?: () => Date;
}

function zonedParts(instant: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday ?? "",
    localIsoLabel: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00[${timezone}]`,
  };
}

function firstSessionAfterHoliday(
  editionDate: string,
  previousSessionDate: string | null,
  weekday: string,
): boolean {
  if (previousSessionDate === null) return false;
  const current = Date.parse(`${editionDate}T00:00:00.000Z`);
  const previous = Date.parse(`${previousSessionDate}T00:00:00.000Z`);
  const gapDays = Math.round((current - previous) / (24 * 60 * 60 * 1_000));
  const expectedGapDays = weekday === "Mon" ? 3 : 1;
  return gapDays > expectedGapDays;
}

function operationalEvidence(request: MarketResearchJobRequest, now: Date): MarketResearchEvidenceItem {
  const claim = "A permitted structured market-data provider is not configured. No market conclusion or setup score is available.";
  return marketResearchEvidenceItemSchema.parse({
    evidenceId: "operational-market-data-unavailable",
    kind: "source_status",
    provider: "Project Trishula",
    sourcePolicy: "unavailable",
    retrievedAt: now.toISOString(),
    freshness: "unknown",
    contentStatus: "failed",
    highlights: [],
    normalizedClaims: [claim],
    contentHash: sha256(`${request.editionId}:${claim}`),
  });
}

function evidenceFromSearch(
  batch: Awaited<ReturnType<MarketResearchExaClient["searchNews"]>>,
): MarketResearchEvidenceItem[] {
  return batch.results.map((result) => marketResearchEvidenceItemSchema.parse({
    evidenceId: result.evidenceId,
    kind: "news",
    provider: "Exa",
    sourcePolicy: "approved",
    title: result.title,
    url: result.url,
    canonicalUrlHash: sha256(canonicalSourceUrl(result.url)),
    ...(result.author ? { author: result.author } : {}),
    ...(result.publishedDate ? { publishedAt: result.publishedDate } : {}),
    retrievedAt: batch.retrievedAt,
    freshness: "fresh",
    contentStatus: "available",
    highlights: result.highlights,
    normalizedClaims: [],
    requestId: batch.requestId,
    contentHash: result.contentHash,
  }));
}

function searchRequestEvidence(
  slotId: string,
  slotVersion: string,
  batch: SearchEvidenceBatch,
): MarketResearchEvidenceItem {
  const detail = `Exa Search slot ${batch.queryId} completed with ${batch.results.length} retained result(s).`;
  return marketResearchEvidenceItemSchema.parse({
    evidenceId: `exa-search-slot-${sha256(`${slotVersion}:${slotId}`).slice(0, 32)}`,
    kind: "source_status",
    provider: "Exa",
    sourcePolicy: "approved",
    retrievedAt: batch.retrievedAt,
    freshness: "fresh",
    contentStatus: "available",
    highlights: [],
    normalizedClaims: [detail],
    requestId: batch.requestId,
    costUsd: batch.costUsd,
    contentHash: sha256(`${slotVersion}:${slotId}:${detail}:${batch.requestId}`),
  });
}

function contentsCompletionEvidence(
  result: ContentEvidenceStatus,
): MarketResearchEvidenceItem[] {
  const canonicalUrl = canonicalSourceUrl(result.url);
  const canonicalUrlHash = sha256(canonicalUrl);
  const status = result.status === "available"
    ? "available" as const
    : result.status === "cached"
      ? "cached" as const
      : result.status === "delayed"
        ? "delayed" as const
    : result.status === "blocked"
      ? "blocked" as const
      : result.status === "stale"
        ? "stale" as const
        : result.status === "unknown"
          ? "unknown" as const
          : "failed" as const;
  const freshness = result.status === "cached"
    ? "cached" as const
    : result.status === "delayed"
      ? "delayed" as const
      : result.status === "stale"
        ? "stale" as const
        : result.status === "available"
          ? "fresh" as const
          : "unknown" as const;
  const completionId = `exa-contents-url-${canonicalUrlHash.slice(0, 32)}`;
  const detail = `Exa Contents completed for the selected URL with status ${result.status}.`;
  const completion = marketResearchEvidenceItemSchema.parse({
    evidenceId: completionId,
    kind: "source_status",
    provider: "Exa",
    sourcePolicy: result.status === "blocked" ? "blocked" : "approved",
    url: canonicalUrl,
    retrievedAt: result.retrievedAt,
    freshness,
    contentStatus: status,
    highlights: [],
    normalizedClaims: [detail],
    ...(result.requestId === undefined ? {} : { requestId: result.requestId }),
    ...(result.costUsd <= 0 ? {} : { costUsd: result.costUsd }),
    contentHash: sha256(`${canonicalUrl}:${result.status}:${result.requestId ?? "none"}`),
  });
  if (result.status !== "available" || result.highlights.length === 0) return [completion];
  const content = marketResearchEvidenceItemSchema.parse({
    evidenceId: `exa-content-${sha256(`${canonicalUrl}:${result.requestId ?? result.retrievedAt}`).slice(0, 32)}`,
    kind: "news",
    provider: "Exa",
    sourcePolicy: "approved",
    title: result.title ?? new URL(canonicalUrl).hostname,
    url: canonicalUrl,
    canonicalUrlHash,
    ...(result.author === undefined ? {} : { author: result.author }),
    ...(result.publishedDate === undefined ? {} : { publishedAt: result.publishedDate }),
    retrievedAt: result.retrievedAt,
    freshness: "fresh",
    contentStatus: "available",
    highlights: result.highlights,
    normalizedClaims: [],
    ...(result.requestId === undefined ? {} : { requestId: result.requestId }),
    contentHash: normalizedContentFingerprint(result.title, result.highlights),
  });
  return [content, completion];
}

function contentPriority(
  url: string,
  slotKind: string,
  preferredDomains: readonly string[],
): number {
  const hostname = new URL(url).hostname.toLowerCase();
  const preferred = preferredDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  if (slotKind === "official_calendar") return 0;
  if (slotKind === "primary_board_news") return 1;
  if (preferred) return 2;
  return 3;
}

function exaCollectionCompleteEvidence(
  request: MarketResearchJobRequest,
  retrievedAt: string,
): MarketResearchEvidenceItem {
  const detail = "The bounded Exa Search and Contents collection checkpoint is complete.";
  return marketResearchEvidenceItemSchema.parse({
    evidenceId: "exa-collection-complete",
    kind: "source_status",
    provider: "Project Trishula",
    sourcePolicy: "approved",
    retrievedAt,
    freshness: "fresh",
    contentStatus: "available",
    highlights: [],
    normalizedClaims: [detail],
    contentHash: sha256(`${request.editionId}:${detail}`),
  });
}

function deduplicateWithAudit(
  evidence: readonly MarketResearchEvidenceItem[],
  retrievedAt: string,
): MarketResearchEvidenceItem[] {
  const deduplicated = deduplicateEvidence(evidence);
  const audit = deduplicated.duplicateUrls.map(({ retainedEvidenceId, duplicateUrl }) => {
    const detail = `Duplicate source URL retained for audit; canonical evidence is ${retainedEvidenceId}.`;
    return marketResearchEvidenceItemSchema.parse({
      evidenceId: `duplicate-url-${sha256(`${retainedEvidenceId}:${duplicateUrl}`).slice(0, 32)}`,
      kind: "source_status",
      provider: "Project Trishula deduplication",
      sourcePolicy: "approved",
      url: duplicateUrl,
      retrievedAt,
      freshness: "unknown",
      contentStatus: "available",
      highlights: [],
      normalizedClaims: [detail],
      contentHash: sha256(`${detail}:${duplicateUrl}`),
    });
  });
  return [...deduplicated.retained, ...audit];
}

function snapshotEvidence(snapshot: MarketSnapshot): MarketResearchEvidenceItem[] {
  const fields = [snapshot.price, snapshot.priorClose, snapshot.bid, snapshot.ask, snapshot.volume].filter(
    (value): value is NonNullable<typeof value> => value !== undefined,
  );
  return fields.map((field) => marketResearchEvidenceItemSchema.parse({
    evidenceId: `market-${sha256(`${snapshot.symbol}:${field.rawField}:${field.providerTimestamp}`).slice(0, 32)}`,
    kind: "quote",
    provider: field.provider,
    sourcePolicy: field.policyStatus,
    providerTimestamp: field.providerTimestamp,
    retrievedAt: field.retrievedAt,
    sessionLabel: field.sessionLabel,
    freshness: field.entitlement === "delayed" ? "delayed" : "fresh",
    contentStatus: field.entitlement === "delayed" ? "delayed" : "available",
    highlights: [],
    normalizedClaims: [`${field.symbol} ${field.rawField}=${field.value} ${field.unit}`],
    contentHash: sha256(JSON.stringify(field)),
  }));
}

function snapshotHasConflict(snapshot: MarketSnapshot): boolean {
  if (snapshot.bid !== undefined && snapshot.ask !== undefined && snapshot.bid.value > snapshot.ask.value) {
    return true;
  }
  const observations = [snapshot.price, snapshot.priorClose, snapshot.bid, snapshot.ask, snapshot.volume]
    .filter((value): value is NonNullable<typeof value> => value !== undefined);
  const liveQuoteSessions = [snapshot.price, snapshot.bid, snapshot.ask]
    .filter((value): value is NonNullable<typeof value> => value !== undefined)
    .map((value) => value.sessionLabel);
  return observations.some((observation) => observation.symbol !== snapshot.symbol)
    || new Set(liveQuoteSessions).size > 1;
}

function barSeriesEvidence(symbol: string, bars: readonly MarketBar[], retrievedAt: string): MarketResearchEvidenceItem | null {
  const first = bars[0];
  const last = bars.at(-1);
  if (!first || !last) return null;
  const claim = `${symbol} ${first.interval} series has ${bars.length} approved bars from ${first.timestamp} through ${last.timestamp}; latest OHLC ${last.open}/${last.high}/${last.low}/${last.close}${last.volume === undefined ? "" : ` volume ${last.volume}`}.`;
  return marketResearchEvidenceItemSchema.parse({
    evidenceId: `bars-${sha256(`${symbol}:${first.interval}:${bars.map((bar) => bar.timestamp).join(",")}`).slice(0, 32)}`,
    kind: "bar",
    provider: first.provider,
    sourcePolicy: first.policyStatus,
    providerTimestamp: last.providerTimestamp,
    retrievedAt,
    sessionLabel: last.sessionLabel,
    freshness: last.entitlement === "delayed" ? "delayed" : "fresh",
    contentStatus: last.entitlement === "delayed" ? "delayed" : "available",
    highlights: [],
    normalizedClaims: [claim],
    contentHash: sha256(JSON.stringify(bars)),
  });
}

function calculationEvidence(symbol: string, bars: readonly MarketBar[], retrievedAt: string): MarketResearchEvidenceItem[] {
  const interval = bars[0]?.interval;
  if (interval === undefined) return [];
  const analytics = calculateAnalytics(bars);
  const fieldsByInterval: Record<MarketBar["interval"], ReadonlySet<keyof typeof analytics>> = {
    "5m": new Set(["vwap", "range", "slope"]),
    "15m": new Set(["vwap", "range", "slope"]),
    "60m": new Set(["range", "slope"]),
    "1d": new Set(["sma20", "sma50", "sma200", "atr14", "range", "slope"]),
    "1w": new Set(["range", "slope"]),
  };
  return Object.entries(analytics)
    .filter((entry): entry is [keyof typeof analytics, NonNullable<(typeof analytics)[keyof typeof analytics]>] =>
      entry[1] !== null && fieldsByInterval[interval].has(entry[0] as keyof typeof analytics))
    .map(([name, calculation]) => marketResearchEvidenceItemSchema.parse({
      evidenceId: `calc-${sha256(`${symbol}:${interval}:${name}:${JSON.stringify(calculation)}`).slice(0, 32)}`,
      kind: "calculation",
      provider: "Project Trishula deterministic analytics",
      sourcePolicy: "approved",
      providerTimestamp: bars.at(-1)?.providerTimestamp,
      retrievedAt,
      sessionLabel: bars.at(-1)?.sessionLabel,
      freshness: bars.at(-1)?.entitlement === "delayed" ? "delayed" : "fresh",
      contentStatus: bars.at(-1)?.entitlement === "delayed" ? "delayed" : "available",
      highlights: [],
      normalizedClaims: [`${symbol} ${interval} ${name} ${JSON.stringify(calculation.value)}`, calculation.formula],
      contentHash: sha256(JSON.stringify(calculation)),
    }));
}

function corporateActionEvidence(action: CorporateAction): MarketResearchEvidenceItem {
  return marketResearchEvidenceItemSchema.parse({
    evidenceId: `action-${sha256(`${action.actionId}:${action.symbol}:${action.effectiveAt}`).slice(0, 32)}`,
    kind: "corporate_action",
    provider: action.provenance.provider,
    sourcePolicy: action.provenance.policyStatus,
    title: `${action.symbol} ${action.kind}`,
    url: canonicalSourceUrl(action.sourceUrl),
    canonicalUrlHash: sha256(canonicalSourceUrl(action.sourceUrl)),
    providerTimestamp: action.provenance.providerTimestamp,
    retrievedAt: action.provenance.retrievedAt,
    sessionLabel: action.provenance.sessionLabel,
    freshness: action.provenance.entitlement === "delayed" ? "delayed" : "fresh",
    contentStatus: action.provenance.entitlement === "delayed" ? "delayed" : "available",
    highlights: [],
    normalizedClaims: [`${action.symbol} ${action.kind} effective ${action.effectiveAt}: ${action.detail}`],
    contentHash: sha256(JSON.stringify(action)),
  });
}

function moverEvidence(mover: MarketMover): MarketResearchEvidenceItem[] {
  return snapshotEvidence(mover.snapshot).map((item) => marketResearchEvidenceItemSchema.parse({
    ...item,
    evidenceId: `mover-${item.evidenceId}`,
    normalizedClaims: [
      ...item.normalizedClaims,
      `Verified mover candidate ${mover.symbol}; catalyst source IDs: ${mover.catalystSourceIds.join(", ") || "unavailable"}.`,
    ],
    contentHash: sha256(`${item.contentHash}:${mover.catalystSourceIds.join(",")}`),
  }));
}

function operationalEdition(
  request: MarketResearchJobRequest,
  evidence: MorningPaperEvidenceV1,
  asOf: string,
): MorningPaperEditionV1 {
  const sourceId = "operational-market-data-unavailable";
  const cited = (text: string) => ({ text, sourceIds: [sourceId] });
  const unavailable = cited("No market conclusion is available because a permitted structured market-data provider is not configured.");
  return {
    schemaVersion: 1,
    editionId: request.editionId,
    editionDate: evidence.session.editionDate,
    timezone: request.preferences.timezone,
    asOf,
    sessionType: evidence.session.sessionType,
    editionLabel: "Data unavailable",
    regime: "MIXED",
    regimeLines: [unavailable, unavailable, unavailable, unavailable, unavailable],
    topStories: [
      cited("The scheduled evidence gate stopped market conclusions for this edition."),
      cited("Structured quotes and bars remain unavailable, so the edition contains no ranked setup."),
      cited("Use the requested-source and data-quality sections to review the exact unavailable inputs."),
    ],
    scheduledEvents: [],
    marketContext: [unavailable],
    primaryBoard: [],
    challengers: [],
    tickerDossiers: request.preferences.primarySymbols.map((ticker) => ({
      symbol: ticker,
      thesisLabel: "NO PRIOR THESIS",
      summary: cited(`${ticker}: numerical market evidence is unavailable.`),
      availableFields: [],
      unavailableFields: ["quote", "session", "premarket", "bars", "levels", "score"],
      sourceIds: [sourceId],
    })),
    validationRules: [cited("No setup is valid until approved timestamped market evidence is available.")],
    afterOpenChanges: [],
    requestedSourceStatus: evidence.requestedSourceStatus,
    dataQuality: [unavailable],
    sections: [
      { sectionId: "primary-board", sequence: 0, kind: "primary_board", heading: "Primary trade board", markdown: "No qualified setup. Structured market data is unavailable.", sourceIds: [sourceId] },
      { sectionId: "requested-sources", sequence: 1, kind: "requested_sources", heading: "Requested-source status", markdown: evidence.requestedSourceStatus.map((status) => `- ${status.source}: ${status.detail}`).join("\n"), sourceIds: [] },
      { sectionId: "data-quality", sequence: 2, kind: "data_quality", heading: "Data quality and unavailable evidence", markdown: unavailable.text, sourceIds: [sourceId] },
      { sectionId: "sources", sequence: 3, kind: "sources", heading: "Sources", markdown: `- ${sourceId}: Project Trishula operational gate`, sourceIds: [sourceId] },
    ],
    chartRequests: [],
    sourceIds: [sourceId],
    noTradingAction: true,
  };
}

function safeFailure(error: unknown): { code: MarketResearchSafeErrorCode; retryable: boolean } {
  if (error instanceof MarketResearchExaError) return { code: error.decision.code, retryable: error.decision.retryable };
  const message = error instanceof Error ? error.message : "exa_unavailable";
  const code = parseMarketResearchSafeErrorCode(message);
  if (code !== null) return { code, retryable: isRetryableMarketResearchError(code) };
  const decision = classifyExaError(error);
  return { code: decision.code, retryable: decision.retryable };
}

class DefaultMarketResearchRunner implements MarketResearchRunner {
  private readonly marketData: MarketDataProvider;
  private readonly sourcePolicy: SourcePolicy;
  private readonly now: () => Date;
  private disposed = false;
  private initializationError: string | undefined;

  constructor(private readonly options: MarketResearchRunnerOptions) {
    this.marketData = options.marketData ?? new DisabledMarketDataProvider();
    this.sourcePolicy = options.sourcePolicy ?? new StaticSourcePolicy();
    this.now = options.now ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    try {
      await this.options.composer.initialize();
      this.initializationError = undefined;
    } catch (error) {
      this.initializationError = error instanceof Error ? error.message : "composition_provider_not_ready";
      throw error;
    }
  }

  readiness(): MarketResearchRunnerReadiness {
    if (this.disposed) return { ready: false, reason: "market_research_disabled" };
    const composer = this.options.composer.readiness();
    return composer.ready
      ? { ready: true }
      : { ready: false, reason: this.initializationError ?? composer.reason ?? "composition_provider_not_ready" };
  }

  async run(input: MarketResearchJobRequest, signal?: AbortSignal): Promise<MarketResearchJobResult> {
    const request = marketResearchJobRequestSchema.parse(input);
    const leaseController = new AbortController();
    const relayAbort = () => leaseController.abort(signal?.reason);
    if (signal?.aborted) relayAbort();
    else signal?.addEventListener("abort", relayAbort, { once: true });
    let heartbeatStage = "collecting";
    let heartbeatInFlight = false;
    const heartbeatTimer = setInterval(() => {
      if (heartbeatInFlight || leaseController.signal.aborted) return;
      heartbeatInFlight = true;
      void this.options.callbacks.heartbeat(request, heartbeatStage, signal)
        .then((accepted) => {
          if (!accepted) leaseController.abort(new Error("edition_lease_lost"));
        })
        .catch(() => leaseController.abort(new Error("edition_lease_lost")))
        .finally(() => { heartbeatInFlight = false; });
    }, 30_000);
    const leaseSignal = leaseController.signal;
    try {
      await this.requireLease(request, "collecting", leaseSignal);
      const now = this.now();
      const zoned = zonedParts(new Date(request.scheduledFor), request.preferences.timezone);
      const isWeekend = zoned.weekday === "Sat" || zoned.weekday === "Sun";
      const isFirstSessionAfterHoliday = firstSessionAfterHoliday(
        request.session.editionDate,
        request.session.previousSessionDate,
        zoned.weekday,
      );
      const publicationWindowOptions: Parameters<typeof newsPublicationWindow>[1] = {
        isWeekend,
        isFirstSessionAfterHoliday,
      };
      if (
        (isWeekend || isFirstSessionAfterHoliday || zoned.weekday === "Mon")
        && request.session.previousSessionClose !== null
      ) {
        publicationWindowOptions.previousClose = new Date(request.session.previousSessionClose);
      }
      const plan = buildResearchPlan(
        request.preferences,
        this.sourcePolicy,
        newsPublicationWindow(now, publicationWindowOptions),
      );
      const exa = this.options.exaClient(request);
      let evidence = [...await this.options.callbacks.loadEvidence(request, leaseSignal)];
      if (request.retainedEvidenceIds.some((evidenceId) => !evidence.some((item) => item.evidenceId === evidenceId))) {
        throw new Error("evidence_below_minimum");
      }
      if (!evidence.some((item) => item.evidenceId === "exa-collection-complete")) {
        const slots = plan.slots.filter((slot) => slot.policyResolution === undefined);
        const completedSearchSlots = new Set(evidence
          .filter((item) => item.evidenceId.startsWith("exa-search-slot-"))
          .map((item) => item.evidenceId));
        const completedBatches = await Promise.all(slots.map(async (slot) => {
          const markerId = `exa-search-slot-${sha256(`${slot.queryVersion}:${slot.queryId}`).slice(0, 32)}`;
          if (completedSearchSlots.has(markerId)) return null;
          const batch = await exa.searchNews(slot, leaseSignal);
          const checkpoint = [
            ...evidenceFromSearch(batch),
            searchRequestEvidence(slot.queryId, slot.queryVersion, batch),
          ];
          if (!await this.options.callbacks.appendEvidence(request, 100 + slot.slot, checkpoint, leaseSignal)) {
            throw new Error("edition_lease_lost");
          }
          return checkpoint;
        }));
        evidence.push(...completedBatches.flatMap((batch) => batch ?? []));
        const urlPriorities = new Map<string, number>();
        for (const slot of slots) {
          for (const item of evidence) {
            if (!item.url || item.requestId === undefined) continue;
            const marker = evidence.find((candidate) =>
              candidate.evidenceId === `exa-search-slot-${sha256(`${slot.queryVersion}:${slot.queryId}`).slice(0, 32)}`
              && candidate.requestId === item.requestId,
            );
            if (marker === undefined) continue;
            const canonical = canonicalSourceUrl(item.url);
            const priority = contentPriority(canonical, slot.kind, request.preferences.preferredDomains);
            urlPriorities.set(canonical, Math.min(priority, urlPriorities.get(canonical) ?? Number.MAX_SAFE_INTEGER));
          }
        }
        const selectedUrls = [...new Set(evidence.flatMap((item) => item.kind === "news" && item.url ? [canonicalSourceUrl(item.url)] : []))]
          .sort((left, right) => (urlPriorities.get(left) ?? 3) - (urlPriorities.get(right) ?? 3) || left.localeCompare(right))
          .slice(0, request.preferences.contentsPageBudget);
        const completedContentsUrls = new Set(evidence
          .filter((item) => item.evidenceId.startsWith("exa-contents-url-"))
          .map((item) => item.evidenceId));
        const contentCheckpoints = await Promise.all(selectedUrls.map(async (url, index) => {
          const markerId = `exa-contents-url-${sha256(url).slice(0, 32)}`;
          if (completedContentsUrls.has(markerId)) return null;
          const contents = await exa.getSelectedContents([url], {}, leaseSignal);
          const result = contents.results[0] ?? {
            url,
            status: "unavailable" as const,
            highlights: [],
            costUsd: 0,
            retrievedAt: now.toISOString(),
            errorCode: "source_unavailable",
          };
          const checkpoint = contentsCompletionEvidence(result);
          if (!await this.options.callbacks.appendEvidence(request, 1_000 + index, checkpoint, leaseSignal)) {
            throw new Error("edition_lease_lost");
          }
          return checkpoint;
        }));
        evidence.push(...contentCheckpoints.flatMap((checkpoint) => checkpoint ?? []));
        evidence = deduplicateWithAudit(evidence, now.toISOString());
        const collectionComplete = exaCollectionCompleteEvidence(request, now.toISOString());
        if (!await this.options.callbacks.appendEvidence(request, 10_000, [collectionComplete], leaseSignal)) {
          throw new Error("edition_lease_lost");
        }
        evidence.push(collectionComplete);
      }
      heartbeatStage = "calculating";
      await this.requireLease(request, "calculating", leaseSignal);
      let session: SessionStatus | undefined;
      let snapshots: MarketSnapshot[] = [];
      const missingFields: string[] = [];
      const conflicts: MorningPaperEvidenceV1["conflicts"] = [];
      let marketDataAvailable = this.marketData.policyStatus === "approved";
      if (marketDataAvailable) {
        try {
          const providerSession = validateSessionStatus(
            await this.marketData.getSessionStatus(
              request.session.editionDate,
              request.session.timezone,
              leaseSignal,
            ),
            {
              date: request.session.editionDate,
              timezone: request.session.timezone,
            },
          );
          if (
            providerSession.date !== request.session.editionDate
            || providerSession.timezone !== request.session.timezone
            || (request.session.sessionType !== "UNKNOWN" && providerSession.status !== request.session.sessionType)
          ) {
            const conflictEvidence = marketResearchEvidenceItemSchema.parse({
              evidenceId: `session-conflict-${sha256(`${request.editionId}:${providerSession.date}:${providerSession.status}`).slice(0, 32)}`,
              kind: "source_status",
              provider: this.marketData.id,
              sourcePolicy: this.marketData.policyStatus,
              url: canonicalSourceUrl(providerSession.sourceUrl),
              retrievedAt: now.toISOString(),
              freshness: "fresh",
              contentStatus: "available",
              highlights: [],
              normalizedClaims: [`Reviewed calendar session ${request.session.sessionType} conflicts with provider session ${providerSession.status}.`],
              contentHash: sha256(JSON.stringify(providerSession)),
            });
            evidence.push(conflictEvidence);
            conflicts.push({
              conflictId: `session-${sha256(`${request.editionId}:${providerSession.status}`).slice(0, 24)}`,
              field: "market session",
              sourceIds: [conflictEvidence.evidenceId],
              detail: "The reviewed calendar and structured provider disagree. The edition keeps the reviewed calendar and removes market conclusions.",
            });
            marketDataAvailable = false;
          } else {
            session = providerSession;
          }
        } catch (error) {
          const failure = safeFailure(error);
          if (failure.code === "market_data_conflict") {
            missingFields.push("session: conflicting structured provider response");
          }
          marketDataAvailable = false;
        }
      }
      if (marketDataAvailable) {
        try {
          const requestedSymbols = [...new Set([
            ...request.preferences.primarySymbols,
            ...request.preferences.sectorSymbols,
          ])];
          snapshots = validateSnapshots(
            await this.marketData.getSnapshots(requestedSymbols, leaseSignal),
            requestedSymbols,
          );
          for (const snapshot of snapshots) {
            const observations = snapshotEvidence(snapshot);
            evidence.push(...observations);
            if (snapshotHasConflict(snapshot)) {
              conflicts.push({
                conflictId: `quote-${sha256(`${request.editionId}:${snapshot.symbol}`).slice(0, 24)}`,
                field: `${snapshot.symbol} quote`,
                sourceIds: observations.map((item) => item.evidenceId).slice(0, 20),
                detail: "Structured quote fields disagree in symbol, session, or bid/ask ordering. The observations remain visible and confidence must be reduced.",
              });
            }
          }
          const intervalWindows: ReadonlyArray<[MarketBar["interval"], number]> = [
            ["5m", 2], ["15m", 5], ["60m", 30], ["1d", 400], ["1w", 1_825],
          ];
          for (const ticker of requestedSymbols) {
            for (const [interval, days] of intervalWindows) {
              try {
                const bars = validateBars(
                  await this.marketData.getBars(
                    ticker,
                    interval,
                    new Date(now.getTime() - days * 24 * 60 * 60 * 1_000).toISOString(),
                    now.toISOString(),
                    true,
                    leaseSignal,
                  ),
                  { symbol: ticker, interval },
                );
                const barSummary = barSeriesEvidence(ticker, bars, now.toISOString());
                if (barSummary === null) {
                  missingFields.push(`${ticker}: ${interval} bars unavailable`);
                  continue;
                }
                evidence.push(barSummary, ...calculationEvidence(ticker, bars, now.toISOString()));
              } catch {
                missingFields.push(`${ticker}: ${interval} bars unavailable or invalid`);
              }
            }
            try {
              const actions = await this.marketData.getCorporateActions(
                ticker,
                request.session.previousSessionDate === null
                  ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString()
                  : `${request.session.previousSessionDate}T00:00:00.000Z`,
                new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
                leaseSignal,
              );
              evidence.push(...actions
                .filter((action) => action.symbol === ticker && action.provenance.policyStatus === "approved")
                .map(corporateActionEvidence));
            } catch {
              missingFields.push(`${ticker}: corporate actions unavailable`);
            }
          }
          try {
            const movers = await this.marketData.getMarketMovers(leaseSignal);
            const eligibleMovers = movers.filter((mover) => {
              const price = mover.snapshot.price?.value;
              const priorClose = mover.snapshot.priorClose?.value;
              const bid = mover.snapshot.bid?.value;
              const ask = mover.snapshot.ask?.value;
              const volume = mover.snapshot.volume?.value;
              if (
                price === undefined || priorClose === undefined || priorClose < 10
                || Math.abs(price - priorClose) / priorClose < 0.01
                || bid === undefined || ask === undefined || bid <= 0 || ask < bid
                || (ask - bid) / ((ask + bid) / 2) > 0.003
                || mover.catalystSourceIds.length === 0
              ) return false;
              if (volume !== undefined && volume < 50_000) return false;
              if (mover.averageDailyDollarVolume !== undefined && mover.averageDailyDollarVolume.value < 100_000_000) return false;
              if (mover.premarketDollarVolume !== undefined && mover.premarketDollarVolume.value < 1_000_000) return false;
              return true;
            });
            evidence.push(...eligibleMovers.flatMap(moverEvidence));
            if (eligibleMovers.length === 0) missingFields.push("mover scan: no fully verified eligible mover");
          } catch {
            missingFields.push("mover scan: unavailable");
          }
        } catch (error) {
          const failure = safeFailure(error);
          missingFields.push(`structured market snapshots: ${failure.code}`);
          marketDataAvailable = false;
        }
      }
      if (!marketDataAvailable) evidence.push(operationalEvidence(request, now));
      evidence = deduplicateWithAudit(evidence, now.toISOString());
      const requestedSourceStatus = requestedSourceStatusFromEvidence(
        initialRequestedSourceStatus(request.preferences, this.sourcePolicy),
        evidence,
      );
      const actualEvidenceIds = new Set(evidence.map((item) => item.evidenceId));
      const packet = boundedEvidencePacket(morningPaperEvidenceSchema.parse({
        schemaVersion: 1,
        editionId: request.editionId,
        generatedAt: now.toISOString(),
        session: {
          sessionType: session?.status ?? request.session.sessionType,
          editionLabel: !marketDataAvailable
            ? "Data unavailable"
            : request.session.editionLabel,
          editionDate: request.session.editionDate,
          timezone: request.session.timezone,
          configuredLocalTime: request.session.configuredLocalTime,
          marketTime: request.session.marketTime,
          previousSessionDate: request.session.previousSessionDate,
          previousSessionClose: request.session.previousSessionClose,
          nextSessionDate: request.session.nextSessionDate,
          calendarVersion: request.session.calendarVersion,
          sourceIds: request.session.sourceIds,
        },
        primarySymbols: request.preferences.primarySymbols,
        sectorSymbols: request.preferences.sectorSymbols,
        discoverySymbols: request.preferences.discoverySymbols,
        sourcePolicyVersion: this.sourcePolicy.version,
        requestedSourceStatus,
        evidence,
        missingFields: [
          ...missingFields,
          ...(!marketDataAvailable
            ? request.preferences.primarySymbols.map((ticker) => `${ticker}: structured market fields unavailable`)
            : []),
        ].slice(0, 200),
        conflicts,
        allowedSourceIds: [...actualEvidenceIds],
      }));
      for (const [sequence, checkpoint] of evidenceCheckpoints(packet.evidence).entries()) {
        if (!await this.options.callbacks.appendEvidence(request, sequence, checkpoint, leaseSignal)) throw new Error("edition_lease_lost");
      }
      heartbeatStage = "composing";
      await this.requireLease(request, "composing", leaseSignal);
      const edition = marketDataAvailable
        ? await this.options.composer.compose(packet, request.preferences, leaseSignal)
        : operationalEdition(request, packet, now.toISOString());
      const result = marketResearchJobResultSchema.parse({
        schemaVersion: 1,
        dispatchId: request.dispatchId,
        editionId: request.editionId,
        generation: request.generation,
        claimToken: request.claimToken,
        evidence: packet,
        edition,
        deliveries: materializeDeliveryParts(edition),
        exaRequestCount: packet.evidence.filter((item) => item.evidenceId.startsWith("exa-search-slot-")).length,
        exaCostUsd: packet.evidence.reduce((sum, item) => sum + (item.costUsd ?? 0), 0),
        completedAt: this.now().toISOString(),
      });
      if (!await this.options.callbacks.complete(result, leaseSignal)) throw new Error("edition_lease_lost");
      this.options.logger.info("market_research_job_completed", {
        editionId: request.editionId,
        generation: request.generation,
        sourceCount: packet.evidence.length,
        exaRequestCount: result.exaRequestCount,
      });
      return result;
    } catch (error) {
      const failure = safeFailure(error);
      await this.options.callbacks.fail(request, failure.code, failure.retryable, signal).catch(() => undefined);
      throw error;
    } finally {
      clearInterval(heartbeatTimer);
      signal?.removeEventListener("abort", relayAbort);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.options.composer.dispose();
  }

  private async requireLease(request: MarketResearchJobRequest, stage: string, signal?: AbortSignal): Promise<void> {
    if (!await this.options.callbacks.heartbeat(request, stage, signal)) throw new Error("edition_lease_lost");
  }
}

export function createMarketResearchRunner(options: MarketResearchRunnerOptions): MarketResearchRunner {
  return new DefaultMarketResearchRunner(options);
}
