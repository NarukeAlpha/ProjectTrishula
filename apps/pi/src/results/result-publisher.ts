import type {
  PiEvent,
  ResultBatchAccepted,
  RunExecutionRequest,
  TerminalPiEvent,
} from "../contracts.js";
import { isTerminalEvent } from "../contracts.js";
import type { Logger } from "../runtime/logger.js";
import type { ConvexClientLike, UnsignedResultBatch } from "./convex-client.js";
import { MessageAccumulator } from "./message-accumulator.js";

const HEARTBEAT_AFTER_MS = 30_000;
const INITIAL_LEASE_MS = 120_000;

export interface ResultPublisherOptions {
  request: RunExecutionRequest;
  convex: ConvexClientLike;
  batchWindowMs: number;
  batchBytes: number;
  logger: Logger;
  onLeaseLost(): void;
  onTransportFailure?(error: Error): void;
  now?: () => number;
}

function splitByBytes(text: string, maximumBytes: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let bytes = 0;
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maximumBytes && current) {
      chunks.push(current);
      current = "";
      bytes = 0;
    }
    current += character;
    bytes += characterBytes;
  }
  if (current) chunks.push(current);
  return chunks;
}

export class ResultPublisher {
  private readonly accumulator = new MessageAccumulator();
  private readonly now: () => number;
  private sequence = 1;
  private firstVisibleTextSent = false;
  private pendingText = "";
  private operation: Promise<void> = Promise.resolve();
  private flushTimer: NodeJS.Timeout | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private leaseTimer: NodeJS.Timeout | undefined;
  private leaseExpiresAt: number;
  private terminal = false;
  private terminalEvent: TerminalPiEvent | undefined;
  private stopped = false;

  constructor(private readonly options: ResultPublisherOptions) {
    this.now = options.now ?? Date.now;
    this.leaseExpiresAt = this.now() + INITIAL_LEASE_MS;
  }

  startLiveness(): void {
    this.scheduleHeartbeat();
    this.scheduleLeaseExpiry();
  }

  emit(event: PiEvent): Promise<void> {
    if (this.stopped) return Promise.reject(new Error("Result publisher is stopped."));
    if (this.terminal) return Promise.reject(new Error("A terminal Pi event was already accepted."));
    this.operation = this.operation.then(() => this.accept(event));
    return this.operation;
  }

  async finish(terminal: TerminalPiEvent): Promise<boolean> {
    if (this.stopped) return false;
    await this.emit(terminal);
    return this.terminal;
  }

  hasTerminal(): boolean {
    return this.terminal;
  }

  getTerminal(): TerminalPiEvent | undefined {
    return this.terminalEvent;
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
  }

  async settled(): Promise<void> {
    await this.operation;
  }

  private async accept(event: PiEvent): Promise<void> {
    if (this.stopped) return;
    if (this.terminal) throw new Error("A terminal Pi event was already accepted.");

    if (event.type === "text_delta") {
      if (!event.text) return;
      this.accumulator.accept(event);
      if (!this.firstVisibleTextSent) {
        if (event.text.trim().length === 0) {
          this.pendingText += event.text;
          if (Buffer.byteLength(this.pendingText, "utf8") >= this.options.batchBytes) {
            await this.flushText();
          }
          return;
        }
        this.firstVisibleTextSent = true;
        const text = this.pendingText + event.text;
        this.pendingText = "";
        for (const chunk of splitByBytes(text, this.options.batchBytes)) {
          await this.sendEvents([{ type: "text_delta", text: chunk }]);
        }
        return;
      }

      for (const chunk of splitByBytes(event.text, this.options.batchBytes)) {
        if (
          this.pendingText &&
          Buffer.byteLength(this.pendingText + chunk, "utf8") > this.options.batchBytes
        ) {
          await this.flushText();
        }
        this.pendingText += chunk;
        if (
          this.pendingText.includes("\n") ||
          Buffer.byteLength(this.pendingText, "utf8") >= this.options.batchBytes
        ) {
          await this.flushText();
        } else {
          this.startFlushTimer();
        }
      }
      return;
    }

    await this.flushText();
    if (isTerminalEvent(event)) {
      const finalMessage = this.accumulator.finalMessage(event);
      await this.sendEvents([event], finalMessage);
      this.accumulator.accept(event);
      this.terminal = true;
      this.terminalEvent = event;
      this.clearTimers();
      return;
    }

    this.accumulator.accept(event);
    await this.sendEvents([event]);
  }

