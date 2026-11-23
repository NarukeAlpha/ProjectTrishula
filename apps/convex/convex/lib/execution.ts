import { sha256Hex } from "./canonical_json.js";

const EXECUTION_ENVIRONMENT_NAMES = [
  "EXECUTION_PRIVATE_DOMAIN_SUFFIX",
  "SERVICE_SHARED_SECRET",
] as const;

type ExecutionEnvironmentName = (typeof EXECUTION_ENVIRONMENT_NAMES)[number];

function requiredEnvironment(name: ExecutionEnvironmentName): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function requireActorId(actorId: string): string {
  if (!/^[A-Za-z0-9:_-]{1,256}$/.test(actorId)) {
    throw new Error("Execution actor ID is invalid.");
  }
  return actorId;
}

function requirePath(path: string): string {
  if (!path.startsWith("/")) throw new Error("Execution path must start with '/'.");
  return path;
}

function requireTimeoutMs(timeoutMs: number): number {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new Error("Execution request timeout is invalid.");
  }
  return timeoutMs;
}

export interface ExecutionRequestOptions {
  timeoutMs?: number;
}

function normalizeBaseUrl(raw: string, envName: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${envName} is invalid.`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw new Error(`${envName} must be an http:// or https:// base URL.`);
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

export async function executionServiceName(actorId: string): Promise<string> {
  const digest = await sha256Hex(requireActorId(actorId));
  return `pi-u-${digest.slice(0, 20)}`;
}

export async function executionUrl(actorId: string, path: string): Promise<string> {
  const suffix = requiredEnvironment("EXECUTION_PRIVATE_DOMAIN_SUFFIX")
    .replace(/^\.+/, "")
    .replace(/\/$/, "");
  if (!/^[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(suffix)) {
    throw new Error("EXECUTION_PRIVATE_DOMAIN_SUFFIX is invalid.");
  }
  return `http://${await executionServiceName(actorId)}.${suffix}${requirePath(path)}`;
}

export async function journalExecutionUrl(ownerId: string, path: string): Promise<string> {
  const normalizedPath = requirePath(path);
  const journalBaseUrl = process.env.JOURNAL_AGENT_BASE_URL?.trim();
  if (journalBaseUrl) {
    return `${normalizeBaseUrl(journalBaseUrl, "JOURNAL_AGENT_BASE_URL")}${normalizedPath}`;
  }
  const executionBaseUrl = process.env.EXECUTION_BASE_URL?.trim();
  if (executionBaseUrl) {
    return `${normalizeBaseUrl(executionBaseUrl, "EXECUTION_BASE_URL")}${normalizedPath}`;
  }
  const routedOwnerId = process.env.MARKET_RESEARCH_OWNER_ID?.trim() || ownerId;
  return executionUrl(routedOwnerId, normalizedPath);
}

async function postExecutionJson<TBody>(
  url: string,
  body: TBody,
  options: ExecutionRequestOptions,
  rejectRedirects = false,
): Promise<Response> {
  const request: RequestInit = {
    method: "POST",
    headers: {
      authorization: `Bearer ${requiredEnvironment("SERVICE_SHARED_SECRET")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  };
  if (rejectRedirects) {
    request.redirect = "error";
  }
  if (options.timeoutMs !== undefined) {
    request.signal = AbortSignal.timeout(requireTimeoutMs(options.timeoutMs));
  }
  return fetch(url, request);
}

export async function executionRequest<TBody>(
  actorId: string,
  path: string,
  body: TBody,
  options: ExecutionRequestOptions = {},
): Promise<Response> {
  const normalizedPath = requirePath(path);
  const executionBaseUrl = process.env.EXECUTION_BASE_URL?.trim();
  const url = executionBaseUrl
    ? `${normalizeBaseUrl(executionBaseUrl, "EXECUTION_BASE_URL")}${normalizedPath}`
    : await executionUrl(actorId, normalizedPath);
  const effectiveOptions: ExecutionRequestOptions = {
    timeoutMs: options.timeoutMs ?? 30_000,
  };
  return postExecutionJson(url, body, effectiveOptions, true);
}

export async function journalExecutionRequest<TBody>(
  ownerId: string,
  path: string,
  body: TBody,
  options: ExecutionRequestOptions = {},
): Promise<Response> {
  return postExecutionJson(await journalExecutionUrl(ownerId, path), body, options, true);
}
