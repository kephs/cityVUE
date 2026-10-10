# F062.1 — Enterprise integration contracts foundation

Originally developed on baseline `6f44fdf0baac5508041528b8f5ed52a448837abc`, then **synchronized onto authoritative `main` `001cac968b71b008b482ab5a9476bec3d218dc0f`**, which carries the approved [F062 architecture](F062-enterprise-integration-eventing-architecture.md) together with F061.1, F061.1A and F061.2A. The branch is a direct descendant of that commit and holds one unpublished feature commit; the temporary work-in-progress commit used during reconciliation was squashed away and does not survive in the final history.

**Status: implemented, pending review. This slice is deliberately inert.** It adds TypeScript contracts and tests and nothing else — **no outbound network access, no inbound endpoint, no credential, no secret, no transport, no broker or queue, no worker, no database table, no migration, no persistence, no vendor SDK and no connector implementation.** Inertness is the deliverable, and it is asserted from the emitted module graph rather than claimed in prose. No ADR number is allocated. **Production deployment remains unauthorized.**

## Contract surface

Seven modules under `server/src/integration/`, re-exported through one entry point so the boundary suite can resolve the whole graph from a single place.

| Module | Contract |
| --- | --- |
| `integration-envelope.ts` | The provider-neutral envelope; the closed `INTEGRATION_TYPES` vocabulary with each entry's declared contract kind; `ContractKind`; `AggregateType`; `EventOrigin`; the closed failure taxonomy; validation; replay rules |
| `connector-capabilities.ts` | The closed capability contract, `SideEffectRisk`, `OrderingGuarantee`, `NO_CAPABILITIES`, and ambiguity resolution |
| `delivery-contract.ts` | `DeliveryState`, `AttemptOutcome`, terminal and resident-visible sets, and the connector lifecycle vocabulary |
| `fact-authority.ts` | `FactAuthority`, `FactAuthorityRegistry`, per-field write authorization, and echo detection kept separate from it |
| `schema-compatibility.ts` | Version negotiation for dispatch and for replay, and the change-classification rules |
| `connector-registry.ts` | `ConnectorPort`, `ConnectorRegistry`, and the intentionally empty `EMPTY_CONNECTOR_REGISTRY` |
| `integration-telemetry.ts` | Integration telemetry *semantics only*: the concepts, unit lookup and dimension mappings, delegating all label policy to F061.1 |

### The decisions the code enforces

**At-least-once with idempotent processing.** Stated in the envelope module's contract comment; no exactly-once distributed execution is claimed anywhere.

**The two contract kinds are enforced, not documented.** `INTEGRATION_TYPES` declares each type's kind as *data*, `assertEnvelope` refuses an envelope whose declared `contractKind`, `aggregateType` or `schemaVersion` disagrees with the vocabulary, and an immutable `event` without an `aggregateRevision` is refused because it could not be reconstructed as of a revision. A caller therefore cannot relabel current mutable state as a historical event, which is the misuse F062 §3.2 exists to prevent.

**Replay preserves the original semantic version.** `isReplayable` is true only for `event`; `redispatchSchemaVersion` returns the *recorded* version for an event and the *current* version for a `state_sync` intent. `negotiateReplayVersion` **refuses** when a connector has dropped the recorded version rather than re-encoding the intent into a newer contract.

**`ambiguous` is distinct from both success and failure**, and `destination_timeout` is deliberately **absent** from the transient set — a timeout may already have mutated the destination. `resolveAmbiguity` short-circuits to operator review for `irreversible` and `physical` side effects **even when an idempotency key exists**, because safe to retry in the protocol is not the same as safe to repeat in the world.

**`origin` and `causationId` are loop-prevention evidence, not authorization.** `wouldEcho` answers only "is this an echo?" and is deliberately a free function rather than a method on `FactAuthorityRegistry`, so the two questions cannot be conflated at a call site. `mayWriteFact` fails closed on an **undeclared** fact, refuses any write to a `reqro`-owned fact, and refuses a connector writing another connector's fact — each with a distinct cause, because an out-of-authority write is a security-relevant event rather than a data-quality one. Exactly one authority per fact is enforced at construction, so dual-master ambiguity introduced by configuration order is impossible rather than invisible.

**AI is an actor, never an authority.** There is deliberately no `ai` variant of `FactAuthority`, so no fact can be owned by a model; `factAuthorityKinds()` exports the closed list so the property is testable.

**The registry is empty and fails closed.** No default connector, no catch-all, no first-registered fallback and no substitution on miss. `resolve` returns a discriminated result, so a caller cannot read a connector off a miss by accident.

