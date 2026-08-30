import {
  fauxAssistantMessage,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { Type } from "typebox";
import type { AppConfig } from "../config.js";
import type {
  ConversationHistoryMessage,
  PiEvent,
  RunExecutionRequest,
  RunMetrics,
} from "../contracts.js";
import type {
  ExecutionExecutor,
  EmitPiEvent,
  ExecutorReadiness,
  SessionScope,
} from "../execution/executor.js";
import { createTradingBroker } from "../broker/trading-broker.js";
import type { ApplicationToolArguments, TradingBroker } from "../broker/types.js";

interface SafeError {
  code: string;
  message: string;
  retryable: boolean;
}

interface ToolInput {
  readonly symbol?: string;
  readonly side?: string;
}

interface ToolResultDetails {
  readonly details?: {
    readonly ok?: boolean;
    readonly proposalId?: string;
  };
}

const allowedToolNames = [
  "get_accounts",
  "get_portfolio",
  "get_equity_positions",
  "get_equity_quotes",
  "get_equity_orders",
  "propose_order",
] as const;
const MAX_PENDING_PI_EVENTS = 256;
const MAX_PENDING_PI_EVENT_BYTES = 256 * 1_024;
const IN_MEMORY_RUNTIME_CWD = "/tmp";

const systemPrompt = `You are a phone-first trading assistant.

Your only application tools are get_accounts, get_portfolio, get_equity_positions, get_equity_quotes, get_equity_orders, and propose_order. You have no shell, process, code execution, write, edit, browser, general filesystem, or general network tools.

Use read tools to answer account, portfolio, position, quote, and order questions. A proposed order must include the symbol, side, sizing, order type, time in force, and review reference. propose_order only creates a reviewable proposal. It never submits an order. Never claim that an order was placed. The user approval flow is the only path that can submit a reviewed proposal.

Keep answers concise, state the data source status, and do not expose access tokens, OAuth codes, or stored credentials.`;

interface SessionEntry {
  session: AgentSession;
  active: boolean;
  activeTools: Map<string, { name: string; startedAt: number }>;
  toolContext: { actorId: string; threadId: string; runId: string } | undefined;
}

function scopeKey(scope: SessionScope): string {
  return createHash("sha256").update(JSON.stringify([scope.actorId, scope.threadId])).digest("hex");
}

function textFromHistory(message: ConversationHistoryMessage): string {
  return message.parts.map((part) => {
    if (part.type === "text") return part.text;
    if (part.type === "error") return `[Prior run error: ${part.code}: ${part.message}]`;
    const summaries = [part.inputSummary, part.outputSummary].filter(Boolean).join("; ");
    return `[Tool ${part.name} ${part.status}${summaries ? `: ${summaries}` : ""}]`;
  }).join("\n").trim();
}

function safeError(error: Error): SafeError {
  const raw = error.message;
  const message = raw.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 2_000);
  const normalized = message.toLowerCase();
  if (normalized.includes("rate") || normalized.includes("429")) {
    return { code: "provider_rate_limit", message: "The model provider is busy. Try again.", retryable: true };
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return { code: "provider_timeout", message: "The model provider did not respond in time.", retryable: true };
  }
  if (normalized.includes("abort")) {
    return { code: "run_aborted", message: "The run was stopped.", retryable: true };
  }
  return { code: "provider_error", message: message || "The model provider could not finish the response.", retryable: true };
}

