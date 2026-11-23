import { useId, useState, type FormEvent } from "react";
import type { JournalSettingsReadModel } from "../../convex/types";
import {
  COMMON_BROKER_TIME_ZONES,
  DEFAULT_BROKER_TIME_ZONE,
} from "./constants";
import { CloseIcon } from "./icons";

export function JournalSettingsPopover({
  settings,
  onSave,
  onClose,
}: {
  settings: JournalSettingsReadModel;
  onSave: (input: {
    brokerTimeZone: string;
    tradingViewLayoutId: string | null;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const datalistId = useId();
  const [brokerTimeZone, setBrokerTimeZone] = useState(
    settings.brokerTimeZone || DEFAULT_BROKER_TIME_ZONE,
  );
  const [layoutId, setLayoutId] = useState(settings.tradingViewLayoutId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const trimmedTz = brokerTimeZone.trim();
    if (!trimmedTz) {
      setError("Enter a valid IANA broker time zone.");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const trimmedLayout = layoutId.trim();
      await onSave({
        brokerTimeZone: trimmedTz,
        tradingViewLayoutId: trimmedLayout ? trimmedLayout : null,
      });
      setSaved(true);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save settings. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="journal-settings-popover" aria-label="Journal settings">
      <header className="journal-settings-header">
        <div>
          <h3>Journal settings</h3>
          <p>Used by Journal Chat when aligning broker fills and charts.</p>
        </div>
        <button
          type="button"
          className="journal-icon-button"
          aria-label="Close settings"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <form className="journal-settings-form" onSubmit={handleSubmit}>
        <label className="journal-field">
          <span>Broker time zone</span>
          <input
            type="text"
            name="brokerTimeZone"
            list={datalistId}
            value={brokerTimeZone}
            onChange={(event) => {
              setBrokerTimeZone(event.target.value);
              setSaved(false);
            }}
            placeholder="America/Puerto_Rico"
            required
            disabled={saving}
          />
          <datalist id={datalistId}>
            {COMMON_BROKER_TIME_ZONES.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </label>

        <label className="journal-field">
          <span>TradingView layout ID (optional)</span>
          <input
            type="text"
            name="tradingViewLayoutId"
            value={layoutId}
            onChange={(event) => {
              setLayoutId(event.target.value);
              setSaved(false);
            }}
            placeholder="Optional saved chart layout ID"
            maxLength={64}
            disabled={saving}
          />
        </label>

        {error && (
          <p className="journal-form-error" role="alert">
            {error}
          </p>
        )}
        {saved && !error && (
          <p className="journal-settings-saved" role="status">
            Settings saved.
          </p>
        )}

        <div className="journal-settings-actions">
          <button
            type="button"
            className="journal-button journal-button--secondary"
            disabled={saving}
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="submit"
            className="journal-button journal-button--primary"
            disabled={saving}
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>
    </section>
  );
}
