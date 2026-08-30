# Project Trishula web

This service is the phone-first control surface for Project Trishula. Railway builds the React and Vite application and serves it through Nginx.

The production application uses WorkOS AuthKit and one authenticated Convex connection. The browser never connects to Pi or Discord directly. It does not receive model credentials, Discord credentials, service secrets, or brokerage credentials.

## Active sections

- `/ask` and `/threads/:threadId` provide the existing authenticated chat workspace.
- `/discord` shows gateway health, Discord server and channel inventory, bot permissions, agent-loop state, and per-channel assignments.
- `/` redirects to `/ask`.

The active navigation does not expose the old overview, activity, brokerage, or Robinhood return routes. Their source files remain for archive history only.

## Discord channel roles

Each usable channel can have any of these roles:

- **Conversation monitor** reads messages and starts the serialized agent loop when research can help.
- **Reply target** receives the concise final response.
- **Research log** receives loop status or research traces without interrupting the main chat.

Convex owns the assignments. The page explains missing Message Content intent, channel visibility, message-history access, and send permission. It also shows messages waiting while a loop is already running.

The Discord application ID is public and can be exposed as `PUBLIC_DISCORD_APPLICATION_ID` to create the server-install link. The bot token belongs only on the Railway Discord service. The current Gateway integration does not use a Discord client secret or interactions public key.

## Local demo

The checked-in `public/config.js` enables deterministic demo mode.

```sh
npm ci
npm run validate
npm run dev
```

Demo mode does not mount WorkOS or Convex. Chat replies stay in browser memory. The Discord section shows the expected pre-configuration state and never attempts to connect to Discord.

## Railway runtime configuration

Create the web Railway service from this directory. Railway uses `Dockerfile` and checks `/healthz`.

Production requires these public variables:

| Variable                     | Example                                 | Purpose                                       |
| ---------------------------- | --------------------------------------- | --------------------------------------------- |
| `PUBLIC_DEMO_MODE`           | `false`                                 | Enables the WorkOS and Convex production path |
| `PUBLIC_CONVEX_URL`          | `https://convex.example.com`            | Public self-hosted Convex API                 |
| `PUBLIC_WORKOS_CLIENT_ID`    | `client_...`                            | Public AuthKit client identifier              |
| `PUBLIC_WORKOS_REDIRECT_URI` | `https://trishula.example.com/callback` | Registered AuthKit redirect URI               |

Optional variables:

| Variable                        | Default            | Purpose                            |
| ------------------------------- | ------------------ | ---------------------------------- |
| `PUBLIC_ENVIRONMENT`            | `staging`          | Deployment label                   |
| `PUBLIC_APPLICATION_NAME`       | `Project Trishula` | Browser title                      |
| `PUBLIC_APPLICATION_VERSION`    | `unknown`          | Deployment correlation value       |
| `PUBLIC_DISCORD_APPLICATION_ID` | unset              | Public Discord server-install link |
| `PUBLIC_WORKOS_API_HOSTNAME`    | `api.workos.com`   | Custom AuthKit hostname            |
| `PORT`                          | `8080`             | Nginx listener from Railway        |

All values above are public. Never add a WorkOS API key, Convex administrative key, Pi URL, service secret, Discord bot token, Discord client secret, model credential, or brokerage credential.

## Public Convex contract

`src/convex/functions.ts` uses typed public string references. The Discord surface expects:

- Query: `discord:getControlPlane`
- Mutation: `discord:setChannelRoles`

The control-plane query returns gateway health, Discord server and channel inventory, permission state, saved roles, and loop status. Role updates contain only `guildId`, `channelId`, and the complete deduplicated role set.

The chat surface keeps its existing thread, message, run, and command functions. The frontend does not import Convex internal actions or private service functions.
