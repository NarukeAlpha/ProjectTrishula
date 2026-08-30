import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalQuery, mutation, query, type MutationCtx } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import { actorFromIdentity } from "./lib/auth.js";
import { getCommandById, getCommandByOwnerAndId, getRunByStableId, getThreadByStableId } from "./lib/data.js";
import { isTerminalStatus, DISPATCH_DEADLINE_MS } from "./lib/invariants.js";
import { commandFingerprint, MAX_THREAD_ID_LENGTH, previewFor, requireSameCommand, requireStableId, requireText } from "./lib/validation.js";

const commandIdValidator = v.string();
const threadStableIdValidator = v.optional(v.string());

function commandAccepted(commandId: string, threadStableId: string, runStableId: string) {
  return { commandId, threadId: threadStableId, runId: runStableId, status: "accepted" as const };
}

async function ensureUniqueCommandId(ctx: MutationCtx, ownerId: string, commandId: string) {
  const own = await getCommandByOwnerAndId(ctx, ownerId, commandId);
  if (own) return own;
  const foreign = await getCommandById(ctx, commandId);
  if (foreign) throw new Error("commandId is already assigned to another user.");
  return null;
}

async function activeRunForThread(ctx: MutationCtx, threadId: Id<"threads">) {
  for (const status of ["pending", "running", "cancellation_requested"] as const) {
    const run = await ctx.db
      .query("runs")
      .withIndex("by_thread_status", (index) => index.eq("threadId", threadId).eq("status", status))
      .first();
    if (run) return run;
  }
  return null;
}

interface CreatePromptRunInput {
  commandId: string;
  type: "thread.prompt" | "thread.retry";
  ownerId: string;
  threadStableId: string;
  promptText: string;
  sourceRunId?: Id<"runs">;
  sourceRunStableId?: string;
  sourceUserMessageId?: Id<"messages">;
}

