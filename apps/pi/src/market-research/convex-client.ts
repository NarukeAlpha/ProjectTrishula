/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-runtime-typeof -- Convex HTTP JSON is untrusted and is reduced to named callback results at this transport boundary. */
import type { Logger } from "../runtime/logger.js";
import {
  marketResearchEvidenceItemSchema,
  type MarketResearchEvidenceItem,
  type MarketResearchJobRequest,
  type MarketResearchJobResult,
  type MarketResearchSafeErrorCode,
} from "./contracts.js";

export interface MarketResearchCallbacks {
  heartbeat(request: Pick<MarketResearchJobRequest, "editionId" | "generation" | "claimToken">, stage: string, signal?: AbortSignal): Promise<boolean>;
  appendEvidence(request: Pick<MarketResearchJobRequest, "editionId" | "generation" | "claimToken">, sequence: number, evidence: readonly MarketResearchEvidenceItem[], signal?: AbortSignal): Promise<boolean>;
  loadEvidence(request: Pick<MarketResearchJobRequest, "editionId" | "generation" | "claimToken">, signal?: AbortSignal): Promise<readonly MarketResearchEvidenceItem[]>;
  complete(result: MarketResearchJobResult, signal?: AbortSignal): Promise<boolean>;
  fail(request: Pick<MarketResearchJobRequest, "editionId" | "generation" | "claimToken">, code: MarketResearchSafeErrorCode, retryable: boolean, signal?: AbortSignal): Promise<void>;
}

export interface ConvexMarketResearchClientOptions {
  siteUrl: string;
  sharedSecret: string;
  timeoutMs: number;
  logger: Logger;
  fetch?: typeof fetch;
}

export class ConvexMarketResearchClient implements MarketResearchCallbacks {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ConvexMarketResearchClientOptions) {
    this.endpoint = `${options.siteUrl}/market-research/pi`;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async heartbeat(
    request: Pick<MarketResearchJobRequest, "editionId" | "generation" | "claimToken">,
    stage: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const response = await this.request({ operation: "heartbeat", ...request, stage }, signal);
    return response.accepted === true;
  }

  async appendEvidence(
    request: Pick<MarketResearchJobRequest, "editionId" | "generation" | "claimToken">,
    sequence: number,
    evidence: readonly MarketResearchEvidenceItem[],
    signal?: AbortSignal,
  ): Promise<boolean> {
    const response = await this.request({ operation: "appendEvidence", ...request, sequence, evidence }, signal);
    return response.accepted === true;
  }

  async loadEvidence(
    request: Pick<MarketResearchJobRequest, "editionId" | "generation" | "claimToken">,
    signal?: AbortSignal,
  ): Promise<readonly MarketResearchEvidenceItem[]> {
    const response = await this.request({ operation: "loadEvidence", ...request }, signal);
    if (response.accepted !== true || !Array.isArray(response.evidence)) throw new Error("edition_lease_lost");
    return response.evidence.map((item) => marketResearchEvidenceItemSchema.parse(item));
  }

  async complete(result: MarketResearchJobResult, signal?: AbortSignal): Promise<boolean> {
    const response = await this.request({ operation: "complete", result }, signal);
    return response.accepted === true;
  }

  async fail(
    request: Pick<MarketResearchJobRequest, "editionId" | "generation" | "claimToken">,
    code: MarketResearchSafeErrorCode,
    retryable: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request({ operation: "fail", ...request, code, retryable }, signal);
  }

  private async request(body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${this.options.sharedSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("market_research_convex_rejected");
      const parsed = await response.json() as unknown;
      if (typeof parsed !== "object" || parsed === null) throw new Error("market_research_convex_invalid_response");
      return parsed as Record<string, unknown>;
    } catch (error) {
      this.options.logger.error("market_research_convex_operation_failed", {
        code: error instanceof Error ? error.message.slice(0, 100) : "market_research_convex_failed",
      });
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}
