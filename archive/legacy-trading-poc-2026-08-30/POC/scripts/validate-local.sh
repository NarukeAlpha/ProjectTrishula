#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${VALIDATION_OUTPUT_DIR:-${TMPDIR:-/tmp}/agentic-trading-validation-$(date -u +%Y%m%dT%H%M%SZ)}"
MANIFEST_PATH="$OUTPUT_DIR/manifest.txt"
ELECTRON_TRACE="$OUTPUT_DIR/electron-frontend.json"
SURFACE_TRACE="$OUTPUT_DIR/electron-surface.json"
BACKEND_READINESS="$OUTPUT_DIR/backend-readiness.json"
LIVE_OUTPUT_DIR="$OUTPUT_DIR/ibkr-live-electron"

log() {
    printf '\n==> %s\n' "$1"
}

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf 'Missing required command: %s\n' "$1" >&2
        exit 1
    fi
}

run_rust_gate() {
    log "Running Rust formatter, build, tests, and clippy"
    (
        cd "$ROOT_DIR"
        cargo fmt --all -- --check
        cargo build --quiet
        cargo test --quiet
        CARGO_INCREMENTAL=0 cargo clippy --all-targets -- -D warnings
    )

    log "Writing aggregate Rust backend-readiness trace"
    (
        cd "$ROOT_DIR"
        cargo run --quiet -- verify backend-readiness --output "$BACKEND_READINESS"
    )

    jq -e '
        .isApproved == true
        and .evidence.localVerifierCount == .evidence.approvedVerifierCount
        and (.evidence.localVerifierCount | type == "number")
        and .evidence.completionBoundary == "local backend readiness does not prove external IBKR Gateway/TWS paper or live readiness"
    ' "$BACKEND_READINESS" >/dev/null

    jq '{verifier, isApproved, localVerifierCount: .evidence.localVerifierCount, approvedVerifierCount: .evidence.approvedVerifierCount, completionBoundary: .evidence.completionBoundary}' "$BACKEND_READINESS"

    {
        printf 'rustGate=passed\n'
        printf 'backendReadiness=%s\n' "$BACKEND_READINESS"
        printf 'backendReadinessApproved=%s\n' "$(jq -r '.isApproved' "$BACKEND_READINESS")"
        printf 'localVerifierCount=%s\n' "$(jq -r '.evidence.localVerifierCount' "$BACKEND_READINESS")"
        printf 'approvedVerifierCount=%s\n' "$(jq -r '.evidence.approvedVerifierCount' "$BACKEND_READINESS")"
    } >>"$MANIFEST_PATH"
}

run_electron_gate() {
    log "Running Electron frontend contract checks"
    (
        cd "$ROOT_DIR"
        node apps/electron/scripts/verify-electron.mjs --output "$ELECTRON_TRACE"
        node scripts/verify-frontend-parity.mjs --output "$SURFACE_TRACE"
    )
    jq -e '.isApproved == true' "$ELECTRON_TRACE" >/dev/null
    jq -e '.isApproved == true' "$SURFACE_TRACE" >/dev/null

    {
        printf 'electronGate=passed\n'
        printf 'electronTrace=%s\n' "$ELECTRON_TRACE"
        printf 'electronSurfaceTrace=%s\n' "$SURFACE_TRACE"
    } >>"$MANIFEST_PATH"
}

run_ibkr_live_electron_gate_if_requested() {
    if [[ "${TRADING_REQUIRE_IBKR_LIVE:-0}" != "1" ]]; then
        log "Skipping IBKR live Electron render gate; set TRADING_REQUIRE_IBKR_LIVE=1 to require real broker data"
        {
            printf 'ibkrLiveElectronGate=skipped\n'
            printf 'ibkrLiveSkipReason=%s\n' "requires a real IBKR Gateway/TWS session plus quote and bars callbacks"
        } >>"$MANIFEST_PATH"
        return
    fi

    log "Running IBKR live Electron render gate"
    (
        cd "$ROOT_DIR"
        VALIDATION_OUTPUT_DIR="$LIVE_OUTPUT_DIR" scripts/validate-live-frontends.sh
    )
    {
        printf 'ibkrLiveElectronGate=passed\n'
        printf 'ibkrLiveElectronManifest=%s\n' "$LIVE_OUTPUT_DIR/manifest.txt"
        printf 'ibkrLiveElectronSnapshot=%s\n' "$LIVE_OUTPUT_DIR/electron-live-1586x992.png"
        printf 'ibkrLiveElectronInteractionTrace=%s\n' "$LIVE_OUTPUT_DIR/electron-interactions.json"
        printf 'ibkrLiveElectronSnapshotTrace=%s\n' "$LIVE_OUTPUT_DIR/live-snapshot-content.json"
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
        printf 'startedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } >"$MANIFEST_PATH"
    log "Validation artifacts: $OUTPUT_DIR"

    run_rust_gate
    run_electron_gate
    run_ibkr_live_electron_gate_if_requested

    {
        printf 'completedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf 'validation=passed\n'
    } >>"$MANIFEST_PATH"
    log "Local validation complete"
}

main "$@"
