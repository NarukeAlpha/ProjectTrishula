import { Type } from "typebox";
import type { ImageContent, TextContent, Tool, ToolCall } from "@earendil-works/pi-ai";
import { z } from "zod";
import {
  ChartProviderError,
  chartCaptureRequestSchema,
  chartFormats,
  chartIntervals,
  chartPresets,
  chartSessions,
  type ChartProvider,
} from "./charts/index.js";
import {
  assistantReviewInputSchema,
  chartReviewSchema,
  isoDateSchema,
  journalAccounts,
  journalAdherenceOptions,
  journalDirections,
  journalInstruments,
  journalLessonInputSchema,
  journalMistakeOptions,
  journalOrderSchema,
  journalOrderSides,
  journalOrderStatuses,
  journalOrderTypes,
  journalStableIdSchema,
  journalStatuses,
  journalTradeInputSchema,
  MAX_JOURNAL_PLAIN_REVIEW_LENGTH,
  type JournalAssistantReviewInput,
  type JournalSettings,
} from "./contracts.js";
import {
  JournalConvexError,
  JournalRunInactiveError,
  type JournalConvexClient,
  type JournalImportOrderDayInput,
  type JournalImportTradeInput,
  type JournalRunCredentials,
  type JournalUpsertLessonInput,
  type JournalUpsertTradeInput,
} from "./convex-client.js";

const importOrderDaySchema = z.object({
  stableId: journalStableIdSchema.optional(),
  date: isoDateSchema,
  note: z.string().trim().max(6_000),
  orders: z.array(journalOrderSchema).min(1).max(120),
}).strict();

const importTradeEntrySchema = z.object({
  stableId: journalStableIdSchema.optional(),
  trade: journalTradeInputSchema,
  assistantReview: assistantReviewInputSchema.optional(),
}).strict();

const importOrdersToolArgsSchema = z.object({
  orderDays: z.array(importOrderDaySchema).max(100),
  trades: z.array(importTradeEntrySchema).max(200),
}).strict();

const upsertTradeToolArgsSchema = z.object({
  stableId: journalStableIdSchema.optional(),
  trade: journalTradeInputSchema,
}).strict();

const captureChartToolArgsSchema = z.object({
  symbol: z.string().trim().min(1).max(32),
  interval: z.enum(chartIntervals),
  from: z.string().trim().min(1).max(64).optional(),
  to: z.string().trim().min(1).max(64).optional(),
  session: z.enum(chartSessions).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  width: z.number().int().min(320).max(2_400).optional(),
  height: z.number().int().min(240).max(1_600).optional(),
  format: z.enum(chartFormats).optional(),
  preset: z.enum(chartPresets).optional(),
  includeVolumeProfile: z.boolean().optional(),
  useSavedLayout: z.boolean().optional(),
}).strict();

const saveReviewToolArgsSchema = z.object({
  tradeStableId: journalStableIdSchema,
  assistantReview: assistantReviewInputSchema,
}).strict();

const upsertLessonToolArgsSchema = z.object({
  stableId: journalStableIdSchema.optional(),
  lesson: journalLessonInputSchema,
}).strict();

const orderBox = Type.Object({
  contract: Type.String({ minLength: 1, maxLength: 150 }),
  submittedAt: Type.String({ description: "Broker time HH:MM:SS (24-hour)." }),
  status: Type.Union(journalOrderStatuses.map((value) => Type.Literal(value))),
  side: Type.Union(journalOrderSides.map((value) => Type.Literal(value))),
  type: Type.Union(journalOrderTypes.map((value) => Type.Literal(value))),
  quantity: Type.Integer({ minimum: 1 }),
  averageFillCents: Type.Union([Type.Integer(), Type.Null()]),
  realizedPnlCents: Type.Union([Type.Integer(), Type.Null()]),
  cashCents: Type.Integer(),
  limitCents: Type.Union([Type.Integer(), Type.Null()]),
}, { additionalProperties: false });

