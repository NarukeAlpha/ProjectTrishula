import type { JournalTradeReadModel } from "../../convex/types";

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
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error("Enter a valid dollar amount.");
  }
  return Math.round(parsed * 100);
}

export function centsToDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

export function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function localIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
