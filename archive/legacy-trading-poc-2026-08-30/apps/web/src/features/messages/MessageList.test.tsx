import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActiveRunReadModel,
  MessageReadModel,
  ResultEvent,
} from "../../convex/types";
import { MessageList } from "./MessageList";

const pendingMessage: MessageReadModel = {
  stableId: "message-1",
  threadId: "thread-1",
  runId: "run-1",
  ordinal: 2,
  role: "assistant",
  status: "streaming",
  parts: [],
  createdAt: 1,
  updatedAt: 1,
};

let nextFrameId = 1;
let frames = new Map<number, FrameRequestCallback>();
let notifyResize: ResizeObserverCallback = () => undefined;
const scrollTo = vi.fn();

function flushFrames(at = 0) {
  const pending = [...frames.values()];
  frames.clear();
  act(() => {
    for (const callback of pending) callback(at);
  });
}

function activeRun(text: string, sequence = 1): ActiveRunReadModel {
  return {
    run: {
      runId: "run-1",
      commandId: "command-1",
      assistantMessageId: "message-1",
      status: "running",
      lastAcceptedSequence: sequence,
    },
    command: {
      commandId: "command-1",
      status: "running",
    },
    assistantMessage: {
      stableId: "message-1",
      status: "streaming",
      parts: [],
      createdAt: 1,
      updatedAt: 1,
    },
    batches: [
      {
        sequence,
        events: [{ type: "text_delta", text }],
        terminal: false,
        createdAt: 1,
      },
    ],
  };
}

function activeRunWithEvents(events: ResultEvent[]): ActiveRunReadModel {
  const run = activeRun("");
  return {
    ...run,
    batches: [{ ...run.batches[0], events }],
  };
}

beforeEach(() => {
  nextFrameId = 1;
  frames = new Map();
  notifyResize = () => undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  scrollTo.mockReset();
  vi.stubGlobal("scrollTo", scrollTo);
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MessageList live rendering", () => {
  it("renders active text without Markdown parsing", () => {
    const { container } = render(
      <MessageList
        messages={[pendingMessage]}
        activeRun={activeRun("**partial**")}
      />,
    );

    expect(container.querySelector(".live-text")).toHaveTextContent(
      "**partial**",
    );
    expect(screen.queryByText("partial", { selector: "strong" })).toBeNull();
  });

  it("formats completed lines while leaving the unfinished line cheap", () => {
    const { container } = render(
      <MessageList
        messages={[pendingMessage]}
        activeRun={activeRun("# Progressive heading\nStill **typing**")}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Progressive heading" }),
    ).toBeVisible();
    expect(container.querySelector(".live-text")).toHaveTextContent(
      "Still **typing**",
    );
    expect(screen.queryByText("typing", { selector: "strong" })).toBeNull();
  });

  it("retains live text until the canonical terminal message arrives", () => {
    const { container, rerender } = render(
      <MessageList
        messages={[pendingMessage]}
        activeRun={activeRun("**complete**")}
      />,
    );

    rerender(<MessageList messages={[pendingMessage]} activeRun={null} />);
    expect(container.querySelector(".live-text")).toHaveTextContent(
      "**complete**",
    );

    const completedMessage: MessageReadModel = {
      ...pendingMessage,
      status: "completed",
      parts: [{ type: "text", text: "**complete**" }],
      updatedAt: 2,
    };
    rerender(<MessageList messages={[completedMessage]} activeRun={null} />);

    expect(container.querySelector(".live-text")).toBeNull();
    expect(screen.getByText("complete", { selector: "strong" })).toBeVisible();
  });

  it("reveals a tool only after snapping all preceding accepted text", () => {
    const { container, rerender } = render(
      <MessageList
        messages={[pendingMessage]}
        activeRun={activeRun("Accepted prefix ")}
      />,
    );
    const completeText = "Accepted prefix with several pending words";
    rerender(
      <MessageList
        messages={[pendingMessage]}
        activeRun={activeRun(completeText)}
      />,
    );
    expect(container).not.toHaveTextContent(completeText);

    rerender(
      <MessageList
        messages={[pendingMessage]}
        activeRun={activeRunWithEvents([
          { type: "text_delta", text: completeText },
          {
            type: "tool_start",
            toolCallId: "tool-1",
            name: "market_snapshot",
          },
        ])}
      />,
    );

    expect(container).toHaveTextContent(completeText);
    expect(screen.getByText("Market Snapshot")).toBeVisible();
  });

  it("lets manual scrolling override queued and future follow work", () => {
    render(
      <MessageList
        messages={[pendingMessage]}
        activeRun={activeRun("Streaming response")}
      />,
    );
    expect(frames.size).toBe(1);

    act(() => window.dispatchEvent(new WheelEvent("wheel", { deltaY: 80 })));
    expect(frames.size).toBe(0);

    act(() => notifyResize([], new ResizeObserver(() => undefined)));
    expect(frames.size).toBe(0);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("re-enables follow only after the viewport returns near the bottom", () => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 1_600,
    });
    render(
      <MessageList
        messages={[pendingMessage]}
        activeRun={activeRun("Streaming response")}
      />,
    );

    act(() => window.dispatchEvent(new Event("scroll")));
    flushFrames();
    expect(scrollTo).not.toHaveBeenCalled();

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 950,
    });
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => notifyResize([], new ResizeObserver(() => undefined)));
    flushFrames();

    expect(scrollTo).toHaveBeenCalledWith({
      top: 1_600,
      behavior: "auto",
    });
  });
});
