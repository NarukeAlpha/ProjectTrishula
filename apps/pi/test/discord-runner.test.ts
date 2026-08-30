import { describe, expect, it } from "vitest";
import {
  DISCORD_AGENT_PROFILES,
  normalizeReplyForLoopDepth,
  parseDiscordAgentOutput,
} from "../src/discord/runner.js";

describe("Discord Pi agent profiles", () => {
  it("pins Luna, Sol, xhigh, and the approved tool boundaries", () => {
    expect(DISCORD_AGENT_PROFILES).toEqual({
      triage: { modelId: "gpt-5.6-luna", thinkingLevel: "xhigh", toolNames: [] },
      research: {
        modelId: "gpt-5.6-sol",
        thinkingLevel: "xhigh",
        toolNames: ["public_web_search", "public_web_fetch", "public_market_data"],
      },
      reply: { modelId: "gpt-5.6-luna", thinkingLevel: "xhigh", toolNames: [] },
    });
  });

  it("parses a fenced structured triage response", () => {
    expect(parseDiscordAgentOutput("triage", `\`\`\`json
      {"profile":"triage","shouldRespond":true,"shouldResearch":true,"question":"Why did AMD move today?","reason":"Time-sensitive asset question.","confidence":0.94}
    \`\`\``)).toMatchObject({ profile: "triage", shouldResearch: true });
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
});
