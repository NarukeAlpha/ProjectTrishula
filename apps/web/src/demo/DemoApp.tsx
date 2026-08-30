import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { DemoRuntimeConfig } from "../config/runtime";
import type {
  DiscordControlPlaneReadModel,
  MessageReadModel,
} from "../convex/types";
import { DiscordControlView } from "../features/discord/DiscordControlPage";
import { MessageList } from "../features/messages/MessageList";
import {
  BottomNavigation,
  DesktopNavigation,
} from "../features/navigation/BottomNavigation";
import { Welcome } from "../features/threads/Welcome";

const demoDiscord: DiscordControlPlaneReadModel = {
  gateway: { status: "not_configured" },
  guilds: [],
};

function DemoHeader({ onReset }: { onReset: () => void }) {
  return (
    <header className="topbar demo-topbar">
      <div className="topbar-brand">
        <span className="brand-mark" aria-hidden="true">
          T
        </span>
        <div>
          <strong>Project Trishula</strong>
          <span>Market research agent</span>
        </div>
      </div>
      <DesktopNavigation />
      <div className="account">
        <span className="demo-chip">Demo mode</span>
        <button type="button" onClick={onReset}>
          Reset
        </button>
      </div>
    </header>
  );
}

function DemoComposer({ onSubmit }: { onSubmit: (prompt: string) => void }) {
  const [text, setText] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const prompt = text.trim();
    if (!prompt) return;
    onSubmit(prompt);
    setText("");
    textarea.current?.focus();
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="composer-wrap">
      <form className="composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="prompt">
          Ask Trishula
        </label>
        <textarea
          id="prompt"
          ref={textarea}
          rows={2}
          maxLength={10_000}
          placeholder="Ask about a market move or trade idea…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={keyDown}
        />
        <div className="composer-footer">
          <div className="composer-status" aria-live="polite">
            Demo replies use fixed local data.
          </div>
          <button
            className="send-button"
            type="submit"
            aria-label="Send message"
            disabled={!text.trim()}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 16V4m0 0L5.5 8.5M10 4l4.5 4.5" />
            </svg>
          </button>
        </div>
      </form>
      <p className="disclaimer">
        Demo only. Verify important market information.
      </p>
    </div>
  );
}

function DemoConversation({
  messages,
  onSubmit,
}: {
  messages: MessageReadModel[];
  onSubmit: (prompt: string) => void;
}) {
  return (
    <>
      <main
        className="workspace-body workspace-body--with-composer"
        aria-labelledby="demo-thread-title"
      >
        <header className="thread-header">
          <div>
            <span>Demo conversation</span>
            <h1 id="demo-thread-title">Market research</h1>
          </div>
        </header>
        <section
          className="messages"
          role="log"
          aria-label="Conversation messages"
          aria-live="polite"
        >
          <MessageList messages={messages} activeRun={null} />
        </section>
      </main>
      <DemoComposer onSubmit={onSubmit} />
    </>
  );
}

export function DemoApp({ config }: { config: DemoRuntimeConfig }) {
  const navigate = useNavigate();
  const nextMessage = useRef(1);
  const [messages, setMessages] = useState<MessageReadModel[]>([]);

  function submitPrompt(prompt: string) {
    const sequence = nextMessage.current++;
    const timestamp = 1_770_000_000_000 + sequence;
    const reply = [
      "### Demo research read",
      "",
      "Trishula reviewed the fixed local snapshot. NVDA has the strongest demo momentum, while AMD is the only position down today.",
      "",
      "A cautious next step is to wait for confirmation and define the invalidation before taking risk. This demo does not use live market data.",
    ].join("\n");
    setMessages((current) => [
      ...current,
      {
        stableId: `demo-user-${sequence}`,
        threadId: "demo-session",
        ordinal: current.length + 1,
        role: "user",
        status: "completed",
        text: prompt,
        parts: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        stableId: `demo-trishula-${sequence}`,
        threadId: "demo-session",
        ordinal: current.length + 2,
        role: "assistant",
        status: "completed",
        parts: [{ type: "text", text: reply }],
        createdAt: timestamp + 1,
        updatedAt: timestamp + 1,
      },
    ]);
    navigate("/threads/demo-session");
  }

  function reset() {
    nextMessage.current = 1;
    setMessages([]);
    navigate("/ask");
  }

  return (
    <div className="shell demo-shell" data-environment={config.environment}>
      <div className="workspace demo-workspace workspace--full">
        <DemoHeader onReset={reset} />
        <Routes>
          <Route path="/" element={<Navigate to="/ask" replace />} />
          <Route
            path="/ask"
            element={
              <>
                <main className="workspace-body workspace-body--with-composer">
                  <Welcome />
                </main>
                <DemoComposer onSubmit={submitPrompt} />
              </>
            }
          />
          <Route
            path="/threads/:threadId"
            element={
              <DemoConversation messages={messages} onSubmit={submitPrompt} />
            }
          />
          <Route
            path="/discord"
            element={
              <DiscordControlView
                applicationId={config.discordApplicationId}
                model={demoDiscord}
                onSetChannelRoles={() => Promise.resolve()}
              />
            }
          />
          <Route path="*" element={<Navigate to="/ask" replace />} />
        </Routes>
        <BottomNavigation />
      </div>
    </div>
  );
}
