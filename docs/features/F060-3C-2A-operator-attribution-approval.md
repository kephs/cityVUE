# F060.3C-2a — Operator attribution and approval foundation (ADR-027)

Status: **implemented locally, stopped for security review.** Not staged, not
committed, not pushed, not deployed.

> This slice adds the attribution and approval evidence that ADR-027 requires
> **before** a production operator path may be implemented. It does not create
> a production operator path, and it does not make production deployment or
> domain onboarding possible.

## Authorization and baseline

Implemented under the F060.3C-2a authorization. Branch
`claude/operator-attribution` from `origin/main` at
`e6bd83155175fa77d3b38b968494bc6c2756d1b1`, clean index and working tree.
`20261017000000` was re-verified as the next free migration ordinal before any
edit. No dependency changes.

**Explicitly not done in this slice:** the production operator CLI
(F060.3C-2b), Organization status transitions, refused-attempt evidence, any
HTTP or browser control plane, any Entra login flow for operator tooling, any
bootstrap token, and any local authentication fallback.

## Authority model

**Infrastructure IAM remains the authentication trust root.** The ability to
execute an operator mutation is the ability to run inside the deployment, which
ADR-027 decision 8 already treats as the trust root. This slice therefore
stores **attribution, not platform authentication**: the application records
which infrastructure-issued human performed a mutation, why, under which
correlation, and with whose independent approval. Nothing recorded here grants
anything.

**No `platform_operator` table exists, and none was added.** Under
deployment-per-tenant (ADR-027 decision 5) platform authority is not expressed
in the database at all, so there is no row a tenant administrator could write
to manufacture it — ADR-027 decision 3 is satisfied structurally rather than by
a new principal model. No permission key, role, grant or tenant-visible
capability was introduced. A platform principal becomes necessary only if
shared multi-Organization hosting or a control-plane API is approved; both
remain out of scope.

Operator identity is an infrastructure-issued, per-human reference carried into
the future one-shot operator job. It is **never** a tenant staff identity: the
mandatory scheme prefix means the value can never be a bare UUID and so can
never be confused with a `staff_identity`.

## Legacy and version-2 audit boundary

`tenant_domain_audit` rows written before Migration 47 carry a free-text
`actor` and nothing else. They are historical evidence and are **not**
rewritten, backfilled or annotated with an invented identity.

|                                                            | Version 1 (legacy)           | Version 2 (current)                                                    |
| ---------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| Origin                                                     | written before Migration 47  | the only version a new row may use                                     |
| `actor`                                                    | retained exactly as recorded | kept in step with `operator_identity`                                  |
| `operator_identity`, `reason`, `correlation_id`, `outcome` | all null                     | all required                                                           |
| `approval_id`                                              | null                         | required for `activated` and `verification_revoked`, refused otherwise |

The column defaults to 1 when added, so existing rows become version 1 without
being touched, and the default then changes to 2. `guard_tenant_domain_audit`
refuses any insert whose `attribution_version` is not 2, so **no caller —
including raw SQL — can write a new legacy row to escape the requirements.**

`tenant_domain_audit_actor_agrees` forbids a version-2 row whose legacy `actor`
disagrees with its `operator_identity`, so the retained column stays
trustworthy for every version.

## Structured attribution

Version-2 evidence structurally requires:

| Field               | Shape                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `operator_identity` | `^(iam\|oidc\|dev):[A-Za-z0-9][A-Za-z0-9._@/+-]{1,180}$`, and refused if it contains a 32-or-longer unbroken alphanumeric run |
| `reason`            | 12–500 trimmed characters, no control characters                                                                              |
| `correlation_id`    | `uuid`, matching the existing `tenant_domain_verification_attempt` and `access_change_set` convention                         |
| `outcome`           | closed enum, currently `applied` only                                                                                         |
| `approval_id`       | required for the two approvable operations, refused for all others                                                            |

The `dev:` scheme marks synthetic development evidence as such, so local rows
are never mistakable for production attribution. **F060.3C-2b must refuse
`dev:` identities in production.**

The secret-shaped refusal is deliberate and separate from the grammar: an IAM
path, an address and a UUID subject never contain a long unbroken alphanumeric
run, but a pasted token does. Hyphenated UUID subjects therefore remain valid.

