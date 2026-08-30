# Project Trishula on Railway

The current deployment guide is [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md).

Project Trishula uses separate Railway services for the web app, Pi, Discord gateway, self-hosted Convex backend, Convex dashboard, and Convex function deployer. GitHub pushes to `NarukeAlpha/ProjectTrishula` build only the services whose watch paths changed.

Run the source connector and apply the checked-in Railway IaC after the first GitHub push:

```sh
bash scripts/railway/connect-github.sh
railway config plan
railway config apply
```

Keep `DISCORD_BOT_TOKEN` in the Discord service variables. Pi remains in mock brokerage mode with live trading disabled. The current Discord research pipeline does not use Robinhood credentials or order tools.
