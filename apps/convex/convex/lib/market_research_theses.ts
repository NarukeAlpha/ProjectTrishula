import type { Infer } from "convex/values";
import { z } from "zod";
import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import type { marketResearchThesisSnapshotValidator } from "../schema.js";

export type ThesisSnapshot = Infer<typeof marketResearchThesisSnapshotValidator>;

export const thesisUpdatesSchema = z.array(z.object({
  symbol: z.string().regex(/^[A-Z0-9.^=-]{1,20}$/),
  baseRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  text: z.string().trim().min(1).max(2_000),
  catalysts: z.array(z.string().trim().min(1).max(500)).max(8),
  invalidation: z.string().trim().min(1).max(2_000),
  openQuestions: z.array(z.string().trim().min(1).max(500)).max(8),
  assessment: z.enum(["new", "unchanged", "strengthened", "weakened", "invalidated", "not_rechecked"]),
  changeSummary: z.string().trim().min(1).max(1_000),
  sourceIds: z.array(z.string().regex(/^[A-Za-z0-9:._-]{1,256}$/)).max(10)
    .refine((ids) => new Set(ids).size === ids.length),
}).strict()).max(50).refine((updates) => new Set(updates.map((update) => update.symbol)).size === updates.length);

type ThesisUpdate = z.infer<typeof thesisUpdatesSchema>[number];
type MemoryContext = Pick<Doc<"marketResearchEditions">,
  "editionId" | "ownerId" | "guildId" | "createdAt" | "configurationSnapshot" | "thesisMemory"
>;
type ThesisEvidence = Pick<Doc<"marketResearchEvidence">,
  "evidenceId" | "kind" | "sourcePolicy" | "contentStatus"
> & { url?: string | undefined; title?: string | undefined };

export function thesisSnapshot(record: Doc<"marketResearchTheses">): ThesisSnapshot {
  return {
    symbol: record.symbol, revision: record.revision, text: record.text,
    catalysts: record.catalysts, invalidation: record.invalidation, openQuestions: record.openQuestions,
    status: record.status, assessment: record.assessment, changeSummary: record.changeSummary,
    sources: record.sources, lastReviewedAt: record.lastReviewedAt, lastEditionId: record.lastEditionId,
  };
}

export async function loadThesisMemory(
  ctx: Pick<QueryCtx, "db">,
  preferences: MemoryContext["configurationSnapshot"],
): Promise<ThesisSnapshot[]> {
  const symbols = [...new Set([...preferences.primarySymbols, ...preferences.discoverySymbols])];
  const records = await Promise.all(symbols.map((symbol) => ctx.db.query("marketResearchTheses")
    .withIndex("by_owner_guild_symbol", (index) => index.eq("ownerId", preferences.ownerId)
      .eq("guildId", preferences.guildId).eq("symbol", symbol)).unique()));
  return records.filter((record) => record !== null).map(thesisSnapshot);
}

function materialReview(update: ThesisUpdate): boolean {
  return update.assessment !== "unchanged" && update.assessment !== "not_rechecked";
}

export function thesisUpdatesMatchContext(
  updates: ThesisUpdate[],
  context: Pick<MemoryContext, "configurationSnapshot" | "thesisMemory">,
  evidence: ThesisEvidence[],
  allowedSourceIds: string[],
): boolean {
  const symbols = new Set([...context.configurationSnapshot.primarySymbols, ...context.configurationSnapshot.discoverySymbols]);
  const previous = new Map(context.thesisMemory?.map((note) => [note.symbol, note]));
  const legacy = new Set(context.configurationSnapshot.durableTheses
    .filter((note) => note.status !== "expired").map((note) => note.symbol));
  const allowed = new Set(allowedSourceIds);
  const usable = new Set(evidence.filter((item) => allowed.has(item.evidenceId)
    && item.sourcePolicy === "approved" && ["available", "cached"].includes(item.contentStatus)
    && item.kind !== "source_status" && item.kind !== "calendar").map((item) => item.evidenceId));
  return updates.every((update) => {
    const prior = previous.get(update.symbol);
    const hasPrior = prior !== undefined || legacy.has(update.symbol);
    return symbols.has(update.symbol)
      && update.baseRevision === (prior?.revision ?? 0)
      && update.sourceIds.every((id) => usable.has(id))
      && (!materialReview(update) || update.sourceIds.length > 0)
      && (hasPrior ? update.assessment !== "new" : update.assessment === "new");
  });
}

// Called only after every report/evidence/delivery validation succeeds, in the same
// Convex transaction that saves the accepted report. Preview and failed runs never call it.
export async function commitThesisUpdates(
  ctx: Pick<MutationCtx, "db">,
  edition: MemoryContext,
  updates: ThesisUpdate[],
  evidence: ThesisEvidence[],
  now: number,
): Promise<{ applied: number; skipped: number }> {
  const byId = new Map(evidence.map((item) => [item.evidenceId, item]));
  let applied = 0;
  let skipped = 0;
  for (const update of updates) {
    const current = await ctx.db.query("marketResearchTheses")
      .withIndex("by_owner_guild_symbol", (index) => index.eq("ownerId", edition.ownerId)
        .eq("guildId", edition.guildId).eq("symbol", update.symbol)).unique();
    // A revision compare-and-swap and a generation-independent edition identity
    // prevent concurrent reports and an old retry from replacing newer research.
    if ((current?.revision ?? 0) !== update.baseRevision
      || current?.lastEditionId === edition.editionId
      || (current !== null && current.lastEditionCreatedAt > edition.createdAt)
      || (current === null && !materialReview(update))) {
      skipped += 1;
      continue;
    }
    const sources = update.sourceIds.map((sourceId) => {
      const source = byId.get(sourceId);
      const reference: ThesisSnapshot["sources"][number] = { sourceId };
      if (source?.url !== undefined) reference.url = source.url.slice(0, 2_048);
      if (source?.title !== undefined) reference.title = source.title.slice(0, 300);
      return reference;
    });
    const prior = current === null ? undefined : thesisSnapshot(current);
    const preserve = prior !== undefined && !materialReview(update);
    const next: ThesisSnapshot = {
      symbol: update.symbol,
      revision: update.baseRevision + 1,
      text: preserve ? prior.text : update.text,
      catalysts: preserve ? prior.catalysts : update.catalysts,
      invalidation: preserve ? prior.invalidation : update.invalidation,
      openQuestions: preserve ? prior.openQuestions : update.openQuestions,
      status: preserve ? prior.status : update.assessment === "invalidated" ? "invalidated" : "active",
      assessment: update.assessment,
      changeSummary: update.changeSummary,
      sources: preserve ? prior.sources : sources,
      lastReviewedAt: prior !== undefined && (update.assessment === "not_rechecked" || update.sourceIds.length === 0)
        ? prior.lastReviewedAt : new Date(now).toISOString(),
      lastEditionId: edition.editionId,
    };
    const value = {
      ...next,
      lastEditionCreatedAt: edition.createdAt,
      history: prior === undefined ? [] : [...(current?.history ?? []), prior].slice(-10),
      updatedAt: now,
    };
    if (current !== null) await ctx.db.patch(current._id, value);
    else await ctx.db.insert("marketResearchTheses", {
      ...value, ownerId: edition.ownerId, guildId: edition.guildId, createdAt: now,
    });
    applied += 1;
  }
  return { applied, skipped };
}
