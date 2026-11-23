import { v } from "convex/values";
import { z } from "zod";

export const instruments = ["Shares", "Options", "Futures", "Other"] as const;
export const accounts = ["Live", "Paper", "Unspecified"] as const;
export const directions = ["Long", "Short", "Multi-leg"] as const;
export const tradeDirections = ["", ...directions] as const;
export const statuses = ["Open", "Closed"] as const;
export const adherenceOptions = [
  "Unreviewed",
  "Followed",
  "Partly followed",
  "Deviated",
] as const;
export const mistakeOptions = [
  "Entry timing",
  "Position sizing",
  "Risk management",
  "Exit execution",
  "Impulsive trade",
  "Missed context",
  "Other",
] as const;

export const orderStatuses = ["Filled", "Canceled"] as const;
export const orderSides = ["Buy", "Sell"] as const;
export const orderTypes = ["Market", "Limit"] as const;

export const chartMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export const chartSources = ["upload", "chart_img", "migration"] as const;
export const chatRoles = ["user", "assistant"] as const;
export const chatStatuses = ["completed", "pending", "running", "failed", "canceled"] as const;
export const terminalChatStatuses = ["completed", "failed", "canceled"] as const;
export const toolEventStatuses = ["running", "completed", "failed"] as const;

export const DEFAULT_BROKER_TIME_ZONE = "America/Puerto_Rico";
export const MAX_CHART_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_TEXT_LENGTH = 20_000;
export const MAX_CHAT_ATTACHMENTS = 8;
export const MAX_PLAIN_REVIEW_LENGTH = 12_000;
export const MAX_RECENT_HISTORY_MESSAGES = 20;
export const JOURNAL_RUN_TIMEOUT_MS = 5 * 60 * 1_000;
export const DEFAULT_CHAT_LIST_LIMIT = 100;
export const MAX_CHAT_LIST_LIMIT = 200;
export const DEFAULT_CHAT_CLEAR_BATCH_SIZE = 100;
export const MAX_CHAT_CLEAR_BATCH_SIZE = 200;
export const MAX_CHART_URLS_QUERY_KEYS = 32;

export type JournalInstrument = (typeof instruments)[number];
export type JournalAccount = (typeof accounts)[number];
export type JournalDirection = (typeof tradeDirections)[number];
export type JournalStatus = (typeof statuses)[number];
export type JournalAdherence = (typeof adherenceOptions)[number];
export type JournalMistake = (typeof mistakeOptions)[number];
export type JournalChartMimeType = (typeof chartMimeTypes)[number];
export type JournalChartSource = (typeof chartSources)[number];
export type JournalChatRole = (typeof chatRoles)[number];
export type JournalChatStatus = (typeof chatStatuses)[number];
export type JournalTerminalChatStatus = (typeof terminalChatStatuses)[number];
export type JournalToolEventStatus = (typeof toolEventStatuses)[number];

export const journalInstrumentValidator = v.union(
  v.literal("Shares"),
  v.literal("Options"),
  v.literal("Futures"),
  v.literal("Other"),
);

export const journalAccountValidator = v.union(
  v.literal("Live"),
  v.literal("Paper"),
  v.literal("Unspecified"),
);

export const journalDirectionValidator = v.union(
  v.literal(""),
  v.literal("Long"),
  v.literal("Short"),
  v.literal("Multi-leg"),
);

export const journalStatusValidator = v.union(
  v.literal("Open"),
  v.literal("Closed"),
);

export const journalAdherenceValidator = v.union(
  v.literal("Unreviewed"),
  v.literal("Followed"),
  v.literal("Partly followed"),
  v.literal("Deviated"),
);

export const journalMistakeValidator = v.union(
  v.literal("Entry timing"),
  v.literal("Position sizing"),
  v.literal("Risk management"),
  v.literal("Exit execution"),
  v.literal("Impulsive trade"),
  v.literal("Missed context"),
  v.literal("Other"),
);

