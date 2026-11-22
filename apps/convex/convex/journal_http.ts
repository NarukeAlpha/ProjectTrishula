import { z } from "zod";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { httpAction } from "./_generated/server.js";
import { requireAllowedWorkosUserId } from "./lib/auth.js";
import {
  chartMimeTypes,
  chartReviewSchema,
  chartSources,
  decodeBase64Image,
  detectImageDimensions,
  isoDateSchema,
  journalStableIdSchema,
  lessonInputSchema,
  MAX_CHART_IMAGE_BYTES,
  MAX_CHAT_TEXT_LENGTH,
  normalizeAssistantReview,
  orderSchema,
  sha256HexBytes,
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
import { authorizedServiceRequest } from "./lib/service_auth.js";

interface NormalizedImportTradeInput {
  stableId?: string;
  trade: TradeInput;
  assistantReview?: z.infer<typeof assistantReviewInputSchema>;
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

interface UpsertTradeInternalArgs {
  ownerId: string;
  stableId?: string;
  trade: TradeInput;
}

interface UpsertLessonInternalArgs {
  ownerId: string;
  stableId?: string;
  lesson: LessonInput;
}

interface UpsertChartInternalArgs {
  ownerId: string;
  imageKey: string;
  storageId: Id<"_storage">;
  mimeType: JournalChartMimeType;
  width?: number;
  height?: number;
  symbol?: string;
  interval?: string;
  source: JournalChartSource;
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

const getDiaryRequestSchema = z.object({
  ownerId: ownerIdSchema,
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

const assistantReviewInputSchema = z.union([z.string(), chartReviewSchema, z.null()]);

const nestedImportTradeSchema = z.object({
  stableId: journalStableIdSchema.optional(),
  id: journalStableIdSchema.optional(),
  trade: tradeInputSchema,
  assistantReview: assistantReviewInputSchema.optional(),
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
}).strict().transform((value, context) => {
  if (value.stableId !== undefined && value.id !== undefined && value.stableId !== value.id) {
    context.addIssue({
      code: "custom",
      message: "stableId and id must match when both are provided.",
    });
    return z.NEVER;
  }
  const { stableId, id, assistantReview, ...rawTrade } = value;
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
  return result;
});

const importOrdersRequestSchema = z.object({
  ownerId: ownerIdSchema,
  orderDays: z.array(importOrderBatchSchema).max(100),
  trades: z.array(z.union([nestedImportTradeSchema, flatImportTradeSchema])).max(200),
}).strict();

const upsertTradeRequestSchema = z.object({
  ownerId: ownerIdSchema,
  stableId: journalStableIdSchema.optional(),
  trade: tradeInputSchema,
}).strict();

const saveReviewRequestSchema = z.object({
  ownerId: ownerIdSchema,
  tradeStableId: journalStableIdSchema,
  assistantReview: assistantReviewInputSchema,
}).strict();

const upsertLessonRequestSchema = z.object({
  ownerId: ownerIdSchema,
  stableId: journalStableIdSchema.optional(),
  lesson: lessonInputSchema,
}).strict();

const uploadChartRequestSchema = z.object({
  ownerId: ownerIdSchema,
  base64Data: z.string().min(1),
  mimeType: z.enum(chartMimeTypes),
  width: z.number().int().min(1).max(16000).optional(),
  height: z.number().int().min(1).max(16000).optional(),
  symbol: z.string().trim().min(1).max(32).optional(),
  interval: z.string().trim().min(1).max(32).optional(),
  source: z.enum(chartSources).optional(),
}).strict();

const runProgressRequestSchema = z.object({
  ownerId: ownerIdSchema,
  runId: journalStableIdSchema,
  text: z.string().max(MAX_CHAT_TEXT_LENGTH).optional(),
  toolEvents: z.array(toolEventSchema).max(64).optional(),
}).strict();

const runCompleteRequestSchema = z.object({
  ownerId: ownerIdSchema,
  runId: journalStableIdSchema,
  status: z.enum(terminalChatStatuses),
  text: z.string().max(MAX_CHAT_TEXT_LENGTH),
  toolEvents: z.array(toolEventSchema).max(64).optional(),
  error: z.string().max(1000).optional(),
}).strict();

type ParseBodyResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: 400 | 413; error: string };

async function parseBoundedJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<ParseBodyResult<T>> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, status: 413, error: "Request body exceeds size limit." };
  }
  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return { ok: false, status: 400, error: "Could not read request body." };
  }
  if (new TextEncoder().encode(rawText).byteLength > maxBytes) {
    return { ok: false, status: 413, error: "Request body exceeds size limit." };
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

function authorizeOwner(ownerId: string): { ok: true; ownerId: string } | { ok: false; response: Response } {
  try {
    return { ok: true, ownerId: requireAllowedWorkosUserId(ownerId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "WorkOS user is not allowed.";
    return { ok: false, response: jsonResponse({ error: message }, 403) };
  }
}

function errorMessage(error: Error | string): string {
  return error instanceof Error ? error.message : error;
}

export const journalGetDiary = httpAction(async (ctx, request) => {
  if (!authorizedServiceRequest(request)) return jsonResponse({ error: "Unauthorized." }, 401);
  const parsed = await parseBoundedJson(request, getDiaryRequestSchema);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);
  const owner = authorizeOwner(parsed.data.ownerId);
  if (!owner.ok) return owner.response;

  const diary = await ctx.runQuery(internal.journal.getDiaryForOwner, {
    ownerId: owner.ownerId,
  });
  return jsonResponse(diary);
});

export const journalImportOrders = httpAction(async (ctx, request) => {
  if (!authorizedServiceRequest(request)) return jsonResponse({ error: "Unauthorized." }, 401);
  const parsed = await parseBoundedJson(request, importOrdersRequestSchema);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);
  const owner = authorizeOwner(parsed.data.ownerId);
  if (!owner.ok) return owner.response;

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
      ownerId: owner.ownerId,
      orderDays,
      trades,
    });
    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? errorMessage(error) : "Order import failed.";
    return jsonResponse({ error: message }, 400);
  }
});

