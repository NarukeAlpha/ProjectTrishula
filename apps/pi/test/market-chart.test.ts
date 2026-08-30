import { describe, expect, it } from "vitest";
import {
  marketChartFromPublicData,
  marketChartSpecSchema,
  MAX_MARKET_CHART_POINTS,
} from "../src/discord/market-chart.js";

describe("verified market chart specifications", () => {
  it("pairs tool-returned timestamps and closes without inventing points", () => {
    expect(
      marketChartFromPublicData({
        symbol: "AMD",
        timestamps: [100, 200, 300, 400],
        quotes: { close: [10, null, 12.5, 13] },
      }),
    ).toEqual({
      symbol: "AMD",
      title: "AMD close price",
      points: [
        { timestamp: 100, close: 10 },
        { timestamp: 300, close: 12.5 },
        { timestamp: 400, close: 13 },
      ],
    });
  });

  it("keeps only the newest bounded points", () => {
    const timestamps = Array.from(
      { length: MAX_MARKET_CHART_POINTS + 20 },
      (_, index) => index + 1,
    );
    const result = marketChartFromPublicData({
      symbol: "SPY",
      timestamps,
      quotes: { close: timestamps.map((value) => value / 10) },
    });

    expect(result?.points).toHaveLength(MAX_MARKET_CHART_POINTS);
    expect(result?.points[0]?.timestamp).toBe(21);
    expect(marketChartSpecSchema.safeParse(result).success).toBe(true);
  });

  it("declines incomplete data instead of fabricating a chart", () => {
    expect(
      marketChartFromPublicData({
        symbol: "AMD",
        timestamps: [100],
        quotes: { close: [10] },
      }),
    ).toBeUndefined();
  });
});
