import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexMarketResearchClient } from "../src/market-research/convex-client.js";
import type { MarketResearchJobResult } from "../src/market-research/contracts.js";
import type { ExaCostEvent } from "../src/market-research/exa-client.js";

const claim = { ownerId: "owner_1", editionId: "edition_1", generation: 1, claimToken: "claim_1" };
const event: ExaCostEvent = {
  operation: "search", outcome: "settled", costUsd: 0.01,
  late: false, observedAt: "2026-09-07T18:00:00Z",
};

function fixture(timeoutMs = 1_000) {
  const requests: {
    body: string;
    response: ReturnType<typeof Promise.withResolvers<Response>>;
    signal: AbortSignal | null | undefined;
  }[] = [];
  let active = 0;
  let maximumActive = 0;
  const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
    const response = Promise.withResolvers<Response>();
    const signal = init?.signal;
    const abort = () => response.reject(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    requests.push({ body: String(init?.body), response, signal });
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    try {
      return await response.promise;
    } finally {
      active -= 1;
      signal?.removeEventListener("abort", abort);
    }
  });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const callbacks = new ConvexMarketResearchClient({
    siteUrl: "https://convex.invalid", sharedSecret: "unit-test-callback-secret",
    timeoutMs, logger, fetch: fetchImpl,
  });
  return { callbacks, fetchImpl, requests, logger, maximumActive: () => maximumActive };
}

