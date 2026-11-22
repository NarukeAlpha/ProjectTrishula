import { z } from "zod";

export const journalInstruments = ["Shares", "Options", "Futures", "Other"] as const;
export const journalAccounts = ["Live", "Paper", "Unspecified"] as const;
export const journalDirections = ["", "Long", "Short", "Multi-leg"] as const;
export const journalStatuses = ["Open", "Closed"] as const;
export const journalAdherenceOptions = [
  "Unreviewed",
  "Followed",
  "Partly followed",
  "Deviated",
] as const;
export const journalMistakeOptions = [
  "Entry timing",
  "Position sizing",
  "Risk management",
  "Exit execution",
  "Impulsive trade",
  "Missed context",
  "Other",
] as const;

export const journalOrderStatuses = ["Filled", "Canceled"] as const;
export const journalOrderSides = ["Buy", "Sell"] as const;
export const journalOrderTypes = ["Market", "Limit"] as const;

export const journalChartMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export const journalChartSources = ["upload", "chart_img", "migration"] as const;
export const journalChatRoles = ["user", "assistant"] as const;
export const journalChatStatuses = ["completed", "pending", "running", "failed", "canceled"] as const;
export const journalTerminalChatStatuses = ["completed", "failed", "canceled"] as const;
export const journalToolEventStatuses = ["running", "completed", "failed"] as const;

export const MAX_JOURNAL_CHART_BYTES = 10 * 1024 * 1024;
export const MAX_JOURNAL_CHAT_TEXT_LENGTH = 20_000;
export const MAX_JOURNAL_PLAIN_REVIEW_LENGTH = 12_000;
export const MAX_JOURNAL_CHAT_ATTACHMENTS = 8;

export type JournalChartMimeType = (typeof journalChartMimeTypes)[number];
export type JournalChartSource = (typeof journalChartSources)[number];
export type JournalTerminalChatStatus = (typeof journalTerminalChatStatuses)[number];
export type JournalToolEventStatus = (typeof journalToolEventStatuses)[number];

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

export const journalOwnerIdSchema = z.string().trim().min(1).max(256);

export const journalStableIdSchema = z
  .string()
  .trim()
  .min(1, "Stable ID is required.")
  .max(128, "Stable ID must be at most 128 characters.")
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Stable ID must be an ASCII identifier.");

export const journalRunTokenSchema = z.string().trim().min(1).max(2_048);

export const chartImageIdSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Chart image key must be a 64-character lowercase hex SHA-256.");

const notesSchema = z.string().trim().max(6_000, "Keep notes to 6,000 characters.");
const centsSchema = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);

export const journalOrderSchema = z.object({
  contract: z.string().trim().min(1).max(150),
  submittedAt: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/u),
  status: z.enum(journalOrderStatuses),
  side: z.enum(journalOrderSides),
  type: z.enum(journalOrderTypes),
  quantity: z.number().int().min(1).max(1_000_000),
  averageFillCents: centsSchema.nullable(),
  realizedPnlCents: centsSchema.nullable(),
  cashCents: centsSchema,
  limitCents: centsSchema.nullable(),
}).strict();

export type JournalOrder = z.infer<typeof journalOrderSchema>;

const tradeFieldsSchema = z.object({
  symbol: z.string().trim().toUpperCase().min(1, "Enter a symbol.").max(24),
  instrument: z.enum(journalInstruments),
  account: z.enum(journalAccounts),
  direction: z.enum(journalDirections),
  status: z.enum(journalStatuses),
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
  adherence: z.enum(journalAdherenceOptions),
  mistakes: z
    .array(z.enum(journalMistakeOptions))
    .max(journalMistakeOptions.length)
    .transform((items) => [...new Set(items)]),
}).strict();

export type JournalTradeInput = z.infer<typeof tradeFieldsSchema>;

