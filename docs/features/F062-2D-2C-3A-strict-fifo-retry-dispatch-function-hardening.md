# F062.2D-2C-3A — Strict FIFO, retry eligibility and dispatch-marker function hardening

> **NO LEASE IS AUTHORED.**
>
> **NO RETRY IS SCHEDULED.**
>
> **NO RECOVERY FUNCTION EXISTS.**
>
> **NO WORKER HOLDS `EXECUTE`.**
>
> **NO WORKER RUNTIME EXISTS.**
>
> **NO EXTERNAL NETWORK I/O EXISTS.**
>
> **F062.2D-3 REMAINS BLOCKED.**

This slice is database-function hardening only. There is no polling loop, no
scheduler, no timer, no lease duration, no backoff computation, no jitter, no
`Retry-After` handling, no recovery execution, no recovery scan, no retry or
recovery exhaustion rule, no execution-policy persistence, no worker identity,
no `EXECUTE` grant, no transport, no HTTP client, no adapter, no secret-manager
access, no destination credential and no F061 runtime telemetry. No NestJS
application file is touched, and no schema object is created, altered or
dropped.

**No ADR number is allocated.** This implements the already-accepted
F062.2D-2C-3-0 decision as amended by F062.2D-2C-3-0A.

Starting point: `origin/main` at `1a7ac702fa7da8f96a0cc75686329a8be8d7dae1`,
which carries the F062.2D-2C-3-0 policy freeze (`2f884c1`) and the
F062.2D-2C-3-0A boundary amendment (`a0ec8b6`) as verified ancestors.

---

## 1. Authoritative contract source

| Source | What it governs here |
| --- | --- |
| **[F062.2D-2C-3-0](F062-2D-2C-3-0-worker-execution-policy-function-signatures.md)** | §4 strict FIFO, §4.0/§4.0a/§4.0b the predecessor boundary and its sequence key, §28.1a the `DROP`/`CREATE` of the claim function, §29.1 the twelve mandatory boundary tests, §30.3 this slice's scope |
| [F062.2D-2C-0A](F062-2D-2C-0A-worker-execution-contract-amendment.md) | §15 the two-control ordering model, §18 retry eligibility |
| [F062.2D-2C-2](F062-2D-2C-2-ordered-stream-retry-eligibility-persistence.md) | `requires_ordered_delivery`, `next_attempt_at`, the ordered-stream index and §11's recorded claim-function limitation, which this slice closes |
| [F062.2D-2C-1](F062-2D-2C-1-lease-dispatch-recovery-reason-persistence.md) | `claim_expires_at` and `dispatch_started_at`, and the guard that authors the latter |
| [F062.2D-2B](F062-2D-2B-worker-database-function-api.md) | Migration 53's function API, its owner, and the closed-by-default privilege posture extended here |
| [F062.1](F062-1-integration-contracts-foundation.md) | The nine delivery states and the transition graph, reaffirmed and unchanged |

### 1.1 Baseline read from source

| Item | Value |
| --- | --- |
| Migrations before / after | **55 / 56**, new ordinal `20261026000000` |
| Compiled migrations before / after | **52 / 52** — Migration 56 hardcodes `public.`, so like Migrations 48, 49 and 53 it is applied as text and no test imports it |
| Claim signature | `claim_integration_intent(target_organization uuid, target_connector uuid, raw_claim_token text)`, returning **20** `TABLE` columns |
| Claimable states before | **`pending` only**, with `order by o.created_at, o.id for update skip locked limit 1` |
| Completion signature | `complete_integration_attempt(uuid, uuid, uuid, bigint, text, varchar(18), varchar(28)) returns boolean` — **byte-unchanged by this slice** |
| Function owner | `reqro_integration_function_owner`, owning only `reqro_integration_api` and no relation |
| Function posture | `SECURITY DEFINER`, `VOLATILE`, `search_path = pg_catalog, public, pg_temp`, PUBLIC `EXECUTE` revoked by full signature |
| Worker principal | `reqro_integration_worker` **does not exist**; no identity holds `EXECUTE` on any function in the api schema |
| Clock convention | `clock_timestamp()` throughout; zero uses of `now()` |

---

## 2. Migration

`server/migrations/20261026000000-harden-integration-worker-claim-dispatch-api.ts`.

It **replaces one function, creates one, and leaves two alone**:

