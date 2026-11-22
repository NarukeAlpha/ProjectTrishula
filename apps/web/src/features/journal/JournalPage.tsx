import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { publicApi } from "../../convex/functions";
import type {
  JournalChatAttachmentRef,
  JournalChatMessageReadModel,
  JournalDiaryReadModel,
  JournalLessonInput,
  JournalLessonReadModel,
  JournalTradeInput,
  JournalTradeReadModel,
  JournalUploadedChartReadModel,
} from "../../convex/types";
import { ChatPaneIcon, PlusIcon, SettingsIcon } from "./icons";
import { JournalChatPane } from "./JournalChatPane";
import { JournalSettingsPopover } from "./JournalSettingsPopover";
import { LessonEditorSheet } from "./LessonEditorSheet";
import { LessonsView } from "./LessonsView";
import { TradeEditorSheet } from "./TradeEditorSheet";
import { TradeReviewSheet } from "./TradeReviewSheet";
import { TradesLedger } from "./TradesLedger";
import "./journal.css";

type JournalViewTab = "trades" | "lessons";

type ActiveSheet =
  | { kind: "none" }
  | { kind: "reviewTrade"; stableId: string }
  | { kind: "newTrade" }
  | { kind: "editTrade"; stableId: string }
  | { kind: "newLesson"; linkedTradeStableId: string | null }
  | { kind: "editLesson"; stableId: string };

function isWideViewport(): boolean {
  return window.innerWidth >= 1100;
}

export interface JournalWorkspaceHandlers {
  onSaveSettings: (input: {
    brokerTimeZone: string;
    tradingViewLayoutId: string | null;
  }) => Promise<void>;
  onUpsertTrade: (input: {
    stableId?: string;
    trade: JournalTradeInput;
  }) => Promise<void>;
  onClearTradeReview: (stableId: string) => Promise<void>;
  onDeleteTrade: (stableId: string) => Promise<void>;
  onUpsertLesson: (input: {
    stableId?: string;
    lesson: JournalLessonInput;
  }) => Promise<void>;
  onDeleteLesson: (stableId: string) => Promise<void>;
  onUploadChart: (input: {
    base64Data: string;
    filename: string;
  }) => Promise<JournalUploadedChartReadModel>;
  onSendChatMessage: (input: {
    text: string;
    attachments: JournalChatAttachmentRef[];
  }) => Promise<void>;
  onCancelActiveRun: () => Promise<void>;
  onClearChatHistory: () => Promise<void>;
}

