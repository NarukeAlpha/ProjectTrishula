import { describe, expect, it, vi } from "vitest";
import type { AgentSession, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { CodexRuntime } from "../src/pi/codex-runtime.js";
import {
  createMorningPaperComposer,
  validateComposedEdition,
  type MorningPaperResearchContext,
  type MorningPaperSessionFactory,
} from "../src/market-research/composer.js";
import {
  marketResearchPreferencesSchema,
  morningPaperEvidenceSchema,
  type MarketResearchEvidenceItem,
  type MarketResearchThesisMemoryV1,
  type MorningPaperEditionV1,
  type MorningPaperEvidenceV1,
} from "../src/market-research/contracts.js";
import { morningPaperOutputGuide, morningPaperSystemPrompt } from "../src/market-research/research-prompt.js";

const now = "2026-09-07T12:00:00.000Z";
const preferences = marketResearchPreferencesSchema.parse({
  schemaVersion: 1, preferenceId: "pref-1", scheduleId: "schedule-1", ownerId: "owner-1", guildId: "guild-1",
  enabled: true, forumChannelId: "forum-1", forumTagIds: [],
  timezone: "America/New_York", timezoneConfirmed: true,
  displayTimezones: ["America/New_York", "America/Puerto_Rico"], localHour: 8, localMinute: 0,
  primarySymbols: ["AMD"], symbolPriorities: {}, sectorSymbols: ["SMH"], discoverySymbols: ["AVGO"],
  followedSectors: [], trackedThemes: [], macroTopics: [], eventCategories: [], preferredDomains: [], excludedDomains: [],
  requestedSources: ["FinancialJuice", "Barchart", "ForexFactory", "Yahoo", "TradingView"],
  reportSections: {
    overnightMacro: true, crossAsset: true, indexSector: true, calendar: true, primaryBoard: true,
    challengers: true, tickerDossiers: true, validation: true, afterOpen: true,
    requestedSources: true, dataQuality: true, sources: true,
  },
  maximumRankedSetups: 10, editionDepth: "full", includeWeekends: true,
  includeCharts: true, chartsAcceptancePassed: false, maximumCharts: 3,
  lateEditionCutoffLocalTime: "12:00", searchRequestBudget: 12, contentsPageBudget: 24,
  marketDataProviderId: null, marketSessionCalendarId: "nyse",
  durableTheses: [], sourcePolicyVersion: "source-policy-v1", promptVersion: "morning-paper-v1",
  revision: 0, createdAt: now, updatedAt: now,
});

const source: MarketResearchEvidenceItem = {
  evidenceId: "amd-ir-announcement", kind: "news", provider: "Exa Search", sourcePolicy: "approved",
  title: "AMD investor relations announcement", url: "https://ir.amd.com/news-events/press-releases",
  retrievedAt: now, publishedAt: now, freshness: "fresh", contentStatus: "available",
  highlights: ["AMD discussed its data center roadmap."], normalizedClaims: [], contentHash: "a".repeat(64),
};

function evidence(items: MarketResearchEvidenceItem[] = []): MorningPaperEvidenceV1 {
  return morningPaperEvidenceSchema.parse({
    schemaVersion: 1, editionId: "edition-agent-research", generatedAt: now,
    session: {
      sessionType: "CLOSED", editionLabel: "Market Holiday Outlook", editionDate: "2026-09-07",
      timezone: "America/New_York", configuredLocalTime: now, marketTime: now,
      previousSessionDate: "2026-09-04", previousSessionClose: "2026-09-04T20:00:00.000Z",
      nextSessionDate: "2026-09-08", calendarVersion: "nyse-2026", sourceIds: [],
    },
    primarySymbols: preferences.primarySymbols, sectorSymbols: preferences.sectorSymbols,
    discoverySymbols: preferences.discoverySymbols, sourcePolicyVersion: preferences.sourcePolicyVersion,
    requestedSourceStatus: preferences.requestedSources.map((requested) => ({
      source: requested, status: "unavailable", detail: "Not verified in this fixture.", sourceIds: [],
    })),
    evidence: items, missingFields: ["Live price and volume are unavailable."], conflicts: [],
    allowedSourceIds: items.map((item) => item.evidenceId),
  });
}

function usefulEdition(packet: MorningPaperEvidenceV1): MorningPaperEditionV1 {
  const cited = { text: "AMD's roadmap remains a catalyst to follow; the release does not establish a current price.", sourceIds: [source.evidenceId] };
  const unavailable = { text: "Live price, spread, volume, and technical levels are unverified.", sourceIds: [] };
  return {
    schemaVersion: 1, editionId: packet.editionId, editionDate: packet.session.editionDate,
    timezone: packet.session.timezone, asOf: packet.generatedAt,
    sessionType: packet.session.sessionType, editionLabel: packet.session.editionLabel,
    regime: "MIXED", regimeLines: [cited], topStories: [cited], scheduledEvents: [], marketContext: [cited],
    primaryBoard: [], challengers: [],
    tickerDossiers: [{
      symbol: "AMD", thesisLabel: "NO PRIOR THESIS", summary: cited,
      availableFields: ["company catalyst"], unavailableFields: ["price", "volume", "spread", "technical levels"],
      sourceIds: [source.evidenceId],
    }],
    validationRules: [unavailable], afterOpenChanges: [], requestedSourceStatus: packet.requestedSourceStatus,
    dataQuality: [unavailable],
    sections: [
      {
        sectionId: "board", sequence: 0, kind: "primary_board", heading: "AMD: catalyst worth following",
        markdown: "AMD discussed its data center roadmap. That gives the next session a company-specific catalyst to check. No ranked setup: current price, volume, and technical levels are unverified. [AMD investor relations](https://ir.amd.com/news-events/press-releases)",
        sourceIds: [source.evidenceId],
      },
      {
        sectionId: "quality", sequence: 1, kind: "data_quality", heading: "What is missing",
        markdown: "Price, volume, spread, and precise entry levels are unverified. The company release still supports catalyst research.",
        sourceIds: [source.evidenceId],
      },
      {
        sectionId: "sources", sequence: 2, kind: "sources", heading: "Sources",
        markdown: "[AMD investor relations](https://ir.amd.com/news-events/press-releases)", sourceIds: [source.evidenceId],
      },
    ],
    chartRequests: [], sourceIds: [source.evidenceId], noTradingAction: true,
  };
}

function setup(symbol = "AMD"): MorningPaperEditionV1["primaryBoard"][number] {
  const claim = { text: "Fixture sourced setup condition.", sourceIds: [source.evidenceId] };
  return {
    symbol, label: "WATCH", score: 75,
    components: { catalyst: 15, liquidityAndSpread: 10, dailyAndHourlyBias: 15, premarketStructure: 10, levelQualityAndProximity: 15, indexAndSectorConfirmation: 10 },
    deductions: ["Fixture deduction."], thesisLabel: "NO PRIOR THESIS",
    trigger: claim, invalidation: claim, firstResistanceOrTarget: claim, rewardToRisk: claim,
    noChase: claim, indexOrSectorCondition: claim, eventRisk: claim, sourceIds: [source.evidenceId],
  };
}

function chart(symbol = "AMD"): MorningPaperEditionV1["chartRequests"][number] {
  return {
    chartRequestId: `chart-${symbol}`, editionId: "edition-agent-research", sectionId: "not-yet-rendered",
    symbol, timeframe: "daily", start: "2026-08-07T12:00:00.000Z", end: now, session: "all",
    overlays: [], annotations: [], reason: "Review the verified positive setup's higher-timeframe structure.",
    priority: 80, sourceEvidenceIds: [source.evidenceId], dataAsOf: now,
  };
}

function assistant(text: string): AssistantMessage {
  return {
    role: "assistant", content: [{ type: "text", text }], api: "openai-codex-responses",
    provider: "openai-codex", model: "gpt-6-astra", stopReason: "stop", timestamp: Date.parse(now),
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

const priorThesis: MarketResearchThesisMemoryV1 = {
  symbol: "AMD", revision: 2, text: "Data-center adoption supports the multiyear growth thesis.",
  catalysts: ["Customer deployment announcements"], invalidation: "Sustained failure to translate design wins into revenue.",
  openQuestions: ["How broad is customer adoption?"], status: "active", assessment: "unchanged",
  changeSummary: "Prior research left the thesis intact.", sources: [{ sourceId: "prior-ir", url: "https://ir.amd.com/" }],
  lastReviewedAt: "2026-09-04T12:00:00.000Z", lastEditionId: "prior-edition",
};

function harness(options: {
  output?: (packet: MorningPaperEvidenceV1, turn: number) => string;
  queuedCharts?: MorningPaperEditionV1["chartRequests"];
  activeTools?: string[];
  thesisMemory?: MarketResearchThesisMemoryV1[];
} = {}) {
  const initial = evidence();
  let current = initial;
  const tools = ["exa_search", "exa_read", "request_chart", "update_thesis"].map((name): ToolDefinition => ({
    name, label: name, description: "Local research tool double.", parameters: Type.Object({}),
    execute: vi.fn<ToolDefinition["execute"]>(async () => {
      if (name === "exa_search") current = evidence([source]);
      return { content: [{ type: "text", text: JSON.stringify(current) }], details: {} };
    }),
  }));
  const research: MorningPaperResearchContext = {
    tools, getEvidence: () => current, getChartRequests: () => options.queuedCharts ?? [],
    getThesisMemory: () => options.thesisMemory ?? [], getThesisUpdates: () => [],
  };
  const messages: AgentSession["messages"] = [];
  let turn = 0;
  const prompt = vi.fn(async () => {
    turn += 1;
    if (turn === 1) {
      const search = tools[0];
      if (!search) throw new Error("Missing test tool.");
      // SAFETY: The tool double does not inspect its empty parameters or extension context.
      await search.execute("tool-call-1", {}, undefined, undefined, {} as never);
    }
    messages.push(assistant(options.output?.(current, turn) ?? JSON.stringify(usefulEdition(current))));
  });
  const standardStream = vi.fn<AgentSession["agent"]["streamFunction"]>();
  const session = {
    messages, prompt, getActiveToolNames: () => options.activeTools ?? tools.map((tool) => tool.name),
    setActiveToolsByName: vi.fn(), abort: vi.fn(async () => undefined), dispose: vi.fn(), isStreaming: false,
    agent: { streamFunction: standardStream },
  };
  const createSession = vi.fn<MorningPaperSessionFactory>().mockResolvedValue({ session });
  const runtime = new CodexRuntime("/unused-auth-fixture");
  // SAFETY: The injected session factory only observes this model's identity; it never contacts a provider.
  const model = { id: "gpt-6-astra" } as Awaited<ReturnType<CodexRuntime["requireModel"]>>;
  vi.spyOn(runtime, "requireModel").mockResolvedValue(model);
  // SAFETY: The injected session factory does not use modelRuntime; this sentinel avoids credentials and I/O.
  vi.spyOn(runtime, "get").mockResolvedValue({} as Awaited<ReturnType<CodexRuntime["get"]>>);
  const composer = createMorningPaperComposer(runtime, "gpt-6-astra", createSession);
  return { composer, initial, research, createSession, session, runtime, model, standardStream };
}

describe("agent-led morning newspaper composer", () => {
  it("enables only the research tools on Codex OAuth and validates against evidence collected during the session", async () => {
    const test = harness();
    await test.composer.initialize();
    const result = await test.composer.compose(test.initial, preferences, undefined, test.research);

    expect(test.initial.allowedSourceIds).toEqual([]);
    expect(result.sourceIds).toEqual([source.evidenceId]);
    expect(result.sections[0]?.markdown).toContain("AMD discussed its data center roadmap");
    expect(result.editionLabel).toBe("Market Holiday Outlook");
    expect(result.tickerDossiers[0]?.unavailableFields).toContain("price");
    expect(test.createSession).toHaveBeenCalledWith(expect.objectContaining({
      model: test.model, thinkingLevel: "xhigh", noTools: "all",
      tools: ["exa_read", "exa_search", "request_chart", "update_thesis"], customTools: test.research.tools,
    }));
    expect(test.runtime.requireModel).toHaveBeenCalledWith("gpt-6-astra");
    expect(test.session.dispose).toHaveBeenCalledOnce();
    expect(test.session.prompt).toHaveBeenCalledOnce();
  });

  it("provides the full output shape and explicit missing-data research instructions", async () => {
    const test = harness();
    await test.composer.initialize();
    await test.composer.compose(test.initial, preferences, undefined, test.research);
    const options = test.createSession.mock.calls[0]?.[0];
    expect(options?.resourceLoader?.getSystemPrompt()).toBe(morningPaperSystemPrompt);
    expect(morningPaperSystemPrompt).toContain("MUST NOT stop research");
    expect(morningPaperSystemPrompt).toContain("Never invent quotes");
    expect(morningPaperSystemPrompt).toContain("sections[].markdown");
    expect(test.session.prompt).toHaveBeenCalledWith(expect.stringContaining(morningPaperOutputGuide), { expandPromptTemplates: false });
  });

  it("uses priority transport without replacing the configured model or OAuth runtime", async () => {
    const test = harness();
    await test.composer.initialize();
    await test.composer.compose(test.initial, preferences, undefined, test.research);
    test.session.agent.streamFunction(test.model, { messages: [] });
    expect(test.standardStream).toHaveBeenCalledWith(test.model, { messages: [] }, expect.objectContaining({ serviceTier: "priority" }));
  });

  it("loads historical thesis notes into the prompt and allows comparison without requiring staged updates", async () => {
    const test = harness({
      thesisMemory: [priorThesis],
      output: (packet) => JSON.stringify({ ...usefulEdition(packet), tickerDossiers: [{ ...usefulEdition(packet).tickerDossiers[0], thesisLabel: "VALIDATED" }] }),
    });
    await test.composer.initialize();
    const result = await test.composer.compose(test.initial, preferences, undefined, test.research);
    expect(result.tickerDossiers[0]?.thesisLabel).toBe("VALIDATED");
    expect(test.session.prompt).toHaveBeenCalledWith(expect.stringContaining(JSON.stringify([priorThesis])), { expandPromptTemplates: false });
    expect(test.research.getThesisUpdates()).toEqual([]);
    expect(morningPaperSystemPrompt).toContain("Missing data never invalidates a thesis by itself");
    expect(morningPaperSystemPrompt).toContain("two to four sentences");
    expect(morningPaperSystemPrompt).toContain("Prices, volume, entry triggers, and technical levels are temporary");
  });

  it("recognizes invalidated saved and legacy theses instead of erasing their comparison history", () => {
    const packet = evidence([source]);
    const edition = usefulEdition(packet);
    edition.tickerDossiers[0]!.thesisLabel = "INVALIDATED";
    expect(validateComposedEdition(edition, packet, preferences, [{ ...priorThesis, status: "invalidated", assessment: "invalidated" }])).toEqual(edition);
    const legacy = { thesisId: "legacy-amd", symbol: "AMD", text: priorThesis.text, priority: 50, keyLevels: [], invalidation: priorThesis.invalidation, expiresAt: null, status: "invalidated" as const };
    expect(validateComposedEdition(edition, packet, { ...preferences, durableTheses: [legacy] })).toEqual(edition);
    expect(() => validateComposedEdition(edition, packet, { ...preferences, durableTheses: [{ ...legacy, status: "expired" }] })).toThrow("composition_schema_invalid");
    expect(() => validateComposedEdition(edition, packet, preferences)).toThrow("composition_schema_invalid");
  });

  it("repairs one technical output error without making another paid tool call or discarding the report", async () => {
    const test = harness({ output: (packet, turn) => JSON.stringify({ ...usefulEdition(packet), schemaVersion: turn === 1 ? 999 : 1 }) });
    await test.composer.initialize();
    const result = await test.composer.compose(test.initial, preferences, undefined, test.research);
    expect(test.session.prompt).toHaveBeenCalledTimes(2);
    expect(test.session.setActiveToolsByName).toHaveBeenCalledWith([]);
    expect(test.research.tools[0]?.execute).toHaveBeenCalledOnce();
    expect(test.session.prompt).toHaveBeenLastCalledWith(expect.stringContaining("schemaVersion"), { expandPromptTemplates: false });
    expect(result.sections[0]?.markdown).toContain("data center roadmap");
  });

  it("does not loop when the single repair is still invalid", async () => {
    const test = harness({ output: () => "not valid JSON" });
    await test.composer.initialize();
    await expect(test.composer.compose(test.initial, preferences, undefined, test.research)).rejects.toThrow("composition_schema_invalid");
    expect(test.session.prompt).toHaveBeenCalledTimes(2);
    expect(test.session.dispose).toHaveBeenCalledOnce();
  });

  it("rejects model citations not returned by research, including after repair", async () => {
    const test = harness({ output: (packet) => JSON.stringify({ ...usefulEdition(packet), sourceIds: [source.evidenceId, "invented-source"] }) });
    await test.composer.initialize();
    await expect(test.composer.compose(test.initial, preferences, undefined, test.research)).rejects.toThrow("composition_citation_invalid");
    expect(test.session.prompt).toHaveBeenCalledTimes(2);
  });

  it("uses actual final source availability and includes its citations instead of copying stale model statuses", async () => {
    const test = harness();
    const currentEvidence = test.research.getEvidence;
    const yahooSource = { ...source, evidenceId: "yahoo-source", url: "https://finance.yahoo.com/quote/AMD" };
    test.research.getEvidence = () => {
      const packet = currentEvidence();
      return {
        ...packet,
        evidence: [...packet.evidence, yahooSource],
        allowedSourceIds: [...packet.allowedSourceIds, yahooSource.evidenceId],
        requestedSourceStatus: packet.requestedSourceStatus.map((status) => status.source === "Yahoo"
          ? { ...status, status: "contributed", detail: "A current public result contributed to research.", sourceIds: [yahooSource.evidenceId] }
          : status),
      };
    };
    await test.composer.initialize();
    const result = await test.composer.compose(test.initial, preferences, undefined, test.research);
    expect(result.requestedSourceStatus.find((status) => status.source === "Yahoo")).toMatchObject({
      status: "contributed", sourceIds: [yahooSource.evidenceId],
    });
    expect(result.sourceIds).toEqual([source.evidenceId, yahooSource.evidenceId]);
    expect(test.session.prompt).toHaveBeenCalledOnce();
  });

  it("carries eligible chart-tool requests into the actual board section, ignoring model-only requests", async () => {
    const chartSource = { ...source, evidenceId: "chart-only-source" };
    const queuedChart = { ...chart(), sourceEvidenceIds: [chartSource.evidenceId] };
    const test = harness({
      queuedCharts: [queuedChart],
      output: (packet) => JSON.stringify({ ...usefulEdition(packet), primaryBoard: [setup()], chartRequests: [{ modelInvented: true }] }),
    });
    const currentEvidence = test.research.getEvidence;
    test.research.getEvidence = () => {
      const packet = currentEvidence();
      return { ...packet, evidence: [...packet.evidence, chartSource], allowedSourceIds: [...packet.allowedSourceIds, chartSource.evidenceId] };
    };
    await test.composer.initialize();
    const result = await test.composer.compose(test.initial, preferences, undefined, test.research);
    expect(result.chartRequests).toEqual([{ ...queuedChart, sectionId: "board" }]);
    expect(result.sourceIds).toContain(chartSource.evidenceId);
    expect(test.session.prompt).toHaveBeenCalledOnce();
  });

  it("drops queued charts when the final board has no positive ranked setup", async () => {
    const test = harness({ queuedCharts: [chart()] });
    await test.composer.initialize();
    const result = await test.composer.compose(test.initial, preferences, undefined, test.research);
    expect(result.chartRequests).toEqual([]);
    expect(test.session.prompt).toHaveBeenCalledOnce();
  });

  it("honors disabled charts even when a tool request was queued", async () => {
    const test = harness({ queuedCharts: [chart()], output: (packet) => JSON.stringify({ ...usefulEdition(packet), primaryBoard: [setup()] }) });
    await test.composer.initialize();
    const result = await test.composer.compose(test.initial, { ...preferences, includeCharts: false }, undefined, test.research);
    expect(result.chartRequests).toEqual([]);
  });

  it("refuses unexpected tools registered before the session is created", async () => {
    const test = harness();
    test.research.tools[0] = { ...test.research.tools[0]!, name: "bash" };
    await test.composer.initialize();
    await expect(test.composer.compose(test.initial, preferences, undefined, test.research)).rejects.toThrow("composition_provider_not_ready");
    expect(test.createSession).not.toHaveBeenCalled();
  });

  it("refuses a session exposing a built-in tool and disposes it", async () => {
    const test = harness({ activeTools: ["exa_search", "exa_read", "request_chart", "update_thesis", "read"] });
    await test.composer.initialize();
    await expect(test.composer.compose(test.initial, preferences, undefined, test.research)).rejects.toThrow("composition_provider_not_ready");
    expect(test.session.prompt).not.toHaveBeenCalled();
    expect(test.session.dispose).toHaveBeenCalledOnce();
  });

  it("does not begin provider work for an already canceled job", async () => {
    const test = harness();
    await test.composer.initialize();
    await expect(test.composer.compose(test.initial, preferences, AbortSignal.abort(new Error("edition_lease_lost")), test.research)).rejects.toThrow("edition_lease_lost");
    expect(test.createSession).not.toHaveBeenCalled();
  });

  it("accepts sourced prose with timestamps, general chart intervals, and derived numbers without brittle token matching", () => {
    const packet = evidence([source]);
    const edition = usefulEdition(packet);
    edition.sections[0]!.markdown += " Research checked at 08:00 ET. Use a 5-minute confirmation only after the open; exact levels are unverified.";
    expect(validateComposedEdition(edition, packet, preferences)).toEqual(edition);
  });

  it("deduplicates section citations before the backend handoff", () => {
    const packet = evidence([source]);
    const edition = usefulEdition(packet);
    edition.sections[0]!.sourceIds = [source.evidenceId, source.evidenceId];
    expect(validateComposedEdition(edition, packet, preferences).sections[0]?.sourceIds).toEqual([source.evidenceId]);
  });

  it("keeps frozen identity, primary universe, and research-only language enforced", () => {
    const packet = evidence([source]);
    const edition = usefulEdition(packet);
    expect(() => validateComposedEdition({ ...edition, editionId: "different-edition" }, packet, preferences)).toThrow("composition_schema_invalid");
    expect(() => validateComposedEdition({ ...edition, primaryBoard: [setup("TSLA")] }, packet, preferences)).toThrow("composition_schema_invalid");
    expect(() => validateComposedEdition({ ...edition, tickerDossiers: [{ ...edition.tickerDossiers[0], symbol: "UNLISTED" }] }, packet, preferences)).toThrow("composition_schema_invalid");
    expect(() => validateComposedEdition({ ...edition, topStories: [{ text: "I placed an order.", sourceIds: [source.evidenceId] }] }, packet, preferences)).toThrow("composition_schema_invalid");
  });
});
