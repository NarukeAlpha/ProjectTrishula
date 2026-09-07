import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaveMarketResearchControlSettings } from "../../convex/types";
import {
  acknowledgeNewspaperTest,
  newspaperSettingsKey,
  newspaperTestRequestId,
} from "./newspaperSettings";

const settings: SaveMarketResearchControlSettings = {
  guildId: "guild_1",
  forumChannelId: "forum_1",
  forumTagIds: [],
  timezone: "America/Puerto_Rico",
  timezoneConfirmed: true,
  localHour: 8,
  localMinute: 0,
  includeWeekends: true,
  editionDepth: "full",
  maximumRankedSetups: 10,
  enabled: false,
  includeCharts: true,
  maximumCharts: 3,
};

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("newspaper request identity", () => {
  it("compares settings independently of schedule activation", () => {
    expect(newspaperSettingsKey(settings)).toBe(
      newspaperSettingsKey({ ...settings, enabled: true }),
    );
  });

  it("keeps an uncertain ID across callers until the matching acknowledgement", () => {
    const first = newspaperTestRequestId(settings);
    acknowledgeNewspaperTest(settings.guildId, "different-id");
    expect(newspaperTestRequestId(settings)).toBe(first);
    acknowledgeNewspaperTest(settings.guildId, first);
    expect(newspaperTestRequestId(settings)).not.toBe(first);
  });

  it("separates servers and intentionally changed test settings", () => {
    const first = newspaperTestRequestId(settings);
    expect(
      newspaperTestRequestId({ ...settings, guildId: "guild_2" }),
    ).not.toBe(first);
    expect(newspaperTestRequestId({ ...settings, localHour: 9 })).not.toBe(
      first,
    );
  });

  it("fails before dispatch if retry identity cannot be persisted", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(() => newspaperTestRequestId(settings)).toThrow(
      "storage unavailable",
    );
  });
});
