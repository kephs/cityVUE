# F060.3C-2b — Production-capable tenant-domain operator command (ADR-027)

Status: **implemented locally, stopped for security review.** Not staged, not
committed, not pushed, not deployed.

> **The production-capable CLI exists after F060.3C-2b, but production use
> remains unauthorized until F060.3C-2c and the required infrastructure
> controls are complete.** This file existing is not permission to run it
> against a customer deployment.

## Authorization and baseline

Implemented under the F060.3C-2b authorization. Branch
`claude/production-tenant-domain-cli` from `origin/main` at
`2c17e1f08413e1cc6170d994cbb180e2fef6af5e`, clean index and working tree. No
migration was created; 47 remain. No dependency change.

## Trust model: infrastructure IAM, not application login

Infrastructure IAM is the authentication trust root. The ability to start a
one-shot job inside the target deployment **is** the authority, because that
operator could otherwise change the deployment itself. The application
therefore records **attribution, never authentication**:

- `REQRO_OPERATOR_IDENTITY` must be **injected by trusted infrastructure** from
  the current per-human IAM principal. It **must not be an operator-editable
  free field** in a production job definition.
- The command validates that value's _shape_ — scheme, grammar, and refusal of
  a development scheme in a serving environment — and records it for audit.
- It does **not** verify who supplied it, and does not pretend to. No Entra or
  device-code login, no local authentication fallback, no bootstrap token, no
  platform principal table, and no HTTP or browser control plane.

The intended execution model is: human operator → infrastructure IAM with
just-in-time elevation → one-shot job inside the target deployment → secret
manager injects the database credential → this command → reviewed
tenant-domain operations only. It is explicitly **not** intended to run from an
administrator workstation holding production credentials.

## Separate development and production commands

|             | Development                                                                                                              | Production-capable                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Entry point | `src/database/tenant-domain-cli.ts`                                                                                      | `src/database/tenant-domain-operator-cli.ts`                                           |
| Script      | `dev:tenant-domain`                                                                                                      | `operator:tenant-domain`                                                               |
| Gate        | development `NODE_ENV` + profile, `TENANT_DOMAIN_OPERATOR_CONFIRM`, hard pin to `localhost`/`reqro_dev`/`reqro_dev_user` | explicit environment target, deployment-marker equality, connection identity assertion |
| Targets     | development only                                                                                                         | `test`, `staging`, `production` — **never** development                                |

**The development command is unchanged, byte for byte.** Its development guard
was deliberately not relaxed: removing it would convert a tool whose safety is
structural ("it can only reach the dev box") into one whose safety depends on
an operator setting the right variable. No existing script was renamed.

## Verb surface

Exactly seven verbs, as a closed `as const` allowlist asserted by test:

| Verb              | Independent approval                                             |
| ----------------- | ---------------------------------------------------------------- |
| `register`        | no                                                               |
| `issue-challenge` | no                                                               |
| `verify`          | no                                                               |
| `deactivate`      | **no** — incident response must never wait for a second operator |
| `activate`        | **yes**                                                          |
| `revoke`          | **yes**                                                          |
| `approve`         | n/a — records an approval for `activate` or `revoke`             |

Absent by construction and asserted by source test: no listing or discovery
verb, no aggregate onboarding verb, no raw SQL or arbitrary statement, no
Organization lifecycle mutation, no tenant-data access, and no break-glass of
any kind. Verification and activation remain separate commands, and
deactivate-before-revoke is preserved, so no single command can take a
hostname from unregistered to live or destroy ownership evidence on a live
hostname.

Every operation targets an explicitly supplied Organization **and** hostname.
There is no form of the command that operates on "all domains".

## Environment, deployment and database identity gates

Four required inputs, checked in this order, all **before** any connection:

1. **`REQRO_OPERATOR_ENVIRONMENT`** — what the operator intends: `test`,
   `staging` or `production`. `development` is refused with its own message.
2. **`REQRO_DEPLOYMENT_ENVIRONMENT`** — the infrastructure-owned marker of what
   this deployment _is_, not supplied interactively. It must **exactly equal**
   the requested target.
3. **`REQRO_OPERATOR_DATABASE`** and **`REQRO_OPERATOR_DATABASE_USER`** — plain
   PostgreSQL identifiers, pattern-validated.

