# Signal Trading POC on Railway

This directory defines a separate, production-like Railway environment for the
Signal trading proof of concept. It does not describe or target the existing
`ota-chat-full` project.

The application has three modules:

| Service | Source path | Exposure | Purpose |
| --- | --- | --- | --- |
| `web` | `apps/web` | Public | Phone UI and WorkOS sign-in |
| `convex-backend` | `infra/railway/convex-backend` | Public on port `3210` | Self-hosted Convex API, HTTP Actions, and the Robinhood callback |
| `pi-u-<actor-hash>` | `apps/pi` | Private | One actor-bound Pi and Robinhood MCP runtime per approved user |

An existing singleton service named `pi` can serve one approved user after it
is rebound to that user's derived private endpoint. Self-hosted Convex also
needs a private dashboard, Railway Postgres, and one artifact bucket.

## Resource layout

```text
Phone browser
  +-- web (public)
  `-- convex-backend (public:3210)
        |
        +-- Postgres (private)
        +-- convex-artifacts bucket
        +-- convex-dashboard (private)
        +-- pi-u-<user-a-hash> (private:8080)
        |     `-- pi-data-<user-a-hash> volume at /data
        `-- pi-u-<user-b-hash> (private:8080)
              `-- pi-data-<user-b-hash> volume at /data
```

Only `web` and `convex-backend` receive Railway public domains. Do not publish
a Pi runtime or the Convex dashboard. Do not add replicas to a Pi runtime.
Each runtime has one unique persistent `/data` volume.

## Per-user security boundary

Convex accepts only the WorkOS subjects in `WORKOS_ALLOWED_USER_IDS`. It hashes
the trusted actor ID and sends private requests to:

```text
pi-u-${sha256(actorId).slice(0,20)}.railway.internal:8080
```

The corresponding Pi runtime has the same WorkOS subject in `BOUND_ACTOR_ID`.
It rejects run, cancellation, connection, portfolio, and order requests for a
different actor.

The runtime volume stores only that user's Codex subscription OAuth file at
`/data/auth.json`. Do not store Robinhood tokens on the volume. Pi encrypts its
Robinhood OAuth record with AES-256-GCM and a runtime-specific
`PI_CREDENTIAL_ENCRYPTION_KEY`. Convex stores only the opaque envelope and its
revision. Convex cannot decrypt it, and one Pi runtime cannot use another
runtime's ciphertext.

The browser must never receive a Convex admin key, Pi service secret, WorkOS
API key, Robinhood token, or Codex OAuth file. Robinhood redirects to the public
Convex URL `/http/broker/robinhood/callback`. Convex consumes the one-time state,
finishes the exchange through the correct private Pi runtime, and returns a
`303` redirect to the web connected or failed page without `code` or `state`.

## Files and deployment roots

Run the scripts from this repository. They use explicit project and service
selectors so a linked OTA project cannot become the deployment target.

```text
apps/web                         -> web
apps/pi                          -> pi or pi-u-<actor-hash>
infra/railway/convex-backend     -> convex-backend
infra/railway/convex-dashboard   -> convex-dashboard (optional)
```

The service Dockerfiles and `railway.json` files define the build and health
configuration. The Convex image is pinned in `convex-backend/Dockerfile`. The
dashboard uses the matching pinned image.

## Safe workflow

Start with the read-only preflight:

```sh
bash scripts/railway/preflight.sh
```

Set `RAILWAY_PROJECT_NAME` to the new project name before bootstrapping. The
default is `signal-trading-poc`.

```sh
RAILWAY_PROJECT_NAME=signal-trading-poc \
  bash scripts/railway/bootstrap.sh
```

Bootstrap creates only the shared resources. It creates `web`,
`convex-backend`, `convex-dashboard`, Postgres, the `convex-artifacts` bucket,
and public domains for web and Convex. It does not create a Pi service or
volume. It never creates a public domain for the dashboard.

Provision each approved WorkOS subject after the shared variables are ready:

```sh
IFS= read -r -s WORKOS_USER_ID
printf '%s\n' "$WORKOS_USER_ID" | \
  RAILWAY_PROJECT_ID=your-new-project-id \
  bash scripts/railway/provision-user-runtime.sh --actor-stdin
unset WORKOS_USER_ID
```

