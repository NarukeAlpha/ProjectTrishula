#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONCEPT_PATH="${FE01_CONCEPT_PATH:-$ROOT_DIR/CONCEPT.png}"
VALIDATION_DIR="${VALIDATION_OUTPUT_DIR:-/tmp/agentic-trading-validation}"
OUTPUT_PATH="${FE01_REVIEW_OUTPUT:-/tmp/agentic-trading-fe01-snapshot-review.md}"
ELECTRON_SNAPSHOT="${FE01_ELECTRON_SNAPSHOT:-$VALIDATION_DIR/ibkr-live-electron/electron-live-1586x992.png}"
BACKEND_READINESS="$VALIDATION_DIR/backend-readiness.json"
ELECTRON_TRACE="${FE01_ELECTRON_TRACE:-$VALIDATION_DIR/electron-frontend.json}"
SURFACE_TRACE="${FE01_ELECTRON_SURFACE_TRACE:-$VALIDATION_DIR/electron-surface.json}"
SNAPSHOT_TRACE="${FE01_FRONTEND_SNAPSHOT_TRACE:-$VALIDATION_DIR/ibkr-live-electron/live-snapshot-content.json}"
INTERACTION_TRACE="${FE01_ELECTRON_INTERACTION_TRACE:-$VALIDATION_DIR/ibkr-live-electron/electron-interactions.json}"
MANIFEST="$VALIDATION_DIR/manifest.txt"
LIVE_MANIFEST="$VALIDATION_DIR/ibkr-live-electron/manifest.txt"
ALLOW_MISSING=0

