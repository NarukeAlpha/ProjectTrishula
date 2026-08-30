import { useAuth } from "@workos-inc/authkit-react";
import { useConvexAuth } from "convex/react";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type { ProductionRuntimeConfig } from "../config/runtime";
import { useConnectionState } from "../convex/client";
import { Composer } from "../features/composer/Composer";
import {
  ActivityView,
  TradingDashboard,
} from "../features/dashboard/TradingDashboard";
import {
  BottomNavigation,
  DesktopNavigation,
} from "../features/navigation/BottomNavigation";
import {
  BrokerReturnPage,
  LegacyBrokerCallback,
} from "../features/trading/BrokerReturn";
import { useTrading } from "../features/trading/useTrading";
import { ThreadSidebar } from "../features/threads/ThreadSidebar";
import { Welcome } from "../features/threads/Welcome";
import { AuthStage } from "./AuthStage";
import { RecoveryBanner } from "./RecoveryBanner";

const ThreadWorkspace = lazy(() =>
  import("../features/threads/ThreadWorkspace").then((module) => ({
    default: module.ThreadWorkspace,
  })),
);

function KeyboardShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        navigate("/ask");
        window.setTimeout(
          () => document.querySelector<HTMLTextAreaElement>("#prompt")?.focus(),
          0,
        );
      }
    };
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, [navigate]);
  return null;
}

function WorkOSLoginRoute() {
  const { signIn } = useAuth();
  useEffect(() => {
    void signIn();
  }, [signIn]);
  return (
    <main className="auth-stage">
      <section className="auth-card" role="status">
        <div className="auth-mark" aria-hidden="true">
          S
        </div>
        <h1>Opening secure sign-in…</h1>
      </section>
    </main>
  );
}

function AuthenticatedApp({ config }: { config: ProductionRuntimeConfig }) {
  const { user, signOut } = useAuth();
  const connection = useConnectionState();
  const location = useLocation();
  const trading = useTrading();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const reconnecting =
    connection.hasEverConnected && !connection.isWebSocketConnected;
  const connectionBusy =
    trading.operation === "connecting" || trading.operation === "disconnecting";
  return (
    <div className="shell">
      <KeyboardShortcuts />
      <ThreadSidebar
        mobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-button sidebar-toggle"
            type="button"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>
          <div className="topbar-brand">
            <span className="brand-mark" aria-hidden="true">
              S
            </span>
            <div>
              <strong>Signal</strong>
              <span>
                {config.environment !== "production"
                  ? config.environment
                  : "Trading copilot"}
              </span>
            </div>
          </div>
          <DesktopNavigation />
          <div className="account">
            <span title={user?.email}>
              {[user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
                user?.email}
            </span>
            <button
              type="button"
              onClick={() => signOut({ returnTo: window.location.origin })}
            >
              Sign out
            </button>
          </div>
        </header>
        {reconnecting && (
          <div className="connection-banner" role="status">
            Connection interrupted. Signal is showing the last confirmed state
            while it reconnects…
          </div>
        )}
        {trading.error && (
          <div className="notice warning notice-with-action" role="alert">
            <span>{trading.error}</span>
            <button type="button" onClick={trading.clearError}>
              Dismiss
            </button>
          </div>
        )}
        <RecoveryBanner key={location.key} />
        <Routes>
          <Route
            path="/"
            element={
              <TradingDashboard
                cloudConnected={connection.isWebSocketConnected}
                brokerConnection={trading.dashboard.brokerConnection}
                brokerIsMock={trading.dashboard.brokerIsMock}
                brokerLabel={trading.dashboard.brokerLabel}
                authorizationUrl={trading.authorizationUrl}
                portfolio={trading.dashboard.portfolio}
                positions={trading.dashboard.positions}
                proposals={trading.dashboard.proposals}
                isLoading={trading.isLoading}
                connectionBusy={connectionBusy}
                connectionNeedsAttention={
                  trading.dashboard.connectionNeedsAttention
                }
                decisionBusyId={trading.decisionBusyId}
                refreshBusy={trading.operation === "refreshing"}
                onToggleConnection={() => void trading.toggleConnection()}
                onDismissAuthorization={trading.dismissAuthorization}
                onRefresh={() => void trading.refresh()}
                onDecision={(proposalId, decision) =>
                  void trading.decide(proposalId, decision)
                }
              />
            }
          />
          <Route
            path="/ask"
            element={
              <>
                <main className="workspace-body workspace-body--with-composer">
                  <Welcome />
                </main>
                <Composer activeRun={null} />
              </>
            }
          />
          <Route
            path="/threads/:threadId"
            element={
              <Suspense
                fallback={
                  <main className="workspace-body">
                    <div className="loading">Loading conversation…</div>
                  </main>
                }
              >
                <ThreadWorkspace />
              </Suspense>
            }
          />
          <Route
            path="/activity"
            element={
              <ActivityView
                proposals={trading.dashboard.proposals}
                decisionBusyId={trading.decisionBusyId}
                onDecision={(proposalId, decision) =>
                  void trading.decide(proposalId, decision)
                }
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <BottomNavigation />
      </div>
    </div>
  );
}

function ProtectedApp({ config }: { config: ProductionRuntimeConfig }) {
  const { user, isLoading } = useAuth();
  const convexAuth = useConvexAuth();
  if (window.location.pathname === "/login") return <WorkOSLoginRoute />;
  if (isLoading || !user || convexAuth.isLoading || !convexAuth.isAuthenticated)
    return <AuthStage />;
  return <AuthenticatedApp config={config} />;
}

export function App({ config }: { config: ProductionRuntimeConfig }) {
  const location = useLocation();
  if (location.pathname === "/broker/connected") {
    return <BrokerReturnPage result="connected" />;
  }
  if (location.pathname === "/broker/failed") {
    return <BrokerReturnPage result="failed" />;
  }
  if (location.pathname === "/broker/callback") {
    return <LegacyBrokerCallback />;
  }
  return <ProtectedApp config={config} />;
}
