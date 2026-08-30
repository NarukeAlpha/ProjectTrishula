# Signal Convex dashboard

This service runs the dashboard for the Signal self-hosted Convex deployment.
Keep it private. Do not create a Railway public domain for this service.

Set:

```text
NEXT_PUBLIC_DEPLOYMENT_URL=https://<convex-api-domain>
```

The Convex admin key is an administrative credential. Use it only through a
controlled release or local administration flow. Never place it on `web` or
`pi`, and never print it in deployment logs.
