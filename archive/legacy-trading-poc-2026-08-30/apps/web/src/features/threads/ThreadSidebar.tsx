import { usePaginatedQuery } from "convex/react";
import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useCommands } from "../../commands/useCommands";
import { publicApi } from "../../convex/functions";
import type { ThreadSummary } from "../../convex/types";
import { formatAge } from "../../shared/formatting/values";

function groupThreads(threads: ThreadSummary[]) {
  const groups = new Map<string, ThreadSummary[]>();
  for (const thread of threads) {
    const days = (Date.now() - thread.updatedAt) / 86_400_000;
    const label =
      days < 1
        ? "Today"
        : days < 7
          ? "Previous 7 days"
          : days < 30
            ? "Previous 30 days"
            : "Older";
    groups.set(label, [...(groups.get(label) ?? []), thread]);
  }
  return groups;
}

export function ThreadSidebar({
  mobileOpen,
  onClose,
}: {
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { archiveThread, renameThread } = useCommands();
  const [busyId, setBusyId] = useState<string | null>(null);
  const { results, status, loadMore } = usePaginatedQuery(
    publicApi.threads.list,
    {},
    { initialNumItems: 30 },
  );
  const groups = groupThreads(results);

  async function rename(thread: ThreadSummary) {
    const title = window.prompt("Rename conversation", thread.title)?.trim();
    if (!title || title === thread.title) return;
    setBusyId(thread.stableId);
    try {
      await renameThread(thread.stableId, title);
    } finally {
      setBusyId(null);
    }
  }

  async function archive(threadId: string) {
    setBusyId(threadId);
    try {
      await archiveThread(threadId);
      navigate("/ask");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <button
        className="sidebar-scrim"
        aria-label="Close navigation"
        type="button"
        hidden={!mobileOpen}
        onClick={onClose}
      />
      <aside className="sidebar" data-open={mobileOpen}>
        <div className="brand-row">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              S
            </div>
            <div>
              <strong>Signal</strong>
              <span>Trading copilot</span>
            </div>
          </div>
          <button
            className="icon-button sidebar-close"
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <button
          className="new-chat"
          type="button"
          onClick={() => {
            navigate("/ask");
            onClose();
          }}
        >
          <span aria-hidden="true">＋</span>
          <span>Ask Signal</span>
          <kbd>⌘ K</kbd>
        </button>
        <section className="thread-panel" aria-labelledby="threads-title">
          <div className="section-heading">
            <h2 id="threads-title">Chats</h2>
          </div>
          {status === "LoadingFirstPage" && (
            <p className="thread-state" role="status">
              Loading conversations…
            </p>
          )}
          {results.length === 0 && status !== "LoadingFirstPage" && (
            <p className="thread-state">No conversations yet.</p>
          )}
          <nav className="thread-list" aria-label="Conversation history">
            {[...groups].map(([label, threads]) => (
              <section className="thread-group" key={label}>
                <h3>{label}</h3>
                {threads.map((thread) => (
                  <div className="thread-row" key={thread.stableId}>
                    <NavLink
                      className="thread-select"
                      to={`/threads/${encodeURIComponent(thread.stableId)}`}
                      onClick={onClose}
                    >
                      <strong>{thread.title}</strong>
                      <span>{formatAge(thread.updatedAt)}</span>
                    </NavLink>
                    <details className="thread-menu">
                      <summary aria-label={`Actions for ${thread.title}`}>
                        •••
                      </summary>
                      <div>
                        <button
                          type="button"
                          disabled={busyId === thread.stableId}
                          onClick={() => void rename(thread)}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          disabled={busyId === thread.stableId}
                          onClick={() => void archive(thread.stableId)}
                        >
                          Archive
                        </button>
                      </div>
                    </details>
                  </div>
                ))}
              </section>
            ))}
            {status === "CanLoadMore" && (
              <button
                className="load-more"
                type="button"
                onClick={() => loadMore(30)}
              >
                Load more
              </button>
            )}
            {status === "LoadingMore" && (
              <p className="thread-state" role="status">
                Loading more…
              </p>
            )}
          </nav>
        </section>
      </aside>
    </>
  );
}
