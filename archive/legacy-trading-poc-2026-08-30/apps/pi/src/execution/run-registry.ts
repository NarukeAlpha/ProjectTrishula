import { createHash } from "node:crypto";
import type { RunExecutionRequest } from "../contracts.js";
import { canonicalJson } from "../results/canonical-json.js";
import type { ConvexClientLike } from "../results/convex-client.js";
import type { Logger } from "../runtime/logger.js";
import type { ExecutionExecutor } from "./executor.js";
import { RunController } from "./run-controller.js";
import type { SessionCoordinator } from "./session-coordinator.js";

interface RunRecord {
  actorId: string;
  fingerprint: string;
  controller: RunController | undefined;
  state: "reserved" | "running" | "terminal";
}

export type AcceptRunResult =
  | { type: "accepted" | "duplicate"; state: "reserved" | "running" | "terminal" }
  | { type: "conflict" | "thread_busy" | "capacity" };

export type CancelRunResult = "cancellation_requested" | "terminal" | "not_found";

function fingerprint(request: RunExecutionRequest): string {
  return createHash("sha256").update(canonicalJson(request), "utf8").digest("hex");
}

function threadKey(request: RunExecutionRequest): string {
  return JSON.stringify([request.actorId, request.threadId]);
}

export interface RunRegistryOptions {
  executor: ExecutionExecutor;
  sessions: SessionCoordinator;
  convex: ConvexClientLike;
  concurrency: number;
  batchWindowMs: number;
  batchBytes: number;
  logger: Logger;
}

export class RunRegistry {
  private readonly runs = new Map<string, RunRecord>();
  private readonly activeThreads = new Map<string, string>();
  private accepting = true;
  private activeCount = 0;

  constructor(private readonly options: RunRegistryOptions) {}

  isAccepting(): boolean {
    return this.accepting;
  }

  reserve(request: RunExecutionRequest): AcceptRunResult {
    const requestFingerprint = fingerprint(request);
    const existing = this.runs.get(request.runId);
    if (existing) {
      if (existing.fingerprint !== requestFingerprint) return { type: "conflict" };
      return { type: "duplicate", state: existing.state };
    }
    if (!this.accepting || this.activeCount >= this.options.concurrency) {
      return { type: "capacity" };
    }

    const key = threadKey(request);
    if (this.activeThreads.has(key)) return { type: "thread_busy" };

    const controller = new RunController({
      request,
      executor: this.options.executor,
      sessions: this.options.sessions,
      convex: this.options.convex,
      batchWindowMs: this.options.batchWindowMs,
      batchBytes: this.options.batchBytes,
      logger: this.options.logger,
      onFinished: (finished) => this.finish(request, finished),
    });
    this.runs.set(request.runId, {
      actorId: request.actorId,
      fingerprint: requestFingerprint,
      controller,
      state: "reserved",
    });
    this.activeThreads.set(key, request.runId);
    this.activeCount += 1;
    return { type: "accepted", state: "reserved" };
  }

  start(runId: string): void {
    const record = this.runs.get(runId);
    if (!record || record.state !== "reserved" || !record.controller) return;
    record.state = "running";
    record.controller.start();
  }

  cancel(runId: string, actorId: string): CancelRunResult {
    const record = this.runs.get(runId);
    if (!record || record.actorId !== actorId) return "not_found";
    if (record.state === "terminal" || !record.controller) return "terminal";
    void record.controller.cancel().catch((error) => {
      this.options.logger.error("run_cancel_failed", {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return "cancellation_requested";
  }

  async shutdown(): Promise<void> {
    this.accepting = false;
    const controllers = [...this.runs.values()]
      .flatMap((record) => record.controller ? [record.controller] : []);
    await Promise.allSettled(controllers.map((controller) => controller.shutdown()));
  }

  async waitForIdle(): Promise<void> {
    const controllers = [...this.runs.values()]
      .flatMap((record) => record.controller ? [record.controller] : []);
    await Promise.allSettled(controllers.map((controller) => controller.wait()));
  }

  private finish(request: RunExecutionRequest, controller: RunController): void {
    const record = this.runs.get(request.runId);
    if (!record || record.controller !== controller) return;
    record.controller = undefined;
    record.state = "terminal";
    this.activeThreads.delete(threadKey(request));
    this.activeCount -= 1;
  }
}
