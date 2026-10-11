# F061.3B — Age and Dead-Letter Observability Contracts

**F061.3B DEFINES OBSERVABILITY CONTRACTS ONLY.**

**IT DOES NOT IMPLEMENT AGE EXPIRY, DEAD-LETTER TRANSITIONS, OR WORKER METRIC EMISSION.**

## Baseline and allocation

Started from fetched `origin/main` at `3ca345490442e18f13111ac88553996d6bc1ba8a` on isolated branch `codex/f061-3b-age-dead-letter-observability`, worktree `.local-uat/f061-3b-age-dead-letter-observability`. Initial tree/index were clean, 0 ahead / 0 behind. This includes F061.3A (`f13e1f4`) and F062.2D-1A (`2a6a1e8`), integrated through PRs 20 and 19. Fetch succeeded with the existing stale-worktree cleanup permission warning; no other worktree was repaired. Tracking state is the last fetched observation.

Claude's separate `claude/f062-2d-2a-attempt-fencing` worktree was clean on initial read-only inspection. Its persistence allocation is not edited here. This slice changes only [telemetry contracts](../../server/src/observability/telemetry-contracts.ts), [new focused tests](../../server/test/unit/age-dead-letter-telemetry-contracts.test.ts), the exact inventory expectations in [F061.3A tests](../../server/test/unit/worker-telemetry-contracts.test.ts), and this record. No F062, migration, database function/role/grant, runtime, package, configuration, ADR or deployment file changes.

The [execution protocol](../development/REQRO_CODEX_PROTOCOL.md), [F061.1 privacy authority](F061-1-telemetry-schema-privacy-foundation.md), [F061.3A worker contracts](F061-3A-integration-worker-observability-contracts.md), and [F061.2C-1 export foundation](F061-2C-1-no-network-telemetry-export-foundation.md) remain in force. [F062.2D-1A](F062-2D-1A-pending-age-dead-letter-policy.md) and its referenced delivery taxonomy were inspected read-only; F061 imports neither their code nor their constants.

## Gap and metric concepts

The baseline contains 18 metric concepts, including 10 integration concepts. None describes an age-policy-caused automatic-processing state transition. Oldest pending age measures a duration, ambiguous count measures unresolved obligations, and dead-letter count spans multiple causes; none substitutes for the missing concept.

Add exactly one concept: `integration_age_policy_transition_count`, unit `count`. It represents the number of integration obligations whose automatic-processing state changed because an approved age policy was applied. A future producer must observe a confirmed legal transition, rather than counting an age check, an attempted/rejected transition, repeated reads of a terminal record, or elapsed time alone. It must not double-count the same transition on retries. No instrument, counting algorithm or deduplication implementation is created here.

Retain and reuse `integration_dead_letter_count`, `integration_oldest_pending_age`, pending/ready/claim/ambiguous counts, and all existing delivery/retry/reconciliation/connector-health concepts unchanged. There are now 19 total concepts and 11 integration concepts. No age-expiry alias or duplicate dead-letter metric is introduced.

**Dead-letter count is not age-policy transition count.** A dead-letter can have several causes; an age-policy transition describes one specific semantic cause of state change. These measurements can describe overlapping facts and must not be summed as independent populations. No claim is made that their totals or aggregation windows are equal. Future instrumentation must preserve the existing meaning of each concept.

## Bounded dead-letter reasons

`integrationDeadLetterReasonClasses` is a frozen four-value vocabulary with the corresponding `IntegrationDeadLetterReasonClass` type. It is an observability classification, not an authoritative delivery state or semantic failure taxonomy.

