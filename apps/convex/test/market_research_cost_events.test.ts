/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-parameters -- The bounded in-memory database stores only the explicit fixture rows needed to exercise the real mutation handler. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MutationCtx } from "../convex/_generated/server.js";
import {
  MARKET_RESEARCH_MAX_COST_EVENTS_PER_CLAIM,
  marketResearchCostEventSchema,
  persistExaCostEvent,
  registerExaCostBinding,
} from "../convex/market_research.js";
import { marketResearchPiRequestSchema } from "../convex/market_research_http.js";

type Row = Record<string, unknown> & { _id: string };

function database() {
  const tables = new Map<string, Row[]>();
  const rows = (table: string) => {
    const existing = tables.get(table);
    if (existing) return existing;
    const created: Row[] = [];
    tables.set(table, created);
    return created;
  };
  const db = {
    query(table: string) {
      const conditions: Array<[string, unknown]> = [];
      const index = {
        eq(field: string, value: unknown) { conditions.push([field, value]); return index; },
      };
      return {
        withIndex(_name: string, configure: (value: typeof index) => typeof index) {
          configure(index);
          return {
            async unique() {
              const found = rows(table).filter((row) => conditions.every(([key, value]) => row[key] === value));
              if (found.length > 1) throw new Error("fixture_duplicate_index");
              return found[0] ?? null;
            },
          };
        },
      };
    },
    async insert(table: string, row: Record<string, unknown>) {
      const _id = `${table}-${rows(table).length + 1}`;
      rows(table).push({ ...row, _id });
      return _id;
    },
    async patch(id: string, fields: Record<string, unknown>) {
      const row = [...tables.values()].flat().find((item) => item._id === id);
      if (!row) throw new Error("fixture_missing_row");
      Object.assign(row, fields);
    },
  };
  // SAFETY: The real handlers use only query/withIndex/unique, insert, and patch;
  // the fixture implements those operations and fails on duplicate or missing rows.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The fixture intentionally does not implement unrelated Convex database operations.
  return { ctx: { db: db as unknown as MutationCtx["db"] }, rows };
}

const originalClaim = { ownerId: "owner_1", editionId: "MR-1", generation: 1, claimToken: "claim-original" };
const event = {
  eventId: "stream:1", operation: "search" as const, outcome: "settled" as const,
  costUsd: 0.025, late: false, observedAt: "2026-09-07T12:00:00Z",
};

async function fixture(targetKind: "edition" | "preview" = "edition") {
  const db = database();
  const targetId = targetKind === "preview" ? "MRP-1" : "MR-1";
  const target = {
    _id: "target", ownerId: "owner_1", generation: 1, claimId: "claim-original",
    ...(targetKind === "preview" ? { previewId: targetId } : { editionId: targetId, exaCostUsd: 7 }),
  };
  db.rows(targetKind === "preview" ? "marketResearchPreviews" : "marketResearchEditions").push(target);
  await registerExaCostBinding(db.ctx, {
    ownerId: "owner_1", targetId, targetKind, generation: 1, claimToken: "claim-original",
  }, 1);
  return { ...db, target, claim: { ...originalClaim, editionId: targetId } };
}

beforeEach(() => vi.stubEnv("MARKET_RESEARCH_OWNER_ID", "owner_1"));
afterEach(() => vi.unstubAllEnvs());

