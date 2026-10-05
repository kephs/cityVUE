# F059.2 Slice 4C-3C — Separate review authority

Status: implemented and approved by human security/architecture review for one
local backend/security commit. Validation results and limitations are recorded
below. React work remains uncommitted. No development migration or provisioning
is authorized by this commit approval.

## Authorization and preserved work

The approved architecture separates draft writing, independent review, and
publication. Baseline is `codex/f059-tenant-config` at
`2d5c93f44c7698c4f01a6650f3338266389d9467`, one commit ahead of the last-known
upstream, with an empty index. Eight intentional modified files already existed.
The pending 4C-3/3A publication/review UI, polish, and advisory capability work is
preserved. No other worktrees were inspected.

This explicitly supersedes the publish-based review authority described in the
[Slice 4A foundation](F059-2-slice4A-review-publication-foundation.md) and
[Slice 4B lifecycle](F059-2-slice4B-exact-revision-review.md). Those records retain
their historical decisions and validation outcomes.

## Authority and presentation

All operations retain trusted active staff, active Organization, and Admin read
admission. Draft authoring/requesting requires `resident_experience.write`;
independent decisions require `resident_experience.review`; publication requires
`resident_experience.publish`. Each consequential operation independently requires
`resident_experience.contact.manage`. Review does not require publish or write;
publication does not require review or write.

The new key is sensitive, provisioning-only, and requires
`admin.configuration.read`. There are zero default grants, no bundle additions,
and no expansion of the frozen 27-key delegation list. F036 accepts the new key
only as an explicit selection, retaining its environment, identity, database,
Organization, ownership, and provenance protections.

`canRequestReview`, `canReview`, and `canPublish` remain advisory protected server
projections. React receives no new permission arrays, identities, or denial
internals. POST contracts remain unchanged and revalidate current authority under
the existing transaction locks. Historical-republication request eligibility is
unchanged; it is distinct from the authority to approve that request.

## Migration 44 and policy transition

The directory was rechecked: 43 migrations existed. Migration 44 is
`20261014000000-separate-resident-review-authority.ts`. Migrations 42 and 43 are
unchanged. Migration 44 registers only `resident_experience.review`, introduces
`resident_review_authorized`, and changes decision and reviewer-side publication
guards to use it. Publisher-side `resident_publication_authorized` is preserved.

Review policy advances from 1 to 2; classifier version remains 1. The database
retains version-1 rows but permits only version 2 for new requests. Both application
and database context evaluation reject version-1 evidence for new decisions or
publication. Existing revisions, requests, decisions, and events are not rewritten;
existing published content stays public. Granting review permission cannot revive
version-1 evidence. A new exact request and independent decision are required.

Migration locks coordinate with Organization/access/resource operations. Original
immutable-history triggers, composite foreign keys, exact revision/baseline/context
bindings, contributor exclusions, 24-hour expiry, unique consumption, and deferred
event/pointer integrity remain in place. Publication refreshes reviewer review
authority and publisher publication authority independently; the two identities
must differ even when a person has both permissions.

Rollback refuses any retained version-2 request (and therefore its decisions or
publication evidence), review grant, or retained access-permission delta. It never
deletes such evidence or grants. An evidence-free rollback restores the original
version-1 functions and removes the new registration. Forward correction is the
appropriate approach after version-2 evidence is retained. Coordinate application
and database rollout; no mixed-version authorization fallback is provided.

## Later development UAT — separate authorization required

Do not apply Migration 44 or change `reqro_dev` under this slice. Do not reconcile
the earlier documented development-UAT provenance discrepancy by changing data.

After separate migration/provisioning approval and normal database identity,
backup, migration and readiness checks:

1. Preserve Staff A: Admin read, write, contact manage; no review or publish.
2. Use F036 selected-grant **deprovisioning** for Staff B's owned
   `resident_experience.publish` grant, with dry-run first.
3. Use F036 explicit provisioning for Staff B's `resident_experience.review`,
   preserving Admin read/contact manage and the existing Organization/scopes.
4. Preserve Staff C: Admin read, publish, contact manage; no write or review.
5. Verify effective authority through the normal service, not just grant rows.
6. Only after provisioning, request and approve fresh version-2 evidence. Authority
   changes invalidate existing bound context. Then perform three-identity UAT.

Do not merely add review on top of Staff B's existing publish grant. F036
provisioning is additive; the explicit selected revocation is necessary. No
default role, bundle, delegation, or unrelated staff change is intended.

The later Staff B command sequence, **not executed in this slice**, from `server/`
with the already verified personal F036 staff/Organization/scope inputs and no
`F036_BUNDLE`, is:

