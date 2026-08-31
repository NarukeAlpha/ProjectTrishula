import { createHash } from "node:crypto";
import type {
  AttachmentPayload,
  Client,
  MessageCreateOptions,
} from "discord.js";
import {
  ConvexDiscordOperationError,
  type AcknowledgeResult,
  type CompleteLoopResult,
  type RunIdentity,
} from "../convex/client.js";
import type {
  ChannelReference,
  OutboxItem,
  StoredMessage,
} from "../contracts.js";
import {
  ChartImageError,
  type MarketChartRenderer,
} from "../media/chart-img.js";
import { discordImageAttachments } from "../media/images.js";
import { MAX_DISCORD_GENERATED_FILE_BYTES } from "../media/market-chart.js";
import { logger } from "../runtime/logger.js";

const MAX_DISCORD_REPLY_FILES = 4;
const MAX_DISCORD_REPLY_FILE_TOTAL_BYTES = 24 * 1_024 * 1_024;

export interface DiscordReplyFile {
  attachment: Buffer;
  name: string;
  description?: string | undefined;
}

interface ChartFailureLogFields {
  [key: string]: string | number | boolean | undefined;
  channelId: string;
  outboxId: string;
  code: string;
  status?: number;
}

export interface ConvexOutboxClient {
  renewRunLease(
    identity: RunIdentity,
    signal?: AbortSignal,
  ): Promise<boolean>;
  acknowledgeReply(
    item: Pick<OutboxItem, "outboxId" | "deliveryToken">,
    result: {
      status: "sent" | "failed";
      discordMessageId?: string | undefined;
      images?: StoredMessage["images"];
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
  chartImages?: MarketChartRenderer;
}

function discordNonce(outboxId: string): string {
  return createHash("sha256").update(outboxId).digest("hex").slice(0, 24);
}

function boundedReplyFiles(files: readonly DiscordReplyFile[]) {
  if (files.length > MAX_DISCORD_REPLY_FILES) {
    throw new Error("A Discord reply cannot contain more than four files.");
  }
  let totalBytes = 0;
  return files.map((file) => {
    if (
      file.attachment.length === 0 ||
      file.attachment.length > MAX_DISCORD_GENERATED_FILE_BYTES
    ) {
      throw new Error("A Discord reply file exceeded its byte limit.");
    }
    if (
      file.name.length === 0 ||
      file.name.length > 255 ||
      file.name.includes("/") ||
      file.name.includes("\\")
    ) {
      throw new Error("A Discord reply file has an invalid name.");
    }
    if (file.description !== undefined && file.description.length > 1_024) {
      throw new Error("A Discord reply file description is too long.");
    }
    totalBytes += file.attachment.length;
    if (totalBytes > MAX_DISCORD_REPLY_FILE_TOTAL_BYTES) {
      throw new Error("Discord reply files exceeded the total byte limit.");
    }
    const payload: AttachmentPayload = {
      attachment: file.attachment,
      name: file.name,
    };
    if (file.description !== undefined) payload.description = file.description;
    return payload;
  });
}

function messageOptions(
  item: OutboxItem,
  files: readonly DiscordReplyFile[] = [],
): MessageCreateOptions {
  const replyFiles = boundedReplyFiles(files);
  const options: MessageCreateOptions = {
    content: item.content.slice(0, 2_000),
    allowedMentions: { parse: [] },
    nonce: discordNonce(item.outboxId),
    enforceNonce: true,
  };
  if (replyFiles.length > 0) options.files = replyFiles;
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
  if (item.status === "sent") return 3;
  const replyKind = item.replyKind
    ?? (item.finalizesLoop ? "final" : "research_log");
  if (replyKind === "acknowledgement") return 0;
  if (replyKind === "research_log") return 1;
  return 2;
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
    const active = await this.dependencies.convex.renewRunLease(identity);
    if (!active) return;
    let sentMessageId: string;
    let sentImages: NonNullable<StoredMessage["images"]> = [];
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
      const files: DiscordReplyFile[] = [];
      if (item.chart !== undefined) {
        const chartImages = this.dependencies.chartImages;
        if (chartImages === undefined) {
          logger.warn("Discord chart attachment was skipped.", {
            channelId: item.channelId,
            outboxId: item.outboxId,
            code: "chart_provider_not_configured",
          });
        } else {
          try {
            files.push(await chartImages.render(item.chart));
            logger.info("Discord chart attachment prepared.", {
              channelId: item.channelId,
              outboxId: item.outboxId,
              code: "chart_attachment_ready",
            });
          } catch (error) {
            const fields: ChartFailureLogFields = {
              channelId: item.channelId,
              outboxId: item.outboxId,
              code:
                error instanceof ChartImageError
                  ? error.code
                  : "chart_provider_error",
            };
            if (
              error instanceof ChartImageError &&
              error.status !== undefined
            ) {
              fields.status = error.status;
            }
            logger.warn("Discord chart attachment was skipped.", fields);
          }
        }
        if (!(await this.dependencies.convex.renewRunLease(identity))) return;
      }
      const sent = await channel.send(messageOptions(item, files));
      sentMessageId = sent.id;
      sentImages = discordImageAttachments(sent.attachments?.values() ?? []);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Discord reply delivery failed.";
      await this.recordFailure(item, message, true);
      return;
    }

    try {
      const acknowledgement = sentImages.length > 0
        ? {
            status: "sent" as const,
            discordMessageId: sentMessageId,
            images: sentImages,
          }
        : { status: "sent" as const, discordMessageId: sentMessageId };
      await this.dependencies.convex.acknowledgeReply(item, acknowledgement);
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
      replyKind: item.replyKind,
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
        replyKind: item.replyKind,
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
