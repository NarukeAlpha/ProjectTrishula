import { z } from "zod";

const stableId = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9:_-]+$/);
const snowflake = z.string().regex(/^\d{1,32}$/);
const httpsUrl = z.url().refine((value) => new URL(value).protocol === "https:", "HTTPS URL required.");

export const discordChannelSchema = z.object({
  guildId: snowflake,
  channelId: snowflake,
  channelName: z.string().trim().min(1).max(100),
}).strict();

export const discordContextMessageSchema = z.object({
  messageId: snowflake,
  authorId: snowflake,
  authorName: z.string().trim().min(1).max(100),
  content: z.string().trim().min(1).max(4_000),
  createdAt: z.iso.datetime({ offset: true }),
  isBot: z.boolean(),
}).strict();

const commonRequest = {
  requestId: stableId,
  channel: discordChannelSchema,
  messages: z.array(discordContextMessageSchema).min(1).max(10),
};

export const discordTriageRequestSchema = z.object({
  ...commonRequest,
  profile: z.literal("triage"),
}).strict();

export const discordTriageResponseSchema = z.object({
  profile: z.literal("triage"),
  shouldRespond: z.boolean(),
  shouldResearch: z.boolean(),
  question: z.string().trim().min(1).max(1_000).nullable(),
  reason: z.string().trim().min(1).max(500),
  confidence: z.number().min(0).max(1),
}).strict().superRefine((value, context) => {
  if (value.shouldResearch && (!value.shouldRespond || value.question === null)) {
    context.addIssue({ code: "custom", message: "Research requires a response and a question." });
  }
  if (value.shouldRespond && value.question === null) {
    context.addIssue({ code: "custom", message: "A response requires a normalized question." });
  }
});

export const discordResearchRequestSchema = z.object({
  ...commonRequest,
  profile: z.literal("research"),
  question: z.string().trim().min(1).max(1_000),
}).strict();

export const discordResearchFindingSchema = z.object({
  claim: z.string().trim().min(1).max(1_500),
  sourceUrls: z.array(httpsUrl).max(5),
}).strict();

export const discordResearchSourceSchema = z.object({
  url: httpsUrl,
  title: z.string().trim().min(1).max(300),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  accessedAt: z.iso.datetime({ offset: true }),
}).strict();

export const discordResearchResponseSchema = z.object({
  profile: z.literal("research"),
  summary: z.string().trim().min(1).max(12_000),
  findings: z.array(discordResearchFindingSchema).max(12),
  sources: z.array(discordResearchSourceSchema).max(20),
  freshness: z.object({
    asOf: z.iso.datetime({ offset: true }),
    status: z.enum(["current", "limited", "unknown"]),
  }).strict(),
  uncertainty: z.array(z.string().trim().min(1).max(500)).max(12),
  noTradingAction: z.literal(true),
}).strict();

export const discordReplyRequestSchema = z.object({
  ...commonRequest,
  profile: z.literal("reply"),
  question: z.string().trim().min(1).max(1_000),
  research: discordResearchResponseSchema.nullable(),
  loopDepth: z.number().int().min(0).max(3),
}).strict();

export const discordReplyResponseSchema = z.object({
  profile: z.literal("reply"),
  reply: z.string().trim().min(1).max(1_200),
  recheck: z.boolean(),
  recheckReason: z.string().trim().min(1).max(500).nullable(),
}).strict().superRefine((value, context) => {
  if (value.recheck !== (value.recheckReason !== null)) {
    context.addIssue({ code: "custom", message: "recheck and recheckReason must agree." });
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

export type DiscordAgentRequest = z.infer<typeof discordAgentRequestSchema>;
export type DiscordAgentResponse = z.infer<typeof discordAgentResponseSchema>;
export type DiscordTriageRequest = z.infer<typeof discordTriageRequestSchema>;
export type DiscordTriageResponse = z.infer<typeof discordTriageResponseSchema>;
export type DiscordResearchRequest = z.infer<typeof discordResearchRequestSchema>;
export type DiscordResearchResponse = z.infer<typeof discordResearchResponseSchema>;
export type DiscordReplyRequest = z.infer<typeof discordReplyRequestSchema>;
export type DiscordReplyResponse = z.infer<typeof discordReplyResponseSchema>;
