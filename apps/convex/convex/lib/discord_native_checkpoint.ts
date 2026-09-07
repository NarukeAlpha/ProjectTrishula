import { v, type Infer } from "convex/values";
import { z } from "zod";
import { sha256Hex } from "./canonical_json.js";
import { DISCORD_PORTABLE_CHECKPOINT_MAX_BYTES } from "./discord_conversation.js";

const implementationVersion = "responses-compaction-v2-pi-0_84_1-v1";
const userMessage = z.object({
  type: z.literal("message"),
  role: z.literal("user"),
  content: z.array(z.object({
    type: z.literal("input_text"), text: z.string().min(1).max(16_384),
  }).strict()).min(1).max(4),
}).strict();
const compactionItem = z.object({ type: z.literal("compaction") }).catchall(z.json());
const replacementHistory = z.array(z.json()).min(1).max(2_001).superRefine((items, context) => {
  for (const [index, item] of items.entries()) {
    if (!(index === items.length - 1 ? compactionItem : userMessage).safeParse(item).success) {
      context.addIssue({ code: "custom", path: [index], message: "Only user messages followed by one final compaction item are allowed." });
    }
  }
});
const tokens = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const nativeCompactionArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  implementationVersion: z.literal(implementationVersion),
  provider: z.literal("openai-codex"),
  model: z.literal("gpt-5.6-luna"),
  replacementHistory,
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  serializedBytes: z.number().int().positive().max(DISCORD_PORTABLE_CHECKPOINT_MAX_BYTES),
  usage: z.object({ inputTokens: tokens, outputTokens: tokens, totalTokens: tokens }).strict(),
  requestEvidence: z.object({
    store: z.literal(false), transport: z.literal("sse"), betaFeature: z.literal("remote_compaction_v2"),
    endpoint: z.literal("chatgpt-codex-responses"),
  }).strict(),
}).strict();
export type NativeCompactionArtifact = z.infer<typeof nativeCompactionArtifactSchema>;

export const storedNativeCompactionValidator = v.object({
  schemaVersion: v.literal(1),
  implementationVersion: v.literal(implementationVersion),
  provider: v.literal("openai-codex"),
  model: v.literal("gpt-5.6-luna"),
  replacementHistoryJson: v.string(),
  artifactSha256: v.string(),
  serializedBytes: v.number(),
  usage: v.object({ inputTokens: v.number(), outputTokens: v.number(), totalTokens: v.number() }),
  requestEvidence: v.object({
    store: v.literal(false), transport: v.literal("sse"), betaFeature: v.literal("remote_compaction_v2"),
    endpoint: v.literal("chatgpt-codex-responses"),
  }),
});
export type StoredNativeCompaction = Infer<typeof storedNativeCompactionValidator>;

export interface NativeCheckpointView {
  checkpointId: string;
  ownerId: string;
  ownerBindingVersion: number;
  guildId: string;
  conversationId: string;
  epoch: number;
  sourceRevision: number;
  sourceContextHash: string;
  compactedThroughOrdinal: number;
  personalityVersion: string;
  systemPromptHash: string;
  capabilityProfileHash: string;
  artifact: NativeCompactionArtifact;
}

export function checkpointUtf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export async function validateNativeCompaction(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This strict parser is the I/O boundary for optional untrusted native artifacts.
  value: unknown,
  portableSummary: string,
): Promise<StoredNativeCompaction> {
  const artifact = nativeCompactionArtifactSchema.parse(value);
  const { replacementHistory: history, ...metadata } = artifact;
  const replacementHistoryJson = JSON.stringify(history);
  const actualBytes = checkpointUtf8Bytes(replacementHistoryJson);
  if (
    actualBytes !== artifact.serializedBytes
    || actualBytes + checkpointUtf8Bytes(portableSummary) > DISCORD_PORTABLE_CHECKPOINT_MAX_BYTES
    || await sha256Hex(replacementHistoryJson) !== artifact.artifactSha256
  ) throw new Error("Native checkpoint size or integrity check failed.");
  return { ...metadata, replacementHistoryJson };
}

export async function restoreNativeCompaction(
  stored: StoredNativeCompaction,
  portableSummary: string,
): Promise<NativeCompactionArtifact> {
  const { replacementHistoryJson, ...metadata } = stored;
  const artifact = nativeCompactionArtifactSchema.parse({
    ...metadata, replacementHistory: JSON.parse(replacementHistoryJson),
  });
  await validateNativeCompaction(artifact, portableSummary);
  return artifact;
}

export function nativeCheckpointView(
  checkpoint: Omit<NativeCheckpointView, "artifact">,
  artifact: NativeCompactionArtifact,
): NativeCheckpointView {
  return {
    checkpointId: checkpoint.checkpointId,
    ownerId: checkpoint.ownerId,
    ownerBindingVersion: checkpoint.ownerBindingVersion,
    guildId: checkpoint.guildId,
    conversationId: checkpoint.conversationId,
    epoch: checkpoint.epoch,
    sourceRevision: checkpoint.sourceRevision,
    sourceContextHash: checkpoint.sourceContextHash,
    compactedThroughOrdinal: checkpoint.compactedThroughOrdinal,
    personalityVersion: checkpoint.personalityVersion,
    systemPromptHash: checkpoint.systemPromptHash,
    capabilityProfileHash: checkpoint.capabilityProfileHash,
    artifact,
  };
}
