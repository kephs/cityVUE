# F062.2D-2B — Worker claim and completion database function API

> **NO WORKER RUNS IN F062.2D-2B.**
>
> **NO EXTERNAL DESTINATION IS CONTACTED.**
>
> **NO WORKER LOGIN OR WORKER EXECUTE GRANT EXISTS.**
>
> **RAW CLAIM TOKENS ARE NEVER PERSISTED.**

There is no polling loop, no scheduler, no queue consumer, no transport, no HTTP
client, no connector adapter, no secret-manager access, no destination
credential, no DNS or TLS configuration, no vendor SDK, no Azure integration, no
operator API, no PIM execution, no `reqro_integration_worker` role, no worker
`EXECUTE` grant, no Entra database authentication and no F061 instrumentation.
No NestJS runtime file is touched. This slice adds two PostgreSQL functions, one
non-login role, one membership edge, one schema and one reviewed grant artifact.

**No ADR number is allocated.** This implements the already-accepted F062.2D-1
decision. The one place the implementation differs from that decision is the
pinned `search_path`, reviewed and **approved** as an implementation-driven
refinement; §4 is the record, and a decision amendment to F062.2D-1 is required
before production worker activation.

Starting point: `origin/main` at `0ae4e810`, which carries F061.3B (`8885d17a`)
and F062.2D-2A (`46aa24d7`) as verified ancestors.

---

## 1. Feasibility gate results

Phase 0 was completed from source and from two measured probes on PostgreSQL
17.11 before any file was edited.

| Gate                              | Result                | Basis                                                                                                                                                                                                                                                                                                       |
| --------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — claim eligibility**         | **PROVEN**            | Eligibility is decidable from `integration_outbox`, `integration_connector` and `integration_connector_audit` alone. No business table is read, so the function owner needs no privilege on one. `integration_connector.organization_id` references `organization`, but reading the row needs no privilege there |
| **B — claim return contract**     | **PROVEN, narrowed**  | The schema carries enough for a bounded descriptor of claim identity plus the F062.1 envelope fields. **The `credential_reference` locator is deliberately excluded** — see §9                                                                                                                              |
| **C — completion mapping**        | **PROVEN**            | The four F062.1 `attemptOutcomes` map onto four declared edges out of `dispatching`, with no new outcome, state or transition. Derived in §11                                                                                                                                                               |
| **D — claim-token hashing**       | **PROVEN, no extension** | `pg_catalog.sha256(bytea)` and `pg_catalog.encode(bytea, text)` are core since PostgreSQL 11. Measured: 64 lowercase hex characters, which is exactly the F062.2D-2A `claim_token_digest char(64) check (~ '^[0-9a-f]{64}$')` domain. **pgcrypto is not required** and is not used                      |
| **E — expired-claim recovery**    | **BLOCKED**           | Deferred, not stubbed. Four independent reasons in §12                                                                                                                                                                                                                                                      |
| **F — state_sync convergence**    | **PRESERVED**         | Nothing is marked convergent. A `state_sync` obligation is claimed on exactly the same terms as any other and no repeat dispatch is enabled; `supports_current_state_sync` is read by no function here                                                                                                     |

Gates A–D passed, so the claim and completion functions proceed. Gate E failed
alone, so recovery is reported as blocked and the two independently safe
functions are implemented — which is what the authorization directs.

One additional gate was raised by implementation and is reported rather than
resolved: **the per-aggregate ordering gate is BLOCKED** (§10).

---

## 2. Baseline, read from source

| Fact                            | Measured value                                                                                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch                          | `claude/f062-2d-2b-worker-functions`, from `origin/main` `0ae4e810`                                                                                                                                                  |
| Migrations before               | 52 `.ts`, of which **50 compile** into the test output                                                                                                                                                               |
| Next ordinal                    | **53**, `20261023000000-add-integration-worker-function-api.ts`                                                                                                                                                      |
| Migrations after                | 53 `.ts`, still **50 compiled** — see §16                                                                                                                                                                            |
| Database roles before           | 4: `reqro_owner` (NOLOGIN), `reqro_migrate`, `reqro_runtime`, `reqro_operator`, all `noinherit`                                                                                                                       |
| Membership graph before         | exactly one edge, `reqro_migrate → reqro_owner`                                                                                                                                                                      |
| SECURITY DEFINER before         | 10 functions — 1 from Migration 48, 9 from Migration 49 — all `security definer`, `volatile`, `set search_path = pg_catalog, pg_temp`, all owned by the schema owner, all with `PUBLIC EXECUTE` revoked by signature |
| Integration table privileges    | **none**, for any role. The bootstrap issues no default privileges, so the four integration tables were unreachable by `reqro_runtime` and `PUBLIC` before this slice and remain so                                  |
| PostgreSQL authority            | **17**, pinned by `server/compose.yml` (`postgres:17-alpine`); the role cluster refuses any other major version. The local `TEST_DATABASE_URL` server is **18.6**, reported in §17                                   |

---

## 3. What was implemented

