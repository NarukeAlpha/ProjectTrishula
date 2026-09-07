/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- The test supplies a deliberately partial typed provider double without changing production contracts. */
import { describe, expect, it, vi } from "vitest";
import { validateComposedEdition, type MorningPaperComposer } from "../src/market-research/composer.js";
import {
  marketResearchEvidenceItemSchema,
  marketResearchJobRequestSchema,
  marketResearchPreferencesSchema,
  morningPaperEditionSchema,
  morningPaperEvidenceSchema,
  type MarketResearchEvidenceItem,
  type MarketResearchJobResult,
  type MarketResearchPreferencesV1,
  type MorningPaperEditionV1,
  type MorningPaperEvidenceV1,
} from "../src/market-research/contracts.js";
import { materializeDeliveryParts } from "../src/market-research/delivery.js";
import type { MarketResearchCallbacks } from "../src/market-research/convex-client.js";
import { MarketResearchExaClient } from "../src/market-research/exa-client.js";
import { MarketResearchJobRegistry } from "../src/market-research/jobs.js";
import type {
  MarketBar,
  MarketDataProvider,
  MarketSnapshot,
  MarketValue,
} from "../src/market-research/market-data.js";
import type { ResearchPlanSlot } from "../src/market-research/research-plan.js";
import {
  createMarketResearchRunner,
  type MarketResearchRunner,
  type MarketResearchRunnerOptions,
} from "../src/market-research/runner.js";
import type { Logger } from "../src/runtime/logger.js";

const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function request(
  retainedEvidenceIds: string[] = [],
  overrides: {
    scheduledFor?: string;
    editionDate?: string;
    previousSessionDate?: string | null;
    previousSessionClose?: string | null;
    nextSessionDate?: string | null;
  } = {},
) {
  const scheduledFor = overrides.scheduledFor ?? "2026-09-01T12:00:00.000Z";
  const editionDate = overrides.editionDate ?? "2026-09-01";
  const preferences = marketResearchPreferencesSchema.parse({
    schemaVersion: 1,
    preferenceId: "pref-1",
    scheduleId: "schedule-1",
    ownerId: "owner-1",
    guildId: "guild-1",
    enabled: false,
    forumChannelId: null,
    forumTagIds: [],
    timezone: "America/New_York",
    timezoneConfirmed: false,
    displayTimezones: ["America/New_York", "America/Puerto_Rico"],
    localHour: 8,
    localMinute: 0,
    primarySymbols: ["AAPL", "MSFT", "XOM", "COP", "NVDA", "AMD", "MU", "SPY", "QQQ"],
    symbolPriorities: {},
    sectorSymbols: ["XLE", "XLK", "SMH", "SOXX"],
    discoverySymbols: ["DIA", "IWM"],
    followedSectors: [],
    trackedThemes: [],
    macroTopics: [],
    eventCategories: [],
    preferredDomains: [],
    excludedDomains: [],
    requestedSources: ["FinancialJuice", "Barchart", "ForexFactory", "Yahoo", "TradingView"],
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
    includeCharts: false,
    chartsAcceptancePassed: false,
    maximumCharts: 3,
    lateEditionCutoffLocalTime: "12:00",
    searchRequestBudget: 12,
    contentsPageBudget: 24,
    marketDataProviderId: null,
    marketSessionCalendarId: "nyse",
    durableTheses: [],
    sourcePolicyVersion: "source-policy-v1",
    promptVersion: "morning-paper-v1",
    revision: 0,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
  });
  return marketResearchJobRequestSchema.parse({
    schemaVersion: 1,
    dispatchId: "edition-1:research:1",
    editionId: "edition-1",
    ownerId: "owner-1",
    guildId: "guild-1",
    generation: 1,
    claimToken: "claim-1",
    scheduledFor,
    resumeFrom: "collecting",
    configurationSnapshotHash: "a".repeat(64),
    preferences,
    retainedEvidenceIds,
    session: {
      sessionType: "OPEN",
      editionLabel: "Morning Market Newspaper",
      editionDate,
      timezone: "America/New_York",
      configuredLocalTime: scheduledFor,
      marketTime: scheduledFor,
      previousSessionDate: overrides.previousSessionDate === undefined
        ? "2026-08-31"
        : overrides.previousSessionDate,
      previousSessionClose: overrides.previousSessionClose === undefined
        ? "2026-08-31T20:00:00.000Z"
        : overrides.previousSessionClose,
      nextSessionDate: overrides.nextSessionDate === undefined
        ? "2026-09-02"
        : overrides.nextSessionDate,
      calendarVersion: "nyse-2026-08",
      sourceIds: [],
    },
  });
}

function collectionMarker(): MarketResearchEvidenceItem {
  return marketResearchEvidenceItemSchema.parse({
    evidenceId: "exa-collection-complete",
    kind: "source_status",
    provider: "Project Trishula",
    sourcePolicy: "approved",
    retrievedAt: "2026-09-01T12:00:00.000Z",
    freshness: "fresh",
    contentStatus: "available",
    highlights: [],
    normalizedClaims: ["The bounded Exa Search and Contents collection checkpoint is complete."],
    contentHash: "b".repeat(64),
  });
}

