import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateComposedEdition, type MorningPaperResearchContext } from "../../pi/src/market-research/composer.js";
import { ConvexMarketResearchClient } from "../../pi/src/market-research/convex-client.js";
import {
  marketResearchEvidenceItemSchema,
  marketResearchJobRequestSchema,
  marketResearchJobResultSchema,
  morningPaperEditionSchema,
  type MarketResearchEvidenceItem,
  type MarketResearchJobRequest,
  type MarketResearchJobResult,
  type MorningPaperEvidenceV1,
} from "../../pi/src/market-research/contracts.js";
import { MarketResearchExaClient } from "../../pi/src/market-research/exa-client.js";
import { createMarketResearchRunner } from "../../pi/src/market-research/runner.js";
import { sha256 } from "../../pi/src/market-research/source-normalizer.js";
import {
  appendEvidence, claimResearch, completeComposition, failRun, heartbeatResearch,
  loadEvidence, manualTrigger, marketResearchPiResultRecordSchema,
  recordExaCostEvent, retryEdition, saveControlSettings,
} from "../convex/market_research.js";
import { marketResearchPi, marketResearchPiRequestSchema } from "../convex/market_research_http.js";
import { convexMutationFixture, invokeMutation } from "./helpers/convex-fixture.js";

const callbackSecret = "runner-integration-secret-not-a-real-credential";
const researchSourceId = "exa-news-0";
type ResearchToolContext = Parameters<MorningPaperResearchContext["tools"][number]["execute"]>[4];

function composedResearch(packet: MorningPaperEvidenceV1) {
  const sourceId = packet.evidence.find((item) => item.kind === "news")?.evidenceId;
  if (!sourceId) throw new Error("Fixture composer requires researched news.");
  const cited = { text: "Company news supports a conditional research watch; confirmation remains necessary.", sourceIds: [sourceId] };
  const unavailable = { text: "Current price and volume data are unavailable; do not infer exact levels.", sourceIds: [] };
  return morningPaperEditionSchema.parse({
    schemaVersion: 1, editionId: packet.editionId, editionDate: packet.session.editionDate,
    timezone: packet.session.timezone, asOf: packet.generatedAt, sessionType: packet.session.sessionType,
    editionLabel: packet.session.editionLabel, regime: "MIXED", regimeLines: [cited],
    topStories: [cited], scheduledEvents: [], marketContext: [cited], primaryBoard: [rankedSetup("AAPL", sourceId)],
    challengers: [], tickerDossiers: [{
      symbol: "AAPL", thesisLabel: "NO PRIOR THESIS", summary: cited,
      availableFields: ["company news"], unavailableFields: ["current price", "volume"], sourceIds: [sourceId],
    }],
    validationRules: [unavailable], afterOpenChanges: [], requestedSourceStatus: packet.requestedSourceStatus,
    dataQuality: [unavailable],
    sections: ["primary_board", "data_quality", "sources"].map((kind, sequence) => ({
      sectionId: kind, sequence, kind, heading: kind,
      markdown: kind === "data_quality" ? unavailable.text : cited.text, sourceIds: [sourceId],
    })),
    chartRequests: [], sourceIds: [sourceId], noTradingAction: true,
  });
}

function retainedEvidence(now: number): MarketResearchEvidenceItem[] {
  const url = "https://example.com/market-news";
  const base = {
    kind: "source_status", provider: "Exa", sourcePolicy: "approved",
    retrievedAt: new Date(now).toISOString(), freshness: "fresh", contentStatus: "available",
    highlights: [], normalizedClaims: [], contentHash: "a".repeat(64),
  };
  const duplicateDetail = "Duplicate source URL retained for audit; canonical evidence is exa-news-0.";
  return [
    ...Array.from({ length: 3 }, (_, index) => marketResearchEvidenceItemSchema.parse({
      ...base, evidenceId: `exa-news-${index}`, kind: "news", title: "Synthetic market news",
      url, canonicalUrlHash: sha256(url), highlights: ["Synthetic retained market evidence."],
      requestId: "search-fixture", contentHash: sha256("shared fixture content"),
    })),
    marketResearchEvidenceItemSchema.parse({
      ...base, evidenceId: `duplicate-url-${sha256(`exa-news-0:${url}`).slice(0, 32)}`,
      provider: "Project Trishula deduplication", url, freshness: "unknown",
      normalizedClaims: [duplicateDetail], contentHash: sha256(`${duplicateDetail}:${url}`),
    }),
    marketResearchEvidenceItemSchema.parse({
      ...base, evidenceId: "exa-search-slot-fixture", requestId: "search-fixture", costUsd: 0.01,
      normalizedClaims: ["Exa Search fixture slot completed."],
    }),
    marketResearchEvidenceItemSchema.parse({
      ...base, evidenceId: `exa-contents-url-${sha256(url).slice(0, 32)}`, url,
      normalizedClaims: ["Exa Contents completed for the selected URL with status available."],
    }),
    marketResearchEvidenceItemSchema.parse({
      ...base, evidenceId: "exa-collection-complete", provider: "Project Trishula",
      normalizedClaims: ["The bounded Exa Search and Contents collection checkpoint is complete."],
    }),
  ];
}

