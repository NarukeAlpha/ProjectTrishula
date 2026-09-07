import { describe, expect, it } from "vitest";
import { marketResearchEvidencePacketRecordSchema } from "../convex/market_research.js";
import {
  acceptedResearchEvidenceCount,
  calendarSnapshotMeetsRequirements,
  canRecoverResearch,
  classifyResearchDispatchFailure,
  dueScheduleDecision,
  firstMissingDeliverySequence,
  hasCompleteCalendarDateCoverage,
  hasConfirmedPriorSession,
  isNonGlobalIpHostname,
  isNonPublicHostname,
  isMarketResearchForumIngress,
  manualEditionDisposition,
  marketResearchDeploymentOwnerMatches,
  marketEditionLabel,
  marketSessionCloseInstant,
  mayDeleteRetainedEvidence,
  nextRetryAt,
  resolveCalendarWindow,
  resolveMarketSession,
  scheduleDayEnabled,
  schedulerContinuation,
  scheduledEditionKey,
  shouldSkipUnstartedEdition,
  serializedUtf8Bytes,
} from "../convex/lib/market_research.js";

const baseSchedule = {
  ownerId: "owner_1",
  guildId: "guild_1",
  scheduleId: "morning_1",
  timezone: "America/New_York",
  localHour: 8,
  localMinute: 0,
  lateEditionCutoffLocalTime: "12:00",
};

function closedSessionsForEveryDate(start: string, end: string) {
  const sessions: Array<{ date: string; status: "CLOSED" }> = [];
  for (
    let cursor = Date.parse(`${start}T00:00:00Z`);
    cursor <= Date.parse(`${end}T00:00:00Z`);
    cursor += 24 * 60 * 60 * 1_000
  ) {
    sessions.push({
      date: new Date(cursor).toISOString().slice(0, 10),
      status: "CLOSED",
    });
  }
  return sessions;
}

