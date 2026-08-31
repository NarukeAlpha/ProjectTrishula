import {
  marketChartSpecSchema,
  MAX_DISCORD_GENERATED_FILE_BYTES,
  type MarketChartSpec,
  type RenderedMarketChart,
} from "./market-chart.js";

const CHART_IMG_ENDPOINT =
  "https://api.chart-img.com/v2/tradingview/advanced-chart";
const CHART_IMG_REQUEST_INTERVAL_MS = 1_000;
const CHART_IMG_CACHE_TTL_MS = 60_000;
const CHART_IMG_CACHE_ENTRIES = 32;
const CHART_WIDTH = 800;
const CHART_HEIGHT = 600;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export type ChartImageErrorCode =
  | "missing_provider_symbol"
  | "provider_http_error"
  | "provider_response_invalid"
  | "provider_response_too_large"
  | "provider_timeout"
  | "provider_unavailable";

export class ChartImageError extends Error {
  constructor(
    readonly code: ChartImageErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ChartImageError";
  }
}

export interface MarketChartRenderer {
  render(chart: MarketChartSpec): Promise<RenderedMarketChart>;
}

interface ChartImgClientOptions {
  apiKey: string;
  timeoutMs: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface CacheEntry {
  expiresAt: number;
  file: RenderedMarketChart;
}

function boundedFilename(symbol: string): string {
  const name = symbol
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return `${name || "market"}-chart.png`;
}

function cacheKey(chart: MarketChartSpec): string {
  return JSON.stringify({
    sourceSymbol: chart.symbol,
    title: chart.title,
    symbol: chart.tradingViewSymbol,
    interval: chart.interval,
    range: chart.range,
    style: chart.style,
    includeVolume: chart.includeVolume,
  });
}

function requestBody(chart: MarketChartSpec) {
  if (chart.tradingViewSymbol === undefined) {
    throw new ChartImageError(
      "missing_provider_symbol",
      "The chart does not have a supported provider symbol.",
    );
  }
  return {
    symbol: chart.tradingViewSymbol,
    ...(chart.range === undefined
      ? { interval: chart.interval ?? "1D" }
      : { range: chart.range }),
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    style: chart.style ?? "candle",
    theme: "dark",
    scale: "regular",
    session: "extended",
    timezone: "America/New_York",
    format: "png",
    studies: chart.includeVolume === false ? [] : [{ name: "Volume" }],
    override: {
      scalesFontSize: 14,
      showLegend: true,
      showLegendValues: true,
      showPriceLine: true,
      showSeriesLastValue: true,
      showSeriesOHLC: true,
      showBarChange: true,
      showVertGrid: false,
      showHorzGrid: true,
    },
  } as const;
}

async function readBoundedPng(response: Response): Promise<Buffer> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const size = Number(declaredLength);
    if (
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > MAX_DISCORD_GENERATED_FILE_BYTES
    ) {
      throw new ChartImageError(
        "provider_response_too_large",
        "CHART-IMG returned an invalid image size.",
      );
    }
  }
  if (response.body === null) {
    throw new ChartImageError(
      "provider_response_invalid",
      "CHART-IMG returned an empty image.",
    );
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > MAX_DISCORD_GENERATED_FILE_BYTES) {
      await reader.cancel();
      throw new ChartImageError(
        "provider_response_too_large",
        "CHART-IMG returned an image above the Discord limit.",
      );
    }
    chunks.push(Buffer.from(chunk.value));
  }
  if (totalBytes === 0) {
    throw new ChartImageError(
      "provider_response_invalid",
      "CHART-IMG returned an empty image.",
    );
  }
  return Buffer.concat(chunks, totalBytes);
}

function validatePng(image: Buffer): void {
  if (
    image.length < 24 ||
    !image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    image.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new ChartImageError(
      "provider_response_invalid",
      "CHART-IMG returned invalid PNG data.",
    );
  }
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  if (
    width <= 0 ||
    height <= 0 ||
    width > CHART_WIDTH ||
    height > CHART_HEIGHT ||
    width * height > CHART_WIDTH * CHART_HEIGHT
  ) {
    throw new ChartImageError(
      "provider_response_invalid",
      "CHART-IMG returned invalid image dimensions.",
    );
  }
}

function cloneFile(file: RenderedMarketChart): RenderedMarketChart {
  return { ...file, attachment: Buffer.from(file.attachment) };
}

export class ChartImgClient implements MarketChartRenderer {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<RenderedMarketChart>>();
  private queue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;

  constructor(private readonly options: ChartImgClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      (async (milliseconds) => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, milliseconds);
        });
      });
  }

  async render(input: MarketChartSpec): Promise<RenderedMarketChart> {
    const chart = marketChartSpecSchema.parse(input);
    if (chart.tradingViewSymbol === undefined) {
      throw new ChartImageError(
        "missing_provider_symbol",
        "The chart does not have a supported provider symbol.",
      );
    }
    const key = cacheKey(chart);
    const cached = this.cache.get(key);
    if (cached !== undefined && cached.expiresAt > this.now()) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cloneFile(cached.file);
    }
    if (cached !== undefined) this.cache.delete(key);
    const pending = this.inFlight.get(key);
    if (pending !== undefined) return cloneFile(await pending);
    const task = this.enqueue(chart).then((file) => {
      this.cache.set(key, {
        expiresAt: this.now() + CHART_IMG_CACHE_TTL_MS,
        file: cloneFile(file),
      });
      while (this.cache.size > CHART_IMG_CACHE_ENTRIES) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
      return file;
    });
    this.inFlight.set(key, task);
    try {
      return cloneFile(await task);
    } finally {
      this.inFlight.delete(key);
    }
  }

  private enqueue(chart: MarketChartSpec): Promise<RenderedMarketChart> {
    const task = this.queue.then(async () => {
      const waitMs = Math.max(0, this.nextRequestAt - this.now());
      if (waitMs > 0) await this.sleep(waitMs);
      this.nextRequestAt = this.now() + CHART_IMG_REQUEST_INTERVAL_MS;
      return await this.request(chart);
    });
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async request(chart: MarketChartSpec): Promise<RenderedMarketChart> {
    let response: Response;
    try {
      response = await this.fetch(CHART_IMG_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.options.apiKey,
        },
        body: JSON.stringify(requestBody(chart)),
        redirect: "error",
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new ChartImageError(
          "provider_timeout",
          "CHART-IMG timed out.",
        );
      }
      throw new ChartImageError(
        "provider_unavailable",
        "CHART-IMG was unavailable.",
      );
    }
    if (!response.ok) {
      throw new ChartImageError(
        "provider_http_error",
        `CHART-IMG returned HTTP ${response.status}.`,
        response.status,
      );
    }
    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== "image/png") {
      throw new ChartImageError(
        "provider_response_invalid",
        "CHART-IMG returned an unexpected content type.",
      );
    }
    const image = await readBoundedPng(response);
    validatePng(image);
    return {
      attachment: image,
      name: boundedFilename(chart.symbol),
      description:
        chart.title ?? `${chart.symbol.toUpperCase()} market chart`,
      contentType: "image/png",
    };
  }
}

export { CHART_IMG_ENDPOINT, requestBody, validatePng };
