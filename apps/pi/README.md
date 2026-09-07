# Project Trishula Pi service

This private service runs Project Trishula's web-chat and Discord agents. Convex calls the web-chat routes with its service secret. The Discord gateway uses a separate Discord-only secret. The browser never calls Pi directly.

## Contracts

- `GET /health` reports Pi and Discord-agent readiness.
- `POST /runs` keeps the existing asynchronous web-chat execution contract.
- `POST /discord/agents/jobs` validates and starts an idempotent Discord agent job without holding the HTTP connection open.
- `GET /discord/agents/jobs/:jobId` returns the strict terminal result.
- `DELETE /discord/agents/jobs/:jobId` cancels a running job.
- `POST /discord/agents/run` keeps the synchronous contract for rolling deployment compatibility.
- `POST /market-research/jobs` accepts one actor-bound, fenced newspaper job and starts it asynchronously.
- `GET /market-research/jobs/:jobId` returns only the bounded newspaper job status.
- `DELETE /market-research/jobs/:jobId` cancels a running newspaper job in this Pi process.
- `POST /runs/:runId/cancel` accepts `{ "commandId": "...", "runId": "...", "actorId": "..." }`. The body `runId` must match the path.
- `POST /connections/robinhood/start` accepts `{ "actorId": "..." }`.
- `POST /connections/robinhood/complete` accepts `{ "actorId": "...", "code": "...", "state": "..." }`.
- `POST /connections/robinhood/status` and `/disconnect` accept `{ "actorId": "..." }`.
- `POST /portfolio/refresh` accepts `{ "actorId": "..." }`.
- `POST /orders/execute` accepts `{ "actorId": "...", "proposalId": "...", "fingerprint": "..." }`.

All `/discord/agents/*` routes require `Authorization: Bearer <PI_DISCORD_SHARED_SECRET>`. Other POST routes require `Authorization: Bearer <SERVICE_SHARED_SECRET>`. The two secrets must differ. In production, every actor-bearing request must match `BOUND_ACTOR_ID`.

Discord exposes public-research tools only. It cannot use the brokerage, credential-vault, order, shell, process, code-execution, filesystem, or private-network tools. Web chat keeps a separate capability profile and separate conversation history.

The `/market-research/jobs` routes use `SERVICE_SHARED_SECRET`, not the Discord agent secret. They have a dedicated registry and do not call a Discord conversation profile. The runner creates one isolated tool-free composer session and does not import, construct, or receive a trading broker.

The feature is disabled by default. Pi requires `EXA_API_KEY` only when `MARKET_RESEARCH_ENABLED=true`. Health reports only the feature flag, `exaConfigured` boolean, and runner readiness. It never returns the key, provider authorization, prompts, evidence bodies, or edition text.

## Durable Discord profiles

The durable gateway path submits these profiles. Shared Zod request and response contracts are in `src/discord/contracts.ts`.

| Profile | Role | Locked provider tuple | Tools |
| --- | --- | --- | --- |
| `frontman_plan` | Plan a direct reply, clarification, silence, or research | `gpt-5.6-luna` / `xhigh` / `priority` | None |
| `research` | Produce a bounded public evidence packet | `gpt-5.6-sol` / `max` / `priority` | Public web search, public HTTPS fetch, public market data, and trusted chart request |
| `frontman_resume` | Reconcile newest context and send, suppress, or recheck | `gpt-5.6-luna` / `xhigh` / `priority` | None |
| `portable_checkpoint` | Build an isolated, source-bound replacement summary | `gpt-5.6-luna` / `xhigh` / `priority` | None |

The pinned Pi `0.84.1` Codex catalog maps Sol `max` to the provider value `max`. A 2026-09-07 OAuth smoke test accepted `max` and rejected the unsupported literal `ultra`. Startup validates the 272,000-token catalog window and the reasoning maps before it marks Discord agents ready.

Each Discord guild owns one durable logical Luna conversation. Convex supplies its trusted owner binding, `conversationId`, epoch, revision, policy hashes, portable summary when available, and recent canonical tail. Pi can reuse one compatible hot Luna `AgentSession` across jobs and turns. The session is only a cache. Disabling hot reuse, restarting Pi, or evicting an idle session reconstructs the same logical conversation from Convex.

Luna uses one identity and voice for planning, direct answers, acknowledgments, and researched answers. The plan and resume stages do not create separate visible personalities or separate conversation histories. After a researched turn, Pi rebases or rebuilds hot context from canonical sent-only history so internal plan JSON and evidence packets do not accumulate.

Sol gets one fresh isolated session for each research request. It receives the normalized request and limited public context. It returns a validated packet with a 2,500 estimated-token target and a hard 16,384-byte transport limit. Pi pins the estimator to `js-tiktoken@1.0.21`, `o200k_base`, and the versioned `gpt-5.6-sol` estimate mapping. Sol's transcript, hidden reasoning, invalid output, and repair prompt do not enter Luna history.

