#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

usage() {
  cat >&2 <<'EOF'
Usage:
  printf '%s\n' "$WORKOS_USER_ID" | \
    bash scripts/railway/provision-user-runtime.sh --actor-stdin [--service SERVICE] [--no-deploy]

Options:
  --actor-stdin       Read the approved WorkOS user ID from standard input.
  --service SERVICE   Rebind an existing Pi service, such as the original `pi` service.
  --no-deploy         Configure the runtime without submitting a deployment.
  --help              Show this help text.

The user ID and credential values are never printed. Do not pass a user ID as a
command-line argument because shell history and process listings can retain it.
EOF
}

require_command railway
require_command jq
require_command openssl
require_command shasum
require_command tr

ACTOR_FROM_STDIN=0
EXISTING_SERVICE_SELECTOR=""
DEPLOY_RUNTIME=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --actor-stdin)
      ACTOR_FROM_STDIN=1
      shift
      ;;
    --service)
      [ "$#" -ge 2 ] || die "--service requires a service name or ID."
      EXISTING_SERVICE_SELECTOR="$2"
      shift 2
      ;;
    --no-deploy)
      DEPLOY_RUNTIME=0
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      usage
      die "Unknown option: $1"
      ;;
  esac
done

[ "$ACTOR_FROM_STDIN" = "1" ] || {
  usage
  die "--actor-stdin is required."
}
IFS= read -r ACTOR_ID || die "No WorkOS user ID was received on standard input."
validate_actor_id "$ACTOR_ID"

bash "$SCRIPT_DIR/preflight.sh"

PROJECT_ID="$(resolve_existing_project)"
assert_safe_project "$PROJECT_ID" "$(project_name_for_id "$PROJECT_ID")"
RUNTIME_SERVICE_NAME="$(runtime_service_name "$ACTOR_ID")"
RUNTIME_VOLUME_NAME="$(runtime_volume_name "$ACTOR_ID")"

# Resource creation commands use the linked project. Every read, variable,
# deployment, domain, and network command still receives explicit selectors.
railway link \
  --project "$PROJECT_ID" \
  --environment "$TARGET_ENVIRONMENT" \
  --json >/dev/null

