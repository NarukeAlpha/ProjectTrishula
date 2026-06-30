#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONCEPT_PATH="${FE01_CONCEPT_PATH:-$ROOT_DIR/CONCEPT.png}"
VALIDATION_DIR="${VALIDATION_OUTPUT_DIR:-/tmp/agentic-trading-validation}"
OUTPUT_PATH="${FE01_REVIEW_OUTPUT:-/tmp/agentic-trading-fe01-snapshot-review.md}"
ELECTRON_SNAPSHOT="${FE01_ELECTRON_SNAPSHOT:-$VALIDATION_DIR/electron-1586x992.png}"
SWIFT_SNAPSHOT="${FE01_SWIFT_SNAPSHOT:-$VALIDATION_DIR/swift-1586x992.png}"
BACKEND_READINESS="$VALIDATION_DIR/backend-readiness.json"
ELECTRON_TRACE="${FE01_ELECTRON_TRACE:-$VALIDATION_DIR/electron-frontend.json}"
PARITY_TRACE="${FE01_FRONTEND_PARITY_TRACE:-$VALIDATION_DIR/frontend-parity.json}"
SNAPSHOT_TRACE="${FE01_FRONTEND_SNAPSHOT_TRACE:-$VALIDATION_DIR/frontend-snapshot-content.json}"
MANIFEST="$VALIDATION_DIR/manifest.txt"
ALLOW_MISSING=0

usage() {
    cat <<'USAGE'
Usage: scripts/prepare-fe01-snapshot-review.sh [--allow-missing]

Environment:
  VALIDATION_OUTPUT_DIR          Directory from scripts/validate-local.sh.
  FE01_REVIEW_OUTPUT             Markdown file to write.
  FE01_ELECTRON_SNAPSHOT         Electron 1586x992 screenshot.
  FE01_SWIFT_SNAPSHOT            SwiftUI 1586x992 screenshot.
  FE01_ELECTRON_TRACE            Electron frontend verifier JSON.
  FE01_FRONTEND_PARITY_TRACE     Shared Electron/Swift parity verifier JSON.
  FE01_FRONTEND_SNAPSHOT_TRACE   PNG content verifier JSON.

Without --allow-missing, all evidence paths must exist and JSON verifiers must
be approved. Use --allow-missing only to create a draft template.
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --allow-missing)
            ALLOW_MISSING=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            printf 'Unknown argument: %s\n' "$1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf 'Missing required command: %s\n' "$1" >&2
        exit 1
    fi
}

require_command jq

missing_count=0

file_display() {
    local path="$1"
    if [[ -n "$path" && -s "$path" ]]; then
        printf '%s' "$path"
    else
        printf 'MISSING'
    fi
}

count_missing_file() {
    local path="$1"
    if [[ -z "$path" || ! -s "$path" ]]; then
        missing_count=$((missing_count + 1))
    fi
}

json_bool() {
    local path="$1"
    local expression="$2"
    if [[ -s "$path" ]]; then
        jq -r "$expression" "$path"
    else
        printf 'missing'
    fi
}

json_summary() {
    local path="$1"
    local expression="$2"
    if [[ -s "$path" ]]; then
        jq -c "$expression" "$path"
    else
        printf 'missing'
    fi
}

image_dimensions() {
    local path="$1"
    if [[ ! -s "$path" ]]; then
        printf 'MISSING'
        return
    fi
    if command -v sips >/dev/null 2>&1; then
        local width height
        width="$(sips -g pixelWidth "$path" 2>/dev/null | awk '/pixelWidth:/ {print $2}')"
        height="$(sips -g pixelHeight "$path" 2>/dev/null | awk '/pixelHeight:/ {print $2}')"
        if [[ -n "$width" && -n "$height" ]]; then
            printf '%sx%s' "$width" "$height"
            return
        fi
    fi
    printf 'unknown'
}

MANIFEST_STATUS="missing"
if [[ -s "$MANIFEST" ]]; then
    MANIFEST_STATUS="$(awk -F= '$1 == "validation" {print $2}' "$MANIFEST" | tail -n 1)"
fi

BACKEND_APPROVED="$(json_bool "$BACKEND_READINESS" '.isApproved')"
BACKEND_COUNTS="$(json_summary "$BACKEND_READINESS" '{localVerifierCount: .evidence.localVerifierCount, approvedVerifierCount: .evidence.approvedVerifierCount}')"
ELECTRON_APPROVED="$(json_bool "$ELECTRON_TRACE" '.isApproved')"
PARITY_APPROVED="$(json_bool "$PARITY_TRACE" '.isApproved')"
PARITY_SUMMARY="$(json_summary "$PARITY_TRACE" '{regions: .parityRegions, oldWorkspaceReferences}')"
SNAPSHOT_APPROVED="$(json_bool "$SNAPSHOT_TRACE" '.isApproved')"
SNAPSHOT_SUMMARY="$(json_summary "$SNAPSHOT_TRACE" '{electron: {width: .electron.width, height: .electron.height}, swift: {width: .swift.width, height: .swift.height}, parityFailures}')"

