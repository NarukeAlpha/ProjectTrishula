import { z } from "zod";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { httpAction, type ActionCtx } from "./_generated/server.js";
import type { JournalChartDto, RegisterChartResult } from "./journal.js";
import { requireAllowedWorkosUserId } from "./lib/auth.js";
import {
  chartMimeTypes,
  chartReviewSchema,
  chartSources,
  decodeBase64Image,
  isoDateSchema,
  journalStableIdSchema,
  lessonInputSchema,
  MAX_CHART_IMAGE_BYTES,
  MAX_CHAT_TEXT_LENGTH,
  normalizeAssistantReview,
  orderSchema,
  sha256HexBytes,
  sniffChartImage,
  terminalChatStatuses,
  toExactToolEvent,
  toolEventSchema,
  tradeInputSchema,
  type JournalChartMimeType,
  type JournalChartSource,
  type JournalTerminalChatStatus,
  type JournalToolEvent,
  type LessonInput,
  type Order,
  type TradeInput,
} from "./lib/journal.js";
import { verifyJournalRunToken } from "./lib/journal_token.js";
import { authorizedServiceRequest, constantTimeEqual } from "./lib/service_auth.js";

const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;
const UPLOAD_CHART_MAX_BODY_BYTES = 15 * 1024 * 1024;

const responseHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

