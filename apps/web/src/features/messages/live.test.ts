import { describe, expect, it } from "vitest";
import type { ResultBatch } from "../../convex/types";
import { assembleLiveParts } from "./live";

describe("assembleLiveParts", () => {
  it("merges only an ordered contiguous batch sequence", () => {
    const batches: ResultBatch[] = [
      {
        sequence: 1,
        events: [{ type: "text_delta", text: "Hello" }],
        terminal: false,
        createdAt: 1,
      },
      {
        sequence: 2,
        events: [{ type: "text_delta", text: " world" }],
        terminal: false,
        createdAt: 2,
      },
    ];
    expect(assembleLiveParts(batches)).toEqual({
      parts: [{ type: "text", text: "Hello world" }],
      acceptedThrough: 2,
      hasGap: false,
    });
  });

  it("stops before a sequence gap", () => {
    const batches: ResultBatch[] = [
      {
        sequence: 1,
        events: [{ type: "text_delta", text: "Confirmed" }],
        terminal: false,
        createdAt: 1,
      },
      {
        sequence: 3,
        events: [{ type: "text_delta", text: "Not confirmed" }],
        terminal: false,
        createdAt: 3,
      },
    ];
    expect(assembleLiveParts(batches)).toMatchObject({
      acceptedThrough: 1,
      hasGap: true,
      parts: [{ text: "Confirmed" }],
    });
  });

  it("updates a matching typed tool part", () => {
    const batches: ResultBatch[] = [
      {
        sequence: 1,
        terminal: false,
        createdAt: 1,
        events: [
          {
            type: "tool_start",
            toolCallId: "tool-1",
            name: "search",
          },
        ],
      },
      {
        sequence: 2,
        terminal: false,
        createdAt: 2,
        events: [
          {
            type: "tool_end",
            toolCallId: "tool-1",
            name: "search",
            ok: true,
            durationMs: 25,
          },
        ],
      },
    ];
    expect(assembleLiveParts(batches).parts[0]).toMatchObject({
      type: "tool",
      status: "completed",
      durationMs: 25,
    });
  });
});
