import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc } from "../convex/_generated/dataModel.js";
import {
  commitThesisUpdates, loadThesisMemory, thesisSnapshot, thesisUpdatesMatchContext, thesisUpdatesSchema,
  type ThesisSnapshot,
} from "../convex/lib/market_research_theses.js";
import { claimResearch, failRun, getThesisMemory, manualTrigger, saveControlSettings } from "../convex/market_research.js";
import { convexMutationFixture, invokeMutation } from "./helpers/convex-fixture.js";

const now = Date.parse("2026-09-08T12:00:00Z");
const evidence = [{
  evidenceId: "exa-company-news", kind: "news" as const, sourcePolicy: "approved" as const,
  contentStatus: "available" as const, url: "https://example.com/company-news", title: "Company update",
}];
const newUpdate = {
  symbol: "AAPL", baseRevision: 0, text: "Service demand supports recurring revenue growth.",
  catalysts: ["Next earnings release"], invalidation: "Demand declines across two reported quarters.",
  openQuestions: ["Can margins hold as the product mix shifts?"], assessment: "new" as const,
  changeSummary: "Established a source-backed business thesis.", sourceIds: ["exa-company-news"],
};

async function fixture() {
  const db = convexMutationFixture();
  db.rows("discordChannels").push({
    _id: "channel", ownerId: "owner_1", guildId: "guild_1", channelId: "forum_1",
    available: true, type: "forum", canView: true, canCreateForumPost: true,
    canSendInThreads: true, canReadThreadHistory: true, canAttachFiles: true, requiresTag: false,
  });
  db.rows("marketSessionCalendars").push({
    _id: "calendar", ownerId: "owner_1", calendarId: "nyse", version: "test-calendar",
    sourceUrl: "https://www.nyse.com/trade/hours-calendars", retrievedAt: now,
    effectiveStart: "2026-09-04", effectiveEnd: "2026-09-10", contentHash: "a".repeat(64), reviewed: true,
    sessions: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-09-${String(index + 4).padStart(2, "0")}`, status: "OPEN",
      regularOpen: "09:30", regularClose: "16:00",
    })),
  });
  await invokeMutation(saveControlSettings, db.ctx, {
    guildId: "guild_1", forumChannelId: "forum_1", forumTagIds: [], timezone: "America/New_York",
    timezoneConfirmed: true, localHour: 8, localMinute: 0, includeWeekends: true,
    editionDepth: "full", maximumRankedSetups: 10, includeCharts: false, maximumCharts: 0, enabled: false,
  });
  const create = async (requestId: string) => {
    const result = await invokeMutation(manualTrigger, db.ctx, {
      guildId: "guild_1", dryRun: false, publish: true, regeneratePublishedEdition: false, requestId,
    });
    const edition = db.rows("marketResearchEditions").find((row) => row.editionId === result.editionId);
    if (edition === undefined) throw new Error("Expected the real manual handler to create an edition.");
    // SAFETY: The actual manualTrigger handler inserted this table's schema-validated record.
    return edition as Doc<"marketResearchEditions">;
  };
  const current = () => {
    const note = db.rows("marketResearchTheses")[0];
    if (note === undefined) throw new Error("Expected a persisted thesis.");
    // SAFETY: commitThesisUpdates wrote this record using the generated table type.
    return note as Doc<"marketResearchTheses">;
  };
  return { db, create, current, edition: await create("initial") };
}

beforeEach(() => {
  vi.stubEnv("WORKOS_ALLOWED_USER_IDS", "owner_1,owner_2");
  vi.stubEnv("MARKET_RESEARCH_OWNER_ID", "owner_1");
  vi.useFakeTimers(); vi.setSystemTime(now);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("per-stock durable research memory", () => {
  it("persists cited notes and freezes them into the next real claim without changing saved settings", async () => {
    const test = await fixture();
    const preferences = structuredClone(test.db.rows("marketResearchPreferences"));
    expect(thesisUpdatesMatchContext([newUpdate], test.edition, evidence, ["exa-company-news"])).toBe(true);
    expect(await commitThesisUpdates(test.db.ctx, test.edition, [newUpdate], evidence, now))
      .toEqual({ applied: 1, skipped: 0 });
    expect(test.current()).toMatchObject({ revision: 1, text: newUpdate.text, status: "active", history: [],
      sources: [{ sourceId: "exa-company-news", url: evidence[0]?.url, title: "Company update" }] });
    vi.setSystemTime(now + 1_000);
    const next = await test.create("next");
    const claim = await invokeMutation(claimResearch, test.db.ctx, { editionId: next.editionId, workerId: "worker" });
    expect(claim.thesisMemory).toEqual([thesisSnapshot(test.current())]);
    expect(test.edition.thesisMemory).toEqual([]);
    expect(test.db.rows("marketResearchPreferences")).toEqual(preferences);
  });

  it.each(["unchanged", "not_rechecked"] as const)("preserves the thesis and sources for %s", async (assessment) => {
    const test = await fixture();
    await commitThesisUpdates(test.db.ctx, test.edition, [newUpdate], evidence, now);
    const previous = thesisSnapshot(test.current());
    vi.setSystemTime(now + 1_000);
    const next = await test.create("review");
    const update = { ...newUpdate, baseRevision: 1, assessment, sourceIds: [],
      text: "Untrusted replacement", invalidation: "Invalidated because no quotes", catalysts: [], openQuestions: [],
      changeSummary: "No fresh fundamental information was available." };
    expect(thesisUpdatesMatchContext([update], next, [], [])).toBe(true);
    await commitThesisUpdates(test.db.ctx, next, [update], [], now + 1_000);
    expect(test.current()).toMatchObject({ ...previous, revision: 2, assessment,
      changeSummary: update.changeSummary, lastEditionId: next.editionId,
      lastReviewedAt: new Date(now).toISOString(), history: [previous] });
  });

  it("retains only the ten previous revisions and does not duplicate a same-edition completion", async () => {
    const test = await fixture();
    await commitThesisUpdates(test.db.ctx, test.edition, [newUpdate], evidence, now);
    for (let revision = 1; revision <= 12; revision += 1) {
      vi.setSystemTime(now + revision * 1_000);
      const next = await test.create(`revision-${revision}`);
      await commitThesisUpdates(test.db.ctx, next, [{ ...newUpdate, baseRevision: revision,
        assessment: "strengthened", text: `Evidence revision ${revision + 1}` }], evidence, now + revision * 1_000);
    }
    expect(test.current().revision).toBe(13);
    expect(test.current().history.map((item) => item.revision)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const duplicate = { ...test.edition, editionId: test.current().lastEditionId, createdAt: now + 12_000 };
    expect(await commitThesisUpdates(test.db.ctx, duplicate, [{ ...newUpdate, baseRevision: 13,
      assessment: "strengthened" }], evidence, now + 13_000)).toEqual({ applied: 0, skipped: 1 });
    expect(test.current().revision).toBe(13);
  });

  it("skips a concurrent stale revision and an older edition even when its revision matches", async () => {
    const test = await fixture();
    const older = test.edition;
    vi.setSystemTime(now + 1_000);
    const newer = await test.create("newer");
    await commitThesisUpdates(test.db.ctx, newer, [newUpdate], evidence, now + 1_000);
    expect(await commitThesisUpdates(test.db.ctx, older, [newUpdate], evidence, now + 2_000))
      .toEqual({ applied: 0, skipped: 1 });
    expect(await commitThesisUpdates(test.db.ctx, older, [{ ...newUpdate, baseRevision: 1,
      assessment: "strengthened" }], evidence, now + 2_000)).toEqual({ applied: 0, skipped: 1 });
    expect(test.current().lastEditionId).toBe(newer.editionId);
  });

  it("keeps frozen contexts stable when current memory advances", async () => {
    const test = await fixture();
    await commitThesisUpdates(test.db.ctx, test.edition, [newUpdate], evidence, now);
    const next = await test.create("frozen");
    expect(next.thesisMemory?.[0]?.revision).toBe(1);
    await commitThesisUpdates(test.db.ctx, { ...next, editionId: "third", createdAt: now + 1_000 },
      [{ ...newUpdate, baseRevision: 1, assessment: "weakened" }], evidence, now + 1_000);
    expect(next.thesisMemory?.[0]?.revision).toBe(1);
    expect(thesisUpdatesMatchContext([{ ...newUpdate, baseRevision: 2, assessment: "strengthened" }], next,
      evidence, ["exa-company-news"])).toBe(false);
  });

  it("requires usable current sources for material changes and keeps symbols within the frozen list", async () => {
    const test = await fixture();
    for (const update of [
      { ...newUpdate, sourceIds: [] }, { ...newUpdate, sourceIds: ["prior-report-source"] },
      { ...newUpdate, symbol: "ZZZZZ" }, { ...newUpdate, baseRevision: 3 },
      { ...newUpdate, assessment: "invalidated" as const },
    ]) expect(thesisUpdatesMatchContext([update], test.edition, evidence, ["exa-company-news"])).toBe(false);
    for (const source of [
      { ...evidence[0]!, contentStatus: "failed" as const },
      { ...evidence[0]!, sourcePolicy: "blocked" as const },
      { ...evidence[0]!, kind: "source_status" as const },
      { ...evidence[0]!, kind: "calendar" as const },
    ]) expect(thesisUpdatesMatchContext([newUpdate], test.edition, [source], ["exa-company-news"])).toBe(false);
  });

  it("never clears an invalidated thesis when it was not rechecked", async () => {
    const test = await fixture();
    await commitThesisUpdates(test.db.ctx, test.edition, [newUpdate], evidence, now);
    const invalidated = await test.create("invalidated");
    await commitThesisUpdates(test.db.ctx, invalidated, [{ ...newUpdate, baseRevision: 1,
      assessment: "invalidated", changeSummary: "Fresh company results contradict the thesis." }], evidence, now);
    const next = await test.create("unavailable");
    await commitThesisUpdates(test.db.ctx, next, [{ ...newUpdate, baseRevision: 2,
      assessment: "not_rechecked", sourceIds: [] }], [], now);
    expect(test.current().status).toBe("invalidated");
  });

  it("uses legacy manual theses as a fallback but never overwrites the manual preference", async () => {
    const test = await fixture();
    test.edition.configurationSnapshot.durableTheses = [{
      thesisId: "manual-aapl", symbol: "AAPL", text: "Owner's thesis", priority: 1,
      keyLevels: [], invalidation: "Owner condition", expiresAt: null, status: "active",
    }];
    const review = { ...newUpdate, assessment: "strengthened" as const };
    expect(thesisUpdatesMatchContext([review], test.edition, evidence, ["exa-company-news"])).toBe(true);
    expect(thesisUpdatesMatchContext([newUpdate], test.edition, evidence, ["exa-company-news"])).toBe(false);
    await commitThesisUpdates(test.db.ctx, test.edition, [review], evidence, now);
    expect(test.current().revision).toBe(1);
    expect(test.edition.configurationSnapshot.durableTheses[0]?.text).toBe("Owner's thesis");
  });

  it("loads only the exact owner and server and its current frozen watchlist", async () => {
    const test = await fixture();
    await commitThesisUpdates(test.db.ctx, test.edition, [newUpdate], evidence, now);
    const preferences = test.edition.configurationSnapshot;
    expect(await loadThesisMemory(test.db.ctx, { ...preferences, ownerId: "owner_2" })).toEqual([]);
    expect(await loadThesisMemory(test.db.ctx, { ...preferences, guildId: "guild_2" })).toEqual([]);
    expect(await loadThesisMemory(test.db.ctx, { ...preferences, primarySymbols: ["MSFT"], discoverySymbols: [] })).toEqual([]);
    // SAFETY: Convex's registered query exposes its callback; the fixture implements all used APIs.
    const query = getThesisMemory as typeof getThesisMemory & {
      _handler: (ctx: typeof test.db.ctx, args: { guildId: string }) => Promise<Array<ThesisSnapshot & { history: ThesisSnapshot[] }>>;
    };
    expect(await query._handler(test.db.ctx, { guildId: "guild_1" }))
      .toEqual([{ ...thesisSnapshot(test.current()), history: [] }]);
    const otherActor = { ...test.db.ctx, auth: { ...test.db.ctx.auth,
      getUserIdentity: async () => ({ subject: "owner_2", issuer: "test", tokenIdentifier: "other" }) } };
    expect(await query._handler(otherActor, { guildId: "guild_1" })).toEqual([]);
    await expect(query._handler({ ...test.db.ctx, auth: { ...test.db.ctx.auth,
      getUserIdentity: async () => null } }, { guildId: "guild_1" })).rejects.toThrow("Authentication required");
  });

  it("does not write memory when a real claimed run fails", async () => {
    const test = await fixture();
    const claim = await invokeMutation(claimResearch, test.db.ctx, { editionId: test.edition.editionId, workerId: "worker" });
    await invokeMutation(failRun, test.db.ctx, { editionId: claim.editionId, generation: claim.generation,
      claimToken: claim.claimToken, code: "composition_schema_invalid", retryable: false });
    expect(test.db.rows("marketResearchTheses")).toEqual([]);
  });

  it("bounds note size, list sizes, revisions and duplicate updates", () => {
    expect(thesisUpdatesSchema.safeParse([newUpdate]).success).toBe(true);
    expect(thesisUpdatesSchema.safeParse([newUpdate, newUpdate]).success).toBe(false);
    expect(thesisUpdatesSchema.safeParse([{ ...newUpdate, text: "x".repeat(2_001) }]).success).toBe(false);
    expect(thesisUpdatesSchema.safeParse([{ ...newUpdate, catalysts: Array.from({ length: 9 }, () => "x") }]).success).toBe(false);
    expect(thesisUpdatesSchema.safeParse([{ ...newUpdate, baseRevision: -1 }]).success).toBe(false);
  });
});
