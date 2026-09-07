# Railway GitHub deployment

`.railway/railway.ts` creates every code service and connects it to `NarukeAlpha/ProjectTrishula` on `master`. It is the canonical source for roots, Dockerfile builders, watch paths, health checks, and restart policies. `connect-github.sh` configures safe variable references only after it confirms that the live IaC has zero drift.

Run it after the repository has been pushed:

```sh
railway config plan
railway config apply
bash scripts/railway/connect-github.sh
```

Review the plan before applying it. The checked-in IaC preserves existing Railway variables without putting their values in Git. The variable script generates missing credentials through standard input so they do not appear in process arguments, then starts fresh source deployments. Railway then builds only the services whose watch paths match each later GitHub push.

Install and authenticate the Railway CLI first. The pinned `railway` npm dependency is the typed IaC SDK, not the CLI executable.

The script leaves `DISCORD_BOT_TOKEN` unset. Add that value in the Railway Discord service. It also changes Pi to `BROKER_MODE=mock` and keeps live trading disabled.

The `convex-functions` service derives a short-lived admin key from Railway's existing Convex instance secret during each deploy. It syncs the allowlisted WorkOS/service variables, the execution DNS suffix, and the newspaper owner binding. It then pushes the function package, clears the key from its process environment, and exposes `/health`. `MARKET_RESEARCH_OWNER_ID` references `pi.BOUND_ACTOR_ID`; `EXECUTION_PRIVATE_DOMAIN_SUFFIX` references the corresponding Convex backend variable.

Run `node scripts/railway/readiness.mjs` to check service versions and credential connections without printing secret values. Pass `--expected-commit FULL_GIT_COMMIT` after release to verify the deployed revision on every application service.
