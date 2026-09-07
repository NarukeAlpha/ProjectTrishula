/* oxlint-disable anti-slop/no-conditional-empty-object-spread -- Exact optional properties require omission when optional credentials are absent. */
import { loadConfig } from "./config.js";
import { createPiExecutor } from "./pi/createPiExecutor.js";
import { createTradingBroker } from "./broker/trading-broker.js";
import { consoleLogger } from "./runtime/logger.js";
import { startExecutionService } from "./service.js";
import { createCodexRuntime } from "./pi/codex-runtime.js";
import { createDiscordAgentRunner } from "./discord/runner.js";
import { createMorningPaperComposer } from "./market-research/composer.js";
import { ConvexMarketResearchClient } from "./market-research/convex-client.js";
import { MarketResearchExaClient } from "./market-research/exa-client.js";
import { createConfiguredMarketDataProvider } from "./market-research/exa-financial-datasets-provider.js";
import { createMarketResearchRunner } from "./market-research/runner.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const broker = createTradingBroker(config);
  const codexRuntime = createCodexRuntime(config.piAuthPath);
  const executor = createPiExecutor(config, broker, codexRuntime);
  const discordAgents = createDiscordAgentRunner(codexRuntime, config);
  const callbacks = new ConvexMarketResearchClient({
    siteUrl: config.convexSiteUrl,
    sharedSecret: config.sharedSecret,
    timeoutMs: config.requestTimeoutMs,
    logger: consoleLogger,
  });
  const marketResearch = config.marketResearchEnabled && config.exaApiKey !== undefined
    ? createMarketResearchRunner({
        exaClient: (request) => {
          const maximumCostUsd = request.preferences.exaMaxCostUsd ?? config.exaMaxCostUsdPerEdition;
          return new MarketResearchExaClient({
            apiKey: config.exaApiKey ?? "",
            searchConcurrency: config.exaSearchConcurrency,
            contentsConcurrency: config.exaContentsConcurrency,
            requestTimeoutMs: config.exaRequestTimeoutMs,
            maximumSearchRequests: Math.min(
              config.exaMaxSearchRequestsPerEdition,
              request.preferences.searchRequestBudget,
            ),
            maximumContentPages: Math.min(
              config.exaMaxContentPagesPerEdition,
              request.preferences.contentsPageBudget,
            ),
            ...(maximumCostUsd === undefined ? {} : { maximumCostUsd }),
            logger: consoleLogger,
          });
        },
        marketDataFactory: (request, exaClient) =>
          createConfiguredMarketDataProvider(
            {
              providerId: config.marketDataProviderId,
              financialDatasetsOwnerDecision:
                config.financialDatasetsOwnerDecision,
              financialDatasetsMaxCostUsdPerRequest:
                config.financialDatasetsMaxCostUsdPerRequest,
            },
            request,
            exaClient,
          ),
        composer: createMorningPaperComposer(codexRuntime, config.marketResearchModel),
        callbacks,
        logger: consoleLogger,
      })
    : undefined;
  const service = await startExecutionService(
    config,
    executor,
    consoleLogger,
    broker,
    discordAgents,
    marketResearch,
  );

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
