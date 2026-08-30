import { createHash } from "node:crypto";
import type { Logger } from "../runtime/logger.js";
import { normalizeExecutionError, type ExecutionErrorCode } from "../runtime/provider-errors.js";
import type { DiscordAgentRequest, DiscordAgentResponse } from "./contracts.js";
import {
  DiscordAgentOutputError,
  type DiscordAgentOutputErrorCode,
} from "./errors.js";
import type { DiscordAgentRunner } from "./runner.js";

const DEFAULT_MAX_JOBS = 256;
const DEFAULT_MAX_ACTIVE_JOBS = 8;
const DEFAULT_MAX_RUN_MS = 9 * 60 * 1_000;
const DEFAULT_TERMINAL_TTL_MS = 15 * 60 * 1_000;
const MAX_CLEANUP_INTERVAL_MS = 60_000;

type DiscordAgentJobErrorCode = ExecutionErrorCode | DiscordAgentOutputErrorCode;

export type DiscordAgentJobStatus =
  | { jobId: string; status: "running" }
  | { jobId: string; status: "completed"; result: DiscordAgentResponse }
  | {
      jobId: string;
      status: "failed";
      code: DiscordAgentJobErrorCode;
      retryable: boolean;
    };

export type DiscordAgentJobSubmission =
  | { type: "accepted" | "duplicate"; job: DiscordAgentJobStatus }
  | { type: "conflict" }
  | { type: "capacity" }
  | { type: "not_accepting" };

export interface DiscordAgentJobRegistryOptions {
  runner: DiscordAgentRunner;
  logger: Logger;
  maxJobs?: number;
  maxActiveJobs?: number;
  maxRunMs?: number;
  terminalTtlMs?: number;
  now?: () => number;
}

interface JobRecord {
  readonly jobId: string;
  readonly requestId: string;
  readonly profile: DiscordAgentRequest["profile"];
  readonly fingerprint: string;
  readonly startedAt: number;
  readonly controller: AbortController;
  timeout?: NodeJS.Timeout;
  status: "running" | "completed" | "failed";
  result?: DiscordAgentResponse;
  code?: DiscordAgentJobErrorCode;
  retryable?: boolean;
  terminalAt?: number;
}

function fingerprint(request: DiscordAgentRequest): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

export class DiscordAgentJobRegistry {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly activeTasks = new Map<string, Promise<void>>();
  private readonly runner: DiscordAgentRunner;
  private readonly logger: Logger;
  private readonly maxJobs: number;
  private readonly maxActiveJobs: number;
  private readonly maxRunMs: number;
  private readonly terminalTtlMs: number;
  private readonly now: () => number;
  private readonly cleanupTimer: NodeJS.Timeout;
  private accepting = true;
  private disposePromise: Promise<void> | undefined;

  constructor(options: DiscordAgentJobRegistryOptions) {
    this.runner = options.runner;
    this.logger = options.logger;
    this.maxJobs = positiveInteger(options.maxJobs ?? DEFAULT_MAX_JOBS, "maxJobs");
    this.maxActiveJobs = positiveInteger(
      options.maxActiveJobs ?? DEFAULT_MAX_ACTIVE_JOBS,
      "maxActiveJobs",
    );
    this.maxRunMs = positiveInteger(options.maxRunMs ?? DEFAULT_MAX_RUN_MS, "maxRunMs");
    this.terminalTtlMs = positiveInteger(
      options.terminalTtlMs ?? DEFAULT_TERMINAL_TTL_MS,
      "terminalTtlMs",
    );
    this.now = options.now ?? Date.now;
    this.cleanupTimer = setInterval(
      () => this.cleanupExpired(),
      Math.min(this.terminalTtlMs, MAX_CLEANUP_INTERVAL_MS),
    );
    this.cleanupTimer.unref();
  }

  submit(request: DiscordAgentRequest): DiscordAgentJobSubmission {
    this.cleanupExpired();
    if (!this.accepting) return { type: "not_accepting" };

    const requestFingerprint = fingerprint(request);
    const existing = this.jobs.get(request.requestId);
    if (existing) {
      if (existing.fingerprint !== requestFingerprint) {
        this.logConflict(request, "request_id_conflict");
        return { type: "conflict" };
      }
      return { type: "duplicate", job: this.snapshot(existing) };
    }

    if (this.activeTasks.has(request.requestId)) {
      this.logConflict(request, "request_id_cancelling");
      return { type: "conflict" };
    }

    if (
      this.activeTasks.size >= this.maxActiveJobs
      || this.retainedJobCount() >= this.maxJobs
    ) return { type: "capacity" };

    const startedAt = this.now();
    const record: JobRecord = {
      jobId: request.requestId,
      requestId: request.requestId,
      profile: request.profile,
      fingerprint: requestFingerprint,
      startedAt,
      controller: new AbortController(),
      status: "running",
    };
    record.timeout = setTimeout(() => this.timeout(record), this.maxRunMs);
    record.timeout.unref();
    this.jobs.set(record.jobId, record);
    this.logger.info("discord_agent_job_started", {
      profile: record.profile,
      requestId: record.requestId,
      status: record.status,
      duration: 0,
    });
    const task = this.execute(record, request);
    this.activeTasks.set(record.requestId, task);
    void task.then(() => {
      if (this.activeTasks.get(record.requestId) === task) this.activeTasks.delete(record.requestId);
    });
    return { type: "accepted", job: { jobId: record.jobId, status: "running" } };
  }

