import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { DemoRuntimeConfig } from "../config/runtime";
import type { MessageReadModel } from "../convex/types";
import { MessageList } from "../features/messages/MessageList";
import {
  ActivityView,
  TradingDashboard,
  type PortfolioSnapshot,
  type Position,
  type TradeProposal,
} from "../features/dashboard/TradingDashboard";
import {
  BottomNavigation,
  DesktopNavigation,
} from "../features/navigation/BottomNavigation";
import { Welcome } from "../features/threads/Welcome";

const demoPortfolio: PortfolioSnapshot = {
  totalValue: 27_846.2,
  buyingPower: 4_382.14,
  dayChange: 412.87,
  dayChangePercent: 1.5,
  updatedLabel: "Demo snapshot · 10:42 AM ET",
};

const demoPositions: Position[] = [
  {
    symbol: "NVDA",
    name: "NVIDIA",
    quantity: 14,
    marketValue: 8_731.38,
    dayChangePercent: 2.84,
  },
  {
    symbol: "AAPL",
    name: "Apple",
    quantity: 22,
    marketValue: 5_096.08,
    dayChangePercent: 0.72,
  },
  {
    symbol: "AMD",
    name: "Advanced Micro Devices",
    quantity: 18,
    marketValue: 3_121.92,
    dayChangePercent: -0.46,
  },
];

const initialProposals: TradeProposal[] = [
  {
    id: "proposal-nvda",
    side: "buy",
    symbol: "NVDA",
    quantity: 2,
    orderType: "limit",
    limitPrice: 134.2,
    estimatedTotal: 268.4,
    rationale: "Adds only if price pulls back to the defined support zone.",
    status: "pending",
  },
  {
    id: "proposal-amd",
    side: "sell",
    symbol: "AMD",
    quantity: 3,
    orderType: "market",
    estimatedTotal: 520.32,
    rationale:
      "Reduces concentration after the position crossed the demo risk limit.",
    status: "pending",
  },
];

function DemoHeader({ onReset }: { onReset: () => void }) {
  return (
    <header className="topbar demo-topbar">
      <div className="topbar-brand">
        <span className="brand-mark" aria-hidden="true">
          S
        </span>
        <div>
          <strong>Signal</strong>
          <span>Trading copilot</span>
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
          Ask Signal
        </label>
        <textarea
          id="prompt"
          ref={textarea}
          rows={2}
          maxLength={10_000}
          placeholder="Ask about your portfolio or a trade idea…"
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
      <p className="disclaimer">Demo only. Signal cannot place a real order.</p>
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
            <h1 id="demo-thread-title">Market plan</h1>
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
  const [brokerConnected, setBrokerConnected] = useState(true);
  const [proposals, setProposals] = useState(initialProposals);
  const [messages, setMessages] = useState<MessageReadModel[]>([]);

  function submitPrompt(prompt: string) {
    const sequence = nextMessage.current++;
    const timestamp = 1_770_000_000_000 + sequence;
    const reply = [
      "### Demo portfolio read",
      "",
      "Signal reviewed the local snapshot. NVDA has the strongest demo momentum, while AMD is the only position down today.",
      "",
      "A cautious next step is to wait for the defined NVDA limit price and keep the position size small. The approval card is a simulation, and no order can leave this browser.",
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
        stableId: `demo-signal-${sequence}`,
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

  function decide(proposalId: string, decision: "approve" | "reject") {
    setProposals((current) =>
      current.map((proposal) =>
        proposal.id === proposalId
          ? {
              ...proposal,
              status: decision === "approve" ? "approved" : "rejected",
            }
          : proposal,
      ),
    );
  }

  function reset() {
    nextMessage.current = 1;
    setBrokerConnected(true);
    setProposals(initialProposals);
    setMessages([]);
    navigate("/");
  }

  return (
    <div className="shell demo-shell" data-environment={config.environment}>
      <div className="workspace demo-workspace">
        <DemoHeader onReset={reset} />
        <Routes>
          <Route
            path="/"
            element={
              <TradingDashboard
                cloudConnected
                brokerConnection={
                  brokerConnected ? "connected" : "disconnected"
                }
                portfolio={brokerConnected ? demoPortfolio : null}
                positions={brokerConnected ? demoPositions : []}
                proposals={proposals}
                demoMode
                onToggleConnection={() =>
                  setBrokerConnected((connected) => !connected)
                }
                onDecision={decide}
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
            path="/activity"
            element={
              <ActivityView
                proposals={proposals}
                demoMode
                onDecision={decide}
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
