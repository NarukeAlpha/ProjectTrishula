import { describe, expect, it, vi } from "vitest";
import type { ConvexClientLike } from "../src/results/convex-client.js";
import { RunRegistry } from "../src/execution/run-registry.js";
import { SessionCoordinator } from "../src/execution/session-coordinator.js";
import { TestExecutor, runRequest, silentLogger } from "./helpers.js";

interface RegistryFixture {
  registry: RunRegistry;
  executor: TestExecutor;
  sendResult: ReturnType<typeof vi.fn>;
}

function createRegistry(concurrency = 1): RegistryFixture {
  const executor = new TestExecutor();
  const sessions = new SessionCoordinator(executor);
  const sendResult = vi.fn(async (batch: { runId: string; sequence: number; events: Array<{ type: string }> }) => ({
      runId: batch.runId,
      acceptedThrough: batch.sequence,
      status: batch.events.at(-1)?.type === "canceled"
        ? "canceled"
        : batch.events.at(-1)?.type === "error"
          ? "failed"
          : "streaming",
      leaseExpiresAt: Date.now() + 120_000,
    } as const));
  const convexValue = {
    sendResult,
    sendHeartbeat: vi.fn(),
  };
  const convex = convexValue satisfies ConvexClientLike;
  return {
    executor,
    sendResult,
    registry: new RunRegistry({
      executor,
      sessions,
      convex,
      concurrency,
      batchWindowMs: 100,
      batchBytes: 1_024,
      logger: silentLogger,
    }),
  };
}

describe("RunRegistry", () => {
  it("accepts an identical run once and rejects changed reuse", () => {
    const { registry, executor } = createRegistry();
    expect(registry.reserve(runRequest)).toEqual({ type: "accepted", state: "reserved" });
    expect(executor.requests).toHaveLength(0);
    registry.start("run_1");
    expect(registry.reserve(runRequest)).toEqual({ type: "duplicate", state: "running" });
    expect(registry.reserve({ ...runRequest, prompt: "changed" })).toEqual({ type: "conflict" });
    expect(executor.requests).toHaveLength(1);
  });

  it("rejects a second thread when global capacity is full", () => {
    const { registry } = createRegistry(1);
    expect(registry.reserve(runRequest).type).toBe("accepted");
    expect(registry.reserve({
      ...runRequest,
      runId: "run_2",
      commandId: "command_2",
      threadId: "thread_2",
    })).toEqual({ type: "capacity" });
  });

  it("rejects a second run for the same actor and thread", () => {
    const { registry } = createRegistry(2);
    expect(registry.reserve(runRequest).type).toBe("accepted");
    expect(registry.reserve({
      ...runRequest,
      runId: "run_2",
      commandId: "command_2",
    })).toEqual({ type: "thread_busy" });
  });

  it("cancels the exact run and disposes its session", async () => {
    const { registry, executor } = createRegistry();
    registry.reserve(runRequest);
    registry.start("run_1");
    expect(registry.cancel("run_1", runRequest.actorId)).toBe("cancellation_requested");
    await registry.waitForIdle();
    expect(executor.disposedSessions).toContainEqual({ actorId: "tenant_1:actor_1", threadId: "thread_1" });
  });

  it("does not let another actor cancel a reserved run", () => {
    const { registry } = createRegistry();
    registry.reserve(runRequest);
    expect(registry.cancel("run_1", "other_actor")).toBe("not_found");
    expect(registry.cancel("run_1", runRequest.actorId)).toBe("cancellation_requested");
  });

  it("writes backend_restarting before graceful shutdown finishes", async () => {
    const { registry, sendResult } = createRegistry();
    registry.reserve(runRequest);
    registry.start("run_1");
    await registry.shutdown();
    await registry.waitForIdle();
    expect(sendResult).toHaveBeenCalledWith(expect.objectContaining({
      events: [expect.objectContaining({ type: "error", code: "backend_restarting" })],
      finalMessage: expect.objectContaining({ status: "failed" }),
    }));
  });
});
