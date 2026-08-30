import {
  bucket,
  defineRailway,
  github,
  postgres,
  preserve,
  project,
  service,
  volume,
} from "railway/iac";

export default defineRailway(() => {
  // Railway normalizes its default ON_FAILURE policy and 10-retry limit to
  // unset values. Keep only non-default retry limits so plans remain stable.
  const projectTrishula = (rootDirectory: string) =>
    github("NarukeAlpha/ProjectTrishula", {
      branch: "master",
      checkSuites: false,
      rootDirectory,
    });

  const Postgres = postgres("Postgres", { region: "us-east4-eqdc4a" });
  const postgresVolume = volume("postgres-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "us-east4-eqdc4a",
    sizeMB: 5000,
  });
  const piData067cace47797df4b893f = volume("pi-data-067cace47797df4b893f", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "us-east4-eqdc4a",
    sizeMB: 5000,
  });
  const convexArtifacts = bucket("convex-artifacts", { region: "sjc" });
  const discord = service("discord", {
    source: projectTrishula("/apps/discord"),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
      watchPatterns: ["/apps/discord/**"],
    },
    deploy: {
      healthcheckPath: "/health",
      healthcheckTimeout: 120,
    },
    replicas: { "us-east4-eqdc4a": 1 },
    env: {
      CONVEX_DISCORD_SHARED_SECRET: preserve(),
      CONVEX_SITE_URL: preserve(),
      DISCORD_BOT_TOKEN: preserve(),
      DISCORD_OWNER_ID: preserve(),
      HOST: preserve(),
      NODE_ENV: preserve(),
      PI_DISCORD_SHARED_SECRET: preserve(),
      PI_SERVICE_URL: preserve(),
      PORT: preserve(),
    },
  });
  const convexDashboard = service("convex-dashboard", {
    source: projectTrishula("/infra/railway/convex-dashboard"),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
      watchPatterns: ["/infra/railway/convex-dashboard/**"],
    },
    deploy: {
      restartPolicyMaxRetries: 5,
    },
    replicas: { "us-east4-eqdc4a": 1 },
    env: {
      NEXT_PUBLIC_DEPLOYMENT_URL: preserve(),
    },
  });
  const web = service("web", {
    source: projectTrishula("/apps/web"),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
      watchPatterns: ["/apps/web/**"],
    },
    deploy: {
      healthcheckPath: "/healthz",
      healthcheckTimeout: 30,
      restartPolicyMaxRetries: 3,
    },
    replicas: { "us-east4-eqdc4a": 1 },
    env: {
      PUBLIC_APPLICATION_NAME: preserve(),
      PUBLIC_APPLICATION_VERSION: preserve(),
      PUBLIC_CONVEX_URL: preserve(),
      PUBLIC_DEMO_MODE: preserve(),
      PUBLIC_DISCORD_APPLICATION_ID: preserve(),
      PUBLIC_ENVIRONMENT: preserve(),
      PUBLIC_WORKOS_CLIENT_ID: preserve(),
      PUBLIC_WORKOS_REDIRECT_URI: preserve(),
    },
  });
  const convexFunctions = service("convex-functions", {
    source: projectTrishula("/"),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "infra/railway/convex-functions/Dockerfile",
      watchPatterns: ["/apps/convex/**", "/infra/railway/convex-functions/**"],
    },
    deploy: {
      healthcheckPath: "/health",
      healthcheckTimeout: 300,
      restartPolicyMaxRetries: 3,
    },
    replicas: { "us-east4-eqdc4a": 1 },
    env: {
      CONVEX_INSTANCE_NAME: preserve(),
      CONVEX_INSTANCE_SECRET: preserve(),
      CONVEX_SELF_HOSTED_URL: preserve(),
      DISCORD_GATEWAY_SHARED_SECRET: preserve(),
      SERVICE_SHARED_SECRET: preserve(),
      WEB_APP_ORIGIN: preserve(),
      WORKOS_ALLOWED_USER_IDS: preserve(),
      WORKOS_CLIENT_ID: preserve(),
    },
  });
  const convexBackend = service("convex-backend", {
    source: projectTrishula("/infra/railway/convex-backend"),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
      watchPatterns: ["/infra/railway/convex-backend/**"],
    },
    deploy: {
      healthcheckPath: "/version",
      healthcheckTimeout: 300,
    },
    replicas: { "us-east4-eqdc4a": 1 },
    env: {
      AWS_ACCESS_KEY_ID: preserve(),
      AWS_REGION: preserve(),
      AWS_S3_DISABLE_CHECKSUMS: preserve(),
      AWS_S3_DISABLE_SSE: preserve(),
      AWS_SECRET_ACCESS_KEY: preserve(),
      CONVEX_CLOUD_ORIGIN: preserve(),
      CONVEX_SITE_ORIGIN: preserve(),
      DISABLE_BEACON: preserve(),
      DISCORD_GATEWAY_SHARED_SECRET: preserve(),
      DO_NOT_REQUIRE_SSL: preserve(),
      EXECUTION_BASE_URL: preserve(),
      EXECUTION_PRIVATE_DOMAIN_SUFFIX: preserve(),
      INSTANCE_NAME: preserve(),
      INSTANCE_SECRET: preserve(),
      PORT: preserve(),
      POSTGRES_URL: preserve(),
      REDACT_LOGS_TO_CLIENT: preserve(),
      S3_ENDPOINT_URL: preserve(),
      S3_STORAGE_EXPORTS_BUCKET: preserve(),
      S3_STORAGE_FILES_BUCKET: preserve(),
      S3_STORAGE_MODULES_BUCKET: preserve(),
      S3_STORAGE_SEARCH_BUCKET: preserve(),
      S3_STORAGE_SNAPSHOT_IMPORTS_BUCKET: preserve(),
      SERVICE_SHARED_SECRET: preserve(),
      WEB_APP_ORIGIN: preserve(),
      WORKOS_ALLOWED_USER_IDS: preserve(),
      WORKOS_CLIENT_ID: preserve(),
    },
  });
  const pi = service("pi", {
    source: projectTrishula("/apps/pi"),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
      watchPatterns: ["/apps/pi/**"],
    },
    deploy: {
      healthcheckPath: "/health",
      healthcheckTimeout: 30,
      restartPolicyMaxRetries: 5,
    },
    replicas: { "us-east4-eqdc4a": 1 },
    networking: { privateNetworkEndpoint: "pi-u-067cace47797df4b893f" },
    volumeMounts: {
      "/data": piData067cace47797df4b893f,
    },
    env: {
      BOUND_ACTOR_ID: preserve(),
      BROKER_MODE: preserve(),
      CODEX_AUTH_MODE: preserve(),
      CONVEX_SITE_URL: preserve(),
      GLOBAL_CONCURRENCY: preserve(),
      HOST: preserve(),
      LIVE_TRADING_ENABLED: preserve(),
      NODE_ENV: preserve(),
      PI_AUTH_BOOTSTRAP: preserve(),
      PI_AUTH_PATH: preserve(),
      PI_CREDENTIALS_PATH: preserve(),
      PI_CREDENTIAL_ENCRYPTION_KEY: preserve(),
      PI_CREDENTIAL_KEY_VERSION: preserve(),
      PI_DISCORD_SHARED_SECRET: preserve(),
      PI_LUNA_MODEL: preserve(),
      PI_MODEL: preserve(),
      PI_SOL_MODEL: preserve(),
      PORT: preserve(),
      ROBINHOOD_MCP_URL: preserve(),
      ROBINHOOD_OAUTH_REDIRECT_URI: preserve(),
      SERVICE_SHARED_SECRET: preserve(),
    },
  });

  return project("signal-trading-poc", {
    resources: [
      discord,
      convexDashboard,
      Postgres,
      web,
      convexFunctions,
      convexBackend,
      pi,
      postgresVolume,
      piData067cace47797df4b893f,
      convexArtifacts,
    ],
  });
});
