# F061.2A — OpenTelemetry Request Tracing Foundation

Status: implemented and validated locally; awaiting F061.2A review. **NO production exporter is configured by F061.2A.** No push, deployment, provisioning or F061.2B work is authorized by this record.

## Baseline and coordination

Fetched and verified authoritative `refs/remotes/origin/main` and local `main` at `c55dc2492ae23d71cac72dbeaf5db49553a7996a`, the F061.1 merge. Both matched and main was clean before editing. Created isolated `codex/f061-2a-request-tracing` in `.local-uat/f061-2a-request-tracing`, initially clean and 0 ahead / 0 behind. Claude's inspected F062.1 allocation was confined to integration contracts, tests and its feature report. No F062 file, connector/event contract, ADR/index, tenant-resolution implementation, authorization, audit, operator/PIM or production ingress file is changed here.

This implements the next explicitly authorized slice after [F061.1](F061-1-telemetry-schema-privacy-foundation.md), under the [F061 architecture](F061-enterprise-observability-resilience-readiness.md). F061.1's provider-neutral contracts remain unchanged; its AST test now allows only the explicitly reviewed tracing wiring while retaining purity checks for both core contract files. New boundary tests cover the runtime adapter separately.

## Dependencies

The repository uses a separate npm manifest/lockfile for the Nest 11 backend. Installed Nest core/common/platform-express remain 11.2.3; validation uses Node 24.19.0, compatible with the repository's existing engine range. Added exactly these pinned direct dependencies:

| Package                    | Version | Purpose                                                                        |
| -------------------------- | ------- | ------------------------------------------------------------------------------ |
| `@opentelemetry/api`       | 1.9.1   | Server span kind/status and explicit root context                              |
| `@opentelemetry/sdk-trace` | 2.12.0  | Explicit tracing provider/sampler; bundled in-memory exporter for tests        |
| `@opentelemetry/resources` | 2.12.0  | Construct a fixed resource without default host/process/environment enrichment |

