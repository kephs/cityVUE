# F060.3C-2c — Operator control-plane boundary (ADR-027)

Status: **F060.3C-2c-1 implemented locally, stopped for security review.** Not
staged, not committed, not pushed, not deployed.

> **F060.3C-2c-1 establishes: static and runtime operator boundary enforced.**
> **F060.3C-2c-2 establishes: tenant-domain database primitives hardened.**
>
> It explicitly does **not** establish "application-side operator boundary
> complete", and **production use remains unauthorized.** Three gates remain,
> two of them newly confirmed blockers recorded below.

## Authorization and baseline

Implemented under the F060.3C-2c-1 authorization. Branch
`claude/operator-boundary-enforcement` from `origin/main` at
`b509927df3ee4e8324dbe6f91bd5887b4e91ccab`, clean index and working tree. No
migration, no database role, no `GRANT`/`REVOKE`, no production source module
changed, no dependency change.

## Why the F060.3C-2b assertion was not enough

F060.3C-2b asserted the **direct** import list of the production operator
module. That was necessary but not sufficient: it inspected only the entry
module and said nothing about what those imports in turn reach.

Tracing the full graph produced a split result that is the central finding of
this slice:

| Graph                                                              | Result                                                                                                         |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Runtime** (emitted JavaScript — what actually grants capability) | **clean**: 11 modules, zero protected-domain reachability, 5 tables                                            |
| **Source** (TypeScript, 23 modules)                                | **not clean**: reaches `service-request/`, `resident-experience/`, `alerts/`, `catalog/`, `admin/` and `auth/` |

The entire difference is one edge set: `database.types.ts` imports four domain
type modules, and **all four are `import type`**, which the compiler erases.
`database.types.js` emits a stub and is not required at runtime at all.

So there is no forbidden transitive dependency today. But the purity of the
operator path rested on an **unasserted** property — that those imports stay
type-only. One character's change would have created a runtime path into
`service-request/staff-request-scope.js`, which carries live SQL against
`category` and `request` columns. **That latent source-to-runtime escalation is
what this slice closes.**

## Closed runtime module allowlist

Asserted by **equality**, so a newly reachable internal module fails the test
even when it sits in no forbidden directory.

```
common/logging/log-sanitization.js
config/database-tls.js
config/environment.js
config/operator-environment.js
database/tenant-domain-operator-cli.js
tenancy/tenant-domain-challenge.js
tenancy/tenant-domain-verifier.js
tenancy/tenant-domain.js
tenancy/tenant-domain.operations.js
tenancy/tenant-host-source.js
tenancy/tenant-hostname.js
```

External packages are pinned too: `joi`, `kysely`, `pg`, `reflect-metadata`,
`node:crypto`, `node:dns/promises`, `node:fs`, `node:net`, `node:url`.

**Deterministic compiled input.** The graph is resolved from `dist-test/src`,
which `npm run test:compile` emits in the same invocation that compiles this
test, and the unit scripts always run it first — so the artifact cannot be
stale relative to the run. A missing entry point fails loudly rather than
passing an empty graph.

**Negative control.** Resolving `app.module.js` through the same code must
produce a graph of more than 100 modules that _does_ reach protected domains.
Without this, every other assertion would still pass if the resolver silently
stopped following imports, and the boundary would be vacuously "clean".

## Type-only erasure invariant

Two assertions, because the property has a source side and an output side:

1. Every relative import in `database.types.ts` must be declared
   `import type`. The failure message says why: a value import would place
   application code in the operator runtime graph.
2. The emitted `database.types.js` must require no relative module and must
   mention no protected domain.

`database.types.ts` was **not** rewritten to satisfy these; it already
satisfied them, and the slice only makes that fact enforced.

## Closed database-object allowlist

The surface is read from the TypeScript sources of **exactly the modules the
runtime graph reaches**, so SQL behind a helper module is counted rather than
treated as invisible.

