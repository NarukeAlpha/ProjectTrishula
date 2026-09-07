import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  composeDurableConversationContext,
  type DurableConversationContext,
} from "../src/assistant/context.js";
import { inspectPersonalitySurface } from "../src/assistant/naturalness.js";
import { normalizeFrontmanPlan } from "../src/discord/runner.js";
import {
  discordFrontmanPlanRequestSchema,
  discordFrontmanPlanResponseSchema,
} from "../src/discord/contracts.js";

interface ShadowFixture {
  fixtureVersion: string;
  profile: { luna: string[]; sol: string[] };
  routing: Array<{
    id: string;
    triggerKind: "ambient" | "mention";
    candidateAction: "silent" | "reply";
    confidence: number;
    additiveValue: number;
    expectedAction: "silent" | "reply";
  }>;
  naturalness: Array<{
    id: string;
    text: string;
    expectedViolations: string[];
  }>;
}

interface ShadowPlanCandidate {
  profile: "frontman_plan";
  action: "silent" | "reply";
  targetMessageId: string;
  confidence: number;
  additiveValue: number;
  reasonCode: "ambient_low_value" | "ambient_material_value";
  reply?: string;
}

// SAFETY: The committed fixture is exercised field by field below and cannot cross a runtime boundary.
const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/personality/shadow-v1.json", import.meta.url),
  "utf8",
)) as ShadowFixture;
const guildId = "323456789012345678";
const targetMessageId = "123456789012345678";

describe("deterministic personality shadow harness", () => {
  it("replays routing fixtures three times without provider auth or Discord delivery", () => {
    expect(fixture.fixtureVersion).toBe("personality-shadow-v1");
    expect(fixture.profile).toEqual({
      luna: ["gpt-5.6-luna", "xhigh", "priority"],
      sol: ["gpt-5.6-sol", "max", "priority"],
    });
    for (let pass = 0; pass < 3; pass += 1) {
      for (const scenario of fixture.routing) {
        const request = discordFrontmanPlanRequestSchema.parse({
          profile: "frontman_plan",
          requestId: `${scenario.id}:${pass}`,
          triggerKind: scenario.triggerKind,
          channel: { guildId, channelId: "423456789012345678", channelName: "markets" },
          messages: [{
            messageId: targetMessageId,
            sequence: 1,
            authorId: "223456789012345678",
            authorName: "Mira",
            content: "What changed?",
            createdAt: "2026-09-07T12:00:00.000Z",
            isBot: false,
          }],
          conversation: {
            ownerId: "owner_1",
            ownerBindingVersion: 1,
            guildId,
            conversationId: `discord:${guildId}`,
            epoch: 1,
            turnId: `turn_${pass}`,
            runId: `run_${pass}`,
            generation: 1,
            routingGeneration: 1,
            revision: 1,
            humanRevision: 1,
            personalityVersion: "trishula-discord-v1",
            systemPromptHash: "a".repeat(64),
            capabilityProfileHash: "b".repeat(64),
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
        });
        const candidateInput: ShadowPlanCandidate = {
          profile: "frontman_plan",
          action: scenario.candidateAction,
          targetMessageId,
          confidence: scenario.confidence,
          additiveValue: scenario.additiveValue,
          reasonCode: scenario.candidateAction === "silent"
            ? "ambient_low_value"
            : "ambient_material_value",
        };
        if (scenario.candidateAction === "reply") {
          candidateInput.reply = "The verified part is clear.";
        }
        const candidate = discordFrontmanPlanResponseSchema.parse(candidateInput);
        expect(normalizeFrontmanPlan(candidate, request).action, scenario.id)
          .toBe(scenario.expectedAction);
      }
    }
  });

  it("runs deterministic naturalness surface gates while leaving rubric scoring to blind review", () => {
    for (const scenario of fixture.naturalness) {
      expect(inspectPersonalitySurface(scenario.text), scenario.id)
        .toEqual(scenario.expectedViolations);
    }
  });

  it("reconstructs correction, attribution, question, and freshness after a synthetic restart", () => {
    const opaqueMarker = "opaque-native-artifact-must-not-enter-readable-context";
    const durableContext: DurableConversationContext & {
      activeCheckpointSourceContextHash: string;
      nativeCheckpoint: unknown;
    } = {
      sourceRevision: 8,
      sourceHumanRevision: 5,
      activeCheckpointId: "checkpoint:restart",
      activeCheckpointSourceContextHash: "c".repeat(64),
      nativeCheckpoint: {
        replacementHistory: [{ type: "compaction", encrypted_content: opaqueMarker }],
      },
      portableSummary: {
        participants: [{ authorId: "223456789012345678", displayName: "Mira" }],
        acceptedFacts: [{
          statement: "The corrected value is 42.",
          assertedByAuthorId: "223456789012345678",
          sourceEventIds: ["event:2"],
        }],
        corrections: [{
          rejectedStatement: "The value is 41.",
          replacementStatement: "The value is 42.",
          correctedByAuthorId: "223456789012345678",
          sourceEventIds: ["event:1", "event:2"],
        }],
        unresolvedQuestions: [{
          question: "Did guidance change?",
          askedByAuthorId: "223456789012345678",
          sourceEventIds: ["event:3"],
        }],
        commitments: [],
        conversationPreferences: [],
        sourceFreshnessNotes: [{
          statement: "The quote was regular-session only.",
          sourceEventIds: ["event:4"],
          freshness: "limited",
        }],
      },
      recentEvents: [{
        eventId: "event:5",
        ordinal: 5,
        role: "human",
        authorId: "223456789012345678",
        content: "Use the corrected value.",
        createdAt: "2026-09-07T12:05:00.000Z",
      }],
      tail: {
        estimatorVersion: "utf8-bytes-div-3-plus-message-overhead:v1",
        tokenBudget: 20_000,
        estimatedTokens: 20,
        compactedThroughOrdinal: 4,
        omittedEventCount: 0,
        complete: true,
      },
    };
    const restored = composeDurableConversationContext(durableContext);
    expect(restored).toContain("The corrected value is 42.");
    expect(restored).toContain("Mira");
    expect(restored).toContain("Did guidance change?");
    expect(restored).toContain("limited");
    expect(restored).toContain("Use the corrected value.");
    expect(restored).not.toContain(opaqueMarker);
    expect(restored).not.toContain("activeCheckpointSourceContextHash");
  });
});