function jsonResponse<TBody>(body: TBody, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

const ownerIdSchema = z.string().trim().min(1).max(256);
const optionalRunTokenSchema = z.string().trim().min(1).max(2_048).optional();
const optionalUpdatedAtSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional();
const assistantReviewInputSchema = z.union([z.string(), chartReviewSchema, z.null()]);

interface NormalizedImportTradeInput {
  stableId?: string;
  trade: TradeInput;
  assistantReview?: z.infer<typeof assistantReviewInputSchema>;
  updatedAt?: number;
}

interface ImportOrderDayArgs {
  stableId?: string;
  date: string;
  note: string;
  orders: Order[];
}

interface ImportTradeArgs {
  stableId?: string;
  trade: TradeInput;
  assistantReview?: string | null;
}

interface MigrateOrderDayArgs {
  stableId: string;
  date: string;
  note: string;
  orders: Order[];
  updatedAt?: number;
}

interface MigrateTradeArgs {
  stableId: string;
  trade: TradeInput;
  assistantReview?: string | null;
  updatedAt?: number;
}

interface MigrateLessonArgs {
  stableId: string;
  lesson: LessonInput;
  updatedAt?: number;
}

interface UpsertTradeInternalArgs {
  ownerId: string;
  runStableId: string;
  stableId?: string;
  trade: TradeInput;
}

interface UpsertLessonInternalArgs {
  ownerId: string;
  runStableId: string;
  stableId?: string;
  lesson: LessonInput;
}

interface RegisterChartInternalArgs {
  ownerId: string;
  runStableId?: string;
  imageKey: string;
  storageId: Id<"_storage">;
  mimeType: JournalChartMimeType;
  width: number;
  height: number;
  symbol?: string;
  interval?: string;
  source: JournalChartSource;
}

interface GetChartLookupArgs {
  ownerId: string;
  imageKey: string;
  runStableId?: string;
}

interface RunProgressInternalArgs {
  ownerId: string;
  runId: string;
  text?: string;
  toolEvents?: JournalToolEvent[];
}

interface RunCompleteInternalArgs {
  ownerId: string;
  runId: string;
  status: JournalTerminalChatStatus;
  text: string;
  toolEvents?: JournalToolEvent[];
  error?: string;
}

const getDiaryRequestSchema = z.object({
  ownerId: ownerIdSchema,
  runId: journalStableIdSchema.optional(),
  runToken: optionalRunTokenSchema,
}).strict();

const importOrderBatchSchema = z.object({
  stableId: journalStableIdSchema.optional(),
  id: journalStableIdSchema.optional(),
  date: isoDateSchema,
  note: z.string().trim().max(6000),
  orders: z.array(orderSchema).min(1).max(120),
}).strict().superRefine((value, context) => {
  if (value.stableId !== undefined && value.id !== undefined && value.stableId !== value.id) {
    context.addIssue({
      code: "custom",
      message: "stableId and id must match when both are provided.",
    });
  }
});

const nestedImportTradeSchema = z.object({
  stableId: journalStableIdSchema.optional(),
  id: journalStableIdSchema.optional(),
  trade: tradeInputSchema,
  assistantReview: assistantReviewInputSchema.optional(),
  updatedAt: optionalUpdatedAtSchema,
}).strict().superRefine((value, context) => {
  if (value.stableId !== undefined && value.id !== undefined && value.stableId !== value.id) {
    context.addIssue({
      code: "custom",
      message: "stableId and id must match when both are provided.",
    });
  }
});

const flatImportTradeSchema = z.object({
  stableId: journalStableIdSchema.optional(),
  id: journalStableIdSchema.optional(),
  symbol: z.string(),
  instrument: z.string(),
  account: z.string(),
  direction: z.string(),
  status: z.string(),
  openedOn: z.string(),
  closedOn: z.string().nullable(),
  setup: z.string(),
  size: z.string(),
  details: z.string(),
  plannedRiskCents: z.number().nullable(),
  realizedPnlCents: z.number().nullable(),
  thesis: z.string(),
  plan: z.string(),
  review: z.string(),
  adherence: z.string(),
  mistakes: z.array(z.string()),
  assistantReview: assistantReviewInputSchema.optional(),
  updatedAt: optionalUpdatedAtSchema,
}).strict().transform((value, context) => {
  if (value.stableId !== undefined && value.id !== undefined && value.stableId !== value.id) {
    context.addIssue({
      code: "custom",
      message: "stableId and id must match when both are provided.",
    });
    return z.NEVER;
  }
  const { stableId, id, assistantReview, updatedAt, ...rawTrade } = value;
  const parsedTrade = tradeInputSchema.safeParse(rawTrade);
  if (!parsedTrade.success) {
    for (const issue of parsedTrade.error.issues) {
      context.addIssue({
        code: "custom",
        message: issue.message,
        path: issue.path,
      });
    }
    return z.NEVER;
  }
  const result: NormalizedImportTradeInput = {
    trade: parsedTrade.data,
  };
  const resolvedId = stableId ?? id;
  if (resolvedId !== undefined) result.stableId = resolvedId;
  if (assistantReview !== undefined) result.assistantReview = assistantReview;
  if (updatedAt !== undefined) result.updatedAt = updatedAt;
  return result;
});

const importOrdersRequestSchema = z.object({
  ownerId: ownerIdSchema,
  runId: journalStableIdSchema.optional(),
  runToken: optionalRunTokenSchema,
  orderDays: z.array(importOrderBatchSchema).max(100),
  trades: z.array(z.union([nestedImportTradeSchema, flatImportTradeSchema])).max(200),
}).strict();

const upsertTradeRequestSchema = z.object({
  ownerId: ownerIdSchema,
  runId: journalStableIdSchema.optional(),
  runToken: optionalRunTokenSchema,
  stableId: journalStableIdSchema.optional(),
  trade: tradeInputSchema,
}).strict();

const saveReviewRequestSchema = z.object({
  ownerId: ownerIdSchema,
  runId: journalStableIdSchema.optional(),
  runToken: optionalRunTokenSchema,
  tradeStableId: journalStableIdSchema,
  assistantReview: assistantReviewInputSchema,
}).strict();

const upsertLessonRequestSchema = z.object({
  ownerId: ownerIdSchema,
  runId: journalStableIdSchema.optional(),
  runToken: optionalRunTokenSchema,
  stableId: journalStableIdSchema.optional(),
  lesson: lessonInputSchema,
}).strict();

const uploadChartWorkerRequestSchema = z.object({
  ownerId: ownerIdSchema,
  runId: journalStableIdSchema.optional(),
  runToken: optionalRunTokenSchema,
  base64Data: z.string().min(1),
  mimeType: z.enum(chartMimeTypes).optional(),
  width: z.number().int().min(1).max(16000).optional(),
  height: z.number().int().min(1).max(16000).optional(),
  symbol: z.string().trim().min(1).max(32).optional(),
  interval: z.string().trim().min(1).max(32).optional(),
  source: z.enum(chartSources).optional(),
}).strict();

const uploadChartAdminRequestSchema = z.object({
  ownerId: ownerIdSchema,
  base64Data: z.string().min(1),
  mimeType: z.enum(chartMimeTypes).optional(),
  width: z.number().int().min(1).max(16000).optional(),
  height: z.number().int().min(1).max(16000).optional(),
  symbol: z.string().trim().min(1).max(32).optional(),
  interval: z.string().trim().min(1).max(32).optional(),
  source: z.enum(chartSources).optional(),
}).strict();

const migrateOrderBatchSchema = z.object({
  stableId: journalStableIdSchema,
  date: isoDateSchema,
  note: z.string().trim().max(6000),
  orders: z.array(orderSchema).min(1).max(120),
  updatedAt: optionalUpdatedAtSchema,
}).strict();

const migrateTradeSchema = z.object({
  stableId: journalStableIdSchema,
  trade: tradeInputSchema,
  assistantReview: assistantReviewInputSchema.optional(),
  updatedAt: optionalUpdatedAtSchema,
}).strict();

const migrateLessonSchema = z.object({
  stableId: journalStableIdSchema,
  lesson: lessonInputSchema,
  updatedAt: optionalUpdatedAtSchema,
}).strict();

const adminMigrateRequestSchema = z.object({
  ownerId: ownerIdSchema,
  replaceExistingReviews: z.boolean().optional(),
  orderDays: z.array(migrateOrderBatchSchema).max(200),
  trades: z.array(migrateTradeSchema).max(500),
  lessons: z.array(migrateLessonSchema).max(500),
}).strict();

const runProgressRequestSchema = z.object({
  ownerId: ownerIdSchema,
  runId: journalStableIdSchema,
  runToken: optionalRunTokenSchema,
  text: z.string().max(MAX_CHAT_TEXT_LENGTH).optional(),
  toolEvents: z.array(toolEventSchema).max(64).optional(),
}).strict();

const runCompleteRequestSchema = z.object({
  ownerId: ownerIdSchema,
  runId: journalStableIdSchema,
  runToken: optionalRunTokenSchema,
  status: z.enum(terminalChatStatuses),
  text: z.string().max(MAX_CHAT_TEXT_LENGTH),
  toolEvents: z.array(toolEventSchema).max(64).optional(),
  error: z.string().max(1000).optional(),
}).strict();

type ParseBodyResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: 400 | 413 | 415; error: string };

