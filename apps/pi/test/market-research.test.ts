/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- The test narrows fixed literal source fixtures to exercise the strict source contract. */
import { describe, expect, it, vi } from "vitest";
import { AgentRunFailedError } from "exa-js";
import type { Logger } from "../src/runtime/logger.js";
import {
  MARKET_RESEARCH_MAX_CHECKPOINT_BYTES,
  REQUESTED_SOURCES,
  marketResearchEvidenceItemSchema,
  marketResearchFingerprint,
  marketResearchPreferencesSchema,
  type MarketResearchPreferencesV1,
} from "../src/market-research/contracts.js";
import {
  MarketResearchExaClient,
  type ExaSdkTransport,
  type ExaSearchSdkOptions,
} from "../src/market-research/exa-client.js";
import { MarketResearchExaError, classifyExaError } from "../src/market-research/exa-errors.js";
import { buildResearchPlan, newsPublicationWindow } from "../src/market-research/research-plan.js";
import {
  StaticSourcePolicy,
  initialRequestedSourceStatus,
  requestedSourceStatusFromEvidence,
} from "../src/market-research/source-policy.js";
import { canonicalSourceUrl, requirePublicHttpsUrl } from "../src/market-research/source-normalizer.js";
import { boundedEvidencePacket, evidenceCheckpoints } from "../src/market-research/source-normalizer-evidence.js";
import {
  evaluateFinancialDatasets,
  FINANCIAL_DATASET_EVALUATION_SYMBOLS,
  FINANCIAL_DATASET_FIELD_NAMES,
} from "../src/market-research/financial-datasets-evaluation.js";
import {
  averageTrueRange,
  distanceFromLevel,
  rewardToRisk,
  simpleMovingAverage,
  volumeWeightedAveragePrice,
} from "../src/market-research/analytics.js";
import { quoteConflict, validateBars, type MarketBar } from "../src/market-research/market-data.js";
import {
  containsSplitProtectedLink,
  neutralizeUntrustedDiscordMarkdown,
  splitSemanticContent,
} from "../src/market-research/semantic-chunker.js";

const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function preferences(overrides: Partial<MarketResearchPreferencesV1> = {}): MarketResearchPreferencesV1 {
  return marketResearchPreferencesSchema.parse({
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
    discoverySymbols: ["DIA", "IWM", "VST"],
    followedSectors: ["technology", "energy"],
    trackedThemes: ["AI infrastructure"],
    macroTopics: ["rates"],
    eventCategories: ["earnings"],
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
    marketSessionCalendarId: "nyse-2026-v1",
    durableTheses: [],
    sourcePolicyVersion: "source-policy-v1",
    promptVersion: "morning-paper-v1",
    revision: 0,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  });
}

function client(transport: ExaSdkTransport, overrides: Partial<ConstructorParameters<typeof MarketResearchExaClient>[0]> = {}) {
  return new MarketResearchExaClient({
    apiKey: "unit-test-key-that-must-never-appear",
    searchConcurrency: 2,
    contentsConcurrency: 5,
    requestTimeoutMs: 20_000,
    maximumSearchRequests: 12,
    maximumContentPages: 24,
    logger,
    transport,
    sleep: vi.fn().mockResolvedValue(undefined),
    random: () => 0,
    ...overrides,
  });
}

const slot = buildResearchPlan(
  preferences(),
  new StaticSourcePolicy({
    Exa: "approved",
    official: "approved",
    FinancialJuice: "approved",
    Barchart: "approved",
    ForexFactory: "approved",
    Yahoo: "approved",
    TradingView: "approved",
  }),
  { startPublishedDate: "2026-08-31T00:00:00.000Z", endPublishedDate: "2026-09-01T12:00:00.000Z" },
).slots[0];

describe("market research contracts and planning", () => {
  it("rejects unknown fields and unsafe chart enablement", () => {
    expect(() => preferences({ includeCharts: true })).toThrow(/MR-016/);
    expect(() => marketResearchPreferencesSchema.parse({ ...preferences(), unknown: true })).toThrow();
  });

  it("creates stable canonical fingerprints", () => {
    expect(marketResearchFingerprint({ b: 2, a: 1 })).toBe(marketResearchFingerprint({ a: 1, b: 2 }));
  });

  it("creates exactly twelve required slots and covers every primary symbol", () => {
    const plan = buildResearchPlan(preferences(), new StaticSourcePolicy(), {
      startPublishedDate: "2026-08-31T00:00:00.000Z",
      endPublishedDate: "2026-09-01T12:00:00.000Z",
    });
    expect(plan.slots).toHaveLength(12);
    expect(plan.requiredSlotCount).toBe(12);
    expect(plan.providerCallCount).toBe(7);
    const primaryQueries = plan.slots.filter((candidate) => candidate.kind === "primary_board_news").map((candidate) => candidate.query).join(" ");
    for (const ticker of preferences().primarySymbols) expect(primaryQueries).toContain(ticker);
    expect(plan.slots.filter((candidate) => candidate.kind === "requested_source")).toHaveLength(5);
    expect(plan.slots.filter((candidate) => candidate.policyResolution === "unavailable")).toHaveLength(5);
  });

  it("uses the bounded Monday and weekend date window", () => {
    const monday = new Date("2026-08-31T12:00:00.000Z");
    expect(Date.parse(newsPublicationWindow(monday, { isWeekend: false, isFirstSessionAfterHoliday: false }).startPublishedDate)).toBe(
      monday.getTime() - 96 * 60 * 60 * 1_000,
    );
  });
});

