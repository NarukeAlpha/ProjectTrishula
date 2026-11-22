import { z } from "zod";

export const chartIntervals = ["1m", "5m", "15m", "1h", "1D"] as const;
export const chartSessions = ["regular", "extended"] as const;
export const chartFormats = ["png", "jpeg"] as const;
export const chartPresets = ["intraday", "spot", "clean"] as const;

export type ChartInterval = (typeof chartIntervals)[number];
export type ChartSession = (typeof chartSessions)[number];
export type ChartFormat = (typeof chartFormats)[number];
export type ChartPreset = (typeof chartPresets)[number];

export const chartCaptureRequestSchema = z.object({
  symbol: z.string().trim().min(1).max(32),
  interval: z.enum(chartIntervals),
  from: z.string().trim().min(1).max(64).optional(),
  to: z.string().trim().min(1).max(64).optional(),
  session: z.enum(chartSessions).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  width: z.number().int().min(320).max(2_400).optional(),
  height: z.number().int().min(240).max(1_600).optional(),
  format: z.enum(chartFormats).optional(),
  preset: z.enum(chartPresets).optional(),
  includeVolumeProfile: z.boolean().optional(),
  useSavedLayout: z.boolean().optional(),
  layoutId: z.string().trim().min(1).max(64).optional(),
}).strict();

export type ChartCaptureRequest = z.infer<typeof chartCaptureRequestSchema>;

export interface CapturedChart {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  symbol: string;
  interval: ChartInterval;
  source: "chart_img";
}

export type ChartProviderErrorCode =
  | "chart_provider_unconfigured"
  | "chart_invalid_request"
  | "chart_provider_http_error"
  | "chart_provider_response_invalid"
  | "chart_provider_response_too_large"
  | "chart_provider_timeout"
  | "chart_provider_aborted"
  | "chart_provider_unavailable";

export class ChartProviderError extends Error {
  constructor(
    readonly code: ChartProviderErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ChartProviderError";
  }
}

export interface ChartProvider {
  readonly id: string;
  isConfigured(): boolean;
  captureChart(request: ChartCaptureRequest, signal?: AbortSignal): Promise<CapturedChart>;
}
