# Electron Frontend Migration Guide

This guide supersedes the earlier multi-frontend migration plan. The active frontend target is Electron only.

## Scope

- Concept asset: `/Users/gabrielalfonzo/IdeaProjects/Trading/CONCEPT.png`
- Target viewport: `1586x992`
- Slice: `FE-01`
- Active code path: `apps/electron`
- Validation path: `scripts/validate-local.sh`
- Review scaffold: `scripts/prepare-fe01-snapshot-review.sh`

## Pixel-Grounded Region Map

- Top app bar: `x=0-1586`, `y=0-84`
- Left rail: `x=0-266`, `y=84-992`
- Center chart: `x=266-1258`, `y=178-600`
- Right panel: `x=1258-1586`, `y=84-950`
- Bottom dock: `x=266-1258`, `y=600-950`

The first viewport reads left-to-right as navigation, market inspection, decision. The center chart plus bottom dock is wider than the left rail and right panel combined.

## Required Surfaces

- Top app bar: workspace mode, backend status, market source, saved-state status, alerts, symbol search, refresh, settings.
- Left rail: local watchlist, activity, account footer.
- Center chart: quote header, timeframe controls, chart tools, live candlesticks, volume, levels, markers.
- Right panel: Proposal, Ticket, Risk, Preview tabs, disabled Live action, primary Review Paper action.
- Bottom dock: Positions, Orders, Fills, Options Chain, Audit, Diagnostics tabs.
- Diagnostics: adapter URL, settings database path, selected symbol, live source, last error.

## Rejection Checks

- Whole-window vertical scrolling required to see main regions.
- Verifier names, evidence bundle names, audit receipt names, or raw JSON appear outside Diagnostics.
- Runtime reads a shared fixture data file.
- A stock is preselected without local SQLite user state.
- Synthetic options, positions, orders, or fills are rendered as if they were live broker data.
- Any button, card, table, or input text clips or overlaps at `1586x992`.

## Startup Contract

The Electron app loads settings from the Rust backend SQLite API. If the settings database has no selected symbol, the app opens to an empty state. IBKR market data is requested only after a user enters a symbol, clicks a saved watchlist row, or starts the app with an explicitly persisted symbol.

`GET /v1/workbench/live` must reject requests without a symbol and must fail closed unless the backend has a ready IBKR Gateway/TWS session plus quote and bars callbacks for that symbol. The frontend must not recover from that by loading fixture JSON, a hardcoded stock, or any third-party market-data source.
