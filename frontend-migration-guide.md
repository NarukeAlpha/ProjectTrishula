# Frontend Migration Guide

## Current Local Direction

The current implementation target is local-only under `/Users/gabrielalfonzo/IdeaProjects/Trading`.
Do not use `/Users/gabrielalfonzo/Documents/Agentic Trading` as an implementation workspace for FE-01.

- Electron frontend: `apps/electron`
- Swift frontend: `apps/swift`
- Shared visual/data contract: `frontend/shared/workbench-data.json`
- Local validation: `scripts/validate-local.sh`
- Snapshot review: `scripts/prepare-fe01-snapshot-review.sh`

Both Electron and Swift must implement the same FE-01 workstation: top app bar, left rail, dominant center chart, right decision panel, bottom dock, and diagnostics. Both snapshots are checked against the `1586x992` `CONCEPT.png` contract.

This guide replaces the current evidence-heavy dashboard with a focused trading workstation while preserving the existing native Swift app, tests, risk gates, audit paths, and backend adapter contract.

The repo-level concept image at `CONCEPT.png` is the stronger local target. Use it as the grounding artifact for the migration: a chart-dominant workbench, compact left rail, contextual top bar, bottom dock, and right-side ticket/risk review. The earlier Robinhood screenshot remains only a density reference, not a design target. It shows useful patterns: chart-first layout, docked positions/orders/options panels, persistent account context, compact controls, and visible order markers. It also shows what this app should avoid: duplicated chart surfaces, overloaded toolbars, cramped labels, low-information buttons, and color noise that makes every state compete for attention.

## Frontend Goal

Build a native macOS trading workbench that makes three workflows obvious:

1. Observe the market.
2. Review a proposal or manual order intent.
3. Execute paper/live-gated actions and inspect the audit trail.

The UI should feel dense, calm, and operational. It should not feel like a landing page, a proof dashboard, or a wall of verifier artifacts.

## Backend Readiness Dependency

Do not let the frontend outrun the backend. In `CONCEPT.png`, top-bar states such as `Paper Ready`, `Adapter Healthy`, rollback state, and the right-panel `Review Paper` action are visually prominent. Those labels must be bound to real Rust backend evidence, not hardcoded during the redesign.

Current backend-backed states available to the frontend plan:

- `GET /v1/status` can prove the Rust process is running and disconnected.
- `GET /v1/runtime/preflight` can prove the Rust runtime and disconnected surface are available.
- `GET /v1/capabilities` can prove the frozen route/event/failure contract and now emits the Java-wrapper-compatible `kind`, `routeCount`, route category, TWS/idempotency/exact-confirmation/async-acknowledgement flags, and capability buckets that the existing Swift readiness model expects.
- `backend-readiness` can prove all local Rust verifier traces approve in one machine-readable artifact for diagnostics and handoff. It is a local migration gate only; it does not prove real Gateway/TWS paper, live, or Flex evidence.
- `audit-idempotency`, `failure-taxonomy`, and `observability-redaction` verifiers can prove the operation-ledger safety substrate.
- `startup-safety` can prove paper/live port gates, exact live startup confirmation, and duplicate client-id rejection.
- `server-time-provenance` can prove disconnected, callback-backed connected, stale heartbeat, and reconnecting order-id-lockout states.
- `broker-session-management` can prove protocol-driven session readiness from `nextValidId` plus callback-backed `twsReqCurrentTime`, health-check rejection of disconnected or wrong-endpoint status, stale heartbeat fail-closed state, reconnecting order-id lockout, and `connection.status` event emission.
- `tws-wire-codec` can prove the Rust wire boundary round-trips length-prefixed TWS frames, emits the startup/current-time/managed-account request fields, replays readiness callbacks into the session manager, and rejects malformed payloads before callback routing. It does not prove a live Gateway/TWS session exists.
- `tws-transport-startup` can prove the async read/write harness writes startup frames, consumes callback frames, reaches ready state from managed-account plus server-time evidence, and maps connectivity loss into reconnecting state. It still uses a fake in-memory Gateway transcript.
- `tws-tcp-startup` can prove the same startup path over an actual loopback TCP socket accepted by a fake Gateway listener. It still does not prove external IBKR Gateway/TWS readiness.
- `broker-startup-config` can prove the real `--startup-mode broker` boundary: paper/live startup policy runs before connect, endpoint identity is preserved into status, startup frames are observed over deterministic TCP, and live startup rejects before opening a socket without the exact live gate.
- `http-startup-state` can prove `/v1/status` and initial `connection.status` replay reflect disconnected, connected fixture, and loopback TCP startup state without contradictory disconnected events.
- `broker-callback-routing` can prove decoded TWS startup callbacks and deterministic account, market-data, and order-routing domain callback envelopes are routed through one shared backend dispatcher into the session manager, callback stores, and event hub before the UI consumes them.
- `tws-domain-callback-decoder` can prove EWrapper-style callback records such as `accountSummary`, `position`, `orderStatus`, `execDetails`, `commissionReport`, `tickPrice`, `historicalData`, `historicalTicks`, `securityDefinitionOptionParameter`, and `tickOptionComputation` decode into the same account, market-data, order-routing, and event-hub projections the concept screen consumes.
- `tws-field-callback-decoder` can prove bounded key/value field records for `accountSummary`, `position`, `orderStatus`, `tickPrice`, and `placeOrderAcknowledgement` decode into the same account, market-data, order-routing, and event-hub projections without JSON callback payloads. It is still local fixture evidence, not external Gateway/TWS proof.
- `http-domain-callback-projection` can prove decoded EWrapper-style callback records update the HTTP-serving `AppState` behind the visible account rail, chart quote strip, open-order table, right-panel paper acknowledgement state, and event replay.
- `http-field-callback-projection` can prove decoded key/value field records update the HTTP-serving `AppState` behind the same visible account rail, chart quote strip, open-order table, right-panel paper acknowledgement state, and event replay.
- `tws-domain-stream-http-projection` can prove the TWS-framed transport reaches startup readiness, then consumes post-ready account, order, quote, and paper acknowledgement callback records into the HTTP-serving `AppState` used by the concept workbench.
- `tws-field-stream-http-projection` can prove the same post-ready transport path consumes bounded key/value field records into the HTTP-serving `AppState` used by the concept workbench.
- `account-callback-state` can prove account summaries, positions, latest open/completed orders, fills, late commission updates, lifecycle cache, replayable account/order/fill events, and Flex export rows are reconstructed from broker-style callbacks instead of a static-only fixture.
- `account-state` can prove managed paper/live accounts, account summaries, account-scoped positions, option-position data needed for exercise/lapse safety, and lossless decimal-string payloads.
- `order-lifecycle` can prove account-scoped open orders, completed orders, fills, parent/OCA linkage, late commission updates, replayable `order.status` / `fill.report` events, and Flex-exportable broker fills.
- `market-data-callback-state` can prove the chart, quote strip, historical ticks, options chain, selected option contract, option quote, IV/Greeks, and pacing evidence are reconstructed from broker-style callbacks instead of a static-only fixture.
- `market-data-streams` can prove contract details, market rules, quote snapshots, historical bars, historical ticks, connected quote subscription and bar stream start-stop state, live event fan-out, and replayable `contract.details`, `quote.snapshot`, `bars.snapshot`, and `ticks.snapshot` events. The connected Rust fixture now validates the same Swift query identity the frontend sends: `symbol`/`securityType` for contract resolution, full historical bar/tick query fields, and full underlying/option identity for chain/details/quote reads.
- `historical-pacing` can prove fail-closed historical pacing rules, `BID_ASK` request weighting, retry-after metadata, cached fallback behavior, and the stable `pacingLimit` failure code.
- `option-market-data` can prove option chains, selected option contract hydration, market-rule ids, option quotes, IV, Greeks, volume, open interest, and replayable option market-data events.
- `order-safety` can prove request-derived idempotency, mapped route/tick validation, fail-closed JSON boolean parsing, exact live/modification confirmations, and paper-only global cancel confirmation.
- `order-callback-state` can prove paper/live placement acknowledgement state, duplicate acknowledgement reuse, live option/combo acknowledgement state, modification acknowledgement, cancel response, global cancel acknowledgement, option exercise acknowledgement, and replayable order/modify/cancel/exercise events are reconstructed from broker-style callbacks instead of a static-only fixture.
- `paper-order-routing` can prove the concept's `Review Paper` path through broker preview, asynchronous paper acknowledgement, duplicate acknowledgement reuse, and reserved order/fill/failure events.
- `live-order-routing` can prove live startup gates, exact per-order live confirmation, idempotency rejection, and asynchronous live acknowledgement in a deterministic fixture.
- `live-option-combo-routing` can prove live single-leg option and vertical-spread combo route hydration, exact per-order live confirmations, route/tick rejection, single-leg combo rejection, duplicate acknowledgement reuse, and reserved order/fill/failure events in a deterministic fixture.
- `option-exercise-safety` can prove exercise/lapse action-code mapping, exact option confirmation text, JSON boolean parsing, verified option-position requirement, duplicate acknowledgement reuse, and `option.exercise` event behavior.
- Real broker execution still requires external paper/live evidence plus real Gateway/TWS callback streams for account, market-data, order, and reconciliation stores; the connected Rust fixture is for local UI development and contract verification.

Frontend implication:

- The concept's `Adapter Healthy` badge may mean "Rust process and contract healthy" for now.
- The diagnostics dock should prefer the aggregate `backend-readiness` trace as its local backend summary, then let the operator drill into individual verifier traces. Normal workbench copy should still render concise states such as `Adapter healthy`, `Fixture only`, or `External evidence pending`.
- The concept's `Adapter Healthy` badge should require `runtime-preflight`, `api-surface`, `broker-session-management`, `tws-wire-codec`, `tws-transport-startup`, `tws-tcp-startup`, `broker-startup-config`, `http-startup-state`, `broker-callback-routing`, `tws-domain-callback-decoder`, `tws-field-callback-decoder`, `http-domain-callback-projection`, `http-field-callback-projection`, `tws-domain-stream-http-projection`, and `tws-field-stream-http-projection` when showing a connected fixture or configured-startup state. When the session is stale or reconnecting, the concept's rollback indicator must stay visible and execution controls must stay locked.
- The concept's `Paper Ready` badge must not mean "real IBKR paper execution ready" until external paper Gateway/TWS evidence exists. For local development, the top bar may show `Paper route fixture ready` only when `startup-safety`, `broker-startup-config`, `broker-session-management`, `broker-callback-routing`, `tws-domain-callback-decoder`, `tws-field-callback-decoder`, `http-domain-callback-projection`, `http-field-callback-projection`, `tws-domain-stream-http-projection`, `tws-field-stream-http-projection`, `account-callback-state`, `account-state`, `market-data-callback-state`, `market-data-streams`, `order-safety`, `order-callback-state`, and `paper-order-routing` all approve.
- Account, position, order, fill, chart, historical ticks, option-chain, option-quote, right-panel `Review Paper`, live-disabled, modify/cancel, exercise/lapse, and vertical-spread combo surfaces in the concept can now bind to the Rust connected fixture. The left watchlist/account rail, saved-captures rail, bottom positions/orders/fills/options tabs, central chart and quote strip, options-chain table, and right-panel quote-age/estimated-fill rows should read from callback-backed account and market stores that are updated through the HTTP-serving `AppState` in local development. The chart's quote subscription controls should call `POST /v1/quotes/{conID}/subscribe`, use the returned generic quote snapshot immediately for the concept's top quote strip, bid/ask markers, and right-panel quote-age rows, then consume `/v1/events` fan-out for future freshness; `DELETE /v1/quotes/{conID}/subscribe` should return adapter status so the UI can keep `Adapter Healthy` and rollback state coherent after stopping a stream. Bar stream controls should still consume bar-stream acknowledgements plus `/v1/events` so target/stop annotations and chart freshness are tied to backend event state rather than local timers. The right-panel acknowledgement, duplicate-reuse, modify/cancel, and exercise/lapse states should read from callback-backed order state after route actions and post-ready stream callback ingestion, not from one-off local UI flags. Production copy must still distinguish fixture evidence from real IBKR Gateway/TWS evidence.
- The concept's left watchlist selection, chart title/quote strip, timeframe picker, options-chain row selection, and right `Order Ticket / Risk Review` panel must treat query validation as readiness. A symbol is not chartable until `GET /v1/contracts/resolve?symbol=...&securityType=STK` succeeds. Chart range controls must pass `timeframe`, `barLimit`, `duration`, `whatToShow`, and `regularTradingHoursOnly` to `/v1/bars/{conID}` and show `invalidContract` or `pacingLimit` near the chart status line instead of silently falling back. Historical ticks and quote-age rows must pass the explicit tick window and booleans. Option-chain, selected spread, quote, and Greeks rows must carry the selected underlying/expiration/strike/right identity into the option routes, and `Review Paper` should stay disabled when any selected row no longer matches the resolved backend identity.
- The concept's rollback indicator and live disabled button should bind to runtime state: stale heartbeat and reconnecting states must disable order-id allocation and keep live controls locked.
- The right-panel `Review Paper` command can call the connected Rust fixture in development and should display the asynchronous acknowledgement, duplicate reuse state, and audit/idempotency receipt. Against default disconnected runtime it must still surface the disconnected failure envelope and operation-ledger receipt.
- Diagnostics must expose the verifier names above, while the normal workbench should show concise states such as `Adapter healthy`, `Paper route fixture ready`, `Account callbacks loaded`, `Market callbacks loaded`, `Order callbacks loaded`, `Execution fixture only`, `Audit receipt recorded`, `Heartbeat stale`, `Reconnecting`, and `External broker evidence pending`.

