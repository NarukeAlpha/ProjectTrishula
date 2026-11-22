import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import { actorFromIdentity } from "./lib/auth.js";
import {
  chartImageIdSchema,
  decodeBase64Image,
  DEFAULT_BROKER_TIME_ZONE,
  DEFAULT_CHAT_CLEAR_BATCH_SIZE,
  DEFAULT_CHAT_LIST_LIMIT,
  JOURNAL_RUN_TIMEOUT_MS,
  journalChartMimeTypeValidator,
  journalChartSourceValidator,
  journalChatAttachmentRefValidator,
  journalLessonInputValidator,
  journalOrderBatchInputValidator,
  journalStableIdSchema,
  journalTerminalChatStatusValidator,
  journalToolEventValidator,
  journalTradeInputValidator,
  lessonInputSchema,
  MAX_CHART_IMAGE_BYTES,
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_CLEAR_BATCH_SIZE,
  MAX_CHAT_LIST_LIMIT,
  MAX_CHAT_TEXT_LENGTH,
  MAX_RECENT_HISTORY_MESSAGES,
  normalizeAssistantReview,
  normalizeOptionalChartDimension,
  normalizeOptionalChartMetadata,
  normalizeTradingViewLayoutId,
  orderBatchInputSchema,
  sha256HexBytes,
  sniffChartImage,
  toExactToolEvent,
  toolEventSchema,
  tradeInputSchema,
  validateBrokerTimeZone,
  type JournalChartMimeType,
  type JournalChartSource,
  type JournalChatStatus,
  type JournalTerminalChatStatus,
  type JournalToolEvent,
  type LessonInput,
  type OrderBatchInput,
  type TradeInput,
} from "./lib/journal.js";

type ReadCtx = Pick<QueryCtx, "db" | "storage">;
type WriteCtx = Pick<MutationCtx, "db" | "storage">;

export interface JournalSettingsDto {
  brokerTimeZone: string;
  tradingViewLayoutId?: string;
  updatedAt: number;
}

