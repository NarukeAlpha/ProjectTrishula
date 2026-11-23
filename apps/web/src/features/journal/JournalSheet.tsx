import { useEffect, useId, useRef, type ReactNode } from "react";
import { CloseIcon } from "./icons";

export function JournalSheet({
  title,
  busy = false,
  wide = false,
  onClose,
  children,
}: {
  title: string;
  busy?: boolean;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [busy, onClose]);

  return (
    <div
      className="journal-sheet-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className={wide ? "journal-sheet journal-sheet--wide" : "journal-sheet"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="journal-sheet-heading">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="journal-icon-button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
