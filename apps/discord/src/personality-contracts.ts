import { z } from "zod";
import {
  agentChannelSchema,
  agentMessageSchema,
  discordTriggerKindSchema,
  snowflakeSchema,
  stableIdSchema,
} from "./contracts.js";
import {
  DISCORD_ACKNOWLEDGEMENT_MAX_CHARACTERS,
  DISCORD_FINAL_REPLY_MAX_CHARACTERS,
  normalizeDiscordContent,
  validDiscordContent,
} from "./content.js";
import { marketChartSpecSchema } from "./media/market-chart.js";

function content(maximum: number) {
  return z.string().refine(
    (value) => validDiscordContent(value, maximum),
    `Discord content must contain at most ${maximum} Unicode characters.`,
  ).transform(normalizeDiscordContent);
}

const isoDateTime = z.iso.datetime({ offset: true });
const httpsUrl = z.url().refine((value) => new URL(value).protocol === "https:");

export const conversationIdentitySchema = z
  .object({
    ownerId: stableIdSchema,
    ownerBindingVersion: z.number().int().positive(),
    guildId: snowflakeSchema,
    conversationId: z.string().regex(/^discord:\d{1,32}$/),
    epoch: z.number().int().nonnegative(),
    turnId: stableIdSchema,
    runId: stableIdSchema,
    generation: z.number().int().positive(),
    routingGeneration: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    humanRevision: z.number().int().nonnegative(),
    personalityVersion: stableIdSchema,
    systemPromptHash: z.string().regex(/^[a-f0-9]{64}$/),
    capabilityProfileHash: z.string().regex(/^[a-f0-9]{64}$/),
    activeCheckpointId: stableIdSchema.optional(),
  })
  .strict()
  .superRefine((identity, context) => {
    if (identity.conversationId !== `discord:${identity.guildId}`) {
      context.addIssue({ code: "custom", path: ["conversationId"], message: "Guild conversation mismatch." });
    }
  });

const sourceEventIds = z.array(stableIdSchema).min(1).max(64);
export const portableConversationSummarySchema = z.object({
  participants: z.array(z.object({
    authorId: snowflakeSchema,
    displayName: z.string().trim().min(1).max(100).optional(),
  }).strict()).max(100),
  acceptedFacts: z.array(z.object({
    statement: z.string().trim().min(1).max(1_000),
    subjectAuthorId: snowflakeSchema.optional(),
    assertedByAuthorId: snowflakeSchema.optional(),
    sourceEventIds,
    asOf: isoDateTime.optional(),
    freshness: z.enum(["current", "limited", "unknown"]).optional(),
  }).strict()).max(100),
  corrections: z.array(z.object({
    rejectedStatement: z.string().trim().min(1).max(1_000),
    replacementStatement: z.string().trim().min(1).max(1_000),
    correctedByAuthorId: snowflakeSchema.optional(),
    sourceEventIds,
    asOf: isoDateTime.optional(),
  }).strict()).max(100),
  unresolvedQuestions: z.array(z.object({
    question: z.string().trim().min(1).max(1_000),
    askedByAuthorId: snowflakeSchema,
    sourceEventIds,
  }).strict()).max(100),
  commitments: z.array(z.object({
    statement: z.string().trim().min(1).max(1_000),
    owner: z.union([
      z.object({ kind: z.literal("assistant") }).strict(),
      z.object({ kind: z.literal("participant"), authorId: snowflakeSchema }).strict(),
    ]),
    status: z.enum(["open", "resolved", "cancelled"]),
    sourceEventIds,
  }).strict()).max(100),
  conversationPreferences: z.array(z.object({
    statement: z.string().trim().min(1).max(1_000),
    authorId: snowflakeSchema,
    sourceEventIds,
  }).strict()).max(100),
  sourceFreshnessNotes: z.array(z.object({
    statement: z.string().trim().min(1).max(1_000),
    sourceEventIds,
    asOf: isoDateTime.optional(),
    freshness: z.enum(["current", "limited", "unknown"]),
  }).strict()).max(100),
}).strict();

