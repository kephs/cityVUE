# F061.3C — Worker Lease, Retry & Ordered-Stream Observability Contracts

**F061.3C DEFINES OBSERVABILITY CONTRACTS ONLY.**

**NO WORKER METRICS ARE EMITTED.**

**NO DATABASE IS QUERIED.**

**NO F062 DELIVERY POLICY IS IMPLEMENTED HERE.**

## Baseline and allocation

Started from freshly fetched origin/main at `11b0a2c44069841e91315660d0c1b9e9baadafd4`, on isolated branch `codex/f061-3c-worker-execution-observability` in .local-uat/f061-3c-worker-execution-observability. HEAD matched origin/main, with a clean tree/index and 0 ahead / 0 behind. Fetch succeeded with the previously observed stale-worktree cleanup permission diagnostic; no repair was attempted.

Claude's concurrent F062 persistence slice is separately allocated. This work changes only the F061 contract, focused tests, existing F061.3A/3B inventory assertions and this document. No F060/F062, integration, worker, database types, migration, role/grant/function, deployment, package, configuration or ADR file changes.

Authorities: [F061.1](F061-1-telemetry-schema-privacy-foundation.md), [F061.3A](F061-3A-integration-worker-observability-contracts.md), [F061.3B](F061-3B-age-dead-letter-observability-contracts.md), and the [F061.2C-1 export boundary](F061-2C-1-no-network-telemetry-export-foundation.md). [F062.2D-2C-0](F062-2D-2C-0-worker-execution-semantics-decision.md) and [its 0A amendment](F062-2D-2C-0A-worker-execution-contract-amendment.md) were inspected read-only for semantic requirements; their code/constants are not imported.

## Concepts added versus reused

The baseline contains 19 concepts, including 11 integration concepts. This slice adds five, resulting in 24 total / 16 integration concepts. Concept declarations are not instruments or an emission API.

| Requirement                                            | Concept and unit                                                           | Population / measurement                                                                                                                                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active claims — added                                  | integration_active_claim_count / count                                     | Gauge-style current open claims, including expired claims until settled/recovered. Distinct from accumulated successful claim events.                                                                             |
| Expired leases — added                                 | integration_expired_lease_count / count                                    | Gauge-style subset of current open claims which the F062 producer has already qualified as lease-expired; no lease calculation in F061. Null/unassigned transitional lease evidence is not automatically expired. |
| Recovery actions — added                               | integration_lease_recovery_count / count                                   | Counter-style completed, confirmed recovery actions, classified by reason. Scans, attempted/refused recoveries and repeated reads of the same action do not count.                                                |
| Retry-eligible age — added                             | integration_oldest_retry_eligible_age / milliseconds                       | Largest policy-qualified eligible waiting age among obligations currently eligible to retry, measured from the governing retry-ready timestamp rather than original pending age.                                  |
| Ordered backlog — added                                | integration_ordered_stream_blocked_count / count                           | Gauge-style number of newer obligations blocked by strict ordering, not number of streams/aggregates or occupied slots. Each blocked obligation is counted once.                                                  |
| Retry exhaustion — reused                              | integration_dead_letter_count with reason attempt_budget_exhausted         | Existing dead-letter measurement restricted to obligations whose confirmed dead-letter cause is exhaustion of the approved destination retry budget. No new reason or metric alias.                               |
| Ambiguous blockage impact — reused new ordered concept | integration_ordered_stream_blocked_count with reason ambiguous_predecessor | Subset of blocked obligations whose governing unresolved predecessor is ambiguous. Not the count of ambiguous obligations themselves.                                                                             |

Retain integration_claim_count, integration_pending_count, integration_ready_count, integration_oldest_pending_age, integration_ambiguous_count, integration_retry_count, integration_delivery_latency, integration_dead_letter_count, integration_age_policy_transition_count, integration_reconciliation_failure and integration_connector_health unchanged.

**integration_claim_count != integration_active_claim_count.** A series of successful claims can grow while the current open inventory shrinks. Expired claims overlap active claims; the two must not be summed as disjoint populations.