| Table                                | Access                                               |
| ------------------------------------ | ---------------------------------------------------- |
| `organization`                       | `SELECT` of exactly `['id','status']`, one call site |
| `tenant_domain`                      | SELECT / INSERT / UPDATE                             |
| `tenant_domain_audit`                | SELECT / INSERT                                      |
| `tenant_domain_operator_approval`    | SELECT / INSERT                                      |
| `tenant_domain_verification_attempt` | SELECT / INSERT                                      |

Asserted by equality. The only two raw statements in the whole runtime path:

1. `set constraints all immediate` — forces deferred constraints so a dry run
   genuinely validates;
2. `select current_database() as database, current_user as user, inet_server_addr()::text as address`
   — the pre-mutation connection identity assertion.

## Forbidden runtime domains

Explicitly asserted absent, redundantly with the closed allowlist so a breach
reports _which_ protected area was entered: `service-request`, `attachments`,
`requesters`/tracking, `resident-experience`, `access/`, staff/RBAC (`staff`,
`role`), `notifications`, `ai/`, `alerts/`, `catalog/`, `admin/`, `auth/`,
`issues/`, and any `.controller`/`.module`.

Two token-scoping corrections were needed while building this, and both are
worth recording because they are the kind of over-broad assertion that creates
false confidence in the other direction:

- `listTenantDomains` is a legitimate export of the shared operations module,
  used by the **development** command. The rule that matters is that the
  **production entry point** never reaches it, so that token is scoped to the
  entry module, not the graph.
- `connectionString` is exactly what the reviewed TLS module is for. Scoped to
  the entry module likewise: the entry point must never build a connection,
  while `database-tls.ts` must.

## CONFIRMED BLOCKER — Organization row-lock privilege

PostgreSQL documentation confirms that **`SELECT ... FOR SHARE` requires
`UPDATE` privilege on at least one column of the selected table.**

The operator path uses `SELECT ... FOR SHARE` on `organization` in the
application (`tenant-domain.operations.ts`, the single target-validation read)
and in four trigger bodies across Migrations 45–47, which matter because every
one of those functions is `SECURITY INVOKER` and therefore runs with the
caller's privileges.

Therefore:

- **`SELECT (id, status)` alone is insufficient** — every operator verb would
  fail at runtime.
- **Broad `UPDATE` on `organization` will not be granted**, because it would
  let the operator credential mutate tenant metadata, which is far outside the
  approved control-plane surface.
- **The current operator-role design is not yet executable as least
  privilege.**
- **Production use remains unauthorized.**

No workaround was attempted in 2c-1. Candidate remedies — a `SECURITY DEFINER`
wrapper owned by the schema owner that performs the locked check internally
and is granted `EXECUTE` only; a column-scoped `UPDATE`; or removing the lock
where it is not load-bearing — are for 2c-2, and the first is schema work that
would need its own authorization.

## NEWLY RECORDED THREAT — search_path and temporary-schema shadowing

The tenant-domain functions in Migrations 45–47 are `SECURITY INVOKER` and
contain **unqualified** references to application objects (`organization`,
`tenant_domain`, `tenant_domain_audit`,
`tenant_domain_operator_approval`, `tenant_domain_verification_attempt`), and
none sets an explicit `search_path`.

The operator threat model explicitly includes **interactive misuse of the same
database credential**. Under that model, `SECURITY INVOKER` is _not_ by itself
a safety argument: an attacker holding the credential controls their own
session, including `search_path`, and may be able to create relations that
shadow the unqualified names those functions resolve.

**This record does not claim the existing functions are safe from search-path
manipulation.** 2c-2 must explicitly assess and protect against:

- writable schemas on `search_path`;
- `pg_temp` precedence and temporary-schema relation shadowing;
- operator `TEMP` privilege on the database, which is what makes `pg_temp`
  shadowing reachable at all;
- `CREATE` on `public` or any other searchable schema;
- unqualified relation, function and operator resolution inside
  security-sensitive database functions, including whether those functions
  should be pinned with `SET search_path` or have every reference schema
  qualified.

No function was modified in 2c-1.

## Remaining gates

