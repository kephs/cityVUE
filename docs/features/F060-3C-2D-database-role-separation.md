# F060.3C-2d — Owner / migration / runtime database role separation (ADR-027)

Baseline `43c9759781a99eaffd95f148269c18d6ce1d95d2`, branch
`claude/database-role-separation`.

Status established: **Reqro application database least-privilege foundation
complete.**

**This does not authorize production deployment.** The remaining blockers are
infrastructure, not database: per-human IAM with JIT elevation, a production
job runner, secret-manager integration, immutable off-host audit and log
retention, actual production database provisioning, and real domain, DNS, TLS
and edge configuration.

## What was wrong

Until this slice the reproducible environment collapsed the database owner, the
migration role and the runtime application role into **one superuser**:
`server/compose.yml` defined `POSTGRES_USER: cityvue`, which the entrypoint
always creates as a superuser, and `.env.example` pointed `DATABASE_URL` at it.
That single credential was simultaneously the DDL identity and the request-path
identity, and it owned every object it created. Every least-privilege control
built in F060.3C-2a through 2d-C sat on top of a role that could do anything.

## The four-role topology

| Role             | Login       | Attributes                                                  | Holds                                               |
| ---------------- | ----------- | ----------------------------------------------------------- | --------------------------------------------------- |
| `reqro_owner`    | **NOLOGIN** | `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS` | database, schema and every application object       |
| `reqro_migrate`  | LOGIN       | same, plus membership of `reqro_owner`                      | nothing of its own; assumes the owner to migrate    |
| `reqro_runtime`  | LOGIN       | same, no membership                                         | the canonical DML matrix and eleven function grants |
| `reqro_operator` | LOGIN       | same, no membership                                         | unchanged from F060.3C-2c-3                         |

`NOINHERIT` on `reqro_migrate` is the load-bearing choice. Measured on
PostgreSQL 17.11: without `SET ROLE` the migration login is **denied**
(`permission denied for schema public`), so a path that forgets to assume the
owner fails closed rather than creating objects owned by the login.

Also measured: the `NOLOGIN` owner cannot connect at all
(`role "reqro_owner" is not permitted to log in`); a member can assume it, and
`current_user` becomes the owner while `session_user` remains the migration
login, so ownership is uniform and the audit trail survives; and on a fresh
PostgreSQL 17 database schema `public` is owned by `pg_database_owner`, so
transferring database ownership carries the schema with it.

## Credential separation

`DATABASE_URL` stays the **runtime** credential. `MIGRATION_DATABASE_URL` is
the **migration** credential.

- The migration command refuses an absent `MIGRATION_DATABASE_URL` under
  `NODE_ENV=production` with the closed code `migration_url_missing`. There is
  **no production fallback** to the runtime credential.
- A development and test fallback exists, because local workflows and the
  disposable test database predate the split. It is reported through
  `dedicatedCredential: false` and the command prints a warning, so a degraded
  posture is visible rather than silent.
- The runtime **never reads** `MIGRATION_DATABASE_URL`. That is why the
  runtime's resolver lives in its own module, `src/config/runtime-connection.ts`,
  and the migration-side module stays out of the runtime graph: a boundary test
  walks the built runtime closure and fails if any module so much as mentions
  the variable outside a comment.
- Runtime code performs **no `SET ROLE`**, also asserted structurally over the
  runtime closure.

`REQRO_DATABASE_OWNER_ROLE` names the role migrations assume. It is validated
as a plain lower-case identifier before it reaches the `SET ROLE` statement, so
`reqro_owner; drop table category`, `"ReqroOwner"`, `REQRO_OWNER` and
whitespace-bearing values are all refused with `owner_role_invalid` rather than
escaped.

Five closed failure codes, mirroring the operator module's pattern so a job log
can alert on a code without the message carrying detail:
`migration_url_missing`, `migration_url_invalid`, `owner_role_invalid`,
`identity_mismatch`, `role_assumption_failed`.

## Migration SET ROLE behaviour

`npm run migration:up` now:

1. resolves `MIGRATION_DATABASE_URL` (fail-closed in production);
2. builds a **single-connection** pool, so no un-assumed connection can run
   DDL, with the deployment schema pinned;
3. reads `current_user`/`session_user` and refuses if the login **is** the
   owner — a login that is the owner would make the assumption meaningless and
   reintroduce standing DDL authority on a credential;
4. issues `SET ROLE <owner>`;
5. verifies `current_user = owner` **and** `session_user = login` **and** that
   the two differ;
6. only then applies migrations.

A source assertion pins the ordering: `assumeOwnerRole` is called before
`migrator.migrateToLatest()`.

## Search-path hardening extended

