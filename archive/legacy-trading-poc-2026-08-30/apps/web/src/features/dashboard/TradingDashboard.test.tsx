import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TradingDashboard } from "./TradingDashboard";

afterEach(cleanup);

describe("production trading dashboard", () => {
  it("exposes Robinhood, refresh, and exact proposal decision controls", () => {
    const onToggleConnection = vi.fn();
    const onRefresh = vi.fn();
    const onDecision = vi.fn();
    render(
      <TradingDashboard
        cloudConnected
        brokerConnection="connected"
        portfolio={{
          totalValue: 10_000,
          buyingPower: 2_500,
          dayChange: 100,
          dayChangePercent: 1,
          updatedLabel: "Updated now",
        }}
        positions={[]}
        proposals={[
          {
            id: "proposal_1",
            side: "buy",
            symbol: "AAPL",
            notionalUsd: 250,
            orderType: "limit",
            timeInForce: "day",
            limitPrice: 248,
            estimatedTotal: 250,
            rationale: "Reviewed support entry.",
            status: "pending",
          },
        ]}
        onToggleConnection={onToggleConnection}
        onRefresh={onRefresh}
        onDecision={onDecision}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Disconnect Robinhood" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh portfolio" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve order" }));

    expect(onToggleConnection).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onDecision).toHaveBeenCalledWith("proposal_1", "approve");
    expect(screen.queryByText(/demo/i)).not.toBeInTheDocument();
  });

  it("labels a mock connection as a simulation", () => {
    render(
      <TradingDashboard
        cloudConnected
        brokerConnection="connected"
        brokerIsMock
        brokerLabel="Mock Robinhood"
        portfolio={null}
        positions={[]}
        proposals={[]}
        onToggleConnection={vi.fn()}
      />,
    );

    expect(screen.getByText("Mock brokerage")).toBeVisible();
    expect(screen.getByText("Simulation connected")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Disconnect mock account" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Disconnect Robinhood" }),
    ).not.toBeInTheDocument();
  });

  it("shows the in-memory desktop handoff for a real connection", () => {
    const onDismissAuthorization = vi.fn();
    render(
      <TradingDashboard
        cloudConnected
        brokerConnection="connecting"
        brokerLabel="Robinhood"
        authorizationUrl="https://robinhood.com/oauth?state=private-state"
        portfolio={null}
        positions={[]}
        proposals={[]}
        onToggleConnection={vi.fn()}
        onDismissAuthorization={onDismissAuthorization}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Finish Robinhood on desktop" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismissAuthorization).toHaveBeenCalledOnce();
  });
});