describe("official Exa SDK boundary", () => {
  it("sends nested Search contents and top-level Contents fields", async () => {
    const transport: ExaSdkTransport = {
      search: vi.fn().mockResolvedValue({
        requestId: "request-1",
        costDollars: { total: 0.01 },
        results: [{ id: "doc-1", title: "Market story", url: "https://example.com/story", highlights: ["Fact"] }],
      }),
      getContents: vi.fn().mockResolvedValue({
        requestId: "request-2",
        costDollars: { total: 0.01 },
        results: [{ id: "doc-1", title: "Market story", url: "https://example.com/story", highlights: ["Fact"] }],
      }),
    };
    const exa = client(transport);
    if (!slot) throw new Error("Missing plan slot.");
    await exa.searchNews(slot);
    const searchOptions = vi.mocked(transport.search).mock.calls[0]?.[1];
    expect(searchOptions?.contents).toEqual({ highlights: true, maxAgeHours: 1, livecrawlTimeout: 12_000 });
    expect(searchOptions).not.toHaveProperty("highlights");
    await exa.getSelectedContents(["https://example.com/story"]);
    const contentsOptions = vi.mocked(transport.getContents).mock.calls[0]?.[1];
    expect(contentsOptions).toHaveProperty("highlights.query");
    expect(contentsOptions).toHaveProperty("maxAgeHours", 1);
    expect(contentsOptions).not.toHaveProperty("contents");
  });

  it("does not retry authentication or budget errors", async () => {
    for (const statusCode of [401, 402]) {
      const search = vi.fn().mockRejectedValue({ statusCode });
      const exa = client({ search, getContents: vi.fn() });
      if (!slot) throw new Error("Missing plan slot.");
      await expect(exa.searchNews(slot)).rejects.toBeInstanceOf(MarketResearchExaError);
      expect(search).toHaveBeenCalledOnce();
    }
  });

  it("preserves successful Contents URLs when another URL fails", async () => {
    const getContents = vi.fn(async (url: string | string[]) => {
      if (url === "https://blocked.example/story") throw { statusCode: 403, code: "ROBOTS_FILTER_FAILED" };
      return { requestId: "ok", results: [{ id: "ok", title: "OK", url, highlights: ["usable"] }] };
    });
    const exa = client({ search: vi.fn(), getContents });
    const result = await exa.getSelectedContents([
      "https://good.example/story",
      "https://blocked.example/story",
    ]);
    expect(result.results.map((entry) => entry.status)).toEqual(["available", "blocked"]);
    expect(getContents).toHaveBeenCalledTimes(2);
  });

  it("discards Search results that violate the frozen slot domain policy", async () => {
    const search = vi.fn().mockResolvedValue({
      requestId: "domain-policy-request",
      results: [
        { id: "allowed", title: "Allowed", url: "https://news.allowed.example/story", highlights: ["Fact"] },
        { id: "excluded", title: "Excluded", url: "https://blocked.allowed.example/story", highlights: ["Fact"] },
        { id: "outside", title: "Outside", url: "https://outside.example/story", highlights: ["Fact"] },
      ],
    });
    const exa = client({ search, getContents: vi.fn() });
    if (!slot) throw new Error("Missing plan slot.");
    const result = await exa.searchNews({
      ...slot,
      includeDomains: ["allowed.example"],
      excludeDomains: ["blocked.allowed.example"],
    });
    expect(result.results.map((item) => item.exaDocumentId)).toEqual(["allowed"]);
  });

  it("normalizes explicit Contents statuses without treating failures or new values as available", async () => {
    const statuses = ["available", "cached", "delayed", "stale", "unknown", "blocked", "unavailable", "failed", "provider-new-status"] as const;
    const getContents = vi.fn(async (url: string | string[]) => ({
      requestId: `request-${String(url)}`,
      results: [{ id: "doc", title: "Bounded content", url, highlights: ["usable"], status: statuses[getContents.mock.calls.length - 1] }],
    }));
    const exa = client({ search: vi.fn(), getContents });
    const result = await exa.getSelectedContents(statuses.map((status) => `https://${status}.example/story`));
    expect(result.results.map((entry) => entry.status)).toEqual([
      "available", "cached", "delayed", "stale", "unknown", "blocked", "unavailable", "unavailable", "unknown",
    ]);
  });

  it("serializes provider calls when a hard edition cost cap is configured", async () => {
    const first = Promise.withResolvers<unknown>();
    const search = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ requestId: "second", costDollars: { total: 0 }, results: [] });
    const exa = client({ search, getContents: vi.fn() }, { maximumCostUsd: 1 });
    if (!slot) throw new Error("Missing plan slot.");
    const firstCall = exa.searchNews(slot);
    const secondCall = exa.searchNews({ ...slot, queryId: "second-slot" });
    const secondResult = secondCall.catch((error: Error) => error);
    await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());
    first.resolve({ requestId: "first", costDollars: { total: 1 }, results: [] });
    await firstCall;
    expect(await secondResult).toMatchObject({ message: "exa_budget_exhausted" });
    expect(search).toHaveBeenCalledOnce();
  });

  it.each([undefined, -1, Number.NaN, "0.01"])("closes the optional budget when returned cost is %s", async (total) => {
    const search = vi.fn().mockResolvedValue({ requestId: "unknown-cost", costDollars: { total }, results: [] });
    const exa = client({ search, getContents: vi.fn() }, { maximumCostUsd: 1 });
    if (!slot) throw new Error("Missing plan slot.");
    await exa.searchNews(slot);
    await expect(exa.searchNews(slot)).rejects.toMatchObject({ message: "exa_budget_exhausted" });
    expect(exa.usage()).toMatchObject({ costUsd: 0, costStatus: "unknown", budgetClosed: true });
    expect(exa.costLedger()).toMatchObject([{ operation: "search", outcome: "settled", costUsd: null, late: false }]);
    expect(search).toHaveBeenCalledOnce();
  });

  it("accounts for Financial Datasets cost before releasing the cost permit", async () => {
    const runFinancialDataset = vi.fn().mockResolvedValue({ costDollars: { total: 1 }, output: {} });
    const exa = client({ search: vi.fn(), getContents: vi.fn(), runFinancialDataset }, { maximumCostUsd: 1 });
    const request = { evaluationId: "evaluation-cost", query: "bounded evaluation", outputSchema: {}, maxCostDollars: 1 };
    await exa.runFinancialDatasetEvaluation(request);
    await expect(exa.runFinancialDatasetEvaluation(request)).rejects.toMatchObject({ message: "exa_budget_exhausted" });
    expect(exa.usage().costUsd).toBe(1);
    expect(runFinancialDataset).toHaveBeenCalledOnce();
  });

  it("retains Financial Datasets permits and records late costs without retrying abandoned work", async () => {
    const provider = Promise.withResolvers<unknown>();
    const runFinancialDataset = vi.fn().mockReturnValue(provider.promise);
    const onCostEvent = vi.fn().mockResolvedValue(undefined);
    const exa = client({ search: vi.fn(), getContents: vi.fn(), runFinancialDataset }, { maximumCostUsd: 1, onCostEvent });
    const controller = new AbortController();
    const request = { evaluationId: "evaluation-late", query: "bounded evaluation", outputSchema: {}, maxCostDollars: 1 };
    const firstResult = exa.runFinancialDatasetEvaluation(request, controller.signal).catch((error: Error) => error);
    await vi.waitFor(() => expect(runFinancialDataset).toHaveBeenCalledOnce());
    controller.abort(new Error("edition_lease_lost"));
    expect(await firstResult).toMatchObject({ decision: { code: "exa_budget_exhausted", retryable: false } });
    await expect(exa.runFinancialDatasetEvaluation(request)).rejects.toThrow("exa_budget_exhausted");
    provider.resolve({ requestId: "late-evaluation", costDollars: { total: 0.25 }, privateResponse: "not-in-ledger" });
    await vi.waitFor(() => expect(exa.usage().costUsd).toBe(0.25));
    expect(exa.costLedger()).toMatchObject([
      { operation: "financial_datasets", outcome: "abandoned", costUsd: null },
      { operation: "financial_datasets", outcome: "settled", costUsd: 0.25, late: true, requestId: "late-evaluation" },
    ]);
    await vi.waitFor(() => expect(onCostEvent).toHaveBeenCalledTimes(2));
    expect(JSON.stringify(exa.costLedger())).not.toContain("not-in-ledger");
    expect(runFinancialDataset).toHaveBeenCalledOnce();
  });

  it("preserves classified errors and ZDR tags through Financial Datasets evaluation", async () => {
    const failure = new MarketResearchExaError({
      code: "exa_invalid_request", retryable: false, maximumRetries: 0, scope: "capability",
      finalForSource: true, tag: "ZDR_INCOMPATIBLE",
    });
    expect(classifyExaError(failure)).toBe(failure.decision);
    const runFinancialDataset = vi.fn().mockRejectedValue(failure);
    const exa = client({ search: vi.fn(), getContents: vi.fn(), runFinancialDataset });
    await expect(exa.runFinancialDatasetEvaluation({
      evaluationId: "evaluation-zdr", query: "bounded evaluation", outputSchema: {}, maxCostDollars: 1,
    })).rejects.toThrow("exa_connect_zdr_incompatible");
    expect(runFinancialDataset).toHaveBeenCalledOnce();
  });

  it("records a failed agent run charge after the caller has timed out", async () => {
    const provider = Promise.withResolvers<unknown>();
    const runFinancialDataset = vi.fn().mockReturnValue(provider.promise);
    const exa = client({ search: vi.fn(), getContents: vi.fn(), runFinancialDataset }, { requestTimeoutMs: 20 });
    const request = { evaluationId: "failed-late", query: "bounded evaluation", outputSchema: {}, maxCostDollars: 1 };
    await expect(exa.runFinancialDatasetEvaluation(request)).rejects.toThrow("exa_budget_exhausted");
    provider.reject(new AgentRunFailedError({ id: "failed-run", status: "failed", costDollars: { total: 0.25 } }));
    await vi.waitFor(() => expect(exa.costLedger()).toContainEqual(expect.objectContaining({
      operation: "financial_datasets", outcome: "failed", costUsd: 0.25, late: true, requestId: "failed-run",
    })));
    expect(exa.usage().costUsd).toBe(0.25);
    expect(runFinancialDataset).toHaveBeenCalledOnce();
  });

  it("keeps Contents paid work occupied until a late response settles", async () => {
    const provider = Promise.withResolvers<unknown>();
    const getContents = vi.fn().mockReturnValue(provider.promise);
    const exa = client({ search: vi.fn(), getContents }, { contentsConcurrency: 1, maximumCostUsd: 1 });
    const controller = new AbortController();
    const pendingResult = exa.getSelectedContents(["https://example.com/one", "https://example.com/two"], {}, controller.signal)
      .catch((error: Error) => error);
    await vi.waitFor(() => expect(getContents).toHaveBeenCalledOnce());
    controller.abort(new Error("edition_lease_lost"));
    expect(await pendingResult).toMatchObject({ message: "exa_budget_exhausted" });
    provider.resolve({ requestId: "late-contents", costDollars: { total: 0.25 }, results: [] });
    await vi.waitFor(() => expect(exa.usage().costUsd).toBe(0.25));
    expect(exa.costLedger()).toContainEqual(expect.objectContaining({ operation: "contents", late: true, costUsd: 0.25 }));
    expect(getContents).toHaveBeenCalledOnce();
  });

  it("honors retry-after and uses bounded retries", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const search = vi.fn()
      .mockRejectedValueOnce({ statusCode: 429, retryAfterMs: 2_500 })
      .mockResolvedValue({ requestId: "ok", results: [] });
    const exa = client({ search, getContents: vi.fn() }, { sleep });
    if (!slot) throw new Error("Missing plan slot.");
    await exa.searchNews(slot);
    expect(sleep).toHaveBeenCalledWith(2_500, undefined);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("uses bounded jittered retries for provider 5xx failures", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const search = vi.fn().mockRejectedValue({ statusCode: 503 });
    const exa = client({ search, getContents: vi.fn() }, { sleep, random: () => 0 });
    if (!slot) throw new Error("Missing plan slot.");
    await expect(exa.searchNews(slot)).rejects.toMatchObject({ message: "exa_unavailable" });
    expect(search).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([375, 750, 1_500]);
  });

  it("passes cancellation into the transport and stops the in-flight request", async () => {
    const search = vi.fn((_query: string, _options: ExaSearchSdkOptions, signal?: AbortSignal) =>
      new Promise((resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        void resolve;
      }));
    const exa = client({ search, getContents: vi.fn() });
    const controller = new AbortController();
    if (!slot) throw new Error("Missing plan slot.");
    const pending = exa.searchNews(slot, controller.signal);
    await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());
    controller.abort(new Error("edition_lease_lost"));
    await expect(pending).rejects.toMatchObject({ message: "exa_budget_exhausted" });
    expect(search.mock.calls[0]?.[2]?.aborted).toBe(true);
  });

  it("does not start provider work when the lease signal is already aborted", async () => {
    const search = vi.fn();
    const exa = client({ search, getContents: vi.fn() });
    const controller = new AbortController();
    controller.abort(new Error("edition_lease_lost"));
    if (!slot) throw new Error("Missing plan slot.");
    await expect(exa.searchNews(slot, controller.signal)).rejects.toThrow("edition_lease_lost");
    expect(search).not.toHaveBeenCalled();
  });

  it("removes aborted work from the concurrency queue before it reaches the provider", async () => {
    const first = Promise.withResolvers<unknown>();
    const search = vi.fn().mockImplementationOnce(() => first.promise);
    const exa = client({ search, getContents: vi.fn() }, { searchConcurrency: 1 });
    const controller = new AbortController();
    if (!slot) throw new Error("Missing plan slot.");
    const active = exa.searchNews(slot);
    const queued = exa.searchNews({ ...slot, queryId: "queued-slot" }, controller.signal);
    await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());
    controller.abort(new Error("edition_lease_lost"));
    await expect(queued).rejects.toThrow("edition_lease_lost");
    first.resolve({ requestId: "active", results: [] });
    await active;
    expect(search).toHaveBeenCalledOnce();
    expect(exa.usage().searchRequests).toBe(1);
  });

  it("removes aborted work from the serialized cost queue before it reaches the provider", async () => {
    const first = Promise.withResolvers<unknown>();
    const search = vi.fn().mockImplementationOnce(() => first.promise);
    const exa = client({ search, getContents: vi.fn() }, { maximumCostUsd: 100 });
    const controller = new AbortController();
    if (!slot) throw new Error("Missing plan slot.");
    const active = exa.searchNews(slot);
    const queued = exa.searchNews({ ...slot, queryId: "cost-queued-slot" }, controller.signal);
    await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());
    controller.abort(new Error("edition_lease_lost"));
    await expect(queued).rejects.toThrow("edition_lease_lost");
    first.resolve({ requestId: "active", costDollars: { total: 0.01 }, results: [] });
    await active;
    expect(search).toHaveBeenCalledOnce();
  });

  it("abandons a non-cooperative SDK request when its lease is lost", async () => {
    const provider = Promise.withResolvers<unknown>();
    const search = vi.fn().mockReturnValue(provider.promise);
    const exa = client({ search, getContents: vi.fn() });
    const controller = new AbortController();
    if (!slot) throw new Error("Missing plan slot.");
    const pending = exa.searchNews(slot, controller.signal);
    await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());
    controller.abort(new Error("edition_lease_lost"));
    await expect(pending).rejects.toMatchObject({ message: "exa_budget_exhausted" });
    provider.resolve({ requestId: "late-sdk-result", results: [] });
  });

  it("consumes a late non-cooperative SDK rejection after closing the budget", async () => {
    const provider = Promise.withResolvers<unknown>();
    const search = vi.fn().mockReturnValue(provider.promise);
    const exa = client({ search, getContents: vi.fn() });
    const controller = new AbortController();
    if (!slot) throw new Error("Missing plan slot.");
    const pending = exa.searchNews(slot, controller.signal);
    const pendingResult = pending.catch((error: Error) => error);
    await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());
    controller.abort(new Error("edition_lease_lost"));
    expect(await pendingResult).toMatchObject({ message: "exa_budget_exhausted" });
    provider.reject(new Error("late-provider-failure"));
    await Promise.resolve();
    await Promise.resolve();
    expect(exa.usage()).toMatchObject({ costStatus: "unknown", budgetClosed: true });
    await vi.waitFor(() => expect(exa.costLedger()).toContainEqual(expect.objectContaining({
      operation: "search", outcome: "failed", costUsd: null, late: true,
    })));
  });

  it("closes the paid-work budget and retains permits after a non-cooperative timeout", async () => {
    const provider = Promise.withResolvers<unknown>();
    const search = vi.fn().mockReturnValue(provider.promise);
    const exa = client(
      { search, getContents: vi.fn() },
      { maximumCostUsd: 100, requestTimeoutMs: 20, searchConcurrency: 1 },
    );
    if (!slot) throw new Error("Missing plan slot.");
    const timedOut = exa.searchNews(slot);
    const timedOutResult = timedOut.catch((error: Error) => error);
    await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());
    const queued = exa.searchNews({ ...slot, queryId: "must-not-start-after-timeout" });
    const queuedResult = queued.catch((error: Error) => error);
    const [timedOutError, queuedError] = await Promise.all([timedOutResult, queuedResult]);
    expect(timedOutError).toBeInstanceOf(MarketResearchExaError);
    expect(queuedError).toBeInstanceOf(MarketResearchExaError);
    expect(search).toHaveBeenCalledOnce();
    expect(exa.usage()).toMatchObject({
      searchRequests: 1,
      costUsd: 0,
      costStatus: "unknown",
      budgetClosed: true,
    });
    provider.resolve({ requestId: "late-sdk-result", costDollars: { total: 0.25 }, results: [] });
    await vi.waitFor(() => expect(exa.usage().costUsd).toBe(0.25));
    await expect(exa.searchNews({ ...slot, queryId: "still-closed" })).rejects.toMatchObject({
      message: "exa_budget_exhausted",
    });
    expect(search).toHaveBeenCalledOnce();
  });

  it("rejects untitled and promotional Search results before persistence", async () => {
    const exa = client({
      search: vi.fn().mockResolvedValue({
        requestId: "request-filtered",
        results: [
          { id: "missing-title", url: "https://example.com/a" },
          { id: "promotion", title: "Sponsored content: stock promotion", url: "https://example.com/b" },
          { id: "material", title: "Official market update", url: "https://example.com/c", highlights: ["Material fact"] },
        ],
      }),
      getContents: vi.fn(),
    });
    if (!slot) throw new Error("Missing plan slot.");
    const result = await exa.searchNews(slot);
    expect(result.results.map((item) => item.title)).toEqual(["Official market update"]);
  });

  it("maps Exa capability and URL failures distinctly", () => {
    expect(classifyExaError({ statusCode: 403, code: "ACCESS_DENIED" }).scope).toBe("capability");
    expect(classifyExaError({ statusCode: 403, code: "SOURCE_NOT_AVAILABLE" }).scope).toBe("url");
    expect(classifyExaError({ statusCode: 403, code: "ROBOTS_FILTER_FAILED" }).scope).toBe("batch");
    expect(classifyExaError({ statusCode: 422, code: "FETCH_DOCUMENT_ERROR" }).scope).toBe("url");
  });

  it("never includes the key in thrown errors", async () => {
    const key = "unit-test-key-that-must-never-appear";
    const exa = client({ search: vi.fn().mockRejectedValue(new Error(key)), getContents: vi.fn() });
    if (!slot) throw new Error("Missing plan slot.");
    let message = "";
    try { await exa.searchNews(slot); } catch (error) { message = String(error); }
    expect(message).not.toContain(key);
  });
});

