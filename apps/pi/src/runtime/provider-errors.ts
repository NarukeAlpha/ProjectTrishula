import type { TerminalPiEvent } from "../contracts.js";

export type ProviderError = Error | { readonly message?: string; readonly status?: number };
export type ExecutionErrorCode =
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_authentication"
  | "provider_network"
  | "provider_unavailable"
  | "execution_failed";
export type NormalizedExecutionError = Omit<Extract<TerminalPiEvent, { type: "error" }>, "code"> & {
  code: ExecutionErrorCode;
};

function message(error: ProviderError): string {
  return error instanceof Error ? error.message.toLowerCase() : error.message?.toLowerCase() ?? "";
}

function status(error: ProviderError): number | undefined {
  if (!("status" in error)) return undefined;
  return error.status;
}

export function normalizeExecutionError(error: ProviderError): NormalizedExecutionError {
  const value = message(error);
  const httpStatus = status(error);

  if (value.includes("timeout") || value.includes("timed out") || value.includes("etimedout")) {
    return { type: "error", code: "provider_timeout", message: "The model provider timed out.", retryable: true };
  }
  if (httpStatus === 429 || value.includes("rate limit") || value.includes("too many requests")) {
    return { type: "error", code: "provider_rate_limited", message: "The model provider is busy.", retryable: true };
  }
  if (httpStatus === 401 || httpStatus === 403 || value.includes("unauthorized") || value.includes("invalid api key")) {
    return { type: "error", code: "provider_authentication", message: "The model provider rejected its service credential.", retryable: false };
  }
  if (
    value.includes("network") ||
    value.includes("fetch failed") ||
    value.includes("econnreset") ||
    value.includes("socket hang up")
  ) {
    return { type: "error", code: "provider_network", message: "The model provider connection was interrupted.", retryable: true };
  }
  if ((httpStatus !== undefined && httpStatus >= 500) || value.includes("overloaded") || value.includes("service unavailable")) {
    return { type: "error", code: "provider_unavailable", message: "The model provider is unavailable.", retryable: true };
  }
  return { type: "error", code: "execution_failed", message: "The execution service could not finish the run.", retryable: true };
}
