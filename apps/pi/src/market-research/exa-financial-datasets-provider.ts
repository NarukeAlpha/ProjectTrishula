/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unsafe-dictionary-type -- Exa Agent output is untrusted and is converted to market data only after strict schema, citation, symbol, and time-range checks. */
import { z } from "zod";
import type { MarketResearchJobRequest } from "./contracts.js";
import type { MarketResearchExaClient } from "./exa-client.js";
import type {
  CorporateAction,
  MarketBar,
  MarketDataProvider,
  MarketMover,
  MarketSessionLabel,
  MarketSnapshot,
  MarketValue,
  SessionStatus,
} from "./market-data.js";
import { DisabledMarketDataProvider } from "./market-data.js";
import { canonicalSourceUrl, sha256 } from "./source-normalizer.js";

const symbolSchema = z.string().trim().min(1).max(20).regex(/^[A-Z0-9.^=-]+$/u);
const timestampSchema = z.iso.datetime({ offset: true });
const sessionLabelSchema = z.enum([
  "premarket",
  "regular",
  "after_hours",
  "closed",
  "unknown",
]);
const entitlementSchema = z.enum([
  "real_time",
  "delayed",
  "end_of_day",
  "unknown",
]);
const quoteSchema = z.object({
  value: z.number().finite().positive(),
  providerTimestamp: timestampSchema,
  sessionLabel: sessionLabelSchema,
  entitlement: entitlementSchema,
}).strict();
const barSchema = z.object({
  timestamp: timestampSchema,
  open: z.number().finite().positive(),
  high: z.number().finite().positive(),
  low: z.number().finite().positive(),
  close: z.number().finite().positive(),
  volume: z.number().finite().nonnegative().nullable(),
  sessionLabel: sessionLabelSchema,
  entitlement: entitlementSchema,
}).strict().refine((bar) =>
  bar.high >= Math.max(bar.open, bar.close)
  && bar.low <= Math.min(bar.open, bar.close)
  && bar.high >= bar.low);
const actionSchema = z.object({
  kind: z.enum(["dividend", "split", "offering", "other"]),
  effectiveAt: timestampSchema,
  detail: z.string().trim().min(1).max(500),
}).strict();
const symbolResultSchema = z.object({
  symbol: symbolSchema,
  price: quoteSchema.nullable(),
  priorClose: quoteSchema.nullable(),
  dailyBars: z.array(barSchema).max(250),
  weeklyBars: z.array(barSchema).max(104),
  corporateActions: z.array(actionSchema).max(20),
}).strict();
const providerOutputSchema = z.object({
  symbols: z.array(symbolResultSchema).min(1).max(30),
}).strict();
const citationSchema = z.object({
  url: z.url().max(2_000),
  title: z.string().trim().min(1).max(500).nullable().optional(),
}).passthrough();
const groundingSchema = z.object({
  field: z.string().trim().min(1).max(500),
  citations: z.array(citationSchema).max(20),
}).passthrough();

type ProviderOutput = z.infer<typeof providerOutputSchema>;
type Grounding = z.infer<typeof groundingSchema>;

export interface ExaFinancialDatasetsProviderOptions {
  client: Pick<MarketResearchExaClient, "runFinancialDatasetEvaluation">;
  request: Pick<MarketResearchJobRequest, "editionId"> & {
    preferences: Pick<
      MarketResearchJobRequest["preferences"],
      "primarySymbols" | "sectorSymbols"
    >;
  };
  maximumCostUsd: number;
  now?: () => Date;
}

type FinancialDatasetsRequest = Pick<MarketResearchJobRequest, "editionId"> & {
  preferences: Pick<
    MarketResearchJobRequest["preferences"],
    "primarySymbols" | "sectorSymbols" | "marketDataProviderId"
  >;
};

export interface MarketDataRuntimeGate {
  providerId: "disabled" | "exa_financial_datasets";
  financialDatasetsOwnerDecision: "pending" | "approved" | "partial" | "rejected";
  financialDatasetsMaxCostUsdPerRequest: number | undefined;
}

