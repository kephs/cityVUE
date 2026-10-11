# F062.2D-2C-1 — Claim lease, dispatch boundary and recovery-reason persistence

> **NO LEASE RECOVERY FUNCTION IS IMPLEMENTED.**
>
> **NO DISPATCH FUNCTION IS IMPLEMENTED.**
>
> **NO WORKER RUNS.**
>
> **NO RETRY SCHEDULING EXISTS.**
>
> **NO EXTERNAL DESTINATION IS CONTACTED.**

This slice makes safe lease recovery **representable**. F062.2D-2C-3 makes it
**executable**. Nothing added here acts on its own: there is no polling loop, no
scheduler, no timer, no transport, no HTTP client, no adapter, no
secret-manager access, no destination credential, no DNS or TLS configuration,
no vendor SDK, no `reqro_integration_worker` role, no `EXECUTE` grant, and no
F061 instrumentation. No NestJS runtime file is touched.

**No ADR number is allocated.** This implements the already-accepted
F062.2D-2C-0A contract.

Starting point: `origin/main` at `11b0a2c44069841e91315660d0c1b9e9baadafd4`,
which carries F062.2D-2C-0A (`8c4b0d5`) as a verified ancestor, merged as
PR #28.

---

## 1. Authoritative contract source

| Source | What it governs here |
| --- | --- |
| **[F062.2D-2C-0A](F062-2D-2C-0A-worker-execution-contract-amendment.md)** | The whole of it. §3 the two namespaces, §4 the exact reason identifier, §5 the possibly-dispatched shape, §6 the settlement matrix, §7 the partition invariant, §8 the TypeScript amendment, §12 the lease/settlement race, §13 the boundary protocol, §24.1 this slice's scope |
| [F062.2D-2C-0](F062-2D-2C-0-worker-execution-semantics-decision.md) | The design those decisions were drawn from |
| [F062.1](F062-1-integration-contracts-foundation.md) | The four outcomes, ten categories and two transient categories, all reaffirmed and none widened |
| [F062.2A](F062-2A-transactional-outbox-persistence-readiness.md) | §8.1's `reason_code` taxonomy, of which this persists the two-value Worker subset |
| [F062.2D-2A](F062-2D-2A-delivery-attempt-fencing-persistence.md) | The attempt table and guard this migration extends, and the `reason_code` deferral condition it honours |

### 1.1 Baseline read from source, not from summary

| Item | Value |
| --- | --- |
| Migrations before | **53**, highest ordinal `20261023000000` |
| Compiled before | **50** |
| Existing attempt columns | `id`, `organization_id`, `integration_outbox_id`, `integration_connector_id`, `attempt_number`, `claim_generation`, `claim_token_digest`, `connector_configuration_revision`, `capability_snapshot`, `started_at`, `completed_at`, `outcome`, `failure_category`, `mutation_txid` |
| Existing attempt `CHECK`s | all **unnamed**, including the one replaced here |
| TypeScript outcomes | **four** — `succeeded`, `failed_transient`, `failed_permanent`, `ambiguous` |
| TypeScript categories | **ten**; `transientIntegrationFailures` exactly `['destination_unavailable', 'rate_limited']` |
| Existing reason-code type in executable code | **none.** `grep` over `server/src`, `server/migrations` and `server/test` found no integration `reason_code` identifier; the only `reasonCode` hits belong to location eligibility |

**The blocking defect this slice exists to fix.** Migration 52 carried
`check (outcome is null or outcome = 'succeeded' or failure_category is not null)`,
so every non-successful settlement **required** a destination failure category.
A lease recovery contacted no destination, so **neither recovery shape could be
recorded without fabricating destination behaviour.**

---

## 2. Migration identity

**Migration 54 — `server/migrations/20261024000000-add-integration-lease-recovery-evidence.ts`.**

