# Project Trishula

Project Trishula connects a phone-friendly chat control surface to a Discord market conversation bot. Convex stores durable state. A private Pi service runs the model pipeline with Codex OAuth. A separate Discord gateway holds the bot token and live Discord connection.

The current POC does research and writes concise Discord replies. It does not place trades or connect to Robinhood.

## Services

- `apps/web`: WorkOS-protected Chat and Discord channel settings.
- `apps/convex`: chat data, Discord channel assignments, durable loop leases, message windows, runs, and outbox state.
- `apps/pi`: existing chat execution plus isolated Luna triage, Sol research, and Luna reply sessions.
- `apps/discord`: Discord Gateway connection, restart reconciliation, loop coordination, and outbox delivery.
- `infra/railway/convex-backend`: self-hosted Convex backend.
- `infra/railway/convex-dashboard`: self-hosted Convex dashboard.

Old code is preserved in two folders:

- `archive/legacy-trading-poc-2026-08-30`
- `archive/legacy-project-trishula-2024`

Ignored dependencies and build output remain in the local archive. Git tracks the archived source files but does not track generated output.

## Discord flow

1. The gateway stores each human message in Convex once.
2. Convex grants one fenced lease for that channel and returns an ordered window of at most ten new messages.
3. Luna decides whether the conversation needs a response and research.
4. Sol performs research with limited public web and market-data tools when needed.
5. The reply-stage Luna receives the research and the newest ten messages, then writes a reply of at most 1,200 characters.
6. Convex queues the reply. The gateway sends it with Discord mentions disabled and acknowledges the Discord message ID.
7. Convex schedules ordered catch-up windows for any messages that arrived during the run. It caps autonomous rechecks to prevent bot loops.

## Local checks

Install each package, then run the full gate:

```sh
npm install
npm install --prefix apps/convex
npm install --prefix apps/pi
npm install --prefix apps/discord
npm install --prefix apps/web
npm run check
```

## Railway variables

Keep secrets in Railway. Do not commit them.

Discord gateway:

- `DISCORD_BOT_TOKEN`
- `DISCORD_OWNER_ID` (set from the bound WorkOS user)
- `CONVEX_DISCORD_SHARED_SECRET`
- `PI_DISCORD_SHARED_SECRET`
- `CONVEX_SITE_URL`
- `PI_SERVICE_URL=http://pi.railway.internal:8080`

Pi:

- `SERVICE_SHARED_SECRET`
- `PI_DISCORD_SHARED_SECRET`
- `PI_AUTH_PATH=/data/auth.json`
- `PI_LUNA_MODEL=gpt-5.6-luna`
- `PI_SOL_MODEL=gpt-5.6-sol`

The existing web, WorkOS, Convex, and Pi variables remain required. See [deployment notes](docs/DEPLOYMENT.md).

Railway infrastructure settings are declared in `.railway/railway.ts`. Run `npm run railway:plan` before applying a change.
