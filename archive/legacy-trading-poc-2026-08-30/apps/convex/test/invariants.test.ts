import { describe, expect, it } from "vitest";
import {
  assertResultBatch,
  foldEventsIntoParts,
  historyBeforePrompt,
  isTerminalStatus,
  sameBatchPayload,
  type ResultBatch,
} from "../convex/lib/invariants.js";
import { canonicalJson, sha256Hex } from "../convex/lib/canonical_json.js";

const hash = "a".repeat(64);

function batch(overrides: Partial<ResultBatch> = {}): ResultBatch {
  return {
    commandId: "command_1",
    runId: "run_1",
    assistantMessageId: "assistant_1",
    sequence: 1,
    payloadHash: hash,
    events: [{ type: "text_delta", text: "Hello" }],
    ...overrides,
  };
}

describe("result-batch invariants", () => {
  it("accepts a bounded nonterminal batch", () => {
    expect(() => assertResultBatch(batch())).not.toThrow();
  });

  it("requires a final message for a terminal event", () => {
    expect(() => assertResultBatch(batch({ events: [{ type: "completed", metrics: {} }] }))).toThrow(/finalMessage/);
  });

  it("rejects events after a terminal event", () => {
    expect(() => assertResultBatch(batch({
      events: [
        { type: "canceled" },
        { type: "text_delta", text: "late" },
      ],
    }))).toThrow(/terminal Pi event/);
  });

  it("requires final-message status to match the terminal event", () => {
    expect(() => assertResultBatch(batch({
      events: [{ type: "error", code: "provider", message: "failed", retryable: true }],
      finalMessage: { status: "completed", parts: [] },
    }))).toThrow(/must match/);
  });

  it("folds tool activity and text without duplicating adjacent text parts", () => {
    expect(foldEventsIntoParts([
      { type: "text_delta", text: "One" },
      { type: "text_delta", text: " two" },
      { type: "tool_start", toolCallId: "tool_1", name: "kb_search" },
      { type: "tool_end", toolCallId: "tool_1", name: "kb_search", ok: true, durationMs: 42 },
    ])).toEqual([
      { type: "text", text: "One two" },
      { type: "tool", toolCallId: "tool_1", name: "kb_search", status: "completed", durationMs: 42 },
    ]);
  });

  it("marks an unfinished tool as failed during lost-run recovery", () => {
    expect(foldEventsIntoParts([
      { type: "tool_start", toolCallId: "tool_1", name: "kb_search" },
    ])).toEqual([
      { type: "tool", toolCallId: "tool_1", name: "kb_search", status: "failed" },
    ]);
  });

  it("uses stable hash equality and recognizes terminal statuses", () => {
    expect(sameBatchPayload(hash, hash)).toBe(true);
    expect(sameBatchPayload(hash, "b".repeat(64))).toBe(false);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("running")).toBe(false);
  });

  it("canonicalizes reordered result payload keys and detects tampering", async () => {
    const first = {
      commandId: "command_1",
      runId: "run_1",
      assistantMessageId: "assistant_1",
      sequence: 1,
      events: [{ type: "text_delta", text: "Hello" }],
    };
    const reordered = {
      events: [{ text: "Hello", type: "text_delta" }],
      sequence: 1,
      assistantMessageId: "assistant_1",
      runId: "run_1",
      commandId: "command_1",
    };
    const canonical = canonicalJson(first);
    expect(canonicalJson(reordered)).toBe(canonical);
    expect(await sha256Hex(canonicalJson(reordered))).toBe(await sha256Hex(canonical));

    expect(await sha256Hex(canonicalJson({ ...first, events: [{ type: "text_delta", text: "Tampered" }] })))
      .not.toBe(await sha256Hex(canonical));
  });

  it("rebuilds a retry from state before the original prompt", () => {
    const messages = [
      { ordinal: 0, stableId: "user_prior" },
      { ordinal: 1, stableId: "assistant_prior" },
      { ordinal: 2, stableId: "user_original" },
      { ordinal: 3, stableId: "assistant_failed" },
    ];
    expect(historyBeforePrompt(messages, 2)).toEqual(messages.slice(0, 2));
  });
});
