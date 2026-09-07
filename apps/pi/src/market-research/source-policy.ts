import type { RequestedSourceStatus } from "./types.js";
import {
  REQUESTED_SOURCES,
  type MarketResearchEvidenceItem,
  type MarketResearchPreferencesV1,
} from "./contracts.js";

export const MARKET_RESEARCH_SOURCE_POLICY_VERSION = "source-policy-v1";

export type SourcePolicyState =
  | "approved"
  | "evaluation_only"
  | "permission_required"
  | "blocked"
  | "unavailable";

export const REQUESTED_SOURCE_DOMAINS = {
  FinancialJuice: ["financialjuice.com"],
  Barchart: ["barchart.com"],
  ForexFactory: ["forexfactory.com"],
  Yahoo: ["finance.yahoo.com"],
  TradingView: ["tradingview.com"],
} as const;

export const DEFAULT_SOURCE_POLICY = {
  Exa: "approved",
  official: "approved",
  licensed_market_data: "unavailable",
  financial_datasets: "evaluation_only",
  FinancialJuice: "permission_required",
  Barchart: "permission_required",
  ForexFactory: "permission_required",
  Yahoo: "permission_required",
  Nasdaq: "permission_required",
  TradingView: "permission_required",
} as const satisfies Readonly<Record<string, SourcePolicyState>>;

export interface SourcePolicy {
  readonly version: string;
  state(source: string): SourcePolicyState;
}

export class StaticSourcePolicy implements SourcePolicy {
  readonly version: string;

  constructor(
    private readonly states: Readonly<Record<string, SourcePolicyState>> = DEFAULT_SOURCE_POLICY,
    version = MARKET_RESEARCH_SOURCE_POLICY_VERSION,
  ) {
    this.version = version;
  }

  state(source: string): SourcePolicyState {
    return this.states[source] ?? "unavailable";
  }
}

export function initialRequestedSourceStatus(
  preferences: Pick<MarketResearchPreferencesV1, "requestedSources">,
  policy: SourcePolicy,
): RequestedSourceStatus[] {
  return REQUESTED_SOURCES.map((source) => {
    if (!preferences.requestedSources.includes(source)) {
      return {
        source,
        status: "disabled_by_policy" as const,
        detail: "Unavailable - source is not requested in this frozen configuration",
        sourceIds: [],
      };
    }
    const state = policy.state(source);
    return {
      source,
      status: state === "approved" ? "no_material_item" as const : "disabled_by_policy" as const,
      detail: state === "approved"
        ? "No permitted material item was retained"
        : "Unavailable - source access or permission not configured",
      sourceIds: [],
    };
  });
}

export function requestedSourceStatusFromEvidence(
  initial: readonly RequestedSourceStatus[],
  evidence: readonly MarketResearchEvidenceItem[],
): RequestedSourceStatus[] {
  return initial.map((status) => {
    if (status.status === "disabled_by_policy") return status;
    const queryId = `requested_source_${status.source.toLowerCase()}`;
    const request = evidence.find((item) =>
      item.evidenceId.startsWith("exa-search-slot-")
      && item.normalizedClaims.some((claim) => claim.includes(`slot ${queryId} `)),
    );
    if (request?.requestId === undefined) return status;
    const sourceIds = evidence
      .filter((item) => item.kind === "news" && item.requestId === request.requestId)
      .map((item) => item.evidenceId)
      .slice(0, 20);
    return sourceIds.length === 0
      ? { ...status, status: "no_material_item", detail: "No permitted material item was retained", sourceIds: [] }
      : { ...status, status: "contributed", detail: "Permitted material evidence was retained", sourceIds };
  });
}
