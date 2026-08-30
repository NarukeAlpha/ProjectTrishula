import { z } from "zod";

export const MAX_MARKET_CHART_POINTS = 240;

const marketChartPointSchema = z
  .object({
    timestamp: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    close: z
      .number()
      .nonnegative()
      .refine(Number.isFinite, "Finite close required."),
  })
  .strict();

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
  });

export type MarketChartSpec = z.infer<typeof marketChartSpecSchema>;

export interface PublicMarketChartSource {
  symbol: string;
  timestamps: readonly number[];
  quotes: {
    close?: readonly (number | null)[] | undefined;
  };
}

export function marketChartFromPublicData(
  source: PublicMarketChartSource,
): MarketChartSpec | undefined {
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
  const bounded = points.slice(-MAX_MARKET_CHART_POINTS);
  const result = marketChartSpecSchema.safeParse({
    symbol: source.symbol,
    title: `${source.symbol.toUpperCase()} close price`,
    points: bounded,
  });
  return result.success ? result.data : undefined;
}