**2c-2 — role capability and database hardening.** Resolve the `FOR SHARE`
privilege design; assess and harden `search_path`/`TEMP`/`CREATE` exposure;
verify whether `reqro_test_user` holds `CREATEROLE` and, if so, prove with an
ephemeral role in the disposable database that all seven verbs work while
protected tables, schema mutation and future objects remain inaccessible; if
`CREATEROLE` is unavailable, record that as an explicit evidence gap rather
than a pass.

**2c-3 — reviewed grant artifact.** An infrastructure-owned, idempotent SQL
artifact (recommended `deploy/database/operator-role.sql`) applied by
provisioning, deliberately **not** an application migration: migrations run as
the schema owner, so putting the operator's privileges in one would place the
constraint inside the thing it constrains.

Only after 2c-2 and 2c-3 may the status become **application-side operator
boundary complete**.

**Separate infrastructure prerequisites, none of which 2c can satisfy:**
distinct per-human IAM identities; JIT elevation; job runner; secret-manager
injection; invocation and session audit; off-host immutable log retention; real
operator database-role provisioning; real production infrastructure.
**Completing 2c does not authorize production deployment.**

## F060.3C-2c-2 — Organization lock and function hardening

Status: **implemented locally, stopped at the database gate for final security
review.** Not staged, not committed, not pushed, not deployed.

> **F060.3C-2c-2 establishes: tenant-domain database primitives hardened.**
>
> It does **not** establish "application-side operator boundary complete".
> F060.3C-2c-3 must still prove the actual least-privilege role and review the
> infrastructure grant artifact. **Production use remains unauthorized.**

Migration 48 was explicitly authorized. Migrations 45, 46 and 47 are
**byte-identical** and were not edited, including their historical `down()`
bodies.

### The Organization helper

```
public.tenant_domain_lock_organization(target uuid) returns boolean
```

`VOLATILE`, `SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp`, owned
by the schema owner, every object schema qualified, no dynamic SQL, `uuid`
input only. It locks the one supplied row `FOR SHARE`, returns true only when
that Organization is active, and returns false for both inactive and missing.
Its return type is `boolean`, so no name, slug, short name or any other column
can leave through it.

**`VOLATILE` is deliberate, not an oversight.** The function exists to acquire
a row lock, so the optimizer must not be permitted to assume it can be elided,
reordered or called fewer times than written. A `STABLE` marking would be a
stronger assumption than the semantics support.

**Why this preserves the concurrency guarantee rather than relocating it:**
PostgreSQL row locks are scoped to the calling _transaction_, not to the
function invocation, so the `FOR SHARE` taken inside the definer function is
held by the caller's transaction until commit — identical semantics to the
inline lock it replaces.

**Why a definer function was necessary at all:** `SELECT … FOR SHARE` requires
`UPDATE` privilege on at least one column of the locked table, so an invoker
function could not have removed the privilege requirement. Moving the lock
behind an owner-executed function is what lets the operator role hold **no
privilege on `organization`**.

### Operation active-status matrix

Locking and active-status enforcement are separate decisions. Every supported
operator path takes the Organization lock; only some require the result.

| Operation         | Lock | Requires active | Rationale                                                                               |
| ----------------- | ---- | --------------- | --------------------------------------------------------------------------------------- |
| `register`        | yes  | **yes**         | unchanged from before this slice                                                        |
| `issue-challenge` | yes  | no              | reversible, non-serving                                                                 |
| `verify`          | yes  | no              | records evidence, never activates                                                       |
| `approve`         | yes  | **yes**         | unchanged: the Migration 47 approval guard already required it                          |
| `activate`        | yes  | **yes**         | makes a hostname publicly reachable                                                     |
| `deactivate`      | yes  | no              | safe direction — must stay available precisely when an Organization is no longer active |
| `revoke`          | yes  | no              | safe direction                                                                          |

