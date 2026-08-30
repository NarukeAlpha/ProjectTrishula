#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

require_command railway
require_command jq
require_command awk

bash "$SCRIPT_DIR/preflight.sh"

PROJECT_ID="$(resolve_existing_project)"
SERVICES_JSON="$(service_list_json "$PROJECT_ID")"
CONVEX_SERVICE_ID="$(service_id_for_name "$SERVICES_JSON" "$CONVEX_SERVICE_NAME")"
[ -n "$CONVEX_SERVICE_ID" ] || die "Missing Railway service: $CONVEX_SERVICE_NAME. Run bootstrap.sh first."

CONVEX_PUBLIC_HOST="$(railway domain list \
  --project "$PROJECT_ID" \
  --environment "$TARGET_ENVIRONMENT" \
  --service "$CONVEX_SERVICE_ID" \
  --json |
  jq -er '
    [.. | objects | (.domain? // .hostname? // empty) | select(type == "string" and length > 0)] |
    unique |
    if length == 1 then .[0] else error("expected exactly one Convex public domain") end
  ')" || die "The Convex service must have exactly one public domain."

release_cleanup() {
  unset CONVEX_ADMIN_OUTPUT
  unset CONVEX_SELF_HOSTED_ADMIN_KEY
  unset CONVEX_SELF_HOSTED_URL
}
trap release_cleanup EXIT

info "Generating a temporary Convex admin key inside the private backend."
CONVEX_ADMIN_OUTPUT="$(railway ssh \
  --project "$PROJECT_ID" \
  --environment "$TARGET_ENVIRONMENT" \
  --service "$CONVEX_SERVICE_ID" \
  './generate_admin_key.sh')" || die "The Convex backend could not generate a temporary admin key."
CONVEX_SELF_HOSTED_ADMIN_KEY="$(printf '%s\n' "$CONVEX_ADMIN_OUTPUT" |
  awk '/^[A-Za-z0-9_-]+\|[A-Fa-f0-9]{64,}$/ { print; exit }')"
unset CONVEX_ADMIN_OUTPUT
[[ "$CONVEX_SELF_HOSTED_ADMIN_KEY" =~ ^[A-Za-z0-9_-]+\|[A-Fa-f0-9]{64,}$ ]] ||
  die "The Convex backend returned an invalid temporary admin key."

CONVEX_SELF_HOSTED_URL="https://$CONVEX_PUBLIC_HOST"
export CONVEX_SELF_HOSTED_ADMIN_KEY CONVEX_SELF_HOSTED_URL
RAILWAY_PROJECT_ID="$PROJECT_ID" bash "$SCRIPT_DIR/deploy.sh"

info "Release completed. The temporary Convex admin key was not persisted or printed."
