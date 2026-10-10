# F061.2C-1 — No-Network Telemetry Export Foundation

**F061.2C-1 DOES NOT EXPORT TELEMETRY OVER A NETWORK.**

This implementation adds an independently tested, provider-neutral export boundary with a no-op default. It does not activate request collection, attach SDK processors/readers, or establish production export readiness. No OTLP adapter, Collector, backend, endpoint, credential, environment setting or exporter package exists in this slice.

## Baseline and scope

Started from fetched `origin/main` at `7c89a9fa23c17278a6389a6d42dca96cec2bfcdb`, on isolated branch `codex/f061-2c-1-no-network-export` under `.local-uat/f061-2c-1-no-network-export`. The initial working tree and index were clean, 0 ahead / 0 behind. Fetch succeeded with the existing stale-worktree cleanup permission warning; no other worktree was repaired. Tracking state is the last fetched observation, not proof of later remote changes.

Claude's separate `claude/f062-2d-1-worker-identity` worktree was clean on initial read-only inspection. Allocation here is only the export module, test-only helper, two new unit suites, the existing consumer and tracing boundary tests, and this record. No integration, database, migration, worker/grant/role, F062, ADR/index, deployment, shared or UI file changes are authorized by this slice.

Authority remains the [execution protocol](../development/REQRO_CODEX_PROTOCOL.md), [F061.1 privacy contract](F061-1-telemetry-schema-privacy-foundation.md), [F061.2A tracing](F061-2A-opentelemetry-request-tracing-foundation.md), [F061.2B metrics](F061-2B-safe-http-request-metrics-foundation.md) and [F061.2C-0 readiness gates](F061-2C-0-telemetry-export-monitoring-readiness.md). This implementation does not allocate an ADR.

## Architecture and signal boundaries

The [export module](../../server/src/observability/telemetry-export.ts) exposes `TelemetryExportRecord`, `TelemetryResourceIdentity`, `TelemetryExportPolicy`, `TelemetryExportPolicyResult`, `ApprovedTelemetryExportRecord`, `TelemetryExportSink` and `TelemetryExportResult`, plus the fixed policy, no-op sink and boundary factory.

Conceptual future path:

```text
Completed Reqro trace / request metric observation
  -> exact export-time privacy validation
  -> detached frozen approved record
  -> no-op sink (this slice)
  -> future separately approved OTLP adapter
  -> private Collector
  -> optional backend
```

Only `trace` and `metric` are export signals. Pino remains the sanitized operational logging path; Reqro audit remains authoritative security/business evidence. Audit and operational logs are refused at runtime and excluded by the export signal type. An accepted export result never proves an audit record was persisted.

No bridge is needed yet: F061.2A/F061.2B runtime, AppModule, health exclusions, default-disabled behavior, metric names and labels remain unchanged. Future producers must deliberately project completed safe observations; raw SDK Span/Meter objects never enter this contract. This module has no production caller yet; any use without an injected sink always validates and discards.

## Privacy gate and normalized records

F061.1 is the sole privacy vocabulary. The gate permits a narrower HTTP-only export schema; it does not add a competing allowed/restricted taxonomy. Request metric labels pass through the existing [metric-label validator](../../server/src/observability/metric-label-policy.ts), with exactly `method`, `routeTemplate` and `statusClass`. Trace method/route values use the same frozen F061.1 vocabularies; status/outcome/reason follow F061.2A's existing closed projection.

| Surface                 | Accepted content                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metric observation      | `request_count` with value exactly 1, or `request_duration` with a finite nonnegative millisecond value; exactly the existing three labels                           |
| Completed trace summary | Operation `http_request`, finite nonnegative duration, and exactly `http.request.method`, `http.route`, `http.response.status_code`, `reqro.outcome`, `reqro.reason` |
| Numeric envelope        | Nonnegative integer timestamp in milliseconds, at most `Number.MAX_SAFE_INTEGER`; duration/value bounded by the same numeric maximum                                 |
| Resource                | Fixed `cityvue-api` service plus separate deployment/instance local-reference slots                                                                                  |

