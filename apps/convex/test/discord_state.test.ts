import { describe, expect, it } from "vitest";
import {
  DISCORD_CONTEXT_SIZE,
  DISCORD_MAX_AUTONOMOUS_RECHECKS,
  discordCatchupWindows,
  discordClaimDecision,
  discordContextHash,
  discordDuplicateMessageMatches,
  discordMessageIngestDecision,
  discordRecheckDecision,
  discordReplyKindMatchesFlags,
  discordReplyTargetAllowsKind,
  discordTrailingContextStart,
  hasPendingDiscordReply,
  hasSentDiscordFinalizer,
  isCurrentDiscordGeneration,
  newestDiscordContext,
  resolveDiscordChannelRouting,
  type DiscordLoopStateSnapshot,
  type DiscordMessageContext,
} from "../convex/lib/discord_state.js";

function state(overrides: Partial<DiscordLoopStateSnapshot> = {}): DiscordLoopStateSnapshot {
  return {
    generation: 0,
    latestSequence: 0,
    triggerThroughSequence: 0,
    completedThroughSequence: 0,
    recheckCount: 0,
    recheckPending: false,
    ...overrides,
  };
}

function message(sequence: number, overrides: Partial<DiscordMessageContext> = {}): DiscordMessageContext {
  return {
    messageId: `message_${sequence}`,
    sequence,
    authorId: `user_${sequence}`,
    authorName: `User ${sequence}`,
    content: `Message ${sequence}`,
    isBot: false,
    createdAt: sequence,
    ...overrides,
  };
}

