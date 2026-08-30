import { describe, expect, it } from "vitest";
import {
  discordAgentRequestSchema,
  discordAcknowledgeResponseSchema,
  discordReplyResponseSchema,
  discordResearchResponseSchema,
  discordTriageResponseSchema,
} from "../src/discord/contracts.js";

export const discordMessages = [{
  messageId: "123456789012345678",
  authorId: "223456789012345678",
  authorName: "Ari",
  content: "What changed in AMD today?",
  createdAt: "2026-08-30T12:00:00.000Z",
  isBot: false,
}];

export const discordChannel = {
  guildId: "323456789012345678",
  channelId: "423456789012345678",
  channelName: "markets",
};

describe("Discord agent contracts", () => {
  it("accepts the four strict request profiles", () => {
    expect(discordAgentRequestSchema.parse({ requestId: "triage_1", profile: "triage", channel: discordChannel, messages: discordMessages }).profile).toBe("triage");
    expect(discordAgentRequestSchema.parse({
      requestId: "ack_1",
      profile: "acknowledge",
      channel: discordChannel,
      messages: discordMessages,
      question: "What changed in AMD today?",
      reason: "The channel asked an open market question.",
    }).profile).toBe("acknowledge");
    expect(discordAgentRequestSchema.safeParse({
      requestId: "ack_missing_reason",
      profile: "acknowledge",
      channel: discordChannel,
      messages: discordMessages,
      question: "What changed in AMD today?",
    }).success).toBe(false);
    expect(discordAgentRequestSchema.parse({ requestId: "research_1", profile: "research", channel: discordChannel, messages: discordMessages, question: "What changed in AMD today?" }).profile).toBe("research");
    expect(discordAgentRequestSchema.parse({ requestId: "reply_1", profile: "reply", channel: discordChannel, messages: discordMessages, question: "What changed in AMD today?", research: null, loopDepth: 0 }).profile).toBe("reply");
  });

  it("requires triage research decisions to include a question and response", () => {
    expect(discordTriageResponseSchema.safeParse({
      profile: "triage",
      shouldRespond: false,
      shouldResearch: true,
      question: null,
      reason: "Current market question.",
      confidence: 0.9,
    }).success).toBe(false);
  });

  it("rejects fake protocols in research sources", () => {
    expect(discordResearchResponseSchema.safeParse({
      profile: "research",
      summary: "A result.",
      findings: [],
      sources: [{
        url: "http://example.com",
        title: "Example",
        publishedAt: null,
        accessedAt: "2026-08-30T12:00:00.000Z",
      }],
      freshness: { asOf: "2026-08-30T12:00:00.000Z", status: "limited" },
      uncertainty: [],
      noTradingAction: true,
    }).success).toBe(false);
  });

  it("caps replies and requires a reason for a recheck", () => {
    expect(discordReplyResponseSchema.safeParse({ profile: "reply", reply: "x".repeat(1_201), recheck: false, recheckReason: null }).success).toBe(false);
    expect(discordReplyResponseSchema.safeParse({ profile: "reply", reply: "Short answer.", recheck: true, recheckReason: null }).success).toBe(false);
  });

  it("accepts acknowledgement responses", () => {
    expect(discordAcknowledgeResponseSchema.safeParse({
      profile: "acknowledge",
      acknowledgement: "I picked up the question and will check today's semiconductor news.",
    }).success).toBe(true);
    expect(discordAcknowledgeResponseSchema.safeParse({
      profile: "acknowledge",
      acknowledgement: "x".repeat(321),
    }).success).toBe(false);
    expect(discordAcknowledgeResponseSchema.safeParse({
      profile: "acknowledge",
      acknowledgement: "I picked it up.",
      reply: "unexpected",
    }).success).toBe(false);
  });
});
