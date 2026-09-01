import { describe, expect, it } from "vitest";
import {
  DISCORD_CHECKPOINT_RETENTION_MS,
  DISCORD_MAX_CHECKPOINT_BYTES,
  checkpointExpired,
  compatibleCheckpoint,
  discordCompactionThreshold,
  validCheckpointSize,
} from "../src/discord/compaction.js";

describe("portable Discord checkpoint policy", () => {
  it("uses the documented model reserve and 70 percent threshold", () => {
    expect(discordCompactionThreshold({
      contextWindow: 400_000,
      maxOutputTokens: 8_000,
      maxResearchHandoffTokens: 2_500,
    })).toEqual({ reserve: 32_000, threshold: 280_000 });
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
});
