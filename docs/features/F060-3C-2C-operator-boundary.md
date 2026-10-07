# F060.3C-2c — Operator control-plane boundary (ADR-027)

Status: **F060.3C-2c-1 implemented locally, stopped for security review.** Not
staged, not committed, not pushed, not deployed.

> **F060.3C-2c-1 establishes: static and runtime operator boundary enforced.**
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

## Files changed

| File                                                       | Change                                   |
| ---------------------------------------------------------- | ---------------------------------------- |
| `server/test/unit/tenant-domain-operator-boundary.test.ts` | **new** — the twelve boundary invariants |
| `docs/features/F060-3C-2C-operator-boundary.md`            | **new** — this record                    |

**No production source module was changed**, no migration was created, no
database role or grant was issued, and ADR-027 was not amended.

## Validation record

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
