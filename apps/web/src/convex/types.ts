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

export type DiscordGatewayStatus =
  | "online"
  | "offline"
  | "degraded"
  | "not_configured";

export type DiscordChannelRole =
  | "conversation_monitor"
  | "reply_target"
  | "research_log";

export type DiscordLoopStatus =
  | "idle"
  | "triaging"
  | "acknowledging"
  | "researching"
  | "drafting"
  | "catching_up"
  | "error";

export type DiscordReplyKind = "acknowledgement" | "research_log" | "final";

export type DiscordActivityEventType =
  | "message_received"
  | "loop_started"
  | "stage_changed"
  | "reply_queued"
  | "reply_sent"
  | "reply_failed"
  | "loop_completed"
  | "loop_failed";

export interface DiscordActivityReadModel {
  eventId: string;
  guildId: string;
  channelId: string;
  runId?: string;
  eventType: DiscordActivityEventType;
  stage?: DiscordLoopStatus;
  replyKind?: DiscordReplyKind;
  createdAt: number;
}

export interface DiscordGatewayReadModel {
  status: DiscordGatewayStatus;
  connectedAt?: number;
  lastHeartbeatAt?: number;
  botUserName?: string;
  error?: string;
}

export interface DiscordPermissionReadModel {
  viewChannels: boolean;
  sendMessages: boolean;
  readMessageHistory: boolean;
  messageContent: boolean;
}

export interface DiscordLoopReadModel {
  status: DiscordLoopStatus;
  pendingMessageCount: number;
  lastProcessedAt?: number;
  error?: string;
}

export interface DiscordChannelReadModel {
  channelId: string;
  name: string;
  type: "text" | "announcement" | "forum" | "other";
  canView: boolean;
  canSend: boolean;
  canReadHistory: boolean;
  roles: DiscordChannelRole[];
  loop?: DiscordLoopReadModel;
}

export interface DiscordGuildReadModel {
  guildId: string;
  name: string;
  iconUrl?: string;
  permissions: DiscordPermissionReadModel;
  routing?: {
    conversationChannelId?: string;
    researchLogChannelId?: string;
  };
  channels: DiscordChannelReadModel[];
}

export interface DiscordControlPlaneReadModel {
  gateway: DiscordGatewayReadModel;
  activity?: DiscordActivityReadModel[];
  guilds: DiscordGuildReadModel[];
}

export interface DiscordChannelAssignmentReadModel {
  guildId: string;
  channelId: string;
  roles: DiscordChannelRole[];
  updatedAt?: number;
}

export interface DiscordGuildRoutingReadModel {
  guildId: string;
  conversationChannelId: string | null;
  researchLogChannelId: string | null;
  updatedAt: number;
}
