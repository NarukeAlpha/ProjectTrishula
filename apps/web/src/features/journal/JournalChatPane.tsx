import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type {
  JournalChatAttachmentRef,
  JournalChatMessageReadModel,
  JournalToolEventReadModel,
  JournalUploadedChartReadModel,
} from "../../convex/types";
import { Markdown } from "../messages/Markdown";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "./constants";
import { formatChatTime, formatFileSize } from "./formatting";
import {
  CloseIcon,
  PaperclipIcon,
  SendIcon,
  StopIcon,
  TrashIcon,
} from "./icons";

interface PendingAttachment {
  id: string;
  file: File;
  previewUrl: string | null;
  uploadedImageKey?: string;
}

function isAllowedMimeType(type: string): boolean {
  return ALLOWED_ATTACHMENT_MIME_TYPES.some((allowed) => allowed === type);
}

function createPreviewUrl(file: File): string | null {
  if ("createObjectURL" in URL) {
    return URL.createObjectURL(file);
  }
  return null;
}

function revokePreviewUrl(url: string | null): void {
  if (url && "revokeObjectURL" in URL) {
    URL.revokeObjectURL(url);
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (Object.prototype.toString.call(result) !== "[object String]") {
        reject(new Error(`Could not read ${file.name}.`));
        return;
      }
      // SAFETY: Object.prototype.toString verified result is a string data URL.
      const dataUrl = result as string;
      const commaIndex = dataUrl.indexOf(",");
      if (commaIndex === -1) {
        reject(new Error(`Could not encode ${file.name}.`));
        return;
      }
      resolve(dataUrl.slice(commaIndex + 1));
    };
    reader.onerror = () => {
      reject(new Error(`Could not read ${file.name}.`));
    };
    reader.readAsDataURL(file);
  });
}

function toolStatusLabel(status: JournalToolEventReadModel["status"]): string {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "done";
    case "failed":
      return "failed";
  }
}

