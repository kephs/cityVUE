# F059.2 Slice 4B — Exact-revision review lifecycle

Status: implemented; STOP for architecture/security review. Backend/security
validation passed; broader React validation is not clean (see retained results).
Baseline: `codex/f059-tenant-config` at
`a1f43452101b700a7e11b8d22fb6119c702002bf`, verified against the actual remote
feature branch, with a clean index/tree before editing. This builds on the
[accepted Slice 4A foundation](F059-2-slice4A-review-publication-foundation.md).

## Protected contract

All routes are under `/api/v1/admin/resident-experience`. Verified Entra identity,
trusted active staff and server-resolved Organization plus `admin.configuration.read`
are required. Every service transaction refreshes authority from PostgreSQL under
the Organization/access-state barrier. No caller-selected Organization is accepted.
All success and error responses receive `Cache-Control: no-store`, including
authentication denials. Query selectors and GET bodies are rejected.

| Method/path                                 | Contract                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /review-context`                       | Current resource revision, draft/publication IDs and latest review request ID; a bounded discovery read, not history                  |
| `GET /revisions/:revisionId`                | Exact Organization-scoped saved snapshot, shared preview presentation and bounded classification against the current publication      |
| `POST /review-requests`                     | Strict body: `targetRevisionId`, `expectedRevision`, `purpose` (`draft` or `historical`), and required nullable `supersedesRequestId` |
| `GET /review-requests/:requestId`           | Immutable request/decision projection, current usability, evaluation time and caller's `canReview` capability                         |
| `POST /review-requests/:requestId/decision` | Strict body: `expectedRevision` and terminal `outcome` (`approved` or `rejected`)                                                     |

The exact-read response contains `presentation` using the existing shared preview
DTO and `review` using the validated domain snapshot. The latter includes disabled
items, structured contact references and guidance needed for complete human review.
It exposes no persistence rows, Entra IDs, actor identities or audit internals.
`unpublished: true` denotes protected preview presentation, even when a historical
target once was published. `changes` contains bounded section keys and reason codes,
not arbitrary before/after payloads. No frontend, renderer or public preview route
is added. A later UI must use the existing inert preview mode, not active links;
the response flag alone is not a browser security control.

## Requests, decisions and exact binding

### Current uncommitted UAT follow-up: request capability and replacement

The protected review context now includes advisory `canRequestReview` for the
current saved draft. Draft-purpose requests require Admin read, draft-write and,
when the server classifies the publication as consequential, contact authority.
Historical request authority remains unchanged. These follow-ups supersede the
original draft requester policy described below; they create no grants.

Projection and draft POST use the same current-draft eligibility evaluation.
A current pending or usable approved review blocks a duplicate request. A stale,
expired, rejected, superseded or consumed prior review does not prevent a fresh
request for an otherwise eligible draft. POST still requires the exact expected
resource revision and latest predecessor in `supersedesRequestId`, under the
existing locks. No approval evidence is rewritten or reused.

UAT reported draft 8 with an approved but stale review of revision 6 and no Author
request button. A read-only invocation of the current service against the approved
development database returned `canRequestReview=true`; all Author authority and
draft eligibility checks passed. This is service-level evidence, not a captured
authenticated browser response. Inspection found that Save discarded review
context, including its capability, and did not reload it. The editor now refreshes
the protected workflow after Save and sends the predecessor from review-context,
including when a pending request belongs to an older context. The existing
`canReview` and `canPublish` controls remain advisory and server-authoritative.

Focused validation for this correction: 11 review-domain units, 48 disposable
PostgreSQL/protected HTTP tests (zero skipped), and 28 Resident Experience React
tests passed. Typecheck, test compilation, backend build, changed-backend ESLint,
React production build, formatting and diff checks passed. The initial test
compilation failed because the new publication fixture used the wrong argument
shape; the corrected compilation passed. Initial ESLint found a numeric template
interpolation in a new test; explicit conversion fixed it and the rerun passed.
React build retained the existing large-chunk warning. Overlapping React reruns
are not added together. Broader suites were not rerun for this focused correction;
previous full-suite failures below remain historical evidence. No development data,
permissions, migrations or publication transaction were changed for this repair.

Request creation requires Admin read and either draft-write or publication authority,
matching the accepted Slice 4A requester policy. It is not an approval. The server
binds the immutable target, Organization, resource revision, current draft pointer,
current publication baseline (including null), authorization revision, purpose,
policy/classifier versions, requester and database timestamp. Client-supplied
baseline, classification, actor, authority revision and timestamps are rejected.
Migration 43 independently checks/stamps this evidence.

Draft-purpose requests require the exact current draft. Historical requests require
prior publication evidence in the same Organization and a target different from the
current publication. Historical review does not republish. Every first publication
is consequential, even a generic/empty configuration. Subsequent classification
compares the current published immutable snapshot with the exact target, never just
the last draft-save event. Existing conservative action/contact/navigation/footer
classification is retained.

Decision submission requires fresh Admin read plus `resident_experience.publish`,
and additionally `resident_experience.contact.manage` for consequential review.
Review never requires edit authority. The accepted contact permission prerequisite
remains Admin read; no metadata, bundles, default grants or delegation changes are
made in 4B.

Both approval and rejection are immutable terminal decisions: one per request,
with no update/delete API. Database constraints/triggers remain the final defense.
The immutable reviewer identity is retained internally for future publisher separation.
Neither a decision nor a review request inserts publication evidence or modifies the
resource revision, draft pointer or published pointer.

## Separation and usability

The target saver cannot review. The accepted Slice 4A lineage function additionally
excludes consequential contributors on both divergent ancestry branches before the
nearest common ancestor. Thus a later cosmetic saver cannot hide a contact author's
contribution, and historical reversal cannot be approved by the author whose
consequential change it undoes. With no publication baseline, the complete target
ancestry is considered. Missing/cyclic/excessive ancestry fails closed.

`evaluateResidentApproval` is the shared usability evaluation over immutable evidence
and fresh server-resolved context. The service supplies database time, current
resource/authorization bindings, latest request, eligibility, consumption, contributor
exclusions and current reviewer activity/authority. Approved evidence is usable only
within `[decidedAt, decidedAt + 24 hours)`, with the database-stamped expiry unchanged.
Expiry never edits a decision. Pending, rejected, superseded, consumed, stale,
expired, unauthorized or separated evidence is unusable. Resource/draft/publication,
authorization, policy/classifier or exact target/Organization changes fail closed.
Relevant authorization changes conservatively invalidate evidence even if subsequently
regranted. Inactive/revoked reviewers are rechecked independently.

Usability is eligibility of the approval, not authority for the current reader to
publish. The response explicitly carries `independentPublisherRequired: true`.
The evaluator can check a supplied publisher identity, but 4B exposes no publisher
command or caller-selected publisher. Slice 4C must independently resolve fresh
publisher authority, require publisher != reviewer and reevaluate usability within
the publication transaction. No single-person/emergency bypass is introduced.

## Concurrency and errors

Short READ COMMITTED transactions lock active Organization, access state and then
the Resident Experience resource (share for reads, update for commands). Supported
authorization writers take the matching exclusive barrier. Mutable context and
authority are resolved after lock acquisition; immutable revisions need no rewrite.

`expectedRevision` must equal the current resource revision. Required
`supersedesRequestId` must equal the Organization's latest request, including null
for the first request. A new request immutably supersedes that exact predecessor;
the Organization-wide sequence from 4A permits only the latest request to be usable.
Two callers with the same selection cannot both create requests. Decisions serialize
on the same resource lock, reject stale context and permit one terminal winner.
There is no automatic retry or last-write-wins behavior.

Malformed bodies/selectors return 400; authentication/authority return 401/403;
unknown, malformed route IDs and cross-Organization identifiers return the same 404;
stale/superseded/duplicate operations return 409. Scoped IDs are resolved before
context conflict checks. Raw trigger/unique-conflict errors are translated to a
fixed conflict message. Unexpected errors retain the established sanitized filter.
No new request-body logging or sensitive operation logging is added.

## Boundaries and deferred work

No schema gap found; no migration authored or changed. Migration 43 is exercised
only in a verified loopback `reqro_f0592_test` / `reqro_test_user` connection and a
new disposable schema. The existing 4A fixture creates prior publication evidence
solely to test historical/ordinary review. No runtime publication mechanism exists
in 4B, and tests verify unchanged public state across request/approval/rejection.
No development database or permission provisioning is performed.

The unresolved development-UAT provenance discrepancy remains: the earlier read-only
assessment observed no retained Resident Experience drafts/events in `reqro_dev`
despite prior UAT reports. No cause is inferred and no repair attempted. Reconciliation
remains prerequisite to later development UAT, not to disposable tests.

Slice 4C publication and pointer advancement, historical republication commands,
Slice 4D review/history/publication UI, development Migration 43 application and
development publication grants remain deferred and require their own authorization.

## Validation record

Validation uses the repository's TypeScript/Node test runner, ESLint, Prettier,
Vitest and Vite entry points. Commands run through the locally available Node binary;
no dependencies, timeouts, assertions or environment files were changed. Compiled
tests run from `server/dist-test/test`. PostgreSQL suites use the inherited private
`TEST_DATABASE_URL`, with an explicit URL/connected database/user/loopback gate
before the broader runner starts. Only isolated disposable schemas are used.

The four new protected HTTP tests run inside the Resident Experience PostgreSQL
fixture with the real controller/service/repository, synthetic verified principals
and actual transaction-time authority. They are included in the PostgreSQL counts,
not added to the separate full E2E-directory count. Existing foundation tests continue
to verify immutability, composite constraints, explicit SQL expiry instants,
consumption defenses and guarded rollback. No test sleeps to simulate 24-hour expiry.

| Invocation                                                         | Result                                                                                                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial and expanded test compilation                              | Passed                                                                                                                                                              |
| Initial focused review-domain/access-policy units                  | 15 passed / 0 failed / 0 skipped                                                                                                                                    |
| Initial changed-file lint                                          | Failed: four new-code style errors; corrected                                                                                                                       |
| Compilation/typecheck after removing redundant parser assertions   | Failed: three widened-return-type errors in each invocation; fixed with explicit parser return contracts                                                            |
| Corrected test compilation, backend typecheck and production build | Passed                                                                                                                                                              |
| Initial focused PostgreSQL/real HTTP run                           | 71 passed / 2 failed / 0 skipped, including failed parent; new phone fixture used the wrong normalized format                                                       |
| Corrected focused PostgreSQL/real HTTP run                         | 73 passed / 0 failed / 0 skipped; includes 39 review-foundation/lifecycle tests and 34 earlier Resident Experience tests                                            |
| First whole-server lint                                            | Failed: one unnecessary optional chain in a new assertion; corrected                                                                                                |
| Initial full backend units (default concurrency)                   | 454 passed / 2 failed / 0 skipped; existing development-startup and logging startup subprocesses timed out                                                          |
| Full backend unit rerun (`node --test --test-concurrency=1`)       | 456 passed / 0 failed / 0 skipped; unchanged timeouts/assertions                                                                                                    |
| Initial full E2E directory                                         | 48 passed / 3 failed / 0 skipped; inherited external-identity opt-in conflicted with harnesses that clear Entra settings, preventing some child tests from starting |
| Full E2E rerun with isolated test-process Entra settings           | 68 passed / 0 failed / 0 skipped                                                                                                                                    |
| Initial full PostgreSQL                                            | 250 passed / 4 failed / 1 cancelled / 0 skipped; same inherited Entra configuration issue aborted two HTTP fixture groups and dependent child tests                 |
| Shared tests                                                       | 64 passed / 0 failed                                                                                                                                                |
| React production build                                             | Passed; retained bundle-size and plugin-timing warnings                                                                                                             |

The full PostgreSQL rerun passed **651 / 651, zero skipped**, using the same
disposable gate and `node --test --test-concurrency=1`. Whole-server ESLint rerun,
final test compilation, changed-file Prettier check, `git diff --check` and the
changed-file private-environment-value scan passed. No migration or
permission-metadata files changed.

The initial full React invocation was interrupted (exit -1, incomplete) after
discovering inherited `VITE_*` UAT configuration selected API intake in tests
expecting the default fixture mode. Its three completed files reported **26 passed /
22 failed**: Issue Creation 14/3, Report Issue 0/16 and Issue Configuration 12/3.
This is a partial result, not a full-suite total; timeout failures also occurred.
Only the verified test runner and its Node descendants were stopped. The full
rerun clears `VITE_*` only in a cloned child-process environment, keeps `NODE_ENV=test`
and the existing `--maxWorkers=1`, and changes no test/code/configuration file.
The existing module-type warning for `calendarDate.js` was also emitted.

The environment-isolated full React run completed: **867 passed / 3 failed**,
**57 passed / 2 failed files (59 total)**, exit 1. The failures were the existing
five-second limits in Issue Creation's External Redirect test and Extended
Questions' type-switching builder test, plus Issue Creation's subsequent Availability
test failing to find the `Roads` option. No frontend source/test changed. Resident
Experience tests passed within that full run. The supplemental two-file rerun
finished **35 passed / 7 failed (42 total)**, exit 1: all 25 Extended Questions
tests passed, while 7 of 17 Issue Creation tests hit their unchanged five-second
limits. This supplements, and does not replace, the failed full invocation.
These unchanged UI tests remain a broader validation limitation for separate
investigation; neither their assertions/timeouts nor accepted UI was modified.

Final focused review-domain/access-policy rerun after compilation: **15 passed**;
this overlaps the full backend unit count and is not an additional distinct total.
For the environment-isolated reruns, only the spawned test process clears
`CITYVUE_ENABLE_EXTERNAL_IDENTITY`, `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID` and
`ENTRA_EXPECTED_AUDIENCE`; the tests supply their existing synthetic settings.
Normal development processes/configuration and authentication enforcement are unchanged.

One read-only wait-state diagnostic initially failed because PowerShell stripped
inline JavaScript quotes. The corrected stdin invocation succeeded and showed no
test database lock wait. It made no database mutation and is not a test result.
Earlier failed runs remain historical evidence. Overlapping reruns are not summed.

## Resume verification and command ledger

Recovery verified the existing Codex worktree, branch and accepted committed HEAD
above. The index was empty; only the ten intended Slice 4B files below were changed.
The tracked diff was five files, 742 insertions and 17 deletions, plus five new
untracked Slice 4B files. The feature tracking reference was 0 ahead / 0 behind
(last-known tracking state, not a new remote query). No migration beyond 43 or
Slice 4C implementation was present. No other agent's worktree was inspected.

The three outstanding final processes were recovered: backend typecheck, backend
production build and changed-file ESLint each exited 0. No runtime implementation
was restarted or changed during recovery. The known time-dependent logging-test
regex defect was not observed: the retained initial logging failure was a startup
subprocess timeout, not a `911` match in the timestamp.

In the following command ledger, `node` denotes the local runtime at
`C:/Users/stKyle/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`.
Commands without another directory noted run from `server`. The prior validation
record above retains the individual failures and reruns; these commands identify
their entry points without exposing environment values.

| Command                                                                                                                                                                                                                                                                                                     | Results in invocation order                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node node_modules/typescript/bin/tsc -p tsconfig.test.json --incremental --tsBuildInfoFile ../.local-uat/slice4b-test.tsbuildinfo`                                                                                                                                                                         | Initial/expanded passed; later compilation failed with three parser return-type errors; corrected and final compilation passed                        |
| `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`                                                                                                                                                                                                                                            | Failed with the same three type errors; corrected rerun and recovered final invocation passed                                                         |
| `node node_modules/typescript/bin/tsc -p tsconfig.build.json`                                                                                                                                                                                                                                               | Initial and recovered final production builds passed                                                                                                  |
| `node node_modules/eslint/bin/eslint.js <changed TypeScript files>`                                                                                                                                                                                                                                         | Four errors initially; recovered final invocation passed                                                                                              |
| `node node_modules/eslint/bin/eslint.js .`                                                                                                                                                                                                                                                                  | One new-code error initially; corrected whole-server rerun passed                                                                                     |
| `node --test dist-test/test/unit/resident-experience-review.test.js dist-test/test/unit/access-policy.test.js`                                                                                                                                                                                              | Initial and final: 15 passed, zero failed/skipped                                                                                                     |
| `node --test --test-concurrency=1 dist-test/test/database/resident-experience-review.integration.test.js dist-test/test/database/resident-experience.integration.test.js dist-test/test/database/resident-experience-admin.integration.test.js`                                                             | Initial 71 passed / 2 failed; corrected 73 passed / 0 failed; zero skipped                                                                            |
| `node --test` in `server/dist-test/test/unit`                                                                                                                                                                                                                                                               | 454 passed / 2 failed / 0 skipped                                                                                                                     |
| `node --test --test-concurrency=1` in `server/dist-test/test/unit`                                                                                                                                                                                                                                          | 456 passed / 0 failed / 0 skipped                                                                                                                     |
| `node --test --test-concurrency=1` in `server/dist-test/test/e2e`                                                                                                                                                                                                                                           | Initial 48 passed / 3 failed; isolated-environment rerun 68 passed / 0 failed; zero skipped                                                           |
| `node .local-uat/slice4b-db-suite.cjs` from repository root                                                                                                                                                                                                                                                 | Verified disposable target; initial 250 passed / 4 failed / 1 cancelled; isolated-environment rerun 651 passed / 0 failed / 0 cancelled; zero skipped |
| `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/Catalog.test.js test/Issue.test.js test/IssueListUtils.test.js test/IssueService.test.js test/LegacyIssueMatching.test.js test/Statistics.test.js test/ThemePreferences.test.js test/VitePrivateFiles.test.mjs` from root, `NODE_ENV=test` | 64 passed                                                                                                                                             |
| `node node_modules/vite/bin/vite.js build react --outDir ../dist-react --emptyOutDir` from root, `NODE_ENV=production`                                                                                                                                                                                      | Passed with the recorded warnings                                                                                                                     |
| `node node_modules/vitest/vitest.mjs run --config vitest.config.mjs --maxWorkers=1` from root, `NODE_ENV=test`                                                                                                                                                                                              | Interrupted; partial 26 passed / 22 failed, not a full-suite result                                                                                   |
| `node .local-uat/slice4b-react-suite.cjs` from root                                                                                                                                                                                                                                                         | Environment-isolated full run: 867 passed / 3 failed                                                                                                  |
| `node .local-uat/slice4b-react-suite.cjs react/test/IssueCreation.test.jsx react/test/ExtendedQuestions.test.jsx` from root                                                                                                                                                                                 | Supplemental run: 35 passed / 7 failed                                                                                                                |
| `node server/node_modules/prettier/bin/prettier.cjs --write <changed files>` and `--check <changed files>` from root                                                                                                                                                                                        | Formatting applied; changed-file check passed                                                                                                         |
| `git diff --check` from root                                                                                                                                                                                                                                                                                | Passed                                                                                                                                                |