| Function | This slice |
| --- | --- |
| `claim_integration_intent` | **Replaced** — descriptor widened, retry eligibility added, strict FIFO added, schedule cleared on transition |
| `mark_integration_dispatch_started` | **Created** |
| `complete_integration_attempt` | **Byte-unchanged.** Not dropped, not replaced, not re-granted |
| `recover_expired_integration_claim` | **Not created.** It belongs to a later slice |

No table, column, index, constraint, trigger, type or role is touched.
Migrations 53, 54 and 55 are byte-identical to `origin/main`.

### 2.1 Derived from Migration 53 by asserted transformation

The new claim function was **not retyped**. It was produced from Migration 53's
167-line body by four asserted textual replacements, so everything not named
below is preserved byte for byte. The audit is mechanical:

| Property | Evidence |
| --- | --- |
| Migration 53's claim body occurs verbatim in Migration 56 | exactly **once**, and only inside `down()` |
| Difference between the two bodies | **9 lines removed, 94 added** — the four edits and their comments, nothing else |

---

## 3. Why the claim function is dropped and recreated

The descriptor gains a column, and **PostgreSQL cannot widen a `RETURNS TABLE`
with `CREATE OR REPLACE`**: it refuses with *"cannot change return type of
existing function"*. Measured, not assumed. So the exact signature is dropped
and recreated.

Three consequences are handled explicitly.

**No `CASCADE`.** A fail-closed `pg_depend` inspection runs first and raises if
anything at all depends on the function, because a view, default expression or
dependent function would otherwise be silently broken:

```sql
select count(*) into dependents
  from pg_catalog.pg_depend d
 where d.refclassid = 'pg_catalog.pg_proc'::regclass
   and d.refobjid = 'reqro_integration_api.claim_integration_intent(uuid, uuid, text)'::regprocedure;
if dependents > 0 then raise exception …
```

**The ACL is discarded by the `DROP`.** A freshly created function carries
PostgreSQL's default `PUBLIC EXECUTE`, so the `revoke … from public` in this
migration is **not hygiene — it is the control** that keeps the surface closed.
Both revokes are load-bearing.

**Doing it now is deliberate.** A `DROP` also drops every grant. Performing
this replacement after F062.2D-3 had granted the worker `EXECUTE` would
silently revoke that grant. No grant exists yet, so now is the only cheap
moment.

---

## 4. `claim_expires_at` is NULL in this slice

The descriptor gains exactly one column, **appended as the 21st** so the
existing twenty keep their identity, meaning and order:

```text
… , connector_configuration_revision, capability_snapshot, claim_expires_at
```

Nothing authors a lease, so the value is always NULL. It is returned now so the
contract is stable for the slice that does author it, and a transitional NULL
is safe precisely because **no identity holds `EXECUTE`**.

> **A NULL lease must never be read as "expired".** That is the same discipline
> F061.3C requires of any future producer, and it is recorded here because a
> NULL-means-expired reading would invert the fence.

---

## 5. Retry eligibility

```sql
and (o.state = 'pending'
     or (o.state = 'retrying'
         and o.next_attempt_at is not null
         and o.next_attempt_at <= pg_catalog.clock_timestamp()))
```

| Row | Claimable |
| --- | --- |
| `pending` | yes, exactly as before |
| `retrying`, `next_attempt_at is null` | **no** |
| `retrying`, schedule in the future | no |
| `retrying`, schedule due | yes |

A NULL schedule means **nothing scheduled it**, so it is not eligible. That is
the fail-closed reading: an obligation nothing has scheduled must not be picked
up merely because it is in `retrying`.

The comparison is against the **database** clock. No caller supplies a time, no
host clock participates, and there is no timer, poller or interval anywhere.

### 5.1 The schedule is cleared in the same transition

```sql
update public.integration_outbox o
  set state = 'dispatching',
      next_attempt_at = null
  where o.organization_id = obligation.organization_id
    and o.id = obligation.id
    and o.state in ('pending', 'retrying');
```

Migration 55 forbids `next_attempt_at` outside `retrying`, and the outbox guard
refuses an update that changes nothing — so the authoritative transition is the
**only** moment at which the schedule can be cleared. Clearing it there makes
claiming retry work atomic: there is no window in which a row is `dispatching`
while still carrying a stale schedule.

---

## 6. Strict FIFO

