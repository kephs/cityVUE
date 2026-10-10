# F061.1 — Telemetry Schema & Privacy Foundation

Status: implementation awaiting F061.1 review. This slice defines permitted telemetry content; it does not enable telemetry collection or export. No F061.2 work is authorized by this record.

## Baseline and scope

Fetched authoritative `origin/main` and created isolated branch `codex/f061-1-telemetry-contracts` in `.local-uat/f061-1-telemetry-contracts` at `6f44fdf0baac5508041528b8f5ed52a448837abc`. The new worktree/index were clean, 0 ahead / 0 behind. That baseline includes the integrated [F061 assessment](F061-enterprise-observability-resilience-readiness.md) and F062 architecture. The tracking reference is a last-known remote state after that fetch, not a claim about subsequent remote changes.

The allocation is two additive modules in `server/src/observability`, one unit test and this record. No F062 files, connector/event schema, ADR/index, logging implementation, startup wiring, application consumers, package manifest or lockfile changed. Claude's F062.1 allocation remains separate.

## Signal and authority contract

[Telemetry contracts](../../server/src/observability/telemetry-contracts.ts) distinguish four evidence kinds:

| Kind                | Responsibility                              | Authoritative audit evidence |
| ------------------- | ------------------------------------------- | ---------------------------- |
| Operational log     | Existing sanitized Pino application logging | No                           |
| Trace               | Future OpenTelemetry distributed traces     | No                           |
| Metric              | Future OpenTelemetry metrics                | No                           |
| Authoritative audit | Reqro security/business audit storage       | Yes                          |

`TelemetrySignal` excludes audit. `TelemetryEvidence` requires `satisfiesAuthoritativeAudit: false`; `AuthoritativeAuditRequirement` forbids telemetry substitution. These declarations do not validate or persist audit records and cannot prove an audit was written. Existing required-audit behavior remains authoritative. OpenTelemetry JavaScript logging is not the logging authority for this phase.

`CorrelationReferences` keeps `reqroCorrelationId`, `w3cTraceId` and `w3cSpanId` separate. The existing server-generated Reqro UUID remains application-owned; existing logging still uses its existing `requestId` field and `x-correlation-id` response behavior. These descriptive string fields neither validate identifiers nor parse/emit headers. Inbound trace context grants no tenant, authentication or audit identity authority. Future outbound propagation requires an approved contract. None of these IDs may be metric labels.

## Privacy and cardinality

`metricDimensions` is a frozen positive allowlist: environment, service, component, route template, HTTP method, status class, operation, outcome, reason, endpoint class, dependency class, release cohort and health signal. Every value is an explicit finite enum. The starter route vocabulary uses real controller templates, including `/api/v1/service-requests/:serviceRequestId`; it is intentionally incomplete. Future route additions require review, never discovery from raw URLs. `unmatched` is bounded. `releaseCohort` uses current/previous/unknown rather than unbounded build hashes, tags or version strings; it does not identify a specific deployment.

The explicit prohibited catalog covers resident names, email, phone, address, bodies, authorization/token/cookie, tracking credentials, attachment claims, query strings, raw URLs/paths, error text, Host/forwarded-host, database connection strings, secrets/API keys, Graph and external-system payloads. Metrics additionally prohibit service-request/resident IDs, correlation/trace/span IDs, external record IDs and job/run IDs. This is not permission to put resident identifiers in other telemetry: the existing sanitizers and privacy review still apply. Unknown names and aliases are refused even if absent from the descriptive prohibited catalog.

Organization IDs, customer/tenant hostnames, connector IDs, operator identities and Entra object IDs are restricted. They cannot be metric dimensions here. Any future trace/log use requires explicit privacy and operations review, including access and retention controls. No restricted value is promoted into the safe vocabulary.

