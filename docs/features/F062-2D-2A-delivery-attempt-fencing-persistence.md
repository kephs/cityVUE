# F062.2D-2A — Delivery attempt and fencing persistence

Baseline `3ca345490442e18f13111ac88553996d6bc1ba8a` (authoritative `main`, carrying [F062.2D-1A pending-age policy](F062-2D-1A-pending-age-dead-letter-policy.md) and [F061.3A worker telemetry contracts](F061-3A-integration-worker-observability-contracts.md)).

> **NO WORKER RUNS IN F062.2D-2A.**
> **NO EXTERNAL DESTINATION IS CONTACTED.**
> **NO AGE-BASED AUTOMATIC DEAD-LETTER TRANSITION EXISTS.**

**Status: implemented, pending review.** One migration, one F062.1 contract addition, schema types, two test suites and this document. There is **no worker, no polling loop, no claim function, no lease recovery, no transport, no HTTP client, no connector adapter, no secret-manager access, no destination credential, no operator API, no PIM execution, no worker LOGIN role, no worker grant, no function-owner role, no Entra database authentication, no F061 runtime instrumentation, no telemetry exporter, no broker and no queue outside PostgreSQL.** Migration count moves 51 → 52. **No ADR number is allocated.**

## Schema introduced

**Ordinal 52 — `server/migrations/20261022000000-add-integration-delivery-attempt.ts`.**

### `integration_delivery_attempt`

| Column                             | Type                                              | Reviewed requirement it maps to                                               |
| ---------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `id`                               | `uuid pk default gen_random_uuid()`               | identity                                                                      |
| `organization_id`                  | `uuid not null`                                   | F062.2D-0 §4 tenancy                                                          |
| `integration_outbox_id`            | `uuid not null`                                   | the obligation attempted                                                      |
| `integration_connector_id`         | `uuid not null`                                   | F062.2A §4 — retired-connector evidence must stay attributable without a join |
| `attempt_number`                   | `integer not null check (> 0)`, database-assigned | F062.2D-0 §4 ordinal                                                          |
| `claim_generation`                 | `bigint not null check (> 0)`, database-assigned  | F062.2A §5 fencing generation                                                 |
| `claim_token_digest`               | `char(64) not null check (~ '^[0-9a-f]{64}$')`    | F062.2D-1 §14 — **digest only**                                               |
| `connector_configuration_revision` | `integer not null check (> 0)`                    | F062.2D-0 §9.2 — semantics pinned per attempt                                 |
| `capability_snapshot`              | `jsonb not null`, bounded by check                | F062.2D-0 §4 — the decisive retry-safety inputs, recorded not reconstructed   |
| `started_at`                       | `timestamptz not null default clock_timestamp()`  | F062.2A — evidence exists **before** the network call                         |
| `completed_at`                     | `timestamptz`                                     | null while open                                                               |
| `outcome`                          | `varchar(18)`, F062.1 `attemptOutcomes`           | null while open                                                               |
| `failure_category`                 | `varchar(28)`, F062.1 taxonomy                    | bounded failure class                                                         |
| `mutation_txid`                    | `bigint not null default txid_current()`          | repository evidence convention (10 migrations)                                |

**Deliberately absent, each for a reason rather than an oversight:**

