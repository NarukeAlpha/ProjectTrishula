# Phone Trading POC Architecture

## Decision

Build a phone-first web application with three separated application modules on Railway:

1. `web` for the mobile interface and WorkOS sign-in.
2. `convex` for canonical data, commands, realtime state, approvals, and audit records.
3. `pi` for agent execution and the user-scoped Robinhood MCP bridge.

Reuse the direct command pattern from OTA Chat: the browser writes durable intent to Convex, Convex calls Pi over the private network, Pi writes ordered results to Convex, and the browser observes Convex subscriptions.

## Traffic flow

```text
Phone browser
  | WorkOS sign-in
  v
web (public Railway service)
  | authenticated queries, mutations, and subscriptions
  v
Convex (canonical state and command gateway)
  | trusted actorId + runId + service authentication
  v
pi (private Railway service)
  | actor-scoped credential lookup; token stays outside model context
  v
Robinhood hosted Trading MCP
  https://agent.robinhood.com/mcp/trading
```

The WorkOS login and Robinhood connection are separate authentication flows. A WorkOS session proves who is using this application. A Robinhood OAuth grant authorizes access to that person's brokerage connection. Never forward the browser's WorkOS token as a Robinhood credential.

## Identity and credential mapping

Use the immutable WorkOS subject as the application actor key. Convex derives this key from a validated identity. Convex then sends the actor key to Pi only through an authenticated service request.

Store only connection metadata in Convex:

- actor ID
- provider name
- connection status
- granted scopes when discoverable
- non-secret vault object reference
- creation, refresh, expiry, disconnect, and failure timestamps

Store Robinhood access and refresh credentials only in Pi's actor-scoped encrypted store. The Railway POC uses AES-256-GCM records under the private `/data` volume. Each filename is a hash of the WorkOS subject, each decrypted record is checked against that subject, and the encryption key is a separate Pi-only Railway secret. Convex stores connection metadata only. A production release should move this boundary to a managed vault without changing the actor-to-connection contract.

Pi model authentication is separate again. The service uses Pi's
`openai-codex` provider with a dedicated ChatGPT subscription OAuth grant stored
at `/data/auth.json`. It does not read, copy, or deploy Codex Desktop's local
credential file. One model grant serves the private Pi process; each Robinhood
grant remains isolated by WorkOS actor.

## Pi and MCP boundary

Pi does not receive "all credentials related to the user." It receives a trusted actor ID and a short-lived internal capability for one approved operation. The credential-broker module resolves that actor to an encrypted connection, calls the fixed Robinhood MCP endpoint, and returns a redacted typed result.

Do not expose a generic MCP proxy. Pin the upstream hostname. Discover and validate the MCP tool list. Then publish a smaller application allowlist.

Initial read allowlist candidates are:

- `get_accounts`
- `get_portfolio`
- `get_equity_positions`
- `get_equity_quotes`
- `get_equity_orders`

The implementation validates that every upstream call is in this list and
checks the discovered Robinhood tool list before invoking it. It does not
guess a mutation tool name. Real placement fails closed until the authenticated
server's mutation name and input schema are captured and reviewed.

## Trade approval state machine

Mock order placement exercises the complete approval state machine without a
broker request. Real order placement is a later gated slice.

```text
draft -> reviewed -> awaiting_user_confirmation -> approved -> submitting
      -> rejected                         |             |
                                         +-> expired   +-> submitted -> terminal
```

Bind one approval to all of these values:

- WorkOS actor ID
- Robinhood connection and target account
- instrument and side
- quantity or notional
- order type and limit or stop values
- review response and quote timestamp
- order fingerprint and idempotency key
- short expiry time

Any changed value requires a new review and confirmation. Pi cannot approve its own order. A retry with the same idempotency key must not place a second order.

## Live-data rule

Robinhood documents real-time quote and market-data tools. The hosted MCP documentation does not promise a continuous streaming feed. Treat MCP quotes as timestamped snapshots until live behavior is measured. Convex records provider timestamps and marks stale data. Do not label delayed or stale data as live.

## Railway shape

The three application modules do not mean only three Railway resources. A production-like self-hosted Convex setup normally expands to:

- public `web`
- public Convex API backend
- private Convex dashboard
- private `pi`
- Railway Postgres for Convex
- Convex artifact bucket

Keep Pi private. If Robinhood OAuth needs a public callback, terminate it in the web service and forward a one-time code over Railway private networking. Do not publish Pi's run endpoints.

## Rollout gates

1. Foundation: mobile shell, WorkOS identity, Convex schema, and mocked Pi tool contract.
2. Read-only MCP: one user, encrypted connection, accounts, portfolio, positions, and timestamped quotes.
3. Multi-user isolation: prove that actor A cannot list, decrypt, invoke, or observe actor B's connection or results.
4. Review-only orders: enable review tools and store exact order fingerprints. Do not place orders.
5. Real placement: require Robinhood's written authorization for this licensee product, a dedicated Agentic account, explicit phone confirmation, idempotency, limits, and a tested disconnect path.

Robinhood states that its official MCP can read data across the user's Robinhood accounts but can place trades only in the dedicated Agentic account. Robinhood also states that Agentic account creation and agent authentication initially require a desktop device. Plan for phone use after desktop onboarding.

## Sources

- [Robinhood Agentic Trading overview](https://robinhood.com/us/en/support/articles/agentic-trading-overview/)
- [Robinhood Trading with your agent](https://robinhood.com/us/en/support/articles/trading-with-your-agent/)
- [Robinhood third-party connections](https://robinhood.com/us/en/support/articles/third-party-connections/)
- [Robinhood Customer Agreement](https://cdn.robinhood.com/assets/robinhood/legal/Robinhood-Customer-Agreement.pdf)
- [WorkOS Vault quick start](https://workos.com/docs/vault/quick-start)
