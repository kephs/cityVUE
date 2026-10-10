# F062.2D-1 — Worker identity and database function security decision

Baseline `7c89a9fa23c17278a6389a6d42dca96cec2bfcdb` (authoritative `main`, carrying [F062.2D-0 delivery worker security readiness](F062-2D-0-delivery-worker-security-readiness.md)).

> **NO CAPABILITY IS ENABLED BY THIS ASSESSMENT.** Decision record only.

**Status: decision proposed for review.** No migration, no role created, no grant file edited, no SECURITY DEFINER function implemented, no worker, no network client, no secret, no infrastructure, no ADR number. Migration count remains **51**. Nothing outside this document is modified.

Every statement about current behaviour was read from source at this commit. Counts are given so a reviewer can re-derive them.

---

## 1. Baseline, read from source

| Fact                          | Value                                                                                                                   | Source                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Migration count               | **51**                                                                                                                  | `server/migrations/*.ts`                                                                                              |
| Database roles                | **four**: `reqro_owner`, `reqro_migrate`, `reqro_runtime`, `reqro_operator`                                             | `deploy/database/bootstrap-roles.sql`, `server/deploy/local/01-roles.sql`                                             |
| Role memberships              | **exactly one**: `grant reqro_owner to reqro_migrate`                                                                   | `bootstrap-roles.sql:145`                                                                                             |
| Default privileges            | **none for any role** — asserted by the bootstrap's own fail-closed block                                               | `bootstrap-roles.sql`                                                                                                 |
| Runtime table grants          | 76 `grant` statements, **0 on any `integration_*` table**                                                               | `runtime-role.sql`                                                                                                    |
| Runtime EXECUTE grants        | **exactly 11**, all fully qualified `:"schema".`, and the role-separation suite asserts the surface is _exactly eleven_ | `runtime-role.sql:223-238`, `database-role-separation.integration.test.ts:522`                                        |
| Operator grants               | **7**, all on the `tenant_domain` family                                                                                | `operator-role.sql`                                                                                                   |
| SECURITY DEFINER functions    | **9**, all created in Migration 49                                                                                      | `20261019000000-harden-runtime-reference-locks.ts`                                                                    |
| Their `search_path`           | **`set search_path = pg_catalog, pg_temp`** — uniformly, all 9                                                          | same                                                                                                                  |
| Their object references       | **fully qualified** (`public.department`, …)                                                                            | same                                                                                                                  |
| Their PUBLIC posture          | `revoke execute … from public` on every one, using fully-qualified names                                                | same                                                                                                                  |
| Their owner                   | `reqro_owner`, because migrations run as `reqro_migrate` which `SET ROLE`s to the owner                                 | `bootstrap-roles.sql` provisioning order; role-separation suite asserts every application object belongs to the owner |
| Existing non-login owner role | **`reqro_owner` only**                                                                                                  | `bootstrap-roles.sql`                                                                                                 |

### A correction owed to F062.2D-0

F062.2D-0 §1 lists **five** database roles, including `reqro_production`. That is wrong: `reqro_production` appears exactly once in the repository, in a `bootstrap-roles.sql` usage comment as the example value of the `-v db=` psql variable — it is **a database name, not a role**. There are four roles.

The error is mine, it is confined to one table row of a merged document, and it changes no conclusion in that assessment. **This slice must not modify F062.2D-0, so it is reported rather than corrected.** It remains a **known documentation correction awaiting a separate follow-up**: a one-row amendment to F062.2D-0 §1, to be made in its own branch and not in this one.

### One convention this slice adopts and F062.2D-0 understated

F062.2D-0 recommended pinning `search_path` to "the app schema, with `pg_temp` last". The repository's actual pattern is **stricter and better**: `pg_catalog, pg_temp` — the application schema is **not in the path at all**, so an unqualified application-object reference does not resolve to something unexpected, it **fails**. That is fail-closed rather than fail-plausible. §9 adopts the repository's pattern and discards the weaker suggestion.

---

## 2. Current role topology

```text
reqro_owner      NOLOGIN  nosuperuser nocreatedb nocreaterole noinherit nobypassrls
                 owns the database, the schema and every application object
                      ^
                      | grant reqro_owner to reqro_migrate      (the only membership)
                      |
reqro_migrate    LOGIN    nosuperuser nocreatedb nocreaterole noinherit nobypassrls
                 applies migrations; holds no authority until it SET ROLEs

reqro_runtime    LOGIN    nosuperuser nocreatedb nocreaterole noinherit nobypassrls
                 owns nothing; 76 table grants, 11 function EXECUTE grants
                 member of nothing

reqro_operator   LOGIN    nosuperuser nocreatedb nocreaterole noinherit nobypassrls
                 owns nothing; 7 grants, tenant_domain family only
                 member of nothing
```

**`NOINHERIT` on all four is load bearing**, and it is the property this slice leans on most: a role holds no authority from a membership until it explicitly issues `SET ROLE`. That is what makes `reqro_migrate` fail closed without `SET ROLE`, and it is what makes an accidentally granted membership inert rather than immediately dangerous.

**Relevant to integration: nothing.** No role holds any privilege on `integration_connector`, `integration_connector_audit` or `integration_outbox`. No enqueue and no dispatch is possible today by privilege alone, independently of code. The bootstrap issues **no default privileges**, so each new object is unreachable until granted deliberately.

PUBLIC posture, also from source: `CONNECT` deliberately retained (revoking it would lock out every role not granted it explicitly); `TEMPORARY` revoked on the database; `CREATE` revoked on the schema.

---

## 3. Recommended worker principal

> **`reqro_integration_worker` — LOGIN, NOINHERIT, member of nothing, holding EXECUTE on three functions and no table privilege whatsoever.**

