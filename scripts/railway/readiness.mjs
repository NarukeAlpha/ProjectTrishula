import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { deploymentMatchesSource, fullCommit } from "./deployment-source.mjs";

const { values } = parseArgs({
  options: {
    "expected-commit": { type: "string" },
    "expected-source": { type: "string" },
    environment: { type: "string", default: "production" },
  },
});

function railwayJson(args) {
  try {
    return JSON.parse(execFileSync("railway", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    }));
  } catch {
    // CLI errors can contain secret-bearing output. Report only the operation.
    throw new Error(`Railway ${args[0]} check failed; verify CLI access.`);
  }
}

function check(name, passed) {
  return { name, passed: Boolean(passed) };
}

function credential(value) {
  return typeof value === "string" && value.length >= 32;
}

function requiredUrl(value, expectedProtocol, expectedPath) {
  try {
    const url = new URL(value);
    return url.protocol === expectedProtocol && url.pathname === expectedPath
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function main() {
  for (const option of ["expected-commit", "expected-source"]) {
    if (values[option] !== undefined && !fullCommit(values[option])) {
      throw new Error(`--${option} requires a full Git commit ID.`);
    }
  }
  const state = railwayJson(["status", "--json"]);
  const environment = state.environments.edges.find(
    ({ node }) => node.name === values.environment,
  )?.node;
  if (!environment) throw new Error("Requested Railway environment not found.");
  const services = ["convex-functions", "pi", "discord", "web"];
  const deploymentChecks = services.map((name) => {
    const id = state.services.edges.find(({ node }) => node.name === name)?.node.id;
    const instance = environment.serviceInstances.edges.find(
      ({ node }) => node.serviceId === id,
    )?.node;
    const deployment = instance?.latestDeployment;
    const sourceMatches = values["expected-source"]
      ? deploymentMatchesSource(name, deployment?.meta?.commitHash, values["expected-source"])
      : null;
    return {
      service: name,
      status: deployment?.status ?? "MISSING",
      commit: deployment?.meta?.commitHash ?? null,
      sourceMatches,
      passed: ["SUCCESS", "SLEEPING"].includes(deployment?.status)
        && sourceMatches !== false
        && (!values["expected-commit"]
          || deployment?.meta?.commitHash === values["expected-commit"]),
    };
  });
  const variables = Object.fromEntries(
    ["pi", "discord", "convex-functions", "convex-backend", "web"].map(
      (service) => [service, railwayJson([
        "variable", "list", "--service", service,
        "--environment", values.environment, "--json",
      ])],
    ),
  );
  const pi = variables.pi;
  const discord = variables.discord;
  const backend = variables["convex-backend"];
  const deployer = variables["convex-functions"];
  const actor = pi.BOUND_ACTOR_ID;
  const actorEndpoint = typeof actor === "string"
    ? `pi-u-${createHash("sha256").update(actor).digest("hex").slice(0, 20)}`
    : null;
  const configurationChecks = [
    check("Pi owner matches Discord owner", actor && actor === discord.DISCORD_OWNER_ID),
    check("Owner is allowed by WorkOS", actor && backend.WORKOS_ALLOWED_USER_IDS?.split(",").map((id) => id.trim()).includes(actor)),
    check("Pi private hostname matches its owner", actorEndpoint && pi.RAILWAY_PRIVATE_DOMAIN?.startsWith(`${actorEndpoint}.`)),
    check("Discord bot credential is configured", credential(discord.DISCORD_BOT_TOKEN)),
    check("Discord-to-Pi credential matches", credential(pi.PI_DISCORD_SHARED_SECRET) && pi.PI_DISCORD_SHARED_SECRET === discord.PI_DISCORD_SHARED_SECRET),
    check("Discord-to-Convex credential matches", credential(backend.DISCORD_GATEWAY_SHARED_SECRET) && backend.DISCORD_GATEWAY_SHARED_SECRET === discord.CONVEX_DISCORD_SHARED_SECRET && backend.DISCORD_GATEWAY_SHARED_SECRET === deployer.DISCORD_GATEWAY_SHARED_SECRET),
    check("Execution credential matches", credential(pi.SERVICE_SHARED_SECRET) && pi.SERVICE_SHARED_SECRET === backend.SERVICE_SHARED_SECRET && pi.SERVICE_SHARED_SECRET === deployer.SERVICE_SHARED_SECRET),
    check("Service credentials are independent", pi.PI_DISCORD_SHARED_SECRET !== pi.SERVICE_SHARED_SECRET && backend.DISCORD_GATEWAY_SHARED_SECRET !== pi.SERVICE_SHARED_SECRET && backend.DISCORD_GATEWAY_SHARED_SECRET !== pi.PI_DISCORD_SHARED_SECRET),
    check("Pi Convex actions URL is valid", requiredUrl(pi.CONVEX_SITE_URL, "https:", "/http")),
    check("Discord uses the same Convex actions URL", discord.CONVEX_SITE_URL === pi.CONVEX_SITE_URL),
    check("Discord targets the configured Pi hostname", requiredUrl(discord.PI_SERVICE_URL, "http:", "/") && new URL(discord.PI_SERVICE_URL).hostname === pi.RAILWAY_PRIVATE_DOMAIN),
    check("Codex auth uses persistent storage", pi.PI_AUTH_PATH === "/data/auth.json"),
    check("Live trading remains disabled", pi.LIVE_TRADING_ENABLED === "false"),
  ];
  const features = {
    durableConversations: {
      pi: pi.TRISHULA_DURABLE_CONVERSATIONS_ENABLED ?? "runtime_default",
      discord: discord.TRISHULA_DURABLE_CONVERSATIONS_ENABLED ?? "runtime_default",
    },
    marketResearch: {
      pi: pi.MARKET_RESEARCH_ENABLED ?? "false",
      discord: discord.MARKET_RESEARCH_ENABLED ?? "false",
      exaConfigured: Boolean(pi.EXA_API_KEY),
      chartsConfigured: Boolean(discord.CHART_IMG_API_KEY),
    },
  };
  const passed = deploymentChecks.every((item) => item.passed)
    && configurationChecks.every((item) => item.passed);
  console.log(JSON.stringify({
    environment: values.environment,
    passed,
    deployments: deploymentChecks,
    configuration: configurationChecks,
    features,
    note: "This read-only check does not prove OAuth model access, Convex function environment sync, or Discord delivery.",
  }, null, 2));
  if (!passed) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
