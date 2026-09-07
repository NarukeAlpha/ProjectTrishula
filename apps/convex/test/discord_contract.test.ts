import { describe, expect, it } from "vitest";
import type { Infer } from "convex/values";
import { discordGatewayRequestSchema, normalizeDiscordForumCapabilities } from "../convex/lib/discord_contract.js";
import schema from "../convex/schema.js";

describe("Discord gateway HTTP contract", () => {
  it("accepts existing gateway inventory with fail-closed forum defaults", () => {
    const request = discordGatewayRequestSchema.parse({
      operation: "syncGuilds", actorId: "user_01HWORKOSALLOWED", instanceId: "gateway_1", status: "online",
      guilds: [{
        guildId: "123", name: "Existing server",
        permissions: { viewChannels: true, sendMessages: true, readMessageHistory: true, messageContent: true },
        channels: [{ channelId: "456", name: "conversation", type: "text", canView: true, canSend: true, canReadHistory: true }],
      }],
    });
    if (request.operation !== "syncGuilds") throw new Error("Expected inventory operation.");
    expect(request.actorId).toBe("user_01HWORKOSALLOWED");
    expect(request.guilds[0]?.channels[0]).toMatchObject({
      canView: true, canSend: true, canReadHistory: true,
      canCreateForumPost: false, canSendInThreads: false, canReadThreadHistory: false,
      canAttachFiles: false, requiresTag: true, availableTags: [],
    });
  });

  it("keeps existing channel rows valid and preserves conversation roles", () => {
    const legacyChannel: Infer<typeof schema.tables.discordChannels.validator> = {
      ownerId: "user_01HWORKOSALLOWED", guildId: "123", channelId: "456", name: "conversation", type: "text",
      canView: true, canSend: true, canReadHistory: true,
      roles: ["conversation_monitor", "reply_target", "research_log"],
      available: true, lastSeenAt: 1, createdAt: 1, updatedAt: 1,
    };
    expect(normalizeDiscordForumCapabilities(legacyChannel)).toEqual({
      canCreateForumPost: false, canSendInThreads: false, canReadThreadHistory: false,
      canAttachFiles: false, requiresTag: true, availableTags: [],
    });
    expect(legacyChannel.roles).toEqual(["conversation_monitor", "reply_target", "research_log"]);
    expect(legacyChannel).not.toHaveProperty("canCreateForumPost");
  });

  it("preserves refreshed forum capabilities and requires known tag metadata", () => {
    const refreshed = {
      canCreateForumPost: true, canSendInThreads: true, canReadThreadHistory: true,
      canAttachFiles: true, requiresTag: false,
      availableTags: [{ id: "123", name: "Morning", moderated: false }],
    };
    expect(normalizeDiscordForumCapabilities(refreshed)).toEqual(refreshed);
    expect(normalizeDiscordForumCapabilities({ canCreateForumPost: true, canSendInThreads: true })).toMatchObject({
      canReadThreadHistory: false, requiresTag: true, availableTags: [],
    });
  });

  it("requires an allowlist-compatible actor and worker on runnable polling", () => {
    expect(discordGatewayRequestSchema.safeParse({
      operation: "listRunnable",
      actorId: "user_01HWORKOSALLOWED",
      workerId: "discord-worker_1",
      limit: 20,
    }).success).toBe(true);
    expect(discordGatewayRequestSchema.safeParse({
      operation: "listRunnable",
      workerId: "discord-worker_1",
    }).success).toBe(false);
  });

  it("accepts the backward-compatible portable checkpoint operations", () => {
    expect(discordGatewayRequestSchema.safeParse({
      operation: "nextPortableCheckpoint",
      actorId: "user_01HWORKOSALLOWED",
    }).success).toBe(true);
    expect(discordGatewayRequestSchema.safeParse({
      operation: "storePortableCheckpoint",
      actorId: "user_01HWORKOSALLOWED",
      guildId: "123",
      conversationId: "discord:123",
      epoch: 1,
      expectedRevision: 3,
      expectedGeneration: 2,
      expectedRoutingGeneration: 1,
      checkpointId: "checkpoint:123:1:3:abc",
      sourceContextHash: "a".repeat(64),
      toolPolicyHash: "b".repeat(64),
      compactedThroughOrdinal: 2,
      portableSummary: JSON.stringify({ participants: [] }),
      retainedRecentEventIds: ["event:3"],
      inputTokens: 100,
      outputTokens: 40,
      estimatedSavedTokens: 60,
    }).success).toBe(true);
  });

  it("rejects unknown fields instead of forwarding them to an internal mutation", () => {
    expect(discordGatewayRequestSchema.safeParse({
      operation: "newestContext",
      actorId: "user_01HWORKOSALLOWED",
      guildId: "123",
      channelId: "456",
      ownerOverride: "user_01OTHER",
    }).success).toBe(false);
  });

  it("accepts image-only Discord messages from the Discord CDN", () => {
    expect(discordGatewayRequestSchema.safeParse({
      operation: "ingestMessage",
      actorId: "user_01HWORKOSALLOWED",
      guildId: "123",
      channelId: "456",
      messageId: "789",
      authorId: "user_1",
      authorName: "User One",
      content: "",
      images: [{
        attachmentId: "111",
        url: "https://cdn.discordapp.com/attachments/123/456/chart.png",
        filename: "chart.png",
        mediaType: "image/png",
        sizeBytes: 1_024,
        width: 800,
        height: 600,
      }],
      mentionsBot: true,
      isBot: false,
      createdAt: 1_000,
    }).success).toBe(true);
  });

  it("rejects empty Discord messages and untrusted image hosts", () => {
    const message = {
      operation: "ingestMessage",
      actorId: "user_01HWORKOSALLOWED",
      guildId: "123",
      channelId: "456",
      messageId: "789",
      authorId: "user_1",
      authorName: "User One",
      content: "",
      mentionsBot: false,
      isBot: false,
      createdAt: 1_000,
    } as const;
    expect(discordGatewayRequestSchema.safeParse(message).success).toBe(false);
    expect(discordGatewayRequestSchema.safeParse({
      ...message,
      images: [{
        attachmentId: "111",
        url: "https://example.com/chart.png",
        filename: "chart.png",
        mediaType: "image/png",
        sizeBytes: 1_024,
      }],
    }).success).toBe(false);
  });

  it("requires the delivery lease token on a sent acknowledgement", () => {
    expect(discordGatewayRequestSchema.safeParse({
      operation: "acknowledgeReply",
      actorId: "user_01HWORKOSALLOWED",
      outboxId: "outbox_1",
      status: "sent",
      discordMessageId: "123",
    }).success).toBe(false);
  });

  it("records the uncertain boundary before a Discord send", () => {
    expect(discordGatewayRequestSchema.safeParse({
      operation: "beginReplyDelivery",
      actorId: "user_01HWORKOSALLOWED",
      outboxId: "outbox_1",
      deliveryToken: "delivery_1",
    }).success).toBe(true);
    expect(discordGatewayRequestSchema.safeParse({
      operation: "acknowledgeReply",
      actorId: "user_01HWORKOSALLOWED",
      outboxId: "outbox_1",
      deliveryToken: "delivery_1",
      status: "uncertain",
    }).success).toBe(true);
  });

  it("PERS-008 persists every durable frontman stage behind the full fence", () => {
    const common = {
      actorId: "user_01HWORKOSALLOWED",
      guildId: "123",
      fence: {
        sourceChannelId: "456",
        runId: "run_1",
        channelGeneration: 2,
        conversationId: "discord:123",
        epoch: 1,
        conversationGeneration: 3,
        routingGeneration: 4,
        turnId: "turn_1",
        conversationLeaseToken: "lease_1",
      },
    };
    expect(discordGatewayRequestSchema.safeParse({
      operation: "recordFrontmanPlan",
      ...common,
      requestId: "run_1:frontman-plan",
      action: "research",
      reasonCode: "explicit_needs_freshness",
      payload: JSON.stringify({ action: "research" }),
    }).success).toBe(true);
    expect(discordGatewayRequestSchema.safeParse({
      operation: "recordResearchStarted",
      ...common,
      requestId: "run_1:sol:1",
      normalizedRequest: JSON.stringify({ question: "What changed?" }),
      inputContextHash: "a".repeat(64),
      pass: 1,
    }).success).toBe(true);
    expect(discordGatewayRequestSchema.safeParse({
      operation: "recordResearchResult",
      ...common,
      requestId: "run_1:sol:1",
      failureCode: "provider_unavailable",
      failureDetail: "Public research was unavailable.",
      failureRetryable: true,
      sourceUrls: [],
      serializedBytes: 0,
      estimatedTokens: 0,
      tokenEstimatorVersion: "js-tiktoken@1.0.21:o200k_base:gpt-5.6-sol-estimate:v1",
    }).success).toBe(true);
    expect(discordGatewayRequestSchema.safeParse({
      operation: "recordFrontmanResume",
      ...common,
      requestId: "run_1:frontman-resume:1",
      action: "send",
      payload: JSON.stringify({ action: "send" }),
      acknowledgementDelivery: "sent",
      replyHash: "b".repeat(64),
      eligibleThroughSequence: 5,
      eligibleHumanRevision: 2,
      eligibleContextHash: "c".repeat(64),
    }).success).toBe(true);
    expect(discordGatewayRequestSchema.safeParse({
      operation: "recordFrontmanPlan",
      ...common,
      fence: { ...common.fence, epoch: undefined },
      requestId: "run_1:frontman-plan",
      action: "research",
      reasonCode: "explicit_needs_freshness",
      payload: "{}",
    }).success).toBe(false);
  });

  it("accepts generated image metadata on a sent acknowledgement", () => {
    expect(discordGatewayRequestSchema.safeParse({
      operation: "acknowledgeReply",
      actorId: "user_01HWORKOSALLOWED",
      outboxId: "outbox_1",
      deliveryToken: "delivery_1",
      status: "sent",
      discordMessageId: "123",
      images: [{
        attachmentId: "456",
        url: "https://cdn.discordapp.com/attachments/1/2/chart.png",
        filename: "chart.png",
        mediaType: "image/png",
        sizeBytes: 4_096,
        width: 960,
        height: 540,
      }],
    }).success).toBe(true);
  });

  it("accepts an explicit acknowledgement reply kind", () => {
    expect(discordGatewayRequestSchema.safeParse({
      operation: "enqueueReply",
      actorId: "user_01HWORKOSALLOWED",
      sourceChannelId: "123",
      guildId: "456",
      channelId: "123",
      runId: "run_1",
      generation: 1,
      idempotencyKey: "run_1:ack",
      replyKind: "acknowledgement",
      content: "I picked this up and will check the market move.",
      recheckRequested: false,
      finalizesLoop: false,
    }).success).toBe(true);
    expect(discordGatewayRequestSchema.safeParse({
      operation: "enqueueReply",
      actorId: "user_01HWORKOSALLOWED",
      sourceChannelId: "123",
      guildId: "456",
      channelId: "123",
      runId: "run_1",
      generation: 1,
      idempotencyKey: "run_1:ack",
      replyKind: "status_update",
      content: "Working on it.",
      recheckRequested: false,
      finalizesLoop: false,
    }).success).toBe(false);
    expect(discordGatewayRequestSchema.safeParse({
      operation: "enqueueReply",
      actorId: "user_01HWORKOSALLOWED",
      sourceChannelId: "123",
      guildId: "456",
      channelId: "123",
      runId: "run_1",
      generation: 1,
      idempotencyKey: "run_1:ack-oversize",
      replyKind: "acknowledgement",
      content: "😀".repeat(321),
      recheckRequested: false,
      finalizesLoop: false,
    }).success).toBe(false);
  });

  it("uses a Unicode-aware 2,000-character boundary and a complete fence", () => {
    const request = {
      operation: "enqueueReply",
      actorId: "user_01HWORKOSALLOWED",
      sourceChannelId: "123",
      guildId: "456",
      channelId: "123",
      runId: "run_1",
      generation: 1,
      conversation: {
        conversationId: "discord:456",
        epoch: 1,
        generation: 2,
        routingGeneration: 1,
        turnId: "turn_1",
        leaseToken: "lease_1",
        eligibleHumanRevision: 3,
      },
      idempotencyKey: "run_1:reply",
      replyKind: "final",
      content: "😀".repeat(2_000),
      recheckRequested: false,
      finalizesLoop: true,
    } as const;
    expect(discordGatewayRequestSchema.safeParse(request).success).toBe(true);
    const normalized = discordGatewayRequestSchema.parse({
      ...request,
      content: `  ${"😀".repeat(2_000)}  `,
    });
    expect(normalized.operation === "enqueueReply" ? normalized.content : null)
      .toBe("😀".repeat(2_000));
    expect(discordGatewayRequestSchema.safeParse({
      ...request,
      content: "😀".repeat(2_001),
    }).success).toBe(false);
    expect(discordGatewayRequestSchema.safeParse({
      ...request,
      conversation: { ...request.conversation, epoch: undefined },
    }).success).toBe(false);
  });

  it("rejects market charts whose timestamps do not increase", () => {
    expect(discordGatewayRequestSchema.safeParse({
      operation: "enqueueReply",
      actorId: "user_01HWORKOSALLOWED",
      sourceChannelId: "123",
      guildId: "456",
      channelId: "123",
      runId: "run_1",
      generation: 1,
      idempotencyKey: "run_1:reply",
      replyKind: "final",
      content: "Here is the chart.",
      chart: {
        symbol: "AMD",
        points: [
          { timestamp: 200, close: 12 },
          { timestamp: 100, close: 10 },
        ],
      },
      recheckRequested: false,
      finalizesLoop: true,
    }).success).toBe(false);
  });

  it("accepts trusted provider charts and rejects conflicting time controls", () => {
    const request = {
      operation: "enqueueReply",
      actorId: "user_01HWORKOSALLOWED",
      sourceChannelId: "123",
      guildId: "456",
      channelId: "123",
      runId: "run_1",
      generation: 1,
      idempotencyKey: "run_1:reply",
      replyKind: "final",
      content: "Here is the chart.",
      chart: {
        symbol: "GC=F",
        tradingViewSymbol: "COMEX:GC1!",
        interval: "1D",
        style: "candle",
        includeVolume: true,
        points: [
          { timestamp: 100, close: 4_400 },
          { timestamp: 200, close: 4_450 },
        ],
      },
      recheckRequested: false,
      finalizesLoop: true,
    };
    expect(discordGatewayRequestSchema.safeParse(request).success).toBe(true);
    expect(discordGatewayRequestSchema.safeParse({
      ...request,
      chart: { ...request.chart, range: "1M" },
    }).success).toBe(false);
    expect(discordGatewayRequestSchema.safeParse({
      ...request,
      chart: { ...request.chart, tradingViewSymbol: "GC=F" },
    }).success).toBe(false);
  });

  it("allows an outbox worker to renew a lease without changing the stage", () => {
    expect(discordGatewayRequestSchema.safeParse({
      operation: "heartbeat",
      actorId: "user_01HWORKOSALLOWED",
      instanceId: "discord_1",
      status: "online",
      run: {
        channelId: "123",
        runId: "run_1",
        generation: 1,
      },
    }).success).toBe(true);
  });

  it("accepts retry classification when the gateway completes a failed loop", () => {
    expect(discordGatewayRequestSchema.safeParse({
      operation: "completeLoop",
      actorId: "user_01HWORKOSALLOWED",
      channelId: "123",
      runId: "run_1",
      generation: 1,
      outcome: "error",
      error: "Pi research failed: provider_network.",
      retryable: true,
    }).success).toBe(true);
  });

  it("accepts a bounded context cutoff when a final reply is suppressed", () => {
    expect(discordGatewayRequestSchema.safeParse({
      operation: "completeLoop",
      actorId: "user_01HWORKOSALLOWED",
      channelId: "123",
      runId: "run_1",
      generation: 1,
      outcome: "completed",
      consumesThroughSequence: 12,
      suppressPendingReplies: true,
      recheckRequested: false,
    }).success).toBe(true);
  });
});
