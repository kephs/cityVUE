# F060.3C-2d — Runtime reference-lock hardening (ADR-027)

Baseline `f6dbbf8122cebaf88a6168d9e4d1cd7487646351`, branch
`claude/runtime-reference-lock-hardening`.

Status established: **runtime reference-lock database primitives hardened.**

This is explicitly **not** "Reqro application database least-privilege
foundation complete", because owner/migration/runtime role separation is still
outstanding. **Production deployment remains unauthorized.**

## The problem this slice solves

PostgreSQL requires `UPDATE` privilege on at least one column of a row-locked
table. The runtime application takes `SELECT ... FOR SHARE` on reference tables
it never writes, so a least-privilege runtime role could not be granted what
the code needs without also receiving write authority over catalog routing and
staff metadata. F060.3C-2c-2 solved exactly this once, for `organization` in
the operator path; the runtime had it in six more places.

Six reference tables were row-locked but never written: `category`,
`department`, `division`, `staff_identity`, `operational_role` and
`work_group`. **None carries an immutability trigger**, so no column on them is
independently inert and a column-scoped `UPDATE` grant would confer a real
mutation — setting `status` to `inactive` would let the runtime disable
routing. Five of the six therefore move their locks into narrowly scoped
`SECURITY DEFINER` helpers. Category is the deliberate exception, documented
below.

Separately, `advance_access_revision` updates three database-maintained
columns of `organization_access_state` and is reached from AFTER triggers on
tables the runtime does write, so while it was `SECURITY INVOKER` the runtime
needed `UPDATE` on all three.

## Migration 49

Ordinal **`20261019000000`**, file
`server/migrations/20261019000000-harden-runtime-reference-locks.ts`. The next
free ordinal was reconfirmed immediately before editing. **Migrations 1–48 are
unchanged and byte-identical**, verified by `git diff` over
`server/migrations/` excluding `20261019`.

It creates eight functions, replaces two and adds one trigger:

| Object                                        | Kind                      |
| --------------------------------------------- | ------------------------- |
| `lock_active_category(uuid, uuid)`            | new, SECURITY DEFINER     |
| `lock_active_department(uuid, uuid)`          | new, SECURITY DEFINER     |
| `lock_department(uuid, uuid)`                 | new, SECURITY DEFINER     |
| `lock_active_division(uuid, uuid, uuid)`      | new, SECURITY DEFINER     |
| `lock_division(uuid, uuid, uuid)`             | new, SECURITY DEFINER     |
| `lock_staff(uuid, uuid)`                      | new, SECURITY DEFINER     |
| `lock_assignment_target(uuid, varchar, uuid)` | new, SECURITY DEFINER     |
| `protect_category_identity()`                 | new, **SECURITY INVOKER** |
| `advance_access_revision(uuid)`               | hardened to DEFINER       |
| `invalidate_access_revision()`                | hardened to DEFINER       |
| `category_identity_immutable`                 | new trigger               |

Every function it creates or replaces is `VOLATILE`, owned by the schema
owner, pins `search_path = pg_catalog, pg_temp` (except the invoker guard,
which needs none), fully schema-qualifies every application object, contains
no dynamic SQL, and has `REVOKE EXECUTE ... FROM PUBLIC` applied — ten revokes
in total.

**No role-specific `GRANT` appears in the migration.** Granting `EXECUTE` to a
runtime role belongs to the provisioning artifact in the following slice, and
Migration 49 must not be considered deployable to a separated-role environment
until those grants exist.

**SECURITY DEFINER total after Migration 49: 10** — one from Migration 48,
seven helpers, two hardened revision functions. `protect_category_identity` is
`SECURITY INVOKER` and is deliberately excluded; it reads and writes no table,
takes no lock and needs no elevated privilege.

No table, column, index or constraint is added or altered, and no data row is
touched.

## Final helper inventory — seven

