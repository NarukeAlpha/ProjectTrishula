import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  type Guild,
  type GuildBasedChannel,
  type GuildTextBasedChannel,
  type Message,
} from "discord.js";
import type { DiscordGatewayConfig } from "../config.js";
import type {
  ConvexDiscordClient,
  GatewayHeartbeat,
  MonitoredChannelCursor,
} from "../convex/client.js";
import type {
  DiscoveredChannel,
  DiscoveredGuild,
  StoredMessage,
} from "../contracts.js";
import type { ChannelLoopOrchestrator } from "../orchestrator/channel-loop.js";
import { logger } from "../runtime/logger.js";

export interface DiscordGatewayDependencies {
  config: DiscordGatewayConfig;
  convex: ConvexDiscordClient;
  orchestrator: ChannelLoopOrchestrator;
}

export interface DiscordGatewayHealth {
  configured: boolean;
  connected: boolean;
  guildCount: number;
  readyAt: string | null;
}

function channelType(
  channel: GuildBasedChannel,
): DiscoveredChannel["type"] | null {
  if (channel.type === ChannelType.GuildText) return "text";
  if (channel.type === ChannelType.GuildAnnouncement) return "announcement";
  if (channel.type === ChannelType.GuildForum) return "forum";
  if (
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread
  )
    return "other";
  return null;
}

function discoveredChannel(
  channel: GuildBasedChannel,
): DiscoveredChannel | null {
  const type = channelType(channel);
  if (type === null || !("name" in channel)) return null;
  const member = channel.guild.members.me;
  const permissions = member ? channel.permissionsFor(member) : null;
  return {
    channelId: channel.id,
    name: channel.name,
    type,
    canView: permissions?.has(PermissionFlagsBits.ViewChannel) ?? false,
    canSend:
      channel.isSendable() &&
      (permissions?.has(PermissionFlagsBits.SendMessages) ||
        permissions?.has(PermissionFlagsBits.SendMessagesInThreads) ||
        false),
    canReadHistory:
      permissions?.has(PermissionFlagsBits.ReadMessageHistory) ?? false,
  };
}

function discoveredGuild(guild: Guild): DiscoveredGuild {
  const channels = [...guild.channels.cache.values()]
    .map(discoveredChannel)
    .filter((channel): channel is DiscoveredChannel => channel !== null)
    .slice(0, 500);
  const iconUrl = guild.iconURL({ extension: "png", size: 128 }) ?? undefined;
  const result: DiscoveredGuild = {
    guildId: guild.id,
    name: guild.name,
    permissions: {
      viewChannels: channels.some((channel) => channel.canView),
      sendMessages: channels.some((channel) => channel.canSend),
      readMessageHistory: channels.some((channel) => channel.canReadHistory),
      messageContent: true,
    },
    channels,
  };
  if (iconUrl !== undefined) result.iconUrl = iconUrl;
  return result;
}

function storedMessage(
  message: Message,
  ownBotUserId?: string,
): StoredMessage | null {
  if (
    !message.inGuild() ||
    message.webhookId ||
    message.author.id === ownBotUserId
  )
    return null;
  const content = message.content.trim().slice(0, 4_000);
  if (!content) return null;
  const payload: StoredMessage = {
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    authorId: message.author.id,
    authorName: (
      message.member?.displayName ||
      message.author.globalName ||
      message.author.username
    ).slice(0, 200),
    content,
    createdAt: message.createdTimestamp,
    isBot: message.author.bot,
  };
  if (message.reference?.messageId !== undefined) {
    payload.replyToMessageId = message.reference.messageId;
  }
  return payload;
}

function textChannel(
  channel: GuildBasedChannel | null,
): GuildTextBasedChannel | null {
  return channel?.isTextBased() && "messages" in channel ? channel : null;
}

export class DiscordGateway {
  readonly client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  private connectedAt: number | undefined;
  private syncing = false;

  constructor(private readonly dependencies: DiscordGatewayDependencies) {
    this.client.on(Events.ClientReady, () => {
      this.connectedAt = Date.now();
      logger.info("Discord gateway connected.");
      void this.synchronizeAndReconcile();
    });
    this.client.on(
      Events.MessageCreate,
      (message) => void this.onMessage(message),
    );
    this.client.on(
      Events.ChannelCreate,
      () => void this.synchronizeAndReconcile(false),
    );
    this.client.on(
      Events.ChannelUpdate,
      () => void this.synchronizeAndReconcile(false),
    );
    this.client.on(
      Events.ChannelDelete,
      () => void this.synchronizeAndReconcile(false),
    );
    this.client.on(
      Events.GuildCreate,
      () => void this.synchronizeAndReconcile(false),
    );
    this.client.on(
      Events.GuildDelete,
      () => void this.synchronizeAndReconcile(false),
    );
    this.client.on(Events.Error, () => {
      logger.error("Discord gateway emitted an error.", {
        code: "gateway_error",
      });
    });
    this.client.on(Events.ShardDisconnect, () => {
      logger.warn("Discord gateway disconnected.");
      void this.dependencies.convex
        .heartbeatGateway({
          ...this.heartbeatDetails(),
          status: "degraded",
          error: "Discord gateway disconnected.",
        })
        .catch(() => undefined);
    });
  }