### 6.1 The predicate

```sql
and (not o.requires_ordered_delivery
     or not exists (
       select 1 from public.integration_outbox p
         where p.organization_id = o.organization_id
           and p.integration_connector_id = o.integration_connector_id
           and p.aggregate_type = o.aggregate_type
           and p.aggregate_id = o.aggregate_id
           and p.id <> o.id
           and p.state in ('pending', 'retrying', 'dispatching',
                           'ambiguous', 'dead_lettered')
           and ( … earlier-than, below … )))
```

The gate applies **only to an ordered candidate**. An unordered candidate is
governed by existing behaviour and receives no new restriction.

### 6.2 The frozen blocker set

| Blocks an ordered candidate | Does not block |
| --- | --- |
| `pending` | `accepted` |
| `retrying` (any schedule, due or not) | `acknowledged` |
| `dispatching` | `failed_permanent` |
| `ambiguous` | `refused` |
| **`dead_lettered`** | |

`dead_lettered` **blocks**, because dead-lettering abandons an obligation
rather than resolving it for its stream. Delivering the next obligation past an
abandoned predecessor is an external reordering, and external reordering is not
reversible. Waiting is.

### 6.3 The sequence key, and why it is written out

Earlier is defined by **`aggregate_revision ASC NULLS FIRST, created_at ASC,
id ASC`**. A row comparison cannot express `NULLS FIRST`, so the predicate is
three explicit branches:

```sql
(p.aggregate_revision is null and o.aggregate_revision is not null)
or (p.aggregate_revision is null and o.aggregate_revision is null
    and (p.created_at, p.id) < (o.created_at, o.id))
or (p.aggregate_revision is not null and o.aggregate_revision is not null
    and (p.aggregate_revision, p.created_at, p.id)
      < (o.aggregate_revision, o.created_at, o.id))
```

**A NULL revision is an unknown causal position, not a late one.** PostgreSQL's
`ASC` default is `NULLS LAST`, which would sort an unknown position last and
permit exactly the overtake this gate exists to prevent. Measured on
PostgreSQL: `(aggregate_revision, created_at, id) ASC` puts a **newer** ordered
row first when its older sibling's revision is NULL, and tuple comparison
reports that the older row is *not* earlier. That is why the three branches are
spelled out rather than compressed.

### 6.4 Why `NOT EXISTS` rather than ordering plus `LIMIT`

The predecessor test is a **correlated `NOT EXISTS` that takes no row locks**.
Candidate selection still uses `FOR UPDATE SKIP LOCKED`, and the hazard being
avoided is specific:

> `SKIP LOCKED` skips locked predecessor A → B passes the predicate → B is
> claimed → the stream is reordered.

Because the subquery locks nothing, it observes committed state through the
snapshot whether or not another transaction currently holds A's row lock, so a
**locked** predecessor still blocks. An implementation that instead relied on
ordering plus `LIMIT` would pass every single-connection test and reorder in
production. §8 records the proof.

### 6.5 Two controls, not one

| | Migration 55's partial unique index | This predicate |
| --- | --- | --- |
| Provides | **mutual exclusion only** | **ordering** |
| Blocker set | `dispatching`, `ambiguous` | plus `pending`, `retrying`, `dead_lettered` |
| Enforced by | index | function |
| Changed here | **no — untouched** | new |

Both must hold. Migration 55's index is not modified, not replaced and not
re-created.

### 6.6 The stream key, and what stays concurrent

A predecessor must match Organization, connector, aggregate type and aggregate
id. Nothing else is serialized: a different Organization, a different
connector or a different aggregate remains independently claimable, and
**unrelated streams on the same connector are claimed concurrently**.

Global candidate ordering is **unchanged** — `order by o.created_at, o.id`.
Unrelated obligations are deliberately **not** sorted by `aggregate_revision`,
which is meaningful only inside its own stream, and no new fairness policy is
introduced.

---

## 7. The ordering activation barrier

`requires_ordered_delivery` is pinned at enqueue from the connector revision in
force at that moment, and it never changes afterwards. So enabling
`per_aggregate` ordering on a connector that already carries traffic leaves a
stream containing both unordered historical rows and newly ordered rows.

