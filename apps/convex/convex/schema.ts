import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const commandTypeValidator = v.union(
  v.literal("thread.prompt"),
  v.literal("thread.retry"),
  v.literal("thread.stop"),
  v.literal("thread.rename"),
  v.literal("thread.archive"),
);

export const commandStatusValidator = v.union(
  v.literal("accepted"),
  v.literal("dispatching"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const runStatusValidator = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("cancellation_requested"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const messageStatusValidator = v.union(
  v.literal("pending"),
  v.literal("streaming"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const toolStatusValidator = v.union(
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const brokerConnectionStatusValidator = v.union(
  v.literal("disconnected"),
  v.literal("connecting"),
  v.literal("connected"),
  v.literal("error"),
);

export const tradeProposalStatusValidator = v.union(
  v.literal("awaiting_confirmation"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("expired"),
  v.literal("submitting"),
  v.literal("submitted"),
  v.literal("failed"),
);

export const discordChannelRoleValidator = v.union(
  v.literal("conversation_monitor"),
  v.literal("reply_target"),
  v.literal("research_log"),
);

export const discordChannelTypeValidator = v.union(
  v.literal("text"),
  v.literal("announcement"),
  v.literal("forum"),
  v.literal("other"),
);

export const discordLoopStatusValidator = v.union(
  v.literal("idle"),
  v.literal("triaging"),
  v.literal("acknowledging"),
  v.literal("researching"),
  v.literal("drafting"),
  v.literal("catching_up"),
  v.literal("error"),
);

export const discordReplyKindValidator = v.union(
  v.literal("acknowledgement"),
  v.literal("research_log"),
  v.literal("final"),
);

export const discordImageAttachmentValidator = v.object({
  attachmentId: v.string(),
  url: v.string(),
  filename: v.string(),
  mediaType: v.union(
    v.literal("image/png"),
    v.literal("image/jpeg"),
    v.literal("image/webp"),
    v.literal("image/gif"),
  ),
  sizeBytes: v.number(),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
});

export const discordMarketChartValidator = v.object({
  symbol: v.string(),
  title: v.optional(v.string()),
  points: v.array(v.object({
    timestamp: v.number(),
    close: v.number(),
  })),
  tradingViewSymbol: v.optional(v.string()),
  interval: v.optional(v.union(
    v.literal("1m"),
    v.literal("3m"),
    v.literal("5m"),
    v.literal("10m"),
    v.literal("15m"),
    v.literal("30m"),
    v.literal("45m"),
    v.literal("1h"),
    v.literal("2h"),
    v.literal("3h"),
    v.literal("4h"),
    v.literal("6h"),
    v.literal("8h"),
    v.literal("12h"),
    v.literal("1D"),
    v.literal("2D"),
    v.literal("3D"),
    v.literal("1W"),
    v.literal("1M"),
    v.literal("3M"),
    v.literal("6M"),
    v.literal("1Y"),
  )),
  range: v.optional(v.union(
    v.literal("1D"),
    v.literal("5D"),
    v.literal("1M"),
    v.literal("3M"),
    v.literal("6M"),
    v.literal("1Y"),
    v.literal("5Y"),
    v.literal("ALL"),
    v.literal("DTD"),
    v.literal("WTD"),
    v.literal("MTD"),
    v.literal("YTD"),
  )),
  style: v.optional(v.union(
    v.literal("candle"),
    v.literal("line"),
    v.literal("area"),
  )),
  includeVolume: v.optional(v.boolean()),
});

export const discordActivityEventTypeValidator = v.union(
  v.literal("message_received"),
  v.literal("loop_started"),
  v.literal("stage_changed"),
  v.literal("reply_queued"),
  v.literal("reply_sent"),
  v.literal("reply_failed"),
  v.literal("delivery_uncertain"),
  v.literal("delivery_reconciliation_required"),
  v.literal("loop_completed"),
  v.literal("loop_failed"),
);

export const discordConversationEventKindValidator = v.union(
  v.literal("human_message"),
  v.literal("assistant_ack"),
  v.literal("assistant_final"),
  v.literal("internal_plan"),
  v.literal("research_started"),
  v.literal("research_completed"),
  v.literal("research_failed"),
  v.literal("surface_changed"),
  v.literal("reset"),
  v.literal("compaction"),
);

export const discordAssistantTurnStageValidator = v.union(
  v.literal("claimed"),
  v.literal("planning"),
  v.literal("planned"),
  v.literal("ack_pending"),
  v.literal("researching"),
  v.literal("research_complete"),
  v.literal("resuming"),
  v.literal("drafted"),
  v.literal("delivery_pending"),
  v.literal("completed"),
  v.literal("suppressed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const positionValidator = v.object({
  symbol: v.string(),
  quantity: v.number(),
  price: v.number(),
  marketValue: v.number(),
  averageCost: v.optional(v.number()),
  dayChange: v.optional(v.number()),
  dayChangePercent: v.optional(v.number()),
});

export const runMetricValidator = v.object({
  provider: v.optional(v.string()),
  model: v.optional(v.string()),
  inputTokens: v.optional(v.number()),
  promptTokens: v.optional(v.number()),
  cacheReadTokens: v.optional(v.number()),
  cacheWriteTokens: v.optional(v.number()),
  cachedTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  estimatedCostUsd: v.optional(v.number()),
  ttftMs: v.optional(v.union(v.number(), v.null())),
  timeToFirstOutputMs: v.optional(v.union(v.number(), v.null())),
  timeToFirstVisibleTextMs: v.optional(v.number()),
  runDurationMs: v.optional(v.number()),
  totalRunDurationMs: v.optional(v.number()),
  approximateOutputTps: v.optional(v.union(v.number(), v.null())),
  outputTokensPerSecond: v.optional(v.number()),
});

export const assistantPartValidator = v.union(
  v.object({ type: v.literal("text"), text: v.string() }),
  v.object({
    type: v.literal("tool"),
    toolCallId: v.string(),
    name: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed"), v.literal("canceled")),
    inputSummary: v.optional(v.string()),
    outputSummary: v.optional(v.string()),
    durationMs: v.optional(v.number()),
  }),
  v.object({ type: v.literal("error"), code: v.string(), message: v.string(), retryable: v.boolean() }),
);

export const finalAssistantMessageValidator = v.object({
  status: v.union(v.literal("completed"), v.literal("failed"), v.literal("canceled")),
  parts: v.array(assistantPartValidator),
  metrics: v.optional(runMetricValidator),
});

export const piEventValidator = v.union(
  v.object({ type: v.literal("text_delta"), text: v.string() }),
  v.object({
    type: v.literal("tool_start"),
    toolCallId: v.string(),
    name: v.string(),
    inputSummary: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("tool_end"),
    toolCallId: v.string(),
    name: v.string(),
    ok: v.boolean(),
    outputSummary: v.optional(v.string()),
    durationMs: v.number(),
  }),
  v.object({ type: v.literal("error"), code: v.string(), message: v.string(), retryable: v.boolean() }),
  v.object({ type: v.literal("canceled") }),
  v.object({ type: v.literal("completed"), metrics: runMetricValidator }),
);

export default defineSchema({
  threads: defineTable({
    ownerId: v.string(),
    stableId: v.string(),
    title: v.string(),
    preview: v.string(),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_archivedAt_updatedAt", ["ownerId", "archivedAt", "updatedAt"])
    .index("by_owner_stableId", ["ownerId", "stableId"]),

  messages: defineTable({
    ownerId: v.string(),
    stableId: v.string(),
    threadId: v.id("threads"),
    runId: v.optional(v.id("runs")),
    ordinal: v.number(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    status: messageStatusValidator,
    text: v.optional(v.string()),
    parts: v.optional(v.array(assistantPartValidator)),
    metrics: v.optional(runMetricValidator),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_stableId", ["ownerId", "stableId"])
    .index("by_runId", ["runId"])
    .index("by_thread_ordinal", ["threadId", "ordinal"]),

  commands: defineTable({
    ownerId: v.string(),
    commandId: v.string(),
    type: commandTypeValidator,
    status: commandStatusValidator,
    requestFingerprint: v.string(),
    threadId: v.optional(v.id("threads")),
    runId: v.optional(v.id("runs")),
    sourceRunId: v.optional(v.id("runs")),
    promptText: v.optional(v.string()),
    title: v.optional(v.string()),
    dispatchAttempts: v.number(),
    lastDispatchError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_commandId", ["ownerId", "commandId"])
    .index("by_commandId", ["commandId"])
    .index("by_runId", ["runId"]),

  runs: defineTable({
    ownerId: v.string(),
    stableId: v.string(),
    commandId: v.string(),
    threadId: v.id("threads"),
    userMessageId: v.id("messages"),
    assistantMessageId: v.id("messages"),
    assistantMessageStableId: v.string(),
    status: runStatusValidator,
    streamStatus: v.union(v.literal("live"), v.literal("finalized")),
    lastAcceptedSequence: v.number(),
    dispatchDeadlineAt: v.optional(v.number()),
    leaseExpiresAt: v.optional(v.number()),
    terminalErrorCode: v.optional(v.string()),
    terminalAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_stableId", ["stableId"])
    .index("by_thread_status", ["threadId", "status"])
    .index("by_status_dispatchDeadlineAt", ["status", "dispatchDeadlineAt"])
    .index("by_status_leaseExpiresAt", ["status", "leaseExpiresAt"]),

  runResultBatches: defineTable({
    runId: v.id("runs"),
    sequence: v.number(),
    payloadHash: v.string(),
    events: v.array(piEventValidator),
    finalMessage: v.optional(finalAssistantMessageValidator),
    terminal: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_runId_sequence", ["runId", "sequence"])
    .index("by_runId", ["runId"]),

  toolActivities: defineTable({
    runId: v.id("runs"),
    assistantMessageId: v.id("messages"),
    toolCallId: v.string(),
    name: v.string(),
    status: toolStatusValidator,
    inputSummary: v.optional(v.string()),
    outputSummary: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_runId", ["runId"])
    .index("by_runId_toolCallId", ["runId", "toolCallId"]),

  brokerConnections: defineTable({
    ownerId: v.string(),
    provider: v.literal("robinhood"),
    status: brokerConnectionStatusValidator,
    label: v.optional(v.string()),
    grantedScopes: v.array(v.string()),
    lastVerifiedAt: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_provider", ["ownerId", "provider"])
    .index("by_owner_updatedAt", ["ownerId", "updatedAt"]),

  credentialVaults: defineTable({
    ownerId: v.string(),
    provider: v.literal("robinhood"),
    credential: v.optional(
      v.object({
        schemaVersion: v.literal(1),
        actorId: v.string(),
        provider: v.literal("robinhood"),
        keyVersion: v.number(),
        algorithm: v.literal("A256GCM"),
        iv: v.string(),
        ciphertext: v.string(),
        authTag: v.string(),
      }),
    ),
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  }).index("by_owner_provider", ["ownerId", "provider"]),

  brokerOAuthTransactions: defineTable({
    ownerId: v.string(),
    provider: v.literal("robinhood"),
    stateHash: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_stateHash", ["stateHash"])
    .index("by_owner_provider", ["ownerId", "provider"])
    .index("by_expiresAt", ["expiresAt"]),

  portfolioSnapshots: defineTable({
    ownerId: v.string(),
    provider: v.literal("robinhood"),
    capturedAt: v.number(),
    totalEquity: v.number(),
    buyingPower: v.number(),
    cash: v.number(),
    dayChange: v.number(),
    dayChangePercent: v.number(),
    positions: v.array(positionValidator),
  })
    .index("by_owner_capturedAt", ["ownerId", "capturedAt"]),

  tradeProposals: defineTable({
    ownerId: v.string(),
    stableId: v.string(),
    threadStableId: v.optional(v.string()),
    runStableId: v.optional(v.string()),
    status: tradeProposalStatusValidator,
    symbol: v.string(),
    side: v.union(v.literal("buy"), v.literal("sell")),
    quantity: v.optional(v.number()),
    notionalUsd: v.optional(v.number()),
    orderType: v.union(v.literal("market"), v.literal("limit"), v.literal("stop"), v.literal("stop_limit")),
    timeInForce: v.union(v.literal("day"), v.literal("gtc")),
    limitPrice: v.optional(v.number()),
    stopPrice: v.optional(v.number()),
    estimatedPrice: v.optional(v.number()),
    estimatedTotal: v.optional(v.number()),
    reviewReference: v.string(),
    fingerprint: v.string(),
    idempotencyKey: v.string(),
    expiresAt: v.number(),
    approvedAt: v.optional(v.number()),
    submittedAt: v.optional(v.number()),
    brokerOrderId: v.optional(v.string()),
    failureCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_stableId", ["ownerId", "stableId"])
    .index("by_owner_updatedAt", ["ownerId", "updatedAt"])
    .index("by_status_expiresAt", ["status", "expiresAt"]),

  auditEvents: defineTable({
    ownerId: v.string(),
    eventType: v.string(),
    subjectId: v.string(),
    outcome: v.union(v.literal("accepted"), v.literal("rejected"), v.literal("failed")),
    details: v.array(v.object({ key: v.string(), value: v.string() })),
    createdAt: v.number(),
  })
    .index("by_owner_createdAt", ["ownerId", "createdAt"])
    .index("by_subject_createdAt", ["subjectId", "createdAt"]),

  discordGateways: defineTable({
    ownerId: v.string(),
    instanceId: v.string(),
    reportedStatus: v.union(v.literal("online"), v.literal("degraded")),
    botUserId: v.optional(v.string()),
    botUserName: v.optional(v.string()),
    connectedAt: v.optional(v.number()),
    lastHeartbeatAt: v.number(),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  discordGuilds: defineTable({
    ownerId: v.string(),
    guildId: v.string(),
    name: v.string(),
    iconUrl: v.optional(v.string()),
    permissions: v.object({
      viewChannels: v.boolean(),
      sendMessages: v.boolean(),
      readMessageHistory: v.boolean(),
      messageContent: v.boolean(),
    }),
    available: v.boolean(),
    lastSeenAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_guild", ["ownerId", "guildId"])
    .index("by_owner_available_name", ["ownerId", "available", "name"]),

  discordChannels: defineTable({
    ownerId: v.string(),
    guildId: v.string(),
    channelId: v.string(),
    name: v.string(),
    type: discordChannelTypeValidator,
    canView: v.boolean(),
    canSend: v.boolean(),
    canReadHistory: v.boolean(),
    roles: v.array(discordChannelRoleValidator),
    available: v.boolean(),
    lastSeenAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_channel", ["ownerId", "channelId"])
    .index("by_owner_guild_channel", ["ownerId", "guildId", "channelId"])
    .index("by_owner_guild_available_name", ["ownerId", "guildId", "available", "name"]),

  discordChannelStates: defineTable({
    ownerId: v.string(),
    guildId: v.string(),
    channelId: v.string(),
    generation: v.number(),
    status: discordLoopStatusValidator,
    latestSequence: v.number(),
    triggerThroughSequence: v.number(),
    completedThroughSequence: v.number(),
    recheckCount: v.number(),
    recheckPending: v.boolean(),
    lastRecheckHash: v.optional(v.string()),
    activeRunId: v.optional(v.string()),
    activeClaimId: v.optional(v.string()),
    activeWorkerId: v.optional(v.string()),
    activeMode: v.optional(v.union(v.literal("messages"), v.literal("recheck"))),
    activeWindowStart: v.optional(v.number()),
    activeWindowEnd: v.optional(v.number()),
    activeContextHash: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    lastProcessedAt: v.optional(v.number()),
    nextEligibleAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    consecutiveErrorCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_channel", ["ownerId", "channelId"])
    .index("by_owner_status_updatedAt", ["ownerId", "status", "updatedAt"]),

  discordMessages: defineTable({
    ownerId: v.string(),
    guildId: v.string(),
    channelId: v.string(),
    messageId: v.string(),
    sequence: v.number(),
    authorId: v.string(),
    authorName: v.string(),
    content: v.string(),
    images: v.optional(v.array(discordImageAttachmentValidator)),
    mentionsBot: v.optional(v.boolean()),
    isBot: v.boolean(),
    replyToMessageId: v.optional(v.string()),
    nonce: v.optional(v.string()),
    payloadHash: v.optional(v.string()),
    createdAt: v.number(),
    receivedAt: v.number(),
  })
    .index("by_owner_channel_message", ["ownerId", "channelId", "messageId"])
    .index("by_owner_channel_sequence", ["ownerId", "channelId", "sequence"])
    .index("by_owner_nonce", ["ownerId", "nonce"]),

  discordAssistantConversations: defineTable({
    ownerId: v.string(),
    ownerBindingVersion: v.number(),
    guildId: v.string(),
    conversationId: v.string(),
    epoch: v.number(),
    generation: v.number(),
    routingGeneration: v.number(),
    revision: v.number(),
    humanRevision: v.number(),
    nextOrdinal: v.number(),
    conversationChannelId: v.optional(v.string()),
    researchLogChannelId: v.optional(v.string()),
    activeTurnId: v.optional(v.string()),
    activeRunId: v.optional(v.string()),
    activeLeaseToken: v.optional(v.string()),
    activeLeaseWorkerId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    activeCheckpointId: v.optional(v.string()),
    personalityVersion: v.string(),
    systemPromptHash: v.string(),
    capabilityProfileHash: v.string(),
    lunaModel: v.string(),
    lunaReasoningEffort: v.string(),
    lunaServiceTier: v.string(),
    solModel: v.string(),
    solReasoningEffort: v.string(),
    solServiceTier: v.string(),
    migrationWatermarkSequence: v.number(),
    privacyDeletedAt: v.optional(v.number()),
    privacyReconciliationAfterMessageId: v.optional(v.string()),
    lastSuccessfulActivityAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_guild", ["guildId"])
    .index("by_owner_guild", ["ownerId", "guildId"])
    .index("by_conversation", ["conversationId"]),

  discordConversationEvents: defineTable({
    ownerId: v.string(),
    ownerBindingVersion: v.number(),
    guildId: v.string(),
    conversationId: v.string(),
    epoch: v.number(),
    eventId: v.string(),
    ordinal: v.number(),
    revision: v.number(),
    humanRevision: v.number(),
    turnId: v.optional(v.string()),
    runId: v.optional(v.string()),
    kind: discordConversationEventKindValidator,
    visibility: v.union(
      v.literal("conversation"),
      v.literal("research_log"),
      v.literal("internal"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("committed"),
      v.literal("superseded"),
      v.literal("failed"),
    ),
    sourceChannelId: v.optional(v.string()),
    sourceMessageId: v.optional(v.string()),
    sourceSequence: v.optional(v.number()),
    authorId: v.optional(v.string()),
    authorName: v.optional(v.string()),
    authorIsBot: v.optional(v.boolean()),
    content: v.optional(v.string()),
    contextHash: v.string(),
    researchArtifactId: v.optional(v.string()),
    discordDeliveryId: v.optional(v.string()),
    freshness: v.optional(v.union(
      v.literal("current"),
      v.literal("limited"),
      v.literal("unknown"),
    )),
    createdAt: v.number(),
    committedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_conversation_epoch_ordinal", ["conversationId", "epoch", "ordinal"])
    .index("by_conversation_source", ["conversationId", "epoch", "sourceChannelId", "sourceMessageId"])
    .index("by_conversation_delivery", ["conversationId", "epoch", "discordDeliveryId"])
    .index("by_owner_event", ["ownerId", "eventId"]),

  discordAssistantTurns: defineTable({
    ownerId: v.string(),
    ownerBindingVersion: v.number(),
    guildId: v.string(),
    conversationId: v.string(),
    epoch: v.number(),
    turnId: v.string(),
    runId: v.string(),
    sourceChannelId: v.string(),
    targetMessageId: v.optional(v.string()),
    windowStart: v.number(),
    windowEnd: v.number(),
    triggerKind: v.union(v.literal("ambient"), v.literal("mention"), v.literal("recheck")),
    channelGeneration: v.number(),
    conversationGeneration: v.number(),
    routingGeneration: v.number(),
    baseRevision: v.number(),
    baseHumanRevision: v.number(),
    inputContextHash: v.string(),
    stage: discordAssistantTurnStageValidator,
    planRequestId: v.string(),
    researchRequestId: v.optional(v.string()),
    resumeRequestId: v.optional(v.string()),
    acknowledgementIdempotencyKey: v.optional(v.string()),
    replyIdempotencyKey: v.optional(v.string()),
    planAction: v.optional(v.string()),
    planReasonCode: v.optional(v.string()),
    planPayload: v.optional(v.string()),
    researchArtifactId: v.optional(v.string()),
    researchPacketHash: v.optional(v.string()),
    eligibleThroughSequence: v.optional(v.number()),
    eligibleHumanRevision: v.optional(v.number()),
    eligibleContextHash: v.optional(v.string()),
    nextExplicitTriggerSequence: v.optional(v.number()),
    finalAction: v.optional(v.string()),
    replyHash: v.optional(v.string()),
    resumePayload: v.optional(v.string()),
    resumeAttempts: v.optional(v.array(v.string())),
    acknowledgementDelivery: v.optional(v.string()),
    deliveryState: v.optional(v.string()),
    lunaModel: v.string(),
    lunaReasoningEffort: v.string(),
    lunaServiceTier: v.string(),
    personalityVersion: v.string(),
    systemPromptHash: v.string(),
    capabilityProfileHash: v.string(),
    autonomousPass: v.number(),
    failureCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_owner_turn", ["ownerId", "turnId"])
    .index("by_conversation_epoch_stage", ["conversationId", "epoch", "stage"])
    .index("by_owner_run", ["ownerId", "runId"]),

  discordResearchArtifacts: defineTable({
    ownerId: v.string(),
    ownerBindingVersion: v.number(),
    guildId: v.string(),
    conversationId: v.string(),
    epoch: v.number(),
    turnId: v.string(),
    runId: v.string(),
    requestId: v.string(),
    normalizedResearchRequest: v.string(),
    packet: v.optional(v.string()),
    failureCode: v.optional(v.string()),
    failureDetail: v.optional(v.string()),
    failureRetryable: v.optional(v.boolean()),
    workerModel: v.string(),
    reasoningEffort: v.string(),
    serviceTier: v.string(),
    profileVersion: v.string(),
    toolPolicyHash: v.string(),
    inputContextHash: v.string(),
    freshness: v.optional(v.string()),
    sourceUrls: v.array(v.string()),
    trustedChartArtifactId: v.optional(v.string()),
    trustedChartSpec: v.optional(v.string()),
    serializedBytes: v.number(),
    estimatedTokens: v.number(),
    tokenEstimatorVersion: v.string(),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_request", ["ownerId", "requestId"])
    .index("by_conversation_epoch_turn", ["conversationId", "epoch", "turnId"]),

  discordCompactionCheckpoints: defineTable({
    ownerId: v.string(),
    ownerBindingVersion: v.number(),
    guildId: v.string(),
    conversationId: v.string(),
    epoch: v.number(),
    checkpointId: v.string(),
    schemaVersion: v.number(),
    implementationVersion: v.string(),
    provider: v.string(),
    model: v.string(),
    personalityVersion: v.string(),
    systemPromptHash: v.string(),
    capabilityProfileHash: v.string(),
    toolPolicyHash: v.string(),
    compactedThroughOrdinal: v.number(),
    sourceRevision: v.number(),
    sourceContextHash: v.string(),
    portableSummary: v.string(),
    retainedRecentEventIds: v.array(v.string()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    estimatedSavedTokens: v.number(),
    serializedBytes: v.number(),
    storageProtection: v.literal("platform_default_unverified"),
    status: v.union(
      v.literal("candidate"),
      v.literal("active"),
      v.literal("superseded"),
      v.literal("invalid"),
      v.literal("expired"),
    ),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_checkpoint", ["ownerId", "checkpointId"])
    .index("by_conversation_epoch_status", ["conversationId", "epoch", "status"])
    .index("by_status_expiresAt", ["status", "expiresAt"]),

  discordLoopRuns: defineTable({
    ownerId: v.string(),
    guildId: v.string(),
    channelId: v.string(),
    runId: v.string(),
    claimId: v.string(),
    workerId: v.string(),
    generation: v.number(),
    mode: v.union(v.literal("messages"), v.literal("recheck")),
    status: v.union(
      v.literal("triaging"),
      v.literal("acknowledging"),
      v.literal("researching"),
      v.literal("drafting"),
      v.literal("catching_up"),
      v.literal("completed"),
      v.literal("error"),
      v.literal("stale"),
    ),
    windowStart: v.number(),
    windowEnd: v.number(),
    contextHash: v.string(),
    recheckCount: v.number(),
    leaseExpiresAt: v.number(),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_run", ["ownerId", "runId"])
    .index("by_owner_claim", ["ownerId", "claimId"])
    .index("by_owner_channel_startedAt", ["ownerId", "channelId", "startedAt"]),

  discordOutbox: defineTable({
    ownerId: v.string(),
    ownerBindingVersion: v.optional(v.number()),
    conversationId: v.optional(v.string()),
    epoch: v.optional(v.number()),
    conversationGeneration: v.optional(v.number()),
    routingGeneration: v.optional(v.number()),
    conversationLeaseToken: v.optional(v.string()),
    turnId: v.optional(v.string()),
    canonicalEventId: v.optional(v.string()),
    canonicalOrdinal: v.optional(v.number()),
    sourceGuildId: v.string(),
    sourceChannelId: v.string(),
    guildId: v.string(),
    channelId: v.string(),
    outboxId: v.string(),
    idempotencyKey: v.string(),
    nonce: v.optional(v.string()),
    payloadHash: v.optional(v.string()),
    runId: v.string(),
    generation: v.number(),
    replyKind: v.optional(discordReplyKindValidator),
    content: v.string(),
    chart: v.optional(discordMarketChartValidator),
    replyToMessageId: v.optional(v.string()),
    consumesThroughSequence: v.optional(v.number()),
    recheckRequested: v.boolean(),
    finalizesLoop: v.boolean(),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("finalized"),
      v.literal("failed"),
      v.literal("delivery_uncertain"),
      v.literal("needs_reconciliation"),
      v.literal("cancelled"),
    ),
    attempts: v.number(),
    deliveryWorkerId: v.optional(v.string()),
    deliveryToken: v.optional(v.string()),
    deliveryLeaseExpiresAt: v.optional(v.number()),
    discordMessageId: v.optional(v.string()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    sentAt: v.optional(v.number()),
    uncertainAt: v.optional(v.number()),
  })
    .index("by_owner_outbox", ["ownerId", "outboxId"])
    .index("by_owner_idempotency", ["ownerId", "idempotencyKey"])
    .index("by_owner_status_createdAt", ["ownerId", "status", "createdAt"])
    .index("by_owner_source_reply", ["ownerId", "sourceChannelId", "replyToMessageId"])
    .index("by_owner_run", ["ownerId", "runId"])
    .index("by_owner_nonce", ["ownerId", "nonce"])
    .index("by_conversation_epoch", ["conversationId", "epoch"]),

  discordActivityEvents: defineTable({
    ownerId: v.string(),
    eventId: v.string(),
    guildId: v.string(),
    channelId: v.string(),
    runId: v.optional(v.string()),
    eventType: discordActivityEventTypeValidator,
    stage: v.optional(discordLoopStatusValidator),
    replyKind: v.optional(discordReplyKindValidator),
    createdAt: v.number(),
  })
    .index("by_owner_event", ["ownerId", "eventId"])
    .index("by_owner_createdAt", ["ownerId", "createdAt"])
    .index("by_owner_guild_createdAt", ["ownerId", "guildId", "createdAt"]),

});
