import type { Server } from "node:http";
import { createApp, type AppDependencies } from "./app.js";
import type { AppConfig } from "./config.js";
import { ConvexClient } from "./results/convex-client.js";
import type { Logger } from "./runtime/logger.js";
import type { ExecutionExecutor } from "./execution/executor.js";
import { RunRegistry } from "./execution/run-registry.js";
import { SessionCoordinator } from "./execution/session-coordinator.js";
import type { TradingBroker } from "./broker/types.js";
import { createTradingBroker } from "./broker/trading-broker.js";
import type { DiscordAgentRunner } from "./discord/runner.js";

export interface RunningExecutionService {
  server: Server;
  registry: RunRegistry;
  shutdown(): Promise<void>;
}

export async function startExecutionService(
  config: AppConfig,
  executor: ExecutionExecutor,
  logger: Logger,
  broker: TradingBroker = createTradingBroker(config),
  discordAgents?: DiscordAgentRunner,
): Promise<RunningExecutionService> {
  await executor.initialize();
  if (!executor.readiness().ready) {
    throw new Error(`Pi executor is not ready: ${executor.readiness().reason ?? "unknown reason"}`);
  }
  if (discordAgents) {
    await discordAgents.initialize();
    if (!discordAgents.readiness().ready) {
      throw new Error(`Discord agents are not ready: ${discordAgents.readiness().reason ?? "unknown reason"}`);
    }
  }

  const sessions = new SessionCoordinator(executor);
  const convex = new ConvexClient({
    siteUrl: config.convexSiteUrl,
    sharedSecret: config.sharedSecret,
    requestTimeoutMs: config.requestTimeoutMs,
    retryAttempts: config.retryAttempts,
    logger,
  });
  const registry = new RunRegistry({
    executor,
    sessions,
    convex,
    concurrency: config.globalConcurrency,
    batchWindowMs: config.batchWindowMs,
    batchBytes: config.batchBytes,
    logger,
  });
  const appDependencies: AppDependencies = {
    sharedSecret: config.sharedSecret,
    discordSharedSecret: config.discordSharedSecret,
    executor,
    registry,
    broker,
  };
  if (discordAgents) appDependencies.discordAgents = discordAgents;
  const app = createApp(config.boundActorId
    ? { ...appDependencies, boundActorId: config.boundActorId }
    : appDependencies);

  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(config.port, config.host, () => resolve(listening));
    listening.once("error", reject);
  });
  logger.info("execution_service_listening", { host: config.host, port: config.port });

  let shutdownPromise: Promise<void> | undefined;
  return {
    server,
    registry,
    shutdown: () => {
      shutdownPromise ??= (async () => {
        logger.info("execution_service_shutdown_started");
        const closed = new Promise<void>((resolve) => server.close(() => resolve()));
        const work = (async () => {
          await registry.shutdown();
          await registry.waitForIdle();
          await sessions.dispose();
          await broker.dispose();
          await discordAgents?.dispose();
          await executor.dispose();
        })();
        await Promise.race([
          Promise.allSettled([closed, work]),
          new Promise<void>((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error("Execution service shutdown timed out.")),
              config.shutdownTimeoutMs,
            );
            timer.unref();
          }),
        ]);
        logger.info("execution_service_shutdown_completed");
      })();
      return shutdownPromise;
    },
  };
}