```
lock_active_category(uuid, uuid)
lock_active_department(uuid, uuid)
lock_department(uuid, uuid)
lock_active_division(uuid, uuid, uuid)
lock_division(uuid, uuid, uuid)
lock_staff(uuid, uuid)
lock_assignment_target(uuid, varchar, uuid)
```

All return **boolean only**. Business values — routing identifiers, names,
display names — stay with the caller's ordinary `SELECT`, which observes the
row the helper pinned because row locks are scoped to the transaction rather
than to the function call. TypeScript wrappers live in
`server/src/database/reference-locks.ts`.

**Predicate preservation is the governing rule.** Each helper enforces exactly
the predicate its existing caller already relied on and nothing stronger. Two
call sites lock a reference row _without_ any status check, so `lock_department`
and `lock_division` deliberately carry no active-status requirement;
introducing one would be a new business rule. `lock_staff` does carry `active`,
because all three of its call sites already required it.

**`lock_category` was removed.** It was created in the first implementation
round for the default-assignment preflight (site 4). Once the Category decision
below was taken, routing one site through a helper would not have removed the
runtime's need for Category row-lock privilege — thirteen other sites still
lock the same table — so the helper bought nothing while adding a
`SECURITY DEFINER` function. Site 4 was reverted to its native `FOR SHARE`, and
Category has no existence-only helper.

`lock_assignment_target` dispatches over the closed `TargetType` union with a
**static branch per literal table** — no dynamic table identifier and no
dynamic SQL:

| `target_type` | Locked table              |
| ------------- | ------------------------- |
| `'staff'`     | `public.staff_identity`   |
| `'role'`      | `public.operational_role` |
| `'group'`     | `public.work_group`       |

Any other value raises `Unknown assignment target type` rather than returning
false, so a typo can never be read as "target unavailable".

## The Category decision

Category is locked at **sixteen** runtime sites. **Thirteen remain intact as
native `FOR SHARE`**, because they use Kysely's `OF`-alias form inside the
shared staff request scope, where the Category row is locked atomically
together with the Service Request and the Organization in one statement:

```
attachments/attachment.service.ts            request-answer.service.ts
catalog/issue-action.command.ts              request-communication.service.ts
internal-request-mutations.service.ts        request-contact.service.ts
issue-default-assignment.ts                  request-note.service.ts
public-request-contact.policy.ts             request-ownership.service.ts
staff-actions.service.ts                     request-tracking.service.ts (×2)
```

Converting them would replace an atomic multi-relation lock with a helper call
plus a narrowed `OF` clause in the hottest request paths. **Preserving that
atomic locking semantics was preferred over eliminating one tightly
constrained privilege.**

The consequence is accepted deliberately: the intended future runtime grant on
Category is **`UPDATE (id)` only**, purely to satisfy PostgreSQL's row-lock
privilege requirement. There is no table-level Category `UPDATE`, and **no
`UPDATE` on `name`, `status`, `department_id`, `division_id`, `display_order`,
`icon_key` or any other column** — all other Category updates remain
unauthorized for the runtime.

That privilege confers no authority because **Category identity is immutable in
the database**. `protect_category_identity()` refuses when
`NEW.id IS DISTINCT FROM OLD.id`, permits the same-value no-op PostgreSQL may
need to evaluate, and is attached as
`category_identity_immutable BEFORE UPDATE OF id ON public.category` — so it is
only consulted when a statement actually names the column, and every other
Category update path is unaffected. Ordinary Category fields were deliberately
**not** made immutable.

Before imposing the invariant, runtime, administration tooling, development
tooling, migrations and tests were searched exhaustively for any operation that
intentionally updates `category.id`. **There is none.** The only eight
`updateTable('category')` sites are tests setting `status`, `department_id` or
`division_id`; `BEFORE UPDATE OF id` would not even fire for them.

Two Category sites did change:

- **Site 1** (`admin-issue-creation.domain.ts` `lockCreationCategory`) uses
  `lock_active_category`, which locks the Category **and its Department** in one
  statement requiring both active — exactly the predicate that caller always
  had. Splitting it into two helper calls would have introduced a
  read-then-lock window that does not exist today.
- **Site 3** (`create-service-request.service.ts`) had its redundant
  existence-only lock **removed**; see below.

## Access-revision hardening — Design B

Both revision functions are now `SECURITY DEFINER`.

Design A — hardening `advance_access_revision` alone — was measured on
PostgreSQL 17.11 and found **insufficient**. A plpgsql call to another function
is permission-checked against the effective user, so with the calling trigger
function left `SECURITY INVOKER` the call failed with
`permission denied for function advance_access_revision`. The F060.3C-2c-3
finding that firing a trigger does not check `EXECUTE` applies to the trigger
function itself, not to functions it calls.

Hardening both removes the requirement entirely:

- the runtime receives **no direct `EXECUTE`** on either function — `EXECUTE` is
  revoked from `PUBLIC` and granted to no role;
- the runtime receives **no `UPDATE` on `authorization_revision`,
  `mutation_txid` or `updated_at`**;
- the only intended direct runtime mutation of that table is
  **`UPDATE (bootstrap_established)`**, which the application genuinely
  performs, and which also satisfies every row lock on the table — including
  the four taken inside `SECURITY INVOKER` trigger functions.

Behaviour is preserved verbatim: the same increment, `mutation_txid` stamp,
`updated_at` stamp, trailing serialization lock and `pg_trigger_depth()=0`
refusal. Two independent barriers still block direct abuse —
`advance_access_revision` raises at depth 0, and `protect_access_state` raises
at depth 1 for the maintained columns.

`invalidate_access_revision` is safe to harden because it is a **pure
dispatcher**: it compares the trigger's own `to_jsonb(old)`/`to_jsonb(new)`
images in memory, derives the affected Organizations and calls the function
above. It reads and writes no table. **It must remain a pure dispatcher** — any
table access added to it in future would execute with owner privileges.

`advance_access_revision` has exactly one caller, reached through seven AFTER
triggers, of which the runtime writes four carrier tables: `organization`
(status), `role`, `role_permission` and `staff_role_assignment`.

## Removed locks

Three, all approved and each resting on an invariant that survives without it.

**Category, site 3 — `create-service-request.service.ts`.** The selected
identifier was discarded, so the query asserted only that the Category still
existed. Referential integrity already guarantees that, through a chain rather
than a direct reference — and the first version of this record stated that
wrongly, so it is stated precisely here: `service_request` has **no direct
foreign key to `category`**. Its key is
`(organization_id, category_id, service_definition_id) → service_definition`,
and `service_definition` in turn references `category(organization_id, id)`.
The insert therefore takes its implicit `FOR KEY SHARE` on the
`service_definition` row, and the Category behind it cannot be deleted while
any `service_definition` references it.

**Resident Experience review request and review decision.** Single use is
already enforced by two unique partial indexes —
`resident_approval_consumed on resident_experience_event(organization_id,
review_decision_id) where operation='published'` and
`resident_publication_transition on (organization_id, resource_revision) where
operation='published'`. The path still locks the resource row
(`organization_resident_experience`) `FOR UPDATE` and still checks its expected
revision, which serializes concurrent publications of the same resource.

A **stronger** invariant was then found by the tests rather than by reading
migrations: both review tables carry `resident_review_immutable`, a
`BEFORE UPDATE OR DELETE` trigger running `protect_resident_history()`, which
raises `Resident experience history is immutable` unconditionally with no
conditional and no return path. The rows are database-enforced immutable, so
removing the `FOR UPDATE` locks could not have excluded a writer — no writer is
possible.

Publication business rules and expected-revision behaviour are unchanged; only
the lock clauses were dropped.

## Concurrency evidence — PostgreSQL 17.11, two sessions

