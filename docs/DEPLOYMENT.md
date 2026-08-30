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

Set `DISCORD_BOT_TOKEN` only on the Railway Discord service. Use the website's Discord section to select conversation monitors, reply targets, and optional research logs after the bot connects.

## Pi authentication

Pi uses Codex OAuth stored on its existing Railway volume at `PI_AUTH_PATH`. Do not put the OAuth file in Git or a Railway variable. The Discord gateway receives only structured agent results.

## GitHub builds

Railway's source must point to `NarukeAlpha/ProjectTrishula`, branch `master`, for each code service. A push to that branch starts builds when the service watch path matches the changed files.

Run `bash scripts/railway/connect-github.sh` once after the first push. The script connects each service and uses Railway references for existing shared variables. It does not set `DISCORD_BOT_TOKEN`.

Then preview and apply the infrastructure settings:

```sh
railway config plan
railway config apply
```

The plan must contain only the expected updates before you apply it. Do not use `--show-values` or commit a literal secret to `.railway/railway.ts`.
