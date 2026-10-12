# F062.2D-2C-3B-1 — Execution policy persistence

> **NO POLICY NUMBERS ARE SELECTED.**
>
> **NO PLATFORM POLICY ROW IS INSERTED.**
>
> **NO LEASE IS AUTHORED.**
>
> **NO RETRY IS SCHEDULED.**
>
> **NO RECOVERY EXECUTES.**
>
> **NO RETRY-AFTER EVIDENCE IS ADDED.**
>
> **NO WORKER ROLE OR EXECUTE GRANT EXISTS.**
>
> **NO PRODUCTION POLICY AUTHORING API EXISTS.**
>
> **F062.2D-3 REMAINS BLOCKED.**

This slice is **persistence only**. It adds columns, one table, constraints,
foreign keys and guard extensions, plus the types and tests that describe
them. It changes **no worker function**, reads no policy at runtime, and
calculates nothing. The platform policy table ships **empty**, so
F062.2D-2C-3C fails closed until a separately reviewed operator path records
a revision.

Starting point: `origin/main` at
`9e936adf5f72827d61b19ea888e6a487d549eb3b`, which carries the merged
F062.2D-2C-3B-0 decision (`558b5ac`, PR #47) as a verified ancestor.

---

## 1. Architecture source

| Source | What it governs here |
| --- | --- |
| **[F062.2D-2C-3B-0](F062-2D-2C-3B-0-execution-policy-persistence-schema-decision.md)** | the whole persistence shape: §2 the two authority classes, §5 the amended lease derivation this schema must support, §6 integer seconds, §7/§28.3 the platform table and its database-authored revision, §9 the two attempt pins, §23.1 the new change category, §25 derived completeness, §26/§26.1 zero backfill and the activation gate, §27 the five-condition rollback refusal, §28 the exact schema, §29 the trust matrix, §32 the mandatory invariants |
| [F062.2D-2C-3-0](F062-2D-2C-3-0-worker-execution-policy-function-signatures.md) | §12 destination retry budget derivation, §14 bounded exponential jitter, §26 the thirteen numbers that remain unresolved |
| [F062.2D-2C-3A](F062-2D-2C-3A-strict-fifo-retry-dispatch-function-hardening.md) | the claim and dispatch-marker functions this slice must leave byte-unchanged, and the `claim_expires_at`-is-NULL precedent the policy pins follow |
| [F062.2B](F062-2B-connector-metadata-persistence-foundation.md) | `configuration_revision` vs `record_revision`, the change-category vocabulary, and the append-only audit snapshot whose guards are extended here |

### 1.1 The Phase 0 ambiguity and its resolution

3B-0 §23.1 required the new category but did **not** define how it behaves
when execution policy and another connector family change in one authorized
mutation. Phase 0 stopped on that rather than letting the migration become
the first source of the rule.

The approved resolution is **A+ — execution-policy exclusivity with narrow
category binding**, recorded in §4 below.

The ambiguity was real because of how Migration 50 works. Its
`guard_integration_connector()` computes a single `semantic_change` boolean
spanning lifecycle *and* every capability field, and
`guard_integration_connector_audit()` validates every mirrored value but
**never validates `change_category`**. So once policy joined the semantic
boundary, one UPDATE could have changed policy together with capabilities and
been labelled either way.

---

## 2. Migration identity

**Ordinal 57**,
`server/migrations/20261027000000-add-integration-execution-policy-persistence.ts`.

Migrations 50 and 52–56 are **byte-identical**; 57 extends the three guard
functions with `CREATE OR REPLACE`, built by **asserted transformation** of
their live definitions so every preserved clause is provably unchanged and
`down()` restores the originals verbatim.

**Migration 57 hardcodes no schema name.** Unlike Migrations 48, 49, 53 and
56, it qualifies nothing with `public.`, so it is safe for a test to import
and apply to a disposable schema. The migration-import guard asserts this
rather than assuming it: adding `public.` to 57 later breaks that test
instead of silently running the migration against the wrong schema.

---

## 3. Connector-pinned execution policy

Four columns on `integration_connector`, **mirrored identically** into
`integration_connector_audit`:

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| `request_execution_budget_seconds` | `integer` | yes | **none** |
| `destination_retry_base_delay_seconds` | `integer` | yes | **none** |
| `destination_retry_max_delay_seconds` | `integer` | yes | **none** |
| `destination_retry_attempt_ceiling` | `integer` | yes | **none** |

**No default, deliberately.** A default would be a policy number chosen by a
migration. The absence is asserted by test, not just intended.

**Integer seconds and counts, not `interval`** (3B-0 §6): no `interval`
column exists anywhere in the schema, and `interval` comparison normalises a
month to 30 days while `clock_timestamp() + interval` is calendar-dependent —
not what belongs under a security-sensitive comparison.

### 3.1 Complete-or-null, and the other invariants

| Constraint | Form |
| --- | --- |
| `…_execution_policy_positive` | each of the four is null **or** `> 0` |
| `…_execution_policy_complete` | all four null **or** all four non-null |
| `…_retry_delay_ordered` | `base <= max` when both are non-null |

Each exists on **both** tables, with `integration_connector_audit_`-prefixed
names on the mirror.

**A partially configured revision is unrepresentable.** That removes the
hazard 3B-0 named — a connector becoming worker-executable because one field
was set — structurally, rather than by a runtime check that could be
forgotten. The test proves all **fourteen** proper non-empty subsets are
refused, not a sample.

The positivity rule is exactly 3B-0 §28.1's: **zero is permitted nowhere**,
and nothing here strengthens or weakens it.

> **What this check cannot express.** `base <= max` is enforced against the
> connector's own cap. The platform clamp can still pull the **effective**
> cap below a validly configured base — legal when written, contradictory
> later when a tighter platform revision is recorded and no connector row
> changed. That check belongs to 3C at derivation time (3B-0 §8.2) and is
> not expressible as a table constraint, because it spans two tables and two
> authorities.

---

## 4. A+ — execution-policy mutations are single concern

> ### FROZEN: if any of the four policy fields changes, no other connector
> ### change family may change in the same UPDATE, and the audit row must
> ### carry exactly `execution_policy_changed`.

### 4.1 Exclusivity

`guard_integration_connector()` gains an explicit `policy_change` boolean and
keeps policy inside the semantic boundary:

```
configuration_change = <lifecycle or any capability field, unchanged>
policy_change        = <any of the four policy fields>
semantic_change      = configuration_change or policy_change
credential_change    = <credential_reference>
```

| Combination | Outcome | Enforced by |
| --- | --- | --- |
| policy + lifecycle | **REFUSED** — *"An execution policy change must not accompany a lifecycle or capability change"* | the new rule |
| policy + capabilities | **REFUSED** — same message | the new rule |
| policy + credential | **REFUSED** — *"Credential rotation must not accompany a configuration change"* | Migration 50's **existing** rule, which now reaches policy because `policy_change` implies `semantic_change` |
| policy alone | accepted, advances `configuration_revision` exactly once | existing revision rule |

`policy_change` is tracked as its own boolean rather than folded into the
`configuration_change` disjunction **because the exclusivity rule has to tell
a policy change apart from a lifecycle or capability one.** That is the only
reason the boolean exists.

The policy + credential case is covered by inheritance, but the test asserts
it **explicitly** so a future change to Migration 50's separation rule cannot
silently open the combination.

**No precedence is introduced**, and one UPDATE is never split into several
revisions. The mixture is made *unrepresentable*, which is the same shape as
the rule already in that guard.

### 4.2 Narrow category binding

`guard_integration_connector_audit()` binds the new category to a real policy
delta **in both directions**:

| Condition | Outcome |
| --- | --- |
| policy changed, category is anything else | **REFUSED** — *"An execution policy change must be recorded as execution_policy_changed"* |
| category is `execution_policy_changed`, policy did not change | **REFUSED** — *"The execution_policy_changed category requires an execution policy change"* |

So the member carries **structural** meaning rather than application
convention: a policy change is always distinguishable in audit history from a
capability change, and the category cannot be borrowed.

**The prior snapshot is deterministic from existing linkage.** The guard
compares against record revision − 1, which is exact because the connector
guard advances `record_revision` by exactly one per accepted mutation and
`unique (organization_id, integration_connector_id, record_revision)` makes
that a single row. 3B-0's conditional stop therefore did not trigger: **no
session state, temporary flag, mutable metadata or caller assertion is
introduced**, and no new persistence was needed to answer the question.

**Keyed on predecessor existence, not on category.** Revision 1 has no
predecessor, and Migration 50's existing
`(change_category = 'registered') = (prior_record_revision is null)` check
already refuses any other category there — so **registration semantics stay
owned by Migration 50**, and this guard raises only about the comparison it
actually needs.

### 4.3 What A+ deliberately is not

| Not this | Why it is not |
| --- | --- |
| Plain Option A | the category binding of §4.2 is present, so the new member is structural |
| Option B precedence | no rule picks a winner among mixed concerns; the mixture is refused outright |
| Option C taxonomy redesign | `lifecycle_changed`, `capabilities_changed`, `credential_reference_rotated` and `registered` are **not** validated against their own deltas. Their meanings are untouched |
| Option D caller-chosen category | a policy change cannot be labelled anything else, and the label cannot be used without one |

> **Recorded honestly as pre-existing, and left alone:** the database still
> imposes no category-to-change binding for *lifecycle versus capability*
> changes, so a privileged direct writer can combine those two and label the
> result either way. The reviewed application boundary prevents it by having
> four single-concern methods, each hard-coding one category. That looseness
> predates this slice, is explicitly outside its scope, and 3B-1 neither
> widens nor narrows it.

### 4.4 Audit vocabulary

`execution_policy_changed` is added to Migration 50's auto-named column check,
which 57 locates **by its definition** (the only check on that table
mentioning `capabilities_changed`) and replaces with a deterministically
named one. If that constraint is ever absent or ambiguous the migration
**raises** rather than proceeding, so upstream drift fails loudly instead of
leaving the old vocabulary in place.

`revision_advanced` needs no change: Migration 50's existing
`revision_advanced = (change_category <> 'credential_reference_rotated')`
already makes the new category advance the configuration revision, matching
`advancesConfigurationRevision`.

**No second revision counter is created.** The test asserts the connector
carries exactly `configuration_revision` and `record_revision`.

---

## 5. Policy changes create connector revisions

A policy change advances `configuration_revision` through the **existing**
mechanism, writes a new immutable audit snapshot, and pins all four values
into it. Old audit revisions are never mutated.

Existing obligations keep their `pinned_connector_configuration_revision` and
therefore continue to read the policy of that exact snapshot. The test proves
a later policy change does **not** reinterpret an earlier revision, and that
an audit row disagreeing with the connector row is refused by the mirror
check.

---

## 6. Trust boundary: no grant, no authoring path

**The existence of these columns does not authorize direct table `UPDATE`.**
Tenant/admin write authority means **logical authority through the existing
reviewed connector-authoring boundary**, and the audit snapshot remains
database-authored as a consequence of that path.

3B-1 adds **no** table grant, column grant, direct audit `INSERT` grant or
runtime `UPDATE` permission. It adds no controller, route, service API,
operator endpoint, CLI, seed or default-policy insert. Nobody becomes able to
configure production policy merely because the schema exists.

Tests insert rows directly to exercise constraints and evidence behaviour.
That is persistence verification; it creates **no production authoring
authority**. Future operator authoring is a separate reviewed slice.

---

## 7. Global platform execution-safety policy

`integration_execution_safety_policy` — **global, append-only, zero rows.**

| Column | Type | Nullable | Default | Authority |
| --- | --- | --- | --- | --- |
| `policy_revision` | `bigint` | no | **identity** | **database** |
| `max_claim_lease_seconds` | `integer` | no | none | operator |
| `lease_safety_margin_seconds` | `integer` | no | none | operator |
| `max_destination_retry_delay_seconds` | `integer` | no | none | operator |
| `max_destination_retry_attempts` | `integer` | no | none | operator |
| `max_retry_horizon_seconds` | `integer` | no | none | operator |
| `max_pre_dispatch_recoveries` | `integer` | no | none | operator |
| `recovery_delay_seconds` | `integer` | no | none | operator |
| `max_recovery_batch_size` | `integer` | no | none | operator |
| `reason` | `varchar(200)` | no | none | operator |
| `correlation_id` | `uuid` | no | none | operator |
| `recorded_at` | `timestamptz` | no | `clock_timestamp()` | **database** |
| `mutation_txid` | `bigint` | no | `txid_current()` | **database** |

**There is no `organization_id`, ever.** These are Reqro's own safety
ceilings, not tenant configuration, and an Organization column is exactly how
a tenant would come to own a bound that exists to protect the platform and
the destination.

**There is no `actor`.** No trusted operator identity model exists for this
write surface, so the column could hold only self-declared text —
attribution that looks authoritative in an audit and is not. Deferred to the
future reviewed operator-authoring path; `reason` and `correlation_id` are
the interim record (3B-0 §7, §28.3).

All eight policy values are **NOT NULL**, so a revision is complete when it
is inserted, and all eight are **without default**, so no number enters the
schema. Each carries a `> 0` check: structural contract, not policy tuning.

### 7.1 Database-authored revision

`generated always as identity`. The caller **cannot choose** a revision;
monotonicity is the sequence's job rather than a read-modify-write the caller
performs. **There is no `max(policy_revision) + 1` logic**, no `is_active`
flag and no mutable current-policy pointer.

**Current policy is the greatest committed `policy_revision`.**

**Gaps are acceptable** and are not treated as an error: a rolled-back
transaction consumes a sequence value, and nothing depends on contiguity
because pins reference a revision by value. The test proves a rolled-back
revision never becomes durable, that a subsequent insert still succeeds, and
that ordering by `policy_revision` remains total across the hole.

Concurrency is proven rather than argued: two inserts are held in flight on
separate connections before either commits and must receive distinct
revisions. Under `max(policy_revision) + 1` one would block and then collide.

A `policy_revision > 0` check is retained even though the database authors
the value, because a sufficiently privileged writer can still bypass identity
generation with `OVERRIDING SYSTEM VALUE`.

### 7.2 Immutability

A guard refuses `UPDATE`, `DELETE` and `TRUNCATE`; a **separate
statement-level trigger** covers `TRUNCATE`, because a row trigger does not
fire for it. `recorded_at` and `mutation_txid` are re-forced inside the
guard, so a caller-supplied value is discarded rather than trusted.

A correction is a **new revision**. There is no soft editing.

> **Two TRUNCATE barriers, both proven.** A plain `TRUNCATE` is refused by
> PostgreSQL *before any trigger runs*, because
> `integration_delivery_attempt` references the table. That is fail-closed
> but proves nothing about the guard — so the test also issues
> `TRUNCATE … CASCADE`, which removes the foreign-key objection and leaves
> the statement trigger as the only barrier. It is refused with
> *"append-only"*.

---

## 8. Attempt policy pins

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| `claim_policy_revision` | `bigint` | yes | none |
| `settlement_policy_revision` | `bigint` | yes | none |

**Both are `bigint`, matching `policy_revision` exactly.** A narrower
referencing column would make every foreign-key check a cross-type
comparison and would cap the pin below the range of the value it references.
The test asserts both types equal the referenced column's type rather than
hard-coding the word.

Two pins, not one, because the lease is authored at claim and its consequence
at settlement, with a legitimate policy change possible in between (3B-0 §9).

### 8.1 Foreign keys

Both reference `integration_execution_safety_policy(policy_revision)` with
**NO ACTION** on delete and update. **No `ON DELETE CASCADE`** (it would
delete attempt evidence) and **no `ON DELETE SET NULL`** (it would erase the
justification). Deletion is impossible anyway, because the immutability
guard refuses it — so the foreign key is defence in depth, and it is also
what makes rollback refuse referentially rather than only procedurally. The
test asserts neither referential action appears in either definition.

### 8.2 Guard semantics

The existing guard is **extended, not replaced**: every protection from
Migrations 52 and 54 is preserved byte-identically, proven clause by clause.

| Rule | Behaviour |
| --- | --- |
| `claim_policy_revision` at creation | **may** be supplied — a future 3C claim authors it at creation. In this slice nothing supplies it, so it is always NULL |
| `claim_policy_revision` on update | **write-once**: any change, including clearing it, is refused |
| `settlement_policy_revision` at creation | **refused** — an attempt is created open, and a settlement pin justifies a settlement's consequence |
| `settlement_policy_revision` while open | refused — *"requires a settled attempt"*. This also covers the dispatch-boundary update |
| `settlement_policy_revision` after set | cannot change or clear; settled rows were already immutable, and this is asserted explicitly |
| `settlement_policy_revision is null or completed_at is not null` | table check, **one-directional** |

> **The settled check is one-directional deliberately.** The biconditional
> (pin is null **iff** `completed_at` is null) would break every pre-3B-1
> settled attempt, which has `completed_at` non-null and the new column NULL.
> §9's no-backfill decision forces the weaker form, and **current completion
> without a settlement pin remains legal**.

`complete_integration_attempt` is **not modified** by this slice.

---

## 9. Existing rows: nothing is backfilled

| Relation | Result when Migration 57 applies |
| --- | --- |
| `integration_connector` | all four policy fields **NULL** |
| `integration_connector_audit` (historical) | all four policy fields **NULL** |
| `integration_delivery_attempt` | both pins **NULL** |
| `integration_execution_safety_policy` | **ZERO rows** |

**NULL means "execution policy was not established for this revision"** — a
true statement about history. No value is fabricated, no default is invented,
no seed row is written and no revision 1 is inserted.

### 9.1 The activation gate remains external

3B-1 does **not** disposition legacy obligations, mark anything
dead-lettered, re-enqueue anything or rewrite audit history. 3B-0 §26.1's
pre-3C activation gate is unchanged and undischarged.

What this slice does prove is that the gate is **answerable**: obligations
pinned to audit revisions with incomplete or NULL execution policy are
**deterministically inventoryable from existing evidence**, by joining the
outbox to its pinned audit snapshot on the already-indexed
`(organization_id, integration_connector_id, configuration_revision) where
revision_advanced` key. **No new table, column or flag** is added for it, and
the operator-disposition mechanism remains future work.

---

## 10. Rollback — fail closed

`down()` **refuses** if **any** of five conditions holds:

1. any `integration_connector` row has a non-null execution-policy field;
2. any `integration_connector_audit` row has a non-null mirrored field;
3. `integration_execution_safety_policy` contains **any** row;
4. any `claim_policy_revision` is non-null;
5. any `settlement_policy_revision` is non-null.

Condition 3 is why 3B-0 §27 was strengthened: a platform policy row that **no
attempt references** is still the record of an authorized operator decision,
and the original narrower rule would have missed it. The test covers that
case specifically.

Rollback never deletes policy rows, never NULLs policy evidence, never
rewrites historical audit snapshots and never fabricates compatibility.

A clean rollback is legal **only** from the state immediately after apply —
every new column NULL everywhere and the policy table empty — where it
destroys nothing. It then drops the columns, constraints, foreign keys, the
platform table and its triggers, restores Migration 50's four-member
category vocabulary, and **restores the prior connector, audit and attempt
guard definitions verbatim**.

Evidence-bearing refusals are tested in **separate disposable schemas**, so
no test defeats its own point by cleaning up the evidence it is meant to
protect.

---

## 11. Handwritten types

`server/src/database/database.types.ts` gains the four connector columns, the
same four on the audit table, the two attempt pins, the
`IntegrationExecutionSafetyPolicyTable` interface and its `DatabaseSchema`
entry. `IntegrationConnectorChangeCategory` gains
`execution_policy_changed`, and `connectorChangeCategories` in
`connector-metadata.ts` gains the matching member.

`policy_revision` and `mutation_txid` are typed `Generated<string>`, matching
the repository's existing `bigint` convention.

**No business DTO, no API request type and no policy-calculation code is
added.**

Parity is tested, not assumed: the test reads
`pg_get_constraintdef` for the vocabulary constraint and asserts the accepted
set equals the TypeScript vocabulary **by equality in both directions**, so
neither side can accept a category the other refuses.

---

## 12. Contracts preserved for 3C, not implemented

Persistence must support these, and the schema is shaped so it can, but
**none is calculated here**:

| Future derivation | Support in this schema |
| --- | --- |
| `required_lease = request_execution_budget_seconds + lease_safety_margin_seconds`, requiring `required_lease <= max_claim_lease_seconds`, then `effective_lease = required_lease` | both inputs are stored rows. **No `effective_lease` column, no generated column, no calculation** |
| `effective_retry_max_delay = min(connector max, platform max)`, then requiring `base <= effective_retry_max_delay` | both inputs are stored. **Not persisted**, and the base is never clamped downward |
| `effective_destination_attempt_ceiling = min(connector ceiling, platform attempts)` | both inputs are stored. **Not persisted**, and no `retry_count` is added |
| Retry horizon from the **first non-null `dispatch_started_at`** | derivable from immutable attempt evidence. **No anchor column is added**, and neither `outbox.created_at` nor first claim time is used |

`attempt_number` remains an evidence ordinal, not a destination retry count.

---

## 13. Validation

| Check | Result |
| --- | --- |
| New execution-policy persistence suite | **36/36 pass** (35 subtests), no sleeps |
| Migration 57 apply, clean rollback, reapply | pass |
| Rollback refusal per evidence class | pass — connector, audit-only, unreferenced policy row, and attempt pin |
| Revision concurrency and gap tolerance | pass |
| Policy immutability (`UPDATE`/`DELETE`/`TRUNCATE`/`TRUNCATE CASCADE`) | pass |
| Connector policy constraints | pass — including all 14 partial subsets and both non-positive values per column |
| A+ exclusivity and category binding | pass — all three combinations and both binding directions |
| Attempt pin, foreign key and guard semantics | pass |
| Legacy-obligation inventory proof | pass |
| Worker-function compatibility with 57 applied | pass — claim still works, lease still NULL, both pins NULL, marker still accepts a valid claim, recovery function still absent |
| Guard preservation audit | pass — 191 original clause lines preserved across three guards, 0 dropped; `down()` restores all three verbatim |
| Migrations 50, 52, 53, 54, 55, 56 | **unchanged** |

Full command-level results, including the suites run across the whole
repository, are in the slice's completion report.

> **Environment note, recorded rather than smoothed over.** The reachable
> `TEST_DATABASE_URL` cluster is **PostgreSQL 18.6**, while the repository
> targets `postgres:17-alpine`. Results obtained on 18.6 are reported as
> such, and the PostgreSQL 17 run is reported separately.

### 13.1 Synthetic test values are not policy

The suite uses small, obviously artificial, mutually distinct integers so a
mis-mapped column surfaces as a wrong number rather than a passing test.
**They are test fixtures, not policy decisions, and no deployment may adopt
them.** All thirteen numerical policies of F062.2D-2C-3-0 §26 remain
unresolved, and nothing in this slice proposes a value for any of them.

---

## 14. Remaining work

| Slice | Owns |
| --- | --- |
| **F062.2D-2C-3B-2** | `destination_retry_after_seconds` — normalized integer duration, raw `Retry-After` header never persisted, caller-authored absolute timestamp rejected, legal only for `rate_limited`, absent while open, immutable after settlement. **Nothing of it exists here** |
| **F062.2D-2C-3C** | reading policy in the worker functions, authoring `claim_expires_at`, scheduling retries, jitter, the retry horizon, and recovery. Also the §9.1 activation gate and the operator-authoring boundary for platform policy |
| F062.2D-3 | the worker identity, its `EXECUTE` grant and the runtime. **Remains blocked**, and F061.3D remains the telemetry gate before any activation |

---

## Related

- [F062.2D-2C-3B-0 — Execution policy persistence schema and trust-boundary decision](F062-2D-2C-3B-0-execution-policy-persistence-schema-decision.md) — the decision this implements
- [F062.2D-2C-3A — Strict FIFO, retry eligibility and dispatch-marker hardening](F062-2D-2C-3A-strict-fifo-retry-dispatch-function-hardening.md) — the functions this slice leaves unchanged
- [F062.2D-2C-3-0 — Worker execution policy and function signatures](F062-2D-2C-3-0-worker-execution-policy-function-signatures.md) — the derivations 3C will implement
- [F062.2D-2C-2 — Ordered-stream and retry-eligibility persistence](F062-2D-2C-2-ordered-stream-retry-eligibility-persistence.md) — the pinned-snapshot derivation pattern
- [F062.2D-2C-1 — Lease, dispatch boundary and recovery-reason persistence](F062-2D-2C-1-lease-dispatch-recovery-reason-persistence.md) — the attempt guard extended here
- [F062.2B — Connector metadata persistence foundation](F062-2B-connector-metadata-persistence-foundation.md) — the connector guards extended here
- [F062.2D-1A — Pending age, expiry and dead-letter policy](F062-2D-1A-pending-age-dead-letter-policy.md) — the pending-age clock the retry horizon is kept separate from
- [ADR-027 — Platform operator bootstrap and recovery](../architecture/decisions/ADR-027-platform-operator-bootstrap-recovery.md) — the operator authority the platform policy class depends on