describe("evidence and deterministic analytics", () => {
  it("rejects private and credential-bearing URLs and canonicalizes tracking variants", () => {
    expect(() => requirePublicHttpsUrl("https://127.0.0.1/private")).toThrow();
    expect(() => requirePublicHttpsUrl("https://[::1]/private")).toThrow();
    expect(() => requirePublicHttpsUrl("https://[::ffff:127.0.0.1]/private")).toThrow();
    expect(() => requirePublicHttpsUrl("https://[::ffff:192.168.1.1]/private")).toThrow();
    expect(() => requirePublicHttpsUrl("https://[ff02::1]/multicast")).toThrow();
    expect(() => requirePublicHttpsUrl("https://[2001:db8::1]/documentation")).toThrow();
    expect(() => requirePublicHttpsUrl("https://[2001:2::1]/benchmark")).toThrow();
    expect(requirePublicHttpsUrl("https://[2606:4700:4700::1111]/public").hostname).toBe("[2606:4700:4700::1111]");
    expect(() => requirePublicHttpsUrl("https://user:pass@example.com/private")).toThrow();
    expect(canonicalSourceUrl("https://EXAMPLE.com/story/?utm_source=x&a=1#top")).toBe("https://example.com/story?a=1");
  });

  it("uses the same strict public URL boundary in the persisted evidence contract", () => {
    const evidence = {
      evidenceId: "source-url-test",
      kind: "news" as const,
      provider: "Exa",
      sourcePolicy: "approved" as const,
      retrievedAt: "2026-09-01T12:00:00.000Z",
      freshness: "fresh" as const,
      contentStatus: "available" as const,
      highlights: [],
      normalizedClaims: [],
      contentHash: "f".repeat(64),
    };
    for (const url of [
      "https://[::ffff:127.0.0.1]/private",
      "https://[ff02::1]/multicast",
      "https://[2001:2::1]/benchmark",
      "https://provider.internal/story",
    ]) {
      expect(marketResearchEvidenceItemSchema.safeParse({ ...evidence, url }).success).toBe(false);
    }
    expect(marketResearchEvidenceItemSchema.safeParse({
      ...evidence,
      url: "https://example.com/story",
    }).success).toBe(true);
  });

  it("splits checkpoint records below the Convex bound", () => {
    const baseEvidence = {
      evidenceId: "evidence-1",
      kind: "news" as const,
      provider: "Exa",
      sourcePolicy: "approved" as const,
      retrievedAt: "2026-09-01T12:00:00.000Z",
      freshness: "fresh" as const,
      contentStatus: "available" as const,
      highlights: ["x".repeat(1_000)],
      normalizedClaims: [],
      contentHash: "a".repeat(64),
    };
    const records = Array.from({ length: 100 }, (_, index) => ({ ...baseEvidence, evidenceId: `evidence-${index}` }));
    const checkpoints = evidenceCheckpoints(records);
    expect(checkpoints.length).toBeGreaterThan(1);
    for (const checkpoint of checkpoints) expect(Buffer.byteLength(JSON.stringify(checkpoint))).toBeLessThanOrEqual(MARKET_RESEARCH_MAX_CHECKPOINT_BYTES);
  });

  it("reconciles every source reference after optional evidence is trimmed", () => {
    const evidence = Array.from({ length: 180 }, (_, index) => ({
      evidenceId: `evidence-${index}`,
      kind: "news" as const,
      provider: "Exa",
      sourcePolicy: "approved" as const,
      retrievedAt: "2026-09-01T12:00:00.000Z",
      freshness: "fresh" as const,
      contentStatus: "available" as const,
      highlights: [`${index}-${"x".repeat(1_950)}`],
      normalizedClaims: [],
      contentHash: index.toString(16).padStart(64, "0"),
    }));
    const lastId = evidence.at(-1)?.evidenceId;
    if (!lastId) throw new Error("Missing fixture evidence.");
    const packet = boundedEvidencePacket({
      schemaVersion: 1,
      editionId: "edition-1",
      generatedAt: "2026-09-01T12:00:00.000Z",
      session: {
        sessionType: "OPEN",
        editionLabel: "Morning Market Newspaper",
        editionDate: "2026-09-01",
        timezone: "America/New_York",
        configuredLocalTime: "2026-09-01T12:00:00.000Z",
        marketTime: "2026-09-01T12:00:00.000Z",
        previousSessionDate: "2026-08-31",
        previousSessionClose: "2026-08-31T20:00:00.000Z",
        nextSessionDate: "2026-09-02",
        calendarVersion: "nyse-v1",
        sourceIds: [lastId],
      },
      primarySymbols: ["AAPL"],
      sectorSymbols: [],
      discoverySymbols: [],
      sourcePolicyVersion: "source-policy-v1",
      requestedSourceStatus: REQUESTED_SOURCES.map((source) => ({
        source,
        status: "contributed" as const,
        detail: "Fixture contribution.",
        sourceIds: [lastId],
      })),
      evidence,
      missingFields: [],
      conflicts: [{ conflictId: "conflict-1", field: "price", sourceIds: [lastId], detail: "Fixture conflict." }],
      allowedSourceIds: evidence.map((item) => item.evidenceId),
    });
    const retained = new Set(packet.evidence.map((item) => item.evidenceId));
    expect(packet.session.sourceIds.every((sourceId) => retained.has(sourceId))).toBe(true);
    expect(packet.requestedSourceStatus.flatMap((status) => status.sourceIds).every((sourceId) => retained.has(sourceId))).toBe(true);
    expect(packet.conflicts.flatMap((conflict) => conflict.sourceIds).every((sourceId) => retained.has(sourceId))).toBe(true);
  });

  it("marks an approved requested source contributed from its durable slot marker", () => {
    const initial = initialRequestedSourceStatus(
      preferences(),
      new StaticSourcePolicy({ FinancialJuice: "approved" }),
    );
    const marker = marketResearchEvidenceItemSchema.parse({
      evidenceId: "exa-search-slot-financialjuice",
      kind: "source_status",
      provider: "Exa",
      sourcePolicy: "approved",
      retrievedAt: "2026-09-01T12:00:00.000Z",
      freshness: "fresh",
      contentStatus: "available",
      highlights: [],
      normalizedClaims: ["Exa Search slot requested_source_financialjuice completed with 1 retained result(s)."],
      requestId: "request-financialjuice",
      contentHash: "d".repeat(64),
    });
    const story = marketResearchEvidenceItemSchema.parse({
      evidenceId: "financialjuice-story",
      kind: "news",
      provider: "Exa",
      sourcePolicy: "approved",
      title: "Material market item",
      url: "https://financialjuice.com/story",
      retrievedAt: "2026-09-01T12:00:00.000Z",
      freshness: "fresh",
      contentStatus: "available",
      highlights: ["Material evidence"],
      normalizedClaims: [],
      requestId: "request-financialjuice",
      contentHash: "e".repeat(64),
    });
    expect(requestedSourceStatusFromEvidence(initial, [marker, story]).find((item) => item.source === "FinancialJuice"))
      .toMatchObject({ status: "contributed", sourceIds: ["financialjuice-story"] });
  });

  it("reproduces VWAP, SMA, ATR, level distance, and reward-to-risk", () => {
    const bars: MarketBar[] = Array.from({ length: 21 }, (_, index) => ({
      provider: "fixture",
      providerTimestamp: new Date(Date.UTC(2026, 7, index + 1)).toISOString(),
      retrievedAt: "2026-09-01T12:00:00.000Z",
      sessionLabel: "regular",
      entitlement: "real_time",
      policyStatus: "approved",
      rawField: "ohlcv",
      symbol: "AAPL",
      timestamp: new Date(Date.UTC(2026, 7, index + 1)).toISOString(),
      interval: "1d",
      open: 100 + index,
      high: 102 + index,
      low: 99 + index,
      close: 101 + index,
      volume: 1_000,
    }));
    expect(simpleMovingAverage(bars, 20)?.value).toBe(111.5);
    expect(volumeWeightedAveragePrice(bars)?.value).toBeCloseTo(110.666667, 5);
    expect(averageTrueRange(bars, 14)?.value).toBe(3);
    expect(distanceFromLevel(100.4, 100, 2).value.near).toBe(true);
    expect(rewardToRisk(100, 98, 106)).toBe(3);
    expect(volumeWeightedAveragePrice(bars.map((bar) => {
      const { volume: _volume, ...withoutVolume } = bar;
      return withoutVolume;
    }))).toBeNull();
    expect(() => validateBars([bars[1]!, bars[0]!], { symbol: "AAPL", interval: "1d" })).toThrow("market_data_conflict");
    expect(() => validateBars([{ ...bars[0]!, volume: -1 }], { symbol: "AAPL", interval: "1d" })).toThrow("market_data_conflict");
    expect(() => validateBars([bars[0]!], { symbol: "AAPL", interval: "1d", allowedSessions: ["premarket"] })).toThrow("market_data_conflict");
    const observation = {
      provider: "fixture",
      providerTimestamp: "2026-09-01T12:00:00.000Z",
      retrievedAt: "2026-09-01T12:00:01.000Z",
      sessionLabel: "premarket" as const,
      entitlement: "real_time" as const,
      policyStatus: "approved" as const,
      rawField: "price",
      symbol: "AAPL",
      value: 100,
      unit: "USD" as const,
    };
    expect(quoteConflict([observation, { ...observation, value: 101 }])).toBe(true);
    expect(quoteConflict([observation, { ...observation, sessionLabel: "regular" }])).toBe(true);
  });
});