`server/test/database/runtime-reference-locks.integration.test.ts`, on a
disposable cluster the suite owns, with a genuinely constrained non-owner role.
Blocking is proven by a deterministic 900 ms `lock_timeout` on the competing
session rather than by waiting.

| Scenario                                         | Competing mutation                         | Result                                  |
| ------------------------------------------------ | ------------------------------------------ | --------------------------------------- |
| Category + Department (site 1 helper)            | `update category set status='inactive'`    | **blocks**, then proceeds once released |
| `department`                                     | `update department set status='inactive'`  | **blocks**, then proceeds               |
| `division`                                       | `update division set status='inactive'`    | **blocks**, then proceeds               |
| `staff_identity`                                 | `update staff_identity set active=false`   | **blocks**, then proceeds               |
| `operational_role`                               | `update operational_role set active=false` | **blocks**, then proceeds               |
| `work_group`                                     | `update work_group set active=false`       | **blocks**, then proceeds               |
| native Category `OF` lock, constrained privilege | `update category set status='inactive'`    | **blocks**                              |

Concurrent publication after the review-row lock removal is evidenced by the
two unique partial indexes plus the unconditional immutability guard above,
asserted from the catalog and from the guard's own body. Driving the whole
publication service concurrently belongs to its own suite; that is stated in
the test rather than implied.

The Category constrained-role proof, with only `SELECT` plus `UPDATE (id)`:
single-relation `FOR SHARE` succeeds; the three-relation `FOR SHARE OF` form
succeeds; `has_table_privilege(…,'UPDATE')` is false while
`has_column_privilege(…,'id','UPDATE')` is true; every other column is
non-updatable, asserted as a complement over `pg_attribute` so a new column is
covered without being named; changing the ID is refused by the trigger;
`set id=id` leaves a whole-table content digest identical; and `status`, `name`,
`department_id`, `division_id`, `display_order`, `icon_key`, `DELETE` and
`TRUNCATE` are all privilege-refused.

One stated deviation: the three-relation proof uses
`FOR SHARE OF definition, category, organization` rather than
`request, category, organization`, because building a valid `service_request`
fixture requires a long chain of `NOT NULL` columns unrelated to the privilege
question. The locking mechanics and the privilege check are identical —
`service_definition`, like `service_request`, carries a genuine runtime
`UPDATE` grant.

## Scanner defects, recorded honestly

Three variants of one blind spot, all mine, all found during implementation
rather than during assessment.

**Cross-function `OF`-alias sites were originally missed.** The F060.3C-2d-A
assessment reported three Category lock sites. There are sixteen. The thirteen
it missed apply `forShare(['request', 'category', 'organization'])` to a query
head built in a _different_ function, `staffRequestScope`. The scanner searched
backwards for `selectFrom` only within the same 60-line window, found none,
produced `unresolved(category)` and then **silently dropped the site**. The
privilege model it derived was wrong for one table.

**`role` was wrongly placed in the lock inventory.** The literal `'role'` in
`type === 'role' ? 'operational_role' : ...` is a discriminant value that
resolves to `operational_role`, but it is also a real table name, so a
dynamic-resolution heuristic accepted it. `role` is never locked by the
runtime; every `selectFrom('role')` in the repository is development or UAT
tooling. The proposed `UPDATE (access_creation_txid) ON role` privilege was
withdrawn as a result.

**The interpolated resident-history trigger was originally missed.**
`resident_review_immutable` is created inside a `for` loop using
`sql.table(table)`, so no literal `on <table>` text exists to grep. The
migration scan therefore reported the review tables as having only
`BEFORE INSERT` guards when they are in fact fully immutable.

Two rules now hold, enforced by
`server/test/unit/runtime-reference-lock-boundary.test.ts`:

1. aliases are resolved across the **whole runtime**, not per function;
2. an unresolved alias is a **test failure**, never a dropped site.

