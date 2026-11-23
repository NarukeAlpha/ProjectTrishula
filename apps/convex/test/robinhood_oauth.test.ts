import { describe, expect, it } from "vitest";
import {
  parseRobinhoodCallbackInput,
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

  it("parses pasted loopback and HTTPS Robinhood callback URLs safely", () => {
    expect(
      parseRobinhoodCallbackInput(
        "http://127.0.0.1:8787/callback?code=auth-code-123&state=state-xyz",
      ),
    ).toEqual({ code: "auth-code-123", state: "state-xyz" });

    expect(
      parseRobinhoodCallbackInput(
        "http://localhost:8787/callback?error=access_denied&error_description=User+denied&state=state-xyz",
      ),
    ).toEqual({
      state: "state-xyz",
      error: "access_denied",
      errorDescription: "User denied",
    });

    expect(
      parseRobinhoodCallbackInput(
        "https://convex.example.com/http/broker/robinhood/callback?code=c1&state=s1",
      ),
    ).toEqual({ code: "c1", state: "s1" });

    expect(() => parseRobinhoodCallbackInput("http://evil.example.com/callback?code=c&state=s"))
      .toThrow("HTTPS or a localhost loopback");
    expect(() => parseRobinhoodCallbackInput("javascript:alert(1)"))
      .toThrow("HTTPS or a localhost loopback");
    expect(() => parseRobinhoodCallbackInput("not-a-url"))
      .toThrow("full redirect URL");
  });
});
