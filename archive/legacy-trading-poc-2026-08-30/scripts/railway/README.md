# Signal Railway scripts

These scripts are separate from the application build. They use the Railway
CLI with explicit project, environment, and service selectors.

## Local validation and preflight

Run commands from `/Users/narukealpha/IdeaProjects/Trading`.

```sh
bash scripts/railway/validate.sh
```

`validate.sh` performs local Bash, JSON, Dockerfile-root, and Signal path
checks. It does not contact Railway.

```sh
bash scripts/railway/preflight.sh
```

`preflight.sh` checks local files and performs read-only Railway authentication,
link, and project-list checks. It does not call a Railway resource-creation,
deployment, variable, domain, bucket, or volume mutation command.

## Shared project bootstrap

```sh
RAILWAY_PROJECT_NAME=signal-trading-poc \
  bash scripts/railway/bootstrap.sh
```

`bootstrap.sh` is idempotent for the named project. It creates the missing
shared services and resources: `web`, `convex-backend`, the private Convex
dashboard, Postgres, the artifact bucket, and the public web and Convex domains.
It does not create a Pi service or volume. It never sets a variable and never
prints variable values.

## Per-user Pi provisioning

Provision one private runtime for each WorkOS subject already listed in
`WORKOS_ALLOWED_USER_IDS`. Read the subject through standard input so it does
not appear in shell history or a process listing:

```sh
IFS= read -r -s WORKOS_USER_ID
printf '%s\n' "$WORKOS_USER_ID" | \
  RAILWAY_PROJECT_ID=your-new-project-id \
  bash scripts/railway/provision-user-runtime.sh --actor-stdin
unset WORKOS_USER_ID
```

The provisioner derives the private endpoint
`pi-u-${sha256(actorId).slice(0,20)}.railway.internal`. It creates the matching
private service and `pi-data-<20-character-hash>` volume, mounts the volume at
`/data`, sets the runtime variables, and deploys `apps/pi`. It preserves an
existing valid `PI_CREDENTIAL_ENCRYPTION_KEY` or creates an independent key
without printing it. Use `--no-deploy` only when the controlled deployment will
follow immediately.

To preserve the original `pi` service and its attached Codex OAuth file, bind
that service to the approved user's derived private endpoint:

```sh
IFS= read -r -s WORKOS_USER_ID
printf '%s\n' "$WORKOS_USER_ID" | \
  RAILWAY_PROJECT_ID=your-new-project-id \
  bash scripts/railway/provision-user-runtime.sh --actor-stdin --service pi
unset WORKOS_USER_ID
```

The service name remains `pi`, but its private-network endpoint becomes the
derived `pi-u-*` name. The provisioner reuses the attached `/data` volume and
renames it to the matching per-user volume name.

The provisioner sets these variables on each runtime:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=8080
BOUND_ACTOR_ID=<approved-workos-subject>
SERVICE_SHARED_SECRET=${{convex-backend.SERVICE_SHARED_SECRET}}
CONVEX_SITE_URL=https://${{convex-backend.RAILWAY_PUBLIC_DOMAIN}}/http
PI_AUTH_PATH=/data/auth.json
PI_CREDENTIAL_ENCRYPTION_KEY=<independent-secret>
PI_CREDENTIAL_KEY_VERSION=1
PI_MODEL=gpt-5.6-terra
CODEX_AUTH_MODE=device_code
PI_AUTH_BOOTSTRAP=false
BROKER_MODE=robinhood
ROBINHOOD_OAUTH_REDIRECT_URI=https://${{convex-backend.RAILWAY_PUBLIC_DOMAIN}}/http/broker/robinhood/callback
LIVE_TRADING_ENABLED=false
```

The explicit redirect matches the value Pi derives from `CONVEX_SITE_URL`. The
browser receives only the validated Robinhood authorization URL. It never
receives broker tokens. Initial Robinhood Agentic authorization can require a
desktop handoff.

## Codex device bootstrap

Each runtime needs its own Codex device login. Set `RUNTIME_SERVICE` to the
actual Railway service name shown by the provisioner. Use `pi` for a rebound
legacy service.

```sh
railway ssh \
  --project "$RAILWAY_PROJECT_ID" \
  --environment production \
  --service "$RUNTIME_SERVICE"