**`outcome` currently admits one value, and that is honest rather than
incomplete.** The deferred audit constraint ties every row to committed binding
state, so a refused operator attempt has no row to write here. Recording
refused attempts is a separate future decision, named as such, not a silently
missing value.

## Approval model

`tenant_domain_operator_approval` is immutable, single-use and bound to the
exact pre-state the approver reviewed:

- `operation`, `expected_revision`, `expected_hostname`, `expected_role`,
  `expected_verification_state`, `expected_active`
- `requested_by`, `approved_by`, `reason`, `correlation_id`, `policy_version`
- `approved_at`, `expires_at`, `creation_txid`, all database assigned

The insert guard re-checks every `expected_*` field against the committed
binding, so **an approval cannot describe a state the binding was never in.**
At consumption, `guard_tenant_domain_audit` additionally requires that the
approval match the operation and the exact pre-state (`prior_revision`,
`prior_role`, `prior_verification_state`, `prior_active`), which is what makes
a stale approval unusable after any drift.

Cross-Organization and cross-binding reuse fail as **referential integrity**,
not as a check the application must remember: the audit row's foreign key is
`(organization_id, tenant_domain_id, approval_id)`.

### Single use — a design decision to note

The approval table is **fully immutable**: no update, delete or truncate. There
is no mutable `consumed` flag. Consumption evidence is the committed audit row
that references the approval, exposed as
`tenant_domain_approval_consumed(uuid)`, and enforced by the unique partial
index `tenant_domain_approval_single_use` on `tenant_domain_audit(approval_id)`.

This deviates from the authorization's suggested "consumed state/evidence"
column, and the reason is that it is strictly stronger: the evidence is atomic
with the mutation, it cannot drift from it, it keeps the approval table
genuinely immutable rather than immutable-except-one-column, and double
spending becomes a unique-index violation that two concurrent transactions
cannot both pass. **Reviewer confirmation is requested on this point.**

Note also that exact-context binding already makes double spending unreachable
through any code path, because revision monotonicity means the approved
pre-state never recurs. The index is the concurrency backstop, not the only
control.

### Independent commit

`approval.creation_txid = txid_current()` is refused at consumption, so one
operator cannot create and spend an approval atomically. This reuses the
existing resident-publication pattern.

## Approval-required operation matrix

| Operation         | Independent approval | Rationale                                                                                             |
| ----------------- | -------------------- | ----------------------------------------------------------------------------------------------------- |
| `register`        | no                   | produces an unverified, inactive binding that cannot resolve                                          |
| `issue-challenge` | no                   | reversible, non-serving                                                                               |
| `verify`          | no                   | records ownership evidence and never activates                                                        |
| `deactivate`      | **no**               | only ever removes a hostname from resolution; incident response must never wait for a second operator |
| `activate`        | **yes, always**      | makes a hostname publicly reachable                                                                   |
| `revoke`          | **yes, always**      | destroys ownership evidence                                                                           |

Verification and activation remain separate operations with separate audit
actions. There is no combined `onboard` verb and no combined "revoke active"
mutation: the existing rule that an active binding is deactivated before
verification may be revoked is preserved, which is why the destructive step is
always approved while the safe step is always immediate.

Organization status transitions are **out of scope** and will receive a
separate design and review slice. `organization.status` still has no production
mutation path.

## Self-approval prohibition

Enforced in PostgreSQL, in three independent places:

1. `check(requested_by <> approved_by)` on the approval row.
2. `approval.approved_by = NEW.operator_identity` is refused at consumption —
   the approver may not apply the change.
3. `approval.requested_by <> NEW.operator_identity` is refused at consumption —
   only the operator the approval names may apply it, so an approval cannot be
   picked up by an unexpected third party.

Application-level checks mirror (1) for a clearer operator message; the
database refusals are the control.

> **Production prerequisite: distinct per-human infrastructure identities.** If
> infrastructure issues one shared identity to several humans, every guarantee
> above becomes cosmetic — the database cannot tell two humans behind one
> identity apart. This is an infrastructure requirement, not a convention, and
> it blocks production use of the approval model.

## Approval expiry

