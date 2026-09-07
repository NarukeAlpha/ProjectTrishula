/* oxlint-disable anti-slop/no-unknown-parameters -- Caught failures are reduced to fixed safe errors before persistence. */
import type { Logger } from "../runtime/logger.js";
import type { MorningPaperComposer } from "./composer.js";
import type { MarketResearchCallbacks } from "./convex-client.js";
import {
  marketResearchEvidenceItemSchema, marketResearchJobRequestSchema, marketResearchJobResultSchema,
  morningPaperEvidenceSchema, isRetryableMarketResearchError, parseMarketResearchSafeErrorCode,
  type MarketResearchEvidenceItem, type MarketResearchJobRequest, type MarketResearchJobResult,
  type MorningPaperEvidenceV1,
} from "./contracts.js";
import { createMorningPaperResearchTools } from "./agent-tools.js";
import { materializeDeliveryParts } from "./delivery.js";
import { MarketResearchExaError, classifyExaError } from "./exa-errors.js";
import { initialExaUsageFromEvidence, type ExaInitialUsage, type MarketResearchExaClient } from "./exa-client.js";
import { evidenceCheckpoints } from "./source-normalizer-evidence.js";
import { sha256 } from "./source-normalizer.js";

export interface MarketResearchRunnerReadiness { ready: boolean; reason?: string; }
export interface MarketResearchRunner {
  initialize(): Promise<void>;
  readiness(): MarketResearchRunnerReadiness;
  run(request: MarketResearchJobRequest, signal?: AbortSignal): Promise<MarketResearchJobResult>;
  dispose(): Promise<void>;
}
export interface MarketResearchRunnerOptions {
  exaClient: (request: MarketResearchJobRequest, initialUsage: ExaInitialUsage) => MarketResearchExaClient;
  composer: MorningPaperComposer;
  callbacks: MarketResearchCallbacks;
  logger: Logger;
  now?: () => Date;
}

function collectionCompleteEvidence(request: MarketResearchJobRequest, retrievedAt: string): MarketResearchEvidenceItem {
  // Stable identity supports retained editions from the previous collector.
  const detail = "The bounded Exa Search and Contents collection checkpoint is complete.";
  return marketResearchEvidenceItemSchema.parse({
    evidenceId: "exa-collection-complete", kind: "source_status", provider: "Project Trishula",
    sourcePolicy: "approved", retrievedAt, freshness: "fresh", contentStatus: "available",
    highlights: [], normalizedClaims: [detail], contentHash: sha256(`${request.editionId}:${detail}`),
  });
}

function retainedPacket(request: MarketResearchJobRequest, records: readonly MarketResearchEvidenceItem[], generatedAt: string): MorningPaperEvidenceV1 {
  const byId = new Map<string, MarketResearchEvidenceItem>();
  for (const item of records) {
    const previous = byId.get(item.evidenceId);
    if (previous !== undefined && previous.contentHash !== item.contentHash) throw new Error("composition_schema_invalid");
    if (previous === undefined) byId.set(item.evidenceId, item);
  }
  if (request.retainedEvidenceIds.some((id) => !byId.has(id))) throw new Error("evidence_below_minimum");
  return morningPaperEvidenceSchema.parse({
    schemaVersion: 1, editionId: request.editionId, generatedAt, session: request.session,
    primarySymbols: request.preferences.primarySymbols, sectorSymbols: request.preferences.sectorSymbols,
    discoverySymbols: request.preferences.discoverySymbols, sourcePolicyVersion: request.preferences.sourcePolicyVersion,
    requestedSourceStatus: request.preferences.requestedSources.map((source) => ({
      source, status: "no_material_item", detail: "No public material from this source has been retained yet.", sourceIds: [],
    })),
    evidence: [...byId.values()], missingFields: [], conflicts: [], allowedSourceIds: [...byId.keys()],
  });
}

function safeFailure(error: unknown) {
  if (error instanceof MarketResearchExaError) return { code: error.decision.code, retryable: error.decision.retryable };
  const code = parseMarketResearchSafeErrorCode(error instanceof Error ? error.message : "exa_unavailable");
  if (code !== null) return { code, retryable: isRetryableMarketResearchError(code) };
  const decision = classifyExaError(error);
  return { code: decision.code, retryable: decision.retryable };
}

class DefaultMarketResearchRunner implements MarketResearchRunner {
  private readonly now: () => Date;
  private disposed = false;
  private initializationError: string | undefined;

  constructor(private readonly options: MarketResearchRunnerOptions) { this.now = options.now ?? (() => new Date()); }

  async initialize(): Promise<void> {
    try {
      await this.options.composer.initialize();
      this.initializationError = undefined;
    } catch (error) {
      this.initializationError = error instanceof Error ? error.message : "composition_provider_not_ready";
      throw error;
    }
  }

