import { describe, expect, it, vi } from "vitest";
import type {
  CompleteLoopResult,
  EnqueueReplyInput,
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

  async claimLoop(
    channelReference: ChannelReference,
  ): Promise<ClaimLoopResponse> {
    this.claimCalls += 1;
    const claim = claimed(channelReference, this.claimCalls);
    if (claim.claimed) {
      claim.mode = this.claimMode;
      claim.triggerKind = this.claimTriggerKind;
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

  async enqueueReply(input: EnqueueReplyInput): Promise<void> {
    this.queued.push(input);
  }
}

class FakePi implements PiLoopClient {
  replyInput: ReplyRequest | null = null;
  calls: Array<"triage" | "research" | "reply"> = [];
  decision: "silent" | "direct" | "research" = "research";
  replyAction: "send" | "suppress" = "send";
  replyChart: ReplyResponse["chart"];

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

function orchestrator(convex: FakeConvex, pi: FakePi): ChannelLoopOrchestrator {
  return new ChannelLoopOrchestrator({
    convex,
    pi,
    workerId: "worker-1",
    heartbeatIntervalMs: 60_000,
  });
}

describe("ChannelLoopOrchestrator", () => {
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
