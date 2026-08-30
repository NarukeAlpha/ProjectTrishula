#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LISTEN="${TRADING_LIVE_LISTEN:-127.0.0.1:8765}"
BASE_URL="${TRADING_ADAPTER_BASE_URL:-http://${LISTEN}}"
SYMBOL="${TRADING_LIVE_SYMBOL:-}"
IBKR_HOST="${TRADING_IBKR_HOST:-127.0.0.1}"
IBKR_PORT="${TRADING_IBKR_PORT:-4002}"
IBKR_CLIENT_ID="${TRADING_IBKR_CLIENT_ID:-42}"
IBKR_ENVIRONMENT="${TRADING_IBKR_ENVIRONMENT:-ibkr-paper}"
IBKR_STARTUP_CALLBACKS="${TRADING_IBKR_STARTUP_CALLBACKS:-8}"
BACKEND_LOG="${TRADING_LIVE_BACKEND_LOG:-${TMPDIR:-/tmp}/trading-live-backend.log}"
BACKEND_PID=""
ELECTRON_PID=""

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
        log "Reusing Rust backend at $BASE_URL"
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
        cargo run --quiet -- "${broker_args[@]}"
    ) >"$BACKEND_LOG" 2>&1 &
    BACKEND_PID="$!"
    wait_for_backend
}

seed_symbol_if_requested() {
    if [[ -z "$SYMBOL" ]]; then
        log "No startup symbol provided; Electron will open with no selected stock unless SQLite has saved state"
        return
    fi

    log "Saving startup symbol $SYMBOL"
    curl -fsS \
        -X POST \
        -H 'content-type: application/json' \
        --data "$(printf '{"symbol":"%s"}' "$SYMBOL")" \
        "$BASE_URL/v1/app/watchlist" >/dev/null
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

wait_for_frontend() {
    log "Electron is running against $BASE_URL"
    printf 'Close the app window when done, or press Ctrl-C here to stop it and the backend.\n'

    local electron_status=0
    wait "$ELECTRON_PID" || electron_status=$?

    if [[ "$electron_status" -ne 0 ]]; then
        printf 'Electron exited non-zero: %s\n' "$electron_status" >&2
        exit 1
    fi
}

main() {
    require_command cargo
    require_command curl

    start_backend_if_needed
    seed_symbol_if_requested
    open_electron
    wait_for_frontend
}

main "$@"
