import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { authFileReady, createDegradedServer } from "../src/start.js";

describe("bootstrap degraded server", () => {
  it("returns health while rejecting every non-health route", async () => {
    const server = createDegradedServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    try {
      const address = server.address();
      if (address === null) throw new Error("Test server did not expose a TCP address.");
      // SAFETY: A server listening on a TCP host and port returns AddressInfo from address().
      const port = (address as import("node:net").AddressInfo).port;
      const baseUrl = `http://127.0.0.1:${port}`;
      await expect(request(baseUrl).get("/health")).resolves.toMatchObject({ status: 200 });
      await expect(request(baseUrl).get("/connections/robinhood/start")).resolves.toMatchObject({ status: 503 });
      await expect(request(baseUrl).post("/health")).resolves.toMatchObject({ status: 503 });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("recognizes only a complete Codex OAuth record", async () => {
    const root = await mkdtemp(join(tmpdir(), "signal-bootstrap-"));
    const path = join(root, "auth.json");
    try {
      expect(await authFileReady(path)).toBe(false);
      await writeFile(path, "{}\n", { mode: 0o600 });
      expect(await authFileReady(path)).toBe(false);
      await writeFile(path, JSON.stringify({
        "openai-codex": {
          type: "oauth",
          access: "opaque-access",
          refresh: "opaque-refresh",
        },
      }), { mode: 0o600 });
      expect(await authFileReady(path)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