`guard_tenant_domain` takes the lock and **deliberately discards the result**.
That guard never required an active Organization and the assessment's proposed
blanket active-status change was **not** implemented. A missing Organization
remains authoritatively refused by the existing foreign key rather than by the
trigger, which is the one observable change: the trigger no longer raises
`Tenant domain requires an existing Organization`, and a foreign-key violation
surfaces instead. No test depended on that message.

`guard_tenant_domain_approval` keeps its existing active requirement and its
existing message, now expressed through the helper.

The application's two former Organization messages (`Organization not found`
and `Organization is not active`) collapse into one,
`Organization is not an active servable target`, because the helper returns a
boolean by design. No test depended on either message.

### Application lock ordering

Every supported operator path now acquires **Organization then
`tenant_domain`**. Previously the order was inconsistent: registration locked
the Organization first, while every transition locked the binding first and
reached the Organization only inside the trigger.

That inconsistency is harmless today because `FOR SHARE` is a shared lock and
two holders do not conflict, **but it becomes a genuine deadlock window as soon
as anything takes the Organization row `FOR UPDATE`** — which is exactly what
the deferred Organization lifecycle workstream would do. Normalising the order
now is therefore a prerequisite for that workstream, recorded here so it is
not rediscovered later.

Implementation: one shared `lockOrganization` helper in
`tenant-domain.operations.ts`, called at the top of `lockBinding` so every
transition inherits it, plus explicit calls in `register` and `deactivate`
which do not route through `lockBinding`. No raw SQL is duplicated.

Direct arbitrary SQL remains unsupported and is not a production workflow; a
direct writer still takes the locks in trigger order, which is accepted.

### Function hardening inventory

Seven functions carry `SET search_path = pg_catalog, pg_temp`. **`public` is
deliberately absent from that path**, so every application object must be
schema qualified and a missed reference fails loudly instead of resolving
through the caller's search path.

| Function                          | Mode              | Hardening                                                                                                        |
| --------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `tenant_domain_lock_organization` | **DEFINER** (new) | pinned path, qualified, PUBLIC EXECUTE revoked                                                                   |
| `guard_tenant_domain`             | INVOKER           | pinned path; Organization read → helper (lock only); `public.tenant_domain_challenge_live` qualified             |
| `guard_tenant_domain_attempt`     | INVOKER           | pinned path; `public.tenant_domain` relation **and composite type** qualified                                    |
| `guard_tenant_domain_audit`       | INVOKER           | pinned path; two relations and **two composite types** qualified; `public.tenant_domain_approval_live` qualified |
| `verify_tenant_domain_audited`    | INVOKER           | pinned path; `public.tenant_domain_audit` qualified                                                              |
| `guard_tenant_domain_approval`    | INVOKER           | pinned path; Organization check → helper (active required); relation and composite type qualified                |
| `tenant_domain_approval_consumed` | INVOKER           | pinned path; `public.tenant_domain_audit` qualified                                                              |

**Not changed, with reasons:** `protect_tenant_domain_audit` and
`protect_tenant_domain_attempt` raise unconditionally and reference no object;
`tenant_domain_challenge_live` and `tenant_domain_approval_live` are pure
timestamp arithmetic with no relation, type or non-catalog function reference.
Touching them would enlarge the rollback surface for no security gain. **No
guard or audit function was converted to `SECURITY DEFINER`** — the helper is
the only authorized definer surface.

The composite-type vector is the subtle one and is why `DECLARE` references are
qualified: a temporary table named `tenant_domain` creates both a relation and
a composite type of that name, and `pg_temp` is implicitly searched first for
**both**. `pg_temp` is never searched for function or operator names, so
temp-function shadowing is explicitly _not_ relied upon as a threat; that is
asserted rather than assumed.

### Table and function boundary after hardening

`organization` **leaves** the operator application's direct table surface
entirely. The F060.3C-2c-1 boundary allowlist therefore moves from five tables
to four, plus a new closed function allowlist:

| Tables (4)                                                                                                      | Functions (1)                            |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `tenant_domain`, `tenant_domain_audit`, `tenant_domain_operator_approval`, `tenant_domain_verification_attempt` | `public.tenant_domain_lock_organization` |

