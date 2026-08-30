import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express, { type Express } from "express";
import type { DiscordGatewayConfig } from "./config.js";
import { ConvexDiscordClient } from "./convex/client.js";
import {
  DiscordGateway,
  type DiscordGatewayHealth,
} from "./discord/gateway.js";
import { ChannelLoopOrchestrator } from "./orchestrator/channel-loop.js";
import { OutboxDispatcher } from "./outbox/dispatcher.js";
import { PiAgentClient } from "./pi/client.js";
import { logger } from "./runtime/logger.js";

export interface ServiceHealthResult {
  statusCode: number;
  body: {
    status: "ok" | "starting" | "not_configured";
    discord: DiscordGatewayHealth;
  };
}

export function serviceHealth(
  health: DiscordGatewayHealth,
): ServiceHealthResult {
  const status = !health.configured
    ? ("not_configured" as const)
    : health.connected
      ? ("ok" as const)
      : ("starting" as const);
  return { statusCode: 200, body: { status, discord: health } };
}

export class DiscordGatewayService {
  private readonly instanceId = `discord-${randomUUID()}`;
  private readonly workerId = `${this.instanceId}-worker`;
  private readonly convex: ConvexDiscordClient;
  private readonly orchestrator: ChannelLoopOrchestrator;
  private readonly gateway: DiscordGateway;
  private readonly outbox: OutboxDispatcher;
  private readonly app: Express;
  private readonly timers: NodeJS.Timeout[] = [];
  private server: Server | null = null;
  private polling = false;

  constructor(private readonly config: DiscordGatewayConfig) {
    this.convex = new ConvexDiscordClient(config, this.instanceId);
    const pi = new PiAgentClient(config);
    this.orchestrator = new ChannelLoopOrchestrator({
      convex: this.convex,
      pi,
      workerId: this.workerId,
      heartbeatIntervalMs: config.leaseHeartbeatIntervalMs,
    });
    this.gateway = new DiscordGateway({
      config,
      convex: this.convex,
      orchestrator: this.orchestrator,
    });
    this.outbox = new OutboxDispatcher({
      client: this.gateway.client,
      convex: this.convex,
      schedule: (channel) => this.orchestrator.schedule(channel),
    });
    this.app = this.createHttpApp();
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const server = this.app.listen(this.config.port, this.config.host, () => {
        this.server = server;
        resolve();
      });
      server.once("error", reject);
    });
    logger.info("Discord gateway health server listening.");
    const token = this.config.discordBotToken;
    if (token === undefined) {
      logger.warn("Discord gateway is waiting for DISCORD_BOT_TOKEN.");
      return;
    }
    try {
      await this.gateway.start(token);
    } catch (error) {
      await this.stop();
      throw error;
    }
    this.installPollers();
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
    await this.gateway.stop();
    if (this.server !== null) {
      const server = this.server;
      this.server = null;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }

  private installPollers(): void {
    const loopPoller = setInterval(
      () => void this.pollWork(),
      this.config.loopPollIntervalMs,
    );
    const outboxPoller = setInterval(
      () => void this.pollWork(),
      this.config.outboxPollIntervalMs,
    );
    const syncPoller = setInterval(
      () => void this.gateway.synchronizeAndReconcile(),
      this.config.channelSyncIntervalMs,
    );
    const heartbeatPoller = setInterval(() => {
      void this.convex
        .heartbeatGateway(this.gateway.heartbeatDetails())
        .catch(() => {
          logger.error("Discord gateway heartbeat failed.", {
            code: "gateway_heartbeat_failed",
          });
        });
    }, this.config.leaseHeartbeatIntervalMs);
    this.timers.push(loopPoller, outboxPoller, syncPoller, heartbeatPoller);
    void this.pollWork();
  }

  private async pollWork(): Promise<void> {
    if (this.polling || !this.gateway.client.isReady()) return;
    this.polling = true;
    try {
      const work = await this.convex.listRunnable(this.workerId);
      for (const channel of work.channels) {
        this.orchestrator.schedule({
          guildId: channel.guildId,
          channelId: channel.channelId,
        });
      }
      await this.outbox.dispatch(work.replies);
    } catch {
      logger.error("Runnable Discord work polling failed.", {
        code: "work_poll_failed",
      });
    } finally {
      this.polling = false;
    }
  }

  private createHttpApp(): Express {
    const app = express();
    app.disable("x-powered-by");
    app.get("/health", (_request, response) => {
      const result = serviceHealth(this.gateway.health());
      response.status(result.statusCode).json(result.body);
    });
    app.get("/ready", (_request, response) => {
      const discord = this.gateway.health();
      response.status(discord.connected ? 200 : 503).json({
        ready: discord.connected,
        reason: discord.configured ? undefined : "not_configured",
        discord,
      });
    });
    return app;
  }
}