**F061 owns metric-label policy; F062 owns integration meaning.** An earlier draft of `integration-telemetry.ts` maintained its own permitted and prohibited label lists. That was a competing policy, and it was also wrong: it listed `connectorId` as a *permitted* metric label, while F061.1 classifies `connectorId` as a `restrictedAttribute` whose `restrictedAttributePolicy.metricLabels` is `forbidden`. That draft would have emitted a label the platform forbids.

The independent policy is **deleted, not duplicated**. The module imports F061.1's `validateMetricLabels` and `assertIntegrationLabels` delegates to it, so exactly one authority decides what may become a label. `INTEGRATION_METRIC_CONCEPTS` is drawn from F061.1's `metricConcepts` and typed `satisfies readonly MetricConcept[]`, so a name F061 does not define cannot be used and a rename there is a compile error here rather than a silent divergence. Units are read from F061.1's declaration rather than restated.

Consequently F062 cannot admit `connectorId`, `organizationId`, customer or tenant hostname, integration intent ID, aggregate ID, external record ID, `correlationId`, `causationId`, `traceId`, `spanId`, resident PII, tracking credentials or raw vendor error and status payloads as metric labels — not because F062 restates the prohibitions, but because it no longer owns a policy with which to disagree. **No F061-owned file was modified by this slice.** The reviewed-consumer allowlist admitting `src/integration/integration-telemetry.ts` was added by the separately authorized F061.1A slice and is already present on `main`.

What remains F062's is the mapping F061 cannot own. `outcomeDimension` sends `ambiguous` to `pending` rather than to `failed` or `succeeded`, because an ambiguous attempt is unresolved and reporting it as either would assert something nobody observed. `failureReasonDimension` maps the finer integration taxonomy onto F061's bounded `reason`, sending a category with no closer value to `unknown` rather than inventing a dimension value F061 does not define; the precise category survives in the delivery record.

`NO_TELEMETRY` records **nothing** rather than emitting zeros, because F061 requires unimplemented SLIs be marked not implemented and a zero would read as health. `integrationSlisImplemented()` returns `false`.

## Boundary results

`test/unit/integration-boundary.test.ts` resolves the **complete transitive module graph** from the compiled entry point and asserts both sets by **equality**, the method F060.3C-2c-1 established. Equality rather than absence matters: a forbidden-token list only catches dangers somebody enumerated, whereas equality catches a newly reachable module even when it sits in no forbidden directory.

| Assertion | Result |
| --- | --- |
| Internal graph equals the reviewed closed set | 10 modules: this slice's 8, plus exactly the 2 named F061.1 observability contract modules |
| **External imports equal `[]`** | **No package at all** — not even a Node builtin |
| No transport, persistence, credential, auth, tenancy or Nest module reachable | pass |
| No `pg`, `kysely`, HTTP client, broker client, cloud SDK, OpenTelemetry or Application Insights package reachable | pass |
| No I/O, process, child-process, worker or timer builtin reachable | pass |
| No runtime I/O, scheduling, `process.env`, `fetch`, `eval` or dynamic `require` in executable code | pass |
| No vendor name in executable code | pass |
| No SQL, DDL, `Kysely` or `Pool` in the slice | pass |
| Observability admission is **two named files**, not a directory | pass |
| Dependency direction is one-way: no F061 module imports F062 | pass |

**The empty-external assertion is the strongest available statement of inertness** and subsumes most of the rest: nothing can reach an HTTP client, a database driver, a broker or a cloud SDK without importing it.

**The two admitted observability modules are enumerated by filename, never by directory.** `ALLOWED_OBSERVABILITY_MODULES` lists `observability/metric-label-policy.js` and `observability/telemetry-contracts.js` and nothing else, so a future F061 module does not become reachable by sitting in the same folder, and the F062 allowlist did not weaken into `observability/**` to accommodate the reconciliation. The admission is sound only because both F061.1 modules are themselves dependency-free: importing them adds no package, which is why the external set is still exactly `[]` and no OpenTelemetry, Azure Monitor, Application Insights, exporter or cloud monitoring schema enters the F062 graph. F061.2A's tracing modules, which *do* carry OpenTelemetry, are deliberately **not** admitted.

Direction is asserted as well as composition: integration imports the observability contract and never the reverse. F061.1 imports nothing from F062 and is unaware of it.

Source-content scans apply to `F062_MODULES` only. The observability modules belong to another workstream and are not this slice's to police — scanning them would have made F062 the de facto reviewer of F061 code it is forbidden to change.

