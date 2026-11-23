import type { ConnectionStatus } from "../dashboard/TradingDashboard";
import { RobinhoodHandoff } from "./RobinhoodHandoff";
import { useTrading, type TradingOperation } from "./useTrading";

export interface RobinhoodMcpPanelViewProps {
  status: ConnectionStatus;
  label: string;
  isMock: boolean;
  isLoading: boolean;
  operation: TradingOperation | null;
  authorizationUrl: string | null;
  error: string | null;
  onToggleConnection(): void;
  onCompleteAuthorization(callbackUrl: string): Promise<void>;
  onDismissAuthorization(): void;
}

function statusBadgeLabel(
  status: ConnectionStatus,
  isLoading: boolean,
  isMock: boolean,
): string {
  if (isLoading) return "Checking…";
  if (status === "connected") {
    return isMock ? "Simulation connected" : "Connected";
  }
  if (status === "connecting") return "Connecting";
  if (status === "reauth_required") return "Reconnect required";
  if (status === "error") return "Needs attention";
  return "Not connected";
}

function actionLabel(
  status: ConnectionStatus,
  operation: TradingOperation | null,
  isMock: boolean,
): string {
  if (operation === "connecting") return "Starting…";
  if (operation === "completing") return "Finishing…";
  if (operation === "disconnecting") return "Disconnecting…";
  if (status === "connected") {
    return isMock ? "Disconnect mock broker" : "Disconnect Robinhood";
  }
  if (status === "reauth_required") return "Reconnect Robinhood";
  return isMock ? "Connect mock broker" : "Connect Robinhood";
}

export function RobinhoodMcpPanelView({
  status,
  label,
  isMock,
  isLoading,
  operation,
  authorizationUrl,
  error,
  onToggleConnection,
  onCompleteAuthorization,
  onDismissAuthorization,
}: RobinhoodMcpPanelViewProps) {
  const connected = status === "connected";
  const busy =
    operation === "connecting" ||
    operation === "completing" ||
    operation === "disconnecting";

  return (
    <section
      className="broker-mcp-panel"
      aria-labelledby="robinhood-mcp-panel-title"
    >
      <div className="broker-mcp-header">
        <div>
          <p className="section-kicker">Robinhood MCP</p>
          <h4 id="robinhood-mcp-panel-title">{label}</h4>
          <p className="broker-mcp-copy">
            Read-only account, position, quote, and order tools load
            automatically for your user whenever Journal Chat or Chat starts a
            run.
          </p>
        </div>
        <div className="broker-mcp-controls">
          <span className="broker-mcp-status" data-status={status}>
            <span className="status-dot" data-online={connected} />
            <strong>{statusBadgeLabel(status, isLoading, isMock)}</strong>
          </span>
          <button
            className="secondary-action"
            type="button"
            disabled={busy || isLoading}
            onClick={onToggleConnection}
          >
            {actionLabel(status, operation, isMock)}
          </button>
        </div>
      </div>

      {status === "reauth_required" && !authorizationUrl && (
        <p className="connection-note connection-note--error" role="alert">
          Your Robinhood session expired. Reconnect Robinhood to keep live
          broker tools active in runs.
        </p>
      )}

      {error && !authorizationUrl && (
        <p className="connection-note connection-note--error" role="alert">
          {error}
        </p>
      )}

      {authorizationUrl && !isMock && (
        <RobinhoodHandoff
          authorizationUrl={authorizationUrl}
          onDismiss={onDismissAuthorization}
          onCompleteCallback={onCompleteAuthorization}
          completing={operation === "completing"}
          completionError={error}
        />
      )}
    </section>
  );
}

export function RobinhoodMcpPanel() {
  const trading = useTrading();
  return (
    <RobinhoodMcpPanelView
      status={trading.dashboard.brokerConnection}
      label={trading.dashboard.brokerLabel}
      isMock={trading.dashboard.brokerIsMock}
      isLoading={trading.isLoading}
      operation={trading.operation}
      authorizationUrl={trading.authorizationUrl}
      error={trading.error}
      onToggleConnection={() => void trading.toggleConnection()}
      onCompleteAuthorization={(callbackUrl) =>
        trading.completeAuthorization(callbackUrl)
      }
      onDismissAuthorization={trading.dismissAuthorization}
    />
  );
}
