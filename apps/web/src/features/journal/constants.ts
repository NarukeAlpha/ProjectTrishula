import type {
  JournalAccount,
  JournalAdherence,
  JournalChartMimeType,
  JournalDirection,
  JournalInstrument,
  JournalMistake,
  JournalStatus,
} from "../../convex/types";

export const JOURNAL_INSTRUMENTS: readonly JournalInstrument[] = [
  "Shares",
  "Options",
  "Futures",
  "Other",
] as const;

export const JOURNAL_ACCOUNTS: readonly JournalAccount[] = [
  "Live",
  "Paper",
  "Unspecified",
] as const;

export const JOURNAL_DIRECTIONS: readonly Exclude<JournalDirection, "">[] = [
  "Long",
  "Short",
  "Multi-leg",
] as const;

export const JOURNAL_STATUSES: readonly JournalStatus[] = [
  "Open",
  "Closed",
] as const;

export const JOURNAL_ADHERENCE_OPTIONS: readonly JournalAdherence[] = [
  "Unreviewed",
  "Followed",
  "Partly followed",
  "Deviated",
] as const;

export const JOURNAL_MISTAKE_OPTIONS: readonly JournalMistake[] = [
  "Entry timing",
  "Position sizing",
  "Risk management",
  "Exit execution",
  "Impulsive trade",
  "Missed context",
  "Other",
] as const;

export const ALLOWED_ATTACHMENT_MIME_TYPES: readonly JournalChartMimeType[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 6;
export const DEFAULT_BROKER_TIME_ZONE = "America/Puerto_Rico";

export const COMMON_BROKER_TIME_ZONES: readonly string[] = [
  "America/Puerto_Rico",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "UTC",
] as const;
