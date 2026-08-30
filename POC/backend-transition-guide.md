# Backend Transition Guide

This guide replaces the current IBKR Java wrapper with a Rust local broker adapter while preserving the existing Swift app behavior, tests, safety gates, and audit semantics.

## Decision

Build the replacement backend in Rust.

Rust is the target runtime for every new backend implementation slice in this guide. The hard backend problems are live market-data streams, WebSocket fan-out, backpressure, idempotent order routing, pacing, reconnect recovery, and fail-closed state transitions. Tokio-based Rust gives predictable async concurrency, low tail latency, strong protocol modeling, no garbage collector pauses, and no JVM process dependency.

The Rust backend should be named `AgenticTradingAdapter` or `LocalBrokerAdapter`, not `JavaWrapper`. Keep the existing `ibkr-local-adapter.v1` wire version during the transition so the Swift app can migrate by configuration first and by naming second.

There is no parallel target backend runtime. Java remains legacy behavior to map and test against. New backend crates, commands, fixtures, compatibility tests, and operator scripts should aim at the Rust workspace unless a temporary bridge is explicitly marked as migration-only.

## Rust Implementation Direction

Every implementation milestone below should produce Rust artifacts:

- Rust workspace under `LocalBrokerAdapter/`.
- Rust crates for contract DTOs, HTTP/WebSocket serving, operation ledger, broker protocol, market data, orders, reconciliation, evidence, and observability.
- Rust CLI binary named `agentic-trading-adapter`.
- Rust verifier commands that replace Java Gradle verifier modes.
- Rust integration tests that serve the frozen `/v1` contract and WebSocket event stream.
- Swift compatibility tests that point the existing clients at the Rust process.

Use Rust types to make the dangerous states hard to construct: paper versus live environment, callback-backed versus unavailable server time, fresh versus stale heartbeats, preview versus placement, dry-run versus live placement, single-leg versus combo orders, idempotency replay versus idempotency mismatch, and connected versus reconnecting broker sessions.

Non-goals:

- Do not build the replacement backend in another managed runtime.
- Do not add a second production localhost contract.
- Do not keep a required JVM, Gradle, or `TwsApi.jar` dependency in the future backend path.
- Do not add non-Rust broker protocol scaffolding except as throwaway research outside the transition path.
- Do not rename Swift interfaces away from Java terms until the Rust adapter proves contract compatibility.

## Current Assets To Preserve

- The Swift app already talks to a localhost HTTP/WebSocket interface instead of Java internals.
- The existing `/v1/capabilities` manifest is a machine-readable interface for routes, event names, safety gates, graph/ticket data, option support, and external evidence gates.
- Existing Swift tests encode useful behavior for market data, quote freshness, paper and live gates, order idempotency, lifecycle reconciliation, Flex reconciliation, app workflow state, and native UI evidence.
- The current Java implementation has deterministic verifier modes that can be treated as migration fixtures.
- The project already separates local readiness from external IBKR Gateway/TWS evidence. Preserve that rule.

## Backend Goal

The Rust backend should satisfy the same interface as the current localhost adapter:

- HTTP request/response commands under `/v1`.
- WebSocket events under `/v1/events`.
- `IBKRAdapterFailure` error envelopes on non-2xx HTTP responses and `adapter.failure` events.
- Explicit paper/live environment separation.
- Request-derived idempotency for preview, paper placement, live placement, modification, and option exercise/lapse.
- Asynchronous order acknowledgements followed by lifecycle state through events and reconciliation reads.
- Machine-checkable audit evidence for previews, placements, modifications, cancels, exercise/lapse actions, global cancel, live dry runs, and live placements.
- Pacing, reconnect, and entitlement failures surfaced as typed states instead of hidden retries.
- Deterministic local verifier outputs that prove the adapter interface without a live broker session.

Do not introduce a second product contract. The Rust adapter should first impersonate the current contract, then the Swift code can be renamed away from Java terms after compatibility is proven.

## Contract Freeze Inventory

Freeze the current `ibkr-local-adapter.v1` surface before writing Rust broker protocol code. The Rust backend should first prove these routes, event names, failure envelopes, and verifier fixtures exactly enough for the existing Swift decoders and safety checks.

