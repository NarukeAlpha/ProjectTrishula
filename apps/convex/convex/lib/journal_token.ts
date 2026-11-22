import { z } from "zod";
import { journalStableIdSchema } from "./journal.js";
import { constantTimeEqual } from "./service_auth.js";

export const DEFAULT_JOURNAL_RUN_TOKEN_TTL_MS = 15 * 60 * 1_000;
const TOKEN_DOMAIN_PREFIX = "trishula-journal-run-token-v1:";

const tokenPayloadSchema = z.object({
  runId: journalStableIdSchema,
  ownerId: z.string().trim().min(1).max(256),
  exp: z.number().int().positive(),
}).strict();

export type JournalRunTokenPayload = z.infer<typeof tokenPayloadSchema>;

function requiredSigningSecret(): string {
  const secret = process.env.SERVICE_SHARED_SECRET?.trim();
  if (!secret) {
    throw new Error("SERVICE_SHARED_SECRET is not configured.");
  }
  return secret;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis
    .btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    "=",
  );
  let binary: string;
  try {
    binary = globalThis.atob(padded);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function hmacSha256Base64Url(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(`${TOKEN_DOMAIN_PREFIX}${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return encodeBase64Url(new Uint8Array(signature));
}

export async function mintJournalRunToken(input: {
  runId: string;
  ownerId: string;
  ttlMs?: number;
  nowMs?: number;
}): Promise<string> {
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = input.ttlMs ?? DEFAULT_JOURNAL_RUN_TOKEN_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 60 * 60 * 1_000) {
    throw new Error("Journal run token TTL is invalid.");
  }
  const payload = tokenPayloadSchema.parse({
    runId: input.runId,
    ownerId: input.ownerId,
    exp: nowMs + ttlMs,
  });
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacSha256Base64Url(requiredSigningSecret(), encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export type JournalRunTokenErrorCode = "invalid" | "expired" | "owner_mismatch" | "run_mismatch";

export type VerifyJournalRunTokenResult =
  | { ok: true; payload: JournalRunTokenPayload }
  | { ok: false; code: JournalRunTokenErrorCode; error: string };

export async function verifyJournalRunToken(
  token: string,
  expected: { ownerId: string; runId?: string },
  nowMs = Date.now(),
): Promise<VerifyJournalRunTokenResult> {
  const trimmed = token.trim();
  const parts = trimmed.split(".");
  if (parts.length !== 2) {
    return { ok: false, code: "invalid", error: "Invalid run token format." };
  }
  const [encodedPayload, suppliedSignature] = parts;
  if (!encodedPayload || !suppliedSignature) {
    return { ok: false, code: "invalid", error: "Invalid run token format." };
  }

  let secret: string;
  try {
    secret = requiredSigningSecret();
  } catch {
    return { ok: false, code: "invalid", error: "Service secret is not configured." };
  }

  const expectedSignature = await hmacSha256Base64Url(secret, encodedPayload);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) {
    return { ok: false, code: "invalid", error: "Invalid run token signature." };
  }

  const payloadBytes = decodeBase64Url(encodedPayload);
  if (payloadBytes === null) {
    return { ok: false, code: "invalid", error: "Invalid run token encoding." };
  }

  let decodedJson: z.infer<ReturnType<typeof z.json>>;
  try {
    const decodedText = new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes);
    decodedJson = z.json().parse(JSON.parse(decodedText));
  } catch {
    return { ok: false, code: "invalid", error: "Invalid run token payload." };
  }

  const parsed = tokenPayloadSchema.safeParse(decodedJson);
  if (!parsed.success) {
    return { ok: false, code: "invalid", error: "Invalid run token claims." };
  }
  if (nowMs > parsed.data.exp) {
    return { ok: false, code: "expired", error: "Run token has expired." };
  }
  if (parsed.data.ownerId !== expected.ownerId) {
    return { ok: false, code: "owner_mismatch", error: "Run token owner does not match request." };
  }
  if (expected.runId !== undefined && parsed.data.runId !== expected.runId) {
    return { ok: false, code: "run_mismatch", error: "Run token runId does not match request." };
  }
  return { ok: true, payload: parsed.data };
}
