#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

command -v jq >/dev/null 2>&1 || {
  printf 'Missing required command: jq\n' >&2
  exit 1
}

for script in "$SCRIPT_DIR"/*.sh; do
  bash -n "$script"
done

for config in \
  "$REPO_ROOT/apps/web/railway.json" \
  "$REPO_ROOT/apps/pi/railway.json" \
  "$REPO_ROOT/apps/discord/railway.json" \
  "$REPO_ROOT/infra/railway/convex-backend/railway.json" \
  "$REPO_ROOT/infra/railway/convex-dashboard/railway.json" \
  "$REPO_ROOT/infra/railway/convex-functions/railway.json"; do
  jq -e . "$config" >/dev/null || {
    printf 'Invalid JSON configuration: %s\n' "$config" >&2
    exit 1
  }
done

for file in \
  apps/web/Dockerfile \
  apps/pi/Dockerfile \
  apps/discord/Dockerfile \
  apps/convex/convex.json \
  infra/railway/convex-backend/Dockerfile \
  infra/railway/convex-dashboard/Dockerfile \
  infra/railway/convex-functions/Dockerfile \
  infra/railway/convex-functions/deploy-functions.sh \
  scripts/railway/connect-github.sh; do
  [ -f "$REPO_ROOT/$file" ] || {
    printf 'Missing required repository file: %s\n' "$file" >&2
    exit 1
  }
done

grep -Fq 'service source connect' "$SCRIPT_DIR/connect-github.sh" || {
  printf 'connect-github.sh does not connect GitHub service sources.\n' >&2
  exit 1
}
grep -Fq 'source.rootDirectory' "$SCRIPT_DIR/connect-github.sh" || {
  printf 'connect-github.sh does not configure monorepo roots.\n' >&2
  exit 1
}
grep -Fq 'convex-generate-key' "$REPO_ROOT/infra/railway/convex-functions/deploy-functions.sh" || {
  printf 'Convex function deploys do not derive a short-lived admin key.\n' >&2
  exit 1
}

grep -Fq 'CONVEX_DISCORD_SHARED_SECRET=${{convex-backend.DISCORD_GATEWAY_SHARED_SECRET}}' "$SCRIPT_DIR/connect-github.sh" || {
  printf 'Discord must use a dedicated Convex credential variable.\n' >&2
  exit 1
}
grep -Fq 'PI_DISCORD_SHARED_SECRET=${{pi.PI_DISCORD_SHARED_SECRET}}' "$SCRIPT_DIR/connect-github.sh" || {
  printf 'Discord must use Pi agent-only credentials.\n' >&2
  exit 1
}
grep -Fq 'ensure_generated_secret convex-backend "$backend_id" DISCORD_GATEWAY_SHARED_SECRET' "$SCRIPT_DIR/connect-github.sh" \
  && grep -Fq 'ensure_generated_secret pi "$pi_id" PI_DISCORD_SHARED_SECRET' "$SCRIPT_DIR/connect-github.sh" || {
  printf 'Railway must generate separate Convex and Pi credentials for Discord.\n' >&2
  exit 1
}
grep -Fq 'DISCORD_GATEWAY_SHARED_SECRET=${{convex-backend.DISCORD_GATEWAY_SHARED_SECRET}}' "$SCRIPT_DIR/connect-github.sh" || {
  printf 'The Convex deployer must receive the Discord-only credential.\n' >&2
  exit 1
}

first_source_connection="$({ grep -n '^connect_source ' "$SCRIPT_DIR/connect-github.sh" || true; } | head -n 1 | cut -d: -f1)"
last_source_connection="$({ grep -n '^connect_source ' "$SCRIPT_DIR/connect-github.sh" || true; } | tail -n 1 | cut -d: -f1)"
last_service_creation="$({ grep -n '^ensure_service ' "$SCRIPT_DIR/connect-github.sh" || true; } | tail -n 1 | cut -d: -f1)"
last_variable_configuration="$({ grep -n '^railway variable set ' "$SCRIPT_DIR/connect-github.sh" || true; } | tail -n 1 | cut -d: -f1)"
first_service_configuration="$({ grep -n '^configure_service ' "$SCRIPT_DIR/connect-github.sh" || true; } | head -n 1 | cut -d: -f1)"
last_service_configuration="$({ grep -n '^configure_service ' "$SCRIPT_DIR/connect-github.sh" || true; } | tail -n 1 | cut -d: -f1)"
if [ -z "$first_source_connection" ] \
  || [ -z "$last_source_connection" ] \
  || [ -z "$last_service_creation" ] \
  || [ -z "$last_variable_configuration" ] \
  || [ -z "$first_service_configuration" ] \
  || [ -z "$last_service_configuration" ] \
  || [ "$last_service_creation" -ge "$last_variable_configuration" ] \
  || [ "$first_source_connection" -le "$last_variable_configuration" ] \
  || [ "$first_service_configuration" -le "$last_source_connection" ]; then
  printf 'GitHub sources must connect after variables and before final service settings.\n' >&2
  exit 1
fi

[ "$(grep -c '^connect_source ' "$SCRIPT_DIR/connect-github.sh")" -eq 6 ] || {
  printf 'Every Project Trishula code service must connect its GitHub source once.\n' >&2
  exit 1
}

[ "$(grep -c '^configure_service ' "$SCRIPT_DIR/connect-github.sh")" -eq 6 ] || {
  printf 'Every Project Trishula code service must configure its Railway deployment once.\n' >&2
  exit 1
}

for service_config_path in \
  build.builder \
  build.dockerfilePath \
  build.watchPatterns \
  deploy.restartPolicyType \
  deploy.restartPolicyMaxRetries; do
  grep -Fq -- "--service-config \"\$id\" $service_config_path" "$SCRIPT_DIR/connect-github.sh" || {
    printf 'Direct Railway service configuration is missing: %s\n' "$service_config_path" >&2
    exit 1
  }
done

grep -Fq -- '--service-config "$id" deploy.healthcheckPath' "$SCRIPT_DIR/connect-github.sh" \
  && grep -Fq -- '--service-config "$id" deploy.healthcheckTimeout' "$SCRIPT_DIR/connect-github.sh" || {
  printf 'Direct Railway healthcheck configuration is incomplete.\n' >&2
  exit 1
}

expected_service_configurations=(
  "configure_service web \"\$web_id\" /apps/web '[\"/apps/web/**\"]' Dockerfile /healthz 30 3"
  "configure_service pi \"\$pi_id\" /apps/pi '[\"/apps/pi/**\"]' Dockerfile /health 30 5"
  "configure_service discord \"\$discord_id\" /apps/discord '[\"/apps/discord/**\"]' Dockerfile /health 120 10"
  "configure_service convex-backend \"\$backend_id\" /infra/railway/convex-backend '[\"/infra/railway/convex-backend/**\"]' Dockerfile /version 300 10"
  "configure_service convex-dashboard \"\$dashboard_id\" /infra/railway/convex-dashboard '[\"/infra/railway/convex-dashboard/**\"]' Dockerfile '' '' 5"
  "configure_service convex-functions \"\$functions_id\" / '[\"/apps/convex/**\",\"/infra/railway/convex-functions/**\"]' infra/railway/convex-functions/Dockerfile /health 300 3"
)
for expected_configuration in "${expected_service_configurations[@]}"; do
  grep -Fqx -- "$expected_configuration" "$SCRIPT_DIR/connect-github.sh" || {
    printf 'Railway service configuration does not match the checked-in deployment contract.\n' >&2
    exit 1
  }
done

grep -Fq 'npm ci --include=dev' "$REPO_ROOT/infra/railway/convex-functions/Dockerfile" || {
  printf 'The Convex function deployer must install TypeScript for deploy-time typechecking.\n' >&2
  exit 1
}

printf 'Railway GitHub source, service JSON, Dockerfile, and Convex deployer checks passed.\n'