function composedEdition(evidence: MorningPaperEvidenceV1): MorningPaperEditionV1 {
  const sourceId = evidence.allowedSourceIds[0];
  if (sourceId === undefined) throw new Error("Missing fixture evidence.");
  const cited = (text: string) => ({ text, sourceIds: [sourceId] });
  const fixture = cited("Market evidence is available.");
  return {
    schemaVersion: 1,
    editionId: evidence.editionId,
    editionDate: evidence.session.editionDate,
    timezone: evidence.session.timezone,
    asOf: evidence.generatedAt,
    sessionType: evidence.session.sessionType,
    editionLabel: evidence.session.editionLabel,
    regime: "MIXED",
    regimeLines: [fixture, fixture, fixture, fixture, fixture],
    topStories: [fixture, fixture, fixture],
    scheduledEvents: [],
    marketContext: [fixture],
    primaryBoard: [],
    challengers: [],
    tickerDossiers: evidence.primarySymbols.map((symbol) => ({
      symbol,
      thesisLabel: "NO PRIOR THESIS",
      summary: fixture,
      availableFields: [],
      unavailableFields: [],
      sourceIds: [sourceId],
    })),
    validationRules: [fixture],
    afterOpenChanges: [],
    requestedSourceStatus: evidence.requestedSourceStatus,
    dataQuality: [fixture],
    sections: [
      {
        sectionId: "primary-board",
        sequence: 0,
        kind: "primary_board",
        heading: "Primary board",
        markdown: "No qualified setup.",
        sourceIds: [sourceId],
      },
      {
        sectionId: "data-quality",
        sequence: 1,
        kind: "data_quality",
        heading: "Data quality",
        markdown: "Market evidence is available.",
        sourceIds: [sourceId],
      },
      {
        sectionId: "sources",
        sequence: 2,
        kind: "sources",
        heading: "Sources",
        markdown: "Retained evidence.",
        sourceIds: [sourceId],
      },
    ],
    chartRequests: [],
    sourceIds: [sourceId],
    noTradingAction: true,
  };
}

function marketValue(symbol: string, rawField: string, value: number, unit: "USD" | "shares"): MarketValue {
  return {
    provider: "fixture-market-data",
    providerTimestamp: "2026-09-01T11:59:00.000Z",
    retrievedAt: "2026-09-01T12:00:00.000Z",
    sessionLabel: "premarket",
    entitlement: "real_time",
    policyStatus: "approved",
    rawField,
    sourceUrls: ["https://financialdatasets.ai/fixture"],
    providerIdentifiers: ["fixture-run"],
    symbol,
    value,
    unit,
  };
}

function validSnapshots(symbols: readonly string[]): MarketSnapshot[] {
  return symbols.map((symbol) => ({
    symbol,
    price: marketValue(symbol, "price", 100, "USD"),
    priorClose: marketValue(symbol, "prior_close", 99, "USD"),
    volume: marketValue(symbol, "volume", 100_000, "shares"),
  }));
}

function marketBar(symbol: string, interval: MarketBar["interval"], timestamp: string, close: number): MarketBar {
  return {
    provider: "fixture-market-data",
    providerTimestamp: "2026-09-01T12:00:00.000Z",
    retrievedAt: "2026-09-01T12:00:00.000Z",
    sessionLabel: "premarket",
    entitlement: "real_time",
    policyStatus: "approved",
    rawField: "ohlcv",
    sourceUrls: ["https://financialdatasets.ai/fixture"],
    providerIdentifiers: ["fixture-run"],
    symbol,
    timestamp,
    interval,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 1_000,
  };
}

function approvedMarketData(overrides: Partial<MarketDataProvider> = {}): MarketDataProvider {
  return {
    id: "fixture-market-data",
    policyStatus: "approved",
    getSessionStatus: vi.fn(async (date: string, timezone: string) => ({
      date,
      timezone,
      status: "OPEN" as const,
      calendarVersion: "fixture-calendar-v1",
      sourceUrl: "https://www.nyse.com/markets/hours-calendars",
    })),
    getSnapshots: vi.fn(async (symbols: readonly string[]) => validSnapshots(symbols)),
    getBars: vi.fn(async (symbol: string, interval: MarketBar["interval"]) => [
      marketBar(symbol, interval, "2026-09-01T11:55:00.000Z", 100),
    ]),
    getCorporateActions: vi.fn(async () => []),
    getMarketMovers: vi.fn(async () => []),
    ...overrides,
  };
}

function fixtureComposer() {
  const compose = vi.fn(async (
    evidence: MorningPaperEvidenceV1,
    preferences: MarketResearchPreferencesV1,
  ) => validateComposedEdition(composedEdition(evidence), evidence, preferences));
  const composer: MorningPaperComposer = {
    initialize: vi.fn(async () => undefined),
    readiness: () => ({ ready: true }),
    compose,
    dispose: vi.fn(async () => undefined),
  };
  return { composer, compose };
}

