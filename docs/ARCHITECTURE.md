# Architecture

## Trust boundaries

The browser authenticates with WorkOS and calls public Convex functions. It never receives service credentials, the Discord token, or Pi Codex OAuth data.

The Discord gateway is a private Railway service. It holds `DISCORD_BOT_TOKEN` and connects to the Discord Gateway. It uses `CONVEX_DISCORD_SHARED_SECRET` for the Convex Discord endpoint and a separate `PI_DISCORD_SHARED_SECRET` for Pi's agent-only endpoint. Neither credential can authenticate brokerage, credential-vault, run, or order routes.

Convex is the source of truth for channel assignments, messages, processing watermarks, fenced leases, loop runs, recheck limits, and the Discord outbox. The gateway keeps a local active-channel set only to reduce duplicate calls. That set is not a lock.

Pi reads Codex OAuth from its mounted `PI_AUTH_PATH`. It creates a fresh session for each Discord stage. Triage and reply have no tools. Research receives only bounded public research tools. The Discord pipeline has no brokerage or order tools.

## Ordered processing

Each channel state stores the latest message sequence and the last successfully processed sequence. A claim advances through at most ten new messages and gives Luna the trailing ten messages at that watermark. A 25-message burst therefore becomes three ordered windows. Messages received during a run update Convex state but cannot acquire another lease.

The reply stage fetches the newest trailing ten messages after research. This lets it account for corrections and counterpoints posted while Sol worked.

Each channel lease has a fencing generation and expiry. Each delivery lease also has a token. Convex rejects stale heartbeats, completions, outbox writes, and delivery acknowledgements. Failed stages do not advance the processing cursor.

## Autonomous rechecks

The reply agent can request another pass. Convex permits at most two autonomous passes and rejects a recheck when the context hash did not change. Bot messages can remain in the conversation context, but they do not trigger a normal loop.

## Delivery

Convex creates idempotent outbox records before the loop completes. An optional research log is non-final. The concise reply is the final record. The Discord gateway sends with `allowedMentions.parse` empty and marks each record sent only after Discord returns a message ID. Convex completes the loop only after every queued record is sent. Delivery leases prevent two Railway replicas from sending the same pending record at the same time. A restart finalizes an acknowledged reply without sending it again.
