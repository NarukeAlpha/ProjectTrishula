#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

require_command railway
require_command jq

bash "$SCRIPT_DIR/preflight.sh"

find_or_create_project() {
  local project_id="${RAILWAY_PROJECT_ID:-}"
  local existing_ids
  local count
  local init_json
  if [ -n "$project_id" ]; then
    assert_safe_project "$project_id" "$(project_name_for_id "$project_id")"
    printf '%s\n' "$project_id"
    return 0
  fi

  existing_ids="$(project_list_json | jq -r --arg project_name "$TARGET_PROJECT_NAME" '
    .. | objects |
    select((.name? // "") == $project_name and (.id? // "") != "") |
    .id
  ')"
  count="$(printf '%s\n' "$existing_ids" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')"
  case "$count" in
    0)
      info "Creating separate Railway project: $TARGET_PROJECT_NAME"
      init_json="$(railway init \
        --name "$TARGET_PROJECT_NAME" \
        --workspace "$TARGET_WORKSPACE" \
        --json)"
      project_id="$(printf '%s' "$init_json" | jq -r '.. | objects | select((.id? // "") != "") | .id' | head -n 1)"
      [ -n "$project_id" ] || die "Railway did not report the new project ID."
      ;;
    1)
      project_id="$(printf '%s\n' "$existing_ids" | sed -n '1p')"
      info "Using existing separate Railway project: $TARGET_PROJECT_NAME"
      ;;
    *)
      die "More than one Railway project matches: $TARGET_PROJECT_NAME"
      ;;
  esac
  assert_safe_project "$project_id" "$TARGET_PROJECT_NAME"
  printf '%s\n' "$project_id"
}

PROJECT_ID="$(find_or_create_project)"
assert_safe_project "$PROJECT_ID" "$(project_name_for_id "$PROJECT_ID")"

# Bucket commands use the linked project. This link changes only local Railway
# association state; all resource commands below also pass explicit selectors.
railway link \
  --project "$PROJECT_ID" \
  --environment "$TARGET_ENVIRONMENT" \
  --json >/dev/null

WEB_SERVICE_ID="$(ensure_service "$PROJECT_ID" "$WEB_SERVICE_NAME")"
CONVEX_SERVICE_ID="$(ensure_service "$PROJECT_ID" "$CONVEX_SERVICE_NAME")"
DASHBOARD_SERVICE_ID="$(ensure_service "$PROJECT_ID" "$DASHBOARD_SERVICE_NAME")"
POSTGRES_SERVICE_ID="$(ensure_postgres "$PROJECT_ID")"

ensure_bucket

ensure_domain "$PROJECT_ID" "$WEB_SERVICE_ID"
ensure_domain "$PROJECT_ID" "$CONVEX_SERVICE_ID" "3210"

info "Bootstrap completed for the separate Signal project."
info "Project ID: $PROJECT_ID"
info "Service IDs were resolved for web, convex-backend, dashboard, and Postgres."
info "The artifact bucket was resolved."
info "Provision each approved user's private Pi service with provision-user-runtime.sh."
info "No service variables were set. Configure required names from infra/railway/README.md."
info "Per-user Pi services and the Convex dashboard intentionally have no public-domain creation step."

# Keep these variables referenced so a shellcheck run does not treat the
# resolved resource IDs as accidental dead code. Values are identifiers, not
# credentials, and are never fetched from variable output.
: "$POSTGRES_SERVICE_ID"
