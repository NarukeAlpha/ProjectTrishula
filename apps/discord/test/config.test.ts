import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const baseEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  DISCORD_OWNER_ID: "user_01KY429HHW8J5S3A9GEBGTM6ZE",
  CONVEX_DISCORD_SHARED_SECRET:
    "convex-secret-with-at-least-thirty-two-characters",
  PI_DISCORD_SHARED_SECRET:
    "pi-secret-with-at-least-thirty-two-characters-long",
  CONVEX_SITE_URL: "https://convex.example.com/http",
  PI_SERVICE_URL: "http://pi.railway.internal:8080",
};

describe("loadConfig", () => {
  it("loads private Pi and Convex service URLs", () => {
    const config = loadConfig(baseEnvironment);
    expect(config.convexSiteUrl).toBe("https://convex.example.com/http");
    expect(config.piServiceUrl).toBe("http://pi.railway.internal:8080");
    expect(config.discordBotToken).toBeUndefined();
    expect(config.convexSharedSecret).toBe(
      baseEnvironment.CONVEX_DISCORD_SHARED_SECRET,
    );
    expect(config.piSharedSecret).toBe(
      baseEnvironment.PI_DISCORD_SHARED_SECRET,
    );
  });

  it("requires the Convex HTTP action prefix", () => {
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        CONVEX_SITE_URL: "https://convex.example.com",
      }),
    ).toThrow("/http actions prefix");
  });

  it("requires independent Convex and Pi credentials", () => {
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        CONVEX_DISCORD_SHARED_SECRET: undefined,
      }),
    ).toThrow("CONVEX_DISCORD_SHARED_SECRET");
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        PI_DISCORD_SHARED_SECRET: undefined,
      }),
    ).toThrow("PI_DISCORD_SHARED_SECRET");
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        PI_DISCORD_SHARED_SECRET: baseEnvironment.CONVEX_DISCORD_SHARED_SECRET,
      }),
    ).toThrow("PI_DISCORD_SHARED_SECRET");
  });
});