F060.3C-2c-3 measured that a connection-string `options` parameter
**overrides** an explicit `options` key in a pool configuration, which made the
operator CLI's pin defeatable. That hygiene now covers all three paths: the
runtime, the migration command and the operator CLI each strip an `options`
parameter from their URL before `databaseConnectionOptions` sees it, then pin
`REQRO_DEPLOYMENT_SCHEMA` with their own `options` key. TLS validation is
untouched — the same `databaseConnectionOptions` policy still applies, and
`verify-full` is still required in production.

## Provisioning artifacts

**`deploy/database/bootstrap-roles.sql`** — the only artifact that creates
roles. Parameterized by psql variables, repeatable (every step guarded, so a
rerun is a clean no-op), and **sets no password**: login secrets belong to
secret management, and a LOGIN role without one cannot authenticate, which is
the intended fail-closed state. It transfers database and schema ownership,
retains `CONNECT` for `PUBLIC`, revokes `TEMPORARY` and `CREATE`, introduces
**no default privileges**, and ends with a fail-closed block that refuses the
transaction if the topology is not exactly as intended — a logging-in owner,
any over-privileged or inheriting role, an unexpected membership, a
non-owner-owned object, a stray `CREATE`, a lost `CONNECT` or any
`pg_default_acl` row.

**`deploy/database/runtime-role.sql`** — the runtime grant surface, derived
from the canonical matrix and applied as `reqro_owner` after migrations. No
`GRANT ALL`, no `ON ALL TABLES`, no `ALTER DEFAULT PRIVILEGES`. Its own
fail-closed block refuses ownership, any `CREATE`, any role membership, a
table-level `UPDATE` on Category or access state, any updatable column beyond
the two authorized ones, any `TRUNCATE`, a `DELETE` outside the four permitted
tables, any `EXECUTE` on an owner-only or operator-only function, and any
default privileges.

**`server/deploy/local/01-roles.sql`** — development only, run from the Compose
entrypoint on first initialization. It provisions the same topology with
deliberately obvious development passwords, which is why it lives apart from
the production artifacts.

## Canonical runtime privilege matrix

**62 of 66 declared tables**, asserted by **equality in both directions** so a
missing grant and a surplus grant both fail, and a table added by a future
migration is covered without being named in a forbidden list. The four absent
tables are `permission` and the three operator-only control-plane tables.

Highlights, including every correction the five-technique cross-check produced:

| Class                                     | Tables                                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `SELECT` only                             | 11, including the five reference tables whose locks moved into Migration 49 helpers, and `tenant_domain`             |
| `INSERT` only (append-only, no read-back) | 7 audit tables                                                                                                       |
| `SELECT, INSERT`                          | 24, including `access_change_set`, `access_role_ownership`, `access_permission_delta`, `question`, `question_option` |
| `SELECT, INSERT, UPDATE`                  | 13, including `service_request_reference_sequence`, `issue_default_assignment`, `issue_requester_identity_policy`    |
| `SELECT, UPDATE`                          | `organization`                                                                                                       |
| with `DELETE`                             | exactly 4: `attachment`, `attachment_batch`, `role_permission`, `service_request_watcher`                            |
| `TRUNCATE`                                | **none, anywhere**                                                                                                   |

The eight corrections from F060.3C-2d-B are carried through and verified
against the catalog, not copied: three were found only by the raw-SQL scan,
three only by the upsert scan, and the rest by the trigger-body analysis.

## Runtime function grants — eleven

Four pre-existing business functions (`effective_access_managers`,
`resident_review_authorized`, `resident_review_contributors`,
`issue_name_key`) and the seven Migration 49 lock helpers. Signatures were
verified against the migration sources rather than assumed, which caught three
of my four initial guesses being wrong
(`resident_review_authorized(uuid, uuid, boolean)` not `(uuid, uuid)`,
`resident_review_contributors(uuid, uuid, uuid)`, `issue_name_key(text)` not
`varchar`).

Deliberately **not** granted, and asserted absent: `advance_access_revision`,
`invalidate_access_revision`, `tenant_domain_lock_organization`,
`protect_category_identity`, and every trigger function — firing a trigger does
not check `EXECUTE`, which F060.3C-2c-3 proved on PostgreSQL 17.

## The two constrained column grants

**`UPDATE (id) ON category`** exists purely to satisfy PostgreSQL's row-lock
privilege requirement at the thirteen native `OF`-alias lock sites, and confers
no authority: Migration 49's `category_identity_immutable` refuses any real
identity change. Proven under the real role — table-level `UPDATE` false,
`id` column `UPDATE` true, **every other column non-updatable asserted as a
complement over `pg_attribute`**, a real ID change refused by the trigger, the
same-value assignment leaving a whole-table content digest identical, and
`status`/`name`/`department_id`/`display_order`/`icon_key`/`DELETE` all refused
at the privilege layer.

