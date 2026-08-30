import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { canonicalJson } from "../results/canonical-json.js";
import type { CanonicalJsonValue } from "../results/canonical-json.js";
import {
  APPLICATION_MCP_TOOLS,
  ROBINHOOD_MCP_URL,
  RobinhoodMcpClient,
  type ApplicationMcpTool,
  type RobinhoodConnectionStatus,
} from "./mcp-client.js";
import { ConvexActorStore, type ActorCredentialStore } from "./actor-store.js";
import type {
  OrderExecutionResult,
  PortfolioPosition,
  PortfolioSnapshot,
  StoredTradeProposal,
  TradeProposalInput,
  TradingBroker,
  ApplicationToolArguments,
} from "./types.js";
import type { RobinhoodMcpClientOptions } from "./mcp-client.js";
import { assertBoundActor } from "../identity/actor-binding.js";

export interface TradingBrokerOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  store?: ActorCredentialStore;
  mcpClient?: RobinhoodMcpClient;
}

interface ConvexTradeProposalPayload {
  ownerId: string;
  proposalId: string;
  threadId?: string;
  runId?: string;
  symbol: string;
  side: StoredTradeProposal["side"];
  quantity?: number;
  notionalUsd?: number;
  orderType: StoredTradeProposal["orderType"];
  timeInForce: StoredTradeProposal["timeInForce"];
  limitPrice?: number;
  stopPrice?: number;
  estimatedPrice?: number;
  estimatedTotal?: number;
  reviewReference: string;
  fingerprint: string;
  idempotencyKey: string;
  expiresAt: number;
}

const DEFAULT_EXPIRY_MS = 15 * 60 * 1_000;
const MOCK_PORTFOLIO_CONTENT: Omit<PortfolioSnapshot, "capturedAt"> = {
  totalEquity: 10_000,
  buyingPower: 7_500,
  cash: 7_500,
  dayChange: 125,
  dayChangePercent: 1.25,
  positions: [
    {
      symbol: "AAPL",
      quantity: 10,
      price: 250,
      marketValue: 2_500,
      averageCost: 237.5,
      dayChange: 25,
      dayChangePercent: 1,
    },
  ],
};

function mockPortfolio(capturedAt: number): PortfolioSnapshot {
  return { capturedAt, ...structuredClone(MOCK_PORTFOLIO_CONTENT) };
}

function convexTradeProposalPayload(
  proposal: StoredTradeProposal,
): ConvexTradeProposalPayload {
  const payload: ConvexTradeProposalPayload = {
    ownerId: proposal.actorId,
    proposalId: proposal.proposalId,
    symbol: proposal.symbol,
    side: proposal.side,
    orderType: proposal.orderType,
    timeInForce: proposal.timeInForce,
    reviewReference: proposal.reviewReference,
    fingerprint: proposal.fingerprint,
    idempotencyKey: proposal.idempotencyKey,
    expiresAt: proposal.expiresAt,
  };
  if (proposal.threadId !== undefined) payload.threadId = proposal.threadId;
  if (proposal.runId !== undefined) payload.runId = proposal.runId;
  if (proposal.quantity !== undefined) payload.quantity = proposal.quantity;
  if (proposal.notionalUsd !== undefined) payload.notionalUsd = proposal.notionalUsd;
  if (proposal.limitPrice !== undefined) payload.limitPrice = proposal.limitPrice;
  if (proposal.stopPrice !== undefined) payload.stopPrice = proposal.stopPrice;
  if (proposal.estimatedPrice !== undefined) payload.estimatedPrice = proposal.estimatedPrice;
  if (proposal.estimatedTotal !== undefined) payload.estimatedTotal = proposal.estimatedTotal;
  return payload;
}

function safeActorId(actorId: string): void {
  if (!/^[A-Za-z0-9:_-]{1,256}$/.test(actorId)) throw new Error("Invalid actor ID.");
}

function safeProposalId(proposalId: string): void {
  if (!/^[A-Za-z0-9:_-]{1,256}$/.test(proposalId)) throw new Error("Invalid proposal ID.");
}

type JsonRecord = { readonly [key: string]: CanonicalJsonValue | undefined };

