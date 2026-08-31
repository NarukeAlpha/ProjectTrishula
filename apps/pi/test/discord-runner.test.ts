import { describe, expect, it, vi } from "vitest";
import {
  completedDiscordAssistantText,
  createDiscordResearchTools,
  DISCORD_AGENT_PROFILES,
  generateDiscordAgentOutput,
  parseDiscordAgentOutput,
} from "../src/discord/runner.js";
import { DiscordAgentOutputError } from "../src/discord/errors.js";
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
  it("pins Luna, Sol, xhigh, priority service, and the approved tool boundaries", () => {
    expect(DISCORD_AGENT_PROFILES).toEqual({
      triage: {
        modelId: "gpt-5.6-luna",
        thinkingLevel: "xhigh",
        serviceTier: "priority",
        toolNames: [],
      },
      research: {
        modelId: "gpt-5.6-sol",
        thinkingLevel: "xhigh",
        serviceTier: "priority",
        toolNames: [
          "public_web_search",
          "public_web_fetch",
          "public_market_data",
          "generate_market_chart",
        ],
      },
      reply: {
        modelId: "gpt-5.6-luna",
        thinkingLevel: "xhigh",
        serviceTier: "priority",
        toolNames: [],
      },
    });
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
