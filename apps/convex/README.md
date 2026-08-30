# Project Trishula Convex application

This package is Project Trishula's state plane. It owns authenticated browser
state, chat, Discord channel assignments, Discord message windows, loop leases,
and outbox delivery state. The preserved trading POC functions remain available
to the existing chat runtime, but the current Discord pipeline does not call
brokerage or order functions. This package deploys to the self-hosted Convex
backend, not to the browser or private Pi service.

## Public functions

Chat and run functions:

- `threads:list`, `threads:get`, `threads:rename`, `threads:archive`
- `messages:listPage`
- `runs:getActive`
- `commands:get`, `commands:submitPrompt`, `commands:retryRun`, and
  `commands:requestStop`

Trading functions:

- `trading:getDashboard`
- `trading:startRobinhoodConnection`
- `trading:disconnectRobinhood`
- `trading:refreshPortfolio`
- `trading:approveProposal`
- `trading:rejectProposal`

Discord control functions:

- `discord:getControlPlane`
- `discord:setChannelRoles`

The Discord control plane lists the connected gateway, discovered guilds and
channels, bot permissions, channel roles, and current loop state. Channel
roles are `conversation_monitor`, `reply_target`, and `research_log`. Public
queries and mutations use the same WorkOS actor boundary as chat and trading.

Every public function derives the actor from the validated WorkOS subject. The
actor owns the queried records and is the only actor allowed to approve or
reject that actor's proposal. The browser never receives Robinhood credentials
or the Pi service secret.

## WorkOS configuration

Convex validates WorkOS custom JWTs with `WORKOS_CLIENT_ID`. Restrict this
private proof of concept with a comma-separated allowlist:

```text
WORKOS_CLIENT_ID=client_<workos-client-id>
WORKOS_ALLOWED_USER_IDS=user_<first-user>,user_<second-user>
```

`WORKOS_ALLOWED_USER_IDS` is the only supported allowlist variable. Each value
must be a WorkOS user subject. A subject that is not in this list is rejected
before any public function reads or writes data. Provision one actor-bound
Railway Pi runtime for each value.

## Private service routes

Pi calls these Convex HTTP Actions with
`Authorization: Bearer $SERVICE_SHARED_SECRET`:

- `POST /service/run-results`
- `POST /service/run-heartbeats`
- `POST /service/trade-proposals`
- `POST /service/broker-credentials/get`
- `POST /service/broker-credentials/put`
- `POST /service/broker-credentials/delete`

The Discord gateway calls `POST /http/discord` on the self-hosted public URL
with `Authorization: Bearer $DISCORD_GATEWAY_SHARED_SECRET`. The dedicated
secret cannot authorize broker credentials, trade proposals, or Pi run routes.

The Discord gateway uses one service-authenticated JSON endpoint. Each request
has an `operation` discriminator. Supported operations are `syncGuilds`,
`ingestMessage`, `claimLoop`, `newestContext`, `completeLoop`, `heartbeat`,
`listRunnable`, `enqueueReply`, and `acknowledgeReply`. The exact TypeScript and
Zod request contract is exported from
`convex/lib/discord_contract.ts`. Every response is JSON and has either
`{ok:true,operation,result}` or `{ok:false,operation?,error}`.
The request `actorId` must also be present in `WORKOS_ALLOWED_USER_IDS`; the
dedicated gateway credential cannot create state for an unknown WorkOS actor.

Convex assigns a monotonic sequence to each monitored-channel message and
deduplicates Discord message IDs. A channel has one fenced lease at a time.
Each claim advances its generation and processes at most 10 ordered messages.
A 25-message backlog therefore runs as `1-10`, `11-20`, and `21-25`. New
messages that arrive during a run only advance the pending watermark. They do
not start another concurrent run. `newestContext` always returns the newest 10
messages in ascending order.

Bot messages are stored as context but do not start a loop. An agent can ask
for an autonomous recheck after its reply appears in the context. Convex caps
that path at two rechecks and rejects an unchanged context hash. Replies use an
idempotent outbox. A sent acknowledgement also records the bot reply in the
channel context, so a delayed Discord event does not lose the reply.

The broker credential routes use schema version `1`. A GET body is
`{schemaVersion:1,actorId,provider:"robinhood"}` and returns
`{schemaVersion:1,credential:<opaque-envelope>|null,revision:number}`. A PUT
body is
`{schemaVersion:1,actorId,provider:"robinhood",expectedRevision:number,credential:<opaque-envelope>}`
and returns `{schemaVersion:1,stored:true,revision:number}`. A DELETE body is
`{schemaVersion:1,actorId,provider:"robinhood",expectedRevision:number}` and
returns `{schemaVersion:1,deleted:boolean,revision:number}`. A stale expected
revision returns `409`. The service secret is required for all three routes.
The routes never accept or return plaintext broker tokens.

The Robinhood provider redirects to the public Convex URL. The HTTP Action is
registered at `/broker/robinhood/callback`, so the self-hosted public path is:

- `GET /http/broker/robinhood/callback`

The result route parses the complete event and final-message contract before it
checks the canonical SHA-256 payload hash. It accepts only contiguous result
batches. A terminal batch materializes the canonical assistant message in the
same transaction.

The Convex-to-Pi boundary uses:

```text
EXECUTION_PRIVATE_DOMAIN_SUFFIX=railway.internal:8080
SERVICE_SHARED_SECRET=<shared-server-to-server-secret>
WEB_APP_ORIGIN=https://trishula.example.com
```

Keep `SERVICE_SHARED_SECRET` and `DISCORD_GATEWAY_SHARED_SECRET` out of browser
variables, source files, logs, and Convex records. Convex derives the private Pi service name from the trusted
actor ID as `pi-u-${sha256(actorId).slice(0,20)}` and appends the configured
private-domain suffix. There is no singleton Pi execution URL.

Railway service variables and Convex function variables are separate stores.
The `convex-functions` Railway service derives a short-lived admin key and
copies only the allowlisted WorkOS and service variables into the Convex
function environment. It withholds detailed deploy output so credentials do
not enter build logs.

The callback route accepts the provider's `code` and `state`, hashes and
atomically consumes the state mapping, sends the exchange to the actor's Pi
service, and returns a `303` redirect to
`${WEB_APP_ORIGIN}/broker/connected` or `${WEB_APP_ORIGIN}/broker/failed`. It
never places `code` or `state` in the redirect URL.
The public callback is the only OAuth completion path. Browser functions do not
accept or exchange a Robinhood `code` or `state`.

## Trading safety boundary

Convex records broker connection metadata and an opaque encrypted Robinhood
credential envelope. The actor-bound Pi encrypts the record with AES-256-GCM
and its independent runtime key before it calls the service routes. Convex
never decrypts or receives plaintext tokens. Internal vault writes and deletes
use an expected revision. Vault audit events record provider, operation,
revision, key version, algorithm, and presence metadata, never ciphertext.

A proposal binds its actor, order details, review reference, fingerprint,
idempotency key, and expiry. Approval requires the exact fingerprint and an
unexpired `awaiting_confirmation` proposal. This package does not silently
approve or retry changed order details.

## Local validation

```sh
npm install
npm run typecheck
npm test
```

Run `npm run convex:codegen` only against the intended self-hosted deployment
when the schema or function surface changes. Do not run a live Convex deploy as
part of local validation.
