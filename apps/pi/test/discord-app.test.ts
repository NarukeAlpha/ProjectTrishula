import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp, type AppRunRegistry } from "../src/app.js";
import { DiscordAgentOutputError } from "../src/discord/errors.js";
import { DiscordAgentJobRegistry } from "../src/discord/jobs.js";
import type { DiscordAgentRunner } from "../src/discord/runner.js";
import { silentLogger, TestExecutor } from "./helpers.js";
import { discordChannel, discordMessages } from "./discord-contracts.test.js";

const serviceSecret = "a-secure-service-secret-with-32-chars";
const discordSecret = "an-independent-discord-secret-with-32-chars";
const firstDiscordMessage = (() => {
  const message = discordMessages.at(0);
  if (!message) throw new Error("The Discord test fixture requires one message.");
  return message;
})();

function registry(): AppRunRegistry {
  return {
    isAccepting: () => true,
    reserve: vi.fn(() => ({ type: "accepted" as const, state: "reserved" as const })),
    start: vi.fn(),
    cancel: vi.fn(() => "not_found" as const),
  };
}

function agents(): DiscordAgentRunner {
  return {
    initialize: vi.fn(async () => undefined),
    readiness: vi.fn(() => ({ ready: true })),
    run: vi.fn(async () => ({
      profile: "triage" as const,
      decision: "research" as const,
      targetMessageId: firstDiscordMessage.messageId,
      question: "Why did AMD move today?",
      directReply: null,
      acknowledgement: "I'll check what moved AMD today.",
      reason: "Time-sensitive asset question.",
      confidence: 0.95,
      additiveValue: 0.95,
    })),
    dispose: vi.fn(async () => undefined),
  };
}

const jobRegistries: DiscordAgentJobRegistry[] = [];

function appWithJobs(discordAgents: DiscordAgentRunner) {
  const discordAgentJobs = new DiscordAgentJobRegistry({ runner: discordAgents, logger: silentLogger });
  jobRegistries.push(discordAgentJobs);
  return createApp({
    sharedSecret: serviceSecret,
    discordSharedSecret: discordSecret,
    executor: new TestExecutor(),
    registry: registry(),
    discordAgents,
    discordAgentJobs,
  });
}

afterEach(async () => {
  await Promise.all(jobRegistries.splice(0).map(async (jobRegistry) => jobRegistry.dispose()));
});

