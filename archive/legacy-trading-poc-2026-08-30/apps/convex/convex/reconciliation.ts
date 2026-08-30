import { internal } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";
import { RECONCILIATION_BATCH_SIZE } from "./lib/invariants.js";

export const reconcileExpiredRuns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let remaining = RECONCILIATION_BATCH_SIZE;
    let examined = 0;
    let finalized = 0;

    const pending = await ctx.db
      .query("runs")
      .withIndex("by_status_dispatchDeadlineAt", (index) => index.eq("status", "pending").lt("dispatchDeadlineAt", now))
      .take(remaining);
    for (const run of pending) {
      examined += 1;
      remaining -= 1;
      if (run.dispatchDeadlineAt && await ctx.runMutation(internal.results.failPendingRun, {
        runId: run._id,
        expectedDispatchDeadlineAt: run.dispatchDeadlineAt,
        code: "backend_unavailable",
        message: "The execution backend did not accept this run before its dispatch deadline.",
      })) {
        finalized += 1;
      }
    }

    for (const status of ["running", "cancellation_requested"] as const) {
      if (remaining === 0) break;
      const expired = await ctx.db
        .query("runs")
        .withIndex("by_status_leaseExpiresAt", (index) => index.eq("status", status).lt("leaseExpiresAt", now))
        .take(remaining);
      for (const run of expired) {
        examined += 1;
        remaining -= 1;
        if (run.leaseExpiresAt && await ctx.runMutation(internal.results.failLostRun, {
          runId: run._id,
          expectedLeaseExpiresAt: run.leaseExpiresAt,
        })) {
          finalized += 1;
        }
      }
    }

    if (examined === RECONCILIATION_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.reconciliation.reconcileExpiredRuns, {});
    }
    return { examined, finalized };
  },
});
