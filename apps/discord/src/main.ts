import { loadConfig } from "./config.js";
import { logger } from "./runtime/logger.js";
import { DiscordGatewayService } from "./service.js";

async function main(): Promise<void> {
  const service = new DiscordGatewayService(loadConfig());
  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    try {
      await service.stop();
      process.exitCode = 0;
    } catch {
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  await service.start();
}

main().catch((error) => {
  logger.error("Discord gateway failed to start.", {
    code: error instanceof Error ? error.name : "unknown_error",
  });
  process.exitCode = 1;
});
