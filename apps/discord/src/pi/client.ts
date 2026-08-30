import type { DiscordGatewayConfig } from "../config.js";
import { z, type ZodType } from "zod";
import {
  replyRequestSchema,
  replyResponseSchema,
  researchRequestSchema,
  researchResponseSchema,
  triageRequestSchema,
  triageResponseSchema,
  type ReplyRequest,
  type ReplyResponse,
  type ResearchRequest,
  type ResearchResponse,
  type TriageRequest,
  type TriageResponse,
} from "../contracts.js";

type AgentRequest = TriageRequest | ResearchRequest | ReplyRequest;

const JOB_POLL_INTERVAL_MS = 1_000;
const JOB_REQUEST_RETRY_DELAYS_MS = [250, 1_000, 2_500] as const;
const MAX_RETRY_AFTER_MS = 5_000;
const safeCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9_]+$/);
const jobIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9:_-]+$/);
const submitJobResponseSchema = z
  .object({
    jobId: jobIdSchema,
    status: z.enum(["running", "completed", "failed"]),
  })
  .strict();
const runningJobResponseSchema = z
  .object({ jobId: jobIdSchema, status: z.literal("running") })
  .strict();
const completedJobResponseSchema = z
  .object({
    jobId: jobIdSchema,
    status: z.literal("completed"),
    result: z.unknown(),
  })
  .strict();
const failedJobResponseSchema = z
  .object({
    jobId: jobIdSchema,
    status: z.literal("failed"),
    code: safeCodeSchema,
    retryable: z.boolean(),
  })
  .strict();
const jobResponseSchema = z.discriminatedUnion("status", [
  runningJobResponseSchema,
  completedJobResponseSchema,
  failedJobResponseSchema,
]);
const errorResponseSchema = z
  .object({ error: safeCodeSchema })
  .passthrough();

type AgentProfile = AgentRequest["profile"];

export class PiAgentOperationError extends Error {
  constructor(
    readonly profile: AgentProfile,
    readonly code: string,
    readonly retryable: boolean,
    readonly status: number,
  ) {
    super(`Pi ${profile} failed: ${code}.`);
    this.name = "PiAgentOperationError";
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Pi agent request aborted.");
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryDelay(response: Response, fallback: number): number {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return fallback;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS);
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return fallback;
  return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_AFTER_MS);
}

async function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortReason(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds);
    timer.unref();
    signal.addEventListener("abort", abort, { once: true });

    function finish() {
      signal.removeEventListener("abort", abort);
      resolve();
    }

    function abort() {
      clearTimeout(timer);
      reject(abortReason(signal));
    }
  });
}

export class PiAgentClient {
  private readonly jobsEndpoint: string;

  constructor(private readonly config: DiscordGatewayConfig) {
    this.jobsEndpoint = `${config.piServiceUrl}/discord/agents/jobs`;
  }

  async triage(
    input: TriageRequest,
    signal?: AbortSignal,
  ): Promise<TriageResponse> {
    return this.request(
      triageRequestSchema.parse(input),
      triageResponseSchema,
      signal,
    );
  }

  async research(
    input: ResearchRequest,
    signal?: AbortSignal,
  ): Promise<ResearchResponse> {
    return this.request(
      researchRequestSchema.parse(input),
      researchResponseSchema,
      signal,
    );
  }

  async reply(
    input: ReplyRequest,
    signal?: AbortSignal,
  ): Promise<ReplyResponse> {
    return this.request(
      replyRequestSchema.parse(input),
      replyResponseSchema,
      signal,
    );
  }

