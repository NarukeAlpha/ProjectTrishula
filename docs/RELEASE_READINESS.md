# Feature release readiness

Goal: finish the Discord personality and morning newspaper features, deploy them,
and verify that the owner can test them through the website and Discord.

## Current checkpoint

- The owner approved deployment and the Convex source-analysis upload. The full-edition newspaper workflow and pending integrated backend fixes are deployed. All service build inputs match tested source `72ec93d1d030c781f768de21e787c70dc4c2ff5c`.
- Railway reports `SUCCESS` for Convex functions and web at `ad5ee58e923c9e68d3a61ce28f4a6cc64f28b2ec`, Pi at `02b1a39ae91835cd18bf667e184f93c893916c38`, and Discord at `6d69b9f0c8c6f3c9f81c26adc8039525568e02c1`. The final all-service readiness and private credential-binding check passed.
- Pi `/health` returned HTTP 200 with execution and Discord agents ready. Discord `/ready` returned HTTP 200 and connected. The Convex deployer emitted its success marker. The approved code-generation dry run and typecheck passed; the exact generated API declarations are committed.
- The final root `npm run check` passed: 177 Convex, 312 Pi, 101 Discord, and 72 web tests (662 total), plus all four deployment-source tests, formatter, lint, typechecks, builds, and bundle checks.
- The built-in browser verified the signed-in production form: fixed full editions, up to 10 ranked setups, positive-ranked-setup charts, regular forum/time/weekend settings, and Save/Test now/Schedule now. The owner has selected `#ttrrrr`, `America/New_York`, and 08:00 for Stardust. The schedule remains off. No form save, research test, publication, or schedule action was triggered during deployment verification.
- The deployed gateway shows the existing private conversation at epoch zero with no pending messages and a completed loop. No duplicate QA mention or memory reset was issued. Final Discord message delivery was not independently verified in this release check.
- Deployment is complete, but newspaper research is not operational: Pi has no `EXA_API_KEY`; Pi and Discord `MARKET_RESEARCH_ENABLED` remain false. Existing credentials, cost/approval gates, compaction switches, infrastructure, and any staged Railway changes were preserved. The unmerged market/personality follow-up branches were not included.

## Pre-deployment checkpoint