**This is a security tightening, not a weakened assertion.** Re-adding
`organization` would mean the operator path had regained direct access and
with it the `FOR SHARE` privilege requirement. The boundary suite now also
asserts the table is unreachable by _any_ access shape, and that the operator
path calls exactly one application database function. The reviewed raw-SQL set
grows from two statements to three, the new one being the helper call.

### Deployment constraint

Migration 48 revokes `PUBLIC EXECUTE` on the helper because that is a
fail-closed property of the object itself, and it **grants `EXECUTE` to no
role**. Deployment-specific grants belong to F060.3C-2c-3.

> **Migration 48 must not be considered deployable to a non-owner runtime
> environment until the required role grants are provisioned.** Every role
> that writes `tenant_domain` — the operator role, the development CLI role
> and the schema owner — needs explicit `EXECUTE` on the helper. Which of them
> strictly require it, and whether firing an already-installed trigger
> requires `EXECUTE` on the trigger function at all, must be settled
> empirically in 2c-3 rather than guessed.

### Qualification boundary: function bodies, not call sites

A distinction worth stating precisely, because it was discovered by running the
code rather than reading it.

**Inside the hardened functions, every application object is schema
qualified** — relations, composite types and helper-function calls — and the
function-local `search_path` omits `public` so a missed reference fails loudly.
That is where the shadowing risk lives: `pg_temp` is implicitly searched first
for relation **and data type** names.

**The application's call to the helper is deliberately unqualified.**
PostgreSQL never searches `pg_temp` for function or operator names, so a
temporary object cannot hijack a function call; hard-coding `public.` in
application source would instead bind the application to a single deployment
layout and, as the validation history below records, breaks every suite that
runs in an isolated schema. The residual risk — a same-named function in an
earlier _writable_ schema — is closed by the operator role holding no `CREATE`
on any searchable schema, which F060.3C-2c-3 must provision and which is
already on that slice's list.

So: qualified where shadowing is possible, unqualified where it is not and
where qualification would cost portability for nothing.

### Test-suite consequences

Four existing suites exercise operator paths and therefore now need the
hardening present. A single shared helper,
`test/helpers/tenant-domain-hardening.ts`, applies the Migration 48 SQL with
`public.` rewritten to the suite's isolated schema, so the adaptation lives in
one reviewable place rather than being copied four times.

One consequence is an improvement worth recording: the Migration 45 suite
previously ran on an artificial **45 + 47** schema, skipping 46, which
F060.3C-2c-1 documented as an evidence limit. Migration 48 installs the
Migration 46 era guard, which reads columns 46 adds, so that combination is no
longer viable. The suite now applies **46 in sequence** and its challenge
fixtures supply the token and bounded window 46 requires. **The artificial
schema combination is gone**, and with it that evidence limit.

### Measured environment facts

Recorded because they bear directly on F060.3C-2c-3 and were measured rather
than assumed:

| Fact                                                  | Value                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| PostgreSQL server version                             | **18.6** (`server/README.md` says 17; the disposable environment is newer) |
| `reqro_test_user` has `CREATEROLE`                    | **no**                                                                     |
| `reqro_test_user` has database `TEMP`                 | yes                                                                        |
| `reqro_test_user` has `CREATE` on `public`            | yes                                                                        |
| `reqro_test_user` is superuser / can create databases | no / no                                                                    |

### UNRESOLVED — the trigger EXECUTE question

**This environment cannot settle it, and it is reported as unresolved rather
than guessed.**

The question is whether ordinary DML that fires an **already installed**
trigger requires the DML role itself to hold `EXECUTE` on the trigger
function — as distinct from the documented requirement that _creating_ a
trigger needs `EXECUTE`.

Settling it behaviourally requires a second, non-owner role. `reqro_test_user`
lacks `CREATEROLE`, so no such role can be created here, and the test role
**owns** the functions it created — owners hold `EXECUTE` implicitly, so
revoking from `PUBLIC` cannot reproduce the condition either. There is no
honest way to observe the behaviour in this environment.