Ordinal derived from the repository: the previous highest was
`20261023000000`. The repository's naming convention is
`<ordinal>-<verb>-<subject>.ts`, so `add-integration-lease-recovery-evidence`
follows `add-integration-worker-function-api`.

**Unlike Migrations 48, 49 and 53 it hardcodes no schema name**, so it is
imported and compiled like Migration 52 rather than applied as text. Compiled
migrations therefore rise 50 → **51**, and the inventory 53 → **54**. A source
test asserts the absence of both `public.` and `search_path`, which is what
makes importing it safe.

Independently **applyable, rollbackable and reapplyable** — proven by two
tests, one with evidence present and one without.

---

## 3. Schema changes

Three nullable columns, **no defaults**, on `integration_delivery_attempt`:

| Column | Type | Null | Default | Authority |
| --- | --- | --- | --- | --- |
| `claim_expires_at` | `timestamptz` | yes | **none** | database, written once at claim |
| `dispatch_started_at` | `timestamptz` | yes | **none** | **database-authored**, write-once |
| `reason_code` | `varchar(40)` | yes | **none** | database-authored lifecycle settlement only |

### 3.1 Why all three are nullable

The claim function is deliberately unchanged in this slice, so nothing
populates `claim_expires_at`. `NOT NULL` would either break the existing claim
path or require fabricating lease history for rows that never had one.
**F062.2D-2C-3 tightens it** once the claim function computes it from approved
policy.

**No lease duration, interval or default is encoded anywhere.** A test asserts
that no constraint on the table mentions `interval` at all.

### 3.2 Deliberately not added

`next_attempt_at`, `requires_ordered_delivery`, `attempt_count`,
`retry_count`, `recovery_count`, `claimed_at`, `claimed_by`, `heartbeat_at`,
`renewed_at`, any ordering index, any retry or backoff computation, any role,
grant or function. A source test scans for all of them and requires zero
occurrences.

**`attempt_number` remains the immutable monotonic ordinal of attempt
*evidence* and is not the destination retry count** (F062.2D-2C-0A §18.2). No
counter column was added, so the two quantities cannot be conflated by reading
one as the other.

---

## 4. The reason-code subset

**Exactly two values**, both from F062.2A §8.1's Worker group:

| Value | Meaning |
| --- | --- |
| **`lease_expired_pre_dispatch`** | The lease expired while the boundary was unset, so **no external transmission could have occurred**. Named by F062.2D-2C-0A §4 |
| **`lease_expired_uncertain`** | The lease expired after the boundary was set, so a request may already have reached the destination. Pre-existing F062.2A authority |

### 4.1 Why only two

F062.2D-2A deferred `reason_code` with a binding condition: the taxonomy "has
no TypeScript authority yet, nothing in this slice can write it, and committing
a ~30-value DB-only vocabulary would create exactly the drift §2 forbids. It
arrives with the settle function that classifies outcomes, **alongside its TS
source**."

**This slice honours that condition exactly.** It persists only the values a
producer will exist for, and it lands them together with their TypeScript
authority. The other ~26 values remain design authority for the future
classifying path.

**`fenced_stale_completion` is deliberately excluded.** The implemented fence
records nothing on refusal — a stale claimant's `UPDATE` matches zero rows and
returns an undifferentiated `false` — so there is no row on which to write it.
Admitting an unwritable value would make the set-equality test assert a
vocabulary nothing produces.

---

## 5. The settlement matrix

Four origins, four shapes. The replaced rule is named in each row.

| # | Origin | `outcome` | `failure_category` | `reason_code` | boundary |
| - | --- | --- | --- | --- | --- |
| — | open | null | null | null | either |
| **A** | adapter success | `succeeded` | null | null | either |
| **B** | adapter-derived | `failed_transient` \| `failed_permanent` \| `ambiguous` | **not null** | null | either |
| **C** | pre-dispatch recovery | `failed_transient` | **null** | `lease_expired_pre_dispatch` | **must be unset** |
| **D** | possibly-dispatched expiry | `ambiguous` | **null** | `lease_expired_uncertain` | **must be set** |