count_missing_file "$CONCEPT_PATH"
count_missing_file "$MANIFEST"
count_missing_file "$BACKEND_READINESS"
count_missing_file "$ELECTRON_TRACE"
count_missing_file "$PARITY_TRACE"
count_missing_file "$SNAPSHOT_TRACE"
count_missing_file "$ELECTRON_SNAPSHOT"
count_missing_file "$SWIFT_SNAPSHOT"

mkdir -p "$(dirname "$OUTPUT_PATH")"
cat >"$OUTPUT_PATH" <<EOF
# FE-01 Frontend Snapshot Review

- Source concept: \`$CONCEPT_PATH\` (\`$(image_dimensions "$CONCEPT_PATH")\`)
- Combined validation output directory: \`$VALIDATION_DIR\`
- Validation manifest: \`$(file_display "$MANIFEST")\`
- Electron snapshot: \`$(file_display "$ELECTRON_SNAPSHOT")\` (\`$(image_dimensions "$ELECTRON_SNAPSHOT")\`)
- Swift snapshot: \`$(file_display "$SWIFT_SNAPSHOT")\` (\`$(image_dimensions "$SWIFT_SNAPSHOT")\`)
- Rust backend readiness trace: \`$(file_display "$BACKEND_READINESS")\`
- Electron frontend trace: \`$(file_display "$ELECTRON_TRACE")\`
- Frontend parity trace: \`$(file_display "$PARITY_TRACE")\`
- Frontend snapshot content trace: \`$(file_display "$SNAPSHOT_TRACE")\`

## Local Evidence

| Check | Expected | Observed | Pass |
| --- | --- | --- | --- |
| Combined validation manifest | \`validation=passed\` | \`$MANIFEST_STATUS\` |  |
| Rust \`backend-readiness\` | \`isApproved=true\`, \`localVerifierCount == approvedVerifierCount\` | \`$BACKEND_APPROVED\`, \`$BACKEND_COUNTS\` |  |
| Electron frontend verifier | \`isApproved=true\` | \`$ELECTRON_APPROVED\` |  |
| Electron/Swift parity verifier | \`isApproved=true\`, no old workspace references | \`$PARITY_APPROVED\`, \`$PARITY_SUMMARY\` |  |
| Snapshot content verifier | \`isApproved=true\`, active regions, no major Electron/Swift luminance drift | \`$SNAPSHOT_APPROVED\`, \`$SNAPSHOT_SUMMARY\` |  |
| Electron snapshot dimensions | \`1586x992\` | \`$(image_dimensions "$ELECTRON_SNAPSHOT")\` |  |
| Swift snapshot dimensions | \`1586x992\` | \`$(image_dimensions "$SWIFT_SNAPSHOT")\` |  |

## Concept Region Review

| Region | Required From \`CONCEPT.png\` | Electron Snapshot | Swift Snapshot | Pass |
| --- | --- | --- | --- | --- |
| Top app bar | Workspace mode, provider state, paper/live state, rollback, adapter health, alerts |  |  |  |
| Left rail | Watchlist, saved captures, account footer |  |  |  |
| Center chart | Dominant chart canvas, quote context, volume, order/fill/level markers |  |  |  |
| Right panel | Proposal/Ticket/Risk/Preview tabs, locked Live action, primary Review Paper |  |  |  |
| Bottom dock | Positions, Orders, Fills, Options Chain, Audit, Diagnostics tabs |  |  |  |
| Diagnostics | Visible collapsed affordance; raw proof hidden unless selected |  |  |  |

## Rejection Checks

| Failure Mode | Must Be False | Observed | Pass |
| --- | --- | --- | --- |
| Whole-window vertical scrolling required to see main regions | No |  |  |
| Chart is reduced to a small preview | No |  |  |
| Right panel pushed below chart or dock | No |  |  |
| Electron and Swift use different primary regions or tab model | No |  |  |
| Raw verifier payloads appear outside Diagnostics | No |  |  |
| Any button/card/table text clips or overlaps at 1586x992 | No |  |  |

## Decision

- Result: \`accepted\` / \`needs-rework\`
- Blocking notes:
- Follow-up ticket:
EOF

if [[ "$BACKEND_APPROVED" != "true" ]]; then
    missing_count=$((missing_count + 1))
fi
if [[ "$MANIFEST_STATUS" != "passed" ]]; then
    missing_count=$((missing_count + 1))
fi
if [[ "$ELECTRON_APPROVED" != "true" ]]; then
    missing_count=$((missing_count + 1))
fi
if [[ "$PARITY_APPROVED" != "true" ]]; then
    missing_count=$((missing_count + 1))
fi
if [[ "$SNAPSHOT_APPROVED" != "true" ]]; then
    missing_count=$((missing_count + 1))
fi

printf 'wrote FE-01 frontend snapshot review scaffold to %s\n' "$OUTPUT_PATH"

if [[ "$missing_count" -gt 0 && "$ALLOW_MISSING" != "1" ]]; then
    printf 'FE-01 frontend evidence is incomplete or not approved; rerun with --allow-missing only for draft templates.\n' >&2
    exit 1
fi