function accept(test: ReturnType<typeof fixture>, index: number) {
  test.requests[index]!.response.resolve(Response.json({ accepted: true, evidence: [] }));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("market research edition callback queue", () => {
  it("serializes all callback kinds and older-generation costs for the same edition", async () => {
    const test = fixture();
    const observe = test.callbacks.costObserver(claim);
    const nextGeneration = { ...claim, generation: 2, claimToken: "claim_2" };
    const work = [
      observe(event),
      test.callbacks.appendEvidence(nextGeneration, 0, []),
      test.callbacks.appendEvidence(nextGeneration, 1, []),
      test.callbacks.heartbeat(nextGeneration, "collecting"),
      test.callbacks.loadEvidence(nextGeneration),
      test.callbacks.fail(nextGeneration, "exa_unavailable", true),
      observe({ ...event, late: true }),
    ];
    const operations = [
      "recordExaCostEvent", "appendEvidence", "appendEvidence", "heartbeat",
      "loadEvidence", "fail", "recordExaCostEvent",
    ];
    for (const [index, operation] of operations.entries()) {
      await vi.advanceTimersByTimeAsync(0);
      expect(test.requests).toHaveLength(index + 1);
      expect(JSON.parse(test.requests[index]!.body)).toMatchObject({ operation, editionId: claim.editionId });
      accept(test, index);
    }
    await Promise.all(work);
    expect(JSON.parse(test.requests.at(-1)!.body)).toMatchObject({ ...claim, event: { late: true } });
    expect(test.maximumActive()).toBe(1);
    expect(test.callbacks).toHaveProperty("pendingEditions", new Map());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows different editions to send callbacks concurrently", async () => {
    const test = fixture();
    const first = test.callbacks.heartbeat(claim, "collecting");
    const second = test.callbacks.heartbeat({ ...claim, editionId: "edition_2" }, "collecting");
    await vi.advanceTimersByTimeAsync(0);
    expect(test.requests).toHaveLength(2);
    expect(test.maximumActive()).toBe(2);
    accept(test, 1);
    await second;
    accept(test, 0);
    await first;
    expect(test.callbacks).toHaveProperty("pendingEditions", new Map());
  });

  it("recovers the queue after a rejected callback without retrying HTTP 400", async () => {
    const test = fixture();
    const failed = test.callbacks.appendEvidence(claim, 0, []).catch((error: Error) => error);
    const next = test.callbacks.heartbeat(claim, "collecting");
    await vi.advanceTimersByTimeAsync(0);
    test.requests[0]!.response.resolve(Response.json({ accepted: false }, { status: 400 }));
    await expect(failed).resolves.toMatchObject({ message: "market_research_convex_rejected" });
    await vi.advanceTimersByTimeAsync(0);
    expect(test.requests).toHaveLength(2);
    expect(JSON.parse(test.requests[1]!.body)).toMatchObject({ operation: "heartbeat" });
    accept(test, 1);
    await expect(next).resolves.toBe(true);
    expect(test.maximumActive()).toBe(1);
    expect(test.callbacks).toHaveProperty("pendingEditions", new Map());
    expect(test.logger.error).toHaveBeenCalledWith("market_research_convex_operation_failed", {
      operation: "appendEvidence", httpStatus: 400, code: "market_research_convex_rejected",
    });
  });

  it("does not POST cancelled queued or already-aborted callbacks", async () => {
    const test = fixture();
    const controller = new AbortController();
    const reason = new Error("edition_lease_lost");
    const first = test.callbacks.heartbeat(claim, "collecting");
    const cancelled = test.callbacks.appendEvidence(claim, 0, [], controller.signal).catch((error: Error) => error);
    const next = test.callbacks.heartbeat(claim, "composing");
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(reason);
    accept(test, 0);
    await expect(first).resolves.toBe(true);
    await expect(cancelled).resolves.toBe(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(test.requests).toHaveLength(2);
    expect(JSON.parse(test.requests[1]!.body)).toMatchObject({ operation: "heartbeat", stage: "composing" });
    accept(test, 1);
    await next;
    await expect(test.callbacks.loadEvidence(claim, controller.signal)).rejects.toBe(reason);
    expect(test.requests).toHaveLength(2);
    expect(test.callbacks).toHaveProperty("pendingEditions", new Map());
  });

  it("waits for prior evidence and all queued cost deliveries before completing", async () => {
    const test = fixture();
    const observe = test.callbacks.costObserver(claim);
    // SAFETY: This mock transport only inspects the result's edition key. Result-schema
    // validation is covered by the contract suite; the unused report fields are omitted.
    const result = {
      editionId: claim.editionId, generation: claim.generation, claimToken: claim.claimToken,
    } as MarketResearchJobResult;
    const writes = [
      test.callbacks.appendEvidence(claim, 0, []),
      observe(event),
      observe({ ...event, operation: "contents" }),
    ];
    const completion = test.callbacks.complete(result);
    await vi.advanceTimersByTimeAsync(0);
    accept(test, 0);
    await vi.advanceTimersByTimeAsync(0);
    test.requests[1]!.response.reject(new Error("simulated_lost_acknowledgement"));
    await vi.advanceTimersByTimeAsync(99);
    expect(test.requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(test.requests).toHaveLength(3);
    expect(test.requests[2]!.body).toBe(test.requests[1]!.body);
    accept(test, 2);
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(test.requests[3]!.body)).toMatchObject({ operation: "recordExaCostEvent", event: { operation: "contents" } });
    accept(test, 3);
    await Promise.all(writes);
    await vi.advanceTimersByTimeAsync(0);
    expect(test.requests).toHaveLength(5);
    expect(JSON.parse(test.requests[4]!.body)).toEqual({ operation: "complete", result });
    accept(test, 4);
    await expect(completion).resolves.toBe(true);
    expect(test.maximumActive()).toBe(1);
    expect(test.callbacks).toHaveProperty("pendingEditions", new Map());
  });

  it("starts each callback timeout at admission, not while queued", async () => {
    const test = fixture(20);
    const first = test.callbacks.heartbeat(claim, "collecting");
    const second = test.callbacks.appendEvidence(claim, 0, []);
    await vi.advanceTimersByTimeAsync(15);
    expect(test.requests).toHaveLength(1);
    accept(test, 0);
    await first;
    await vi.advanceTimersByTimeAsync(19);
    expect(test.requests).toHaveLength(2);
    expect(test.requests[1]!.signal?.aborted).toBe(false);
    accept(test, 1);
    await expect(second).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the queue after an active timeout or caller cancellation", async () => {
    const test = fixture(20);
    const controller = new AbortController();
    const timedOut = test.callbacks.heartbeat(claim, "collecting").catch((error: Error) => error);
    const cancelled = test.callbacks.appendEvidence(claim, 0, [], controller.signal).catch((error: Error) => error);
    const next = test.callbacks.heartbeat(claim, "composing");
    await vi.advanceTimersByTimeAsync(20);
    expect(await timedOut).toMatchObject({ name: "AbortError" });
    expect(test.requests).toHaveLength(2);
    const reason = new Error("edition_lease_lost");
    controller.abort(reason);
    await expect(cancelled).resolves.toBe(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(test.requests).toHaveLength(3);
    accept(test, 2);
    await expect(next).resolves.toBe(true);
    expect(test.maximumActive()).toBe(1);
    expect(test.callbacks).toHaveProperty("pendingEditions", new Map());
    expect(vi.getTimerCount()).toBe(0);
  });
});
