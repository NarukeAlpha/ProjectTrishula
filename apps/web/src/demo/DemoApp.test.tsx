import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoRuntimeConfig } from "../config/runtime";
import { DemoApp } from "./DemoApp";

const config: DemoRuntimeConfig = {
  environment: "development",
  applicationName: "Signal",
  applicationVersion: "test-demo",
  demoMode: true,
};

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("scrollTo", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Signal demo mode", () => {
  it("supports connection changes and simulated trade decisions", () => {
    render(
      <MemoryRouter>
        <DemoApp config={config} />
      </MemoryRouter>,
    );

    expect(screen.getByText("$27,846.20")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Disconnect demo account" }),
    );
    expect(screen.getByText("Not connected")).toBeVisible();
    expect(screen.getByText("No positions available")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Connect demo account" }),
    );
    expect(screen.getByText("$27,846.20")).toBeVisible();

    const buyProposal = screen
      .getByRole("heading", { name: "2 shares of NVDA" })
      .closest("article");
    const sellProposal = screen
      .getByRole("heading", { name: "3 shares of AMD" })
      .closest("article");
    expect(buyProposal).not.toBeNull();
    expect(sellProposal).not.toBeNull();
    if (!buyProposal || !sellProposal) {
      throw new Error("The demo proposal cards did not render.");
    }
    fireEvent.click(
      within(buyProposal).getByRole("button", {
        name: "Approve demo",
      }),
    );
    fireEvent.click(
      within(sellProposal).getByRole("button", {
        name: "Reject",
      }),
    );
    expect(screen.getByText("Demo approved. No order was sent.")).toBeVisible();
    expect(screen.getByText("Demo rejected. No order was sent.")).toBeVisible();
  });

  it("navigates to chat and returns a deterministic local reply", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <DemoApp config={config} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole("link", { name: "Ask Signal" })[0]);
    const prompt = screen.getByRole("textbox", { name: "Ask Signal" });
    fireEvent.change(prompt, {
      target: { value: "What is driving my portfolio today?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(
      screen.getByText("What is driving my portfolio today?"),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Demo portfolio read" }),
    ).toBeVisible();
    expect(screen.getByText(/no order can leave this browser/i)).toBeVisible();

    fireEvent.click(screen.getAllByRole("link", { name: "Activity" })[0]);
    expect(
      screen.getByRole("heading", { name: "Trade activity" }),
    ).toBeVisible();
  });
});
