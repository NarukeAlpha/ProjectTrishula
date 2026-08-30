import { Client } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type {
  AcknowledgeResult,
  CompleteLoopOptions,
  CompleteLoopResult,
  RunIdentity,
} from "../src/convex/client.js";
import type { LoopStage, OutboxItem } from "../src/contracts.js";
import {
  discordNonce,
  messageOptions,
  OutboxDispatcher,
  type ConvexOutboxClient,
} from "../src/outbox/dispatcher.js";

function outbox(overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    outboxId: "run-1:reply",
    sourceGuildId: "10",
    sourceChannelId: "20",
    guildId: "10",
    channelId: "20",
    runId: "run-1",
    generation: 1,
    status: "pending",
    content: "A concise reply.",
    recheckRequested: false,
    finalizesLoop: true,
    deliveryToken: "delivery-token-1",
    attempts: 0,
    createdAt: 1,
    ...overrides,
  };
}

class FakeConvex implements ConvexOutboxClient {
  acknowledgements: Array<{
    status: "sent" | "failed";
    discordMessageId?: string;
  }> = [];
  completions: Array<{
    outcome: "completed" | "error";
    options: CompleteLoopOptions | undefined;
  }> = [];

  async heartbeatRun(
    _identity: RunIdentity,
    _stage: LoopStage,
  ): Promise<boolean> {
    return true;
  }

  async acknowledgeReply(
    _item: Pick<OutboxItem, "outboxId" | "deliveryToken">,
    result: { status: "sent" | "failed"; discordMessageId?: string },
  ): Promise<AcknowledgeResult> {
    this.acknowledgements.push(result);
    return { status: result.status === "sent" ? "sent" : "failed" };
  }

  async completeLoop(
    _identity: RunIdentity,
    outcome: "completed" | "error",
    options?: CompleteLoopOptions,
  ): Promise<CompleteLoopResult> {
    this.completions.push({ outcome, options });
    return { status: "idle", pendingMessageCount: 0, recheckAccepted: false };
  }
}

interface FakeChannel {
  guildId?: string;
  isDMBased?: () => boolean;
  isSendable?: () => boolean;
  send: ReturnType<typeof vi.fn>;
}

function fakeClient(channel: FakeChannel, sendReady = true): Client {
  const client = new Client({ intents: [] });
  vi.spyOn(client, "isReady").mockReturnValue(sendReady);
  // SAFETY: Each test supplies the exact send-channel methods that the dispatcher reads.
  vi.spyOn(client.channels, "fetch").mockResolvedValue(channel as never);
  return client;
}

describe("OutboxDispatcher", () => {
  it("disables mentions, bounds text, and enforces a deterministic nonce", () => {
    const item = outbox({
      content: "x".repeat(2_500),
      replyToMessageId: "100",
    });
    const options = messageOptions(item);

    expect(options.content).toHaveLength(2_000);
    expect(options.allowedMentions).toEqual({ parse: [] });
    expect(options.reply).toEqual({
      messageReference: "100",
      failIfNotExists: false,
    });
    expect(options.nonce).toBe(discordNonce(item.outboxId));
    expect(String(options.nonce)).toHaveLength(24);
    expect(options.enforceNonce).toBe(true);
  });

  it("sends, acknowledges, and then completes a final reply", async () => {
    const send = vi.fn().mockResolvedValue({ id: "999" });
    const channel = {
      isSendable: () => true,
      isDMBased: () => false,
      guildId: "10",
      send,
    };
    const convex = new FakeConvex();
    const dispatcher = new OutboxDispatcher({
      client: fakeClient(channel),
      convex,
      schedule: vi.fn(),
    });

    await dispatcher.dispatch([outbox({ recheckRequested: true })]);

    expect(send).toHaveBeenCalledOnce();
    expect(convex.acknowledgements).toEqual([
      { status: "sent", discordMessageId: "999" },
    ]);
    expect(convex.completions).toEqual([
      {
        outcome: "completed",
        options: { recheckRequested: true },
      },
    ]);
  });

  it("recovers a sent final reply without sending it again", async () => {
    const channel = { send: vi.fn() };
    const client = fakeClient(channel);
    const convex = new FakeConvex();
    const dispatcher = new OutboxDispatcher({
      client,
      convex,
      schedule: vi.fn(),
    });

    await dispatcher.dispatch([
      outbox({
        status: "sent",
        deliveryToken: undefined,
        discordMessageId: "999",
      }),
    ]);

    expect(client.channels.fetch).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();
    expect(convex.acknowledgements).toHaveLength(0);
    expect(convex.completions).toHaveLength(1);
  });
});