| Object                                                      | Kind             | Owner                              |
| ----------------------------------------------------------- | ---------------- | ---------------------------------- |
| `reqro_integration_function_owner`                          | role, **NOLOGIN** | —                                  |
| `reqro_migrate → reqro_integration_function_owner`          | membership edge  | `INHERIT FALSE, SET TRUE, ADMIN FALSE` |
| `reqro_integration_api`                                     | schema           | `reqro_integration_function_owner` |
| `reqro_integration_api.claim_integration_intent`            | function         | `reqro_integration_function_owner` |
| `reqro_integration_api.complete_integration_attempt`        | function         | `reqro_integration_function_owner` |

Nothing else. No table, no column, no index, no trigger, no view, no type, no
sequence, and no change to any existing object.

### Exact signatures

```sql
reqro_integration_api.claim_integration_intent(
  target_organization uuid,
  target_connector    uuid,
  raw_claim_token     text
) returns table (
  integration_outbox_id            uuid,
  delivery_attempt_id              uuid,
  attempt_number                   integer,
  claim_generation                 bigint,
  integration_connector_id         uuid,
  connector_kind                   varchar(40),
  integration_id                   uuid,
  contract_kind                    varchar(10),
  integration_type                 varchar(64),
  schema_version                   integer,
  aggregate_type                   varchar(20),
  aggregate_id                     uuid,
  aggregate_revision               integer,
  payload_mode                     varchar(28),
  correlation_id                   uuid,
  causation_id                     uuid,
  deployment_environment           varchar(30),
  occurred_at                      timestamptz,
  connector_configuration_revision integer,
  capability_snapshot              jsonb
)

reqro_integration_api.complete_integration_attempt(
  target_organization       uuid,
  target_obligation         uuid,
  target_attempt            uuid,
  expected_claim_generation bigint,
  raw_claim_token           text,
  attempt_outcome           varchar(18),
  attempt_failure_category  varchar(28)
) returns boolean
```

Both are `LANGUAGE plpgsql VOLATILE SECURITY DEFINER`. Neither has a default
parameter: the settlement takes all seven arguments explicitly, so "the exact
signature" is unambiguous for a grant and for a test. Every parameter is typed;
no parameter is a catch-all `json`/`jsonb`, none names an object, and neither
body contains dynamic SQL of any kind.

---

## 4. The reviewed `search_path` refinement

> **The pinned `search_path` is `pg_catalog, public, pg_temp`, not
> `pg_catalog, pg_temp`.**
>
> **This was reviewed and APPROVED in the F062.2D-2B security/database review
> as an implementation-driven refinement, not as a generic relaxation of the
> hardened-`search_path` convention.**

### What F062.2D-1 said, and what implementation evidence proved

- **F062.2D-1 §9 originally recommended `pg_catalog, pg_temp`**, with the
  application schema deliberately absent. That recommendation remains correct
  for Migration 49, whose nine definer functions only `SELECT ... FOR SHARE`,
  fire no trigger, and therefore never exercise nested resolution.
- **Implementation evidence proved that the existing accepted F062.2C and
  F062.2D-2A trigger functions require the application schema while they are
  invoked by these definer functions.** A function's `SET` clause stays in
  effect for everything it calls, including a trigger function, unless the
  callee carries its own `SET` clause. The guards
  `guard_integration_outbox` and `guard_integration_delivery_attempt` declare
  composite variables (`declare obligation integration_outbox;`) and read
  tables **unqualified**, with **no `SET search_path` clause** — deliberate in
  those slices, because it is what keeps the schema portable for the
  disposable-schema test harness.
- **Measured:** with the application schema absent from the path, the first
  claim fails with `type "integration_outbox" does not exist`, raised from
  inside the attempt guard during the `INSERT`. 19 of 22 tests failed this way
  before the path was corrected.
- **This is a production failure, not a harness artifact.** The deployment's
  application schema is `public`, and `public` is equally absent from
  `pg_catalog, pg_temp`.
- **F062.2D-2B therefore uses `pg_catalog, public, pg_temp`**, and the review
  approved retaining it. The path is not to be changed again in this slice.

### This is safe only while `public` CREATE stays unavailable

**The refinement is conditional, and the condition is explicit: admitting
`public` to a `SECURITY DEFINER` path is safe only while no untrusted principal
holds `CREATE` on the application schema.** If any untrusted principal could
create a relation, a type or a function there, it could shadow an object these
functions resolve through `public.` and so capture definer privilege. That is
the whole of the residual risk, and it is why the condition is now a tested
invariant rather than a stated assumption.

**The invariant is enforced by database tests.**
`database-role-separation.integration.test.ts` subtest **"F062.2D-2B no
untrusted principal holds effective CREATE on the application schema"** proves,
on a PostgreSQL 17 cluster whose application schema is literally `public`:

- effective `CREATE` is absent — via `has_schema_privilege`, which accounts for
  privileges reaching a principal through `PUBLIC` or through an inheriting
  membership — for `PUBLIC`, `reqro_runtime`, `reqro_operator`,
  `reqro_integration_function_owner`, and `reqro_migrate` without an explicit
  privileged `SET ROLE`;
- `reqro_integration_function_owner` holds schema `USAGE` but **not** `CREATE`;
- database-level `CREATE` is absent for the same five principals, so no
  competing schema can be interposed;
- the schema ACL grants `CREATE` to **exactly one** principal, `reqro_owner`,
  as an equality that fails on any surplus grantee;
