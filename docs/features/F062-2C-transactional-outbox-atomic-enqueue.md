# F062.2C — Transactional outbox and atomic enqueue

Baseline `c2b7dcaffcd2d5aa32dbe6a403ba9dc37fe2966c` (authoritative `main`, carrying [F062.1 integration contracts](F062-1-integration-contracts-foundation.md), the [F062.2A persistence readiness assessment](F062-2A-transactional-outbox-persistence-readiness.md) and [F062.2B connector metadata persistence](F062-2B-connector-metadata-persistence-foundation.md)).

> **NO EXTERNAL DELIVERY IS ENABLED BY F062.2C.**

**Status: implemented, pending review.** This slice adds one PostgreSQL table, its guard, an atomic-enqueue primitive and tests. It adds **no delivery-attempt table, no worker, no claiming, no claim lease or fencing token, no retry, no dead-letter processing, no reconciliation, no inbox, no webhook, no external-reference persistence, no queue or broker, no HTTP client, no vendor adapter, no credential, no secret, no runtime connector-management API, no cloud resource and no deployment change.** No ADR number is allocated. **Production deployment remains unauthorized.**

An outbox row is a durable _intent_. Nothing reads it to dispatch, because no dispatch code exists anywhere in the repository.

## What this slice proves

```text
domain state mutation  +  integration outbox intent  =  ONE PostgreSQL transaction
```

Commit, and both persist. Roll back, and neither does. That is the whole deliverable, and it is proven by database integration test in both directions.

## Migration

**Ordinal 51 — `server/migrations/20261021000000-add-integration-outbox.ts`.** Migration count moves 50 → 51. Exactly one bounded migration, creating exactly one table, asserted by test. No delivery-attempt table, no worker-role grants, and no additional migrations reserved.

Follows the established conventions: raw SQL through kysely's `sql` tag, an `/** Ordinal N. ... */` header naming the governing decision, `set local lock_timeout` with an explicit `lock table`, `clock_timestamp()`, `varchar` + `check (x in (...))` rather than PostgreSQL enum types, and a `down()` that refuses rather than discarding evidence.

## Schema — `integration_outbox`