export function JournalWorkspaceView({
  diary,
  chatMessages,
  chatLoading = false,
  initialChatOpen,
  handlers,
}: {
  diary: JournalDiaryReadModel | undefined;
  chatMessages: JournalChatMessageReadModel[];
  chatLoading?: boolean;
  initialChatOpen?: boolean;
  handlers: JournalWorkspaceHandlers;
}) {
  const [tab, setTab] = useState<JournalViewTab>("trades");
  const [sheet, setSheet] = useState<ActiveSheet>({ kind: "none" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState<boolean>(() =>
    initialChatOpen !== undefined ? initialChatOpen : isWideViewport(),
  );
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const trades = diary?.trades ?? [];
  const lessons = diary?.lessons ?? [];
  const orderDays = diary?.orderDays ?? [];
  const chartUrls = diary?.chartUrls ?? {};

  function openTrade(trade: JournalTradeReadModel) {
    if (trade.status === "Closed") {
      setSheet({ kind: "reviewTrade", stableId: trade.stableId });
    } else {
      setSheet({ kind: "editTrade", stableId: trade.stableId });
    }
  }

  function openLesson(lesson: JournalLessonReadModel) {
    setSheet({ kind: "editLesson", stableId: lesson.stableId });
  }

  const activeReviewTrade =
    sheet.kind === "reviewTrade"
      ? (trades.find((item) => item.stableId === sheet.stableId) ?? null)
      : null;

  const activeEditTrade =
    sheet.kind === "editTrade"
      ? (trades.find((item) => item.stableId === sheet.stableId) ?? null)
      : null;

  const activeEditLesson =
    sheet.kind === "editLesson"
      ? (lessons.find((item) => item.stableId === sheet.stableId) ?? null)
      : null;

  return (
    <div
      className="journal-workspace"
      data-chat-open={chatOpen ? "true" : "false"}
    >
      <main className="journal-main">
        <div className="journal-content">
          <header className="journal-page-header">
            <div className="journal-header-left">
              <p className="journal-kicker">Forest Ledger</p>
              <h1>Trading Journal</h1>
              <nav className="journal-view-tabs" aria-label="Journal views">
                <button
                  type="button"
                  className="journal-tab"
                  aria-pressed={tab === "trades"}
                  data-active={tab === "trades" ? "true" : undefined}
                  onClick={() => setTab("trades")}
                >
                  Trades
                  <span className="journal-tab-count">{trades.length}</span>
                </button>
                <button
                  type="button"
                  className="journal-tab"
                  aria-pressed={tab === "lessons"}
                  data-active={tab === "lessons" ? "true" : undefined}
                  onClick={() => setTab("lessons")}
                >
                  Lessons
                  <span className="journal-tab-count">{lessons.length}</span>
                </button>
              </nav>
            </div>

            <div className="journal-header-actions">
              {tab === "trades" ? (
                <button
                  type="button"
                  className="journal-button journal-button--primary"
                  onClick={() => setSheet({ kind: "newTrade" })}
                >
                  <PlusIcon />
                  <span>Log trade</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="journal-button journal-button--primary"
                  onClick={() =>
                    setSheet({ kind: "newLesson", linkedTradeStableId: null })
                  }
                >
                  <PlusIcon />
                  <span>New lesson</span>
                </button>
              )}

              <button
                type="button"
                className="journal-button journal-button--secondary"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((open) => !open)}
              >
                <SettingsIcon />
                <span>Settings</span>
              </button>

              <button
                type="button"
                className="journal-button journal-button--secondary"
                aria-expanded={chatOpen}
                data-active={chatOpen ? "true" : undefined}
                onClick={() => setChatOpen((open) => !open)}
              >
                <ChatPaneIcon />
                <span>Journal Chat</span>
              </button>
            </div>
          </header>

          {settingsOpen && diary && (
            <JournalSettingsPopover
              settings={diary.settings}
              onSave={async (input) => {
                await handlers.onSaveSettings(input);
                setToast("Journal settings updated.");
              }}
              onClose={() => setSettingsOpen(false)}
            />
          )}

          {diary === undefined ? (
            <section
              className="journal-card journal-loading-card"
              role="status"
            >
              Loading trading journal…
            </section>
          ) : tab === "trades" ? (
            <TradesLedger
              trades={trades}
              orderDays={orderDays}
              onOpenTrade={openTrade}
              onLogTrade={() => setSheet({ kind: "newTrade" })}
            />
          ) : (
            <LessonsView
              lessons={lessons}
              trades={trades}
              onOpenLesson={openLesson}
              onOpenTrade={openTrade}
              onAddLesson={() =>
                setSheet({ kind: "newLesson", linkedTradeStableId: null })
              }
            />
          )}
        </div>
      </main>

      {chatOpen && (
        <div className="journal-chat-shell">
          <button
            type="button"
            className="journal-chat-scrim"
            aria-label="Close Journal Chat"
            onClick={() => setChatOpen(false)}
          />
          <JournalChatPane
            messages={chatMessages}
            loading={chatLoading}
            onUploadChart={handlers.onUploadChart}
            onSendMessage={handlers.onSendChatMessage}
            onCancelRun={handlers.onCancelActiveRun}
            onClearHistory={handlers.onClearChatHistory}
            onClose={() => setChatOpen(false)}
          />
        </div>
      )}

      {activeReviewTrade && (
        <TradeReviewSheet
          trade={activeReviewTrade}
          chartUrls={chartUrls}
          onEdit={() =>
            setSheet({
              kind: "editTrade",
              stableId: activeReviewTrade.stableId,
            })
          }
          onWriteLesson={() =>
            setSheet({
              kind: "newLesson",
              linkedTradeStableId: activeReviewTrade.stableId,
            })
          }
          onClearReview={async (stableId) => {
            await handlers.onClearTradeReview(stableId);
            setToast("Assistant review cleared.");
          }}
          onClose={() => setSheet({ kind: "none" })}
        />
      )}

      {(sheet.kind === "newTrade" || activeEditTrade !== null) && (
        <TradeEditorSheet
          trade={activeEditTrade}
          onSave={async (tradeInput) => {
            if (activeEditTrade) {
              await handlers.onUpsertTrade({
                stableId: activeEditTrade.stableId,
                trade: tradeInput,
              });
              setToast(`Saved ${tradeInput.symbol}.`);
            } else {
              await handlers.onUpsertTrade({ trade: tradeInput });
              setToast(`Logged ${tradeInput.symbol}.`);
            }
            setSheet({ kind: "none" });
          }}
          onDelete={
            activeEditTrade
              ? async () => {
                  await handlers.onDeleteTrade(activeEditTrade.stableId);
                  setToast(`Deleted ${activeEditTrade.symbol}.`);
                  setSheet({ kind: "none" });
                }
              : undefined
          }
          onClose={() => setSheet({ kind: "none" })}
        />
      )}

      {(sheet.kind === "newLesson" || activeEditLesson !== null) && (
        <LessonEditorSheet
          lesson={activeEditLesson}
          linkedTradeStableId={
            sheet.kind === "newLesson" ? sheet.linkedTradeStableId : null
          }
          trades={trades}
          onSave={async (lessonInput) => {
            if (activeEditLesson) {
              await handlers.onUpsertLesson({
                stableId: activeEditLesson.stableId,
                lesson: lessonInput,
              });
              setToast("Lesson updated.");
            } else {
              await handlers.onUpsertLesson({ lesson: lessonInput });
              setToast("Lesson saved.");
            }
            setSheet({ kind: "none" });
          }}
          onDelete={
            activeEditLesson
              ? async () => {
                  await handlers.onDeleteLesson(activeEditLesson.stableId);
                  setToast("Lesson deleted.");
                  setSheet({ kind: "none" });
                }
              : undefined
          }
          onClose={() => setSheet({ kind: "none" })}
        />
      )}

      {toast && (
        <div className="journal-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}

export function JournalPage() {
  const diary = useQuery(publicApi.journal.getDiary, {});
  const chatMessages = useQuery(publicApi.journal.listChatMessages, {
    limit: 100,
  });

  const saveSettings = useMutation(publicApi.journal.saveSettings);
  const upsertTrade = useMutation(publicApi.journal.upsertTrade);
  const clearTradeAssistantReview = useMutation(
    publicApi.journal.clearTradeAssistantReview,
  );
  const deleteTrade = useMutation(publicApi.journal.deleteTrade);
  const upsertLesson = useMutation(publicApi.journal.upsertLesson);
  const deleteLesson = useMutation(publicApi.journal.deleteLesson);
  const uploadChartAsset = useAction(publicApi.journal.uploadChartAsset);
  const sendChatMessage = useMutation(publicApi.journal.sendChatMessage);
  const cancelActiveRun = useMutation(publicApi.journal.cancelActiveRun);
  const clearChatHistory = useMutation(publicApi.journal.clearChatHistory);

  return (
    <JournalWorkspaceView
      diary={diary}
      chatMessages={chatMessages ?? []}
      chatLoading={chatMessages === undefined}
      handlers={{
        onSaveSettings: async (input) => {
          await saveSettings(input);
        },
        onUpsertTrade: async (input) => {
          await upsertTrade(input);
        },
        onClearTradeReview: async (stableId) => {
          await clearTradeAssistantReview({ stableId });
        },
        onDeleteTrade: async (stableId) => {
          await deleteTrade({ stableId });
        },
        onUpsertLesson: async (input) => {
          await upsertLesson(input);
        },
        onDeleteLesson: async (stableId) => {
          await deleteLesson({ stableId });
        },
        onUploadChart: async (input) => {
          return uploadChartAsset({
            base64Data: input.base64Data,
            filename: input.filename,
          });
        },
        onSendChatMessage: async (input) => {
          await sendChatMessage({
            text: input.text,
            attachments: input.attachments,
          });
        },
        onCancelActiveRun: async () => {
          await cancelActiveRun({});
        },
        onClearChatHistory: async () => {
          for (let attempt = 0; attempt < 10; attempt += 1) {
            const result = await clearChatHistory({ batchSize: 100 });
            if (!result.hasMore) break;
          }
        },
      }}
    />
  );
}
