import { z } from "zod";

export const marketResearchIdSchema = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9:._-]+$/);
export const marketResearchHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const marketResearchIsoDateTimeSchema = z.iso.datetime({ offset: true });

export const marketResearchChartRequestSchema = z.object({
  chartRequestId: marketResearchIdSchema,
  editionId: marketResearchIdSchema,
  sectionId: marketResearchIdSchema,
  symbol: z.string().trim().min(1).max(20).regex(/^[A-Z0-9.^=-]+$/),
  timeframe: z.enum(["5m", "15m", "60m", "daily", "weekly"]),
  start: marketResearchIsoDateTimeSchema,
  end: marketResearchIsoDateTimeSchema,
  session: z.enum(["premarket", "regular", "after_hours", "all"]),
  overlays: z.array(z.string().trim().min(1).max(100)).max(10),
  annotations: z.array(z.string().trim().min(1).max(300)).max(20),
  reason: z.string().trim().min(1).max(500),
  priority: z.number().int().min(0).max(100),
  sourceEvidenceIds: z.array(marketResearchIdSchema).min(1).max(20),
  dataAsOf: marketResearchIsoDateTimeSchema,
}).strict().superRefine((value, context) => {
  if (
    Date.parse(value.start) >= Date.parse(value.end)
    || new Set(value.sourceEvidenceIds).size !== value.sourceEvidenceIds.length
  ) context.addIssue({ code: "custom", message: "Invalid chart request range or source IDs." });
});

export const marketResearchSafeErrorSchema = z.enum([
  "market_research_disabled", "forum_not_configured", "forum_wrong_channel_type",
  "forum_permissions_incomplete", "edition_already_exists", "edition_lease_lost",
  "exa_not_configured", "exa_auth_failed", "exa_budget_exhausted", "exa_rate_limited",
  "exa_unavailable", "exa_invalid_request", "exa_connect_zdr_incompatible",
  "source_rights_blocked", "source_unavailable", "market_data_not_configured",
  "market_data_stale", "market_data_conflict", "market_data_unavailable",
  "market_session_calendar_stale", "session_unknown", "evidence_below_minimum",
  "composition_auth_required", "composition_provider_not_ready", "composition_timeout",
  "composition_schema_invalid", "composition_citation_invalid", "chart_unavailable",
  "chart_artifact_expired", "discord_thread_create_failed",
  "discord_thread_reconcile_failed", "discord_thread_reconcile_ambiguous",
  "discord_reply_failed", "discord_permission_failed", "discord_rate_limited",
  "late_cutoff_exceeded",
]);

const deliverySchema = z.object({
  deliveryId: marketResearchIdSchema,
  sequence: z.number().int().nonnegative().max(10_000),
  kind: z.enum(["starter", "reply"]),
  content: z.string().trim().min(1).max(2_000),
  contentHash: marketResearchHashSchema,
  nonce: marketResearchIdSchema,
  chartAttachmentIds: z.array(marketResearchIdSchema).max(3),
  chartRequests: z.array(marketResearchChartRequestSchema).max(3),
  deliveryToken: marketResearchIdSchema,
  attempts: z.number().int().positive().max(100),
}).strict();

export const publicationClaimSchema = z.discriminatedUnion("claimed", [
  z.object({ claimed: z.literal(false) }).strict(),
  z.object({
    claimed: z.literal(true),
    editionId: marketResearchIdSchema,
    guildId: z.string().regex(/^\d{1,32}$/),
    forumChannelId: z.string().regex(/^\d{1,32}$/),
    forumTagIds: z.array(z.string().regex(/^\d{1,32}$/)).max(5),
    forumTitle: z.string().trim().min(1).max(100),
    publicationGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    publicationToken: marketResearchIdSchema,
    threadId: z.string().regex(/^\d{1,32}$/).optional(),
    starterMessageId: z.string().regex(/^\d{1,32}$/).optional(),
    lastErrorCode: marketResearchSafeErrorSchema.optional(),
    delivery: deliverySchema,
  }).strict(),
]).superRefine((value, context) => {
  if (!value.claimed) return;
  const attachmentIds = value.delivery.chartAttachmentIds;
  const requests = value.delivery.chartRequests;
  if (
    new Set(attachmentIds).size !== attachmentIds.length
    || new Set(requests.map((request) => request.chartRequestId)).size !== requests.length
    || requests.some((request) => request.editionId !== value.editionId)
    || requests.some((request) => !attachmentIds.includes(request.chartRequestId))
  ) context.addIssue({ code: "custom", path: ["delivery", "chartRequests"], message: "Chart claims do not match their delivery." });
});

export type PublicationClaim = z.infer<typeof publicationClaimSchema>;
export type ClaimedPublication = Extract<PublicationClaim, { claimed: true }>;
export type MarketResearchSafeError = z.infer<typeof marketResearchSafeErrorSchema>;
export type MarketResearchChartRequest = z.infer<typeof marketResearchChartRequestSchema>;

export interface PublicationAcknowledgement {
  status: "sent" | "failed";
  discordThreadId?: string;
  discordMessageId?: string;
  code?: MarketResearchSafeError;
  retryable?: boolean;
  retryAfterMs?: number;
}
