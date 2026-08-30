# Signal web

Signal is a phone-first React and Vite trading copilot. Railway builds the static application and serves it through Nginx.

Production mode uses WorkOS AuthKit and one authenticated Convex connection. The browser never calls Pi or a brokerage service directly. It sends narrow commands to Convex and renders canonical thread, message, run, and tool-event state.

Demo mode is a deterministic local product preview. It does not mount WorkOS or Convex. Demo connection changes, portfolio values, chat replies, and trade decisions stay in browser memory. No demo action can place an order.

## Local demo

The checked-in `public/config.js` enables demo mode.

```sh
npm ci
npm run validate
npm run dev
```

Open the Vite URL. The demo supports primary navigation, a fixed prompt reply, connection changes, and simulated approval and rejection decisions.

## Railway runtime configuration

Create one Railway service from this directory. Railway uses `Dockerfile` and checks `/healthz`.

Production requires these public variables:

| Variable                     | Example                               | Purpose                                       |
| ---------------------------- | ------------------------------------- | --------------------------------------------- |
| `PUBLIC_DEMO_MODE`           | `false`                               | Enables the WorkOS and Convex production path |
| `PUBLIC_CONVEX_URL`          | `https://convex.example.com`          | Public self-hosted Convex API                 |
| `PUBLIC_WORKOS_CLIENT_ID`    | `client_...`                          | Public AuthKit client identifier              |
| `PUBLIC_WORKOS_REDIRECT_URI` | `https://signal.example.com/callback` | Registered AuthKit redirect URI               |

Optional variables:

| Variable                     | Default          | Purpose                            |
| ---------------------------- | ---------------- | ---------------------------------- |
| `PUBLIC_ENVIRONMENT`         | `staging`        | Deployment label                   |
| `PUBLIC_APPLICATION_NAME`    | `Signal`         | Browser title                      |
| `PUBLIC_APPLICATION_VERSION` | `unknown`        | Deployment correlation value       |
| `PUBLIC_WORKOS_API_HOSTNAME` | `api.workos.com` | Custom AuthKit hostname            |
| `PORT`                       | `8080`           | Nginx listener supplied by Railway |

Set `PUBLIC_DEMO_MODE=true` to deploy the isolated demo. WorkOS and Convex variables are not required in that mode.

All values above are public. Never add WorkOS API keys, Convex administrative keys, Pi URLs, service secrets, brokerage credentials, brokerage tokens, cookies, model keys, or database credentials.

Register the exact WorkOS redirect URI and application origin with WorkOS. Configure the WorkOS Sign-in URL as the public `/login` route. Keep the WorkOS callback at the URI in `PUBLIC_WORKOS_REDIRECT_URI`, normally `/callback`.

Register `https://<convex-site-domain>/http/broker/robinhood/callback` as the separate Robinhood OAuth redirect URI. The public Convex callback consumes the one-time OAuth response and redirects to the web app at `/broker/connected` or `/broker/failed`. Those public result pages do not read OAuth parameters and scrub any unexpected query string or fragment before paint. The legacy web route `/broker/callback` always scrubs its URL and redirects to `/broker/failed`. Do not use the WorkOS callback path for Robinhood.

The connect action returns a validated `https://robinhood.com` authorization URL. The browser keeps that URL only in React component memory and shows controls to open or copy it for desktop handoff. It never stores the URL or exchanges a Robinhood code.

## Public Convex contract

`src/convex/functions.ts` contains typed string references for these browser functions:

- Queries: `threads:list`, `threads:get`, `messages:listPage`, `runs:getActive`, `commands:get`, and `trading:getDashboard`.
- Mutations: `commands:submitPrompt`, `commands:retryRun`, `commands:requestStop`, `threads:rename`, `threads:archive`, and `trading:rejectProposal`.
- Actions: `trading:startRobinhoodConnection`, `trading:disconnectRobinhood`, `trading:refreshPortfolio`, and `trading:approveProposal`.

The frontend does not import the generated Convex server API. It cannot import internal actions, result ingestion functions, or private Pi service calls by accident.

The active-run query supplies the temporary contiguous event window used for streaming. A terminal Convex transaction supplies the canonical assistant message and run state together. The UI then stops rendering temporary batches.

## Browser boundary

Nginx allows browser connections only to Signal, WorkOS, and the public Convex HTTPS and WebSocket origins. It sends `Referrer-Policy: no-referrer`, including on the OAuth handoff. The bundle check rejects administrative keys, service secrets, private service URLs, and common brokerage secret names.
