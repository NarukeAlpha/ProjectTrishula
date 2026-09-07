/* oxlint-disable anti-slop/no-unknown-parameters -- Provider responses cross an untrusted runtime boundary; these validators parse unknown payloads with strict Zod schemas before domain use. */
import { z } from "zod";
import { canonicalSourceUrl } from "./source-normalizer.js";

export type MarketSessionLabel = "premarket" | "regular" | "after_hours" | "closed" | "unknown";
export type MarketDataPolicyStatus = "approved" | "evaluation_only" | "permission_required" | "blocked" | "unavailable";

export interface Provenance {
  provider: string;
  providerTimestamp: string;
  retrievedAt: string;
  sessionLabel: MarketSessionLabel;
  entitlement: "real_time" | "delayed" | "end_of_day" | "unknown";
  policyStatus: MarketDataPolicyStatus;
  rawField: string;
  sourceUrls: readonly string[];
  providerIdentifiers: readonly string[];
}

export interface MarketValue extends Provenance {
  symbol: string;
  value: number;
  unit: "USD" | "shares" | "percent" | "ratio";
}

export interface MarketSnapshot {
  symbol: string;
  price?: MarketValue;
  priorClose?: MarketValue;
  bid?: MarketValue;
  ask?: MarketValue;
  volume?: MarketValue;
}

export interface MarketBar extends Provenance {
  symbol: string;
  timestamp: string;
  interval: "5m" | "15m" | "60m" | "1d" | "1w";
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface CorporateAction {
  actionId: string;
  symbol: string;
  kind: "dividend" | "split" | "offering" | "other";
  effectiveAt: string;
  detail: string;
  sourceUrl: string;
  provenance: Provenance;
}

export interface SessionStatus {
  date: string;
  timezone: string;
  status: "OPEN" | "EARLY_CLOSE" | "CLOSED" | "UNKNOWN";
  calendarVersion: string;
  sourceUrl: string;
}

export interface MarketMover {
  symbol: string;
  snapshot: MarketSnapshot;
  averageDailyDollarVolume?: MarketValue;
  premarketDollarVolume?: MarketValue;
  catalystSourceIds: string[];
}

export interface MarketDataProvider {
  readonly id: string;
  readonly policyStatus: MarketDataPolicyStatus;
  getSessionStatus(date: string, timezone: string, signal?: AbortSignal): Promise<SessionStatus>;
  getSnapshots(symbols: readonly string[], signal?: AbortSignal): Promise<MarketSnapshot[]>;
  getBars(
    symbol: string,
    interval: MarketBar["interval"],
    start: string,
    end: string,
    includeExtendedHours: boolean,
    signal?: AbortSignal,
  ): Promise<MarketBar[]>;
  getCorporateActions(symbol: string, start: string, end: string, signal?: AbortSignal): Promise<CorporateAction[]>;
  getMarketMovers(signal?: AbortSignal): Promise<MarketMover[]>;
}

export class DisabledMarketDataProvider implements MarketDataProvider {
  readonly id = "not_configured";
  readonly policyStatus = "unavailable" as const;

  private unavailable(): never {
    throw new Error("market_data_not_configured");
  }

  getSessionStatus(): Promise<SessionStatus> { return Promise.reject(this.unavailable()); }
  getSnapshots(): Promise<MarketSnapshot[]> { return Promise.reject(this.unavailable()); }
  getBars(): Promise<MarketBar[]> { return Promise.reject(this.unavailable()); }
  getCorporateActions(): Promise<CorporateAction[]> { return Promise.reject(this.unavailable()); }
  getMarketMovers(): Promise<MarketMover[]> { return Promise.reject(this.unavailable()); }
}

const marketResearchIdSchema = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9:._-]+$/);
const marketResearchSymbolSchema = z.string().trim().min(1).max(20).regex(/^[A-Z0-9.^=-]+$/);
const marketSessionLabelSchema = z.enum(["premarket", "regular", "after_hours", "closed", "unknown"]);
const marketEntitlementSchema = z.enum(["real_time", "delayed", "end_of_day", "unknown"]);
const approvedProvenanceSchema = z.object({
  provider: z.string().trim().min(1).max(100),
  providerTimestamp: z.iso.datetime({ offset: true }),
  retrievedAt: z.iso.datetime({ offset: true }),
  sessionLabel: marketSessionLabelSchema,
  entitlement: marketEntitlementSchema,
  policyStatus: z.literal("approved"),
  rawField: z.string().trim().min(1).max(100),
  sourceUrls: z.array(z.url().max(2_000)).min(1).max(10),
  providerIdentifiers: z.array(marketResearchIdSchema).min(1).max(20),
}).strict();
const marketValueSchema = approvedProvenanceSchema.extend({
  symbol: marketResearchSymbolSchema,
  value: z.number().finite(),
  unit: z.enum(["USD", "shares", "percent", "ratio"]),
}).strict();
const marketSnapshotSchema = z.object({
  symbol: marketResearchSymbolSchema,
  price: marketValueSchema.optional(),
  priorClose: marketValueSchema.optional(),
  bid: marketValueSchema.optional(),
  ask: marketValueSchema.optional(),
  volume: marketValueSchema.optional(),
}).strict();
const marketSessionStatusSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().trim().min(1).max(100),
  status: z.enum(["OPEN", "EARLY_CLOSE", "CLOSED", "UNKNOWN"]),
  calendarVersion: marketResearchIdSchema,
  sourceUrl: z.url().max(2_000),
}).strict();
const marketBarSchema = approvedProvenanceSchema.extend({
  symbol: marketResearchSymbolSchema,
  timestamp: z.iso.datetime({ offset: true }),
  interval: z.enum(["5m", "15m", "60m", "1d", "1w"]),
  open: z.number().finite().positive(),
  high: z.number().finite().positive(),
  low: z.number().finite().positive(),
  close: z.number().finite().positive(),
  volume: z.number().finite().nonnegative().optional(),
}).strict();

