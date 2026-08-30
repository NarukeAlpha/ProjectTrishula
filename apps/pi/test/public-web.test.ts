import { describe, expect, it } from "vitest";
import { assertPublicHttpsUrl, isPublicIp } from "../src/discord/public-web.js";

describe("public research URL safety", () => {
  it.each([
    "http://example.com",
    "https://localhost/data",
    "https://service.internal/data",
    "https://user:password@example.com/data",
    "https://example.com:8443/data",
    "https://127.0.0.1/data",
    "https://10.0.0.1/data",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/data",
    "https://[fc00::1]/data",
  ])("rejects %s", (url) => {
    expect(() => assertPublicHttpsUrl(url)).toThrow();
  });

  it("accepts a normal public HTTPS URL", () => {
    expect(assertPublicHttpsUrl("https://www.sec.gov/Archives/test.txt").hostname).toBe("www.sec.gov");
  });

  it("classifies public and special-use addresses", () => {
    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("192.168.1.10")).toBe(false);
    expect(isPublicIp("2001:4860:4860::8888")).toBe(true);
    expect(isPublicIp("2001:db8::1")).toBe(false);
    expect(isPublicIp("::ffff:127.0.0.1")).toBe(false);
  });
});
