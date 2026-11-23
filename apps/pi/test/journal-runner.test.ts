import { describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Context, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import type { CapturedChart, ChartProvider } from "../src/journal/charts/index.js";
import type { JournalRunRequest } from "../src/journal/contracts.js";
import {
  ConvexJournalClient,
  JournalConvexError,
  JournalRunInactiveError,
  type JournalConvexClient,
  type JournalRunCompleteInput,
  type JournalRunProgressInput,
} from "../src/journal/convex-client.js";
import type { JournalModelAdapter, JournalModelCompletionRequest } from "../src/journal/model.js";
import { createJournalAgentRunner } from "../src/journal/runner.js";
import { executeJournalTool } from "../src/journal/tools.js";
import type { Logger } from "../src/runtime/logger.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function makePngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function makeAssistantMessage(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-6-astra",
    usage: {
      input: 100,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 150,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 1_700_000_000_000,
  };
}

function makeToolCall(id: string, name: string, args: ToolCall["arguments"]): ToolCall {
  return {
    type: "toolCall",
    id,
    name,
    arguments: args,
  };
}

function makeRunRequest(overrides: Partial<JournalRunRequest> = {}): JournalRunRequest {
  return {
    runId: "jrun-e2e-1",
    ownerId: "user_trader_1",
    runToken: "cap-token-1",
    settings: {
      brokerTimeZone: "America/Puerto_Rico",
      updatedAt: 1_700_000_000_000,
    },
    userMessage: {
      stableId: "msg-1",
      ordinal: 1,
      role: "user",
      text: "Log my QQQ scalp from this Robinhood screenshot and review it on the 5m chart.",
      attachments: [
        {
          storageId: "storage-1",
          imageKey: "a".repeat(64),
          mimeType: "image/png",
          filename: "robinhood-orders.png",
          url: "https://convex.example.com/api/storage/storage-1",
        },
      ],
      status: "completed",
      createdAt: 1_700_000_001_000,
      updatedAt: 1_700_000_001_000,
    },
    history: [],
    ...overrides,
  };
}