The provisioner creates and deploys the user's private Pi service and volume.
Use `--no-deploy` to configure resources without submitting that deployment.
To preserve and bind the original singleton service and its `/data` volume,
add `--service pi`:

```sh
IFS= read -r -s WORKOS_USER_ID
printf '%s\n' "$WORKOS_USER_ID" | \
  RAILWAY_PROJECT_ID=your-new-project-id \
  bash scripts/railway/provision-user-runtime.sh --actor-stdin --service pi
unset WORKOS_USER_ID
```

The existing Railway service keeps the name `pi`. Its private-network endpoint
becomes the user's derived `pi-u-*` name, and its attached volume becomes the
matching `pi-data-*` volume.

After provisioning at least one user runtime, use the guarded release wrapper:

```sh
RAILWAY_PROJECT_ID=your-new-project-id \
  bash scripts/railway/release.sh
```

`release.sh` resolves the selected Convex service's single public domain, runs
`./generate_admin_key.sh` inside the private backend, keeps the temporary admin
key only in process memory, calls `deploy.sh`, and clears the key on exit.
Railway service variables do not automatically become Convex function
variables.
`deploy.sh` also copies the five approved function variables from the selected
Railway Convex service into the Convex function environment. It keeps their
values in process memory, does not print them, and removes the obsolete
`EXECUTION_BASE_URL`.

Use the manual `deploy.sh` path only as a fallback when another secure process
supplies the temporary Convex release credential. Paste the key at the hidden
`read` prompt:

```sh
export CONVEX_SELF_HOSTED_URL="https://<convex-api-domain>"
IFS= read -r -s CONVEX_SELF_HOSTED_ADMIN_KEY
export CONVEX_SELF_HOSTED_ADMIN_KEY
RAILWAY_PROJECT_ID=your-new-project-id bash scripts/railway/deploy.sh
unset CONVEX_SELF_HOSTED_ADMIN_KEY CONVEX_SELF_HOSTED_URL
```

Both release paths use `deploy.sh`. It refuses the known `ota-chat-full`
project ID and project name. It does not use the current directory's implicit
Railway link as a target. It waits for every submitted deployment to report
`SUCCESS`. It deploys the Convex functions, indexes, and schema after the
backend becomes healthy. It also verifies that `CONVEX_SELF_HOSTED_URL` matches
a public domain on the selected Convex service before it pushes functions.

The deploy enumerates the legacy service named `pi` and all services whose name
starts with `pi-u-`. It fails if it finds no user runtime.

## Variables

Configure shared-service variables through a secure process. The user-runtime
provisioner sets the Pi variables through standard input and does not print
their values. Railway-injected names are omitted below.

### `web`

Required:

```text
PUBLIC_CONVEX_URL
PUBLIC_WORKOS_CLIENT_ID
PUBLIC_WORKOS_REDIRECT_URI
```

Optional:

```text
PUBLIC_ENVIRONMENT
PUBLIC_APPLICATION_NAME
PUBLIC_APPLICATION_VERSION
PUBLIC_WORKOS_API_HOSTNAME
```

Only public identifiers belong on `web`. Do not set a WorkOS API key, Convex
admin key, service secret, database URL, bucket credential, model credential,
or Robinhood credential there.

### `convex-backend`

Required by the self-hosted Convex runtime and this application:

```text
INSTANCE_NAME
INSTANCE_SECRET
PORT
CONVEX_CLOUD_ORIGIN
CONVEX_SITE_ORIGIN
POSTGRES_URL
DO_NOT_REQUIRE_SSL
DISABLE_BEACON
REDACT_LOGS_TO_CLIENT
SERVICE_SHARED_SECRET
EXECUTION_PRIVATE_DOMAIN_SUFFIX
WEB_APP_ORIGIN
AWS_REGION
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
S3_ENDPOINT_URL
S3_STORAGE_EXPORTS_BUCKET
S3_STORAGE_SNAPSHOT_IMPORTS_BUCKET
S3_STORAGE_MODULES_BUCKET
S3_STORAGE_FILES_BUCKET
S3_STORAGE_SEARCH_BUCKET
AWS_S3_DISABLE_SSE
AWS_S3_DISABLE_CHECKSUMS
WORKOS_CLIENT_ID
WORKOS_ALLOWED_USER_IDS
```

