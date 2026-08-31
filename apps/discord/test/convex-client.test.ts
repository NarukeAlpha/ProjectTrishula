import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscordGatewayConfig } from "../src/config.js";
import {
  ConvexDiscordClient,
  type RunIdentity,
} from "../src/convex/client.js";

const config: DiscordGatewayConfig = {
  environment: "test",
  host: "127.0.0.1",
  port: 8_080,
  discordBotToken: undefined,
  chartImgApiKey: undefined,
  discordOwnerId: "owner-1",
  convexSharedSecret: "c".repeat(32),
  piSharedSecret: "p".repeat(32),
  convexSiteUrl: "https://convex.example/http",
  piServiceUrl: "https://pi.example",
  loopPollIntervalMs: 5_000,
  outboxPollIntervalMs: 2_000,
  channelSyncIntervalMs: 300_000,
  leaseHeartbeatIntervalMs: 30_000,
  requestTimeoutMs: 30_000,
  agentTimeoutMs: 600_000,
  maxReconcileMessages: 500,
};

const run: RunIdentity = {
  guildId: "guild-1",
  channelId: "channel-1",
  runId: "run-1",
  generation: 2,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Convex Discord heartbeats", () => {
  it("sends only fields accepted by the strict nested run contract", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const request: unknown = JSON.parse(String(init?.body));
        requests.push(request);
        return new Response(
          JSON.stringify({
            ok: true,
            operation: "heartbeat",
            result: { gatewayAccepted: true, loopAccepted: true },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }),
    );

    const client = new ConvexDiscordClient(config, "discord-instance-1");
    await expect(client.heartbeatRun(run, "acknowledging")).resolves.toBe(
      true,
    );
    await expect(client.renewRunLease(run)).resolves.toBe(true);

    expect(requests).toEqual([
      {
        operation: "heartbeat",
        actorId: "owner-1",
        instanceId: "discord-instance-1",
        status: "online",
        run: {
          channelId: "channel-1",
          runId: "run-1",
          generation: 2,
          stage: "acknowledging",
        },
      },
      {
        operation: "heartbeat",
        actorId: "owner-1",
        instanceId: "discord-instance-1",
        status: "online",
        run: {
          channelId: "channel-1",
          runId: "run-1",
          generation: 2,
        },
      },
    ]);
  });
});
