import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { describe, expect, it, vi } from "vitest";
import { registerCodexResearchModel } from "../src/pi/codex-catalog.js";
import { validateLockedDiscordProviderTransport } from "../src/assistant/profiles.js";
import { withAstraServiceTier } from "../src/pi/codex-transport.js";

async function offlineRuntime() {
  return ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
}

describe("pinned Codex Astra catalog extension", () => {
  it("adds Astra while preserving every existing model and the built-in OAuth provider", async () => {
    const runtime = await offlineRuntime();
    const existing = [...runtime.getModels("openai-codex")];
    const oauth = runtime.getProvider("openai-codex")?.auth.oauth;
    registerCodexResearchModel(runtime);
    await runtime.refresh({ allowNetwork: false });
    for (const model of existing) expect(runtime.getModel("openai-codex", model.id)).toMatchObject({ id: model.id, api: model.api, contextWindow: model.contextWindow, thinkingLevelMap: model.thinkingLevelMap });
    const astra = runtime.getModel("openai-codex", "gpt-6-astra");
    expect(astra).toMatchObject({ id: "gpt-6-astra", api: "openai-codex-responses", provider: "openai-codex", baseUrl: "https://chatgpt.com/backend-api", contextWindow: 272_000, maxTokens: 128_000, thinkingLevelMap: { xhigh: "xhigh", max: "max" }, input: ["text", "image"] });
    expect(runtime.getProvider("openai-codex")?.auth.oauth?.name).toBe(oauth?.name);
    expect(runtime.getProvider("openai-codex")?.auth.oauth?.isSubscription).toBe(true);
    expect(Object.keys(runtime.getRegisteredProviderConfig("openai-codex") ?? {})).toEqual(["models"]);
    expect(await runtime.listCredentials()).toEqual([]);
    const luna = runtime.getModel("openai-codex", "gpt-5.6-luna");
    if (!luna || !astra) throw new Error("Expected catalog models.");
    expect(() => validateLockedDiscordProviderTransport({ luna, sol: astra }, 272_000)).not.toThrow();
    registerCodexResearchModel(runtime);
    expect(runtime.getModels("openai-codex").filter((model) => model.id === "gpt-6-astra")).toHaveLength(1);
  });

  it.each(["xhigh", "max"] as const)("preserves %s and priority in the pinned transport without contacting a provider", async (reasoning) => {
    const runtime = await offlineRuntime();
    registerCodexResearchModel(runtime);
    const model = runtime.getModel("openai-codex", "gpt-6-astra");
    if (!model) throw new Error("Expected Astra catalog model.");
    const apiKey = `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "offline-test-account" } })).toString("base64url")}.unsigned`;
    const fetch = vi.fn<typeof globalThis.fetch>();
    const onPayload = vi.fn<NonNullable<SimpleStreamOptions["onPayload"]>>(() => {
      throw new Error("offline-payload-inspection-complete");
    });
    const options = { apiKey, reasoning, serviceTier: "priority", fetch, onPayload, maxRetries: 0 };
    const output = streamSimple({ ...model, api: "openai-codex-responses" }, { messages: [] }, withAstraServiceTier(model, options));
    await output.result();
    expect(onPayload).toHaveBeenCalledOnce();
    const payload = onPayload.mock.calls[0]?.[0];
    expect(payload).toMatchObject({ model: "gpt-6-astra", reasoning: { effort: reasoning }, service_tier: "priority" });
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("top_p");
    expect(payload).not.toHaveProperty("prompt_cache_retention");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leaves non-Astra models, other providers, and unspecified tiers unchanged", async () => {
    const runtime = await offlineRuntime();
    const onPayload = vi.fn<NonNullable<SimpleStreamOptions["onPayload"]>>();
    const options = { serviceTier: "priority", onPayload };
    for (const id of ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]) {
      const model = runtime.getModel("openai-codex", id);
      if (!model) throw new Error("Expected existing catalog model.");
      expect(withAstraServiceTier(model, options)).toBe(options);
    }
    expect(withAstraServiceTier({ id: "gpt-6-astra", provider: "openai" }, options)).toBe(options);
    const withoutTier = { onPayload };
    expect(withAstraServiceTier({ id: "gpt-6-astra", provider: "openai-codex" }, withoutTier)).toBe(withoutTier);
    expect(onPayload).not.toHaveBeenCalled();
  });

  it("chains existing async payload hooks and preserves their replacement fields", async () => {
    const runtime = await offlineRuntime();
    registerCodexResearchModel(runtime);
    const model = runtime.getModel("openai-codex", "gpt-6-astra");
    if (!model) throw new Error("Expected Astra catalog model.");
    const payload = { model: model.id, input: [{ type: "message", content: "fixture" }], reasoning: { effort: "max" } };
    const replacement = { ...payload, input: [{ type: "compaction", content: "opaque-fixture" }], metadata: { hook: "preserved" }, service_tier: "default" };
    const onPayload = vi.fn<NonNullable<SimpleStreamOptions["onPayload"]>>().mockResolvedValue(replacement);
    const wrapped = withAstraServiceTier(model, { serviceTier: "priority", onPayload });
    await expect(wrapped.onPayload?.(payload, model)).resolves.toEqual({ ...replacement, service_tier: "priority" });
    expect(onPayload).toHaveBeenCalledWith({ ...payload, service_tier: "priority" }, model);
    expect(payload).not.toHaveProperty("service_tier");
    expect(replacement.service_tier).toBe("default");
  });

  it("preserves the payload when an existing observer returns no replacement", async () => {
    const runtime = await offlineRuntime();
    registerCodexResearchModel(runtime);
    const model = runtime.getModel("openai-codex", "gpt-6-astra");
    if (!model) throw new Error("Expected Astra catalog model.");
    const payload = { model: model.id, input: [], reasoning: { effort: "xhigh" }, extra: "retained" };
    const onPayload = vi.fn<NonNullable<SimpleStreamOptions["onPayload"]>>().mockResolvedValue(undefined);
    const wrapped = withAstraServiceTier(model, { serviceTier: "default", onPayload });
    await expect(wrapped.onPayload?.(payload, model)).resolves.toEqual({ ...payload, service_tier: "default" });
    expect(onPayload).toHaveBeenCalledOnce();
  });
});
