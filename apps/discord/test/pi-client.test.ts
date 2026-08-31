import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscordGatewayConfig } from "../src/config.js";
import {
  PiAgentClient,
  PiAgentOperationError,
} from "../src/pi/client.js";
import type { TriageRequest } from "../src/contracts.js";

const config: DiscordGatewayConfig = {
  environment: "test",
  host: "127.0.0.1",
  port: 8_080,
  discordBotToken: undefined,
  chartImgApiKey: undefined,
  discordOwnerId: "owner-1",
  convexSharedSecret: "c".repeat(32),
  piSharedSecret: "p".repeat(32),
  convexSiteUrl: "https://convex.example/http",
  piServiceUrl: "https://pi.example",
  loopPollIntervalMs: 5_000,
  outboxPollIntervalMs: 2_000,
  channelSyncIntervalMs: 300_000,
  leaseHeartbeatIntervalMs: 30_000,
  requestTimeoutMs: 30_000,
  agentTimeoutMs: 600_000,
  maxReconcileMessages: 500,
};

const triageRequest: TriageRequest = {
  requestId: "run-1:triage",
  profile: "triage",
  triggerKind: "mention",
  channel: {
    guildId: "10",
    channelId: "20",
    channelName: "markets",
  },
  messages: [
    {
      messageId: "100",
      sequence: 1,
      authorId: "200",
      authorName: "Mira",
      content: "What moved SPY today?",
      createdAt: "2026-08-30T12:00:00.000Z",
      isBot: false,
    },
  ],
};

const triageResponse = {
  profile: "triage" as const,
  decision: "research" as const,
  targetMessageId: "100",
  question: "What moved SPY today?",
  directReply: null,
  acknowledgement: "I'll check what drove SPY today.",
  reason: "The channel asked a current market question.",
  confidence: 0.96,
  additiveValue: 0.97,
};

type TestJsonValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: TestJsonValue }
  | readonly TestJsonValue[];

function json(value: TestJsonValue, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Pi Discord agent jobs", () => {
  it("submits once and polls short requests until the result is complete", async () => {
    vi.useFakeTimers();
    const requests: Array<{ url: string; method: string }> = [];
    let polls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        requests.push({ url, method });
        if (method === "POST") {
          return json({ jobId: triageRequest.requestId, status: "running" }, 202);
        }
        polls += 1;
        return polls === 1
          ? json({ jobId: triageRequest.requestId, status: "running" })
          : json({
              jobId: triageRequest.requestId,
              status: "completed",
              result: triageResponse,
            });
      }),
    );

    const result = new PiAgentClient(config).triage(triageRequest);
    await vi.advanceTimersByTimeAsync(2_100);

    await expect(result).resolves.toEqual(triageResponse);
    expect(requests).toEqual([
      { url: "https://pi.example/discord/agents/jobs", method: "POST" },
      {
        url: "https://pi.example/discord/agents/jobs/run-1%3Atriage",
        method: "GET",
      },
      {
        url: "https://pi.example/discord/agents/jobs/run-1%3Atriage",
        method: "GET",
      },
    ]);
  });

  it("preserves a safe failed-job code without exposing raw provider text", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
        init?.method === "POST"
          ? json({ jobId: triageRequest.requestId, status: "running" }, 202)
          : json({
              jobId: triageRequest.requestId,
              status: "failed",
              code: "provider_network",
              retryable: true,
            }),
      ),
    );

    const result = new PiAgentClient(config).triage(triageRequest);
    const rejection = expect(result).rejects.toEqual(
      new PiAgentOperationError("triage", "provider_network", true, 200),
    );
    await vi.advanceTimersByTimeAsync(1_100);

    await rejection;
  });

  it("resubmits once when a Pi restart loses the in-memory job", async () => {
    vi.useFakeTimers();
    let submissions = 0;
    let polls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
          submissions += 1;
          return json({ jobId: triageRequest.requestId, status: "running" }, 202);
        }
        polls += 1;
        return polls === 1
          ? json({ error: "job_not_found" }, 404)
          : json({
              jobId: triageRequest.requestId,
              status: "completed",
              result: triageResponse,
            });
      }),
    );

    const result = new PiAgentClient(config).triage(triageRequest);
    await vi.advanceTimersByTimeAsync(2_100);

    await expect(result).resolves.toEqual(triageResponse);
    expect(submissions).toBe(2);
  });

  it("maps malformed completed output to a bounded protocol error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
        init?.method === "POST"
          ? json({ jobId: triageRequest.requestId, status: "running" }, 202)
          : json({
              jobId: triageRequest.requestId,
              status: "completed",
              result: { raw: "private provider output" },
            }),
      ),
    );

    const result = new PiAgentClient(config).triage(triageRequest);
    const rejection = expect(result).rejects.toMatchObject({
      name: "PiAgentOperationError",
      code: "agent_result_invalid",
      message: "Pi triage failed: agent_result_invalid.",
    });
    await vi.advanceTimersByTimeAsync(1_100);

    await rejection;
  });

  it("does not cancel another job after a fingerprint conflict", async () => {
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        methods.push(method);
        return json({ error: "discord_agent_job_conflict" }, 409);
      }),
    );

    await expect(new PiAgentClient(config).triage(triageRequest)).rejects.toMatchObject({
      name: "PiAgentOperationError",
      code: "discord_agent_job_conflict",
      retryable: false,
    });
    await Promise.resolve();
    expect(methods).toEqual(["POST"]);
  });

  it("honors a bounded Retry-After before retrying transient job responses", async () => {
    vi.useFakeTimers();
    let submissions = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
          submissions += 1;
          return submissions === 1
            ? new Response(JSON.stringify({ error: "discord_agent_job_capacity" }), {
                status: 429,
                headers: { "content-type": "application/json", "retry-after": "1" },
              })
            : json({ jobId: triageRequest.requestId, status: "running" }, 202);
        }
        return json({
          jobId: triageRequest.requestId,
          status: "completed",
          result: triageResponse,
        });
      }),
    );

    const result = new PiAgentClient(config).triage(triageRequest);
    await vi.advanceTimersByTimeAsync(2_100);

    await expect(result).resolves.toEqual(triageResponse);
    expect(submissions).toBe(2);
  });
});