The job registry uses `requestId` as its idempotency key. A reused ID with different validated input returns a conflict. Completed and failed jobs expire after 15 minutes. The registry accepts at most eight active jobs and 256 live or retained jobs. It stops a job that runs longer than nine minutes. Shutdown stops intake, aborts running jobs, and waits for session cleanup.

The public-page tool accepts HTTPS only. It resolves DNS before a request, rejects private or special-use addresses, pins the approved public address, checks each redirect, and limits redirects, bytes, and time. Exact source URLs must come from a trusted research tool. The chart tool returns only a trusted artifact request; model-authored image paths are rejected.

## Discord output and recovery rules

- Final and clarifying replies use at most 2,000 Unicode code points.
- Research acknowledgments use at most 320 Unicode code points.
- Validation normalizes content before counting. Oversize output gets one bounded repair and then fails closed.
- Pi never silently slices a draft, URL, number, or qualification.
- Explicit plan, schema, research, or resume failure must reach a plain failure closure through the durable gateway when the active fence still permits delivery.
- Ambient failures stay silent.
- Only Discord-confirmed assistant messages become canonical conversation history.

Convex persists plan, research, resume, and outbox state. A gateway restart skips any completed stage. A Discord send uses a stable nonce and payload hash. An uncertain send remains fenced until Gateway or bounded history reconciliation proves the Discord message ID. It is not blindly resent after the nonce-deduplication window.

## Continuity and compaction switches

| Variable | Default | Effect |
| --- | --- | --- |
| `TRISHULA_DURABLE_CONVERSATIONS_ENABLED` | `true` | Accept durable Discord request contracts. Keep this aligned with the gateway rollout switch. |
| `TRISHULA_HOT_SESSION_REUSE_ENABLED` | `true` | Reuse compatible in-memory Luna sessions. `false` keeps durable Convex continuity and forces cold reconstruction. |
| `TRISHULA_HOT_SESSION_IDLE_MS` | `3600000` | Evict an idle hot Luna cache after one hour by default. |
| `TRISHULA_NATIVE_COMPACTION_ENABLED` | `false` | Enables the first-party opaque adapter only with portable checkpoints and the exact reviewed live-probe attestation. |
| `TRISHULA_NATIVE_COMPACTION_LIVE_PROBE_ATTESTATION` | unset | Must match the adapter's reviewed live-probe version before native compaction can start. |
| `TRISHULA_PORTABLE_CHECKPOINTS_ENABLED` | `false` | Enables the isolated portable checkpoint profile when set to `true`. Keep Pi and gateway values aligned. |

The first-party native adapter uses the pinned Pi `0.84.1` public payload, header, and fetch hooks with the reviewed Codex remote-compaction SSE route. It never reads Pi private session fields. It accepts exactly one bounded opaque compaction item, stores no prompt or artifact in normal logs, and keeps the portable summary as the fallback. It fences the full active source lineage and requests durable invalidation when the provider rejects an artifact. Native activation remains off until the isolated OAuth probe proves same-process and fresh-runtime continuation and records its attestation. The portable path triggers at 190,400 estimated tokens, keeps a contiguous 20,000-token recent tail, and uses bounded candidate stages for large backlogs before final activation. Stored checkpoint protection is labeled `platform_default_unverified`.

Before the first checkpoint, restart continuity comes from canonical Convex history up to the 190,400-token compaction threshold. After activation, it comes from the portable summary plus a contiguous 20,000-token raw tail. It does not depend on a process-local JSONL file or Railway volume.

## Codex authentication

Pi uses the `openai-codex` provider. The existing web-chat `/runs` path uses `PI_MODEL`, which defaults to `gpt-5.6-terra`. Discord uses the locked tuples above. Authentication is read and written only at `PI_AUTH_PATH`.

Mount the Railway volume at `/data` and run:

```sh
npm run build
npm run auth:codex
```

For a headless device-code flow, set `CODEX_AUTH_MODE=device_code`. The command does not read or copy `~/.codex/auth.json`.

The container starts through `dist/start.js`. When the auth file is absent, it runs a degraded health server and waits. Open a Railway SSH shell to the private Pi service. Run `npm run auth:codex` as the `node` user with `CODEX_AUTH_MODE=device_code`. Complete the browser step. The process writes the OAuth record to `/data/auth.json`. Do not copy its contents into Railway variables, source files, chat, or log exports.

## Required variables

| Variable | Purpose |
| --- | --- |
| `SERVICE_SHARED_SECRET` | Internal web-chat service credential. Use at least 32 characters. |
| `PI_DISCORD_SHARED_SECRET` | Discord-only credential. It must differ from the service secret. |
| `CONVEX_SITE_URL` | Exact Convex HTTP Actions prefix ending in `/http`. |
| `BOUND_ACTOR_ID` | Exact WorkOS subject served by this runtime. Required in production. |
| `EXA_API_KEY` | Pi-only Exa credential. Required only when morning research is enabled. |