`WORKOS_ALLOWED_USER_IDS` is a comma-separated list of approved WorkOS user
subjects. Provision one private Pi runtime for each entry. Set `WEB_APP_ORIGIN`
to the public HTTPS web origin with no path. Set
`EXECUTION_PRIVATE_DOMAIN_SUFFIX=railway.internal:8080`. Convex derives the
actor-specific service prefix; do not set `EXECUTION_BASE_URL`.

Set all five `S3_STORAGE_*_BUCKET` values to the `convex-artifacts` bucket. Use
Railway private references for Postgres and the bucket. For this Railway-only
test, `DO_NOT_REQUIRE_SSL=1` is required by the pinned Convex client. Do not
carry that setting to the AWS deployment without an explicit TLS review.

The non-secret Railway reference patterns are:

```text
POSTGRES_URL=postgresql://postgres:${{Postgres.POSTGRES_PASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432?sslmode=disable
EXECUTION_PRIVATE_DOMAIN_SUFFIX=railway.internal:8080
WEB_APP_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
AWS_REGION=${{convex-artifacts.REGION}}
AWS_ACCESS_KEY_ID=${{convex-artifacts.ACCESS_KEY_ID}}
AWS_SECRET_ACCESS_KEY=${{convex-artifacts.SECRET_ACCESS_KEY}}
S3_ENDPOINT_URL=${{convex-artifacts.ENDPOINT}}
S3_STORAGE_EXPORTS_BUCKET=${{convex-artifacts.BUCKET}}
S3_STORAGE_SNAPSHOT_IMPORTS_BUCKET=${{convex-artifacts.BUCKET}}
S3_STORAGE_MODULES_BUCKET=${{convex-artifacts.BUCKET}}
S3_STORAGE_FILES_BUCKET=${{convex-artifacts.BUCKET}}
S3_STORAGE_SEARCH_BUCKET=${{convex-artifacts.BUCKET}}
```

Treat the bucket access key and secret as credentials. Enter them through a
secure variable workflow if Railway does not resolve the bucket references in
your environment.

### Per-user Pi runtime

The production Pi configuration requires these values:

| Variable | Requirement |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | `8080` |
| `SERVICE_SHARED_SECRET` | Same value as Convex; at least 32 characters |
| `CONVEX_SITE_URL` | Public Convex origin with the exact `/http` path |
| `BOUND_ACTOR_ID` | Exact approved WorkOS subject for this runtime |
| `PI_AUTH_PATH` | `/data/auth.json` |
| `PI_CREDENTIAL_ENCRYPTION_KEY` | Independent secret of at least 32 characters |
| `PI_CREDENTIAL_KEY_VERSION` | Positive integer; provisioned as `1` |
| `PI_MODEL` | `gpt-5.6-terra` |
| `BROKER_MODE` | `robinhood` on the provisioned runtime |
| `LIVE_TRADING_ENABLED` | `false` |

The current Pi configuration also accepts these bounded operational values:

| Variable | Default |
| --- | --- |
| `GLOBAL_CONCURRENCY` | `4` |
| `RESULT_BATCH_WINDOW_MS` | `25` |
| `RESULT_BATCH_BYTES` | `16384` |
| `CONVEX_REQUEST_TIMEOUT_MS` | `10000` |
| `CONVEX_RETRY_ATTEMPTS` | `4` |
| `SHUTDOWN_TIMEOUT_MS` | `25000` |
| `ROBINHOOD_OAUTH_REDIRECT_URI` | `${CONVEX_SITE_URL}/broker/robinhood/callback` |
| `ROBINHOOD_OAUTH_CLIENT_ID` | Unset; use MCP dynamic client registration |

The provisioner also sets `CODEX_AUTH_MODE=device_code` and
`PI_AUTH_BOOTSTRAP=false`. `PI_AUTH_BOOTSTRAP=true` remains an operator recovery
path; it is not normal runtime configuration.

The official Robinhood MCP endpoint is fixed in the application. There is no
`ROBINHOOD_MCP_URL` runtime override. There is also no `PI_CREDENTIALS_PATH`.
Robinhood OAuth records are AES-256-GCM ciphertext in Convex, not files under
`/data`.

Keep `LIVE_TRADING_ENABLED=false`. The exact-order proposal and approval flow
remains the human review boundary even after Robinhood connects.

## Codex device bootstrap