**C and D cross-check the boundary**, which is what makes a reason code an
assertion the database verifies rather than a label the writer chooses. Without
it the safe-recovery argument would rest on the recovery function being
bug-free.

### 5.1 Constraints added, all named

| Constraint | Rule |
| --- | --- |
| `integration_attempt_settlement_explained` | **replaces** Migration 52's rule: a category **or** a lifecycle reason, never neither |
| `integration_attempt_open_carries_no_evidence` | an open attempt carries neither |
| `integration_attempt_success_carries_no_reason` | a success carries no reason |
| `integration_attempt_lifecycle_reason_excludes_category` | the **current implemented subset** — see §6 |
| `integration_attempt_permanent_requires_category` | no lifecycle origin produces a permanent failure |
| `integration_attempt_pre_dispatch_reason_shape` | shape C, including the unset-boundary cross-check |
| `integration_attempt_uncertain_reason_shape` | shape D, including the set-boundary cross-check |
| `integration_attempt_reason_code_vocabulary` | the closed two-value domain |
| `integration_attempt_transient_category_shape` | `failed_transient` with a category admits only the two transient ones |
| `integration_attempt_timeout_is_ambiguous` | `destination_timeout` settles only as `ambiguous` |
| `integration_attempt_lease_after_start` | a lease falls after the attempt started |
| `integration_attempt_dispatch_not_before_start` | the boundary is not before the attempt started |

The replaced constraint was **unnamed** in Migration 52, so it is located by
`pg_get_constraintdef` matching rather than by a generated name, resolved
through `'integration_delivery_attempt'::regclass`, and the lookup **fails
closed** unless exactly one candidate matches.

### 5.2 Two constraints beyond the enumerated minimum — flagged

`integration_attempt_transient_category_shape` and
`integration_attempt_timeout_is_ambiguous` were **not** in the authorization's
§7 list. They move Migration 53's existing function-level classification into
the table.

**Rationale:** §7 requires that "the row itself must be unable to assert false
evidence" and that the contract not "rely only on a future recovery function
being correct." Today a privileged direct write can store `failed_transient`
with `authentication_failed`, or a timeout as a permanent failure — shapes
F062.1 and Migration 53 both declare impossible. §16's own carve-out permits
invalidating a previously-legal shape where "the earlier row represented
evidence that the newly authoritative contract now explicitly declares
impossible," which is exactly this case.

**No existing row is affected** (the table is empty in every real environment,
and the compatibility test proves pre-migration rows survive), and Migration 53
already refuses both combinations, so nothing legal becomes illegal in
practice. **If a reviewer prefers the strict minimum, these two constraints are
the ones to drop.**

### 5.3 Impossible evidence is unwritable

Twelve combinations are proven refused by PostgreSQL, not merely avoided:
`succeeded` with a category; `succeeded` with a reason; an open attempt with
either; `failed_permanent` with no category; an adapter failure carrying a
lifecycle reason; each lifecycle reason with a category, with the wrong
outcome, and with the wrong boundary state; `failed_transient` with a
non-transient category; a timeout settled as anything but `ambiguous`; and any
unknown or free-text reason.

---

## 6. Namespace behaviour, and what is deliberately not asserted

For this slice the only persisted reason codes are lifecycle reasons, so
`integration_attempt_lifecycle_reason_excludes_category` requires
`failure_category IS NULL` wherever `reason_code` is present.

> **This is the current implemented subset, NOT a permanent architectural
> assertion.** F062.2A §8.1's broader design permits a destination-derived
> reason *refining* a destination category, and when a producer for those
> values exists **this is the constraint a reviewed migration widens.** The
> migration says so at the constraint itself, so the next author finds the note
> where the decision lives rather than only in a document.

---