runuser -u node -- env CODEX_AUTH_MODE=device_code \
  npm --prefix /app run auth:codex
exit
```

Open the displayed verification URL and enter the one-time code. Do not open,
print, copy, or export `/data/auth.json`.

## Controlled deployment

Use `release.sh` for the normal release. It resolves the selected Convex
service's single public domain, runs `./generate_admin_key.sh` inside the private
backend, keeps the temporary key only in process memory, calls `deploy.sh`, and
clears the key on exit.

Railway service variables do not automatically become Convex function
variables. The guarded deploy synchronizes only the five approved names listed
below and removes the legacy `EXECUTION_BASE_URL`.

```sh
RAILWAY_PROJECT_ID=your-new-project-id \
  bash scripts/railway/release.sh
```

Use the manual `deploy.sh` entry point only as a fallback when a temporary
self-hosted admin key was supplied through another secure process:

```sh
export CONVEX_SELF_HOSTED_URL="https://<convex-api-domain>"
IFS= read -r -s CONVEX_SELF_HOSTED_ADMIN_KEY
export CONVEX_SELF_HOSTED_ADMIN_KEY
RAILWAY_PROJECT_ID=your-new-project-id bash scripts/railway/deploy.sh
unset CONVEX_SELF_HOSTED_ADMIN_KEY CONVEX_SELF_HOSTED_URL
```

For the fallback, paste the temporary self-hosted admin key at the hidden
`read` prompt. The key is inherited by `deploy.sh`; it is not a command-line
argument and the script does not print it. The script also requires the
self-hosted URL hostname to match a public domain on the selected Convex
Railway service.

The script deploys and verifies the Convex backend, then pushes the functions,
indexes, and schema. Before the push, it copies only `WORKOS_CLIENT_ID`,
`WORKOS_ALLOWED_USER_IDS`, `SERVICE_SHARED_SECRET`,
`EXECUTION_PRIVATE_DOMAIN_SUFFIX`, and `WEB_APP_ORIGIN` from the selected
Railway Convex service into the Convex function environment. Values stay in
process memory and are never printed or persisted. The sync removes the legacy
`EXECUTION_BASE_URL`. The script deploys every legacy `pi` or `pi-u-*` runtime
and then web. It fails if no per-user runtime exists. It also deploys the
private dashboard by default. Set `RAILWAY_DEPLOY_DASHBOARD=0` to omit the
dashboard image.

Every submitted Railway deployment must reach `SUCCESS`. The default timeout
is 30 minutes per service. Override it with
`RAILWAY_DEPLOY_TIMEOUT_SECONDS`. Set `RAILWAY_DEPLOY_POLL_SECONDS` from 1
through 60 to change the five-second polling interval. A failure reports the
service, deployment ID, terminal status, and Railway logs URL without printing
service variables.

## Safety controls

- The default project is `signal-trading-poc`.
- `RAILWAY_PROJECT_ID` takes precedence over project-name lookup.
- The known `ota-chat-full` project name and ID are hard-denied.
- Deploy never uses the current directory's implicit link.
- Deploy output shows only sanitized status and diagnostics.
- Functions, indexes, and schema deploy only after the Convex backend succeeds.
- Deploy synchronizes only the approved Convex function variables and removes
  the legacy singleton execution URL.
- Every submitted Railway deployment must report `SUCCESS`.
- Preflight and bootstrap do not read, list, or set Railway variables.
- The provisioner checks only whether the encryption key exists, is long
  enough, and differs from the service secret. It sets values through standard
  input and never prints them.
- Do not create a public domain or replicas for a Pi runtime.
- Give each Pi runtime one unique `/data` volume.
- Store only the runtime's Codex OAuth file at `/data/auth.json` on that volume.
- Do not store Robinhood tokens in volume files or Railway variables. Pi
  encrypts them, and Convex stores only an opaque envelope and revision.
- Keep `LIVE_TRADING_ENABLED=false`.

Supported overrides are defined at the top of `lib.sh`. Use them only for the
new Signal project. Keep the shared service names and the `pi-u-` runtime prefix
stable unless the Railway project was intentionally created with different
names.