  private startFlushTimer(): void {
    if (this.flushTimer || !this.pendingText) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      const flush = this.operation.then(() => this.flushText());
      this.operation = flush.catch((error: Error) => {
        this.stop();
        this.options.onTransportFailure?.(error);
      });
    }, this.options.batchWindowMs);
    this.flushTimer.unref();
  }

  private async flushText(): Promise<void> {
    if (!this.pendingText) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const text = this.pendingText;
    this.pendingText = "";
    await this.sendEvents([{ type: "text_delta", text }]);
  }

  private async sendEvents(
    events: PiEvent[],
    finalMessage?: ReturnType<MessageAccumulator["finalMessage"]>,
  ): Promise<void> {
    const request: UnsignedResultBatch = {
      commandId: this.options.request.commandId,
      runId: this.options.request.runId,
      assistantMessageId: this.options.request.assistantMessageId,
      sequence: this.sequence,
      events,
    };
    if (finalMessage !== undefined) request.finalMessage = finalMessage;
    const accepted = await this.options.convex.sendResult(request);
    this.sequence += 1;
    this.acceptLease(accepted);
  }

  private acceptLease(accepted: ResultBatchAccepted): void {
    if (accepted.leaseExpiresAt !== undefined) this.leaseExpiresAt = accepted.leaseExpiresAt;
    this.scheduleLeaseExpiry();
    if (accepted.status === "streaming") this.scheduleHeartbeat();
  }

  private scheduleHeartbeat(delay = HEARTBEAT_AFTER_MS): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (this.terminal || this.stopped) return;
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = undefined;
      void this.heartbeat();
    }, delay);
    this.heartbeatTimer.unref();
  }

  private async heartbeat(): Promise<void> {
    if (this.terminal || this.stopped) return;
    try {
      const accepted = await this.options.convex.sendHeartbeat(
        this.options.request.commandId,
        this.options.request.runId,
      );
      if (accepted.status !== "running" && accepted.status !== "cancellation_requested") {
        this.loseLease("terminal_heartbeat_status");
        return;
      }
      if (accepted.leaseExpiresAt !== undefined) this.leaseExpiresAt = accepted.leaseExpiresAt;
      this.scheduleLeaseExpiry();
      this.scheduleHeartbeat();
    } catch {
      const remaining = this.leaseExpiresAt - this.now();
      if (remaining <= 0) {
        this.loseLease("heartbeat_failed");
      } else {
        this.options.logger.warn("run_heartbeat_failed", {
          runId: this.options.request.runId,
          remainingLeaseMs: remaining,
        });
        this.scheduleHeartbeat(Math.min(5_000, Math.max(1, remaining)));
      }
    }
  }

  private scheduleLeaseExpiry(): void {
    if (this.leaseTimer) clearTimeout(this.leaseTimer);
    if (this.terminal || this.stopped) return;
    const delay = Math.max(1, this.leaseExpiresAt - this.now());
    this.leaseTimer = setTimeout(() => this.loseLease("lease_expired"), delay);
    this.leaseTimer.unref();
  }

  private loseLease(reason: string): void {
    if (this.terminal || this.stopped) return;
    this.options.logger.error("run_lease_lost", { runId: this.options.request.runId, reason });
    this.stop();
    this.options.onLeaseLost();
  }

  private clearTimers(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (this.leaseTimer) clearTimeout(this.leaseTimer);
    this.flushTimer = undefined;
    this.heartbeatTimer = undefined;
    this.leaseTimer = undefined;
  }
}
