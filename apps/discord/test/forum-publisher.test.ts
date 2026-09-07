/* oxlint-disable anti-slop/no-conditional-empty-object-spread, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-unknown-parameters -- Discord SDK fixtures require partial structural doubles and exact optional test fields. */
import { createHash } from "node:crypto";
import { ChannelType, Client, Collection } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type { MarketChartRenderer } from "../src/media/chart-img.js";
import type { MarketResearchPublicationClient } from "../src/market-research/convex-client.js";
import type {
  ClaimedPublication,
  PublicationAcknowledgement,
  PublicationClaim,
} from "../src/market-research/contracts.js";
import {
  classifyPublicationError,
  ForumPublisher,
} from "../src/market-research/forum-publisher.js";
import type { PublicationEvent, PublicationLogSink } from "../src/market-research/publication-telemetry.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function claim(overrides: Partial<ClaimedPublication> = {}): ClaimedPublication {
  const content = "Morning view\nEdition ID: MR-edition_1";
  return {
    claimed: true,
    editionId: "edition_1",
    guildId: "100",
    forumChannelId: "200",
    forumTagIds: ["300"],
    forumTitle: "Morning Market Newspaper - 2026-09-01 - MIXED",
    publicationGeneration: 1,
    publicationToken: "publication_token_1",
    delivery: {
      deliveryId: "edition_1:starter",
      sequence: 0,
      kind: "starter",
      content,
      contentHash: sha256(content),
      nonce: "starter_nonce_1",
      chartAttachmentIds: [],
      chartRequests: [],
      deliveryToken: "delivery_token_1",
      attempts: 1,
    },
    ...overrides,
  };
}

function replyClaim(): ClaimedPublication {
  const content = "Part 1/1 - Sources\nPrivate edition body";
  return claim({
    threadId: "700",
    starterMessageId: "701",
    delivery: {
      ...claim().delivery,
      kind: "reply",
      sequence: 1,
      content,
      contentHash: sha256(content),
    },
  });
}

class FakeConvex implements MarketResearchPublicationClient {
  acknowledgements: PublicationAcknowledgement[] = [];
  adoptions: Array<{ threadId: string; starterMessageId: string; duplicateIncident?: boolean }> = [];

  constructor(readonly queued: PublicationClaim = { claimed: false }) {}

  async claimPublication(): Promise<PublicationClaim> {
    return this.queued;
  }

  async heartbeatPublication(): Promise<boolean> {
    return true;
  }

  async acknowledgePublication(
    _claim: ClaimedPublication,
    result: PublicationAcknowledgement,
  ): Promise<boolean> {
    this.acknowledgements.push(result);
    return true;
  }

  async adoptReconciledStarter(
    _claim: ClaimedPublication,
    threadId: string,
    starterMessageId: string,
    _signal?: AbortSignal,
    duplicateIncident?: boolean,
  ): Promise<boolean> {
    this.adoptions.push({
      threadId,
      starterMessageId,
      ...(duplicateIncident === undefined ? {} : { duplicateIncident }),
    });
    return true;
  }
}

function message(id: string, content: string, authorId = "999") {
  return { id, content, author: { id: authorId }, createdTimestamp: Number(id) };
}

function thread(
  id: string,
  starter: ReturnType<typeof message> | null,
  replies: Array<ReturnType<typeof message>> = [],
  canAttachFiles = true,
) {
  return {
    id,
    guildId: "100",
    parentId: "200",
    createdTimestamp: Number(id),
    isThread: () => true,
    permissionsFor: vi.fn(() => ({ has: () => canAttachFiles })),
    fetchStarterMessage: vi.fn(async () => starter),
    messages: {
      fetch: vi.fn(async () => new Collection(replies.map((reply) => [reply.id, reply]))),
    },
    send: vi.fn(async (options: { content: string }) => message("800", options.content)),
  };
}

