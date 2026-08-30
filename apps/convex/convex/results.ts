import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation, type MutationCtx } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import { finalAssistantMessageValidator, piEventValidator } from "./schema.js";
import { getRunByStableId } from "./lib/data.js";
import {
  appendFailurePart,
  assertResultBatch,
  foldEventsIntoParts,
  isTerminalStatus,
  sameBatchPayload,
  terminalStatusForEvent,
  type AssistantPart,
  type PiEvent,
  type ResultBatch,
  RESULT_BATCH_RETENTION_MS,
  RUN_LEASE_MS,
} from "./lib/invariants.js";

const resultBatchArgs = {
  commandId: v.string(),
  runId: v.string(),
  assistantMessageId: v.string(),
  sequence: v.number(),
  payloadHash: v.string(),
  events: v.array(piEventValidator),
  finalMessage: v.optional(finalAssistantMessageValidator),
};

type BatchAcceptance =
  | { accepted: true; acceptedThrough: number; status: "streaming" | "completed" | "failed" | "canceled"; leaseExpiresAt?: number }
  | { accepted: false; reason: "changed_retry" | "sequence_gap" | "terminal" | "not_active" | "mismatch"; nextExpectedSequence?: number };

interface ToolActivityInsert {
  runId: Id<"runs">;
  assistantMessageId: Id<"messages">;
  toolCallId: string;
  name: string;
  status: "completed" | "failed" | "canceled";
  inputSummary?: string;
  outputSummary?: string;
  durationMs?: number;
  createdAt: number;
  updatedAt: number;
}

async function updateCommandsForRun(ctx: MutationCtx, runId: Id<"runs">, status: "completed" | "failed" | "canceled") {
  const commands = await ctx.db.query("commands").withIndex("by_runId", (index) => index.eq("runId", runId)).collect();
  const now = Date.now();
  for (const command of commands) {
    await ctx.db.patch(command._id, { status, updatedAt: now });
  }
}

async function persistToolActivities(
  ctx: MutationCtx,
  runId: Id<"runs">,
  assistantMessageId: Id<"messages">,
  parts: readonly AssistantPart[],
) {
  const now = Date.now();
  for (const part of parts) {
    if (part.type !== "tool") continue;
    const activity: ToolActivityInsert = {
      runId,
      assistantMessageId,
      toolCallId: part.toolCallId,
      name: part.name,
      status: part.status,
      createdAt: now,
      updatedAt: now,
    };
    if (part.inputSummary) activity.inputSummary = part.inputSummary;
    if (part.outputSummary) activity.outputSummary = part.outputSummary;
    if (part.durationMs !== undefined) activity.durationMs = part.durationMs;
    await ctx.db.insert("toolActivities", activity);
  }
}