It therefore remains an **F060.3C-2c-3 prerequisite**: it determines whether
the operator role's grant list must include `EXECUTE` on the seven trigger
functions, and a wrong guess in either direction is consequential — too few
grants breaks the development CLI, too many widens the surface. No grant was
changed on the strength of an assumption.

The two facts above about `TEMP` and `CREATE on public` reinforce the 2c-3
grant requirements already recorded: both are available to this role in the
disposable database, so neither can be assumed absent for a production
operator role without explicit revocation.

### Rollback behaviour

`down()` restores the **byte-identical** pre-48 function bodies, verified
programmatically against the Migration 46 and 47 sources rather than
hand-transcribed, and drops the helper. Every data row is preserved — audit,
approval and verification evidence are untouched — and no grant is changed.

> **Rolling Migration 48 back intentionally removes this hardening.** The
> operator path then once again requires a privilege on `organization` that
> the intended least-privilege role must not hold, so a rolled-back deployment
> is **production use unauthorized**. Reapplying restores the hardened state.

### Test-harness adaptation, stated openly

Migration 48 qualifies objects as `public.*`, which is correct for the
deployment. Every database suite here runs in a disposable per-test schema, so
the hardening suite applies the migration SQL with `public.` rewritten to that
schema. The property under test — qualified references plus a pinned
function-local `search_path`, so `pg_temp` cannot redirect them — does not
depend on the schema's name. What the rewrite does **not** verify is the
literal `public` spelling, so that is asserted separately against the
migration source: every expected qualified object, exactly seven pinned
`search_path` clauses, `volatile security definer`, the `PUBLIC` revoke, and
the absence of any `grant execute`.

### CONDITIONAL ACCEPTANCE — the unqualified helper call

The unqualified application invocation of `tenant_domain_lock_organization` is
accepted for this slice, because the test and runtime architecture
intentionally supports isolated schemas and hard-coding `public.` would bind
the application to one deployment layout. It must **not** be qualified as
`public.` merely to match production naming.

> **This acceptance is conditional.** The unqualified call is **not
> independently secure.** Its safety rests on role controls that do not yet
> exist, so it must not be described as safe on its own until F060.3C-2c-3 has
> proven all of the following against the real least-privilege operator role:
>
> - the operator role has **no `CREATE` on `public`**;
> - the operator role has **no `CREATE` on any other searchable schema**;
> - the operator role **cannot create a competing same-signature helper**
>   (`tenant_domain_lock_organization(uuid)`) anywhere its `search_path` would
>   reach;
> - the operator role holds **only the schema `USAGE` actually required**;
> - the role's default and searchable schema posture **cannot redirect** the
>   unqualified helper call;
> - **`pg_temp` cannot shadow function lookup** — asserted as reasoning here,
>   to be confirmed against the real role;
> - the actual least-privilege role **still executes all seven operator
>   verbs**.
>
> Until then, the unqualified call is accepted on the strength of the
> hardened function bodies plus an _intended_ grant posture, not a verified
> one.

### 2c-3 evidence and version-alignment items

Two measured facts from this validation that F060.3C-2c-3 must carry forward.

**The trigger `EXECUTE` question remains unresolved.** The disposable
environment could not determine whether a **non-owner** DML role needs
`EXECUTE` on an already-installed trigger function, as distinct from the
documented requirement that _creating_ a trigger needs it. `reqro_test_user`
lacks `CREATEROLE`, so no second non-owner role could be created, and the test
role owns the functions — owners hold `EXECUTE` implicitly, so revoking from
`PUBLIC` cannot reproduce the condition. **It was not guessed**, and no grant
was changed on an assumption. It is a required empirical 2c-3 test, because it
determines whether the operator grant list must include `EXECUTE` on the seven
trigger functions; too few grants breaks the development CLI, too many widens
the surface.