[Metric label policy](../../server/src/observability/metric-label-policy.ts) contains one pure validator, declared as a constant, to make refusal behavior testable without an SDK or runtime integration. It accepts only own enumerable data properties on plain/null-prototype objects, checks both names and enum values, returns a detached frozen label snapshot, and returns only bounded reasons on rejection. Ordinary accessors are refused without evaluation. Reflective failures are caught without serializing error content; arbitrary JavaScript proxies may execute their own traps during reflection, so this is not a sandbox for executing untrusted code.

The conservative initial budget is at most four labels and at most 256 possible combinations for a submitted label set, calculated from complete enum sizes. These are implementation guardrails, not approved production capacity or reliability numbers. They do not bound total fleet cardinality, combinations across different schemas, histogram buckets or future instruments. Instrument-specific label selection, aggregate series budgets and exporter filtering require future review. TypeScript structural types alone cannot reject extra properties on arbitrary runtime objects: future metric producers must use the validator at the boundary. It is not currently connected to any producer.

## Metrics, SLIs and sanitized reasons

Closed metric concepts cover request counts/duration/errors, readiness, dependency latency/failure, tenant resolution, operator execution, and integration delivery latency/retries/dead letters/reconciliation failures/connector health. Units are provider-neutral count, milliseconds or outcome. No instruments, measurements, exporters, event envelope, delivery semantics or F062 schema are defined. F062 may consume these observability concepts under its separately approved contract.

`SliDefinition` describes identifier, description, numerator/denominator concepts and populations, measurement window category, tenant-deployment/platform scope, maintenance handling, dependency-failure inclusion, owner status and provisional/approved target status. No target percentage or SLO engine is supplied. Free-form descriptive fields and approval references are design metadata, not allowed telemetry attributes or evidence that approval occurred. Actual windows, targets, error budgets, burn alerts, owners and maintenance eligibility require later approval under F061.

The bounded reason vocabulary follows existing sanitized closed-code patterns. It includes tenant status/reason concepts such as invalid authority, unknown host, untrusted forwarded peer and registry unavailable, plus generic timeout/dependency failure/unknown. It does not import or alter security/logging enums, inspect exceptions or replace existing log sanitization. A future explicit bridge must map trusted existing codes to approved categories and use a bounded unknown category for unmapped values, never raw error messages. Existing [log sanitization](../../server/src/common/logging/log-sanitization.ts) and [server correlation generation](../../server/src/common/logging/request-logging.middleware.ts) remain unchanged.

## Validation and evidence

The [focused tests](../../server/test/unit/telemetry-contracts.test.ts) exercise accepted values, forbidden/restricted/high-cardinality names, unsafe values under approved names, malformed/accessor inputs, independent cardinality limits, immutable copies, signal/audit separation, distinct correlation references and SLI metadata. Compile-time negative assertions prevent audit-as-telemetry and correlation-as-label assignments.

Commands use the installed Node v24.19.0 runtime and local tool entry points corresponding to the server package scripts; no dependency installation is required. Results:

| Check                          | Invocation / outcome                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                     | `tsc -p tsconfig.json --noEmit`; initial and final-source invocations passed                                                                                                                                                                                                                                            |
| Backend build                  | `tsc -p tsconfig.build.json`; initial and final-source invocations passed                                                                                                                                                                                                                                               |
| Test compile                   | `tsc -p tsconfig.test.json`; initial and final-source invocations passed                                                                                                                                                                                                                                                |
| Focused and logging regression | From `server/dist-test/test/unit`: `node --test --test-concurrency=1 telemetry-contracts.test.js logging-sanitization.test.js`; initial invocation 17 passed, 0 failed/skipped (9 F061.1 + 8 existing logging tests); final-source rerun also 17 passed, 0 failed/skipped                                               |
| Lint                           | Full backend `eslint .` initially failed with exactly two new-file findings: unnecessary assertion and redundant conditional. Both fixed; `eslint src/observability test/unit/telemetry-contracts.test.ts` passed. Full lint was not repeated; focused success does not relabel the initial full invocation as passing. |
| Formatting / documentation     | Changed-file Prettier passed; all six relative links resolve; no tabs or trailing whitespace                                                                                                                                                                                                                            |
| Diff / scope                   | `git diff --check` and staged `git diff --cached --check` passed; exact four-file scope and synthetic-fixture/credential-pattern review passed                                                                                                                                                                          |

