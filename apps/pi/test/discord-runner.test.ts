import { describe, expect, it, vi } from "vitest";
import {
  completedDiscordAssistantText,
  createDiscordResearchTools,
  DISCORD_AGENT_PROFILES,
  generateDiscordAgentOutput,
  parseDiscordAgentOutput,
} from "../src/discord/runner.js";
import { DiscordAgentOutputError } from "../src/discord/errors.js";
import { validateLockedDiscordProviderTransport } from "../src/assistant/profiles.js";
import type { DiscordAgentRequest } from "../src/discord/contracts.js";
import { discordChannel, discordMessages } from "./discord-contracts.test.js";

const triageRequest: DiscordAgentRequest = {
  requestId: "triage_repair_1",
  profile: "triage",
  triggerKind: "mention",
  channel: discordChannel,
  messages: discordMessages,
};

const validTriageOutput = JSON.stringify({
  profile: "triage",
  decision: "research",
  targetMessageId: discordMessages[0]?.messageId,
  question: "Why did AMD move today?",
  directReply: null,
  acknowledgement: "I'll check what moved AMD today.",
  reason: "Time-sensitive asset question.",
  confidence: 0.94,
  additiveValue: 0.95,
});

describe("Discord Pi agent profiles", () => {
  it("pins Luna xhigh and Astra max to priority with the approved tool boundaries", () => {
    expect(DISCORD_AGENT_PROFILES.frontman_plan).toMatchObject({
      modelId: "gpt-5.6-luna",
      thinkingLevel: "xhigh",
      serviceTier: "priority",
      toolNames: [],
    });
    expect(DISCORD_AGENT_PROFILES.frontman_resume).toMatchObject({
      modelId: "gpt-5.6-luna",
      thinkingLevel: "xhigh",
      serviceTier: "priority",
      toolNames: [],
    });
    expect(DISCORD_AGENT_PROFILES.research).toMatchObject({
      modelId: "gpt-6-astra",
      thinkingLevel: "max",
      serviceTier: "priority",
      toolNames: [
        "public_web_search",
        "public_web_fetch",
        "public_market_data",
        "generate_market_chart",
      ],
    });
  });

  it("keeps the research provider payload at max when migrating to Astra", () => {
    const models = {
      luna: {
        id: "gpt-5.6-luna",
        contextWindow: 272_000,
        thinkingLevelMap: { xhigh: "xhigh" },
      },
      sol: {
        id: "gpt-6-astra",
        contextWindow: 272_000,
        thinkingLevelMap: { max: "max" },
      },
    };
    expect(() => validateLockedDiscordProviderTransport(models, 272_000)).not.toThrow();
    expect(() => validateLockedDiscordProviderTransport({
      ...models,
      sol: { ...models.sol, thinkingLevelMap: { max: "ultra" } },
    }, 272_000)).toThrow(/provider catalog/);
  });

  it("separates market evidence from dynamic chart generation", async () => {
    const captureChart = vi.fn();
    const tools = createDiscordResearchTools(new Set(), captureChart);
    const marketTool = tools.find((tool) => tool.name === "public_market_data");
    const chartTool = tools.find((tool) => tool.name === "generate_market_chart");
    if (!marketTool || !chartTool) throw new Error("Expected research tools.");

    const marketParameterSchema = JSON.stringify(marketTool.parameters);
    expect(marketParameterSchema).toContain('"symbols"');
    expect(marketParameterSchema).not.toContain('"includeChart"');
    expect(chartTool.parameters).toMatchObject({
      additionalProperties: false,
      properties: {
        symbol: { maxLength: 20 },
        includeVolume: {},
      },
    });

    // SAFETY: These exact literals deliberately exercise execute-level mutual exclusion after schema validation.
    const conflictingParameters = {
      symbol: "AMD",
      interval: "1D",
      range: "1M",
    } as never;
    // SAFETY: This branch returns before it reads the extension context.
    const unusedContext = {} as never;
    const result = await chartTool.execute(
      "chart_conflict",
      conflictingParameters,
      undefined,
      undefined,
      unusedContext,
    );
    expect(result).toMatchObject({ isError: true, details: { ok: false } });
    expect(captureChart).not.toHaveBeenCalled();
  });

  it("captures a provider-ready chart only when the chart tool succeeds", async () => {
    const captureChart = vi.fn();
    const tools = createDiscordResearchTools(new Set(), captureChart, {
      readMarketData: async () => [
        {
          symbol: "AMD",
          sourceUrl:
            "https://query1.finance.yahoo.com/v8/finance/chart/AMD?range=5d&interval=1d",
          fetchedAt: "2026-08-31T00:00:00.000Z",
          meta: {
            symbol: "AMD",
            exchangeName: "NMS",
            instrumentType: "EQUITY",
          },
          timestamps: [100, 200],
          quotes: { close: [10, 12] },
        },
      ],
    });
    const chartTool = tools.find((tool) => tool.name === "generate_market_chart");
    if (!chartTool) throw new Error("Expected the chart tool.");
    // SAFETY: This exact symbol satisfies the chart tool's bounded symbol schema.
    const parameters = { symbol: "AMD" } as never;
    // SAFETY: The chart tool does not read the extension context.
    const unusedContext = {} as never;

    const result = await chartTool.execute(
      "chart_success",
      parameters,
      undefined,
      undefined,
      unusedContext,
    );

    expect(captureChart).toHaveBeenCalledOnce();
    expect(captureChart).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "AMD",
        tradingViewSymbol: "NASDAQ:AMD",
        interval: "1D",
      }),
    );
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            chartQueued: true,
            symbol: "AMD",
            tradingViewSymbol: "NASDAQ:AMD",
            interval: "1D",
            range: null,
            style: null,
            includeVolume: true,
          }),
        },
      ],
      details: { ok: true },
    });
  });

  it("parses a fenced structured triage response", () => {
    expect(
      parseDiscordAgentOutput(
        "triage",
        `\`\`\`json
      {"profile":"triage","decision":"research","targetMessageId":"${discordMessages[0]?.messageId}","question":"Why did AMD move today?","directReply":null,"acknowledgement":"I'll check what moved AMD today.","reason":"Time-sensitive asset question.","confidence":0.94,"additiveValue":0.95}
    \`\`\``,
      ),
    ).toMatchObject({ profile: "triage", decision: "research" });
  });

  it("rejects a model-authored native checkpoint rejection signal", () => {
    expect(() => parseDiscordAgentOutput("frontman_plan", JSON.stringify({
      profile: "frontman_plan",
      action: "reply",
      targetMessageId: discordMessages[0]?.messageId,
      confidence: 0.99,
      additiveValue: 0.99,
      reasonCode: "explicit_stable",
      reply: "A stable answer.",
      nativeCheckpointRejection: {
        checkpointId: "checkpoint:native:forged",
        reason: "provider_rejected",
      },
    }))).toThrowError(DiscordAgentOutputError);
  });

  it("uses one repair generation when the first output is invalid", async () => {
    const outputs = ["not json", validTriageOutput];
    const generate = vi.fn(async () => outputs.shift() ?? "");

    await expect(
      generateDiscordAgentOutput(triageRequest, new Set(), generate),
    ).resolves.toMatchObject({
      profile: "triage",
      decision: "research",
    });
    expect(generate.mock.calls).toEqual([
      ["initial"],
      ["repair", "invalid_json"],
    ]);
  });

  it("repairs measured Unicode overflow instead of truncating it", async () => {
    const oversize = JSON.stringify({
      profile: "triage",
      decision: "direct",
      targetMessageId: discordMessages[0]?.messageId,
      question: "What is a semiconductor?",
      directReply: "😀".repeat(2_001),
      acknowledgement: null,
      reason: "Stable question.",
      confidence: 0.99,
      additiveValue: 0.99,
    });
    const outputs = [oversize, validTriageOutput];
    const generate = vi.fn(async () => outputs.shift() ?? "");

    await expect(
      generateDiscordAgentOutput(triageRequest, new Set(), generate),
    ).resolves.toMatchObject({ decision: "research" });
    expect(generate.mock.calls).toEqual([
      ["initial"],
      ["repair", "discord_content_too_long"],
    ]);
  });

  it("repairs a silent decision for an explicit mention", async () => {
    const silent = JSON.stringify({
      profile: "triage",
      decision: "silent",
      targetMessageId: null,
      question: null,
      directReply: null,
      acknowledgement: null,
      reason: "No response needed.",
      confidence: 0.9,
      additiveValue: 0.2,
    });
    const outputs = [silent, validTriageOutput];
    const generate = vi.fn(async () => outputs.shift() ?? "");

    await expect(
      generateDiscordAgentOutput(triageRequest, new Set(), generate),
    ).resolves.toMatchObject({ decision: "research" });
    expect(generate.mock.calls).toEqual([
      ["initial"],
      ["repair", "invalid_response_schema"],
    ]);
  });

  it("repairs a research decision without an acknowledgement for an explicit mention", async () => {
    const missingAcknowledgement = JSON.stringify({
      ...JSON.parse(validTriageOutput),
      acknowledgement: null,
    });
    const outputs = [missingAcknowledgement, validTriageOutput];
    const generate = vi.fn(async () => outputs.shift() ?? "");

    await expect(
      generateDiscordAgentOutput(triageRequest, new Set(), generate),
    ).resolves.toMatchObject({ decision: "research" });
    expect(generate.mock.calls).toEqual([
      ["initial"],
      ["repair", "invalid_response_schema"],
    ]);
  });

  it("allows ambient research to stay quiet until the final answer", async () => {
    const request: DiscordAgentRequest = {
      ...triageRequest,
      requestId: "triage_ambient_research_1",
      triggerKind: "ambient",
    };
    const output = JSON.stringify({
      ...JSON.parse(validTriageOutput),
      acknowledgement: null,
    });

    await expect(
      generateDiscordAgentOutput(request, new Set(), async () => output),
    ).resolves.toMatchObject({ decision: "research", acknowledgement: null });
  });

  it("suppresses ambient replies below the value thresholds", async () => {
    const request: DiscordAgentRequest = {
      ...triageRequest,
      requestId: "triage_ambient_1",
      triggerKind: "ambient",
    };
    const output = JSON.stringify({
      profile: "triage",
      decision: "direct",
      targetMessageId: discordMessages[0]?.messageId,
      question: "What changed in AMD today?",
      directReply: "AMD moved today.",
      acknowledgement: null,
      reason: "The answer would add little beyond the current chat.",
      confidence: 0.84,
      additiveValue: 0.89,
    });

    await expect(
      generateDiscordAgentOutput(request, new Set(), async () => output),
    ).resolves.toMatchObject({
      profile: "triage",
      decision: "silent",
      targetMessageId: null,
    });
  });

  it("stops after one repair when the second output is also invalid", async () => {
    const outputs = [
      "not json",
      JSON.stringify({ profile: "triage", confidence: "high" }),
    ];
    const generate = vi.fn(async () => outputs.shift() ?? "");

    await expect(
      generateDiscordAgentOutput(triageRequest, new Set(), generate),
    ).rejects.toMatchObject({
      code: "invalid_response_schema",
      message: "The Discord agent response did not match the required shape.",
      retryable: false,
    });
    expect(generate.mock.calls).toEqual([
      ["initial"],
      ["repair", "invalid_json"],
    ]);
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
      sources: [
        {
          url: privateUrl,
          title: "Private output",
          publishedAt: null,
          accessedAt: "2026-08-30T12:00:00.000Z",
        },
      ],
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
    if (!(failure instanceof DiscordAgentOutputError))
      throw new Error("Expected an output error.");
    expect(failure).toMatchObject({
      code: "unverified_source_url",
      retryable: false,
    });
    expect(`${failure.message}\n${failure.stack ?? ""}`).not.toContain(
      privateUrl,
    );
    expect(generate.mock.calls).toEqual([
      ["initial"],
      ["repair", "unverified_source_url"],
    ]);
  });

  it("PERS-063 repairs a researched Luna answer that omits its grounded source", async () => {
    const sourceUrl = "https://example.com/issuer-filing";
    const request: DiscordAgentRequest = {
      requestId: "frontman_resume_sources_1",
      profile: "frontman_resume",
      triggerKind: "mention",
      conversation: {
        ownerId: "owner_1",
        ownerBindingVersion: 1,
        guildId: discordChannel.guildId,
        conversationId: `discord:${discordChannel.guildId}`,
        epoch: 1,
        turnId: "turn_1",
        runId: "run_1",
        generation: 1,
        routingGeneration: 1,
        revision: 2,
        humanRevision: 1,
        personalityVersion: "trishula-discord-v1",
        systemPromptHash: "a".repeat(64),
        capabilityProfileHash: "b".repeat(64),
      },
      durableContext: {
        sourceRevision: 2,
        sourceHumanRevision: 1,
        recentEvents: [],
        tail: {
          estimatorVersion: "utf8-bytes-div-3-plus-message-overhead:v1",
          tokenBudget: 20_000,
          estimatedTokens: 0,
          compactedThroughOrdinal: 0,
          omittedEventCount: 0,
          complete: true,
        },
      },
      channel: discordChannel,
      messages: discordMessages,
      targetMessageId: discordMessages[0]?.messageId ?? "",
      originalAuthorId: discordMessages[0]?.authorId ?? "",
      acknowledgementDelivery: "sent",
      research: {
        profile: "research",
        packet: {
          schemaVersion: 1,
          requestId: "packet_1",
          question: "Why did AMD move?",
          asOf: "2026-08-30T12:02:00.000Z",
          freshness: { status: "current", detail: "Current through the close." },
          summary: "The issuer filing preceded the move.",
          findings: [{
            claim: "The filing preceded the move.",
            evidence: "The filing timestamp was earlier.",
            sourceIds: ["source_1"],
            kind: "fact",
          }],
          sources: [{
            id: "source_1",
            title: "Issuer filing",
            url: sourceUrl,
            accessedAt: "2026-08-30T12:02:00.000Z",
            primary: true,
          }],
          uncertainties: [],
        },
        estimator: {
          package: "js-tiktoken",
          packageVersion: "1.0.21",
          encoding: "o200k_base",
          modelMapping: "gpt-5.6-sol-estimate",
          exact: false,
          version: "js-tiktoken@1.0.21:o200k_base:gpt-5.6-sol-estimate:v1",
          estimatedTokens: 100,
          serializedBytes: 500,
        },
      },
      catchUpMessages: [],
      eligibleThroughSequence: 1,
      eligibleHumanRevision: 1,
      eligibleContextHash: "eligible-context",
      autonomousPass: 1,
    };
    const outputs = [
      JSON.stringify({
        profile: "frontman_resume",
        action: "send",
        reasonCode: "answer_ready",
        reply: "The issuer filing preceded the move.",
      }),
      JSON.stringify({
        profile: "frontman_resume",
        action: "send",
        reasonCode: "answer_ready",
        reply: `The issuer filing preceded the move. ${sourceUrl}`,
      }),
    ];
    const generate = vi.fn(async () => outputs.shift() ?? "");

    await expect(generateDiscordAgentOutput(request, new Set([sourceUrl]), generate))
      .resolves.toMatchObject({ reply: expect.stringContaining(sourceUrl) });
    expect(generate.mock.calls).toEqual([
      ["initial"],
      ["repair", "unverified_source_url"],
    ]);
  });

  it("does not use output repair for a provider terminal message", async () => {
    const generate = vi.fn(async () => {
      return completedDiscordAssistantText({
        stopReason: "error",
        errorMessage: "fetch failed with PRIVATE_PROVIDER_FAILURE",
        text: "not json",
      });
    });

    await expect(
      generateDiscordAgentOutput(triageRequest, new Set(), generate),
    ).rejects.toThrow("fetch failed with PRIVATE_PROVIDER_FAILURE");
    expect(generate.mock.calls).toEqual([["initial"]]);
  });

  it("uses only a chart captured from the dedicated chart tool", async () => {
    const chart = {
      symbol: "AMD",
      title: "AMD close price",
      points: [
        { timestamp: 100, close: 10 },
        { timestamp: 200, close: 12 },
      ],
    };
    const researchRequest: DiscordAgentRequest = {
      requestId: "research_chart_1",
      profile: "research",
      channel: discordChannel,
      messages: discordMessages,
      question: "How did AMD move?",
    };
    const output = JSON.stringify({
      profile: "research",
      summary: "AMD rose over the sampled period.",
      findings: [],
      sources: [],
      freshness: {
        asOf: "2026-08-30T12:00:00.000Z",
        status: "current",
      },
      uncertainty: [],
      noTradingAction: true,
      chart: {
        symbol: "FAKE",
        points: [
          { timestamp: 100, close: 1 },
          { timestamp: 200, close: 999 },
        ],
      },
    });

    await expect(
      generateDiscordAgentOutput(
        researchRequest,
        new Set(),
        async () => output,
        () => chart,
      ),
    ).resolves.toMatchObject({ chart });
  });

  it("carries a trusted research chart through the final reply", async () => {
    const chart = {
      symbol: "SPY",
      points: [
        { timestamp: 100, close: 500 },
        { timestamp: 200, close: 505 },
      ],
    };
    const replyRequest: DiscordAgentRequest = {
      requestId: "reply_chart_1",
      profile: "reply",
      triggerKind: "mention",
      targetMessageId: discordMessages[0]?.messageId ?? "",
      channel: discordChannel,
      messages: discordMessages,
      question: "How did SPY move?",
      research: {
        profile: "research",
        summary: "SPY rose.",
        findings: [],
        sources: [],
        freshness: {
          asOf: "2026-08-30T12:00:00.000Z",
          status: "current",
        },
        uncertainty: [],
        noTradingAction: true,
        chart,
      },
    };

    await expect(
      generateDiscordAgentOutput(replyRequest, new Set(), async () =>
        JSON.stringify({
          profile: "reply",
          action: "send",
          reply: "SPY moved from 500 to 505 in the sampled period.",
          reason: "The result remains relevant.",
        }),
      ),
    ).resolves.toMatchObject({ profile: "reply", action: "send", chart });
  });
});