Requirement 2 is the load-bearing one. `NODE_ENV` admits only
`development | test | production`, so **staging and production are
indistinguishable** by runtime configuration alone — both are `production` with
a client profile. Equality against an infrastructure-owned marker is what
prevents a staging command running against production.

Then, per target:

| Target                  | Runtime required                                                             | Database identity                                                                  |
| ----------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `staging`, `production` | `NODE_ENV=production`, client profile, `TENANT_RESOLUTION_STRATEGY=registry` | must not be a development or test database or role; must not be a loopback address |
| `test`                  | `NODE_ENV=test`, development profile                                         | must be a test database **and** test role                                          |

Registry resolution is required for a serving target because an operator must
not register or activate a hostname in a deployment that resolves tenants by
configured development Organization rather than by the registry those rows
feed.

**Connection identity assertion.** Before the first mutation transaction the
command queries only `current_database()`, `current_user` and
`inet_server_addr()`, and refuses unless the first two equal the declared
target. The names are read back **from the server**, not from the connection
string, so a substituted or mismatched `DATABASE_URL` is refused before
`BEGIN`. For a serving target it additionally refuses development and test
names and an explicit loopback address.

A null server address means a local socket and is **not** safely
distinguishable, so it is deliberately treated as evidence neither way — an
honest limit rather than a guess.

No customer secret, hostname or domain is encoded in source: only generic
environment names and patterns for development and test identifiers.

## Attribution input contract

Individually named, individually validated environment variables. **No
free-form JSON or payload** that could carry an unvalidated key through.

| Input                                                       | Required for                | Notes                                                                 |
| ----------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------- |
| `REQRO_OPERATOR_IDENTITY`                                   | all                         | `iam:` or `oidc:` in a serving environment; `dev:` refused there      |
| `REQRO_OPERATOR_REASON`                                     | all                         | 12–500 characters, validated by the operations layer and Migration 47 |
| `REQRO_OPERATOR_CORRELATION_ID`                             | all                         | UUID                                                                  |
| `REQRO_OPERATOR_ORGANIZATION_ID`                            | all                         | UUID                                                                  |
| `REQRO_OPERATOR_HOSTNAME`                                   | all                         | canonical normalizer output                                           |
| `REQRO_OPERATOR_EXPECTED_REVISION`                          | every change                | positive integer                                                      |
| `REQRO_OPERATOR_APPROVAL_ID`                                | `activate`, `revoke`        | **refused for every other verb**                                      |
| `REQRO_OPERATOR_REQUESTER_IDENTITY`                         | `approve` only              | **refused for every other verb**                                      |
| `REQRO_OPERATOR_ROLE`                                       | `register`                  | closed role set                                                       |
| `REQRO_OPERATOR_CHALLENGE_LIFETIME_DAYS`                    | optional, `issue-challenge` | 1–30                                                                  |
| `REQRO_OPERATOR_DNS_TIMEOUT_MS`, `REQRO_OPERATOR_DNS_TRIES` | optional, `verify`          | bounded                                                               |

Arguments carry only the verb, the approved operation for `approve`, and the
mode. **Secrets are never accepted through argv**, and argv is read solely for
those positions — asserted by test. Environment variables are preferred for
attribution even though identity and reason are not secrets: in the one-shot
job model the job definition is the auditable record of the request, the
orchestrator sets it rather than a human typing it, and keeping the request
shape uniform means no future field accidentally becomes the one in argv.

All verb-specific inputs are resolved and validated **before the connection
pool exists**, so a malformed request is refused with its own result code
instead of surfacing later as a database failure.

## Approval workflow

Three separate one-shot invocations, no persistent control-plane API:

1. **Operator A plans.** A runs the intended high-impact operation with
   `--dry-run` and no approval identifier, obtaining a sanitized exact-context
   plan marked `commitEligibility: pending_approval`. No approval record is
   created by A, and the plan explicitly does not claim the mutation would
   commit.
2. **Operator B approves.** B runs `approve activate --confirm` (or
   `approve revoke`). `approved_by` is **B's own injected
   `REQRO_OPERATOR_IDENTITY`** — there is no `approvedBy` input, so B cannot
   record an approval in anyone else's name. B names A through
   `REQRO_OPERATOR_REQUESTER_IDENTITY`.
3. **Operator A consumes.** A runs the mutation with
   `REQRO_OPERATOR_APPROVAL_ID`.