function aggregateMetrics(
  messages: AssistantMessage[],
  startedAt: number,
  firstVisibleTextAt: number | undefined,
  firstOutputAt: number | undefined,
  lastAssistantEndAt: number | undefined,
  endedAt: number,
): RunMetrics {
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let estimatedCostUsd = 0;
  const models = new Map<string, { provider: string; model: string }>();
  for (const message of messages) {
    inputTokens += message.usage.input;
    cacheReadTokens += message.usage.cacheRead;
    cacheWriteTokens += message.usage.cacheWrite;
    outputTokens += message.usage.output;
    totalTokens += message.usage.totalTokens;
    estimatedCostUsd += message.usage.cost.total;
    const model = message.responseModel ?? message.model;
    models.set(`${message.provider}\0${model}`, { provider: message.provider, model });
  }
  const outputDuration = firstOutputAt === undefined || lastAssistantEndAt === undefined
    ? undefined
    : lastAssistantEndAt - firstOutputAt;
  const selected = models.size === 1 ? models.values().next().value : undefined;
  const metrics: RunMetrics = {
    inputTokens,
    promptTokens: inputTokens + cacheReadTokens + cacheWriteTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd,
    ttftMs: firstVisibleTextAt === undefined ? null : Math.max(0, Math.round(firstVisibleTextAt - startedAt)),
    timeToFirstOutputMs: firstOutputAt === undefined ? null : Math.max(0, Math.round(firstOutputAt - startedAt)),
    runDurationMs: Math.max(0, Math.round(endedAt - startedAt)),
    approximateOutputTps: outputDuration === undefined || outputDuration <= 0 || outputTokens === 0
      ? null
      : outputTokens / (outputDuration / 1_000),
  };
  if (selected) {
    metrics.provider = selected.provider;
    metrics.model = selected.model;
  }
  return metrics;
}

class PiExecutionExecutor implements ExecutionExecutor {
  private runtime: ModelRuntime | undefined;
  private model: ReturnType<ModelRuntime["getModel"]> = undefined;
  private initializationError: string | undefined;
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(
    private readonly config: AppConfig,
    private readonly broker: TradingBroker,
  ) {}

  async initialize(): Promise<void> {
    try {
      this.runtime = await ModelRuntime.create({
        authPath: this.config.piAuthPath,
        modelsPath: null,
        refreshOnCreate: true,
      });
      if (!this.runtime.hasConfiguredAuth("openai-codex")) {
        throw new Error(`OpenAI Codex auth is not configured at ${this.config.piAuthPath}.`);
      }
      this.model = this.runtime.getModel("openai-codex", this.config.piModel);
      if (!this.model) throw new Error(`Pi does not recognize OpenAI Codex model ${this.config.piModel}.`);
      const auth = await this.runtime.getAuth(this.model, { minOAuthValidityMs: 0 });
      if (!auth) throw new Error("OpenAI Codex auth is not ready.");
      this.initializationError = undefined;
    } catch (error) {
      this.initializationError = safeError(error instanceof Error ? error : new Error("Unknown model-provider error.")).message;
      this.runtime = undefined;
      this.model = undefined;
      throw error;
    }
  }

  readiness(): ExecutorReadiness {
    const ready = Boolean(this.runtime && this.model);
    const result: ExecutorReadiness = { ready };
    if (!ready && this.initializationError) result.reason = this.initializationError;
    return result;
  }