export function createConfiguredMarketDataProvider(
  gate: MarketDataRuntimeGate,
  request: FinancialDatasetsRequest,
  client: Pick<MarketResearchExaClient, "runFinancialDatasetEvaluation">,
): MarketDataProvider {
  if (
    request.preferences.marketDataProviderId !== "exa_financial_datasets"
    || gate.providerId !== "exa_financial_datasets"
    || gate.financialDatasetsOwnerDecision !== "approved"
    || gate.financialDatasetsMaxCostUsdPerRequest === undefined
  ) {
    return new DisabledMarketDataProvider();
  }
  return new ExaFinancialDatasetsProvider({
    client,
    request,
    maximumCostUsd: gate.financialDatasetsMaxCostUsdPerRequest,
  });
}

interface ProviderBundle {
  runId: string;
  retrievedAt: string;
  output: ProviderOutput;
  grounding: Grounding[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeGroundingPath(value: string): string {
  return value
    .replace(/^\$\./u, "")
    .replace(/^output\.structured\./u, "")
    .replace(/\[['"]?([^\]'".]+)['"]?\]/gu, ".$1")
    .replace(/^\.+|\.+$/gu, "");
}

function exactCitationUrls(
  grounding: readonly Grounding[],
  paths: readonly string[],
): string[] {
  const acceptedPaths = new Set(paths);
  const urls = grounding
    .filter((entry) => acceptedPaths.has(normalizeGroundingPath(entry.field)))
    .flatMap((entry) => entry.citations.map((citation) => citation.url));
  const publicUrls: string[] = [];
  for (const url of urls) {
    try {
      publicUrls.push(canonicalSourceUrl(url));
    } catch {
      // A non-public citation cannot authorize a numerical field.
    }
  }
  return [...new Set(publicUrls)].slice(0, 10);
}

function parseBundle(raw: unknown, expectedSymbols: readonly string[], retrievedAt: string): ProviderBundle {
  const rawRun = record(raw);
  const output = record(rawRun?.output);
  const parsed = providerOutputSchema.parse(output?.structured);
  const parsedGrounding = z.array(groundingSchema).max(5_000).safeParse(output?.grounding ?? []);
  const runId = typeof rawRun?.id === "string" && /^[A-Za-z0-9:._-]{1,256}$/u.test(rawRun.id)
    ? rawRun.id
    : "financial-datasets-run-unavailable";
  const expected = new Set(expectedSymbols);
  const received = new Set(parsed.symbols.map((item) => item.symbol));
  if (
    expected.size !== expectedSymbols.length
    || received.size !== parsed.symbols.length
    || received.size !== expected.size
    || [...received].some((symbol) => !expected.has(symbol))
  ) {
    throw new Error("market_data_conflict");
  }
  return {
    runId,
    retrievedAt,
    output: parsed,
    grounding: parsedGrounding.success ? parsedGrounding.data : [],
  };
}

function providerValue(
  bundle: ProviderBundle,
  symbolIndex: number,
  symbol: string,
  rawField: "price" | "priorClose",
  quote: z.infer<typeof quoteSchema> | null,
): MarketValue | undefined {
  if (quote === null) return undefined;
  const fieldPath = `symbols.${symbolIndex}.${rawField}`;
  const sourceUrls = exactCitationUrls(bundle.grounding, [fieldPath, `${fieldPath}.value`]);
  if (sourceUrls.length === 0) return undefined;
  return {
    provider: "Exa Connect Financial Datasets",
    providerTimestamp: quote.providerTimestamp,
    retrievedAt: bundle.retrievedAt,
    sessionLabel: quote.sessionLabel,
    entitlement: quote.entitlement,
    policyStatus: "approved",
    rawField,
    sourceUrls,
    providerIdentifiers: [bundle.runId],
    symbol,
    value: quote.value,
    unit: "USD",
  };
}

function providerBars(
  bundle: ProviderBundle,
  symbolIndex: number,
  symbol: string,
  interval: "1d" | "1w",
  values: readonly z.infer<typeof barSchema>[],
  start: string,
  end: string,
): MarketBar[] {
  const field = interval === "1d" ? "dailyBars" : "weeklyBars";
  const seriesPath = `symbols.${symbolIndex}.${field}`;
  const seriesUrls = exactCitationUrls(bundle.grounding, [seriesPath]);
  const startAt = Date.parse(start);
  const endAt = Date.parse(end);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt > endAt) {
    throw new Error("market_data_conflict");
  }
  return values
    .map((bar, index) => ({ bar, index }))
    .filter(({ bar }) => {
      const timestamp = Date.parse(bar.timestamp);
      return timestamp >= startAt && timestamp <= endAt;
    })
    .sort((left, right) => Date.parse(left.bar.timestamp) - Date.parse(right.bar.timestamp))
    .flatMap(({ bar, index }) => {
      const barPath = `${seriesPath}.${index}`;
      let sourceUrls = [...seriesUrls, ...exactCitationUrls(bundle.grounding, [barPath])];
      if (sourceUrls.length === 0) {
        const numericComponents = ["open", "high", "low", "close", ...(bar.volume === null ? [] : ["volume"])] as const;
        const componentUrls = numericComponents.map((component) =>
          exactCitationUrls(bundle.grounding, [`${barPath}.${component}`]));
        if (componentUrls.some((urls) => urls.length === 0)) return [];
        sourceUrls = componentUrls.flat();
      }
      sourceUrls = [...new Set(sourceUrls)].slice(0, 10);
      const result: MarketBar = {
        provider: "Exa Connect Financial Datasets",
        providerTimestamp: bar.timestamp,
        retrievedAt: bundle.retrievedAt,
        sessionLabel: bar.sessionLabel,
        entitlement: bar.entitlement,
        policyStatus: "approved",
        rawField: interval === "1d" ? "historical_prices.daily" : "historical_prices.weekly",
        sourceUrls,
        providerIdentifiers: [bundle.runId],
        symbol,
        timestamp: bar.timestamp,
        interval,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      };
      if (bar.volume !== null) result.volume = bar.volume;
      return [result];
    });
}

export class ExaFinancialDatasetsProvider implements MarketDataProvider {
  readonly id = "exa_financial_datasets";
  readonly policyStatus = "approved" as const;
  private readonly now: () => Date;
  private readonly symbols: readonly string[];
  private bundlePromise: Promise<ProviderBundle> | undefined;