describe("JournalAgentRunner end-to-end tool loop", () => {
  it("fetches user screenshot, runs import_orders -> capture_chart (with vision feedback) -> save_review -> completeRun", async () => {
    const chartKey = "b".repeat(64);
    const capturedPng = makePngBytes(1_200, 750);
    const screenshotPng = makePngBytes(900, 1_600);
    const seenContexts: Context[] = [];

    const modelCalls: AssistantMessage[] = [
      makeAssistantMessage([
        makeToolCall("tc-1", "import_orders", {
          orderDays: [
            {
              date: "2026-04-15",
              note: "QQQ 0DTE scalp",
              orders: [
                {
                  contract: "QQQ 04/15 500C",
                  submittedAt: "10:15:00",
                  status: "Filled",
                  side: "Buy",
                  type: "Limit",
                  quantity: 2,
                  averageFillCents: 150,
                  realizedPnlCents: null,
                  cashCents: -30_000,
                  limitCents: 150,
                },
                {
                  contract: "QQQ 04/15 500C",
                  submittedAt: "10:25:00",
                  status: "Filled",
                  side: "Sell",
                  type: "Limit",
                  quantity: 2,
                  averageFillCents: 210,
                  realizedPnlCents: 12_000,
                  cashCents: 42_000,
                  limitCents: 210,
                },
              ],
            },
          ],
          trades: [
            {
              stableId: "trade-qqq-1",
              trade: {
                symbol: "QQQ",
                instrument: "Options",
                account: "Live",
                direction: "Long",
                status: "Closed",
                openedOn: "2026-04-15",
                closedOn: "2026-04-15",
                setup: "VWAP reclaim",
                size: "2x 500C",
                details: "Entered after 10:15 AST (10:15 ET) reclaim.",
                plannedRiskCents: 10_000,
                realizedPnlCents: 12_000,
                thesis: "Reclaim above VWAP after morning flush.",
                plan: "Exit into prior high or stop below VWAP.",
                review: "Clean exit.",
                adherence: "Followed",
                mistakes: [],
              },
            },
          ],
        }),
      ], "toolUse"),
      makeAssistantMessage([
        makeToolCall("tc-2", "capture_chart", {
          symbol: "NASDAQ:QQQ",
          interval: "5m",
          from: "2026-04-15T13:30:00Z",
          to: "2026-04-15T16:00:00Z",
          preset: "intraday",
        }),
      ], "toolUse"),
      makeAssistantMessage([
        makeToolCall("tc-3", "save_review", {
          tradeStableId: "trade-qqq-1",
          assistantReview: {
            version: 1,
            instrument: "QQQ 04/15 500C",
            timeZone: "ET",
            timing: "10:15–10:25 ET",
            summary: "Clean VWAP reclaim entry and disciplined exit into resistance.",
            charts: [
              {
                image: chartKey,
                width: 1_200,
                height: 750,
                crop: { x: 40, y: 30, width: 1_100, height: 660 },
                focus: { x: 420, y: 200, width: 240, height: 180 },
                focusLabel: "VWAP reclaim entry",
                levels: [{ y: 310, label: "VWAP 499.40" }],
                ticks: [{ x: 500, label: "10:15" }],
                interval: "5m",
                heading: "5m VWAP reclaim",
                text: "Entered on the first higher low above VWAP and scaled out at the prior high.",
                alt: "QQQ 5m candlestick chart showing VWAP reclaim and exit.",
              },
            ],
            nextTime: "Keep taking partial profits at the first test of prior session highs.",
          },
        }),
      ], "toolUse"),
      makeAssistantMessage([
        {
          type: "text",
          text: "Imported your QQQ trade (+$120) and saved the 5m chart review.\n\n**Next time:** Keep taking partial profits at the first test of prior session highs.",
        },
      ], "stop"),
    ];

    let turn = 0;
    const model: JournalModelAdapter = {
      provider: "openai-codex",
      modelId: "gpt-6-astra",
      initialize: vi.fn(async () => undefined),
      readiness: vi.fn(() => ({ ready: true })),
      complete: vi.fn(async (req: JournalModelCompletionRequest) => {
        seenContexts.push(structuredClone(req.context));
        const next = modelCalls[turn];
        turn += 1;
        if (!next) throw new Error("Unexpected extra model turn");
        return next;
      }),
      dispose: vi.fn(async () => undefined),
    };

    const progressUpdates: JournalRunProgressInput[] = [];
    const completions: JournalRunCompleteInput[] = [];

    const convex: JournalConvexClient = {
      getDiary: vi.fn<JournalConvexClient["getDiary"]>(),
      importOrders: vi.fn<JournalConvexClient["importOrders"]>(async (_creds, input) => ({
        orderDays: input.orderDays.map((day, idx) => ({
          stableId: day.stableId ?? `od-${idx}`,
          date: day.date,
          note: day.note,
          orders: day.orders,
          createdAt: 1,
          updatedAt: 1,
        })),
        trades: input.trades.map((entry, idx) => ({
          stableId: entry.stableId ?? `tr-${idx}`,
          ...entry.trade,
          assistantReview: null,
          createdAt: 1,
          updatedAt: 1,
        })),
      })),
      upsertTrade: vi.fn<JournalConvexClient["upsertTrade"]>(),
      saveReview: vi.fn<JournalConvexClient["saveReview"]>(async (_creds, input) => ({
        stableId: input.tradeStableId,
        symbol: "QQQ",
        instrument: "Options",
        account: "Live",
        direction: "Long",
        status: "Closed",
        openedOn: "2026-04-15",
        closedOn: "2026-04-15",
        setup: "VWAP reclaim",
        size: "2x 500C",
        details: "",
        plannedRiskCents: 10_000,
        realizedPnlCents: 12_000,
        thesis: "",
        plan: "",
        review: "",
        adherence: "Followed",
        mistakes: [],
        assistantReview: JSON.stringify(input.assistantReview),
        createdAt: 1,
        updatedAt: 2,
      })),
      upsertLesson: vi.fn<JournalConvexClient["upsertLesson"]>(),
      uploadChart: vi.fn<JournalConvexClient["uploadChart"]>(async (_creds, input) => ({
        imageKey: chartKey,
        storageId: "chart-storage-1",
        mimeType: input.mimeType,
        url: "https://convex.example.com/api/storage/chart-storage-1",
        width: input.width,
        height: input.height,
      })),
      reportProgress: vi.fn<JournalConvexClient["reportProgress"]>(async (_creds, input) => {
        progressUpdates.push(structuredClone(input));
        return { accepted: true, status: "running" };
      }),
      completeRun: vi.fn<JournalConvexClient["completeRun"]>(async (_creds, input) => {
        completions.push(structuredClone(input));
        return { accepted: true, status: input.status };
      }),
    };

    const chartProvider: ChartProvider = {
      id: "chart_img",
      isConfigured: () => true,
      captureChart: vi.fn(async (): Promise<CapturedChart> => ({
        bytes: capturedPng,
        mimeType: "image/png",
        width: 1_200,
        height: 750,
        symbol: "NASDAQ:QQQ",
        interval: "5m",
        source: "chart_img",
      })),
    };

    const attachmentFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Blob([new Uint8Array(screenshotPng)], { type: "image/png" }), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    const runner = createJournalAgentRunner({
      model,
      convex,
      chartProvider,
      convexSiteUrl: "https://convex.example.com/http",
      attachmentFetch,
      logger: silentLogger,
    });

    await runner.run(makeRunRequest());

    // 1. User message included the fetched broker screenshot as vision ImageContent
    const firstTurnUser = seenContexts[0]?.messages[0];
    expect(firstTurnUser?.role).toBe("user");
    if (firstTurnUser?.role === "user") {
      expect(Array.isArray(firstTurnUser.content)).toBe(true);
      if (Array.isArray(firstTurnUser.content)) {
        const imagePart = firstTurnUser.content.find((part) => part.type === "image");
        expect(imagePart).toEqual({
          type: "image",
          mimeType: "image/png",
          data: Buffer.from(screenshotPng).toString("base64"),
        });
      }
    }

    // 2. capture_chart tool result fed the rendered chart image directly back to the vision model
    const thirdTurnMessages = seenContexts[2]?.messages ?? [];
    const captureResultMsg = thirdTurnMessages.find(
      (msg): msg is ToolResultMessage =>
        msg.role === "toolResult" && msg.toolName === "capture_chart",
    );
    expect(captureResultMsg).toBeDefined();
    expect(captureResultMsg?.isError).toBe(false);
    expect(captureResultMsg?.content.some((part) => part.type === "image")).toBe(true);
    const captureTextPart = captureResultMsg?.content.find((part) => part.type === "text");
    expect(captureTextPart?.type === "text" ? JSON.parse(captureTextPart.text) : null).toMatchObject({
      imageKey: chartKey,
      width: 1_200,
      height: 750,
    });

    // 3. All tool mutations were invoked and live progress updates were emitted
    expect(convex.importOrders).toHaveBeenCalledTimes(1);
    expect(chartProvider.captureChart).toHaveBeenCalledTimes(1);
    expect(convex.uploadChart).toHaveBeenCalledTimes(1);
    expect(convex.saveReview).toHaveBeenCalledTimes(1);
    expect(progressUpdates.length).toBeGreaterThanOrEqual(6);

    // 4. Final completion recorded with completed status, prose, and toolEvents
    expect(completions).toHaveLength(1);
    expect(completions[0]?.status).toBe("completed");
    expect(completions[0]?.text).toContain("**Next time:**");
    expect(completions[0]?.toolEvents).toHaveLength(3);
    expect(completions[0]?.toolEvents?.every((ev) => ev.status === "completed")).toBe(true);
  });

  it("stops gracefully without crashing or marking failed when Convex returns 409 run_not_active", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "run_not_active" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    const realConvexClient = new ConvexJournalClient({
      siteUrl: "https://convex.example.com/http",
      sharedSecret: "a-secure-service-secret-with-32-chars",
      timeoutMs: 5_000,
      logger: silentLogger,
      fetch: fetchMock,
    });

    const completeSpy = vi.spyOn(realConvexClient, "completeRun");

    const model: JournalModelAdapter = {
      provider: "openai-codex",
      modelId: "gpt-6-astra",
      initialize: vi.fn(async () => undefined),
      readiness: vi.fn(() => ({ ready: true })),
      complete: vi.fn(async () =>
        makeAssistantMessage([makeToolCall("tc-1", "get_diary", {})], "toolUse"),
      ),
      dispose: vi.fn(async () => undefined),
    };

    const chartProvider: ChartProvider = {
      id: "chart_img",
      isConfigured: () => false,
      captureChart: vi.fn(),
    };

    const runner = createJournalAgentRunner({
      model,
      convex: realConvexClient,
      chartProvider,
      convexSiteUrl: "https://convex.example.com/http",
      logger: silentLogger,
    });

    // Should resolve cleanly rather than throwing unhandled rejection
    await expect(
      runner.run(
        makeRunRequest({
          userMessage: {
            stableId: "msg-2",
            ordinal: 2,
            role: "user",
            text: "List my trades.",
            attachments: [],
            status: "completed",
            createdAt: 1_700_000_002_000,
            updatedAt: 1_700_000_002_000,
          },
        }),
      ),
    ).resolves.toBeUndefined();

    // Must NOT overwrite Convex's canceled state with completeRun(failed)
    expect(completeSpy).not.toHaveBeenCalled();

    // Verify ConvexJournalClient directly throws JournalRunInactiveError on 409
    await expect(
      realConvexClient.getDiary({ ownerId: "u1", runId: "r1", runToken: "t1" }),
    ).rejects.toBeInstanceOf(JournalRunInactiveError);
  });

  it("always calls completeRun(failed) on unexpected model errors so runs are never left dangling", async () => {
    const model: JournalModelAdapter = {
      provider: "openai-codex",
      modelId: "gpt-6-astra",
      initialize: vi.fn(async () => undefined),
      readiness: vi.fn(() => ({ ready: true })),
      complete: vi.fn(async () => {
        throw new Error("Codex upstream connection reset");
      }),
      dispose: vi.fn(async () => undefined),
    };

    const completeRun = vi.fn(async () => ({ accepted: true, status: "failed" }));
    const convex: JournalConvexClient = {
      getDiary: vi.fn(),
      importOrders: vi.fn(),
      upsertTrade: vi.fn(),
      saveReview: vi.fn(),
      upsertLesson: vi.fn(),
      uploadChart: vi.fn(),
      reportProgress: vi.fn(async () => ({ accepted: true, status: "running" })),
      completeRun,
    };

    const chartProvider: ChartProvider = {
      id: "chart_img",
      isConfigured: () => false,
      captureChart: vi.fn(),
    };

    const runner = createJournalAgentRunner({
      model,
      convex,
      chartProvider,
      convexSiteUrl: "https://convex.example.com/http",
      logger: silentLogger,
    });

    await runner.run(
      makeRunRequest({
        userMessage: {
          stableId: "msg-3",
          ordinal: 3,
          role: "user",
          text: "Review my trades.",
          attachments: [],
          status: "completed",
          createdAt: 1_700_000_003_000,
          updatedAt: 1_700_000_003_000,
        },
      }),
    );

    expect(completeRun).toHaveBeenCalledTimes(1);
    expect(completeRun).toHaveBeenCalledWith(
      {
        ownerId: "user_trader_1",
        runId: "jrun-e2e-1",
        runToken: "cap-token-1",
      },
      {
        status: "failed",
        text: "",
        error: "Codex upstream connection reset",
      },
    );
  });

  it("blocks attachments from disallowed origins and still completes safely", async () => {
    const attachmentFetch = vi.fn<typeof fetch>();
    let capturedContext: Context | undefined;

    const model: JournalModelAdapter = {
      provider: "openai-codex",
      modelId: "gpt-6-astra",
      initialize: vi.fn(async () => undefined),
      readiness: vi.fn(() => ({ ready: true })),
      complete: vi.fn(async (req: JournalModelCompletionRequest) => {
        capturedContext = req.context;
        return makeAssistantMessage([{ type: "text", text: "Please re-upload the image directly." }]);
      }),
      dispose: vi.fn(async () => undefined),
    };

    const completeRun = vi.fn(async () => ({ accepted: true, status: "completed" }));
    const convex: JournalConvexClient = {
      getDiary: vi.fn(),
      importOrders: vi.fn(),
      upsertTrade: vi.fn(),
      saveReview: vi.fn(),
      upsertLesson: vi.fn(),
      uploadChart: vi.fn(),
      reportProgress: vi.fn(async () => ({ accepted: true, status: "running" })),
      completeRun,
    };

    const runner = createJournalAgentRunner({
      model,
      convex,
      chartProvider: { id: "chart_img", isConfigured: () => false, captureChart: vi.fn() },
      convexSiteUrl: "https://convex.example.com/http",
      attachmentFetch,
      logger: silentLogger,
    });

    await runner.run(
      makeRunRequest({
        userMessage: {
          stableId: "msg-ssrf",
          ordinal: 4,
          role: "user",
          text: "Check this screenshot.",
          attachments: [
            {
              storageId: "storage-evil",
              imageKey: "c".repeat(64),
              mimeType: "image/png",
              filename: "ssrf.png",
              url: "http://169.254.169.254/latest/meta-data/",
            },
          ],
          status: "completed",
          createdAt: 1_700_000_004_000,
          updatedAt: 1_700_000_004_000,
        },
      }),
    );

    expect(attachmentFetch).not.toHaveBeenCalled();
    const firstMsg = capturedContext?.messages[0];
    expect(firstMsg?.role).toBe("user");
    if (firstMsg?.role === "user") {
      expect(Array.isArray(firstMsg.content)).toBe(false);
    }
    expect(completeRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("parses the exact Convex getDiaryForOwner payload without chartUrls", async () => {
    const convexDiaryPayload = {
      settings: {
        brokerTimeZone: "America/Puerto_Rico",
        tradingViewLayoutId: "layout_abc",
        updatedAt: 1_700_000_000_000,
      },
      trades: [],
      lessons: [],
      orderDays: [],
      charts: [
        {
          imageKey: "d".repeat(64),
          storageId: "storage-99",
          mimeType: "image/png",
          width: 1_200,
          height: 750,
          symbol: "NASDAQ:QQQ",
          interval: "5m",
          source: "chart_img",
          url: "https://convex.example.com/api/storage/storage-99",
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        },
      ],
    };

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(convexDiaryPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const client = new ConvexJournalClient({
      siteUrl: "https://convex.example.com/http",
      sharedSecret: "a-secure-service-secret-with-32-chars",
      timeoutMs: 5_000,
      logger: silentLogger,
      fetch: fetchMock,
    });

    const diary = await client.getDiary({
      ownerId: "user_trader_1",
      runId: "jrun-diary-1",
      runToken: "run-cap-token-1",
    });

    expect(diary).toEqual(convexDiaryPayload);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("https://convex.example.com/http/internal/journal/tools/get-diary");
    expect(call?.[1]?.redirect).toBe("error");
    expect(call?.[1]?.headers).toMatchObject({
      authorization: "Bearer a-secure-service-secret-with-32-chars",
      "x-journal-run-token": "run-cap-token-1",
    });
  });

  it("derives identical deterministic stableIds when retrying import_orders, upsert_trade, and upsert_lesson without stableId", async () => {
    const seenImportOrderIds: string[] = [];
    const seenImportTradeIds: string[] = [];
    const seenUpsertTradeIds: string[] = [];
    const seenUpsertLessonIds: string[] = [];

    const sampleTrade = {
      symbol: "QQQ",
      instrument: "Options" as const,
      account: "Live" as const,
      direction: "Long" as const,
      status: "Closed" as const,
      openedOn: "2026-04-15",
      closedOn: "2026-04-15",
      setup: "VWAP reclaim",
      size: "2x 500C",
      details: "Test details",
      plannedRiskCents: 10_000,
      realizedPnlCents: 15_000,
      thesis: "Thesis",
      plan: "Plan",
      review: "Review",
      adherence: "Followed" as const,
      mistakes: [],
    };
    const sampleOrder = {
      contract: "QQQ 04/15 500C",
      submittedAt: "10:15:00",
      status: "Filled" as const,
      side: "Buy" as const,
      type: "Limit" as const,
      quantity: 2,
      averageFillCents: 150,
      realizedPnlCents: null,
      cashCents: -30_000,
      limitCents: 150,
    };
    const sampleLesson = {
      title: "Respect VWAP",
      body: "Wait for confirmation above VWAP before sizing in.",
      tradeStableId: null,
    };

    const convex: JournalConvexClient = {
      getDiary: vi.fn<JournalConvexClient["getDiary"]>(),
      importOrders: vi.fn<JournalConvexClient["importOrders"]>(async (_creds, input) => {
        for (const day of input.orderDays) seenImportOrderIds.push(day.stableId ?? "");
        for (const entry of input.trades) seenImportTradeIds.push(entry.stableId ?? "");
        return {
          orderDays: input.orderDays.map((day) => ({
            stableId: day.stableId ?? "missing",
            date: day.date,
            note: day.note,
            orders: day.orders,
            createdAt: 1,
            updatedAt: 1,
          })),
          trades: input.trades.map((entry) => ({
            stableId: entry.stableId ?? "missing",
            ...entry.trade,
            assistantReview: null,
            createdAt: 1,
            updatedAt: 1,
          })),
        };
      }),
      upsertTrade: vi.fn<JournalConvexClient["upsertTrade"]>(async (_creds, input) => {
        seenUpsertTradeIds.push(input.stableId ?? "");
        return {
          stableId: input.stableId ?? "missing",
          ...input.trade,
          assistantReview: null,
          createdAt: 1,
          updatedAt: 1,
        };
      }),
      saveReview: vi.fn<JournalConvexClient["saveReview"]>(),
      upsertLesson: vi.fn<JournalConvexClient["upsertLesson"]>(async (_creds, input) => {
        seenUpsertLessonIds.push(input.stableId ?? "");
        return {
          stableId: input.stableId ?? "missing",
          ...input.lesson,
          createdAt: 1,
          updatedAt: 1,
        };
      }),
      uploadChart: vi.fn<JournalConvexClient["uploadChart"]>(),
      reportProgress: vi.fn<JournalConvexClient["reportProgress"]>(),
      completeRun: vi.fn<JournalConvexClient["completeRun"]>(),
    };

    const runContext = (runId: string) => ({
      credentials: { ownerId: "user_1", runId, runToken: "tok" },
      settings: { brokerTimeZone: "America/Puerto_Rico", updatedAt: 1 },
      convex,
      chartProvider: { id: "chart_img", isConfigured: () => false, captureChart: vi.fn() },
      signal: new AbortController().signal,
    });

    const importCall = makeToolCall("tc-imp", "import_orders", {
      orderDays: [{ date: "2026-04-15", note: "Morning session", orders: [sampleOrder] }],
      trades: [{ trade: sampleTrade }],
    });
    const tradeCall = makeToolCall("tc-tr", "upsert_trade", { trade: sampleTrade });
    const lessonCall = makeToolCall("tc-ls", "upsert_lesson", { lesson: sampleLesson });

    // Execute twice in run A and once in run B
    await executeJournalTool(importCall, runContext("run-A"));
    await executeJournalTool(importCall, runContext("run-A"));
    await executeJournalTool(importCall, runContext("run-B"));

    await executeJournalTool(tradeCall, runContext("run-A"));
    await executeJournalTool(tradeCall, runContext("run-A"));
    await executeJournalTool(tradeCall, runContext("run-B"));

    await executeJournalTool(lessonCall, runContext("run-A"));
    await executeJournalTool(lessonCall, runContext("run-A"));
    await executeJournalTool(lessonCall, runContext("run-B"));

    expect(seenImportOrderIds[0]).toMatch(/^order-day-[0-9a-f]{32}$/);
    expect(seenImportOrderIds[0]).toBe(seenImportOrderIds[1]);
    expect(seenImportOrderIds[0]).not.toBe(seenImportOrderIds[2]);

    expect(seenImportTradeIds[0]).toMatch(/^trade-[0-9a-f]{32}$/);
    expect(seenImportTradeIds[0]).toBe(seenImportTradeIds[1]);
    expect(seenImportTradeIds[0]).not.toBe(seenImportTradeIds[2]);

    expect(seenUpsertTradeIds[0]).toMatch(/^trade-[0-9a-f]{32}$/);
    expect(seenUpsertTradeIds[0]).toBe(seenUpsertTradeIds[1]);
    expect(seenUpsertTradeIds[0]).not.toBe(seenUpsertTradeIds[2]);

    expect(seenUpsertLessonIds[0]).toMatch(/^lesson-[0-9a-f]{32}$/);
    expect(seenUpsertLessonIds[0]).toBe(seenUpsertLessonIds[1]);
    expect(seenUpsertLessonIds[0]).not.toBe(seenUpsertLessonIds[2]);
  });

  it("retries transient completeRun errors with backoff and does not retry 4xx/409 responses", async () => {
    const backoffDelays: number[] = [];
    const completeRun = vi.fn<JournalConvexClient["completeRun"]>()
      .mockRejectedValueOnce(new JournalConvexError("gateway timeout", 504))
      .mockRejectedValueOnce(new JournalConvexError("network reset"))
      .mockResolvedValueOnce({ accepted: true, status: "completed" });

    const model: JournalModelAdapter = {
      provider: "openai-codex",
      modelId: "gpt-6-astra",
      initialize: vi.fn(async () => undefined),
      readiness: vi.fn(() => ({ ready: true })),
      complete: vi.fn(async () => makeAssistantMessage([{ type: "text", text: "All done." }])),
      dispose: vi.fn(async () => undefined),
    };

    const convex: JournalConvexClient = {
      getDiary: vi.fn(),
      importOrders: vi.fn(),
      upsertTrade: vi.fn(),
      saveReview: vi.fn(),
      upsertLesson: vi.fn(),
      uploadChart: vi.fn(),
      reportProgress: vi.fn(async () => ({ accepted: true, status: "running" })),
      completeRun,
    };

    const runner = createJournalAgentRunner({
      model,
      convex,
      chartProvider: { id: "chart_img", isConfigured: () => false, captureChart: vi.fn() },
      convexSiteUrl: "https://convex.example.com/http",
      sleep: async (ms) => {
        backoffDelays.push(ms);
      },
      logger: silentLogger,
    });

    await runner.run(
      makeRunRequest({
        userMessage: {
          stableId: "msg-retry",
          ordinal: 5,
          role: "user",
          text: "Summarize.",
          attachments: [],
          status: "completed",
          createdAt: 1_700_000_005_000,
          updatedAt: 1_700_000_005_000,
        },
      }),
    );

    expect(completeRun).toHaveBeenCalledTimes(3);
    expect(backoffDelays).toEqual([250, 750]);

    // 400 client error must NOT be retried
    const clientErrorDelays: number[] = [];
    const clientErrorComplete = vi.fn<JournalConvexClient["completeRun"]>()
      .mockRejectedValueOnce(new JournalConvexError("bad payload", 400));

    const runner2 = createJournalAgentRunner({
      model,
      convex: { ...convex, completeRun: clientErrorComplete },
      chartProvider: { id: "chart_img", isConfigured: () => false, captureChart: vi.fn() },
      convexSiteUrl: "https://convex.example.com/http",
      sleep: async (ms) => {
        clientErrorDelays.push(ms);
      },
      logger: silentLogger,
    });

    await runner2.run(
      makeRunRequest({
        userMessage: {
          stableId: "msg-no-retry",
          ordinal: 6,
          role: "user",
          text: "Summarize.",
          attachments: [],
          status: "completed",
          createdAt: 1_700_000_006_000,
          updatedAt: 1_700_000_006_000,
        },
      }),
    );

    expect(clientErrorComplete).toHaveBeenCalledTimes(1);
    expect(clientErrorDelays).toEqual([]);
  });

  it("supports split-origin CONVEX_CLOUD_ORIGIN attachments and blocks non-/api/storage/ paths", async () => {
    const pngBytes = makePngBytes(800, 600);
    const attachmentFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Blob([new Uint8Array(pngBytes)], { type: "image/png" }), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
    let capturedContext: Context | undefined;

    const model: JournalModelAdapter = {
      provider: "openai-codex",
      modelId: "gpt-6-astra",
      initialize: vi.fn(async () => undefined),
      readiness: vi.fn(() => ({ ready: true })),
      complete: vi.fn(async (req: JournalModelCompletionRequest) => {
        capturedContext = req.context;
        return makeAssistantMessage([{ type: "text", text: "Inspected." }]);
      }),
      dispose: vi.fn(async () => undefined),
    };

    const convex: JournalConvexClient = {
      getDiary: vi.fn(),
      importOrders: vi.fn(),
      upsertTrade: vi.fn(),
      saveReview: vi.fn(),
      upsertLesson: vi.fn(),
      uploadChart: vi.fn(),
      reportProgress: vi.fn(async () => ({ accepted: true, status: "running" })),
      completeRun: vi.fn(async () => ({ accepted: true, status: "completed" })),
    };

    const runner = createJournalAgentRunner({
      model,
      convex,
      chartProvider: { id: "chart_img", isConfigured: () => false, captureChart: vi.fn() },
      convexSiteUrl: "https://site.convex.example.com/http",
      convexCloudOrigin: "https://cloud.convex.example.com",
      attachmentFetch,
      logger: silentLogger,
    });

    await runner.run(
      makeRunRequest({
        userMessage: {
          stableId: "msg-split-origin",
          ordinal: 7,
          role: "user",
          text: "Review these attachments.",
          attachments: [
            {
              storageId: "storage-cloud-1",
              imageKey: "e".repeat(64),
              mimeType: "image/png",
              filename: "allowed-cloud.png",
              url: "https://cloud.convex.example.com/api/storage/storage-cloud-1",
            },
            {
              storageId: "storage-bad-path",
              imageKey: "f".repeat(64),
              mimeType: "image/png",
              filename: "blocked-path.png",
              url: "https://site.convex.example.com/http/internal/journal/tools/get-diary",
            },
          ],
          status: "completed",
          createdAt: 1_700_000_007_000,
          updatedAt: 1_700_000_007_000,
        },
      }),
    );

    // Only the /api/storage/ URL on CONVEX_CLOUD_ORIGIN was fetched; the /http/ path was blocked
    expect(attachmentFetch).toHaveBeenCalledTimes(1);
    expect(attachmentFetch.mock.calls[0]?.[0]).toBe(
      "https://cloud.convex.example.com/api/storage/storage-cloud-1",
    );
    const userMsg = capturedContext?.messages[0];
    expect(userMsg?.role).toBe("user");
    if (userMsg?.role === "user" && Array.isArray(userMsg.content)) {
      const imageParts = userMsg.content.filter((part) => part.type === "image");
      expect(imageParts).toHaveLength(1);
    }
  });
});
