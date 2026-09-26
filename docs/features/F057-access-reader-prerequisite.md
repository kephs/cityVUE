# Controlled Access Reader prerequisite for F057.2

Status: COMPLETE LOCALLY — NOT SYNCHRONIZED. Migration 39 and the separately approved personal Reader grant passed validation. The grant remains in place. F057.2 authenticated manual UAT subsequently passed; its read-only application work is a separate commit.

The pre-grant read-only inspection found one existing active Entra-mapped personal-development staff identity in the configured personal tenant and active Organization. Configuration-read was effective; access-read and access-manage were absent. Authorization revision was 0 and bootstrap false. Existing manager provisioning would overgrant manage authority and establish bootstrap. F036 and F057 operational roles deliberately exclude both access keys. No provider identifiers are published.

## Implementation

- Migration `20261009000000-controlled-access-reader.ts` adds Reader audit operations and dedicated `reader` ownership to existing tables. The third kind preserves independent Administrator ownership and avoids adopting shared/F036/F027 roles. No new authorization model, tables or permissions. Migrations 1–38 remain unchanged.
- Database checks bind Reader operations to Reader ownership, constrain Reader deltas to matching access-read addition/removal, and prohibit other permissions on Reader roles. Existing immutable ownership, audit, transaction evidence, deferred completion and last-manager checks remain.
- `provisionAccessReader` uses Organization/access-state locking, expected revision and bootstrap state. Grant adds only `admin.access.read`; removal touches only the Reader-owned contribution. No-op/dry-run creates no audit or revision. Changed transactions advance once with typed controlled-provisioning audit and actual deltas.
- Configuration-read remains independent. No bootstrap is established. Independently held manager prerequisites can combine with Reader access, so last-manager protection is retained in preview and execution.
- Existing Administrator commands and their synthetic restriction remain. No HTTP provisioning route, Entra modification, identity creation or membership mutation.
- Down refuses retained Reader ownership or history, including after grant removal. Before retained Reader state exists, down/reapply is safe. No bypass flag or reusable bypass token.

## Controlled local operation

Use the existing `npm run dev:access -- grant-reader --dry-run` command. After explicit approval, `grant-reader --confirm` uses the same selection and expected state. Removal is `remove-reader --dry-run` followed by separately reviewed `remove-reader --confirm` with refreshed state. A stale revision requires stopping and a new review, never forcing the operation.

Load private configuration into the process, never command arguments or tracked files. Required: development NODE_ENV/profile, approved localhost reqro_dev/reqro_dev_user target, F057_ORGANIZATION_ID and F057_STAFF_ID (internal IDs), F057_EXPECTED_REVISION, and F057_EXPECTED_BOOTSTRAP. Personal Reader UAT requires F057_PERSONAL_READER_UAT=true, enabled external identity, and F036_PERSONAL_ENTRA_TENANT_ID matching configured ENTRA_TENANT_ID. The existing active staff target must have a mapping in that tenant. This flag cannot enable Administrator operations. Synthetic fixtures retain F057_SYNTHETIC_ONLY=true.

The command prints bounded effects, safe staff suffix, revisions and effective capability booleans, not provider identifiers. Audit is typed provisioning, not impersonation of the target. Removal does not guarantee loss of effective access-read if another source supplies it; output reports that result. Empty ownership/assignment and immutable history remain.

## Validation checkpoints

Disposable tests cover up/down/reapply, retained-state refusal, zero migration grants, grant/removal delta and revision behavior, no-op/dry-run, stale/cross-Organization/inactive rejection, early/late injected failure rollback, Reader role integrity, locked contributions, concurrency and existing manager/last-manager semantics. Unit tests cover malformed selection and CLI opt-in/privacy rejection.

Prerequisite checkpoint backend validation: 315 unit, 40 API E2E, 456 PostgreSQL tests: **811 distinct passed / 0 failed / 0 skipped**. Reader contributes three unit tests and 15 PostgreSQL tests (14 subtests plus parent). F057.1 manager, last-manager, revision, ownership, audit and F036/F027 regression proofs passed. TypeScript/test compilation, backend build, targeted prerequisite ESLint/Prettier, whitespace, document links and private-value review passed at that checkpoint. This count does not include subsequent discovery tests.

The initial backend build exposed a declaration-export issue in the preserved F057.2 helper; exporting its referenced database interface fixed it without runtime change. The older F052 exact capability assertion was updated for F057.2's `canReadAccess: false` projection without weakening authorization. These discovery compatibility hunks belong to F057.2.

Migration 39 was applied using the repository compiled migration CLI/directory after disposable proofs. Read-only fingerprints of all 60 development tables showed only the ledger changed during migration application. No grant, role, assignment, membership, audit, bootstrap or authorization revision changed. All fingerprints remained identical across the actual CLI dry-run. At that checkpoint there was no Reader ownership/audit; preview showed only access-read addition, revision 0 to 1 and bootstrap false.

## Approved personal Reader grant and retained state

The user separately authorized the exact `grant-reader --confirm` operation for the existing personal-development identity. It granted only `admin.access.read` using one fresh Reader role/ownership, preserving effective `admin.configuration.read`. It did not grant `admin.access.manage`, establish bootstrap or make the target an Access Administrator. Revision advanced exactly **0 → 1**. Exactly one immutable `provision_access_reader` change set and one added `admin.access.read` delta were retained.

Immediate post-grant verification compared all 60 tables: existing roles/grants, Department/Division memberships, F036/F027/shared resources and unrelated effective permissions were unchanged. Subsequent read-only inspection reconfirmed revision 1, bootstrap false, one Reader ownership, one change set/delta, configuration-read and access-read effective, and access-manage absent. State remains **39 applied / 0 pending / 60 tables / 32 registered / 27 manageable permissions**. The grant remains until a separately reviewed removal decision. Final validation performed no further personal provisioning.

Authenticated manual F057.2 UAT was accepted by the user. Reader provisioning is a prerequisite, not runtime F057.2 mutation behavior. No push, deployment, Entra change, manager bootstrap or F057.3 work occurred. Temporary scripts ran in memory; no database dumps, identity exports or private logs were retained.
