import { z } from "zod";
import {
  discordImageAttachmentSchema,
  MAX_DISCORD_CONTEXT_IMAGES,
} from "./images.js";
import { marketChartSpecSchema } from "./market-chart.js";
import {
  DISCORD_ACKNOWLEDGEMENT_MAX_CHARACTERS,
  DISCORD_FINAL_REPLY_MAX_CHARACTERS,
  normalizeDiscordContent,
  validDiscordContent,
} from "./content.js";

export {
  discordImageAttachmentSchema,
  type DiscordImageAttachment,
} from "./images.js";
export { marketChartSpecSchema, type MarketChartSpec } from "./market-chart.js";

const stableId = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9:_-]+$/);
const snowflake = z.string().regex(/^\d{1,32}$/);
const httpsUrl = z
  .url()
  .refine(
    (value) => new URL(value).protocol === "https:",
    "HTTPS URL required.",
  );

function discordContent(maximum: number) {
  return z
    .string()
    .refine(
      (value) => validDiscordContent(value, maximum),
      `Discord content must contain at most ${maximum} Unicode characters.`,
    )
    .transform(normalizeDiscordContent);
}

export const discordChannelSchema = z
  .object({
    guildId: snowflake,
    channelId: snowflake,
    channelName: z.string().trim().min(1).max(100),
  })
  .strict();

export const discordContextMessageSchema = z
  .object({
    messageId: snowflake,
    sequence: z.number().int().positive(),
    authorId: snowflake,
    authorName: z.string().trim().min(1).max(200),
    content: z.string().max(8_000),
    images: z
      .array(discordImageAttachmentSchema)
      .max(MAX_DISCORD_CONTEXT_IMAGES)
      .optional(),
    mentionsBot: z.boolean().optional(),
    replyToMessageId: snowflake.optional(),
    createdAt: z.iso.datetime({ offset: true }),
    isBot: z.boolean(),
  })
  .strict()
  .superRefine((message, context) => {
    if (message.content.trim().length === 0 && !message.images?.length) {
      context.addIssue({
        code: "custom",
        message: "A Discord message requires text or an image.",
      });
    }
  });

export const discordTriggerKindSchema = z.enum([
  "ambient",
  "mention",
  "recheck",
]);

const commonRequest = {
  requestId: stableId,
  channel: discordChannelSchema,
  messages: z.array(discordContextMessageSchema).min(1).max(10),
};

export const discordTriageRequestSchema = z
  .object({
    ...commonRequest,
    profile: z.literal("triage"),
    triggerKind: discordTriggerKindSchema,
  })
  .strict();

export const discordTriageResponseSchema = z
  .object({
    profile: z.literal("triage"),
    decision: z.enum(["silent", "direct", "research"]),
    targetMessageId: snowflake.nullable(),
    question: z.string().trim().min(1).max(1_000).nullable(),
    directReply: discordContent(DISCORD_FINAL_REPLY_MAX_CHARACTERS).nullable(),
    acknowledgement: discordContent(DISCORD_ACKNOWLEDGEMENT_MAX_CHARACTERS).nullable(),
    reason: z.string().trim().min(1).max(500),
    confidence: z.number().min(0).max(1),
    additiveValue: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "silent") {
      if (
        value.targetMessageId !== null ||
        value.question !== null ||
        value.directReply !== null ||
        value.acknowledgement !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "A silent triage decision cannot include reply fields.",
        });
      }
      return;
    }
    if (value.targetMessageId === null || value.question === null) {
      context.addIssue({
        code: "custom",
        message:
          "A response requires a target message and normalized question.",
      });
    }
    if (
      value.decision === "direct" &&
      (value.directReply === null || value.acknowledgement !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "A direct decision requires only a direct reply.",
      });
    }
    if (value.decision === "research" && value.directReply !== null) {
      context.addIssue({
        code: "custom",
        message: "A research decision cannot include a direct reply.",
      });
    }
  });

