import { describe, expect, it } from "vitest";
import {
  discordAgentRequestSchema,
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
        reply: "x".repeat(1_201),
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