function harness(
  loaded: MarketResearchEvidenceItem[],
  options: {
    marketData?: MarketDataProvider;
    composer?: MorningPaperComposer;
    now?: string;
  } = {},
) {
  const searchNews = vi.fn(async (slot: ResearchPlanSlot) => ({
    queryId: slot.queryId,
    requestId: `request-${slot.queryId}`,
    costUsd: 0,
    results: [],
    retrievedAt: "2026-09-01T12:00:00.000Z",
  }));
  const exa = {
    searchNews,
    getSelectedContents: vi.fn(async () => ({ results: [], costUsd: 0 })),
  } as unknown as MarketResearchExaClient;
  let completed: MarketResearchJobResult | undefined;
  const callbacks: MarketResearchCallbacks = {
    heartbeat: vi.fn(async () => true),
    appendEvidence: vi.fn(async () => true),
    loadEvidence: vi.fn(async () => loaded),
    complete: vi.fn(async (result) => { completed = result; return true; }),
    fail: vi.fn(async () => undefined),
  };
  const composer: MorningPaperComposer = options.composer ?? {
    initialize: vi.fn(async () => undefined),
    readiness: () => ({ ready: true }),
    compose: vi.fn(async () => { throw new Error("Composer must not run without market data."); }),
    dispose: vi.fn(async () => undefined),
  };
  const runnerOptions: MarketResearchRunnerOptions = {
    callbacks,
    composer,
    exaClient: () => exa,
    logger,
    now: () => new Date(options.now ?? "2026-09-01T12:00:00.000Z"),
  };
  if (options.marketData !== undefined) runnerOptions.marketData = options.marketData;
  const runner = createMarketResearchRunner(runnerOptions);
  return { runner, searchNews, callbacks, composer, completed: () => completed };
}

type RankedSetup = MorningPaperEditionV1["primaryBoard"][number];

function rankedSetup(symbol: string, label: RankedSetup["label"] = "TOP WATCH"): RankedSetup {
  const cited = { text: "Market evidence is available.", sourceIds: ["exa-collection-complete"] };
  const components = {
    catalyst: label === "TOP WATCH" || label === "EXIT-RISK" ? 20 : label === "WATCH" ? 10 : 0,
    liquidityAndSpread: 15,
    dailyAndHourlyBias: label === "AVOID" ? 5 : 15,
    premarketStructure: 10,
    levelQualityAndProximity: 20,
    indexAndSectorConfirmation: 10,
  };
  return {
    symbol,
    label,
    score: Object.values(components).reduce((total, value) => total + value, 0),
    components,
    deductions: [],
    thesisLabel: label === "EXIT-RISK" ? "AT RISK" : "NO PRIOR THESIS",
    trigger: cited,
    invalidation: cited,
    firstResistanceOrTarget: cited,
    rewardToRisk: cited,
    noChase: cited,
    indexOrSectorCondition: cited,
    eventRisk: cited,
    sourceIds: cited.sourceIds,
  };
}

function rankedChart(symbol = "AAPL"): MorningPaperEditionV1["chartRequests"][number] {
  return {
    chartRequestId: "chart-1",
    editionId: "edition-1",
    sectionId: "primary-board",
    symbol,
    timeframe: "daily",
    start: "2026-08-01T12:00:00.000Z",
    end: "2026-09-01T12:00:00.000Z",
    session: "regular",
    overlays: [],
    annotations: [],
    reason: "Show the qualified setup.",
    priority: 90,
    sourceEvidenceIds: ["exa-collection-complete"],
    dataAsOf: "2026-09-01T12:00:00.000Z",
  };
}

async function rankedEditionFixture() {
  const marker = collectionMarker();
  const test = harness([marker]);
  await test.runner.run(request([marker.evidenceId]));
  const result = test.completed();
  if (!result) throw new Error("Missing completed fixture.");
  return { evidence: result.evidence, edition: composedEdition(result.evidence) };
}

