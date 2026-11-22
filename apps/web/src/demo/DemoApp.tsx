import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { DemoRuntimeConfig } from "../config/runtime";
import type {
  DiscordControlPlaneReadModel,
  JournalChatMessageReadModel,
  JournalDiaryReadModel,
  MessageReadModel,
} from "../convex/types";
import { DiscordControlView } from "../features/discord/DiscordControlPage";
import { JournalWorkspaceView } from "../features/journal/JournalPage";
import { MessageList } from "../features/messages/MessageList";
import {
  BottomNavigation,
  PrimaryRail,
} from "../features/navigation/BottomNavigation";
import { Welcome } from "../features/threads/Welcome";

const demoDiscord: DiscordControlPlaneReadModel = {
  gateway: {
    status: "online",
    botUserName: "Trishula",
    lastHeartbeatAt: Date.now(),
  },
  activity: [
    {
      eventId: "demo-run:researching",
      guildId: "demo-stardust",
      channelId: "demo-testing-bot",
      runId: "demo-run",
      eventType: "stage_changed",
      stage: "researching",
      createdAt: Date.now() - 4_000,
    },
    {
      eventId: "demo-run:ack:sent",
      guildId: "demo-stardust",
      channelId: "demo-testing-bot",
      runId: "demo-run",
      eventType: "reply_sent",
      replyKind: "acknowledgement",
      createdAt: Date.now() - 7_000,
    },
    {
      eventId: "demo-message:received",
      guildId: "demo-stardust",
      channelId: "demo-testing-bot",
      eventType: "message_received",
      createdAt: Date.now() - 10_000,
    },
  ],
  guilds: [
    {
      guildId: "demo-stardust",
      name: "Stardust",
      permissions: {
        viewChannels: true,
        sendMessages: true,
        readMessageHistory: true,
        messageContent: true,
      },
      conversation: {
        conversationId: "discord:demo-stardust",
        epoch: 1,
        revision: 8,
        humanRevision: 5,
        personalityVersion: "trishula-discord-v1",
        models: {
          luna: {
            model: "gpt-5.6-luna",
            reasoningEffort: "xhigh",
            serviceTier: "priority",
          },
          sol: {
            model: "gpt-6-astra",
            reasoningEffort: "max",
            serviceTier: "priority",
          },
        },
        lastSuccessfulActivityAt: Date.now() - 60_000,
      },
      channels: [
        {
          channelId: "demo-testing-bot",
          name: "testing-bot",
          type: "text",
          canView: true,
          canSend: true,
          canReadHistory: true,
          roles: ["conversation_monitor", "reply_target"],
          loop: {
            status: "researching",
            pendingMessageCount: 0,
          },
        },
        {
          channelId: "demo-research-log",
          name: "research-log",
          type: "text",
          canView: true,
          canSend: true,
          canReadHistory: true,
          roles: ["research_log"],
        },
        {
          channelId: "demo-newspaper-forum",
          name: "newspaper-demo",
          type: "forum",
          canView: true,
          canSend: true,
          canReadHistory: true,
          canCreateForumPost: true,
          canSendInThreads: true,
          canReadThreadHistory: true,
          canAttachFiles: true,
          roles: [],
        },
      ],
    },
  ],
};

function createDemoDiary(): JournalDiaryReadModel {
  const now = 1_770_000_000_000;
  return {
    settings: {
      brokerTimeZone: "America/Puerto_Rico",
      updatedAt: now,
    },
    trades: [
      {
        stableId: "demo-trade-qqq",
        symbol: "QQQ",
        instrument: "Options",
        account: "Live",
        direction: "Long",
        status: "Closed",
        openedOn: "2026-11-18",
        closedOn: "2026-11-18",
        setup: "Opening range reclaim",
        size: "2 contracts",
        details: "Bought 2x QQQ 515C at $1.85, exited at $2.65.",
        plannedRiskCents: 12_000,
        realizedPnlCents: 16_000,
        thesis: "Reclaimed prior day high after opening sweep.",
        plan: "Stop below VWAP; trim into session high.",
        review: "Patient entry after the 5-minute close confirmed.",
        adherence: "Followed",
        mistakes: [],
        assistantReview:
          "Clean entry after the opening sweep reclaimed VWAP.\n\nNext time, leave a small runner when breadth confirms above the first hour high.",
        createdAt: now,
        updatedAt: now,
      },
    ],
    lessons: [
      {
        stableId: "demo-lesson-vwap",
        title: "Wait for the 5-minute candle close above VWAP",
        body: "Entering mid-candle during opening volatility caused avoidable stop-outs. Let the 5-minute bar confirm before committing size.",
        tradeStableId: "demo-trade-qqq",
        createdAt: now,
        updatedAt: now,
      },
    ],
    orderDays: [],
  };
}

