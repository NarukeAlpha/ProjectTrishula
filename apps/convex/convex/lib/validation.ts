export const MAX_COMMAND_ID_LENGTH = 96;
export const MAX_THREAD_ID_LENGTH = 112;
export const MAX_TEXT_LENGTH = 20_000;
export const MAX_TITLE_LENGTH = 200;

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function requireStableId(value: string, field: string, maximum = MAX_COMMAND_ID_LENGTH): void {
  if (value.length === 0 || value.length > maximum || !STABLE_ID_PATTERN.test(value)) {
    throw new Error(`${field} must be an ASCII stable identifier of at most ${maximum} characters.`);
  }
}

export function requireText(value: string, field: string, maximum = MAX_TEXT_LENGTH): string {
  const normalized = value.trim();
  if (normalized.length === 0 || value.length > maximum) {
    throw new Error(`${field} must be non-empty and at most ${maximum} characters.`);
  }
  return value;
}

export function requireTitle(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_TITLE_LENGTH) {
    throw new Error(`title must be non-empty and at most ${MAX_TITLE_LENGTH} characters.`);
  }
  return normalized;
}

export function previewFor(text: string, maximum = 240): string {
  return text.replaceAll(/\s+/g, " ").trim().slice(0, maximum);
}

/** A deterministic equality token for same-actor command-id retries. */
export function commandFingerprint(value: Record<string, string | undefined>): string {
  return JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

export function requireSameCommand(
  existing: { type: string; requestFingerprint: string },
  type: string,
  fingerprint: string,
): void {
  if (existing.type !== type || existing.requestFingerprint !== fingerprint) {
    throw new Error("commandId was already used with a different command, target, or payload.");
  }
}