function validateSnapshotValue(
  value: unknown,
  expectedSymbol: string,
  field: "price" | "priorClose" | "bid" | "ask" | "volume",
): MarketValue {
  const parsed = marketValueSchema.safeParse(value);
  if (!parsed.success || parsed.data.symbol !== expectedSymbol) throw new Error("market_data_conflict");
  const volume = field === "volume";
  if (
    (volume ? parsed.data.value < 0 : parsed.data.value <= 0)
    || parsed.data.unit !== (volume ? "shares" : "USD")
  ) {
    throw new Error("market_data_conflict");
  }
  let sourceUrls: string[];
  try {
    sourceUrls = parsed.data.sourceUrls.map(canonicalSourceUrl);
  } catch {
    throw new Error("market_data_conflict");
  }
  return { ...parsed.data, sourceUrls };
}

export function validateSessionStatus(
  value: unknown,
  expected: Pick<SessionStatus, "date" | "timezone">,
): SessionStatus {
  const parsed = marketSessionStatusSchema.safeParse(value);
  if (
    !parsed.success
    || parsed.data.date !== expected.date
    || parsed.data.timezone !== expected.timezone
  ) {
    throw new Error("market_data_conflict");
  }
  let sourceUrl: string;
  try {
    sourceUrl = canonicalSourceUrl(parsed.data.sourceUrl);
  } catch {
    throw new Error("market_data_conflict");
  }
  return { ...parsed.data, sourceUrl };
}

export function validateSnapshots(
  snapshots: unknown,
  expectedSymbols: readonly string[],
): MarketSnapshot[] {
  const parsedExpected = z.array(marketResearchSymbolSchema).max(100).safeParse(expectedSymbols);
  const parsedSnapshots = z.array(marketSnapshotSchema).max(100).safeParse(snapshots);
  if (!parsedExpected.success || !parsedSnapshots.success) throw new Error("market_data_conflict");
  const expected = new Set(parsedExpected.data);
  if (expected.size !== parsedExpected.data.length) throw new Error("market_data_conflict");
  const seen = new Set<string>();
  const validated: MarketSnapshot[] = [];
  for (const snapshot of parsedSnapshots.data) {
    if (
      !expected.has(snapshot.symbol)
      || seen.has(snapshot.symbol)
    ) {
      throw new Error("market_data_conflict");
    }
    seen.add(snapshot.symbol);
    const fields = [snapshot.price, snapshot.priorClose, snapshot.bid, snapshot.ask, snapshot.volume];
    if (fields.every((field) => field === undefined)) throw new Error("market_data_unavailable");
    const result: MarketSnapshot = { symbol: snapshot.symbol };
    if (snapshot.price !== undefined) result.price = validateSnapshotValue(snapshot.price, snapshot.symbol, "price");
    if (snapshot.priorClose !== undefined) {
      result.priorClose = validateSnapshotValue(snapshot.priorClose, snapshot.symbol, "priorClose");
    }
    if (snapshot.bid !== undefined) result.bid = validateSnapshotValue(snapshot.bid, snapshot.symbol, "bid");
    if (snapshot.ask !== undefined) result.ask = validateSnapshotValue(snapshot.ask, snapshot.symbol, "ask");
    if (snapshot.volume !== undefined) result.volume = validateSnapshotValue(snapshot.volume, snapshot.symbol, "volume");
    validated.push(result);
  }
  if (seen.size !== expected.size) throw new Error("market_data_unavailable");
  return validated;
}

export function validateBars(
  bars: unknown,
  expected: Pick<MarketBar, "symbol" | "interval"> & { allowedSessions?: readonly MarketSessionLabel[] },
): MarketBar[] {
  const parsed = z.array(marketBarSchema).max(100_000).safeParse(bars);
  if (!parsed.success) throw new Error("market_data_conflict");
  const result: MarketBar[] = [];
  let previousTimestamp = -1;
  for (const bar of parsed.data) {
    const timestamp = Date.parse(bar.timestamp);
    if (
      bar.symbol !== expected.symbol
      || bar.interval !== expected.interval
      || timestamp <= previousTimestamp
      || bar.high < Math.max(bar.open, bar.close)
      || bar.low > Math.min(bar.open, bar.close)
      || bar.high < bar.low
      || (expected.allowedSessions !== undefined && !expected.allowedSessions.includes(bar.sessionLabel))
    ) throw new Error("market_data_conflict");
    previousTimestamp = timestamp;
    let sourceUrls: string[];
    try {
      sourceUrls = bar.sourceUrls.map(canonicalSourceUrl);
    } catch {
      throw new Error("market_data_conflict");
    }
    const { volume, ...required } = bar;
    const validated: MarketBar = { ...required, sourceUrls };
    if (volume !== undefined) validated.volume = volume;
    result.push(validated);
  }
  return result;
}

export function quoteConflict(
  observations: readonly MarketValue[],
  maximumRelativeDifference = 0.002,
): boolean {
  if (observations.length < 2) return false;
  const sorted = [...observations].sort((left, right) => left.value - right.value);
  const low = sorted[0]?.value;
  const high = sorted.at(-1)?.value;
  if (low === undefined || high === undefined || low <= 0) return true;
  return (high - low) / low > maximumRelativeDifference
    || new Set(observations.map((observation) => observation.sessionLabel)).size > 1;
}