function harness(options: {
  claim: ClaimedPublication;
  active?: Array<ReturnType<typeof thread>>;
  archived?: Array<ReturnType<typeof thread>>;
  createdThread?: ReturnType<typeof thread>;
  createError?: unknown;
  replyThread?: ReturnType<typeof thread>;
  chartImages?: MarketChartRenderer;
  chartsEnabled?: boolean;
  publicationLog?: PublicationLogSink;
  monotonicNow?: () => number;
}) {
  const client = new Client({ intents: [] });
  vi.spyOn(client, "isReady").mockReturnValue(true);
  vi.spyOn(client, "user", "get").mockReturnValue({ id: "999" } as never);
  const create = options.createError === undefined
    ? vi.fn(async (_createOptions: unknown) => options.createdThread ?? thread("700", message("701", options.claim.delivery.content)))
    : vi.fn(async (_createOptions: unknown) => { throw options.createError; });
  const forum = {
    id: "200",
    guildId: "100",
    type: ChannelType.GuildForum,
    permissionsFor: vi.fn(() => ({ has: () => true })),
    threads: {
      fetchActive: vi.fn(async () => ({
        threads: new Collection((options.active ?? []).map((item) => [item.id, item])),
        members: new Collection(),
      })),
      fetchArchived: vi.fn(async () => ({
        threads: new Collection((options.archived ?? []).map((item) => [item.id, item])),
        members: new Collection(),
        hasMore: false,
      })),
      create,
    },
  };
  vi.spyOn(client.channels, "fetch").mockImplementation(async (channelId) => {
    if (channelId === "200") return forum as never;
    if (channelId === options.replyThread?.id) return options.replyThread as never;
    return null;
  });
  const convex = new FakeConvex(options.claim);
  const events: PublicationEvent[] = [];
  let clock = 0;
  const publisher = new ForumPublisher({
    client,
    convex,
    workerId: "publisher_1",
    reconciliationDelaysMs: [0, 0],
    delay: async () => undefined,
    ...(options.chartImages === undefined ? {} : { chartImages: options.chartImages }),
    chartsEnabled: options.chartsEnabled ?? false,
    publicationLog: options.publicationLog ?? ((event) => { events.push(event); }),
    monotonicNow: options.monotonicNow ?? (() => { clock += 5; return clock; }),
  });
  return { publisher, convex, forum, create, events };
}

