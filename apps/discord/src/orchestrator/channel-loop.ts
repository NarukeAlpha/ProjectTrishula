import { randomUUID } from "node:crypto";
import { ConvexDiscordOperationError } from "../convex/client.js";
import type {
  CompleteLoopOptions,
  CompleteLoopResult,
  EnqueueReplyInput,
  NewestContext,
  RunIdentity,
} from "../convex/client.js";
import type {
  AgentMessage,
  ChannelReference,
  ClaimLoopResponse,
  LoopStage,
  ReplyRequest,
  ReplyResponse,
  ResearchRequest,
  ResearchResponse,
  TriageRequest,
  TriageResponse,
} from "../contracts.js";
import { PiAgentOperationError } from "../pi/client.js";
import { logger } from "../runtime/logger.js";

export interface ChannelLoopDependencies {
  convex: ConvexLoopClient;
  pi: PiLoopClient;
  workerId: string;
  heartbeatIntervalMs: number;
}

export interface ConvexLoopClient {
  claimLoop(
    channel: ChannelReference,
    workerId: string,
    claimId: string,
    signal?: AbortSignal,
  ): Promise<ClaimLoopResponse>;
  heartbeatRun(
    identity: RunIdentity,
    stage: LoopStage,
    signal?: AbortSignal,
  ): Promise<boolean>;
  newestContext(
    channel: ChannelReference,
    signal?: AbortSignal,
  ): Promise<NewestContext>;
  completeLoop(
    identity: RunIdentity,
    outcome: "completed" | "error",
    options?: CompleteLoopOptions,
    signal?: AbortSignal,
  ): Promise<CompleteLoopResult>;
  enqueueReply(input: EnqueueReplyInput, signal?: AbortSignal): Promise<void>;
}

export interface PiLoopClient {
  triage(input: TriageRequest, signal?: AbortSignal): Promise<TriageResponse>;
  research(
    input: ResearchRequest,
    signal?: AbortSignal,
  ): Promise<ResearchResponse>;
  reply(input: ReplyRequest, signal?: AbortSignal): Promise<ReplyResponse>;
}

function channelKey(channel: ChannelReference): string {
  return `${channel.guildId}:${channel.channelId}`;
}

function runIdentity(
  claim: Extract<ClaimLoopResponse, { claimed: true }>,
): RunIdentity {
  return {
    guildId: claim.guildId,
    channelId: claim.channelId,
    runId: claim.runId,
    generation: claim.generation,
  };
}

function researchLogContent(research: ResearchResponse): string {
  const sources = [
    ...new Set(research.sources.map((source) => source.url)),
  ].slice(0, 3);
  const suffix = sources.length === 0 ? "" : `\nSources: ${sources.join(" ")}`;
  const prefix = "Research note: ";
  const summaryLimit = 2_000 - prefix.length - suffix.length;
  return `${prefix}${research.summary.slice(0, Math.max(1, summaryLimit))}${suffix}`.slice(
    0,
    2_000,
  );
}

function isExplicitTrigger(
  message: AgentMessage,
  messages: readonly AgentMessage[],
): boolean {
  if (message.isBot) return false;
  if (message.mentionsBot) return true;
  return (
    message.replyToMessageId !== undefined &&
    messages.some(
      (candidate) =>
        candidate.isBot && candidate.messageId === message.replyToMessageId,
    )
  );
}

interface ReplyContext {
  messages: AgentMessage[];
  consumesThroughSequence: number;
}

