# Morning market newspaper operations

The morning market newspaper is a separate scheduled system. It does not use a Discord message, a conversation-loop cursor, `discordLoopRuns`, `discordOutbox`, or the `/discord` Pi route.

Each process defaults its service-level market-research gate to disabled when the related environment variable is absent. Railway preserves the deployed values. The control page cannot change these service-level gates.

Repository implementation is not production readiness. The Exa, calendar, composition, market-data, Discord, schedule, and cutover gates need live evidence that repository tests cannot provide. Pi contains an Exa Financial Datasets adapter, but it stays unavailable unless the runtime gate, recorded owner decision, explicit cost cap, and frozen server preference all select it. The repository does not contain a live Financial Datasets evaluation result.

## Service flow

1. The minutely Convex cron evaluates the owner-confirmed IANA timezone and one stable owner, guild, schedule, and local-date key.
2. Convex creates or returns one base edition. It freezes the complete settings record, hash, forum route, source and prompt versions, and calendar-derived session context.
3. A fenced Convex action sends an actor-bound asynchronous request to Pi at `/market-research/jobs`.
4. Pi runs the 12-slot research plan outside every conversation session. It stores each paid Search slot and selected Contents URL as a bounded durable checkpoint and maintains the research lease every 30 seconds.
5. Pi calculates only from approved structured data. With sufficient market evidence, it composes in one isolated session with no tools, prior conversation, or broker dependency. Otherwise, it produces a visible `Data unavailable` operational edition with no setup scores.
6. Convex validates the full result against the frozen session, settings, durable evidence, counts, costs, section rules, chart references, and delivery hashes. It materializes immutable Discord parts only after acceptance.
7. The Discord service polls `/market-research/discord`. It creates a forum post through `ForumChannel.threads.create`, verifies the bot-authored starter, and sends replies in order.
8. Convex records each Discord acknowledgement. A restart resumes at the first missing part.

The Discord gateway rejects conversational ingress from both the configured newspaper forum and its child threads. The existing conversation and research-log routes remain unchanged.

## Runtime activation controls

Treat these as independent service controls:

```text
Pi:      MARKET_RESEARCH_ENABLED
Pi:      MARKET_DATA_PROVIDER_ID
Pi:      EXA_FINANCIAL_DATASETS_OWNER_DECISION
Pi:      EXA_FINANCIAL_DATASETS_MAX_COST_USD_PER_REQUEST
Discord: MARKET_RESEARCH_ENABLED
Discord: MARKET_RESEARCH_CHARTS_ENABLED
```

Do not infer live values from source defaults. Inspect the deployed service before a test. Keep `MARKET_RESEARCH_ENABLED` off on Pi until its Exa credential is installed because Pi rejects that combination at startup. The Discord research gate can be enabled independently. The per-server schedule remains a separate saved preference and can stay off while an owner uses previews.

`EXA_API_KEY`, `EXA_MAX_COST_USD_PER_EDITION`, and the Financial Datasets per-request cap are dashboard-managed preserved values. Set a finite edition cap and a finite per-request cap before live work. Never put secret values in source, a command, a plan export, a test fixture, a log, or a support message.

Pi uses the official `exa-js` package pinned to `2.19.0`. Keep that reviewed boundary fixed until a package upgrade receives a separate contract and regression review. Health can expose only `enabled`, `exaConfigured`, and runner readiness for this feature.

`exa-js` 2.19.0 does not expose an `AbortSignal` for the underlying paid Search, Contents, or Agent operations. If a paid SDK call is in flight when its timeout or lease aborts, Pi rejects the result, closes that client's paid-work budget, and keeps the provider and cost permits occupied until the SDK promise settles. A missing or invalid returned cost also closes paid work, even when no edition dollar cap is configured. Automatic recovery cannot start a replacement paid request after this state.