| Class                           | Meaning after future explicit, reviewed mapping                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pending_age_exhausted`         | An approved age policy caused the confirmed transition; does not attribute fault to a destination                                                      |
| `attempt_budget_exhausted`      | The approved retry/attempt budget was exhausted; distinct from age exhaustion even if both produce a dead-letter                                       |
| `permanent_destination_outcome` | A confirmed permanent destination outcome caused a legal dead-letter; not every permanent outcome necessarily has that state                           |
| `other_approved`                | Another explicitly approved, bounded semantic cause caused a legal dead-letter; never an automatic fallback for unknown values, free text or ambiguity |

The [existing label validator](../../server/src/observability/metric-label-policy.ts) already supports a closed `reason` dimension, so it is reused. The four values are explicitly appended to its existing eight-value contract vocabulary; no new dimension key is added. The same constant supplies the subset type and dimension values, avoiding two independently maintained lists. `metric-label-policy.ts` is unchanged.

```text
F062 semantic reason + confirmed transition context
  -> future explicit reviewed mapping in the producer
  -> F061 bounded observability reason class
  -> existing reason label / future approved telemetry record
```

F062's existing taxonomy distinguishes pending-age exhaustion from permanent destination refusal, credential rejection, unsupported schemas, transient failures and uncertain lease expiry. Its proposed `pending_age_exceeded` semantic code is not blindly accepted as a metric reason; a future producer would map a verified age-caused transition to `pending_age_exhausted`. Likewise, a transient error or `retry_eligible = false` alone must not be assumed to prove attempt-budget exhaustion without the governing policy and transition context. No mapping function or semantic reason-code copy is implemented here.

The generic label validator validates bounded names and values; it does not prove that a supplied classification is factually or legally correct. Its existing `none` and `unknown` values remain valid for other telemetry, but they are not members of the dead-letter subset. Unknown/unmapped semantic causes must be withheld from this classification until reviewed; they must not be silently converted to `other_approved`. The existing F062 generic failure-to-reason mapping is unchanged and does not automatically supply this future dead-letter mapping. Detailed trusted semantic evidence remains in F062's own operator/audit surfaces rather than being replaced by these coarse metric categories.

## Eligible age and ambiguity

F062 owns the pending-age origin, pause/ineligible intervals, threshold, policy revision/epoch, legal transition and dead-letter state mutation. F061 owns only observable concepts. For future consumption, F061.3A's oldest-pending-age concept must receive a **policy-qualified eligible-age value** from the producer. F061 performs no `now - created_at` calculation, clock access, pause subtraction, threshold comparison or transition decision.

F062.2D-1A requires paused obligations to be excluded from the oldest-eligible-pending-age observation. This is not permission for F061 to reconstruct eligibility from connector states or timestamps. The future producer must supply the eligible population/value under that policy and distinguish no eligible work from missing/failed observation. A destination outage does not itself grant a pause, and no pending-age threshold is chosen in this slice.

**Age does not erase ambiguity.** `ambiguous` is neither an age-exhaustion class nor any dead-letter class. The future mapper must not coerce it to `pending_age_exhausted`, `permanent_destination_outcome` or `other_approved`. It remains uncertainty requiring F062 reconciliation/operator handling. There is no age-based ambiguous-to-dead-letter rule in this contract.

## Privacy, cardinality and health separation

All 13 metric dimension keys remain unchanged. The reason vocabulary grows explicitly from 8 to 12; the dead-letter subset has exactly 4 unique values. No free text, raw vendor status/error, hostname, threshold duration or arbitrary semantic code is accepted as a reason class. No Organization/connector/integration/outbox/attempt/aggregate/resource/external ID, correlation/trace/span ID, replica/worker instance ID or resident PII becomes a label. Resource instance identity remains separate metadata under the existing future writer-identity review.

The maximum stays **4 labels and 256 Cartesian combinations**. The existing validator counts all 12 generic reason values, not only the four-value subset, so the new classes cannot bypass the budget. Examples:

- `component + reason + environment + service`: 5 × 12 × 3 × 1 = 180; four labels, accepted.
- `reason + operation + environment`: 12 × 8 × 3 = 288; three labels, refused by the cardinality cap. This previously fit at 192, so the expansion can make existing reason-bearing combinations more restrictive.
- Any five-label submission: refused regardless of selected values.

The focused tests exhaust all 4,096 dimension-key subsets containing `reason` and assert both unchanged limits. No exception, truncation, free-text fallback or higher budget is added. Existing HTTP request metrics do not use the generic reason label, and their names, labels and runtime remain unchanged.

Worker health, destination health, API readiness and delivery outcome reason remain separate concepts. These classes are not `healthSignal` values or `workerHealthStates` values. Nothing modifies `worker_progress`, connector health, API readiness or restart behavior. All reviewed consumer boundaries remain exactly as before.

## No runtime behavior

The production change contains only one frozen vocabulary/type, the explicit addition to the existing reason list, and one metric concept. No imports, functions, SDK types, meters, emission, observable gauges, polling/timers, database access, health endpoint, middleware, exporter or network call is introduced. The tests assert that the contract contains no imports, constructors, functions or arithmetic, and calls only `Object.freeze`.

F061.2C-1 remains an HTTP-only no-network export abstraction and refuses this new worker concept. Neither a new concept nor a newly allowed generic reason configures an exporter or grants F062 consumer access. The dependency direction remains future F062 producer → F061 contracts, never the reverse. Future mapping/instrumentation requires separate review.

The F061.3A test update only adds the explicit new concept to its closed expected inventory and changes the total integration count from 10 to 11. All nine tests, their prior concept expectations, privacy checks, health distinctions and consumer boundaries are preserved. Dependencies are reused through an ignored worktree junction; no package installation or configuration change occurs.

## Validation and stopping point

Checks used the existing installed local tool entry points corresponding to backend scripts; no dependency installation was needed.

| Check                    | Invocation and outcome                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused/regression tests | From `server/dist-test/test/unit`: `node --test --test-concurrency=1 age-dead-letter-telemetry-contracts.test.js worker-telemetry-contracts.test.js telemetry-contracts.test.js request-tracing-boundary.test.js request-metrics.test.js request-metrics-boundary.test.js telemetry-export.test.js telemetry-export-boundary.test.js` — **62 passed, 0 failed, 0 skipped** |
| Distinct coverage        | 9 F061.3B + 9 F061.3A + 10 F061.1/F061.1A + 4 tracing boundary + 14 metrics + 16 export tests = 62; the 4,096 cardinality cases are assertions within one test, not extra test totals                                                                                                                                                                                      |
| Typecheck                | From `server`: `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` — passed                                                                                                                                                                                                                                                                                   |
| Full backend lint        | `node node_modules/eslint/bin/eslint.js .` — passed                                                                                                                                                                                                                                                                                                                        |
| Build                    | `node node_modules/typescript/bin/tsc -p tsconfig.build.json` — passed                                                                                                                                                                                                                                                                                                     |
| Test compile             | `node node_modules/typescript/bin/tsc -p tsconfig.test.json` — passed                                                                                                                                                                                                                                                                                                      |
| Formatting/docs          | Changed-file Prettier passed; 9 relative links and 8 unique heading anchors passed; whitespace/control-character and private-value pattern checks passed                                                                                                                                                                                                                   |
| Scope/diff               | Exactly four allocated files; index empty before staging; `git diff --check` passed; label validator, F062, database, request/export runtimes, reviewed-consumer edges and packages unchanged                                                                                                                                                                              |

No failed test invocation, timeout or skipped test occurred in this slice. This is focused regression evidence, not a repository-wide suite claim. No database test was required or run; shared/frontend code is unaffected and those suites were not run. Synthetic request-metric regression HTTP traffic is not worker telemetry emission. No live database, telemetry destination or external integration was exercised.

Only one local commit is requested after validation. No push, deployment or runtime telemetry implementation is authorized or performed.

**STOP FOR F061.3B REVIEW.**
