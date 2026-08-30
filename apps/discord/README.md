# Discord gateway

This Railway service holds the Discord bot token and the live Gateway connection. It stores guild, channel, message, lease, and outbox state in Convex. It sends agent work to the private Pi service.

Pi agent calls use short, authenticated job requests. The gateway submits a stage, polls its job status, and retries transient poll failures. A minute-scale Sol run does not depend on one long-lived HTTP response.

The service never sends the Discord token or Pi Codex OAuth data to the browser or Convex. Convex records fixed activity events for the web control page, but it does not copy message text, model prompts, credentials, or hidden reasoning into that feed.

## Required Railway variables

- `DISCORD_BOT_TOKEN`: Discord bot token. The health server can start without it. Add it to connect the bot.
- `DISCORD_OWNER_ID`: WorkOS user ID that owns the Discord channel configuration.
- `CONVEX_DISCORD_SHARED_SECRET`: Dedicated secret for the Convex Discord HTTP action.
- `PI_DISCORD_SHARED_SECRET`: Dedicated secret for the Pi Discord agent endpoint.
- `CONVEX_SITE_URL`: Private or public Convex HTTP action base ending in `/http`.
- `PI_SERVICE_URL`: Private Pi service base, such as `http://pi.railway.internal:8080`.

Optional timing controls are documented in `src/config.ts`.

Enable the `MESSAGE CONTENT INTENT` on the Bot page in the Discord Developer Portal. Invite the bot with View Channels, Send Messages, and Read Message History permissions. The service also requests the Guilds and Guild Messages gateway intents.

The Gateway, bot REST calls, and callback-free bot install flow use the bot token. They do not use the Discord OAuth client secret. Add a client secret only if a future server-side feature exchanges Discord OAuth authorization codes. The application public key is needed only for a future HTTP Interactions endpoint; this service receives events through the Gateway.

## Checks

```sh
npm run typecheck
npm test
npm run build
```
