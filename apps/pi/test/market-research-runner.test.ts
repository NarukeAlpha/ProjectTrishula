/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- Synthetic Pi tool contexts never use extension operations. */
import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { validateComposedEdition, type MorningPaperComposer } from "../src/market-research/composer.js";
import {
  marketResearchEvidenceItemSchema, marketResearchJobRequestSchema, marketResearchPreferencesSchema,
  morningPaperEditionSchema, type MarketResearchEvidenceItem, type MarketResearchJobResult,
  type MorningPaperEditionV1, type MorningPaperEvidenceV1,
} from "../src/market-research/contracts.js";
import { materializeDeliveryParts } from "../src/market-research/delivery.js";
import type { MarketResearchCallbacks } from "../src/market-research/convex-client.js";
import { MarketResearchExaClient } from "../src/market-research/exa-client.js";
import { MarketResearchJobRegistry } from "../src/market-research/jobs.js";
import { createMarketResearchRunner, type MarketResearchRunner } from "../src/market-research/runner.js";
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

function fixtureComposer() {
  const compose = vi.fn<MorningPaperComposer["compose"]>(async (evidence, preferences, _signal, research) => {
    const current = research?.getEvidence() ?? evidence;
    return validateComposedEdition(composedEdition(current), current, preferences);
  });
  const composer: MorningPaperComposer = {
    initialize: vi.fn(async () => undefined), readiness: () => ({ ready: true }), compose, dispose: vi.fn(async () => undefined),
  };
  return { composer, compose };
}

