# F057.1 — Administrative Access Security Foundation

Subsequent approved prerequisite amendment: [Controlled Access Reader provisioning](F057-access-reader-prerequisite.md), discovered during F057.2 authenticated UAT preparation, adds Migration 39 and dedicated read-only provisioning authority. Reader authority is not Access Administrator authority. The original completion evidence below retains its Migration 38 historical scope.

Status: **COMPLETE LOCALLY — NOT SYNCHRONIZED**. Implementation, migration and validation gates passed. One local feature commit is authorized; no push or deployment. F057 architecture approved; F057.2 unstarted.

Starting checkpoint: main `54319416bb3d4af4ff7900baf55acc3b1f887ccf`, matching origin/main and live GitHub main, clean and 0 ahead/behind. Development database 37 applied/0 pending, 56 tables. F056.5 is complete and synchronized. Earlier documentation checkpoint statements retain their historical scope.

The approved mechanism and six design-gate resolutions are recorded in [ADR-023](../architecture/decisions/ADR-023-administrative-access-management-controlled-delegation.md). This record tracks executable scope and evidence; it does not imply a runtime access UI/API exists.

## Implementation map

| Area                                | Resource                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Additive schema                     | [Migration 38](../../server/migrations/20261008000000-add-administrative-access-foundation.ts)                       |
| Shared existing RBAC calculation    | [effective-permissions](../../server/src/auth/effective-permissions.ts), reused by StaffAuthorizationService         |
| Code catalog and dependency policy  | [access-policy](../../server/src/access/access-policy.ts)                                                            |
| Internal read/mutation/provisioning | [access-foundation](../../server/src/access/access-foundation.ts)                                                    |
| Local operator command              | [access-administrator-cli](../../server/src/database/access-administrator-cli.ts)                                    |
| Existing writer cooperation         | [authorization-writer-lock](../../server/src/database/authorization-writer-lock.ts), F036, F027 and development seed |
| Unit proofs                         | [access-policy tests](../../server/test/unit/access-policy.test.ts)                                                  |
| PostgreSQL proofs                   | [access-foundation integration](../../server/test/database/access-foundation.integration.test.ts)                    |

The migration adds four tables: organization_access_state, access_role_ownership, access_change_set and access_permission_delta; role gains an internal nullable creation-transaction column. Operational and administrator ownership use separate records distinguished by constrained kind, with unique target/kind and role identities. No legacy role is adopted. New total is expected to be 60 tables, including the two existing Kysely metadata tables.

No new application controller/module routes, React code or navigation. Read snapshot is an internal foundation helper using a read-only repeatable-read transaction. It returns safe staff identity, owned/locked/effective permissions, current active membership IDs, revision and bootstrap state; inactive targets have no effective authorization. Provider IDs remain internal authentication inputs. Runtime mutations accept only staffId, expectedRevision and desired permissions; duplicates canonicalize, unknown properties/keys reject. Revisions use decimal strings to preserve bigint precision.

## Writer coverage and integrity

| Writer                                          | Relevant behavior                                                                  | Coverage                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| development seed                                | Organization/staff/roles/grants/assignments/memberships                            | Organization then access-state lock; database invalidation                          |
| F036 changeDevelopmentStaffGrants               | grant/revoke, assignment activation, membership restoration, structured provenance | Existing semantics retained; access-state lock added; meaningful DML triggers       |
| F027 provision/revokeDevelopmentGeospatialGrant | explicit identity creation, dedicated geospatial role/grant/assignment             | Lock order standardized; existing grant semantics retained                          |
| F057 operational command                        | fresh owned role, desired permission set, audit                                    | expected revision, actor re-resolution, ownership, dependencies, atomic audit       |
| F057 controlled manager command                 | bootstrap/add/remove prerequisites                                                 | explicit operator boundary, expected state, audit, last-manager enforcement         |
| Existing migrations                             | schema/permission registration and historical schema rollback                      | Migrations 1–37 unchanged; new migration initializes zero grants                    |
| Direct DML to authorization inputs              | staff/role/assignment eligibility, permission and membership changes               | revision invalidation and deferred last-manager integrity; not human authentication |
| Organization collection/branding writers        | unrelated settings                                                                 | no authorization revision for unrelated settings                                    |