  constructor(private readonly options: ExaFinancialDatasetsProviderOptions) {
    if (!Number.isFinite(options.maximumCostUsd) || options.maximumCostUsd <= 0 || options.maximumCostUsd > 100) {
      throw new Error("market_data_not_configured");
    }
    this.now = options.now ?? (() => new Date());
    this.symbols = [...new Set([
      ...options.request.preferences.primarySymbols,
      ...options.request.preferences.sectorSymbols,
    ])];
    if (this.symbols.length === 0 || this.symbols.length > 30) {
      throw new Error("market_data_not_configured");
    }
  }

  getSessionStatus(_date: string, _timezone: string): Promise<SessionStatus> {
    return Promise.reject(new Error("market_data_unavailable"));
  }

  async getSnapshots(symbols: readonly string[], signal?: AbortSignal): Promise<MarketSnapshot[]> {
    const bundle = await this.bundle(signal);
    const requested = new Set(symbols);
    if (requested.size !== symbols.length || requested.size !== this.symbols.length) {
      throw new Error("market_data_conflict");
    }
    return bundle.output.symbols.map((item, index) => {
      if (!requested.has(item.symbol)) throw new Error("market_data_conflict");
      const price = providerValue(bundle, index, item.symbol, "price", item.price);
      const priorClose = providerValue(bundle, index, item.symbol, "priorClose", item.priorClose);
      if (price === undefined && priorClose === undefined) throw new Error("market_data_unavailable");
      const snapshot: MarketSnapshot = { symbol: item.symbol };
      if (price !== undefined) snapshot.price = price;
      if (priorClose !== undefined) snapshot.priorClose = priorClose;
      return snapshot;
    });
  }