| Field                                                                                                    | Why not now                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reason_code`                                                                                            | F062.2A §8.1 designed the taxonomy, but it has **no TypeScript authority yet**, nothing in this slice can write it, and committing a ~30-value DB-only vocabulary would create exactly the drift §2 forbids. It arrives with the settle function that classifies outcomes, alongside its TS source |
| `retry_eligible`, `response_classification`, `external_reference`, `idempotency_key_hash`, `duration_ms` | All belong to the settle path, which does not exist. F062.2D-2A §3: no field merely because queue systems have one                                                                                                                                                                                 |
| `claimed_until` (lease)                                                                                  | Lease duration is provisional and unresolved (F062.2D-0 §6); the recovery path that reads it is a later slice                                                                                                                                                                                      |
| Any pending-age field or threshold                                                                       | F062.2D-1A deferred the age edge entirely                                                                                                                                                                                                                                                          |

### Contract addition — `deliveryStateTransitions`

`server/src/integration/delivery-contract.ts` gains the **non-age transition table as data**, plus `mayTransitionDeliveryState()` and `transitionCapabilityPreconditions`. This is the one production-code change, and it is a contract declaration with no runtime behaviour.

It was necessary because **F062.1 had no transition table** — only the state vocabulary — so a parity test had no authority to compare SQL against. F062.2A §22.1 had already approved the shape: _"declare the allowed `(from, to)` pairs as data in one place the test can import."_ F062.1's module graph is unchanged, and its boundary suite still passes **39/39**.

## Invariant mapping

| Invariant                                            | Enforced by                                                              | Where            |
| ---------------------------------------------------- | ------------------------------------------------------------------------ | ---------------- |
| Tenant-safe attempt → obligation                     | composite FK `(organization_id, integration_outbox_id)`                  | schema           |
| Tenant-safe attempt → connector                      | composite FK `(organization_id, integration_connector_id)`               | schema           |
| At most one open attempt                             | partial unique index `integration_attempt_open`                          | schema           |
| Ordinal unique per obligation                        | `unique (organization_id, integration_outbox_id, attempt_number)`        | schema           |
| Generation unique per obligation                     | `unique (organization_id, integration_outbox_id, claim_generation)`      | schema           |
| Open ⇔ settled coherence                             | four biconditional checks on `outcome`/`completed_at`/`failure_category` | schema           |
| Digest shape                                         | `char(64)` + hex pattern                                                 | schema           |
| Capability snapshot bounded                          | key-stripping check + typed value domains                                | schema           |
| Created open                                         | `guard_integration_delivery_attempt()` INSERT branch                     | trigger          |
| Ordinal and generation monotonic                     | computed in the guard; races lose on the unique constraints              | trigger + schema |
| Attempt pins its obligation's connector and revision | guard INSERT branch                                                      | trigger          |
| Complete-once, settled immutable                     | guard UPDATE branch                                                      | trigger          |
| Never deleted or truncated                           | guard DELETE/TRUNCATE branch                                             | trigger          |
| Non-age state transitions                            | `guard_integration_outbox()` UPDATE branch                               | trigger          |
| Intent identity and semantics immutable              | same guard, 19 compared columns                                          | trigger          |

## Tenant isolation

The composite foreign keys make `(organization_id, integration_outbox_id)` the referent, so an attempt in Organization A **cannot** name B's obligation: the row would have to carry B's `organization_id`, at which point it is B's row. Proven by direct insert attempt, with nothing written.

The guard adds a second, independent check — the obligation must be found _by the pair_ — so the refusal is legible (`requires an obligation owned by its Organization`) rather than a bare FK violation. **No application filtering is relied upon.**

## One open attempt

```sql
create unique index integration_attempt_open
  on integration_delivery_attempt (organization_id, integration_outbox_id)
  where completed_at is null;