  readiness(): MarketResearchRunnerReadiness {
    if (this.disposed) return { ready: false, reason: "market_research_disabled" };
    const composer = this.options.composer.readiness();
    return composer.ready ? { ready: true } : { ready: false, reason: this.initializationError ?? composer.reason ?? "composition_provider_not_ready" };
  }

  async run(input: MarketResearchJobRequest, signal?: AbortSignal): Promise<MarketResearchJobResult> {
    const request = marketResearchJobRequestSchema.parse(input);
    const leaseController = new AbortController();
    const relayAbort = () => leaseController.abort(signal?.reason);
    if (signal?.aborted) relayAbort();
    else signal?.addEventListener("abort", relayAbort, { once: true });
    const leaseSignal = leaseController.signal;
    let stage = "researching";
    let heartbeatInFlight = false;
    const heartbeatTimer = setInterval(() => {
      if (heartbeatInFlight || leaseSignal.aborted) return;
      heartbeatInFlight = true;
      void this.options.callbacks.heartbeat(request, stage, leaseSignal)
        .then((accepted) => { if (!accepted) leaseController.abort(new Error("edition_lease_lost")); })
        .catch(() => leaseController.abort(new Error("edition_lease_lost")))
        .finally(() => { heartbeatInFlight = false; });
    }, 30_000);
    let checkpointSequence = 20_000;
    const persist = async (items: readonly MarketResearchEvidenceItem[]) => {
      for (const checkpoint of evidenceCheckpoints(items)) {
        leaseSignal.throwIfAborted();
        if (!await this.options.callbacks.appendEvidence(request, checkpointSequence++, checkpoint, leaseSignal)) throw new Error("edition_lease_lost");
      }
    };
    try {
      leaseSignal.throwIfAborted();
      await this.requireLease(request, stage, leaseSignal);
      const retained = await this.options.callbacks.loadEvidence(request, leaseSignal);
      const packet = retainedPacket(request, retained, this.now().toISOString());
      const initialUsage = initialExaUsageFromEvidence(retained, request.exaUsage);
      const research = createMorningPaperResearchTools({
        initialEvidence: packet, preferences: request.preferences,
        exaClient: this.options.exaClient(request, initialUsage), logger: this.options.logger,
        onEvidence: persist, signal: leaseSignal, now: this.now,
      });
      this.options.logger.info("market_research_agent_started", {
        editionId: request.editionId, generation: request.generation, sourceCount: retained.length,
      });
      const edition = await this.options.composer.compose(packet, request.preferences, leaseSignal, research);
      leaseSignal.throwIfAborted();
      stage = "composing";
      await this.requireLease(request, stage, leaseSignal);
      let evidence = research.getEvidence();
      if (!evidence.evidence.some((item) => item.evidenceId === "exa-collection-complete")) {
        const marker = collectionCompleteEvidence(request, this.now().toISOString());
        await persist([marker]);
        evidence = morningPaperEvidenceSchema.parse({
          ...evidence, evidence: [...evidence.evidence, marker], allowedSourceIds: [...evidence.allowedSourceIds, marker.evidenceId],
        });
      }
      const result = marketResearchJobResultSchema.parse({
        schemaVersion: 1, dispatchId: request.dispatchId, editionId: request.editionId,
        generation: request.generation, claimToken: request.claimToken, evidence, edition,
        deliveries: materializeDeliveryParts(edition),
        exaRequestCount: evidence.evidence.filter((item) => item.evidenceId.startsWith("exa-search-slot-")).length,
        exaCostUsd: evidence.evidence.reduce((sum, item) => sum + (item.costUsd ?? 0), 0),
        completedAt: this.now().toISOString(),
      });
      if (!await this.options.callbacks.complete(result, leaseSignal)) throw new Error("edition_lease_lost");
      this.options.logger.info("market_research_job_completed", {
        editionId: request.editionId, generation: request.generation,
        sourceCount: evidence.evidence.length, exaRequestCount: result.exaRequestCount,
      });
      return result;
    } catch (error) {
      const failure = safeFailure(error);
      leaseController.abort(error);
      // A timeout has already aborted the work signal. The terminal record still
      // needs its own bounded callback so the website does not stay "researching".
      await this.options.callbacks.fail(request, failure.code, failure.retryable).catch(() => undefined);
      throw error;
    } finally {
      clearInterval(heartbeatTimer);
      signal?.removeEventListener("abort", relayAbort);
    }
  }

  async dispose(): Promise<void> { this.disposed = true; await this.options.composer.dispose(); }

  private async requireLease(request: MarketResearchJobRequest, stage: string, signal?: AbortSignal): Promise<void> {
    if (!await this.options.callbacks.heartbeat(request, stage, signal)) throw new Error("edition_lease_lost");
  }
}

export function createMarketResearchRunner(options: MarketResearchRunnerOptions): MarketResearchRunner {
  return new DefaultMarketResearchRunner(options);
}
