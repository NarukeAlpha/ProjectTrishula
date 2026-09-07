# Discord personality rollout readiness

Evidence date: 2026-09-07

This record separates verified build evidence from live gates. It does not authorize a Discord post, a deployment, or a trading action.

## Ready for staged owner testing

The durable Luna and isolated Sol pipeline is ready for a staged deployment with both compaction flags off. The portable checkpoint path is code-complete and opt-in. It is not approved for production activation yet.

Verified implementation evidence:

- `npm run check:personality` passes without a user login, provider call, or Discord delivery.
- The deterministic run covers 46 Pi tests, 32 gateway tests, and 45 Convex tests.
- The fixture replay runs each routing case three times.
- The synthetic restart fixture preserves author attribution, an accepted correction, an unresolved question, freshness, and the recent raw tail.
- Portable generation uses a fresh Luna session with no tools. Pi accepts only typed summaries whose source-event IDs and author IDs occur in the supplied canonical evidence or prior validated summary.
- Convex activates a checkpoint only after revision, epoch, owner binding, generation, routing generation, source hash, source references, exact recent-tail IDs, size, and token-accounting checks pass.
- The trigger uses the pinned 272,000-token model window. The threshold is 190,400 estimated tokens. The retained recent tail is contiguous and targets 20,000 estimated tokens.
- Native opaque compaction is still hard false. The pinned Pi provider has no tested direct bridge to the official opaque compact-response item.

## Live evidence captured by the deployment owner

The owner ran these synthetic OAuth probes against the deployed Pi service on 2026-09-07. They did not use Discord delivery.

| Probe | Result | Evidence |
| --- | --- | --- |
| Pi health | Pass | HTTP 200; executor and Discord agents reported ready |
| Luna transport | Pass | `gpt-5.6-luna`, `xhigh`, `priority`; `READY` in 1,772 ms |
| Sol transport | Pass | `gpt-5.6-sol`, `max`, `priority`; `READY` in 1,633 ms |
| Sol literal `ultra` | Fail as expected | Provider rejected `ultra`; accepted values ended at `max` |

The probes used a 512-token output cap and only synthetic `READY` input. They prove OAuth and transport compatibility. They do not prove research quality, naturalness, checkpoint continuity, or production latency.

After building the Pi package, run these commands inside the Pi service shell. They use the service-owned OAuth file. They do not require a user login and do not call Discord.

```sh
PERSONALITY_PROBE_MODE=naturalness PERSONALITY_PROBE_REPETITIONS=3 npm run probe:personality
TRISHULA_PORTABLE_CHECKPOINTS_ENABLED=true PERSONALITY_PROBE_MODE=checkpoint npm run probe:personality
```

The first command makes nine pinned Luna calls across simple, informal, and correction fixtures. It prints only synthetic replies and deterministic surface findings. The second starts a transient probe process with the portable flag enabled; it does not change the running service configuration or write a Convex checkpoint.

## Required gates before portable activation

Keep `TRISHULA_PORTABLE_CHECKPOINTS_ENABLED=false` in Pi and the Discord gateway until every row passes.

| Gate | Status | Required evidence |
| --- | --- | --- |
| Convex storage protection | Blocked | Confirm acceptable encryption at rest, rotation, backup deletion, and tenant controls, or add application-layer authenticated encryption and its tests |
| Live long-context generation | Not run | Cross 190,400 estimated tokens in a noncritical synthetic guild and capture one valid checkpoint |
| Same-process continuation | Not run | Answer seeded facts, correction, unresolved question, and freshness after activation |
| Full Pi restart | Not run | Restore the same facts and attribution from Convex only |
| Failure fallback | Not run | Inject provider failure and stale compare-and-set; retain the prior checkpoint and raw context without a visible failure |
| Quality and savings | Not run | Record recall, source grounding, input/output tokens, estimated cost, and latency against the non-compacted baseline |
| Blind naturalness review | Not run | Score the fixture pairs with the section 16 rubric; deterministic surface checks alone are not a human rubric score |

## Required gates before any Discord pilot

- Run the full root `npm run check` command on the exact deployment commit.
- Deploy in order: Convex, Pi, Discord gateway, then web.
- Keep `TRISHULA_NATIVE_COMPACTION_ENABLED=false`.
- Keep `TRISHULA_PORTABLE_CHECKPOINTS_ENABLED=false` for the first noncritical guild pilot.
- Verify one direct reply, one researched reply, one explicit failure closure, one cancellation during research, one restart, and one uncertain-send reconciliation.
- Confirm the 2,000-code-point final boundary, 320-code-point acknowledgment boundary, and disabled mass mentions through the Discord API.
- Record token, cost, latency, ambient participation, source-grounding, and blind naturalness results before expanding to another guild.

## Rollback

Disable portable checkpoints independently in Pi and the gateway. Existing compatible checkpoints remain readable until expiry, and canonical Convex history remains authoritative. Disable hot-session reuse independently when testing cold reconstruction. Do not delete canonical data as part of rollback.
