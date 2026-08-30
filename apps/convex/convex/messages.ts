import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { actorFromIdentity } from "./lib/auth.js";
import { getThreadByStableId } from "./lib/data.js";
import { MAX_THREAD_ID_LENGTH, requireStableId } from "./lib/validation.js";

export const listPage = query({
  args: { threadId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    requireStableId(args.threadId, "threadId", MAX_THREAD_ID_LENGTH);
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const thread = await getThreadByStableId(ctx, actor.id, args.threadId);
    if (!thread || thread.archivedAt !== undefined) throw new Error("Thread not found.");
    const page = await ctx.db
      .query("messages")
      .withIndex("by_thread_ordinal", (index) => index.eq("threadId", thread._id))
      .order("desc")
      .paginate(args.paginationOpts);
    const messages = await Promise.all(page.page.map(async (message) => {
      const run = message.runId ? await ctx.db.get(message.runId) : null;
      const readModel = {
        stableId: message.stableId,
        threadId: thread.stableId,
        ordinal: message.ordinal,
        role: message.role,
        status: message.status,
        text: message.text,
        parts: message.parts ?? (message.text ? [{ type: "text" as const, text: message.text }] : []),
        metrics: message.metrics,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
      };
      return run ? { ...readModel, runId: run.stableId } : readModel;
    }));
    return {
      ...page,
      page: messages,
    };
  },
});
