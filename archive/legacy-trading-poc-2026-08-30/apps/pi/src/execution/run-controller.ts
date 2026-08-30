import type { RunExecutionRequest, TerminalPiEvent } from "../contracts.js";
import { ConvexRequestError, type ConvexClientLike } from "../results/convex-client.js";
import { ResultPublisher } from "../results/result-publisher.js";
import type { Logger } from "../runtime/logger.js";
import { normalizeExecutionError } from "../runtime/provider-errors.js";
import type { ExecutionExecutor, SessionScope } from "./executor.js";
import type { SessionCoordinator } from "./session-coordinator.js";

export interface RunControllerOptions {
  request: RunExecutionRequest;
  executor: ExecutionExecutor;
  sessions: SessionCoordinator;
  convex: ConvexClientLike;
  batchWindowMs: number;
  batchBytes: number;
  logger: Logger;
  onFinished(controller: RunController): void;
}

export class RunController {
  private readonly abortController = new AbortController();
  private readonly publisher: ResultPublisher;
  private readonly scope: SessionScope;
  private closing = false;
  private leaseLost = false;
  private started = false;
  private execution: Promise<void> = Promise.resolve();
  private sessionInvalidation: Promise<void> | undefined;

  constructor(private readonly options: RunControllerOptions) {
    this.scope = { actorId: options.request.actorId, threadId: options.request.threadId };
    this.publisher = new ResultPublisher({
      request: options.request,
      convex: options.convex,
      batchWindowMs: options.batchWindowMs,
      batchBytes: options.batchBytes,
      logger: options.logger,
      onLeaseLost: () => this.handleLeaseLost(),
      onTransportFailure: (error) => this.handleTransportFailure(error),
    });
  }

  get runId(): string {
    return this.options.request.runId;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.options.sessions.enter(this.scope);
    this.publisher.startLiveness();
    this.execution = this.run();
  }

  async cancel(): Promise<void> {
    if (this.closing || this.publisher.hasTerminal()) return;
    this.closing = true;
    this.abortController.abort(new Error("run_canceled"));
    try {
      await this.publisher.finish({ type: "canceled" });
    } finally {
      await this.invalidateSession();
    }
  }

  async shutdown(): Promise<void> {
    if (this.closing || this.publisher.hasTerminal()) return;
    this.closing = true;
    this.abortController.abort(new Error("backend_restarting"));
    try {
      await this.publisher.finish({
        type: "error",
        code: "backend_restarting",
        message: "The execution service restarted before this run finished.",
        retryable: true,
      });
    } catch (error) {
      this.options.logger.error("shutdown_terminal_result_failed", {
        runId: this.runId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await this.invalidateSession();
    }
  }

  wait(): Promise<void> {
    return this.execution;
  }

  private async run(): Promise<void> {
    this.options.logger.info("run_started", {
      runId: this.runId,
      commandId: this.options.request.commandId,
      threadId: this.options.request.threadId,
    });
    try {
      await this.options.executor.execute(
        this.options.request,
        async (event) => {
          if (this.closing || this.leaseLost) return;
          await this.publisher.emit(event);
        },
        this.abortController.signal,
      );
      if (!this.publisher.hasTerminal() && !this.closing && !this.leaseLost) {
        await this.publisher.finish({
          type: "error",
          code: "execution_ended_unexpectedly",
          message: "The execution ended without a terminal event.",
          retryable: true,
        });
      }
    } catch (error) {
      if (error instanceof ConvexRequestError) {
        this.closing = true;
        this.abortController.abort(error);
        this.publisher.stop();
        await this.invalidateSession();
      } else if (!this.closing && !this.leaseLost && !this.publisher.hasTerminal()) {
        await this.tryTerminal(normalizeExecutionError(error instanceof Error ? error : new Error("Execution failed.")));
      }
    } finally {
      const terminal = this.publisher.getTerminal();
      if (terminal?.type === "completed") {
        this.options.sessions.leave(this.scope);
      } else if (!this.leaseLost) {
        await this.invalidateSession();
      }
      this.publisher.stop();
      this.options.onFinished(this);
      this.options.logger.info("run_finished", {
        runId: this.runId,
        status: terminal?.type ?? (this.leaseLost ? "lease_lost" : "interrupted"),
      });
    }
  }

  private async tryTerminal(event: TerminalPiEvent): Promise<void> {
    try {
      await this.publisher.finish(event);
    } catch (error) {
      this.closing = true;
      this.abortController.abort(error);
      this.publisher.stop();
      await this.invalidateSession();
    }
  }

  private handleLeaseLost(): void {
    if (this.leaseLost) return;
    this.leaseLost = true;
    this.closing = true;
    this.abortController.abort(new Error("convex_lease_lost"));
    void this.invalidateSession();
  }

  private handleTransportFailure(error: Error): void {
    if (this.closing) return;
    this.closing = true;
    this.abortController.abort(error);
    this.publisher.stop();
    void this.invalidateSession();
  }

  private invalidateSession(): Promise<void> {
    this.sessionInvalidation ??= this.options.sessions.invalidate(this.scope);
    return this.sessionInvalidation;
  }
}
