import { stdout } from "node:process";
import { DISCORD_ASSISTANT_PROFILE } from "../assistant/profiles.js";
import { inspectPersonalitySurface } from "../assistant/naturalness.js";
import { loadConfig } from "../config.js";
import { createDiscordAgentRunner } from "../discord/runner.js";
import type {
  DiscordFrontmanPlanRequest,
  DiscordPortableCheckpointRequest,
} from "../discord/contracts.js";
import { createCodexRuntime } from "../pi/codex-runtime.js";

type ProbeMode = "naturalness" | "checkpoint" | "all";

const SYNTHETIC_GUILD_ID = "999999999999999991";
const SYNTHETIC_CHANNEL_ID = "999999999999999992";
const SYNTHETIC_AUTHOR_ID = "999999999999999993";

function probeMode(environment: NodeJS.ProcessEnv): ProbeMode {
  const value = environment.PERSONALITY_PROBE_MODE?.trim() || "all";
  if (value === "naturalness" || value === "checkpoint" || value === "all") return value;
  throw new Error("PERSONALITY_PROBE_MODE must be naturalness, checkpoint, or all.");
}

function probeRepetitions(environment: NodeJS.ProcessEnv): number {
  const value = Number(environment.PERSONALITY_PROBE_REPETITIONS ?? "3");
  if (!Number.isSafeInteger(value) || value < 1 || value > 5) {
    throw new Error("PERSONALITY_PROBE_REPETITIONS must be an integer from 1 through 5.");
  }
  return value;
}

function syntheticPlanRequest(
  actorId: string,
  requestId: string,
  content: string,
): DiscordFrontmanPlanRequest {
  return {
    profile: "frontman_plan",
    requestId,
    triggerKind: "mention",
    channel: {
      guildId: SYNTHETIC_GUILD_ID,
      channelId: SYNTHETIC_CHANNEL_ID,
      channelName: "synthetic-personality-probe",
    },
    messages: [{
      messageId: "999999999999999994",
      sequence: 1,
      authorId: SYNTHETIC_AUTHOR_ID,
      authorName: "Synthetic Reviewer",
      content,
      mentionsBot: true,
      createdAt: "2026-09-07T12:00:00.000Z",
      isBot: false,
    }],
    conversation: {
      ownerId: actorId,
      ownerBindingVersion: 1,
      guildId: SYNTHETIC_GUILD_ID,
      conversationId: `discord:${SYNTHETIC_GUILD_ID}`,
      epoch: 1,
      turnId: `turn:${requestId}`,
      runId: `run:${requestId}`,
      generation: 1,
      routingGeneration: 1,
      revision: 1,
      humanRevision: 1,
      personalityVersion: DISCORD_ASSISTANT_PROFILE.personalityVersion,
      systemPromptHash: DISCORD_ASSISTANT_PROFILE.systemPromptHash,
      capabilityProfileHash: DISCORD_ASSISTANT_PROFILE.capabilityProfileHash,
    },
    durableContext: {
      sourceRevision: 1,
      sourceHumanRevision: 1,
      recentEvents: [],
      tail: {
        estimatorVersion: "utf8-bytes-div-3-plus-message-overhead:v1",
        tokenBudget: 190_400,
        estimatedTokens: 0,
        compactedThroughOrdinal: 0,
        omittedEventCount: 0,
        complete: true,
      },
    },
  };
}

function syntheticCheckpointRequest(actorId: string): DiscordPortableCheckpointRequest {
  return {
    profile: "portable_checkpoint",
    requestId: "checkpoint:synthetic:1",
    conversation: {
      ownerId: actorId,
      ownerBindingVersion: 1,
      guildId: SYNTHETIC_GUILD_ID,
      conversationId: `discord:${SYNTHETIC_GUILD_ID}`,
      epoch: 1,
      generation: 1,
      routingGeneration: 1,
      revision: 2,
      personalityVersion: DISCORD_ASSISTANT_PROFILE.personalityVersion,
      systemPromptHash: DISCORD_ASSISTANT_PROFILE.systemPromptHash,
      capabilityProfileHash: DISCORD_ASSISTANT_PROFILE.capabilityProfileHash,
    },
    sourceContextHash: "a".repeat(64),
    compactedThroughOrdinal: 2,
    sourceEvents: [{
      eventId: "event:synthetic:2",
      ordinal: 2,
      role: "human",
      authorId: SYNTHETIC_AUTHOR_ID,
      displayName: "Synthetic Reviewer",
      content: "I prefer concise answers. The value is 42, not 41. Did guidance change?",
      createdAt: "2026-09-07T12:00:00.000Z",
      freshness: "limited",
    }],
    retainedRecentEventIds: ["event:synthetic:3"],
    inputEstimatedTokens: 100,
  };
}

