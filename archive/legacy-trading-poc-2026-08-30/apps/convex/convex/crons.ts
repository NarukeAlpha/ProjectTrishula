import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

crons.interval("reconcile expired Signal runs", { minutes: 1 }, internal.reconciliation.reconcileExpiredRuns, {});
crons.interval("expire stale Signal trade proposals", { minutes: 1 }, internal.trading.expireStaleProposals, {});

export default crons;
