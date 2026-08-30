import type { RobinhoodConnectionStatus } from "./mcp-client.js";
import type { CanonicalJsonValue } from "../results/canonical-json.js";

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop_limit";
export type TimeInForce = "day" | "gtc";

export interface ApplicationToolArguments {
  readonly [key: string]: string | readonly string[] | undefined;
  readonly symbol?: string;
  readonly symbols?: readonly string[];
  readonly status?: string;
}

export interface TradeProposalInput {
  actorId: string;
  threadId?: string;
  runId?: string;
  symbol: string;
  side: OrderSide;
  quantity?: number;
  notionalUsd?: number;
  orderType: OrderType;
  timeInForce: TimeInForce;
  limitPrice?: number;
  stopPrice?: number;
  estimatedPrice?: number;
  estimatedTotal?: number;
  reviewReference: string;
  expiresAt?: number;
}

export interface StoredTradeProposal extends Omit<TradeProposalInput, "expiresAt"> {
  proposalId: string;
  fingerprint: string;
  idempotencyKey: string;
  expiresAt: number;
  createdAt: number;
}

export interface PortfolioPosition {
  symbol: string;
  quantity: number;
  price: number;
  marketValue: number;
  averageCost?: number;
  dayChange?: number;
  dayChangePercent?: number;
}

export interface PortfolioSnapshot {
  capturedAt: number;
  totalEquity: number;
  buyingPower: number;
  cash: number;
  dayChange: number;
  dayChangePercent: number;
  positions: PortfolioPosition[];
}

export type OrderExecutionResult =
  | { status: "submitted"; brokerOrderId: string }
  | { status: "failed"; errorCode: string };

export interface TradingBroker {
  startConnection(actorId: string): Promise<RobinhoodConnectionStatus>;
  completeConnection(actorId: string, code: string, state: string): Promise<RobinhoodConnectionStatus>;
  connectionStatus(actorId: string): Promise<RobinhoodConnectionStatus>;
  disconnect(actorId: string): Promise<RobinhoodConnectionStatus>;
  refreshPortfolio(actorId: string): Promise<PortfolioSnapshot>;
  proposeOrder(input: TradeProposalInput): Promise<StoredTradeProposal>;
  executeOrder(actorId: string, proposalId: string, fingerprint: string): Promise<OrderExecutionResult>;
  callApplicationTool(actorId: string, name: "get_accounts" | "get_portfolio" | "get_equity_positions" | "get_equity_quotes" | "get_equity_orders", args: ApplicationToolArguments, signal?: AbortSignal): Promise<CanonicalJsonValue>;
  dispose(): Promise<void>;
}
