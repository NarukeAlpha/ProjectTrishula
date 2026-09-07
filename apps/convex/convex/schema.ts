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
  v.literal("loop_completed"),
  v.literal("loop_failed"),
);

export const marketResearchSafeErrorValidator = v.union(
  v.literal("market_research_disabled"),
  v.literal("forum_not_configured"),
  v.literal("forum_wrong_channel_type"),
  v.literal("forum_permissions_incomplete"),
  v.literal("edition_already_exists"),
  v.literal("edition_lease_lost"),
  v.literal("exa_not_configured"),
  v.literal("exa_auth_failed"),
  v.literal("exa_budget_exhausted"),
  v.literal("exa_rate_limited"),
  v.literal("exa_unavailable"),
  v.literal("exa_invalid_request"),
  v.literal("exa_connect_zdr_incompatible"),
  v.literal("source_rights_blocked"),
  v.literal("source_unavailable"),
  v.literal("market_data_not_configured"),
  v.literal("market_data_stale"),
  v.literal("market_data_conflict"),
  v.literal("market_data_unavailable"),
  v.literal("market_session_calendar_stale"),
  v.literal("session_unknown"),
  v.literal("evidence_below_minimum"),
  v.literal("composition_auth_required"),
  v.literal("composition_provider_not_ready"),
  v.literal("composition_timeout"),
  v.literal("composition_schema_invalid"),
  v.literal("composition_citation_invalid"),
  v.literal("chart_unavailable"),
  v.literal("chart_artifact_expired"),
  v.literal("discord_thread_create_failed"),
  v.literal("discord_thread_reconcile_failed"),
  v.literal("discord_thread_reconcile_ambiguous"),
  v.literal("discord_reply_failed"),
  v.literal("discord_permission_failed"),
  v.literal("discord_rate_limited"),
  v.literal("late_cutoff_exceeded"),
);

export const marketResearchSourcePolicyValidator = v.union(
  v.literal("approved"),
  v.literal("evaluation_only"),
  v.literal("permission_required"),
  v.literal("blocked"),
  v.literal("unavailable"),
);

export const marketResearchRequestedSourceValidator = v.union(
  v.literal("FinancialJuice"),
  v.literal("Barchart"),
  v.literal("ForexFactory"),
  v.literal("Yahoo"),
  v.literal("TradingView"),
);

export const marketResearchPreferencesValidator = v.object({
  schemaVersion: v.literal(1),
  preferenceId: v.string(),
  scheduleId: v.string(),
  ownerId: v.string(),
  guildId: v.string(),
  enabled: v.boolean(),
  forumChannelId: v.union(v.string(), v.null()),
  forumTagIds: v.array(v.string()),
  timezone: v.string(),
  timezoneConfirmed: v.boolean(),
  displayTimezones: v.array(v.string()),
  localHour: v.number(),
  localMinute: v.number(),
  primarySymbols: v.array(v.string()),
  symbolPriorities: v.array(v.object({ symbol: v.string(), priority: v.number() })),
  sectorSymbols: v.array(v.string()),
  discoverySymbols: v.array(v.string()),
  followedSectors: v.array(v.string()),
  trackedThemes: v.array(v.string()),
  macroTopics: v.array(v.string()),
  eventCategories: v.array(v.string()),
  preferredDomains: v.array(v.string()),
  excludedDomains: v.array(v.string()),
  requestedSources: v.array(marketResearchRequestedSourceValidator),
  reportSections: v.object({
    overnightMacro: v.boolean(),
    crossAsset: v.boolean(),
    indexSector: v.boolean(),
    calendar: v.boolean(),
    primaryBoard: v.literal(true),
    challengers: v.boolean(),
    tickerDossiers: v.boolean(),
    validation: v.boolean(),
    afterOpen: v.boolean(),
    requestedSources: v.boolean(),
    dataQuality: v.literal(true),
    sources: v.literal(true),
  }),
  maximumRankedSetups: v.number(),
  editionDepth: v.union(v.literal("full"), v.literal("concise")),
  includeWeekends: v.boolean(),
  includeCharts: v.boolean(),
  chartsAcceptancePassed: v.boolean(),
  maximumCharts: v.number(),
  lateEditionCutoffLocalTime: v.string(),
  searchRequestBudget: v.number(),
  contentsPageBudget: v.number(),
  exaMaxCostUsd: v.optional(v.number()),
  marketDataProviderId: v.union(v.string(), v.null()),
  marketSessionCalendarId: v.string(),
  durableTheses: v.array(v.object({
    thesisId: v.string(),
    symbol: v.string(),
    text: v.string(),
    priority: v.number(),
    keyLevels: v.array(v.number()),
    invalidation: v.string(),
    expiresAt: v.union(v.string(), v.null()),
    status: v.union(v.literal("active"), v.literal("expired"), v.literal("invalidated")),
  })),
  sourcePolicyVersion: v.string(),
  promptVersion: v.string(),
  revision: v.number(),
  createdAt: v.string(),
  updatedAt: v.string(),
});

