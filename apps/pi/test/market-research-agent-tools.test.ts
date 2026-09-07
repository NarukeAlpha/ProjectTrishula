/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- Tool tests provide an unused extension context; the three tools do not read runtime UI APIs. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createMorningPaperResearchTools, type MorningPaperResearchToolsOptions } from "../src/market-research/agent-tools.js";
import {
  MARKET_RESEARCH_MAX_EVIDENCE_BYTES,
  jsonByteLength,
  marketResearchEvidenceItemSchema,
  marketResearchPreferencesSchema,
  morningPaperEvidenceSchema,
  type MarketResearchEvidenceItem,
} from "../src/market-research/contracts.js";
import { initialExaUsageFromEvidence, MarketResearchExaClient, type ExaClientOptions, type ExaSdkTransport } from "../src/market-research/exa-client.js";
import { buildResearchPlan } from "../src/market-research/research-plan.js";
import { StaticSourcePolicy } from "../src/market-research/source-policy.js";
import { sha256 } from "../src/market-research/source-normalizer.js";

const now = "2026-09-07T12:00:00.000Z";
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const preferences = marketResearchPreferencesSchema.parse({
  schemaVersion: 1, preferenceId: "pref-1", scheduleId: "schedule-1", ownerId: "owner-1", guildId: "guild-1",
  enabled: false, forumChannelId: null, forumTagIds: [], timezone: "America/New_York", timezoneConfirmed: true,
  displayTimezones: ["America/New_York"], localHour: 8, localMinute: 0,
  primarySymbols: ["AAPL"], symbolPriorities: {}, sectorSymbols: [], discoverySymbols: [], followedSectors: [],
  trackedThemes: [], macroTopics: [], eventCategories: [], preferredDomains: [], excludedDomains: ["blocked.example"],
  requestedSources: ["FinancialJuice", "Barchart", "ForexFactory", "Yahoo", "TradingView"],
  reportSections: { overnightMacro: true, crossAsset: true, indexSector: true, calendar: true, primaryBoard: true, challengers: true, tickerDossiers: true, validation: true, afterOpen: true, requestedSources: true, dataQuality: true, sources: true },
  maximumRankedSetups: 10, editionDepth: "full", includeWeekends: true, includeCharts: true, chartsAcceptancePassed: false,
  maximumCharts: 3, lateEditionCutoffLocalTime: "12:00", searchRequestBudget: 12, contentsPageBudget: 24,
  marketDataProviderId: null, marketSessionCalendarId: "nyse", durableTheses: [], sourcePolicyVersion: "source-policy-v1",
  promptVersion: "morning-paper-v1", revision: 1, createdAt: now, updatedAt: now,
});
const source = marketResearchEvidenceItemSchema.parse({
  evidenceId: "calendar-1", kind: "calendar", provider: "official", sourcePolicy: "approved", title: "Market calendar",
  retrievedAt: now, freshness: "fresh", contentStatus: "available", highlights: ["Labor Day market closure."], normalizedClaims: [], contentHash: sha256("calendar-1"),
});
function evidence(items: MarketResearchEvidenceItem[] = [source]) {
  return morningPaperEvidenceSchema.parse({
    schemaVersion: 1, editionId: "edition-1", generatedAt: now,
    session: { sessionType: "CLOSED", editionLabel: "Market Holiday Outlook", editionDate: "2026-09-07", timezone: "America/New_York", configuredLocalTime: now, marketTime: now, previousSessionDate: "2026-09-04", previousSessionClose: "2026-09-04T20:00:00.000Z", nextSessionDate: "2026-09-08", calendarVersion: "calendar-v1", sourceIds: items.some((item) => item.evidenceId === source.evidenceId) ? [source.evidenceId] : [] },
    primarySymbols: preferences.primarySymbols, sectorSymbols: [], discoverySymbols: [], sourcePolicyVersion: "source-policy-v1",
    requestedSourceStatus: preferences.requestedSources.map((name) => ({ source: name, status: "disabled_by_policy", detail: "Legacy state.", sourceIds: [] })),
    evidence: items, missingFields: ["Structured prices are not configured."], conflicts: [], allowedSourceIds: items.map((item) => item.evidenceId),
  });
}

