/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-chained-type-assertions -- In-memory Convex test harness exercises registered handlers across queries, mutations, actions, and HTTP endpoints. */
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Id } from "../convex/_generated/dataModel.js";
import type { ActionCtx, MutationCtx, QueryCtx } from "../convex/_generated/server.js";
import {
  cancelActiveRun,
  clearChatHistory,
  clearTradeAssistantReview,
  completeRunInternal,
  deleteLesson,
  deleteOrderBatch,
  deleteTrade,
  expireStaleRun,
  getChartByImageKeyInternal,
  getDiary,
  getDiaryForOwner,
  getRunDispatchContextInternal,
  importOrdersInternal,
  listChatMessages,
  markRunRunningInternal,
  migrateDiaryInternal,
  registerChartInternal,
  saveReviewInternal,
  saveSettings,
  sendChatMessage,
  updateRunProgressInternal,
  uploadChartAsset,
  upsertLesson,
  upsertLessonInternal,
  upsertOrderBatch,
  upsertTrade,
  upsertTradeInternal,
} from "../convex/journal.js";
import { cancelRun, startRun } from "../convex/journal_dispatch.js";
import {
  journalAdminMigrate,
  journalAdminUploadChart,
  journalGetDiary,
  journalImportOrders,
  journalRunComplete,
  journalRunProgress,
  journalSaveReview,
  journalUploadChart,
  journalUpsertLesson,
  journalUpsertTrade,
} from "../convex/journal_http.js";
import { journalExecutionRequest, journalExecutionUrl } from "../convex/lib/execution.js";
import {
  chartReviewSchema,
  DEFAULT_BROKER_TIME_ZONE,
  JOURNAL_RUN_TIMEOUT_MS,
  lessonInputSchema,
  MAX_CHART_IMAGE_BYTES,
  normalizeAssistantReview,
  orderSchema,
  parseChartReview,
  referencedChartImageKeys,
  sha256HexBytes,
  sniffChartImage,
  toolEventSchema,
  tradeInputSchema,
  type ChartReview,
  type Order,
  type TradeInput,
} from "../convex/lib/journal.js";
import { mintJournalRunToken, verifyJournalRunToken } from "../convex/lib/journal_token.js";

const USER_A = "user_01HJOURNAL_ALPHA";
const USER_B = "user_01HJOURNAL_BETA";
const USER_DENIED = "user_01HJOURNAL_OUTSIDER";
const SERVICE_SECRET = "journal-test-shared-secret";
const ADMIN_SECRET = "journal-test-admin-secret";

// Minimal 1x1 valid PNG (68 bytes)
const TINY_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

// Minimal 2x2 valid PNG for distinct SHA-256 tests
const SECOND_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x72, 0xb6, 0x0d,
  0x24, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

type Row = Record<string, unknown> & { _id: string; _creationTime: number };

interface StoredBlobRecord {
  id: Id<"_storage">;
  size: number;
  contentType: string;
  sha256: string;
  bytes: Uint8Array;
}

function makeTradeInput(overrides: Partial<TradeInput> = {}): TradeInput {
  return {
    symbol: "qqq",
    instrument: "Options",
    account: "Live",
    direction: "Long",
    status: "Closed",
    openedOn: "2026-11-18",
    closedOn: "2026-11-18",
    setup: "VWAP reclaim",
    size: "2 contracts",
    details: "QQQ 669C 0DTE",
    plannedRiskCents: 25_000,
    realizedPnlCents: 42_500,
    thesis: "Hold opening low and reclaim VWAP with breadth.",
    plan: "Stop below opening range low; trim at prior day high.",
    review: "Good patience on pullback entry.",
    adherence: "Followed",
    mistakes: [],
    ...overrides,
  };
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    contract: "QQQ 2026-11-18 669C",
    submittedAt: "09:42:15",
    status: "Filled",
    side: "Buy",
    type: "Limit",
    quantity: 2,
    averageFillCents: 215,
    realizedPnlCents: null,
    cashCents: -43_000,
    limitCents: 220,
    ...overrides,
  };
}

function makeChartReview(imageKey: string): ChartReview {
  return {
    version: 1,
    instrument: "QQQ 669C",
    timeZone: "AST",
    timing: "09:42–10:15 AST",
    summary: "Clean VWAP reclaim with controlled risk.",
    charts: [
      {
        image: imageKey,
        width: 1600,
        height: 900,
        crop: { x: 100, y: 50, width: 1200, height: 700 },
        focus: { x: 400, y: 200, width: 300, height: 250 },
        focusLabel: "Entry pullback",
        levels: [
          { y: 260, label: "VWAP 668.4" },
          { y: 420, label: "Stop 667.1" },
        ],
        ticks: [
          { x: 300, label: "09:30" },
          { x: 700, label: "10:00" },
        ],
        interval: "1m",
        heading: "1-minute entry execution",
        text: "Entry filled right on the first higher low above VWAP.",
        alt: "1-minute QQQ candlestick chart highlighting VWAP entry zone.",
      },
    ],
    nextTime: "Keep scaling half at first resistance before trailing the runner.",
    note: "Broker timestamps converted to AST.",
  };
}

interface CallableHandler<TCtx, TArgs, TResult> {
  _handler: (ctx: TCtx, args: TArgs) => Promise<TResult>;
}

function invokeHandler<TCtx, TArgs, TResult>(
  fn: unknown,
  ctx: TCtx,
  args: TArgs,
): Promise<TResult> {
  // SAFETY: Convex 1.43.0 registration exposes the underlying handler callback on _handler.
  const registered = fn as CallableHandler<TCtx, TArgs, TResult>;
  return registered._handler(ctx, args);
}

interface HttpCallOptions {
  secret?: string | null;
  runToken?: string | null;
  adminMigration?: boolean;
  contentType?: string | null;
}

