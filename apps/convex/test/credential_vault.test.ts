import { describe, expect, it } from "vitest";
import {
  credentialVaultAuditDetails,
  requireCredentialVaultRevision,
  requireOpaqueCredentialEnvelope,
  type OpaqueCredentialEnvelope,
} from "../convex/lib/credential_vault.js";

const ownerId = "user_01HWORKOSALLOWED";
const opaqueEnvelope: OpaqueCredentialEnvelope = {
  schemaVersion: 1,
  actorId: ownerId,
  provider: "robinhood",
  keyVersion: 3,
  algorithm: "A256GCM",
  iv: "iv-opaque",
  ciphertext: "opaque-ciphertext-not-a-token",
  authTag: "tag-opaque",
};

describe("opaque Robinhood credential vault contracts", () => {
  it("accepts an envelope bound to its owner", () => {
    expect(requireOpaqueCredentialEnvelope(opaqueEnvelope, ownerId)).toEqual(opaqueEnvelope);
  });

  it("rejects an envelope bound to a different actor", () => {
    expect(() => requireOpaqueCredentialEnvelope(opaqueEnvelope, "user_01HWORKOSSECOND"))
      .toThrow("envelope is invalid");
  });

  it("keeps revisions non-negative and safe", () => {
    expect(requireCredentialVaultRevision(0)).toBe(0);
    expect(() => requireCredentialVaultRevision(-1)).toThrow("non-negative");
    expect(() => requireCredentialVaultRevision(Number.MAX_SAFE_INTEGER + 1)).toThrow("safe");
  });

  it("records audit metadata without ciphertext", () => {
    const details = credentialVaultAuditDetails({
      operation: "put",
      revision: 4,
      found: true,
      keyVersion: opaqueEnvelope.keyVersion,
      algorithm: opaqueEnvelope.algorithm,
    });
    expect(details).toEqual(expect.arrayContaining([
      { key: "provider", value: "robinhood" },
      { key: "operation", value: "put" },
      { key: "revision", value: "4" },
      { key: "keyVersion", value: "3" },
      { key: "algorithm", value: "A256GCM" },
    ]));
    expect(JSON.stringify(details)).not.toContain(opaqueEnvelope.ciphertext);
  });
});
