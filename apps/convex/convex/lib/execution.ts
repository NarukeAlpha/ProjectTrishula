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

export async function executionRequest<TBody>(
  actorId: string,
  path: string,
  body: TBody,
): Promise<Response> {
  return fetch(await executionUrl(actorId, path), {
    method: "POST",
    headers: {
      authorization: `Bearer ${requiredEnvironment("SERVICE_SHARED_SECRET")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