export const acceptBatch = internalMutation({
  args: resultBatchArgs,
  handler: async (ctx, args): Promise<BatchAcceptance> => {
    const batch: ResultBatch = args;
    assertResultBatch(batch);
    const run = await getRunByStableId(ctx, args.runId);
    if (!run || run.commandId !== args.commandId || run.assistantMessageStableId !== args.assistantMessageId) {
      return { accepted: false, reason: "mismatch" };
    }

    const existing = await ctx.db
      .query("runResultBatches")
      .withIndex("by_runId_sequence", (index) => index.eq("runId", run._id).eq("sequence", args.sequence))
      .unique();
    if (existing) {
      if (!sameBatchPayload(existing.payloadHash, args.payloadHash)) {
        return { accepted: false, reason: "changed_retry", nextExpectedSequence: run.lastAcceptedSequence + 1 };
      }
      if (isTerminalStatus(run.status)) {
        return {
          accepted: true,
          acceptedThrough: run.lastAcceptedSequence,
          status: run.status,
        };
      }
      const acceptance: BatchAcceptance = {
        accepted: true,
        acceptedThrough: run.lastAcceptedSequence,
        status: "streaming",
      };
      if (run.leaseExpiresAt !== undefined) acceptance.leaseExpiresAt = run.leaseExpiresAt;
      return acceptance;
    }
    if (isTerminalStatus(run.status) || run.streamStatus === "finalized") {
      return { accepted: false, reason: "terminal", nextExpectedSequence: run.lastAcceptedSequence + 1 };
    }
    // The execution service reserves a run before it returns 202, but its
    // first result may still overtake the dispatch action's follow-up write.
    // A valid first batch is therefore also proof that this exact pending run
    // was accepted. Promote it in this transaction before persisting output.
    const pendingFirstResult = run.status === "pending" && args.sequence === 1;
    if (run.status !== "running" && run.status !== "cancellation_requested" && !pendingFirstResult) {
      return { accepted: false, reason: "not_active", nextExpectedSequence: run.lastAcceptedSequence + 1 };
    }
    const expectedSequence = run.lastAcceptedSequence + 1;
    if (args.sequence !== expectedSequence) {
      return { accepted: false, reason: "sequence_gap", nextExpectedSequence: expectedSequence };
    }

    const now = Date.now();
    const terminalEvent = batch.events.at(-1)!;
    const terminalStatus = terminalStatusForEvent(terminalEvent);
    const storedBatch = {
      runId: run._id,
      sequence: args.sequence,
      payloadHash: args.payloadHash,
      events: args.events,
      terminal: terminalStatus !== undefined,
      createdAt: now,
    };
    await ctx.db.insert(
      "runResultBatches",
      args.finalMessage
        ? { ...storedBatch, finalMessage: args.finalMessage }
        : storedBatch,
    );

    if (!terminalStatus) {
      const leaseExpiresAt = now + RUN_LEASE_MS;
      await ctx.db.patch(run._id, {
        lastAcceptedSequence: args.sequence,
        leaseExpiresAt,
        updatedAt: now,
      });
      if (pendingFirstResult) {
        await ctx.db.patch(run._id, {
          status: "running",
          dispatchDeadlineAt: undefined,
        });
        const command = await ctx.db.query("commands").withIndex("by_commandId", (index) => index.eq("commandId", run.commandId)).unique();
        if (!command) throw new Error("Run command not found.");
        await ctx.db.patch(command._id, { status: "running", lastDispatchError: undefined, updatedAt: now });
      }
      const message = await ctx.db.get(run.assistantMessageId);
      if (message?.status === "pending") await ctx.db.patch(message._id, { status: "streaming", updatedAt: now });
      return { accepted: true, acceptedThrough: args.sequence, status: "streaming", leaseExpiresAt };
    }

    if (!args.finalMessage) throw new Error("A terminal result batch requires finalMessage.");
    const assistantMessage = await ctx.db.get(run.assistantMessageId);
    if (!assistantMessage) throw new Error("Assistant message not found.");
    const terminalMetrics = terminalEvent.type === "completed"
      ? terminalEvent.metrics
      : args.finalMessage.metrics;
    await ctx.db.patch(assistantMessage._id, {
      status: terminalStatus,
      parts: args.finalMessage.parts,
      updatedAt: now,
    });
    if (terminalMetrics) {
      await ctx.db.patch(assistantMessage._id, { metrics: terminalMetrics });
    }
    await persistToolActivities(
      ctx,
      run._id,
      assistantMessage._id,
      args.finalMessage.parts,
    );
    await ctx.db.patch(run._id, {
      status: terminalStatus,
      streamStatus: "finalized",
      lastAcceptedSequence: args.sequence,
      leaseExpiresAt: undefined,
      terminalAt: now,
      updatedAt: now,
    });
    if (pendingFirstResult) {
      await ctx.db.patch(run._id, { dispatchDeadlineAt: undefined });
    }
    await updateCommandsForRun(ctx, run._id, terminalStatus);
    await ctx.scheduler.runAfter(RESULT_BATCH_RETENTION_MS, internal.results.cleanupRunBatches, { runId: run._id });
    return { accepted: true, acceptedThrough: args.sequence, status: terminalStatus };
  },
});