export const journalOrderValidator = v.object({
  contract: v.string(),
  submittedAt: v.string(),
  status: v.union(v.literal("Filled"), v.literal("Canceled")),
  side: v.union(v.literal("Buy"), v.literal("Sell")),
  type: v.union(v.literal("Market"), v.literal("Limit")),
  quantity: v.number(),
  averageFillCents: v.union(v.number(), v.null()),
  realizedPnlCents: v.union(v.number(), v.null()),
  cashCents: v.number(),
  limitCents: v.union(v.number(), v.null()),
});

export const journalTradeInputValidator = v.object({
  symbol: v.string(),
  instrument: journalInstrumentValidator,
  account: journalAccountValidator,
  direction: journalDirectionValidator,
  status: journalStatusValidator,
  openedOn: v.string(),
  closedOn: v.union(v.string(), v.null()),
  setup: v.string(),
  size: v.string(),
  details: v.string(),
  plannedRiskCents: v.union(v.number(), v.null()),
  realizedPnlCents: v.union(v.number(), v.null()),
  thesis: v.string(),
  plan: v.string(),
  review: v.string(),
  adherence: journalAdherenceValidator,
  mistakes: v.array(journalMistakeValidator),
});

export const journalLessonInputValidator = v.object({
  title: v.string(),
  body: v.string(),
  tradeStableId: v.union(v.string(), v.null()),
});

export const journalOrderBatchInputValidator = v.object({
  date: v.string(),
  note: v.string(),
  orders: v.array(journalOrderValidator),
});

export const journalChartMimeTypeValidator = v.union(
  v.literal("image/jpeg"),
  v.literal("image/png"),
  v.literal("image/webp"),
);

export const journalChartSourceValidator = v.union(
  v.literal("upload"),
  v.literal("chart_img"),
  v.literal("migration"),
);

export const journalChatRoleValidator = v.union(
  v.literal("user"),
  v.literal("assistant"),
);

export const journalChatStatusValidator = v.union(
  v.literal("completed"),
  v.literal("pending"),
  v.literal("running"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const journalTerminalChatStatusValidator = v.union(
  v.literal("completed"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const journalChatAttachmentValidator = v.object({
  storageId: v.id("_storage"),
  imageKey: v.string(),
  mimeType: v.string(),
  filename: v.string(),
});

export const journalChatAttachmentRefValidator = v.object({
  imageKey: v.string(),
  filename: v.string(),
});

export const journalToolEventValidator = v.object({
  name: v.string(),
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
  ),
  summary: v.optional(v.string()),
});

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
  );
}

export const isoDateSchema = z
  .string()
  .refine(isCalendarDate, "Enter a valid YYYY-MM-DD date.");

export const journalStableIdSchema = z
  .string()
  .trim()
  .min(1, "Stable ID is required.")
  .max(128, "Stable ID must be at most 128 characters.")
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Stable ID must be an ASCII identifier.");

export const chartImageIdSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Chart image key must be a 64-character lowercase hex SHA-256.");

const notesSchema = z.string().trim().max(6000, "Keep notes to 6,000 characters.");
const centsSchema = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);

export const orderSchema = z.object({
  contract: z.string().trim().min(1).max(150),
  submittedAt: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/u),
  status: z.enum(orderStatuses),
  side: z.enum(orderSides),
  type: z.enum(orderTypes),
  quantity: z.number().int().min(1).max(1_000_000),
  averageFillCents: centsSchema.nullable(),
  realizedPnlCents: centsSchema.nullable(),
  cashCents: centsSchema,
  limitCents: centsSchema.nullable(),
}).strict();

export type Order = z.infer<typeof orderSchema>;

const tradeFieldsSchema = z.object({
  symbol: z.string().trim().toUpperCase().min(1, "Enter a symbol.").max(24),
  instrument: z.enum(instruments),
  account: z.enum(accounts),
  direction: z.enum(tradeDirections),
  status: z.enum(statuses),
  openedOn: z.literal("").or(isoDateSchema),
  closedOn: isoDateSchema.nullable(),
  setup: z.string().trim().max(80),
  size: z.string().trim().max(48),
  details: notesSchema,
  plannedRiskCents: centsSchema.positive("Planned risk must be greater than zero.").nullable(),
  realizedPnlCents: centsSchema.nullable(),
  thesis: notesSchema,
  plan: notesSchema,
  review: notesSchema,
  adherence: z.enum(adherenceOptions),
  mistakes: z
    .array(z.enum(mistakeOptions))
    .max(mistakeOptions.length)
    .transform((items) => [...new Set(items)]),
}).strict();

