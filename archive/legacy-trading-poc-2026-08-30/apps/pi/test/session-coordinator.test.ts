import { describe, expect, it, vi } from "vitest";
import { SessionCoordinator } from "../src/execution/session-coordinator.js";
import { TestExecutor } from "./helpers.js";

describe("SessionCoordinator", () => {
  it("expires an idle session but never an active session", async () => {
    vi.useFakeTimers();
    const executor = new TestExecutor();
    const sessions = new SessionCoordinator(executor, 60 * 60 * 1_000);
    const scope = { actorId: "tenant:actor", threadId: "thread" };

    sessions.enter(scope);
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1_000);
    expect(executor.disposedSessions).toHaveLength(0);
    sessions.leave(scope);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1_000);
    expect(executor.disposedSessions).toEqual([scope]);
    vi.useRealTimers();
  });
});
