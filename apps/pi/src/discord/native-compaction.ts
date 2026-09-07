import { createHash } from "node:crypto";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
  Api,
  JsonValue,
  Model,
  ModelsSimpleStreamOptions,
  ProviderHeaders,
} from "@earendil-works/pi-ai";
import { z } from "zod";
import {
  discordNativeCompactionArtifactSchema,
  discordNativeCheckpointSchema,
  discordNativeReplacementHistorySchema,
  type DiscordNativeCompactionArtifact,
  type DiscordNativeCheckpoint,
  type DiscordPortableCheckpointRequest,
} from "./contracts.js";

export const DISCORD_NATIVE_COMPACTION_IMPLEMENTATION_VERSION =
  "responses-compaction-v2-pi-0_84_1-v1";
export const DISCORD_NATIVE_COMPACTION_LIVE_PROBE_ATTESTATION =
  "responses-compaction-v2-pi-0_84_1-live-2026-09-07";
export const DISCORD_NATIVE_COMPACTION_MAX_BYTES = 512 * 1_024;
const DISCORD_NATIVE_COMPACTION_SSE_MAX_BYTES =
  DISCORD_NATIVE_COMPACTION_MAX_BYTES * 2 + 128 * 1_024;
const DISCORD_NATIVE_RETAINED_USER_TOKEN_BUDGET = 20_000;
const DISCORD_NATIVE_RETAINED_USER_LIMIT = 2_000;
const REMOTE_COMPACTION_BETA_FEATURE = "remote_compaction_v2";

const providerPayloadSchema = z.object({
  model: z.string(),
  store: z.boolean(),
  stream: z.literal(true),
  input: z.array(z.json()),
}).catchall(z.json());

const sseEventSchema = z.object({ type: z.string() }).passthrough();
const outputItemEventSchema = z.object({
  type: z.literal("response.output_item.done"),
  item: z.json(),
}).passthrough();
const completedEventSchema = z.object({
  type: z.literal("response.completed"),
  response: z.object({
    usage: z.object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    }).passthrough().optional(),
  }).passthrough(),
}).passthrough();
const failedEventSchema = z.object({
  type: z.enum(["error", "response.failed", "response.incomplete"]),
}).passthrough();
const retainedUserMessageSchema = z.object({
  type: z.literal("message"),
  role: z.literal("user"),
  content: z.array(z.object({
    type: z.literal("input_text"),
    text: z.string().min(1).max(16_384),
  }).strict()).min(1).max(4),
}).strict();
const compactionItemSchema = z.object({
  type: z.literal("compaction"),
}).passthrough();

export type NativeCompactionErrorCode =
  | "aborted"
  | "artifact_oversize"
  | "endpoint_incompatible"
  | "provider_contract_incompatible"
  | "provider_request_failed"
  | "response_incomplete"
  | "response_invalid";

export class NativeCompactionError extends Error {
  constructor(readonly code: NativeCompactionErrorCode) {
    super(`Native Discord compaction failed: ${code}.`);
    this.name = "NativeCompactionError";
  }
}

export interface NativeCheckpointCompatibilityIdentity {
  checkpointId: string;
  ownerId: string;
  ownerBindingVersion: number;
  guildId: string;
  conversationId: string;
  epoch: number;
  sourceRevision: number;
  personalityVersion: string;
  systemPromptHash: string;
  capabilityProfileHash: string;
}

export function withNativeCompactionFeature(
  headers: ProviderHeaders,
): ProviderHeaders {
  const result: ProviderHeaders = {};
  const features: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== "x-codex-beta-features") {
      result[name] = value;
      continue;
    }
    if (value !== null) {
      features.push(...value.split(",").map((feature) => feature.trim()).filter(Boolean));
    }
  }
  features.push(REMOTE_COMPACTION_BETA_FEATURE);
  result["x-codex-beta-features"] = [...new Set(features)].join(",");
  return result;
}

function serializedBytes(value: JsonValue): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function artifactHash(value: JsonValue): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function validateNativeReplacementHistory(
  value: JsonValue,
): ReturnType<typeof discordNativeReplacementHistorySchema.parse> {
  const history = discordNativeReplacementHistorySchema.parse(value);
  if (serializedBytes(history) > DISCORD_NATIVE_COMPACTION_MAX_BYTES) {
    throw new NativeCompactionError("artifact_oversize");
  }
  return history;
}

function nativeEventText(
  event: DiscordPortableCheckpointRequest["sourceEvents"][number],
): string {
  return JSON.stringify({
    discordEvent: {
      eventId: event.eventId,
      ordinal: event.ordinal,
      authorId: event.authorId ?? null,
      displayName: event.displayName ?? null,
      createdAt: event.createdAt,
      freshness: event.freshness ?? null,
      content: event.content,
    },
  });
}

export function nativeCompactionInput(
  request: DiscordPortableCheckpointRequest,
): JsonValue[] {
  const input: JsonValue[] = [];
  if (request.previousNativeCheckpoint !== undefined) {
    input.push(...request.previousNativeCheckpoint.artifact.replacementHistory);
  }
  for (const event of request.sourceEvents) {
    const text = nativeEventText(event);
    input.push(event.role === "human"
      ? {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        }
      : {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        });
  }
  return input;
}