describe("Financial Datasets evaluation gate", () => {
  it("does not call Exa Connect while ZDR is enabled or unknown", async () => {
    const runFinancialDatasetEvaluation = vi.fn();
    const report = await evaluateFinancialDatasets({ runFinancialDatasetEvaluation }, {
      evaluationId: "evaluation-1",
      configuredInstant: "2026-09-01T12:00:00.000Z",
      configuredTimezone: "America/New_York",
      zdrStatus: "enabled",
      maximumCostUsd: 1,
    });
    expect(report).toMatchObject({ status: "failed", safeCode: "exa_connect_zdr_incompatible" });
    expect(runFinancialDatasetEvaluation).not.toHaveBeenCalled();
  });

  it("returns a bounded field-by-field support matrix without raw provider output", async () => {
    const fields = Object.fromEntries(FINANCIAL_DATASET_FIELD_NAMES.map((field) => [field, {
      value: field === "currentPrice" ? 100 : null,
      asOf: field === "currentPrice" ? "2026-09-01T12:00:00.000Z" : null,
      sessionLabel: field === "currentPrice" ? "premarket" : null,
      citations: field === "currentPrice" ? [{ title: "Provider citation", url: "https://example.com/quote" }] : [],
    }]));
    const report = await evaluateFinancialDatasets({
      runFinancialDatasetEvaluation: vi.fn().mockResolvedValue({
        evaluationId: "evaluation-2",
        status: "completed",
        raw: {
          output: { structured: { snapshots: FINANCIAL_DATASET_EVALUATION_SYMBOLS.map((symbol) => ({ symbol, fields })) } },
          costDollars: { total: 0.25 },
          secretRawPayload: "must-not-survive",
        },
      }),
    }, {
      evaluationId: "evaluation-2",
      configuredInstant: "2026-09-01T12:00:00.000Z",
      configuredTimezone: "America/New_York",
      zdrStatus: "disabled",
      maximumCostUsd: 1,
      now: () => 100,
    });
    expect(report.status).toBe("completed");
    expect(report.supportMatrix).toHaveLength(FINANCIAL_DATASET_EVALUATION_SYMBOLS.length * FINANCIAL_DATASET_FIELD_NAMES.length);
    expect(report.supportMatrix.filter((entry) => entry.status === "supported")).toHaveLength(FINANCIAL_DATASET_EVALUATION_SYMBOLS.length);
    expect(report.costUsd).toBe(0.25);
    expect(report.supportMatrix[0]).toMatchObject({
      value: 100, citations: [{ title: "Provider citation", url: "https://example.com/quote" }],
    });
    expect(JSON.stringify(report)).not.toContain("secretRawPayload");
  });

  it("does not report untyped or unattributed fields as supported", async () => {
    for (const override of [
      { value: "100" }, { value: true }, { asOf: null }, { sessionLabel: null }, { citations: [] },
    ]) {
      const currentPrice = {
        value: 100, asOf: "2026-09-01T12:00:00.000Z", sessionLabel: "premarket",
        citations: [{ title: "Provider citation", url: "https://example.com/quote" }], ...override,
      };
      const fields = Object.fromEntries(FINANCIAL_DATASET_FIELD_NAMES.map((field) => [field,
        field === "currentPrice" ? currentPrice : { value: null, asOf: null, sessionLabel: null, citations: [] },
      ]));
      const report = await evaluateFinancialDatasets({
        runFinancialDatasetEvaluation: vi.fn().mockResolvedValue({
          raw: { output: { structured: { snapshots: FINANCIAL_DATASET_EVALUATION_SYMBOLS.map((symbol) => ({ symbol, fields })) } } },
        }),
      }, {
        evaluationId: "evaluation-invalid-evidence", configuredInstant: "2026-09-01T12:00:00.000Z",
        configuredTimezone: "America/New_York", zdrStatus: "disabled", maximumCostUsd: 1,
      });
      expect(report.status).toBe("completed");
      expect(report.supportMatrix.every((item) => item.status === "unsupported" && item.value === null)).toBe(true);
    }
  });

  it("retains charged cost when the evaluation response fails schema validation", async () => {
    const report = await evaluateFinancialDatasets({
      runFinancialDatasetEvaluation: vi.fn().mockResolvedValue({ raw: { costDollars: { total: 0.25 }, output: {} } }),
    }, {
      evaluationId: "evaluation-rejected", configuredInstant: "2026-09-01T12:00:00.000Z",
      configuredTimezone: "America/New_York", zdrStatus: "disabled", maximumCostUsd: 1,
    });
    expect(report).toMatchObject({ status: "failed", costUsd: 0.25 });
  });

  it("preserves the classified safe code in a failed evaluation report", async () => {
    const report = await evaluateFinancialDatasets({
      runFinancialDatasetEvaluation: vi.fn().mockRejectedValue(new MarketResearchExaError({
        code: "exa_budget_exhausted", retryable: false, maximumRetries: 0, scope: "request", finalForSource: true,
      })),
    }, {
      evaluationId: "evaluation-budget", configuredInstant: "2026-09-01T12:00:00.000Z",
      configuredTimezone: "America/New_York", zdrStatus: "disabled", maximumCostUsd: 1,
    });
    expect(report).toMatchObject({ status: "failed", safeCode: "exa_budget_exhausted" });
  });
});

