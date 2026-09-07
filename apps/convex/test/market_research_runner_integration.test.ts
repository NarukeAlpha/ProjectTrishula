import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateComposedEdition } from "../../pi/src/market-research/composer.js";
import { ConvexMarketResearchClient } from "../../pi/src/market-research/convex-client.js";
import {
  marketResearchEvidenceItemSchema,
  marketResearchJobRequestSchema,
  marketResearchJobResultSchema,
  type MarketResearchEvidenceItem,
  type MarketResearchJobRequest,
  type MarketResearchJobResult,
} from "../../pi/src/market-research/contracts.js";
import { MarketResearchExaClient } from "../../pi/src/market-research/exa-client.js";
import { DisabledMarketDataProvider } from "../../pi/src/market-research/market-data.js";
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
const unavailableId = "operational-market-data-unavailable";

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
  await callbacks.appendEvidence(job, 900, retainedEvidence(now));
  await callbacks.costObserver(job)({
    operation: "search", outcome: "settled", costUsd: 0.01,
    late: true, observedAt: new Date(now).toISOString(), requestId: "search-fixture",
  });
  const providerCall = vi.fn(async () => { throw new Error("Provider must not run for retained collection."); });
  const compose = vi.fn(async () => { throw new Error("Composer must not run without numerical market data."); });
  const runner = createMarketResearchRunner({
    callbacks, logger, now: () => new Date(now), marketData: new DisabledMarketDataProvider(),
    exaClient: () => new MarketResearchExaClient({
      apiKey: "unit-test-provider-key", searchConcurrency: 1, contentsConcurrency: 1,
      requestTimeoutMs: 1_000, maximumSearchRequests: 12, maximumContentPages: 24,
      logger, transport: { search: providerCall, getContents: providerCall, runFinancialDataset: providerCall },
    }),
    composer: {
      initialize: async () => undefined, readiness: () => ({ ready: true }),
      compose, dispose: async () => undefined,
    },
  });
  return { db, job, callbacks, runner, providerCall, compose, wire, completionCandidates };
}

function rankedSetup(symbol: string): MarketResearchJobResult["edition"]["primaryBoard"][number] {
  const cited = { text: "Synthetic research claim.", sourceIds: [unavailableId] };
  return {
    symbol, label: "TOP WATCH", score: 90,
    components: { catalyst: 20, liquidityAndSpread: 15, dailyAndHourlyBias: 15, premarketStructure: 10, levelQualityAndProximity: 20, indexAndSectorConfirmation: 10 },
    deductions: [], thesisLabel: "NO PRIOR THESIS", trigger: cited, invalidation: cited,
    firstResistanceOrTarget: cited, rewardToRisk: cited, noChase: cited,
    indexOrSectorCondition: cited, eventRisk: cited, sourceIds: [unavailableId],
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
  it.each(["OPEN", "CLOSED"] as const)("completes retained duplicate news with the frozen %s session", async (sessionType) => {
    const test = await integrationFixture(sessionType);
    expect(test.job.session.sessionType).toBe(sessionType);
    expect(test.job.session.editionLabel).not.toBe("Data unavailable");
    const result = await test.runner.run(test.job);
    expect(result.evidence.session).toEqual(test.job.session);
    expect(result.edition.editionLabel).toBe("Data unavailable");
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
    expect(test.compose).not.toHaveBeenCalled();
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
    expect(test.db.rows("marketResearchEvidence").some((row) => row.evidenceId === unavailableId)).toBe(true);
    await expect(invokeMutation(retryEdition, test.db.ctx, { editionId: test.job.editionId }))
      .resolves.toMatchObject({ status: "queued" });
    const retry = marketResearchJobRequestSchema.parse(await invokeMutation(claimResearch, test.db.ctx, {
      editionId: test.job.editionId, workerId: "integration-recovery-worker",
    }));
    expect(retry.generation).toBe(test.job.generation + 1);
    const result = await test.runner.run(retry);
    expect(result.evidence.session).toEqual(retry.session);
    expect(new Set(result.evidence.evidence.map((item) => item.evidenceId)).size).toBe(result.evidence.evidence.length);
    expect(test.db.rows("marketResearchEditions")[0]?.status).toBe("ready_to_publish");
    expect(test.db.rows("marketResearchDeliveries")).toHaveLength(result.deliveries.length);
    expect(test.providerCall).not.toHaveBeenCalled();
    await test.runner.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the existing equal-label validation path unchanged", async () => {
    const test = await integrationFixture("OPEN");
    const completed = await test.runner.run(test.job);
    const result = marketResearchJobResultSchema.parse(JSON.parse(
      JSON.stringify(completed).replaceAll(unavailableId, "existing-operational-source"),
    ));
    result.evidence.session.editionLabel = "Data unavailable";
    expect(result.evidence.evidence.some((item) => item.evidenceId === unavailableId)).toBe(false);
    expect(marketResearchPiResultRecordSchema.safeParse(result).success).toBe(true);
    expect(() => validateComposedEdition(result.edition, result.evidence, test.job.preferences)).not.toThrow();
    await test.runner.dispose();
  });

  it.each([
    "changed_frozen_label", "changed_frozen_session", "missing_marker", "invalid_marker",
    "ranked_setup", "challenger", "chart",
  ] as const)("rejects %s through the actual completion mutation and records failure", async (scenario) => {
    const test = await integrationFixture("OPEN", (result) => {
      if (scenario === "changed_frozen_label") result.evidence.session.editionLabel = "Data unavailable";
      if (scenario === "changed_frozen_session") {
        result.evidence.session.sessionType = "CLOSED";
        result.edition.sessionType = "CLOSED";
      }
      if (scenario === "missing_marker") {
        result.evidence.evidence = result.evidence.evidence.filter((item) => item.evidenceId !== unavailableId);
      }
      if (scenario === "invalid_marker") {
        const marker = result.evidence.evidence.find((item) => item.evidenceId === unavailableId);
        if (!marker) throw new Error("Missing fixture marker.");
        marker.sourcePolicy = "approved";
      }
      if (scenario === "ranked_setup" || scenario === "chart") result.edition.primaryBoard = [rankedSetup("AAPL")];
      if (scenario === "challenger") result.edition.challengers = [rankedSetup("DIA")];
      if (scenario === "chart") result.edition.chartRequests = [{
        chartRequestId: "chart-fixture", editionId: result.editionId, sectionId: "primary-board",
        symbol: "AAPL", timeframe: "daily", start: "2026-08-01T12:00:00.000Z", end: result.completedAt,
        session: "regular", overlays: [], annotations: [], reason: "Synthetic chart.", priority: 90,
        sourceEvidenceIds: [unavailableId], dataAsOf: result.completedAt,
      }];
    });
    await expect(test.runner.run(test.job)).rejects.toThrow("market_research_convex_rejected");
    expect(test.wire).toContainEqual({ operation: "complete", status: 409 });
    expect(test.wire).toContainEqual({ operation: "fail", status: 200 });
    expect(test.db.rows("marketResearchEditions")[0]?.status).not.toBe("ready_to_publish");
    expect(test.db.rows("marketResearchDeliveries")).toHaveLength(0);
    const candidate = test.completionCandidates[0]!;
    if (scenario !== "changed_frozen_label" && scenario !== "changed_frozen_session") {
      expect(marketResearchPiResultRecordSchema.safeParse(candidate).success).toBe(false);
      expect(() => validateComposedEdition(candidate.edition, candidate.evidence, test.job.preferences)).toThrow();
    }
    expect(test.providerCall).not.toHaveBeenCalled();
    await test.runner.dispose();
  });
});
