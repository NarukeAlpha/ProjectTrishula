/* oxlint-disable anti-slop/no-conditional-empty-object-spread -- Exact optional Exa request fields must be omitted when a slot does not constrain them. */
import type { MarketResearchPreferencesV1 } from "./contracts.js";
import {
  REQUESTED_SOURCE_DOMAINS,
  type SourcePolicy,
} from "./source-policy.js";

export type ResearchPackKind =
  | "overnight_macro_cross_asset"
  | "us_index_sector"
  | "primary_board_news"
  | "discovery_movers"
  | "official_calendar"
  | "earnings_corporate_actions"
  | "requested_source";

export interface PublicationWindow {
  startPublishedDate: string;
  endPublishedDate: string;
}

export interface ResearchPlanSlot {
  slot: number;
  queryId: string;
  queryVersion: "v1";
  kind: ResearchPackKind;
  required: true;
  query: string;
  numResults: number;
  category: "news" | "financial report";
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate: string;
  endPublishedDate: string;
  policyResolution?: "unavailable" | "no_symbols";
  requestedSource?: keyof typeof REQUESTED_SOURCE_DOMAINS;
}

export interface ResearchPlan {
  slots: ResearchPlanSlot[];
  providerCallCount: number;
  requiredSlotCount: number;
}

export function newsPublicationWindow(
  now: Date,
  options: { isWeekend: boolean; isFirstSessionAfterHoliday: boolean; previousClose?: Date },
): PublicationWindow {
  let start: Date;
  if (options.previousClose !== undefined) {
    start = options.previousClose;
  } else {
    const day = now.getUTCDay();
    const hours = options.isWeekend || day === 1 || options.isFirstSessionAfterHoliday ? 96 : 36;
    start = new Date(now.getTime() - hours * 60 * 60 * 1_000);
  }
  return { startPublishedDate: start.toISOString(), endPublishedDate: now.toISOString() };
}

function symbolGroups(symbols: readonly string[]): [string[], string[]] {
  if (symbols.length <= 5) return [[...symbols], []];
  return [symbols.slice(0, 5), symbols.slice(5, 10)];
}

export function buildResearchPlan(
  preferences: MarketResearchPreferencesV1,
  policy: SourcePolicy,
  window: PublicationWindow,
): ResearchPlan {
  if (preferences.primarySymbols.length > 10 || preferences.searchRequestBudget < 12) {
    throw new Error("exa_invalid_request");
  }
  const [primaryA, primaryB] = symbolGroups(preferences.primarySymbols);
  const excludeDomains = [...preferences.excludedDomains];
  const slots: ResearchPlanSlot[] = [];
  const add = (slot: Omit<ResearchPlanSlot, "slot" | "queryVersion" | "required" | "startPublishedDate" | "endPublishedDate">) => {
    const record: ResearchPlanSlot = {
      ...slot,
      slot: slots.length + 1,
      queryVersion: "v1",
      required: true,
      startPublishedDate: window.startPublishedDate,
      endPublishedDate: window.endPublishedDate,
    };
    if (excludeDomains.length > 0 && record.excludeDomains === undefined) record.excludeDomains = excludeDomains;
    slots.push(record);
  };
  add({
    queryId: "overnight_macro_cross_asset",
    kind: "overnight_macro_cross_asset",
    query: "overnight global markets central banks inflation labor fiscal policy geopolitics Asia Europe Treasury yields US dollar crude oil natural gas gold supply events",
    numResults: 15,
    category: "news",
  });
  add({
    queryId: "us_index_sector",
    kind: "us_index_sector",
    query: `US premarket index breadth sector leadership SPY QQQ DIA IWM VIX SMH SOXX ${preferences.sectorSymbols.join(" ")}`,
    numResults: 12,
    category: "news",
  });
  for (const [index, group] of [primaryA, primaryB].entries()) {
    add({
      queryId: `primary_board_news_${index + 1}`,
      kind: "primary_board_news",
      query: group.length > 0
        ? `material current company news filings guidance catalysts ${group.join(" ")}`
        : "reserved primary board coverage slot with no additional configured symbols",
      numResults: 10,
      category: "news",
      ...(group.length === 0 ? { policyResolution: "no_symbols" as const } : {}),
    });
  }
  add({
    queryId: "discovery_movers",
    kind: "discovery_movers",
    query: `liquid US listed premarket movers attributable catalyst ${preferences.discoverySymbols.join(" ")}`,
    numResults: 15,
    category: "news",
  });
  add({
    queryId: "official_calendar",
    kind: "official_calendar",
    query: "official calendar today next five days Fed BLS BEA Treasury EIA SEC exchanges company investor relations",
    numResults: 12,
    category: "financial report",
    includeDomains: ["federalreserve.gov", "bls.gov", "bea.gov", "treasury.gov", "eia.gov", "sec.gov", "nyse.com", "nasdaq.com"],
  });
  add({
    queryId: "earnings_corporate_actions",
    kind: "earnings_corporate_actions",
    query: `earnings guidance dividends splits offerings filings ${preferences.primarySymbols.join(" ")}`,
    numResults: 12,
    category: "financial report",
  });
  for (const source of preferences.requestedSources) {
    const sourceState = policy.state(source);
    add({
      queryId: `requested_source_${source.toLowerCase()}`,
      kind: "requested_source",
      requestedSource: source,
      query: `${source} current material US market news calendar catalyst status`,
      numResults: 5,
      category: "news",
      includeDomains: [...REQUESTED_SOURCE_DOMAINS[source]],
      ...(sourceState === "approved" ? {} : { policyResolution: "unavailable" as const }),
    });
  }
  if (slots.length !== 12) throw new Error("exa_invalid_request");
  const providerCallCount = slots.filter((slot) => slot.policyResolution === undefined).length;
  if (providerCallCount > preferences.searchRequestBudget) throw new Error("exa_invalid_request");
  return { slots, providerCallCount, requiredSlotCount: slots.length };
}
