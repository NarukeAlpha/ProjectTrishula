export type Environment = "development" | "staging" | "production";

interface RuntimeConfigBase {
  environment: Environment;
  applicationName: string;
  applicationVersion: string;
}

export interface DemoRuntimeConfig extends RuntimeConfigBase {
  demoMode: true;
}

export interface ProductionRuntimeConfig extends RuntimeConfigBase {
  demoMode: false;
  convexUrl: string;
  workosClientId: string;
  workosRedirectUri: string;
  workosApiHostname?: string;
}

export type PublicRuntimeConfig = DemoRuntimeConfig | ProductionRuntimeConfig;

export interface RuntimeConfigSource {
  environment?: string | null;
  applicationName?: string | null;
  applicationVersion?: string | null;
  demoMode?: boolean | string | null;
  convexUrl?: string | null;
  workosClientId?: string | null;
  workosRedirectUri?: string | null;
  workosApiHostname?: string | null;
}

function requireText(value: string | null | undefined, field: string): string {
  if (!value || value.trim() === "") {
    throw new Error(`Public runtime configuration field ${field} is required.`);
  }
  return value.trim();
}

function requireUrl(
  value: string | null | undefined,
  field: string,
  preserveTrailingSlash = false,
): string {
  const text = requireText(value, field);
  const url = new URL(text);
  const permitsLocalHttp =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !permitsLocalHttp) {
    throw new Error(
      `Public runtime configuration field ${field} must use HTTPS.`,
    );
  }
  const normalized = url.toString();
  return preserveTrailingSlash ? normalized : normalized.replace(/\/$/, "");
}

function parseEnvironment(value: string): Environment {
  switch (value) {
    case "development":
    case "staging":
    case "production":
      return value;
    default:
      throw new Error(
        "Public runtime configuration field environment is invalid.",
      );
  }
}

export function parseRuntimeConfig(
  value: RuntimeConfigSource | null | undefined,
): PublicRuntimeConfig {
  if (!value) {
    throw new Error("Public runtime configuration did not load.");
  }
  const environment = parseEnvironment(
    requireText(value.environment, "environment"),
  );
  const base = {
    environment,
    applicationName: requireText(value.applicationName, "applicationName"),
    applicationVersion: requireText(
      value.applicationVersion,
      "applicationVersion",
    ),
  };
  if (value.demoMode === true) {
    return { ...base, demoMode: true };
  }
  if (value.demoMode !== false && value.demoMode !== undefined) {
    throw new Error(
      "Public runtime configuration field demoMode must be a boolean.",
    );
  }
  const workosClientId = requireText(value.workosClientId, "workosClientId");
  if (!workosClientId.startsWith("client_")) {
    throw new Error("The WorkOS client identifier must start with client_.");
  }
  const workosApiHostname =
    value.workosApiHostname === undefined
      ? undefined
      : requireText(value.workosApiHostname, "workosApiHostname");
  if (
    workosApiHostname &&
    !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(workosApiHostname)
  ) {
    throw new Error(
      "The WorkOS API hostname must be a valid hostname without a scheme, port, or path.",
    );
  }
  const config: ProductionRuntimeConfig = {
    ...base,
    demoMode: false,
    convexUrl: requireUrl(value.convexUrl, "convexUrl"),
    workosClientId,
    workosRedirectUri: requireUrl(
      value.workosRedirectUri,
      "workosRedirectUri",
      true,
    ),
  };
  if (workosApiHostname) config.workosApiHostname = workosApiHostname;
  return config;
}

export function getRuntimeConfig(): PublicRuntimeConfig {
  return parseRuntimeConfig(window.__SIGNAL_CONFIG__);
}
