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
) {
  return {
    id,
    guildId: "100",
    parentId: "200",
    createdTimestamp: Number(id),
    isThread: () => true,
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
  const publisher = new ForumPublisher({
    client,
    convex,
    workerId: "publisher_1",
    reconciliationDelaysMs: [0, 0],
    delay: async () => undefined,
    ...(options.chartImages === undefined ? {} : { chartImages: options.chartImages }),
    chartsEnabled: options.chartsEnabled ?? false,
  });
  return { publisher, convex, forum, create };
}

describe("market-research forum publisher", () => {
  it("creates a forum thread, verifies its starter, and never sends on the parent", async () => {
    const publication = claim();
    const created = thread("700", message("701", publication.delivery.content));
    const { publisher, convex, create, forum } = harness({ claim: publication, createdThread: created });

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
  });

  it("adopts a matching starter after a lost acknowledgement without creating a second thread", async () => {
    const publication = claim({
      delivery: { ...claim().delivery, attempts: 2 },
    });
    const existing = thread("600", message("601", publication.delivery.content));
    const { publisher, convex, create } = harness({ claim: publication, active: [existing] });

    await publisher.poll();

    expect(create).not.toHaveBeenCalled();
    expect(convex.adoptions).toEqual([{ threadId: "600", starterMessageId: "601" }]);
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
    const { publisher, convex, create } = harness({ claim: publication, active: [first, second] });

    await publisher.poll();

    expect(create).not.toHaveBeenCalled();
    expect(convex.adoptions).toEqual([{
      threadId: "600",
      starterMessageId: "601",
      duplicateIncident: true,
    }]);
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
    const { publisher, convex, create } = harness({ claim: publication, replyThread: existingThread });

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
    const { publisher, convex } = harness({ claim: publication, replyThread: existingThread });

    await publisher.poll();

    expect(existingThread.send).not.toHaveBeenCalled();
    expect(convex.acknowledgements).toEqual([{
      status: "sent",
      discordThreadId: "700",
      discordMessageId: "702",
    }]);
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
    const { publisher, convex } = harness({ claim: publication, replyThread: existingThread });

    await publisher.poll();

    expect(existingThread.send).not.toHaveBeenCalled();
    expect(convex.acknowledgements).toEqual([{
      status: "failed",
      discordThreadId: "700",
      discordMessageId: "702",
      code: "discord_thread_reconcile_ambiguous",
      retryable: false,
    }]);
  });

  it("attaches an approved in-process chart to its intended reply", async () => {
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
    const existingThread = thread("700", message("701", claim().delivery.content));
    const render = vi.fn(async () => ({
      attachment: Buffer.from("trusted png"),
      name: "amd-chart.png",
      description: "AMD chart",
      contentType: "image/png" as const,
    }));
    const { publisher } = harness({
      claim: publication,
      replyThread: existingThread,
      chartImages: { render },
      chartsEnabled: true,
    });

    await publisher.poll();

    expect(render).toHaveBeenCalledWith(expect.objectContaining({
      symbol: "AMD",
      tradingViewSymbol: "NASDAQ:AMD",
      interval: "15m",
    }));
    expect(existingThread.send).toHaveBeenCalledWith(expect.objectContaining({
      content: replyContent,
      files: [expect.objectContaining({ name: "amd-chart.png" })],
    }));
  });

  it("publishes complete text when chart rendering fails", async () => {
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
        chartAttachmentIds: ["chart_1"],
        chartRequests: [chartRequest],
      },
    });
    const existingThread = thread("700", message("701", claim().delivery.content));
    const { publisher, convex } = harness({
      claim: publication,
      replyThread: existingThread,
      chartImages: { render: vi.fn(async () => { throw new Error("timeout"); }) },
      chartsEnabled: true,
    });

    await publisher.poll();

    expect(existingThread.send).toHaveBeenCalledWith(expect.not.objectContaining({ files: expect.anything() }));
    expect(convex.acknowledgements.at(-1)?.status).toBe("sent");
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