No current runtime staff/role/Organization activation administration was found. Triggers nevertheless cover those persisted active/status inputs. Global registry registration does not grant a role contribution; referenced keys cannot be deleted through ordinary FK-constrained DML. TRUNCATE is rejected for authorization tables to avoid bypassing row checks. Future code-registry semantic changes still require reviewed deployment/migration; database revisioning does not version application binaries.

Access audit belongs only to F057 governed/provisioning operations. Existing F036/F027 mutations invalidate revisions and satisfy last-manager integrity but do not gain invented historical F057 audit events. Database-owned transaction metadata is not a user session bypass. Direct privileged schema alteration is outside application integrity guarantees.

## Permission classification

Expected and tested: 32 registered, 27 manageable; no separate development/system-only key in the current registry. Both access keys, geospatial.read and both AI keys are provisioning-only. No existing development bundle is expanded.

Manageable keys:

```text
admin.configuration.read
admin.intake_settings.write
admin.issues.write
admin.participation_areas.write
analytics.service_participation.read
catalog.issue_action.manage
service_request.answers.read
service_request.assign
service_request.close
service_request.communication.create
service_request.communication.read
service_request.contact.read
service_request.create
service_request.create_internal
service_request.hold
service_request.internal.read
service_request.internal.update
service_request.note.create
service_request.note.read
service_request.reference.manage
service_request.reopen
service_request.resume
service_request.route
service_request.start_work
service_request.tracking.manage
service_request.view
service_request.watchers.manage
```

Code metadata gives every key a label, description, group, explicit manageability, sensitivity, prerequisite array and contextual explanation. Groups are Administrative Configuration, Service Requests, Sensitive Information and Specialized Capabilities. Contact, answers, Notes, correspondence, tracking, Handling and participation analytics carry deliberate sensitivity treatment; this metadata does not authorize disclosure.

The final effective union supplies prerequisites. Stable authoring rules cover Admin writers, INTERNAL creation, Notes creation, PUBLIC communication/tracking/actions and participation analytics. F032 management authoring includes both Admin prerequisites while legacy scoped read remains unchanged. Answers/contact/Notes retain contextual audience parent checks; legacy INTERNAL update-only admission is not silently removed. Department/Division scope remains separate and unchanged.

## Operator use

The CLI is not imported by application modules. From server, run `npm run dev:access -- --help` (or the installed tsx CLI directly). Load private local configuration into the process, not command arguments or tracked files. Required selection: F057_ORGANIZATION_ID, F057_STAFF_ID, F057_EXPECTED_REVISION (decimal string), F057_EXPECTED_BOOTSTRAP (true/false), F057_SYNTHETIC_ONLY=true, development NODE_ENV/profile and the approved localhost:5432 reqro_dev/reqro_dev_user URL without overrides.

Run `bootstrap --dry-run`, review the safe target reference, missing prerequisites, ownership creation and revision/state, then `bootstrap --confirm`. Subsequent operations are `add-manager` and `remove-manager`, each requiring current expected state and its own preview. Targets must already exist; the command never creates identities. No real/pre-existing development staff grants are used for F057 validation. A stale retry requires refresh; no automatic replay. Last-manager removal rejects in preview and execution. Pre-existing locked authority may remain after removing the controlled role's contributions and is reported honestly.

Operator output intentionally reports the requested permission delta; ordinary runtime helpers do not log bodies, identity claims, provider subjects or request data. CLI failures are fixed sanitized text and never serialize driver/configuration errors.

## Evidence and limitations

Disposable tests apply the migration chain transactionally in a random reqro_test schema, then prove down-before-use/reapply and retained-state refusal. Tests cover database and code allowlists, active/multi-role managers, current identity re-resolution, cross-Organization isolation, audited deltas, no-op/stale behavior, immutable audit, F036/F027 integration, shared contributions, scope preservation, Organization lifecycle, concurrent removals, independent Organization locks and injected failure rollback. Final counts and personal-development fingerprints are recorded below after validation completes.