Pi retains the last 128 cost observations in memory and submits each observation to Convex through the authenticated market-research endpoint. Every research or preview claim creates an immutable owner, target, generation, and token-hash binding. This binding lets the original paid request report a late settlement after its work lease expires or a later generation starts. Pi sends cost events independently of the cancelled run signal, retries the same event ID up to three times, and sends at most 1,024 events for one claim. Convex rejects an invalid binding or changed duplicate, deduplicates an exact retry, and stores no provider response body or credential.

The durable observed-cost fields are separate from the accepted evidence-derived `exaCostUsd`. A known cost increases `exaObservedCostUsd`. A missing cost increases `exaUnknownCostEventCount`. This delivery is not a disk spool, so process termination before a successful delivery can lose an observation. An abandoned observation and its later settlement do not share a provider attempt ID. The unknown count therefore remains conservative even when a later event records a known cost. Review both cost records and provider billing before an owner requests a manual retry.

An owner can save settings and run a preview with no forum. Enabling a schedule fails closed unless it has a confirmed timezone, a valid forum and tag configuration, a reviewed market-session calendar, and a configured market-data provider identifier.

A configured provider identifier is not an approval. Pi constructs the Financial Datasets adapter only when the server preference is `exa_financial_datasets`, `MARKET_DATA_PROVIDER_ID=exa_financial_datasets`, `EXA_FINANCIAL_DATASETS_OWNER_DECISION=approved`, and a positive per-request cap is configured. Every other combination uses the unavailable provider. Keep the schedule disabled until the live data gate passes.

## Financial Datasets evaluation and activation

The evaluation command is opt-in. It reads `EXA_API_KEY` only from the operator environment. It does not accept a key argument. It emits a bounded review report and does not emit the raw provider response.

From the repository root, run this only when the account is confirmed to have Zero Data Retention disabled:

```sh
npm --prefix apps/pi run market-research:evaluate-financial-datasets -- \
  --execute \
  --confirm-zdr-disabled \
  --evaluation-id STABLE_REVIEW_ID \
  --instant YYYY-MM-DDT08:00:00-04:00 \
  --timezone CONFIRMED_IANA_TIMEZONE \
  --max-cost-usd APPROVED_POSITIVE_CAP \
  --timeout-ms 120000
```

Do not use `--confirm-zdr-disabled` when the account state is enabled or unknown. Without that confirmation, the CLI rejects its options before it creates a client or issues a provider request. The evaluation library uses `exa_connect_zdr_incompatible` for a known incompatible state. A `completed` report is not an approval. Compare current price and prior close with an independent authorized source. Review every returned timestamp, session label, citation, field status, cost, and latency. Then record the owner decision outside the generated report as `approved`, `partial`, or `rejected`.

The runtime adapter supports grounded current price, grounded prior close, grounded daily and weekly OHLCV bars, and grounded corporate actions when Financial Datasets returns them. It does not claim support for 5-minute, 15-minute, or 60-minute bars, premarket high or low, premarket volume, bid, ask, spread, a market-movers feed, or an exchange calendar. It uses the reviewed frozen Convex calendar. Unsupported values remain unavailable and cannot be inferred from prior-close or daily data.

After an approved evaluation and independent comparison, set the three Pi provider controls to the values described above. Then select **Exa Connect Financial Datasets** in the server settings. A saved server choice does not change the Pi runtime or owner decision. Run a preview before publication. Enable the saved schedule only after the owner also confirms the timezone, selects the forum and tag, and completes the calendar and publication gates.

## Required production gates

Complete these gates outside this repository before the production schedule and automation cutover. A private staging preview can run with the Pi service gate enabled while the saved schedule stays off. Enable the Discord service gate only for a controlled private publication test. Apply only the prerequisites needed for that test.

