import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  PiEvent,
  ResultBatchAccepted,
  ResultBatchRequest,
  RunHeartbeatAccepted,
} from "../contracts.js";
import type { Logger } from "../runtime/logger.js";
import { canonicalJson, type CanonicalJsonValue } from "./canonical-json.js";

const resultResponseSchema = z.object({
  runId: z.string(),
  acceptedThrough: z.number().int().positive(),
  status: z.enum(["streaming", "completed", "failed", "canceled"]),
  leaseExpiresAt: z.number().finite().optional(),
}).strict();

const heartbeatResponseSchema = z.object({
  runId: z.string(),
  status: z.enum(["running", "cancellation_requested", "completed", "failed", "canceled"]),
  leaseExpiresAt: z.number().finite().optional(),
}).strict();

export class ConvexRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ConvexRequestError";
  }
}

export interface UnsignedResultBatch {
  commandId: string;
  runId: string;
  assistantMessageId: string;
  sequence: number;
  events: PiEvent[];
  finalMessage?: ResultBatchRequest["finalMessage"];
}

export interface ConvexClientOptions {
  siteUrl: string;
  sharedSecret: string;
  requestTimeoutMs: number;
  retryAttempts: number;
  fetch?: typeof fetch;
  logger: Logger;
}

export interface ConvexClientLike {
  sendResult(batch: UnsignedResultBatch): Promise<ResultBatchAccepted>;
  sendHeartbeat(commandId: string, runId: string): Promise<RunHeartbeatAccepted>;
}

const RETRY_BASE_MS = 250;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function hash(bytes: string): string {
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

export class ConvexClient {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: ConvexClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async sendResult(batch: UnsignedResultBatch): Promise<ResultBatchAccepted> {
    const unsignedBytes = canonicalJson(batch);
    const payloadHash = hash(unsignedBytes);
    const body = canonicalJson({ ...batch, payloadHash });
    const encodedEvents = Buffer.byteLength(canonicalJson(batch.events), "utf8");
    if (encodedEvents > 64 * 1024) {
      throw new ConvexRequestError("Result batch event data exceeds 64 KiB.", false);
    }
    if (batch.events.length > 64) {
      throw new ConvexRequestError("Result batch exceeds 64 events.", false);
    }
    if (batch.finalMessage && Buffer.byteLength(canonicalJson(batch.finalMessage), "utf8") > 512 * 1024) {
      throw new ConvexRequestError("Final assistant message exceeds 512 KiB.", false);
    }

    const value = await this.post("/service/run-results", body);
    const parsed = resultResponseSchema.safeParse(value);
    if (!parsed.success) throw new ConvexRequestError("Convex returned an invalid result response.", false);
    if (parsed.data.runId !== batch.runId || parsed.data.acceptedThrough !== batch.sequence) {
      throw new ConvexRequestError("Convex returned a mismatched result acknowledgement.", false);
    }
    const result: ResultBatchAccepted = {
      runId: parsed.data.runId,
      acceptedThrough: parsed.data.acceptedThrough,
      status: parsed.data.status,
    };
    if (parsed.data.leaseExpiresAt !== undefined) result.leaseExpiresAt = parsed.data.leaseExpiresAt;
    return result;
  }

  async sendHeartbeat(commandId: string, runId: string): Promise<RunHeartbeatAccepted> {
    const value = await this.post(
      "/service/run-heartbeats",
      canonicalJson({ commandId, runId }),
    );
    const parsed = heartbeatResponseSchema.safeParse(value);
    if (!parsed.success || parsed.data.runId !== runId) {
      throw new ConvexRequestError("Convex returned an invalid heartbeat response.", false);
    }
    const result: RunHeartbeatAccepted = {
      runId: parsed.data.runId,
      status: parsed.data.status,
    };
    if (parsed.data.leaseExpiresAt !== undefined) result.leaseExpiresAt = parsed.data.leaseExpiresAt;
    return result;
  }

  private async post(path: string, body: string): Promise<CanonicalJsonValue> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= this.options.retryAttempts; attempt += 1) {
      try {
        const response = await this.fetch(`${this.options.siteUrl}${path}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.options.sharedSecret}`,
            "content-type": "application/json",
          },
          body,
          signal: AbortSignal.timeout(this.options.requestTimeoutMs),
        });
        if (!response.ok) {
          throw new ConvexRequestError(
            `Convex request failed with HTTP ${response.status}.`,
            isRetryableStatus(response.status),
            response.status,
          );
        }
        const parsed = z.json().safeParse(await response.json());
        if (!parsed.success) throw new ConvexRequestError("Convex returned invalid JSON.", false);
        // SAFETY: z.json() has parsed the response into JSON-compatible data at the HTTP boundary.
        return parsed.data as CanonicalJsonValue;
      } catch (error) {
        const normalized = error instanceof ConvexRequestError
          ? error
          : new ConvexRequestError("Convex request failed.", true);
        lastError = normalized;
        if (!normalized.retryable || attempt === this.options.retryAttempts) break;
        this.options.logger.warn("convex_request_retry", { path, attempt });
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      }
    }

    throw lastError ?? new ConvexRequestError("Convex request failed.", true);
  }
}