No new UI: new accessibility/responsive UAT is not applicable. Existing React regressions remain required. No Entra changes, groups, App Roles, directory synchronization, machine principals, identity rebinding change, per-permission scope, direct staff-permission table, Access Profiles, temporary grants or break-glass workflow. Existing inactive hierarchy scope semantics remain a documented limitation. No external provider/cloud/client resources, push or deployment are part of this feature.

## Personal development migration and operator evidence

Migration 38 applied successfully through the existing repository migration CLI using its compiled entry point and compiled migration directory. The initial tsx launcher failed before execution with an OS `uv_os_get_passwd`/ENOMEM error; a compiled attempt against source migrations also failed with the sanitized CLI error. The 37-migration baseline was rechecked before the successful compiled-directory run. There was no partial application, migration rewrite, extra migration or remote operation.

After up: 38 applied, zero pending, 60 tables. Migrations 1–37 are unchanged. Disposable PostgreSQL up, down-before-use and reapply passed. Down-after-retained-state refused and preserved history. The personal database was not rolled back after legitimate synthetic audit history was retained.

All 56 original table contents were fingerprinted read-only before migration. After migration, only permission (30→32) and kysely_migration (37→38) changed; original role fingerprints exclude the newly introduced null creation-transaction column. No old staff, roles, assignments, memberships, requests, audience/channel/attribution, catalog/version references, answers, locations, tracking or prior audit contents changed. Access audit and ownership were empty immediately after migration. The original Organization starts at authorization revision 0, unbootstrapped, with zero new access-management grants.

Operator validation used one new isolated Organization, **F057 Synthetic Security Validation** (slug `f057-security-foundation-validation`), and two clearly synthetic local staff fixtures, with no Entra mapping. They are validation records, not provider accounts or an operational recovery mechanism. Executed through the actual compiled operator CLI:

| Operation                                | Result                                                           | Authorization revision |
| ---------------------------------------- | ---------------------------------------------------------------- | ---------------------- |
| Fixture creation                         | Isolated new Organization and two local synthetic staff          | 1                      |
| Bootstrap preview                        | No writes                                                        | 1                      |
| First-manager bootstrap                  | Three missing prerequisites, one provisioning role, one audit    | 2                      |
| Second-manager preview                   | No writes                                                        | 2                      |
| Second-manager provisioning              | Separate role and second audit                                   | 3                      |
| Remove-second-manager preview            | No writes                                                        | 3                      |
| Remove second manager                    | Only its three owned contributions removed; third audit retained | 4                      |
| Repeat original bootstrap                | No-op                                                            | 4                      |
| Remove last manager, preview and execute | Both rejected                                                    | 4                      |
| Stale expected revision                  | Rejected                                                         | 4                      |

No existing development identity or grant was repurposed. The second empty provisioning role and its active assignment remain by design. No immutable history was deleted for cleanup. Operator output inspection passed: no full staff IDs, provider subjects, credentials, tokens or driver-error dumps; safe target suffixes and deliberate permission deltas are expected preview/output, not application request logs.

| Resource                    | Before | After migration | After synthetic operator validation |
| --------------------------- | -----: | --------------: | ----------------------------------: |
| Organization                |      1 |               1 |                                   2 |
| staff_identity              |      3 |               3 |                                   5 |
| role                        |      4 |               4 |                                   6 |
| role_permission             |     40 |              40 |                                  43 |
| staff_role_assignment       |      4 |               4 |                                   6 |
| staff_department_membership |      4 |               4 |                                   4 |
| staff_division_membership   |      4 |               4 |                                   4 |
| permission                  |     30 |              32 |                                  32 |
| organization_access_state   | absent |               1 |                                   2 |
| access_role_ownership       | absent |               0 |     2 administrator / 0 operational |
| access_change_set           | absent |               0 |                                   3 |
| access_permission_delta     | absent |               0 |                                   9 |
| kysely_migration            |     37 |              38 |                                  38 |

