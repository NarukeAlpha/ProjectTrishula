import { describe, expect, it } from "vitest";
import { discordGatewayRequestSchema } from "../convex/lib/discord_contract.js";

describe("Discord gateway HTTP contract", () => {
  it("requires an allowlist-compatible actor and worker on runnable polling", () => {
    expect(discordGatewayRequestSchema.safeParse({
      operation: "listRunnable",
      actorId: "user_01HWORKOSALLOWED",
      workerId: "discord-worker_1",
      limit: 20,
    }).success).toBe(true);
    expect(discordGatewayRequestSchema.safeParse({
      operation: "listRunnable",
      workerId: "discord-worker_1",
    }).success).toBe(false);
  });

  it("rejects unknown fields instead of forwarding them to an internal mutation", () => {
    expect(discordGatewayRequestSchema.safeParse({
      operation: "newestContext",
      actorId: "user_01HWORKOSALLOWED",
      guildId: "123",
      channelId: "456",
      ownerOverride: "user_01OTHER",
    }).success).toBe(false);
  });

  it("requires the delivery lease token on a sent acknowledgement", () => {
    expect(discordGatewayRequestSchema.safeParse({
      operation: "acknowledgeReply",
      actorId: "user_01HWORKOSALLOWED",
      outboxId: "outbox_1",
      status: "sent",
      discordMessageId: "123",
    }).success).toBe(false);
  });

  it("accepts an explicit acknowledgement reply kind", () => {
    expect(discordGatewayRequestSchema.safeParse({
      operation: "enqueueReply",
      actorId: "user_01HWORKOSALLOWED",
      sourceChannelId: "123",
      guildId: "456",
      channelId: "123",
      runId: "run_1",
      generation: 1,
      idempotencyKey: "run_1:ack",
      replyKind: "acknowledgement",
      content: "I picked this up and will check the market move.",
      recheckRequested: false,
      finalizesLoop: false,
    }).success).toBe(true);
    expect(discordGatewayRequestSchema.safeParse({
      operation: "enqueueReply",
      actorId: "user_01HWORKOSALLOWED",
      sourceChannelId: "123",
      guildId: "456",
      channelId: "123",
      runId: "run_1",
      generation: 1,
      idempotencyKey: "run_1:ack",
      replyKind: "status_update",
      content: "Working on it.",
      recheckRequested: false,
      finalizesLoop: false,
    }).success).toBe(false);
  });

  it("allows an outbox worker to renew a lease without changing the stage", () => {
    expect(discordGatewayRequestSchema.safeParse({
      operation: "heartbeat",
      actorId: "user_01HWORKOSALLOWED",
      instanceId: "discord_1",
      status: "online",
      run: {
        channelId: "123",
        runId: "run_1",
        generation: 1,
      },
    }).success).toBe(true);
  });
});
