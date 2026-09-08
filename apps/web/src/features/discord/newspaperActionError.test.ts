import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { newspaperActionError } from "./newspaperActionError";

describe("newspaper action errors", () => {
  it("decodes safe Convex error codes without exposing additional data", () => {
    expect(
      newspaperActionError(
        "schedule",
        new ConvexError({
          code: "schedule_time_invalid",
          detail: "private-value",
        }),
      ),
    ).toBe(
      "Could not schedule the newspaper. Choose a valid local publish time.",
    );
    expect(
      newspaperActionError("test", new ConvexError("forum_not_configured")),
    ).toBe(
      "Could not confirm the test was queued. Select an available forum in this server.",
    );
  });

  it("recognizes existing wrapped backend errors but never returns their stack", () => {
    const error = new Error(
      "[CONVEX M(market_research:saveControlSettings)] Server Error\nUncaught Error: forum_permissions_incomplete\n    at private_handler_location",
    );
    const message = newspaperActionError("save", error);
    expect(message).toContain(
      "Could not save the settings. Check the bot's forum posting",
    );
    expect(message).not.toContain("CONVEX");
    expect(message).not.toContain("private_handler_location");
  });

  it("maps known authentication and timezone failures to user actions", () => {
    expect(
      newspaperActionError("save", new Error("Authentication required.")),
    ).toBe("Could not save the settings. Sign in again, then retry.");
    expect(
      newspaperActionError(
        "schedule",
        new Error("The market-research timezone is invalid."),
      ),
    ).toBe(
      "Could not schedule the newspaper. Choose and confirm a valid schedule timezone.",
    );
  });

  it.each([
    new Error("Unexpected private credentials or stack"),
    new ConvexError({
      code: "unknown_internal_error",
      detail: "private-value",
    }),
    new ConvexError({ code: ["forum_not_configured"] }),
    { message: "private-value" },
    "private-value",
    null,
  ])("uses an action-specific fallback for an unexpected error", (error) => {
    expect(newspaperActionError("save", error)).toBe(
      "Could not save the settings. Please try again.",
    );
    expect(newspaperActionError("schedule", error)).toBe(
      "Could not schedule the newspaper. Please try again.",
    );
    expect(newspaperActionError("test", error)).toBe(
      "Could not confirm the test was queued. Check the latest edition, then retry.",
    );
    expect(newspaperActionError("test_save", error)).toBe(
      "Could not save the settings for the test. No test was queued. Please try again.",
    );
  });
});