Deploy each Pi runtime once with its unique `/data` volume attached. The missing
auth file keeps that runtime in a fail-closed bootstrap state while `/health`
remains available to Railway. Set `RUNTIME_SERVICE` to the actual service name.
Use `pi` for a rebound legacy service.

```sh
railway ssh \
  --project "$RAILWAY_PROJECT_ID" \
  --environment production \
  --service "$RUNTIME_SERVICE"
```

Inside that shell, run the login as the image's unprivileged `node` user:

```sh
runuser -u node -- env CODEX_AUTH_MODE=device_code \
  npm --prefix /app run auth:codex
exit
```

Open the displayed verification URL and enter its one-time code. Do not open,
print, copy, or export `/data/auth.json`. The Pi process detects the file and
starts the execution service. Verify the private runtime logs:

```sh
railway logs \
  --project "$RAILWAY_PROJECT_ID" \
  --environment production \
  --service "$RUNTIME_SERVICE" \
  --latest \
  --lines 100 \
  --filter "execution_service_listening"
```

The SSH sequence is preferred because the one-time device code appears only in
the operator's terminal instead of the shared service log stream. Repeat it for
each user runtime. Do not copy one user's `/data/auth.json` into another
runtime.

## Robinhood authorization handoff

The phone UI starts authorization through the user's bound Pi runtime. It keeps
the validated Robinhood authorization URL in memory and can open or copy it for
a desktop handoff. Initial Robinhood Agentic authorization can require a
desktop. The provider returns to:

```text
https://<convex-domain>/http/broker/robinhood/callback
```

Convex stores only the SHA-256 hash of the short-lived state mapping. It
atomically consumes that mapping, calls the correct actor-bound Pi runtime, and
redirects to `${WEB_APP_ORIGIN}/broker/connected` or
`${WEB_APP_ORIGIN}/broker/failed`. It never sends `code`, `state`, or tokens to
the browser.

### `convex-dashboard`

Set only:

```text
NEXT_PUBLIC_DEPLOYMENT_URL=https://<convex-api-domain>
```

Keep this service private. The Convex admin key is a release or administrative
credential and must not be placed on `web` or a Pi runtime.

## Convex function deployment

The preferred `release.sh` wrapper creates these temporary values in process
memory. `deploy.sh` uses them for the executable Convex function, index, and
schema deployment:

```text
CONVEX_SELF_HOSTED_URL=https://<convex-api-domain>
CONVEX_SELF_HOSTED_ADMIN_KEY=<temporary-admin-key>
```

`deploy.sh` requires both values, rejects conflicting Convex deployment
selectors, withholds raw CLI output, and synchronizes only
`WORKOS_CLIENT_ID`, `WORKOS_ALLOWED_USER_IDS`, `SERVICE_SHARED_SECRET`,
`EXECUTION_PRIVATE_DOMAIN_SUFFIX`, and `WEB_APP_ORIGIN` from Railway into the
function environment. Prefer `release.sh`. If you use the manual fallback, use
the hidden-input sequence in the safe workflow. Do not store the admin key in
Railway service variables, source files, or shell history. Unset both temporary
variables after a manual deployment.

## Variable setup without exposing values

Use Railway's standard-input form for secrets. The command below is a pattern.
Supply the value from a secure secret manager. Do not put a literal secret in
this repository.

```sh
printf '%s' "$SERVICE_SHARED_SECRET_VALUE" |
  railway variable set SERVICE_SHARED_SECRET --stdin \
    --project "$RAILWAY_PROJECT_ID" \
    --environment production \
    --service "$SERVICE_ID" \
    --skip-deploys \
    --json >/dev/null
```

For a key-presence audit, never print the JSON values:

```sh
railway variable list \
  --project "$RAILWAY_PROJECT_ID" \
  --environment production \
  --service "$SERVICE_ID" \
  --json | jq -r 'keys[]'
```

## Safety boundary

The known OTA project is `ota-chat-full` with project ID
`1385a1cf-7d70-4451-ad1f-eddf61832f69`. The scripts reject that name and ID.
They do not call `railway link`, `railway init`, `railway add`, `railway up`,
`railway domain`, `railway bucket`, or `railway volume` during preflight.

Do not run bootstrap, provisioning, or deploy until the target project name or
ID has been reviewed. These scripts intentionally perform Railway mutations
when the operator invokes them.
