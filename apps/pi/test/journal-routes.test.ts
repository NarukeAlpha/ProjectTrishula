import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp, type AppRunRegistry } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { JournalRunRequest } from "../src/journal/contracts.js";
import { JournalJobRegistry } from "../src/journal/jobs.js";
import type { JournalAgentRunner } from "../src/journal/runner.js";
import type { Logger } from "../src/runtime/logger.js";
import { startExecutionService } from "../src/service.js";
import { TestExecutor } from "./helpers.js";

const secret = "a-secure-service-secret-with-32-chars";
const discordSecret = "an-independent-discord-secret-with-32-chars";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function makeRegistry(): AppRunRegistry {
  return {
    isAccepting: () => true,
    reserve: () => ({ type: "accepted", state: "reserved" }),
    start: () => undefined,
    cancel: () => "cancellation_requested",
  };
}

function makeJournalRunRequest(overrides: Partial<JournalRunRequest> = {}): JournalRunRequest {
  return {
    runId: "jrun-1",
    ownerId: "user_friend_allowlisted",
    runToken: "signed-run-capability-token",
    settings: {
      brokerTimeZone: "America/Puerto_Rico",
      updatedAt: 1_700_000_000_000,
    },
    userMessage: {
      stableId: "msg-user-1",
      ordinal: 1,
      role: "user",
      text: "Review my QQQ trade from today.",
      attachments: [],
      status: "completed",
      createdAt: 1_700_000_001_000,
      updatedAt: 1_700_000_001_000,
    },
    history: [],
    ...overrides,
  };
}

