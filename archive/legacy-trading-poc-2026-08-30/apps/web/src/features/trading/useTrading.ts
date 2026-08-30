import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { publicApi } from "../../convex/functions";
import { toTradingDashboardModel, type TradingDashboardModel } from "./model";
import { safeRobinhoodAuthorizationUrl } from "./robinhoodAuthorization";

export type TradingOperation =
  | "connecting"
  | "disconnecting"
  | "refreshing"
  | "approving"
  | "rejecting";

export interface TradingController {
  dashboard: TradingDashboardModel;
  authorizationUrl: string | null;
  decisionBusyId: string | null;
  error: string | null;
  isLoading: boolean;
  operation: TradingOperation | null;
  clearError(): void;
  decide(proposalId: string, decision: "approve" | "reject"): Promise<void>;
  dismissAuthorization(): void;
  refresh(): Promise<void>;
  toggleConnection(): Promise<void>;
}

export function useTrading(): TradingController {
  const dashboardResult = useQuery(publicApi.trading.getDashboard, {});
  const startConnection = useAction(publicApi.trading.startRobinhoodConnection);
  const disconnectRobinhood = useAction(publicApi.trading.disconnectRobinhood);
  const refreshPortfolio = useAction(publicApi.trading.refreshPortfolio);
  const approveProposal = useAction(publicApi.trading.approveProposal);
  const rejectProposal = useMutation(publicApi.trading.rejectProposal);
  const [operation, setOperation] = useState<TradingOperation | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [decisionBusyId, setDecisionBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dashboard = useMemo(
    () => toTradingDashboardModel(dashboardResult),
    [dashboardResult],
  );

  const clearError = useCallback(() => setError(null), []);
  const dismissAuthorization = useCallback(() => setAuthorizationUrl(null), []);

  useEffect(() => {
    if (dashboard.brokerConnection === "connected") {
      setAuthorizationUrl(null);
    }
  }, [dashboard.brokerConnection]);

  const refresh = useCallback(async (): Promise<void> => {
    if (operation) return;
    setError(null);
    setOperation("refreshing");
    try {
      await refreshPortfolio({});
    } catch {
      setError("Signal could not refresh the Robinhood portfolio. Try again.");
    } finally {
      setOperation(null);
    }
  }, [operation, refreshPortfolio]);

  const toggleConnection = useCallback(async (): Promise<void> => {
    if (operation) return;
    setError(null);
    if (dashboard.brokerConnection === "connected") {
      setAuthorizationUrl(null);
      setOperation("disconnecting");
      try {
        await disconnectRobinhood({});
      } catch {
        setError("Signal could not disconnect Robinhood. Try again.");
      } finally {
        setOperation(null);
      }
      return;
    }

    setOperation("connecting");
    setAuthorizationUrl(null);
    try {
      const result = await startConnection({});
      if (result.status === "authorization_required") {
        const safeUrl = safeRobinhoodAuthorizationUrl(result.authorizationUrl);
        if (!safeUrl) {
          throw new Error("Robinhood returned an invalid authorization URL.");
        }
        setAuthorizationUrl(safeUrl);
        return;
      }
      if (result.status === "connected") {
        setAuthorizationUrl(null);
        await refreshPortfolio({});
      }
    } catch {
      setError("Signal could not start the Robinhood connection. Try again.");
    } finally {
      setOperation(null);
    }
  }, [
    dashboard.brokerConnection,
    disconnectRobinhood,
    operation,
    refreshPortfolio,
    startConnection,
  ]);

  const decide = useCallback(
    async (
      proposalId: string,
      decision: "approve" | "reject",
    ): Promise<void> => {
      if (operation) return;
      const proposal = dashboardResult?.proposals.find(
        (candidate) => candidate.stableId === proposalId,
      );
      if (!proposal) {
        setError("This trade proposal is no longer available.");
        return;
      }
      setError(null);
      setDecisionBusyId(proposalId);
      setOperation(decision === "approve" ? "approving" : "rejecting");
      try {
        if (decision === "approve") {
          const result = await approveProposal({
            proposalId,
            fingerprint: proposal.fingerprint,
          });
          if (result.status === "failed") {
            setError("Robinhood did not accept the approved order.");
          }
        } else {
          await rejectProposal({
            proposalId,
            fingerprint: proposal.fingerprint,
          });
        }
      } catch {
        setError(
          decision === "approve"
            ? "Signal could not submit the approved order. Review its status before you try again."
            : "Signal could not reject the trade proposal. Try again.",
        );
      } finally {
        setDecisionBusyId(null);
        setOperation(null);
      }
    },
    [approveProposal, dashboardResult, operation, rejectProposal],
  );

  return {
    dashboard,
    authorizationUrl,
    decisionBusyId,
    error,
    isLoading: dashboardResult === undefined,
    operation,
    clearError,
    decide,
    dismissAuthorization,
    refresh,
    toggleConnection,
  };
}