The Category inventory is asserted by **complete equality** — keyed by file
with a per-file count, so an unrelated edit above a lock does not break it
while a new or removed lock does — rather than by a forbidden-token scan. The
helper inventory, the Migration 49 function surface, the revoke set, the
absence of `role`, and the single designed lock-only column privilege are all
equality assertions too.

## Rollback coupling — two dependencies, both explicit

**Migration 49 rollback is not an isolated change.**

**Category.** Once runtime provisioning grants `UPDATE (id) ON public.category`,
that privilege is safe only while `protect_category_identity` exists. Rolling
back Migration 49 drops the trigger and function, which would leave the runtime
able to **mutate Category identity** — repointing a Category to another UUID,
bounded only by foreign keys. Migration 49 rollback and removal of the Category
column grant must therefore be coordinated.

**Access revision.** Rolling back restores `SECURITY INVOKER` revision
functions, which again require the runtime to hold `UPDATE` on
`authorization_revision`, `mutation_txid` and `updated_at`. A runtime role
holding only `UPDATE (bootstrap_established)` would then **fail** every
access-revision-triggered workflow — role creation, permission edits and
assignment changes.

Both point the same way: **Migration 49 rollback and the corresponding
runtime-grant rollback are one operational change.** Roll back both together,
or neither.

**ACL representation limitation, retained.** Rollback restores the _effective_
pre-49 `PUBLIC EXECUTE` on both revision functions, asserted behaviourally.
It cannot return `proacl` to literal `NULL`: once an ACL is explicitly
manipulated PostgreSQL stores an explicit entry, and `NULL` means "never
touched". This is not described as byte-identical restoration. It does not
block the migration.

## Validation record

| Suite                                                                             | Result                       |
| --------------------------------------------------------------------------------- | ---------------------------- |
| Migration 49 PG17 integration                                                     | **16/16** (15 subtests)      |
| Operator-role PG17 (F060.3C-2c-3)                                                 | **28/28**                    |
| Full serial disposable PostgreSQL                                                 | **790/790**, nothing skipped |
| API E2E                                                                           | **80/80**                    |
| Backend units                                                                     | **662/662**                  |
| Runtime reference-lock boundary                                                   | **8/8**                      |
| F060.3C-2c-1 operator boundary                                                    | **13/13**                    |
| F060.3C-2a attribution                                                            | **9/9**                      |
| Shared                                                                            | **64/64**                    |
| typecheck, lint, build, test compile, changed-file formatting, `git diff --check` | passed                       |

Every failed invocation is preserved. The Migration 49 suite reached 16/16
after rounds of **11/5**, **10/6**, **11/5** and **10/6**; the boundary suite
after one **7/8**.

**Defects, all mine.** A backtick inside a SQL comment terminated the
TypeScript template literal — the same trap as Migration 47. Three fixture gaps
(`category.icon_key`, an invalid `availability` value, and
`service_definition_version.anonymous_reporting_policy`). A line-number-based
inventory assertion, replaced with a stable per-file one. A case-sensitive
`pg_indexes` regex. A **string-replacement restore** in the concurrency loop,
replaced with explicit per-scenario restores. A **destructive foreign-key probe
running in autocommit** that deleted the Category and then failed two unrelated
subtests, now wrapped in a transaction that always rolls back. And an
inaccurate foreign-key claim written into source, corrected.

**Two regressions I introduced and fixed.** 87 failures in
`request-audience.integration.test.ts` and one in
`issue-handling.integration.test.ts`, because per-test schemas lacked the
Migration 49 helpers — migrations compile into the test output only when a test
imports them statically, so Migration 49 is applied as text, exactly as
Migration 48 is. Fixed with `server/test/helpers/runtime-reference-locks.ts`.
Then `function "advance_access_revision" already exists with same argument
types`, because applying the whole migration into a schema that had not yet run
migration `20261008000000` _created_ the revision pair rather than replacing
it, and that migration's own plain `create function` then collided. Fixed by
splitting the applier into `applyRuntimeReferenceLocks` (the seven helpers and
the Category guard) and `applyAccessRevisionHardening` (the revision pair). An
untyped `varchar` parameter also received an explicit `::varchar` cast.

