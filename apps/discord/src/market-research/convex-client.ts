/* oxlint-disable anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters -- The authenticated Convex transport parses JSON replies and omits unavailable exact optional fields. */
import { z } from "zod";
import type { DiscordGatewayConfig } from "../config.js";
import {
  publicationClaimSchema,
  type ClaimedPublication,
  type PublicationAcknowledgement,
  type PublicationClaim,
} from "./contracts.js";

const acceptedSchema = z.object({ accepted: z.boolean() }).passthrough();

export interface MarketResearchPublicationClient {
  claimPublication(workerId: string, signal?: AbortSignal): Promise<PublicationClaim>;
  heartbeatPublication(claim: ClaimedPublication, signal?: AbortSignal): Promise<boolean>;
  acknowledgePublication(
    claim: ClaimedPublication,
    result: PublicationAcknowledgement,
    signal?: AbortSignal,
  ): Promise<boolean>;
  adoptReconciledStarter(
    claim: ClaimedPublication,
    threadId: string,
    starterMessageId: string,
    signal?: AbortSignal,
    duplicateIncident?: boolean,
  ): Promise<boolean>;
}

export class ConvexMarketResearchPublicationClient implements MarketResearchPublicationClient {
  private readonly endpoint: string;

  constructor(
    private readonly config: DiscordGatewayConfig,
    private readonly ownerId: string,
  ) {
    this.endpoint = `${config.convexSiteUrl}/market-research/discord`;
  }

  async claimPublication(workerId: string, signal?: AbortSignal): Promise<PublicationClaim> {
    return this.request({ operation: "claimPublication", ownerId: this.ownerId, workerId }, publicationClaimSchema, signal);
  }

  async heartbeatPublication(claim: ClaimedPublication, signal?: AbortSignal): Promise<boolean> {
    const result = await this.request({
      operation: "heartbeatPublication",
      editionId: claim.editionId,
      publicationGeneration: claim.publicationGeneration,
      publicationToken: claim.publicationToken,
    }, acceptedSchema, signal);
    return result.accepted;
  }

  async acknowledgePublication(
    claim: ClaimedPublication,
    result: PublicationAcknowledgement,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const response = await this.request({
      operation: "acknowledgePublication",
      editionId: claim.editionId,
      publicationGeneration: claim.publicationGeneration,
      publicationToken: claim.publicationToken,
      deliveryId: claim.delivery.deliveryId,
      deliveryToken: claim.delivery.deliveryToken,
      status: result.status,
      ...(result.discordThreadId === undefined ? {} : { discordThreadId: result.discordThreadId }),
      ...(result.discordMessageId === undefined ? {} : { discordMessageId: result.discordMessageId }),
      ...(result.code === undefined ? {} : { code: result.code }),
      ...(result.retryable === undefined ? {} : { retryable: result.retryable }),
      ...(result.retryAfterMs === undefined ? {} : { retryAfterMs: result.retryAfterMs }),
    }, acceptedSchema, signal);
    return response.accepted;
  }

  async adoptReconciledStarter(
    claim: ClaimedPublication,
    threadId: string,
    starterMessageId: string,
    signal?: AbortSignal,
    duplicateIncident?: boolean,
  ): Promise<boolean> {
    const result = await this.request({
      operation: "adoptReconciledStarter",
      editionId: claim.editionId,
      publicationGeneration: claim.publicationGeneration,
      publicationToken: claim.publicationToken,
      discordThreadId: threadId,
      starterMessageId,
      contentHash: claim.delivery.contentHash,
      ...(duplicateIncident === undefined ? {} : { duplicateIncident }),
    }, acceptedSchema, signal);
    return result.accepted;
  }

  private async request<T>(
    body: unknown,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${this.config.convexSharedSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`market_research_convex_${response.status}`);
      return schema.parse(await response.json());
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}
