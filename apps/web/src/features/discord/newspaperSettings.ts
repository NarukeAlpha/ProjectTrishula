import type {
  MarketResearchPreferencesReadModel,
  SaveMarketResearchControlSettings,
} from "../../convex/types";

type NewspaperSettings =
  | SaveMarketResearchControlSettings
  | MarketResearchPreferencesReadModel;

// Compare the published configuration, not revision or service-owned access.
export function newspaperSettingsKey(settings: NewspaperSettings): string {
  return JSON.stringify([
    settings.guildId,
    settings.forumChannelId,
    [...settings.forumTagIds].sort(),
    settings.timezone,
    settings.timezoneConfirmed,
    settings.localHour,
    settings.localMinute,
    settings.includeWeekends,
    settings.editionDepth,
    settings.maximumRankedSetups,
    settings.includeCharts,
    settings.maximumCharts,
  ]);
}

function pendingTestKey(guildId: string): string {
  return `trishula:newspaper-test:${guildId}`;
}

export function newspaperTestRequestId(settings: NewspaperSettings): string {
  const storageKey = pendingTestKey(settings.guildId);
  const settingsKey = newspaperSettingsKey(settings);
  const previous = sessionStorage.getItem(storageKey);
  const separator = previous?.lastIndexOf("\n") ?? -1;
  const previousId = previous?.slice(separator + 1);
  if (
    previous?.slice(0, separator) === settingsKey &&
    previousId &&
    /^[0-9a-f-]{36}$/.test(previousId)
  ) {
    return previousId;
  }
  const requestId = crypto.randomUUID();
  // Persist before sending. Storage failure stops the request rather than
  // allowing an untracked retry. The backend scopes IDs to the signed-in owner.
  sessionStorage.setItem(storageKey, `${settingsKey}\n${requestId}`);
  return requestId;
}

export function acknowledgeNewspaperTest(guildId: string, requestId: string) {
  const key = pendingTestKey(guildId);
  if (sessionStorage.getItem(key)?.endsWith(`\n${requestId}`)) {
    sessionStorage.removeItem(key);
  }
}
