import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../../app/App";
import type {
  JournalChatMessageReadModel,
  JournalDiaryReadModel,
  JournalUploadedChartReadModel,
} from "../../convex/types";
import { lessonsPage, tradeReviewsPage } from "../navigation/routes";
import { ChartReview } from "./ChartReview";
import { readChartReview } from "./chartReviewParser";
import { clearAllChatHistory } from "./chatHistory";
import { dollarsToCents, localIsoDate } from "./formatting";
import {
  JournalWorkspaceView,
  type JournalWorkspaceHandlers,
} from "./JournalPage";
import type { ChartUrlsQueryHook } from "./TradeReviewSheet";

afterEach(() => {
  cleanup();
});

const SAMPLE_IMAGE_KEY = "a".repeat(64);
const SAMPLE_CHART_URL = "https://convex.example.com/storage/chart-qqq.png";

const STRUCTURED_REVIEW = JSON.stringify({
  version: 1,
  instrument: "NASDAQ:QQQ",
  timeZone: "AST",
  timing: "09:42 - 10:15 AST",
  summary:
    "Entered on the VWAP reclaim and scaled into the opening range high.",
  charts: [
    {
      image: SAMPLE_IMAGE_KEY,
      width: 1200,
      height: 800,
      crop: { x: 100, y: 80, width: 800, height: 500 },
      focus: { x: 300, y: 200, width: 160, height: 120 },
      focusLabel: "VWAP reclaim trigger",
      levels: [
        { y: 240, label: "515.40" },
        { y: 360, label: "513.10" },
      ],
      ticks: [
        { x: 250, label: "09:35" },
        { x: 500, label: "10:00" },
      ],
      interval: "5m",
      heading: "Opening sweep and reclaim",
      text: "Price swept the premarket low and closed back above VWAP on expanding volume.",
      alt: "QQQ 5-minute chart showing VWAP reclaim around 515.40.",
    },
  ],
  nextTime: "Hold a small runner when breadth stays positive above VWAP.",
  note: "Based on broker fills aligned to America/Puerto_Rico.",
});

