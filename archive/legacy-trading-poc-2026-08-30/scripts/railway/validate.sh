#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

require_command jq
require_command shasum

for script in "$SCRIPT_DIR"/*.sh; do
  bash -n "$script"
done

for config in \
  "$REPO_ROOT/apps/web/railway.json" \
  "$REPO_ROOT/apps/pi/railway.json" \
  "$REPO_ROOT/infra/railway/convex-backend/railway.json" \
  "$REPO_ROOT/infra/railway/convex-dashboard/railway.json"; do
  jq -e . "$config" >/dev/null || die "Invalid JSON configuration: $config"
done

require_repo_file "apps/web/Dockerfile"
require_repo_file "apps/pi/Dockerfile"
require_repo_file "apps/convex/convex.json"
require_repo_file "infra/railway/convex-backend/Dockerfile"
require_repo_file "infra/railway/convex-dashboard/Dockerfile"
require_repo_file "scripts/railway/provision-user-runtime.sh"
require_repo_file "scripts/railway/release.sh"

grep -Fq 'npm run convex:deploy' "$SCRIPT_DIR/deploy.sh" ||
  die "deploy.sh does not deploy the Convex function package."
grep -Fq 'railway deployment list' "$SCRIPT_DIR/lib.sh" ||
  die "The shared deployment helper does not verify Railway deployment status."
grep -Fq 'PI_RUNTIME_SERVICE_PREFIX' "$SCRIPT_DIR/deploy.sh" ||
  die "deploy.sh does not discover per-user Pi runtime services."
grep -Fq 'BOUND_ACTOR_ID' "$SCRIPT_DIR/provision-user-runtime.sh" ||
  die "The user-runtime provisioner does not bind Pi to one WorkOS user."
grep -Fq 'PI_CREDENTIAL_ENCRYPTION_KEY' "$SCRIPT_DIR/provision-user-runtime.sh" ||
  die "The user-runtime provisioner does not configure an independent credential key."
grep -Fq 'LIVE_TRADING_ENABLED false' "$SCRIPT_DIR/provision-user-runtime.sh" ||
  die "The user-runtime provisioner does not keep live order placement disabled."
grep -Fq './generate_admin_key.sh' "$SCRIPT_DIR/release.sh" ||
  die "release.sh does not generate a temporary Convex admin key inside the backend."
grep -Fq 'trap release_cleanup EXIT' "$SCRIPT_DIR/release.sh" ||
  die "release.sh does not clear its temporary Convex release credential."
grep -Fq 'sync_convex_function_environment' "$SCRIPT_DIR/deploy.sh" ||
  die "deploy.sh does not synchronize the Convex function environment."
for variable_name in \
  WORKOS_CLIENT_ID \
  WORKOS_ALLOWED_USER_IDS \
  SERVICE_SHARED_SECRET \
  EXECUTION_PRIVATE_DOMAIN_SUFFIX \
  WEB_APP_ORIGIN; do
  grep -Fq "$variable_name" "$SCRIPT_DIR/deploy.sh" ||
    die "deploy.sh does not synchronize required Convex variable: $variable_name"
done
grep -Fq 'convex env remove EXECUTION_BASE_URL' "$SCRIPT_DIR/deploy.sh" ||
  die "deploy.sh does not remove the legacy singleton execution URL."

TEST_ACTOR_ID="user_01HWORKOSALLOWED"
[ "$(runtime_service_name "$TEST_ACTOR_ID")" = "pi-u-f5bd51748dab9767072f" ] ||
  die "The shell runtime-name derivation does not match the Convex routing contract."
[ "$(runtime_volume_name "$TEST_ACTOR_ID")" = "pi-data-f5bd51748dab9767072f" ] ||
  die "The per-user runtime volume name is not deterministic."

TEST_VOLUME_JSON='{"volumes":[{"id":"volume-1","name":"pi-data-f5bd51748dab9767072f","mountPath":"/data","serviceName":"pi"}]}'
[ "$(volume_id_by_attachment "$TEST_VOLUME_JSON" "service-1" "pi" "/data")" = "volume-1" ] ||
  die "Volume discovery does not support Railway service-name attachments."
volume_matches_service_contract \
  "$TEST_VOLUME_JSON" \
  "volume-1" \
  "service-1" \
  "pi" \
  "/data" || die "Volume attachment validation rejected the expected per-user contract."

TEST_VARIABLES_JSON='{"SERVICE_SHARED_SECRET":"test-service-secret-value-at-least-32","EXECUTION_PRIVATE_DOMAIN_SUFFIX":"railway.internal:8080"}'
[ "$(variable_value_from_json "$TEST_VARIABLES_JSON" "EXECUTION_PRIVATE_DOMAIN_SUFFIX")" = "railway.internal:8080" ] ||
  die "Railway object-form variable extraction failed."
TEST_VARIABLE_ROWS='[{"name":"WEB_APP_ORIGIN","value":"https://signal.example"}]'
[ "$(variable_value_from_json "$TEST_VARIABLE_ROWS" "WEB_APP_ORIGIN")" = "https://signal.example" ] ||
  die "Railway row-form variable extraction failed."

info "Railway scripts, Convex environment sync, per-user runtime controls, service JSON, Dockerfile roots, and Signal paths are valid."
