export const DISPATCH_DEADLINE_MS = 2 * 60 * 1_000;
export const RUN_LEASE_MS = 2 * 60 * 1_000;
export const RESULT_BATCH_MAX_EVENTS = 64;
export const RESULT_BATCH_MAX_BYTES = 64 * 1_024;
export const FINAL_MESSAGE_MAX_BYTES = 512 * 1_024;
export const RESULT_BATCH_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const RECONCILIATION_BATCH_SIZE = 100;

export type RunStatus =
  | "pending"
  | "running"
  | "cancellation_requested"
  | "completed"
  | "failed"
  | "canceled";

export interface RunMetrics {
  provider?: string;
  model?: string;
  inputTokens?: number;
  promptTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  ttftMs?: number | null;
  timeToFirstOutputMs?: number | null;
  timeToFirstVisibleTextMs?: number;
  runDurationMs?: number;
  totalRunDurationMs?: number;
  approximateOutputTps?: number | null;
  outputTokensPerSecond?: number;
}

export type PiEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; toolCallId: string; name: string; inputSummary?: string }
  | { type: "tool_end"; toolCallId: string; name: string; ok: boolean; outputSummary?: string; durationMs: number }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | { type: "canceled" }
  | { type: "completed"; metrics: RunMetrics };

export type AssistantPart =
  | { type: "text"; text: string }
  | {
      type: "tool";
      toolCallId: string;
      name: string;
      status: "completed" | "failed" | "canceled";
      inputSummary?: string;
      outputSummary?: string;
      durationMs?: number;
    }
  | { type: "error"; code: string; message: string; retryable: boolean };

export interface FinalAssistantMessage {
  status: "completed" | "failed" | "canceled";
  parts: AssistantPart[];
  metrics?: RunMetrics;
}

export interface ResultBatch {
  commandId: string;
  runId: string;
  assistantMessageId: string;
  sequence: number;
  payloadHash: string;
  events: PiEvent[];
  finalMessage?: FinalAssistantMessage;
}

export function isTerminalStatus(
  status: RunStatus,
): status is Extract<RunStatus, "completed" | "failed" | "canceled"> {
  return status === "completed" || status === "failed" || status === "canceled";
}

export function terminalStatusForEvent(event: PiEvent): FinalAssistantMessage["status"] | undefined {
  if (event.type === "completed") return "completed";
  if (event.type === "error") return "failed";
  if (event.type === "canceled") return "canceled";
  return undefined;
}

function encodedSize<TValue>(value: TValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function assertResultBatch(batch: ResultBatch): void {
  if (!Number.isSafeInteger(batch.sequence) || batch.sequence < 1) {
    throw new Error("Result sequence must be a positive safe integer.");
  }
  if (!/^[a-f0-9]{64}$/i.test(batch.payloadHash)) {
    throw new Error("Result payloadHash must be a SHA-256 hexadecimal digest.");
  }
  if (batch.events.length === 0) throw new Error("A result batch must contain at least one event.");
  if (batch.events.length > RESULT_BATCH_MAX_EVENTS) {
    throw new Error(`A nonterminal result batch cannot exceed ${RESULT_BATCH_MAX_EVENTS} events.`);
  }

  const terminalStatus = terminalStatusForEvent(batch.events.at(-1)!);
  const hasTerminalBeforeEnd = batch.events.slice(0, -1).some((event) => terminalStatusForEvent(event));
  if (hasTerminalBeforeEnd) throw new Error("A terminal Pi event must be the last event in its batch.");

  if (terminalStatus) {
    if (!batch.finalMessage) throw new Error("A terminal batch must include finalMessage.");
    if (batch.finalMessage.status !== terminalStatus) {
      throw new Error("finalMessage status must match the terminal Pi event.");
    }
    if (encodedSize(batch.finalMessage) > FINAL_MESSAGE_MAX_BYTES) {
      throw new Error("finalMessage exceeds the 512 KiB encoded limit.");
    }
    return;
  }

  if (batch.finalMessage) throw new Error("Only a terminal batch can include finalMessage.");
  if (encodedSize(batch.events) > RESULT_BATCH_MAX_BYTES) {
    throw new Error("A nonterminal result batch exceeds the 64 KiB encoded limit.");
  }
}

export function sameBatchPayload(existingHash: string, nextHash: string): boolean {
  return existingHash === nextHash;
}

/** A retry rebuilds Pi from the messages that predate the original prompt. */
export function historyBeforePrompt<T extends { ordinal: number }>(messages: readonly T[], promptOrdinal: number): T[] {
  return messages.filter((message) => message.ordinal < promptOrdinal);
}

export function foldEventsIntoParts(events: readonly PiEvent[]): AssistantPart[] {
  const parts: AssistantPart[] = [];
  const activeTools = new Map<string, number>();

  for (const event of events) {
    if (event.type === "text_delta") {
      if (event.text.length === 0) continue;
      const previous = parts.at(-1);
      if (previous?.type === "text") {
        previous.text += event.text;
      } else {
        parts.push({ type: "text", text: event.text });
      }
      continue;
    }
    if (event.type === "tool_start") {
      activeTools.set(event.toolCallId, parts.length);
      const tool: Extract<AssistantPart, { type: "tool" }> = {
        type: "tool",
        toolCallId: event.toolCallId,
        name: event.name,
        // This folding path is used only by lost-run reconciliation. A tool
        // without a matching completion event is therefore a backend failure,
        // not a confirmed cancellation.
        status: "failed",
      };
      if (event.inputSummary) tool.inputSummary = event.inputSummary;
      parts.push(tool);
      continue;
    }
    if (event.type === "tool_end") {
      const index = activeTools.get(event.toolCallId);
      const status = event.ok ? "completed" : "failed";
      if (index === undefined) {
        const tool: Extract<AssistantPart, { type: "tool" }> = {
          type: "tool",
          toolCallId: event.toolCallId,
          name: event.name,
          status,
          durationMs: event.durationMs,
        };
        if (event.outputSummary) tool.outputSummary = event.outputSummary;
        parts.push(tool);
      } else {
        const previous = parts[index];
        if (previous?.type === "tool") {
          const completedTool: Extract<AssistantPart, { type: "tool" }> = {
            ...previous,
            status,
            durationMs: event.durationMs,
          };
          if (event.outputSummary) {
            completedTool.outputSummary = event.outputSummary;
          }
          parts[index] = completedTool;
        }
        activeTools.delete(event.toolCallId);
      }
      continue;
    }
    if (event.type === "error") {
      parts.push({ type: "error", code: event.code, message: event.message, retryable: event.retryable });
    }
  }
  return parts;
}

export function appendFailurePart(parts: AssistantPart[], code: string, message: string): AssistantPart[] {
  return [...parts, { type: "error", code, message, retryable: true }];
}
