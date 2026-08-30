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

for file in \
  .railway/railway.ts \
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

grep -Fq 'railway config plan --detailed-exit-code' "$SCRIPT_DIR/connect-github.sh" || {
  printf 'connect-github.sh must verify that Railway IaC is applied before changing variables.\n' >&2
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

last_service_lookup="$({ grep -n '^require_service ' "$SCRIPT_DIR/connect-github.sh" || true; } | tail -n 1 | cut -d: -f1)"
last_variable_configuration="$({ grep -n '^railway variable set ' "$SCRIPT_DIR/connect-github.sh" || true; } | tail -n 1 | cut -d: -f1)"
if [ -z "$last_service_lookup" ] \
  || [ -z "$last_variable_configuration" ] \
  || [ "$last_service_lookup" -ge "$last_variable_configuration" ]; then
  printf 'Railway services must be resolved before variables are configured.\n' >&2
  exit 1
fi

[ "$(grep -c '^require_service ' "$SCRIPT_DIR/connect-github.sh")" -eq 6 ] || {
  printf 'Every Project Trishula code service must be resolved once.\n' >&2
  exit 1
}

grep -Fq 'printf '\''%s'\'' "$secret_value" | railway variable set' "$SCRIPT_DIR/connect-github.sh" || {
  printf 'Generated Railway secrets must be passed through standard input.\n' >&2
  exit 1
}
grep -Fq -- '--stdin' "$SCRIPT_DIR/connect-github.sh" || {
  printf 'Generated Railway secrets must not appear in process arguments.\n' >&2
  exit 1
}
grep -Fq 'railway redeploy' "$SCRIPT_DIR/connect-github.sh" \
  && grep -Fq -- '--from-source' "$SCRIPT_DIR/connect-github.sh" || {
  printf 'The variable bootstrap must deploy the configured services from their GitHub source.\n' >&2
  exit 1
}

iac="$REPO_ROOT/.railway/railway.ts"

[ "$(grep -c 'builder: "DOCKERFILE"' "$iac")" -eq 6 ] || {
  printf 'Every code service must use the Dockerfile builder in Railway IaC.\n' >&2
  exit 1
}

for expected_root in \
  '/apps/web' \
  '/apps/pi' \
  '/apps/discord' \
  '/infra/railway/convex-backend' \
  '/infra/railway/convex-dashboard' \
  '/'; do
  grep -Fq "projectTrishula(\"$expected_root\")" "$iac" || {
    printf 'Missing Railway IaC root directory: %s\n' "$expected_root" >&2
    exit 1
  }
done

for expected_watch_path in \
  '/apps/web/**' \
  '/apps/pi/**' \
  '/apps/discord/**' \
  '/apps/convex/**' \
  '/infra/railway/convex-backend/**' \
  '/infra/railway/convex-dashboard/**' \
  '/infra/railway/convex-functions/**'; do
  grep -Fq "\"$expected_watch_path\"" "$iac" || {
    printf 'Missing Railway IaC watch path: %s\n' "$expected_watch_path" >&2
    exit 1
  }
done

for legacy_config in \
  apps/web/railway.json \
  apps/pi/railway.json \
  apps/discord/railway.json \
  infra/railway/convex-backend/railway.json \
  infra/railway/convex-dashboard/railway.json \
  infra/railway/convex-functions/railway.json; do
  [ ! -e "$REPO_ROOT/$legacy_config" ] || {
    printf 'Legacy Railway config conflicts with .railway/railway.ts: %s\n' "$legacy_config" >&2
    exit 1
  }
done

grep -Fq 'DISCORD_BOT_TOKEN: preserve()' "$iac" || {
  printf 'Railway IaC must preserve a dashboard-managed Discord token.\n' >&2
  exit 1
}

grep -Fq 'PUBLIC_DISCORD_APPLICATION_ID: preserve()' "$iac" || {
  printf 'Railway IaC must preserve the public Discord application identifier.\n' >&2
  exit 1
}

grep -Fq 'npm ci --include=dev' "$REPO_ROOT/infra/railway/convex-functions/Dockerfile" || {
  printf 'The Convex function deployer must install TypeScript for deploy-time typechecking.\n' >&2
  exit 1
}

grep -Fq 'node:24.18.0-trixie-slim' "$REPO_ROOT/infra/railway/convex-functions/Dockerfile" || {
  printf 'The Convex key generator requires the Trixie glibc runtime.\n' >&2
  exit 1
}

printf 'Railway GitHub source, IaC, Dockerfile, and Convex deployer checks passed.\n'
