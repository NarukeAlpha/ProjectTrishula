import { useId, useState, type ReactNode } from "react";
import { Link, matchPath, useLocation } from "react-router-dom";
import { isChatPathname, lessonsPage, tradeReviewsPage } from "./routes";

function TradeReviewsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4v15.5h16M7 14l4-5 4 3 5-7" />
    </svg>
  );
}

function LessonsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4.5h11a3 3 0 0 1 3 3v12H8a3 3 0 0 0-3 3v-18Z" />
      <path d="M8 9h7M8 13h5" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5.5h14v10H9l-4 3v-13Z" />
      <path d="M9 10h6M12 7v6" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 8.5a10 10 0 0 1 8 0M7 17c2 1 3.5 1.5 5 1.5s3-.5 5-1.5l2-7.5-3-1.7M8 7.8 5 9.5 7 17" />
      <path d="M9 13h.01M15 13h.01" />
    </svg>
  );
}

const destinations = [
  { ...tradeReviewsPage, Icon: TradeReviewsIcon },
  { ...lessonsPage, Icon: LessonsIcon },
  { path: "/ask", title: "Chat", Icon: ChatIcon },
  { path: "/discord", title: "Discord", Icon: DiscordIcon },
];

function PrimaryNavigation({ className }: { className: string }) {
  const { pathname } = useLocation();
  return (
    <nav className={className} aria-label="Primary navigation">
      {destinations.map(({ path, title, Icon }) => {
        const active =
          matchPath(path, pathname) ||
          (path === "/ask" && isChatPathname(pathname));
        return (
          <Link
            key={path}
            to={path}
            className={active ? "active" : undefined}
            aria-current={active ? "page" : undefined}
          >
            <Icon />
            <span>{title}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNavigation() {
  return <PrimaryNavigation className="bottom-nav" />;
}

export function DesktopNavigation() {
  return <PrimaryNavigation className="desktop-nav" />;
}

export function PrimaryRail({
  subtitle,
  footer,
}: {
  subtitle: string;
  footer: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const panelId = useId();
  const toggleLabel = expanded ? "Collapse sidebar" : "Expand sidebar";
  return (
    <aside
      className="primary-rail"
      aria-label="Trishula navigation"
      data-collapsed={!expanded || undefined}
    >
      <button
        type="button"
        className="rail-edge-toggle"
        aria-controls={panelId}
        aria-expanded={expanded}
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={() => setExpanded(!expanded)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d={expanded ? "m10 4-4 4 4 4" : "m6 4 4 4-4 4"} />
        </svg>
      </button>
      <div className="rail-panel" id={panelId} hidden={!expanded}>
        <div className="rail-brand">
          <span className="brand-mark" aria-hidden="true">
            T
          </span>
          <div>
            <strong>Project Trishula</strong>
            <span>{subtitle}</span>
          </div>
        </div>
        <DesktopNavigation />
        <div className="rail-footer">{footer}</div>
      </div>
    </aside>
  );
}
