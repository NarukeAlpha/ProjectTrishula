import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive();
const stableActorId = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9:_-]+$/);

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  PORT: positiveInteger.max(65_535).default(8080),
  SERVICE_SHARED_SECRET: z.string().min(32),
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

  const config: AppConfig = {
    environment: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    sharedSecret: value.SERVICE_SHARED_SECRET,
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
    brokerMode: value.BROKER_MODE,
    robinhoodOAuthRedirectUri,
    liveTradingEnabled: value.LIVE_TRADING_ENABLED,
  };
  if (value.ROBINHOOD_OAUTH_CLIENT_ID !== undefined) config.robinhoodOAuthClientId = value.ROBINHOOD_OAUTH_CLIENT_ID;
  return config;
}
