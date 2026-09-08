import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordTypingIndicatorManager } from "../src/discord/typing.js";
import type {
  CompleteLoopResult,
  EnqueueReplyInput,
  EnqueueReplyResult,
  NewestContext,
  RunIdentity,
} from "../src/convex/client.js";
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
} from "../src/contracts.js";
import {
  ChannelLoopOrchestrator,
  type ConvexLoopClient,
  type PiLoopClient,
} from "../src/orchestrator/channel-loop.js";
import { PiAgentOperationError } from "../src/pi/client.js";
import type {
  FrontmanPlanRequest,
  FrontmanPlanResponse,
  FrontmanResearchRequest,
  FrontmanResumeRequest,
  FrontmanResumeResponse,
  ResearchFailure,
  SolResearchRequest,
  SolResearchResponse,
} from "../src/personality-contracts.js";

const channel: ChannelReference = { guildId: "10", channelId: "20" };
const firstMessage: AgentMessage = {
  messageId: "100",
  sequence: 1,
  authorId: "200",
  authorName: "Mira",
  content: "What changed in the semiconductor sector today?",
  createdAt: "2026-08-30T12:00:00.000Z",
  isBot: false,
};
const newestMessage: AgentMessage = {
  messageId: "101",
  sequence: 2,
  authorId: "201",
  authorName: "Nico",
  content: "Focus on the move after the close.",
  createdAt: "2026-08-30T12:01:00.000Z",
  isBot: false,
};

const portableContext = {
  sourceRevision: 1,
  sourceHumanRevision: 1,
  recentEvents: [],
  tail: {
    estimatorVersion: "utf8-bytes-div-3-plus-message-overhead:v1" as const,
    tokenBudget: 20_000,
    estimatedTokens: 0,
    compactedThroughOrdinal: 0,
    omittedEventCount: 0,
    complete: true,
  },
};

function claimed(
  channelReference: ChannelReference,
  index: number,
): ClaimLoopResponse {
  return {
    claimed: true,
    ...channelReference,
    idempotent: false,
    generation: index,
    runId: `run-${index}`,
    mode: "messages",
    channelName: "markets",
    leaseExpiresAt: Date.now() + 120_000,
    windowStart: 1,
    windowEnd: 1,
    contextHash: `context-${index}`,
    recheckCount: 0,
    triggerKind: "ambient",
    conversation: {
      ownerId: "owner-1",
      ownerBindingVersion: 1,
      guildId: channelReference.guildId,
      conversationId: `discord:${channelReference.guildId}`,
      epoch: 1,
      turnId: `run-${index}`,
      runId: `run-${index}`,
      generation: index,
      routingGeneration: 1,
      revision: 1,
      humanRevision: 1,
      personalityVersion: "trishula-discord-v1",
      systemPromptHash: "a".repeat(64),
      capabilityProfileHash: "b".repeat(64),
    },
    conversationGeneration: index,
    conversationLeaseToken: `lease-${index}`,
    routingGeneration: 1,
    durableContext: portableContext,
    fence: {
      conversationId: `discord:${channelReference.guildId}`,
      epoch: 1,
      generation: index,
      routingGeneration: 1,
      turnId: `run-${index}`,
      leaseToken: `lease-${index}`,
    },
    replyChannelId: channelReference.channelId,
    researchLogChannelId: "30",
    messages: [firstMessage],
  };
}

class FakeConvex implements ConvexLoopClient {
  claimCalls = 0;
  claimMode: "messages" | "recheck" = "messages";
  claimTriggerKind: "ambient" | "mention" | "recheck" = "ambient";
  completeCalls: Array<{
    identity: RunIdentity;
    outcome: "completed" | "error";
    options:
      | {
          recheckRequested?: boolean;
          consumesThroughSequence?: number;
          suppressPendingReplies?: boolean;
          error?: string;
          retryable?: boolean;
        }
      | undefined;
  }> = [];
  heartbeatStages: LoopStage[] = [];
  queued: EnqueueReplyInput[] = [];
  newestMessages: AgentMessage[] = [newestMessage];
  newestThroughSequence = 2;
  durableWrites: string[] = [];
  invalidations: Array<{
    checkpointId: string;
    revision: number;
    generation: number;
    routingGeneration: number;
  }> = [];
  nativeCheckpointContext = false;
  invalidationFails = false;
  recovery: Extract<ClaimLoopResponse, { claimed: true }>["recovery"];
  recoveryFailure: Extract<ClaimLoopResponse, { claimed: true }>["recoveryFailure"];

