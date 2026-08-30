import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { actorFromIdentity } from "./lib/auth.js";
import { getCommandById, getCommandByOwnerAndId, getThreadByStableId } from "./lib/data.js";
import { commandFingerprint, MAX_THREAD_ID_LENGTH, requireSameCommand, requireStableId, requireTitle } from "./lib/validation.js";
import { mutation, query, type QueryCtx } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";

async function activeRunStatus(ctx: QueryCtx, threadId: Id<"threads">) {
  for (const status of ["pending", "running", "cancellation_requested"] as const) {
    const run = await ctx.db
      .query("runs")
      .withIndex("by_thread_status", (index) => index.eq("threadId", threadId).eq("status", status))
      .first();
    if (run) return run.status;
  }
  return undefined;
}

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_owner_archivedAt_updatedAt", (index) => index.eq("ownerId", actor.id).eq("archivedAt", undefined))
      .order("desc")
      .paginate(args.paginationOpts);
    const page = await Promise.all(threads.page.map(async (thread) => {
      const currentStatus = await activeRunStatus(ctx, thread._id);
      const summary = {
        stableId: thread.stableId,
        title: thread.title,
        preview: thread.preview,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      };
      return currentStatus ? { ...summary, activeRunStatus: currentStatus } : summary;
    }));
    return {
      ...threads,
      page,
    };
  },
});

export const get = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    requireStableId(args.threadId, "threadId", MAX_THREAD_ID_LENGTH);
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const thread = await getThreadByStableId(ctx, actor.id, args.threadId);
    if (!thread || thread.archivedAt !== undefined) return null;
    return {
      stableId: thread.stableId,
      title: thread.title,
      preview: thread.preview,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    };
  },
});

export const rename = mutation({
  args: { commandId: v.string(), threadId: v.string(), title: v.string() },
  handler: async (ctx, args) => {
    requireStableId(args.commandId, "commandId");
    requireStableId(args.threadId, "threadId", MAX_THREAD_ID_LENGTH);
    const title = requireTitle(args.title);
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const fingerprint = commandFingerprint({ type: "thread.rename", threadId: args.threadId, title });
    const existing = await getCommandByOwnerAndId(ctx, actor.id, args.commandId);
    if (existing) {
      requireSameCommand(existing, "thread.rename", fingerprint);
      return { commandId: existing.commandId, status: "accepted" as const };
    }
    if (await getCommandById(ctx, args.commandId)) throw new Error("commandId is already assigned to another user.");
    const thread = await getThreadByStableId(ctx, actor.id, args.threadId);
    if (!thread || thread.archivedAt !== undefined) throw new Error("Thread not found.");
    const now = Date.now();
    await ctx.db.patch(thread._id, { title, updatedAt: now });
    await ctx.db.insert("commands", {
      ownerId: actor.id,
      commandId: args.commandId,
      type: "thread.rename",
      status: "completed",
      requestFingerprint: fingerprint,
      threadId: thread._id,
      title,
      dispatchAttempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { commandId: args.commandId, status: "accepted" as const };
  },
});

export const archive = mutation({
  args: { commandId: v.string(), threadId: v.string() },
  handler: async (ctx, args) => {
    requireStableId(args.commandId, "commandId");
    requireStableId(args.threadId, "threadId", MAX_THREAD_ID_LENGTH);
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const fingerprint = commandFingerprint({ type: "thread.archive", threadId: args.threadId });
    const existing = await getCommandByOwnerAndId(ctx, actor.id, args.commandId);
    if (existing) {
      requireSameCommand(existing, "thread.archive", fingerprint);
      return { commandId: existing.commandId, status: "accepted" as const };
    }
    if (await getCommandById(ctx, args.commandId)) throw new Error("commandId is already assigned to another user.");
    const thread = await getThreadByStableId(ctx, actor.id, args.threadId);
    if (!thread) throw new Error("Thread not found.");
    const now = Date.now();
    await ctx.db.patch(thread._id, { archivedAt: thread.archivedAt ?? now, updatedAt: now });
    await ctx.db.insert("commands", {
      ownerId: actor.id,
      commandId: args.commandId,
      type: "thread.archive",
      status: "completed",
      requestFingerprint: fingerprint,
      threadId: thread._id,
      dispatchAttempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { commandId: args.commandId, status: "accepted" as const };
  },
});
