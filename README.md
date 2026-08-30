# Phone Trading POC

This repository now targets a phone-first agentic trading application.

[`POC/`](POC/README.md) preserves the prior proof-of-concept snapshot that was
still present on disk when this direction started. It does not restore files
that earlier work had already deleted, including the prior Swift package and a
shared frontend fixture. The snapshot remains reference material. It is not
part of the new application gate.

## Current status

The new root contains the mobile application, Convex state layer, isolated Pi
execution runtimes, Railway deployment files, and repository quality gates.
Local development and browser tests can use the deterministic mock broker. The
Railway path uses WorkOS, Convex, one private Pi runtime per approved user, and
the fixed official Robinhood MCP boundary. Live order placement remains
disabled.

## Application modules

| Module | Railway role | Responsibility |
| --- | --- | --- |
| [`apps/web`](apps/web/README.md) | Public `web` service | Phone UI, WorkOS sign-in, and explicit trade approval |
| [`apps/convex`](apps/convex/README.md) | Convex deployment | Canonical users, conversations, runs, approvals, and audit state |
| [`apps/pi`](apps/pi/README.md) | Private Pi service per user | Pi sessions, tool execution, Codex OAuth, and the user-scoped Robinhood MCP bridge |

These are three application modules. A self-hosted Convex deployment also needs supporting Railway resources such as its backend, dashboard, Postgres database, and artifact storage.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the trust boundaries and trade-approval contract.

## Per-user isolation

Convex accepts only the WorkOS subjects in `WORKOS_ALLOWED_USER_IDS`. For each
approved subject, Convex derives the private Railway endpoint
`pi-u-${sha256(actorId).slice(0,20)}.railway.internal:8080`. The corresponding
Railway service binds to that exact actor. It rejects requests for any other
actor.

Each user gets one private Pi service and one unique volume mounted at `/data`.
Do not add a public domain or replicas to a Pi runtime. The volume stores only
that runtime's Codex subscription OAuth file at `/data/auth.json`. Pi encrypts
Robinhood OAuth records with its independent AES-256-GCM key. Convex stores
only the opaque encrypted envelope and its revision.

Robinhood redirects to the public Convex callback at
`/http/broker/robinhood/callback`. Convex consumes the one-time state and then
redirects to the web application's connected or failed page without `code` or
`state`. The phone browser never receives a Robinhood token, Pi service secret,
or Convex admin key.

## Local phone demo

The demo does not need WorkOS, Convex, Pi, or brokerage credentials. It cannot
send an order or make a broker network request.

```sh
cd apps/web
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/` and use a phone-size viewport.

## Quality gate

Anti-Slop is vendored under `tools/oxlint/anti-slop`. Oxlint and its plugin runtime are pinned to the same version.

```sh
npm install
npm ci --prefix apps/convex
npm ci --prefix apps/pi
npm ci --prefix apps/web
npm run check
```

The root gate runs Anti-Slop Oxlint, Convex type checks and tests, Pi type
checks, tests, and build, the web formatter, ESLint, type checks, tests and
build, the browser bundle boundary check, and Railway configuration checks.

## Railway

The isolated Railway project is named `signal-trading-poc`. Use the guarded
scripts in [`scripts/railway`](scripts/railway/README.md). They hard-deny the
known OTA production project name and ID. Bootstrap creates the shared
services. Run `provision-user-runtime.sh` once for each approved WorkOS subject,
then complete the Codex device login for that runtime. The controlled deploy
uses `scripts/railway/release.sh`. It enumerates the legacy `pi` service and all
`pi-u-*` services without persisting or printing the temporary Convex admin
key. Before it pushes functions, it synchronizes the allowlisted WorkOS,
service-auth, private-routing, and web-origin variables into the Convex function
environment without printing or persisting their values. Keep
`LIVE_TRADING_ENABLED=false`.
