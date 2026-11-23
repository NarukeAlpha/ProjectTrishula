import { useAuth } from "@workos-inc/authkit-react";
import { useConvexAuth } from "convex/react";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
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
  PrimaryRail,
} from "../features/navigation/BottomNavigation";
import {
  isChatPathname,
  journalPages,
  tradeReviewsPage,
  type JournalSection,
} from "../features/navigation/routes";
import { ThreadSidebar } from "../features/threads/ThreadSidebar";
import { Welcome } from "../features/threads/Welcome";
import { AuthStage } from "./AuthStage";
import { RecoveryBanner } from "./RecoveryBanner";

const JournalPage = lazy(() =>
  import("../features/journal/JournalPage").then((module) => ({
    default: module.JournalPage,
  })),
);

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

export function AppShell({
  subtitle,
  userLabel,
  userTitle,
  onSignOut,
  reconnecting = false,
  renderThreadSidebar,
  renderRecoveryBanner,
  renderJournalPage,
  askElement,
  threadElement,
  discordElement,
}: {
  subtitle: string;
  userLabel: string;
  userTitle?: string;
  onSignOut: () => void;
  reconnecting?: boolean;
  renderThreadSidebar: (props: {
    mobileOpen: boolean;
    onClose: () => void;
  }) => ReactNode;
  renderRecoveryBanner?: (locationKey: string) => ReactNode;
  renderJournalPage: (section: JournalSection) => ReactNode;
  askElement: ReactNode;
  threadElement: ReactNode;
  discordElement: ReactNode;
}) {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isChatRoute = isChatPathname(location.pathname);

  return (
    <div className="shell">
      <KeyboardShortcuts />
      <PrimaryRail
        subtitle={subtitle}
        footer={
          <div className="rail-account">
            <span className="rail-user" title={userTitle}>
              {userLabel}
            </span>
            <button type="button" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        }
      />
      {isChatRoute &&
        renderThreadSidebar({
          mobileOpen: sidebarOpen,
          onClose: () => setSidebarOpen(false),
        })}
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
              <span>{subtitle}</span>
            </div>
          </div>
          <div className="account">
            <span title={userTitle}>{userLabel}</span>
            <button type="button" onClick={onSignOut}>
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
        {isChatRoute && renderRecoveryBanner?.(location.key)}
        <Routes>
          {journalPages.map((section) => (
            <Route
              key={section.path}
              path={section.path}
              element={renderJournalPage(section)}
            />
          ))}
          <Route path="/ask" element={askElement} />
          <Route path="/threads/:threadId" element={threadElement} />
          <Route path="/discord" element={discordElement} />
          <Route
            path="*"
            element={<Navigate to={tradeReviewsPage.path} replace />}
          />
        </Routes>
        <BottomNavigation />
      </div>
    </div>
  );
}

function AuthenticatedApp({ config }: { config: ProductionRuntimeConfig }) {
  const { user, signOut } = useAuth();
  const connection = useConnectionState();
  const reconnecting =
    connection.hasEverConnected && !connection.isWebSocketConnected;
  const subtitle =
    config.environment !== "production"
      ? config.environment
      : "Trading journal & research";
  const userLabel =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.email ||
    "Account";

  return (
    <AppShell
      subtitle={subtitle}
      userLabel={userLabel}
      userTitle={user?.email}
      onSignOut={() => signOut({ returnTo: window.location.origin })}
      reconnecting={reconnecting}
      renderThreadSidebar={({ mobileOpen, onClose }) => (
        <ThreadSidebar mobileOpen={mobileOpen} onClose={onClose} />
      )}
      renderRecoveryBanner={(locationKey) => (
        <RecoveryBanner key={locationKey} />
      )}
      renderJournalPage={(section) => (
        <Suspense
          fallback={
            <main className="workspace-body">
              <div className="loading">Loading {section.title}…</div>
            </main>
          }
        >
          <JournalPage key={section.path} section={section} />
        </Suspense>
      )}
      askElement={
        <>
          <main className="workspace-body workspace-body--with-composer">
            <Welcome />
          </main>
          <Composer activeRun={null} />
        </>
      }
      threadElement={
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
      discordElement={
        <Suspense
          fallback={
            <main className="discord-page">
              <div className="loading">Loading Discord control…</div>
            </main>
          }
        >
          <DiscordControlPage applicationId={config.discordApplicationId} />
        </Suspense>
      }
    />
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