Per F062.2D-2C-3-0A §4.0, **a predecessor participates regardless of its own
`requires_ordered_delivery`**. A historical row does not become ordered, but an
ordered candidate may not be delivered past it while it is unresolved. The
unresolved historical rows therefore form a one-time **activation barrier** that
drains naturally.

> **Operational implication, recorded and not implemented:** before enabling
> ordering on a connector with existing traffic, operations should be able to
> identify the unresolved obligations that would form the barrier. Without that
> visibility, switching ordering on looks as though it silently stalled the
> newly ordered work. The rows are queryable from existing evidence, so no new
> persistence is implied. This tooling is **not** built here.

---

## 8. The dispatch marker

```sql
mark_integration_dispatch_started(
  target_organization uuid,
  target_attempt uuid,
  expected_claim_generation bigint,
  raw_claim_token text
) returns boolean
```

The caller signals only *"I am about to cross the external side-effect
boundary"*. There is **no timestamp, obligation-state, destination or credential
parameter**: the database authors the marker with its own `clock_timestamp()`
through the F062.2D-2A/F062.2D-2C-1 guard, which discards any caller value and
enforces write-once.

### 8.1 The fence, entire

| Check | Effect when it fails |
| --- | --- |
| Organization, attempt id, `completed_at is null`, `claim_generation`, token digest | `false` |
| The attempt's obligation exists in the same Organization and is `dispatching` | `false` |

A caller failing any of them gets `false` and **cannot tell which**, exactly as
completion behaves. The obligation is located through the attempt's own
tenant-safe reference, never a caller-supplied id, so the relationship is
structural rather than asserted.

The raw token is **bind-only**: never stored, never returned, never
interpolated into SQL and never named in an exception. Only its digest is
compared, and the same length bound the claim applies is reapplied here.

### 8.2 Idempotent for the rightful owner, and why that is not check-then-act

```sql
select * into owned … for update;
if not found then return false; end if;
…
if owned.dispatch_started_at is not null then return true; end if;
```

The fenced row is taken `FOR UPDATE` **first**, so reading
`dispatch_started_at` under that lock is not check-then-act.

A blind `UPDATE … WHERE fence AND dispatch_started_at IS NULL` is insufficient:
zero rows affected cannot distinguish *"already marked"* from *"fence failed"*,
and the contract requires those be distinguishable internally.

Idempotency matters for a concrete failure: if the first marker call **commits
but its response is lost**, the caller must be able to retry and learn that the
boundary is committed. Without that it could not tell a lost response from
*"someone else owns this"*, and would be pushed toward transmitting without a
committed marker. The timestamp is **never re-stamped**.

---

## 9. Privilege posture

| Property | Value |
| --- | --- |
| Owner | `reqro_integration_function_owner`, assumed via `SET ROLE` and restored |
| Both functions | `SECURITY DEFINER`, `VOLATILE`, `search_path = pg_catalog, public, pg_temp` |
| PUBLIC `EXECUTE` | revoked by full signature, for **both** functions |
| New grant to any role | **none** |
| New privilege for the function owner | **none** — the predecessor subquery needs `SELECT` on `integration_outbox` (the owner holds `SELECT, UPDATE`), and the marker needs `SELECT … FOR UPDATE` and `UPDATE` on the attempt (the owner holds `INSERT, SELECT, UPDATE`) |
| `reqro_integration_worker` | still does not exist |
| `reqro_runtime` on integration tables | still nothing |

Because no new privilege is required, the §16 stop condition of the
authorization is not reached.

---

## 10. Rollback semantics

`down()` restores the exact pre-3A surface: the marker function is dropped, and
**Migration 53's claim function is recreated verbatim** with its owner,
`SECURITY DEFINER`, volatility, `search_path` and closed ACL.

> **No business evidence is touched.** A `dispatch_started_at` written while
> Migration 56 was active is valid Migration 54 evidence and survives rollback
> untouched, as does every obligation, attempt, schedule and connector row.
> Rolling a function definition back is not a reason to erase what the function
> recorded.

---

## 11. Validation

`server/test/database/integration-fifo-dispatch-hardening.integration.test.ts`
— **19 subtests, all passing** against PostgreSQL, in a disposable schema, with
**no sleeps**.

