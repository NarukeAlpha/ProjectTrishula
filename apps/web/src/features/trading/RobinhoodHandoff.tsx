import { useState } from "react";

export interface RobinhoodHandoffProps {
  authorizationUrl: string;
  onDismiss(): void;
}

type CopyStatus = "idle" | "copied" | "failed";

export function RobinhoodHandoff({
  authorizationUrl,
  onDismiss,
}: RobinhoodHandoffProps) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(authorizationUrl);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <section className="broker-handoff" aria-labelledby="broker-handoff-title">
      <div>
        <p className="section-kicker">Private authorization link</p>
        <h3 id="broker-handoff-title">Finish Robinhood on desktop</h3>
        <p>
          Open this one-time link on a desktop now. It can expire. Sign in to
          Robinhood, then approve the verification prompt on your phone
          promptly. Do not share the link.
        </p>
        <p>
          If it expires, dismiss this message and tap Connect Robinhood for a
          new link. Signal will update this page after your private trading
          runtime confirms the connection.
        </p>
      </div>
      <div className="broker-handoff-actions">
        <a
          className="primary-action broker-handoff-action"
          href={authorizationUrl}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          Open Robinhood
        </a>
        <button
          className="secondary-action broker-handoff-action"
          type="button"
          onClick={() => void copyLink()}
        >
          Copy private link
        </button>
        <button
          className="broker-handoff-dismiss"
          type="button"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
      <p className="broker-handoff-status" aria-live="polite">
        {copyStatus === "copied"
          ? "Private link copied."
          : copyStatus === "failed"
            ? "Signal could not copy the link. Open it on this device instead."
            : "The link stays only in this open page."}
      </p>
    </section>
  );
}
