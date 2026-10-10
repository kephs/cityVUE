# F062.2A — Transactional outbox persistence design and migration readiness

Baseline `567893abf914f23fa93e8456b17f2a8ba3768d0e` (authoritative `main`, carrying [F062.1 integration contracts](F062-1-integration-contracts-foundation.md) and the accepted [F062 architecture](F062-enterprise-integration-eventing-architecture.md)).

**Status: assessment only, hardened following the F062.2A database architecture review. Nothing implemented, migrated or provisioned.** No migration created, no existing migration modified, no worker, no transport, no queue or broker, no connector, no infrastructure, no grant applied and no ADR number allocated. Migration count remains **49**. The highest existing ADR is **ADR-030**; the implementing slice must take the next unused number from the authoritative index rather than inheriting one from here. **Production deployment remains unauthorized.**

Every convention below was measured against the repository at the baseline commit, not recalled. Counts are stated so a reviewer can re-derive them.

---

## 1. Current database conventions (measured, not assumed)

| Concern | Established convention | Evidence |
| --- | --- | --- |
| Migration form | `YYYYMMDDHHMMSS-kebab-case.ts`, exporting `up`/`down`, raw SQL through kysely's `sql` tag against `Kysely<DatabaseSchema>`. A leading `/** Ordinal N. ADR-0XX ... */` comment states the ordinal and the governing decision | all 49 migrations |
| Tenant key | `organization_id uuid not null`. Only root tables reference `organization(id)` directly; children carry the column and reach tenancy through a composite FK | throughout |
| Composite tenant-safe FK | `foreign key (organization_id, <parent>_id) references <parent>(organization_id, id)` — **123 such clauses**, supported by **18 parents** exposing `unique (organization_id, id)` | `grep` over migrations |
| Enums | `varchar(N) not null check (col in ('a','b'))`. **No PostgreSQL `enum` type is used anywhere**, deliberately: a check constraint is alterable in one reviewed migration, an enum value is not removable | throughout |
| Concurrency | `revision integer not null default 1 check (revision > 0)`, advanced by exactly one, with a trigger refusing any other delta | `tenant_domain`, `service_request` |
| Timestamps | `timestamptz not null default clock_timestamp()` in newer work (**26 files**) versus `now()` (**8 files**, older). `clock_timestamp()` is the current convention because `now()` is transaction-start and collapses distinct events in one transaction | migration bodies |
| Audit tables | `<entity>_audit` keyed `unique(<entity>_id, revision)`, recording `prior_*` and committed state, `actor`, `occurred_at`, and `mutation_txid bigint not null default txid_current()` | `tenant_domain_audit` and 6 others |
| Audit fail-closed | A `create constraint trigger ... deferrable initially deferred` verifies at commit that a matching audit row exists **in the same `txid_current()`**. A mutation without evidence aborts the transaction (**7 files**) | `tenant_domain_audited` |
| Append-only | `create function prevent_<x>_mutation() ... raise exception` plus a row trigger `before update or delete` **and** a statement trigger `before truncate` (**9 files**) | `activity`, `request_operational_activity` |
| Attempt evidence | Attempts that change no state get their **own** append-only table, separate from the revision-keyed audit, with a closed `result` vocabulary and **hashes instead of observed values** | `tenant_domain_verification_attempt` |
| Index naming | Mixed: **28** end in `_idx`, **34** use a descriptive unsuffixed name, and unique indexes commonly end `_unique`. Newer migrations favour the unsuffixed form | `grep` over migrations |
| Migration locking | `set local lock_timeout = '5s'` then `lock table ... in share row exclusive mode` (**36 files** lock, **8** set the timeout explicitly) | `tenant_domain` family |
| Rollback guards | `down` refuses when retained evidence exists: `raise exception 'Retained ... evidence prevents rollback'`. Rollback is **not** assumed to be safe | migrations 45–49 |
| Role separation | Four roles: `reqro_owner` (NOLOGIN, owns everything), `reqro_migrate` (NOINHERIT, `SET ROLE`s to owner), `reqro_runtime`, `reqro_operator`. **Migrations grant no runtime privilege**; grants live in `deploy/database/runtime-role.sql` and `operator-role.sql` | `deploy/database/bootstrap-roles.sql` |
| Grant style | Explicit per-table, categorised by capability: SELECT-only reference reads; **INSERT-only evidence with SELECT deliberately withheld**; SELECT+INSERT immutable records; SELECT+INSERT+UPDATE mutable state; DELETE on exactly four tables. **No `GRANT ALL`, no `ON ALL TABLES`, no default privileges** — a new table is unreachable until granted deliberately | `runtime-role.sql` |
| Schema types | `server/src/database/database.types.ts` (832 lines) binds columns to **domain TS union types imported from the owning module**, so a check constraint and its TypeScript type share one vocabulary | `TenantDomainTable` |
| Not used anywhere | `generated always as identity` (0), table partitioning (0), `SELECT ... SKIP LOCKED` (0) | `grep` over migrations |

**No `integration_*` table exists.** ADR-026's notification work is contracts-only with no persistence, so this is the first durable integration model and there is no prior integration SQL to follow — only the conventions above, which this design reuses rather than replacing.

---

## 2. Historical reconstruction eligibility

F062.1 states that an `event` "asserts that something happened at a revision and must be reconstructable as of that revision", and `redispatchSchemaVersion` returns the **recorded** version for an event. The envelope carries **no payload at all** — `payload` and `body` are both in `PROHIBITED_ENVELOPE_FIELDS`. A stored envelope is therefore a *reference*, and replay depends on Reqro still being able to answer what was true at that revision.

### 2.1 The eligibility rule

> **Historical-reference payload mode is permitted only where the exact historical revision is deterministically reconstructable from database-enforced history.**

Three consequences, each deliberate:

- **"Most fields are recoverable" is not eligibility.** Partial reconstruction produces an event that is *plausible* rather than *faithful*, which is worse than refusing: a destination would receive something presented as a historical fact that nobody can prove was the historical fact. Eligibility is binary.
- **Database-enforced means enforced by the database** — an immutability trigger, a withheld UPDATE grant, a uniqueness constraint, or an append-only evidence table. Not a code comment, not a repository convention, and not a service-layer promise.
- **An application declaration alone can never establish eligibility.** A `payload_mode` value supplied by a caller is a claim, not evidence. Where the schema cannot support the claim, the database must refuse it (§2.3), so a confident application cannot talk its way past missing history.

### 2.2 Current findings: no declared event type is eligible today

| Declared type | Kind | Eligible for historical reference? | Exact blocker, with evidence |
| --- | --- | --- | --- |
| `service_request.submitted` | `event` | **NO** | `description` carries no immutability trigger and the runtime holds table UPDATE (`grant select, insert, update on service_request`), so the original submitted state cannot be reproduced after an edit. The surrounding immutability is real but irrelevant to the verdict: `answer` has `answer_immutable` and no UPDATE/DELETE grant, `location` and `requester_contact` are INSERT-only, and identity, reference number, requester and geography are trigger-immutable — **and it still fails**, because one mutable field in the event's own payload defeats exact reconstruction |
| `service_request.status_changed` | `event` | **NO, not yet sufficient** | `request_operational_activity` is append-only (`request_operational_immutable`, `request_operational_no_truncate`) and carries `request_revision`, `from_status` and `to_status` — but `request_revision` is **nullable** and there is **no** `unique(organization_id, service_request_id, request_revision)`. Only a partial unique on `activity_type = 'request_created'` exists. A revision may therefore map to zero or several rows, so the lookup is not deterministic. This is close to sufficient and would become sufficient given an exact reconstruction invariant (§2.4) — but it is not sufficient now |
| `service_request.closed` | `event` | **NO, not yet sufficient** | Same source and the same two defects as `status_changed` |
| `work_item.assigned` | `event` | **NO** | `service_request_assignment` holds `select, insert, update` with no immutability trigger, and **no historical representation of assignment exists in any table**. There is nothing to reconstruct from, so no invariant could be added without new history |
| `work_item.sync_requested` | `state_sync` | **Not applicable** | Desired-state intents legitimately project current approved state at attempt time (F062 §3.2). Eligibility is a question only for `event` |

**The honest summary: of the four declared `event` types, none currently qualifies for a guaranteed historical-reference contract.** Two are close and blocked on a missing uniqueness invariant; one is blocked on a mutable payload field; one has no history at all.

### 2.3 What the persistence model must therefore do

**Each `event` must use an approved immutable snapshot, or fail closed.** There is no third option and no partial-credit path.

```sql
payload_mode varchar(28) not null check (payload_mode in (
  'historical_reference',      -- event: an exact, database-proven reconstruction invariant exists
  'approved_snapshot',         -- event: an immutable snapshot captured at enqueue, under approval
  'current_state_projection'   -- state_sync only: projected at attempt time
)),
check ((contract_kind = 'state_sync') = (payload_mode = 'current_state_projection')),
check (contract_kind <> 'event' or aggregate_revision is not null),

-- No historical-reference integration type is approved, so the mode is
-- refused outright. This is the whole constraint while the approved set is
-- empty -- there is no IN list, because an empty IN list is not valid SQL.
check (payload_mode <> 'historical_reference'),

-- Snapshot retention is not yet approved, so this is unreachable too.
check (payload_mode <> 'approved_snapshot')
```

**"Empty allowlist" describes the policy state, not literal SQL.** PostgreSQL rejects an empty `IN ()` list as a syntax error, so a constraint cannot express "admitted for none of these types" by enumerating nothing. The correct fail-closed form while the approved set is empty is the unconditional refusal above:

```sql
check (payload_mode <> 'historical_reference')
```

When one or more types become approved, a **later reviewed migration** replaces it with the conditional form, naming the approved types explicitly:

```sql
check (
  payload_mode <> 'historical_reference'
  or integration_type in ('<approved type>', '<approved type>')   -- explicit closed list
)
```

The mechanism is unchanged by the correction, and it is the point: **the eligible-type set lives in the schema and can only grow through a reviewed migration that states the invariant it relies on.** An application cannot widen it, a configuration value cannot widen it, and a future developer cannot widen it by accident — admitting a type means editing a constraint, which means naming the evidence. Both constraints together mean **no `event` is enqueueable at all in the first persistence slice**, which is the correct fail-closed state and is exactly why §23 scopes F062.2C to `state_sync` plus refusal proofs rather than to a live business event.

`approved_snapshot` is F062 Part 17 item 8's "point-in-time payload retention". It is the one mode that puts business data — and therefore potentially resident PII — into an integration table, so it needs privacy, classification and retention approval before the constraint above is relaxed. It is **described here and authorized nowhere.**

### 2.4 What would make a type eligible

For `status_changed` and `closed`, an **exact reconstruction invariant** means a database guarantee that `(organization_id, service_request_id, request_revision)` resolves to exactly one append-only evidence row — a non-null `request_revision` plus that uniqueness. **Both parts are required**: uniqueness over a nullable column still admits rows that match no revision.

That change is to `request_operational_activity`, a table **outside F062's scope**. It is reported as unresolved decision 3 and must not be made inside an integration slice; a tenancy- and lifecycle-critical domain table does not get altered as a side effect of adding an outbox.

