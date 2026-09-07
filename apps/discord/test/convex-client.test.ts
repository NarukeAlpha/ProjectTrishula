import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscordGatewayConfig } from "../src/config.js";
import {
  ConvexDiscordClient,
  type RunIdentity,
} from "../src/convex/client.js";
import type {
  PortableCheckpointRequest,
  PortableCheckpointResponse,
} from "../src/personality-contracts.js";

const config: DiscordGatewayConfig = {
  environment: "test",
  host: "127.0.0.1",
  port: 8_080,
  discordBotToken: undefined,
  chartImgApiKey: undefined,
  discordOwnerId: "owner-1",
  convexSharedSecret: "c".repeat(32),
  piSharedSecret: "p".repeat(32),
  convexSiteUrl: "https://convex.example/http",
  piServiceUrl: "https://pi.example",
  loopPollIntervalMs: 5_000,
  outboxPollIntervalMs: 2_000,
  channelSyncIntervalMs: 300_000,
  leaseHeartbeatIntervalMs: 30_000,
  requestTimeoutMs: 30_000,
  agentTimeoutMs: 600_000,
  maxReconcileMessages: 500,
  durableConversationsEnabled: true,
  marketResearchEnabled: false,
  marketResearchChartsEnabled: false,
  marketResearchPollIntervalMs: 5_000,
  portableCheckpointsEnabled: false,
};

const run: RunIdentity = {
  guildId: "guild-1",
  channelId: "channel-1",
  runId: "run-1",
  generation: 2,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Convex Discord heartbeats", () => {
  it("negotiates durable responses and sends only strict nested run fields", async () => {
    const requests: unknown[] = [];
    const protocolHeaders: Array<string | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const request: unknown = JSON.parse(String(init?.body));
        requests.push(request);
        protocolHeaders.push(new Headers(init?.headers).get("x-trishula-discord-protocol"));
        return new Response(
          JSON.stringify({
            ok: true,
            operation: "heartbeat",
            result: { gatewayAccepted: true, loopAccepted: true },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }),
    );

    const client = new ConvexDiscordClient(config, "discord-instance-1");
    await expect(client.heartbeatRun(run, "acknowledging")).resolves.toBe(
      true,
    );
    await expect(client.renewRunLease(run)).resolves.toBe(true);

    expect(requests).toEqual([
      {
        operation: "heartbeat",
        actorId: "owner-1",
        instanceId: "discord-instance-1",
        status: "online",
        run: {
          channelId: "channel-1",
          runId: "run-1",
          generation: 2,
          stage: "acknowledging",
        },
      },
      {
        operation: "heartbeat",
        actorId: "owner-1",
        instanceId: "discord-instance-1",
        status: "online",
        run: {
          channelId: "channel-1",
          runId: "run-1",
          generation: 2,
        },
      },
    ]);
    expect(protocolHeaders).toEqual(["native-v2", "native-v2"]);
  });
});

describe("Convex portable checkpoints", () => {
  it("forwards a validated opaque artifact only on the durable protocol", async () => {
    let body: unknown;
    let protocol: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        // SAFETY: The client serializes this request body as JSON immediately before fetch.
        body = JSON.parse(String(init?.body)) as unknown;
        protocol = new Headers(init?.headers).get("x-trishula-discord-protocol");
        return new Response(JSON.stringify({
          ok: true,
          operation: "storePortableCheckpoint",
          result: {
            accepted: true,
            duplicate: false,
            checkpointId: "checkpoint:native:1",
            status: "active",
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const request: PortableCheckpointRequest = {
      profile: "portable_checkpoint",
      requestId: "checkpoint:native:1",
      conversation: {
        ownerId: "owner-1",
        ownerBindingVersion: 1,
        guildId: "123456789012345678",
        conversationId: "discord:123456789012345678",
        epoch: 1,
        generation: 2,
        routingGeneration: 3,
        revision: 4,
        personalityVersion: "trishula-discord-v1",
        systemPromptHash: "a".repeat(64),
        capabilityProfileHash: "b".repeat(64),
      },
      sourceContextHash: "c".repeat(64),
      compactedThroughOrdinal: 3,
      sourceEvents: [{
        eventId: "event:3",
        ordinal: 3,
        role: "human",
        authorId: "234567890123456789",
        content: "Keep the correction.",
        createdAt: "2026-09-07T12:00:00.000Z",
      }],
      retainedRecentEventIds: ["event:4"],
      inputEstimatedTokens: 100,
    };
    const response: PortableCheckpointResponse = {
      profile: "portable_checkpoint",
      checkpointId: request.requestId,
      portableSummary: {
        participants: [{ authorId: "234567890123456789" }],
        acceptedFacts: [],
        corrections: [],
        unresolvedQuestions: [],
        commitments: [],
        conversationPreferences: [],
        sourceFreshnessNotes: [],
      },
      estimator: {
        exact: false,
        version: "utf8-bytes-div-3-plus-message-overhead:v1",
        inputEstimatedTokens: 100,
        outputEstimatedTokens: 20,
        estimatedSavedTokens: 80,
        serializedBytes: 100,
      },
      nativeCompaction: {
        schemaVersion: 1,
        implementationVersion: "responses-compaction-v2-pi-0_84_1-v1",
        provider: "openai-codex",
        model: "gpt-5.6-luna",
        replacementHistory: [{ type: "compaction", encrypted_content: "opaque" }],
        artifactSha256: "d".repeat(64),
        serializedBytes: 52,
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        requestEvidence: {
          store: false,
          transport: "sse",
          betaFeature: "remote_compaction_v2",
          endpoint: "chatgpt-codex-responses",
        },
      },
    };

    const client = new ConvexDiscordClient(config, "discord-instance-1");
    await expect(client.storePortableCheckpoint(request, response)).resolves.toBeUndefined();
    expect(protocol).toBe("native-v2");
    expect(body).toMatchObject({
      operation: "storePortableCheckpoint",
      nativeCompaction: response.nativeCompaction,
    });
  });

  it("invalidates rejected opaque state with the exact native-v2 fence", async () => {
    let body: unknown;
    let protocol: string | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      // SAFETY: The client serializes this request body as JSON immediately before fetch.
      body = JSON.parse(String(init?.body)) as unknown;
      protocol = new Headers(init?.headers).get("x-trishula-discord-protocol");
      return new Response(JSON.stringify({
        ok: true,
        operation: "invalidateNativeCheckpoint",
        result: { accepted: true, invalidated: true },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const client = new ConvexDiscordClient(config, "discord-instance-1");
    await expect(client.invalidateNativeCheckpoint({
      guildId: "123456789012345678",
      conversationId: "discord:123456789012345678",
      checkpointId: "checkpoint:native:1",
      epoch: 1,
      ownerBindingVersion: 2,
      revision: 10,
      generation: 3,
      routingGeneration: 4,
    })).resolves.toBeUndefined();

    expect(protocol).toBe("native-v2");
    expect(body).toEqual({
      operation: "invalidateNativeCheckpoint",
      actorId: "owner-1",
      guildId: "123456789012345678",
      conversationId: "discord:123456789012345678",
      checkpointId: "checkpoint:native:1",
      epoch: 1,
      expectedOwnerBindingVersion: 2,
      expectedRevision: 10,
      expectedGeneration: 3,
      expectedRoutingGeneration: 4,
    });
  });
});