function createDiary(
  overrides: Partial<JournalDiaryReadModel> = {},
): JournalDiaryReadModel {
  const now = 1_770_000_000_000;
  return {
    settings: {
      brokerTimeZone: "America/Puerto_Rico",
      tradingViewLayoutId: "layout-1",
      updatedAt: now,
    },
    trades: [
      {
        stableId: "trade-qqq",
        symbol: "QQQ",
        instrument: "Options",
        account: "Live",
        direction: "Long",
        status: "Closed",
        openedOn: "2026-11-18",
        closedOn: "2026-11-18",
        setup: "VWAP reclaim",
        size: "2 contracts",
        details: "Bought 2x QQQ 515C at $2.00, sold at $3.00.",
        plannedRiskCents: 10_000,
        realizedPnlCents: 20_000,
        thesis: "Tech leadership reclaimed opening range.",
        plan: "Stop under VWAP.",
        review: "Executed cleanly.",
        adherence: "Followed",
        mistakes: [],
        assistantReview: STRUCTURED_REVIEW,
        createdAt: now,
        updatedAt: now,
      },
      {
        stableId: "trade-spy",
        symbol: "SPY",
        instrument: "Options",
        account: "Live",
        direction: "Short",
        status: "Closed",
        openedOn: "2026-11-18",
        closedOn: "2026-11-18",
        setup: "Failed breakout",
        size: "1 contract",
        details: "Stopped quickly on reclaim.",
        plannedRiskCents: 8_000,
        realizedPnlCents: -7_500,
        thesis: "Faded weak opening drive.",
        plan: "Stop above high of day.",
        review: "Entered slightly early.",
        adherence: "Partly followed",
        mistakes: ["Entry timing"],
        assistantReview:
          "Entered before confirmation.\n\nWait for a lower high.",
        createdAt: now,
        updatedAt: now,
      },
      {
        stableId: "trade-nvda",
        symbol: "NVDA",
        instrument: "Shares",
        account: "Paper",
        direction: "Long",
        status: "Open",
        openedOn: "2026-11-16",
        closedOn: null,
        setup: "Base breakout",
        size: "100 shares",
        details: "Long from 142.50.",
        plannedRiskCents: 25_000,
        realizedPnlCents: null,
        thesis: "Earnings momentum.",
        plan: "Trail below 10 EMA.",
        review: "",
        adherence: "Unreviewed",
        mistakes: [],
        assistantReview: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    lessons: [
      {
        stableId: "lesson-vwap",
        title: "Wait for VWAP reclaim close",
        body: "Always wait for the 5-minute candle close above VWAP before adding size.",
        tradeStableId: "trade-qqq",
        createdAt: now,
        updatedAt: now,
      },
      {
        stableId: "lesson-size",
        title: "Keep opening risk fixed",
        body: "Never double size after a red first trade.",
        tradeStableId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    orderDays: [
      {
        stableId: "orders-2026-11-18",
        date: "2026-11-18",
        note: "Imported from brokerage fills screenshot.",
        orders: [
          {
            contract: "QQQ 11/18 515C",
            submittedAt: "09:42:10",
            status: "Filled",
            side: "Buy",
            type: "Limit",
            quantity: 2,
            averageFillCents: 200,
            realizedPnlCents: null,
            cashCents: -40_000,
            limitCents: 200,
          },
          {
            contract: "QQQ 11/18 515C",
            submittedAt: "10:15:04",
            status: "Filled",
            side: "Sell",
            type: "Limit",
            quantity: 2,
            averageFillCents: 300,
            realizedPnlCents: 20_000,
            cashCents: 60_000,
            limitCents: 300,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ],
    ...overrides,
  };
}

function createHandlers(
  overrides: Partial<JournalWorkspaceHandlers> = {},
): JournalWorkspaceHandlers {
  return {
    onSaveSettings: vi.fn().mockResolvedValue(undefined),
    onUpsertTrade: vi.fn().mockResolvedValue(undefined),
    onClearTradeReview: vi.fn().mockResolvedValue(undefined),
    onDeleteTrade: vi.fn().mockResolvedValue(undefined),
    onUpsertLesson: vi.fn().mockResolvedValue(undefined),
    onDeleteLesson: vi.fn().mockResolvedValue(undefined),
    onUploadChart: vi.fn().mockResolvedValue({
      imageKey: SAMPLE_IMAGE_KEY,
      storageId: "storage-1",
      mimeType: "image/png",
      width: 1200,
      height: 800,
      url: SAMPLE_CHART_URL,
    }),
    onSendChatMessage: vi.fn().mockResolvedValue(undefined),
    onCancelActiveRun: vi.fn().mockResolvedValue(undefined),
    onClearChatHistory: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("Trading Journal workspace", () => {
  it("groups trades by date newest-first, totals daily realized P&L, and expands source orders", () => {
    const handlers = createHandlers();
    render(
      <JournalWorkspaceView
        section={tradeReviewsPage}
        diary={createDiary()}
        chatMessages={[]}
        initialChatOpen={false}
        handlers={handlers}
      />,
    );

    const ledgerSections = screen.getAllByRole("region", {
      name: /^Nov \d+, 2026$/,
    });
    expect(ledgerSections).toHaveLength(2);
    expect(within(ledgerSections[0]).getByText("Nov 18, 2026")).toBeVisible();
    expect(within(ledgerSections[0]).getByText("+$125.00")).toBeVisible();
    expect(within(ledgerSections[0]).getByText("QQQ")).toBeVisible();
    expect(within(ledgerSections[0]).getByText("SPY")).toBeVisible();

    expect(within(ledgerSections[1]).getByText("Nov 16, 2026")).toBeVisible();
    expect(within(ledgerSections[1]).getByText("NVDA")).toBeVisible();

    // Expand source orders disclosure
    const summary = screen.getByText("Source orders");
    fireEvent.click(summary);
    const ordersRegion = screen.getByRole("region", {
      name: "Source orders for Nov 18, 2026",
    });
    expect(within(ordersRegion).getAllByText("QQQ 11/18 515C")).toHaveLength(2);
    expect(within(ordersRegion).getByText("09:42:10")).toBeVisible();
    expect(within(ordersRegion).getByText("+$600.00")).toBeVisible();
  });

  it("opens review sheet for closed trades, clears review, and edits/deletes open trades", async () => {
    const handlers = createHandlers();
    render(
      <JournalWorkspaceView
        section={tradeReviewsPage}
        diary={createDiary()}
        chatMessages={[]}
        initialChatOpen={false}
        handlers={handlers}
      />,
    );

    // Closed trade -> Review sheet
    fireEvent.click(screen.getByRole("button", { name: "Review QQQ" }));
    const reviewDialog = screen.getByRole("dialog", { name: "Review QQQ" });
    expect(
      within(reviewDialog).getByText(
        /Entered on the VWAP reclaim and scaled into the opening range high/,
      ),
    ).toBeVisible();

    // Clear review flow
    fireEvent.click(
      within(reviewDialog).getByRole("button", { name: "Clear review" }),
    );
    fireEvent.click(
      within(reviewDialog).getByRole("button", { name: "Confirm clear" }),
    );
    await waitFor(() => {
      expect(handlers.onClearTradeReview).toHaveBeenCalledWith("trade-qqq");
    });

    // Close review sheet via Close button
    fireEvent.click(
      within(reviewDialog).getByRole("button", { name: "Close" }),
    );
    expect(screen.queryByRole("dialog", { name: "Review QQQ" })).toBeNull();

    // Open trade -> Edit sheet
    fireEvent.click(screen.getByRole("button", { name: "Edit NVDA" }));
    const editDialog = screen.getByRole("dialog", { name: "Edit NVDA" });
    const sizeInput = within(editDialog).getByLabelText("Size");
    fireEvent.change(sizeInput, { target: { value: "150 shares" } });
    fireEvent.click(
      within(editDialog).getByRole("button", { name: "Save trade" }),
    );

    await waitFor(() => {
      expect(handlers.onUpsertTrade).toHaveBeenCalledWith(
        expect.objectContaining({
          stableId: "trade-nvda",
          trade: expect.objectContaining({
            symbol: "NVDA",
            size: "150 shares",
            plannedRiskCents: 25_000,
          }),
        }),
      );
    });
  });

  it("saves journal settings from the header settings popover", async () => {
    const handlers = createHandlers();
    render(
      <JournalWorkspaceView
        section={tradeReviewsPage}
        diary={createDiary()}
        chatMessages={[]}
        initialChatOpen={false}
        handlers={handlers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const tzInput = screen.getByLabelText("Broker time zone");
    const layoutInput = screen.getByLabelText(
      "TradingView layout ID (optional)",
    );
    fireEvent.change(tzInput, { target: { value: "America/New_York" } });
    fireEvent.change(layoutInput, { target: { value: "tv-layout-9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(handlers.onSaveSettings).toHaveBeenCalledWith({
        brokerTimeZone: "America/New_York",
        tradingViewLayoutId: "tv-layout-9",
      });
    });
  });

  it("filters lessons by search query and jumps to a linked trade review", () => {
    const handlers = createHandlers();
    render(
      <JournalWorkspaceView
        section={lessonsPage}
        diary={createDiary()}
        chatMessages={[]}
        initialChatOpen={false}
        handlers={handlers}
      />,
    );

    expect(screen.getByRole("heading", { name: "Lessons" })).toBeVisible();
    expect(screen.getByText("2 lessons")).toBeVisible();

    const searchInput = screen.getByRole("searchbox", {
      name: "Search lessons",
    });
    fireEvent.change(searchInput, { target: { value: "QQQ" } });
    expect(screen.getByText("1 lesson")).toBeVisible();
    expect(screen.getByText("Wait for VWAP reclaim close")).toBeVisible();
    expect(screen.queryByText("Keep opening risk fixed")).toBeNull();

    // Jump to linked trade and create a pre-linked lesson
    fireEvent.click(screen.getByRole("button", { name: "QQQ trade" }));
    const reviewDialog = screen.getByRole("dialog", { name: "Review QQQ" });
    expect(reviewDialog).toBeVisible();

    fireEvent.click(
      within(reviewDialog).getByRole("button", { name: "Write lesson" }),
    );
    const lessonDialog = screen.getByRole("dialog", {
      name: "Write a lesson",
    });
    expect(within(lessonDialog).getByLabelText("Linked trade")).toHaveValue(
      "trade-qqq",
    );
    fireEvent.change(within(lessonDialog).getByLabelText("Title"), {
      target: { value: "Respect VWAP reclaim volume" },
    });
    fireEvent.change(within(lessonDialog).getByLabelText("Lesson"), {
      target: { value: "Only size up when breadth confirms." },
    });
    fireEvent.click(
      within(lessonDialog).getByRole("button", { name: "Save lesson" }),
    );
    expect(handlers.onUpsertLesson).toHaveBeenCalledWith({
      lesson: {
        title: "Respect VWAP reclaim volume",
        body: "Only size up when breadth confirms.",
        tradeStableId: "trade-qqq",
      },
    });
  });

  it("renders structured ChartReview v1 annotations and falls back cleanly for prose or missing images", () => {
    expect(readChartReview(STRUCTURED_REVIEW)?.instrument).toBe("NASDAQ:QQQ");
    expect(readChartReview('{"version": 2}')).toBeNull();

    const { container, rerender } = render(
      <ChartReview
        assistantReview={STRUCTURED_REVIEW}
        chartUrls={{ [SAMPLE_IMAGE_KEY]: SAMPLE_CHART_URL }}
      />,
    );

    expect(screen.getByText("TradingView · NASDAQ:QQQ")).toBeVisible();
    expect(screen.getByText("5m")).toBeVisible();
    expect(screen.getByText("Opening sweep and reclaim")).toBeVisible();
    expect(screen.getByText("515.40")).toBeVisible();
    expect(screen.getByText("09:35")).toBeVisible();
    expect(screen.getByText("AST")).toBeVisible();
    expect(screen.getByText("Next time")).toBeVisible();

    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", SAMPLE_CHART_URL);

    const focusRect = container.querySelector("rect.journal-chart-focus");
    expect(focusRect).toHaveAttribute("x", "300");
    expect(focusRect).toHaveAttribute("y", "200");
    expect(focusRect).toHaveAttribute("width", "160");
    expect(focusRect).toHaveAttribute("height", "120");

    const guides = container.querySelectorAll("path.journal-chart-guide");
    expect(guides).toHaveLength(2);

    const fullLink = screen.getByRole("link", {
      name: /Open the full 5m TradingView screenshot/,
    });
    expect(fullLink).toHaveAttribute("href", SAMPLE_CHART_URL);
    expect(fullLink).toHaveAttribute("rel", "noopener noreferrer");

    // Missing URL fallback
    rerender(
      <ChartReview assistantReview={STRUCTURED_REVIEW} chartUrls={{}} />,
    );
    expect(
      screen.getByText("The chart screenshot is unavailable."),
    ).toBeVisible();

    // Plain prose fallback
    rerender(
      <ChartReview
        assistantReview={"First paragraph.\n\nSecond paragraph."}
        chartUrls={{}}
      />,
    );
    expect(screen.getByText("First paragraph.")).toBeVisible();
    expect(screen.getByText("Second paragraph.")).toBeVisible();
  });

  it("uploads screenshot attachments in Journal Chat, renders toolEvents, and cancels active runs", async () => {
    const handlers = createHandlers();
    const completedMessages: JournalChatMessageReadModel[] = [
      {
        stableId: "msg-1",
        ordinal: 1,
        role: "user",
        text: "Import my Robinhood fills",
        attachments: [
          {
            storageId: "storage-1",
            imageKey: SAMPLE_IMAGE_KEY,
            mimeType: "image/png",
            filename: "fills.png",
            url: SAMPLE_CHART_URL,
          },
        ],
        status: "completed",
        createdAt: 1_770_000_000_000,
        updatedAt: 1_770_000_000_000,
      },
      {
        stableId: "msg-2",
        ordinal: 2,
        role: "assistant",
        text: "Imported **2 fills** into your November 18 ledger.",
        attachments: [],
        toolEvents: [
          {
            name: "import_orders",
            status: "completed",
            summary: "Saved 2 orders for 2026-11-18",
          },
        ],
        status: "completed",
        createdAt: 1_770_000_001_000,
        updatedAt: 1_770_000_001_000,
      },
    ];

    const { rerender } = render(
      <JournalWorkspaceView
        section={tradeReviewsPage}
        diary={createDiary()}
        chatMessages={completedMessages}
        initialChatOpen={true}
        handlers={handlers}
      />,
    );

    // Renders live toolEvents and sanitized markdown
    expect(screen.getByText("import_orders")).toBeVisible();
    expect(screen.getByText("Saved 2 orders for 2026-11-18")).toBeVisible();
    expect(screen.getByText("2 fills")).toBeVisible();

    // Attach PNG screenshot and send
    const fileInput = screen.getByLabelText("Attach screenshot files");
    const pngFile = new File(["fake-png-bytes"], "broker-fills.png", {
      type: "image/png",
    });
    fireEvent.change(fileInput, { target: { files: [pngFile] } });

    expect(screen.getByText("broker-fills.png")).toBeVisible();

    const chatInput = screen.getByLabelText("Message Journal Chat");
    fireEvent.change(chatInput, {
      target: { value: "Log these executions please" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Send journal message" }),
    );

    await waitFor(() => {
      expect(handlers.onUploadChart).toHaveBeenCalledWith({
        base64Data: expect.any(String),
        filename: "broker-fills.png",
      });
      expect(handlers.onSendChatMessage).toHaveBeenCalledWith({
        text: "Log these executions please",
        attachments: [
          {
            imageKey: SAMPLE_IMAGE_KEY,
            filename: "broker-fills.png",
          },
        ],
      });
    });

    // Active run displays Stop button and calls cancelActiveRun
    const activeMessages: JournalChatMessageReadModel[] = [
      ...completedMessages,
      {
        stableId: "msg-3",
        ordinal: 3,
        role: "assistant",
        text: "",
        attachments: [],
        toolEvents: [
          {
            name: "fetch_chart_snapshot",
            status: "running",
            summary: "Capturing 5m QQQ chart",
          },
        ],
        runStableId: "run-active",
        status: "running",
        createdAt: 1_770_000_002_000,
        updatedAt: 1_770_000_002_000,
      },
    ];

    rerender(
      <JournalWorkspaceView
        section={tradeReviewsPage}
        diary={createDiary()}
        chatMessages={activeMessages}
        initialChatOpen={true}
        handlers={handlers}
      />,
    );

    expect(screen.getByText("fetch_chart_snapshot")).toBeVisible();
    const stopButton = screen.getByRole("button", { name: "Stop" });
    fireEvent.click(stopButton);
    await waitFor(() => {
      expect(handlers.onCancelActiveRun).toHaveBeenCalledTimes(1);
    });
  });

  it.each(["/", "/journal"])(
    "opens Trade Reviews from %s and shows history only in Chat",
    (entry) => {
      render(
        <MemoryRouter initialEntries={[entry]}>
          <AppShell
            subtitle="Trading journal & research"
            userLabel="Alex Trader"
            onSignOut={vi.fn()}
            renderThreadSidebar={() => (
              <aside aria-label="Nested thread sidebar">Thread History</aside>
            )}
            renderJournalPage={(section) => <h1>{section.title}</h1>}
            askElement={<div>Chat View</div>}
            threadElement={<div>Thread View</div>}
            discordElement={<div>Discord View</div>}
          />
        </MemoryRouter>,
      );

      expect(
        screen.getByRole("heading", { name: "Trade Reviews" }),
      ).toBeVisible();
      expect(
        screen.getAllByRole("link", { name: "Trade Reviews" })[0],
      ).toHaveAttribute("aria-current", "page");
      fireEvent.click(screen.getAllByRole("link", { name: "Lessons" })[0]);
      expect(screen.getByRole("heading", { name: "Lessons" })).toBeVisible();
      expect(
        screen.queryByRole("complementary", { name: "Nested thread sidebar" }),
      ).toBeNull();

      // Clicking Chat opens Chat View + nested ThreadSidebar
      fireEvent.click(screen.getAllByRole("link", { name: "Chat" })[0]);
      expect(screen.getByText("Chat View")).toBeVisible();
      expect(
        screen.getByRole("complementary", { name: "Nested thread sidebar" }),
      ).toBeVisible();

      // Clicking Discord hides ThreadSidebar
      fireEvent.click(screen.getAllByRole("link", { name: "Discord" })[0]);
      expect(screen.getByText("Discord View")).toBeVisible();
      expect(
        screen.queryByRole("complementary", { name: "Nested thread sidebar" }),
      ).toBeNull();
    },
  );

  it("queries getChartUrls only for the open review's imageKeys and skips prose reviews", () => {
    const handlers = createHandlers();
    const chartQuerySpy = vi.fn<ChartUrlsQueryHook>((args) => {
      if (args === "skip") return undefined;
      return { [SAMPLE_IMAGE_KEY]: SAMPLE_CHART_URL };
    });

    render(
      <JournalWorkspaceView
        section={tradeReviewsPage}
        diary={createDiary()}
        chatMessages={[]}
        initialChatOpen={false}
        useChartUrls={chartQuerySpy}
        handlers={handlers}
      />,
    );

    // No review open yet -> query hook not called
    expect(chartQuerySpy).not.toHaveBeenCalled();

    // Open QQQ review (has structured chart review referencing SAMPLE_IMAGE_KEY)
    fireEvent.click(screen.getByRole("button", { name: "Review QQQ" }));
    expect(chartQuerySpy).toHaveBeenLastCalledWith({
      imageKeys: [SAMPLE_IMAGE_KEY],
    });
    const reviewDialog = screen.getByRole("dialog", { name: "Review QQQ" });
    expect(reviewDialog.querySelector("img")).toHaveAttribute(
      "src",
      SAMPLE_CHART_URL,
    );

    // Close QQQ and open SPY review (plain prose, no charts -> "skip")
    fireEvent.click(
      within(reviewDialog).getByRole("button", { name: "Close" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Review SPY" }));
    expect(chartQuerySpy).toHaveBeenLastCalledWith("skip");
  });

  it("prevents concurrent double-sends and caches uploadedImageKey across retries", async () => {
    const key1 = "1".repeat(64);
    const key2 = "2".repeat(64);
    let secondUploadAttempts = 0;

    const firstUploadResolvers: Array<
      (value: JournalUploadedChartReadModel) => void
    > = [];

    const onUploadChart = vi.fn(({ filename }: { filename: string }) => {
      if (filename === "first.png") {
        return new Promise<JournalUploadedChartReadModel>((resolve) => {
          firstUploadResolvers.push(resolve);
        });
      }
      secondUploadAttempts += 1;
      if (secondUploadAttempts === 1) {
        return Promise.reject(new Error("Temporary upload error"));
      }
      return Promise.resolve({
        imageKey: key2,
        storageId: "storage-2",
        mimeType: "image/png" as const,
        width: 1200,
        height: 800,
        url: "https://convex.example.com/storage/second.png",
      });
    });

    const handlers = createHandlers({ onUploadChart });

    render(
      <JournalWorkspaceView
        section={tradeReviewsPage}
        diary={createDiary()}
        chatMessages={[]}
        initialChatOpen={true}
        handlers={handlers}
      />,
    );

    const fileInput = screen.getByLabelText("Attach screenshot files");
    const file1 = new File(["img-1"], "first.png", { type: "image/png" });
    const file2 = new File(["img-2"], "second.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file1, file2] } });

    const chatInput = screen.getByLabelText("Message Journal Chat");
    fireEvent.change(chatInput, { target: { value: "Two screenshots" } });

    const sendButton = screen.getByRole("button", {
      name: "Send journal message",
    });

    // Trigger rapid double-submit synchronously before first await resolves
    const form = sendButton.closest("form");
    expect(form).not.toBeNull();
    fireEvent.click(sendButton);
    if (form) fireEvent.submit(form);

    await waitFor(() => {
      expect(firstUploadResolvers).toHaveLength(1);
    });

    // Only one upload for first.png should have started despite double-submit
    expect(onUploadChart).toHaveBeenCalledTimes(1);

    // Resolve first upload; second upload fails on attempt 1
    firstUploadResolvers[0]?.({
      imageKey: key1,
      storageId: "storage-1",
      mimeType: "image/png",
      width: 1200,
      height: 800,
      url: "https://convex.example.com/storage/first.png",
    });

    expect(await screen.findByText("Temporary upload error")).toBeVisible();
    expect(handlers.onSendChatMessage).not.toHaveBeenCalled();

    // Retry Send -> first.png must reuse cached uploadedImageKey without re-uploading
    fireEvent.click(
      screen.getByRole("button", { name: "Send journal message" }),
    );

    await waitFor(() => {
      expect(handlers.onSendChatMessage).toHaveBeenCalledWith({
        text: "Two screenshots",
        attachments: [
          { imageKey: key1, filename: "first.png" },
          { imageKey: key2, filename: "second.png" },
        ],
      });
    });

    const firstFileCalls = onUploadChart.mock.calls.filter(
      ([arg]) => arg.filename === "first.png",
    );
    expect(firstFileCalls).toHaveLength(1);
    expect(secondUploadAttempts).toBe(2);
  });

  it("clears chat history past 10 batches until hasMore is false and surfaces errors", async () => {
    let callCount = 0;
    const clearBatch = vi.fn(async () => {
      callCount += 1;
      return {
        deletedMessages: 100,
        deletedRuns: 50,
        hasMore: callCount < 12,
      };
    });

    await clearAllChatHistory(clearBatch);
    expect(clearBatch).toHaveBeenCalledTimes(12);

    // Zero-progress guard prevents infinite loop
    const stuckBatch = vi.fn().mockResolvedValue({
      deletedMessages: 0,
      deletedRuns: 0,
      hasMore: true,
    });
    await expect(clearAllChatHistory(stuckBatch)).rejects.toThrow(
      /could not be fully cleared/i,
    );

    // Mid-loop batch failure surfaces inline error in JournalChatPane
    const handlers = createHandlers({
      onClearChatHistory: vi
        .fn()
        .mockRejectedValue(new Error("Clear batch failed on page 2")),
    });
    render(
      <JournalWorkspaceView
        section={tradeReviewsPage}
        diary={createDiary()}
        chatMessages={[
          {
            stableId: "msg-clear-1",
            ordinal: 1,
            role: "user",
            text: "Hello",
            attachments: [],
            status: "completed",
            createdAt: 1_770_000_000_000,
            updatedAt: 1_770_000_000_000,
          },
        ]}
        initialChatOpen={true}
        handlers={handlers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm clear" }));
    expect(
      await screen.findByText("Clear batch failed on page 2"),
    ).toBeVisible();
  });

  it("parses formatted dollar amounts without float drift and defaults dates in broker timezone", async () => {
    expect(dollarsToCents("$1,234.56")).toBe(123_456);
    expect(dollarsToCents("-$140.50")).toBe(-14_050);
    expect(dollarsToCents("$-140.50")).toBe(-14_050);
    expect(dollarsToCents("19.99")).toBe(1_999);
    expect(dollarsToCents("+$0.5")).toBe(50);
    expect(() => dollarsToCents("$1,234.567")).toThrow(/two decimal places/i);
    expect(() => dollarsToCents("$1,23.45")).toThrow(/valid dollar amount/i);

    const midnightUtc = new Date("2026-11-19T02:30:00Z");
    expect(localIsoDate("America/Puerto_Rico", midnightUtc)).toBe("2026-11-18");
    expect(localIsoDate("UTC", midnightUtc)).toBe("2026-11-19");

    // End-to-end formatted money entry in TradeEditorSheet
    const handlers = createHandlers();
    render(
      <JournalWorkspaceView
        section={tradeReviewsPage}
        diary={createDiary()}
        chatMessages={[]}
        initialChatOpen={false}
        handlers={handlers}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Log trade" }));
    const dialog = screen.getByRole("dialog", { name: "Log trade" });
    fireEvent.change(within(dialog).getByLabelText("Symbol"), {
      target: { value: "MSFT" },
    });
    fireEvent.change(within(dialog).getByLabelText("Status"), {
      target: { value: "Closed" },
    });
    fireEvent.change(within(dialog).getByLabelText("Realized P&L (USD)"), {
      target: { value: "-$140.50" },
    });
    fireEvent.change(within(dialog).getByLabelText("Planned risk (USD)"), {
      target: { value: "$1,234.56" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save trade" }));

    await waitFor(() => {
      expect(handlers.onUpsertTrade).toHaveBeenCalledWith({
        trade: expect.objectContaining({
          symbol: "MSFT",
          status: "Closed",
          realizedPnlCents: -14_050,
          plannedRiskCents: 123_456,
        }),
      });
    });
  });
});