1. Approve Exa source rights, cost, redaction, retention, and Zero Data Retention behavior. Record an explicit production policy for FinancialJuice, Barchart, ForexFactory, Yahoo, and TradingView. A source without permission must remain visibly unavailable, and no local scraper can bypass the decision. Run an opt-in live Search and Contents smoke test. Retain only safe request IDs, HTTPS sources, bounded highlights, statuses, and returned cost. Do not print or fingerprint the key.
2. Run the opt-in Financial Datasets evaluation command at the configured 08:00 instant on a regular market day. Record the configured local time and Eastern market time, access result, per-field support, citations, cost, latency, and independent price and prior-close comparison. If the account rejects `dataSources` because of Zero Data Retention, record `exa_connect_zdr_incompatible`. Do not change the account setting automatically. The owner must record `approved`, `partial`, or `rejected`.
3. Approve the implemented Financial Datasets adapter only for fields that the live evaluation proves. Verify every primary symbol's price, prior close, supported bars, timestamps, session labels, entitlement, delay, grounding, and conflict behavior on a regular market day. Keep the unsupported fields listed above unavailable. A mocked adapter test or a completed CLI process does not satisfy this gate.
4. Load a reviewed NYSE calendar snapshot from an approved official host. At enablement, it must be no more than 45 days old and cover the current date through December 31 of the next calendar year. Store the official URL, retrieval time, effective range, hash, version, and bounded daily sessions. Use an immutable owner override for an emergency closure.
5. Prove unattended composition readiness. Restart Pi before a staging run and confirm that the mounted Codex authentication works without an interactive login. Exercise authentication-required, provider-not-ready, timeout, bad-schema, and unknown-citation failures.
6. Grant the bot View Channel, Send Messages, Create Posts, Send Messages in Threads, Read Message History, and Attach Files when charts are enabled. Select a valid non-moderated required tag.
7. Run an isolated preview and a published edition in a private forum. Test Pi restart during research, Discord restart after partial replies, permission removal and restoration, rate limiting, ambiguous thread creation, duplicate reconciliation, mention suppression, chart fallback, and secret redaction. If charts are planned, enable both chart controls for this controlled private-forum acceptance run. Keep the saved schedule off until the run passes.
8. Observe a real scheduled 08:00 run. A preview, manual publication, or late-session run does not satisfy this gate. Confirm that premarket fields belong to the current session and that exactly one thread uses the scheduled edition key.
9. Accept three consecutive scheduled editions. Then inspect the existing **Market Research** automation by immutable ID and record its title, target, schedule, status, and prompt fingerprint. Pause it only after explicit owner approval. Do not delete it.

The Financial Datasets evaluation command and the scheduled adapter are separate paths. The evaluation command always returns an owner decision of `pending`; it cannot enable the adapter. The scheduled runner calls the adapter only when all runtime and frozen-preference gates match. Keep the evaluation report outside normal edition evidence until an owner completes the independent comparison and records a decision.

## Preview behavior before the data gate

A dry run always uses an `MRP-` preview ID in `marketResearchPreviews`. It does not create an edition, scheduled key, delivery row, or Discord thread.

The preview freezes the same preferences and calendar session as an edition. It enters its own fenced lease, dispatches through the dedicated Pi market-research registry, stores bounded preview evidence, and uses the same Pi runner and strict cross-service result schema. Convex compares its frozen date, timezone, label, session, symbol boards, source policy, and stored evidence hashes. Recovery can requeue an expired preview lease without entering the edition or publication tables.

On success, Convex stores a result fingerprint and a bounded quality summary. The summary includes the label, regime, retained evidence count, Search-slot count, primary coverage, setup count, and up to five short story lines. Convex validates and then discards delivery parts. It never makes them available to the Discord poller.

On failure, Convex stores only the safe failure and a short operator summary. When the provider gates do not match or supported grounded numerical fields are unavailable, the runner instead produces a visible `Data unavailable` operational edition with no setup scores or market conclusion. A completed degraded preview proves the isolated path and strict contract. It does not satisfy the licensed numerical-data gate.