Migration 47 then enforces, in PostgreSQL: consuming identity equals
`requested_by`; consuming identity differs from `approved_by`; exact
Organization, binding, operation, revision and state match; the approval is
unexpired within its database-derived 24-hour window; it was committed in a
separate transaction; and it is single-use. A self-approval attempt — running
`approve` while naming yourself as requester — is refused by the
`requested_by <> approved_by` constraint.

`approve` has **no dry run**: creating an approval has no registry state to
validate and discard, so a dry run would silently write it.

> **The two-human property rests on distinct per-human infrastructure
> identities.** The application cannot authenticate either operator, so if
> infrastructure issues one shared identity the separation becomes cosmetic.
> This is an infrastructure prerequisite, not a convention.

## Dry-run behaviour

An approval-required operation has **two distinct dry-run states**, and the
difference is machine-readable so a plan can never be mistaken for proof that
the mutation would commit. The seven verbs are unchanged; no `plan` or other
command was added.

|                     | Pre-approval dry run                          | Post-approval dry run                                 | Confirm                                   |
| ------------------- | --------------------------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| Invocation          | `activate --dry-run`, no approval id          | `activate --dry-run` with the approval id             | `activate --confirm` with the approval id |
| `mutation`          | `not_executed`                                | `not_executed`                                        | `executed`                                |
| `approvalRequired`  | `true`                                        | `true`                                                | `true`                                    |
| `approvalPresent`   | `false`                                       | `true`                                                | `true`                                    |
| `commitEligibility` | `pending_approval`                            | `validated`                                           | `committed`                               |
| What ran            | read-only inspection of the one named binding | the real transaction, every constraint, then rollback | the real transaction, committed           |
| Approval consumed   | n/a — none exists                             | **no**, the rollback leaves it unspent                | yes, exactly once                         |

**A. Pre-approval.** This is how the requester produces the exact context a
second operator reviews. It performs **zero persistent writes** and validates
everything checkable before an approval exists: the Organization, the named
binding, its current registry state, the expected revision, and the full
attribution. It is read-only — a single-binding read by Organization and
hostname, never a listing — and it carries
`advisory: "independent approval is required and absent; this plan is not
commit validated"`. It deliberately does **not** claim the mutation would
commit, because it cannot: no approval has been checked.

**B. Post-approval.** With the approval identifier, the dry run takes the real
path through the operations layer, which issues `set constraints all
immediate` so every control actually executes — the approval guard, the exact
context binding, the single-use index and the deferred audit-evidence
constraint — and then rolls the transaction back. This one may legitimately
report that the mutation passed full commit validation while still stating
that nothing was executed, and the rollback leaves the approval **unconsumed**
so a subsequent `--confirm` with the same still-valid approval commits it.

Confirm semantics are unchanged: `activate --confirm` and `revoke --confirm`
without an approval are refused with `approval_missing` before any database
work, and a wrong, expired, stale or wrong-context approval is refused by the
database. Only the exact valid approval commits, once.

The same semantics apply to `revoke`, which plans against the inactive,
still-verified binding its ordering rule requires.

### What this corrected

The first implementation required `REQRO_OPERATOR_APPROVAL_ID` for `activate`
and `revoke` in **both** modes, so `activate --dry-run` without an approval
exited non-zero with `approval_missing` and produced no plan at all. That was
fail-closed — it never presented an unvalidated plan as committable — but it
made the documented step-1 workflow unperformable, and this record previously
described a planning step the command refused to execute. The narrow fix makes
the identifier optional in a dry run only, adds the read-only pre-approval
plan, and adds the explicit `approvalRequired` / `approvalPresent` /
`commitEligibility` fields so the two states are distinguishable by a reader
and by a job log.

The plan's sanitized field set is otherwise unchanged. It still shows only the
requested environment, the verified database name and role, the Organization
UUID, the hostname, the named binding's registry state, the requested
operation, and the expected revision. Organization name, slug and short name
are still deliberately not resolved, so the command does not become a
UUID-to-identity oracle, and the connection string, challenge value, resident
data and other tenants' bindings never appear.

## Result codes and output contract

`stdout` carries one JSON object: the plan or the applied outcome. `stderr`
carries exactly one sanitized line through a single failure path, built from
the same allowlist primitives as `commandFailure`, so no error message, SQL
text, connection string or credential can reach it.

