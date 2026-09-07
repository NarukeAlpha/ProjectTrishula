import { createHash } from "node:crypto";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
  Api,
  AssistantMessage,
  Model,
  ModelsSimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { DISCORD_ASSISTANT_PROFILE } from "../src/assistant/profiles.js";
import {
  discordNativeCheckpointSchema,
  type DiscordNativeCheckpoint,
  type DiscordPortableCheckpointRequest,
} from "../src/discord/contracts.js";
import {
  DISCORD_NATIVE_COMPACTION_IMPLEMENTATION_VERSION,
  DISCORD_NATIVE_COMPACTION_MAX_BYTES,
  generateNativeCompaction,
  injectNativeCheckpoint,
  nativeCompactionInput,
  NativeCompactionError,
  validateNativeReplacementHistory,
} from "../src/discord/native-compaction.js";

const model: Model<Api> = {
  id: "gpt-5.6-luna",
  name: "GPT-5.6 Luna",
  api: "openai-codex-responses",
  provider: "openai-codex",
  baseUrl: "https://chatgpt.com/backend-api",
  reasoning: true,
  thinkingLevelMap: { xhigh: "xhigh" },
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 272_000,
  maxTokens: 8_000,
};

const request: DiscordPortableCheckpointRequest = {
  profile: "portable_checkpoint",
  requestId: "checkpoint:native:1",
  conversation: {
    ownerId: "owner_1",
    ownerBindingVersion: 1,
    guildId: "123456789012345678",
    conversationId: "discord:123456789012345678",
    epoch: 2,
    generation: 3,
    routingGeneration: 4,
    revision: 9,
    personalityVersion: DISCORD_ASSISTANT_PROFILE.personalityVersion,
    systemPromptHash: DISCORD_ASSISTANT_PROFILE.systemPromptHash,
    capabilityProfileHash: DISCORD_ASSISTANT_PROFILE.capabilityProfileHash,
  },
  sourceContextHash: "a".repeat(64),
  compactedThroughOrdinal: 8,
  sourceEvents: [
    {
      eventId: "event:7",
      ordinal: 7,
      role: "assistant",
      content: "The value is 41.",
      createdAt: "2026-09-07T12:00:00.000Z",
    },
    {
      eventId: "event:8",
      ordinal: 8,
      role: "human",
      authorId: "234567890123456789",
      displayName: "Reviewer",
      content: "Correction: the value is 42. Is this still unresolved?",
      createdAt: "2026-09-07T12:01:00.000Z",
    },
  ],
  retainedRecentEventIds: ["event:9"],
  inputEstimatedTokens: 400,
};

function assistantMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-5.6-luna",
    usage: {
      input: 21,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 26,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function sseResponse(opaque = "opaque-secret"): Response {
  const events = [
    {
      type: "response.output_item.done",
      item: { type: "compaction", encrypted_content: opaque },
    },
    {
      type: "response.completed",
      response: {
        status: "completed",
        usage: { input_tokens: 21, output_tokens: 5, total_tokens: 26 },
      },
    },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function customSseResponse(events: unknown[], done = true): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")
    + (done ? "data: [DONE]\n\n" : "");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

interface RuntimeCapture {
  headers?: Record<string, string | null>;
  payload?: unknown;
}

function fakeRuntime(
  capture: RuntimeCapture,
): Pick<ModelRuntime, "completeSimple"> {
  const completeSimple: ModelRuntime["completeSimple"] = async (
    _model,
    _context,
    options?: ModelsSimpleStreamOptions,
  ) => {
    if (!options?.transformHeaders || !options.onPayload || !options.fetch) {
      throw new Error("Native compaction transport hooks were not installed.");
    }
    capture.headers = await options.transformHeaders({
      authorization: null,
      "X-Codex-Beta-Features": "existing_feature",
    });
    capture.payload = await options.onPayload({
      model: "gpt-5.6-luna",
      stream: true,
      store: true,
      previous_response_id: "must-not-survive",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "placeholder" }] }],
    }, model);
    await options.fetch(
      new Request("https://chatgpt.com/backend-api/codex/responses"),
      { method: "POST" },
    );
    return assistantMessage();
  };
  return { completeSimple };
}

function checkpointFromArtifact(
  artifact: Awaited<ReturnType<typeof generateNativeCompaction>>,
): DiscordNativeCheckpoint {
  return {
    checkpointId: request.requestId,
    ownerId: request.conversation.ownerId,
    ownerBindingVersion: request.conversation.ownerBindingVersion,
    guildId: request.conversation.guildId,
    conversationId: request.conversation.conversationId,
    epoch: request.conversation.epoch,
    compactedThroughOrdinal: request.compactedThroughOrdinal,
    sourceRevision: request.conversation.revision,
    sourceContextHash: request.sourceContextHash,
    personalityVersion: request.conversation.personalityVersion,
    systemPromptHash: request.conversation.systemPromptHash,
    capabilityProfileHash: request.conversation.capabilityProfileHash,
    artifact,
  };
}

