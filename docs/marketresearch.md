# Market Research Morning Newspaper

Status: implementation specification
Owner: Project Trishula
Last reviewed: 2026-08-31
Proposed schedule: every day at 08:00 in an owner-confirmed IANA timezone
Default delivery: one Discord forum post with ordered replies

## 1. Outcome

Build a scheduled, evidence-backed morning market newspaper for the configured Discord server.

The system must:

- Run every day at 08:00 in the owner-confirmed IANA timezone.
- Work without a Discord message or an active conversational session.
- Research current news with Exa.
- Gather numerical market evidence from an approved structured-data provider.
- Produce one personalized edition from durable preferences.
- Create one post in a configured Discord forum channel.
- Put the main conclusion in the forum starter message.
- Post every remaining section as ordered replies in the same forum thread.
- Continue until the complete edition is delivered. Do not silently truncate it.
- Add chart images only when the separate chart-image integration returns a useful artifact.
- Preserve exact sources, timestamps, freshness, data-quality limitations, and publishing state.
- Recover from restarts and partial Discord delivery without creating duplicate daily editions.
- Remain research-only. It must not read a brokerage account, place an order, change an order, or modify a watchlist.

This feature is a scheduled publishing pipeline. It is not an extension of the conversational Discord loop.

## 2. Fixed architectural decisions

1. **Use Exa instead of OpenAI-hosted web search.** Call Exa Search and Contents directly from the Pi service.
2. **Keep this path separate from conversational Pi tooling.** Do not add Exa to `public_web_search`, the current Discord research profile, or its active-tool allowlist.
3. **Use Convex as the durable source of truth.** Convex owns schedules, preferences, edition state, leases, evidence metadata, delivery chunks, Discord identifiers, and retry state.
4. **Use Convex to schedule and dispatch research. Use the Discord service only for publication.** Convex already dispatches durable work to actor-bound Pi services. Discord already owns the bot token and live client.
5. **Use Pi for retrieval orchestration and composition.** A morning-paper run has no chat history. It receives a versioned request and returns a strict, versioned edition.
6. **Keep the current Railway service boundaries.** Add modules to `apps/convex`, `apps/pi`, `apps/discord`, and `apps/web`. Do not create a new Railway service for the first release.
7. **Use a Discord forum channel only.** The third channel selector must reject text, announcement, voice, and thread channels.
8. **Treat chart generation as optional output.** It must never provide market facts and must never block text publication.
9. **Do not treat web pages as an exchange-grade quote feed.** Exa finds and extracts editorial evidence. A structured provider supplies prices, bars, spreads, volume, and calculated technicals.
10. **Publish limitations instead of filling gaps.** Missing, stale, delayed, rights-blocked, or conflicting evidence must remain visible.
11. **Require the owner to confirm the schedule timezone before enablement.** `America/New_York` is the proposed market-time default. `America/Puerto_Rico` is also displayed and has different daylight-saving behavior.

## 3. Plaintext Exa credential

The project owner explicitly requested that the supplied API key remain in this document.

```text
EXA_API_KEY (already as a variable in the pi deployment in railway)
```

This is a plaintext production-sensitive credential. The runtime must still read `EXA_API_KEY` from a Pi Railway secret. It must not parse this Markdown file at runtime.

Security consequences:

- Anyone who can read this repository or its history can use the key.
- If this file is pushed to any remote, copied into an issue, or included in a log bundle, treat the key as exposed.
- Never copy the key into Convex, Discord, a browser variable, a model prompt, an HTTP response, a health payload, a source record, or a log field.
- Add `EXA_API_KEY: preserve()` to the Pi service in `.railway/railway.ts`. Do not place the literal value in Railway infrastructure code.
- Configure the literal value directly in Railway's secret store.
- When the owner rotates the key, update both Railway and this owner-requested credential block.

## 4. Existing system baseline

### 4.1 Current service boundaries

- `apps/convex` owns durable state, leases, idempotent outbox records, and schedules.
- `apps/discord` owns `DISCORD_BOT_TOKEN`, the Gateway connection, channel discovery, polling, and Discord delivery.
- `apps/pi` owns Codex OAuth, isolated model sessions, public research tools, and asynchronous Discord agent jobs.
- `apps/web` owns the authenticated Discord control page.

The target design must preserve those boundaries. See `docs/ARCHITECTURE.md` and `docs/DEPLOYMENT.md`.

### 4.2 Current conversational research path

The current path is message-driven:

1. Discord ingests a human message.
2. Convex claims a fenced channel loop.
3. Pi triages the message.
4. Pi may run the `research` profile.
5. Pi drafts a short reply.
6. Convex queues a normal-channel outbox message.
7. The Discord service sends it.

Relevant files:

- `apps/pi/src/discord/runner.ts`
- `apps/pi/src/discord/public-web.ts`
- `apps/pi/src/discord/jobs.ts`
- `apps/discord/src/orchestrator/channel-loop.ts`
- `apps/discord/src/outbox/dispatcher.ts`
- `apps/convex/convex/discord.ts`
- `apps/convex/convex/schema.ts`

The morning newspaper must not enter this loop. It has no source Discord message, reply target, conversation context, acknowledgement stage, or autonomous recheck.

### 4.3 What powered the prior Market Research reports

The prior reports did not obtain every result through web research.

- Yahoo Finance chart JSON supplied most historical and intraday bars.
- Local calculations produced premarket ranges, VWAP, moving averages, ATR, slopes, prior levels, and timeframe aggregates.
- Nasdaq extended-trading JSON supplied some premarket share volume, high, low, last, bid, and ask fields.
- Web research and official pages supplied catalysts, filings, news, earnings context, and calendars.
- TradingView, FinancialJuice, Barchart, and ForexFactory did not supply the observed numerical reports.

This explains the quality of the old output. The new implementation must preserve the two-part model:

1. deterministic numerical evidence; and
2. cited news and catalyst research.

Do not present Exa as the source of a price, spread, premarket volume, or calculated level unless the exact Exa-connected structured provider returned that value with a usable timestamp and session label.

## 5. Scope

### 5.1 In scope

- One enabled morning-paper configuration per owner and Discord guild.
- A third Discord route called **Morning newspaper forum**.
- A daily, daylight-saving-aware 08:00 market-time schedule.
- An owner-authenticated manual run for verification and recovery.
- Exa Search and Contents integration.
- Optional evaluation of Exa Connect with the `financial_datasets` provider.
- A normalized evidence store.
- A deterministic market-calculation layer when approved bars are available.
- A strict morning-paper composition contract.
- Semantic Discord chunking.
- Forum thread creation and reply delivery.
- Partial-delivery recovery and duplicate prevention.
- Optional chart-image attachment integration.
- Source, freshness, cost, duration, and failure observability.
- A controlled migration from the existing Codex automation.

### 5.2 Out of scope

- Brokerage access of any kind.
- Order creation, approval, modification, cancellation, or submission.
- Direct use of a Robinhood tool or stored position data.
- A general Exa tool for ordinary Discord conversations.
- Replacing the current conversation and research-log channel behavior.
- Scraping a site after it blocks Exa or denies automated access.
- Treating TradingView charts or chart-img output as input data.
- Republishing full articles, long extracted passages, or paywalled content.
- Automatically enabling a publisher or exchange source before its permitted use is documented.
- Deleting the existing Codex automation during implementation.

## 6. Target architecture

```text
Convex scheduler or owner manual trigger
                    |
                    v
        marketResearchEditions
     queued + durable edition key
                    |
          Convex dispatch action
     POST dedicated private Pi job
                    |
                    v
         Pi MarketResearchRunner
      +--------------------------+
      | Exa Search and Contents  |
      | Structured market data   |
      | Deterministic analytics  |
      | Evidence validation      |
      | Tool-free composition    |
      +--------------------------+
                    |
     evidence checkpoints + EditionV1
                    |
                    v
       Convex stores sections and
       forum delivery work items
                    |
                    v
         Discord service poller
      claims publication deliveries
                    |
                    v
       DiscordForumPublisher
      +--------------------------+
      | Create forum starter     |
      | Save thread/message IDs  |
      | Send ordered replies     |
      | Attach optional charts   |
      | Resume missing replies   |
      +--------------------------+
                    |
                    v
               published
```

### 6.1 Convex responsibilities

Convex must:

- Store the active configuration and a snapshot used by each edition.
- Decide when an edition is due.
- Create one stable scheduled edition key for each schedule and local market date.
- Snapshot mutable forum, settings, source-policy, and prompt versions as edition metadata. Do not put them in the scheduled uniqueness key.
- Reject duplicate creation in one mutation.
- Dispatch due research through the existing actor-bound private Pi service boundary.
- Lease research and publication phases independently when their workers differ.
- Fence stale workers with a generation and claim token.
- Store bounded normalized evidence, not unrestricted page copies.
- Store the final edition and its semantic chunks.
- Store the Discord forum thread ID and starter message ID.
- Store each reply's sequence, status, nonce, Discord message ID, attempts, and error.
- Make retries resumable.
- Keep schedule and publishing state across all service restarts.

### 6.2 Pi responsibilities

Pi must:

- Validate the versioned request.
- Read `EXA_API_KEY` only from its process environment.
- Search and retrieve current evidence from Exa.
- Call a configured structured-data provider through a separate adapter.
- Calculate indicators only from retained, timestamped bars.
- Reject unknown source IDs in model output.
- Create one isolated, stateless composition session with no tools.
- Persist bounded evidence checkpoints and a strict `MorningPaperEditionV1` result through service-authenticated Convex operations.
- Never receive the Discord bot token.
- Never send to Discord directly.
- Never access brokerage tools from this runner.

### 6.3 Discord service responsibilities

The Discord service must:

- Poll only for ready or retryable publication work.
- Claim a fenced publication lease.
- Create a post with `ForumChannel.threads.create(...)`.
- Send replies to the returned forum thread.
- Reconcile a thread when Discord succeeded but the Convex acknowledgement failed.
- Respect Discord retry delays and rate limits.
- Never call Exa or receive `EXA_API_KEY`.

### 6.4 Web responsibilities

The web control page must:

- Show a third route named **Morning newspaper forum**.
- List only channels whose synchronized type is `forum` for that route.
- Show missing bot permissions before save.
- Configure enabled state, schedule timezone, hour, forum tags, and personalization.
- Offer an owner-authenticated **Run test edition** action.
- Show the last run, current stage, publication link, and safe failure code.
- Never receive or display the Exa key.

### 6.5 Private job and result flow

Use the same durable dispatch shape as the existing Convex-to-Pi execution path, but use separate contracts and routes.

Suggested private Pi routes:

```text
POST   /market-research/jobs
GET    /market-research/jobs/:jobId
DELETE /market-research/jobs/:jobId
```

