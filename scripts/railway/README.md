# Railway GitHub deployment

`connect-github.sh` creates any missing code service, configures safe variable references, and connects every code service to `NarukeAlpha/ProjectTrishula` on `master`. The canonical roots, Dockerfile builders, watch paths, health checks, and restart policies live in `.railway/railway.ts`.

Run it after the repository has been pushed:

```sh
bash scripts/railway/connect-github.sh
railway config plan
railway config apply
```

Review the plan before applying it. The checked-in IaC preserves existing Railway variables without putting their values in Git. Railway then builds only the services whose watch paths match each GitHub push.

The script leaves `DISCORD_BOT_TOKEN` unset. Add that value in the Railway Discord service. It also changes Pi to `BROKER_MODE=mock` and keeps live trading disabled.

The `convex-functions` service derives a short-lived admin key from Railway's existing Convex instance secret during each deploy. It syncs the allowlisted WorkOS/service variables, pushes the function package, clears the key from its process environment, and then exposes `/health`.