```powershell
$env:F036_PERMISSIONS = 'resident_experience.publish'
npm run dev:staff:deprovision -- --dry-run
# Review dry-run, then separately authorized execution:
npm run dev:staff:deprovision -- --confirm
$env:F036_PERMISSIONS = 'resident_experience.review'
npm run dev:staff:provision -- --dry-run
# Review dry-run, then separately authorized execution:
npm run dev:staff:provision -- --confirm
```

Staff C requires no new grant. Verify its effective publish authority and absence
of review/write; do not execute Staff B's commands with Staff C selected.

## Validation

Final command results are recorded below; focused and supplemental results overlap the broader suites and are not added to distinct totals.
All automated database work must use verified local `reqro_f0592_test` as
`reqro_test_user`, with isolated disposable schemas. No automated test uses
`reqro_dev`. Manual UAT has not been performed for this authority separation.

### Invocation history (retained)

- Initial focused PostgreSQL/API run: 44 passed / 7 failed / 0 skipped. Five
  failing leaf tests (and two failing parents) exposed combined-authority fixture
  assumptions, a shared permissions-array mutation in a new test helper, an old
  policy-check error assertion, and the HTTP fixture still using publish to review.
  Fixtures now copy their permissions and deliberately grant combined capabilities
  only in separation/contributor tests. Assertions retain the same protections.
- Corrected focused PostgreSQL/API/development-provisioning run: 107 passed,
  zero failures/skips. This predates the additional independent consequential
  contact-authority regression; later full runs include that test.
- Initial focused unit run: 26 passed / 1 failed because the new trusted-context
  fixture used non-UUID internal identifiers. Corrected fixture rerun: 27 passed.
- Initial focused React run: 27 passed / 1 timeout at the existing 5-second limit
  in the initial Branding/preview test. Frontend source and tests were unchanged.
- Initial whole-server lint: four no-confusing-void-expression errors in the new
  unit assertions; corrected with block-bodied callbacks, without changing checks.
- An incremental compilation invocation used an incorrect parent-directory cache
  path and failed with TS5033/EPERM. No outside-worktree cache was written. A
  read-only process lookup intended to stop that invocation was denied; the
  compiler exited normally with the error. The corrected cache path stays under
  ignored `.local-uat/` and compilation passed. Earlier ordinary test compilations
  also passed; this failed invocation is not reclassified.
- First full backend units: 458 passed / 5 failed. Two permission tests retained
  old vocabulary/provisioning assumptions; updated to recognize the fourth key
  and distinguish explicit development allowlisting from automatic bundles.
  Three other failures were the known `911` timestamp-regex false positive,
  the 60-second development-startup compiler timeout, and a logging-test startup
  child timeout. Logging/startup tests and their limits remain unchanged.
- First full PostgreSQL run exposed the Access Discovery test's fixed permission
  catalog count of 35 at three scales. Updated to 36 for the explicit new key;
  the runtime manageable/delegation list remains exactly 27.

### Commands and results

Commands use the available Node runtime. Backend commands run from `server/`
where indicated; others run from the repository root. Ignored
`.local-uat/4c3c-checks.cjs` runs the existing Node/Vitest commands with inherited
application/identity settings removed. Database mode verifies actual local
`reqro_f0592_test` / `reqro_test_user` before launching the isolated-schema suite;
only `TEST_DATABASE_URL` is passed to that suite, never a development database URL.
The wrapper and raw logs are local validation artifacts, not feature source.

