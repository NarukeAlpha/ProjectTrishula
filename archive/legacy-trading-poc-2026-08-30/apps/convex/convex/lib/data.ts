import type { QueryCtx } from "../_generated/server.js";
import type { Doc } from "../_generated/dataModel.js";

type Reader = Pick<QueryCtx, "db">;

export async function getThreadByStableId(
  ctx: Reader,
  ownerId: string,
  stableId: string,
): Promise<Doc<"threads"> | null> {
  return ctx.db
    .query("threads")
    .withIndex("by_owner_stableId", (index) => index.eq("ownerId", ownerId).eq("stableId", stableId))
    .unique();
}

export async function getCommandByOwnerAndId(
  ctx: Reader,
  ownerId: string,
  commandId: string,
): Promise<Doc<"commands"> | null> {
  return ctx.db
    .query("commands")
    .withIndex("by_owner_commandId", (index) => index.eq("ownerId", ownerId).eq("commandId", commandId))
    .unique();
}

export async function getCommandById(ctx: Reader, commandId: string): Promise<Doc<"commands"> | null> {
  return ctx.db.query("commands").withIndex("by_commandId", (index) => index.eq("commandId", commandId)).unique();
}

export async function getRunByStableId(ctx: Reader, stableId: string): Promise<Doc<"runs"> | null> {
  return ctx.db.query("runs").withIndex("by_stableId", (index) => index.eq("stableId", stableId)).unique();
}

export async function getMessageByStableId(
  ctx: Reader,
  ownerId: string,
  stableId: string,
): Promise<Doc<"messages"> | null> {
  return ctx.db
    .query("messages")
    .withIndex("by_owner_stableId", (index) => index.eq("ownerId", ownerId).eq("stableId", stableId))
    .unique();
}
