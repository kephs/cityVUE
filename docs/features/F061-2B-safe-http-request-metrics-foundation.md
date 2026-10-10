# F061.2B — Safe HTTP Request Metrics Foundation

**NO PRODUCTION METRICS EXPORTER IS CONFIGURED BY F061.2B.**

Status: implemented and validated locally; awaiting F061.2B review. Stop for F061.2B review after the authorized local commit. No push, deployment or F061.2C work.

## Baseline and allocation

Fetched authoritative origin/main and verified HEAD, origin/main and FETCH_HEAD at
`c2b7dcaffcd2d5aa32dbe6a403ba9dc37fe2966c`. Main and the new isolated
`codex/f061-2b-request-metrics` worktree started clean, 0 ahead / 0 behind.
The fetch succeeded with a stale-worktree cleanup permission warning; no other
worktree was repaired or changed. Tracking state is the last fetched state, not
proof of subsequent remote changes.

The baseline includes [F061.1 privacy contracts](F061-1-telemetry-schema-privacy-foundation.md),
the F061.1A exact reviewed consumer boundary and
[F061.2A request tracing](F061-2A-opentelemetry-request-tracing-foundation.md).
F062, integration persistence, migrations, grants, ADRs and their index are
outside this allocation. No UI, authentication, authorization, audit, Pino
sanitization, correlation ownership or health semantics change.

## Dependency and configuration

Adds only official `@opentelemetry/sdk-metrics`, pinned to `2.12.0`, matching
existing resources/tracing SDK `2.12.0`. Its API peer range is
`>=1.9.0 <1.10.0`, satisfied by existing `@opentelemetry/api@1.9.1`.
Its core/resources dependencies reuse the existing `2.12.0` packages.
No package upgrade, exporter, cloud monitoring SDK, auto-instrumentation or
logging SDK is added. Installation used npm with scripts disabled in the
isolated worktree. Tests use a manual in-memory MetricReader subclass supplied
by the SDK; no extra test dependency or export transport is needed.

`REQRO_REQUEST_METRICS_ENABLED=false` is the default in the Joi validation,
typed configuration and example environment. Explicit `true` enables local
instrument calls; invalid boolean configuration is rejected by normal startup
validation. A runtime initialization failure disables metrics and preserves
API startup. Operators need no configuration change for default behavior.

The private MeterProvider has an explicit fixed resource containing only
`service.name=cityvue-api`, and no readers in application wiring.
There is no global provider registration, resource discovery, periodic reader,
exporter, metrics endpoint or environment-driven exporter loading.
Enabling the flag alone does not retain accessible measurements or send them
anywhere. Existing OTLP placeholder configuration remains unused.

## Instruments and label schema

| Instrument                           | Type                                                   | Unit        |
| ------------------------------------ | ------------------------------------------------------ | ----------- |
| `reqro.http.server.requests`         | Counter, one per observed completion/abort             | `{request}` |
| `reqro.http.server.request.duration` | Histogram, elapsed middleware-to-completion/abort time | `ms`        |

Duration uses `performance.now()`, not wall-clock subtraction. Histogram
boundaries are 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000 and 10000 ms, plus
the overflow bucket. These are foundational aggregation choices, not SLO
targets. No redundant error counter is added: statusClass distinguishes error
responses and no-response events. Status alone does not establish user-success
eligibility or distinguish legitimate refusal from a dependency outage.

Both instruments use exactly:

| Label           | Permitted values                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `method`        | GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, other                                                                                     |
| `routeTemplate` | F061.1 enum: /api/v1/service-requests, /api/v1/service-requests/:serviceRequestId, /api/v1/health/live, /api/v1/health/ready, unmatched |
| `statusClass`   | 1xx, 2xx, 3xx, 4xx, 5xx, no_response                                                                                                    |

Health values remain in the authoritative enum but are excluded by this
producer. The full schema budget is 8 × 5 × 6 = 240 combinations, within
F061.1's 256 limit. Adding outcome would exceed that budget; no new policy,
dimension or relaxed limit is introduced. Histogram buckets and multiple
instruments add storage beyond this label-combination budget; no fleet-wide
capacity claim is made.

Every label set passes the existing
[metric-label validator](../../server/src/observability/metric-label-policy.ts)
before reaching the runtime, and again at the SDK adapter boundary.
Unknown labels and unapproved values fail closed without echoing their content.
The F061.1 policy source files are unchanged.

PII, request/response bodies, raw URL/path/query, parameters, Host/forwarded
Host, headers, authorization/cookie, arbitrary errors/stacks/SQL/vendor content,
Organization/customer/tenant identity or hostname, request/resident/connector/
integration-intent/aggregate/resource/external-record IDs, operator/Entra
identity and correlation/trace/span IDs are never metric labels. The middleware
does not read these fields. It passes ROOT_CONTEXT to instruments; no tracing
context or exemplars are implemented.

## Route, health and completion behavior

Only Express's matched `request.route.path` is considered, after routing.
It must equal an explicit F061.1 template; all unknown, absent, array-valued or
raw/query-bearing paths map to `unmatched`. Templates are not inferred from
raw URLs and the starter route catalog is intentionally incomplete. Future
route additions need policy review.

Exactly the F061.2A templates `/api/v1/health`, `/api/v1/health/live` and
`/api/v1/health/ready` are excluded. No separate probe metric is created.
An unmatched request is counted as unmatched even if its raw URL resembles a
probe; raw URL text is never inspected. Early responses without a trusted
matched route cannot be classified as health probes.

The middleware follows logging and tracing and precedes tenant resolution,
preserving existing correlation generation and request handling order. It
observes response finish or close once, removes both listeners and records a
bounded status class. An abort or invalid status maps to `no_response`.
Durations must be finite and nonnegative. Disabled mode performs no clock
read, listener registration or request inspection.

