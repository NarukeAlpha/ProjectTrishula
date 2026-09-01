# Architecture

## Trust boundaries

The browser authenticates with WorkOS and calls public Convex functions. It never receives service credentials, the Discord token, or Pi Codex OAuth data.

The Discord gateway is a private Railway service. It holds `DISCORD_BOT_TOKEN` and `CHART_IMG_API_KEY`. It connects to the Discord Gateway and materializes validated chart requests. It uses `CONVEX_DISCORD_SHARED_SECRET` for the Convex Discord endpoint and a separate `PI_DISCORD_SHARED_SECRET` for Pi. Neither credential can authenticate brokerage, credential-vault, web-chat run, or order routes.

Convex is the source of truth for guild routing, one logical conversation per guild, owner binding, canonical events, ordered turn stages, research artifacts, leases, fencing generations, watermarks, the Discord outbox, and delivery reconciliation. A gateway process-local channel set and a Pi process-local Luna session are caches, not authorities.

Pi reads Codex OAuth from its mounted `PI_AUTH_PATH`. Discord uses no brokerage, account, order, credential-vault, shell, process, code-execution, filesystem, or private-network tool. Sol receives bounded public research tools. Its chart tool creates only a validated artifact request and never receives the CHART-IMG key or a rendered image.

## Conversation identity and continuity

Each Discord guild has exactly one durable logical Luna conversation with ID `discord:{guildId}`. It is server-scoped, not channel-scoped. Changing the conversation channel preserves its ID, epoch, canonical history, and author attribution while fencing the previous route.

Convex stores the durable identity, epoch, general revision, human revision, ordered events, turn state, and compatible context metadata. It returns a token-budgeted canonical tail rather than a fixed message count. Human statements retain author IDs and mutable display names. One participant's holdings or preferences do not become guild-wide facts.

Pi keys a hot Luna session by conversation ID, epoch, and owner-binding version. Before reuse, it also checks revision and policy identity. Hot reuse is an optimization. A restart, deployment, idle eviction, reset, policy mismatch, or `TRISHULA_HOT_SESSION_REUSE_ENABLED=false` causes Pi to reconstruct the same logical conversation from Convex. The hot-cache-disabled path must keep the same canonical output and ordering semantics.

Luna uses one visible identity for direct and researched turns. Plan and resume are stages in the same logical conversation. They are not separate personalities or durable histories. After a researched turn, Pi rebases or rebuilds hot context so the internal plan and evidence packet do not enter later turns.

## Durable Discord flow

```text
Discord Gateway
  -> verified message ingestion
Convex guild conversation lease
  -> canonical context and claimed input window
Luna frontman plan
  -> direct reply, clarification, silence, or research request
Optional explicit acknowledgment
  -> durable outbox
Fresh isolated Sol worker
  -> bounded validated evidence packet
Convex newest eligible context
Same logical Luna conversation resumes
  -> send, suppress, or one bounded recheck
Durable outbox
  -> Discord send and canonical sent acknowledgment
```

Luna is locked to `gpt-5.6-luna`, `xhigh`, and `priority`. Sol is locked to `gpt-5.6-sol`, `ultra`, and `priority`. Each Sol request creates a fresh session. Sol receives only the normalized research request and needed public context. Only its validated bounded evidence packet can enter the active Luna turn.

The research packet targets 2,500 estimated tokens and has a hard 16,384-byte boundary. Exact source URLs must come from trusted research tools. Current claims require grounded sources. A trusted chart artifact comes through a separate side channel. Sol's hidden reasoning, provider transcript, raw tool trace, failed JSON, and repair prompts are not durable Luna history.

## Ordered processing and recovery

Convex serializes Luna mutations with a guild-conversation lease. Channel sequencing remains the ingestion order. New messages can enter Convex while a turn is active, but another Luna turn cannot mutate the same guild conversation concurrently.

Each turn persists stable IDs and fingerprints for the plan, optional acknowledgment, research, resume, final draft, and outbox. A restart reclaims an expired lease with the same run and turn identity. It skips a persisted plan, completed Sol artifact, or valid resume result. It reruns only a missing or unsafe stage. Before using a saved final draft, it checks the newest eligible human context and exact sequence cutoff.

A later unrelated explicit trigger stays ordered for the next turn. A cancellation, correction, or complete human answer inside the active cutoff can suppress or change the current reply. Ambient research failure stays silent. An explicit request produces a direct answer, clarification, refusal, or a research acknowledgment followed by a final answer or plain failure closure.

At most two autonomous rechecks are allowed. A recheck requires changed context. Bot messages can remain in context but do not trigger a normal loop.

## Canonical history

A verified human message becomes canonical once. An assistant acknowledgment or final reply becomes a canonical visible event only after Discord returns a message ID and Convex records the sent acknowledgment. Generated, queued, failed, cancelled, or uncertain assistant content does not enter future Luna history as visible content.

Internal plan and research events remain durable only for recovery and audit. They are not visible conversation events. The generic activity feed stores bounded identifiers, stage transitions, timestamps, counts, and reason codes. It must not contain Discord text, model output, research packet text, prompts, source-page text, credentials, or checkpoint summaries.

## Delivery

Convex creates an idempotent outbox record before a turn completes. Each record persists a stable Discord nonce and payload hash before the first send. The gateway sends the exact payload with `enforce_nonce: true` and `allowedMentions.parse` empty.

The gateway marks a record sent only after Discord returns a message ID. A timeout after possible acceptance enters `delivery_uncertain`. Gateway events and bounded Discord history can reconcile a matching channel, bot author, nonce, and payload hash. If the nonce window may have expired and delivery cannot be proved, the record enters `needs_reconciliation` and blocks a competing finalizer. The gateway does not blindly resend it.

Final and clarifying messages allow at most 2,000 Unicode code points. Research acknowledgments allow at most 320. Pi, gateway contracts, Convex, and the dispatcher normalize and count content consistently. Oversize model output gets one bounded repair and then fails closed. Delivery never silently slices content.

## Reset and privacy deletion

An owner-authorized reset preserves the logical conversation ID and increments its epoch and fencing generations. It cancels the active old-epoch turn, invalidates checkpoint and hot-session reuse, and cancels unsent old-epoch outbox work. A message that Discord may already have accepted reconciles only into the old epoch's audit state. Reset does not delete source Discord messages.

Privacy deletion is separate. It first fences active guild and channel state. It then removes retained canonical events, turns, research artifacts, checkpoint data, source-message lookup data, outbox content, and derived tail indexes for that guild. Wrong-owner requests fail without changing data.

## Compaction status

Durable continuity, hot-session reuse, native compaction, and portable automatic checkpoints are independent controls.

- `TRISHULA_DURABLE_CONVERSATIONS_ENABLED` controls the durable gateway path.
- `TRISHULA_HOT_SESSION_REUSE_ENABLED` controls only the Pi in-memory cache.
- `TRISHULA_NATIVE_COMPACTION_ENABLED` accepts only `false`.
- `TRISHULA_PORTABLE_CHECKPOINTS_ENABLED` accepts only `false`.

Native opaque compaction is hard-disabled until the pinned Pi `0.84.1` Codex OAuth compatibility, restart, privacy, and measurement spike passes. Portable checkpoint schemas, bounded storage, expiry, restore validation, and privacy deletion are present, but automatic generation and activation are disabled until the execution path and storage-encryption evidence pass. The storage record says `platform_default_unverified`; it is not an encryption claim.

Until those gates pass, durable recovery uses canonical Convex history and the bounded raw tail. A checkpoint failure or missing checkpoint cannot authorize cross-guild state or make a process-local file authoritative.