describe("market-research local scheduler", () => {
  it("resolves 08:00 in standard and daylight time", () => {
    const standard = dueScheduleDecision(baseSchedule, Date.parse("2026-01-05T13:00:00Z"));
    const daylight = dueScheduleDecision(baseSchedule, Date.parse("2026-06-05T12:00:00Z"));

    expect(new Date(standard.scheduledFor).toISOString()).toBe("2026-01-05T13:00:00.000Z");
    expect(new Date(daylight.scheduledFor).toISOString()).toBe("2026-06-05T12:00:00.000Z");
    expect(standard.kind).toBe("due");
    expect(daylight.kind).toBe("due");
  });

  it("creates one stable local-date key across both DST transition dates", () => {
    const spring = dueScheduleDecision(baseSchedule, Date.parse("2026-03-08T12:00:00Z"));
    const fall = dueScheduleDecision(baseSchedule, Date.parse("2026-11-01T13:00:00Z"));

    expect(spring.editionDate).toBe("2026-03-08");
    expect(fall.editionDate).toBe("2026-11-01");
    expect(spring.scheduledKey).toBe(scheduledEditionKey(baseSchedule, "2026-03-08"));
    expect(fall.scheduledKey).toBe(scheduledEditionKey(baseSchedule, "2026-11-01"));
  });

  it("keeps Puerto Rico at 08:00 local time without a DST shift", () => {
    const puertoRico = { ...baseSchedule, timezone: "America/Puerto_Rico" };
    const january = dueScheduleDecision(puertoRico, Date.parse("2026-01-05T12:00:00Z"));
    const june = dueScheduleDecision(puertoRico, Date.parse("2026-06-05T12:00:00Z"));

    expect(new Date(january.scheduledFor).toISOString()).toBe("2026-01-05T12:00:00.000Z");
    expect(new Date(june.scheduledFor).toISOString()).toBe("2026-06-05T12:00:00.000Z");
  });

  it("converts the previous confirmed market close through the configured timezone", () => {
    expect(new Date(marketSessionCloseInstant("2026-01-02", "16:00", "America/New_York")).toISOString()).toBe("2026-01-02T21:00:00.000Z");
    expect(new Date(marketSessionCloseInstant("2026-09-04", "16:00", "America/New_York")).toISOString()).toBe("2026-09-04T20:00:00.000Z");
    expect(new Date(marketSessionCloseInstant("2026-11-27", "13:00", "America/New_York")).toISOString()).toBe("2026-11-27T18:00:00.000Z");
  });

  it("distinguishes before, catch-up, and skipped-late checks", () => {
    expect(dueScheduleDecision(baseSchedule, Date.parse("2026-06-05T11:59:59Z")).kind).toBe("before");
    expect(dueScheduleDecision(baseSchedule, Date.parse("2026-06-05T13:30:00Z")).kind).toBe("due");
    expect(dueScheduleDecision(baseSchedule, Date.parse("2026-06-05T16:00:00Z")).kind).toBe("skipped_late");
  });

  it("does not let mutable forum or prompt settings alter the scheduled key", () => {
    const key = scheduledEditionKey(baseSchedule, "2026-06-05");
    const changedSettings = {
      ...baseSchedule,
      forumChannelId: "forum_changed",
      promptVersion: "prompt_changed",
    };
    expect(key).toBe(scheduledEditionKey(changedSettings, "2026-06-05"));
  });

  it("skips weekends only when the frozen preference disables them", () => {
    expect(scheduleDayEnabled(false, "Sat")).toBe(false);
    expect(scheduleDayEnabled(false, "Sun")).toBe(false);
    expect(scheduleDayEnabled(false, "Mon")).toBe(true);
    expect(scheduleDayEnabled(true, "Sat")).toBe(true);
  });

  it("fails closed unless the runnable deployment owner matches exactly", () => {
    expect(marketResearchDeploymentOwnerMatches("owner_1", "owner_1")).toBe(true);
    expect(marketResearchDeploymentOwnerMatches("owner_1", undefined)).toBe(false);
    expect(marketResearchDeploymentOwnerMatches("owner_1", "owner_2")).toBe(false);
    expect(marketResearchDeploymentOwnerMatches("owner_1", "invalid owner")).toBe(false);
  });

  it("continues a large preference backlog without starving later pages", () => {
    expect(schedulerContinuation(true, 0)).toBeUndefined();
    expect(schedulerContinuation(false, 0)).toEqual({ delayMs: 0, continuation: 1 });
    expect(schedulerContinuation(false, 25)).toEqual({ delayMs: 60_000, continuation: 0 });
  });

  it("applies the cutoff only to unstarted scheduled editions", () => {
    const cutoffAt = Date.parse("2026-08-31T16:00:00Z");
    const afterCutoff = cutoffAt + 1;
    expect(shouldSkipUnstartedEdition({ trigger: "scheduled", cutoffAt }, afterCutoff)).toBe(true);
    expect(shouldSkipUnstartedEdition({ trigger: "manual_publish", cutoffAt }, afterCutoff)).toBe(false);
    expect(shouldSkipUnstartedEdition({ trigger: "regeneration", cutoffAt }, afterCutoff)).toBe(false);
    expect(shouldSkipUnstartedEdition({ trigger: "scheduled", startedAt: cutoffAt - 1, cutoffAt }, afterCutoff)).toBe(false);
  });

  it("retries transient dispatch failures and stops on auth, contract, lease, or configuration failures", () => {
    expect(classifyResearchDispatchFailure({ status: 503 })).toEqual({ code: "composition_timeout", retryable: true });
    expect(classifyResearchDispatchFailure({ status: 503, errorCode: "market_research_disabled" })).toEqual({
      code: "market_research_disabled",
      retryable: false,
    });
    expect(classifyResearchDispatchFailure({ status: 503, errorCode: "composition_provider_not_ready" })).toEqual({
      code: "composition_provider_not_ready",
      retryable: false,
    });
    expect(classifyResearchDispatchFailure({ status: 503, errorCode: "exa_connect_zdr_incompatible" })).toEqual({
      code: "exa_connect_zdr_incompatible",
      retryable: false,
    });
    expect(classifyResearchDispatchFailure({ status: 503, errorCode: "market_session_calendar_stale" })).toEqual({
      code: "market_session_calendar_stale",
      retryable: false,
    });
    expect(classifyResearchDispatchFailure({ status: 429 })).toEqual({ code: "composition_timeout", retryable: true });
    expect(classifyResearchDispatchFailure({ status: 401 })).toEqual({ code: "composition_auth_required", retryable: false });
    expect(classifyResearchDispatchFailure({ status: 400 })).toEqual({ code: "composition_schema_invalid", retryable: false });
    expect(classifyResearchDispatchFailure({ status: 409 })).toEqual({ code: "edition_lease_lost", retryable: false });
    expect(classifyResearchDispatchFailure({ errorMessage: "SERVICE_SHARED_SECRET is not configured." })).toEqual({
      code: "composition_provider_not_ready",
      retryable: false,
    });
  });

  it("keeps manual runs idempotent and creates explicit revisions for skipped-late or regenerated editions", () => {
    const published = { editionId: "edition-1", editionRevision: 0, status: "published" };
    expect(manualEditionDisposition(published, false)).toEqual({ kind: "duplicate", editionId: "edition-1" });
    expect(manualEditionDisposition({ ...published, status: "skipped_late" }, false)).toEqual({
      kind: "create",
      revision: 1,
      trigger: "manual_publish",
      parentEditionId: "edition-1",
    });
    expect(manualEditionDisposition(published, true)).toEqual({
      kind: "create",
      revision: 1,
      trigger: "regeneration",
      parentEditionId: "edition-1",
    });
    expect(() => manualEditionDisposition({ ...published, status: "failed" }, true)).toThrow("edition_already_exists");
  });

  it("excludes the configured newspaper forum and every child thread from conversational ingress", () => {
    expect(isMarketResearchForumIngress("forum-1", "forum-1", null)).toBe(true);
    expect(isMarketResearchForumIngress("forum-1", "thread-1", "forum-1")).toBe(true);
    expect(isMarketResearchForumIngress("forum-1", "conversation-1", null)).toBe(false);
    expect(isMarketResearchForumIngress(null, "conversation-1", null)).toBe(false);
  });
});