**PostgreSQL version mismatch.** The validation server reported
**PostgreSQL 18.6**, while `server/README.md` currently states PostgreSQL 17.
Supported-version documentation was deliberately **not** changed in this
checkpoint. F060.3C-2c-3 must resolve it one of two ways: either validate the
final role and grant model against the project's supported production major
version, or explicitly reconcile the project's supported PostgreSQL version
before production readiness is claimed. This matters because several controls
in the hardening design are version sensitive — notably `PUBLIC`'s default
`CREATE` on the `public` schema, which PostgreSQL 15 removed.

### Validation record — F060.3C-2c-2

Every invocation is recorded, including the ones that failed.

| Suite                                              | Result                                       |
| -------------------------------------------------- | -------------------------------------------- |
| Migration 48 hardening suite — invocation 1        | 10/14, **4 failed**                          |
| Migration 48 hardening suite — invocation 2        | 14/14, but two subtests **passed vacuously** |
| Migration 48 hardening suite — invocation 3        | aborted, mis-nested subtests caused a hang   |
| Migration 48 hardening suite — invocation 4        | 15/18, **3 failed**                          |
| Migration 48 hardening suite — invocation 5        | 16/18, **2 failed**                          |
| Migration 48 hardening suite — final               | **18/18 passed**                             |
| Migration 47 operator-controls — invocation 1      | 4/15, **11 failed**                          |
| Migration 47 operator-controls — final             | **15/15 passed**                             |
| Tenant-domain registry — invocations 1 and 2       | 3/14 then 2/14, **failed**                   |
| Tenant-domain registry — final                     | **14/14 passed**                             |
| Tenant-domain verification — invocation 1          | 1/17, **16 failed**                          |
| Tenant-domain verification — final                 | **17/17 passed**                             |
| Production operator CLI integration — invocation 1 | 1/10, **9 failed**                           |
| Production operator CLI integration — final        | **10/10 passed**                             |
| F060.3C-2c-1 boundary — invocation 1               | 12/13, **1 failed**                          |
| F060.3C-2c-1 boundary — final                      | **13/13 passed**                             |
| F060.3C-2a boundary — invocation 1                 | 8/9, **1 failed**                            |
| F060.3C-2a boundary — final                        | **9/9 passed**                               |
| Backend units, serial — invocation 1               | 648/649, **1 failed**                        |
| Backend units, serial — final                      | **649/649 passed**, 0 skipped                |
| Full serial disposable PostgreSQL                  | **746/746 passed**, 0 skipped                |
| Full API E2E, serial                               | **80/80 passed**, 0 skipped                  |
| Shared/legacy                                      | **64/64 passed**                             |
| Lint — invocations 1 and 2                         | **2 errors**, then **1 error**               |
| Lint, typecheck, build, test compile — final       | passed                                       |
| Changed-file formatting, `git diff --check`        | passed                                       |

All database and end-to-end work used `reqro_f0592_test` as `reqro_test_user`,
serially with `--test-concurrency=1`, through the minimal allowlisted runner
that refuses to spawn when any child value names `reqro_dev`. Afterwards the
database reported `{ db: 'reqro_f0592_test', usr: 'reqro_test_user' }`, zero
leftover disposable schemas, zero tenant-domain functions in the shared
`public` schema, and zero idle-in-transaction backends. `reqro_dev` was never
accessed.

### Failures and what caused them

**Two of my own test defects produced vacuous passes, which is worse than a
failure and is recorded as such.** `organization.status` admits only
`active | inactive`, and two subtests used `'suspended'`. The update was
rejected by the check constraint, so the Organization stayed active and the
subtests named "safe-direction operations survive a non-active Organization"
and "approval still requires an active Organization" passed **without
exercising a non-active Organization at all**. Both now set the status
explicitly and assert it took effect before proceeding.

**A hang, from a bad insertion point.** Four added subtests were nested inside
another subtest's `try` block, so they ran while that subtest's lock-holding
clients were still checked out. Relocated to the correct nesting level; all
sixteen subtests are now siblings.

**Two separate lessons about bounding database waits.** A `SET` issued on one
pooled connection does not reach the connection the code under test uses, and
the operations open their own transactions so nothing can be injected into
them. Both the concurrency and lock-order subtests therefore set
`lock_timeout` at **connection level** on a dedicated client.

