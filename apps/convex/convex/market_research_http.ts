/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-conditional-empty-object-spread -- This authenticated HTTP adapter parses untrusted JSON and emits exact optional safe fields. */
import { z } from "zod";
import { internal } from "./_generated/api.js";
import { httpAction } from "./_generated/server.js";
import {
  authorizedDiscordGatewayRequest,
  authorizedServiceRequest,
} from "./lib/service_auth.js";

const MAX_MARKET_RESEARCH_BODY_BYTES = 2 * 1_024 * 1_024;
const id = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9:._-]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const generation = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const safeError = z.enum([
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
const leasedEdition = {
  editionId: id,
  generation,
  claimToken: id,
};

const piRequest = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("heartbeat"),
    ...leasedEdition,
    stage: z.enum(["collecting", "researching", "calculating", "composing"]),
  }).strict(),
  z.object({
    operation: z.literal("appendEvidence"),
    ...leasedEdition,
    sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    evidence: z.array(z.record(z.string(), z.unknown())).max(64),
  }).strict(),
  z.object({ operation: z.literal("loadEvidence"), ...leasedEdition }).strict(),
  z.object({ operation: z.literal("complete"), result: z.record(z.string(), z.unknown()) }).strict(),
  z.object({
    operation: z.literal("fail"),
    ...leasedEdition,
    code: safeError,
    retryable: z.boolean(),
  }).strict(),
]);

const discordRequest = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("claimPublication"), ownerId: id, workerId: id }).strict(),
  z.object({
    operation: z.literal("heartbeatPublication"),
    editionId: id,
    publicationGeneration: generation,
    publicationToken: id,
  }).strict(),
  z.object({
    operation: z.literal("acknowledgePublication"),
    editionId: id,
    publicationGeneration: generation,
    publicationToken: id,
    deliveryId: id,
    deliveryToken: id,
    status: z.enum(["sent", "failed"]),
    discordThreadId: id.optional(),
    discordMessageId: id.optional(),
    code: safeError.optional(),
    retryable: z.boolean().optional(),
    retryAfterMs: z.number().int().min(1_000).max(15 * 60 * 1_000).optional(),
  }).strict(),
  z.object({
    operation: z.literal("adoptReconciledStarter"),
    editionId: id,
    publicationGeneration: generation,
    publicationToken: id,
    discordThreadId: id,
    starterMessageId: id,
    contentHash: hash,
    duplicateIncident: z.boolean().optional(),
  }).strict(),
]);

const responseHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

async function boundedJson(request: Request): Promise<unknown | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_MARKET_RESEARCH_BODY_BYTES) return null;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_MARKET_RESEARCH_BODY_BYTES) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export const marketResearchPi = httpAction(async (ctx, request) => {
  if (!authorizedServiceRequest(request)) return json({ error: "Unauthorized." }, 401);
  const parsed = piRequest.safeParse(await boundedJson(request));
  if (!parsed.success) return json({ error: "Invalid market-research Pi request." }, 400);
  try {
    const body = parsed.data;
    switch (body.operation) {
      case "heartbeat": {
        const { operation: _, ...args } = body;
        return json(await ctx.runMutation(internal.market_research.heartbeatResearch, args));
      }
      case "appendEvidence": {
        const { operation: _, ...args } = body;
        const result = await ctx.runMutation(internal.market_research.appendEvidence, args);
        return json(result, result.accepted ? 200 : 409);
      }
      case "loadEvidence": {
        const { operation: _, ...args } = body;
        const result = await ctx.runQuery(internal.market_research.loadEvidence, args);
        return json(result, result.accepted ? 200 : 409);
      }
      case "complete": {
        const result = await ctx.runMutation(internal.market_research.completeComposition, { result: body.result });
        return json(result, result.accepted ? 200 : 409);
      }
      case "fail": {
        const { operation: _, ...args } = body;
        const result = await ctx.runMutation(internal.market_research.failRun, args);
        return json(result, result.accepted ? 200 : 409);
      }
    }
  } catch {
    return json({ error: "Market-research Pi operation failed." }, 400);
  }
});

export const marketResearchDiscord = httpAction(async (ctx, request) => {
  if (!authorizedDiscordGatewayRequest(request)) return json({ error: "Unauthorized." }, 401);
  const parsed = discordRequest.safeParse(await boundedJson(request));
  if (!parsed.success) return json({ error: "Invalid market-research Discord request." }, 400);
  try {
    const body = parsed.data;
    switch (body.operation) {
      case "claimPublication": {
        const { operation: _, ...args } = body;
        return json(await ctx.runMutation(internal.market_research.claimPublication, args));
      }
      case "heartbeatPublication": {
        const { operation: _, ...args } = body;
        return json(await ctx.runMutation(internal.market_research.heartbeatPublication, args));
      }
      case "acknowledgePublication": {
        const args = {
          editionId: body.editionId,
          publicationGeneration: body.publicationGeneration,
          publicationToken: body.publicationToken,
          deliveryId: body.deliveryId,
          deliveryToken: body.deliveryToken,
          status: body.status,
          ...(body.discordThreadId === undefined ? {} : { discordThreadId: body.discordThreadId }),
          ...(body.discordMessageId === undefined ? {} : { discordMessageId: body.discordMessageId }),
          ...(body.code === undefined ? {} : { code: body.code }),
          ...(body.retryable === undefined ? {} : { retryable: body.retryable }),
          ...(body.retryAfterMs === undefined ? {} : { retryAfterMs: body.retryAfterMs }),
        };
        const result = await ctx.runMutation(
          internal.market_research.acknowledgePublication,
          args,
        );
        return json(result, result.accepted ? 200 : 409);
      }
      case "adoptReconciledStarter": {
        const args = {
          editionId: body.editionId,
          publicationGeneration: body.publicationGeneration,
          publicationToken: body.publicationToken,
          discordThreadId: body.discordThreadId,
          starterMessageId: body.starterMessageId,
          contentHash: body.contentHash,
          ...(body.duplicateIncident === undefined ? {} : { duplicateIncident: body.duplicateIncident }),
        };
        const result = await ctx.runMutation(internal.market_research.adoptReconciledStarter, args);
        return json(result, result.accepted ? 200 : 409);
      }
    }
  } catch {
    return json({ error: "Market-research Discord operation failed." }, 400);
  }
});