function hasJsonContentType(request: Request): boolean {
  const header = request.headers.get("content-type");
  if (!header) return false;
  const mediaType = header.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

async function readStreamedBytes(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; status: 400 | 413; error: string }> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, status: 413, error: "Request body exceeds size limit." };
  }
  if (request.body === null) {
    return { ok: false, status: 400, error: "Request body is required." };
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { ok: false, status: 413, error: "Request body exceeds size limit." };
      }
      chunks.push(next.value);
    }
  } catch {
    return { ok: false, status: 400, error: "Could not read request body." };
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes: combined };
}

async function parseBoundedJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<ParseBodyResult<T>> {
  if (!hasJsonContentType(request)) {
    return { ok: false, status: 415, error: "Content-Type must be application/json." };
  }
  const streamed = await readStreamedBytes(request, maxBytes);
  if (!streamed.ok) return streamed;

  let rawText: string;
  try {
    rawText = new TextDecoder("utf-8", { fatal: true }).decode(streamed.bytes);
  } catch {
    return { ok: false, status: 400, error: "Request body must be valid UTF-8." };
  }

  let jsonValue: z.infer<ReturnType<typeof z.json>>;
  try {
    jsonValue = z.json().parse(JSON.parse(rawText));
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON body." };
  }
  const parsed = schema.safeParse(jsonValue);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      ok: false,
      status: 400,
      error: firstIssue ? firstIssue.message : "Invalid request payload.",
    };
  }
  return { ok: true, data: parsed.data };
}

