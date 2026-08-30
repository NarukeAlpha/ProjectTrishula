import { describe, expect, it } from "vitest";
import {
  requireRobinhoodAuthorizationUrl,
  requireRobinhoodOAuthCode,
  requireRobinhoodOAuthState,
  requireWebAppOrigin,
} from "../convex/lib/robinhood_oauth.js";

describe("Robinhood OAuth boundary validation", () => {
  it("accepts the exact HTTPS Robinhood authorization host", () => {
    expect(requireRobinhoodAuthorizationUrl(
      "https://robinhood.com/oauth?state=opaque-state",
    )).toBe("https://robinhood.com/oauth?state=opaque-state");
  });

  it("rejects non-HTTPS, subdomain, lookalike, and port-bearing hosts", () => {
    expect(() => requireRobinhoodAuthorizationUrl("http://robinhood.com/oauth"))
      .toThrow("HTTPS Robinhood");
    expect(() => requireRobinhoodAuthorizationUrl("https://oauth.robinhood.com/authorize"))
      .toThrow("HTTPS Robinhood");
    expect(() => requireRobinhoodAuthorizationUrl("https://robinhood.com.attacker.example/authorize"))
      .toThrow("HTTPS Robinhood");
    expect(() => requireRobinhoodAuthorizationUrl("https://robinhood.com:8443/oauth"))
      .toThrow("HTTPS Robinhood");
  });

  it("requires bounded OAuth code and state values", () => {
    expect(requireRobinhoodOAuthCode(" code ")).toBe("code");
    expect(requireRobinhoodOAuthState(" state ")).toBe("state");
    expect(() => requireRobinhoodOAuthCode(" ")).toThrow("code is invalid");
    expect(() => requireRobinhoodOAuthState(" ")).toThrow("state is invalid");
  });

  it("requires an HTTPS origin without a path or query", () => {
    expect(requireWebAppOrigin("https://signal.example.com/")).toBe("https://signal.example.com");
    expect(() => requireWebAppOrigin("http://signal.example.com/")).toThrow("HTTPS origin");
    expect(() => requireWebAppOrigin("https://signal.example.com/app")).toThrow("HTTPS origin");
    expect(() => requireWebAppOrigin("https://signal.example.com/?state=bad")).toThrow("HTTPS origin");
  });
});