function checkTradeDates(trade: JournalTradeInput, context: z.RefinementCtx): void {
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

export const journalTradeInputSchema = tradeFieldsSchema.superRefine(checkTradeDates);

export const journalLessonInputSchema = z.object({
  title: z.string().trim().min(1, "Enter a lesson title.").max(120),
  body: notesSchema.min(1, "Write down the lesson."),
  tradeStableId: journalStableIdSchema.nullable(),
}).strict();

export type JournalLessonInput = z.infer<typeof journalLessonInputSchema>;

const reviewLabel = z.string().trim().min(1).max(100);
const reviewParagraph = z.string().trim().min(1).max(750);
const reviewCoordinate = z.number().int().min(0).max(16_000);
const reviewLength = z.number().int().min(1).max(16_000);
const reviewRectangle = z.object({
  x: reviewCoordinate,
  y: reviewCoordinate,
  width: reviewLength,
  height: reviewLength,
}).strict();

type Rectangle = z.infer<typeof reviewRectangle>;

function containsRectangle(outer: Rectangle, inner: Rectangle): boolean {
  return (
    inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height
  );
}

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
      containsRectangle({ x: 0, y: 0, width, height }, crop)
      && containsRectangle(crop, focus)
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

export type JournalReviewChart = z.infer<typeof reviewChartSchema>;
export type JournalChartReview = z.infer<typeof chartReviewSchema>;

export const assistantReviewInputSchema = z.union([
  z.string().max(MAX_JOURNAL_PLAIN_REVIEW_LENGTH),
  chartReviewSchema,
  z.null(),
]);

export type JournalAssistantReviewInput = z.infer<typeof assistantReviewInputSchema>;

export const journalToolEventSchema = z.object({
  name: z.string().trim().min(1).max(120),
  status: z.enum(journalToolEventStatuses),
  summary: z.string().trim().max(500).optional(),
}).strict();

export interface JournalToolEvent {
  name: string;
  status: JournalToolEventStatus;
  summary?: string;
}

export const journalSettingsSchema = z.object({
  brokerTimeZone: z.string().trim().min(1).max(64),
  tradingViewLayoutId: z.string().trim().min(1).max(64).optional(),
  updatedAt: z.number().int().nonnegative(),
}).strict();

export type JournalSettings = z.infer<typeof journalSettingsSchema>;

export const journalChatAttachmentSchema = z.object({
  storageId: z.string().trim().min(1).max(256),
  imageKey: chartImageIdSchema,
  mimeType: z.string().trim().min(1).max(64),
  filename: z.string().trim().min(1).max(256),
  url: z.string().url().nullable(),
}).strict();

export type JournalChatAttachment = z.infer<typeof journalChatAttachmentSchema>;

export const journalChatMessageSchema = z.object({
  stableId: journalStableIdSchema,
  ordinal: z.number().int().nonnegative(),
  role: z.enum(journalChatRoles),
  text: z.string().max(MAX_JOURNAL_CHAT_TEXT_LENGTH),
  attachments: z.array(journalChatAttachmentSchema).max(MAX_JOURNAL_CHAT_ATTACHMENTS),
  toolEvents: z.array(journalToolEventSchema).max(64).optional(),
  runStableId: journalStableIdSchema.optional(),
  status: z.enum(journalChatStatuses),
  error: z.string().max(1_000).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();

export type JournalChatMessage = z.infer<typeof journalChatMessageSchema>;

export const journalUserChatMessageSchema = journalChatMessageSchema.extend({
  role: z.literal("user"),
});

export const journalRunRequestSchema = z.object({
  runId: journalStableIdSchema,
  ownerId: journalOwnerIdSchema,
  runToken: journalRunTokenSchema,
  settings: journalSettingsSchema,
  userMessage: journalUserChatMessageSchema,
  history: z.array(journalChatMessageSchema).max(40),
}).strict();

export type JournalRunRequest = z.infer<typeof journalRunRequestSchema>;

export const journalCancelParamsSchema = z.object({
  runId: journalStableIdSchema,
}).strict();

export const journalCancelBodySchema = z.object({
  ownerId: journalOwnerIdSchema,
  runId: journalStableIdSchema,
}).strict();

export type JournalCancelRequest = z.infer<typeof journalCancelBodySchema>;

export interface SniffedJournalImage {
  mimeType: JournalChartMimeType;
  width: number;
  height: number;
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
      if (width > 0 && height > 0 && width <= 16_000 && height <= 16_000) {
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
    || bytes[4] !== 0x0d
    || bytes[5] !== 0x0a
    || bytes[6] !== 0x1a
    || bytes[7] !== 0x0a
    || bytes[12] !== 0x49
    || bytes[13] !== 0x48
    || bytes[14] !== 0x44
    || bytes[15] !== 0x52
  ) {
    return null;
  }
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  if (width > 0 && height > 0 && width <= 16_000 && height <= 16_000) {
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
  if (
    chunk === "VP8 "
    && bytes.length >= 30
    && bytes[23] === 0x9d
    && bytes[24] === 0x01
    && bytes[25] === 0x2a
  ) {
    const width = readUint16LE(bytes, 26) & 0x3fff;
    const height = readUint16LE(bytes, 28) & 0x3fff;
    if (width > 0 && height > 0 && width <= 16_000 && height <= 16_000) return { width, height };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const b0 = bytes[21] ?? 0;
    const b1 = bytes[22] ?? 0;
    const b2 = bytes[23] ?? 0;
    const b3 = bytes[24] ?? 0;
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    if (width > 0 && height > 0 && width <= 16_000 && height <= 16_000) return { width, height };
  }
  if (chunk === "VP8X" && bytes.length >= 30) {
    const width = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16));
    const height = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16));
    if (width > 0 && height > 0 && width <= 16_000 && height <= 16_000) return { width, height };
  }
  return null;
}

export function sniffJournalImage(bytes: Uint8Array): SniffedJournalImage | null {
  const png = readPngDimensions(bytes);
  if (png !== null) return { mimeType: "image/png", width: png.width, height: png.height };
  const jpeg = readJpegDimensions(bytes);
  if (jpeg !== null) return { mimeType: "image/jpeg", width: jpeg.width, height: jpeg.height };
  const webp = readWebpDimensions(bytes);
  if (webp !== null) return { mimeType: "image/webp", width: webp.width, height: webp.height };
  return null;
}

export interface CombinedAbortSignal {
  signal: AbortSignal;
  cleanup: () => void;
  wasTimeout: () => boolean;
}

export function createTimeoutAbortSignal(
  timeoutMs: number,
  timeoutErrorMessage: string,
  callerSignal?: AbortSignal,
  callerFallbackMessage = "journal_run_aborted",
): CombinedAbortSignal {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(timeoutErrorMessage));
  }, timeoutMs);
  const onCallerAbort = () => {
    controller.abort(callerSignal?.reason ?? new Error(callerFallbackMessage));
  };
  if (callerSignal?.aborted) {
    onCallerAbort();
  } else {
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    },
    wasTimeout: () => timedOut,
  };
}

export async function readBoundedBytes(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: "too_large" | "empty" | "read_error" }> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const parsed = Number(declared);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxBytes) {
      return { ok: false, reason: "too_large" };
    }
  }
  if (response.body === null) {
    return { ok: false, reason: "empty" };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "too_large" };
      }
      chunks.push(next.value);
    }
  } catch {
    return { ok: false, reason: "read_error" };
  } finally {
    reader.releaseLock();
  }
  if (total === 0) return { ok: false, reason: "empty" };
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes: combined };
}