  async execute(request: RunExecutionRequest, emit: EmitPiEvent, signal: AbortSignal): Promise<void> {
    if (!this.runtime || !this.model) throw new Error("Pi is not ready.");
    const key = scopeKey({ actorId: request.actorId, threadId: request.threadId });
    let entry = this.sessions.get(key);
    if (!entry) {
      entry = await this.createSession(request.history);
      this.sessions.set(key, entry);
    }
    if (entry.active) throw new Error("A Pi run is already active for this thread.");
    entry.active = true;
    entry.toolContext = { actorId: request.actorId, threadId: request.threadId, runId: request.runId };

    let terminalSent = false;
    let eventWrites = Promise.resolve();
    let pendingEventCount = 0;
    let pendingEventBytes = 0;
    let streamFailure: Error | undefined;
    let agentStartedAt = performance.now();
    let firstVisibleTextAt: number | undefined;
    let firstOutputAt: number | undefined;
    let lastAssistantEndAt: number | undefined;
    const assistantMessages: AssistantMessage[] = [];
    const queueEvent = (event: PiEvent): void => {
      if (terminalSent || streamFailure) return;
      const eventBytes = Buffer.byteLength(JSON.stringify(event), "utf8");
      if (
        pendingEventCount + 1 > MAX_PENDING_PI_EVENTS ||
        pendingEventBytes + eventBytes > MAX_PENDING_PI_EVENT_BYTES
      ) {
        streamFailure = new Error("Pi output exceeded the bounded result-delivery buffer.");
        // Pi subscriptions are synchronous, so they cannot await result writes.
        // Abort the session when the explicit delivery safety valve is reached.
        void entry!.session.abort();
        return;
      }
      pendingEventCount += 1;
      pendingEventBytes += eventBytes;
      eventWrites = eventWrites
        .then(() => emit(event))
        .catch((error: Error) => {
          streamFailure ??= error;
          void entry!.session.abort();
        })
        .finally(() => {
          pendingEventCount -= 1;
          pendingEventBytes -= eventBytes;
        });
    };
    const sendTerminal = async (event: Extract<PiEvent, { type: "completed" | "error" | "canceled" }>) => {
      if (terminalSent) return;
      terminalSent = true;
      await eventWrites;
      await emit(event);
    };

    const unsubscribe = entry.session.subscribe((event) => {
      const now = performance.now();
      if (event.type === "agent_start") {
        agentStartedAt = now;
      } else if (event.type === "agent_end") {
        assistantMessages.push(...event.messages.filter(
          (message): message is AssistantMessage => message.role === "assistant",
        ));
      } else if (event.type === "message_end" && event.message.role === "assistant") {
        lastAssistantEndAt = now;
      } else if (event.type === "message_update") {
        const update = event.assistantMessageEvent;
        if (
          firstOutputAt === undefined &&
          ((update.type === "text_delta" && update.delta.length > 0) ||
            (update.type === "thinking_delta" && update.delta.length > 0) ||
            (update.type === "toolcall_delta" && update.delta.length > 0))
        ) firstOutputAt = now;
        if (update.type === "text_delta" && update.delta.length > 0) {
          if (firstVisibleTextAt === undefined && update.delta.trim().length > 0) firstVisibleTextAt = now;
          queueEvent({ type: "text_delta", text: update.delta });
        }
      } else if (event.type === "tool_execution_start") {
        firstOutputAt ??= now;
        entry!.activeTools.set(event.toolCallId, { name: event.toolName, startedAt: Date.now() });
        const inputSummary = this.summarizeToolInput(event.toolName, event.args);
        const toolStart: PiEvent = {
          type: "tool_start",
          toolCallId: event.toolCallId,
          name: event.toolName,
        };
        if (toolStart.type === "tool_start" && inputSummary) toolStart.inputSummary = inputSummary;
        queueEvent(toolStart);
      } else if (event.type === "tool_execution_end") {
        const active = entry!.activeTools.get(event.toolCallId);
        const name = active?.name ?? event.toolName;
        const outputSummary = this.summarizeToolResult(name, event.result);
        const toolEnd: PiEvent = {
          type: "tool_end",
          toolCallId: event.toolCallId,
          name,
          ok: !event.isError,
          durationMs: active ? Math.max(0, Date.now() - active.startedAt) : 0,
        };
        if (toolEnd.type === "tool_end" && outputSummary) toolEnd.outputSummary = outputSummary;
        queueEvent(toolEnd);
        entry!.activeTools.delete(event.toolCallId);
      }
    });

    const abort = () => { void entry!.session.abort(); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (signal.aborted) {
        await sendTerminal({ type: "canceled" });
        return;
      }
      await entry.session.prompt(request.prompt);
      if (streamFailure) throw streamFailure;
      if (signal.aborted) {
        await sendTerminal({ type: "canceled" });
      } else {
        await sendTerminal({
          type: "completed",
          metrics: aggregateMetrics(
            assistantMessages,
            agentStartedAt,
            firstVisibleTextAt,
            firstOutputAt,
            lastAssistantEndAt,
            performance.now(),
          ),
        });
      }
    } catch (error) {
      if (signal.aborted) await sendTerminal({ type: "canceled" });
      else if (streamFailure) {
        await sendTerminal({
          type: "error",
          code: "result_backpressure_exceeded",
          message: "The response was stopped because result delivery could not keep up.",
          retryable: true,
        });
      }
      else await sendTerminal({ type: "error", ...safeError(error instanceof Error ? error : new Error("Unknown model-provider error.")) });
    } finally {
      signal.removeEventListener("abort", abort);
      unsubscribe();
      entry.active = false;
      entry.toolContext = undefined;
      entry.activeTools.clear();
    }
  }