function replyContext(
  newest: NewestContext,
  claimedMessages: readonly AgentMessage[],
  claimedWindowEnd: number,
): ReplyContext {
  const firstNewest = newest.messages.at(0);
  if (
    firstNewest !== undefined &&
    firstNewest.sequence > claimedWindowEnd + 1
  ) {
    return {
      messages: [...claimedMessages],
      consumesThroughSequence: claimedWindowEnd,
    };
  }
  const firstNewExplicit = newest.messages.find(
    (message) =>
      message.sequence > claimedWindowEnd &&
      isExplicitTrigger(message, newest.messages),
  );
  const consumesThroughSequence =
    firstNewExplicit === undefined
      ? newest.throughSequence
      : firstNewExplicit.sequence - 1;
  const messages = newest.messages.filter(
    (message) => message.sequence <= consumesThroughSequence,
  );
  return {
    messages: messages.length > 0 ? messages : [...claimedMessages],
    consumesThroughSequence,
  };
}

function targetMessage(
  targetMessageId: string | null,
  messages: readonly AgentMessage[],
): AgentMessage {
  const target = messages.find(
    (message) => message.messageId === targetMessageId && !message.isBot,
  );
  if (target === undefined) {
    throw new Error("Triage selected an invalid Discord target message.");
  }
  return target;
}

export class ChannelLoopOrchestrator {
  private readonly locallyRunning = new Set<string>();

  constructor(private readonly dependencies: ChannelLoopDependencies) {}

  schedule(channel: ChannelReference): void {
    const key = channelKey(channel);
    if (this.locallyRunning.has(key)) return;
    this.locallyRunning.add(key);
    void this.run(channel).then((rerun) => {
      this.locallyRunning.delete(key);
      if (rerun) this.schedule(channel);
    });
  }

  isLocallyRunning(channel: ChannelReference): boolean {
    return this.locallyRunning.has(channelKey(channel));
  }