describe("Discord agent HTTP endpoint", () => {
  it("requires the service bearer secret", async () => {
    const discordAgents = agents();
    const response = await request(createApp({ sharedSecret: serviceSecret, discordSharedSecret: discordSecret, executor: new TestExecutor(), registry: registry(), discordAgents }))
      .post("/discord/agents/run")
      .send({ requestId: "triage_1", profile: "triage", triggerKind: "ambient", channel: discordChannel, messages: discordMessages });
    expect(response.status).toBe(401);
    expect(discordAgents.run).not.toHaveBeenCalled();
  });

  it("runs a valid isolated agent profile", async () => {
    const discordAgents = agents();
    const body = { requestId: "triage_1", profile: "triage" as const, triggerKind: "ambient" as const, channel: discordChannel, messages: discordMessages };
    const response = await request(createApp({ sharedSecret: serviceSecret, discordSharedSecret: discordSecret, executor: new TestExecutor(), registry: registry(), discordAgents }))
      .post("/discord/agents/run")
      .set("authorization", `Bearer ${discordSecret}`)
      .send(body);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ profile: "triage", decision: "research" });
    expect(discordAgents.run).toHaveBeenCalledWith(body, expect.any(AbortSignal));
  });

  it("rejects more than ten context messages", async () => {
    const discordAgents = agents();
    const response = await request(createApp({ sharedSecret: serviceSecret, discordSharedSecret: discordSecret, executor: new TestExecutor(), registry: registry(), discordAgents }))
      .post("/discord/agents/run")
      .set("authorization", `Bearer ${discordSecret}`)
      .send({ requestId: "triage_1", profile: "triage", triggerKind: "ambient", channel: discordChannel, messages: Array.from({ length: 11 }, (_, index) => ({ ...firstDiscordMessage, messageId: String(index + 1) })) });
    expect(response.status).toBe(400);
    expect(discordAgents.run).not.toHaveBeenCalled();
  });

  it("rejects the broader Pi service secret", async () => {
    const discordAgents = agents();
    const response = await request(createApp({ sharedSecret: serviceSecret, discordSharedSecret: discordSecret, executor: new TestExecutor(), registry: registry(), discordAgents }))
      .post("/discord/agents/run")
      .set("authorization", `Bearer ${serviceSecret}`)
      .send({ requestId: "triage_1", profile: "triage", triggerKind: "ambient", channel: discordChannel, messages: discordMessages });
    expect(response.status).toBe(401);
    expect(discordAgents.run).not.toHaveBeenCalled();
  });

  it("accepts a background job and exposes its terminal result by jobId", async () => {
    let finish: ((value: Awaited<ReturnType<DiscordAgentRunner["run"]>>) => void) | undefined;
    const discordAgents = agents();
    vi.mocked(discordAgents.run).mockImplementation(async () => new Promise((resolve) => {
      finish = resolve;
    }));
    const app = appWithJobs(discordAgents);
    const body = {
      requestId: "triage_job_1",
      profile: "triage" as const,
      triggerKind: "ambient" as const,
      channel: discordChannel,
      messages: discordMessages,
    };

    const accepted = await request(app)
      .post("/discord/agents/jobs")
      .set("authorization", `Bearer ${discordSecret}`)
      .send(body);
    expect(accepted.status).toBe(202);
    expect(accepted.body).toEqual({ jobId: body.requestId, status: "running" });

    const running = await request(app)
      .get(`/discord/agents/jobs/${body.requestId}`)
      .set("authorization", `Bearer ${discordSecret}`);
    expect(running.body).toEqual({ jobId: body.requestId, status: "running" });

    if (!finish) throw new Error("The HTTP job did not start its runner.");
    finish({
      profile: "triage",
      decision: "research",
      targetMessageId: firstDiscordMessage.messageId,
      question: "Why did AMD move today?",
      directReply: null,
      acknowledgement: "I'll check what moved AMD today.",
      reason: "Time-sensitive asset question.",
      confidence: 0.95,
      additiveValue: 0.95,
    });
    await vi.waitFor(async () => {
      const completed = await request(app)
        .get(`/discord/agents/jobs/${body.requestId}`)
        .set("authorization", `Bearer ${discordSecret}`);
      expect(completed.body).toMatchObject({
        jobId: body.requestId,
        status: "completed",
        result: { profile: "triage", decision: "research" },
      });
    });
  });

  it("returns terminal idempotency and rejects a conflicting request fingerprint", async () => {
    const discordAgents = agents();
    const app = appWithJobs(discordAgents);
    const body = {
      requestId: "triage_job_2",
      profile: "triage" as const,
      triggerKind: "ambient" as const,
      channel: discordChannel,
      messages: discordMessages,
    };
    const first = await request(app)
      .post("/discord/agents/jobs")
      .set("authorization", `Bearer ${discordSecret}`)
      .send(body);
    expect(first.status).toBe(202);

    await vi.waitFor(async () => {
      const duplicate = await request(app)
        .post("/discord/agents/jobs")
        .set("authorization", `Bearer ${discordSecret}`)
        .send(body);
      expect(duplicate.status).toBe(200);
      expect(duplicate.body).toEqual({ jobId: body.requestId, status: "completed" });
    });

    const conflict = await request(app)
      .post("/discord/agents/jobs")
      .set("authorization", `Bearer ${discordSecret}`)
      .send({ ...body, messages: [{ ...firstDiscordMessage, content: "Changed content" }] });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual({ error: "discord_agent_job_conflict" });
    expect(discordAgents.run).toHaveBeenCalledTimes(1);
  });

  it("returns a safe failed job without exposing the runner error", async () => {
    const discordAgents = agents();
    vi.mocked(discordAgents.run).mockRejectedValue(
      new Error("rate limit from PRIVATE_PROVIDER_OUTPUT"),
    );
    const app = appWithJobs(discordAgents);
    const body = {
      requestId: "triage_job_3",
      profile: "triage" as const,
      triggerKind: "ambient" as const,
      channel: discordChannel,
      messages: discordMessages,
    };
    await request(app)
      .post("/discord/agents/jobs")
      .set("authorization", `Bearer ${discordSecret}`)
      .send(body);

    await vi.waitFor(async () => {
      const failed = await request(app)
        .get(`/discord/agents/jobs/${body.requestId}`)
        .set("authorization", `Bearer ${discordSecret}`);
      expect(failed.body).toEqual({
        jobId: body.requestId,
        status: "failed",
        code: "provider_rate_limited",
        retryable: true,
      });
      expect(JSON.stringify(failed.body)).not.toContain("PRIVATE_PROVIDER_OUTPUT");
    });
  });

  it("returns a bounded non-retryable output failure from the job API", async () => {
    const discordAgents = agents();
    vi.mocked(discordAgents.run).mockRejectedValue(
      new DiscordAgentOutputError("invalid_response_schema"),
    );
    const app = appWithJobs(discordAgents);
    const body = {
      requestId: "triage_job_output_failure",
      profile: "triage" as const,
      triggerKind: "ambient" as const,
      channel: discordChannel,
      messages: discordMessages,
    };
    await request(app)
      .post("/discord/agents/jobs")
      .set("authorization", `Bearer ${discordSecret}`)
      .send(body);

    await vi.waitFor(async () => {
      const failed = await request(app)
        .get(`/discord/agents/jobs/${body.requestId}`)
        .set("authorization", `Bearer ${discordSecret}`);
      expect(failed.body).toEqual({
        jobId: body.requestId,
        status: "failed",
        code: "invalid_response_schema",
        retryable: false,
      });
      const serialized = JSON.stringify(failed.body);
      expect(serialized).not.toContain("Zod");
      expect(serialized).not.toContain("https://");
    });
  });

  it("cancels a running job and requires Discord authentication for job routes", async () => {
    let receivedSignal: AbortSignal | undefined;
    const discordAgents = agents();
    vi.mocked(discordAgents.run).mockImplementation(async (_body, signal) => {
      receivedSignal = signal;
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      throw new Error("unreachable");
    });
    const app = appWithJobs(discordAgents);
    const body = {
      requestId: "triage_job_4",
      profile: "triage" as const,
      triggerKind: "ambient" as const,
      channel: discordChannel,
      messages: discordMessages,
    };
    const unauthorized = await request(app).post("/discord/agents/jobs").send(body);
    expect(unauthorized.status).toBe(401);
    expect(discordAgents.run).not.toHaveBeenCalled();

    await request(app)
      .post("/discord/agents/jobs")
      .set("authorization", `Bearer ${discordSecret}`)
      .send(body);
    const cancelled = await request(app)
      .delete(`/discord/agents/jobs/${body.requestId}`)
      .set("authorization", `Bearer ${discordSecret}`);
    expect(cancelled.body).toEqual({ jobId: body.requestId, status: "cancelled" });
    expect(receivedSignal?.aborted).toBe(true);

    const missing = await request(app)
      .get(`/discord/agents/jobs/${body.requestId}`)
      .set("authorization", `Bearer ${discordSecret}`);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "discord_agent_job_not_found" });
  });
});
