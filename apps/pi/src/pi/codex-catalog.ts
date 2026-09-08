import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export const ASTRA_CODEX_MODEL_ID = "gpt-6-astra";

/** Extend the pinned catalog without replacing its Codex OAuth provider or transport. */
export function registerCodexResearchModel(runtime: ModelRuntime): void {
  runtime.registerProvider("openai-codex", {
    models: [...runtime.getModels("openai-codex").filter((model) => model.id !== ASTRA_CODEX_MODEL_ID), {
      id: ASTRA_CODEX_MODEL_ID,
      name: "GPT-6 Astra",
      api: "openai-codex-responses",
      reasoning: true,
      thinkingLevelMap: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
      input: ["text", "image"],
      // API-equivalent estimates, not subscription charges: https://developers.openai.com/api/docs/pricing
      cost: {
        input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5,
        tiers: [{ inputTokensAbove: 272_000, input: 20, output: 75, cacheRead: 2, cacheWrite: 25 }],
      },
      // Keep the existing application budget even though Astra supports a larger context.
      contextWindow: 272_000,
      maxTokens: 128_000,
      compat: { supportsOpenAIGrammarTools: true, supportsToolSearch: true },
    }],
  });
}
