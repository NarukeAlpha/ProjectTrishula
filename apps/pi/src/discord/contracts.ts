import { z } from "zod";
import {
  discordImageAttachmentSchema,
  MAX_DISCORD_CONTEXT_IMAGES,
} from "./images.js";
import { marketChartSpecSchema } from "./market-chart.js";

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
    authorName: z.string().trim().min(1).max(100),
    content: z.string().max(4_000),
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
    directReply: z.string().trim().min(1).max(1_200).nullable(),
    acknowledgement: z.string().trim().min(1).max(320).nullable(),
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
    reply: z.string().trim().min(1).max(1_200).nullable(),
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

export const discordAgentRequestSchema = z.discriminatedUnion("profile", [
  discordTriageRequestSchema,
  discordResearchRequestSchema,
  discordReplyRequestSchema,
]);

export const discordAgentResponseSchema = z.discriminatedUnion("profile", [
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