## Current Problems

The current app has useful behavior but a poor interface shape:

- `Sources/AgenticTradingApp/AppRootView.swift` is too large and mixes navigation, chart, toolbar, panels, file import/export, and presentation details.
- `AppRootView.swift` currently keeps chart viewport state locally (`visibleBarCount`, `offsetFromEnd`), uses `NavigationSplitView`, pins the chart to a fixed 420px height, then packs options, strategy, paper account, and audit into a lower scroll region. That is the concrete layout to replace.
- `ToolbarView` currently concentrates unrelated commands (`Prices`, `IBKR`, `Options`, `Run`, `Paper`, `Reset`, artifact export/import) into one row. In the concept, these become top-bar status chips, chart tools, right-panel decision actions, dock actions, or diagnostics actions.
- `Sources/AgenticTradingAppFeature/TradingDashboardModel.swift` owns too many workflows directly, making the UI hard to reason about and hard to redesign safely.
- `Sources/AgenticTradingAppFeature/DashboardUIAccessibilityContract.swift` still has legacy Java wording in purposes and only names the old surfaces. The migration should preserve raw identifiers but update purposes/surface groupings as controls move.
- Proof and gate details are exposed as primary content instead of secondary diagnostics.
- The chart is useful but competes with strategy, account, audit, option, and route evidence panels.
- The minimum window size and fixed vertical packing create a cramped result even at 1200x850.
- Text-heavy rows make the app look like a verifier output viewer rather than a trading workstation.

Keep the behavior. Replace the presentation shape.

## Design Principles

- Chart-first, not chart-only.
- One primary chart surface at a time.
- Keep positions, orders, options, and audit accessible, but dock them below or beside the chart instead of making all of them primary.
- Show execution readiness as a concise state, with detail available on demand.
- Paper/live state must be visually unmistakable but not visually loud.
- Broker warnings and risk rejections must be visible at the decision point.
- Verifier commands, artifact names, and evidence bundle details belong in diagnostics drawers, not in the main order ticket.
- Use stable accessibility identifiers from the start.
- Prefer icon buttons with tooltips for chart tools and compact commands; use text only for primary decisions like Review, Place Paper, Arm Live Session, and Cancel.
- Avoid copying the reference screenshot's palette. Use a restrained dark workbench palette with clear but limited accent colors.

## Public Platform References Reviewed

Reviewed on June 29, 2026. These references are inspiration for workflow patterns only. Do not copy their trade dress, layouts, or branding.

