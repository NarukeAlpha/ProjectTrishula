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
  type ChartImgPlan,
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
export const DEFAULT_CHART_PLAN: ChartImgPlan = "pro";

const MAX_CHART_ERROR_BODY_BYTES = 4_096;

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
  from: string;
  to: string;
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
  range?: ChartImgDateRange;
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
}

export interface ChartImgProviderOptions {
  apiKey?: string | undefined;
  plan?: ChartImgPlan;
  timeoutMs?: number;
  rateLimitMs?: number;
  maxBytes?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function maxStudiesForPlan(plan: ChartImgPlan): number {
  switch (plan) {
    case "basic":
      return 3;
    case "pro":
      return 5;
    case "mega":
    case "ultra":
      return 10;
  }
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

const VOLUME_STUDY: ChartImgStudy = { name: "Volume" };
const SMA_9_STUDY: ChartImgStudy = {
  name: "Moving Average",
  input: { length: 9 },
  override: { "Plot.color": "#BA68C8", "Plot.linewidth": 1 },
};
const SMA_20_STUDY: ChartImgStudy = {
  name: "Moving Average",
  input: { length: 20 },
  override: { "Plot.color": "#4DD0E1", "Plot.linewidth": 1 },
};
const SMA_50_STUDY: ChartImgStudy = {
  name: "Moving Average",
  input: { length: 50 },
  override: { "Plot.color": "#D32F2F", "Plot.linewidth": 2 },
};
const VWMA_90_STUDY: ChartImgStudy = {
  name: "VWMA",
  input: { in_0: 90 },
  override: { "Plot.color": "#FBC02D", "Plot.linewidth": 1 },
};
const VWMA_180_STUDY: ChartImgStudy = {
  name: "VWMA",
  input: { in_0: 180 },
  override: { "Plot.color": "#FF5252", "Plot.linewidth": 2 },
};
const VWAP_STUDY: ChartImgStudy = {
  name: "VWAP",
  override: { "VWAP.color": "#FFEB3B", "VWAP.linewidth": 2 },
};
const RSI_14_STUDY: ChartImgStudy = {
  name: "Relative Strength Index",
  input: { length: 14, smoothingLine: "SMA", smoothingLength: 14 },
};
const VOLUME_PROFILE_STUDY: ChartImgStudy = { name: "Volume Profile Visible Range" };

export function buildIndicatorStudies(
  preset: ChartPreset,
  includeVolumeProfile?: boolean,
  plan: ChartImgPlan = DEFAULT_CHART_PLAN,
): ChartImgStudy[] {
  const studyCap = maxStudiesForPlan(plan);
  if (preset === "clean") {
    return [VOLUME_STUDY].slice(0, studyCap);
  }

  if (plan === "basic") {
    return [VOLUME_STUDY, VWAP_STUDY, RSI_14_STUDY].slice(0, studyCap);
  }

  if (plan === "pro") {
    const proStudies: ChartImgStudy[] = preset === "intraday"
      ? [VOLUME_STUDY, SMA_9_STUDY, SMA_20_STUDY, VWAP_STUDY, RSI_14_STUDY]
      : [VOLUME_STUDY, SMA_9_STUDY, SMA_20_STUDY, SMA_50_STUDY, RSI_14_STUDY];
    return proStudies.slice(0, studyCap);
  }

  // mega / ultra: full indicator stack
  const studies: ChartImgStudy[] = [
    VOLUME_STUDY,
    SMA_9_STUDY,
    SMA_20_STUDY,
    SMA_50_STUDY,
    VWMA_90_STUDY,
    VWMA_180_STUDY,
  ];

  if (preset === "intraday") {
    studies.push(VWAP_STUDY);
  }

  studies.push(RSI_14_STUDY);

  const shouldIncludeVolumeProfile = includeVolumeProfile ?? (preset === "intraday");
  if (shouldIncludeVolumeProfile) {
    studies.push(VOLUME_PROFILE_STUDY);
  }

  return studies.slice(0, studyCap);
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
  if (from === undefined || to === undefined) {
    throw new ChartProviderError(
      "chart_invalid_request",
      "Both 'from' and 'to' ISO timestamps must be provided together when specifying a historical range.",
    );
  }
  const isoFrom = normalizeIsoTimestamp(from, "from");
  const isoTo = normalizeIsoTimestamp(to, "to");
  if (Date.parse(isoFrom) >= Date.parse(isoTo)) {
    throw new ChartProviderError(
      "chart_invalid_request",
      "Chart 'from' timestamp must be earlier than 'to'.",
    );
  }
  return { from: isoFrom, to: isoTo };
}

export function buildAdvancedChartPayload(
  request: ChartCaptureRequest,
  plan: ChartImgPlan = DEFAULT_CHART_PLAN,
): ChartImgAdvancedPayload {
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
    studies: buildIndicatorStudies(preset, request.includeVolumeProfile, plan),
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
  const payload: ChartImgLayoutPayload = {
    symbol,
    interval: request.interval,
    width: request.width ?? DEFAULT_CHART_WIDTH,
    height: request.height ?? DEFAULT_CHART_HEIGHT,
    format: request.format ?? "png",
  };
  if (request.session !== undefined) payload.session = request.session;
  if (request.timezone !== undefined) payload.timezone = request.timezone;
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

interface QueueWaiter {
  grant: () => void;
  reject: (error: ChartProviderError) => void;
  cleanup: () => void;
}

export class ChartImgProvider implements ChartProvider {
  readonly id = "chart_img";
  private readonly apiKey: string | undefined;
  private readonly plan: ChartImgPlan;
  private readonly timeoutMs: number;
  private readonly rateLimitMs: number;
  private readonly maxBytes: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private busy = false;
  private readonly waiters: QueueWaiter[] = [];
  private nextRequestAt = 0;

  constructor(options: ChartImgProviderOptions = {}) {
    const trimmed = options.apiKey?.trim();
    this.apiKey = trimmed && trimmed.length > 0 ? trimmed : undefined;
    this.plan = options.plan ?? DEFAULT_CHART_PLAN;
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
    const hasHistoricalRange = request.from !== undefined || request.to !== undefined;

    let endpoint: string;
    let body: ChartImgAdvancedPayload | ChartImgLayoutPayload;
    // Shared Layout ignores historical date ranges; always route dated historical captures to Advanced Chart.
    if (request.useSavedLayout && !hasHistoricalRange) {
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
      body = buildAdvancedChartPayload(request, this.plan);
    }

    const apiKey = this.apiKey;
    return this.enqueue(async () => {
      if (signal?.aborted) {
        throw new ChartProviderError("chart_provider_aborted", "CHART-IMG request was aborted.");
      }
      const combined = createTimeoutAbortSignal(
        this.timeoutMs,
        "chart_provider_timeout",
        signal,
        "chart_provider_aborted",
      );
      try {
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
        }

        if (!response.ok) {
          let detail = "";
          const errorRead = await readBoundedBytes(
            response,
            MAX_CHART_ERROR_BODY_BYTES,
            combined.signal,
          );
          if (errorRead.ok) {
            const decoded = new TextDecoder("utf-8", { fatal: false }).decode(errorRead.bytes).trim();
            if (decoded.length > 0) detail = `: ${decoded.slice(0, 200)}`;
          } else if (errorRead.reason === "aborted") {
            if (combined.wasTimeout()) {
              throw new ChartProviderError("chart_provider_timeout", "CHART-IMG request timed out.");
            }
            throw new ChartProviderError("chart_provider_aborted", "CHART-IMG request was aborted.");
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

        const read = await readBoundedBytes(response, this.maxBytes, combined.signal);
        if (!read.ok) {
          if (read.reason === "aborted") {
            if (combined.wasTimeout()) {
              throw new ChartProviderError("chart_provider_timeout", "CHART-IMG response body timed out.");
            }
            throw new ChartProviderError("chart_provider_aborted", "CHART-IMG request was aborted.");
          }
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
      } finally {
        combined.cleanup();
      }
    }, signal);
  }

  private async acquireSlot(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new ChartProviderError("chart_provider_aborted", "CHART-IMG request was aborted.");
    }
    if (!this.busy) {
      this.busy = true;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new ChartProviderError("chart_provider_aborted", "CHART-IMG request was aborted while queued."));
      };
      const waiter: QueueWaiter = {
        grant: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        reject: (error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
        cleanup: () => {
          signal?.removeEventListener("abort", onAbort);
        },
      };
      this.waiters.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private releaseSlot(): void {
    const next = this.waiters.shift();
    if (next !== undefined) {
      next.grant();
      return;
    }
    this.busy = false;
  }

  private async enqueue<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquireSlot(signal);
    try {
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
      return await operation();
    } finally {
      this.releaseSlot();
    }
  }
}
