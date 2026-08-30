import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalAction, internalMutation, internalQuery } from "./_generated/server.js";
import { getCommandById } from "./lib/data.js";
import { executionRequest } from "./lib/execution.js";
import { historyBeforePrompt, RUN_LEASE_MS } from "./lib/invariants.js";

export const getStartRequest = internalQuery({
  args: { commandId: v.string() },
  handler: async (ctx, args) => {
    const command = await getCommandById(ctx, args.commandId);
    if (!command || (command.type !== "thread.prompt" && command.type !== "thread.retry") || !command.runId) return null;
    const run = await ctx.db.get(command.runId);
    if (!run || run.status !== "pending" || !command.promptText) return null;
    const [thread, userMessage] = await Promise.all([ctx.db.get(run.threadId), ctx.db.get(run.userMessageId)]);
    if (!thread || !userMessage) return null;
    const history = await ctx.db
      .query("messages")
      .withIndex("by_thread_ordinal", (index) => index.eq("threadId", run.threadId))
      .order("asc")
      .collect();
    return {
      commandId: command.commandId,
      runId: run.stableId,
      actorId: run.ownerId,
      threadId: thread.stableId,
      assistantMessageId: run.assistantMessageStableId,
      prompt: command.promptText,
      history: historyBeforePrompt(history, userMessage.ordinal)
        .map((message) => ({
          messageId: message.stableId,
          role: message.role,
          parts: message.parts ?? (message.text ? [{ type: "text" as const, text: message.text }] : []),
        })),
    };
  },
});

export const getStopRequest = internalQuery({
  args: { commandId: v.string() },
  handler: async (ctx, args) => {
    const command = await getCommandById(ctx, args.commandId);
    if (!command || command.type !== "thread.stop" || !command.runId) return null;
    const run = await ctx.db.get(command.runId);
    if (!run || run.status !== "cancellation_requested") return null;
    return { commandId: command.commandId, runId: run.stableId, actorId: run.ownerId };
  },
});

export const markDispatching = internalMutation({
  args: { commandId: v.string() },
  handler: async (ctx, args) => {
    const command = await getCommandById(ctx, args.commandId);
    if (!command || !command.runId) return false;
    const run = await ctx.db.get(command.runId);
    if (!run) return false;
    if (run.status === "running" || run.status === "cancellation_requested") return true;
    if (run.status !== "pending") return false;
    const now = Date.now();
    await ctx.db.patch(command._id, {
      status: "dispatching",
      dispatchAttempts: command.dispatchAttempts + 1,
      updatedAt: now,
    });
    return true;
  },
});

export const markDispatchAccepted = internalMutation({
  args: { commandId: v.string() },
  handler: async (ctx, args) => {
    const command = await getCommandById(ctx, args.commandId);
    if (!command || !command.runId) return false;
    const run = await ctx.db.get(command.runId);
    if (!run) return false;
    // A valid first result can atomically promote the pending run before this
    // action processes the backend's 202 response. Do not overwrite the
    // resulting lease or terminal state; acknowledge that acceptance here.
    if (run.status !== "pending") return run.lastAcceptedSequence >= 1;
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "running",
      dispatchDeadlineAt: undefined,
      leaseExpiresAt: now + RUN_LEASE_MS,
      updatedAt: now,
    });
    await ctx.db.patch(command._id, { status: "running", lastDispatchError: undefined, updatedAt: now });
    return true;
  },
});

export const markDispatchFailure = internalMutation({
  args: { commandId: v.string() },
  handler: async (ctx, args) => {
    const command = await getCommandById(ctx, args.commandId);
    if (!command || !command.runId) return false;
    const run = await ctx.db.get(command.runId);
    if (!run || run.status !== "pending") return false;
    await ctx.db.patch(command._id, {
      status: "accepted",
      lastDispatchError: "Execution backend did not accept the run.",
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const markStopDispatching = internalMutation({
  args: { commandId: v.string() },
  handler: async (ctx, args) => {
    const command = await getCommandById(ctx, args.commandId);
    if (!command || command.type !== "thread.stop" || !command.runId) return false;
    const run = await ctx.db.get(command.runId);
    if (!run || run.status !== "cancellation_requested") return false;
    await ctx.db.patch(command._id, {
      status: "dispatching",
      dispatchAttempts: command.dispatchAttempts + 1,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const markStopDispatchFailure = internalMutation({
  args: { commandId: v.string() },
  handler: async (ctx, args) => {
    const command = await getCommandById(ctx, args.commandId);
    if (!command || command.type !== "thread.stop" || !command.runId) return false;
    const run = await ctx.db.get(command.runId);
    if (!run || run.status !== "cancellation_requested") return false;
    await ctx.db.patch(command._id, {
      status: "accepted",
      lastDispatchError: "Execution backend did not accept the cancellation request.",
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const startRun = internalAction({
  args: { commandId: v.string() },
  handler: async (ctx, args) => {
    const request = await ctx.runQuery(internal.dispatch.getStartRequest, { commandId: args.commandId });
    if (!request) return { dispatched: false };
    if (!await ctx.runMutation(internal.dispatch.markDispatching, { commandId: args.commandId })) {
      return { dispatched: false };
    }
    try {
      const response = await executionRequest(request.actorId, "/runs", request);
      if (response.status !== 202) throw new Error("Execution backend rejected the run.");
      await ctx.runMutation(internal.dispatch.markDispatchAccepted, { commandId: args.commandId });
      return { dispatched: true };
    } catch {
      await ctx.runMutation(internal.dispatch.markDispatchFailure, { commandId: args.commandId });
      return { dispatched: false };
    }
  },
});

export const stopRun = internalAction({
  args: { commandId: v.string() },
  handler: async (ctx, args) => {
    const request = await ctx.runQuery(internal.dispatch.getStopRequest, { commandId: args.commandId });
    if (!request) return { dispatched: false };
    if (!await ctx.runMutation(internal.dispatch.markStopDispatching, { commandId: args.commandId })) {
      return { dispatched: false };
    }
    try {
      const response = await executionRequest(request.actorId, `/runs/${encodeURIComponent(request.runId)}/cancel`, {
        commandId: request.commandId,
        runId: request.runId,
        actorId: request.actorId,
      });
      if (!response.ok && response.status !== 202) throw new Error("Execution backend rejected cancellation.");
      return { dispatched: true };
    } catch {
      await ctx.runMutation(internal.dispatch.markStopDispatchFailure, { commandId: args.commandId });
      return { dispatched: false };
    }
  },
});