describe("semantic Discord chunking", () => {
  it("covers the 1,999, 2,000, and 2,001-character boundaries without loss", () => {
    expect(splitSemanticContent("x".repeat(1_999), 2_000)).toHaveLength(1);
    expect(splitSemanticContent("x".repeat(2_000), 2_000)).toHaveLength(1);
    const split = splitSemanticContent("x".repeat(2_001), 2_000);
    expect(split).toHaveLength(2);
    expect(split.join("")).toBe("x".repeat(2_001));
    expect(split.every((part) => part.length <= 2_000)).toBe(true);
  });

  it("keeps emoji graphemes, HTTPS URLs, and Markdown links intact", () => {
    const url = `https://example.com/${"a".repeat(70)}`;
    const markdownLink = `[market source](${url})`;
    const content = `😀😀 intro ${markdownLink} next sentence. ${url} trailing text`;
    const split = splitSemanticContent(content, 120);

    expect(split.join("")).toBe(content);
    expect(containsSplitProtectedLink(content, split)).toBe(false);
    expect(split.some((part) => part.endsWith("\ud83d"))).toBe(false);
  });

  it("prefers headings, paragraphs, bullet groups, sentences, and whitespace deterministically", () => {
    const content = [
      "# Market context\n",
      "A complete first sentence. A complete second sentence.\n\n",
      "## Primary board\n",
      "- AMD evidence [E-1]\n",
      "- NVDA evidence [E-2]\n\n",
      "Final paragraph.",
    ].join("");
    const first = splitSemanticContent(content, 75);
    const second = splitSemanticContent(content, 75);
    expect(first).toEqual(second);
    expect(first.join("")).toBe(content);
    expect(first.every((part) => part.length <= 75)).toBe(true);
  });

  it("fails instead of splitting one protected URL that exceeds the complete part", () => {
    const url = `https://example.com/${"a".repeat(200)}`;
    expect(() => splitSemanticContent(url, 100)).toThrow("composition_schema_invalid");
  });

  it("keeps report rows, evidence bullets, and fenced blocks atomic", () => {
    const protectedLines = [
      "- AMD retained evidence [E-1]\n",
      "NVDA | WATCH | 73 | Evidence [E-2]\n",
      "```text\nA complete protected block.\n```\n",
    ].join("");
    const chunks = splitSemanticContent(protectedLines, 52);
    expect(chunks.join("")).toBe(protectedLines);
    expect(chunks).toContain("- AMD retained evidence [E-1]\n");
    expect(chunks).toContain("NVDA | WATCH | 73 | Evidence [E-2]\n");
    expect(chunks).toContain("```text\nA complete protected block.\n```\n");
  });

  it("closes and reopens long multiline and unbroken code fences without losing report content", () => {
    const bodies = [
      `${"A long protected line. ".repeat(15)}\n${"second line ".repeat(12)}\n`,
      "unbroken".repeat(70),
    ];
    for (const body of bodies) {
      const chunks = splitSemanticContent(`\`\`\`text\n${body}\`\`\`\n`, 100);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every((chunk) => chunk.length <= 100 && /^```text\n[\s\S]*\n```\n?$/u.test(chunk))).toBe(true);
      const recoveredBody = chunks
        .map((chunk, index) => {
          const withoutOpening = chunk.replace(/^```text\n/u, "");
          const closingIncludesStructuralNewline = index < chunks.length - 1 || !body.endsWith("\n");
          return closingIncludesStructuralNewline
            ? withoutOpening.replace(/\n```\n?$/u, "")
            : withoutOpening.replace(/```\n?$/u, "");
        })
        .join("");
      expect(recoveredBody).toBe(body);
    }
  });

  it("neutralizes all Discord broadcast and raw mention syntax", () => {
    const untrusted = "@everyone @here <@123> <@!456> <@&789> <#987>";
    const neutralized = neutralizeUntrustedDiscordMarkdown(untrusted);
    expect(neutralized).not.toContain("@everyone");
    expect(neutralized).not.toContain("@here");
    expect(neutralized).not.toMatch(/<(?:@!?|@&|#)\d+>/u);
  });
});