  private async request<Output>(
    body: AgentRequest,
    responseSchema: ZodType<Output>,
    signal?: AbortSignal,
  ): Promise<Output> {
    const timeout = AbortSignal.timeout(this.config.agentTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const jobId = body.requestId;
    let terminal = false;
    let submitted = false;
    let missingJobResubmits = 0;
    try {
      await this.submitJob(body, combined);
      submitted = true;
      while (true) {
        await waitFor(JOB_POLL_INTERVAL_MS, combined);
        const response = await this.fetchWithRetry(
          `${this.jobsEndpoint}/${encodeURIComponent(jobId)}`,
          { method: "GET" },
          combined,
          body.profile,
        );
        if (response.status === 404 && missingJobResubmits < 1) {
          missingJobResubmits += 1;
          await this.submitJob(body, combined);
          continue;
        }
        if (!response.ok) {
          if (response.status === 404) {
            throw new PiAgentOperationError(
              body.profile,
              "job_lost",
              true,
              response.status,
            );
          }
          throw await this.httpError(body.profile, response);
        }
        const value: unknown = await response.json();
        const parsedJob = jobResponseSchema.safeParse(value);
        if (!parsedJob.success) {
          throw new PiAgentOperationError(
            body.profile,
            "job_protocol_invalid",
            false,
            response.status,
          );
        }
        const job = parsedJob.data;
        if (job.jobId !== jobId) {
          throw new PiAgentOperationError(
            body.profile,
            "job_identity_mismatch",
            false,
            response.status,
          );
        }
        if (job.status === "running") continue;
        terminal = true;
        if (job.status === "failed") {
          throw new PiAgentOperationError(
            body.profile,
            job.code,
            job.retryable,
            response.status,
          );
        }
        const parsedResult = responseSchema.safeParse(job.result);
        if (!parsedResult.success) {
          throw new PiAgentOperationError(
            body.profile,
            "agent_result_invalid",
            false,
            response.status,
          );
        }
        return parsedResult.data;
      }
    } catch (error) {
      if (timeout.aborted && !signal?.aborted) {
        throw new PiAgentOperationError(
          body.profile,
          "agent_timeout",
          true,
          0,
        );
      }
      throw error;
    } finally {
      if (submitted && !terminal) void this.cancelJob(jobId);
    }
  }

  private async submitJob(
    body: AgentRequest,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await this.fetchWithRetry(
      this.jobsEndpoint,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      signal,
      body.profile,
    );
    if (!response.ok) throw await this.httpError(body.profile, response);
    const value: unknown = await response.json();
    const parsedResult = submitJobResponseSchema.safeParse(value);
    if (!parsedResult.success) {
      throw new PiAgentOperationError(
        body.profile,
        "job_protocol_invalid",
        false,
        response.status,
      );
    }
    const result = parsedResult.data;
    if (result.jobId !== body.requestId) {
      throw new PiAgentOperationError(
        body.profile,
        "job_identity_mismatch",
        false,
        response.status,
      );
    }
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
    profile: AgentProfile,
  ): Promise<Response> {
    let attempt = 0;
    while (true) {
      if (signal.aborted) throw abortReason(signal);
      const requestTimeout = AbortSignal.timeout(this.config.requestTimeoutMs);
      try {
        const response = await fetch(url, {
          ...init,
          headers: {
            authorization: `Bearer ${this.config.piSharedSecret}`,
            "content-type": "application/json",
          },
          signal: AbortSignal.any([signal, requestTimeout]),
        });
        const fallback = JOB_REQUEST_RETRY_DELAYS_MS[attempt];
        if (!isRetryableHttpStatus(response.status) || fallback === undefined) {
          return response;
        }
        attempt += 1;
        await response.body?.cancel().catch(() => undefined);
        await waitFor(retryDelay(response, fallback), signal);
      } catch {
        if (signal.aborted) throw abortReason(signal);
        const delay = JOB_REQUEST_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          throw new PiAgentOperationError(
            profile,
            "agent_network",
            true,
            0,
          );
        }
        attempt += 1;
        await waitFor(delay, signal);
      }
    }
  }

  private async httpError(
    profile: AgentProfile,
    response: Response,
  ): Promise<PiAgentOperationError> {
    const value: unknown = await response.json().catch(() => null);
    const parsed = errorResponseSchema.safeParse(value);
    const code = parsed.success ? parsed.data.error : `agent_http_${response.status}`;
    return new PiAgentOperationError(
      profile,
      code,
      isRetryableHttpStatus(response.status),
      response.status,
    );
  }

  private async cancelJob(jobId: string): Promise<void> {
    const timeout = AbortSignal.timeout(Math.min(this.config.requestTimeoutMs, 5_000));
    await fetch(`${this.jobsEndpoint}/${encodeURIComponent(jobId)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${this.config.piSharedSecret}` },
      signal: timeout,
    }).catch(() => undefined);
  }
}
