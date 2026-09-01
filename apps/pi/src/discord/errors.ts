export const DISCORD_AGENT_OUTPUT_ERROR_CODES = [
  "invalid_json",
  "invalid_response_schema",
  "discord_content_too_long",
  "unverified_source_url",
] as const;

export type DiscordAgentOutputErrorCode = typeof DISCORD_AGENT_OUTPUT_ERROR_CODES[number];

const safeMessages = {
  invalid_json: "The Discord agent returned invalid JSON.",
  invalid_response_schema: "The Discord agent response did not match the required shape.",
  discord_content_too_long: "The Discord agent response exceeded a Discord content boundary.",
  unverified_source_url: "The Discord agent cited a source that was not verified.",
} satisfies Readonly<Record<DiscordAgentOutputErrorCode, string>>;

export class DiscordAgentOutputError extends Error {
  readonly retryable = false;

  constructor(readonly code: DiscordAgentOutputErrorCode) {
    super(safeMessages[code]);
    this.name = "DiscordAgentOutputError";
  }
}
