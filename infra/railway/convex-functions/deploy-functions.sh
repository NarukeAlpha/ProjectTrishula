#!/usr/bin/env bash

set -Eeuo pipefail
set +x

required_variables=(
  CONVEX_INSTANCE_NAME
  CONVEX_INSTANCE_SECRET
  CONVEX_SELF_HOSTED_URL
  DISCORD_GATEWAY_SHARED_SECRET
  SERVICE_SHARED_SECRET
  WEB_APP_ORIGIN
  WORKOS_ALLOWED_USER_IDS
  WORKOS_CLIENT_ID
)

for variable_name in "${required_variables[@]}"; do
  [ -n "${!variable_name:-}" ] || {
    printf 'Missing required Convex function deployer variable: %s\n' "$variable_name" >&2
    exit 1
  }
done

[ "${#CONVEX_INSTANCE_SECRET}" -ge 64 ] || {
  printf 'CONVEX_INSTANCE_SECRET is invalid.\n' >&2
  exit 1
}
[ "${#SERVICE_SHARED_SECRET}" -ge 32 ] || {
  printf 'SERVICE_SHARED_SECRET is invalid.\n' >&2
  exit 1
}
[ "${#DISCORD_GATEWAY_SHARED_SECRET}" -ge 32 ] || {
  printf 'DISCORD_GATEWAY_SHARED_SECRET is invalid.\n' >&2
  exit 1
}

convex_admin_key="$(convex-generate-key "$CONVEX_INSTANCE_NAME" "$CONVEX_INSTANCE_SECRET")"
export CONVEX_SELF_HOSTED_ADMIN_KEY="$convex_admin_key"
unset convex_admin_key

sync_function_variable() {
  local variable_name="$1"
  printf '%s' "${!variable_name}" |
    ./node_modules/.bin/convex env set "$variable_name" >/dev/null 2>&1
}

for variable_name in \
  DISCORD_GATEWAY_SHARED_SECRET \
  SERVICE_SHARED_SECRET \
  WEB_APP_ORIGIN \
  WORKOS_ALLOWED_USER_IDS \
  WORKOS_CLIENT_ID; do
  sync_function_variable "$variable_name" || {
    printf 'Convex function environment sync failed for %s.\n' "$variable_name" >&2
    exit 1
  }
done

deployment_log="$(mktemp)"
trap 'rm -f "$deployment_log"; unset CONVEX_SELF_HOSTED_ADMIN_KEY CONVEX_INSTANCE_SECRET' EXIT
if ! npm run convex:deploy -- \
  --typecheck enable \
  --codegen disable \
  --message "Project Trishula Railway source deploy" >"$deployment_log" 2>&1; then
  printf 'Convex function deployment failed. Detailed output was withheld.\n' >&2
  exit 1
fi

printf 'Convex functions deployed successfully.\n'
unset CONVEX_SELF_HOSTED_ADMIN_KEY CONVEX_INSTANCE_SECRET
exec node ./health.mjs