describe("full newspaper ranked output", () => {
  it("accepts a legacy concise job without rewriting its frozen settings or hash", async () => {
    const legacy = request();
    legacy.preferences.editionDepth = "concise";
    const parsed = marketResearchJobRequestSchema.parse(legacy);
    expect(parsed.preferences).toEqual(legacy.preferences);
    expect(parsed.configurationSnapshotHash).toBe(legacy.configurationSnapshotHash);
    const test = harness([]);
    await test.runner.run(parsed);
    expect(test.callbacks.complete).toHaveBeenCalledOnce();
    expect(test.callbacks.fail).not.toHaveBeenCalled();
  });

  it.each(["TOP WATCH", "WATCH"] as const)("accepts charts for %s primary-board setups", async (label) => {
    const { evidence, edition } = await rankedEditionFixture();
    const value = { ...edition, primaryBoard: [rankedSetup("AAPL", label)], chartRequests: [rankedChart()] };
    expect(validateComposedEdition(value, evidence, { ...request().preferences, includeCharts: true })).toEqual(value);
    expect(materializeDeliveryParts(morningPaperEditionSchema.parse(value))[1]?.chartAttachmentIds).toEqual(["chart-1"]);
  });

  it.each(["WAIT FOR CONFIRMATION", "AVOID", "EXIT-RISK"] as const)("rejects charts for %s setups", async (label) => {
    const { edition } = await rankedEditionFixture();
    expect(() => morningPaperEditionSchema.parse({
      ...edition,
      primaryBoard: [rankedSetup("AAPL", label)],
      chartRequests: [rankedChart()],
    })).toThrow("positive ranked setup");
  });

  it.each(["AT RISK", "INVALIDATED"] as const)("rejects charts for a positive score with an %s thesis", async (thesisLabel) => {
    const { edition } = await rankedEditionFixture();
    expect(() => morningPaperEditionSchema.parse({
      ...edition,
      primaryBoard: [{ ...rankedSetup("AAPL"), thesisLabel }],
      chartRequests: [rankedChart()],
    })).toThrow("positive ranked setup");
  });

  it("rejects challenger and context charts unless the symbol has a positive primary-board setup", async () => {
    const { edition } = await rankedEditionFixture();
    for (const symbol of ["DIA", "SPY"]) {
      expect(() => morningPaperEditionSchema.parse({
        ...edition,
        primaryBoard: [rankedSetup("AAPL")],
        challengers: [rankedSetup("DIA")],
        chartRequests: [rankedChart(symbol)],
      })).toThrow("positive ranked setup");
    }
    expect(morningPaperEditionSchema.parse({
      ...edition,
      primaryBoard: [rankedSetup("SPY")],
      chartRequests: [rankedChart("SPY")],
    }).chartRequests).toHaveLength(1);
  });

  it("does not attach an eligible chart to a broad market-context section", async () => {
    const { edition } = await rankedEditionFixture();
    expect(() => morningPaperEditionSchema.parse({
      ...edition,
      primaryBoard: [rankedSetup("AAPL")],
      sections: [
        { sectionId: "context", kind: "index_sector", heading: "Market context", markdown: "Market evidence is available.", sequence: 0, sourceIds: edition.sourceIds },
        ...edition.sections.map((section) => ({ ...section, sequence: section.sequence + 1 })),
      ],
      chartRequests: [{ ...rankedChart(), sectionId: "context" }],
    })).toThrow("positive ranked setup");
  });

  it("accepts ten configured setups and includes all ten in the starter", async () => {
    const { evidence, edition } = await rankedEditionFixture();
    const primarySymbols = [...request().preferences.primarySymbols, "TEST"];
    const value = {
      ...edition,
      primaryBoard: primarySymbols.map((symbol) => rankedSetup(symbol)),
      tickerDossiers: [...edition.tickerDossiers, { ...edition.tickerDossiers[0], symbol: "TEST" }],
    };
    const parsed = validateComposedEdition(value, evidence, { ...request().preferences, primarySymbols });
    expect(parsed.primaryBoard).toHaveLength(10);
    const starter = materializeDeliveryParts(parsed)[0]?.content;
    for (const symbol of primarySymbols) expect(starter).toContain(`- ${symbol}: TOP WATCH`);
    expect(starter?.length).toBeLessThanOrEqual(2_000);
  });

  it("rejects eleven setups, duplicate ranked symbols, and unconfigured watchlist symbols", async () => {
    const { evidence, edition } = await rankedEditionFixture();
    const primaryBoard = [...request().preferences.primarySymbols, "TEST", "OTHER"].map((symbol) => rankedSetup(symbol));
    expect(() => morningPaperEditionSchema.parse({ ...edition, primaryBoard })).toThrow();
    expect(() => morningPaperEditionSchema.parse({ ...edition, primaryBoard: [rankedSetup("AAPL"), rankedSetup("AAPL")] })).toThrow("must be unique");
    expect(() => validateComposedEdition({ ...edition, primaryBoard: [rankedSetup("TEST")] }, evidence, request().preferences)).toThrow("composition_schema_invalid");
  });
});

