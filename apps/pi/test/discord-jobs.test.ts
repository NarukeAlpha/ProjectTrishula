import { describe, expect, it, vi } from "vitest";
import type { DiscordAgentRequest, DiscordAgentResponse } from "../src/discord/contracts.js";
import { DiscordAgentOutputError } from "../src/discord/errors.js";
import { DiscordAgentJobRegistry } from "../src/discord/jobs.js";
import { completedDiscordAssistantText, type DiscordAgentRunner } from "../src/discord/runner.js";
import type { LogDetails, Logger } from "../src/runtime/logger.js";
import { discordChannel, discordMessages } from "./discord-contracts.test.js";
import { silentLogger } from "./helpers.js";

const triageRequest: DiscordAgentRequest = {
  requestId: "triage_job_1",
  profile: "triage",
  triggerKind: "ambient",
  channel: discordChannel,
  messages: discordMessages,
};

const triageResponse: DiscordAgentResponse = {
  profile: "triage",
  decision: "research",
  targetMessageId: "123456789012345678",
  question: "Why did AMD move today?",
  directReply: null,
  acknowledgement: "I'll check what moved AMD today.",
  reason: "Time-sensitive asset question.",
  confidence: 0.95,
  additiveValue: 0.95,
};

const firstDiscordMessage = discordMessages.at(0);
if (!firstDiscordMessage) throw new Error("The Discord test fixture requires one message.");

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(error: Error): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolvePromise: (value: Value) => void = () => undefined;
  let rejectPromise: (error: Error) => void = () => undefined;
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function runner(run: DiscordAgentRunner["run"]): DiscordAgentRunner {
  return {
    initialize: vi.fn(async () => undefined),
    readiness: vi.fn(() => ({ ready: true })),
    run: vi.fn(run),
    dispose: vi.fn(async () => undefined),
  };
}

function capturingLogger(entries: { event: string; details?: LogDetails }[]): Logger {
  const capture = (event: string, details?: LogDetails) => {
    entries.push(details ? { event, details } : { event });
  };
  return { info: capture, warn: capture, error: capture };
}