| Column                                    | Type                                             | Notes                                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                      | `uuid pk default gen_random_uuid()`              | this row                                                                                                                                |
| `organization_id`                         | `uuid not null`                                  | immutable                                                                                                                               |
| `integration_connector_id`                | `uuid not null`                                  | composite FK; **not nullable**, so there is no shared or default destination                                                            |
| `integration_id`                          | `uuid not null`                                  | the intent identity consumers deduplicate on, **and the dedupe key**                                                                    |
| `contract_kind`                           | `varchar(10) not null`                           | `event` / `state_sync`                                                                                                                  |
| `integration_type`                        | `varchar(64) not null`                           | F062.1 vocabulary, enforced as a tuple with the three below                                                                             |
| `schema_version`                          | `integer not null check (> 0)`                   |                                                                                                                                         |
| `aggregate_type`                          | `varchar(20) not null`                           | `service_request` / `work_item` / `attachment`                                                                                          |
| `aggregate_id`                            | `uuid not null`                                  |                                                                                                                                         |
| `aggregate_revision`                      | `integer check (> 0)`                            | required for `event`, by constraint                                                                                                     |
| `origin_kind`                             | `varchar(8) not null`                            | `reqro` / `external` — loop-prevention evidence, never authorization                                                                    |
| `origin_connector_id`                     | `uuid`                                           | composite FK; biconditional with `origin_kind = 'external'`                                                                             |
| `correlation_id`                          | `uuid not null`                                  |                                                                                                                                         |
| `causation_id`                            | `uuid`                                           |                                                                                                                                         |
| `deployment_environment`                  | `varchar(30) not null`                           | `check (~ '^[a-z][a-z0-9-]{2,30}$')`, matching F062.1's `ENVIRONMENT`, so a staging intent cannot be accepted by a production connector |
| `payload_mode`                            | `varchar(28) not null`                           | see [Payload-mode restrictions](#payload-mode-restrictions)                                                                             |
| `pinned_connector_configuration_revision` | `integer not null check (> 0)`                   | the **semantic** pin — see below                                                                                                        |
| `state`                                   | `varchar(16) not null default 'pending'`         | full F062.1 delivery vocabulary, with only `pending` reachable                                                                          |
| `occurred_at`                             | `timestamptz not null`                           | `check (occurred_at <= created_at)`                                                                                                     |
| `created_at`                              | `timestamptz not null default clock_timestamp()` | guard-assigned                                                                                                                          |

Keys: `unique (organization_id, id)` — exposed so the future delivery-attempt table can carry a composite tenant-safe reference — and `unique (organization_id, integration_connector_id, integration_id)`.

**No speculative dispatch fields.** There is deliberately no `claim_token`, `claim_generation`, `claimed_by`, `claimed_until`, `attempt_count` or `next_attempt_at`. F062.2A specifies those, and they belong with the slice that implements claiming and fencing: adding them now would ship half a worker's state with nothing to populate or enforce it. A source test asserts none of those names appears in this slice.

**No payload, and no business data.** The envelope carries none — F062.1 lists `payload` and `body` among `PROHIBITED_ENVELOPE_FIELDS` — and this table holds only identifiers, closed vocabulary members, integers and timestamps.

## Tenant isolation

Structural, not procedural, and proven by test:

| Property                                    | Mechanism                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization ownership on every row         | `organization_id uuid not null`, immutable                                                                                                                                                                                                                                   |
| No connector reference across Organizations | `foreign key (organization_id, integration_connector_id) references integration_connector(organization_id, id)` — the **pair** is the referent, so an intent in A cannot name B's connector: the row would have to carry B's `organization_id`, at which point it is B's row |
| Origin connector likewise                   | the same composite FK shape on `origin_connector_id`                                                                                                                                                                                                                         |
| No shared or default connector              | `integration_connector_id` is `not null`; there is no catch-all row and no fallback                                                                                                                                                                                          |
| No cross-tenant existence disclosure        | the repository returns `connector_unknown` for both "no such connector" and "another Organization's"                                                                                                                                                                         |

The forged reference was attempted two ways in test — through the repository and by direct insert — and both are refused, with nothing written.

## Connector semantic revision pinning

**Every intent pins `integration_connector.configuration_revision`, never `record_revision`.** F062.2A §9.2 resolves a past ambiguity against the capabilities that governed it, and F062.2B established that a credential rotation advances `record_revision` while changing no capabilities. Pinning the record revision would therefore pin a number with no semantic content.

**The pin is proven, not assumed.** PostgreSQL cannot express this as a foreign key: F062.2B's semantic-snapshot uniqueness is a **partial** unique index (`where revision_advanced`), and an FK requires a complete unique constraint. A narrowly scoped guard is the structurally sound mechanism, and **F062.2B is left unchanged** rather than redesigned for convenience. The guard enforces three things on insert:

1. the connector exists **and is owned by the intent's Organization**;
2. the pinned revision **equals the connector's current** `configuration_revision` — a stale pin is refused, not silently recorded;
3. that revision **names a real authoritative semantic snapshot** in `integration_connector_audit` (`revision_advanced = true`).

Check 3 is defence-in-depth: F062.2B's own constraints make a missing snapshot unreachable through ordinary code, so the test reaches that state only by deliberately disabling the audit immutability trigger — and says so.

### The read-then-pin race

```text
enqueue reads connector revision N  →  connector changes to N+1  →  enqueue records N
```

Closed at the database, not by application discipline: **the guard share-locks the connector row** inside the caller's transaction (`select ... for share`). A concurrent configuration change takes `FOR UPDATE` and therefore waits until the enqueuing transaction ends, so the pinned revision is still current at commit. Combined with check 2, a mutation that does land first makes the insert fail rather than producing a stale pin. There is no last-write-wins path.

The repository also reads the connector `FOR SHARE` before inserting, which is what produces the bounded `connector_unknown` and `connector_retired` refusals; the guard is the boundary.

**Lock ordering.** Enqueue deliberately does **not** re-acquire the Organization lock. ADR-024 puts the authority barrier first, before the domain row; taking it again inside enqueue — which runs after the domain mutation — would acquire an authority lock _after_ a domain row lock, which is the ordering ADR-024 warns against. The caller owns that barrier and must have completed it. The connector lock is a new lock on a table no domain path touches, so it introduces no deadlock pair.

**Enqueue eligibility follows F062.1 `mayEnqueue`:** only a `retired` connector refuses new intents. A `disabled` connector accumulates, because disabling is an outage rather than a decision to discard.

## Payload-mode restrictions

F062.2A's fail-closed policy, unweakened. Two named constraints:

```sql
constraint integration_outbox_no_historical_reference
  check (payload_mode <> 'historical_reference'),
constraint integration_outbox_no_approved_snapshot
  check (payload_mode <> 'approved_snapshot'),
check ((contract_kind = 'state_sync') = (payload_mode = 'current_state_projection'))
```

`historical_reference` is refused because **no declared event type has proven historical reconstructability** (F062.2A §2.2). `approved_snapshot` is refused because snapshot retention is unapproved — it is the one mode that would put business data, and therefore potentially resident PII, into an integration table.

**The consequence, stated plainly: no declared `event` type is enqueueable at all.** An event requires a historical basis, both historical modes are refused, and the third mode contradicts its contract kind. The only enqueueable type today is `work_item.sync_requested`, the one `state_sync` entry — which is exactly the F062 contract for desired-state synchronization, representing current approved state by reference and projected at attempt time. **No new payload mode was invented.**

The TypeScript side derives this rather than restating it: `enqueueableIntegrationTypes()` is computed from `requiredPayloadMode(contractKindOf(type))`, so it cannot disagree with the policy, and a test asserts every event type is refused with `payload_mode_unavailable`.

## Contract-kind and integration-type parity

The pairing is enforced as a whole tuple, so relabelling is not expressible:

```sql
check ((integration_type, contract_kind, aggregate_type, schema_version) in (
  ('service_request.submitted',      'event',      'service_request', 1),
  ('service_request.status_changed', 'event',      'service_request', 1),
  ('service_request.closed',         'event',      'service_request', 1),
  ('work_item.assigned',             'event',      'work_item',       1),
  ('work_item.sync_requested',       'state_sync', 'work_item',       1)
))
```

A caller cannot label an immutable event as current-state synchronization, or the reverse, or pair a type with the wrong aggregate or schema version — all four are tested.

**There is no second semantic mapping to drift.** `EnqueueIntentInput` deliberately has **no** `contractKind`, `aggregateType`, `schemaVersion` or `state` field: the repository derives all four from `INTEGRATION_TYPES`, so a caller cannot supply a pairing at all. A parity test then reads the live constraint from `pg_constraint` and asserts that every declared type appears with exactly its declared kind, aggregate and version, **and that the constraint names no type F062.1 does not declare** — equality in both directions.

## Initial state and inertness

**Every intent begins `pending`**, which is F062.1's first delivery state. A caller cannot choose:

- the guard **refuses** a supplied state that is not `pending` — refused rather than silently overwritten, because a caller that passed `accepted` has a bug and quietly storing `pending` would hide it;
- `constraint integration_outbox_state_inert check (state = 'pending')` is the declarative backstop if the guard were ever disabled;
- **every UPDATE is refused** by the guard, so no transition is reachable at all.

**This is deliberately not half a state machine.** The column's domain is the full F062.1 delivery vocabulary, so parity holds and a future slice adds no new states — but delivery progression is inert. Implementing transitions now would allow a row to be marked delivered with nothing recording what was attempted, because the delivery-attempt table does not exist yet. The dispatch slice drops `integration_outbox_state_inert` **by name** and introduces the transition guard, the attempt table and fencing together, which is the only safe grouping.

## Immutability

The guard refuses **every** UPDATE, DELETE and TRUNCATE on the table. Fifteen separate rewrite attempts are tested — state, organization, connector, integration ID, contract kind, integration type, schema version, aggregate identity, aggregate revision, origin, correlation and causation identity, payload mode and pinned revision, plus delete and truncate — and all are refused with the row left untouched.

**There is no ordinary UPDATE or DELETE repository primitive**, asserted by source test over the repository module. Controlled transitions belong to the worker slice; retention remains separately governed, as F062.2A §17.1 specifies.

## Deduplication

`integration_id` serves as the dedupe identity **directly**:

```sql
unique (organization_id, integration_connector_id, integration_id)
```

No separate `dedupe_key` column exists, because a second field expressing the same invariant is a second thing that can disagree. The required property holds — Organization + connector + intent cannot be enqueued twice — and **fan-out is permitted by construction**: the same `integration_id` to a _different_ connector is a different key, which the test exercises.

The identity is a Reqro-minted UUID. It is explicitly **not** derived from a resident identifier, email, phone, tracking credential, resident-facing reference number or any free-form text.

## Atomic enqueue API

```ts
enqueueIntegrationIntent(transaction, input);
```

**The transaction is a parameter, and that is the mechanism.** A version that opened its own transaction, or reached for a shared client, would be a dual write — the exact failure the outbox pattern exists to prevent, and it would lose intents silently rather than loudly.

It is a **free function rather than a repository method** for the same reason: a method on an injected repository holding its own `DatabaseService` invites precisely the mistake of using that connection instead of the caller's.

Three source assertions hold this in place: the signature must take `transaction: Kysely<DatabaseSchema>` first; the module must contain no `.transaction()` call anywhere; and **every query in the enqueue path must be rooted on `transaction`**, asserted by counting — if any query were rooted elsewhere, the query count would exceed the transaction-rooted count.

The `OutboxRepository` class provides only the two reads this slice justifies: `findById` and `findByIntegrationId`, both Organization-scoped. **No global list, no resident or staff endpoint, no worker scan, no ready-item scan, no retry query and no dead-letter query** — those belong to later slices.

## Commit and rollback proof

Both proven against PostgreSQL, using an existing safe domain table (`department`) in a synthetic Organization. **No production domain service was modified and no real business event was wired.**

| Case         | Assertion                                                                               | Result |
| ------------ | --------------------------------------------------------------------------------------- | ------ |
| **Commit**   | one transaction: insert a department, enqueue an intent, commit → **both rows exist**   | pass   |
| **Rollback** | one transaction: insert a department, enqueue an intent, throw → **neither row exists** | pass   |

The rollback case is the one that matters: without the outbox, the intent would either be lost or dispatched for a domain change that never happened.

## No real business-event producer

**Nothing in production calls the enqueue primitive.** No `ServiceRequestService`, no catalog, admin, attachment, resident-experience, alert, access, AI, notification, tenancy, auth, geospatial, eligibility or health code references it — asserted by a source test that walks all fourteen domain directories under `src/` and requires zero references to `enqueueIntegrationIntent` or the outbox repository module.

This slice proves the durable mechanism, not the product event policy. Each real producer needs its own payload and authority review, and F062.2A records that no event type is even eligible yet.

## Privacy

Every persisted column is an identifier, a closed vocabulary member, an integer or a timestamp.

**Not persisted anywhere, and structurally absent:** resident name, email, phone, street address, any resident PII, tracking credentials, authorization tokens, connector credentials, secrets, raw HTTP request or response bodies, raw vendor errors, vendor payloads, and any free-text column. The outbox is **not** permission to create a shadow copy of Reqro business data; desired-state synchronization carries the references the approved contract requires and nothing more.

A source test asserts the slice's executable code references no `process.env`, `apiKey`, `clientSecret`, `accessToken`, `refreshToken`, `password`, `authorization`, `bearer` or `credential_reference`.

## Correlation and telemetry

`correlation_id` and `causation_id` are persisted because the F062 envelope contract requires them — `causation_id` is the input to loop prevention (F062 §9.3). They are **not** turned into metric labels: F061.1 classifies `correlationId` and `causationId` among `restrictedAttributes` whose `metricLabels` policy is `forbidden`, and **F061 remains the telemetry and privacy authority**.

**No OpenTelemetry SDK dependency enters persistence.** A source test asserts these files reference no `@opentelemetry`, `applicationinsights`, `OTLP`, `metricLabels` or `validateMetricLabels`.

## Grant disposition

**No grant file was modified.** `deploy/database/runtime-role.sql` and `operator-role.sql` are untouched, matching every migration in this repository.

The safe intermediate posture holds: **the table's existence enables no runtime capability.** With no default privileges in the bootstrap, a new table is unreachable until granted deliberately, so `reqro_runtime` holds nothing on `integration_outbox`. Database tests connect as the test owner into a disposable schema, so they exercise real constraints without depending on runtime grants.

**The future minimum application requirement, documented and deliberately not granted:**

```sql
-- deploy/database/runtime-role.sql, when a reviewed producer exists
grant select, insert on :"schema".integration_outbox to :"runtime";
```

`INSERT` to enqueue, and `SELECT` because the repository's `RETURNING` idiom requires it. **No `UPDATE` and no `DELETE`** — the application must remain structurally incapable of advancing delivery state or erasing an intent.

Enqueue additionally needs row-lock privilege on `integration_connector` for the guard's `FOR SHARE`, which PostgreSQL grants through `UPDATE` on at least one column (measured in Migration 49). That is a real consequence worth reviewing: it is also the grant F062.2B reported for connector metadata, so the two requirements coincide rather than compound.

**No worker role is created**, and F062.2A §19.1's worker-identity decision remains open and still gates the dispatch slice.

## Rollback safety

| Step                            | Result                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Apply                           | schema usable; an intent enqueues                                                                         |
| Rollback with retained evidence | **refused** — `Retained integration outbox intents prevent rollback`; the intent survives                 |
| Privileged test cleanup         | guard disabled deliberately, rows removed, guard re-enabled                                               |
| Rollback                        | table and guard dropped; **the connector registry is untouched** — nothing cascades into F062.2B evidence |
| Reapply                         | schema usable again; a fresh intent enqueues in `pending`                                                 |

## Tests

### Database integration — `test/database/integration-outbox.integration.test.ts`, **14/14 passing**

Schema behaviour is asserted with direct SQL so a passing result cannot depend on application code; the atomicity proofs deliberately run through `enqueueIntegrationIntent`, because the property under test is that the primitive joins the caller's transaction.

| Proof                                                                                              | Result |
| -------------------------------------------------------------------------------------------------- | ------ |
| Valid enqueue, with derived contract and pinned semantic revision                                  | pass   |
| Organization-scoped connector reference; forged cross-tenant refused two ways                      | pass   |
| Stale pinned semantic revision refused; nonexistent revision refused                               | pass   |
| Record revision cannot be pinned in place of the semantic one                                      | pass   |
| Revision with no authoritative snapshot refused                                                    | pass   |
| Duplicate intent for one connector refused; fan-out to another connector permitted                 | pass   |
| `historical_reference` and `approved_snapshot` both unavailable; no event type enqueueable         | pass   |
| Event/synchronization relabelling refused, both directions; aggregate and version mismatch refused | pass   |
| **SQL type pairing equals the F062.1 contract**, read from `pg_constraint`, both directions        | pass   |
| Delivery vocabulary equals F062.1 while only `pending` is reachable                                | pass   |
| Caller-supplied initial state refused                                                              | pass   |
| Fifteen immutability attempts refused, including delete and truncate                               | pass   |
| Retired connector accepts no new intents                                                           | pass   |
| **Atomic commit: domain mutation + intent both persist**                                           | pass   |
| **Atomic rollback: neither persists**                                                              | pass   |
| Migration apply → rollback refused → cleanup → rollback → reapply → usable                         | pass   |

### Unit and source boundary — `test/unit/outbox-contract.test.ts`, **22/22 passing**

Payload-mode policy; enqueueable-type derivation; every event type refused; contract derived from F062.1 and not caller-supplied; unknown type refused first; initial state is F062.1's `pending`; environment grammar; external origin validation; `state_sync` needs no aggregate revision; closed refusal vocabulary with no tenant-existence code.

Source assertions over executable code (comments and string literals stripped, so a stated prohibition does not flag itself): the enqueue signature takes the caller transaction, the module opens no transaction, and every enqueue-path query is transaction-rooted; no `updateTable` or `deleteFrom`; **no worker, scan, claim, lease, attempt-count, retry or dead-letter surface**; no network client, broker or vendor SDK; no vendor product name (14 checked, including BlueDAG, Impresa, MGO and Microsoft); no credential or secret access; **no F061 telemetry SDK**; **no production domain wiring across all 14 domain directories**; persistence unreachable from the F062.1 entry point and the dependency one-way; the contract module free of database dependencies; the migration creates only the outbox table, grants nothing and alters no existing table.

### Regression

| Suite                                                     | Result                                   |
| --------------------------------------------------------- | ---------------------------------------- |
| F062.1 `integration-contracts` + `integration-boundary`   | **39/39 unchanged**                      |
| F062.2B connector database / unit                         | 18/18 / 23/23                            |
| `database-role-separation`                                | 17/17 — canonical grant matrix unchanged |
| `runtime-reference-locks` / `tenant-domain-operator-role` | 16/16 / 28/28                            |
| **Full backend unit suite**                               | **891/892**, 0 skipped — see below       |
| Root shared suite                                         | 64/64                                    |
| typecheck / full lint / build / test compile              | pass                                     |

**Three existing suites required an inventory update.** `database-role-separation`, `runtime-reference-locks` and `tenant-domain-operator-role` count the compiled migration files and assert the total; adding a migration legitimately changes it from 48 to 49, and the first also names the total in its title (50 → 51). Those three assertions were updated and nothing else in them was touched. Six other suites filter to migrations earlier than `20261018000000` and are unaffected by design.

**One unit test fails for a pre-existing environment reason.** `development-startup`'s "configured development compiler initializes the complete Nest application" ends in `spawnSync ETIMEDOUT` against a fixed 60-second budget. The compiled `main.js` module graph is still exactly **187 modules with no F062.2C module in it**, so nothing this slice adds is on the startup path; the same test fails at `origin/main` on this host, as recorded in F062.2B. **No timeout was raised and no assertion weakened.**

**Nine database suites were not executed.** They assert a specifically provisioned test database (`/reqro_f0592_test` as `reqro_test_user`) that the available `TEST_DATABASE_URL` does not point at, so they fail their own environment guard before running any assertion. None of those files is modified by this slice. Reported as **not executed, never as passed**; no credential was invented and no database provisioned.

## Remaining work

- **The grant change above** must be reviewed before any runtime code enqueues an intent.
- **A reviewed business-event producer.** No event type is eligible until F062.2A's approved-snapshot decision or an exact reconstruction invariant exists, so the first producer is blocked on that, not on mechanism.
- **The dispatch slice** owns the delivery-attempt table, claim/lease/fencing, the transition guard and dropping `integration_outbox_state_inert`. It remains blocked on **both** the worker identity and grant decision (F062.2A §19.1) and the maximum-pending-age policy.
- Operator read surfaces, the aggregate-lookup index and the dead-letter index are deliberately absent: no query in this slice needs them, and F062.2A ruled out speculative indexes.

## Related

- [F062 — Enterprise integration reliability and eventing architecture](F062-enterprise-integration-eventing-architecture.md)
- [F062.1 — Enterprise integration contracts foundation](F062-1-integration-contracts-foundation.md) — the vocabularies this table binds to
- [F062.2A — Transactional outbox persistence readiness](F062-2A-transactional-outbox-persistence-readiness.md) — the assessment this implements the second bounded migration of
- [F062.2B — Connector metadata persistence foundation](F062-2B-connector-metadata-persistence-foundation.md) — the connector and semantic-snapshot history this pins against
- [ADR-001 — Organization isolation](../architecture/decisions/ADR-001-organization-isolation.md) — the composite tenant-safe reference pattern
- [ADR-024 — Transaction-time request authorization](../architecture/decisions/ADR-024-transaction-time-request-authorization.md) — the lock ordering the enqueue path respects
- [ADR-026 — Outbound notification and delivery architecture](../architecture/decisions/ADR-026-outbound-notification-delivery-architecture.md) — the precedent F062 generalises