function client(transport: ExaSdkTransport, overrides: Partial<ExaClientOptions> = {}) {
  return new MarketResearchExaClient({
    apiKey: "fixture-key-never-log", searchConcurrency: 2, contentsConcurrency: 2, requestTimeoutMs: 20_000,
    maximumSearchRequests: 12, maximumContentPages: 24, now: () => new Date(now), logger, transport,
    sleep: async () => undefined, random: () => 0, ...overrides,
  });
}
function fixture(overrides: Partial<MorningPaperResearchToolsOptions> = {}, clientOverrides: Partial<ExaClientOptions> = {}) {
  const search = vi.fn().mockResolvedValue({
    requestId: "search-1", costDollars: { total: 0.01 },
    results: [{ id: "doc-1", title: "AAPL earnings guidance", url: "https://finance.yahoo.com/news/aapl?utm_source=tracking", highlights: ["Revenue guidance improved."], publishedDate: now }],
  });
  const getContents = vi.fn().mockResolvedValue({
    requestId: "contents-1", costDollars: { total: 0.001 },
    results: [{ title: "AAPL earnings guidance", text: "Revenue guidance improved. ".repeat(150), status: "available", publishedDate: now }],
  });
  const exaClient = client({ search, getContents }, clientOverrides);
  const onEvidence = vi.fn(async (_items: MarketResearchEvidenceItem[]) => undefined);
  const tools = createMorningPaperResearchTools({ initialEvidence: evidence(), preferences, exaClient, logger, onEvidence, now: () => new Date(now), ...overrides });
  const call = (name: string, params: Parameters<(typeof tools.tools)[number]["execute"]>[1], signal?: AbortSignal) => {
    const tool = tools.tools.find((item) => item.name === name);
    if (tool === undefined) throw new Error("missing_fixture_tool");
    return tool.execute("fixture-call", params, signal, undefined, {} as ExtensionContext);
  };
  return { tools, search, getContents, exaClient, onEvidence, call };
}

