import { getEncoding } from "js-tiktoken";
import type { JsonValue } from "@earendil-works/pi-ai";
import type { MarketChartSpec } from "./market-chart.js";
import {
  researchPacketSchema,
  type DiscordSolResearchResponse,
  type ResearchPacket,
} from "./contracts.js";
import { DiscordAgentOutputError } from "./errors.js";

export const RESEARCH_PACKET_MAX_BYTES = 16_384;
export const RESEARCH_PACKET_TARGET_TOKENS = 2_500;
export const RESEARCH_PACKET_ESTIMATOR_VERSION =
  "js-tiktoken@1.0.21:o200k_base:gpt-5.6-sol-estimate:v1" as const;

const encoding = getEncoding("o200k_base");

export function serializedResearchPacket(packet: ResearchPacket): string {
  return JSON.stringify(packet);
}

export function estimateResearchPacketTokens(packet: ResearchPacket): number {
  return encoding.encode(serializedResearchPacket(packet)).length;
}

export function researchPacketBytes(packet: ResearchPacket): number {
  return Buffer.byteLength(serializedResearchPacket(packet), "utf8");
}

export interface ValidateResearchPacketOptions {
  evidenceUrls: ReadonlySet<string>;
  trustedChart?: {
    artifactId: string;
    spec: MarketChartSpec;
  };
  maximumBytes?: number;
}

export function validateResearchPacket(
  candidate: JsonValue | ResearchPacket,
  options: ValidateResearchPacketOptions,
): DiscordSolResearchResponse {
  const packet = researchPacketSchema.parse(candidate);
  const sourceIds = new Set(packet.sources.map((source) => source.id));
  for (const finding of packet.findings) {
    if (finding.sourceIds.some((sourceId) => !sourceIds.has(sourceId))) {
      throw new DiscordAgentOutputError("invalid_response_schema");
    }
  }
  for (const source of packet.sources) {
    if (!options.evidenceUrls.has(source.url)) {
      throw new DiscordAgentOutputError("unverified_source_url");
    }
  }

  let chart: MarketChartSpec | undefined;
  if (packet.trustedChart !== undefined) {
    if (
      options.trustedChart === undefined
      || packet.trustedChart.artifactId !== options.trustedChart.artifactId
    ) {
      throw new DiscordAgentOutputError("invalid_response_schema");
    }
    chart = options.trustedChart.spec;
  }

  const serializedBytes = researchPacketBytes(packet);
  if (serializedBytes > (options.maximumBytes ?? RESEARCH_PACKET_MAX_BYTES)) {
    throw new DiscordAgentOutputError("invalid_response_schema");
  }
  const estimatedTokens = estimateResearchPacketTokens(packet);
  const result: DiscordSolResearchResponse = {
    profile: "research",
    packet,
    estimator: {
      package: "js-tiktoken",
      packageVersion: "1.0.21",
      encoding: "o200k_base",
      modelMapping: "gpt-5.6-sol-estimate",
      exact: false,
      version: RESEARCH_PACKET_ESTIMATOR_VERSION,
      estimatedTokens,
      serializedBytes,
    },
  };
  if (chart !== undefined) result.chart = chart;
  return result;
}

export function researchPacketNeedsCompression(
  result: Pick<DiscordSolResearchResponse, "estimator">,
  targetTokens = RESEARCH_PACKET_TARGET_TOKENS,
): boolean {
  return result.estimator.estimatedTokens > targetTokens;
}