describe("market-research forum publisher", () => {
  it("creates a forum thread, verifies its starter, and never sends on the parent", async () => {
    const publication = claim();
    const created = thread("700", message("701", publication.delivery.content));
    const { publisher, convex, create, forum, events } = harness({ claim: publication, createdThread: created });

    await publisher.poll();

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      name: publication.forumTitle,
      message: { content: publication.delivery.content, allowedMentions: { parse: [] } },
      appliedTags: ["300"],
    });
    expect("send" in forum).toBe(false);
    expect(convex.acknowledgements).toEqual([{
      status: "sent",
      discordThreadId: "700",
      discordMessageId: "701",
    }]);
    expect(events.map(({ operation, outcome, durationMs }) => ({ operation, outcome, durationMs }))).toEqual([
      { operation: "attempt", outcome: "started", durationMs: undefined },
      { operation: "heartbeat", outcome: "accepted", durationMs: 5 },
      { operation: "reconcile", outcome: "none", durationMs: 5 },
      { operation: "charts", outcome: "skipped", durationMs: 5 },
      { operation: "send", outcome: "sent", durationMs: 5 },
      { operation: "heartbeat", outcome: "accepted", durationMs: 5 },
      { operation: "verify_starter", outcome: "verified", durationMs: 5 },
      { operation: "acknowledge", outcome: "accepted", durationMs: 5 },
    ]);
    expect(events.at(-1)).toMatchObject({ acknowledgement: "sent", kind: "starter", sequence: 0, attempt: 1, retryCount: 0 });
  });

  it("adopts a matching starter after a lost acknowledgement without creating a second thread", async () => {
    const publication = claim({
      delivery: { ...claim().delivery, attempts: 2 },
    });
    const existing = thread("600", message("601", publication.delivery.content));
    const { publisher, convex, create, events } = harness({ claim: publication, active: [existing] });

    await publisher.poll();

    expect(create).not.toHaveBeenCalled();
    expect(convex.adoptions).toEqual([{ threadId: "600", starterMessageId: "601" }]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "attempt", attempt: 2, retryCount: 1 }),
      expect.objectContaining({ operation: "reconcile", outcome: "found" }),
      expect.objectContaining({ operation: "adopt", outcome: "accepted", duplicateIncident: false }),
    ]));
    expect(events.some((event) => event.operation === "send")).toBe(false);
  });

  it("waits for delayed thread visibility and adopts without creating another thread", async () => {
    const publication = claim({ delivery: { ...claim().delivery, attempts: 2 } });
    const existing = thread("600", message("601", publication.delivery.content));
    const { publisher, convex, create, forum } = harness({ claim: publication });
    forum.threads.fetchActive
      .mockResolvedValueOnce({ threads: new Collection(), members: new Collection() })
      .mockResolvedValue({
        threads: new Collection([[existing.id, existing]]),
        members: new Collection(),
      });

    await publisher.poll();

    expect(create).not.toHaveBeenCalled();
    expect(convex.adoptions).toEqual([{ threadId: "600", starterMessageId: "601" }]);
  });

  it("stops on multiple matching starters and records an operator-required state", async () => {
    const publication = claim();
    const first = thread("600", message("601", publication.delivery.content));
    const second = thread("700", message("701", publication.delivery.content));
    const { publisher, convex, create, events } = harness({ claim: publication, active: [first, second] });

    await publisher.poll();

    expect(create).not.toHaveBeenCalled();
    expect(convex.adoptions).toEqual([{
      threadId: "600",
      starterMessageId: "601",
      duplicateIncident: true,
    }]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "reconcile", outcome: "duplicate" }),
      expect.objectContaining({ operation: "adopt", outcome: "accepted", duplicateIncident: true }),
    ]));
  });

  it("does not retry an ambiguous create when the thread stays invisible", async () => {
    const publication = claim();
    const { publisher, convex, create } = harness({
      claim: publication,
      createError: new Error("connection reset after request write"),
    });

    await publisher.poll();

    expect(create).toHaveBeenCalledOnce();
    expect(convex.acknowledgements.at(-1)).toEqual({
      status: "failed",
      code: "discord_thread_reconcile_ambiguous",
      retryable: false,
    });
  });

  it("sends an ordered reply only to the returned forum thread with mention suppression and nonce enforcement", async () => {
    const replyContent = "Part 1/1 - Sources\n- Evidence";
    const publication = claim({
      threadId: "700",
      starterMessageId: "701",
      delivery: {
        ...claim().delivery,
        deliveryId: "edition_1:reply:0001",
        sequence: 1,
        kind: "reply",
        content: replyContent,
        contentHash: sha256(replyContent),
        nonce: "reply_nonce_1",
      },
    });
    const existingThread = thread("700", message("701", claim().delivery.content));
    const { publisher, convex, create, events } = harness({ claim: publication, replyThread: existingThread });

    await publisher.poll();

    expect(create).not.toHaveBeenCalled();
    expect(existingThread.send).toHaveBeenCalledWith({
      content: replyContent,
      allowedMentions: { parse: [] },
      nonce: "reply_nonce_1",
      enforceNonce: true,
    });
    expect(convex.acknowledgements).toEqual([{
      status: "sent",
      discordThreadId: "700",
      discordMessageId: "800",
    }]);
    expect(events.filter((event) => event.operation === "send")).toEqual([
      expect.objectContaining({ kind: "reply", sequence: 1, outcome: "sent", durationMs: 5, attachmentCount: 0 }),
    ]);
    expect(events.at(-1)).toMatchObject({ operation: "acknowledge", outcome: "accepted", acknowledgement: "sent" });
  });

  it("reconciles a bot-authored reply after its acknowledgement was lost", async () => {
    const replyContent = "Part 1/1 - Sources\n- Evidence";
    const publication = claim({
      threadId: "700",
      starterMessageId: "701",
      delivery: {
        ...claim().delivery,
        deliveryId: "edition_1:reply:0001",
        sequence: 1,
        kind: "reply",
        content: replyContent,
        contentHash: sha256(replyContent),
        nonce: "reply_nonce_1",
        attempts: 2,
      },
    });
    const existingThread = thread(
      "700",
      message("701", claim().delivery.content),
      [message("702", replyContent)],
    );
    const { publisher, convex, events } = harness({ claim: publication, replyThread: existingThread });

    await publisher.poll();

    expect(existingThread.send).not.toHaveBeenCalled();
    expect(convex.acknowledgements).toEqual([{
      status: "sent",
      discordThreadId: "700",
      discordMessageId: "702",
    }]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "reconcile", outcome: "found", kind: "reply" }),
      expect.objectContaining({ operation: "acknowledge", outcome: "accepted", acknowledgement: "sent" }),
    ]));
  });

  it("stops when multiple bot-authored replies match the same part", async () => {
    const replyContent = "Part 1/1 - Sources\n- Evidence";
    const publication = claim({
      threadId: "700",
      starterMessageId: "701",
      delivery: {
        ...claim().delivery,
        deliveryId: "edition_1:reply:0001",
        sequence: 1,
        kind: "reply",
        content: replyContent,
        contentHash: sha256(replyContent),
        nonce: "reply_nonce_1",
      },
    });
    const existingThread = thread("700", message("701", claim().delivery.content), [
      message("702", replyContent),
      message("703", replyContent),
    ]);
    const { publisher, convex, events } = harness({ claim: publication, replyThread: existingThread });

    await publisher.poll();

    expect(existingThread.send).not.toHaveBeenCalled();
    expect(convex.acknowledgements).toEqual([{
      status: "failed",
      discordThreadId: "700",
      discordMessageId: "702",
      code: "discord_thread_reconcile_ambiguous",
      retryable: false,
    }]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "reconcile", outcome: "duplicate", kind: "reply" }),
      expect.objectContaining({ operation: "acknowledge", outcome: "accepted", acknowledgement: "failed", code: "discord_thread_reconcile_ambiguous" }),
    ]));
  });

  it.each([
    { canAttachFiles: true, chartsEnabled: true, providerConfigured: true },
    { canAttachFiles: false, chartsEnabled: true, providerConfigured: true },
    { canAttachFiles: true, chartsEnabled: false, providerConfigured: true },
    { canAttachFiles: true, chartsEnabled: true, providerConfigured: false },
  ])("gates optional attachments without blocking text: %j", async (controls) => {
    const replyContent = "Part 1/1 - Sources\n- Evidence";
    const chartRequest = {
      chartRequestId: "chart_1",
      editionId: "edition_1",
      sectionId: "sources",
      symbol: "AMD",
      timeframe: "15m" as const,
      start: "2026-09-01T08:00:00.000-04:00",
      end: "2026-09-01T09:00:00.000-04:00",
      session: "premarket" as const,
      overlays: ["VWAP"],
      annotations: [],
      reason: "Shows the validated trigger area.",
      priority: 100,
      sourceEvidenceIds: ["evidence_1"],
      dataAsOf: "2026-09-01T09:00:00.000-04:00",
    };
    const publication = claim({
      threadId: "700",
      starterMessageId: "701",
      delivery: {
        ...claim().delivery,
        deliveryId: "edition_1:reply:0001",
        sequence: 1,
        kind: "reply",
        content: replyContent,
        contentHash: sha256(replyContent),
        nonce: "reply_nonce_1",
        chartAttachmentIds: ["chart_1"],
        chartRequests: [chartRequest],
      },
    });
    const existingThread = thread("700", message("701", claim().delivery.content), [], controls.canAttachFiles);
    const render = vi.fn(async () => ({
      attachment: Buffer.from("trusted png"),
      name: "amd-chart.png",
      description: "AMD chart",
      contentType: "image/png" as const,
    }));
    const { publisher, events } = harness({
      claim: publication,
      replyThread: existingThread,
      ...(controls.providerConfigured ? { chartImages: { render } } : {}),
      chartsEnabled: controls.chartsEnabled,
    });

    await publisher.poll();

    if (controls.canAttachFiles && controls.chartsEnabled && controls.providerConfigured) {
      expect(render).toHaveBeenCalledWith(expect.objectContaining({ symbol: "AMD", tradingViewSymbol: "NASDAQ:AMD", interval: "15m" }));
      expect(existingThread.send).toHaveBeenCalledWith(expect.objectContaining({
        content: replyContent, files: [expect.objectContaining({ name: "amd-chart.png" })],
      }));
      expect(events).toContainEqual(expect.objectContaining({ operation: "charts", outcome: "complete", requestedCharts: 1, renderedCharts: 1, unavailableCharts: 0 }));
    } else {
      expect(render).not.toHaveBeenCalled();
      expect(existingThread.send).toHaveBeenCalledWith(expect.objectContaining({ content: replyContent }));
      expect(existingThread.send).toHaveBeenCalledWith(expect.not.objectContaining({ files: expect.anything() }));
      expect(events).toContainEqual(expect.objectContaining({ operation: "charts", outcome: "skipped", requestedCharts: 1, renderedCharts: 0, unavailableCharts: 1, code: "chart_unavailable" }));
    }
  });

  it.each([false, true])("publishes complete text when chart rendering fails, partial=%s", async (partial) => {
    const chartRequest = {
      chartRequestId: "chart_1",
      editionId: "edition_1",
      sectionId: "sources",
      symbol: "AMD",
      timeframe: "15m" as const,
      start: "2026-09-01T08:00:00.000-04:00",
      end: "2026-09-01T09:00:00.000-04:00",
      session: "premarket" as const,
      overlays: [],
      annotations: [],
      reason: "Optional context.",
      priority: 10,
      sourceEvidenceIds: ["evidence_1"],
      dataAsOf: "2026-09-01T09:00:00.000-04:00",
    };
    const replyContent = "Part 1/1 - Sources\n- Evidence";
    const publication = claim({
      threadId: "700",
      starterMessageId: "701",
      delivery: {
        ...claim().delivery,
        deliveryId: "edition_1:reply:0001",
        sequence: 1,
        kind: "reply",
        content: replyContent,
        contentHash: sha256(replyContent),
        nonce: "reply_nonce_1",
        chartAttachmentIds: ["chart_1", "chart_2"],
        chartRequests: [chartRequest, { ...chartRequest, chartRequestId: "chart_2" }],
      },
    });
    const existingThread = thread("700", message("701", claim().delivery.content));
    const render = vi.fn<MarketChartRenderer["render"]>(async () => { throw new Error("sensitive provider URL https://chart.test/private?token=hidden"); });
    if (partial) render.mockResolvedValueOnce({
      attachment: Buffer.from("trusted png"), name: "amd.png", description: "AMD chart", contentType: "image/png",
    });
    const { publisher, convex, events } = harness({
      claim: publication,
      replyThread: existingThread,
      chartImages: { render },
      chartsEnabled: true,
    });

    await publisher.poll();

    if (partial) {
      expect(existingThread.send).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.objectContaining({ name: "amd.png" })] }));
    } else {
      expect(existingThread.send).toHaveBeenCalledWith(expect.not.objectContaining({ files: expect.anything() }));
    }
    expect(convex.acknowledgements.at(-1)?.status).toBe("sent");
    expect(events).toContainEqual(expect.objectContaining({ operation: "charts", outcome: partial ? "partial" : "failed", requestedCharts: 2, renderedCharts: partial ? 1 : 0, unavailableCharts: partial ? 1 : 2, code: "chart_unavailable" }));
    expect(JSON.stringify(events)).not.toContain("sensitive");
    expect(JSON.stringify(events)).not.toContain("https://");
  });
});

