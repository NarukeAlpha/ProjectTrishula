import type {
  ConversationHistoryPart,
  FinalAssistantMessage,
  PiEvent,
  TerminalPiEvent,
} from "../contracts.js";

function appendText(parts: ConversationHistoryPart[], text: string): void {
  if (!text) return;
  const last = parts.at(-1);
  if (last?.type === "text") last.text += text;
  else parts.push({ type: "text", text });
}

export class MessageAccumulator {
  private parts: ConversationHistoryPart[] = [];
  private readonly activeToolIds = new Set<string>();

  accept(event: PiEvent): void {
    if (event.type === "text_delta") {
      appendText(this.parts, event.text);
      return;
    }
    if (event.type === "tool_start") {
      const part: ConversationHistoryPart = {
        type: "tool",
        toolCallId: event.toolCallId,
        name: event.name,
        status: "canceled",
      };
      if (event.inputSummary !== undefined && part.type === "tool") part.inputSummary = event.inputSummary;
      this.parts.push(part);
      this.activeToolIds.add(event.toolCallId);
      return;
    }
    if (event.type === "tool_end") {
      const part = this.parts.findLast(
        (candidate) => candidate.type === "tool" && candidate.toolCallId === event.toolCallId,
      );
      if (!part || part.type !== "tool") {
        throw new Error(`tool_end has no matching tool_start: ${event.toolCallId}`);
      }
      part.status = event.ok ? "completed" : "failed";
      part.durationMs = event.durationMs;
      if (event.outputSummary !== undefined) part.outputSummary = event.outputSummary;
      this.activeToolIds.delete(event.toolCallId);
      return;
    }
    if (event.type === "error") {
      this.parts.push({
        type: "error",
        code: event.code,
        message: event.message,
        retryable: event.retryable,
      });
    }
  }

  finalMessage(terminal: TerminalPiEvent): FinalAssistantMessage {
    const parts = structuredClone(this.parts);
    const next = new MessageAccumulator();
    next.parts = parts;
    next.activeToolIds.clear();
    next.accept(terminal);
    if (terminal.type !== "canceled") {
      for (const part of next.parts) {
        if (
          part.type === "tool" &&
          this.activeToolIds.has(part.toolCallId) &&
          part.status === "canceled"
        ) {
          part.status = "failed";
        }
      }
    }
    const status = terminal.type === "completed"
      ? "completed"
      : terminal.type === "canceled"
        ? "canceled"
        : "failed";
    return { status, parts: next.parts };
  }
}
