import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PiEvent } from "../src/contracts.js";
import { canonicalJson } from "../src/results/canonical-json.js";
import { ConvexClient } from "../src/results/convex-client.js";
import { silentLogger } from "./helpers.js";

function accepted(sequence = 1): Response {
  return Response.json({
    runId: "run_1",
    acceptedThrough: sequence,
    status: "streaming",
    leaseExpiresAt: Date.now() + 120_000,
  });
}

describe("ConvexClient", () => {
  it("hashes the canonical unsigned payload and sends bearer authentication", async () => {
    let body = "";
    let authorization = "";
    const client = new ConvexClient({
      siteUrl: "https://convex.example",
      sharedSecret: "secret",
      requestTimeoutMs: 1_000,
      retryAttempts: 1,
      logger: silentLogger,
      fetch: async (_input, init) => {
        body = String(init?.body);
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return accepted();
      },
    });

    await client.sendResult({
      commandId: "command_1",
      runId: "run_1",
      assistantMessageId: "message_1",
      sequence: 1,
      events: [{ type: "text_delta", text: "hello" }],
    });

    interface ResultEnvelope { payloadHash?: string; commandId: string; runId: string; assistantMessageId: string; sequence: number; events: PiEvent[] }
    const parsed: ResultEnvelope = JSON.parse(body);
    const actualHash = parsed.payloadHash;
    delete parsed.payloadHash;
    const expectedHash = createHash("sha256")
      .update(canonicalJson(parsed), "utf8")
      .digest("hex");
    expect(actualHash).toBe(expectedHash);
    expect(authorization).toBe("Bearer secret");
  });

  it("reuses identical payload bytes for a retry", async () => {
    vi.useFakeTimers();
    const bodies: string[] = [];
    let count = 0;
    const client = new ConvexClient({
      siteUrl: "https://convex.example",
      sharedSecret: "secret",
      requestTimeoutMs: 1_000,
      retryAttempts: 2,
      logger: silentLogger,
      fetch: async (_input, init) => {
        bodies.push(String(init?.body));
        count += 1;
        return count === 1 ? new Response("busy", { status: 503 }) : accepted();
      },
    });

    const request = client.sendResult({
      commandId: "command_1",
      runId: "run_1",
      assistantMessageId: "message_1",
      sequence: 1,
      events: [{ type: "text_delta", text: "hello" }],
    });
    await vi.advanceTimersByTimeAsync(250);
    await request;
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    vi.useRealTimers();
  });
});
