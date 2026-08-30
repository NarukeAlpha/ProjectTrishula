import {
  Component,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type {
  ActiveRunReadModel,
  AssistantPart,
  MessageReadModel,
  ToolPart,
} from "../../convex/types";
import { formatDuration, formatTokens } from "../../shared/formatting/values";
import { assembleLiveParts } from "./live";
import { LiveMarkdown } from "./LiveMarkdown";
import { Markdown } from "./Markdown";

interface LivePresentation {
  assistantMessageId: string;
  acceptedThrough: number;
  hasGap: boolean;
  parts: AssistantPart[];
}

const FOLLOW_THRESHOLD_PX = 96;
const SCROLL_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
]);

function Tool({ part }: { part: ToolPart }) {
  const label = part.name
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return (
    <details className="tool" open={part.status === "running"}>
      <summary>
        <span
          className="tool-dot"
          data-status={part.status}
          aria-hidden="true"
        />
        <strong>{label}</strong>
        <span>
          {part.status}
          {part.durationMs === undefined
            ? ""
            : ` · ${formatDuration(part.durationMs)}`}
        </span>
      </summary>
      {(part.inputSummary || part.outputSummary) && (
        <div>
          <p>{part.inputSummary}</p>
          <p>{part.outputSummary}</p>
        </div>
      )}
    </details>
  );
}

function Parts({
  parts,
  live = false,
  smoothLiveText = false,
}: {
  parts: AssistantPart[];
  live?: boolean;
  smoothLiveText?: boolean;
}) {
  const nodes: ReactNode[] = [];
  let anchor = "start";
  let textCount = 0;
  let errorCount = 0;
  for (const [index, part] of parts.entries()) {
    if (part.type === "text") {
      textCount += 1;
      nodes.push(
        live ? (
          <LiveMarkdown
            animate={smoothLiveText && index === parts.length - 1}
            key={`text:${anchor}:${textCount}`}
            text={part.text}
          />
        ) : (
          <Markdown key={`text:${anchor}:${textCount}`} text={part.text} />
        ),
      );
      continue;
    }
    if (part.type === "tool") {
      anchor = part.toolCallId;
      textCount = 0;
      errorCount = 0;
      nodes.push(<Tool key={part.toolCallId} part={part} />);
      continue;
    }
    errorCount += 1;
    nodes.push(
      <section
        className="failure"
        key={`error:${anchor}:${part.code}:${errorCount}`}
        role="alert"
      >
        <strong>
          {part.retryable ? "Trishula could not finish" : "Trishula stopped"}
        </strong>
        <p>{part.message}</p>
        <code>{part.code}</code>
      </section>,
    );
  }
  return nodes;
}

function Message({
  message,
  parts,
  live,
  smoothLiveText,
}: {
  message: MessageReadModel;
  parts: AssistantPart[];
  live?: boolean;
  smoothLiveText?: boolean;
}) {
  const tokenCount =
    message.metrics?.totalTokens ??
    (message.metrics?.inputTokens === undefined &&
    message.metrics?.outputTokens === undefined
      ? undefined
      : (message.metrics?.inputTokens ?? 0) +
        (message.metrics?.outputTokens ?? 0));
  const totalTokens = formatTokens(tokenCount);
  const duration = formatDuration(
    message.metrics?.runDurationMs ?? message.metrics?.totalRunDurationMs,
  );
  return (
    <article
      className="message"
      data-live={live ? "true" : undefined}
      data-role={message.role}
      aria-label={`${message.role} message`}
    >
      <header className="message-header">
        <strong>{message.role === "user" ? "You" : "Trishula"}</strong>
        {live && (
          <span className="streaming">
            <i aria-hidden="true" /> Writing
          </span>
        )}
      </header>
      <div className="message-body">
        <Parts parts={parts} live={live} smoothLiveText={smoothLiveText} />
      </div>
      {message.role === "assistant" &&
        (totalTokens || duration || message.metrics?.model) && (
          <footer className="metrics" aria-label="Run metrics">
            {message.metrics?.model && <span>{message.metrics.model}</span>}
            {totalTokens && <span>{totalTokens} tokens</span>}
            {duration && <span>{duration}</span>}
          </footer>
        )}
    </article>
  );
}

