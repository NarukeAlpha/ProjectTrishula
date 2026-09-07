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

`.railway/railway.ts` is the source of truth for roots, Dockerfile builders, watch paths, health checks, restart policies, resources, and preserved variable names. Railway watch paths are service-scoped.

## Discord setup

Create a bot in the Discord Developer Portal. On its Bot page, enable Message Content Intent. Invite it with these channel permissions:

- View Channel
- Read Message History
- Send Messages
- Create Posts in the selected forum
- Send Messages in Threads
- Attach Files when morning-newspaper charts are enabled

Set `DISCORD_BOT_TOKEN` and `CHART_IMG_API_KEY` only on the Discord service. Set `PUBLIC_DISCORD_APPLICATION_ID` on the web service. The website uses the public application ID to create a callback-free server-install link.

The Pi worker creates a validated chart request through `generate_market_chart`. Convex stores the trusted request with the final outbox record. The Discord service calls CHART-IMG and validates the PNG before upload. A missing key, provider error, or invalid image does not block a valid text reply.

The Gateway integration does not use `DISCORD_CLIENT_SECRET`. A client secret is needed only for a future server-side Discord OAuth exchange. The application public key is also unused because this service has no HTTP Interactions endpoint.

After the bot connects, select one conversation channel and an optional research-log channel for each server. The two roles cannot use the same channel. Changing the conversation channel preserves the guild's logical conversation and fences the old route.

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

Pi uses Codex OAuth stored on the Railway volume at `PI_AUTH_PATH`. Do not put the OAuth file in Git or a Railway variable. The Discord gateway receives only structured agent results.

Build the Pi service and start the device-code flow from a Railway SSH shell:

```sh
npm run build
CODEX_AUTH_MODE=device_code npm run auth:codex
```

The process writes the OAuth record directly to `/data/auth.json` when `PI_AUTH_PATH=/data/auth.json`. Do not copy it into source, a variable, chat, or logs.

## Required service variables

Keep all secrets in Railway. Do not use `--show-values` in plan output.

Discord service:

| Variable | Required value or purpose |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Discord bot credential |
| `CHART_IMG_API_KEY` | Chart rendering credential |
| `DISCORD_OWNER_ID` | Bound WorkOS owner ID |
| `CONVEX_DISCORD_SHARED_SECRET` | Discord-to-Convex credential |
| `PI_DISCORD_SHARED_SECRET` | Discord-to-Pi credential; independent from other secrets |
| `CONVEX_SITE_URL` | Convex HTTP Actions base ending in `/http` |
| `PI_SERVICE_URL` | Private Pi URL, normally `http://pi.railway.internal:8080` |
| `TRISHULA_DURABLE_CONVERSATIONS_ENABLED` | `true` for the durable path |
| `TRISHULA_PORTABLE_CHECKPOINTS_ENABLED` | `false` during the initial pilot; align with Pi |

Pi service:

| Variable | Required value or purpose |
| --- | --- |
| `SERVICE_SHARED_SECRET` | Web-chat internal credential |
| `PI_DISCORD_SHARED_SECRET` | Discord-only credential; must differ from `SERVICE_SHARED_SECRET` |
| `CONVEX_SITE_URL` | Exact Convex HTTP Actions prefix ending in `/http` |
| `BOUND_ACTOR_ID` | Exact production WorkOS subject |
| `PI_AUTH_PATH` | `/data/auth.json` on the mounted volume |
| `TRISHULA_DURABLE_CONVERSATIONS_ENABLED` | `true`; align with the Discord service |
| `TRISHULA_HOT_SESSION_REUSE_ENABLED` | `true` initially; can be disabled independently |
| `TRISHULA_NATIVE_COMPACTION_ENABLED` | `false` until the reviewed native live probe and storage gates pass |
| `TRISHULA_NATIVE_COMPACTION_LIVE_PROBE_ATTESTATION` | Unset until the exact reviewed native probe passes |
| `TRISHULA_PORTABLE_CHECKPOINTS_ENABLED` | `false` during initial rollout; `true` only after the documented portable gates pass |

The runtime supplies defaults for the locked profile values below. Set them explicitly only when deployment visibility is useful. Any different locked literal fails startup.

