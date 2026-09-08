/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- This boundary reads untrusted mutation errors and returns only allowlisted messages. */
import { ConvexError } from "convex/values";

type NewspaperAction = "save" | "schedule" | "test" | "test_save";

const actionLabels = {
  save: "Could not save the settings.",
  schedule: "Could not schedule the newspaper.",
  test: "Could not confirm the test was queued.",
  test_save: "Could not save the settings for the test. No test was queued.",
} satisfies Record<NewspaperAction, string>;

const knownReasons = new Map([
  ["forum_not_configured", "Select an available forum in this server."],
  ["forum_wrong_channel_type", "Select a Discord forum, not a text channel."],
  [
    "forum_permissions_incomplete",
    "Check the bot's forum posting and history permissions, and select a valid tag if required.",
  ],
  [
    "market_research_disabled",
    "Research is unavailable for this account. Check the research owner and worker configuration.",
  ],
  [
    "market_research_owner_mismatch",
    "Sign in with the configured research owner account.",
  ],
  [
    "Market-research owner mismatch.",
    "Sign in with the configured research owner account.",
  ],
  ["authentication_required", "Sign in again, then retry."],
  ["Authentication required.", "Sign in again, then retry."],
  ["schedule_timezone_invalid", "Choose a valid schedule timezone."],
  [
    "schedule_timezone_unconfirmed",
    "Choose and confirm the schedule timezone.",
  ],
  ["schedule_time_invalid", "Choose a valid local publish time."],
  [
    "The market-research timezone is invalid.",
    "Choose and confirm a valid schedule timezone.",
  ],
  [
    "The market-research schedule is invalid.",
    "Check the local publish time and confirm the schedule timezone.",
  ],
  [
    "edition_already_exists",
    "An edition already exists. Check the latest edition before starting another test.",
  ],
]);

function knownReason(error: unknown): string | undefined {
  const value: unknown =
    error instanceof ConvexError
      ? error.data
      : error instanceof Error
        ? error.message
        : undefined;
  const text =
    typeof value === "string"
      ? value
      : value !== null &&
          typeof value === "object" &&
          "code" in value &&
          typeof value.code === "string"
        ? value.code
        : undefined;
  if (text === undefined) return undefined;
  for (const line of text.split(/\r?\n/)) {
    const reason = knownReasons.get(
      line.trim().replace(/^(?:Uncaught )?(?:Error|ConvexError): /, ""),
    );
    if (reason !== undefined) return reason;
  }
  return undefined;
}

export function newspaperActionError(
  action: NewspaperAction,
  error: unknown,
): string {
  const fallback =
    action === "test"
      ? "Check the latest edition, then retry."
      : "Please try again.";
  return `${actionLabels[action]} ${knownReason(error) ?? fallback}`;
}
