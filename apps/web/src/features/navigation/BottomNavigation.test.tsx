import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import {
  BottomNavigation,
  DesktopNavigation,
  PrimaryRail,
} from "./BottomNavigation";
import { isChatPathname } from "./routes";

afterEach(cleanup);

describe("primary navigation", () => {
  it("links to the same four destinations on desktop and mobile", () => {
    render(
      <MemoryRouter initialEntries={["/discord"]}>
        <BottomNavigation />
        <DesktopNavigation />
      </MemoryRouter>,
    );

    for (const nav of screen.getAllByRole("navigation")) {
      const links = within(nav);
      expect(links.getAllByRole("link")).toHaveLength(4);
      for (const [name, path] of [
        ["Trade Reviews", "/trade-reviews"],
        ["Lessons", "/lessons"],
        ["Chat", "/ask"],
        ["Discord", "/discord"],
      ]) {
        expect(links.getByRole("link", { name })).toHaveAttribute("href", path);
      }
    }
  });

  it.each([
    ["/trade-reviews", "Trade Reviews"],
    ["/lessons", "Lessons"],
    ["/threads/thread_1", "Chat"],
    ["/discord", "Discord"],
  ])("marks the current destination on %s", (path, name) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <BottomNavigation />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { current: "page" })).toHaveAccessibleName(
      name,
    );
    expect(screen.getByRole("link", { name })).toHaveClass("active");
  });

  it("keeps the edge control available with the sidebar open or closed", () => {
    render(
      <MemoryRouter initialEntries={["/lessons"]}>
        <PrimaryRail subtitle="Demo" footer={<button>Reset</button>} />
      </MemoryRouter>,
    );

    const toggle = screen.getByRole("button", {
      name: "Collapse sidebar",
      expanded: true,
    });
    const panel = document.getElementById(
      toggle.getAttribute("aria-controls")!,
    );
    fireEvent.click(toggle);
    expect(toggle).toHaveAccessibleName("Expand sidebar");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toBeVisible();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();

    fireEvent.click(toggle);
    expect(panel).toBeVisible();
    expect(toggle).toHaveAccessibleName("Collapse sidebar");
    expect(screen.getByRole("link", { current: "page" })).toHaveAccessibleName(
      "Lessons",
    );
  });

  it("scopes path helpers cleanly", () => {
    expect(isChatPathname("/ask")).toBe(true);
    expect(isChatPathname("/threads/thread_1")).toBe(true);
    expect(isChatPathname("/journal")).toBe(false);
    expect(isChatPathname("/discord")).toBe(false);
    expect(isChatPathname("/")).toBe(false);
  });
});
