import { z } from "zod";

export const stableIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9:_-]+$/);
export const snowflakeSchema = z.string().regex(/^\d{1,32}$/);
const timestampSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const httpsUrlSchema = z
  .url()
  .refine(
    (value) => new URL(value).protocol === "https:",
    "HTTPS URL required.",
  );

export const agentMessageSchema = z
  .object({
    messageId: snowflakeSchema,
    authorId: snowflakeSchema,
    authorName: z.string().trim().min(1).max(100),
    content: z.string().trim().min(1).max(4_000),
    createdAt: isoDateTimeSchema,
    isBot: z.boolean(),
  })
  .strict();

export type AgentMessage = z.infer<typeof agentMessageSchema>;

export const agentChannelSchema = z
  .object({
    guildId: snowflakeSchema,
    channelId: snowflakeSchema,
    channelName: z.string().trim().min(1).max(100),
  })
  .strict();

const commonAgentRequestSchema = z.object({
  requestId: stableIdSchema,
  channel: agentChannelSchema,
  messages: z.array(agentMessageSchema).min(1).max(10),
});

export const triageRequestSchema = commonAgentRequestSchema
  .extend({
    profile: z.literal("triage"),
  })
  .strict();

export const triageResponseSchema = z
  .object({
    profile: z.literal("triage"),
    shouldRespond: z.boolean(),
    shouldResearch: z.boolean(),
    question: z.string().trim().min(1).max(1_000).nullable(),
    reason: z.string().trim().min(1).max(500),
    confidence: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.shouldResearch &&
      (!value.shouldRespond || value.question === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Research requires a response and a question.",
      });
    }
    if (value.shouldRespond && value.question === null) {
      context.addIssue({
        code: "custom",
        message: "A response requires a normalized question.",
      });
    }
  });

export const researchFindingSchema = z
  .object({
    claim: z.string().trim().min(1).max(1_500),
    sourceUrls: z.array(httpsUrlSchema).max(5),
  })
  .strict();

export const researchSourceSchema = z
  .object({
    url: httpsUrlSchema,
    title: z.string().trim().min(1).max(300),
    publishedAt: isoDateTimeSchema.nullable(),
    accessedAt: isoDateTimeSchema,
  })
  .strict();

export const researchResponseSchema = z
  .object({
    profile: z.literal("research"),
    summary: z.string().trim().min(1).max(12_000),
    findings: z.array(researchFindingSchema).max(12),
    sources: z.array(researchSourceSchema).max(20),
    freshness: z
      .object({
        asOf: isoDateTimeSchema,
        status: z.enum(["current", "limited", "unknown"]),
      })
      .strict(),
    uncertainty: z.array(z.string().trim().min(1).max(500)).max(12),
    noTradingAction: z.literal(true),
  })
  .strict();

export const researchRequestSchema = commonAgentRequestSchema
  .extend({
    profile: z.literal("research"),
    question: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const replyRequestSchema = commonAgentRequestSchema
  .extend({
    profile: z.literal("reply"),
    question: z.string().trim().min(1).max(1_000),
    research: researchResponseSchema.nullable(),
    loopDepth: z.number().int().min(0).max(3),
  })
  .strict();

export const replyResponseSchema = z
  .object({
    profile: z.literal("reply"),
    reply: z.string().trim().min(1).max(1_200),
    recheck: z.boolean(),
    recheckReason: z.string().trim().min(1).max(500).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.recheck !== (value.recheckReason !== null)) {
      context.addIssue({
        code: "custom",
        message: "recheck and recheckReason must agree.",
      });
    }
  });

export type TriageRequest = z.infer<typeof triageRequestSchema>;
export type TriageResponse = z.infer<typeof triageResponseSchema>;
export type ResearchRequest = z.infer<typeof researchRequestSchema>;
export type ResearchResponse = z.infer<typeof researchResponseSchema>;
export type ReplyRequest = z.infer<typeof replyRequestSchema>;
export type ReplyResponse = z.infer<typeof replyResponseSchema>;

export const discordPermissionsSchema = z
  .object({
    viewChannels: z.boolean(),
    sendMessages: z.boolean(),
    readMessageHistory: z.boolean(),
    messageContent: z.boolean(),
  })
  .strict();

export const discoveredChannelSchema = z
  .object({
    channelId: snowflakeSchema,
    name: z.string().trim().min(1).max(200),
    type: z.enum(["text", "announcement", "forum", "other"]),
    canView: z.boolean(),
    canSend: z.boolean(),
    canReadHistory: z.boolean(),
  })
  .strict();

export const discoveredGuildSchema = z
  .object({
    guildId: snowflakeSchema,
    name: z.string().trim().min(1).max(200),
    iconUrl: z.url().max(2_000).optional(),
    permissions: discordPermissionsSchema,
    channels: z.array(discoveredChannelSchema).max(500),
  })
  .strict();

export type DiscoveredChannel = z.infer<typeof discoveredChannelSchema>;
export type DiscoveredGuild = z.infer<typeof discoveredGuildSchema>;

export const storedMessageSchema = z
  .object({
    guildId: snowflakeSchema,
    channelId: snowflakeSchema,
    messageId: snowflakeSchema,
    authorId: snowflakeSchema,
    authorName: z.string().trim().min(1).max(200),
    content: z.string().max(8_000),
    isBot: z.boolean(),
    replyToMessageId: snowflakeSchema.optional(),
    createdAt: timestampSchema,
  })
  .strict();

export type StoredMessage = z.infer<typeof storedMessageSchema>;

export const convexMessageSchema = z
  .object({
    messageId: snowflakeSchema,
    sequence: z.number().int().positive(),
    authorId: stableIdSchema,
    authorName: z.string().trim().min(1).max(200),
    content: z.string().max(8_000),
    isBot: z.boolean(),
    replyToMessageId: stableIdSchema.optional(),
    createdAt: timestampSchema,
  })
  .strict();

export type ConvexMessage = z.infer<typeof convexMessageSchema>;

export interface ChannelReference {
  guildId: string;
  channelId: string;
}

export interface ClaimedLoop extends ChannelReference {
  claimed: true;
  idempotent: boolean;
  runId: string;
  generation: number;
  mode: "messages" | "recheck";
  channelName: string;
  leaseExpiresAt: number;
  windowStart: number;
  windowEnd: number;
  contextHash: string;
  recheckCount: number;
  replyChannelId: string;
  researchLogChannelId?: string | undefined;
  messages: AgentMessage[];
}

export interface UnclaimedLoop {
  claimed: false;
  reason: string;
}

export type ClaimLoopResponse = ClaimedLoop | UnclaimedLoop;

export interface RunnableChannel extends ChannelReference {
  status: string;
  pendingMessageCount: number;
  leaseExpired: boolean;
  updatedAt: number;
}

export interface OutboxItem extends ChannelReference {
  outboxId: string;
  sourceGuildId: string;
  sourceChannelId: string;
  runId: string;
  generation: number;
  status: "pending" | "sent";
  content: string;
  replyToMessageId?: string | undefined;
  recheckRequested: boolean;
  finalizesLoop: boolean;
  discordMessageId?: string | undefined;
  deliveryToken?: string | undefined;
  attempts: number;
  createdAt: number;
}

export type LoopStage = "triaging" | "researching" | "drafting" | "catching_up";