  async claimLoop(
    channelReference: ChannelReference,
  ): Promise<ClaimLoopResponse> {
    this.claimCalls += 1;
    const claim = claimed(channelReference, this.claimCalls);
    if (claim.claimed) {
      claim.mode = this.claimMode;
      claim.triggerKind = this.claimTriggerKind;
      if (this.recovery !== undefined) claim.recovery = this.recovery;
      if (this.recoveryFailure !== undefined) claim.recoveryFailure = this.recoveryFailure;
      if (this.nativeCheckpointContext) {
        const checkpointId = "checkpoint:native:1";
        claim.conversation.activeCheckpointId = checkpointId;
        claim.durableContext = {
          ...claim.durableContext,
          activeCheckpointId: checkpointId,
          activeCheckpointCompactedThroughOrdinal: 1,
          activeCheckpointSourceRevision: 1,
          activeCheckpointSourceContextHash: "c".repeat(64),
          nativeCheckpoint: {
            checkpointId,
            ownerId: claim.conversation.ownerId,
            ownerBindingVersion: claim.conversation.ownerBindingVersion,
            guildId: claim.conversation.guildId,
            conversationId: claim.conversation.conversationId,
            epoch: claim.conversation.epoch,
            compactedThroughOrdinal: 1,
            sourceRevision: 1,
            sourceContextHash: "c".repeat(64),
            personalityVersion: claim.conversation.personalityVersion,
            systemPromptHash: claim.conversation.systemPromptHash,
            capabilityProfileHash: claim.conversation.capabilityProfileHash,
            artifact: {
              schemaVersion: 1,
              implementationVersion: "responses-compaction-v2-pi-0_84_1-v1",
              provider: "openai-codex",
              model: "gpt-5.6-luna",
              replacementHistory: [{ type: "compaction", opaque: "provider-owned" }],
              artifactSha256: "d".repeat(64),
              serializedBytes: 56,
              usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
              requestEvidence: {
                store: false,
                transport: "sse",
                betaFeature: "remote_compaction_v2",
                endpoint: "chatgpt-codex-responses",
              },
            },
          },
        };
      }
    }
    return claim;
  }

  async heartbeatRun(
    _identity: RunIdentity,
    stage: LoopStage,
  ): Promise<boolean> {
    this.heartbeatStages.push(stage);
    return true;
  }

  async newestContext(
    channelReference: ChannelReference,
  ): Promise<NewestContext> {
    return {
      ...channelReference,
      throughSequence: this.newestThroughSequence,
      triggerThroughSequence: this.newestThroughSequence,
      completedThroughSequence: 0,
      contextHash: "newest-context",
      eligibleThroughSequence: this.newestThroughSequence,
      eligibleHumanRevision: this.newestThroughSequence,
      eligibleContextHash: "eligible-context",
      catchUpMessages: this.newestMessages,
      exact: true,
      messages: this.newestMessages,
    };
  }

  async completeLoop(
    identity: RunIdentity,
    outcome: "completed" | "error",
    options?: {
      recheckRequested?: boolean;
      consumesThroughSequence?: number;
      suppressPendingReplies?: boolean;
      error?: string;
      retryable?: boolean;
    },
  ): Promise<CompleteLoopResult> {
    this.completeCalls.push({ identity, outcome, options });
    return { status: "idle", pendingMessageCount: 0, recheckAccepted: false };
  }

  async enqueueReply(input: EnqueueReplyInput): Promise<EnqueueReplyResult> {
    this.queued.push(input);
    return { status: "pending" };
  }

  async recordFrontmanPlan(
    _identity: RunIdentity,
    _requestId: string,
    _plan: FrontmanPlanResponse,
  ): Promise<void> {
    this.durableWrites.push("plan");
  }

  async recordResearchStarted(
    _identity: RunIdentity,
    _requestId: string,
    _request: FrontmanResearchRequest,
    _inputContextHash: string,
    _pass: 1 | 2,
  ): Promise<void> {
    this.durableWrites.push("research_started");
  }

  async recordResearchResult(
    _identity: RunIdentity,
    _requestId: string,
    _research: SolResearchResponse | ResearchFailure,
  ): Promise<void> {
    this.durableWrites.push("research_result");
  }

  async recordFrontmanResume(
    _identity: RunIdentity,
    _requestId: string,
    _resume: FrontmanResumeResponse,
  ): Promise<void> {
    this.durableWrites.push("resume");
  }

  async invalidateNativeCheckpoint(invalidation: {
    checkpointId: string;
    revision: number;
    generation: number;
    routingGeneration: number;
  }): Promise<void> {
    if (this.invalidationFails) throw new Error("Synthetic invalidation outage.");
    this.invalidations.push(invalidation);
    this.durableWrites.push("native_invalidated");
  }
}

class FakePi implements PiLoopClient {
  replyInput: ReplyRequest | null = null;
  calls: Array<"triage" | "research" | "reply"> = [];
  decision: "silent" | "direct" | "research" = "research";
  replyAction: "send" | "suppress" = "send";
  replyChart: ReplyResponse["chart"];
  frontmanAction: FrontmanPlanResponse["action"] = "research";
  durableCalls: string[] = [];
  resumeAction: FrontmanResumeResponse["action"] = "send";
  rejectNativeCheckpointOnPlan = false;
  rejectNativeCheckpointOnResume = false;

