# Project Trishula

Project Trishula connects a phone-friendly chat control surface to a Discord market conversation bot. Convex stores durable state. A private Pi service runs the model pipeline with Codex OAuth. A separate Discord gateway holds the bot token and the live Discord connection.

Discord is public-research only. It does not place trades or read a brokerage account. The authenticated web chat keeps its separate capability policy and conversation history.

## Services

- `apps/web`: WorkOS-protected chat, Discord routing, server conversation status, reset, and privacy-deletion controls.
- `apps/convex`: canonical Discord history, guild conversation leases, durable turn stages, research artifacts, outbox state, delivery reconciliation, and the redacted activity feed.
- `apps/pi`: the durable Luna frontman and fresh Sol research workers.
- `apps/discord`: Discord Gateway ingestion, turn coordination, restart recovery, and outbox delivery.
- `infra/railway/convex-backend`: self-hosted Convex backend.
- `infra/railway/convex-dashboard`: self-hosted Convex dashboard.

Old source is preserved in these folders:

- `archive/legacy-trading-poc-2026-08-30`
- `archive/legacy-project-trishula-2024`

## Discord conversation model

Each Discord guild has one durable logical Luna conversation, `discord:{guildId}`. A channel change preserves that conversation. Convex is authoritative for its epoch, revision, author-attributed canonical events, active turn, stage results, and delivery state.

Pi may keep one hot Luna session for a guild. The session is only a cache. Pi reconstructs the same logical conversation from Convex after a restart, idle eviction, policy mismatch, or when hot reuse is disabled.

The durable path is:

1. The gateway ingests each verified human message once.
2. Convex grants one fenced guild-conversation lease and returns a token-budgeted canonical tail.
3. Luna plans one action: stay silent for an ambient message, reply, clarify, or request research. Explicit mentions and replies cannot end in silence.
4. For research, Luna may write one specific acknowledgment. Convex persists the plan and acknowledgment state.
5. Sol starts a fresh isolated session with bounded public research tools. It returns only a validated evidence packet. Its hidden reasoning and tool transcript do not enter Luna history.
6. Convex persists the research result and returns the newest eligible context. The same logical Luna conversation resumes, sends, suppresses, or requests one bounded recheck.
7. Convex persists the resume result and creates an idempotent outbox record. The gateway sends it with an enforced nonce and with Discord mentions disabled.
8. Only human messages and Discord-confirmed assistant messages enter canonical visible history. Recovery reuses completed plan, research, resume, and delivery stages.

Luna is locked to `gpt-5.6-luna`, `xhigh`, and the priority service tier. Sol is locked to `gpt-5.6-sol`, `max`, and the priority service tier. Final replies can contain at most 2,000 Unicode code points. Research acknowledgments can contain at most 320. No delivery path silently truncates text.

## Continuity controls

- `TRISHULA_DURABLE_CONVERSATIONS_ENABLED` selects the durable gateway path. Keep the Discord and Pi values aligned during rollout.
- `TRISHULA_HOT_SESSION_REUSE_ENABLED` disables or enables only the Pi in-memory cache. Durable Convex continuity remains authoritative.
- `TRISHULA_NATIVE_COMPACTION_ENABLED` is hard-locked to `false`. The reviewed native opaque-compaction adapter is not compatible with the pinned Pi `0.84.1` runtime.
- `TRISHULA_PORTABLE_CHECKPOINTS_ENABLED` defaults to `false`. When both Pi and the gateway set it to `true`, the gateway can generate and compare-and-set activate first-party portable checkpoints at stable boundaries.

Portable checkpoint generation, bounded storage, expiry, source validation, compare-and-set activation, and restart reconstruction exist. Keep the opt-in flag off until the live long-context and storage-protection gates in `docs/personality-rollout-readiness.md` pass. Checkpoint storage is labeled `platform_default_unverified`; the repository does not claim verified encryption at rest. Native opaque compaction remains unavailable.

The owner can reset a server conversation. Reset keeps `conversationId`, increments the epoch and fences, cancels old unsent work, and starts clean memory. Reset does not delete source Discord data. Privacy deletion is a separate owner-authorized operation that fences active work and removes retained conversation data.

## Local checks

Install each package, then run the repository gate:

```sh
npm install
npm install --prefix apps/convex
npm install --prefix apps/pi
npm install --prefix apps/discord
npm install --prefix apps/web
npm run check
npm run check:personality
```

## Railway variables

Keep secrets in Railway. Do not commit them.

Discord gateway:

- `DISCORD_BOT_TOKEN`
- `CHART_IMG_API_KEY`
- `DISCORD_OWNER_ID`
- `CONVEX_DISCORD_SHARED_SECRET`
- `PI_DISCORD_SHARED_SECRET`
- `CONVEX_SITE_URL`
- `PI_SERVICE_URL=http://pi.railway.internal:8080`
- `TRISHULA_DURABLE_CONVERSATIONS_ENABLED=true`
- `TRISHULA_PORTABLE_CHECKPOINTS_ENABLED=false`

Pi:

- `SERVICE_SHARED_SECRET`
- `PI_DISCORD_SHARED_SECRET`
- `PI_AUTH_PATH=/data/auth.json`
- `TRISHULA_DURABLE_CONVERSATIONS_ENABLED=true`
- `TRISHULA_HOT_SESSION_REUSE_ENABLED=true`
- `TRISHULA_NATIVE_COMPACTION_ENABLED=false`
- `TRISHULA_PORTABLE_CHECKPOINTS_ENABLED=false`

Web:

- `PUBLIC_DISCORD_APPLICATION_ID=1114379702015111228`

The Pi research worker can request a bounded `generate_market_chart` artifact. It does not receive the CHART-IMG key or image bytes. The Discord service materializes the validated request and attaches the PNG.

See [Pi service details](apps/pi/README.md), [architecture](docs/ARCHITECTURE.md), [deployment notes](docs/DEPLOYMENT.md), and the [personality specification](docs/personality.md).

Railway infrastructure settings are declared in `.railway/railway.ts`. Run `npm run railway:plan` before an apply. A clean local plan does not replace live Convex deployment, Codex OAuth, Discord delivery, restart, and reconciliation checks.
