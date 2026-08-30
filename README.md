# Project Trishula

Project Trishula connects a phone-friendly chat control surface to a Discord market conversation bot. Convex stores durable state. A private Pi service runs the model pipeline with Codex OAuth. A separate Discord gateway holds the bot token and live Discord connection.

The current POC does research and writes concise Discord replies. It does not place trades or connect to Robinhood.

## Services

- `apps/web`: WorkOS-protected Chat and Discord channel settings.
- `apps/convex`: chat data, Discord channel assignments, durable loop leases, message windows, runs, outbox state, and a safe activity feed.
- `apps/pi`: existing chat execution plus isolated Luna triage, Luna acknowledgment, Sol research, and Luna reply sessions. Discord stages use `xhigh` reasoning on the priority service tier.
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
4. If Luna accepts the question, the loop enters a visible acknowledgment stage. A second Luna call writes one short acknowledgment. Convex queues it immediately, and the gateway gives it delivery priority.
5. Sol performs research with limited public web and market-data tools when needed.
6. The reply-stage Luna receives the research and the newest ten messages, then writes a reply of at most 1,200 characters.
7. Convex queues each outbound message with an explicit purpose. The gateway sends it with Discord mentions disabled and records the Discord message ID.
8. Convex schedules ordered catch-up windows for messages that arrived during the run. It caps autonomous rechecks to prevent bot loops.

The Discord page shows a live activity feed for the selected server. It stores only fixed event types, channel IDs, run IDs, stages, timestamps, and outbound message purposes. It does not store message text, model prompts, model output, source URLs, credentials, or hidden reasoning in the feed.

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

Web:

- `PUBLIC_DISCORD_APPLICATION_ID=1114379702015111228` (public install-link identifier)

The Gateway does not use the Discord OAuth client secret. Add `DISCORD_CLIENT_SECRET` only if a later server-side feature exchanges Discord OAuth codes. The application public key is only for an HTTP Interactions endpoint, which this service does not use.

Pi:

- `SERVICE_SHARED_SECRET`
- `PI_DISCORD_SHARED_SECRET`
- `PI_AUTH_PATH=/data/auth.json`
- `PI_LUNA_MODEL=gpt-5.6-luna`
- `PI_SOL_MODEL=gpt-5.6-sol`

The existing web, WorkOS, Convex, and Pi variables remain required. See [deployment notes](docs/DEPLOYMENT.md).

Railway infrastructure settings are declared in `.railway/railway.ts`. Run `npm run railway:plan` before applying a change.
