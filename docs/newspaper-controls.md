# Newspaper controls

The revised workflow is deployed. The control correction is live at web
`72478d8e5547df56f7972b0657f41e1b0c30ec54`, with build inputs matching tested
source `300f2cf6e5dcb50080e4322d92167ced049488ec`. Backend services retain the
coordinated release described in `RELEASE_READINESS.md`.

## Settings

- Forum and required forum tag, timezone, publish time, and weekend outlooks.
- Full editions only. No edition-style or automatic-publishing toggle.
- Up to 10 ranked setups from the existing configured primary watchlist.
  The list is not expanded or padded to reach 10.
- Data-provider selection is service-owned. Existing credentials, approval,
  cost limits, and runtime access are not changed by the form.
- Charts accompany positive primary-board TOP WATCH/WATCH setups with a score
  of at least 75 and no AT RISK/INVALIDATED thesis. The current chart limit is
  three. Missing chart access does not block the text edition.

## Actions

- **Save** stores the form. Changed settings need scheduling again.
  An unchanged active schedule stays active.
- **Test now** saves the current form, runs research immediately, and publishes
  a separate forum edition. It does not use the normal daily scheduled slot.
  Uncertain requests retain their ID in browser session storage through reloads
  and server changes; the backend deduplicates by owner, server, and request ID.
- **Schedule now** saves and schedules the current form. It becomes disabled
  **Scheduled** only after success. An edit makes it available again.

These are the only form actions, including when an edition fails or is queued.
Backend recovery APIs remain available internally; the form has no extra Retry,
Reconcile, or Cancel button.

## Verification

`npm run check` passed: 177 Convex, 312 Pi, 101 Discord, and 79 web tests,
plus formatter, lint, typechecks, builds, browser bundle checks, and four
deployment-source tests. The built-in browser verified the local demo layout
and Scheduled-to-Schedule-now state change, then the signed-in production form.

Convex, Pi, and Discord were deployed before the web client. The approved Convex
source-analysis/typecheck passed, and its generated API inventory is committed.
Pi and Discord both returned HTTP 200 from their readiness endpoints.

Live research/publication was not tested. The Exa credential already existed
in Pi's Railway secret store as `EXA_AI_KEY`, but the application expects
`EXA_API_KEY`. The existing value was copied securely through standard input
to the expected variable. The original variable remains preserved. No key value
belongs in source or documentation.

Activation is verified. The owner-approved Railway plan enabled
`MARKET_RESEARCH_ENABLED` on Pi and Discord with zero additions, two service
changes, and zero deletions. Both deployments succeeded at source commit
`81e66088a79f339fa3fb7f0483a9b4fe46ef38dc`. Live Pi `/health` returned HTTP 200
with research enabled, Exa configured, and the runner ready. A boolean-only
runtime check confirmed the expected key is present. Discord `/health` showed
research enabled and a connected gateway; `/ready` returned HTTP 200 and ready.

No Exa provider request or new forum edition was made. These checks do not prove
key validity or end-to-end research/publication. The owner's forum, timezone,
time, and inactive schedule remain unchanged. Numerical-provider approvals and
chart runtime access were not changed.
