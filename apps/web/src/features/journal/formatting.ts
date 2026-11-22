import type { JournalTradeReadModel } from "../../convex/types";
import { DEFAULT_BROKER_TIME_ZONE } from "./constants";

const MAX_ABS_CENTS = 1_000_000_000_000;
const PLAIN_DOLLARS_PATTERN = /^(\d+)(?:\.(\d*))?$|^()\.(\d+)$/;
const GROUPED_DOLLARS_PATTERN = /^(\d{1,3}(?:,\d{3})+)(?:\.(\d*))?$/;

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const signedUsdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  signDisplay: "exceptZero",
});

const utcDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

export function formatMoney(cents: number | null, signed = false): string {
  if (cents === null) return "—";
  return (signed ? signedUsdFormatter : usdFormatter).format(cents / 100);
}

export function formatDateLabel(isoDate: string | null): string {
  if (!isoDate) return "—";
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return utcDateFormatter.format(parsed);
}

export function formatUpdatedDate(timestampMs: number): string {
  const isoDay = new Date(timestampMs).toISOString().slice(0, 10);
  return formatDateLabel(isoDay);
}

export function formatChatTime(timestampMs: number): string {
  return timeFormatter.format(new Date(timestampMs));
}

export function tradeDate(
  trade: Pick<JournalTradeReadModel, "openedOn" | "closedOn">,
): string {
  return trade.closedOn ?? trade.openedOn;
}

export function pnlTone(cents: number | null): "positive" | "negative" | "" {
  if (cents === null || cents === 0) return "";
  return cents > 0 ? "positive" : "negative";
}

export function dollarsToCents(raw: string): number | null {
  let cursor = raw.trim();
  if (!cursor) return null;

  let sign = 1;
  if (cursor.startsWith("+") || cursor.startsWith("-")) {
    if (cursor.startsWith("-")) sign = -1;
    cursor = cursor.slice(1).trimStart();
  }
  if (cursor.startsWith("$")) {
    cursor = cursor.slice(1).trimStart();
  }
  if (
    sign === 1 &&
    (cursor.startsWith("+") || cursor.startsWith("-")) &&
    raw.trim().startsWith("$")
  ) {
    if (cursor.startsWith("-")) sign = -1;
    cursor = cursor.slice(1).trimStart();
  }

  let wholeDigits: string;
  let fracDigits: string;
  const groupedMatch = GROUPED_DOLLARS_PATTERN.exec(cursor);
  if (groupedMatch) {
    wholeDigits = (groupedMatch[1] ?? "").replaceAll(",", "");
    fracDigits = groupedMatch[2] ?? "";
  } else {
    const plainMatch = PLAIN_DOLLARS_PATTERN.exec(cursor);
    if (!plainMatch) {
      throw new Error(
        "Enter a valid dollar amount (for example 125.50 or -$40.00).",
      );
    }
    wholeDigits = plainMatch[1] ?? plainMatch[3] ?? "0";
    fracDigits = plainMatch[2] ?? plainMatch[4] ?? "";
  }

  if (fracDigits.length > 2) {
    throw new Error("Enter at most two decimal places for dollar amounts.");
  }

  const wholeValue = BigInt(wholeDigits || "0");
  const fracValue = BigInt(fracDigits.padEnd(2, "0"));
  const totalBig = wholeValue * 100n + fracValue;
  if (totalBig > BigInt(MAX_ABS_CENTS)) {
    throw new Error("Dollar amount is outside the supported range.");
  }
  const signedCents = sign * Number(totalBig);
  return Object.is(signedCents, -0) ? 0 : signedCents;
}

export function centsToDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

export function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatIsoDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (year && month && day) {
    return `${year}-${month}-${day}`;
  }
  const fallbackMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const fallbackDay = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${fallbackMonth}-${fallbackDay}`;
}

export function localIsoDate(
  timeZone: string = DEFAULT_BROKER_TIME_ZONE,
  now: Date = new Date(),
): string {
  const candidate = timeZone.trim() || DEFAULT_BROKER_TIME_ZONE;
  try {
    return formatIsoDateInTimeZone(now, candidate);
  } catch {
    return formatIsoDateInTimeZone(now, DEFAULT_BROKER_TIME_ZONE);
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
