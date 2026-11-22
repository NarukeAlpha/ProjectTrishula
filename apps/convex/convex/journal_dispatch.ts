import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api.js";
import { internalAction } from "./_generated/server.js";
import type { JournalDispatchPayload } from "./journal.js";
import { journalExecutionRequest } from "./lib/execution.js";

const JOURNAL_START_TIMEOUT_MS = 15_000;
const JOURNAL_CANCEL_TIMEOUT_MS = 10_000;
const MAX_ERROR_BODY_BYTES = 1_024;
const errorResponseSchema = z.object({ error: z.string().trim().min(1).max(400) });

async function readBoundedError(response: Response): Promise<string> {
  const fallback = `Journal agent rejected run with HTTP ${response.status}.`;
  if (response.body === null) return fallback;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_ERROR_BODY_BYTES) {
        await reader.cancel();
        return fallback;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const decoded = new TextDecoder().decode(bytes).trim();
  if (!decoded) return fallback;
  try {
    const parsed = errorResponseSchema.safeParse(JSON.parse(decoded));
    if (parsed.success) return parsed.data.error;
  } catch {
    // Plain-text error body; fall through.
  }
  return decoded.slice(0, 400);
}

export const startRun = internalAction({
  args: {
    ownerId: v.string(),
    runStableId: v.string(),
  },
  handler: async (ctx, args): Promise<{ dispatched: boolean }> => {
    const payload: JournalDispatchPayload | null = await ctx.runMutation(
      internal.journal.prepareRunDispatchInternal,
      {
        ownerId: args.ownerId,
        runStableId: args.runStableId,
      },
    );
    if (!payload) {
      return { dispatched: false };
    }

    let failureMessage: string | undefined;
    try {
      const response = await journalExecutionRequest(
        args.ownerId,
        "/v1/journal/runs",
        payload,
        { timeoutMs: JOURNAL_START_TIMEOUT_MS },
      );
      if (response.ok) {
        return { dispatched: true };
      }
      failureMessage = await readBoundedError(response);
    } catch (error) {
      failureMessage = error instanceof Error
        ? error.message.slice(0, 400)
        : "Journal agent transport failure.";
    }

    await ctx.runMutation(internal.journal.completeRunInternal, {
      ownerId: args.ownerId,
      runId: args.runStableId,
      status: "failed",
      text: "",
      error: failureMessage,
    });
    return { dispatched: false };
  },
});

export const cancelRun = internalAction({
  args: {
    ownerId: v.string(),
    runStableId: v.string(),
  },
  handler: async (_ctx, args): Promise<{ notified: boolean }> => {
    try {
      const response = await journalExecutionRequest(
        args.ownerId,
        `/v1/journal/runs/${encodeURIComponent(args.runStableId)}/cancel`,
        {
          ownerId: args.ownerId,
          runId: args.runStableId,
        },
        { timeoutMs: JOURNAL_CANCEL_TIMEOUT_MS },
      );
      return { notified: response.ok };
    } catch {
      return { notified: false };
    }
  },
});
