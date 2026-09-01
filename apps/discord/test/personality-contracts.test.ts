import { describe, expect, it } from "vitest";
import {
  frontmanPlanRequestSchema,
  frontmanPlanResponseSchema,
  portableConversationSummarySchema,
  researchPacketSchema,
  solResearchRequestSchema,
} from "../src/personality-contracts.js";

const message = {
  messageId: "123456789012345678",
  sequence: 1,
  authorId: "223456789012345678",
  authorName: "Ari",
  content: "What changed in AMD today?",
  createdAt: "2026-08-30T12:00:00.000Z",
  isBot: false,
};
const channel = {
  guildId: "323456789012345678",
  channelId: "423456789012345678",
  channelName: "markets",
};
const conversation = {
  ownerId: "owner_1",
  ownerBindingVersion: 1,
  guildId: channel.guildId,
  conversationId: `discord:${channel.guildId}`,
  epoch: 1,
  turnId: "turn_1",
  runId: "run_1",
  generation: 1,
  routingGeneration: 1,
  revision: 2,
  humanRevision: 1,
  personalityVersion: "trishula-discord-v1",
  systemPromptHash: "a".repeat(64),
  capabilityProfileHash: "b".repeat(64),
};
const durableContext = {
  sourceRevision: 2,
  sourceHumanRevision: 1,
  recentEvents: [],
  tail: {
    estimatorVersion: "utf8-bytes-div-3-plus-message-overhead:v1" as const,
    tokenBudget: 20_000,
    estimatedTokens: 0,
    compactedThroughOrdinal: 0,
    omittedEventCount: 0,
    complete: true,
  },
};

describe("durable personality contracts", () => {
  it("requires durable context for Luna and rejects it from isolated Sol", () => {
    const common = {
      requestId: "request_1",
      channel,
      messages: [message],
      conversation,
    };
    expect(frontmanPlanRequestSchema.safeParse({
      ...common,
      profile: "frontman_plan",
      triggerKind: "mention",
      durableContext,
    }).success).toBe(true);
    const sol = {
      ...common,
      profile: "research",
      researchRequest: {
        question: "Why did AMD move?",
        decisionContext: "Current market move",
        requiredFacts: ["Current catalyst"],
        freshnessRequirement: "Current session",
        preferredPrimarySources: ["Issuer"],
      },
      pass: 1,
    };
    expect(solResearchRequestSchema.safeParse(sol).success).toBe(true);
    expect(solResearchRequestSchema.safeParse({ ...sol, durableContext }).success).toBe(false);
  });

  it("accepts 2,000 Unicode characters and rejects 2,001", () => {
    const response = {
      profile: "frontman_plan",
      action: "reply",
      targetMessageId: message.messageId,
      confidence: 1,
      additiveValue: 1,
      reasonCode: "explicit_stable",
      reply: "😀".repeat(2_000),
    } as const;
    expect(frontmanPlanResponseSchema.safeParse(response).success).toBe(true);
    expect(frontmanPlanResponseSchema.safeParse({
      ...response,
      reply: "😀".repeat(2_001),
    }).success).toBe(false);
    expect(frontmanPlanResponseSchema.parse({
      ...response,
      reply: `  ${"😀".repeat(2_000)}  `,
    }).reply).toBe("😀".repeat(2_000));
  });

  it("requires declared evidence for every researched current claim", () => {
    const packet = {
      schemaVersion: 1,
      requestId: "packet_1",
      question: "Why did AMD move?",
      asOf: "2026-08-30T12:00:00.000Z",
      freshness: { status: "current", detail: "Current through the close." },
      summary: "An issuer filing preceded the move.",
      findings: [{
        claim: "The filing preceded the move.",
        evidence: "The filing timestamp was earlier.",
        sourceIds: ["source_1"],
        kind: "fact",
      }],
      sources: [{
        id: "source_1",
        title: "Issuer filing",
        url: "https://example.com/filing",
        accessedAt: "2026-08-30T12:00:00.000Z",
        primary: true,
      }],
      uncertainties: [],
    } as const;
    expect(researchPacketSchema.safeParse(packet).success).toBe(true);
    expect(researchPacketSchema.safeParse({ ...packet, sources: [] }).success).toBe(false);
    expect(researchPacketSchema.safeParse({
      ...packet,
      findings: [{ ...packet.findings[0], sourceIds: ["missing_source"] }],
    }).success).toBe(false);
  });

  it("retains exact author and event attribution through a portable summary", () => {
    const parsed = portableConversationSummarySchema.parse({
      participants: [{ authorId: message.authorId, displayName: "Ari" }],
      acceptedFacts: [{
        statement: "The corrected value is 42.",
        assertedByAuthorId: message.authorId,
        sourceEventIds: ["event:2"],
      }],
      corrections: [{
        rejectedStatement: "The value is 41.",
        replacementStatement: "The value is 42.",
        correctedByAuthorId: message.authorId,
        sourceEventIds: ["event:1", "event:2"],
      }],
      unresolvedQuestions: [],
      commitments: [],
      conversationPreferences: [],
      sourceFreshnessNotes: [],
    });
    expect(parsed.corrections[0]?.sourceEventIds).toEqual(["event:1", "event:2"]);
    expect(parsed.corrections[0]?.correctedByAuthorId).toBe(message.authorId);
  });
});