  async frontmanPlan(input: FrontmanPlanRequest): Promise<FrontmanPlanResponse> {
    this.durableCalls.push("plan");
    if (this.frontmanAction === "reply" || this.frontmanAction === "clarify") {
      return {
        profile: "frontman_plan",
        action: this.frontmanAction,
        targetMessageId: firstMessage.messageId,
        confidence: 0.98,
        additiveValue: 0.99,
        reasonCode: this.frontmanAction === "reply"
          ? "explicit_stable"
          : "explicit_needs_clarification",
        reply: this.frontmanAction === "reply"
          ? "A durable direct answer."
          : "Which market session do you mean?",
        nativeCheckpointRejection: this.rejectNativeCheckpointOnPlan
          ? { checkpointId: "checkpoint:native:1", reason: "provider_rejected" }
          : undefined,
      };
    }
    if (this.frontmanAction === "silent") {
      return {
        profile: "frontman_plan",
        action: "silent",
        targetMessageId: firstMessage.messageId,
        confidence: 0.8,
        additiveValue: 0.2,
        reasonCode: "ambient_low_value",
      };
    }
    const plan: FrontmanPlanResponse = {
      profile: "frontman_plan",
      action: "research",
      targetMessageId: firstMessage.messageId,
      confidence: 0.98,
      additiveValue: 0.99,
      reasonCode: "explicit_needs_freshness",
      researchRequest: {
        question: "What moved semiconductors?",
        decisionContext: "The answer needs current public evidence.",
        requiredFacts: ["Late-session sector drivers"],
        freshnessRequirement: "Current through the latest session",
        preferredPrimarySources: ["Issuer filings"],
      },
    };
    if (input.triggerKind !== "ambient") {
      plan.acknowledgement = "I'll verify the late-session move.";
    }
    return plan;
  }

  async solResearch(_input: SolResearchRequest): Promise<SolResearchResponse> {
    this.durableCalls.push("sol");
    return {
      profile: "research",
      packet: {
        schemaVersion: 1,
        requestId: "packet-1",
        question: "What moved semiconductors?",
        asOf: "2026-08-30T12:02:00.000Z",
        freshness: { status: "current", detail: "Current through the close." },
        summary: "A verified issuer update led the move.",
        findings: [{
          claim: "The issuer update preceded the move.",
          evidence: "The filing timestamp preceded the price change.",
          sourceIds: ["source-1"],
          kind: "fact",
        }],
        sources: [{
          id: "source-1",
          title: "Issuer filing",
          url: "https://example.com/filing",
          accessedAt: "2026-08-30T12:02:00.000Z",
          primary: true,
        }],
        uncertainties: [],
      },
      estimator: {
        package: "js-tiktoken",
        packageVersion: "1.0.21",
        encoding: "o200k_base",
        modelMapping: "gpt-5.6-sol-estimate",
        exact: false,
        version: "js-tiktoken@1.0.21:o200k_base:gpt-5.6-sol-estimate:v1",
        estimatedTokens: 100,
        serializedBytes: 500,
      },
    };
  }

  async frontmanResume(_input: FrontmanResumeRequest): Promise<FrontmanResumeResponse> {
    this.durableCalls.push("resume");
    const resume: FrontmanResumeResponse = this.resumeAction === "send"
      ? {
          profile: "frontman_resume",
          action: "send",
          reasonCode: "answer_ready",
          reply: "The issuer update led the late-session move.",
        }
      : {
          profile: "frontman_resume",
          action: "suppress",
          reasonCode: "answered_by_human",
        };
    if (this.rejectNativeCheckpointOnResume) {
      resume.nativeCheckpointRejection = {
        checkpointId: "checkpoint:native:1",
        reason: "provider_rejected",
      };
    }
    return resume;
  }

  async triage(input: TriageRequest): Promise<TriageResponse> {
    this.calls.push("triage");
    if (this.decision === "silent") {
      return {
        profile: "triage",
        decision: "silent",
        targetMessageId: null,
        question: null,
        directReply: null,
        acknowledgement: null,
        reason: "The conversation does not need the bot.",
        confidence: 0.9,
        additiveValue: 0.2,
      };
    }
    return {
      profile: "triage",
      decision: this.decision,
      targetMessageId: firstMessage.messageId,
      question: "What changed in semiconductors today?",
      directReply:
        this.decision === "direct"
          ? "Semiconductors are companies that design or manufacture chips."
          : null,
      acknowledgement:
        this.decision === "research" && input.triggerKind === "mention"
          ? "I'll check the late move."
          : null,
      reason: "The channel asked an open market question.",
      confidence: 0.95,
      additiveValue: 0.95,
    };
  }