describe("publication telemetry boundaries", () => {
  it.each(["starter", "reply"] as const)("does not report %s delivery as durable when acknowledgment rejects its fence", async (kind) => {
    const publication = kind === "starter" ? claim() : replyClaim();
    const { publisher, convex, events } = harness({
      claim: publication,
      replyThread: thread("700", message("701", claim().delivery.content)),
    });
    vi.spyOn(convex, "acknowledgePublication").mockResolvedValue(false);

    await publisher.poll();

    expect(events.filter((event) => event.operation === "send")).toEqual([
      expect.objectContaining({ outcome: "sent", kind, durationMs: 5 }),
    ]);
    expect(events.filter((event) => event.operation === "acknowledge")).toEqual([
      expect.objectContaining({ outcome: "fence_rejected", acknowledgement: "sent", kind }),
    ]);
    expect(JSON.stringify(events)).not.toContain("published");
  });

  it("records a rejected initial heartbeat without sending or acknowledging", async () => {
    const { publisher, convex, create, events } = harness({ claim: claim() });
    vi.spyOn(convex, "heartbeatPublication").mockResolvedValue(false);

    await publisher.poll();

    expect(create).not.toHaveBeenCalled();
    expect(convex.acknowledgements).toEqual([]);
    expect(events.map(({ operation, outcome }) => ({ operation, outcome }))).toEqual([
      { operation: "attempt", outcome: "started" },
      { operation: "heartbeat", outcome: "fence_rejected" },
    ]);
  });

  it("keeps a sent starter unacknowledged when the post-send heartbeat rejects", async () => {
    const { publisher, convex, create, events } = harness({ claim: claim() });
    vi.spyOn(convex, "heartbeatPublication").mockResolvedValueOnce(true).mockResolvedValue(false);

    await publisher.poll();

    expect(create).toHaveBeenCalledOnce();
    expect(convex.acknowledgements).toEqual([]);
    expect(events.at(-1)).toMatchObject({ operation: "heartbeat", outcome: "fence_rejected" });
    expect(events.filter((event) => event.operation === "send")).toHaveLength(1);
    expect(events.some((event) => event.operation === "acknowledge")).toBe(false);
  });

  it("records adoption fence rejection without asserting durable adoption", async () => {
    const publication = claim();
    const { publisher, convex, create, events } = harness({
      claim: publication,
      active: [thread("600", message("601", publication.delivery.content))],
    });
    vi.spyOn(convex, "adoptReconciledStarter").mockResolvedValue(false);

    await publisher.poll();

    expect(create).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ operation: "adopt", outcome: "fence_rejected" });
  });

  it("counts unverified starter checks without presenting a sent request as a verified publication", async () => {
    const { publisher, convex, create, events } = harness({ claim: claim(), createdThread: thread("700", null) });

    await publisher.poll();

    expect(create).toHaveBeenCalledOnce();
    expect(events.filter((event) => event.operation === "verify_starter").map((event) => event.outcome)).toEqual(["unverified", "unverified", "unverified"]);
    expect(events.filter((event) => event.operation === "reconcile").map((event) => event.outcome)).toEqual(["none", "none", "none"]);
    expect(events.at(-1)).toMatchObject({ operation: "acknowledge", outcome: "accepted", acknowledgement: "failed", code: "discord_thread_reconcile_ambiguous" });
    expect(convex.acknowledgements.at(-1)?.status).toBe("failed");
  });

  it("counts retry attempts and classifies a rate limit without logging Discord error data", async () => {
    const publication = claim({ delivery: { ...claim().delivery, attempts: 2 }, lastErrorCode: "discord_rate_limited" });
    const error = { status: 429, retry_after: 2.5, message: "Authorization: fake_secret; https://discord.test/private" };
    const { publisher, events, convex } = harness({ claim: publication, createError: error });

    await publisher.poll();

    expect(events).toContainEqual(expect.objectContaining({
      operation: "send", outcome: "failed", attempt: 2, retryCount: 1,
      code: "discord_rate_limited", retryable: true, retryAfterMs: 2_500, durationMs: 5,
    }));
    expect(events.at(-1)).toMatchObject({ operation: "acknowledge", outcome: "accepted", acknowledgement: "failed", code: "discord_rate_limited" });
    expect(convex.acknowledgements.at(-1)?.status).toBe("failed");
    const serialized = JSON.stringify(events);
    for (const secret of [
      publication.delivery.content, publication.forumTitle, publication.delivery.contentHash,
      publication.delivery.nonce, publication.delivery.deliveryToken, publication.publicationToken,
      "Authorization", "fake_secret", "https://", "message", "stack",
    ]) expect(serialized).not.toContain(secret);
    expect(new Set(events.map((event) => event.editionId))).toEqual(new Set([publication.editionId]));
  });

  it("records failed reconciliation as failed, not as an authoritative absence", async () => {
    const { publisher, forum, events } = harness({ claim: claim() });
    forum.threads.fetchActive.mockRejectedValueOnce(new Error("private Discord error"));

    await publisher.poll();

    expect(events.filter((event) => event.operation === "reconcile")).toEqual([
      expect.objectContaining({ outcome: "failed", code: "discord_thread_reconcile_failed", durationMs: 5 }),
    ]);
    expect(JSON.stringify(events)).not.toContain("private Discord error");
  });

  it("records reply send failure and recovery absence separately", async () => {
    const publication = replyClaim();
    const replyThread = thread("700", message("701", claim().delivery.content));
    replyThread.send.mockRejectedValueOnce({ code: 50_013, message: "sensitive provider error" });
    const { publisher, events, convex } = harness({ claim: publication, replyThread });

    await publisher.poll();

    expect(events.filter((event) => event.operation === "reconcile").map((event) => event.outcome)).toEqual(["none", "none"]);
    expect(events).toContainEqual(expect.objectContaining({ operation: "send", kind: "reply", outcome: "failed", code: "discord_permission_failed", retryable: false, durationMs: 5 }));
    expect(convex.acknowledgements.at(-1)).toMatchObject({ status: "failed", code: "discord_permission_failed" });
    expect(JSON.stringify(events)).not.toContain("sensitive provider error");
  });

  it("does not reclassify an acknowledgment transport error as a Discord send error", async () => {
    const { publisher, convex, events } = harness({ claim: claim() });
    const failure = new Error("private Convex payload");
    vi.spyOn(convex, "acknowledgePublication").mockRejectedValue(failure);

    await expect(publisher.poll()).rejects.toBe(failure);

    expect(events.filter((event) => event.operation === "send")).toEqual([
      expect.objectContaining({ outcome: "sent" }),
    ]);
    expect(events.at(-1)).toMatchObject({ operation: "acknowledge", outcome: "failed", acknowledgement: "sent" });
    expect(JSON.stringify(events)).not.toContain("private Convex payload");
  });

  it.each([false, true])("isolates a throwing log sink during failed=%s publication", async (fails) => {
    const publicationLog = vi.fn(() => { throw new Error("log sink unavailable"); });
    const { publisher, convex, create } = harness({
      claim: claim(), publicationLog,
      ...(fails ? { createError: { status: 403 } } : {}),
    });

    await expect(publisher.poll()).resolves.toBe(true);

    expect(publicationLog).toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
    expect(convex.acknowledgements).toHaveLength(1);
    expect(convex.acknowledgements[0]?.status).toBe(fails ? "failed" : "sent");
  });

  it("isolates a throwing measurement clock and omits unavailable durations", async () => {
    const { publisher, convex, events } = harness({
      claim: claim(), monotonicNow: () => { throw new Error("clock unavailable"); },
    });

    await expect(publisher.poll()).resolves.toBe(true);

    expect(convex.acknowledgements.at(-1)?.status).toBe("sent");
    expect(events.every((event) => event.durationMs === undefined)).toBe(true);
    expect(events.some((event) => event.operation === "send" && event.outcome === "sent")).toBe(true);
  });
});

describe("Discord publication error mapping", () => {
  it("keeps rate limits retryable and permission failures terminal", () => {
    expect(classifyPublicationError({ status: 429 }, "starter")).toEqual({
      code: "discord_rate_limited",
      retryable: true,
    });
    expect(classifyPublicationError({ status: 429, retry_after: 2.5 }, "reply")).toEqual({
      code: "discord_rate_limited",
      retryable: true,
      retryAfterMs: 2_500,
    });
    expect(classifyPublicationError({ code: 50_013 }, "reply")).toEqual({
      code: "discord_permission_failed",
      retryable: false,
    });
  });
});
