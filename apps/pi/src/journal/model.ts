import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import type { CodexRuntime } from "../pi/codex-runtime.js";
import { withAstraServiceTier } from "../pi/codex-transport.js";

export const journalReasoningEfforts = ["low", "medium", "high", "xhigh", "max"] as const;
export type JournalReasoningEffort = (typeof journalReasoningEfforts)[number];

export interface JournalModelReadiness {
  ready: boolean;
  reason?: string;
}

export interface JournalModelCompletionRequest {
  context: Context;
  reasoning?: JournalReasoningEffort;
  signal?: AbortSignal;
}

export interface JournalModelAdapter {
  readonly provider: string;
  readonly modelId: string;
  initialize(): Promise<void>;
  readiness(): JournalModelReadiness;
  complete(request: JournalModelCompletionRequest): Promise<AssistantMessage>;
  dispose(): Promise<void>;
}

interface CodexCompletionOptions {
  reasoning: JournalReasoningEffort;
  serviceTier: string;
  signal?: AbortSignal;
}

export class CodexJournalModelAdapter implements JournalModelAdapter {
  readonly provider = "openai-codex";
  private model: Awaited<ReturnType<CodexRuntime["requireModel"]>> | undefined;
  private initializationError: string | undefined;
  private disposed = false;

  constructor(
    private readonly runtime: CodexRuntime,
    readonly modelId: string,
    private readonly defaultReasoning: JournalReasoningEffort = "high",
  ) {}

  async initialize(): Promise<void> {
    try {
      this.model = await this.runtime.requireModel(this.modelId);
      this.initializationError = undefined;
    } catch (error) {
      this.model = undefined;
      this.initializationError = error instanceof Error
        ? error.message
        : "journal_model_not_ready";
      throw error;
    }
  }

  readiness(): JournalModelReadiness {
    if (this.disposed) return { ready: false, reason: "journal_model_disposed" };
    if (this.model === undefined) {
      return {
        ready: false,
        reason: this.initializationError ?? "journal_model_not_initialized",
      };
    }
    return { ready: true };
  }

  async complete(request: JournalModelCompletionRequest): Promise<AssistantMessage> {
    if (this.disposed) {
      throw new Error("Journal model adapter has been disposed.");
    }
    const model = this.model ?? await this.runtime.requireModel(this.modelId);
    this.model = model;
    const runtime = await this.runtime.get();
    const reasoning = request.reasoning ?? this.defaultReasoning;
    const baseOptions: CodexCompletionOptions = {
      reasoning,
      serviceTier: "priority",
    };
    if (request.signal !== undefined) {
      baseOptions.signal = request.signal;
    }
    const options = withAstraServiceTier(model, baseOptions);
    return runtime.completeSimple(model, request.context, options);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.model = undefined;
  }
}

export function createCodexJournalModelAdapter(
  runtime: CodexRuntime,
  modelId: string,
  defaultReasoning: JournalReasoningEffort = "high",
): JournalModelAdapter {
  return new CodexJournalModelAdapter(runtime, modelId, defaultReasoning);
}
