import { createHash } from "node:crypto";
import type { JsonValue } from "@earendil-works/pi-ai";

export const DISCORD_RECENT_TAIL_TARGET_TOKENS = 20_000;
export const DISCORD_MAX_CHECKPOINT_BYTES = 512 * 1_024;
export const DISCORD_CHECKPOINT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const DISCORD_COMPACTION_IMPLEMENTATION_VERSION = "portable-summary-v1";

export interface CompactionThresholdInput {
  contextWindow: number;
  maxOutputTokens: number;
  maxResearchHandoffTokens: number;
}

export function discordCompactionThreshold(input: CompactionThresholdInput) {
  const reserve = Math.max(
    32_000,
    input.maxOutputTokens + input.maxResearchHandoffTokens + 8_000,
  );
  const threshold = Math.min(
    Math.floor(input.contextWindow * 0.7),
    input.contextWindow - reserve,
  );
  if (threshold <= 0) throw new Error("The model context window cannot satisfy the compaction reserve.");
  return { reserve, threshold };
}

export interface CheckpointCompatibilityIdentity {
  ownerId: string;
  ownerBindingVersion: number;
  guildId: string;
  conversationId: string;
  epoch: number;
  provider: string;
  model: string;
  personalityVersion: string;
  systemPromptHash: string;
  capabilityProfileHash: string;
}

export function compatibleCheckpoint(
  checkpoint: CheckpointCompatibilityIdentity,
  expected: CheckpointCompatibilityIdentity,
): boolean {
  return checkpoint.ownerId === expected.ownerId
    && checkpoint.ownerBindingVersion === expected.ownerBindingVersion
    && checkpoint.guildId === expected.guildId
    && checkpoint.conversationId === expected.conversationId
    && checkpoint.epoch === expected.epoch
    && checkpoint.provider === expected.provider
    && checkpoint.model === expected.model
    && checkpoint.personalityVersion === expected.personalityVersion
    && checkpoint.systemPromptHash === expected.systemPromptHash
    && checkpoint.capabilityProfileHash === expected.capabilityProfileHash;
}

export function checkpointContextHash(value: JsonValue): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function validCheckpointSize(value: JsonValue): boolean {
  return Buffer.byteLength(JSON.stringify(value), "utf8") <= DISCORD_MAX_CHECKPOINT_BYTES;
}

export function checkpointExpired(createdAt: number, now: number): boolean {
  return createdAt + DISCORD_CHECKPOINT_RETENTION_MS <= now;
}
