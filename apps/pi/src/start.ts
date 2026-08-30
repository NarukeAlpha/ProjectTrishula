import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { authPathFromEnvironment, runCodexAuth } from "./auth/codex-cli.js";

const SIGNAL_SERVICE_NAME = "signal-execution-backend";
const POLL_INTERVAL_MS = 1_000;
const codexAuthFileSchema = z.object({
  "openai-codex": z.object({
    type: z.literal("oauth"),
    access: z.string().min(1),
    refresh: z.string().min(1),
  }).passthrough(),
}).passthrough();

export async function authFileReady(path: string): Promise<boolean> {
  try {
    const parsed = codexAuthFileSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    return parsed.success;
  } catch {
    return false;
  }
}

export function createDegradedServer(): Server {
  return createServer((request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.method === "GET" && request.url === "/health") {
      response.statusCode = 200;
      response.end(JSON.stringify({
        ok: false,
        service: SIGNAL_SERVICE_NAME,
        status: "auth_bootstrap_required",
      }));
      return;
    }
    response.statusCode = 503;
    response.end(JSON.stringify({ error: "auth_bootstrap_required" }));
  });
}

async function listenDegradedServer(server: Server): Promise<void> {
  const host = process.env.HOST?.trim() || "0.0.0.0";
  const port = Number.parseInt(process.env.PORT ?? "8080", 10);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function waitForAuth(path: string): Promise<void> {
  while (!await authFileReady(path)) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

export async function start(): Promise<void> {
  const authPath = authPathFromEnvironment();
  if (await authFileReady(authPath)) {
    await import("./main.js");
    return;
  }

  const degradedServer = createDegradedServer();
  await listenDegradedServer(degradedServer);
  if (process.env.PI_AUTH_BOOTSTRAP === "true") {
    void runCodexAuth().catch(() => {
      console.error("Codex bootstrap did not complete. The degraded health server remains active.");
    });
  }
  await waitForAuth(authPath);
  await closeServer(degradedServer);
  await import("./main.js");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((error) => {
    console.error(error instanceof Error ? error.message : "Signal startup failed.");
    process.exitCode = 1;
  });
}
