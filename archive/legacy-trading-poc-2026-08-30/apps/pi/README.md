# Signal Pi service

This private service runs the phone-first trading assistant. Convex calls it
over the service shared secret. The browser never calls Pi directly.

## Contracts

- `GET /health` reports Signal and broker readiness.
- `POST /runs` keeps the existing asynchronous execution contract.
- `POST /runs/:runId/cancel` accepts `{ "commandId": "...", "runId": "...", "actorId": "..." }`. The body `runId` must match the path.
- `POST /connections/robinhood/start` accepts `{ "actorId": "..." }`.
- `POST /connections/robinhood/complete` accepts `{ "actorId": "...", "code": "...", "state": "..." }`.
- `POST /connections/robinhood/status` and `/disconnect` accept `{ "actorId": "..." }`.
- `POST /portfolio/refresh` accepts `{ "actorId": "..." }`.
- `POST /orders/execute` accepts `{ "actorId": "...", "proposalId": "...", "fingerprint": "..." }`.

Every POST route requires `Authorization: Bearer <SERVICE_SHARED_SECRET>`.
In production, every actor-bearing request must match `BOUND_ACTOR_ID`. A
runtime rejects a different actor before it starts, cancels, reads brokerage
data, changes a connection, creates a proposal, or submits an order.
The service exposes only application trading tools. It does not expose a
generic MCP proxy and never returns credentials or OAuth tokens.

## Codex authentication

Pi uses the `openai-codex` provider and the model in `PI_MODEL`. The default is
`gpt-5.6-terra`. Authentication is read and written only at `PI_AUTH_PATH`.
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

The complete Railway device-bootstrap sequence is in
[`infra/railway/README.md`](../../infra/railway/README.md#codex-device-bootstrap).

## Required variables

| Variable | Purpose |
| --- | --- |
| `SERVICE_SHARED_SECRET` | Internal service credential. Use at least 32 characters. |
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