export const renewHeartbeat = internalMutation({
  args: { commandId: v.string(), runId: v.string() },
  handler: async (ctx, args) => {
    const run = await getRunByStableId(ctx, args.runId);
    if (!run || run.commandId !== args.commandId) throw new Error("Run does not match heartbeat command.");
    if (isTerminalStatus(run.status)) return { runId: run.stableId, status: run.status, leaseExpiresAt: undefined };
    if (run.status !== "running" && run.status !== "cancellation_requested") {
      throw new Error("Heartbeat is not valid before backend acceptance.");
    }
    const leaseExpiresAt = Date.now() + RUN_LEASE_MS;
    await ctx.db.patch(run._id, { leaseExpiresAt, updatedAt: Date.now() });
    return { runId: run.stableId, status: run.status, leaseExpiresAt };
  },
});

export const cleanupRunBatches = internalMutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || !isTerminalStatus(run.status) || !run.terminalAt) {
      return { deleted: 0, complete: true };
    }
    const remainingMs = run.terminalAt + RESULT_BATCH_RETENTION_MS - Date.now();
    if (remainingMs > 0) {
      await ctx.scheduler.runAfter(remainingMs, internal.results.cleanupRunBatches, { runId: args.runId });
      return { deleted: 0, complete: false };
    }
    const batches = await ctx.db.query("runResultBatches").withIndex("by_runId", (index) => index.eq("runId", args.runId)).take(100);
    for (const batch of batches) await ctx.db.delete(batch._id);
    if (batches.length === 100) {
      await ctx.scheduler.runAfter(0, internal.results.cleanupRunBatches, { runId: args.runId });
    }
    return { deleted: batches.length, complete: batches.length < 100 };
  },
});

export const failPendingRun = internalMutation({
  args: { runId: v.id("runs"), expectedDispatchDeadlineAt: v.number(), code: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "pending" || run.dispatchDeadlineAt !== args.expectedDispatchDeadlineAt || run.dispatchDeadlineAt > Date.now()) {
      return false;
    }
    const message = await ctx.db.get(run.assistantMessageId);
    if (!message) throw new Error("Assistant message not found.");
    const now = Date.now();
    const parts = appendFailurePart([], args.code, args.message);
    await ctx.db.patch(message._id, { status: "failed", parts, updatedAt: now });
    await ctx.db.patch(run._id, {
      status: "failed",
      streamStatus: "finalized",
      terminalErrorCode: args.code,
      terminalAt: now,
      updatedAt: now,
    });
    await updateCommandsForRun(ctx, run._id, "failed");
    await ctx.scheduler.runAfter(RESULT_BATCH_RETENTION_MS, internal.results.cleanupRunBatches, { runId: run._id });
    return true;
  },
});

export const failLostRun = internalMutation({
  args: { runId: v.id("runs"), expectedLeaseExpiresAt: v.number() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      (run.status !== "running" && run.status !== "cancellation_requested") ||
      run.leaseExpiresAt !== args.expectedLeaseExpiresAt ||
      run.leaseExpiresAt > Date.now()
    ) {
      return false;
    }
    const batches = await ctx.db
      .query("runResultBatches")
      .withIndex("by_runId_sequence", (index) => index.eq("runId", run._id))
      .collect();
    const events: PiEvent[] = batches.flatMap((batch) => batch.events);
    const parts = appendFailurePart(foldEventsIntoParts(events), "backend_lost", "The execution backend stopped before this run completed.");
    const message = await ctx.db.get(run.assistantMessageId);
    if (!message) throw new Error("Assistant message not found.");
    const now = Date.now();
    await ctx.db.patch(message._id, { status: "failed", parts, updatedAt: now });
    await persistToolActivities(ctx, run._id, message._id, parts);
    await ctx.db.patch(run._id, {
      status: "failed",
      streamStatus: "finalized",
      terminalErrorCode: "backend_lost",
      terminalAt: now,
      updatedAt: now,
    });
    await updateCommandsForRun(ctx, run._id, "failed");
    await ctx.scheduler.runAfter(RESULT_BATCH_RETENTION_MS, internal.results.cleanupRunBatches, { runId: run._id });
    return true;
  },
});
