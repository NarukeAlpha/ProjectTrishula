/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-parameters -- The in-memory Convex adapter models only the database operations used by these mutation tests. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Doc, Id } from "../convex/_generated/dataModel.js";
import type { MutationCtx } from "../convex/_generated/server.js";
import {
  canonicalCheckpointSlice, deleteGuildConversationPrivacyData, durableConversationContext,
  expirePortableCheckpoints, invalidateNativeCheckpoint, nextPortableCheckpoint, resetGuildConversation,
  stagedCheckpointContext, storePortableCheckpoint,
} from "../convex/discord.js";
import { discordGateway } from "../convex/discord_http.js";
import { sha256Hex } from "../convex/lib/canonical_json.js";
import {
  DISCORD_PERSONALITY_PROFILE, DISCORD_PORTABLE_CHECKPOINT_MAX_BYTES,
  estimateDiscordCanonicalEventTokens, selectDiscordCheckpointSourceBatch, selectDiscordCheckpointTail,
} from "../convex/lib/discord_conversation.js";
import {
  projectLegacyClaimLoopResponse, projectLegacyNewestContextResponse,
  projectPreNativeContext, projectPreNativeCheckpointRequest,
  DISCORD_GATEWAY_PROTOCOL_HEADER,
} from "../convex/lib/discord_contract.js";
import {
  checkpointUtf8Bytes, nativeCompactionArtifactSchema, restoreNativeCompaction, validateNativeCompaction,
} from "../convex/lib/discord_native_checkpoint.js";

const ownerId = "owner_1";
const portableSummary = JSON.stringify({
  participants: [], acceptedFacts: [], corrections: [], unresolvedQuestions: [],
  commitments: [], conversationPreferences: [], sourceFreshnessNotes: [],
});
async function artifact(encryptedContent = "opaque-fixture") {
  const replacementHistory = [{ type: "compaction", encrypted_content: encryptedContent }];
  const json = JSON.stringify(replacementHistory);
  return {
    schemaVersion: 1 as const, implementationVersion: "responses-compaction-v2-pi-0_84_1-v1" as const,
    provider: "openai-codex" as const, model: "gpt-5.6-luna" as const,
    replacementHistory, artifactSha256: await sha256Hex(json), serializedBytes: checkpointUtf8Bytes(json),
    usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
    requestEvidence: { store: false as const, transport: "sse" as const, betaFeature: "remote_compaction_v2" as const, endpoint: "chatgpt-codex-responses" as const },
  };
}

type Row = Record<string, unknown> & { _id: string };
function database() {
  const tables = new Map<string, Row[]>();
  let nextId = 0;
  const rows = (table: string) => {
    const found = tables.get(table);
    if (found) return found;
    const created: Row[] = [];
    tables.set(table, created);
    return created;
  };
  const get = (id: string) => [...tables.values()].flat().find((row) => row._id === id) ?? null;
  const db = {
    query(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let descending = false;
      const index = {
        eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return index; },
        lte(key: string, value: number) { filters.push((row) => Number(row[key]) <= value); return index; },
      };
      const found = () => {
        const result = rows(table).filter((row) => filters.every((predicate) => predicate(row)));
        return descending ? result.toReversed() : result;
      };
      const query = {
        withIndex(_name: string, configure: (value: typeof index) => typeof index) { configure(index); return query; },
        order(value: string) { descending = value === "desc"; return query; },
        async collect() { return found(); },
        async take(count: number) { return found().slice(0, count); },
        async unique() { if (found().length > 1) throw new Error("fixture_duplicate"); return found()[0] ?? null; },
      };
      return query;
    },
    async get(id: string) { return get(id); },
    async insert(table: string, value: Record<string, unknown>) {
      const _id = `${table}:${++nextId}`;
      rows(table).push({ ...value, _id, _creationTime: Date.now() });
      return _id;
    },
    async patch(id: string, value: Record<string, unknown>) {
      const row = get(id);
      if (!row) throw new Error("fixture_missing_row");
      for (const [key, item] of Object.entries(value)) {
        if (item === undefined) delete row[key]; else row[key] = item;
      }
    },
    async delete(id: string) {
      for (const records of tables.values()) {
        const index = records.findIndex((row) => row._id === id);
        if (index !== -1) records.splice(index, 1);
      }
    },
  };
  // SAFETY: All database calls in the exercised handlers use the operations above.
  // The auth fixture has a fixed allowed owner; unsupported operations fail immediately.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- This bounded test adapter intentionally omits unrelated Convex runtime services.
  const ctx = { db, auth: { getUserIdentity: async () => ({ subject: ownerId }) } } as unknown as MutationCtx;
  function conversation(guildId: string, eventCount: number) {
    const value: Doc<"discordAssistantConversations"> = {
      // SAFETY: The deterministic identifier is used only by this in-memory database.
      _id: `conversation:${guildId}` as Id<"discordAssistantConversations">,
      _creationTime: 1, ownerId, ownerBindingVersion: 1, guildId, conversationId: `discord:${guildId}`,
      epoch: 1, generation: 1, routingGeneration: 1, revision: eventCount, humanRevision: eventCount,
      nextOrdinal: eventCount + 1, migrationWatermarkSequence: 0, createdAt: 1, updatedAt: 1,
      ...DISCORD_PERSONALITY_PROFILE,
    };
    rows("discordAssistantConversations").push(value);
    for (let ordinal = 1; ordinal <= eventCount; ordinal += 1) {
      rows("discordConversationEvents").push({
        _id: `event:${guildId}:${ordinal}`, ownerId, guildId, conversationId: value.conversationId, epoch: 1,
        eventId: `event:${guildId}:${ordinal}`, ordinal, revision: ordinal, humanRevision: ordinal,
        kind: "human_message", visibility: "conversation", status: "committed", authorId: "111",
        authorName: "Participant", content: "x".repeat(400), contextHash: "context", createdAt: 1,
      });
    }
    return value;
  }
  return { ctx, rows, conversation };
}

