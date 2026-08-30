import { afterEach, describe, expect, it } from "vitest";
import {
  authorizedDiscordGatewayRequest,
  authorizedServiceRequest,
} from "../convex/lib/service_auth.js";

const originalServiceSecret = process.env.SERVICE_SHARED_SECRET;
const originalDiscordSecret = process.env.DISCORD_GATEWAY_SHARED_SECRET;

function bearerRequest(secret: string): Request {
  return new Request("https://convex.example.test/discord", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

afterEach(() => {
  if (originalServiceSecret === undefined) delete process.env.SERVICE_SHARED_SECRET;
  else process.env.SERVICE_SHARED_SECRET = originalServiceSecret;
  if (originalDiscordSecret === undefined) delete process.env.DISCORD_GATEWAY_SHARED_SECRET;
  else process.env.DISCORD_GATEWAY_SHARED_SECRET = originalDiscordSecret;
});

describe("private service authorization", () => {
  it("does not let the generic service secret authorize the Discord gateway", () => {
    process.env.SERVICE_SHARED_SECRET = "generic-service-secret";
    process.env.DISCORD_GATEWAY_SHARED_SECRET = "discord-gateway-secret";

    expect(authorizedServiceRequest(bearerRequest("generic-service-secret"))).toBe(true);
    expect(authorizedDiscordGatewayRequest(bearerRequest("generic-service-secret"))).toBe(false);
    expect(authorizedDiscordGatewayRequest(bearerRequest("discord-gateway-secret"))).toBe(true);
  });

  it("fails closed when the dedicated Discord gateway secret is missing", () => {
    process.env.SERVICE_SHARED_SECRET = "generic-service-secret";
    delete process.env.DISCORD_GATEWAY_SHARED_SECRET;

    expect(authorizedDiscordGatewayRequest(bearerRequest("generic-service-secret"))).toBe(false);
  });
});