Two tests were narrowed after false-positiving on documentation, recorded rather than smoothed over: the vendor scan flagged the telemetry module's own comment stating that OpenTelemetry and Azure Monitor types are prohibited, and the runtime-I/O scan needed the same treatment. Stating a rule is not breaking it, so both now scan executable code with comments and string literals removed — the same correction this repository has had to make before.

## Validation

| Gate | Result |
| --- | --- |
| `integration-contracts` + `integration-boundary` | **39/39**, 0 skipped |
| Backend unit suite, serial | see completion report |
| Root shared suite | 64/64 |
| F061.1 `telemetry-contracts` (incl. the F061.1A allowlist) | 10/10 |
| F061.2A `request-tracing` / `request-tracing-boundary` | 11/11 / 4/4 |
| `logging-sanitization` | 7/8 on first invocation, then **8/8 on three consecutive reruns**; see below |
| Root shared suite | 64/64 |
| typecheck / lint / build / test compile | pass |
| `git diff --check` | clean |
| changed-file formatting | see the pre-existing line-ending condition below |

**The one `logging-sanitization` failure was a host-timing flake, and is reported as a failed invocation rather than overwritten by the reruns.** The test spawns `src/main.js` with a 10-second `spawnSync` budget and asserts exit status 1; the first invocation returned status `null` because the child was killed at the budget. Measured directly on identical input, that startup took 6.2 s, 10.0 s and 22.5 s on three consecutive runs, so the budget is marginal on this host. Attribution was tested rather than assumed: the same suite passes 3/3 at `main` `001cac9` **and** 3/3 on this branch, and the compiled `main.js` graph resolves to 187 modules of which **none** is under `src/integration` — nothing this slice adds is on the startup path, so it cannot influence that timing. F061.2A's tracing modules are on that path, but they are not this slice's to change. No timeout was raised and no assertion weakened.

**Formatting:** `prettier --check` fails repo-wide for a pre-existing reason — `core.autocrlf=true` with no `.gitattributes` yields a CRLF working tree while the configured default is `lf`. Untouched `main`-owned files (`telemetry-contracts.ts`, `metric-label-policy.ts`, `main.ts`) fail identically. With CRLF accepted, all ten changed TypeScript files pass. The remaining difference in this document is markdown table-column padding; `docs/` is outside the repository's `format:check` globs and every sibling `docs/features/` file uses the same unpadded style, so it was left consistent with the established convention rather than reformatted.

**No database suite was required or run:** this slice adds no persistence, schema or query code, and the boundary suite asserts that structurally. Migration count remains **49**.

## Naming

The core is provider-neutral. No vendor name, schema, identifier, API-specific status value or vendor authentication concept appears in any contract, asserted by test over executable code.

Legitimate industry terminology is **not** categorically avoided — that was an overreach corrected during F062 review. `WorkItem` is used as the neutral abstraction because it keeps Reqro's model independent of whichever destination a client runs, not because "work order" is a forbidden phrase.

## What this slice does not do

No outbound call, no inbound route, no credential, no secret, no transport, no queue or broker, no worker, no retry loop, no dead-letter implementation, no reconciliation worker, no table, no migration, no persistence, no vendor adapter, no cloud resource, no deployment and no ADR allocation. The `ConnectorPort.dispatch` signature exists as a type; the only connector-shaped objects anywhere are two test stubs whose `dispatch` rejects.

## Next

**F062.2 (outbox and worker) is not authorized by this slice** and remains blocked on the F062 architecture's open items — the dead-letter policy decision, and, for any real connector, obtaining the destination's actual API documentation. Nothing here should be read as approval to begin it.

## Related

- [F062 — Enterprise integration reliability and eventing architecture](F062-enterprise-integration-eventing-architecture.md)
- [F061 — Enterprise observability and resilience readiness](F061-enterprise-observability-resilience-readiness.md) — owns the observability architecture this slice emits toward
- [F061.1 — Telemetry schema and privacy foundation](F061-1-telemetry-schema-privacy-foundation.md) — **owns metric-label policy**; this slice delegates to it, and its F061.1A amendment admits `integration-telemetry.ts` as a reviewed consumer
- [F061.2A — OpenTelemetry request tracing foundation](F061-2A-opentelemetry-request-tracing-foundation.md) — present on the baseline; deliberately **not** admitted into the F062 graph
- [ADR-026 — Outbound notification and delivery architecture](../architecture/decisions/ADR-026-outbound-notification-delivery-architecture.md) — the precedent generalised
- [ADR-001 — Organization isolation](../architecture/decisions/ADR-001-organization-isolation.md)