describe("market-research durable collection recovery", () => {
  it.each([false, true])("keeps duplicate URL audits stable across normalization and recovery (saved collection %s)", async (collectionSaved) => {
    const marker = collectionMarker();
    const articles = ["article-1", "article-2", "article-3", "article-4"].map((evidenceId, index) =>
      marketResearchEvidenceItemSchema.parse({
        evidenceId, kind: "news", provider: "Exa", sourcePolicy: "approved",
        title: "The same syndicated market article",
        url: index === 3 ? "https://syndicated.example.com/story" : "https://example.com/story",
        canonicalUrlHash: (index === 3 ? "e" : "d").repeat(64),
        retrievedAt: "2026-09-01T12:00:00.000Z", freshness: "fresh", contentStatus: "available",
        highlights: ["The same market report appeared in several query results."], normalizedClaims: [],
        contentHash: "c".repeat(64),
      }));
    const loaded = collectionSaved ? [marker, ...articles] : articles;
    const first = harness(loaded);
    await first.runner.run(request(loaded.map((item) => item.evidenceId)));
    const initial = first.completed();
    if (!initial) throw new Error("Missing initial duplicate-normalized result.");
    expect(initial.evidence.evidence.filter((item) => item.kind === "news")).toHaveLength(1);
    const audits = initial.evidence.evidence.filter((item) => item.evidenceId.startsWith("duplicate-url-"));
    expect(audits).toHaveLength(2);
    expect(new Set(initial.evidence.evidence.map((item) => item.evidenceId)).size).toBe(initial.evidence.evidence.length);
    for (const audit of audits) expect(audit.normalizedClaims).toEqual([
      "Duplicate source URL retained for audit; canonical evidence is article-1.",
    ]);
    expect(initial.evidence.session.editionLabel).toBe(request().session.editionLabel);
    expect(initial.edition.editionLabel).toBe("Data unavailable");

    // Convex retains original source rows and the normalized checkpoint. A replay
    // must not create duplicate IDs or start auditing the previous audit records.
    const persisted = [...new Map([...loaded, ...initial.evidence.evidence]
      .map((item) => [item.evidenceId, item])).values()];
    const replay = harness(persisted, { now: "2026-09-01T12:01:00.000Z" });
    const resumed = request(persisted.map((item) => item.evidenceId));
    await replay.runner.run({ ...resumed, generation: 2, dispatchId: "edition-1:research:2", claimToken: "claim-2" });
    const result = replay.completed();
    if (!result) throw new Error("Missing replay duplicate-normalized result.");
    expect(replay.searchNews).not.toHaveBeenCalled();
    expect(result.evidence.evidence.filter((item) => item.evidenceId.startsWith("duplicate-url-"))).toEqual(audits);
    expect(result.evidence.evidence.map((item) => [item.evidenceId, item.contentHash]).sort())
      .toEqual(initial.evidence.evidence.map((item) => [item.evidenceId, item.contentHash]).sort());
    expect(result.evidence.session).toEqual(initial.evidence.session);
    expect(result.edition.editionLabel).toBe("Data unavailable");
  });

  it("preserves frozen calendar references and distinct cost markers even when content hashes match", async () => {
    const marker = collectionMarker();
    const calendar = marketResearchEvidenceItemSchema.parse({
      ...marker, evidenceId: "frozen-calendar", kind: "calendar", provider: "Reviewed calendar",
      url: "https://www.nyse.com/trade/hours-calendars",
    });
    const searchMarkers = [0.01, 0.02].map((costUsd, index) => marketResearchEvidenceItemSchema.parse({
      ...marker, evidenceId: `exa-search-slot-preserved-${index}`, costUsd,
    }));
    const loaded = [marker, calendar, ...searchMarkers];
    const test = harness(loaded);
    const job = request(loaded.map((item) => item.evidenceId));
    await test.runner.run({ ...job, session: { ...job.session, sourceIds: [calendar.evidenceId] } });
    const result = test.completed();
    if (!result) throw new Error("Missing immutable evidence result.");
    for (const item of loaded) expect(result.evidence.evidence).toContainEqual(item);
    expect(result.evidence.session.sourceIds).toEqual([calendar.evidenceId]);
    expect(result.evidence.session.editionLabel).toBe(job.session.editionLabel);
    expect(result.exaRequestCount).toBe(2);
    expect(result.exaCostUsd).toBeCloseTo(0.03);
  });

  it("rejects a reused evidence ID with a different content hash", async () => {
    const marker = collectionMarker();
    const test = harness([marker, { ...marker, contentHash: "c".repeat(64) }]);
    await expect(test.runner.run(request([marker.evidenceId]))).rejects.toThrow("composition_schema_invalid");
    expect(test.callbacks.complete).not.toHaveBeenCalled();
    expect(test.callbacks.fail).toHaveBeenCalledWith(expect.anything(), "composition_schema_invalid", false, undefined);
  });

  it("reuses a complete Exa checkpoint without repeating paid Search calls", async () => {
    const marker = collectionMarker();
    const test = harness([marker]);

    await test.runner.run(request([marker.evidenceId]));

    expect(test.searchNews).not.toHaveBeenCalled();
    expect(test.completed()?.edition.editionLabel).toBe("Data unavailable");
    expect(test.completed()?.evidence.session.editionLabel).toBe(request().session.editionLabel);
    const result = test.completed();
    if (!result) throw new Error("Missing completed result.");
    expect(validateComposedEdition(result.edition, result.evidence, request().preferences)).toEqual(result.edition);
    expect(() => validateComposedEdition({
      ...result.edition,
      topStories: [
        { ...result.edition.topStories[0], text: "Invented price $999.99." },
        ...result.edition.topStories.slice(1),
      ],
    }, result.evidence, request().preferences)).toThrow("composition_schema_invalid");
    expect(() => validateComposedEdition({
      ...result.edition,
      sections: result.edition.sections.map((section, index) => index === 0
        ? { ...section, heading: "Primary board at $999.99" }
        : section),
    }, result.evidence, request().preferences)).toThrow("composition_schema_invalid");
    expect(() => validateComposedEdition({
      ...result.edition,
      sections: result.edition.sections.map((section, index) => index === 0
        ? { ...section, markdown: "Invented published price $999.99." }
        : section),
    }, result.evidence, request().preferences)).toThrow("composition_schema_invalid");
  });

  it("grounds claim and section numbers only in their cited sources", async () => {
    const marker = collectionMarker();
    const test = harness([marker]);

    await test.runner.run(request([marker.evidenceId]));

    const result = test.completed();
    if (!result) throw new Error("Missing completed result.");
    const appleQuote = marketResearchEvidenceItemSchema.parse({
      evidenceId: "quote-aapl-scoped",
      kind: "quote",
      provider: "fixture-market-data",
      sourcePolicy: "approved",
      title: "AAPL quote",
      providerTimestamp: "2026-09-01T11:59:00.000Z",
      retrievedAt: "2026-09-01T12:00:00.000Z",
      sessionLabel: "premarket",
      freshness: "fresh",
      contentStatus: "available",
      highlights: [],
      normalizedClaims: ["AAPL traded at $101.25."],
      contentHash: "d".repeat(64),
    });
    const microsoftQuote = marketResearchEvidenceItemSchema.parse({
      evidenceId: "quote-msft-scoped",
      kind: "quote",
      provider: "fixture-market-data",
      sourcePolicy: "approved",
      title: "MSFT quote",
      providerTimestamp: "2026-09-01T11:59:00.000Z",
      retrievedAt: "2026-09-01T12:00:00.000Z",
      sessionLabel: "premarket",
      freshness: "fresh",
      contentStatus: "available",
      highlights: [],
      normalizedClaims: ["MSFT traded at $202.50."],
      contentHash: "e".repeat(64),
    });
    const scopedEvidence = morningPaperEvidenceSchema.parse({
      ...result.evidence,
      evidence: [...result.evidence.evidence, appleQuote, microsoftQuote],
      allowedSourceIds: [
        ...result.evidence.allowedSourceIds,
        appleQuote.evidenceId,
        microsoftQuote.evidenceId,
      ],
    });
    const scopedEdition: MorningPaperEditionV1 = {
      ...result.edition,
      topStories: [
        { text: "AAPL traded at $101.25.", sourceIds: [appleQuote.evidenceId] },
        { text: "MSFT traded at $202.50.", sourceIds: [microsoftQuote.evidenceId] },
        ...result.edition.topStories.slice(2),
      ],
      sections: result.edition.sections.map((section) => section.kind === "primary_board"
        ? {
            ...section,
            heading: "AAPL primary board at $101.25",
            markdown: "AAPL traded at $101.25.",
            sourceIds: [appleQuote.evidenceId],
          }
        : section),
      sourceIds: [...result.edition.sourceIds, appleQuote.evidenceId, microsoftQuote.evidenceId],
    };
    expect(validateComposedEdition(scopedEdition, scopedEvidence, request().preferences)).toEqual(scopedEdition);

    const firstStory = scopedEdition.topStories[0];
    if (!firstStory) throw new Error("Missing scoped AAPL story.");
    expect(() => validateComposedEdition({
      ...scopedEdition,
      topStories: [
        { ...firstStory, text: "AAPL traded at $202.50." },
        ...scopedEdition.topStories.slice(1),
      ],
    }, scopedEvidence, request().preferences)).toThrow("composition_schema_invalid");
    expect(() => validateComposedEdition({
      ...scopedEdition,
      sections: scopedEdition.sections.map((section) => section.kind === "primary_board"
        ? { ...section, markdown: "AAPL traded at $202.50." }
        : section),
    }, scopedEvidence, request().preferences)).toThrow("composition_schema_invalid");
    expect(() => validateComposedEdition({
      ...scopedEdition,
      topStories: [
        { ...firstStory, text: "AAPL traded at $2026." },
        ...scopedEdition.topStories.slice(1),
      ],
    }, scopedEvidence, request().preferences)).toThrow("composition_schema_invalid");
  });

  it("does not compose from a partial checkpoint without the completion marker", async () => {
    const partial = marketResearchEvidenceItemSchema.parse({
      evidenceId: "partial-search-result",
      kind: "news",
      provider: "Exa",
      sourcePolicy: "approved",
      title: "Partial result",
      url: "https://example.com/partial",
      retrievedAt: "2026-09-01T12:00:00.000Z",
      freshness: "fresh",
      contentStatus: "available",
      highlights: [],
      normalizedClaims: [],
      contentHash: "c".repeat(64),
    });
    const test = harness([partial]);

    await test.runner.run(request([partial.evidenceId]));

    expect(test.searchNews).toHaveBeenCalled();
    expect(test.callbacks.complete).toHaveBeenCalledOnce();
  });
});

