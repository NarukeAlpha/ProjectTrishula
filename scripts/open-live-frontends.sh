#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LISTEN="${TRADING_LIVE_LISTEN:-127.0.0.1:8765}"
BASE_URL="${TRADING_ADAPTER_BASE_URL:-http://${LISTEN}}"
SYMBOL="${TRADING_LIVE_SYMBOL:-NVDA}"
BACKEND_LOG="${TRADING_LIVE_BACKEND_LOG:-${TMPDIR:-/tmp}/trading-live-backend.log}"
BACKEND_PID=""
ELECTRON_PID=""
SWIFT_PID=""

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

cleanup_started_backend() {
    if [[ -n "$BACKEND_PID" ]]; then
        kill "$BACKEND_PID" >/dev/null 2>&1 || true
        wait "$BACKEND_PID" >/dev/null 2>&1 || true
    fi
}

stop_children_on_interrupt() {
    if [[ -n "$ELECTRON_PID" ]]; then
        kill "$ELECTRON_PID" >/dev/null 2>&1 || true
    fi
    if [[ -n "$SWIFT_PID" ]]; then
        kill "$SWIFT_PID" >/dev/null 2>&1 || true
    fi
    cleanup_started_backend
    exit 130
}

trap cleanup_started_backend EXIT
trap stop_children_on_interrupt INT TERM

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
        log "Reusing Rust backend at $BASE_URL"
        return
    fi

    log "Starting Rust backend at $LISTEN"
    (
        cd "$ROOT_DIR"
        cargo run --quiet -- serve --startup-mode connected-fixture --listen "$LISTEN"
    ) >"$BACKEND_LOG" 2>&1 &
    BACKEND_PID="$!"
    wait_for_backend
}

prove_live_payload() {
    log "Checking live market payload for $SYMBOL"
    local payload
    payload="$(curl -fsS "$BASE_URL/v1/workbench/live?symbol=$SYMBOL")"
    jq -e '
        .adapter.providerState == "Rust Backend Live"
        and .adapter.externalEvidence == "External live market fetch succeeded"
        and (.bars | length >= 30)
    ' <<<"$payload" >/dev/null
    jq '{symbol,lastPrice,change,changePercent,liveSource,bars:(.bars|length)}' <<<"$payload"
}

open_electron() {
    if [[ ! -x "$ROOT_DIR/node_modules/.bin/electron" ]]; then
        printf 'Electron is not installed. Run npm install in %s.\n' "$ROOT_DIR" >&2
        exit 1
    fi

    log "Opening Electron frontend"
    (
        cd "$ROOT_DIR"
        TRADING_ADAPTER_BASE_URL="$BASE_URL" "$ROOT_DIR/node_modules/.bin/electron" \
            apps/electron/main.cjs \
            --adapter-base-url "$BASE_URL"
    ) &
    ELECTRON_PID="$!"
}

open_swift() {
    log "Opening Swift/macOS frontend"
    (
        cd "$ROOT_DIR"
        TRADING_ADAPTER_BASE_URL="$BASE_URL" swift run --package-path apps/swift TradingSwiftApp \
            --adapter-base-url "$BASE_URL"
    ) &
    SWIFT_PID="$!"
}

wait_for_frontends() {
    log "Both frontends are launching against $BASE_URL"
    printf 'Close both app windows when done, or press Ctrl-C here to stop them and the backend.\n'

    local electron_status=0
    local swift_status=0
    wait "$ELECTRON_PID" || electron_status=$?
    wait "$SWIFT_PID" || swift_status=$?

    if [[ "$electron_status" -ne 0 || "$swift_status" -ne 0 ]]; then
        printf 'Frontend process exited non-zero: electron=%s swift=%s\n' "$electron_status" "$swift_status" >&2
        exit 1
    fi
}

main() {
    require_command cargo
    require_command curl
    require_command jq
    require_command swift

    start_backend_if_needed
    prove_live_payload
    open_electron
    open_swift
    wait_for_frontends
}

main "$@"
