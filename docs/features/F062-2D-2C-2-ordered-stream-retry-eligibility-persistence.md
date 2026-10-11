# F062.2D-2C-2 — Ordered-stream and retry-eligibility persistence

> **NO STRICT-FIFO CLAIM PREDICATE EXISTS YET.**
>
> **NO RETRY SCHEDULER EXISTS.**
>
> **NO BACKOFF IS CALCULATED.**
>
> **NO WORKER RUNS.**
>
> **NO EXTERNAL DESTINATION IS CONTACTED.**
>
> **F062.2D-3 REMAINS BLOCKED.**

This slice is persistence and integrity only. There is no polling loop, no
scheduler, no timer, no backoff computation, no jitter, no retry loop, no
transport, no HTTP client, no adapter, no secret-manager access, no destination
credential, no `reqro_integration_worker` role, no `EXECUTE` grant, no
dead-letter replay, no state-sync coalescing and no F061 instrumentation. No
NestJS application file is touched.

**No ADR number is allocated.** This implements the already-accepted
F062.2D-2C-0A contract.

Starting point: `origin/main` at `14ea8cb4d4e864c67358f076b30a780e94829ba8`,
which carries F062.2D-2C-1 (`8e1f585`) as a verified ancestor, merged as PR #31.

---

## 1. Authoritative contract source

| Source | What it governs here |
| --- | --- |
| **[F062.2D-2C-0A](F062-2D-2C-0A-worker-execution-contract-amendment.md)** | §15 the two-control ordering model, §16 the ordered-key invariant and its compatibility impact, §17 `accepted` as non-blocking, §18 retry eligibility, §21 policy pinning, §24.2 this slice's scope |
| [F062.2D-2C-0](F062-2D-2C-0-worker-execution-semantics-decision.md) | Option E, and why advisory locks and a coordination table were rejected |
| [F062.2D-2C-1](F062-2D-2C-1-lease-dispatch-recovery-reason-persistence.md) | The attempt-side evidence this complements |
| [F062.1](F062-1-integration-contracts-foundation.md) | The nine states and the transition graph, reaffirmed and unchanged |
| [F062.2B](F062-2B-connector-metadata-persistence-foundation.md) | `supports_ordering` and the audit snapshot the derivation reads |
| [F062.2C](F062-2C-transactional-outbox-atomic-enqueue.md) | The enqueue guard extended here |

### 1.1 Baseline read from source

| Item | Value |
| --- | --- |
| Migrations before | **54**, highest ordinal `20261024000000` |
| Compiled before | **51** |
| Ordering vocabulary | `orderingGuarantees = ['none', 'per_aggregate']`, `connector-capabilities.ts:53` |
| Where it is pinned | `integration_connector_audit.supports_ordering varchar(14) not null check (… in ('none','per_aggregate'))` — the audit snapshots the **full** capability set per revision, so every pinned revision already carries its ordering contract |
| Aggregate identity | `organization_id`, `integration_connector_id`, `aggregate_type`, `aggregate_id` all **already `NOT NULL`**; `aggregate_revision integer check (> 0)` **nullable**, forced non-null only for `contract_kind = 'event'` |
| `retrying` behaviour | reachable from `dispatching`; exits to `dispatching` or `dead_lettered`. **No eligibility timestamp existed** |
| Claimable states | **`pending` only** — Migration 53's claim selects `state = 'pending'` with no open attempt |
| Outbox guard | deletion refused; identity and semantics immutable; a no-op update refused; the reviewed transition whitelist; two capability-gated edges read from the **pinned** snapshot |

**`reqro_runtime` holds no privilege at all on the integration tables** — it
appears nowhere in `runtime-role.sql` and nowhere in the role-separation
suite's runtime matrix. That is what makes §4 below safe without any privilege
question arising: the runtime cannot write `integration_outbox` at all.

---

## 2. Migration

**Migration 55 — `server/migrations/20261025000000-add-integration-ordering-retry-eligibility.ts`.**

Ordinal derived from source. Hardcodes no schema name, so it is imported and
compiled like Migrations 52 and 54: compiled migrations rise 51 → **52**, and
the inventory 54 → **55**. Independently applyable, rollbackable and
reapplyable, proven by two cycles.

---

## 3. Final schema

Two columns on `integration_outbox`:

| Column | Type | Null | Default | Authority |
| --- | --- | --- | --- | --- |
| `requires_ordered_delivery` | `boolean` | **NO** | **none** | **database**, derived from the pinned audit snapshot |
| `next_attempt_at` | `timestamptz` | yes | **none** | database, at a transition only |

