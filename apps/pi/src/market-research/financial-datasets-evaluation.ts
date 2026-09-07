/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unsafe-dictionary-type -- The opt-in evaluation receives provider output only at this strict Zod parsing boundary. */
import { z } from "zod";
import type { MarketResearchExaClient } from "./exa-client.js";
import { requirePublicHttpsUrl } from "./source-normalizer.js";
import { MarketResearchExaError } from "./exa-errors.js";
import type { MarketResearchSafeErrorCode } from "./contracts.js";

export const FINANCIAL_DATASET_EVALUATION_SYMBOLS = ["AAPL", "NVDA", "AMD", "SPY", "QQQ"] as const;

export const FINANCIAL_DATASET_FIELD_NAMES = [
  "currentPrice", "quoteTime", "timezone", "priorClose", "sessionLabel",
  "premarketHigh", "premarketLow", "premarketShareVolume", "premarketDollarVolume",
  "bid", "ask", "spread", "bars5m", "bars15m", "bars60m", "barsDaily", "barsWeekly",
  "corporateActions", "providerCitations", "providerIdentifiers",
] as const;
const fieldNames = FINANCIAL_DATASET_FIELD_NAMES;

const sessionSchema = z.enum(["premarket", "regular", "after_hours", "closed"]);
const citationSchema = z.object({
  title: z.string().trim().min(1).max(500),
  url: z.url().max(2_000),
}).strict();
const barSchema = z.object({
  timestamp: z.iso.datetime({ offset: true }),
  open: z.number().finite().positive(),
  high: z.number().finite().positive(),
  low: z.number().finite().positive(),
  close: z.number().finite().positive(),
  volume: z.number().finite().nonnegative().nullable(),
}).strict().refine((bar) => bar.high >= Math.max(bar.open, bar.close)
  && bar.low <= Math.min(bar.open, bar.close) && bar.high >= bar.low);
const barsSchema = z.array(barSchema).min(1).max(50).refine((bars) =>
  bars.every((bar, index) => index === 0 || Date.parse(bar.timestamp) > Date.parse(bars[index - 1]!.timestamp)));
const actionSchema = z.object({
  kind: z.enum(["dividend", "split", "offering", "other"]),
  effectiveAt: z.iso.datetime({ offset: true }),
  detail: z.string().trim().min(1).max(500),
}).strict();
const valueSchema = z.union([
  z.string().max(500), z.number().finite(), z.boolean(),
  z.array(barSchema).max(50), z.array(actionSchema).max(20),
  z.array(citationSchema).max(10), z.array(z.string().trim().min(1).max(100)).max(20),
]);
export type FinancialDatasetValue = z.infer<typeof valueSchema>;

const fieldSchemas = {
  currentPrice: z.number().finite().positive(),
  quoteTime: z.iso.datetime({ offset: true }),
  timezone: z.string().max(100).refine((value) => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
  }),
  priorClose: z.number().finite().positive(),
  sessionLabel: sessionSchema,
  premarketHigh: z.number().finite().positive(),
  premarketLow: z.number().finite().positive(),
  premarketShareVolume: z.number().finite().nonnegative(),
  premarketDollarVolume: z.number().finite().nonnegative(),
  bid: z.number().finite().positive(),
  ask: z.number().finite().positive(),
  spread: z.number().finite().nonnegative(),
  bars5m: barsSchema,
  bars15m: barsSchema,
  bars60m: barsSchema,
  barsDaily: barsSchema,
  barsWeekly: barsSchema,
  corporateActions: z.array(actionSchema).min(1).max(20),
  providerCitations: z.array(citationSchema).min(1).max(10),
  providerIdentifiers: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
} as const;

const citedValueSchema = z.object({
  value: valueSchema.nullable(),
  asOf: z.iso.datetime({ offset: true }).nullable(),
  sessionLabel: z.enum(["premarket", "regular", "after_hours", "closed", "unknown"]).nullable(),
  citations: z.array(citationSchema).max(10),
}).strict();

const symbolSnapshotSchema = z.object({
  symbol: z.enum(FINANCIAL_DATASET_EVALUATION_SYMBOLS),
  fields: z.record(z.enum(fieldNames), citedValueSchema.optional()),
}).strict();

const structuredEvaluationSchema = z.object({
  snapshots: z.array(symbolSnapshotSchema).length(FINANCIAL_DATASET_EVALUATION_SYMBOLS.length),
}).strict().superRefine((value, context) => {
  const symbols = value.snapshots.map((snapshot) => snapshot.symbol);
  if (new Set(symbols).size !== FINANCIAL_DATASET_EVALUATION_SYMBOLS.length) {
    context.addIssue({ code: "custom", path: ["snapshots"], message: "Every evaluation symbol is required once." });
  }
});

export interface FinancialDatasetsEvaluationOptions {
  evaluationId: string;
  configuredInstant: string;
  configuredTimezone: string;
  zdrStatus: "enabled" | "disabled" | "unknown";
  maximumCostUsd: number;
  now?: () => number;
}