```

This is the invariant that makes the open attempt **canonically the current claim**, and it is what makes "settle the existing attempt" the only reachable recovery rather than a judgement call — inventing a second open attempt is a constraint violation. Proven by two parallel inserts where exactly one applies, and by a sequential third that is refused.

## Claim generation

> **`attempt_number` and `claim_generation` are distinct, and both are kept.**

`attempt_number` answers _which attempt is this for the obligation_. `claim_generation` answers _which claim owns it_. They advance together today because each claim creates exactly one attempt — so the distinction is semantic rather than numeric at present.

They are kept separate because a future **lease renewal or re-claim of an existing attempt** would advance ownership without creating an attempt, and conflating the two would then force a choice between fabricating an attempt row and breaking fencing. Both are database-assigned (`coalesce(max(...), 0) + 1` inside the guard), so a caller cannot choose either; a concurrent race loses on the unique constraints rather than producing a duplicate.

**A refinement of F062.2A's sketch:** that assessment placed `claim_generation`, `claim_token` and the lease on `integration_outbox`; F062.2C deferred all of them. On reflection the attempt is the better home, because the one-open-attempt index already makes the open attempt the canonical claim, and storing ownership in two places would create two values that can disagree. A welcome consequence: **this migration adds no column to `integration_outbox`**, so it is trivially safe for existing rows.

## Digest-only token persistence

The raw token is generated by the future worker, lives only in its memory, and will be supplied as a **bind parameter** to the settle function. Nothing here generates a token and **no function returns one** — F062.2D-1 §14's refinement.

Storage is `char(64)` constrained to `^[0-9a-f]{64}$`, which is SHA-256 hex. A truncated, upper-cased, non-hex or over-long value cannot be stored. The exact hashing call belongs to the settle function (a later slice); what is fixed here is the **storage invariant**.

**Proven by test:** the only token-named column anywhere in the four integration tables is `claim_token_digest`, asserted from `information_schema.columns`; five malformed digests are refused; and a source test asserts the migration contains no `gen_random_bytes`, no `random()` and no `claim_token` column.

## Complete-once

An attempt is created **open** and settles **at most once**:

- INSERT must be open — a pre-settled insert is refused;
- UPDATE is permitted **only** as open → settled;
- **UPDATE of a settled row raises**, so a settled outcome cannot be rewritten, `completed_at` cannot be cleared, and claim identity cannot be replaced;
- DELETE and TRUNCATE raise.

Nine distinct rewrite attempts on a settled row are tested individually and all refused, with the row verified unchanged afterwards.

### Trigger ownership and `search_path`

The guards are **`SECURITY INVOKER`**, which is the established convention for integrity guards in this repository (migrations 45–51) and is correct here: a guard enforcing integrity needs no authority beyond the caller's, and `SECURITY DEFINER` would grant some. §8's "unless genuinely required" is not met.

Object references are therefore left **unqualified**, matching every existing guard — which is what keeps the schema portable for the disposable-schema test harness, since qualifying `public.` would break tests that run in a generated schema. The residual `search_path` exposure is relation shadowing via `pg_temp`, and **the bootstrap already revokes `TEMPORARY` on the database from `PUBLIC`**, so no role in the topology can plant a decoy relation. The hardened `SECURITY DEFINER` pattern of Migration 49 (`pg_catalog, pg_temp` with full qualification) remains correct for the **worker-facing** API, which this slice does not implement.

## Allowed non-age state transitions

Declared in F062.1 and mirrored in SQL:

| From                                                           | To                                                                                                                         |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pending`                                                      | `dispatching`, `refused`                                                                                                   |
| `dispatching`                                                  | `accepted`, `retrying`, `ambiguous`, `failed_permanent`, `dead_lettered`                                                   |
| `retrying`                                                     | `dispatching`, `dead_lettered`                                                                                             |
| `accepted`                                                     | `acknowledged` — **only** where the pinned snapshot declares `reportsTerminalState`                                        |
| `ambiguous`                                                    | `dispatching` — **only** where it declares `supportsIdempotencyKey` — plus `accepted`, `failed_permanent`, `dead_lettered` |
| `acknowledged`, `failed_permanent`, `dead_lettered`, `refused` | **nothing**                                                                                                                |

Both capability preconditions are read from the **connector snapshot the intent pinned**, never the connector's current row — F062.2D-0 §9.2, so a later configuration change cannot retroactively authorise an acknowledgement or a blind retry.

**`dead_lettered` has no outgoing edge.** F062.2A requires an authorized replay to carry audit evidence in the same transaction, and no replay-authorization record exists yet; enabling `dead_lettered → pending` before it would permit an **unaudited** replay to a live external system. Deferred to the operator/replay slice.

## What remains deferred

| Deferred                                                                                        | To                            | Blocked on                                                                                      |
| ----------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| Age-based automatic dead-letter                                                                 | a policy-implementation slice | numerical bounds, configuration ownership, maintenance/worker-outage handling (F062.2D-1A §29)  |
| `claim_integration_intent`, `complete_integration_attempt`, `recover_expired_integration_claim` | F062.2D-3 / 2D-4              | the worker identity, the `reqro_integration_api` schema and the function-owner role (F062.2D-1) |
| Worker role, grants, function owner, dedicated schema                                           | F062.2D-3                     | this persistence layer's review                                                                 |
| `dead_lettered → pending` replay                                                                | the operator slice            | replay-authorization evidence                                                                   |
| Lease and recovery                                                                              | 2D-4                          | provisional lease duration                                                                      |
| `reason_code`                                                                                   | the settle slice              | its TypeScript authority                                                                        |
| Worker polling index                                                                            | the claim-function slice      | the exact query, once reviewed                                                                  |