function authorizeOwner(
  ownerId: string,
): { ok: true; ownerId: string } | { ok: false; response: Response } {
  try {
    return { ok: true, ownerId: requireAllowedWorkosUserId(ownerId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "WorkOS user is not allowed.";
    return { ok: false, response: jsonResponse({ error: message }, 403) };
  }
}

interface ExpectedRunClaims {
  ownerId: string;
  runId?: string;
}

interface WorkerRunAuthSource {
  ownerId: string;
  runId?: string | undefined;
  runToken?: string | undefined;
}

async function authorizeWorkerRun(
  request: Request,
  input: WorkerRunAuthSource,
): Promise<{ ok: true; ownerId: string; runId: string } | { ok: false; response: Response }> {
  const owner = authorizeOwner(input.ownerId);
  if (!owner.ok) return owner;

  const headerToken = request.headers.get("x-journal-run-token")?.trim() || undefined;
  const bodyToken = input.runToken?.trim() || undefined;
  if (headerToken !== undefined && bodyToken !== undefined && headerToken !== bodyToken) {
    return { ok: false, response: jsonResponse({ error: "Conflicting run tokens." }, 401) };
  }
  const token = headerToken ?? bodyToken;
  if (!token) {
    return { ok: false, response: jsonResponse({ error: "Run capability token is required." }, 401) };
  }

  const expected: ExpectedRunClaims = { ownerId: owner.ownerId };
  if (input.runId !== undefined) expected.runId = input.runId;
  const verified = await verifyJournalRunToken(token, expected);
  if (!verified.ok) {
    const status = verified.code === "owner_mismatch" || verified.code === "run_mismatch" ? 403 : 401;
    return { ok: false, response: jsonResponse({ error: verified.error }, status) };
  }
  return { ok: true, ownerId: owner.ownerId, runId: verified.payload.runId };
}

function authorizedAdminMigrationRequest(request: Request): boolean {
  const migrationHeader = request.headers.get("x-journal-admin-migration")?.trim().toLowerCase();
  if (migrationHeader !== "true") return false;

  const adminSecret = process.env.JOURNAL_ADMIN_SECRET?.trim();
  if (!adminSecret) {
    return authorizedServiceRequest(request);
  }
  const authHeader = request.headers.get("authorization");
  const matched = authHeader?.match(/^Bearer\s+(.+)$/i);
  const supplied = matched?.[1];
  return Boolean(supplied && constantTimeEqual(supplied, adminSecret));
}

function errorMessage(error: Error | string): string {
  return error instanceof Error ? error.message : error;
}

function mapToolMutationError(error: Error | string, fallback: string): Response {
  const message = errorMessage(error);
  if (message === "run_not_active") {
    return jsonResponse({ error: "run_not_active" }, 409);
  }
  if (message === "Trade not found.") {
    return jsonResponse({ error: message }, 404);
  }
  return jsonResponse({ error: message || fallback }, 400);
}

interface ChartUploadCoreInput {
  ownerId: string;
  runStableId?: string;
  base64Data: string;
  declaredMimeType?: JournalChartMimeType;
  declaredWidth?: number;
  declaredHeight?: number;
  symbol?: string;
  interval?: string;
  source: JournalChartSource;
}

async function handleVerifiedChartUpload(
  ctx: ActionCtx,
  input: ChartUploadCoreInput,
): Promise<Response> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = decodeBase64Image(input.base64Data, MAX_CHART_IMAGE_BYTES);
  } catch (error) {
    const message = error instanceof Error ? errorMessage(error) : "Invalid chart image payload.";
    const status = message.includes("size") ? 413 : 400;
    return jsonResponse({ error: message }, status);
  }

  let sniffed: ReturnType<typeof sniffChartImage>;
  try {
    sniffed = sniffChartImage(bytes);
  } catch (error) {
    const message = error instanceof Error ? errorMessage(error) : "Unsupported image format.";
    return jsonResponse({ error: message }, 400);
  }

  if (input.declaredMimeType !== undefined && input.declaredMimeType !== sniffed.mimeType) {
    return jsonResponse({ error: "Image bytes do not match declared mimeType." }, 400);
  }
  if (
    (input.declaredWidth !== undefined && input.declaredWidth !== sniffed.width)
    || (input.declaredHeight !== undefined && input.declaredHeight !== sniffed.height)
  ) {
    return jsonResponse({ error: "Image bytes do not match declared dimensions." }, 400);
  }

  const imageKey = await sha256HexBytes(bytes);
  const lookupArgs: GetChartLookupArgs = {
    ownerId: input.ownerId,
    imageKey,
  };
  if (input.runStableId !== undefined) lookupArgs.runStableId = input.runStableId;

  let existing: JournalChartDto | null;
  try {
    existing = await ctx.runQuery(internal.journal.getChartByImageKeyInternal, lookupArgs);
  } catch (error) {
    return mapToolMutationError(
      error instanceof Error ? error : "Could not look up chart.",
      "Could not look up chart.",
    );
  }

  if (existing !== null && existing.url !== null) {
    return jsonResponse({
      imageKey: existing.imageKey,
      storageId: existing.storageId,
      mimeType: existing.mimeType,
      url: existing.url,
      width: existing.width ?? sniffed.width,
      height: existing.height ?? sniffed.height,
    });
  }

  const newStorageId = await ctx.storage.store(new Blob([bytes], { type: sniffed.mimeType }));
  try {
    const registerArgs: RegisterChartInternalArgs = {
      ownerId: input.ownerId,
      imageKey,
      storageId: newStorageId,
      mimeType: sniffed.mimeType,
      width: sniffed.width,
      height: sniffed.height,
      source: input.source,
    };
    if (input.runStableId !== undefined) registerArgs.runStableId = input.runStableId;
    if (input.symbol !== undefined) registerArgs.symbol = input.symbol;
    if (input.interval !== undefined) registerArgs.interval = input.interval;

    const registered: RegisterChartResult = await ctx.runMutation(
      internal.journal.registerChartInternal,
      registerArgs,
    );
    if (registered.deduplicated && registered.chart.storageId !== newStorageId) {
      await ctx.storage.delete(newStorageId);
    }
    return jsonResponse({
      imageKey: registered.chart.imageKey,
      storageId: registered.chart.storageId,
      mimeType: registered.chart.mimeType,
      url: registered.chart.url,
      width: registered.chart.width,
      height: registered.chart.height,
    });
  } catch (error) {
    await ctx.storage.delete(newStorageId).catch(() => undefined);
    return mapToolMutationError(
      error instanceof Error ? error : "Could not upload chart.",
      "Could not upload chart.",
    );
  }
}