  async getBars(
    symbol: string,
    interval: MarketBar["interval"],
    start: string,
    end: string,
    _includeExtendedHours: boolean,
    signal?: AbortSignal,
  ): Promise<MarketBar[]> {
    if (interval !== "1d" && interval !== "1w") {
      throw new Error("market_data_unavailable");
    }
    const bundle = await this.bundle(signal);
    const index = bundle.output.symbols.findIndex((item) => item.symbol === symbol);
    const item = bundle.output.symbols[index];
    if (index < 0 || item === undefined) throw new Error("market_data_conflict");
    return providerBars(
      bundle,
      index,
      symbol,
      interval,
      interval === "1d" ? item.dailyBars : item.weeklyBars,
      start,
      end,
    );
  }

  async getCorporateActions(
    symbol: string,
    start: string,
    end: string,
    signal?: AbortSignal,
  ): Promise<CorporateAction[]> {
    const bundle = await this.bundle(signal);
    const index = bundle.output.symbols.findIndex((item) => item.symbol === symbol);
    const item = bundle.output.symbols[index];
    if (index < 0 || item === undefined) throw new Error("market_data_conflict");
    const sourceUrls = exactCitationUrls(bundle.grounding, [
      `symbols.${index}.corporateActions`,
    ]);
    if (item.corporateActions.length > 0 && sourceUrls.length === 0) return [];
    const startAt = Date.parse(start);
    const endAt = Date.parse(end);
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt > endAt) {
      throw new Error("market_data_conflict");
    }
    return item.corporateActions
      .filter((action) => {
        const effectiveAt = Date.parse(action.effectiveAt);
        return effectiveAt >= startAt && effectiveAt <= endAt;
      })
      .map((action) => ({
        actionId: `exa-action-${sha256(`${bundle.runId}:${symbol}:${action.kind}:${action.effectiveAt}`).slice(0, 32)}`,
        symbol,
        kind: action.kind,
        effectiveAt: action.effectiveAt,
        detail: action.detail,
        sourceUrl: sourceUrls[0] ?? "",
        provenance: {
          provider: "Exa Connect Financial Datasets",
          providerTimestamp: action.effectiveAt,
          retrievedAt: bundle.retrievedAt,
          sessionLabel: "unknown" as MarketSessionLabel,
          entitlement: "unknown",
          policyStatus: "approved",
          rawField: "corporate_actions",
          sourceUrls,
          providerIdentifiers: [bundle.runId],
        },
      }));
  }

  getMarketMovers(): Promise<MarketMover[]> {
    return Promise.resolve([]);
  }

  private bundle(signal?: AbortSignal): Promise<ProviderBundle> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    this.bundlePromise ??= this.loadBundle(signal);
    return this.bundlePromise;
  }

  private async loadBundle(signal?: AbortSignal): Promise<ProviderBundle> {
    const retrievedAt = this.now().toISOString();
    const response = await this.options.client.runFinancialDatasetEvaluation({
      evaluationId: `provider-${this.options.request.editionId}`,
      query: [
        `Return Financial Datasets records for exactly these symbols: ${this.symbols.join(", ")}.`,
        "Return current price with quote time, prior regular close, up to 250 recent daily OHLCV bars, up to 104 recent weekly OHLCV bars, and corporate actions.",
        "Return null or an empty array when a field is unsupported. Do not infer intraday, premarket, bid, ask, spread, or volume fields from prior-close data.",
        "Use an explicit session label and entitlement for every returned quote or bar.",
      ].join(" "),
      outputSchema: z.toJSONSchema(providerOutputSchema),
      maxCostDollars: this.options.maximumCostUsd,
    }, signal);
    return parseBundle(response.raw, this.symbols, retrievedAt);
  }
}