Closed codes, for infrastructure job logs and incident review:
`environment_mismatch`, `database_mismatch`, `attribution_invalid`,
`approval_missing`, `approval_expired`, `approval_context_mismatch`,
`self_approval`, `revision_stale`, `verification_unavailable`,
`database_unavailable`, `operation_invalid`.

Refusal messages from the operations layer and the database are read **only to
classify** them onto a code; the message itself is never emitted. An
unclassified error takes the caller's explicit fallback rather than a
misleading default, so a database refusal is never reported as an invalid
operation, and a configuration refusal is reported as `environment_mismatch`
rather than as a database fault.

## Direct control-plane boundary (2b scope)

A source assertion over the new module asserts its **complete direct** surface:
the exact import allowlist, the exact single raw-SQL template (the
pre-mutation identity assertion), the absence of discovery, onboarding,
raw-statement and connection-override identifiers, and that argv is read only
for the verb, approved operation and mode.

Forbidden and asserted absent: service request, attachments,
requester/tracking, Resident Experience business data, access and RBAC,
notifications, AI, and Nest controllers or modules. The target model module is
separately asserted to issue no queries at all.

Comments and string literals are stripped before the identifier scan, so the
file's own documentation can name what it excludes without satisfying or
tripping a structural assertion.

**This is the direct 2b boundary only.** F060.3C-2c will validate the
transitive, system-wide control-plane boundary and its alignment with the real
least-privilege database grants.

## Least-privilege operator database role

**Not provisioned or modified in this slice.** Documented as a requirement for
a separately reviewed infrastructure task:

- separate from the migration and schema-owner role, so it cannot alter the
  audit structure that constrains it;
- separate from the runtime application role;
- **no** access to Service Request, resident or requester data, attachments,
  communications, Resident Experience protected content, tracking credentials,
  or RBAC tables;
- only `SELECT (id, status)` on `organization`, and the narrow tenant-domain
  control-plane tables and functions: `tenant_domain`,
  `tenant_domain_audit`, `tenant_domain_operator_approval`,
  `tenant_domain_verification_attempt`, and the three live/consumed helpers;
- no `DELETE` or `TRUNCATE` anywhere.

The import boundary constrains _this repository's code_; only the grant model
constrains what the credential could do through any other path. Both are
needed. **F060.3C-2b is not production-ready until that role exists.**

## Infrastructure prerequisites

Production use remains unauthorized until all of these exist:

1. **Distinct per-human IAM identities** — without them the approval
   separation is cosmetic.
2. Just-in-time or temporary elevation for production job execution.
3. A deployment job runner for one-shot execution inside the target.
4. Secret-manager injection of the database credential.
5. Invocation and session audit.
6. Off-host immutable log retention — the mitigation for the one risk the
   application cannot close, since whoever can migrate can alter audit
   structure.
7. The least-privilege operator database role above.
8. F060.3C-2c control-plane boundary validation.

## No application break-glass

No break-glass verb, and none is recommended: it would be exactly the hidden
backdoor ADR-027 decision 8 warns against. No resident-data elevation verb
exists or may be added. Emergency database access remains an infrastructure
process outside this command, requiring a per-human identity, session
recording and post-event review.

## Secret handling

The database credential comes only from the deployment secret manager into the
one-shot job environment, through `DATABASE_URL`, and is consumed by the
existing hardened `databaseConnectionOptions`, which already requires
`verify-full` in production, refuses every unverified TLS mode, refuses TLS and
host override parameters embedded in the URL, and validates
`DATABASE_SSL_CA_FILE` as a real CA bundle. There is **no `--database-url`
option**, credentials are never accepted through arguments, flags, a
repository `.env`, or printed output, and the connection string never appears
in any success or failure path.

## Migration

**No Migration 48 was created, and none was needed.** Re-checked after
Migration 47: the attribution columns, the approval table, the
approval-required-for-exactly-two-operations rule, self-approval refusal,
exact-context binding, the single-use index and the rollback retention guard
all already exist, and the operations layer already accepts every field this
command supplies. 2b is an entry point and a set of gates, not a schema change.

## Validation record

Every invocation is recorded, including the ones that failed.

