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
- Create Posts in the selected forum
- Send Messages in Threads
- Attach Files when morning-newspaper charts are enabled

Set `DISCORD_BOT_TOKEN` and `CHART_IMG_API_KEY` only on the Railway Discord service. Set the public application ID as `PUBLIC_DISCORD_APPLICATION_ID` on the Railway web service. The website uses it to create a callback-free server-install link.

The Pi agent creates a validated chart request through its `generate_market_chart` tool. Convex stores that request with the final outbox record. The Discord service calls CHART-IMG and validates the PNG before upload. A missing key, provider error, or invalid image does not block the text reply.

The current Gateway integration does not need `DISCORD_CLIENT_SECRET`. A client secret is needed only for a future server-side Discord OAuth token exchange. The supplied application public key is also unused because this service does not expose an HTTP Interactions endpoint.

After the bot connects, the website lists each server where it is installed. Select a server, then assign conversation monitors, reply targets, and optional research logs for that server.

The morning newspaper uses a third, independent forum selector. It does not change either existing route. The server rejects text and announcement channels, missing forum permissions, moderated tags, and a required-tag forum without a valid tag.

## Morning newspaper rollout

Railway declares three independent safe defaults:

```text
Pi:      MARKET_RESEARCH_ENABLED=false
Discord: MARKET_RESEARCH_ENABLED=false
Discord: MARKET_RESEARCH_CHARTS_ENABLED=false
```

The Pi flag controls research, composition, and isolated previews. The Discord flag controls forum publication. The chart flag is an additional attachment gate. Frozen preferences must also set both `includeCharts` and `chartsAcceptancePassed` before Convex accepts a chart request. Do not treat one enabled flag as approval for the others.

The Pi service uses the official `exa-js` package pinned to `2.19.0`. The application boundary sends Search content options in the SDK Search request, sends Contents options through the SDK Contents request, and fixes production traffic to Exa's official origin. Do not replace this boundary with an unreviewed package version, a browser call, or a configurable production proxy.

The pinned SDK does not expose Search or Contents cancellation. Pi closes the edition budget on an in-flight abort and holds paid-work permits until the SDK promise settles. Treat `exa_budget_exhausted` after a timeout as a possible unknown provider charge. Check provider billing and durable checkpoints before a manual retry.

The Pi service preserves `EXA_API_KEY` and `EXA_MAX_COST_USD_PER_EDITION`; it does not define their values. Set them only in the Railway service secret store. Pi requires the Exa key only when its feature flag is true. Health returns only `exaConfigured: true|false`; it does not return a prefix, suffix, length, hash, fingerprint, header, or request object.

The current Pi runtime constructs `DisabledMarketDataProvider`. Saving a `marketDataProviderId` in Convex does not activate market data. Integrate and approve a licensed adapter before you enable a schedule. Until then, the runner can produce only a visible `Data unavailable` operational edition with no setup scores or market conclusion. Do not use that safe degradation as evidence that the numerical data gate passed.

Keep the defaults false until the Exa, licensed market-data, current-and-next-year NYSE calendar, private Discord forum, restart, real 08:00, and three-edition acceptance gates pass. Keep the existing **Market Research** automation active. Pause it only after explicit owner approval; never delete it as part of deployment.

Use this order for a controlled rollout:

1. Plan and review Railway infrastructure. Do not include secret values in the plan output.
2. Load and review an official calendar snapshot. It must cover the current date through the end of the next calendar year and be no more than 45 days old at enablement.
3. Configure the Exa secret and reviewed cost ceiling. Run the live Exa smoke test and the opt-in Financial Datasets evaluation without changing the account's Zero Data Retention setting.
4. Integrate and validate the licensed market-data adapter. Prove current premarket timestamps and session labels for every primary symbol.
5. Keep the preference schedule and Discord publication disabled. Temporarily enable Pi only for an isolated private preview. The preview uses an `MRP-` ID and cannot create an edition, scheduled key, delivery, or forum thread.
6. Validate unattended composition after a Pi restart. Then enable Discord publication in a private forum and test reconciliation, partial delivery, permissions, mention suppression, and optional charts.
7. Observe one real scheduled 08:00 edition and accept three consecutive scheduled editions before the owner considers cutover.

Review [MARKET_RESEARCH_OPERATIONS.md](./MARKET_RESEARCH_OPERATIONS.md) before any enablement.

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