## 7. Dispatch-boundary integrity

### 7.1 Database-authored

A caller signals the transition by setting `dispatch_started_at` to any
non-null value; **the guard discards it and stores `clock_timestamp()`.** This
is the same authorship pattern F062.2D-2A already uses for `started_at` and
`completed_at`, so it is persistence integrity rather than a new API, and **no
caller-controlled timestamp API exists.**

Proven by forging a 1999 signal and asserting the durable value lies between
two database clock readings taken around the write — deterministic, no sleep.

### 7.2 Write-once

| Rule | Enforced by |
| --- | --- |
| cannot be set at insert | guard: *"must be created before its dispatch boundary"* |
| `NULL → non-NULL` only | guard: *"write-once and cannot be changed or cleared"* |
| cannot be changed | same |
| cannot be cleared | same |
| cannot be backdated or replaced | the value is database-authored, so a later caller's value is discarded and a second transition is refused outright |
| cannot be set after settlement | guard: *"A settled integration delivery attempt is immutable"*, which runs first |
| **cannot be introduced by a settlement** | guard: *"must be recorded before settlement"* |

That last rule is load-bearing and is not in the authorization's list: **it is
what stops a recovery from manufacturing the boundary state its own reason code
requires.** Without it, a single statement could set the marker and settle as
`lease_expired_uncertain` in one go, forging shape D.

### 7.3 What it means

> **Non-null means "external transmission may have occurred." It does NOT mean
> the destination received or processed the request.**

Null means no transmission may yet have occurred **under the reviewed
protocol** — which is a worker obligation the database cannot verify
(F062.2D-2C-0A §13.4). F062.2D-3 must state it as a contract and F062.2D-4
must prove the ordering by test.

### 7.4 Not mandatory for adapter settlements yet

An ordinary adapter settlement may leave the boundary null, deliberately:
requiring it would break Migration 53's completion function before
F062.2D-2C-3 exists. It **is** enforced where lifecycle semantics depend on it
— shapes C and D — which is where it carries meaning. **F062.2D-2C-3 makes the
marker mandatory for the real worker transmission protocol.**

---

## 8. Lease-field semantics

| Property | Value |
| --- | --- |
| Meaning | which claim currently owns the right to attempt this obligation |
| Authority | database |
| Mutability | **immutable** — guard: *"claim lease is immutable and cannot be extended"* |
| Extension | impossible; there is no renewal in this contract |
| Introduction after claim | **also impossible** — an attempt that had no lease cannot acquire one, so a lease cannot be retrofitted |
| Bound | must fall after `started_at` |
| Duration | **not encoded anywhere** |

### 8.1 It is not completion fencing

> **Expiry authorizes recovery; successful ownership rollover fences stale
> completion.**

`claim_expires_at` appears in **no** `CHECK` and **no** guard branch governing
settlement. A legitimate current claimant may settle after the lease timestamp
when no recovery has won — proven by a test that constructs an attempt started
an hour ago with a lease expired half an hour ago, then settles it normally and
asserts `completed_at > claim_expires_at`.

Rejecting a late-but-genuine completion would discard the truest evidence in
the system and manufacture ambiguity from a healthy delivery.

### 8.2 Nothing reacts to time

A test asserts that an attempt with an expired lease and a crossed boundary
stays open, keeps a null `reason_code`, and leaves its obligation `pending`.
**No timer, no trigger and no constraint reacts to elapsed time.**

---

## 9. Recovery-scan index

```sql
create index integration_attempt_lease_expiry
  on integration_delivery_attempt (organization_id, claim_expires_at)
  where completed_at is null and claim_expires_at is not null;
```

**The exact future query it supports** — F062.2D-2C-3's expired-claim scan:

```sql
select ... from integration_delivery_attempt
 where organization_id = $1
   and completed_at is null
   and claim_expires_at < clock_timestamp()
 order by claim_expires_at
 limit $2 for update skip locked;
```

