import { RobinhoodHandoff } from "../trading/RobinhoodHandoff";

export type ConnectionStatus =
  | "connected"
  | "connecting"
  | "disconnected"
  | "error";
export type ProposalStatus = "pending" | "approved" | "rejected";

export interface PortfolioSnapshot {
  totalValue: number;
  buyingPower: number;
  dayChange: number;
  dayChangePercent: number;
  updatedLabel: string;
}

export interface Position {
  symbol: string;
  name?: string;
  quantity: number;
  marketValue: number;
  dayChangePercent: number;
}

export interface TradeProposal {
  id: string;
  side: "buy" | "sell";
  symbol: string;
  quantity?: number;
  notionalUsd?: number;
  orderType: "limit" | "market" | "stop" | "stop_limit";
  timeInForce?: "day" | "gtc";
  limitPrice?: number;
  stopPrice?: number;
  estimatedTotal?: number;
  rationale: string;
  status: ProposalStatus;
}

interface TradingDashboardProps {
  cloudConnected: boolean;
  brokerConnection: ConnectionStatus;
  brokerIsMock?: boolean;
  brokerLabel?: string;
  authorizationUrl?: string | null;
  portfolio: PortfolioSnapshot | null;
  positions: Position[];
  proposals: TradeProposal[];
  demoMode?: boolean;
  isLoading?: boolean;
  connectionBusy?: boolean;
  connectionNeedsAttention?: boolean;
  decisionBusyId?: string | null;
  refreshBusy?: boolean;
  onToggleConnection?: () => void;
  onDismissAuthorization?: () => void;
  onRefresh?: () => void;
  onDecision?: (proposalId: string, decision: "approve" | "reject") => void;
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

function signedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function Change({ value }: { value: number }) {
  return (
    <span className="market-change" data-direction={value >= 0 ? "up" : "down"}>
      {signedPercent(value)}
    </span>
  );
}

function connectionLabel(
  status: ConnectionStatus,
  isLoading: boolean,
  isMock: boolean,
): string {
  if (isLoading) return "Loading";
  if (status === "connected") {
    return isMock ? "Simulation connected" : "Connected";
  }
  if (status === "connecting") return "Connecting";
  if (status === "error") return "Needs attention";
  return "Not connected";
}

function proposalTitle(proposal: TradeProposal): string {
  if (proposal.quantity !== undefined) {
    return `${proposal.quantity} ${proposal.quantity === 1 ? "share" : "shares"} of ${proposal.symbol}`;
  }
  if (proposal.notionalUsd !== undefined) {
    return `${money.format(proposal.notionalUsd)} of ${proposal.symbol}`;
  }
  return proposal.symbol;
}

function orderDescription(proposal: TradeProposal): string {
  const timeInForce = proposal.timeInForce
    ? ` · ${proposal.timeInForce.toUpperCase()}`
    : "";
  if (proposal.orderType === "limit" && proposal.limitPrice !== undefined) {
    return `Limit at ${money.format(proposal.limitPrice)}${timeInForce}`;
  }
  if (proposal.orderType === "stop" && proposal.stopPrice !== undefined) {
    return `Stop at ${money.format(proposal.stopPrice)}${timeInForce}`;
  }
  if (
    proposal.orderType === "stop_limit" &&
    proposal.stopPrice !== undefined &&
    proposal.limitPrice !== undefined
  ) {
    return `Stop ${money.format(proposal.stopPrice)} · limit ${money.format(proposal.limitPrice)}${timeInForce}`;
  }
  return `Market order${timeInForce}`;
}

function ConnectionPanel({
  cloudConnected,
  brokerConnection,
  brokerIsMock = false,
  brokerLabel = "Robinhood",
  authorizationUrl,
  demoMode,
  isLoading = false,
  connectionBusy = false,
  connectionNeedsAttention = false,
  refreshBusy = false,
  onToggleConnection,
  onDismissAuthorization,
  onRefresh,
}: Pick<
  TradingDashboardProps,
  | "cloudConnected"
  | "brokerConnection"
  | "brokerIsMock"
  | "brokerLabel"
  | "authorizationUrl"
  | "demoMode"
  | "isLoading"
  | "connectionBusy"
  | "connectionNeedsAttention"
  | "refreshBusy"
  | "onToggleConnection"
  | "onDismissAuthorization"
  | "onRefresh"
>) {
  const brokerConnected = brokerConnection === "connected";
  const mockBroker = demoMode || brokerIsMock;
  const providerLabel = mockBroker ? "Mock brokerage" : brokerLabel;
  return (
    <section
      className="surface connection-card"
      aria-labelledby="connection-title"
    >
      <div className="section-title-row">
        <div>
          <p className="section-kicker">Connections</p>
          <h2 id="connection-title">Account status</h2>
        </div>
        {demoMode && <span className="demo-chip">Demo</span>}
      </div>
      <div className="connection-list">
        <div>
          <span className="status-dot" data-online={cloudConnected} />
          <span>Signal cloud</span>
          <strong>{cloudConnected ? "Online" : "Reconnecting"}</strong>
        </div>
        <div>
          <span className="status-dot" data-online={brokerConnected} />
          <span>{providerLabel}</span>
          <strong>
            {connectionLabel(brokerConnection, isLoading, mockBroker)}
          </strong>
        </div>
      </div>
      {authorizationUrl && onDismissAuthorization && !mockBroker && (
        <RobinhoodHandoff
          authorizationUrl={authorizationUrl}
          onDismiss={onDismissAuthorization}
        />
      )}
      {onToggleConnection ? (
        <div className="connection-actions">
          <button
            className="secondary-action connection-action"
            type="button"
            disabled={connectionBusy || isLoading}
            onClick={onToggleConnection}
          >
            {connectionBusy
              ? "Please wait…"
              : demoMode
                ? brokerConnected
                  ? "Disconnect demo account"
                  : "Connect demo account"
                : brokerIsMock
                  ? brokerConnected
                    ? "Disconnect mock account"
                    : "Connect mock account"
                  : brokerConnected
                    ? "Disconnect Robinhood"
                    : "Connect Robinhood"}
          </button>
          {brokerConnected && onRefresh && (
            <button
              className="secondary-action connection-action"
              type="button"
              disabled={refreshBusy}
              onClick={onRefresh}
            >
              {refreshBusy ? "Refreshing…" : "Refresh portfolio"}
            </button>
          )}
        </div>
      ) : (
        <p className="connection-note">
          Brokerage authorization is not configured for this environment.
        </p>
      )}
      {connectionNeedsAttention && (
        <p className="connection-note connection-note--error" role="alert">
          {mockBroker ? "Mock brokerage" : "Robinhood"} needs attention. Start
          the connection again.
        </p>
      )}
    </section>
  );
}

function ApprovalQueue({
  proposals,
  demoMode,
  decisionBusyId,
  onDecision,
  title = "Trade approvals",
}: Pick<
  TradingDashboardProps,
  "proposals" | "demoMode" | "decisionBusyId" | "onDecision"
> & {
  title?: string;
}) {
  return (
    <section className="dashboard-section" aria-labelledby="approvals-title">
      <div className="section-title-row dashboard-section-heading">
        <div>
          <p className="section-kicker">Human control</p>
          <h2 id="approvals-title">{title}</h2>
        </div>
        <span className="count-badge">
          {proposals.filter((proposal) => proposal.status === "pending").length}
        </span>
      </div>
      {proposals.length === 0 ? (
        <div className="surface empty-state-card">
          <strong>No trade proposals</strong>
          <p>Signal will put every proposed order here for review.</p>
        </div>
      ) : (
        <div className="approval-list">
          {proposals.map((proposal) => (
            <article
              className="surface approval-card"
              data-status={proposal.status}
              key={proposal.id}
            >
              <header>
                <span className="trade-side" data-side={proposal.side}>
                  {proposal.side}
                </span>
                <div>
                  <h3>{proposalTitle(proposal)}</h3>
                  <p>{orderDescription(proposal)}</p>
                </div>
                <strong className="proposal-total">
                  {proposal.estimatedTotal === undefined
                    ? "Review"
                    : money.format(proposal.estimatedTotal)}
                </strong>
              </header>
              <p className="proposal-rationale">{proposal.rationale}</p>
              <p className="execution-note">
                {demoMode
                  ? "Simulation only. No order will be sent."
                  : "Approval is required before any order can be sent."}
              </p>
              {proposal.status === "pending" && onDecision ? (
                <div className="approval-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={decisionBusyId === proposal.id}
                    onClick={() => onDecision(proposal.id, "reject")}
                  >
                    {decisionBusyId === proposal.id ? "Working…" : "Reject"}
                  </button>
                  <button
                    className="primary-action"
                    type="button"
                    disabled={decisionBusyId === proposal.id}
                    onClick={() => onDecision(proposal.id, "approve")}
                  >
                    {decisionBusyId === proposal.id
                      ? "Working…"
                      : demoMode
                        ? "Approve demo"
                        : "Approve order"}
                  </button>
                </div>
              ) : proposal.status !== "pending" ? (
                <div className="decision-result" role="status">
                  <span aria-hidden="true">
                    {proposal.status === "approved" ? "✓" : "×"}
                  </span>
                  {demoMode
                    ? `Demo ${proposal.status}. No order was sent.`
                    : proposal.status === "approved"
                      ? "Approval recorded. Check the canonical order status."
                      : "Proposal rejected."}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function TradingDashboard({
  cloudConnected,
  brokerConnection,
  brokerIsMock = false,
  brokerLabel = "Robinhood",
  authorizationUrl = null,
  portfolio,
  positions,
  proposals,
  demoMode = false,
  isLoading = false,
  connectionBusy = false,
  connectionNeedsAttention = false,
  decisionBusyId = null,
  refreshBusy = false,
  onToggleConnection,
  onDismissAuthorization,
  onRefresh,
  onDecision,
}: TradingDashboardProps) {
  return (
    <main className="dashboard" aria-labelledby="dashboard-title">
      <header className="dashboard-heading">
        <div>
          <p className="page-kicker">Portfolio overview</p>
          <h1 id="dashboard-title">Stay ahead of the market.</h1>
        </div>
        {demoMode && <span className="demo-chip">No live orders</span>}
      </header>

      <section className="portfolio-grid" aria-label="Portfolio summary">
        <article className="portfolio-card">
          <p>Total portfolio</p>
          <strong>
            {portfolio ? money.format(portfolio.totalValue) : "—"}
          </strong>
          {portfolio ? (
            <div
              className="portfolio-change"
              data-direction={portfolio.dayChange >= 0 ? "up" : "down"}
            >
              <span>
                {portfolio.dayChange >= 0 ? "+" : ""}
                {money.format(portfolio.dayChange)}
              </span>
              <span>{signedPercent(portfolio.dayChangePercent)} today</span>
            </div>
          ) : (
            <p className="portfolio-empty">
              Connect a brokerage account to load holdings.
            </p>
          )}
          <small>{portfolio?.updatedLabel ?? "No brokerage data"}</small>
        </article>
        <article className="surface buying-power-card">
          <p>Buying power</p>
          <strong>
            {portfolio ? money.format(portfolio.buyingPower) : "—"}
          </strong>
          <span>Available cash</span>
        </article>
        <ConnectionPanel
          cloudConnected={cloudConnected}
          brokerConnection={brokerConnection}
          brokerIsMock={brokerIsMock}
          brokerLabel={brokerLabel}
          authorizationUrl={authorizationUrl}
          demoMode={demoMode}
          isLoading={isLoading}
          connectionBusy={connectionBusy}
          connectionNeedsAttention={connectionNeedsAttention}
          refreshBusy={refreshBusy}
          onToggleConnection={onToggleConnection}
          onDismissAuthorization={onDismissAuthorization}
          onRefresh={onRefresh}
        />
      </section>

      <ApprovalQueue
        proposals={proposals}
        demoMode={demoMode}
        decisionBusyId={decisionBusyId}
        onDecision={onDecision}
      />

      <section className="dashboard-section" aria-labelledby="positions-title">
        <div className="section-title-row dashboard-section-heading">
          <div>
            <p className="section-kicker">Holdings</p>
            <h2 id="positions-title">Positions</h2>
          </div>
          <span className="count-badge">{positions.length}</span>
        </div>
        <div className="surface positions-card">
          {positions.length === 0 ? (
            <div className="empty-state-card position-empty">
              <strong>No positions available</strong>
              <p>Your connected portfolio will appear here.</p>
            </div>
          ) : (
            <div className="position-list">
              {positions.map((position) => (
                <article className="position-row" key={position.symbol}>
                  <div className="ticker-mark" aria-hidden="true">
                    {position.symbol.slice(0, 1)}
                  </div>
                  <div className="position-identity">
                    <strong>{position.symbol}</strong>
                    <span>{position.name ?? "Equity position"}</span>
                  </div>
                  <div className="position-quantity">
                    <span>{position.quantity} shares</span>
                    <Change value={position.dayChangePercent} />
                  </div>
                  <strong className="position-value">
                    {money.format(position.marketValue)}
                  </strong>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

export function ActivityView({
  proposals,
  demoMode = false,
  decisionBusyId = null,
  onDecision,
}: Pick<
  TradingDashboardProps,
  "proposals" | "demoMode" | "decisionBusyId" | "onDecision"
>) {
  return (
    <main className="dashboard activity-page" aria-labelledby="activity-title">
      <header className="dashboard-heading">
        <div>
          <p className="page-kicker">Review queue</p>
          <h1 id="activity-title">Trade activity</h1>
        </div>
      </header>
      <ApprovalQueue
        proposals={proposals}
        demoMode={demoMode}
        decisionBusyId={decisionBusyId}
        onDecision={onDecision}
        title="Proposals and decisions"
      />
    </main>
  );
}
