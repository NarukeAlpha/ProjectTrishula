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

const channel: ChannelReference = { guildId: "10", channelId: "20" };
const firstMessage: AgentMessage = {
  messageId: "100",
  authorId: "200",
  authorName: "Mira",
  content: "What changed in the semiconductor sector today?",
  createdAt: "2026-08-30T12:00:00.000Z",
  isBot: false,
};
const newestMessage: AgentMessage = {
  messageId: "101",
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
    replyChannelId: channelReference.channelId,
    researchLogChannelId: "30",
    messages: [firstMessage],
  };
}

class FakeConvex implements ConvexLoopClient {
  claimCalls = 0;
  completeCalls: Array<{
    identity: RunIdentity;
    outcome: "completed" | "error";
    options: { recheckRequested?: boolean; error?: string } | undefined;
  }> = [];
  heartbeatStages: LoopStage[] = [];
  queued: EnqueueReplyInput[] = [];

  async claimLoop(
    channelReference: ChannelReference,
  ): Promise<ClaimLoopResponse> {
    this.claimCalls += 1;
    return claimed(channelReference, this.claimCalls);
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
      throughSequence: 2,
      triggerThroughSequence: 2,
      completedThroughSequence: 0,
      contextHash: "newest-context",
      messages: [newestMessage],
    };
  }

  async completeLoop(
    identity: RunIdentity,
    outcome: "completed" | "error",
    options?: { recheckRequested?: boolean; error?: string },
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
  shouldRespond = true;

  async triage(_input: TriageRequest): Promise<TriageResponse> {
    return this.shouldRespond
      ? {
          profile: "triage",
          shouldRespond: true,
          shouldResearch: true,
          question: "What changed in semiconductors today?",
          reason: "The channel asked an open market question.",
          confidence: 0.9,
        }
      : {
          profile: "triage",
          shouldRespond: false,
          shouldResearch: false,
          question: null,
          reason: "The conversation does not need the bot.",
          confidence: 0.9,
        };
  }

  async research(_input: ResearchRequest): Promise<ResearchResponse> {
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
    this.replyInput = input;
    return {
      profile: "reply",
      reply:
        "The late move followed the earnings release. The broader group was mixed.",
      recheck: true,
      recheckReason: "A new counterpoint should be checked.",
    };
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
  it("uses the newest context and queues research before the final reply", async () => {
    const convex = new FakeConvex();
    const pi = new FakePi();
    orchestrator(convex, pi).schedule(channel);

    await vi.waitFor(() => expect(convex.queued).toHaveLength(2));
    expect(pi.replyInput?.messages).toEqual([newestMessage]);
    expect(convex.heartbeatStages).toEqual([
      "triaging",
      "researching",
      "catching_up",
      "drafting",
    ]);
    expect(convex.queued[0]).toMatchObject({
      targetChannelId: "30",
      finalizesLoop: false,
      recheckRequested: false,
    });
    expect(convex.queued[1]).toMatchObject({
      targetChannelId: "20",
      replyToMessageId: "101",
      finalizesLoop: true,
      recheckRequested: true,
    });
    expect(convex.completeCalls).toHaveLength(0);
  });

  it("completes directly when Luna chooses not to respond", async () => {
    const convex = new FakeConvex();
    const pi = new FakePi();
    pi.shouldRespond = false;
    orchestrator(convex, pi).schedule(channel);

    await vi.waitFor(() => expect(convex.completeCalls).toHaveLength(1));
    expect(convex.completeCalls[0]).toMatchObject({
      outcome: "completed",
      options: { recheckRequested: false },
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
      options: { error: "Agent unavailable." },
    });
  });
});