`organization_id` leads, matching every other index on these tables and the
Organization-qualified shape of every reviewed function. Deployment per tenant
keeps the leading cardinality low, so a platform-wide sweep remains serviceable
from the same index. The partial predicate restricts it to rows a recovery scan
could ever return.

**Exactly one index is added.** No second speculative polling index, and **no
polling loop exists.** Not unique: an Organization may legitimately hold many
expiring claims.

---

## 10. Guard extension

The F062.2D-2A guard is **extended, not replaced.** Every existing protection
is preserved verbatim and asserted by both a source test and a live
`pg_get_functiondef` test:

complete-once settlement; immutable `claim_generation`, `claim_token_digest`,
`attempt_number`, tenant and obligation identity, `started_at`,
`connector_configuration_revision` and `capability_snapshot`; `DELETE` and
`TRUNCATE` refusal; settled-row immutability; the obligation-ownership,
connector-naming and pinned-revision checks; and database-assigned ordinals.

Added:

- `claim_expires_at` immutability;
- `dispatch_started_at` `NULL → non-NULL` only, database-authored;
- no boundary after settlement, and none introduced by a settlement;
- `reason_code` refused at insert, so it only ever arrives as settlement evidence;
- `reason_code` immutable once settled, which follows from settled-row immutability.

**No existing protection was relaxed to make the new columns work.** The
identity test is factored into a local boolean so the original **order** of
refusals is unchanged for settlements — existing error messages and their
precedence are preserved exactly.

### 10.1 A second legal update kind

Before this slice the only legal `UPDATE` was open → settled. There are now
**two**: recording the boundary on an open attempt, and settling. The boundary
update is tightly bounded — it may change nothing but the marker, carries no
settlement evidence, and cannot touch identity.

---

## 11. Rollback behaviour

**Fail-closed, with no cleanup path inside the migration.**

```
if any row has claim_expires_at, dispatch_started_at or reason_code
  -> raise 'Retained integration lease, dispatch-boundary or recovery-reason
            evidence prevents rollback'
```

The migration **never** nulls, deletes or truncates evidence to succeed —
asserted by a source test that scans the rollback body for `delete from`,
`truncate table`, `drop table` and each `set <column> = null`. F062.1
`mayEraseEvidence()` returns `false`, and a migration is not the place to make
an exception.

Where the three columns are empty, rollback restores the previous state
exactly: drops the index, restores the F062.2D-2A guard verbatim, drops this
migration's twelve named constraints explicitly rather than relying on
column-drop cascade, drops the three columns, and re-adds Migration 52's
settlement rule **unnamed exactly as it was**. Then reapply works.

Proven end to end: apply → use the new schema → **rollback refused with
evidence present, and the evidence verified intact afterwards** → privileged
test cleanup → rollback → reapply. The cleanup disables the guard trigger
inside the test, which is the established idiom in this repository and stands
in for the reviewed safe-loss rule the migration deliberately does not contain.

A second test proves rollback and reapply are clean where no new evidence was
ever written, and that the pre-existing settled row survives both.

---

## 12. TypeScript authority and parity

`server/src/integration/delivery-contract.ts` gains:

| Export | Purpose |
| --- | --- |
| `integrationAttemptReasonCodes` | the closed two-value array, the single source of truth |
| `IntegrationAttemptReasonCode` | the derived type |
| `isIntegrationAttemptReasonCode` | the narrowing guard |
| `AttemptSettlementEvidence` | one settlement's evidence, with the boundary as a boolean |
| `isAuthorizedAttemptSettlement` | the TypeScript twin of the SQL matrix — pure and side-effect free |

Naming follows the module's existing convention (`attemptOutcomes` /
`AttemptOutcome`, `integrationFailureCategories` /
`IntegrationFailureCategory`). **No F061 observability class is imported.** The
dependency direction remains F062 semantics → a future mapping → F061
observability, never the reverse.

