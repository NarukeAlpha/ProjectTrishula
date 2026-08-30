import { describe, expect, it } from "vitest";
import { APPLICATION_MCP_TOOLS } from "../src/broker/mcp-client.js";
import { loadConfig } from "../src/config.js";
import { TradingBrokerService } from "../src/broker/trading-broker.js";

const base = {
  NODE_ENV: "test",
  SERVICE_SHARED_SECRET: "a-secure-service-secret-with-32-chars",
  CONVEX_SITE_URL: "http://convex.internal/http",
};

function order(actorId: string) {
  return {
    actorId,
    symbol: "AAPL",
    side: "buy" as const,
    quantity: 1,
    orderType: "market" as const,
    timeInForce: "day" as const,
    reviewReference: "user review",
  };
}

describe("trading broker boundary", () => {
  it("enforces the application tool allowlist", () => {
    expect(APPLICATION_MCP_TOOLS).toEqual([
      "get_accounts",
      "get_portfolio",
      "get_equity_positions",
      "get_equity_quotes",
      "get_equity_orders",
    ]);
  });

  it("timestamps mock market data when it is requested", async () => {
    const capturedAt = 1_800_000_000_000;
    const broker = new TradingBrokerService(loadConfig(base), {
      now: () => capturedAt,
    });

    expect(await broker.refreshPortfolio("actor_a")).toMatchObject({
      capturedAt,
    });
    expect(
      await broker.callApplicationTool("actor_a", "get_equity_quotes", {
        symbols: ["AAPL"],
      }),
    ).toEqual([{ capturedAt, price: 250, symbol: "AAPL" }]);
  });

  it("requires the reviewed actor-bound proposal before mock submission", async () => {
    let recordedProposal: unknown;
    const config = loadConfig(base);
    const broker = new TradingBrokerService(config, {
      fetchFn: async (_input, init) => {
        recordedProposal = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ accepted: true }), {
          status: 202,
        });
      },
      now: () => 1_725_000_000_000,
    });
    const proposal = await broker.proposeOrder(order("actor_a"));
    expect(recordedProposal).toEqual({
      expiresAt: proposal.expiresAt,
      fingerprint: proposal.fingerprint,
      idempotencyKey: proposal.idempotencyKey,
      orderType: "market",
      ownerId: "actor_a",
      proposalId: proposal.proposalId,
      quantity: 1,
      reviewReference: "user review",
      side: "buy",
      symbol: "AAPL",
      timeInForce: "day",
    });
    expect((await broker.executeOrder("actor_b", proposal.proposalId, proposal.fingerprint)).status).toBe("failed");
    expect((await broker.executeOrder("actor_a", proposal.proposalId, "0".repeat(64))).status).toBe("failed");
    const submitted = await broker.executeOrder("actor_a", proposal.proposalId, proposal.fingerprint);
    expect(submitted).toMatchObject({ status: "submitted", brokerOrderId: expect.stringMatching(/^mock_/) });
    expect(await broker.executeOrder("actor_a", proposal.proposalId, proposal.fingerprint)).toEqual(submitted);
  });

  it("rejects internal broker calls for an actor outside the runtime binding", async () => {
    const broker = new TradingBrokerService(loadConfig({ ...base, BOUND_ACTOR_ID: "actor_a" }));
    await expect(broker.refreshPortfolio("actor_b")).rejects.toThrow(/runtime/);
    await expect(broker.proposeOrder(order("actor_b"))).rejects.toThrow(/runtime/);
  });
});
