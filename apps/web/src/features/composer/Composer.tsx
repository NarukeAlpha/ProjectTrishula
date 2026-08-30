import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { CommandUncertainError, useCommands } from "../../commands/useCommands";
import type { ActiveRunReadModel } from "../../convex/types";

function isActive(run: ActiveRunReadModel | null): run is ActiveRunReadModel {
  return (
    run !== null &&
    ["pending", "running", "cancellation_requested"].includes(run.run.status)
  );
}

export function Composer({
  threadId,
  activeRun,
}: {
  threadId?: string;
  activeRun: ActiveRunReadModel | null;
}) {
  const navigate = useNavigate();
  const { requestStop, submitPrompt } = useCommands();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const active = isActive(activeRun);
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const prompt = text.trim();
    if (!prompt || busy || active) return;
    setBusy(true);
    setError(null);
    try {
      const accepted = await submitPrompt(prompt, threadId);
      setText("");
      if (accepted.threadId)
        navigate(`/threads/${encodeURIComponent(accepted.threadId)}`);
    } catch (commandError) {
      setError(
        commandError instanceof CommandUncertainError
          ? commandError.message
          : "Trishula rejected the prompt. Review it and try again.",
      );
    } finally {
      setBusy(false);
      textarea.current?.focus();
    }
  }

  async function stop() {
    if (
      !threadId ||
      !activeRun ||
      busy ||
      activeRun.run.status === "cancellation_requested"
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await requestStop(activeRun.run.runId);
    } catch (commandError) {
      setError(
        commandError instanceof Error
          ? commandError.message
          : "Trishula could not confirm the stop command.",
      );
    } finally {
      setBusy(false);
    }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <div className="composer-wrap">
      <form className="composer" onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor="prompt">
          Ask Trishula
        </label>
        <textarea
          id="prompt"
          ref={textarea}
          rows={2}
          maxLength={10_000}
          placeholder="Ask about your portfolio or a trade idea…"
          value={text}
          disabled={busy || activeRun?.run.status === "cancellation_requested"}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={keyDown}
        />
        <div className="composer-footer">
          <div className="composer-status" aria-live="polite">
            {error ? (
              <span className="inline-error">{error}</span>
            ) : activeRun?.run.status === "cancellation_requested" ? (
              "Stopping this run…"
            ) : active ? (
              "Trishula is working…"
            ) : (
              "Enter to send · Shift + Enter for a new line"
            )}
          </div>
          {active ? (
            <button
              className="send-button"
              type="button"
              aria-label="Stop response"
              disabled={
                busy || activeRun.run.status === "cancellation_requested"
              }
              onClick={() => void stop()}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <rect x="6" y="6" width="8" height="8" rx="1.5" />
              </svg>
            </button>
          ) : (
            <button
              className="send-button"
              type="submit"
              aria-label="Send message"
              disabled={busy || !text.trim()}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M10 16V4m0 0L5.5 8.5M10 4l4.5 4.5" />
              </svg>
            </button>
          )}
        </div>
      </form>
      <p className="disclaimer">
        Trishula can make mistakes. Verify important market information.
      </p>
    </div>
  );
}