24 hours, matching the existing resident-publication review convention
(`resident_review_unexpired`). `expires_at` is assigned by the insert trigger
from the server clock and pinned by
`check(expires_at = approved_at + interval '24 hours')`, so a caller can
neither backdate nor widen the window, and the table is immutable so it cannot
be extended afterwards. `tenant_domain_approval_live` is strict at the upper
bound and fails closed on a null endpoint.

**Evidence limit, stated honestly:** because the lifetime is fixed at exactly
24 hours by design, the expiry path is proven by testing the predicate and its
exact boundary (`live` at `expires_at` is false, and at `expires_at + 1s` is
false) plus the immutability of the window, rather than by waiting out a real
window. A caller-selectable shorter lifetime would have made an end-to-end
wall-clock test possible, and was deliberately not added: it would widen the
caller's control over the window for no security benefit, and the approval
precedent in this repository hard-codes its lifetime.

## Audit integrity preserved and extended

Unchanged from Migrations 45 and 46: append-only audit, delete and truncate
refusal, mandatory audit evidence for every state mutation via the deferred
constraint trigger, revision monotonicity, expected-revision concurrency
control, and the `active ⇒ verified` invariant.

Extended: `verify_tenant_domain_audited` now also requires
`attribution_version = 2`. A binding that changed without a matching
_attributed_ audit row fails at commit, so **a mutation lacking required
attribution fails at the database layer**, including one attempted with direct
SQL.

## No cross-tenant or application data access

No service-request, resident, attachment or tracking access was added. The
operator path reaches Organization identity and status, the registry,
verification evidence and operator attribution, and nothing else.

This is enforced as a boundary the build checks rather than a convention:
`test/unit/tenant-domain-attribution.test.ts` asserts the **complete
allowlist** of tables the operations module reaches, the complete set of its
imports, and that its only raw SQL template is the dry-run constraint check. A
newly reachable table fails that test rather than slipping through.

## Files changed

| File                                                                       | Change                                                                                                                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `server/migrations/20261017000000-add-tenant-domain-operator-controls.ts`  | **new** — Migration 47                                                                                                                   |
| `server/src/database/database.types.ts`                                    | audit attribution columns, approval table type                                                                                           |
| `server/src/tenancy/tenant-domain.operations.ts`                           | `OperatorAttribution`, approval-bearing transition type, `recordTenantDomainApproval`, attribution threaded through all six audit writes |
| `server/src/database/tenant-domain-cli.ts`                                 | development-only `approve` verb and attribution environment inputs                                                                       |
| `server/test/database/tenant-domain-operator-controls.integration.test.ts` | **new** — Migration 47 suite                                                                                                             |
| `server/test/unit/tenant-domain-attribution.test.ts`                       | **new** — validation and boundary suite                                                                                                  |
| `server/test/database/tenant-domain-registry.integration.test.ts`          | fixtures carry version-2 attribution                                                                                                     |
| `server/test/database/tenant-domain-verification.integration.test.ts`      | fixtures carry attribution; activate and revoke consume real approvals                                                                   |
| `server/test/e2e/registry-tenancy.e2e.test.ts`                             | fixture records a real activation approval                                                                                               |
| `docs/features/F060-3C-2A-operator-attribution-approval.md`                | **new** — this record                                                                                                                    |

ADR-027 was **not** rewritten by this slice.

## Interface change

`TenantDomainSelection.actor: string` is replaced by
`attribution: OperatorAttribution`. `activateTenantDomain` and
`revokeTenantDomainVerification` now take `TenantDomainApprovedTransition`,
whose `approvalId` is mandatory; every other input type has no such field. An
approval therefore cannot be omitted where it is required, nor attached where
it is forbidden — the type system and the database agree.

`verifyTenantDomain` no longer takes a separate `correlationId`: the
correlation now travels inside the shared attribution, so there is one
validated source for it.

## Rollback behaviour

Migration 47 rollback:

- **preserves** legacy version-1 rows, which do not block it;
- **refuses** if any version-2 structured attribution exists;
- **refuses** if any operator approval exists;
- never downgrades post-cutover evidence to legacy attribution;
- restores `guard_tenant_domain_audit` and `verify_tenant_domain_audited` to
  their Migration 45 definitions;
