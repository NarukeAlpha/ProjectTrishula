import { describe, expect, it, vi } from "vitest";
import {
  ExaFinancialDatasetsProvider,
  createConfiguredMarketDataProvider,
} from "../src/market-research/exa-financial-datasets-provider.js";

const request = {
  editionId: "edition-1",
  preferences: {
    primarySymbols: ["AAPL"],
    sectorSymbols: [],
    marketDataProviderId: "exa_financial_datasets",
  },
};

function rawProviderRun(withGrounding = true) {
  return {
    id: "agent-run-1",
    output: {
      structured: {
        symbols: [{
          symbol: "AAPL",
          price: {
            value: 230,
            providerTimestamp: "2026-09-07T12:00:00.000Z",
            sessionLabel: "regular",
            entitlement: "real_time",
          },
          priorClose: {
            value: 228,
            providerTimestamp: "2026-09-04T20:00:00.000Z",
            sessionLabel: "closed",
            entitlement: "end_of_day",
          },
          dailyBars: [{
            timestamp: "2026-09-04T20:00:00.000Z",
            open: 225,
            high: 229,
            low: 224,
            close: 228,
            volume: 1_000,
            sessionLabel: "regular",
            entitlement: "end_of_day",
          }],
          weeklyBars: [],
          corporateActions: [{
            kind: "dividend",
            effectiveAt: "2026-09-04T20:00:00.000Z",
            detail: "Quarterly dividend",
          }],
        }],
      },
      grounding: withGrounding
        ? [
            {
              field: "symbols[0].price.value",
              citations: [{ url: "https://financialdatasets.ai/prices/aapl", title: "AAPL price" }],
            },
            {
              field: "symbols[0].priorClose.value",
              citations: [{ url: "https://financialdatasets.ai/prices/aapl", title: "AAPL close" }],
            },
            {
              field: "symbols[0].dailyBars",
              citations: [{ url: "https://financialdatasets.ai/history/aapl", title: "AAPL history" }],
            },
            {
              field: "symbols[0].corporateActions",
              citations: [{ url: "https://financialdatasets.ai/actions/aapl", title: "AAPL actions" }],
            },
          ]
        : [],
    },
    costDollars: { total: 0.025 },
  };
}

describe("Exa Financial Datasets provider", () => {
  it("uses one bounded Agent run and exposes only grounded supported fields", async () => {
    const runFinancialDatasetEvaluation = vi.fn().mockResolvedValue({
      evaluationId: "provider-edition-1",
      status: "completed",
      raw: rawProviderRun(),
    });
    const provider = new ExaFinancialDatasetsProvider({
      client: { runFinancialDatasetEvaluation },
      request,
      maximumCostUsd: 0.25,
      now: () => new Date("2026-09-07T12:00:01.000Z"),
    });

    const snapshots = await provider.getSnapshots(["AAPL"]);
    const bars = await provider.getBars(
      "AAPL",
      "1d",
      "2026-09-01T00:00:00.000Z",
      "2026-09-07T23:59:59.000Z",
      true,
    );
    const actions = await provider.getCorporateActions(
      "AAPL",
      "2026-09-01T00:00:00.000Z",
      "2026-09-07T23:59:59.000Z",
    );

    expect(snapshots[0]?.price).toMatchObject({
      value: 230,
      policyStatus: "approved",
      sourceUrls: ["https://financialdatasets.ai/prices/aapl"],
      providerIdentifiers: ["agent-run-1"],
    });
    expect(bars).toHaveLength(1);
    expect(actions[0]?.sourceUrl).toBe(
      "https://financialdatasets.ai/actions/aapl",
    );
    await expect(provider.getBars(
      "AAPL",
      "5m",
      "2026-09-01T00:00:00.000Z",
      "2026-09-07T23:59:59.000Z",
      true,
    )).rejects.toThrow("market_data_unavailable");
    expect(runFinancialDatasetEvaluation).toHaveBeenCalledOnce();
    expect(runFinancialDatasetEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ maxCostDollars: 0.25 }),
      undefined,
    );
  });

  it("rejects ungrounded numerical output", async () => {
    const provider = new ExaFinancialDatasetsProvider({
      client: {
        runFinancialDatasetEvaluation: vi.fn().mockResolvedValue({
          evaluationId: "provider-edition-1",
          status: "completed",
          raw: rawProviderRun(false),
        }),
      },
      request,
      maximumCostUsd: 0.25,
    });

    await expect(provider.getSnapshots(["AAPL"]))
      .rejects.toThrow("market_data_unavailable");
  });

  it("does not let metadata or partial OHLCV grounding authorize numerical data", async () => {
    const raw = rawProviderRun(false);
    raw.output.grounding = [
      {
        field: "symbols[0].price.value",
        citations: [{ url: "https://financialdatasets.ai/prices/aapl", title: "AAPL price" }],
      },
      {
        field: "symbols[0].priorClose.providerTimestamp",
        citations: [{ url: "https://financialdatasets.ai/prices/aapl", title: "AAPL close time" }],
      },
      {
        field: "symbols[0].dailyBars[0].open",
        citations: [{ url: "https://financialdatasets.ai/history/aapl", title: "AAPL open" }],
      },
    ];
    const provider = new ExaFinancialDatasetsProvider({
      client: {
        runFinancialDatasetEvaluation: vi.fn().mockResolvedValue({
          evaluationId: "provider-edition-1",
          status: "completed",
          raw,
        }),
      },
      request,
      maximumCostUsd: 0.25,
    });

    const snapshots = await provider.getSnapshots(["AAPL"]);
    expect(snapshots[0]?.price?.value).toBe(230);
    expect(snapshots[0]?.priorClose).toBeUndefined();
    await expect(provider.getBars(
      "AAPL",
      "1d",
      "2026-09-01T00:00:00.000Z",
      "2026-09-07T23:59:59.000Z",
      true,
    )).resolves.toEqual([]);
  });

  it("stays disabled until runtime and owner gates match the frozen preference", () => {
    const client = { runFinancialDatasetEvaluation: vi.fn() };
    expect(createConfiguredMarketDataProvider({
      providerId: "disabled",
      financialDatasetsOwnerDecision: "approved",
      financialDatasetsMaxCostUsdPerRequest: 0.25,
    }, request, client).policyStatus).toBe("unavailable");
    expect(createConfiguredMarketDataProvider({
      providerId: "exa_financial_datasets",
      financialDatasetsOwnerDecision: "pending",
      financialDatasetsMaxCostUsdPerRequest: 0.25,
    }, request, client).policyStatus).toBe("unavailable");
    expect(createConfiguredMarketDataProvider({
      providerId: "exa_financial_datasets",
      financialDatasetsOwnerDecision: "approved",
      financialDatasetsMaxCostUsdPerRequest: 0.25,
    }, request, client).policyStatus).toBe("approved");
  });
});
