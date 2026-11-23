import type { Logger } from "../runtime/logger.js";
import type { JournalRunRequest } from "./contracts.js";
import type { JournalAgentRunner } from "./runner.js";

export const DEFAULT_JOURNAL_RUN_TIMEOUT_MS = 270_000;
const DEFAULT_MAX_ACTIVE_RUNS = 8;
const DEFAULT_MAX_CANCELED_TOMBSTONES = 512;
const DEFAULT_CANCELED_TOMBSTONE_TTL_MS = 15 * 60 * 1_000;

export type JournalRunSubmitResult =
  | { type: "accepted"; runId: string }
  | { type: "duplicate"; runId: string }
  | { type: "already_canceled"; runId: string }
  | { type: "conflict" }
  | { type: "capacity" }
  | { type: "not_accepting" };

export type JournalRunCancelResult =
  | { type: "canceled"; runId: string }
  | { type: "conflict" };

interface ActiveJournalRun {
  ownerId: string;
  controller: AbortController;
  task: Promise<void>;
}

interface TerminalTombstone {
  ownerId: string;
  kind: "canceled" | "completed";
  expiresAt: number;
}

export interface JournalJobRegistryOptions {
  runner: JournalAgentRunner;
  logger: Logger;
  maxActiveRuns?: number;
  maxCanceledTombstones?: number;
  canceledTombstoneTtlMs?: number;
  runTimeoutMs?: number;
  now?: () => number;
}

export interface JournalJobRegistryBoundary {
  submit(request: JournalRunRequest): JournalRunSubmitResult;
  cancel(runId: string, ownerId: string): JournalRunCancelResult;
}

export class JournalJobRegistry implements JournalJobRegistryBoundary {
  private readonly activeRuns = new Map<string, ActiveJournalRun>();
  private readonly terminalTombstones = new Map<string, TerminalTombstone>();
  private readonly maxActiveRuns: number;
  private readonly maxCanceledTombstones: number;
  private readonly canceledTombstoneTtlMs: number;
  private readonly runTimeoutMs: number;
  private readonly now: () => number;
  private accepting = true;

  constructor(private readonly options: JournalJobRegistryOptions) {
    this.maxActiveRuns = options.maxActiveRuns ?? DEFAULT_MAX_ACTIVE_RUNS;
    this.maxCanceledTombstones = options.maxCanceledTombstones ?? DEFAULT_MAX_CANCELED_TOMBSTONES;
    this.canceledTombstoneTtlMs = options.canceledTombstoneTtlMs ?? DEFAULT_CANCELED_TOMBSTONE_TTL_MS;
    this.runTimeoutMs = options.runTimeoutMs ?? DEFAULT_JOURNAL_RUN_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  submit(request: JournalRunRequest): JournalRunSubmitResult {
    this.pruneTombstones();
    if (!this.accepting) {
      return { type: "not_accepting" };
    }

    const existing = this.activeRuns.get(request.runId);
    if (existing !== undefined) {
      return existing.ownerId === request.ownerId
        ? { type: "duplicate", runId: request.runId }
        : { type: "conflict" };
    }

    const tombstone = this.terminalTombstones.get(request.runId);
    if (tombstone !== undefined) {
      if (tombstone.ownerId !== request.ownerId) {
        return { type: "conflict" };
      }
      return tombstone.kind === "canceled"
        ? { type: "already_canceled", runId: request.runId }
        : { type: "duplicate", runId: request.runId };
    }

    if (this.activeRuns.size >= this.maxActiveRuns) {
      return { type: "capacity" };
    }

    const controller = new AbortController();
    const record: ActiveJournalRun = {
      ownerId: request.ownerId,
      controller,
      task: Promise.resolve(),
    };
    this.activeRuns.set(request.runId, record);

    const task = this.executeRun(request, controller, record);
    record.task = task;
    return { type: "accepted", runId: request.runId };
  }

  cancel(runId: string, ownerId: string): JournalRunCancelResult {
    this.pruneTombstones();

    const active = this.activeRuns.get(runId);
    if (active !== undefined && active.ownerId !== ownerId) {
      return { type: "conflict" };
    }
    const existingTombstone = this.terminalTombstones.get(runId);
    if (existingTombstone !== undefined && existingTombstone.ownerId !== ownerId) {
      return { type: "conflict" };
    }

    this.recordTombstone(runId, ownerId, "canceled");
    if (active !== undefined) {
      active.controller.abort(new Error("journal_run_canceled"));
    }
    return { type: "canceled", runId };
  }

  activeCount(): number {
    return this.activeRuns.size;
  }

  async waitForIdle(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.activeRuns.values(), (entry) => entry.task),
    );
  }

  async dispose(): Promise<void> {
    this.accepting = false;
    for (const active of this.activeRuns.values()) {
      active.controller.abort(new Error("journal_service_shutdown"));
    }
    await this.waitForIdle();
    this.activeRuns.clear();
    this.terminalTombstones.clear();
  }

  private async executeRun(
    request: JournalRunRequest,
    controller: AbortController,
    record: ActiveJournalRun,
  ): Promise<void> {
    const timer = setTimeout(() => {
      controller.abort(new Error("journal_run_timeout"));
    }, this.runTimeoutMs);
    timer.unref();
    try {
      await this.options.runner.run(request, controller.signal);
    } catch (error) {
      this.options.logger.error("journal_job_unhandled_error", {
        runId: request.runId,
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown_error",
      });
    } finally {
      clearTimeout(timer);
      if (this.activeRuns.get(request.runId) === record) {
        this.activeRuns.delete(request.runId);
      }
      if (this.accepting && this.terminalTombstones.get(request.runId)?.kind !== "canceled") {
        this.recordTombstone(request.runId, request.ownerId, "completed");
      }
    }
  }

  private recordTombstone(
    runId: string,
    ownerId: string,
    kind: "canceled" | "completed",
  ): void {
    this.terminalTombstones.delete(runId);
    this.terminalTombstones.set(runId, {
      ownerId,
      kind,
      expiresAt: this.now() + this.canceledTombstoneTtlMs,
    });
    while (this.terminalTombstones.size > this.maxCanceledTombstones) {
      const oldestKey = this.terminalTombstones.keys().next().value;
      if (oldestKey === undefined) break;
      this.terminalTombstones.delete(oldestKey);
    }
  }

  private pruneTombstones(): void {
    const current = this.now();
    for (const [runId, entry] of this.terminalTombstones) {
      if (entry.expiresAt <= current) {
        this.terminalTombstones.delete(runId);
      }
    }
  }
}