Repeat focused invocations are not additional distinct test coverage. No repository-wide green suite is claimed. Shared/React/API E2E/database suites were not run because no consumer, endpoint, shared module or persistence changed.

The AST boundary test permits only the local contracts import and reviewed pure built-in calls, rejects constructor calls/re-exports and checks production consumers against a closed reviewed allowlist (see the amendment below). Together with the scoped diff, this verifies no SDK, network, persistence, cloud client, header parser or runtime instrumentation was introduced. This is source-boundary evidence, not deployed telemetry evidence.

No database, query or schema changed; no migration is needed and no database integration suite is required for this allocation. No shared or React files/consumers are affected. No live credentials, infrastructure, production resources or external service were used. Existing installed server dependencies are reused through an ignored worktree junction; no installation occurred.

## F061.1A amendment — reviewed telemetry-policy consumer boundary

**F061.1 initially shipped with zero runtime consumers**, and its AST boundary test asserted that absolutely: no module outside `src/observability` could import these contracts. That invariant was correct while nothing consumed the policy, but zero-consumer status was always temporary — the purpose of a provider-neutral telemetry policy is that application code defers to it instead of inventing its own.

**F062.1 is the first explicitly reviewed consumer.** It reached this boundary for a substantive reason: its own draft maintained a competing metric-label policy that classified `connectorId` as a *permitted* label, which F061.1 forbids. Deferring to this module is the correction, and it keeps exactly one authority for what may become a metric label.

**The invariant is now a closed consumer allowlist rather than permanent zero-consumer status.** The allowlist holds exact repo-relative paths, currently one:

```text
src/integration/integration-telemetry.ts
```

`src/integration/` as a whole is deliberately **not** permitted. Only the single integration module that owns the telemetry seam may import the policy, so a future consumer requires another explicit review and an update to that list rather than inheriting access from a neighbouring file. The allowlist is matched on full path, not basename, so a same-named file elsewhere does not qualify.

The boundary test still fails if an unexpected application module imports the contracts, if a reviewed consumer's path differs by so much as a directory, if observability imports integration, if a monitoring-vendor or cloud SDK specifier appears in the contract's imports, or if arbitrary runtime consumers appear. Because F062.1 is still unpublished, its real import cannot be exercised from this branch; the allowlist decision logic is therefore proven directly with synthetic paths, including sibling, nested, relocated-basename and unrelated-area cases, and the end-to-end admission is additionally covered by F062.1's own boundary suite.

**The dependency direction is one-way:** integration → observability contracts, never the reverse. F061.1 remains unaware of F062.

**F061.1 remains the authority for telemetry privacy and cardinality policy.** This amendment changes **no** policy or classification. Unchanged and still in force: `connectorId`, `organizationId`, `customerHostname` and `tenantHostname` remain restricted with `restrictedAttributePolicy.metricLabels = 'forbidden'`; correlation, trace and span identifiers remain metric-forbidden; and every PII and high-cardinality prohibition stands. `telemetry-contracts.ts` and `metric-label-policy.ts` are byte-for-byte unmodified by this slice.

## Remaining work and review boundary

F061.1 supplies contracts only. Future separately authorized slices must choose and wire SDK/exporters, review exact instrumentation and bounded mappings, correlate sanitized Pino output, validate privacy/access/retention, approve SLI/SLO ownership and budgets, and collect recovery/operational evidence. None of that is production-ready from these definitions. No push, deployment, provisioning or F061.2 implementation occurred. Stop for F061.1 review after the authorized single local commit.
