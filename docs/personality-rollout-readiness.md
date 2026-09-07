# Discord personality rollout readiness

Evidence date: 2026-09-07

This record separates verified build evidence from live gates. It does not authorize a Discord post, a deployment, or a trading action.

## Ready for staged owner testing

The durable Luna and isolated Sol pipeline is ready for staged owner testing with durable conversations enabled and both compaction flags off. The bounded portable path and the gated first-party native adapter are implemented. Neither compaction path is approved for production activation yet.

Verified implementation evidence:

- At code commit `f369994`, `npm run check:personality` passed without a user login, provider call, or Discord delivery: 63 Pi tests, 35 Discord tests, and 50 baseline Convex tests.
- Native Convex commits `b2e0b56` and `5069adb` separately passed all 96 Convex tests, Convex typecheck and build, and root lint before integration. The final deployment commit still requires the full root gate.
- The fixture replay runs each routing case three times.
- The synthetic restart fixture preserves author attribution, an accepted correction, an unresolved question, freshness, and the recent raw tail.
- Portable generation uses a fresh Luna session with no tools. Pi accepts only typed summaries whose source-event IDs and author IDs occur in supplied evidence. Each authored claim must cite an event from that author or preserve the complete evidence bundle from a prior validated claim by that author.
- Convex activates a checkpoint only after revision, epoch, owner binding, generation, routing generation, source hash, source references, author-to-source attribution, exact recent-tail IDs, size, and token-accounting checks pass.
- The trigger uses the pinned 272,000-token model window. The threshold is 190,400 estimated tokens. The retained recent tail is contiguous and targets 20,000 estimated tokens.
- For more than 5,000 eligible events, Convex advances contiguous candidate stages. Each source batch is at most 5,000 events and 900,000 encoded bytes, the full request stays at most 1,500,000 bytes and 190,400 estimated input tokens, and the active checkpoint stays unchanged until the final retained-tail boundary is complete. A handler-driven offline test crosses the backlog in multiple stages without a gap and verifies another guild can progress between stages.
- The native adapter is pinned as `responses-compaction-v2-pi-0_84_1-v1`. It uses only Pi `0.84.1` public request hooks and the reviewed Codex remote-compaction SSE route.
- Native traffic uses the `native-v2` gateway protocol. Convex keeps `durable-v1` and no-header responses free of native fields during rolling deployment.
- Offline native tests cover nullable headers, exact request fields, the pinned SDK output event, strict terminal ordering and usage, one opaque-item response capture, hash and byte validation, full source-lineage fencing, corrupt identity fallback, portable-summary seeding, current context and trailing-user preservation, JSON restart injection, safe error text, and an early cloned-stream failure.
- A provider rejection restarts the full original prompt from readable context. Discord then requests an exact-fence opaque-artifact invalidation. A failed cleanup write cannot discard the already-valid portable result, and a later turn retries cleanup.
- Native still defaults off. Startup accepts `true` only with portable fallback enabled and the exact reviewed live-probe attestation.

## Live evidence captured by the deployment owner

The owner ran these synthetic OAuth probes against the deployed Pi service on 2026-09-07. They did not use Discord delivery.

| Probe | Result | Evidence |
| --- | --- | --- |
| Pi health | Pass | HTTP 200; executor and Discord agents reported ready |
| Luna transport | Pass | `gpt-5.6-luna`, `xhigh`, `priority`; `READY` in 1,772 ms |
| Sol transport | Pass | `gpt-5.6-sol`, `max`, `priority`; `READY` in 1,633 ms |
| Sol literal `ultra` | Fail as expected | Provider rejected `ultra`; accepted values ended at `max` |
| Luna naturalness fixtures | Pass | Nine of nine synthetic simple, informal, and correction runs passed deterministic surface checks |
| Portable checkpoint schema | Pass | One synthetic checkpoint attempt; 100 estimated input tokens, 263 estimated output tokens, -163 estimated saved tokens, 764 serialized bytes, and one source reference |

The Luna and Sol transport probes used a 512-token output cap and only synthetic `READY` input. They prove OAuth and transport compatibility. The nine naturalness runs prove only deterministic surface checks. The one-event portable probe proves the deployed schema path, but its negative estimated savings do not satisfy the long-context or economics gate. No probe yet proves research quality, blind naturalness, full restart continuity, or production latency.

After building the Pi package, run these commands inside the Pi service shell. They use the service-owned OAuth file. They do not require a user login and do not call Discord.