For `submitted`, either `description` becomes immutable after submission, or the event's payload contract excludes it — a product and data decision, not an engineering one.

For `work_item.assigned`, assignment history must exist first. No invariant can be asserted over history that was never recorded.

---

## 3. Proposed table set

**Three tables in scope; three deliberately deferred.** The governing rule is that a table is added when something writes it, not for symmetry.

### 3.1 `integration_connector`

One configured logical connector for one Organization. Root table for the integration family, so it references `organization(id)` directly and exposes `unique(organization_id, id)` for children.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid pk default gen_random_uuid()` | |
| `organization_id` | `uuid not null references organization(id)` | immutable by trigger |
| `connector_key` | `varchar(64) not null` | the stable logical name; matches F062.1's `CONNECTOR_ID` regex `^[a-z][a-z0-9-]{2,62}$`. **Unique per Organization, never globally** |
| `connector_kind` | `varchar(40) not null check (...)` | closed vocabulary; **no vendor product name** — `connector_kind` names a capability profile, and the destination's identity lives in deployment configuration |
| `lifecycle_state` | `varchar(12) not null default 'configured' check (lifecycle_state in ('configured','active','degraded','disabled','retired'))` | exactly F062.1's `connectorLifecycleStates` |
| `configuration_revision` | `integer not null default 1 check (> 0)` | advances by exactly one |
| `credential_reference` | `varchar(200)` | **a reference only** — a secret-manager path or name. A check constraint refuses anything resembling a secret (see §16) |
| `accepted_schema_versions` | `jsonb not null default '{}'` | per-type accepted versions, bounded and validated; feeds F062.1 `negotiateVersion` |
| `created_at` / `updated_at` | `timestamptz not null default clock_timestamp()` | |
| `disabled_at` / `retired_at` | `timestamptz` | cross-checked against `lifecycle_state` |

Constraints: `unique(organization_id, connector_key)`, `unique(organization_id, id)`, plus
`check((lifecycle_state = 'retired') = (retired_at is not null))` and
`check(lifecycle_state <> 'disabled' or disabled_at is not null)`.

A `guard_integration_connector()` trigger makes `id`, `organization_id`, `connector_key` and `created_at` immutable, requires the revision to advance by one, refuses DELETE and TRUNCATE outright, and refuses any transition out of `retired`. Credential rotation changes `credential_reference` only — it never changes `id` or `connector_key`, so **rotation cannot change connector identity** and in-flight rows keep pointing at the same connector.

#### What "`integration_connector` (+audit)" means, explicitly

Connector lifecycle, configuration and authority changes **require authoritative audit evidence**. That responsibility is named here rather than left implicit, because a connector row is the thing that decides whether a tenant's data leaves Reqro at all, and a silent change to it is a security-relevant event.

Two mechanisms were considered:

| Option | Assessment |
| --- | --- |
| **A dedicated `integration_connector_audit` table** | **Recommended.** Keyed `unique(organization_id, integration_connector_id, configuration_revision)` with `prior_*` and committed-state columns, `actor`, `occurred_at` and `mutation_txid`, following `tenant_domain_audit` exactly — including the `deferrable initially deferred` constraint trigger that aborts the transaction when a change carries no matching audit row in the same `txid_current()`. Decisive reason: §9.2 needs the connector's **capabilities as of a past revision** to resolve a prior ambiguity safely, so this table is not only an audit trail but the **historical capability record the state machine reads**. A general-purpose audit mechanism would not give per-revision, queryable capability state |
| **An existing Reqro authoritative audit mechanism** | **Recommended in addition, not instead.** The operator and security audit surface remains authoritative for *who authorized what* — see §18. The connector audit table records configuration history; the operator audit records the authorization decision. They answer different questions, have different readers and will have different retention |

The split is deliberate: duplicating operator authorization semantics into an integration table would dilute the security audit, and duplicating per-revision capability state into the operator audit would make the state machine depend on a record designed for humans. **Neither is implemented here**, and the connector audit table is part of bounded migration (a) in §22.

### 3.2 `integration_outbox`

The durable intent, written in the same transaction as the business mutation. Columns mirror `IntegrationEnvelope` exactly, plus delivery bookkeeping.

```sql
create table integration_outbox (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  integration_connector_id uuid not null,
  integration_id     uuid not null,                 -- the envelope identity consumers dedupe on
  integration_type   varchar(64) not null check (integration_type in (...)),
  contract_kind      varchar(10) not null check (contract_kind in ('event','state_sync')),
  schema_version     integer not null check (schema_version > 0),
  aggregate_type     varchar(20) not null check (aggregate_type in ('service_request','work_item','attachment')),
  aggregate_id       uuid not null,
  aggregate_revision integer check (aggregate_revision > 0),
  payload_mode       varchar(28) not null check (payload_mode in (...)),
  deployment_environment varchar(30) not null check (deployment_environment ~ '^[a-z][a-z0-9-]{2,29}$'),
  correlation_id     uuid not null,
  causation_id       uuid,
  origin_kind        varchar(8) not null check (origin_kind in ('reqro','external')),
  origin_connector_id uuid,
  dedupe_key         varchar(200) not null,
  state              varchar(16) not null default 'pending' check (state in ('pending','dispatching',
                       'accepted','acknowledged','retrying','ambiguous','failed_permanent','dead_lettered','refused')),
  state_revision     integer not null default 1 check (state_revision > 0),
  attempt_count      integer not null default 0 check (attempt_count >= 0),
  next_attempt_at    timestamptz,
  claim_generation   bigint not null default 0 check (claim_generation >= 0),
  claim_token        uuid,
  claimed_by         varchar(64),
  claimed_until      timestamptz,
  pinned_connector_revision integer check (pinned_connector_revision > 0),
  last_failure_category varchar(28) check (last_failure_category in (...)),
  occurred_at        timestamptz not null,
  recorded_at        timestamptz not null default clock_timestamp(),
  settled_at         timestamptz,
  unique (organization_id, id),
  unique (organization_id, integration_id),
  unique (organization_id, integration_connector_id, dedupe_key),
  foreign key (organization_id, integration_connector_id)
    references integration_connector(organization_id, id),
  foreign key (organization_id, origin_connector_id)
    references integration_connector(organization_id, id),
  check ((origin_kind = 'external') = (origin_connector_id is not null)),
  check ((contract_kind = 'state_sync') = (payload_mode = 'current_state_projection')),
  check (contract_kind <> 'event' or aggregate_revision is not null),
  check ((state = 'dispatching') = (claim_token is not null)),
  check ((claim_token is null) = (claimed_until is null)),
  check ((claim_token is null) = (claimed_by is null)),
  check (claim_generation = 0 or pinned_connector_revision is not null),
  check ((state in ('acknowledged','failed_permanent','dead_lettered','refused')) = (settled_at is not null)),
  check (state <> 'pending' or attempt_count = 0)
);
```

`integration_id` is kept distinct from `id` deliberately: `id` is the row, `integration_id` is the envelope identity that crosses the boundary and that a destination deduplicates on, and a replay re-dispatches the same `integration_id`. Keeping them separate means a future per-connector fan-out of one business fact does not require reusing a primary key as a wire identifier.

Note `check (state <> 'pending' or attempt_count = 0)` and the three claim biconditionals: the lease and its token are **structurally tied to `dispatching`**, so a row cannot sit claimed in any other state, no state outside `dispatching` can carry a live token, and a crashed worker leaves an unambiguous signal.

`claim_generation` and `claim_token` are the fencing mechanism (§9.1); `pinned_connector_revision` pins the connector semantics the intent was formed against (§9.2). Both are discussed where they are used rather than here.

### 3.3 `integration_delivery_attempt`

Per-attempt evidence, modelled on `tenant_domain_verification_attempt` — including its most important property: **hashes and classifications instead of observed third-party text.**

**The row is created at claim time, before any network call, and completed exactly once (§9).** It is therefore not insert-only: it has precisely two lifecycle points, an **open** row written in the claim transaction and a **settled** row written by whichever path completes it. Settled rows are immutable, and no row may ever be deleted by the application or the worker. The reason this matters is in §9.1: an attempt row that exists only *after* a response can record nothing about a dispatch that never returned one.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid pk default gen_random_uuid()` | |
| `organization_id` | `uuid not null` | |
| `integration_outbox_id` | `uuid not null` | composite FK to the outbox row |
| `integration_connector_id` | `uuid not null` | composite FK; records which connector was attempted, since a retired connector's evidence must survive |
| `attempt_number` | `integer not null check (> 0)` | `unique(organization_id, integration_outbox_id, attempt_number)` |
| `outcome` | `varchar(18) check (outcome in ('succeeded','failed_transient','failed_permanent','ambiguous'))` | exactly F062.1's `attemptOutcomes`. **Null while open**, set once at completion |
| `failure_category` | `varchar(28) check (... in the closed taxonomy)` | `check((outcome = 'succeeded') = (failure_category is null))` |
| `response_classification` | `varchar(24) check (...)` | closed: `accepted`, `rejected`, `no_response`, `transport_error`, `unparseable` — Reqro's classification, never the destination's status value. Null while open |
| `external_reference` | `varchar(200)` | destination-assigned identity, only where safe (§15). `check(external_reference is null or outcome in ('succeeded','ambiguous'))` |
| `idempotency_key_hash` | `char(64) check (~ '^[0-9a-f]{64}$')` | proof a key was used, without storing the key |
| `connector_revision` | `integer not null check (> 0)` | the connector configuration revision in force for **this** attempt (§9.2) |
| `claim_generation` | `bigint not null check (> 0)` | the fencing generation this attempt belongs to, set at claim (§9.1). Completion must match it, which is what fences a stale worker |
| `claim_token` | `uuid not null` | the claim this attempt was opened under. Recorded so ownership is provable from the evidence itself, not only from the outbox row |
| `capability_snapshot` | `jsonb not null` | the bounded capability values that governed the attempt: `supports_idempotency_key`, `supports_read_after_write`, `side_effect_risk`. Validated by check constraint to those keys and their closed value sets |
| `reason_code` | `varchar(40) check (reason_code in (...))` | **A closed, Reqro-owned diagnostic taxonomy** — see §8.1. Not syntax-constrained free text: a value outside the enumerated set cannot be written at all. Null while open |
| `retry_eligible` | `boolean` | the decision as evaluated at completion, retained as evidence rather than recomputed later from a policy that may since have changed. Null while open |
| `started_at` | `timestamptz not null default clock_timestamp()` | set in the claim transaction, **before** the network call |
| `completed_at` | `timestamptz` | **null while open.** `check(completed_at is null or completed_at >= started_at)` |
| `duration_ms` | `integer check (>= 0)` | null while open |
| `correlation_id` | `uuid not null` | |
| `policy_version` | `integer not null check (policy_version = 1)` | the `tenant_domain_verification_attempt` precedent: retry policy is versioned so old evidence stays interpretable |
| `observed_at` | `timestamptz not null default clock_timestamp()` | |
| `mutation_txid` | `bigint not null default txid_current()` | |

**Open versus settled is a structural property, not a convention:**

