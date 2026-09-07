import { describe, expect, it, vi } from "vitest";
import { PortableCheckpointCoordinator } from "../src/orchestrator/portable-checkpoints.js";
import {
  portableCheckpointRequestSchema,
  portableCheckpointResponseSchema,
} from "../src/personality-contracts.js";

const request = portableCheckpointRequestSchema.parse({
  profile: "portable_checkpoint",
  requestId: "checkpoint:123:1:3:abc",
  conversation: {
    ownerId: "owner_1",
    ownerBindingVersion: 1,
    guildId: "123",
    conversationId: "discord:123",
    epoch: 1,
    generation: 2,
    routingGeneration: 1,
    revision: 3,
    personalityVersion: "trishula-discord-v1",
    systemPromptHash: "a".repeat(64),
    capabilityProfileHash: "b".repeat(64),
  },
  sourceContextHash: "c".repeat(64),
  compactedThroughOrdinal: 2,
  sourceEvents: [{
    eventId: "event:2",
    ordinal: 2,
    role: "human",
    authorId: "456",
    content: "Keep answers short.",
    createdAt: "2026-09-07T12:00:00.000Z",
  }],
  retainedRecentEventIds: ["event:3"],
  inputEstimatedTokens: 100,
});

const response = portableCheckpointResponseSchema.parse({
  profile: "portable_checkpoint",
  checkpointId: request.requestId,
  portableSummary: {
    participants: [{ authorId: "456" }],
    acceptedFacts: [],
    corrections: [],
    unresolvedQuestions: [],
    commitments: [],
    conversationPreferences: [{
      statement: "Keep answers short.",
      authorId: "456",
      sourceEventIds: ["event:2"],
    }],
    sourceFreshnessNotes: [],
  },
  estimator: {
    exact: false,
    version: "utf8-bytes-div-3-plus-message-overhead:v1",
    inputEstimatedTokens: 100,
    outputEstimatedTokens: 40,
    estimatedSavedTokens: 60,
    serializedBytes: 120,
  },
});

describe("portable checkpoint coordinator", () => {
  it("runs candidate, isolated Pi generation, and compare-and-set activation in order", async () => {
    const calls: string[] = [];
    const coordinator = new PortableCheckpointCoordinator({
      enabled: true,
      convex: {
        nextPortableCheckpoint: vi.fn(async () => {
          calls.push("candidate");
          return request;
        }),
        storePortableCheckpoint: vi.fn(async (candidate, checkpoint) => {
          calls.push("store");
          expect(candidate).toEqual(request);
          expect(checkpoint).toEqual(response);
        }),
      },
      pi: {
        portableCheckpoint: vi.fn(async (candidate) => {
          calls.push("generate");
          expect(candidate).toEqual(request);
          return response;
        }),
      },
    });
    await expect(coordinator.runOnce()).resolves.toBe(true);
    expect(calls).toEqual(["candidate", "generate", "store"]);
    await coordinator.dispose();
  });

  it("does no work while the independent rollout switch is off", async () => {
    const nextPortableCheckpoint = vi.fn(async () => request);
    const coordinator = new PortableCheckpointCoordinator({
      enabled: false,
      convex: {
        nextPortableCheckpoint,
        storePortableCheckpoint: vi.fn(),
      },
      pi: { portableCheckpoint: vi.fn() },
    });
    await expect(coordinator.runOnce()).resolves.toBe(false);
    expect(nextPortableCheckpoint).not.toHaveBeenCalled();
    await coordinator.dispose();
  });
});
