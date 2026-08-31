import { z } from "zod";

export const MAX_MARKET_CHART_POINTS = 240;

export const MARKET_CHART_INTERVALS = [
  "1m",
  "3m",
  "5m",
  "10m",
  "15m",
  "30m",
  "45m",
  "1h",
  "2h",
  "3h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1D",
  "2D",
  "3D",
  "1W",
  "1M",
  "3M",
  "6M",
  "1Y",
] as const;

export const marketChartIntervalSchema = z.enum(MARKET_CHART_INTERVALS);

export const MARKET_CHART_RANGES = [
  "1D",
  "5D",
  "1M",
  "3M",
  "6M",
  "1Y",
  "5Y",
  "ALL",
  "DTD",
  "WTD",
  "MTD",
  "YTD",
] as const;

export const marketChartRangeSchema = z.enum(MARKET_CHART_RANGES);

export const MARKET_CHART_STYLES = ["candle", "line", "area"] as const;

export const marketChartStyleSchema = z.enum(MARKET_CHART_STYLES);

const marketChartPointSchema = z
  .object({
    timestamp: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    close: z
      .number()
      .nonnegative()
      .refine(Number.isFinite, "Finite close required."),
  })
  .strict();

export const tradingViewSymbolSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Z0-9._!^-]{1,24}:[A-Z0-9._!^=-]{1,32}$/);

export const marketChartSpecSchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[A-Za-z0-9.^=-]+$/),
    title: z.string().trim().min(1).max(64).optional(),
    points: z
      .array(marketChartPointSchema)
      .min(2)
      .max(MAX_MARKET_CHART_POINTS),
    tradingViewSymbol: tradingViewSymbolSchema.optional(),
    interval: marketChartIntervalSchema.optional(),
    range: marketChartRangeSchema.optional(),
    style: marketChartStyleSchema.optional(),
    includeVolume: z.boolean().optional(),
  })
  .strict()
  .superRefine((chart, context) => {
    for (let index = 1; index < chart.points.length; index += 1) {
      const previous = chart.points[index - 1];
      const current = chart.points[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        current.timestamp <= previous.timestamp
      ) {
        context.addIssue({
          code: "custom",
          path: ["points", index, "timestamp"],
          message: "Chart timestamps must increase.",
        });
      }
    }
    if (chart.interval !== undefined && chart.range !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["range"],
        message: "Choose a chart interval or range, not both.",
      });
    }
    if (
      chart.tradingViewSymbol === undefined &&
      (chart.interval !== undefined ||
        chart.range !== undefined ||
        chart.style !== undefined ||
        chart.includeVolume !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["tradingViewSymbol"],
        message: "Provider chart options require a TradingView symbol.",
      });
    }
  });

export type MarketChartInterval = z.infer<typeof marketChartIntervalSchema>;
export type MarketChartRange = z.infer<typeof marketChartRangeSchema>;
export type MarketChartStyle = z.infer<typeof marketChartStyleSchema>;
export type MarketChartSpec = z.infer<typeof marketChartSpecSchema>;

export interface PublicMarketChartSource {
  symbol: string;
  meta?: {
    symbol?: string | undefined;
    exchangeName?: string | undefined;
    instrumentType?: string | undefined;
  };
  timestamps: readonly number[];
  quotes: {
    close?: readonly (number | null)[] | undefined;
  };
}

export interface GeneratedMarketChartOptions {
  interval?: MarketChartInterval | undefined;
  range?: MarketChartRange | undefined;
  style?: MarketChartStyle | undefined;
  includeVolume?: boolean | undefined;
}

interface MarketChartSpecCandidate {
  symbol: string;
  title: string;
  points: Array<{ timestamp: number; close: number }>;
  tradingViewSymbol?: string;
  interval?: MarketChartInterval;
  range?: MarketChartRange;
  style?: MarketChartStyle;
  includeVolume?: boolean;
}

