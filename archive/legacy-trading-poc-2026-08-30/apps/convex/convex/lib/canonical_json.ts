import { z } from "zod";

/**
 * Matches the execution service's result-payload canonicalization. It sorts
 * every object level and omits undefined values before UTF-8 encoding.
 */
const jsonValueSchema = z.json();
type JsonValue = z.infer<typeof jsonValueSchema>;
type JsonObject = Record<string, JsonValue>;

function normalize(value: JsonValue): JsonValue {
  if (value === null || !(value instanceof Object)) return value;
  if (Array.isArray(value)) return value.map(normalize);
  const normalized: JsonObject = {};
  for (const [key, entry] of Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    normalized[key] = normalize(entry);
  }
  return normalized;
}

export function canonicalJson<TValue>(value: TValue): string {
  return JSON.stringify(normalize(jsonValueSchema.parse(value)));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