export async function runPersonalityProbe(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const config = loadConfig(environment);
  const mode = probeMode(environment);
  const repetitions = probeRepetitions(environment);
  const runtime = createCodexRuntime(config.piAuthPath);
  const runner = createDiscordAgentRunner(runtime, config);
  await runner.initialize();
  try {
    const report: Array<Record<string, string | number | boolean | string[]>> = [];
    if (mode === "naturalness" || mode === "all") {
      const fixtures = [
        ["simple", "Explain market capitalization in one short paragraph."],
        ["informal", "Quick one: what's dilution, in plain English?"],
        ["correction", "You mixed up market capitalization and revenue. Correct it directly."],
      ] as const;
      for (let pass = 1; pass <= repetitions; pass += 1) {
        for (const [fixtureId, content] of fixtures) {
          const result = await runner.run(syntheticPlanRequest(
            config.boundActorId ?? "synthetic_owner",
            `probe:${fixtureId}:${pass}`,
            content,
          ));
          if (result.profile !== "frontman_plan" || result.action !== "reply" || result.reply === undefined) {
            throw new Error(`Naturalness fixture ${fixtureId} pass ${pass} did not produce a direct reply.`);
          }
          const violations = inspectPersonalitySurface(result.reply);
          if (violations.length > 0) {
            throw new Error(`Naturalness fixture ${fixtureId} pass ${pass} failed: ${violations.join(",")}.`);
          }
          report.push({
            kind: "naturalness",
            fixtureId,
            pass,
            action: result.action,
            characters: Array.from(result.reply).length,
            violations,
            reply: result.reply,
          });
        }
      }
    }
    if (mode === "checkpoint" || mode === "all") {
      if (!config.trishulaPortableCheckpointsEnabled) {
        throw new Error("Set TRISHULA_PORTABLE_CHECKPOINTS_ENABLED=true for the isolated checkpoint probe process.");
      }
      const result = await runner.run(syntheticCheckpointRequest(
        config.boundActorId ?? "synthetic_owner",
      ));
      if (result.profile !== "portable_checkpoint") {
        throw new Error("The checkpoint probe returned the wrong profile.");
      }
      report.push({
        kind: "checkpoint",
        checkpointId: result.checkpointId,
        inputEstimatedTokens: result.estimator.inputEstimatedTokens,
        outputEstimatedTokens: result.estimator.outputEstimatedTokens,
        estimatedSavedTokens: result.estimator.estimatedSavedTokens,
        serializedBytes: result.estimator.serializedBytes,
        sourceReferenceCount: new Set([
          ...result.portableSummary.acceptedFacts.flatMap((entry) => entry.sourceEventIds),
          ...result.portableSummary.corrections.flatMap((entry) => entry.sourceEventIds),
          ...result.portableSummary.unresolvedQuestions.flatMap((entry) => entry.sourceEventIds),
          ...result.portableSummary.commitments.flatMap((entry) => entry.sourceEventIds),
          ...result.portableSummary.conversationPreferences.flatMap((entry) => entry.sourceEventIds),
          ...result.portableSummary.sourceFreshnessNotes.flatMap((entry) => entry.sourceEventIds),
        ]).size,
      });
    }
    stdout.write(`${JSON.stringify({
      ok: true,
      mode,
      repetitions,
      modelProfiles: {
        luna: [config.trishulaLunaModel, config.trishulaLunaReasoningEffort, config.trishulaLunaServiceTier],
        sol: [config.trishulaSolModel, config.trishulaSolReasoningEffort, config.trishulaSolServiceTier],
      },
      report,
    }, null, 2)}\n`);
  } finally {
    await runner.dispose();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPersonalityProbe().catch((error) => {
    stdout.write(`${error instanceof Error ? error.message : "Personality probe failed."}\n`);
    process.exitCode = 1;
  });
}