export type TradeInput = z.infer<typeof tradeFieldsSchema>;

function checkTradeDates(trade: TradeInput, context: z.RefinementCtx): void {
  if (trade.status === "Open") {
    if (!trade.openedOn) {
      context.addIssue({
        code: "custom",
        message: "Enter an opening date for the open position.",
        path: ["openedOn"],
      });
    }
    if (trade.closedOn !== null || trade.realizedPnlCents !== null) {
      context.addIssue({
        code: "custom",
        message: "Close the position before recording an exit date or realized P&L.",
      });
    }
    return;
  }

  if (trade.closedOn === null || trade.closedOn < trade.openedOn) {
    context.addIssue({
      code: "custom",
      message: "Enter a closing date on or after the opening date.",
    });
  }
}

export const tradeInputSchema = tradeFieldsSchema.superRefine(checkTradeDates);

export const lessonInputSchema = z.object({
  title: z.string().trim().min(1, "Enter a lesson title.").max(120),
  body: notesSchema.min(1, "Write down the lesson."),
  tradeStableId: journalStableIdSchema.nullable(),
}).strict();

export type LessonInput = z.infer<typeof lessonInputSchema>;

export const orderBatchInputSchema = z.object({
  date: isoDateSchema,
  note: notesSchema,
  orders: z.array(orderSchema).min(1, "Include at least one order.").max(120),
}).strict();

export type OrderBatchInput = z.infer<typeof orderBatchInputSchema>;

const reviewLabel = z.string().trim().min(1).max(100);
const reviewParagraph = z.string().trim().min(1).max(750);
const reviewCoordinate = z.number().int().min(0).max(16000);
const reviewLength = z.number().int().min(1).max(16000);
const reviewRectangle = z.object({
  x: reviewCoordinate,
  y: reviewCoordinate,
  width: reviewLength,
  height: reviewLength,
}).strict();

type Rectangle = z.infer<typeof reviewRectangle>;

function contains(outer: Rectangle, inner: Rectangle): boolean {
  return (
    inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height
  );
}

// All positions are pixels in the original screenshot, measured from its upper left corner.
export const reviewChartSchema = z
  .object({
    image: chartImageIdSchema,
    width: reviewLength,
    height: reviewLength,
    crop: reviewRectangle,
    focus: reviewRectangle,
    focusLabel: reviewLabel,
    levels: z
      .array(
        z.object({ y: reviewCoordinate, label: z.string().trim().min(1).max(14) }).strict(),
      )
      .max(3),
    ticks: z
      .array(
        z.object({ x: reviewCoordinate, label: z.string().trim().min(1).max(12) }).strict(),
      )
      .min(1)
      .max(5),
    interval: reviewLabel,
    heading: reviewLabel,
    text: reviewParagraph,
    alt: reviewParagraph,
  })
  .strict()
  .refine(
    ({ width, height, crop, focus, levels, ticks }) =>
      contains({ x: 0, y: 0, width, height }, crop)
      && contains(crop, focus)
      && levels.every(({ y }) => y >= crop.y && y <= crop.y + crop.height)
      && ticks.every(({ x }) => x >= crop.x && x <= crop.x + crop.width),
    "Keep the chart detail and its marks inside the screenshot.",
  );

export const chartReviewSchema = z.object({
  version: z.literal(1),
  instrument: reviewLabel,
  timeZone: z.string().trim().min(1).max(12),
  timing: reviewLabel.optional(),
  summary: reviewParagraph,
  charts: z.array(reviewChartSchema).min(1).max(8),
  nextTime: reviewParagraph,
  note: reviewParagraph.optional(),
}).strict();

export type ReviewChart = z.infer<typeof reviewChartSchema>;
export type ChartReview = z.infer<typeof chartReviewSchema>;

