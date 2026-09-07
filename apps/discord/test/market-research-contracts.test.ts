import { describe, expect, it } from "vitest";
import { discoveredChannelSchema } from "../src/contracts.js";
import { publicationClaimSchema } from "../src/market-research/contracts.js";

describe("market-research Discord contracts", () => {
  it("preserves synchronized forum metadata and defaults omitted permissions to false", () => {
    const forum = {
      channelId: "123",
      name: "morning-paper",
      type: "forum",
      canView: true,
      canSend: true,
      canReadHistory: true,
      canCreateForumPost: true,
      canSendInThreads: true,
      canReadThreadHistory: true,
      canAttachFiles: true,
      requiresTag: true,
      availableTags: [{ id: "456", name: "Morning", moderated: false, emoji: "📰" }],
    };

    expect(discoveredChannelSchema.safeParse(forum).success).toBe(true);
    const { canCreateForumPost: _, ...incomplete } = forum;
    expect(discoveredChannelSchema.parse(incomplete)).toEqual({ ...forum, canCreateForumPost: false });
  });

  it("accepts older channel inventory without granting forum publication", () => {
    expect(discoveredChannelSchema.parse({
      channelId: "123", name: "existing-conversation", type: "text",
      canView: true, canSend: true, canReadHistory: true,
    })).toMatchObject({
      canView: true, canSend: true, canReadHistory: true,
      canCreateForumPost: false, canSendInThreads: false, canReadThreadHistory: false,
      canAttachFiles: false, requiresTag: true, availableTags: [],
    });
  });

  it("rejects unknown publication fields and oversized immutable parts", () => {
    const claim = {
      claimed: true,
      editionId: "edition_1",
      guildId: "100",
      forumChannelId: "200",
      forumTagIds: [],
      forumTitle: "Morning Market Newspaper - 2026-09-01 - MIXED",
      publicationGeneration: 1,
      publicationToken: "publication_token_1",
      delivery: {
        deliveryId: "edition_1:starter",
        sequence: 0,
        kind: "starter",
        content: "x".repeat(2_001),
        contentHash: "a".repeat(64),
        nonce: "nonce_1",
        chartAttachmentIds: [],
        chartRequests: [],
        deliveryToken: "delivery_token_1",
        attempts: 1,
      },
    };
    expect(publicationClaimSchema.safeParse(claim).success).toBe(false);
    expect(publicationClaimSchema.safeParse({
      ...claim,
      delivery: { ...claim.delivery, content: "Edition ID: MR-edition_1" },
      ownerOverride: "owner_2",
    }).success).toBe(false);
  });
});
