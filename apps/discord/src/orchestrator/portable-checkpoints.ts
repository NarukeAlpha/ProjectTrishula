import type { ConvexDiscordClient } from "../convex/client.js";
import type { PiAgentClient } from "../pi/client.js";
import { logger } from "../runtime/logger.js";

export interface PortableCheckpointDependencies {
  enabled: boolean;
  convex: Pick<ConvexDiscordClient, "nextPortableCheckpoint" | "storePortableCheckpoint">;
  pi: Pick<PiAgentClient, "portableCheckpoint">;
}

export class PortableCheckpointCoordinator {
  private readonly lifetime = new AbortController();
  private active: Promise<void> | undefined;

  constructor(private readonly dependencies: PortableCheckpointDependencies) {}

  schedule(): void {
    if (!this.dependencies.enabled || this.active !== undefined || this.lifetime.signal.aborted) return;
    const task = this.runOnce(this.lifetime.signal)
      .then(() => undefined)
      .catch(() => {
        if (!this.lifetime.signal.aborted) {
          logger.error("Portable Discord checkpoint failed.", {
            code: "portable_checkpoint_failed",
          });
        }
      })
      .finally(() => {
        if (this.active === task) this.active = undefined;
      });
    this.active = task;
  }

  async runOnce(signal?: AbortSignal): Promise<boolean> {
    if (!this.dependencies.enabled) return false;
    const request = await this.dependencies.convex.nextPortableCheckpoint(signal);
    if (request === null) return false;
    const response = await this.dependencies.pi.portableCheckpoint(request, signal);
    await this.dependencies.convex.storePortableCheckpoint(request, response, signal);
    return true;
  }

  async dispose(): Promise<void> {
    this.lifetime.abort(new Error("portable_checkpoint_coordinator_stopped"));
    await this.active?.catch(() => undefined);
  }
}