const tradeBox = Type.Object({
  symbol: Type.String({ minLength: 1, maxLength: 24 }),
  instrument: Type.Union(journalInstruments.map((value) => Type.Literal(value))),
  account: Type.Union(journalAccounts.map((value) => Type.Literal(value))),
  direction: Type.Union(journalDirections.map((value) => Type.Literal(value))),
  status: Type.Union(journalStatuses.map((value) => Type.Literal(value))),
  openedOn: Type.String({ description: "YYYY-MM-DD or empty string when unknown on closed trades." }),
  closedOn: Type.Union([Type.String(), Type.Null()]),
  setup: Type.String({ maxLength: 80 }),
  size: Type.String({ maxLength: 48 }),
  details: Type.String({ maxLength: 6_000 }),
  plannedRiskCents: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  realizedPnlCents: Type.Union([Type.Integer(), Type.Null()]),
  thesis: Type.String({ maxLength: 6_000 }),
  plan: Type.String({ maxLength: 6_000 }),
  review: Type.String({ maxLength: 6_000 }),
  adherence: Type.Union(journalAdherenceOptions.map((value) => Type.Literal(value))),
  mistakes: Type.Array(Type.Union(journalMistakeOptions.map((value) => Type.Literal(value)))),
}, { additionalProperties: false });

const rectangleBox = Type.Object({
  x: Type.Integer({ minimum: 0, maximum: 16_000 }),
  y: Type.Integer({ minimum: 0, maximum: 16_000 }),
  width: Type.Integer({ minimum: 1, maximum: 16_000 }),
  height: Type.Integer({ minimum: 1, maximum: 16_000 }),
}, { additionalProperties: false });

const reviewChartBox = Type.Object({
  image: Type.String({ description: "64-character lowercase hex SHA-256 imageKey." }),
  width: Type.Integer({ minimum: 1, maximum: 16_000 }),
  height: Type.Integer({ minimum: 1, maximum: 16_000 }),
  crop: rectangleBox,
  focus: rectangleBox,
  focusLabel: Type.String({ minLength: 1, maxLength: 100 }),
  levels: Type.Array(
    Type.Object({
      y: Type.Integer({ minimum: 0, maximum: 16_000 }),
      label: Type.String({ minLength: 1, maxLength: 14 }),
    }, { additionalProperties: false }),
    { maxItems: 3 },
  ),
  ticks: Type.Array(
    Type.Object({
      x: Type.Integer({ minimum: 0, maximum: 16_000 }),
      label: Type.String({ minLength: 1, maxLength: 12 }),
    }, { additionalProperties: false }),
    { minItems: 1, maxItems: 5 },
  ),
  interval: Type.String({ minLength: 1, maxLength: 100 }),
  heading: Type.String({ minLength: 1, maxLength: 100 }),
  text: Type.String({ minLength: 1, maxLength: 750 }),
  alt: Type.String({ minLength: 1, maxLength: 750 }),
}, { additionalProperties: false });

const chartReviewBox = Type.Object({
  version: Type.Literal(1),
  instrument: Type.String({ minLength: 1, maxLength: 100 }),
  timeZone: Type.String({ minLength: 1, maxLength: 12 }),
  timing: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  summary: Type.String({ minLength: 1, maxLength: 750 }),
  charts: Type.Array(reviewChartBox, { minItems: 1, maxItems: 8 }),
  nextTime: Type.String({ minLength: 1, maxLength: 750 }),
  note: Type.Optional(Type.String({ minLength: 1, maxLength: 750 })),
}, { additionalProperties: false });

const assistantReviewBox = Type.Union([
  chartReviewBox,
  Type.String({ maxLength: MAX_JOURNAL_PLAIN_REVIEW_LENGTH }),
  Type.Null(),
]);

