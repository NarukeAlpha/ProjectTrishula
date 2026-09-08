import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateResearchModelToAstra } from "../convex/discord.js";
import { DISCORD_PERSONALITY_PROFILE } from "../convex/lib/discord_conversation.js";
import { convexMutationFixture, invokeMutation } from "./helpers/convex-fixture.js";

beforeEach(() => { vi.stubEnv("WORKOS_ALLOWED_USER_IDS", "owner_1,owner_2"); });
afterEach(() => { vi.unstubAllEnvs(); });

function conversation(ownerId: string, guildId: string, model = "gpt-5.6-sol") {
  return {
    _id: `conversation:${guildId}`, _creationTime: 1, ownerId, guildId,
    conversationId: `discord:${guildId}`, ownerBindingVersion: 4, epoch: 3,
    generation: 11, routingGeneration: 2, revision: 27, humanRevision: 19,
    nextOrdinal: 28, migrationWatermarkSequence: 13,
    activeRunId: "run-current", activeTurnId: "turn-current", activeLeaseToken: "lease-current",
    activeLeaseWorkerId: "worker-current", leaseExpiresAt: 123_456,
    activeCheckpointId: "checkpoint-current", conversationChannelId: "conversation-channel",
    researchLogChannelId: "research-channel", createdAt: 100, updatedAt: 200,
    ...DISCORD_PERSONALITY_PROFILE, solModel: model,
    solReasoningEffort: "ultra", solServiceTier: "flex",
  };
}

describe("owner-scoped Astra research-model metadata migration", () => {
  it("defaults new conversation profiles to Astra without changing reasoning or service tier", () => {
    expect(DISCORD_PERSONALITY_PROFILE).toMatchObject({
      lunaModel: "gpt-5.6-luna", lunaReasoningEffort: "xhigh", lunaServiceTier: "priority",
      solModel: "gpt-6-astra", solReasoningEffort: "max", solServiceTier: "priority",
    });
  });

  it("changes only exact legacy model fields for the requested owner and is idempotent", async () => {
    const db = convexMutationFixture();
    const records = [
      conversation("owner_1", "guild_1"),
      conversation("owner_1", "guild_2", "gpt-6-astra"),
      conversation("owner_1", "guild_3", "custom-research-model"),
      conversation("owner_1", "guild_4", "gpt-5.6-sol-custom"),
      conversation("owner_2", "guild_5"),
    ];
    db.rows("discordAssistantConversations").push(...records);
    const before = structuredClone(records);
    expect(await invokeMutation(migrateResearchModelToAstra, db.ctx, { actorId: "owner_1" }))
      .toEqual({ scanned: 4, updated: 1, alreadyAstra: 1, unchanged: 2 });
    expect(records).toEqual(before.map((record, index) => index === 0 ? { ...record, solModel: "gpt-6-astra" } : record));
    const after = structuredClone(records);
    expect(await invokeMutation(migrateResearchModelToAstra, db.ctx, { actorId: "owner_1" }))
      .toEqual({ scanned: 4, updated: 0, alreadyAstra: 2, unchanged: 2 });
    expect(records).toEqual(after);
    expect(db.scheduled).toHaveLength(0);
  });

  it("preserves historical research, estimator identities, events and checkpoints", async () => {
    const db = convexMutationFixture();
    db.rows("discordAssistantConversations").push(conversation("owner_1", "guild_1"));
    db.rows("discordResearchArtifacts").push({
      _id: "artifact", ownerId: "owner_1", guildId: "guild_1", workerModel: "gpt-5.6-sol",
      reasoningEffort: "max", serviceTier: "priority",
      tokenEstimatorVersion: "js-tiktoken@1.0.21:o200k_base:gpt-5.6-sol-estimate:v1",
      profileVersion: "sol-research-v1", resultPayload: "Historical research payload",
    });
    db.rows("discordConversationEvents").push({ _id: "event", ownerId: "owner_1", content: "Previous reply" });
    db.rows("discordCompactionCheckpoints").push({ _id: "checkpoint", ownerId: "owner_1", model: "gpt-5.6-luna" });
    const tables = ["discordResearchArtifacts", "discordConversationEvents", "discordCompactionCheckpoints"];
    const before = tables.map((table) => structuredClone(db.rows(table)));
    await invokeMutation(migrateResearchModelToAstra, db.ctx, { actorId: "owner_1" });
    expect(tables.map((table) => db.rows(table))).toEqual(before);
  });

  it("does not enumerate or write records for an unapproved owner", async () => {
    const db = convexMutationFixture();
    db.rows("discordAssistantConversations").push(conversation("owner_1", "guild_1"));
    const before = structuredClone(db.rows("discordAssistantConversations"));
    await expect(invokeMutation(migrateResearchModelToAstra, db.ctx, { actorId: "unapproved_owner" }))
      .rejects.toThrow("WorkOS user is not allowed.");
    expect(db.rows("discordAssistantConversations")).toEqual(before);
  });
});
