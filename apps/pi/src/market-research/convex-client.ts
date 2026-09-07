/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-runtime-typeof -- Convex HTTP JSON is untrusted and is reduced to named callback results at this transport boundary. */
import type { Logger } from "../runtime/logger.js";
import { randomUUID } from "node:crypto";
import type { ExaCostEvent } from "./exa-client.js";
import {
  marketResearchEvidenceItemSchema,
  type MarketResearchEvidenceItem,
  type MarketResearchJobRequest,
  type MarketResearchJobResult,
  type MarketResearchSafeErrorCode,
} from "./contracts.js";

type ResearchLease = Pick<MarketResearchJobRequest, "editionId" | "generation" | "claimToken">;

function leaseFields({ editionId, generation, claimToken }: ResearchLease): ResearchLease {
  return { editionId, generation, claimToken };
}

export interface MarketResearchCallbacks {
  heartbeat(request: ResearchLease, stage: string, signal?: AbortSignal): Promise<boolean>;
  appendEvidence(request: ResearchLease, sequence: number, evidence: readonly MarketResearchEvidenceItem[], signal?: AbortSignal): Promise<boolean>;
  loadEvidence(request: ResearchLease, signal?: AbortSignal): Promise<readonly MarketResearchEvidenceItem[]>;
  complete(result: MarketResearchJobResult, signal?: AbortSignal): Promise<boolean>;
  fail(request: ResearchLease, code: MarketResearchSafeErrorCode, retryable: boolean, signal?: AbortSignal): Promise<void>;
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
  private readonly pendingEditions = new Map<string, Promise<void>>();

  constructor(private readonly options: ConvexMarketResearchClientOptions) {
    this.endpoint = `${options.siteUrl}/market-research/pi`;
    this.fetchImpl = options.fetch ?? fetch;
  }

  costObserver(
    request: Pick<MarketResearchJobRequest, "ownerId" | "editionId" | "generation" | "claimToken">,
  ): (event: Readonly<ExaCostEvent>) => Promise<void> {
    // Capture the original accounting capability; later work leases must not replace it.
    const target = {
      ownerId: request.ownerId,
      editionId: request.editionId,
      generation: request.generation,
      claimToken: request.claimToken,
    };
    const streamId = randomUUID();
    let sequence = 0;
    return (event) => {
      sequence += 1;
      if (sequence > 1_024) {
        return Promise.reject(new Error("market_research_cost_event_limit"));
      }
      const safeEvent: Omit<ExaCostEvent, "requestId"> & { eventId: string; requestId?: string } = {
        eventId: `${streamId}:${sequence}`,
        operation: event.operation,
        outcome: event.outcome,
        costUsd: event.costUsd,
        late: event.late,
        observedAt: event.observedAt,
      };
      if (event.requestId !== undefined && /^[A-Za-z0-9:._-]{1,256}$/.test(event.requestId)) {
        safeEvent.requestId = event.requestId;
      }
      const body = {
        operation: "recordExaCostEvent",
        ...target,
        event: safeEvent,
      };
      // Queue the entire delivery with the edition's other callbacks, including retries
      // of this event ID. Late SDK costs retain their original accounting capability and
      // do not use the cancelled research signal.
      return this.enqueue(target.editionId, async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const response = await this.post(body);
            if (response.accepted !== true) throw new Error("market_research_cost_event_rejected");
            return;
          } catch {
            if (attempt === 2) throw new Error("market_research_cost_event_delivery_failed");
            await new Promise<void>((resolve) => setTimeout(resolve, (attempt + 1) * 100));
          }
        }
      });
    };
  }

  async heartbeat(
    request: ResearchLease,
    stage: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const response = await this.request(request.editionId, { operation: "heartbeat", ...leaseFields(request), stage }, signal);
    return response.accepted === true;
  }

  async appendEvidence(
    request: ResearchLease,
    sequence: number,
    evidence: readonly MarketResearchEvidenceItem[],
    signal?: AbortSignal,
  ): Promise<boolean> {
    const response = await this.request(request.editionId, { operation: "appendEvidence", ...leaseFields(request), sequence, evidence }, signal);
    return response.accepted === true;
  }

  async loadEvidence(
    request: ResearchLease,
    signal?: AbortSignal,
  ): Promise<readonly MarketResearchEvidenceItem[]> {
    const response = await this.request(request.editionId, { operation: "loadEvidence", ...leaseFields(request) }, signal);
    if (response.accepted !== true || !Array.isArray(response.evidence)) throw new Error("edition_lease_lost");
    return response.evidence.map((item) => marketResearchEvidenceItemSchema.parse(item));
  }

  async complete(result: MarketResearchJobResult, signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await this.request(result.editionId, { operation: "complete", result }, signal);
      return response.accepted === true;
    } catch (error) {
      if (error instanceof Error && error.message === "market_research_convex_rejected") {
        throw new Error("composition_schema_invalid", { cause: error });
      }
      throw error;
    }
  }

  async fail(
    request: ResearchLease,
    code: MarketResearchSafeErrorCode,
    retryable: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request(request.editionId, { operation: "fail", ...leaseFields(request), code, retryable }, signal);
  }

  private enqueue<T>(editionId: string, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const previous = this.pendingEditions.get(editionId) ?? Promise.resolve();
    const delivery = previous.then(() => {
      signal?.throwIfAborted();
      return operation();
    });
    const release = () => {
      if (this.pendingEditions.get(editionId) === tail) this.pendingEditions.delete(editionId);
    };
    // Recover the queue after either outcome without swallowing the caller's failure.
    const tail = delivery.then(release, release);
    this.pendingEditions.set(editionId, tail);
    return delivery;
  }

  private request(editionId: string, body: Readonly<Record<string, unknown>> & { readonly operation: string }, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.enqueue(editionId, () => this.post(body, signal), signal);
  }

  private async post(body: Readonly<Record<string, unknown>> & { readonly operation: string }, signal?: AbortSignal): Promise<Record<string, unknown>> {
    // The per-request timeout starts only after this edition admits the callback.
    signal?.throwIfAborted();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    let httpStatus: number | null = null;
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
      httpStatus = response.status;
      if (!response.ok) throw new Error("market_research_convex_rejected");
      const parsed = await response.json() as unknown;
      if (typeof parsed !== "object" || parsed === null) throw new Error("market_research_convex_invalid_response");
      return parsed as Record<string, unknown>;
    } catch (error) {
      this.options.logger.error("market_research_convex_operation_failed", {
        operation: body.operation,
        httpStatus,
        code: error instanceof Error ? error.message.slice(0, 100) : "market_research_convex_failed",
      });
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}
