/* oxlint-disable anti-slop/no-unknown-parameters -- Operations can reject with untyped SDK errors; only caller-classified fixed codes enter telemetry. */
import type { ClaimedPublication, MarketResearchSafeError } from "./contracts.js";
import { logger } from "../runtime/logger.js";

type PublicationOperation = "attempt" | "send" | "reconcile" | "verify_starter" | "heartbeat" | "acknowledge" | "adopt" | "charts";

interface PublicationObservation {
  outcome: "started" | "sent" | "found" | "none" | "duplicate" | "verified" | "unverified" | "accepted" | "fence_rejected" | "failed" | "skipped" | "complete" | "partial";
  acknowledgement?: "sent" | "failed" | undefined;
  code?: MarketResearchSafeError | undefined;
  retryable?: boolean | undefined;
  retryAfterMs?: number | undefined;
  duplicateIncident?: boolean | undefined;
  requestedCharts?: number | undefined;
  renderedCharts?: number | undefined;
  unavailableCharts?: number | undefined;
  attachmentCount?: number | undefined;
}

export interface PublicationEvent extends PublicationObservation {
  event: "market_research_publication";
  editionId: string;
  guildId: string;
  kind: "starter" | "reply";
  sequence: number;
  attempt: number;
  retryCount: number;
  operation: PublicationOperation;
  durationMs?: number | undefined;
}

export type PublicationLogSink = (event: PublicationEvent) => void;

function writePublicationEvent(event: PublicationEvent): void {
  const { code, ...details } = event;
  const fields = code === undefined ? details : { ...details, code };
  if (event.outcome === "failed" || event.outcome === "duplicate" || event.outcome === "fence_rejected" || code !== undefined) {
    logger.warn("Market-research publication operation.", fields);
  } else {
    logger.info("Market-research publication operation.", fields);
  }
}

/** Delivery evidence only. A sent message is not an acknowledged part or a published edition. */
export class PublicationTelemetry {
  constructor(
    private readonly sink: PublicationLogSink = writePublicationEvent,
    private readonly monotonicNow: () => number = () => performance.now(),
  ) {}

  record(claim: ClaimedPublication, operation: PublicationOperation, observation: PublicationObservation): void {
    this.emit(claim, operation, () => observation);
  }

  async measure<T>(
    claim: ClaimedPublication,
    operation: PublicationOperation,
    run: () => Promise<T>,
    describe: (result: T) => PublicationObservation,
    classifyFailure: (error: unknown) => PublicationObservation = () => ({ outcome: "failed" }),
  ): Promise<T> {
    const startedAt = this.now();
    try {
      const result = await run();
      this.emit(claim, operation, () => describe(result), startedAt);
      return result;
    } catch (error) {
      this.emit(claim, operation, () => classifyFailure(error), startedAt);
      throw error;
    }
  }

  private now(): number | undefined {
    try {
      const value = this.monotonicNow();
      return Number.isFinite(value) ? value : undefined;
    } catch {
      // Measurement must not affect delivery if an injected clock fails.
      return undefined;
    }
  }

  private emit(
    claim: ClaimedPublication,
    operation: PublicationOperation,
    describe: () => PublicationObservation,
    startedAt?: number,
  ): void {
    try {
      const observation = describe();
      const endedAt = startedAt === undefined ? undefined : this.now();
      // Project each field explicitly. Never spread claims, SDK results, or error objects.
      this.sink({
        event: "market_research_publication",
        editionId: claim.editionId,
        guildId: claim.guildId,
        kind: claim.delivery.kind,
        sequence: claim.delivery.sequence,
        attempt: claim.delivery.attempts,
        retryCount: Math.max(0, claim.delivery.attempts - 1),
        operation,
        outcome: observation.outcome,
        durationMs: startedAt === undefined || endedAt === undefined ? undefined : Math.max(0, endedAt - startedAt),
        acknowledgement: observation.acknowledgement,
        code: observation.code,
        retryable: observation.retryable,
        retryAfterMs: observation.retryAfterMs,
        duplicateIncident: observation.duplicateIncident,
        requestedCharts: observation.requestedCharts,
        renderedCharts: observation.renderedCharts,
        unavailableCharts: observation.unavailableCharts,
        attachmentCount: observation.attachmentCount,
      });
    } catch {
      // A broken telemetry sink or projector must never retry or suppress a publication.
    }
  }
}