describe("market-research production planning", () => {
  it("starts a Monday Search window at the prior confirmed Friday close", async () => {
    const scheduledFor = "2026-09-14T12:00:00.000Z";
    const previousSessionClose = "2026-09-11T20:00:00.000Z";
    const test = harness([], { now: scheduledFor });

    await test.runner.run(request([], {
      scheduledFor,
      editionDate: "2026-09-14",
      previousSessionDate: "2026-09-11",
      previousSessionClose,
      nextSessionDate: "2026-09-15",
    }));

    expect(test.searchNews).toHaveBeenCalled();
    for (const [searchedSlot] of test.searchNews.mock.calls) {
      expect(searchedSlot.startPublishedDate).toBe(previousSessionClose);
      expect(searchedSlot.endPublishedDate).toBe(scheduledFor);
    }
  });

  it("extends the live Search window for the first session after a holiday", async () => {
    const scheduledFor = "2026-09-08T12:00:00.000Z";
    const test = harness([], { now: scheduledFor });

    await test.runner.run(request([], {
      scheduledFor,
      editionDate: "2026-09-08",
      previousSessionDate: "2026-09-04",
      previousSessionClose: "2026-09-04T20:00:00.000Z",
      nextSessionDate: "2026-09-09",
    }));

    expect(test.searchNews).toHaveBeenCalled();
    for (const [searchedSlot] of test.searchNews.mock.calls) {
      expect(searchedSlot.startPublishedDate).toBe("2026-09-04T20:00:00.000Z");
      expect(searchedSlot.endPublishedDate).toBe(scheduledFor);
    }
  });
});