| Attribute                                                  | Value                             | Why                                                                                                                                                                                 |
| ---------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOGIN`                                                    | **yes**                           | It must connect. NOLOGIN would make it unreachable, and reaching it by `SET ROLE` from another login would destroy the principal separation that justifies its existence            |
| `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOBYPASSRLS` | yes                               | Matches all four existing roles; a delivery worker creates nothing and bypasses nothing                                                                                             |
| **`NOINHERIT`**                                            | **yes**                           | Matches the existing topology and is the second line of defence: if a membership is ever granted in error, the worker still holds no extra authority without an explicit `SET ROLE` |
| Memberships                                                | **none**                          | §5                                                                                                                                                                                  |
| Direct table privileges                                    | **none**                          | see below. It holds `USAGE` on `reqro_integration_api` and `EXECUTE` on three signatures, and no privilege on the application schema at all                                         |
| Owns objects                                               | **nothing**                       | like `reqro_runtime` and `reqro_operator`                                                                                                                                           |
| Authentication                                             | Entra workload identity preferred | §16                                                                                                                                                                                 |

### Why EXECUTE-only rather than direct table grants

Three reasons, in descending order of importance:

1. **The state machine stays in the database.** With direct `UPDATE` on `integration_outbox`, the worker could write _any_ transition — `pending → acknowledged`, or a dead-letter straight back to `dispatching`. The transition whitelist would then live in application code, where F062.2A's §22.1 parity problem becomes unavoidable: two copies of one state machine, able to disagree silently.
2. **The fencing predicate cannot be forgotten.** Inside `complete_integration_attempt`, the `claim_generation` and digest comparison are part of the statement. As an application-issued `UPDATE`, they are something a future call site must remember, and a forgotten predicate is a stale worker silently overwriting a newer result.
3. **It bounds a compromised worker.** A worker principal with EXECUTE on three narrow functions can claim, settle and recover. One with table `UPDATE` can rewrite delivery history.

**F062.2D-0's observation holds and is the reason this is not Model B:** the privileges needed here — `UPDATE` on the outbox, `INSERT`+`UPDATE` on attempts — are _exactly_ those `reqro_runtime` must never hold. That they coincide so precisely is the clearest available signal that they belong to a different principal.

**The role is not created by this slice.**

---

## 4. Function-owner role

> **`reqro_integration_function_owner` — NOLOGIN, owning only the three worker functions, holding only granted DML on the four integration tables, owning no tables.**

Name: the repository's convention is `reqro_<purpose>`. `reqro_integration_definer` was considered and is acceptable, but "definer" names the PostgreSQL mechanism while "function_owner" names the responsibility, and the latter is what a reviewer reading a grant file needs to understand. 34 characters, well inside PostgreSQL's 63-byte identifier limit.

| Requirement                                         | Decision                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `NOLOGIN`                                           | **yes** — it is a privilege container, never a connection. Nothing authenticates as it |
| Not `reqro_runtime`, not `reqro_integration_worker` | yes, and member of neither (§5)                                                        |
| Not a broad owner                                   | **yes — and this is a deliberate departure from current practice**                     |
| Object privileges                                   | only the minimum of §11, granted _to_ it by the table owner                            |
| Owns                                                | the three worker functions and nothing else                                            |

### A dedicated schema for the worker function API

> **The three worker functions live in their own schema — conceptually
> `reqro_integration_api` — owned by the function owner, containing nothing
> else.**

Placing them in the application schema would force an uncomfortable choice: the
function owner would need `CREATE` on the schema that holds every business
table, which is a privilege the bootstrap deliberately withholds from every role
(`revoke create on schema public from public`, and its fail-closed block refuses
any role in the topology holding `CREATE`). **That privilege is not needed, and
asking for it to satisfy object ownership would be the tail wagging the dog.**

| Principal                          | On `reqro_integration_api`                                                                       | On the application schema                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reqro_integration_function_owner` | **owns the schema**, holds `CREATE` and `USAGE` on it, owns the three functions and nothing else | **`USAGE` — yes, explicitly granted** (see below). **No `CREATE`**, and no ownership of any application object. Only the narrow DML of §11 on the four integration tables |
| `reqro_integration_worker`         | `USAGE` on the schema, plus `EXECUTE` on the three exact signatures. **No `CREATE`**             | **No `USAGE` at all** — and therefore no reachability of any application object, whatever table grants might exist. It never names one                                    |
| `reqro_runtime`                    | **nothing** — no `USAGE`, no `EXECUTE`                                                           | unchanged: its existing 76 table and 11 function grants                                                                                                                   |
| `PUBLIC`                           | **nothing** — `revoke all on schema reqro_integration_api from public`                           | unchanged                                                                                                                                                                 |

### Schema `USAGE` is a separate privilege from table DML

**PostgreSQL requires both, and granting one does not imply the other.** A role
with `SELECT` on `public.integration_outbox` but no `USAGE` on `public` cannot
reach the table at all; a role with `USAGE` but no table grant can reach the
namespace and read nothing in it. The two are checked independently, so each
must be stated independently.

| Principal                          | `USAGE` on the application schema    | Why                                                                                                                                                                                                                                              |
| ---------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reqro_integration_function_owner` | **Required, and granted explicitly** | Its functions read and write four integration tables in that schema. Without `USAGE` the qualified reference `public.integration_outbox` fails on the namespace before any table privilege is consulted, so the DML grants of §11 would be inert |
| `reqro_integration_worker`         | **None**                             | It names no application object. Withholding `USAGE` makes "no business-table reach" a property of the namespace rather than only of the grant list — so even a mistakenly granted table privilege would remain unreachable                       |

Granted **explicitly** rather than relied upon: on a fresh PostgreSQL 17
database `PUBLIC` holds `USAGE` on `public` by default, but `runtime-role.sql`
grants it to the runtime anyway, commenting that this is "explicit, so the role
still works where `USAGE` has been revoked from `PUBLIC`." The function owner
follows the same convention for the same reason — a grant artifact should not
depend on a default that a future hardening step may remove.

What this does **not** relax: the owner still holds **no `CREATE`** on the
application schema, owns **no application table**, holds only the narrow DML of
§11, and every table reference inside the functions remains **fully
schema-qualified** (§9). `USAGE` buys reachability of a namespace, nothing more.

Four further properties the dedicated schema buys, each worth stating:

- **The function API is enumerable.** "What may the worker call?" is answered by
  listing one schema, not by filtering a schema that holds ninety functions.
- **The worker needs no `USAGE` on the application schema at all.** It names no
  table, so it needs no access to the namespace holding them — which makes
  §13's tenant isolation and §11's "no business-table privileges" structural
  rather than merely granted.
- **`CREATE` stays where it belongs.** The function owner creates objects only
  in a schema containing nothing but its own functions, so a flaw in its
  authority cannot produce an object that shadows an application one.
- **A new function is unreachable by default.** Adding one to the schema grants
  nothing: `USAGE` on a schema is not `EXECUTE` on its contents, and `PUBLIC`
  `EXECUTE` is revoked per function regardless.

**Fully-qualified references are still mandatory inside the functions**, and the
schema boundary does not relax that. The functions live in
`reqro_integration_api` but read and write `public.integration_outbox`,
`public.integration_delivery_attempt`, `public.integration_connector` and
`public.integration_connector_audit` by qualified name, with the `search_path`
of §9 unchanged. The schema separates _the API_ from the data; it does not make
unqualified data references safe.

Naming: `reqro_integration_api` follows the repository's `reqro_<scope>` shape
and reads correctly in a grant file. The implementing slice should confirm it
against conventions at that time; what matters here is that the boundary exists,
not the exact string.

### Why not `reqro_owner`, which is what the 9 existing definer functions use

**A SECURITY DEFINER function executes with its owner's authority, so the owner's privilege set is the function's blast radius if the body is ever wrong.**

`reqro_owner` owns the database, the schema and **every application object** — `service_request`, `answer`, `attachment`, `requester_contact`, `tenant_domain`, the whole access-control family. A definer function owned by it has implicit authority over all of them. For Migration 49's nine functions that was an acceptable trade: each is a handful of lines returning a boolean, with no mutation at all, and the alternative in 2026 would have been a new role for a lock helper.

A worker function is a different proposition. It **mutates** state, it is called continuously by a long-running process, and it is the one database surface a compromised worker can reach. Owning it as `reqro_owner` means an injection or logic flaw inside it operates with authority over every resident record in the deployment. Owning it as a role whose entire privilege set is "DML on four integration tables" means the same flaw can corrupt delivery state and nothing else.

The cost is one more NOLOGIN role and one more reviewed grant artifact. That is a good trade, and it is the first case in this repository where the trade clearly favours the narrower owner.

**The role is not created by this slice.** Introducing a second owner role is a change to the bootstrap topology and needs the approval §19 describes.

---

## 5. Role-membership graph

> **Exactly one new edge, with restrictive PostgreSQL 17 membership options:
> `reqro_migrate` → `reqro_integration_function_owner`, with `INHERIT FALSE`,
> `SET TRUE`, `ADMIN FALSE`. No other edge, in either direction.**

```text
reqro_owner  <--grant--  reqro_migrate          (existing, unchanged)

reqro_integration_function_owner  <--grant--  reqro_migrate
                                              inherit false, set true, admin false

reqro_runtime                                   (isolated)
reqro_operator                                  (isolated)
reqro_integration_worker                        (isolated)
```

The one edge exists so a reviewed migration can `SET ROLE` to create the worker
functions under the correct owner (§19). Its options are what keep it from being
a privilege leak:

| Option          | Value                    | Effect                                                                                                                                                                                                                                                                                                                 |
| --------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INHERIT FALSE` | no automatic inheritance | `reqro_migrate` holds **none** of the function owner's DML by virtue of membership. Without an explicit `SET ROLE` it can do nothing the owner can do — the same fail-closed property its existing `reqro_owner` membership relies on, now stated explicitly rather than depending on the role's `NOINHERIT` attribute |
| `SET TRUE`      | `SET ROLE` permitted     | The only capability actually required: assume the owner for the duration of reviewed function DDL                                                                                                                                                                                                                      |
| `ADMIN FALSE`   | no `WITH ADMIN OPTION`   | `reqro_migrate` **cannot grant this membership onward** to any other role, and cannot revoke it. The migration login cannot widen the graph it sits in                                                                                                                                                                 |