// ---------------------------------------------------------------------------
// Run-scoped worker tool & callback endpoints (/internal/journal/tools/* & /runs/*)
// ---------------------------------------------------------------------------

export const journalGetDiary = httpAction(async (ctx, request) => {
  if (!authorizedServiceRequest(request)) return jsonResponse({ error: "Unauthorized." }, 401);
  const parsed = await parseBoundedJson(request, getDiaryRequestSchema);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);

  const auth = await authorizeWorkerRun(request, parsed.data);
  if (!auth.ok) return auth.response;

  try {
    const diary = await ctx.runQuery(internal.journal.getDiaryForOwner, {
      ownerId: auth.ownerId,
      runStableId: auth.runId,
    });
    return jsonResponse(diary);
  } catch (error) {
    return mapToolMutationError(
      error instanceof Error ? error : "Could not read diary.",
      "Could not read diary.",
    );
  }
});

export const journalImportOrders = httpAction(async (ctx, request) => {
  if (!authorizedServiceRequest(request)) return jsonResponse({ error: "Unauthorized." }, 401);
  const parsed = await parseBoundedJson(request, importOrdersRequestSchema);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);

  const auth = await authorizeWorkerRun(request, parsed.data);
  if (!auth.ok) return auth.response;

  try {
    const orderDays: ImportOrderDayArgs[] = parsed.data.orderDays.map((entry) => {
      const item: ImportOrderDayArgs = {
        date: entry.date,
        note: entry.note,
        orders: entry.orders,
      };
      const resolvedId = entry.stableId ?? entry.id;
      if (resolvedId !== undefined) item.stableId = resolvedId;
      return item;
    });

    const trades: ImportTradeArgs[] = parsed.data.trades.map((entry) => {
      const item: ImportTradeArgs = {
        trade: entry.trade,
      };
      const resolvedId = entry.stableId ?? ("id" in entry ? entry.id : undefined);
      if (resolvedId !== undefined) item.stableId = resolvedId;
      if (entry.assistantReview !== undefined) {
        item.assistantReview = normalizeAssistantReview(entry.assistantReview).stored;
      }
      return item;
    });

    const result = await ctx.runMutation(internal.journal.importOrdersInternal, {
      ownerId: auth.ownerId,
      runStableId: auth.runId,
      orderDays,
      trades,
    });
    return jsonResponse(result);
  } catch (error) {
    return mapToolMutationError(
      error instanceof Error ? error : "Order import failed.",
      "Order import failed.",
    );
  }
});

export const journalUpsertTrade = httpAction(async (ctx, request) => {
  if (!authorizedServiceRequest(request)) return jsonResponse({ error: "Unauthorized." }, 401);
  const parsed = await parseBoundedJson(request, upsertTradeRequestSchema);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);

  const auth = await authorizeWorkerRun(request, parsed.data);
  if (!auth.ok) return auth.response;

  try {
    const args: UpsertTradeInternalArgs = {
      ownerId: auth.ownerId,
      runStableId: auth.runId,
      trade: parsed.data.trade,
    };
    if (parsed.data.stableId !== undefined) args.stableId = parsed.data.stableId;
    const saved = await ctx.runMutation(internal.journal.upsertTradeInternal, args);
    return jsonResponse(saved);
  } catch (error) {
    return mapToolMutationError(
      error instanceof Error ? error : "Could not save trade.",
      "Could not save trade.",
    );
  }
});