**Oldest pending age != oldest retry-eligible age.** Pending work may be paused or retrying before its due time; neither belongs automatically in the currently retry-eligible population. The retry-age observation describes overdue eligible waiting, not original obligation age or the configured backoff interval. F062 supplies the authoritative timestamp, pause/eligibility treatment and qualified value. This document does not redefine F061.3B's policy-qualified pending-age contract as an unconditional now-minus-created-at calculation, even where earlier F062 prose uses that shorthand.

An exhausted budget is not itself proof of a committed dead-letter: reuse applies only after the producer verifies that transition/cause under F062 policy. No synthetic dead-letter is invented for an unresolved or differently settled obligation. Future non-dead-letter exhaustion semantics would require separate contract review. Preserve existing event/snapshot semantics for the reused dead-letter concept; filtering its reason does not silently change its aggregation or window.

## Closed observation classifications

[telemetry-contracts.ts](../../server/src/observability/telemetry-contracts.ts) adds two frozen tuples and their derived union types. The existing reason dimension includes their values once; no new dimension key exists.

| Vocabulary / type                                                 | Value                       | Required meaning before a future producer emits it                                                                                                                                     |
| ----------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| integrationLeaseRecoveryClasses / IntegrationLeaseRecoveryClass   | pre_dispatch_recovery       | A completed recovery with reviewed evidence that dispatch had not crossed the transmission boundary. No destination fault is asserted.                                                 |
| same                                                              | uncertain_dispatch_recovery | A completed recovery which escalates possibly dispatched work to unresolved ambiguity. It is not successful delivery or authorization for blind retry.                                 |
| integrationOrderedBlockerClasses / IntegrationOrderedBlockerClass | ordered_predecessor         | The governing earlier unresolved blocker is not ambiguous; includes ordering blockage despite that predecessor being paused or not presently retryable where F062 policy so specifies. |
| same                                                              | ambiguous_predecessor       | The governing earlier unresolved blocker is ambiguous. This class wins for that obligation; do not count the same obligation in both buckets.                                          |

Classify by the earliest governing unresolved predecessor under the approved ordering policy, not by an arbitrary worker guess or any later ambiguous item in the stream. For example, one ambiguous predecessor holding back three newer obligations contributes three to ambiguous_predecessor, not one stream and not four total obligations. If the blocker is ordinary and a later item is ambiguous, the earlier governing blocker still determines the class. F061 performs none of the predecessor selection.

The four existing dead-letter classes remain exactly pending_age_exhausted, attempt_budget_exhausted, permanent_destination_outcome and other_approved. Pre-dispatch recovery is not destination budget exhaustion, pending-age exhaustion or permanent destination failure. The 0A amendment defines attempt_number as an evidence ordinal, not a retry count: a producer must never infer destination budget exhaustion from that ordinal alone.

No classification falls back to other_approved or unknown for unverified input. The generic validator accepts bounded labels, not the truth of a producer's claim. It does not enforce metric-specific classification semantics; those subset types/documented mappings must be enforced by the future reviewed producer. Unknown/raw F062 codes such as lease_expired_uncertain remain invalid metric reason values.

```text
F062 semantic evidence and policy-qualified populations
  -> future explicit reviewed mapping in the producer
  -> F061 bounded observation classes / safe values
```

Never reverse that authority. F061 observation classes are not the F062 lifecycle reason_code taxonomy. No destination semantics, transition evaluator, retry budget, lease duration, scheduling formula or alert threshold is introduced.

## Release gates and health separation

The frozen workerProductionReleaseGateConcepts names:

- integration_active_claim_count;
- integration_expired_lease_count;
- integration_oldest_pending_age.

Declaring these concepts does not satisfy production activation. Future activation requires meaningful collection, accurate populations, fresh/missing/stale observation handling and operational ownership for all three. Do not report collection failure as zero; a confirmed empty population is different from unavailable evidence. No numeric alarm or sampling interval is selected.

worker_liveness, worker_readiness, worker_draining and worker_progress retain their exact closed vocabularies. Existing workerHealthSeparation is unchanged. Expired leases do not establish process liveness failure; ordered blockage does not establish API readiness failure. Destination outage, connector health, delivery backlog, worker progress and resident/staff API readiness stay separate. Telemetry cannot authorize a restart, claim, recovery, retry or state transition.