Initialization, observation/recording and shutdown failures are contained.
Telemetry errors never become labels or diagnostics containing private data.
Metrics are best effort and do not satisfy authoritative audit; failures can
lose measurements. There is no persistence or delivery guarantee.

## Exact consumer boundary

The existing reviewed integration consumer remains
`src/integration/integration-telemetry.ts`; its policy access and every
approved F061.2A edge remain unchanged. New exact edges are:

- `src/app.module.ts` → `src/observability/request-metrics.module.ts` and `src/observability/request-metrics.middleware.ts`.
- `src/observability/request-metrics.module.ts` → `src/observability/request-metrics.ts` and `src/observability/request-metrics.middleware.ts`.
- `src/observability/request-metrics.middleware.ts` → `src/observability/request-metrics.ts`.
- `src/observability/request-metrics.ts` → `src/observability/telemetry-contracts.ts` and `src/observability/metric-label-policy.ts`.

No directory is allowed wholesale. Synthetic negative edges prove that nearby,
nested and unrelated consumers still cannot import policy. SDK imports remain
confined to the exact tracing/metrics adapters. Metrics does not import F062.

## Validation

Commands used Node v24.19.0 and local tool entry points equivalent to the
repository scripts. npm was invoked through its installed npm-cli.js because
npm was not on this shell's PATH.

| Check                                                | Result                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| New metrics runtime and boundary tests               | 14/14 passed                                                                                      |
| F061.1/F061.1A privacy and consumer tests            | 10/10 passed                                                                                      |
| F061.2A tracing and boundary tests                   | 15/15 passed after inventory update                                                               |
| Health unit tests                                    | 3/3 passed                                                                                        |
| Environment and serving configuration regressions    | 55/55 passed (14 + 41)                                                                            |
| Logging sanitization unit regression                 | Supplemental run 8/8 passed                                                                       |
| Real AppModule health and HTTP logging E2E           | 3/3 passed, including final-source rerun                                                          |
| Backend typecheck, production build and test compile | All passed on final source                                                                        |
| Full backend ESLint                                  | Final run passed                                                                                  |
| npm dependency tree                                  | Full npm ls --all and focused OTel tree passed                                                    |
| Formatting                                           | Changed-file Prettier passed; lockfile retains npm-generated formatting                           |
| Documentation and scope                              | Three relative links resolve; whitespace/private-value pattern checks and git diff --check passed |

Final selected unit invocation from server/dist-test/test/unit:
`node --test --test-concurrency=1 request-metrics.test.js request-metrics-boundary.test.js telemetry-contracts.test.js request-tracing.test.js request-tracing-boundary.test.js health.service.test.js environment.test.js serving-environment.test.js`
passed **97/97**, zero failed/skipped.
The separate `node --test --test-concurrency=1 logging-sanitization.test.js`
passed **8/8**, zero failed/skipped.
From server/dist-test/test/e2e,
`node --test --test-concurrency=1 health.e2e.test.js logging.e2e.test.js`
passed **3/3**, zero failed/skipped.
These cover **108 distinct tests**, not a repository-wide full-suite claim.

Preserved initial results: the first selected 50-test invocation passed 48,
failed two, skipped zero. The closed observability inventory initially lacked
the three new metrics modules; its exact inventory/import entries were added.
The existing logging startup-sanitization test's main.js subprocess returned
null instead of exit 1 under its unchanged 10-second timeout. This matches the
timing failure documented in F061.2A; no host root cause is claimed. The
supplemental 8/8 logging run does not rewrite the initial failure.
The initial full lint found eight new-code/test style/type-rule findings;
they were corrected and full lint rerun passed. No assertion or timeout was
weakened to obtain a pass.

Final compiler commands from server were
`node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`,
`node node_modules/typescript/bin/tsc -p tsconfig.build.json` and
`node node_modules/typescript/bin/tsc -p tsconfig.test.json`.
Full lint used `node node_modules/eslint/bin/eslint.js .`.

The default-runtime network sentinel test observes zero calls to net.connect,
net.createConnection, tls.connect, http.request, https.request and fetch during
initialization, recording and shutdown. Source/import and lockfile tests prove
the reviewed runtime has no exporter/network client, vendor monitoring SDK,
auto-instrumentation or F062 dependency. The in-memory tests verify normalized
labels, request counts and duration, private-field omission, unknown-label
rejection, excluded health routes and failure containment.

The 14 changed files are the feature record; server package manifest/lockfile
and .env.example; app.module.ts; config/configuration.ts and
config/environment.ts; the three new observability/request-metrics modules;
two new request-metrics unit test files; and the existing
request-tracing-boundary.test.ts and telemetry-contracts.test.ts.
F061.1 policy and the three tracing runtime files match the baseline exactly.
Read-only inspection of Claude's active worktree found only disjoint
database/outbox/migration allocation. No F062, database, migration, grant or
ADR/index file changed here.
Only synthetic Nest/Supertest requests and manual in-memory collection are
used. Real AppModule health tests override DatabaseService; no live database,
identity, vendor or telemetry service is used.

No shared or frontend files are affected, so the shared/React suites are not
required. No database, query or schema changes exist; the database suite is
not executed.

## Deferred work

Production export and collection health, export failure accounting, exemplars,
additional route vocabulary, integration/outbox/connector/database/dependency
metrics, Azure/Application Insights/OTLP, dashboards, alerts and approved
SLI/SLO targets remain separate work. Integration metrics can follow F062.2C
only through the F061-owned boundary. This foundation does not establish
production observability readiness.
