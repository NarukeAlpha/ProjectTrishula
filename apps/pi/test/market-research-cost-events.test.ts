import { describe, expect, it, vi } from "vitest";
import { ConvexMarketResearchClient } from "../src/market-research/convex-client.js";
import { MarketResearchExaClient, type ExaCostEvent } from "../src/market-research/exa-client.js";

const claim = { ownerId: "owner_1", editionId: "MRP-preview", generation: 1, claimToken: "original-claim" };
const event: ExaCostEvent = {
  operation: "financial_datasets", outcome: "settled", costUsd: 0.25,
  late: true, observedAt: "2026-09-07T12:00:00Z", requestId: "agent-run_1",
};

function client(fetchImpl: typeof fetch) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    logger,
    callbacks: new ConvexMarketResearchClient({
      siteUrl: "https://convex.invalid", sharedSecret: "unit-test-callback-secret",
      timeoutMs: 1_000, logger, fetch: fetchImpl,
    }),
  };
}

describe("durable Exa cost observer", () => {
  it("retries the identical event ID and captures the original owner and claim", async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) throw new Error("simulated_lost_acknowledgement");
      return Response.json({ accepted: true, duplicate: true });
    });
    const { callbacks } = client(fetchImpl);
    const mutableClaim = { ...claim };
    const observer = callbacks.costObserver(mutableClaim);
    mutableClaim.generation = 2;
    mutableClaim.claimToken = "new-claim";
    await observer(event);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect(JSON.parse(bodies[0]!)).toMatchObject({ operation: "recordExaCostEvent", ...claim, event });
    expect(bodies.join()).not.toContain("new-claim");
  });

  it("sends a real SDK callback's late known cost after the work signal is cancelled", async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.signal?.aborted).toBe(false);
      bodies.push(String(init?.body));
      return Response.json({ accepted: true });
    });
    const { callbacks, logger } = client(fetchImpl);
    const provider = Promise.withResolvers<unknown>();
    const runFinancialDataset = vi.fn().mockReturnValue(provider.promise);
    const exa = new MarketResearchExaClient({
      apiKey: "unit-test-exa-key", searchConcurrency: 1, contentsConcurrency: 1,
      requestTimeoutMs: 20_000, maximumSearchRequests: 12, maximumContentPages: 24,
      maximumCostUsd: 1, logger, onCostEvent: callbacks.costObserver(claim),
      transport: { search: vi.fn(), getContents: vi.fn(), runFinancialDataset },
    });
    const controller = new AbortController();
    const work = exa.runFinancialDatasetEvaluation({
      evaluationId: "bounded-evaluation", query: "fixture", outputSchema: {}, maxCostDollars: 1,
    }, controller.signal).catch((error: Error) => error);
    await vi.waitFor(() => expect(runFinancialDataset).toHaveBeenCalledOnce());
    controller.abort(new Error("edition_lease_lost"));
    await work;
    provider.resolve({ id: "agent-run_1", costDollars: { total: 0.25 }, rawSecret: "must-not-be-persisted" });
    await vi.waitFor(() => expect(bodies).toHaveLength(2));
    expect(JSON.parse(bodies[0]!)).toMatchObject({ ...claim, event: { outcome: "abandoned", costUsd: null } });
    expect(JSON.parse(bodies[1]!)).toMatchObject({
      ...claim, event: { operation: "financial_datasets", outcome: "settled", costUsd: 0.25, late: true, requestId: "agent-run_1" },
    });
    expect(bodies.join()).not.toMatch(/unit-test-exa-key|must-not-be-persisted|rawSecret/);
    expect(runFinancialDataset).toHaveBeenCalledOnce();
  });

  it("serializes delivery and allows later events after a bounded callback failure", async () => {
    let calls = 0;
    let active = 0;
    let maximumActive = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return Response.json({ accepted: calls > 3 });
    });
    const { callbacks } = client(fetchImpl);
    const observer = callbacks.costObserver(claim);
    const failed = observer(event).catch((error: Error) => error);
    const next = observer({ ...event, operation: "contents" });
    expect(await failed).toMatchObject({ message: "market_research_cost_event_delivery_failed" });
    await next;
    expect(calls).toBe(4);
    expect(maximumActive).toBe(1);
  });

  it("bounds queued events and omits provider IDs that violate the safe metadata policy", async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      bodies.push(String(init?.body));
      return Response.json({ accepted: true });
    });
    const { callbacks } = client(fetchImpl);
    const observer = callbacks.costObserver(claim);
    const deliveries = Array.from({ length: 1_024 }, () => observer({ ...event, requestId: "raw\nprovider text" }));
    await expect(observer(event)).rejects.toThrow("market_research_cost_event_limit");
    await Promise.all(deliveries);
    expect(bodies).toHaveLength(1_024);
    expect(bodies.join()).not.toContain("requestId");
  });
});
