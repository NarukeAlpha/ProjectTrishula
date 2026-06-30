#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${VALIDATION_OUTPUT_DIR:-${TMPDIR:-/tmp}/trading-live-validation-$(date -u +%Y%m%dT%H%M%SZ)}"
LISTEN="${TRADING_LIVE_LISTEN:-127.0.0.1:18765}"
BASE_URL="${TRADING_ADAPTER_BASE_URL:-http://${LISTEN}}"
SYMBOL="${TRADING_LIVE_SYMBOL:-NVDA}"
MANIFEST_PATH="$OUTPUT_DIR/manifest.txt"
BACKEND_JSON="$OUTPUT_DIR/backend-live-workbench.json"
SNAPSHOT_TRACE="$OUTPUT_DIR/live-snapshot-content.json"
ELECTRON_SNAPSHOT="$OUTPUT_DIR/electron-live-1586x992.png"
SWIFT_SNAPSHOT="$OUTPUT_DIR/swift-live-1586x992.png"
BACKEND_LOG="$OUTPUT_DIR/backend.log"
BACKEND_PID=""

if [[ -z "${DEVELOPER_DIR:-}" && -d "/Users/gabrielalfonzo/Documents/Xcode-beta.app/Contents/Developer" ]]; then
    export DEVELOPER_DIR="/Users/gabrielalfonzo/Documents/Xcode-beta.app/Contents/Developer"
fi

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
        printf 'backendMode=reused\n' >>"$MANIFEST_PATH"
        return
    fi
    log "Starting Rust backend at $LISTEN"
    (
        cd "$ROOT_DIR"
        cargo run --quiet -- serve --startup-mode connected-fixture --listen "$LISTEN"
    ) >"$BACKEND_LOG" 2>&1 &
    BACKEND_PID="$!"
    printf 'backendMode=started\n' >>"$MANIFEST_PATH"
    printf 'backendPid=%s\n' "$BACKEND_PID" >>"$MANIFEST_PATH"
    wait_for_backend
}

verify_live_payload() {
    log "Fetching live backend workbench payload"
    curl -fsS "$BASE_URL/v1/workbench/live?symbol=$SYMBOL" >"$BACKEND_JSON"
    jq -e '
        .adapter.connectionState == "connected"
        and .adapter.providerState == "Rust Backend Live"
        and .adapter.externalEvidence == "External live market fetch succeeded"
        and .liveSource.provider == "Yahoo Finance chart"
        and (.liveSource.fetchedAt | type == "string")
        and (.liveSource.regularMarketTime | type == "string")
        and (.bars | length >= 30)
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

render_frontends() {
    log "Rendering Electron snapshot against live backend"
    (
        cd "$ROOT_DIR"
        TRADING_ADAPTER_BASE_URL="$BASE_URL" "$ROOT_DIR/node_modules/.bin/electron" \
            apps/electron/main.cjs \
            --adapter-base-url "$BASE_URL" \
            --snapshot "$ELECTRON_SNAPSHOT" \
            --width 1586 \
            --height 992
    )

    log "Rendering Swift snapshot against live backend"
    (
        cd "$ROOT_DIR"
        TRADING_ADAPTER_BASE_URL="$BASE_URL" swift run --package-path apps/swift TradingSwiftApp \
            --adapter-base-url "$BASE_URL" \
            --snapshot "$SWIFT_SNAPSHOT" \
            --width 1586 \
            --height 992
    )

    log "Verifying rendered snapshot content"
    (
        cd "$ROOT_DIR"
        node scripts/verify-snapshots.mjs \
            --electron "$ELECTRON_SNAPSHOT" \
            --swift "$SWIFT_SNAPSHOT" \
            --output "$SNAPSHOT_TRACE"
    )
    jq -e '.isApproved == true' "$SNAPSHOT_TRACE" >/dev/null
    {
        printf 'electronLiveSnapshot=%s\n' "$ELECTRON_SNAPSHOT"
        printf 'swiftLiveSnapshot=%s\n' "$SWIFT_SNAPSHOT"
        printf 'liveSnapshotTrace=%s\n' "$SNAPSHOT_TRACE"
    } >>"$MANIFEST_PATH"
}

main() {
    require_command cargo
    require_command curl
    require_command jq
    require_command node
    require_command swift

    mkdir -p "$OUTPUT_DIR"
    {
        printf 'validationOutputDir=%s\n' "$OUTPUT_DIR"
        printf 'rootDir=%s\n' "$ROOT_DIR"
        printf 'baseUrl=%s\n' "$BASE_URL"
        printf 'symbol=%s\n' "$SYMBOL"
        printf 'startedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } >"$MANIFEST_PATH"

    start_backend_if_needed
    verify_live_payload
    render_frontends

    {
        printf 'completedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf 'validation=passed\n'
    } >>"$MANIFEST_PATH"
    log "Live frontend validation complete: $OUTPUT_DIR"
}

main "$@"