New locked transitive packages are `@opentelemetry/core` 2.12.0 and `@opentelemetry/semantic-conventions` 1.43.0. No existing dependency version changed. These SDK packages support Node `^18.19.0 || >=20.6.0`; API supports `>=8.0.0`. The official [SDK package transition](https://github.com/open-telemetry/opentelemetry-js/blob/main/packages/opentelemetry-sdk-trace-base/README.md) identifies `sdk-trace` as the replacement for the older split tracing SDKs. The [official instrumentation guide](https://opentelemetry.io/docs/languages/js/instrumentation/) informed the explicit-instrumentation boundary; installed package types/source are authoritative for the pinned constructor options.

Installation used isolated npm 12.2.0 tooling in ignored local scratch, `--save-exact --ignore-scripts --no-audit --no-fund`. The worktree has its own dependencies, not a writable link into another checkout. No auto-instrumentation, Node all-signals SDK, OTLP/Azure/Application Insights exporter, metrics SDK, logs SDK or cloud package was added.

## Configuration and lifecycle

`REQRO_REQUEST_TRACING_ENABLED` is an explicit boolean validated by the existing Joi environment schema, defaulting to false. The mapped `telemetry.requestTracingEnabled` property is optional for compatibility with existing typed configuration fixtures; missing means disabled. `.env.example` documents false. Invalid boolean configuration is rejected by normal configuration validation; SDK/runtime failures are handled separately and never veto API startup or request processing.

Disabled tracing creates no provider, reads no request fields and attaches no response listeners. When explicitly enabled, the [tracing module](../../server/src/observability/request-tracing.module.ts) creates an isolated adapter with no processors/exporters. Provider initialization, observation and shutdown failures are contained without logging exception details. No additional normal log payloads or transports are introduced.

Existing `OTEL_SERVICE_NAME` and `OTEL_EXPORTER_OTLP_ENDPOINT` placeholders are left unchanged and unused by this adapter. SDK environment exporter/sampler/resource settings do not configure this explicit provider. The service resource is exactly `service.name=cityvue-api`; there is no automatic resource detection. Configured application versions/service names are not copied because their arbitrary strings are not the bounded release cohort in F061.1. An approved deployment/version mapping remains future work.

The provider uses deterministic always-on sampling only after explicit enablement; no production percentage is proposed. Production remains disabled by default. Enabling this foundation allocates/completes local spans but discards them: there is no operational trace collection, retention or export. Test-only processor injection attaches an in-memory exporter. No global provider, context manager or propagator is registered, and the tracing SDK's meter provider remains its no-op default.

## Request boundary and privacy

[Request middleware](../../server/src/observability/request-tracing.middleware.ts) runs after existing request logging assigns the server UUID and before existing tenant resolution. It snapshots the server correlation ID, method and start time. At response `finish` or `close`, it reads only the framework's matched route template and final response status, then creates and ends one server span using the original start time. A once-only guard and listener cleanup prevent double spans. Request behavior and health semantics are unchanged.

This completion-time design deliberately does not establish an active span around handler execution or propagate a parent to downstream work. It covers requests reaching the Nest middleware, including handler/filter errors and route guards, without guessing an early route or reading a concrete URL. Requests terminated before this middleware (for example by an earlier parser/CORS layer) are outside this initial boundary; process termination before completion can lose a span. Future active context/downstream tracing requires separate approval.

The [adapter](../../server/src/observability/request-tracing.ts) projects only:

| Field                       | Allowlist/behavior                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------- |
| Span name                   | Bounded method plus approved route template                                             |
| `http.request.method`       | F061.1 method enum; other values become `other`                                         |
| `http.route`                | F061.1 explicit route-template enum; unknown templates become `unmatched`               |
| `http.response.status_code` | Integer 100–599; sentinel 0 for aborted/unavailable status                              |
| `reqro.outcome`             | `succeeded` below 400, `refused` for 4xx, `failed` for 5xx or missing/aborted status    |
| `reqro.reason`              | `unknown` for failure, otherwise `none`                                                 |
| `reqro.correlation_id`      | Existing server-generated v4 UUID, captured after logging middleware and format-checked |

The initial useful request templates are `/api/v1/service-requests` and `/api/v1/service-requests/:serviceRequestId`; other application routes are represented by `unmatched`, not raw paths. No dynamic route discovery is introduced. At most six projected attributes are emitted; SDK limits cap attributes at eight and each value at 80 characters, with zero span events and links. These are protective implementation limits, not production capacity commitments.

No request/response body, raw URL/query, parameter value, exception message/stack, authorization/cookie, attachment/tracking credential, Host/forwarded chain, database URL/SQL, secret/API key, Graph/vendor payload, resident PII, Organization/customer hostname, Entra object/operator/connector identity is projected. The adapter never queries repositories for enrichment. Existing Pino sanitization and authoritative audit behavior are unchanged. Trace diagnostics never satisfy an audit requirement.

## Correlation, propagation, errors and health

F061.1 permits descriptive trace correlation separately from metrics. Reqro's UUID remains owned by existing request logging and returned through its existing response header. The trace attaches only that existing UUID; it does not replace it or generate an alternative application correlation ID. Trace and span IDs are generated independently by the SDK and not exposed through new response headers or metric labels.

Every span is started with explicit `ROOT_CONTEXT`. Inbound `traceparent`, `tracestate` and `baggage` are never read, extracted or propagated. They cannot affect sampling, parenthood, correlation, tenant/authentication/authorization or audit identity. There is no outbound propagation in this slice.

Span status is `ERROR` only for failed outcomes, otherwise `UNSET`, with no description. There are no exception events. Failures are classified from the final response/abort status rather than inspecting errors or stacks. An unexpected SDK failure is silently contained; telemetry self-diagnostics and rollout visibility remain a future bounded operational design.

Matched `/api/v1/health`, `/api/v1/health/live` and `/api/v1/health/ready` templates produce no spans, including failure responses, avoiding probe noise while leaving health responses intact. They still incur the small listener/time bookkeeping when tracing is enabled because matching happens after middleware entry. Future probe routes must be explicitly reviewed for exclusion; they are not auto-detected from caller paths/headers.

## Validation

Focused tests use a disposable local Nest application with Nest middleware registration and the SDK's in-memory exporter. They cover disabled mode, startup failure, approved attributes, server-owned roots/correlation, sensitive payload/header exclusion, bounded errors/status, health exclusion, unmatched paths, abort completion and runtime/shutdown failure isolation. A separate network-spy test exercises the production factory without an exporter and observes zero HTTP/HTTPS/TCP/TLS/fetch calls. No external collector or cloud account is used.

Preserved intermediate findings:

- Initial selected unit run: **103/104 passed, one failed, zero skipped**. All 14 new tracing/boundary tests passed. The existing logging startup-sanitization test failed because the `main.js` child had null exit status under its unchanged 10-second subprocess timeout. A focused logging rerun was **7/8 passed**, with the same failure.
- Controlled diagnostics using the same child command, synthetic configuration and 10-second limit: feature exited 1 in **6,858 ms**, with the expected sanitized configuration diagnostic and no sentinel disclosure. Clean baseline exited with **ETIMEDOUT/SIGTERM, null status in 10,029 ms**, also with no sentinel disclosure. Baseline worktree HEAD `956e1fe13008ada9273c54f256d1b6c5a2ccfbbf` was verified clean; its tree `07992d98c2892ce8cd79ac8ad0ecdde8c3a88006` is exactly the authoritative starting main tree. This is baseline-reproducible subprocess timing instability, not proof of a host root cause. No timeout or logging test assertion was changed. Diagnostics are supplemental evidence, not a passing test or additional distinct test coverage.
- The initial full lint failed on four non-null assertions in the new test file. These were replaced with explicit assertions. A subsequent full lint passed; final lint after the wiring correction is recorded below.
- Initial real AppModule health E2E: **0/2 passed**, both blocked by the same new Nest middleware injection defect. The tracing module now exports `RequestTracing` as well as its middleware. The focused harness was changed from manual middleware binding to Nest's middleware registration so this injection path is exercised directly. Final results below supersede the defective implementation, not the historical failed invocation.

AST/import tests enforce the dedicated SDK adapter, no cloud/OTLP/logging/auto-instrumentation imports, closed observability imports without F062/DB/tenant enrichment, the narrow request projection, explicit root context and preserved middleware ordering. F061.1's core purity tests and existing logging/configuration/health/tenant regressions are retained.

Final-source validation (installed Node 24.19.0 invoking repository-local tools):

| Check                        | Command / final result                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selected backend unit suites | From `server/dist-test/test/unit`: `node --test --test-concurrency=1 request-tracing.test.js request-tracing-boundary.test.js telemetry-contracts.test.js logging-sanitization.test.js environment.test.js serving-environment.test.js health.service.test.js tenant-resolution-middleware.test.js`: **104 passed, 0 failed/skipped** |
| Real AppModule health E2E    | From `server/dist-test/test/e2e`: `node --test --test-concurrency=1 health.e2e.test.js`: **2 passed, 0 failed/skipped**, database service overridden with a synthetic response                                                                                                                                                        |
| Type-check                   | From `server`: `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`: passed                                                                                                                                                                                                                                               |
| Test compile                 | `node node_modules/typescript/bin/tsc -p tsconfig.test.json`: passed                                                                                                                                                                                                                                                                  |
| Backend build                | `node node_modules/typescript/bin/tsc -p tsconfig.build.json`: passed                                                                                                                                                                                                                                                                 |
| Complete backend lint        | `node node_modules/eslint/bin/eslint.js .`: passed on final source, no diagnostics                                                                                                                                                                                                                                                    |
| Formatting / documentation   | Changed TS/JSON/Markdown files checked with repository Prettier; all five relative links resolve; changed-file whitespace and synthetic-fixture/credential-pattern review passed                                                                                                                                                      |
| Diff / allocation            | `git diff --check` and staged diff check passed; exactly the 13 files below; existing dependency versions unchanged; no overlapping Claude allocation                                                                                                                                                                                 |

Distinct final coverage is **106 tests**, including **14 new tracing/boundary tests**, **9 F061.1 tests**, **8 logging tests**, **73 other affected unit tests** and **2 health E2E tests**. Reruns and diagnostics are not added to that total. The final selected run passed the previously timing-sensitive logging test; earlier failures and baseline evidence remain recorded above. This is not a claim of a full repository-wide suite run.

No database/query/schema changes or migrations; the database integration suite is not required for this slice. No metrics, OTel logging, dashboards, alerts or SLO targets changed. No shared/frontend code changed.

## Exact file allocation

- `docs/features/F061-2A-opentelemetry-request-tracing-foundation.md`
- `server/.env.example`
- `server/package.json`
- `server/package-lock.json`
- `server/src/app.module.ts`
- `server/src/config/configuration.ts`
- `server/src/config/environment.ts`
- `server/src/observability/request-tracing.ts`
- `server/src/observability/request-tracing.middleware.ts`
- `server/src/observability/request-tracing.module.ts`
- `server/test/unit/request-tracing.test.ts`
- `server/test/unit/request-tracing-boundary.test.ts`
- `server/test/unit/telemetry-contracts.test.ts`

## Remaining work

### Final review hardening (before F061.1A synchronization)

The user completed the dependency-tree gate manually on reviewed commit `a0d40ad458f97f111ff1e718e933c0f57f2c9311`: API 1.9.1 deduplicated throughout, resources/SDK 2.12.0, no invalid/unmet packages or incompatible peer warnings. That gate was not rerun; this follow-up changes only two test files and this report, with no dependency or production-code changes.

The original consumer check was split between a directory-skipping F061.1 test and a closed companion boundary test. The F061.1 test now scans **all** source directories, normalizes relative import targets, and permits only these exact source-to-target edges (all paths relative to `server/`):

| Allowed importer                                  | Allowed targets                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/observability/metric-label-policy.ts`        | `src/observability/telemetry-contracts.ts` (pre-existing)                                        |
| `src/observability/request-tracing.ts`            | `src/observability/telemetry-contracts.ts` (only new direct contract consumer)                   |
| `src/observability/request-tracing.middleware.ts` | `src/observability/request-tracing.ts`                                                           |
| `src/observability/request-tracing.module.ts`     | `src/observability/request-tracing.ts`, `src/observability/request-tracing.middleware.ts`        |
| `src/app.module.ts`                               | `src/observability/request-tracing.module.ts`, `src/observability/request-tracing.middleware.ts` |

No directory prefix grants permission. Negative assertions reject a hypothetical future file inside observability, direct contract access by the tracing module/AppModule, and `src/integration/integration-telemetry.ts`. The companion test still independently constrains exact observability files/imports. Dependency direction remains runtime to contracts. Both F061.1 production files are unchanged from the authoritative starting tree, including prohibited correlation/trace/span metric labels and restricted Organization/hostname/operator/connector/Entra classifications.

The existing HTTP test already sends `traceparent`, `tracestate` and `baggage` and proves a new parentless span plus independent server correlation. One added middleware non-interference test supplies all three headers alongside synthetic trusted tenant/staff state. It observes exactly `id`, `method` and framework `route` reads, zero request writes, no header/authority reads, unchanged tenant/staff/authentication input/audit actor/correlation, and a generated span with no parent, trace state, links or leaked authority attributes. This is a focused tracing non-interference proof, not a substitute for authentication, authorization or audit integration tests. No W3C propagation or baggage implementation is added.

Follow-up validation: the affected F061.1/F061.2A suites (`telemetry-contracts`, `request-tracing`, `request-tracing-boundary`) passed **24/24 tests, zero failed/skipped**, using `node --test --test-concurrency=1` against the final compiled tests. Full backend lint (`node node_modules/eslint/bin/eslint.js .`), type-check, build and test compilation passed using the commands above. The first follow-up lint invocation found two callback-style errors in the new negative assertions; those were fixed before the final clean full lint. Changed-file formatting, relative-link validation and `git diff --check` passed. Earlier invocation outcomes above remain historical evidence; repeated tests are not additional distinct coverage. This follow-up adds one distinct test.

Production exporter/network transport, privacy/access/retention review, operational sampling policy, bounded version mapping, active distributed context, outbound propagation, broader reviewed route coverage and production overhead/recovery evidence all remain deferred. This foundation does not establish production observability readiness. Stop for F061.2A review after the authorized single local commit; do not push or begin F061.2B.

### F061.1A synchronization

Rebased unpublished commit `42480d2e6cd39d6ac81b86d0c358c081974384ce` onto fetched authoritative main `3dd27565120ee4a6be100ff53a1d233e82d3426f`, which includes `ae7321edd866a1ed51a75804069294deb4b88599`. The original commit, complete diff and message remain preserved on local backup branch `codex/f061-2a-pre-reconciliation-42480d2`. The only conflict was `server/test/unit/telemetry-contracts.test.ts`.

The final boundary preserves F061.1A's exact reviewed integration consumer, `src/integration/integration-telemetry.ts`, with access only to `src/observability/telemetry-contracts.ts` and `src/observability/metric-label-policy.ts` (paths relative to `server/`). These were the two policy modules present under F061.1A's closed directory inventory. It cannot import any newly added tracing module or an arbitrary future observability target. Synthetic positive and negative checks preserve this authorization even while the real F062 module is absent. F061.1A's exact-path predicate and sibling/directory/other-area refusal assertions remain intact.

The exact tracing/runtime edges in the table above remain unchanged and match the source. Both policies coexist: no directory-wide consumer permission and no prefix grants. The earlier historical refusal of the integration consumer is superseded by this synchronization. F061.1 remains the privacy/cardinality authority; both production policy files and all classifications are unchanged. No F061.1 documentation was edited.

All tracing runtime files, package manifests/lockfile and inbound-header refusal tests are byte-for-byte unchanged from the accepted commit. The manual dependency gate is retained without rerun. Disabled-by-default/no-op behavior, failure containment, server-root context, bounded attributes, existing correlation ownership, health exclusion and no exporter/network telemetry remain unchanged. No metrics, OTel logging, database tracing, cloud backend, migrations or F062 runtime implementation is introduced.

Post-reconciliation validation (Node 24.19.0 invoking repository-local tools):

- Compiled selected run from `server/dist-test/test/unit`: `node --test --test-concurrency=1 telemetry-contracts.test.js request-tracing.test.js request-tracing-boundary.test.js logging-sanitization.test.js`: **32/33 passed, one failed, zero skipped**. F061.1/F061.1A: **10/10**; F061.2A: **15/15** (11 tracing plus four boundary); logging: **7/8**. The logging startup-sanitization subprocess again returned null rather than exit 1 for `main.js` under its unchanged 10-second limit. This matches the already-documented baseline-reproducible timing instability; no timeout/assertion or runtime implementation was changed, and no host root cause is claimed.
- One supplemental logging-only invocation, `node --test --test-concurrency=1 logging-sanitization.test.js`: **8/8 passed, zero failed/skipped**. This does not rewrite the failed selected invocation or add distinct coverage.
- Real AppModule health E2E from `server/dist-test/test/e2e`, `node --test --test-concurrency=1 health.e2e.test.js`: **2/2 passed, zero failed/skipped**, with the existing synthetic database override.
- From `server`: `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`, `node node_modules/typescript/bin/tsc -p tsconfig.test.json`, `node node_modules/typescript/bin/tsc -p tsconfig.build.json`, and full `node node_modules/eslint/bin/eslint.js .`: all passed without diagnostics.
- Changed-file Prettier initially reported Git's CRLF checkout conversion on ten otherwise unchanged files. Working-copy line endings were normalized to LF; the Git content remained unchanged. Final changed-file formatting, relative Markdown links, whitespace and `git diff --check` passed.
- Both F061.1 production policy files match authoritative main exactly. Tracing runtime, package manifests/lockfile and accepted inbound-header tests match the preserved commit exactly. No database/query/schema file changed; no database suite was run. No broad serial backend rerun was required. F061.1 documentation is inherited unchanged from main.

Keep one unpublished feature commit with the original message, `feat(observability): add safe request tracing foundation`. Stop for final F061.2A integration approval; no push or F061.2B.
