import { makeFunctionReference } from "convex/server";
import type {
  ActiveRunReadModel,
  CommandAccepted,
  CommandReadModel,
  MessageReadModel,
  Page,
  PortfolioSnapshotReadModel,
  ProposalExecutionResult,
  RobinhoodConnectionResult,
  ThreadSummary,
  TradingDashboardReadModel,
} from "./types";

type PaginationOptions = { cursor: string | null; numItems: number };
type NoArguments = Record<string, never>;

// This service intentionally uses public string references. It can deploy before
// the Convex service generates its local API module, and it cannot import an
// internal or server-only function reference by accident.
export const publicApi = {
  threads: {
    list: makeFunctionReference<
      "query",
      { paginationOpts: PaginationOptions },
      Page<ThreadSummary>
    >("threads:list"),
    get: makeFunctionReference<
      "query",
      { threadId: string },
      ThreadSummary | null
    >("threads:get"),
    rename: makeFunctionReference<
      "mutation",
      { commandId: string; threadId: string; title: string },
      CommandAccepted
    >("threads:rename"),
    archive: makeFunctionReference<
      "mutation",
      { commandId: string; threadId: string },
      CommandAccepted
    >("threads:archive"),
  },
  messages: {
    listPage: makeFunctionReference<
      "query",
      { threadId: string; paginationOpts: PaginationOptions },
      Page<MessageReadModel>
    >("messages:listPage"),
  },
  runs: {
    getActive: makeFunctionReference<
      "query",
      { threadId: string; afterSequence?: number; limit?: number },
      ActiveRunReadModel | null
    >("runs:getActive"),
  },
  commands: {
    get: makeFunctionReference<
      "query",
      { commandId: string },
      CommandReadModel | null
    >("commands:get"),
    submitPrompt: makeFunctionReference<
      "mutation",
      { commandId: string; threadId?: string; text: string },
      CommandAccepted
    >("commands:submitPrompt"),
    retryRun: makeFunctionReference<
      "mutation",
      {
        commandId: string;
        runId: string;
      },
      CommandAccepted
    >("commands:retryRun"),
    requestStop: makeFunctionReference<
      "mutation",
      {
        commandId: string;
        runId: string;
      },
      CommandAccepted
    >("commands:requestStop"),
  },
  trading: {
    getDashboard: makeFunctionReference<
      "query",
      NoArguments,
      TradingDashboardReadModel
    >("trading:getDashboard"),
    startRobinhoodConnection: makeFunctionReference<
      "action",
      NoArguments,
      RobinhoodConnectionResult
    >("trading:startRobinhoodConnection"),
    disconnectRobinhood: makeFunctionReference<
      "action",
      NoArguments,
      { status: "disconnected" }
    >("trading:disconnectRobinhood"),
    refreshPortfolio: makeFunctionReference<
      "action",
      NoArguments,
      PortfolioSnapshotReadModel
    >("trading:refreshPortfolio"),
    approveProposal: makeFunctionReference<
      "action",
      { proposalId: string; fingerprint: string },
      ProposalExecutionResult
    >("trading:approveProposal"),
    rejectProposal: makeFunctionReference<
      "mutation",
      { proposalId: string; fingerprint: string },
      { status: "rejected" }
    >("trading:rejectProposal"),
  },
} as const;
