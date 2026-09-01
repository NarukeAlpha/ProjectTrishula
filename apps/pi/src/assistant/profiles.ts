import { createHash } from "node:crypto";
import {
  TRISHULA_BASE_IDENTITY,
  TRISHULA_PERSONALITY_VERSION,
  TRISHULA_SAFETY_POLICY,
  resolvedSystemPromptHash,
} from "./identity.js";

export const DISCORD_CAPABILITY_PROFILE_VERSION = "discord-public-research-v1";
export const WEB_CAPABILITY_PROFILE_VERSION = "web-broker-review-v1";

export const LOCKED_DISCORD_MODEL_PROFILES = {
  luna: {
    modelId: "gpt-5.6-luna",
    thinkingLevel: "xhigh",
    serviceTier: "priority",
    maximumOutputCharacters: 2_000,
    profileVersion: "luna-frontman-v1",
  },
  sol: {
    modelId: "gpt-5.6-sol",
    thinkingLevel: "ultra",
    piThinkingLevel: "max",
    serviceTier: "priority",
    maximumOutputCharacters: 16_384,
    profileVersion: "sol-research-v1",
  },
} as const;

/** Pi 0.84 exposes `max`; the Codex provider maps that harness level to the locked `ultra` value. */
export function withLockedSolReasoningMapping<
  Model extends { thinkingLevelMap?: Record<string, string | null> },
>(model: Model): Model {
  return {
    ...model,
    thinkingLevelMap: {
      ...model.thinkingLevelMap,
      max: LOCKED_DISCORD_MODEL_PROFILES.sol.thinkingLevel,
    },
  };
}

const DISCORD_CAPABILITY_POLICY = `Discord is public-research only. You have no brokerage, account, credential-vault, order, shell, process, code-execution, filesystem, or private-network capability. Never claim access to positions, balances, orders, private filings, or private user data. Never place an order, claim an order was placed, or create an executable order proposal. You may offer public analysis of catalysts, scenarios, risks, levels, and invalidation conditions. Keep participant-specific holdings, preferences, risk tolerance, corrections, and commitments attributed to the author who stated them.`;

const WEB_CAPABILITY_POLICY = `The authenticated web profile may use only the explicitly provided broker read tools and the review-only order proposal tool. A proposal is never an order. Never claim execution until the application supplies a confirmed execution result.`;

export interface ResolvedAssistantProfile {
  personalityVersion: string;
  capabilityProfileVersion: string;
  capabilityProfileHash: string;
  systemPrompt: string;
  systemPromptHash: string;
}

function profile(capabilityProfileVersion: string, policy: string): ResolvedAssistantProfile {
  const systemPrompt = [TRISHULA_BASE_IDENTITY, TRISHULA_SAFETY_POLICY, policy].join("\n\n");
  return {
    personalityVersion: TRISHULA_PERSONALITY_VERSION,
    capabilityProfileVersion,
    capabilityProfileHash: createHash("sha256").update(policy, "utf8").digest("hex"),
    systemPrompt,
    systemPromptHash: resolvedSystemPromptHash(systemPrompt),
  };
}

export const DISCORD_ASSISTANT_PROFILE = profile(
  DISCORD_CAPABILITY_PROFILE_VERSION,
  DISCORD_CAPABILITY_POLICY,
);

export const WEB_ASSISTANT_PROFILE = profile(
  WEB_CAPABILITY_PROFILE_VERSION,
  WEB_CAPABILITY_POLICY,
);

export function isLockedDiscordModelTuple(
  role: "luna" | "sol",
  value: { modelId: string; thinkingLevel: string; serviceTier: string },
): boolean {
  const locked = LOCKED_DISCORD_MODEL_PROFILES[role];
  return value.modelId === locked.modelId
    && value.thinkingLevel === locked.thinkingLevel
    && value.serviceTier === locked.serviceTier;
}