**`UPDATE (bootstrap_established)` ON `organization_access_state`** is the only
direct runtime mutation of access state, and it also satisfies every row lock
on that table including the four taken inside `SECURITY INVOKER` trigger
functions. `authorization_revision`, `mutation_txid` and `updated_at` are
absent, and direct attempts on all three are refused.

The decisive proof that the hardening works end to end: **a role insert by the
runtime still advances `authorization_revision`**, through Migration 49's
hardened `SECURITY DEFINER` trigger chain, while the runtime holds no `UPDATE`
on the maintained columns and no `EXECUTE` on either revision function. A
direct `advance_access_revision(...)` call is refused.

## PUBLIC and default-privilege posture

Measured on PostgreSQL 17.11 after provisioning: `CONNECT` retained,
`TEMPORARY` revoked, `CREATE` on the application schema absent, and
`pg_default_acl` **empty**.

`REVOKE ALL ON DATABASE ... FROM PUBLIC` is never used — it would also remove
`CONNECT`. `EXECUTE` is not revoked globally: every pre-Migration-48 function
is `SECURITY INVOKER`, so `PUBLIC EXECUTE` confers no authority beyond the
caller's own privileges, and the eleven `SECURITY DEFINER` functions manage
their own `PUBLIC` posture in their migrations. No default privileges are
introduced anywhere, deliberately: a blanket default would hand the runtime
every future table, including future operator control-plane tables. A table
created by the owner after provisioning is proven unreachable by **both** the
runtime and the operator.

## PostgreSQL 17 validation

A new disposable five-identity cluster
(`server/test/helpers/role-separation-cluster.ts`), deliberately **separate**
from the operator harness rather than an extension of it: that harness gives
its owner `LOGIN` and applies SQL by connecting as the owner, which this
topology forbids, and both the operator suite and the Migration 49 suite depend
on it being exactly as proven. The new harness applies files as any login
with an optional assumed role, delivered through `PGOPTIONS='-c role=...'`,
which is how a file can be applied "as the owner" when the owner cannot log in.

`server/test/database/database-role-separation.integration.test.ts` — **17/17,
16 subtests, nothing skipped.** It proves: PostgreSQL major 17; the bootstrap
artifact establishing exactly the topology, idempotently; the `NOLOGIN` owner
refused at connection time; the migration login denied without `SET ROLE`;
all 49 migrations applied with `SET ROLE`, every application object and
function owned by the owner and `session_user` still the migration login; the
runtime and operator owning nothing and unable to `SET ROLE` to each other or
to the owner; both grant artifacts applying as the owner, idempotently; the
table matrix and the function surface by equality; the two constrained column
grants; the revision chain still advancing; the lock helpers working; DDL,
trigger disabling, `TRUNCATE`, role creation and `session_replication_role` all
refused; the operator boundary unchanged and mutually isolated; future-object
isolation for both roles; and the runtime credential unable to migrate.

## What the runtime capability proof does and does not cover

The integration suite exercises the **privilege surface** — the matrix by
equality, the lock helpers, the constrained column grants and the revision
chain — under the real constrained role. It does not boot Nest against the
cluster to drive every named workflow.

That is deliberate and stated rather than implied: service-level behaviour is
already covered by the 790-test disposable-PostgreSQL suite and the 80-test API
E2E suite, which both pass, and the question this slice must answer is whether
the privilege set is sufficient and bounded. Where a capability gap would show
up, it shows up as a missing grant in the equality assertion, not as a silent
pass. No privilege was added to make a failing workflow pass; the only
privileges added beyond the matrix were the three function-signature
corrections, each verified against the migration source.

## Operator regression

The F060.3C-2c-3 boundary is unchanged, asserted inside the new suite as well
as by rerunning its own suite:

- operator table surface exactly the eight reviewed entries across the four
  `tenant_domain*` tables;
- operator function surface exactly `tenant_domain_lock_organization(uuid)`;
- the runtime reaches **none** of the three operator-only control-plane tables
  and may only **read** `tenant_domain`;
- the operator reaches **no** application table outside `tenant_domain*`;
- the operator cannot execute a runtime lock helper;
- neither role can `SET ROLE` to the other;
- `deploy/database/operator-role.sql` is **not modified**.

## Local development

`server/compose.yml` keeps `postgres:17-alpine` and keeps the `cityvue`
bootstrap superuser for initialization and existing tooling, and now mounts
`deploy/local/01-roles.sql` into the entrypoint so a developer gets the same
separated topology. Recreating the volume re-provisions it. Existing
development CLIs, the `reqro_dev` workflows and the disposable
`reqro_f0592_test` database continue to work unchanged.

