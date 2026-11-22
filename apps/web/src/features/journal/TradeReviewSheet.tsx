import { useMemo, useState } from "react";
import type { JournalTradeReadModel } from "../../convex/types";
import { ChartReview } from "./ChartReview";
import { chartUrlsQueryArgs } from "./chartReviewParser";
import { formatDateLabel, formatMoney, pnlTone } from "./formatting";
import { JournalSheet } from "./JournalSheet";

export type ChartUrlsQueryHook = (
  args: { imageKeys: string[] } | "skip",
) => Record<string, string> | undefined;

const emptyChartUrlsHook: ChartUrlsQueryHook = () => ({});

export function TradeReviewSheet({
  trade,
  useChartUrls = emptyChartUrlsHook,
  onEdit,
  onWriteLesson,
  onClearReview,
  onClose,
}: {
  trade: JournalTradeReadModel;
  useChartUrls?: ChartUrlsQueryHook;
  onEdit: () => void;
  onWriteLesson: () => void;
  onClearReview: (stableId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryArgs = useMemo(
    () => chartUrlsQueryArgs(trade.assistantReview),
    [trade.assistantReview],
  );
  const chartUrls = useChartUrls(queryArgs);

  async function handleClearReview() {
    if (clearing) return;
    setClearing(true);
    setError(null);
    try {
      await onClearReview(trade.stableId);
      setConfirmClear(false);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not clear the review. Try again.",
      );
    } finally {
      setClearing(false);
    }
  }

  return (
    <JournalSheet
      title={`Review ${trade.symbol}`}
      busy={clearing}
      wide
      onClose={onClose}
    >
      <div className="journal-entry-body">
        <dl className="journal-review-facts">
          <div>
            <dt>Closed</dt>
            <dd>{formatDateLabel(trade.closedOn)}</dd>
          </div>
          {trade.openedOn && (
            <div>
              <dt>Opened</dt>
              <dd>{formatDateLabel(trade.openedOn)}</dd>
            </div>
          )}
          <div>
            <dt>Instrument</dt>
            <dd>
              {[
                trade.instrument,
                trade.account !== "Unspecified" && trade.account,
              ]
                .filter(Boolean)
                .join(" · ")}
            </dd>
          </div>
          {trade.size && (
            <div>
              <dt>Size</dt>
              <dd>{trade.size}</dd>
            </div>
          )}
          {trade.setup && (
            <div>
              <dt>Setup</dt>
              <dd>{trade.setup}</dd>
            </div>
          )}
          {trade.adherence !== "Unreviewed" && (
            <div>
              <dt>Adherence</dt>
              <dd>{trade.adherence}</dd>
            </div>
          )}
          <div>
            <dt>Realized P&amp;L</dt>
            <dd
              className={`journal-numeric ${pnlTone(trade.realizedPnlCents)}`}
            >
              {formatMoney(trade.realizedPnlCents, true)}
            </dd>
          </div>
        </dl>

        <section
          className="journal-trade-review"
          aria-labelledby="assistant-review-title"
        >
          <div className="journal-review-section-bar">
            <h3 id="assistant-review-title">Assistant review</h3>
            {trade.assistantReview && !confirmClear && (
              <button
                type="button"
                className="journal-text-button journal-delete-button"
                disabled={clearing}
                onClick={() => setConfirmClear(true)}
              >
                Clear review
              </button>
            )}
          </div>
          {confirmClear && (
            <div className="journal-inline-confirm">
              <p>Clear the assistant chart review for {trade.symbol}?</p>
              <div className="journal-footer-actions">
                <button
                  type="button"
                  className="journal-button journal-button--secondary"
                  disabled={clearing}
                  onClick={() => setConfirmClear(false)}
                >
                  Keep review
                </button>
                <button
                  type="button"
                  className="journal-button journal-button--danger"
                  disabled={clearing}
                  onClick={() => void handleClearReview()}
                >
                  {clearing ? "Clearing…" : "Confirm clear"}
                </button>
              </div>
            </div>
          )}
          {error && (
            <p className="journal-form-error" role="alert">
              {error}
            </p>
          )}
          <ChartReview
            assistantReview={trade.assistantReview}
            chartUrls={chartUrls}
          />
        </section>

        {(trade.review || trade.mistakes.length > 0) && (
          <section className="journal-trader-notes">
            <h3>Self-review</h3>
            {trade.mistakes.length > 0 && (
              <p className="journal-mistakes-line">
                <span>Mistakes:</span> {trade.mistakes.join(" · ")}
              </p>
            )}
            {trade.review && (
              <p className="journal-review-copy">{trade.review}</p>
            )}
          </section>
        )}

        {(trade.details || trade.thesis || trade.plan) && (
          <details className="journal-field-disclosure">
            <summary>Trade details &amp; plan</summary>
            <div className="journal-details-stack">
              {trade.details && (
                <div>
                  <h4>Fills and notes</h4>
                  <p className="journal-review-copy">{trade.details}</p>
                </div>
              )}
              {trade.thesis && (
                <div>
                  <h4>Thesis</h4>
                  <p className="journal-review-copy">{trade.thesis}</p>
                </div>
              )}
              {trade.plan && (
                <div>
                  <h4>Entry and exit plan</h4>
                  <p className="journal-review-copy">{trade.plan}</p>
                </div>
              )}
            </div>
          </details>
        )}
      </div>

      <footer className="journal-entry-footer">
        <div className="journal-footer-actions">
          <button
            type="button"
            className="journal-button journal-button--secondary"
            disabled={clearing}
            onClick={onEdit}
          >
            Edit trade
          </button>
          <button
            type="button"
            className="journal-button journal-button--primary"
            disabled={clearing}
            onClick={onWriteLesson}
          >
            Write lesson
          </button>
        </div>
      </footer>
    </JournalSheet>
  );
}
