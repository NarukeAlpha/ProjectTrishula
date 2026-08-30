#!/usr/bin/env bash

set -Eeuo pipefail
set +x

readonly PROJECT_ID="${RAILWAY_PROJECT_ID:-54092f1d-ed01-4ae7-9d33-3f19179957ea}"
readonly ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"

for command_name in railway jq openssl; do
  command -v "$command_name" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$command_name" >&2
    exit 1
  }
done

set +e
railway config plan --detailed-exit-code
plan_status="$?"
set -e
if [ "$plan_status" -eq 2 ]; then
  printf 'Railway IaC has pending changes. Review and apply it before configuring service variables.\n' >&2
  exit 2
fi
if [ "$plan_status" -ne 0 ]; then
  printf 'Could not verify the Railway IaC plan.\n' >&2
  exit "$plan_status"
fi

services_json="$(railway service list --project "$PROJECT_ID" --environment "$ENVIRONMENT" --json)"

service_id() {
  local service_name="$1"
  printf '%s' "$services_json" | jq -er --arg name "$service_name" '
    [.. | objects | select((.name? // .serviceName? // "") == $name) | .id] |
    unique |
    if length == 1 then .[0] else error("missing or ambiguous service") end
  '
}

require_service() {
  local service_name="$1"
  local output_variable="$2"
  local id
  id="$(service_id "$service_name")"
  printf -v "$output_variable" '%s' "$id"
}

ensure_generated_secret() {
  local service_name="$1"
  local id="$2"
  local variable_name="$3"
  if railway variable list \
    --project "$PROJECT_ID" \
    --environment "$ENVIRONMENT" \
    --service "$id" \
    --json | jq -e --arg name "$variable_name" 'has($name)' >/dev/null; then
    return
  fi
  local secret_value
  secret_value="$(openssl rand -hex 32)"
  printf '%s' "$secret_value" | railway variable set \
    --project "$PROJECT_ID" \
    --environment "$ENVIRONMENT" \
    --service "$id" \
    --skip-deploys \
    --stdin \
    "$variable_name" >/dev/null
  unset secret_value
  printf 'Created the dedicated %s credential for %s.\n' "$variable_name" "$service_name"
}

require_service web web_id
require_service pi pi_id
require_service discord discord_id
require_service convex-backend backend_id
require_service convex-dashboard dashboard_id
require_service convex-functions functions_id

ensure_generated_secret convex-backend "$backend_id" DISCORD_GATEWAY_SHARED_SECRET
ensure_generated_secret pi "$pi_id" PI_DISCORD_SHARED_SECRET

railway variable set \
  --project "$PROJECT_ID" \
  --environment "$ENVIRONMENT" \
  --service "$functions_id" \
  --skip-deploys \
  'CONVEX_INSTANCE_NAME=${{convex-backend.INSTANCE_NAME}}' \
  'CONVEX_INSTANCE_SECRET=${{convex-backend.INSTANCE_SECRET}}' \
  'CONVEX_SELF_HOSTED_URL=http://${{convex-backend.RAILWAY_PRIVATE_DOMAIN}}:3210' \
  'DISCORD_GATEWAY_SHARED_SECRET=${{convex-backend.DISCORD_GATEWAY_SHARED_SECRET}}' \
  'SERVICE_SHARED_SECRET=${{convex-backend.SERVICE_SHARED_SECRET}}' \
  'WEB_APP_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}' \
  'WORKOS_ALLOWED_USER_IDS=${{convex-backend.WORKOS_ALLOWED_USER_IDS}}' \
  'WORKOS_CLIENT_ID=${{convex-backend.WORKOS_CLIENT_ID}}' >/dev/null

railway variable set \
  --project "$PROJECT_ID" \
  --environment "$ENVIRONMENT" \
  --service "$discord_id" \
  --skip-deploys \
  'NODE_ENV=production' \
  'HOST=0.0.0.0' \
  'PORT=8080' \
  'DISCORD_OWNER_ID=${{pi.BOUND_ACTOR_ID}}' \
  'CONVEX_DISCORD_SHARED_SECRET=${{convex-backend.DISCORD_GATEWAY_SHARED_SECRET}}' \
  'PI_DISCORD_SHARED_SECRET=${{pi.PI_DISCORD_SHARED_SECRET}}' \
  'CONVEX_SITE_URL=https://${{convex-backend.RAILWAY_PUBLIC_DOMAIN}}/http' \
  'PI_SERVICE_URL=http://${{pi.RAILWAY_PRIVATE_DOMAIN}}:8080' >/dev/null

railway variable set \
  --project "$PROJECT_ID" \
  --environment "$ENVIRONMENT" \
  --service "$pi_id" \
  --skip-deploys \
  'SERVICE_SHARED_SECRET=${{convex-backend.SERVICE_SHARED_SECRET}}' \
  'PI_AUTH_PATH=/data/auth.json' \
  'BROKER_MODE=mock' \
  'LIVE_TRADING_ENABLED=false' \
  'PI_LUNA_MODEL=gpt-5.6-luna' \
  'PI_SOL_MODEL=gpt-5.6-sol' >/dev/null

railway variable set \
  --project "$PROJECT_ID" \
  --environment "$ENVIRONMENT" \
  --service "$web_id" \
  --skip-deploys \
  'PUBLIC_APPLICATION_NAME=Project Trishula' >/dev/null

for id in "$backend_id" "$functions_id" "$discord_id" "$pi_id" "$web_id"; do
  railway redeploy \
    --project "$PROJECT_ID" \
    --environment "$ENVIRONMENT" \
    --service "$id" \
    --from-source \
    --yes \
    --json >/dev/null
done

printf 'Configured Project Trishula service variables and started fresh source deployments.\n'
printf 'Add DISCORD_BOT_TOKEN to the Discord service in Railway to start the gateway.\n'

unset services_json web_id pi_id discord_id backend_id dashboard_id functions_id
