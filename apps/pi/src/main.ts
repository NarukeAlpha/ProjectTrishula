import { loadConfig } from "./config.js";
import { createPiExecutor } from "./pi/createPiExecutor.js";
import { createTradingBroker } from "./broker/trading-broker.js";
import { consoleLogger } from "./runtime/logger.js";
import { startExecutionService } from "./service.js";
import { createCodexRuntime } from "./pi/codex-runtime.js";
import { createDiscordAgentRunner } from "./discord/runner.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const broker = createTradingBroker(config);
  const codexRuntime = createCodexRuntime(config.piAuthPath);
  const executor = createPiExecutor(config, broker, codexRuntime);
  const discordAgents = createDiscordAgentRunner(codexRuntime);
  const service = await startExecutionService(config, executor, consoleLogger, broker, discordAgents);

  const shutdown = async (signal: string): Promise<void> => {
    consoleLogger.info("execution_service_signal", { signal });
    try {
      await service.shutdown();
      process.exitCode = 0;
    } catch (error) {
      consoleLogger.error("execution_service_shutdown_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
    }
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  consoleLogger.error("execution_service_startup_failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