export const journalUpsertTrade = httpAction(async (ctx, request) => {
  if (!authorizedServiceRequest(request)) return jsonResponse({ error: "Unauthorized." }, 401);
  const parsed = await parseBoundedJson(request, upsertTradeRequestSchema);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);
  const owner = authorizeOwner(parsed.data.ownerId);
  if (!owner.ok) return owner.response;

  try {
    const args: UpsertTradeInternalArgs = {
      ownerId: owner.ownerId,
      trade: parsed.data.trade,
    };
    if (parsed.data.stableId !== undefined) args.stableId = parsed.data.stableId;
    const saved = await ctx.runMutation(internal.journal.upsertTradeInternal, args);
    return jsonResponse(saved);
  } catch (error) {
    const message = error instanceof Error ? errorMessage(error) : "Could not save trade.";
    return jsonResponse({ error: message }, 400);
  }
});

export const journalSaveReview = httpAction(async (ctx, request) => {
  if (!authorizedServiceRequest(request)) return jsonResponse({ error: "Unauthorized." }, 401);
  const parsed = await parseBoundedJson(request, saveReviewRequestSchema);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);
  const owner = authorizeOwner(parsed.data.ownerId);
  if (!owner.ok) return owner.response;

  let storedReview: string | null;
  try {
    storedReview = normalizeAssistantReview(parsed.data.assistantReview).stored;
  } catch (error) {
    const message = error instanceof Error ? errorMessage(error) : "Invalid assistant review.";
    return jsonResponse({ error: message }, 400);
  }

  try {
    const saved = await ctx.runMutation(internal.journal.saveReviewInternal, {
      ownerId: owner.ownerId,
      tradeStableId: parsed.data.tradeStableId,
      assistantReview: storedReview,
    });
    return jsonResponse(saved);
  } catch (error) {
    const message = error instanceof Error ? errorMessage(error) : "Could not save review.";
    const status = message === "Trade not found." ? 404 : 400;
    return jsonResponse({ error: message }, status);
  }
});