function harness(loaded: MarketResearchEvidenceItem[], options: { composer?: MorningPaperComposer; now?: string } = {}) {
  const search = vi.fn(async () => ({
    requestId: "live-search-1", costDollars: { total: 0.01 },
    results: [{ id: "doc-1", title: "Company reports new product", url: "https://example.com/news", publishedDate: "2026-09-01T10:00:00.000Z", highlights: ["A company announced a product."] }],
  }));
  const getContents = vi.fn(async () => ({
    requestId: "live-content-1", costDollars: { total: 0.001 },
    results: [{ url: "https://example.com/news", highlights: ["Product details are available."] }],
  }));
  let completed: MarketResearchJobResult | undefined;
  const callbacks: MarketResearchCallbacks = {
    heartbeat: vi.fn(async () => true), appendEvidence: vi.fn(async () => true),
    loadEvidence: vi.fn(async () => loaded),
    complete: vi.fn(async (result) => { completed = result; return true; }),
    fail: vi.fn(async () => undefined),
  };
  const composer = options.composer ?? fixtureComposer().composer;
  const factory = vi.fn((_request, initialUsage) => new MarketResearchExaClient({
    apiKey: "synthetic-unit-test-key", searchConcurrency: 1, contentsConcurrency: 1,
    requestTimeoutMs: 1_000, maximumSearchRequests: 12, maximumContentPages: 24,
    initialUsage, logger, now: () => new Date(options.now ?? "2026-09-01T12:00:00.000Z"),
    transport: { search, getContents },
  }));
  const runner = createMarketResearchRunner({
    callbacks, composer, exaClient: factory, logger,
    now: () => new Date(options.now ?? "2026-09-01T12:00:00.000Z"),
  });
  return { runner, search, getContents, callbacks, composer, factory, completed: () => completed };
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
    const test = harness([collectionMarker()]);
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

describe("agent-led newspaper research", () => {
  it("continues a long summary in replies instead of rejecting a useful report", async () => {
    const { edition } = await rankedEditionFixture();
    edition.regimeLines = [{ text: "Verified context. ".repeat(100), sourceIds: edition.sourceIds }];
    edition.topStories = [{ text: "Material story. ".repeat(100), sourceIds: edition.sourceIds }];
    const deliveries = materializeDeliveryParts(edition);
    expect(deliveries.every((part) => part.content.length <= 2_000)).toBe(true);
    expect(deliveries.some((part) => part.content.includes("Market summary continued"))).toBe(true);
    expect(deliveries.map((part) => part.content).join("\n")).toContain("Material story.");
    expect(deliveries.map((part) => part.sequence)).toEqual(deliveries.map((_, index) => index));
    expect(new Set(deliveries.map((part) => part.deliveryId)).size).toBe(deliveries.length);
  });

  it("publishes a schema-valid long story bullet across bounded replies", async () => {
    const { edition } = await rankedEditionFixture();
    const text = "Reported market context. ".repeat(80).trim();
    edition.topStories = [{ text, sourceIds: edition.sourceIds }];
    const deliveries = materializeDeliveryParts(morningPaperEditionSchema.parse(edition));
    expect(deliveries.every((part) => part.content.length <= 2_000)).toBe(true);
    expect(deliveries.map((part) => part.content).join("\n")).toContain("Reported market context.");
  });

  it("always invokes the model without a structured provider and preserves frozen identity", async () => {
    const marker = collectionMarker();
    const test = harness([marker]);
    const job = request([marker.evidenceId]);
    const result = await test.runner.run(job);
    expect(test.composer.compose).toHaveBeenCalledOnce();
    expect(test.composer.compose).toHaveBeenCalledWith(expect.anything(), job.preferences, expect.any(AbortSignal), expect.objectContaining({
      tools: expect.arrayContaining([expect.objectContaining({ name: "exa_search" }), expect.objectContaining({ name: "exa_read" }), expect.objectContaining({ name: "request_chart" })]),
    }));
    expect(result.evidence.session).toEqual(job.session);
    expect(result.edition.editionLabel).toBe(job.session.editionLabel);
    expect(test.search).not.toHaveBeenCalled();
    expect(test.callbacks.complete).toHaveBeenCalledOnce();
    await test.runner.dispose();
  });

  it("lets the model search dynamically and checkpoints evidence before publishing", async () => {
    const base = fixtureComposer();
    base.composer.compose = vi.fn<MorningPaperComposer["compose"]>(async (_evidence, preferences, signal, research) => {
      if (!research) throw new Error("Missing tools");
      const tool = research.tools.find((item) => item.name === "exa_search")!;
      // SAFETY: This custom tool only uses its params and cancellation signal, not extension context.
      await tool.execute("tool-1", { query: "AAPL material company news", numResults: 3 }, signal, undefined, {} as ExtensionContext);
      const current = research.getEvidence();
      return validateComposedEdition(composedEdition(current), current, preferences);
    });
    const test = harness([], { composer: base.composer });
    const result = await test.runner.run(request());
    expect(test.search).toHaveBeenCalledOnce();
    expect(result.evidence.evidence.some((item) => item.url === "https://example.com/news")).toBe(true);
    expect(result.evidence.evidence.some((item) => item.evidenceId === "exa-collection-complete")).toBe(true);
    expect(result.exaRequestCount).toBe(1);
    expect(result.exaCostUsd).toBe(0.01);
    expect(test.callbacks.appendEvidence).toHaveBeenCalled();
    expect(test.callbacks.complete).toHaveBeenCalledOnce();
    await test.runner.dispose();
  });

  it("does not force a fixed collection before composing retained partial research", async () => {
    const partial = { ...collectionMarker(), evidenceId: "partial-news", kind: "news" as const, url: "https://example.com/news" };
    const test = harness([partial]);
    const result = await test.runner.run(request([partial.evidenceId]));
    expect(test.composer.compose).toHaveBeenCalledOnce();
    expect(test.search).not.toHaveBeenCalled();
    expect(result.evidence.evidence.map((item) => item.evidenceId)).toContain("exa-collection-complete");
    await test.runner.dispose();
  });

  it("restores durable usage instead of resetting a retry allowance", async () => {
    const marker = collectionMarker();
    const test = harness([marker]);
    const job = request([marker.evidenceId]);
    job.exaUsage = { searchRequests: 12, contentPages: 24, costUsd: 0.1, costStatus: "known" };
    await test.runner.run(job);
    expect(test.factory).toHaveBeenCalledWith(job, job.exaUsage);
    expect(test.search).not.toHaveBeenCalled();
    await test.runner.dispose();
  });

  it("rejects missing retained references before any model or paid request", async () => {
    const test = harness([]);
    await expect(test.runner.run(request(["missing-source"]))).rejects.toThrow("evidence_below_minimum");
    expect(test.composer.compose).not.toHaveBeenCalled();
    expect(test.search).not.toHaveBeenCalled();
    expect(test.callbacks.fail).toHaveBeenCalled();
    await test.runner.dispose();
  });

  it("collapses identical retained IDs but rejects changed content", async () => {
    const marker = collectionMarker();
    const test = harness([marker, marker]);
    expect((await test.runner.run(request([marker.evidenceId]))).evidence.evidence).toHaveLength(1);
    const changed = harness([marker, { ...marker, contentHash: "c".repeat(64) }]);
    await expect(changed.runner.run(request())).rejects.toThrow("composition_schema_invalid");
    await test.runner.dispose(); await changed.runner.dispose();
  });

  it("does not publish after a rejected evidence checkpoint", async () => {
    const partial = { ...collectionMarker(), evidenceId: "partial-news" };
    const test = harness([partial]);
    vi.mocked(test.callbacks.appendEvidence).mockResolvedValue(false);
    await expect(test.runner.run(request([partial.evidenceId]))).rejects.toThrow("edition_lease_lost");
    expect(test.callbacks.complete).not.toHaveBeenCalled();
    expect(test.callbacks.fail).toHaveBeenCalledWith(expect.anything(), "edition_lease_lost", false);
    await test.runner.dispose();
  });

  it("honors cancellation before collection or composition", async () => {
    const test = harness([]);
    const controller = new AbortController();
    controller.abort(new Error("composition_timeout"));
    await expect(test.runner.run(request(), controller.signal)).rejects.toThrow("composition_timeout");
    expect(test.callbacks.fail).toHaveBeenCalledWith(expect.anything(), "composition_timeout", true);
    expect(test.search).not.toHaveBeenCalled();
    expect(test.composer.compose).not.toHaveBeenCalled();
    await test.runner.dispose();
  });

  it("renews the lease during model work and aborts a lost lease", async () => {
    vi.useFakeTimers();
    try {
      const base = fixtureComposer();
      base.composer.compose = vi.fn<MorningPaperComposer["compose"]>(async (_packet, _prefs, signal) => new Promise<MorningPaperEditionV1>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      }));
      const test = harness([collectionMarker()], { composer: base.composer });
      vi.mocked(test.callbacks.heartbeat).mockResolvedValueOnce(true).mockResolvedValue(false);
      const result = test.runner.run(request()).catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(30_001);
      expect(await result).toMatchObject({ message: "edition_lease_lost" });
      expect(test.callbacks.complete).not.toHaveBeenCalled();
      await test.runner.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});

describe("market-research job timeout", () => {
  it("allows agent research and writing beyond ten minutes but stops at the twenty-minute default", async () => {
    vi.useFakeTimers();
    const stuckRunner: MarketResearchRunner = {
      initialize: vi.fn(async () => undefined),
      readiness: () => ({ ready: true }),
      run: vi.fn(async (_job, signal) => new Promise<MarketResearchJobResult>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      })),
      dispose: vi.fn(async () => undefined),
    };
    const registry = new MarketResearchJobRegistry({ runner: stuckRunner, logger });
    const job = request();
    try {
      expect(registry.submit(job).type).toBe("accepted");
      await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);
      expect(registry.get(job.dispatchId, job.ownerId)?.status).toBe("running");
      await vi.advanceTimersByTimeAsync(10 * 60 * 1_000 - 1);
      expect(registry.get(job.dispatchId, job.ownerId)?.status).toBe("running");
      await vi.advanceTimersByTimeAsync(1);
      expect(registry.get(job.dispatchId, job.ownerId)).toMatchObject({
        status: "failed", code: "composition_timeout", retryable: true,
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await registry.dispose();
      vi.useRealTimers();
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