async function integrationFixture(
  sessionType: "OPEN" | "CLOSED",
  alterCompletion?: (result: MarketResearchJobResult) => void,
  freshResearch = false,
) {
  const now = Date.parse(sessionType === "OPEN" ? "2026-09-08T12:00:00Z" : "2026-09-07T12:00:00Z");
  vi.setSystemTime(now);
  const db = convexMutationFixture();
  db.rows("discordChannels").push({
    _id: "channel-1", ownerId: "owner_1", guildId: "guild_1", channelId: "forum_1",
    available: true, type: "forum", canView: true, canCreateForumPost: true,
    canSendInThreads: true, canReadThreadHistory: true, canAttachFiles: true, requiresTag: false,
  });
  db.rows("marketSessionCalendars").push({
    _id: "calendar-1", ownerId: "owner_1", calendarId: "nyse", version: "test-calendar",
    sourceUrl: "https://www.nyse.com/trade/hours-calendars", retrievedAt: now,
    effectiveStart: "2026-09-04", effectiveEnd: "2026-09-10", contentHash: "a".repeat(64),
    reviewed: true,
    sessions: Array.from({ length: 7 }, (_, index) => {
      const date = `2026-09-${String(index + 4).padStart(2, "0")}`;
      return index === 0 || index >= 4
        ? { date, status: "OPEN", regularOpen: "09:30", regularClose: "16:00" }
        : { date, status: "CLOSED" };
    }),
  });
  await invokeMutation(saveControlSettings, db.ctx, {
    guildId: "guild_1", forumChannelId: "forum_1", forumTagIds: [],
    timezone: "America/New_York", timezoneConfirmed: true, localHour: 8, localMinute: 0,
    includeWeekends: true, editionDepth: "full", maximumRankedSetups: 10,
    includeCharts: true, maximumCharts: 3, enabled: false,
  });
  const created = await invokeMutation(manualTrigger, db.ctx, {
    guildId: "guild_1", dryRun: false, publish: true, regeneratePublishedEdition: false,
    requestId: "runner-integration",
  });
  const job = marketResearchJobRequestSchema.parse(await invokeMutation(claimResearch, db.ctx, {
    editionId: created.editionId, workerId: "integration-worker",
  }));
  const completionCandidates: MarketResearchJobResult[] = [];
  const context = {
    async runMutation(reference: FunctionReference<"mutation">, args: Parameters<typeof invokeMutation>[2]) {
      switch (getFunctionName(reference)) {
        case "market_research:heartbeatResearch": return invokeMutation(heartbeatResearch, db.ctx, args);
        case "market_research:appendEvidence": return invokeMutation(appendEvidence, db.ctx, args);
        case "market_research:recordExaCostEvent": return invokeMutation(recordExaCostEvent, db.ctx, args);
        case "market_research:failRun": return invokeMutation(failRun, db.ctx, args);
        case "market_research:completeComposition": {
          const result = marketResearchJobResultSchema.parse(args.result);
          alterCompletion?.(result);
          completionCandidates.push(result);
          return invokeMutation(completeComposition, db.ctx, { result });
        }
        default: throw new Error(`Unexpected mutation: ${getFunctionName(reference)}`);
      }
    },
    async runQuery(reference: FunctionReference<"query">, args: Pick<MarketResearchJobRequest, "editionId" | "generation" | "claimToken">) {
      if (getFunctionName(reference) !== "market_research:loadEvidence") throw new Error("Unexpected query.");
      // SAFETY: Convex registration exposes the actual query callback on _handler.
      // The shared fixture supplies every database operation used by loadEvidence.
      const query = loadEvidence as typeof loadEvidence & {
        _handler: (ctx: typeof db.ctx, input: typeof args) => Promise<{ accepted: boolean; evidence: MarketResearchEvidenceItem[] }>;
      };
      return query._handler(db.ctx, args);
    },
  };
  // SAFETY: Convex registration exposes the actual HTTP callback on _handler.
  // Its only context operations dispatch to the real handlers above on this same DB.
  const action = marketResearchPi as typeof marketResearchPi & {
    _handler: (ctx: typeof context, request: Request) => Promise<Response>;
  };
  const wire: { operation: string; status: number }[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    const payload = marketResearchPiRequestSchema.parse(await request.clone().json());
    const response = await action._handler(context, request);
    wire.push({ operation: payload.operation, status: response.status });
    return response;
  });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const callbacks = new ConvexMarketResearchClient({
    siteUrl: "https://convex.invalid", sharedSecret: callbackSecret, timeoutMs: 1_000,
    logger, fetch: fetchImpl,
  });
  if (!freshResearch) {
    await callbacks.appendEvidence(job, 900, retainedEvidence(now));
    await callbacks.costObserver(job)({
      operation: "search", outcome: "settled", costUsd: 0.01,
      late: true, observedAt: new Date(now).toISOString(), requestId: "search-fixture",
    });
  }
  const providerCall = vi.fn(async () => {
    if (!freshResearch) throw new Error("Provider must not run for retained collection.");
    return {
      requestId: "dynamic-search-1", costDollars: { total: 0.01 },
      results: [{ id: "news-1", url: "https://example.com/company-update", title: "Company announces a new product",
        publishedDate: new Date(now).toISOString(), highlights: ["The company announced a new product; market response remains unconfirmed."] }],
    };
  });
  const compose = vi.fn(async (
    packet: MorningPaperEvidenceV1,
    _preferences: MarketResearchJobRequest["preferences"],
    signal?: AbortSignal,
    research?: MorningPaperResearchContext,
  ) => {
    if (!freshResearch) return composedResearch(packet);
    const search = research?.tools.find((tool) => tool.name === "exa_search");
    if (!search || !research) throw new Error("Agent research tools were not provided.");
    // SAFETY: This tool uses its typed arguments, lease signal, and injected Exa client only.
    await search.execute("dynamic-tool-1", { query: "AAPL company news", numResults: 1 }, signal, undefined, {} as ResearchToolContext);
    return composedResearch(research.getEvidence());
  });
  const runner = createMarketResearchRunner({
    callbacks, logger, now: () => new Date(now),
    exaClient: (request, initialUsage) => new MarketResearchExaClient({
      apiKey: "unit-test-provider-key", searchConcurrency: 1, contentsConcurrency: 1,
      requestTimeoutMs: 1_000, maximumSearchRequests: 12, maximumContentPages: 24,
      logger, initialUsage, onCostEvent: callbacks.costObserver(request),
      transport: { search: providerCall, getContents: providerCall, runFinancialDataset: providerCall },
    }),
    composer: {
      initialize: async () => undefined, readiness: () => ({ ready: true }),
      compose, dispose: async () => undefined,
    },
  });
  return { db, job, callbacks, runner, providerCall, compose, wire, completionCandidates };
}

