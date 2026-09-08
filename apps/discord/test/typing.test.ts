import { getEventListeners } from "node:events";
import type { Client } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordTypingIndicatorManager, sendDiscordTyping } from "../src/discord/typing.js";

const target = { guildId: "10", channelId: "20" };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("Discord typing presence", () => {
  it("sends immediately, refreshes every eight seconds, and removes timers and abort listeners on stop", async () => {
    const send = vi.fn(async () => undefined);
    const manager = new DiscordTypingIndicatorManager(send);
    const parent = new AbortController();
    const stop = manager.start(target, parent.signal);
    expect(send).toHaveBeenCalledOnce();
    expect(getEventListeners(parent.signal, "abort")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(send).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    stop(); stop();
    expect(getEventListeners(parent.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("never overlaps or queues refreshes while a typing request is pending", async () => {
    const pending = Promise.withResolvers<void>();
    const send = vi.fn(() => pending.promise);
    const manager = new DiscordTypingIndicatorManager(send);
    const stop = manager.start(target, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(32_000);
    expect(send).toHaveBeenCalledOnce();
    pending.resolve(); await Promise.resolve();
    expect(send).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(send).toHaveBeenCalledTimes(2);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts pending network work on a lost lease without waiting for the response", () => {
    const parent = new AbortController();
    let networkSignal: AbortSignal | undefined;
    const manager = new DiscordTypingIndicatorManager(async (_channel, signal) => {
      networkSignal = signal;
      await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    manager.start(target, parent.signal);
    expect(networkSignal?.aborted).toBe(false);
    parent.abort();
    expect(networkSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(parent.signal, "abort")).toHaveLength(0);
  });

  it("does not send for an already-aborted lease", () => {
    const send = vi.fn(async () => undefined);
    const manager = new DiscordTypingIndicatorManager(send);
    const parent = new AbortController(); parent.abort();
    manager.start(target, parent.signal)();
    expect(send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a replaced window from overlapping its old pending request", async () => {
    const pending = Promise.withResolvers<void>();
    const signals: AbortSignal[] = [];
    const send = vi.fn(async (_channel, signal: AbortSignal) => { signals.push(signal); await pending.promise; });
    const manager = new DiscordTypingIndicatorManager(send);
    const first = manager.start(target, new AbortController().signal);
    const second = manager.start(target, new AbortController().signal);
    expect(signals[0]?.aborted).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    first();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(send).toHaveBeenCalledOnce();
    pending.resolve(); await Promise.resolve(); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(signals[1]?.aborted).toBe(false);
    second(); expect(signals[1]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("swallows synchronous and asynchronous transport failures", async () => {
    const send = vi.fn<(_channel: typeof target, _signal: AbortSignal) => Promise<void>>()
      .mockImplementationOnce(() => { throw new Error("Disconnected"); })
      .mockRejectedValueOnce(new Error("Rate limited"))
      .mockResolvedValue(undefined);
    const manager = new DiscordTypingIndicatorManager(send);
    const stop = manager.start(target, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(send).toHaveBeenCalledTimes(3);
    stop();
  });

  it("shutdown clears all active windows even when Discord never responds, and prevents later pulses", async () => {
    const pending = Promise.withResolvers<void>();
    const signals: AbortSignal[] = [];
    const send = vi.fn(async (_channel, signal: AbortSignal) => { signals.push(signal); await pending.promise; });
    const manager = new DiscordTypingIndicatorManager(send);
    const parent = new AbortController();
    manager.start(target, parent.signal);
    manager.start({ ...target, channelId: "30" }, parent.signal);
    manager.dispose(); manager.dispose();
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(getEventListeners(parent.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    manager.start(target, parent.signal);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(send).toHaveBeenCalledTimes(2);
    pending.resolve();
  });
});

describe("cached Discord typing target", () => {
  function fixture(guildId = "10", sendable = true) {
    const post = vi.fn(async () => undefined);
    const cache = new Map([["10", { channels: { cache: new Map([["20", { guildId, isSendable: () => sendable }]]) } }]]);
    // SAFETY: sendDiscordTyping only reads these caches and calls rest.post; no gateway/network behavior is stubbed indirectly.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The adapter fixture intentionally omits unrelated Discord client methods.
    const client = { guilds: { cache }, rest: { post } } as unknown as Pick<Client, "guilds" | "rest">;
    return { client, post };
  }

  it("posts to the claimed channel with the abort signal", async () => {
    const { client, post } = fixture();
    const signal = new AbortController().signal;
    await sendDiscordTyping(client, target, signal);
    expect(post).toHaveBeenCalledExactlyOnceWith("/channels/20/typing", { signal });
  });

  it("skips missing, wrong-guild, unsendable and aborted targets", async () => {
    for (const [guildId, sendable] of [["other", true], ["10", false]] as const) {
      const { client, post } = fixture(guildId, sendable);
      await sendDiscordTyping(client, target, new AbortController().signal);
      expect(post).not.toHaveBeenCalled();
    }
    const { client, post } = fixture();
    await sendDiscordTyping(client, { ...target, guildId: "missing" }, new AbortController().signal);
    await sendDiscordTyping(client, { ...target, channelId: "missing" }, new AbortController().signal);
    const parent = new AbortController(); parent.abort();
    await sendDiscordTyping(client, target, parent.signal);
    expect(post).not.toHaveBeenCalled();
  });
});