export const journalTools: Tool[] = [
  {
    name: "get_diary",
    description:
      "Read the user's trading journal: settings (brokerTimeZone, tradingViewLayoutId), trades, lessons, orderDays, and uploaded chart metadata.",
    parameters: Type.Object({}, { additionalProperties: false }),
  },
  {
    name: "import_orders",
    description:
      "Atomically save transcribed broker order batches and grouped trade records into the user's journal.",
    parameters: Type.Object({
      orderDays: Type.Array(
        Type.Object({
          stableId: Type.Optional(Type.String()),
          date: Type.String({ description: "YYYY-MM-DD" }),
          note: Type.String({ maxLength: 6_000 }),
          orders: Type.Array(orderBox, { minItems: 1, maxItems: 120 }),
        }, { additionalProperties: false }),
        { maxItems: 100 },
      ),
      trades: Type.Array(
        Type.Object({
          stableId: Type.Optional(Type.String()),
          trade: tradeBox,
          assistantReview: Type.Optional(assistantReviewBox),
        }, { additionalProperties: false }),
        { maxItems: 200 },
      ),
    }, { additionalProperties: false }),
  },
  {
    name: "upsert_trade",
    description:
      "Create a new trade (omit stableId) or update an existing trade (pass stableId).",
    parameters: Type.Object({
      stableId: Type.Optional(Type.String()),
      trade: tradeBox,
    }, { additionalProperties: false }),
  },
  {
    name: "capture_chart",
    description:
      "Capture a TradingView chart snapshot via CHART-IMG, upload it to the user's journal storage, and return both its metadata (imageKey, width, height) and the rendered chart image for visual inspection.",
    parameters: Type.Object({
      symbol: Type.String({
        description: "TradingView symbol, preferably with exchange prefix (e.g. NASDAQ:QQQ, AMEX:SPY, SP:SPX, NASDAQ:NVDA).",
      }),
      interval: Type.Union(chartIntervals.map((value) => Type.Literal(value))),
      from: Type.Optional(Type.String({ description: "UTC ISO-8601 start timestamp (e.g. 2026-04-15T13:30:00Z)." })),
      to: Type.Optional(Type.String({ description: "UTC ISO-8601 end timestamp (e.g. 2026-04-15T20:00:00Z)." })),
      session: Type.Optional(Type.Union(chartSessions.map((value) => Type.Literal(value)))),
      timezone: Type.Optional(Type.String({ description: "Display timezone; defaults to America/New_York." })),
      width: Type.Optional(Type.Integer({ minimum: 320, maximum: 2_400 })),
      height: Type.Optional(Type.Integer({ minimum: 240, maximum: 1_600 })),
      format: Type.Optional(Type.Union(chartFormats.map((value) => Type.Literal(value)))),
      preset: Type.Optional(Type.Union(chartPresets.map((value) => Type.Literal(value)))),
      includeVolumeProfile: Type.Optional(Type.Boolean()),
      useSavedLayout: Type.Optional(Type.Boolean({
        description: "Set true only when the user explicitly requests their saved TradingView layout.",
      })),
    }, { additionalProperties: false }),
  },
  {
    name: "save_review",
    description:
      "Validate and save a structured chart review (version 1) or plain-text review onto an existing trade.",
    parameters: Type.Object({
      tradeStableId: Type.String(),
      assistantReview: assistantReviewBox,
    }, { additionalProperties: false }),
  },
  {
    name: "upsert_lesson",
    description:
      "Create a new lesson (omit stableId) or update an existing lesson (pass stableId), optionally linked to a tradeStableId.",
    parameters: Type.Object({
      stableId: Type.Optional(Type.String()),
      lesson: Type.Object({
        title: Type.String({ minLength: 1, maxLength: 120 }),
        body: Type.String({ minLength: 1, maxLength: 6_000 }),
        tradeStableId: Type.Union([Type.String(), Type.Null()]),
      }, { additionalProperties: false }),
    }, { additionalProperties: false }),
  },
];

interface CompactChartMetadata {
  imageKey: string;
  mimeType: string;
  source: string;
  width?: number;
  height?: number;
  symbol?: string;
  interval?: string;
}