- leaves the Migration 45 and 46 delete, truncate and evidence-retention
  protections intact.

## Migration layering in the existing suites

The operator path now writes version-2 attribution unconditionally, so the
Migration 45 and Migration 46 suites can no longer exercise the operations
module on their own schema. Both therefore apply Migration 47 **after** their
own apply/rollback/reapply case, which still runs against their migration
alone.

One consequence to note: the Migration 45 suite now runs on 45 + 47, skipping 46. That combination is valid — Migration 47 references only `tenant_domain`,
`tenant_domain_audit` and `organization`, and has no dependency on 46 — but it
is not a schema production will ever have. Adding 46 to that suite would
require rewriting its challenge fixtures to carry `verification_token_id`,
which is outside this slice. **The authoritative proof of Migration 47 is the
new F060.3C-2a suite, which applies all 46 prior migrations in order.**

Migration 47 also strengthened the deferred-audit refusal message from
"require matching operator audit evidence" to "require matching **attributed**
operator audit evidence". The Migration 45 suite's assertion on that message
was updated to the stronger wording; no assertion was weakened.

## Validation record

Every invocation is recorded, including the ones that failed.

| Suite                                            | Result                                                 |
| ------------------------------------------------ | ------------------------------------------------------ |
| Backend units, serial — 4 invocations            | **614/614 passed** each time                           |
| Operator attribution units — invocation 1        | 7/9, **2 failed** (defects in my own new tests)        |
| Operator attribution units — final               | **9/9 passed**                                         |
| Lint — invocation 1                              | **1 error** (unnecessary type assertion in a new test) |
| Lint — final                                     | passed                                                 |
| Typecheck, test compilation, backend build       | passed                                                 |
| Shared/legacy suite                              | **64/64 passed**                                       |
| React suite — invocation 1                       | 890/892, **2 failed**                                  |
| React suite — invocations 2 and 3                | **892/892 passed**                                     |
| Migration 47 suite — invocation 1                | 2/15, **13 failed** (one fixture defect, cascading)    |
| Migration 47 suite — invocation 2                | 12/15, **2 failed** (two wrong assertions of mine)     |
| Migration 47 suite — invocations 3 and 4         | **15/15 passed** (14 subtests + parent)                |
| Tenant-domain registry regression                | **14/14 passed**                                       |
| Tenant-domain verification regression            | **17/17 passed**                                       |
| Full serial disposable PostgreSQL — invocation 1 | 317/322, **5 failed** (ambient environment, see below) |
| Full serial disposable PostgreSQL — invocation 2 | **718/718 passed**                                     |
| Full API E2E, serial                             | **80/80 passed**                                       |
| Changed-file formatting, `git diff --check`      | passed                                                 |

All database and E2E work used `reqro_f0592_test` as `reqro_test_user`,
serially with `--test-concurrency=1`. The disposable database reported
`{ db: 'reqro_f0592_test', usr: 'reqro_test_user' }` and zero leftover schemas
afterwards.

### Failures and what caused them

**Migration 47 suite, invocation 1 (13 failed).** One fixture defect with a
wide blast radius: the helper that writes genuine pre-cutover evidence was
reused for bindings created _after_ Migration 47, where the column default is
2 and complete attribution is required, so every downstream subtest failed on
`Tenant domain audit records applied mutations only`. Subtests 1 and 2 passed
throughout, which is what identified the cause — the legacy path and the
version boundary were correct all along. Fixed by splitting the helper into a
pre-cutover `legacyBinding` and a post-cutover `registerBinding`, and the
refusal that exposed the defect is now asserted deliberately: re-running the
legacy-shaped insert after cutover **must** fail, because version 1 is
retained history and is closed to new writes.

**Migration 47 suite, invocation 2 (2 failed).** Both were my assertions
naming the wrong control, not implementation defects, and in both cases the
mutation was refused — just earlier and more clearly than I predicted:

- direct-SQL activation without an approval is refused by the trigger
  (`requires an independent approval`) before the `audit_approval_scope` check
  constraint is evaluated;
- `truncate tenant_domain_operator_approval` is refused by PostgreSQL for the
  audit foreign key before any truncate trigger runs, with the trigger
  remaining as the backstop.

