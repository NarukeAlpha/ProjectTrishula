import type {
  AssistantPart,
  ResultBatch,
  ResultEvent,
  ToolPart,
} from "../../convex/types";

export interface LiveAssembly {
  parts: AssistantPart[];
  acceptedThrough: number;
  hasGap: boolean;
}

function appendText(parts: AssistantPart[], text: string): AssistantPart[] {
  if (!text) return parts;
  const previous = parts.at(-1);
  if (previous?.type === "text")
    return [...parts.slice(0, -1), { ...previous, text: previous.text + text }];
  return [...parts, { type: "text", text }];
}

function applyEvent(
  parts: AssistantPart[],
  event: ResultEvent,
): AssistantPart[] {
  switch (event.type) {
    case "text_delta":
      return appendText(parts, event.text);
    case "tool_start": {
      const tool: ToolPart = {
        type: "tool",
        toolCallId: event.toolCallId,
        name: event.name,
        status: "running",
      };
      if (event.inputSummary) tool.inputSummary = event.inputSummary;
      return [...parts, tool];
    }
    case "tool_end": {
      const index = parts.findIndex(
        (part) => part.type === "tool" && part.toolCallId === event.toolCallId,
      );
      if (index < 0) return parts;
      const previous = parts[index];
      if (previous?.type !== "tool") return parts;
      const replacement: ToolPart = {
        ...previous,
        status: event.ok ? "completed" : "failed",
        durationMs: event.durationMs,
      };
      if (event.outputSummary) replacement.outputSummary = event.outputSummary;
      return [...parts.slice(0, index), replacement, ...parts.slice(index + 1)];
    }
    case "error":
      return [
        ...parts,
        {
          type: "error",
          code: event.code,
          message: event.message,
          retryable: event.retryable,
        },
      ];
    case "canceled":
    case "completed":
      return parts;
  }
}

export function assembleLiveParts(
  batches: ResultBatch[],
  baseSequence = 0,
): LiveAssembly {
  let expected = baseSequence + 1;
  let parts: AssistantPart[] = [];
  for (const batch of batches) {
    if (batch.sequence < expected) continue;
    if (batch.sequence !== expected)
      return { parts, acceptedThrough: expected - 1, hasGap: true };
    for (const event of batch.events) parts = applyEvent(parts, event);
    expected += 1;
  }
  return { parts, acceptedThrough: expected - 1, hasGap: false };
}
