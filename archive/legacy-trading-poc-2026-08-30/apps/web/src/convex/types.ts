export type CommandStatus =
  | "accepted"
  | "dispatching"
  | "running"
  | "completed"
  | "failed"
  | "canceled";
export type RunStatus =
  | "pending"
  | "running"
  | "cancellation_requested"
  | "completed"
  | "failed"
  | "canceled";
export type MessageStatus =
  | "pending"
  | "streaming"
  | "completed"
  | "failed"
  | "canceled";

export interface ThreadSummary {
  stableId: string;
  title: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
}

export interface TextPart {
  type: "text";
  text: string;
}

export interface ToolPart {
  type: "tool";
  toolCallId: string;
  name: string;
  status: "running" | "completed" | "failed" | "canceled";
  inputSummary?: string;
  outputSummary?: string;
  durationMs?: number;
}

export interface ErrorPart {
  type: "error";
  code: string;
  message: string;
  retryable: boolean;
}

export type AssistantPart = TextPart | ToolPart | ErrorPart;

export interface RunMetrics {
  model?: string;
  provider?: string;
  inputTokens?: number;
  promptTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  ttftMs?: number | null;
  timeToFirstOutputMs?: number | null;
  timeToFirstVisibleTextMs?: number;
  runDurationMs?: number;
  totalRunDurationMs?: number;
  approximateOutputTps?: number | null;
  outputTokensPerSecond?: number;
}

export interface MessageReadModel {
  stableId: string;
  threadId: string;
  runId?: string;
  ordinal: number;
  role: "user" | "assistant";
  status: MessageStatus;
  text?: string;
  parts: AssistantPart[];
  createdAt: number;
  updatedAt: number;
  metrics?: RunMetrics;
}

export type ResultEvent =
  | { type: "text_delta"; text: string }
  | {
      type: "tool_start";
      toolCallId: string;
      name: string;
      inputSummary?: string;
    }
  | {
      type: "tool_end";
      toolCallId: string;
      name: string;
      ok: boolean;
      outputSummary?: string;
      durationMs: number;
    }
  | {
      type: "error";
      code: string;
      message: string;
      retryable: boolean;
    }
  | { type: "canceled" }
  | { type: "completed"; metrics: RunMetrics };

export interface ResultBatch {
  sequence: number;
  events: ResultEvent[];
  terminal: boolean;
  createdAt: number;
}

export interface ActiveRunReadModel {
  run: {
    runId: string;
    commandId: string;
    assistantMessageId: string;
    status: Extract<
      RunStatus,
      "pending" | "running" | "cancellation_requested"
    >;
    lastAcceptedSequence: number;
    dispatchDeadlineAt?: number;
    leaseExpiresAt?: number;
  };
  command: {
    commandId: string;
    status: CommandStatus;
    lastDispatchError?: string;
  } | null;
  assistantMessage: {
    stableId: string;
    status: MessageStatus;
    parts: AssistantPart[];
    metrics?: RunMetrics;
    createdAt: number;
    updatedAt: number;
  };
  batches: ResultBatch[];
}

export interface CommandReadModel {
  commandId: string;
  type:
    | "thread.prompt"
    | "thread.retry"
    | "thread.stop"
    | "thread.rename"
    | "thread.archive";
  status: CommandStatus;
  threadId?: string;
  runId?: string;
  dispatchAttempts: number;
  lastDispatchError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CommandAccepted {
  commandId: string;
  threadId?: string;
  runId?: string;
  status: CommandStatus;
}

export type BrokerConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface BrokerConnectionReadModel {
  status: BrokerConnectionStatus;
  label?: string;
  grantedScopes: string[];
  lastVerifiedAt?: number;
  errorCode?: string;
  updatedAt: number;
}

export interface PortfolioPositionReadModel {
  symbol: string;
  quantity: number;
  price: number;
  marketValue: number;
  averageCost?: number;
  dayChange?: number;
  dayChangePercent?: number;
}

export interface PortfolioSnapshotReadModel {
  capturedAt: number;
  totalEquity: number;
  buyingPower: number;
  cash: number;
  dayChange: number;
  dayChangePercent: number;
  positions: PortfolioPositionReadModel[];
}

export type TradeProposalStatus =
  | "awaiting_confirmation"
  | "approved"
  | "rejected"
  | "expired"
  | "submitting"
  | "submitted"
  | "failed";

export interface TradeProposalReadModel {
  stableId: string;
  status: TradeProposalStatus;
  symbol: string;
  side: "buy" | "sell";
  quantity?: number;
  notionalUsd?: number;
  orderType: "market" | "limit" | "stop" | "stop_limit";
  timeInForce: "day" | "gtc";
  limitPrice?: number;
  stopPrice?: number;
  estimatedPrice?: number;
  estimatedTotal?: number;
  reviewReference: string;
  fingerprint: string;
  expiresAt: number;
  updatedAt: number;
}

export interface TradingDashboardReadModel {
  connection: BrokerConnectionReadModel | null;
  portfolio: PortfolioSnapshotReadModel | null;
  proposals: TradeProposalReadModel[];
}

export type RobinhoodConnectionResult =
  | {
      status: "authorization_required";
      authorizationUrl: string;
    }
  | {
      status: "connected";
      label?: string;
      grantedScopes: string[];
    }
  | { status: "disconnected" };

export type ProposalExecutionResult =
  | { status: "submitted"; brokerOrderId: string }
  | { status: "failed"; errorCode: string };

export interface Page<T> {
  page: T[];
  isDone: boolean;
  continueCursor: string;
}