| Variable | Accepted/default value |
| --- | --- |
| `TRISHULA_LUNA_MODEL` | `gpt-5.6-luna` |
| `TRISHULA_LUNA_REASONING_EFFORT` | `xhigh` |
| `TRISHULA_LUNA_SERVICE_TIER` | `priority` |
| `TRISHULA_LUNA_PROFILE_VERSION` | `luna-frontman-v1` |
| `TRISHULA_LUNA_MAX_OUTPUT_TOKENS` | `8000` |
| `TRISHULA_SOL_MODEL` | `gpt-5.6-sol` |
| `TRISHULA_SOL_REASONING_EFFORT` | `max` |
| `TRISHULA_SOL_SERVICE_TIER` | `priority` |
| `TRISHULA_SOL_PROFILE_VERSION` | `sol-research-v1` |
| `TRISHULA_SOL_MAX_OUTPUT_TOKENS` | `16000` |
| `TRISHULA_PERSONALITY_VERSION` | `trishula-discord-v1` |
| `TRISHULA_MODEL_CONTEXT_WINDOW` | `272000` |
| `TRISHULA_RESEARCH_PACKET_TOKEN_TARGET` | `2500` |
| `TRISHULA_RESEARCH_PACKET_MAX_BYTES` | `16384` only |
| `TRISHULA_RECENT_TAIL_TOKEN_BUDGET` | `20000` only |
| `TRISHULA_MAX_AUTONOMOUS_RECHECKS` | `2` only |
| `TRISHULA_AMBIENT_MIN_CONFIDENCE` | `0.85` |
| `TRISHULA_AMBIENT_MIN_ADDITIVE_VALUE` | `0.9` |
| `TRISHULA_HOT_SESSION_IDLE_MS` | `3600000` |

The visible provider tuples are Luna `gpt-5.6-luna` / `xhigh` / `priority` and Sol `gpt-5.6-sol` / `max` / `priority`. The pinned provider catalog and the 2026-09-07 OAuth smoke test both use the wire value `max`. The literal `ultra` is invalid for this transport.

## Rollout order

Deploy the durable contract in this order:

1. **Convex**: deploy schema, generated API, HTTP operations, guild conversation state, persisted turn stages, privacy controls, and outbox reconciliation first. Existing services must remain compatible while the new functions become available.
2. **Pi**: deploy the locked frontman, Sol, and disabled-by-default portable checkpoint contracts. Verify `/health` and Codex OAuth before continuing.
3. **Discord**: deploy the durable orchestrator and set `TRISHULA_DURABLE_CONVERSATIONS_ENABLED=true` only after Convex and Pi accept the new contracts.
4. **Web**: deploy the server conversation status, reset, and privacy-deletion controls after the backend mutations are live.

Do not deploy Discord before its required Convex operations and Pi profiles. That order can turn an explicit request into a partial stage with no safe recovery.

## GitHub builds and Railway IaC

Railway's source must point to `NarukeAlpha/ProjectTrishula`, branch `master`, for each code service. A push starts builds only when the service watch path matches the changed files.

Preview infrastructure settings after the first push:

```sh
npm run railway:plan
```

The command requires the local Railway CLI to be authenticated and linked to the intended project and environment. If it reports that no project is linked, stop. Do not link or apply to an inferred target.

Apply only after the plan contains the expected updates:

```sh
railway config apply
```

Railway omits its default `ON_FAILURE` restart policy and default 10-retry limit from exported configuration. The IaC file declares only non-default retry limits so repeated plans remain stable.

Then run `bash scripts/railway/connect-github.sh` once when GitHub sources still need connection. The script requires a zero-drift IaC plan. It configures Railway references, accepts generated service credentials through standard input, and starts fresh source deployments for affected services. It does not set `DISCORD_BOT_TOKEN`.

The `railway` npm package in this repository is the typed IaC SDK. It is not the Railway CLI executable.

## Live gates and rollback

Local type checks, tests, builds, and IaC validation do not prove production readiness. Do not claim go-live until live evidence covers:

- the intended Convex deployment and generated functions;
- Pi Codex OAuth access to both exact locked model tuples and the priority service tier;
- a real Discord 2,000-code-point boundary, 320-code-point acknowledgment, mass-mention suppression, nonce deduplication, and uncertain-send reconciliation;
- Pi, Discord, and Convex restarts at plan, acknowledgment, Sol, resume, and delivery boundaries without duplicate visible messages;
- reset and privacy deletion while work or delivery is active;
- the selected Convex backend's encryption-at-rest control, key-rotation policy, and backup deletion or cryptographic-erasure deadline;
- cross-guild isolation, activity-feed redaction, explicit failure closure, source grounding, and newest-context suppression;
- one shadow guild and one noncritical pilot with recorded latency, token, cost, ambient-chatter, and naturalness results.

Keep native opaque compaction off until its Pi `0.84.1` Codex OAuth continuation and restart probe passes and the attestation is recorded. Keep portable automatic checkpoints off for the initial pilot. The execution paths exist, but live long-context quality, savings, failure-recovery, privacy, and storage-encryption evidence remain open. The stored protection label is `platform_default_unverified`.

Rollback controls are independent:

- Disable Pi hot-session reuse without losing durable Convex history.
- Disable the durable Discord gateway path to return to the compatibility runner without deleting canonical data.
- Disable native compaction independently by setting it to `false` and removing its live-probe attestation. Disable portable checkpoints independently without deleting canonical data.

Do not delete canonical conversation records during rollback. The activity feed reports `delivery_uncertain` and `delivery_reconciliation_required` without message content. Investigate either state before another final delivery or privacy deletion for that guild.