export const marketResearchEditionStatusValidator = v.union(
  v.literal("queued"),
  v.literal("collecting"),
  v.literal("researching"),
  v.literal("calculating"),
  v.literal("composing"),
  v.literal("ready_to_publish"),
  v.literal("creating_thread"),
  v.literal("publishing_replies"),
  v.literal("published"),
  v.literal("retry_wait"),
  v.literal("partial"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("skipped_late"),
);

export const marketResearchStageValidator = v.union(
  v.literal("queued"),
  v.literal("collecting"),
  v.literal("researching"),
  v.literal("calculating"),
  v.literal("composing"),
  v.literal("ready_to_publish"),
  v.literal("creating_thread"),
  v.literal("publishing_replies"),
  v.literal("published"),
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
    canCreateForumPost: v.boolean(),
    canSendInThreads: v.boolean(),
    canReadThreadHistory: v.boolean(),
    canAttachFiles: v.boolean(),
    requiresTag: v.boolean(),
    availableTags: v.array(v.object({
      id: v.string(),
      name: v.string(),
      moderated: v.boolean(),
      emoji: v.optional(v.string()),
    })),
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
    createdAt: v.number(),
    receivedAt: v.number(),
  })
    .index("by_owner_channel_message", ["ownerId", "channelId", "messageId"])
    .index("by_owner_channel_sequence", ["ownerId", "channelId", "sequence"]),

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
    sourceGuildId: v.string(),
    sourceChannelId: v.string(),
    guildId: v.string(),
    channelId: v.string(),
    outboxId: v.string(),
    idempotencyKey: v.string(),
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
  })
    .index("by_owner_outbox", ["ownerId", "outboxId"])
    .index("by_owner_idempotency", ["ownerId", "idempotencyKey"])
    .index("by_owner_status_createdAt", ["ownerId", "status", "createdAt"])
    .index("by_owner_source_reply", ["ownerId", "sourceChannelId", "replyToMessageId"])
    .index("by_owner_run", ["ownerId", "runId"]),

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

  marketResearchPreferences: defineTable({
    ...marketResearchPreferencesValidator.fields,
    configurationSnapshotHash: v.string(),
  })
    .index("by_owner_guild", ["ownerId", "guildId"])
    .index("by_enabled_updatedAt", ["enabled", "updatedAt"]),

  marketResearchEditions: defineTable({
    ownerId: v.string(),
    guildId: v.string(),
    scheduleId: v.string(),
    forumChannelId: v.string(),
    editionId: v.string(),
    scheduledKey: v.string(),
    editionRevision: v.number(),
    baseEditionId: v.optional(v.string()),
    editionDate: v.string(),
    timezone: v.string(),
    sessionType: v.union(
      v.literal("OPEN"),
      v.literal("EARLY_CLOSE"),
      v.literal("CLOSED"),
      v.literal("UNKNOWN"),
    ),
    editionLabel: v.union(
      v.literal("Morning Market Newspaper"),
      v.literal("Weekend Outlook"),
      v.literal("Market Holiday Outlook"),
      v.literal("Late Edition"),
      v.literal("Data unavailable"),
    ),
    calendarVersion: v.string(),
    sessionSourceIds: v.array(v.string()),
    previousSessionDate: v.union(v.string(), v.null()),
    previousSessionClose: v.union(v.string(), v.null()),
    nextSessionDate: v.union(v.string(), v.null()),
    trigger: v.union(
      v.literal("scheduled"),
      v.literal("manual_publish"),
      v.literal("retry"),
      v.literal("regeneration"),
    ),
    status: marketResearchEditionStatusValidator,
    stage: marketResearchStageValidator,
    configurationRevision: v.number(),
    configurationSnapshotHash: v.string(),
    resultFingerprint: v.optional(v.string()),
    configurationSnapshot: marketResearchPreferencesValidator,
    promptVersion: v.string(),
    sourcePolicyVersion: v.string(),
    workerId: v.optional(v.string()),
    claimId: v.optional(v.string()),
    generation: v.number(),
    leaseExpiresAt: v.optional(v.number()),
    publicationGeneration: v.number(),
    publicationWorkerId: v.optional(v.string()),
    publicationToken: v.optional(v.string()),
    publicationLeaseExpiresAt: v.optional(v.number()),
    attempts: v.number(),
    nextAttemptAt: v.optional(v.number()),
    resumeFrom: v.optional(marketResearchStageValidator),
    exaRequestCount: v.number(),
    exaCostUsd: v.number(),
    sourceCount: v.number(),
    acceptedSourceCount: v.number(),
    threadId: v.optional(v.string()),
    starterMessageId: v.optional(v.string()),
    forumTitle: v.optional(v.string()),
    expectedPartCount: v.optional(v.number()),
    sentPartCount: v.optional(v.number()),
    lastErrorCode: v.optional(marketResearchSafeErrorValidator),
    lastErrorMessage: v.optional(v.string()),
    scheduledFor: v.number(),
    cutoffAt: v.number(),
    startedAt: v.optional(v.number()),
    composedAt: v.optional(v.number()),
    publishedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_scheduledKey_revision", ["ownerId", "scheduledKey", "editionRevision"])
    .index("by_status_nextAttemptAt", ["status", "nextAttemptAt"])
    .index("by_owner_guild_editionDate", ["ownerId", "guildId", "editionDate"])
    .index("by_status_leaseExpiresAt", ["status", "leaseExpiresAt"])
    .index("by_status_publicationLeaseExpiresAt", ["status", "publicationLeaseExpiresAt"])
    .index("by_leaseExpiresAt", ["leaseExpiresAt"])
    .index("by_editionId", ["editionId"]),

  marketResearchEvidence: defineTable({
    editionId: v.string(),
    evidenceId: v.string(),
    checkpointSequence: v.number(),
    kind: v.union(
      v.literal("news"), v.literal("official"), v.literal("quote"), v.literal("bar"),
      v.literal("calculation"), v.literal("calendar"), v.literal("corporate_action"),
      v.literal("source_status"),
    ),
    provider: v.string(),
    sourcePolicy: marketResearchSourcePolicyValidator,
    title: v.optional(v.string()),
    url: v.optional(v.string()),
    canonicalUrlHash: v.optional(v.string()),
    author: v.optional(v.string()),
    publishedAt: v.optional(v.string()),
    providerTimestamp: v.optional(v.string()),
    retrievedAt: v.string(),
    sessionLabel: v.optional(v.union(
      v.literal("premarket"), v.literal("regular"), v.literal("after_hours"),
      v.literal("closed"), v.literal("unknown"),
    )),
    freshness: v.union(v.literal("fresh"), v.literal("cached"), v.literal("delayed"), v.literal("stale"), v.literal("unknown")),
    contentStatus: v.union(
      v.literal("available"), v.literal("cached"), v.literal("delayed"), v.literal("stale"),
      v.literal("unknown"), v.literal("blocked"), v.literal("failed"),
    ),
    highlights: v.array(v.string()),
    normalizedClaims: v.array(v.string()),
    requestId: v.optional(v.string()),
    costUsd: v.optional(v.number()),
    contentHash: v.string(),
    retentionExpiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_edition_evidenceId", ["editionId", "evidenceId"])
    .index("by_edition_kind", ["editionId", "kind"])
    .index("by_edition_canonicalUrlHash", ["editionId", "canonicalUrlHash"])
    .index("by_edition_checkpointSequence", ["editionId", "checkpointSequence"])
    .index("by_retentionExpiresAt", ["retentionExpiresAt"]),

  marketResearchSections: defineTable({
    editionId: v.string(),
    sectionId: v.string(),
    sequence: v.number(),
    kind: v.string(),
    heading: v.string(),
    markdown: v.string(),
    sourceIds: v.array(v.string()),
    chartRequestsJson: v.string(),
    createdAt: v.number(),
  }).index("by_edition_sequence", ["editionId", "sequence"]),

  marketResearchDeliveries: defineTable({
    editionId: v.string(),
    ownerId: v.string(),
    deliveryId: v.string(),
    idempotencyKey: v.string(),
    sequence: v.number(),
    kind: v.union(v.literal("starter"), v.literal("reply")),
    content: v.string(),
    contentHash: v.string(),
    sourceSectionIds: v.array(v.string()),
    chartAttachmentIds: v.array(v.string()),
    status: v.union(v.literal("pending"), v.literal("sending"), v.literal("sent"), v.literal("failed")),
    attempts: v.number(),
    deliveryWorkerId: v.optional(v.string()),
    deliveryToken: v.optional(v.string()),
    deliveryLeaseExpiresAt: v.optional(v.number()),
    discordThreadId: v.optional(v.string()),
    discordMessageId: v.optional(v.string()),
    nonce: v.string(),
    lastErrorCode: v.optional(marketResearchSafeErrorValidator),
    lastErrorMessage: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_edition_sequence", ["editionId", "sequence"])
    .index("by_deliveryId", ["deliveryId"])
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_owner_status_createdAt", ["ownerId", "status", "createdAt"])
    .index("by_owner_status_nextAttemptAt", ["ownerId", "status", "nextAttemptAt"])
    .index("by_status_nextAttemptAt", ["status", "nextAttemptAt"])
    .index("by_status_deliveryLeaseExpiresAt", ["status", "deliveryLeaseExpiresAt"])
    .index("by_deliveryLeaseExpiresAt", ["deliveryLeaseExpiresAt"]),

  marketResearchEvents: defineTable({
    eventId: v.string(),
    editionId: v.string(),
    ownerId: v.string(),
    guildId: v.string(),
    eventType: v.string(),
    stage: v.optional(marketResearchStageValidator),
    safeCode: v.optional(marketResearchSafeErrorValidator),
    details: v.array(v.object({ key: v.string(), value: v.string() })),
    createdAt: v.number(),
  })
    .index("by_edition_createdAt", ["editionId", "createdAt"])
    .index("by_owner_createdAt", ["ownerId", "createdAt"]),

  marketResearchPreviews: defineTable({
    previewId: v.string(),
    ownerId: v.string(),
    guildId: v.string(),
    configurationSnapshotHash: v.string(),
    configurationSnapshot: marketResearchPreferencesValidator,
    requestedAt: v.number(),
    scheduledFor: v.number(),
    sessionType: v.union(
      v.literal("OPEN"),
      v.literal("EARLY_CLOSE"),
      v.literal("CLOSED"),
      v.literal("UNKNOWN"),
    ),
    editionLabel: v.union(
      v.literal("Morning Market Newspaper"),
      v.literal("Weekend Outlook"),
      v.literal("Market Holiday Outlook"),
      v.literal("Late Edition"),
      v.literal("Data unavailable"),
    ),
    editionDate: v.string(),
    timezone: v.string(),
    calendarVersion: v.string(),
    sessionSourceIds: v.array(v.string()),
    previousSessionDate: v.union(v.string(), v.null()),
    previousSessionClose: v.union(v.string(), v.null()),
    nextSessionDate: v.union(v.string(), v.null()),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("completed"), v.literal("failed")),
    stage: marketResearchStageValidator,
    generation: v.number(),
    attempts: v.number(),
    workerId: v.optional(v.string()),
    claimId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    evidenceJson: v.string(),
    editionJson: v.optional(v.string()),
    resultFingerprint: v.optional(v.string()),
    safeFailure: v.optional(marketResearchSafeErrorValidator),
    qualitySummary: v.array(v.string()),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_previewId", ["previewId"])
    .index("by_owner_previewId", ["ownerId", "previewId"])
    .index("by_expiresAt", ["expiresAt"])
    .index("by_status_expiresAt", ["status", "expiresAt"])
    .index("by_status_leaseExpiresAt", ["status", "leaseExpiresAt"]),

  marketSessionCalendars: defineTable({
    ownerId: v.string(),
    calendarId: v.string(),
    version: v.string(),
    sourceUrl: v.string(),
    retrievedAt: v.number(),
    effectiveStart: v.string(),
    effectiveEnd: v.string(),
    contentHash: v.string(),
    sessions: v.array(v.object({
      date: v.string(),
      status: v.union(v.literal("OPEN"), v.literal("EARLY_CLOSE"), v.literal("CLOSED")),
      regularOpen: v.optional(v.string()),
      regularClose: v.optional(v.string()),
      earlyClose: v.optional(v.string()),
    })),
    reviewed: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_calendar_version", ["ownerId", "calendarId", "version"])
    .index("by_owner_calendar_updatedAt", ["ownerId", "calendarId", "updatedAt"])
    .index("by_effectiveEnd", ["effectiveEnd"]),

  marketSessionOverrides: defineTable({
    overrideId: v.string(),
    calendarId: v.string(),
    ownerId: v.string(),
    date: v.string(),
    status: v.union(v.literal("OPEN"), v.literal("EARLY_CLOSE"), v.literal("CLOSED")),
    regularOpen: v.optional(v.string()),
    regularClose: v.optional(v.string()),
    earlyClose: v.optional(v.string()),
    reason: v.string(),
    sourceUrl: v.string(),
    effectiveStart: v.number(),
    effectiveEnd: v.number(),
    createdAt: v.number(),
  })
    .index("by_owner_overrideId", ["ownerId", "overrideId"])
    .index("by_owner_calendar_date", ["ownerId", "calendarId", "date"])
    .index("by_owner_createdAt", ["ownerId", "createdAt"]),

});