These are normalized observations, not an OTLP wire model or a replacement histogram. There is no histogram conversion, aggregation, sampling, exemplar, parent context, trace/span ID, correlation ID, event, link, error object or arbitrary string metadata. Existing local tracing correlation behavior is unchanged. Trace statuses are 0 or integer 100–599; the matching existing outcome/reason pair is required rather than repaired silently.

Every envelope and nested map must have exactly the expected own enumerable data properties on a plain or null-prototype object. Unknown names, missing fields, symbols, hidden properties, accessors and inherited/custom-prototype objects are refused. Approved names cannot hide raw URLs, query strings, hostnames or arbitrary payload values. All F061 forbidden/restricted fields and metric identifiers are refused, including aliases absent from the descriptive catalog. No rejected key, value or exception is echoed.

Accepted records are copied and deeply frozen. A private weak membership set verifies that a record actually passed this policy; TypeScript casts and cloned records cannot forge approval at the no-op or test sink. Membership does not retain otherwise unreachable records. Sink invocation occurs only after validation, and injected sink outputs are reduced to fixed results without forwarding arbitrary diagnostics.

## Resource identity

`service`, `deployment` and `instance` are resource metadata, not business labels. Service remains the existing fixed technical identifier. Deployment/instance are either `null` (unassigned) or opaque process-local integer references from 0 through 65,535. This numerical ceiling is an in-process contract bound, not a deployment capacity target. No value is discovered, allocated automatically or supplied through configuration in this slice; tests use synthetic references only. Strings, infrastructure IDs, customer names, hostnames and extra resource attributes are refused.

Distinct local references can distinguish two records' writer contexts without adding metric dimensions. They do **not** prove global uniqueness, trusted origin, lifecycle ownership, restart continuity or replicated Collector routing. References convey no tenant/customer/authentication authority. A future deployment-owned assignment/mapping contract, privacy review and multi-replica single-writer proof remain hard gates before network-capable export. Do not serialize these local references as production identity merely because the type exists.

## No-op, test sink and failure containment

The default no-op accepts only gate-approved records and returns `accepted / discarded`. It performs no I/O, storage, queueing, timer, retry or flush. Invalid input returns `rejected / privacy_policy` before sink invocation. These results deliberately distinguish refusal from intentional discard.

The [test sink](../../server/test/helpers/telemetry-export-sink.ts) exists only under test infrastructure and is excluded from the production build. It accepts approved records only, defaults to eight slots, permits an explicit test capacity of 1–64, retains the first records and drops new arrivals once full with `dropped / capacity`. Snapshot arrays and records are immutable. It writes neither files nor network. No environment variable or runtime discovery can activate it.

The boundary catches reflective validation failures and synchronous sink exceptions, returning only `failed / sink_failure` for sink faults or malformed output. `accepted / consumed` is a generic extension/test acknowledgement, not evidence of remote delivery. No automatic diagnostic logging, rejected payload storage or retry is added. Future operational accounting must consume bounded result codes under separately reviewed logging/rate limits; current request paths are not modified to do so.

This is not a JavaScript sandbox: proxies can execute traps during reflection, and a deliberately injected callback can block or perform arbitrary work. Only the reviewed synchronous no-op is the default; the only supplied alternative is the bounded test helper. There is no promise/async sink contract. Future transport must establish independent cancellation, queue/retry/flush bounds rather than treating exception catching as failure isolation.

## Exact consumer and package boundaries

The [consumer guard](../../server/test/unit/telemetry-contracts.test.ts) adds exactly these edges:

- `src/observability/telemetry-export.ts` → `src/observability/telemetry-contracts.ts`
- `src/observability/telemetry-export.ts` → `src/observability/metric-label-policy.ts`

The [tracing boundary guard](../../server/test/unit/request-tracing-boundary.test.ts) likewise registers only the new filename and its two exact imports in its closed observability-module inventory. All prior edges remain. In particular, the exact `src/integration/integration-telemetry.ts` consumer remains authorized for its existing two policy targets; there is no directory or prefix allowance, new integration import, or reverse dependency.

