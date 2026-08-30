export interface RunMetrics {
  inputTokens: number;
  promptTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  ttftMs: number | null;
  timeToFirstOutputMs: number | null;
  runDurationMs: number;
  approximateOutputTps: number | null;
  provider?: string | undefined;
  model?: string | undefined;
}

export type PiEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; toolCallId: string; name: string; inputSummary?: string | undefined }
  | {
      type: "tool_end";
      toolCallId: string;
      name: string;
      ok: boolean;
      outputSummary?: string | undefined;
      durationMs: number;
    }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | { type: "canceled" }
  | { type: "completed"; metrics: RunMetrics };

export type TerminalPiEvent = Extract<PiEvent, { type: "error" | "canceled" | "completed" }>;

export type ConversationHistoryPart =
  | { type: "text"; text: string }
  | {
      type: "tool";
      toolCallId: string;
      name: string;
      status: "completed" | "failed" | "canceled";
      inputSummary?: string | undefined;
      outputSummary?: string | undefined;
      durationMs?: number | undefined;
    }
  | { type: "error"; code: string; message: string; retryable: boolean };

export interface ConversationHistoryMessage {
  messageId: string;
  role: "user" | "assistant";
  parts: ConversationHistoryPart[];
}

export interface RunExecutionRequest {
  commandId: string;
  runId: string;
  assistantMessageId: string;
  actorId: string;
  threadId: string;
  prompt: string;
  /** Complete ordered history before `prompt`. */
  history: ConversationHistoryMessage[];
}

export interface FinalAssistantMessage {
  status: "completed" | "failed" | "canceled";
  parts: ConversationHistoryPart[];
}

export interface ResultBatchRequest {
  commandId: string;
  runId: string;
  assistantMessageId: string;
  sequence: number;
  payloadHash: string;
  events: PiEvent[];
  finalMessage?: FinalAssistantMessage | undefined;
}

export interface ResultBatchAccepted {
  runId: string;
  acceptedThrough: number;
  status: "streaming" | "completed" | "failed" | "canceled";
  leaseExpiresAt?: number | undefined;
}

export interface RunHeartbeatAccepted {
  runId: string;
  status: "running" | "cancellation_requested" | "completed" | "failed" | "canceled";
  leaseExpiresAt?: number | undefined;
}

export function isTerminalEvent(event: PiEvent): event is TerminalPiEvent {
  return event.type === "error" || event.type === "canceled" || event.type === "completed";
}