## Trishula profile variables

These keys are parsed and tested. Literal profile values provide deployment visibility. They are not arbitrary model overrides.

| Variable | Accepted/default value |
| --- | --- |
| `TRISHULA_LUNA_MODEL` | `gpt-5.6-luna` |
| `TRISHULA_LUNA_REASONING_EFFORT` | `xhigh` |
| `TRISHULA_LUNA_SERVICE_TIER` | `priority` |
| `TRISHULA_LUNA_PROFILE_VERSION` | `luna-frontman-v1` |
| `TRISHULA_LUNA_MAX_OUTPUT_TOKENS` | `8000` |
| `TRISHULA_SOL_MODEL` | `gpt-5.6-sol` |
| `TRISHULA_SOL_REASONING_EFFORT` | `max` |
| `TRISHULA_SOL_SERVICE_TIER` | `priority` |
| `TRISHULA_SOL_PROFILE_VERSION` | `sol-research-v1` |
| `TRISHULA_SOL_MAX_OUTPUT_TOKENS` | `16000` |
| `TRISHULA_PERSONALITY_VERSION` | `trishula-discord-v1` |
| `TRISHULA_MODEL_CONTEXT_WINDOW` | `272000` only |
| `TRISHULA_RESEARCH_PACKET_TOKEN_TARGET` | `2500` |
| `TRISHULA_RESEARCH_PACKET_MAX_BYTES` | `16384` only |
| `TRISHULA_RECENT_TAIL_TOKEN_BUDGET` | `20000` only |
| `TRISHULA_MAX_AUTONOMOUS_RECHECKS` | `2` only |
| `TRISHULA_AMBIENT_MIN_CONFIDENCE` | `0.85` |
| `TRISHULA_AMBIENT_MIN_ADDITIVE_VALUE` | `0.9` |

## Other runtime variables

| Variable | Default |
| --- | --- |
| `PORT` | `8080` |
| `HOST` | `0.0.0.0` |
| `GLOBAL_CONCURRENCY` | `4` |
| `RESULT_BATCH_WINDOW_MS` | `25` |
| `RESULT_BATCH_BYTES` | `16384` |
| `CONVEX_REQUEST_TIMEOUT_MS` | `10000` |
| `CONVEX_RETRY_ATTEMPTS` | `4` |
| `SHUTDOWN_TIMEOUT_MS` | `25000` |
| `PI_AUTH_PATH` | `/data/auth.json` |
| `PI_AUTH_BOOTSTRAP` | `false`; read by the container start wrapper |
| `PI_MODEL` | `gpt-5.6-terra` |
| `BROKER_MODE` | `mock` |
| `PI_CREDENTIAL_KEY_VERSION` | `1` |
| `ROBINHOOD_OAUTH_REDIRECT_URI` | `${CONVEX_SITE_URL}/broker/robinhood/callback` |
| `ROBINHOOD_OAUTH_CLIENT_ID` | unset; MCP dynamic registration is used when supported |
| `LIVE_TRADING_ENABLED` | `false` |
| `MARKET_RESEARCH_ENABLED` | `false` |
| `PI_MARKET_RESEARCH_MODEL` | `gpt-5.6-sol` |
| `EXA_SEARCH_CONCURRENCY` | `2` |
| `EXA_CONTENTS_CONCURRENCY` | `5` |
| `EXA_REQUEST_TIMEOUT_MS` | `20000` |
| `EXA_MAX_SEARCH_REQUESTS_PER_EDITION` | `12` |
| `EXA_MAX_CONTENT_PAGES_PER_EDITION` | `24` |
| `EXA_MAX_COST_USD_PER_EDITION` | unset; set a reviewed cost ceiling before enablement |

`PI_CREDENTIAL_ENCRYPTION_KEY` is required when `BROKER_MODE=robinhood`. Use an independent secret with at least 32 characters. The service never falls back to `SERVICE_SHARED_SECRET` for credential encryption.

Pi encrypts each Robinhood connection with AES-256-GCM. Its authenticated additional data binds schema version, actor, provider, and key version. This broker credential protection is separate from Discord portable checkpoint storage.

Codex authentication remains separate at `/data/auth.json`. The Robinhood credential store does not read, modify, or copy that file.

`BROKER_MODE=mock` returns deterministic test data. Set `BROKER_MODE=robinhood` only after the official Robinhood MCP OAuth flow is configured. Live order submission remains disabled until `LIVE_TRADING_ENABLED=true` and the live mutation capability is explicitly implemented and verified.

Production requires an HTTPS callback on the `CONVEX_SITE_URL` origin with the exact `/http/broker/robinhood/callback` path. Register that exact URI with Robinhood.

## Commands

```sh
npm ci
npm run auth:codex
npm run typecheck
npm test
npm run build
```
