#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${VALIDATION_OUTPUT_DIR:-${TMPDIR:-/tmp}/agentic-trading-validation-$(date -u +%Y%m%dT%H%M%SZ)}"
if [[ -z "${DEVELOPER_DIR:-}" && -d "/Users/gabrielalfonzo/Documents/Xcode-beta.app/Contents/Developer" ]]; then
    export DEVELOPER_DIR="/Users/gabrielalfonzo/Documents/Xcode-beta.app/Contents/Developer"
fi
MANIFEST_PATH="$OUTPUT_DIR/manifest.txt"
ELECTRON_SNAPSHOT="${FE01_ELECTRON_SNAPSHOT:-$OUTPUT_DIR/electron-1586x992.png}"
SWIFT_SNAPSHOT="${FE01_SWIFT_SNAPSHOT:-$OUTPUT_DIR/swift-1586x992.png}"
ELECTRON_TRACE="$OUTPUT_DIR/electron-frontend.json"
PARITY_TRACE="$OUTPUT_DIR/frontend-parity.json"
SNAPSHOT_TRACE="$OUTPUT_DIR/frontend-snapshot-content.json"
BACKEND_READINESS="$OUTPUT_DIR/backend-readiness.json"

log() {
    printf '\n==> %s\n' "$1"
}

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf 'Missing required command: %s\n' "$1" >&2
        exit 1
    fi
}

image_dimensions() {
    local image_path="$1"
    local width height
    width="$(sips -g pixelWidth "$image_path" 2>/dev/null | awk '/pixelWidth:/ {print $2}')"
    height="$(sips -g pixelHeight "$image_path" 2>/dev/null | awk '/pixelHeight:/ {print $2}')"
    printf '%sx%s' "$width" "$height"
}

require_dimensions() {
    local image_path="$1"
    local expected="$2"
    local actual
    actual="$(image_dimensions "$image_path")"
    if [[ "$actual" != "$expected" ]]; then
        printf 'Expected %s to be %s, got %s\n' "$image_path" "$expected" "$actual" >&2
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
    )
    jq -e '.isApproved == true' "$ELECTRON_TRACE" >/dev/null

    if [[ ! -x "$ROOT_DIR/node_modules/.bin/electron" ]]; then
        printf 'Electron is not installed. Run npm install in %s.\n' "$ROOT_DIR" >&2
        exit 1
    fi

    log "Rendering Electron snapshot"
    (
        cd "$ROOT_DIR"
        "$ROOT_DIR/node_modules/.bin/electron" apps/electron/main.cjs --snapshot "$ELECTRON_SNAPSHOT" --width 1586 --height 992
    )
    require_dimensions "$ELECTRON_SNAPSHOT" "1586x992"

    {
        printf 'electronGate=passed\n'
        printf 'electronTrace=%s\n' "$ELECTRON_TRACE"
        printf 'electronSnapshot=%s\n' "$ELECTRON_SNAPSHOT"
        printf 'electronSnapshotDimensions=%s\n' "$(image_dimensions "$ELECTRON_SNAPSHOT")"
    } >>"$MANIFEST_PATH"
}

run_swift_gate() {
    log "Building Swift frontend"
    (
        cd "$ROOT_DIR"
        swift build --package-path apps/swift --quiet
    )

    log "Rendering Swift snapshot"
    (
        cd "$ROOT_DIR"
        swift run --package-path apps/swift TradingSwiftApp --snapshot "$SWIFT_SNAPSHOT" --width 1586 --height 992
    )
    require_dimensions "$SWIFT_SNAPSHOT" "1586x992"

    {
        printf 'swiftGate=passed\n'
        printf 'swiftPackage=%s\n' "$ROOT_DIR/apps/swift/Package.swift"
        printf 'swiftSnapshot=%s\n' "$SWIFT_SNAPSHOT"
        printf 'swiftSnapshotDimensions=%s\n' "$(image_dimensions "$SWIFT_SNAPSHOT")"
    } >>"$MANIFEST_PATH"
}

run_parity_gate() {
    log "Verifying Electron and Swift frontend parity contract"
    (
        cd "$ROOT_DIR"
        node scripts/verify-frontend-parity.mjs --output "$PARITY_TRACE"
    )
    jq -e '.isApproved == true' "$PARITY_TRACE" >/dev/null
    {
        printf 'frontendParity=passed\n'
        printf 'frontendParityTrace=%s\n' "$PARITY_TRACE"
    } >>"$MANIFEST_PATH"
}

run_snapshot_content_gate() {
    log "Verifying frontend snapshot content"
    (
        cd "$ROOT_DIR"
        node scripts/verify-snapshots.mjs --electron "$ELECTRON_SNAPSHOT" --swift "$SWIFT_SNAPSHOT" --output "$SNAPSHOT_TRACE"
    )
    jq -e '.isApproved == true' "$SNAPSHOT_TRACE" >/dev/null
    {
        printf 'frontendSnapshotContent=passed\n'
        printf 'frontendSnapshotContentTrace=%s\n' "$SNAPSHOT_TRACE"
    } >>"$MANIFEST_PATH"
}

main() {
    require_command cargo
    require_command jq
    require_command node
    require_command swift
    require_command sips

    mkdir -p "$OUTPUT_DIR"
    {
        printf 'validationOutputDir=%s\n' "$OUTPUT_DIR"
        printf 'rootDir=%s\n' "$ROOT_DIR"
        printf 'startedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } >"$MANIFEST_PATH"
    log "Validation artifacts: $OUTPUT_DIR"

    run_rust_gate
    run_electron_gate
    run_swift_gate
    run_parity_gate
    run_snapshot_content_gate

    {
        printf 'completedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf 'validation=passed\n'
    } >>"$MANIFEST_PATH"
    log "Local validation complete"
}

main "$@"
