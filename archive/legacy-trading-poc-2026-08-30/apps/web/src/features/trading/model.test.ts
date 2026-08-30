import { describe, expect, it } from "vitest";
import type { TradingDashboardReadModel } from "../../convex/types";
import { toTradingDashboardModel } from "./model";

describe("production trading dashboard model", () => {
  it("maps canonical Convex data without inventing brokerage values", () => {
    const canonical: TradingDashboardReadModel = {
      connection: {
        status: "connected",
        label: "Robinhood",
        grantedScopes: ["read"],
        updatedAt: 1_777_000_000_000,
      },
      portfolio: {
        capturedAt: 1_777_000_000_000,
        totalEquity: 12_345.67,
        buyingPower: 2_000,
        cash: 1_900,
        dayChange: -45.5,
        dayChangePercent: -0.37,
        positions: [
          {
            symbol: "AAPL",
            quantity: 4,
            price: 250,
            marketValue: 1_000,
          },
        ],
      },
      proposals: [
        {
          stableId: "proposal_1",
          status: "awaiting_confirmation",
          symbol: "AAPL",
          side: "buy",
          notionalUsd: 250,
          orderType: "limit",
          timeInForce: "day",
          limitPrice: 248,
          estimatedTotal: 250,
          reviewReference: "Add only at the reviewed support level.",
          fingerprint: "a".repeat(64),
          expiresAt: 1_777_000_900_000,
          updatedAt: 1_777_000_000_000,
        },
      ],
    };

    const model = toTradingDashboardModel(canonical);

    expect(model.brokerConnection).toBe("connected");
    expect(model.brokerIsMock).toBe(false);
    expect(model.brokerLabel).toBe("Robinhood");
    expect(model.portfolio?.totalValue).toBe(12_345.67);
    expect(model.positions).toEqual([
      {
        symbol: "AAPL",
        quantity: 4,
        marketValue: 1_000,
        dayChangePercent: 0,
      },
    ]);
    expect(model.proposals[0]).toMatchObject({
      id: "proposal_1",
      symbol: "AAPL",
      notionalUsd: 250,
      status: "pending",
    });
  });

  it("marks mock connection metadata as a simulation", () => {
    const canonical: TradingDashboardReadModel = {
      connection: {
        status: "connected",
        label: "Mock Robinhood",
        grantedScopes: ["read", "trade"],
        updatedAt: 1_777_000_000_000,
      },
      portfolio: null,
      proposals: [],
    };

    expect(toTradingDashboardModel(canonical)).toMatchObject({
      brokerConnection: "connected",
      brokerIsMock: true,
      brokerLabel: "Mock Robinhood",
    });
  });

  it("surfaces connection errors and keeps an empty portfolio empty", () => {
    const canonical: TradingDashboardReadModel = {
      connection: {
        status: "error",
        grantedScopes: [],
        errorCode: "authorization_start_failed",
        updatedAt: 1_777_000_000_000,
      },
      portfolio: null,
      proposals: [],
    };

    expect(toTradingDashboardModel(canonical)).toMatchObject({
      brokerConnection: "error",
      connectionNeedsAttention: true,
      portfolio: null,
      positions: [],
      proposals: [],
    });
  });
});