  async start(token: string): Promise<void> {
    await this.client.login(token);
  }

  async stop(): Promise<void> {
    this.client.destroy();
  }

  health(): DiscordGatewayHealth {
    return {
      configured: this.dependencies.config.discordBotToken !== undefined,
      connected: this.client.isReady(),
      guildCount: this.client.guilds.cache.size,
      readyAt:
        this.connectedAt === undefined
          ? null
          : new Date(this.connectedAt).toISOString(),
    };
  }

  heartbeatDetails(): GatewayHeartbeat {
    const details: GatewayHeartbeat = {
      status: this.client.isReady() ? "online" : "degraded",
    };
    if (this.client.user !== null) {
      details.botUserId = this.client.user.id;
      details.botUserName = this.client.user.username;
    }
    if (this.connectedAt !== undefined) details.connectedAt = this.connectedAt;
    if (!this.client.isReady()) details.error = "Discord gateway is not ready.";
    return details;
  }

  async synchronizeAndReconcile(reconcile = true): Promise<void> {
    if (this.syncing || !this.client.isReady()) return;
    this.syncing = true;
    try {
      const guilds = [...this.client.guilds.cache.values()]
        .slice(0, 100)
        .map(discoveredGuild);
      const result = await this.dependencies.convex.syncGuilds(
        guilds,
        this.heartbeatDetails(),
      );
      if (reconcile) {
        for (const cursor of result.monitoredChannels)
          await this.reconcile(cursor);
      }
    } catch {
      logger.error("Discord channel synchronization failed.", {
        code: "channel_sync_failed",
      });
    } finally {
      this.syncing = false;
    }
  }

  private async onMessage(message: Message): Promise<void> {
    const payload = storedMessage(message, this.client.user?.id);
    if (payload === null) return;
    try {
      const result = await this.dependencies.convex.ingestMessage(payload);
      if (result.shouldSchedule) {
        this.dependencies.orchestrator.schedule({
          guildId: payload.guildId,
          channelId: payload.channelId,
        });
      }
    } catch {
      logger.error("Discord message ingestion failed.", {
        channelId: payload.channelId,
        guildId: payload.guildId,
        code: "message_ingest_failed",
      });
    }
  }

  private async reconcile(cursor: MonitoredChannelCursor): Promise<void> {
    const fetched = await this.client.channels.fetch(cursor.channelId);
    if (
      fetched === null ||
      fetched.isDMBased() ||
      fetched.guildId !== cursor.guildId
    )
      return;
    const channel = textChannel(fetched);
    if (channel === null) return;

    if (cursor.afterMessageId === null) {
      const recent = await channel.messages.fetch({
        limit: Math.min(10, this.dependencies.config.maxReconcileMessages),
      });
      await this.ingestReconciled([...recent.values()]);
      return;
    }

    let after = cursor.afterMessageId;
    let remaining = this.dependencies.config.maxReconcileMessages;
    while (remaining > 0) {
      const limit = Math.min(100, remaining);
      const messages = await channel.messages.fetch({ after, limit });
      if (messages.size === 0) return;
      const ordered = [...messages.values()].sort(
        (left, right) => left.createdTimestamp - right.createdTimestamp,
      );
      await this.ingestReconciled(ordered);
      const last = ordered.at(-1);
      if (last === undefined) return;
      after = last.id;
      remaining -= messages.size;
      if (messages.size < limit) return;
    }
    logger.warn("Discord history reconciliation reached its safety limit.", {
      channelId: cursor.channelId,
    });
  }

  private async ingestReconciled(messages: Message[]): Promise<void> {
    const ordered = [...messages].sort(
      (left, right) => left.createdTimestamp - right.createdTimestamp,
    );
    for (const message of ordered) {
      const payload = storedMessage(message, this.client.user?.id);
      if (payload === null) continue;
      const result = await this.dependencies.convex.ingestMessage(payload);
      if (result.shouldSchedule) {
        this.dependencies.orchestrator.schedule({
          guildId: payload.guildId,
          channelId: payload.channelId,
        });
      }
    }
  }
}

export { discoveredChannel, discoveredGuild, storedMessage };