export const journalUpsertLesson = httpAction(async (ctx, request) => {
  if (!authorizedServiceRequest(request)) return jsonResponse({ error: "Unauthorized." }, 401);
  const parsed = await parseBoundedJson(request, upsertLessonRequestSchema);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);
  const owner = authorizeOwner(parsed.data.ownerId);
  if (!owner.ok) return owner.response;

  try {
    const args: UpsertLessonInternalArgs = {
      ownerId: owner.ownerId,
      lesson: parsed.data.lesson,
    };
    if (parsed.data.stableId !== undefined) args.stableId = parsed.data.stableId;
    const saved = await ctx.runMutation(internal.journal.upsertLessonInternal, args);
    return jsonResponse(saved);
  } catch (error) {
    const message = error instanceof Error ? errorMessage(error) : "Could not save lesson.";
    return jsonResponse({ error: message }, 400);
  }
});

export const journalUploadChart = httpAction(async (ctx, request) => {
  if (!authorizedServiceRequest(request)) return jsonResponse({ error: "Unauthorized." }, 401);
  const parsed = await parseBoundedJson(
    request,
    uploadChartRequestSchema,
    UPLOAD_CHART_MAX_BODY_BYTES,
  );
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);
  const owner = authorizeOwner(parsed.data.ownerId);
  if (!owner.ok) return owner.response;

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = decodeBase64Image(parsed.data.base64Data, MAX_CHART_IMAGE_BYTES);
  } catch (error) {
    const message = error instanceof Error ? errorMessage(error) : "Invalid chart image payload.";
    const status = message.includes("size") ? 413 : 400;
    return jsonResponse({ error: message }, status);
  }

  const imageKey = await sha256HexBytes(bytes);
  const detected = detectImageDimensions(bytes, parsed.data.mimeType);
  const width = parsed.data.width ?? detected?.width;
  const height = parsed.data.height ?? detected?.height;

  try {
    const existing = await ctx.runQuery(internal.journal.getChartByImageKeyInternal, {
      ownerId: owner.ownerId,
      imageKey,
    });

    const storageId = existing !== null && existing.url !== null
      ? existing.storageId
      : await ctx.storage.store(new Blob([bytes], { type: parsed.data.mimeType }));

    const args: UpsertChartInternalArgs = {
      ownerId: owner.ownerId,
      imageKey,
      storageId,
      mimeType: parsed.data.mimeType,
      source: parsed.data.source ?? "chart_img",
    };
    if (width !== undefined) args.width = width;
    if (height !== undefined) args.height = height;
    if (parsed.data.symbol !== undefined) args.symbol = parsed.data.symbol;
    if (parsed.data.interval !== undefined) args.interval = parsed.data.interval;

    const saved = await ctx.runMutation(internal.journal.upsertChartInternal, args);
    return jsonResponse({
      imageKey: saved.imageKey,
      storageId: saved.storageId,
      url: saved.url,
      width: saved.width ?? null,
      height: saved.height ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? errorMessage(error) : "Could not upload chart.";
    return jsonResponse({ error: message }, 400);
  }
});

export const journalRunProgress = httpAction(async (ctx, request) => {
  if (!authorizedServiceRequest(request)) return jsonResponse({ error: "Unauthorized." }, 401);
  const parsed = await parseBoundedJson(request, runProgressRequestSchema);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, parsed.status);
  const owner = authorizeOwner(parsed.data.ownerId);
  if (!owner.ok) return owner.response;

  const args: RunProgressInternalArgs = {
    ownerId: owner.ownerId,
    runId: parsed.data.runId,
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
  const owner = authorizeOwner(parsed.data.ownerId);
  if (!owner.ok) return owner.response;

  const args: RunCompleteInternalArgs = {
    ownerId: owner.ownerId,
    runId: parsed.data.runId,
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
