# Railway deployment

Project Trishula uses the existing Railway project and production environment. Each code service builds from `NarukeAlpha/ProjectTrishula` on the `master` branch.

| Service | Root directory |
| --- | --- |
| web | `/apps/web` |
| pi | `/apps/pi` |
| discord | `/apps/discord` |
| convex-backend | `/infra/railway/convex-backend` |
| convex-dashboard | `/infra/railway/convex-dashboard` |
| convex-functions | `/` |

`.railway/railway.ts` is the one source of truth for these roots, Dockerfile builders, watch paths, health checks, restart policies, existing resources, and preserved variable names. Railway watch paths are scoped to each service. A change under `apps/discord` does not rebuild the web service.

## Discord setup

Create a bot in the Discord Developer Portal. On its Bot page, enable Message Content Intent. Invite it to the server with these channel permissions:

- View Channel
- Read Message History
- Send Messages

Set `DISCORD_BOT_TOKEN` and `CHART_IMG_API_KEY` only on the Railway Discord service. Set the public application ID as `PUBLIC_DISCORD_APPLICATION_ID` on the Railway web service. The website uses it to create a callback-free server-install link.

The Pi agent creates a validated chart request through its `generate_market_chart` tool. Convex stores that request with the final outbox record. The Discord service calls CHART-IMG and validates the PNG before upload. A missing key, provider error, or invalid image does not block the text reply.

The current Gateway integration does not need `DISCORD_CLIENT_SECRET`. A client secret is needed only for a future server-side Discord OAuth token exchange. The supplied application public key is also unused because this service does not expose an HTTP Interactions endpoint.

After the bot connects, the website lists each server where it is installed. Select a server, then assign conversation monitors, reply targets, and optional research logs for that server.

## Pi authentication

Pi uses Codex OAuth stored on its existing Railway volume at `PI_AUTH_PATH`. Do not put the OAuth file in Git or a Railway variable. The Discord gateway receives only structured agent results.

## GitHub builds

Railway's source must point to `NarukeAlpha/ProjectTrishula`, branch `master`, for each code service. A push to that branch starts builds when the service watch path matches the changed files.

Preview and apply the infrastructure settings after the first push:

```sh
railway config plan
railway config apply
```

The plan must contain only the expected updates before you apply it. The apply creates the code services and connects each GitHub source. Do not use `--show-values` or commit a literal secret to `.railway/railway.ts`.

Railway omits its default `ON_FAILURE` restart policy and default 10-retry limit from exported configuration. The IaC file declares only non-default retry limits so repeated plans remain stable.

Then run `bash scripts/railway/connect-github.sh` once. The script first requires a zero-drift IaC plan. It configures Railway references, generates missing service credentials through standard input, and starts fresh source deployments for the affected services. It does not set `DISCORD_BOT_TOKEN`.

Install and authenticate the Railway CLI before you use either command. The `railway` npm package in this repository supplies the typed IaC SDK; it is not the CLI executable.