**No worker-facing SECURITY DEFINER function was required to make the schema correct**, so none was implemented and no stop-and-report was needed. The fencing predicate of F062.2D-0 §14 is enforceable atomically once that function exists: identity and open-ness are schema invariants, generation and digest are columns, and prior settlement is the complete-once guard. **Enforced now:** identity, open-ness, one-open, generation uniqueness, digest shape, complete-once. **Deferred:** the raw-token hash comparison, which needs the function.

## Privilege posture

**No grant, no role, no membership and no privilege change.** `deploy/database/bootstrap-roles.sql`, `runtime-role.sql` and `operator-role.sql` are untouched, and no `integration-worker-role.sql` exists.

| Principal       | Gains                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC`        | **nothing** — asserted from `information_schema.role_table_grants`                                                                                               |
| `reqro_runtime` | **nothing** — the bootstrap issues **no default privileges**, asserted by `pg_default_acl` being empty, so a new table is unreachable until granted deliberately |
| Any new role    | **none exists**                                                                                                                                                  |

The migration itself contains no `grant`, `revoke`, `create role`, `alter role` or `create schema`, asserted by source test. `database-role-separation` passes **17/17**, confirming the canonical runtime matrix is unchanged and the new table does not appear in it.

## Migration and rollback behaviour

| Step                             | Result                                                                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apply                            | creates one table, two indexes, one guard function, two triggers; drops `integration_outbox_state_inert` **by name**; replaces `guard_integration_outbox()` with the transition machine |
| Rollback with attempt evidence   | **refused** — `Retained integration delivery attempt evidence prevents rollback`                                                                                                        |
| Rollback with a moved obligation | **refused** — the previous schema version pins state to `pending`, so rolling back under a moved obligation would leave an invalid row                                                  |
| Rollback when clean              | drops **only** this migration's table and function; restores `guard_integration_outbox()` verbatim and re-adds `integration_outbox_state_inert`                                         |
| Reapply                          | schema usable again; attempts open and transitions apply                                                                                                                                |

**The inert guard is replaced, not layered.** F062.2C's `integration_outbox_state_inert` constraint and its refuse-every-UPDATE guard are both named explicitly, and `down()` restores both — verified by asserting the constraint exists again _and_ that a transition is refused with the original message.

**Existing rows are safe:** no column is added to any existing table, so nothing requires a default or a backfill, and **no synthetic attempt history is created** — asserted by rolling back, enqueuing more obligations under the old schema, reapplying, and confirming all remain `pending` with zero attempts.

## Concurrency validation

| Required proof                                       | Result                                                                                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A.** Two attempts race to become open              | **exactly one applies**; one row exists; a third sequential attempt refused                                                                                      |
| **B.** Stale generation settles after a newer exists | **zero rows settled**; the newer generation stays open; the recovered attempt keeps its `ambiguous` outcome                                                      |
| **C.** Second settlement                             | **refused** — settled attempt immutable                                                                                                                          |
| **D.** Tenant-crossed obligation reference           | **refused**, nothing written                                                                                                                                     |
| **E.** Terminal fields rewritten                     | **nine attempts, all refused**, row unchanged                                                                                                                    |
| **F.** Invalid transition                            | **refused** — exhaustive sweep of all **81** ordered pairs                                                                                                       |
| **G.** Legal non-age transition                      | **accepted**                                                                                                                                                     |
| **H.** Ambiguous unchanged by time                   | an obligation aged 400 days stays `pending`; an `ambiguous` one stays `ambiguous`; and **no constraint anywhere references `interval`, `age(` or `pending_age`** |

All deterministic — no sleeps. State that the whitelist cannot reach is established by a documented, test-only guard-disabled setup, never by an application path.

## Relationship to F062.2D-1 and F062.2D-1A

**F062.2D-1** decided the worker identity and the function-security contract. This slice deliberately implements **none** of it: no role, no `reqro_integration_api` schema, no `SECURITY DEFINER` worker API. Those belong to `reqro_integration_function_owner` in that schema, and implementing them here under a broader owner merely to make this slice easier was explicitly rejected. What this slice provides is the schema and integrity those functions will operate on.

**F062.2D-1A** decided the pending-age policy and split this slice precisely so the age edge could wait. That split is honoured exactly: the mechanism — attempt persistence, one-open, complete-once, fencing prerequisites, the non-age transition machine — is here; the age transition is not, and **no placeholder duration appears in SQL**.

One blocker that assessment reported is now **closed by F061.3A**: `integration_oldest_pending_age` exists, along with `integration_pending_count`, `integration_ready_count`, `integration_claim_count`, `integration_ambiguous_count` and the four worker health states. That was the release gate for a worker reaching a real destination; it is satisfied, and **F061 was not edited here**.

## Validation

| Gate                                                      | Result                 |
| --------------------------------------------------------- | ---------------------- |
| **`integration-delivery-attempt`** (new)                  | **18/18**, 0 skipped   |
| **`delivery-transition-contract`** (new)                  | **17/17**              |
| F062.1 `integration-contracts` + `integration-boundary`   | **39/39 unchanged**    |
| F062.2B `integration-connector`                           | 18/18                  |
| F062.2C `integration-outbox`                              | 14/14                  |
| `database-role-separation`                                | 17/17                  |
| `runtime-reference-locks` / `tenant-domain-operator-role` | 16/16 / 28/28          |
| `access-foundation` / `-discovery` / `-reader`            | 31/31 / 4/4 / 15/15    |
| **Full backend unit suite**                               | **948/948**, 0 skipped |
| Root shared suite                                         | 64/64                  |
| typecheck / full lint / build / test compile              | pass                   |
| new-file formatting / `git diff --check`                  | pass                   |
| Migration apply → rollback refusal → rollback → reapply   | pass                   |

**Three existing suites required an inventory update.** `database-role-separation`, `runtime-reference-locks` and `tenant-domain-operator-role` assert the compiled migration count, which adding a migration legitimately moves 49 → 50; the first also names the total in its title (51 → 52). Those three assertions were updated and nothing else in them was touched.

**Twelve suites were not executed** — a pre-existing environment mismatch, not a regression. They assert a specifically provisioned test database (`/reqro_f0592_test` as `reqro_test_user`) that the available `TEST_DATABASE_URL` does not point at, so they fail their own environment guard before running any assertion. The set is nine `database/` suites, `e2e/registry-tenancy`, and two `unit/tenant-domain-operator-*` suites. **None of those files is modified by this slice**, and the failing comparison reads the environment rather than anything added here. Reported as **not executed, never as passed**; no credential was invented and no database provisioned.

The remaining 15 E2E suites were not run: neither they nor `app.module.ts` reference any `integration_*` table, so schema loading does not affect them. `registry-tenancy` is the only E2E suite that applies migrations, and it is in the environment-gated set above.

## Related

- [F062.1 — Enterprise integration contracts foundation](F062-1-integration-contracts-foundation.md) — the state authority this mirrors
- [F062.2A — Transactional outbox persistence readiness](F062-2A-transactional-outbox-persistence-readiness.md) — the attempt and fencing design
- [F062.2B — Connector metadata persistence foundation](F062-2B-connector-metadata-persistence-foundation.md) — the pinned snapshot the gated edges read
- [F062.2C — Transactional outbox and atomic enqueue](F062-2C-transactional-outbox-atomic-enqueue.md) — the obligations attempted, and the inert guard replaced here
- [F062.2D-0 — Delivery worker security and operational readiness](F062-2D-0-delivery-worker-security-readiness.md) — the fencing and claim model
- [F062.2D-1 — Worker identity and database function security decision](F062-2D-1-worker-identity-db-function-security-decision.md) — the deferred worker API
- [F062.2D-1A — Pending age, expiry and dead-letter policy](F062-2D-1A-pending-age-dead-letter-policy.md) — the deferred age edge and this slice's boundary
- [F061.3A — Integration worker observability contracts](F061-3A-integration-worker-observability-contracts.md) — the metric concepts that closed the reported gate
- [ADR-026 — Outbound notification and delivery architecture](../architecture/decisions/ADR-026-outbound-notification-delivery-architecture.md) — the rule behind the `acknowledged` gate
