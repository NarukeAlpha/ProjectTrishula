import { useState, type FormEvent } from "react";
import type {
  JournalLessonInput,
  JournalLessonReadModel,
  JournalTradeReadModel,
} from "../../convex/types";
import { formatDateLabel, tradeDate } from "./formatting";
import { TrashIcon } from "./icons";
import { JournalSheet } from "./JournalSheet";

export function LessonEditorSheet({
  lesson,
  linkedTradeStableId,
  trades,
  onSave,
  onDelete,
  onClose,
}: {
  lesson: JournalLessonReadModel | null;
  linkedTradeStableId: string | null;
  trades: JournalTradeReadModel[];
  onSave: (input: JournalLessonInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function runTask(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The request failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const title = String(formData.get("title") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    const tradeStableId = String(formData.get("tradeStableId") ?? "") || null;

    void runTask(async () => {
      if (!title) throw new Error("Enter a lesson title.");
      if (!body) throw new Error("Write down the lesson.");
      await onSave({ title, body, tradeStableId });
    });
  }

  return (
    <JournalSheet
      title={lesson ? "Edit lesson" : "Write a lesson"}
      busy={busy}
      onClose={onClose}
    >
      <form className="journal-entry-form" onSubmit={handleSubmit}>
        <div className="journal-entry-body">
          <fieldset
            className="journal-fieldset journal-form-section"
            disabled={busy}
          >
            <label className="journal-field">
              <span>Title</span>
              <input
                name="title"
                required
                maxLength={120}
                defaultValue={lesson?.title ?? ""}
                placeholder="A rule or reminder for next time"
              />
            </label>

            <label className="journal-field">
              <span>Lesson</span>
              <textarea
                name="body"
                required
                maxLength={6000}
                defaultValue={lesson?.body ?? ""}
                rows={6}
                placeholder="What did you learn? How will you put it into practice?"
              />
            </label>

            <label className="journal-field">
              <span>Linked trade</span>
              <span className="journal-select-field">
                <select
                  name="tradeStableId"
                  defaultValue={
                    lesson?.tradeStableId ?? linkedTradeStableId ?? ""
                  }
                >
                  <option value="">No linked trade</option>
                  {trades.map((trade) => (
                    <option key={trade.stableId} value={trade.stableId}>
                      {[
                        trade.symbol,
                        formatDateLabel(tradeDate(trade)),
                        trade.account !== "Unspecified" && trade.account,
                        trade.setup,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          </fieldset>
        </div>

        <footer className="journal-entry-footer">
          {error && (
            <p className="journal-form-error" role="alert">
              {error}
            </p>
          )}
          {confirmDelete && onDelete ? (
            <div className="journal-delete-confirm">
              <p>Delete this lesson?</p>
              <div className="journal-footer-actions">
                <button
                  type="button"
                  className="journal-button journal-button--secondary"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep lesson
                </button>
                <button
                  type="button"
                  className="journal-button journal-button--danger"
                  disabled={busy}
                  onClick={() => void runTask(onDelete)}
                >
                  {busy ? "Deleting…" : "Delete lesson"}
                </button>
              </div>
            </div>
          ) : (
            <div className="journal-footer-line">
              {lesson && onDelete && (
                <button
                  type="button"
                  className="journal-text-button journal-delete-button"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  <TrashIcon /> Delete
                </button>
              )}
              <div className="journal-footer-actions">
                <button
                  type="button"
                  className="journal-button journal-button--secondary"
                  disabled={busy}
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="journal-button journal-button--primary"
                  disabled={busy}
                >
                  {busy ? "Saving…" : "Save lesson"}
                </button>
              </div>
            </div>
          )}
        </footer>
      </form>
    </JournalSheet>
  );
}
