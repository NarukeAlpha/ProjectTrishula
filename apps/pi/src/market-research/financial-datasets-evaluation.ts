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
  // Older snapshots may include inline citations; Agent grounding is authoritative.
  citations: z.array(citationSchema).max(10).default([]),
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
    groundingCitations: z.infer<typeof citationSchema>[];
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

const groundingSchema = z.array(z.object({
  field: z.string().max(500),
  citations: z.array(z.object({
    url: z.string().max(2_000),
    title: z.string().trim().max(500).nullish(),
  })).max(10),
})).max(10_000);
type Citation = z.infer<typeof citationSchema>;

function groundingByField(raw: unknown): Map<string, Citation[]> {
  const envelope = z.object({ output: z.object({ grounding: groundingSchema.nullish() }) }).safeParse(raw);
  const result = new Map<string, Citation[]>();
  if (!envelope.success) return result;
  for (const entry of envelope.data.output.grounding ?? []) {
    // Normalize only concrete property/index paths; never match prefixes or wildcards.
    const path = entry.field.replace(/^\$\./, "").replace(/^output\.structured\./, "")
      .replace(/\[(\d+)\]/g, ".$1");
    for (const citation of entry.citations) {
      try {
        const url = requirePublicHttpsUrl(citation.url);
        const existing = result.get(path) ?? [];
        if (existing.length < 10 && !existing.some((item) => item.url === citation.url)) {
          existing.push({ title: citation.title || url.hostname, url: citation.url });
          result.set(path, existing);
        }
      } catch {
        // Invalid/private citations cannot establish support and never enter the report.
      }
    }
  }
  return result;
}

const numericalFields = new Set<typeof fieldNames[number]>([
  "currentPrice", "priorClose", "premarketHigh", "premarketLow", "premarketShareVolume",
  "premarketDollarVolume", "bid", "ask", "spread", "bars5m", "bars15m", "bars60m",
  "barsDaily", "barsWeekly",
]);

interface FieldGrounding {
  supported: boolean;
  citations: Citation[];
}

function fieldGrounding(
  grounding: ReadonlyMap<string, Citation[]>,
  snapshotIndex: number,
  field: typeof fieldNames[number],
  value: FinancialDatasetValue | null | undefined,
): FieldGrounding {
  const path = `snapshots.${snapshotIndex}.fields.${field}`;
  const aggregate = grounding.get(`${path}.value`) ?? grounding.get(path);
  if (aggregate?.length) return { supported: true, citations: aggregate };
  const bars = barsSchema.safeParse(value);
  if (!field.startsWith("bars") || !bars.success) return { supported: false, citations: [] };
  const citations = new Map<string, Citation>();
  let supported = true;
  for (const [index, bar] of bars.data.entries()) {
    for (const component of ["open", "high", "low", "close", "volume"] as const) {
      if (bar[component] === null) continue;
      const sources = grounding.get(`${path}.value.${index}.${component}`) ?? [];
      if (sources.length === 0) supported = false;
      for (const citation of sources) {
        if (citations.size < 10) citations.set(citation.url, citation);
      }
    }
  }
  return { supported, citations: [...citations.values()] };
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
      query: `Evaluate market-data support as of ${base.configuredInstant}, configured timezone ${options.configuredTimezone}, for ${FINANCIAL_DATASET_EVALUATION_SYMBOLS.join(", ")}. Return actual provider timestamps and session labels; do not substitute the requested time for a provider timestamp. Return explicit null for each unsupported field. Do not infer premarket values from prior-close data. Ground each supported value in output.grounding using its exact structured field path. Inline citations are optional.`,
      outputSchema: z.toJSONSchema(structuredEvaluationSchema, { io: "input" }),
      maxCostDollars: options.maximumCostUsd,
    }, signal);
    const raw = response.raw;
    responseCost = reportedCost(raw);
    const structured = structuredEvaluationSchema.parse(structuredOutput(raw));
    const grounding = groundingByField(raw);
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
      supportMatrix: structured.snapshots.flatMap((snapshot, snapshotIndex) => fieldNames.map((field) => {
        const value = snapshot.fields[field];
        const typedValue = fieldSchemas[field].safeParse(value?.value);
        const grounded = fieldGrounding(grounding, snapshotIndex, field, value?.value);
        const citations = [...new Map([...grounded.citations, ...(value?.citations ?? [])]
          .map((citation) => [citation.url, citation])).values()].slice(0, 10);
        const supported = typedValue.success && value?.asOf !== null && value?.asOf !== undefined
          && sessionSchema.safeParse(value.sessionLabel).success && citations.length > 0
          && (!numericalFields.has(field) || grounded.supported);
        return {
          symbol: snapshot.symbol,
          field,
          status: supported ? "supported" as const : "unsupported" as const,
          asOf: value?.asOf ?? null,
          sessionLabel: value?.sessionLabel ?? null,
          citationCount: citations.length,
          value: supported ? typedValue.data : null,
          citations,
          groundingCitations: grounded.citations,
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