The reachable production graph consists of those three pure modules only. The [AST suite](../../server/test/unit/telemetry-export-boundary.test.ts) recursively follows exact imports, permits only reviewed calls and the weak-set constructor, and rejects external dependencies, re-export/dynamic-loading escapes and ambient I/O. Negative fixtures cover HTTP/HTTPS, net/TLS/DNS, fetch/axios/gRPC, OTLP/Azure/Application Insights, filesystem/child_process, sockets and aliases. A separate scan prevents production imports of the test sink. The lockfile check rejects exporter/backend packages. This proves the inspected default source graph has no network/persistence capability; it does not certify arbitrary future injected code.

No package or configuration file changes. Existing OpenTelemetry dependencies remain API 1.9.1, resources/tracing/metrics SDKs 2.12.0, with core 2.12.0 and semantic conventions 1.43.0 transitively. Existing dependencies are reused through an ignored worktree junction; no package installation occurred. No endpoint, credential or exporter-kind setting was introduced.

## Validation

Commands use Node v24.19.0 and installed local tool entry points corresponding to the repository scripts; no installation was necessary.

| Check                        | Invocation and final outcome                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused unit/regression      | From `server/dist-test/test/unit`: `node --test --test-concurrency=1 telemetry-export.test.js telemetry-export-boundary.test.js telemetry-contracts.test.js request-tracing.test.js request-tracing-boundary.test.js request-metrics.test.js request-metrics-boundary.test.js logging-sanitization.test.js` — 63 passed, 0 failed/skipped |
| New coverage within that run | 12 export behavior tests and 4 AST/package/build-boundary tests; not additional tests beyond the 63                                                                                                                                                                                                                                       |
| Health/logging E2E           | From `server/dist-test/test/e2e`: `node --test --test-concurrency=1 health.e2e.test.js logging.e2e.test.js` — 3 passed, 0 failed/skipped                                                                                                                                                                                                  |
| Typecheck                    | From `server`: `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` — final source passed                                                                                                                                                                                                                                     |
| Build                        | `node node_modules/typescript/bin/tsc -p tsconfig.build.json` — final source passed                                                                                                                                                                                                                                                       |
| Test compile                 | `node node_modules/typescript/bin/tsc -p tsconfig.test.json` — final source passed                                                                                                                                                                                                                                                        |
| Full backend lint            | `node node_modules/eslint/bin/eslint.js .` — final source passed                                                                                                                                                                                                                                                                          |
| Documentation/format         | Changed-file Prettier; 11 relative links; 9 unique heading anchors; whitespace/control-character and private-value pattern checks passed                                                                                                                                                                                                  |
| Scope/diff                   | `git diff --check` passed; exactly seven allocated files; no package/configuration or F062 changes                                                                                                                                                                                                                                        |

The first unit invocation, before the four new AST tests were included, finished **57 passed / 2 failed / 0 skipped**. One failure was the existing closed observability inventory lacking the new filename; it was updated with only the new file and its two reviewed policy imports. The other was the logging startup subprocess returning no exit status after its existing 10-second timeout while compile/lint activity was concurrent. The final complete focused invocation above passed with the unchanged timeout and assertions. This does not relabel the first invocation as passing. An intermediate four-test AST-only run also passed and adds no distinct coverage.

The first full lint invocation reported four new-code findings: three optional-chain preferences and one unused initial assignment in a test. All were corrected; the final full lint run passed. Successful intermediate compilations are not extra test counts.

There are **66 distinct passing tests** across the final unit invocation and E2E invocation, not a repository-wide suite claim. Tests use synthetic records and mocked database health fixtures. No database, query or schema change exists, so the database suite was not run and is not required. Shared/frontend modules are unaffected; those suites were not run. No dependency tree check was required because package files are unchanged; installed OpenTelemetry versions and the locked no-exporter package boundary were verified. Health/logging E2E HTTP requests are test traffic, not telemetry transport.

## Remaining gates and stopping point

Production export remains **NOT safe to activate**. Writer identity across application and gateway replicas, authenticated verified TLS to a fixed private Collector, numerical receive/queue/memory/retry/flush limits, backend histogram/temporality compatibility, processor policy and operational ownership remain unresolved. Azure Monitor is optional, with target support/preview status and client/security/operations approval still required. No Azure backend readiness is claimed.

Only the local implementation commit is authorized after validation. No push, deployment, Collector configuration or F061.2C-2 work is authorized or performed.

**STOP FOR F061.2C-1 REVIEW.**
