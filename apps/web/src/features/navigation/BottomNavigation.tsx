import { NavLink, useLocation } from "react-router-dom";

function OverviewIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z" />
    </svg>
  );
}

function AskIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5.5h14v10H9l-4 3v-13Z" />
      <path d="M9 10h6M12 7v6" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19V9m7 10V5m7 14v-7" />
    </svg>
  );
}

export function BottomNavigation() {
  const location = useLocation();
  const askActive =
    location.pathname === "/ask" || location.pathname.startsWith("/threads/");
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      <NavLink to="/" end>
        <OverviewIcon />
        <span>Overview</span>
      </NavLink>
      <NavLink className={askActive ? "active" : undefined} to="/ask">
        <AskIcon />
        <span>Ask Signal</span>
      </NavLink>
      <NavLink to="/activity">
        <ActivityIcon />
        <span>Activity</span>
      </NavLink>
    </nav>
  );
}

export function DesktopNavigation() {
  const location = useLocation();
  const askActive =
    location.pathname === "/ask" || location.pathname.startsWith("/threads/");
  return (
    <nav className="desktop-nav" aria-label="Primary navigation">
      <NavLink to="/" end>
        Overview
      </NavLink>
      <NavLink className={askActive ? "active" : undefined} to="/ask">
        Ask Signal
      </NavLink>
      <NavLink to="/activity">Activity</NavLink>
    </nav>
  );
}
