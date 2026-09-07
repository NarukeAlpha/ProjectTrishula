import { randomUUID } from "node:crypto";
import { ConvexDiscordOperationError } from "../convex/client.js";
import type {
  CompleteLoopOptions,
  CompleteLoopResult,
  EnqueueReplyInput,
  EnqueueReplyResult,
  NewestContext,
  RunIdentity,
} from "../convex/client.js";
import type {
  AgentMessage,
  ChannelReference,
  ClaimedLoop,
  ClaimLoopResponse,
  LoopStage,
  ReplyRequest,
  ReplyResponse,
  ResearchRequest,
  ResearchResponse,
  TriageRequest,
  TriageResponse,
} from "../contracts.js";
import type {
  FrontmanPlanRequest,
  FrontmanPlanResponse,
  FrontmanResearchRequest,
  FrontmanResumeRequest,
  FrontmanResumeResponse,
  DurableConversationContext,
  NativeCheckpointRejection,
  ResearchFailure,
  SolResearchRequest,
  SolResearchResponse,
} from "../personality-contracts.js";
import {
  DISCORD_FINAL_REPLY_MAX_CHARACTERS,
  requireDiscordContent,
} from "../content.js";
import { PiAgentOperationError } from "../pi/client.js";
import { logger } from "../runtime/logger.js";

export interface ChannelLoopDependencies {
  convex: ConvexLoopClient;
  pi: PiLoopClient;
  workerId: string;
  heartbeatIntervalMs: number;
  durableConversationsEnabled?: boolean;
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
    channel: ChannelReference & {
      fence?: RunIdentity["fence"];
      runId?: string;
    },
    signal?: AbortSignal,
  ): Promise<NewestContext>;
  completeLoop(
    identity: RunIdentity,
    outcome: "completed" | "error",
    options?: CompleteLoopOptions,
    signal?: AbortSignal,
  ): Promise<CompleteLoopResult>;
  enqueueReply(input: EnqueueReplyInput, signal?: AbortSignal): Promise<EnqueueReplyResult>;
  recordFrontmanPlan?(
    identity: RunIdentity,
    requestId: string,
    plan: FrontmanPlanResponse,
    signal?: AbortSignal,
  ): Promise<void>;
  recordResearchStarted?(
    identity: RunIdentity,
    requestId: string,
    request: FrontmanResearchRequest,
    inputContextHash: string,
    pass: 1 | 2,
    signal?: AbortSignal,
  ): Promise<void>;
  recordResearchResult?(
    identity: RunIdentity,
    requestId: string,
    research: SolResearchResponse | ResearchFailure,
    signal?: AbortSignal,
  ): Promise<void>;
  recordFrontmanResume?(
    identity: RunIdentity,
    requestId: string,
    resume: FrontmanResumeResponse,
    acknowledgementDelivery: FrontmanResumeRequest["acknowledgementDelivery"],
    newest: Pick<
      NewestContext,
      | "eligibleThroughSequence"
      | "eligibleHumanRevision"
      | "eligibleContextHash"
      | "nextExplicitTriggerSequence"
    >,
    signal?: AbortSignal,
  ): Promise<void>;
  invalidateNativeCheckpoint?(
    invalidation: {
      guildId: string;
      conversationId: string;
      checkpointId: string;
      epoch: number;
      ownerBindingVersion: number;
      revision: number;
      generation: number;
      routingGeneration: number;
    },
    signal?: AbortSignal,
  ): Promise<void>;
}

