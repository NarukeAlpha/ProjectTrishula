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
  BottomNavigation,
  DesktopNavigation,
} from "../features/navigation/BottomNavigation";
import { isChatPathname } from "../features/navigation/routes";
import { ThreadSidebar } from "../features/threads/ThreadSidebar";
import { Welcome } from "../features/threads/Welcome";
import { AuthStage } from "./AuthStage";
import { RecoveryBanner } from "./RecoveryBanner";

const ThreadWorkspace = lazy(() =>
  import("../features/threads/ThreadWorkspace").then((module) => ({
    default: module.ThreadWorkspace,
  })),
);

const DiscordControlPage = lazy(() =>
  import("../features/discord/DiscordControlPage").then((module) => ({
    default: module.DiscordControlPage,
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
          T
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isChatRoute = isChatPathname(location.pathname);
  const reconnecting =
    connection.hasEverConnected && !connection.isWebSocketConnected;
  return (
    <div className="shell" data-section={isChatRoute ? "chat" : "discord"}>
      <KeyboardShortcuts />
      {isChatRoute && (
        <ThreadSidebar
          mobileOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      )}
      <div
        className={`workspace ${isChatRoute ? "workspace--chat" : "workspace--full"}`}
      >
        <header className="topbar">
          {isChatRoute && (
            <button
              className="icon-button sidebar-toggle"
              type="button"
              aria-label="Open conversation history"
              onClick={() => setSidebarOpen(true)}
            >
              ☰
            </button>
          )}
          <div className="topbar-brand">
            <span className="brand-mark" aria-hidden="true">
              T
            </span>
            <div>
              <strong>Project Trishula</strong>
              <span>
                {config.environment !== "production"
                  ? config.environment
                  : "Market research agent"}
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
            Connection interrupted. Trishula is showing the last confirmed state
            while it reconnects…
          </div>
        )}
        {isChatRoute && <RecoveryBanner key={location.key} />}
        <Routes>
          <Route path="/" element={<Navigate to="/ask" replace />} />
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
            path="/discord"
            element={
              <Suspense
                fallback={
                  <main className="discord-page">
                    <div className="loading">Loading Discord control…</div>
                  </main>
                }
              >
                <DiscordControlPage
                  applicationId={config.discordApplicationId}
                />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/ask" replace />} />
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
  return <ProtectedApp config={config} />;
}