```sql
-- One coherent definition of "settled". No separate status column to drift.
check ((outcome is null) = (completed_at is null)),
check ((outcome is null) = (response_classification is null)),
check ((outcome is null) = (reason_code is null)),
check ((outcome is null) = (retry_eligible is null)),
check (outcome is null or outcome = 'succeeded' or failure_category is not null),
check (external_reference is null or outcome in ('succeeded','ambiguous')),

-- At most ONE open attempt per outbox row. This is what makes "mark the
-- existing attempt ambiguous" the only possible recovery, because inventing a
-- second open attempt is a constraint violation rather than a judgement call.
create unique index integration_attempt_open
  on integration_delivery_attempt (organization_id, integration_outbox_id)
  where completed_at is null;
```

Mutation is enforced by `guard_integration_attempt()`, a **complete-once** guard rather than the plain append-only trigger used elsewhere:

- **INSERT** must be open: `outcome`, `completed_at` and the other completion columns null.
- **UPDATE** is permitted **only** as the transition open → settled, and only when the updating statement carries the matching `claim_generation`. Identity, `attempt_number`, `started_at`, `claim_generation`, `claim_token`, `connector_revision` and `capability_snapshot` are immutable.
- **UPDATE of a settled row raises**, so a completed attempt — including one recovery completed as `ambiguous` — can never be overwritten.
- **DELETE and TRUNCATE raise**, subject to §17.1's approved-retention path.

This is a deliberate, documented departure from the pure append-only pattern at line-item 1's `Attempt evidence` convention, and the departure is what buys crash evidence. The immutability guarantee that matters is preserved exactly: **a settled attempt is immutable**, and the only writable row is the one open attempt that has not yet been answered.

**There is deliberately no `response_body`, `error_message`, `vendor_status`, `vendor_code` or `http_status` column, and no free-text column of any kind.** A vendor error body is untrusted third-party text and a plausible place for a credential or resident PII to appear (F062 Part 10). A vendor's own diagnostic token is no better: it is unbounded in practice, it changes without notice, it is meaningless to anyone without that vendor's documentation, and storing it makes the core integration evidence vendor-shaped — which is precisely what AGENTS.md keeps behind the adapter boundary. Whether a bounded transport status class is worth adding for operator diagnostics is listed as an open decision (§24), and the default answer is no.

### 3.4 Deferred, with the condition that triggers each

| Table | Verdict | Becomes necessary when |
| --- | --- | --- |
| `integration_inbox` | **Defer.** Nothing inbound exists; no endpoint, no callback, no webhook. A ledger now would be a table nothing writes | The first inbound path exists — a webhook or a callback. Then it is **mandatory before that endpoint ships**, as `unique(organization_id, integration_connector_id, external_event_id)`, written in the same transaction that applies the effect. Not symmetry: without it a redelivery re-applies |
| `integration_external_reference` | **Defer.** For outbound-create-only and a loopback connector, `integration_delivery_attempt.external_reference` is sufficient and is already durable evidence on a settled, immutable row | Any of: a second operation must *find* the external record (`updateRequest`, `getRequestStatus`); read-after-write ambiguity resolution is implemented; or reconciliation begins. Realistically the first real connector (F062.3) |
| reconciliation evidence | **Defer, and when it comes it needs its own table.** Not reusable from `integration_delivery_attempt`: a reconciliation finding arises from a *comparison*, often with no attempt at all, and the attempt table's `unique(outbox_id, attempt_number)` identity does not fit. This is precisely why `tenant_domain_verification_attempt` could not live inside `tenant_domain_audit` | F062.5. Shape: `integration_reconciliation_finding` carrying the closed discrepancy outcome from F062 Part 12, a bounded window, `observed_at`, and append-only enforcement |

---

## 4. Tenant isolation, proven structurally

Application checks are not the argument. Each property below is a schema constraint.

1. **Every row carries `organization_id`**, `not null`, made immutable by trigger.
2. **Every cross-table reference is composite.** `integration_outbox` reaches its connector through `foreign key (organization_id, integration_connector_id) references integration_connector(organization_id, id)`. To attach Organization A's outbox row to Organization B's connector, the row must carry B's `organization_id` — at which point it is B's row and no longer reachable as A's. **The forged reference is not rejected at runtime; it is inexpressible.** This is ADR-001's pattern, used 123 times already.
3. **`origin_connector_id` is composite too**, so an inbound-mirrored fact cannot name a connector belonging to another tenant.
4. **Attempts cannot cross tenants.** `integration_delivery_attempt` composite-FKs to both the outbox row and the connector, so an attempt row referencing another Organization's delivery cannot be written.
5. **No globally unique external identifier.** `connector_key` is `unique(organization_id, connector_key)` — never globally unique. There is no lookup path that resolves a connector from an external identifier alone, which is the shape that leaks across tenants.
6. **No shared fallback.** No default connector row, no catch-all, no nullable `integration_connector_id`. `integration_connector_id` is `not null`, so an unroutable intent cannot be stored "for later triage" in a shared place; routing failure is the `refused` state on a row that still belongs to exactly one Organization.
7. **No cross-tenant dead-letter.** `dead_lettered` is a state on a tenant-owned row, not a queue. There is no dead-letter table, so there is nothing for two tenants to share. Backoff and circuit state are likewise per `(organization_id, integration_connector_id)` because they are columns on tenant-owned rows.

A future extension of `test/database/cross-tenant-isolation.integration.test.ts` should assert points 2–4 by attempting the forged insert and requiring a foreign-key violation, in the same synthetic two-Organization fixture that suite already builds.

---

## 5. Transactional outbox atomicity

**One PostgreSQL transaction, with the outbox insert as an ordinary child write.** No dual write, no broker, no second datastore, no publish-after-commit hook.

Ordering follows ADR-024 unchanged, with the insert added at the end:

1. `organization` FOR SHARE
2. access-state FOR SHARE
3. fresh trusted actor mapping, status, permissions, memberships
4. the request FOR UPDATE (mutating) or FOR SHARE (protected child work)
5. business mutation and its existing child and `request_operational_activity` writes
6. **`insert into integration_outbox ...`** — same transaction, after the authority barrier, no new lock, no new barrier
7. commit

Rollback is automatic and total: if the domain transaction aborts, the intent was never inserted. If it commits, the intent is durable. The outbox adds **no new lock acquisition and no new lock ordering**, which is the reason it fits ADR-024 rather than cutting across it — it is an INSERT into a table nothing else in the transaction locks.

Dispatch is strictly outside that transaction. The worker never holds a domain transaction open across a network call, and nothing in the intake path waits for a destination, so a destination outage produces backlog rather than failed intake (F062 Part 11).

**Enqueue must not be reachable through a path that can also mark delivery.** §19 recommends the mechanism: the runtime holds INSERT on the outbox and no UPDATE, so the application that creates intents is structurally incapable of asserting that one was delivered.

---

## 6. Event versus desired-state, kept apart by constraints

Covered by §2's `payload_mode`, plus:

- `check((contract_kind = 'state_sync') = (payload_mode = 'current_state_projection'))` — a historical event cannot be stored as a current-state projection, and a sync intent cannot claim a historical payload. The two modes are mutually exclusive at the row level.
- `check(contract_kind <> 'event' or aggregate_revision is not null)` — mirrors F062.1's `assertEnvelope`, which refuses an event without a revision.
- `contract_kind` and `schema_version` are **immutable by trigger** and must match what `INTEGRATION_TYPES` declares for the type. Because `integration_type` is also immutable, a stored row cannot be relabelled from event to sync after the fact — the §3.2 misuse becomes unreachable in the database as well as in TypeScript.
- Re-dispatch semantics follow F062.1 `redispatchSchemaVersion`: an event re-dispatches at its **recorded** `schema_version`; a `state_sync` intent re-dispatches at the **current** declared version. The persistence model therefore stores the recorded version and never rewrites it, and a re-dispatch of a sync intent must be reported to operators as **re-synchronization, not replay**.

---

## 7. Delivery state machine

**The vocabulary is already accepted and implemented** in `server/src/integration/delivery-contract.ts`. The design uses it verbatim rather than the generic queue names.

Four of the names suggested for assessment differ from the accepted set, and the differences are deliberate rather than cosmetic:

| Suggested | Accepted | Why |
| --- | --- | --- |
| `claimed` / `in_progress` | `dispatching` | same concept, existing name |
| `retry_wait` | `retrying` | same concept, existing name |
| `delivered` | `accepted` / `acknowledged` | **Not a rename.** ADR-026 and F062.1 forbid implying delivery no destination confirmed. `accepted` means the destination took responsibility; `acknowledged` is recorded **only** where the connector declares `reportsTerminalState`. A single `delivered` state would reintroduce exactly the untruth that split them |
| `permanently_failed` | `failed_permanent` | existing name |
| — | `refused` | **Present in the accepted set and absent from the suggestion.** Routing, version-negotiation and projection failures never reached a destination; collapsing them into a failure state would misattribute a Reqro-side problem to the destination |
| `cancelled` | **not added** | No product contract requires it. A withdrawn request is expressible as `refused` at dispatch time, or as a connector-side cancel operation where `supportsCancel` — neither needs a new state. Recommend adding only if a product decision requires operator-initiated abandonment of a pending intent, and then as a transition carrying audit evidence |

Allowed transitions — a closed whitelist, enforced by a `guard_integration_outbox()` BEFORE UPDATE trigger that rejects any pair not listed and requires `state_revision` to advance by exactly one:

| From | To | Condition |
| --- | --- | --- |
| `pending` | `dispatching` | worker claim; mints `claim_token`, increments `claim_generation`, sets `claimed_by`, `claimed_until` and `pinned_connector_revision`, increments `attempt_count` (§9.1, §9.2) |
| `pending` | `refused` | routing, version negotiation or projection failed before any send |
| `dispatching` | `accepted` | attempt `succeeded` |
| `dispatching` | `retrying` | attempt `failed_transient` and attempts remain |
| `dispatching` | `failed_permanent` | attempt `failed_permanent` |
| `dispatching` | `ambiguous` | attempt `ambiguous`, **or** lease expiry (§11, §21) |
| `dispatching` | `dead_lettered` | transient failure with attempt budget exhausted |
| `retrying` | `dispatching` | `next_attempt_at <= clock_timestamp()` |
| `retrying` | `dead_lettered` | budget exhausted, or maximum pending age reached (open decision §24) |
| `accepted` | `acknowledged` | **only** where the connector declares `reportsTerminalState` |
| `ambiguous` | `dispatching` | **only** where the connector declares `supportsIdempotencyKey` |
| `ambiguous` | `accepted` / `failed_permanent` | resolved on read-after-write evidence, or by an authorized operator decision |
| `ambiguous` | `dead_lettered` | authorized operator decision |
| `dead_lettered` | `pending` | **authorized replay only**, with audit evidence in the same transaction |

The four prohibitions the assessment requires are consequences of that whitelist, not separate rules:

- **`accepted`/`acknowledged` → `pending` is absent**, so a delivered row cannot return to the queue.
- **`dead_lettered` → `dispatching` is absent.** The only exit is `dead_lettered → pending`, and a deferred constraint trigger requires a matching replay-authorization audit row in the same `txid_current()` — the `tenant_domain_audited` pattern. A bare `UPDATE` therefore aborts at commit, so a silent retry is not merely discouraged, it fails.
- **`ambiguous` → `dispatching` is conditional on `supportsIdempotencyKey`.** The trigger reads the connector's declared capability, so a blind retry of a non-idempotent ambiguous mutation is refused by the database.
- **Disabling a connector deletes nothing.** The outbox has no DELETE grant, the connector guard refuses DELETE and TRUNCATE, and F062.1's `mayEraseEvidence()` returns `false` for every lifecycle state — no connector state change is ever a reason to erase. That is distinct from an approved retention policy, which is a separate privileged operation and not a lifecycle consequence (§17.1). A disabled connector accumulates (F062.1 `mayEnqueue` refuses only `retired`).

`residentVisibleDeliveryStates` is empty in F062.1, so **no delivery state is resident-visible** and no resident-facing query should join these tables at all.

---

## 8. Attempt outcome taxonomy

Persistence reuses F062.1's closed sets verbatim, so the check constraints and the TypeScript types are one vocabulary:

- `attempt.outcome` = `attemptOutcomes` (4 values, including `ambiguous`)
- `attempt.failure_category` and `outbox.last_failure_category` = `integrationFailureCategories` (10 values)
- `outbox.state` = `deliveryStates` (9 values)
- `connector.lifecycle_state` = `connectorLifecycleStates` (5 values)

`database.types.ts` should import these unions from `src/integration/` exactly as `TenantDomainTable` imports `TenantDomainRole`, so a vocabulary change is a compile error rather than silent drift between the schema and the code.

**No raw vendor status value enters any core enum or check.** `destination_timeout` remains outside the transient set, matching F062.1, so a timeout resolves through `ambiguous` and never through a blind retry. Vendor-specific mapping stays in the adapter: the connector classifies, and only the classification is persisted.

### 8.1 `reason_code` — a closed, Reqro-owned diagnostic taxonomy

`failure_category` is deliberately coarse: ten values, chosen so retry policy can be decided from them. Operators need something finer to answer *why*, and the wrong way to provide it is a syntax-constrained text column — a pattern such as `^[A-Za-z0-9._-]{1,64}$` constrains the *shape* of a value while admitting any vendor token, build identifier or opaque string that happens to fit. That is not a taxonomy; it is free text with a character-class filter, and over time it fills with vendor vocabulary nobody can interpret without that vendor's documentation.

**`reason_code` is therefore a closed enumerated set, checked by constraint, owned by Reqro.** Much of it is not newly invented: F062.1 already defines closed vocabularies for the failure modes that occur before a destination is reached, and those are reused verbatim rather than paraphrased.

| Group | Values | Source |
| --- | --- | --- |
| Routing | `connector_unknown`, `connector_retired` | **F062.1 `connectorResolutionFailures`, verbatim** |
| Envelope refusal | `type_unknown`, `contract_kind_mismatch`, `identifier_invalid`, `revision_invalid`, `timestamp_invalid`, `origin_invalid`, `metadata_unbounded` | **F062.1 `EnvelopeRefusalCode`, verbatim** |
| Contract negotiation | `version_unsupported`, `version_withdrawn` | F062.1 `negotiateVersion` / `negotiateReplayVersion` refusals |
| Payload eligibility | `reconstruction_ineligible`, `reconstruction_source_unavailable`, `snapshot_not_authorized` | §2.3, Reqro-owned |
| Credential | `credential_unavailable`, `credential_rejected` | Reqro-owned. Never the destination's auth error text |
| Transport | `destination_unreachable`, `destination_tls_failure`, `connection_reset_after_send`, `response_timeout`, `response_unparseable` | Reqro-owned classifications of what Reqro observed |
| Destination refusal | `rejected_validation`, `rejected_authorization`, `rejected_duplicate`, `rejected_unprocessable` | Reqro's reading of a refusal, **not** the vendor's code for it |
| Throttling | `rate_limited`, `circuit_open` | Reqro-owned |
| Worker | `lease_expired_uncertain`, `fenced_stale_completion` | §9.1, §9.3. Reqro-owned |
| Internal | `internal_failure` | Terminal catch-all, deliberately singular |

Two properties make this a taxonomy rather than a label:

1. **`reason_code` maps many-to-one onto `failure_category`, and the pairing is validated.** A check constraint admits only the reason codes valid for the recorded category, so `failure_category = 'authentication_failed'` with `reason_code = 'rate_limited'` is unwritable. Retry policy therefore remains decidable from the coarse value, while the fine value cannot contradict it.
2. **An unmappable destination response classifies to the nearest Reqro concept, never to a new value invented at the call site.** Where nothing fits, the honest answers are `rejected_unprocessable` or `internal_failure`. Adding a value requires a reviewed migration altering the check constraint — which is deliberately the same friction as adding a delivery state, because a diagnostic vocabulary that anyone can extend at runtime is one nobody can rely on.

**Explicitly prohibited in core integration evidence:** arbitrary vendor diagnostic tokens, vendor error codes, vendor status identifiers, HTTP response bodies, exception messages, stack fragments, and any sentence or free-form phrase. If a specific destination's diagnostics genuinely need to be retained for operator work, that is an adapter-scoped, separately reviewed decision with its own privacy classification and retention — not a column on the core attempt table.

---

## 9. Worker claiming, fencing and connector pinning

**Recommended: `SELECT ... FOR UPDATE SKIP LOCKED` with a short claim transaction, an explicit lease, and a fencing token.** `SKIP LOCKED` appears nowhere in the repository today, so this is a new pattern and must be introduced deliberately, with its own integration test, rather than assumed.

Three transactions per attempt, and **the network call is inside none of them**:

1. **Claim and open the attempt** (short, one transaction): select a bounded batch of ready rows for one connector `for update skip locked`; set `state = 'dispatching'`, `claim_generation = claim_generation + 1`, a fresh `claim_token = gen_random_uuid()`, `claimed_by`, `claimed_until = clock_timestamp() + lease`, `attempt_count = attempt_count + 1` and `pinned_connector_revision` (§9.2); **and insert the open `integration_delivery_attempt` row in the same transaction**, binding `organization_id`, `integration_outbox_id`, `attempt_number`, `claim_generation`, `claim_token`, `connector_revision`, `capability_snapshot`, `correlation_id` and `started_at`. Commit, returning the token to the worker.
2. **Dispatch**: perform the external call with **no transaction open and no row lock held**. A row lock must never span a network call — that is how a slow destination becomes a database incident.
3. **Complete** (short): settle the already-existing attempt row and transition the outbox state, **both conditional on still owning the current claim** (§9.1), in one transaction so evidence and state cannot diverge.

**The attempt row is created durably before the network call, not after it.** This is the correction that makes crash evidence possible at all. If the row were inserted only on completion, then a worker that dies mid-call leaves **no record that an attempt was ever made** — the outbox row shows a stale `dispatching` lease and nothing says what was tried, when it started, under which connector revision, or with which capabilities. Recovery would then be reconstructing a dispatch from its absence. With the row opened at claim time, the evidence exists the instant the attempt begins, and recovery has something concrete to settle.

### 9.1 Fencing: a stale worker cannot record or overwrite

A lease that has expired does not stop the worker that held it. That worker may be alive, slow, partitioned or garbage-collection-stalled, and it may return **after** the row has been recovered and re-claimed by someone else. Without fencing it would then write an attempt row and a state transition for a dispatch that is no longer current — overwriting a newer, correct result with an older, stale one. A lease timestamp alone cannot prevent this: by the time the stale worker checks, the clock says whatever the clock says. What it must prove is **ownership**, not freshness.

**The mechanism.** `claim_generation` is a monotonic fencing counter per outbox row, incremented on every claim and never reset. `claim_token` is an opaque UUID minted at the same moment. The worker holds the token it was issued; the row holds the token that is currently valid. Every completion must prove ownership:

Completion settles the attempt and transitions the outbox in one transaction, and **both statements carry the ownership predicate**:

```sql
-- 1. Settle the attempt opened at claim time. Not an insert: the row exists.
update integration_delivery_attempt
   set outcome = :outcome, response_classification = :class, reason_code = :reason,
       failure_category = :category, retry_eligible = :eligible,
       external_reference = :ref, completed_at = clock_timestamp(), duration_ms = :ms
 where organization_id = :org
   and integration_outbox_id = :id
   and claim_token = :token           -- proof of ownership
   and claim_generation = :generation
   and completed_at is null;          -- and that nobody has settled it already

-- 2. Transition the outbox, under the same proof.
update integration_outbox
   set state = :new_state, claim_token = null, claimed_by = null, claimed_until = null
 where organization_id = :org
   and id = :id
   and claim_token = :token
   and claim_generation = :generation
   and state = 'dispatching';
```

A stale worker's statements match **zero rows each**, for two independent reasons: its token was cleared or replaced when the row was recovered and re-claimed, and the attempt it opened was already settled by the recovery path, so `completed_at is null` is false. It therefore **cannot mutate the outbox and cannot overwrite the recovered attempt** — and because UPDATE of a settled row raises in the guard (§3.3), even a statement without the predicate would fail rather than silently succeed.

The worker must treat a zero-row completion as *"my result is unusable"*: record it as a fenced completion in its own telemetry and discard the outcome without retrying. If both statements do not report one row, the transaction must abort rather than commit a partial settlement — evidence and state move together or not at all.

Why both a token and a generation: the token is the actual check and is unguessable, while the generation is a cheap monotonic witness that makes a fencing violation legible in evidence and in tests. The attempt row records the generation it was written under, so an auditor can see which dispatch produced which evidence. The redundancy is intentional — a UUID comparison alone would work, but it would leave no ordered trail.

**This does not make delivery exactly-once, and nothing here should be read as claiming it.** Delivery remains **at-least-once with idempotent processing**. A fenced stale worker may already have mutated the destination; fencing protects Reqro's *record*, not the external system, and creating the attempt row early improves the *evidence* of a dispatch rather than the *uniqueness* of it. The destination-side consequence is handled as ambiguity (§11), never as a successful outcome, and never by trusting the stale worker's report of what happened.

### 9.2 Connector revision pinning: retry safety is historical, not current

**Historical retry safety must never be determined from the connector's current mutable capabilities.** Declared capabilities are configuration, and configuration changes. If a dispatch was made while `supportsIdempotencyKey` was false, that dispatch was **not** idempotency-protected — and a later configuration change setting it true must not retroactively make that prior ambiguous mutation safe to retry. Reading current capabilities at resolution time would do precisely that: a settings change would silently convert a "requires operator review" ambiguity into an "auto-retry" one, and a crew could be dispatched twice as a result.

**The mechanism.** The semantics each intent and each attempt were formed against are pinned durably:

| Pinned value | Where | Why it must be pinned |
| --- | --- | --- |
| `pinned_connector_revision` | outbox row, set at claim | The `integration_connector.configuration_revision` whose declared capabilities governed this dispatch. Resolving a past ambiguity reads capabilities **as of this revision**, never from the current row |
| `schema_version` | outbox row, set at enqueue, immutable | Already present. An event re-dispatches at its recorded version; `negotiateReplayVersion` refuses rather than re-encoding |
| `connector_revision` | attempt row | The revision in force for that specific attempt, so a configuration change between attempts is visible in evidence rather than inferred |
| `capability_snapshot` | attempt row | The bounded set of capability values that actually governed the attempt — at minimum `supports_idempotency_key`, `supports_read_after_write` and `side_effect_risk`. Recording the decisive inputs is cheaper and more honest than reconstructing them from a revision number later |
| `adapter_revision` | attempt row, where an adapter has its own versioned behaviour | A code-level behaviour change is not captured by a configuration revision. Needed once a real adapter exists; **deferred**, and listed as an open decision, because what constitutes an adapter revision depends on the first real connector |