describe("durable Exa accounting authorization", () => {
  it("deduplicates exact retries and rejects an event-ID collision without changing totals", async () => {
    const db = await fixture();
    const args = { ...db.claim, event };
    expect(await persistExaCostEvent(db.ctx, args)).toEqual({ accepted: true, duplicate: false });
    expect(await persistExaCostEvent(db.ctx, args)).toEqual({ accepted: true, duplicate: true });
    expect(await persistExaCostEvent(db.ctx, { ...args, event: { ...event, costUsd: 9 } })).toEqual({ accepted: false });
    expect(db.rows("marketResearchCostEvents")).toHaveLength(1);
    expect(db.target).toMatchObject({ exaObservedCostUsd: 0.025, exaCostEventCount: 1, exaCostUsd: 7 });
  });

  it("accepts a late known cost on the original claim after a new generation takes over", async () => {
    const db = await fixture();
    Object.assign(db.target, { generation: 2, claimId: "claim-new", leaseExpiresAt: 0, status: "completed" });
    await registerExaCostBinding(db.ctx, {
      ownerId: "owner_1", targetId: "MR-1", targetKind: "edition", generation: 2, claimToken: "claim-new",
    }, 2);
    expect(await persistExaCostEvent(db.ctx, { ...db.claim, event: { ...event, late: true } }))
      .toMatchObject({ accepted: true });
    expect(db.rows("marketResearchCostBindings")[0]).toMatchObject({ eventCount: 1, knownCostUsd: 0.025 });
    expect(db.rows("marketResearchCostBindings")[1]).toMatchObject({ eventCount: 0, knownCostUsd: 0 });
    expect(db.target).toMatchObject({ generation: 2, claimId: "claim-new", status: "completed" });
  });

  it("keeps completed and expired preview costs bound without requiring an active preview lease", async () => {
    const db = await fixture("preview");
    Object.assign(db.target, { status: "completed", claimId: undefined, leaseExpiresAt: undefined });
    expect(await persistExaCostEvent(db.ctx, { ...db.claim, event: { ...event, late: true } }))
      .toMatchObject({ accepted: true });
    db.rows("marketResearchPreviews").splice(0);
    expect(await persistExaCostEvent(db.ctx, { ...db.claim, event: { ...event, eventId: "stream:2", late: true } }))
      .toMatchObject({ accepted: true });
    expect(db.rows("marketResearchCostBindings")[0]).toMatchObject({ eventCount: 2, knownCostUsd: 0.05 });
  });

  it("rejects the wrong owner, target, generation, token, and a rotated deployment owner", async () => {
    const db = await fixture();
    for (const change of [
      { ownerId: "owner_2" }, { editionId: "MR-2" }, { generation: 2 },
      { claimToken: "claim-new" }, { generation: 0 },
    ]) expect(await persistExaCostEvent(db.ctx, { ...db.claim, ...change, event })).toEqual({ accepted: false });
    vi.stubEnv("MARKET_RESEARCH_OWNER_ID", "owner_2");
    expect(await persistExaCostEvent(db.ctx, { ...db.claim, event })).toEqual({ accepted: false });
    expect(db.rows("marketResearchCostEvents")).toHaveLength(0);
  });

  it("counts Financial Datasets and late failed-run costs without erasing unknown observations", async () => {
    const db = await fixture();
    await persistExaCostEvent(db.ctx, { ...db.claim, event: { ...event, outcome: "abandoned", costUsd: null } });
    await persistExaCostEvent(db.ctx, {
      ...db.claim, event: { ...event, eventId: "stream:2", operation: "financial_datasets", costUsd: 0.1, late: true },
    });
    await persistExaCostEvent(db.ctx, {
      ...db.claim, event: { ...event, eventId: "stream:3", operation: "financial_datasets", outcome: "failed", costUsd: 0.2, late: true },
    });
    expect(db.target).toMatchObject({ exaCostEventCount: 3, exaUnknownCostEventCount: 1 });
    expect(db.rows("marketResearchCostBindings")[0]?.knownCostUsd).toBeCloseTo(0.3);
    expect(JSON.stringify(db.rows("marketResearchCostBindings"))).not.toContain("claim-original");
  });

  it("bounds each claim ledger while still accepting retries of already persisted events", async () => {
    const db = await fixture();
    await persistExaCostEvent(db.ctx, { ...db.claim, event });
    Object.assign(db.rows("marketResearchCostBindings")[0]!, { eventCount: MARKET_RESEARCH_MAX_COST_EVENTS_PER_CLAIM });
    expect(await persistExaCostEvent(db.ctx, { ...db.claim, event })).toMatchObject({ accepted: true, duplicate: true });
    expect(await persistExaCostEvent(db.ctx, { ...db.claim, event: { ...event, eventId: "stream:2" } }))
      .toEqual({ accepted: false });
    expect(db.rows("marketResearchCostEvents")).toHaveLength(1);
  });
});

describe("additive Pi cost HTTP contract", () => {
  it("preserves all old callback payloads", () => {
    const { ownerId: _, ...lease } = originalClaim;
    for (const payload of [
      { operation: "heartbeat", ...lease, stage: "collecting" },
      { operation: "appendEvidence", ...lease, sequence: 0, evidence: [] },
      { operation: "loadEvidence", ...lease },
      { operation: "complete", result: {} },
      { operation: "fail", ...lease, code: "exa_unavailable", retryable: true },
    ]) expect(marketResearchPiRequestSchema.safeParse(payload).success).toBe(true);
  });

  it("accepts only bounded metadata and rejects raw output, credentials, and invalid amounts", () => {
    expect(marketResearchPiRequestSchema.safeParse({ operation: "recordExaCostEvent", ...originalClaim, event }).success).toBe(true);
    for (const change of [
      { costUsd: -1 }, { costUsd: Infinity }, { costUsd: 1_001 }, { raw: {} },
      { apiKey: "not-a-real-key" }, { requestId: "not an opaque ID" }, { requestId: "x".repeat(257) },
      { outcome: "abandoned", costUsd: 0 }, { eventId: "a".repeat(257) }, { observedAt: "not-a-date" },
    ]) expect(marketResearchCostEventSchema.safeParse({ ...event, ...change }).success).toBe(false);
  });
});