- `PUBLIC` holds `USAGE` and nothing else on the application schema;
- no role-membership path confers it: `pg_has_role(..., 'USAGE')` is false for
  every constrained role, and false for `reqro_migrate` too, which may *assume*
  the owner but inherits nothing from it;
- `pg_default_acl` is empty, so no default-privilege path can open one later;
- and behaviourally, not merely from the catalogue: `CREATE TABLE` and
  `CREATE FUNCTION` in `public` are refused for a bare `PUBLIC`-only probe
  login, the runtime, the operator, the migration login without `SET ROLE`, and
  the function owner assumed through `SET ROLE` — while the explicit
  ownership path succeeds and is proven to be the only one that does.

The path's exact shape is a separate tested invariant.
`worker-function-api-contract.test.ts` subtest **"both definer functions pin
exactly pg_catalog, public, pg_temp"** asserts the pin positionally rather than
textually — `pg_catalog` first, `public` second, `pg_temp` last — names and
rejects `public, pg_catalog, pg_temp`, `pg_catalog, pg_temp, public`,
`pg_temp, pg_catalog, public` and the original `pg_catalog, pg_temp`, admits no
fourth schema, and refuses any caller-controlled or inherited path
(`search_path from current`, `to default`, `reset search_path`,
`set_config('search_path', …)`, `current_schema`). The live catalogue is checked
independently: the role-separation suite asserts each function's `proconfig` is
exactly `search_path=pg_catalog, <app schema>, pg_temp`.

### Every threat the pin was meant to close is still closed

| Threat                                     | Still closed, by                                                                                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caller-controlled resolution order         | The path is still pinned **on the function**; the caller does not choose it, and no caller-controlled or inherited form is permitted                                                          |
| Temp-object hijacking                      | `pg_temp` is still **last**. Proven: the suite plants `pg_temp` decoys for all four integration tables and the claim still reads the real ones                                                |
| Function shadowing                         | `pg_catalog` is still **first**, and PostgreSQL never searches `pg_temp` for function or operator names at all                                                                               |
| Object shadowing in the application schema | No principal but the object owner holds `CREATE` there. The bootstrap's fail-closed block refuses any that does, and the effective-privilege test proves it for all five named principals     |
| This slice's own references                | Closed by **qualification**, not by the path: every reference is `public.`-qualified, asserted by a source test that counts unqualified occurrences and requires zero                         |

**The pin is load bearing, and the suite proves it rather than asserting it.**
PostgreSQL searches `pg_temp` _first_ for relations when `pg_temp` is not named
in `search_path`, so on the same connection where the decoys are planted an
**unpinned session query is diverted** — and the function is not. Both halves
are asserted.

### Future hardening, and the required decision amendment

**A future hardening slice may fully qualify and harden the older F062.2C and
F062.2D-2A trigger functions and then remove `public` from the definer path**,
returning it to `pg_catalog, pg_temp`. That work is deliberately out of scope
here because it redefines another accepted slice's objects and makes the schema
non-portable for the disposable-schema harness; it belongs in its own slice
with its own review.

**A decision amendment to F062.2D-1 is required before production worker
activation.** F062.2D-1 records `pg_catalog, pg_temp`; the implemented and
approved path is `pg_catalog, public, pg_temp`. **F062.2D-1 is deliberately not
edited in this slice or on this branch** — amending an accepted decision record
is a separate, explicitly authorized act. Until that amendment lands, the
accepted decision and the implementation differ on this one point, and this
section is the record of why.

---

## 5. Role topology

```text
reqro_owner                       <--grant--  reqro_migrate   (existing)
reqro_integration_function_owner  <--grant--  reqro_migrate   (new)
                                              inherit false, set true, admin false

reqro_runtime                     (isolated, unchanged)
reqro_operator                    (isolated, unchanged)
reqro_integration_worker          (DOES NOT EXIST — F062.2D-3)
```

Exactly one edge was added, and the bootstrap's membership check remains an
**equality** assertion over the whole topology, now extended to five names — so
an edge nobody reviewed fails provisioning rather than passing unnoticed. The
bootstrap additionally refuses unless the new edge exists **with**
`inherit_option = false`, `set_option = true`, `admin_option = false`, because a
permissive edge is worse than a missing one.

| Option          | Effect                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `INHERIT FALSE` | `reqro_migrate` holds **none** of the function owner's DML by virtue of membership. Proven behaviourally: it is refused when it tries   |
| `SET TRUE`      | The only capability required — assume the role for reviewed function DDL                                                               |
| `ADMIN FALSE`   | `reqro_migrate` cannot grant or revoke the membership, so the migration login cannot widen the graph it sits in. Proven behaviourally   |

`SET ROLE` is authorized against **`session_user`**, which during a migration is
`reqro_migrate` even after it has assumed `reqro_owner` — measured on 17.11, and
the reason this edge is sufficient. The migration restores the prior role
explicitly rather than with `RESET ROLE`, which would drop to the session login
and strand the rest of the migration run.

---

## 6. Schema ownership, and why bootstrap creates it

`reqro_integration_api` is created by **`deploy/database/bootstrap-roles.sql`**,
with `AUTHORIZATION reqro_integration_function_owner`, not by the migration.

