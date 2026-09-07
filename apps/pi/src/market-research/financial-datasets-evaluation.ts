/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unsafe-dictionary-type -- The opt-in evaluation receives provider output only at this strict Zod parsing boundary. */
import { z } from "zod";
import type { MarketResearchExaClient } from "./exa-client.js";
import { requirePublicHttpsUrl } from "./source-normalizer.js";

export const FINANCIAL_DATASET_EVALUATION_SYMBOLS = ["AAPL", "NVDA", "AMD", "SPY", "QQQ"] as const;

export const FINANCIAL_DATASET_FIELD_NAMES = [
  "currentPrice", "quoteTime", "timezone", "priorClose", "sessionLabel",
  "premarketHigh", "premarketLow", "premarketShareVolume", "premarketDollarVolume",
  "bid", "ask", "spread", "bars5m", "bars15m", "bars60m", "barsDaily", "barsWeekly",
  "corporateActions", "providerCitations", "providerIdentifiers",
] as const;
const fieldNames = FINANCIAL_DATASET_FIELD_NAMES;

const citedValueSchema = z.object({
  value: z.union([z.string().max(500), z.number().finite(), z.boolean()]).nullable(),
  asOf: z.iso.datetime({ offset: true }).nullable(),
  sessionLabel: z.enum(["premarket", "regular", "after_hours", "closed", "unknown"]).nullable(),
  citations: z.array(z.object({
    title: z.string().trim().min(1).max(500),
    url: z.url().max(2_000),
  }).strict()).max(10),
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
  safeCode?: "exa_connect_zdr_incompatible" | "exa_invalid_request" | "exa_unavailable";
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
  try {
    const response = await client.runFinancialDatasetEvaluation({
      evaluationId: options.evaluationId,
      query: `Return a strict timestamped structured market-data support snapshot for ${FINANCIAL_DATASET_EVALUATION_SYMBOLS.join(", ")}. Return explicit null for each unsupported field. Do not infer premarket values from prior-close data.`,
      outputSchema: z.toJSONSchema(structuredEvaluationSchema),
      maxCostDollars: options.maximumCostUsd,
    }, signal);
    const raw = response.raw;
    const structured = structuredEvaluationSchema.parse(structuredOutput(raw));
    for (const snapshot of structured.snapshots) {
      for (const field of Object.values(snapshot.fields)) {
        if (!field) continue;
        for (const citation of field.citations) requirePublicHttpsUrl(citation.url);
      }
    }
    return {
      ...base,
      status: "completed",
      supportMatrix: structured.snapshots.flatMap((snapshot) => fieldNames.map((field) => {
        const value = snapshot.fields[field];
        return {
          symbol: snapshot.symbol,
          field,
          status: value?.value === null || value === undefined ? "unsupported" as const : "supported" as const,
          asOf: value?.asOf ?? null,
          sessionLabel: value?.sessionLabel ?? null,
          citationCount: value?.citations.length ?? 0,
        };
      })),
      latencyMs: Math.max(0, (options.now ?? Date.now)() - start),
      costUsd: reportedCost(raw),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "exa_unavailable";
    return {
      ...base,
      status: "failed",
      safeCode: message === "exa_connect_zdr_incompatible"
        ? "exa_connect_zdr_incompatible"
        : message === "exa_invalid_request"
          ? "exa_invalid_request"
          : "exa_unavailable",
      supportMatrix: [],
      latencyMs: Math.max(0, (options.now ?? Date.now)() - start),
      costUsd: null,
    };
  }
}
