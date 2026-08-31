import { z } from "zod";

export const MAX_MARKET_CHART_POINTS = 240;
export const MAX_DISCORD_GENERATED_FILE_BYTES = 8 * 1_024 * 1_024;

export const marketChartIntervalSchema = z.enum([
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
]);

export const marketChartRangeSchema = z.enum([
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
]);

export const marketChartStyleSchema = z.enum(["candle", "line", "area"]);

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

export interface RenderedMarketChart {
  attachment: Buffer;
  name: string;
  description: string;
  contentType: "image/png";
}
