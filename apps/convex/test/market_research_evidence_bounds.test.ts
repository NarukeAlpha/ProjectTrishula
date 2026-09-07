import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendEvidence, loadEvidence } from "../convex/market_research.js";
import { serializedUtf8Bytes } from "../convex/lib/market_research.js";
import { convexMutationFixture, invokeMutation } from "./helpers/convex-fixture.js";

const lease = { editionId: "edition-1", generation: 1, claimToken: "claim-1" };
const evidence = (index: number, highlight = "") => ({
  evidenceId: `source-${index}`, kind: "news", provider: "Exa", sourcePolicy: "approved",
  retrievedAt: "2026-09-07T12:00:00Z", freshness: "fresh", contentStatus: "available",
  highlights: highlight ? [highlight] : [], normalizedClaims: [], contentHash: "a".repeat(64),
});

function fixture(items: ReturnType<typeof evidence>[]) {
  const db = convexMutationFixture();
  const edition = {
    _id: "edition-row", ...lease, claimId: lease.claimToken, ownerId: "owner_1",
    leaseExpiresAt: Date.now() + 60_000, sourceCount: items.length,
    acceptedSourceCount: items.length, updatedAt: 1,
  };
  db.rows("marketResearchEditions").push(edition);
  db.rows("marketResearchEvidence").push(...items.map((item, index) => ({
    ...item, _id: `evidence-${index}`, _creationTime: 1, editionId: lease.editionId,
    checkpointSequence: 0, retentionExpiresAt: 10, createdAt: 1,
  })));
  return { ...db, edition };
}

beforeEach(() => vi.stubEnv("MARKET_RESEARCH_OWNER_ID", "owner_1"));
afterEach(() => vi.unstubAllEnvs());

describe("edition evidence recovery bounds", () => {
  it("accepts the last allowed record and exact duplicate at the record cap", async () => {
    const db = fixture(Array.from({ length: 499 }, (_, index) => evidence(index)));
    expect(await invokeMutation(appendEvidence, db.ctx, { ...lease, sequence: 1, evidence: [evidence(499)] }))
      .toEqual({ accepted: true, inserted: 1 });
    expect(await invokeMutation(appendEvidence, db.ctx, { ...lease, sequence: 2, evidence: [evidence(499)] }))
      .toEqual({ accepted: true, inserted: 0 });
    expect(db.rows("marketResearchEvidence")).toHaveLength(500);
    expect(db.edition.sourceCount).toBe(500);
  });

  it("rejects an entire batch that would exceed the record cap without partial writes", async () => {
    const db = fixture(Array.from({ length: 499 }, (_, index) => evidence(index)));
    const before = JSON.stringify(db.edition);
    expect(await invokeMutation(appendEvidence, db.ctx, {
      ...lease, sequence: 1, evidence: [evidence(499), evidence(500)],
    })).toEqual({ accepted: false });
    expect(db.rows("marketResearchEvidence")).toHaveLength(499);
    expect(JSON.stringify(db.edition)).toBe(before);
  });

  it("counts UTF-8 payload bytes across all checkpoints before inserting anything", async () => {
    const items = Array.from({ length: 90 }, (_, index) => evidence(index, "é".repeat(1_200)));
    expect(serializedUtf8Bytes(items)).toBeLessThan(262_144);
    const db = fixture(items);
    const batch = Array.from({ length: 12 }, (_, index) => evidence(90 + index, "é".repeat(1_200)));
    expect(serializedUtf8Bytes(batch)).toBeLessThan(65_536);
    expect(serializedUtf8Bytes([...items, ...batch])).toBeGreaterThan(262_144);
    const before = JSON.stringify(db.edition);
    expect(await invokeMutation(appendEvidence, db.ctx, { ...lease, sequence: 1, evidence: batch }))
      .toEqual({ accepted: false });
    expect(db.rows("marketResearchEvidence")).toHaveLength(90);
    expect(JSON.stringify(db.edition)).toBe(before);
  });

  it("rejects a changed evidence identity before adding a separate valid record", async () => {
    const db = fixture([evidence(0)]);
    expect(await invokeMutation(appendEvidence, db.ctx, {
      ...lease, sequence: 1, evidence: [evidence(1), { ...evidence(0), contentHash: "b".repeat(64) }],
    })).toEqual({ accepted: false });
    expect(db.rows("marketResearchEvidence")).toHaveLength(1);
  });

  it("does not silently truncate a preexisting oversized recovery packet", async () => {
    const db = fixture(Array.from({ length: 501 }, (_, index) => evidence(index)));
    // SAFETY: Convex registers the query handler on _handler; the fixture implements its DB reads.
    const query = loadEvidence as typeof loadEvidence & {
      _handler: (ctx: typeof db.ctx, args: typeof lease) => Promise<{ accepted: boolean; evidence: unknown[] }>;
    };
    expect(await query._handler(db.ctx, lease)).toEqual({ accepted: false, evidence: [] });
    expect(db.rows("marketResearchEvidence")).toHaveLength(501);
  });
});