function ToolEventList({ events }: { events: JournalToolEventReadModel[] }) {
  if (events.length === 0) return null;
  return (
    <ul className="journal-tool-events" aria-label="Journal tool activity">
      {events.map((event, index) => (
        <li
          key={`${event.name}-${index}`}
          className="journal-tool-event"
          data-status={event.status}
        >
          <span className="journal-tool-marker" aria-hidden="true">
            {event.status === "completed"
              ? "✓"
              : event.status === "failed"
                ? "×"
                : "…"}
          </span>
          <code className="journal-tool-name">{event.name}</code>
          <span className="journal-tool-state">
            {toolStatusLabel(event.status)}
          </span>
          {event.summary && (
            <span className="journal-tool-summary">{event.summary}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function JournalChatPane({
  messages,
  loading = false,
  onUploadChart,
  onSendMessage,
  onCancelRun,
  onClearHistory,
  onClose,
}: {
  messages: JournalChatMessageReadModel[];
  loading?: boolean;
  onUploadChart: (input: {
    base64Data: string;
    filename: string;
  }) => Promise<JournalUploadedChartReadModel>;
  onSendMessage: (input: {
    text: string;
    attachments: JournalChatAttachmentRef[];
  }) => Promise<void>;
  onCancelRun: () => Promise<void>;
  onClearHistory: () => Promise<void>;
  onClose?: () => void;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [busyAction, setBusyAction] = useState<
    "sending" | "canceling" | "clearing" | null
  >(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const attachmentsRef = useRef<PendingAttachment[]>(attachments);
  attachmentsRef.current = attachments;

  useEffect(() => {
    return () => {
      for (const item of attachmentsRef.current) {
        revokePreviewUrl(item.previewUrl);
      }
    };
  }, []);

  const activeRunMessage = messages.find(
    (message) =>
      message.role === "assistant" &&
      (message.status === "pending" || message.status === "running"),
  );
  const hasActiveRun = activeRunMessage !== undefined;
  const latestMessage = messages.at(-1);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages.length, latestMessage?.text, latestMessage?.toolEvents?.length]);

  function addFiles(incoming: File[]) {
    if (incoming.length === 0 || sendingRef.current) return;
    setError(null);
    const errors: string[] = [];
    const accepted: PendingAttachment[] = [];
    let remainingSlots =
      MAX_ATTACHMENTS_PER_MESSAGE - attachmentsRef.current.length;

    for (const file of incoming) {
      if (!isAllowedMimeType(file.type)) {
        errors.push(
          `${file.name || "Image"} is not supported. Use PNG, JPEG, or WEBP.`,
        );
        continue;
      }
      if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) {
        errors.push(`${file.name || "Image"} exceeds the 10 MB limit.`);
        continue;
      }
      if (remainingSlots <= 0) {
        errors.push(
          `Attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} images per message.`,
        );
        break;
      }
      remainingSlots -= 1;
      const fallbackName = file.name.trim() || `screenshot-${Date.now()}.png`;
      const normalizedFile =
        file.name.trim().length > 0
          ? file
          : new File([file], fallbackName, { type: file.type });
      accepted.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        file: normalizedFile,
        previewUrl: createPreviewUrl(normalizedFile),
      });
    }

    if (accepted.length > 0) {
      const next = [...attachmentsRef.current, ...accepted];
      attachmentsRef.current = next;
      setAttachments(next);
    }
    if (errors.length > 0) {
      setError(errors[0] ?? "Could not attach image.");
    }
  }

  function removeAttachment(id: string) {
    if (sendingRef.current) return;
    setAttachments((current) => {
      const target = current.find((item) => item.id === id);
      if (target) revokePreviewUrl(target.previewUrl);
      const next = current.filter((item) => item.id !== id);
      attachmentsRef.current = next;
      return next;
    });
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (sendingRef.current) return;
    const items = event.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      addFiles(files);
    }
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (sendingRef.current) return;
    if (!dragActive) setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }
    setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragActive(false);
    if (sendingRef.current) return;
    const dropped = Array.from(event.dataTransfer.files);
    addFiles(dropped);
  }

  async function handleSubmit(event?: FormEvent) {
    event?.preventDefault();
    if (sendingRef.current || busyAction !== null || hasActiveRun) return;
    const trimmed = text.trim();
    const captured = attachmentsRef.current.slice();
    if (!trimmed && captured.length === 0) return;

    sendingRef.current = true;
    const capturedIds = new Set(captured.map((item) => item.id));
    setBusyAction("sending");
    setError(null);
    try {
      const uploadedAttachments: JournalChatAttachmentRef[] = [];
      for (const pending of captured) {
        const filename = pending.file.name.trim() || "screenshot.png";
        let imageKey = pending.uploadedImageKey;
        if (!imageKey) {
          const base64Data = await readFileAsBase64(pending.file);
          const uploaded = await onUploadChart({ base64Data, filename });
          imageKey = uploaded.imageKey;
          const resolvedKey = imageKey;
          attachmentsRef.current = attachmentsRef.current.map((item) =>
            item.id === pending.id
              ? { ...item, uploadedImageKey: resolvedKey }
              : item,
          );
          setAttachments((current) =>
            current.map((item) =>
              item.id === pending.id
                ? { ...item, uploadedImageKey: resolvedKey }
                : item,
            ),
          );
        }
        uploadedAttachments.push({
          imageKey,
          filename,
        });
      }
      await onSendMessage({
        text: trimmed,
        attachments: uploadedAttachments,
      });
      setAttachments((current) => {
        for (const item of current) {
          if (capturedIds.has(item.id)) {
            revokePreviewUrl(item.previewUrl);
          }
        }
        const remaining = current.filter((item) => !capturedIds.has(item.id));
        attachmentsRef.current = remaining;
        return remaining;
      });
      setText("");
      textareaRef.current?.focus();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not send message. Try again.",
      );
    } finally {
      sendingRef.current = false;
      setBusyAction(null);
    }
  }

  async function handleStop() {
    if (busyAction !== null || !hasActiveRun) return;
    setBusyAction("canceling");
    setError(null);
    try {
      await onCancelRun();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not stop the active run.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleClearHistory() {
    if (busyAction !== null || hasActiveRun) return;
    setBusyAction("clearing");
    setError(null);
    try {
      await onClearHistory();
      setConfirmClear(false);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not clear chat history.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  const canSend =
    busyAction === null &&
    !hasActiveRun &&
    (text.trim().length > 0 || attachments.length > 0);

  return (
    <aside
      className="journal-chat-pane"
      aria-label="Journal Chat"
      data-drag-active={dragActive ? "true" : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="journal-chat-header">
        <div>
          <h2>Journal Chat</h2>
          <span className="journal-chat-subtitle">
            {hasActiveRun
              ? activeRunMessage.status === "pending"
                ? "Queued…"
                : "Working…"
              : "Paste fills or ask for a chart review"}
          </span>
        </div>
        <div className="journal-chat-header-actions">
          {!hasActiveRun && messages.length > 0 && !confirmClear && (
            <button
              type="button"
              className="journal-text-button"
              disabled={busyAction !== null}
              onClick={() => setConfirmClear(true)}
            >
              Clear chat
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="journal-icon-button"
              aria-label="Close Journal Chat"
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </header>

      {confirmClear && (
        <div className="journal-chat-confirm">
          <span>Clear all Journal Chat messages? Trades stay saved.</span>
          <div className="journal-chat-confirm-actions">
            <button
              type="button"
              className="journal-button journal-button--secondary journal-button--compact"
              disabled={busyAction !== null}
              onClick={() => setConfirmClear(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="journal-button journal-button--danger journal-button--compact"
              disabled={busyAction !== null}
              onClick={() => void handleClearHistory()}
            >
              {busyAction === "clearing" ? "Clearing…" : "Confirm clear"}
            </button>
          </div>
        </div>
      )}

      {dragActive && (
        <div className="journal-drop-overlay" aria-hidden="true">
          Drop brokerage or chart screenshots to attach
        </div>
      )}

      <div
        className="journal-chat-messages"
        ref={listRef}
        role="log"
        aria-label="Journal chat messages"
        aria-live="polite"
      >
        {loading ? (
          <p className="journal-chat-empty" role="status">
            Loading Journal Chat…
          </p>
        ) : messages.length === 0 ? (
          <div className="journal-chat-empty">
            <strong>Import fills or review a closed trade</strong>
            <p>
              Paste a Robinhood or brokerage screenshot with Cmd/Ctrl+V, drag an
              image here, or ask Codex to generate a TradingView chart review.
            </p>
          </div>
        ) : (
          messages.map((message) => {
            const isWorking =
              message.role === "assistant" &&
              (message.status === "pending" || message.status === "running");

            return (
              <article
                key={message.stableId}
                className="journal-chat-message"
                data-role={message.role}
                data-status={message.status}
              >
                <header className="journal-chat-message-meta">
                  <strong>
                    {message.role === "user" ? "You" : "Journal Agent"}
                  </strong>
                  <span>
                    {isWorking
                      ? message.status === "pending"
                        ? "Queued"
                        : "Running"
                      : formatChatTime(message.createdAt)}
                  </span>
                </header>

                {message.attachments.length > 0 && (
                  <div className="journal-chat-attachments">
                    {message.attachments.map((attachment) =>
                      attachment.url ? (
                        <a
                          key={`${message.stableId}-${attachment.imageKey}`}
                          className="journal-chat-thumb"
                          href={attachment.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <img src={attachment.url} alt={attachment.filename} />
                          <span>{attachment.filename}</span>
                        </a>
                      ) : (
                        <div
                          key={`${message.stableId}-${attachment.imageKey}`}
                          className="journal-chat-thumb journal-chat-thumb--missing"
                        >
                          <span>{attachment.filename}</span>
                        </div>
                      ),
                    )}
                  </div>
                )}

                {message.role === "assistant" &&
                  message.toolEvents &&
                  message.toolEvents.length > 0 && (
                    <ToolEventList events={message.toolEvents} />
                  )}

                {message.text &&
                  (message.role === "assistant" ? (
                    <div className="journal-chat-body">
                      <Markdown text={message.text} />
                    </div>
                  ) : (
                    <p className="journal-chat-user-text">{message.text}</p>
                  ))}

                {isWorking && !message.text && (
                  <p className="journal-chat-working" role="status">
                    {message.status === "pending"
                      ? "Waiting for Journal Agent…"
                      : "Inspecting diary and charts…"}
                  </p>
                )}

                {message.status === "failed" && (
                  <p className="journal-chat-error-note" role="alert">
                    {message.error || "The journal assistant run failed."}
                  </p>
                )}

                {message.status === "canceled" && (
                  <p className="journal-chat-canceled-note">Run stopped.</p>
                )}
              </article>
            );
          })
        )}
      </div>

      <form
        className="journal-chat-composer"
        onSubmit={(event) => void handleSubmit(event)}
      >
        {error && (
          <p className="journal-form-error" role="alert">
            {error}
          </p>
        )}

        {attachments.length > 0 && (
          <ul
            className="journal-pending-attachments"
            aria-label="Pending screenshot attachments"
          >
            {attachments.map((pending) => (
              <li key={pending.id} className="journal-pending-item">
                {pending.previewUrl && (
                  <img src={pending.previewUrl} alt={pending.file.name} />
                )}
                <div className="journal-pending-meta">
                  <span title={pending.file.name}>{pending.file.name}</span>
                  <small>{formatFileSize(pending.file.size)}</small>
                </div>
                <button
                  type="button"
                  className="journal-icon-button journal-icon-button--small"
                  aria-label={`Remove ${pending.file.name}`}
                  disabled={busyAction !== null}
                  onClick={() => removeAttachment(pending.id)}
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="sr-only" htmlFor="journal-chat-input">
          Message Journal Chat
        </label>
        <textarea
          id="journal-chat-input"
          ref={textareaRef}
          rows={3}
          maxLength={20_000}
          placeholder="Paste a brokerage screenshot or ask for a trade review…"
          value={text}
          disabled={busyAction !== null}
          onChange={(event) => setText(event.target.value)}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
        />

        <div className="journal-chat-composer-bar">
          <div className="journal-chat-composer-left">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              aria-label="Attach screenshot files"
              onChange={(event) => {
                const selected = event.target.files
                  ? Array.from(event.target.files)
                  : [];
                addFiles(selected);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="journal-button journal-button--secondary journal-button--compact"
              disabled={busyAction !== null || hasActiveRun}
              onClick={() => fileInputRef.current?.click()}
            >
              <PaperclipIcon />
              <span>Attach</span>
            </button>
            <span className="journal-composer-hint">
              {busyAction === "sending"
                ? "Uploading…"
                : "PNG/JPG/WEBP · Paste or drop"}
            </span>
          </div>

          {hasActiveRun ? (
            <button
              type="button"
              className="journal-button journal-button--danger journal-button--compact"
              disabled={busyAction !== null}
              onClick={() => void handleStop()}
            >
              <StopIcon />
              <span>{busyAction === "canceling" ? "Stopping…" : "Stop"}</span>
            </button>
          ) : (
            <button
              type="submit"
              className="journal-button journal-button--primary journal-button--compact"
              disabled={!canSend}
              aria-label="Send journal message"
            >
              <SendIcon />
              <span>Send</span>
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}