**The eleven-to-sixteen failure cascade across the four existing suites had a
single cause with real design significance.** Those suites apply migrations
into an isolated schema and never applied Migration 48, so the Organization
lock helper did not exist. The fix is the shared rewrite helper plus, for the
registry suite, applying Migration 46 in sequence.

**Three path-depth mistakes** of the same shape: reading TypeScript sources
from `dist-test` requires one more level up than reading the compiled
migrations.

Three assertion corrections rather than code defects: the pinned `search_path`
is `pg_catalog, pg_temp` and is **not** touched by the schema rewrite, because
it contains no `public.`; the boundary function allowlist matches the bare
helper name now that the call site is unqualified; and the F060.3C-2a and
2c-1 table allowlists both had to drop `organization`, which is the tightening
working as designed.

## Files changed

| File                                                       | Change                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| `server/test/unit/tenant-domain-operator-boundary.test.ts` | **new** — the boundary invariants (thirteen after F060.3C-2c-2) |
| `docs/features/F060-3C-2C-operator-boundary.md`            | **new** — this record                                           |

In **F060.3C-2c-1** no production source module was changed and no migration
was created.

**F060.3C-2c-2** additionally changed:

| File                                                                        | Change                                                                                  |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `server/migrations/20261018000000-harden-tenant-domain-functions.ts`        | **new** — Migration 48                                                                  |
| `server/src/tenancy/tenant-domain.operations.ts`                            | `lockOrganization` helper, Organization-first lock order, no direct Organization access |
| `server/test/helpers/tenant-domain-hardening.ts`                            | **new** — shared schema-rewriting applier                                               |
| `server/test/database/tenant-domain-function-hardening.integration.test.ts` | **new** — behavioural hardening evidence                                                |
| `server/test/database/tenant-domain-registry.integration.test.ts`           | applies the hardening, and Migration 46 in sequence                                     |
| `server/test/database/tenant-domain-verification.integration.test.ts`       | applies the hardening                                                                   |
| `server/test/database/tenant-domain-operator-controls.integration.test.ts`  | applies the hardening                                                                   |
| `server/test/database/tenant-domain-operator-cli.integration.test.ts`       | applies the hardening through the helper rather than importing Migration 48             |
| `server/test/unit/tenant-domain-operator-boundary.test.ts`                  | four-table allowlist, function allowlist, no-Organization-access assertion              |
| `server/test/unit/tenant-domain-attribution.test.ts`                        | four-table allowlist                                                                    |

**No database role or grant was issued** in either slice, and ADR-027 was not
amended. The only ACL change is Migration 48's
`REVOKE EXECUTE … FROM PUBLIC` on the new helper.

## Validation record — F060.3C-2c-1

Every invocation is recorded, including the ones that failed.

| Suite                                            | Result                        |
| ------------------------------------------------ | ----------------------------- |
| Operator boundary suite — invocation 1           | 9/10, **1 failed**            |
| Operator boundary suite — invocation 2           | 10/11, **1 failed**           |
| Operator boundary suite — final                  | **12/12 passed**              |
| F060.3C-2a boundary suite                        | **9/9 passed**                |
| Production operator CLI units                    | **22/22 passed**              |
| Backend units, serial                            | **648/648 passed**, 0 skipped |
| Shared/legacy suite                              | **64/64 passed**              |
| Typecheck, test compilation, backend build, lint | passed                        |
| Changed-file formatting, `git diff --check`      | passed                        |

Both boundary-suite failures were **over-broad assertions of mine, not code
defects**: I carried two tokens from the F060.3C-2b entry-point-scoped list
into a graph-wide assertion, where `listTenantDomains` legitimately exists in
the shared operations module and `connectionString` legitimately exists in the
reviewed TLS module. Both were re-scoped to the entry point, which is where
the rule actually belongs. No assertion was weakened to obtain a pass — the
re-scoped checks still fail if the production entry point gains either
capability.