function recordValue(value: CanonicalJsonValue | undefined): JsonRecord {
  if (Array.isArray(value) || !(value instanceof Object)) return {};
  // SAFETY: CanonicalJsonValue object branches are JSON records after arrays and primitives are excluded above.
  return value as JsonRecord;
}

function firstNumber(record: JsonRecord, ...keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    const parsed = z.coerce.number().finite().safeParse(value);
    if (parsed.success) return parsed.data;
  }
  return 0;
}

function normalizePositions(value: CanonicalJsonValue | undefined): PortfolioPosition[] {
  const candidate: unknown = Array.isArray(value)
    ? value
    : Array.isArray(recordValue(value).positions)
      ? recordValue(value).positions
      : [];
  const source: CanonicalJsonValue[] = Array.isArray(candidate) ? candidate : [];
  return source.flatMap((item) => {
    const position = recordValue(item);
    const symbol = z.string().safeParse(position.symbol).success
      ? z.string().parse(position.symbol)
      : z.string().safeParse(position.ticker).success
        ? z.string().parse(position.ticker)
        : z.string().safeParse(position.instrument).success
          ? z.string().parse(position.instrument)
          : "";
    if (!symbol) return [];
    const result: PortfolioPosition = {
      symbol: symbol.slice(0, 16),
      quantity: firstNumber(position, "quantity", "shares"),
      price: firstNumber(position, "price", "last_price", "current_price"),
      marketValue: firstNumber(position, "marketValue", "market_value", "equity"),
    };
    const averageCost = firstNumber(position, "averageCost", "average_cost", "average_buy_price");
    if (averageCost > 0) result.averageCost = averageCost;
    if (Object.hasOwn(position, "dayChange") || Object.hasOwn(position, "day_change")) result.dayChange = firstNumber(position, "dayChange", "day_change");
    if (Object.hasOwn(position, "dayChangePercent") || Object.hasOwn(position, "day_change_percent")) result.dayChangePercent = firstNumber(position, "dayChangePercent", "day_change_percent");
    return [result];
  });
}

function normalizePortfolio(value: CanonicalJsonValue, now: number): PortfolioSnapshot {
  const portfolio = recordValue(value);
  const totals = recordValue(portfolio.totals);
  return {
    capturedAt: firstNumber(portfolio, "capturedAt", "captured_at") || now,
    totalEquity: firstNumber(portfolio, "totalEquity", "total_equity", "equity") || firstNumber(totals, "totalEquity", "total_equity", "equity"),
    buyingPower: firstNumber(portfolio, "buyingPower", "buying_power") || firstNumber(totals, "buyingPower", "buying_power"),
    cash: firstNumber(portfolio, "cash", "cash_balance") || firstNumber(totals, "cash", "cash_balance"),
    dayChange: firstNumber(portfolio, "dayChange", "day_change") || firstNumber(totals, "dayChange", "day_change"),
    dayChangePercent: firstNumber(portfolio, "dayChangePercent", "day_change_percent") || firstNumber(totals, "dayChangePercent", "day_change_percent"),
    positions: normalizePositions(portfolio.positions ?? value),
  };
}

function fingerprintFor(input: TradeProposalInput): string {
  return createHash("sha256").update(canonicalJson({
    actorId: input.actorId,
    threadId: input.threadId,
    runId: input.runId,
    symbol: input.symbol,
    side: input.side,
    quantity: input.quantity,
    notionalUsd: input.notionalUsd,
    orderType: input.orderType,
    timeInForce: input.timeInForce,
    limitPrice: input.limitPrice,
    stopPrice: input.stopPrice,
    estimatedPrice: input.estimatedPrice,
    estimatedTotal: input.estimatedTotal,
    reviewReference: input.reviewReference,
    expiresAt: input.expiresAt,
  }), "utf8").digest("hex");
}

function mockConnection(): RobinhoodConnectionStatus {
  return { status: "connected", label: "Mock Robinhood", grantedScopes: ["read", "trade"] };
}