describe("market-research production market-data boundary", () => {
  it("fails closed before composition when the session provenance URL is invalid", async () => {
    const marker = collectionMarker();
    const fixture = fixtureComposer();
    const marketData = approvedMarketData({
      getSessionStatus: vi.fn(async (date: string, timezone: string) => ({
        date,
        timezone,
        status: "OPEN" as const,
        calendarVersion: "fixture-calendar-v1",
        sourceUrl: "http://www.nyse.com/markets/hours-calendars",
      })),
    });
    const test = harness([marker], { marketData, composer: fixture.composer });

    await test.runner.run(request([marker.evidenceId]));

    expect(fixture.compose).not.toHaveBeenCalled();
    expect(test.completed()?.edition.editionLabel).toBe("Data unavailable");
  });

  it("fails closed before composition when a snapshot contains a non-finite value", async () => {
    const marker = collectionMarker();
    const fixture = fixtureComposer();
    const marketData = approvedMarketData({
      getSnapshots: vi.fn(async (symbols: readonly string[]) => {
        const snapshots = validSnapshots(symbols);
        const first = snapshots[0];
        if (first?.price === undefined) throw new Error("Missing fixture snapshot.");
        return [
          { ...first, price: { ...first.price, value: Number.NaN } },
          ...snapshots.slice(1),
        ];
      }),
    });
    const test = harness([marker], { marketData, composer: fixture.composer });

    await test.runner.run(request([marker.evidenceId]));

    expect(fixture.compose).not.toHaveBeenCalled();
    expect(test.completed()?.edition.editionLabel).toBe("Data unavailable");
  });

  it("discards unordered provider bars before evidence and calculations", async () => {
    const marker = collectionMarker();
    const fixture = fixtureComposer();
    const marketData = approvedMarketData({
      getBars: vi.fn(async (symbol: string, interval: MarketBar["interval"]) => [
        marketBar(symbol, interval, "2026-09-01T11:55:00.000Z", 101),
        marketBar(symbol, interval, "2026-09-01T11:50:00.000Z", 100),
      ]),
    });
    const test = harness([marker], { marketData, composer: fixture.composer });

    await test.runner.run(request([marker.evidenceId]));

    expect(fixture.compose).toHaveBeenCalledOnce();
    const evidence = fixture.compose.mock.calls[0]?.[0];
    if (evidence === undefined) throw new Error("Missing composed evidence fixture.");
    expect(evidence.evidence.some((item) => item.kind === "bar" || item.kind === "calculation")).toBe(false);
    expect(evidence.missingFields).toContain("AAPL: 5m bars unavailable or invalid");
    expect(test.completed()?.edition.editionLabel).toBe("Morning Market Newspaper");
  });
});