describe("Discord durable loop state", () => {
  it("does not allocate a second sequence for a duplicate Discord event", () => {
    expect(discordMessageIngestDecision(7, 7, false)).toEqual({
      duplicate: true,
      sequence: 7,
      triggersLoop: false,
    });
  });

  it("accepts the gateway echo of a bot reply recorded from its acknowledgement", () => {
    expect(discordDuplicateMessageMatches({
      guildId: "guild_1",
      authorId: "discord-bot",
      authorName: "Bot",
      content: "Concise reply",
      isBot: true,
      createdAt: 1_000,
    }, {
      guildId: "guild_1",
      authorId: "bot_123",
      authorName: "Trishula",
      content: "Concise reply",
      isBot: true,
      createdAt: 995,
    })).toBe(true);
    expect(discordDuplicateMessageMatches({
      guildId: "guild_1",
      authorId: "discord-bot",
      authorName: "Bot",
      content: "First reply",
      isBot: true,
      createdAt: 1_000,
    }, {
      guildId: "guild_1",
      authorId: "bot_123",
      authorName: "Trishula",
      content: "Different reply",
      isBot: true,
      createdAt: 995,
    })).toBe(false);
  });

  it("prioritizes finalizing a sent reply over reclaiming its expired loop", () => {
    expect(hasSentDiscordFinalizer([
      {
        runId: "run_1",
        generation: 3,
        status: "sent",
        finalizesLoop: true,
      },
    ], "run_1", 3)).toBe(true);
    expect(hasSentDiscordFinalizer([
      {
        runId: "run_1",
        generation: 2,
        status: "sent",
        finalizesLoop: true,
      },
      {
        runId: "run_1",
        generation: 3,
        status: "pending",
        finalizesLoop: true,
      },
    ], "run_1", 3)).toBe(false);
  });

  it("waits for all pending records before it finalizes a sent reply", () => {
    expect(hasPendingDiscordReply([
      {
        runId: "run_1",
        generation: 3,
        status: "pending",
        finalizesLoop: false,
      },
      {
        runId: "run_1",
        generation: 3,
        status: "sent",
        finalizesLoop: true,
      },
    ], "run_1", 3)).toBe(true);
    expect(hasPendingDiscordReply([
      {
        runId: "run_1",
        generation: 3,
        status: "sent",
        finalizesLoop: false,
      },
    ], "run_1", 3)).toBe(false);
  });

  it("grants one lease when claim contenders observe serialized Convex state", () => {
    const now = 1_000;
    const initial = state({ latestSequence: 1, triggerThroughSequence: 1 });
    const first = discordClaimDecision(initial, now);
    expect(first).toMatchObject({ claimed: true, generation: 1 });
    if (!first.claimed) throw new Error("First contender should claim the loop.");
    const afterFirst = state({
      ...initial,
      generation: first.generation,
      activeRunId: "run_1",
      activeClaimId: "claim_1",
      leaseExpiresAt: now + 120_000,
    });
    expect(discordClaimDecision(afterFirst, now)).toEqual({ claimed: false, reason: "busy" });
  });

  it("partitions a 25-message backlog into ordered ten-message catch-up windows", () => {
    expect(discordCatchupWindows(25)).toEqual([
      { mode: "messages", start: 1, end: 10 },
      { mode: "messages", start: 11, end: 20 },
      { mode: "messages", start: 21, end: 25 },
    ]);
    expect(discordTrailingContextStart(25)).toBe(16);
  });

  it("rejects stale run generations after a lease is fenced", () => {
    const current = state({ generation: 4, activeRunId: "run_current" });
    expect(isCurrentDiscordGeneration(current, "run_current", 4)).toBe(true);
    expect(isCurrentDiscordGeneration(current, "run_current", 3)).toBe(false);
    expect(isCurrentDiscordGeneration(current, "run_stale", 4)).toBe(false);
  });

  it("stores bot messages in context without making them loop triggers", () => {
    expect(discordMessageIngestDecision(undefined, 5, true)).toEqual({
      duplicate: false,
      sequence: 6,
      triggersLoop: false,
    });
    const before = [message(5)];
    const after = [...before, message(6, { isBot: true, authorId: "bot", content: "Concise reply" })];
    expect(discordContextHash(after)).not.toBe(discordContextHash(before));
    expect(discordRecheckDecision({
      requested: true,
      recheckCount: 0,
      activeContextHash: discordContextHash(before),
      newestContextHash: discordContextHash(after),
    })).toMatchObject({ accepted: true, nextRecheckCount: 1 });
  });

  it("caps autonomous rechecks and rejects the same context hash", () => {
    expect(discordRecheckDecision({
      requested: true,
      recheckCount: DISCORD_MAX_AUTONOMOUS_RECHECKS,
      activeContextHash: "old",
      newestContextHash: "new",
    })).toEqual({
      accepted: false,
      nextRecheckCount: DISCORD_MAX_AUTONOMOUS_RECHECKS,
      reason: "cap",
    });
    expect(discordRecheckDecision({
      requested: true,
      recheckCount: 0,
      activeContextHash: "same",
      newestContextHash: "same",
    })).toEqual({ accepted: false, nextRecheckCount: 0, reason: "same_context" });
  });

  it("returns only the newest ten messages in ascending order", () => {
    const messages = Array.from({ length: 15 }, (_, index) => message(index + 1));
    const newest = newestDiscordContext(messages);
    expect(newest).toHaveLength(DISCORD_CONTEXT_SIZE);
    expect(newest.map((item) => item.sequence)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it("resolves configured reply and research channels with a source fallback", () => {
    expect(resolveDiscordChannelRouting("source", [
      { channelId: "source", canSend: true, roles: ["conversation_monitor"] },
      { channelId: "replies", canSend: true, roles: ["reply_target"] },
      { channelId: "research", canSend: true, roles: ["research_log"] },
    ])).toEqual({ replyChannelId: "replies", researchLogChannelId: "research" });
    expect(resolveDiscordChannelRouting("source", [
      { channelId: "source", canSend: true, roles: ["conversation_monitor"] },
    ])).toEqual({ replyChannelId: "source" });
  });

  it("routes acknowledgements to the reply channel and research notes to the log", () => {
    const source = {
      channelId: "source",
      canSend: true,
      roles: ["conversation_monitor"] as const,
    };
    const replyTarget = {
      channelId: "replies",
      canSend: true,
      roles: ["reply_target"] as const,
    };
    const researchLog = {
      channelId: "research",
      canSend: true,
      roles: ["research_log"] as const,
    };

    expect(discordReplyTargetAllowsKind("acknowledgement", "source", source)).toBe(true);
    expect(discordReplyTargetAllowsKind("acknowledgement", "source", replyTarget)).toBe(true);
    expect(discordReplyTargetAllowsKind("acknowledgement", "source", researchLog)).toBe(false);
    expect(discordReplyTargetAllowsKind("research_log", "source", researchLog)).toBe(true);
    expect(discordReplyKindMatchesFlags("final", true, true)).toBe(true);
    expect(discordReplyKindMatchesFlags("acknowledgement", false, false)).toBe(true);
    expect(discordReplyKindMatchesFlags("acknowledgement", false, true)).toBe(false);
  });
});