function compatibilityIdentity(checkpoint: DiscordNativeCheckpoint) {
  return {
    checkpointId: checkpoint.checkpointId,
    ownerId: checkpoint.ownerId,
    ownerBindingVersion: checkpoint.ownerBindingVersion,
    guildId: checkpoint.guildId,
    conversationId: checkpoint.conversationId,
    epoch: checkpoint.epoch,
    compactedThroughOrdinal: checkpoint.compactedThroughOrdinal,
    sourceRevision: checkpoint.sourceRevision,
    sourceContextHash: checkpoint.sourceContextHash,
    personalityVersion: checkpoint.personalityVersion,
    systemPromptHash: checkpoint.systemPromptHash,
    capabilityProfileHash: checkpoint.capabilityProfileHash,
  };
}

describe("native Discord compaction", () => {
  it("uses the pinned Codex SSE compaction contract and handles nullable headers", async () => {
    const capture: RuntimeCapture = {};
    const upstreamFetch = vi.fn(async () => sseResponse());
    const artifact = await generateNativeCompaction({
      runtime: fakeRuntime(capture),
      model,
      request,
      instructions: "Synthetic compaction instructions.",
      fetch: upstreamFetch,
    });

    expect(capture.headers).toEqual({
      authorization: null,
      "x-codex-beta-features": "existing_feature,remote_compaction_v2",
    });
    expect(capture.payload).toMatchObject({
      model: "gpt-5.6-luna",
      stream: true,
      store: false,
      service_tier: "priority",
      reasoning: { effort: "xhigh", summary: "auto" },
    });
    expect(capture.payload).not.toHaveProperty("previous_response_id");
    expect(capture.payload).toHaveProperty("input.2.type", "compaction_trigger");
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      implementationVersion: DISCORD_NATIVE_COMPACTION_IMPLEMENTATION_VERSION,
      provider: "openai-codex",
      model: "gpt-5.6-luna",
      usage: { inputTokens: 21, outputTokens: 5, totalTokens: 26 },
      requestEvidence: {
        store: false,
        transport: "sse",
        betaFeature: "remote_compaction_v2",
        endpoint: "chatgpt-codex-responses",
      },
    });
    expect(artifact.replacementHistory.at(-1)).toEqual({
      type: "compaction",
      encrypted_content: "opaque-secret",
    });
    expect(artifact.artifactSha256).toBe(
      createHash("sha256")
        .update(JSON.stringify(artifact.replacementHistory), "utf8")
        .digest("hex"),
    );
  });

  it("round-trips a checkpoint and preserves custom context plus a trailing user message", async () => {
    const artifact = await generateNativeCompaction({
      runtime: fakeRuntime({}),
      model,
      request,
      instructions: "Synthetic compaction instructions.",
      fetch: async () => sseResponse(),
    });
    const checkpoint = checkpointFromArtifact(artifact);
    const persistedCheckpoint = discordNativeCheckpointSchema.parse(
      JSON.parse(JSON.stringify(checkpoint)),
    );
    const currentInput = [
      { type: "custom_context", data: { durable: true } },
      { type: "message", role: "user", content: [{ type: "input_text", text: "Unanswered trailing question?" }] },
    ];
    const result = injectNativeCheckpoint({
      model: "gpt-5.6-luna",
      stream: true,
      store: true,
      previous_response_id: "discard-me",
      input: currentInput,
    }, persistedCheckpoint, compatibilityIdentity(checkpoint));

    expect(result.applied).toBe(true);
    expect(result.payload).not.toHaveProperty("previous_response_id");
    expect(result.payload).toHaveProperty("store", false);
    expect(result.payload).toHaveProperty(
      `input.${artifact.replacementHistory.length}`,
      currentInput[0],
    );
    expect(result.payload).toHaveProperty(
      `input.${artifact.replacementHistory.length + 1}`,
      currentInput[1],
    );
  });

  it("uses only a fully fenced active opaque predecessor and otherwise seeds from portable memory", async () => {
    const artifact = await generateNativeCompaction({
      runtime: fakeRuntime({}),
      model,
      request,
      instructions: "Synthetic compaction instructions.",
      fetch: async () => sseResponse(),
    });
    const checkpoint = checkpointFromArtifact(artifact);
    const previousSummary = {
      participants: [],
      acceptedFacts: [],
      corrections: [],
      unresolvedQuestions: [],
      commitments: [],
      conversationPreferences: [],
      sourceFreshnessNotes: [],
    };
    const nextRequest: DiscordPortableCheckpointRequest = {
      ...request,
      requestId: "checkpoint:native:2",
      conversation: {
        ...request.conversation,
        activeCheckpointId: checkpoint.checkpointId,
        activeCheckpointCompactedThroughOrdinal: checkpoint.compactedThroughOrdinal,
        activeCheckpointSourceRevision: checkpoint.sourceRevision,
        activeCheckpointSourceContextHash: checkpoint.sourceContextHash,
      },
      previousSummary,
      previousNativeCheckpoint: checkpoint,
    };

    expect(nativeCompactionInput(nextRequest).slice(0, artifact.replacementHistory.length))
      .toEqual(artifact.replacementHistory);

    const incompatible = {
      ...checkpoint,
      ownerId: "another_owner",
    };
    const fallbackInput = nativeCompactionInput({
      ...nextRequest,
      previousNativeCheckpoint: incompatible,
    });
    expect(JSON.stringify(fallbackInput)).toContain("validatedPortableCheckpointSummary");
    expect(JSON.stringify(fallbackInput)).not.toContain("opaque-secret");

    const fallbackArtifact = await generateNativeCompaction({
      runtime: fakeRuntime({}),
      model,
      request: { ...nextRequest, previousNativeCheckpoint: incompatible },
      instructions: "Synthetic compaction instructions.",
      fetch: async () => sseResponse("portable-seeded-opaque"),
    });
    expect(JSON.stringify(fallbackArtifact.replacementHistory))
      .not.toContain("validatedPortableCheckpointSummary");

    expect(() => nativeCompactionInput({
      ...nextRequest,
      previousSummary: undefined,
      previousNativeCheckpoint: incompatible,
    })).toThrowError(new NativeCompactionError("provider_contract_incompatible"));
  });

  it("rejects incompatible or corrupt checkpoints without changing the payload", async () => {
    const artifact = await generateNativeCompaction({
      runtime: fakeRuntime({}),
      model,
      request,
      instructions: "Synthetic compaction instructions.",
      fetch: async () => sseResponse(),
    });
    const checkpoint = checkpointFromArtifact(artifact);
    const payload = { model: "gpt-5.6-luna", stream: true, store: false, input: [] };
    const corrupt = {
      ...checkpoint,
      artifact: { ...checkpoint.artifact, artifactSha256: "0".repeat(64) },
    };

    expect(injectNativeCheckpoint(payload, corrupt, compatibilityIdentity(checkpoint))).toEqual({
      payload,
      applied: false,
    });
    expect(injectNativeCheckpoint(payload, checkpoint, {
      ...compatibilityIdentity(checkpoint),
      epoch: checkpoint.epoch + 1,
    })).toEqual({ payload, applied: false });
  });

  it("accepts the exact artifact byte limit and rejects one byte more", () => {
    const emptyBytes = Buffer.byteLength(JSON.stringify([
      { type: "compaction", encrypted_content: "" },
    ]), "utf8");
    const exact = [{
      type: "compaction",
      encrypted_content: "x".repeat(DISCORD_NATIVE_COMPACTION_MAX_BYTES - emptyBytes),
    }];
    expect(Buffer.byteLength(JSON.stringify(exact), "utf8"))
      .toBe(DISCORD_NATIVE_COMPACTION_MAX_BYTES);
    expect(validateNativeReplacementHistory(exact)).toEqual(exact);
    expect(() => validateNativeReplacementHistory([{
      type: "compaction",
      encrypted_content: `${exact[0]!.encrypted_content}x`,
    }])).toThrowError(new NativeCompactionError("artifact_oversize"));
  });

  it("does not leak provider response text through adapter errors", async () => {
    const secret = "provider-secret-that-must-not-leak";
    await expect(generateNativeCompaction({
      runtime: fakeRuntime({}),
      model,
      request,
      instructions: "Synthetic compaction instructions.",
      fetch: async () => new Response(secret, { status: 500 }),
    })).rejects.toThrow("provider_contract_incompatible");
    try {
      await generateNativeCompaction({
        runtime: fakeRuntime({}),
        model,
        request,
        instructions: "Synthetic compaction instructions.",
        fetch: async () => new Response(secret, { status: 500 }),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(NativeCompactionError);
      expect(error).toHaveProperty("code", "provider_contract_incompatible");
      expect(error).not.toHaveProperty("message", expect.stringContaining(secret));
    }
  });

  it("accepts the runtime response.done alias only with linked output and exact usage", async () => {
    const compaction = {
      id: "item_1",
      type: "compaction",
      opaque_payload: { providerOwned: true },
    };
    const response = customSseResponse([
      { type: "response.created", response: { id: "response_1" } },
      {
        type: "response.output_item.done",
        response_id: "response_1",
        output_index: 0,
        item: compaction,
      },
      {
        type: "response.done",
        response: {
          id: "response_1",
          status: "completed",
          output: [compaction],
          usage: { input_tokens: 21, output_tokens: 5, total_tokens: 26 },
        },
      },
    ]);

    await expect(generateNativeCompaction({
      runtime: fakeRuntime({}),
      model,
      request,
      instructions: "Synthetic compaction instructions.",
      fetch: async () => response,
    })).resolves.toMatchObject({
      replacementHistory: expect.arrayContaining([compaction]),
      usage: { inputTokens: 21, outputTokens: 5, totalTokens: 26 },
    });
  });

  it.each([
    ["missing completed status", [
      { type: "response.output_item.done", item: { type: "compaction", encrypted_content: "opaque" } },
      { type: "response.completed", response: { usage: { input_tokens: 21, output_tokens: 5, total_tokens: 26 } } },
    ]],
    ["inconsistent usage", [
      { type: "response.output_item.done", item: { type: "compaction", encrypted_content: "opaque" } },
      { type: "response.completed", response: { status: "completed", usage: { input_tokens: 21, output_tokens: 5, total_tokens: 27 } } },
    ]],
    ["terminal before output", [
      { type: "response.completed", response: { status: "completed", usage: { input_tokens: 21, output_tokens: 5, total_tokens: 26 } } },
      { type: "response.output_item.done", item: { type: "compaction", encrypted_content: "opaque" } },
    ]],
    ["unsupported output item", [
      { type: "response.output_item.done", item: { type: "message", role: "assistant", content: [] } },
      { type: "response.completed", response: { status: "completed", usage: { input_tokens: 21, output_tokens: 5, total_tokens: 26 } } },
    ]],
    ["mismatched terminal output", [
      { type: "response.output_item.done", output_index: 0, item: { id: "item_1", type: "compaction", encrypted_content: "opaque" } },
      {
        type: "response.completed",
        response: {
          status: "completed",
          output: [{ id: "item_2", type: "compaction", encrypted_content: "other" }],
          usage: { input_tokens: 21, output_tokens: 5, total_tokens: 26 },
        },
      },
    ]],
    ["malformed terminal followed by a valid terminal", [
      { type: "response.output_item.done", item: { type: "compaction", opaque: "value" } },
      { type: "response.completed", response: { status: "incomplete" } },
      { type: "response.completed", response: { status: "completed", usage: { input_tokens: 21, output_tokens: 5, total_tokens: 26 } } },
    ]],
    ["malformed output followed by a valid output", [
      { type: "response.output_item.done" },
      { type: "response.output_item.done", item: { type: "compaction", opaque: "value" } },
      { type: "response.completed", response: { status: "completed", usage: { input_tokens: 21, output_tokens: 5, total_tokens: 26 } } },
    ]],
    ["created response without an output response ID", [
      { type: "response.created", response: { id: "response_1" } },
      { type: "response.output_item.done", item: { type: "compaction", opaque: "value" } },
      { type: "response.completed", response: { id: "response_1", status: "completed", usage: { input_tokens: 21, output_tokens: 5, total_tokens: 26 } } },
    ]],
    ["created response without a terminal response ID", [
      { type: "response.created", response: { id: "response_1" } },
      { type: "response.output_item.done", response_id: "response_1", item: { type: "compaction", opaque: "value" } },
      { type: "response.completed", response: { status: "completed", usage: { input_tokens: 21, output_tokens: 5, total_tokens: 26 } } },
    ]],
  ])("rejects %s in the native SSE state machine", async (_scenario, events) => {
    await expect(generateNativeCompaction({
      runtime: fakeRuntime({}),
      model,
      request,
      instructions: "Synthetic compaction instructions.",
      fetch: async () => customSseResponse(events),
    })).rejects.toBeInstanceOf(NativeCompactionError);
  });

  it("settles an early cloned response-stream failure without leaking its cause", async () => {
    const secret = "early-clone-secret-that-must-not-leak";
    const failingResponse = () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error(secret));
      },
    }), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    try {
      await generateNativeCompaction({
        runtime: fakeRuntime({}),
        model,
        request,
        instructions: "Synthetic compaction instructions.",
        fetch: async () => failingResponse(),
      });
      throw new Error("Expected the failing response stream to reject.");
    } catch (error) {
      expect(error).toBeInstanceOf(NativeCompactionError);
      expect(error).toHaveProperty("code", "response_invalid");
      expect(error).not.toHaveProperty("message", expect.stringContaining(secret));
    }
  });
});
