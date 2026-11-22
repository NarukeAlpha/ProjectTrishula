import {
  createTimeoutAbortSignal,
  MAX_JOURNAL_CHART_BYTES,
  readBoundedBytes,
  sniffJournalImage,
} from "../contracts.js";
import {
  chartCaptureRequestSchema,
  ChartProviderError,
  type CapturedChart,
  type ChartCaptureRequest,
  type ChartInterval,
  type ChartPreset,
  type ChartProvider,
} from "./types.js";

export const CHART_IMG_ADVANCED_ENDPOINT =
  "https://api.chart-img.com/v2/tradingview/advanced-chart";
export const CHART_IMG_LAYOUT_ENDPOINT_PREFIX =
  "https://api.chart-img.com/v2/tradingview/layout-chart/";

export const DEFAULT_CHART_WIDTH = 1_200;
export const DEFAULT_CHART_HEIGHT = 750;
export const DEFAULT_CHART_TIMEZONE = "America/New_York";
export const DEFAULT_CHART_TIMEOUT_MS = 30_000;
export const DEFAULT_CHART_RATE_LIMIT_MS = 1_000;

const TRADINGVIEW_SYMBOL_WITH_EXCHANGE = /^[A-Z0-9._-]+:[A-Z0-9._!-]+$/;
const BARE_SYMBOL_PATTERN = /^[A-Z0-9._!-]+$/;
const LAYOUT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const WELL_KNOWN_EXCHANGE_MAP = new Map<string, string>([
  // Indices
  ["SPX", "SP:SPX"],
  ["NDX", "NASDAQ:NDX"],
  ["RUT", "TVC:RUT"],
  ["VIX", "CBOE:VIX"],
  ["XSP", "CBOE:XSP"],
  ["DJI", "DJ:DJI"],
  // Major ETFs
  ["SPY", "AMEX:SPY"],
  ["IWM", "AMEX:IWM"],
  ["DIA", "AMEX:DIA"],
  ["GLD", "AMEX:GLD"],
  ["SLV", "AMEX:SLV"],
  ["USO", "AMEX:USO"],
  ["UVXY", "AMEX:UVXY"],
  ["HYG", "AMEX:HYG"],
  ["XLF", "AMEX:XLF"],
  ["XLK", "AMEX:XLK"],
  ["XLE", "AMEX:XLE"],
  ["XLV", "AMEX:XLV"],
  ["XLY", "AMEX:XLY"],
  ["XLP", "AMEX:XLP"],
  ["XLI", "AMEX:XLI"],
  ["XLU", "AMEX:XLU"],
  ["XLB", "AMEX:XLB"],
  ["XLRE", "AMEX:XLRE"],
  ["XLC", "AMEX:XLC"],
  ["ARKK", "AMEX:ARKK"],
  ["QQQ", "NASDAQ:QQQ"],
  ["QQQM", "NASDAQ:QQQM"],
  ["TQQQ", "NASDAQ:TQQQ"],
  ["SQQQ", "NASDAQ:SQQQ"],
  ["TLT", "NASDAQ:TLT"],
  ["SMH", "NASDAQ:SMH"],
  // Major NASDAQ equities
  ["NVDA", "NASDAQ:NVDA"],
  ["AAPL", "NASDAQ:AAPL"],
  ["MSFT", "NASDAQ:MSFT"],
  ["AMZN", "NASDAQ:AMZN"],
  ["GOOG", "NASDAQ:GOOG"],
  ["GOOGL", "NASDAQ:GOOGL"],
  ["META", "NASDAQ:META"],
  ["TSLA", "NASDAQ:TSLA"],
  ["AMD", "NASDAQ:AMD"],
  ["AVGO", "NASDAQ:AVGO"],
  ["NFLX", "NASDAQ:NFLX"],
  ["COST", "NASDAQ:COST"],
  ["PLTR", "NASDAQ:PLTR"],
  ["COIN", "NASDAQ:COIN"],
  ["MSTR", "NASDAQ:MSTR"],
  ["MU", "NASDAQ:MU"],
  ["INTC", "NASDAQ:INTC"],
  ["SMCI", "NASDAQ:SMCI"],
  ["ARM", "NASDAQ:ARM"],
  ["CRWD", "NASDAQ:CRWD"],
  ["PANW", "NASDAQ:PANW"],
  ["HOOD", "NASDAQ:HOOD"],
  // Major NYSE equities
  ["JPM", "NYSE:JPM"],
  ["BAC", "NYSE:BAC"],
  ["GS", "NYSE:GS"],
  ["MS", "NYSE:MS"],
  ["WMT", "NYSE:WMT"],
  ["DIS", "NYSE:DIS"],
  ["BA", "NYSE:BA"],
  ["XOM", "NYSE:XOM"],
  ["CVX", "NYSE:CVX"],
  ["UNH", "NYSE:UNH"],
  ["LLY", "NYSE:LLY"],
  ["V", "NYSE:V"],
  ["MA", "NYSE:MA"],
  ["HD", "NYSE:HD"],
  ["KO", "NYSE:KO"],
  ["PEP", "NASDAQ:PEP"],
  ["MCD", "NYSE:MCD"],
  ["NKE", "NYSE:NKE"],
  ["CAT", "NYSE:CAT"],
  ["GE", "NYSE:GE"],
  ["CRM", "NYSE:CRM"],
  ["ORCL", "NYSE:ORCL"],
  ["IBM", "NYSE:IBM"],
  ["SNOW", "NYSE:SNOW"],
  ["UBER", "NYSE:UBER"],
]);

