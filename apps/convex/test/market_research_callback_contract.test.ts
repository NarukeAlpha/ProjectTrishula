import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexMarketResearchClient } from "../../pi/src/market-research/convex-client.js";
import {
  MARKET_RESEARCH_MAX_CHECKPOINT_BYTES,
  marketResearchEvidenceItemSchema,
  marketResearchJobRequestSchema,
} from "../../pi/src/market-research/contracts.js";
import { evidenceCheckpoints } from "../../pi/src/market-research/source-normalizer-evidence.js";
import { claimResearch, manualTrigger, saveControlSettings } from "../convex/market_research.js";
import { marketResearchPi, marketResearchPiRequestSchema } from "../convex/market_research_http.js";
import { convexMutationFixture, invokeMutation } from "./helpers/convex-fixture.js";

const callbackSecret = "callback-contract-test-secret-not-a-real-credential";
const now = Date.parse("2026-09-07T18:00:00Z");
const evidence = marketResearchEvidenceItemSchema.parse({
  evidenceId: "source-status-1",
  kind: "source_status",
  provider: "Project Trishula",
  sourcePolicy: "approved",
  retrievedAt: "2026-09-07T18:00:00Z",
  freshness: "fresh",
  contentStatus: "available",
  highlights: [],
  normalizedClaims: ["Synthetic callback contract evidence."],
  contentHash: "a".repeat(64),
});

async function fullJobRequest() {
  const db = convexMutationFixture();
  db.rows("discordChannels").push({
    _id: "channel-1", ownerId: "owner_1", guildId: "guild_1", channelId: "forum_1",
    available: true, type: "forum", canView: true, canCreateForumPost: true,
    canSendInThreads: true, canReadThreadHistory: true, canAttachFiles: true,
    requiresTag: false,
  });
  await invokeMutation(saveControlSettings, db.ctx, {
    guildId: "guild_1", forumChannelId: "forum_1", forumTagIds: [],
    timezone: "America/New_York", timezoneConfirmed: true,
    localHour: 8, localMinute: 0, includeWeekends: true,
    editionDepth: "full", maximumRankedSetups: 10,
    includeCharts: true, maximumCharts: 3, enabled: false,
  });
  const edition = await invokeMutation(manualTrigger, db.ctx, {
    guildId: "guild_1", dryRun: false, publish: true,
    regeneratePublishedEdition: false, requestId: "callback-contract-test",
  });
  return marketResearchJobRequestSchema.parse(await invokeMutation(claimResearch, db.ctx, {
    editionId: edition.editionId, workerId: "callback-contract-worker",
  }));
}

function callbackFixture() {
  const runMutation = vi.fn(async () => ({ accepted: true }));
  const runQuery = vi.fn(async () => ({ accepted: true, evidence: [evidence] }));
  const context = { runMutation, runQuery };
  // SAFETY: Convex 1.43.0 registers the original HTTP callback on _handler.
  // This action uses only the two internal dispatch methods supplied above.
  const action = marketResearchPi as typeof marketResearchPi & {
    _handler: (ctx: typeof context, request: Request) => Promise<Response>;
  };
  const bodies: string[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
    const request = new Request(url, init);
    bodies.push(await request.clone().text());
    return action._handler(context, request);
  });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const client = new ConvexMarketResearchClient({
    siteUrl: "https://convex.invalid/http", sharedSecret: callbackSecret,
    timeoutMs: 1_000, logger, fetch: fetchImpl,
  });
  return { client, bodies, runMutation, runQuery, logger, fetchImpl };
}

