#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${VALIDATION_OUTPUT_DIR:-${TMPDIR:-/tmp}/trading-live-validation-$(date -u +%Y%m%dT%H%M%SZ)}"
LISTEN="${TRADING_LIVE_LISTEN:-127.0.0.1:18765}"
BASE_URL="${TRADING_ADAPTER_BASE_URL:-http://${LISTEN}}"
SYMBOL="${TRADING_LIVE_SYMBOL:-AAPL}"
IBKR_HOST="${TRADING_IBKR_HOST:-127.0.0.1}"
IBKR_PORT="${TRADING_IBKR_PORT:-4002}"
IBKR_CLIENT_ID="${TRADING_IBKR_CLIENT_ID:-42}"
IBKR_ENVIRONMENT="${TRADING_IBKR_ENVIRONMENT:-ibkr-paper}"
IBKR_STARTUP_CALLBACKS="${TRADING_IBKR_STARTUP_CALLBACKS:-8}"
SETTINGS_DB="$OUTPUT_DIR/settings.sqlite"
MANIFEST_PATH="$OUTPUT_DIR/manifest.txt"
BACKEND_JSON="$OUTPUT_DIR/backend-live-workbench.json"
SNAPSHOT_TRACE="$OUTPUT_DIR/live-snapshot-content.json"
INTERACTION_TRACE="$OUTPUT_DIR/electron-interactions.json"
ELECTRON_SNAPSHOT="$OUTPUT_DIR/electron-live-1586x992.png"
BACKEND_LOG="$OUTPUT_DIR/backend.log"
BACKEND_PID=""

log() {
    printf '\n==> %s\n' "$1"
}

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf 'Missing required command: %s\n' "$1" >&2
        exit 1
    fi
}

