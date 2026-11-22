import { z } from "zod";
import type { Logger } from "../runtime/logger.js";
import {
  createTimeoutAbortSignal,
  journalAccounts,
  journalAdherenceOptions,
  journalChartMimeTypes,
  journalChartSources,
  journalDirections,
  journalInstruments,
  journalMistakeOptions,
  journalOrderSchema,
  journalSettingsSchema,
  journalStatuses,
  readBoundedBytes,
  type JournalAssistantReviewInput,
  type JournalChartMimeType,
  type JournalChartSource,
  type JournalLessonInput,
  type JournalOrder,
  type JournalSettings,
  type JournalTerminalChatStatus,
  type JournalToolEvent,
  type JournalTradeInput,
} from "./contracts.js";

const DEFAULT_UPLOAD_TIMEOUT_MS = 30_000;
const MAX_JSON_RESPONSE_BYTES = 4 * 1024 * 1024;

export interface JournalRunCredentials {
  ownerId: string;
  runId: string;
  runToken: string;
}

export const journalTradeDtoSchema = z.object({
  stableId: z.string(),
  symbol: z.string(),
  instrument: z.enum(journalInstruments),
  account: z.enum(journalAccounts),
  direction: z.enum(journalDirections),
  status: z.enum(journalStatuses),
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
  adherence: z.enum(journalAdherenceOptions),
  mistakes: z.array(z.enum(journalMistakeOptions)),
  assistantReview: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type JournalTradeDto = z.infer<typeof journalTradeDtoSchema>;

export const journalLessonDtoSchema = z.object({
  stableId: z.string(),
  title: z.string(),
  body: z.string(),
  tradeStableId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type JournalLessonDto = z.infer<typeof journalLessonDtoSchema>;

export const journalOrderBatchDtoSchema = z.object({
  stableId: z.string(),
  date: z.string(),
  note: z.string(),
  orders: z.array(journalOrderSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type JournalOrderBatchDto = z.infer<typeof journalOrderBatchDtoSchema>;

export const journalChartDtoSchema = z.object({
  imageKey: z.string(),
  storageId: z.string(),
  mimeType: z.enum(journalChartMimeTypes),
  width: z.number().optional(),
  height: z.number().optional(),
  symbol: z.string().optional(),
  interval: z.string().optional(),
  source: z.enum(journalChartSources),
  url: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type JournalChartDto = z.infer<typeof journalChartDtoSchema>;

export const journalDiaryResponseSchema = z.object({
  settings: journalSettingsSchema,
  trades: z.array(journalTradeDtoSchema),
  lessons: z.array(journalLessonDtoSchema),
  orderDays: z.array(journalOrderBatchDtoSchema),
  charts: z.array(journalChartDtoSchema),
});

export type JournalDiaryResponse = z.infer<typeof journalDiaryResponseSchema>;

export const journalImportOrdersResponseSchema = z.object({
  orderDays: z.array(journalOrderBatchDtoSchema),
  trades: z.array(journalTradeDtoSchema),
});

export type JournalImportOrdersResponse = z.infer<typeof journalImportOrdersResponseSchema>;

export const journalUploadChartResponseSchema = z.object({
  imageKey: z.string(),
  storageId: z.string(),
  mimeType: z.enum(journalChartMimeTypes),
  url: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type JournalUploadChartResponse = z.infer<typeof journalUploadChartResponseSchema>;

export const journalProgressResponseSchema = z.object({
  accepted: z.boolean(),
  status: z.string().optional(),
  reason: z.string().optional(),
});

export type JournalProgressResponse = z.infer<typeof journalProgressResponseSchema>;

export const journalCompleteResponseSchema = z.object({
  accepted: z.boolean(),
  status: z.string().optional(),
  reason: z.string().optional(),
});

export type JournalCompleteResponse = z.infer<typeof journalCompleteResponseSchema>;

export interface JournalImportOrderDayInput {
  stableId?: string;
  date: string;
  note: string;
  orders: JournalOrder[];
}

export interface JournalImportTradeInput {
  stableId?: string;
  trade: JournalTradeInput;
  assistantReview?: JournalAssistantReviewInput;
}

export interface JournalImportOrdersInput {
  orderDays: JournalImportOrderDayInput[];
  trades: JournalImportTradeInput[];
}

export interface JournalUpsertTradeInput {
  stableId?: string;
  trade: JournalTradeInput;
}

export interface JournalSaveReviewInput {
  tradeStableId: string;
  assistantReview: JournalAssistantReviewInput;
}

export interface JournalUpsertLessonInput {
  stableId?: string;
  lesson: JournalLessonInput;
}

export interface JournalUploadChartInput {
  base64Data: string;
  mimeType: JournalChartMimeType;
  width: number;
  height: number;
  symbol?: string;
  interval?: string;
  source: JournalChartSource;
}

export interface JournalRunProgressInput {
  text?: string;
  toolEvents?: JournalToolEvent[];
}

export interface JournalRunCompleteInput {
  status: JournalTerminalChatStatus;
  text: string;
  toolEvents?: JournalToolEvent[];
  error?: string;
}

const errorPayloadSchema = z.object({
  error: z.string().optional(),
  reason: z.string().optional(),
  status: z.string().optional(),
});

export class JournalRunInactiveError extends Error {
  constructor(
    readonly reason: string,
    readonly httpStatus: number,
  ) {
    super(`Journal run is no longer active (${reason}).`);
    this.name = "JournalRunInactiveError";
  }
}

export class JournalConvexError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "JournalConvexError";
  }
}

export interface JournalConvexClient {
  getDiary(
    credentials: JournalRunCredentials,
    signal?: AbortSignal,
  ): Promise<JournalDiaryResponse>;
  importOrders(
    credentials: JournalRunCredentials,
    input: JournalImportOrdersInput,
    signal?: AbortSignal,
  ): Promise<JournalImportOrdersResponse>;
  upsertTrade(
    credentials: JournalRunCredentials,
    input: JournalUpsertTradeInput,
    signal?: AbortSignal,
  ): Promise<JournalTradeDto>;
  saveReview(
    credentials: JournalRunCredentials,
    input: JournalSaveReviewInput,
    signal?: AbortSignal,
  ): Promise<JournalTradeDto>;
  upsertLesson(
    credentials: JournalRunCredentials,
    input: JournalUpsertLessonInput,
    signal?: AbortSignal,
  ): Promise<JournalLessonDto>;
  uploadChart(
    credentials: JournalRunCredentials,
    input: JournalUploadChartInput,
    signal?: AbortSignal,
  ): Promise<JournalUploadChartResponse>;
  reportProgress(
    credentials: JournalRunCredentials,
    input: JournalRunProgressInput,
    signal?: AbortSignal,
  ): Promise<JournalProgressResponse>;
  completeRun(
    credentials: JournalRunCredentials,
    input: JournalRunCompleteInput,
  ): Promise<JournalCompleteResponse>;
}

export interface ConvexJournalClientOptions {
  siteUrl: string;
  sharedSecret: string;
  timeoutMs: number;
  uploadTimeoutMs?: number;
  logger: Logger;
  fetch?: typeof fetch;
}

interface GetDiaryWireRequest {
  ownerId: string;
  runId: string;
}

interface ImportOrdersWireRequest {
  ownerId: string;
  runId: string;
  orderDays: JournalImportOrderDayInput[];
  trades: JournalImportTradeInput[];
}

interface UpsertTradeWireRequest {
  ownerId: string;
  runId: string;
  stableId?: string;
  trade: JournalTradeInput;
}

interface SaveReviewWireRequest {
  ownerId: string;
  runId: string;
  tradeStableId: string;
  assistantReview: JournalAssistantReviewInput;
}

interface UpsertLessonWireRequest {
  ownerId: string;
  runId: string;
  stableId?: string;
  lesson: JournalLessonInput;
}

interface UploadChartWireRequest {
  ownerId: string;
  runId: string;
  base64Data: string;
  mimeType: JournalChartMimeType;
  width: number;
  height: number;
  symbol?: string;
  interval?: string;
  source: JournalChartSource;
}

interface RunProgressWireRequest {
  ownerId: string;
  runId: string;
  text?: string;
  toolEvents?: JournalToolEvent[];
}

interface RunCompleteWireRequest {
  ownerId: string;
  runId: string;
  status: JournalTerminalChatStatus;
  text: string;
  toolEvents?: JournalToolEvent[];
  error?: string;
}

type ConvexJournalWireRequest =
  | GetDiaryWireRequest
  | ImportOrdersWireRequest
  | UpsertTradeWireRequest
  | SaveReviewWireRequest
  | UpsertLessonWireRequest
  | UploadChartWireRequest
  | RunProgressWireRequest
  | RunCompleteWireRequest;

async function readBoundedJson(
  response: Response,
  signal?: AbortSignal,
): Promise<z.infer<ReturnType<typeof z.json>> | null> {
  const read = await readBoundedBytes(response, MAX_JSON_RESPONSE_BYTES, signal);
  if (!read.ok) return null;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(read.bytes);
    return z.json().parse(JSON.parse(decoded));
  } catch {
    return null;
  }
}

export class ConvexJournalClient implements JournalConvexClient {
  private readonly baseUrl: string;
  private readonly sharedSecret: string;
  private readonly timeoutMs: number;
  private readonly uploadTimeoutMs: number;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ConvexJournalClientOptions) {
    this.baseUrl = options.siteUrl.replace(/\/+$/, "");
    this.sharedSecret = options.sharedSecret;
    this.timeoutMs = options.timeoutMs;
    this.uploadTimeoutMs = options.uploadTimeoutMs ?? Math.max(options.timeoutMs, DEFAULT_UPLOAD_TIMEOUT_MS);
    this.logger = options.logger;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async getDiary(
    credentials: JournalRunCredentials,
    signal?: AbortSignal,
  ): Promise<JournalDiaryResponse> {
    return this.postJson(
      "/internal/journal/tools/get-diary",
      credentials,
      {
        ownerId: credentials.ownerId,
        runId: credentials.runId,
      },
      journalDiaryResponseSchema,
      { signal },
    );
  }

  async importOrders(
    credentials: JournalRunCredentials,
    input: JournalImportOrdersInput,
    signal?: AbortSignal,
  ): Promise<JournalImportOrdersResponse> {
    return this.postJson(
      "/internal/journal/tools/import-orders",
      credentials,
      {
        ownerId: credentials.ownerId,
        runId: credentials.runId,
        orderDays: input.orderDays,
        trades: input.trades,
      },
      journalImportOrdersResponseSchema,
      { signal },
    );
  }

  async upsertTrade(
    credentials: JournalRunCredentials,
    input: JournalUpsertTradeInput,
    signal?: AbortSignal,
  ): Promise<JournalTradeDto> {
    const body: UpsertTradeWireRequest = {
      ownerId: credentials.ownerId,
      runId: credentials.runId,
      trade: input.trade,
    };
    if (input.stableId !== undefined) body.stableId = input.stableId;
    return this.postJson(
      "/internal/journal/tools/upsert-trade",
      credentials,
      body,
      journalTradeDtoSchema,
      { signal },
    );
  }

  async saveReview(
    credentials: JournalRunCredentials,
    input: JournalSaveReviewInput,
    signal?: AbortSignal,
  ): Promise<JournalTradeDto> {
    return this.postJson(
      "/internal/journal/tools/save-review",
      credentials,
      {
        ownerId: credentials.ownerId,
        runId: credentials.runId,
        tradeStableId: input.tradeStableId,
        assistantReview: input.assistantReview,
      },
      journalTradeDtoSchema,
      { signal },
    );
  }

  async upsertLesson(
    credentials: JournalRunCredentials,
    input: JournalUpsertLessonInput,
    signal?: AbortSignal,
  ): Promise<JournalLessonDto> {
    const body: UpsertLessonWireRequest = {
      ownerId: credentials.ownerId,
      runId: credentials.runId,
      lesson: input.lesson,
    };
    if (input.stableId !== undefined) body.stableId = input.stableId;
    return this.postJson(
      "/internal/journal/tools/upsert-lesson",
      credentials,
      body,
      journalLessonDtoSchema,
      { signal },
    );
  }

  async uploadChart(
    credentials: JournalRunCredentials,
    input: JournalUploadChartInput,
    signal?: AbortSignal,
  ): Promise<JournalUploadChartResponse> {
    const body: UploadChartWireRequest = {
      ownerId: credentials.ownerId,
      runId: credentials.runId,
      base64Data: input.base64Data,
      mimeType: input.mimeType,
      width: input.width,
      height: input.height,
      source: input.source,
    };
    if (input.symbol !== undefined) body.symbol = input.symbol;
    if (input.interval !== undefined) body.interval = input.interval;
    return this.postJson(
      "/internal/journal/tools/upload-chart",
      credentials,
      body,
      journalUploadChartResponseSchema,
      { signal, timeoutMs: this.uploadTimeoutMs },
    );
  }

  async reportProgress(
    credentials: JournalRunCredentials,
    input: JournalRunProgressInput,
    signal?: AbortSignal,
  ): Promise<JournalProgressResponse> {
    const body: RunProgressWireRequest = {
      ownerId: credentials.ownerId,
      runId: credentials.runId,
    };
    if (input.text !== undefined) body.text = input.text;
    if (input.toolEvents !== undefined) body.toolEvents = input.toolEvents;
    return this.postJson(
      "/internal/journal/runs/progress",
      credentials,
      body,
      journalProgressResponseSchema,
      { signal },
    );
  }

  async completeRun(
    credentials: JournalRunCredentials,
    input: JournalRunCompleteInput,
  ): Promise<JournalCompleteResponse> {
    const body: RunCompleteWireRequest = {
      ownerId: credentials.ownerId,
      runId: credentials.runId,
      status: input.status,
      text: input.text,
    };
    if (input.toolEvents !== undefined) body.toolEvents = input.toolEvents;
    if (input.error !== undefined) body.error = input.error;
    return this.postJson(
      "/internal/journal/runs/complete",
      credentials,
      body,
      journalCompleteResponseSchema,
      { treatConflictAsResponse: true },
    );
  }

  private async postJson<TResult>(
    path: string,
    credentials: JournalRunCredentials,
    body: ConvexJournalWireRequest,
    responseSchema: z.ZodType<TResult>,
    options: {
      signal?: AbortSignal | undefined;
      timeoutMs?: number;
      treatConflictAsResponse?: boolean;
    } = {},
  ): Promise<TResult> {
    options.signal?.throwIfAborted();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const combined = createTimeoutAbortSignal(timeoutMs, "convex_request_timeout", options.signal);
    const url = `${this.baseUrl}${path}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.sharedSecret}`,
          "x-journal-run-token": credentials.runToken,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: combined.signal,
      });
    } catch (error) {
      combined.cleanup();
      if (options.signal?.aborted) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new Error("journal_run_aborted");
      }
      const message = error instanceof Error ? error.message : "Convex journal request failed.";
      this.logger.error("journal_convex_request_failed", {
        path,
        runId: credentials.runId,
        error: message.slice(0, 200),
      });
      throw new JournalConvexError(message);
    }

    let jsonBody: z.infer<ReturnType<typeof z.json>> | null = null;
    try {
      jsonBody = await readBoundedJson(response, combined.signal);
    } finally {
      combined.cleanup();
    }

    if (response.status === 409) {
      if (options.treatConflictAsResponse) {
        const parsedConflict = responseSchema.safeParse(jsonBody);
        if (parsedConflict.success) return parsedConflict.data;
      }
      const errorPayload = errorPayloadSchema.safeParse(jsonBody);
      const reason = errorPayload.success
        ? (errorPayload.data.reason ?? errorPayload.data.error ?? "run_not_active")
        : "run_not_active";
      throw new JournalRunInactiveError(reason, 409);
    }

    if (!response.ok) {
      const errorPayload = errorPayloadSchema.safeParse(jsonBody);
      const reason = errorPayload.success
        ? (errorPayload.data.reason ?? errorPayload.data.error)
        : undefined;
      if (reason === "run_not_found" || reason === "run_not_active") {
        throw new JournalRunInactiveError(reason, response.status);
      }
      throw new JournalConvexError(
        reason ?? `Convex journal endpoint ${path} failed with HTTP ${response.status}.`,
        response.status,
      );
    }

    const parsed = responseSchema.safeParse(jsonBody);
    if (!parsed.success) {
      throw new JournalConvexError(
        `Convex journal endpoint ${path} returned an invalid response payload.`,
        response.status,
      );
    }
    return parsed.data;
  }
}

export type { JournalSettings };
