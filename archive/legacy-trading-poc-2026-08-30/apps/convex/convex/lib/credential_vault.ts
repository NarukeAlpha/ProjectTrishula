export const CREDENTIAL_VAULT_PROVIDER = "robinhood" as const;
export const MAX_CREDENTIAL_VAULT_CIPHERTEXT_LENGTH = 4 * 1024 * 1024;
export const MAX_CREDENTIAL_VAULT_FIELD_LENGTH = 16 * 1024;

export type CredentialVaultOperation = "get" | "put" | "delete";

export interface OpaqueCredentialEnvelope {
  schemaVersion: 1;
  actorId: string;
  provider: typeof CREDENTIAL_VAULT_PROVIDER;
  keyVersion: number;
  algorithm: "A256GCM";
  iv: string;
  ciphertext: string;
  authTag: string;
}

export function requireCredentialVaultOwnerId(value: string): string {
  if (!/^[A-Za-z0-9:_-]{1,256}$/.test(value)) {
    throw new Error("Credential vault owner ID is invalid.");
  }
  return value;
}

export function requireCredentialVaultRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Credential vault revision must be a non-negative safe integer.");
  }
  return value;
}

export function requireCredentialVaultCiphertext(value: string): string {
  if (
    value.length === 0 ||
    value.length > MAX_CREDENTIAL_VAULT_CIPHERTEXT_LENGTH ||
    value.trim() !== value
  ) {
    throw new Error("Credential vault ciphertext is invalid.");
  }
  return value;
}

export function requireCredentialVaultField(value: string, field: string): string {
  if (
    value.length === 0 ||
    value.length > MAX_CREDENTIAL_VAULT_FIELD_LENGTH ||
    value.trim() !== value
  ) {
    throw new Error(`Credential vault ${field} is invalid.`);
  }
  return value;
}

export function requireOpaqueCredentialEnvelope(
  value: OpaqueCredentialEnvelope,
  ownerId: string,
): OpaqueCredentialEnvelope {
  requireCredentialVaultOwnerId(ownerId);
  if (
    value.schemaVersion !== 1 ||
    value.actorId !== ownerId ||
    value.provider !== CREDENTIAL_VAULT_PROVIDER ||
    !Number.isSafeInteger(value.keyVersion) ||
    value.keyVersion < 1 ||
    value.algorithm !== "A256GCM"
  ) {
    throw new Error("Credential vault envelope is invalid.");
  }
  requireCredentialVaultField(value.iv, "IV");
  requireCredentialVaultCiphertext(value.ciphertext);
  requireCredentialVaultField(value.authTag, "authentication tag");
  return value;
}

export interface CredentialVaultAuditInput {
  operation: CredentialVaultOperation;
  revision: number;
  found: boolean;
  keyVersion?: number;
  algorithm?: OpaqueCredentialEnvelope["algorithm"];
}

export function credentialVaultAuditDetails(
  input: CredentialVaultAuditInput,
): Array<{ key: string; value: string }> {
  const details = [
    { key: "provider", value: CREDENTIAL_VAULT_PROVIDER },
    { key: "operation", value: input.operation },
    { key: "revision", value: String(input.revision) },
    { key: "found", value: String(input.found) },
  ];
  if (input.keyVersion !== undefined) details.push({ key: "keyVersion", value: String(input.keyVersion) });
  if (input.algorithm !== undefined) details.push({ key: "algorithm", value: input.algorithm });
  return details;
}
