import { useState, type FormEvent } from "react";
import type {
  JournalAccount,
  JournalAdherence,
  JournalDirection,
  JournalInstrument,
  JournalMistake,
  JournalStatus,
  JournalTradeInput,
  JournalTradeReadModel,
} from "../../convex/types";
import {
  JOURNAL_ACCOUNTS,
  JOURNAL_ADHERENCE_OPTIONS,
  JOURNAL_DIRECTIONS,
  JOURNAL_INSTRUMENTS,
  JOURNAL_MISTAKE_OPTIONS,
  JOURNAL_STATUSES,
} from "./constants";
import { centsToDollars, dollarsToCents, localIsoDate } from "./formatting";
import { TrashIcon } from "./icons";
import { JournalSheet } from "./JournalSheet";

function parseChoice<T extends string>(
  value: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const matched = allowed.find((item) => item === value);
  return matched ?? fallback;
}

export function TradeEditorSheet({
  trade,
  onSave,
  onDelete,
  onClose,
}: {
  trade: JournalTradeReadModel | null;
  onSave: (input: JournalTradeInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const today = localIsoDate();
  const [status, setStatus] = useState<JournalStatus>(trade?.status ?? "Open");
  const [mistakes, setMistakes] = useState<JournalMistake[]>(
    trade?.mistakes ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const closed = status === "Closed";
  const title = trade ? `Edit ${trade.symbol}` : "Log trade";

  function toggleMistake(mistake: JournalMistake) {
    setMistakes((current) =>
      current.includes(mistake)
        ? current.filter((item) => item !== mistake)
        : [...current, mistake],
    );
  }

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
    const readText = (name: string) => String(formData.get(name) ?? "").trim();

    void runTask(async () => {
      const symbol = readText("symbol").toUpperCase();
      if (!symbol) {
        throw new Error("Enter a symbol.");
      }

      const openedOn = readText("openedOn");
      const closedOn = closed ? readText("closedOn") : null;
      if (!closed && !openedOn) {
        throw new Error("Enter an opening date for the open position.");
      }
      if (closed && (!closedOn || closedOn < openedOn)) {
        throw new Error("Enter a closing date on or after the opening date.");
      }

      const plannedRiskCents = dollarsToCents(readText("plannedRisk"));
      if (plannedRiskCents !== null && plannedRiskCents <= 0) {
        throw new Error("Planned risk must be greater than zero.");
      }
      const realizedPnlCents = closed
        ? dollarsToCents(readText("realizedPnl"))
        : null;

      const instrument: JournalInstrument = parseChoice(
        readText("instrument"),
        JOURNAL_INSTRUMENTS,
        "Shares",
      );
      const account: JournalAccount = parseChoice(
        readText("account"),
        JOURNAL_ACCOUNTS,
        "Live",
      );
      const direction: JournalDirection = parseChoice(
        readText("direction"),
        ["", ...JOURNAL_DIRECTIONS] as const,
        "",
      );
      const adherence: JournalAdherence = parseChoice(
        readText("adherence"),
        JOURNAL_ADHERENCE_OPTIONS,
        "Unreviewed",
      );

      await onSave({
        symbol,
        instrument,
        account,
        direction,
        status,
        openedOn,
        closedOn,
        setup: readText("setup"),
        size: readText("size"),
        details: readText("details"),
        plannedRiskCents,
        realizedPnlCents,
        thesis: readText("thesis"),
        plan: readText("plan"),
        review: readText("review"),
        adherence,
        mistakes,
      });
    });
  }

  return (
    <JournalSheet title={title} busy={busy} onClose={onClose}>
      <form
        className="journal-entry-form"
        onSubmit={handleSubmit}
        onInvalid={(event) => {
          if (!(event.target instanceof HTMLElement)) return;
          const details = event.target.closest("details");
          if (details) details.open = true;
        }}
      >
        <div className="journal-entry-body">
          <fieldset className="journal-fieldset" disabled={busy}>
            <div className="journal-form-section">
              <div className="journal-field-grid">
                <label className="journal-field">
                  <span>Symbol</span>
                  <input
                    name="symbol"
                    defaultValue={trade?.symbol ?? ""}
                    required
                    maxLength={24}
                    autoCapitalize="characters"
                    autoComplete="off"
                    placeholder="e.g. QQQ"
                  />
                </label>

                <label className="journal-field">
                  <span>Status</span>
                  <span className="journal-select-field">
                    <select
                      name="status"
                      value={status}
                      onChange={(event) =>
                        setStatus(
                          parseChoice(
                            event.target.value,
                            JOURNAL_STATUSES,
                            "Open",
                          ),
                        )
                      }
                    >
                      {JOURNAL_STATUSES.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>

                <label className="journal-field">
                  <span>Instrument</span>
                  <span className="journal-select-field">
                    <select
                      name="instrument"
                      defaultValue={trade?.instrument ?? "Shares"}
                    >
                      {JOURNAL_INSTRUMENTS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>

                <label className="journal-field">
                  <span>Account</span>
                  <span className="journal-select-field">
                    <select
                      name="account"
                      defaultValue={trade?.account ?? "Live"}
                    >
                      {JOURNAL_ACCOUNTS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>

                <label className="journal-field">
                  <span>{closed ? "Opened (optional)" : "Opened"}</span>
                  <input
                    name="openedOn"
                    type="date"
                    defaultValue={trade?.openedOn ?? today}
                    required={!closed}
                  />
                </label>

                <div hidden={!closed}>
                  <label className="journal-field">
                    <span>Closed</span>
                    <input
                      name="closedOn"
                      type="date"
                      defaultValue={trade?.closedOn ?? today}
                      required={closed}
                      disabled={!closed}
                    />
                  </label>
                </div>

                <div hidden={!closed}>
                  <label className="journal-field">
                    <span>Realized P&amp;L (USD)</span>
                    <input
                      name="realizedPnl"
                      type="number"
                      inputMode="decimal"
                      min="-10000000000"
                      max="10000000000"
                      step="0.01"
                      disabled={!closed}
                      defaultValue={centsToDollars(trade?.realizedPnlCents)}
                      placeholder="0.00"
                    />
                  </label>
                </div>
              </div>
            </div>

            <details className="journal-field-disclosure">
              <summary>Trade details &amp; plan</summary>
              <div className="journal-form-section">
                <div className="journal-field-grid">
                  <label className="journal-field">
                    <span>Direction</span>
                    <span className="journal-select-field">
                      <select
                        name="direction"
                        defaultValue={trade?.direction ?? ""}
                      >
                        <option value="">Unspecified</option>
                        {JOURNAL_DIRECTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </span>
                  </label>

                  <label className="journal-field">
                    <span>Size</span>
                    <input
                      name="size"
                      defaultValue={trade?.size ?? ""}
                      maxLength={48}
                      placeholder="e.g. 2 contracts"
                    />
                  </label>

                  <label className="journal-field">
                    <span>Setup</span>
                    <input
                      name="setup"
                      defaultValue={trade?.setup ?? ""}
                      maxLength={80}
                      placeholder="e.g. Opening range breakout"
                    />
                  </label>

                  <label className="journal-field">
                    <span>Planned risk (USD)</span>
                    <input
                      name="plannedRisk"
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      max="10000000000"
                      step="0.01"
                      defaultValue={centsToDollars(trade?.plannedRiskCents)}
                      placeholder="0.00"
                    />
                  </label>
                </div>

                <label className="journal-field">
                  <span>Fills and notes</span>
                  <textarea
                    name="details"
                    defaultValue={trade?.details ?? ""}
                    maxLength={6000}
                    rows={4}
                    placeholder="Entry and exit prices, expirations, or other trade details"
                  />
                </label>

                <label className="journal-field">
                  <span>Thesis</span>
                  <textarea
                    name="thesis"
                    defaultValue={trade?.thesis ?? ""}
                    maxLength={6000}
                    rows={2}
                    placeholder="Why did you take this trade?"
                  />
                </label>

                <label className="journal-field">
                  <span>Entry and exit plan</span>
                  <textarea
                    name="plan"
                    defaultValue={trade?.plan ?? ""}
                    maxLength={6000}
                    rows={3}
                    placeholder="What was your entry trigger, target, and invalidation?"
                  />
                </label>
              </div>
            </details>

            <details className="journal-field-disclosure">
              <summary>Self-review &amp; mistakes</summary>
              <div className="journal-form-section">
                <label className="journal-field">
                  <span>Plan adherence</span>
                  <span className="journal-select-field">
                    <select
                      name="adherence"
                      defaultValue={trade?.adherence ?? "Unreviewed"}
                    >
                      {JOURNAL_ADHERENCE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>

                <label className="journal-field">
                  <span>Review notes</span>
                  <textarea
                    name="review"
                    defaultValue={trade?.review ?? ""}
                    maxLength={6000}
                    rows={3}
                    placeholder="What worked, and what would you change?"
                  />
                </label>

                <div className="journal-field">
                  <span>Mistakes</span>
                  <div className="journal-mistake-grid">
                    {JOURNAL_MISTAKE_OPTIONS.map((mistake) => (
                      <label className="journal-checkbox-row" key={mistake}>
                        <input
                          type="checkbox"
                          checked={mistakes.includes(mistake)}
                          onChange={() => toggleMistake(mistake)}
                        />
                        <span>{mistake}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </details>
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
              <p>
                Delete this trade? Linked lessons will stay in your journal.
              </p>
              <div className="journal-footer-actions">
                <button
                  type="button"
                  className="journal-button journal-button--secondary"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep trade
                </button>
                <button
                  type="button"
                  className="journal-button journal-button--danger"
                  disabled={busy}
                  onClick={() => void runTask(onDelete)}
                >
                  {busy ? "Deleting…" : "Delete trade"}
                </button>
              </div>
            </div>
          ) : (
            <div className="journal-footer-line">
              {trade && onDelete && (
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
                  {busy ? "Saving…" : "Save trade"}
                </button>
              </div>
            </div>
          )}
        </footer>
      </form>
    </JournalSheet>
  );
}
