# Newspaper controls

The revised workflow is implemented locally. It needs a coordinated Convex,
Pi, and web deployment before the production page can use it.

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

## Verification

`npm run check` passed: 177 Convex, 312 Pi, 101 Discord, and 72 web tests,
plus formatter, lint, typechecks, builds, browser bundle checks, and four
deployment-source tests. The built-in browser verified the local demo layout
and the Scheduled-to-Schedule-now state change.

Deploy the matching backend before the web client: the previous Convex version
does not accept the new manual test request ID or the 10-setup limit. Production
deployment and live research/publication were not performed in this change.
The owner still selects the production forum and schedule.