### Routes

| Method | Path | Area | Replacement requirement |
| --- | --- | --- | --- |
| `GET` | `/v1/status` | Runtime | Works without IBKR, reports paper/live environment, connection state, server-time provenance, heartbeat freshness, host, port, and client id. |
| `GET` | `/v1/runtime/preflight` | Runtime | Works without IBKR and reports implementation/runtime readiness without requiring a broker session. |
| `GET` | `/v1/capabilities` | Contract | Returns `apiVersion: "ibkr-local-adapter.v1"` and `kind: "ibkr-java-wrapper-capabilities"` with Swift-decodable `routeCount`, route `category`, `requiresTwsConnection`, idempotency, exact-confirmation, async-acknowledgement flags, market/order/risk/graph capability buckets, event names, failure codes, and external evidence gates. |
| `GET` | `/v1/accounts` | Account state | Requires a connected broker session; preserves paper/live permission separation. |
| `GET` | `/v1/accounts/{accountID}/summary` | Account state | Returns account summary with environment/account provenance. |
| `GET` | `/v1/accounts/{accountID}/positions` | Account state | Returns positions with account/environment provenance and option-position data needed by exercise/lapse safety. |
| `GET` | `/v1/accounts/{accountID}/orders/open` | Reconciliation | Returns account-scoped open orders after reconnect recovery. |
| `GET` | `/v1/accounts/{accountID}/orders/completed` | Reconciliation | Returns account-scoped completed orders with lifecycle state. |
| `GET` | `/v1/accounts/{accountID}/fills` | Reconciliation | Returns fill reports, late commission updates, and Flex-reconciliation fields. |
| `GET` | `/v1/contracts/resolve` | Contracts | Resolves stock and mapped-order contracts without process-local hidden cache assumptions. |
| `GET` | `/v1/market-rules/{marketRuleID}` | Contracts | Preserves tick increment validation for preview and placement. |
| `GET` | `/v1/quotes/{conID}` | Market data | Returns quote snapshots with server-time freshness inputs. |
| `POST` | `/v1/quotes/{conID}/subscribe` | Market data | Starts quote stream for a resolved contract. |
| `DELETE` | `/v1/quotes/{conID}/subscribe` | Market data | Stops quote stream for a resolved contract. |
| `GET` | `/v1/bars/{conID}` | Market data | Preserves historical bar query parsing, pacing, cache fallback, and typed pacing failures. |
| `GET` | `/v1/ticks/{conID}` | Market data | Preserves historical tick windows for `TRADES`, `BID_ASK`, and `MIDPOINT`. |
| `POST` | `/v1/bars/{conID}/stream` | Market data | Starts real-time 5-second bar stream. |
| `DELETE` | `/v1/bars/{conID}/stream` | Market data | Stops real-time bar stream. |
| `GET` | `/v1/options/chains/{underlyingConID}` | Options | Returns expirations, strikes, rights, and underlying linkage. |
| `GET` | `/v1/options/contracts/resolve` | Options | Resolves selected option contract with full contract hydration. |
| `GET` | `/v1/options/contracts/{conID}/details` | Options | Returns option contract details and market-rule ids. |
| `GET` | `/v1/options/quotes/{conID}` | Options | Returns option bid/ask/last, size, volume, open interest, IV, and Greeks where available. |
| `POST` | `/v1/options/exercise` | Options | Requires idempotency, verified position, exact exercise/lapse confirmation, paper/live gates, and asynchronous acknowledgement. |
| `POST` | `/v1/orders/preview` | Orders | Preserves what-if preview, commission/margin/warning mapping, and idempotent preview reuse. |
| `POST` | `/v1/orders/paper` | Orders | Requires connected paper environment, idempotency, mapped contract/tick validation, asynchronous acknowledgement, events, and reconciliation. |
| `POST` | `/v1/orders/live` | Orders | Requires live startup gate, distinct live endpoint, idempotency, exact per-order confirmation, reviewed dry-run path, asynchronous acknowledgement, events, and reconciliation. |
| `POST` | `/v1/orders/{brokerOrderID}/modify` | Orders | Requires idempotency, exact modification confirmation, mapped-order validation, asynchronous acknowledgement, events, and reconciliation. |
| `POST` | `/v1/orders/{brokerOrderID}/cancel` | Orders | Cancels one broker order id and surfaces broker errors as typed failures. |
| `POST` | `/v1/orders/global-cancel` | Orders | Paper-only, exact account confirmation, paper-port gate, asynchronous acknowledgement, and audit evidence. |
| `WS` | `/v1/events` | Events | Sends current `connection.status` on connect, replays the last 100 events, accepts quote/bars subscription commands, and broadcasts non-market events. |

