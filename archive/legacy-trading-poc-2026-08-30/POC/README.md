# Trading

Rust backend plus an Electron workstation for the trading platform rebuild.

The old Agentic Trading workspace is not part of this validation path. Everything active in this rebuild lives under this repository:

- Rust adapter and live-data/settings API: `src/`
- Electron frontend: `apps/electron/`
- Visual target: `CONCEPT.png`

## Backend

Run the backend against IBKR Gateway or TWS paper mode:

```sh
cargo run -- serve \
  --listen 127.0.0.1:8765 \
  --startup-mode broker \
  --broker-host 127.0.0.1 \
  --broker-port 4002 \
  --broker-client-id 42 \
  --broker-environment ibkr-paper
```

The app stores local UI state in SQLite. By default the database is under `~/Library/Application Support/Agentic Trading/settings.sqlite`; override it for tests with `TRADING_SETTINGS_DB=/path/to/settings.sqlite`.

Fetch IBKR workbench market data only after choosing a symbol:

```sh
curl 'http://127.0.0.1:8765/v1/workbench/live?symbol=AAPL&timeframe=5m'
```

Requests without `symbol` are rejected. Requests with a symbol also fail closed unless the Rust backend has a ready IBKR Gateway/TWS session plus IBKR quote and bars callbacks for that symbol. There is no third-party market-data fallback. The app should open with no selected stock unless the SQLite settings database already contains a user-selected symbol.

Verify backend readiness:

```sh
cargo run -- verify backend-readiness --output /tmp/agentic-trading-rust-backend-readiness.json
```

## Electron App

Install and open the app against the IBKR backend:

```sh
npm install
npm run live:app
```

`npm run live:app` starts broker mode with `TRADING_IBKR_HOST=127.0.0.1`, `TRADING_IBKR_PORT=4002`, `TRADING_IBKR_CLIENT_ID=42`, and `TRADING_IBKR_ENVIRONMENT=ibkr-paper` unless overridden.

To intentionally start with a saved symbol for a session:

```sh
TRADING_LIVE_SYMBOL=AAPL npm run live:app
```

The Electron runtime does not read fixture JSON. Symbol search, watchlist rows, timeframes, ranges, right-panel tabs, bottom dock tabs, manual refresh, chart tools, and Review Paper are wired in the renderer. Live trading remains disabled.

## Validation

Run the full local gate:

```sh
scripts/validate-local.sh
```

That gate runs:

- Rust formatter, build, tests, clippy, and backend-readiness trace
- Electron static/interaction contract checks
- Optional IBKR Electron render only when `TRADING_REQUIRE_IBKR_LIVE=1`

Run only the IBKR backend-to-Electron gate:

```sh
npm run verify:live-frontends
```

That gate requires a real IBKR Gateway/TWS session and IBKR market-data callbacks for `TRADING_LIVE_SYMBOL` before it can produce a screenshot.

Create the FE-01 Electron review scaffold from a validation output directory:

```sh
VALIDATION_OUTPUT_DIR=/tmp/agentic-trading-validation \
scripts/prepare-fe01-snapshot-review.sh
```

Passing local validation proves local Rust/Electron behavior and absence of fixture/runtime fallback paths. It does not prove real IBKR Gateway/TWS paper or live readiness unless the explicit IBKR live gate passes.