function MessageListView({
  messages,
  presentation,
}: {
  messages: MessageReadModel[];
  presentation: LivePresentation | null;
}) {
  const stack = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const followFrame = useRef<number | null>(null);
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user")?.stableId;
  const previousUserMessage = useRef(latestUserMessage);
  const scheduleFollow = useCallback(() => {
    if (!follow.current || followFrame.current !== null) return;
    followFrame.current = requestAnimationFrame(() => {
      followFrame.current = null;
      if (!follow.current) return;
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "auto",
      });
    });
  }, []);
  const suspendFollow = useCallback(() => {
    follow.current = false;
    if (followFrame.current !== null) {
      cancelAnimationFrame(followFrame.current);
      followFrame.current = null;
    }
  }, []);
  useEffect(() => {
    scheduleFollow();
  }, [presentation?.acceptedThrough, messages.length, scheduleFollow]);
  useEffect(() => {
    if (
      latestUserMessage &&
      latestUserMessage !== previousUserMessage.current
    ) {
      previousUserMessage.current = latestUserMessage;
      follow.current = true;
      scheduleFollow();
    }
  }, [latestUserMessage, scheduleFollow]);
  useEffect(() => {
    const target = stack.current;
    if (!target || !("ResizeObserver" in globalThis)) return;
    const observer = new ResizeObserver(scheduleFollow);
    observer.observe(target);
    return () => observer.disconnect();
  }, [scheduleFollow]);
  useEffect(
    () => () => {
      if (followFrame.current !== null)
        cancelAnimationFrame(followFrame.current);
    },
    [],
  );
  useEffect(() => {
    const onWheel = () => suspendFollow();
    const onTouchStart = () => suspendFollow();
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.defaultPrevented ||
        !SCROLL_KEYS.has(event.key) ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      suspendFollow();
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [suspendFollow]);
  useEffect(() => {
    const onScroll = () => {
      follow.current =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - FOLLOW_THRESHOLD_PX;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="message-stack" ref={stack}>
      {messages.map((message) => {
        const isLiveMessage =
          presentation?.assistantMessageId === message.stableId &&
          message.role === "assistant" &&
          (message.status === "pending" || message.status === "streaming");
        const canonicalParts =
          message.role === "user"
            ? [{ type: "text" as const, text: message.text ?? "" }]
            : message.parts;
        return (
          <Message
            key={message.stableId}
            message={message}
            parts={isLiveMessage ? presentation.parts : canonicalParts}
            live={isLiveMessage}
            smoothLiveText={isLiveMessage && !presentation.hasGap}
          />
        );
      })}
      {presentation?.hasGap && (
        <div className="notice warning" role="status">
          Live output paused while Trishula restores a missing batch.
        </div>
      )}
    </div>
  );
}

interface MessageListProps {
  messages: MessageReadModel[];
  activeRun: ActiveRunReadModel | null;
}

interface MessageListState {
  presentation: LivePresentation | null;
}

class MessageListPresentation extends Component<
  MessageListProps,
  MessageListState
> {
  state: MessageListState = { presentation: null };

  static getDerivedStateFromProps(
    { messages, activeRun }: MessageListProps,
    state: MessageListState,
  ): MessageListState | null {
    if (activeRun) {
      const message = messages.find(
        (candidate) =>
          candidate.stableId === activeRun.assistantMessage.stableId,
      );
      if (
        message &&
        message.role === "assistant" &&
        !["pending", "streaming"].includes(message.status)
      ) {
        return state.presentation ? { presentation: null } : null;
      }
      const live = assembleLiveParts(activeRun.batches);
      return {
        presentation: {
          assistantMessageId: activeRun.assistantMessage.stableId,
          acceptedThrough: live.acceptedThrough,
          hasGap: live.hasGap,
          parts: live.parts,
        },
      };
    }

    if (!state.presentation) return null;
    const message = messages.find(
      (candidate) =>
        candidate.stableId === state.presentation?.assistantMessageId,
    );
    if (
      message?.role === "assistant" &&
      ["pending", "streaming"].includes(message.status)
    ) {
      return null;
    }
    return { presentation: null };
  }

  render() {
    return (
      <MessageListView
        messages={this.props.messages}
        presentation={this.state.presentation}
      />
    );
  }
}

export function MessageList(props: MessageListProps) {
  return <MessageListPresentation {...props} />;
}