export class TradingBrokerService implements TradingBroker {
  private readonly mockConnections = new Set<string>();
  private readonly proposals = new Map<string, StoredTradeProposal>();
  private readonly submissions = new Map<string, OrderExecutionResult>();
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly store: ActorCredentialStore | undefined;
  private readonly mcp: RobinhoodMcpClient | undefined;

  constructor(private readonly config: AppConfig, options: TradingBrokerOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
    if (config.brokerMode === "robinhood") {
      if (!config.boundActorId) throw new Error("BOUND_ACTOR_ID is required in Robinhood mode.");
      if (!config.piCredentialEncryptionKey) {
        throw new Error("PI_CREDENTIAL_ENCRYPTION_KEY is required in Robinhood mode.");
      }
      this.store = options.store ?? new ConvexActorStore({
        actorId: config.boundActorId,
        siteUrl: config.convexSiteUrl,
        sharedSecret: config.sharedSecret,
        encryptionKey: config.piCredentialEncryptionKey,
        keyVersion: config.piCredentialKeyVersion,
        requestTimeoutMs: config.requestTimeoutMs,
        retryAttempts: config.retryAttempts,
        fetch: this.fetchFn,
      });
      if (options.mcpClient) this.mcp = options.mcpClient;
      else {
        const mcpOptions: RobinhoodMcpClientOptions = {
          store: this.store,
          serverUrl: ROBINHOOD_MCP_URL,
          redirectUri: config.robinhoodOAuthRedirectUri,
          fetchFn: this.fetchFn,
          now: this.now,
        };
        if (config.robinhoodOAuthClientId) mcpOptions.clientId = config.robinhoodOAuthClientId;
        this.mcp = new RobinhoodMcpClient(mcpOptions);
      }
    } else {
      this.store = options.store;
      this.mcp = undefined;
    }
  }

  async startConnection(actorId: string): Promise<RobinhoodConnectionStatus> {
    this.assertBoundActor(actorId);
    if (this.config.brokerMode === "mock") {
      this.mockConnections.add(actorId);
      return mockConnection();
    }
    return this.mcp!.start(actorId);
  }

  async completeConnection(actorId: string, code: string, state: string): Promise<RobinhoodConnectionStatus> {
    this.assertBoundActor(actorId);
    if (this.config.brokerMode === "mock") {
      this.mockConnections.add(actorId);
      return mockConnection();
    }
    return this.mcp!.complete(actorId, code, state);
  }

  async connectionStatus(actorId: string): Promise<RobinhoodConnectionStatus> {
    this.assertBoundActor(actorId);
    if (this.config.brokerMode === "mock") return this.mockConnections.has(actorId) ? mockConnection() : { status: "disconnected" };
    return this.mcp!.status(actorId);
  }

  async disconnect(actorId: string): Promise<RobinhoodConnectionStatus> {
    this.assertBoundActor(actorId);
    for (const key of this.proposals.keys()) if (key.startsWith(`${actorId}:`)) this.proposals.delete(key);
    if (this.config.brokerMode === "mock") {
      this.mockConnections.delete(actorId);
      return { status: "disconnected" };
    }
    return this.mcp!.disconnect(actorId);
  }

  async refreshPortfolio(actorId: string): Promise<PortfolioSnapshot> {
    this.assertBoundActor(actorId);
    if (this.config.brokerMode === "mock") return mockPortfolio(this.now());
    const value = await this.mcp!.callTool(actorId, "get_portfolio", {});
    return normalizePortfolio(value, this.now());
  }