describe("market session calendar", () => {
  const calendar = {
    calendarId: "nyse",
    version: "2026-v1",
    sourceUrl: "https://www.nyse.com/markets/hours-calendars",
    retrievedAt: Date.parse("2025-12-01T00:00:00Z"),
    effectiveStart: "2025-12-31",
    effectiveEnd: "2027-01-04",
    reviewed: true,
    sessions: [
      { date: "2025-12-31", status: "OPEN" as const, regularOpen: "09:30", regularClose: "16:00" },
      { date: "2026-01-01", status: "CLOSED" as const },
      { date: "2026-01-02", status: "OPEN" as const, regularOpen: "09:30", regularClose: "16:00" },
      { date: "2026-07-03", status: "CLOSED" as const },
      { date: "2026-11-27", status: "EARLY_CLOSE" as const, regularOpen: "09:30", regularClose: "13:00", earlyClose: "13:00" },
      { date: "2027-01-04", status: "OPEN" as const, regularOpen: "09:30", regularClose: "16:00" },
    ],
  };

  it("uses reviewed observed-holiday, early-close, and year-boundary records", () => {
    expect(resolveMarketSession(calendar, "2026-07-03", 100).status).toBe("CLOSED");
    expect(resolveMarketSession(calendar, "2026-11-27", 100)).toMatchObject({
      status: "EARLY_CLOSE",
      earlyClose: "13:00",
    });
    expect(resolveMarketSession(calendar, "2027-01-04", 100).status).toBe("OPEN");
  });

  it("labels regular, weekend, holiday, late, and unknown editions deterministically", () => {
    const scheduledFor = Date.parse("2026-09-01T12:00:00Z");
    expect(marketEditionLabel("OPEN", false, scheduledFor, scheduledFor)).toBe("Morning Market Newspaper");
    expect(marketEditionLabel("OPEN", true, scheduledFor, scheduledFor)).toBe("Weekend Outlook");
    expect(marketEditionLabel("CLOSED", false, scheduledFor, scheduledFor)).toBe("Market Holiday Outlook");
    expect(marketEditionLabel("OPEN", false, scheduledFor, scheduledFor + 60 * 60 * 1_000 + 1)).toBe("Late Edition");
    expect(marketEditionLabel("UNKNOWN", false, scheduledFor, scheduledFor)).toBe("Data unavailable");
  });

  it("applies an effective ad-hoc closure before the reviewed calendar", () => {
    expect(resolveMarketSession(calendar, "2026-01-02", 200, [{
      date: "2026-01-02",
      status: "CLOSED",
      effectiveStart: 100,
      effectiveEnd: 300,
    }]).status).toBe("CLOSED");
  });

  it("uses effective prior closure and early-close overrides for the confirmed previous close", () => {
    const weeklyCalendar = {
      ...calendar,
      effectiveStart: "2026-09-04",
      effectiveEnd: "2026-09-09",
      sessions: [
        { date: "2026-09-04", status: "OPEN" as const, regularOpen: "09:30", regularClose: "16:00" },
        { date: "2026-09-07", status: "OPEN" as const, regularOpen: "09:30", regularClose: "16:00" },
        { date: "2026-09-08", status: "OPEN" as const, regularOpen: "09:30", regularClose: "16:00" },
        { date: "2026-09-09", status: "OPEN" as const, regularOpen: "09:30", regularClose: "16:00" },
      ],
    };
    const closedMonday = resolveCalendarWindow(weeklyCalendar, "2026-09-08", 200, "America/New_York", [{
      date: "2026-09-07",
      status: "CLOSED",
      effectiveStart: 100,
      effectiveEnd: 300,
    }]);
    expect(closedMonday.previousSession?.date).toBe("2026-09-04");
    expect(new Date(closedMonday.previousSessionClose ?? 0).toISOString()).toBe("2026-09-04T20:00:00.000Z");

    const earlyMonday = resolveCalendarWindow(weeklyCalendar, "2026-09-08", 200, "America/New_York", [{
      date: "2026-09-07",
      status: "EARLY_CLOSE",
      regularOpen: "09:30",
      regularClose: "16:00",
      earlyClose: "13:00",
      effectiveStart: 100,
      effectiveEnd: 300,
    }]);
    expect(earlyMonday.previousSession?.date).toBe("2026-09-07");
    expect(new Date(earlyMonday.previousSessionClose ?? 0).toISOString()).toBe("2026-09-07T17:00:00.000Z");
  });

  it("rejects enablement coverage that starts on the current date with no confirmed prior close", () => {
    const truncated = {
      ...calendar,
      effectiveStart: "2026-09-08",
      effectiveEnd: "2026-09-09",
      sessions: [
        { date: "2026-09-08", status: "OPEN" as const, regularOpen: "09:30", regularClose: "16:00" },
        { date: "2026-09-09", status: "OPEN" as const, regularOpen: "09:30", regularClose: "16:00" },
      ],
    };
    const window = resolveCalendarWindow(truncated, "2026-09-08", 200, "America/New_York");
    expect(hasConfirmedPriorSession(window)).toBe(false);
  });

  it("fails closed outside the reviewed range or with an unreviewed calendar", () => {
    expect(() => resolveMarketSession(calendar, "2027-01-05", 100)).toThrow("session_unknown");
    expect(() => resolveMarketSession({ ...calendar, reviewed: false }, "2026-01-02", 100)).toThrow("session_unknown");
  });

  it("requires a fresh reviewed calendar from an official host with the full effective range", () => {
    const requirements = {
      now: Date.parse("2026-01-01T00:00:00Z"),
      maximumAgeMs: 45 * 24 * 60 * 60 * 1_000,
      effectiveStart: "2026-01-01",
      effectiveEnd: "2027-12-31",
      officialHosts: new Set(["www.nyse.com"]),
    };
    const complete = {
      ...calendar,
      retrievedAt: Date.parse("2025-12-01T00:00:00Z"),
      effectiveEnd: "2027-12-31",
      sessions: closedSessionsForEveryDate("2025-12-31", "2027-12-31"),
    };
    expect(calendarSnapshotMeetsRequirements(complete, requirements)).toBe(true);
    expect(calendarSnapshotMeetsRequirements({ ...complete, retrievedAt: Date.parse("2025-10-01T00:00:00Z") }, requirements)).toBe(false);
    expect(calendarSnapshotMeetsRequirements({ ...complete, effectiveEnd: "2027-01-01" }, requirements)).toBe(false);
    expect(calendarSnapshotMeetsRequirements({ ...complete, sourceUrl: "https://calendar.example.com" }, requirements)).toBe(false);
    expect(calendarSnapshotMeetsRequirements({
      ...complete,
      sessions: complete.sessions.filter((session) => session.date !== "2026-08-12"),
    }, requirements)).toBe(false);
    expect(hasCompleteCalendarDateCoverage(complete.sessions, complete.effectiveStart, complete.effectiveEnd)).toBe(true);
  });
});

