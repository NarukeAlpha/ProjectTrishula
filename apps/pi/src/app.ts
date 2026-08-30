import express, { type ErrorRequestHandler } from "express";
import type { ExecutionExecutor } from "./execution/executor.js";
import type { AcceptRunResult, CancelRunResult } from "./execution/run-registry.js";
import { bearerAuthentication } from "./http/auth.js";
import {
  actorBodySchema,
  cancelBodySchema,
  cancelParamsSchema,
  orderExecutionSchema,
  robinhoodCompleteSchema,
  runRequestSchema,
} from "./http/schemas.js";
import type { TradingBroker } from "./broker/types.js";
import { isBoundActor } from "./identity/actor-binding.js";
import { discordAgentJobParamsSchema, discordAgentRequestSchema } from "./discord/contracts.js";
import type { DiscordAgentRunner } from "./discord/runner.js";
import type { DiscordAgentJobRegistry } from "./discord/jobs.js";

export interface AppDependencies {
  sharedSecret: string;
  discordSharedSecret: string;
  executor: ExecutionExecutor;
  registry: AppRunRegistry;
  broker?: TradingBroker;
  boundActorId?: string;
  discordAgents?: DiscordAgentRunner;
  discordAgentJobs?: DiscordAgentJobRegistry;
}

export interface AppRunRegistry {
  isAccepting(): boolean;
  reserve(request: Parameters<ExecutionExecutor["execute"]>[0]): AcceptRunResult;
  start(runId: string): void;
  cancel(runId: string, actorId: string): CancelRunResult;
}

interface HealthResponse {
  ok: boolean;
  service: string;
  acceptingRuns: boolean;
  executor: ReturnType<ExecutionExecutor["readiness"]>;
  discordAgents?: ReturnType<DiscordAgentRunner["readiness"]>;
}

