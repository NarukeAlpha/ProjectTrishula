import { z } from "zod";
import { discordCompactionThreshold } from "./discord/compaction.js";
import { DISCORD_NATIVE_COMPACTION_LIVE_PROBE_ATTESTATION } from "./discord/native-compaction.js";

const positiveInteger = z.coerce.number().int().positive();
const stableActorId = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9:_-]+$/);

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  PORT: positiveInteger.max(65_535).default(8080),
  SERVICE_SHARED_SECRET: z.string().min(32),
  PI_DISCORD_SHARED_SECRET: z.string().min(32),
  CONVEX_SITE_URL: z.string().url().transform((value) => value.replace(/\/$/, "")),
  GLOBAL_CONCURRENCY: positiveInteger.max(64).default(4),
  RESULT_BATCH_WINDOW_MS: positiveInteger.max(100).default(25),
  RESULT_BATCH_BYTES: positiveInteger.max(60 * 1024).default(16 * 1024),
  CONVEX_REQUEST_TIMEOUT_MS: positiveInteger.max(60_000).default(10_000),
  CONVEX_RETRY_ATTEMPTS: positiveInteger.max(8).default(4),
  SHUTDOWN_TIMEOUT_MS: positiveInteger.max(120_000).default(25_000),
  BOUND_ACTOR_ID: stableActorId.optional(),
  PI_AUTH_PATH: z.string().trim().min(1).default("/data/auth.json"),
  PI_CREDENTIAL_ENCRYPTION_KEY: z.string().trim().min(32).optional(),
  PI_CREDENTIAL_KEY_VERSION: positiveInteger.max(1_000_000).default(1),
  PI_MODEL: z.string().trim().min(1).default("gpt-5.6-terra"),
  TRISHULA_LUNA_MODEL: z.literal("gpt-5.6-luna").default("gpt-5.6-luna"),
  TRISHULA_LUNA_REASONING_EFFORT: z.literal("xhigh").default("xhigh"),
  TRISHULA_LUNA_SERVICE_TIER: z.literal("priority").default("priority"),
  TRISHULA_SOL_MODEL: z.literal("gpt-5.6-sol").default("gpt-5.6-sol"),
  TRISHULA_SOL_REASONING_EFFORT: z.literal("max").default("max"),
  TRISHULA_SOL_SERVICE_TIER: z.literal("priority").default("priority"),
  TRISHULA_PERSONALITY_VERSION: z.literal("trishula-discord-v1").default("trishula-discord-v1"),
  TRISHULA_LUNA_PROFILE_VERSION: z.literal("luna-frontman-v1").default("luna-frontman-v1"),
  TRISHULA_SOL_PROFILE_VERSION: z.literal("sol-research-v1").default("sol-research-v1"),
  TRISHULA_MODEL_CONTEXT_WINDOW: z.coerce.number().refine((value) => value === 272_000)
    .default(272_000),
  TRISHULA_LUNA_MAX_OUTPUT_TOKENS: positiveInteger.max(32_000).default(8_000),
  TRISHULA_SOL_MAX_OUTPUT_TOKENS: positiveInteger.max(64_000).default(16_000),
  TRISHULA_RESEARCH_PACKET_TOKEN_TARGET: positiveInteger.max(8_000).default(2_500),
  TRISHULA_RESEARCH_PACKET_MAX_BYTES: positiveInteger.refine((value) => value === 16_384)
    .default(16_384),
  TRISHULA_RECENT_TAIL_TOKEN_BUDGET: positiveInteger.refine((value) => value === 20_000)
    .default(20_000),
  TRISHULA_MAX_AUTONOMOUS_RECHECKS: positiveInteger.refine((value) => value === 2)
    .default(2),
  TRISHULA_AMBIENT_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.85),
  TRISHULA_AMBIENT_MIN_ADDITIVE_VALUE: z.coerce.number().min(0).max(1).default(0.9),
  TRISHULA_HOT_SESSION_IDLE_MS: positiveInteger.max(24 * 60 * 60 * 1_000).default(60 * 60 * 1_000),
  TRISHULA_DURABLE_CONVERSATIONS_ENABLED: z.enum(["true", "false"]).default("true")
    .transform((value) => value === "true"),
  TRISHULA_HOT_SESSION_REUSE_ENABLED: z.enum(["true", "false"]).default("true")
    .transform((value) => value === "true"),
  TRISHULA_PORTABLE_CHECKPOINTS_ENABLED: z.enum(["true", "false"]).default("false")
    .transform((value) => value === "true"),
  TRISHULA_NATIVE_COMPACTION_ENABLED: z.enum(["true", "false"]).default("false")
    .transform((value) => value === "true"),
  TRISHULA_NATIVE_COMPACTION_LIVE_PROBE_ATTESTATION: z.string().trim().min(1).optional(),
  BROKER_MODE: z.enum(["mock", "robinhood"]).default("mock"),
  ROBINHOOD_OAUTH_REDIRECT_URI: z.string().url().optional(),
  ROBINHOOD_OAUTH_CLIENT_ID: z.string().trim().min(1).optional(),
  LIVE_TRADING_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
});

