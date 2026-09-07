import type { MarketBar } from "./market-data.js";
import { validateBars } from "./market-data.js";

export interface Calculation<T> {
  value: T;
  inputTimestamps: string[];
  formula: string;
}

function closes(bars: readonly MarketBar[]): number[] {
  return bars.map((bar) => bar.close);
}

export function simpleMovingAverage(bars: readonly MarketBar[], periods: number): Calculation<number> | null {
  if (!Number.isSafeInteger(periods) || periods < 1 || bars.length < periods) return null;
  const selected = bars.slice(-periods);
  return {
    value: selected.reduce((sum, bar) => sum + bar.close, 0) / periods,
    inputTimestamps: selected.map((bar) => bar.timestamp),
    formula: `SMA(${periods})=sum(close)/${periods}`,
  };
}

export function volumeWeightedAveragePrice(bars: readonly MarketBar[]): Calculation<number> | null {
  if (bars.length === 0 || bars.some((bar) => bar.volume === undefined)) return null;
  let valueVolume = 0;
  let volume = 0;
  for (const bar of bars) {
    const barVolume = bar.volume ?? 0;
    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    valueVolume += typicalPrice * barVolume;
    volume += barVolume;
  }
  if (volume <= 0) return null;
  return {
    value: valueVolume / volume,
    inputTimestamps: bars.map((bar) => bar.timestamp),
    formula: "VWAP=sum(typical_price*volume)/sum(volume)",
  };
}

export function averageTrueRange(bars: readonly MarketBar[], periods = 14): Calculation<number> | null {
  if (!Number.isSafeInteger(periods) || periods < 1 || bars.length < periods + 1) return null;
  const selected = bars.slice(-(periods + 1));
  const ranges: number[] = [];
  for (let index = 1; index < selected.length; index += 1) {
    const current = selected[index];
    const previous = selected[index - 1];
    if (!current || !previous) continue;
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    ));
  }
  return {
    value: ranges.reduce((sum, range) => sum + range, 0) / periods,
    inputTimestamps: selected.map((bar) => bar.timestamp),
    formula: `ATR(${periods})=mean(true_range)`,
  };
}

export function sessionRange(bars: readonly MarketBar[]): Calculation<{
  high: number;
  low: number;
  last: number;
  shareVolume: number | null;
  dollarVolume: number | null;
}> | null {
  if (bars.length === 0) return null;
  const high = Math.max(...bars.map((bar) => bar.high));
  const low = Math.min(...bars.map((bar) => bar.low));
  const last = bars.at(-1)?.close;
  if (last === undefined) return null;
  const completeVolume = bars.every((bar) => bar.volume !== undefined);
  const shareVolume = completeVolume ? bars.reduce((sum, bar) => sum + (bar.volume ?? 0), 0) : null;
  const dollarVolume = completeVolume
    ? bars.reduce((sum, bar) => sum + ((bar.high + bar.low + bar.close) / 3) * (bar.volume ?? 0), 0)
    : null;
  return {
    value: { high, low, last, shareVolume, dollarVolume },
    inputTimestamps: bars.map((bar) => bar.timestamp),
    formula: "session high/low/last and summed volume",
  };
}

export function linearTrendSlope(bars: readonly MarketBar[]): Calculation<number> | null {
  if (bars.length < 2) return null;
  const values = closes(bars);
  const meanX = (values.length - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    const dx = index - meanX;
    numerator += dx * ((values[index] ?? meanY) - meanY);
    denominator += dx * dx;
  }
  return {
    value: denominator === 0 ? 0 : numerator / denominator,
    inputTimestamps: bars.map((bar) => bar.timestamp),
    formula: "least_squares_slope(close,index)",
  };
}

export function distanceFromLevel(price: number, level: number, atr: number): Calculation<{
  percent: number;
  atrUnits: number;
  near: boolean;
}> {
  if (![price, level, atr].every(Number.isFinite) || price <= 0 || level <= 0 || atr <= 0) {
    throw new Error("market_data_conflict");
  }
  const absolute = Math.abs(price - level);
  return {
    value: {
      percent: absolute / level * 100,
      atrUnits: absolute / atr,
      near: absolute <= Math.min(atr * 0.5, level * 0.005),
    },
    inputTimestamps: [],
    formula: "distance=min(0.50*ATR,0.50%*level)",
  };
}

export function rewardToRisk(trigger: number, invalidation: number, target: number): number | null {
  const risk = Math.abs(trigger - invalidation);
  const reward = Math.abs(target - trigger);
  if (![risk, reward].every(Number.isFinite) || risk <= 0) return null;
  return reward / risk;
}

export interface AnalyticsBundle {
  vwap: Calculation<number> | null;
  sma20: Calculation<number> | null;
  sma50: Calculation<number> | null;
  sma200: Calculation<number> | null;
  atr14: Calculation<number> | null;
  range: ReturnType<typeof sessionRange>;
  slope: Calculation<number> | null;
}

export function calculateAnalytics(bars: readonly MarketBar[]): AnalyticsBundle {
  if (bars.length === 0) {
    return { vwap: null, sma20: null, sma50: null, sma200: null, atr14: null, range: null, slope: null };
  }
  const first = bars[0];
  if (!first) throw new Error("market_data_unavailable");
  const validated = validateBars(bars, { symbol: first.symbol, interval: first.interval });
  return {
    vwap: volumeWeightedAveragePrice(validated),
    sma20: simpleMovingAverage(validated, 20),
    sma50: simpleMovingAverage(validated, 50),
    sma200: simpleMovingAverage(validated, 200),
    atr14: averageTrueRange(validated, 14),
    range: sessionRange(validated),
    slope: linearTrendSlope(validated),
  };
}