Use **Run preview** for this path. Preview can initialize an unscheduled settings draft and run without a selected forum. It still requires the Pi service gate, Exa credential, reviewed calendar, and any selected provider's matching runtime gates. Use **Publish now** only after the forum and all data gates pass. **Cancel queued edition** never cancels a running preview or edition. **Retry edition** preserves the existing edition and durable evidence. **Reconcile forum thread** searches external Discord state and cannot create a second starter.

## Calendar operations

Use the owner-authenticated Convex functions `market_research:saveSessionCalendar`, `market_research:listSessionCalendars`, and `market_research:saveSessionOverride` through an approved operator client.

Calendar writes reject duplicate dates, invalid time fields, private or credential-bearing URLs, oversized snapshots, invalid effective ranges, and a reused version with a different hash. Overrides are immutable. Their stable ID binds the owner, calendar, date, status, reason, source, and effective interval.

Schedule enablement requires a reviewed calendar from an approved official host. It must have been retrieved within the prior 45 days and cover the current date through the end of the next calendar year. Runtime resolution also requires the edition date to remain inside the reviewed effective range. If any runtime requirement fails, Convex freezes `UNKNOWN` with the `Data unavailable` label instead of inferring a session from missing quotes.

Convex applies a matching immutable owner override before it freezes the session. It also freezes the previous and next open session dates, calendar version, edition date, configured timezone, and schedule instant. Weekend, holiday, late, and ordinary labels come from this frozen context. Pi can report a provider conflict, but it cannot replace the frozen session. A provider-calendar session conflict removes market conclusions and remains visible in data quality.

## Recovery and reconciliation

Research and publication use separate generations, tokens, and leases. A stale worker cannot store evidence, complete composition, adopt a thread, or acknowledge a message.

Pi persists paid Exa work incrementally before market-data work and composition. Each completed required Search slot has a deterministic `exa-search-slot-*` marker stored with its bounded results. Each selected Contents URL has an `exa-contents-url-*` marker stored with either its bounded content evidence or explicit unavailable outcome. Recovery loads those records, skips completed units, and requests only missing paid work. It does not clear a valid partial checkpoint.

Policy-resolved source slots remain visible statuses and do not call Exa. The final `exa-collection-complete` marker means every provider-executed required Search slot and every selected Contents URL has a durable outcome. Convex rejects composition without this marker. The 30-second heartbeat keeps the two-minute lease live during provider and model calls. A hard job runtime limit aborts overdue work instead of accepting a late result. It returns retryable `composition_timeout` when no paid Exa request is in flight. It returns terminal `exa_budget_exhausted` when a non-cancelable paid SDK request can have an unknown charge.

Each recovery mutation scans at most 25 total research editions, previews, and publication deliveries with composite status-and-time indexes. The action runs at most four batches and schedules a bounded continuation when work remains. Automatic edition recovery excludes terminal, partial, and operator-required ambiguous editions.

If Discord creation is uncertain, the publisher searches recent active and archived forum threads. It matches the bot author, visible edition marker, and exact content hash. One match is adopted. When no match is visible and no thread ID is stored, the owner-only **Reconcile forum thread** control performs another search and cannot create another starter. Multiple matches retain the earliest known thread or reply identifier for audit, record `duplicate_publication_incident`, stop automatic publishing with `discord_thread_reconcile_ambiguous`, and do not create another starter. A duplicate incident requires direct forum inspection and an explicit owner remediation decision; it does not re-enter automatic publication.

Discord rate-limit failures preserve a bounded `Retry-After` delay. Text publication continues when an optional chart is unavailable.

## Strict Convex acceptance boundary

Pi output is untrusted until Convex accepts it. Convex parses a complete strict result schema with bounded identifiers, strings, arrays, timestamps, scores, sections, charts, and delivery parts. Unknown fields and oversized results fail closed.

Convex then compares the result with durable state. It requires:

