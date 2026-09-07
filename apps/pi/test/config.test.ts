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
    expect(config.marketResearchEnabled).toBe(false);
    expect(config.exaApiKey).toBeUndefined();
    expect(config.exaSearchConcurrency).toBe(2);
    expect(config.exaContentsConcurrency).toBe(5);
    expect(config.exaMaxSearchRequestsPerEdition).toBe(12);
    expect(config.exaMaxContentPagesPerEdition).toBe(24);
    expect(config.marketDataProviderId).toBe("disabled");
    expect(config.financialDatasetsOwnerDecision).toBe("pending");
    expect(config.financialDatasetsMaxCostUsdPerRequest).toBeUndefined();
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

  it("starts without an Exa key while market research is disabled", () => {
    expect(loadConfig(base).marketResearchEnabled).toBe(false);
  });

  it("requires an Exa key only when market research is enabled", () => {
    expect(() => loadConfig({ ...base, MARKET_RESEARCH_ENABLED: "true" })).toThrow(/EXA_API_KEY/);
    const config = loadConfig({
      ...base,
      MARKET_RESEARCH_ENABLED: "true",
      EXA_API_KEY: "test-exa-key-not-a-production-secret",
    });
    expect(config.marketResearchEnabled).toBe(true);
    expect(config.exaApiKey).toBe("test-exa-key-not-a-production-secret");
  });

  it("requires explicit approval and a cost cap for Financial Datasets", () => {
    expect(() => loadConfig({
      ...base,
      MARKET_DATA_PROVIDER_ID: "exa_financial_datasets",
    })).toThrow(/approved owner decision/);
    const config = loadConfig({
      ...base,
      MARKET_DATA_PROVIDER_ID: "exa_financial_datasets",
      EXA_FINANCIAL_DATASETS_OWNER_DECISION: "approved",
      EXA_FINANCIAL_DATASETS_MAX_COST_USD_PER_REQUEST: "0.25",
    });
    expect(config.marketDataProviderId).toBe("exa_financial_datasets");
    expect(config.financialDatasetsOwnerDecision).toBe("approved");
    expect(config.financialDatasetsMaxCostUsdPerRequest).toBe(0.25);
  });
});