describe("Discord agent job registry", () => {
  it("returns immediately, completes in the background, and reuses an idempotent result", async () => {
    const pending = deferred<DiscordAgentResponse>();
    const discordAgents = runner(async () => pending.promise);
    const registry = new DiscordAgentJobRegistry({ runner: discordAgents, logger: silentLogger });
    try {
      expect(registry.submit(triageRequest)).toEqual({
        type: "accepted",
        job: { jobId: triageRequest.requestId, status: "running" },
      });
      expect(registry.get(triageRequest.requestId)).toEqual({
        jobId: triageRequest.requestId,
        status: "running",
      });

      pending.resolve(triageResponse);
      await vi.waitFor(() => {
        expect(registry.get(triageRequest.requestId)).toEqual({
          jobId: triageRequest.requestId,
          status: "completed",
          result: triageResponse,
        });
      });
      expect(registry.submit(triageRequest)).toEqual({
        type: "duplicate",
        job: { jobId: triageRequest.requestId, status: "completed", result: triageResponse },
      });
      expect(discordAgents.run).toHaveBeenCalledTimes(1);
    } finally {
      await registry.dispose();
    }
  });

  it("rejects a reused requestId when the validated request fingerprint changes", async () => {
    const pending = deferred<DiscordAgentResponse>();
    const discordAgents = runner(async () => pending.promise);
    const registry = new DiscordAgentJobRegistry({ runner: discordAgents, logger: silentLogger });
    try {
      registry.submit(triageRequest);
      expect(registry.submit({
        ...triageRequest,
        messages: [{ ...firstDiscordMessage, content: "A different question" }],
      })).toEqual({ type: "conflict" });
      expect(discordAgents.run).toHaveBeenCalledTimes(1);
    } finally {
      pending.resolve(triageResponse);
      await registry.dispose();
    }
  });

  it("stores only a safe normalized failure", async () => {
    const entries: { event: string; details?: LogDetails }[] = [];
    const logger = capturingLogger(entries);
    const discordAgents = runner(async () => {
      completedDiscordAssistantText({
        stopReason: "error",
        errorMessage: "socket hang up while handling PRIVATE_PROMPT at https://private.example.invalid",
        text: "PRIVATE_ASSISTANT_TEXT",
      });
      return triageResponse;
    });
    const registry = new DiscordAgentJobRegistry({ runner: discordAgents, logger });
    try {
      registry.submit(triageRequest);
      await vi.waitFor(() => {
        expect(registry.get(triageRequest.requestId)).toEqual({
          jobId: triageRequest.requestId,
          status: "failed",
          code: "provider_network",
          retryable: true,
        });
      });
      expect(JSON.stringify(entries)).not.toContain("PRIVATE_PROMPT");
      expect(JSON.stringify(entries)).not.toContain("PRIVATE_STACK");
      expect(JSON.stringify(entries)).not.toContain("PRIVATE_ASSISTANT_TEXT");
      expect(JSON.stringify(entries)).not.toContain("https://");
    } finally {
      await registry.dispose();
    }
  });

  it("preserves a terminal output code as non-retryable", async () => {
    const entries: { event: string; details?: LogDetails }[] = [];
    const discordAgents = runner(async () => {
      throw new DiscordAgentOutputError("unverified_source_url");
    });
    const registry = new DiscordAgentJobRegistry({
      runner: discordAgents,
      logger: capturingLogger(entries),
    });
    try {
      registry.submit(triageRequest);
      await vi.waitFor(() => {
        expect(registry.get(triageRequest.requestId)).toEqual({
          jobId: triageRequest.requestId,
          status: "failed",
          code: "unverified_source_url",
          retryable: false,
        });
      });
      const serialized = JSON.stringify(entries);
      expect(serialized).not.toContain("https://");
      expect(serialized).not.toContain("DiscordAgentOutputError");
    } finally {
      await registry.dispose();
    }
  });

  it("aborts and removes a running job on cancellation", async () => {
    let receivedSignal: AbortSignal | undefined;
    const discordAgents = runner(async (_request, signal) => {
      receivedSignal = signal;
      await new Promise<void>((_resolve, reject) => {
        const abort = () => reject(new Error("aborted"));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
      return triageResponse;
    });
    const registry = new DiscordAgentJobRegistry({ runner: discordAgents, logger: silentLogger });
    try {
      registry.submit(triageRequest);
      expect(registry.cancel(triageRequest.requestId)).toBe("cancelled");
      expect(receivedSignal?.aborted).toBe(true);
      expect(registry.get(triageRequest.requestId)).toBeUndefined();
      expect(registry.cancel(triageRequest.requestId)).toBe("not_found");
      expect(registry.submit(triageRequest)).toEqual({ type: "conflict" });
    } finally {
      await registry.dispose();
    }
  });

  it("enforces capacity and releases expired terminal jobs", async () => {
    let now = 1_000;
    const discordAgents = runner(async () => triageResponse);
    const registry = new DiscordAgentJobRegistry({
      runner: discordAgents,
      logger: silentLogger,
      maxJobs: 1,
      terminalTtlMs: 10,
      now: () => now,
    });
    try {
      registry.submit(triageRequest);
      await vi.waitFor(() => expect(registry.get(triageRequest.requestId)?.status).toBe("completed"));
      const secondRequest: DiscordAgentRequest = { ...triageRequest, requestId: "triage_job_2" };
      expect(registry.submit(secondRequest)).toEqual({ type: "capacity" });

      now += 11;
      expect(registry.submit(secondRequest)).toEqual({
        type: "accepted",
        job: { jobId: secondRequest.requestId, status: "running" },
      });
    } finally {
      await registry.dispose();
    }
  });

  it("limits active agent sessions separately from retained results", async () => {
    const pending = deferred<DiscordAgentResponse>();
    const discordAgents = runner(async () => pending.promise);
    const registry = new DiscordAgentJobRegistry({
      runner: discordAgents,
      logger: silentLogger,
      maxActiveJobs: 1,
    });
    const secondRequest: DiscordAgentRequest = { ...triageRequest, requestId: "triage_job_2" };
    try {
      registry.submit(triageRequest);
      expect(registry.submit(secondRequest)).toEqual({ type: "capacity" });

      pending.resolve(triageResponse);
      await vi.waitFor(() => expect(registry.get(triageRequest.requestId)?.status).toBe("completed"));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(registry.submit(secondRequest)).toEqual({
        type: "accepted",
        job: { jobId: secondRequest.requestId, status: "running" },
      });
    } finally {
      await registry.dispose();
    }
  });

  it("aborts and safely fails a job that exceeds its server deadline", async () => {
    let receivedSignal: AbortSignal | undefined;
    const discordAgents = runner(async (_request, signal) => {
      receivedSignal = signal;
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("private timeout details")), {
          once: true,
        });
      });
      return triageResponse;
    });
    const registry = new DiscordAgentJobRegistry({
      runner: discordAgents,
      logger: silentLogger,
      maxRunMs: 10,
    });
    try {
      registry.submit(triageRequest);
      await vi.waitFor(() => {
        expect(registry.get(triageRequest.requestId)).toEqual({
          jobId: triageRequest.requestId,
          status: "failed",
          code: "provider_timeout",
          retryable: true,
        });
      });
      expect(receivedSignal?.aborted).toBe(true);
    } finally {
      await registry.dispose();
    }
  });

  it("aborts active work during disposal and stops accepting jobs", async () => {
    let receivedSignal: AbortSignal | undefined;
    const discordAgents = runner(async (_request, signal) => {
      receivedSignal = signal;
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      return triageResponse;
    });
    const registry = new DiscordAgentJobRegistry({ runner: discordAgents, logger: silentLogger });
    registry.submit(triageRequest);
    await registry.dispose();

    expect(receivedSignal?.aborted).toBe(true);
    expect(registry.get(triageRequest.requestId)).toBeUndefined();
    expect(registry.submit(triageRequest)).toEqual({ type: "not_accepting" });
  });

  it("logs only safe structured job metadata", async () => {
    const entries: { event: string; details?: LogDetails }[] = [];
    const logger = capturingLogger(entries);
    const discordAgents = runner(async () => triageResponse);
    const registry = new DiscordAgentJobRegistry({ runner: discordAgents, logger });
    try {
      registry.submit(triageRequest);
      await vi.waitFor(() => expect(registry.get(triageRequest.requestId)?.status).toBe("completed"));
      const allowedFields = ["code", "duration", "profile", "requestId", "status"];
      for (const entry of entries) {
        expect(Object.keys(entry.details ?? {}).sort()).toEqual(
          Object.keys(entry.details ?? {}).filter((key) => allowedFields.includes(key)).sort(),
        );
      }
      const serialized = JSON.stringify(entries);
      expect(serialized).not.toContain(firstDiscordMessage.content);
      expect(serialized).not.toContain("https://");
    } finally {
      await registry.dispose();
    }
  });
});