The module previously had no imports; it now takes `transientIntegrationFailures`
and the `IntegrationFailureCategory` type from `integration-envelope.ts`, which
imports nothing, so **no cycle is possible in either direction.**

### 12.1 Parity proven on both sides

| Side | Proof |
| --- | --- |
| **Source** | The migration's vocabulary constraint is parsed and asserted **set-equal in both directions** with the TypeScript constant |
| **Live database** | `pg_get_constraintdef` is parsed and asserted set-equal with the same constant |
| **Matrix** | The predicate is enumerated exhaustively over all 330 combinations (5 outcomes × 11 categories × 3 reasons × 2 boundary states) and authorizes **exactly 48** — 2 open + 2 success + 1 shape C + 1 shape D + 42 adapter-derived |
| **Named constraints** | All twelve are asserted present in `up()` and dropped in `down()` |
| **No collision** | No reason code appears in the destination taxonomy |

The 48 is a derived property rather than an observation: adapter-derived is 21
outcome/category pairs — 2 transient, 9 permanent, 10 ambiguous — each valid
with the boundary either set or unset.

---

## 13. Existing-row compatibility

**The migration does not assume the table is empty.** Existing rows receive
`claim_expires_at = NULL`, `dispatch_started_at = NULL`, `reason_code = NULL`,
with no fabricated history — all three columns are nullable with no default.

Proven directly: a fixture applies Migrations 1, 50, 51 and 52 **only**,
settles two attempts in the pre-migration shapes (a success and an
adapter-derived permanent failure), **then applies Migration 54 over that
evidence**, and asserts both rows survive unchanged with all three new columns
null. A forced `VALIDATE CONSTRAINT` then confirms the new rule genuinely
validates the old rows rather than being accepted unchecked.

**No previously legal attempt row becomes invalid**, with the single flagged
exception of the two shapes in §5.2 that the authoritative contract explicitly
declares impossible and that Migration 53 already refuses.

---

## 14. Deferred work

### 14.1 Worker functions — none implemented

| Function | Status |
| --- | --- |
| `claim_integration_intent` | **byte-unchanged**; does not populate `claim_expires_at` |
| `complete_integration_attempt` | **byte-unchanged**; writes no `reason_code` |
| `mark_integration_dispatch_started` | **not implemented** — F062.2D-2C-3 |
| `recover_expired_integration_claim` | **not implemented** — F062.2D-2C-3 |

**Migration 53 is byte-unchanged**, verified by `git status`. The preferred
outcome of the authorization's §24 was achieved: no existing function needed
modification, because the new constraints permit exactly the shapes those
functions already write.

This is proven rather than asserted — the worker-function suite now applies
Migration 54 in ordinal order and **all 22 of its tests pass against the new
constraints and the extended guard.**

### 14.2 Retry and ordering — none implemented

`next_attempt_at`, destination backoff, recovery delay, retry exponent and the
attempt ceiling all belong to F062.2D-2C-2 and 2C-3. Ordered delivery —
`requires_ordered_delivery`, the ordered-key constraint and the partial unique
serialization index — belongs to F062.2D-2C-2.

**Pre-dispatch recovery is representable after this slice, but not executable.**
Nothing can produce either reason code, because no function writes one.

---

## 15. Privilege posture

**No new role, membership, grant, worker identity, `EXECUTE` grant or table
privilege.** The migration's executable SQL contains zero occurrences of
`grant`, `revoke`, `create role`, `alter role`, `security definer` or
`reqro_integration_worker`, asserted by a source test.

**New columns inherit the table ACL.** No column-level grant was issued, and
none should be: a column grant would create a surface that diverges from the
table's.

Verified on PostgreSQL 17 with all 54 migrations applied, in the
role-separation suite:

| Principal | Result |
| --- | --- |
| `reqro_runtime` | table privilege surface **exactly the canonical matrix**, and the function `EXECUTE` surface **exactly eleven direct grants** — both unchanged |
| `reqro_operator` | boundary unchanged; the two roles remain mutually isolated |
| `reqro_integration_function_owner` | holds **exactly its reviewed ceiling**; owns one namespace and zero relations |
| `PUBLIC` | gains nothing; cannot reach the function API |
| Default privileges | **empty**, unchanged |

---

## 16. Validation

| Check | Result |
| --- | --- |
| `integration-lease-recovery-evidence.integration.test.ts` (new) | **25/25**, 0 skipped |
| `lease-recovery-contract.test.ts` (new) | **12/12**, 0 skipped |
| `integration-worker-functions.integration.test.ts` **with Migration 54 applied** | **22/22** |
| `integration-delivery-attempt` / `integration-outbox` / `integration-connector` | 18/18, 14/14, 18/18 — **50/50** |
| `database-role-separation` on PostgreSQL 17 in Docker, all 54 migrations | **20/20** |
| F062.1 contracts / boundary | 29/29, 10/10 |
| `connector-metadata` / `outbox-contract` / `delivery-transition-contract` | 23/23, 22/22, 17/17 |
| Migration apply → rollback refusal → rollback → reapply | verified both with and without evidence |
| Typecheck | clean |

Full counts, the broad-suite result and any environment-gated suites are
reported in the slice's completion report rather than restated here.

---

## 17. Remaining blockers

**Unchanged from F062.2D-2C-0A §18, and none is resolved by this slice:**

1. **Claim lease and expired-claim recovery semantics** — representable now, not executable. Needs F062.2D-2C-3.
2. **Per-aggregate serialization for ordered delivery** — needs F062.2D-2C-2.
3. **Retry and backoff eligibility for `retrying` obligations** — needs F062.2D-2C-2 and 2C-3.

Plus, carried forward: the pre-dispatch recovery bound and the platform
recovery delay remain unresolved platform policy; destination semantics, the
secret-manager decision and the first destination's API documentation still
block any real dispatch; **automatic dead-lettering must not ship before
F062.2A's authorized `dead_lettered → pending` replay evidence exists**; and
the two mandatory observability gates — active/in-flight claim count and
expired lease count — remain F061.3C work.

> **F062.2D-3 remains blocked.** It requires F062.2D-2C-1, 2C-2 and 2C-3 all
> accepted, **and** the two observability gates.

---

## Related

- [F062.2D-2C-0A — Worker execution contract amendment](F062-2D-2C-0A-worker-execution-contract-amendment.md) — the contract this implements
- [F062.2D-2C-0 — Worker execution semantics decision](F062-2D-2C-0-worker-execution-semantics-decision.md) — the design behind it
- [F062.2D-2B — Worker claim and completion database function API](F062-2D-2B-worker-database-function-api.md) — the two functions proven unchanged under this schema
- [F062.2D-2A — Delivery attempt and fencing persistence](F062-2D-2A-delivery-attempt-fencing-persistence.md) — the table and guard extended here
- [F062.2D-1A — Pending age, expiry and dead-letter policy](F062-2D-1A-pending-age-dead-letter-policy.md) — the age clock this slice does not touch
- [F062.2A — Transactional outbox persistence readiness](F062-2A-transactional-outbox-persistence-readiness.md) — the `reason_code` taxonomy and its deferral condition
- [F062.1 — Enterprise integration contracts foundation](F062-1-integration-contracts-foundation.md) — the outcome and category vocabularies, reaffirmed
- [ADR-024 — Transaction-time request authorization](../architecture/decisions/ADR-024-transaction-time-request-authorization.md) — the uncertain-result rule the ambiguous shape rests on
- [ADR-027 — Platform operator bootstrap and recovery](../architecture/decisions/ADR-027-platform-operator-bootstrap-recovery.md) — the role topology whose surface is proven unchanged