export function createApp(dependencies: AppDependencies): express.Express {
  const app = express();
  const authenticate = bearerAuthentication(dependencies.sharedSecret);
  const authenticateDiscord = bearerAuthentication(dependencies.discordSharedSecret);
  const json = express.json({ limit: "2mb", strict: true });

  app.disable("x-powered-by");

  app.get("/health", (_request, response) => {
    const executor = dependencies.executor.readiness();
    const discordAgents = dependencies.discordAgents?.readiness();
    const ready = dependencies.registry.isAccepting() && executor.ready && (discordAgents?.ready ?? true);
    const health: HealthResponse = {
      ok: ready,
      service: "project-trishula-pi",
      acceptingRuns: dependencies.registry.isAccepting(),
      executor,
    };
    if (discordAgents) health.discordAgents = discordAgents;
    response.status(ready ? 200 : 503).json(health);
  });

  app.post("/discord/agents/run", authenticateDiscord, json, async (request, response) => {
    if (!dependencies.discordAgents?.readiness().ready) {
      response.status(503).json({ error: "discord_agents_not_ready" });
      return;
    }
    const parsed = discordAgentRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_discord_agent_request" });
      return;
    }
    const abortController = new AbortController();
    const abort = () => abortController.abort(new Error("discord_request_aborted"));
    request.once("aborted", abort);
    try {
      response.json(await dependencies.discordAgents.run(parsed.data, abortController.signal));
    } catch {
      if (!response.headersSent) response.status(502).json({ error: "discord_agent_run_failed" });
    } finally {
      request.off("aborted", abort);
    }
  });

  app.post("/discord/agents/jobs", authenticateDiscord, json, (request, response) => {
    if (!dependencies.discordAgents?.readiness().ready || !dependencies.discordAgentJobs) {
      response.status(503).json({ error: "discord_agents_not_ready" });
      return;
    }
    const parsed = discordAgentRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_discord_agent_request" });
      return;
    }
    const submission = dependencies.discordAgentJobs.submit(parsed.data);
    if (submission.type === "conflict") {
      response.status(409).json({ error: "discord_agent_job_conflict" });
      return;
    }
    if (submission.type === "capacity") {
      response.setHeader("Retry-After", "1");
      response.status(429).json({ error: "discord_agent_job_capacity" });
      return;
    }
    if (submission.type === "not_accepting") {
      response.status(503).json({ error: "discord_agents_not_ready" });
      return;
    }
    response.status(submission.job.status === "running" ? 202 : 200).json({
      jobId: submission.job.jobId,
      status: submission.job.status,
    });
  });

  app.get("/discord/agents/jobs/:jobId", authenticateDiscord, (request, response) => {
    const params = discordAgentJobParamsSchema.safeParse(request.params);
    if (!params.success || !dependencies.discordAgentJobs) {
      response.status(404).json({ error: "discord_agent_job_not_found" });
      return;
    }
    const job = dependencies.discordAgentJobs.get(params.data.jobId);
    if (!job) {
      response.status(404).json({ error: "discord_agent_job_not_found" });
      return;
    }
    response.json(job);
  });

  app.delete("/discord/agents/jobs/:jobId", authenticateDiscord, (request, response) => {
    const params = discordAgentJobParamsSchema.safeParse(request.params);
    if (
      !params.success ||
      !dependencies.discordAgentJobs ||
      dependencies.discordAgentJobs.cancel(params.data.jobId) === "not_found"
    ) {
      response.status(404).json({ error: "discord_agent_job_not_found" });
      return;
    }
    response.json({ jobId: params.data.jobId, status: "cancelled" });
  });

  app.post("/runs", authenticate, json, (request, response) => {
    const parsed = runRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_run_request" });
      return;
    }
    if (!isBoundActor(dependencies.boundActorId, parsed.data.actorId)) {
      response.status(403).json({ error: "actor_mismatch" });
      return;
    }
    if (!dependencies.executor.readiness().ready) {
      response.status(503).json({ error: "executor_not_ready" });
      return;
    }

    const result = dependencies.registry.reserve(parsed.data);
    if (result.type === "conflict") {
      response.status(409).json({ error: "run_id_conflict", runId: parsed.data.runId });
      return;
    }
    if (result.type === "thread_busy") {
      response.status(409).json({ error: "thread_busy", runId: parsed.data.runId });
      return;
    }
    if (result.type === "capacity") {
      response.setHeader("Retry-After", "1");
      response.status(429).json({ error: "capacity_full", runId: parsed.data.runId });
      return;
    }
    if (!("state" in result)) {
      response.status(500).json({ error: "invalid_registry_result" });
      return;
    }

    const shouldStart = result.state === "reserved";
    if (shouldStart) {
      response.once("finish", () => dependencies.registry.start(parsed.data.runId));
    }
    response.status(202).json({
      runId: parsed.data.runId,
      status: result.state === "reserved" ? "accepted" : result.state,
      duplicate: result.type === "duplicate",
    });
  });

  app.post("/runs/:runId/cancel", authenticate, json, (request, response) => {
    const params = cancelParamsSchema.safeParse(request.params);
    const body = cancelBodySchema.safeParse(request.body);
    if (!params.success || !body.success || body.data.runId !== params.data.runId) {
      response.status(400).json({ error: "invalid_cancellation_request" });
      return;
    }
    if (!isBoundActor(dependencies.boundActorId, body.data.actorId)) {
      response.status(403).json({ error: "actor_mismatch" });
      return;
    }
    const result = dependencies.registry.cancel(params.data.runId, body.data.actorId);
    if (result === "not_found") {
      response.status(404).json({ error: "run_not_found", runId: params.data.runId });
      return;
    }
    response.status(result === "terminal" ? 200 : 202).json({
      runId: params.data.runId,
      status: result,
    });
  });

  app.post("/connections/robinhood/start", authenticate, json, async (request, response) => {
    if (!dependencies.broker) {
      response.status(503).json({ error: "broker_not_ready" });
      return;
    }
    const parsed = actorBodySchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_actor_id" });
      return;
    }
    if (!isBoundActor(dependencies.boundActorId, parsed.data.actorId)) {
      response.status(403).json({ error: "actor_mismatch" });
      return;
    }
    try {
      response.json(await dependencies.broker.startConnection(parsed.data.actorId));
    } catch {
      response.status(502).json({ error: "robinhood_connection_start_failed" });
    }
  });

  app.post("/connections/robinhood/complete", authenticate, json, async (request, response) => {
    if (!dependencies.broker) {
      response.status(503).json({ error: "broker_not_ready" });
      return;
    }
    const parsed = robinhoodCompleteSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_robinhood_callback" });
      return;
    }
    if (!isBoundActor(dependencies.boundActorId, parsed.data.actorId)) {
      response.status(403).json({ error: "actor_mismatch" });
      return;
    }
    try {
      response.json(await dependencies.broker.completeConnection(parsed.data.actorId, parsed.data.code, parsed.data.state));
    } catch {
      response.status(400).json({ error: "robinhood_connection_complete_failed" });
    }
  });

  app.post("/connections/robinhood/status", authenticate, json, async (request, response) => {
    if (!dependencies.broker) {
      response.status(503).json({ error: "broker_not_ready" });
      return;
    }
    const parsed = actorBodySchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_actor_id" });
      return;
    }
    if (!isBoundActor(dependencies.boundActorId, parsed.data.actorId)) {
      response.status(403).json({ error: "actor_mismatch" });
      return;
    }
    try {
      response.json(await dependencies.broker.connectionStatus(parsed.data.actorId));
    } catch {
      response.status(502).json({ error: "robinhood_connection_status_failed" });
    }
  });

  app.post("/connections/robinhood/disconnect", authenticate, json, async (request, response) => {
    if (!dependencies.broker) {
      response.status(503).json({ error: "broker_not_ready" });
      return;
    }
    const parsed = actorBodySchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_actor_id" });
      return;
    }
    if (!isBoundActor(dependencies.boundActorId, parsed.data.actorId)) {
      response.status(403).json({ error: "actor_mismatch" });
      return;
    }
    try {
      response.json(await dependencies.broker.disconnect(parsed.data.actorId));
    } catch {
      response.status(502).json({ error: "robinhood_disconnect_failed" });
    }
  });

  app.post("/portfolio/refresh", authenticate, json, async (request, response) => {
    if (!dependencies.broker) {
      response.status(503).json({ error: "broker_not_ready" });
      return;
    }
    const parsed = actorBodySchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_actor_id" });
      return;
    }
    if (!isBoundActor(dependencies.boundActorId, parsed.data.actorId)) {
      response.status(403).json({ error: "actor_mismatch" });
      return;
    }
    try {
      response.json(await dependencies.broker.refreshPortfolio(parsed.data.actorId));
    } catch {
      response.status(502).json({ error: "portfolio_refresh_failed" });
    }
  });

  app.post("/orders/execute", authenticate, json, async (request, response) => {
    if (!dependencies.broker) {
      response.status(503).json({ error: "broker_not_ready" });
      return;
    }
    const parsed = orderExecutionSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_order_execution" });
      return;
    }
    if (!isBoundActor(dependencies.boundActorId, parsed.data.actorId)) {
      response.status(403).json({ error: "actor_mismatch" });
      return;
    }
    try {
      response.json(await dependencies.broker.executeOrder(parsed.data.actorId, parsed.data.proposalId, parsed.data.fingerprint));
    } catch {
      response.status(200).json({ status: "failed", errorCode: "order_execution_failed" });
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: "not_found" });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof SyntaxError) {
      response.status(400).json({ error: "invalid_json" });
      return;
    }
    response.status(500).json({ error: "internal_error" });
  };
  app.use(errorHandler);

  return app;
}
