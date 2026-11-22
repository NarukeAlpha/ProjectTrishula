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
  generateUploadUrl,
  getChartByImageKeyInternal,
  getDiary,
  getDiaryForOwner,
  importOrdersInternal,
  listChatMessages,
  prepareRunDispatchInternal,
  registerUploadedChart,
  saveReviewInternal,
  saveSettings,
  sendChatMessage,
  updateRunProgressInternal,
  upsertChartInternal,
  upsertLesson,
  upsertLessonInternal,
  upsertOrderBatch,
  upsertTrade,
  upsertTradeInternal,
} from "../convex/journal.js";
import { cancelRun, startRun } from "../convex/journal_dispatch.js";
import {
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
  MAX_CHART_IMAGE_BYTES,
  normalizeAssistantReview,
  parseChartReview,
  referencedChartImageKeys,
  sha256HexBytes,
  type ChartReview,
  type Order,
  type TradeInput,
} from "../convex/lib/journal.js";

const USER_A = "user_01HJOURNAL_ALPHA";
const USER_B = "user_01HJOURNAL_BETA";
const USER_DENIED = "user_01HJOURNAL_OUTSIDER";
const SERVICE_SECRET = "journal-test-shared-secret";

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

function createJournalHarness() {
  const tables = new Map<string, Row[]>();
  const storageMap = new Map<string, StoredBlobRecord>();
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
    async generateUploadUrl() {
      return `https://upload.convex.invalid/upload-${++nextStorageId}`;
    },
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
      storageMap.delete(id);
    },
  };

  const scheduler = {
    async runAfter(delayMs: number, reference: FunctionReference<"action">, args: Record<string, unknown>) {
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
  ]);

  const mutationRegistry = new Map<string, unknown>([
    ["journal:upsertTradeInternal", upsertTradeInternal],
    ["journal:saveReviewInternal", saveReviewInternal],
    ["journal:upsertLessonInternal", upsertLessonInternal],
    ["journal:importOrdersInternal", importOrdersInternal],
    ["journal:upsertChartInternal", upsertChartInternal],
    ["journal:prepareRunDispatchInternal", prepareRunDispatchInternal],
    ["journal:updateRunProgressInternal", updateRunProgressInternal],
    ["journal:completeRunInternal", completeRunInternal],
  ]);

  // SAFETY: Test harness implements storage, runQuery, and runMutation for registered journal actions and HTTP endpoints.
  const actionCtx = {
    storage,
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
  } as unknown as ActionCtx;

  const callHttp = async (
    handler: unknown,
    path: string,
    body: unknown,
    secret: string | null = SERVICE_SECRET,
  ): Promise<{ status: number; json: Record<string, unknown> }> => {
    const headers = new Headers({ "content-type": "application/json" });
    if (secret !== null) headers.set("authorization", `Bearer ${secret}`);
    const request = new Request(`https://convex.invalid${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const response = await invokeHandler<ActionCtx, Request, Response>(handler, actionCtx, request);
    const json = z.record(z.string(), z.unknown()).parse(await response.json());
    return { status: response.status, json };
  };

  return {
    tableRows,
    storage,
    storageMap,
    scheduled,
    ctxForUser,
    actionCtx,
    callHttp,
  };
}

beforeEach(() => {
  vi.stubEnv("WORKOS_ALLOWED_USER_IDS", `${USER_A},${USER_B}`);
  vi.stubEnv("SERVICE_SHARED_SECRET", SERVICE_SECRET);
  vi.stubEnv("EXECUTION_PRIVATE_DOMAIN_SUFFIX", "railway.internal:8080");
  vi.stubEnv("JOURNAL_AGENT_BASE_URL", "");
  vi.stubEnv("EXECUTION_BASE_URL", "");
  vi.stubEnv("MARKET_RESEARCH_OWNER_ID", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("chartReviewSchema and assistant review normalization", () => {
  const validKey = "a".repeat(64);

  it("parses valid structured chart reviews and extracts unique image keys", () => {
    const review = makeChartReview(validKey);
    const serialized = JSON.stringify(review);

    expect(chartReviewSchema.safeParse(review).success).toBe(true);
    expect(parseChartReview(serialized)).toEqual(review);
    expect(referencedChartImageKeys(serialized)).toEqual([validKey]);
  });

  it("rejects out-of-bounds crop, focus, levels, ticks, and malformed image keys", () => {
    const base = makeChartReview(validKey);
    const chart = base.charts[0]!;

    // Crop exceeds screenshot width
    expect(
      chartReviewSchema.safeParse({
        ...base,
        charts: [{ ...chart, crop: { x: 1000, y: 0, width: 700, height: 500 } }],
      }).success,
    ).toBe(false);

    // Focus outside crop
    expect(
      chartReviewSchema.safeParse({
        ...base,
        charts: [{ ...chart, focus: { x: 50, y: 200, width: 200, height: 200 } }],
      }).success,
    ).toBe(false);

    // Level y outside crop
    expect(
      chartReviewSchema.safeParse({
        ...base,
        charts: [{ ...chart, levels: [{ y: 20, label: "Outside" }] }],
      }).success,
    ).toBe(false);

    // More than 3 levels
    expect(
      chartReviewSchema.safeParse({
        ...base,
        charts: [
          {
            ...chart,
            levels: [
              { y: 100, label: "L1" },
              { y: 200, label: "L2" },
              { y: 300, label: "L3" },
              { y: 400, label: "L4" },
            ],
          },
        ],
      }).success,
    ).toBe(false);

    // Tick x outside crop
    expect(
      chartReviewSchema.safeParse({
        ...base,
        charts: [{ ...chart, ticks: [{ x: 1500, label: "11:00" }] }],
      }).success,
    ).toBe(false);

    // Zero ticks or > 5 ticks
    expect(
      chartReviewSchema.safeParse({
        ...base,
        charts: [{ ...chart, ticks: [] }],
      }).success,
    ).toBe(false);

    // Non-64-hex image key
    expect(
      chartReviewSchema.safeParse({
        ...base,
        charts: [{ ...chart, image: "not-a-sha256" }],
      }).success,
    ).toBe(false);
  });

  it("handles plain prose fallback while rejecting invalid JSON starting with '{'", () => {
    expect(parseChartReview("Solid execution, wait for confirmation next time.")).toBeNull();
    expect(referencedChartImageKeys("Plain prose review")).toEqual([]);

    const prose = normalizeAssistantReview("  Plain prose review  ");
    expect(prose).toEqual({
      stored: "Plain prose review",
      chartReview: null,
      imageKeys: [],
    });

    expect(() => normalizeAssistantReview("{not valid json")).toThrow();
    expect(() => normalizeAssistantReview(JSON.stringify({ version: 1, summary: "incomplete" }))).toThrow();
  });
});

describe("owner isolation across two allowlisted WorkOS users", () => {
  it("completely isolates settings, trades, lessons, order batches, charts, and chat", async () => {
    const h = createJournalHarness();
    const ctxA = h.ctxForUser(USER_A);
    const ctxB = h.ctxForUser(USER_B);
    const ctxUnauth = h.ctxForUser(null);
    const ctxDenied = h.ctxForUser(USER_DENIED);

    // Auth checks
    await expect(invokeHandler(getDiary, ctxUnauth, {})).rejects.toThrow("Authentication required.");
    await expect(invokeHandler(getDiary, ctxDenied, {})).rejects.toThrow("WorkOS user is not allowed.");

    // Default settings for fresh user
    const initialB = await invokeHandler<MutationCtx, Record<string, never>, { settings: { brokerTimeZone: string } }>(
      getDiary,
      ctxB,
      {},
    );
    expect(initialB.settings.brokerTimeZone).toBe(DEFAULT_BROKER_TIME_ZONE);

    // User A configures settings, creates trade, order batch, lesson, and uploads a chart
    const savedSettingsA = await invokeHandler<MutationCtx, Record<string, unknown>, { brokerTimeZone: string; tradingViewLayoutId?: string }>(
      saveSettings,
      ctxA,
      { brokerTimeZone: "America/New_York", tradingViewLayoutId: "layout_alpha_1" },
    );
    expect(savedSettingsA.brokerTimeZone).toBe("America/New_York");
    expect(savedSettingsA.tradingViewLayoutId).toBe("layout_alpha_1");

    const tradeA = await invokeHandler<MutationCtx, Record<string, unknown>, { stableId: string; symbol: string; assistantReview: string | null }>(
      upsertTrade,
      ctxA,
      { stableId: "trade-a-1", trade: makeTradeInput() },
    );
    expect(tradeA.stableId).toBe("trade-a-1");
    expect(tradeA.symbol).toBe("QQQ");

    await invokeHandler(upsertOrderBatch, ctxA, {
      stableId: "batch-a-1",
      batch: { date: "2026-11-18", note: "Morning session", orders: [makeOrder()] },
    });

    await invokeHandler(upsertLesson, ctxA, {
      stableId: "lesson-a-1",
      lesson: {
        title: "Wait for VWAP retest",
        body: "Avoid chasing the opening spike.",
        tradeStableId: "trade-a-1",
      },
    });

    const uploadUrl = await invokeHandler<MutationCtx, Record<string, never>, string>(
      generateUploadUrl,
      ctxA,
      {},
    );
    expect(uploadUrl).toContain("https://upload.convex.invalid/");

    const storageIdA = await h.storage.store(new Blob([TINY_PNG_BYTES], { type: "image/png" }));
    const imageKeyA = await sha256HexBytes(TINY_PNG_BYTES);
    const registeredA = await invokeHandler<MutationCtx, Record<string, unknown>, { imageKey: string; storageId: Id<"_storage">; url: string }>(
      registerUploadedChart,
      ctxA,
      { imageKey: imageKeyA, storageId: storageIdA, mimeType: "image/png", width: 1, height: 1 },
    );
    expect(registeredA.imageKey).toBe(imageKeyA);

    // User B sees none of User A's data or chart URLs
    const diaryB = await invokeHandler<MutationCtx, Record<string, never>, {
      settings: { brokerTimeZone: string; tradingViewLayoutId?: string };
      trades: unknown[];
      lessons: unknown[];
      orderDays: unknown[];
      chartUrls: Record<string, string>;
    }>(getDiary, ctxB, {});
    expect(diaryB.settings.brokerTimeZone).toBe(DEFAULT_BROKER_TIME_ZONE);
    expect(diaryB.settings.tradingViewLayoutId).toBeUndefined();
    expect(diaryB.trades).toHaveLength(0);
    expect(diaryB.lessons).toHaveLength(0);
    expect(diaryB.orderDays).toHaveLength(0);
    expect(diaryB.chartUrls).toEqual({});

    // User B cannot link a lesson to User A's trade
    await expect(
      invokeHandler(upsertLesson, ctxB, {
        lesson: {
          title: "Cross-tenant link attempt",
          body: "Should fail",
          tradeStableId: "trade-a-1",
        },
      }),
    ).rejects.toThrow("Referenced trade does not exist.");

    // User B cannot hijack User A's storageId via registerUploadedChart
    await expect(
      invokeHandler(registerUploadedChart, ctxB, {
        imageKey: imageKeyA,
        storageId: storageIdA,
        mimeType: "image/png",
      }),
    ).rejects.toThrow("Storage object belongs to another user.");

    // User A updating brokerTimeZone without tradingViewLayoutId preserves layout; null clears it
    const preservedSettingsA = await invokeHandler<MutationCtx, Record<string, unknown>, { brokerTimeZone: string; tradingViewLayoutId?: string }>(
      saveSettings,
      ctxA,
      { brokerTimeZone: "America/Chicago" },
    );
    expect(preservedSettingsA.brokerTimeZone).toBe("America/Chicago");
    expect(preservedSettingsA.tradingViewLayoutId).toBe("layout_alpha_1");

    const clearedSettingsA = await invokeHandler<MutationCtx, Record<string, unknown>, { brokerTimeZone: string; tradingViewLayoutId?: string }>(
      saveSettings,
      ctxA,
      { brokerTimeZone: "America/Chicago", tradingViewLayoutId: null },
    );
    expect(clearedSettingsA.tradingViewLayoutId).toBeUndefined();

    // User B cannot attach User A's uploaded chart to a chat message
    await expect(
      invokeHandler(sendChatMessage, ctxB, {
        text: "Inspect User A chart",
        attachments: [
          {
            storageId: storageIdA,
            imageKey: imageKeyA,
            mimeType: "image/png",
            filename: "stolen.png",
          },
        ],
      }),
    ).rejects.toThrow("Attachment must reference an uploaded chart owned by this user.");

    // User B cannot delete User A's records
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

    // Save a review for User A, then verify upsertTrade preserves assistantReview
    await invokeHandler(saveReviewInternal, h.ctxForUser(null), {
      ownerId: USER_A,
      tradeStableId: "trade-a-1",
      assistantReview: "Disciplined execution.",
    });
    const updatedTradeA = await invokeHandler<MutationCtx, Record<string, unknown>, { setup: string; assistantReview: string | null }>(
      upsertTrade,
      ctxA,
      { stableId: "trade-a-1", trade: makeTradeInput({ setup: "VWAP reclaim v2" }) },
    );
    expect(updatedTradeA.setup).toBe("VWAP reclaim v2");
    expect(updatedTradeA.assistantReview).toBe("Disciplined execution.");

    // Explicit clear path removes assistantReview
    const clearedTradeA = await invokeHandler<MutationCtx, Record<string, unknown>, { assistantReview: string | null }>(
      clearTradeAssistantReview,
      ctxA,
      { stableId: "trade-a-1" },
    );
    expect(clearedTradeA.assistantReview).toBeNull();

    // User A deleting trade unlinks User A's lesson
    expect(await invokeHandler(deleteTrade, ctxA, { stableId: "trade-a-1" })).toEqual({
      deleted: true,
      unlinkedLessons: 1,
    });
    const diaryAAfterDelete = await invokeHandler<MutationCtx, Record<string, never>, {
      trades: unknown[];
      lessons: Array<{ stableId: string; tradeStableId: string | null }>;
      chartUrls: Record<string, string>;
    }>(getDiary, ctxA, {});
    expect(diaryAAfterDelete.trades).toHaveLength(0);
    expect(diaryAAfterDelete.lessons).toEqual([
      expect.objectContaining({ stableId: "lesson-a-1", tradeStableId: null }),
    ]);
    expect(diaryAAfterDelete.chartUrls[imageKeyA]).toBe(registeredA.url);
  });
});

describe("service HTTP tool endpoints: upload-chart, save-review, import-orders, get-diary", () => {
  it("deduplicates chart uploads per owner and validates mimeType and max size", async () => {
    const h = createJournalHarness();
    const base64 = Buffer.from(TINY_PNG_BYTES).toString("base64");
    const expectedKey = await sha256HexBytes(TINY_PNG_BYTES);

    // Rejects missing auth
    const unauth = await h.callHttp(
      journalUploadChart,
      "/internal/journal/tools/upload-chart",
      { ownerId: USER_A, base64Data: base64, mimeType: "image/png" },
      null,
    );
    expect(unauth.status).toBe(401);

    // Rejects non-allowlisted ownerId
    const forbidden = await h.callHttp(
      journalUploadChart,
      "/internal/journal/tools/upload-chart",
      { ownerId: USER_DENIED, base64Data: base64, mimeType: "image/png" },
    );
    expect(forbidden.status).toBe(403);

    // Rejects invalid mimeType
    const badMime = await h.callHttp(
      journalUploadChart,
      "/internal/journal/tools/upload-chart",
      { ownerId: USER_A, base64Data: base64, mimeType: "image/gif" },
    );
    expect(badMime.status).toBe(400);

    // Rejects oversized payload (> 10 MB decoded)
    const oversizedBase64 = Buffer.alloc(MAX_CHART_IMAGE_BYTES + 3, 1).toString("base64");
    const tooBig = await h.callHttp(
      journalUploadChart,
      "/internal/journal/tools/upload-chart",
      { ownerId: USER_A, base64Data: oversizedBase64, mimeType: "image/png" },
    );
    expect(tooBig.status).toBe(413);

    // First upload stores blob and detects 1x1 PNG dimensions
    const first = await h.callHttp(
      journalUploadChart,
      "/internal/journal/tools/upload-chart",
      {
        ownerId: USER_A,
        base64Data: base64,
        mimeType: "image/png",
        symbol: "QQQ",
        interval: "1m",
        source: "chart_img",
      },
    );
    expect(first.status).toBe(200);
    expect(first.json).toEqual({
      imageKey: expectedKey,
      storageId: expect.any(String),
      url: expect.stringContaining("https://storage.convex.invalid/"),
      width: 1,
      height: 1,
    });
    expect(h.storageMap.size).toBe(1);
    expect(h.tableRows("journalCharts")).toHaveLength(1);

    // Second identical upload for same owner deduplicates without creating another blob or row
    const second = await h.callHttp(
      journalUploadChart,
      "/internal/journal/tools/upload-chart",
      { ownerId: USER_A, base64Data: base64, mimeType: "image/png" },
    );
    expect(second.status).toBe(200);
    expect(second.json.storageId).toBe(first.json.storageId);
    expect(h.storageMap.size).toBe(1);
    expect(h.tableRows("journalCharts")).toHaveLength(1);

    // Same bytes for User B creates an isolated entry for User B
    const userBUpload = await h.callHttp(
      journalUploadChart,
      "/internal/journal/tools/upload-chart",
      { ownerId: USER_B, base64Data: base64, mimeType: "image/png" },
    );
    expect(userBUpload.status).toBe(200);
    expect(userBUpload.json.imageKey).toBe(expectedKey);
    expect(h.tableRows("journalCharts")).toHaveLength(2);
  });

  it("enforces chart ownership in save-review and supports import-orders + upsert-lesson", async () => {
    const h = createJournalHarness();

    // Create trade for User A via upsert-trade HTTP endpoint
    const upsertRes = await h.callHttp(
      journalUpsertTrade,
      "/internal/journal/tools/upsert-trade",
      { ownerId: USER_A, stableId: "trade-rev-1", trade: makeTradeInput() },
    );
    expect(upsertRes.status).toBe(200);
    expect(upsertRes.json.stableId).toBe("trade-rev-1");

    // Upload chart ONLY for User B
    const bChartBase64 = Buffer.from(SECOND_PNG_BYTES).toString("base64");
    const bChartKey = await sha256HexBytes(SECOND_PNG_BYTES);
    const bUpload = await h.callHttp(
      journalUploadChart,
      "/internal/journal/tools/upload-chart",
      { ownerId: USER_B, base64Data: bChartBase64, mimeType: "image/png" },
    );
    expect(bUpload.status).toBe(200);

    // User A save-review referencing User B's chart MUST fail
    const crossOwnerReview = await h.callHttp(
      journalSaveReview,
      "/internal/journal/tools/save-review",
      {
        ownerId: USER_A,
        tradeStableId: "trade-rev-1",
        assistantReview: makeChartReview(bChartKey),
      },
    );
    expect(crossOwnerReview.status).toBe(400);
    expect(String(crossOwnerReview.json.error)).toContain("does not exist for this user");

    // User A save-review referencing missing chart key MUST fail
    const missingKeyReview = await h.callHttp(
      journalSaveReview,
      "/internal/journal/tools/save-review",
      {
        ownerId: USER_A,
        tradeStableId: "trade-rev-1",
        assistantReview: JSON.stringify(makeChartReview("f".repeat(64))),
      },
    );
    expect(missingKeyReview.status).toBe(400);

    // Upload chart for User A, then save structured review
    const aChartBase64 = Buffer.from(TINY_PNG_BYTES).toString("base64");
    const aChartKey = await sha256HexBytes(TINY_PNG_BYTES);
    await h.callHttp(
      journalUploadChart,
      "/internal/journal/tools/upload-chart",
      { ownerId: USER_A, base64Data: aChartBase64, mimeType: "image/png" },
    );

    const reviewObj = makeChartReview(aChartKey);
    const savedReview = await h.callHttp(
      journalSaveReview,
      "/internal/journal/tools/save-review",
      {
        ownerId: USER_A,
        tradeStableId: "trade-rev-1",
        assistantReview: reviewObj,
      },
    );
    expect(savedReview.status).toBe(200);
    expect(parseChartReview(String(savedReview.json.assistantReview))).toEqual(reviewObj);

    // import-orders updates existing trade without clobbering assistantReview
    const importRes = await h.callHttp(
      journalImportOrders,
      "/internal/journal/tools/import-orders",
      {
        ownerId: USER_A,
        orderDays: [
          {
            stableId: "day-2026-11-18",
            date: "2026-11-18",
            note: "Imported broker fills",
            orders: [makeOrder()],
          },
        ],
        trades: [
          {
            stableId: "trade-rev-1",
            ...makeTradeInput({ setup: "Imported VWAP reclaim" }),
          },
        ],
      },
    );
    expect(importRes.status).toBe(200);
    const importedTrades = z
      .array(z.object({ setup: z.string(), assistantReview: z.string().nullable() }))
      .parse(importRes.json.trades);
    expect(importedTrades[0]?.setup).toBe("Imported VWAP reclaim");
    expect(parseChartReview(importedTrades[0]?.assistantReview ?? null)).toEqual(reviewObj);

    // upsert-lesson linked to User A's trade succeeds; non-existent trade fails
    const lessonOk = await h.callHttp(
      journalUpsertLesson,
      "/internal/journal/tools/upsert-lesson",
      {
        ownerId: USER_A,
        stableId: "lesson-1",
        lesson: { title: "Patience", body: "Wait for close above VWAP.", tradeStableId: "trade-rev-1" },
      },
    );
    expect(lessonOk.status).toBe(200);

    const lessonBad = await h.callHttp(
      journalUpsertLesson,
      "/internal/journal/tools/upsert-lesson",
      {
        ownerId: USER_B,
        lesson: { title: "Bad", body: "Cannot link User A trade", tradeStableId: "trade-rev-1" },
      },
    );
    expect(lessonBad.status).toBe(400);

    // get-diary returns owner's bundle only
    const diaryA = await h.callHttp(
      journalGetDiary,
      "/internal/journal/tools/get-diary",
      { ownerId: USER_A },
    );
    expect(diaryA.status).toBe(200);
    const diaryBundle = z
      .object({
        trades: z.array(z.unknown()),
        orderDays: z.array(z.unknown()),
        lessons: z.array(z.unknown()),
        charts: z.array(z.unknown()),
      })
      .parse(diaryA.json);
    expect(diaryBundle.trades).toHaveLength(1);
    expect(diaryBundle.orderDays).toHaveLength(1);
    expect(diaryBundle.lessons).toHaveLength(1);
    expect(diaryBundle.charts).toHaveLength(1);
  });
});

describe("journalExecutionRequest multi-user routing", () => {
  it("prefers JOURNAL_AGENT_BASE_URL, then EXECUTION_BASE_URL, then MARKET_RESEARCH_OWNER_ID fallback", async () => {
    // 1. MARKET_RESEARCH_OWNER_ID routes both users to the single shared pi service
    vi.stubEnv("MARKET_RESEARCH_OWNER_ID", USER_A);
    const urlForA = await journalExecutionUrl(USER_A, "/v1/journal/runs");
    const urlForB = await journalExecutionUrl(USER_B, "/v1/journal/runs");
    expect(urlForA).toBe(urlForB);
    expect(urlForA).toMatch(/^http:\/\/pi-u-[0-9a-f]{20}\.railway\.internal:8080\/v1\/journal\/runs$/);

    // 2. Without MARKET_RESEARCH_OWNER_ID, falls back to ownerId
    vi.stubEnv("MARKET_RESEARCH_OWNER_ID", "");
    const isolatedA = await journalExecutionUrl(USER_A, "/v1/journal/runs");
    const isolatedB = await journalExecutionUrl(USER_B, "/v1/journal/runs");
    expect(isolatedA).not.toBe(isolatedB);

    // 3. EXECUTION_BASE_URL overrides private domain routing (stripping trailing slash)
    vi.stubEnv("EXECUTION_BASE_URL", "https://pi-service.example.com/");
    expect(await journalExecutionUrl(USER_B, "/v1/journal/runs")).toBe(
      "https://pi-service.example.com/v1/journal/runs",
    );

    // 4. JOURNAL_AGENT_BASE_URL overrides EXECUTION_BASE_URL
    vi.stubEnv("JOURNAL_AGENT_BASE_URL", "http://127.0.0.1:8787/");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), { status: 202 }),
    );
    await journalExecutionRequest(USER_B, "/v1/journal/runs", { runId: "run-1" }, { timeoutMs: 5_000 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/v1/journal/runs",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: `Bearer ${SERVICE_SECRET}`,
          "content-type": "application/json",
        },
      }),
    );

    // 5. Rejects invalid protocol
    vi.stubEnv("JOURNAL_AGENT_BASE_URL", "ftp://bad-protocol.example.com");
    await expect(journalExecutionUrl(USER_A, "/v1/journal/runs")).rejects.toThrow(
      "JOURNAL_AGENT_BASE_URL must be an http:// or https:// base URL.",
    );
  });
});

describe("chat run lifecycle, dispatch, and cancel race protection", () => {
  it("runs sendChatMessage -> dispatch -> progress -> complete and rejects concurrent runs", async () => {
    const h = createJournalHarness();
    const ctxA = h.ctxForUser(USER_A);
    vi.stubEnv("JOURNAL_AGENT_BASE_URL", "https://journal-agent.internal");

    // Empty message without attachments rejected
    await expect(
      invokeHandler(sendChatMessage, ctxA, { text: "   ", attachments: [] }),
    ).rejects.toThrow("Provide a message or at least one chart attachment.");

    // Register chart and send message with attachment
    const storageId = await h.storage.store(new Blob([TINY_PNG_BYTES], { type: "image/png" }));
    const imageKey = await sha256HexBytes(TINY_PNG_BYTES);
    await invokeHandler(registerUploadedChart, ctxA, {
      imageKey,
      storageId,
      mimeType: "image/png",
    });

    const sent = await invokeHandler<MutationCtx, Record<string, unknown>, {
      runStableId: string;
      userMessageStableId: string;
      assistantMessageStableId: string;
    }>(sendChatMessage, ctxA, {
      text: "Review my QQQ trade",
      attachments: [{ storageId, imageKey, mimeType: "image/png", filename: "qqq-1m.png" }],
    });

    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0]?.name).toBe("journal_dispatch:startRun");

    // Concurrent send rejected while run is pending
    await expect(
      invokeHandler(sendChatMessage, ctxA, { text: "Second message while busy" }),
    ).rejects.toThrow("A journal assistant run is already active.");

    // Cannot clear chat while run is active
    await expect(invokeHandler(clearChatHistory, ctxA, {})).rejects.toThrow(
      "Cannot clear chat history while a run is active.",
    );

    // Dispatch action transitions run to running and POSTs payload with signed attachment URL
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 202 }),
    );
    const dispatchResult = await invokeHandler<ActionCtx, Record<string, unknown>, { dispatched: boolean }>(
      startRun,
      h.actionCtx,
      { ownerId: USER_A, runStableId: sent.runStableId },
    );
    expect(dispatchResult).toEqual({ dispatched: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const dispatchedBody = z
      .object({
        runId: z.string(),
        ownerId: z.string(),
        userMessage: z.object({
          attachments: z.array(z.object({ url: z.string().nullable() })),
        }),
      })
      .parse(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)));
    expect(dispatchedBody.runId).toBe(sent.runStableId);
    expect(dispatchedBody.ownerId).toBe(USER_A);
    expect(dispatchedBody.userMessage.attachments[0]?.url).toContain("https://storage.convex.invalid/");

    // Progress callback updates assistant message text and toolEvents
    const progressRes = await h.callHttp(
      journalRunProgress,
      "/internal/journal/runs/progress",
      {
        ownerId: USER_A,
        runId: sent.runStableId,
        text: "Checking your diary...",
        toolEvents: [{ name: "get_diary", status: "completed", summary: "Loaded 1 trade" }],
      },
    );
    expect(progressRes.status).toBe(200);
    expect(progressRes.json).toEqual({ accepted: true, status: "running" });

    // Complete callback finalizes run and assistant message
    const completeRes = await h.callHttp(
      journalRunComplete,
      "/internal/journal/runs/complete",
      {
        ownerId: USER_A,
        runId: sent.runStableId,
        status: "completed",
        text: "Review saved for QQQ.",
        toolEvents: [
          { name: "get_diary", status: "completed", summary: "Loaded 1 trade" },
          { name: "save_review", status: "completed", summary: "Saved review" },
        ],
      },
    );
    expect(completeRes.status).toBe(200);
    expect(completeRes.json).toEqual({ accepted: true, status: "completed" });

    // Duplicate identical complete is idempotent
    const duplicateComplete = await h.callHttp(
      journalRunComplete,
      "/internal/journal/runs/complete",
      {
        ownerId: USER_A,
        runId: sent.runStableId,
        status: "completed",
        text: "Review saved for QQQ.",
      },
    );
    expect(duplicateComplete.status).toBe(200);

    // listChatMessages returns ordered messages with resolved signed attachment URLs
    const messages = await invokeHandler<MutationCtx, Record<string, never>, Array<{
      ordinal: number;
      role: string;
      status: string;
      text: string;
      attachments: Array<{ url: string | null }>;
      toolEvents?: Array<{ name: string; status: string }>;
    }>>(listChatMessages, ctxA, {});
    expect(messages).toHaveLength(2);
    expect(messages[0]?.ordinal).toBe(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.attachments[0]?.url).toContain("https://storage.convex.invalid/");
    expect(messages[1]?.ordinal).toBe(2);
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.status).toBe("completed");
    expect(messages[1]?.text).toBe("Review saved for QQQ.");
    expect(messages[1]?.toolEvents).toHaveLength(2);

    // clearChatHistory succeeds once run is completed
    expect(await invokeHandler(clearChatHistory, ctxA, {})).toEqual({
      deletedMessages: 2,
      deletedRuns: 1,
    });
    expect(await invokeHandler(listChatMessages, ctxA, {})).toEqual([]);
  });

  it("protects canceled runs from being overwritten by late progress or complete callbacks", async () => {
    const h = createJournalHarness();
    const ctxA = h.ctxForUser(USER_A);
    vi.stubEnv("JOURNAL_AGENT_BASE_URL", "https://journal-agent.internal");

    const sent = await invokeHandler<MutationCtx, Record<string, unknown>, { runStableId: string }>(
      sendChatMessage,
      ctxA,
      { text: "Analyze my NVDL trade" },
    );

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 202 }),
    );
    await invokeHandler(startRun, h.actionCtx, {
      ownerId: USER_A,
      runStableId: sent.runStableId,
    });

    // User cancels active run
    const canceled = await invokeHandler<MutationCtx, Record<string, never>, { canceled: boolean; runStableId?: string }>(
      cancelActiveRun,
      ctxA,
      {},
    );
    expect(canceled).toEqual({ canceled: true, runStableId: sent.runStableId });
    expect(h.scheduled.at(-1)?.name).toBe("journal_dispatch:cancelRun");

    // Dispatch cancel notification
    const cancelResult = await invokeHandler<ActionCtx, Record<string, unknown>, { notified: boolean }>(
      cancelRun,
      h.actionCtx,
      { ownerId: USER_A, runStableId: sent.runStableId },
    );
    expect(cancelResult).toEqual({ notified: true });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `https://journal-agent.internal/v1/journal/runs/${encodeURIComponent(sent.runStableId)}/cancel`,
    );

    // Late progress callback rejected with 409
    const lateProgress = await h.callHttp(
      journalRunProgress,
      "/internal/journal/runs/progress",
      { ownerId: USER_A, runId: sent.runStableId, text: "Late partial output" },
    );
    expect(lateProgress.status).toBe(409);
    expect(lateProgress.json).toEqual({
      accepted: false,
      reason: "run_not_active",
      status: "canceled",
    });

    // Late complete callback with status="completed" MUST NOT overwrite canceled
    const lateComplete = await h.callHttp(
      journalRunComplete,
      "/internal/journal/runs/complete",
      {
        ownerId: USER_A,
        runId: sent.runStableId,
        status: "completed",
        text: "Should never overwrite canceled",
      },
    );
    expect(lateComplete.status).toBe(409);
    expect(lateComplete.json).toEqual({
      accepted: false,
      reason: "run_already_canceled",
      status: "canceled",
    });

    const messages = await invokeHandler<MutationCtx, Record<string, never>, Array<{ role: string; status: string; text: string }>>(
      listChatMessages,
      ctxA,
      {},
    );
    expect(messages[1]?.status).toBe("canceled");
    expect(messages[1]?.text).toBe("");
  });

  it("marks run failed cleanly when journal agent rejects dispatch", async () => {
    const h = createJournalHarness();
    const ctxA = h.ctxForUser(USER_A);
    vi.stubEnv("JOURNAL_AGENT_BASE_URL", "https://journal-agent.internal");

    const sent = await invokeHandler<MutationCtx, Record<string, unknown>, { runStableId: string }>(
      sendChatMessage,
      ctxA,
      { text: "Trigger backend failure" },
    );

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "agent overloaded" }), { status: 503 }),
    );

    const dispatched = await invokeHandler<ActionCtx, Record<string, unknown>, { dispatched: boolean }>(
      startRun,
      h.actionCtx,
      { ownerId: USER_A, runStableId: sent.runStableId },
    );
    expect(dispatched).toEqual({ dispatched: false });

    const messages = await invokeHandler<MutationCtx, Record<string, never>, Array<{ status: string; error?: string }>>(
      listChatMessages,
      ctxA,
      {},
    );
    expect(messages[1]?.status).toBe("failed");
    expect(messages[1]?.error).toBe("agent overloaded");
  });
});
