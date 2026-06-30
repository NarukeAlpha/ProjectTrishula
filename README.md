# Trading

Rust backend plus from-scratch Electron and Swift frontends for the trading platform rebuild.

The old Agentic Trading workspace is not part of this validation path. Everything in the current rebuild lives under this repository:

- Rust adapter: `src/`
- Electron frontend: `apps/electron/`
- Swift frontend: `apps/swift/`
- Shared frontend data: `frontend/shared/`
- Visual target: `CONCEPT.png`

## Backend

The Rust adapter preserves the local `ibkr-local-adapter.v1` HTTP/WebSocket contract and fails closed unless a connected fixture or broker startup mode is selected.

Run it:

```sh
cargo run -- serve --listen 127.0.0.1:8765
cargo run -- serve --startup-mode connected-fixture --listen 127.0.0.1:8765
```

Fetch the frontend workbench payload from live external market data:

```sh
curl 'http://127.0.0.1:8765/v1/workbench/live?symbol=NVDA'
```

Verify backend readiness:

```sh
cargo run -- verify backend-readiness --output /tmp/agentic-trading-rust-backend-readiness.json
```

## Frontends

`CONCEPT.png` is the `1586x992` visual contract. Both frontends target the same chart-first workstation shape:

- top app bar with workspace mode, provider state, paper/live state, rollback, adapter health, and alerts
- left rail with watchlist, saved captures, and account footer
- dominant center market workspace with quote header, chart, volume, price levels, and markers
- right decision panel with Proposal/Ticket/Risk/Preview tabs, locked Live, and primary Review Paper
- bottom dock with Positions, Orders, Fills, Options Chain, Audit, and Diagnostics
- diagnostics as the only normal place for raw proof details

Electron:

```sh
npm install
npm run live:frontends
npm run electron
npm run verify:electron
npm run snapshot:electron
```

Swift:

```sh
swift build --package-path apps/swift
swift run --package-path apps/swift TradingSwiftApp
swift run --package-path apps/swift TradingSwiftApp --snapshot /tmp/agentic-trading-swift.png --width 1586 --height 992
```

## Validation

Run the full local gate:

```sh
scripts/validate-local.sh
```

That gate runs:

- Rust formatter, build, tests, clippy, and backend-readiness trace
- Electron frontend contract verifier and Electron snapshot
- Swift package build and Swift snapshot
- Electron/Swift parity verifier

Run the live backend-to-frontend gate:

```sh
npm run verify:live-frontends
```

That gate starts the Rust backend when needed, fetches current external market data through `/v1/workbench/live`, renders both Electron and Swift against that backend payload, and verifies both screenshots.

Open both usable frontends against the live backend:

```sh
npm run live:frontends
```

That command starts or reuses the Rust backend, checks the live NVDA payload, opens Electron, opens the Swift/macOS app, and keeps the backend alive until the launched apps exit.

Create the FE-01 review scaffold from a validation output directory:

```sh
VALIDATION_OUTPUT_DIR=/tmp/agentic-trading-validation \
scripts/prepare-fe01-snapshot-review.sh
```

Passing local validation proves the local Rust/Electron/Swift implementation is healthy. It does not prove real IBKR Gateway/TWS paper or live readiness.