The reason is measured: `CREATE SCHEMA` requires `CREATE` on the **database**,
which the function owner must not hold (F062.2D-1 §11), and on PostgreSQL 17.11
**`create schema if not exists` is refused for want of that privilege even when
the schema already exists**. So the assumed role cannot issue the statement at
all. `ALTER SCHEMA … OWNER TO` is no help either: it is checked against
`current_user`, which during a migration is `reqro_owner`, and `reqro_owner` is
not a member of the function owner.

The migration therefore issues `create schema if not exists` **before** assuming
the role, which is a no-op in a provisioned deployment and is the
development/test path where the bootstrap has not run. It then refuses outright
if the role exists but the schema is missing or wrongly owned, so a
half-provisioned deployment fails closed.

**Rollback boundary:** the schema's lifecycle belongs to the bootstrap, so
`down()` drops it **only where the function-owner role is absent** — exactly
where this migration created it. That is the same rule that keeps a migration
from dropping a bootstrap-created role.

---

## 7. The function owner's privilege ceiling

Granted by **`deploy/database/integration-worker-role.sql`**, applied as
`reqro_owner` after migrations (provisioning step 7). Derived statement by
statement from the two function bodies, not copied from the design.

| Object                                    | Privilege                     | Why                                                                     |
| ----------------------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| application schema                        | `USAGE`                       | Schema `USAGE` and table DML are independent; without it the rest is inert |
| `integration_outbox`                      | `SELECT`, `UPDATE`            | eligibility read, `FOR UPDATE SKIP LOCKED`, and the two transitions     |
| `integration_delivery_attempt`            | `SELECT`, `INSERT`, `UPDATE`  | open-attempt test, one open attempt per claim, one open→settled update  |
| `integration_connector`                   | `SELECT`                      | lifecycle and `connector_kind`                                          |
| `integration_connector`                   | `UPDATE (id)` **column only** | required by `FOR SHARE`; inert because F062.2B refuses any change to `id` |
| `integration_connector_audit`             | `SELECT`                      | the pinned semantic snapshot                                            |

Deliberately absent, each with a reason the artifact records: no `INSERT` on the
outbox (a worker that could insert intents could manufacture obligations); no
`DELETE` or `TRUNCATE` anywhere (delivery history is evidence —
`mayEraseEvidence()` is `false` in every state); no `INSERT`/`UPDATE` on the
audit table; no general `UPDATE` on the connector; **nothing on any business
table**; **no `GRANT OPTION` on anything**; and no default privileges.

`WITH GRANT OPTION` appears nowhere in the artifact, which is the accurate form
of the rule — PostgreSQL does not add it by default, so this is a prohibition on
ever writing it rather than something to revoke. Ownership of
`reqro_integration_api` and its two functions is a different thing and is
intentional: it is how a reviewed migration maintains the API at all.

The artifact's own fail-closed block refuses the transaction unless the table
privilege set **equals** the derived list, no privilege is grantable, no
`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER` is held, the column grant exists
while the table-wide one does not, the owner holds no `CREATE` outside its
schema and owns no relation, and no non-owner can execute anything in the api
schema.

---

## 8. Claim concurrency model

Two **independent** mechanisms, deliberately, so removing either still leaves
the invariant enforced:

1. **`SELECT … FOR UPDATE SKIP LOCKED LIMIT 1`** on the obligation row. Two
   claimers never select the same row, and `SKIP LOCKED` never waits — which is
   what makes the proof deterministic with no sleep anywhere.
2. **The F062.2D-2A `integration_attempt_open` partial unique index.** A second
   open attempt for one obligation is a constraint violation even if the first
   mechanism were removed. The suite proves this directly by forcing a second
   open attempt and observing the index refuse it.

The connector is read **`FOR SHARE`** so its configuration cannot change between
pinning the snapshot and opening the attempt — the read-then-pin race F062.2C
identified. `FOR SHARE` requires `UPDATE` on at least one column of the locked
table, checked against the **effective** role, which inside a definer function
is the function owner; that is what the inert `UPDATE (id)` grant satisfies, and
why `reqro_integration_worker` will never need `UPDATE` anywhere.

**Claim eligibility is `pending` only.** `retrying → dispatching` and
`ambiguous → dispatching` are legal F062.1 edges and neither is *claimable*:

| Not claimable | Why                                                                                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retrying`    | No approved backoff exists — F062.2D-1A records `next_attempt_at` and `attempt_count` as deferred — so claiming it would be an unbounded hot retry loop against a destination            |
| `ambiguous`   | Resolving an ambiguity is the judgement call the worker exists not to make. F062.2D-0 routes it to a human, and the F062.2D-2A guard additionally gates the edge on idempotency support   |

Ordering within `pending` is `created_at, id` — oldest first, deterministic.

---

## 9. The claim return value

Twenty columns: claim identity, plus exactly the F062.1 envelope fields a future
worker would need to form the envelope it would send, plus the pinned
configuration revision and the three-key capability snapshot.

**Excluded, and each exclusion is a decision:**

| Excluded                 | Why                                                                                                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the raw claim token      | The function **receives** it and never has one to return (F062.2D-1 §14)                                                                                                                                                                                                           |
| `claim_token_digest`     | Verification material never leaves the database                                                                                                                                                                                                                                     |
| **`credential_reference`** | F062.2D-1 §6 lists the locator in the claim return, and it is **deliberately withheld here.** The authorization permits it only where "already explicitly approved for worker dispatch", and **dispatch does not exist**: F062.2D-0 §12 records destination semantics as still missing from the connector snapshot, so nothing could use the locator. Adding it is a one-line change in the slice that first dispatches, and withholding it now keeps a locator out of result sets, logs and traces until something needs it. **Flagged for review as a narrowing of the accepted decision.** |
| `connector_key`          | A logical name the worker does not need; `connector_kind` is the capability profile an adapter is selected by, and it is explicitly not a vendor product name                                                                                                                       |
| outbox `state`, `created_at`, `mutation_txid`, attempt `started_at` | Not needed to continue the attempt                                                                                                                                                                      |
| any business or resident value | The outbox exists so a delivery worker never touches resident data                                                                                                                                                                                                            |

The column set is asserted as an **exact set equality** in the suite, so adding
a field later is a deliberate, reviewable act rather than a drift.

---

## 10. Reported blocker — the per-aggregate ordering gate

F062.2D-1 §6 lists "aggregate's in-flight slot occupied" among the claim's
refusals, and `supportsOrdering: 'per_aggregate'` is a declared F062.1
capability carried in the pinned snapshot. **It is not implemented, because it
cannot be made correct with the current schema.**

A check of the form "refuse if another obligation for the same
`(organization, aggregate_type, aggregate_id)` is already `dispatching`" is not
atomic: two claimers taking two different obligations for one aggregate each see
the other's uncommitted state as absent, and there is no row either of them both
locks. Locking the sibling obligations instead deadlocks or races by claim order.
There is no per-aggregate serialization point in the schema — no aggregate row to
lock, and `SKIP LOCKED` is the wrong primitive for a mutual gate.

**A best-effort version would be worse than none**, because it would read as a
guarantee. Implementing it needs a reviewed serialization point (an advisory
lock keyed on the aggregate, or an in-flight slot table), which is a schema and
concurrency decision, not an implementation detail. Nothing is lost today: no
dispatch occurs, and `ORDER BY created_at` already claims one aggregate's
obligations oldest-first within a single claimer.

---

## 11. Completion and fencing model

**One statement establishes ownership and settles, so there is no check-then-act
window.** Identity, openness, generation and token digest are all predicates on
the same `UPDATE`:

```sql
update public.integration_delivery_attempt a
   set outcome = …, failure_category = …, completed_at = clock_timestamp()
 where a.organization_id      = target_organization
   and a.integration_outbox_id = target_obligation
   and a.id                   = target_attempt
   and a.completed_at is null
   and a.claim_generation     = expected_claim_generation
   and a.claim_token_digest::text
         = pg_catalog.encode(pg_catalog.sha256(
             pg_catalog.convert_to(raw_claim_token, 'UTF8')), 'hex')