  async research(_input: ResearchRequest): Promise<ResearchResponse> {
    this.calls.push("research");
    return {
      profile: "research",
      summary: "The sector moved after an earnings release.",
      findings: [
        {
          claim: "A large constituent moved.",
          sourceUrls: ["https://example.com/source"],
        },
      ],
      sources: [
        {
          url: "https://example.com/source",
          title: "Source",
          publishedAt: null,
          accessedAt: "2026-08-30T12:02:00.000Z",
        },
      ],
      freshness: { asOf: "2026-08-30T12:02:00.000Z", status: "current" },
      uncertainty: [],
      noTradingAction: true,
    };
  }

  async reply(input: ReplyRequest): Promise<ReplyResponse> {
    this.calls.push("reply");
    this.replyInput = input;
    const result: ReplyResponse = {
      profile: "reply",
      action: this.replyAction,
      reply:
        this.replyAction === "send"
          ? "The late move followed the earnings release. The broader group was mixed."
          : null,
      reason:
        this.replyAction === "send"
          ? "The answer still adds useful context."
          : "Someone already answered the question.",
    };
    if (this.replyChart !== undefined) result.chart = this.replyChart;
    return result;
  }
}

function orchestrator(
  convex: FakeConvex,
  pi: FakePi,
  durableConversationsEnabled = false,
  typing?: DiscordTypingIndicatorManager,
): ChannelLoopOrchestrator {
  return new ChannelLoopOrchestrator({
    convex,
    pi,
    workerId: "worker-1",
    heartbeatIntervalMs: 60_000,
    durableConversationsEnabled,
    typing: typing ?? new DiscordTypingIndicatorManager(async () => undefined),
  });
}