Final fingerprints exclude only these explicitly identified synthetic records, the two new permissions and the Migration 38 ledger entry: **all original table fingerprints match**. The original Organization remains revision 0/unbootstrapped; the synthetic Organization is revision 4/bootstrapped with one effective manager. Existing Department/Division memberships and shared/F036/F027 roles remain unchanged.

## Performance, privacy and operating limits

Foundation queries are set-based: one joined contribution query, one grouped SQL effective-manager calculation, indexed Organization state/target ownership lookups and an Organization/target/time/ID history index. Permission inserts/deletes/delta writes are batches rather than one query per key. A target snapshot has a fixed number of queries independent of the number of permissions or memberships. EXPLAIN smoke checks exercise state, ownership, bounded history and manager-count paths. Small disposable foundation sequences took milliseconds to roughly 150 ms in the observed runs; the full foundation fixture/migration/proof run took roughly 1.6–3.3 seconds depending on concurrent validation load. These are development observations, not production benchmarks or exhaustive capacity testing.

Failure injection covers role creation, ownership, permission mutation, assignment, revision, change-set audit, delta audit and late bootstrap activation; earlier writes roll back. Same-Organization concurrency is tested both with stale expected revisions and with serialized direct deactivations reaching the deferred invariant. Different-Organization locking proceeds with a bounded lock timeout while another Organization lock is deliberately held. Shared multi-role manager tests exercise role deactivation, assignment deactivation and permission removal. F036/F027 are exercised against Migration 38 as well as their existing regression fixtures.

The source contains no logging of runtime mutation bodies or private identity values. The CLI has a fixed failure message; its production/private-input rejection is tested with a sentinel. Existing logging-sanitization and HTTP logging regressions remain in the required suites. Added/changed text was checked against private local configuration values and high-confidence secret patterns without printing those values. No private match, credential artifact, log capture, dump or temporary script was retained.

## Commands and checks

All commands use the installed Node CLIs corresponding to package scripts. PostgreSQL tests load only TEST_DATABASE_URL from ignored local configuration into the child process; E2E/unit runs do not inherit the private server .env wholesale.

```text
server: node node_modules/typescript/bin/tsc -p tsconfig.test.json
server/dist-test/test/unit: node --test --test-concurrency=1
server/dist-test/test/e2e: node --test --test-concurrency=1
server/dist-test/test/database: node --test --test-concurrency=1
root: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/Catalog.test.js test/Issue.test.js test/IssueListUtils.test.js test/IssueService.test.js test/LegacyIssueMatching.test.js test/Statistics.test.js test/ThemePreferences.test.js test/VitePrivateFiles.test.mjs
root: node node_modules/vitest/vitest.mjs run --config vitest.config.mjs --maxWorkers=1
server: node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
server: node node_modules/typescript/bin/tsc -p tsconfig.build.json
server: node node_modules/eslint/bin/eslint.js .
server: node node_modules/prettier/bin/prettier.cjs --check "{src,test,migrations}/**/*.{ts,json,md}" "scripts/*.mjs" "*.{json,md,yml}"
root: node node_modules/vite/bin/vite.js build react --outDir ../dist-react --emptyOutDir
root: git diff --check
```

The first full React run had one existing F056.5 IssueCreation test exceed its five-second timeout under concurrent validation; 679 passed. A separate full rerun passed all 680 with unchanged tests/timeouts and no React source edits. Existing module-type and Vite large-chunk warnings remain. No frontend lint script exists; configured backend ESLint is the lint check. No new UI accessibility or responsive UAT is claimed.

## Final validation and review

| Suite                   | Passed distinct tests | Failed | Skipped |
| ----------------------- | --------------------: | -----: | ------: |
| Backend unit            |                   312 |      0 |       0 |
| API E2E                 |                    40 |      0 |       0 |
| PostgreSQL integration  |                   441 |      0 |       0 |
| Shared                  |                    64 |      0 |       0 |
| React                   |                   680 |      0 |       0 |
| **Total, counted once** |             **1,537** |  **0** |   **0** |