`NOT NULL` **with no default** is deliberate: the value can only come from the
guard's snapshot derivation, never from a column default that would bypass it.
A `BEFORE INSERT` guard populates it before constraint evaluation, which is the
same pattern F062.2D-2A already uses for `attempt_number`.

Two named constraints:

| Constraint | Rule |
| --- | --- |
| `integration_outbox_ordered_requires_revision` | `requires_ordered_delivery = false or aggregate_revision is not null` |
| `integration_outbox_retry_schedule_only_when_retrying` | `next_attempt_at is null or state = 'retrying'` |

No `attempt_count`, `retry_count` or `recovery_count`: `attempt_number` remains
the evidence ordinal and the destination retry budget is derived later from
boundary-crossing destination evidence (F062.2D-2C-0A §18.2). **No
schedule-source column** — the settling attempt's `reason_code` already
distinguishes a platform recovery delay from destination backoff.

---

## 4. Ordering derivation

> **The ordering contract belongs to the connector revision the obligation
> pinned, never to the connector's current row.**

The guard reads the pinned `integration_connector_audit` row — **the same row
F062.2C already required to exist**, now `select … into` rather than
`not exists` — and derives:

```
supports_ordering = 'per_aggregate'  ->  requires_ordered_delivery = true
supports_ordering = 'none'           ->  requires_ordered_delivery = false
```

| Caller supplies | Result |
| --- | --- |
| nothing | the database assigns the authoritative value |
| a value matching the snapshot | accepted |
| a value **contradicting** the snapshot | **refused, fail-closed** |

Refusal rather than silent correction, because that is the convention F062.2C
already established for a caller-supplied delivery state: *"a caller that
supplied one has a bug, and quietly storing the right value instead would hide
it."* Both forgery directions are refused — a caller cannot claim `false`
against a `per_aggregate` contract (which would silently drop an ordering
promise) nor `true` against `none`.

**No application code decides whether work is ordered.** The enqueue callers
omit the column entirely and needed no change; only the handwritten database
types were updated. `requires_ordered_delivery` is exposed in no API input.

### 4.1 No connector-current-state authority

Proven in both directions:

- an obligation pinned at revision 1 with `per_aggregate` **stays ordered** after the connector moves to revision 2 with `none`, and a new obligation pinned at revision 2 is **unordered**;
- an obligation pinned at revision 1 with `none` **stays unordered** after the connector moves to `per_aggregate`, and a new obligation at revision 2 is **ordered**.

So an administrator cannot retroactively unblock obligations enqueued under an
ordering promise, nor retroactively block work enqueued without one.

### 4.2 Immutable after insert

The guard refuses any change to `requires_ordered_delivery`, with its own
message, so pinned ordering evidence cannot be rewritten even as part of an
otherwise-legal state transition.

---

## 5. Existing-row backfill

Derived per row from **its own** pinned snapshot:

```sql
update integration_outbox o
   set requires_ordered_delivery = (a.supports_ordering = 'per_aggregate')
  from integration_connector_audit a
 where a.organization_id = o.organization_id
   and a.integration_connector_id = o.integration_connector_id
   and a.configuration_revision = o.pinned_connector_configuration_revision
   and a.revision_advanced;
```

**Never from `integration_connector`**, whose row carries the connector's
current capabilities.

### 5.1 One implementation note worth recording

The row guard refuses any `UPDATE` that does not move the delivery state —
correct for an application caller, wrong for a migration backfilling a derived
column. The guard is therefore **suspended for exactly that one statement and
restored on the next line**. A failure anywhere in the migration rolls the
suspension back with everything else, because the whole migration body is one
implicit transaction. This was found by test rather than by reading: the first
backfill run failed with *"Integration intent update changes nothing."*

### 5.2 Five fail-closed gates, before anything is tightened

The migration refuses rather than guessing, and **never defaults an unknown row
to `false`**:

1. **No advancing pinned snapshot** — the row's ordering semantics are not derivable.
2. **More than one advancing snapshot** for one pinned revision — the derivation would be non-deterministic.
3. **An uninterpretable ordering capability** — asserted rather than assumed, even though the audit `CHECK` should make it unreachable.
4. **An ordered row with no `aggregate_revision`** — §6.
5. **A pre-existing stream conflict** — §7.3.

Each raises with a count, so an operator sees the scale of the problem.

---