function createJournalHarness() {
  const tables = new Map<string, Row[]>();
  const storageMap = new Map<string, StoredBlobRecord>();
  const deletedStorageIds: string[] = [];
  const scheduled: Array<{ name: string; delayMs: number; args: Record<string, unknown> }> = [];
  let nextDocId = 0;
  let nextStorageId = 0;

  const tableRows = (table: string): Row[] => {
    const existing = tables.get(table);
    if (existing) return existing;
    const created: Row[] = [];
    tables.set(table, created);
    return created;
  };

  const findRowById = (id: string): { table: string; row: Row } | null => {
    for (const [table, rows] of tables.entries()) {
      const found = rows.find((row) => row._id === id);
      if (found) return { table, row: found };
    }
    return null;
  };

  const db = {
    query(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let descending = false;
      const indexBuilder = {
        eq(field: string, value: unknown) {
          filters.push((row) => row[field] === value);
          return indexBuilder;
        },
      };
      const compute = () => {
        const matched = tableRows(table).filter((row) => filters.every((fn) => fn(row)));
        if (table === "journalChatMessages") {
          matched.sort((left, right) => Number(left.ordinal) - Number(right.ordinal));
        }
        return descending ? matched.toReversed() : matched;
      };
      const queryObj = {
        withIndex(_name: string, configure: (builder: typeof indexBuilder) => typeof indexBuilder) {
          configure(indexBuilder);
          return queryObj;
        },
        order(direction: "asc" | "desc") {
          descending = direction === "desc";
          return queryObj;
        },
        async collect() {
          return compute();
        },
        async take(count: number) {
          return compute().slice(0, count);
        },
        async first() {
          return compute()[0] ?? null;
        },
        async unique() {
          const matched = compute();
          if (matched.length > 1) throw new Error(`Duplicate unique match on ${table}`);
          return matched[0] ?? null;
        },
      };
      return queryObj;
    },
    async get(id: string) {
      return findRowById(id)?.row ?? null;
    },
    async insert(table: string, value: Record<string, unknown>) {
      const _id = `${table}:${++nextDocId}`;
      tableRows(table).push({ ...value, _id, _creationTime: Date.now() });
      return _id;
    },
    async patch(id: string, fields: Record<string, unknown>) {
      const found = findRowById(id);
      if (!found) throw new Error(`Missing row for patch: ${id}`);
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) delete found.row[key];
        else found.row[key] = value;
      }
    },
    async delete(id: string) {
      const found = findRowById(id);
      if (!found) return;
      const rows = tableRows(found.table);
      const index = rows.findIndex((row) => row._id === id);
      if (index >= 0) rows.splice(index, 1);
    },
    system: {
      async get(id: Id<"_storage">) {
        const record = storageMap.get(id);
        if (!record) return null;
        return {
          _id: record.id,
          _creationTime: Date.now(),
          contentType: record.contentType,
          sha256: record.sha256,
          size: record.size,
        };
      },
    },
  };

  const storage = {
    async store(blob: Blob): Promise<Id<"_storage">> {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const sha256 = await sha256HexBytes(bytes);
      // SAFETY: Test storage harness issues synthetic opaque storage IDs.
      const id = `storage:${++nextStorageId}` as Id<"_storage">;
      storageMap.set(id, {
        id,
        size: bytes.byteLength,
        contentType: blob.type || "application/octet-stream",
        sha256,
        bytes,
      });
      return id;
    },
    async getUrl(id: Id<"_storage">): Promise<string | null> {
      return storageMap.has(id) ? `https://storage.convex.invalid/${id}` : null;
    },
    async delete(id: Id<"_storage">): Promise<void> {
      deletedStorageIds.push(id);
      storageMap.delete(id);
    },
  };

  const scheduler = {
    async runAfter(
      delayMs: number,
      reference: FunctionReference<"action" | "mutation">,
      args: Record<string, unknown>,
    ) {
      scheduled.push({ name: getFunctionName(reference), delayMs, args });
      return `scheduled:${scheduled.length}`;
    },
  };

  const ctxForUser = (subject: string | null): MutationCtx => {
    // SAFETY: Test harness supplies the exact db, storage, scheduler, and auth methods used by journal handlers.
    return ({
      db,
      storage,
      scheduler,
      auth: {
        getUserIdentity: async () => (subject === null ? null : { subject }),
      },
    }) as unknown as MutationCtx;
  };

  const queryRegistry = new Map<string, unknown>([
    ["journal:getDiaryForOwner", getDiaryForOwner],
    ["journal:getChartByImageKeyInternal", getChartByImageKeyInternal],
    ["journal:getRunDispatchContextInternal", getRunDispatchContextInternal],
  ]);

  const mutationRegistry = new Map<string, unknown>([
    ["journal:upsertTradeInternal", upsertTradeInternal],
    ["journal:saveReviewInternal", saveReviewInternal],
    ["journal:upsertLessonInternal", upsertLessonInternal],
    ["journal:importOrdersInternal", importOrdersInternal],
    ["journal:registerChartInternal", registerChartInternal],
    ["journal:migrateDiaryInternal", migrateDiaryInternal],
    ["journal:markRunRunningInternal", markRunRunningInternal],
    ["journal:updateRunProgressInternal", updateRunProgressInternal],
    ["journal:completeRunInternal", completeRunInternal],
    ["journal:expireStaleRun", expireStaleRun],
  ]);

  const actionCtxForUser = (subject: string | null): ActionCtx => {
    // SAFETY: Test harness implements auth, storage, runQuery, and runMutation for registered journal actions and HTTP endpoints.
    return ({
      storage,
      auth: {
        getUserIdentity: async () => (subject === null ? null : { subject }),
      },
      async runQuery(reference: FunctionReference<"query">, args: Record<string, unknown>) {
        const name = getFunctionName(reference);
        const fn = queryRegistry.get(name);
        if (!fn) throw new Error(`Unexpected internal query: ${name}`);
        // SAFETY: MutationCtx is a strict superset of QueryCtx in the in-memory test harness.
        const queryCtx = ctxForUser(null) as unknown as QueryCtx;
        return invokeHandler(fn, queryCtx, args);
      },
      async runMutation(reference: FunctionReference<"mutation">, args: Record<string, unknown>) {
        const name = getFunctionName(reference);
        const fn = mutationRegistry.get(name);
        if (!fn) throw new Error(`Unexpected internal mutation: ${name}`);
        return invokeHandler(fn, ctxForUser(null), args);
      },
    }) as unknown as ActionCtx;
  };

  const actionCtx = actionCtxForUser(null);

  const callHttp = async (
    handler: unknown,
    path: string,
    body: unknown,
    options: HttpCallOptions = {},
  ): Promise<{ status: number; json: Record<string, unknown> }> => {
    const headers = new Headers();
    const contentType = options.contentType === undefined ? "application/json" : options.contentType;
    if (contentType !== null) headers.set("content-type", contentType);
    const secret = options.secret === undefined ? SERVICE_SECRET : options.secret;
    if (secret !== null) headers.set("authorization", `Bearer ${secret}`);
    if (options.runToken) headers.set("x-journal-run-token", options.runToken);
    if (options.adminMigration) headers.set("x-journal-admin-migration", "true");
    const request = new Request(`https://convex.invalid${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const response = await invokeHandler<ActionCtx, Request, Response>(handler, actionCtx, request);
    const json = z.record(z.string(), z.unknown()).parse(await response.json());
    return { status: response.status, json };
  };

  const startActiveRunFor = async (ownerId: string, prompt = "Review my trades") => {
    const sent = await invokeHandler<MutationCtx, Record<string, unknown>, {
      runStableId: string;
      userMessageStableId: string;
      assistantMessageStableId: string;
    }>(sendChatMessage, ctxForUser(ownerId), { text: prompt });
    const runToken = await mintJournalRunToken({ runId: sent.runStableId, ownerId });
    return { ...sent, runToken };
  };

  return {
    tableRows,
    storage,
    storageMap,
    deletedStorageIds,
    scheduled,
    ctxForUser,
    actionCtx,
    actionCtxForUser,
    callHttp,
    startActiveRunFor,
  };
}

beforeEach(() => {
  vi.stubEnv("WORKOS_ALLOWED_USER_IDS", `${USER_A},${USER_B}`);
  vi.stubEnv("SERVICE_SHARED_SECRET", SERVICE_SECRET);
  vi.stubEnv("JOURNAL_ADMIN_SECRET", "");
  vi.stubEnv("EXECUTION_PRIVATE_DOMAIN_SUFFIX", "railway.internal:8080");
  vi.stubEnv("JOURNAL_AGENT_BASE_URL", "");
  vi.stubEnv("EXECUTION_BASE_URL", "");
  vi.stubEnv("MARKET_RESEARCH_OWNER_ID", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("chartReviewSchema, strict nested schemas, and image sniffing", () => {
  const validKey = "a".repeat(64);

  it("parses valid structured chart reviews and extracts unique image keys", () => {
    const review = makeChartReview(validKey);
    const serialized = JSON.stringify(review);

    expect(chartReviewSchema.safeParse(review).success).toBe(true);
    expect(parseChartReview(serialized)).toEqual(review);
    expect(referencedChartImageKeys(serialized)).toEqual([validKey]);
  });

  it("rejects out-of-bounds crop, focus, levels, ticks, malformed image keys, and unknown nested keys", () => {
    const base = makeChartReview(validKey);
    const chart = base.charts[0]!;

    expect(
      chartReviewSchema.safeParse({
        ...base,
        charts: [{ ...chart, crop: { x: 1000, y: 0, width: 700, height: 500 } }],
      }).success,
    ).toBe(false);

    expect(
      chartReviewSchema.safeParse({
        ...base,
        charts: [{ ...chart, focus: { x: 50, y: 200, width: 200, height: 200 } }],
      }).success,
    ).toBe(false);

    expect(
      chartReviewSchema.safeParse({
        ...base,
        charts: [{ ...chart, levels: [{ y: 20, label: "Outside" }] }],
      }).success,
    ).toBe(false);

    expect(
      chartReviewSchema.safeParse({
        ...base,
        charts: [{ ...chart, ticks: [{ x: 1500, label: "11:00" }] }],
      }).success,
    ).toBe(false);

    expect(
      chartReviewSchema.safeParse({
        ...base,
        charts: [{ ...chart, image: "not-a-sha256" }],
      }).success,
    ).toBe(false);

    // Strict nested schemas reject unknown fields rather than silently stripping
    expect(chartReviewSchema.safeParse({ ...base, extraTop: true }).success).toBe(false);
    expect(
      chartReviewSchema.safeParse({
        ...base,
        charts: [{ ...chart, crop: { ...chart.crop, rogue: 1 } }],
      }).success,
    ).toBe(false);
    expect(
      chartReviewSchema.safeParse({
        ...base,
        charts: [{ ...chart, levels: [{ y: 260, label: "VWAP", rogue: 1 }] }],
      }).success,
    ).toBe(false);
    expect(orderSchema.safeParse({ ...makeOrder(), extraField: "nope" }).success).toBe(false);
    expect(tradeInputSchema.safeParse({ ...makeTradeInput(), extraField: "nope" }).success).toBe(false);
    expect(
      lessonInputSchema.safeParse({
        title: "Wait",
        body: "Be patient",
        tradeStableId: null,
        extraField: true,
      }).success,
    ).toBe(false);
    expect(
      toolEventSchema.safeParse({ name: "get_diary", status: "completed", extra: 1 }).success,
    ).toBe(false);
  });

  it("sniffs verified image magic bytes and rejects non-image payloads", () => {
    expect(sniffChartImage(TINY_PNG_BYTES)).toEqual({
      mimeType: "image/png",
      width: 1,
      height: 1,
    });
    expect(() => sniffChartImage(new TextEncoder().encode("<html>not an image</html>"))).toThrow(
      "Unsupported or corrupted image format",
    );
  });

  it("handles plain prose fallback while rejecting invalid JSON starting with '{'", () => {
    expect(parseChartReview("Solid execution, wait for confirmation next time.")).toBeNull();
    expect(referencedChartImageKeys("Plain prose review")).toEqual([]);
    expect(normalizeAssistantReview("  Plain prose review  ")).toEqual({
      stored: "Plain prose review",
      chartReview: null,
      imageKeys: [],
    });
    expect(() => normalizeAssistantReview("{not valid json")).toThrow();
  });
});

describe("authenticated chart upload integrity and owner isolation", () => {
  it("uploadChartAsset sniffs real bytes, computes SHA-256 server-side, deduplicates safely, and isolates owners", async () => {
    const h = createJournalHarness();
    const ctxA = h.ctxForUser(USER_A);
    const ctxB = h.ctxForUser(USER_B);
    const actionA = h.actionCtxForUser(USER_A);
    const actionB = h.actionCtxForUser(USER_B);
    const actionUnauth = h.actionCtxForUser(null);

    const pngBase64 = Buffer.from(TINY_PNG_BYTES).toString("base64");
    const expectedKey = await sha256HexBytes(TINY_PNG_BYTES);

    // Unauthenticated rejected
    await expect(
      invokeHandler(uploadChartAsset, actionUnauth, { base64Data: pngBase64 }),
    ).rejects.toThrow("Authentication required.");

    // Corrupted / non-image bytes rejected (cannot smuggle HTML/JS as chart)
    await expect(
      invokeHandler(uploadChartAsset, actionA, {
        base64Data: Buffer.from("<script>alert(1)</script>").toString("base64"),
      }),
    ).rejects.toThrow("Unsupported or corrupted image format");

    // Oversized decoded image (> 10 MB) rejected
    await expect(
      invokeHandler(uploadChartAsset, actionA, {
        base64Data: Buffer.alloc(MAX_CHART_IMAGE_BYTES + 3, 1).toString("base64"),
      }),
    ).rejects.toThrow("Chart image size must be between 1 byte");

    // Valid upload succeeds with server-derived imageKey, mimeType, and dimensions
    const uploadedA = await invokeHandler<ActionCtx, Record<string, unknown>, {
      imageKey: string;
      storageId: Id<"_storage">;
      mimeType: string;
      width: number;
      height: number;
      url: string;
    }>(uploadChartAsset, actionA, {
      base64Data: pngBase64,
      filename: "qqq-1m.png",
      symbol: "QQQ",
      interval: "1m",
    });
    expect(uploadedA).toEqual({
      imageKey: expectedKey,
      storageId: expect.any(String),
      mimeType: "image/png",
      width: 1,
      height: 1,
      url: expect.stringContaining("https://storage.convex.invalid/"),
    });
    expect(h.storageMap.size).toBe(1);
    expect(h.deletedStorageIds).toHaveLength(0);

    // Repeat upload by User A returns existing record WITHOUT uploading or deleting anything
    const uploadedAgain = await invokeHandler<ActionCtx, Record<string, unknown>, { storageId: Id<"_storage"> }>(
      uploadChartAsset,
      actionA,
      { base64Data: pngBase64 },
    );
    expect(uploadedAgain.storageId).toBe(uploadedA.storageId);
    expect(h.storageMap.size).toBe(1);
    expect(h.deletedStorageIds).toHaveLength(0);

    // Concurrent dedup race: registerChartInternal never deletes existing referenced storageId
    const secondBlobId = await h.storage.store(new Blob([TINY_PNG_BYTES], { type: "image/png" }));
    const raceResult = await invokeHandler<MutationCtx, Record<string, unknown>, {
      deduplicated: boolean;
      chart: { storageId: Id<"_storage"> };
    }>(registerChartInternal, h.ctxForUser(null), {
      ownerId: USER_A,
      imageKey: expectedKey,
      storageId: secondBlobId,
      mimeType: "image/png",
      width: 1,
      height: 1,
      source: "upload",
    });
    expect(raceResult.deduplicated).toBe(true);
    expect(raceResult.chart.storageId).toBe(uploadedA.storageId);
    expect(h.storageMap.has(uploadedA.storageId)).toBe(true);
    expect(h.deletedStorageIds).toHaveLength(0);
    await h.storage.delete(secondBlobId);

    // User B cannot attach User A's chart imageKey in sendChatMessage
    await expect(
      invokeHandler(sendChatMessage, ctxB, {
        text: "Steal User A chart",
        attachments: [{ imageKey: expectedKey, filename: "stolen.png" }],
      }),
    ).rejects.toThrow("Attachment must reference an uploaded chart owned by this user.");

    // User A attaches own chart by imageKey; storageId and verified mimeType come from journalCharts
    await invokeHandler(sendChatMessage, ctxA, {
      text: "Review my chart",
      attachments: [{ imageKey: expectedKey, filename: "qqq-1m.png" }],
    });
    const messagesA = await invokeHandler<MutationCtx, Record<string, unknown>, Array<{
      attachments: Array<{ storageId: Id<"_storage">; imageKey: string; mimeType: string; url: string | null }>;
    }>>(listChatMessages, ctxA, {});
    expect(messagesA[0]?.attachments).toEqual([
      {
        storageId: uploadedA.storageId,
        imageKey: expectedKey,
        mimeType: "image/png",
        filename: "qqq-1m.png",
        url: uploadedA.url,
      },
    ]);

    // User B has empty diary and cannot see User A's chartUrls
    const diaryB = await invokeHandler<MutationCtx, Record<string, never>, {
      settings: { brokerTimeZone: string };
      trades: unknown[];
      chartUrls: Record<string, string>;
    }>(getDiary, ctxB, {});
    expect(diaryB.settings.brokerTimeZone).toBe(DEFAULT_BROKER_TIME_ZONE);
    expect(diaryB.trades).toHaveLength(0);
    expect(diaryB.chartUrls).toEqual({});

    // User B uploading same PNG gets its own isolated record
    const uploadedB = await invokeHandler<ActionCtx, Record<string, unknown>, { storageId: Id<"_storage"> }>(
      uploadChartAsset,
      actionB,
      { base64Data: pngBase64 },
    );
    expect(uploadedB.storageId).not.toBe(uploadedA.storageId);
  });

  it("isolates settings, trades, lessons, order batches, and preserves reviews on upsertTrade", async () => {
    const h = createJournalHarness();
    const ctxA = h.ctxForUser(USER_A);
    const ctxB = h.ctxForUser(USER_B);

    await expect(invokeHandler(getDiary, h.ctxForUser(USER_DENIED), {})).rejects.toThrow(
      "WorkOS user is not allowed.",
    );

    await invokeHandler(saveSettings, ctxA, {
      brokerTimeZone: "America/New_York",
      tradingViewLayoutId: "layout_a",
    });
    const preservedSettings = await invokeHandler<MutationCtx, Record<string, unknown>, {
      brokerTimeZone: string;
      tradingViewLayoutId?: string;
    }>(saveSettings, ctxA, { brokerTimeZone: "America/Chicago" });
    expect(preservedSettings.tradingViewLayoutId).toBe("layout_a");

    await invokeHandler(upsertTrade, ctxA, { stableId: "trade-a-1", trade: makeTradeInput() });
    await invokeHandler(upsertOrderBatch, ctxA, {
      stableId: "batch-a-1",
      batch: { date: "2026-11-18", note: "Session", orders: [makeOrder()] },
    });
    await invokeHandler(upsertLesson, ctxA, {
      stableId: "lesson-a-1",
      lesson: { title: "Patience", body: "Wait for retest.", tradeStableId: "trade-a-1" },
    });

    // User B cannot link or delete User A's records
    await expect(
      invokeHandler(upsertLesson, ctxB, {
        lesson: { title: "Bad", body: "Cross-tenant", tradeStableId: "trade-a-1" },
      }),
    ).rejects.toThrow("Referenced trade does not exist.");
    expect(await invokeHandler(deleteTrade, ctxB, { stableId: "trade-a-1" })).toEqual({
      deleted: false,
      unlinkedLessons: 0,
    });
    expect(await invokeHandler(deleteLesson, ctxB, { stableId: "lesson-a-1" })).toEqual({
      deleted: false,
    });
    expect(await invokeHandler(deleteOrderBatch, ctxB, { stableId: "batch-a-1" })).toEqual({
      deleted: false,
    });

    // Review preserved on upsertTrade, cleared explicitly via clearTradeAssistantReview
    const run = await h.startActiveRunFor(USER_A);
    await invokeHandler(saveReviewInternal, h.ctxForUser(null), {
      ownerId: USER_A,
      runStableId: run.runStableId,
      tradeStableId: "trade-a-1",
      assistantReview: "Good discipline.",
    });
    const updated = await invokeHandler<MutationCtx, Record<string, unknown>, { assistantReview: string | null }>(
      upsertTrade,
      ctxA,
      { stableId: "trade-a-1", trade: makeTradeInput({ setup: "Updated" }) },
    );
    expect(updated.assistantReview).toBe("Good discipline.");

    const cleared = await invokeHandler<MutationCtx, Record<string, unknown>, { assistantReview: string | null }>(
      clearTradeAssistantReview,
      ctxA,
      { stableId: "trade-a-1" },
    );
    expect(cleared.assistantReview).toBeNull();

    // Deleting trade unlinks owner's lesson
    expect(await invokeHandler(deleteTrade, ctxA, { stableId: "trade-a-1" })).toEqual({
      deleted: true,
      unlinkedLessons: 1,
    });
  });
});

describe("run-scoped capability tokens, active-run enforcement, and streamed body limits", () => {
  it("verifies HMAC-SHA256 run tokens and rejects expired, tampered, or mismatched tokens", async () => {
    const now = 1_700_000_000_000;
    const token = await mintJournalRunToken({
      runId: "run-123",
      ownerId: USER_A,
      ttlMs: 60_000,
      nowMs: now,
    });

    const valid = await verifyJournalRunToken(token, { ownerId: USER_A, runId: "run-123" }, now + 1_000);
    expect(valid.ok).toBe(true);

    const expired = await verifyJournalRunToken(token, { ownerId: USER_A, runId: "run-123" }, now + 61_000);
    expect(expired).toEqual({ ok: false, code: "expired", error: "Run token has expired." });

    const wrongOwner = await verifyJournalRunToken(token, { ownerId: USER_B, runId: "run-123" }, now + 1_000);
    expect(wrongOwner).toEqual({
      ok: false,
      code: "owner_mismatch",
      error: "Run token owner does not match request.",
    });

    const wrongRun = await verifyJournalRunToken(token, { ownerId: USER_A, runId: "run-999" }, now + 1_000);
    expect(wrongRun).toEqual({
      ok: false,
      code: "run_mismatch",
      error: "Run token runId does not match request.",
    });

    const tampered = await verifyJournalRunToken(`${token}x`, { ownerId: USER_A, runId: "run-123" }, now + 1_000);
    expect(tampered.ok).toBe(false);
  });

  it("enforces runToken and active run status on every worker tool route and blocks forged mimeType", async () => {
    const h = createJournalHarness();
    const runA = await h.startActiveRunFor(USER_A);
    const runB = await h.startActiveRunFor(USER_B);
    const expiredToken = await mintJournalRunToken({
      runId: runA.runStableId,
      ownerId: USER_A,
      ttlMs: 1_000,
      nowMs: Date.now() - 10_000,
    });

    // Missing runToken -> 401
    const noToken = await h.callHttp(
      journalUpsertTrade,
      "/internal/journal/tools/upsert-trade",
      { ownerId: USER_A, stableId: "t-1", trade: makeTradeInput() },
    );
    expect(noToken.status).toBe(401);

    // Wrong owner runToken -> 403
    const wrongOwnerToken = await h.callHttp(
      journalUpsertTrade,
      "/internal/journal/tools/upsert-trade",
      { ownerId: USER_A, stableId: "t-1", trade: makeTradeInput() },
      { runToken: runB.runToken },
    );
    expect(wrongOwnerToken.status).toBe(403);

    // Expired runToken -> 401
    const expiredRes = await h.callHttp(
      journalUpsertTrade,
      "/internal/journal/tools/upsert-trade",
      { ownerId: USER_A, stableId: "t-1", trade: makeTradeInput() },
      { runToken: expiredToken },
    );
    expect(expiredRes.status).toBe(401);

    // Valid runToken succeeds
    const upsertOk = await h.callHttp(
      journalUpsertTrade,
      "/internal/journal/tools/upsert-trade",
      { ownerId: USER_A, stableId: "t-1", trade: makeTradeInput() },
      { runToken: runA.runToken },
    );
    expect(upsertOk.status).toBe(200);

    // Worker upload-chart rejects forged mimeType (PNG bytes declared as image/jpeg)
    const pngBase64 = Buffer.from(TINY_PNG_BYTES).toString("base64");
    const forgedMime = await h.callHttp(
      journalUploadChart,
      "/internal/journal/tools/upload-chart",
      { ownerId: USER_A, base64Data: pngBase64, mimeType: "image/jpeg" },
      { runToken: runA.runToken },
    );
    expect(forgedMime.status).toBe(400);
    expect(String(forgedMime.json.error)).toContain("do not match declared mimeType");
    expect(h.storageMap.size).toBe(0);

    // Worker upload-chart accepts verified PNG bytes and deduplicates cleanly
    const chartUpload = await h.callHttp(
      journalUploadChart,
      "/internal/journal/tools/upload-chart",
      { ownerId: USER_A, base64Data: pngBase64, mimeType: "image/png" },
      { runToken: runA.runToken },
    );
    expect(chartUpload.status).toBe(200);
    const chartKeyA = await sha256HexBytes(TINY_PNG_BYTES);
    expect(chartUpload.json.imageKey).toBe(chartKeyA);

    // Save structured review referencing owned chart succeeds
    const reviewOk = await h.callHttp(
      journalSaveReview,
      "/internal/journal/tools/save-review",
      { ownerId: USER_A, tradeStableId: "t-1", assistantReview: makeChartReview(chartKeyA) },
      { runToken: runA.runToken },
    );
    expect(reviewOk.status).toBe(200);

    // Cancel User A's run: EVERY worker tool route now returns 409 run_not_active!
    await invokeHandler(cancelActiveRun, h.ctxForUser(USER_A), {});

    const afterCancelUpsert = await h.callHttp(
      journalUpsertTrade,
      "/internal/journal/tools/upsert-trade",
      { ownerId: USER_A, stableId: "t-2", trade: makeTradeInput() },
      { runToken: runA.runToken },
    );
    expect(afterCancelUpsert.status).toBe(409);
    expect(afterCancelUpsert.json.error).toBe("run_not_active");

    const afterCancelImport = await h.callHttp(
      journalImportOrders,
      "/internal/journal/tools/import-orders",
      { ownerId: USER_A, orderDays: [], trades: [] },
      { runToken: runA.runToken },
    );
    expect(afterCancelImport.status).toBe(409);

    const afterCancelReview = await h.callHttp(
      journalSaveReview,
      "/internal/journal/tools/save-review",
      { ownerId: USER_A, tradeStableId: "t-1", assistantReview: "Late review" },
      { runToken: runA.runToken },
    );
    expect(afterCancelReview.status).toBe(409);

    const afterCancelLesson = await h.callHttp(
      journalUpsertLesson,
      "/internal/journal/tools/upsert-lesson",
      {
        ownerId: USER_A,
        lesson: { title: "Late", body: "Should fail", tradeStableId: null },
      },
      { runToken: runA.runToken },
    );
    expect(afterCancelLesson.status).toBe(409);

    const afterCancelDiary = await h.callHttp(
      journalGetDiary,
      "/internal/journal/tools/get-diary",
      { ownerId: USER_A },
      { runToken: runA.runToken },
    );
    expect(afterCancelDiary.status).toBe(409);

    const storageCountBefore = h.storageMap.size;
    const afterCancelUpload = await h.callHttp(
      journalUploadChart,
      "/internal/journal/tools/upload-chart",
      {
        ownerId: USER_A,
        base64Data: Buffer.from(SECOND_PNG_BYTES).toString("base64"),
        mimeType: "image/png",
      },
      { runToken: runA.runToken },
    );
    expect(afterCancelUpload.status).toBe(409);
    expect(h.storageMap.size).toBe(storageCountBefore);
  });

  it("enforces application/json Content-Type, streamed raw-byte cap without Content-Length, and strict nested payloads", async () => {
    const h = createJournalHarness();
    const runA = await h.startActiveRunFor(USER_A);

    // Wrong Content-Type -> 415
    const wrongContentType = await h.callHttp(
      journalGetDiary,
      "/internal/journal/tools/get-diary",
      { ownerId: USER_A },
      { runToken: runA.runToken, contentType: "text/plain" },
    );
    expect(wrongContentType.status).toBe(415);

    // Unknown nested field rejected with 400
    const unknownNested = await h.callHttp(
      journalUpsertTrade,
      "/internal/journal/tools/upsert-trade",
      { ownerId: USER_A, trade: { ...makeTradeInput(), unknownNestedKey: "bad" } },
      { runToken: runA.runToken },
    );
    expect(unknownNested.status).toBe(400);

    // Streamed body exceeding 2 MiB WITHOUT Content-Length header is canceled and rejected with 413
    let chunksPulled = 0;
    let streamCanceled = false;
    const chunk = new Uint8Array(512 * 1024).fill(0x61); // 512 KiB of 'a'
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksPulled += 1;
        controller.enqueue(chunk);
        if (chunksPulled >= 20) controller.close();
      },
      cancel() {
        streamCanceled = true;
      },
    });
    const oversizedRequest = new Request("https://convex.invalid/internal/journal/tools/get-diary", {
      method: "POST",
      headers: {
        authorization: `Bearer ${SERVICE_SECRET}`,
        "content-type": "application/json",
        "x-journal-run-token": runA.runToken,
      },
      body: stream,
      // @ts-expect-error Node fetch RequestInit supports duplex for streamed bodies
      duplex: "half",
    });
    const response = await invokeHandler<ActionCtx, Request, Response>(
      journalGetDiary,
      h.actionCtx,
      oversizedRequest,
    );
    expect(response.status).toBe(413);
    expect(streamCanceled).toBe(true);
    expect(chunksPulled).toBeLessThanOrEqual(6);
  });
});

describe("dedicated admin migration routes", () => {
  it("requires admin header/secret, preserves updatedAt, and respects replaceExistingReviews", async () => {
    const h = createJournalHarness();
    vi.stubEnv("JOURNAL_ADMIN_SECRET", ADMIN_SECRET);

    const pngBase64 = Buffer.from(TINY_PNG_BYTES).toString("base64");
    const chartKey = await sha256HexBytes(TINY_PNG_BYTES);

    // Missing admin header -> 401
    const noHeader = await h.callHttp(
      journalAdminUploadChart,
      "/internal/journal/admin/upload-chart",
      { ownerId: USER_A, base64Data: pngBase64 },
      { secret: ADMIN_SECRET, adminMigration: false },
    );
    expect(noHeader.status).toBe(401);

    // Service secret rejected when JOURNAL_ADMIN_SECRET is configured
    const wrongSecret = await h.callHttp(
      journalAdminUploadChart,
      "/internal/journal/admin/upload-chart",
      { ownerId: USER_A, base64Data: pngBase64 },
      { secret: SERVICE_SECRET, adminMigration: true },
    );
    expect(wrongSecret.status).toBe(401);

    // Admin chart upload succeeds
    const uploadOk = await h.callHttp(
      journalAdminUploadChart,
      "/internal/journal/admin/upload-chart",
      { ownerId: USER_A, base64Data: pngBase64, mimeType: "image/png" },
      { secret: ADMIN_SECRET, adminMigration: true },
    );
    expect(uploadOk.status).toBe(200);
    expect(uploadOk.json.imageKey).toBe(chartKey);

    // Atomic migration preserves source updatedAt timestamps
    const sourceTs = 1_760_000_000_000;
    const firstMigrate = await h.callHttp(
      journalAdminMigrate,
      "/internal/journal/admin/migrate",
      {
        ownerId: USER_A,
        orderDays: [
          {
            stableId: "batch-mig-1",
            date: "2026-11-18",
            note: "Migrated orders",
            orders: [makeOrder()],
            updatedAt: sourceTs,
          },
        ],
        trades: [
          {
            stableId: "trade-mig-1",
            trade: makeTradeInput(),
            assistantReview: makeChartReview(chartKey),
            updatedAt: sourceTs,
          },
        ],
        lessons: [
          {
            stableId: "lesson-mig-1",
            lesson: {
              title: "Migrated lesson",
              body: "Linked to migrated trade",
              tradeStableId: "trade-mig-1",
            },
            updatedAt: sourceTs,
          },
        ],
      },
      { secret: ADMIN_SECRET, adminMigration: true },
    );
    expect(firstMigrate.status).toBe(200);
    expect(firstMigrate.json).toEqual({
      orderDays: 1,
      trades: 1,
      lessons: 1,
      preservedReviews: 0,
    });

    const diaryAfterFirst = await invokeHandler<MutationCtx, Record<string, never>, {
      trades: Array<{ stableId: string; updatedAt: number; assistantReview: string | null }>;
      lessons: Array<{ stableId: string; updatedAt: number }>;
      orderDays: Array<{ stableId: string; updatedAt: number }>;
    }>(getDiary, h.ctxForUser(USER_A), {});
    expect(diaryAfterFirst.trades[0]?.updatedAt).toBe(sourceTs);
    expect(diaryAfterFirst.lessons[0]?.updatedAt).toBe(sourceTs);
    expect(diaryAfterFirst.orderDays[0]?.updatedAt).toBe(sourceTs);

    // Update the trade's review via an active run (newer timestamp than sourceTs)
    const runA = await h.startActiveRunFor(USER_A);
    await invokeHandler(saveReviewInternal, h.ctxForUser(null), {
      ownerId: USER_A,
      runStableId: runA.runStableId,
      tradeStableId: "trade-mig-1",
      assistantReview: "Newer live review from assistant.",
    });

    // Replaying migration with replaceExistingReviews=false MUST preserve the newer review
    const replaySafe = await h.callHttp(
      journalAdminMigrate,
      "/internal/journal/admin/migrate",
      {
        ownerId: USER_A,
        replaceExistingReviews: false,
        orderDays: [],
        trades: [
          {
            stableId: "trade-mig-1",
            trade: makeTradeInput(),
            assistantReview: "Older migrated review",
            updatedAt: sourceTs,
          },
        ],
        lessons: [],
      },
      { secret: ADMIN_SECRET, adminMigration: true },
    );
    expect(replaySafe.status).toBe(200);
    expect(replaySafe.json.preservedReviews).toBe(1);

    const diaryAfterReplay = await invokeHandler<MutationCtx, Record<string, never>, {
      trades: Array<{ assistantReview: string | null }>;
    }>(getDiary, h.ctxForUser(USER_A), {});
    expect(diaryAfterReplay.trades[0]?.assistantReview).toBe("Newer live review from assistant.");

    // Explicit replaceExistingReviews=true overwrites the review
    const replayReplace = await h.callHttp(
      journalAdminMigrate,
      "/internal/journal/admin/migrate",
      {
        ownerId: USER_A,
        replaceExistingReviews: true,
        orderDays: [],
        trades: [
          {
            stableId: "trade-mig-1",
            trade: makeTradeInput(),
            assistantReview: "Explicitly replaced review",
            updatedAt: sourceTs,
          },
        ],
        lessons: [],
      },
      { secret: ADMIN_SECRET, adminMigration: true },
    );
    expect(replayReplace.status).toBe(200);
    expect(replayReplace.json.preservedReviews).toBe(0);

    const diaryAfterReplace = await invokeHandler<MutationCtx, Record<string, never>, {
      trades: Array<{ assistantReview: string | null }>;
    }>(getDiary, h.ctxForUser(USER_A), {});
    expect(diaryAfterReplace.trades[0]?.assistantReview).toBe("Explicitly replaced review");
  });
});

describe("journalExecutionRequest routing and redirect protection", () => {
  it("routes with base URL precedence, MARKET_RESEARCH_OWNER_ID fallback, and redirect='error'", async () => {
    vi.stubEnv("MARKET_RESEARCH_OWNER_ID", USER_A);
    const urlForA = await journalExecutionUrl(USER_A, "/v1/journal/runs");
    const urlForB = await journalExecutionUrl(USER_B, "/v1/journal/runs");
    expect(urlForA).toBe(urlForB);

    vi.stubEnv("JOURNAL_AGENT_BASE_URL", "https://journal-agent.internal/");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accepted: true, runId: "run-1" }), { status: 202 }),
    );
    await journalExecutionRequest(USER_B, "/v1/journal/runs", { runId: "run-1" }, { timeoutMs: 5_000 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://journal-agent.internal/v1/journal/runs",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
      }),
    );
  });
});

describe("chat run lifecycle, timeouts, error recovery, and bounded history", () => {
  it("mints runToken on dispatch, validates 202 response, handles progress/complete, and bounds chat list/clear", async () => {
    const h = createJournalHarness();
    const ctxA = h.ctxForUser(USER_A);
    vi.stubEnv("JOURNAL_AGENT_BASE_URL", "https://journal-agent.internal");

    const sent = await invokeHandler<MutationCtx, Record<string, unknown>, {
      runStableId: string;
    }>(sendChatMessage, ctxA, { text: "Review my QQQ trade" });

    // Schedules BOTH startRun (0ms) and durable expireStaleRun (5 min)
    expect(h.scheduled).toHaveLength(2);
    expect(h.scheduled[0]?.name).toBe("journal_dispatch:startRun");
    expect(h.scheduled[1]?.name).toBe("journal:expireStaleRun");
    expect(h.scheduled[1]?.delayMs).toBe(JOURNAL_RUN_TIMEOUT_MS);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accepted: true, runId: sent.runStableId }), { status: 202 }),
    );

    const dispatchResult = await invokeHandler<ActionCtx, Record<string, unknown>, { dispatched: boolean }>(
      startRun,
      h.actionCtx,
      { ownerId: USER_A, runStableId: sent.runStableId },
    );
    expect(dispatchResult).toEqual({ dispatched: true });

    const dispatchedPayload = z
      .object({
        runId: z.string(),
        ownerId: z.string(),
        runToken: z.string().min(10),
      })
      .parse(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)));
    expect(dispatchedPayload.runId).toBe(sent.runStableId);

    const progressRes = await h.callHttp(
      journalRunProgress,
      "/internal/journal/runs/progress",
      {
        ownerId: USER_A,
        runId: sent.runStableId,
        text: "Inspecting trades...",
        toolEvents: [{ name: "get_diary", status: "completed", summary: "Loaded diary" }],
      },
      { runToken: dispatchedPayload.runToken },
    );
    expect(progressRes.status).toBe(200);

    const completeRes = await h.callHttp(
      journalRunComplete,
      "/internal/journal/runs/complete",
      {
        ownerId: USER_A,
        runId: sent.runStableId,
        status: "completed",
        text: "Review complete.",
      },
      { runToken: dispatchedPayload.runToken },
    );
    expect(completeRes.status).toBe(200);

    // expireStaleRun does NOT touch already-completed run
    expect(
      await invokeHandler(expireStaleRun, h.ctxForUser(null), { runStableId: sent.runStableId }),
    ).toEqual({ expired: false });

    // Create a second completed turn to verify bounded listChatMessages & batched clearChatHistory
    const sent2 = await invokeHandler<MutationCtx, Record<string, unknown>, { runStableId: string }>(
      sendChatMessage,
      ctxA,
      { text: "Second question" },
    );
    await invokeHandler(completeRunInternal, h.ctxForUser(null), {
      ownerId: USER_A,
      runId: sent2.runStableId,
      status: "completed",
      text: "Second answer",
    });

    const latestTwo = await invokeHandler<MutationCtx, Record<string, unknown>, Array<{ ordinal: number; text: string }>>(
      listChatMessages,
      ctxA,
      { limit: 2 },
    );
    expect(latestTwo.map((message) => message.ordinal)).toEqual([3, 4]);
    expect(latestTwo[1]?.text).toBe("Second answer");

    const batch1 = await invokeHandler<MutationCtx, Record<string, unknown>, {
      deletedMessages: number;
      deletedRuns: number;
      hasMore: boolean;
    }>(clearChatHistory, ctxA, { batchSize: 2 });
    expect(batch1).toEqual({ deletedMessages: 2, deletedRuns: 2, hasMore: true });

    const batch2 = await invokeHandler<MutationCtx, Record<string, unknown>, {
      deletedMessages: number;
      deletedRuns: number;
      hasMore: boolean;
    }>(clearChatHistory, ctxA, { batchSize: 2 });
    expect(batch2).toEqual({ deletedMessages: 2, deletedRuns: 0, hasMore: false });
  });

  it("marks run failed on preparation/token error or invalid 202 body, expires stale runs, and retries cancelRun once", async () => {
    const h = createJournalHarness();
    const ctxA = h.ctxForUser(USER_A);
    vi.stubEnv("JOURNAL_AGENT_BASE_URL", "https://journal-agent.internal");

    // 1. Preparation/token minting error (missing SERVICE_SHARED_SECRET) marks run failed instead of stranding in pending
    const sent1 = await invokeHandler<MutationCtx, Record<string, unknown>, { runStableId: string }>(
      sendChatMessage,
      ctxA,
      { text: "Will fail during token minting" },
    );
    vi.stubEnv("SERVICE_SHARED_SECRET", "");
    const failedMint = await invokeHandler<ActionCtx, Record<string, unknown>, { dispatched: boolean }>(
      startRun,
      h.actionCtx,
      { ownerId: USER_A, runStableId: sent1.runStableId },
    );
    expect(failedMint).toEqual({ dispatched: false });
    const msgsAfterMintFail = await invokeHandler<MutationCtx, Record<string, unknown>, Array<{ status: string; error?: string }>>(
      listChatMessages,
      ctxA,
      {},
    );
    expect(msgsAfterMintFail.at(-1)?.status).toBe("failed");
    expect(msgsAfterMintFail.at(-1)?.error).toContain("SERVICE_SHARED_SECRET");

    // 2. Invalid 202 body (wrong runId) fails the run instead of marking running
    vi.stubEnv("SERVICE_SHARED_SECRET", SERVICE_SECRET);
    const sent2 = await invokeHandler<MutationCtx, Record<string, unknown>, { runStableId: string }>(
      sendChatMessage,
      ctxA,
      { text: "Bad 202 response" },
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ accepted: true, runId: "wrong-run-id" }), { status: 202 }),
    );
    const badAck = await invokeHandler<ActionCtx, Record<string, unknown>, { dispatched: boolean }>(
      startRun,
      h.actionCtx,
      { ownerId: USER_A, runStableId: sent2.runStableId },
    );
    expect(badAck).toEqual({ dispatched: false });
    const msgsAfterBadAck = await invokeHandler<MutationCtx, Record<string, unknown>, Array<{ status: string; error?: string }>>(
      listChatMessages,
      ctxA,
      {},
    );
    expect(msgsAfterBadAck.at(-1)?.status).toBe("failed");

    // 3. expireStaleRun fails a still-running run
    const sent3 = await invokeHandler<MutationCtx, Record<string, unknown>, { runStableId: string }>(
      sendChatMessage,
      ctxA,
      { text: "Will time out" },
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ accepted: true, runId: sent3.runStableId }), { status: 202 }),
    );
    await invokeHandler(startRun, h.actionCtx, { ownerId: USER_A, runStableId: sent3.runStableId });
    expect(
      await invokeHandler(expireStaleRun, h.ctxForUser(null), { runStableId: sent3.runStableId }),
    ).toEqual({ expired: true });
    const msgsAfterTimeout = await invokeHandler<MutationCtx, Record<string, unknown>, Array<{ status: string; error?: string }>>(
      listChatMessages,
      ctxA,
      {},
    );
    expect(msgsAfterTimeout.at(-1)?.status).toBe("failed");
    expect(msgsAfterTimeout.at(-1)?.error).toContain("timed out");

    // 4. cancelRun retries once on 503 and succeeds on second attempt; cancel race still protected
    const sent4 = await invokeHandler<MutationCtx, Record<string, unknown>, { runStableId: string }>(
      sendChatMessage,
      ctxA,
      { text: "Will cancel with retry" },
    );
    const token4 = await mintJournalRunToken({ runId: sent4.runStableId, ownerId: USER_A });
    await invokeHandler(cancelActiveRun, ctxA, {});

    const retryFetch = vi.spyOn(globalThis, "fetch");
    retryFetch.mockClear();
    retryFetch
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ canceled: true }), { status: 200 }));
    const cancelRes = await invokeHandler<ActionCtx, Record<string, unknown>, { notified: boolean }>(
      cancelRun,
      h.actionCtx,
      { ownerId: USER_A, runStableId: sent4.runStableId },
    );
    expect(cancelRes).toEqual({ notified: true });
    expect(retryFetch).toHaveBeenCalledTimes(2);

    // expireStaleRun and late complete do NOT overwrite canceled
    expect(
      await invokeHandler(expireStaleRun, h.ctxForUser(null), { runStableId: sent4.runStableId }),
    ).toEqual({ expired: false });
    const lateComplete = await h.callHttp(
      journalRunComplete,
      "/internal/journal/runs/complete",
      { ownerId: USER_A, runId: sent4.runStableId, status: "completed", text: "Too late" },
      { runToken: token4 },
    );
    expect(lateComplete.status).toBe(409);
    expect(lateComplete.json.reason).toBe("run_already_canceled");
  });
});
