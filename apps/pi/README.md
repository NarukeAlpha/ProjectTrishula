# Project Trishula Pi service

This private service runs Project Trishula's chat and Discord agents. Convex
calls the existing service routes with its service secret. The Discord gateway
uses a separate agent-only secret. The browser never calls Pi directly.

## Contracts

- `GET /health` reports Pi and Discord-agent readiness.
- `POST /runs` keeps the existing asynchronous execution contract.
- `POST /discord/agents/jobs` validates and starts one isolated Discord agent job without holding the HTTP connection open.
- `GET /discord/agents/jobs/:jobId` returns the job status and its strict result after completion.
- `DELETE /discord/agents/jobs/:jobId` cancels a running job.
- `POST /discord/agents/run` keeps the earlier synchronous contract for rolling deployment compatibility.
- `POST /runs/:runId/cancel` accepts `{ "commandId": "...", "runId": "...", "actorId": "..." }`. The body `runId` must match the path.
- `POST /connections/robinhood/start` accepts `{ "actorId": "..." }`.
- `POST /connections/robinhood/complete` accepts `{ "actorId": "...", "code": "...", "state": "..." }`.
- `POST /connections/robinhood/status` and `/disconnect` accept `{ "actorId": "..." }`.
- `POST /portfolio/refresh` accepts `{ "actorId": "..." }`.
- `POST /orders/execute` accepts `{ "actorId": "...", "proposalId": "...", "fingerprint": "..." }`.

All `/discord/agents/*` routes require
`Authorization: Bearer <PI_DISCORD_SHARED_SECRET>`. Other POST routes require
`Authorization: Bearer <SERVICE_SHARED_SECRET>`. The two secrets must differ.
In production, every actor-bearing request must match `BOUND_ACTOR_ID`. A
runtime rejects a different actor before it starts, cancels, reads brokerage
data, changes a connection, creates a proposal, or submits an order.
The service exposes only application trading tools. It does not expose a
generic MCP proxy and never returns credentials or OAuth tokens.

## Discord agent profiles

The Discord gateway submits `POST /discord/agents/jobs` with one of four
profiles. Shared Zod request and response contracts are in
`src/discord/contracts.ts`.

| Profile | Model | Reasoning | Tools |
| --- | --- | --- | --- |
| `triage` | `gpt-5.6-luna` | `xhigh` | None |
| `acknowledge` | `gpt-5.6-luna` | `xhigh` | None |
| `research` | `gpt-5.6-sol` | `xhigh` | Public web search, public HTTPS fetch, and public market data |
| `reply` | `gpt-5.6-luna` | `xhigh` | None |

Each job creates a new in-memory session and disposes it after the agent exits.
The job registry uses `requestId` as its idempotency key. A reused ID with
different validated input returns a conflict. Completed and failed jobs expire
after 15 minutes. The registry accepts at most eight active jobs and 256 live
or retained jobs. It stops any job that runs longer than nine minutes.
Shutdown stops intake, aborts running jobs, and waits for their session cleanup.
No Discord profile can use the brokerage, order, shell, filesystem, or code
execution tools. Research results include exact source URLs, fetch freshness,
findings, and uncertainty. The service rejects source URLs that were not
returned by a research tool.

The public page tool accepts HTTPS only. It resolves DNS before the request,
rejects private or special-use addresses, pins the approved public address for
the connection, checks every redirect, and limits redirects, bytes, and time.
Search works without an API key. Public market data is read-only.

The reply profile returns at most 1,200 characters. Its prompt applies the
project's humanizer rules: plain wording, no chatbot filler, no inflated
claims, no forced groups of three, no em dashes, no emojis, and no canned
conclusion. A reply can request a fresh review only for a new factual question
or meaningful contraposition. Pi stops recursive rechecks after two passes.

The acknowledgement profile returns one natural sentence of at most 320
characters. It confirms that the question was picked up and says what will be
checked next. It does not answer the question, promise a timeframe, or use
filler, praise, em dashes, or emojis.