describe("market-research recovery and record bounds", () => {
  it("rejects terminal and ambiguous records from automatic recovery", () => {
    expect(canRecoverResearch({ status: "failed", leaseExpiresAt: 1 }, 2)).toBe(false);
    expect(canRecoverResearch({
      status: "retry_wait",
      nextAttemptAt: 1,
      lastErrorCode: "discord_thread_reconcile_ambiguous",
    }, 2)).toBe(false);
    expect(canRecoverResearch({ status: "retry_wait", nextAttemptAt: 1 }, 2)).toBe(true);
  });

  it("stops retry scheduling after the bounded attempt sequence", () => {
    expect(nextRetryAt(1, 1_000)).toBe(31_000);
    expect(nextRetryAt(5, 1_000)).toBeUndefined();
  });

  it("adds stable bounded jitter without changing the retry ceiling", () => {
    const retry = nextRetryAt(1, 1_000, "edition-1");
    expect(retry).toBe(nextRetryAt(1, 1_000, "edition-1"));
    expect(retry).toBeGreaterThanOrEqual(1_000 + 30_000 * 0.75);
    expect(retry).toBeLessThanOrEqual(1_000 + 30_000 * 1.25);
    expect(nextRetryAt(5, 1_000, "edition-1")).toBeUndefined();
  });

  it("measures serialized UTF-8 bytes instead of JavaScript code units", () => {
    expect(serializedUtf8Bytes({ value: "😀" })).toBeGreaterThan(JSON.stringify({ value: "😀" }).length);
  });

  it("counts only unique approved usable source evidence as accepted", () => {
    const base = { kind: "news", freshness: "fresh", contentStatus: "available" };
    expect(acceptedResearchEvidenceCount([
      { ...base, evidenceId: "approved", sourcePolicy: "approved" },
      { ...base, evidenceId: "approved", sourcePolicy: "approved" },
      { ...base, evidenceId: "blocked", sourcePolicy: "blocked", contentStatus: "blocked" },
      { ...base, evidenceId: "unavailable", sourcePolicy: "unavailable", contentStatus: "failed" },
      { ...base, evidenceId: "stale", sourcePolicy: "approved", freshness: "stale" },
      { ...base, evidenceId: "calculation", sourcePolicy: "approved", kind: "calculation" },
    ])).toBe(1);
  });

  it("rejects non-public IPv4, IPv4-mapped IPv6, and IPv6 multicast literals", () => {
    expect(isNonGlobalIpHostname("127.0.0.1")).toBe(true);
    expect(isNonGlobalIpHostname("100.64.0.1")).toBe(true);
    expect(isNonGlobalIpHostname("::ffff:127.0.0.1")).toBe(true);
    expect(isNonGlobalIpHostname("::ffff:7f00:1")).toBe(true);
    expect(isNonGlobalIpHostname("ff02::1")).toBe(true);
    expect(isNonGlobalIpHostname("fc00::1")).toBe(true);
    expect(isNonGlobalIpHostname("fe80::1")).toBe(true);
    expect(isNonGlobalIpHostname("2001:2::1")).toBe(true);
    expect(isNonGlobalIpHostname("2001:db8::1")).toBe(true);
    expect(isNonGlobalIpHostname("2606:4700:4700::1111")).toBe(false);
    expect(isNonGlobalIpHostname("93.184.216.34")).toBe(false);
    expect(isNonGlobalIpHostname("www.nyse.com")).toBe(false);
    expect(isNonPublicHostname("research.localhost")).toBe(true);
    expect(isNonPublicHostname("research.internal")).toBe(true);
    expect(isNonPublicHostname("www.nyse.com")).toBe(false);
  });

  it("resumes at the first missing delivery without resending acknowledged parts", () => {
    expect(firstMissingDeliverySequence([
      { sequence: 7, status: "pending" },
      { sequence: 0, status: "sent" },
      { sequence: 3, status: "sent" },
      { sequence: 4, status: "failed" },
      { sequence: 1, status: "sent" },
      { sequence: 2, status: "sent" },
      { sequence: 5, status: "pending" },
      { sequence: 6, status: "pending" },
    ])).toBe(4);
  });

  it("expires only terminal evidence and preserves final summaries and receipts", () => {
    expect(mayDeleteRetainedEvidence("published", 100, 100)).toBe(true);
    expect(mayDeleteRetainedEvidence("failed", 100, 100)).toBe(true);
    expect(mayDeleteRetainedEvidence("composing", 100, 100)).toBe(false);
    expect(mayDeleteRetainedEvidence("published", 101, 100)).toBe(false);
  });
});