export const durableConversationContextSchema = z.object({
  sourceRevision: z.number().int().nonnegative(),
  sourceHumanRevision: z.number().int().nonnegative(),
  activeCheckpointId: stableIdSchema.optional(),
  portableSummary: portableConversationSummarySchema.optional(),
  recentEvents: z.array(z.object({
    eventId: stableIdSchema,
    ordinal: z.number().int().positive(),
    role: z.enum(["human", "assistant"]),
    authorId: snowflakeSchema.optional(),
    displayName: z.string().trim().min(1).max(100).optional(),
    content: z.string().max(8_000),
    createdAt: isoDateTime,
  }).strict()).max(2_000),
  tail: z.object({
    estimatorVersion: z.literal("utf8-bytes-div-3-plus-message-overhead:v1"),
    tokenBudget: z.number().int().positive(),
    estimatedTokens: z.number().int().nonnegative(),
    compactedThroughOrdinal: z.number().int().nonnegative(),
    omittedEventCount: z.number().int().nonnegative(),
    firstRetainedOrdinal: z.number().int().positive().optional(),
    lastRetainedOrdinal: z.number().int().positive().optional(),
    complete: z.boolean(),
  }).strict(),
}).strict();

export const frontmanResearchRequestSchema = z.object({
  question: z.string().trim().min(1).max(1_000),
  decisionContext: z.string().trim().min(1).max(2_000),
  requiredFacts: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
  freshnessRequirement: z.string().trim().min(1).max(500),
  preferredPrimarySources: z.array(z.string().trim().min(1).max(300)).max(12),
  requestedChart: z.object({
    symbol: z.string().trim().min(1).max(20),
    timeframe: z.string().trim().min(1).max(40),
    interval: z.string().trim().min(1).max(20),
    thesis: z.string().trim().min(1).max(500),
  }).strict().optional(),
}).strict();

const common = {
  requestId: stableIdSchema,
  channel: agentChannelSchema,
  messages: z.array(agentMessageSchema).min(1).max(10),
  conversation: conversationIdentitySchema,
};
const durableCommon = {
  ...common,
  durableContext: durableConversationContextSchema,
};

export const frontmanPlanRequestSchema = z.object({
  ...durableCommon,
  profile: z.literal("frontman_plan"),
  triggerKind: discordTriggerKindSchema,
}).strict().superRefine((request, context) => {
  if (request.channel.guildId !== request.conversation.guildId) {
    context.addIssue({
      code: "custom",
      path: ["channel", "guildId"],
      message: "Channel guild must match the trusted conversation guild.",
    });
  }
});

export const frontmanPlanResponseSchema = z.object({
  profile: z.literal("frontman_plan"),
  action: z.enum(["silent", "reply", "clarify", "research"]),
  targetMessageId: snowflakeSchema,
  confidence: z.number().min(0).max(1),
  additiveValue: z.number().min(0).max(1),
  reasonCode: z.enum([
    "explicit_stable", "explicit_needs_clarification", "explicit_needs_freshness",
    "ambient_material_value", "ambient_already_answered", "ambient_low_value",
    "unsafe_or_unsupported",
  ]),
  reply: content(DISCORD_FINAL_REPLY_MAX_CHARACTERS).optional(),
  acknowledgement: content(DISCORD_ACKNOWLEDGEMENT_MAX_CHARACTERS).optional(),
  researchRequest: frontmanResearchRequestSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.action === "silent" && (value.reply !== undefined || value.acknowledgement !== undefined || value.researchRequest !== undefined)) {
    context.addIssue({ code: "custom", message: "Silent plan includes output." });
  }
  if ((value.action === "reply" || value.action === "clarify") && (value.reply === undefined || value.acknowledgement !== undefined || value.researchRequest !== undefined)) {
    context.addIssue({ code: "custom", message: "Direct plan fields disagree." });
  }
  if (value.action === "research" && (value.researchRequest === undefined || value.reply !== undefined)) {
    context.addIssue({ code: "custom", message: "Research plan fields disagree." });
  }
});

