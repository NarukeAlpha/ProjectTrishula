import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive();
const stableId = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9:_-]+$/);

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("production"),
    HOST: z.string().trim().min(1).default("0.0.0.0"),
    PORT: positiveInteger.max(65_535).default(8080),
    DISCORD_BOT_TOKEN: z.string().trim().min(20).optional(),
    CHART_IMG_API_KEY: z
      .string()
      .trim()
      .min(20)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    DISCORD_OWNER_ID: stableId,
    CONVEX_DISCORD_SHARED_SECRET: z.string().min(32),
    PI_DISCORD_SHARED_SECRET: z.string().min(32),
    CONVEX_SITE_URL: z.string().url(),
    PI_SERVICE_URL: z.string().url(),
    LOOP_POLL_INTERVAL_MS: positiveInteger
      .min(1_000)
      .max(60_000)
      .default(5_000),
    OUTBOX_POLL_INTERVAL_MS: positiveInteger
      .min(500)
      .max(60_000)
      .default(2_000),
    CHANNEL_SYNC_INTERVAL_MS: positiveInteger
      .min(30_000)
      .max(3_600_000)
      .default(300_000),
    LEASE_HEARTBEAT_INTERVAL_MS: positiveInteger
      .min(5_000)
      .max(120_000)
      .default(30_000),
    REQUEST_TIMEOUT_MS: positiveInteger.min(1_000).max(120_000).default(30_000),
    AGENT_TIMEOUT_MS: positiveInteger
      .min(10_000)
      .max(1_800_000)
      .default(600_000),
    DISCORD_MAX_RECONCILE_MESSAGES: positiveInteger
      .min(10)
      .max(1_000)
      .default(500),
  })
  .superRefine((value, context) => {
    if (value.CONVEX_DISCORD_SHARED_SECRET === value.PI_DISCORD_SHARED_SECRET) {
      context.addIssue({
        code: "custom",
        path: ["PI_DISCORD_SHARED_SECRET"],
        message: "Convex and Pi Discord secrets must be different.",
      });
    }
  });

export interface DiscordGatewayConfig {
  environment: "development" | "test" | "production";
  host: string;
  port: number;
  discordBotToken: string | undefined;
  chartImgApiKey: string | undefined;
  discordOwnerId: string;
  convexSharedSecret: string;
  piSharedSecret: string;
  convexSiteUrl: string;
  piServiceUrl: string;
  loopPollIntervalMs: number;
  outboxPollIntervalMs: number;
  channelSyncIntervalMs: number;
  leaseHeartbeatIntervalMs: number;
  requestTimeoutMs: number;
  agentTimeoutMs: number;
  maxReconcileMessages: number;
}

function normalizeBaseUrl(raw: string, label: string): string {
  const url = new URL(raw);
  if (url.search || url.hash)
    throw new Error(`${label} must not include a query or fragment.`);
  return url.toString().replace(/\/$/, "");
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): DiscordGatewayConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(`Invalid Discord gateway configuration: ${fields}`);
  }
  const value = parsed.data;
  const convexSiteUrl = normalizeBaseUrl(
    value.CONVEX_SITE_URL,
    "CONVEX_SITE_URL",
  );
  const convexUrl = new URL(convexSiteUrl);
  if (!convexUrl.pathname.endsWith("/http")) {
    throw new Error(
      "CONVEX_SITE_URL must use the Convex /http actions prefix.",
    );
  }
  const piServiceUrl = normalizeBaseUrl(value.PI_SERVICE_URL, "PI_SERVICE_URL");
  if (value.NODE_ENV === "production") {
    const allowedProtocols = new Set(["http:", "https:"]);
    if (!allowedProtocols.has(new URL(piServiceUrl).protocol)) {
      throw new Error("PI_SERVICE_URL must use HTTP or HTTPS.");
    }
    if (
      convexUrl.protocol !== "https:" &&
      !convexUrl.hostname.endsWith(".railway.internal")
    ) {
      throw new Error(
        "CONVEX_SITE_URL must use HTTPS outside Railway private networking.",
      );
    }
  }
  return {
    environment: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    discordBotToken: value.DISCORD_BOT_TOKEN,
    chartImgApiKey: value.CHART_IMG_API_KEY,
    discordOwnerId: value.DISCORD_OWNER_ID,
    convexSharedSecret: value.CONVEX_DISCORD_SHARED_SECRET,
    piSharedSecret: value.PI_DISCORD_SHARED_SECRET,
    convexSiteUrl,
    piServiceUrl,
    loopPollIntervalMs: value.LOOP_POLL_INTERVAL_MS,
    outboxPollIntervalMs: value.OUTBOX_POLL_INTERVAL_MS,
    channelSyncIntervalMs: value.CHANNEL_SYNC_INTERVAL_MS,
    leaseHeartbeatIntervalMs: value.LEASE_HEARTBEAT_INTERVAL_MS,
    requestTimeoutMs: value.REQUEST_TIMEOUT_MS,
    agentTimeoutMs: value.AGENT_TIMEOUT_MS,
    maxReconcileMessages: value.DISCORD_MAX_RECONCILE_MESSAGES,
  };
}
