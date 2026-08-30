import type { ExecutionExecutor, SessionScope } from "./executor.js";

const ONE_HOUR_MS = 60 * 60 * 1_000;

interface SessionState {
  scope: SessionScope;
  active: boolean;
  timer?: NodeJS.Timeout;
}

function key(scope: SessionScope): string {
  return JSON.stringify([scope.actorId, scope.threadId]);
}

export class SessionCoordinator {
  private readonly sessions = new Map<string, SessionState>();

  constructor(
    private readonly executor: ExecutionExecutor,
    private readonly idleTtlMs = ONE_HOUR_MS,
  ) {}

  enter(scope: SessionScope): void {
    const sessionKey = key(scope);
    const current = this.sessions.get(sessionKey);
    if (current?.timer) clearTimeout(current.timer);
    this.sessions.set(sessionKey, { scope, active: true });
  }

  leave(scope: SessionScope): void {
    const sessionKey = key(scope);
    const current = this.sessions.get(sessionKey);
    if (!current) return;
    current.active = false;
    current.timer = setTimeout(() => {
      const latest = this.sessions.get(sessionKey);
      if (!latest || latest.active) return;
      this.sessions.delete(sessionKey);
      void this.executor.disposeSession(latest.scope);
    }, this.idleTtlMs);
    current.timer.unref();
  }

  async invalidate(scope: SessionScope): Promise<void> {
    const sessionKey = key(scope);
    const current = this.sessions.get(sessionKey);
    if (current?.timer) clearTimeout(current.timer);
    this.sessions.delete(sessionKey);
    await this.executor.disposeSession(scope);
  }

  async dispose(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.timer) clearTimeout(session.timer);
    }
    this.sessions.clear();
    await this.executor.dispose();
  }
}