### Naming inconsistencies, recorded rather than renamed

The Compose database and bootstrap superuser are still `cityvue`; the
development database is `reqro_dev`/`reqro_dev_user`; the disposable test
database is `reqro_f0592_test`/`reqro_test_user`. These predate the `reqro_*`
role naming introduced here, and a repository-wide rename is deliberately out
of scope — AGENTS.md prohibits it without explicit instruction. Recorded here
so the inconsistency is a known decision rather than an oversight.

## Validation record

| Suite                                                                             | Result                       |
| --------------------------------------------------------------------------------- | ---------------------------- |
| Role separation PG17 (new)                                                        | **17/17**, 16 subtests       |
| Database role separation units (new)                                              | **11/11**                    |
| Migration 49 PG17                                                                 | **16/16**                    |
| Operator-role PG17 (F060.3C-2c-3)                                                 | **28/28**                    |
| Runtime reference-lock boundary                                                   | **8/8**                      |
| F060.3C-2c-1 operator boundary                                                    | **13/13**                    |
| F060.3C-2a attribution                                                            | **9/9**                      |
| Backend units                                                                     | **673/673**                  |
| Full serial disposable PostgreSQL                                                 | **807/807**, nothing skipped |
| API E2E                                                                           | **80/80**                    |
| Shared                                                                            | **64/64**                    |
| typecheck, lint, build, test compile, changed-file formatting, `git diff --check` | passed                       |

Failures preserved honestly. The role-separation suite reached 17/17 after one
**15/2** run: my function-owner assertion counted `pgcrypto`'s functions, which
belong to whichever identity installed the extension — the bootstrap admin —
rather than to the application owner. Fixed by excluding extension-owned
functions from the ownership assertion, the same exclusion the 2c-3 suite uses.

The configuration units reached 11/11 after one **8/2** run, and both failures
were informative. The runtime-graph scan correctly flagged that
`database-roles.ts` was in the runtime closure while containing the code that
reads `MIGRATION_DATABASE_URL`; rather than relax the assertion I split the
module, which is the stronger outcome. The artifact scan produced a false
positive by matching the substring `grant` inside `a.grantee` in a fail-closed
block; it now parses real `GRANT` statements. A third round fixed a
comment-stripping gap — the runtime module's own documentation explains why it
must not read the variable, which is not the same as reading it — and a
mangled `\\b` that had become a literal backspace in a regex.

Three function signatures I initially guessed were wrong and were corrected
against the migration sources before any test ran.

All database and end-to-end work used `reqro_f0592_test` as `reqro_test_user`,
serially with `--test-concurrency=1`, through a runner that refuses to spawn if
any child value names `reqro_dev`. `reqro_dev` was never accessed.
`server/.env.test.local` was read by splitting on the first `=` only, no value
was printed, and the file was deleted afterwards; it remains ignored, untracked
and absent from all history.

## Final review guards

Three guards were applied at checkpoint review.

**The fallback now closes on three independent signals, not one.** Keying it on
`NODE_ENV=production` alone would have left a `client` deployment profile or a
`staging`/`production` `REQRO_DEPLOYMENT_ENVIRONMENT` able to migrate with the
runtime credential. The fallback is refused if any one of those holds. All
**48** combinations of the three signals are enumerated in a test rather than
reasoned about: every serving combination is refused with
`migration_url_missing`, every non-serving combination gets the documented
fallback, and both sets are asserted non-empty so the matrix cannot pass
vacuously. Supplying the dedicated credential resolves in all 48.

**The local credential file carries an explicit NOT FOR PRODUCTION banner.**
`server/deploy/local/01-roles.sql` states that it contains placeholder
passwords, that only `server/compose.yml` references it, and that the
production artifacts set none. Verified: its only non-documentation reference
is the Compose volume mount, and the three `deploy/database/` artifacts contain
**zero** executable lines mentioning a password.

**PostgreSQL is published to localhost only**, `127.0.0.1:5432:5432`, with the
reason recorded in Compose: this container is provisioned with known
development placeholder passwords, so a broadly bound `5432:5432` would expose
them to anything that can reach the host.

## Migration count

**No Migration 50.** 49 migrations, unchanged. Nothing in this slice required
an application-schema change: role creation, grants, ownership and the `PUBLIC`
posture are all cluster- and database-level and belong to infrastructure SQL.
Migration 49 was not modified.

## Status

**Reqro application database least-privilege foundation complete.**

**Production deployment remains unauthorized.** Outstanding infrastructure
blockers: per-human IAM with JIT elevation, a production job runner,
secret-manager integration, immutable off-host audit and log retention, actual
production database provisioning, and real domain, DNS, TLS and edge
configuration.
