# Railway GitHub deployment

`connect-github.sh` connects every code service to `NarukeAlpha/ProjectTrishula` on `master`, sets its monorepo root and watch path, and configures non-secret service references. Railway then builds matching services after each GitHub push.

Run it after the repository has been pushed:

```sh
bash scripts/railway/connect-github.sh
```

The script leaves `DISCORD_BOT_TOKEN` unset. Add that value in the Railway Discord service. It also changes Pi to `BROKER_MODE=mock` and keeps live trading disabled.

The `convex-functions` service derives a short-lived admin key from Railway's existing Convex instance secret during each deploy. It syncs the allowlisted WorkOS/service variables, pushes the function package, clears the key from its process environment, and then exposes `/health`.