  async proposeOrder(input: TradeProposalInput): Promise<StoredTradeProposal> {
    this.assertBoundActor(input.actorId);
    this.validateOrder(input);
    const createdAt = this.now();
    const proposal: StoredTradeProposal = {
      ...input,
      proposalId: `proposal_${randomUUID()}`,
      fingerprint: fingerprintFor(input),
      idempotencyKey: `order_${randomUUID()}`,
      expiresAt: input.expiresAt ?? createdAt + DEFAULT_EXPIRY_MS,
      createdAt,
    };
    const response = await this.fetchFn(`${this.config.convexSiteUrl}/service/trade-proposals`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.sharedSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(convexTradeProposalPayload(proposal)),
    });
    if (!response.ok) throw new Error("Trade proposal could not be recorded.");
    this.proposals.set(`${input.actorId}:${proposal.proposalId}`, proposal);
    return proposal;
  }

  async executeOrder(actorId: string, proposalId: string, fingerprint: string): Promise<OrderExecutionResult> {
    this.assertBoundActor(actorId);
    safeProposalId(proposalId);
    const proposal = this.proposals.get(`${actorId}:${proposalId}`);
    if (!proposal || proposal.fingerprint !== fingerprint) return { status: "failed", errorCode: "proposal_mismatch" };
    if (proposal.expiresAt <= this.now()) return { status: "failed", errorCode: "proposal_expired" };
    const prior = this.submissions.get(`${actorId}:${proposal.idempotencyKey}`);
    if (prior) return prior;
    if (this.config.brokerMode === "mock") {
      const result = {
        status: "submitted" as const,
        brokerOrderId: `mock_${createHash("sha256").update(`${actorId}:${proposal.idempotencyKey}`, "utf8").digest("hex").slice(0, 24)}`,
      };
      this.submissions.set(`${actorId}:${proposal.idempotencyKey}`, result);
      return result;
    }
    if (!this.config.liveTradingEnabled) return { status: "failed", errorCode: "live_trading_disabled" };
    return { status: "failed", errorCode: "live_order_tool_not_enabled" };
  }

  async callApplicationTool(actorId: string, name: ApplicationMcpTool, args: ApplicationToolArguments, signal?: AbortSignal): Promise<CanonicalJsonValue> {
    this.assertBoundActor(actorId);
    if (!APPLICATION_MCP_TOOLS.includes(name)) throw new Error("MCP tool is not in the application allowlist.");
    if (this.config.brokerMode === "mock") return this.mockTool(name, args);
    return this.mcp!.callTool(actorId, name, args, signal);
  }

  async dispose(): Promise<void> {
    this.proposals.clear();
    this.submissions.clear();
    this.mockConnections.clear();
  }

  private validateOrder(input: TradeProposalInput): void {
    if (!/^[A-Za-z][A-Za-z0-9.-]{0,15}$/.test(input.symbol)) throw new Error("Invalid order symbol.");
    if (input.quantity === undefined && input.notionalUsd === undefined) throw new Error("Order quantity or notional is required.");
    if (input.quantity !== undefined && (!Number.isFinite(input.quantity) || input.quantity <= 0)) throw new Error("Order quantity must be positive.");
    if (input.notionalUsd !== undefined && (!Number.isFinite(input.notionalUsd) || input.notionalUsd <= 0)) throw new Error("Order notional must be positive.");
    if (input.orderType === "limit" || input.orderType === "stop_limit") {
      if (input.limitPrice === undefined || input.limitPrice <= 0) throw new Error("Limit price is required.");
    }
    if (input.orderType === "stop" || input.orderType === "stop_limit") {
      if (input.stopPrice === undefined || input.stopPrice <= 0) throw new Error("Stop price is required.");
    }
  }

  private assertBoundActor(actorId: string): void {
    safeActorId(actorId);
    if (this.config.boundActorId) assertBoundActor(this.config.boundActorId, actorId);
  }

  private mockTool(name: ApplicationMcpTool, args: ApplicationToolArguments): CanonicalJsonValue {
    const portfolio = mockPortfolio(this.now());
    if (name === "get_portfolio") return JSON.parse(JSON.stringify(portfolio));
    if (name === "get_equity_positions") return JSON.parse(JSON.stringify(portfolio.positions));
    if (name === "get_accounts") return [{ id: "mock-account", status: "active", buyingPower: portfolio.buyingPower }];
    if (name === "get_equity_orders") return [];
    if (name === "get_equity_quotes") {
      const parsedSymbols = z.array(z.string()).safeParse(args.symbols);
      const symbols = parsedSymbols.success ? parsedSymbols.data : args.symbol !== undefined ? [args.symbol] : ["AAPL"];
      return symbols.map((symbol) => ({ symbol, price: 250, capturedAt: portfolio.capturedAt }));
    }
    return [];
  }
}

export function createTradingBroker(config: AppConfig): TradingBroker {
  return new TradingBrokerService(config);
}
