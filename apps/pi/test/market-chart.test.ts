import { describe, expect, it } from "vitest";
import {
  marketChartFromPublicData,
  marketChartSpecSchema,
  MAX_MARKET_CHART_POINTS,
  tradingViewSymbolFromPublicData,
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

  it("builds a provider request from public listing metadata", () => {
    expect(
      marketChartFromPublicData(
        {
          symbol: "AMD",
          meta: {
            symbol: "AMD",
            exchangeName: "NMS",
            instrumentType: "EQUITY",
          },
          timestamps: [100, 200, 300],
          quotes: { close: [10, 12, 11] },
        },
        { style: "candle", includeVolume: true },
      ),
    ).toEqual({
      symbol: "AMD",
      title: "AMD market chart",
      points: [
        { timestamp: 100, close: 10 },
        { timestamp: 200, close: 12 },
        { timestamp: 300, close: 11 },
      ],
      tradingViewSymbol: "NASDAQ:AMD",
      interval: "1D",
      style: "candle",
      includeVolume: true,
    });
  });

  it("uses a requested range without also setting an interval", () => {
    const result = marketChartFromPublicData(
      {
        symbol: "SPY",
        meta: {
          symbol: "SPY",
          exchangeName: "PCX",
          instrumentType: "ETF",
        },
        timestamps: [100, 200],
        quotes: { close: [500, 505] },
      },
      { range: "3M", style: "area" },
    );

    expect(result).toMatchObject({
      tradingViewSymbol: "AMEX:SPY",
      range: "3M",
      style: "area",
    });
    expect(result).not.toHaveProperty("interval");
  });

  it("rejects interval and range together because range overrides interval", () => {
    expect(
      marketChartFromPublicData(
        {
          symbol: "AMD",
          meta: {
            symbol: "AMD",
            exchangeName: "NMS",
            instrumentType: "EQUITY",
          },
          timestamps: [100, 200],
          quotes: { close: [10, 12] },
        },
        { interval: "1D", range: "1M" },
      ),
    ).toBeUndefined();

    expect(
      marketChartSpecSchema.safeParse({
        symbol: "AMD",
        points: [
          { timestamp: 100, close: 10 },
          { timestamp: 200, close: 12 },
        ],
        tradingViewSymbol: "NASDAQ:AMD",
        interval: "1D",
        range: "1M",
      }).success,
    ).toBe(false);
  });

  it.each([
    ["GC=F", {}, "COMEX:GC1!"],
    ["^GSPC", {}, "SP:SPX"],
    ["BTC-USD", {}, "COINBASE:BTCUSD"],
    ["EURUSD=X", {}, "FX:EURUSD"],
    [
      "BRK-B",
      { symbol: "BRK-B", exchangeName: "NYQ", instrumentType: "EQUITY" },
      "NYSE:BRK.B",
    ],
  ])("maps Yahoo symbol %s to %s", (symbol, meta, expected) => {
    expect(
      tradingViewSymbolFromPublicData({
        symbol,
        meta,
        timestamps: [],
        quotes: {},
      }),
    ).toBe(expected);
  });

  it("declines unknown mappings instead of guessing an exchange", () => {
    const source = {
      symbol: "UNKNOWN",
      meta: {
        symbol: "UNKNOWN",
        exchangeName: "MYSTERY",
        instrumentType: "EQUITY",
      },
      timestamps: [100, 200],
      quotes: { close: [10, 12] },
    };

    expect(tradingViewSymbolFromPublicData(source)).toBeUndefined();
    expect(marketChartFromPublicData(source, {})).toBeUndefined();
  });
});