interface RegisteredMutationFixture { isConvexFunction: true; isMutation: true }
async function invoke(mutation: RegisteredMutationFixture, ctx: MutationCtx, args: Record<string, unknown>) {
  // Convex 1.43.0 registers the original callback as _handler; this invokes that callback,
  // not a mock implementation of checkpoint validation or mutation ordering.
  // SAFETY: Convex registration_impl.js installs this exact callback property on registered mutations.
  const executable = mutation as RegisteredMutationFixture & {
    _handler: (context: MutationCtx, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  const result = await executable._handler(ctx, args);
  return z.record(z.string(), z.unknown()).parse(result);
}

async function gatewayRequest(body: Record<string, unknown>, result: Record<string, unknown>, protocol?: string) {
  const runMutation = vi.fn(async () => result);
  // SAFETY: The registered HTTP action exposes its original callback, just as mutations do.
  const action = discordGateway as typeof discordGateway & {
    _handler: (context: { runMutation: typeof runMutation }, request: Request) => Promise<Response>;
  };
  const headers = new Headers({ authorization: "Bearer fixture-gateway-secret", "content-type": "application/json" });
  if (protocol !== undefined) headers.set(DISCORD_GATEWAY_PROTOCOL_HEADER, protocol);
  const response = await action._handler({ runMutation }, new Request("https://example.invalid/discord", {
    method: "POST", headers, body: JSON.stringify(body),
  }));
  return { response, runMutation, body: z.record(z.string(), z.unknown()).parse(await response.json()) };
}

async function storeArgs(db: ReturnType<typeof database>, conversation: Doc<"discordAssistantConversations">, through: number) {
  const source = await canonicalCheckpointSlice(db.ctx, conversation, through);
  const tail = selectDiscordCheckpointTail(db.rows("discordConversationEvents")
    .filter((row) => row.conversationId === conversation.conversationId && Number(row.ordinal) > through)
    .map((row) => ({ eventId: String(row.eventId), ordinal: Number(row.ordinal), content: String(row.content) })));
  return {
    actorId: ownerId, guildId: conversation.guildId, conversationId: conversation.conversationId,
    epoch: conversation.epoch, expectedRevision: conversation.revision, expectedGeneration: conversation.generation,
    expectedRoutingGeneration: conversation.routingGeneration, checkpointId: `checkpoint:${conversation.guildId}:${through}`,
    sourceContextHash: source.sourceContextHash, toolPolicyHash: conversation.capabilityProfileHash,
    compactedThroughOrdinal: through, portableSummary, retainedRecentEventIds: tail.events.map((event) => event.eventId),
    inputTokens: 100, outputTokens: 10, estimatedSavedTokens: 90, nativeCompaction: await artifact(),
    nativeCompactionSupported: true,
  };
}

beforeEach(() => vi.stubEnv("WORKOS_ALLOWED_USER_IDS", "owner_1,owner_2"));
afterEach(() => vi.unstubAllEnvs());

describe("native compaction artifact boundaries", () => {
  it("round-trips opaque JSON without interpreting or dropping provider fields", async () => {
    const input = await artifact();
    input.replacementHistory[0]!.encrypted_content = "opaque-unicode-🧠";
    input.serializedBytes = checkpointUtf8Bytes(JSON.stringify(input.replacementHistory));
    input.artifactSha256 = await sha256Hex(JSON.stringify(input.replacementHistory));
    const stored = await validateNativeCompaction(input, portableSummary);
    expect(await restoreNativeCompaction(JSON.parse(JSON.stringify(stored)), portableSummary)).toEqual(input);
    const history = [{ type: "message", role: "user", content: [{ type: "input_text", text: "Canonical user context" }] }, ...input.replacementHistory];
    await expect(validateNativeCompaction({
      ...input, replacementHistory: history, serializedBytes: checkpointUtf8Bytes(JSON.stringify(history)),
      artifactSha256: await sha256Hex(JSON.stringify(history)),
    }, portableSummary)).resolves.toBeDefined();
  });

  it("accepts exact combined UTF-8 bytes and rejects one byte over", async () => {
    const empty = await artifact("");
    const exact = await artifact("a".repeat(DISCORD_PORTABLE_CHECKPOINT_MAX_BYTES - checkpointUtf8Bytes(portableSummary) - empty.serializedBytes));
    await expect(validateNativeCompaction(exact, portableSummary)).resolves.toBeDefined();
    const over = await artifact(`${exact.replacementHistory[0]!.encrypted_content}a`);
    await expect(validateNativeCompaction(over, portableSummary)).rejects.toThrow();
  });

  it("rejects forged hashes, byte counts, provider policy, and non-user pre-final history", async () => {
    const input = await artifact();
    for (const change of [
      { artifactSha256: "0".repeat(64) }, { serializedBytes: input.serializedBytes + 1 },
      { provider: "other" }, { model: "other" }, { usage: { inputTokens: -1, outputTokens: 0, totalTokens: 0 } },
      { requestEvidence: { ...input.requestEvidence, store: true } },
      { replacementHistory: [{ type: "message", role: "assistant", content: [{ type: "input_text", text: "unsent draft" }] }, ...input.replacementHistory] },
      { replacementHistory: [...input.replacementHistory, ...input.replacementHistory] },
      { replacementHistory: [{ type: "compaction" }, { type: "message", role: "user", content: [] }] },
    ]) await expect(validateNativeCompaction({ ...input, ...change }, portableSummary)).rejects.toThrow();
    expect(nativeCompactionArtifactSchema.safeParse({ ...input, extra: true }).success).toBe(false);
  });
});

describe("native checkpoint CAS, restore, and removal", () => {
  it("validates native data and all CAS fences before superseding active memory", async () => {
    const db = database(); const conversation = db.conversation("123", 3);
    const first = await storeArgs(db, conversation, 1);
    expect(await invoke(storePortableCheckpoint, db.ctx, first)).toMatchObject({ accepted: true, status: "active" });
    const next = await storeArgs(db, conversation, 2);
    for (const change of [
      { nativeCompaction: { ...next.nativeCompaction, artifactSha256: "0".repeat(64) } },
      { expectedRevision: 2 }, { expectedGeneration: 2 }, { expectedRoutingGeneration: 2 },
      { epoch: 2 }, { actorId: "owner_2" }, { toolPolicyHash: "0".repeat(64) },
    ]) expect(await invoke(storePortableCheckpoint, db.ctx, { ...next, ...change })).toMatchObject({ accepted: false });
    expect(db.rows("discordCompactionCheckpoints")).toHaveLength(1);
    expect(db.rows("discordCompactionCheckpoints")[0]).toMatchObject({ status: "active" });
    expect(conversation.activeCheckpointId).toBe(first.checkpointId);
    expect(await invoke(storePortableCheckpoint, db.ctx, first)).toMatchObject({ accepted: true, duplicate: true });
    expect(await invoke(storePortableCheckpoint, db.ctx, { ...first, nativeCompaction: await artifact("different") }))
      .toMatchObject({ accepted: false, reason: "checkpoint_id_conflict" });
    db.rows("discordOutbox").push({ _id: "uncertain", ownerId, guildId: "999", sourceGuildId: "123", status: "delivery_uncertain" });
    expect(await invoke(storePortableCheckpoint, db.ctx, next)).toMatchObject({ accepted: false, reason: "conversation_not_stable" });
    expect(db.rows("discordCompactionCheckpoints")[0]?.status).toBe("active");
  });

  it("restores native identity and falls back to the verified portable summary on opaque corruption", async () => {
    const db = database(); const conversation = db.conversation("123", 3);
    await invoke(storePortableCheckpoint, db.ctx, await storeArgs(db, conversation, 1));
    db.rows("discordCompactionCheckpoints")[0] = JSON.parse(JSON.stringify(db.rows("discordCompactionCheckpoints")[0]));
    const restored = await durableConversationContext(db.ctx, conversation, Date.now());
    expect(restored.nativeCheckpoint).toMatchObject({ ownerId, guildId: "123", conversationId: "discord:123", epoch: 1, sourceRevision: 3 });
    expect(restored.activeCheckpointSourceRevision).toBe(restored.nativeCheckpoint?.sourceRevision);
    expect(restored.activeCheckpointSourceContextHash).toBe(restored.nativeCheckpoint?.sourceContextHash);
    expect(restored.activeCheckpointCompactedThroughOrdinal).toBe(restored.nativeCheckpoint?.compactedThroughOrdinal);
    const row = db.rows("discordCompactionCheckpoints")[0]!;
    const stored = z.object({ replacementHistoryJson: z.string() }).passthrough().parse(row.nativeCompaction);
    row.nativeCompaction = { ...stored, replacementHistoryJson: "[corrupt" };
    const fallback = await durableConversationContext(db.ctx, conversation, Date.now());
    expect(fallback.nativeCheckpoint).toBeUndefined();
    expect(fallback.portableSummary).toEqual(JSON.parse(portableSummary));
    expect(row.nativeCompaction).toBeUndefined();
  });

  it("rejects restore after an owner or policy mismatch and never injects a staged candidate into a turn", async () => {
    for (const change of [
      { ownerBindingVersion: 2 }, { epoch: 2 }, { personalityVersion: "changed" },
      { systemPromptHash: "0".repeat(64) }, { capabilityProfileHash: "0".repeat(64) }, { lunaModel: "other" },
    ]) {
      const db = database(); const conversation = db.conversation("123", 3);
      await invoke(storePortableCheckpoint, db.ctx, await storeArgs(db, conversation, 1));
      Object.assign(conversation, change);
      expect((await durableConversationContext(db.ctx, conversation, Date.now())).nativeCheckpoint).toBeUndefined();
      expect(db.rows("discordCompactionCheckpoints")[0]?.nativeCompaction).toBeUndefined();
      expect(conversation.activeCheckpointId).toBeUndefined();
    }
  });

  it("clears opaque artifacts on expiry and reset; privacy deletion removes the stored rows", async () => {
    for (const operation of ["expire", "reset", "delete"] as const) {
      const db = database(); const conversation = db.conversation("123", 3);
      await invoke(storePortableCheckpoint, db.ctx, await storeArgs(db, conversation, 1));
      if (operation === "expire") {
        db.rows("discordCompactionCheckpoints")[0]!.expiresAt = 0;
        await invoke(expirePortableCheckpoints, db.ctx, {});
      } else {
        await invoke(operation === "reset" ? resetGuildConversation : deleteGuildConversationPrivacyData, db.ctx, { guildId: "123", confirmGuildId: "123" });
      }
      expect(db.rows("discordCompactionCheckpoints").every((row) => row.nativeCompaction === undefined)).toBe(true);
      if (operation === "delete") expect(db.rows("discordCompactionCheckpoints")).toHaveLength(0);
      expect(conversation.activeCheckpointId).toBeUndefined();
    }
  });

  it("invalidates provider-rejected opaque state only under the exact live fence", async () => {
    for (const size of [3, 300]) {
      const db = database(); const conversation = db.conversation("123", size);
      const stored = await storeArgs(db, conversation, 1);
      await invoke(storePortableCheckpoint, db.ctx, stored);
      if (size === 300) {
        // Historical candidate artifacts can exist before the native-v2 lineage guard.
        db.rows("discordCompactionCheckpoints")[0]!.nativeCompaction = await validateNativeCompaction(await artifact(), portableSummary);
      }
      const args = {
        actorId: ownerId, guildId: "123", conversationId: "discord:123", checkpointId: stored.checkpointId,
        epoch: 1, expectedOwnerBindingVersion: 1, expectedRevision: size, expectedGeneration: 1, expectedRoutingGeneration: 1,
      };
      for (const change of [
        { actorId: "owner_2" }, { expectedOwnerBindingVersion: 2 }, { expectedRevision: size + 1 },
        { expectedGeneration: 2 }, { expectedRoutingGeneration: 2 }, { epoch: 2 }, { checkpointId: "other" },
      ]) expect(await invoke(invalidateNativeCheckpoint, db.ctx, { ...args, ...change })).toMatchObject({ accepted: false });
      expect(db.rows("discordCompactionCheckpoints")[0]?.nativeCompaction).toBeDefined();
      expect(await invoke(invalidateNativeCheckpoint, db.ctx, args)).toEqual({ accepted: true, invalidated: true });
      expect(db.rows("discordCompactionCheckpoints")[0]?.nativeCompaction).toBeUndefined();
      if (size === 3) {
        expect(conversation.activeCheckpointId).toBe(stored.checkpointId);
        expect((await durableConversationContext(db.ctx, conversation, Date.now())).portableSummary).toBeDefined();
      } else {
        expect(conversation.candidateCheckpointId).toBeUndefined();
        expect(db.rows("discordCompactionCheckpoints")[0]?.status).toBe("invalid");
      }
    }
  });

  it("invalidates the same active artifact after plan and research writes advance the claim revision", async () => {
    const db = database(); const conversation = db.conversation("123", 3);
    const stored = await storeArgs(db, conversation, 1);
    await invoke(storePortableCheckpoint, db.ctx, stored);
    const args = {
      actorId: ownerId, guildId: "123", conversationId: "discord:123", checkpointId: stored.checkpointId,
      epoch: 1, expectedOwnerBindingVersion: 1, expectedRevision: 3, expectedGeneration: 1, expectedRoutingGeneration: 1,
    };
    // recordFrontmanPlan, recordResearchStarted, and recordResearchResult advance
    // the canonical revision without changing the claimed generation or checkpoint.
    conversation.revision = 6;
    for (const change of [
      { expectedRevision: 7 }, { expectedRevision: 0 }, { expectedRevision: 2.5 },
      { actorId: "owner_2" }, { guildId: "456" }, { conversationId: "discord:456" },
      { expectedOwnerBindingVersion: 2 }, { expectedGeneration: 2 }, { expectedRoutingGeneration: 2 },
      { epoch: 2 }, { checkpointId: "different" },
    ]) expect(await invoke(invalidateNativeCheckpoint, db.ctx, { ...args, ...change })).toMatchObject({ accepted: false });
    const checkpoint = db.rows("discordCompactionCheckpoints")[0]!;
    expect(checkpoint.nativeCompaction).toBeDefined();
    expect(await invoke(invalidateNativeCheckpoint, db.ctx, args)).toEqual({ accepted: true, invalidated: true });
    expect(checkpoint.nativeCompaction).toBeUndefined();
    expect(checkpoint.portableSummary).toBe(portableSummary);
    expect(checkpoint.status).toBe("active");
    expect(conversation.activeCheckpointId).toBe(stored.checkpointId);
    expect(await invoke(invalidateNativeCheckpoint, db.ctx, args)).toEqual({ accepted: true, invalidated: false });
  });

  it("never invalidates a replacement checkpoint with a stale claim", async () => {
    const db = database(); const conversation = db.conversation("123", 3);
    const first = await storeArgs(db, conversation, 1);
    await invoke(storePortableCheckpoint, db.ctx, first);
    conversation.revision = 6;
    const replacement = await storeArgs(db, conversation, 2);
    await invoke(storePortableCheckpoint, db.ctx, replacement);
    expect(await invoke(invalidateNativeCheckpoint, db.ctx, {
      actorId: ownerId, guildId: "123", conversationId: "discord:123", checkpointId: first.checkpointId,
      epoch: 1, expectedOwnerBindingVersion: 1, expectedRevision: 3, expectedGeneration: 1, expectedRoutingGeneration: 1,
    })).toMatchObject({ accepted: false, reason: "checkpoint_compare_and_set_lost" });
    expect(conversation.activeCheckpointId).toBe(replacement.checkpointId);
    expect(db.rows("discordCompactionCheckpoints").at(-1)?.nativeCompaction).toBeDefined();
  });
});

describe("bounded staged compaction", () => {
  it("selects deterministic bounded prefixes instead of skipping a >5,000-event backlog", () => {
    const events = Array.from({ length: 10_000 }, (_, ordinal) => ({ eventId: `event:${ordinal}`, ordinal, content: "x" }));
    const first = selectDiscordCheckpointSourceBatch(events, 100);
    expect(first).toHaveLength(5_000);
    expect(first).toEqual(events.slice(0, 5_000));
    expect(selectDiscordCheckpointSourceBatch(events.slice(5_000), 100)).toHaveLength(4_900);
  });

  it("advances contiguous stages, keeps active memory unchanged, and rotates ready guilds fairly", async () => {
    const db = database(); const first = db.conversation("123", 6_000); db.conversation("456", 6_000);
    const response = await invoke(nextPortableCheckpoint, db.ctx, { actorId: ownerId, nativeCompactionSupported: true });
    const request = z.object({
      compactedThroughOrdinal: z.number(), sourceEvents: z.array(z.object({ ordinal: z.number() }).passthrough()),
      inputEstimatedTokens: z.number(),
      conversation: z.object({ guildId: z.string() }).passthrough(),
    }).passthrough().parse(response.request);
    expect(request.conversation.guildId).toBe("123");
    expect(request.sourceEvents.length).toBeLessThanOrEqual(5_000);
    expect(request.inputEstimatedTokens).toBeLessThanOrEqual(190_400);
    expect(checkpointUtf8Bytes(JSON.stringify(response.request))).toBeLessThanOrEqual(1_500_000);
    expect(await invoke(storePortableCheckpoint, db.ctx, await storeArgs(db, first, request.compactedThroughOrdinal)))
      .toMatchObject({ accepted: true, status: "candidate" });
    expect(first.activeCheckpointId).toBeUndefined();
    expect((await durableConversationContext(db.ctx, first, Date.now())).nativeCheckpoint).toBeUndefined();
    const staged = await stagedCheckpointContext(db.ctx, first, Date.now());
    expect(staged?.portableSummary).toBeDefined();
    expect(staged?.nativeCheckpoint).toBeUndefined();
    const other = await invoke(nextPortableCheckpoint, db.ctx, { actorId: ownerId, nativeCompactionSupported: true });
    expect(other.request).toMatchObject({ conversation: { guildId: "456" } });
    db.rows("discordAssistantConversations").splice(1, 1);
    let previous = request.compactedThroughOrdinal;
    for (let stage = 0; stage < 30 && first.activeCheckpointId === undefined; stage += 1) {
      const next = await invoke(nextPortableCheckpoint, db.ctx, { actorId: ownerId, nativeCompactionSupported: true });
      const batch = z.object({ compactedThroughOrdinal: z.number(), inputEstimatedTokens: z.number(), sourceEvents: z.array(z.object({ ordinal: z.number() }).passthrough()) }).passthrough().parse(next.request);
      expect(batch.inputEstimatedTokens).toBeLessThanOrEqual(190_400);
      expect(checkpointUtf8Bytes(JSON.stringify(batch))).toBeLessThanOrEqual(1_500_000);
      expect(batch.previousNativeCheckpoint).toBeUndefined();
      expect(batch.previousSummary).toBeDefined();
      expect(batch.sourceEvents[0]?.ordinal).toBe(previous + 1);
      expect(batch.compactedThroughOrdinal).toBeGreaterThan(previous);
      await invoke(storePortableCheckpoint, db.ctx, await storeArgs(db, first, batch.compactedThroughOrdinal));
      previous = batch.compactedThroughOrdinal;
    }
    expect(first.activeCheckpointId).toBeDefined();
    expect(first.candidateCheckpointId).toBeUndefined();
    const restored = await durableConversationContext(db.ctx, first, Date.now());
    expect(restored.nativeCheckpoint).toBeUndefined();
    expect(restored.portableSummary).toBeDefined();
    expect(restored.tail.complete).toBe(true);
    expect(restored.recentEvents[0]?.ordinal).toBe(previous + 1);
  });

  it("projects previous native data only with the independently checked active source lineage", async () => {
    const db = database(); const conversation = db.conversation("123", 1_200);
    await invoke(storePortableCheckpoint, db.ctx, {
      ...await storeArgs(db, conversation, 1_190), nativeCompaction: await artifact("x".repeat(450_000)),
    });
    const template = db.rows("discordConversationEvents").at(-1)!;
    for (let ordinal = 1_201; ordinal <= 2_700; ordinal += 1) {
      db.rows("discordConversationEvents").push({
        ...template, _id: `event:123:${ordinal}`, eventId: `event:123:${ordinal}`,
        ordinal, revision: ordinal, humanRevision: ordinal,
      });
    }
    conversation.revision = 2_700; conversation.humanRevision = 2_700; conversation.nextOrdinal = 2_701;
    const response = await invoke(nextPortableCheckpoint, db.ctx, { actorId: ownerId, nativeCompactionSupported: true });
    const request = z.object({
      conversation: z.object({ activeCheckpointId: z.string(), activeCheckpointSourceRevision: z.number(), activeCheckpointSourceContextHash: z.string(), activeCheckpointCompactedThroughOrdinal: z.number() }).passthrough(),
      previousNativeCheckpoint: z.object({ checkpointId: z.string(), sourceRevision: z.number(), sourceContextHash: z.string(), compactedThroughOrdinal: z.number(), artifact: z.object({ serializedBytes: z.number() }).passthrough() }).passthrough(),
      inputEstimatedTokens: z.number(), previousSummary: z.json(),
      sourceEvents: z.array(z.object({ eventId: z.string(), ordinal: z.number(), content: z.string() }).passthrough()),
    }).passthrough().parse(response.request);
    expect(request.previousNativeCheckpoint.checkpointId).toBe(request.conversation.activeCheckpointId);
    expect(request.previousNativeCheckpoint.sourceRevision).toBe(request.conversation.activeCheckpointSourceRevision);
    expect(request.previousNativeCheckpoint.sourceContextHash).toBe(request.conversation.activeCheckpointSourceContextHash);
    expect(request.previousNativeCheckpoint.compactedThroughOrdinal).toBe(request.conversation.activeCheckpointCompactedThroughOrdinal);
    expect(request.sourceEvents[0]?.ordinal).toBe(request.previousNativeCheckpoint.compactedThroughOrdinal + 1);
    expect(request.previousNativeCheckpoint.sourceRevision).toBe(1_200);
    const summaryTokens = Math.ceil(checkpointUtf8Bytes(JSON.stringify(request.previousSummary)) / 3) + 8;
    const sourceTokens = request.sourceEvents.reduce((total, event) => total + estimateDiscordCanonicalEventTokens(event), 0);
    expect(request.inputEstimatedTokens).toBe(summaryTokens + sourceTokens);
    expect(sourceTokens + Math.ceil(request.previousNativeCheckpoint.artifact.serializedBytes / 3) + 8).toBeLessThanOrEqual(190_400);
  });

  it("keeps a portable-only predecessor portable even when an older Pi submits delta-only native output", async () => {
    const db = database(); const conversation = db.conversation("123", 3);
    const first = await storeArgs(db, conversation, 1);
    await invoke(storePortableCheckpoint, db.ctx, { ...first, nativeCompaction: undefined });
    const next = await storeArgs(db, conversation, 2);
    expect(await invoke(storePortableCheckpoint, db.ctx, next)).toMatchObject({ accepted: true, status: "active" });
    const row = db.rows("discordCompactionCheckpoints").at(-1)!;
    expect(row.nativeCompaction).toBeUndefined();
    expect(row.serializedBytes).toBe(checkpointUtf8Bytes(portableSummary));
    expect(await invoke(storePortableCheckpoint, db.ctx, next)).toMatchObject({ accepted: true, duplicate: true });
    expect((await durableConversationContext(db.ctx, conversation, Date.now())).portableSummary).toBeDefined();
  });

  it("discards staged state after any frozen source, generation, routing, or revision changes", async () => {
    for (const field of ["generation", "routingGeneration", "revision", "epoch", "ownerBindingVersion"] as const) {
      const db = database(); const conversation = db.conversation("123", 300);
      await invoke(storePortableCheckpoint, db.ctx, await storeArgs(db, conversation, 1));
      expect(conversation.candidateCheckpointId).toBeDefined();
      conversation[field] += 1;
      expect(await stagedCheckpointContext(db.ctx, conversation, Date.now())).toBeUndefined();
      expect(conversation.candidateCheckpointId).toBeUndefined();
      expect(db.rows("discordCompactionCheckpoints")[0]?.nativeCompaction).toBeUndefined();
    }
    for (const change of ["source", "hash", "expiry"] as const) {
      const db = database(); const conversation = db.conversation("123", 300);
      await invoke(storePortableCheckpoint, db.ctx, await storeArgs(db, conversation, 1));
      const row = db.rows("discordCompactionCheckpoints")[0]!;
      if (change === "source") db.rows("discordConversationEvents")[0]!.content = "changed source";
      else if (change === "expiry") row.expiresAt = 0;
      else row.nativeCompaction = { ...await validateNativeCompaction(await artifact(), portableSummary), artifactSha256: "0".repeat(64) };
      expect(await stagedCheckpointContext(db.ctx, conversation, Date.now())).toBeUndefined();
      expect(conversation.candidateCheckpointId).toBeUndefined();
      expect(row.nativeCompaction).toBeUndefined();
    }
  });

  it("keeps native artifacts out of the absent-protocol legacy projections", async () => {
    const extra = { nativeCheckpoint: { artifact: await artifact() }, previousNativeCheckpoint: {} };
    expect(projectLegacyNewestContextResponse({ guildId: "123", channelId: "456", throughSequence: 1, triggerThroughSequence: 1, completedThroughSequence: 0, contextHash: "hash", messages: [], ...extra }))
      .not.toHaveProperty("nativeCheckpoint");
    expect(projectLegacyClaimLoopResponse({ claimed: false, reason: "busy", ...extra })).toEqual({ claimed: false, reason: "busy" });
  });

  it("preserves pre-native durable shapes and refuses staged work without negotiation", async () => {
    const db = database(); const conversation = db.conversation("123", 6_000);
    expect(await invoke(nextPortableCheckpoint, db.ctx, { actorId: ownerId })).toEqual({ available: false });
    const args = await storeArgs(db, conversation, 1);
    expect(await invoke(storePortableCheckpoint, db.ctx, { ...args, nativeCompactionSupported: false }))
      .toMatchObject({ accepted: false, reason: "checkpoint_native_protocol_required" });
    const activeArgs = await storeArgs(db, conversation, 5_990);
    await invoke(storePortableCheckpoint, db.ctx, activeArgs);
    const context = await durableConversationContext(db.ctx, conversation, Date.now());
    const old = projectPreNativeContext(context);
    expect(Object.keys(old).sort()).toEqual(["activeCheckpointId", "portableSummary", "recentEvents", "sourceHumanRevision", "sourceRevision", "tail"]);
    expect(JSON.stringify(old)).not.toContain("opaque-fixture");
    if (context.nativeCheckpoint === undefined) throw new Error("missing_native_fixture");
    const previous = context.nativeCheckpoint;
    const previousConversation = {
      activeCheckpointId: previous.checkpointId,
      activeCheckpointSourceRevision: previous.sourceRevision,
      activeCheckpointSourceContextHash: previous.sourceContextHash,
      activeCheckpointCompactedThroughOrdinal: previous.compactedThroughOrdinal,
    };
    const oldRequest = projectPreNativeCheckpointRequest({
      conversation: previousConversation,
      previousNativeCheckpoint: previous,
      previousSummary: context.portableSummary,
    });
    expect(oldRequest.conversation).toEqual({ activeCheckpointId: activeArgs.checkpointId });
    expect(oldRequest).not.toHaveProperty("previousNativeCheckpoint");
  });

  it.each(["durable-v1", "native-v2"])("dispatches a fresh conversation heartbeat through %s", async (protocol) => {
    vi.stubEnv("DISCORD_GATEWAY_SHARED_SECRET", "fixture-gateway-secret");
    const request = {
      operation: "heartbeat", actorId: ownerId, instanceId: "gateway_1", status: "online",
      run: {
        channelId: "456", runId: "run_1", generation: 1, conversationId: "discord:123",
        epoch: 0, conversationGeneration: 1, routingGeneration: 1, turnId: "turn_1",
        conversationLeaseToken: "lease_1", stage: "triaging",
      },
    };
    const result = { gatewayAccepted: true, loopAccepted: true, leaseExpiresAt: 100 };
    const heartbeat = await gatewayRequest(request, result, protocol);
    expect(heartbeat.response.status).toBe(200);
    expect(heartbeat.body.result).toEqual(result);
    const { operation, ...mutationArgs } = request;
    void operation;
    expect(heartbeat.runMutation).toHaveBeenCalledWith(expect.anything(), mutationArgs);
    const invalid = await gatewayRequest({ ...request, run: { ...request.run, epoch: -1 } }, result, protocol);
    expect(invalid.response.status).toBe(400);
    expect(invalid.runMutation).not.toHaveBeenCalled();
  });

  it("negotiates native fields and checkpoint operations only through the native-v2 HTTP header", async () => {
    vi.stubEnv("DISCORD_GATEWAY_SHARED_SECRET", "fixture-gateway-secret");
    const db = database(); const conversation = db.conversation("123", 3);
    await invoke(storePortableCheckpoint, db.ctx, await storeArgs(db, conversation, 1));
    const durableContext = await durableConversationContext(db.ctx, conversation, Date.now());
    const result = {
      claimed: true as const, idempotent: false, runId: "run:1", generation: 1,
      mode: "messages" as const, channelName: "chat", leaseExpiresAt: 1, windowStart: 1, windowEnd: 2,
      contextHash: "hash", recheckCount: 0, triggerKind: "ambient" as const, replyChannelId: "456",
      messages: [], durableContext,
    };
    const body = { operation: "claimLoop", actorId: ownerId, guildId: "123", channelId: "456", workerId: "worker", claimId: "claim:1" };
    for (const protocol of [undefined, "unknown", "durable-v1", "native-v2"]) {
      const claim = await gatewayRequest(body, result, protocol);
      expect(claim.response.status).toBe(200);
      const expected = protocol === "native-v2" ? result : protocol === "durable-v1"
        ? { ...result, durableContext: projectPreNativeContext(durableContext) }
        : projectLegacyClaimLoopResponse(result);
      expect(claim.body.result).toEqual(expected);
      const next = await gatewayRequest({ operation: "nextPortableCheckpoint", actorId: ownerId }, { available: false }, protocol);
      expect(next.response.status).toBe(200);
      expect(next.runMutation).toHaveBeenCalledWith(expect.anything(), { actorId: ownerId, nativeCompactionSupported: protocol === "native-v2" });
    }
    const forged = await gatewayRequest({ operation: "nextPortableCheckpoint", actorId: ownerId, nativeCompactionSupported: true }, { available: false }, "durable-v1");
    expect(forged.response.status).toBe(400);
    expect(forged.runMutation).not.toHaveBeenCalled();
    const invalidation = await gatewayRequest({
      operation: "invalidateNativeCheckpoint", actorId: ownerId, guildId: "123", conversationId: "discord:123", checkpointId: "checkpoint:123:1",
      epoch: 1, expectedOwnerBindingVersion: 1, expectedRevision: 3, expectedGeneration: 1, expectedRoutingGeneration: 1,
    }, { accepted: true, invalidated: true }, "durable-v1");
    expect(invalidation.response.status).toBe(400);
    expect(invalidation.runMutation).not.toHaveBeenCalled();
  });
});