## 6. Ordered-revision compatibility impact

> **`requires_ordered_delivery = true` implies `aggregate_revision IS NOT NULL`**,
> enforced both by the guard at insert and by a table constraint.

`aggregate_revision` leads the reviewed sequence key, so an ordered obligation
without one cannot be placed in its stream. **`created_at` is deliberately not
substituted**: it is enqueue time, not the aggregate's causal sequence, so two
mutations enqueued out of causal order would be delivered out of causal order
while appearing correctly ordered.

> ### This is a NEW ENQUEUE REQUIREMENT on an accepted path
>
> A `state_sync` intent destined for a connector declaring
> `supports_ordering = 'per_aggregate'` must now carry an `aggregate_revision`,
> or its enqueue is refused. Immutable events already required one.

The correct fail-closed direction — a caller asking for ordered delivery must
supply the field that defines the order — but it changes accepted behaviour and
is **not hidden**. An unordered `state_sync` intent with a null revision
remains legal, so the pre-existing contract is otherwise intact. Both halves
are tested. The migration also **fails closed** rather than rewriting an
existing ordered row that lacks a revision.

---

## 7. The ordered-stream index

```sql
create unique index integration_outbox_ordered_stream_in_flight
  on integration_outbox
    (organization_id, integration_connector_id, aggregate_type, aggregate_id)
  where requires_ordered_delivery and state in ('dispatching', 'ambiguous');
```

### 7.1 MUTUAL EXCLUSION ONLY

> **This index guarantees at most one blocking obligation per ordered aggregate
> stream. It does NOT guarantee FIFO, and nothing here claims it does.**

It is **atomic by construction**: a second `UPDATE … SET state='dispatching'`
blocks on the first's uncommitted index entry and then fails. There is no
check-then-act window because there is no check. Proven by a deterministic
two-connection test with **no sleeps** — the contender is started inside a held
transaction and awaited after the commit.

Tenant safety is structural: `organization_id` leads, so no stream spans
Organizations, and the connector is included so a fan-out to two destinations
cannot let one block the other.

### 7.2 What is deliberately outside the predicate

| State | In the index? | Why |
| --- | --- | --- |
| `dispatching` | **yes** | an in-flight dispatch holds the slot |
| `ambiguous` | **yes** | an unresolved ambiguity holds it too, which is what implements poison isolation |
| `pending`, `retrying` | **no** | the index constrains **concurrency**, never queue depth, so F062.1 `mayEnqueue` stays intact and an outage builds a backlog |
| `accepted` | **no** | F062.2D-2C-0A §17: a connector without `reports_terminal_state` can never reach `acknowledged`, so requiring it would block that stream forever |

Isolation proven: the same aggregate under a second connector, a different
aggregate on the same connector, and two blocking unordered obligations for one
aggregate all coexist. **No global serialization point exists.**

### 7.3 Pre-existing conflicts surface rather than resolve

Before the index is built the migration refuses if any ordered stream already
holds more than one blocking obligation. **No winner is selected, no state
rewritten, no row marked unordered and nothing deleted** — asserted by a test
that confirms both rows remain `dispatching` after the refusal.

### 7.4 Only one index

No retry polling index was added. F062.2D-2C-3 will know the exact retry claim
query; adding one now would be premature. A test asserts that no index
mentions `next_attempt_at`.

---

## 8. Strict FIFO is explicitly deferred

> **The predecessor predicate is NOT implemented here, and Migration 53's claim
> function is byte-unchanged.**

The future rule, recorded so it is not rediscovered:

> A candidate B for ordered stream X is claimable only when **no earlier
> unresolved obligation A exists for X**, where "unresolved" means any
> non-terminal state — deliberately **not** "currently eligible" — ordered by
> the sequence key `(aggregate_revision, created_at, id)`.

`ORDER BY` alone cannot provide this: an earlier sibling that is `retrying`
with a future `next_attempt_at` is filtered out of the candidate set before the
sort, so a newer sibling would be claimed first with no concurrency involved
and no constraint violated.

**F062.2D-2C-3 owns the predicate and its own concurrency tests**, because it
is function-enforced and the index cannot catch a bug in it.

---

## 9. Retry persistence model

Nothing computes `next_attempt_at`. The completion function is byte-unchanged
and writes no schedule.