export interface AppConfig {
  environment: "development" | "test" | "production";
  host: string;
  port: number;
  sharedSecret: string;
  discordSharedSecret: string;
  convexSiteUrl: string;
  globalConcurrency: number;
  batchWindowMs: number;
  batchBytes: number;
  requestTimeoutMs: number;
  retryAttempts: number;
  shutdownTimeoutMs: number;
  boundActorId: string | undefined;
  piAuthPath: string;
  piCredentialEncryptionKey: string | undefined;
  piCredentialKeyVersion: number;
  piModel: string;
  trishulaLunaModel: "gpt-5.6-luna";
  trishulaLunaReasoningEffort: "xhigh";
  trishulaLunaServiceTier: "priority";
  trishulaSolModel: "gpt-5.6-sol";
  trishulaSolReasoningEffort: "max";
  trishulaSolServiceTier: "priority";
  trishulaPersonalityVersion: "trishula-discord-v1";
  trishulaLunaProfileVersion: "luna-frontman-v1";
  trishulaSolProfileVersion: "sol-research-v1";
  trishulaModelContextWindow: number;
  trishulaLunaMaxOutputTokens: number;
  trishulaSolMaxOutputTokens: number;
  trishulaResearchPacketTokenTarget: number;
  trishulaResearchPacketMaxBytes: number;
  trishulaRecentTailTokenBudget: number;
  trishulaMaxAutonomousRechecks: number;
  trishulaAmbientMinConfidence: number;
  trishulaAmbientMinAdditiveValue: number;
  trishulaCompactionReserve: number;
  trishulaCompactionThreshold: number;
  trishulaHotSessionIdleMs: number;
  trishulaDurableConversationsEnabled: boolean;
  trishulaHotSessionReuseEnabled: boolean;
  trishulaPortableCheckpointsEnabled: boolean;
  trishulaNativeCompactionEnabled: boolean;
  brokerMode: "mock" | "robinhood";
  robinhoodOAuthRedirectUri: string;
  robinhoodOAuthClientId?: string;
  liveTradingEnabled: boolean;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid execution backend configuration: ${fields}`);
  }

  const value = parsed.data;
  const convexUrl = new URL(value.CONVEX_SITE_URL);
  if (convexUrl.pathname !== "/http" || convexUrl.search !== "" || convexUrl.hash !== "") {
    throw new Error("CONVEX_SITE_URL must use the exact /http actions prefix.");
  }
  if (value.NODE_ENV === "production" && convexUrl.protocol !== "https:") {
    throw new Error("CONVEX_SITE_URL must use HTTPS in production.");
  }
  if (value.NODE_ENV === "production" && value.BOUND_ACTOR_ID === undefined) {
    throw new Error("BOUND_ACTOR_ID is required in production.");
  }
  if (value.PI_DISCORD_SHARED_SECRET === value.SERVICE_SHARED_SECRET) {
    throw new Error("PI_DISCORD_SHARED_SECRET must be independent from SERVICE_SHARED_SECRET.");
  }
  if (
    value.TRISHULA_NATIVE_COMPACTION_ENABLED
    && value.TRISHULA_NATIVE_COMPACTION_LIVE_PROBE_ATTESTATION
      !== DISCORD_NATIVE_COMPACTION_LIVE_PROBE_ATTESTATION
  ) {
    throw new Error(
      "TRISHULA_NATIVE_COMPACTION_LIVE_PROBE_ATTESTATION must match the reviewed live probe before native compaction is enabled.",
    );
  }
  if (
    value.TRISHULA_NATIVE_COMPACTION_ENABLED
    && !value.TRISHULA_PORTABLE_CHECKPOINTS_ENABLED
  ) {
    throw new Error(
      "TRISHULA_PORTABLE_CHECKPOINTS_ENABLED must be true before native compaction is enabled.",
    );
  }
  if (value.BROKER_MODE === "robinhood" && value.PI_CREDENTIAL_ENCRYPTION_KEY === undefined) {
    throw new Error("PI_CREDENTIAL_ENCRYPTION_KEY is required in Robinhood mode.");
  }

  const robinhoodOAuthRedirectUri = value.ROBINHOOD_OAUTH_REDIRECT_URI
    ?? `${value.CONVEX_SITE_URL}/broker/robinhood/callback`;
  const robinhoodRedirectUrl = new URL(robinhoodOAuthRedirectUri);
  if (
    robinhoodRedirectUrl.pathname !== "/http/broker/robinhood/callback"
    || robinhoodRedirectUrl.search !== ""
    || robinhoodRedirectUrl.hash !== ""
  ) {
    throw new Error("ROBINHOOD_OAUTH_REDIRECT_URI must use the exact /http/broker/robinhood/callback path.");
  }
  if (value.NODE_ENV === "production" && robinhoodRedirectUrl.protocol !== "https:") {
    throw new Error("ROBINHOOD_OAUTH_REDIRECT_URI must use HTTPS in production.");
  }
  if (robinhoodRedirectUrl.origin !== convexUrl.origin) {
    throw new Error("ROBINHOOD_OAUTH_REDIRECT_URI must use the CONVEX_SITE_URL origin.");
  }

  const compaction = discordCompactionThreshold({
    contextWindow: value.TRISHULA_MODEL_CONTEXT_WINDOW,
    maxOutputTokens: value.TRISHULA_LUNA_MAX_OUTPUT_TOKENS,
    maxResearchHandoffTokens: value.TRISHULA_RESEARCH_PACKET_TOKEN_TARGET,
  });
  const config: AppConfig = {
    environment: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    sharedSecret: value.SERVICE_SHARED_SECRET,
    discordSharedSecret: value.PI_DISCORD_SHARED_SECRET,
    convexSiteUrl: value.CONVEX_SITE_URL,
    globalConcurrency: value.GLOBAL_CONCURRENCY,
    batchWindowMs: value.RESULT_BATCH_WINDOW_MS,
    batchBytes: value.RESULT_BATCH_BYTES,
    requestTimeoutMs: value.CONVEX_REQUEST_TIMEOUT_MS,
    retryAttempts: value.CONVEX_RETRY_ATTEMPTS,
    shutdownTimeoutMs: value.SHUTDOWN_TIMEOUT_MS,
    boundActorId: value.BOUND_ACTOR_ID,
    piAuthPath: value.PI_AUTH_PATH,
    piCredentialEncryptionKey: value.PI_CREDENTIAL_ENCRYPTION_KEY,
    piCredentialKeyVersion: value.PI_CREDENTIAL_KEY_VERSION,
    piModel: value.PI_MODEL,
    trishulaLunaModel: value.TRISHULA_LUNA_MODEL,
    trishulaLunaReasoningEffort: value.TRISHULA_LUNA_REASONING_EFFORT,
    trishulaLunaServiceTier: value.TRISHULA_LUNA_SERVICE_TIER,
    trishulaSolModel: value.TRISHULA_SOL_MODEL,
    trishulaSolReasoningEffort: value.TRISHULA_SOL_REASONING_EFFORT,
    trishulaSolServiceTier: value.TRISHULA_SOL_SERVICE_TIER,
    trishulaPersonalityVersion: value.TRISHULA_PERSONALITY_VERSION,
    trishulaLunaProfileVersion: value.TRISHULA_LUNA_PROFILE_VERSION,
    trishulaSolProfileVersion: value.TRISHULA_SOL_PROFILE_VERSION,
    trishulaModelContextWindow: value.TRISHULA_MODEL_CONTEXT_WINDOW,
    trishulaLunaMaxOutputTokens: value.TRISHULA_LUNA_MAX_OUTPUT_TOKENS,
    trishulaSolMaxOutputTokens: value.TRISHULA_SOL_MAX_OUTPUT_TOKENS,
    trishulaResearchPacketTokenTarget: value.TRISHULA_RESEARCH_PACKET_TOKEN_TARGET,
    trishulaResearchPacketMaxBytes: value.TRISHULA_RESEARCH_PACKET_MAX_BYTES,
    trishulaRecentTailTokenBudget: value.TRISHULA_RECENT_TAIL_TOKEN_BUDGET,
    trishulaMaxAutonomousRechecks: value.TRISHULA_MAX_AUTONOMOUS_RECHECKS,
    trishulaAmbientMinConfidence: value.TRISHULA_AMBIENT_MIN_CONFIDENCE,
    trishulaAmbientMinAdditiveValue: value.TRISHULA_AMBIENT_MIN_ADDITIVE_VALUE,
    trishulaCompactionReserve: compaction.reserve,
    trishulaCompactionThreshold: compaction.threshold,
    trishulaHotSessionIdleMs: value.TRISHULA_HOT_SESSION_IDLE_MS,
    trishulaDurableConversationsEnabled: value.TRISHULA_DURABLE_CONVERSATIONS_ENABLED,
    trishulaHotSessionReuseEnabled: value.TRISHULA_HOT_SESSION_REUSE_ENABLED,
    trishulaPortableCheckpointsEnabled: value.TRISHULA_PORTABLE_CHECKPOINTS_ENABLED,
    trishulaNativeCompactionEnabled: value.TRISHULA_NATIVE_COMPACTION_ENABLED,
    brokerMode: value.BROKER_MODE,
    robinhoodOAuthRedirectUri,
    liveTradingEnabled: value.LIVE_TRADING_ENABLED,
  };
  if (value.ROBINHOOD_OAUTH_CLIENT_ID !== undefined) config.robinhoodOAuthClientId = value.ROBINHOOD_OAUTH_CLIENT_ID;
  return config;
}