  private async run(channel: ChannelReference): Promise<boolean> {
    let claim: ClaimLoopResponse;
    try {
      claim = await this.dependencies.convex.claimLoop(
        channel,
        this.dependencies.workerId,
        `claim-${randomUUID()}`,
      );
    } catch {
      logger.error("Could not claim the Discord channel loop.", {
        channelId: channel.channelId,
        guildId: channel.guildId,
        code: "claim_failed",
      });
      return false;
    }
    if (!claim.claimed) return false;

    const identity = runIdentity(claim);
    const controller = new AbortController();
    let stage: LoopStage = "triaging";
    let heartbeatInFlight = false;
    const renewLease = async (): Promise<void> => {
      if (heartbeatInFlight) return;
      heartbeatInFlight = true;
      try {
        const active = await this.dependencies.convex.heartbeatRun(
          identity,
          stage,
          controller.signal,
        );
        if (!active)
          controller.abort(
            new Error("The Convex loop lease is no longer active."),
          );
      } finally {
        heartbeatInFlight = false;
      }
    };
    const changeStage = async (next: LoopStage): Promise<void> => {
      stage = next;
      await renewLease();
      if (controller.signal.aborted) throw controller.signal.reason;
    };
    const heartbeat = setInterval(() => {
      void renewLease().catch(() => {
        controller.abort(new Error("The Convex loop lease heartbeat failed."));
      });
    }, this.dependencies.heartbeatIntervalMs);
    heartbeat.unref();

    try {
      await changeStage("triaging");
      const triageStartedAt = Date.now();
      const triage = await this.dependencies.pi.triage(
        {
          requestId: `${claim.runId}:triage`,
          profile: "triage",
          triggerKind: claim.triggerKind,
          channel: {
            guildId: claim.guildId,
            channelId: claim.channelId,
            channelName: claim.channelName,
          },
          messages: claim.messages,
        },
        controller.signal,
      );
      logger.info("Discord channel triage completed.", {
        channelId: channel.channelId,
        guildId: channel.guildId,
        loopId: claim.runId,
        triggerKind: claim.triggerKind,
        decision: triage.decision,
        confidence: triage.confidence,
        additiveValue: triage.additiveValue,
        reason: triage.reason,
        durationMs: Date.now() - triageStartedAt,
      });

      if (triage.decision === "silent") {
        const result = await this.dependencies.convex.completeLoop(
          identity,
          "completed",
          {
            recheckRequested: false,
            consumesThroughSequence: claim.windowEnd,
          },
          controller.signal,
        );
        logger.info("Discord channel response suppressed.", {
          channelId: channel.channelId,
          guildId: channel.guildId,
          loopId: claim.runId,
          triggerKind: claim.triggerKind,
          reason: triage.reason,
        });
        return result.status === "catching_up";
      }
      const target = targetMessage(triage.targetMessageId, claim.messages);
      if (triage.question === null) {
        throw new Error("Triage did not provide a normalized question.");
      }

      if (triage.decision === "direct") {
        if (triage.directReply === null) {
          throw new Error("Triage did not provide a direct Discord reply.");
        }
        const directReply: EnqueueReplyInput = {
          ...identity,
          targetChannelId: claim.replyChannelId,
          idempotencyKey: `${claim.runId}:reply`,
          replyKind: "final",
          content: triage.directReply,
          consumesThroughSequence: claim.windowEnd,
          recheckRequested: false,
          finalizesLoop: true,
        };
        if (claim.replyChannelId === claim.channelId) {
          directReply.replyToMessageId = target.messageId;
        }
        await this.dependencies.convex.enqueueReply(
          directReply,
          controller.signal,
        );
        logger.info("Discord direct reply queued.", {
          channelId: channel.channelId,
          guildId: channel.guildId,
          loopId: claim.runId,
          triggerKind: claim.triggerKind,
          messageId: target.messageId,
          reason: triage.reason,
        });
        return false;
      }

      if (triage.acknowledgement !== null) {
        try {
          await changeStage("acknowledging");
          const acknowledgementReply: EnqueueReplyInput = {
            ...identity,
            targetChannelId: claim.replyChannelId,
            idempotencyKey: `ack:${claim.channelId}:${target.messageId}`,
            replyKind: "acknowledgement",
            content: triage.acknowledgement,
            recheckRequested: false,
            finalizesLoop: false,
          };
          if (claim.replyChannelId === claim.channelId) {
            acknowledgementReply.replyToMessageId = target.messageId;
          }
          await this.dependencies.convex.enqueueReply(
            acknowledgementReply,
            controller.signal,
          );
          logger.info("Discord channel acknowledgement queued.", {
            channelId: channel.channelId,
            guildId: channel.guildId,
            loopId: claim.runId,
            triggerKind: claim.triggerKind,
            messageId: target.messageId,
            replyKind: "acknowledgement",
          });
        } catch (error) {
          logger.error("Discord channel acknowledgement failed.", {
            channelId: channel.channelId,
            guildId: channel.guildId,
            loopId: claim.runId,
            code:
              error instanceof ConvexDiscordOperationError
                ? error.code
                : error instanceof PiAgentOperationError
                  ? error.code
                  : error instanceof Error
                    ? error.name
                    : "unknown_error",
          });
        }
      }

      await changeStage("researching");
      const researchStartedAt = Date.now();
      const research = await this.dependencies.pi.research(
        {
          requestId: `${claim.runId}:research`,
          profile: "research",
          channel: {
            guildId: claim.guildId,
            channelId: claim.channelId,
            channelName: claim.channelName,
          },
          messages: claim.messages,
          question: triage.question,
        },
        controller.signal,
      );
      logger.info("Discord channel research completed.", {
        channelId: channel.channelId,
        guildId: channel.guildId,
        loopId: claim.runId,
        triggerKind: claim.triggerKind,
        durationMs: Date.now() - researchStartedAt,
      });

      await changeStage("catching_up");
      const newest = await this.dependencies.convex.newestContext(
        channel,
        controller.signal,
      );
      const context = replyContext(newest, claim.messages, claim.windowEnd);
      await changeStage("drafting");
      const replyStartedAt = Date.now();
      const reply = await this.dependencies.pi.reply(
        {
          requestId: `${claim.runId}:reply`,
          profile: "reply",
          triggerKind: claim.triggerKind,
          targetMessageId: target.messageId,
          channel: {
            guildId: claim.guildId,
            channelId: claim.channelId,
            channelName: claim.channelName,
          },
          messages: context.messages,
          question: triage.question,
          research,
        },
        controller.signal,
      );
      logger.info("Discord channel reply drafted.", {
        channelId: channel.channelId,
        guildId: channel.guildId,
        loopId: claim.runId,
        triggerKind: claim.triggerKind,
        action: reply.action,
        reason: reply.reason,
        durationMs: Date.now() - replyStartedAt,
      });

      if (reply.action === "suppress") {
        const result = await this.dependencies.convex.completeLoop(
          identity,
          "completed",
          {
            recheckRequested: false,
            consumesThroughSequence: context.consumesThroughSequence,
            suppressPendingReplies: true,
          },
          controller.signal,
        );
        logger.info("Discord researched reply suppressed.", {
          channelId: channel.channelId,
          guildId: channel.guildId,
          loopId: claim.runId,
          triggerKind: claim.triggerKind,
          messageId: target.messageId,
          reason: reply.reason,
        });
        return result.status === "catching_up";
      }
      if (reply.reply === null) {
        throw new Error("The Discord reply writer returned no reply.");
      }

      if (claim.researchLogChannelId !== undefined) {
        await this.dependencies.convex.enqueueReply(
          {
            ...identity,
            targetChannelId: claim.researchLogChannelId,
            idempotencyKey: `${claim.runId}:research`,
            replyKind: "research_log",
            content: researchLogContent(research),
            recheckRequested: false,
            finalizesLoop: false,
          },
          controller.signal,
        );
      }

      const finalReply: EnqueueReplyInput = {
        ...identity,
        targetChannelId: claim.replyChannelId,
        idempotencyKey: `${claim.runId}:reply`,
        replyKind: "final",
        content: reply.reply,
        consumesThroughSequence: context.consumesThroughSequence,
        recheckRequested: false,
        finalizesLoop: true,
      };
      if (reply.chart !== undefined) finalReply.chart = reply.chart;
      if (claim.replyChannelId === claim.channelId) {
        finalReply.replyToMessageId = target.messageId;
      }
      await this.dependencies.convex.enqueueReply(
        finalReply,
        controller.signal,
      );
      logger.info("Discord channel reply queued.", {
        channelId: channel.channelId,
        guildId: channel.guildId,
        loopId: claim.runId,
        triggerKind: claim.triggerKind,
        messageId: target.messageId,
        reason: reply.reason,
        replyKind: "final",
      });
      return false;
    } catch (error) {
      const message =
        error instanceof PiAgentOperationError
          ? `Pi ${error.profile} failed: ${error.code}.`
          : error instanceof ConvexDiscordOperationError
            ? `Convex Discord ${error.operation} failed: ${error.code}.`
            : "Discord agent loop failed.";
      try {
        await this.dependencies.convex.completeLoop(identity, "error", {
          error: message,
          retryable:
            error instanceof PiAgentOperationError
              ? error.retryable
              : error instanceof ConvexDiscordOperationError
                ? error.status === 408 ||
                  error.status === 429 ||
                  error.status >= 500
                : true,
        });
      } catch {
        logger.error("Could not record the Discord loop failure.", {
          channelId: channel.channelId,
          guildId: channel.guildId,
          loopId: claim.runId,
        });
      }
      logger.error("Discord channel loop failed.", {
        channelId: channel.channelId,
        guildId: channel.guildId,
        loopId: claim.runId,
        code:
          error instanceof PiAgentOperationError
            ? error.code
            : error instanceof ConvexDiscordOperationError
              ? error.code
              : error instanceof Error
                ? error.name
                : "unknown_error",
      });
      return false;
    } finally {
      clearInterval(heartbeat);
      controller.abort();
    }
  }
}

export { channelKey, isExplicitTrigger, replyContext, researchLogContent };