export interface ChartImgDateRange {
  from?: string;
  to?: string;
}

export interface ChartImgStudy {
  name: string;
  input?: Record<string, string | number | boolean>;
  override?: Record<string, string | number | boolean>;
}

export interface ChartImgAdvancedPayload {
  symbol: string;
  interval: ChartInterval;
  width: number;
  height: number;
  style: "candle";
  theme: "dark";
  scale: "regular";
  session: "regular" | "extended";
  timezone: string;
  format: "png" | "jpeg";
  studies: ChartImgStudy[];
  range?: { from?: string; to?: string };
  override: {
    scalesFontSize: number;
    showLegend: boolean;
    showLegendValues: boolean;
    showPriceLine: boolean;
    showSeriesLastValue: boolean;
    showSeriesOHLC: boolean;
    showBarChange: boolean;
    showVertGrid: boolean;
    showHorzGrid: boolean;
  };
}

export interface ChartImgLayoutPayload {
  symbol: string;
  interval: ChartInterval;
  width: number;
  height: number;
  format: "png" | "jpeg";
  session?: "regular" | "extended";
  timezone?: string;
  range?: { from?: string; to?: string };
}

export interface ChartImgProviderOptions {
  apiKey?: string | undefined;
  timeoutMs?: number;
  rateLimitMs?: number;
  maxBytes?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function normalizeTradingViewSymbol(raw: string): string {
  const upper = raw.trim().toUpperCase();
  if (TRADINGVIEW_SYMBOL_WITH_EXCHANGE.test(upper)) {
    return upper;
  }
  if (!BARE_SYMBOL_PATTERN.test(upper)) {
    throw new ChartProviderError(
      "chart_invalid_request",
      `Invalid chart symbol: ${raw}`,
    );
  }
  return WELL_KNOWN_EXCHANGE_MAP.get(upper) ?? upper;
}

export function resolveChartPreset(interval: ChartInterval, explicit?: ChartPreset): ChartPreset {
  if (explicit !== undefined) return explicit;
  return interval === "1m" || interval === "5m" || interval === "15m" ? "intraday" : "spot";
}

export function buildIndicatorStudies(
  preset: ChartPreset,
  includeVolumeProfile?: boolean,
): ChartImgStudy[] {
  if (preset === "clean") {
    return [{ name: "Volume" }];
  }

  const studies: ChartImgStudy[] = [
    { name: "Volume" },
    {
      name: "Moving Average",
      input: { length: 9 },
      override: { "Plot.color": "#BA68C8", "Plot.linewidth": 1 },
    },
    {
      name: "Moving Average",
      input: { length: 20 },
      override: { "Plot.color": "#4DD0E1", "Plot.linewidth": 1 },
    },
    {
      name: "Moving Average",
      input: { length: 50 },
      override: { "Plot.color": "#D32F2F", "Plot.linewidth": 2 },
    },
    {
      name: "VWMA",
      input: { length: 90 },
      override: { "Plot.color": "#FBC02D", "Plot.linewidth": 1 },
    },
    {
      name: "VWMA",
      input: { length: 180 },
      override: { "Plot.color": "#FF5252", "Plot.linewidth": 2 },
    },
  ];

  if (preset === "intraday") {
    studies.push({
      name: "VWAP",
      override: { "VWAP.color": "#FFEB3B", "VWAP.linewidth": 2 },
    });
  }

  studies.push({
    name: "Relative Strength Index",
    input: { length: 14, smoothingLine: "SMA", smoothingLength: 14 },
  });

  const shouldIncludeVolumeProfile = includeVolumeProfile ?? (preset === "intraday");
  if (shouldIncludeVolumeProfile) {
    studies.push({ name: "Volume Profile Visible Range" });
  }

  return studies;
}

function normalizeIsoTimestamp(value: string, field: "from" | "to"): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ChartProviderError(
      "chart_invalid_request",
      `Invalid ISO timestamp for '${field}': ${value}`,
    );
  }
  return new Date(parsed).toISOString();
}