export const journalSaveReview = httpAction(async (ctx, request) => {
  if (!authorizedServiceRequest(request)) return jsonResponse({ error: "Unauthorized." }, 401);
  const parsed = await parseBoundedJson(request, saveReviewRequestSchema);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);

  const auth = await authorizeWorkerRun(request, parsed.data);
  if (!auth.ok) return auth.response;

  let storedReview: string | null;
  try {
    storedReview = normalizeAssistantReview(parsed.data.assistantReview).stored;
  } catch (error) {
    const message = error instanceof Error ? errorMessage(error) : "Invalid assistant review.";
    return jsonResponse({ error: message }, 400);
  }

  try {
    const saved = await ctx.runMutation(internal.journal.saveReviewInternal, {
      ownerId: auth.ownerId,
      runStableId: auth.runId,
      tradeStableId: parsed.data.tradeStableId,
      assistantReview: storedReview,
    });
    return jsonResponse(saved);
  } catch (error) {
    return mapToolMutationError(
      error instanceof Error ? error : "Could not save review.",
      "Could not save review.",
    );
  }
});

export const journalUpsertLesson = httpAction(async (ctx, request) => {
  if (!authorizedServiceRequest(request)) return jsonResponse({ error: "Unauthorized." }, 401);
  const parsed = await parseBoundedJson(request, upsertLessonRequestSchema);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);

  const auth = await authorizeWorkerRun(request, parsed.data);
  if (!auth.ok) return auth.response;

  try {
    const args: UpsertLessonInternalArgs = {
      ownerId: auth.ownerId,
      runStableId: auth.runId,
      lesson: parsed.data.lesson,
    };
    if (parsed.data.stableId !== undefined) args.stableId = parsed.data.stableId;
    const saved = await ctx.runMutation(internal.journal.upsertLessonInternal, args);
    return jsonResponse(saved);
  } catch (error) {
    return mapToolMutationError(
      error instanceof Error ? error : "Could not save lesson.",
      "Could not save lesson.",
    );
  }
});

export const journalUploadChart = httpAction(async (ctx, request) => {
  if (!authorizedServiceRequest(request)) return jsonResponse({ error: "Unauthorized." }, 401);
  const parsed = await parseBoundedJson(
    request,
    uploadChartWorkerRequestSchema,
    UPLOAD_CHART_MAX_BODY_BYTES,
  );
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);

  const auth = await authorizeWorkerRun(request, parsed.data);
  if (!auth.ok) return auth.response;

  const uploadInput: ChartUploadCoreInput = {
    ownerId: auth.ownerId,
    runStableId: auth.runId,
    base64Data: parsed.data.base64Data,
    source: parsed.data.source ?? "chart_img",
  };
  if (parsed.data.mimeType !== undefined) uploadInput.declaredMimeType = parsed.data.mimeType;
  if (parsed.data.width !== undefined) uploadInput.declaredWidth = parsed.data.width;
  if (parsed.data.height !== undefined) uploadInput.declaredHeight = parsed.data.height;
  if (parsed.data.symbol !== undefined) uploadInput.symbol = parsed.data.symbol;
  if (parsed.data.interval !== undefined) uploadInput.interval = parsed.data.interval;
  return handleVerifiedChartUpload(ctx, uploadInput);
});

export const journalRunProgress = httpAction(async (ctx, request) => {
  if (!authorizedServiceRequest(request)) return jsonResponse({ error: "Unauthorized." }, 401);
  const parsed = await parseBoundedJson(request, runProgressRequestSchema);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);

  const auth = await authorizeWorkerRun(request, parsed.data);
  if (!auth.ok) return auth.response;

  const args: RunProgressInternalArgs = {
    ownerId: auth.ownerId,
    runId: auth.runId,
  };
  if (parsed.data.text !== undefined) args.text = parsed.data.text;
  if (parsed.data.toolEvents !== undefined) {
    args.toolEvents = parsed.data.toolEvents.map(toExactToolEvent);
  }

  const result = await ctx.runMutation(internal.journal.updateRunProgressInternal, args);
  if (result.accepted) return jsonResponse(result, 200);
  return jsonResponse(result, result.reason === "run_not_found" ? 404 : 409);
});