describe("market-research Pi trust boundary", () => {
  const sourceStatuses = ["FinancialJuice", "Barchart", "ForexFactory", "Yahoo", "TradingView"].map((source) => ({
    source,
    status: "no_material_item",
    detail: "No permitted material item was retained",
    sourceIds: [],
  }));
  const packet = {
    schemaVersion: 1,
    editionId: "edition-1",
    generatedAt: "2026-09-01T12:00:00.000Z",
    session: {
      sessionType: "OPEN",
      editionLabel: "Morning Market Newspaper",
      editionDate: "2026-09-01",
      timezone: "America/New_York",
      configuredLocalTime: "2026-09-01T12:00:00.000Z",
      marketTime: "2026-09-01T12:00:00.000Z",
      previousSessionDate: "2026-08-31",
      previousSessionClose: "2026-08-31T20:00:00.000Z",
      nextSessionDate: "2026-09-02",
      calendarVersion: "nyse-2026-v1",
      sourceIds: [],
    },
    primarySymbols: ["AAPL"],
    sectorSymbols: [],
    discoverySymbols: [],
    sourcePolicyVersion: "source-policy-v1",
    requestedSourceStatus: sourceStatuses,
    evidence: [{
      evidenceId: "source-1",
      kind: "source_status",
      provider: "Project Trishula",
      sourcePolicy: "unavailable",
      retrievedAt: "2026-09-01T12:00:00.000Z",
      freshness: "unknown",
      contentStatus: "failed",
      highlights: [],
      normalizedClaims: ["Structured market data is unavailable."],
      contentHash: "a".repeat(64),
    }],
    missingFields: ["premarket price"],
    conflicts: [],
    allowedSourceIds: ["source-1"],
  };

  it("accepts the complete strict evidence shape and rejects unknown nested fields", () => {
    expect(marketResearchEvidencePacketRecordSchema.safeParse(packet).success).toBe(true);
    expect(marketResearchEvidencePacketRecordSchema.safeParse({
      ...packet,
      session: { ...packet.session, untrustedField: "must fail" },
    }).success).toBe(false);
  });

  it("rejects evidence references that do not exist in the durable packet", () => {
    expect(marketResearchEvidencePacketRecordSchema.safeParse({
      ...packet,
      allowedSourceIds: ["missing-source"],
    }).success).toBe(false);
  });
});
