import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkDueEditions, manualTrigger, saveControlSettings, savePreferences, setEnabled } from "../convex/market_research.js";
import { scheduledEditionKey } from "../convex/lib/market_research.js";
import { convexMutationFixture, invokeMutation } from "./helpers/convex-fixture.js";

const settings = {
  guildId: "guild_1", forumChannelId: "forum_1", forumTagIds: [],
  timezone: "America/New_York", timezoneConfirmed: true, localHour: 8, localMinute: 0,
  includeWeekends: true, editionDepth: "full", maximumRankedSetups: 10,
  includeCharts: true, maximumCharts: 3, enabled: false,
};
const publish = { guildId: "guild_1", dryRun: false, publish: true, regeneratePublishedEdition: false };
const now = Date.parse("2026-09-07T18:00:00Z");

function fixture() {
  const db = convexMutationFixture();
  db.rows("discordChannels").push({
    _id: "channel-1", ownerId: "owner_1", guildId: "guild_1", channelId: "forum_1",
    available: true, type: "forum", canView: true, canCreateForumPost: true,
    canSendInThreads: true, canReadThreadHistory: true, canAttachFiles: true, requiresTag: false,
  });
  return db;
}

function addCalendar(db: ReturnType<typeof fixture>) {
  const sessions: Array<{ date: string; status: "OPEN" | "CLOSED"; regularOpen?: string; regularClose?: string }> = [];
  for (let date = Date.parse("2026-09-04T00:00:00Z"); date <= Date.parse("2027-12-31T00:00:00Z"); date += 86_400_000) {
    const day = new Date(date).toISOString().slice(0, 10);
    sessions.push(day === "2026-09-04"
      ? { date: day, status: "OPEN", regularOpen: "09:30", regularClose: "16:00" }
      : { date: day, status: "CLOSED" });
  }
  db.rows("marketSessionCalendars").push({
    _id: "calendar-1", ownerId: "owner_1", calendarId: "nyse", version: "test-calendar",
    sourceUrl: "https://www.nyse.com/trade/hours-calendars", retrievedAt: now,
    effectiveStart: "2026-09-04", effectiveEnd: "2027-12-31", contentHash: "a".repeat(64),
    reviewed: true, sessions,
  });
}

