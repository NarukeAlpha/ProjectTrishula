import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp, type AppRunRegistry } from "../src/app.js";
import type { DiscordAgentRunner } from "../src/discord/runner.js";
import { TestExecutor } from "./helpers.js";
import { discordChannel, discordMessages } from "./discord-contracts.test.js";

const serviceSecret = "a-secure-service-secret-with-32-chars";
const discordSecret = "an-independent-discord-secret-with-32-chars";

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
      shouldRespond: true,
      shouldResearch: true,
      question: "Why did AMD move today?",
      reason: "Time-sensitive asset question.",
      confidence: 0.95,
    })),
    dispose: vi.fn(async () => undefined),
  };
}

describe("Discord agent HTTP endpoint", () => {
  it("requires the service bearer secret", async () => {
    const discordAgents = agents();
    const response = await request(createApp({ sharedSecret: serviceSecret, discordSharedSecret: discordSecret, executor: new TestExecutor(), registry: registry(), discordAgents }))
      .post("/discord/agents/run")
      .send({ requestId: "triage_1", profile: "triage", channel: discordChannel, messages: discordMessages });
    expect(response.status).toBe(401);
    expect(discordAgents.run).not.toHaveBeenCalled();
  });

  it("runs a valid isolated agent profile", async () => {
    const discordAgents = agents();
    const body = { requestId: "triage_1", profile: "triage" as const, channel: discordChannel, messages: discordMessages };
    const response = await request(createApp({ sharedSecret: serviceSecret, discordSharedSecret: discordSecret, executor: new TestExecutor(), registry: registry(), discordAgents }))
      .post("/discord/agents/run")
      .set("authorization", `Bearer ${discordSecret}`)
      .send(body);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ profile: "triage", shouldResearch: true });
    expect(discordAgents.run).toHaveBeenCalledWith(body, expect.any(AbortSignal));
  });

  it("rejects more than ten context messages", async () => {
    const discordAgents = agents();
    const response = await request(createApp({ sharedSecret: serviceSecret, discordSharedSecret: discordSecret, executor: new TestExecutor(), registry: registry(), discordAgents }))
      .post("/discord/agents/run")
      .set("authorization", `Bearer ${discordSecret}`)
      .send({ requestId: "triage_1", profile: "triage", channel: discordChannel, messages: Array.from({ length: 11 }, (_, index) => ({ ...discordMessages[0], messageId: String(index + 1) })) });
    expect(response.status).toBe(400);
    expect(discordAgents.run).not.toHaveBeenCalled();
  });

  it("rejects the broader Pi service secret", async () => {
    const discordAgents = agents();
    const response = await request(createApp({ sharedSecret: serviceSecret, discordSharedSecret: discordSecret, executor: new TestExecutor(), registry: registry(), discordAgents }))
      .post("/discord/agents/run")
      .set("authorization", `Bearer ${serviceSecret}`)
      .send({ requestId: "triage_1", profile: "triage", channel: discordChannel, messages: discordMessages });
    expect(response.status).toBe(401);
    expect(discordAgents.run).not.toHaveBeenCalled();
  });
});