## Codex authentication

Pi uses the `openai-codex` provider. The existing `/runs` path uses the model
in `PI_MODEL`, which defaults to `gpt-5.6-terra`. Discord uses the fixed models
listed above. All four profiles share one model runtime. Authentication is read
and written only at `PI_AUTH_PATH`.
Mount the Railway volume at `/data` and run:

```sh
npm run build
npm run auth:codex
```

For a headless device-code flow, set `CODEX_AUTH_MODE=device_code`. This
command does not read or copy `~/.codex/auth.json`.

The container starts through `dist/start.js`. When the auth file is absent, it
runs a degraded health server and waits. Open a Railway SSH shell to the private
Pi service. Run `npm run auth:codex` as the `node` user with
`CODEX_AUTH_MODE=device_code`. Complete the one-time browser step. The process
writes the OAuth record directly to `/data/auth.json`; do not copy its contents
into Railway variables, source files, chat, or log exports. The waiting service
then starts without another deployment. It fails closed while the file is
missing.

## Required variables

| Variable | Purpose |
| --- | --- |
| `SERVICE_SHARED_SECRET` | Internal service credential. Use at least 32 characters. |
| `PI_DISCORD_SHARED_SECRET` | Agent-only credential for the Discord gateway. It must differ from the service secret. |
| `CONVEX_SITE_URL` | Full Convex HTTP Actions prefix. It must end in `/http`. |
| `BOUND_ACTOR_ID` | Exact WorkOS subject served by this runtime. Required in production. |

## Runtime variables

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
| `PI_AUTH_BOOTSTRAP` | `false` |
| `PI_MODEL` | `gpt-5.6-terra` |
| `BROKER_MODE` | `mock` |
| `PI_CREDENTIAL_KEY_VERSION` | `1` |
| `ROBINHOOD_OAUTH_REDIRECT_URI` | `${CONVEX_SITE_URL}/broker/robinhood/callback` |
| `ROBINHOOD_OAUTH_CLIENT_ID` | unset; MCP dynamic registration is used when supported |
| `LIVE_TRADING_ENABLED` | `false` |

`PI_CREDENTIAL_ENCRYPTION_KEY` is required when `BROKER_MODE=robinhood`. Use an
independent 32-character-or-longer secret. The service never falls back to
`SERVICE_SHARED_SECRET` for credential encryption.

Pi encrypts each Robinhood connection with AES-256-GCM. Its authenticated
additional data binds schema version, actor, provider, and key version. Pi
sends only the encrypted envelope to these private Convex service routes:

- `POST /service/broker-credentials/get`
- `POST /service/broker-credentials/put`
- `POST /service/broker-credentials/delete`

The version 1 envelope contains `actorId`, provider `robinhood`, `keyVersion`,
algorithm `A256GCM`, IV, ciphertext, and authentication tag. The credential
vault routes do not receive Robinhood access tokens, refresh tokens, PKCE
verifiers, authorization URLs, or OAuth codes in plaintext. Writes and deletes use a revision. Pi
serializes credential operations and performs one fresh-read retry after a
revision conflict.

Codex authentication remains separate at `/data/auth.json`. The Robinhood
credential store does not read, modify, or copy that file.

`BROKER_MODE=mock` returns deterministic test data. Set `BROKER_MODE=robinhood`
only after the official Robinhood MCP OAuth flow is configured. Live order
submission remains disabled until `LIVE_TRADING_ENABLED=true` and the live
mutation capability is explicitly implemented and verified.

Production requires an HTTPS callback on the `CONVEX_SITE_URL` origin with the
exact `/http/broker/robinhood/callback` path. The public Convex callback maps
the returned state to a trusted actor and calls Pi over the private service
boundary. Pi keeps its own twenty-minute, single-use OAuth transaction. It
binds the state and PKCE verifier to the expected issuer, MCP resource, and
redirect URI. Register that exact URI with Robinhood.

## Commands

```sh
npm ci
npm run auth:codex
npm run typecheck
npm test
npm run build
```