| Suite                                                                  | Result                                    |
| ---------------------------------------------------------------------- | ----------------------------------------- |
| Operator CLI units — invocation 1                                      | 17/21, **4 failed**                       |
| Operator CLI units — invocation 2                                      | 20/21, **1 failed**                       |
| Operator CLI units — invocation 3                                      | 21/21, **1 failed** expectation corrected |
| Operator CLI units — final (and after each later edit)                 | **21/21 passed**                          |
| Operator CLI units — after dry-run semantics                           | **22/22 passed**                          |
| Backend units, serial — ambient environment                            | **635/635 passed**, 0 skipped             |
| Backend units, serial — minimal environment, contended                 | 634/635, **1 failed**                     |
| Backend units, serial — minimal environment, clean                     | **635/635 passed**, 0 skipped             |
| Backend units, serial — after dry-run semantics                        | **636/636 passed**, 0 skipped             |
| Lint — invocation 1                                                    | **5 errors**                              |
| Lint — invocation 2                                                    | **17 errors**                             |
| Lint — final                                                           | passed                                    |
| Typecheck — invocation 1                                               | **2 errors**                              |
| Typecheck, test compilation, backend build — final                     | passed                                    |
| Shared/legacy suite                                                    | **64/64 passed**                          |
| React suite — invocation 1 (not required)                              | 891/892, **1 failed**                     |
| React suite — invocation 2 (not required)                              | 891/892, **1 failed**, a different test   |
| Changed-file formatting, `git diff --check`                            | passed                                    |
| Operator CLI disposable-database integration                           | **8/8 passed**, first invocation          |
| Operator CLI disposable-database integration — after dry-run semantics | **10/10 passed**                          |
| Migration 47 regression                                                | **15/15 passed**                          |
| Migration 47 regression — after dry-run semantics                      | **15/15 passed**                          |
| Tenant-domain registry regression                                      | **14/14 passed**                          |
| Tenant-domain verification regression                                  | **17/17 passed**                          |
| Full serial disposable PostgreSQL                                      | **726/726 passed**, 0 skipped             |
| Full serial disposable PostgreSQL — after dry-run semantics            | **728/728 passed**, 0 skipped             |
| Full API E2E, serial                                                   | **80/80 passed**                          |
| Full API E2E, serial — after dry-run semantics                         | **80/80 passed**                          |

### What the failures were

**The four initial unit failures were two genuine CLI defects and two test
defects of mine.** The CLI defects are worth recording because the tests found
real problems rather than cosmetic ones:

1. **Input validation ran after the connection.** `requiredRevision()` and the
   register role check were evaluated inside the post-connection block, so a
   missing expected revision surfaced as `database_unavailable` instead of
   `revision_stale`. Fail-closed was never in question, but the ordering
   contradicted the requirement to refuse before database work and produced
   misleading diagnostics. Every verb-specific input is now resolved and
   validated before the pool exists.
2. **Configuration refusals were misclassified.** An `Invalid server
configuration:` error — raised by environment validation and by the TLS
   policy — fell through to the fallback and was reported as a database
   fault. The classifier now maps that prefix to `environment_mismatch`.

The two test defects were my own assertions: a forbidden-token scan that
matched the word `discover` inside the file's own documentation, and a check
forbidding the literal `--database-url` which the help text legitimately
contains in order to state that the option does not exist. Both were replaced
with precise structural assertions — an identifier-only view with comments and
string literals stripped, plus positive assertions that argv is read solely
for the verb, approved operation and mode and that the connection is drawn
only from the validated environment. The third round corrected an expectation
that omitted the two pool timeout settings the command legitimately reads.

The lint rounds were mechanical: a `String#includes` preference over
single-literal regular expressions, an unnecessary type assertion, unnecessary
`?? ''` fallbacks on `spawnSync` results that are already typed as strings,
and optional chains on rows that are better asserted present. The optional
chains were replaced with an explicit `assert.ok(row)` before the field
assertions, which makes those tests stronger rather than merely quieter.

A later pass, before the integration suite could run, found a third classifier
gap by tracing control order rather than by test: the refusal to record an
approval naming one identity for both roles reports
`requires a different approver`, which did not match the self-approval
pattern. It now does. Two integration expectations were corrected in the same
pass, because an approval for another binding — or one that does not exist —
is not reachable for the target binding at all and is therefore reported as
`approval_missing`, while only an approval for the right binding with the
wrong operation reaches the context check. **Those corrections are reasoned
from the control order and are not yet confirmed by execution.**

