import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  NODE_ENV: "test",
  SERVICE_SHARED_SECRET: "a-secure-service-secret-with-32-chars",
  PI_DISCORD_SHARED_SECRET: "an-independent-discord-secret-with-32-chars",
  CONVEX_SITE_URL: "http://convex.internal/http",
};

describe("loadConfig", () => {
  it("loads strict defaults", () => {
    const config = loadConfig(base);
    expect(config.globalConcurrency).toBe(4);
    expect(config.batchWindowMs).toBe(25);
    expect(config.piAuthPath).toBe("/data/auth.json");
    expect(config.piModel).toBe("gpt-5.6-terra");
    expect(config.brokerMode).toBe("mock");
    expect(config.robinhoodOAuthRedirectUri).toBe("http://convex.internal/http/broker/robinhood/callback");
    expect(config.piCredentialKeyVersion).toBe(1);
    expect(config.discordSharedSecret).toBe(base.PI_DISCORD_SHARED_SECRET);
    expect(config).toMatchObject({
      trishulaLunaModel: "gpt-5.6-luna",
      trishulaLunaReasoningEffort: "xhigh",
      trishulaLunaServiceTier: "priority",
      trishulaSolModel: "gpt-5.6-sol",
      trishulaSolReasoningEffort: "max",
      trishulaSolServiceTier: "priority",
      trishulaPersonalityVersion: "trishula-discord-v1",
      trishulaLunaProfileVersion: "luna-frontman-v1",
      trishulaSolProfileVersion: "sol-research-v1",
      trishulaModelContextWindow: 272_000,
      trishulaLunaMaxOutputTokens: 8_000,
      trishulaSolMaxOutputTokens: 16_000,
      trishulaResearchPacketTokenTarget: 2_500,
      trishulaResearchPacketMaxBytes: 16_384,
      trishulaRecentTailTokenBudget: 20_000,
      trishulaMaxAutonomousRechecks: 2,
      trishulaAmbientMinConfidence: 0.85,
      trishulaAmbientMinAdditiveValue: 0.9,
      trishulaCompactionReserve: 32_000,
      trishulaCompactionThreshold: 190_400,
      trishulaDurableConversationsEnabled: true,
      trishulaHotSessionReuseEnabled: true,
      trishulaPortableCheckpointsEnabled: false,
      trishulaNativeCompactionEnabled: false,
    });
  });

  it("rejects model drift and gates opaque compaction on a reviewed live probe", () => {
    expect(() => loadConfig({
      ...base,
      TRISHULA_LUNA_MODEL: "gpt-5.6-terra",
    })).toThrow(/TRISHULA_LUNA_MODEL/);
    expect(() => loadConfig({
      ...base,
      TRISHULA_SOL_REASONING_EFFORT: "ultra",
    })).toThrow(/TRISHULA_SOL_REASONING_EFFORT/);
    expect(() => loadConfig({
      ...base,
      TRISHULA_NATIVE_COMPACTION_ENABLED: "true",
      TRISHULA_PORTABLE_CHECKPOINTS_ENABLED: "true",
    })).toThrow(/LIVE_PROBE_ATTESTATION/);
    expect(() => loadConfig({
      ...base,
      TRISHULA_NATIVE_COMPACTION_ENABLED: "true",
      TRISHULA_NATIVE_COMPACTION_LIVE_PROBE_ATTESTATION:
        "responses-compaction-v2-pi-0_84_1-live-2026-09-07",
    })).toThrow(/PORTABLE_CHECKPOINTS_ENABLED/);
    expect(loadConfig({
      ...base,
      TRISHULA_NATIVE_COMPACTION_ENABLED: "true",
      TRISHULA_PORTABLE_CHECKPOINTS_ENABLED: "true",
      TRISHULA_NATIVE_COMPACTION_LIVE_PROBE_ATTESTATION:
        "responses-compaction-v2-pi-0_84_1-live-2026-09-07",
    }).trishulaNativeCompactionEnabled).toBe(true);
    expect(loadConfig({
      ...base,
      TRISHULA_PORTABLE_CHECKPOINTS_ENABLED: "true",
    }).trishulaPortableCheckpointsEnabled).toBe(true);
    expect(() => loadConfig({
      ...base,
      TRISHULA_MODEL_CONTEXT_WINDOW: "400000",
    })).toThrow(/TRISHULA_MODEL_CONTEXT_WINDOW/);
    expect(() => loadConfig({
      ...base,
      TRISHULA_PERSONALITY_VERSION: "unreviewed-v2",
    })).toThrow(/TRISHULA_PERSONALITY_VERSION/);
    expect(() => loadConfig({
      ...base,
      TRISHULA_RESEARCH_PACKET_MAX_BYTES: "20000",
    })).toThrow(/TRISHULA_RESEARCH_PACKET_MAX_BYTES/);
  });

  it("requires HTTPS for the production Convex endpoint", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/HTTPS/);
  });

  it("requires a bound actor in production", () => {
    expect(() => loadConfig({
      ...base,
      NODE_ENV: "production",
      CONVEX_SITE_URL: "https://convex.example.com/http",
    })).toThrow(/BOUND_ACTOR_ID/);
  });

  it("requires the exact Convex HTTP actions prefix", () => {
    expect(() => loadConfig({ ...base, CONVEX_SITE_URL: "http://convex.internal" })).toThrow(/\/http/);
  });

  it("requires the dedicated Robinhood callback path", () => {
    expect(() => loadConfig({
      ...base,
      ROBINHOOD_OAUTH_REDIRECT_URI: "http://convex.internal/http/oauth/robinhood/callback",
    })).toThrow(/\/http\/broker\/robinhood\/callback/);
  });

  it("requires an HTTPS Robinhood callback in production", () => {
    expect(() => loadConfig({
      ...base,
      NODE_ENV: "production",
      CONVEX_SITE_URL: "https://convex.example.com/http",
      BOUND_ACTOR_ID: "actor_1",
      ROBINHOOD_OAUTH_REDIRECT_URI: "http://convex.example.com/http/broker/robinhood/callback",
    })).toThrow(/ROBINHOOD_OAUTH_REDIRECT_URI must use HTTPS/);
  });

  it("accepts the dedicated HTTPS callback in production", () => {
    const config = loadConfig({
      ...base,
      NODE_ENV: "production",
      CONVEX_SITE_URL: "https://convex.example.com/http",
      BOUND_ACTOR_ID: "actor_1",
      ROBINHOOD_OAUTH_REDIRECT_URI: "https://convex.example.com/http/broker/robinhood/callback",
    });
    expect(config.robinhoodOAuthRedirectUri).toBe("https://convex.example.com/http/broker/robinhood/callback");
  });

  it("requires an independent credential key in Robinhood mode", () => {
    expect(() => loadConfig({ ...base, BROKER_MODE: "robinhood" })).toThrow(/PI_CREDENTIAL_ENCRYPTION_KEY/);
  });

  it("does not fall back to the service secret for broker encryption", () => {
    const config = loadConfig(base);
    expect(config.piCredentialEncryptionKey).toBeUndefined();
  });

  it("requires a dedicated Discord agent secret", () => {
    expect(() => loadConfig({
      ...base,
      PI_DISCORD_SHARED_SECRET: base.SERVICE_SHARED_SECRET,
    })).toThrow(/must be independent/);
  });

  it("rejects batching windows above 100 milliseconds", () => {
    expect(() => loadConfig({ ...base, RESULT_BATCH_WINDOW_MS: "101" })).toThrow(/configuration/);
  });
});