## Privacy and cardinality proof

[metric-label-policy.ts](../../server/src/observability/metric-label-policy.ts) is **unchanged**. Its positive allowlist, sanitizing rejection behavior, four-label limit and 256 worst-case combinations per schema remain authoritative. All 13 dimension keys are unchanged. Only the closed reason vocabulary expands from 12 to 16 values.

For recovery and ordered blockage, a reviewed schema using component + reason + environment + service has **5 × 16 × 3 × 1 = 240 combinations** and four labels. This conservatively budgets every reason value, not only the relevant two-class subset. Adding releaseCohort exceeds four labels and is rejected. reason + operation + environment has **16 × 8 × 3 = 384 combinations** and is rejected despite using only three labels. A plain inventory/age schema can omit reason: component + environment + service has 15 combinations.

The same reason expansion may make previously admissible hypothetical schemas exceed 256; there is no exemption or budget increase. Existing HTTP request metric labels remain method/routeTemplate/statusClass, unaffected. The tests enumerate every schema containing reason to verify both unchanged budgets.

Organization, connector, aggregate/resource/outbox/attempt/integration/external IDs, unapproved aggregateType, hostnames, worker/replica identity, correlation/trace/span IDs, PII and vendor errors/status strings remain forbidden, including unknown aliases. There is no automatic dimension discovery. Resource/replica identity belongs in reviewed resource metadata; the process-local F061.2C-1 identity does not itself prove production writer uniqueness or Collector safety.

## Runtime and ownership proof

The contract has no imports at all, including no integration/F062, SDK or database imports. AST checks reject imports/re-exports, constructors, functions, arithmetic/assignment expressions, clocks, timers and calls other than Object.freeze. Only literal declarations, types and frozen vocabulary are added. No instrument, meter, observer, query, polling loop, scheduler, middleware, health endpoint, network client or exporter is introduced.

The existing HTTP-only no-network export boundary still refuses all five new worker concepts. No request tracing/metrics implementation or export contract is modified. Detailed delivery evidence remains in F062's authorized records, not metric labels; telemetry is not authoritative audit.

Future producers must qualify active/open claims, approved lease expiry, completed recovery, currently eligible retries, legal budget exhaustion and governing predecessor blockage; map them explicitly into these classes; establish idempotent event counting and coherent snapshots; provide units/clock provenance and missing-data semantics; and preserve resource identity and privacy. None of this work executes here.

## Files and validation

Exact intended scope:

- server/src/observability/telemetry-contracts.ts — five concepts, two bounded classification vocabularies and declarative release gates.
- server/test/unit/worker-execution-telemetry-contracts.test.ts — new F061.3C coverage.
- server/test/unit/worker-telemetry-contracts.test.ts — retain F061.3A assertions and update the exact cumulative concept inventory.
- server/test/unit/age-dead-letter-telemetry-contracts.test.ts — retain F061.3B semantics/privacy tests and update cumulative reason/concept counts and cardinality arithmetic.
- This document.

The extra F061.3B test edit is required by its exact baseline inventory assertions; no assertion is removed or weakened to conceal a failure. No timeout change or unrelated test correction is in scope.

Validation passed: the focused ten-file Node test run completed with **82 passed, 0 failed, 0 skipped** (102.914 seconds), including nine new F061.3C tests, F061.3A/3B, F061.1/F061.1A privacy/cardinality, tracing and tracing boundary, request metrics and metrics boundary, export and export boundary coverage. The run used `node --test --test-concurrency=1 --test-reporter=tap` against compiled tests.

Backend typecheck (`tsc -p tsconfig.json --noEmit`), full backend lint (`eslint .`), build (`tsc -p tsconfig.build.json`) and test compilation (`tsc -p tsconfig.test.json`) all exited 0 using the existing local toolchain. Changed-file Prettier checks, eight relative documentation links, eight unique heading anchors, whitespace/control-character checks and `git diff --check` passed. No dependency was installed. No full backend unit run, database test or live-environment validation was performed; this focused contract slice does not require them.

The user authorizes one local commit only after applicable validation passes. No push, deployment, worker instrumentation or subsequent task is authorized.

**STOP FOR F061.3C REVIEW.**
