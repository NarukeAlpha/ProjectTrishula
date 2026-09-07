import { createHash } from "node:crypto";
import type { JsonValue } from "@earendil-works/pi-ai";
import {
  discordPortableCheckpointResponseSchema,
  portableConversationSummarySchema,
  type DiscordPortableCheckpointRequest,
  type DiscordPortableCheckpointResponse,
} from "./contracts.js";
import { DiscordAgentOutputError } from "./errors.js";

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

type PortableSummary = ReturnType<typeof portableConversationSummarySchema.parse>;

export function portableSummarySourceEventIds(summary: PortableSummary): Set<string> {
  return new Set([
    ...summary.acceptedFacts.flatMap((entry) => entry.sourceEventIds),
    ...summary.corrections.flatMap((entry) => entry.sourceEventIds),
    ...summary.unresolvedQuestions.flatMap((entry) => entry.sourceEventIds),
    ...summary.commitments.flatMap((entry) => entry.sourceEventIds),
    ...summary.conversationPreferences.flatMap((entry) => entry.sourceEventIds),
    ...summary.sourceFreshnessNotes.flatMap((entry) => entry.sourceEventIds),
  ]);
}

function portableSummaryAuthorIds(summary: PortableSummary): Set<string> {
  const result = new Set(summary.participants.map((participant) => participant.authorId));
  for (const fact of summary.acceptedFacts) {
    if (fact.subjectAuthorId !== undefined) result.add(fact.subjectAuthorId);
    if (fact.assertedByAuthorId !== undefined) result.add(fact.assertedByAuthorId);
  }
  for (const correction of summary.corrections) {
    if (correction.correctedByAuthorId !== undefined) result.add(correction.correctedByAuthorId);
  }
  for (const question of summary.unresolvedQuestions) result.add(question.askedByAuthorId);
  for (const commitment of summary.commitments) {
    if (commitment.owner.kind === "participant") result.add(commitment.owner.authorId);
  }
  for (const preference of summary.conversationPreferences) result.add(preference.authorId);
  return result;
}

interface PortableSummaryAttribution {
  authorId: string;
  sourceEventIds: readonly string[];
}

function portableSummaryAttributions(summary: PortableSummary): PortableSummaryAttribution[] {
  const attributions: PortableSummaryAttribution[] = [];
  for (const fact of summary.acceptedFacts) {
    if (fact.assertedByAuthorId !== undefined) {
      attributions.push({
        authorId: fact.assertedByAuthorId,
        sourceEventIds: fact.sourceEventIds,
      });
    }
  }
  for (const correction of summary.corrections) {
    if (correction.correctedByAuthorId !== undefined) {
      attributions.push({
        authorId: correction.correctedByAuthorId,
        sourceEventIds: correction.sourceEventIds,
      });
    }
  }
  for (const question of summary.unresolvedQuestions) {
    attributions.push({
      authorId: question.askedByAuthorId,
      sourceEventIds: question.sourceEventIds,
    });
  }
  for (const commitment of summary.commitments) {
    if (commitment.owner.kind === "participant") {
      attributions.push({
        authorId: commitment.owner.authorId,
        sourceEventIds: commitment.sourceEventIds,
      });
    }
  }
  for (const preference of summary.conversationPreferences) {
    attributions.push({
      authorId: preference.authorId,
      sourceEventIds: preference.sourceEventIds,
    });
  }
  return attributions;
}

function portableSummaryAttributionsMatch(
  summary: PortableSummary,
  directlyAuthoredEventIds: ReadonlyMap<string, ReadonlySet<string>>,
  previousSummary?: PortableSummary,
): boolean {
  const previousAttributions = previousSummary === undefined
    ? []
    : portableSummaryAttributions(previousSummary);
  return portableSummaryAttributions(summary).every((attribution) => {
    const directlyAuthored = directlyAuthoredEventIds.get(attribution.authorId);
    if (
      directlyAuthored !== undefined
      && attribution.sourceEventIds.some((eventId) => directlyAuthored.has(eventId))
    ) return true;

    const sourceEventIds = new Set(attribution.sourceEventIds);
    return previousAttributions.some((previous) =>
      previous.authorId === attribution.authorId
      && previous.sourceEventIds.every((eventId) => sourceEventIds.has(eventId))
    );
  });
}

/**
 * Builds the only checkpoint artifact that can cross the Pi boundary. The
 * provider supplies the typed summary only. Identity and token accounting stay
 * deterministic and service-owned.
 */
export function buildPortableCheckpointResponse(
  request: DiscordPortableCheckpointRequest,
  rawSummary: JsonValue,
): DiscordPortableCheckpointResponse {
  const parsedSummary = portableConversationSummarySchema.safeParse(rawSummary);
  if (!parsedSummary.success) {
    throw new DiscordAgentOutputError("invalid_response_schema");
  }
  const summary = parsedSummary.data;
  const allowedSourceEventIds = new Set(request.sourceEvents.map((event) => event.eventId));
  if (request.previousSummary !== undefined) {
    for (const eventId of portableSummarySourceEventIds(request.previousSummary)) {
      allowedSourceEventIds.add(eventId);
    }
  }
  if ([...portableSummarySourceEventIds(summary)].some((eventId) => !allowedSourceEventIds.has(eventId))) {
    throw new DiscordAgentOutputError("invalid_response_schema");
  }

  const allowedAuthorIds = new Set(
    request.sourceEvents.flatMap((event) => event.authorId === undefined ? [] : [event.authorId]),
  );
  if (request.previousSummary !== undefined) {
    for (const authorId of portableSummaryAuthorIds(request.previousSummary)) {
      allowedAuthorIds.add(authorId);
    }
  }
  if ([...portableSummaryAuthorIds(summary)].some((authorId) => !allowedAuthorIds.has(authorId))) {
    throw new DiscordAgentOutputError("invalid_response_schema");
  }

  const directlyAuthoredEventIds = new Map<string, Set<string>>();
  for (const event of request.sourceEvents) {
    if (event.authorId === undefined) continue;
    const authoredEventIds = directlyAuthoredEventIds.get(event.authorId) ?? new Set<string>();
    authoredEventIds.add(event.eventId);
    directlyAuthoredEventIds.set(event.authorId, authoredEventIds);
  }
  if (!portableSummaryAttributionsMatch(
    summary,
    directlyAuthoredEventIds,
    request.previousSummary,
  )) {
    throw new DiscordAgentOutputError("invalid_response_schema");
  }

  const serializedBytes = Buffer.byteLength(JSON.stringify(summary), "utf8");
  if (serializedBytes > DISCORD_MAX_CHECKPOINT_BYTES) {
    throw new DiscordAgentOutputError("invalid_response_schema");
  }
  const outputEstimatedTokens = Math.ceil(serializedBytes / 3) + 8;
  return discordPortableCheckpointResponseSchema.parse({
    profile: "portable_checkpoint",
    checkpointId: request.requestId,
    portableSummary: summary,
    estimator: {
      exact: false,
      version: "utf8-bytes-div-3-plus-message-overhead:v1",
      inputEstimatedTokens: request.inputEstimatedTokens,
      outputEstimatedTokens,
      estimatedSavedTokens: request.inputEstimatedTokens - outputEstimatedTokens,
      serializedBytes,
    },
  });
}