export const researchPacketSchema = z.object({
  schemaVersion: z.literal(1),
  requestId: stableIdSchema,
  question: z.string().trim().min(1).max(1_000),
  asOf: isoDateTime,
  freshness: z.object({
    status: z.enum(["current", "limited", "unknown"]),
    detail: z.string().trim().min(1).max(800),
  }).strict(),
  summary: z.string().trim().min(1).max(4_000),
  findings: z.array(z.object({
    claim: z.string().trim().min(1).max(800),
    evidence: z.string().trim().min(1).max(800),
    sourceIds: z.array(stableIdSchema).min(1).max(6),
    kind: z.enum(["fact", "inference"]),
  }).strict()).min(1).max(8),
  sources: z.array(z.object({
    id: stableIdSchema,
    title: z.string().trim().min(1).max(300),
    url: httpsUrl,
    publisher: z.string().trim().min(1).max(200).optional(),
    publishedAt: isoDateTime.optional(),
    accessedAt: isoDateTime,
    primary: z.boolean(),
  }).strict()).min(1).max(12),
  uncertainties: z.array(z.string().trim().min(1).max(800)).max(6),
  trustedChart: z.object({
    artifactId: stableIdSchema,
    symbol: z.string().trim().min(1).max(20),
    timeframe: z.string().trim().min(1).max(40),
    generatedAt: isoDateTime,
  }).strict().optional(),
}).strict().superRefine((packet, context) => {
  const sourceIds = new Set(packet.sources.map((source) => source.id));
  if (sourceIds.size !== packet.sources.length) {
    context.addIssue({
      code: "custom",
      path: ["sources"],
      message: "Research source IDs must be unique.",
    });
  }
  for (const [findingIndex, finding] of packet.findings.entries()) {
    for (const sourceId of finding.sourceIds) {
      if (!sourceIds.has(sourceId)) {
        context.addIssue({
          code: "custom",
          path: ["findings", findingIndex, "sourceIds"],
          message: "Research findings must reference a declared source.",
        });
      }
    }
  }
});

export const solResearchRequestSchema = z.object({
  ...common,
  profile: z.literal("research"),
  researchRequest: frontmanResearchRequestSchema,
  pass: z.number().int().min(1).max(2),
  trustedChartArtifactId: stableIdSchema.optional(),
}).strict().superRefine((request, context) => {
  if (request.channel.guildId !== request.conversation.guildId) {
    context.addIssue({
      code: "custom",
      path: ["channel", "guildId"],
      message: "Channel guild must match the trusted conversation guild.",
    });
  }
});

export const solResearchResponseSchema = z.object({
  profile: z.literal("research"),
  packet: researchPacketSchema,
  estimator: z.object({
    package: z.literal("js-tiktoken"),
    packageVersion: z.literal("1.0.21"),
    encoding: z.literal("o200k_base"),
    modelMapping: z.literal("gpt-5.6-sol-estimate"),
    exact: z.literal(false),
    version: z.literal("js-tiktoken@1.0.21:o200k_base:gpt-5.6-sol-estimate:v1"),
    estimatedTokens: z.number().int().nonnegative(),
    serializedBytes: z.number().int().nonnegative().max(16_384),
  }).strict(),
  chart: marketChartSpecSchema.optional(),
}).strict();

export const researchFailureSchema = z.object({
  code: z.enum([
    "provider_unavailable", "tool_unavailable", "freshness_unverified",
    "packet_invalid", "packet_oversize", "cancelled",
  ]),
  detail: z.string().trim().min(1).max(500),
  retryable: z.boolean(),
}).strict();