```sh
PERSONALITY_PROBE_MODE=naturalness PERSONALITY_PROBE_REPETITIONS=3 npm run probe:personality
TRISHULA_PORTABLE_CHECKPOINTS_ENABLED=true PERSONALITY_PROBE_MODE=checkpoint npm run probe:personality
PERSONALITY_PROBE_MODE=native_compaction PERSONALITY_PROBE_REPETITIONS=1 npm run probe:personality
```

The first command makes nine pinned Luna calls across simple, informal, and correction fixtures. It prints only synthetic replies and deterministic surface findings. The second starts a transient probe process with the portable flag enabled; it does not change the running service configuration or write a Convex checkpoint. The third makes exactly three Luna calls: one remote compaction, one same-process continuation, and one fresh-runtime continuation. It requires exact recall of an assistant-only sentinel that is absent from retained user messages and the final query. It prints artifact hash, size, usage, latency, and pass fields, not the opaque artifact or prompt.

Do not set `TRISHULA_NATIVE_COMPACTION_LIVE_PROBE_ATTESTATION` from an offline result. Set it only after the third command exits successfully in the service-owned OAuth environment and the captured request confirms `store=false`, SSE, and `remote_compaction_v2`.

## Required gates before portable activation

Keep `TRISHULA_PORTABLE_CHECKPOINTS_ENABLED=false` in Pi and the Discord gateway until every row passes.

| Gate | Status | Required evidence |
| --- | --- | --- |
| Convex storage protection | Blocked | Confirm acceptable encryption at rest, rotation, backup deletion, and tenant controls, or add application-layer authenticated encryption and its tests |
| Live long-context generation | Not run | Cross 190,400 estimated tokens in a noncritical synthetic guild and capture one valid checkpoint |
| Small deployed schema probe | Pass | One evidence-bound checkpoint completed; this did not cross the threshold or test savings |
| Same-process continuation | Offline deterministic pass; live pending | Answer seeded facts, correction, unresolved question, and freshness after activation |
| Full Pi restart | Offline reconstruction pass; live pending | Restore the same facts and attribution from Convex only |
| Failure fallback | Offline pass; live pending | Inject provider failure and stale compare-and-set; retain the prior checkpoint and raw context without a visible failure |
| Quality and savings | Not run | Record recall, source grounding, input/output tokens, estimated cost, and latency against the non-compacted baseline |
| Blind naturalness review | Not run | Score the fixture pairs with the section 16 rubric; deterministic surface checks alone are not a human rubric score |
| Oversized source backlog | Offline pass; live pending | Repeat bounded, contiguous staged progress through more than 5,000 eligible events in the deployed environment |

## Required gates before native activation

Keep `TRISHULA_NATIVE_COMPACTION_ENABLED=false` and leave its attestation unset until every row passes.

| Gate | Status | Required evidence |
| --- | --- | --- |
| OAuth remote-compaction route | Not run | Capture one successful `remote_compaction_v2` SSE response through the service-owned Codex OAuth runtime |
| Opaque-only recall | Not run | Recall the assistant-only sentinel in both same-process and fresh-runtime continuations |
| Request storage evidence | Offline pass; live pending | Capture `store=false`, SSE transport, priority tier, Luna xhigh, and no `previous_response_id` on the live request |
| Provider fallback | Offline pass; live pending | Reject an injected artifact, complete the same visible turn from portable context, and durably clear the opaque artifact with content-free warnings only |
| Durable Convex restart | Offline persistence/CAS pass; full restart pending | Persist, reload, hash-check, and inject the artifact after a full Pi process restart |
| Long-threshold quality and economics | Not run | Run the fixed long fixture and record recall, tokens, cost, latency, and the uncompacted baseline |
| Privacy and storage protection | Blocked | Resolve encryption, backup expiry or erasure, retention, and authorized deletion evidence for opaque data |

## Required gates before any Discord pilot

- Run the full root `npm run check` command on the exact deployment commit.
- Deploy in order: Convex, Pi, Discord gateway, then web.
- Keep `TRISHULA_NATIVE_COMPACTION_ENABLED=false` and its live-probe attestation unset.
- Keep `TRISHULA_PORTABLE_CHECKPOINTS_ENABLED=false` until its live rows pass. Durable conversations remain enabled.
- Verify one direct reply, one researched reply, one explicit failure closure, one cancellation during research, one restart, and one uncertain-send reconciliation.
- Confirm the 2,000-code-point final boundary, 320-code-point acknowledgment boundary, and disabled mass mentions through the Discord API.
- Record token, cost, latency, ambient participation, source-grounding, and blind naturalness results before expanding to another guild.

## Rollback

Disable portable checkpoints independently in Pi and the gateway. Existing compatible checkpoints remain readable until expiry, and canonical Convex history remains authoritative. Disable hot-session reuse independently when testing cold reconstruction. Do not delete canonical data as part of rollback.
