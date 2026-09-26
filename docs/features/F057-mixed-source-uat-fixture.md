# F057.3 — Jordan mixed-source development fixture

## Scope and approval boundary

This operator-only mechanism prepares one synthetic outside contribution for Jordan Example, stable internal ID `90000000-0000-4000-8000-000000000002`. It supports only `service_request.create`. Implementation, automated validation and a live **dry-run only** are authorized. Actual add, runtime UAT and later cleanup require their respective explicit approvals. Alex is never targeted. There is no HTTP endpoint, migration, identity creation, provider mapping or membership change.

The existing runtime redundancy rule remains unchanged. The user must first manually grant Create requests to Jordan through Configure Access. The fixture then supplies the same permission independently. The user can remove the managed contribution while the outside contribution preserves effective access.

## Boundaries and provenance

The command requires explicit development profile, personal tenant opt-in, an existing mapped personal operator in the approved fictional Organization, the exact local database identity, and `F057_MIXED_SOURCE_UAT=true`. It derives Organization from Jordan's stable ID and validates the fixed development Organization ID/name/slug, active state, synthetic name/email, and absence of provider mappings. It accepts an explicit canonical expected revision and exact target/permission; no caller-selected Organization is accepted.

Writes acquire the existing Organization-first authorization writer locks, revalidate selection and revision, and execute in one transaction without retries. Dry-runs use a read-only repeatable-read transaction; the CLI also enables connection-wide read-only mode for dry-run. Missing manual managed access is reported as a blocked preview with no resulting revision; confirmed execution rejects it. Re-running an already installed fixture is a no-op, including after the managed contribution has been removed. Stale expected revisions still reject.

The dedicated role is `93000000-0000-4000-8000-000000000057`, named `F057 Jordan mixed-source UAT fixture`. Its structured description identifies source `F057_MIXED_SOURCE_UAT`, manifest version, target and permission. Existing rows must match ID, Organization, name, description, active state, creation provenance, exact one-permission set, and sole active assignment to Jordan. Any F057 ownership or other discrepancy rejects; the command never adopts, repairs or modifies another role. The marker is operator provenance, not a new authorization evaluator or a cryptographic attestation against a privileged database owner.

Existing controlled-provisioning audit operations represent Reader/Administrator authority and cannot truthfully describe this fixture. No `update_managed_access` or provisioning event is fabricated. Provenance consists of the dedicated role metadata and explicit command output. Output reports target, current access, current/proposed revision, action and provenance. Retain reviewed command reports for UAT evidence; this is not a new immutable audit ledger. No migration is necessary. Existing immutable runtime change sets remain untouched.

An actual fixture add or cleanup advances Organization revision once through existing invalidation triggers. Dry-runs and same-state no-ops do not advance it. Outside fixture operations do not appear as F057 Recent Access Changes events. Runtime managed removal still produces its normal contribution-removal event; historical events do not retrospectively assert outside effective access.

## Supported operator procedure

Load existing private personal-development configuration without printing credentials. Set these non-secret selections in the command process:

```text
F057_MIXED_SOURCE_UAT=true
F057_FIXTURE_STAFF_ID=90000000-0000-4000-8000-000000000002
F057_FIXTURE_PERMISSION=service_request.create
F057_EXPECTED_REVISION=<fresh authoritative canonical revision>
```

From `server`, use the package script:

```text
npm run dev:access:mixed-fixture -- add --dry-run
```

If npm is unavailable, the equivalent supported entry point is:

```text
node --env-file=.env --env-file=.env.f036 --import tsx src/database/mixed-access-uat-cli.ts add --dry-run
```

After a successful current backend build, the same CLI can also be run without the TypeScript loader:

```text
node --env-file=.env --env-file=.env.f036 dist/database/mixed-access-uat-cli.js add --dry-run
```

After Jordan's manual managed grant, refresh the expected revision and repeat the dry-run. Only separate approval of that successful preview permits replacing `--dry-run` with `--confirm`. An approval of a blocked preview is not executable approval of a later changed state.

After manual mixed removal and read-only verification, preview cleanup with the same selection and fresh revision:

```text
npm run dev:access:mixed-fixture -- cleanup --dry-run
```

Only separate cleanup approval permits `cleanup --confirm`. Cleanup validates ownership before deleting only the fixture assignment, its one permission and its dedicated role in one transaction. Unexpected references or database failures roll back everything. It never removes F057 ownership, its retained operational role, memberships or immutable history. Subsequent cleanup is a no-op. Effective Create requests disappears on cleanup only if no other contribution remains; a retained managed contribution would continue to supply it.

## Validation

Permanent PostgreSQL tests use disposable schemas in the separate test database. They exercise environment/selection rejection, dry-run immutability, required manual grant, identity and Organization restrictions, role collisions, ownership tampering, add/cleanup rollback, target-only assignment, unchanged memberships/history, idempotency, stale revisions, one revision per changed transaction, and runtime mixed-source removal followed by fixture cleanup. No live fixture is installed by these tests.

## Live dry-run checkpoint — 2026-09-26

The supported compiled CLI `add --dry-run` completed at revision **5**. Jordan has seven effective permissions, all outside: `service_request.assign`, `service_request.close`, `service_request.hold`, `service_request.reopen`, `service_request.resume`, `service_request.start_work`, and `service_request.view`. Managed access is empty. Preview reports `ready: false`, `wouldChange: false`, no proposed resulting revision and no provenance created, because the manual managed Create requests grant has not occurred. Before/after SHA-256 fingerprints matched for all **60 live public tables**; revision remains **5**, including unchanged Alex state.

With no intervening changes, the user's future managed grant would advance 5→6; a fresh, separately approved fixture add would then advance 6→7 without changing the eight effective permissions. Subsequent manual managed removal would advance 7→8 while retaining eight effective permissions; separately approved cleanup would advance 8→9 and restore Jordan's original seven outside permissions. These are conditional projections, not reservations of revisions or authorization to execute.

The TypeScript-loader invocation failed before database connection with a Windows `uv_os_get_passwd` environment error. The current production-build JavaScript entry point then completed successfully with the same command guards. No provisioning retry occurred.

Final validation: 317 backend unit, 41 API E2E, 487 PostgreSQL (including 15 fixture checks), 64 shared and 706 React tests passed. PostgreSQL had zero skips. The full React invocation passed 690 tests but reported a worker-start timeout for `ReportIssuePage.test.jsx`; that file passed all 16 tests on isolated rerun. The focused Access React run additionally passed 26 tests. Backend test compilation, no-emit typecheck, backend/frontend production builds, full backend ESLint, changed-file Prettier and whitespace checks passed. Existing frontend module-type and build-size warnings remain. No frontend source or runtime authorization code changed in this fixture task.

Commands used existing repository tools directly through Node because npm is unavailable on PATH: TypeScript `tsc -p tsconfig.test.json`, `tsc -p tsconfig.json --noEmit`, `tsc -p tsconfig.build.json`; Node test runner over compiled unit/E2E/database suites (database suite loads `.env` and uses `TEST_DATABASE_URL`); Vitest with the repository config and one worker; existing eight shared test files; Vite frontend build; ESLint; Prettier; `git diff --check`. The strengthened final fixture suite was recompiled and rerun after the broad PostgreSQL run. All work remains uncommitted. No live add, cleanup, migration, Entra/cloud change, push or deployment occurred.
