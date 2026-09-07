import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
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

const rawProviderPayloadObjectSchema = z.record(z.string(), z.unknown());
const providerPayloadSchema = z.preprocess((rawPayload) => {
  const object = rawProviderPayloadObjectSchema.safeParse(rawPayload);
  if (!object.success || object.data.prompt_cache_key !== undefined) return rawPayload;
  // Pi 0.84.1 keeps this key on the pre-serialization payload when cache
  // retention is disabled. Match JSON.stringify by removing that one value.
  const { prompt_cache_key: _promptCacheKey, ...payload } = object.data;
  return payload;
}, z.object({
  model: z.string(),
  store: z.boolean(),
  stream: z.literal(true),
  input: z.array(z.json()),
}).catchall(z.json()));

const sseEventSchema = z.object({ type: z.string() }).passthrough();
const createdEventSchema = z.object({
  type: z.literal("response.created"),
  response: z.object({
    id: z.string().min(1),
  }).passthrough(),
}).passthrough();
const outputItemEventSchema = z.object({
  type: z.literal("response.output_item.done"),
  output_index: z.number().int().nonnegative(),
  sequence_number: z.number().int().nonnegative(),
  response_id: z.string().min(1).optional(),
  item: z.json(),
}).passthrough();
const terminalUsageSchema = z.object({
  input_tokens: z.number().int().positive(),
  output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().positive(),
}).passthrough();
const terminalEventSchema = z.object({
  type: z.enum(["response.completed", "response.done"]),
  response: z.object({
    id: z.string().min(1).optional(),
    status: z.literal("completed"),
    output: z.array(z.json()).optional(),
    usage: terminalUsageSchema,
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
const portableSummarySeedSchema = z.object({
  validatedPortableCheckpointSummary: z.json(),
}).strict();

export type NativeCompactionErrorCode =
  | "aborted"
  | "artifact_oversize"
  | "endpoint_incompatible"
  | "provider_contract_incompatible"
  | "provider_request_failed"
  | "response_incomplete"
  | "response_invalid";

export type NativeCompactionProbeFailureCategory =
  | "body_missing"
  | "body_oversize"
  | "body_read_failed"
  | "created_event_invalid"
  | "created_event_order_invalid"
  | "event_after_done_marker"
  | "event_after_terminal"
  | "event_envelope_invalid"
  | "output_event_duplicate"
  | "output_event_invalid"
  | "output_item_not_compaction"
  | "output_response_id_mismatch"
  | "provider_failure_event"
  | "replacement_history_invalid"
  | "sse_duplicate_done_marker"
  | "sse_event_json_invalid"
  | "terminal_before_output"
  | "terminal_event_invalid"
  | "terminal_missing"
  | "terminal_output_mismatch"
  | "terminal_response_id_mismatch"
  | "terminal_status_invalid"
  | "terminal_usage_inconsistent"
  | "terminal_usage_invalid";

export interface NativeCompactionProbeEvidence {
  bodyRead: "complete" | "missing" | "oversize" | "read_failed";
  dataEventCount: number;
  doneMarkerCount: number;
  createdEventCount: number;
  outputItemDoneEventCount: number;
  compactionOutputItemCount: number;
  otherOutputItemCount: number;
  completedEventCount: number;
  doneEventCount: number;
  failureEventCount: number;
  otherEventCount: number;
  result: "accepted" | "rejected";
  failureCategory?: NativeCompactionProbeFailureCategory;
}

interface NativeCompactionProbeState {
  bodyRead?: NativeCompactionProbeEvidence["bodyRead"];
  dataEventCount: number;
  doneMarkerCount: number;
  createdEventCount: number;
  outputItemDoneEventCount: number;
  compactionOutputItemCount: number;
  otherOutputItemCount: number;
  completedEventCount: number;
  doneEventCount: number;
  failureEventCount: number;
  otherEventCount: number;
  failureCategory?: NativeCompactionProbeFailureCategory;
}

function nativeCompactionProbeState(): NativeCompactionProbeState {
  return {
    dataEventCount: 0,
    doneMarkerCount: 0,
    createdEventCount: 0,
    outputItemDoneEventCount: 0,
    compactionOutputItemCount: 0,
    otherOutputItemCount: 0,
    completedEventCount: 0,
    doneEventCount: 0,
    failureEventCount: 0,
    otherEventCount: 0,
  };
}

function rejectNativeCompactionResponse(
  state: NativeCompactionProbeState,
  failureCategory: NativeCompactionProbeFailureCategory,
  code: NativeCompactionErrorCode = "response_invalid",
): never {
  state.failureCategory = failureCategory;
  throw new NativeCompactionError(code);
}

function nativeCompactionProbeEvidence(
  state: NativeCompactionProbeState,
  result: NativeCompactionProbeEvidence["result"],
): NativeCompactionProbeEvidence {
  const evidence: NativeCompactionProbeEvidence = {
    bodyRead: state.bodyRead ?? "read_failed",
    dataEventCount: state.dataEventCount,
    doneMarkerCount: state.doneMarkerCount,
    createdEventCount: state.createdEventCount,
    outputItemDoneEventCount: state.outputItemDoneEventCount,
    compactionOutputItemCount: state.compactionOutputItemCount,
    otherOutputItemCount: state.otherOutputItemCount,
    completedEventCount: state.completedEventCount,
    doneEventCount: state.doneEventCount,
    failureEventCount: state.failureEventCount,
    otherEventCount: state.otherEventCount,
    result,
  };
  if (state.failureCategory !== undefined) {
    evidence.failureCategory = state.failureCategory;
  }
  return evidence;
}

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
  compactedThroughOrdinal: number;
  sourceRevision: number;
  sourceContextHash: string;
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
  const previousNativeCheckpoint = compatiblePreviousNativeCheckpoint(request);
  if (previousNativeCheckpoint !== undefined) {
    input.push(...previousNativeCheckpoint.artifact.replacementHistory);
  } else if (request.previousSummary !== undefined) {
    input.push({
      type: "message",
      role: "user",
      content: [{
        type: "input_text",
        text: JSON.stringify({
          validatedPortableCheckpointSummary: request.previousSummary,
        }),
      }],
    });
  } else if (request.conversation.activeCheckpointId !== undefined) {
    throw new NativeCompactionError("provider_contract_incompatible");
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

function compatiblePreviousNativeCheckpoint(
  request: DiscordPortableCheckpointRequest,
): DiscordNativeCheckpoint | undefined {
  const checkpoint = request.previousNativeCheckpoint;
  const conversation = request.conversation;
  if (
    checkpoint === undefined
    || conversation.activeCheckpointId === undefined
    || conversation.activeCheckpointCompactedThroughOrdinal === undefined
    || conversation.activeCheckpointSourceRevision === undefined
    || conversation.activeCheckpointSourceContextHash === undefined
  ) return undefined;
  const expected: NativeCheckpointCompatibilityIdentity = {
    checkpointId: conversation.activeCheckpointId,
    ownerId: conversation.ownerId,
    ownerBindingVersion: conversation.ownerBindingVersion,
    guildId: conversation.guildId,
    conversationId: conversation.conversationId,
    epoch: conversation.epoch,
    compactedThroughOrdinal: conversation.activeCheckpointCompactedThroughOrdinal,
    sourceRevision: conversation.activeCheckpointSourceRevision,
    sourceContextHash: conversation.activeCheckpointSourceContextHash,
    personalityVersion: conversation.personalityVersion,
    systemPromptHash: conversation.systemPromptHash,
    capabilityProfileHash: conversation.capabilityProfileHash,
  };
  return compatibleNativeCheckpoint(checkpoint, expected) ? checkpoint : undefined;
}

function retainRecentUserMessages(input: readonly JsonValue[]): JsonValue[] {
  const retained: JsonValue[] = [];
  let estimatedTokens = 0;
  for (let index = input.length - 1; index >= 0; index -= 1) {
    if (retained.length >= DISCORD_NATIVE_RETAINED_USER_LIMIT) break;
    const parsed = retainedUserMessageSchema.safeParse(input[index]);
    if (!parsed.success) continue;
    if (isPortableSummarySeed(parsed.data)) continue;
    const itemTokens = Math.max(1, Math.ceil(serializedBytes(parsed.data) / 4));
    if (estimatedTokens + itemTokens > DISCORD_NATIVE_RETAINED_USER_TOKEN_BUDGET) break;
    retained.push(parsed.data);
    estimatedTokens += itemTokens;
  }
  return retained.reverse();
}

function isPortableSummarySeed(
  message: z.infer<typeof retainedUserMessageSchema>,
): boolean {
  if (message.content.length !== 1) return false;
  try {
    return portableSummarySeedSchema.safeParse(
      JSON.parse(message.content[0]!.text),
    ).success;
  } catch {
    return false;
  }
}

function parseSseData(
  text: string,
  state: NativeCompactionProbeState,
): unknown[] {
  const events: unknown[] = [];
  let ended = false;
  for (const block of text.replaceAll("\r\n", "\n").split("\n\n")) {
    const data = block.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (data === "") continue;
    if (data === "[DONE]") {
      state.doneMarkerCount += 1;
      if (ended) {
        rejectNativeCompactionResponse(state, "sse_duplicate_done_marker");
      }
      ended = true;
      continue;
    }
    if (ended) rejectNativeCompactionResponse(state, "event_after_done_marker");
    state.dataEventCount += 1;
    try {
      events.push(JSON.parse(data));
    } catch {
      rejectNativeCompactionResponse(state, "sse_event_json_invalid");
    }
  }
  return events;
}

function recordNativeCompactionEvent(
  eventType: string,
  event: z.infer<typeof sseEventSchema>,
  state: NativeCompactionProbeState,
): void {
  switch (eventType) {
    case "response.created":
      state.createdEventCount += 1;
      return;
    case "response.output_item.done": {
      state.outputItemDoneEventCount += 1;
      const outputItem = z.object({
        item: z.object({ type: z.string() }).passthrough(),
      }).passthrough().safeParse(event);
      if (outputItem.success && outputItem.data.item.type === "compaction") {
        state.compactionOutputItemCount += 1;
      } else {
        state.otherOutputItemCount += 1;
      }
      return;
    }
    case "response.completed":
      state.completedEventCount += 1;
      return;
    case "response.done":
      state.doneEventCount += 1;
      return;
    case "error":
    case "response.failed":
    case "response.incomplete":
      state.failureEventCount += 1;
      return;
    default:
      state.otherEventCount += 1;
  }
}

function responseArtifact(
  responseText: string,
  input: readonly JsonValue[],
  state: NativeCompactionProbeState,
): Pick<DiscordNativeCompactionArtifact, "replacementHistory" | "usage"> {
  let createdResponseId: string | undefined;
  let compactionEvent: z.infer<typeof outputItemEventSchema> | undefined;
  let terminal: z.infer<typeof terminalEventSchema> | undefined;
  for (const rawEvent of parseSseData(responseText, state)) {
    if (terminal !== undefined) {
      rejectNativeCompactionResponse(state, "event_after_terminal");
    }
    const event = sseEventSchema.safeParse(rawEvent);
    if (!event.success) {
      rejectNativeCompactionResponse(state, "event_envelope_invalid");
    }
    recordNativeCompactionEvent(event.data.type, event.data, state);
    if (failedEventSchema.safeParse(rawEvent).success) {
      rejectNativeCompactionResponse(
        state,
        "provider_failure_event",
        "provider_request_failed",
      );
    }
    if (event.data.type === "response.created") {
      const created = createdEventSchema.safeParse(rawEvent);
      if (!created.success) {
        rejectNativeCompactionResponse(state, "created_event_invalid");
      }
      if (createdResponseId !== undefined || compactionEvent !== undefined) {
        rejectNativeCompactionResponse(state, "created_event_order_invalid");
      }
      createdResponseId = created.data.response.id;
      continue;
    }
    if (event.data.type === "response.output_item.done") {
      const output = outputItemEventSchema.safeParse(rawEvent);
      if (!output.success) {
        rejectNativeCompactionResponse(state, "output_event_invalid");
      }
      if (compactionEvent !== undefined) {
        rejectNativeCompactionResponse(state, "output_event_duplicate");
      }
      if (!compactionItemSchema.safeParse(output.data.item).success) {
        rejectNativeCompactionResponse(state, "output_item_not_compaction");
      }
      if (
        createdResponseId !== undefined
        && output.data.response_id !== undefined
        && output.data.response_id !== createdResponseId
      ) {
        rejectNativeCompactionResponse(state, "output_response_id_mismatch");
      }
      compactionEvent = output.data;
      continue;
    }
    if (event.data.type === "response.completed" || event.data.type === "response.done") {
      const completion = terminalEventSchema.safeParse(rawEvent);
      if (!completion.success) {
        const terminalStatus = z.object({
          response: z.object({ status: z.unknown().optional() }).passthrough(),
        }).passthrough().safeParse(rawEvent);
        if (terminalStatus.success && terminalStatus.data.response.status !== "completed") {
          rejectNativeCompactionResponse(state, "terminal_status_invalid");
        }
        const terminalUsage = z.object({
          response: z.object({
            usage: terminalUsageSchema,
          }).passthrough(),
        }).passthrough().safeParse(rawEvent);
        if (!terminalUsage.success) {
          rejectNativeCompactionResponse(state, "terminal_usage_invalid");
        }
        rejectNativeCompactionResponse(state, "terminal_event_invalid");
      }
      if (compactionEvent === undefined) {
        rejectNativeCompactionResponse(state, "terminal_before_output");
      }
      terminal = completion.data;
      continue;
    }
  }
  if (terminal === undefined) {
    rejectNativeCompactionResponse(state, "terminal_missing", "response_incomplete");
  }
  if (
    createdResponseId !== undefined
    && terminal.response.id !== createdResponseId
  ) rejectNativeCompactionResponse(state, "terminal_response_id_mismatch");
  if (
    compactionEvent!.response_id !== undefined
    && terminal.response.id !== undefined
    && compactionEvent!.response_id !== terminal.response.id
  ) rejectNativeCompactionResponse(state, "terminal_response_id_mismatch");
  const terminalOutput = terminal.response.output;
  if (terminalOutput !== undefined) {
    const outputIndex = compactionEvent!.output_index;
    const compactionOutput = terminalOutput.filter(
      (item) => compactionItemSchema.safeParse(item).success,
    );
    const linkedItem = [terminalOutput[outputIndex]];
    if (
      terminalOutput.length !== 1
      || compactionOutput.length !== 1
      || linkedItem.length !== 1
      || linkedItem[0] === undefined
      || !isDeepStrictEqual(linkedItem[0], compactionEvent!.item)
    ) rejectNativeCompactionResponse(state, "terminal_output_mismatch");
  }
  const usage = terminal.response.usage;
  if (usage.total_tokens !== usage.input_tokens + usage.output_tokens) {
    rejectNativeCompactionResponse(state, "terminal_usage_inconsistent");
  }
  let replacementHistory: ReturnType<typeof validateNativeReplacementHistory>;
  try {
    replacementHistory = validateNativeReplacementHistory([
      ...retainRecentUserMessages(input),
      compactionEvent!.item,
    ]);
  } catch (error) {
    state.failureCategory = "replacement_history_invalid";
    throw error;
  }
  return {
    replacementHistory,
    usage: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      totalTokens: usage.total_tokens,
    },
  };
}

async function boundedResponseText(
  response: Response,
  state: NativeCompactionProbeState,
): Promise<string> {
  if (response.body === null) {
    state.bodyRead = "missing";
    rejectNativeCompactionResponse(state, "body_missing");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > DISCORD_NATIVE_COMPACTION_SSE_MAX_BYTES) {
        state.bodyRead = "oversize";
        state.failureCategory = "body_oversize";
        await reader.cancel();
        throw new NativeCompactionError("artifact_oversize");
      }
      text += decoder.decode(next.value, { stream: true });
    }
  } catch (error) {
    if (error instanceof NativeCompactionError) throw error;
    state.bodyRead = "read_failed";
    rejectNativeCompactionResponse(state, "body_read_failed");
  }
  state.bodyRead = "complete";
  return text + decoder.decode();
}

type CapturedCompactionResponse =
  | { ok: true; text: string }
  | { ok: false; code: NativeCompactionErrorCode };

function captureCompactionResponse(
  response: Response,
  state: NativeCompactionProbeState,
): Promise<CapturedCompactionResponse> {
  return boundedResponseText(response, state).then(
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
  onProbeEvidence?: (evidence: NativeCompactionProbeEvidence) => void;
}

function emitNativeCompactionProbeEvidence(
  observer: GenerateNativeCompactionOptions["onProbeEvidence"],
  evidence: NativeCompactionProbeEvidence,
): void {
  try {
    observer?.(evidence);
  } catch {
    // Probe diagnostics must not change the production compaction result.
  }
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
  const probeState = nativeCompactionProbeState();
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
        if (response.ok) {
          capturedResponse = captureCompactionResponse(response.clone(), probeState);
        }
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
    if (message.stopReason !== "stop") {
      throw new NativeCompactionError(
        message.stopReason === "aborted" ? "aborted" : "provider_request_failed",
      );
    }
    if (!requestCaptured || capturedResponse === undefined) {
      throw new NativeCompactionError("provider_contract_incompatible");
    }
    const captured = await capturedResponse;
    if (!captured.ok) {
      emitNativeCompactionProbeEvidence(
        options.onProbeEvidence,
        nativeCompactionProbeEvidence(probeState, "rejected"),
      );
      throw new NativeCompactionError(captured.code);
    }
    let parsed: ReturnType<typeof responseArtifact>;
    try {
      parsed = responseArtifact(captured.text, input, probeState);
    } catch (error) {
      emitNativeCompactionProbeEvidence(
        options.onProbeEvidence,
        nativeCompactionProbeEvidence(probeState, "rejected"),
      );
      throw error;
    }
    emitNativeCompactionProbeEvidence(
      options.onProbeEvidence,
      nativeCompactionProbeEvidence(probeState, "accepted"),
    );
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
    && checkpoint.compactedThroughOrdinal === expected.compactedThroughOrdinal
    && checkpoint.sourceRevision === expected.sourceRevision
    && checkpoint.sourceContextHash === expected.sourceContextHash
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