export const journalRunComplete = httpAction(async (ctx, request) => {
  if (!authorizedServiceRequest(request)) return jsonResponse({ error: "Unauthorized." }, 401);
  const parsed = await parseBoundedJson(request, runCompleteRequestSchema);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);

  const auth = await authorizeWorkerRun(request, parsed.data);
  if (!auth.ok) return auth.response;

  const args: RunCompleteInternalArgs = {
    ownerId: auth.ownerId,
    runId: auth.runId,
    status: parsed.data.status,
    text: parsed.data.text,
  };
  if (parsed.data.toolEvents !== undefined) {
    args.toolEvents = parsed.data.toolEvents.map(toExactToolEvent);
  }
  if (parsed.data.error !== undefined) args.error = parsed.data.error;

  const result = await ctx.runMutation(internal.journal.completeRunInternal, args);
  if (result.accepted) return jsonResponse(result, 200);
  return jsonResponse(result, result.reason === "run_not_found" ? 404 : 409);
});

// ---------------------------------------------------------------------------
// Dedicated admin migration endpoints (/internal/journal/admin/*)
// ---------------------------------------------------------------------------

export const journalAdminUploadChart = httpAction(async (ctx, request) => {
  if (!authorizedAdminMigrationRequest(request)) {
    return jsonResponse({ error: "Unauthorized admin migration request." }, 401);
  }
  const parsed = await parseBoundedJson(
    request,
    uploadChartAdminRequestSchema,
    UPLOAD_CHART_MAX_BODY_BYTES,
  );
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);
  const owner = authorizeOwner(parsed.data.ownerId);
  if (!owner.ok) return owner.response;

  const uploadInput: ChartUploadCoreInput = {
    ownerId: owner.ownerId,
    base64Data: parsed.data.base64Data,
    source: parsed.data.source ?? "migration",
  };
  if (parsed.data.mimeType !== undefined) uploadInput.declaredMimeType = parsed.data.mimeType;
  if (parsed.data.width !== undefined) uploadInput.declaredWidth = parsed.data.width;
  if (parsed.data.height !== undefined) uploadInput.declaredHeight = parsed.data.height;
  if (parsed.data.symbol !== undefined) uploadInput.symbol = parsed.data.symbol;
  if (parsed.data.interval !== undefined) uploadInput.interval = parsed.data.interval;
  return handleVerifiedChartUpload(ctx, uploadInput);
});

export const journalAdminMigrate = httpAction(async (ctx, request) => {
  if (!authorizedAdminMigrationRequest(request)) {
    return jsonResponse({ error: "Unauthorized admin migration request." }, 401);
  }
  const parsed = await parseBoundedJson(request, adminMigrateRequestSchema);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);
  const owner = authorizeOwner(parsed.data.ownerId);
  if (!owner.ok) return owner.response;

  try {
    const orderDays: MigrateOrderDayArgs[] = parsed.data.orderDays.map((entry) => {
      const item: MigrateOrderDayArgs = {
        stableId: entry.stableId,
        date: entry.date,
        note: entry.note,
        orders: entry.orders,
      };
      if (entry.updatedAt !== undefined) item.updatedAt = entry.updatedAt;
      return item;
    });

    const trades: MigrateTradeArgs[] = parsed.data.trades.map((entry) => {
      const item: MigrateTradeArgs = {
        stableId: entry.stableId,
        trade: entry.trade,
      };
      if (entry.assistantReview !== undefined) {
        item.assistantReview = normalizeAssistantReview(entry.assistantReview).stored;
      }
      if (entry.updatedAt !== undefined) item.updatedAt = entry.updatedAt;
      return item;
    });

    const lessons: MigrateLessonArgs[] = parsed.data.lessons.map((entry) => {
      const item: MigrateLessonArgs = {
        stableId: entry.stableId,
        lesson: entry.lesson,
      };
      if (entry.updatedAt !== undefined) item.updatedAt = entry.updatedAt;
      return item;
    });

    const result = await ctx.runMutation(internal.journal.migrateDiaryInternal, {
      ownerId: owner.ownerId,
      replaceExistingReviews: parsed.data.replaceExistingReviews ?? false,
      orderDays,
      trades,
      lessons,
    });
    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? errorMessage(error) : "Admin migration failed.";
    return jsonResponse({ error: message }, 400);
  }
});
