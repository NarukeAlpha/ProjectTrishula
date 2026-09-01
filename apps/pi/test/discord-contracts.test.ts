import { describe, expect, it } from "vitest";
import {
  discordAgentRequestSchema,
  discordFrontmanPlanRequestSchema,
  discordFrontmanPlanResponseSchema,
  discordSolResearchResponseSchema,
  discordSolResearchRequestSchema,
  discordReplyResponseSchema,
  discordResearchResponseSchema,
  discordTriageResponseSchema,
} from "../src/discord/contracts.js";

export const discordMessages = [
  {
    messageId: "123456789012345678",
    sequence: 1,
    authorId: "223456789012345678",
    authorName: "Ari",
    content: "What changed in AMD today?",
    createdAt: "2026-08-30T12:00:00.000Z",
    isBot: false,
  },
];

export const discordChannel = {
  guildId: "323456789012345678",
  channelId: "423456789012345678",
  channelName: "markets",
};

const targetMessageId = "123456789012345678";

describe("Discord agent contracts", () => {
  const conversation = {
    ownerId: "owner_1",
    ownerBindingVersion: 1,
    guildId: discordChannel.guildId,
    conversationId: `discord:${discordChannel.guildId}`,
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

  it("accepts the durable frontman identity and keeps portable memory out of Sol", () => {
    const common = {
      requestId: "durable_1",
      channel: discordChannel,
      messages: discordMessages,
      conversation,
    };
    expect(discordFrontmanPlanRequestSchema.safeParse({
      ...common,
      profile: "frontman_plan",
      triggerKind: "mention",
      durableContext,
    }).success).toBe(true);
    const sol = {
      ...common,
      requestId: "sol_1",
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
    expect(discordSolResearchRequestSchema.safeParse(sol).success).toBe(true);
    expect(discordSolResearchRequestSchema.safeParse({
      ...sol,
      durableContext,
    }).success).toBe(false);
  });

  it("uses the exact Unicode boundary for all frontman visible output", () => {
    const response = {
      profile: "frontman_plan",
      action: "reply",
      targetMessageId,
      confidence: 1,
      additiveValue: 1,
      reasonCode: "explicit_stable",
      reply: "😀".repeat(2_000),
    } as const;
    expect(discordFrontmanPlanResponseSchema.safeParse(response).success).toBe(true);
    expect(discordFrontmanPlanResponseSchema.safeParse({
      ...response,
      reply: "😀".repeat(2_001),
    }).success).toBe(false);
    expect(discordFrontmanPlanResponseSchema.parse({
      ...response,
      reply: `  ${"😀".repeat(2_000)}  `,
    }).reply).toBe("😀".repeat(2_000));
    const researchPlan = {
      profile: "frontman_plan",
      action: "research",
      targetMessageId,
      confidence: 1,
      additiveValue: 1,
      reasonCode: "explicit_needs_freshness",
      acknowledgement: "😀".repeat(320),
      researchRequest: {
        question: "Why did AMD move?",
        decisionContext: "Current market move",
        requiredFacts: ["Current catalyst"],
        freshnessRequirement: "Current session",
        preferredPrimarySources: ["Issuer"],
      },
    } as const;
    expect(discordFrontmanPlanResponseSchema.safeParse(researchPlan).success).toBe(true);
    expect(discordFrontmanPlanResponseSchema.safeParse({
      ...researchPlan,
      acknowledgement: "😀".repeat(321),
    }).success).toBe(false);
  });

  it("rejects a current Sol packet without declared evidence", () => {
    const response = {
      profile: "research",
      packet: {
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
        sources: [],
        uncertainties: [],
      },
      estimator: {
        package: "js-tiktoken",
        packageVersion: "1.0.21",
        encoding: "o200k_base",
        modelMapping: "gpt-5.6-sol-estimate",
        exact: false,
        version: "js-tiktoken@1.0.21:o200k_base:gpt-5.6-sol-estimate:v1",
        estimatedTokens: 100,
        serializedBytes: 500,
      },
    } as const;
    expect(discordSolResearchResponseSchema.safeParse(response).success).toBe(false);
  });
  it("accepts the three strict request profiles", () => {
    expect(
      discordAgentRequestSchema.parse({
        requestId: "triage_1",
        profile: "triage",
        triggerKind: "mention",
        channel: discordChannel,
        messages: discordMessages,
      }).profile,
    ).toBe("triage");
    expect(
      discordAgentRequestSchema.safeParse({
        requestId: "removed_ack_profile",
        profile: "acknowledge",
        channel: discordChannel,
        messages: discordMessages,
      }).success,
    ).toBe(false);
    expect(
      discordAgentRequestSchema.parse({
        requestId: "research_1",
        profile: "research",
        channel: discordChannel,
        messages: discordMessages,
        question: "What changed in AMD today?",
      }).profile,
    ).toBe("research");
    expect(
      discordAgentRequestSchema.parse({
        requestId: "reply_1",
        profile: "reply",
        triggerKind: "ambient",
        targetMessageId,
        channel: discordChannel,
        messages: discordMessages,
        question: "What changed in AMD today?",
        research: null,
      }).profile,
    ).toBe("reply");
  });

  it("accepts image-only context from Discord's attachment CDN", () => {
    const request = discordAgentRequestSchema.safeParse({
      requestId: "triage_image_1",
      profile: "triage",
      triggerKind: "mention",
      channel: discordChannel,
      messages: [
        {
          ...discordMessages[0],
          content: "",
          images: [
            {
              attachmentId: "523456789012345678",
              url: "https://cdn.discordapp.com/attachments/10/20/chart.png?ex=abc",
              filename: "chart.png",
              mediaType: "image/png",
              sizeBytes: 32_000,
              width: 1_200,
              height: 675,
            },
          ],
        },
      ],
    });
    expect(request.success).toBe(true);
    expect(
      discordAgentRequestSchema.safeParse({
        requestId: "triage_image_bad_1",
        profile: "triage",
        triggerKind: "mention",
        channel: discordChannel,
        messages: [
          {
            ...discordMessages[0],
            content: "",
            images: [
              {
                attachmentId: "523456789012345678",
                url: "https://example.com/chart.png",
                filename: "chart.png",
                mediaType: "image/png",
                sizeBytes: 32_000,
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires triage decisions to use consistent fields", () => {
    expect(
      discordTriageResponseSchema.safeParse({
        profile: "triage",
        decision: "research",
        targetMessageId,
        question: null,
        directReply: null,
        acknowledgement: null,
        reason: "Current market question.",
        confidence: 0.9,
        additiveValue: 0.9,
      }).success,
    ).toBe(false);
    expect(
      discordTriageResponseSchema.safeParse({
        profile: "triage",
        decision: "research",
        targetMessageId,
        question: "What changed in AMD today?",
        directReply: null,
        acknowledgement: null,
        reason: "Ambient research can stay quiet until the answer is ready.",
        confidence: 0.95,
        additiveValue: 0.95,
      }).success,
    ).toBe(true);
    expect(
      discordTriageResponseSchema.safeParse({
        profile: "triage",
        decision: "direct",
        targetMessageId,
        question: "What is a semiconductor?",
        directReply: "It is a material used to control electrical current.",
        acknowledgement: null,
        reason: "This can be answered from stable knowledge.",
        confidence: 0.95,
        additiveValue: 0.95,
      }).success,
    ).toBe(true);
  });

  it("rejects fake protocols in research sources", () => {
    expect(
      discordResearchResponseSchema.safeParse({
        profile: "research",
        summary: "A result.",
        findings: [],
        sources: [
          {
            url: "http://example.com",
            title: "Example",
            publishedAt: null,
            accessedAt: "2026-08-30T12:00:00.000Z",
          },
        ],
        freshness: { asOf: "2026-08-30T12:00:00.000Z", status: "limited" },
        uncertainty: [],
        noTradingAction: true,
      }).success,
    ).toBe(false);
  });

  it("caps replies and requires action to match content", () => {
    expect(
      discordReplyResponseSchema.safeParse({
        profile: "reply",
        action: "send",
        reply: "x".repeat(2_001),
        reason: "Too long.",
      }).success,
    ).toBe(false);
    expect(
      discordReplyResponseSchema.safeParse({
        profile: "reply",
        action: "suppress",
        reply: "Short answer.",
        reason: "Already answered.",
      }).success,
    ).toBe(false);
    expect(
      discordReplyResponseSchema.safeParse({
        profile: "reply",
        action: "suppress",
        reply: null,
        reason: "Already answered.",
      }).success,
    ).toBe(true);
  });
});