**The React suite is not uniformly green, and this slice did not touch it**
(`git status` shows no `react/` changes). It is not in the required
validation list for 2b; it was run opportunistically. Each full invocation
failed exactly one test, in a **different file each time** —
`StaffRequestWorkspace`, then `WorkspaceRefinement`, then `IssueCreation` —
and each of those files passes in isolation. That is the same pre-existing,
baseline-reproducible runner-interference flake recorded under F060.3C-1,
which was already noted there as hitting a different test between runs.

**The one backend-unit failure was CPU contention, not a regression.**
`development-startup.test.ts` spawns a full Nest initialization with a
60-second timeout, and that invocation ran while other validation commands
were in flight. It was not caused by the minimal environment: the test
builds its child environment explicitly rather than inheriting one. It
passes in isolation and in a clean full run under the same minimal
environment, both recorded above.

### Database validation

All database and end-to-end work used the authorized disposable database
`reqro_f0592_test` as `reqro_test_user`, serially with
`--test-concurrency=1`, through a runner that hands the child process a
minimal allowlisted environment — OS essentials plus `TEST_DATABASE_URL` and
`PGPASSWORD` only, with no `DATABASE_URL`, no `CITYVUE_*`, no `ENTRA_*` and no
`TENANT_*` — and refuses to spawn if any value handed to the child names
`reqro_dev`. The integration suite builds the command's own environment
explicitly rather than spreading `process.env`, so ambient configuration
cannot reach the command either. Afterwards the database reported
`{ db: 'reqro_f0592_test', usr: 'reqro_test_user' }` and zero leftover
schemas. `reqro_dev` was not accessed.

The operator CLI integration suite passed on its **first** invocation, which
confirms by execution the three corrections that had previously been reasoned
only from control order: the `requires a different approver` refusal now
classifies as `self_approval`, an approval for another binding or one that does
not exist reports `approval_missing`, and only a right-binding/wrong-operation
approval reaches `approval_context_mismatch`.

The full three-invocation approval workflow is proven end to end through the
real command: operator A obtains a sanitized plan with `--dry-run`; operator B
records the approval under B's own injected identity while naming A as
requester; operator A consumes it and the binding becomes active. Within the
same subtest, A approving their own request is refused as `self_approval`, B
consuming it is refused as `self_approval`, a third party is refused as
`approval_context_mismatch`, a stale revision as `revision_stale`, and the
spent approval replayed after a deactivation as `approval_context_mismatch`.

One evidence limit is unchanged and restated rather than smoothed over: the
approval lifetime is fixed at exactly 24 hours by design, so expiry is proven
by the predicate and its exact boundary in the Migration 47 suite together
with the immutability of the window, not by waiting out a real window through
the command. Verification itself is exercised against a synthetic hostname
with no published TXT record, so the attempt is recorded as a failure and no
state changes — which is what proves that `verify` demands no approval and
never activates, but it does not exercise a successful real-zone DNS check.

## Files changed

| File                                                                  | Change                                                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `server/src/config/operator-environment.ts`                           | **new** — target model, identity scheme policy, result codes, sanitized failure path                                                 |
| `server/src/tenancy/tenant-domain.operations.ts`                      | **+31 lines, purely additive** — `inspectTenantDomain`, a single-binding read by Organization and hostname for the pre-approval plan |
| `server/src/database/tenant-domain-operator-cli.ts`                   | **new** — production-capable entry point                                                                                             |
| `server/package.json`                                                 | **one line** — `operator:tenant-domain`; nothing renamed                                                                             |
| `server/test/unit/tenant-domain-operator-cli.test.ts`                 | **new** — gates, attribution, output contract, direct boundary                                                                       |
| `server/test/database/tenant-domain-operator-cli.integration.test.ts` | **new** — disposable-database workflow                                                                                               |
| `docs/features/F060-3C-2B-production-operator-cli.md`                 | **new** — this record                                                                                                                |

`server/src/database/tenant-domain-cli.ts` is **byte-for-byte unchanged**
(blob `5eeb064`), as are `tenant-domain.repository.ts`, Migration 47 and every
other migration. `tenant-domain.operations.ts` gained one read-only export and
lost nothing; its table, import and raw-SQL allowlists are unchanged and the
F060.3C-2a boundary test still passes. ADR-027 was not rewritten in this slice.
