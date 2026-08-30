import type { DiscordGatewayConfig } from "../config.js";
import type { ZodType } from "zod";
import {
  acknowledgeRequestSchema,
  acknowledgeResponseSchema,
  replyRequestSchema,
  replyResponseSchema,
  researchRequestSchema,
  researchResponseSchema,
  triageRequestSchema,
  triageResponseSchema,
  type AcknowledgeRequest,
  type AcknowledgeResponse,
  type ReplyRequest,
  type ReplyResponse,
  type ResearchRequest,
  type ResearchResponse,
  type TriageRequest,
  type TriageResponse,
} from "../contracts.js";

type AgentRequest =
  | TriageRequest
  | AcknowledgeRequest
  | ResearchRequest
  | ReplyRequest;

export class PiAgentClient {
  private readonly endpoint: string;

  constructor(private readonly config: DiscordGatewayConfig) {
    this.endpoint = `${config.piServiceUrl}/discord/agents/run`;
  }

  async triage(
    input: TriageRequest,
    signal?: AbortSignal,
  ): Promise<TriageResponse> {
    return this.request(
      triageRequestSchema.parse(input),
      triageResponseSchema,
      signal,
    );
  }

  async research(
    input: ResearchRequest,
    signal?: AbortSignal,
  ): Promise<ResearchResponse> {
    return this.request(
      researchRequestSchema.parse(input),
      researchResponseSchema,
      signal,
    );
  }

  async acknowledge(
    input: AcknowledgeRequest,
    signal?: AbortSignal,
  ): Promise<AcknowledgeResponse> {
    return this.request(
      acknowledgeRequestSchema.parse(input),
      acknowledgeResponseSchema,
      signal,
    );
  }

  async reply(
    input: ReplyRequest,
    signal?: AbortSignal,
  ): Promise<ReplyResponse> {
    return this.request(
      replyRequestSchema.parse(input),
      replyResponseSchema,
      signal,
    );
  }

  private async request<Output>(
    body: AgentRequest,
    responseSchema: ZodType<Output>,
    signal?: AbortSignal,
  ): Promise<Output> {
    const timeout = AbortSignal.timeout(this.config.agentTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.piSharedSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: combined,
    });
    if (!response.ok)
      throw new Error(`Pi agent request failed with HTTP ${response.status}.`);
    const responseBody: unknown = await response.json();
    return responseSchema.parse(responseBody);
  }
}
