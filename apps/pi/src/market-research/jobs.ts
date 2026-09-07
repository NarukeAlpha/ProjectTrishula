/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-known-value-widening -- Job failures enter as caught causes and are normalized to the fixed safe failure contract here. */
import { ZodError } from "zod";
import type { Logger } from "../runtime/logger.js";
import {
  marketResearchFingerprint,
  isRetryableMarketResearchError,
  parseMarketResearchSafeErrorCode,
  type MarketResearchJobRequest,
  type MarketResearchSafeErrorCode,
} from "./contracts.js";
import type { MarketResearchRunner } from "./runner.js";
import { marketResearchValidationDiagnostics } from "./validation-diagnostics.js";

export type MarketResearchJobStatus =
  | { jobId: string; status: "running" }
  | { jobId: string; status: "completed" }
  | { jobId: string; status: "failed"; code: MarketResearchSafeErrorCode; retryable: boolean };

export type MarketResearchJobSubmission =
  | { type: "accepted" | "duplicate"; job: MarketResearchJobStatus }
  | { type: "conflict" | "capacity" | "not_accepting" };

interface JobRecord {
  request: MarketResearchJobRequest;
  fingerprint: string;
  controller: AbortController;
  startedAt: number;
  status: "running" | "completed" | "failed";
  code?: MarketResearchSafeErrorCode;
  retryable?: boolean;
  terminalAt?: number;
}

export interface MarketResearchJobRegistryOptions {
  runner: MarketResearchRunner;
  logger: Logger;
  maxActiveJobs?: number;
  maxRetainedJobs?: number;
  terminalTtlMs?: number;
  maxRuntimeMs?: number;
  now?: () => number;
}

function normalizedFailure(error: unknown): { code: MarketResearchSafeErrorCode; retryable: boolean } {
  const raw = error instanceof Error ? error.message : "exa_unavailable";
  const code = parseMarketResearchSafeErrorCode(raw) ?? "exa_unavailable";
  return { code, retryable: isRetryableMarketResearchError(code) };
}

export class MarketResearchJobRegistry {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly maxActiveJobs: number;
  private readonly maxRetainedJobs: number;
  private readonly terminalTtlMs: number;
  private readonly maxRuntimeMs: number;
  private readonly now: () => number;
  private accepting = true;

  constructor(private readonly options: MarketResearchJobRegistryOptions) {
    this.maxActiveJobs = options.maxActiveJobs ?? 2;
    this.maxRetainedJobs = options.maxRetainedJobs ?? 64;
    this.terminalTtlMs = options.terminalTtlMs ?? 30 * 60 * 1_000;
    this.maxRuntimeMs = options.maxRuntimeMs ?? 10 * 60 * 1_000;
    this.now = options.now ?? Date.now;
  }

  submit(request: MarketResearchJobRequest): MarketResearchJobSubmission {
    this.cleanup();
    if (!this.accepting) return { type: "not_accepting" };
    const fingerprint = marketResearchFingerprint(request);
    const existing = this.jobs.get(request.dispatchId);
    if (existing) {
      return existing.fingerprint === fingerprint
        ? { type: "duplicate", job: this.snapshot(request.dispatchId, existing) }
        : { type: "conflict" };
    }
    if (this.tasks.size >= this.maxActiveJobs || this.jobs.size >= this.maxRetainedJobs) return { type: "capacity" };
    const record: JobRecord = {
      request,
      fingerprint,
      controller: new AbortController(),
      startedAt: this.now(),
      status: "running",
    };
    this.jobs.set(request.dispatchId, record);
    const task = this.execute(record);
    this.tasks.set(request.dispatchId, task);
    void task.finally(() => {
      if (this.tasks.get(request.dispatchId) === task) this.tasks.delete(request.dispatchId);
    });
    return { type: "accepted", job: { jobId: request.dispatchId, status: "running" } };
  }

  get(jobId: string, ownerId: string): MarketResearchJobStatus | undefined {
    this.cleanup();
    const record = this.jobs.get(jobId);
    return record?.request.ownerId === ownerId ? this.snapshot(jobId, record) : undefined;
  }

  cancel(jobId: string, ownerId: string): "cancelled" | "not_found" {
    const record = this.jobs.get(jobId);
    if (!record || record.request.ownerId !== ownerId || record.status !== "running") return "not_found";
    this.jobs.delete(jobId);
    record.controller.abort(new Error("market_research_cancelled"));
    return "cancelled";
  }

  async dispose(): Promise<void> {
    this.accepting = false;
    for (const record of this.jobs.values()) {
      if (record.status === "running") record.controller.abort(new Error("market_research_shutdown"));
    }
    await Promise.allSettled(this.tasks.values());
    this.tasks.clear();
    this.jobs.clear();
  }

  private async execute(record: JobRecord): Promise<void> {
    const timeout = setTimeout(() => {
      record.controller.abort(new Error("composition_timeout"));
    }, this.maxRuntimeMs);
    try {
      await this.options.runner.run(record.request, record.controller.signal);
      if (this.jobs.get(record.request.dispatchId) !== record) return;
      record.status = "completed";
      record.terminalAt = this.now();
    } catch (error) {
      if (this.jobs.get(record.request.dispatchId) !== record) return;
      const timeoutReason = record.controller.signal.reason;
      const errorFailure = normalizedFailure(error);
      const failure = timeoutReason instanceof Error
        && timeoutReason.message === "composition_timeout"
        && errorFailure.code === "exa_unavailable"
        ? normalizedFailure(timeoutReason)
        : errorFailure;
      record.status = "failed";
      record.code = failure.code;
      record.retryable = failure.retryable;
      record.terminalAt = this.now();
      const details = {
        editionId: record.request.editionId,
        generation: record.request.generation,
        code: failure.code,
      };
      this.options.logger.error("market_research_job_failed", error instanceof ZodError
        ? { ...details, validation: marketResearchValidationDiagnostics(error) }
        : details);
    } finally {
      clearTimeout(timeout);
    }
  }

  private snapshot(jobId: string, record: JobRecord): MarketResearchJobStatus {
    if (record.status === "running") return { jobId, status: "running" };
    if (record.status === "completed") return { jobId, status: "completed" };
    return { jobId, status: "failed", code: record.code ?? "exa_unavailable", retryable: record.retryable ?? false };
  }

  private cleanup(): void {
    const cutoff = this.now() - this.terminalTtlMs;
    for (const [jobId, record] of this.jobs) {
      if (record.terminalAt !== undefined && record.terminalAt < cutoff) this.jobs.delete(jobId);
    }
  }
}