beforeEach(() => {
  vi.stubEnv("WORKOS_ALLOWED_USER_IDS", "owner_1");
  vi.stubEnv("MARKET_RESEARCH_OWNER_ID", "owner_1");
  vi.stubEnv("SERVICE_SHARED_SECRET", callbackSecret);
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("full Pi job to strict Convex callback contract", () => {
  it.each(["heartbeat", "loadEvidence", "appendEvidence", "fail"] as const)(
    "%s projects the lease before the actual HTTP handler validates it",
    async (operation) => {
      const job = await fullJobRequest();
      const test = callbackFixture();
      const lease = { editionId: job.editionId, generation: job.generation, claimToken: job.claimToken };
      expect(job.preferences.primarySymbols).toContain("AAPL");
      expect(job.session).toBeDefined();
      expect(job.dispatchId).toBeDefined();

      switch (operation) {
        case "heartbeat":
          await expect(test.client.heartbeat(job, "collecting")).resolves.toBe(true);
          expect(test.runMutation).toHaveBeenCalledWith(expect.anything(), { ...lease, stage: "collecting" });
          break;
        case "loadEvidence":
          await expect(test.client.loadEvidence(job)).resolves.toEqual([evidence]);
          expect(test.runQuery).toHaveBeenCalledWith(expect.anything(), lease);
          break;
        case "appendEvidence":
          await expect(test.client.appendEvidence(job, 0, [evidence])).resolves.toBe(true);
          expect(test.runMutation).toHaveBeenCalledWith(expect.anything(), { ...lease, sequence: 0, evidence: [evidence] });
          break;
        case "fail":
          await expect(test.client.fail(job, "exa_unavailable", false)).resolves.toBeUndefined();
          expect(test.runMutation).toHaveBeenCalledWith(expect.anything(), { ...lease, code: "exa_unavailable", retryable: false });
          break;
      }

      expect(test.bodies).toHaveLength(1);
      const payload = marketResearchPiRequestSchema.parse(JSON.parse(test.bodies[0]!));
      expect(payload).toMatchObject({ operation, ...lease });
      for (const field of Object.keys(job).filter((field) => !Object.hasOwn(lease, field))) {
        expect(payload).not.toHaveProperty(field);
      }
      expect(test.logger.error).not.toHaveBeenCalled();
    },
  );

  it("rejects the former full-job spread at the real HTTP boundary before internal dispatch", async () => {
    const job = await fullJobRequest();
    const test = callbackFixture();
    for (const payload of [
      { operation: "heartbeat", ...job, stage: "collecting" },
      { operation: "loadEvidence", ...job },
      { operation: "appendEvidence", ...job, sequence: 0, evidence: [evidence] },
      { operation: "fail", ...job, code: "exa_unavailable", retryable: false },
    ]) {
      const parsed = marketResearchPiRequestSchema.safeParse(payload);
      expect(parsed.success).toBe(false);
      const response = await test.fetchImpl("https://convex.invalid/http/market-research/pi", {
        method: "POST",
        headers: { authorization: `Bearer ${callbackSecret}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(response.status).toBe(400);
    }
    expect(test.runMutation).not.toHaveBeenCalled();
    expect(test.runQuery).not.toHaveBeenCalled();
  });

  it.each([65, 129])("sends all %i compact records through the actual HTTP record cap", async (count) => {
    const job = await fullJobRequest();
    const test = callbackFixture();
    const records = Array.from({ length: count }, (_, index) => ({
      ...evidence, evidenceId: `compact-source-${index}`,
    }));
    expect(Buffer.byteLength(JSON.stringify(records))).toBeLessThan(MARKET_RESEARCH_MAX_CHECKPOINT_BYTES);
    const checkpoints = evidenceCheckpoints(records);
    for (const [sequence, checkpoint] of checkpoints.entries()) {
      await expect(test.client.appendEvidence(job, sequence, checkpoint)).resolves.toBe(true);
    }
    expect(test.runMutation).toHaveBeenCalledTimes(Math.ceil(count / 64));
    const sentRecords = test.bodies.flatMap((body, sequence) => {
      const payload = marketResearchPiRequestSchema.parse(JSON.parse(body));
      if (payload.operation !== "appendEvidence") throw new Error("Unexpected fixture operation.");
      expect(payload.sequence).toBe(sequence);
      expect(payload.evidence.length).toBeLessThanOrEqual(64);
      expect(Buffer.byteLength(JSON.stringify(payload.evidence))).toBeLessThanOrEqual(MARKET_RESEARCH_MAX_CHECKPOINT_BYTES);
      return payload.evidence;
    });
    expect(sentRecords).toEqual(records);
    expect(test.logger.error).not.toHaveBeenCalled();
  });

  it("keeps cost accounting bound to its explicitly projected owner and lease", async () => {
    const job = await fullJobRequest();
    const test = callbackFixture();
    await test.client.costObserver(job)({
      operation: "search", outcome: "settled", costUsd: 0.01,
      late: false, observedAt: "2026-09-07T18:00:00Z", requestId: "synthetic-provider-request",
    });
    expect(test.bodies).toHaveLength(1);
    const payload = marketResearchPiRequestSchema.parse(JSON.parse(test.bodies[0]!));
    expect(payload).toMatchObject({
      operation: "recordExaCostEvent", ownerId: job.ownerId,
      editionId: job.editionId, generation: job.generation, claimToken: job.claimToken,
      event: { operation: "search", costUsd: 0.01 },
    });
    expect(Object.keys(payload).sort()).toEqual([
      "claimToken", "editionId", "event", "generation", "operation", "ownerId",
    ]);
    expect(test.runMutation).toHaveBeenCalledOnce();
    expect(test.logger.error).not.toHaveBeenCalled();
  });
});