function retainRecentUserMessages(input: readonly JsonValue[]): JsonValue[] {
  const retained: JsonValue[] = [];
  let estimatedTokens = 0;
  for (let index = input.length - 1; index >= 0; index -= 1) {
    if (retained.length >= DISCORD_NATIVE_RETAINED_USER_LIMIT) break;
    const parsed = retainedUserMessageSchema.safeParse(input[index]);
    if (!parsed.success) continue;
    const itemTokens = Math.max(1, Math.ceil(serializedBytes(parsed.data) / 4));
    if (estimatedTokens + itemTokens > DISCORD_NATIVE_RETAINED_USER_TOKEN_BUDGET) break;
    retained.push(parsed.data);
    estimatedTokens += itemTokens;
  }
  return retained.reverse();
}

function parseSseData(text: string): unknown[] {
  const events: unknown[] = [];
  for (const block of text.replaceAll("\r\n", "\n").split("\n\n")) {
    const data = block.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (data === "" || data === "[DONE]") continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      throw new NativeCompactionError("response_invalid");
    }
  }
  return events;
}

function responseArtifact(
  responseText: string,
  input: readonly JsonValue[],
): Pick<DiscordNativeCompactionArtifact, "replacementHistory" | "usage"> {
  const compactionItems: JsonValue[] = [];
  let completed: z.infer<typeof completedEventSchema> | undefined;
  for (const rawEvent of parseSseData(responseText)) {
    const event = sseEventSchema.safeParse(rawEvent);
    if (!event.success) throw new NativeCompactionError("response_invalid");
    if (failedEventSchema.safeParse(rawEvent).success) {
      throw new NativeCompactionError("provider_request_failed");
    }
    const output = outputItemEventSchema.safeParse(rawEvent);
    if (output.success) {
      if (compactionItemSchema.safeParse(output.data.item).success) {
        compactionItems.push(output.data.item);
      }
      continue;
    }
    const completion = completedEventSchema.safeParse(rawEvent);
    if (completion.success) completed = completion.data;
  }
  if (completed === undefined) throw new NativeCompactionError("response_incomplete");
  if (compactionItems.length !== 1) throw new NativeCompactionError("response_invalid");
  const replacementHistory = validateNativeReplacementHistory([
    ...retainRecentUserMessages(input),
    compactionItems[0]!,
  ]);
  const usage = completed.response.usage;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  return {
    replacementHistory,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: usage?.total_tokens ?? inputTokens + outputTokens,
    },
  };
}

async function boundedResponseText(response: Response): Promise<string> {
  if (response.body === null) throw new NativeCompactionError("response_invalid");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > DISCORD_NATIVE_COMPACTION_SSE_MAX_BYTES) {
      await reader.cancel();
      throw new NativeCompactionError("artifact_oversize");
    }
    text += decoder.decode(next.value, { stream: true });
  }
  return text + decoder.decode();
}

type CapturedCompactionResponse =
  | { ok: true; text: string }
  | { ok: false; code: NativeCompactionErrorCode };

function captureCompactionResponse(
  response: Response,
): Promise<CapturedCompactionResponse> {
  return boundedResponseText(response).then(
    (text): CapturedCompactionResponse => ({ ok: true, text }),
    (error): CapturedCompactionResponse => ({
      ok: false,
      code: error instanceof NativeCompactionError
        ? error.code
        : "response_invalid",
    }),
  );
}

function codexEndpoint(input: string | URL | Request): URL {
  const url = new URL(input instanceof Request ? input.url : input);
  if (
    url.protocol !== "https:"
    || url.hostname !== "chatgpt.com"
    || !url.pathname.endsWith("/codex/responses")
  ) {
    throw new NativeCompactionError("endpoint_incompatible");
  }
  return url;
}

export interface GenerateNativeCompactionOptions {
  runtime: Pick<ModelRuntime, "completeSimple">;
  model: Model<Api>;
  request: DiscordPortableCheckpointRequest;
  instructions: string;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
}

