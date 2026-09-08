import { Routes, type Client } from "discord.js";
import type { ChannelReference } from "../contracts.js";

export interface DiscordTypingIndicator {
  start(channel: ChannelReference, signal: AbortSignal): () => void;
}

export async function sendDiscordTyping(
  client: Pick<Client, "guilds" | "rest">,
  target: ChannelReference,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  const guild = client.guilds.cache.get(target.guildId);
  const channel = guild?.channels.cache.get(target.channelId);
  if (channel?.guildId !== target.guildId || !channel.isSendable()) return;
  await client.rest.post(Routes.channelTyping(target.channelId), { signal });
}

export class DiscordTypingIndicatorManager implements DiscordTypingIndicator {
  private readonly active = new Map<string, () => void>();
  private readonly inFlight = new Set<string>();
  private disposed = false;

  constructor(private readonly send: (channel: ChannelReference, signal: AbortSignal) => Promise<void>) {}

  start(channel: ChannelReference, signal: AbortSignal): () => void {
    if (this.disposed || signal.aborted) return () => undefined;
    const key = `${channel.guildId}:${channel.channelId}`;
    this.active.get(key)?.();
    const controller = new AbortController();
    const pulse = async (): Promise<void> => {
      if (controller.signal.aborted || this.inFlight.has(key)) return;
      this.inFlight.add(key);
      try {
        await this.send(channel, controller.signal);
      } catch {
        // Typing is optional presence. Discord errors must not affect model work.
      } finally {
        this.inFlight.delete(key);
      }
    };
    const timer = setInterval(() => { void pulse(); }, 8_000);
    timer.unref();
    const stop = (): void => {
      if (controller.signal.aborted) return;
      clearInterval(timer);
      signal.removeEventListener("abort", stop);
      controller.abort();
      if (this.active.get(key) === stop) this.active.delete(key);
    };
    this.active.set(key, stop);
    signal.addEventListener("abort", stop, { once: true });
    void pulse();
    return stop;
  }

  dispose(): void {
    this.disposed = true;
    for (const stop of this.active.values()) stop();
  }
}