export interface JournalTradeDto {
  stableId: string;
  symbol: string;
  instrument: Doc<"journalTrades">["instrument"];
  account: Doc<"journalTrades">["account"];
  direction: Doc<"journalTrades">["direction"];
  status: Doc<"journalTrades">["status"];
  openedOn: string;
  closedOn: string | null;
  setup: string;
  size: string;
  details: string;
  plannedRiskCents: number | null;
  realizedPnlCents: number | null;
  thesis: string;
  plan: string;
  review: string;
  adherence: Doc<"journalTrades">["adherence"];
  mistakes: Doc<"journalTrades">["mistakes"];
  assistantReview: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface JournalLessonDto {
  stableId: string;
  title: string;
  body: string;
  tradeStableId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface JournalOrderBatchDto {
  stableId: string;
  date: string;
  note: string;
  orders: Doc<"journalOrderBatches">["orders"];
  createdAt: number;
  updatedAt: number;
}

export interface JournalChartDto {
  imageKey: string;
  storageId: Id<"_storage">;
  mimeType: JournalChartMimeType;
  width?: number;
  height?: number;
  symbol?: string;
  interval?: string;
  source: JournalChartSource;
  url: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface JournalUploadedChartDto {
  imageKey: string;
  storageId: Id<"_storage">;
  mimeType: JournalChartMimeType;
  width: number;
  height: number;
  url: string;
}

export interface RegisterChartResult {
  deduplicated: boolean;
  chart: JournalUploadedChartDto;
}

export interface JournalChatAttachmentDto {
  storageId: Id<"_storage">;
  imageKey: string;
  mimeType: string;
  filename: string;
  url: string | null;
}

export interface JournalChatMessageDto {
  stableId: string;
  ordinal: number;
  role: Doc<"journalChatMessages">["role"];
  text: string;
  attachments: JournalChatAttachmentDto[];
  toolEvents?: JournalToolEvent[];
  runStableId?: string;
  status: JournalChatStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

interface ChartPatchFields {
  storageId?: Id<"_storage">;
  mimeType?: JournalChartMimeType;
  width?: number;
  height?: number;
  symbol?: string;
  interval?: string;
  updatedAt: number;
}

interface ChartInsertDoc {
  ownerId: string;
  imageKey: string;
  storageId: Id<"_storage">;
  mimeType: JournalChartMimeType;
  width?: number;
  height?: number;
  symbol?: string;
  interval?: string;
  source: JournalChartSource;
  createdAt: number;
  updatedAt: number;
}

interface SettingsInsertDoc {
  ownerId: string;
  brokerTimeZone: string;
  tradingViewLayoutId?: string;
  updatedAt: number;
}

interface ProgressMessagePatch {
  status: "running";
  text?: string;
  toolEvents?: JournalToolEvent[];
  updatedAt: number;
}

interface CompleteRunPatch {
  status: JournalTerminalChatStatus;
  error?: string;
  updatedAt: number;
}

interface CompleteMessagePatch {
  status: JournalTerminalChatStatus;
  text: string;
  toolEvents?: JournalToolEvent[];
  error?: string;
  updatedAt: number;
}

interface RegisterChartActionArgs {
  ownerId: string;
  imageKey: string;
  storageId: Id<"_storage">;
  mimeType: JournalChartMimeType;
  width: number;
  height: number;
  symbol?: string;
  interval?: string;
  source: JournalChartSource;
}

function compareStringsDesc(left: string, right: string): number {
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

function resolveTimestamp(updatedAt: number | undefined, fallbackNow: number): number {
  if (updatedAt === undefined) return fallbackNow;
  if (!Number.isSafeInteger(updatedAt) || updatedAt <= 0) {
    throw new Error("updatedAt must be a positive integer timestamp.");
  }
  return updatedAt;
}

function normalizeBoundedLimit(
  value: number | undefined,
  defaultValue: number,
  maxValue: number,
  field: string,
): number {
  if (value === undefined) return defaultValue;
  if (!Number.isSafeInteger(value) || value < 1 || value > maxValue) {
    throw new Error(`${field} must be an integer between 1 and ${maxValue}.`);
  }
  return value;
}

function toSettingsDto(doc: Doc<"journalSettings"> | null): JournalSettingsDto {
  if (!doc) {
    return {
      brokerTimeZone: DEFAULT_BROKER_TIME_ZONE,
      updatedAt: 0,
    };
  }
  const dto: JournalSettingsDto = {
    brokerTimeZone: doc.brokerTimeZone,
    updatedAt: doc.updatedAt,
  };
  if (doc.tradingViewLayoutId !== undefined) {
    dto.tradingViewLayoutId = doc.tradingViewLayoutId;
  }
  return dto;
}

function toTradeDto(doc: Doc<"journalTrades">): JournalTradeDto {
  return {
    stableId: doc.stableId,
    symbol: doc.symbol,
    instrument: doc.instrument,
    account: doc.account,
    direction: doc.direction,
    status: doc.status,
    openedOn: doc.openedOn,
    closedOn: doc.closedOn,
    setup: doc.setup,
    size: doc.size,
    details: doc.details,
    plannedRiskCents: doc.plannedRiskCents,
    realizedPnlCents: doc.realizedPnlCents,
    thesis: doc.thesis,
    plan: doc.plan,
    review: doc.review,
    adherence: doc.adherence,
    mistakes: doc.mistakes,
    assistantReview: doc.assistantReview,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toLessonDto(doc: Doc<"journalLessons">): JournalLessonDto {
  return {
    stableId: doc.stableId,
    title: doc.title,
    body: doc.body,
    tradeStableId: doc.tradeStableId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toOrderBatchDto(doc: Doc<"journalOrderBatches">): JournalOrderBatchDto {
  return {
    stableId: doc.stableId,
    date: doc.date,
    note: doc.note,
    orders: doc.orders,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toChartDto(doc: Doc<"journalCharts">, url: string | null): JournalChartDto {
  const dto: JournalChartDto = {
    imageKey: doc.imageKey,
    storageId: doc.storageId,
    mimeType: doc.mimeType,
    source: doc.source,
    url,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  if (doc.width !== undefined) dto.width = doc.width;
  if (doc.height !== undefined) dto.height = doc.height;
  if (doc.symbol !== undefined) dto.symbol = doc.symbol;
  if (doc.interval !== undefined) dto.interval = doc.interval;
  return dto;
}

async function toChatMessageDto(
  ctx: Pick<QueryCtx, "storage">,
  doc: Doc<"journalChatMessages">,
): Promise<JournalChatMessageDto> {
  const attachments = await Promise.all(
    doc.attachments.map(async (attachment): Promise<JournalChatAttachmentDto> => ({
      storageId: attachment.storageId,
      imageKey: attachment.imageKey,
      mimeType: attachment.mimeType,
      filename: attachment.filename,
      url: await ctx.storage.getUrl(attachment.storageId),
    })),
  );
  const dto: JournalChatMessageDto = {
    stableId: doc.stableId,
    ordinal: doc.ordinal,
    role: doc.role,
    text: doc.text,
    attachments,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  if (doc.toolEvents !== undefined) dto.toolEvents = doc.toolEvents;
  if (doc.runStableId !== undefined) dto.runStableId = doc.runStableId;
  if (doc.error !== undefined) dto.error = doc.error;
  return dto;
}

function resolveStableId(stableId: string | undefined): string {
  if (stableId === undefined) return globalThis.crypto.randomUUID().toLowerCase();
  return journalStableIdSchema.parse(stableId);
}

async function requireActiveRunForOwner(
  ctx: ReadCtx,
  ownerId: string,
  runStableId: string,
): Promise<Doc<"journalChatRuns">> {
  const validatedRunId = journalStableIdSchema.parse(runStableId);
  const run = await ctx.db
    .query("journalChatRuns")
    .withIndex("by_stable", (index) => index.eq("stableId", validatedRunId))
    .unique();
  if (!run || run.ownerId !== ownerId || (run.status !== "pending" && run.status !== "running")) {
    throw new Error("run_not_active");
  }
  return run;
}

async function readSettingsForOwner(ctx: ReadCtx, ownerId: string): Promise<JournalSettingsDto> {
  const row = await ctx.db
    .query("journalSettings")
    .withIndex("by_owner", (index) => index.eq("ownerId", ownerId))
    .unique();
  return toSettingsDto(row);
}

async function readDiaryBundleForOwner(ctx: ReadCtx, ownerId: string) {
  const [settings, tradeRows, lessonRows, orderBatchRows, chartRows] = await Promise.all([
    readSettingsForOwner(ctx, ownerId),
    ctx.db
      .query("journalTrades")
      .withIndex("by_owner", (index) => index.eq("ownerId", ownerId))
      .collect(),
    ctx.db
      .query("journalLessons")
      .withIndex("by_owner", (index) => index.eq("ownerId", ownerId))
      .collect(),
    ctx.db
      .query("journalOrderBatches")
      .withIndex("by_owner", (index) => index.eq("ownerId", ownerId))
      .collect(),
    ctx.db
      .query("journalCharts")
      .withIndex("by_owner", (index) => index.eq("ownerId", ownerId))
      .collect(),
  ]);

  const trades = tradeRows
    .map(toTradeDto)
    .sort(
      (left, right) =>
        compareStringsDesc(left.openedOn, right.openedOn)
        || right.updatedAt - left.updatedAt
        || compareStringsDesc(left.stableId, right.stableId),
    );
  const lessons = lessonRows
    .map(toLessonDto)
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt || compareStringsDesc(left.stableId, right.stableId),
    );
  const orderDays = orderBatchRows
    .map(toOrderBatchDto)
    .sort(
      (left, right) =>
        compareStringsDesc(left.date, right.date)
        || right.updatedAt - left.updatedAt
        || compareStringsDesc(left.stableId, right.stableId),
    );

  const chartUrls: Record<string, string> = {};
  const charts = await Promise.all(
    chartRows.map(async (chart): Promise<JournalChartDto> => {
      const url = await ctx.storage.getUrl(chart.storageId);
      if (url !== null) {
        chartUrls[chart.imageKey] = url;
      }
      return toChartDto(chart, url);
    }),
  );

  return {
    settings,
    trades,
    lessons,
    orderDays,
    charts,
    chartUrls,
  };
}

async function verifyOwnedChartKeys(
  ctx: ReadCtx,
  ownerId: string,
  imageKeys: string[],
): Promise<void> {
  for (const imageKey of imageKeys) {
    const owned = await ctx.db
      .query("journalCharts")
      .withIndex("by_owner_image_key", (index) =>
        index.eq("ownerId", ownerId).eq("imageKey", imageKey),
      )
      .unique();
    if (!owned) {
      throw new Error(`Referenced chart image ${imageKey} does not exist for this user.`);
    }
  }
}

async function upsertTradeForOwner(
  ctx: WriteCtx,
  ownerId: string,
  stableIdArg: string | undefined,
  rawTrade: TradeInput,
  assistantReviewOverride?: { set: true; value: string | null },
  explicitUpdatedAt?: number,
): Promise<JournalTradeDto> {
  const stableId = resolveStableId(stableIdArg);
  const trade = tradeInputSchema.parse(rawTrade);
  const existing = await ctx.db
    .query("journalTrades")
    .withIndex("by_owner_stable", (index) =>
      index.eq("ownerId", ownerId).eq("stableId", stableId),
    )
    .unique();
  const now = resolveTimestamp(explicitUpdatedAt, Date.now());
  const assistantReview = assistantReviewOverride?.set
    ? assistantReviewOverride.value
    : (existing?.assistantReview ?? null);

  if (existing) {
    await ctx.db.patch(existing._id, {
      ...trade,
      assistantReview,
      updatedAt: now,
    });
    return {
      stableId,
      ...trade,
      assistantReview,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
  }

  await ctx.db.insert("journalTrades", {
    ownerId,
    stableId,
    ...trade,
    assistantReview,
    createdAt: now,
    updatedAt: now,
  });
  return {
    stableId,
    ...trade,
    assistantReview,
    createdAt: now,
    updatedAt: now,
  };
}

async function deleteTradeForOwner(
  ctx: WriteCtx,
  ownerId: string,
  stableIdArg: string,
): Promise<{ deleted: boolean; unlinkedLessons: number }> {
  const stableId = journalStableIdSchema.parse(stableIdArg);
  const existing = await ctx.db
    .query("journalTrades")
    .withIndex("by_owner_stable", (index) =>
      index.eq("ownerId", ownerId).eq("stableId", stableId),
    )
    .unique();
  if (!existing) {
    return { deleted: false, unlinkedLessons: 0 };
  }

  const now = Date.now();
  const linkedLessons = await ctx.db
    .query("journalLessons")
    .withIndex("by_owner_trade", (index) =>
      index.eq("ownerId", ownerId).eq("tradeStableId", stableId),
    )
    .collect();
  for (const lesson of linkedLessons) {
    await ctx.db.patch(lesson._id, {
      tradeStableId: null,
      updatedAt: now,
    });
  }
  await ctx.db.delete(existing._id);
  return { deleted: true, unlinkedLessons: linkedLessons.length };
}

async function upsertLessonForOwner(
  ctx: WriteCtx,
  ownerId: string,
  stableIdArg: string | undefined,
  rawLesson: LessonInput,
  explicitUpdatedAt?: number,
): Promise<JournalLessonDto> {
  const stableId = resolveStableId(stableIdArg);
  const lesson = lessonInputSchema.parse(rawLesson);
  if (lesson.tradeStableId !== null) {
    const tradeStableId = lesson.tradeStableId;
    const trade = await ctx.db
      .query("journalTrades")
      .withIndex("by_owner_stable", (index) =>
        index.eq("ownerId", ownerId).eq("stableId", tradeStableId),
      )
      .unique();
    if (!trade) {
      throw new Error("Referenced trade does not exist.");
    }
  }

  const existing = await ctx.db
    .query("journalLessons")
    .withIndex("by_owner_stable", (index) =>
      index.eq("ownerId", ownerId).eq("stableId", stableId),
    )
    .unique();
  const now = resolveTimestamp(explicitUpdatedAt, Date.now());
  if (existing) {
    await ctx.db.patch(existing._id, {
      title: lesson.title,
      body: lesson.body,
      tradeStableId: lesson.tradeStableId,
      updatedAt: now,
    });
    return {
      stableId,
      title: lesson.title,
      body: lesson.body,
      tradeStableId: lesson.tradeStableId,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
  }

  await ctx.db.insert("journalLessons", {
    ownerId,
    stableId,
    title: lesson.title,
    body: lesson.body,
    tradeStableId: lesson.tradeStableId,
    createdAt: now,
    updatedAt: now,
  });
  return {
    stableId,
    title: lesson.title,
    body: lesson.body,
    tradeStableId: lesson.tradeStableId,
    createdAt: now,
    updatedAt: now,
  };
}

async function deleteLessonForOwner(
  ctx: WriteCtx,
  ownerId: string,
  stableIdArg: string,
): Promise<{ deleted: boolean }> {
  const stableId = journalStableIdSchema.parse(stableIdArg);
  const existing = await ctx.db
    .query("journalLessons")
    .withIndex("by_owner_stable", (index) =>
      index.eq("ownerId", ownerId).eq("stableId", stableId),
    )
    .unique();
  if (!existing) return { deleted: false };
  await ctx.db.delete(existing._id);
  return { deleted: true };
}

async function upsertOrderBatchForOwner(
  ctx: WriteCtx,
  ownerId: string,
  stableIdArg: string | undefined,
  rawBatch: OrderBatchInput,
  explicitUpdatedAt?: number,
): Promise<JournalOrderBatchDto> {
  const stableId = resolveStableId(stableIdArg);
  const batch = orderBatchInputSchema.parse(rawBatch);
  const existing = await ctx.db
    .query("journalOrderBatches")
    .withIndex("by_owner_stable", (index) =>
      index.eq("ownerId", ownerId).eq("stableId", stableId),
    )
    .unique();
  const now = resolveTimestamp(explicitUpdatedAt, Date.now());
  if (existing) {
    await ctx.db.patch(existing._id, {
      date: batch.date,
      note: batch.note,
      orders: batch.orders,
      updatedAt: now,
    });
    return {
      stableId,
      date: batch.date,
      note: batch.note,
      orders: batch.orders,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
  }

  await ctx.db.insert("journalOrderBatches", {
    ownerId,
    stableId,
    date: batch.date,
    note: batch.note,
    orders: batch.orders,
    createdAt: now,
    updatedAt: now,
  });
  return {
    stableId,
    date: batch.date,
    note: batch.note,
    orders: batch.orders,
    createdAt: now,
    updatedAt: now,
  };
}

async function deleteOrderBatchForOwner(
  ctx: WriteCtx,
  ownerId: string,
  stableIdArg: string,
): Promise<{ deleted: boolean }> {
  const stableId = journalStableIdSchema.parse(stableIdArg);
  const existing = await ctx.db
    .query("journalOrderBatches")
    .withIndex("by_owner_stable", (index) =>
      index.eq("ownerId", ownerId).eq("stableId", stableId),
    )
    .unique();
  if (!existing) return { deleted: false };
  await ctx.db.delete(existing._id);
  return { deleted: true };
}

async function saveReviewForOwner(
  ctx: WriteCtx,
  ownerId: string,
  tradeStableIdArg: string,
  assistantReviewInput: string | null,
): Promise<JournalTradeDto> {
  const tradeStableId = journalStableIdSchema.parse(tradeStableIdArg);
  const existing = await ctx.db
    .query("journalTrades")
    .withIndex("by_owner_stable", (index) =>
      index.eq("ownerId", ownerId).eq("stableId", tradeStableId),
    )
    .unique();
  if (!existing) {
    throw new Error("Trade not found.");
  }
  const normalized = normalizeAssistantReview(assistantReviewInput);
  if (normalized.imageKeys.length > 0) {
    await verifyOwnedChartKeys(ctx, ownerId, normalized.imageKeys);
  }
  const now = Date.now();
  await ctx.db.patch(existing._id, {
    assistantReview: normalized.stored,
    updatedAt: now,
  });
  return {
    ...toTradeDto(existing),
    assistantReview: normalized.stored,
    updatedAt: now,
  };
}

interface RegisterChartInput {
  imageKey: string;
  storageId: Id<"_storage">;
  mimeType: JournalChartMimeType;
  width: number;
  height: number;
  symbol?: string;
  interval?: string;
  source: JournalChartSource;
}

// Never deletes storage blobs inside a mutation: callers that stored a brand-new blob
// delete ONLY their own newly created storageId if deduplicated === true or on throw.
async function registerChartForOwner(
  ctx: WriteCtx,
  ownerId: string,
  input: RegisterChartInput,
): Promise<RegisterChartResult> {
  const imageKey = chartImageIdSchema.parse(input.imageKey);
  const width = normalizeOptionalChartDimension(input.width, "width");
  const height = normalizeOptionalChartDimension(input.height, "height");
  if (width === undefined || height === undefined) {
    throw new Error("Verified chart width and height are required.");
  }
  const symbol = normalizeOptionalChartMetadata(input.symbol, "symbol", 32);
  const interval = normalizeOptionalChartMetadata(input.interval, "interval", 32);

  const storageOwner = await ctx.db
    .query("journalCharts")
    .withIndex("by_storage_id", (index) => index.eq("storageId", input.storageId))
    .first();
  if (storageOwner !== null && storageOwner.ownerId !== ownerId) {
    throw new Error("Storage object belongs to another user.");
  }

  const storageMeta = await ctx.db.system.get(input.storageId);
  if (storageMeta !== null && storageMeta.size > MAX_CHART_IMAGE_BYTES) {
    throw new Error(`Chart image exceeds maximum size of ${MAX_CHART_IMAGE_BYTES} bytes.`);
  }
  const incomingUrl = await ctx.storage.getUrl(input.storageId);
  if (incomingUrl === null) {
    throw new Error("Uploaded storage object not found.");
  }

  const now = Date.now();
  const existing = await ctx.db
    .query("journalCharts")
    .withIndex("by_owner_image_key", (index) =>
      index.eq("ownerId", ownerId).eq("imageKey", imageKey),
    )
    .unique();

  if (existing) {
    const existingUrl = await ctx.storage.getUrl(existing.storageId);
    const keepExistingStorage = existingUrl !== null;
    const patchFields: ChartPatchFields = { updatedAt: now };
    if (!keepExistingStorage) {
      patchFields.storageId = input.storageId;
      patchFields.mimeType = input.mimeType;
    }
    if (existing.width === undefined) patchFields.width = width;
    if (existing.height === undefined) patchFields.height = height;
    if (symbol !== undefined) patchFields.symbol = symbol;
    if (interval !== undefined) patchFields.interval = interval;
    await ctx.db.patch(existing._id, patchFields);

    return {
      deduplicated: keepExistingStorage,
      chart: {
        imageKey,
        storageId: keepExistingStorage ? existing.storageId : input.storageId,
        mimeType: keepExistingStorage ? existing.mimeType : input.mimeType,
        width: existing.width ?? width,
        height: existing.height ?? height,
        url: keepExistingStorage ? existingUrl : incomingUrl,
      },
    };
  }

  const doc: ChartInsertDoc = {
    ownerId,
    imageKey,
    storageId: input.storageId,
    mimeType: input.mimeType,
    width,
    height,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  };
  if (symbol !== undefined) doc.symbol = symbol;
  if (interval !== undefined) doc.interval = interval;
  await ctx.db.insert("journalCharts", doc);

  return {
    deduplicated: false,
    chart: {
      imageKey,
      storageId: input.storageId,
      mimeType: input.mimeType,
      width,
      height,
      url: incomingUrl,
    },
  };
}

async function findActiveRunForOwner(
  ctx: ReadCtx,
  ownerId: string,
): Promise<Doc<"journalChatRuns"> | null> {
  for (const status of ["running", "pending"] as const) {
    const run = await ctx.db
      .query("journalChatRuns")
      .withIndex("by_owner_status", (index) =>
        index.eq("ownerId", ownerId).eq("status", status),
      )
      .first();
    if (run) return run;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Authenticated client queries, mutations & actions
// ---------------------------------------------------------------------------

export const getDiary = query({
  args: {},
  handler: async (ctx) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const bundle = await readDiaryBundleForOwner(ctx, actor.id);
    return {
      settings: bundle.settings,
      trades: bundle.trades,
      lessons: bundle.lessons,
      orderDays: bundle.orderDays,
      chartUrls: bundle.chartUrls,
    };
  },
});

export const saveSettings = mutation({
  args: {
    brokerTimeZone: v.string(),
    tradingViewLayoutId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<JournalSettingsDto> => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const brokerTimeZone = validateBrokerTimeZone(args.brokerTimeZone);
    const now = Date.now();
    const existing = await ctx.db
      .query("journalSettings")
      .withIndex("by_owner", (index) => index.eq("ownerId", actor.id))
      .unique();
    const tradingViewLayoutId = args.tradingViewLayoutId === undefined
      ? existing?.tradingViewLayoutId
      : normalizeTradingViewLayoutId(args.tradingViewLayoutId);

    if (existing) {
      await ctx.db.patch(existing._id, {
        brokerTimeZone,
        tradingViewLayoutId,
        updatedAt: now,
      });
    } else {
      const insertDoc: SettingsInsertDoc = {
        ownerId: actor.id,
        brokerTimeZone,
        updatedAt: now,
      };
      if (tradingViewLayoutId !== undefined) {
        insertDoc.tradingViewLayoutId = tradingViewLayoutId;
      }
      await ctx.db.insert("journalSettings", insertDoc);
    }

    const result: JournalSettingsDto = {
      brokerTimeZone,
      updatedAt: now,
    };
    if (tradingViewLayoutId !== undefined) {
      result.tradingViewLayoutId = tradingViewLayoutId;
    }
    return result;
  },
});

export const upsertTrade = mutation({
  args: {
    stableId: v.optional(v.string()),
    trade: journalTradeInputValidator,
  },
  handler: async (ctx, args): Promise<JournalTradeDto> => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    return upsertTradeForOwner(ctx, actor.id, args.stableId, args.trade);
  },
});

export const clearTradeAssistantReview = mutation({
  args: {
    stableId: v.string(),
  },
  handler: async (ctx, args): Promise<JournalTradeDto> => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    return saveReviewForOwner(ctx, actor.id, args.stableId, null);
  },
});

export const deleteTrade = mutation({
  args: {
    stableId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    return deleteTradeForOwner(ctx, actor.id, args.stableId);
  },
});

export const upsertLesson = mutation({
  args: {
    stableId: v.optional(v.string()),
    lesson: journalLessonInputValidator,
  },
  handler: async (ctx, args): Promise<JournalLessonDto> => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    return upsertLessonForOwner(ctx, actor.id, args.stableId, args.lesson);
  },
});

export const deleteLesson = mutation({
  args: {
    stableId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    return deleteLessonForOwner(ctx, actor.id, args.stableId);
  },
});

export const upsertOrderBatch = mutation({
  args: {
    stableId: v.optional(v.string()),
    batch: journalOrderBatchInputValidator,
  },
  handler: async (ctx, args): Promise<JournalOrderBatchDto> => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    return upsertOrderBatchForOwner(ctx, actor.id, args.stableId, args.batch);
  },
});

export const deleteOrderBatch = mutation({
  args: {
    stableId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    return deleteOrderBatchForOwner(ctx, actor.id, args.stableId);
  },
});

export const uploadChartAsset = action({
  args: {
    base64Data: v.string(),
    filename: v.optional(v.string()),
    symbol: v.optional(v.string()),
    interval: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<JournalUploadedChartDto> => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    if (args.filename !== undefined) {
      const trimmedFilename = args.filename.trim();
      if (trimmedFilename.length === 0 || trimmedFilename.length > 255) {
        throw new Error("filename must be non-empty and at most 255 characters.");
      }
    }
    const symbol = normalizeOptionalChartMetadata(args.symbol, "symbol", 32);
    const interval = normalizeOptionalChartMetadata(args.interval, "interval", 32);
    const bytes = decodeBase64Image(args.base64Data, MAX_CHART_IMAGE_BYTES);
    const sniffed = sniffChartImage(bytes);
    const imageKey = await sha256HexBytes(bytes);

    const existing: JournalChartDto | null = await ctx.runQuery(
      internal.journal.getChartByImageKeyInternal,
      {
        ownerId: actor.id,
        imageKey,
      },
    );
    if (existing !== null && existing.url !== null) {
      return {
        imageKey: existing.imageKey,
        storageId: existing.storageId,
        mimeType: existing.mimeType,
        width: existing.width ?? sniffed.width,
        height: existing.height ?? sniffed.height,
        url: existing.url,
      };
    }

    const newStorageId = await ctx.storage.store(new Blob([bytes], { type: sniffed.mimeType }));
    try {
      const registerArgs: RegisterChartActionArgs = {
        ownerId: actor.id,
        imageKey,
        storageId: newStorageId,
        mimeType: sniffed.mimeType,
        width: sniffed.width,
        height: sniffed.height,
        source: "upload",
      };
      if (symbol !== undefined) registerArgs.symbol = symbol;
      if (interval !== undefined) registerArgs.interval = interval;

      const registered: RegisterChartResult = await ctx.runMutation(
        internal.journal.registerChartInternal,
        registerArgs,
      );
      if (registered.deduplicated && registered.chart.storageId !== newStorageId) {
        await ctx.storage.delete(newStorageId);
      }
      return registered.chart;
    } catch (error) {
      await ctx.storage.delete(newStorageId).catch(() => undefined);
      throw error;
    }
  },
});

export const listChatMessages = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<JournalChatMessageDto[]> => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const limit = normalizeBoundedLimit(
      args.limit,
      DEFAULT_CHAT_LIST_LIMIT,
      MAX_CHAT_LIST_LIMIT,
      "limit",
    );
    const rows = await ctx.db
      .query("journalChatMessages")
      .withIndex("by_owner_ordinal", (index) => index.eq("ownerId", actor.id))
      .order("desc")
      .take(limit);
    return Promise.all(rows.toReversed().map((row) => toChatMessageDto(ctx, row)));
  },
});

export const sendChatMessage = mutation({
  args: {
    text: v.string(),
    attachments: v.optional(v.array(journalChatAttachmentRefValidator)),
  },
  handler: async (ctx, args) => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const text = args.text.trim();
    const rawAttachments = args.attachments ?? [];

    if (text.length > MAX_CHAT_TEXT_LENGTH) {
      throw new Error(`Message text must be at most ${MAX_CHAT_TEXT_LENGTH} characters.`);
    }
    if (text.length === 0 && rawAttachments.length === 0) {
      throw new Error("Provide a message or at least one chart attachment.");
    }
    if (rawAttachments.length > MAX_CHAT_ATTACHMENTS) {
      throw new Error(`At most ${MAX_CHAT_ATTACHMENTS} attachments are allowed per message.`);
    }

    const activeRun = await findActiveRunForOwner(ctx, actor.id);
    if (activeRun) {
      throw new Error("A journal assistant run is already active.");
    }

    const attachments: Array<{
      storageId: Id<"_storage">;
      imageKey: string;
      mimeType: string;
      filename: string;
    }> = [];
    for (const attachment of rawAttachments) {
      const imageKey = chartImageIdSchema.parse(attachment.imageKey);
      const filename = attachment.filename.trim();
      if (filename.length === 0 || filename.length > 255) {
        throw new Error("Attachment filename must be non-empty and at most 255 characters.");
      }
      const ownedChart = await ctx.db
        .query("journalCharts")
        .withIndex("by_owner_image_key", (index) =>
          index.eq("ownerId", actor.id).eq("imageKey", imageKey),
        )
        .unique();
      if (!ownedChart) {
        throw new Error("Attachment must reference an uploaded chart owned by this user.");
      }
      const url = await ctx.storage.getUrl(ownedChart.storageId);
      if (url === null) {
        throw new Error("Attachment storage object not found.");
      }
      attachments.push({
        storageId: ownedChart.storageId,
        imageKey: ownedChart.imageKey,
        mimeType: ownedChart.mimeType,
        filename,
      });
    }

    const latest = await ctx.db
      .query("journalChatMessages")
      .withIndex("by_owner_ordinal", (index) => index.eq("ownerId", actor.id))
      .order("desc")
      .first();
    const userOrdinal = (latest?.ordinal ?? 0) + 1;
    const assistantOrdinal = userOrdinal + 1;
    const now = Date.now();

    const runStableId = globalThis.crypto.randomUUID().toLowerCase();
    const userMessageStableId = globalThis.crypto.randomUUID().toLowerCase();
    const assistantMessageStableId = globalThis.crypto.randomUUID().toLowerCase();

    const userMessageId = await ctx.db.insert("journalChatMessages", {
      ownerId: actor.id,
      stableId: userMessageStableId,
      ordinal: userOrdinal,
      role: "user",
      text,
      attachments,
      runStableId,
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });

    const assistantMessageId = await ctx.db.insert("journalChatMessages", {
      ownerId: actor.id,
      stableId: assistantMessageStableId,
      ordinal: assistantOrdinal,
      role: "assistant",
      text: "",
      attachments: [],
      runStableId,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("journalChatRuns", {
      ownerId: actor.id,
      stableId: runStableId,
      userMessageId,
      assistantMessageId,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.journal_dispatch.startRun, {
      ownerId: actor.id,
      runStableId,
    });
    await ctx.scheduler.runAfter(JOURNAL_RUN_TIMEOUT_MS, internal.journal.expireStaleRun, {
      runStableId,
    });

    return {
      runStableId,
      userMessageStableId,
      assistantMessageStableId,
    };
  },
});

export const cancelActiveRun = mutation({
  args: {},
  handler: async (ctx): Promise<{ canceled: boolean; runStableId?: string }> => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const activeRun = await findActiveRunForOwner(ctx, actor.id);
    if (!activeRun) {
      return { canceled: false };
    }
    const now = Date.now();
    await ctx.db.patch(activeRun._id, {
      status: "canceled",
      updatedAt: now,
    });
    await ctx.db.patch(activeRun.assistantMessageId, {
      status: "canceled",
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.journal_dispatch.cancelRun, {
      ownerId: actor.id,
      runStableId: activeRun.stableId,
    });
    return {
      canceled: true,
      runStableId: activeRun.stableId,
    };
  },
});

export const clearChatHistory = mutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ deletedMessages: number; deletedRuns: number; hasMore: boolean }> => {
    const actor = actorFromIdentity(await ctx.auth.getUserIdentity());
    const batchSize = normalizeBoundedLimit(
      args.batchSize,
      DEFAULT_CHAT_CLEAR_BATCH_SIZE,
      MAX_CHAT_CLEAR_BATCH_SIZE,
      "batchSize",
    );
    const activeRun = await findActiveRunForOwner(ctx, actor.id);
    if (activeRun) {
      throw new Error("Cannot clear chat history while a run is active.");
    }

    const messageBatch = await ctx.db
      .query("journalChatMessages")
      .withIndex("by_owner_ordinal", (index) => index.eq("ownerId", actor.id))
      .order("asc")
      .take(batchSize + 1);
    const messagesToDelete = messageBatch.slice(0, batchSize);
    for (const message of messagesToDelete) {
      await ctx.db.delete(message._id);
    }
    let hasMore = messageBatch.length > batchSize;

    let deletedRuns = 0;
    let remainingRunBudget = batchSize;
    for (const status of ["completed", "failed", "canceled"] as const) {
      if (remainingRunBudget === 0) {
        const leftover = await ctx.db
          .query("journalChatRuns")
          .withIndex("by_owner_status", (index) =>
            index.eq("ownerId", actor.id).eq("status", status),
          )
          .first();
        if (leftover !== null) hasMore = true;
        break;
      }
      const runBatch = await ctx.db
        .query("journalChatRuns")
        .withIndex("by_owner_status", (index) =>
          index.eq("ownerId", actor.id).eq("status", status),
        )
        .take(remainingRunBudget + 1);
      const runsToDelete = runBatch.slice(0, remainingRunBudget);
      for (const run of runsToDelete) {
        await ctx.db.delete(run._id);
        deletedRuns += 1;
      }
      if (runBatch.length > remainingRunBudget) {
        hasMore = true;
      }
      remainingRunBudget -= runsToDelete.length;
    }

    return {
      deletedMessages: messagesToDelete.length,
      deletedRuns,
      hasMore,
    };
  },
});

// ---------------------------------------------------------------------------
// Internal queries & mutations (service HTTP endpoints and dispatch actions)
// ---------------------------------------------------------------------------

export const getDiaryForOwner = internalQuery({
  args: {
    ownerId: v.string(),
    runStableId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.runStableId !== undefined) {
      await requireActiveRunForOwner(ctx, args.ownerId, args.runStableId);
    }
    const bundle = await readDiaryBundleForOwner(ctx, args.ownerId);
    return {
      settings: bundle.settings,
      trades: bundle.trades,
      lessons: bundle.lessons,
      orderDays: bundle.orderDays,
      charts: bundle.charts,
    };
  },
});

export const getChartByImageKeyInternal = internalQuery({
  args: {
    ownerId: v.string(),
    imageKey: v.string(),
    runStableId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<JournalChartDto | null> => {
    if (args.runStableId !== undefined) {
      await requireActiveRunForOwner(ctx, args.ownerId, args.runStableId);
    }
    const imageKey = chartImageIdSchema.parse(args.imageKey);
    const row = await ctx.db
      .query("journalCharts")
      .withIndex("by_owner_image_key", (index) =>
        index.eq("ownerId", args.ownerId).eq("imageKey", imageKey),
      )
      .unique();
    if (!row) return null;
    const url = await ctx.storage.getUrl(row.storageId);
    return toChartDto(row, url);
  },
});

export const upsertTradeInternal = internalMutation({
  args: {
    ownerId: v.string(),
    runStableId: v.string(),
    stableId: v.optional(v.string()),
    trade: journalTradeInputValidator,
  },
  handler: async (ctx, args): Promise<JournalTradeDto> => {
    await requireActiveRunForOwner(ctx, args.ownerId, args.runStableId);
    return upsertTradeForOwner(ctx, args.ownerId, args.stableId, args.trade);
  },
});

export const saveReviewInternal = internalMutation({
  args: {
    ownerId: v.string(),
    runStableId: v.string(),
    tradeStableId: v.string(),
    assistantReview: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args): Promise<JournalTradeDto> => {
    await requireActiveRunForOwner(ctx, args.ownerId, args.runStableId);
    return saveReviewForOwner(ctx, args.ownerId, args.tradeStableId, args.assistantReview);
  },
});

export const upsertLessonInternal = internalMutation({
  args: {
    ownerId: v.string(),
    runStableId: v.string(),
    stableId: v.optional(v.string()),
    lesson: journalLessonInputValidator,
  },
  handler: async (ctx, args): Promise<JournalLessonDto> => {
    await requireActiveRunForOwner(ctx, args.ownerId, args.runStableId);
    return upsertLessonForOwner(ctx, args.ownerId, args.stableId, args.lesson);
  },
});

export const importOrdersInternal = internalMutation({
  args: {
    ownerId: v.string(),
    runStableId: v.string(),
    orderDays: v.array(
      v.object({
        stableId: v.optional(v.string()),
        date: v.string(),
        note: v.string(),
        orders: journalOrderBatchInputValidator.fields.orders,
      }),
    ),
    trades: v.array(
      v.object({
        stableId: v.optional(v.string()),
        trade: journalTradeInputValidator,
        assistantReview: v.optional(v.union(v.string(), v.null())),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireActiveRunForOwner(ctx, args.ownerId, args.runStableId);

    const seenOrderIds = new Set<string>();
    const preparedOrders = args.orderDays.map((entry) => {
      const stableId = resolveStableId(entry.stableId);
      if (seenOrderIds.has(stableId)) {
        throw new Error(`Duplicate order batch stableId in import: ${stableId}`);
      }
      seenOrderIds.add(stableId);
      const batch = orderBatchInputSchema.parse({
        date: entry.date,
        note: entry.note,
        orders: entry.orders,
      });
      return { stableId, batch };
    });

    const seenTradeIds = new Set<string>();
    const preparedTrades: Array<{
      stableId: string;
      trade: TradeInput;
      assistantReviewOverride?: { set: true; value: string | null };
    }> = [];
    for (const entry of args.trades) {
      const stableId = resolveStableId(entry.stableId);
      if (seenTradeIds.has(stableId)) {
        throw new Error(`Duplicate trade stableId in import: ${stableId}`);
      }
      seenTradeIds.add(stableId);
      const trade = tradeInputSchema.parse(entry.trade);
      if (entry.assistantReview !== undefined) {
        const normalized = normalizeAssistantReview(entry.assistantReview);
        if (normalized.imageKeys.length > 0) {
          await verifyOwnedChartKeys(ctx, args.ownerId, normalized.imageKeys);
        }
        preparedTrades.push({
          stableId,
          trade,
          assistantReviewOverride: { set: true, value: normalized.stored },
        });
      } else {
        preparedTrades.push({ stableId, trade });
      }
    }

    const savedOrderDays: JournalOrderBatchDto[] = [];
    for (const item of preparedOrders) {
      savedOrderDays.push(
        await upsertOrderBatchForOwner(ctx, args.ownerId, item.stableId, item.batch),
      );
    }

    const savedTrades: JournalTradeDto[] = [];
    for (const item of preparedTrades) {
      savedTrades.push(
        await upsertTradeForOwner(
          ctx,
          args.ownerId,
          item.stableId,
          item.trade,
          item.assistantReviewOverride,
        ),
      );
    }

    return {
      orderDays: savedOrderDays,
      trades: savedTrades,
    };
  },
});

export const registerChartInternal = internalMutation({
  args: {
    ownerId: v.string(),
    runStableId: v.optional(v.string()),
    imageKey: v.string(),
    storageId: v.id("_storage"),
    mimeType: journalChartMimeTypeValidator,
    width: v.number(),
    height: v.number(),
    symbol: v.optional(v.string()),
    interval: v.optional(v.string()),
    source: journalChartSourceValidator,
  },
  handler: async (ctx, args): Promise<RegisterChartResult> => {
    if (args.runStableId !== undefined) {
      await requireActiveRunForOwner(ctx, args.ownerId, args.runStableId);
    }
    const input: RegisterChartInput = {
      imageKey: args.imageKey,
      storageId: args.storageId,
      mimeType: args.mimeType,
      width: args.width,
      height: args.height,
      source: args.source,
    };
    if (args.symbol !== undefined) input.symbol = args.symbol;
    if (args.interval !== undefined) input.interval = args.interval;
    return registerChartForOwner(ctx, args.ownerId, input);
  },
});

export const migrateDiaryInternal = internalMutation({
  args: {
    ownerId: v.string(),
    replaceExistingReviews: v.optional(v.boolean()),
    orderDays: v.array(
      v.object({
        stableId: v.string(),
        date: v.string(),
        note: v.string(),
        orders: journalOrderBatchInputValidator.fields.orders,
        updatedAt: v.optional(v.number()),
      }),
    ),
    trades: v.array(
      v.object({
        stableId: v.string(),
        trade: journalTradeInputValidator,
        assistantReview: v.optional(v.union(v.string(), v.null())),
        updatedAt: v.optional(v.number()),
      }),
    ),
    lessons: v.array(
      v.object({
        stableId: v.string(),
        lesson: journalLessonInputValidator,
        updatedAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const replaceExistingReviews = args.replaceExistingReviews ?? false;
    const now = Date.now();

    const seenOrderIds = new Set<string>();
    const preparedOrders = args.orderDays.map((entry) => {
      const stableId = journalStableIdSchema.parse(entry.stableId);
      if (seenOrderIds.has(stableId)) {
        throw new Error(`Duplicate order batch stableId in migration: ${stableId}`);
      }
      seenOrderIds.add(stableId);
      const batch = orderBatchInputSchema.parse({
        date: entry.date,
        note: entry.note,
        orders: entry.orders,
      });
      const updatedAt = resolveTimestamp(entry.updatedAt, now);
      return { stableId, batch, updatedAt };
    });

    const seenTradeIds = new Set<string>();
    const preparedTrades: Array<{
      stableId: string;
      trade: TradeInput;
      incomingReview: string | null | undefined;
      updatedAt: number;
    }> = [];
    for (const entry of args.trades) {
      const stableId = journalStableIdSchema.parse(entry.stableId);
      if (seenTradeIds.has(stableId)) {
        throw new Error(`Duplicate trade stableId in migration: ${stableId}`);
      }
      seenTradeIds.add(stableId);
      const trade = tradeInputSchema.parse(entry.trade);
      const updatedAt = resolveTimestamp(entry.updatedAt, now);
      let incomingReview: string | null | undefined;
      if (entry.assistantReview !== undefined) {
        const normalized = normalizeAssistantReview(entry.assistantReview);
        if (normalized.imageKeys.length > 0) {
          await verifyOwnedChartKeys(ctx, args.ownerId, normalized.imageKeys);
        }
        incomingReview = normalized.stored;
      }
      preparedTrades.push({ stableId, trade, incomingReview, updatedAt });
    }

    const seenLessonIds = new Set<string>();
    const preparedLessons: Array<{
      stableId: string;
      lesson: LessonInput;
      updatedAt: number;
    }> = [];
    for (const entry of args.lessons) {
      const stableId = journalStableIdSchema.parse(entry.stableId);
      if (seenLessonIds.has(stableId)) {
        throw new Error(`Duplicate lesson stableId in migration: ${stableId}`);
      }
      seenLessonIds.add(stableId);
      const lesson = lessonInputSchema.parse(entry.lesson);
      const updatedAt = resolveTimestamp(entry.updatedAt, now);
      if (lesson.tradeStableId !== null && !seenTradeIds.has(lesson.tradeStableId)) {
        const tradeStableId = lesson.tradeStableId;
        const existingTrade = await ctx.db
          .query("journalTrades")
          .withIndex("by_owner_stable", (index) =>
            index.eq("ownerId", args.ownerId).eq("stableId", tradeStableId),
          )
          .unique();
        if (!existingTrade) {
          throw new Error(`Lesson ${stableId} references missing trade ${tradeStableId}.`);
        }
      }
      preparedLessons.push({ stableId, lesson, updatedAt });
    }

    for (const item of preparedOrders) {
      await upsertOrderBatchForOwner(ctx, args.ownerId, item.stableId, item.batch, item.updatedAt);
    }

    let preservedReviews = 0;
    for (const item of preparedTrades) {
      const existing = await ctx.db
        .query("journalTrades")
        .withIndex("by_owner_stable", (index) =>
          index.eq("ownerId", args.ownerId).eq("stableId", item.stableId),
        )
        .unique();

      let reviewOverride: { set: true; value: string | null } | undefined;
      if (existing && existing.assistantReview !== null && !replaceExistingReviews) {
        if (item.incomingReview === undefined || item.incomingReview === null) {
          preservedReviews += 1;
        } else if (existing.updatedAt >= item.updatedAt) {
          preservedReviews += 1;
        } else {
          reviewOverride = { set: true, value: item.incomingReview };
        }
      } else if (item.incomingReview !== undefined) {
        reviewOverride = { set: true, value: item.incomingReview };
      }

      const effectiveUpdatedAt = existing && existing.updatedAt > item.updatedAt && !replaceExistingReviews
        ? existing.updatedAt
        : item.updatedAt;

      await upsertTradeForOwner(
        ctx,
        args.ownerId,
        item.stableId,
        item.trade,
        reviewOverride,
        effectiveUpdatedAt,
      );
    }

    for (const item of preparedLessons) {
      await upsertLessonForOwner(ctx, args.ownerId, item.stableId, item.lesson, item.updatedAt);
    }

    return {
      orderDays: preparedOrders.length,
      trades: preparedTrades.length,
      lessons: preparedLessons.length,
      preservedReviews,
    };
  },
});

export interface JournalDispatchPayload {
  runId: string;
  ownerId: string;
  settings: JournalSettingsDto;
  userMessage: JournalChatMessageDto;
  history: JournalChatMessageDto[];
}

export const getRunDispatchContextInternal = internalQuery({
  args: {
    ownerId: v.string(),
    runStableId: v.string(),
  },
  handler: async (ctx, args): Promise<JournalDispatchPayload | null> => {
    const run = await ctx.db
      .query("journalChatRuns")
      .withIndex("by_stable", (index) => index.eq("stableId", args.runStableId))
      .unique();
    if (!run || run.ownerId !== args.ownerId || run.status !== "pending") {
      return null;
    }

    const userMessage = await ctx.db.get(run.userMessageId);
    const assistantMessage = await ctx.db.get(run.assistantMessageId);
    if (!userMessage || !assistantMessage || assistantMessage.status !== "pending") {
      return null;
    }

    const settings = await readSettingsForOwner(ctx, args.ownerId);
    const recentRows = await ctx.db
      .query("journalChatMessages")
      .withIndex("by_owner_ordinal", (index) => index.eq("ownerId", args.ownerId))
      .order("desc")
      .take(MAX_RECENT_HISTORY_MESSAGES + 2);

    const historyRows = recentRows
      .filter((row) => row._id !== assistantMessage._id && row._id !== userMessage._id)
      .slice(0, MAX_RECENT_HISTORY_MESSAGES)
      .toReversed();

    const [userMessageDto, history] = await Promise.all([
      toChatMessageDto(ctx, userMessage),
      Promise.all(historyRows.map((row) => toChatMessageDto(ctx, row))),
    ]);

    return {
      runId: run.stableId,
      ownerId: args.ownerId,
      settings,
      userMessage: userMessageDto,
      history,
    };
  },
});

export const markRunRunningInternal = internalMutation({
  args: {
    ownerId: v.string(),
    runStableId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ marked: boolean; status: JournalChatStatus | "missing" }> => {
    const run = await ctx.db
      .query("journalChatRuns")
      .withIndex("by_stable", (index) => index.eq("stableId", args.runStableId))
      .unique();
    if (!run || run.ownerId !== args.ownerId) {
      return { marked: false, status: "missing" };
    }
    if (run.status !== "pending") {
      return { marked: false, status: run.status };
    }
    const now = Date.now();
    await ctx.db.patch(run._id, { status: "running", updatedAt: now });
    await ctx.db.patch(run.assistantMessageId, { status: "running", updatedAt: now });
    return { marked: true, status: "running" };
  },
});

export const expireStaleRun = internalMutation({
  args: {
    runStableId: v.string(),
  },
  handler: async (ctx, args): Promise<{ expired: boolean }> => {
    const run = await ctx.db
      .query("journalChatRuns")
      .withIndex("by_stable", (index) => index.eq("stableId", args.runStableId))
      .unique();
    if (!run || (run.status !== "pending" && run.status !== "running")) {
      return { expired: false };
    }
    const now = Date.now();
    const errorMessage = "Journal assistant run timed out.";
    await ctx.db.patch(run._id, {
      status: "failed",
      error: errorMessage,
      updatedAt: now,
    });
    await ctx.db.patch(run.assistantMessageId, {
      status: "failed",
      error: errorMessage,
      updatedAt: now,
    });
    return { expired: true };
  },
});

export const updateRunProgressInternal = internalMutation({
  args: {
    ownerId: v.string(),
    runId: v.string(),
    text: v.optional(v.string()),
    toolEvents: v.optional(v.array(journalToolEventValidator)),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { accepted: true; status: "running" }
    | { accepted: false; reason: "run_not_found" }
    | { accepted: false; reason: "run_not_active"; status: JournalChatStatus }
  > => {
    const run = await ctx.db
      .query("journalChatRuns")
      .withIndex("by_stable", (index) => index.eq("stableId", args.runId))
      .unique();
    if (!run || run.ownerId !== args.ownerId) {
      return { accepted: false, reason: "run_not_found" };
    }
    if (run.status !== "pending" && run.status !== "running") {
      return { accepted: false, reason: "run_not_active", status: run.status };
    }

    const now = Date.now();
    if (run.status === "pending") {
      await ctx.db.patch(run._id, { status: "running", updatedAt: now });
    } else {
      await ctx.db.patch(run._id, { updatedAt: now });
    }

    const messagePatch: ProgressMessagePatch = {
      status: "running",
      updatedAt: now,
    };
    if (args.text !== undefined) {
      if (args.text.length > MAX_CHAT_TEXT_LENGTH) {
        throw new Error(`Progress text must be at most ${MAX_CHAT_TEXT_LENGTH} characters.`);
      }
      messagePatch.text = args.text;
    }
    if (args.toolEvents !== undefined) {
      messagePatch.toolEvents = args.toolEvents.map((event) =>
        toExactToolEvent(toolEventSchema.parse(event)),
      );
    }
    await ctx.db.patch(run.assistantMessageId, messagePatch);
    return { accepted: true, status: "running" };
  },
});

export const completeRunInternal = internalMutation({
  args: {
    ownerId: v.string(),
    runId: v.string(),
    status: journalTerminalChatStatusValidator,
    text: v.string(),
    toolEvents: v.optional(v.array(journalToolEventValidator)),
    error: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { accepted: true; status: JournalTerminalChatStatus }
    | { accepted: false; reason: "run_not_found" }
    | { accepted: false; reason: "run_already_canceled"; status: "canceled" }
    | { accepted: false; reason: "run_already_finalized"; status: JournalTerminalChatStatus }
  > => {
    const run = await ctx.db
      .query("journalChatRuns")
      .withIndex("by_stable", (index) => index.eq("stableId", args.runId))
      .unique();
    if (!run || run.ownerId !== args.ownerId) {
      return { accepted: false, reason: "run_not_found" };
    }
    if (run.status === "canceled") {
      if (args.status === "canceled") {
        return { accepted: true, status: "canceled" };
      }
      return { accepted: false, reason: "run_already_canceled", status: "canceled" };
    }
    if (run.status === "completed" || run.status === "failed") {
      if (run.status === args.status) {
        return { accepted: true, status: run.status };
      }
      return { accepted: false, reason: "run_already_finalized", status: run.status };
    }

    if (args.text.length > MAX_CHAT_TEXT_LENGTH) {
      throw new Error(`Final assistant text must be at most ${MAX_CHAT_TEXT_LENGTH} characters.`);
    }

    const now = Date.now();
    const trimmedError = args.error?.trim();
    const runPatch: CompleteRunPatch = {
      status: args.status,
      updatedAt: now,
    };
    if (trimmedError) {
      runPatch.error = trimmedError.slice(0, 1000);
    }
    await ctx.db.patch(run._id, runPatch);

    const messagePatch: CompleteMessagePatch = {
      status: args.status,
      text: args.text,
      updatedAt: now,
    };
    if (args.toolEvents !== undefined) {
      messagePatch.toolEvents = args.toolEvents.map((event) =>
        toExactToolEvent(toolEventSchema.parse(event)),
      );
    }
    if (trimmedError) {
      messagePatch.error = trimmedError.slice(0, 1000);
    }
    await ctx.db.patch(run.assistantMessageId, messagePatch);

    return { accepted: true, status: args.status };
  },
});