All database and end-to-end work used `reqro_f0592_test` as `reqro_test_user`,
serially with `--test-concurrency=1`, through a runner that refuses to spawn if
any child value names `reqro_dev`. `reqro_dev` was never accessed.
`server/.env.test.local` was read by splitting on the first `=` only, no value
was printed, and the file was deleted afterwards; it remains ignored, untracked
and absent from all history.

## What this slice does NOT establish

No database role was created, no grant was applied anywhere, and no
provisioning occurred. Not implemented: `runtime-role.sql`,
`bootstrap-roles.sql`, `MIGRATION_DATABASE_URL`, migration `SET ROLE`,
`compose.yml` role separation, `TEMPORARY` revokes, default privileges and
runtime database credentials. Those remain the following F060.3C-2d
runtime/migration-role slice.

The F060.3C-2c-3 operator boundary is untouched: `deploy/database/operator-role.sql`
is unmodified, Migration 48 is unchanged, the operator holds `EXECUTE` on none
of the new helpers, the runtime reaches no `tenant_domain*` table, and
Migration 49 references no tenant-domain object.

Status: **runtime reference-lock database primitives hardened.** Not
"Reqro application database least-privilege foundation complete".
**Production deployment remains unauthorized.**

## Files changed

| File                                                                        | Change                                                   |
| --------------------------------------------------------------------------- | -------------------------------------------------------- |
| `server/migrations/20261019000000-harden-runtime-reference-locks.ts`        | **new** — Migration 49                                   |
| `server/src/database/reference-locks.ts`                                    | **new** — seven typed helper wrappers                    |
| `server/test/helpers/runtime-reference-locks.ts`                            | **new** — two per-schema appliers                        |
| `server/test/unit/runtime-reference-lock-boundary.test.ts`                  | **new** — complete-inventory lock boundary, 8 assertions |
| `server/test/database/runtime-reference-locks.integration.test.ts`          | **new** — PG17 proof, 15 subtests                        |
| `server/src/admin/admin-issue-creation.domain.ts`                           | site 1 and 2 via helpers                                 |
| `server/src/service-request/create-service-request.service.ts`              | site 3 lock removed                                      |
| `server/src/service-request/internal-request-mutations.service.ts`          | sites 5–8 via helpers                                    |
| `server/src/service-request/issue-default-assignment.ts`                    | site 16 via helper; site 4 native                        |
| `server/src/service-request/request-note.service.ts`                        | site 13 via `lockStaff`                                  |
| `server/src/service-request/request-communication.service.ts`               | site 14 via `lockStaff`                                  |
| `server/src/service-request/request-tracking.service.ts`                    | site 15 via `lockStaff`                                  |
| `server/src/service-request/request-ownership.service.ts`                   | site 17 via `lockAssignmentTarget`                       |
| `server/src/resident-experience/resident-experience.publication.service.ts` | sites 11 and 12 locks removed                            |
| `server/test/database/request-audience.integration.test.ts`                 | applies the helpers into its schema                      |
| `server/test/database/issue-handling.integration.test.ts`                   | applies the helpers into its schema                      |
| `docs/features/F060-3C-2D-runtime-reference-lock-hardening.md`              | **new** — this record                                    |
| `docs/security/SECURITY_FRAMEWORK.md`                                       | runtime reference-lock posture                           |

## Recommended next step

F060.3C-2d runtime/migration/owner role separation: the four-role topology,
`MIGRATION_DATABASE_URL`, migration `SET ROLE`, the bootstrap and runtime grant
artifacts, and the narrow production revokes. That slice is where the
`UPDATE (id) ON category` and `UPDATE (bootstrap_established)` grants this
design depends on are actually issued, together with the rollback coupling
recorded above.