Pinning requires the connector's configuration history to be readable at a past revision, which is what `integration_connector_audit` provides (§3.1, §18) — the revision-keyed audit row **is** the historical capability record. Pinning a revision whose configuration cannot be recovered would be pinning a number rather than a meaning, so the connector audit table is a **prerequisite for ambiguity resolution**, not an optional extra.

**Credential rotation stays separate.** It changes `credential_reference` only. It does not change `id`, `connector_key` or, by itself, any declared capability, so rotation neither changes connector identity nor invalidates a pin. Whether a rotation should advance `configuration_revision` at all is a reviewed detail: it must not invalidate in-flight attempts, and a rotation that bumped the revision would leave every in-flight pin aimed at a superseded row for no semantic gain.

### 9.3 Concurrency, recovery and ordering

- **Duplicate simultaneous claims** are prevented by `SKIP LOCKED` plus the `pending|retrying → dispatching` transition rule: a second replica either skips the locked row or finds it already `dispatching` and its transition rejected. Fencing is the second line of defence, for the case where the first has already been passed legitimately.
- **Lease semantics.** `claimed_until` and `claim_token` are both structurally tied to `dispatching`, so neither can leak into another state. Lease duration must exceed the connector's dispatch timeout with margin; the value is configuration, not schema.
- **Stale or expired uncertain dispatch recovers to `ambiguous`, never silently to `pending`.** A row left `dispatching` past `claimed_until` may already have reached the destination, and ADR-024 forbids automatically retrying after an uncertain result. **Recovery settles the attempt that already exists** — it does not invent a new one and does not return the outbox row to `pending`:

  1. settle the open attempt for that outbox row as `outcome = 'ambiguous'`, `reason_code = 'lease_expired_uncertain'`, `completed_at = clock_timestamp()`, leaving its `claim_generation` and `claim_token` as written at claim so the evidence stays attributable to the dispatch that produced it;
  2. clear `claim_token`, `claimed_by` and `claimed_until` on the outbox row — which is what fences the original worker — and set `state = 'ambiguous'`.

  Both happen in one transaction. The `integration_attempt_open` partial unique index makes inventing a second open attempt a **constraint violation** rather than a judgement call, so "mark the existing attempt ambiguous" is the only reachable behaviour. Only where the capabilities **pinned for that dispatch** declare `supportsIdempotencyKey` may the outbox go to `retrying` instead — and even then the open attempt is still settled as `ambiguous` first, because that is what happened; the retry is a *new* attempt with the next `attempt_number`. That check reads the pinned revision, not the current connector row (§9.2). Treating a crashed dispatch as fresh pending work is the single most likely way this design would duplicate a work item in the field.
- **Attempt numbering** comes from `attempt_count`, incremented inside the claim transaction, with `unique(organization_id, integration_outbox_id, attempt_number)` making a double-counted attempt a constraint violation rather than confusing evidence.
- **No exactly-once claim is promised.** A worker may crash after a successful external call and before step 3; the result is a recorded ambiguity. Duplicate delivery remains possible and is handled by idempotency, exactly as F062 Part 4.0 states.

Privilege note measured from migration 49: **PostgreSQL requires UPDATE privilege on at least one column of a row-locked table.** `FOR UPDATE` on the outbox therefore requires UPDATE on it, which is why §19's worker-identity question is a prerequisite for this design rather than a detail of it.

## 10. Ordering

**Per `(organization_id, integration_connector_id, aggregate_type, aggregate_id)`. Not global, not per Organization, not per connector.**

Per-aggregate is required because a status change must not overtake the creation it depends on. Nothing broader is required, and anything broader would serialise unrelated work: per-connector ordering would make one slow aggregate throttle an entire tenant's integration, and global ordering would put every tenant behind one stream.

Mechanism, structural rather than procedural:

```sql
create unique index integration_outbox_single_inflight
  on integration_outbox (organization_id, integration_connector_id, aggregate_type, aggregate_id)
  where state in ('dispatching', 'ambiguous');
```

**What the predicate does and does not prohibit, stated precisely, because getting this wrong would break ordinary operation:**

| Situation | Permitted? | Why |
| --- | --- | --- |
| Many `pending` intents for the same aggregate and connector | **Yes, unrestricted.** `pending` is **not** in the predicate | This is the normal case. A request that is submitted, assigned and closed in quick succession legitimately produces three queued intents for one aggregate. Prohibiting that would make the backlog itself an error |
| Many `retrying` intents for the same aggregate | **Yes.** `retrying` is not in the predicate | A backlog awaiting backoff is not in flight |
| Two intents simultaneously `dispatching` for one aggregate | **No** | This is the only thing the index forbids: concurrent in-flight dispatch is what allows a status change to overtake its creation |
| One `dispatching` plus several `pending` for one aggregate | **Yes** | Exactly the intended steady state: one in flight, the rest queued behind it in `aggregate_revision` order |
| A new intent enqueued while an earlier one is `ambiguous` | **Yes — enqueue is never blocked** | The *insert* is unconstrained because the new row is `pending`. Only its *claim* waits. Intake must never fail because a prior dispatch is unresolved |
| Terminal rows for one aggregate accumulating without limit | **Yes** | No terminal state is in the predicate, so history never constrains new work |

So the index constrains **concurrency, not queue depth**. It is a mutual-exclusion guard over the in-flight slot, not a uniqueness rule over intents, and the set of states in its predicate is exactly the set in which an external mutation may be outstanding.

The claim query orders candidates by `aggregate_revision` and skips any aggregate that already occupies its in-flight slot, so ordering is honoured without a lock that spans aggregates and without serialising the connector.

Including `ambiguous` is deliberate: an unresolved ambiguous create must block a later status change *being dispatched* for the same aggregate, or Reqro would report a status for a record that may not exist. It also implements F062 Part 4.4's poison isolation exactly — **only that aggregate's in-flight slot halts**, while every other aggregate on the same connector continues dispatching.

**No unnecessary serialisation is introduced.** The scope is one aggregate on one connector: not global, not per Organization, not per connector, and not per aggregate *across* connectors — two connectors may dispatch for the same aggregate concurrently, because they are independent destinations. Within one aggregate, at most one outstanding external mutation is the minimum needed for correctness and is not a throughput limit on anything else.

Where a destination cannot honour ordering at all, the connector declares `supportsOrdering: 'none'` and Reqro serialises on its side; the index above is what makes that serialisation real rather than intended.

---

## 11. Ambiguous outcomes

`ambiguous` is a durable state on the outbox row plus a settled attempt row recording `outcome = 'ambiguous'`, so it survives restart by construction — there is no in-memory component. Where the ambiguity arose from a lease expiry rather than an observed timeout, that attempt row is the one opened at claim time and settled by the recovery path (§9.3), which is why a crashed dispatch still leaves dated, attributable evidence.

**Time alone never makes it retryable.** `next_attempt_at` is meaningless in `ambiguous`, and the transition whitelist offers no `ambiguous → retrying` edge at all; the only automatic exit is `ambiguous → dispatching` gated on `supportsIdempotencyKey`. A backoff timer cannot promote an ambiguity, which is the failure mode that would duplicate a dispatched work item hours later.

Resolution order, as accepted:

1. `supportsIdempotencyKey` → retry with the same key, recorded as a further attempt with the same `idempotency_key_hash`.
2. `supportsReadAfterWrite` → read back and resolve to `accepted` or `failed_permanent` **on evidence**, recorded as its own attempt row with `response_classification`.
3. Otherwise, or where `sideEffectRisk` is `irreversible` or `physical` → **operator review**.

**Resolution never overwrites history.** A settled attempt is immutable, so resolving an ambiguity **appends a new attempt** — a read-back, a keyed retry, or an operator decision — and transitions the outbox state; the original ambiguous attempt remains readable with its own `started_at`, `completed_at`, `claim_generation`, `observed_at` and `mutation_txid`. The complete-once guard (§3.3) is what makes this structural: the resolution cannot be written by editing the ambiguous row, because that row raises on UPDATE. An operator resolution additionally requires an audit row in the same transaction (§18), so the question "who decided this was delivered, and on what evidence" is always answerable. The outbox row carries current state; the attempt table carries the history that produced it.

---

## 12. Dead-letter

**A durable state, never a deletion, and not a queue.**

- **Transition criteria:** attempt budget exhausted for transient failures; an operator decision from `ambiguous`; or maximum pending age reached — whose expiry action is an **open product decision** (§24) and is the reason this is a readiness assessment rather than an implementation.
- **Operator visibility** is a read over `(organization_id, integration_connector_id)` where `state = 'dead_lettered'`. No operational UI is designed here.
- **Replay authorization boundary:** `dead_lettered → pending` only, with audit evidence in the same transaction, enforced by a deferred constraint trigger. Replay re-dispatches the existing `integration_id` and never fabricates a new envelope. F062 Part 4.5's dry-run → confirm → attributed-audit discipline applies, reusing the operator-platform pattern.
- **Prior attempts are preserved.** Settled attempts are immutable and no DELETE grant is reachable by the application or the worker; a replay appends attempts with higher `attempt_number`, so the full history of failure and re-dispatch stays intact. Removal is possible only under an approved, audited retention operation performed by a separate privileged identity (§17.1) — never as part of replay, dead-lettering or any state transition.
- **Connector disable does not dead-letter anything.** Disabling accumulates (`mayEnqueue` refuses only `retired`); it is an outage, not a discard.
- **Retention** is §17, and no duration is invented here. Dead-letter evidence is the longest-lived category and the one most likely to be a record of city service handling.

---

## 13. Connector lifecycle in the database

| State | Enqueue | Dispatch | Database behaviour |
| --- | --- | --- | --- |
| `configured` | yes | no | Rows accumulate; `mayDispatch` false. A connector can be fully configured and provably idle |
| `active` | yes | yes | Normal |
| `degraded` | yes | yes | Dispatch continues; distinct from `disabled` because "working slowly" and "not working" need different operator responses |
| `disabled` | yes | no | **Accumulates, discards nothing.** Behaves as an outage |
| `retired` | **no** | no | Terminal. `mayEnqueue` false. The guard refuses any transition out, so a decommissioned integration cannot quietly resume and flush a months-old backlog |

- **Pending events never move to another connector.** `integration_connector_id` is immutable by trigger, and the dedupe constraint is scoped per connector. There is no reassignment path, so re-routing requires enqueuing new intents under an explicit, audited decision rather than silently re-pointing existing ones.
- **Credential rotation changes `credential_reference` only.** Identity (`id`, `connector_key`) is immutable, so rotation never invalidates in-flight rows and never rewrites history.
- **Retirement preserves evidence.** No cascade, no DELETE grant, `mayEraseEvidence()` false. `integration_delivery_attempt` composite-FKs the connector so retired-connector attempts remain attributable. Retirement is a state transition, never a deletion; any later removal is a separate approved retention operation (§17.1).

