#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

readonly CONVEX_FUNCTION_ENVIRONMENT_NAMES=(
  WORKOS_CLIENT_ID
  WORKOS_ALLOWED_USER_IDS
  SERVICE_SHARED_SECRET
  EXECUTION_PRIVATE_DOMAIN_SUFFIX
  WEB_APP_ORIGIN
)

require_command railway
require_command jq
require_command npm

bash "$SCRIPT_DIR/preflight.sh"

[ -n "${CONVEX_SELF_HOSTED_URL:-}" ] ||
  die "CONVEX_SELF_HOSTED_URL is required for the controlled function deployment."
[ -n "${CONVEX_SELF_HOSTED_ADMIN_KEY:-}" ] ||
  die "CONVEX_SELF_HOSTED_ADMIN_KEY is required for the controlled function deployment."
case "$CONVEX_SELF_HOSTED_URL" in
  https://*) ;;
  *) die "CONVEX_SELF_HOSTED_URL must use HTTPS." ;;
esac
[ -z "${CONVEX_DEPLOYMENT:-}" ] ||
  die "Unset CONVEX_DEPLOYMENT before a self-hosted Convex deployment."
[ -z "${CONVEX_DEPLOY_KEY:-}" ] ||
  die "Unset CONVEX_DEPLOY_KEY before a self-hosted Convex deployment."
[ -x "$REPO_ROOT/apps/convex/node_modules/.bin/convex" ] ||
  die "Convex dependencies are missing. Run npm ci --prefix apps/convex."
validate_deployment_polling