describe("ChannelLoopOrchestrator", () => {
  it("uses the durable frontman directly without a legacy bypass", async () => {
    const convex = new FakeConvex();
    convex.claimTriggerKind = "mention";
    const pi = new FakePi();
    pi.frontmanAction = "reply";
    orchestrator(convex, pi, true).schedule(channel);

    await vi.waitFor(() => expect(convex.queued).toHaveLength(1));
    expect(pi.durableCalls).toEqual(["plan"]);
    expect(convex.durableWrites).toEqual(["plan"]);
    expect(pi.calls).toEqual([]);
    expect(convex.queued[0]).toMatchObject({
      replyKind: "final",
      content: "A durable direct answer.",
      consumesThroughSequence: 2,
      fence: { eligibleHumanRevision: 2 },
    });
  });

  it("invalidates provider-rejected opaque state before it persists the portable fallback", async () => {
    const convex = new FakeConvex();
    convex.claimTriggerKind = "mention";
    convex.nativeCheckpointContext = true;
    const pi = new FakePi();
    pi.frontmanAction = "reply";
    pi.rejectNativeCheckpointOnPlan = true;
    orchestrator(convex, pi, true).schedule(channel);

    await vi.waitFor(() => expect(convex.queued).toHaveLength(1));
    expect(convex.durableWrites).toEqual(["native_invalidated", "plan"]);
    expect(convex.invalidations).toEqual([{
      checkpointId: "checkpoint:native:1",
      revision: 1,
      generation: 1,
      routingGeneration: 1,
      guildId: "10",
      conversationId: "discord:10",
      epoch: 1,
      ownerBindingVersion: 1,
    }]);
  });

  it("invalidates a resume-time rejection after durable plan and research writes", async () => {
    const convex = new FakeConvex();
    convex.claimTriggerKind = "mention";
    convex.nativeCheckpointContext = true;
    const pi = new FakePi();
    pi.rejectNativeCheckpointOnResume = true;
    orchestrator(convex, pi, true).schedule(channel);

    await vi.waitFor(() => expect(convex.queued).toHaveLength(3));
    expect(convex.durableWrites).toEqual([
      "plan",
      "research_started",
      "research_result",
      "native_invalidated",
      "resume",
    ]);
    expect(convex.invalidations).toHaveLength(1);
  });

  it("keeps the valid portable fallback when native invalidation is temporarily unavailable", async () => {
    const convex = new FakeConvex();
    convex.claimTriggerKind = "mention";
    convex.nativeCheckpointContext = true;
    convex.invalidationFails = true;
    const pi = new FakePi();
    pi.frontmanAction = "reply";
    pi.rejectNativeCheckpointOnPlan = true;
    orchestrator(convex, pi, true).schedule(channel);

    await vi.waitFor(() => expect(convex.queued).toHaveLength(1));
    expect(convex.queued[0]?.content).toBe("A durable direct answer.");
    expect(convex.durableWrites).toEqual(["plan"]);
  });

  it("orders explicit acknowledgement, isolated Sol, catch-up, and resume", async () => {
    const convex = new FakeConvex();
    convex.claimTriggerKind = "mention";
    const pi = new FakePi();
    orchestrator(convex, pi, true).schedule(channel);

    await vi.waitFor(() => expect(convex.queued).toHaveLength(3));
    expect(pi.durableCalls).toEqual(["plan", "sol", "resume"]);
    expect(convex.durableWrites).toEqual([
      "plan",
      "research_started",
      "research_result",
      "resume",
    ]);
    expect(convex.queued.map((reply) => reply.replyKind)).toEqual([
      "acknowledgement",
      "research_log",
      "final",
    ]);
    expect(convex.queued[0]?.idempotencyKey).toBe("ack:discord:10:1:100");
    expect(convex.queued[2]).toMatchObject({
      content: "The issuer update led the late-session move.",
      consumesThroughSequence: 2,
      fence: { eligibleHumanRevision: 2 },
    });
  });

  it("PERS-008 resumes a persisted Sol packet and final draft without rerunning either model", async () => {
    const convex = new FakeConvex();
    convex.claimTriggerKind = "ambient";
    const pi = new FakePi();
    // SAFETY: FakePi.solResearch ignores its request and returns the fixed fixture.
    const research = await pi.solResearch({} as SolResearchRequest);
    pi.durableCalls.length = 0;
    convex.recovery = {
      stage: "drafted",
      plan: {
        profile: "frontman_plan",
        action: "research",
        targetMessageId: firstMessage.messageId,
        confidence: 0.98,
        additiveValue: 0.99,
        reasonCode: "ambient_material_value",
        researchRequest: {
          question: "What moved semiconductors?",
          decisionContext: "Current public evidence is required.",
          requiredFacts: ["Late-session sector drivers"],
          freshnessRequirement: "Current through the latest session",
          preferredPrimarySources: ["Issuer filings"],
        },
      },
      research: {
        requestId: "run-1:sol:1",
        normalizedRequest: {
          question: "What moved semiconductors?",
          decisionContext: "Current public evidence is required.",
          requiredFacts: ["Late-session sector drivers"],
          freshnessRequirement: "Current through the latest session",
          preferredPrimarySources: ["Issuer filings"],
        },
        status: "completed",
        result: research,
      },
      resume: {
        profile: "frontman_resume",
        action: "send",
        reasonCode: "answer_ready",
        reply: "The issuer update led the late-session move.",
      },
      resumeRequestId: "run-1:frontman-resume:1",
      acknowledgementDelivery: "not_required",
      eligibleThroughSequence: 2,
      eligibleHumanRevision: 2,
      eligibleContextHash: "eligible-context",
    };

    const sendTyping = vi.fn(async () => undefined);
    const typing = new DiscordTypingIndicatorManager(sendTyping);
    orchestrator(convex, pi, true, typing).schedule(channel);

    await vi.waitFor(() => expect(convex.queued.some((item) => item.replyKind === "final")).toBe(true));
    expect(pi.durableCalls).toEqual([]);
    expect(sendTyping).not.toHaveBeenCalled();
    expect(convex.durableWrites).toEqual([]);
    expect(convex.queued.find((item) => item.replyKind === "final")?.content)
      .toBe("The issuer update led the late-session move.");
  });

  it("PERS-080 closes an explicit request when Luna planning fails", async () => {
    const convex = new FakeConvex();
    convex.claimTriggerKind = "mention";
    const pi = new FakePi();
    pi.frontmanPlan = async () => {
      throw new PiAgentOperationError("frontman_plan", "agent_result_invalid", false, 200);
    };

    orchestrator(convex, pi, true).schedule(channel);

    await vi.waitFor(() => expect(convex.queued).toHaveLength(1));
    expect(convex.queued[0]).toMatchObject({
      idempotencyKey: "run-1:failure-closure",
      replyKind: "final",
      replyToMessageId: firstMessage.messageId,
      finalizesLoop: true,
    });
    expect(convex.completeCalls).toHaveLength(0);
  });

  it("PERS-080 closes an acknowledged explicit request when Luna resume fails", async () => {
    const convex = new FakeConvex();
    convex.claimTriggerKind = "mention";
    const pi = new FakePi();
    pi.frontmanResume = async () => {
      throw new PiAgentOperationError("frontman_resume", "agent_result_invalid", false, 200);
    };

    orchestrator(convex, pi, true).schedule(channel);

    await vi.waitFor(() => expect(convex.queued).toHaveLength(2));
    expect(convex.queued.map((reply) => reply.replyKind)).toEqual([
      "acknowledgement",
      "final",
    ]);
    expect(convex.queued[1]?.idempotencyKey).toBe("run-1:failure-closure");
    expect(convex.completeCalls).toHaveLength(0);
  });

  it("PERS-008 closes an explicit request when persisted recovery is invalid", async () => {
    const convex = new FakeConvex();
    convex.claimTriggerKind = "mention";
    convex.recoveryFailure = "invalid_persisted_recovery";
    const pi = new FakePi();

    orchestrator(convex, pi, true).schedule(channel);

    await vi.waitFor(() => expect(convex.queued).toHaveLength(1));
    expect(pi.durableCalls).toEqual([]);
    expect(convex.queued[0]?.idempotencyKey).toBe("run-1:failure-closure");
  });
  it("keeps ambient research quiet until the final reply", async () => {
    const convex = new FakeConvex();
    const pi = new FakePi();
    orchestrator(convex, pi).schedule(channel);

    await vi.waitFor(() => expect(convex.queued).toHaveLength(2));
    expect(pi.replyInput?.messages).toEqual([newestMessage]);
    expect(pi.replyInput?.triggerKind).toBe("ambient");
    expect(pi.replyInput?.targetMessageId).toBe("100");
    expect(pi.calls).toEqual(["triage", "research", "reply"]);
    expect(convex.queued[0]).toMatchObject({
      targetChannelId: "30",
      idempotencyKey: "run-1:research",
      replyKind: "research_log",
      finalizesLoop: false,
      recheckRequested: false,
    });
    expect(convex.queued[1]).toMatchObject({
      targetChannelId: "20",
      idempotencyKey: "run-1:reply",
      replyKind: "final",
      finalizesLoop: true,
      recheckRequested: false,
      replyToMessageId: "100",
      consumesThroughSequence: 2,
    });
    expect(convex.heartbeatStages).toEqual([
      "triaging",
      "researching",
      "catching_up",
      "drafting",
    ]);
    expect(convex.completeCalls).toHaveLength(0);
  });

  it("acknowledges explicit research before doing the longer work", async () => {
    const convex = new FakeConvex();
    convex.claimTriggerKind = "mention";
    const pi = new FakePi();
    orchestrator(convex, pi).schedule(channel);

    await vi.waitFor(() => expect(convex.queued).toHaveLength(3));
    expect(convex.queued[0]).toMatchObject({
      targetChannelId: "20",
      idempotencyKey: "ack:20:100",
      replyKind: "acknowledgement",
      finalizesLoop: false,
      replyToMessageId: "100",
      content: "I'll check the late move.",
    });
    expect(convex.heartbeatStages).toContain("acknowledging");
  });

  it("uses one Luna call for a direct reply", async () => {
    const convex = new FakeConvex();
    const pi = new FakePi();
    pi.decision = "direct";
    orchestrator(convex, pi).schedule(channel);

    await vi.waitFor(() => expect(convex.queued).toHaveLength(1));
    expect(pi.calls).toEqual(["triage"]);
    expect(convex.queued[0]).toMatchObject({
      replyKind: "final",
      content: "Semiconductors are companies that design or manufacture chips.",
      replyToMessageId: "100",
      consumesThroughSequence: 1,
      recheckRequested: false,
      finalizesLoop: true,
    });
  });

  it("suppresses a stale researched reply without queuing the research log", async () => {
    const convex = new FakeConvex();
    const pi = new FakePi();
    pi.replyAction = "suppress";
    orchestrator(convex, pi).schedule(channel);

    await vi.waitFor(() => expect(convex.completeCalls).toHaveLength(1));
    expect(convex.queued).toHaveLength(0);
    expect(convex.completeCalls[0]).toMatchObject({
      outcome: "completed",
      options: {
        consumesThroughSequence: 2,
        suppressPendingReplies: true,
        recheckRequested: false,
      },
    });
  });

  it("leaves a later explicit mention pending and attaches the trusted chart", async () => {
    const convex = new FakeConvex();
    const pi = new FakePi();
    const explicitMessage: AgentMessage = {
      messageId: "102",
      sequence: 3,
      authorId: "202",
      authorName: "Zoe",
      content: "@bot what about memory stocks?",
      mentionsBot: true,
      createdAt: "2026-08-30T12:02:00.000Z",
      isBot: false,
    };
    convex.newestMessages = [newestMessage, explicitMessage];
    convex.newestThroughSequence = 3;
    pi.replyChart = {
      symbol: "SOXX",
      points: [
        { timestamp: 1, close: 100 },
        { timestamp: 2, close: 102 },
      ],
    };
    orchestrator(convex, pi).schedule(channel);

    await vi.waitFor(() => expect(convex.queued).toHaveLength(2));
    expect(pi.replyInput?.messages).toEqual([newestMessage]);
    expect(convex.queued[1]).toMatchObject({
      replyKind: "final",
      consumesThroughSequence: 2,
      chart: pi.replyChart,
      recheckRequested: false,
    });
  });

  it("does not consume a message burst that fell outside the newest context window", async () => {
    const convex = new FakeConvex();
    const pi = new FakePi();
    convex.newestMessages = Array.from({ length: 10 }, (_, index) => ({
      ...newestMessage,
      messageId: String(110 + index),
      sequence: 11 + index,
      content: `Burst message ${11 + index}`,
    }));
    convex.newestThroughSequence = 20;
    orchestrator(convex, pi).schedule(channel);

    await vi.waitFor(() => expect(convex.queued).toHaveLength(2));
    expect(pi.replyInput?.messages).toEqual([firstMessage]);
    expect(convex.queued[1]).toMatchObject({
      replyKind: "final",
      consumesThroughSequence: 1,
    });
  });

  it("completes directly when Luna chooses not to respond", async () => {
    const convex = new FakeConvex();
    const pi = new FakePi();
    pi.decision = "silent";
    orchestrator(convex, pi).schedule(channel);

    await vi.waitFor(() => expect(convex.completeCalls).toHaveLength(1));
    expect(convex.completeCalls[0]).toMatchObject({
      outcome: "completed",
      options: { recheckRequested: false, consumesThroughSequence: 1 },
    });
    expect(convex.queued).toHaveLength(0);
  });

  it("does not run the same guild and channel twice in parallel", async () => {
    const convex = new FakeConvex();
    const pi = new FakePi();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalTriage = pi.triage.bind(pi);
    pi.triage = async (input) => {
      await gate;
      return originalTriage(input);
    };
    const loops = orchestrator(convex, pi);

    loops.schedule(channel);
    loops.schedule(channel);
    expect(loops.isLocallyRunning(channel)).toBe(true);
    expect(convex.claimCalls).toBe(1);
    release();

    await vi.waitFor(() => expect(convex.queued).toHaveLength(2));
    expect(convex.claimCalls).toBe(1);
  });

  it("records agent failures as loop errors", async () => {
    const convex = new FakeConvex();
    const pi = new FakePi();
    pi.triage = async () => {
      throw new Error("Agent unavailable.");
    };
    orchestrator(convex, pi).schedule(channel);

    await vi.waitFor(() => expect(convex.completeCalls).toHaveLength(1));
    expect(convex.completeCalls[0]).toMatchObject({
      outcome: "error",
      options: { error: "Discord agent loop failed.", retryable: true },
    });
  });

  it("records only the safe Pi failure code in Convex", async () => {
    const convex = new FakeConvex();
    const pi = new FakePi();
    pi.research = async () => {
      throw new PiAgentOperationError(
        "research",
        "provider_network",
        true,
        502,
      );
    };
    orchestrator(convex, pi).schedule(channel);

    await vi.waitFor(() => expect(convex.completeCalls).toHaveLength(1));
    expect(convex.completeCalls[0]).toMatchObject({
      outcome: "error",
      options: {
        error: "Pi research failed: provider_network.",
        retryable: true,
      },
    });
  });

  it("stops automatic recovery for a nonretryable Pi failure", async () => {
    const convex = new FakeConvex();
    const pi = new FakePi();
    pi.research = async () => {
      throw new PiAgentOperationError(
        "research",
        "agent_result_invalid",
        false,
        200,
      );
    };
    orchestrator(convex, pi).schedule(channel);

    await vi.waitFor(() => expect(convex.completeCalls).toHaveLength(1));
    expect(convex.completeCalls[0]).toMatchObject({
      outcome: "error",
      options: {
        error: "Pi research failed: agent_result_invalid.",
        retryable: false,
      },
    });
  });
});

