import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api.js";
import { internalAction, type ActionCtx } from "./_generated/server.js";
import { executionRequest } from "./lib/execution.js";
import { classifyResearchDispatchFailure } from "./lib/market_research.js";

const DISPATCH_WORKER_ID = "convex-market-research-dispatch";
const MAX_RECOVERY_BATCHES_PER_ACTION = 4;
const MAX_RECOVERY_CONTINUATIONS = 25;
const MAX_DISPATCH_ERROR_BODY_BYTES = 1_024;
const dispatchErrorResponseSchema = z.strictObject({ error: z.string().max(100) });

interface ResearchJobRequest {
  editionId: string;
  ownerId: string;
  generation: number;
  claimToken: string;
}

interface RecoveryResult {
  scanned: number;
  recovered: number;
  researchRequests: ResearchJobRequest[];
  hasMore: boolean;
}

async function boundedErrorCode(response: Response): Promise<string | undefined> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_DISPATCH_ERROR_BODY_BYTES) return undefined;
  if (response.body === null) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_DISPATCH_ERROR_BODY_BYTES) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const result = dispatchErrorResponseSchema.safeParse(parsed);
    return result.success ? result.data.error : undefined;
  } catch {
    return undefined;
  }
}

async function sendJob(
  ctx: Pick<ActionCtx, "runMutation">,
  request: ResearchJobRequest,
): Promise<boolean> {
  let failure: ReturnType<typeof classifyResearchDispatchFailure> | undefined;
  try {
    const response = await executionRequest(request.ownerId, "/market-research/jobs", request);
    if (response.status === 200 || response.status === 202) return true;
    const errorCode = await boundedErrorCode(response);
    failure = errorCode === undefined
      ? classifyResearchDispatchFailure({ status: response.status })
      : classifyResearchDispatchFailure({ status: response.status, errorCode });
  } catch (error) {
    failure = classifyResearchDispatchFailure({
      errorMessage: error instanceof Error ? error.message : "transport failure",
    });
  }
  await ctx.runMutation(internal.market_research.failRun, {
    editionId: request.editionId,
    generation: request.generation,
    claimToken: request.claimToken,
    code: failure.code,
    retryable: failure.retryable,
  });
  return false;
}

export const dispatchEdition = internalAction({
  args: { editionId: v.string() },
  handler: async (ctx, args): Promise<{ dispatched: boolean }> => {
    const request: ResearchJobRequest | null = await ctx.runMutation(internal.market_research.claimResearch, {
      editionId: args.editionId,
      workerId: DISPATCH_WORKER_ID,
    });
    if (!request) return { dispatched: false };
    return { dispatched: await sendJob(ctx, request) };
  },
});

export const dispatchPreview = internalAction({
  args: { previewId: v.string() },
  handler: async (ctx, args): Promise<{ dispatched: boolean }> => {
    const request: ResearchJobRequest | null = await ctx.runMutation(internal.market_research.claimPreview, {
      previewId: args.previewId,
      workerId: DISPATCH_WORKER_ID,
    });
    if (!request) return { dispatched: false };
    return { dispatched: await sendJob(ctx, request) };
  },
});

export const recoverMarketResearch = internalAction({
  args: { continuation: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{
    scanned: number;
    recovered: number;
    dispatched: number;
    hasMore: boolean;
  }> => {
    let scanned = 0;
    let recovered = 0;
    let dispatched = 0;
    let hasMore = false;
    for (let batch = 0; batch < MAX_RECOVERY_BATCHES_PER_ACTION; batch += 1) {
      const result: RecoveryResult = await ctx.runMutation(internal.market_research.recoverBatch, {});
      scanned += result.scanned;
      recovered += result.recovered;
      for (const request of result.researchRequests) {
        if (await sendJob(ctx, request)) dispatched += 1;
      }
      hasMore = result.hasMore;
      if (!hasMore) break;
    }
    const continuation = args.continuation ?? 0;
    if (hasMore && continuation < MAX_RECOVERY_CONTINUATIONS) {
      await ctx.scheduler.runAfter(0, internal.market_research_dispatch.recoverMarketResearch, {
        continuation: continuation + 1,
      });
    }
    return { scanned, recovered, dispatched, hasMore };
  },
});