usage() {
    cat <<'USAGE'
Usage: scripts/prepare-fe01-snapshot-review.sh [--allow-missing]

Environment:
  VALIDATION_OUTPUT_DIR          Directory from scripts/validate-local.sh.
  FE01_REVIEW_OUTPUT             Markdown file to write.
  FE01_ELECTRON_SNAPSHOT         Electron 1586x992 screenshot.
  FE01_ELECTRON_TRACE            Electron frontend verifier JSON.
  FE01_ELECTRON_SURFACE_TRACE    Electron surface verifier JSON.
  FE01_FRONTEND_SNAPSHOT_TRACE   PNG content verifier JSON.
  FE01_ELECTRON_INTERACTION_TRACE Electron interaction verifier JSON.

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

manifest_value() {
    local path="$1"
    local key="$2"
    if [[ -s "$path" ]]; then
        awk -F= -v target="$key" '$1 == target {print $2}' "$path" | tail -n 1
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

MANIFEST_STATUS="$(manifest_value "$MANIFEST" validation)"
LIVE_STATUS="$(manifest_value "$LIVE_MANIFEST" validation)"
BACKEND_APPROVED="$(json_bool "$BACKEND_READINESS" '.isApproved')"
BACKEND_COUNTS="$(json_summary "$BACKEND_READINESS" '{localVerifierCount: .evidence.localVerifierCount, approvedVerifierCount: .evidence.approvedVerifierCount}')"
ELECTRON_APPROVED="$(json_bool "$ELECTRON_TRACE" '.isApproved')"
SURFACE_APPROVED="$(json_bool "$SURFACE_TRACE" '.isApproved')"
SURFACE_SUMMARY="$(json_summary "$SURFACE_TRACE" '{regions: .surfaceRegions, oldWorkspaceReferences, forbiddenMatches}')"
SNAPSHOT_APPROVED="$(json_bool "$SNAPSHOT_TRACE" '.isApproved')"
SNAPSHOT_SUMMARY="$(json_summary "$SNAPSHOT_TRACE" '{electron: {width: .electron.width, height: .electron.height}, failures: .electron.failures}')"
INTERACTION_APPROVED="$(json_bool "$INTERACTION_TRACE" '.isApproved')"
INTERACTION_SUMMARY="$(json_summary "$INTERACTION_TRACE" '{visibleSymbol, activeDock, activeRightTab, failedChecks: [.checks[] | select(.passed == false) | .name]}')"

count_missing_file "$CONCEPT_PATH"
count_missing_file "$MANIFEST"
count_missing_file "$LIVE_MANIFEST"
count_missing_file "$BACKEND_READINESS"
count_missing_file "$ELECTRON_TRACE"
count_missing_file "$SURFACE_TRACE"
count_missing_file "$SNAPSHOT_TRACE"
count_missing_file "$INTERACTION_TRACE"
count_missing_file "$ELECTRON_SNAPSHOT"

mkdir -p "$(dirname "$OUTPUT_PATH")"
cat >"$OUTPUT_PATH" <<EOF
# FE-01 Electron IBKR Workstation Review

- Source concept: \`$CONCEPT_PATH\` (\`$(image_dimensions "$CONCEPT_PATH")\`)
- Combined validation output directory: \`$VALIDATION_DIR\`
- Validation manifest: \`$(file_display "$MANIFEST")\`
- IBKR Electron manifest: \`$(file_display "$LIVE_MANIFEST")\`
- Electron snapshot: \`$(file_display "$ELECTRON_SNAPSHOT")\` (\`$(image_dimensions "$ELECTRON_SNAPSHOT")\`)
- Rust backend readiness trace: \`$(file_display "$BACKEND_READINESS")\`
- Electron frontend trace: \`$(file_display "$ELECTRON_TRACE")\`
- Electron surface trace: \`$(file_display "$SURFACE_TRACE")\`
- Frontend snapshot content trace: \`$(file_display "$SNAPSHOT_TRACE")\`
- Electron interaction trace: \`$(file_display "$INTERACTION_TRACE")\`

## Local Evidence

| Check | Expected | Observed | Pass |
| --- | --- | --- | --- |
| Combined validation manifest | \`validation=passed\` | \`$MANIFEST_STATUS\` |  |
| IBKR Electron manifest | \`validation=passed\` | \`$LIVE_STATUS\` |  |
| Rust \`backend-readiness\` | \`isApproved=true\`, \`localVerifierCount == approvedVerifierCount\` | \`$BACKEND_APPROVED\`, \`$BACKEND_COUNTS\` |  |
| Electron frontend verifier | \`isApproved=true\` | \`$ELECTRON_APPROVED\` |  |
| Electron surface verifier | \`isApproved=true\`, no Swift/runtime fixture references | \`$SURFACE_APPROVED\`, \`$SURFACE_SUMMARY\` |  |
| Electron interaction verifier | \`isApproved=true\`, symbol search, tabs, dock, range, timeframe, review all work | \`$INTERACTION_APPROVED\`, \`$INTERACTION_SUMMARY\` |  |
| Snapshot content verifier | \`isApproved=true\`, active regions | \`$SNAPSHOT_APPROVED\`, \`$SNAPSHOT_SUMMARY\` |  |
| Electron snapshot dimensions | \`1586x992\` | \`$(image_dimensions "$ELECTRON_SNAPSHOT")\` |  |

## Concept Region Review

| Region | Required From \`CONCEPT.png\` | Electron Snapshot | Pass |
| --- | --- | --- | --- |
| Top app bar | Workspace mode, backend status, source state, saved-state status, alerts |  |  |
| Left rail | Local watchlist, activity, account footer |  |  |
| Center chart | Dominant chart canvas, quote context, live volume, levels, markers |  |  |
| Right panel | Proposal/Ticket/Risk/Preview tabs, locked Live action, primary Review Paper |  |  |
| Bottom dock | Positions, Orders, Fills, Options Chain, Audit, Diagnostics tabs |  |  |
| Diagnostics | Adapter URL, settings DB, selected symbol, IBKR source, errors |  |  |

## Rejection Checks

| Failure Mode | Must Be False | Observed | Pass |
| --- | --- | --- | --- |
| Runtime reads \`frontend/shared/workbench-data.json\` | No |  |  |
| App preselects a symbol without SQLite user state | No |  |  |
| Swift frontend or parity artifact is required | No |  |  |
| Chart is reduced to a small preview | No |  |  |
| Right panel pushed below chart or dock at 1586x992 | No |  |  |
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
if [[ "$LIVE_STATUS" != "passed" ]]; then
    missing_count=$((missing_count + 1))
fi
if [[ "$ELECTRON_APPROVED" != "true" ]]; then
    missing_count=$((missing_count + 1))
fi
if [[ "$SURFACE_APPROVED" != "true" ]]; then
    missing_count=$((missing_count + 1))
fi
if [[ "$INTERACTION_APPROVED" != "true" ]]; then
    missing_count=$((missing_count + 1))
fi
if [[ "$SNAPSHOT_APPROVED" != "true" ]]; then
    missing_count=$((missing_count + 1))
fi

printf 'wrote FE-01 Electron live workstation review scaffold to %s\n' "$OUTPUT_PATH"

if [[ "$missing_count" -gt 0 && "$ALLOW_MISSING" != "1" ]]; then
    printf 'FE-01 Electron evidence is incomplete or not approved; rerun with --allow-missing only for draft templates.\n' >&2
    exit 1
fi