beforeEach(() => {
  vi.stubEnv("WORKOS_ALLOWED_USER_IDS", "owner_1");
  vi.stubEnv("MARKET_RESEARCH_OWNER_ID", "owner_1");
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("fixed full-edition newspaper controls", () => {
  it("uses the existing watchlist, ten-setup cap, and built-in provider without approving external spending", async () => {
    const db = fixture();
    const saved = await invokeMutation(saveControlSettings, db.ctx, settings);
    expect(saved).toMatchObject({
      editionDepth: "full", maximumRankedSetups: 10, marketDataProviderId: "exa_financial_datasets",
      includeCharts: true, maximumCharts: 3, chartsAcceptancePassed: false, enabled: false,
      primarySymbols: ["AAPL", "MSFT", "XOM", "COP", "NVDA", "AMD", "MU", "SPY", "QQQ"],
    });
    expect(saved).not.toHaveProperty("exaMaxCostUsd");
    expect(db.rows("marketDataProviderEvaluations")).toHaveLength(0);
    expect(db.scheduled).toHaveLength(0);
  });

  it("normalizes legacy concise saves to full while rejecting fractional or excessive ranked limits", async () => {
    const db = fixture();
    const saved = await invokeMutation(saveControlSettings, db.ctx, { ...settings, editionDepth: "concise" });
    expect(saved.editionDepth).toBe("full");
    for (const maximumRankedSetups of [0, 1.5, 11]) {
      await expect(invokeMutation(saveControlSettings, db.ctx, { ...settings, maximumRankedSetups }))
        .rejects.toThrow("Market-research budgets are invalid.");
    }
    const { configurationSnapshotHash: _, ...preferences } = saved;
    expect(await invokeMutation(savePreferences, db.ctx, { preferences: { ...preferences, editionDepth: "concise" } }))
      .toMatchObject({ editionDepth: "full" });
  });

  it("fills a legacy null provider but preserves an existing server-owned provider and cost configuration", async () => {
    const db = fixture();
    await invokeMutation(saveControlSettings, db.ctx, settings);
    const record = db.rows("marketResearchPreferences")[0]!;
    record.marketDataProviderId = null;
    expect(await invokeMutation(saveControlSettings, db.ctx, settings))
      .toMatchObject({ marketDataProviderId: "exa_financial_datasets" });
    record.marketDataProviderId = "configured_provider";
    record.exaMaxCostUsd = 0.25;
    expect(await invokeMutation(saveControlSettings, db.ctx, settings))
      .toMatchObject({ marketDataProviderId: "configured_provider", exaMaxCostUsd: 0.25 });
  });

  it("keeps identical saves and schedules idempotent, and leaves changed saved settings unscheduled", async () => {
    const db = fixture();
    addCalendar(db);
    const initial = await invokeMutation(saveControlSettings, db.ctx, settings);
    vi.setSystemTime(now + 1_000);
    expect(await invokeMutation(saveControlSettings, db.ctx, settings)).toEqual(initial);
    const scheduled = await invokeMutation(saveControlSettings, db.ctx, { ...settings, enabled: true });
    expect(scheduled).toMatchObject({ enabled: true, revision: 1 });
    vi.setSystemTime(now + 2_000);
    expect(await invokeMutation(saveControlSettings, db.ctx, { ...settings, enabled: true })).toEqual(scheduled);
    const changed = await invokeMutation(saveControlSettings, db.ctx, { ...settings, localHour: 9 });
    expect(changed).toMatchObject({ enabled: false, localHour: 9, revision: 2 });
    expect(await invokeMutation(saveControlSettings, db.ctx, { ...settings, localHour: 9, enabled: true }))
      .toMatchObject({ enabled: true, localHour: 9, revision: 3 });
  });

  it("keeps owner, timezone, forum and publication-permission checks when scheduling", async () => {
    const db = fixture();
    await expect(invokeMutation(saveControlSettings, db.ctx, { ...settings, enabled: true, forumChannelId: null }))
      .rejects.toThrow("forum_not_configured");
    await expect(invokeMutation(saveControlSettings, db.ctx, { ...settings, enabled: true, timezoneConfirmed: false }))
      .rejects.toThrow("schedule_timezone_unconfirmed");
    db.rows("discordChannels")[0]!.canSendInThreads = false;
    await expect(invokeMutation(saveControlSettings, db.ctx, { ...settings, enabled: true }))
      .rejects.toThrow("forum_permissions_incomplete");
    db.rows("discordChannels")[0]!.canSendInThreads = true;
    vi.stubEnv("MARKET_RESEARCH_OWNER_ID", "other_owner");
    await expect(invokeMutation(saveControlSettings, db.ctx, { ...settings, enabled: true }))
      .rejects.toThrow("market_research_disabled");
  });

  it("keeps charts optional when the forum can publish text but cannot attach images", async () => {
    const db = fixture();
    addCalendar(db);
    db.rows("discordChannels")[0]!.canAttachFiles = false;
    expect(await invokeMutation(saveControlSettings, db.ctx, { ...settings, enabled: true }))
      .toMatchObject({ enabled: true, includeCharts: true });
    expect(await invokeMutation(manualTrigger, db.ctx, { ...publish, requestId: "text-fallback" }))
      .toMatchObject({ kind: "edition", duplicate: false });
  });

  it.each([
    [{ timezone: "not-a-timezone" }, "schedule_timezone_invalid"],
    [{ timezoneConfirmed: false }, "schedule_timezone_unconfirmed"],
    [{ localHour: 24 }, "schedule_time_invalid"],
    [{ localMinute: -1 }, "schedule_time_invalid"],
    [{ forumChannelId: null }, "forum_not_configured"],
  ] as const)("returns a safe structured scheduling error for %s", async (changed, code) => {
    const db = fixture();
    await expect(invokeMutation(saveControlSettings, db.ctx, { ...settings, enabled: true, ...changed }))
      .rejects.toMatchObject({ data: { code } });
    expect(db.rows("marketResearchPreferences")).toHaveLength(0);
  });

  it("returns safe forum and owner codes instead of redacted plain errors", async () => {
    const db = fixture();
    await invokeMutation(saveControlSettings, db.ctx, settings);
    db.rows("discordChannels")[0]!.type = "text";
    await expect(invokeMutation(setEnabled, db.ctx, { guildId: "guild_1", enabled: true }))
      .rejects.toMatchObject({ data: { code: "forum_wrong_channel_type" } });
    db.rows("discordChannels")[0]!.type = "forum";
    db.rows("discordChannels")[0]!.canSendInThreads = false;
    await expect(invokeMutation(manualTrigger, db.ctx, publish))
      .rejects.toMatchObject({ data: { code: "forum_permissions_incomplete" } });
    vi.stubEnv("MARKET_RESEARCH_OWNER_ID", "other_owner");
    await expect(invokeMutation(setEnabled, db.ctx, { guildId: "guild_1", enabled: true }))
      .rejects.toMatchObject({ data: { code: "market_research_disabled" } });
  });
});

describe("scheduling with optional market-session calendar context", () => {
  function calendarState(db: ReturnType<typeof fixture>, state: "missing" | "stale" | "partial" | "fresh") {
    if (state === "missing") return;
    addCalendar(db);
    const calendar = db.rows("marketSessionCalendars")[0]!;
    if (state === "stale") calendar.retrievedAt = now - 46 * 86_400_000;
    if (state === "partial") calendar.effectiveEnd = "2026-09-07";
  }

  it.each(["missing", "stale", "partial", "fresh"] as const)("all enablement entry points accept a %s calendar", async (state) => {
    const db = fixture();
    calendarState(db, state);
    const saved = await invokeMutation(saveControlSettings, db.ctx, { ...settings, enabled: true });
    expect(saved.enabled).toBe(true);
    const { configurationSnapshotHash: _, ...preferences } = saved;
    expect(await invokeMutation(savePreferences, db.ctx, { preferences: { ...preferences, enabled: true } }))
      .toMatchObject({ enabled: true });
    await invokeMutation(setEnabled, db.ctx, { guildId: "guild_1", enabled: false });
    expect(await invokeMutation(setEnabled, db.ctx, { guildId: "guild_1", enabled: true }))
      .toMatchObject({ enabled: true });
    expect(db.rows("marketResearchPreferences")[0]?.enabled).toBe(true);
    expect(db.scheduled).toHaveLength(0);
  });

  it("enables legacy null-provider preferences without adding or approving a numerical provider", async () => {
    const db = fixture();
    const saved = await invokeMutation(saveControlSettings, db.ctx, settings);
    const { configurationSnapshotHash: _, ...preferences } = saved;
    expect(await invokeMutation(savePreferences, db.ctx, {
      preferences: { ...preferences, marketDataProviderId: null, enabled: true },
    })).toMatchObject({ enabled: true, marketDataProviderId: null });
    await invokeMutation(setEnabled, db.ctx, { guildId: "guild_1", enabled: false });
    expect(await invokeMutation(setEnabled, db.ctx, { guildId: "guild_1", enabled: true }))
      .toMatchObject({ enabled: true });
    expect(db.rows("marketResearchPreferences")[0]?.marketDataProviderId).toBeNull();
    expect(db.rows("marketDataProviderEvaluations")).toHaveLength(0);
    vi.setSystemTime(Date.parse("2026-09-08T12:00:00Z"));
    expect(await invokeMutation(checkDueEditions, db.ctx, {})).toMatchObject({ created: 1 });
    expect(db.rows("marketResearchEditions")[0]?.configurationSnapshot)
      .toMatchObject({ enabled: true, marketDataProviderId: null });
  });

  it.each(["missing", "stale", "partial"] as const)("queues one due edition with unknown session context for a %s calendar", async (state) => {
    const db = fixture();
    calendarState(db, state);
    vi.setSystemTime(Date.parse("2026-09-08T12:00:00Z"));
    await invokeMutation(saveControlSettings, db.ctx, { ...settings, enabled: true });
    expect(await invokeMutation(checkDueEditions, db.ctx, {}))
      .toMatchObject({ scanned: 1, created: 1, skipped: 0, existing: 0, hasMore: false });
    expect(db.rows("marketResearchEditions")).toHaveLength(1);
    expect(db.rows("marketResearchEditions")[0]).toMatchObject({
      trigger: "scheduled", status: "queued", sessionType: "UNKNOWN", editionDate: "2026-09-08",
      previousSessionDate: null, previousSessionClose: null, nextSessionDate: null,
    });
    expect(db.rows("marketResearchEvidence")).toHaveLength(1);
    expect(db.rows("marketResearchEvidence")[0]).toMatchObject({
      kind: "calendar", sourcePolicy: "unavailable", contentStatus: "failed", sessionLabel: "unknown",
    });
    expect(db.scheduled).toHaveLength(1);
    expect(await invokeMutation(checkDueEditions, db.ctx, {}))
      .toMatchObject({ scanned: 1, created: 0, skipped: 0, existing: 1, hasMore: false });
    expect(db.rows("marketResearchEditions")).toHaveLength(1);
    expect(db.scheduled).toHaveLength(1);
  });

  it("still uses reviewed fresh calendar evidence when it is available", async () => {
    const db = fixture();
    calendarState(db, "fresh");
    vi.setSystemTime(Date.parse("2026-09-08T12:00:00Z"));
    await invokeMutation(saveControlSettings, db.ctx, { ...settings, enabled: true });
    expect(await invokeMutation(checkDueEditions, db.ctx, {})).toMatchObject({ created: 1 });
    expect(db.rows("marketResearchEditions")[0]).toMatchObject({ sessionType: "CLOSED", calendarVersion: "test-calendar" });
    expect(db.rows("marketResearchEvidence")[0]).toMatchObject({ sourcePolicy: "approved", contentStatus: "available" });
  });
});

describe("Test now forum publication", () => {
  it("runs immediately while unscheduled and gives each test its own slot without consuming the daily edition", async () => {
    const db = fixture();
    await invokeMutation(saveControlSettings, db.ctx, settings);
    const first = await invokeMutation(manualTrigger, db.ctx, { ...publish, requestId: "test-1" });
    const second = await invokeMutation(manualTrigger, db.ctx, { ...publish, requestId: "test-2" });
    expect(first).toMatchObject({ kind: "edition", duplicate: false });
    expect(second).toMatchObject({ kind: "edition", duplicate: false });
    expect(first.editionId).not.toBe(second.editionId);
    expect(db.rows("marketResearchPreviews")).toHaveLength(0);
    expect(db.rows("marketResearchEditions")).toHaveLength(2);
    const dailyKey = scheduledEditionKey({ ownerId: "owner_1", guildId: "guild_1", scheduleId: "morning-market-guild_1" }, "2026-09-07");
    for (const edition of db.rows("marketResearchEditions")) {
      expect(edition).toMatchObject({ trigger: "manual_publish", status: "queued", forumChannelId: "forum_1", scheduledFor: now });
      expect(edition.scheduledKey).not.toBe(dailyKey);
      expect(edition.configurationSnapshot).toMatchObject({ editionDepth: "full", maximumRankedSetups: 10, enabled: false });
    }
    expect(db.scheduled).toHaveLength(2);
    expect(await invokeMutation(manualTrigger, db.ctx, publish)).toMatchObject({ duplicate: false });
    expect(db.rows("marketResearchEditions")[2]?.scheduledKey).toBe(dailyKey);
  });

  it("deduplicates the same test request even after midnight or publication", async () => {
    const db = fixture();
    await invokeMutation(saveControlSettings, db.ctx, settings);
    const args = { ...publish, requestId: "same-test" };
    const first = await invokeMutation(manualTrigger, db.ctx, args);
    db.rows("marketResearchEditions")[0]!.status = "published";
    vi.setSystemTime(now + 86_400_000);
    expect(await invokeMutation(manualTrigger, db.ctx, args))
      .toEqual({ kind: "edition", editionId: first.editionId, duplicate: true });
    expect(db.rows("marketResearchEditions")).toHaveLength(1);
    expect(db.scheduled).toHaveLength(1);
  });

  it("rejects a missing forum or invalid test intent before queueing work", async () => {
    const db = fixture();
    await invokeMutation(saveControlSettings, db.ctx, { ...settings, forumChannelId: null });
    await expect(invokeMutation(manualTrigger, db.ctx, { ...publish, requestId: "test" }))
      .rejects.toThrow("forum_not_configured");
    for (const changed of [{ dryRun: true, publish: false }, { regeneratePublishedEdition: true }]) {
      await expect(invokeMutation(manualTrigger, db.ctx, { ...publish, ...changed, requestId: "test" }))
        .rejects.toThrow("A test request must publish a new edition.");
    }
    expect(db.scheduled).toHaveLength(0);
    expect(db.rows("marketResearchEditions")).toHaveLength(0);
  });
});