| Platform | Useful Public Signals | Migration Takeaway |
| --- | --- | --- |
| [Interactive Brokers Trader Workstation Mosaic](https://www.ibkrguides.com/traderworkstation/mosaic-layout.htm) | Mosaic combines order entry, order management, charts, watchlists, quote details, scanners, and portfolio in a customizable drag/snap workspace. | Treat the app as an operator-configurable workstation, but keep this app's first version less free-form: fixed panes, explicit modes, and no hidden trading affordances. |
| [IBKR OptionTrader](https://www.ibkrguides.com/traderworkstation/optiontrader.htm) and [Option Chain & Strategy Builder](https://www.ibkrguides.com/traderworkstation/option-chain.htm) | Options workflows center on criteria-filtered chains, Greeks, and multi-leg strategy construction from the chain. | Options belong in a dense bottom-dock table plus a right-side spread/ticket builder, not in a tall evidence panel above the fold. |
| [IBKR Advanced Charts](https://www.ibkrguides.com/traderworkstation/advanced-chart.htm) | Advanced Charts emphasize interval, bar type, indicators, snapshots, undo/redo, drawing tools, and multi-chart layouts powered by TradingView. | Build the chart workspace as a first-class module with its own toolbar, overlays, drawing/marker state, and future multi-chart support. |
| [Robinhood Legend](https://robinhood.com/us/en/legend/) | Legend positions itself as a desktop platform for stocks, options, and crypto with real-time data, customizable charts, and advanced analysis tools. | Use the density and chart-first desktop posture as a reminder, not as a visual target. This app should remain private, native, research-first, and gate-heavy. |
| [Robinhood Legend widgets](https://robinhood.com/us/en/support/articles/widgets-in-robinhood-legend/) and [options chain](https://robinhood.com/us/en/support/articles/options-chain/) | Widgets expose watchlists, sortable/filterable positions and recent orders, linked rows, a side-by-side options chain, configurable columns, Greeks, and P/L chart context. | Give each dock table real sorting/filtering and row selection. Link selected rows to the chart and ticket instead of duplicating every detail everywhere. |
| [TradingView Supercharts](https://www.tradingview.com/support/solutions/43000746464-getting-started-with-supercharts/) | Supercharts organize analysis around top/left/right toolbars and a bottom panel; they combine indicators, drawing tools, screeners, news, paper trading, and broker trading. | Keep chart tools around the chart. Keep operational tables in the bottom panel. Keep order entry to the right when a broker/paper route is active. |
| [TradingView multi-chart layouts](https://www.tradingview.com/support/solutions/43000629990-leveraging-multi-chart-layouts-in-your-analysis/), [order ticket](https://www.tradingview.com/support/solutions/43000784804-what-is-an-order-ticket/), and [alerts](https://www.tradingview.com/support/solutions/43000520149-introduction-to-tradingview-alerts/) | TradingView supports multi-chart workspaces, keyboard chart switching, right-side order tickets, chart trading, shortcuts, and price/technical/watchlist alerts. | Plan for keyboard density and alerts as explicit modules. The first migration does not need full drawing tools, but it should not block them with a monolithic view model. |
| [tastytrade desktop](https://tastytrade.com/desktop-platform/) and [options tools](https://tastytrade.com/options/) | tastytrade emphasizes ladder-style active trading, an analysis tab for risk/probabilities/volatility shifts, pro charting, order chains, strategy selection, backtesting, and curve view. | Preserve this app's current risk/evidence strength, but present it as concise decision support: probability/risk/expiry/spread effects at the ticket, raw proof in diagnostics. |
| [Charles Schwab thinkorswim desktop](https://www.schwab.com/trading/thinkorswim/desktop) and [Getting Started](https://toslc.thinkorswim.com/center/howToTos/thinkManual/Getting-Started) | thinkorswim desktop is customizable, tabbed, and analysis-heavy; its sidebar exposes account balances, buying power, watchlists, quick charts, news, and configurable notifications. | Use a stable shell: narrow account/watchlist sidebar, tabbed work areas, and preferences. Do not bury account buying power or live/paper context in a secondary panel. |
| [thinkorswim options setup](https://www.schwab.com/learn/story/set-up-thinkorswim-desktop-options-trading), [alerts](https://www.schwab.com/learn/story/5-types-alerts-on-thinkorswim-platform), and [chart order visibility](https://toslc.thinkorswim.com/center/howToTos/thinkManual/charts/Chart-Style-Settings/general) | Options traders customize option-chain columns/screeners; alerts monitor positions and market conditions; chart settings can show available orders on the chart. | This app should make alerts, option-chain columns, and chart order markers durable user-facing concepts, while preserving exact confirmation gates before any execution. |

## Workstation Pattern Map

| Workstation Concern | What Strong Platforms Do Well | App Migration Decision |
| --- | --- | --- |
| Chart workspace | Put analysis tools, timeframes, indicators, drawings, order markers, and multi-chart affordances near the chart. | Extract `MarketWorkspaceModel`; move chart controls out of `AppRootView`; make order/fill/stop/target/invalidation markers part of the chart render contract. |
| Watchlists | Keep symbols narrow, scannable, sortable, and linked to the active chart/order context. | Keep the left rail, but demote dataset provenance to an inspector popover or diagnostics drawer. |
| Order ticket | Use a right-side ticket that appears at the decision point and can be launched from chart, watchlist, positions, or chain context. | Build `OrderTicketModel` as the right-panel owner for draft intent, validation, preview warnings, account, environment, and submit readiness. |
| Options chain and spreads | Use dense side-by-side chains, configurable columns, Greeks, P/L or curve views, and spread builders. | Move the chain to a dock tab and keep the selected single-leg/vertical spread ticket in the review panel. Show Greeks and expiry risk in compact rows, not paragraphs. |
| Positions, orders, fills, activity | Use sortable/filterable tables and row linking instead of showing every table all the time. | Build a resizable bottom dock with `Positions`, `Orders`, `Fills`, `Options Chain`, `Audit`, and `Diagnostics` tabs. |
| Risk warnings | Put warnings and broker preview output before submit, where the user decides. | Show stale data, missing entitlement, account mismatch, duplicate prevention, margin/commission/warnings, and exact confirmation requirements in the right review panel. |
| Alerts | Treat alerts as monitored market/position conditions, not as raw log lines. | Add an `AlertsModel` after the shell split. Start with local price, stale-data, gate-change, and order-lifecycle alerts before external notifications. |
| Keyboard density | Support fast focus movement and chart/table/ticket commands without turning every control into text. | Reserve keyboard shortcuts for navigation, chart range, active tab, ticket focus, and cancel/close review. Execution shortcuts must require armed state plus visible confirmation. |
| Theming | Use dense dark workbench palettes with clear semantic color. | Keep green/red for market and side semantics, amber for warnings, blue for selection, gray for disabled/gated states. |
| Evidence and diagnostics | Serious platforms expose logs/status somewhere, but normal trading workflows do not start with raw proof artifacts. | Preserve every evidence and audit pathway, but move verifier command names, artifact filenames, raw payloads, event transcripts, and local-vs-external evidence details into diagnostics. |

## Concrete Migration Report

### Preserve

- Native SwiftUI macOS surface and the current Swift package boundaries.
- Private research-app posture: paper-first, deterministic replay/backtesting, explicit broker adapters, and agents proposing trades rather than automatically placing real-money orders.
- `TradingDashboardModel` as a compatibility facade while frontend modules are extracted behind it.
- Existing chart primitives: candles, volume, fills, broker order references, stop/target/invalidation levels, and open order markers.
- Risk decisions, exact confirmations, idempotency, audit events, live rollback, paper/live environment separation, and local-readiness vs external-evidence status.
- Existing accessibility identifiers until equivalent identifiers exist in the new shell.
- Import/export and evidence-review workflows, but not as primary toolbar content.

### Delete Or Demote

- The proof-dashboard shape where strategy, account, audit, options, route evidence, and verifier details all compete below a fixed-height chart.
- Main-toolbar command dumping. Commands should move to chart tools, ticket footer, dock actions, or diagnostics.
- User-facing Java wording as a future product surface. Existing Java wrapper references are legacy/current-state context only; future UI copy should say `Broker connection`, `IBKR connection`, or `Local broker adapter`.
- Raw verifier command names, artifact filenames, evidence bundle names, and audit receipt filenames in normal trading views.
- Paragraph-heavy ticket rows. Replace with compact summary rows, warnings, badges, and drill-in detail.
- Always-visible options proof fields. Keep routing-gate status visible, and move proof provenance into diagnostics unless a rejected decision needs the exact reason.

### Target Screen Architecture

1. Top app bar: workspace mode, symbol, data freshness, provider, account, paper/live badge, rollback state, adapter health, and global alert count.
2. Left rail: watchlist, symbol search, local captures, saved layouts, and compact provider state.
3. Center chart workspace: chart canvas, chart toolbar, timeframe/range controls, overlays, fills, order markers, and level markers.
4. Right decision panel: `Proposal`, `Order Ticket`, `Risk`, `Preview`, `Confirm`, and `Rejected` modes, with one expanded mode at a time.
5. Bottom dock: `Positions`, `Orders`, `Fills`, `Options Chain`, `Audit`, and `Diagnostics`, each sortable/filterable where the data is tabular.
6. Diagnostics drawer: Swift-compatible capability manifest (`kind`, `routeCount`, route safety flags, market/order/risk/graph buckets), verifier status, evidence artifacts, adapter event transcript, raw audit payload, malformed WebSocket subscription failures, last failure envelope, and local-readiness vs external-evidence split.

### CONCEPT.png Composition Contract

The concept image is 1586x992. Use these proportions as the visual acceptance target, not as hardcoded pixels:

| Region | Concept Behavior | Current Swift Delta |
| --- | --- | --- |
| Top app bar | Two-tier top context: window title, workspace mode, paper/live state, preview-data state, rollback, adapter health, alerts, search/help/settings icons. | Replace the command-heavy `ToolbarView`; keep refresh/import/export commands, but move them to chart tools, dock actions, or diagnostics. |
| Left rail | Narrow rail with watchlists, saved captures, and account footer. It stays operational and scannable. | Keep `watchlist.sidebar` but stop rendering full dataset/broker provenance here; move detailed provenance into diagnostics or an inspector popover. |
| Center header | Symbol, venue, favorite/info, large last price, change, bid/ask, high/low/volume. | Promote selected instrument and quote state out of the old dataset summary and bind it to Rust quote/status responses. |
| Chart workspace | Chart dominates the viewport, includes timeframe strip, indicator/draw/tool icons, order markers, stop/target/invalidation labels, bid/ask ladder labels, volume, and range footer. | Remove the fixed 420px chart assumption. The chart should flex between top bar and dock while preserving stable dimensions for markers and labels. |
| Bottom dock | Tabs for positions, orders, fills, options chain, audit, diagnostics. Options chain is table-dense and row-linked to the right ticket. | Replace the always-visible lower scroll stack with one selected dock tab. Do not show strategy, account, audit, and options all at once. |
| Right panel | Segmented `Proposal` / `Ticket` / `Risk` / `Preview`, compact order controls, risk summary, warnings, broker preview, and two footer actions: disabled `Live` and primary `Review Paper`. | Move `StrategyPanel`, `ExecutionTicketView`, `LiveExecutionControlsView`, routing gates, and preview output into one mode-driven decision panel. |

At 1200x850, the first viewport must still show all six regions: top app bar, left rail, chart, right panel, bottom dock, and collapsed diagnostics affordance. If a region cannot fit, reduce density inside the region; do not collapse the chart or push the right panel below the fold.

### Pixel-Grounded Region Map

Use this map when reviewing screenshots against `CONCEPT.png`. Coordinates are approximate visual bounds from the 1586x992 concept image; they are a review aid, not implementation constants.

| Region | Approx. Concept Bounds | Share Of Concept | What Must Survive At 1200x850 |
| --- | --- | --- | --- |
| Window chrome and global app bar | `x=0-1586`, `y=0-84` | full width, about 8% height | Native title, workspace mode, paper/live state, preview-data state, rollback, adapter health, alerts, and search/help/settings controls stay compact. |
| Left rail | `x=0-266`, `y=84-992` | about 17% width | Watchlists, saved captures, and account footer stay visible without becoming a proof/sidebar dump. |
| Center instrument header and tool strip | `x=266-1258`, `y=84-178` | about 63% width | Symbol, venue, quote, bid/ask, high/low/volume, timeframe, indicators, drawing tools, and chart commands sit above the chart without becoming the dominant toolbar. |
| Center chart and volume | `x=266-1258`, `y=178-600` | about 43% height | Candles, volume, order markers, target/stop/invalidation levels, bid/ask labels, and range footer remain the largest visual object. |
| Bottom dock | `x=266-1258`, `y=600-950` | about 35% height | Positions, Orders, Fills, Options Chain, Audit, and Diagnostics are tabs; dense table content replaces the current always-stacked evidence panels. |
| Right decision panel | `x=1258-1586`, `y=84-950` | about 21% width | Proposal/Ticket/Risk/Preview mode, compact ticket fields, risk summary, warnings, broker preview, disabled Live, and primary Review Paper remain visible as one decision surface. |
| Footer/action strip | `x=0-1586`, `y=950-992` | full width, about 4% height | Account status and secondary actions can live here, but this strip must not become required to understand whether a paper action is safe. |

Image-derived acceptance checks:

- The first viewport reads left-to-right as navigation, market inspection, decision, with diagnostics reachable but not expanded.
- The center chart plus bottom dock is wider than the left rail and right panel combined.
- The right decision panel starts near the top of the instrument workspace and remains vertically aligned with the chart and dock; it is not a lower-page form.
- The bottom dock is dense and tabbed. It should never look like six independent cards stacked below the chart.
- The only normally visible proof language is concise state copy. Verifier names, evidence filenames, audit receipt filenames, and raw JSON belong in Diagnostics.

### FE-01 Layout Geometry

Use `CONCEPT.png` as a proportional layout contract. The image is 1586x992 and reads roughly as:

- Left rail: 16-17% of window width, fixed enough for symbols and saved captures.
- Right decision panel: 20-21% of window width, fixed enough for ticket controls and warnings.
- Center workspace: remaining width, with the chart as the largest visual object.
- Top app bar plus instrument header/tool strip: compact, not taller than the chart needs.
- Bottom dock: roughly one third of the content height when expanded, with options-chain density preserved.

For the first SwiftUI shell, use responsive constraints rather than hardcoded concept pixels:

| Region | Recommended Constraint | Failure Mode To Avoid |
| --- | --- | --- |
| App window | Keep existing minimum launch support, but design and test at 1200x850 and a wider workstation size. | Layout that only works at 1586x992. |
| Left rail | `minWidth` around 210, ideal around 240-265, max around 300. | Watchlist rows wrapping or rail expanding until the chart is squeezed. |
| Right panel | `minWidth` around 280, ideal around 310-335, max around 380. | Ticket controls wrapping into tall forms or pushing the panel below the chart. |
| Center chart | Minimum useful chart canvas height around 330 at 1200x850; ideal chart+volume height should exceed bottom dock height. | Repeating the current fixed 420px chart inside a vertical evidence page. |
| Bottom dock | Collapsible/resizable with a useful expanded height around 250-320 at 1200x850. | Showing every table/panel simultaneously or hiding options-chain rows behind a scroll trap. |
| Top app bar | Two compact rows max: global context and instrument/quote context. | Rebuilding the old toolbar as a long row of text buttons. |

SwiftUI shell shape for `FE-01`:

```swift
VStack(spacing: 0) {
    TopAppBar(...)
    HSplitView {
        LeftRail(...)
        VSplitView {
            MarketWorkspace(...)
            BottomDock(...)
        }
        RightDecisionPanel(...)
    }
}
```

This is illustrative, not a mandate to use exactly those type names. The important constraint is ownership: the top app bar owns context, left rail owns navigation, center owns chart/market inspection, bottom dock owns tables, and right panel owns the current decision. `AppRootView` should compose these regions and forward intents; it should not decide broker workflow outcomes.

Layout acceptance for `FE-01`:

- At 1200x850, the top app bar, left rail, chart, right decision panel, bottom dock tabs, and diagnostics affordance are all visible without vertical scrolling the whole app.
- The chart remains visually dominant: no dock, rail, or right-panel content may make the chart feel like a small preview.
- `Review Paper` is visible in the right panel footer when a reviewable paper route exists; disabled `Live` is visible next to it but cannot be mistaken for an enabled action.
- `Diagnostics` is present as a dock tab or collapsed affordance, but raw verifier names, JSON payloads, evidence bundle filenames, and audit receipt filenames are absent from the normal first viewport.
- The current accessibility identifiers remain queryable after recomposition, even if the visible control moves to a different region.

### Frontend Boundary Targets

| Boundary | Owns | Must Not Own |
| --- | --- | --- |
| `WorkbenchState` | selected symbol, workspace mode, active dock tab, right-panel mode, selected row ids, layout density | market data fetching, risk logic, broker submission |
| `MarketWorkspaceModel` | chart render model, visible range, overlays, marker projection, chart tool state | account selection, order placement |
| `OrderTicketModel` | draft intent, order type fields, validation state, broker preview state, submit readiness | portfolio accounting, adapter transport details |
| `RiskReviewModel` | concise risk decision summary, stale-data/account/permission warnings, required confirmations | raw verifier transcript or evidence bundle storage |
| `OptionsChainModel` | expirations, strikes, calls/puts, selected contract, Greeks, spread-builder state | global account state or raw adapter diagnostics |
| `PortfolioModel` | positions, buying power, exposure, session P&L, selected account summary | chart drawing or proposal generation |
| `OrderLedgerModel` | open orders, completed orders, fills, lifecycle status, row filters | strategy proposal scoring |
| `AuditTimelineModel` | filtered audit events, user-facing audit summaries, selected raw payload id | normal decision-panel copy |
| `DiagnosticsModel` | capability summary, verifier states, evidence files, event transcript, failure envelope | normal order-ticket submit state |

### Evidence Separation Rule

| Normal Workbench Copy | Diagnostics Copy |
| --- | --- |
| `Paper ready`, `Live disabled`, `Stale quote`, `Missing entitlement`, `Route rejected`, `External evidence pending` | verifier command names, artifact filenames, evidence bundle names, audit receipt filenames, raw request/response JSON, raw event transcript |
| selected account, environment, request id, quote age, warning count | full capability manifest, failed checklist ids, local evidence trace, external evidence checklist |
| broker preview warning text that changes the decision | full failure envelope and adapter transcript |

Normal workbench copy must be enough to make or reject a decision. Diagnostics copy must be enough to debug or hand off an evidence session.

### Concept Region Backend Binding Matrix

The first frontend slice must not hardcode the concept labels just to match the screenshot. Each visible region needs an explicit backend source, a fail-closed state, and a test or verifier that proves the binding.

| Concept Region | Visible State Or Action | Backend Source | Fail-Closed UI State | Acceptance Evidence |
| --- | --- | --- | --- | --- |
| Top app bar | Adapter health, paper/live environment, rollback/reconnecting state, active account, alert count | `GET /v1/status`, `GET /v1/runtime/preflight`, `GET /v1/capabilities`, initial `connection.status` from `/v1/events` | Show `Disconnected`, `Heartbeat stale`, `Reconnecting`, or `External evidence pending`; lock live controls | Rust `runtime-preflight`, `api-surface`, `http-startup-state`, and `server-time-provenance` verifiers; Swift dashboard surface verifier still decodes the status/capability shape |
| Left rail | Watchlist selection, selected account footer, saved capture/provider state | `GET /v1/contracts/resolve`, `GET /v1/accounts`, `GET /v1/accounts/{accountID}/summary`, capture metadata from existing Swift model | Symbol row can be selected, but chart/ticket stay unresolved until contract identity succeeds; account footer shows unavailable rather than inventing buying power | Contract-resolution route test, account-state verifier, and existing watchlist accessibility identifiers remain queryable |
| Center chart | Symbol header, quote strip, candles, volume, stop/target/invalidation, order/fill markers, stream state | `GET /v1/quotes/{conID}`, `POST/DELETE /v1/quotes/{conID}/subscribe`, `GET /v1/bars/{conID}`, `POST/DELETE /v1/bars/{conID}/stream`, `/v1/events` quote/bar/order/fill events | Chart remains visible with compact `invalidContract`, `pacingLimit`, `stale quote`, or `stream stopped` state instead of silent fallback data | `market-data-streams`, `historical-pacing`, `market-data-callback-state`, `order-lifecycle`, and chart surface tests prove markers and query identity |
| Bottom dock | Positions, orders, fills, options chain, audit, diagnostics rows and selected row handoff | `GET /v1/accounts/{accountID}/positions`, open/completed order routes, fills route, option chain/details/quote routes, audit/export state, diagnostic verifier state | Tables show empty/unavailable states scoped to the active account or selected contract; selected rows cannot populate the ticket if backend identity is stale | `account-callback-state`, `account-state`, `order-lifecycle`, `option-market-data`, and existing option/audit workflow tests |
| Right decision panel | Proposal, ticket, risk, preview, disabled live action, primary `Review Paper`, acknowledgement/replay state | `POST /v1/orders/preview`, `POST /v1/orders/paper`, `POST /v1/orders/live`, modify/cancel/exercise routes, order callback state, operation ledger receipts | `Review Paper` disabled when route identity, quote freshness, account, market rule, idempotency, or paper session readiness fails; `Live` remains disabled unless live gates and external evidence are satisfied | `order-safety`, `order-callback-state`, `paper-order-routing`, `live-order-routing`, `live-option-combo-routing`, and dashboard paper/live workflow tests |
| Diagnostics | Capability manifest, verifier names, event transcript, raw failure envelope, audit receipt, external evidence checklist | `GET /v1/capabilities`, `/v1/events`, verifier JSON, audit receipts, native evidence audit receipts | Diagnostics can show raw artifacts; normal workbench regions only show concise decision copy | `ibkr-verify-dashboard-surface`, native UI evidence preflight/audit, and screenshot review prove diagnostics are reachable but not primary |

Binding rule: if the Rust adapter cannot prove a region's state, the frontend should render an unavailable, fixture-only, stale, rejected, or external-evidence-pending state. It should not fill the concept shell with optimistic placeholder values that make paper/live readiness look stronger than the backend evidence.

### Concept Snapshot Review Checklist

Use this checklist whenever a frontend slice changes `AppRootView`, chart layout, the right decision panel, the bottom dock, or diagnostics. The review is visual and behavioral; a passing model test is not enough if the screen drifts back toward the old evidence dashboard.

Required first-viewport evidence at `1200x850` and one wider workstation size:

- The top app bar, left rail, chart workspace, right decision panel, bottom dock tabs, and diagnostics affordance are all visible at the same time.
- The chart is the dominant region. It must show candles, volume, bid/ask or last-price context, and stop/target/invalidation/order markers when those backend-backed render inputs exist.
- The right decision panel footer keeps disabled `Live` and primary `Review Paper` visible without scrolling the entire app.
- The bottom dock can show the options chain as a dense table while the chart and right ticket remain visible. Positions, orders, fills, audit, and diagnostics must be reachable as tabs rather than stacked panels.
- The left rail stays narrow and operational. It shows watchlist/capture/account context but does not expand into a provenance or verifier wall.
- Diagnostics are reachable but visually secondary. Raw verifier names, JSON payloads, evidence bundle filenames, and audit receipt filenames should not appear in the normal chart/ticket viewport.
- Backend-bound labels are honest: disconnected, stale, fixture-only, rejected, and external-evidence-pending states must be visible when the Rust adapter cannot prove readiness.
- Text does not overlap or clip inside the top bar, watchlist rows, chart labels, option-chain cells, risk rows, or footer buttons.

Use the existing Agentic Trading evidence tools after shell-affecting changes:

```sh
cd "/Users/gabrielalfonzo/Documents/Agentic Trading"
DEVELOPER_DIR=/Users/gabrielalfonzo/Documents/Xcode-beta.app/Contents/Developer swift test
./scripts/collect-native-ui-evidence.sh
./scripts/audit-native-ui-evidence.sh <evidence-dir>
swift run AgenticTradingResearch ibkr-verify-dashboard-surface --output <path>
swift run AgenticTradingResearch ibkr-verify-native-ui-evidence-preflight --output <path>
```

The screenshot review should compare against `CONCEPT.png`, not against the current app. The intended first screen is a trading workstation with proof available on demand, not a debug/proof page with a chart embedded in it.

### Rust-Backed Frontend Development Loop

Frontend slices should run against the Rust adapter whenever they claim backend-bound state. Use `connected-fixture` for local UI work because it serves callback-backed account, quote, option, and order-routing projections without requiring a real Gateway/TWS session:

```sh
cd "/Users/gabrielalfonzo/IdeaProjects/Trading"
cargo run -- serve --startup-mode connected-fixture --listen 127.0.0.1:8765
```

Then point the existing Swift frontend client at `http://127.0.0.1:8765` and `ws://127.0.0.1:8765/v1/events` through the current Java-named environment variables until the Swift rename phase lands. The names are legacy compatibility; the process behind them should be this Rust adapter for migration work.

Current Swift bootstrap keys from `TradingDashboardBootstrapConfiguration`:

| Environment Variable | Value For Rust Fixture UI Work | Notes |
| --- | --- | --- |
| `AGENTIC_TRADING_MARKET_DATA_PROVIDER` | `ibkr-java-wrapper` | Also accepts `ibkr`, `java-wrapper`, and `interactive-brokers`; the legacy key `AGENTIC_TRADING_MARKET_DATA_MODE` is still accepted. |
| `AGENTIC_TRADING_JAVA_WRAPPER_BASE_URL` | `http://127.0.0.1:8765` | Must be absolute `http` or `https`; invalid values force preview mode. |
| `AGENTIC_TRADING_JAVA_WRAPPER_EVENTS_URL` | `ws://127.0.0.1:8765/v1/events` | Must be absolute `ws` or `wss`; invalid values are ignored and derived from the base URL. |
| `AGENTIC_TRADING_ROUTING_EVIDENCE_REVIEWS_PATH` | optional absolute path | Only use when testing reviewed paper gates loaded from audited routing evidence. |

Native app/snapshot smoke commands:

```sh
cd "/Users/gabrielalfonzo/Documents/Agentic Trading"
AGENTIC_TRADING_MARKET_DATA_PROVIDER=ibkr-java-wrapper \
AGENTIC_TRADING_JAVA_WRAPPER_BASE_URL=http://127.0.0.1:8765 \
AGENTIC_TRADING_JAVA_WRAPPER_EVENTS_URL=ws://127.0.0.1:8765/v1/events \
DEVELOPER_DIR=/Users/gabrielalfonzo/Documents/Xcode-beta.app/Contents/Developer \
swift run AgenticTradingApp

AGENTIC_TRADING_MARKET_DATA_PROVIDER=ibkr-java-wrapper \
AGENTIC_TRADING_JAVA_WRAPPER_BASE_URL=http://127.0.0.1:8765 \
AGENTIC_TRADING_JAVA_WRAPPER_EVENTS_URL=ws://127.0.0.1:8765/v1/events \
DEVELOPER_DIR=/Users/gabrielalfonzo/Documents/Xcode-beta.app/Contents/Developer \
swift run AgenticTradingApp --render-native-ui-snapshot /tmp/agentic-trading-rust-fixture-snapshot.png
```

The snapshot command renders the current Swift app at `1200x850`, which is the minimum concept-review viewport. After `FE-01`, that snapshot should show the same first-viewport composition as `CONCEPT.png`: top app bar, narrow left rail, dominant chart, right decision panel, bottom dock tabs, and collapsed diagnostics. Before `FE-01`, it is only a baseline proof that the legacy shell still launches against the Rust fixture.

Minimum HTTP smoke path for a shell or chart/ticket slice:

```sh
curl -s http://127.0.0.1:8765/v1/status
curl -s http://127.0.0.1:8765/v1/runtime/preflight
curl -s http://127.0.0.1:8765/v1/capabilities
curl -s "http://127.0.0.1:8765/v1/contracts/resolve?symbol=AAPL&securityType=STK"
curl -s http://127.0.0.1:8765/v1/accounts/DU1234567/summary
curl -s http://127.0.0.1:8765/v1/quotes/265598
curl -s "http://127.0.0.1:8765/v1/bars/265598?timeframe=1m&barLimit=3&duration=1%20D&whatToShow=TRADES&regularTradingHoursOnly=true"
curl -s "http://127.0.0.1:8765/v1/options/chains/265598?symbol=AAPL&exchange=SMART&primaryExchange=NASDAQ&currency=USD&localSymbol=AAPL&tradingClass=NMS&timezoneIdentifier=America%2FNew_York"
curl -s http://127.0.0.1:8765/v1/market-rules/26
curl -s -X POST http://127.0.0.1:8765/v1/quotes/265598/subscribe
curl -s -X POST http://127.0.0.1:8765/v1/bars/265598/stream
cargo run --quiet -- verify backend-readiness --output /tmp/agentic-trading-rust-backend-readiness.json
```

Expected local fixture signals:

- `/v1/status` reports `connectionState: connected`, `serverTimeProvenance.source: twsReqCurrentTime`, and paper environment.
- `/v1/capabilities` reports `apiVersion: ibkr-local-adapter.v1`, Java-wrapper-compatible `kind`, `routeCount`, route safety flags, event names, and external evidence gates.
- Contract resolution returns AAPL `conID` `265598`; the concept shell should not treat a symbol as chartable before this succeeds.
- The quote route returns delayed AAPL bid/ask data; the chart quote strip, bid/ask markers, and right-panel quote-age rows should bind here or to event fan-out, not local UI timers.
- Bars and market-rule routes return validated timeframe and tick-increment data; ticket price controls should use the returned ladder.
- The options-chain route returns strikes/rights for the bottom dock; selected option identity must be carried into the right ticket before `Review Paper` can enable.
- Quote and bar stream start routes should update stream state through backend acknowledgements and `/v1/events`, not local toggles.
- The backend-readiness trace should report equal `localVerifierCount` and `approvedVerifierCount`; the concept shell may show this as local backend health, not as external broker completion.

`connected-fixture` and `tcp-fixture` are local development evidence only. They can justify labels such as `Adapter healthy` or `Paper route fixture ready`; they cannot justify `real IBKR paper ready`, live readiness, or goal completion. Production copy must stay explicit when external Gateway/TWS evidence is still pending.

## Target Workbench Layout

### Top App Bar

Purpose: global context and mode.

Content:

- Workspace selector: `Research`, `Paper`, `Live Review`.
- Provider state: preview, delayed, realtime, stale, disconnected.
- Paper/live environment badge.
- Active account display.
- Kill switch / rollback state.
- Adapter health icon with details popover.

Do not put every action here. The top bar is context, not a command dump.

### Left Rail

Purpose: instrument navigation and saved research state.

Content:

- Watchlist symbols.
- Current symbol search.
- Saved datasets / captures.
- Compact provider data state.

Keep it narrow and scannable. The full market-data provenance belongs in an inspector drawer.

### Center Chart Workspace

Purpose: primary market inspection.

Content:

- Candles and volume.
- Bid/ask/last labels.
- Position average price.
- Stop, target, invalidation, bracket, and order markers.
- Crosshair, pan, zoom, timeframe, and visible-range controls.
- Optional overlay toggles: volume profile, moving averages, fills, Time & Sales.

The chart should own most of the first viewport. It needs stable dimensions, not a fixed 420px height embedded among text panels.

### Right Review Panel

Purpose: the current decision.

Modes:

- `Proposal`: thesis, evidence, invalidation, stop, target, confidence, failure modes.
- `Order Ticket`: side, quantity, order type, limit/stop/trailing fields, account, environment.
- `Risk`: approved/rejected checks, exposure, duplicate prevention, stale data, session loss, cooldown.
- `Preview`: broker warnings, commission/margin, required confirmations.

Only one mode should be expanded at a time. This is the main replacement for the current strategy/account/audit text spread.

### Bottom Dock

Purpose: operational tables that should stay one click away.

Tabs:

- `Positions`
- `Orders`
- `Fills`
- `Options Chain`
- `Audit`
- `Diagnostics`

The bottom dock can be resizable. It should not force every table to be visible at once. Tables should support sorting, filtering, and row selection.

### Diagnostics Drawer

Purpose: keep the proof machinery available without making it the product.

Content:

- Capability manifest summary.
- Verifier status.
- Evidence bundle links.
- Adapter event transcript.
- Raw audit payload.
- Last failure envelope.
- Local readiness vs external evidence status.

This drawer is for development, operator handoff, and post-trade inspection. It should not be visible by default during normal chart review.

## Visual Direction

Use a dark professional workbench, not a neon trading clone.

Ground visual reviews against `CONCEPT.png`:

- Keep the first viewport organized as left rail, chart workspace, right decision panel, and bottom dock. Do not drift back to a single vertical evidence stack.
- Let the chart own the visual center. In the concept, the chart plus volume panel is the dominant object, with bid/ask, stop, target, invalidation, and order markers readable without opening diagnostics.
- Keep the left rail narrow and operational: watchlists, saved captures, and account context. It should support fast symbol switching, not become another evidence surface.
- Keep the right panel decision-focused. The concept's `Proposal`, `Ticket`, `Risk`, and `Preview` tabs are the right level of segmentation; they should not all expand at once.
- Keep the bottom dock table-dense. The options chain in the concept is useful because it is tabular, sortable-looking, and connected to the selected strategy summary instead of being explained in paragraphs.
- Keep diagnostics collapsed by default. The concept already labels diagnostics as collapsed; preserve that posture so proof artifacts remain available but do not dominate trading work.
- Keep semantic color restrained: green/red for market and side semantics, amber for risk/warnings, blue for active selection. Avoid adding decorative accent colors that compete with trade state.
- Keep button text sparse. In the concept, the only large command is `Review Paper`; most other affordances are compact modes, tabs, segmented controls, or icon buttons.

Recommended palette:

- Background: near-black neutral.
- Surfaces: two dark gray levels.
- Grid/lines: low-contrast neutral.
- Buy/up: green, limited to market movement and buy decisions.
- Sell/down: red or orange-red, limited to market movement and sell decisions.
- Informational accent: blue for selection and active tools.
- Warning: amber.
- Disabled/gated: muted gray with clear text.

Avoid using green and orange as general decoration. In a trading app those colors carry semantic meaning.

Typography:

- Use compact macOS system typography.
- Keep numeric columns tabular.
- Avoid hero-scale headings.
- Use short labels and tooltips rather than paragraphs in the main workbench.

Spacing:

- Use dense but consistent spacing.
- Keep rows aligned.
- Do not put cards inside cards.
- Use split panes and table bands instead of decorative floating panels.

## First Frontend Slice

Build the first slice as the exact `CONCEPT.png` shell with live data boundaries, not as a visual-only mock. The purpose is to prove that the backend-backed workbench can replace the current dashboard shape while keeping order gates and diagnostics intact.

### Slice 1A: Workbench Shell

Deliverables:

- Fixed first-viewport layout: left rail, center chart workspace, right decision panel, bottom dock, and compact top app bar.
- Top app bar owns `Research` / `Paper` / `Live Review`, provider freshness, rollback state, adapter health, alert count, and active account summary.
- Left rail owns watchlists, selected symbol, saved captures, and compact account footer.
- Bottom dock owns tab selection and stable heights for `Positions`, `Orders`, `Fills`, `Options Chain`, `Audit`, and `Diagnostics`.

Acceptance:

- The first render visually matches the composition of `CONCEPT.png`: chart dominant, right ticket visible, bottom options/dock visible, diagnostics collapsed.
- Existing accessibility identifiers remain available or are mapped to equivalent identifiers.
- No verifier artifact names or raw JSON payloads appear in the first viewport unless `Diagnostics` is selected.

### Slice 1B: Route-Bound Market Context

Deliverables:

- Watchlist selection resolves through `GET /v1/contracts/resolve?symbol=...&securityType=STK` before the chart, quote strip, ticket, or options chain can claim a current instrument.
- Chart timeframe/range controls call `/v1/bars/{conID}` with `timeframe`, `barLimit`, `duration`, `whatToShow`, and `regularTradingHoursOnly`.
- Quote-age and Time & Sales rows use `/v1/quotes/{conID}` and `/v1/ticks/{conID}` with explicit tick windows and boolean query fields.
- Options chain rows carry underlying, expiration, strike, right, exchange, currency, trading class, and multiplier into option details and quote routes.
- Bottom-dock `Orders` and `Fills` views read from `/v1/accounts/{accountID}/orders/open`, `/v1/accounts/{accountID}/orders/completed`, and `/v1/accounts/{accountID}/fills`; the concept's chart markers and selected strategy footer should not infer completed state from local UI actions.
- Ticket limit/stop controls and option-chain strategy rows read tick increments from `/v1/market-rules/{marketRuleID}`. Use the returned `increments` ladder, not a hardcoded penny tick.
- Chart stream controls preserve backend lifecycle state: start uses `POST /v1/bars/{conID}/stream`, stop uses `DELETE /v1/bars/{conID}/stream`, and WebSocket bar subscriptions must resend the selected Swift-shaped timeframe so `bars.snapshot` updates do not cross-talk between chart ranges. The UI should show stopped vs active instead of treating stream toggles as local state.

Acceptance:

- Wrong symbol, wrong option row, invalid timeframe, invalid tick count, disconnected adapter, stale quote, and pacing failure each produce a visible but compact chart/ticket state.
- `Review Paper` stays disabled when route identity validation fails or the selected option no longer matches backend identity.
- The concept's quote strip, bid/ask markers, quote-age row, and estimated-fill row all read from backend responses instead of local fixture assumptions.
- Completed orders, fills, market-rule increments, bar-stream stop acknowledgements, and timeframe-scoped WebSocket bar subscriptions are covered by backend tests before the frontend shell claims them as ready.

### Slice 1C: Ticket And Risk Decision Loop

Deliverables:

- Right panel tabs stay mutually exclusive: `Proposal`, `Ticket`, `Risk`, and `Preview`.
- The ticket footer has exactly two high-visibility actions: locked `Live` and primary `Review Paper`.
- Broker preview warnings, estimated commission/margin, stale-data warnings, and exact confirmation requirements render in the right panel, not in diagnostics.
- Audit receipt, failure envelope, raw verifier status, and event transcript drill into the `Diagnostics` dock tab.

Acceptance:

- A paper review can show accepted, rejected, duplicate-idempotency replay, disconnected, and pacing-limit states without moving the user out of the right panel.
- Live remains visually disabled unless the backend state is live-gated and external evidence requirements are satisfied.
- The bottom dock selected row can populate the ticket without duplicating every row detail in the right panel.

### Executable Frontend Tickets

Treat these as the first implementable tickets for a frontend migration thread. Each ticket should be merged only with tests and screenshot evidence for the region it changes.

| Ticket | Concept Region | Code Owners | Work | Acceptance |
| --- | --- | --- | --- | --- |
| `FE-01 WorkbenchState shell` | Top bar, left rail, center chart, right panel, bottom dock | `AppRootView.swift`, new `WorkbenchState` in `AgenticTradingAppFeature`, `DashboardUIAccessibilityContract.swift` | Add view-only state for workspace mode, selected right-panel tab, selected dock tab, diagnostics visibility, and chart range. Keep `TradingDashboardModel` as the data facade. Recompose `AppRootView` into named child regions while preserving existing actions and the FE-01 layout geometry above. | `TradingDashboardModelWorkflowTests.testDashboardBootstrapDefaultsToPreviewMode`, `AgenticTradingAppSmokeTests.testAppLaunchesNativeWindow`, and `ibkr-verify-dashboard-surface` still pass. `visibleBarCount` and `offsetFromEnd` no longer live directly in `AppRootView`, and the first viewport still shows top app bar, left rail, chart, right panel, bottom dock tabs, and diagnostics affordance at 1200x850. |
| `FE-02 Top app bar and left rail` | Concept top app bar and watchlist rail | `ToolbarView`, `DatasetSummaryView`, `EnvironmentStatusLabel`, `DashboardUIAccessibilityContract.swift` | Replace the old command toolbar with status chips and compact mode controls. Move refresh/import/export commands to chart tools, dock actions, or diagnostics. Keep watchlist/captures narrow; move detailed market-data and broker provenance out of the rail. | First viewport shows `Research`, paper/live state, preview-data state, rollback, adapter health, and alerts without exposing raw verifier names. Existing identifiers `watchlist.sidebar`, `data.refreshPrices`, and `ibkr.refreshStatus` remain reachable or get explicit replacements with contract coverage. |
| `FE-03 Chart workspace` | Center chart header, tool strip, chart, range footer | `CandleChartView.swift`, `ChartControlsView`, new `MarketWorkspaceModel` | Keep the renderer but wrap it in a chart workspace with symbol header, quote strip, timeframe/range controls, bid/ask labels, stop/target/invalidation/order markers, and backend failure badges. Remove fixed 420px chart height in favor of split-pane layout constraints. | `testDashboardRefreshesMarketDataRunsEvaluationAndExportsArtifacts`, `testDashboardChartSurfaceProjectsConcretePriceLevelsWithoutInventingTrailingPrices`, and `nativeUIContractMatchesChartRender` remain green. Screenshot comparison shows chart remains dominant at 1200x850. |
| `FE-04 Right decision panel` | Right `Proposal` / `Ticket` / `Risk` / `Preview` panel | `StrategyPanel`, `ProposalReviewView`, `ExecutionTicketView`, `LiveExecutionControlsView`, new `OrderTicketModel` and `RiskReviewModel` | Move proposal, route, ticket, risk, preview, live gate, and paper review controls into one mode-driven right panel. The footer should expose disabled `Live` and primary `Review Paper`; exact live confirmations appear only in live review mode. | Paper, option, bracket, spread, and live workflow tests remain green, especially `testDashboardExecutesSelectedIBKRPaperProposalThroughAdapter`, `testDashboardExecutesIBKRLiveProposalOnlyThroughDedicatedConfirmedFlow`, and live rejection tests. Verifier/artifact filenames do not appear unless diagnostics is selected. |
| `FE-05 Bottom dock tables` | Positions, orders, fills, options chain, audit, diagnostics dock | `OptionsPanel`, `PaperAccountPanel`, `AuditLogPanel`, new `PortfolioModel`, `OrderLedgerModel`, `OptionsChainModel`, `AuditTimelineModel` | Replace the lower scroll stack with tabbed/resizable dock content. Options chain becomes the default dense table when options are loaded; selected chain rows feed the right ticket. Paper account and audit become dock tabs rather than always-visible columns. | `testDashboardRefreshesIBKROptionsSnapshotShowsChainQuoteRiskAndPreview`, `testDashboardSelectsIBKROptionContractFromChain`, and audit/paper-account workflow tests stay green. First viewport no longer shows options, strategy, account, and audit simultaneously. |
| `FE-06 Diagnostics and evidence split` | Collapsed diagnostics affordance and diagnostics dock tab | new `DiagnosticsModel`, `DashboardUIAccessibilityContract.swift`, evidence import/export call sites | Move capability manifest, verifier status, raw audit payloads, event transcript, evidence bundle names, audit receipt names, and malformed WebSocket subscription failures into diagnostics. Normal workbench copy stays concise. | `ibkr-verify-dashboard-surface`, `ibkr-verify-native-ui-evidence-preflight`, and native UI evidence audit prove diagnostics are reachable while the primary workbench is not a debug trace viewer. |

Do not combine all six tickets into one frontend edit. The UI already has enough behavior that a single giant patch would make regressions hard to isolate.

## Concrete File Handoff

Use the existing SwiftUI files as compatibility anchors while extracting workflow modules behind them. The first frontend agent should not start by deleting the current dashboard; it should make the current dashboard compose the new workbench layout and then move behavior out behind stable test seams.

### FE-01 Current-State Inventory

This inventory is based on the live Swift sources and `CONCEPT.png`. It should be refreshed before the first frontend patch if the upstream app changes.

Current source shape:

| Current File Or Symbol | Current Responsibility | Concept Delta |
| --- | --- | --- |
| `Sources/AgenticTradingApp/AppRootView.swift` | Owns the root `NavigationSplitView`, watchlist list, toolbar, error/status banners, fixed-height chart, chart steppers, options panel, strategy panel, paper account panel, audit log panel, save/open panels, and async command buttons. It is currently about 1,458 lines. | Convert it into composition only: `TopAppBar`, `LeftRail`, `MarketWorkspace`, `RightDecisionPanel`, `BottomDock`, and diagnostics affordance. It should forward intents into `TradingDashboardModel`, not decide workflow layout and broker outcomes inline. |
| `@State visibleBarCount` and `@State offsetFromEnd` in `AppRootView` | Chart viewport state is owned by the root view and passed directly to `CandleChartView` and `ChartControlsView`. | Move into `WorkbenchState` or `MarketWorkspaceModel` so the concept's timeframe/range strip belongs to the chart workspace instead of global root state. |
| `NavigationSplitView` plus `CandleChartView(...).frame(height: 420)` | The app is split into a sidebar and detail page, then the chart is pinned to 420px above a lower scroll region. | Replace with the concept's persistent workstation geometry: top bar, narrow left rail, dominant chart center, right decision panel, and bottom dock visible at `1200x850`. |
| `ToolbarView` | One row owns `Prices`, `IBKR`, `Options`, `Run`, `Paper`, `Reset`, and `Export`. | Split into status context, chart tools, right-panel decision actions, dock actions, and diagnostics actions. The top bar should show mode, provider freshness, account, rollback, adapter health, and alerts, not a command dump. |
| `DatasetSummaryView` | Packs market data provider, mode, quote, captured timestamp, execution provider, account, IBKR status, port, environment, account selection, live rollback, and live session state into the sidebar. | Keep the left rail narrow. Promote active symbol/quote/account/adapter state into the top bar and chart header; move detailed provenance into diagnostics or an inspector popover. |
| `StrategyPanel` plus `ExecutionTicketView` plus `LiveExecutionControlsView` | Mixes strategy metrics, proposal review, execution route, order ticket details, risk messages, live arming, live order confirmation, live execute, and live disable controls in a single lower panel. | Build the right decision panel around mutually exclusive `Proposal`, `Ticket`, `Risk`, and `Preview` modes. Its footer should keep locked `Live` and primary `Review Paper` visible like `CONCEPT.png`. |
| `OptionsPanel` | Renders option selection controls, option quote/risk/preview, single-leg ticket, option exit ticket, vertical spread ticket, route gates, verifier names, audit categories, artifact names, evidence bundle names, and receipt names inline. | Turn options into a dense bottom-dock table plus selected ticket context in the right panel. Raw verifier/artifact/bundle/receipt fields move to diagnostics unless they are the immediate reason a route is rejected. |
| `PaperAccountPanel` | Always-visible paper account and broker state in the lower scroll region. | Move account buying power/positions/session state to `Portfolio` or `Positions` dock content, with only active account and readiness chips visible in top/right regions. |
| `AuditLogPanel` and `AuditPayloadView` | Always-visible audit log and raw payload path in the lower scroll region. | Move audit history and raw payloads to `Audit` / `Diagnostics` dock tabs. Normal concept viewport should show audit receipt recorded or rejected, not raw JSON payload detail. |
| `DashboardUIAccessibilityContract.swift` | Canonical identifier list still includes old region groupings and several user-facing Java-wrapper purpose strings. | Preserve raw identifiers while adding new concept-region identifiers. Update purpose copy from primary Java wording to `local broker adapter` / `IBKR connection` as controls move. |

`CONCEPT.png` first-patch interpretation:

- Keep the top row two-tiered: global mode/status (`Research`, `Paper`, `Live Review`, data mode, paper readiness, rollback, adapter health, alerts) plus instrument/quote context. This maps current `ToolbarView` and parts of `DatasetSummaryView` into separate context regions.
- Keep the left rail visually close to the concept: watchlists, saved captures, and account footer. Do not let market-data provenance, verifier details, or account-selection diagnostics expand it.
- Keep the center chart dominant and stable. Reuse `CandleChartView` first; do not rewrite the renderer while extracting the shell. The change is ownership and placement, not chart drawing logic.
- Keep the bottom dock as tabs, not a vertical pile. `Options Chain` can be the most detailed default, but `Positions`, `Orders`, `Fills`, `Audit`, and `Diagnostics` must be reachable without stacking every panel.
- Keep the right decision panel narrow and mode-driven. `Review Paper` is the primary action. `Live` stays visibly locked unless the backend and external evidence gates justify otherwise.

FE-01 first patch boundary:

- Add `WorkbenchState` with only visual/navigation state: workspace mode, active right-panel tab, active dock tab, diagnostics visibility, selected saved capture, and chart range. It should not own market-data fetching, risk decisions, broker submissions, or audit persistence.
- Recompose `AppRootView` into named private child views inside the same file first if that minimizes risk. Moving child views into separate files can be a follow-up after tests and screenshot evidence stabilize.
- Keep `TradingDashboardModel` as the facade. Every existing action should still call the same model methods during FE-01.
- Keep existing accessibility identifiers queryable: `app.root`, `watchlist.sidebar`, `chart.surface`, `data.refreshPrices`, `ibkr.refreshStatus`, `proposal.executePaper`, `live.controls`, `paperAccount.panel`, `auditLog.panel`, and `options.panel`.
- Add new identifiers only for concept regions that do not have stable equivalents yet: top app bar, adapter-health chip, rollback chip, alert count, right panel tabs, bottom dock tabs, diagnostics toggle, and `Review Paper` footer action.
- Do not show verifier names, artifact filenames, evidence bundle names, audit receipt names, or raw JSON payloads in the first viewport unless the selected dock tab is `Diagnostics`.
- Before any screenshot claim, run `/Users/gabrielalfonzo/IdeaProjects/Trading/scripts/validate-local.sh`, keep its `backend-readiness.json` and `implementation-progress.json`, and render the Swift snapshot against the Rust `connected-fixture`; the screenshot should be compared against `CONCEPT.png`, not the current proof-dashboard baseline.

### FE-01 Agent Patch Plan

This is the concrete first patch handoff for a frontend migration agent. It is grounded in the current upstream sources and the local concept image.

Current source facts to preserve:

| File | Current Size | FE-01 Role |
| --- | --- | --- |
| `Sources/AgenticTradingApp/AppRootView.swift` | 1,458 lines | Main shell extraction target. It currently owns root layout, toolbar, chart range, strategy, ticket, options, account, audit, and save/export UI. |
| `Sources/AgenticTradingAppFeature/DashboardUIAccessibilityContract.swift` | 175 lines | Add workbench identifiers here while preserving all existing raw values. |
| `Sources/AgenticTradingAppFeature/TradingDashboardModel.swift` | 5,223 lines | Compatibility facade only during FE-01. Do not move broker behavior here unless a test already forces it. |
| `/Users/gabrielalfonzo/IdeaProjects/Trading/CONCEPT.png` | 1586x992 | Visual contract: top app bar, left rail, dominant chart, right decision panel, bottom dock, collapsed diagnostics. |

Patch order:

1. Add `WorkbenchState` under `Sources/AgenticTradingAppFeature/` with only visual/navigation state: `workspaceMode`, `rightPanelTab`, `bottomDockTab`, `isDiagnosticsVisible`, `visibleBarCount`, and `offsetFromEnd`.
2. Add workbench identifiers to `DashboardUIAccessibilityContract.swift`: top app bar, left rail, market workspace, right panel, right-panel tabs, bottom dock, bottom-dock tabs, adapter health, rollback state, alert count, diagnostics toggle, locked live action, and review paper action.
3. Recompose `AppRootView` into private child regions first: `TopAppBar`, `LeftRail`, `MarketWorkspace`, `RightDecisionPanel`, `BottomDock`, and `DiagnosticsAffordance`. Keeping them in the same file for FE-01 is acceptable if it limits risk.
4. Move `visibleBarCount` and `offsetFromEnd` out of root `@State` and into `WorkbenchState`, then keep passing them to `CandleChartView` and `ChartControlsView`.
5. Place existing panels inside the new geometry without deleting behavior: chart stays in `MarketWorkspace`, `StrategyPanel` / `ExecutionTicketView` / `LiveExecutionControlsView` move behind right-panel modes, `OptionsPanel`, `PaperAccountPanel`, and `AuditLogPanel` move behind bottom-dock tabs.
6. Keep all existing model calls and async actions intact. FE-01 is layout ownership, accessibility, and evidence separation, not a broker workflow rewrite.
7. Remove the fixed proof-dashboard composition: no root `NavigationSplitView` detail page with a fixed `420` pixel chart above an always-visible options/strategy/account/audit stack.

Red lines:

- Do not rewrite `CandleChartView` in FE-01.
- Do not change order-routing, risk, live-gate, or audit behavior in `TradingDashboardModel`.
- Do not make `workspaceMode=liveReview` arm live trading or change broker environment.
- Do not hide critical rejection or stale-data messages in diagnostics; only raw proof and artifact detail moves there.
- Do not make the layout pass only at `1586x992`. It must work at `1200x850` and a wider workstation size.
- Do not introduce new user-facing Java wording while moving controls. Legacy identifier and environment-variable compatibility can remain.

FE-01 validation order:

1. From `/Users/gabrielalfonzo/IdeaProjects/Trading`, run `VALIDATION_OUTPUT_DIR=/tmp/agentic-trading-fe01-validation scripts/validate-local.sh`.
2. From `/Users/gabrielalfonzo/Documents/Agentic Trading`, run dashboard and native UI verifiers after the shell patch:
   - `DEVELOPER_DIR=/Users/gabrielalfonzo/Documents/Xcode-beta.app/Contents/Developer swift run AgenticTradingResearch ibkr-verify-dashboard-surface --output /tmp/agentic-trading-fe01-dashboard-surface.json`
   - `DEVELOPER_DIR=/Users/gabrielalfonzo/Documents/Xcode-beta.app/Contents/Developer swift run AgenticTradingResearch ibkr-verify-native-ui-evidence-preflight --output /tmp/agentic-trading-fe01-native-ui-preflight.json`
3. Start the Rust fixture for screenshot work: `cargo run -- serve --startup-mode connected-fixture --listen 127.0.0.1:8765`.
4. Collect a `1200x850` native snapshot and a wider workstation snapshot against that Rust fixture.
5. Generate the review scaffold from the collected artifacts:
   - `FE01_MINIMUM_SNAPSHOT=<1200x850 png> FE01_WIDE_SNAPSHOT=<wide png> VALIDATION_OUTPUT_DIR=/tmp/agentic-trading-fe01-validation /Users/gabrielalfonzo/IdeaProjects/Trading/scripts/prepare-fe01-snapshot-review.sh`
6. Fill out the remaining concept-region and rejection rows. If any concept region or rejection row fails, FE-01 is not visually accepted even if tests pass.

### FE-01 Accessibility And State Contract

The current `DashboardUIAccessibilityContract.swift` already protects the legacy surfaces that must keep working. FE-01 should preserve those raw identifiers and add concept-region identifiers so screenshot review and UI tests can assert the new shell without relying on visual text.

Add these identifiers during FE-01 if the corresponding region is introduced:

| Proposed Identifier | Concept Region | Purpose | Notes |
| --- | --- | --- | --- |
| `workbench.topAppBar` | Top app bar | Root status/context strip for workspace mode, account, provider, rollback, adapter health, and alerts. | New shell identifier; should be visible in the first viewport. |
| `workbench.workspaceMode` | Top app bar | Segmented control or menu for `Research`, `Paper`, and `Live Review`. | Pure view state in `WorkbenchState`; it must not arm live trading by itself. |
| `workbench.adapterHealth` | Top app bar | Concise local adapter health chip. | Bind to Rust status/preflight/capability/backend-readiness state; do not imply external IBKR readiness. |
| `workbench.rollbackState` | Top app bar | Visible rollback/reconnecting/stale-state chip. | Must remain visible when order controls are locked. |
| `workbench.alertCount` | Top app bar | Aggregate visible alert count. | Should summarize warnings without exposing raw verifier text. |
| `workbench.leftRail` | Left rail | Concept rail container for watchlists, captures, and account footer. | Existing `watchlist.sidebar` should remain present inside or on this region. |
| `workbench.marketWorkspace` | Center chart | Chart workspace container for header, quote strip, chart, and chart tools. | Existing `chart.surface` remains the actual chart render target. |
| `workbench.rightPanel` | Right decision panel | Container for proposal/ticket/risk/preview modes. | Replaces the visual role currently spread across `StrategyPanel`, `ExecutionTicketView`, and live controls. |
| `workbench.rightPanel.tab.proposal` | Right decision panel | Proposal mode tab. | Only one right-panel mode should be expanded at a time. |
| `workbench.rightPanel.tab.ticket` | Right decision panel | Ticket mode tab. | Ticket fields should stay compact enough for `1200x850`. |
| `workbench.rightPanel.tab.risk` | Right decision panel | Risk mode tab. | Risk copy is decision summary, not raw verifier output. |
| `workbench.rightPanel.tab.preview` | Right decision panel | Broker preview mode tab. | Broker warnings and margin/commission preview belong here. |
| `workbench.liveLockedAction` | Right decision panel footer | Locked live action. | Visible but disabled unless live gates and external evidence permit it. |
| `workbench.reviewPaperAction` | Right decision panel footer | Primary paper review action. | This can forward to the existing `proposal.executePaper` path during FE-01. |
| `workbench.bottomDock` | Bottom dock | Dock container. | The lower scroll stack should become dock tabs without losing existing panel identifiers. |
| `workbench.bottomDock.tab.positions` | Bottom dock | Positions tab. | Can be empty/unavailable initially if model data is not split yet. |
| `workbench.bottomDock.tab.orders` | Bottom dock | Orders tab. | Should eventually bind to open/completed order routes. |
| `workbench.bottomDock.tab.fills` | Bottom dock | Fills tab. | Should eventually bind to fill/reconciliation routes. |
| `workbench.bottomDock.tab.optionsChain` | Bottom dock | Options chain tab. | Existing `options.panel` should be reachable here during migration. |
| `workbench.bottomDock.tab.audit` | Bottom dock | Audit tab. | Existing `auditLog.panel` should move here or remain reachable through this tab. |
| `workbench.bottomDock.tab.diagnostics` | Bottom dock | Diagnostics tab. | Raw verifier/artifact/audit payload detail is allowed here, not in normal modes. |
| `workbench.diagnosticsToggle` | Diagnostics affordance | Collapsed diagnostics toggle or dock affordance. | Must be visible in the first viewport without expanding diagnostics by default. |

`WorkbenchState` should be small and serializable enough for focused tests:

| State | Initial Value | Allowed Values | Must Not Do |
| --- | --- | --- | --- |
| `workspaceMode` | `research` | `research`, `paper`, `liveReview` | Must not change selected broker environment or arm live trading by itself. |
| `rightPanelTab` | `ticket` or `proposal` | `proposal`, `ticket`, `risk`, `preview` | Must not duplicate submit/risk logic from `TradingDashboardModel`. |
| `bottomDockTab` | `optionsChain` when option data exists, otherwise `positions` | `positions`, `orders`, `fills`, `optionsChain`, `audit`, `diagnostics` | Must not delete existing `OptionsPanel`, `PaperAccountPanel`, or `AuditLogPanel` behavior during the shell split. |
| `isDiagnosticsVisible` | `false` | Boolean | Must not be the only way to see critical order rejection messages. |
| `visibleBarCount` | Current value `20` | Existing valid chart range | Must not remain as private root state in `AppRootView` after FE-01. |
| `offsetFromEnd` | Current value `0` | Existing valid chart range | Must stay clamped through the same chart behavior covered by existing chart render tests. |

FE-01 verifier/test expectations:

- `DashboardUIAccessibilityContract.requiredIdentifierRawValues` still contains every legacy raw identifier before adding new ones.
- New concept-region identifiers are covered by the dashboard surface verifier or a focused Swift test before screenshot approval.
- `ibkr-verify-dashboard-surface` remains approved after the accessibility contract changes.
- The native `1200x850` snapshot shows all six concept regions at once: top app bar, left rail, chart workspace, right decision panel, bottom dock, and collapsed diagnostics affordance.
- The first viewport does not show raw verifier names, evidence bundle names, audit receipt names, or raw JSON payloads while `bottomDockTab != diagnostics`.

### Guide Contract

The local Rust test `cargo test --test frontend_guide_contract` protects the frontend migration brief itself. It verifies that `/Users/gabrielalfonzo/IdeaProjects/Trading/CONCEPT.png` is still the `1586x992` PNG used as the visual contract, and that this guide still names the FE-01 regions, validation scripts, snapshot evidence template, rejection checks, and local-readiness boundary. Update the test in the same patch as the guide only when the frontend contract intentionally changes.

### FE-01 Snapshot Evidence Template

After an FE-01 shell patch, create one short Markdown review artifact next to the snapshot evidence. The file can live under the Agentic Trading evidence output directory or at `/tmp/agentic-trading-fe01-snapshot-review.md` during local iteration.

Generate the starting point with `/Users/gabrielalfonzo/IdeaProjects/Trading/scripts/prepare-fe01-snapshot-review.sh`. The script reads `CONCEPT.png`, the combined validation manifest, `backend-readiness.json`, `implementation-progress.json`, dashboard-surface verifier JSON, native UI preflight JSON, and the two screenshot paths. It exits nonzero when required evidence is missing unless `--allow-missing` is used for a draft template before screenshots exist.

The generated file uses this structure:

```md
# FE-01 Snapshot Review

- Source concept: `/Users/gabrielalfonzo/IdeaProjects/Trading/CONCEPT.png` (`1586x992`)
- Combined validation output directory: `<absolute path, for example /tmp/agentic-trading-fe01-validation>`
- Minimum viewport snapshot: `<absolute path to 1200x850 PNG>`
- Wide viewport snapshot: `<absolute path to wide PNG>`
- Rust backend readiness trace: `<absolute path to backend-readiness JSON>`
- Upstream implementation-progress trace: `<absolute path to implementation-progress JSON>`
- Swift dashboard surface trace: `<absolute path to ibkr-verify-dashboard-surface JSON>`
- Native UI evidence preflight trace: `<absolute path to ibkr-verify-native-ui-evidence-preflight JSON>`

## Backend Evidence

| Check | Expected | Observed | Pass |
| --- | --- | --- | --- |
| Rust `backend-readiness` | `isApproved=true`, `localVerifierCount == approvedVerifierCount` |  |  |
| Upstream implementation-progress | `isApproved=true`; completion boundary remains visible if `completionClaimAllowed=false` |  |  |
| Adapter copy | Local backend health only; external IBKR evidence pending copy remains visible where relevant |  |  |
| Swift compatibility | `swift test --quiet` passed after the shell change |  |  |

## Concept Region Review

| Region | Required From `CONCEPT.png` | 1200x850 Snapshot | Wide Snapshot | Pass |
| --- | --- | --- | --- | --- |
| Top app bar | Workspace mode, provider state, paper/live state, rollback, adapter health, alerts |  |  |  |
| Left rail | Watchlist, saved captures, compact account footer |  |  |  |
| Center chart | Dominant chart canvas, quote context, volume, order/fill/level markers |  |  |  |
| Right panel | Proposal/Ticket/Risk/Preview tabs, locked Live action, primary Review Paper |  |  |  |
| Bottom dock | Positions, Orders, Fills, Options Chain, Audit, Diagnostics tabs |  |  |  |
| Diagnostics | Visible collapsed affordance; raw proof hidden unless selected |  |  |  |

## Rejection Checks

| Failure Mode | Must Be False | Observed | Pass |
| --- | --- | --- | --- |
| Whole-window vertical scrolling required to see main regions | No |  |  |
| Chart is reduced to a small preview | No |  |  |
| Right panel pushed below chart or dock | No |  |  |
| Old command toolbar remains the dominant top surface | No |  |  |
| Options, strategy, paper account, and audit all render simultaneously as stacked evidence panels | No |  |  |
| Verifier names, evidence bundle names, audit receipt names, or raw JSON appear outside Diagnostics | No |  |  |
| Any button/card/table text clips or overlaps at 1200x850 | No |  |  |

## Accessibility Evidence

| Identifier Group | Expected | Observed | Pass |
| --- | --- | --- | --- |
| Legacy identifiers | `app.root`, `watchlist.sidebar`, `chart.surface`, `data.refreshPrices`, `ibkr.refreshStatus`, `proposal.executePaper`, `live.controls`, `paperAccount.panel`, `auditLog.panel`, `options.panel` remain queryable |  |  |
| New workbench identifiers | `workbench.topAppBar`, `workbench.leftRail`, `workbench.marketWorkspace`, `workbench.rightPanel`, `workbench.bottomDock`, `workbench.diagnosticsToggle` are queryable when their regions exist |  |  |
| Right panel modes | Proposal, Ticket, Risk, Preview mode identifiers exist and only one mode is expanded |  |  |
| Dock tabs | Positions, Orders, Fills, Options Chain, Audit, Diagnostics tab identifiers exist |  |  |

## Decision

- Result: `accepted` / `needs-rework`
- Blocking notes:
- Follow-up ticket:
```

Review rule: if the snapshot fails any region row or rejection check, do not treat FE-01 as visually accepted even if tests pass. Tests prove behavior survived; the snapshot review proves the old evidence-dashboard composition did not survive.

Current pressure points:

- `Sources/AgenticTradingApp/AppRootView.swift` is the immediate shell target. It currently owns the root layout, toolbar commands, chart placement, strategy panel, paper/live controls, options panel, paper account panel, audit log panel, save/open panels, and async button actions. Its end state should be composition only: top app bar, left rail, chart workspace, right review panel, bottom dock, and diagnostics drawer.
- `Sources/AgenticTradingApp/CandleChartView.swift` should remain the chart drawing and interaction core for the first slice. Do not rewrite the renderer while the shell is being split. Move range/timeframe/provider command state around it, then reconnect overlays and markers through a chart-facing model.
- `Sources/AgenticTradingAppFeature/TradingDashboardModel.swift` is the compatibility facade. It currently exposes market data refresh, adapter status, options refresh/selection, paper execution, live controls, route evidence imports, paper account state, audit export, chart summaries, order tickets, option tickets, spreads, and diagnostics-facing summaries. Keep existing tests pointed at this facade while it delegates into smaller models.
- `Sources/AgenticTradingAppFeature/DashboardUIAccessibilityContract.swift` is the canonical UI-test identifier map. Any moved control keeps its current identifier or gets an explicit replacement added here with test coverage. Do not break identifiers such as `chart.surface`, `data.refreshPrices`, `ibkr.refreshStatus`, `options.panel`, `proposal.executePaper`, `live.controls`, `paperAccount.panel`, and `auditLog.panel` during layout extraction.

Extraction order:

1. Add `WorkbenchState` for selected symbol, mode, active right-panel tab, selected bottom-dock tab, selected account, and diagnostics visibility. Wire it into `AppRootView` before moving broker behavior.
2. Extract a `MarketWorkspaceModel` from chart-visible state: selected contract identity, timeframe/range, provider freshness, quote strip, order markers, fill markers, and route-bound market failures from the Rust backend.
3. Extract an `OptionsChainModel` from option refresh, expiration/strike/right selection, quote subscription state, selected contract identity, Greeks, spread summary, and chain-row-to-ticket handoff.
4. Extract `OrderTicketModel` and `RiskReviewModel` for the right panel. These own proposal summary, draft order intent, paper preview, stale-data warnings, idempotency status, risk decision, and the enabled state for `Review Paper`.
5. Extract `PortfolioModel` and `OrderLedgerModel` for bottom-dock positions, orders, fills, account buying power, lifecycle status, and reconciliation state.
6. Extract `DiagnosticsModel` last. It should receive adapter health, capability manifests, verifier output, audit receipts, failure envelopes, and event transcripts without leaking those artifacts into the primary trading surface.

Per-file acceptance:

- `AppRootView.swift` no longer decides workflow outcomes or performs broker-specific branching. It composes child views and forwards user intent.
- `TradingDashboardModel.swift` remains source compatible for existing tests while delegating new behavior to extracted models.
- `CandleChartView.swift` remains visually stable and receives a narrower render model instead of raw dashboard state.
- `DashboardUIAccessibilityContract.swift` is updated in the same slice as any moved command or surface.
- The native smoke snapshot remains `1200x850`, keeps the `CONCEPT.png` composition, and still shows chart-dominant center, visible right ticket, bottom dock, and collapsed diagnostics.

Identifier handling:

- Preserve existing raw identifiers during the shell split: `app.root`, `watchlist.sidebar`, `chart.surface`, `data.refreshPrices`, `ibkr.refreshStatus`, `proposal.executePaper`, `live.controls`, `paperAccount.panel`, `auditLog.panel`, and `options.panel`.
- Add new identifiers only when a concept region has no stable equivalent yet, such as top app bar, right decision-panel tabs, bottom dock tabs, diagnostics drawer toggle, adapter health chip, rollback chip, and alert count.
- Update `DashboardUIAccessibilityContract` purpose strings away from user-facing Java wording as controls move. Diagnostic compatibility may still mention legacy wrapper context; primary UI purposes should say `broker adapter`, `IBKR connection`, or `local broker adapter`.
- `ibkr-verify-dashboard-surface` must stay approved after each slice. If a moved identifier breaks `nativeUIContractIsStable`, `nativeUIContractMatchesChartRender`, or `nativeUIContractCoversExecutionGates`, fix the contract or the moved view before continuing.

## Frontend Module Plan

Create deeper feature modules around workflows instead of one giant dashboard model.

| Module | Interface | Implementation Hidden Behind It |
| --- | --- | --- |
| `WorkbenchState` | Current symbol, workspace mode, selected account, selected panel, selected order/proposal | Coordinates visible state without owning trading logic. |
| `MarketWorkspaceModel` | Chart render model, provider state, selected timeframe, overlays, visible range | Market data source, capture replay, chart marker projection. |
| `ProposalReviewModel` | Current proposal, evidence summary, risk decision, review state | Strategy output, risk engine, market-data freshness checks. |
| `OrderTicketModel` | Draft order intent, validation, broker preview, submit readiness | Intent mapping, account selection, exact confirmations. |
| `PortfolioModel` | Positions, buying power, session P&L, exposure, account state | Local paper broker plus adapter account snapshots. |
| `OrderLedgerModel` | Open orders, completed orders, fills, lifecycle status | Adapter reconciliation endpoints and event transcript. |
| `OptionsChainModel` | Chain, selected contract, quote, Greeks, spread builder | Option adapter calls, option risk checks, ticket generation. |
| `AuditTimelineModel` | Filtered audit events and selected raw payload | Audit store and event stream. |
| `DiagnosticsModel` | Adapter health, capabilities, readiness, evidence artifacts | Verifier output and capability manifest. |

Each module needs a small interface and a test surface. The current `TradingDashboardModel` can delegate into these modules gradually instead of being replaced in one large rewrite.

## Migration Phases

### Phase 0: Preserve Behavior And Capture Baseline

Deliverables:

- Save the current native snapshot as the "before" visual baseline.
- Save `CONCEPT.png` as the target composition reference for each frontend slice.
- Record the current passing test command.
- Add a short UI inventory listing current panels, actions, and accessibility identifiers.
- Define the target workbench routes/modes in this guide as the migration scope.

Acceptance:

- `DEVELOPER_DIR=/Users/gabrielalfonzo/Documents/Xcode-beta.app/Contents/Developer swift test` passes.
- `scripts/collect-native-ui-evidence.sh` still works if used.
- No workflow is deleted without a replacement location in the new layout.

### Phase 1: Split View State From Trading Workflows

Deliverables:

- Add `WorkbenchState`.
- Move selected symbol, visible bar count, offset, selected panel, and expanded inspector state out of `AppRootView`.
- Keep `TradingDashboardModel` as the compatibility facade for existing tests.

Acceptance:

- Existing app workflow tests still pass.
- `AppRootView` loses local state that is not purely view presentation.
- No broker behavior changes.

### Phase 2: Extract The Chart Workspace

Deliverables:

- Move chart toolbar, timeframe controls, overlay controls, and marker projection into a chart workspace module.
- Keep `CandleChartView` focused on drawing and interaction.
- Add a chart render model that includes bounds, visible bars, level labels, fill markers, order markers, and overlay states.

Acceptance:

- Chart snapshot evidence still proves nonblank render output.
- Marker tests still prove broker order id provenance and nonpositive price rejection.
- The chart can expand vertically without changing table/panel logic.

### Phase 3: Replace The Toolbar With Contextual Command Areas

Deliverables:

- Top app bar for context: provider, account, environment, rollback, adapter health.
- Chart tool strip for chart-only controls.
- Review panel command footer for decision actions.

Acceptance:

- Main actions are no longer a row of unrelated small buttons.
- Paper and live actions only appear inside the relevant review state.
- Exact live confirmations remain impossible to bypass.

### Phase 4: Build The Right Review Panel

Deliverables:

- Proposal review mode.
- Order ticket mode.
- Risk mode.
- Broker preview mode.
- Confirmation mode for paper/live gated actions.

Acceptance:

- Broker warnings, risk rejections, stale-data state, account mismatch, and exact confirmations are shown at the decision point.
- Reviewed bracket, option exit, and spread gates remain disabled until evidence review is loaded.
- Existing dashboard execution workflow tests still pass.

### Phase 5: Move Tables Into A Bottom Dock

Deliverables:

- Positions table.
- Orders table.
- Fills table.
- Options chain table.
- Audit table.
- Diagnostics tab.

Acceptance:

- The first screen is not forced to show strategy, account, audit, and options all at once.
- Options chain can show dense rows without stealing chart height.
- Audit remains searchable and filterable.

### Phase 6: Move Verifier Evidence Out Of Primary UI

Deliverables:

- Diagnostics drawer with the Java-wrapper-compatible capability manifest, verifier status, evidence artifacts, raw failure envelopes, malformed WebSocket subscription failures, and adapter event transcript.
- Main UI shows only concise states: ready, gated, rejected, stale, disconnected, external evidence pending.

Acceptance:

- Verifier command names and artifact filenames are not visible in the normal order ticket unless diagnostics are open.
- The local-readiness vs external-evidence split remains visible.
- Handoff/debug information is still available without opening source files.

### Phase 7: Restyle The Workbench

Deliverables:

- New color tokens.
- Table row styles.
- Chart label styles.
- Environment badges.
- Compact button/icon styles with tooltips.
- Empty, loading, disconnected, stale, and rejected states.

Acceptance:

- The implemented shell can be compared directly to `CONCEPT.png`: left rail, chart center, right ticket/risk panel, and bottom dock are all present in the first viewport.
- No text overlaps at 1200x850 or the minimum supported window size.
- The app no longer looks like a debug trace viewer.
- Paper/live state is clear without saturating the whole screen.

### Phase 8: Rename Java-Labeled UI Copy

This happens after the backend adapter transition is underway.

Deliverables:

- Replace user-facing implementation labels with "Broker connection" or "IBKR connection".
- Keep diagnostic detail available for legacy sessions.
- Preserve old environment variable support until backend migration completes.
- Do not introduce Java as a future product surface; Java wording may appear only in legacy/current-state diagnostics while the old wrapper exists.

Acceptance:

- User-facing UI no longer implies Java is the product architecture.
- Tests asserting old strings are updated only after equivalent behavior assertions exist.

### Phase 9: Add Visual Regression Evidence

Deliverables:

- App snapshot at 1200x850.
- App snapshot at a wider workstation size.
- Nonblank pixel checks for chart and tables.
- Accessibility identifier checks for critical controls.
- Manual QA checklist for paper workflow, options inspection, and live-gated disabled state.

Acceptance:

- `scripts/collect-native-ui-evidence.sh` and `scripts/audit-native-ui-evidence.sh <evidence-dir>` pass after layout changes that affect the shell, chart, ticket, dock, or diagnostics.
- `AgenticTradingResearch ibkr-verify-dashboard-surface --output <path>` and `AgenticTradingResearch ibkr-verify-dashboard-surface-mutations --output <path>` pass after any chart/ticket/options/live-gate surface changes.
- `AgenticTradingResearch ibkr-verify-native-ui-evidence-preflight` and `AgenticTradingResearch ibkr-verify-native-ui-evidence-preflight-mutations` remain approved before collecting final handoff evidence.
- The evidence bundle includes `ibkr-dashboard-surface.json`, `native-app-screenshot.png`, and `native-ui-evidence-audit-receipt.json`.
- The native screenshot audit records nonblank renderability: PNG dimensions, unique color count, non-black sample count, sampled pixel count, and average luma.
- Snapshot review confirms the same first-viewport composition as `CONCEPT.png`: left rail, chart center, right ticket/risk panel, bottom dock, and collapsed diagnostics.
- Visual evidence catches blank charts, overlapping text, missing badges, hidden primary actions, and regressions where proof artifacts return to the primary workbench.
- UI migration cannot pass by preserving only model behavior.

## Concrete Screen States

### Market Observe

Visible:

- Chart.
- Watchlist.
- Provider/account/environment context.
- Bottom dock collapsed or showing positions.

Hidden:

- Verifier details.
- Raw audit payloads.
- Live confirmation controls.

### Proposal Review

Visible:

- Chart with stop/target/invalidation levels.
- Proposal thesis and evidence.
- Risk decision.
- Broker preview if available.
- Paper execute action only when approved.

Hidden:

- Options chain unless explicitly selected.
- Diagnostics unless opened.

### Paper Execution

Visible:

- Order ticket.
- Risk checks.
- Preview warnings.
- Acknowledgement status.
- Latest lifecycle events.

Required:

- Account id.
- Environment.
- Request id.
- Quote freshness.
- Audit event.

### Live Review

Visible:

- Live disabled or live armed state.
- Exact account/session confirmation status.
- Dry-run artifact review state.
- Per-order confirmation requirement.
- Rollback/kill switch state.

Required:

- Live action remains impossible while rollback is active.
- Live placement remains impossible without reviewed dry-run and exact approval.

### Diagnostics

Visible:

- Adapter status.
- Capability manifest summary.
- Last failure envelope.
- Event transcript.
- Evidence artifact status.
- External evidence pending list.

This is the only place where verifier command names should be routinely visible.

## Testing Plan

Keep existing tests, then add focused tests as modules split:

- `WorkbenchStateTests`: selected symbol, panel mode, environment context, restored state.
- `MarketWorkspaceModelTests`: chart render model, overlays, order marker projection, visible range.
- `ProposalReviewModelTests`: proposal evidence, stale data rejection, risk state.
- `OrderTicketModelTests`: draft validation, broker preview warnings, exact confirmations.
- `PortfolioModelTests`: duplicate positions, exposure, account state.
- `OrderLedgerModelTests`: event transcript filtering, lifecycle updates, fills.
- `OptionsChainModelTests`: chain selection, option quote, spread builder.
- `DiagnosticsModelTests`: capability manifest summary, readiness/external-evidence split.
- Snapshot checks for the full workbench at 1200x850 and wide desktop.

Run before claiming a frontend migration slice is done:

```sh
cd /Users/gabrielalfonzo/IdeaProjects/Trading
VALIDATION_OUTPUT_DIR=/tmp/agentic-trading-frontend-slice-validation scripts/validate-local.sh
```

This command runs the Rust backend gate, the upstream Agentic Trading Swift suite, and the implementation-progress verifier. Treat a passing run as local migration readiness only; if `completionClaimAllowed=false` or `goalCompletionProven=false`, the project still lacks external IBKR completion evidence.

When visual layout changes:

```sh
cd "/Users/gabrielalfonzo/Documents/Agentic Trading"
./scripts/collect-native-ui-evidence.sh
./scripts/audit-native-ui-evidence.sh
```

## First Implementation Slice

Start with the shell, not the chart renderer. Keep `CONCEPT.png` open during the slice and reject changes that pull the UI back toward the old evidence dashboard.

1. Add `WorkbenchState`.
2. Replace the single vertical content stack in `AppRootView` with top app bar, left rail, center chart workspace, right review panel, and bottom dock placeholders.
3. Put the chart in the dominant center region before polishing table details.
4. Put order ticket, risk summary, broker preview warnings, and paper/live action state in the right panel.
5. Move positions, orders, fills, options chain, audit, and diagnostics into the bottom dock.
6. Keep diagnostics collapsed by default and keep raw verifier/evidence copy out of the normal ticket.
7. Run existing tests and collect a new native snapshot.

That slice should immediately make the app feel like a workstation while keeping the existing behavior intact.
