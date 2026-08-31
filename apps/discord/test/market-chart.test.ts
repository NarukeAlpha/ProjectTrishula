import { describe, expect, it, vi } from "vitest";
import {
  ChartImageError,
  ChartImgClient,
  CHART_IMG_ENDPOINT,
  requestBody,
} from "../src/media/chart-img.js";
import { marketChartSpecSchema } from "../src/media/market-chart.js";

const chart = {
  symbol: "GC=F",
  title: "Gold futures",
  points: [
    { timestamp: 1_787_875_200, close: 4_500.2 },
    { timestamp: 1_787_961_600, close: 4_471.8 },
  ],
  tradingViewSymbol: "COMEX:GC1!",
  interval: "1D" as const,
  style: "candle" as const,
  includeVolume: true,
};

function png(width = 800, height = 600): Buffer {
  const image = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(image);
  Buffer.from("IHDR", "ascii").copy(image, 12);
  image.writeUInt32BE(width, 16);
  image.writeUInt32BE(height, 20);
  return image;
}

function pngResponse(
  image: Buffer = png(),
  headers: Record<string, string> = {},
): Response {
  return new Response(image, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": String(image.length),
      ...headers,
    },
  });
}

describe("CHART-IMG market charts", () => {
  it("keeps legacy chart rows valid but requires provider options to be trusted", () => {
    expect(
      marketChartSpecSchema.safeParse({
        symbol: "AMD",
        points: [
          { timestamp: 100, close: 10 },
          { timestamp: 200, close: 12 },
        ],
      }).success,
    ).toBe(true);
    expect(
      marketChartSpecSchema.safeParse({
        ...chart,
        tradingViewSymbol: undefined,
      }).success,
    ).toBe(false);
    expect(
      marketChartSpecSchema.safeParse({
        ...chart,
        range: "1M",
      }).success,
    ).toBe(false);
  });

  it("uses one direct authenticated request and caches its bounded PNG", async () => {
    let capturedUrl: string | URL | Request | undefined;
    let capturedInit: RequestInit | undefined;
    const request = vi.fn(
      async (
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        capturedUrl = input;
        capturedInit = init;
        return pngResponse();
      },
    );
    const client = new ChartImgClient({
      apiKey: "test-chart-img-key-with-safe-length",
      timeoutMs: 5_000,
      fetch: request,
    });

    const first = await client.render(chart);
    const second = await client.render(chart);

    expect(request).toHaveBeenCalledOnce();
    expect(capturedUrl).toBe(CHART_IMG_ENDPOINT);
    expect(capturedInit).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "x-api-key": "test-chart-img-key-with-safe-length",
      },
    });
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      symbol: "COMEX:GC1!",
      interval: "1D",
      width: 800,
      height: 600,
      style: "candle",
      theme: "dark",
      format: "png",
      studies: [{ name: "Volume" }],
    });
    expect(String(capturedUrl)).not.toContain("test-chart-img-key");
    expect(first).toMatchObject({
      name: "gc-f-chart.png",
      description: "Gold futures",
      contentType: "image/png",
    });
    expect(first.attachment.equals(second.attachment)).toBe(true);
    expect(first.attachment).not.toBe(second.attachment);
  });

  it("lets a range select the provider interval instead of sending both", () => {
    expect(
      requestBody({
        ...chart,
        interval: undefined,
        range: "3M",
        style: "line",
        includeVolume: false,
      }),
    ).toMatchObject({
      symbol: "COMEX:GC1!",
      range: "3M",
      style: "line",
      studies: [],
    });
    expect(
      requestBody({
        ...chart,
        interval: undefined,
        range: "3M",
      }),
    ).not.toHaveProperty("interval");
  });

  it("rejects provider errors, oversized bodies, and invalid PNG data", async () => {
    const cases: Array<{
      response: Response;
      code: ChartImageError["code"];
    }> = [
      {
        response: new Response('{"message":"denied"}', {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
        code: "provider_http_error",
      },
      {
        response: pngResponse(png(), {
          "content-length": String(9 * 1_024 * 1_024),
        }),
        code: "provider_response_too_large",
      },
      {
        response: pngResponse(Buffer.from("not a png")),
        code: "provider_response_invalid",
      },
      {
        response: pngResponse(png(801, 600)),
        code: "provider_response_invalid",
      },
    ];

    for (const testCase of cases) {
      const client = new ChartImgClient({
        apiKey: "test-chart-img-key-with-safe-length",
        timeoutMs: 5_000,
        fetch: vi.fn(async () => testCase.response),
      });
      await expect(client.render(chart)).rejects.toMatchObject({
        code: testCase.code,
      });
    }
  });
});