```

A stale claimant matches **zero rows**, mutates nothing, and receives `false`.
The return is a bare boolean and **`false` is deliberately undifferentiated**: a
wrong token, a stale generation, an already-settled attempt, another
Organization's attempt and a mismatched obligation are indistinguishable to the
caller, so a refusal cannot be used to learn that another tenant's attempt
exists.

### The mapping, derived entirely from F062.1

| Outcome            | Required category                                           | Resulting state    |
| ------------------ | ----------------------------------------------------------- | ------------------ |
| `succeeded`        | must be null                                                | `accepted`         |
| `failed_transient` | **only** `destination_unavailable` or `rate_limited`        | `retrying`         |
| `failed_permanent` | any declared category except `destination_timeout`          | `failed_permanent` |
| `ambiguous`        | any declared category                                       | `ambiguous`        |

Both halves of F062.1's classification are enforced, so a worker cannot relabel
an ambiguous timeout as a transient failure and earn itself a blind retry:
`failed_transient` accepts exactly `transientIntegrationFailures`, and
`destination_timeout` settles **only** as `ambiguous`, because a timeout may
already have taken effect.

The mapping is **total over the four outcomes** and reaches
`dead_lettered`, `acknowledged` and `refused` **never** — asserted both in SQL
source and against `deliveryStateTransitions`. `acknowledged` is a
destination-reported terminal state rather than an attempt outcome;
`dead_lettered` is §13.

If the obligation has left `dispatching` underneath the claimant, the function
raises and the attempt settlement rolls back with it, because both statements are
in the caller's transaction. Proven: the attempt is still open afterwards.

### Fencing, and one honest limitation

Generation N cannot settle generation N+1, in all three combinations: wrong
generation with the right token, right generation with the wrong token, and both
stale. **Reaching generation 2 required a privileged direct insert in the test**,
because **no reviewed API path produces a second generation today** — that is
precisely what re-claim and recovery would do, and neither exists. The fencing
machinery is correct and currently exercised only by a forced scenario; it
becomes reachable when §12 is unblocked.

---

## 12. Recovery is BLOCKED, and deliberately not stubbed

`recover_expired_integration_claim` is **not implemented**, **not stubbed**, and
appears nowhere in executable SQL. Four independent reasons, each checkable:

1. **No lease exists.** `claimed_until` has zero occurrences in the schema.
   F062.2D-1A §2 records `next_attempt_at`, `attempt_count` and `claimed_until`
   as deferred, and F062.2D-2A deferred the lease explicitly because its duration
   is unresolved.
2. **No approved lease duration exists.** F062.2D-1 §7 describes a range-checked
   `interval` bounded by "a platform ceiling", and no ceiling has been approved.
   The authorization is explicit: **do not choose a timeout**, and do not accept
   a caller-controlled duration.
3. **The schema cannot distinguish a pre-side-effect attempt from one that may
   already have reached the destination.** No attempt column records whether a
   request was transmitted, because no dispatch slice exists. Every open attempt
   is therefore externally ambiguous, and "old open attempt = safe to retry" is
   exactly the inference F062.2D-1A forbids.
4. **The pending-age policy is not a substitute** and must not be reused;
   F062.2D-1A §17 separates them explicitly — ambiguity means something *may
   have happened*, age expiry means nothing did.

**The operational consequence, stated plainly:** an obligation whose claimant
dies stays `dispatching` with an open attempt, indefinitely. It is **visible and
stuck, not lost** — F061.3A's `integration_oldest_pending_age` and the worker
liveness signals are what surface it — and its resolution is the authorized
human path F062.2D-0 §22 defines. That is the fail-closed direction: the
alternative is a guessed timeout silently retrying a possibly-completed
irreversible side effect.

Recovery needs, before it can be implemented: an approved lease duration and
ownership, a durable record of transmission or an accepted rule for treating all
expiry as ambiguous, and the F062.2D-1A requeue-authorization evidence.
**F062.2D-1 is not edited by this slice**; amending its three-function inventory
to two-plus-deferred belongs in a decision amendment.

---

## 13. Dead-letter replay and age remain absent

`dead_lettered → pending` is **not added**, and `dead_lettered` has no outgoing
edge in `deliveryStateTransitions` or in the database. F062.2D-1A requires
durable authorized replay evidence, which does not exist, so enabling the edge
would create a hidden unaudited replay path to a live external system. No
function here can reach `dead_lettered` at all.

No age-based behaviour exists: executable SQL contains no `pending_age`,
`age_exceeded`, `max_pending`, `next_attempt`, `attempt_count`, `now() -`,
`clock_timestamp() -`, ` age(`, or `interval '`. The one `timeout` in the
migration is `set local lock_timeout = '5s'` in `down()`, which bounds a lock
wait and is not a lease — stated because a substring scan would otherwise flag
it. **Age cannot erase uncertainty**, and no function uses time to move
`ambiguous` anywhere.

---

## 14. PUBLIC and runtime denial

| Principal                          | On `reqro_integration_api`                                     | On the function API                        |
| ---------------------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| `PUBLIC`                           | no `USAGE`, no `CREATE` — `revoke all` in the bootstrap         | **`EXECUTE` revoked by full signature**    |
| `reqro_runtime`                    | **nothing**                                                    | nothing. Its surface stays at exactly 11 functions |
| `reqro_operator`                   | **nothing**                                                    | nothing                                    |
| `reqro_migrate`                    | nothing without `SET ROLE`                                     | change authority only                      |
| `reqro_integration_worker`         | **does not exist**                                             | **does not exist**                         |
| `reqro_integration_function_owner` | owns it                                                        | `EXECUTE` follows ownership; it is NOLOGIN  |

`PUBLIC EXECUTE` is revoked per function with the full argument list, following
Migrations 48 and 49, because PostgreSQL's **default grantee for `EXECUTE` is
`PUBLIC`** — omitting the revoke would hand definer authority to every role in
the cluster. **The API is therefore callable by no login role after this slice.**
Proven behaviourally as well as from the catalogue: the runtime is refused with
`permission denied for schema`, cannot `SET ROLE` to the function owner, and
still cannot read `integration_outbox` directly.

---

## 15. Rollback behaviour and boundaries

| Step                                   | Behaviour                                                                                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unsettled claim exists                 | **Refuses.** An open attempt would have no settlement path once the API is gone, and no operator surface exists to resolve it                                   |
| Settled evidence exists                | **Proceeds.** Evidence is unaffected; nothing is deleted                                                                                                        |
| The two functions                      | Dropped, after assuming the owner, because `reqro_owner` cannot drop another role's function                                                                     |
| `reqro_integration_api`                | Dropped **only where the function-owner role is absent** — exactly where `up()` created it. `restrict`, never `cascade`, so an unexpected object refuses         |
| Outbox rows, attempts, connector history, audit evidence | **Never touched.** Nothing is deleted to make rollback succeed                                                                                 |
| The role and the membership edge       | **Not dropped.** Role lifecycle belongs to the bootstrap                                                                                                        |
| The function-owner grants              | **Not revoked**, because they are not granted here. As Migration 49's header records for the runtime grants, a rolled-back deployment must revoke them in the same operation |

Verified as `apply → refuse → settle → rollback → reapply`, with a claim
succeeding again afterwards.

---

## 16. Why Migration 53 is applied as text

A `SECURITY DEFINER` function must qualify every application object, so the
migration spells the deployment's schema name literally — `public.`. Migrations
48 and 49 do the same and are, for the same reason, **not imported by any test**
and therefore **not compiled**: the compiled set stays at 50 of 53.

`test/helpers/integration-worker-functions.ts` reads the migration source and
rewrites `public.` to the disposable schema, the fixed `reqro_integration_api`
name to a per-schema one (so concurrent suites cannot collide on a global
namespace), and the path's application-schema entry to match. This mirrors
`runtime-reference-locks.ts` exactly. The security properties survive the
rewrite — the pin, the qualification, the definer declaration and the `PUBLIC`
revoke are all preserved — and **the literal `public.` spelling and the literal
`reqro_integration_api` name are asserted separately against the source**.

A source test asserts that no test imports this migration, so the arrangement
cannot be broken silently.

---

## 17. Validation

| Check | Result |
| --- | --- |
| `integration-worker-functions.integration.test.ts` (new) | **22/22**, 0 skipped |
| `worker-function-api-contract.test.ts` (new) | **15/15**, 0 skipped — 14 plus the review-hardening `search_path` contract test |
| `database-role-separation.integration.test.ts` (extended, PostgreSQL 17 in Docker) | **20/20** — 19 subtests plus the top-level, including the three F062.2D-2B subtests; run twice, identical both times |
| `integration-delivery-attempt` / `integration-outbox` / `integration-connector` | 18/18, 14/14, 18/18 — **72/72** together, unchanged |
| F062.1 contracts and boundary | 29/29 and 10/10, unchanged |
| `connector-metadata` / `outbox-contract` / `delivery-transition-contract` | 23/23, 22/22, 17/17, unchanged |
| `runtime-reference-locks` / `tenant-domain-operator-role` | 16/16 and 28/28 — **44/44** together |
| Access foundation / discovery / reader | 31/31, 4/4, 15/15 |
| Full backend unit suite | **969/971, 2 failed** — both pre-existing `spawnSync` timeout flakes; see below |
| Root shared suite | **64/64** |
| Migration apply → rollback refusal → rollback → reapply | verified, including that settled evidence survives |
| Typecheck, full lint, production build, test compile | clean |
| Changed-file formatting, documentation links, `git diff --check` | clean |

**The review-hardening pass (search_path refinement) was validated separately
and is reported separately.** It changed two test files and this document, and
nothing else: Migration 53, the bootstrap artifact, the grant artifact, the
local role mirror and the test helper are byte-identical to the reviewed state,
verified by SHA-256 before and after. Re-run after the hardening:
`worker-function-api-contract` **15/15**, `database-role-separation` on
PostgreSQL 17 **20/20**, `integration-worker-functions` **22/22**, typecheck
clean, `eslint` clean on both changed test files, `prettier --check` clean on
both changed test files, `git diff --check` clean apart from the pre-existing
repository-wide CRLF warnings. **A second full 969-test backend-unit run was
not repeated for this pass**, because it changes no `src/` file and no
migration; the previously reported broad-suite result stands as recorded below.

**The two full-suite failures, reported as failures.** `development-startup` and
`logging-sanitization` each drive a child process through `spawnSync` with a
fixed 60s and 10s timeout, and both exceed it under full-suite parallel load on
this host. Re-run in isolation they pass **9/9**. Neither file references
anything this slice changed — no migration, no `deploy/` artifact, no
integration module — and this slice modifies no `src/` file at all. **A
successful isolated rerun is supplemental evidence and does not rewrite the
failed full-suite invocation**, so the full-suite result stands as 969/971. No
timeout was raised and no assertion was weakened.

**Ten suites were not executed.** Nine database suites and one E2E suite assert
that `TEST_DATABASE_URL` points at a specifically provisioned
`/reqro_f0592_test` as `reqro_test_user`; the available URL is `/reqro_test` as
`reqro_dev_user`, so they fail their own environment guard before reaching any
assertion. **None of those files is modified here**, so this is a pre-existing
environment mismatch rather than a regression. They are reported as **not
executed, never as passed**; no credential was invented and no suite was
repointed at another database. The remaining E2E suites were not run because
this slice changes no `src/` file and no E2E suite references any integration
table.

One scheduling artifact worth recording: an early combined run of
`runtime-reference-locks` and `tenant-domain-operator-role` reported **2
skipped**, because `dockerAvailable()` timed out while the role-separation
cluster was still occupying Docker. The serial rerun executed and passed 44/44.
**A skip is not a pass**, which is why both numbers are given.

`docs/` is outside every repository format script — `server`'s covers
`{src,test,migrations}` and root-level files only — and the accepted F062.2D-1
and F062.2D-2A documents also fail a direct `prettier --check`. This document is
therefore left consistent with its peers rather than reformatted.

**Version caveat, reported rather than glossed:** the local `TEST_DATABASE_URL`
server is **PostgreSQL 18.6**, while the repository's authority is **17**
(`compose.yml`, and the role cluster's version gate refuses anything else). The
behavioural suite therefore runs on 18.6 locally; the role, ownership, membership
and privilege proofs run on **`postgres:17-alpine`** in the disposable cluster,
which is where the version-sensitive facts matter. Both measured probes used
17.11.

---

## 18. Remaining blockers

### Unresolved before a real worker may execute

> **These three are PRE-WORKER BLOCKERS. No real worker may execute against
> this API until each is separately reviewed and resolved. None of them is
> solved in F062.2D-2B, and none may be improvised at worker-activation
> time.**

**A. Claim lease and expired-claim recovery semantics.** There is no
`claimed_until` column, no approved lease duration, and no transmission record
that would distinguish an attempt which never reached a destination from one
that may already have been delivered. Every open attempt is therefore
externally ambiguous. `recover_expired_integration_claim` is deliberately not
implemented and not stubbed (§12). **Operational consequence:** an obligation
whose claimant dies stays `dispatching` with an open attempt indefinitely —
visible and stuck, never silently lost or silently retried. Resolution needs an
approved lease rule plus either a transmission record or an accepted
all-expiry-is-ambiguous rule.

**B. Per-aggregate serialization for ordered delivery.** F062.2D-1 §6 lists an
occupied in-flight slot for an aggregate among the claim's refusals, and that
refusal cannot be made atomic with the objects that exist: two claimants taking
different obligations for the same aggregate each see the other's uncommitted
state as absent, and there is no single row both of them lock. A best-effort
check would read as a guarantee it cannot provide, so **none is implemented**
(§10). Resolution needs a reviewed serialization point — an aggregate-scoped
lock row, an advisory-lock convention, or an accepted statement that delivery
order is not guaranteed.

**C. Retry and backoff eligibility for `retrying` obligations.** Claim
eligibility is restricted to `pending`. `retrying` is deliberately unclaimable:
no approved backoff schedule exists, and claiming it would produce an unbounded
hot retry loop against a destination that has already failed. `ambiguous` is
equally unclaimable, because resolving ambiguity is an operator's judgement, not
a worker's. **Operational consequence:** a `retrying` obligation is never
re-delivered by this API, so a transient failure is currently terminal until an
operator intervenes. Resolution needs reviewed retry/backoff semantics,
including where the next-attempt time is stored and who advances it.

### Resolved by the F062.2D-2B security/database review

- **The `search_path` refinement** (§4) — **APPROVED** as an
  implementation-driven refinement. `pg_catalog, public, pg_temp` is retained,
  conditional on the now-tested invariant that no untrusted principal holds
  `CREATE` on the application schema. A decision amendment to F062.2D-1 is
  still required before production worker activation, and a future hardening
  slice may remove `public` from the path.
- **Two functions rather than three** (§12) — **APPROVED.** Recovery stays
  deferred.
- **The withheld `credential_reference`** (§9) — **APPROVED.** The claim
  descriptor omits it until a reviewed dispatch path exists to use it.
- **No best-effort aggregate ordering** (§10) — **APPROVED.** Blocker B stands
  rather than being papered over.
- **`retrying` obligations stay unclaimable** (§8) — **APPROVED** until
  retry/backoff semantics are reviewed. Blocker C stands.

### Carried forward, unchanged

1. **Destination semantics in the connector snapshot** (F062.2D-0 §12) — blocks
   any real dispatch.
2. **Secret-manager decisions** — block the secret-resolution slice.
3. **The first destination's actual API documentation** — blocks any real
   connector.
4. **Bind-value logging suppression is a deployment requirement**, not
   something a function can enforce. `log_statement = 'all'` does not log bind
   values, but `log_min_duration_statement` with `log_parameter_max_length`
   does. The deployment must set `log_parameter_max_length = 0` for the
   worker's connections. **Nothing in this slice claims database logging
   suppression is enforced by these functions.**
5. **F062.2D-3** adds `reqro_integration_worker` and its `USAGE`/`EXECUTE`
   grants. Until then the API is unreachable by any login role.

---

## Related

- [F062.2D-1 — Worker identity and database function security decision](F062-2D-1-worker-identity-db-function-security-decision.md) — the decision this implements; §4/§9 record the approved refinement and narrowing, and the amendment still required
- [F062.2D-1A — Pending age, expiry and dead-letter policy](F062-2D-1A-pending-age-dead-letter-policy.md) — why age is absent and recovery is blocked
- [F062.2D-2A — Delivery attempt and fencing persistence](F062-2D-2A-delivery-attempt-fencing-persistence.md) — the schema these functions drive
- [F062.2D-0 — Delivery worker security and operational readiness](F062-2D-0-delivery-worker-security-readiness.md) — the fencing predicate and the missing destination semantics
- [F062.1 — Enterprise integration contracts foundation](F062-1-integration-contracts-foundation.md) — the authoritative state, outcome and category vocabularies
- [F062.2C — Transactional outbox and atomic enqueue](F062-2C-transactional-outbox-atomic-enqueue.md) — the intents a claim selects
- [ADR-027 — Platform operator bootstrap and recovery](../architecture/decisions/ADR-027-platform-operator-bootstrap-recovery.md) — the bootstrap model the role and schema belong to
- [ADR-024 — Transaction-time request authorization](../architecture/decisions/ADR-024-transaction-time-request-authorization.md) — the uncertain-result rule the fencing refusals rest on