export const toolEventSchema = z.object({
  name: z.string().trim().min(1).max(120),
  status: z.enum(toolEventStatuses),
  summary: z.string().trim().max(500).optional(),
}).strict();

export type JournalToolEvent = {
  name: string;
  status: JournalToolEventStatus;
  summary?: string;
};

export function toExactToolEvent(event: z.infer<typeof toolEventSchema>): JournalToolEvent {
  const result: JournalToolEvent = {
    name: event.name,
    status: event.status,
  };
  if (event.summary !== undefined) result.summary = event.summary;
  return result;
}

export function parseChartReview(stored: string | null): ChartReview | null {
  if (!stored?.trimStart().startsWith("{")) return null;
  try {
    const parsed = chartReviewSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function referencedChartImageKeys(stored: string | null): string[] {
  const review = parseChartReview(stored);
  if (!review) return [];
  return [...new Set(review.charts.map((chart) => chart.image))];
}

export interface NormalizedAssistantReview {
  stored: string | null;
  chartReview: ChartReview | null;
  imageKeys: string[];
}

export function normalizeAssistantReview(
  input: string | ChartReview | null,
): NormalizedAssistantReview {
  if (input === null) {
    return { stored: null, chartReview: null, imageKeys: [] };
  }
  const stringResult = z.string().safeParse(input);
  if (!stringResult.success) {
    const parsed = chartReviewSchema.parse(input);
    return {
      stored: JSON.stringify(parsed),
      chartReview: parsed,
      imageKeys: [...new Set(parsed.charts.map((chart) => chart.image))],
    };
  }
  const trimmed = stringResult.data.trim();
  if (trimmed.length === 0) {
    return { stored: null, chartReview: null, imageKeys: [] };
  }
  if (trimmed.startsWith("{")) {
    let parsedJson: z.infer<ReturnType<typeof z.json>>;
    try {
      parsedJson = z.json().parse(JSON.parse(trimmed));
    } catch {
      throw new Error("Structured chart review must be valid JSON.");
    }
    const parsed = chartReviewSchema.parse(parsedJson);
    return {
      stored: JSON.stringify(parsed),
      chartReview: parsed,
      imageKeys: [...new Set(parsed.charts.map((chart) => chart.image))],
    };
  }
  if (trimmed.length > MAX_PLAIN_REVIEW_LENGTH) {
    throw new Error(`Assistant review must be at most ${MAX_PLAIN_REVIEW_LENGTH} characters.`);
  }
  return { stored: trimmed, chartReview: null, imageKeys: [] };
}

const IANA_TIME_ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

export function validateBrokerTimeZone(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 64 || !IANA_TIME_ZONE_PATTERN.test(normalized)) {
    throw new Error("brokerTimeZone must be a valid IANA time zone.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized });
  } catch {
    throw new Error(`Unsupported IANA time zone: ${normalized}`);
  }
  return normalized;
}

export function normalizeTradingViewLayoutId(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > 64 || !/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new Error("tradingViewLayoutId must be an alphanumeric identifier of at most 64 characters.");
  }
  return trimmed;
}

export function normalizeOptionalChartDimension(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1 || value > 16000) {
    throw new Error(`${field} must be an integer between 1 and 16000.`);
  }
  return value;
}

export function normalizeOptionalChartMetadata(
  value: string | undefined,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > maxLength) {
    throw new Error(`${field} must be at most ${maxLength} characters.`);
  }
  return trimmed;
}

