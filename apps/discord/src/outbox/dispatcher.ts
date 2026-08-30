import { createHash } from "node:crypto";
import type { Client, MessageCreateOptions } from "discord.js";
import {
  ConvexDiscordOperationError,
  type AcknowledgeResult,
  type CompleteLoopResult,
  type RunIdentity,
} from "../convex/client.js";
import type { ChannelReference, LoopStage, OutboxItem } from "../contracts.js";
import { logger } from "../runtime/logger.js";

export interface ConvexOutboxClient {
  heartbeatRun(
    identity: RunIdentity,
    stage: LoopStage,
    signal?: AbortSignal,
  ): Promise<boolean>;
  acknowledgeReply(
    item: Pick<OutboxItem, "outboxId" | "deliveryToken">,
    result: {
      status: "sent" | "failed";
      discordMessageId?: string | undefined;
      error?: string | undefined;
      retryable?: boolean | undefined;
    },
    signal?: AbortSignal,
  ): Promise<AcknowledgeResult>;
  completeLoop(
    identity: RunIdentity,
    outcome: "completed" | "error",
    options?: { recheckRequested?: boolean; error?: string },
    signal?: AbortSignal,
  ): Promise<CompleteLoopResult>;
}

export interface OutboxDispatcherDependencies {
  client: Client;
  convex: ConvexOutboxClient;
  schedule: (channel: ChannelReference) => void;
}

function discordNonce(outboxId: string): string {
  return createHash("sha256").update(outboxId).digest("hex").slice(0, 24);
}

function messageOptions(item: OutboxItem): MessageCreateOptions {
  const options: MessageCreateOptions = {
    content: item.content.slice(0, 2_000),
    allowedMentions: { parse: [] },
    nonce: discordNonce(item.outboxId),
    enforceNonce: true,
  };
  if (item.replyToMessageId !== undefined) {
    options.reply = {
      messageReference: item.replyToMessageId,
      failIfNotExists: false,
    };
  }
  return options;
}

function runIdentity(item: OutboxItem): RunIdentity {
  return {
    guildId: item.sourceGuildId,
    channelId: item.sourceChannelId,
    runId: item.runId,
    generation: item.generation,
  };
}

function priority(item: OutboxItem): number {
  if (item.status === "sent") return 2;
  return item.finalizesLoop ? 1 : 0;
}

export class OutboxDispatcher {
  private readonly activeOutboxes = new Set<string>();

  constructor(private readonly dependencies: OutboxDispatcherDependencies) {}

  async dispatch(items: OutboxItem[]): Promise<void> {
    if (!this.dependencies.client.isReady()) return;
    const ordered = [...items].sort((left, right) => {
      const byPriority = priority(left) - priority(right);
      return byPriority === 0 ? left.createdAt - right.createdAt : byPriority;
    });
    for (const item of ordered) {
      if (this.activeOutboxes.has(item.outboxId)) continue;
      this.activeOutboxes.add(item.outboxId);
      try {
        await this.deliver(item);
      } finally {
        this.activeOutboxes.delete(item.outboxId);
      }
    }
  }

  private async deliver(item: OutboxItem): Promise<void> {
    if (item.status === "sent") {
      await this.finalize(item);
      return;
    }

    const identity = runIdentity(item);
    const active = await this.dependencies.convex.heartbeatRun(
      identity,
      "drafting",
    );
    if (!active) return;
    let sentMessageId: string;
    try {
      const channel = await this.dependencies.client.channels.fetch(
        item.channelId,
      );
      if (
        !channel?.isSendable() ||
        channel.isDMBased() ||
        channel.guildId !== item.guildId
      ) {
        await this.recordFailure(
          item,
          "Discord target channel is not sendable.",
          false,
        );
        return;
      }
      const sent = await channel.send(messageOptions(item));
      sentMessageId = sent.id;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Discord reply delivery failed.";
      await this.recordFailure(item, message, true);
      return;
    }

    try {
      await this.dependencies.convex.acknowledgeReply(item, {
        status: "sent",
        discordMessageId: sentMessageId,
      });
    } catch {
      logger.error("Discord reply was sent but its acknowledgement failed.", {
        channelId: item.channelId,
        outboxId: item.outboxId,
        code: "outbox_ack_failed",
      });
      return;
    }
    logger.info("Discord reply delivered.", {
      channelId: item.channelId,
      outboxId: item.outboxId,
    });
    if (item.finalizesLoop) await this.finalize(item);
  }

  private async recordFailure(
    item: OutboxItem,
    error: string,
    retryable: boolean,
  ): Promise<void> {
    try {
      const result = await this.dependencies.convex.acknowledgeReply(item, {
        status: "failed",
        error: error.slice(0, 1_000),
        retryable,
      });
      if (result.status === "failed") {
        await this.completeWithError(item, error);
      }
    } catch {
      logger.error("Discord outbox failure could not be recorded.", {
        channelId: item.channelId,
        outboxId: item.outboxId,
        code: "outbox_failure_ack_failed",
      });
    }
  }

  private async completeWithError(
    item: OutboxItem,
    error: string,
  ): Promise<void> {
    try {
      await this.dependencies.convex.completeLoop(runIdentity(item), "error", {
        error: error.slice(0, 1_000),
      });
    } catch {
      logger.error("Discord delivery failure could not finalize its loop.", {
        channelId: item.sourceChannelId,
        outboxId: item.outboxId,
        code: "outbox_error_finalize_failed",
      });
    }
  }

  private async finalize(item: OutboxItem): Promise<void> {
    try {
      const result = await this.dependencies.convex.completeLoop(
        runIdentity(item),
        "completed",
        { recheckRequested: item.recheckRequested },
      );
      if (result.status === "catching_up") {
        this.dependencies.schedule({
          guildId: item.sourceGuildId,
          channelId: item.sourceChannelId,
        });
      }
    } catch (error) {
      if (
        error instanceof ConvexDiscordOperationError &&
        (error.code === "pending_outbox" ||
          error.code === "awaiting_finalization")
      )
        return;
      logger.error("Sent Discord reply could not finalize its loop.", {
        channelId: item.sourceChannelId,
        outboxId: item.outboxId,
        code: "outbox_finalize_failed",
      });
    }
  }
}

export { discordNonce, messageOptions, priority };
