# F061.3A — Integration Worker Observability Contracts Foundation

**F061.3A DEFINES OBSERVABILITY CONTRACTS ONLY.**
**NO WORKER METRICS ARE EMITTED.**

## Baseline and allocation

Started from fetched `origin/main` at `7e0992e5258d6ba286706f2b7d544bad86ba7f71` on isolated branch `codex/f061-3a-worker-telemetry-contracts`, worktree `.local-uat/f061-3a-worker-telemetry-contracts`. Initial tree/index were clean, 0 ahead / 0 behind. Fetch completed with the existing stale-worktree cleanup permission warning; no other worktree was repaired. Tracking state is the last fetched observation, not a claim about subsequent remote changes.

Read-only inspection found Claude's separate `claude/f062-2d-1a-pending-age` worktree clean. Its pending-age, expiry and dead-letter policy remains separately owned. This slice allocates only [telemetry contracts](../../server/src/observability/telemetry-contracts.ts), [new focused tests](../../server/test/unit/worker-telemetry-contracts.test.ts), and this record. No F062, integration, database, migration, grant/role, worker implementation, ADR/index, package, configuration or deployment file changes.

The [execution protocol](../development/REQRO_CODEX_PROTOCOL.md), [F061.1 policy](F061-1-telemetry-schema-privacy-foundation.md), [F061.2B request metrics](F061-2B-safe-http-request-metrics-foundation.md), [F061.2C-0 readiness assessment](F061-2C-0-telemetry-export-monitoring-readiness.md), and [F061.2C-1 export boundary](F061-2C-1-no-network-telemetry-export-foundation.md) remain authoritative. [F062.2D-0](F062-2D-0-delivery-worker-security-readiness.md#23-observability--f061-is-the-authority) was read only as input for missing worker concepts; it is not edited or imported into F061.

## Gap and concept vocabulary

The baseline had 13 metric concepts. Eight non-integration concepts remain unchanged: `request_count`, `request_duration`, `error_count`, `readiness_result`, `dependency_latency`, `dependency_failure`, `tenant_resolution_outcome`, and `operator_execution_outcome`. Five integration concepts already existed. This slice adds five, bringing the total to 18, including 10 integration concepts. These names are descriptive concepts, not SDK instrument names, instantiated counters or collection APIs.

| Concept                              | Disposition / unit    | Meaning for future reviewed consumption                                                                                                                                                                                            |
| ------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `integration_pending_count`          | Added / count         | Current number of outstanding obligations in the delivery policy's eligible pending population, including waiting work where that policy includes it; a backlog observation, not an accumulated event count                        |
| `integration_ready_count`            | Added / count         | Current subset of the pending population eligible to be claimed now under the delivery policy; ready and pending are not synonyms                                                                                                  |
| `integration_oldest_pending_age`     | Added / milliseconds  | Observed age of the oldest obligation in the eligible pending population; defined below                                                                                                                                            |
| `integration_claim_count`            | Added / count         | Number of successful claim events; excludes empty polls, failed claim attempts and mere eligibility. A future claim rate derives from these events over an approved window; no duplicate rate concept or rate calculation is added |
| `integration_ambiguous_count`        | Added / count         | Current number of obligations with unresolved delivery ambiguity; not the total number of historical ambiguous attempts, not proof of delivery success or failure                                                                  |
| `integration_delivery_latency`       | Reused / milliseconds | Existing delivery latency concept; no second worker-specific alias                                                                                                                                                                 |
| `integration_retry_count`            | Reused / count        | Existing retry concept; no second alias                                                                                                                                                                                            |
| `integration_dead_letter_count`      | Reused / count        | Existing dead-letter concept; expiry criteria and transition policy remain F062-owned                                                                                                                                              |
| `integration_reconciliation_failure` | Reused / count        | Existing concept mapped to reconciliation-required needs by F062.2D-0; no `integration_reconciliation_required_count` alias is added and no existing producer semantics are redefined                                              |
| `integration_connector_health`       | Reused / outcome      | Destination/connector category, separate from worker process health and API readiness                                                                                                                                              |

Counts are not automatically disjoint or additive. In particular, ambiguity and reconciliation needs can overlap, and ready is a subset of pending. A future producer must establish exact population membership, observation/event aggregation, timestamps, and deduplication under the approved delivery policy. This contract does not reinterpret a cumulative reconciliation failure count as an outstanding backlog gauge. If a later policy requires a distinct measurement, that requires a separate F061 contract review rather than silently reusing a name with different semantics.

## Oldest pending age

This release-critical concept measures elapsed time from the governing policy's original pending-origin timestamp to the observation time for the oldest eligible pending integration obligation. It answers how long the oldest outstanding eligible obligation has waited. The delivery policy owns eligible population membership and the authoritative origin timestamp; this slice creates no database field, query or clock calculation.

**Observed oldest pending age is not the maximum-pending-age policy threshold.** No threshold, deadline, expiry transition, retry decision, dead-letter condition, sampling interval or alert duration is selected here. F062.2D-1A owns the pending-age/expiry policy decision.

A future collector must distinguish an observed empty population from an unavailable/failed observation; missing evidence must not be reported as a fresh zero-age backlog. A zero age is not proof that collection worked or that the worker is progressing. Exact empty/unavailable representation and clock handling need review before instrumentation. Readiness alone must not define the pending population: a destination outage or backoff must not silently hide aging obligations merely because they are not claimable now. Retry, drain or an unsuccessful claim is not by itself authority to reset the original pending age.

Declaring the concept closes the vocabulary gap, not the worker production-readiness gate. Collection, population correctness, stale/missing observation detection and operational use remain unimplemented.

## Worker health semantics

The existing `healthSignal` dimension retains `liveness`, `database_readiness` and `hostname_readiness`. Four explicit worker values are added. `WorkerHealthSignal` and the discriminated `WorkerHealthObservation` type prevent a progress state from being assigned as a liveness state. `workerHealthStates` is a deeply frozen vocabulary; it performs no evaluation.

| Signal             | Bounded observation states                  | Question and meaning                                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worker_liveness`  | `alive`, `not_alive`, `unknown`             | Does the process/runtime exist? An independent observer may report absence; lack of telemetry is not automatically `not_alive`. Destination availability and backlog age are not liveness tests                                                |
| `worker_readiness` | `ready`, `not_ready`, `unknown`             | Does the worker have the prerequisites and eligibility to claim new work? Future policy owns those prerequisites; this is not a grant, claim authorization bypass or proof that any destination is healthy                                     |
| `worker_draining`  | `draining`, `not_draining`, `unknown`       | Is the worker intentionally refusing new claims while allowing bounded in-flight completion? Draining does not mean dead or broken, and a draining worker is not eligible for new claims                                                       |
| `worker_progress`  | `progressing`, `idle`, `stalled`, `unknown` | Is outstanding work advancing as expected? `idle` distinguishes an observed lack of eligible outstanding work; `stalled` requires expected progress and reviewed evidence/window, not merely zero recent claims. Missing evidence is `unknown` |

These `state` values are typed health observations, **not new metric dimension values**. There is no `workerState` label. Any future mapping to numeric observations or existing bounded outcome labels needs separate instrumentation review. No progress threshold or window is chosen here.

`workerHealthSeparation` records declarative constraints: worker health is not connector health; neither determines Reqro API readiness; destination outage and stalled backlog do not fail worker liveness or prescribe restart; drain refuses new claims and permits bounded in-flight completion. These constants are not a health evaluator or controller. They must not cause a restart loop when a destination is unavailable. Worker health, connector/destination health and resident API readiness remain three separate concerns; the API gains no integration dependency or health endpoint change.

## Privacy, labels and identity

[F061.1's validator](../../server/src/observability/metric-label-policy.ts) remains unchanged and authoritative. All 13 dimension keys remain unchanged; the only dimension-value expansion is the four explicitly requested worker health values. Future worker schemas can use existing bounded enums, such as `component: integration`, `operation: deliver`, and an approved health signal, subject to the same budgets. No `worker` component, connector key, state key or arbitrary dimension is introduced.

The limits remain four labels and 256 worst-case Cartesian combinations. `healthSignal` increases from three to seven values. For example, component plus health signal permits 5 × 7 = 35 combinations; adding operation yields 5 × 7 × 8 = 280 and is refused. Some formerly admitted combinations containing healthSignal may therefore exceed the unchanged budget. No current request metric schema uses healthSignal, and no budget is raised to accommodate the expansion.

Organization/connector IDs, hostnames, outbox/attempt/integration IDs, aggregate/resource/external IDs, correlation/trace/span IDs, worker/replica IDs, resident PII and vendor statuses/errors remain disallowed. The positive allowlist refuses unknown aliases as well as the named prohibited/restricted catalogs. No raw values are echoed by rejection results. Restricted trace/log attributes still require their existing privacy/operations review; this slice grants none.

Service/deployment/instance identity belongs in reviewed telemetry resource metadata, never ordinary business dimensions. F061.2C-1's process-local resource references are unchanged and do not establish a production worker identity, writer uniqueness or replicated Collector safety. No infrastructure identity values are invented. Metrics remain separate from authoritative Reqro audit and sanitized Pino logging.

## Future consumption and zero-runtime boundary

The permitted direction remains future F062 worker → F061 contracts, never the reverse. Existing exact reviewed-consumer edges are untouched, including the existing integration telemetry consumer. A new future runtime consumer requires an exact-path review; no directory-wide access is granted here.

Only literal frozen metadata and TypeScript types are added to the contract module. No imports, SDK types, functions, meters, counters, timers, polling, outbox scans, database access, sockets, exporters, health endpoints or middleware are added. Request tracing/metrics and the F061.2C-1 HTTP-only privacy/export gate are unchanged; the gate continues to refuse the newly named worker concepts. No worker observations are created or sent anywhere.

The new AST test checks that the entire contract module contains no imports, functions, constructors or calls other than `Object.freeze`, and checks for duplicate concept keys before runtime object overwriting could hide them. Existing reviewed-consumer, tracing, metric and no-network export graph tests remain intact. Package files and environment configuration are unchanged; installed dependencies are reused through an ignored worktree junction, with no installation.

## Validation and stopping state

Validation used the existing installed Node/tool entry points corresponding to the backend package scripts; no packages were installed.

| Check                         | Invocation and result                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Focused contracts/regressions | From `server/dist-test/test/unit`: `node --test --test-concurrency=1 worker-telemetry-contracts.test.js telemetry-contracts.test.js request-tracing-boundary.test.js request-metrics.test.js request-metrics-boundary.test.js telemetry-export.test.js telemetry-export-boundary.test.js` — **53 passed, 0 failed, 0 skipped** |
| Coverage breakdown            | 9 new worker contract tests; 10 F061.1/F061.1A tests; 4 tracing boundary tests; 14 metrics tests; 16 export behavior/boundary tests. These sum to the 53, not additional runs                                                                                                                                                  |
| Backend typecheck             | From `server`: `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` — passed on final source                                                                                                                                                                                                                       |
| Full backend lint             | `node node_modules/eslint/bin/eslint.js .` — passed on final source                                                                                                                                                                                                                                                            |
| Build                         | `node node_modules/typescript/bin/tsc -p tsconfig.build.json` — passed on final source                                                                                                                                                                                                                                         |
| Test compile                  | `node node_modules/typescript/bin/tsc -p tsconfig.test.json` — passed on final source                                                                                                                                                                                                                                          |
| Formatting/documentation      | Changed-file Prettier passed; 9 relative links, 1 referenced anchor and 8 unique heading anchors passed; whitespace/control-character and private-value pattern checks passed                                                                                                                                                  |
| Scope                         | Exact three-file scope, empty index before staging, unchanged reviewed consumers/policy validator/request/export runtimes; `git diff --check` passed                                                                                                                                                                           |

Before the session interruption, the initial test compile and typecheck each failed because a negative type test's `@ts-expect-error` comment preceded the object declaration rather than its rejected property. The directive was moved to that property; the negative assertion was preserved. Corrected test compilation passed before resumption, and all final checks above passed after resumption. Earlier failed invocations are not relabeled as successes. No startup timeout, failed test or skip occurred in the 53-test invocation; no repository-wide green suite is claimed.

Shared/frontend code is unaffected; those suites were not run and are not required. No database suite, live database, worker loop, telemetry destination or deployment was exercised. Existing synthetic HTTP metric tests are regression traffic, not worker telemetry emission.

Only one local commit is requested after validation. No push, deployment or worker instrumentation is authorized or performed.

**STOP FOR F061.3A REVIEW.**
