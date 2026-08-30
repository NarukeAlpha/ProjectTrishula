import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoRuntimeConfig } from "../config/runtime";
import { DemoApp } from "./DemoApp";

const config: DemoRuntimeConfig = {
  environment: "development",
  applicationName: "Project Trishula",
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

describe("Project Trishula demo mode", () => {
  it("keeps the chat composer and returns a deterministic local reply", () => {
    render(
      <MemoryRouter initialEntries={["/ask"]}>
        <DemoApp config={config} />
      </MemoryRouter>,
    );

    const prompt = screen.getByRole("textbox", { name: "Ask Trishula" });
    fireEvent.change(prompt, {
      target: { value: "What is driving semiconductors today?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(
      screen.getByText("What is driving semiconductors today?"),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Demo research read" }),
    ).toBeVisible();
    expect(screen.getByText(/does not use live market data/i)).toBeVisible();
  });

  it("opens the Discord section with sample server activity", () => {
    render(
      <MemoryRouter initialEntries={["/ask"]}>
        <DemoApp config={config} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole("link", { name: "Discord" })[0]);

    expect(
      screen.getByRole("heading", { name: "Server routing" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Stardust" })).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Conversation channel" }),
    ).toHaveValue("demo-testing-bot");
    expect(
      screen.getByRole("combobox", { name: "Research log channel" }),
    ).toHaveValue("demo-research-log");
    expect(
      screen.getByRole("heading", { name: "Agent activity" }),
    ).toBeVisible();
    expect(screen.getByText("Acknowledgment sent")).toBeVisible();
  });
});
