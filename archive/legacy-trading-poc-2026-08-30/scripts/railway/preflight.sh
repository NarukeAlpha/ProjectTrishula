#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

require_command railway
require_command jq

require_repo_file "apps/web/Dockerfile"
require_repo_file "apps/web/railway.json"
require_repo_file "apps/pi/Dockerfile"
require_repo_file "apps/pi/railway.json"
require_repo_file "apps/convex/convex.json"
require_repo_file "infra/railway/convex-backend/Dockerfile"
require_repo_file "infra/railway/convex-backend/railway.json"
require_repo_file "infra/railway/convex-dashboard/Dockerfile"
require_repo_file "infra/railway/convex-dashboard/railway.json"

jq -e '.build.builder == "DOCKERFILE" and .deploy.healthcheckPath == "/healthz"' \
  "$REPO_ROOT/apps/web/railway.json" >/dev/null ||
  die "apps/web/railway.json has an unexpected build or health configuration."
jq -e '.build.builder == "DOCKERFILE" and .deploy.healthcheckPath == "/health"' \
  "$REPO_ROOT/apps/pi/railway.json" >/dev/null ||
  die "apps/pi/railway.json has an unexpected build or health configuration."
jq -e '.build.builder == "DOCKERFILE" and .deploy.healthcheckPath == "/version"' \
  "$REPO_ROOT/infra/railway/convex-backend/railway.json" >/dev/null ||
  die "Convex backend railway.json has an unexpected build or health configuration."
jq -e '.build.builder == "DOCKERFILE"' \
  "$REPO_ROOT/infra/railway/convex-dashboard/railway.json" >/dev/null ||
  die "Convex dashboard railway.json has an unexpected build configuration."

[ "$(basename "$REPO_ROOT")" = "Trading" ] || die "Unexpected repository root: $REPO_ROOT"

info "Repository files and Railway service definitions are present."
info "Target project name: $TARGET_PROJECT_NAME"
info "Target environment: $TARGET_ENVIRONMENT"
info "No Railway resources were created or changed by preflight."

if railway whoami >/dev/null 2>&1; then
  info "Railway CLI authentication is available."
else
  info "Railway CLI authentication is not available; bootstrap and deploy will stop."
fi

if railway status --json >/dev/null 2>&1; then
  info "The current directory has a Railway link; deployment scripts will ignore it."
else
  info "The current directory has no usable Railway link; this is safe for a new project."
fi

if railway list --json >/dev/null 2>&1; then
  info "Railway project listing is available."
else
  info "Railway project listing is unavailable; check authentication or network access."
fi