function buildRange(
  from?: string,
  to?: string,
): ChartImgDateRange | undefined {
  if (from === undefined && to === undefined) return undefined;
  const range: ChartImgDateRange = {};
  if (from !== undefined) range.from = normalizeIsoTimestamp(from, "from");
  if (to !== undefined) range.to = normalizeIsoTimestamp(to, "to");
  if (
    range.from !== undefined
    && range.to !== undefined
    && Date.parse(range.from) >= Date.parse(range.to)
  ) {
    throw new ChartProviderError(
      "chart_invalid_request",
      "Chart 'from' timestamp must be earlier than 'to'.",
    );
  }
  return range;
}

export function buildAdvancedChartPayload(request: ChartCaptureRequest): ChartImgAdvancedPayload {
  const symbol = normalizeTradingViewSymbol(request.symbol);
  const preset = resolveChartPreset(request.interval, request.preset);
  const range = buildRange(request.from, request.to);
  const payload: ChartImgAdvancedPayload = {
    symbol,
    interval: request.interval,
    width: request.width ?? DEFAULT_CHART_WIDTH,
    height: request.height ?? DEFAULT_CHART_HEIGHT,
    style: "candle",
    theme: "dark",
    scale: "regular",
    session: request.session ?? "extended",
    timezone: request.timezone ?? DEFAULT_CHART_TIMEZONE,
    format: request.format ?? "png",
    studies: buildIndicatorStudies(preset, request.includeVolumeProfile),
    override: {
      scalesFontSize: 13,
      showLegend: true,
      showLegendValues: true,
      showPriceLine: true,
      showSeriesLastValue: true,
      showSeriesOHLC: true,
      showBarChange: true,
      showVertGrid: false,
      showHorzGrid: true,
    },
  };
  if (range !== undefined) payload.range = range;
  return payload;
}

export function buildSavedLayoutPayload(request: ChartCaptureRequest): ChartImgLayoutPayload {
  const symbol = normalizeTradingViewSymbol(request.symbol);
  const range = buildRange(request.from, request.to);
  const payload: ChartImgLayoutPayload = {
    symbol,
    interval: request.interval,
    width: request.width ?? DEFAULT_CHART_WIDTH,
    height: request.height ?? DEFAULT_CHART_HEIGHT,
    format: request.format ?? "png",
  };
  if (request.session !== undefined) payload.session = request.session;
  if (request.timezone !== undefined) payload.timezone = request.timezone;
  if (range !== undefined) payload.range = range;
  return payload;
}