| State | Schedule | Meaning |
| --- | --- | --- |
| `pending` | must be NULL | ordinary pending work |
| `retrying` + NULL | legal, **and the only shape anything produces today** | a retry exists semantically but no schedule has been established, therefore **not retry-eligible** — the fail-closed reading |
| `retrying` + future | legal | scheduled, not yet due |
| `retrying` + past | legal | conceptually retry-eligible for F062.2D-2C-3 |
| every other state | must be NULL | refused by guard and constraint |

### 9.1 The mutation boundary

**No caller-controlled runtime setter was created, and no privilege question
arose.** `reqro_runtime` holds no privilege on `integration_outbox` at all
(§1.1), so the only principals that can write it are the migration authority
and `reqro_integration_function_owner` through its `SECURITY DEFINER`
functions. **No STOP condition under the authorization's §3.**

The transitional rule is deliberately conservative and falls out of an existing
protection: **the only legal outbox `UPDATE` is a state transition**, because
the guard refuses an update that changes nothing. Therefore

> a schedule can be written **only at the moment of a transition**, and can
> never be rewritten while the obligation stays `retrying`.

A schedule is refused at enqueue outright, and an obligation leaving `retrying`
must clear it in the same transition.

**What F062.2D-2C-3 must change: nothing structural.** Each retry cycle passes
through `retrying → dispatching → retrying`, so every transition into
`retrying` establishes a fresh schedule and no in-place rewrite is ever needed.
2C-3's completion and recovery functions simply populate the column at that
moment. One consequence to carry forward: a `retrying` obligation holding a
schedule cannot transition to `dispatching` unless the same statement clears
it, so 2C-3's claim enhancement must clear it when claiming a retrying row.

### 9.2 No policy is encoded

No delay, exponent, jitter, ceiling or horizon. A test asserts that no
constraint on the table mentions `interval`, `backoff` or `jitter`. Database
time only: every comparison in the tests is against `clock_timestamp()`, and no
worker or caller clock has authority over anything.

### 9.3 No timer

A schedule constructed as already due changes nothing on its own: the state
stays `retrying` and no attempt appears. Nothing in this slice reacts to
elapsed time.

### 9.4 Retry budget is untouched

`lease_expired_pre_dispatch` may eventually receive a **platform recovery
delay** and does **not** advance the destination retry exponent;
`destination_unavailable` and `rate_limited` drive destination retry policy.
Both may eventually use `next_attempt_at`, and the settling attempt's
`reason_code` distinguishes the schedule source. **No schedule-source column
was added, and no budget semantics are encoded here.**

---

## 10. Guard extension

**Extended, not replaced.** Every F062.2C and F062.2D-2A protection is
preserved verbatim and asserted by test: deletion refused; identity and
semantics immutable across eighteen fields; a no-op update refused; the
reviewed transition whitelist; both capability-gated edges read from the pinned
snapshot; the caller cannot choose a delivery state; a stale pinned revision is
refused; the connector must be owned by the Organization and must not be
retired.

Added:

- the ordering derivation at insert, with fail-closed refusal of a contradictory supplied value;
- `requires_ordered_delivery` immutability;
- the ordered-revision requirement at insert;
- a schedule refused at insert;
- a schedule permitted only while `retrying`, cleared by the transition that leaves it.

**Nothing was weakened**, and the existing refusal messages and their
precedence are unchanged.

---

## 11. Current claim-function limitation

**Migration 53's functions are byte-unchanged**, and the worker-function suite
now applies Migration 55 in ordinal order with **all 22 tests passing**.

But the claim function still:

- selects `state = 'pending'` only, so a `retrying` obligation with a due schedule is **not claimable**;
- applies **no predecessor predicate**, so within an ordered stream a newer obligation could be claimed before an older unresolved one;
- sets no lease and records no dispatch boundary.

The transitional `retrying + NULL` shape produced by the current completion
function is therefore **deliberate and inert** until F062.2D-2C-3.

> **F062.2D-3 remains blocked**, no worker holds `EXECUTE`, and the callable
> function foundation remains non-production.

---

## 12. Rollback semantics

The two columns differ in kind and are judged separately.

| Column | Rule |
| --- | --- |
| **`next_attempt_at`** | **durable scheduling evidence.** Rollback **refuses** if any row carries one. Schedules are never nulled to make rollback succeed |
| **`requires_ordered_delivery`** | **denormalised pinned evidence**, reconstructable from the immutable audit. Rollback may drop it **only** while every row still matches its pinned snapshot exactly, and only while every row has a reachable snapshot to re-derive from |

