import { describe, expect, it } from "vitest";
import type { ResearchPacket } from "../src/discord/contracts.js";
import {
  RESEARCH_PACKET_ESTIMATOR_VERSION,
  RESEARCH_PACKET_MAX_BYTES,
  estimateResearchPacketTokens,
  researchPacketBytes,
  validateResearchPacket,
} from "../src/discord/research-packet.js";

function packet(overrides: Partial<ResearchPacket> = {}): ResearchPacket {
  return {
    schemaVersion: 1,
    requestId: "turn_1:research:1",
    question: "Why did AMD move today?",
    asOf: "2026-09-01T12:00:00.000Z",
    freshness: { status: "current", detail: "Checked at noon UTC." },
    summary: "The filing and market data support the move.",
    findings: [{
      claim: "AMD moved after the filing.",
      evidence: "The filing was published before the move.",
      sourceIds: ["source_1"],
      kind: "fact",
    }],
    sources: [{
      id: "source_1",
      title: "AMD filing",
      url: "https://ir.amd.com/filing",
      accessedAt: "2026-09-01T12:00:00.000Z",
      primary: true,
    }],
    uncertainties: [],
    ...overrides,
  };
}

describe("bounded Sol evidence handoff", () => {
  it("records the pinned deterministic estimator and UTF-8 byte count", () => {
    const result = validateResearchPacket(packet(), {
      evidenceUrls: new Set(["https://ir.amd.com/filing"]),
    });
    expect(result.estimator.version).toBe(RESEARCH_PACKET_ESTIMATOR_VERSION);
    expect(result.estimator.exact).toBe(false);
    expect(result.estimator.estimatedTokens).toBe(estimateResearchPacketTokens(result.packet));
    expect(result.estimator.serializedBytes).toBe(researchPacketBytes(result.packet));
  });

  it("rejects unsupported URLs and dangling source IDs", () => {
    expect(() => validateResearchPacket(packet(), { evidenceUrls: new Set() })).toThrow();
    expect(() => validateResearchPacket(packet({
      findings: [{
        claim: "Claim",
        evidence: "Evidence",
        sourceIds: ["missing"],
        kind: "fact",
      }],
    }), { evidenceUrls: new Set(["https://ir.amd.com/filing"]) })).toThrow();
  });

  it("fails closed when a limited or unknown packet has no evidence", () => {
    for (const status of ["limited", "unknown"] as const) {
      expect(() => validateResearchPacket(packet({
        freshness: { status, detail: "No source could be verified." },
        summary: "XYZ is trading at 999.",
        findings: [],
        sources: [],
      }), { evidenceUrls: new Set() })).toThrow();
    }
  });

  it("rejects an untrusted chart reference and a packet over the hard byte limit", () => {
    expect(() => validateResearchPacket(packet({
      trustedChart: {
        artifactId: "chart_1",
        symbol: "AMD",
        timeframe: "1D",
        generatedAt: "2026-09-01T12:00:00.000Z",
      },
    }), { evidenceUrls: new Set(["https://ir.amd.com/filing"]) })).toThrow();
    expect(() => validateResearchPacket(packet(), {
      evidenceUrls: new Set(["https://ir.amd.com/filing"]),
      maximumBytes: Math.min(RESEARCH_PACKET_MAX_BYTES, 1),
    })).toThrow();
  });
});