- The simplified newspaper configurator remains live at web `4ba745f`. The earlier authenticated desktop/phone checks passed. A fresh browser session currently requires WorkOS sign-in; no production form values were changed.
- Pi release `3633f794cf4908517a3680b26e84646f956e5f54` is `SUCCESS` in Railway deployment `d1649d45-65aa-4caa-a99e-e97165df279f`. Its build inputs match tested integration source `a79c7dfcc7188cf74bc80d28d6d29ba8ca18aa69`; private binding checks passed. The research health aggregation fix is included.
- The live native probe now accepts the compaction artifact from the authoritative stream. It then fails in `same_process_continuation` before a second instrumented network request. No continuation, process restart, durable restore, long-context savings, or native attestation is proven. The optional terminal output check was removed only after reviewing the [official Codex collector](https://github.com/openai/codex/blob/f3f53ee949eeaa9b6050699a783b94fe4ee8ff0d/codex-rs/core/src/compact_remote_v2.rs#L422-L484); streamed item, ordering, usage, and identity checks remain.
- Publication telemetry is integrated at `7cfeb1cfd0235a793b67faef1c866344032572e8`, but is not deployed. It records safe send/reconciliation/chart durations and outcomes, retries, and accepted versus rejected database acknowledgments. Neither synchronous nor asynchronous log-sink failures can change delivery. A Discord send is not labeled a published edition.
- The complete `npm run check` at `7cfeb1cfd0235a793b67faef1c866344032572e8` passed 628 application tests: Convex 161, Pi 299, Discord 101, web 67. All four deployment-source checks, formatting, lint, typechecks, builds, and bundle checks passed.
- Convex resume-revision and epoch-zero fixes, the corresponding Discord recovery, and newer market-research recovery changes await deployment. Approval review rejected the source-analysis upload before execution; do not retry or deploy the pending Convex source without explicit owner approval. Recover the existing private QA mention after that deployment, rather than resetting or reposting it.
- The market branch has committed recovery-budget, cancellation, session-freshness, and structured numerical-grounding corrections through `904a01f`. Further clause/timeframe and exchange-session review corrections are in progress before integration. Runtime analytics, full research metrics, and live newspaper validation remain incomplete.
- The owner still chooses the forum and timezone. The last verified live Pi has no Exa credential, and Pi/Discord research runtimes remain off. No runtime activation, schedule change, forum selection, backup change, or pre-existing Railway staged change was applied.
- Both Pi and Postgres volumes are ready but have no user-visible backups. Key rotation, provider-held backup erasure, and the separate artifact-bucket protection boundary remain unverified. Portable and native activation gates remain unresolved.

## Earlier integration checkpoints

- The simplified newspaper configurator is live and browser-verified at web `4ba745f`. The remaining checks below are feature-release work, not unfinished UI changes.
- A private Discord mention exposed a fresh-conversation epoch mismatch. The fix is committed at `e9529ec`: Convex accepts epoch zero throughout a turn, and the Discord outbox restores epoch-zero replies. Production deployment of this fix is pending the owner approval described below. Do not reset the server conversation to work around it.
- The full gate at `358818029c285847bdacffe4c3d8051200e9fae2` passed 600 application tests: Convex 161, Pi 288, Discord 84, and web 67, plus four deployment-source tests, formatting, lint, typechecks, builds, and bundle checks. The fresh-conversation regression exercises real claim and heartbeat handlers. A large-history test hit its unchanged five-second limit during intermediate parallel runs; a redundant test-adapter scan was removed, and the final normal full gate passed without increasing timeouts.
- Pi native-compaction source is deployed at `f618911`. The first synthetic native probe failed with `provider_request_failed`; no native artifact or attestation was produced. Probe-only transport diagnostics are integrated at `2861ece` and deployed from `17f85a3`: Railway deployment `93c72c14-8ae5-4ed4-88b0-a638479a7b71` succeeded, with exact Pi build inputs and readiness verified. The Pi follow-up passed 287 tests, typecheck, build, and lint. Its live probe still reports `provider_request_failed`, with zero requests seen by the instrumented fetch hook. SDK-path diagnosis is in progress; this is not evidence of an HTTP rejection.
- The zero-fetch cause was Pi 0.84.1's own `prompt_cache_key: undefined` property before JSON serialization. The adapter now omits that single unset property, with an actual pinned-provider non-network regression. Pi `5d2ea6403ffc110545c88a1341d13e6b9cf3d483` deployed successfully (`1b30c4e1-f821-4ce1-b4af-a3561436e34c`) and matches tested source `ff9f6e25a348d2c95aefd76a20f2d26e18d4bdb6`. Its live native probe reached the Codex endpoint once and returned HTTP 200, but strict stream validation reported `response_invalid`. Content-Type was absent, but neither parser requires it; that absence is not the rejection cause. Native artifact validation and same-process/fresh-runtime continuation remain unproven. No native attestation or runtime activation was applied.
- The Convex resume-revision fix and the fresh-conversation fix remain local. Approval review rejected a backend source-analysis upload before execution. Do not retry that upload or deploy the pending Convex source until the owner approves the source upload.
- Content-free stream diagnostics are deployed at Pi `03ed7f504cd8bdfef349fab34781783eac9fa649` (Railway `f8afb2a3-c648-42b1-8937-bf9876db567b`, `SUCCESS`). Exact Pi build inputs match `c79420306dc2e36093b805ba30008ca454fd10ae`. The full gate at that integration source passed 603 application tests and four deployment-source checks. The live synthetic probe read five data events, including one created event, one compaction output item, and one completed event. Strict validation failed with `terminal_output_mismatch`. No raw response, artifact, IDs, or provider text was logged. The terminal linkage contract is under review; native continuation and attestation remain unproven.
- The Pi health fix at `28224da4136b4e989024b4ea01b4d7c5a2d06667` requires Exa, a ready runner, and a job registry when research is enabled. Disabled research does not affect core readiness. This local follow-up passed 296 Pi tests, typecheck, build, and lint; it is not deployed yet.
- The complete repository gate at `01f73baa921a5c955e5abef449f0eef2cfa92330` passed 608 application tests (Convex 161, Pi 296, Discord 84, web 67), all four deployment-source checks, formatter, lint, typechecks, builds, and bundle checks. A fresh browser tab now shows the WorkOS sign-in page; this does not repeat or replace the earlier authenticated form QA, and no sign-in or form mutation was performed.
- Read-only Railway backup checks found no user-visible backups for either the Pi or Postgres volume. Both panels say backups and point-in-time recovery require the Pro plan. Volumes are ready, but key rotation and platform-internal backup erasure remain unverified. No plan, backup, or pre-existing staged Railway change was modified.
- Stardust now has a forum named `ttrrrr`, but the owner has not selected it in the website. Do not select it for them. Exa access and runtime activation decisions remain pending.
- The market-research audit identified recovery-budget, cancelled-dispatch reuse, freshness, and numerical-grounding defects. The market agent is implementing and testing bounded corrections before another release. Do not treat the earlier passing suite as coverage of these newly identified cases.
- Both feature baselines are integrated and deployed through GitHub-connected Railway builds. Follow-up fixes and native compaction verification are still in progress.
- Market research was recovered in `0ef9711`; 63 changed files were restored from successful historical patches.
- Both feature agents use persistent worktrees and must commit recovery and implementation milestones.
- The owner will select the newspaper forum. Do not create a forum automatically.
- Automatic newspaper publishing stays off during initial testing.
- Runtime feature switches are not the same as the per-server schedule. The owner objected to the extra runtime switches; the exact default change remains pending. Do not label a disabled research runtime ready for testing.

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
- The cost-ledger Convex follow-up deployed successfully at `2c6edd4`. The Pi summary/cost follow-up deployed successfully at `40770cb`.
- The portable-summary live retry passed at `40770cb`: one synthetic source reference, 764 serialized bytes, 100 estimated input tokens, and 263 estimated summary tokens. The negative savings on this tiny fixture are expected; this proves schema compatibility, not long-history savings or a production checkpoint activation.
- Native-compaction audit found predecessor identity, source-lineage, terminal-stream, usage-evidence, and portable-fallback defects. Those fixes and Convex native persistence are in progress. No live native attestation has been issued.
- The owner reported unstyled newspaper controls. The responsive fix passed all 59 web tests and the web format/lint/typecheck/build/bundle gates. Built-in browser checks at 834-pixel desktop and 390-pixel phone widths showed aligned labels, contained controls, and no horizontal overflow. Console warnings/errors were empty. The UI-only fix is pushed at `90f28de`; deployment verification is pending.
- The Railway plan after adding preservation for the native live-probe attestation reported no drift. No feature switch was enabled.
- The spacing deployment succeeded at `90f28de`. The follow-up newspaper simplification is live at `4ba745f700b6213f1af9d8f9f7dd05732f97a616` (Railway deployment `55f84b0c-a807-458e-8988-d036251c1ccd`, `SUCCESS`). Exact web build inputs match tested root source `46f8e988918d4125d18b4cfb20879664baedb469`.
- Newspaper settings now use one chart choice (Off/1/2/3), explicit timezone selection without a second confirmation control, and two schedule checkboxes. Provider and ranked-setup limits are under a closed Advanced disclosure. Existing saved values, forum ownership, and service activation checks are preserved.
- The simplified form passed built-in browser checks at 1280-pixel desktop and 390-pixel phone widths without horizontal overflow. The authenticated live control panel shows the new controls and 44-pixel inputs. No forum, schedule, or other production setting was changed during QA.
- The full root `npm run check` passed at `46f8e988918d4125d18b4cfb20879664baedb469`: Convex 145, Pi 282, Discord 76, and web 67 tests (570 total), plus four deployment-source tests, formatting, lint, typechecks, builds, and bundle boundaries. The final native adapter/rejection audit found no remaining concrete static blocker for deployment with compaction disabled.
- Native persistence is deployed in Convex at `b9c207e`. The resume-revision invalidation fix and native Pi/Discord follow-ups remain to be deployed. No native live probe or attestation has run.
- A deployed Convex codegen dry run previously exited successfully and reported that `_generated/api.d.ts` would change. The follow-up debug analysis upload was denied by approval review before execution. Do not retry that upload without explicit owner approval; generated-inventory normalization remains pending.

## Remaining release work

0. With owner approval, deploy the Convex and Discord epoch-zero fixes and verify recovery of the existing private QA mention. Do not post another duplicate QA message. The gateway ingested the mention, but the old HTTP validators reject the turn before the model runs.
1. Finish the native compaction adapter, persistence, and synthetic continuation/restart verification.
2. Newspaper spacing and simplified controls are deployed and verified. The portable-summary retry and durable cost-ledger follow-up are also complete.
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