function DemoHeader({ onReset }: { onReset: () => void }) {
  return (
    <header className="topbar demo-topbar">
      <div className="topbar-brand">
        <span className="brand-mark" aria-hidden="true">
          T
        </span>
        <div>
          <strong>Project Trishula</strong>
          <span>Demo workspace</span>
        </div>
      </div>
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
  const [diary, setDiary] = useState<JournalDiaryReadModel>(() =>
    createDemoDiary(),
  );
  const [journalChat, setJournalChat] = useState<JournalChatMessageReadModel[]>(
    [],
  );

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
    setDiary(createDemoDiary());
    setJournalChat([]);
    navigate("/journal");
  }

  return (
    <div className="shell demo-shell" data-environment={config.environment}>
      <PrimaryRail
        subtitle="Demo mode"
        footer={
          <div className="rail-account">
            <span className="rail-user">Demo workspace</span>
            <button type="button" onClick={reset}>
              Reset
            </button>
          </div>
        }
      />
      <div className="workspace demo-workspace workspace--full">
        <DemoHeader onReset={reset} />
        <Routes>
          <Route path="/" element={<Navigate to="/journal" replace />} />
          <Route
            path="/journal"
            element={
              <JournalWorkspaceView
                diary={diary}
                chatMessages={journalChat}
                handlers={{
                  onSaveSettings: async (input) => {
                    setDiary((current) => {
                      const nextSettings: JournalDiaryReadModel["settings"] = {
                        brokerTimeZone: input.brokerTimeZone,
                        updatedAt: Date.now(),
                      };
                      if (input.tradingViewLayoutId) {
                        nextSettings.tradingViewLayoutId =
                          input.tradingViewLayoutId;
                      }
                      return {
                        ...current,
                        settings: nextSettings,
                      };
                    });
                  },
                  onUpsertTrade: async ({ stableId, trade }) => {
                    const now = Date.now();
                    const id = stableId ?? `demo-trade-${now}`;
                    setDiary((current) => {
                      const exists = current.trades.some(
                        (item) => item.stableId === id,
                      );
                      const nextTrades = exists
                        ? current.trades.map((item) =>
                            item.stableId === id
                              ? { ...item, ...trade, updatedAt: now }
                              : item,
                          )
                        : [
                            {
                              stableId: id,
                              ...trade,
                              assistantReview: null,
                              createdAt: now,
                              updatedAt: now,
                            },
                            ...current.trades,
                          ];
                      return { ...current, trades: nextTrades };
                    });
                  },
                  onClearTradeReview: async (stableId) => {
                    setDiary((current) => ({
                      ...current,
                      trades: current.trades.map((item) =>
                        item.stableId === stableId
                          ? { ...item, assistantReview: null }
                          : item,
                      ),
                    }));
                  },
                  onDeleteTrade: async (stableId) => {
                    setDiary((current) => ({
                      ...current,
                      trades: current.trades.filter(
                        (item) => item.stableId !== stableId,
                      ),
                      lessons: current.lessons.map((lesson) =>
                        lesson.tradeStableId === stableId
                          ? { ...lesson, tradeStableId: null }
                          : lesson,
                      ),
                    }));
                  },
                  onUpsertLesson: async ({ stableId, lesson }) => {
                    const now = Date.now();
                    const id = stableId ?? `demo-lesson-${now}`;
                    setDiary((current) => {
                      const exists = current.lessons.some(
                        (item) => item.stableId === id,
                      );
                      const nextLessons = exists
                        ? current.lessons.map((item) =>
                            item.stableId === id
                              ? { ...item, ...lesson, updatedAt: now }
                              : item,
                          )
                        : [
                            {
                              stableId: id,
                              ...lesson,
                              createdAt: now,
                              updatedAt: now,
                            },
                            ...current.lessons,
                          ];
                      return { ...current, lessons: nextLessons };
                    });
                  },
                  onDeleteLesson: async (stableId) => {
                    setDiary((current) => ({
                      ...current,
                      lessons: current.lessons.filter(
                        (item) => item.stableId !== stableId,
                      ),
                    }));
                  },
                  onUploadChart: async () => ({
                    imageKey: "0".repeat(64),
                    storageId: "demo-storage",
                    mimeType: "image/png",
                    width: 1200,
                    height: 800,
                    url: "",
                  }),
                  onSendChatMessage: async ({ text }) => {
                    const now = Date.now();
                    setJournalChat((current) => [
                      ...current,
                      {
                        stableId: `demo-jchat-user-${now}`,
                        ordinal: current.length + 1,
                        role: "user",
                        text,
                        attachments: [],
                        status: "completed",
                        createdAt: now,
                        updatedAt: now,
                      },
                      {
                        stableId: `demo-jchat-assistant-${now}`,
                        ordinal: current.length + 2,
                        role: "assistant",
                        text: "Demo mode uses fixed local data. Connect Convex and Codex to import fills and run TradingView reviews.",
                        attachments: [],
                        status: "completed",
                        createdAt: now + 1,
                        updatedAt: now + 1,
                      },
                    ]);
                  },
                  onCancelActiveRun: async () => {},
                  onClearChatHistory: async () => {
                    setJournalChat([]);
                  },
                }}
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
            path="/discord"
            element={
              <DiscordControlView
                applicationId={config.discordApplicationId}
                model={demoDiscord}
                onSetGuildRouting={() => Promise.resolve()}
                onResetGuildConversation={(guildId) =>
                  Promise.resolve({
                    guildId,
                    conversationId: `discord:${guildId}`,
                    epoch: 2,
                    generation: 2,
                    routingGeneration: 2,
                    resetAt: Date.now(),
                  })
                }
              />
            }
          />
          <Route path="*" element={<Navigate to="/journal" replace />} />
        </Routes>
        <BottomNavigation />
      </div>
    </div>
  );
}
