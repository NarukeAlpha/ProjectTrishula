# Feature release readiness

Goal: finish the Discord personality and morning newspaper features, deploy them,
and verify that the owner can test them through the website and Discord.

## Current checkpoint

- Personality baseline: `9efca49`, committed locally; production still has the older chart release.
- Market research: recovering the missing temporary worktree into a persistent repository worktree.
- Both feature agents use persistent worktrees and must commit recovery and implementation milestones.
- The owner will select the newspaper forum. Do not create a forum automatically.
- Automatic newspaper publishing stays off during initial testing.

## Remaining release work

1. Recover or reconstruct the market-research feature and close the recorded audit defects.
2. Complete the personality checkpoint and restart test path with honest provider compatibility evidence.
3. Merge both features without losing durable delivery, owner boundaries, or existing control-page actions.
4. Run the root `npm run check` gate and inspect the combined diff.
5. Review the Railway plan and sync required runtime configuration without exposing secrets.
6. Deploy Convex, Pi, Discord, then web. Verify the deployed commit and internal readiness at each step.
7. Check website controls, preview behavior, forum permissions, and the private Discord testing route.
8. Record completed checks and any owner-selected activation gates here.

## Read-only deployment check

```sh
node scripts/railway/readiness.mjs
node scripts/railway/readiness.mjs --expected-commit FULL_GIT_COMMIT
```

The check reads linked Railway deployment and variable state. Its output contains
service versions, pass/fail results, and feature flags. It never prints credentials,
credential fingerprints, or owner IDs. A successful result does not replace a live
model or Discord delivery test.

## Activation gates

- The owner selects the newspaper forum and confirms the schedule timezone.
- A preview must state missing or unavailable market fields accurately.
- Enable a numerical provider only after its timestamp, session, coverage, and access checks pass.
- Keep opaque compaction disabled until the compatibility and continuation tests pass.
- Keep the existing research automation until the owner accepts the documented cutover criteria.
