export const DISCORD_FINAL_REPLY_MAX_CHARACTERS = 2_000;
export const DISCORD_ACKNOWLEDGEMENT_MAX_CHARACTERS = 320;

export function discordContentLength(value: string): number {
  return Array.from(value).length;
}

export function normalizeDiscordContent(value: string): string {
  return value.trim();
}

export function validDiscordContent(value: string, maximum: number): boolean {
  const normalized = normalizeDiscordContent(value);
  return normalized.length > 0 && discordContentLength(normalized) <= maximum;
}

export function requireDiscordContent(value: string, maximum: number): string {
  if (!validDiscordContent(value, maximum)) {
    throw new Error(`Discord content must contain at most ${maximum} Unicode characters.`);
  }
  return normalizeDiscordContent(value);
}