export async function generateNativeCompaction(
  options: GenerateNativeCompactionOptions,
): Promise<DiscordNativeCompactionArtifact> {
  if (
    options.model.provider !== "openai-codex"
    || options.model.api !== "openai-codex-responses"
    || options.model.id !== "gpt-5.6-luna"
  ) {
    throw new NativeCompactionError("provider_contract_incompatible");
  }
  const input = nativeCompactionInput(options.request);
  let requestCaptured = false;
  let capturedResponse: Promise<CapturedCompactionResponse> | undefined;
  const upstreamFetch = options.fetch ?? globalThis.fetch;
  try {
    const streamOptions: ModelsSimpleStreamOptions = {
      reasoning: "xhigh",
      transport: "sse",
      cacheRetention: "none",
      transformHeaders: withNativeCompactionFeature,
      onPayload: (rawPayload) => {
        const payload = providerPayloadSchema.safeParse(rawPayload);
        if (!payload.success || payload.data.model !== options.model.id) {
          throw new NativeCompactionError("provider_contract_incompatible");
        }
        requestCaptured = true;
        const {
          previous_response_id: _previousResponseId,
          ...payloadWithoutPreviousResponseId
        } = payload.data;
        return {
          ...payloadWithoutPreviousResponseId,
          store: false,
          input: [...input, { type: "compaction_trigger" }],
          service_tier: "priority",
          reasoning: { effort: "xhigh", summary: "auto" },
        };
      },
      fetch: async (request, init) => {
        codexEndpoint(request);
        const response = await upstreamFetch(request, init);
        if (response.ok) capturedResponse = captureCompactionResponse(response.clone());
        return response;
      },
    };
    if (options.signal !== undefined) streamOptions.signal = options.signal;
    const message = await options.runtime.completeSimple(
      options.model,
      {
        systemPrompt: options.instructions,
        messages: [{
          role: "user",
          content: "Create the requested opaque compaction artifact.",
          timestamp: Date.now(),
        }],
      },
      streamOptions,
    );
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      throw new NativeCompactionError(
        message.stopReason === "aborted" ? "aborted" : "provider_request_failed",
      );
    }
    if (!requestCaptured || capturedResponse === undefined) {
      throw new NativeCompactionError("provider_contract_incompatible");
    }
    const captured = await capturedResponse;
    if (!captured.ok) throw new NativeCompactionError(captured.code);
    const parsed = responseArtifact(captured.text, input);
    const historyBytes = serializedBytes(parsed.replacementHistory);
    return discordNativeCompactionArtifactSchema.parse({
      schemaVersion: 1,
      implementationVersion: DISCORD_NATIVE_COMPACTION_IMPLEMENTATION_VERSION,
      provider: "openai-codex",
      model: "gpt-5.6-luna",
      replacementHistory: parsed.replacementHistory,
      artifactSha256: artifactHash(parsed.replacementHistory),
      serializedBytes: historyBytes,
      usage: parsed.usage,
      requestEvidence: {
        store: false,
        transport: "sse",
        betaFeature: REMOTE_COMPACTION_BETA_FEATURE,
        endpoint: "chatgpt-codex-responses",
      },
    });
  } catch (error) {
    if (error instanceof NativeCompactionError) throw error;
    if (options.signal?.aborted) throw new NativeCompactionError("aborted");
    throw new NativeCompactionError("provider_request_failed");
  }
}

function nativeCheckpointArtifactValid(checkpoint: DiscordNativeCheckpoint): boolean {
  try {
    const history = validateNativeReplacementHistory(checkpoint.artifact.replacementHistory);
    return checkpoint.artifact.serializedBytes === serializedBytes(history)
      && checkpoint.artifact.artifactSha256 === artifactHash(history);
  } catch {
    return false;
  }
}

export function compatibleNativeCheckpoint(
  rawCheckpoint: JsonValue,
  expected: NativeCheckpointCompatibilityIdentity,
): rawCheckpoint is DiscordNativeCheckpoint {
  const parsed = discordNativeCheckpointSchema.safeParse(rawCheckpoint);
  if (!parsed.success) return false;
  const checkpoint = parsed.data;
  return checkpoint.checkpointId === expected.checkpointId
    && checkpoint.ownerId === expected.ownerId
    && checkpoint.ownerBindingVersion === expected.ownerBindingVersion
    && checkpoint.guildId === expected.guildId
    && checkpoint.conversationId === expected.conversationId
    && checkpoint.epoch === expected.epoch
    && checkpoint.sourceRevision <= expected.sourceRevision
    && checkpoint.personalityVersion === expected.personalityVersion
    && checkpoint.systemPromptHash === expected.systemPromptHash
    && checkpoint.capabilityProfileHash === expected.capabilityProfileHash
    && checkpoint.artifact.implementationVersion
      === DISCORD_NATIVE_COMPACTION_IMPLEMENTATION_VERSION
    && checkpoint.artifact.provider === "openai-codex"
    && checkpoint.artifact.model === "gpt-5.6-luna"
    && nativeCheckpointArtifactValid(checkpoint);
}

export function injectNativeCheckpoint(
  rawPayload: JsonValue,
  rawCheckpoint: JsonValue,
  expected: NativeCheckpointCompatibilityIdentity,
): NativeCheckpointInjection {
  if (!compatibleNativeCheckpoint(rawCheckpoint, expected)) {
    return { payload: rawPayload, applied: false };
  }
  const payload = providerPayloadSchema.safeParse(rawPayload);
  if (!payload.success || payload.data.model !== rawCheckpoint.artifact.model) {
    return { payload: rawPayload, applied: false };
  }
  const {
    previous_response_id: _previousResponseId,
    ...payloadWithoutPreviousResponseId
  } = payload.data;
  const injected = {
    ...payloadWithoutPreviousResponseId,
    store: false,
    input: [
      ...rawCheckpoint.artifact.replacementHistory,
      ...payload.data.input,
    ],
  };
  return { payload: injected, applied: true };
}

export interface NativeCheckpointInjection {
  payload: JsonValue;
  applied: boolean;
}