- the current research generation, claim token, and dispatch ID;
- the frozen edition date, timezone, label, session, calendar, and source-policy context;
- exact primary, sector, and discovery symbol boards;
- configured setup, section, chart, and durable-thesis rules;
- research-only language and `noTradingAction: true`;
- stored evidence IDs and matching content hashes;
- the complete Exa marker, Search-slot count, and retained Exa cost;
- valid citation, conflict, requested-source, and chart evidence references;
- contiguous section and delivery sequences;
- exact delivery IDs, idempotency keys, starter marker, chart placement, and content hashes.

Only then does Convex create immutable section and delivery records. A replay with the same canonical result fingerprint is idempotent. A different result for an accepted attempt is rejected.

Preview acceptance uses the same strict result schema with preview-specific frozen identity and durable-evidence checks. It stores a summary and fingerprint only. It never materializes section or delivery rows.

## Charts

The newspaper reuses the trusted in-process `ChartImgClient`. Pi can request at most three charts with an edition ID, section ID, timeframe, time range, session, data-as-of time, and evidence IDs. Convex verifies those IDs against stored edition evidence before it attaches a request to a delivery part.

The Discord service maps only an explicit supported-symbol allowlist to provider symbols. `ChartImgClient` validates the PNG media type, 8 MiB byte cap, and dimensions. It never sends an arbitrary remote image URL to Discord. A timeout, unsupported symbol, provider failure, malformed PNG, or oversized PNG produces complete text without an attachment.

Chart delivery needs both the Discord runtime gate `MARKET_RESEARCH_CHARTS_ENABLED=true` and the per-server **Include optional chart images** setting. The selected forum must grant Attach Files. The saved maximum stays between zero and three. Convex rejects chart requests when the frozen server settings do not include charts or when the request exceeds that maximum.

A direct CHART-IMG PNG probe proves only provider transport and image parsing. It does not prove Discord attachment permissions, forum routing, fallback behavior, or an end-to-end private-forum delivery. Complete that acceptance run before relying on images. Text remains the authoritative delivery and continues when an image fails.

## Retention

Previews expire after seven days. Evidence records expire after 90 days only when their edition is terminal. The bounded daily mutation defers evidence for an active edition.

Retention does not delete edition records, final section summaries, forum thread IDs, starter IDs, part content hashes, delivery acknowledgements, or audit events.

## Observability and operator evidence

Use Convex as the durable operational record. Edition rows expose the current status and stage, scheduled and start times, research and publication generations, lease expiries, attempts, Search count, accepted evidence-derived Exa cost, separately observed Exa cost, cost-event and unknown-cost counts, source counts, expected and sent part counts, safe failure, and Discord identifiers. Preview rows expose status, stage, safe failure, expiry, result fingerprint, the bounded quality summary, and the same observed-cost counters.

`marketResearchCostBindings` stores the immutable accounting capability as a token hash. `marketResearchCostEvents` stores bounded, deduplicated operation, outcome, cost, late-settlement, time, and optional safe provider-request identifiers. It does not store raw provider payloads. Compare the observed-cost totals with the evidence-derived accepted cost and external provider billing. An unknown-cost count is a review requirement, not a zero-dollar charge.

`marketResearchEvents` records safe enqueue, claim, skip, retry, cancellation, composition acceptance, publication acknowledgement, partial or failed publication, reconciliation, duplicate incident, and completion transitions. Event details contain bounded IDs, sequence values, stage, and safe codes. They do not contain prompts, article bodies, evidence packets, edition bodies, authorization data, or secrets.

Pi logs one safe completion or failure event with edition ID, generation, safe failure, and bounded counts. Discord logs poll and chart-degradation failures with fixed codes. The web control shows the latest edition date, status, stage, accepted and total source counts, Exa cost, safe failure, and forum link. It also shows the latest preview status and bounded quality summary. Health shows only fixed readiness booleans.

Before production enablement, add the deployment-level alerts required by the specification. Alert on a missing scheduled run, missed publication deadline, authentication failure, invalid forum configuration, consecutive failures, a partial edition, zero usable evidence, and any duplicate incident. Repository state and safe logs do not by themselves prove those external alerts are installed. Capture stage-duration, freshness, domain-diversity, ticker-coverage, retry, and provider-latency evidence during staging even when the current control page does not display every metric.

