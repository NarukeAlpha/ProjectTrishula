import type {
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";
import type { Logger } from "../runtime/logger.js";
import {
  fetchJournalAttachment,
  type AttachmentFetchOptions,
} from "./attachments.js";
import type { ChartProvider } from "./charts/index.js";
import {
  MAX_JOURNAL_CHAT_TEXT_LENGTH,
  type JournalChatAttachment,
  type JournalChatMessage,
  type JournalRunRequest,
  type JournalToolEvent,
} from "./contracts.js";
import {
  JournalConvexError,
  JournalRunInactiveError,
  type JournalConvexClient,
  type JournalRunCompleteInput,
  type JournalRunCredentials,
  type JournalRunProgressInput,
} from "./convex-client.js";
import type { JournalModelAdapter, JournalModelReadiness } from "./model.js";
import { buildJournalSystemPrompt } from "./prompt.js";
import {
  describeToolStart,
  executeJournalTool,
  journalTools,
} from "./tools.js";

export const DEFAULT_MAX_JOURNAL_ITERATIONS = 16;
const MAX_TOOL_EVENTS = 64;
const MAX_HISTORY_ATTACHMENT_IMAGES = 4;
const DEFAULT_COMPLETE_RETRY_DELAYS_MS = [250, 750] as const;

export interface JournalAgentRunnerReadiness extends JournalModelReadiness {
  chartImgConfigured: boolean;
}

export interface JournalAgentRunner {
  initialize(): Promise<void>;
  readiness(): JournalAgentRunnerReadiness;
  run(request: JournalRunRequest, signal?: AbortSignal): Promise<void>;
  dispose(): Promise<void>;
}

export interface JournalAgentRunnerOptions {
  model: JournalModelAdapter;
  convex: JournalConvexClient;
  chartProvider: ChartProvider;
  convexSiteUrl: string;
  convexCloudOrigin?: string;
  allowedAttachmentOrigins?: readonly string[];
  attachmentFetch?: typeof fetch;
  completeRetryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  logger: Logger;
  maxIterations?: number;
  now?: () => number;
}

function extractText(message: AssistantMessage): string {
  return message.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}

function extractToolCalls(message: AssistantMessage): ToolCall[] {
  return message.content.filter((part): part is ToolCall => part.type === "toolCall");
}

function truncateText(text: string): string {
  if (text.length <= MAX_JOURNAL_CHAT_TEXT_LENGTH) return text;
  return text.slice(0, MAX_JOURNAL_CHAT_TEXT_LENGTH);
}

function formatAttachmentNote(attachment: JournalChatAttachment, detail?: string): string {
  const suffix = detail ? ` (${detail})` : "";
  return `[Attached image: ${attachment.filename}, imageKey=${attachment.imageKey}${suffix}]`;
}

async function buildUserMessageWithAttachments(
  message: JournalChatMessage,
  fetchOptions: AttachmentFetchOptions,
  loadImages: boolean,
  imageBudget: { remaining: number },
  logger: Logger,
  signal: AbortSignal,
): Promise<UserMessage> {
  const notes: string[] = [];
  const images: ImageContent[] = [];

  for (const attachment of message.attachments) {
    if (!loadImages || imageBudget.remaining <= 0) {
      notes.push(formatAttachmentNote(attachment));
      continue;
    }
    const fetched = await fetchJournalAttachment(attachment, fetchOptions, signal);
    if (fetched.ok) {
      imageBudget.remaining -= 1;
      images.push(fetched.value.image);
      notes.push(
        formatAttachmentNote(
          attachment,
          `${fetched.value.width}x${fetched.value.height} ${fetched.value.mimeType}`,
        ),
      );
    } else {
      logger.warn("journal_attachment_fetch_failed", {
        imageKey: attachment.imageKey,
        filename: attachment.filename,
        reason: fetched.reason.slice(0, 200),
      });
      notes.push(formatAttachmentNote(attachment, `could not load image: ${fetched.reason}`));
    }
  }

  const combinedText = [message.text.trim(), ...notes].filter((part) => part.length > 0).join("\n\n");
  if (images.length === 0) {
    return {
      role: "user",
      content: combinedText || "(empty message)",
      timestamp: message.createdAt,
    };
  }
  const content: (TextContent | ImageContent)[] = [];
  if (combinedText.length > 0) {
    content.push({ type: "text", text: combinedText });
  }
  content.push(...images);
  return {
    role: "user",
    content,
    timestamp: message.createdAt,
  };
}

async function buildInitialMessages(
  request: JournalRunRequest,
  fetchOptions: AttachmentFetchOptions,
  logger: Logger,
  signal: AbortSignal,
): Promise<Message[]> {
  const messages: Message[] = [];
  const recentHistoryWithAttachments = new Set<string>();
  for (let index = request.history.length - 1; index >= 0; index -= 1) {
    const entry = request.history[index];
    if (entry && entry.role === "user" && entry.attachments.length > 0) {
      recentHistoryWithAttachments.add(entry.stableId);
      if (recentHistoryWithAttachments.size >= 2) break;
    }
  }

  const historyBudget = { remaining: MAX_HISTORY_ATTACHMENT_IMAGES };
  for (const entry of request.history) {
    if (entry.role === "user") {
      messages.push(
        await buildUserMessageWithAttachments(
          entry,
          fetchOptions,
          recentHistoryWithAttachments.has(entry.stableId),
          historyBudget,
          logger,
          signal,
        ),
      );
      continue;
    }
    if (entry.status !== "completed" || entry.text.trim().length === 0) {
      continue;
    }
    messages.push({
      role: "assistant",
      content: [{ type: "text", text: entry.text }],
      api: "openai-codex-responses",
      provider: "openai-codex",
      model: "history",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: entry.updatedAt,
    });
  }

  const currentBudget = { remaining: request.userMessage.attachments.length };
  messages.push(
    await buildUserMessageWithAttachments(
      request.userMessage,
      fetchOptions,
      true,
      currentBudget,
      logger,
      signal,
    ),
  );
  return messages;
}

function isAbortSignalCanceled(signal: AbortSignal): boolean {
  if (!signal.aborted) return false;
  return signal.reason instanceof Error && signal.reason.message === "journal_run_canceled";
}

function isAbortSignalTimedOut(signal: AbortSignal): boolean {
  if (!signal.aborted) return false;
  return signal.reason instanceof Error && signal.reason.message === "journal_run_timeout";
}

function isAbortSignalShutdown(signal: AbortSignal): boolean {
  if (!signal.aborted) return false;
  return signal.reason instanceof Error && signal.reason.message === "journal_service_shutdown";
}

function errorMessageFrom(error: Error | string): string {
  return (error instanceof Error ? error.message : error).trim().slice(0, 800);
}

function isRetryableCompleteError(error: Error): boolean {
  if (error instanceof JournalRunInactiveError) return false;
  if (error instanceof JournalConvexError) {
    if (error.httpStatus === undefined) return true;
    return error.httpStatus >= 500;
  }
  return true;
}

async function defaultBackoffSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

class DefaultJournalAgentRunner implements JournalAgentRunner {
  private readonly maxIterations: number;
  private readonly now: () => number;
  private readonly completeRetryDelaysMs: readonly number[];
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: JournalAgentRunnerOptions) {
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_JOURNAL_ITERATIONS;
    this.now = options.now ?? Date.now;
    this.completeRetryDelaysMs = options.completeRetryDelaysMs ?? DEFAULT_COMPLETE_RETRY_DELAYS_MS;
    this.sleep = options.sleep ?? defaultBackoffSleep;
  }

  async initialize(): Promise<void> {
    await this.options.model.initialize();
  }

  readiness(): JournalAgentRunnerReadiness {
    const modelReadiness = this.options.model.readiness();
    const readiness: JournalAgentRunnerReadiness = {
      ready: modelReadiness.ready,
      chartImgConfigured: this.options.chartProvider.isConfigured(),
    };
    if (modelReadiness.reason !== undefined) {
      readiness.reason = modelReadiness.reason;
    }
    return readiness;
  }

  async run(request: JournalRunRequest, callerSignal?: AbortSignal): Promise<void> {
    const signal = callerSignal ?? new AbortController().signal;
    const credentials: JournalRunCredentials = {
      ownerId: request.ownerId,
      runId: request.runId,
      runToken: request.runToken,
    };
    const toolEvents: JournalToolEvent[] = [];
    let finalized = false;
    let inactiveStop = false;
    let outcome:
      | { status: "completed"; text: string }
      | { status: "canceled"; text: string }
      | { status: "failed"; text: string; error: string } = {
        status: "failed",
        text: "",
        error: "Journal assistant run did not produce a final response.",
      };

    const pushProgress = async (text?: string): Promise<void> => {
      if (signal.aborted) return;
      const payload: JournalRunProgressInput = {};
      if (text !== undefined) payload.text = truncateText(text);
      if (toolEvents.length > 0) payload.toolEvents = toolEvents.slice(0, MAX_TOOL_EVENTS);
      try {
        const result = await this.options.convex.reportProgress(credentials, payload, signal);
        if (!result.accepted) {
          throw new JournalRunInactiveError(result.reason ?? "run_not_active", 409);
        }
      } catch (error) {
        if (error instanceof JournalRunInactiveError) throw error;
        if (signal.aborted) return;
        this.options.logger.warn("journal_progress_callback_failed", {
          runId: request.runId,
          error: error instanceof Error ? error.message.slice(0, 200) : "progress_failed",
        });
      }
    };

    try {
      signal.throwIfAborted();
      const fetchOptions: AttachmentFetchOptions = {
        convexSiteUrl: this.options.convexSiteUrl,
      };
      if (this.options.convexCloudOrigin !== undefined) {
        fetchOptions.convexCloudOrigin = this.options.convexCloudOrigin;
      }
      if (this.options.allowedAttachmentOrigins !== undefined) {
        fetchOptions.allowedOrigins = this.options.allowedAttachmentOrigins;
      }
      if (this.options.attachmentFetch !== undefined) {
        fetchOptions.fetch = this.options.attachmentFetch;
      }

      const systemPrompt = buildJournalSystemPrompt(request.settings);
      const messages = await buildInitialMessages(
        request,
        fetchOptions,
        this.options.logger,
        signal,
      );

      let finalAssistantText = "";
      let completedCleanly = false;

      for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
        signal.throwIfAborted();
        const assistantMessage = await this.options.model.complete({
          context: {
            systemPrompt,
            messages,
            tools: journalTools,
          },
          signal,
        });

        if (assistantMessage.stopReason === "aborted") {
          if (isAbortSignalCanceled(signal)) {
            outcome = { status: "canceled", text: "" };
            return;
          }
          if (isAbortSignalTimedOut(signal)) {
            outcome = {
              status: "failed",
              text: "",
              error: "Journal assistant run timed out.",
            };
            return;
          }
          throw new Error(assistantMessage.errorMessage ?? "Journal model request was aborted.");
        }

        if (assistantMessage.stopReason === "error") {
          throw new Error(assistantMessage.errorMessage ?? "Journal model returned an error.");
        }

        messages.push(assistantMessage);
        const toolCalls = extractToolCalls(assistantMessage);
        const text = extractText(assistantMessage);

        if (toolCalls.length === 0) {
          finalAssistantText = text;
          completedCleanly = true;
          break;
        }

        for (const toolCall of toolCalls) {
          signal.throwIfAborted();
          const eventIndex = toolEvents.length < MAX_TOOL_EVENTS ? toolEvents.length : -1;
          const startSummary = describeToolStart(toolCall);
          if (eventIndex >= 0) {
            toolEvents.push({
              name: toolCall.name,
              status: "running",
              summary: startSummary,
            });
          }
          await pushProgress(text.length > 0 ? text : undefined);

          const result = await executeJournalTool(toolCall, {
            credentials,
            settings: request.settings,
            convex: this.options.convex,
            chartProvider: this.options.chartProvider,
            signal,
          });

          if (eventIndex >= 0) {
            toolEvents[eventIndex] = {
              name: toolCall.name,
              status: result.isError ? "failed" : "completed",
              summary: result.completedSummary.slice(0, 500),
            };
          }
          await pushProgress();

          const toolResultMessage: ToolResultMessage = {
            role: "toolResult",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: result.content,
            isError: result.isError,
            timestamp: this.now(),
          };
          messages.push(toolResultMessage);
        }
      }

      if (!completedCleanly) {
        outcome = {
          status: "failed",
          text: "",
          error: `Journal assistant reached the maximum of ${this.maxIterations} tool steps without finishing.`,
        };
        return;
      }

      outcome = {
        status: "completed",
        text: truncateText(finalAssistantText || "Done."),
      };
    } catch (error) {
      if (error instanceof JournalRunInactiveError) {
        inactiveStop = true;
        this.options.logger.info("journal_run_stopped_inactive", {
          runId: request.runId,
          reason: error.reason,
        });
        return;
      }
      if (isAbortSignalCanceled(signal)) {
        outcome = { status: "canceled", text: "" };
        return;
      }
      if (isAbortSignalTimedOut(signal)) {
        outcome = {
          status: "failed",
          text: "",
          error: "Journal assistant run timed out.",
        };
        return;
      }
      if (isAbortSignalShutdown(signal)) {
        outcome = {
          status: "failed",
          text: "",
          error: "Journal assistant was interrupted by a service restart. Please retry.",
        };
        return;
      }
      const message = error instanceof Error
        ? errorMessageFrom(error)
        : "Unexpected journal agent error.";
      this.options.logger.error("journal_run_failed", {
        runId: request.runId,
        error: message,
      });
      outcome = {
        status: "failed",
        text: "",
        error: message || "Unexpected journal agent error.",
      };
    } finally {
      if (!inactiveStop && !finalized) {
        finalized = true;
        const completePayload: JournalRunCompleteInput = {
          status: outcome.status,
          text: outcome.text,
        };
        if (toolEvents.length > 0) {
          completePayload.toolEvents = toolEvents.slice(0, MAX_TOOL_EVENTS);
        }
        if (outcome.status === "failed") {
          completePayload.error = outcome.error;
        }
        const maxAttempts = this.completeRetryDelaysMs.length + 1;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          try {
            await this.options.convex.completeRun(credentials, completePayload);
            break;
          } catch (completeError) {
            const errorObj = completeError instanceof Error
              ? completeError
              : new Error("complete_failed");
            const delayMs = this.completeRetryDelaysMs[attempt];
            const canRetry = delayMs !== undefined && isRetryableCompleteError(errorObj);
            if (!canRetry) {
              this.options.logger.error("journal_complete_callback_failed", {
                runId: request.runId,
                status: outcome.status,
                attempt: attempt + 1,
                error: errorObj.message.slice(0, 200),
              });
              break;
            }
            this.options.logger.warn("journal_complete_callback_retry", {
              runId: request.runId,
              status: outcome.status,
              attempt: attempt + 1,
              delayMs,
              error: errorObj.message.slice(0, 200),
            });
            await this.sleep(delayMs);
          }
        }
      }
    }
  }

  async dispose(): Promise<void> {
    await this.options.model.dispose();
  }
}

export function createJournalAgentRunner(options: JournalAgentRunnerOptions): JournalAgentRunner {
  return new DefaultJournalAgentRunner(options);
}
