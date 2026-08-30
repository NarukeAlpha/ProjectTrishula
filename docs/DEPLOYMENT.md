# Railway deployment

Project Trishula uses the existing Railway project and production environment. Each code service builds from `NarukeAlpha/ProjectTrishula` on the `master` branch.

| Service | Root directory | Config file |
| --- | --- | --- |
| web | `/apps/web` | `/apps/web/railway.json` |
| pi | `/apps/pi` | `/apps/pi/railway.json` |
| discord | `/apps/discord` | `/apps/discord/railway.json` |
| convex-backend | `/infra/railway/convex-backend` | `/infra/railway/convex-backend/railway.json` |
| convex-dashboard | `/infra/railway/convex-dashboard` | `/infra/railway/convex-dashboard/railway.json` |
| convex-functions | `/` | `/infra/railway/convex-functions/railway.json` |

Railway watch paths are scoped to each service. A change under `apps/discord` does not rebuild the web service.

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

Run `bash scripts/railway/connect-github.sh` once after the first push. The script connects each service, sets the monorepo root and watch paths, and uses Railway references for existing shared variables. It does not set `DISCORD_BOT_TOKEN`.