export interface FinancialDatasetsEvaluationReport {
  schemaVersion: 1;
  evaluationId: string;
  status: "completed" | "failed";
  safeCode?: MarketResearchSafeErrorCode;
  configuredInstant: string;
  configuredTimezone: string;
  marketTime: string;
  symbols: readonly string[];
  supportMatrix: Array<{
    symbol: string;
    field: typeof fieldNames[number];
    status: "supported" | "unsupported";
    asOf: string | null;
    sessionLabel: string | null;
    citationCount: number;
    value: FinancialDatasetValue | null;
    citations: z.infer<typeof citationSchema>[];
  }>;
  latencyMs: number;
  costUsd: number | null;
  referenceComparison: "pending_external_reference";
  ownerDecision: "pending";
}

function marketTime(instant: string): string {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) throw new Error("exa_invalid_request");
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).format(parsed);
}

function structuredOutput(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return undefined;
  const output = (raw as Record<string, unknown>).output;
  return typeof output === "object" && output !== null
    ? (output as Record<string, unknown>).structured
    : undefined;
}

function reportedCost(raw: unknown): number | null {
  if (typeof raw !== "object" || raw === null) return null;
  const costDollars = (raw as Record<string, unknown>).costDollars;
  if (typeof costDollars !== "object" || costDollars === null) return null;
  const total = (costDollars as Record<string, unknown>).total;
  return typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : null;
}

export async function evaluateFinancialDatasets(
  client: Pick<MarketResearchExaClient, "runFinancialDatasetEvaluation">,
  options: FinancialDatasetsEvaluationOptions,
  signal?: AbortSignal,
): Promise<FinancialDatasetsEvaluationReport> {
  const base = {
    schemaVersion: 1 as const,
    evaluationId: options.evaluationId,
    configuredInstant: new Date(options.configuredInstant).toISOString(),
    configuredTimezone: options.configuredTimezone,
    marketTime: marketTime(options.configuredInstant),
    symbols: FINANCIAL_DATASET_EVALUATION_SYMBOLS,
    referenceComparison: "pending_external_reference" as const,
    ownerDecision: "pending" as const,
  };
  if (options.zdrStatus !== "disabled") {
    return {
      ...base,
      status: "failed",
      safeCode: "exa_connect_zdr_incompatible",
      supportMatrix: [],
      latencyMs: 0,
      costUsd: null,
    };
  }
  const start = (options.now ?? Date.now)();
  let responseCost: number | null = null;
  try {
    const response = await client.runFinancialDatasetEvaluation({
      evaluationId: options.evaluationId,
      query: `Return a strict timestamped structured market-data support snapshot for ${FINANCIAL_DATASET_EVALUATION_SYMBOLS.join(", ")}. Return explicit null for each unsupported field. Do not infer premarket values from prior-close data.`,
      outputSchema: z.toJSONSchema(structuredEvaluationSchema),
      maxCostDollars: options.maximumCostUsd,
    }, signal);
    const raw = response.raw;
    responseCost = reportedCost(raw);
    const structured = structuredEvaluationSchema.parse(structuredOutput(raw));
    for (const snapshot of structured.snapshots) {
      for (const field of Object.values(snapshot.fields)) {
        if (!field) continue;
        for (const citation of field.citations) requirePublicHttpsUrl(citation.url);
      }
      const providerCitations = snapshot.fields.providerCitations?.value;
      const parsedCitations = fieldSchemas.providerCitations.safeParse(providerCitations);
      if (parsedCitations.success) {
        for (const citation of parsedCitations.data) requirePublicHttpsUrl(citation.url);
      }
    }
    return {
      ...base,
      status: "completed",
      supportMatrix: structured.snapshots.flatMap((snapshot) => fieldNames.map((field) => {
        const value = snapshot.fields[field];
        const typedValue = fieldSchemas[field].safeParse(value?.value);
        const supported = typedValue.success && value?.asOf !== null && value?.asOf !== undefined
          && sessionSchema.safeParse(value.sessionLabel).success && value.citations.length > 0;
        return {
          symbol: snapshot.symbol,
          field,
          status: supported ? "supported" as const : "unsupported" as const,
          asOf: value?.asOf ?? null,
          sessionLabel: value?.sessionLabel ?? null,
          citationCount: value?.citations.length ?? 0,
          value: supported ? typedValue.data : null,
          citations: value?.citations ?? [],
        };
      })),
      latencyMs: Math.max(0, (options.now ?? Date.now)() - start),
      costUsd: responseCost,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "exa_unavailable";
    return {
      ...base,
      status: "failed",
      safeCode: error instanceof MarketResearchExaError
        ? error.decision.code
        : message === "exa_connect_zdr_incompatible"
        ? "exa_connect_zdr_incompatible"
        : message === "exa_invalid_request"
          ? "exa_invalid_request"
          : "exa_unavailable",
      supportMatrix: [],
      latencyMs: Math.max(0, (options.now ?? Date.now)() - start),
      costUsd: responseCost,
    };
  }
}