F057 adds seven unit tests and 31 PostgreSQL tests (30 subtests plus their parent). Focused reruns and the earlier failed React run are not added to the distinct total. Backend unit and PostgreSQL suites were rerun after final foundation changes. API E2E/shared/React passed; no subsequent application change affects their covered routes or UI.

| Check                                    | Result                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Test compilation and TypeScript          | PASS                                                                                              |
| Configured backend ESLint                | PASS                                                                                              |
| Configured Prettier formatting           | PASS                                                                                              |
| Backend production build                 | PASS                                                                                              |
| Frontend production build                | PASS; existing large-chunk warning                                                                |
| Whitespace / git diff --check            | PASS                                                                                              |
| Changed-document relative links          | PASS                                                                                              |
| Private configuration / secret review    | PASS                                                                                              |
| Logging privacy                          | PASS; source review, synthetic operator capture, negative CLI sentinel and existing logging tests |
| Migration up / down-before-use / reapply | PASS in disposable PostgreSQL                                                                     |
| Retained-state down refusal              | PASS; no retained history destroyed                                                               |
| Personal development migration           | PASS; 38 applied / 0 pending                                                                      |
| Original data fingerprints               | PASS; no unexplained changes                                                                      |
| Hooks / automation                       | Only sample Git hooks; no configured hook path or GitHub workflows; no deployment scripts invoked |

| Required regression                                           | Result |
| ------------------------------------------------------------- | ------ |
| Entra signature/issuer/audience/tenant/object/delegated scope | PASS   |
| Staff Access Guard and development fallback restrictions      | PASS   |
| Service Request policy and INTERNAL request access            | PASS   |
| F027 and F036 provisioning                                    | PASS   |
| F032 Handling authorization and scope                         | PASS   |
| F045 location                                                 | PASS   |
| F048 default assignment                                       | PASS   |
| F049 identity policy                                          | PASS   |
| F052 Admin foundation                                         | PASS   |
| F053 intake settings                                          | PASS   |
| F054 branding                                                 | PASS   |
| F055 participation areas                                      | PASS   |
| F056 Issue configuration                                      | PASS   |
| F056.1 discovery                                              | PASS   |
| F056.2A protected answers                                     | PASS   |
| F056.2B Handling/Availability                                 | PASS   |
| F056.2C question types                                        | PASS   |
| F056.3 intake/workspace                                       | PASS   |
| F056.4 shell                                                  | PASS   |
| F056.5 creation/refinement/governed Availability              | PASS   |
| Broader repository suites                                     | PASS   |

All six pre-implementation design gates are resolved: database writer/revision coverage with cooperating lock order; deferred effective last-manager validation; inactive-Organization exemption with guarded reactivation; fresh ownership and F036 isolation; frozen database allowlist plus code parity; one revision per Organization/transaction. All expected security-question answers in the implementation specification are satisfied within the explicitly documented API/operator versus privileged-database-owner boundary.

No direct staff-permission or per-permission-scope table, membership editing, role inheritance, explicit deny, expiration, Access Profile, Entra change, identity account creation through F057, provider rebinding change, runtime Access API, Access UI/navigation, security notification or break-glass feature. Existing provisioning roles/grants and membership semantics are retained. The synthetic validation fixtures above are the only new retained local staff/Organization records. Ordinary existing Admins received no access-management authority.

The final reviewed scope is the 22 files identified in the implementation map plus the permission/types, existing writer lock integrations and five documentation index/checkpoint updates. No React, existing migration, token validation, provider, deployment or lockfile changes. Generated build/test output is ignored; no scratch SQL/scripts, private logs, dumps or screenshots were created as repository artifacts. No push, tag, release, deployment, Firebase, Azure, Entra, DNS or client/production resource operation occurred. Main's accepted parent and origin/main are `54319416bb3d4af4ff7900baf55acc3b1f887ccf`; the local commit is reported externally to avoid a self-referential commit hash in this document.

Next step: user review of the local commit, migration, ownership, revision/audit, bootstrap and limitations. Synchronization requires separate approval. F057.2 remains unstarted.
