import { describe, expect, it } from "vitest";
import {
  marketChartSpecSchema,
  MAX_DISCORD_GENERATED_FILE_BYTES,
  renderMarketChart,
} from "../src/media/market-chart.js";

const chart = {
  symbol: "AMD",
  title: "AMD five day close",
  points: [
    { timestamp: 1_787_875_200, close: 168.2 },
    { timestamp: 1_787_961_600, close: 171.8 },
    { timestamp: 1_788_048_000, close: 170.4 },
    { timestamp: 1_788_134_400, close: 176.05 },
  ],
};

describe("market chart rendering", () => {
  it("renders the same bounded Discord-safe PNG for the same data", () => {
    const first = renderMarketChart(chart);
    const second = renderMarketChart(chart);

    expect(first.attachment.equals(second.attachment)).toBe(true);
    expect([...first.attachment.subarray(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    expect(first.attachment.length).toBeLessThan(
      MAX_DISCORD_GENERATED_FILE_BYTES,
    );
    expect(first).toMatchObject({
      name: "amd-chart.png",
      contentType: "image/png",
      description: "AMD close-price chart",
    });
  });

  it("rejects ambiguous point order and unsafe labels", () => {
    expect(
      marketChartSpecSchema.safeParse({
        ...chart,
        points: [chart.points[1], chart.points[0]],
      }).success,
    ).toBe(false);
    expect(
      marketChartSpecSchema.safeParse({ ...chart, symbol: "AMD/../../secret" })
        .success,
    ).toBe(false);
  });
});