function rankedSetup(symbol: string, sourceId = researchSourceId): MarketResearchJobResult["edition"]["primaryBoard"][number] {
  const cited = { text: "Company news supports watching for a confirmed move with broader market support.", sourceIds: [sourceId] };
  const unavailable = { text: "Exact price levels are unavailable until current market data can be verified.", sourceIds: [] };
  return {
    symbol, label: "TOP WATCH", score: 90,
    components: { catalyst: 20, liquidityAndSpread: 15, dailyAndHourlyBias: 15, premarketStructure: 10, levelQualityAndProximity: 20, indexAndSectorConfirmation: 10 },
    deductions: ["Current numerical fields are unavailable."], thesisLabel: "NO PRIOR THESIS", trigger: unavailable, invalidation: unavailable,
    firstResistanceOrTarget: unavailable, rewardToRisk: unavailable, noChase: cited,
    indexOrSectorCondition: cited, eventRisk: cited, sourceIds: [sourceId],
  };
}

beforeEach(() => {
  vi.stubEnv("WORKOS_ALLOWED_USER_IDS", "owner_1");
  vi.stubEnv("MARKET_RESEARCH_OWNER_ID", "owner_1");
  vi.stubEnv("SERVICE_SHARED_SECRET", callbackSecret);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("Convex claim through real Pi runner and Convex persistence", () => {
  it("lets the agent search dynamically and persist cited partial research through real HTTP callbacks", async () => {
    const test = await integrationFixture("OPEN", undefined, true);
    const result = await test.runner.run(test.job);
    expect(test.providerCall).toHaveBeenCalledOnce();
    expect(test.compose).toHaveBeenCalledOnce();
    expect(result.edition.editionLabel).toBe(test.job.session.editionLabel);
    expect(result.edition.topStories[0]?.text).toContain("Company news");
    expect(result.edition.dataQuality[0]?.text).toContain("unavailable");
    const citedSourceId = result.edition.topStories[0]?.sourceIds[0];
    expect(test.db.rows("marketResearchEvidence").some((row) => row.evidenceId === citedSourceId && row.kind === "news")).toBe(true);
    expect(test.db.rows("marketResearchEvidence").some((row) => row.evidenceId === "exa-collection-complete")).toBe(true);
    expect(test.db.rows("marketResearchCostEvents")).toHaveLength(1);
    expect(test.db.rows("marketResearchEditions")[0]).toMatchObject({ status: "ready_to_publish", exaObservedCostUsd: 0.01 });
    expect(test.db.rows("marketResearchDeliveries")).toHaveLength(result.deliveries.length);
    expect(test.wire.every((callback) => callback.status === 200)).toBe(true);
    await test.runner.dispose();
  });

  it.each(["OPEN", "CLOSED"] as const)("completes retained duplicate news with the frozen %s session", async (sessionType) => {
    const test = await integrationFixture(sessionType);
    expect(test.job.session.sessionType).toBe(sessionType);
    expect(test.job.session.editionLabel).not.toBe("Data unavailable");
    const result = await test.runner.run(test.job);
    expect(result.evidence.session).toEqual(test.job.session);
    expect(result.edition.editionLabel).toBe(test.job.session.editionLabel);
    expect(result.edition.primaryBoard).toHaveLength(1);
    expect(result.edition.topStories).toHaveLength(1);
    expect(result.edition.tickerDossiers).toHaveLength(1);
    expect(result.edition.primaryBoard[0]?.rewardToRisk.sourceIds).toEqual([]);
    expect(validateComposedEdition(result.edition, result.evidence, test.job.preferences)).toEqual(result.edition);
    expect(marketResearchPiResultRecordSchema.safeParse(result).success).toBe(true);
    expect(result.evidence.evidence.filter((item) => item.evidenceId.startsWith("duplicate-url-"))).toHaveLength(1);
    expect(new Set(result.evidence.evidence.map((item) => item.evidenceId)).size).toBe(result.evidence.evidence.length);
    expect(test.db.rows("marketResearchEditions")[0]).toMatchObject({
      editionId: test.job.editionId, status: "ready_to_publish", sessionType,
      editionLabel: test.job.session.editionLabel, expectedPartCount: result.deliveries.length,
      exaRequestCount: 1, exaCostUsd: 0.01,
    });
    expect(test.db.rows("marketResearchSections")).toHaveLength(result.edition.sections.length);
    expect(test.db.rows("marketResearchDeliveries")).toHaveLength(result.deliveries.length);
    expect(test.db.rows("marketResearchDeliveries").every((row) => row.status === "pending")).toBe(true);
    expect(test.wire.every((callback) => callback.status === 200)).toBe(true);
    expect(test.providerCall).not.toHaveBeenCalled();
    expect(test.compose).toHaveBeenCalledOnce();
    await test.runner.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reclaims a failed generation and completes retained checkpoints without another provider request", async () => {
    let rejectFirstCompletion = true;
    const test = await integrationFixture("OPEN", (result) => {
      if (rejectFirstCompletion) {
        result.evidence.session.editionLabel = "Data unavailable";
        rejectFirstCompletion = false;
      }
    });
    await expect(test.runner.run(test.job)).rejects.toThrow("market_research_convex_rejected");
    const failedEdition = test.db.rows("marketResearchEditions")[0]!;
    expect(failedEdition.status).toBe("failed");
    expect(test.db.rows("marketResearchEvidence").some((row) => row.evidenceId === "exa-collection-complete")).toBe(true);
    await expect(invokeMutation(retryEdition, test.db.ctx, { editionId: test.job.editionId }))
      .resolves.toMatchObject({ status: "queued" });
    const retry = marketResearchJobRequestSchema.parse(await invokeMutation(claimResearch, test.db.ctx, {
      editionId: test.job.editionId, workerId: "integration-recovery-worker",
    }));
    expect(retry.generation).toBe(test.job.generation + 1);
    expect(retry.exaUsage).toEqual({ searchRequests: 1, contentPages: 0, costUsd: 0.01, costStatus: "known" });
    const result = await test.runner.run(retry);
    expect(result.evidence.session).toEqual(retry.session);
    expect(new Set(result.evidence.evidence.map((item) => item.evidenceId)).size).toBe(result.evidence.evidence.length);
    expect(test.db.rows("marketResearchEditions")[0]?.status).toBe("ready_to_publish");
    expect(test.db.rows("marketResearchDeliveries")).toHaveLength(result.deliveries.length);
    expect(test.providerCall).not.toHaveBeenCalled();
    await test.runner.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts honest empty optional research fields but not unsupported uncited claims", async () => {
    const test = await integrationFixture("OPEN");
    const completed = await test.runner.run(test.job);
    const result = marketResearchJobResultSchema.parse(completed);
    result.edition.topStories = [];
    result.edition.tickerDossiers = [];
    expect(marketResearchPiResultRecordSchema.safeParse(result).success).toBe(true);
    expect(() => validateComposedEdition(result.edition, result.evidence, test.job.preferences)).not.toThrow();
    result.edition.dataQuality = [{ text: "The stock has strong liquidity and a favorable risk profile.", sourceIds: [] }];
    expect(marketResearchPiResultRecordSchema.safeParse(result).success).toBe(false);
    await test.runner.dispose();
  });

  it.each([
    "changed_frozen_label", "changed_frozen_session", "missing_collection_marker", "unknown_citation",
    "unconfigured_symbol", "uncited_claim", "nonpositive_chart",
  ] as const)("rejects %s through the actual completion mutation and records failure", async (scenario) => {
    const test = await integrationFixture("OPEN", (result) => {
      if (scenario === "changed_frozen_label") result.evidence.session.editionLabel = "Data unavailable";
      if (scenario === "changed_frozen_session") {
        result.evidence.session.sessionType = "CLOSED";
        result.edition.sessionType = "CLOSED";
      }
      if (scenario === "missing_collection_marker") {
        result.evidence.evidence = result.evidence.evidence.filter((item) => item.evidenceId !== "exa-collection-complete");
        result.evidence.allowedSourceIds = result.evidence.allowedSourceIds.filter((id) => id !== "exa-collection-complete");
      }
      if (scenario === "unknown_citation") result.edition.dataQuality = [{ text: "Synthetic claim.", sourceIds: ["unknown-source"] }];
      if (scenario === "unconfigured_symbol") result.edition.primaryBoard = [rankedSetup("UNKNOWN")];
      if (scenario === "uncited_claim") result.edition.primaryBoard[0]!.trigger = { text: "Buy above the breakout level.", sourceIds: [] };
      if (scenario === "nonpositive_chart") {
        const setup = result.edition.primaryBoard[0]!;
        setup.label = "AVOID";
        setup.score = 60;
        setup.components.catalyst = 0;
        setup.components.premarketStructure = 0;
        result.edition.chartRequests = [{
          chartRequestId: "chart-fixture", editionId: result.editionId, sectionId: "primary_board",
          symbol: "AAPL", timeframe: "daily", start: "2026-08-01T12:00:00.000Z", end: result.completedAt,
          session: "regular", overlays: [], annotations: [], reason: "Synthetic chart.", priority: 90,
          sourceEvidenceIds: [researchSourceId], dataAsOf: result.completedAt,
        }];
      }
    });
    await expect(test.runner.run(test.job)).rejects.toThrow("market_research_convex_rejected");
    expect(test.wire).toContainEqual({ operation: "complete", status: 409 });
    expect(test.wire).toContainEqual({ operation: "fail", status: 200 });
    expect(test.db.rows("marketResearchEditions")[0]?.status).not.toBe("ready_to_publish");
    expect(test.db.rows("marketResearchDeliveries")).toHaveLength(0);
    const candidate = test.completionCandidates[0]!;
    if (scenario === "unknown_citation" || scenario === "uncited_claim" || scenario === "nonpositive_chart") {
      expect(marketResearchPiResultRecordSchema.safeParse(candidate).success).toBe(false);
      expect(() => validateComposedEdition(candidate.edition, candidate.evidence, test.job.preferences)).toThrow();
    }
    expect(test.providerCall).not.toHaveBeenCalled();
    await test.runner.dispose();
  });
});