export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const buffer = new Uint8Array(bytes).buffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export function decodeBase64Image(
  base64Data: string,
  maxBytes = MAX_CHART_IMAGE_BYTES,
): Uint8Array<ArrayBuffer> {
  const compact = base64Data.replaceAll(/\s+/g, "");
  if (compact.length === 0 || compact.length % 4 !== 0 || !BASE64_PATTERN.test(compact)) {
    throw new Error("Chart image payload must be valid base64.");
  }
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  const decodedLength = (compact.length / 4) * 3 - padding;
  if (decodedLength <= 0 || decodedLength > maxBytes) {
    throw new Error(`Chart image size must be between 1 byte and ${maxBytes} bytes.`);
  }
  let binary: string;
  try {
    binary = globalThis.atob(compact);
  } catch {
    throw new Error("Chart image payload could not be decoded as base64.");
  }
  if (binary.length === 0 || binary.length > maxBytes) {
    throw new Error(`Chart image size must be between 1 byte and ${maxBytes} bytes.`);
  }
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 16_777_216)
    + ((bytes[offset + 1] ?? 0) << 16)
    + ((bytes[offset + 2] ?? 0) << 8)
    + (bytes[offset + 3] ?? 0)
  );
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset] ?? 0;
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (offset + 1 >= bytes.length) return null;
    const segmentLength = readUint16BE(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if ((marker === 0xc0 || marker === 0xc1 || marker === 0xc2) && segmentLength >= 7) {
      const height = readUint16BE(bytes, offset + 3);
      const width = readUint16BE(bytes, offset + 5);
      if (width > 0 && height > 0 && width <= 16000 && height <= 16000) {
        return { width, height };
      }
      return null;
    }
    offset += segmentLength;
  }
  return null;
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (
    bytes.length < 24
    || bytes[0] !== 0x89
    || bytes[1] !== 0x50
    || bytes[2] !== 0x4e
    || bytes[3] !== 0x47
    || bytes[12] !== 0x49
    || bytes[13] !== 0x48
    || bytes[14] !== 0x44
    || bytes[15] !== 0x52
  ) {
    return null;
  }
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  if (width > 0 && height > 0 && width <= 16000 && height <= 16000) {
    return { width, height };
  }
  return null;
}

function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (
    bytes.length < 30
    || bytes[0] !== 0x52
    || bytes[1] !== 0x49
    || bytes[2] !== 0x46
    || bytes[3] !== 0x46
    || bytes[8] !== 0x57
    || bytes[9] !== 0x45
    || bytes[10] !== 0x42
    || bytes[11] !== 0x50
  ) {
    return null;
  }
  const chunk = String.fromCharCode(
    bytes[12] ?? 0,
    bytes[13] ?? 0,
    bytes[14] ?? 0,
    bytes[15] ?? 0,
  );
  if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    const width = readUint16LE(bytes, 26) & 0x3fff;
    const height = readUint16LE(bytes, 28) & 0x3fff;
    if (width > 0 && height > 0 && width <= 16000 && height <= 16000) return { width, height };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const b0 = bytes[21] ?? 0;
    const b1 = bytes[22] ?? 0;
    const b2 = bytes[23] ?? 0;
    const b3 = bytes[24] ?? 0;
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    if (width > 0 && height > 0 && width <= 16000 && height <= 16000) return { width, height };
  }
  if (chunk === "VP8X" && bytes.length >= 30) {
    const width = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16));
    const height = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16));
    if (width > 0 && height > 0 && width <= 16000 && height <= 16000) return { width, height };
  }
  return null;
}

export function detectImageDimensions(
  bytes: Uint8Array,
  mimeType: JournalChartMimeType,
): { width: number; height: number } | null {
  switch (mimeType) {
    case "image/jpeg":
      return readJpegDimensions(bytes);
    case "image/png":
      return readPngDimensions(bytes);
    case "image/webp":
      return readWebpDimensions(bytes);
  }
}

export interface SniffedChartImage {
  mimeType: JournalChartMimeType;
  width: number;
  height: number;
}

export function sniffChartImage(bytes: Uint8Array): SniffedChartImage {
  const png = readPngDimensions(bytes);
  if (png !== null) {
    return { mimeType: "image/png", width: png.width, height: png.height };
  }
  const jpeg = readJpegDimensions(bytes);
  if (jpeg !== null) {
    return { mimeType: "image/jpeg", width: jpeg.width, height: jpeg.height };
  }
  const webp = readWebpDimensions(bytes);
  if (webp !== null) {
    return { mimeType: "image/webp", width: webp.width, height: webp.height };
  }
  throw new Error("Unsupported or corrupted image format. Only valid JPEG, PNG, and WEBP images are accepted.");
}