## Safe operator failures

The control page shows only fixed safe codes. A retryable research or composition failure enters `retry_wait` with bounded jittered delays. A terminal configuration, authentication, rights, calendar, evidence, or contract failure enters `failed` and waits for an operator state change. Publication stays `publishing_replies` during active delivery, enters `retry_wait` while automatic retries remain, and becomes `partial` only when a starter exists and required replies remain after the retry cap. `skipped_late`, `cancelled`, `failed`, `partial`, and ambiguous reconciliation do not recover as new editions automatically.

Common operator actions are:

| Code | Action |
| --- | --- |
| `market_research_disabled` | Keep the request stopped. Review and change the intended service flag only after all gates pass. |
| `forum_not_configured` | Save a valid independent forum route and tag selection. |
| `edition_already_exists` | Use the existing stable edition. Request an explicit regeneration only for a published base edition. |
| `edition_lease_lost` | Discard the stale worker result. Let the fenced recovery path claim a new generation. |
| `market_data_not_configured` | Keep the schedule disabled. Complete the licensed-provider gate. |
| `market_data_stale`, `market_data_conflict`, or `market_data_unavailable` | Inspect timestamps, session labels, entitlement, and provider health. Do not infer or average a replacement value. |
| `market_session_calendar_stale` | Load and review the required official calendar range. |
| `session_unknown` | Repair the reviewed calendar or immutable override. Do not infer the session from quotes. |
| `exa_not_configured` or `exa_auth_failed` | Repair the Pi-only secret. Do not print it. |
| `exa_budget_exhausted` | Review the returned edition cost and approved ceiling before changing the cap. |
| `exa_rate_limited` or `exa_unavailable` | Wait for the stored bounded retry. Do not start a parallel run. |
| `exa_invalid_request` | Repair the reviewed request contract. Do not retry unchanged input. |
| `exa_connect_zdr_incompatible` | Record the evaluation as partial or rejected. Do not change ZDR automatically. |
| `source_rights_blocked` or `source_unavailable` | Keep the source visibly unavailable. Do not scrape around a policy or robots decision. |
| `evidence_below_minimum` | Publish no market conclusion. Repair source coverage or retain a `Data unavailable` operational edition. |
| `composition_auth_required` or `composition_provider_not_ready` | Repair unattended Pi authentication and verify it after restart. |
| `composition_timeout` | Allow the bounded retry. Inspect provider latency before a manual retry. |
| `composition_schema_invalid` or `composition_citation_invalid` | Treat the output as rejected. Fix the contract or composer before retry. |
| `forum_wrong_channel_type` or `forum_permissions_incomplete` | Repair the selected forum, tag, or bot permissions. |
| `discord_thread_create_failed` or `discord_thread_reconcile_failed` | Restore Discord state, then retry or use the owner reconciliation control as directed. |
| `discord_rate_limited`                                                    | Wait for the stored retry time. Do not run a second publisher.                                                     |
| `discord_thread_reconcile_ambiguous`                                      | Inspect the private forum. If no thread ID is stored, use the owner reconciliation control. Treat a recorded duplicate incident as an explicit remediation case. |
| `discord_reply_failed` or `discord_permission_failed`                     | Restore delivery access. Retry from the first missing immutable part.                                              |
| `chart_unavailable` or `chart_artifact_expired` | Accept complete text or rerun chart acceptance. Do not block or change market facts. |
| `late_cutoff_exceeded` | Keep the skipped result auditable. Use an explicit manual rerun or regeneration if required. |
| `partial` | Restore Discord access, then use **Retry edition**. The next claim starts at the first missing reply. |

## Validation

From the repository root, run:

```sh
npm run check
git diff --check
railway config plan
```

Review the Railway plan only. Do not run `railway config apply` as part of repository validation.