Rollback drops the index, restores the F062.2D-2A guard verbatim, drops the two
constraints and the two columns, and **preserves every outbox, attempt,
connector and audit row.** Reapply reproduces the derived ordering identically.

Proven end to end: apply → verify backfill → introduce a durable schedule →
**rollback refused, evidence verified intact** → clear the schedule through a
legal transition → rollback → reapply → derived ordering identical.

---

## 13. Existing-row compatibility

Proven by a fixture that applies Migrations 1, 50, 51, 52 and 54 **only**,
enqueues under both ordering contracts, advances the ordered connector so its
current row **disagrees** with what the older obligation pinned, and only then
applies Migration 55:

- both obligations preserved;
- each `requires_ordered_delivery` derived from its **own pinned revision**, not the current connector row;
- no `aggregate_revision` fabricated;
- no state rewritten;
- no `next_attempt_at` fabricated.

---

## 14. Privilege posture

**No role, membership, grant, worker identity, `EXECUTE` permission, table
privilege or column privilege.** The migration's executable SQL contains none
of the scanned privilege, network, vendor, secret or scheduling tokens.

Verified on PostgreSQL 17 with all 55 migrations: `reqro_runtime`'s table
surface is **exactly the canonical matrix** and its function surface **exactly
eleven direct grants**, both unchanged; `reqro_operator` unchanged;
`reqro_integration_function_owner` holds exactly its reviewed ceiling; PUBLIC
gains nothing; default privileges unchanged. New columns inherit the table ACL
— no column grant was issued. **No F061 change.**

---

## 15. F062.2D-2C-3 requirements

What the next slice must do, with this slice's groundwork in place:

1. **The strict-FIFO predecessor predicate** (§8) in the claim function, with its own concurrency tests — the index will not catch a bug in it.
2. **Claim `retrying` obligations** where `next_attempt_at` is non-null and due, evaluated on database time, **clearing the schedule in the same transition**.
3. **Author schedules** in the completion and recovery functions, at the moment of transition into `retrying`, from pinned policy — destination backoff for `destination_unavailable`/`rate_limited`, a platform recovery delay for `lease_expired_pre_dispatch`.
4. **Order ordered candidates by `aggregate_revision` first**; Migration 53 currently orders by `created_at, id`, which is correct for an unordered connector and insufficient for an ordered one.
5. **Populate `claim_expires_at`** and add `mark_integration_dispatch_started` and `recover_expired_integration_claim` (F062.2D-2C-1 §14).
6. **Tighten `claim_expires_at` to `NOT NULL`** once the claim function computes it.

Still unresolved platform policy, and still not chosen anywhere: lease
duration and floor, retry minimum and maximum delay, attempt ceiling, retry
horizon, the `rate_limited` floor, the pre-dispatch recovery bound, the
platform recovery delay, recovery scan frequency and batch size, and the
pending-age ceiling.

---

## Related

- [F062.2D-2C-0A — Worker execution contract amendment](F062-2D-2C-0A-worker-execution-contract-amendment.md) — the contract this implements
- [F062.2D-2C-0 — Worker execution semantics decision](F062-2D-2C-0-worker-execution-semantics-decision.md) — Option E and the rejected alternatives
- [F062.2D-2C-1 — Lease, dispatch boundary and recovery-reason persistence](F062-2D-2C-1-lease-dispatch-recovery-reason-persistence.md) — the attempt-side evidence
- [F062.2D-2B — Worker claim and completion database function API](F062-2D-2B-worker-database-function-api.md) — the functions proven unchanged under this schema
- [F062.2D-2A — Delivery attempt and fencing persistence](F062-2D-2A-delivery-attempt-fencing-persistence.md) — the outbox guard and transition whitelist extended here
- [F062.2D-1A — Pending age, expiry and dead-letter policy](F062-2D-1A-pending-age-dead-letter-policy.md) — the pending-age clock this slice does not touch
- [F062.2C — Transactional outbox and atomic enqueue](F062-2C-transactional-outbox-atomic-enqueue.md) — the enqueue guard and its caller-authority convention
- [F062.2B — Connector metadata persistence foundation](F062-2B-connector-metadata-persistence-foundation.md) — `supports_ordering` and the per-revision audit snapshot
- [F062.1 — Enterprise integration contracts foundation](F062-1-integration-contracts-foundation.md) — the states and transitions, reaffirmed
- [ADR-027 — Platform operator bootstrap and recovery](../architecture/decisions/ADR-027-platform-operator-bootstrap-recovery.md) — the role topology proven unchanged