export const discordResearchRequestSchema = z
  .object({
    ...commonRequest,
    profile: z.literal("research"),
    question: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const discordResearchFindingSchema = z
  .object({
    claim: z.string().trim().min(1).max(1_500),
    sourceUrls: z.array(httpsUrl).max(5),
  })
  .strict();

export const discordResearchSourceSchema = z
  .object({
    url: httpsUrl,
    title: z.string().trim().min(1).max(300),
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
    accessedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const discordResearchResponseSchema = z
  .object({
    profile: z.literal("research"),
    summary: z.string().trim().min(1).max(12_000),
    findings: z.array(discordResearchFindingSchema).max(12),
    sources: z.array(discordResearchSourceSchema).max(20),
    freshness: z
      .object({
        asOf: z.iso.datetime({ offset: true }),
        status: z.enum(["current", "limited", "unknown"]),
      })
      .strict(),
    uncertainty: z.array(z.string().trim().min(1).max(500)).max(12),
    noTradingAction: z.literal(true),
    chart: marketChartSpecSchema.optional(),
  })
  .strict();

export const discordReplyRequestSchema = z
  .object({
    ...commonRequest,
    profile: z.literal("reply"),
    triggerKind: discordTriggerKindSchema,
    targetMessageId: snowflake,
    question: z.string().trim().min(1).max(1_000),
    research: discordResearchResponseSchema.nullable(),
  })
  .strict();

export const discordReplyResponseSchema = z
  .object({
    profile: z.literal("reply"),
    action: z.enum(["send", "suppress"]),
    reply: discordContent(DISCORD_FINAL_REPLY_MAX_CHARACTERS).nullable(),
    reason: z.string().trim().min(1).max(500),
    chart: marketChartSpecSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.action === "send") !== (value.reply !== null)) {
      context.addIssue({
        code: "custom",
        message: "Reply action and reply content must agree.",
      });
    }
    if (value.action === "suppress" && value.chart !== undefined) {
      context.addIssue({
        code: "custom",
        message: "A suppressed reply cannot include a chart.",
      });
    }
  });

export const discordConversationIdentitySchema = z
  .object({
    ownerId: stableId,
    ownerBindingVersion: z.number().int().positive(),
    guildId: snowflake,
    conversationId: z.string().regex(/^discord:\d{1,32}$/),
    epoch: z.number().int().nonnegative(),
    turnId: stableId,
    runId: stableId,
    generation: z.number().int().positive(),
    routingGeneration: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    humanRevision: z.number().int().nonnegative(),
    personalityVersion: stableId,
    systemPromptHash: z.string().regex(/^[a-f0-9]{64}$/),
    capabilityProfileHash: z.string().regex(/^[a-f0-9]{64}$/),
    activeCheckpointId: stableId.optional(),
  })
  .strict()
  .superRefine((identity, context) => {
    if (identity.conversationId !== `discord:${identity.guildId}`) {
      context.addIssue({
        code: "custom",
        path: ["conversationId"],
        message: "Conversation ID must match the trusted guild ID.",
      });
    }
  });

const canonicalConversationMessageSchema = z
  .object({
    eventId: stableId,
    ordinal: z.number().int().positive(),
    role: z.enum(["human", "assistant"]),
    authorId: snowflake.optional(),
    displayName: z.string().trim().min(1).max(100).optional(),
    content: z.string().max(8_000),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const sourceEventIdsSchema = z.array(stableId).min(1).max(64);

export const portableConversationSummarySchema = z
  .object({
    participants: z
      .array(
        z
          .object({
            authorId: snowflake,
            displayName: z.string().trim().min(1).max(100).optional(),
          })
          .strict(),
      )
      .max(100),
    acceptedFacts: z
      .array(
        z
          .object({
            statement: z.string().trim().min(1).max(1_000),
            subjectAuthorId: snowflake.optional(),
            assertedByAuthorId: snowflake.optional(),
            sourceEventIds: sourceEventIdsSchema,
            asOf: z.iso.datetime({ offset: true }).optional(),
            freshness: z.enum(["current", "limited", "unknown"]).optional(),
          })
          .strict(),
      )
      .max(100),
    corrections: z
      .array(
        z
          .object({
            rejectedStatement: z.string().trim().min(1).max(1_000),
            replacementStatement: z.string().trim().min(1).max(1_000),
            correctedByAuthorId: snowflake.optional(),
            sourceEventIds: sourceEventIdsSchema,
            asOf: z.iso.datetime({ offset: true }).optional(),
          })
          .strict(),
      )
      .max(100),
    unresolvedQuestions: z
      .array(
        z
          .object({
            question: z.string().trim().min(1).max(1_000),
            askedByAuthorId: snowflake,
            sourceEventIds: sourceEventIdsSchema,
          })
          .strict(),
      )
      .max(100),
    commitments: z
      .array(
        z
          .object({
            statement: z.string().trim().min(1).max(1_000),
            owner: z.union([
              z.object({ kind: z.literal("assistant") }).strict(),
              z
                .object({ kind: z.literal("participant"), authorId: snowflake })
                .strict(),
            ]),
            status: z.enum(["open", "resolved", "cancelled"]),
            sourceEventIds: sourceEventIdsSchema,
          })
          .strict(),
      )
      .max(100),
    conversationPreferences: z
      .array(
        z
          .object({
            statement: z.string().trim().min(1).max(1_000),
            authorId: snowflake,
            sourceEventIds: sourceEventIdsSchema,
          })
          .strict(),
      )
      .max(100),
    sourceFreshnessNotes: z
      .array(
        z
          .object({
            statement: z.string().trim().min(1).max(1_000),
            sourceEventIds: sourceEventIdsSchema,
            asOf: z.iso.datetime({ offset: true }).optional(),
            freshness: z.enum(["current", "limited", "unknown"]),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const durableConversationContextSchema = z
  .object({
    sourceRevision: z.number().int().nonnegative(),
    sourceHumanRevision: z.number().int().nonnegative(),
    activeCheckpointId: stableId.optional(),
    portableSummary: portableConversationSummarySchema.optional(),
    recentEvents: z.array(canonicalConversationMessageSchema).max(2_000),
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
  })
  .strict();

export const frontmanResearchRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(1_000),
    decisionContext: z.string().trim().min(1).max(2_000),
    requiredFacts: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
    freshnessRequirement: z.string().trim().min(1).max(500),
    preferredPrimarySources: z.array(z.string().trim().min(1).max(300)).max(12),
    requestedChart: z
      .object({
        symbol: z.string().trim().min(1).max(20),
        timeframe: z.string().trim().min(1).max(40),
        interval: z.string().trim().min(1).max(20),
        thesis: z.string().trim().min(1).max(500),
      })
      .strict()
      .optional(),
  })
  .strict();

const trustedConversationRequest = {
  ...commonRequest,
  conversation: discordConversationIdentitySchema,
};
const durableRequest = {
  ...trustedConversationRequest,
  durableContext: durableConversationContextSchema,
};

export const discordFrontmanPlanRequestSchema = z
  .object({
    ...durableRequest,
    profile: z.literal("frontman_plan"),
    triggerKind: discordTriggerKindSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (request.channel.guildId !== request.conversation.guildId) {
      context.addIssue({
        code: "custom",
        path: ["channel", "guildId"],
        message: "Channel guild must match the trusted conversation guild.",
      });
    }
  });

export const discordFrontmanPlanResponseSchema = z
  .object({
    profile: z.literal("frontman_plan"),
    action: z.enum(["silent", "reply", "clarify", "research"]),
    targetMessageId: snowflake,
    confidence: z.number().min(0).max(1),
    additiveValue: z.number().min(0).max(1),
    reasonCode: z.enum([
      "explicit_stable",
      "explicit_needs_clarification",
      "explicit_needs_freshness",
      "ambient_material_value",
      "ambient_already_answered",
      "ambient_low_value",
      "unsafe_or_unsupported",
    ]),
    reply: discordContent(DISCORD_FINAL_REPLY_MAX_CHARACTERS).optional(),
    acknowledgement: discordContent(
      DISCORD_ACKNOWLEDGEMENT_MAX_CHARACTERS,
    ).optional(),
    researchRequest: frontmanResearchRequestSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasReply = value.reply !== undefined;
    const hasResearch = value.researchRequest !== undefined;
    if (value.action === "silent" && (hasReply || hasResearch || value.acknowledgement !== undefined)) {
      context.addIssue({ code: "custom", message: "A silent plan cannot include output fields." });
    }
    if ((value.action === "reply" || value.action === "clarify") && (!hasReply || hasResearch || value.acknowledgement !== undefined)) {
      context.addIssue({ code: "custom", message: "A direct frontman action requires only a reply." });
    }
    if (value.action === "research" && (!hasResearch || hasReply)) {
      context.addIssue({ code: "custom", message: "A research plan requires only a research request and optional acknowledgement." });
    }
  });

export const researchPacketSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: stableId,
    question: z.string().trim().min(1).max(1_000),
    asOf: z.iso.datetime({ offset: true }),
    freshness: z
      .object({
        status: z.enum(["current", "limited", "unknown"]),
        detail: z.string().trim().min(1).max(800),
      })
      .strict(),
    summary: z.string().trim().min(1).max(4_000),
    findings: z
      .array(
        z
          .object({
            claim: z.string().trim().min(1).max(800),
            evidence: z.string().trim().min(1).max(800),
            sourceIds: z.array(stableId).min(1).max(6),
            kind: z.enum(["fact", "inference"]),
          })
          .strict(),
      )
      .max(8),
    sources: z
      .array(
        z
          .object({
            id: stableId,
            title: z.string().trim().min(1).max(300),
            url: httpsUrl,
            publisher: z.string().trim().min(1).max(200).optional(),
            publishedAt: z.iso.datetime({ offset: true }).optional(),
            accessedAt: z.iso.datetime({ offset: true }),
            primary: z.boolean(),
          })
          .strict(),
      )
      .max(12),
    uncertainties: z.array(z.string().trim().min(1).max(800)).max(6),
    trustedChart: z
      .object({
        artifactId: stableId,
        symbol: z.string().trim().min(1).max(20),
        timeframe: z.string().trim().min(1).max(40),
        generatedAt: z.iso.datetime({ offset: true }),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((packet, context) => {
    const sourceIds = new Set(packet.sources.map((source) => source.id));
    if (sourceIds.size !== packet.sources.length) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: "Research source IDs must be unique.",
      });
    }
    if (packet.freshness.status === "current" && packet.sources.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: "Current research requires at least one source.",
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

export const discordSolResearchRequestSchema = z
  .object({
    ...trustedConversationRequest,
    profile: z.literal("research"),
    researchRequest: frontmanResearchRequestSchema,
    pass: z.number().int().min(1).max(2),
    trustedChartArtifactId: stableId.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.channel.guildId !== request.conversation.guildId) {
      context.addIssue({
        code: "custom",
        path: ["channel", "guildId"],
        message: "Channel guild must match the trusted conversation guild.",
      });
    }
  });

export const discordSolResearchResponseSchema = z
  .object({
    profile: z.literal("research"),
    packet: researchPacketSchema,
    estimator: z
      .object({
        package: z.literal("js-tiktoken"),
        packageVersion: z.literal("1.0.21"),
        encoding: z.literal("o200k_base"),
        modelMapping: z.literal("gpt-5.6-sol-estimate"),
        exact: z.literal(false),
        version: z.literal("js-tiktoken@1.0.21:o200k_base:gpt-5.6-sol-estimate:v1"),
        estimatedTokens: z.number().int().nonnegative(),
        serializedBytes: z.number().int().nonnegative().max(16_384),
      })
      .strict(),
    chart: marketChartSpecSchema.optional(),
  })
  .strict();

export const discordResearchFailureSchema = z
  .object({
    code: z.enum([
      "provider_unavailable",
      "tool_unavailable",
      "freshness_unverified",
      "packet_invalid",
      "packet_oversize",
      "cancelled",
    ]),
    detail: z.string().trim().min(1).max(500),
    retryable: z.boolean(),
  })
  .strict();

export const discordFrontmanResumeRequestSchema = z
  .object({
    ...durableRequest,
    profile: z.literal("frontman_resume"),
    triggerKind: discordTriggerKindSchema,
    targetMessageId: snowflake,
    originalAuthorId: snowflake,
    acknowledgementDelivery: z.enum(["not_required", "pending", "sent", "uncertain"]),
    research: z.union([discordSolResearchResponseSchema, discordResearchFailureSchema]),
    catchUpMessages: z.array(discordContextMessageSchema).max(50),
    eligibleThroughSequence: z.number().int().positive(),
    eligibleHumanRevision: z.number().int().nonnegative(),
    eligibleContextHash: z.string().regex(/^[a-f0-9]{16,64}$/),
    nextExplicitTriggerSequence: z.number().int().positive().optional(),
    autonomousPass: z.number().int().min(1).max(2),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.channel.guildId !== request.conversation.guildId) {
      context.addIssue({
        code: "custom",
        path: ["channel", "guildId"],
        message: "Channel guild must match the trusted conversation guild.",
      });
    }
  });

export const discordFrontmanResumeResponseSchema = z
  .object({
    profile: z.literal("frontman_resume"),
    action: z.enum(["send", "suppress", "recheck"]),
    reasonCode: z.enum([
      "answer_ready",
      "request_cancelled",
      "answered_by_human",
      "topic_changed",
      "research_stale",
      "research_failed",
      "needs_one_recheck",
    ]),
    reply: discordContent(DISCORD_FINAL_REPLY_MAX_CHARACTERS).optional(),
    recheckRequest: frontmanResearchRequestSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.action === "send") !== (value.reply !== undefined)) {
      context.addIssue({ code: "custom", message: "Send action and reply content must agree." });
    }
    if ((value.action === "recheck") !== (value.recheckRequest !== undefined)) {
      context.addIssue({ code: "custom", message: "Recheck action and request must agree." });
    }
  });

export const discordAgentRequestSchema = z.union([
  discordFrontmanPlanRequestSchema,
  discordSolResearchRequestSchema,
  discordFrontmanResumeRequestSchema,
  discordTriageRequestSchema,
  discordResearchRequestSchema,
  discordReplyRequestSchema,
]);

export const discordAgentResponseSchema = z.union([
  discordFrontmanPlanResponseSchema,
  discordSolResearchResponseSchema,
  discordFrontmanResumeResponseSchema,
  discordTriageResponseSchema,
  discordResearchResponseSchema,
  discordReplyResponseSchema,
]);

export const discordAgentJobParamsSchema = z
  .object({ jobId: stableId })
  .strict();

export type DiscordAgentRequest = z.infer<typeof discordAgentRequestSchema>;
export type DiscordAgentResponse = z.infer<typeof discordAgentResponseSchema>;
export type DiscordTriageRequest = z.infer<typeof discordTriageRequestSchema>;
export type DiscordTriageResponse = z.infer<typeof discordTriageResponseSchema>;
export type DiscordResearchRequest = z.infer<
  typeof discordResearchRequestSchema
>;
export type DiscordResearchResponse = z.infer<
  typeof discordResearchResponseSchema
>;
export type DiscordReplyRequest = z.infer<typeof discordReplyRequestSchema>;
export type DiscordReplyResponse = z.infer<typeof discordReplyResponseSchema>;
export type DiscordConversationIdentity = z.infer<typeof discordConversationIdentitySchema>;
export type DiscordFrontmanResearchRequest = z.infer<typeof frontmanResearchRequestSchema>;
export type DiscordFrontmanPlanRequest = z.infer<typeof discordFrontmanPlanRequestSchema>;
export type DiscordFrontmanPlanResponse = z.infer<typeof discordFrontmanPlanResponseSchema>;
export type DiscordSolResearchRequest = z.infer<typeof discordSolResearchRequestSchema>;
export type DiscordSolResearchResponse = z.infer<typeof discordSolResearchResponseSchema>;
export type DiscordResearchFailure = z.infer<typeof discordResearchFailureSchema>;
export type DiscordFrontmanResumeRequest = z.infer<typeof discordFrontmanResumeRequestSchema>;
export type DiscordFrontmanResumeResponse = z.infer<typeof discordFrontmanResumeResponseSchema>;
export type ResearchPacket = z.infer<typeof researchPacketSchema>;
