import { describe, expect, it } from "vitest";
import {
  DISCORD_CHECKPOINT_RETENTION_MS,
  DISCORD_MAX_CHECKPOINT_BYTES,
  checkpointExpired,
  buildPortableCheckpointResponse,
  compatibleCheckpoint,
  discordCompactionThreshold,
  validCheckpointSize,
} from "../src/discord/compaction.js";

describe("portable Discord checkpoint policy", () => {
  it("uses the documented model reserve and 70 percent threshold", () => {
    expect(discordCompactionThreshold({
      contextWindow: 272_000,
      maxOutputTokens: 8_000,
      maxResearchHandoffTokens: 2_500,
    })).toEqual({ reserve: 32_000, threshold: 190_400 });
  });

  it("requires the full owner, guild, epoch, model, and policy identity", () => {
    const identity = {
      ownerId: "owner_1",
      ownerBindingVersion: 1,
      guildId: "123",
      conversationId: "discord:123",
      epoch: 2,
      provider: "openai-codex",
      model: "gpt-5.6-luna",
      personalityVersion: "trishula-discord-v1",
      systemPromptHash: "system",
      capabilityProfileHash: "capability",
    };
    expect(compatibleCheckpoint(identity, identity)).toBe(true);
    expect(compatibleCheckpoint({ ...identity, guildId: "456" }, identity)).toBe(false);
    expect(compatibleCheckpoint({ ...identity, epoch: 3 }, identity)).toBe(false);
  });

  it("enforces the byte and retention boundaries", () => {
    const exact = "x".repeat(DISCORD_MAX_CHECKPOINT_BYTES - 2);
    expect(validCheckpointSize(exact)).toBe(true);
    expect(validCheckpointSize(`${exact}x`)).toBe(false);
    expect(checkpointExpired(1_000, 1_000 + DISCORD_CHECKPOINT_RETENTION_MS - 1)).toBe(false);
    expect(checkpointExpired(1_000, 1_000 + DISCORD_CHECKPOINT_RETENTION_MS)).toBe(true);
  });

  it("builds an evidence-bound deterministic checkpoint envelope", () => {
    const request = {
      profile: "portable_checkpoint" as const,
      requestId: "checkpoint:123:1:2:abc",
      conversation: {
        ownerId: "owner_1",
        ownerBindingVersion: 1,
        guildId: "123",
        conversationId: "discord:123",
        epoch: 1,
        generation: 2,
        routingGeneration: 1,
        revision: 2,
        personalityVersion: "trishula-discord-v1",
        systemPromptHash: "a".repeat(64),
        capabilityProfileHash: "b".repeat(64),
      },
      sourceContextHash: "c".repeat(64),
      compactedThroughOrdinal: 2,
      sourceEvents: [
        {
          eventId: "event:1",
          ordinal: 1,
          role: "human" as const,
          authorId: "789",
          displayName: "Kai",
          content: "Use tables when comparisons need them.",
          createdAt: "2026-09-07T11:59:00.000Z",
        },
        {
          eventId: "event:2",
          ordinal: 2,
          role: "human" as const,
          authorId: "456",
          displayName: "Mira",
          content: "Keep answers concise.",
          createdAt: "2026-09-07T12:00:00.000Z",
        },
      ],
      retainedRecentEventIds: ["event:3"],
      inputEstimatedTokens: 120,
    };
    const summary = {
      participants: [{ authorId: "456", displayName: "Mira" }],
      acceptedFacts: [],
      corrections: [],
      unresolvedQuestions: [],
      commitments: [],
      conversationPreferences: [{
        statement: "Keep answers concise.",
        authorId: "456",
        sourceEventIds: ["event:2"],
      }],
      sourceFreshnessNotes: [],
    };
    const first = buildPortableCheckpointResponse(request, summary);
    const second = buildPortableCheckpointResponse(request, summary);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      profile: "portable_checkpoint",
      checkpointId: request.requestId,
      estimator: {
        exact: false,
        inputEstimatedTokens: 120,
        estimatedSavedTokens: 120 - first.estimator.outputEstimatedTokens,
      },
    });
    expect(() => buildPortableCheckpointResponse(request, {
      ...summary,
      conversationPreferences: [{
        ...summary.conversationPreferences[0],
        sourceEventIds: ["event:invented"],
      }],
    })).toThrow();
    expect(() => buildPortableCheckpointResponse(request, {
      ...summary,
      participants: [{ authorId: "999", displayName: "Invented" }],
    })).toThrow();
    expect(() => buildPortableCheckpointResponse(request, {
      ...summary,
      participants: [
        ...summary.participants,
        { authorId: "789", displayName: "Kai" },
      ],
      conversationPreferences: [{
        statement: "Use tables when comparisons need them.",
        authorId: "789",
        sourceEventIds: ["event:2"],
      }],
    })).toThrow();
  });
});
