import { describe, expect, it, vi } from "vitest";
import type { PiEvent } from "../src/contracts.js";
import { ConvexClient } from "../src/results/convex-client.js";
import { ResultPublisher } from "../src/results/result-publisher.js";
import { runRequest, silentLogger } from "./helpers.js";

interface BatchEnvelope {
  sequence: number;
  events: PiEvent[];
  finalMessage?: { status: string; parts: unknown[] };
}

function publisherWith(
  fetch: typeof globalThis.fetch,
  overrides: Partial<ConstructorParameters<typeof ResultPublisher>[0]> = {},
): ResultPublisher {
  return new ResultPublisher({
    request: runRequest,
    convex: new ConvexClient({
      siteUrl: "https://convex.example",
      sharedSecret: "secret",
      requestTimeoutMs: 1_000,
      retryAttempts: 1,
      logger: silentLogger,
      fetch,
    }),
    batchWindowMs: 100,
    batchBytes: 1_024,
    logger: silentLogger,
    onLeaseLost: () => undefined,
    ...overrides,
  });
}

function responseFor(body: string): Response {
  const parsed: BatchEnvelope = JSON.parse(body);
  const terminal = parsed.events.at(-1)?.type;
  return Response.json({
    runId: "run_1",
    acceptedThrough: parsed.sequence,
    status: terminal === "completed" ? "completed" : terminal === "error" ? "failed" : terminal === "canceled" ? "canceled" : "streaming",
    leaseExpiresAt: Date.now() + 120_000,
  });
}

describe("ResultPublisher", () => {
  it("sends first visible text immediately and later text after at most 100ms", async () => {
    vi.useFakeTimers();
    const bodies: string[] = [];
    const publisher = publisherWith(async (_input, init) => {
      const body = String(init?.body);
      bodies.push(body);
      return responseFor(body);
    });

    await publisher.emit({ type: "text_delta", text: "Hello" });
    expect(bodies).toHaveLength(1);
    await publisher.emit({ type: "text_delta", text: " world" });
    await vi.advanceTimersByTimeAsync(99);
    expect(bodies).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(bodies).toHaveLength(2);
    const second: BatchEnvelope = JSON.parse(bodies[1]!);
    expect(second.sequence).toBe(2);
    expect(second.events).toEqual([{ type: "text_delta", text: " world" }]);
    publisher.stop();
    vi.useRealTimers();
  });

  it("splits an oversized first visible delta into ordered bounded batches", async () => {
    const bodies: string[] = [];
    const publisher = publisherWith(
      async (_input, init) => {
        const body = String(init?.body);
        bodies.push(body);
        return responseFor(body);
      },
      { batchBytes: 5 },
    );

    await publisher.emit({ type: "text_delta", text: "Hello world" });

    const batches = bodies.map((body): BatchEnvelope => JSON.parse(body));
    expect(batches.map((batch) => batch.sequence)).toEqual([1, 2, 3]);
    expect(batches.map((batch) => batch.events)).toEqual([
      [{ type: "text_delta", text: "Hello" }],
      [{ type: "text_delta", text: " worl" }],
      [{ type: "text_delta", text: "d" }],
    ]);
    publisher.stop();
  });

  it("flushes text before tools and creates one complete terminal message", async () => {
    vi.useFakeTimers();
    const bodies: string[] = [];
    const publisher = publisherWith(async (_input, init) => {
      const body = String(init?.body);
      bodies.push(body);
      return responseFor(body);
    });

    await publisher.emit({ type: "text_delta", text: "Hello" });
    await publisher.emit({ type: "text_delta", text: " world" });
    await publisher.emit({ type: "tool_start", toolCallId: "tool_1", name: "kb_search" });
    await publisher.emit({
      type: "tool_end",
      toolCallId: "tool_1",
      name: "kb_search",
      ok: true,
      outputSummary: "1 match",
      durationMs: 10,
    });
    await publisher.emit({
      type: "completed",
      metrics: {
        inputTokens: 1,
        promptTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 2,
        totalTokens: 3,
        estimatedCostUsd: 0,
        ttftMs: 1,
        timeToFirstOutputMs: 1,
        runDurationMs: 5,
        approximateOutputTps: 2,
      },
    });

    const batches = bodies.map((body): BatchEnvelope => JSON.parse(body));
    expect(batches.map((batch) => batch.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(batches[1]?.events).toEqual([{ type: "text_delta", text: " world" }]);
    expect(batches[2]?.events[0]?.type).toBe("tool_start");
    expect(batches[4]?.finalMessage).toMatchObject({
      status: "completed",
      parts: [
        { type: "text", text: "Hello world" },
        { type: "tool", toolCallId: "tool_1", status: "completed", outputSummary: "1 match" },
      ],
    });
    publisher.stop();
    vi.useRealTimers();
  });

  it("never sends two result requests at one time", async () => {
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const publisher = publisherWith(async (_input, init) => {
      const body = String(init?.body);
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return responseFor(body);
    });

    const first = publisher.emit({ type: "text_delta", text: "Hello" });
    const second = publisher.emit({ type: "tool_start", toolCallId: "tool_1", name: "kb_search" });
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await first;
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    expect(maximum).toBe(1);
    releases.shift()?.();
    await second;
    expect(maximum).toBe(1);
    publisher.stop();
  });

  it("rejects an event after the terminal event", async () => {
    const publisher = publisherWith(async (_input, init) => responseFor(String(init?.body)));
    await publisher.emit({ type: "canceled" });
    await expect(publisher.emit({ type: "text_delta", text: "late" })).rejects.toThrow(/terminal/);
  });

  it("sends a lightweight heartbeat after 30 seconds without an accepted result", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
    const paths: string[] = [];
    const publisher = publisherWith(async (input) => {
      paths.push(String(input));
      return Response.json({
        runId: "run_1",
        status: "running",
        leaseExpiresAt: Date.now() + 120_000,
      });
    });
    publisher.startLiveness();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(paths).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(paths).toEqual(["https://convex.example/service/run-heartbeats"]);
    publisher.stop();
    vi.useRealTimers();
  });

  it("stops the run when heartbeats cannot renew its lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
    const onLeaseLost = vi.fn();
    const publisher = publisherWith(
      async () => { throw new Error("network down"); },
      { onLeaseLost },
    );
    publisher.startLiveness();
    await vi.advanceTimersByTimeAsync(120_001);
    expect(onLeaseLost).toHaveBeenCalledOnce();
    await expect(publisher.emit({ type: "text_delta", text: "late" })).rejects.toThrow(/stopped/);
    vi.useRealTimers();
  });
});