describe("Luna typing windows in the real channel loop", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it.each([false, true])("types only around active Luna calls, not Sol research (durable=%s)", async (durable) => {
    const convex = new FakeConvex();
    const pi = new FakePi();
    const signals: AbortSignal[] = [];
    const send = vi.fn(async (_channel: ChannelReference, signal: AbortSignal) => { signals.push(signal); });
    const typing = new DiscordTypingIndicatorManager(send);
    const planGate = Promise.withResolvers<void>();
    const researchGate = Promise.withResolvers<void>();
    const resumeGate = Promise.withResolvers<void>();
    let modelsStarted = 0;
    const luna = async <T>(gate: Promise<void>, run: () => Promise<T>): Promise<T> => {
      expect(signals.at(-1)?.aborted).toBe(false);
      modelsStarted += 1;
      await gate;
      return run();
    };
    const sol = async <T>(run: () => Promise<T>): Promise<T> => {
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      modelsStarted += 1;
      await researchGate.promise;
      return run();
    };
    if (durable) {
      const plan = pi.frontmanPlan.bind(pi), research = pi.solResearch.bind(pi), resume = pi.frontmanResume.bind(pi);
      pi.frontmanPlan = (input) => luna(planGate.promise, () => plan(input));
      pi.solResearch = (input) => sol(() => research(input));
      pi.frontmanResume = (input) => luna(resumeGate.promise, () => resume(input));
    } else {
      const plan = pi.triage.bind(pi), research = pi.research.bind(pi), resume = pi.reply.bind(pi);
      pi.triage = (input) => luna(planGate.promise, () => plan(input));
      pi.research = (input) => sol(() => research(input));
      pi.reply = (input) => luna(resumeGate.promise, () => resume(input));
    }
    const loop = orchestrator(convex, pi, durable, typing);
    loop.schedule(channel);
    await vi.waitFor(() => expect(modelsStarted).toBe(1));
    expect(send).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(send).toHaveBeenCalledTimes(2);
    planGate.resolve();
    await vi.waitFor(() => expect(modelsStarted).toBe(2));
    await vi.advanceTimersByTimeAsync(16_000);
    expect(send).toHaveBeenCalledTimes(2);
    researchGate.resolve();
    await vi.waitFor(() => expect(modelsStarted).toBe(3));
    expect(send).toHaveBeenCalledTimes(3);
    resumeGate.resolve();
    await vi.waitFor(() => expect(loop.isLocallyRunning(channel)).toBe(false));
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])("cleans up silence and model failures (durable=%s)", async (durable) => {
    for (const outcome of ["silent", "error"] as const) {
      const convex = new FakeConvex();
      const pi = new FakePi();
      pi.decision = "silent"; pi.frontmanAction = "silent";
      if (outcome === "error") {
        const fail = async (): Promise<never> => { throw new Error("Synthetic Luna outage"); };
        pi.triage = fail; pi.frontmanPlan = fail;
      }
      const signals: AbortSignal[] = [];
      const typing = new DiscordTypingIndicatorManager(async (_channel, signal) => { signals.push(signal); });
      const loop = orchestrator(convex, pi, durable, typing);
      loop.schedule(channel);
      await vi.waitFor(() => expect(loop.isLocallyRunning(channel)).toBe(false));
      expect(signals).toHaveLength(1);
      expect(signals[0]?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("does not wait for a nonsettling typing transport before completing Luna", async () => {
    const convex = new FakeConvex();
    const pi = new FakePi(); pi.decision = "direct";
    const pending = Promise.withResolvers<void>();
    const send = vi.fn(() => pending.promise);
    const typing = new DiscordTypingIndicatorManager(send);
    const loop = orchestrator(convex, pi, false, typing);
    loop.schedule(channel);
    await vi.waitFor(() => expect(loop.isLocallyRunning(channel)).toBe(false));
    expect(pi.calls).toEqual(["triage"]);
    expect(convex.queued).toHaveLength(1);
    expect(send).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    pending.resolve();
  });

  it("stops typing immediately on lease loss while Luna is still pending", async () => {
    const convex = new FakeConvex();
    vi.spyOn(convex, "heartbeatRun").mockResolvedValueOnce(true).mockResolvedValue(false);
    const pi = new FakePi(); pi.decision = "silent";
    const plan = pi.triage.bind(pi);
    const pending = Promise.withResolvers<void>();
    pi.triage = async (input) => { await pending.promise; return plan(input); };
    const signals: AbortSignal[] = [];
    const typing = new DiscordTypingIndicatorManager(async (_channel, signal) => { signals.push(signal); });
    const loop = new ChannelLoopOrchestrator({ convex, pi, typing, workerId: "worker", heartbeatIntervalMs: 1_000 });
    loop.schedule(channel);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(signals[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(signals).toHaveLength(1);
    pending.resolve();
    await vi.waitFor(() => expect(loop.isLocallyRunning(channel)).toBe(false));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the claimed reply channel and ignores later windows after shutdown", async () => {
    const convex = new FakeConvex();
    const originalClaim = convex.claimLoop.bind(convex);
    vi.spyOn(convex, "claimLoop").mockImplementation(async (reference) => {
      const result = await originalClaim(reference);
      if (result.claimed) result.replyChannelId = "99";
      return result;
    });
    const pi = new FakePi();
    const plan = pi.frontmanPlan.bind(pi);
    const pending = Promise.withResolvers<void>();
    pi.frontmanPlan = async (input) => { await pending.promise; return plan(input); };
    const send = vi.fn(async (_channel: ChannelReference, _signal: AbortSignal) => undefined);
    const typing = new DiscordTypingIndicatorManager(send);
    const loop = orchestrator(convex, pi, true, typing);
    loop.schedule(channel);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0]?.[0]).toEqual({ guildId: "10", channelId: "99" });
    typing.dispose();
    pending.resolve();
    await vi.waitFor(() => expect(loop.isLocallyRunning(channel)).toBe(false));
    expect(send).toHaveBeenCalledOnce();
    expect(pi.durableCalls).toEqual(["plan", "sol", "resume"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