| Area | Proven |
| --- | --- |
| Descriptor parity | the live catalogue returns the original twenty columns **plus** `claim_expires_at timestamptz`, the identity arguments are unchanged, and the source agrees |
| Retry eligibility | `pending` yes; `retrying` + NULL no; future no; due yes; the schedule is cleared by the claim; the due comparison is proven against the database clock in both directions |
| No lease | the returned `claim_expires_at` and the stored column are both NULL |
| Blocker set | all five blocking states block, across all three retry schedules; all four terminal states do not |
| Stream key | different Organization, connector and aggregate do not block |
| 3-0A boundary | NULL-revision historical sibling blocks; `accepted` does not; `dead_lettered` does; numbered revisions sorting before block and sorting after do not; **a NULL-revision sibling created *later* still blocks** |
| Unordered candidate | receives no gate |
| Concurrency | **a locked unresolved predecessor still blocks despite `SKIP LOCKED`**, coordinated by observing the granted lock in `pg_locks` from a third connection; unrelated streams are claimed concurrently from two connections |
| Marker | owner marks; database-authored between two clock readings; repeat call returns `true` without re-stamping; wrong token, stale generation, wrong Organization, unknown attempt and settled attempt all refused; nothing but the boundary changes |
| Security | exactly three functions exist; both new ones are definer, volatile, with the reviewed `search_path`; **PUBLIC `EXECUTE` is absent from both**; no worker role exists |
| Rollback | apply → use → `down` → the widened descriptor is gone, the marker function is gone, the restored claim differs from the hardened one, posture and closed ACL intact, **durable marker evidence survives** → reapply, evidence still intact |

The strengthened assertions are worth naming: where a predecessor is itself
claimable it simply wins on global ordering, which would hide a missing gate
entirely. Those tests therefore claim **twice** and require the second claim to
find nothing — that is the gate, not the ordering.

### 11.1 Real-cluster posture

`database-role-separation.integration.test.ts` now applies Migration 56 as text
on the five-identity PostgreSQL 17 cluster and asserts the api schema holds
exactly the **three** reviewed functions, each owned by
`reqro_integration_function_owner`, and that neither PUBLIC nor `reqro_runtime`
can execute the marker. That is where owner identity is proven; a disposable
schema cannot prove it.

### 11.2 Inventory assertions

`55 → 56` in the worker-function API contract test. The **compiled** count
stays `52`, because Migration 56 hardcodes `public.` and is applied as text;
the two cluster suites carry a comment recording why.

### 11.3 No policy leakage

The executable migration contains no interval, no randomness, no jitter, no
backoff, no sleep, no `attempt_count`/`retry_count`/`recovery_count`, no
recovery function, no role, no grant and no credential reference. Every such
word in the file occurs only in prose explaining its own absence. The only
numeric literals outside comments are the token length bounds already present
in Migration 53, and the one new time comparison is due-retry eligibility
against the database clock.

---

## 12. Known limitations

1. `claim_expires_at` is always NULL and no consumer exists. A later slice must
   author it, and must never treat NULL as expired.
2. The marker is not reachable by any identity, because no identity holds
   `EXECUTE`. Its behaviour is proven only as the function owner.
3. The migration-import guard in the worker-function API contract test is still
   scoped to Migration 53. Migration 56 also hardcodes `public.`, and nothing
   currently fails if a future test imports it statically.
4. No operational visibility exists for the §7 activation barrier.

---

## 13. What remains blocked

| Slice | Still required |
| --- | --- |
| **3B** | execution-policy persistence, the two authority classes and the fail-closed lease rule |
| **3C** | lease authorship and duration, retry scheduling, backoff, recovery function and recovery scanning |
| **F062.2D-3** | worker identity, `EXECUTE` grants, runtime polling, transport, adapters and F061 telemetry |

Nothing in this slice narrows those decisions, and none of them is anticipated
by a constant, a column or a grant.

---

## Related

- [F062.2D-2C-3-0 worker execution policy and function signatures](F062-2D-2C-3-0-worker-execution-policy-function-signatures.md)
- [F062.2D-2C-2 ordered-stream and retry-eligibility persistence](F062-2D-2C-2-ordered-stream-retry-eligibility-persistence.md)
- [F062.2D-2C-1 lease, dispatch and recovery-reason persistence](F062-2D-2C-1-lease-dispatch-recovery-reason-persistence.md)
- [F062.2D-2B worker database function API](F062-2D-2B-worker-database-function-api.md)
- [F062.1 integration contracts foundation](F062-1-integration-contracts-foundation.md)