describe("market-research job timeout", () => {
  it.each(["throw", "reject"] as const)("cancels sibling provider work when an evidence checkpoint fails (%s)", async (outcome) => {
    const firstProvider = Promise.withResolvers<unknown>();
    const secondProvider = Promise.withResolvers<unknown>();
    const search = vi.fn().mockReturnValueOnce(firstProvider.promise).mockReturnValue(secondProvider.promise);
    const getContents = vi.fn();
    const costObserver = vi.fn(async () => undefined);
    const exa = new MarketResearchExaClient({
      apiKey: "sibling-cancellation-test-not-a-real-key",
      transport: { search, getContents },
      searchConcurrency: 1,
      contentsConcurrency: 1,
      requestTimeoutMs: 1_000,
      maximumSearchRequests: 12,
      maximumContentPages: 24,
      onCostEvent: costObserver,
      logger,
    });
    const outerController = new AbortController();
    const appendFailure = new Error("market_research_convex_rejected");
    let checkpointSignal: AbortSignal | undefined;
    let abortedBeforeFailureCallback = false;
    const callbacks: MarketResearchCallbacks = {
      heartbeat: vi.fn(async () => true),
      loadEvidence: vi.fn(async () => []),
      appendEvidence: vi.fn(async (_job, _sequence, _evidence, signal) => {
        checkpointSignal = signal;
        if (outcome === "throw") throw appendFailure;
        return false;
      }),
      complete: vi.fn(async () => true),
      fail: vi.fn(async () => {
        abortedBeforeFailureCallback = checkpointSignal?.aborted === true;
      }),
    };
    const composer = fixtureComposer();
    const runner = createMarketResearchRunner({
      exaClient: () => exa, callbacks, composer: composer.composer, logger,
      now: () => new Date("2026-09-01T12:00:00.000Z"),
    });
    const result = runner.run(request(), outerController.signal).catch((error: Error) => error);
    try {
      await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());
      firstProvider.resolve({ requestId: "first-cost", costDollars: { total: 0.01 }, results: [] });
      const failure = await result;
      if (outcome === "throw") expect(failure).toBe(appendFailure);
      else expect(failure).toMatchObject({ message: "edition_lease_lost" });
      expect(checkpointSignal?.reason).toBe(failure);
      expect(abortedBeforeFailureCallback).toBe(true);
      expect(callbacks.fail).toHaveBeenCalledOnce();
      expect(callbacks.fail).toHaveBeenCalledWith(expect.anything(),
        outcome === "throw" ? "exa_unavailable" : "edition_lease_lost",
        false, outerController.signal);
      // The semaphore can admit the second SDK request before the first checkpoint fails.
      // It must not admit the remaining research slots after the run is cancelled.
      expect(search).toHaveBeenCalledTimes(2);
      expect(search.mock.calls[1]?.[2]?.aborted).toBe(true);
      expect(callbacks.appendEvidence).toHaveBeenCalledOnce();
      secondProvider.resolve({ requestId: "late-cost", costDollars: { total: 0.03 }, results: [] });
      await vi.waitFor(() => expect(costObserver).toHaveBeenCalledWith(expect.objectContaining({
        operation: "search", outcome: "settled", late: true, costUsd: 0.03, requestId: "late-cost",
      })));
      expect(search).toHaveBeenCalledTimes(2);
      expect(callbacks.appendEvidence).toHaveBeenCalledOnce();
      expect(getContents).not.toHaveBeenCalled();
      expect(composer.compose).not.toHaveBeenCalled();
      expect(callbacks.complete).not.toHaveBeenCalled();
      expect(outerController.signal.aborted).toBe(false);
    } finally {
      firstProvider.resolve({ requestId: "cleanup-first", costDollars: { total: 0 }, results: [] });
      secondProvider.resolve({ requestId: "cleanup-second", costDollars: { total: 0 }, results: [] });
      await result;
      await runner.dispose();
    }
  });

  it("aborts a stuck provider job with the fixed retryable timeout state", async () => {
    vi.useFakeTimers();
    const stuckRunner: MarketResearchRunner = {
      initialize: vi.fn(async () => undefined),
      readiness: () => ({ ready: true }),
      run: vi.fn(async (_job, signal) => new Promise<MarketResearchJobResult>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      })),
      dispose: vi.fn(async () => undefined),
    };
    const registry = new MarketResearchJobRegistry({
      runner: stuckRunner,
      logger,
      maxRuntimeMs: 100,
    });
    const submitted = registry.submit(request());
    expect(submitted.type).toBe("accepted");
    await vi.advanceTimersByTimeAsync(101);
    expect(registry.get("edition-1:research:1", request().ownerId)).toMatchObject({
      status: "failed",
      code: "composition_timeout",
      retryable: true,
    });
    await registry.dispose();
    vi.useRealTimers();
  });

  it.each(["exa_connect_zdr_incompatible", "market_session_calendar_stale"] as const)(
    "preserves the canonical terminal %s failure",
    async (code) => {
      const failingRunner: MarketResearchRunner = {
        initialize: vi.fn(async () => undefined),
        readiness: () => ({ ready: true }),
        run: vi.fn(async () => Promise.reject(new Error(code))),
        dispose: vi.fn(async () => undefined),
      };
      const registry = new MarketResearchJobRegistry({ runner: failingRunner, logger });
      const job = request();
      registry.submit(job);
      await vi.waitFor(() => expect(registry.get(job.dispatchId, job.ownerId)).toMatchObject({
        status: "failed",
        code,
        retryable: false,
      }));
      expect(registry.get(job.dispatchId, "other-owner")).toBeUndefined();
      expect(registry.cancel(job.dispatchId, "other-owner")).toBe("not_found");
      await registry.dispose();
    },
  );

  it("keeps an unknown-cost Exa timeout terminal instead of replacing it with a retryable model timeout", async () => {
    vi.useFakeTimers();
    const paidRunner: MarketResearchRunner = {
      initialize: vi.fn(async () => undefined),
      readiness: () => ({ ready: true }),
      run: vi.fn(async (_job, signal) => new Promise<MarketResearchJobResult>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("exa_budget_exhausted")), { once: true });
      })),
      dispose: vi.fn(async () => undefined),
    };
    const registry = new MarketResearchJobRegistry({ runner: paidRunner, logger, maxRuntimeMs: 100 });
    const job = request();
    registry.submit(job);
    await vi.advanceTimersByTimeAsync(101);
    expect(registry.get(job.dispatchId, job.ownerId)).toMatchObject({
      status: "failed",
      code: "exa_budget_exhausted",
      retryable: false,
    });
    await registry.dispose();
    vi.useRealTimers();
  });
});
