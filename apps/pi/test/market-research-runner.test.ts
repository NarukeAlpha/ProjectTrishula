/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- The test supplies a deliberately partial typed provider double without changing production contracts. */
import { describe, expect, it, vi } from "vitest";
import { validateComposedEdition, type MorningPaperComposer } from "../src/market-research/composer.js";
import {
  marketResearchEvidenceItemSchema,
  marketResearchJobRequestSchema,
  marketResearchPreferencesSchema,
  morningPaperEvidenceSchema,
  type MarketResearchEvidenceItem,
  type MarketResearchJobResult,
  type MarketResearchPreferencesV1,
  type MorningPaperEditionV1,
  type MorningPaperEvidenceV1,
} from "../src/market-research/contracts.js";
import type { MarketResearchCallbacks } from "../src/market-research/convex-client.js";
import type { MarketResearchExaClient } from "../src/market-research/exa-client.js";
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
    maximumRankedSetups: 5,
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

describe("market-research durable collection recovery", () => {
  it("reuses a complete Exa checkpoint without repeating paid Search calls", async () => {
    const marker = collectionMarker();
    const test = harness([marker]);

    await test.runner.run(request([marker.evidenceId]));

    expect(test.searchNews).not.toHaveBeenCalled();
    expect(test.completed()?.edition.editionLabel).toBe("Data unavailable");
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