  get(jobId: string): DiscordAgentJobStatus | undefined {
    this.cleanupExpired();
    const record = this.jobs.get(jobId);
    return record ? this.snapshot(record) : undefined;
  }

  cancel(jobId: string): "cancelled" | "not_found" {
    this.cleanupExpired();
    const record = this.jobs.get(jobId);
    if (!record || record.status !== "running") return "not_found";

    this.jobs.delete(jobId);
    this.clearDeadline(record);
    record.controller.abort(new Error("discord_agent_job_cancelled"));
    this.logger.info("discord_agent_job_cancelled", {
      profile: record.profile,
      requestId: record.requestId,
      status: "cancelled",
      duration: this.elapsed(record),
      code: "cancelled",
    });
    return "cancelled";
  }

  dispose(): Promise<void> {
    this.disposePromise ??= (async () => {
      this.accepting = false;
      clearInterval(this.cleanupTimer);
      for (const [jobId, record] of this.jobs) {
        if (record.status !== "running") continue;
        this.jobs.delete(jobId);
        this.clearDeadline(record);
        record.controller.abort(new Error("discord_agent_jobs_shutdown"));
      }
      await Promise.allSettled(this.activeTasks.values());
      this.activeTasks.clear();
      this.jobs.clear();
    })();
    return this.disposePromise;
  }

  private async execute(record: JobRecord, request: DiscordAgentRequest): Promise<void> {
    try {
      const result = await this.runner.run(request, record.controller.signal);
      if (this.jobs.get(record.jobId) !== record || record.status !== "running") return;
      record.status = "completed";
      record.result = result;
      record.terminalAt = this.now();
      this.clearDeadline(record);
      this.logger.info("discord_agent_job_completed", {
        profile: record.profile,
        requestId: record.requestId,
        status: record.status,
        duration: this.elapsed(record),
      });
    } catch (error) {
      if (this.jobs.get(record.jobId) !== record || record.status !== "running") return;
      const normalized = error instanceof DiscordAgentOutputError
        ? { code: error.code, retryable: error.retryable }
        : normalizeExecutionError(
          error instanceof Error ? error : new Error("Discord agent job failed."),
        );
      record.status = "failed";
      record.code = normalized.code;
      record.retryable = normalized.retryable;
      record.terminalAt = this.now();
      this.clearDeadline(record);
      this.logger.error("discord_agent_job_failed", {
        profile: record.profile,
        requestId: record.requestId,
        status: record.status,
        duration: this.elapsed(record),
        code: normalized.code,
      });
    } finally {
      this.clearDeadline(record);
    }
  }

  private timeout(record: JobRecord): void {
    if (this.jobs.get(record.jobId) !== record || record.status !== "running") return;
    record.status = "failed";
    record.code = "provider_timeout";
    record.retryable = true;
    record.terminalAt = this.now();
    this.clearDeadline(record);
    record.controller.abort(new Error("discord_agent_job_timed_out"));
    this.logger.error("discord_agent_job_failed", {
      profile: record.profile,
      requestId: record.requestId,
      status: record.status,
      duration: this.elapsed(record),
      code: record.code,
    });
  }

  private clearDeadline(record: JobRecord): void {
    if (!record.timeout) return;
    clearTimeout(record.timeout);
    delete record.timeout;
  }

  private snapshot(record: JobRecord): DiscordAgentJobStatus {
    if (record.status === "running") return { jobId: record.jobId, status: "running" };
    if (record.status === "completed" && record.result) {
      return { jobId: record.jobId, status: "completed", result: record.result };
    }
    return {
      jobId: record.jobId,
      status: "failed",
      code: record.code ?? "execution_failed",
      retryable: record.retryable ?? true,
    };
  }

  private cleanupExpired(): void {
    const cutoff = this.now() - this.terminalTtlMs;
    for (const [jobId, record] of this.jobs) {
      if (record.status !== "running" && record.terminalAt !== undefined && record.terminalAt <= cutoff) {
        this.jobs.delete(jobId);
      }
    }
  }

  private retainedJobCount(): number {
    const retained = new Set(this.jobs.keys());
    for (const requestId of this.activeTasks.keys()) retained.add(requestId);
    return retained.size;
  }

  private logConflict(request: DiscordAgentRequest, code: string): void {
    this.logger.warn("discord_agent_job_conflict", {
      profile: request.profile,
      requestId: request.requestId,
      status: "conflict",
      duration: 0,
      code,
    });
  }

  private elapsed(record: JobRecord): number {
    return Math.max(0, this.now() - record.startedAt);
  }
}
