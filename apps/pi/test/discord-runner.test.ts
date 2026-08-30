import { describe, expect, it, vi } from "vitest";
import {
  completedDiscordAssistantText,
  DISCORD_AGENT_PROFILES,
  generateDiscordAgentOutput,
  normalizeReplyForLoopDepth,
  parseDiscordAgentOutput,
} from "../src/discord/runner.js";
import { DiscordAgentOutputError } from "../src/discord/errors.js";
import type { DiscordAgentRequest } from "../src/discord/contracts.js";
import { discordChannel, discordMessages } from "./discord-contracts.test.js";

const triageRequest: DiscordAgentRequest = {
  requestId: "triage_repair_1",
  profile: "triage",
  channel: discordChannel,
  messages: discordMessages,
};

const validTriageOutput = JSON.stringify({
  profile: "triage",
  shouldRespond: true,
  shouldResearch: true,
  question: "Why did AMD move today?",
  reason: "Time-sensitive asset question.",
  confidence: 0.94,
});

describe("Discord Pi agent profiles", () => {
  it("pins Luna, Sol, xhigh, priority service, and the approved tool boundaries", () => {
    expect(DISCORD_AGENT_PROFILES).toEqual({
      triage: {
        modelId: "gpt-5.6-luna",
        thinkingLevel: "xhigh",
        serviceTier: "priority",
        toolNames: [],
      },
      acknowledge: {
        modelId: "gpt-5.6-luna",
        thinkingLevel: "xhigh",
        serviceTier: "priority",
        toolNames: [],
      },
      research: {
        modelId: "gpt-5.6-sol",
        thinkingLevel: "xhigh",
        serviceTier: "priority",
        toolNames: ["public_web_search", "public_web_fetch", "public_market_data"],
      },
      reply: {
        modelId: "gpt-5.6-luna",
        thinkingLevel: "xhigh",
        serviceTier: "priority",
        toolNames: [],
      },
    });
  });

  it("parses a fenced structured triage response", () => {
    expect(parseDiscordAgentOutput("triage", `\`\`\`json
      {"profile":"triage","shouldRespond":true,"shouldResearch":true,"question":"Why did AMD move today?","reason":"Time-sensitive asset question.","confidence":0.94}
    \`\`\``)).toMatchObject({ profile: "triage", shouldResearch: true });
  });

  it("parses a fenced structured acknowledgement response", () => {
    expect(parseDiscordAgentOutput("acknowledge", `\`\`\`json
      {"profile":"acknowledge","acknowledgement":"I picked this up and will check the market move."}
    \`\`\``)).toMatchObject({ profile: "acknowledge" });
  });

  it("stops recursive rechecks after two passes", () => {
    expect(normalizeReplyForLoopDepth({
      profile: "reply",
      reply: "That changes the comparison.",
      recheck: true,
      recheckReason: "The reply introduces a new factual comparison.",
    }, 2)).toEqual({
      profile: "reply",
      reply: "That changes the comparison.",
      recheck: false,
      recheckReason: null,
    });
  });

  it("uses one repair generation when the first output is invalid", async () => {
    const outputs = ["not json", validTriageOutput];
    const generate = vi.fn(async () => outputs.shift() ?? "");

    await expect(generateDiscordAgentOutput(triageRequest, new Set(), generate)).resolves.toMatchObject({
      profile: "triage",
      shouldResearch: true,
    });
    expect(generate.mock.calls).toEqual([["initial"], ["repair", "invalid_json"]]);
  });

  it("stops after one repair when the second output is also invalid", async () => {
    const outputs = ["not json", JSON.stringify({ profile: "triage", confidence: "high" })];
    const generate = vi.fn(async () => outputs.shift() ?? "");

    await expect(generateDiscordAgentOutput(triageRequest, new Set(), generate)).rejects.toMatchObject({
      code: "invalid_response_schema",
      message: "The Discord agent response did not match the required shape.",
      retryable: false,
    });
    expect(generate.mock.calls).toEqual([["initial"], ["repair", "invalid_json"]]);
  });

  it("does not expose an unverified source URL in the terminal output error", async () => {
    const privateUrl = "https://private.example.invalid/assistant-output";
    const researchRequest: DiscordAgentRequest = {
      requestId: "research_repair_1",
      profile: "research",
      channel: discordChannel,
      messages: discordMessages,
      question: "Why did AMD move today?",
    };
    const unverifiedOutput = JSON.stringify({
      profile: "research",
      summary: "A result.",
      findings: [{ claim: "A claim.", sourceUrls: [privateUrl] }],
      sources: [{
        url: privateUrl,
        title: "Private output",
        publishedAt: null,
        accessedAt: "2026-08-30T12:00:00.000Z",
      }],
      freshness: { asOf: "2026-08-30T12:00:00.000Z", status: "limited" },
      uncertainty: [],
      noTradingAction: true,
    });
    const generate = vi.fn(async () => unverifiedOutput);

    let failure: unknown;
    try {
      await generateDiscordAgentOutput(researchRequest, new Set(), generate);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(DiscordAgentOutputError);
    if (!(failure instanceof DiscordAgentOutputError)) throw new Error("Expected an output error.");
    expect(failure).toMatchObject({ code: "unverified_source_url", retryable: false });
    expect(`${failure.message}\n${failure.stack ?? ""}`).not.toContain(privateUrl);
    expect(generate.mock.calls).toEqual([["initial"], ["repair", "unverified_source_url"]]);
  });

  it("does not use output repair for a provider terminal message", async () => {
    const generate = vi.fn(async () => {
      return completedDiscordAssistantText({
        stopReason: "error",
        errorMessage: "fetch failed with PRIVATE_PROVIDER_FAILURE",
        text: "not json",
      });
    });

    await expect(generateDiscordAgentOutput(triageRequest, new Set(), generate)).rejects.toThrow(
      "fetch failed with PRIVATE_PROVIDER_FAILURE",
    );
    expect(generate.mock.calls).toEqual([["initial"]]);
  });
});
