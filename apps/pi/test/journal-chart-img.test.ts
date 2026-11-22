import { describe, expect, it, vi } from "vitest";
import {
  CHART_IMG_ADVANCED_ENDPOINT,
  CHART_IMG_LAYOUT_ENDPOINT_PREFIX,
  ChartImgProvider,
  ChartProviderError,
  buildAdvancedChartPayload,
  normalizeTradingViewSymbol,
} from "../src/journal/charts/index.js";

function makePngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function makeJpegBytes(width: number, height: number): Uint8Array {
  // Minimal SOI + SOF0 segment with height/width + EOI
  const bytes = new Uint8Array(15);
  bytes[0] = 0xff;
  bytes[1] = 0xd8; // SOI
  bytes[2] = 0xff;
  bytes[3] = 0xc0; // SOF0
  bytes[4] = 0x00;
  bytes[5] = 0x09; // length = 9
  bytes[6] = 0x08; // precision
  bytes[7] = (height >> 8) & 0xff;
  bytes[8] = height & 0xff;
  bytes[9] = (width >> 8) & 0xff;
  bytes[10] = width & 0xff;
  bytes[11] = 0x03; // components
  bytes[12] = 0x01;
  bytes[13] = 0xff;
  bytes[14] = 0xd9; // EOI
  return bytes;
}

function imageResponse(bytes: Uint8Array, contentType: string): Response {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Response(new Blob([buffer], { type: contentType }), {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(bytes.byteLength),
    },
  });
}

function stalledImageResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Emit partial PNG header then stall indefinitely without closing.
      controller.enqueue(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

describe("ChartImgProvider", () => {
  it("normalizes bare tickers and preserves explicit exchange prefixes", () => {
    expect(normalizeTradingViewSymbol("qqq")).toBe("NASDAQ:QQQ");
    expect(normalizeTradingViewSymbol("spy")).toBe("AMEX:SPY");
    expect(normalizeTradingViewSymbol("spx")).toBe("SP:SPX");
    expect(normalizeTradingViewSymbol("nvda")).toBe("NASDAQ:NVDA");
    expect(normalizeTradingViewSymbol("nyse:jpm")).toBe("NYSE:JPM");
    expect(normalizeTradingViewSymbol("customtkr")).toBe("CUSTOMTKR");
  });

  it("sizes studies per CHART_IMG_PLAN (basic=3, pro=5 default, mega/ultra=full stack with VWMA in_0)", () => {
    const basicPayload = buildAdvancedChartPayload({ symbol: "QQQ", interval: "5m" }, "basic");
    expect(basicPayload.studies).toEqual([
      { name: "Volume" },
      { name: "VWAP", override: { "VWAP.color": "#FFEB3B", "VWAP.linewidth": 2 } },
      { name: "Relative Strength Index", input: { length: 14, smoothingLine: "SMA", smoothingLength: 14 } },
    ]);

    const proIntraday = buildAdvancedChartPayload({
      symbol: "QQQ",
      interval: "5m",
      from: "2026-04-15T13:30:00Z",
      to: "2026-04-15T20:00:00Z",
      session: "regular",
    });
    expect(proIntraday.symbol).toBe("NASDAQ:QQQ");
    expect(proIntraday.interval).toBe("5m");
    expect(proIntraday.width).toBe(1_200);
    expect(proIntraday.height).toBe(750);
    expect(proIntraday.theme).toBe("dark");
    expect(proIntraday.timezone).toBe("America/New_York");
    expect(proIntraday.session).toBe("regular");
    expect(proIntraday.format).toBe("png");
    expect(proIntraday.range).toEqual({
      from: "2026-04-15T13:30:00.000Z",
      to: "2026-04-15T20:00:00.000Z",
    });
    expect(proIntraday.studies).toEqual([
      { name: "Volume" },
      { name: "Moving Average", input: { length: 9 }, override: { "Plot.color": "#BA68C8", "Plot.linewidth": 1 } },
      { name: "Moving Average", input: { length: 20 }, override: { "Plot.color": "#4DD0E1", "Plot.linewidth": 1 } },
      { name: "VWAP", override: { "VWAP.color": "#FFEB3B", "VWAP.linewidth": 2 } },
      { name: "Relative Strength Index", input: { length: 14, smoothingLine: "SMA", smoothingLength: 14 } },
    ]);

    const proSpot = buildAdvancedChartPayload({ symbol: "NVDA", interval: "1D" }, "pro");
    expect(proSpot.studies).toHaveLength(5);
    expect(proSpot.studies.map((study) => study.name)).toEqual([
      "Volume",
      "Moving Average",
      "Moving Average",
      "Moving Average",
      "Relative Strength Index",
    ]);

    const megaIntraday = buildAdvancedChartPayload({ symbol: "QQQ", interval: "5m" }, "mega");
    expect(megaIntraday.studies).toEqual([
      { name: "Volume" },
      { name: "Moving Average", input: { length: 9 }, override: { "Plot.color": "#BA68C8", "Plot.linewidth": 1 } },
      { name: "Moving Average", input: { length: 20 }, override: { "Plot.color": "#4DD0E1", "Plot.linewidth": 1 } },
      { name: "Moving Average", input: { length: 50 }, override: { "Plot.color": "#D32F2F", "Plot.linewidth": 2 } },
      { name: "VWMA", input: { in_0: 90 }, override: { "Plot.color": "#FBC02D", "Plot.linewidth": 1 } },
      { name: "VWMA", input: { in_0: 180 }, override: { "Plot.color": "#FF5252", "Plot.linewidth": 2 } },
      { name: "VWAP", override: { "VWAP.color": "#FFEB3B", "VWAP.linewidth": 2 } },
      { name: "Relative Strength Index", input: { length: 14, smoothingLine: "SMA", smoothingLength: 14 } },
      { name: "Volume Profile Visible Range" },
    ]);

    const ultraSpot = buildAdvancedChartPayload({ symbol: "NASDAQ:NVDA", interval: "1D" }, "ultra");
    expect(ultraSpot.studies.map((study) => study.name)).toEqual([
      "Volume",
      "Moving Average",
      "Moving Average",
      "Moving Average",
      "VWMA",
      "VWMA",
      "Relative Strength Index",
    ]);
  });

  it("enforces paired from/to, 400x300 minimum dimensions, and routes dated captures to Advanced Chart", async () => {
    const fetchSpy = vi.fn<typeof fetch>()
      .mockResolvedValue(imageResponse(makePngBytes(1_200, 750), "image/png"));

    const provider = new ChartImgProvider({
      apiKey: "test-chart-img-key",
      fetch: fetchSpy,
      rateLimitMs: 0,
    });

    await expect(
      provider.captureChart({ symbol: "QQQ", interval: "5m", from: "2026-04-15T13:30:00Z" }),
    ).rejects.toMatchObject({ code: "chart_invalid_request" });

    await expect(
      provider.captureChart({ symbol: "QQQ", interval: "5m", to: "2026-04-15T20:00:00Z" }),
    ).rejects.toMatchObject({ code: "chart_invalid_request" });

    await expect(
      provider.captureChart({ symbol: "QQQ", interval: "5m", width: 399, height: 300 }),
    ).rejects.toMatchObject({ code: "chart_invalid_request" });

    await expect(
      provider.captureChart({
        symbol: "QQQ",
        interval: "5m",
        useSavedLayout: true,
        layoutId: "myLayout_123",
        width: 400,
        height: 299,
      }),
    ).rejects.toMatchObject({ code: "chart_invalid_request" });

    // Dated historical capture with useSavedLayout=true MUST route to Advanced Chart (not Shared Layout)
    await provider.captureChart({
      symbol: "SPX",
      interval: "5m",
      useSavedLayout: true,
      layoutId: "myLayout_123",
      from: "2026-04-15T13:30:00Z",
      to: "2026-04-15T16:00:00Z",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const datedCall = fetchSpy.mock.calls[0];
    expect(datedCall?.[0]).toBe(CHART_IMG_ADVANCED_ENDPOINT);
    expect(JSON.parse(String(datedCall?.[1]?.body))).toMatchObject({
      symbol: "SP:SPX",
      range: {
        from: "2026-04-15T13:30:00.000Z",
        to: "2026-04-15T16:00:00.000Z",
      },
    });
  });

  it("captures PNG and JPEG charts via the Advanced Chart endpoint with redirect: error", async () => {
    const fetchSpy = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(imageResponse(makePngBytes(1_200, 750), "image/png"))
      .mockResolvedValueOnce(imageResponse(makeJpegBytes(1_000, 625), "image/jpeg"));

    const provider = new ChartImgProvider({
      apiKey: "test-chart-img-key",
      fetch: fetchSpy,
      rateLimitMs: 0,
    });

    expect(provider.isConfigured()).toBe(true);

    const png = await provider.captureChart({ symbol: "SPY", interval: "1m" });
    expect(png.mimeType).toBe("image/png");
    expect(png.width).toBe(1_200);
    expect(png.height).toBe(750);
    expect(png.symbol).toBe("AMEX:SPY");
    expect(png.interval).toBe("1m");
    expect(png.source).toBe("chart_img");

    const jpeg = await provider.captureChart({
      symbol: "NASDAQ:NVDA",
      interval: "1D",
      format: "jpeg",
      width: 1_000,
      height: 625,
    });
    expect(jpeg.mimeType).toBe("image/jpeg");
    expect(jpeg.width).toBe(1_000);
    expect(jpeg.height).toBe(625);

    const firstCall = fetchSpy.mock.calls[0];
    expect(firstCall?.[0]).toBe(CHART_IMG_ADVANCED_ENDPOINT);
    expect(firstCall?.[1]?.redirect).toBe("error");
    expect(firstCall?.[1]?.headers).toMatchObject({
      "content-type": "application/json",
      "x-api-key": "test-chart-img-key",
    });
  });

  it("uses the saved TradingView layout endpoint when useSavedLayout is true without a historical range", async () => {
    const fetchSpy = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(imageResponse(makePngBytes(1_200, 750), "image/png"));

    const provider = new ChartImgProvider({
      apiKey: "test-chart-img-key",
      fetch: fetchSpy,
      rateLimitMs: 0,
    });

    const chart = await provider.captureChart({
      symbol: "SPX",
      interval: "5m",
      useSavedLayout: true,
      layoutId: "myLayout_123",
    });

    expect(chart.symbol).toBe("SP:SPX");
    const call = fetchSpy.mock.calls[0];
    expect(call?.[0]).toBe(`${CHART_IMG_LAYOUT_ENDPOINT_PREFIX}myLayout_123`);
    const parsedBody = JSON.parse(String(call?.[1]?.body));
    expect(parsedBody).toEqual({
      symbol: "SP:SPX",
      interval: "5m",
      width: 1_200,
      height: 750,
      format: "png",
    });
  });

  it("enforces >= 1000ms rate-limit spacing between sequential requests", async () => {
    let clock = 10_000;
    const sleeps: number[] = [];
    const fetchSpy = vi.fn<typeof fetch>()
      .mockImplementation(async () => imageResponse(makePngBytes(1_200, 750), "image/png"));

    const provider = new ChartImgProvider({
      apiKey: "test-chart-img-key",
      fetch: fetchSpy,
      rateLimitMs: 1_000,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });

    await Promise.all([
      provider.captureChart({ symbol: "QQQ", interval: "1m" }),
      provider.captureChart({ symbol: "QQQ", interval: "5m" }),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([1_000]);
  });

  it("times out cleanly when a response body stalls after headers arrive", async () => {
    const provider = new ChartImgProvider({
      apiKey: "test-chart-img-key",
      timeoutMs: 40,
      rateLimitMs: 0,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(stalledImageResponse()),
    });

    await expect(
      provider.captureChart({ symbol: "QQQ", interval: "5m" }),
    ).rejects.toMatchObject({
      name: "ChartProviderError",
      code: "chart_provider_timeout",
    });
  });

  it("aborts a caller waiting in the serial queue immediately without waiting for an earlier stalled request", async () => {
    let releaseFirst: (() => void) | undefined;
    const fetchSpy = vi.fn<typeof fetch>()
      .mockImplementationOnce(
        async () =>
          new Promise<Response>((resolve) => {
            releaseFirst = () => resolve(imageResponse(makePngBytes(1_200, 750), "image/png"));
          }),
      )
      .mockResolvedValueOnce(imageResponse(makePngBytes(1_200, 750), "image/png"));

    const provider = new ChartImgProvider({
      apiKey: "test-chart-img-key",
      rateLimitMs: 0,
      fetch: fetchSpy,
    });

    const firstPromise = provider.captureChart({ symbol: "QQQ", interval: "1m" });
    const queuedAbort = new AbortController();
    const secondPromise = provider.captureChart(
      { symbol: "SPY", interval: "5m" },
      queuedAbort.signal,
    );
    const thirdPromise = provider.captureChart({ symbol: "NVDA", interval: "15m" });

    queuedAbort.abort(new Error("journal_run_canceled"));

    // Second request must reject immediately while first request is still blocked
    await expect(secondPromise).rejects.toMatchObject({
      name: "ChartProviderError",
      code: "chart_provider_aborted",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Releasing the first request allows the third queued request to proceed cleanly
    releaseFirst?.();
    const [first, third] = await Promise.all([firstPromise, thirdPromise]);
    expect(first.symbol).toBe("NASDAQ:QQQ");
    expect(third.symbol).toBe("NASDAQ:NVDA");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("returns typed errors for missing key, HTTP errors (with bounded error body), corrupt magic bytes, oversized images, and redirects", async () => {
    const unconfigured = new ChartImgProvider({});
    expect(unconfigured.isConfigured()).toBe(false);
    await expect(
      unconfigured.captureChart({ symbol: "QQQ", interval: "5m" }),
    ).rejects.toMatchObject({
      name: "ChartProviderError",
      code: "chart_provider_unconfigured",
    });

    const httpErrorProvider = new ChartImgProvider({
      apiKey: "test-key",
      rateLimitMs: 0,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("rate limit exceeded", { status: 429 }),
      ),
    });
    await expect(
      httpErrorProvider.captureChart({ symbol: "QQQ", interval: "5m" }),
    ).rejects.toMatchObject({
      code: "chart_provider_http_error",
      status: 429,
    });

    const oversizedErrorBodyProvider = new ChartImgProvider({
      apiKey: "test-key",
      rateLimitMs: 0,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("x".repeat(16_384), { status: 502 }),
      ),
    });
    await expect(
      oversizedErrorBodyProvider.captureChart({ symbol: "QQQ", interval: "5m" }),
    ).rejects.toMatchObject({
      code: "chart_provider_http_error",
      status: 502,
      message: "CHART-IMG returned HTTP 502",
    });

    const badBytesProvider = new ChartImgProvider({
      apiKey: "test-key",
      rateLimitMs: 0,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        imageResponse(new TextEncoder().encode("<html>not a png</html>"), "image/png"),
      ),
    });
    await expect(
      badBytesProvider.captureChart({ symbol: "QQQ", interval: "5m" }),
    ).rejects.toBeInstanceOf(ChartProviderError);
    await expect(
      badBytesProvider.captureChart({ symbol: "QQQ", interval: "5m" }),
    ).rejects.toMatchObject({
      code: "chart_provider_response_invalid",
    });

    const oversizedProvider = new ChartImgProvider({
      apiKey: "test-key",
      rateLimitMs: 0,
      maxBytes: 16,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        imageResponse(makePngBytes(1_200, 750), "image/png"),
      ),
    });
    await expect(
      oversizedProvider.captureChart({ symbol: "QQQ", interval: "5m" }),
    ).rejects.toMatchObject({
      code: "chart_provider_response_too_large",
    });

    const redirectProvider = new ChartImgProvider({
      apiKey: "test-key",
      rateLimitMs: 0,
      fetch: vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
        expect(init?.redirect).toBe("error");
        throw new TypeError("unexpected redirect");
      }),
    });
    await expect(
      redirectProvider.captureChart({ symbol: "QQQ", interval: "5m" }),
    ).rejects.toMatchObject({
      code: "chart_provider_unavailable",
    });
  });
});
