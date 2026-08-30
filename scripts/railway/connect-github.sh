#!/usr/bin/env bash

set -Eeuo pipefail
set +x

readonly PROJECT_ID="${RAILWAY_PROJECT_ID:-54092f1d-ed01-4ae7-9d33-3f19179957ea}"
readonly ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
readonly REPOSITORY="${RAILWAY_GITHUB_REPOSITORY:-NarukeAlpha/ProjectTrishula}"
readonly BRANCH="${RAILWAY_GITHUB_BRANCH:-master}"

for command_name in railway jq openssl; do
  command -v "$command_name" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$command_name" >&2
    exit 1
  }
done

services_json="$(railway service list --project "$PROJECT_ID" --environment "$ENVIRONMENT" --json)"

service_id() {
  local service_name="$1"
  printf '%s' "$services_json" | jq -er --arg name "$service_name" '
    [.. | objects | select((.name? // .serviceName? // "") == $name) | .id] |
    unique |
    if length == 1 then .[0] else error("missing or ambiguous service") end
  '
}

ensure_service() {
  local service_name="$1"
  local output_variable="$2"
  local id
  if id="$(service_id "$service_name" 2>/dev/null)"; then
    printf -v "$output_variable" '%s' "$id"
    return
  fi
  railway add --service "$service_name" --json >/dev/null
  services_json="$(railway service list --project "$PROJECT_ID" --environment "$ENVIRONMENT" --json)"
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
  railway variable set \
    --project "$PROJECT_ID" \
    --environment "$ENVIRONMENT" \
    --service "$id" \
    --skip-deploys \
    "$variable_name=$secret_value" >/dev/null
  unset secret_value
  printf 'Created the dedicated %s credential for %s.\n' "$variable_name" "$service_name"
}

configure_service() {
  local service_name="$1"
  local id="$2"
  local root_directory="$3"
  local watch_patterns="$4"
  local dockerfile_path="$5"
  local healthcheck_path="$6"
  local healthcheck_timeout="$7"
  local restart_retries="$8"
  local -a service_configuration=(
    --service-config "$id" source.rootDirectory "$root_directory"
    --service-config "$id" build.builder DOCKERFILE
    --service-config "$id" build.dockerfilePath "$dockerfile_path"
    --service-config "$id" build.watchPatterns "$watch_patterns"
    --service-config "$id" deploy.restartPolicyType ON_FAILURE
    --service-config "$id" deploy.restartPolicyMaxRetries "$restart_retries"
  )
  if [ -n "$healthcheck_path" ]; then
    service_configuration+=(
      --service-config "$id" deploy.healthcheckPath "$healthcheck_path"
      --service-config "$id" deploy.healthcheckTimeout "$healthcheck_timeout"
    )
  fi
  railway environment edit \
    --project "$PROJECT_ID" \
    --environment "$ENVIRONMENT" \
    "${service_configuration[@]}" \
    --message "Configure Project Trishula deployment for $service_name" \
    --json >/dev/null
}

connect_source() {
  local service_name="$1"
  local id="$2"
  railway service source connect \
    --project "$PROJECT_ID" \
    --environment "$ENVIRONMENT" \
    --service "$id" \
    --repo "$REPOSITORY" \
    --branch "$BRANCH" \
    --json >/dev/null
}

ensure_service web web_id
ensure_service pi pi_id
ensure_service discord discord_id
ensure_service convex-backend backend_id
ensure_service convex-dashboard dashboard_id
ensure_service convex-functions functions_id

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

connect_source web "$web_id"
connect_source pi "$pi_id"
connect_source discord "$discord_id"
connect_source convex-backend "$backend_id"
connect_source convex-dashboard "$dashboard_id"
connect_source convex-functions "$functions_id"

# Railway source connection can reset build detection to Railpack. Apply the
# explicit Dockerfile settings after source connection so the committed service
# configuration wins and starts a correctly configured deployment.
configure_service web "$web_id" /apps/web '["/apps/web/**"]' Dockerfile /healthz 30 3
configure_service pi "$pi_id" /apps/pi '["/apps/pi/**"]' Dockerfile /health 30 5
configure_service discord "$discord_id" /apps/discord '["/apps/discord/**"]' Dockerfile /health 120 10
configure_service convex-backend "$backend_id" /infra/railway/convex-backend '["/infra/railway/convex-backend/**"]' Dockerfile /version 300 10
configure_service convex-dashboard "$dashboard_id" /infra/railway/convex-dashboard '["/infra/railway/convex-dashboard/**"]' Dockerfile '' '' 5
configure_service convex-functions "$functions_id" / '["/apps/convex/**","/infra/railway/convex-functions/**"]' infra/railway/convex-functions/Dockerfile /health 300 3

printf 'Connected Project Trishula GitHub sources for web, Pi, Discord, Convex backend, dashboard, and functions.\n'
printf 'Add DISCORD_BOT_TOKEN to the Discord service in Railway to start the gateway.\n'

unset services_json web_id pi_id discord_id backend_id dashboard_id functions_id
