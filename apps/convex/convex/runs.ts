import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import { actorFromIdentity } from "./lib/auth.js";
import { getThreadByStableId } from "./lib/data.js";
import { MAX_THREAD_ID_LENGTH, requireStableId } from "./lib/validation.js";

const maximumBatchPage = 64;

async function activeRunForThread(ctx: QueryCtx, threadId: Id<"threads">) {
  for (const status of ["pending", "running", "cancellation_requested"] as const) {
    const run = await ctx.db
      .query("runs")
      .withIndex("by_thread_status", (index) => index.eq("threadId", threadId).eq("status", status))
      .first();
    if (run) return run;
  }
  return null;
}

export const getActive = query({
  args: {
    threadId: v.string(),
    afterSequence: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireStableId(args.threadId, "threadId", MAX_THREAD_ID_LENGTH);
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const thread = await getThreadByStableId(ctx, actor.id, args.threadId);
    if (!thread || thread.archivedAt !== undefined) throw new Error("Thread not found.");
    const afterSequence = args.afterSequence ?? 0;
    const limit = args.limit ?? 32;
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new Error("afterSequence must be a non-negative safe integer.");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumBatchPage) {
      throw new Error(`limit must be an integer from 1 through ${maximumBatchPage}.`);
    }
    const run = await activeRunForThread(ctx, thread._id);
    if (!run) return null;
    const batches = await ctx.db
      .query("runResultBatches")
      .withIndex("by_runId_sequence", (index) => index.eq("runId", run._id).gt("sequence", afterSequence))
      .order("asc")
      .take(limit);
    const command = await ctx.db.query("commands").withIndex("by_commandId", (index) => index.eq("commandId", run.commandId)).unique();
    const assistantMessage = await ctx.db.get(run.assistantMessageId);
    if (!assistantMessage) throw new Error("Run assistant message not found.");
    return {
      run: {
        runId: run.stableId,
        commandId: run.commandId,
        assistantMessageId: run.assistantMessageStableId,
        status: run.status,
        lastAcceptedSequence: run.lastAcceptedSequence,
        dispatchDeadlineAt: run.dispatchDeadlineAt,
        leaseExpiresAt: run.leaseExpiresAt,
      },
      command: command
        ? { commandId: command.commandId, status: command.status, lastDispatchError: command.lastDispatchError }
        : null,
      assistantMessage: {
        stableId: assistantMessage.stableId,
        status: assistantMessage.status,
        parts: assistantMessage.parts ?? [],
        metrics: assistantMessage.metrics,
        createdAt: assistantMessage.createdAt,
        updatedAt: assistantMessage.updatedAt,
      },
      batches: batches.map((batch) => ({
        sequence: batch.sequence,
        events: batch.events,
        terminal: batch.terminal,
        createdAt: batch.createdAt,
      })),
    };
  },
});
