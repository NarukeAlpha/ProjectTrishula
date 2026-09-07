import { describe, expect, it } from "vitest";
import {
  DISCORD_PERSONALITY_PROFILE,
  DISCORD_PORTABLE_CHECKPOINT_MAX_BYTES,
  DISCORD_PORTABLE_CHECKPOINT_RETENTION_MS,
  discordConversationId,
  discordConversationLeaseToken,
  discordPrivacyDeletionBlocked,
  discordSnowflakeUpperBound,
  discordUnicodeLength,
  isCurrentDiscordConversationFence,
  portableCheckpointRestorable,
  portableConversationSummarySchema,
  requireDiscordReplyContent,
  selectDiscordCanonicalTail,
  selectDiscordCheckpointTail,
  validatePortableCheckpointCandidate,
} from "../convex/lib/discord_conversation.js";

const fence = {
  ownerId: "owner_1",
  ownerBindingVersion: 1,
  guildId: "123",
  conversationId: "discord:123",
  epoch: 4,
  generation: 8,
  routingGeneration: 2,
  activeTurnId: "turn_1",
  activeRunId: "run_1",
  activeLeaseToken: "token_1",
  leaseExpiresAt: 2_000,
};

describe("Discord canonical conversation invariants", () => {
  it("uses one stable logical conversation ID per guild", () => {
    expect(discordConversationId("123")).toBe("discord:123");
    expect(discordConversationId("456")).not.toBe(discordConversationId("123"));
  });

  it("requires every owner, epoch, routing, turn, and lease fence", () => {
    expect(isCurrentDiscordConversationFence(fence, {
      ownerId: "owner_1",
      ownerBindingVersion: 1,
      conversationId: "discord:123",
      epoch: 4,
      generation: 8,
      routingGeneration: 2,
      turnId: "turn_1",
      runId: "run_1",
      leaseToken: "token_1",
    }, 1_999)).toBe(true);
    expect(isCurrentDiscordConversationFence(fence, {
      ownerId: "owner_1",
      ownerBindingVersion: 1,
      conversationId: "discord:123",
      epoch: 5,
      generation: 8,
      routingGeneration: 2,
      turnId: "turn_1",
      runId: "run_1",
      leaseToken: "token_1",
    }, 1_999)).toBe(false);
    expect(isCurrentDiscordConversationFence(fence, {
      ownerId: "owner_1",
      ownerBindingVersion: 1,
      conversationId: "discord:123",
      epoch: 4,
      generation: 8,
      routingGeneration: 2,
      turnId: "turn_1",
      runId: "run_1",
      leaseToken: "token_1",
    }, 2_000)).toBe(false);
  });

  it("derives stable, guild-separated lease tokens", () => {
    const first = discordConversationLeaseToken("discord:123", 0, 1, "turn", "worker");
    expect(first).toBe(discordConversationLeaseToken("discord:123", 0, 1, "turn", "worker"));
    expect(first).not.toBe(discordConversationLeaseToken("discord:456", 0, 1, "turn", "worker"));
  });

  it("creates a Discord history cursor after every message in the deletion millisecond", () => {
    const timestamp = 1_788_200_000_123;
    const cursor = BigInt(discordSnowflakeUpperBound(timestamp));
    expect(Number((cursor >> 22n) + 1_420_070_400_000n)).toBe(timestamp);
    expect(cursor & ((1n << 22n) - 1n)).toBe((1n << 22n) - 1n);
  });

  it("blocks privacy deletion while a guild delivery outcome is unresolved", () => {
    expect(discordPrivacyDeletionBlocked("123", [{
      guildId: "123",
      sourceGuildId: "123",
      status: "delivery_uncertain",
    }])).toBe(true);
    expect(discordPrivacyDeletionBlocked("123", [{
      guildId: "456",
      sourceGuildId: "456",
      status: "needs_reconciliation",
    }])).toBe(false);
    expect(discordPrivacyDeletionBlocked("123", [{
      guildId: "123",
      sourceGuildId: "123",
      status: "pending",
    }])).toBe(false);
  });

  it("uses the shared Unicode character boundary without truncation", () => {
    expect(discordUnicodeLength("ASCII")).toBe(5);
    expect(discordUnicodeLength("é")).toBe(1);
    expect(discordUnicodeLength("e\u0301")).toBe(2);
    expect(discordUnicodeLength("😀")).toBe(1);
    expect(discordUnicodeLength("\uD83D\uDE00")).toBe(1);
    expect(requireDiscordReplyContent("😀".repeat(2_000))).toHaveLength(4_000);
    expect(requireDiscordReplyContent(`  ${"😀".repeat(2_000)}  `))
      .toBe("😀".repeat(2_000));
    expect(() => requireDiscordReplyContent("😀".repeat(2_001))).toThrow();
  });

  it("accepts the exact checkpoint boundary and rejects one byte over", () => {
    const createdAt = 10_000;
    const base = {
      sourceRevision: 12,
      currentRevision: 12,
      createdAt,
      expiresAt: createdAt + DISCORD_PORTABLE_CHECKPOINT_RETENTION_MS,
    };
    expect(() => validatePortableCheckpointCandidate({
      ...base,
      serializedBytes: DISCORD_PORTABLE_CHECKPOINT_MAX_BYTES,
    })).not.toThrow();
    expect(() => validatePortableCheckpointCandidate({
      ...base,
      serializedBytes: DISCORD_PORTABLE_CHECKPOINT_MAX_BYTES + 1,
    })).toThrow();
    expect(() => validatePortableCheckpointCandidate({
      ...base,
      sourceRevision: 11,
      serializedBytes: 1,
    })).toThrow();
  });

  it("restores only current, identity-compatible portable checkpoints", () => {
    const checkpoint = {
      ...fence,
      ...DISCORD_PERSONALITY_PROFILE,
      schemaVersion: 1,
      implementationVersion: "portable-summary-v1",
      provider: "openai-codex",
      model: DISCORD_PERSONALITY_PROFILE.lunaModel,
      toolPolicyHash: DISCORD_PERSONALITY_PROFILE.capabilityProfileHash,
      sourceRevision: 8,
      status: "active",
      expiresAt: 2_000,
    };
    const expected = {
      ...fence,
      revision: 10,
      model: DISCORD_PERSONALITY_PROFILE.lunaModel,
      capabilityProfileHash: DISCORD_PERSONALITY_PROFILE.capabilityProfileHash,
    };
    expect(portableCheckpointRestorable(checkpoint, expected, 1_999)).toBe(true);
    expect(portableCheckpointRestorable({
      ...checkpoint,
      systemPromptHash: "changed",
    }, expected, 1_999)).toBe(false);
    expect(portableCheckpointRestorable(checkpoint, expected, 2_000)).toBe(false);
  });

  it("preserves correction attribution and source events in portable summaries", () => {
    const summary = portableConversationSummarySchema.parse({
      participants: [{ authorId: "123", displayName: "Mira" }],
      acceptedFacts: [{
        statement: "The corrected value is 42.",
        subjectAuthorId: "123",
        assertedByAuthorId: "123",
        sourceEventIds: ["event:2"],
      }],
      corrections: [{
        rejectedStatement: "The value is 41.",
        replacementStatement: "The value is 42.",
        correctedByAuthorId: "123",
        sourceEventIds: ["event:1", "event:2"],
      }],
      unresolvedQuestions: [],
      commitments: [],
      conversationPreferences: [],
      sourceFreshnessNotes: [],
    });
    expect(summary.corrections[0]).toEqual({
      rejectedStatement: "The value is 41.",
      replacementStatement: "The value is 42.",
      correctedByAuthorId: "123",
      sourceEventIds: ["event:1", "event:2"],
    });
    expect(portableConversationSummarySchema.safeParse({
      ...summary,
      corrections: [{
        rejectedStatement: "The value is 41.",
        replacementStatement: "The value is 42.",
        correctedByAuthorId: "123",
        sourceEventIds: [],
      }],
    }).success).toBe(false);
  });

  it("PERS-005/PERS-090 bounds the raw tail by tokens and reports every omission", () => {
    const events = [1, 2, 3].map((ordinal) => ({
      eventId: `event:${ordinal}`,
      ordinal,
      content: "x".repeat(90),
    }));
    const selected = selectDiscordCanonicalTail(events, {
      tokenBudget: 120,
      requiredEventIds: new Set(["event:1"]),
    });
    expect(selected.events.map((event) => event.eventId)).toEqual([
      "event:1",
      "event:3",
    ]);
    expect(selected.omittedEventCount).toBe(1);
    expect(selected.complete).toBe(false);
    expect(selected.estimatedTokens).toBeLessThanOrEqual(120);
  });

  it("keeps the portable-checkpoint replay tail contiguous", () => {
    const events = [
      { eventId: "event:1", ordinal: 1, content: "x".repeat(300) },
      { eventId: "event:2", ordinal: 2, content: "x" },
      { eventId: "event:3", ordinal: 3, content: "x".repeat(90) },
    ];
    const selected = selectDiscordCheckpointTail(events, { tokenBudget: 60 });
    expect(selected.events.map((event) => event.eventId)).toEqual(["event:3"]);
    expect(selected.omittedEventCount).toBe(2);
    expect(selected.complete).toBe(false);
  });

  it("rejects unordered canonical replay input", () => {
    expect(() => selectDiscordCanonicalTail([
      { eventId: "event:2", ordinal: 2, content: "new" },
      { eventId: "event:1", ordinal: 1, content: "old" },
    ])).toThrow(/increasing ordinals/);
  });
});