SERVICES_JSON="$(service_list_json "$PROJECT_ID")"
CONVEX_SERVICE_ID="$(service_id_for_name "$SERVICES_JSON" "$CONVEX_SERVICE_NAME")"
WEB_SERVICE_ID="$(service_id_for_name "$SERVICES_JSON" "$WEB_SERVICE_NAME")"
[ -n "$CONVEX_SERVICE_ID" ] || die "Missing Railway service: $CONVEX_SERVICE_NAME. Run bootstrap.sh first."
[ -n "$WEB_SERVICE_ID" ] || die "Missing Railway service: $WEB_SERVICE_NAME. Run bootstrap.sh first."
if [ -n "$EXISTING_SERVICE_SELECTOR" ]; then
  SERVICE_ROW="$(printf '%s' "$SERVICES_JSON" |
    jq -r --arg selector "$EXISTING_SERVICE_SELECTOR" '
      [
        .. | objects |
        select(
          (.id? // "") != "" and
          ((.id? // "") == $selector or (.name? // .serviceName? // "") == $selector)
        ) |
        [.id, (.name? // .serviceName? // "")]
      ] |
      unique_by(.[0]) |
      if length == 1 then .[0] | @tsv else empty end
    ')"
  [ -n "$SERVICE_ROW" ] || die "The selected existing Pi service was not found or was ambiguous."
  IFS=$'\t' read -r RUNTIME_SERVICE_ID SELECTED_SERVICE_NAME <<<"$SERVICE_ROW"
  if [ "$SELECTED_SERVICE_NAME" != "$PI_SERVICE_NAME" ] &&
    [ "$SELECTED_SERVICE_NAME" != "$RUNTIME_SERVICE_NAME" ]; then
    die "An existing runtime must be the legacy Pi service or this user's derived service."
  fi
else
  RUNTIME_SERVICE_ID="$(ensure_service "$PROJECT_ID" "$RUNTIME_SERVICE_NAME")"
  SELECTED_SERVICE_NAME="$RUNTIME_SERVICE_NAME"
fi

[ -n "$RUNTIME_SERVICE_ID" ] || die "Railway did not resolve the per-user Pi service."
if domain_exists "$PROJECT_ID" "$RUNTIME_SERVICE_ID"; then
  die "The selected Pi runtime has a public domain. Remove it before provisioning this private service."
fi

ensure_service_volume \
  "$PROJECT_ID" \
  "$RUNTIME_SERVICE_ID" \
  "$SELECTED_SERVICE_NAME" \
  "$RUNTIME_VOLUME_NAME" \
  "$PI_VOLUME_MOUNT_PATH" >/dev/null

info "Binding the private Pi endpoint to the approved WorkOS user hash."
railway private-network update "$RUNTIME_SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --environment "$TARGET_ENVIRONMENT" \
  --service "$RUNTIME_SERVICE_ID" \
  --json >/dev/null

set_service_variable() {
  local service_id="$1"
  local variable_name="$2"
  local variable_value="$3"
  printf '%s' "$variable_value" |
    railway variable set "$variable_name" \
      --stdin \
      --skip-deploys \
      --project "$PROJECT_ID" \
      --environment "$TARGET_ENVIRONMENT" \
      --service "$service_id" \
      --json >/dev/null
}

set_runtime_variable() {
  set_service_variable "$RUNTIME_SERVICE_ID" "$1" "$2"
}

set_runtime_variable SERVICE_SHARED_SECRET '${{convex-backend.SERVICE_SHARED_SECRET}}'

credential_key_state="$({
  service_variables_json "$PROJECT_ID" "$RUNTIME_SERVICE_ID" 2>/dev/null |
    jq -er --arg variable_name "PI_CREDENTIAL_ENCRYPTION_KEY" '
      if type == "object" and has($variable_name) then
        if (.[$variable_name] | type != "string" or length < 32) then
          "invalid"
        elif has("SERVICE_SHARED_SECRET") and .[$variable_name] == .SERVICE_SHARED_SECRET then
          "reused"
        else
          "present"
        end
      elif any(
        .. | objects;
        ((.name? // .key? // "") == $variable_name) and
        ((.value? // "") | type == "string" and length >= 32)
      ) then
        "present"
      elif any(.. | objects; ((.name? // .key? // "") == $variable_name)) then
        "invalid"
      else
        "missing"
      end
    '
} )" || die "Railway runtime variables could not be checked safely."

case "$credential_key_state" in
  present)
    info "Keeping the existing independent Pi credential-encryption key."
    ;;
  missing)
    info "Creating an independent Pi credential-encryption key."
    openssl rand -base64 48 |
      tr -d '\n' |
      railway variable set PI_CREDENTIAL_ENCRYPTION_KEY \
        --stdin \
        --skip-deploys \
        --project "$PROJECT_ID" \
        --environment "$TARGET_ENVIRONMENT" \
        --service "$RUNTIME_SERVICE_ID" \
        --json >/dev/null
    ;;
  invalid)
    die "The existing PI_CREDENTIAL_ENCRYPTION_KEY is too short. Rotate it through an explicit recovery procedure."
    ;;
  reused)
    die "PI_CREDENTIAL_ENCRYPTION_KEY must be independent from SERVICE_SHARED_SECRET. Rotate it through an explicit recovery procedure."
    ;;
  *)
    die "Railway returned an unknown credential-key state."
    ;;
esac

set_runtime_variable NODE_ENV production
set_runtime_variable HOST 0.0.0.0
set_runtime_variable PORT 8080
set_runtime_variable BOUND_ACTOR_ID "$ACTOR_ID"
set_runtime_variable CONVEX_SITE_URL 'https://${{convex-backend.RAILWAY_PUBLIC_DOMAIN}}/http'
set_runtime_variable PI_AUTH_PATH /data/auth.json
set_runtime_variable PI_CREDENTIAL_KEY_VERSION 1
set_runtime_variable PI_MODEL gpt-5.6-terra
set_runtime_variable CODEX_AUTH_MODE device_code
set_runtime_variable PI_AUTH_BOOTSTRAP false
set_runtime_variable BROKER_MODE robinhood
set_runtime_variable ROBINHOOD_OAUTH_REDIRECT_URI 'https://${{convex-backend.RAILWAY_PUBLIC_DOMAIN}}/http/broker/robinhood/callback'
set_runtime_variable LIVE_TRADING_ENABLED false

set_service_variable "$CONVEX_SERVICE_ID" EXECUTION_PRIVATE_DOMAIN_SUFFIX railway.internal:8080
set_service_variable "$CONVEX_SERVICE_ID" WEB_APP_ORIGIN 'https://${{web.RAILWAY_PUBLIC_DOMAIN}}'

if [ "$DEPLOY_RUNTIME" = "1" ]; then
  deploy_railway_service "$PROJECT_ID" "$SELECTED_SERVICE_NAME" "$RUNTIME_SERVICE_ID" "apps/pi"
else
  info "Runtime deployment was skipped by request."
fi

if railway ssh \
  --project "$PROJECT_ID" \
  --environment "$TARGET_ENVIRONMENT" \
  --service "$RUNTIME_SERVICE_ID" \
  'test -s /data/auth.json' >/dev/null 2>&1; then
  info "The isolated Codex OAuth file is present on this runtime's volume."
else
  info "Codex OAuth is not ready. Open Railway SSH for this runtime and run:"
  info "runuser -u node -- env CODEX_AUTH_MODE=device_code npm --prefix /app run auth:codex"
fi

info "Per-user Pi runtime is provisioned with private endpoint: $RUNTIME_SERVICE_NAME.railway.internal"
info "Robinhood mode is enabled, but live order placement remains disabled."
info "No actor ID, model credential, service secret, encryption key, or Robinhood credential was printed."

unset ACTOR_ID