const explicitTradingViewSymbols = new Map<string, string>([
  // Yahoo continuous futures to TradingView front-month continuous contracts.
  ["ES=F", "CME_MINI:ES1!"],
  ["NQ=F", "CME_MINI:NQ1!"],
  ["YM=F", "CBOT_MINI:YM1!"],
  ["RTY=F", "CME_MINI:RTY1!"],
  ["GC=F", "COMEX:GC1!"],
  ["SI=F", "COMEX:SI1!"],
  ["HG=F", "COMEX:HG1!"],
  ["CL=F", "NYMEX:CL1!"],
  ["NG=F", "NYMEX:NG1!"],
  ["RB=F", "NYMEX:RB1!"],
  ["HO=F", "NYMEX:HO1!"],
  ["ZB=F", "CBOT:ZB1!"],
  ["ZN=F", "CBOT:ZN1!"],
  ["ZF=F", "CBOT:ZF1!"],
  ["ZT=F", "CBOT:ZT1!"],
  ["ZC=F", "CBOT:ZC1!"],
  ["ZW=F", "CBOT:ZW1!"],
  ["ZS=F", "CBOT:ZS1!"],
  ["LE=F", "CME:LE1!"],
  ["HE=F", "CME:HE1!"],
  ["BTC=F", "CME:BTC1!"],
  ["ETH=F", "CME:ETH1!"],

  // Yahoo cash indices whose symbols do not map directly to TradingView.
  ["^GSPC", "SP:SPX"],
  ["^DJI", "DJ:DJI"],
  ["^IXIC", "NASDAQ:IXIC"],
  ["^NDX", "NASDAQ:NDX"],
  ["^RUT", "RUSSELL:RUT"],
  ["^VIX", "CBOE:VIX"],
  ["^NYA", "NYSE:NYA"],
  ["^FTSE", "TVC:UKX"],
  ["^N225", "TVC:NI225"],
  ["^GDAXI", "XETR:DAX"],
  ["^HSI", "TVC:HSI"],

  // Yahoo crypto pairs to liquid TradingView Coinbase spot listings.
  ["BTC-USD", "COINBASE:BTCUSD"],
  ["ETH-USD", "COINBASE:ETHUSD"],
  ["SOL-USD", "COINBASE:SOLUSD"],
  ["XRP-USD", "COINBASE:XRPUSD"],
  ["ADA-USD", "COINBASE:ADAUSD"],
  ["DOGE-USD", "COINBASE:DOGEUSD"],
  ["AVAX-USD", "COINBASE:AVAXUSD"],
  ["LINK-USD", "COINBASE:LINKUSD"],
  ["LTC-USD", "COINBASE:LTCUSD"],
  ["BCH-USD", "COINBASE:BCHUSD"],

  // Yahoo FX pairs to TradingView's composite FX listings.
  ["EURUSD=X", "FX:EURUSD"],
  ["GBPUSD=X", "FX:GBPUSD"],
  ["USDJPY=X", "FX:USDJPY"],
  ["AUDUSD=X", "FX:AUDUSD"],
  ["NZDUSD=X", "FX:NZDUSD"],
  ["USDCAD=X", "FX:USDCAD"],
  ["USDCHF=X", "FX:USDCHF"],
  ["EURGBP=X", "FX:EURGBP"],
  ["EURJPY=X", "FX:EURJPY"],
  ["GBPJPY=X", "FX:GBPJPY"],
]);

const metadataExchangePrefixes = new Map<string, string>([
  ["NMS", "NASDAQ"],
  ["NAS", "NASDAQ"],
  ["NGM", "NASDAQ"],
  ["NCM", "NASDAQ"],
  ["NASDAQ", "NASDAQ"],
  ["NYQ", "NYSE"],
  ["NYE", "NYSE"],
  ["NYSE", "NYSE"],
  ["ASE", "AMEX"],
  ["PCX", "AMEX"],
  ["AMEX", "AMEX"],
]);

function metadataListingSymbol(symbol: string): string {
  return symbol.replace(/-/g, ".");
}

export function tradingViewSymbolFromPublicData(
  source: PublicMarketChartSource,
): string | undefined {
  const yahooSymbol = source.symbol.trim().toUpperCase();
  const explicit = explicitTradingViewSymbols.get(yahooSymbol);
  if (explicit !== undefined) return explicit;

  const exchangeName = source.meta?.exchangeName?.trim().toUpperCase();
  const instrumentType = source.meta?.instrumentType?.trim().toUpperCase();
  if (
    exchangeName === undefined ||
    (instrumentType !== "EQUITY" && instrumentType !== "ETF")
  ) {
    return undefined;
  }
  const exchange = metadataExchangePrefixes.get(exchangeName);
  if (exchange === undefined) return undefined;
  const listingSymbol = metadataListingSymbol(
    (source.meta?.symbol ?? yahooSymbol).trim().toUpperCase(),
  );
  const candidate = `${exchange}:${listingSymbol}`;
  const parsed = tradingViewSymbolSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function marketChartPointsFromPublicData(
  source: PublicMarketChartSource,
): Array<{ timestamp: number; close: number }> {
  const closes = source.quotes.close ?? [];
  const points: Array<{ timestamp: number; close: number }> = [];
  const length = Math.min(source.timestamps.length, closes.length);
  for (let index = 0; index < length; index += 1) {
    const timestamp = source.timestamps[index];
    const close = closes[index];
    if (
      timestamp === undefined ||
      close === undefined ||
      close === null ||
      !Number.isSafeInteger(timestamp) ||
      timestamp < 0 ||
      !Number.isFinite(close) ||
      close < 0
    ) {
      continue;
    }
    const previous = points.at(-1);
    if (previous !== undefined && timestamp <= previous.timestamp) continue;
    points.push({ timestamp, close });
  }
  return points.slice(-MAX_MARKET_CHART_POINTS);
}

export function marketChartFromPublicData(
  source: PublicMarketChartSource,
  options?: GeneratedMarketChartOptions,
): MarketChartSpec | undefined {
  const generated = options !== undefined;
  const tradingViewSymbol = generated
    ? tradingViewSymbolFromPublicData(source)
    : undefined;
  if (generated && tradingViewSymbol === undefined) return undefined;
  if (options?.interval !== undefined && options.range !== undefined) {
    return undefined;
  }

  const candidate: MarketChartSpecCandidate = {
    symbol: source.symbol,
    title: generated
      ? `${source.symbol.toUpperCase()} market chart`
      : `${source.symbol.toUpperCase()} close price`,
    points: marketChartPointsFromPublicData(source),
  };
  if (tradingViewSymbol !== undefined) {
    candidate.tradingViewSymbol = tradingViewSymbol;
  }
  if (options?.range !== undefined) candidate.range = options.range;
  else if (generated) candidate.interval = options?.interval ?? "1D";
  if (options?.style !== undefined) candidate.style = options.style;
  if (options?.includeVolume !== undefined) {
    candidate.includeVolume = options.includeVolume;
  }

  const result = marketChartSpecSchema.safeParse(candidate);
  return result.success ? result.data : undefined;
}