export interface JournalToolExecutionContext {
  credentials: JournalRunCredentials;
  settings: JournalSettings;
  convex: JournalConvexClient;
  chartProvider: ChartProvider;
  signal: AbortSignal;
}

export interface JournalToolExecutionResult {
  content: (TextContent | ImageContent)[];
  isError: boolean;
  completedSummary: string;
}

function textResult(
  payload: string,
  completedSummary: string,
  isError = false,
): JournalToolExecutionResult {
  return {
    content: [{ type: "text", text: payload }],
    isError,
    completedSummary,
  };
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}

function validateAssistantReviewForTool(
  input: JournalAssistantReviewInput,
): { ok: true; value: JournalAssistantReviewInput } | { ok: false; error: string } {
  if (input === null) return { ok: true, value: null };
  const stringCheck = z.string().safeParse(input);
  if (stringCheck.success) {
    const trimmed = stringCheck.data.trim();
    if (trimmed.length === 0) return { ok: true, value: null };
    if (trimmed.startsWith("{")) {
      let decoded: z.infer<ReturnType<typeof z.json>>;
      try {
        decoded = z.json().parse(JSON.parse(trimmed));
      } catch {
        return { ok: false, error: "Structured chart review string must be valid JSON." };
      }
      const parsed = chartReviewSchema.safeParse(decoded);
      if (!parsed.success) {
        return { ok: false, error: `Invalid structured chart review: ${formatZodIssues(parsed.error)}` };
      }
      return { ok: true, value: parsed.data };
    }
    if (trimmed.length > MAX_JOURNAL_PLAIN_REVIEW_LENGTH) {
      return {
        ok: false,
        error: `Plain review must be at most ${MAX_JOURNAL_PLAIN_REVIEW_LENGTH} characters.`,
      };
    }
    return { ok: true, value: trimmed };
  }
  const parsed = chartReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: `Invalid structured chart review: ${formatZodIssues(parsed.error)}` };
  }
  return { ok: true, value: parsed.data };
}

export function describeToolStart(toolCall: ToolCall): string {
  const args = toolCall.arguments;
  switch (toolCall.name) {
    case "get_diary":
      return "Reading trading diary…";
    case "import_orders":
      return "Importing orders and trades…";
    case "upsert_trade": {
      const parsed = z.object({ trade: z.object({ symbol: z.string() }) }).safeParse(args);
      const symbol = parsed.success ? parsed.data.trade.symbol.trim().toUpperCase() : "";
      return symbol ? `Saving ${symbol} trade…` : "Saving trade…";
    }
    case "capture_chart": {
      const parsed = z.object({ symbol: z.string(), interval: z.string() }).safeParse(args);
      if (parsed.success) {
        return `Capturing ${parsed.data.symbol.trim().toUpperCase()} ${parsed.data.interval} chart…`;
      }
      return "Capturing chart…";
    }
    case "save_review":
      return "Saving trade review…";
    case "upsert_lesson": {
      const parsed = z.object({ lesson: z.object({ title: z.string() }) }).safeParse(args);
      const title = parsed.success ? parsed.data.lesson.title.trim() : "";
      return title ? `Saving lesson: ${title.slice(0, 60)}…` : "Saving lesson…";
    }
    default:
      return `Running ${toolCall.name}…`;
  }
}

