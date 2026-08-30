#!/usr/bin/env bash

set -Eeuo pipefail

readonly RAILWAY_OTA_PROJECT_ID="1385a1cf-7d70-4451-ad1f-eddf61832f69"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

readonly TARGET_ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
readonly TARGET_PROJECT_NAME="${RAILWAY_PROJECT_NAME:-signal-trading-poc}"
TARGET_WORKSPACE="${RAILWAY_WORKSPACE:-}"
if [ -z "$TARGET_WORKSPACE" ]; then
  TARGET_WORKSPACE="Gabriel Alfonzo's Projects"
fi
readonly TARGET_WORKSPACE
readonly WEB_SERVICE_NAME="${RAILWAY_WEB_SERVICE_NAME:-web}"
readonly PI_SERVICE_NAME="${RAILWAY_PI_SERVICE_NAME:-pi}"
readonly PI_RUNTIME_SERVICE_PREFIX="${RAILWAY_PI_RUNTIME_SERVICE_PREFIX:-pi-u-}"
readonly PI_RUNTIME_VOLUME_PREFIX="${RAILWAY_PI_RUNTIME_VOLUME_PREFIX:-pi-data-}"
readonly CONVEX_SERVICE_NAME="${RAILWAY_CONVEX_SERVICE_NAME:-convex-backend}"
readonly DASHBOARD_SERVICE_NAME="${RAILWAY_DASHBOARD_SERVICE_NAME:-convex-dashboard}"
readonly POSTGRES_SERVICE_NAME="${RAILWAY_POSTGRES_SERVICE_NAME:-Postgres}"
readonly ARTIFACT_BUCKET_NAME="${RAILWAY_ARTIFACT_BUCKET_NAME:-convex-artifacts}"
readonly ARTIFACT_BUCKET_REGION="${RAILWAY_ARTIFACT_BUCKET_REGION:-sjc}"
readonly PI_VOLUME_MOUNT_PATH="/data"

validate_actor_id() {
  local actor_id="$1"
  [ -n "$actor_id" ] &&
    [ "${#actor_id}" -le 256 ] &&
    [[ "$actor_id" =~ ^[A-Za-z0-9:_-]+$ ]] ||
    die "WorkOS user ID must contain only letters, numbers, colon, underscore, or hyphen."
}

actor_hash() {
  local actor_id="$1"
  validate_actor_id "$actor_id"
  printf '%s' "$actor_id" | shasum -a 256 | cut -c 1-20
}

runtime_service_name() {
  printf '%s%s\n' "$PI_RUNTIME_SERVICE_PREFIX" "$(actor_hash "$1")"
}

runtime_volume_name() {
  printf '%s%s\n' "$PI_RUNTIME_VOLUME_PREFIX" "$(actor_hash "$1")"
}

die() {
  printf 'railway: %s\n' "$*" >&2
  exit 1
}

info() {
  printf 'railway: %s\n' "$*" >&2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command is not installed: $1"
}

require_repo_file() {
  [ -f "$REPO_ROOT/$1" ] || die "Required repository file is missing: $1"
}

assert_safe_project() {
  local project_id="$1"
  local project_name="${2:-}"
  local normalized_name
  normalized_name="$(printf '%s' "$project_name" | tr '[:upper:]' '[:lower:]')"
  [ "$project_id" != "$RAILWAY_OTA_PROJECT_ID" ] || die "Refusing the ota-chat-full project ID."
  [ "$normalized_name" != "ota-chat-full" ] || die "Refusing the ota-chat-full project."
  [ -n "$project_id" ] || die "Railway project ID is empty."
}

project_list_json() {
  railway list --json
}

