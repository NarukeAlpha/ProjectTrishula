import type { Express, RequestHandler } from "express";
import {
  journalCancelBodySchema,
  journalCancelParamsSchema,
  journalRunRequestSchema,
} from "./contracts.js";
import type { JournalJobRegistryBoundary } from "./jobs.js";
import type { JournalAgentRunner } from "./runner.js";

export interface JournalRouteOptions {
  authenticate: RequestHandler;
  json: RequestHandler;
  runner?: JournalAgentRunner;
  jobs?: JournalJobRegistryBoundary;
}

export function mountJournalRoutes(app: Express, options: JournalRouteOptions): void {
  app.post("/v1/journal/runs", options.authenticate, options.json, (request, response) => {
    if (!options.jobs || !options.runner?.readiness().ready) {
      response.status(503).json({
        error: options.runner?.readiness().reason ?? "journal_agent_not_ready",
      });
      return;
    }

    const parsed = journalRunRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      response.status(400).json({
        error: firstIssue ? firstIssue.message : "invalid_journal_run_request",
      });
      return;
    }

    const submission = options.jobs.submit(parsed.data);
    if (submission.type === "conflict") {
      response.status(409).json({ error: "journal_run_conflict" });
      return;
    }
    if (submission.type === "capacity") {
      response.setHeader("Retry-After", "1");
      response.status(429).json({ error: "journal_run_capacity" });
      return;
    }
    if (submission.type === "not_accepting") {
      response.status(503).json({ error: "journal_service_shutting_down" });
      return;
    }

    response.status(202).json({
      accepted: true,
      runId: submission.runId,
    });
  });

  app.post("/v1/journal/runs/:runId/cancel", options.authenticate, options.json, (request, response) => {
    if (!options.jobs) {
      response.status(503).json({ error: "journal_agent_not_ready" });
      return;
    }

    const params = journalCancelParamsSchema.safeParse(request.params);
    const body = journalCancelBodySchema.safeParse(request.body);
    if (!params.success || !body.success || body.data.runId !== params.data.runId) {
      response.status(400).json({ error: "invalid_journal_cancel_request" });
      return;
    }

    const result = options.jobs.cancel(params.data.runId, body.data.ownerId);
    if (result.type === "conflict") {
      response.status(409).json({ error: "journal_run_conflict" });
      return;
    }

    response.status(200).json({
      canceled: true,
      runId: result.runId,
    });
  });
}