Suggested Pi-to-Convex service operations:

```text
marketResearchHeartbeat
appendMarketResearchEvidence
completeMarketResearchComposition
failMarketResearchRun
```

Rules:

- Convex dispatches `POST /market-research/jobs` with `SERVICE_SHARED_SECRET` through the existing actor-bound private service URL logic.
- The Pi route returns `202` quickly. Do not hold one HTTP request open through the full research run.
- `editionId` remains stable across recovery. Each fenced research attempt uses `dispatchId = <editionId>:research:<generation>`.
- Reusing a `dispatchId` with identical input returns that attempt's current job state. Changed input returns a conflict.
- Lease recovery increments `generation` and creates a new `dispatchId`. It must not remain bound to an in-memory failed job from an expired generation.
- Pi writes evidence checkpoints and the final validated edition back to Convex with the current lease generation and token.
- If Pi restarts, the in-memory job can disappear. Convex retains the run and saved evidence, expires the lease, and redispatches the same edition from its last durable stage.
- The Discord service does not call the Pi research endpoint. It begins only after Convex has immutable publication parts.
- The dedicated runner must not use `DiscordAgentJobRegistry`, `ChannelLoopOrchestrator`, `discordLoopRuns`, or the conversational `discordOutbox`.

### 6.6 Recovery sweeper

Add a separate minutely Convex recovery cron. Its internal mutation scans indexed work with expired research leases, expired publication leases, or `retry_wait.nextAttemptAt <= now`.

Rules:

- Claim no more than 25 records in one mutation, ordered by due time and stable ID.
- Atomically increment the generation, assign a new token, record the resume stage, and return a bounded dispatch batch.
- Let a Convex action perform Pi network dispatch. Keep external I/O outside mutations.
- Use a continuation cursor. Process no more than four batches in one action invocation. Schedule another continuation when more work remains.
- Do not recover `failed`, `cancelled`, `published`, `skipped_late`, or operator-required ambiguous starter records automatically.
- Apply the same sweep to publication leases, but let the Discord poller claim the recovered publication item.
- Reuse saved evidence and immutable delivery parts. Never create a new edition as recovery.
- Record scanned, recovered, deferred, and rejected counts so a stuck queue is visible.

## 7. Exa integration

Use the official `exa-js` package in `apps/pi`. Pin the exact reviewed version in `apps/pi/package.json` and `apps/pi/package-lock.json`.

Official references:

- [Search API](https://exa.ai/docs/reference/search-api-guide-for-coding-agents)
- [Contents API](https://exa.ai/docs/reference/contents-api-guide-for-coding-agents)
- [JavaScript SDK](https://exa.ai/docs/sdks/javascript-sdk)
- [News Search](https://exa.ai/docs/reference/verticals/news-for-coding-agents)
- [Rate limits](https://exa.ai/docs/reference/rate-limits)
- [Error codes](https://exa.ai/docs/reference/error-codes)
- [Pricing](https://exa.ai/docs/reference/pricing)
- [Exa Connect Financial Datasets](https://exa.ai/docs/reference/agent-api/connect/financialdatasets)

### 7.1 Client boundary

Add a dedicated module under `apps/pi/src/market-research/`.

Suggested files:

```text
apps/pi/src/market-research/
  contracts.ts
  exa-client.ts
  exa-errors.ts
  research-plan.ts
  source-normalizer.ts
  source-policy.ts
  market-data.ts
  analytics.ts
  composer.ts
  runner.ts
```

`ExaClient` must expose application-level operations instead of the raw SDK:

```text
searchNews(request) -> SearchEvidenceBatch
getSelectedContents(request) -> ContentEvidenceBatch
runFinancialDatasetEvaluation(request) -> StructuredMarketEvidence
```

This boundary owns authentication, timeouts, concurrency, request budgets, retries, provider-error mapping, result limits, URL normalization, provenance, cost collection, and safe logging.

Exa HTTP contract:

```text
POST https://api.exa.ai/search
POST https://api.exa.ai/contents
POST https://api.exa.ai/agent/runs       # evaluation-only Exa Connect path
Authorization: Bearer <EXA_API_KEY>
Content-Type: application/json
```

Use the fixed `https://api.exa.ai` origin in production. Do not accept an environment-provided alternate origin except in tests with an injected transport.

Persist these Search response fields when present:

- `requestId`;
- `resolvedSearchType`;
- `searchTime`;
- `costDollars.total` and its component costs;
- `results[].id`;
- `results[].title`;
- `results[].url`;
- `results[].publishedDate`;
- `results[].author`;
- bounded `results[].highlights`;
- content freshness or retrieval status; and
- `output.grounding[]` citations and confidence when structured Exa synthesis is evaluated.

Persist per-URL Contents status. One failed URL must not discard successful URLs from the same request.

### 7.2 Authentication and configuration

Add these Pi variables:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `EXA_API_KEY` | When enabled | none | Server-only Exa credential. |
| `MARKET_RESEARCH_ENABLED` | No | `false` | Fails closed until configured. |
| `EXA_SEARCH_CONCURRENCY` | No | `2` | Concurrent Search calls. |
| `EXA_CONTENTS_CONCURRENCY` | No | `5` | Concurrent Contents URLs. |
| `EXA_REQUEST_TIMEOUT_MS` | No | `20000` | Per-request timeout. |
| `EXA_MAX_SEARCH_REQUESTS_PER_EDITION` | No | `12` | Hard Search budget for the default boards. |
| `EXA_MAX_CONTENT_PAGES_PER_EDITION` | No | `24` | Hard Contents page budget. |
| `EXA_MAX_COST_USD_PER_EDITION` | No | owner-defined | Optional-call cost cap. |

Rules:

- If `MARKET_RESEARCH_ENABLED=true`, Pi startup must require `EXA_API_KEY`.
- If disabled, the rest of Pi must start without the key.
- Health may report `exaConfigured: true|false`. It must not report a key prefix, suffix, length, hash, or fingerprint.
- Errors must use fixed codes. They must not include response headers or request objects.

### 7.3 Search defaults and date windows

Use `exa.search(...)` with these defaults:

```text
type: "auto"
category: "news" for editorial news
userLocation: "US"
numResults: 8 to 15
contents.highlights: true
contents.maxAgeHours: 1
contents.livecrawlTimeout: 12000
moderation: true
```

Use publication filters for recent news:

- Tuesday through Friday: at least the previous 36 hours.
- Monday or the first session after a holiday: from the prior market close, up to 96 hours.
- Weekend: material news since the prior Friday close and next-session catalysts.
- Official calendar: today through at least the next five calendar days.

Treat Exa `publishedDate` as estimated. Store it separately from `retrievedAt`.

Supported integration fields used by this plan:

- `query`: required natural-language query.
- `type`: `auto` by default; do not use deep modes without an explicit cost and latency decision.
- `numResults`: 1-100; this plan uses the lower limits in section 7.4.
- `category`: `news` for editorial packs and `financial report` only for deliberate filing research.
- `includeDomains` and `excludeDomains`: domain or path-prefix controls, with Exa's documented maximum of 1,200 entries.
- `startPublishedDate` and `endPublishedDate`: ISO-8601 publication filters.
- `userLocation`: `US`.
- `contents`: nested Search content settings.
- `systemPrompt` and `outputSchema`: optional Exa synthesis controls. They do not replace the final Pi schema validation.

Do not use deprecated or incorrect fields such as `useAutoprompt`, `includeUrls`, `excludeUrls`, top-level Search `text`, top-level Search `highlights`, top-level Search `summary`, or `livecrawl: "always"`. Use `contents.maxAgeHours: 0` only when a forced live crawl is justified.

### 7.4 Search query packs

Run bounded query packs. Do not submit one giant query and assume full coverage.

The default plan reserves exactly 12 Search slots and uses no more than 12 API calls. It combines macro and cross-asset coverage so that every primary ticker and each requested source has a required slot within the hard budget.

| Slots | Pack | Required coverage | Result limit |
| ---: | --- | --- | ---: |
| 1 | `overnight_macro_cross_asset` | Central banks, inflation, labor, fiscal policy, geopolitics, Asia, Europe, Treasury yields, dollar, crude, natural gas, gold, and supply events. | 15 |
| 1 | `us_index_sector` | SPY, QQQ, DIA, IWM, VIX, breadth, sectors, SMH, and SOXX. | 12 |
| 2 | `primary_board_news` | Material news for every primary ticker, in groups of no more than five symbols. | 10 per group |
| 1 | `discovery_movers` | Attributable catalysts for liquid U.S. movers. | 15 |
| 1 | `official_calendar` | Fed, BLS, BEA, Treasury, EIA, SEC, exchange, and company IR. | 12 |
| 1 | `earnings_corporate_actions` | Earnings, guidance, dividends, splits, offerings, and filings. | 12 |
| 5 | `requested_source_<source>` | One domain-constrained status and permitted-material search for each of FinancialJuice, Barchart, ForexFactory, Yahoo, and TradingView. | 5 per source |

Planner rules:

- Mark all 12 default slots as required. Contents retrieval does not consume this Search-call budget.
- When policy blocks a requested source, resolve its slot locally to the required unavailable status. Do not call Exa and do not reallocate that slot to optional research.
- Cap the default `primarySymbols` list at 10 so two calls cover it without omission.
- If the owner increases the primary-symbol cap or enables another required pack, require a matching explicit search-budget increase before save.
- Reject an impossible configuration before enqueue. Do not omit a primary ticker or requested-source status to fit the budget.
- Stop optional follow-up queries first. Never consume a required call budget with an optional query.
- Unit-test the exact slot plan, policy-resolved slots, and maximum API-call total before any provider call begins.

Record query ID and version, query text, domain filters, date filters, start and finish times, Exa request ID, result count, cost, retry count, and status.

### 7.5 Contents retrieval

Use `exa.getContents(...)` only for URLs selected from Search or an approved official-domain list.

Defaults:

```text
highlights.query: "market-moving facts, named assets, exact dates, official actions, guidance, risks, and quantified claims"
maxAgeHours: 1
livecrawlTimeout: 12000
text.maxCharacters: 12000 only when full text is required
```

Rules:

- Prefer highlights over full text.
- Keep at most 2,000 normalized highlight characters per retained source unless tests justify more.
- Do not persist an article's full body after composition.
- Persist per-URL success and failure status.
- Treat robots denial as final for that source.
- Do not fall back to a local scraper after denial.
- Do not send private, local, link-local, or credential-bearing URLs to Exa.

### 7.6 Exa error policy

Classify an Exa error by its documented error `tag` before using the HTTP status as a fallback. Preserve only the safe tag and request ID.

| Condition | Classification | Action |
| --- | --- | --- |
| HTTP 400 | terminal request configuration | Fail the query pack. Do not retry without a configuration change. |
| HTTP 422 or `FETCH_DOCUMENT_ERROR` | per-URL processing failure when identifiable | Fail only the affected URL. Keep successful URLs. Fail the pack only when the response cannot identify an affected item or minimum coverage fails. |
| HTTP 401 | terminal authentication | Stop Exa work. Record `exa_auth_failed`. |
| HTTP 402 | terminal budget | Stop Exa work. Record `exa_budget_exhausted`. |
| HTTP 403 with `ACCESS_DENIED` or `FEATURE_DISABLED` | terminal capability or configuration | Stop the affected capability until access or configuration changes. |
| HTTP 403 with `ROBOTS_FILTER_FAILED` | final batch Contents denial | Mark the denied batch unavailable. Never bypass. |
| HTTP 403 with `SOURCE_NOT_AVAILABLE` | final per-URL source failure | Mark only the affected URL unavailable. |
| Other HTTP 403 | unknown restriction | Stop the affected request and surface a safe operator action. Do not assume it is skippable. |
| HTTP 429 | retryable rate limit | Honor `Retry-After`, then bounded exponential backoff with jitter. |
| HTTP 500-599 | retryable provider | Retry no more than three times. |
| timeout or reset | retryable transport | Retry no more than two times. |
| `CRAWL_LIVECRAWL_TIMEOUT` | partial source failure | Retry once with cached fallback, then mark stale or unavailable. |

### 7.7 Rate and cost controls

Exa currently documents 10 QPS for `/search` and 100 QPS for `/contents`. This job must remain below those limits.

- Use no more than two concurrent Search calls.
- Use no more than five concurrent Contents fetches.
- Stop optional research when the edition cost cap is reached.
- Preserve official-calendar and primary-board work before optional enrichment.
- Store `costDollars.total` by request and edition when returned.
- Deduplicate URLs before Contents calls.
- Cache successful query results inside the edition so a retry does not repeat paid searches.

## 8. Source policy and requested providers

Exa makes a page discoverable. It does not grant permission to collect, process, or redistribute that page.

Each source adapter has one policy state:

```text
approved
evaluation_only
permission_required
blocked
unavailable
```

Every edition includes a requested-source status block. It states whether each requested provider contributed evidence, had no material item, was unavailable, or was disabled by policy.

### 8.1 Provider matrix

| Provider | Intended use | Production rule |
| --- | --- | --- |
| Exa Search and Contents | News discovery, current page evidence, citations. | Enable after key, cost, redaction, and retention tests pass. |
| Exa Connect `financial_datasets` | Evaluate price snapshots, daily history, fundamentals, earnings, filings, and news. | Evaluation only until an 08:00 test proves fields, timestamps, session semantics, and access. |
| Barchart OnDemand | Candidate quote, history, technical, options, and leaders feed. | Permission required. Confirm private Discord and AI-derived output are permitted. |
| FinancialJuice | Requested news context. | Permission required for automated collection, aggregation, or republication. |
| ForexFactory | Requested economic-calendar context. | Permission required. Prefer first-party calendars without written approval. |
| Yahoo Finance | Human-facing link and evaluation reference. | Do not call undocumented endpoints in production without permission. |
| Nasdaq | Evaluation reference. | Do not call undocumented JSON endpoints in production without permission. |
| TradingView | Optional human deep link and chart context. | Do not use as a backend quote, indicator, or non-display API. |
| Fed, BLS, BEA, Treasury, EIA, SEC, exchanges, and company IR | Primary policy, filing, calendar, and corporate evidence. | Preferred when public use permits. |

Production source gate:

- Do not claim that a requested provider contributed data until its policy state is `approved` and retained evidence proves the contribution.
- Until permission or a licensed API is configured, show that provider as `Unavailable - source access or permission not configured` in every edition.
- Official or licensed alternatives can support the same market fact, but attribution must name the actual source. Do not label substituted evidence as FinancialJuice, Barchart, ForexFactory, Yahoo, or TradingView data.
- The current undocumented Yahoo and Nasdaq JSON behavior is implementation history, not production authorization.

References:

- [Barchart OnDemand](https://www.barchart.com/ondemand/api)
- [Barchart terms](https://www.barchart.com/terms)
- [FinancialJuice terms](https://www.financialjuice.com/tos.aspx)
- [ForexFactory notices](https://www.forexfactory.com/notices)
- [Yahoo terms](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html)
- [Nasdaq legal terms](https://www.nasdaq.com/legal)
- [TradingView API statement](https://www.tradingview.com/support/solutions/43000474413-i-need-access-to-your-api-in-order-to-get-data-or-indicator-values/)
- [TradingView policies](https://www.tradingview.com/policies/)

### 8.2 Requested-source behavior

For FinancialJuice, Barchart, ForexFactory, Yahoo Finance, and TradingView:

1. Run a source-specific Exa query only when policy permits it.
2. Keep the source URL and Exa retrieval metadata.
3. Paraphrase. Do not copy a feed or article body.
4. Do not turn a visible page into a numerical market-data API.
5. If no permitted evidence is available, state `Unavailable - source access or permission not configured`.
6. Do not silently substitute another provider while labeling it as the requested provider.

### 8.3 Primary-source order

Use this priority:

1. Official regulator, agency, exchange, filing, or company IR source.
2. Licensed structured market-data provider.
3. Named reputable financial newsroom.
4. Requested editorial provider with permitted use.
5. Secondary analysis with clear author and date.

Reject anonymous promotional pages, copied releases without attribution, affiliate pages, unexplained social posts, and conflicts without a resolvable primary source.

## 9. Numerical market-data strategy

Exa Search is not the numerical tape.

Create a `MarketDataProvider` interface in Pi:

```text
getSessionStatus(date, timezone)
getSnapshots(symbols)
getBars(symbol, interval, start, end, includeExtendedHours)
getCorporateActions(symbol, start, end)
getMarketMovers(filters)
```

Each returned field must include provider, symbol, value, unit, provider timestamp, retrieval timestamp, market-session label, delayed or real-time status, policy status, and enough raw-field provenance to reproduce calculations.

### 9.1 Exa Connect evaluation gate

Evaluate Exa Agent with `dataSources: [{ provider: "financial_datasets" }]` before buying another feed.

Exa documents an account-policy constraint for Agent runs that use `dataSources`: the request is incompatible with Zero Data Retention when that account mode is enabled. Check the account setting before evaluation. Record `exa_connect_zdr_incompatible` as a terminal evaluation result. Do not disable an account privacy setting automatically.

Run the evaluation at the actual configured 08:00 schedule on a regular market day. Record both the configured local time and `America/New_York` market time. Test:

- AAPL, NVDA, AMD, SPY, and QQQ current price.
- Quote time and timezone.
- Prior close.
- Explicit premarket, regular, after-hours, or unknown session label.
- Premarket high, low, share volume, dollar volume, bid, ask, and spread.
- Intraday 5-minute, 15-minute, and 60-minute OHLCV bars.
- Daily and weekly OHLCV history.
- Corporate actions.
- Provider citations and identifiers.
- Cost and latency.

Pass rule:

- Use Exa Connect only for fields it returns explicitly and consistently.
- If it lacks premarket or intraday data, keep it for supported fundamentals, filings, news, or daily history. Add a separately licensed provider for missing fields.
- Never derive a premarket quote from the prior regular-session close.

### 9.2 Deterministic calculations

Calculate these fields only from approved timestamped bars:

- premarket high, low, last, share volume, and dollar volume;
- 5-minute, 15-minute, 60-minute, daily, and weekly structures;
- VWAP when volume is reliable;
- SMA 20, 50, and 200;
- ATR 14;
- prior close;
- prior-day high and low;
- weekly swing levels;
- gap boundaries;
- trend slopes;
- distance to trigger in percent and ATR units;
- reward-to-risk estimate; and
- no-chase distance.

Calculation modules must be pure functions with fixed fixtures. No model may calculate or repair these values from prose.

### 9.3 Conflict rules

When providers conflict:

- Preserve both observations.
- Compare timestamps and session labels.
- Prefer the approved primary provider for that field.
- Downgrade confidence.
- Display the conflict when it can change a score or conclusion.
- Never average incompatible quotes.

## 10. Personalization and configuration

Store preferences in Convex. Do not read them from a prior Pi or Discord session.

Define one strict, versioned `MarketResearchPreferencesV1` schema and use it for the web form, Convex writes, scheduler, query planner, and frozen edition snapshot. Do not maintain partial copies of the settings contract.

Authoritative `marketResearchPreferences` fields:

```text
schemaVersion
preferenceId
scheduleId
ownerId
guildId
enabled
forumChannelId
forumTagIds[]
timezone
displayTimezones[]
localHour
localMinute
primarySymbols[]
symbolPriorities{}
sectorSymbols[]
discoverySymbols[]
followedSectors[]
trackedThemes[]
macroTopics[]
eventCategories[]
preferredDomains[]
excludedDomains[]
requestedSources[]
reportSections{}
maximumRankedSetups
editionDepth
includeWeekends
includeCharts
maximumCharts
lateEditionCutoffLocalTime
searchRequestBudget
contentsPageBudget
exaMaxCostUsd?
marketDataProviderId
marketSessionCalendarId
durableTheses[]
sourcePolicyVersion
promptVersion
revision
createdAt
updatedAt
```

Defaults:

- `timezone`: `America/New_York`
- `displayTimezones`: `America/New_York`, `America/Puerto_Rico`
- `localHour`: `8`
- `localMinute`: `0`
- `maximumRankedSetups`: `5`
- `editionDepth`: `full`
- `includeWeekends`: `true`
- `includeCharts`: `false` until MR-016 passes; owner can enable it afterward
- `maximumCharts`: `3`
- `lateEditionCutoffLocalTime`: `12:00`
- `searchRequestBudget`: `12`
- `contentsPageBudget`: `24`

Schema rules:

- Permit 1-10 unique primary symbols for the default 12-call search plan.
- Require every `symbolPriorities` key to appear in a configured symbol list.
- Bound macro topics, event categories, themes, domains, thesis text, section toggles, budgets, cost, and charts.
- Require all five requested sources for the first release: FinancialJuice, Barchart, ForexFactory, Yahoo, and TradingView.
- Validate that enabled sections and symbol counts fit the configured search and content budgets.
- Increment `revision` for any saved change. Freeze the complete validated record and hash on each edition.

### 10.1 Default boards

Primary long-only board:

```text
AAPL, MSFT, XOM, COP, NVDA, AMD, MU, SPY, QQQ
```

Sector confirmation board:

```text
XLE, XLK, SMH, SOXX
```

Standing discovery universe:

```text
DIA, IWM, XLU, CVX, SLB, OXY, VST, CEG, NRG, VRT, ETN, GEV,
AVGO, ARM, TSM, ASML, SNDK, QCOM, INTC, MRVL, AMZN, GOOGL,
META, TSLA, ORCL
```

Rules:

- Always analyze every primary symbol.
- Use sector symbols to confirm or reject company setups.
- Add no more than three dynamic challengers.
- Do not silently omit a configured ticker.
- Do not include penny stocks or thin small caps.
- Keep personalization independent from any brokerage account.

### 10.2 Optional durable theses

A future durable thesis list can include thesis text, symbol, priority, key levels, invalidation, expiry, and status. It must not be inferred from the latest Discord conversation or another Codex task.

Until this store exists, each ticker uses `NO PRIOR THESIS`.

## 11. Convex data model

Use separate tables. Do not overload `discordLoopRuns` or `discordOutbox`. Those records assume a source conversation, processing cursor, and normal channel message.

### 11.1 `marketResearchPreferences`

Store the active configuration from section 10.

Required indexes:

- `by_owner_guild`
- `by_enabled_updatedAt`

### 11.2 `marketResearchEditions`

Suggested fields:

```text
ownerId
guildId
scheduleId
forumChannelId
editionId
scheduledKey
editionRevision
baseEditionId?
editionDate
timezone
trigger: scheduled | manual_publish | retry | regeneration
status
stage
configurationRevision
configurationSnapshotHash
promptVersion
workerId?
claimId?
generation
leaseExpiresAt?
attempts
nextAttemptAt?
resumeFrom?
exaRequestCount
exaCostUsd
sourceCount
acceptedSourceCount
threadId?
starterMessageId?
expectedPartCount?
sentPartCount?
lastErrorCode?
lastErrorMessage?
scheduledFor
startedAt?
composedAt?
publishedAt?
completedAt?
createdAt
updatedAt
```

Required indexes:

- `by_owner_scheduledKey_revision`
- `by_status_nextAttemptAt`
- `by_owner_guild_editionDate`
- `by_leaseExpiresAt`

### 11.3 `marketResearchEvidence`

Suggested fields:

```text
editionId
evidenceId
kind: news | official | quote | bar | calculation | calendar | corporate_action
provider
sourcePolicy
title?
url?
canonicalUrlHash?
author?
publishedAt?
providerTimestamp?
retrievedAt
sessionLabel?
freshness: fresh | cached | delayed | stale | unknown
contentStatus
highlights[]
normalizedClaims[]
requestId?
costUsd?
contentHash
createdAt
```

Bound all strings and arrays. Do not store full article bodies.

Required indexes:

- `by_edition_evidenceId`
- `by_edition_kind`
- `by_edition_canonicalUrlHash`

### 11.4 `marketResearchSections`

Suggested fields:

```text
editionId
sectionId
sequence
kind
heading
markdown
sourceIds[]
chartRequests[]
createdAt
```

Required index: `by_edition_sequence`.

### 11.5 `marketResearchDeliveries`

Suggested fields:

```text
editionId
deliveryId
idempotencyKey
sequence
kind: starter | reply
content
contentHash
sourceSectionIds[]
chartAttachmentIds[]
status: pending | sending | sent | failed
attempts
deliveryWorkerId?
deliveryToken?
deliveryLeaseExpiresAt?
discordThreadId?
discordMessageId?
nonce?
lastErrorCode?
lastErrorMessage?
sentAt?
createdAt
updatedAt
```

Required indexes:

- `by_edition_sequence`
- `by_idempotencyKey`
- `by_status_createdAt`
- `by_deliveryLeaseExpiresAt`

### 11.6 `marketResearchEvents`

Store a bounded audit trail for enqueue, claim, stage transition, quality decision, retry, reconciliation, thread creation, reply delivery, partial publication, completion, manual run, and cancellation.

Do not store prompts, full article text, full edition text, or secrets in the event table.

### 11.7 `marketResearchPreviews`

Store non-publishing test runs outside `marketResearchEditions`.

Required fields include `previewId`, owner, guild, frozen settings hash, requested time, status, safe failure, bounded quality summary, and expiry. Preview IDs use a separate namespace and can never satisfy or block the scheduled daily key. Do not create delivery records, forum threads, or scheduled-edition receipts for a preview.

## 12. Edition state machine

Primary states:

```text
queued
  -> collecting
  -> researching
  -> calculating
  -> composing
  -> ready_to_publish
  -> creating_thread
  -> publishing_replies
  -> published
```

Recovery states:

```text
any nonterminal state -> retry_wait
publishing_replies -> partial only after automatic reply retries are exhausted and a starter exists
partial -> retry_wait -> publishing_replies after an explicit retry or a verified external-state change
any state -> failed for a terminal error
queued -> skipped_late only under the configured late policy
explicit operator stop -> cancelled
```

Invariants:

- Only one scheduled base edition exists for one owner, guild, schedule, and local market date.
- Forum, settings, source-policy, and prompt changes update the frozen snapshot. They cannot create another automatic edition for that date.
- A nonzero `editionRevision` exists only for an explicit owner-requested regeneration and links to the base edition.
- Claims use one atomic compare-and-set mutation and a random lease token.
- Every state change requires the current generation and unexpired lease.
- A stale worker cannot store evidence, composition output, or delivery acknowledgements.
- Persist evidence before `composing`.
- Persist and validate the edition before `ready_to_publish`.
- Materialize every immutable publication part before `creating_thread`.
- Freeze edition text and delivery order before publication.
- Mark `published` only after every required delivery has a Discord receipt.
- Reuse stored evidence on composition retry.
- Reuse stored publication parts on delivery retry.
- Never create a second thread as an ordinary retry action.
- Keep ordinary active reply delivery in `publishing_replies`. Use `retry_wait` for a recoverable failure before retries are exhausted.
- Published editions are immutable. Corrections use a visible correction reply or a new revision.

## 13. Scheduling

### 13.1 Default schedule

Run every calendar day at 08:00 in the owner-confirmed IANA timezone. Use `America/New_York` only as the proposed default until the owner confirms it.

Convex schedules use UTC. Run a due-edition check every minute and apply an IANA-timezone gate:

1. Convert the current instant to the configured timezone.
2. Build the local `editionDate`, its configured `scheduledFor` instant, and the local cutoff instant.
3. Treat the edition as due when `scheduledFor <= now < cutoff` and no scheduled base edition exists for that date.
4. Insert the deterministic scheduled edition in the same mutation that checks uniqueness.
5. If the first post-outage check occurs at or after the cutoff, insert one deterministic `skipped_late` record so the missing edition remains auditable.
6. Before `scheduledFor`, do nothing.

Deterministic key:

```text
market-paper:<ownerId>:<guildId>:<scheduleId>:<editionDate>
```

This avoids fixed UTC offsets, survives daylight-saving changes, and prevents mutable settings from producing a second scheduled edition. Store the forum ID, configuration revision, prompt version, and source-policy version only in the frozen edition snapshot.

### 13.2 Market session calendar

Add a `MarketSessionCalendar` boundary:

```text
getSession(localDate) -> OPEN | EARLY_CLOSE | CLOSED
getPreviousSession(localDate) -> Session
getNextSession(localDate) -> Session
getRegularOpen(session) -> Instant
getRegularClose(session) -> Instant
getEarlyClose(session) -> Instant | null
getCalendarVersion() -> string
```

For U.S. equities, use versioned NYSE-published holiday and early-close schedules as the primary calendar authority. Retain the official source URL, retrieval date, effective range, content hash, and reviewed calendar version. Check official SEC and exchange notices for emergency or ad-hoc closures. Allow an owner-reviewed override with a reason, source, effective interval, and audit event.

Calendar policy:

- Load the current and next calendar year before production enablement.
- Refresh the official calendar snapshot at least monthly and when an exchange notice changes a session.
- Fail closed to `session_unknown` when the required date is outside the reviewed range.
- Do not infer a holiday only because quotes are missing.
- Test observed holidays, Monday after a holiday, ad-hoc closures, early closes, year boundaries, and both daylight-saving transitions.

### 13.3 Weekend and holiday behavior

The job still runs every day.

- On weekends, label it `Weekend Outlook`.
- On market holidays, label it `Market Holiday Outlook`.
- Use the prior session's confirmed close and next-session catalysts.
- Do not publish fabricated premarket direction.
- Do not label a prior-session quote as current premarket evidence.

### 13.4 Late editions

If infrastructure is unavailable at 08:00:

- The due predicate creates the edition on the first scheduler check before the cutoff.
- Start it when a worker returns.
- Refresh all time-sensitive evidence.
- Add `Late Edition` when composition starts after 09:00 local time.
- Publish until the configured cutoff, default 12:00.
- After the cutoff, mark an existing queued edition `skipped_late`, or create the deterministic skipped record if the scheduler was also unavailable. Expose a manual rerun. Do not silently discard the date.

### 13.5 Manual trigger

Provide an owner-authenticated manual trigger.

- `dryRun=true` creates a separate `previewId`, completes composition without Discord delivery, and never consumes the daily scheduled key.
- `publish=true` requires a valid forum route and claims the stable base key for that local date. A later scheduler check returns the existing edition.
- An explicit `regeneratePublishedEdition=true` action increments `editionRevision`, links the new edition to the published base edition, and does not change the scheduled key.
- A preview at 07:55 cannot prevent the 08:00 scheduled edition.
- Record the authenticated owner and trigger time.

## 14. Research and composition pipeline

### Stage 1: Load and freeze configuration

- Read the active preference record.
- Validate the forum channel snapshot.
- Freeze configuration revision and source-policy version.
- Reject an empty primary board.
- Reject an enabled configuration with no forum channel.

### Stage 2: Determine session context

- Resolve regular session, early close, weekend, or market holiday through the versioned `MarketSessionCalendar`.
- Compute prior and next sessions.
- Compute timestamps in `America/New_York`, configured timezone, and UTC.
- Establish news and calendar windows.

### Stage 3: Collect structured market evidence

- Fetch snapshots and bars for every primary and sector symbol.
- Fetch discovery movers when supported.
- Fetch corporate actions and known events.
- Validate timestamps and session labels.
- Store missing fields as missing. Do not estimate them.

### Stage 4: Run Exa query packs

- Run required packs before optional packs.
- Apply source policy and domain controls.
- Normalize and deduplicate results.
- Retrieve additional Contents only for selected evidence.
- Store metadata, bounded highlights, request IDs, and cost.

### Stage 5: Calculate deterministic indicators

- Calculate timeframes and levels from approved bars.
- Produce calculation provenance.
- Mark calculations unavailable when inputs are unavailable.

### Stage 6: Build a bounded evidence packet

`MorningPaperEvidenceV1` contains session context, source-policy status, market observations, calculated levels, normalized news, official events, per-symbol evidence, conflicts, missing fields, allowed source IDs, and data-quality deductions.

Recommended hard limits:

- 80 retained editorial sources.
- 2,000 highlight characters per source.
- 24 detailed Contents pages.
- 40 ticker records.
- 100 calendar events.
- 256 KiB maximum for the complete UTF-8 JSON encoding of `MorningPaperEvidenceV1`.
- 64 KiB maximum for one Convex evidence or checkpoint record. Split larger bounded collections by deterministic sequence.

Measure byte length after final JSON serialization and before any checkpoint write or composition request. Reject or deterministically reduce optional evidence until the 256 KiB limit is met. Never drop required primary-symbol or requested-source status records. Tests must prove the limits remain below every configured Pi HTTP-body, Convex action-argument, and Convex document limit.

### Stage 7: Compose without tools

Create one isolated Pi/Codex composition session with no conversation history, no Exa tool, no public-web tool, no market-data tool, and no brokerage tool.

The scheduled worker must not depend on interactive login. Pi startup and health checks must verify that the configured composition provider is ready for unattended use. If credentials are absent, expired, or require user interaction, do not enter composition. Record `composition_auth_required` or `composition_provider_not_ready`.

The composer receives only the frozen evidence packet, strict output schema, and editorial rules. It may cite only supplied source IDs.

Perform at most one bounded schema-repair pass. The repair receives validation errors and prior output, but no tools.

### Stage 8: Validate the edition

- Validate the strict schema.
- Validate every source ID.
- Validate all primary symbols appear.
- Validate dynamic tickers belong to the allowed discovery set or verified mover set.
- Validate score components and totals.
- Validate numerical claims against deterministic evidence.
- Validate timestamps and session labels.
- Validate no prohibited order or brokerage action appears.
- Validate missing data remains labeled.

### Stage 9: Build semantic delivery parts

- Render the starter first.
- Render ordered section replies.
- Split semantic blocks before storage.
- Freeze part order, content hashes, and idempotency keys.

### Stage 10: Publish and reconcile

- Create or reconcile the forum thread.
- Save thread and starter IDs.
- Send each missing reply in order.
- Attach charts when available.
- Mark published only after every required reply is acknowledged.

## 15. Editorial specification

The newspaper must retain the decision-support detail of the prior Market Research automation while making the result readable on Discord.

### 15.1 Starter post

The starter must fit within 2,000 characters and contain:

1. Edition date and exact `as of` time.
2. `RISK-ON`, `MIXED`, or `RISK-OFF`.
3. Five short market-regime lines.
4. Three to five important overnight or morning stories.
5. Today's highest-risk scheduled events.
6. The three to five best long-only setups, or `No qualified setup`.
7. A visible edition ID for reconciliation.
8. A data-quality warning when a critical input is stale, missing, or conflicting.

The starter must stand alone. A reader who does not open the replies must understand the main view and main risks.

### 15.2 Reply order

Use this default order:

1. `How to read this edition`
2. `Overnight world and macro`
3. `Rates, dollar, commodities, and volatility`
4. `U.S. index and sector tape`
5. `Scheduled volatility windows`
6. `Primary trade board`
7. `Dynamic challengers`
8. `Ticker dossiers`
9. `What validates or invalidates the view`
10. `What changes after the open`
11. `Requested-source status`
12. `Data quality and unavailable evidence`
13. `Sources`

Omit an empty optional section. Never omit the primary board, data-quality section, or sources.

### 15.3 Market context

Cover when reliable:

- S&P 500, Nasdaq 100, Dow, and Russell context through futures or reliable ETF proxies;
- VIX;
- U.S. Treasury yields;
- U.S. dollar;
- crude oil and material energy products;
- gold when macro-relevant;
- sector leadership;
- market breadth;
- Asia and Europe handoff;
- today's official macro calendar; and
- earnings and corporate-action risk.

Check FOMC releases, EIA petroleum data, major economic reports, earnings, ex-dividend dates, splits, offerings, and other events that can cause binary or mechanical gaps. Do not mislabel an ex-dividend adjustment as bearish selling.

Explain what the macro and sector tape validates or invalidates for configured stocks. Separate confirmed fact from inference.

### 15.4 Premarket mover scan

Find verified premarket gainers and losers among liquid U.S.-listed equities only when an approved provider supplies the required fields.

Filters:

- Prior close of at least `$10`.
- Average daily dollar volume of at least `$100 million` when available.
- Premarket dollar volume of at least `$1 million` and 50,000 shares when available.
- Spread no wider than `0.30%`.
- Absolute premarket move of at least `1%`.
- A current attributable catalyst or documented sector or macro driver.
- No stale, halted, promotional, unexplained, or conflicting quote.

Rank by dollar flow and liquidity, not percentage change alone.

This workflow is long-only. A downside mover may appear only as a reversal candidate. Never turn it into a short recommendation.

If required mover fields are unavailable, publish `Mover scan unavailable` with the missing fields. Do not weaken the filters without disclosure.

### 15.5 Multi-timeframe and level rules

- Use weekly context for major structural levels.
- Use daily and 60-minute structure for directional bias.
- Use 15-minute premarket structure for setup quality.
- Use post-open 5-minute structure for later confirmation.
- Do not require every timeframe to point in the same direction.

A continuation candidate needs an intact daily or 60-minute trend, constructive 15-minute premarket structure, sector and index confirmation, and price near a defined structural level.

A reversal candidate needs higher-timeframe support, capitulation or stabilization, a premarket VWAP or key-level reclaim, and sector confirmation. A falling stock without a reclaim is not a long setup.

Define `near a level` as within the smaller of:

- `0.50 ATR`; or
- `0.50%` of a real structural level.

Allowed levels:

- prior-day high or low;
- premarket high or low;
- prior close;
- weekly swing;
- gap boundary;
- round number with repeated reactions; or
- volume-weighted reference when reliable.

State how each level was derived. Reject arbitrary levels.

### 15.6 Confirmation and no-chase rules

After the open, confirmation means either:

- one 5-minute close through the trigger followed by a successful retest; or
- two consecutive 5-minute closes through the trigger;

with acceptable spread and stronger-than-expected volume.

Never treat a premarket touch alone as confirmation.

Mark `NO CHASE` when any condition is true:

- Price is more than `0.75 ATR` beyond the trigger.
- Remaining reward to next resistance is less than twice the distance to invalidation.
- The opening gap is extended without a base.

### 15.7 Scoring

Score each eligible setup from 0 to 100:

| Component | Points |
| --- | ---: |
| Catalyst | 20 |
| Liquidity and spread | 15 |
| Daily and 60-minute bias | 20 |
| 15-minute premarket structure | 15 |
| Level quality and proximity | 20 |
| Index and sector confirmation | 10 |

Labels:

- `85-100`: `TOP WATCH`
- `75-84`: `WATCH`
- `65-74`: `WAIT FOR CONFIRMATION`
- below `65`: `AVOID`

Rules:

- Missing, stale, delayed, or conflicting data cannot receive full points.
- Explain every material deduction.
- Rank no more than five setups.
- Prefer no setup over a weak setup.
- A score must equal the sum of stored component scores.

### 15.8 Evidence for every primary ticker

For each primary ticker, provide when available:

- Latest premarket price and change from prior close.
- Quote and retrieval timestamps.
- Premarket volume.
- Bid, ask, spread, and liquidity quality.
- Current attributable catalyst.
- Official filing or IR evidence.
- Earnings timing and guidance context.
- Analyst action with a named source.
- Unusual volume or options context when reliable.
- Weekly, daily, 60-minute, and 15-minute premarket structure.
- Prior close, premarket high and low, and prior-day high and low.
- Material support, resistance, gap levels, and moving averages.
- ATR or volatility.
- Sector and index confirmation.
- Bull case and bear case.
- Exact upside confirmation.
- Invalidation level.
- First resistance or target zone.
- Reward-to-risk estimate.
- No-chase level.
- Required index and sector confirmation.
- Scheduled-event risk.

Mark unavailable fields. Never invent precision.

For every ranked setup, state the exact trigger, invalidation, first resistance or target zone, reward-to-risk estimate, no-chase condition, and index or sector condition. For every dynamic challenger, state why its evidence score outranks the displaced or lower-ranked primary candidate.

### 15.9 Thesis labels

When a future durable thesis store exists, use only:

```text
VALIDATED
PARTIALLY VALIDATED
AT RISK
INVALIDATED
NO PRIOR THESIS
```

State the evidence and level that changes the label. Until the durable store exists, use `NO PRIOR THESIS`.

### 15.10 Research-only language

- This is research and decision support, not an order.
- Never promise a return.
- Never say the system bought, sold, entered, exited, or changed a position.
- Use `TOP WATCH`, `WATCH`, `WAIT FOR CONFIRMATION`, `AVOID`, or `EXIT-RISK` only as research labels.
- Every directional opinion includes invalidation and event risk.

## 16. Strict output contracts

Define `MorningPaperEditionV1` with Zod:

```text
schemaVersion: 1
editionId
editionDate
timezone
asOf
sessionType
editionLabel
regime: RISK_ON | MIXED | RISK_OFF
regimeLines[5]
topStories[]
scheduledEvents[]
marketContext
primaryBoard[]
challengers[]
tickerDossiers[]
validationRules[]
afterOpenChanges[]
requestedSourceStatus[]
dataQuality[]
sections[]
chartRequests[]
sourceIds[]
noTradingAction: true
```

Every factual item includes one or more `sourceIds`. Every calculated item includes calculation evidence IDs.

Reject:

- Unknown or invented source IDs.
- Uncited material factual claims.
- Scores outside 0-100.
- Component totals that do not match the score.
- Missing primary tickers.
- Unknown dynamic tickers.
- Invalid timestamps.
- Quotes without session labels.
- Unbounded arrays or strings.
- Duplicate section or source IDs.
- Brokerage actions or order instructions.
- A starter that cannot fit the Discord limit.

## 17. Discord forum delivery

Forum publishing is not a normal `channel.send(...)` operation.

### 17.1 Third channel configuration

Use `marketResearchPreferences.forumChannelId` and `forumTagIds` as the only source of truth for this scheduled target. Do not add the forum to the loop-oriented conversation and research-log routing record. Saving either existing route must not overwrite the morning-paper forum. Saving the morning-paper form must not overwrite either existing route.

Extend synchronized Discord channel metadata in `apps/discord/src/contracts.ts`, `apps/convex/convex/lib/discord_contract.ts`, and `apps/convex/convex/schema.ts` with:

```text
type: forum
canView
canCreateForumPost       # SendMessages on the forum
canSendInThreads         # SendMessagesInThreads
canReadThreadHistory
canAttachFiles
requiresTag
availableTags[]:
  id
  name
  moderated
  emoji?
```

The web page presents this independent preference as the third channel selector. It does not make it a conversational channel role.

Server validation requires:

- Channel is available and belongs to the selected guild.
- Synchronized type is exactly `forum`.
- Bot can view the forum.
- Bot has `SEND_MESSAGES` in the forum. Discord ignores `CREATE_PUBLIC_THREADS` for forum post creation.
- Bot has `SEND_MESSAGES_IN_THREADS` for replies.
- Bot can read thread history for reconciliation.
- Bot has `ATTACH_FILES` when charts are enabled.
- Configured tag IDs belong to the forum.
- A valid tag is selected if the forum requires one.

The web selector applies the same type filter. Server validation remains authoritative. Do not fall back to a text channel.

### 17.2 Thread creation

Use Discord.js `ForumChannel.threads.create(...)`.

```text
name: 1-100 characters
message.content: no more than 2,000 characters
message.allowedMentions.parse: []
appliedTags: no more than 5 valid tag IDs
autoArchiveDuration: forum default unless configured
```

Title format:

```text
Morning Market Newspaper - YYYY-MM-DD - MIXED
```

Use `Weekend Outlook`, `Market Holiday Outlook`, or `Late Edition` when required.

The starter footer contains a visible marker:

```text
Edition ID: MR-<bounded-id>
```

`threads.create(...)` returns the created thread, not a durable acknowledgement record for the starter. After creation, fetch or otherwise resolve the thread's starter message through Discord.js. Verify the bot author, exact edition marker, and content hash. Persist both `thread.id` and `starterMessage.id` in one fenced Convex acknowledgement before sending replies. If the starter cannot be resolved after bounded retries, enter starter reconciliation. Do not assume the thread ID is the starter message ID.

References:

- [Discord forum thread API](https://docs.discord.com/developers/resources/channel#start-thread-in-forum-or-media-channel)
- [Discord.js forum thread manager](https://discord.js.org/docs/packages/discord.js/14.27.0/GuildForumThreadManager:Class)

### 17.3 Semantic chunking

Discord content is limited to 2,000 characters. Target 1,850 characters for replies so headings and part markers have room.

Split in this order:

1. Complete section.
2. Complete subsection.
3. Complete bullet group.
4. Paragraph.
5. Sentence.
6. Whitespace.
7. Unicode grapheme boundary as the final fallback.

Rules:

- Count part-marker text inside the limit.
- Calculate all parts before storage so the final count is known.
- Prefix replies with `Part N/M - <section>`.
- Never split a URL or Markdown link.
- Keep citation markers with their claims.
- Do not split an evidence line or ticker row.
- Close and reopen code fences when needed.
- Prefer bullets over Markdown tables.
- Escape or neutralize untrusted Markdown.
- Never truncate during delivery.
- Recombining parts must prove no report content was lost.

### 17.4 Delivery idempotency

Use:

```text
<editionId>:starter
<editionId>:reply:0001
<editionId>:reply:0002
...
```

Use deterministic Discord nonces and `enforceNonce` for replies when supported.

For uncertain starter creation:

1. Check stored `threadId` first.
2. Search a bounded set of recent active and archived threads.
3. Fetch candidate starter messages.
4. Match the exact edition marker, not title alone.
5. Adopt and save the matching thread and starter IDs.
6. If no match is visible, retry reconciliation with jittered backoff through a documented eventual-visibility window.
7. If the original create result remains ambiguous after that window, record `discord_thread_reconcile_ambiguous` and require operator reconciliation. Do not create another thread automatically.
8. Create a starter after failure only when the first request definitively failed before Discord could accept it, such as local validation or a confirmed permission rejection.
9. If multiple markers match, retain the earliest, record a duplicate incident, and stop automatic publishing.

Discord's forum-starter operation has no reliable application idempotency key. A bounded listing cannot prove absence during API failure or delayed visibility.

### 17.5 Partial publication

- Save thread and starter IDs immediately after creation.
- Acknowledge every reply separately.
- Publish replies in sequence.
- On restart, begin with the first missing sequence.
- Do not resend acknowledged replies.
- Keep the state `publishing_replies` during ordinary active delivery.
- Use `retry_wait` after a recoverable reply failure while automatic retries remain.
- Mark `partial` only when a starter exists, required replies remain, and automatic reply retries are exhausted.
- Move `partial` back through `retry_wait` after an explicit retry or verified permission/provider recovery.
- Mark `published` only when every required part is acknowledged.

## 18. Chart-image boundary

The separate chart-img work owns chart rendering. This plan defines only its integration contract.

Suggested request:

```text
chartRequestId
editionId
sectionId
symbol
timeframe
start
end
session
overlays[]
annotations[]
reason
priority
sourceEvidenceIds[]
dataAsOf
```

Suggested response:

```text
chartRequestId
status: rendered | unavailable | failed
filename?
mediaType?
artifactTransport: in_process | convex_storage
storageId?
sha256?
byteLength?
width?
height?
altText?
dataAsOf?
sourceEvidenceIds[]
expiresAt?
errorCode?
```

Rules:

- Keep `includeCharts=false` until MR-016 passes. The newspaper must ship complete text without chart-img.
- The first permitted path can reuse the existing trusted in-process Discord renderer. Pass it a validated chart specification and frozen numerical series. No cross-service artifact transport is needed for that path.
- For a cross-service chart-img renderer, use Convex file storage as the internal artifact handoff. The producer obtains a service-authenticated one-time upload URL, uploads the bytes, and records only `storageId`, media metadata, SHA-256, byte length, dimensions, source IDs, and expiry in the artifact record.
- The Discord publisher obtains a short-lived download URL through a service-authenticated Convex operation. It downloads with a strict timeout and byte cap, recomputes SHA-256, validates media type and dimensions, attaches the verified bytes, and never posts the internal URL.
- Keep an artifact until its delivery is acknowledged or the bounded recovery window ends. Delete or expire it after the retention interval. Expiry before delivery degrades to text and records `chart_artifact_expired`.
- Request a chart only when it materially improves understanding.
- Supply already validated data or an approved internal data reference.
- A chart is output only. It cannot become evidence for a fact.
- Do not OCR a chart to repair missing data.
- Validate media type, size, dimensions, filename, hash, and source IDs.
- Keep each chart within the existing 8 MiB per-file limit.
- Never send an arbitrary remote image URL directly to Discord.
- Chart timeout or failure degrades the edition but never blocks text.
- Do not enable the chart-img path until its merged contract and storage lifecycle pass review.

## 19. Security and trust boundaries

### 19.1 Secret flow

```text
Railway Pi secret store
        |
        v
Pi process EXA_API_KEY -> Exa HTTPS API
```

The key must never cross from Pi to the Discord service, Convex, browser, model prompt, model output, Discord, logs, or health output.

### 19.2 Untrusted web content

Treat every Exa result as hostile input.

- Never follow instructions found in a page.
- Never let page text alter policy, tools, prompts, schedule, routing, or security controls.
- Strip scripts, hidden content, and control characters.
- Keep evidence inside typed fields and explicit prompt delimiters.
- Tell the composer that evidence is data, never instruction.
- Accept HTTPS only.
- Reject credentials and private or special-use hosts.
- Revalidate redirects if any page is fetched outside Exa.

### 19.3 Output and brokerage safety

- Set `allowedMentions.parse` to an empty array for every message.
- Bound all content before Discord.js.
- Do not embed remote HTML.
- Attach only trusted chart artifacts.
- Do not store or publish hidden reasoning.
- The morning-paper runner must not import, construct, or receive a `TradingBroker`.
- Tests must prove it cannot call Robinhood MCP, portfolio refresh, broker routes, proposals, approvals, or order execution.

## 20. Reliability and failure handling

### 20.1 Safe failure codes

```text
market_research_disabled
forum_not_configured
forum_wrong_channel_type
forum_permissions_incomplete
edition_already_exists
edition_lease_lost
exa_not_configured
exa_auth_failed
exa_budget_exhausted
exa_rate_limited
exa_unavailable
exa_invalid_request
exa_connect_zdr_incompatible
source_rights_blocked
source_unavailable
market_data_not_configured
market_data_stale
market_data_conflict
market_data_unavailable
market_session_calendar_stale
session_unknown
evidence_below_minimum
composition_auth_required
composition_provider_not_ready
composition_timeout
composition_schema_invalid
composition_citation_invalid
chart_unavailable
chart_artifact_expired
discord_thread_create_failed
discord_thread_reconcile_failed
discord_thread_reconcile_ambiguous
discord_reply_failed
discord_permission_failed
discord_rate_limited
late_cutoff_exceeded
```

### 20.2 Minimum viable evidence

A degraded edition can publish only if it has:

- Confirmed session type.
- Current official calendar evidence or an explicit no-event result.
- Cited top stories from more than one domain when material stories exist.
- One usable observation or explicit unavailable label for every primary ticker.
- Visible market-data freshness.
- A complete data-quality section.

If minimums fail, publish no market conclusion. By default, publish a visible `Data unavailable` operational edition with no setup scores so the daily absence is not silent.

### 20.3 Retry and shutdown

Default retry delays:

```text
30 seconds
2 minutes
5 minutes
15 minutes
```

Apply jitter. Honor provider and Discord `Retry-After`. Do not retry authentication, configuration, permission, rights, or contract failures without a state change.

On shutdown:

- Stop claiming new editions.
- Abort active Exa and model requests.
- Release or let the fenced lease expire.
- Do not mark unfinished work complete.
- Preserve evidence and delivery receipts.
- Resume from the last durable stage after restart.

## 21. Observability and operations

Record safe structured metrics:

- Edition ID, date, stage, and transitions.
- Scheduled and actual start time.
- Duration by stage.
- Exa Search calls, Contents pages, cost, retries, and failures.
- Evidence accepted, rejected, duplicated, stale, and rights-blocked.
- Domain diversity and ticker coverage.
- Market provider and freshness class.
- Composition model, token metrics, and duration.
- Section, part, and chart counts.
- Discord starter and reply durations.
- Lease expiry, reconciliation, duplicate incident, retry count, and final state.

Do not log the Exa key or its fingerprint, authorization headers, article bodies, full evidence packet, full edition, Discord token, Codex OAuth, brokerage credentials, prompts, or hidden reasoning.

The control page may display enabled state, next run, current stage, queue age, last successful edition, last partial or failed edition, source coverage, freshness, Exa cost, safe failure, worker heartbeat, forum link, and manual retry.

Alert when:

- No run appears after the schedule grace period.
- No edition publishes by the deadline.
- Authentication fails.
- Forum type, tags, or permissions become invalid.
- Multiple consecutive runs fail.
- An edition remains partial.
- No usable evidence is returned.
- Duplicate Discord content is detected.

## 22. Verifiable implementation tasks

Every task has a concrete pass condition. Mark a task complete only after its verification passes.

### MR-001: Add feature configuration and the secret boundary

Implementation:

- Add section 7.2 variables to `apps/pi/src/config.ts`.
- Require the Exa key only when market research is enabled.
- Add `EXA_API_KEY: preserve()` and non-secret feature variables to the Pi service in `.railway/railway.ts`.
- Update `apps/pi/README.md` and `docs/DEPLOYMENT.md`.
- Do not put the literal key in TypeScript, Railway IaC, fixtures, or logs.

Verification:

- Unit test: Pi starts without the key when disabled.
- Unit test: enabled production configuration without the key fails.
- Unit test: health contains only an Exa configured boolean.
- Repository scan: the literal key appears only in section 3 of this file.
- Run `npm run check:pi`.
- Run `npm run check:railway`.

### MR-002: Add strict cross-service contracts

Implementation:

- Add the authoritative preferences, request, preview, evidence, result, source, chart, delivery, and safe-error schemas.
- Bound every string, array, number, URL, and timestamp.
- Version every payload.
- Add canonical fingerprints for idempotent requests.

Verification:

- Reject unknown fields, source IDs, oversized content, bad timestamps, bad URLs, duplicate IDs, and invalid scores.
- Accept a complete fixture that covers all primary symbols.
- Prove identical requests produce the same fingerprint.
- Run `npm run check:pi` and `npm run check:discord`.

### MR-003: Add Convex tables and service operations

Implementation:

- Add the tables and indexes from section 11 to `apps/convex/convex/schema.ts`.
- Add `apps/convex/convex/market_research.ts`.
- Add owner-scoped settings queries and mutations.
- Add service-authenticated claim, heartbeat, store-result, delivery, reconciliation, and acknowledgement operations.
- Add bounded retention that preserves final edition summaries and Discord identifiers.
- Keep previews in their separate namespace and table. They cannot create delivery rows or claim a scheduled key.

Verification:

- Prove owner isolation.
- Prove duplicate stable scheduled-key creation returns the existing edition even after forum, prompt, or settings changes.
- Prove a preview cannot consume a scheduled key.
- Prove stale generations and expired lease tokens cannot write.
- Prove delivery IDs and sequences are unique per edition.
- Prove retention does not delete publication receipts or final summaries.
- Run `npm run check:convex`.

### MR-004: Add the daylight-saving-aware scheduler

Implementation:

- Add a minutely Convex cron in `apps/convex/convex/crons.ts`.
- Apply `scheduledFor <= now < cutoff` and scheduled-key uniqueness in one idempotent mutation.
- Implement the versioned `MarketSessionCalendar`, official-source update policy, and audited override path.
- Add weekend, holiday, catch-up, late, and manual-run behavior.
- Keep the existing Codex automation active.

Verification:

- Standard-time fixture creates one 08:00 edition in the configured timezone.
- Daylight-time fixture creates one 08:00 edition when the configured timezone observes daylight saving.
- Spring-forward and fall-back fixtures create exactly one edition.
- `America/Puerto_Rico` fixtures remain at 08:00 local time without a daylight-saving shift.
- Weekend fixture creates `Weekend Outlook`.
- Market-holiday fixture creates `Market Holiday Outlook`.
- Repeating the cron mutation creates no duplicate.
- Changing the forum, prompt, or settings during the same local date creates no second scheduled edition.
- An outage inside the catch-up window queues one late edition.
- An outage beyond the cutoff records exactly one deterministic `skipped_late` result.
- Observed-holiday, ad-hoc closure, early-close, calendar-range, year-boundary, and timezone fixtures pass.
- Run `npm run check:convex`.

### MR-005: Add the third Discord route

Implementation:

- Keep forum channel and tag IDs only in `marketResearchPreferences`. Do not extend the loop-oriented guild routing record.
- Extend synchronized channel contracts with `canCreateForumPost`, `canSendInThreads`, `canReadThreadHistory`, `canAttachFiles`, `requiresTag`, and `availableTags`.
- Synchronize forum tags, moderation state, and required permission flags.
- Require type `forum` on the server.
- Add the third selector, schedule, enabled state, and report settings to `apps/web/src/features/discord/DiscordControlPage.tsx`.
- Preserve existing conversation and research-log routes when the third route changes.

Verification:

- Text and announcement channels are rejected.
- A forum without required permission is rejected.
- Unknown or moderated tags are rejected.
- A required-tag forum cannot save with no valid tag.
- UI selector contains only forum channels.
- Saving one route preserves the other two.
- Saving either existing conversational route preserves the separate morning-paper preference.
- Existing tests that assume two selectors are updated intentionally.
- Run `npm run check:web`, `npm run check:convex`, and `npm run check:discord`.

### MR-006: Add the Exa client

Implementation:

- Add and pin `exa-js` in `apps/pi`.
- Implement the application-level client from section 7.1.
- Implement concurrency, timeouts, retries, rate handling, cost caps, and result limits.
- Map provider errors to fixed safe codes.
- Keep authorization out of diagnostic objects.

Verification:

- Mock Search sends correct parameters with nested `contents`.
- Mock Contents sends content fields at the top level.
- 401 and 402 are not retried.
- 422 and `FETCH_DOCUMENT_ERROR` preserve successful URLs and fail only identified affected URLs.
- `ACCESS_DENIED`, `FEATURE_DISABLED`, `ROBOTS_FILTER_FAILED`, and `SOURCE_NOT_AVAILABLE` follow their distinct section 7.6 policies.
- 429 honors `Retry-After` and stops at the cap.
- 5xx uses bounded jittered retries.
- Robots denial becomes unavailable and does not trigger local scraping.
- Logs and thrown errors do not contain the supplied key.
- Opt-in live smoke test returns request ID, title, HTTPS URL, highlight, and cost without printing the key.
- Run `npm run check:pi`.

### MR-007: Add the research planner and source policy

Implementation:

- Add every query pack from section 7.4.
- Add date-window logic for weekdays, Mondays, holidays, and weekends.
- Add source priority, requested-source status, domain controls, and policy versions.
- Add deterministic URL normalization and content deduplication.
- Reject malformed, private, prohibited, promotional, and rights-blocked results.

Verification:

- A regular weekday produces every required pack.
- The default boards produce exactly 12 required Search slots and no more than 12 provider calls before execution.
- Monday reaches back to the prior session close.
- Every primary ticker appears in a query group.
- Each of the five requested sources receives its required domain-constrained query or a policy-resolved unavailable status without a provider call.
- An impossible symbol-count and budget combination is rejected instead of omitting coverage.
- Tracking variants collapse to one canonical source.
- Duplicate content from different URLs is recognized but original URLs remain auditable.
- A blocked requested source creates visible status without a crawl attempt.
- Run `npm run check:pi`.

### MR-008: Add bounded evidence normalization

Implementation:

- Normalize Search results and Contents statuses.
- Preserve title, URL, author, estimated publication time, retrieval time, highlights, request ID, source class, and cost.
- Enforce evidence limits before model composition.
- Treat source content as untrusted data.

Verification:

- Reject non-HTTPS and credential-bearing URLs.
- Label cached, delayed, stale, unknown, blocked, and failed content correctly.
- Cap highlights, each checkpoint at 64 KiB, and the final UTF-8 JSON evidence packet at 256 KiB.
- Preserve citations through deduplication.
- Prompt-injection fixtures cannot change policy, tools, or output schema.
- Do not persist full article bodies.
- Run `npm run check:pi`.

### MR-009: Evaluate Exa Connect Financial Datasets

Implementation:

- Add an opt-in evaluation harness.
- Request a strict snapshot for AAPL, NVDA, AMD, SPY, and QQQ.
- Record supported fields, timestamps, session labels, latency, citations, and cost.
- Do not enable it automatically as the primary provider.

Verification:

- Run at the actual configured 08:00 instant on a regular market day and record the corresponding Eastern market time.
- Produce a field-by-field support matrix.
- Compare current price and prior close with an independently approved reference.
- Mark premarket high, low, volume, bid, ask, spread, and intraday bars unsupported unless explicit.
- Confirm whether the supplied Exa account can access `financial_datasets`.
- Check whether Zero Data Retention is enabled. If Exa rejects `dataSources` under that account policy, record `exa_connect_zdr_incompatible` and do not change the account setting automatically.
- Store no key or unrestricted raw response in the evaluation report.
- Owner records `approved`, `partial`, or `rejected`.

### MR-010: Add structured market data and calculations

Implementation:

- Implement the `MarketDataProvider` interface.
- Add deterministic calculations as pure functions.
- Add timestamp, session, delay, entitlement, and conflict handling.
- Keep unsupported Yahoo and Nasdaq endpoints out of the production provider.

Verification:

- Fixed fixtures reproduce expected VWAP, SMA, ATR, ranges, and levels.
- Reject unordered, duplicate, negative, and session-mismatched bars.
- Missing volume disables VWAP and volume-dependent scoring.
- Conflicting quotes lower confidence and remain visible.
- A live premarket test verifies timestamps and session labels for every primary symbol.
- Run `npm run check:pi`.

The live premarket provider test is a staging gate. It is not part of deterministic repository tests or `npm run check:pi`.

### MR-011: Add the evidence packet and tool-free composer

Implementation:

- Build `MorningPaperEvidenceV1`.
- Create an isolated composer with no tools and no prior session.
- Add unattended composition-provider readiness to Pi startup and health.
- Port all section 15 editorial rules.
- Add one bounded schema-repair pass.
- Validate citations and numerical claims after composition.

Verification:

- A test spy proves the composer receives no tools.
- Missing, expired, or interactive-only composition credentials produce a fixed readiness failure before composition.
- Restarting Pi before a scheduled staging run requires no interactive login.
- One full fixture produces a valid `MorningPaperEditionV1`.
- Reject invented source IDs, changed prices, bad totals, missing primary tickers, and brokerage language.
- Reject a ranked setup without trigger, invalidation, first resistance or target zone, reward-to-risk, no-chase condition, and required index or sector confirmation.
- Preserve unavailable fields, conflicts, and uncertainty.
- Prove no brokerage dependency is constructed.
- Run `npm run check:pi`.

### MR-012: Add semantic rendering and chunking

Implementation:

- Render the starter and replies from structured sections.
- Implement the split order in section 17.3.
- Freeze content, count, hashes, and order before delivery.
- Disable mentions.

Verification:

- Cover 1,999, 2,000, and 2,001-character fixtures.
- Cover emoji, long URLs, Markdown links, headings, bullets, citations, and unbroken text.
- Every final part is 2,000 characters or fewer.
- No URL or Markdown link is split.
- Part labels contain the correct final count.
- Recombining parts proves that no content was lost.
- Repeated rendering is deterministic.
- Run `npm run check:discord`.

### MR-013: Add the Discord forum publisher

Implementation:

- Add `apps/discord/src/market-research/forum-publisher.ts`.
- Create threads with `ForumChannel.threads.create(...)`.
- Resolve and verify the bot-authored starter message after thread creation, then store the returned thread ID and fetched starter message ID.
- Send ordered replies to the thread.
- Attach only trusted chart artifacts.
- Leave the normal conversational `OutboxDispatcher` behavior unchanged, except for truly generic helpers that are deliberately extracted.

Verification:

- Mock proves the publisher never calls `send` on the forum parent.
- Starter title, content, tags, attachment, and mentions are correct.
- The publisher does not send replies until the verified starter message ID is durably acknowledged.
- Replies go to the returned thread in exact order.
- Missing permissions fail without text-channel fallback.
- Chart failure does not stop text delivery.
- Discord 429 honors `Retry-After`.
- Run `npm run check:discord`.

### MR-014: Add durable orchestration and a dedicated Pi endpoint

Implementation:

- Add a Convex dispatch action that calls the actor-bound Pi service through the existing private execution boundary.
- Add a service-authenticated asynchronous Pi job endpoint and dedicated job registry.
- Let Pi heartbeat the research lease and persist evidence checkpoints through new Convex service operations.
- Let Convex queue immutable publication parts only after it accepts a strict Pi result.
- Extend the Discord service poller to claim only ready publication work.
- Add a separate `MarketResearchPublicationOrchestrator` in the Discord service.
- Add the bounded Convex recovery sweeper and continuation flow from section 6.6.
- Do not route through `ChannelLoopOrchestrator` or the current Discord research profile.

Verification:

- Convex dispatches one accepted Pi job for one due edition.
- One Pi worker claims the research lease and a second cannot claim it.
- Lease loss aborts Pi work and blocks stale writes.
- Pi restart resumes the same edition from saved evidence instead of creating another edition.
- Discord can be offline during research; publication begins when it returns.
- Repeated attempt-scoped `dispatchId` within one generation returns the same result or conflicts when input changed.
- Lease recovery increments the generation and dispatches `<editionId>:research:<generation>` without attaching to the expired attempt.
- The recovery sweep processes at most 25 records per mutation, continues bounded backlog safely, and never recovers terminal or operator-required ambiguous records.
- No source Discord message or channel-loop cursor is created.
- Run `npm run check:discord`, `npm run check:pi`, and `npm run check:convex`.

### MR-015: Add thread and reply reconciliation

Implementation:

- Add visible edition and part markers.
- Reconcile recent active and archived forum threads after uncertain starter delivery.
- Reconcile bot-authored replies using part marker and content hash.
- Resume at the first missing reply.

Verification:

- Simulate thread creation followed by lost Convex acknowledgement. Retry adopts the original thread.
- Simulate delayed thread visibility. Reconciliation waits and adopts the visible thread without creating another.
- Simulate an ambiguous create result that remains invisible through the reconciliation window. Automatic creation stops with an operator-required state.
- Simulate failure after reply 3 of 8. Retry sends 4-8 only.
- A title collision with another edition marker is ignored.
- Multiple matching markers stop automation and record a duplicate incident.
- A stale worker cannot acknowledge recovered messages.
- Run `npm run check:discord` and `npm run check:convex`.

### MR-016: Integrate chart-img after its branch lands

Implementation:

- Review the merged chart-img contract.
- Adapt `chartRequests` without copying renderer logic. Keep charts disabled until this task passes.
- Reuse the trusted in-process renderer or implement the service-authenticated Convex storage transport from section 18.
- Validate returned artifacts and preserve text fallback.

Verification:

- One approved chart appears on the intended starter or reply.
- Timeout, unsupported symbol, malformed output, and oversized output each still publish complete text.
- Chart source IDs match edition evidence.
- Cross-service artifacts fail closed on expired storage, hash mismatch, oversize bytes, bad media type, or invalid dimensions.
- No chart result changes a market fact.
- Run `npm run check:pi` and `npm run check:discord`.

### MR-017: Add observability and owner controls

Implementation:

- Add metrics and safe events from section 21.
- Show current stage and final forum link in the web control page.
- Add owner-authenticated run-now, dry-run, retry, reconcile, cancel-unstarted, enable, and disable operations.

Verification:

- UI shows live stage, safe failure, source summary, and final forum link.
- Manual dry run creates no Discord thread.
- A 07:55 preview uses a preview ID and does not block the 08:00 scheduled key.
- Manual retry does not create another published edition revision unless regeneration was explicit.
- Logs contain safe IDs and counts, not keys, article bodies, prompts, or edition bodies.
- Run `npm run check:web`, `npm run check:convex`, and `npm run check:discord`.

### MR-018: Complete the degradation and recovery matrix

Test all of these:

- Exa key missing or invalid.
- Exa credits exhausted.
- Exa rate limited or unavailable.
- Requested source denied by robots or policy.
- Structured market provider missing, stale, conflicting, or unavailable.
- Market holiday and weekend.
- Stale calendar, ad-hoc closure, and unknown session.
- Composition provider not ready, authentication required, timeout, bad schema, or unknown citation.
- Forum deleted or changed to another type.
- Bot permission removed.
- Discord rate limit.
- Thread created but acknowledgement lost.
- Thread creation remains ambiguous after the eventual-visibility window.
- Replies partially delivered.
- Chart service unavailable.
- Pi, Discord, and Convex worker restarts.
- Lease expiry and stale worker completion.

Pass condition:

- Each fixture reaches one documented state.
- No fixture creates duplicate publication.
- No fixture fabricates data.
- No fixture exposes a secret.
- Retryable cases recover within the bounded policy.
- Terminal cases stop retrying and expose a safe operator action.

### MR-019: Run full repository validation

From the repository root:

```sh
npm run check
git diff --check
```

When schema changes require generated types, run the repository's intended Convex code-generation path against the correct local or self-hosted environment before `npm run check`.

Pass condition:

- The checks actually included by `npm run check` pass, including its lint, typecheck, test, build, bundle, and Railway gates.
- Generated files match the schema and functions.
- No unrelated user change is removed or overwritten.
- No whitespace error remains.

### MR-020: Run a staging dry run and forum test

Use a private Discord test forum.

Verification:

- Run one weekday dry run without publication.
- Inspect source coverage, links, timestamps, scores, missing-data labels, cost, and section order.
- Run one published test edition.
- Starter and every reply are within Discord limits.
- The full edition appears in one thread with no missing text.
- Every source link opens to the cited source.
- No mention fires.
- Chart failure does not break the edition.
- Repeating the edition creates no second thread.
- Stop Pi during research and verify recovery.
- Restart Pi before 08:00 and prove the unattended composition provider is ready without interactive login.
- Stop Discord after several replies and verify resume.
- Remove and restore one required permission and verify safe failure and recovery.
- Inspect Railway, Convex, browser, and Discord output for secret leakage.

### MR-021: Validate the real 08:00 schedule

Verification:

- Observe a real scheduled run beginning at 08:00 in the configured timezone.
- Confirm it is not a manual or late-session substitute.
- Confirm premarket fields belong to the current premarket session.
- Confirm provider and retrieval timestamps.
- Confirm one and only one forum thread exists for that edition key.
- Validate weekend and holiday behavior through real runs when possible and deterministic fixtures otherwise.

### MR-022: Cut over from the Codex automation

Implementation:

- View the existing automation called **Market Research** before cutover. Record its exact immutable automation ID, current title, target task, schedule, status, and prompt fingerprint.
- Keep that resolved automation active until the backend produces three accepted scheduled editions. Do not rely on a guessed slug or title when changing it.
- Compare detail, coverage, citations, freshness, and missing-data behavior with the existing Market Research output.
- Obtain explicit owner approval before pausing the old automation.
- Pause it. Do not delete it.
- Record cutover date and last old-automation run.

Verification:

- Three consecutive scheduled editions meet section 23.
- The forum contains one thread per edition date.
- The old automation changes only after explicit approval.
- The paused automation ID exactly matches the reviewed Market Research automation ID.
- The new path performs no cross-task delivery and no brokerage action.

## 23. Definition of done

The feature is complete only when every condition is true:

- A durable schedule creates exactly one due edition at 08:00 market time.
- The run does not depend on a Discord message or current Pi conversation.
- Exa supplies current cited news through a server-only key.
- A permitted structured provider supplies numerical data with timestamps and session labels.
- Every primary ticker is covered or explicitly unavailable.
- The prior scoring, timeframe, trigger, invalidation, no-chase, and event-risk detail is preserved.
- The main idea fits in one forum starter.
- The complete edition appears as ordered replies with no truncation.
- The target is provably a Discord forum.
- Partial failure resumes without duplicate threads or replies.
- Chart failure does not block publication.
- Missing or conflicting data lowers confidence and remains visible.
- Every material factual claim has a retained source or calculation evidence ID.
- The Exa key never appears in runtime logs, Convex, Discord, browser output, or model input.
- Research cannot access brokerage or order tooling.
- Full repository validation passes.
- One real 08:00 staging run passes.
- Three consecutive production-like editions pass owner review.

## 24. Defaults requiring confirmation before production enablement

Implementation can proceed with these values. Record the final choice before enabling production.

| Decision | Proposed default |
| --- | --- |
| Schedule timezone | Owner must confirm; proposed `America/New_York` |
| Schedule | Every day at `08:00` |
| Weekend edition | Enabled |
| Late cutoff | `12:00` local time |
| Exa search type | `auto` |
| Exa content age | 1 hour |
| Search concurrency | 2 |
| Contents concurrency | 5 |
| Structured provider | Evaluate Exa Connect first, then license missing fields |
| Forum tags | None until selected forum tags synchronize |
| Charts | Disabled until MR-016 passes; optional afterward |
| Evidence retention | Bounded metadata and highlights; no full article body |
| Old automation | Keep active until three accepted editions and owner-approved cutover |

## 25. Implementation order

```text
MR-001 configuration
  -> MR-002 contracts
  -> MR-003 Convex state
  -> MR-004 scheduler
  -> MR-005 forum configuration
  -> MR-006 Exa client
  -> MR-007 research planner
  -> MR-008 evidence normalization
  -> MR-009 structured-provider evaluation
  -> MR-010 market data and calculations
  -> MR-011 composer
  -> MR-012 renderer and chunker
  -> MR-013 forum publisher
  -> MR-014 orchestration
  -> MR-015 recovery
  -> MR-016 chart integration
  -> MR-017 observability
  -> MR-018 failure matrix
  -> MR-019 repository validation
  -> MR-020 staging test
  -> MR-021 live 08:00 validation
  -> MR-022 controlled cutover
```

Do not start cutover while a required source, market-data, idempotency, or forum-delivery gate remains unresolved.