PostgreSQL 16 made these per-membership options explicit and PostgreSQL 17 —
which `server/compose.yml` pins — records them in `pg_auth_members` as
`inherit_option`, `set_option` and `admin_option`. Stating them per grant is
stronger than relying on the member role's `NOINHERIT` attribute alone: the
attribute is a role-wide default that a later `ALTER ROLE` could change, whereas
the per-membership option is a property of the edge itself.

Every required property still holds, most of them because no edge exists:

| Required property                                          | How it holds                                                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reqro_runtime` must not inherit worker authority          | no edge exists, and `NOINHERIT` means even an erroneous edge would confer nothing without `SET ROLE`                                                      |
| `reqro_runtime` must not inherit function-owner authority  | no edge from `reqro_runtime` exists at all. The function owner is reachable only from `reqro_migrate`, and only by explicit `SET ROLE`                    |
| Worker must not inherit migration authority                | no edge touches the worker in either direction. The one new edge is `reqro_migrate → reqro_integration_function_owner`, which does not involve the worker |
| Worker must not inherit tenant-domain operator authority   | no edge; `reqro_operator` is isolated and its 7 grants are an unrelated family                                                                            |
| Function owner not a member of worker or application roles | no edge                                                                                                                                                   |
| No circular membership                                     | the graph is two edges from one node outward; `reqro_migrate` is a member of two roles and nothing is a member of it                                      |
| **No indirect path from API runtime to worker functions**  | the only path to a function is an EXECUTE grant, and §10 grants none to `reqro_runtime`. There is no membership route at all                              |

### Future bootstrap tests that prove it fails closed

The bootstrap already contains a fail-closed block that refuses the transaction when the topology is not exactly as intended, and it already asserts: no role is a superuser, creates roles or databases, bypasses RLS **or inherits**; exactly one membership exists; the runtime and operator own nothing; no role holds `CREATE`; and no default privileges exist for any role.

Extending it for the two new roles requires:

1. both new roles exist, with the attributes of §3 and §4;
2. **`reqro_integration_function_owner` is NOLOGIN** and `reqro_integration_worker` is LOGIN;
3. the membership set is still **exactly** `{migrate → owner}` — the existing assertion already enumerates offending memberships, so it extends by adding the two names to its scope;
4. neither new role owns any relation in the application schema — the existing owner check extends the same way;
5. neither new role holds `CREATE` on the schema or database;
6. no default privileges exist for either.

The pattern matters: these are **equality** assertions over the whole topology, not spot checks, so a membership nobody reviewed fails the bootstrap rather than passing unnoticed.

---

## 6. Worker function inventory

> **Three functions. Nothing else.**

### `claim_integration_intent(...)`

|         |                                                                                                                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reads   | `integration_outbox` (eligible rows), `integration_connector` (lifecycle + current semantic revision, row-share-locked), `integration_connector_audit` (the pinned snapshot)                                                                                 |
| Writes  | `integration_outbox` (`state → dispatching`, `claim_generation + 1`, token digest, lease, `attempt_count + 1`); `integration_delivery_attempt` (one **open** row)                                                                                            |
| Returns | bounded dispatch data only: outbox and attempt identity, integration type, aggregate identity and revision, pinned configuration revision, the capability snapshot, and the `credential_reference` **locator**. **No token. No secret. No business payload** |
| Refuses | no eligible row (returns zero rows, not an error); connector not `active`/`degraded`; pinned snapshot missing; aggregate's in-flight slot occupied                                                                                                           |

### `complete_integration_attempt(...)`

|         |                                                                                                                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reads   | the open attempt and its outbox row                                                                                                                                                                             |
| Writes  | settles the attempt open → settled; transitions the outbox state                                                                                                                                                |
| Returns | a bounded result indicating whether the settlement applied                                                                                                                                                      |
| Refuses | **stale ownership** — a non-matching generation or digest matches zero rows, so nothing settles and nothing transitions; a settled attempt (the complete-once guard raises); a transition outside the whitelist |

### `recover_expired_integration_claim(...)`

|         |                                                                                                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reads   | outbox rows in `dispatching` past `claimed_until`                                                                                                        |
| Writes  | settles the **existing** open attempt as `ambiguous` with `lease_expired_uncertain`; clears the claim fields; sets the outbox to `ambiguous`             |
| Returns | a bounded count                                                                                                                                          |
| Refuses | **never silently restores `pending`**; may route to `retrying` only where the capabilities **pinned for that dispatch** declare `supportsIdempotencyKey` |

### Deliberately **not** in the worker surface

**Operator resolution — resolving an ambiguity, authorising a dead-letter replay, cancelling pending work — does not belong here.** The worker's defining limitation is that it cannot make the judgement call an ambiguous irreversible side effect requires; F062.2D-0 §22 routes exactly those decisions to a human with two-person approval and PIM evidence. Putting them in the worker surface would hand the worker the authority the design exists to withhold, and `reqro_integration_worker` would then hold EXECUTE on a function that can assert an outcome nobody observed.

They belong to the operator surface (F062.2D-0 §30, slice 2D-7), owned by a different principal, with operator-audit semantics. **Smallest surface wins:** three functions, one caller, no judgement.

---

## 7. Function parameter contract

**Refused as parameters, without exception:** raw SQL; table, schema or column names; any object identifier; raw destination URLs; credentials or secrets; and arbitrary JSON that could describe a database mutation.

**Permitted:**

| Input                     | Form                                    | Notes                                                     |
| ------------------------- | --------------------------------------- | --------------------------------------------------------- |
| Connector identity        | `uuid`                                  | with its Organization (§13)                               |
| Outbox / attempt identity | `uuid`                                  |                                                           |
| Lease duration            | `interval`, range-checked               | bounded by a platform ceiling inside the function         |
| Worker label              | short bounded `varchar`                 | an instance label for evidence, **not** an identity claim |
| Claim token               | raw token **in**, digest stored         | §14                                                       |
| Claim generation          | `bigint`                                | ownership proof alongside the digest                      |
| Outcome                   | bounded enum, F062.1 `attemptOutcomes`  | check-constrained                                         |
| Reason code               | bounded enum, the F062.2A §8.1 taxonomy | check-constrained                                         |
| Failure category          | bounded enum, F062.1                    | check-constrained                                         |
| Response classification   | bounded enum                            | check-constrained                                         |
| External reference        | bounded `varchar`                       | only where safe                                           |
| Duration                  | `integer` milliseconds, `>= 0`          | the worker measures the call; the database cannot         |

**Server-owned values are generated by the database, never accepted:** `started_at`, `completed_at`, `observed_at`, `created_at`, `mutation_txid`, attempt row id, `attempt_number` and `claim_generation`'s new value. A caller-supplied timestamp is a caller-supplied ordering, and the evidence trail should not be something a worker can shape. `duration_ms` is the one exception and is deliberate: only the caller observed the call, and the database would otherwise measure the round trip to itself.

---

## 8. SECURITY DEFINER hardening — mandatory, with the threat each closes

| Control                                                  | Threat closed                                                                                                                                                                                                                 |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dedicated non-login owner** (§4)                       | Confused deputy with maximal reach. An owner that owns every table makes any flaw in the body authority over every resident record                                                                                            |
| **Fully schema-qualified object references**             | Object shadowing: an unqualified `integration_outbox` resolves through `search_path` at execution time, so a relation or composite type earlier in the path hijacks it                                                        |
| **Explicit `search_path`, `pg_catalog, pg_temp`** (§9)   | Caller-controlled resolution order. Without it the _caller_ chooses which schema the function reads                                                                                                                           |
| **`pg_temp` last**                                       | Temp-object hijacking. A caller can create `pg_temp.integration_outbox`; with `pg_temp` first it would win                                                                                                                    |
| **`REVOKE EXECUTE … FROM PUBLIC`**                       | Privilege escalation to the entire cluster. PostgreSQL's **default grant is PUBLIC**, so this is not optional hygiene — omitting it hands definer authority to every role                                                     |
| **`GRANT EXECUTE` only to the worker principal**         | Role-inheritance and ambient-authority leaks. One named grantee, enumerable by test                                                                                                                                           |
| **No caller-controlled dynamic SQL**                     | SQL injection _with owner privileges behind it_. Any `EXECUTE format(...)` interpolating a parameter is an injection boundary at the privilege boundary                                                                       |
| **No function accepting an object identifier**           | Confused deputy by indirection: a function told which table to write is a general-purpose mutation tool wearing a narrow name                                                                                                 |
| **No unqualified helper calls**                          | Migration 49's measured trap: **a plpgsql call to another function is permission-checked against the effective user**, and hardening `advance_access_revision` alone was _not_ sufficient — its caller had to be hardened too |
| **Bounded return types**                                 | Over-disclosure. `SETOF integration_outbox` hands every column to a caller needing eight                                                                                                                                      |
| **No secret or token in any return value**               | Credential and bearer-token leakage into result sets, logs and traces                                                                                                                                                         |
| **No raw claim token returned, ever**                    | §14 removes the need entirely: the worker generates the token, so no function has one to return                                                                                                                               |
| **No body capable of arbitrary business-table mutation** | Lateral movement. The owner's grants are the hard limit, which is why §11 withholds every business table                                                                                                                      |

Two additional properties worth stating because they are easy to lose:

- **`VOLATILE`, never `STABLE` or `IMMUTABLE`.** A mis-declared mutating function may be called an unexpected number of times by the planner, which for a claim function means duplicate claims.
- **Arguments typed, never `text` catch-alls.** A `uuid` parameter cannot carry a payload; a `text` one can.

---

## 9. `search_path` policy

> **Adopt the repository's existing pattern exactly: `SET search_path = pg_catalog, pg_temp`, with every application object fully qualified.**

All nine of Migration 49's definer functions use precisely this, and the application schema is deliberately **absent** from the path.

| Risk                                                       | How this closes it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Temp-object hijacking**                                  | A caller can create objects in `pg_temp`. With `pg_temp` last, a qualified reference never reaches it. PostgreSQL additionally never searches `pg_temp` for **function or operator** names, so the residual exposure is relations and composite types — which qualification closes                                                                                                                                                                                                                      |
| **Function shadowing**                                     | A same-named function in an earlier schema would be chosen for an unqualified call. With only `pg_catalog` ahead of `pg_temp`, and no `CREATE` on any searchable schema for any role in the topology, there is no earlier schema to plant one in                                                                                                                                                                                                                                                        |
| **Extension interaction**                                  | `pgcrypto` is installed in the shared schema and is reached by qualified reference; the function does not depend on an extension being on the path                                                                                                                                                                                                                                                                                                                                                      |
| **Why qualification is still required with a pinned path** | Because the pin and the qualification close _different_ holes. The pin stops the caller choosing resolution order; the qualification means the function does not depend on resolution order at all. With the app schema absent from the path, an unqualified application reference **fails loudly at execution** rather than resolving to something plausible — which is the stronger property, and the reason this pattern beats the weaker "app schema first, `pg_temp` last" I proposed in F062.2D-0 |

A note against mechanical copying: `pg_catalog` is first because PostgreSQL implicitly searches it first anyway; naming it explicitly documents the intent and prevents a future edit from accidentally placing a writable schema ahead of it.

---

## 10. EXECUTE policy

| Grantee                                | Posture                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PUBLIC**                             | **No EXECUTE on any worker function.** Explicit `REVOKE`, because the default is PUBLIC                                                                                                                                                                                                      |
| **`reqro_runtime`**                    | **No `USAGE` on `reqro_integration_api` and no `EXECUTE` on any worker function.** Its surface stays at exactly eleven functions — and the role-separation suite already asserts _exactly eleven_, so a worker function appearing there fails an existing test rather than needing a new one |
| **`reqro_integration_worker`**         | `USAGE` on `reqro_integration_api`, plus `EXECUTE` on **exactly** the three functions of §6, named individually with their full argument signatures and schema-qualified. No `ALL FUNCTIONS IN SCHEMA`, and **no `CREATE`** on the schema                                                    |
| **`reqro_migrate` / `reqro_owner`**    | May create and replace the functions under change management (§19). `reqro_migrate` holds no authority without `SET ROLE`                                                                                                                                                                    |
| **`reqro_operator`**                   | **No EXECUTE.** Its 7 grants are the tenant-domain family; delivery is not operator work. The operator _resolution_ surface (2D-7) is a separate decision                                                                                                                                    |
| **`reqro_integration_function_owner`** | EXECUTE follows from ownership; it is never a connection, so this is not a usable path                                                                                                                                                                                                       |

Grant style follows `runtime-role.sql`: explicit, per function, fully qualified with the schema variable, and **no default privileges** — so a function added later is unreachable until someone grants it deliberately.

**No grant is applied by this slice.**

---

## 11. Underlying table privileges for the function owner

Minimum operations, granted **to the function owner** by the table owner — and held by the worker LOGIN role **not at all**.

| Table                                     | Function owner needs                                                     | Explicitly not                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `integration_outbox`                      | `SELECT`, `UPDATE`                                                       | **No `INSERT`** — enqueue is the application's path under `reqro_runtime`; a worker that could insert intents could manufacture obligations. **No `DELETE`** |
| `integration_delivery_attempt` _(future)_ | `SELECT`, `INSERT`, `UPDATE`                                             | **No `DELETE`.** `UPDATE` is needed only for the single open → settled transition, which the complete-once guard constrains                                  |
| `integration_connector`                   | `SELECT`, plus `UPDATE (id)` **only if** a row-share lock is taken (§12) | **No general `UPDATE`**, no `INSERT`, no `DELETE`. Connector administration is not worker work                                                               |
| `integration_connector_audit`             | `SELECT`                                                                 | **No `INSERT`** — the worker records no connector history. No `UPDATE`/`DELETE`: the table is append-only by trigger                                         |
| **Every business table**                  | **nothing**                                                              | The outbox exists precisely so a delivery worker never touches resident data                                                                                 |

### The function owner's privilege ceiling

Stated as a closed list, because "minimum" is only meaningful if the maximum is
written down. The function owner may hold **only**:

| May hold                                                                                                                                                            | Must not hold                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ownership of `reqro_integration_api`, with `CREATE` and `USAGE` on it                                                                                               | **`CREATE` on the application schema** — it creates no application object (§4)                                                                                                                                             |
| **`USAGE` on the application schema**, granted explicitly, because schema `USAGE` and table DML are separate privileges and the DML of §11 would otherwise be inert | Anything beyond reachability: `USAGE` confers no read, write or ownership                                                                                                                                                  |
| Ownership of the three worker functions                                                                                                                             | Ownership of any **table, view, sequence or type**                                                                                                                                                                         |
| Exactly the DML of the table above, on exactly four integration tables                                                                                              | Any privilege on **any business table** — no `service_request`, `answer`, `attachment`, `requester_contact`, resident or access-control table                                                                              |
| `SELECT`, and the row-lock column privilege, on `integration_connector`                                                                                             | **Connector administration** — no `INSERT`, no general `UPDATE`, no `DELETE`. It may read and lock a connector for dispatch and nothing more                                                                               |
| Inherent ownership authority over `reqro_integration_api` and its three functions — **intentional, and part of the design**                                         | **`GRANT OPTION` on any privilege granted to it over application or data objects.** It cannot pass on its `SELECT`, `INSERT` or `UPDATE` on the integration tables, so a compromise of it cannot widen access to that data |
| —                                                                                                                                                                   | **Migration authority** — no `CREATE` beyond its own schema, and it is not a member of `reqro_owner`                                                                                                                       |
| —                                                                                                                                                                   | **Operator authority** — no privilege on the `tenant_domain` family                                                                                                                                                        |
| —                                                                                                                                                                   | `LOGIN` — it is a privilege container, never a connection                                                                                                                                                                  |

### The precise `GRANT OPTION` rule

An unqualified "no `GRANT OPTION` on anything" would be **wrong**, because
**ownership inherently confers the ability to grant on the owned object** —
that is not a `GRANT OPTION`, it is what ownership means in PostgreSQL. The
accurate rule has three parts:

1. **No `GRANT OPTION` on any privilege granted to the owner over application
   or data objects.** Its `SELECT`, `INSERT` and `UPDATE` on the four
   integration tables are granted plainly, so it cannot pass them to another
   role. This is a prohibition on ever writing `WITH GRANT OPTION` in the grant
   artifact rather than something to revoke, since PostgreSQL does not add it by
   default — and it is the clause most easily lost in implementation.
2. **Inherent ownership authority exists, and is confined to
   `reqro_integration_api` and the three reviewed functions.** As their owner it
   may alter, replace, or grant `EXECUTE` on them. That authority is
   **intentional**: it is how a migration assuming the role creates and
   maintains the function API at all.
3. **That ownership must never extend to application or business tables.** The
   owner owns no table, view, sequence or type in the application schema, so
   outside its own schema there is no object on which ownership authority
   applies.

The distinction matters because the two are different escalation paths. A
`GRANT OPTION` on integration-table DML would let a compromised owner hand
delivery-data access to any role. Ownership of its own function schema lets it
change its own functions — unavoidable for the design to work, confined to
objects holding no data, and precisely why §15 requires `CREATE OR REPLACE` of a
definer function to be reviewed as a **privilege change** rather than a code
change.

**The `UPDATE (id)` exception, and why it confers nothing.** PostgreSQL requires `UPDATE` privilege on at least one column of a row-locked table, measured in Migration 49. Column-scoped `UPDATE (id)` on `integration_connector` satisfies it, and F062.2B's `guard_integration_connector()` **already refuses any change to `id`** ("Integration connector identity is immutable") — so the privilege is inert by construction. This is exactly the pattern Migration 49 established for Category, where `protect_category_identity` made the granted column inert.

Migration 49 also shows the alternative: route the lock through a SECURITY DEFINER helper returning only a boolean, which avoids the grant entirely. Since the worker's claim is _already_ inside a definer function owned by a role that needs `SELECT` there anyway, the column grant is the simpler of the two and should be preferred — but the choice belongs to the implementing slice, with the measured constraint recorded here.

---

## 12. Row locking and function privilege interaction

The rule, from Migration 49's own analysis: **`SELECT ... FOR UPDATE` and `FOR SHARE` require `UPDATE` privilege on at least one column of the locked table, checked against the effective executing role.**

Inside a SECURITY DEFINER function the effective role is the **function owner**, not the caller. So:

```text
reqro_integration_worker          holds EXECUTE only — no UPDATE anywhere
        |
        | calls
        v