cleanup() {
    if [[ -n "$BACKEND_PID" ]]; then
        kill "$BACKEND_PID" >/dev/null 2>&1 || true
        wait "$BACKEND_PID" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

wait_for_backend() {
    for _ in $(seq 1 80); do
        if curl -fsS "$BASE_URL/v1/status" >/dev/null 2>&1; then
            return 0
        fi
        if [[ -n "$BACKEND_PID" ]] && ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
            wait "$BACKEND_PID" >/dev/null 2>&1 || true
            BACKEND_PID=""
            printf 'Backend exited before becoming ready at %s\n' "$BASE_URL" >&2
            if [[ -f "$BACKEND_LOG" ]]; then
                tail -n 120 "$BACKEND_LOG" >&2 || true
            fi
            exit 1
        fi
        sleep 0.25
    done
    printf 'Backend did not become ready at %s\n' "$BASE_URL" >&2
    if [[ -f "$BACKEND_LOG" ]]; then
        tail -n 80 "$BACKEND_LOG" >&2 || true
    fi
    exit 1
}

start_backend_if_needed() {
    if curl -fsS "$BASE_URL/v1/status" >/dev/null 2>&1; then
        if ! curl -fsS "$BASE_URL/v1/app/settings" >/dev/null 2>&1; then
            printf 'Existing backend at %s is incompatible with the Electron settings API. Stop it or use TRADING_LIVE_LISTEN on another port.\n' "$BASE_URL" >&2
            exit 1
        fi
        printf 'backendMode=reused\n' >>"$MANIFEST_PATH"
        return
    fi
    log "Starting Rust backend in IBKR broker mode at $LISTEN"
    local broker_args=(
        serve
        --listen "$LISTEN"
        --startup-mode broker
        --broker-host "$IBKR_HOST"
        --broker-port "$IBKR_PORT"
        --broker-client-id "$IBKR_CLIENT_ID"
        --broker-environment "$IBKR_ENVIRONMENT"
        --startup-callbacks "$IBKR_STARTUP_CALLBACKS"
    )
    if [[ "${TRADING_ENABLE_LIVE_TRADING:-false}" == "true" ]]; then
        broker_args+=(--enable-live-trading)
        if [[ -n "${TRADING_LIVE_TRADING_CONFIRMATION:-}" ]]; then
            broker_args+=(--live-trading-confirmation "$TRADING_LIVE_TRADING_CONFIRMATION")
        fi
    fi
    (
        cd "$ROOT_DIR"
        TRADING_SETTINGS_DB="$SETTINGS_DB" cargo run --quiet -- "${broker_args[@]}"
    ) >"$BACKEND_LOG" 2>&1 &
    BACKEND_PID="$!"
    printf 'backendMode=started\n' >>"$MANIFEST_PATH"
    printf 'backendPid=%s\n' "$BACKEND_PID" >>"$MANIFEST_PATH"
    wait_for_backend
}

seed_symbol() {
    log "Persisting validation symbol $SYMBOL"
    curl -fsS \
        -X POST \
        -H 'content-type: application/json' \
        --data "$(printf '{"symbol":"%s"}' "$SYMBOL")" \
        "$BASE_URL/v1/app/watchlist" >"$OUTPUT_DIR/settings-after-symbol.json"
    jq -e --arg symbol "$SYMBOL" '.selectedSymbol == $symbol' "$OUTPUT_DIR/settings-after-symbol.json" >/dev/null
}

verify_live_payload() {
    log "Fetching IBKR backend workbench payload"
    local status
    status="$(curl -sS -o "$BACKEND_JSON" -w "%{http_code}" "$BASE_URL/v1/workbench/live?symbol=$SYMBOL&timeframe=5m" || true)"
    if [[ "$status" != "200" ]]; then
        printf 'IBKR workbench payload was not available for %s (HTTP %s). Backend response:\n' "$SYMBOL" "$status" >&2
        cat "$BACKEND_JSON" >&2 || true
        printf '\nBackend log:\n' >&2
        tail -n 120 "$BACKEND_LOG" >&2 || true
        exit 1
    fi
    jq -e '
        .adapter.providerState == "IBKR Market Data"
        and .adapter.externalEvidence == "IBKR broker callback replay supplied quote and bars"
        and .liveSource.provider == "IBKR Gateway/TWS"
        and (.liveSource.url == null)
        and (.liveSource.fetchedAt | type == "string")
        and (.liveSource.regularMarketTime | type == "string")
        and (.bars | length >= 1)
        and (.optionsChain | length == 0)
        and (.positions | length == 0)
        and (.lastPrice | type == "string")
    ' "$BACKEND_JSON" >/dev/null
    jq '{symbol,lastPrice,change,changePercent,liveSource,bars:(.bars|length)}' "$BACKEND_JSON"
    {
        printf 'backendLivePayload=%s\n' "$BACKEND_JSON"
        printf 'backendLiveFetchedAt=%s\n' "$(jq -r '.liveSource.fetchedAt' "$BACKEND_JSON")"
        printf 'backendLiveRegularMarketTime=%s\n' "$(jq -r '.liveSource.regularMarketTime' "$BACKEND_JSON")"
        printf 'backendLiveLastPrice=%s\n' "$(jq -r '.lastPrice' "$BACKEND_JSON")"
        printf 'backendLiveBars=%s\n' "$(jq -r '.bars | length' "$BACKEND_JSON")"
    } >>"$MANIFEST_PATH"
}

render_frontend() {
    log "Rendering Electron snapshot against IBKR backend"
    (
        cd "$ROOT_DIR"
        TRADING_ADAPTER_BASE_URL="$BASE_URL" "$ROOT_DIR/node_modules/.bin/electron" \
            apps/electron/main.cjs \
            --adapter-base-url "$BASE_URL" \
            --interaction-report "$INTERACTION_TRACE" \
            --snapshot "$ELECTRON_SNAPSHOT" \
            --width 1586 \
            --height 992
    )
    jq -e '.isApproved == true' "$INTERACTION_TRACE" >/dev/null

    log "Verifying rendered snapshot content"
    (
        cd "$ROOT_DIR"
        node scripts/verify-snapshots.mjs \
            --electron "$ELECTRON_SNAPSHOT" \
            --output "$SNAPSHOT_TRACE"
    )
    jq -e '.isApproved == true' "$SNAPSHOT_TRACE" >/dev/null
    {
        printf 'electronLiveSnapshot=%s\n' "$ELECTRON_SNAPSHOT"
        printf 'electronInteractionTrace=%s\n' "$INTERACTION_TRACE"
        printf 'liveSnapshotTrace=%s\n' "$SNAPSHOT_TRACE"
    } >>"$MANIFEST_PATH"
}

main() {
    require_command cargo
    require_command curl
    require_command jq
    require_command node

    mkdir -p "$OUTPUT_DIR"
    {
        printf 'validationOutputDir=%s\n' "$OUTPUT_DIR"
        printf 'rootDir=%s\n' "$ROOT_DIR"
        printf 'baseUrl=%s\n' "$BASE_URL"
        printf 'symbol=%s\n' "$SYMBOL"
        printf 'settingsDb=%s\n' "$SETTINGS_DB"
        printf 'startedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } >"$MANIFEST_PATH"

    start_backend_if_needed
    seed_symbol
    verify_live_payload
    render_frontend

    {
        printf 'completedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf 'validation=passed\n'
    } >>"$MANIFEST_PATH"
    log "Live frontend validation complete: $OUTPUT_DIR"
}

main "$@"
