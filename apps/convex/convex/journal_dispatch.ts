import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api.js";
import { internalAction } from "./_generated/server.js";
import type { JournalDispatchPayload } from "./journal.js";
import { journalExecutionRequest } from "./lib/execution.js";
import { mintJournalRunToken } from "./lib/journal_token.js";

const JOURNAL_START_TIMEOUT_MS = 15_000;
const JOURNAL_CANCEL_TIMEOUT_MS = 5_000;
const JOURNAL_CANCEL_MAX_ATTEMPTS = 2;
const MAX_RESPONSE_BODY_BYTES = 4_096;

const errorResponseSchema = z.object({ error: z.string().trim().min(1).max(400) });
const acceptedRunResponseSchema = z.object({
  accepted: z.literal(true),
  runId: z.string().trim().min(1),
}).strict();

async function readBoundedText(response: Response): Promise<string | null> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BODY_BYTES) {
        await reader.cancel();
        return null;
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
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  } catch {
    return null;
  }
}

async function readBoundedError(response: Response): Promise<string> {
  const fallback = `Journal agent rejected run with HTTP ${response.status}.`;
  const decoded = await readBoundedText(response);
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
    let failureMessage: string | undefined;
    try {
      const payload: JournalDispatchPayload | null = await ctx.runQuery(
        internal.journal.getRunDispatchContextInternal,
        {
          ownerId: args.ownerId,
          runStableId: args.runStableId,
        },
      );
      if (!payload) {
        return { dispatched: false };
      }

      const runToken = await mintJournalRunToken({
        runId: payload.runId,
        ownerId: args.ownerId,
      });

      const response = await journalExecutionRequest(
        args.ownerId,
        "/v1/journal/runs",
        { ...payload, runToken },
        { timeoutMs: JOURNAL_START_TIMEOUT_MS },
      );

      if (response.status !== 202) {
        failureMessage = await readBoundedError(response);
      } else {
        const responseText = await readBoundedText(response);
        if (!responseText) {
          failureMessage = "Journal agent returned an empty or oversized 202 response.";
        } else {
          let parsedJson: z.infer<ReturnType<typeof z.json>> | null = null;
          try {
            parsedJson = z.json().parse(JSON.parse(responseText));
          } catch {
            parsedJson = null;
          }
          const validated = acceptedRunResponseSchema.safeParse(parsedJson);
          if (!validated.success || validated.data.runId !== payload.runId) {
            failureMessage = "Journal agent did not return a valid run acceptance response.";
          } else {
            await ctx.runMutation(internal.journal.markRunRunningInternal, {
              ownerId: args.ownerId,
              runStableId: args.runStableId,
            });
            return { dispatched: true };
          }
        }
      }
    } catch (error) {
      failureMessage = error instanceof Error
        ? error.message.slice(0, 400)
        : "Journal agent dispatch failure.";
    }

    await ctx.runMutation(internal.journal.completeRunInternal, {
      ownerId: args.ownerId,
      runId: args.runStableId,
      status: "failed",
      text: "",
      error: failureMessage ?? "Journal agent dispatch failure.",
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
    const path = `/v1/journal/runs/${encodeURIComponent(args.runStableId)}/cancel`;
    for (let attempt = 0; attempt < JOURNAL_CANCEL_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await journalExecutionRequest(
          args.ownerId,
          path,
          {
            ownerId: args.ownerId,
            runId: args.runStableId,
          },
          { timeoutMs: JOURNAL_CANCEL_TIMEOUT_MS },
        );
        if (response.ok) {
          return { notified: true };
        }
        if (response.status < 500) {
          return { notified: false };
        }
      } catch {
        // Retry once on network failure.
      }
    }
    return { notified: false };
  },
});
