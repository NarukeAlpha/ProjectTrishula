import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { MarketResearchExaClient } from "./exa-client.js";
import { evaluateFinancialDatasets, type FinancialDatasetsEvaluationOptions } from "./financial-datasets-evaluation.js";

const optionsSchema = z.object({
  execute: z.literal(true),
  "confirm-zdr-disabled": z.literal(true),
  "evaluation-id": z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  instant: z.iso.datetime({ offset: true }),
  timezone: z.string().min(1).max(100).refine((value) => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
  }),
  "max-cost-usd": z.coerce.number().finite().positive().max(1_000),
  "timeout-ms": z.coerce.number().int().min(1_000).max(120_000).default(120_000),
});

export interface EvaluationCliClientOptions {
  apiKey: string;
  maximumCostUsd: number;
  requestTimeoutMs: number;
}

export interface EvaluationCliDependencies {
  createClient(options: EvaluationCliClientOptions): Pick<MarketResearchExaClient, "runFinancialDatasetEvaluation">;
  writeOutput(serializedReport: string): void;
  writeError(safeMessage: string): void;
  now?: () => number;
}

/** No client is constructed until all operator confirmations and limits pass. */
export async function runFinancialDatasetsEvaluationCli(
  argv: string[],
  environment: NodeJS.ProcessEnv,
  dependencies: EvaluationCliDependencies,
): Promise<number> {
  try {
    const parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        execute: { type: "boolean" },
        "confirm-zdr-disabled": { type: "boolean" },
        "evaluation-id": { type: "string" },
        instant: { type: "string" },
        timezone: { type: "string" },
        "max-cost-usd": { type: "string" },
        "timeout-ms": { type: "string" },
      },
    });
    const options = optionsSchema.safeParse(parsed.values);
    const key = z.string().trim().min(1).safeParse(environment.EXA_API_KEY);
    if (!options.success || !key.success) {
      dependencies.writeError("financial_datasets_evaluation_invalid_options");
      return 2;
    }
    const client = dependencies.createClient({
      apiKey: key.data,
      maximumCostUsd: options.data["max-cost-usd"],
      requestTimeoutMs: options.data["timeout-ms"],
    });
    const evaluationOptions: FinancialDatasetsEvaluationOptions = {
      evaluationId: options.data["evaluation-id"],
      configuredInstant: options.data.instant,
      configuredTimezone: options.data.timezone,
      zdrStatus: "disabled",
      maximumCostUsd: options.data["max-cost-usd"],
    };
    if (dependencies.now !== undefined) evaluationOptions.now = dependencies.now;
    const report = await evaluateFinancialDatasets(client, evaluationOptions);
    // Print only the bounded review report. Never print provider responses or credentials.
    dependencies.writeOutput(JSON.stringify(report).replaceAll(key.data, "[REDACTED]"));
    return report.status === "completed" ? 0 : 1;
  } catch {
    dependencies.writeError("financial_datasets_evaluation_failed");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runFinancialDatasetsEvaluationCli(process.argv.slice(2), process.env, {
    createClient: (options) => new MarketResearchExaClient({
      ...options,
      searchConcurrency: 1,
      contentsConcurrency: 1,
      maximumSearchRequests: 0,
      maximumContentPages: 0,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    }),
    writeOutput: (report) => process.stdout.write(`${report}\n`),
    writeError: (message) => process.stderr.write(`${message}\n`),
  });
}
