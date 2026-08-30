import { describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "./runtime";

const valid = {
  environment: "staging",
  applicationName: "Project Trishula",
  applicationVersion: "test",
  demoMode: false,
  convexUrl: "https://convex.example.com",
  workosClientId: "client_01ABCDEF",
  workosRedirectUri: "https://signal.example.com/callback",
};

describe("parseRuntimeConfig", () => {
  it("accepts the public deployment settings", () => {
    expect(parseRuntimeConfig(valid)).toMatchObject({
      environment: "staging",
      demoMode: false,
      convexUrl: "https://convex.example.com",
    });
  });

  it("accepts demo mode without WorkOS or Convex settings", () => {
    expect(
      parseRuntimeConfig({
        environment: "development",
        applicationName: "Project Trishula",
        applicationVersion: "demo",
        demoMode: true,
      }),
    ).toEqual({
      environment: "development",
      applicationName: "Project Trishula",
      applicationVersion: "demo",
      demoMode: true,
    });
  });

  it("does not accept a string as demo mode", () => {
    expect(() => parseRuntimeConfig({ ...valid, demoMode: "true" })).toThrow(
      "boolean",
    );
  });

  it("rejects non-TLS remote endpoints", () => {
    expect(() =>
      parseRuntimeConfig({ ...valid, convexUrl: "http://convex.example.com" }),
    ).toThrow("HTTPS");
  });

  it("rejects a malformed WorkOS API hostname", () => {
    expect(() =>
      parseRuntimeConfig({
        ...valid,
        workosApiHostname: "https://api.workos.com/path",
      }),
    ).toThrow("hostname");
  });
});