describe("journal HTTP routes and job registry", () => {
  it("requires service bearer auth on journal start and cancel routes", async () => {
    const runner: JournalAgentRunner = {
      initialize: vi.fn(async () => undefined),
      readiness: vi.fn(() => ({ ready: true, chartImgConfigured: false })),
      run: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    const journalJobs = new JournalJobRegistry({ runner, logger: silentLogger });
    const app = createApp({
      sharedSecret: secret,
      discordSharedSecret: discordSecret,
      executor: new TestExecutor(),
      registry: makeRegistry(),
      boundActorId: "user_primary_owner",
      journal: runner,
      journalJobs,
    });

    const startRes = await request(app).post("/v1/journal/runs").send(makeJournalRunRequest());
    expect(startRes.status).toBe(401);

    const cancelRes = await request(app)
      .post("/v1/journal/runs/jrun-1/cancel")
      .send({ ownerId: "user_friend_allowlisted", runId: "jrun-1" });
    expect(cancelRes.status).toBe(401);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("keeps /health healthy when CHART_IMG_API_KEY is unset and exposes no secret values", async () => {
    const runner: JournalAgentRunner = {
      initialize: vi.fn(async () => undefined),
      readiness: vi.fn(() => ({ ready: true, chartImgConfigured: false })),
      run: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    const journalJobs = new JournalJobRegistry({ runner, logger: silentLogger });
    const app = createApp({
      sharedSecret: secret,
      discordSharedSecret: discordSecret,
      executor: new TestExecutor(),
      registry: makeRegistry(),
      journal: runner,
      journalJobs,
    });

    const health = await request(app).get("/health");
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
    expect(health.body.journal).toEqual({ ready: true, chartImgConfigured: false });
  });

  it("accepts runs from any allowlisted ownerId regardless of boundActorId", async () => {
    let releaseRun: (() => void) | undefined;
    const runSpy = vi.fn(
      async () =>
        new Promise<void>((resolve) => {
          releaseRun = resolve;
        }),
    );
    const runner: JournalAgentRunner = {
      initialize: vi.fn(async () => undefined),
      readiness: vi.fn(() => ({ ready: true, chartImgConfigured: true })),
      run: runSpy,
      dispose: vi.fn(async () => undefined),
    };
    const journalJobs = new JournalJobRegistry({ runner, logger: silentLogger });
    const app = createApp({
      sharedSecret: secret,
      discordSharedSecret: discordSecret,
      executor: new TestExecutor(),
      registry: makeRegistry(),
      boundActorId: "user_primary_owner",
      journal: runner,
      journalJobs,
    });

    const payload = makeJournalRunRequest({
      runId: "jrun-friend-1",
      ownerId: "user_friend_other",
    });

    const response = await request(app)
      .post("/v1/journal/runs")
      .set("authorization", `Bearer ${secret}`)
      .send(payload);

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ accepted: true, runId: "jrun-friend-1" });
    expect(runSpy).toHaveBeenCalledTimes(1);

    releaseRun?.();
    await journalJobs.waitForIdle();
  });

  it("validates journal run and cancel payloads strictly", async () => {
    const runner: JournalAgentRunner = {
      initialize: vi.fn(async () => undefined),
      readiness: vi.fn(() => ({ ready: true, chartImgConfigured: true })),
      run: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    const journalJobs = new JournalJobRegistry({ runner, logger: silentLogger });
    const app = createApp({
      sharedSecret: secret,
      discordSharedSecret: discordSecret,
      executor: new TestExecutor(),
      registry: makeRegistry(),
      journal: runner,
      journalJobs,
    });

    const badStart = await request(app)
      .post("/v1/journal/runs")
      .set("authorization", `Bearer ${secret}`)
      .send({ ...makeJournalRunRequest(), extraField: "not-allowed" });
    expect(badStart.status).toBe(400);

    const mismatchedCancel = await request(app)
      .post("/v1/journal/runs/jrun-1/cancel")
      .set("authorization", `Bearer ${secret}`)
      .send({ ownerId: "user_friend_allowlisted", runId: "jrun-2" });
    expect(mismatchedCancel.status).toBe(400);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("deduplicates an already-active runId idempotently and returns 202", async () => {
    let releaseRun: (() => void) | undefined;
    const runSpy = vi.fn(
      async () =>
        new Promise<void>((resolve) => {
          releaseRun = resolve;
        }),
    );
    const runner: JournalAgentRunner = {
      initialize: vi.fn(async () => undefined),
      readiness: vi.fn(() => ({ ready: true, chartImgConfigured: true })),
      run: runSpy,
      dispose: vi.fn(async () => undefined),
    };
    const journalJobs = new JournalJobRegistry({ runner, logger: silentLogger });
    const app = createApp({
      sharedSecret: secret,
      discordSharedSecret: discordSecret,
      executor: new TestExecutor(),
      registry: makeRegistry(),
      journal: runner,
      journalJobs,
    });

    const payload = makeJournalRunRequest({ runId: "jrun-dup-1" });
    const first = await request(app)
      .post("/v1/journal/runs")
      .set("authorization", `Bearer ${secret}`)
      .send(payload);
    const second = await request(app)
      .post("/v1/journal/runs")
      .set("authorization", `Bearer ${secret}`)
      .send(payload);

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body).toEqual({ accepted: true, runId: "jrun-dup-1" });
    expect(runSpy).toHaveBeenCalledTimes(1);

    // Different owner attempting to reuse an active runId gets 409 conflict
    const crossOwner = await request(app)
      .post("/v1/journal/runs")
      .set("authorization", `Bearer ${secret}`)
      .send(makeJournalRunRequest({ runId: "jrun-dup-1", ownerId: "other_user" }));
    expect(crossOwner.status).toBe(409);

    releaseRun?.();
    await journalJobs.waitForIdle();

    // Retrying the same runId after completion remains idempotent and does not re-execute
    const postCompleteRetry = await request(app)
      .post("/v1/journal/runs")
      .set("authorization", `Bearer ${secret}`)
      .send(payload);
    expect(postCompleteRetry.status).toBe(202);
    expect(postCompleteRetry.body).toEqual({ accepted: true, runId: "jrun-dup-1" });
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it("honors cancel-before-start tombstones without launching work", async () => {
    const runSpy = vi.fn(async () => undefined);
    const runner: JournalAgentRunner = {
      initialize: vi.fn(async () => undefined),
      readiness: vi.fn(() => ({ ready: true, chartImgConfigured: true })),
      run: runSpy,
      dispose: vi.fn(async () => undefined),
    };
    const journalJobs = new JournalJobRegistry({ runner, logger: silentLogger });
    const app = createApp({
      sharedSecret: secret,
      discordSharedSecret: discordSecret,
      executor: new TestExecutor(),
      registry: makeRegistry(),
      journal: runner,
      journalJobs,
    });

    const cancelRes = await request(app)
      .post("/v1/journal/runs/jrun-early-cancel/cancel")
      .set("authorization", `Bearer ${secret}`)
      .send({ ownerId: "user_friend_allowlisted", runId: "jrun-early-cancel" });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body).toEqual({ canceled: true, runId: "jrun-early-cancel" });

    const startRes = await request(app)
      .post("/v1/journal/runs")
      .set("authorization", `Bearer ${secret}`)
      .send(makeJournalRunRequest({ runId: "jrun-early-cancel" }));
    expect(startRes.status).toBe(202);
    expect(startRes.body).toEqual({ accepted: true, runId: "jrun-early-cancel" });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("aborts an active run when cancel arrives mid-flight", async () => {
    let observedSignal: AbortSignal | undefined;
    let releaseRun: (() => void) | undefined;
    const runSpy = vi.fn(async (_req: JournalRunRequest, signal?: AbortSignal) => {
      observedSignal = signal;
      await new Promise<void>((resolve) => {
        releaseRun = resolve;
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    });
    const runner: JournalAgentRunner = {
      initialize: vi.fn(async () => undefined),
      readiness: vi.fn(() => ({ ready: true, chartImgConfigured: true })),
      run: runSpy,
      dispose: vi.fn(async () => undefined),
    };
    const journalJobs = new JournalJobRegistry({ runner, logger: silentLogger });
    const app = createApp({
      sharedSecret: secret,
      discordSharedSecret: discordSecret,
      executor: new TestExecutor(),
      registry: makeRegistry(),
      journal: runner,
      journalJobs,
    });

    const startRes = await request(app)
      .post("/v1/journal/runs")
      .set("authorization", `Bearer ${secret}`)
      .send(makeJournalRunRequest({ runId: "jrun-live-cancel" }));
    expect(startRes.status).toBe(202);
    expect(observedSignal?.aborted).toBe(false);

    const cancelRes = await request(app)
      .post("/v1/journal/runs/jrun-live-cancel/cancel")
      .set("authorization", `Bearer ${secret}`)
      .send({ ownerId: "user_friend_allowlisted", runId: "jrun-live-cancel" });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body).toEqual({ canceled: true, runId: "jrun-live-cancel" });
    expect(observedSignal?.aborted).toBe(true);

    releaseRun?.();
    await journalJobs.waitForIdle();
  });

  it("isolates journal init failure so /health stays 200 for Pi/Discord while /v1/journal/runs returns 503", async () => {
    const failedJournal: JournalAgentRunner = {
      initialize: vi.fn(async () => {
        throw new Error("Unknown JOURNAL_MODEL");
      }),
      readiness: vi.fn(() => ({
        ready: false,
        reason: "Unknown JOURNAL_MODEL",
        chartImgConfigured: false,
      })),
      run: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };

    const config = {
      ...loadConfig({
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: "8080",
        SERVICE_SHARED_SECRET: secret,
        PI_DISCORD_SHARED_SECRET: discordSecret,
        CONVEX_SITE_URL: "http://convex.internal/http",
      }),
      port: 0,
    };

    const service = await startExecutionService(
      config,
      new TestExecutor(),
      silentLogger,
      undefined,
      undefined,
      undefined,
      failedJournal,
    );

    try {
      const healthRes = await request(service.server).get("/health");
      expect(healthRes.status).toBe(200);
      expect(healthRes.body.ok).toBe(true);
      expect(healthRes.body.journal).toEqual({
        ready: false,
        reason: "Unknown JOURNAL_MODEL",
        chartImgConfigured: false,
      });

      const runRes = await request(service.server)
        .post("/v1/journal/runs")
        .set("authorization", `Bearer ${secret}`)
        .send(makeJournalRunRequest());
      expect(runRes.status).toBe(503);
      expect(runRes.body).toEqual({ error: "Unknown JOURNAL_MODEL" });
    } finally {
      await service.shutdown();
    }
  });
});