---

## 14. Idempotency

| Case | Mechanism | Where it lives |
| --- | --- | --- |
| **Outbound enqueue** | `unique(organization_id, integration_connector_id, dedupe_key)`, with the key derived deterministically from the triggering business fact — reusing `(organization_id, service_request_id, request_revision)` and an event index where it applies. A re-run of a handler is safe **by construction** | schema constraint |
| **Outbound wire** | The connector's idempotency key where `supportsIdempotencyKey`, derived from `integration_id` (stable across retries and replay). Only its **hash** is persisted | adapter + `idempotency_key_hash` |
| **Inbound webhooks** | `unique(organization_id, integration_connector_id, external_event_id)` in `integration_inbox`, written in the same transaction that applies the effect. **Deferred until an inbound path exists**, and mandatory before one ships | future table |
| **Internal replay** | Reuses the same `integration_id` and idempotency key, so a destination honouring keys collapses them. Replay is the one case where a duplicate may legitimately arrive, so connectors must state what a replayed event does | authorization + audit |
| **Worker retry** | Same `integration_id`, new `attempt_number`. Retry never mints a new envelope identity | attempt uniqueness |

**Key origin.** The idempotency key derives from `integration_id`, which Reqro mints as a UUID at enqueue. It is explicitly **not** derived from a resident identifier, a tracking credential, a reference number shown to a resident, an email address or any external identifier: those are either resident-identifying, secret, or outside Reqro's control. `request_tracking_credential` values in particular must never appear — they are credentials, and F062.1 lists `tracking` among `PROHIBITED_ENVELOPE_FIELDS`.

---

## 15. External references

**Scope is `(organization_id, integration_connector_id, external_namespace, external_id)` — never global.**

When `integration_external_reference` is added, uniqueness should be:

```sql
unique (organization_id, integration_connector_id, external_namespace, external_id)
```

with `external_namespace` a bounded, connector-declared value, because one destination may expose several identifier spaces whose values collide. A stronger scope may only be adopted where the destination's **actual documentation** proves it, and AGENTS.md forbids inventing that. Assuming global uniqueness is how two tenants' records become one.

The reverse direction — `(organization_id, aggregate_type, aggregate_id, integration_connector_id)` — should also be unique where the destination holds at most one counterpart per aggregate, and that too is a per-connector declared property rather than an assumption.

**Deferred for now:** `integration_delivery_attempt.external_reference` already records what a destination returned, on a settled, immutable attempt row. A separate mapping table earns its place when something must *look up* by it (§3.4).

---

## 16. Privacy classification, column by column

Classification scheme: **ID** (opaque identifier), **VOC** (closed vocabulary), **NUM**, **TS**, **HASH**, **REF** (reference to a secret, never the secret), **BOUNDED** (pattern-constrained short code).

| Table | Column | Class |
| --- | --- | --- |
| `integration_connector` | `id`, `organization_id` | ID |
| | `connector_key`, `connector_kind`, `lifecycle_state` | VOC / BOUNDED |
| | `credential_reference` | **REF** |
| | `accepted_schema_versions` | bounded JSONB, validated |
| | `configuration_revision` | NUM |
| | timestamps | TS |
| `integration_outbox` | `id`, `organization_id`, `integration_connector_id`, `integration_id`, `aggregate_id`, `correlation_id`, `causation_id`, `origin_connector_id` | ID |
| | `integration_type`, `contract_kind`, `aggregate_type`, `payload_mode`, `state`, `origin_kind`, `last_failure_category`, `deployment_environment` | VOC |
| | `schema_version`, `aggregate_revision`, `state_revision`, `attempt_count` | NUM |
| | `dedupe_key` | **BOUNDED** — deterministic, derived from identifiers and revisions only |
| | `claimed_by` | BOUNDED worker instance label, not a user identity |
| | timestamps | TS |
| `integration_delivery_attempt` | identifiers | ID |
| | `outcome`, `failure_category`, `response_classification` | VOC |
| | `external_reference` | BOUNDED, destination-assigned |
| | `idempotency_key_hash` | HASH |
| | `reason_code` | **VOC** — closed enumerated taxonomy (§8.1), not pattern-constrained text |
| | `connector_revision`, `claim_generation` | NUM |
| | `capability_snapshot` | bounded JSONB, keys and values constrained by check |
| | `retry_eligible` | boolean |
| | `attempt_number`, `duration_ms`, `policy_version` | NUM |
| | timestamps, `mutation_txid` | TS / NUM |

**Structurally absent, and prohibited from being added without a reviewed exception:** resident name, email, phone, postal or entered address, description or narrative text, internal notes, staff identity, authorization tokens, connector secrets, tracking credentials, raw HTTP request or response bodies, raw vendor error payloads, and any unbounded status or message text. F062.1's `PROHIBITED_ENVELOPE_FIELDS` is the same list in code, and the enqueue path should validate against it so a JSON-parsed envelope cannot smuggle a field in.

Two enforcement recommendations:

- A check constraint on `credential_reference` refusing values that look like secrets rather than references — for example requiring a declared reference grammar such as a secret-manager path, and rejecting anything containing `://`, whitespace, or a long high-entropy run. The repository precedent is migration 47's identity grammar, which refuses a bare 32-character token outright.
- `reason_code` being a **closed enumerated set** is itself the privacy control, and it is strictly stronger than a character-class pattern: a vendor error sentence cannot be written to it, and neither can an opaque vendor token that happens to look like an identifier. There is no column on the attempt table into which raw third-party text can land, by accident or otherwise.

**Where business payload data is genuinely required** — the `approved_snapshot` mode excluded from this slice (§2.3) — the existing classification and retention policies of the source data apply unchanged and are the governing constraint. Copying an answer or a description into an integration table makes that table subject to ADR-005 requester-contact privacy and the attachment and notes policies, which is precisely why it needs approval rather than a schema default.

---

## 17. Retention

**No production duration is invented here.** Categories, with what each turns on:

| Category | Rows | Consideration | Approval needed |
| --- | --- | --- | --- |
| **Pending intents** | `state in ('pending','retrying')` | Bounded by the maximum-pending-age policy, not by a retention job. These are undelivered obligations; deleting one is data loss | **Product** — the expiry action is open (§24) |
| **Successful delivery evidence** | `accepted`, `acknowledged` rows and their attempts | The shortest-lived category. Still evidence that Reqro did notify an external system | **Product + legal** |
| **Failed and dead-letter evidence** | `failed_permanent`, `dead_lettered`, `refused` | Longest-lived. Likely a record of how a city service request was handled, and the evidence an operator reviews. Should outlive successful evidence | **Product + legal + security** |
| **Reconciliation evidence** | future findings table | Divergence history is what proves drift was detected; a `missing_reqro` cross-tenant finding is a **security record** | **Security + legal** |
| **External reference mappings** | future mapping table | Must survive as long as the external record is referenced, independent of attempt retention. Deleting a mapping orphans a live external record | **Product** |

### 17.1 Deletion versus retention

These are different operations with different authority, and conflating them would either permit silent data loss or make a lawful privacy obligation unimplementable. The design draws the line explicitly:

| Property | Rule |
| --- | --- |
| **Ordinary application and worker roles cannot delete integration evidence** | No DELETE grant on `integration_outbox`, `integration_delivery_attempt` or the connector tables. The complete-once guard refuses UPDATE of a **settled** attempt and permits only the single open → settled transition under a matching claim (§3.3); a statement trigger refuses TRUNCATE. The runtime and the worker therefore have **no reachable path** to remove or rewrite evidence, whether by bug, by injection or by an operator with application access only |
| **Dead-letter and delivery history are never silently deleted** | Not by cascade (no `on delete cascade` anywhere in this design), not by connector retirement, not by disable, not by a maintenance job, and not as a side effect of any state transition. F062.1's `mayEraseEvidence()` returns `false` unconditionally for exactly this reason |
| **Future approved retention or purge is a separate privileged operation** | It runs under a distinct, reviewed authority — not `reqro_runtime` and not the worker identity — and it is itself audited: what was purged, under which approved policy, by whom, and when |

**This is deliberately not permanent undeletability.** The evidence guards must be written so that an approved retention process remains *possible*, because a privacy or records-retention obligation may later require removal, and a schema that made deletion impossible would put the platform in conflict with its own policy. Two implementable shapes, to be chosen when a policy exists:

- the trigger exempts a purge performed under an explicit, audited session marker set by the privileged retention role — so ordinary roles are refused while an approved purge is permitted; or
- the owner role drops and re-creates the trigger inside the reviewed purge migration or maintenance window.

Either keeps the default fail-closed while leaving a reviewed path open. What must **not** be built is an exemption reachable by the application role, which would reduce the protection to a convention. `attachment-cleanup` is the existing precedent for a bounded, audited maintenance task.

**Retention duration remains unresolved** (§24 item 8). Nothing above sets or implies one; it defines who may act and under what evidence, which is answerable now, rather than how long, which is not.

---

## 18. Audit boundary

**Integration delivery evidence is not the authoritative business or security audit, and must not be used as one.** `integration_delivery_attempt` answers "what did we try, and what came back". It does not answer "who authorized this", which is a different question with different retention and a different reader.

Actions that need **separately authoritative audit events**, following the `tenant_domain_audit` pattern with a deferred constraint trigger requiring evidence in the same transaction:

| Action | Why it is audit, not delivery evidence |
| --- | --- |
| Replay authorization (`dead_lettered → pending`) | A human decided to re-send to a live external system |
| Dead-letter override and manual ambiguity resolution | A human asserted an outcome nobody observed |
| Connector enable, disable, retire | Changes whether a tenant's data flows at all |
| Credential reference rotation | Security-relevant configuration change |
| Reconciliation repair | A mutation driven by data Reqro does not own |
| A `missing_reqro` finding with a cross-tenant reference | **A security event**, never a data-quality one |

What should **not** be duplicated: ordinary attempt outcomes, retries, backoff and state transitions driven by the worker. Those are already append-only evidence, and copying them into the security audit would dilute it with routine machine activity — the opposite of what an audit reader needs. The existing operator and security audit semantics are reused, not re-implemented.

---

## 19. Database roles and grants

Role separation is preserved exactly: `reqro_owner` owns, `reqro_migrate` applies migrations by `SET ROLE`, `reqro_runtime` runs the application, `reqro_operator` is untouched. **Migrations grant nothing**; grants belong to `deploy/database/runtime-role.sql`, and adding these tables means a reviewed change to that file in the same slice.

Minimum privileges by function:

| Function | Privilege | Rationale |
| --- | --- | --- |
| Application transaction writing intents | `select, insert` on `integration_outbox`; `select` on `integration_connector` | INSERT to enqueue; SELECT because the repository's established `ON CONFLICT ... RETURNING` idiom requires it. **No UPDATE** — the application must be structurally unable to assert delivery |
| Delivery worker claiming | `select, update` on `integration_outbox` | `FOR UPDATE SKIP LOCKED` requires UPDATE on at least one column of the locked table (measured in migration 49) |
| Delivery worker opening an attempt | `insert` on `integration_delivery_attempt` | The attempt row is created in the claim transaction (§9) |
| Delivery worker completing an attempt | `select, update` on `integration_delivery_attempt` | **A departure from the INSERT-only evidence pattern**, forced by creating the row before the call: completion is an UPDATE, and the ownership predicate requires SELECT. The complete-once guard is what keeps the widened privilege safe — it permits exactly one open → settled transition and raises on any settled row — and it also **raises the stakes of §19.1**, since a shared principal would hold UPDATE on evidence as well as on the outbox |
| Reconciliation worker | `select` on outbox, attempt and reference tables; `insert` on the findings table | Read-only comparison; detection never mutates |
| Migration role | unchanged | No new privilege |

### 19.1 BLOCKER: worker database identity must be decided before F062.2D

> **An in-process worker sharing `reqro_runtime` does not provide database-principal separation.** It is the same database principal, and `session_user` cannot distinguish the enqueueing application path from the dispatching worker path. Any reasoning that relies on "the application cannot mark delivery" is false under that deployment, because the application and the worker are the same database identity.

> **SECURITY DEFINER reduces direct table privileges but does not, by itself, create a distinct worker identity.** Routing transitions through narrow functions is genuinely valuable — it means no role holds broad UPDATE on the outbox, and the only reachable transitions are the whitelisted ones — but it is **privilege narrowing, not principal separation**. Both paths still execute as the same login, so audit attribution by database principal remains impossible, and a flaw in any runtime code path can still call the function. Describing SECURITY DEFINER as a separation of duties would be a misstatement of what it achieves.

**This is a required decision before F062.2D dispatch implementation, and no role is created now.** The options to review then:

1. **In-process worker with SECURITY DEFINER transitions.** The runtime holds EXECUTE on narrow functions such as `claim_integration_outbox(...)` and `record_integration_attempt(...)` and holds **no table UPDATE**, so the state machine lives inside the functions and only whitelisted transitions are reachable. Simplest, matches F062's recommendation, and matches migration 49's established pattern — including its measured trap that a plpgsql call to another function is permission-checked against the effective user, so a helper's callees must be hardened too. **Accepts that there is no worker principal**, and must say so rather than implying separation.
2. **Out-of-process worker with a distinct `reqro_integration_worker` login.** Real principal separation, real audit attribution, least privilege per function. Costs a new role, a new deployment unit, and secret management for a third login — an infrastructure change requiring explicit approval under the security gates.
3. **In-process worker with a separate connection pool authenticating as a distinct login.** A middle option worth evaluating: one process, two database principals. Needs assessment of whether the Nest application can hold two pools without the application path being able to borrow the worker's.

The decision changes the grant matrix, so it must precede the migration that grants it. §22's migration (b) grant column cannot be finalised until it is made.

**For the remainder of this section**, the privilege table above states what each *function* needs; which *principal* performs each function is exactly the open question.

**No `GRANT ALL`, no `ON ALL TABLES`, no default privileges, no table ownership to the runtime, and no arbitrary SQL capability.** Nothing is granted in this slice.

---

## 20. Indexing and scale

Proposed from actual access patterns only. Four indexes beyond the constraints, each tied to a query that will exist:

| Index | Pattern served |
| --- | --- |
| `integration_outbox_ready` on `(organization_id, integration_connector_id, next_attempt_at)` `where state in ('pending','retrying')` | The worker's ready scan. Partial, so it stays small as settled rows accumulate — the dominant long-term shape, since most rows end terminal |
| `integration_outbox_single_inflight` **unique** on `(organization_id, integration_connector_id, aggregate_type, aggregate_id)` `where state in ('dispatching','ambiguous')` | Ordering and poison isolation (§10); also the in-flight guard |
| `integration_outbox_aggregate` on `(organization_id, aggregate_type, aggregate_id)` | Staff/operator lookup of a request's integration state; later, reconciliation |
| `integration_attempt_delivery` **unique** on `(organization_id, integration_outbox_id, attempt_number)` | Attempt history for one delivery, and double-count prevention |

Already covered by constraints, needing no separate index: `unique(organization_id, integration_connector_id, dedupe_key)` (enqueue idempotency), `unique(organization_id, integration_id)` (envelope lookup), `unique(organization_id, connector_key)`.

**Deliberately not proposed now:**

- A dead-letter operator index — the operator view does not exist yet, and `integration_outbox_ready`'s partial shape does not serve it. Add it in the slice that adds the view.
- An oldest-pending-age index. F062 Part 11 makes oldest-pending age the alert signal, and `integration_outbox_ready` ordered by `next_attempt_at` may already serve it; whether `occurred_at` needs its own partial index is a measurement question, not a guess.
- Any index on `correlation_id` or `causation_id` until a query needs one.

**Partitioning: not now.** There is no partitioning anywhere in the repository (measured: 0), it complicates the composite-FK and trigger patterns this design depends on, and there is no volume evidence. Conditions that should trigger a later review, to be confirmed by measurement rather than treated as thresholds decided here:

- the ready scan's latency degrades despite the partial index;
- settled rows cannot be kept bounded because retention durations are long (§17);
- autovacuum cannot keep up with the churn of a high-volume connector;
- an operator needs to drop a whole retention window cheaply, which is partitioning's real advantage over bulk DELETE.

Until then the partial-index-plus-retention approach is simpler and matches how this repository already works.

---

## 21. Failure and recovery

| Scenario | Behaviour |
| --- | --- |
| **Worker crashes after external success, before recording** | The attempt row already exists, opened at claim time with its `started_at`, `claim_generation`, connector revision and capability snapshot — so the dispatch is on record even though its result never was. The outbox row stays `dispatching` until `claimed_until` lapses; recovery then **settles that same attempt as `ambiguous`** and sets the outbox to `ambiguous` — not `pending` (§9.3). §11's resolution order applies. This is the case the whole ambiguity model exists for, and the case the claim-time attempt row exists for |
| **PostgreSQL restarts** | Nothing is lost: all state is committed rows. In-flight claims become stale leases and recover as above. No in-memory queue exists to lose |
| **Connector disabled mid-flight** | The in-flight attempt completes and is recorded. Further dispatch stops (`mayDispatch` false); enqueue continues (`mayEnqueue` true). Nothing is discarded or reassigned |
| **Schema version becomes unsupported** | `negotiateReplayVersion` **refuses** rather than re-encoding. The row becomes `refused` with an operator signal — never a silent downgrade of meaning |
| **Credential unavailable** | `destination_unconfigured` or `authentication_failed`. `authentication_failed` is **not** transient: retrying cannot succeed and only delays the operator signal |
| **Destination down for hours or days** | Transient failures with exponential backoff and full jitter; rows accumulate. Intake never fails. The alert is the **age of the oldest pending row** per connector, not queue depth |
| **Event exceeds maximum pending age** | **Open product decision** (§24): dead-letter, or escalate and hold. The schema supports both; the policy is not invented here |
| **Operator manually resolves an ambiguity** | Appends an attempt row and transitions state, with an audit row required in the same transaction. The original ambiguous attempt is preserved |

At-least-once is preserved throughout: no path discards an unsettled intent, and every uncertain outcome resolves to a state that requires either evidence or a human — never to a silent retry.

---

## 22. Migration design

**Recommendation: multiple bounded migrations, not one.** The repository's own precedent is decisive — the tenant-domain family took five (45–49), each independently reviewable with its own rollback guard. A single migration creating three tables, their triggers, the state machine and the indexes would be large, hard to review, and all-or-nothing to roll back.

**Do not reserve or create Migration 50.** Ordinals must be taken from the authoritative migration directory at implementation time.

| Bounded migration | Forward schema | Constraints | Indexes | Rollback safety | Grants | Tests required |
| --- | --- | --- | --- | --- | --- | --- |
| **(a) connector** | `integration_connector`, `integration_connector_audit` | composite-FK support via `unique(organization_id, id)`; lifecycle and timestamp cross-checks; `unique(organization_id, connector_key)` | `(organization_id, lifecycle_state)` only if the operator read exists | refuse rollback if any audit row or any non-`configured` connector exists | `select` on connector; `insert` on audit | audit fail-closed; immutability; retirement terminal; cross-tenant forge rejected |
| **(b) outbox** | `integration_outbox` | all of §3.2 plus the `guard_integration_outbox()` transition whitelist and the deferred replay-audit trigger | `_ready`, `_single_inflight`, `_aggregate`, dedupe unique | refuse rollback if any row exists in any state other than `pending` | `select, insert` or EXECUTE on transition functions | full transition matrix including every forbidden edge; dedupe; atomicity with the domain transaction; ordering |
| **(c) attempt** | `integration_delivery_attempt` | composite FKs, the open/settled biconditionals, outcome/category cross-checks, the complete-once guard | `unique(organization_id, integration_outbox_id, attempt_number)` and the `integration_attempt_open` partial unique | refuse rollback if any attempt row exists | `insert, select, update` (completion only), or EXECUTE on transition functions — **provisional pending §19.1** | complete-once enforcement; settled rows refuse UPDATE; **at most one open attempt per outbox row**; fenced completion updates zero rows; recovery settles the existing attempt rather than inserting a second; truncate refusal; hash-only columns; no raw text storable |

Each must also: open with `set local lock_timeout` and the established `lock table` discipline; carry an `/** Ordinal N. ... */` header naming the governing decision; and extend `server/src/database/database.types.ts` importing the F062.1 unions rather than restating them.

Migration (b)'s grant column is deliberately provisional: it cannot be finalised until §19.1's worker-identity decision is made, because the grant differs between a shared principal with SECURITY DEFINER transitions and a distinct worker login.

**Data-loss guards.** Every `down` must refuse when evidence exists, using the measured `raise exception 'Retained ... evidence prevents rollback'` pattern. An outbox containing undelivered intents must not be droppable: rolling it back would discard obligations Reqro accepted.

**Test requirements** beyond the per-migration list: extend `test/database/cross-tenant-isolation.integration.test.ts` with forged-reference attempts for all three tables, and `test/database/database-role-separation.integration.test.ts` with the new grant surface — including a negative assertion that the runtime **cannot** transition an outbox row to `accepted` by direct UPDATE. Database suites require `TEST_DATABASE_URL` against a local disposable database and **skip without it; a skip is not a pass.**

### 22.1 Required: state-machine parity with F062.1

> **SQL state-machine drift from the TypeScript contract is not permitted.** The durable vocabulary and the allowed transition model must be *proven* aligned with F062.1 by database integration test, not kept aligned by discipline.

The risk is specific and likely. The check constraints restate F062.1's vocabularies as SQL string lists; the transition whitelist restates the state machine inside a plpgsql trigger. Both are copies. A later slice that adds a delivery state, renames one, adds a failure category or relaxes a transition in TypeScript will not break any SQL — the database will simply keep enforcing the old contract, silently, and the divergence surfaces as a constraint violation in production rather than a failing test. This is the same class of defect F062.1's own boundary suite was built to prevent, and it deserves the same treatment: assert equality, not absence.

Required assertions, in a database integration suite introduced with migration (b):

