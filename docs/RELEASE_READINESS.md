# Feature release readiness

Goal: finish the Discord personality and morning newspaper features, deploy them,
and verify that the owner can test them through the website and Discord.

## Current checkpoint

- Both feature baselines are integrated and deployed through GitHub-connected Railway builds. Follow-up fixes and native compaction verification are still in progress.
- Market research was recovered in `0ef9711`; 63 changed files were restored from successful historical patches.
- Both feature agents use persistent worktrees and must commit recovery and implementation milestones.
- The owner will select the newspaper forum. Do not create a forum automatically.
- Automatic newspaper publishing stays off during initial testing.
- Runtime feature switches are not the same as the per-server schedule. The owner requested enabled, testable features; do not label a disabled research runtime ready for testing.

## Live checks on 2026-09-07

- Existing Railway deployments are healthy. Web is sleeping under Serverless.
- Pi and Discord owner binding, private routing, and all dedicated service credential pairs match.
- Pi `/health` returns HTTP 200 with both execution and Discord agents ready.
- Luna `gpt-5.6-luna` with `xhigh` and requested `priority` completed a synthetic `READY` call in 1,772 ms (29 total tokens).
- Sol `gpt-5.6-sol` with wire effort `max` and requested `priority` completed the same test in 1,633 ms (25 total tokens).
- The Codex endpoint rejects wire effort `ultra`; its accepted enum ends at `max`. The personality adapter must map the product's ultra preset to wire `max` before deployment.
- These checks prove request acceptance, not a separately measured guarantee of priority scheduling.
- Exa configuration is absent from the running Pi service. The owner was asked to add `EXA_API_KEY` through Railway.
- Stardust has `testing-bot` but no forum. The owner chose to select the newspaper forum themselves.
- Applied the owner's approved Railway model, request-limit, and Convex owner/private-host settings. The revised plan excluded all feature on/off switches and preserved current Serverless behavior.
- The integrated Convex, Pi, and Discord suites passed 106, 236, and 65 tests at the compatibility checkpoint. Final feature commits still require the combined full gate.
- Updated the MCP SDK to `1.26.0` and the existing transitive `fast-uri` and `qs` dependencies. The Pi package-manager audit reports zero vulnerabilities at this checkpoint.
- The full integrated `npm run check` passed at `b7621e6`: 479 app tests and four deployment-source tests, plus formatting, lint, typechecks, builds, bundle boundaries, and Railway validation. This is a checkpoint, not final release evidence; the subsequent audit identified replay-count and checkpoint-attribution defects for correction.
- Built-in browser demo checks passed at desktop and 390-pixel phone width. Content width equals viewport width; reset confirmation opens and cancels; console error/warning list is empty. Live owner settings testing still needs a WorkOS sign-in.
- The integrated source is backed up on `codex/feature-release-integration`. This branch does not trigger production deployment.
- A single live CHART-IMG request from the Discord service returned HTTP 200 and a valid 800 by 600 PNG (47,215 bytes). It did not publish to Discord. This proves provider access, not the full newspaper attachment-delivery path.
- The checkpoint-attribution fixes passed the complete gate at `247c933`: 482 app tests and four deployment-source tests. The numerical adapter and evaluation CLI then passed all 258 Pi tests, typechecking, and build after integration.
- The provider adapter now requires a matching saved provider selection, an explicit runtime owner decision, and a cost cap. This is implemented but not live-evaluated; Exa access and the configured-time evaluation are still required.
- A read-only Railway plan after the approved configuration apply reported no drift.
- First staged release succeeded: Convex `67b45c5`, Pi `e0a3d21`, Discord `0bff563`, web `652fbb1`. Build-tree comparison verified each against the tested integration source. The Convex deployer emitted its explicit successful function-deployment marker.
- The deployed Pi passed nine synthetic Luna naturalness checks through the existing Codex OAuth. All produced concise direct replies and passed deterministic surface checks. No Discord messages or Convex records were created.
- Both the legacy and new deployed Discord clients successfully read context from the upgraded Convex backend. Only the message count was reported. The new gateway returned `/ready` HTTP 200, connected to two servers.
- The first live portable-summary probe failed schema validation. The summary prompt omitted the schema for array items. A generated JSON Schema and regression test are implemented; live retry is pending deployment. Portable summaries have not been enabled in production.
- The full gate passed at `1ac6215`: 521 app tests and four deployment-source tests. It includes durable Exa cost events and the summary-prompt fix. A subsequent Pi-only spending-cap fix requires the final combined gate.
- A second owner question asks whether newspaper/chart runtimes should default on while per-server schedules stay off. The approval check rejected changing these defaults without explicit authorization. No such default change was committed or applied.

## Remaining release work

1. Finish the native compaction adapter, persistence, and synthetic continuation/restart verification.
2. Deploy and rerun the portable-summary live probe; integrate the durable cost-ledger follow-up.
3. Preserve durable delivery, owner boundaries, and existing control-page actions through the final checkpoints.
4. Run the root `npm run check` gate and inspect the combined diff.
5. Review the Railway plan and sync required runtime configuration without exposing secrets.
6. Deploy Convex, Pi, Discord, then web. Verify the deployed commit and internal readiness at each step.
7. Check website controls, preview behavior, forum permissions, and the private Discord testing route.
8. Record completed checks and any owner-selected activation gates here.

## Read-only deployment check

```sh
node scripts/railway/readiness.mjs
node scripts/railway/readiness.mjs --expected-commit FULL_GIT_COMMIT
node scripts/railway/readiness.mjs --expected-source FULL_GIT_COMMIT
node scripts/railway/readiness.mjs --service pi --expected-source FULL_GIT_COMMIT
node scripts/railway/readiness.mjs --require-market-research
```

The check reads linked Railway deployment and variable state. Its output contains
service versions, pass/fail results, and feature flags. It never prints credentials,
credential fingerprints, or owner IDs. A successful result does not replace a live
model or Discord delivery test.

Use `--expected-source` after a staged release. It verifies that each deployed
service has the same Docker build inputs as the target commit. GitHub watch paths
can leave services on different commit IDs even when their code is current. The
check fails if a required Git object is not available locally.

The market-research requirement fails if its Pi runtime, Discord publisher, or
Exa credential is unavailable. Passing infrastructure checks alone does not make
the newspaper ready. Per-server automatic scheduling remains a separate setting.

## Activation gates

- The owner selects the newspaper forum and confirms the schedule timezone.
- A preview must state missing or unavailable market fields accurately.
- Enable a numerical provider only after its timestamp, session, coverage, and access checks pass.
- Keep opaque compaction disabled until the compatibility and continuation tests pass.
- Keep the existing research automation until the owner accepts the documented cutover criteria.