export const frontmanResumeRequestSchema = z.object({
  ...durableCommon,
  profile: z.literal("frontman_resume"),
  triggerKind: discordTriggerKindSchema,
  targetMessageId: snowflakeSchema,
  originalAuthorId: snowflakeSchema,
  acknowledgementDelivery: z.enum(["not_required", "pending", "sent", "uncertain"]),
  research: z.union([solResearchResponseSchema, researchFailureSchema]),
  catchUpMessages: z.array(agentMessageSchema).max(50),
  eligibleThroughSequence: z.number().int().positive(),
  eligibleHumanRevision: z.number().int().nonnegative(),
  eligibleContextHash: z.string().regex(/^[a-f0-9]{16,64}$/),
  nextExplicitTriggerSequence: z.number().int().positive().optional(),
  autonomousPass: z.number().int().min(1).max(2),
}).strict().superRefine((request, context) => {
  if (request.channel.guildId !== request.conversation.guildId) {
    context.addIssue({
      code: "custom",
      path: ["channel", "guildId"],
      message: "Channel guild must match the trusted conversation guild.",
    });
  }
});

export const frontmanResumeResponseSchema = z.object({
  profile: z.literal("frontman_resume"),
  action: z.enum(["send", "suppress", "recheck"]),
  reasonCode: z.enum([
    "answer_ready", "request_cancelled", "answered_by_human", "topic_changed",
    "research_stale", "research_failed", "needs_one_recheck",
  ]),
  reply: content(DISCORD_FINAL_REPLY_MAX_CHARACTERS).optional(),
  recheckRequest: frontmanResearchRequestSchema.optional(),
}).strict().superRefine((value, context) => {
  if ((value.action === "send") !== (value.reply !== undefined)) {
    context.addIssue({ code: "custom", message: "Send action and reply disagree." });
  }
  if ((value.action === "recheck") !== (value.recheckRequest !== undefined)) {
    context.addIssue({ code: "custom", message: "Recheck action and request disagree." });
  }
});

export const durableTurnRecoverySchema = z.object({
  stage: z.enum([
    "claimed", "planning", "planned", "ack_pending", "researching",
    "research_complete", "resuming", "drafted", "delivery_pending",
    "completed", "suppressed", "failed", "cancelled",
  ]),
  plan: frontmanPlanResponseSchema.optional(),
  research: z.object({
    requestId: stableIdSchema,
    normalizedRequest: frontmanResearchRequestSchema,
    status: z.enum(["pending", "completed", "failed"]),
    result: z.union([solResearchResponseSchema, researchFailureSchema]).optional(),
  }).strict().optional(),
  resume: frontmanResumeResponseSchema.optional(),
  resumeRequestId: stableIdSchema.optional(),
  acknowledgementDelivery: z.enum(["not_required", "pending", "sent", "uncertain"]).optional(),
  eligibleThroughSequence: z.number().int().positive().optional(),
  eligibleHumanRevision: z.number().int().nonnegative().optional(),
  eligibleContextHash: z.string().regex(/^[a-f0-9]{16,64}$/).optional(),
  nextExplicitTriggerSequence: z.number().int().positive().optional(),
}).strict().superRefine((value, context) => {
  if (
    value.resume !== undefined
    && (
      value.resumeRequestId === undefined
      || value.eligibleThroughSequence === undefined
      || value.eligibleHumanRevision === undefined
      || value.eligibleContextHash === undefined
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "A recovered resume requires its request and eligible-context fence.",
    });
  }
});

export type ConversationIdentity = z.infer<typeof conversationIdentitySchema>;
export type DurableConversationContext = z.infer<typeof durableConversationContextSchema>;
export type FrontmanResearchRequest = z.infer<typeof frontmanResearchRequestSchema>;
export type FrontmanPlanRequest = z.infer<typeof frontmanPlanRequestSchema>;
export type FrontmanPlanResponse = z.infer<typeof frontmanPlanResponseSchema>;
export type SolResearchRequest = z.infer<typeof solResearchRequestSchema>;
export type SolResearchResponse = z.infer<typeof solResearchResponseSchema>;
export type ResearchFailure = z.infer<typeof researchFailureSchema>;
export type FrontmanResumeRequest = z.infer<typeof frontmanResumeRequestSchema>;
export type FrontmanResumeResponse = z.infer<typeof frontmanResumeResponseSchema>;
export type DurableTurnRecovery = z.infer<typeof durableTurnRecoverySchema>;
