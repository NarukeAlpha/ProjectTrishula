import { describe, expect, it, vi } from "vitest";
import type { AgentGroundingEntry } from "exa-js";
import { runFinancialDatasetsEvaluationCli } from "../src/market-research/evaluate-financial-datasets-cli.js";
import { MarketResearchExaError } from "../src/market-research/exa-errors.js";
import {
  evaluateFinancialDatasets,
  FINANCIAL_DATASET_EVALUATION_SYMBOLS,
  FINANCIAL_DATASET_FIELD_NAMES,
  type FinancialDatasetValue,
} from "../src/market-research/financial-datasets-evaluation.js";

const instant = "2026-09-07T12:00:00.000Z";
const evaluationOptions = {
  evaluationId: "evaluation-cli-test",
  configuredInstant: instant,
  configuredTimezone: "America/New_York",
  zdrStatus: "disabled" as const,
  maximumCostUsd: 0.5,
};
const argumentsForRun = [
  "--execute", "--confirm-zdr-disabled", "--evaluation-id", "evaluation-cli-test",
  "--instant", instant, "--timezone", "America/New_York", "--max-cost-usd", "0.5",
];

interface EvaluationFixtureField {
  value: FinancialDatasetValue | null;
  asOf: string | null;
  sessionLabel: string | null;
  citations?: Array<{ title: string; url: string }>;
}

function fixtureField(field: typeof FINANCIAL_DATASET_FIELD_NAMES[number]): EvaluationFixtureField {
  return {
    value: field === "currentPrice" ? 100.25 : null,
    asOf: field === "currentPrice" ? instant : null,
    sessionLabel: field === "currentPrice" ? "premarket" : null,
  };
}

function response(grounding: AgentGroundingEntry[] | null = []) {
  return {
    evaluationId: "evaluation-cli-test",
    status: "completed" as const,
    raw: {
      output: {
        structured: {
          snapshots: FINANCIAL_DATASET_EVALUATION_SYMBOLS.map((symbol) => ({
            symbol,
            fields: Object.fromEntries(FINANCIAL_DATASET_FIELD_NAMES.map((field) => [field, fixtureField(field)])),
          })),
        },
        grounding,
        text: "unbounded-provider-text-must-not-survive",
      },
      costDollars: { total: 0.2 },
      privateDebug: "raw-provider-debug-must-not-survive",
    },
  };
}

function priceGrounding(url = "https://example.com/AAPL"): AgentGroundingEntry[] {
  return [{ field: "snapshots[0].fields.currentPrice.value", citations: [{ url }] }];
}

describe("Financial Datasets Agent grounding", () => {
  it("uses field grounding without model-authored citations and does not transfer it between symbols", async () => {
    const report = await evaluateFinancialDatasets({
      runFinancialDatasetEvaluation: vi.fn().mockResolvedValue(response(priceGrounding())),
    }, evaluationOptions);
    expect(report.status).toBe("completed");
    expect(report.supportMatrix.filter((entry) => entry.status === "supported")).toEqual([
      expect.objectContaining({
        symbol: "AAPL", field: "currentPrice", value: 100.25,
        groundingCitations: [{ title: "example.com", url: "https://example.com/AAPL" }],
      }),
    ]);
    expect(JSON.stringify(report)).not.toContain("must-not-survive");
  });

  it("fails closed for absent, private, insecure, broad, and unrelated grounding", async () => {
    const candidates: Array<AgentGroundingEntry[] | null> = [
      null, [], priceGrounding("http://example.com/quote"), priceGrounding("https://127.0.0.1/quote"),
      [{ field: "snapshots[0]", citations: [{ url: "https://example.com/quote" }] }],
      [{ field: "snapshots[0].fields.quoteTime.value", citations: [{ url: "https://example.com/quote" }] }],
    ];
    for (const grounding of candidates) {
      const report = await evaluateFinancialDatasets({
        runFinancialDatasetEvaluation: vi.fn().mockResolvedValue(response(grounding)),
      }, evaluationOptions);
      expect(report.status).toBe("completed");
      expect(report.supportMatrix.every((entry) => entry.status === "unsupported")).toBe(true);
      expect(report.supportMatrix[0]!.groundingCitations).toEqual([]);
    }
  });

  it("does not let inline citations establish numerical support", async () => {
    const result = response();
    const fields = result.raw.output.structured.snapshots[0]!.fields;
    fields.currentPrice = { ...fields.currentPrice!, citations: [{ title: "Claimed", url: "https://example.com/quote" }] };
    const report = await evaluateFinancialDatasets({
      runFinancialDatasetEvaluation: vi.fn().mockResolvedValue(result),
    }, evaluationOptions);
    expect(report.supportMatrix[0]).toMatchObject({ status: "unsupported", value: null, citationCount: 1 });
  });

  it("keeps optional SDK citation metadata compatible and requires every numeric bar component", async () => {
    const result = response();
    const bar = { timestamp: instant, open: 100, high: 102, low: 99, close: 101, volume: 1234 };
    result.raw.output.structured.snapshots[0]!.fields.bars5m = {
      value: [bar], asOf: instant, sessionLabel: "premarket",
    };
    const grounding = ["open", "high", "low", "close", "volume"].map((component) => ({
      field: `$.snapshots[0].fields.bars5m.value[0].${component}`,
      citations: [{ title: null, url: "https://example.com/bars", providerMetadata: "not-retained" }],
      confidence: "high" as const,
    }));
    for (const complete of [false, true]) {
      result.raw.output.grounding = complete ? grounding : grounding.slice(0, 4);
      const report = await evaluateFinancialDatasets({
        runFinancialDatasetEvaluation: vi.fn().mockResolvedValue(result),
      }, evaluationOptions);
      expect(report.supportMatrix.find((entry) => entry.symbol === "AAPL" && entry.field === "bars5m"))
        .toMatchObject({ status: complete ? "supported" : "unsupported", value: complete ? [bar] : null });
      expect(JSON.stringify(report)).not.toContain("providerMetadata");
    }
  });
});