export async function executeJournalTool(
  toolCall: ToolCall,
  context: JournalToolExecutionContext,
): Promise<JournalToolExecutionResult> {
  try {
    switch (toolCall.name) {
      case "get_diary": {
        const diary = await context.convex.getDiary(context.credentials, context.signal);
        const compactCharts = diary.charts.map((chart) => {
          const entry: CompactChartMetadata = {
            imageKey: chart.imageKey,
            mimeType: chart.mimeType,
            source: chart.source,
          };
          if (chart.width !== undefined) entry.width = chart.width;
          if (chart.height !== undefined) entry.height = chart.height;
          if (chart.symbol !== undefined) entry.symbol = chart.symbol;
          if (chart.interval !== undefined) entry.interval = chart.interval;
          return entry;
        });
        return textResult(
          JSON.stringify({
            settings: diary.settings,
            trades: diary.trades,
            lessons: diary.lessons,
            orderDays: diary.orderDays,
            charts: compactCharts,
          }),
          `Loaded diary (${diary.trades.length} trades, ${diary.lessons.length} lessons)`,
        );
      }

      case "import_orders": {
        const parsed = importOrdersToolArgsSchema.safeParse(toolCall.arguments);
        if (!parsed.success) {
          return textResult(
            `Invalid import_orders arguments: ${formatZodIssues(parsed.error)}`,
            "Order import validation failed",
            true,
          );
        }
        const orderDays: JournalImportOrderDayInput[] = parsed.data.orderDays.map((day) => {
          const item: JournalImportOrderDayInput = {
            date: day.date,
            note: day.note,
            orders: day.orders,
          };
          if (day.stableId !== undefined) item.stableId = day.stableId;
          return item;
        });
        const trades: JournalImportTradeInput[] = [];
        for (const entry of parsed.data.trades) {
          const item: JournalImportTradeInput = { trade: entry.trade };
          if (entry.stableId !== undefined) item.stableId = entry.stableId;
          if (entry.assistantReview !== undefined) {
            const validatedReview = validateAssistantReviewForTool(entry.assistantReview);
            if (!validatedReview.ok) {
              return textResult(validatedReview.error, "Order import review validation failed", true);
            }
            item.assistantReview = validatedReview.value;
          }
          trades.push(item);
        }
        const saved = await context.convex.importOrders(
          context.credentials,
          { orderDays, trades },
          context.signal,
        );
        return textResult(
          JSON.stringify(saved),
          `Imported ${saved.orderDays.length} order day(s) and ${saved.trades.length} trade(s)`,
        );
      }

      case "upsert_trade": {
        const parsed = upsertTradeToolArgsSchema.safeParse(toolCall.arguments);
        if (!parsed.success) {
          return textResult(
            `Invalid upsert_trade arguments: ${formatZodIssues(parsed.error)}`,
            "Trade validation failed",
            true,
          );
        }
        const payload: JournalUpsertTradeInput = {
          trade: parsed.data.trade,
        };
        if (parsed.data.stableId !== undefined) payload.stableId = parsed.data.stableId;
        const saved = await context.convex.upsertTrade(
          context.credentials,
          payload,
          context.signal,
        );
        return textResult(
          JSON.stringify(saved),
          `Saved ${saved.symbol} trade`,
        );
      }

      case "capture_chart": {
        const parsed = captureChartToolArgsSchema.safeParse(toolCall.arguments);
        if (!parsed.success) {
          return textResult(
            `Invalid capture_chart arguments: ${formatZodIssues(parsed.error)}`,
            "Chart request validation failed",
            true,
          );
        }
        const args = parsed.data;
        const captureRequest: z.infer<typeof chartCaptureRequestSchema> = {
          symbol: args.symbol,
          interval: args.interval,
        };
        if (args.from !== undefined) captureRequest.from = args.from;
        if (args.to !== undefined) captureRequest.to = args.to;
        if (args.session !== undefined) captureRequest.session = args.session;
        if (args.timezone !== undefined) captureRequest.timezone = args.timezone;
        if (args.width !== undefined) captureRequest.width = args.width;
        if (args.height !== undefined) captureRequest.height = args.height;
        if (args.format !== undefined) captureRequest.format = args.format;
        if (args.preset !== undefined) captureRequest.preset = args.preset;
        if (args.includeVolumeProfile !== undefined) {
          captureRequest.includeVolumeProfile = args.includeVolumeProfile;
        }
        if (args.useSavedLayout) {
          if (!context.settings.tradingViewLayoutId) {
            return textResult(
              "No tradingViewLayoutId is configured in journal settings. Retry capture_chart without useSavedLayout.",
              "Saved TradingView layout not configured",
              true,
            );
          }
          captureRequest.useSavedLayout = true;
          captureRequest.layoutId = context.settings.tradingViewLayoutId;
        }

        const captured = await context.chartProvider.captureChart(
          captureRequest,
          context.signal,
        );
        const base64Data = Buffer.from(captured.bytes).toString("base64");
        const uploaded = await context.convex.uploadChart(
          context.credentials,
          {
            base64Data,
            mimeType: captured.mimeType,
            width: captured.width,
            height: captured.height,
            symbol: captured.symbol,
            interval: captured.interval,
            source: captured.source,
          },
          context.signal,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                imageKey: uploaded.imageKey,
                mimeType: uploaded.mimeType,
                width: uploaded.width,
                height: uploaded.height,
                symbol: captured.symbol,
                interval: captured.interval,
                source: captured.source,
              }),
            },
            {
              type: "image",
              data: base64Data,
              mimeType: captured.mimeType,
            },
          ],
          isError: false,
          completedSummary: `Captured ${captured.symbol} ${captured.interval} chart (${uploaded.width}x${uploaded.height})`,
        };
      }

      case "save_review": {
        const parsed = saveReviewToolArgsSchema.safeParse(toolCall.arguments);
        if (!parsed.success) {
          return textResult(
            `Invalid save_review arguments: ${formatZodIssues(parsed.error)}`,
            "Review validation failed",
            true,
          );
        }
        const validatedReview = validateAssistantReviewForTool(parsed.data.assistantReview);
        if (!validatedReview.ok) {
          return textResult(validatedReview.error, "Review validation failed", true);
        }
        const saved = await context.convex.saveReview(
          context.credentials,
          {
            tradeStableId: parsed.data.tradeStableId,
            assistantReview: validatedReview.value,
          },
          context.signal,
        );
        return textResult(
          JSON.stringify({
            tradeStableId: saved.stableId,
            symbol: saved.symbol,
            updatedAt: saved.updatedAt,
            hasAssistantReview: saved.assistantReview !== null,
          }),
          `Saved ${saved.symbol} review`,
        );
      }

      case "upsert_lesson": {
        const parsed = upsertLessonToolArgsSchema.safeParse(toolCall.arguments);
        if (!parsed.success) {
          return textResult(
            `Invalid upsert_lesson arguments: ${formatZodIssues(parsed.error)}`,
            "Lesson validation failed",
            true,
          );
        }
        const payload: JournalUpsertLessonInput = {
          lesson: parsed.data.lesson,
        };
        if (parsed.data.stableId !== undefined) payload.stableId = parsed.data.stableId;
        const saved = await context.convex.upsertLesson(
          context.credentials,
          payload,
          context.signal,
        );
        return textResult(
          JSON.stringify(saved),
          `Saved lesson: ${saved.title}`,
        );
      }

      default:
        return textResult(
          `Unknown tool '${toolCall.name}'.`,
          `Unknown tool ${toolCall.name}`,
          true,
        );
    }
  } catch (error) {
    if (error instanceof JournalRunInactiveError) {
      throw error;
    }
    if (context.signal.aborted) {
      throw context.signal.reason instanceof Error
        ? context.signal.reason
        : new Error("journal_run_aborted");
    }
    if (error instanceof ChartProviderError) {
      return textResult(
        `Chart capture error (${error.code}): ${error.message}`,
        `Chart capture failed (${error.code})`,
        true,
      );
    }
    if (error instanceof JournalConvexError) {
      return textResult(
        `Journal storage error: ${error.message}`,
        `${toolCall.name} failed`,
        true,
      );
    }
    const message = error instanceof Error ? error.message : "Tool execution failed.";
    return textResult(`Tool error: ${message}`, `${toolCall.name} failed`, true);
  }
}
