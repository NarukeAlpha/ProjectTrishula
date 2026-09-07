import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

crons.interval("reconcile expired Signal runs", { minutes: 1 }, internal.reconciliation.reconcileExpiredRuns, {});
crons.interval("expire stale Signal trade proposals", { minutes: 1 }, internal.trading.expireStaleProposals, {});
crons.interval("expire Discord portable checkpoints", { hours: 1 }, internal.discord.expirePortableCheckpoints, {});
crons.interval("enqueue due market newspapers", { minutes: 1 }, internal.market_research.checkDueEditions, {});
crons.interval(
  "recover market newspaper leases",
  { minutes: 1 },
  internal.market_research_dispatch.recoverMarketResearch,
  {},
);
crons.daily(
  "expire market newspaper previews",
  { hourUTC: 5, minuteUTC: 17 },
  internal.market_research.expirePreviewsAndEvidence,
  {},
);

export default crons;