PROJECT_ID="$(resolve_existing_project)"
SERVICES_JSON="$(service_list_json "$PROJECT_ID")"
WEB_SERVICE_ID="$(service_id_for_name "$SERVICES_JSON" "$WEB_SERVICE_NAME")"
CONVEX_SERVICE_ID="$(service_id_for_name "$SERVICES_JSON" "$CONVEX_SERVICE_NAME")"
DASHBOARD_SERVICE_ID="$(service_id_for_name "$SERVICES_JSON" "$DASHBOARD_SERVICE_NAME")"
PI_RUNTIME_ROWS="$(printf '%s' "$SERVICES_JSON" |
  jq -r --arg legacy_name "$PI_SERVICE_NAME" --arg runtime_prefix "$PI_RUNTIME_SERVICE_PREFIX" '
    [
      .. | objects |
      select(
        (.id? // "") != "" and
        (
          (.name? // .serviceName? // "") == $legacy_name or
          ((.name? // .serviceName? // "") | startswith($runtime_prefix))
        )
      ) |
      [.id, (.name? // .serviceName?)]
    ] |
    unique_by(.[0]) |
    .[] |
    @tsv
  ')"

[ -n "$WEB_SERVICE_ID" ] || die "Missing Railway service: $WEB_SERVICE_NAME. Run bootstrap.sh first."
[ -n "$PI_RUNTIME_ROWS" ] || die "No per-user Pi runtime exists. Run provision-user-runtime.sh first."
[ -n "$CONVEX_SERVICE_ID" ] || die "Missing Railway service: $CONVEX_SERVICE_NAME. Run bootstrap.sh first."
if [ "${RAILWAY_DEPLOY_DASHBOARD:-1}" = "1" ]; then
  [ -n "$DASHBOARD_SERVICE_ID" ] || die "Missing Railway service: $DASHBOARD_SERVICE_NAME. Run bootstrap.sh first."
fi

assert_convex_release_target() {
  local url_without_scheme="${CONVEX_SELF_HOSTED_URL#https://}"
  local host_and_port="${url_without_scheme%%/*}"
  local url_path="${url_without_scheme#"$host_and_port"}"
  local hostname="${host_and_port%%:*}"

  [ -n "$hostname" ] && { [ -z "$url_path" ] || [ "$url_path" = "/" ]; } ||
    die "CONVEX_SELF_HOSTED_URL must be the Convex API origin without a path."
  if ! railway domain list \
    --project "$PROJECT_ID" \
    --environment "$TARGET_ENVIRONMENT" \
    --service "$CONVEX_SERVICE_ID" \
    --json 2>/dev/null |
    jq -e --arg hostname "$hostname" '
      any(.. | objects; ((.domain? // .hostname? // "") == $hostname))
    ' >/dev/null; then
    die "CONVEX_SELF_HOSTED_URL does not match a public domain on the selected Convex service."
  fi
}

assert_convex_release_target

sync_convex_function_environment() (
  set -Eeuo pipefail
  set +x
  local railway_variables_json
  local variable_name
  local variable_value
  local actor_id
  local convex_environment_names
  local -a workos_actor_ids
  trap 'unset railway_variables_json variable_name variable_value actor_id convex_environment_names workos_actor_ids' EXIT

  railway_variables_json="$(
    service_variables_json "$PROJECT_ID" "$CONVEX_SERVICE_ID" 2>/dev/null |
      jq -cer '
        def value_for($source; $name):
          if ($source | type) == "object" and ($source | has($name)) then
            $source[$name]
          else
            [
              $source | .. | objects |
              select((.name? // .key? // "") == $name) |
              (.value? // empty) |
              select(type == "string" and length > 0)
            ] |
            unique |
            if length == 1 then .[0] else error("missing or ambiguous variable") end
          end;
        . as $source |
        reduce [
          "WORKOS_CLIENT_ID",
          "WORKOS_ALLOWED_USER_IDS",
          "SERVICE_SHARED_SECRET",
          "EXECUTION_PRIVATE_DOMAIN_SUFFIX",
          "WEB_APP_ORIGIN"
        ][] as $name (
          {};
          .[$name] = value_for($source; $name)
        ) |
        if all(.[]; type == "string" and length > 0) then
          .
        else
          error("required variable is empty")
        end
      '
  )" ||
    die "Railway variables could not be read for the controlled Convex environment sync."

  cd "$REPO_ROOT/apps/convex"
  for variable_name in "${CONVEX_FUNCTION_ENVIRONMENT_NAMES[@]}"; do
    variable_value="$(variable_value_from_json "$railway_variables_json" "$variable_name" 2>/dev/null)" ||
      die "Missing required Convex function environment variable in Railway: $variable_name"
    case "$variable_value" in
      *'${{'*) die "Railway returned an unresolved variable reference for: $variable_name" ;;
    esac
    case "$variable_name" in
      EXECUTION_PRIVATE_DOMAIN_SUFFIX)
        [ "$variable_value" = "railway.internal:8080" ] ||
          die "EXECUTION_PRIVATE_DOMAIN_SUFFIX must be railway.internal:8080."
        ;;
      SERVICE_SHARED_SECRET)
        [ "${#variable_value}" -ge 32 ] ||
          die "SERVICE_SHARED_SECRET must contain at least 32 characters."
        ;;
      WORKOS_ALLOWED_USER_IDS)
        IFS=',' read -r -a workos_actor_ids <<<"$variable_value"
        [ "${#workos_actor_ids[@]}" -gt 0 ] ||
          die "WORKOS_ALLOWED_USER_IDS must contain at least one user ID."
        for actor_id in "${workos_actor_ids[@]}"; do
          validate_actor_id "$actor_id"
        done
        ;;
      WORKOS_CLIENT_ID)
        [[ "$variable_value" =~ ^client_[A-Za-z0-9_-]+$ ]] ||
          die "WORKOS_CLIENT_ID is invalid."
        ;;
      WEB_APP_ORIGIN)
        [[ "$variable_value" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] ||
          die "WEB_APP_ORIGIN must be one HTTPS origin without a path."
        ;;
    esac
    unset variable_value
  done

  for variable_name in "${CONVEX_FUNCTION_ENVIRONMENT_NAMES[@]}"; do
    if ! printf '%s' "$railway_variables_json" |
      jq -jer --arg variable_name "$variable_name" '.[$variable_name]' |
      ./node_modules/.bin/convex env set "$variable_name" >/dev/null 2>&1; then
      die "Convex function environment sync failed for: $variable_name"
    fi
  done

  ./node_modules/.bin/convex env remove EXECUTION_BASE_URL >/dev/null 2>&1 ||
    die "The legacy Convex execution URL could not be removed."

  convex_environment_names="$(./node_modules/.bin/convex env list --names-only 2>/dev/null)" ||
    die "The synchronized Convex function environment could not be audited."
  for variable_name in "${CONVEX_FUNCTION_ENVIRONMENT_NAMES[@]}"; do
    grep -Fxq "$variable_name" <<<"$convex_environment_names" ||
      die "Convex function environment is missing required variable: $variable_name"
  done
  if grep -Fxq EXECUTION_BASE_URL <<<"$convex_environment_names"; then
    die "The legacy singleton execution URL remains in the Convex function environment."
  fi
  info "The allowlisted Convex function environment is synchronized from Railway."
)

deploy_convex_functions() (
  set -Eeuo pipefail
  local function_temp_dir
  local result_file
  function_temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/signal-convex-release.XXXXXX")"
  trap 'rm -rf -- "$function_temp_dir"' EXIT
  result_file="$function_temp_dir/convex-functions.log"
  info "Deploying the Convex functions, indexes, and schema."
  if ! (
    cd "$REPO_ROOT/apps/convex"
    npm run convex:deploy -- \
      --typecheck enable \
      --codegen disable \
      --message "Signal Railway release"
  ) >"$result_file" 2>&1; then
    die "Convex function deployment failed. Its output was withheld because it can contain deployment details."
  fi
  info "Convex functions, indexes, and schema deployed successfully."
)

# Deploy and verify the Convex runtime before pushing the function package with
# the temporary self-hosted admin key inherited by this process.
deploy_railway_service "$PROJECT_ID" "convex-backend" "$CONVEX_SERVICE_ID" "infra/railway/convex-backend"
sync_convex_function_environment
deploy_convex_functions

if [ "${RAILWAY_DEPLOY_DASHBOARD:-1}" = "1" ]; then
  deploy_railway_service "$PROJECT_ID" "convex-dashboard" "$DASHBOARD_SERVICE_ID" "infra/railway/convex-dashboard"
fi

while IFS=$'\t' read -r runtime_service_id runtime_service_name; do
  [ -n "$runtime_service_id" ] || continue
  deploy_railway_service "$PROJECT_ID" "$runtime_service_name" "$runtime_service_id" "apps/pi"
done <<<"$PI_RUNTIME_ROWS"
deploy_railway_service "$PROJECT_ID" "web" "$WEB_SERVICE_ID" "apps/web"

info "All submitted deployments reached SUCCESS in the separate Signal project."
info "The Convex function package completed after the backend became healthy."
info "No service variable or temporary admin-key value was printed or persisted."

unset CONVEX_SELF_HOSTED_ADMIN_KEY