The changed-TypeScript argument list consists of
`src/resident-experience/resident-experience.module.ts`,
`src/resident-experience/resident-experience.review.ts`,
`src/resident-experience/resident-experience.review.controller.ts`,
`src/resident-experience/resident-experience.review.input.ts`,
`src/resident-experience/resident-experience.review.service.ts`,
`test/unit/resident-experience-review.test.ts`,
`test/database/resident-experience-review.integration.test.ts` and
`test/helpers/resident-experience-review-api.ts`.
Formatting includes these eight files (with `server/` prefixes) and
`docs/features/F059-2-tenant-resident-experience.md` plus this document.
The ignored local wrappers only gate the disposable database or isolate inherited
test-process environment settings as described above; they are not committed source.
There is no configured frontend lint script. Manual security/architecture review
and authenticated Slice 4B UAT have not been performed by this validation.

## Completion boundary

Exactly ten intended files changed: this record, the feature overview, the review
domain evaluator, review input/controller/service modules, Resident Experience
module registration, review unit/database tests and the synthetic HTTP test helper.
The index remains empty, HEAD remains the accepted Slice 4A commit, and local test
wrappers/logs remain ignored under `.local-uat/`. No staging, commit, push, merge,
deployment, development migration/grant, publication or Slice 4C implementation
was performed. No schema gap was found. Architecture/security acceptance remains
a human decision; this record does not claim manual review/UAT approval.
