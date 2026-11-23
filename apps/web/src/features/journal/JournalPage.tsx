import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { publicApi } from "../../convex/functions";
import { tradeReviewsPage, type JournalSection } from "../navigation/routes";
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
import { clearAllChatHistory } from "./chatHistory";
import { DEFAULT_BROKER_TIME_ZONE } from "./constants";
import { ChatPaneIcon, PlusIcon, SettingsIcon } from "./icons";
import { JournalChatPane } from "./JournalChatPane";
import { JournalSettingsPopover } from "./JournalSettingsPopover";
import { LessonEditorSheet } from "./LessonEditorSheet";
import { LessonsView } from "./LessonsView";
import { TradeEditorSheet } from "./TradeEditorSheet";
import { TradeReviewSheet, type ChartUrlsQueryHook } from "./TradeReviewSheet";
import { TradesLedger } from "./TradesLedger";
import "./journal.css";

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

function useConvexChartUrls(
  args: { imageKeys: string[] } | "skip",
): Record<string, string> | undefined {
  return useQuery(publicApi.journal.getChartUrls, args);
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
  section,
  diary,
  chatMessages,
  chatLoading = false,
  initialChatOpen,
  useChartUrls,
  handlers,
}: {
  section: JournalSection;
  diary: JournalDiaryReadModel | undefined;
  chatMessages: JournalChatMessageReadModel[];
  chatLoading?: boolean;
  initialChatOpen?: boolean;
  useChartUrls?: ChartUrlsQueryHook;
  handlers: JournalWorkspaceHandlers;
}) {
  const showTrades = section.path === tradeReviewsPage.path;
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
  const brokerTimeZone =
    diary?.settings.brokerTimeZone ?? DEFAULT_BROKER_TIME_ZONE;

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
              <h1>{section.title}</h1>
            </div>

            <div className="journal-header-actions">
              {showTrades ? (
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
              Loading {section.title}…
            </section>
          ) : showTrades ? (
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
          useChartUrls={useChartUrls}
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
          brokerTimeZone={brokerTimeZone}
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

export function JournalPage({ section }: { section: JournalSection }) {
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
      section={section}
      diary={diary}
      chatMessages={chatMessages ?? []}
      chatLoading={chatMessages === undefined}
      useChartUrls={useConvexChartUrls}
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
          await clearAllChatHistory((args) => clearChatHistory(args));
        },
      }}
    />
  );
}
