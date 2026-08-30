import { usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { CommandUncertainError, useCommands } from "../../commands/useCommands";
import { publicApi } from "../../convex/functions";
import { Composer } from "../composer/Composer";
import { MessageList } from "../messages/MessageList";
import { useActiveRun } from "../messages/useActiveRun";

export function ThreadWorkspace() {
  const rawThreadId = useParams().threadId;
  const threadId = rawThreadId ? decodeURIComponent(rawThreadId) : "";
  const thread = useQuery(
    publicApi.threads.get,
    threadId ? { threadId } : "skip",
  );
  const activeRun = useActiveRun(threadId);
  const { results, status, loadMore } = usePaginatedQuery(
    publicApi.messages.listPage,
    { threadId },
    { initialNumItems: 40 },
  );
  const { retryRun } = useCommands();
  const [retryError, setRetryError] = useState<string | null>(null);

  if (!threadId) return <Navigate to="/ask" replace />;
  if (
    thread === undefined ||
    activeRun === undefined ||
    status === "LoadingFirstPage"
  ) {
    return (
      <main className="workspace-body">
        <div className="loading" role="status">
          <span aria-hidden="true" />
          Loading conversation…
        </div>
      </main>
    );
  }
  if (thread === null) {
    return (
      <main className="workspace-body">
        <section className="empty">
          <h1>Conversation not found</h1>
          <p>It may be archived, or your account may not have access.</p>
        </section>
      </main>
    );
  }
  const lastFailed = results.find(
    (message) =>
      message.role === "assistant" &&
      (message.status === "failed" || message.status === "canceled") &&
      message.runId,
  );
  async function retry() {
    if (!lastFailed?.runId) return;
    setRetryError(null);
    try {
      await retryRun(lastFailed.runId);
    } catch (error) {
      setRetryError(
        error instanceof CommandUncertainError
          ? error.message
          : "Signal could not start the retry.",
      );
    }
  }
  return (
    <>
      <main
        className="workspace-body workspace-body--with-composer"
        aria-labelledby="thread-title"
      >
        <header className="thread-header">
          <div>
            <span>Conversation</span>
            <h1 id="thread-title">{thread.title}</h1>
          </div>
        </header>
        <section
          className="messages"
          role="log"
          aria-label="Conversation messages"
          aria-live="polite"
        >
          {status === "CanLoadMore" && (
            <button
              className="load-older"
              type="button"
              onClick={() => loadMore(40)}
            >
              Load older messages
            </button>
          )}
          {status === "LoadingMore" && (
            <p className="loading-inline" role="status">
              Loading older messages…
            </p>
          )}
          <MessageList
            messages={[...results].reverse()}
            activeRun={activeRun}
          />
          {lastFailed && !activeRun && (
            <div className="retry-row">
              <button type="button" onClick={() => void retry()}>
                Retry with a new run
              </button>
              {retryError && <span role="alert">{retryError}</span>}
            </div>
          )}
        </section>
      </main>
      <Composer key={threadId} threadId={threadId} activeRun={activeRun} />
    </>
  );
}