claim_integration_intent()        SECURITY DEFINER
        |                         effective role = reqro_integration_function_owner
        | SELECT ... FOR UPDATE SKIP LOCKED on integration_outbox
        | SELECT ... FOR SHARE on integration_connector
        v
privilege check satisfied by the OWNER's grants, never the worker's
```

**That is the whole mechanism.** The lock privilege is satisfied by a role the worker cannot authenticate as and is not a member of, so no `UPDATE` is ever granted to `reqro_integration_worker`. Row-lock semantics are preserved exactly — `FOR UPDATE SKIP LOCKED` for claiming, `FOR SHARE` on the connector to close F062.2C's read-then-pin race — because the lock is taken inside the function, in the caller's transaction, with the owner's privileges.

This is the same resolution Migration 49 reached for six reference tables, applied to a mutating surface instead of a read-only one.

**No function is implemented by this slice.**

---

## 13. Tenant isolation inside worker functions

**Function-owner privilege must not become a tenant bypass.** The owner can see every row in all four tables; that is unavoidable, and it is why isolation must be a property of the queries and the schema rather than of the privilege.

| Requirement                                   | Mechanism                                                                                                                                                                                                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization-qualified lookup                 | Every predicate carries `organization_id`. No function reads a row by bare primary key                                                                                                                                                                               |
| Composite tenant-safe keys                    | Already structural: `integration_outbox` composite-FKs `(organization_id, integration_connector_id)` to `integration_connector(organization_id, id)`, so a cross-Organization reference is **inexpressible**, not merely unqueried                                   |
| No global lookup that can cross Organizations | No function accepts a connector or outbox identity without its Organization; there is no "find work across all tenants" entry point                                                                                                                                  |
| **No caller-supplied tenant override**        | The Organization is read **from the row**, never substituted from a parameter. A worker cannot pass a different `organization_id` to retarget an intent, because the claim resolves the Organization from the outbox row it selected and the connector FK must agree |
| Generic not-found                             | A row in another Organization is indistinguishable from a non-existent one: zero rows, no error detail. The repository layer already does this for `connector_unknown`                                                                                               |

**The database remains authoritative.** The composite FKs, the pinned-snapshot guard and the state-machine triggers hold regardless of which role calls them. The function's job is to avoid _asking_ a question that crosses tenants; the schema's job is to make the answer impossible.

---

## 14. Claim token handling

Carried forward from F062.2D-0 unchanged: CSPRNG, ≥128 bits, raw value in worker memory only, digest-only storage, bound to attempt + outbox + generation, never logged, traced, metric-labelled or placed in a URL, and a restart cannot recreate a prior token.

### Where the digest comparison belongs

> **In the SQL function, as a predicate on the mutating statement. Not in application code, and not in both.**

| Option                     | Assessment                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SQL function predicate** | **Recommended.** The comparison and the mutation are one statement, so there is no window between checking ownership and acting on it. A stale worker's settle matches **zero rows** — a result it cannot ignore — rather than receiving a boolean it might mishandle. And no digest ever leaves the database |
| Application code           | Rejected. It requires **reading the digest out**, which puts the verification material in application memory, logs and potentially an operator read surface. It also creates a check-then-act window across a network round trip                                                                              |
| Both                       | Rejected, because "both" implies the application also reads the digest, inheriting that weakness for no additional guarantee. The SQL predicate is already strictly stronger                                                                                                                                  |

### A refinement to F062.2D-0

F062.2D-0 described the claim function as _"returning the token to the worker"_. On reflection that is unnecessary and slightly worse: **the worker generates the token with its own CSPRNG and supplies it as a parameter**, and the function stores only `digest(token)`. No function ever returns a token, so there is no token in any result set, log line or query plan. This is strictly consistent with F062.2D-0's rules — worker-generated, memory-only, digest-stored — and removes an exposure that document's phrasing implied.

### Carrying the raw token into SQL

The token has to reach the database once, as a parameter to the claim function.
That single crossing is the only place a raw token exists outside worker memory,
so the rules for it are explicit rather than assumed. These **supplement**, and
do not replace, the no-log / no-trace / no-metric-label rule.

| Requirement                                                                                      | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Bind parameters only — never string interpolation**                                            | A token interpolated into SQL text becomes part of the statement, and statement text is the most widely captured artifact in any database: `pg_stat_statements`, `log_statement`, error context, `EXPLAIN` output and application query logs. A bind value is none of those things                                                                                                                                                               |
| **The token never appears in SQL text**, including in comments, hints or a constructed predicate | Same reason, stated as the property rather than the technique, so a future change that builds SQL differently is still covered                                                                                                                                                                                                                                                                                                                   |
| **Protected from bind-value logging on both sides**                                              | `log_statement = 'all'` does not log bind values, but `log_min_duration_statement` with `log_parameter_max_length` **does**, as does an application-side query logger configured to echo parameters. The deployment must set `log_parameter_max_length = 0` for the worker's connections, or the worker must be configured so its parameters are never echoed — and this is a **deployment requirement**, not something the function can enforce |
| **Hashing and verification happen inside the function**                                          | The raw token is hashed to a digest by the SECURITY DEFINER function; no digest is computed in application code and no digest is read back out. The application never holds verification material                                                                                                                                                                                                                                                |
| **Verification and mutation are atomic**                                                         | The digest comparison is a predicate on the mutating statement, so there is no window between establishing ownership and acting on it (§14)                                                                                                                                                                                                                                                                                                      |
| **Only the digest persists**                                                                     | No column anywhere holds the raw token — not in the outbox, not in the attempt table, not in any audit row                                                                                                                                                                                                                                                                                                                                       |

One consequence worth drawing out: because the claim function **receives** the
token rather than returning one, the raw value crosses the boundary exactly
once, in one direction, as one bind parameter. Every subsequent call —
`complete_integration_attempt` — carries it the same way for verification, and
no call ever returns it.

### On constant-time comparison

A SQL `=` on a digest is not constant-time, and that is acceptable here — stated explicitly rather than assumed. A timing oracle requires many attempts with observable feedback, and the only principal able to call the function is the worker itself; an attacker who can call it already holds the worker's identity, at which point timing is irrelevant. The threat that matters is **forgery**, and it is closed by 128 bits of CSPRNG entropy over a value bound to a specific attempt and generation. Where a comparison ever does happen in application code, it should be constant-time — but §14's recommendation is that it should not happen there at all.

---

## 15. Auditability

The two records answer different questions and must not be conflated.

### Database evidence — what happened

Outbox state transitions; per-attempt evidence with `started_at`/`completed_at`; `claim_generation`; bounded outcome, failure category and reason code; `mutation_txid`. Written automatically by the worker through the three functions. **This is machine evidence, and it must not be dressed up as human decision-making** — a worker settling an attempt is not an operator approving anything.

### Security and operator audit — who decided

Manual ambiguous resolution; dead-letter replay authorisation; connector lifecycle and credential-reference changes; **worker role and grant changes**. These carry operator identity, reason, correlation and independent approval where §22 of F062.2D-0 requires it. The existing `tenant_domain_operator_approval` pattern is the precedent: `expected_revision`, a single-use partial unique index on the approval, and a deferred constraint trigger that aborts a change lacking evidence.

### DDL and grant changes that must go through deployment change control

| Change                                          | Control                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creating either new role                        | Bootstrap artifact, applied by the provisioning administrator (§19); reviewed as infrastructure, not as application code                                                                                                                       |
| Granting table privileges to the function owner | Reviewed grant artifact, applied as the table owner after migrations                                                                                                                                                                           |
| Granting EXECUTE to the worker                  | Same artifact; the grant is the capability, so this is the security-relevant line                                                                                                                                                              |
| Creating or replacing a worker function         | Migration, under ordinary migration review — **and `CREATE OR REPLACE` is the risk**, since replacing a definer function changes privileged behaviour without changing any grant. It must be reviewed as a privilege change, not a code change |
| Changing the role-membership graph              | Bootstrap, and the fail-closed topology block must refuse anything unreviewed (§5)                                                                                                                                                             |

---

## 16. Authentication model

> **Recommended: Entra workload identity / managed identity, secretless, with short-lived tokens. No stored password.**

| Option                                     | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Entra workload / managed identity**      | **Recommended.** No secret at rest, automatic rotation, and the identity is attributable in the destination's own audit. F060.3C-2e-2A established the mechanics concretely: on Azure PostgreSQL Flexible Server the **token is the password**, and `pgaadauth_create_principal_with_oid(roleName, objectId, 'service', false, false)` accepts an arbitrary role name — so the database principal can keep the literal name `reqro_integration_worker` while mapping to a managed identity's object ID, **with no application code change** |
| Short-lived token without managed identity | Acceptable fallback; still needs something to obtain the token, which usually reintroduces a bootstrap secret                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Password secret                            | **Not recommended.** It moves the problem into the secret manager the worker also needs for connector credentials, and creates a long-lived credential whose rotation is manual                                                                                                                                                                                                                                                                                                                                                             |
| Client certificate                         | Not recommended here; adds PKI lifecycle for no gain over managed identity on the target platform                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### What must be proven before production

1. **Tenant binding** — which Entra tenant, and that it is the approved one;
2. **The exact managed or workload identity**, by immutable object ID, not display name;
3. **The database principal mapping** — that the identity maps to `reqro_integration_worker` and to nothing else;
4. **Token audience** — scoped to the database resource, not a general-purpose token;
5. **Expiry and renewal** — the worker refreshes before expiry, and an expired token fails closed (§18) rather than falling back;
6. **No credential reuse by the API runtime** — the API's identity must not be able to obtain a token that maps to the worker principal. This is the property that makes §17 real, and it must be proven at the identity layer as well as the deployment layer.

**No authentication is implemented, and no identity is created.**

---

## 17. Worker and database connection separation

```text
API process     --> reqro_runtime connection pool              (76 table grants, 11 EXECUTE)
Worker process  --> reqro_integration_worker connection pool   (0 table grants, 3 EXECUTE)
```

**No shared pool, and no code path in the resident or staff API process able to borrow the worker pool.** With separate-process deployment this is structural: the API process has no worker credential, obtains no worker token, and holds no connection string that maps to the worker principal. There is nothing to borrow.

This is the concrete reason F062.2D-0 recommended separate-process deployment over the alternatives. In-process execution would place both pools in one process, where the guarantee degrades to "no code path does this" — a property no constraint enforces and no test proves for all future code. The identity model and the deployment model are one decision, not two.

---

## 18. Fail-closed behaviour

**In every case: refuse, record if possible, and never fall back to `reqro_runtime`, `reqro_migrate` or any other credential.**

| Condition                             | Behaviour                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker identity missing or unmapped   | Worker fails to start. **Not ready**, no claiming. A worker that cannot authenticate as itself must not run at all                                                                                      |
| Function missing                      | Startup readiness check fails. The worker does not attempt direct table access as a fallback — there is no privilege for it anyway, which makes the fail-closed path structural rather than behavioural |
| `EXECUTE` denied                      | Same: readiness fails, loudly. A permission error is a topology error, not a transient fault to retry                                                                                                   |
| Claim function returns malformed data | Refuse to dispatch; nothing was sent. The claim is left to expire and recover as `ambiguous` by lease, since Reqro cannot prove it did not act                                                          |
| Database timeout during claim         | No claim committed; nothing sent; retry the loop. Definitely safe — the transaction either committed or it did not                                                                                      |
| Database timeout during settle        | The attempt stays open and recovers as `ambiguous` by lease. This is the honest outcome: the external call already happened                                                                             |
| Stale token                           | Zero rows settled, zero rows transitioned. Worker records a fenced completion in its own telemetry and **discards its outcome without retrying**                                                        |
| Stale generation                      | Identical to stale token; both are in the same predicate                                                                                                                                                |
| Cross-tenant lookup                   | Zero rows, generic not-found. No error detail distinguishing "other tenant" from "absent"                                                                                                               |
| Role topology mismatch                | The bootstrap refuses the transaction (§5). Deployment stops before a worker could run                                                                                                                  |
| Expired database auth token           | Connection fails; the worker refreshes and retries the connection. **No fallback credential.** An in-flight dispatch whose settle cannot connect recovers as `ambiguous` by lease                       |

The pattern throughout: an uncertain outcome becomes `ambiguous` and waits for evidence or a human, and a certain failure becomes a recorded refusal. Nothing becomes `pending` again by default.

---

## 19. Bootstrap and change-management split

> **Three artifacts, three lifecycles — matching the split this repository already uses.**

| What                                                 | Where                                                                                                                                                                               | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Role creation** (`CREATE ROLE` for both new roles) | `deploy/database/bootstrap-roles.sql`, extended                                                                                                                                     | Its own header states it is **"the only artifact in the repository that creates roles"**, and it runs as the provisioning administrator with `CREATEROLE`. Roles are cluster-level objects; `reqro_migrate` is deliberately `NOCREATEROLE`, so a migration **cannot** create them even if one tried                                                                                                                                                                                                                                       |
| **Function DDL** (the three worker functions)        | A **migration**, following Migration 49                                                                                                                                             | Functions are schema objects whose lifecycle belongs with the schema, and Migration 49 already created nine definer functions this way. Migrations run as `reqro_migrate` with `SET ROLE`, so the function would be owned by whichever role the migration assumes — which means the migration must `SET ROLE reqro_integration_function_owner` explicitly, and that requires the migration login to be a member of it. **That is the one new membership edge this design would need, and it is a reason to prefer the alternative below** |
| **Grants** (owner table privileges, worker EXECUTE)  | A **new reviewed artifact**, `deploy/database/integration-worker-role.sql`, parallel to `runtime-role.sql` and `operator-role.sql`, applied as the table owner **after** migrations | Grants are the capability. Keeping them in a reviewed artifact rather than a migration is this repository's established position — every migration here grants nothing — and it keeps the security review on one readable file                                                                                                                                                                                                                                                                                                            |

### The ownership wrinkle, stated rather than glossed

A migration that creates a function owned by `reqro_integration_function_owner` must assume that role, which requires `reqro_migrate` to be a member of it — adding a membership edge §5 would rather not have. Two resolutions, for the implementing slice to choose with review:

1. **Create the functions in the bootstrap/grant artifact instead of a migration**, applied by the provisioning administrator or the table owner. Keeps the membership graph empty; costs the functions their place in migration ordering and the migration test harness.
2. **Allow `reqro_migrate → reqro_integration_function_owner`**, accepting one more edge. Because `reqro_migrate` is `NOINHERIT`, it holds nothing without an explicit `SET ROLE`, and it already has a membership of exactly this shape to `reqro_owner`. The topology assertion would move from "exactly one membership" to "exactly these two".

**Recommendation: option 2, with the edge's options pinned.** The membership is
granted as `INHERIT FALSE, SET TRUE, ADMIN FALSE` (§5), which makes it inert
unless a migration explicitly assumes the role and prevents the migration login
from regranting or revoking it. It is consistent with the existing
`reqro_migrate → reqro_owner` pattern, and keeping function DDL in migrations
preserves the review, ordering and test harness that 51 migrations already rely
on. Option 1 trades a reviewable, option-constrained edge for an unversioned
privileged object, which is the worse trade.

Because the functions live in their own schema (§4), the migration's `SET ROLE`
creates objects only in `reqro_integration_api` — so even during function DDL
the assumed role cannot create anything in the application schema, having no
`CREATE` there.

---

## 20. Environment separation

| Requirement                                  | Rule                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Environment-specific identities**          | A distinct worker principal and a distinct managed identity per environment. The role _name_ may be identical across environments — the clusters are distinct — but the authenticating identity must not be                                                                                                               |
| **No cross-environment authentication**      | A test or staging worker identity must **not** be able to authenticate to the production database. With managed identity this is enforced by mapping: the production cluster maps only the production identity's object ID                                                                                                |
| **No development credentials in production** | `server/deploy/local/01-roles.sql` contains deliberately obvious placeholder passwords and is referenced only by `compose.yml`; the production artifacts set **no password at all**. A worker role must follow the same rule — the local artifact may give it a placeholder, and the production artifact must set nothing |
| Test posture                                 | Database suites run as the test owner in a disposable schema, so they need no worker credential. Role-topology tests build their own cluster, as `database-role-separation` already does                                                                                                                                  |

---

## 21. Future role and grant tests

To be added to `database-role-separation.integration.test.ts`, which already builds its own cluster:

| Assertion                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both roles exist, with the exact attribute sets of §3 and §4                                                                                                                                                                |
| `reqro_integration_function_owner` is **NOLOGIN**; `reqro_integration_worker` is **LOGIN**                                                                                                                                  |
| Neither is superuser, creates roles or databases, bypasses RLS, or inherits                                                                                                                                                 |
| The membership set equals exactly the approved graph (§5, §19) — an **equality** assertion, so an unreviewed edge fails                                                                                                     |
| **The new edge's options, read from `pg_auth_members`**: correct `roleid`/`member` direction (`roleid` = function owner, `member` = `reqro_migrate`), `inherit_option = false`, `set_option = true`, `admin_option = false` |
| `reqro_migrate` without `SET ROLE` can perform **no** function-owner DML — attempted and refused, proving `inherit_option = false` behaviourally and not only by catalogue                                                  |
| `reqro_migrate` **cannot grant** the function-owner membership to another role — attempted and refused, proving `admin_option = false`                                                                                      |
| `reqro_integration_worker` has `USAGE` on `reqro_integration_api` and **no `CREATE`** on it                                                                                                                                 |
| `reqro_integration_worker` has **no `USAGE`** on the application schema                                                                                                                                                     |
| `reqro_runtime` has **no `USAGE`** on `reqro_integration_api`                                                                                                                                                               |
| `PUBLIC` has no privilege on `reqro_integration_api`                                                                                                                                                                        |
| The function owner holds **no `CREATE`** on the application schema                                                                                                                                                          |
| The function owner holds **no `GRANT OPTION`** on any privilege granted over an application or data object — asserted from `information_schema.role_table_grants.is_grantable`                                              |
| The function owner **owns** `reqro_integration_api` and the three functions, and **owns no relation** in the application schema                                                                                             |
| The function owner holds **`USAGE`** on the application schema; `reqro_integration_worker` holds **none**                                                                                                                   |
| **`reqro_runtime` cannot execute any worker function** — attempted and refused                                                                                                                                              |
| `reqro_runtime`'s EXECUTE surface is still **exactly eleven** functions (the existing assertion, which now also proves no worker function leaked in)                                                                        |
| `reqro_integration_worker` **can** execute exactly the three approved functions                                                                                                                                             |
| `reqro_integration_worker` **cannot** `UPDATE`, `INSERT` or `DELETE` any integration table directly — attempted and refused                                                                                                 |
| `reqro_integration_worker` holds no privilege on any business table                                                                                                                                                         |
| **PUBLIC cannot execute** any worker function                                                                                                                                                                               |
| `reqro_migrate` retains its change authority, and holds nothing without `SET ROLE`                                                                                                                                          |
| The function owner owns **only** the three functions and **no relation**                                                                                                                                                    |
| The function owner's table privileges equal exactly the §11 matrix                                                                                                                                                          |
| A cross-tenant call fails closed with generic not-found                                                                                                                                                                     |

---

## 22. Future function-security tests

| Attack / property                   | Test                                                                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`search_path` hijacking**         | Create a schema containing a decoy `integration_outbox`, prepend it to the caller's `search_path`, call the function, and assert the real table was used             |
| **`pg_temp` shadowing**             | Create `pg_temp.integration_outbox` and `pg_temp.integration_connector` as decoys, call the function, assert no decoy read or write                                  |
| **Malicious helper shadowing**      | Create a same-named helper function in a caller-visible schema and assert the hardened function still calls the qualified one — the regression Migration 49 measured |
| **Dynamic SQL absence**             | Source assertion: no `EXECUTE` of a constructed string anywhere in the function bodies                                                                               |
| Stale claim token                   | Settle with a wrong token: zero rows, nothing settled, nothing transitioned                                                                                          |
| Wrong generation                    | As above, independently                                                                                                                                              |
| Wrong Organization                  | Claim or settle with a mismatched Organization: generic not-found                                                                                                    |
| Malformed outcome or reason         | Out-of-vocabulary values refused by check constraint                                                                                                                 |
| **Direct table mutation refusal**   | As `reqro_integration_worker`, attempt `UPDATE integration_outbox`: permission denied                                                                                |
| **Arbitrary function call refusal** | As `reqro_integration_worker`, attempt to call a non-approved function including Migration 49's lock helpers: permission denied                                      |
| Object-identifier parameter absence | Source assertion: no function signature accepts a `regclass`, `regproc`, or a `text` parameter used as an identifier                                                 |

---

## 23. Threat model

| Threat                                   | Mitigation                                                                                                                                                                                                                    | Layer           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **SQL injection**                        | No dynamic SQL; typed non-`text` parameters; no object identifiers accepted; bounded enums check-constrained                                                                                                                  | function design |
| **`search_path` hijacking**              | `pg_catalog, pg_temp` pinned; every object fully qualified; app schema absent from the path so an unqualified reference fails loudly                                                                                          | function + §9   |
| **Privilege escalation**                 | `REVOKE EXECUTE FROM PUBLIC`; one named grantee; no default privileges; no `CREATE` for any role in the topology                                                                                                              | grants          |
| **Confused deputy**                      | Narrow non-login owner whose entire privilege set is DML on four integration tables; no business-table grant; bounded return types                                                                                            | §4, §11         |
| **Role-inheritance leak**                | Empty membership graph for the new roles; `NOINHERIT` everywhere; equality assertion over the whole graph                                                                                                                     | §5              |
| **Stale worker mutation**                | Fencing on generation + digest inside the mutating statement; zero-row settle; complete-once guard raises on a settled row                                                                                                    | §14             |
| **Forged claim**                         | 128-bit CSPRNG token bound to attempt + outbox + generation; digest-only storage; no derivation path from identifiers                                                                                                         | §14             |
| **Cross-tenant mutation**                | Organization-qualified predicates; composite FKs making a cross-tenant reference inexpressible; Organization read from the row, never from a parameter                                                                        | §13             |
| **API process impersonating the worker** | Separate process with no worker credential and no token audience for it; separate pools; identity-layer proof that the API identity cannot obtain a worker token                                                              | §16, §17        |
| **Compromised worker principal**         | EXECUTE on three functions only; no table privilege; no business-table reach; cannot resolve ambiguities or authorise replay                                                                                                  | §3, §6          |
| **Compromised function owner**           | NOLOGIN, so it is not directly reachable; privileges bounded to four tables; owns no relation, so it cannot alter schema                                                                                                      | §4              |
| **Malicious migration or change**        | Function DDL under migration review, with `CREATE OR REPLACE` of a definer function treated as a **privilege change**; grants in a separate reviewed artifact; role DDL in the bootstrap under the fail-closed topology check | §15, §19        |

One observation that cuts across several rows: **the empty membership graph is doing more security work than any single control.** Most of the escalation paths above — runtime reaching worker authority, worker reaching migration authority, function owner reaching application roles — are closed not by a check but by the absence of an edge, which is why §5 and §21 assert the graph by equality rather than by spot checks.

---

## 24. ADR recommendation

> **Yes — an ADR is warranted. No number is allocated here, and the index is not edited.**

The durable decisions this record contains are not implementation details:

- that the integration worker is a **distinct database principal**, not the application runtime;
- that its authority is **function-mediated**, so the delivery state machine lives in the database;
- that privileged integration functions are owned by a **narrow non-login role** rather than the schema owner — a departure from the nine existing definer functions, and the first in this repository;
- that authentication is **secretless workload identity**;
- that role DDL, function DDL and grants have **three separate lifecycles**.

Each will be referenced by later slices and would otherwise be rediscovered from a feature document. The ADR should be allocated by the implementing slice, which must take the next unused number from the authoritative index rather than inheriting one from here.

---

## 25. Implementation readiness

**Nothing is enabled by this assessment, and no worker may run.**

| Slice                                                             | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F062.2D-2 — delivery-attempt schema and fencing state machine** | **Safe to begin once three things are approved**: (1) this identity decision, (2) the **maximum pending age** policy, because the dead-letter edge's criteria are part of the state machine's meaning, and (3) the §19 migration/grant ownership path, since it determines whether the functions arrive by migration and whether the one membership edge is accepted. Without (1) its role tests assert nothing meaningful; without (2) it encodes a guessed edge |
| **F062.2D-3 — role and grant provisioning**                       | After 2D-2. Creates the two roles in the bootstrap and the grants in the new artifact                                                                                                                                                                                                                                                                                                                                                                             |
| **F062.2D-4 — inert claim loop, loopback adapter only**           | After 2D-3. First worker-shaped code, with no egress and no credentials                                                                                                                                                                                                                                                                                                                                                                                           |
| Later slices                                                      | Unchanged from F062.2D-0 §30                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Remaining blockers

**Hard:**

1. **This decision** — needs approval.
2. **Maximum pending age and expiry action.** Blocks 2D-2. Unchanged.
3. **The §19 ownership path** — new in this slice. Whether function DDL arrives by migration, and whether `reqro_migrate → reqro_integration_function_owner` is accepted. Recommendation in hand.
4. **Secret-manager decisions.** Block the secret-resolution slice.
5. **First destination's actual API documentation.** Blocks any real connector.
6. **Destination semantics in the connector snapshot** (F062.2D-0 §12). Blocks dispatch to a real destination.
7. **Approved snapshot mode or an exact reconstruction invariant.** Immutable historical business-event types are not enqueueable; the reviewed `state_sync` / `current_state_projection` contract is available and is what a first worker would carry.

**F061-owned:** the four missing worker metric concepts and the `healthSignal` gap, with `oldest pending age` a release gate for any worker reaching a real destination. **Not edited here.**

**Reported, not acted on:** the `reqro_production` row in F062.2D-0 §1 (see §1 above).

---

## Related

- [F062.2D-0 — Delivery worker security and operational readiness](F062-2D-0-delivery-worker-security-readiness.md) — the assessment this decides
- [F062.1 — Enterprise integration contracts foundation](F062-1-integration-contracts-foundation.md) — the authoritative state and outcome vocabularies
- [F062.2A — Transactional outbox persistence readiness](F062-2A-transactional-outbox-persistence-readiness.md) — the fencing and attempt-evidence model
- [F062.2B — Connector metadata persistence foundation](F062-2B-connector-metadata-persistence-foundation.md) — the identity-immutability guard §11 relies on
- [F062.2C — Transactional outbox and atomic enqueue](F062-2C-transactional-outbox-atomic-enqueue.md) — the intents a worker would claim
- [F060.3C-2D — Database role separation](F060-3C-2D-database-role-separation.md) — the four-role topology this extends
- [ADR-027 — Platform operator bootstrap and recovery](../architecture/decisions/ADR-027-platform-operator-bootstrap-recovery.md) — the bootstrap model role DDL belongs to
- [ADR-024 — Transaction-time request authorization](../architecture/decisions/ADR-024-transaction-time-request-authorization.md) — the uncertain-result rule the fail-closed behaviour rests on
