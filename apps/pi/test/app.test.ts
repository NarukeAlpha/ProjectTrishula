import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import type { AppRunRegistry } from "../src/app.js";
import type { TradingBroker } from "../src/broker/types.js";
import { TestExecutor, runRequest } from "./helpers.js";

const secret = "a-secure-service-secret-with-32-chars";
type ReserveStubResult = { type: "accepted" | "duplicate"; state: "reserved" };

function makeRegistry() {
  const value = {
    isAccepting: vi.fn(() => true),
    reserve: vi.fn((): ReserveStubResult => ({ type: "accepted", state: "reserved" })),
    start: vi.fn(),
    cancel: vi.fn((_runId: string, _actorId: string) => "cancellation_requested" as const),
  };
  return value satisfies AppRunRegistry;
}

function makeBroker(): TradingBroker {
  return {
    startConnection: vi.fn(async () => ({ status: "authorization_required" as const, authorizationUrl: "https://example.com/auth" })),
    completeConnection: vi.fn(async () => ({ status: "connected" as const })),
    connectionStatus: vi.fn(async () => ({ status: "connected" as const })),
    disconnect: vi.fn(async () => ({ status: "disconnected" as const })),
    refreshPortfolio: vi.fn(async () => ({
      capturedAt: 1,
      totalEquity: 0,
      buyingPower: 0,
      cash: 0,
      dayChange: 0,
      dayChangePercent: 0,
      positions: [],
    })),
    proposeOrder: vi.fn(async () => {
      throw new Error("Not used by the HTTP app.");
    }),
    executeOrder: vi.fn(async () => ({ status: "failed" as const, errorCode: "not_enabled" })),
    callApplicationTool: vi.fn(async () => ({})),
    dispose: vi.fn(async () => undefined),
  };
}

describe("execution HTTP API", () => {
  it("does not parse or accept an unauthorized run", async () => {
    const executor = new TestExecutor();
    const registry = makeRegistry();
    const response = await request(createApp({ sharedSecret: secret, executor, registry }))
      .post("/runs")
      .send(runRequest);
    expect(response.status).toBe(401);
    expect(registry.reserve).not.toHaveBeenCalled();
  });

  it("returns 202 after a valid run is registered", async () => {
    const executor = new TestExecutor();
    const registry = makeRegistry();
    const response = await request(createApp({ sharedSecret: secret, executor, registry }))
      .post("/runs")
      .set("authorization", `Bearer ${secret}`)
      .send(runRequest);
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ runId: "run_1", status: "accepted" });
    expect(registry.reserve).toHaveBeenCalledWith(runRequest);
    expect(registry.start).toHaveBeenCalledWith("run_1");
  });

  it("accepts opaque provider tool-call IDs in conversation history", async () => {
    const executor = new TestExecutor();
    const registry = makeRegistry();
    const requestWithToolHistory = {
      ...runRequest,
      history: [
        {
          messageId: "message_1",
          role: "assistant" as const,
          parts: [
            {
              type: "tool" as const,
              toolCallId: "call_provider-id|fc_provider-id",
              name: "get_equity_positions",
              status: "completed" as const,
            },
          ],
        },
      ],
    };

    const response = await request(
      createApp({ sharedSecret: secret, executor, registry }),
    )
      .post("/runs")
      .set("authorization", `Bearer ${secret}`)
      .send(requestWithToolHistory);

    expect(response.status).toBe(202);
    expect(registry.reserve).toHaveBeenCalledWith(requestWithToolHistory);
  });

  it("restarts a reserved duplicate only after its response finishes", async () => {
    const executor = new TestExecutor();
    const registry = makeRegistry();
    vi.mocked(registry.reserve).mockReturnValue({ type: "duplicate", state: "reserved" });
    const response = await request(createApp({ sharedSecret: secret, executor, registry }))
      .post("/runs")
      .set("authorization", `Bearer ${secret}`)
      .send(runRequest);
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ duplicate: true, status: "accepted" });
    expect(registry.start).toHaveBeenCalledWith("run_1");
  });

  it("returns 503 readiness when the executor is not ready", async () => {
    const executor = new TestExecutor();
    executor.ready = false;
    const response = await request(createApp({ sharedSecret: secret, executor, registry: makeRegistry() }))
      .get("/health");
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ ok: false });
  });

  it("accepts cancellation without waiting for Pi to stop", async () => {
    const executor = new TestExecutor();
    const registry = makeRegistry();
    const response = await request(createApp({ sharedSecret: secret, executor, registry }))
      .post("/runs/run_1/cancel")
      .set("authorization", `Bearer ${secret}`)
      .send({ commandId: "command_1", runId: "run_1", actorId: runRequest.actorId });
    expect(response.status).toBe(202);
    expect(registry.cancel).toHaveBeenCalledWith("run_1", runRequest.actorId);
  });

  it("requires an actor-bound cancellation body", async () => {
    const registry = makeRegistry();
    const response = await request(createApp({ sharedSecret: secret, executor: new TestExecutor(), registry }))
      .post("/runs/run_1/cancel")
      .set("authorization", `Bearer ${secret}`)
      .send({});
    expect(response.status).toBe(400);
    expect(registry.cancel).not.toHaveBeenCalled();
  });

  it.each([
    ["run", "/runs", { ...runRequest, actorId: "other_actor" }],
    ["cancel", "/runs/run_1/cancel", { commandId: "command_1", runId: "run_1", actorId: "other_actor" }],
    ["connection start", "/connections/robinhood/start", { actorId: "other_actor" }],
    ["connection complete", "/connections/robinhood/complete", { actorId: "other_actor", code: "code", state: "state" }],
    ["connection status", "/connections/robinhood/status", { actorId: "other_actor" }],
    ["connection disconnect", "/connections/robinhood/disconnect", { actorId: "other_actor" }],
    ["portfolio", "/portfolio/refresh", { actorId: "other_actor" }],
    ["order", "/orders/execute", { actorId: "other_actor", proposalId: "proposal_1", fingerprint: "a".repeat(64) }],
  ])("rejects a %s request for a different actor", async (_label, path, body) => {
    const registry = makeRegistry();
    const broker = makeBroker();
    const response = await request(createApp({
      sharedSecret: secret,
      executor: new TestExecutor(),
      registry,
      broker,
      boundActorId: runRequest.actorId,
    }))
      .post(path)
      .set("authorization", `Bearer ${secret}`)
      .send(body);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "actor_mismatch" });
    expect(registry.reserve).not.toHaveBeenCalled();
    expect(registry.cancel).not.toHaveBeenCalled();
  });
});
