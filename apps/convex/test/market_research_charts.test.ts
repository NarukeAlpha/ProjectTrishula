import { describe, expect, it } from "vitest";
import { marketResearchEditionRecordSchema } from "../convex/market_research.js";

function fixture() {
  const cited = { text: "Evidence-backed setup detail.", sourceIds: ["source-1"] };
  return {
    schemaVersion: 1, editionId: "edition-1", editionDate: "2026-09-07", timezone: "America/New_York",
    asOf: "2026-09-07T12:00:00Z", sessionType: "OPEN", editionLabel: "Morning Market Newspaper",
    regime: "MIXED", regimeLines: Array.from({ length: 5 }, () => cited),
    topStories: Array.from({ length: 3 }, () => cited), scheduledEvents: [], marketContext: [cited],
    primaryBoard: [{
      symbol: "AAPL", label: "TOP WATCH", score: 85,
      components: { catalyst: 20, liquidityAndSpread: 15, dailyAndHourlyBias: 20, premarketStructure: 10, levelQualityAndProximity: 10, indexAndSectorConfirmation: 10 },
      deductions: [], thesisLabel: "NO PRIOR THESIS", trigger: cited, invalidation: cited,
      firstResistanceOrTarget: cited, rewardToRisk: cited, noChase: cited,
      indexOrSectorCondition: cited, eventRisk: cited, sourceIds: ["source-1"],
    }],
    challengers: [],
    tickerDossiers: [{ symbol: "AAPL", thesisLabel: "NO PRIOR THESIS", summary: cited, availableFields: [], unavailableFields: [], sourceIds: ["source-1"] }],
    validationRules: [cited], afterOpenChanges: [],
    requestedSourceStatus: ["FinancialJuice", "Barchart", "ForexFactory", "Yahoo", "TradingView"]
      .map((source) => ({ source, status: "contributed", detail: "Available", sourceIds: ["source-1"] })),
    dataQuality: [cited],
    sections: ["primary_board", "data_quality", "sources"].map((kind, sequence) => ({
      sectionId: kind, sequence, kind, heading: kind, markdown: "Evidence-backed report section.", sourceIds: ["source-1"],
    })),
    chartRequests: [{
      chartRequestId: "chart-1", editionId: "edition-1", sectionId: "primary_board", symbol: "AAPL",
      timeframe: "daily", start: "2026-08-01T00:00:00Z", end: "2026-09-07T12:00:00Z", session: "regular",
      overlays: [], annotations: [], reason: "Show the positive ranked setup.", priority: 90,
      sourceEvidenceIds: ["source-1"], dataAsOf: "2026-09-07T12:00:00Z",
    }],
    sourceIds: ["source-1"], noTradingAction: true,
  };
}

describe("positive ranked setup chart acceptance", () => {
  it("allows TOP WATCH and WATCH charts in the primary board", () => {
    const edition = fixture();
    expect(marketResearchEditionRecordSchema.safeParse(edition).success).toBe(true);
    const setup = edition.primaryBoard[0]!;
    setup.label = "WATCH";
    setup.score = 75;
    setup.components.premarketStructure = 0;
    expect(marketResearchEditionRecordSchema.safeParse(edition).success).toBe(true);
  });

  it.each(["AT RISK", "INVALIDATED"])("rejects charts for a positive score with an %s thesis", (thesisLabel) => {
    const edition = fixture();
    edition.primaryBoard[0]!.thesisLabel = thesisLabel;
    expect(marketResearchEditionRecordSchema.safeParse(edition).success).toBe(false);
  });

  it.each([
    { label: "WAIT FOR CONFIRMATION", score: 65, catalyst: 20, thesisLabel: "NO PRIOR THESIS" },
    { label: "AVOID", score: 60, catalyst: 15, thesisLabel: "NO PRIOR THESIS" },
    { label: "EXIT-RISK", score: 65, catalyst: 20, thesisLabel: "AT RISK" },
  ])("rejects a $label chart while accepting the same setup without a chart", ({ label, score, catalyst, thesisLabel }) => {
    const edition = fixture();
    const setup = edition.primaryBoard[0]!;
    Object.assign(setup, { label, score, thesisLabel });
    Object.assign(setup.components, { catalyst, premarketStructure: 0, levelQualityAndProximity: 0 });
    expect(marketResearchEditionRecordSchema.safeParse(edition).success).toBe(false);
    edition.chartRequests = [];
    expect(marketResearchEditionRecordSchema.safeParse(edition).success).toBe(true);
  });

  it("rejects unranked symbols, context charts, and contradictory duplicate rankings", () => {
    const unranked = fixture();
    unranked.chartRequests[0]!.symbol = "SPY";
    expect(marketResearchEditionRecordSchema.safeParse(unranked).success).toBe(false);
    const context = fixture();
    context.chartRequests[0]!.sectionId = "data_quality";
    expect(marketResearchEditionRecordSchema.safeParse(context).success).toBe(false);
    const duplicate = fixture();
    duplicate.primaryBoard.push({ ...duplicate.primaryBoard[0]!, thesisLabel: "AT RISK" });
    expect(marketResearchEditionRecordSchema.safeParse(duplicate).success).toBe(false);
  });
});
