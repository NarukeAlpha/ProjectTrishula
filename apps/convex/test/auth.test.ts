import { afterEach, describe, expect, it } from "vitest";
import type { UserIdentity } from "convex/server";
import { actorFromIdentity, requireAllowedWorkosUserId } from "../convex/lib/auth.js";

const allowedUserId = "user_01HWORKOSALLOWED";
const originalAllowedUserIds = process.env.WORKOS_ALLOWED_USER_IDS;
const originalClientId = process.env.WORKOS_CLIENT_ID;

function identity(subject = allowedUserId): UserIdentity {
  return {
    subject,
    issuer: "https://api.workos.com/",
    tokenIdentifier: `${subject}|https://api.workos.com/`,
    name: "Railway Test User",
    email: "railway-test@example.com",
  };
}

afterEach(() => {
  if (originalAllowedUserIds === undefined) delete process.env.WORKOS_ALLOWED_USER_IDS;
  else process.env.WORKOS_ALLOWED_USER_IDS = originalAllowedUserIds;
  if (originalClientId === undefined) delete process.env.WORKOS_CLIENT_ID;
  else process.env.WORKOS_CLIENT_ID = originalClientId;
});

describe("WorkOS public-function authorization", () => {
  it("derives the actor from the allowed WorkOS subject", () => {
    process.env.WORKOS_ALLOWED_USER_IDS = `${allowedUserId},user_01HWORKOSSECOND`;
    expect(actorFromIdentity(identity())).toMatchObject({
      id: allowedUserId,
      workosUserId: allowedUserId,
      displayName: "Railway Test User",
    });
  });

  it("keeps ownership isolated for each allowed WorkOS subject", () => {
    process.env.WORKOS_ALLOWED_USER_IDS = `${allowedUserId},user_01HWORKOSSECOND`;
    expect(actorFromIdentity(identity("user_01HWORKOSSECOND"))).toMatchObject({
      id: "user_01HWORKOSSECOND",
      workosUserId: "user_01HWORKOSSECOND",
    });
  });

  it("rejects a missing allowlist before public access", () => {
    delete process.env.WORKOS_ALLOWED_USER_IDS;
    expect(() => actorFromIdentity(identity())).toThrow("WORKOS_ALLOWED_USER_IDS is required");
  });

  it("rejects a valid WorkOS token for another user", () => {
    process.env.WORKOS_ALLOWED_USER_IDS = allowedUserId;
    expect(() => actorFromIdentity(identity("user_01NOTALLOWED"))).toThrow("not allowed");
  });

  it("applies the WorkOS allowlist to service-supplied actor IDs", () => {
    process.env.WORKOS_ALLOWED_USER_IDS = `${allowedUserId},user_01HWORKOSSECOND`;
    expect(requireAllowedWorkosUserId(allowedUserId)).toBe(allowedUserId);
    expect(() => requireAllowedWorkosUserId("user_01NOTALLOWED")).toThrow("not allowed");
  });

  it("uses the official WorkOS custom-JWT issuers, JWKS, and audience", async () => {
    process.env.WORKOS_CLIENT_ID = "client_01HWORKOSCLIENT";
    const { default: config } = await import("../convex/auth.config.js");
    expect(config.providers).toEqual([
      {
        type: "customJwt",
        issuer: "https://api.workos.com/",
        algorithm: "RS256",
        jwks: "https://api.workos.com/sso/jwks/client_01HWORKOSCLIENT",
        applicationID: "client_01HWORKOSCLIENT",
      },
      {
        type: "customJwt",
        issuer: "https://api.workos.com/user_management/client_01HWORKOSCLIENT",
        algorithm: "RS256",
        jwks: "https://api.workos.com/sso/jwks/client_01HWORKOSCLIENT",
      },
    ]);
  });
});
