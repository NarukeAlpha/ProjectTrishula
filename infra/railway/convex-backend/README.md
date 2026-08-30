# Project Trishula self-hosted Convex backend

This service runs the self-hosted Convex backend for Project Trishula.
The image is pinned to the tested Convex commit in `Dockerfile`.

Publish one Railway domain from this service on port `3210`:

- The domain root serves queries, mutations, actions, and WebSockets.
- The same domain with `/http` serves Convex HTTP Actions.

Set `CONVEX_CLOUD_ORIGIN` to the domain root and
`CONVEX_SITE_ORIGIN` to the same domain with `/http`. Keep Postgres, the
artifact bucket, the dashboard, and Pi on private Railway networking.

This service owns no Robinhood credentials and does not use the Pi `/data`
volume. The Pi volume attaches only to the private `pi` service.

Required runtime variable names are documented in the parent
[`Railway README`](../README.md). Do not put the temporary
`CONVEX_SELF_HOSTED_ADMIN_KEY` in this service's persistent variables.