Both assertions were widened to the actual controls. No assertion was
weakened, and no expected behaviour was changed to obtain a pass.

**Full serial disposable PostgreSQL, invocation 1 (5 failed).** Not a code
defect and not pre-existing test debt: my own runner leaked the ambient
development configuration of the parent shell into the child process. Two
app-booting suites aborted at environment validation with
`external identity opt-in requires complete Entra configuration`, because
`CITYVUE_ENABLE_EXTERNAL_IDENTITY` was inherited without a matching tenant id,
and three migration apply/rollback suites were then reported as
`test could not be started because its parent finished` — cascade, not
independent failures.

The parent shell also carried a `DATABASE_URL` pointing at **`reqro_dev`**,
which that first runner passed through to the child. This invocation is
recorded as contaminated, not clean. What bounds it:

- every suite connects its own fixtures through `TEST_DATABASE_URL`, and none
  reads `DATABASE_URL` for a fixture connection;
- the two affected app-booting suites aborted at environment validation, which
  runs **before the database module is initialised**, so neither opened a
  connection;
- every other app-booting suite overwrites `DATABASE_URL` itself, with a
  placeholder or the test URL, which is why they passed;
- **no reported run used `reqro_dev`**, and no schema creation or write could
  have landed there.

`reqro_dev` was not connected to in order to verify this, because that would
itself be the prohibited access.

The runner was then rebuilt to hand the child a minimal allowlisted
environment — OS essentials plus `TEST_DATABASE_URL` and `PGPASSWORD` only,
with no `DATABASE_URL`, no `CITYVUE_*`, no `ENTRA_*` and no `TENANT_*` — and
with a guard that refuses to spawn if any value handed to the child names
`reqro_dev`. Every reported result comes from that runner. Invocation 2 then
reported 718/718 with nothing skipped, and the count reconciles exactly: 703
from F060.3C-1 plus the 15 added here.

The React suite was **not** touched by this slice (`git status` shows no
`react/` changes), and the two invocation-1 failures are the
`StaffRequestWorkspace` flake already established as pre-existing and
baseline-reproducible under F060.3C-1. The React suite is not uniformly green
across invocations and should not be described as such.

### Coverage of the 23 required cases

All 23 are covered across the 14 subtests of the Migration 47 suite plus the
two regressions. Four are proven by a control other than the one the
authorization anticipated, and that is recorded rather than smoothed over:

- **expired approval** — the lifetime is fixed at exactly 24 hours by design,
  so this is proven by the predicate and its exact boundary
  (`tenant_domain_approval_live` is false at `expires_at` and after it) plus
  the immutability of the window, not by waiting out a real window.
- **one approval cannot be consumed twice** — exact-context binding refuses the
  replay before the unique index is reached, because revision monotonicity
  means the approved pre-state never recurs. The index is asserted to exist as
  a unique partial index and stands as the concurrency backstop.
- **approval for another Organization / another binding** — refused as
  referential integrity by the composite foreign key rather than by a trigger
  message.

## Remaining production blockers

Unchanged from the F060.3C-2 assessment except where noted:

1. ~~ADR-027 decision 10 attribution gap~~ — **addressed by this slice**
2. Production operator CLI (F060.3C-2b)
3. **Distinct per-human infrastructure identities**, without which separation
   of duties is cosmetic
4. Infrastructure provisioning, including the operator job runner, a
   least-privilege operator database role, and secret-manager wiring
5. A real verified production domain and a real-zone DNS verification exercise
6. TLS and certificate automation
7. Trusted-edge CIDRs and configuration under change control
8. CDN and proxy cache-key verification including the hostname
9. Organization lifecycle mutation path
10. Automated DNS re-verification and deactivation — deferred, no scheduler
11. Hostname release and reassignment — deferred
12. `platform_delegation` for platform fallback domains — deferred
13. Tenant-dimensional throttling, if shared-process hosting is ever approved

## Separately reportable documentation inaccuracy

ADR-027's "Testing note" states that this worktree lacked `TEST_DATABASE_URL`
and that the database suite was "reported as skipped and not executed". That is
now stale: the disposable suite has since run repeatedly. This record does not
edit ADR-027; the correction is proposed as its own factual amendment,
consistent with the three prior ADR-025 amendments.