export interface PiLoopClient {
  frontmanPlan?(
    input: FrontmanPlanRequest,
    signal?: AbortSignal,
  ): Promise<FrontmanPlanResponse>;
  solResearch?(
    input: SolResearchRequest,
    signal?: AbortSignal,
  ): Promise<SolResearchResponse>;
  frontmanResume?(
    input: FrontmanResumeRequest,
    signal?: AbortSignal,
  ): Promise<FrontmanResumeResponse>;
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

async function consumeNativeCheckpointRejection(
  dependencies: ChannelLoopDependencies,
  conversation: ClaimedLoop["conversation"],
  durableContext: DurableConversationContext,
  rejection: NativeCheckpointRejection | undefined,
  signal: AbortSignal,
): Promise<DurableConversationContext> {
  if (rejection === undefined) return durableContext;
  if (
    conversation.activeCheckpointId !== rejection.checkpointId
    || durableContext.activeCheckpointId !== rejection.checkpointId
    || durableContext.nativeCheckpoint?.checkpointId !== rejection.checkpointId
  ) throw new Error("Pi rejected a native checkpoint outside the active conversation fence.");
  const invalidate = dependencies.convex.invalidateNativeCheckpoint;
  if (invalidate === undefined) {
    logger.warn("Discord native checkpoint invalidation was deferred.", {
      guildId: conversation.guildId,
      checkpointId: rejection.checkpointId,
      reason: "gateway_operation_unavailable",
    });
  } else {
    try {
      await invalidate.call(dependencies.convex, {
        guildId: conversation.guildId,
        conversationId: conversation.conversationId,
        checkpointId: rejection.checkpointId,
        epoch: conversation.epoch,
        ownerBindingVersion: conversation.ownerBindingVersion,
        revision: conversation.revision,
        generation: conversation.generation,
        routingGeneration: conversation.routingGeneration,
      }, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      logger.warn("Discord native checkpoint invalidation was deferred.", {
        guildId: conversation.guildId,
        checkpointId: rejection.checkpointId,
        reason: "gateway_write_failed",
      });
    }
  }
  const { nativeCheckpoint: _invalidated, ...portableContext } = durableContext;
  return portableContext;
}

function runIdentity(
  claim: Extract<ClaimLoopResponse, { claimed: true }>,
): RunIdentity {
  return {
    guildId: claim.guildId,
    channelId: claim.channelId,
    runId: claim.runId,
    generation: claim.generation,
    fence: claim.fence,
  };
}

function researchLogContent(research: ResearchResponse): string {
  const sources = [
    ...new Set(research.sources.map((source) => source.url)),
  ].slice(0, 3);
  const suffix = sources.length === 0 ? "" : `\nSources: ${sources.join(" ")}`;
  const prefix = "Research note: ";
  return requireDiscordContent(
    `${prefix}${research.summary}${suffix}`,
    DISCORD_FINAL_REPLY_MAX_CHARACTERS,
  );
}

function durableResearchLogContent(research: SolResearchResponse): string {
  const sources = research.packet.sources.slice(0, 3).map((source) => source.url);
  const suffix = sources.length === 0 ? "" : `\nSources: ${sources.join(" ")}`;
  return requireDiscordContent(
    `Research note: ${research.packet.summary}${suffix}`,
    DISCORD_FINAL_REPLY_MAX_CHARACTERS,
  );
}

function researchFailure(error: Error): ResearchFailure {
  if (error instanceof PiAgentOperationError) {
    return {
      code: error.code.includes("freshness")
        ? "freshness_unverified"
        : error.code.includes("packet")
          ? "packet_invalid"
          : "provider_unavailable",
      detail: "Public research could not be completed reliably.",
      retryable: error.retryable,
    };
  }
  return {
    code: "provider_unavailable",
    detail: "Public research could not be completed reliably.",
    retryable: true,
  };
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

  private async runDurable(
    claim: ClaimedLoop,
    identity: RunIdentity,
    changeStage: (stage: LoopStage) => Promise<void>,
    signal: AbortSignal,
  ): Promise<boolean> {
    const planAgent = this.dependencies.pi.frontmanPlan;
    const researchAgent = this.dependencies.pi.solResearch;
    const resumeAgent = this.dependencies.pi.frontmanResume;
    const recordPlan = this.dependencies.convex.recordFrontmanPlan;
    const recordResearchStarted = this.dependencies.convex.recordResearchStarted;
    const recordResearchResult = this.dependencies.convex.recordResearchResult;
    const recordResume = this.dependencies.convex.recordFrontmanResume;
    let terminalReplyQueued = false;
    try {
    if (claim.recoveryFailure !== undefined) {
      throw new Error("Persisted Discord recovery state is invalid.");
    }
    if (
      planAgent === undefined
      || researchAgent === undefined
      || resumeAgent === undefined
      || recordPlan === undefined
      || recordResearchStarted === undefined
      || recordResearchResult === undefined
      || recordResume === undefined
    ) {
      throw new Error("The durable Discord agent protocol is unavailable.");
    }
    const agentChannel = {
      guildId: claim.guildId,
      channelId: claim.channelId,
      channelName: claim.channelName,
    };
    let durableContext = claim.durableContext;
    const planRequestId = `${claim.runId}:frontman-plan`;
    let plan = claim.recovery?.plan;
    if (plan === undefined) {
      await changeStage("triaging");
      const planResult = await planAgent.call(this.dependencies.pi, {
        requestId: planRequestId,
        profile: "frontman_plan",
        triggerKind: claim.triggerKind,
        conversation: claim.conversation,
        durableContext,
        channel: agentChannel,
        messages: claim.messages,
      }, signal);
      durableContext = await consumeNativeCheckpointRejection(
        this.dependencies,
        claim.conversation,
        durableContext,
        planResult.nativeCheckpointRejection,
        signal,
      );
      const { nativeCheckpointRejection: _rejection, ...planWithoutRejection } = planResult;
      plan = planWithoutRejection;
      await recordPlan.call(
        this.dependencies.convex,
        identity,
        planRequestId,
        plan,
        signal,
      );
    }
    const target = targetMessage(plan.targetMessageId, claim.messages);
    logger.info("Discord frontman plan completed.", {
      channelId: claim.channelId,
      guildId: claim.guildId,
      loopId: claim.runId,
      action: plan.action,
      reasonCode: plan.reasonCode,
      confidence: plan.confidence,
      additiveValue: plan.additiveValue,
    });

    if (plan.action === "silent") {
      const result = await this.dependencies.convex.completeLoop(
        identity,
        "completed",
        { recheckRequested: false, consumesThroughSequence: claim.windowEnd },
        signal,
      );
      return result.status === "catching_up";
    }

    const newestFor = async (): Promise<NewestContext> => {
      const newest = await this.dependencies.convex.newestContext({
        guildId: claim.guildId,
        channelId: claim.channelId,
        runId: claim.runId,
        fence: claim.fence,
      }, signal);
      if (!newest.exact) {
        throw new ConvexDiscordOperationError(
          "newestContext",
          "context_not_exact",
          409,
        );
      }
      return newest;
    };
    const queueFinal = async (
      reply: string,
      newest: NewestContext,
      chart?: SolResearchResponse["chart"],
      enforceEligibleCutoff = true,
    ): Promise<void> => {
      const finalFence = enforceEligibleCutoff
        ? {
            ...claim.fence,
            eligibleHumanRevision: newest.eligibleHumanRevision,
          }
        : claim.fence;
      const input: EnqueueReplyInput = {
        ...identity,
        fence: finalFence,
        targetChannelId: claim.replyChannelId,
        idempotencyKey: `${claim.runId}:reply`,
        replyKind: "final",
        content: requireDiscordContent(reply, DISCORD_FINAL_REPLY_MAX_CHARACTERS),
        consumesThroughSequence: newest.eligibleThroughSequence,
        recheckRequested: false,
        finalizesLoop: true,
      };
      if (chart !== undefined) input.chart = chart;
      if (claim.replyChannelId === claim.channelId) {
        input.replyToMessageId = target.messageId;
      }
      await this.dependencies.convex.enqueueReply(input, signal);
      terminalReplyQueued = true;
    };

    if (plan.action === "reply" || plan.action === "clarify") {
      if (plan.reply === undefined) throw new Error("The frontman plan omitted its reply.");
      await changeStage("catching_up");
      const newest = await newestFor();
      await queueFinal(plan.reply, newest);
      return false;
    }

    if (plan.researchRequest === undefined) {
      throw new Error("The frontman plan omitted its research request.");
    }
    let acknowledgementDelivery: FrontmanResumeRequest["acknowledgementDelivery"] =
      claim.recovery?.acknowledgementDelivery ?? "not_required";
    if (plan.acknowledgement !== undefined) {
      if (claim.recovery?.acknowledgementDelivery === undefined) {
        await changeStage("acknowledging");
      }
      const acknowledgement: EnqueueReplyInput = {
        ...identity,
        targetChannelId: claim.replyChannelId,
        idempotencyKey: `ack:${claim.conversation.conversationId}:${claim.conversation.epoch}:${target.messageId}`,
        replyKind: "acknowledgement",
        content: plan.acknowledgement,
        recheckRequested: false,
        finalizesLoop: false,
      };
      if (claim.replyChannelId === claim.channelId) {
        acknowledgement.replyToMessageId = target.messageId;
      }
      const acknowledgementResult = await this.dependencies.convex.enqueueReply(
        acknowledgement,
        signal,
      );
      acknowledgementDelivery = acknowledgementResult.status === "sent"
        || acknowledgementResult.status === "finalized"
        ? "sent"
        : acknowledgementResult.status === "delivery_uncertain"
          || acknowledgementResult.status === "needs_reconciliation"
          ? "uncertain"
          : "pending";
    }

    let recoveredResearch = claim.recovery?.research;
    let activeResearchRequest: FrontmanResearchRequest =
      recoveredResearch?.normalizedRequest ?? plan.researchRequest;
    let pass: 1 | 2 = recoveredResearch?.requestId.endsWith(":2") ? 2 : 1;
    let newest: NewestContext | undefined;
    while (true) {
      const researchRequestId = `${claim.runId}:sol:${pass}`;
      let research: SolResearchResponse | ResearchFailure;
      if (
        recoveredResearch?.requestId === researchRequestId
        && recoveredResearch.result !== undefined
      ) {
        research = recoveredResearch.result;
      } else {
        await changeStage("researching");
        await recordResearchStarted.call(
          this.dependencies.convex,
          identity,
          researchRequestId,
          activeResearchRequest,
          newest?.eligibleContextHash ?? claim.contextHash,
          pass,
          signal,
        );
        try {
          research = await researchAgent.call(this.dependencies.pi, {
            requestId: researchRequestId,
            profile: "research",
            conversation: claim.conversation,
            channel: agentChannel,
            messages: newest?.messages ?? claim.messages,
            researchRequest: activeResearchRequest,
            pass,
          }, signal);
        } catch (error) {
          research = researchFailure(
            error instanceof Error
              ? error
              : new Error("Public research failed without an error contract."),
          );
        }
        await recordResearchResult.call(
          this.dependencies.convex,
          identity,
          researchRequestId,
          research,
          signal,
        );
      }
      recoveredResearch = undefined;

      await changeStage("catching_up");
      try {
        newest = await newestFor();
      } catch {
        if (claim.triggerKind === "ambient") {
          const result = await this.dependencies.convex.completeLoop(
            identity,
            "completed",
            {
              recheckRequested: false,
              consumesThroughSequence: claim.windowEnd,
              suppressPendingReplies: true,
            },
            signal,
          );
          return result.status === "catching_up";
        }
        await queueFinal(
          "I couldn't reconcile the newest messages safely, so I stopped instead of sending a stale answer.",
          {
            guildId: claim.guildId,
            channelId: claim.channelId,
            throughSequence: claim.windowEnd,
            triggerThroughSequence: claim.windowEnd,
            completedThroughSequence: claim.windowStart - 1,
            contextHash: claim.contextHash,
            eligibleThroughSequence: claim.windowEnd,
            eligibleHumanRevision: claim.conversation.humanRevision,
            eligibleContextHash: claim.contextHash,
            catchUpMessages: [],
            exact: true,
            messages: claim.messages,
          },
          undefined,
          false,
        );
        return false;
      }

      const resumeRequestId = `${claim.runId}:frontman-resume:${pass}`;
      const recoveredResumeIsCurrent = claim.recovery?.resume !== undefined
        && claim.recovery.resumeRequestId === resumeRequestId
        && claim.recovery.eligibleThroughSequence === newest.eligibleThroughSequence
        && claim.recovery.eligibleHumanRevision === newest.eligibleHumanRevision
        && claim.recovery.eligibleContextHash === newest.eligibleContextHash
        && claim.recovery.nextExplicitTriggerSequence === newest.nextExplicitTriggerSequence;
      let resume: FrontmanResumeResponse;
      if (recoveredResumeIsCurrent) {
        resume = claim.recovery!.resume!;
      } else {
        await changeStage("drafting");
        const resumeRequest: FrontmanResumeRequest = {
            requestId: resumeRequestId,
            profile: "frontman_resume",
            triggerKind: claim.triggerKind,
            conversation: claim.conversation,
            durableContext,
            channel: agentChannel,
            messages: newest.messages,
            targetMessageId: target.messageId,
            originalAuthorId: target.authorId,
            acknowledgementDelivery,
            research,
            catchUpMessages: newest.catchUpMessages,
            eligibleThroughSequence: newest.eligibleThroughSequence,
            eligibleHumanRevision: newest.eligibleHumanRevision,
            eligibleContextHash: newest.eligibleContextHash,
            autonomousPass: pass,
        };
        if (newest.nextExplicitTriggerSequence !== undefined) {
          resumeRequest.nextExplicitTriggerSequence = newest.nextExplicitTriggerSequence;
        }
        const resumeResult = await resumeAgent.call(this.dependencies.pi, resumeRequest, signal);
        durableContext = await consumeNativeCheckpointRejection(
          this.dependencies,
          claim.conversation,
          durableContext,
          resumeResult.nativeCheckpointRejection,
          signal,
        );
        const { nativeCheckpointRejection: _rejection, ...resumeWithoutRejection } = resumeResult;
        resume = resumeWithoutRejection;
      }
      if (
        claim.triggerKind !== "ambient"
        && !("profile" in research)
        && resume.action === "suppress"
      ) {
        resume = {
          profile: "frontman_resume",
          action: "send",
          reasonCode: "research_failed",
          reply: "I couldn't verify that reliably, so I don't want to guess.",
        };
      }
      if (!recoveredResumeIsCurrent) {
        await recordResume.call(
          this.dependencies.convex,
          identity,
          resumeRequestId,
          resume,
          acknowledgementDelivery,
          newest,
          signal,
        );
      }
      if (resume.action === "recheck") {
        if (pass >= 2 || resume.recheckRequest === undefined) {
          throw new Error("The autonomous Discord research cap was exceeded.");
        }
        activeResearchRequest = resume.recheckRequest;
        pass = 2;
        continue;
      }
      if (resume.action === "suppress") {
        const result = await this.dependencies.convex.completeLoop(
          identity,
          "completed",
          {
            recheckRequested: false,
            consumesThroughSequence: newest.eligibleThroughSequence,
            suppressPendingReplies: true,
          },
          signal,
        );
        return result.status === "catching_up";
      }
      if (resume.reply === undefined) {
        throw new Error("The frontman resume omitted its final reply.");
      }
      if ("profile" in research && claim.researchLogChannelId !== undefined) {
        try {
          await this.dependencies.convex.enqueueReply({
            ...identity,
            targetChannelId: claim.researchLogChannelId,
            idempotencyKey: `${claim.runId}:research-log:${pass}`,
            replyKind: "research_log",
            content: durableResearchLogContent(research),
            recheckRequested: false,
            finalizesLoop: false,
          }, signal);
        } catch (error) {
          logger.warn("Discord research log was omitted.", {
            channelId: claim.channelId,
            guildId: claim.guildId,
            loopId: claim.runId,
            code: error instanceof Error ? error.name : "research_log_invalid",
          });
        }
      }
      await queueFinal(
        resume.reply,
        newest,
        "profile" in research ? research.chart : undefined,
      );
      return false;
    }
    } catch (error) {
      if (claim.triggerKind !== "ambient" && !terminalReplyQueued) {
        const failureTarget = claim.messages.findLast((message) =>
          !message.isBot && isExplicitTrigger(message, claim.messages)
        ) ?? claim.messages.findLast((message) => !message.isBot);
        if (failureTarget !== undefined) {
          const closure: EnqueueReplyInput = {
            ...identity,
            targetChannelId: claim.replyChannelId,
            idempotencyKey: `${claim.runId}:failure-closure`,
            replyKind: "final",
            content: "I couldn't complete that reliably, so I stopped instead of guessing.",
            consumesThroughSequence: claim.windowEnd,
            recheckRequested: false,
            finalizesLoop: true,
          };
          if (claim.replyChannelId === claim.channelId) {
            closure.replyToMessageId = failureTarget.messageId;
          }
          await this.dependencies.convex.enqueueReply(closure);
          logger.warn("Discord explicit failure closure queued.", {
            channelId: claim.channelId,
            guildId: claim.guildId,
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
        }
      }
      if (claim.triggerKind === "ambient") {
        const result = await this.dependencies.convex.completeLoop(
          identity,
          "completed",
          {
            recheckRequested: false,
            consumesThroughSequence: claim.windowEnd,
            suppressPendingReplies: true,
          },
        );
        return result.status === "catching_up";
      }
      throw error;
    }
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
      if (this.dependencies.durableConversationsEnabled === true) {
        return await this.runDurable(
          claim,
          identity,
          changeStage,
          controller.signal,
        );
      }
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