Every broker-facing route must return a Swift-decodable `IBKRAdapterFailure` envelope while disconnected. The first compatibility slice is allowed to implement only disconnected behavior for those routes, but it must not return raw framework 404/500 responses.

### WebSocket Events

Freeze the envelope shape as `{ "event": <name>, "receivedAt": <iso8601>, "payload": <typed-payload> }`.

The event names currently decoded by Swift are:

- `connection.status`
- `account.summary`
- `position.snapshot`
- `contract.details`
- `quote.snapshot`
- `bars.snapshot`
- `ticks.snapshot`
- `option.chain`
- `option.contract`
- `option.contract-details`
- `option.quote`
- `option.exercise`
- `order.status`
- `order.modify`
- `order.global_cancel`
- `fill.report`
- `adapter.failure`

Subscription commands are JSON objects with `action: "subscribe"` and a `subscription` containing `stream: "quote"` or `stream: "bars"` plus positive `conID`. Bar subscriptions must also include the Swift-shaped `timeframe` object, for example `{ "value": 1, "unit": "minute" }`. Quote subscriptions receive same-`conID` `quote.snapshot`, `option.quote`, and `ticks.snapshot`; bar subscriptions receive same-`conID` and same-timeframe `bars.snapshot` plus same-`conID` `ticks.snapshot`; non-market events are broadcast. Malformed non-empty text frames and invalid subscription objects emit an `adapter.failure` envelope with `invalidEventSubscription`.

### Failure Modes

Typed failure behavior is part of the contract, not an implementation detail. Preserve at least these categories:

- Disconnected or unauthenticated Gateway/TWS session.
- Stale server time or missing callback-backed `serverTimeProvenance`.
- Missing market-data entitlement.
- Invalid contract, market rule, route, tick, or query parameter.
- Historical pacing limit, including `retryAfterSeconds` and cached fallback behavior.
- Rejected order, unsupported order type, order-not-found, and broker-command rejection before broker access.
- Live trading disabled, live-port rejected, wrong environment, wrong account, missing exact confirmation, and unreviewed live placement.
- Invalid idempotency key reuse, duplicate cache mismatch, and reconnect recovery before order-id allocation.
- Invalid WebSocket subscription command.

### Fixtures And Verifiers To Port

Port the deterministic verifier artifacts before real broker protocol work expands:

- `runtime-preflight`
- `api-surface`
- `disconnected-surface`
- `startup-safety`
- `order-safety`
- `order-lifecycle-reconciliation`
- `market-data-streams`
- `server-time-provenance`
- `historical-pacing`
- `option-market-data`
- `option-exercise-safety`
- `mapped-option-contract-hydration`
- `mapped-order-routing-hydration`
- `paper-order-routing`
- `live-order-routing`
- `live-option-combo-routing`

The Rust verifier output does not need byte-for-byte Java formatting, but it must keep the semantic fields consumed by `scripts/validate-local.sh`, Swift capability validation, evidence audits, and handoff docs.

## Target Rust Module Shape

Use a small number of deep modules with explicit interfaces:

| Module | Responsibility | Notes |
| --- | --- | --- |
| `adapter_contract` | Shared DTOs, route metadata, event names, failure envelopes, JSON codecs, capability manifest | Generated from JSON Schema or hand-owned Rust types mirrored by Swift tests. |
| `http_interface` | Axum routes for `/v1/status`, `/v1/capabilities`, accounts, contracts, market data, options, orders, reconciliation | Thin routing only. No broker logic in handlers. |
| `event_hub` | WebSocket session registry, replay buffer, subscription filters, fan-out, backpressure policy | Must support late subscribers receiving recent critical failures. |
| `runtime_state` | Connection state, server-time provenance, heartbeat freshness, endpoint/environment, startup policy | Owns connected/stale/disconnected transitions. |
| `operation_ledger` | Request identity, idempotency records, body hashes, audit events, receipt export, failure classification | Shared by preview, placement, modification, cancel, option exercise/lapse, and live gates. |
| `broker_protocol` | Java-free TWS/Gateway socket protocol adapter | Encapsulates raw broker protocol details behind typed commands and callbacks. |
| `market_data` | Contract resolution, quotes, historical bars, historical ticks, real-time bars, pacing/cache | Owns IBKR pacing rules and replayable snapshots. |
| `order_manager` | Preview, placement, modification, cancel, global cancel, option exercise/lapse, idempotency cache | Owns order ids, duplicate suppression, and exact confirmation checks. |
| `reconciliation` | Open orders, completed orders, fills, commissions, positions, reconnect recovery | Must run before order id allocation after reconnect/state changes. |
| `evidence` | Deterministic verifier commands and fixture output | Replaces Gradle verifier modes with Rust CLI subcommands. |
| `observability` | Structured logs, audit trace emission, health counters, local diagnostics | No credentials or real account ids in logs. |

The deletion test should hold for each module. If deleting a module only removes a pass-through, fold it into its caller. If deleting it would spread protocol rules, idempotency logic, or safety gates across handlers, it is earning its keep.

## Runtime Stack

Recommended stack:

- `tokio` for async runtime.
- `axum` for HTTP and WebSocket routing.
- `serde` and `serde_json` for wire DTOs.
- `rust_decimal` for money, tick sizes, and broker-aligned prices.
- `time` for timestamp parsing and broker-time provenance.
- `tracing` and `tracing-subscriber` for structured local logs.
- `tower` middleware for request IDs, timeouts, body limits, and observability.
- `clap` for verifier and launcher commands.
- `insta` or JSON fixture comparisons for deterministic verifier snapshots.

Avoid choosing a third-party IBKR crate until it has been evaluated against the existing route and verifier contract. The first Rust milestone can own a protocol module directly and keep the interface small.

## Migration Phases

### Phase 0: Freeze The Adapter Interface

Deliverables:

- Extract the current localhost contract from `docs/ibkr-adapter-api.md` into versioned JSON Schema files under `adapter-contract/ibkr-local-adapter.v1/`.
- Include schemas for status, capabilities, account summary, positions, contract details, quote snapshots, bars, ticks, option chain, order preview, paper/live acknowledgements, order status, fills, and failure envelopes.
- Add fixture JSON copied from existing deterministic verifier output.
- Add a short compatibility checklist that maps every route and event to a Swift decoder or test.

Acceptance:

- The schema set covers every route currently listed in `/v1/capabilities`.
- Existing Swift tests identify which DTOs they decode.
- The guide names every route that is allowed to remain unimplemented in a disconnected stub.

### Phase 1: Build A Rust Disconnected-Surface Adapter

Deliverables:

- New Rust workspace under `LocalBrokerAdapter/`.
- `agentic-trading-adapter` binary starts on `127.0.0.1:8765`.
- `GET /v1/status`, `GET /v1/runtime/preflight`, `GET /v1/capabilities`, and `/v1/events` work without IBKR.
- Every broker-facing route returns the same disconnected failure shape as the current Java implementation.
- The WebSocket replays recent `adapter.failure` events to late subscribers.

Acceptance:

- Swift HTTP clients decode Rust responses without source changes except endpoint naming/configuration.
- A focused Swift test can point `AGENTIC_TRADING_JAVA_WRAPPER_BASE_URL` at the Rust process and pass existing disconnected behavior checks.
- The Rust binary has deterministic `verify-api-surface` and `verify-disconnected-surface` commands.

### Phase 2: Port Deterministic Verifiers

Deliverables:

Replace Java Gradle verifier modes with Rust CLI commands:

| Current verifier | Rust command |
| --- | --- |
| `--verify-runtime-preflight true` | `agentic-trading-adapter verify runtime-preflight` |
| `--verify-api-surface true` | `agentic-trading-adapter verify api-surface` |
| `--verify-disconnected-surface true` | `agentic-trading-adapter verify disconnected-surface` |
| `--verify-startup-safety true` | `agentic-trading-adapter verify startup-safety` |
| `--verify-order-safety true` | `agentic-trading-adapter verify order-safety` |
| `--verify-order-lifecycle true` | `agentic-trading-adapter verify order-lifecycle` |
| `--verify-market-data-streams true` | `agentic-trading-adapter verify market-data-streams` |
| `--verify-server-time-provenance true` | `agentic-trading-adapter verify server-time-provenance` |
| `--verify-historical-pacing true` | `agentic-trading-adapter verify historical-pacing` |
| `--verify-option-market-data true` | `agentic-trading-adapter verify option-market-data` |
| `--verify-option-exercise-safety true` | `agentic-trading-adapter verify option-exercise-safety` |
| `--verify-paper-order-routing true` | `agentic-trading-adapter verify paper-order-routing` |
| `--verify-live-order-routing true` | `agentic-trading-adapter verify live-order-routing` |
| `--verify-live-option-combo-routing true` | `agentic-trading-adapter verify live-option-combo-routing` |
| local verifier suite handoff | `agentic-trading-adapter verify backend-readiness --output <path>` |

Acceptance:

- Rust verifier JSON preserves the same semantic fields expected by Swift and shell audits.
- `backend-readiness` runs every local Rust verifier and emits one trace with per-verifier checks, counts, and an explicit external-evidence boundary.
- `scripts/validate-local.sh` can run the Rust verifier suite in parallel with the Java suite during transition.
- The capability manifest exposes implementation name separately from wire version, for example `"implementation": "rust-local-adapter"`.

### Phase 3: Operation Ledger, Audit Evidence, Observability, And Failure Drills

This is a backend safety prerequisite, not an order-routing feature. Build it before broker access so every later route uses the same request identity, idempotency, audit, diagnostic, and failure taxonomy rules.

Deliverables:

- Rust `operation_ledger` module with request id, idempotency key, request body hash, account id, environment, route, command type, lifecycle links, and final replay/reject decision.
- Durable local audit ledger for preview, placement, modification, cancel, global cancel, option exercise/lapse, live dry-run, and live placement decisions.
- Audit receipt export that preserves verifier-friendly fields while redacting credentials and masking real account identifiers.
- Stable failure taxonomy that maps validation errors, pacing limits, stale session state, broker rejections, transport errors, entitlement errors, WebSocket backpressure, and reconnect recovery into Swift-decodable `IBKRAdapterFailure` codes.
- Structured `tracing` spans and counters for request latency, broker command latency, event backlog, subscription counts, reconnect attempts, idempotency replay/reject outcomes, and audit export outcomes.
- Deterministic failure drills for duplicate idempotency replay, idempotency body mismatch, process restart after accepted acknowledgement, broker rejection after acknowledgement, WebSocket subscriber overflow, stale heartbeat, malformed JSON, and redaction checks.

Acceptance:

- Rust `verify audit-idempotency`, `verify failure-taxonomy`, and `verify observability-redaction` pass without a real broker session.
- Every mutating broker-facing route records an audit event before returning an acknowledgement or typed rejection.
- Idempotency replay after restart never allocates a second broker order id or sends a second broker command.
- Logs, metrics, verifier artifacts, and audit receipts never contain credentials, session cookies, or full real account identifiers.
- Failure envelopes, `adapter.failure` events, and audit receipts share the same request id and stable failure code for the same failed operation.

### Phase 4: Broker Session Management

Deliverables:

- Rust `broker_protocol` session manager for TWS/Gateway connect, reader loop, callback routing, shutdown, and reconnect.
- Startup matrix for paper/live environment, allowed ports, live disabled by default, exact live startup confirmation, endpoint identity, and client id.
- Readiness gate that reports `connected` only after both broker order-id readiness and callback-backed `reqCurrentTime` server-time calibration are fresh.
- Heartbeat loop that publishes `connection.status`, marks stale sessions explicitly, clears stale order-id allocation state on reconnect, and never hides request-scoped TWS errors.
- Deterministic fake-broker tests for disconnected, connecting, connected, stale, reconnecting, startup rejection, duplicate client id, server-time unavailable, and read-loop failure states.