describe("dynamic newspaper research tools", () => {
  it("exposes only Exa search/read and queued CHART-IMG without brokerage, file, or shell tools", () => {
    expect(fixture().tools.tools.map((item) => item.name)).toEqual(["exa_search", "exa_read", "request_chart"]);
  });

  it("accepts agent queries and registers durable public sources before returning citations", async () => {
    const f = fixture();
    const result = await f.call("exa_search", { query: "AAPL next-session catalysts", lookbackDays: 3, numResults: 4 });
    expect(f.search).toHaveBeenCalledWith("AAPL next-session catalysts", expect.objectContaining({
      numResults: 4, startPublishedDate: "2026-09-04T12:00:00.000Z", excludeDomains: ["blocked.example"],
    }), expect.any(AbortSignal));
    expect(f.onEvidence).toHaveBeenCalledOnce();
    expect(result.content).toEqual([expect.objectContaining({ text: expect.stringContaining("searchRequestsRemaining") })]);
    const packet = f.tools.getEvidence();
    expect(packet.evidence).toHaveLength(3);
    expect(packet.evidence[1]?.evidenceId).toMatch(/^exa-search-slot-/);
    expect(packet.allowedSourceIds).toContain(packet.evidence[2]?.evidenceId);
    expect(packet.requestedSourceStatus.find((item) => item.source === "Yahoo")).toMatchObject({ status: "contributed" });
    expect(JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls])).not.toContain("fixture-key-never-log");
  });

  it("reuses a repeated query and retained source read without additional provider charges", async () => {
    const f = fixture();
    await f.call("exa_search", { query: "AAPL" });
    await f.call("exa_search", { query: "AAPL" });
    await f.call("exa_read", { url: "https://finance.yahoo.com/news/aapl" });
    await f.call("exa_read", { url: "https://finance.yahoo.com/news/aapl?utm_source=tracking" });
    expect(f.search).toHaveBeenCalledOnce();
    expect(f.getContents).toHaveBeenCalledOnce();
    const packet = f.tools.getEvidence();
    const retained = packet.evidence.find((item) => item.evidenceId.startsWith("exa-content-"));
    expect(retained?.highlights.join("\n").length).toBe(2_000);
    expect(new Set(packet.evidence.map((item) => item.evidenceId)).size).toBe(packet.evidence.length);
    expect(f.exaClient.usage()).toMatchObject({ searchRequests: 1, contentPages: 1, costUsd: 0.011 });
  });

  it("omits the Exa category for general web searches and preserves explicit specialized categories", async () => {
    const f = fixture();
    await f.call("exa_search", { query: "official BLS calendar" });
    await f.call("exa_search", { query: "SEC company filings", category: "all" });
    await f.call("exa_search", { query: "AAPL breaking news", category: "news" });
    await f.call("exa_search", { query: "AAPL quarterly report", category: "financial report" });
    expect(f.search.mock.calls[0]?.[1]).not.toHaveProperty("category");
    expect(f.search.mock.calls[1]?.[1]).not.toHaveProperty("category");
    expect(f.search.mock.calls[0]?.[1]).not.toHaveProperty("startPublishedDate");
    expect(f.search.mock.calls[0]?.[1]).not.toHaveProperty("endPublishedDate");
    expect(f.search.mock.calls[1]?.[1]).not.toHaveProperty("startPublishedDate");
    expect(f.search.mock.calls[1]?.[1]).not.toHaveProperty("endPublishedDate");
    expect(f.search.mock.calls[2]?.[1]).toHaveProperty("category", "news");
    expect(f.search.mock.calls[3]?.[1]).toHaveProperty("category", "financial report");
    expect(f.search.mock.calls[2]?.[1]).toMatchObject({ startPublishedDate: "2026-08-31T12:00:00.000Z", endPublishedDate: now });
    expect(f.search.mock.calls[3]?.[1]).toMatchObject({ startPublishedDate: "2026-08-31T12:00:00.000Z", endPublishedDate: now });
  });

  it("applies an explicit general-search publication window without narrowing its category", async () => {
    const f = fixture();
    await f.call("exa_search", { query: "official SEC filings", category: "all", lookbackDays: 30 });
    expect(f.search.mock.calls[0]?.[1]).not.toHaveProperty("category");
    expect(f.search.mock.calls[0]?.[1]).toMatchObject({ startPublishedDate: "2026-08-08T12:00:00.000Z", endPublishedDate: now });
  });

  it("blocks unsafe, excluded, and unobserved URLs before Exa receives them", async () => {
    const f = fixture();
    for (const url of ["http://example.com", "https://127.0.0.1/", "https://user:pass@example.com/", "https://blocked.example/item", "https://unobserved.example/item"]) {
      expect((await f.call("exa_read", { url })).details).toEqual({ ok: false });
    }
    expect(f.getContents).not.toHaveBeenCalled();
  });

  it("preserves Exa source refusals and allows the rest of the report to continue", async () => {
    const f = fixture();
    await f.call("exa_search", { query: "AAPL" });
    f.getContents.mockRejectedValue({ status: 403, code: "ROBOTS_FILTER_FAILED", message: "secret-provider-payload" });
    const result = await f.call("exa_read", { url: "https://finance.yahoo.com/news/aapl" });
    expect(result.details).toEqual({ ok: false });
    expect(f.tools.getEvidence().evidence.some((item) => item.contentStatus === "blocked")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret-provider-payload");
  });

  it("returns bounded budget errors from exhausted or unknown-cost initial usage", async () => {
    const f = fixture({}, { initialUsage: { searchRequests: 12, contentPages: 24, costUsd: 0.2, costStatus: "unknown" } });
    const result = await f.call("exa_search", { query: "AAPL" });
    expect(JSON.stringify(result)).toContain("exa_budget_exhausted");
    expect(f.search).not.toHaveBeenCalled();
    expect(f.tools.getEvidence().evidence).toEqual([source]);
  });

  it("keeps tool request ceilings at twelve searches and twenty-four pages even with larger preferences", async () => {
    const f = fixture({ preferences: { ...preferences, searchRequestBudget: 100, contentsPageBudget: 100 } }, { maximumSearchRequests: 100, maximumContentPages: 100 });
    for (let index = 0; index < 13; index += 1) await f.call("exa_search", { query: `AAPL query ${index}` });
    expect(f.search).toHaveBeenCalledTimes(12);
    expect(f.exaClient.usage().searchRequests).toBe(12);
  });

  it("serializes concurrent calls and propagates lease loss from persistence", async () => {
    let active = 0;
    let maximum = 0;
    const f = fixture({ onEvidence: async () => { active += 1; maximum = Math.max(active, maximum); await Promise.resolve(); active -= 1; } });
    await Promise.all([f.call("exa_search", { query: "AAPL" }), f.call("exa_search", { query: "AAPL" })]);
    expect(maximum).toBe(1);
    expect(f.search).toHaveBeenCalledOnce();
    const failed = fixture({ onEvidence: async () => { throw new Error("edition_lease_lost"); } });
    await expect(failed.call("exa_search", { query: "AAPL" })).rejects.toThrow("edition_lease_lost");
    expect(failed.tools.getEvidence().evidence).toEqual([source]);
  });

  it("propagates both job and tool cancellation rather than reporting source failure", async () => {
    for (const kind of ["job", "tool"]) {
      const controller = new AbortController();
      const f = fixture(kind === "job" ? { signal: controller.signal } : {});
      controller.abort(new Error("edition_lease_lost"));
      await expect(f.call("exa_search", { query: "AAPL" }, kind === "tool" ? controller.signal : undefined)).rejects.toThrow("edition_lease_lost");
      expect(f.search).not.toHaveBeenCalled();
    }
  });

  it("keeps aggregate retained evidence below the final packet cap and reserves the completion marker", async () => {
    const items = Array.from({ length: 489 }, (_, index) => ({ ...source, evidenceId: `calendar-${index}`, contentHash: sha256(String(index)), highlights: [], title: "x" }));
    const f = fixture({ initialEvidence: evidence(items) });
    await f.call("exa_search", { query: "AAPL" });
    await f.call("exa_search", { query: "MSFT" });
    const packet = f.tools.getEvidence();
    expect(packet.evidence.length).toBeLessThanOrEqual(499);
    expect(jsonByteLength(packet)).toBeLessThanOrEqual(MARKET_RESEARCH_MAX_EVIDENCE_BYTES - 2_048);
    expect(f.search.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("queues only bounded cited watchlist charts without fetching or hosting images", async () => {
    const f = fixture();
    const request = { sectionId: "primary-board", symbol: "AAPL", timeframe: "daily", start: "2026-08-01T12:00:00.000Z", end: now, dataAsOf: now, session: "all", overlays: ["Volume"], annotations: [], reason: "Illustrate the supported setup.", priority: 80, sourceEvidenceIds: [source.evidenceId] };
    expect((await f.call("request_chart", request)).details).toEqual({ ok: true });
    expect((await f.call("request_chart", { ...request, symbol: "UNKNOWN" })).details).toEqual({ ok: false });
    expect((await f.call("request_chart", { ...request, sourceEvidenceIds: ["invented"] })).details).toEqual({ ok: false });
    expect(f.tools.getChartRequests()).toEqual([expect.objectContaining({ editionId: "edition-1", symbol: "AAPL" })]);
    expect(f.search).not.toHaveBeenCalled();
    expect(f.getContents).not.toHaveBeenCalled();
  });

  it("refreshes generatedAt without changing the frozen market session", () => {
    const f = fixture({ now: () => new Date("2026-09-07T12:05:00.000Z") });
    expect(f.tools.getEvidence().generatedAt).toBe("2026-09-07T12:05:00.000Z");
    expect(f.tools.getEvidence().session).toEqual(evidence().session);
  });
});

describe("recovered Exa spending allowances", () => {
  const slot = buildResearchPlan(preferences, new StaticSourcePolicy(), { startPublishedDate: "2026-09-01T12:00:00.000Z", endPublishedDate: now }).slots[0]!;

  it("counts unique retained markers and uses durable paid usage without double-counting costs", () => {
    const first = { ...source, evidenceId: "exa-search-slot-a", costUsd: 0.1 };
    const second = { ...source, evidenceId: "exa-contents-url-b", costUsd: 0.2 };
    expect(initialExaUsageFromEvidence([first, first, second], { searchRequests: 3, contentPages: 1, costUsd: 0.4, costStatus: "known" })).toEqual({ searchRequests: 3, contentPages: 1, costUsd: 0.4, costStatus: "known" });
  });

  it("allows only the remaining search and content requests after restart", async () => {
    const transport = { search: vi.fn().mockResolvedValue({ requestId: "s", results: [], costDollars: { total: 0.01 } }), getContents: vi.fn().mockResolvedValue({ requestId: "c", results: [], costDollars: { total: 0.001 } }) };
    const exa = client(transport, { initialUsage: { searchRequests: 11, contentPages: 23, costUsd: 0.2, costStatus: "known" } });
    await exa.searchNews(slot);
    await expect(exa.searchNews(slot)).rejects.toThrow("exa_budget_exhausted");
    await exa.getSelectedContents(["https://public.example/item"]);
    await expect(exa.getSelectedContents(["https://public.example/other"])).rejects.toThrow("exa_budget_exhausted");
    expect(transport.search).toHaveBeenCalledOnce();
    expect(transport.getContents).toHaveBeenCalledOnce();
    expect(exa.usage().costUsd).toBeCloseTo(0.211);
  });

  it("preserves over-cap counters but closes new spending so cached research can still compose", async () => {
    const transport = { search: vi.fn(), getContents: vi.fn() };
    const exa = client(transport, { initialUsage: { searchRequests: 15, contentPages: 25, costUsd: 0.4, costStatus: "known" } });
    expect(exa.usage()).toMatchObject({ searchRequests: 15, contentPages: 25, budgetClosed: true });
    await expect(exa.searchNews(slot)).rejects.toThrow("exa_budget_exhausted");
    expect(transport.search).not.toHaveBeenCalled();
  });

  it("rejects invalid usage and restores the cost cap before any provider request", async () => {
    const transport = { search: vi.fn(), getContents: vi.fn() };
    for (const value of [-1, NaN, Infinity, 1.5]) expect(() => client(transport, { initialUsage: { searchRequests: value, contentPages: 0, costUsd: 0, costStatus: "known" } })).toThrow("exa_invalid_initial_usage");
    expect(() => initialExaUsageFromEvidence([], { searchRequests: -1, contentPages: 0, costUsd: 0, costStatus: "known" })).toThrow("exa_invalid_initial_usage");
    const exa = client(transport, { maximumCostUsd: 0.1, initialUsage: { searchRequests: 1, contentPages: 0, costUsd: 0.1, costStatus: "known" } });
    await expect(exa.searchNews(slot)).rejects.toThrow("exa_budget_exhausted");
    expect(exa.usage().budgetClosed).toBe(true);
    expect(transport.search).not.toHaveBeenCalled();
  });
});
