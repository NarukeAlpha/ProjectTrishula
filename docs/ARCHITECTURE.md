# Architecture

## Trust boundaries

The browser authenticates with WorkOS and calls public Convex functions. It never receives service credentials, the Discord token, or Pi Codex OAuth data.

The Discord gateway is a private Railway service. It holds `DISCORD_BOT_TOKEN` and `CHART_IMG_API_KEY`. It connects to the Discord Gateway and fetches generated chart PNGs. It uses `CONVEX_DISCORD_SHARED_SECRET` for the Convex Discord endpoint and a separate `PI_DISCORD_SHARED_SECRET` for Pi's agent-only endpoint. Neither credential can authenticate brokerage, credential-vault, run, or order routes.

Convex is the source of truth for channel assignments, messages, processing watermarks, fenced leases, loop runs, recheck limits, and the Discord outbox. The gateway keeps a local active-channel set only to reduce duplicate calls. That set is not a lock.

Pi reads Codex OAuth from its mounted `PI_AUTH_PATH`. It creates a fresh session for each Discord stage. Triage and reply have no tools. Research receives only bounded public research tools. Its `generate_market_chart` tool selects a validated symbol and fixed chart controls. It does not receive the CHART-IMG key or rendered image. The Discord pipeline has no brokerage or order tools.

Discord submits each Pi stage as an idempotent asynchronous job and polls with short private-network requests. Pi keeps bounded terminal results long enough for the gateway to collect them. If Pi restarts before completion, the gateway can submit the same request ID again. This avoids holding one HTTP response open for a long Sol research pass.

## Ordered processing

Each channel state stores the latest message sequence and the last successfully processed sequence. A claim advances through at most ten new messages and gives Luna the trailing ten messages at that watermark. A 25-message burst therefore becomes three ordered windows. Messages received during a run update Convex state but cannot acquire another lease.

The reply stage fetches the newest trailing ten messages after research. This lets it account for corrections and counterpoints posted while Sol worked.

Each channel lease has a fencing generation and expiry. Each delivery lease also has a token. Convex rejects stale heartbeats, completions, outbox writes, and delivery acknowledgements. Failed stages do not advance the processing cursor.

Convex retries a retryable loop failure after a cooldown, with a fixed consecutive-attempt cap. A nonretryable authentication or protocol failure stops immediately. A new human message clears the cap. This recovers transient provider or deployment faults without an unbounded model-call loop.

## Autonomous rechecks

The reply agent can request another pass. Convex permits at most two autonomous passes and rejects a recheck when the context hash did not change. Bot messages can remain in the conversation context, but they do not trigger a normal loop.

## Delivery

Convex creates idempotent outbox records before the loop completes. Luna writes one short acknowledgement after triage accepts a human question. A retry does not send that acknowledgement again for the same Discord message. An optional research log is non-final. The concise reply is the final record. The Discord gateway sends with `allowedMentions.parse` empty and marks each record sent only after Discord returns a message ID. Convex completes the loop only after every queued record is sent. Delivery leases prevent two Railway replicas from sending the same pending record at the same time. A restart finalizes an acknowledged reply without sending it again.

## Scheduled morning newspaper

The morning newspaper is independent from the conversation system. It has separate Convex preferences, editions, evidence, sections, deliveries, events, previews, calendar snapshots, overrides, indexes, leases, HTTP routes, Pi job registry, and Discord poller. It never creates a source Discord message, `discordLoopRuns` row, `discordOutbox` row, or channel-loop cursor. The configured forum and its child threads are excluded from conversational mention ingress.

Convex owns the stable owner, guild, schedule, and local-date key. It freezes the complete preference record, forum route, prompt and source-policy versions, and calendar-derived session context before dispatch. Runtime session resolution accepts only a reviewed, recent, in-range calendar from an approved official host and applies immutable owner overrides. An unknown session becomes a visible `Data unavailable` context. Pi cannot replace the frozen date, timezone, edition label, session, or symbol boards with provider output.

Research and publication have different generations, tokens, and leases. The research generation controls Pi evidence and composition. The publication generation controls Discord reconciliation and part acknowledgements. Preview leases use the same fenced research rules but remain in `marketResearchPreviews`. Composite status-and-time indexes bound each recovery mutation to 25 total records across research, publication, and preview work.

Pi uses the actor-bound `/market-research/jobs` route and a dedicated job registry. The Exa boundary uses the official `exa-js` package pinned to `2.19.0`, a fixed production origin, bounded concurrency, safe error mapping, and edition cost and request limits. The pinned SDK does not expose Search or Contents cancellation. An in-flight timeout closes the edition budget, retains paid-work permits until the SDK promise settles, rejects late evidence, and prevents an automatic replacement request. Search results and a deterministic `exa-search-slot-*` completion record are stored after each paid slot. Selected Contents results and an `exa-contents-url-*` record are stored one URL at a time. Recovery skips those durable units and performs only missing paid work. Policy-resolved slots remain visible source statuses without a provider call. The final `exa-collection-complete` record is written only after every provider-executed required Search slot and selected Contents URL has a durable outcome.

After retrieval and deterministic calculations, Pi creates one isolated, tool-free composer session when approved market evidence is available. With the disabled provider, it creates a deterministic `Data unavailable` operational edition with no setup scores. Neither path has a broker dependency. Convex does not trust the Pi result by shape alone. It revalidates the complete strict schema, frozen settings and session, evidence IDs and content hashes, source coverage, Search count and cost, sections, chart references, delivery identities, content hashes, and research-only language before it creates immutable section and delivery records. A periodic heartbeat keeps the research lease live during provider and model calls.

An owner dry run uses an `MRP-` ID and the same isolated Pi pipeline. Convex retains bounded preview evidence, parses the complete strict result schema, compares the frozen preview session, symbol boards, source policy, and stored evidence hashes, stores only a bounded quality summary and fingerprint, and discards the delivery parts. A preview cannot create an edition, reserve a scheduled key, enter publication polling, or create a forum thread.

Discord publishes only through `ForumChannel.threads.create` and the returned thread. It verifies the bot-authored starter before Convex can release reply work. Every immutable part has a visible marker, content hash, nonce, and individual acknowledgement. Recovery searches recent active and archived threads and resumes at the first missing reply.

When reconciliation finds more than one matching starter or reply, it keeps the earliest known Discord identifiers for audit, records `duplicate_publication_incident`, sets the safe operator state `discord_thread_reconcile_ambiguous`, and stops automatic publication. It does not create another starter.

Charts are optional output. The disabled-by-default path adapts validated newspaper chart requests to the existing in-process CHART-IMG renderer. Convex verifies chart source IDs against edition evidence. A chart failure never changes a fact or blocks complete text.

The production entry point remains closed by three independent defaults: Pi research is disabled, Discord publication is disabled, and chart attachments are disabled. A selected `marketDataProviderId` is configuration only; the current Pi runtime constructs `DisabledMarketDataProvider`. A licensed adapter and its external acceptance evidence are required before numerical market conclusions can be enabled.

See [MARKET_RESEARCH_OPERATIONS.md](./MARKET_RESEARCH_OPERATIONS.md) for rollout gates, safe failures, retention, and cutover controls.