Acceptance:

- Rust `verify startup-safety` and `verify server-time-provenance` pass without a real broker session.
- `GET /v1/status` exposes deterministic disconnected, connected, stale, and reconnecting states with Swift-decodable `serverTimeProvenance`.
- Account, market-data, order, option, and reconciliation routes fail closed before session readiness instead of touching broker state.
- Order-id allocation is unavailable while reconnect recovery is pending.

### Phase 5: Account, Position, And Reconciliation State

Deliverables:

- Rust account-state module for managed accounts, account summary, positions, account permissions, paper/live account selection, and position snapshots.
- Rust reconciliation module for open orders, completed orders, fills, commissions, late commission updates, parent/OCA linkage, account-scoped filtering, and reconnect recovery.
- Lifecycle cache that records broker order id, request id, account id, environment, status timeline, fill state, commission state, and audit event references.
- Event publishing for `account.summary`, `position.snapshot`, `order.status`, `fill.report`, and `adapter.failure`.
- Fill export shape that can replace Java wrapper fills in Flex reconciliation.

Acceptance:

- Existing Swift broker-state clients decode Rust responses for `/v1/accounts`, summary, positions, open/completed orders, fills, and cancel.
- Rust `verify order-lifecycle` passes and proves late commission updates republish `fill.report`.
- Option exercise/lapse gates can prove a verified option position before any broker exercise call.
- Paper and live order placement cannot start until account permissions, positions, and reconnect recovery state have been refreshed.
- Flex reconciliation can run against Rust-exported fills with the same semantic checks as the current fixture path.

### Phase 6: Market Data And Event Streaming

Deliverables:

- Contract resolution, market rules, quote snapshot, historical bars, historical ticks, quote subscribe/unsubscribe, real-time bar subscribe/unsubscribe.
- Historical pacing queue with active-request caps, duplicate suppression, same-contract burst control, weighted 10-minute window, cached fallback, and `retryAfterSeconds`.
- Event stream publishing for `connection.status`, `quote.snapshot`, `bars.snapshot`, `ticks.snapshot`, and `adapter.failure`.

Acceptance:

- Existing `TradingDataTests` pass against fake Rust responses and a running Rust disconnected/local fixture adapter.
- Stage C fixture verifier can be backed by Rust output.
- Real Gateway/TWS evidence is still marked external until collected from a user-managed paper session.

### Phase 7: Paper Order Preview, Placement, Modification, And Cancel

Deliverables:

- What-if preview path preserving commission, margin, warnings, required confirmations, and rejection details.
- Paper order placement with HTTP `202` acknowledgement only.
- Order modification and cancel paths that preserve exact confirmation, broker order id parsing, account matching, idempotency, and lifecycle reconciliation.
- Idempotency cache that validates the request body before replaying duplicate preview or placement acknowledgements.
- Reconnect recovery before new order id allocation.
- Event publishing for `order.status`, `fill.report`, `order.modify`, `order.global_cancel`, and `adapter.failure`.

Acceptance:

- Existing paper order, modification, reconnect, duplicate, and risk-path tests remain green.
- A retry with the same idempotency key never allocates a second order id.
- A mismatched idempotency key never reuses another request's cached response.
- Cancel and modification acknowledgements never replace final lifecycle state; final state still comes from events and reconciliation reads.

### Phase 8: Options, Spreads, Brackets, And Exercise

Deliverables:

- Option chain, selected option contract details, option quote, IV/Greeks where available.
- Single-leg option order mapping.
- Combo/BAG mapping for vertical spreads.
- Bracket/OCA mapping with parent/child linkage.
- Option exercise/lapse as a separate explicit workflow, not a normal order button.

Acceptance:

- Existing Stage E and Stage F Swift verifier tests pass against Rust-backed fixtures.
- Normal UI routes remain gated until reviewed real paper evidence exists.
- Exercise/lapse requires position verification, exact confirmation text, and idempotent acknowledgement.

### Phase 9: Live Gate Parity

Deliverables:

- Live startup gate with exact confirmation.
- Live account selection and explicit live endpoint.
- Live dry-run preview path that never posts `/v1/orders/live`.
- Live placement path gated by reviewed dry-run artifact, audit receipt, exact approval, and per-order confirmation.
- Live lifecycle persistence with broker order id, request id, account id, environment, status, fills, and commission updates.

Acceptance:

- Stage G local verifier tests pass without a live broker session.
- Real live evidence remains impossible to claim complete without external Gateway/TWS proof.
- Paper and live Java wrapper-compatible URLs cannot be reused for a live dry-run or live placement evidence run.

### Phase 10: Rename Swift Interfaces Away From Java

Only after the Rust adapter passes the existing contract:

- `IBKRJavaWrapperEndpointDefaults` becomes `LocalBrokerAdapterEndpointDefaults`.
- `IBKRJavaWrapperHTTP*Client` becomes `IBKRLocalAdapterHTTP*Client`.
- `TradingDashboardBootstrapMode.ibkrJavaWrapper` becomes `ibkrLocalAdapter`.
- Environment variables gain neutral aliases:
  - `AGENTIC_TRADING_ADAPTER_BASE_URL`
  - `AGENTIC_TRADING_ADAPTER_EVENTS_URL`
  - `AGENTIC_TRADING_MARKET_DATA_PROVIDER=ibkr-local-adapter`
- Old Java-named environment variables remain accepted for one transition release with warnings.

Acceptance:

- Swift tests still pass.
- Docs stop describing Java as the preferred path.
- Repository safety checks reject new required JVM dependencies in the backend path.

### Phase 11: Remove Java As A Required Runtime

Deliverables:

- `JavaWrappers/IBKRAdapter` moved to archival reference or removed after Rust parity.
- `scripts/run-ibkr-java-wrapper.sh` replaced by `scripts/run-local-broker-adapter.sh`.
- `scripts/collect-java-wrapper-evidence.sh` replaced by neutral adapter evidence collection.
- `scripts/validate-local.sh` no longer requires JDK 25.

Acceptance:

- Full validation passes without Java installed.
- No production path shells out to `java`, Gradle, or `TwsApi.jar`.
- Historical docs can mention the Java wrapper as a retired implementation only.

## Required Test Strategy

Use the current behavior as the migration spec.

1. Keep existing Swift tests green throughout.
2. Add Rust unit tests for each deep module interface.
3. Add Rust integration tests for every HTTP route and WebSocket event family.
4. Add JSON fixture tests comparing Rust verifier output to semantic expectations, not byte-for-byte Java formatting.
5. Add a compatibility harness that runs the Swift HTTP/event clients against the Rust process.
6. Keep real Gateway/TWS evidence as an external gate, not a local-completion claim.

Minimum proof before switching the app default:

```sh
DEVELOPER_DIR=/Users/gabrielalfonzo/Documents/Xcode-beta.app/Contents/Developer swift test
cargo test --workspace
agentic-trading-adapter verify api-surface
agentic-trading-adapter verify disconnected-surface
agentic-trading-adapter verify audit-idempotency
agentic-trading-adapter verify failure-taxonomy
agentic-trading-adapter verify observability-redaction
agentic-trading-adapter verify startup-safety
agentic-trading-adapter verify order-safety
agentic-trading-adapter verify market-data-streams
```

## Things Not To Do

- Do not rewrite the Swift app and backend contract at the same time.
- Do not preserve the Java process as a hidden required runtime.
- Do not add strategy-to-broker execution paths.
- Do not treat local deterministic verifier output as real IBKR session evidence.
- Do not let UI convenience bypass exact confirmations, risk decisions, idempotency, or audit events.
- Do not expose every broker feature just because the protocol module can map it.

## First Implementation Slice

The first useful Rust slice is compatibility, followed by operation-ledger safety, broker session correctness, and account-state correctness before market data.

Build a Rust process that serves `/v1/status`, `/v1/capabilities`, disconnected failure envelopes, and `/v1/events` replay. Then point the existing Swift clients at it. Once the Swift app can boot and fail closed through the Rust process, implement the operation ledger, audit receipt export, failure taxonomy, and redacted observability harness. After those safety primitives are deterministic, implement broker session management, then account/position/reconciliation state. Only after those steps are deterministic should market data, paper placement, options, and live gates move.
