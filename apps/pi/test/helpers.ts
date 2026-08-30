import type {
  EmitPiEvent,
  ExecutionExecutor,
  ExecutorReadiness,
  SessionScope,
} from "../src/execution/executor.js";
import type { RunExecutionRequest } from "../src/contracts.js";
import type { Logger } from "../src/runtime/logger.js";

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export class TestExecutor implements ExecutionExecutor {
  ready = true;
  readonly requests: RunExecutionRequest[] = [];
  readonly disposedSessions: SessionScope[] = [];
  disposed = false;

  async initialize(): Promise<void> {}

  readiness(): ExecutorReadiness {
    return this.ready ? { ready: true } : { ready: false, reason: "test_not_ready" };
  }

  async execute(
    request: RunExecutionRequest,
    _emit: EmitPiEvent,
    signal: AbortSignal,
  ): Promise<void> {
    this.requests.push(request);
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  async disposeSession(scope: SessionScope): Promise<void> {
    this.disposedSessions.push(scope);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

export const runRequest: RunExecutionRequest = {
  commandId: "command_1",
  runId: "run_1",
  assistantMessageId: "message_1",
  actorId: "tenant_1:actor_1",
  threadId: "thread_1",
  prompt: "Help me",
  history: [],
};
