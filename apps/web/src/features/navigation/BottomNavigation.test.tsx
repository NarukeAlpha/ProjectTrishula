import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { BottomNavigation, DesktopNavigation } from "./BottomNavigation";
import { isChatPathname, isJournalPathname } from "./routes";

afterEach(cleanup);

describe("primary navigation", () => {
  it("contains Journal, Chat, and Discord", () => {
    render(
      <MemoryRouter initialEntries={["/discord"]}>
        <BottomNavigation />
        <DesktopNavigation />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("link", { name: "Journal" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Chat" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Discord" })).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "Overview" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Activity" })).toBeNull();
    for (const link of screen.getAllByRole("link", { name: "Discord" })) {
      expect(link).toHaveClass("active");
    }
  });

  it("keeps Journal active for root and journal routes", () => {
    render(
      <MemoryRouter initialEntries={["/journal"]}>
        <BottomNavigation />
        <DesktopNavigation />
      </MemoryRouter>,
    );

    for (const link of screen.getAllByRole("link", { name: "Journal" })) {
      expect(link).toHaveClass("active");
    }
  });

  it("keeps Chat active for conversation routes", () => {
    render(
      <MemoryRouter initialEntries={["/threads/thread_1"]}>
        <BottomNavigation />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Chat" })).toHaveClass("active");
  });

  it("scopes path helpers cleanly", () => {
    expect(isChatPathname("/ask")).toBe(true);
    expect(isChatPathname("/threads/thread_1")).toBe(true);
    expect(isChatPathname("/journal")).toBe(false);
    expect(isChatPathname("/discord")).toBe(false);
    expect(isChatPathname("/")).toBe(false);

    expect(isJournalPathname("/")).toBe(true);
    expect(isJournalPathname("/journal")).toBe(true);
    expect(isJournalPathname("/ask")).toBe(false);
    expect(isJournalPathname("/discord")).toBe(false);
  });
});