async function createPromptRun(ctx: MutationCtx, input: CreatePromptRunInput) {
  const now = Date.now();
  let thread = await getThreadByStableId(ctx, input.ownerId, input.threadStableId);
  if (thread?.archivedAt !== undefined) throw new Error("Thread is archived.");
  if (!thread) {
    const threadId = await ctx.db.insert("threads", {
      ownerId: input.ownerId,
      stableId: input.threadStableId,
      title: previewFor(input.promptText, 80),
      preview: previewFor(input.promptText),
      createdAt: now,
      updatedAt: now,
    });
    thread = await ctx.db.get(threadId);
    if (!thread) throw new Error("Failed to create thread.");
  }

  if (await activeRunForThread(ctx, thread._id)) {
    throw new Error("Only one run can execute for a thread at a time.");
  }

  const assistantMessageStableId = `assistant_${input.commandId}`;
  const runStableId = `run_${input.commandId}`;
  const latestMessage = await ctx.db
    .query("messages")
    .withIndex("by_thread_ordinal", (index) => index.eq("threadId", thread._id))
    .order("desc")
    .first();
  let userMessageId: Id<"messages">;
  let assistantOrdinal: number;
  if (input.sourceUserMessageId) {
    const sourceUserMessage = await ctx.db.get(input.sourceUserMessageId);
    if (
      !sourceUserMessage ||
      sourceUserMessage.ownerId !== input.ownerId ||
      sourceUserMessage.threadId !== thread._id ||
      sourceUserMessage.role !== "user"
    ) {
      throw new Error("The original prompt message is unavailable.");
    }
    userMessageId = sourceUserMessage._id;
    assistantOrdinal = (latestMessage?.ordinal ?? -1) + 1;
  } else {
    userMessageId = await ctx.db.insert("messages", {
      ownerId: input.ownerId,
      stableId: `user_${input.commandId}`,
      threadId: thread._id,
      ordinal: (latestMessage?.ordinal ?? -1) + 1,
      role: "user",
      status: "completed",
      text: input.promptText,
      createdAt: now,
      updatedAt: now,
    });
    assistantOrdinal = (latestMessage?.ordinal ?? -1) + 2;
  }
  const assistantMessageId = await ctx.db.insert("messages", {
    ownerId: input.ownerId,
    stableId: assistantMessageStableId,
    threadId: thread._id,
    ordinal: assistantOrdinal,
    role: "assistant",
    status: "pending",
    parts: [],
    createdAt: now,
    updatedAt: now,
  });

  const fingerprint = input.type === "thread.retry"
    ? commandFingerprint({ type: input.type, runId: input.sourceRunStableId })
    : commandFingerprint({ type: input.type, threadId: input.threadStableId, promptText: input.promptText });
  const commandDocId = await ctx.db.insert("commands", {
    ownerId: input.ownerId,
    commandId: input.commandId,
    type: input.type,
    status: "accepted",
    requestFingerprint: fingerprint,
    threadId: thread._id,
    promptText: input.promptText,
    dispatchAttempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  const runId = await ctx.db.insert("runs", {
    ownerId: input.ownerId,
    stableId: runStableId,
    commandId: input.commandId,
    threadId: thread._id,
    userMessageId,
    assistantMessageId,
    assistantMessageStableId,
    status: "pending",
    streamStatus: "live",
    lastAcceptedSequence: 0,
    dispatchDeadlineAt: now + DISPATCH_DEADLINE_MS,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(assistantMessageId, { runId });
  await ctx.db.patch(commandDocId, { runId });
  if (input.sourceRunId) {
    await ctx.db.patch(commandDocId, { sourceRunId: input.sourceRunId });
  }
  await ctx.db.patch(thread._id, { preview: previewFor(input.promptText), updatedAt: now });
  await ctx.scheduler.runAfter(0, internal.dispatch.startRun, { commandId: input.commandId });
  return commandAccepted(input.commandId, thread.stableId, runStableId);
}

export const get = query({
  args: { commandId: commandIdValidator },
  handler: async (ctx, args) => {
    requireStableId(args.commandId, "commandId");
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const command = await getCommandByOwnerAndId(ctx, actor.id, args.commandId);
    if (!command) return null;
    const thread = command.threadId ? await ctx.db.get(command.threadId) : null;
    const run = command.runId ? await ctx.db.get(command.runId) : null;
    return {
      commandId: command.commandId,
      type: command.type,
      status: command.status,
      threadId: thread?.stableId,
      runId: run?.stableId,
      dispatchAttempts: command.dispatchAttempts,
      lastDispatchError: command.lastDispatchError,
      errorCode: run?.terminalErrorCode,
      createdAt: command.createdAt,
      updatedAt: command.updatedAt,
    };
  },
});

export const submitPrompt = mutation({
  args: {
    commandId: commandIdValidator,
    threadId: threadStableIdValidator,
    text: v.string(),
  },
  handler: async (ctx, args) => {
    requireStableId(args.commandId, "commandId");
    const promptText = requireText(args.text, "text");
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const threadStableId = args.threadId ?? `thread_${args.commandId}`;
    requireStableId(threadStableId, "threadId", MAX_THREAD_ID_LENGTH);

    const existing = await ensureUniqueCommandId(ctx, actor.id, args.commandId);
    const fingerprint = commandFingerprint({ type: "thread.prompt", threadId: threadStableId, promptText });
    if (existing) {
      requireSameCommand(existing, "thread.prompt", fingerprint);
      if (!existing.runId || !existing.threadId) throw new Error("Existing prompt command is incomplete.");
      const [thread, run] = await Promise.all([ctx.db.get(existing.threadId), ctx.db.get(existing.runId)]);
      if (!thread || !run) throw new Error("Existing prompt command references missing state.");
      return commandAccepted(existing.commandId, thread.stableId, run.stableId);
    }

    return createPromptRun(ctx, {
      commandId: args.commandId,
      type: "thread.prompt",
      ownerId: actor.id,
      threadStableId,
      promptText,
    });
  },
});

export const retryRun = mutation({
  args: { commandId: commandIdValidator, runId: v.string() },
  handler: async (ctx, args) => {
    requireStableId(args.commandId, "commandId");
    requireStableId(args.runId, "runId", MAX_THREAD_ID_LENGTH);
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const existing = await ensureUniqueCommandId(ctx, actor.id, args.commandId);
    const fingerprint = commandFingerprint({ type: "thread.retry", runId: args.runId });
    if (existing) {
      requireSameCommand(existing, "thread.retry", fingerprint);
      if (!existing.runId || !existing.threadId) throw new Error("Existing retry command is incomplete.");
      const [thread, run] = await Promise.all([ctx.db.get(existing.threadId), ctx.db.get(existing.runId)]);
      if (!thread || !run) throw new Error("Existing retry command references missing state.");
      return commandAccepted(existing.commandId, thread.stableId, run.stableId);
    }

    const sourceRun = await getRunByStableId(ctx, args.runId);
    if (!sourceRun || sourceRun.ownerId !== actor.id) throw new Error("Run not found.");
    if (!isTerminalStatus(sourceRun.status)) throw new Error("Only a terminal run can be retried.");
    const sourceCommand = await getCommandById(ctx, sourceRun.commandId);
    const thread = await ctx.db.get(sourceRun.threadId);
    if (!sourceCommand?.promptText || !thread) throw new Error("The original prompt is unavailable.");

    return createPromptRun(ctx, {
      commandId: args.commandId,
      type: "thread.retry",
      ownerId: actor.id,
      threadStableId: thread.stableId,
      promptText: sourceCommand.promptText,
      sourceRunId: sourceRun._id,
      sourceRunStableId: sourceRun.stableId,
      sourceUserMessageId: sourceRun.userMessageId,
    });
  },
});

export const requestStop = mutation({
  args: { commandId: commandIdValidator, runId: v.string() },
  handler: async (ctx, args) => {
    requireStableId(args.commandId, "commandId");
    requireStableId(args.runId, "runId", MAX_THREAD_ID_LENGTH);
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const existing = await ensureUniqueCommandId(ctx, actor.id, args.commandId);
    const fingerprint = commandFingerprint({ type: "thread.stop", runId: args.runId });
    if (existing) {
      requireSameCommand(existing, "thread.stop", fingerprint);
      const run = existing.runId ? await ctx.db.get(existing.runId) : null;
      const thread = existing.threadId ? await ctx.db.get(existing.threadId) : null;
      if (!run || !thread) throw new Error("Existing stop command is incomplete.");
      return commandAccepted(existing.commandId, thread.stableId, run.stableId);
    }

    const run = await getRunByStableId(ctx, args.runId);
    if (!run || run.ownerId !== actor.id) throw new Error("Run not found.");
    if (run.status !== "running") throw new Error("Only a running run can be stopped.");
    const thread = await ctx.db.get(run.threadId);
    if (!thread) throw new Error("Run thread not found.");

    const now = Date.now();
    await ctx.db.insert("commands", {
      ownerId: actor.id,
      commandId: args.commandId,
      type: "thread.stop",
      status: "dispatching",
      requestFingerprint: fingerprint,
      threadId: run.threadId,
      runId: run._id,
      dispatchAttempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(run._id, { status: "cancellation_requested", updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.dispatch.stopRun, { commandId: args.commandId });
    return commandAccepted(args.commandId, thread.stableId, run.stableId);
  },
});

export const getForDispatch = internalQuery({
  args: { commandId: v.string() },
  handler: async (ctx, args) => getCommandById(ctx, args.commandId),
});
