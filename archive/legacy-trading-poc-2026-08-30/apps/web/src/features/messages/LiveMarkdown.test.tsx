import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveMarkdown } from "./LiveMarkdown";

let nextFrameId = 1;
let frames = new Map<number, FrameRequestCallback>();
let now = 0;
let reducedMotion = false;

function flushFrame(at: number) {
  now = at;
  const pending = [...frames.values()];
  frames.clear();
  act(() => {
    for (const callback of pending) callback(at);
  });
}

beforeEach(() => {
  nextFrameId = 1;
  frames = new Map();
  now = 0;
  reducedMotion = false;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: reducedMotion,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LiveMarkdown smooth projection", () => {
  it("shows the first visible text immediately", () => {
    const { container, rerender } = render(<LiveMarkdown animate text="" />);

    rerender(<LiveMarkdown animate text="First visible words" />);

    expect(container).toHaveTextContent("First visible words");
    expect(frames.size).toBe(0);
  });

  it("reveals later words over a bounded catch-up window", () => {
    const { container, rerender } = render(
      <LiveMarkdown animate text="Hello " />,
    );
    const target = "Hello one two three four five six seven eight";

    rerender(<LiveMarkdown animate text={target} />);
    expect(container).toHaveTextContent("Hello");
    expect(container).not.toHaveTextContent(target);

    flushFrame(0);
    const partial = container.textContent ?? "";
    expect(target.startsWith(partial)).toBe(true);
    expect(partial.length).toBeGreaterThan("Hello ".length);
    expect(partial.length).toBeLessThan(target.length);
    expect(container.querySelector(".live-reveal")).not.toBeNull();

    flushFrame(32);
    flushFrame(64);
    expect(container).toHaveTextContent(target);
    expect(frames.size).toBe(0);
  });

  it("never exposes a partial Unicode grapheme", () => {
    const { container, rerender } = render(
      <LiveMarkdown animate text="Start " />,
    );
    const target = "Start 👨‍👩‍👧‍👦 🇵🇷 cafe\u0301 words after";

    rerender(<LiveMarkdown animate text={target} />);
    flushFrame(0);

    expect(target.startsWith(container.textContent ?? "")).toBe(true);
    expect(container.textContent).not.toContain("�");
  });

  it("snaps to corrected text instead of animating a changed prefix", () => {
    const { container, rerender } = render(
      <LiveMarkdown animate text="Original " />,
    );
    rerender(
      <LiveMarkdown animate text="Original pending words remain hidden" />,
    );

    expect(frames.size).toBe(1);
    rerender(<LiveMarkdown animate text="Corrected response" />);

    expect(container).toHaveTextContent("Corrected response");
    expect(frames.size).toBe(0);
  });

  it("renders appended text immediately when motion is reduced", () => {
    reducedMotion = true;
    const { container, rerender } = render(
      <LiveMarkdown animate text="Hello " />,
    );

    rerender(<LiveMarkdown animate text="Hello all text at once" />);

    expect(container).toHaveTextContent("Hello all text at once");
    expect(frames.size).toBe(0);
  });
});
