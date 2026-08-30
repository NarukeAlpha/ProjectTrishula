import { randomUUID } from "node:crypto";
import { ConvexDiscordOperationError } from "../convex/client.js";
import type {
  CompleteLoopResult,
  EnqueueReplyInput,
  NewestContext,
  RunIdentity,
} from "../convex/client.js";
import type {
  AcknowledgeRequest,
  AcknowledgeResponse,
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
    options?: { recheckRequested?: boolean; error?: string },
    signal?: AbortSignal,
  ): Promise<CompleteLoopResult>;
  enqueueReply(input: EnqueueReplyInput, signal?: AbortSignal): Promise<void>;
}

export interface PiLoopClient {
  triage(input: TriageRequest, signal?: AbortSignal): Promise<TriageResponse>;
  acknowledge(
    input: AcknowledgeRequest,
    signal?: AbortSignal,
  ): Promise<AcknowledgeResponse>;
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

function newestHumanMessageId(messages: readonly {
  messageId: string;
  isBot: boolean;
}[]): string | undefined {
  return messages.findLast((message) => !message.isBot)?.messageId;
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
        shouldRespond: triage.shouldRespond,
        shouldResearch: triage.shouldResearch,
        confidence: triage.confidence,
        durationMs: Date.now() - triageStartedAt,
      });

      if (!triage.shouldRespond) {
        const result = await this.dependencies.convex.completeLoop(
          identity,
          "completed",
          { recheckRequested: false },
          controller.signal,
        );
        logger.info("Discord channel loop completed without a reply.", {
          channelId: channel.channelId,
          guildId: channel.guildId,
          loopId: claim.runId,
        });
        return result.status === "catching_up";
      }
      if (triage.question === null)
        throw new Error("Triage did not provide a normalized question.");

      if (claim.mode === "messages") {
        try {
          await changeStage("acknowledging");
          const acknowledgement = await this.dependencies.pi.acknowledge(
            {
              requestId: `${claim.runId}:ack`,
              profile: "acknowledge",
              channel: {
                guildId: claim.guildId,
                channelId: claim.channelId,
                channelName: claim.channelName,
              },
              messages: claim.messages,
              question: triage.question,
              reason: triage.reason,
            },
            controller.signal,
          );
          const acknowledgementReply: EnqueueReplyInput = {
            ...identity,
            targetChannelId: claim.replyChannelId,
            idempotencyKey: `${claim.runId}:ack`,
            replyKind: "acknowledgement",
            content: acknowledgement.acknowledgement,
            recheckRequested: false,
            finalizesLoop: false,
          };
          if (claim.replyChannelId === claim.channelId) {
            acknowledgementReply.replyToMessageId = newestHumanMessageId(
              claim.messages,
            );
          }
          await this.dependencies.convex.enqueueReply(
            acknowledgementReply,
            controller.signal,
          );
          logger.info("Discord channel acknowledgement queued.", {
            channelId: channel.channelId,
            guildId: channel.guildId,
            loopId: claim.runId,
            messageId: newestHumanMessageId(claim.messages),
            replyKind: "acknowledgement",
          });
        } catch (error) {
          logger.error("Discord channel acknowledgement failed.", {
            channelId: channel.channelId,
            guildId: channel.guildId,
            loopId: claim.runId,
            code: error instanceof ConvexDiscordOperationError
              ? error.code
              : error instanceof Error
                ? error.name
                : "unknown_error",
          });
        }
      }

      let research: ResearchResponse | null = null;
      if (triage.shouldResearch) {
        await changeStage("researching");
        const researchStartedAt = Date.now();
        research = await this.dependencies.pi.research(
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
          durationMs: Date.now() - researchStartedAt,
        });
      }

      await changeStage("catching_up");
      const newest = await this.dependencies.convex.newestContext(
        channel,
        controller.signal,
      );
      await changeStage("drafting");
      const replyStartedAt = Date.now();
      const reply = await this.dependencies.pi.reply(
        {
          requestId: `${claim.runId}:reply`,
          profile: "reply",
          channel: {
            guildId: claim.guildId,
            channelId: claim.channelId,
            channelName: claim.channelName,
          },
          messages: newest.messages,
          question: triage.question,
          research,
          loopDepth: claim.recheckCount,
        },
        controller.signal,
      );
      logger.info("Discord channel reply drafted.", {
        channelId: channel.channelId,
        guildId: channel.guildId,
        loopId: claim.runId,
        durationMs: Date.now() - replyStartedAt,
      });

      if (research !== null && claim.researchLogChannelId !== undefined) {
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
        recheckRequested: reply.recheck,
        finalizesLoop: true,
      };
      if (claim.replyChannelId === claim.channelId) {
        finalReply.replyToMessageId = newestHumanMessageId(newest.messages);
      }
      await this.dependencies.convex.enqueueReply(
        finalReply,
        controller.signal,
      );
      logger.info("Discord channel reply queued.", {
        channelId: channel.channelId,
        guildId: channel.guildId,
        loopId: claim.runId,
        replyKind: "final",
      });
      return false;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 1_000)
          : "Discord agent loop failed.";
      try {
        await this.dependencies.convex.completeLoop(identity, "error", {
          error: message,
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
        code: error instanceof Error ? error.name : "unknown_error",
      });
      return false;
    } finally {
      clearInterval(heartbeat);
      controller.abort();
    }
  }
}

export { channelKey, newestHumanMessageId, researchLogContent };
