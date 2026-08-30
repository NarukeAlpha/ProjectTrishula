import type { PiEvent, RunExecutionRequest } from "../contracts.js";

export type { RunExecutionRequest } from "../contracts.js";

export interface SessionScope {
  actorId: string;
  threadId: string;
}

export type EmitPiEvent = (event: PiEvent) => Promise<void>;

export interface ExecutorReadiness {
  ready: boolean;
  reason?: string;
}

/**
 * The Pi adapter implements this boundary. `execute` must await `emit`, honor
 * `signal`, and emit exactly one terminal event as its final event.
 */
export interface ExecutionExecutor {
  initialize(): Promise<void>;
  readiness(): ExecutorReadiness;
  execute(
    request: RunExecutionRequest,
    emit: EmitPiEvent,
    signal: AbortSignal,
  ): Promise<void>;
  disposeSession(scope: SessionScope): Promise<void>;
  dispose(): Promise<void>;
}
