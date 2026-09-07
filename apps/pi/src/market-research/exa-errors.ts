/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unsafe-dictionary-type, anti-slop/no-conditional-empty-object-spread -- Caught Exa errors have no stable SDK contract; this module reduces them to the bounded safe error domain. */
import { ExaError } from "exa-js";
import type { MarketResearchSafeErrorCode } from "./contracts.js";

export type ExaFailureScope = "request" | "url" | "capability" | "batch";

export interface ExaFailureDecision {
  code: MarketResearchSafeErrorCode;
  retryable: boolean;
  maximumRetries: number;
  scope: ExaFailureScope;
  finalForSource: boolean;
  retryAfterMs?: number;
  requestId?: string;
  tag?: string;
}

interface ErrorLike {
  statusCode?: number;
  status?: number;
  code?: string;
  type?: string;
  tag?: string;
  requestId?: string;
  retryAfterMs?: number;
  detail?: unknown;
  name?: string;
}

function detailRetryAfterMs(detail: unknown): number | undefined {
  if (typeof detail !== "object" || detail === null) return undefined;
  const record = detail as Record<string, unknown>;
  if (typeof record.retryAfterMs === "number") return record.retryAfterMs;
  if (typeof record.retry_after === "number") return record.retry_after * 1_000;
  return undefined;
}

function safeError(error: unknown): ErrorLike {
  if (error instanceof ExaError) {
    return {
      statusCode: error.statusCode,
      name: error.name,
      ...(error.code === undefined ? {} : { code: error.code }),
      ...(error.type === undefined ? {} : { type: error.type }),
      ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    };
  }
  if (typeof error !== "object" || error === null) return {};
  const value = error as ErrorLike;
  return value;
}

function detailTag(detail: unknown): string | undefined {
  if (typeof detail !== "object" || detail === null) return undefined;
  const record = detail as Record<string, unknown>;
  for (const key of ["tag", "code", "type"]) {
    const value = record[key];
    if (typeof value === "string" && value.length <= 100) return value;
  }
  return undefined;
}

export function classifyExaError(error: unknown): ExaFailureDecision {
  const value = safeError(error);
  const status = value.statusCode ?? value.status;
  const tag = value.tag ?? value.code ?? value.type ?? detailTag(value.detail);
  const common = {
    ...(value.requestId ? { requestId: value.requestId.slice(0, 256) } : {}),
    ...(tag ? { tag: tag.slice(0, 100) } : {}),
  };
  if (status === 401) {
    return { code: "exa_auth_failed", retryable: false, maximumRetries: 0, scope: "capability", finalForSource: true, ...common };
  }
  if (status === 402) {
    return { code: "exa_budget_exhausted", retryable: false, maximumRetries: 0, scope: "capability", finalForSource: true, ...common };
  }
  if (status === 400) {
    return { code: "exa_invalid_request", retryable: false, maximumRetries: 0, scope: "request", finalForSource: true, ...common };
  }
  if (status === 422 || tag === "FETCH_DOCUMENT_ERROR") {
    return { code: "source_unavailable", retryable: false, maximumRetries: 0, scope: "url", finalForSource: true, ...common };
  }
  if (status === 403) {
    if (tag === "ROBOTS_FILTER_FAILED") {
      return { code: "source_rights_blocked", retryable: false, maximumRetries: 0, scope: "batch", finalForSource: true, ...common };
    }
    if (tag === "SOURCE_NOT_AVAILABLE") {
      return { code: "source_unavailable", retryable: false, maximumRetries: 0, scope: "url", finalForSource: true, ...common };
    }
    if (tag === "ACCESS_DENIED" || tag === "FEATURE_DISABLED") {
      return { code: "exa_invalid_request", retryable: false, maximumRetries: 0, scope: "capability", finalForSource: true, ...common };
    }
    return { code: "source_rights_blocked", retryable: false, maximumRetries: 0, scope: "request", finalForSource: true, ...common };
  }
  if (status === 429) {
    const suppliedRetryAfterMs = value.retryAfterMs ?? detailRetryAfterMs(value.detail);
    const retryAfterMs = Number.isFinite(suppliedRetryAfterMs) && (suppliedRetryAfterMs ?? 0) >= 0
      ? Math.min(suppliedRetryAfterMs ?? 0, 60_000)
      : undefined;
    return {
      code: "exa_rate_limited",
      retryable: true,
      maximumRetries: 3,
      scope: "request",
      finalForSource: false,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      ...common,
    };
  }
  if (tag === "CRAWL_LIVECRAWL_TIMEOUT") {
    return { code: "source_unavailable", retryable: true, maximumRetries: 1, scope: "url", finalForSource: false, ...common };
  }
  if (status !== undefined && status >= 500 && status <= 599) {
    return { code: "exa_unavailable", retryable: true, maximumRetries: 3, scope: "request", finalForSource: false, ...common };
  }
  if (
    value.name === "AbortError"
    || value.code === "ETIMEDOUT"
    || value.code === "ECONNRESET"
    || value.code === "UND_ERR_CONNECT_TIMEOUT"
  ) {
    return { code: "exa_unavailable", retryable: true, maximumRetries: 2, scope: "request", finalForSource: false, ...common };
  }
  return { code: "exa_unavailable", retryable: false, maximumRetries: 0, scope: "request", finalForSource: true, ...common };
}

export class MarketResearchExaError extends Error {
  constructor(readonly decision: ExaFailureDecision) {
    super(decision.code);
    this.name = "MarketResearchExaError";
  }
}