describe("Financial Datasets evaluation operator CLI", () => {
  it("requires opt-in, ZDR confirmation, valid instant/timezone, cost cap, and a key before creating a client", async () => {
    const createClient = vi.fn();
    const writeError = vi.fn();
    const invalidArguments = [
      argumentsForRun.filter((argument) => argument !== "--execute"),
      argumentsForRun.filter((argument) => argument !== "--confirm-zdr-disabled"),
      argumentsForRun.map((argument) => argument === instant ? "not-a-time" : argument),
      argumentsForRun.map((argument) => argument === "America/New_York" ? "Unknown/Timezone" : argument),
      argumentsForRun.map((argument) => argument === "0.5" ? "0" : argument),
      argumentsForRun.map((argument) => argument === "0.5" ? "Infinity" : argument),
      argumentsForRun.slice(0, -2),
    ];
    for (const args of invalidArguments) {
      expect(await runFinancialDatasetsEvaluationCli(args, { EXA_API_KEY: "test-key" }, {
        createClient, writeError, writeOutput: vi.fn(),
      })).toBe(2);
    }
    expect(await runFinancialDatasetsEvaluationCli(argumentsForRun, {}, {
      createClient, writeError, writeOutput: vi.fn(),
    })).toBe(2);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("passes exact controls to the injected client and prints only the bounded review report", async () => {
    const runFinancialDatasetEvaluation = vi.fn().mockResolvedValue(response(priceGrounding()));
    const createClient = vi.fn(() => ({ runFinancialDatasetEvaluation }));
    const writeOutput = vi.fn();
    const writeError = vi.fn();
    expect(await runFinancialDatasetsEvaluationCli([...argumentsForRun, "--timeout-ms", "30000"], {
      EXA_API_KEY: "test-key-never-print",
    }, { createClient, writeOutput, writeError, now: () => 100 })).toBe(0);
    expect(createClient).toHaveBeenCalledWith({
      apiKey: "test-key-never-print", maximumCostUsd: 0.5, requestTimeoutMs: 30000,
    });
    expect(runFinancialDatasetEvaluation).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      evaluationId: "evaluation-cli-test", maxCostDollars: 0.5,
      query: expect.stringContaining(instant),
    }), undefined);
    expect(runFinancialDatasetEvaluation.mock.calls[0]![0].query).toContain("America/New_York");
    expect(runFinancialDatasetEvaluation.mock.calls[0]![0].outputSchema).toMatchObject({
      properties: { snapshots: { items: { properties: { fields: {
        additionalProperties: { required: ["value", "asOf", "sessionLabel"] },
      } } } } },
    });
    const printed = writeOutput.mock.calls[0]![0];
    expect(printed).not.toContain("test-key-never-print");
    expect(printed).not.toContain("must-not-survive");
    expect(JSON.parse(printed)).toMatchObject({
      costUsd: 0.2, ownerDecision: "pending", referenceComparison: "pending_external_reference",
      configuredInstant: instant, configuredTimezone: "America/New_York",
    });
    expect(writeError).not.toHaveBeenCalled();
  });

  it("returns classified evaluation failure without retrying or printing provider errors", async () => {
    const runFinancialDatasetEvaluation = vi.fn().mockRejectedValue(new MarketResearchExaError({
      code: "exa_budget_exhausted", retryable: false, maximumRetries: 0, scope: "request", finalForSource: true,
    }));
    const writeOutput = vi.fn();
    expect(await runFinancialDatasetsEvaluationCli(argumentsForRun, { EXA_API_KEY: "test-key" }, {
      createClient: () => ({ runFinancialDatasetEvaluation }), writeOutput, writeError: vi.fn(),
    })).toBe(1);
    expect(runFinancialDatasetEvaluation).toHaveBeenCalledTimes(1);
    expect(JSON.parse(writeOutput.mock.calls[0]![0])).toMatchObject({ safeCode: "exa_budget_exhausted" });
  });

  it("does not leak a credential from an exception or an echoed citation title", async () => {
    const writeError = vi.fn();
    const writeOutput = vi.fn();
    const key = "test-key-never-print";
    expect(await runFinancialDatasetsEvaluationCli(argumentsForRun, { EXA_API_KEY: key }, {
      createClient: () => { throw new Error(key); }, writeError, writeOutput,
    })).toBe(1);
    expect(writeError).toHaveBeenCalledWith("financial_datasets_evaluation_failed");
    const result = response([{ field: "snapshots[0].fields.currentPrice.value", citations: [{ title: key, url: "https://example.com/quote" }] }]);
    expect(await runFinancialDatasetsEvaluationCli(argumentsForRun, { EXA_API_KEY: key }, {
      createClient: () => ({ runFinancialDatasetEvaluation: vi.fn().mockResolvedValue(result) }), writeError, writeOutput,
    })).toBe(0);
    expect(writeOutput.mock.calls[0]![0]).not.toContain(key);
    expect(writeOutput.mock.calls[0]![0]).toContain("[REDACTED]");
  });
});