| Assertion | Method |
| --- | --- |
| **Vocabulary equality, per column** | Read the live `CHECK` constraint definitions from `pg_constraint` (via `pg_get_constraintdef`), parse out the enumerated literals, and assert **set equality** with the imported F062.1 constants — `deliveryStates`, `attemptOutcomes`, `integrationFailureCategories`, `connectorLifecycleStates`, `contractKinds`, `aggregateTypes`, the `INTEGRATION_TYPES` keys, and §8.1's `reason_code` set. Equality in both directions: a value in SQL but not TypeScript fails, and a value in TypeScript but not SQL fails |
| **Transition model equality** | Declare the allowed `(from, to)` pairs as data in one place the test can import, then **exercise every ordered pair** of the 9 states against the live trigger — 72 off-diagonal pairs — asserting that exactly the whitelisted pairs succeed and every other pair raises. A whitelist that merely passes its own happy path proves nothing about what it forbids |
| **Terminality equality** | Assert the states from which no transition succeeds equal F062.1's `terminalDeliveryStates`, with the single documented exception of the authorized `dead_lettered → pending` replay edge |
| **Named prohibitions** | Individually assert the four required refusals: `accepted → pending`, `acknowledged → pending`, `dead_lettered → dispatching`, and `ambiguous → dispatching` without a pinned `supportsIdempotencyKey`. These are already covered by the exhaustive pair sweep, and are asserted by name as well so a regression report says *which rule* broke |
| **Resident invisibility** | Assert `residentVisibleDeliveryStates` is empty and that no resident-facing query path joins these tables |
| **Claim-time attempt evidence** | Assert the claim transaction creates the open attempt row, that it is durable before any dispatch, and that it binds `organization_id`, `integration_outbox_id`, `attempt_number`, `claim_generation`, `claim_token`, `connector_revision`, `capability_snapshot` and `started_at` (§9) |
| **Fencing** | Assert a stale `claim_token` settles nothing and transitions nothing — zero rows on both statements — and that it **cannot overwrite an attempt already settled by recovery** (§9.1) |
| **Complete-once** | Assert a settled attempt refuses UPDATE, that at most one open attempt per outbox row can exist, and that recovery **settles the existing open attempt as `ambiguous`** rather than inserting a second or returning the outbox row to `pending` (§3.3, §9.3) |
| **Pinning** | Assert that changing a connector's capabilities does **not** change the resolution available to an already-recorded ambiguity (§9.2) — the regression that would retroactively authorise a blind retry |

The single-source-of-truth rule follows from this: **F062.1 is authoritative, SQL is derived.** A future vocabulary change starts in `src/integration/`, and the parity test is what makes the migration to match it mandatory rather than remembered.

---

## 23. Recommended implementation slicing

The suggested names are not adopted unchanged, because a safer split emerged: **connector configuration must precede the outbox** (the outbox composite-FKs it), and **enqueue must precede any dispatch machinery** so atomicity is proven while nothing can send.

| Slice | Content | Gating |
| --- | --- | --- |
| **F062.2B — connector configuration persistence** | Migration (a), repository, lifecycle guards, connector audit. **Connector metadata and configuration persistence only: no credentials, no credential resolution, no transport, no outbox, no dispatch.** `credential_reference` is stored as a reference and nothing reads or resolves it | **May proceed once this assessment is accepted.** Needs no open decision |
| **F062.2C — outbox persistence and atomic enqueue primitives** | Migration (b), the enqueue primitive inside the domain transaction, dedupe, `payload_mode` refusal, `refused` on routing failure, and the §22.1 parity suite. **No worker, no dispatch, no transport.** The deliverable is a database proof that domain state and outbox intent **commit together and roll back together** | **May proceed after 2B** (the outbox composite-FKs the connector). The reconstruction question does not block it, because §2.3 makes ineligibility a refusal rather than an assumption |
| **F062.2D — attempt persistence, claiming, fencing and dispatch** | Migration (c), transition functions, claim/lease/fencing, stale-lease recovery to `ambiguous`, connector revision pinning, backoff, dead-letter, **a loopback connector only** | **Blocked on BOTH: (1) the worker identity and grant decision (§19.1), and (2) required operational policies, in particular maximum pending age (§24 item 2).** Neither is a detail to settle during implementation: the first determines the grant matrix the migration applies, the second is part of the dead-letter transition's meaning |
| **F062.2E — operator read surface** | Read-only visibility for dead-lettered and ambiguous rows, plus the dead-letter index. No replay yet | After 2D |
| **F062.2F — replay and ambiguity resolution** | Authorized, audited transitions: dry run, confirm, audit evidence | After 2E |
| **F062.2G — external reference mapping** | The mapping table, once a second operation needs lookup | Blocked on the first real destination's **actual API documentation** |
| **F062.2H — inbound inbox ledger** | `integration_inbox`, mandatory before any inbound endpoint ships | Blocked on F062.4 |
| **F062.2I — reconciliation findings** | Its own append-only findings table, detect-only | Blocked on F062.5 |

**F062.2C must not automatically wire a real business event whose payload or reconstruction contract has not been approved.** This is a constraint on the slice, not a consequence of it. §2.2 records that **no declared `event` type is currently eligible** for historical reference, and §2.3's two check constraints make every `event` unenqueueable until a reviewed migration admits one. So 2C must prove its machinery using a `state_sync` intent and explicit refusal cases — not by attaching an enqueue call to request submission, status change or closure. Wiring a real event would either require relaxing those constraints, which needs the approval they exist to compel, or would produce an enqueue path that fails in production the first time it runs.

---

## 24. Unresolved decisions and blockers

**Hard blockers — a named slice cannot proceed until these are decided:**

1. **Worker database identity and grant model** (§19.1). **Blocks F062.2D.** An in-process worker on `reqro_runtime` is not principal separation, and SECURITY DEFINER narrows privilege without creating an identity. The decision sets migration (b)'s grants, so it precedes implementation.
2. **Maximum pending age and its expiry action** — dead-letter, or escalate and hold. **Blocks F062.2D.** Carried forward from F062 Part 17 item 4; it is part of the schema's meaning, not a runtime tunable.
3. **Approved snapshot payload mode** (§2.3). **Blocks any real business event in any slice.** No declared `event` type is eligible for historical reference today, so until either an exact invariant exists or snapshot retention is approved, events are unenqueueable by constraint. Needs privacy, classification and retention approval, because it is the one mode that puts business data into an integration table.
4. **First destination's actual API documentation.** Blocks F062.2G and every real connector. AGENTS.md forbids substituting an assumption.

**Decisions required for completeness, not currently blocking an authorized slice:**

5. **Whether `request_operational_activity` should gain a non-null `request_revision` plus `unique(organization_id, service_request_id, request_revision)`**, which is what would make `status_changed` and `closed` eligible for historical reference (§2.4). This touches an **F062-external domain table** and is **not in scope here** — reported, not acted on, and not to be changed inside an integration slice.
6. **Whether `service_request.description` must be immutable** after submission for a faithful `submitted` event, or whether the event payload excludes it (§2.4). A product and data decision.
7. **Adapter revision definition** (§9.2) — what constitutes a versioned adapter behaviour change, which depends on the first real connector's shape.
8. **Retention durations** for all five categories (§17). **Remains unresolved.** §17.1 settles *who* may delete and under what evidence; it sets no duration and implies none.
9. **The purge-exemption mechanism** (§17.1) — an audited session marker for the privileged retention role, or trigger replacement inside a reviewed maintenance migration. Must be chosen when a retention policy exists, and must not be reachable by the application role.
10. **Connector secret-reference mechanism**, dependent on the still-open operator-platform secret-manager decision (F062 Part 17 item 6).
11. **Whether a bounded transport status class** belongs on the attempt row for operator diagnostics. Default recommendation: **no** (§8.1).
12. **Whether `cancelled` is a required delivery state** (§7). Default recommendation: **no**.
13. **`connector_kind` vocabulary**, which must describe capability profiles rather than vendor products, and which depends on F062 Part 17 item 1 — which destination is first.
14. **ADR number.** An ADR is warranted for the outbox, fencing, pinning and state-machine decisions. Highest existing is ADR-030; **none is allocated here.**

---

## Is implementation safe to begin?

**Partly, and the boundary is now exact.**

**F062.2B may proceed once this assessment is accepted.** Connector metadata and configuration persistence only — no credentials, no credential resolution, no transport, no outbox, no dispatch. It depends on no unresolved decision.

**F062.2C may proceed after 2B.** Outbox persistence, atomic enqueue primitives, and a database proof that domain state and outbox intent commit and roll back together. It must **not** wire a real business event whose payload or reconstruction contract has not been approved: no declared `event` type is eligible today (§2.2), the check constraints in §2.3 make events unenqueueable, and the machinery is proven with a `state_sync` intent plus explicit refusal cases. 2C also delivers the §22.1 parity suite, so the SQL contract is pinned to F062.1 from the first migration that restates it.

**F062.2D remains blocked on both** the worker identity and grant decision (§19.1) and the required operational policies, maximum pending age chief among them (§24 item 2). Either one alone is sufficient to block it: implementing dispatch without the first means applying a grant matrix nobody chose, and without the second means encoding a dead-letter edge nobody decided.

**Later connector implementation remains blocked on the real destination's API documentation**, which AGENTS.md forbids substituting with an assumption. F062.2H and 2I remain blocked on F062.4 and F062.5 respectively.

**Recommendation: authorize F062.2B, then F062.2C**, and treat §24's four hard blockers as the gating questions for everything after them.

---

## Validation

| Check | Result |
| --- | --- |
| Relative markdown links resolve | pass — see completion report |
| Internal section cross-references resolve | pass |
| Trailing whitespace / tabs / control characters | none |
| `git diff --check` | clean |
| Only this document changed | verified |
| Migrations run | **none** — no migration created, modified or executed |
| F062.1 code, existing migrations, grant files, ADRs | **unmodified** |
| Vocabularies claimed as reused from F062.1 | verified verbatim against `src/integration/` at the baseline commit |

## Related

- [F062 — Enterprise integration reliability and eventing architecture](F062-enterprise-integration-eventing-architecture.md) — the accepted architecture this design serves
- [F062.1 — Enterprise integration contracts foundation](F062-1-integration-contracts-foundation.md) — the closed vocabularies these tables bind to
- [ADR-001 — Organization isolation](../architecture/decisions/ADR-001-organization-isolation.md) — the composite tenant-safe reference pattern
- [ADR-024 — Transaction-time request authorization](../architecture/decisions/ADR-024-transaction-time-request-authorization.md) — the one-transaction discipline the outbox insert joins
- [ADR-025 — Trusted production Organization resolution](../architecture/decisions/ADR-025-trusted-production-organization-resolution.md) — the tenant-domain migrations whose audit, guard and attempt-evidence patterns are reused here
- [ADR-026 — Outbound notification and delivery architecture](../architecture/decisions/ADR-026-outbound-notification-delivery-architecture.md) — the precedent generalised, including the recorded-not-delivered discipline
- [ADR-027 — Platform operator bootstrap and recovery](../architecture/decisions/ADR-027-platform-operator-bootstrap-recovery.md) and [F060.3C-2D — Database role separation](F060-3C-2D-database-role-separation.md) — the owner/migrate/runtime/operator topology and least-privilege grant matrix the grant plan preserves