async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("chart_provider_aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class ChartImgProvider implements ChartProvider {
  readonly id = "chart_img";
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly rateLimitMs: number;
  private readonly maxBytes: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private queue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;

  constructor(options: ChartImgProviderOptions = {}) {
    const trimmed = options.apiKey?.trim();
    this.apiKey = trimmed && trimmed.length > 0 ? trimmed : undefined;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_CHART_TIMEOUT_MS;
    this.rateLimitMs = options.rateLimitMs ?? DEFAULT_CHART_RATE_LIMIT_MS;
    this.maxBytes = options.maxBytes ?? MAX_JOURNAL_CHART_BYTES;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  isConfigured(): boolean {
    return this.apiKey !== undefined;
  }

  async captureChart(
    rawRequest: ChartCaptureRequest,
    signal?: AbortSignal,
  ): Promise<CapturedChart> {
    if (this.apiKey === undefined) {
      throw new ChartProviderError(
        "chart_provider_unconfigured",
        "CHART_IMG_API_KEY is not configured. Ask the user to paste a TradingView screenshot or configure CHART_IMG_API_KEY.",
      );
    }

    const parsed = chartCaptureRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      throw new ChartProviderError(
        "chart_invalid_request",
        firstIssue ? firstIssue.message : "Invalid chart capture request.",
      );
    }
    const request = parsed.data;
    const expectedFormat = request.format ?? "png";
    const expectedMimeType = expectedFormat === "jpeg" ? "image/jpeg" : "image/png";

    let endpoint: string;
    let body: ChartImgAdvancedPayload | ChartImgLayoutPayload;
    if (request.useSavedLayout) {
      const layoutId = request.layoutId?.trim();
      if (!layoutId || !LAYOUT_ID_PATTERN.test(layoutId)) {
        throw new ChartProviderError(
          "chart_invalid_request",
          "A valid tradingViewLayoutId is required when useSavedLayout is true.",
        );
      }
      endpoint = `${CHART_IMG_LAYOUT_ENDPOINT_PREFIX}${encodeURIComponent(layoutId)}`;
      body = buildSavedLayoutPayload(request);
    } else {
      endpoint = CHART_IMG_ADVANCED_ENDPOINT;
      body = buildAdvancedChartPayload(request);
    }

    const apiKey = this.apiKey;
    return this.enqueue(async () => {
      signal?.throwIfAborted();
      const combined = createTimeoutAbortSignal(
        this.timeoutMs,
        "chart_provider_timeout",
        signal,
        "chart_provider_aborted",
      );
      let response: Response;
      try {
        response = await this.fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify(body),
          redirect: "error",
          signal: combined.signal,
        });
      } catch (error) {
        if (combined.wasTimeout()) {
          throw new ChartProviderError("chart_provider_timeout", "CHART-IMG request timed out.");
        }
        if (signal?.aborted) {
          throw new ChartProviderError("chart_provider_aborted", "CHART-IMG request was aborted.");
        }
        const message = error instanceof Error ? error.message : "CHART-IMG request failed.";
        throw new ChartProviderError(
          "chart_provider_unavailable",
          `CHART-IMG request failed: ${message}`,
        );
      } finally {
        combined.cleanup();
      }

      if (!response.ok) {
        let detail = "";
        try {
          const text = (await response.text()).trim();
          if (text.length > 0) detail = `: ${text.slice(0, 200)}`;
        } catch {
          // Ignore unreadable error response bodies.
        }
        throw new ChartProviderError(
          "chart_provider_http_error",
          `CHART-IMG returned HTTP ${response.status}${detail}`,
          response.status,
        );
      }

      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== "image/png" && contentType !== "image/jpeg") {
        throw new ChartProviderError(
          "chart_provider_response_invalid",
          `CHART-IMG returned unexpected content-type '${contentType ?? "missing"}'.`,
        );
      }

      const read = await readBoundedBytes(response, this.maxBytes);
      if (!read.ok) {
        if (read.reason === "too_large") {
          throw new ChartProviderError(
            "chart_provider_response_too_large",
            `CHART-IMG image exceeded the ${this.maxBytes}-byte limit.`,
          );
        }
        throw new ChartProviderError(
          "chart_provider_response_invalid",
          "CHART-IMG returned an empty or unreadable image body.",
        );
      }

      const sniffed = sniffJournalImage(read.bytes);
      if (
        sniffed === null
        || (sniffed.mimeType !== "image/png" && sniffed.mimeType !== "image/jpeg")
      ) {
        throw new ChartProviderError(
          "chart_provider_response_invalid",
          "CHART-IMG response bytes are not a valid PNG or JPEG image.",
        );
      }
      if (sniffed.mimeType !== contentType || sniffed.mimeType !== expectedMimeType) {
        throw new ChartProviderError(
          "chart_provider_response_invalid",
          `CHART-IMG returned ${sniffed.mimeType} instead of requested ${expectedMimeType}.`,
        );
      }

      return {
        bytes: read.bytes,
        mimeType: sniffed.mimeType,
        width: sniffed.width,
        height: sniffed.height,
        symbol: body.symbol,
        interval: request.interval,
        source: "chart_img",
      };
    }, signal);
  }

  private enqueue<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const task = this.queue.then(async () => {
      if (signal?.aborted) {
        throw new ChartProviderError("chart_provider_aborted", "CHART-IMG request was aborted.");
      }
      const waitMs = Math.max(0, this.nextRequestAt - this.now());
      if (waitMs > 0) {
        try {
          await this.sleep(waitMs, signal);
        } catch {
          throw new ChartProviderError("chart_provider_aborted", "CHART-IMG request was aborted.");
        }
      }
      this.nextRequestAt = this.now() + this.rateLimitMs;
      return operation();
    });
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }
}