| Check / command                                                                                                                                                                                                                                                                                                        | Result                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node .local-uat/4c3c-checks.cjs unit resident-experience-review.test.js access-policy.test.js development-staff-input.test.js`                                                                                                                                                                                        | Corrected focused run: 27 passed, 0 failed/skipped.                                                                                                                                                                                              |
| `node --test --test-concurrency=1 dist-test/test/database/resident-experience-review.integration.test.js dist-test/test/database/resident-experience-admin.integration.test.js dist-test/test/database/resident-experience.integration.test.js dist-test/test/database/development-staff.integration.test.js` (server) | 107 passed, 0 failed/skipped before the final extra contact regression.                                                                                                                                                                          |
| `node .local-uat/4c3c-checks.cjs db`                                                                                                                                                                                                                                                                                   | First full run: 660 passed / 4 failed. Corrected full rerun: **664 passed / 0 failed / 0 cancelled / 0 skipped**, including final migration, review/publication HTTP, authority split, upgrade and development-provisioning coverage.            |
| `node .local-uat/4c3c-checks.cjs unit`                                                                                                                                                                                                                                                                                 | First: 458 passed / 5 failed. Corrected full rerun: **461 passed / 2 failed / 0 skipped** (startup timeout and known logging timestamp regex). Not a clean full unit suite.                                                                      |
| `node .local-uat/4c3c-checks.cjs unit development-startup.test.js`                                                                                                                                                                                                                                                     | Isolated supplemental rerun: **1 passed**, unchanged timeout. Does not rewrite either failed full invocation.                                                                                                                                    |
| `node .local-uat/4c3c-checks.cjs e2e`                                                                                                                                                                                                                                                                                  | **68 passed / 0 failed / 0 skipped**.                                                                                                                                                                                                            |
| `node .local-uat/4c3c-checks.cjs shared`                                                                                                                                                                                                                                                                               | **64 passed / 0 failed**.                                                                                                                                                                                                                        |
| `node server/node_modules/typescript/bin/tsc -p server/tsconfig.test.json`                                                                                                                                                                                                                                             | Passed; later incremental compilations with cache under `.local-uat/` passed after the documented incorrect cache-path failure.                                                                                                                  |
| `node server/node_modules/typescript/bin/tsc -p server/tsconfig.test.json --incremental --tsBuildInfoFile .local-uat/4c3c-test.tsbuildinfo`                                                                                                                                                                            | Final test compilation passed.                                                                                                                                                                                                                   |
| `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` (server)                                                                                                                                                                                                                                              | Passed.                                                                                                                                                                                                                                          |
| `node node_modules/typescript/bin/tsc -p tsconfig.build.json` (server)                                                                                                                                                                                                                                                 | Passed.                                                                                                                                                                                                                                          |
| `node node_modules/eslint/bin/eslint.js .` (server)                                                                                                                                                                                                                                                                    | Corrected whole-server run passed. Supplemental lint of subsequently updated database/catalog tests passed.                                                                                                                                      |
| `node .local-uat/4c3c-checks.cjs react react/test/ResidentExperienceEditor.test.jsx`                                                                                                                                                                                                                                   | Final isolated focused rerun: **28 passed** at unchanged timeouts; initial focused run remains 27 passed / 1 timeout.                                                                                                                            |
| `node .local-uat/4c3c-checks.cjs react`                                                                                                                                                                                                                                                                                | **877 passed / 5 failed** across 59 files. Failures in unchanged Issue Creation (3) and Participation (2), with timeout-related failures. All 28 Resident Experience workflow tests passed within this invocation. Not a clean full React suite. |
| `node .local-uat/4c3c-checks.cjs react-build`                                                                                                                                                                                                                                                                          | Passed; existing large-chunk warning remains. Underlying command is `vite build react --outDir ../dist-react --emptyOutDir`.                                                                                                                     |
| `node server/node_modules/prettier/bin/prettier.cjs --check <Slice 4C-3C changed files>`                                                                                                                                                                                                                               | Passed; no formatting rewrite of preserved frontend files or the existing Slice 4B working copy.                                                                                                                                                 |
| `git diff --check`                                                                                                                                                                                                                                                                                                     | Passed.                                                                                                                                                                                                                                          |

Frontend lint is not configured and was not claimed as executed. The unchanged
logging test matches `911` inside the epoch-millisecond time field; no sensitive
Resident Experience payload was emitted by that diagnostic. Logging and startup
assertions, timeouts, and implementation were not modified. The earlier feature
records retain their own failed, interrupted, and rerun histories.

## Files and completion boundary

This slice changes these 17 files, including additions:

- `docs/features/F059-2-slice4C-3C-review-authority.md` (new)
- `server/migrations/20261014000000-separate-resident-review-authority.ts` (new)
- `server/src/access/access-policy.ts`
- `server/src/auth/auth.types.ts`
- `server/src/database/development-staff-input.ts`
- `server/src/resident-experience/resident-experience.database.ts`
- `server/src/resident-experience/resident-experience.publication.service.ts`
- `server/src/resident-experience/resident-experience.review.repository.ts`
- `server/src/resident-experience/resident-experience.review.service.ts`
- `server/src/resident-experience/resident-experience.review.ts`
- `server/test/database/access-discovery.integration.test.ts`
- `server/test/database/resident-experience-review.integration.test.ts`
- `server/test/unit/access-policy.test.ts`
- `server/test/unit/development-staff-input.test.ts`
- `server/test/unit/resident-experience-admin.test.ts`
- `server/test/unit/resident-experience-review.test.ts`
- `server/test/unit/resident-experience.test.ts`

Four additional pre-existing modified files remain untouched by this slice: the
Slice 4B feature record, `ResidentExperienceEditor.jsx`, `residentExperience.css`,
and `ResidentExperienceEditor.test.jsx`. Frontend and Migration 42/43 hashes were
verified unchanged. Existing uncommitted capability work in overlapping backend
files was preserved and extended; nothing was reset, stashed, or discarded.

No endpoint contract, public renderer, notification, default role, bundle or
delegation change. Implementation validation performed no development grant,
migration application, data repair, staging, commit, push or deployment.
Migration 44 ran only in disposable test schemas. Subsequent human review approved
one local commit containing the 17 backend/security/documentation files above.
The four pre-existing files remain uncommitted. Push, development migration,
role correction and final browser UAT remain separate controlled steps.