project_id_for_name() {
  local project_name="$1"
  project_list_json |
    jq -r --arg project_name "$project_name" '
      .. | objects |
      select((.name? // "") == $project_name and (.id? // "") != "") |
      .id
    ' | head -n 1
}

project_name_for_id() {
  local project_id="$1"
  project_list_json |
    jq -r --arg project_id "$project_id" '
      .. | objects |
      select((.id? // "") == $project_id and (.name? // "") != "") |
      .name
    ' | head -n 1
}

resolve_existing_project() {
  local project_id="${RAILWAY_PROJECT_ID:-}"
  local project_name
  if [ -z "$project_id" ]; then
    project_id="$(project_id_for_name "$TARGET_PROJECT_NAME")"
  fi
  [ -n "$project_id" ] || die "Project not found. Set RAILWAY_PROJECT_ID or run bootstrap.sh."
  project_name="$(project_name_for_id "$project_id")"
  assert_safe_project "$project_id" "$project_name"
  printf '%s\n' "$project_id"
}

service_list_json() {
  local project_id="$1"
  railway service list \
    --project "$project_id" \
    --environment "$TARGET_ENVIRONMENT" \
    --json
}

service_variables_json() {
  local project_id="$1"
  local service_id="$2"
  railway variable list \
    --project "$project_id" \
    --environment "$TARGET_ENVIRONMENT" \
    --service "$service_id" \
    --json
}

variable_value_from_json() {
  local variables_json="$1"
  local variable_name="$2"
  printf '%s' "$variables_json" |
    jq -er --arg variable_name "$variable_name" '
      if type == "object" and has($variable_name) then
        .[$variable_name] |
        if type == "string" and length > 0 then . else error("invalid variable") end
      else
        [
          .. | objects |
          select((.name? // .key? // "") == $variable_name) |
          (.value? // empty) |
          select(type == "string" and length > 0)
        ] |
        unique |
        if length == 1 then .[0] else error("missing or ambiguous variable") end
      end
    '
}

service_id_for_name() {
  local service_json="$1"
  local service_name="$2"
  printf '%s' "$service_json" |
    jq -r --arg service_name "$service_name" '
      .. | objects |
      select((.name? // .serviceName? // "") == $service_name and (.id? // "") != "") |
      .id
    ' | head -n 1
}

service_id_for_lower_name() {
  local service_json="$1"
  local service_name="$2"
  printf '%s' "$service_json" |
    jq -r --arg service_name "$service_name" '
      .. | objects |
      select(((.name? // .serviceName? // "") | ascii_downcase) == $service_name and (.id? // "") != "") |
      .id
    ' | head -n 1
}

ensure_service() {
  local project_id="$1"
  local service_name="$2"
  local services_json
  local service_id
  services_json="$(service_list_json "$project_id")"
  service_id="$(service_id_for_name "$services_json" "$service_name")"
  if [ -n "$service_id" ]; then
    printf '%s\n' "$service_id"
    return 0
  fi
  info "Creating missing Railway service: $service_name"
  railway add --service "$service_name" --json >/dev/null
  services_json="$(service_list_json "$project_id")"
  service_id="$(service_id_for_name "$services_json" "$service_name")"
  [ -n "$service_id" ] || die "Railway did not report the new service: $service_name"
  printf '%s\n' "$service_id"
}

ensure_postgres() {
  local project_id="$1"
  local services_json
  local service_id
  services_json="$(service_list_json "$project_id")"
  service_id="$(service_id_for_lower_name "$services_json" "$(printf '%s' "$POSTGRES_SERVICE_NAME" | tr '[:upper:]' '[:lower:]')")"
  if [ -n "$service_id" ]; then
    printf '%s\n' "$service_id"
    return 0
  fi
  info "Creating missing Railway Postgres service."
  railway add --database postgres --json >/dev/null
  services_json="$(service_list_json "$project_id")"
  service_id="$(service_id_for_lower_name "$services_json" "postgres")"
  [ -n "$service_id" ] || die "Railway did not report the new Postgres service."
  printf '%s\n' "$service_id"
}

ensure_bucket() {
  local bucket_json
  bucket_json="$(railway bucket list --environment "$TARGET_ENVIRONMENT" --json)"
  if printf '%s' "$bucket_json" | jq -e --arg bucket_name "$ARTIFACT_BUCKET_NAME" '
      any(.. | objects; ((.name? // .bucketName? // "") == $bucket_name))
    ' >/dev/null; then
    info "Artifact bucket already exists: $ARTIFACT_BUCKET_NAME"
    return 0
  fi
  info "Creating missing artifact bucket: $ARTIFACT_BUCKET_NAME"
  railway bucket create "$ARTIFACT_BUCKET_NAME" \
    --environment "$TARGET_ENVIRONMENT" \
    --region "$ARTIFACT_BUCKET_REGION" \
    --json >/dev/null
}

volume_id_by_name() {
  local volume_json="$1"
  local volume_name="$2"
  printf '%s' "$volume_json" |
    jq -r --arg volume_name "$volume_name" '
      .. | objects |
      select((.name? // "") == $volume_name and (.id? // "") != "") |
      .id
    ' | head -n 1
}

volume_id_by_attachment() {
  local volume_json="$1"
  local service_id="$2"
  local service_name="$3"
  local mount_path="$4"
  printf '%s' "$volume_json" |
    jq -r --arg service_id "$service_id" --arg service_name "$service_name" --arg mount_path "$mount_path" '
      .. | objects |
      select(
        (.id? // "") != "" and
        ((.mountPath? // .mount_path? // "") == $mount_path) and
        (
          ((.serviceId? // .service?.id? // "") == $service_id) or
          ((.serviceName? // .service?.name? // "") == $service_name)
        )
      ) |
      .id
    ' | head -n 1
}

volume_matches_service_contract() {
  local volume_json="$1"
  local volume_id="$2"
  local service_id="$3"
  local service_name="$4"
  local mount_path="$5"
  printf '%s' "$volume_json" |
    jq -e \
      --arg volume_id "$volume_id" \
      --arg service_id "$service_id" \
      --arg service_name "$service_name" \
      --arg mount_path "$mount_path" '
      any(
        .. | objects;
        ((.id? // "") == $volume_id) and
        ((.mountPath? // .mount_path? // "") == $mount_path) and
        (
          ((.serviceId? // .service?.id? // "") == $service_id) or
          ((.serviceName? // .service?.name? // "") == $service_name)
        )
      )
    ' >/dev/null
}

ensure_service_volume() {
  local project_id="$1"
  local service_id="$2"
  local service_name="$3"
  local volume_name="$4"
  local mount_path="$5"
  local volume_json
  local volume_id
  # Resolve and link the exact service before reading or creating its volume.
  # This keeps volume discovery bound to one per-user runtime.
  railway link \
    --project "$project_id" \
    --environment "$TARGET_ENVIRONMENT" \
    --service "$service_id" \
    --json >/dev/null
  volume_json="$(railway volume list --json)"
  volume_id="$(volume_id_by_name "$volume_json" "$volume_name")"
  if [ -n "$volume_id" ]; then
    volume_matches_service_contract "$volume_json" "$volume_id" "$service_id" "$service_name" "$mount_path" ||
      die "Existing volume $volume_name is not attached to the selected service at $mount_path."
  fi
  if [ -z "$volume_id" ]; then
    volume_id="$(volume_id_by_attachment "$volume_json" "$service_id" "$service_name" "$mount_path")"
    if [ -n "$volume_id" ]; then
      info "Renaming existing $mount_path volume to: $volume_name"
      railway volume update --volume "$volume_id" --name "$volume_name" --json >/dev/null
    fi
  fi
  if [ -n "$volume_id" ]; then
    printf '%s\n' "$volume_id"
    return 0
  fi
  info "Creating missing runtime volume $volume_name at $mount_path."
  volume_json="$(railway volume add \
    --mount-path "$mount_path" \
    --json)"
  volume_id="$(printf '%s' "$volume_json" | jq -r '.. | objects | select((.id? // "") != "") | .id' | head -n 1)"
  [ -n "$volume_id" ] || die "Railway did not report the new Pi volume."
  railway volume update --volume "$volume_id" --name "$volume_name" --json >/dev/null
  printf '%s\n' "$volume_id"
}

domain_exists() {
  local project_id="$1"
  local service_id="$2"
  railway domain list \
    --project "$project_id" \
    --environment "$TARGET_ENVIRONMENT" \
    --service "$service_id" \
    --json |
    jq -e 'any(.. | objects; ((.domain? // .hostname? // "") != ""))' >/dev/null
}

ensure_domain() {
  local project_id="$1"
  local service_id="$2"
  local port="${3:-}"
  if domain_exists "$project_id" "$service_id"; then
    info "Public domain already exists for service ID $service_id."
    return 0
  fi
  info "Creating public domain for service ID $service_id."
  if [ -n "$port" ]; then
    railway domain \
      --project "$project_id" \
      --environment "$TARGET_ENVIRONMENT" \
      --service "$service_id" \
      --port "$port" \
      --json >/dev/null
  else
    railway domain \
      --project "$project_id" \
      --environment "$TARGET_ENVIRONMENT" \
      --service "$service_id" \
      --json >/dev/null
  fi
}

validate_deployment_polling() {
  local timeout_seconds="${RAILWAY_DEPLOY_TIMEOUT_SECONDS:-1800}"
  local poll_seconds="${RAILWAY_DEPLOY_POLL_SECONDS:-5}"
  [[ "$timeout_seconds" =~ ^[0-9]+$ ]] &&
    [ "$timeout_seconds" -ge 60 ] ||
    die "RAILWAY_DEPLOY_TIMEOUT_SECONDS must be an integer of at least 60."
  [[ "$poll_seconds" =~ ^[0-9]+$ ]] &&
    [ "$poll_seconds" -ge 1 ] &&
    [ "$poll_seconds" -le 60 ] ||
    die "RAILWAY_DEPLOY_POLL_SECONDS must be an integer from 1 through 60."
}

deployment_diagnostics() {
  local service_label="$1"
  local deployment_id="$2"
  local status="$3"
  local logs_url="$4"
  info "Deployment did not succeed: service=$service_label deployment=$deployment_id status=$status"
  if [[ "$logs_url" == https://* ]]; then
    info "Railway logs: ${logs_url%%[?#]*}"
  else
    info "Inspect Railway build and deployment logs for deployment $deployment_id."
  fi
}

wait_for_railway_deployment() {
  local project_id="$1"
  local service_label="$2"
  local service_id="$3"
  local deployment_id="$4"
  local logs_url="$5"
  local status_file="$6"
  local timeout_seconds="${RAILWAY_DEPLOY_TIMEOUT_SECONDS:-1800}"
  local poll_seconds="${RAILWAY_DEPLOY_POLL_SECONDS:-5}"
  local started_at
  local deadline
  local current_time
  local status="QUEUED"
  local previous_status=""
  local read_failures=0

  validate_deployment_polling
  started_at="$(date +%s)"
  deadline=$((started_at + timeout_seconds))
  while true; do
    if railway deployment list \
      --project "$project_id" \
      --environment "$TARGET_ENVIRONMENT" \
      --service "$service_id" \
      --limit 100 \
      --json >"$status_file" 2>/dev/null &&
      jq -e 'type == "array"' "$status_file" >/dev/null; then
      status="$(jq -r --arg deployment_id "$deployment_id" '
        first(.[] | select(.id == $deployment_id) | .status) // empty
      ' "$status_file")"
      status="$(printf '%s' "$status" | tr '[:lower:]' '[:upper:]')"
      if [ -n "$status" ]; then
        read_failures=0
      else
        status="QUEUED"
      fi
    else
      read_failures=$((read_failures + 1))
      if [ "$read_failures" -ge 6 ]; then
        deployment_diagnostics "$service_label" "$deployment_id" "STATUS_UNAVAILABLE" "$logs_url"
        die "Railway deployment status could not be read after six attempts."
      fi
    fi

    if [ "$status" != "$previous_status" ]; then
      info "Waiting for $service_label deployment $deployment_id: $status"
      previous_status="$status"
    fi
    case "$status" in
      SUCCESS)
        info "Deployment succeeded: service=$service_label deployment=$deployment_id"
        return 0
        ;;
      QUEUED | WAITING | INITIALIZING | BUILDING | DEPLOYING | PENDING)
        ;;
      FAILED | CRASHED | NEEDS_APPROVAL | SLEEPING | SKIPPED | REMOVED | REMOVING | CANCELED | CANCELLED)
        deployment_diagnostics "$service_label" "$deployment_id" "$status" "$logs_url"
        die "Railway reported a terminal non-success deployment status."
        ;;
      *)
        deployment_diagnostics "$service_label" "$deployment_id" "$status" "$logs_url"
        die "Railway reported an unknown deployment status."
        ;;
    esac

    current_time="$(date +%s)"
    if [ "$current_time" -ge "$deadline" ]; then
      deployment_diagnostics "$service_label" "$deployment_id" "TIMEOUT_LAST_STATUS_$status" "$logs_url"
      die "Railway deployment verification timed out after $timeout_seconds seconds."
    fi
    sleep "$poll_seconds"
  done
}

deploy_railway_service() (
  set -Eeuo pipefail

  local project_id="$1"
  local service_label="$2"
  local service_id="$3"
  local source_path="$4"
  local deploy_temp_dir
  local result_file
  local status_file
  local deployment_id
  local logs_url

  validate_deployment_polling
  deploy_temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/signal-railway-service.XXXXXX")"
  trap 'rm -rf -- "$deploy_temp_dir"' EXIT
  result_file="$deploy_temp_dir/submission.json"
  status_file="$deploy_temp_dir/status.json"

  info "Submitting deployment for $service_label."
  if ! railway up "$REPO_ROOT/$source_path" \
    --path-as-root \
    --project "$project_id" \
    --environment "$TARGET_ENVIRONMENT" \
    --service "$service_id" \
    --detach \
    --json >"$result_file" 2>/dev/null; then
    die "Railway rejected the $service_label deployment. Inspect Railway deployment status."
  fi
  deployment_id="$(jq -r 'if type == "object" then .deploymentId // empty else empty end' "$result_file")"
  logs_url="$(jq -r 'if type == "object" then .logsUrl // empty else empty end' "$result_file")"
  [[ "$deployment_id" =~ ^[0-9A-Za-z-]{20,}$ ]] ||
    die "Railway accepted $service_label without returning a valid deployment ID."
  wait_for_railway_deployment \
    "$project_id" \
    "$service_label" \
    "$service_id" \
    "$deployment_id" \
    "$logs_url" \
    "$status_file"
)
