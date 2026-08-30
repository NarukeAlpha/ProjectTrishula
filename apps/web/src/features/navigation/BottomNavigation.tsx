import { NavLink, useLocation } from "react-router-dom";
import { isChatPathname } from "./routes";

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

export function BottomNavigation() {
  const location = useLocation();
  const askActive = isChatPathname(location.pathname);
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      <NavLink className={askActive ? "active" : undefined} to="/ask">
        <ChatIcon />
        <span>Chat</span>
      </NavLink>
      <NavLink to="/discord">
        <DiscordIcon />
        <span>Discord</span>
      </NavLink>
    </nav>
  );
}

export function DesktopNavigation() {
  const location = useLocation();
  const askActive = isChatPathname(location.pathname);
  return (
    <nav className="desktop-nav" aria-label="Primary navigation">
      <NavLink className={askActive ? "active" : undefined} to="/ask">
        Chat
      </NavLink>
      <NavLink to="/discord">Discord</NavLink>
    </nav>
  );
}
