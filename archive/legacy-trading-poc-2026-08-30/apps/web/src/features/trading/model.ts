import type {
  TradeProposalStatus,
  TradingDashboardReadModel,
} from "../../convex/types";
import type {
  ConnectionStatus,
  PortfolioSnapshot,
  Position,
  ProposalStatus,
  TradeProposal,
} from "../dashboard/TradingDashboard";

export interface TradingDashboardModel {
  brokerConnection: ConnectionStatus;
  brokerIsMock: boolean;
  brokerLabel: string;
  connectionNeedsAttention: boolean;
  portfolio: PortfolioSnapshot | null;
  positions: Position[];
  proposals: TradeProposal[];
}

const updatedAtFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

function proposalStatus(status: TradeProposalStatus): ProposalStatus {
  if (status === "rejected" || status === "expired" || status === "failed") {
    return "rejected";
  }
  if (
    status === "approved" ||
    status === "submitting" ||
    status === "submitted"
  ) {
    return "approved";
  }
  return "pending";
}

function emptyDashboard(): TradingDashboardModel {
  return {
    brokerConnection: "disconnected",
    brokerIsMock: false,
    brokerLabel: "Robinhood",
    connectionNeedsAttention: false,
    portfolio: null,
    positions: [],
    proposals: [],
  };
}

export function toTradingDashboardModel(
  value: TradingDashboardReadModel | undefined,
): TradingDashboardModel {
  if (!value) return emptyDashboard();
  const brokerLabel = value.connection?.label?.trim() || "Robinhood";
  const portfolio = value.portfolio
    ? {
        totalValue: value.portfolio.totalEquity,
        buyingPower: value.portfolio.buyingPower,
        dayChange: value.portfolio.dayChange,
        dayChangePercent: value.portfolio.dayChangePercent,
        updatedLabel: `Updated ${updatedAtFormatter.format(value.portfolio.capturedAt)}`,
      }
    : null;
  const positions = value.portfolio
    ? value.portfolio.positions.map(
        (position): Position => ({
          symbol: position.symbol,
          quantity: position.quantity,
          marketValue: position.marketValue,
          dayChangePercent: position.dayChangePercent ?? 0,
        }),
      )
    : [];
  const proposals = value.proposals.map((proposal): TradeProposal => {
    const result: TradeProposal = {
      id: proposal.stableId,
      side: proposal.side,
      symbol: proposal.symbol,
      orderType: proposal.orderType,
      timeInForce: proposal.timeInForce,
      rationale: proposal.reviewReference,
      status: proposalStatus(proposal.status),
    };
    if (proposal.quantity !== undefined) result.quantity = proposal.quantity;
    if (proposal.notionalUsd !== undefined)
      result.notionalUsd = proposal.notionalUsd;
    if (proposal.limitPrice !== undefined)
      result.limitPrice = proposal.limitPrice;
    if (proposal.stopPrice !== undefined) result.stopPrice = proposal.stopPrice;
    if (proposal.estimatedTotal !== undefined)
      result.estimatedTotal = proposal.estimatedTotal;
    return result;
  });
  return {
    brokerConnection: value.connection?.status ?? "disconnected",
    brokerIsMock: /\b(?:demo|mock|simulation)\b/i.test(brokerLabel),
    brokerLabel,
    connectionNeedsAttention: value.connection?.status === "error",
    portfolio,
    positions,
    proposals,
  };
}