  async disposeSession(scope: SessionScope): Promise<void> {
    const key = scopeKey(scope);
    const entry = this.sessions.get(key);
    if (!entry) return;
    if (entry.active) await entry.session.abort();
    entry.session.dispose();
    this.sessions.delete(key);
  }

  async dispose(): Promise<void> {
    for (const entry of this.sessions.values()) {
      if (entry.active) await entry.session.abort();
      entry.session.dispose();
    }
    this.sessions.clear();
  }

  private async createSession(history: ConversationHistoryMessage[]): Promise<SessionEntry> {
    if (!this.runtime || !this.model) throw new Error("Pi is not ready.");
    const sessionManager = SessionManager.inMemory(IN_MEMORY_RUNTIME_CWD);
    for (const message of history) {
      const text = textFromHistory(message);
      if (!text) continue;
      if (message.role === "user") {
        sessionManager.appendMessage({ role: "user", content: text, timestamp: Date.now() });
      } else {
        sessionManager.appendMessage(fauxAssistantMessage(text, { timestamp: Date.now() }));
      }
    }
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    });
    const loader = new DefaultResourceLoader({
      cwd: IN_MEMORY_RUNTIME_CWD,
      agentDir: IN_MEMORY_RUNTIME_CWD,
      settingsManager,
      systemPromptOverride: () => systemPrompt,
      agentsFilesOverride: () => ({ agentsFiles: [] }),
      skillsOverride: () => ({ skills: [], diagnostics: [] }),
    });
    await loader.reload();
    const placeholder: SessionEntry = {
      // SAFETY: createAgentSession assigns the placeholder before any execution can use it.
      session: undefined as never,
      active: false,
      activeTools: new Map(),
      toolContext: undefined,
    };
    const tools = this.createTools(placeholder);
    const actualNames = tools.map((tool) => tool.name).sort();
    if (actualNames.join("\0") !== [...allowedToolNames].sort().join("\0")) {
      throw new Error("The effective Pi tool set does not match the approved allowlist.");
    }
    const { session } = await createAgentSession({
      cwd: IN_MEMORY_RUNTIME_CWD,
      agentDir: IN_MEMORY_RUNTIME_CWD,
      model: this.model,
      modelRuntime: this.runtime,
      thinkingLevel: "high",
      noTools: "all",
      tools: [...allowedToolNames],
      customTools: tools,
      resourceLoader: loader,
      sessionManager,
      settingsManager,
    });
    placeholder.session = session;
    return placeholder;
  }

  private createTools(entry: SessionEntry) {
    const readTool = (name: "get_accounts" | "get_portfolio" | "get_equity_positions" | "get_equity_quotes" | "get_equity_orders", label: string, description: string, parameters: ReturnType<typeof Type.Object>) => defineTool({
      name,
      label,
      description,
      parameters,
      execute: async (_id, params, signal) => {
        if (!entry.toolContext) return {
          content: [{ type: "text" as const, text: "Trusted run context is unavailable." }],
          details: { ok: false },
          isError: true,
        };
        try {
          // SAFETY: The TypeBox schema for each read tool restricts parameters to the ApplicationToolArguments fields.
          const toolArguments = params as ApplicationToolArguments;
          const result = await this.broker.callApplicationTool(entry.toolContext.actorId, name, toolArguments, signal);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            details: { ok: true },
          };
        } catch {
          return {
            content: [{ type: "text" as const, text: "The Robinhood data request failed." }],
            details: { ok: false },
            isError: true,
          };
        }
      },
    });
    const propose = defineTool({
      name: "propose_order",
      label: "Propose order",
      description: "Create a reviewed order proposal. This tool never submits an order.",
      parameters: Type.Object({
        symbol: Type.String({ minLength: 1, maxLength: 16 }),
        side: Type.Union([Type.Literal("buy"), Type.Literal("sell")]),
        quantity: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
        notionalUsd: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
        orderType: Type.Union([Type.Literal("market"), Type.Literal("limit"), Type.Literal("stop"), Type.Literal("stop_limit")]),
        timeInForce: Type.Union([Type.Literal("day"), Type.Literal("gtc")]),
        limitPrice: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
        stopPrice: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
        estimatedPrice: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
        estimatedTotal: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
        reviewReference: Type.String({ minLength: 1, maxLength: 2_000 }),
        expiresAt: Type.Optional(Type.Integer({ minimum: 1 })),
      }),
      execute: async (_id, params) => {
        if (!entry.toolContext) return {
          content: [{ type: "text" as const, text: "Trusted run context is unavailable." }],
          details: { ok: false },
          isError: true,
        };
        try {
          const proposal = await this.broker.proposeOrder({ ...params, actorId: entry.toolContext.actorId, threadId: entry.toolContext.threadId, runId: entry.toolContext.runId });
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              proposalId: proposal.proposalId,
              fingerprint: proposal.fingerprint,
              status: "awaiting_confirmation",
              symbol: proposal.symbol,
              side: proposal.side,
              orderType: proposal.orderType,
              timeInForce: proposal.timeInForce,
              expiresAt: proposal.expiresAt,
            }) }],
            details: { ok: true },
          };
        } catch {
          return {
            content: [{ type: "text" as const, text: "The order proposal could not be recorded." }],
            details: { ok: false },
            isError: true,
          };
        }
      },
    });
    return [
      readTool("get_accounts", "List accounts", "Read the connected account summary.", Type.Object({})),
      readTool("get_portfolio", "Read portfolio", "Read normalized portfolio totals.", Type.Object({})),
      readTool("get_equity_positions", "List positions", "Read equity positions.", Type.Object({})),
      readTool("get_equity_quotes", "Read quotes", "Read current equity quotes.", Type.Object({ symbol: Type.Optional(Type.String({ minLength: 1, maxLength: 16 })), symbols: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 16 }), { maxItems: 32 })) })),
      readTool("get_equity_orders", "List orders", "Read recent equity orders.", Type.Object({ status: Type.Optional(Type.String({ maxLength: 32 })) })),
      propose,
    ];
  }

  private summarizeToolInput(name: string, input: ToolInput): string | undefined {
    if (name === "get_equity_quotes" && input.symbol !== undefined) return input.symbol;
    if (name === "propose_order" && input.symbol !== undefined && input.side !== undefined) return `${input.side} ${input.symbol}`;
    return undefined;
  }

  private summarizeToolResult(name: string, value: ToolResultDetails): string | undefined {
    const details = value.details;
    if (!details) return undefined;
    if (name === "propose_order" && details.proposalId !== undefined) return `Proposal ${details.proposalId}`;
    if (details.ok === true) return "Request completed";
    return undefined;
  }
}

export function createPiExecutor(config: AppConfig, broker = createTradingBroker(config)): ExecutionExecutor {
  return new PiExecutionExecutor(config, broker);
}
