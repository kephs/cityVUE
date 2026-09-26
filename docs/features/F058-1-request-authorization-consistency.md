# F058.1 — Request authorization and read consistency

Status: implemented and validated locally; approved for the controlled F058.1 local commit. Synchronization is not authorized. The original React failure and subsequent classification remain recorded below.

Baseline: `7d0e294f5977749c5bbe1ce60d17aa9f6b5c4503`. This slice does not implement F058.2 UI, change the permission registry, add a migration, or authorize deployment.

## Transaction authority

`request-authorization.ts` reuses trusted workforce identity, the existing effective-permission resolver, and Department/Division memberships. It requires no Access Administration permission. Its mutation transaction uses READ COMMITTED and acquires these row locks in separate statements:

1. Active Organization `FOR SHARE`.
2. Organization access state `FOR SHARE`.
3. Re-read the active mapped Staff identity, effective permissions and memberships. No additional Staff lock is needed for this resolution.
4. Request `FOR UPDATE` for parent mutations, or `FOR SHARE` for protected child operations.
5. Existing Category/destination scope and selected target locks.
6. Attachment batch, where applicable; then writes and required Activity/audit.

The original request revision and `expectedRevision` remain independent concurrency controls. No Organization authorization revision is added to browser requests. Existing operation-specific and child-specific permission checks run against fresh authority. Assignment does not grant access.

Supported F057/F036/F027 writers acquire Organization/access-state exclusive locks before authorization DML. If a writer wins first, the operation waits and sees committed revocation. If the request barrier wins first, the writer waits until the operation commits or rolls back. Authority is stable for the database transaction, not until HTTP bytes reach the browser.

The barrier is applied to lifecycle, routing, ownership/watchers, authenticated legacy mutations, tracking management, Notes/Communication, audited Contact/answers/history and staff attachment operations. Compatibility parent reads establish Organization-first ordering. Resident tracking remains credential-authorized. The separately gated historical development Staff Actions path is not admitted through the workforce authorization helper.

## Creation and attachment preparation

Staff-assisted/internal creation revalidates its existing creation permissions inside the final transaction. Citizen creation uses Organization-first coordination without Staff RBAC. External geographic preparation runs before final locks; Issue availability, handling, version and loaded submission definition are re-read and compared before prepared results can be used. Configuration changes require a new authoritative attempt.

Finalized evidence retries retain the original receipt. New evidence finalization follows Issue/scope/target admission. A concurrently finalized batch is rechecked under its lock and returns its original receipt rather than creating another request.

Staff attachment batch operations locate their candidate parent without granting authority, acquire Organization/access-state and parent locks, then lock and revalidate the batch. Image processing, scanner calls and storage I/O occur outside the final authorization transaction. Final metadata/audit transactions revalidate current identity, ownership, state, expiry and integrity metadata. Prepared child attachments use an exact metadata manifest over immutable objects. Preview/download return buffered bytes only after fresh authorization and required audit commit.

Database rollback cannot undo external object writes. Failed uploads compensate their new object; existing orphan cleanup remains authoritative after a crash or compensation failure. Production storage/scanning remains deferred and development gates remain unchanged.

## Read snapshots and search

The unified list uses one read-only REPEATABLE READ transaction. Organization eligibility, actor mapping, permissions, memberships, count and bounded page rows belong to that snapshot. It does not acquire O/A writer-blocking locks or materialize all matches. The existing empty-list projection for an inactive Organization is preserved.

Requester history retains REPEATABLE READ and mandatory audit. If its snapshot predates a committed access-state change, the locking read fails closed with a serialization failure; there is no automatic retry.

Live search rejects C0, DEL and C1 controls before trimming. Existing length limits, empty search, literal case-insensitive matching, parameterization and escaping remain. Search operands remain request reference, historical Issue name and the displayed Service Location expression. Existing exact-reference search and six filters are preserved.

## Validation evidence

The targeted disposable PostgreSQL request suite passed **381 tests** before the additional parent/batch proof; the final full PostgreSQL suite passed **540 tests**, including explicit connection/query barriers for permission, Department, Division, Staff and Organization changes; competing request commands; tracking/disclosure ordering; target eligibility; Activity failure rollback; same/different Organization concurrency; and the three-session legacy/aligned/writer case. No timing sleep establishes the new tests' ordering.

Disposable list fixtures cover 20, 200 and 2,000 requests with pages of 25/50/100, combined filters, stable ties and page boundaries. Count/page snapshot tests cover concurrent insertion, deletion, status and membership changes.

Per list call: five authority/eligibility queries, two repository queries, and one read-only setup statement; BEGIN/COMMIT are additional transaction control. This is bounded query count, not constant computational cost. At 2,000 matching requests, the final EXPLAIN/BUFFERS observation reported count 56.216 ms / 22,017 shared hits and page (100 rows) 32.899 ms / 23,165 shared hits, both with zero shared reads. These are disposable development observations, not production benchmarks. Location and assignment correlated expressions still do work per candidate row. No index or migration is proposed from this evidence.

Final validation on the local F058.1 tree:

| Check                         | Result                                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend unit                  | 318 passed; zero failures/skips.                                                                                                                                           |
| API E2E                       | 41 passed; zero failures/skips.                                                                                                                                            |
| PostgreSQL integration        | 540 passed; zero failures/skips; disposable schemas only.                                                                                                                  |
| Shared                        | 64 passed; zero failures/skips.                                                                                                                                            |
| Affected React regression     | 263 passed across seven files.                                                                                                                                             |
| Original full React           | 710 passed / 2 failed across 712 tests (51 passing files / one failing file).                                                                                              |
| Isolated Issue Creation rerun | All 17 passed. Supplemental evidence, not a replacement for the full invocation.                                                                                           |
| TypeScript                    | Production typecheck and test compilation passed.                                                                                                                          |
| Configured backend lint       | Passed; final changed-file recheck also passed.                                                                                                                            |
| Formatting                    | Configured server check and all changed source/test/documentation files passed.                                                                                            |
| Production builds             | Backend and frontend passed; existing frontend chunk-size warning retained.                                                                                                |
| Whitespace                    | Passed.                                                                                                                                                                    |
| Documentation                 | 249 relative file/directory links across six changed Markdown files resolve.                                                                                               |
| Private-value review          | No new private values, provider identifiers or secrets found in the proposed scope. The credential-shaped test fallback is unchanged baseline loopback test configuration. |

The full React invocation failed the five-second External Redirect creation test and the following Availability test's “Roads” option lookup. The unchanged file passed in isolation (17/17). The initial report did not establish the cause of the second failure; the subsequent pre-commit investigation below supplies that evidence. No frontend source or tests were changed. In total, **1,675 distinct tests have passing evidence after the supplemental rerun**, and the later serial full-suite rerun passed all 712 tests without a timeout change. The original failed invocation remains recorded. Existing module-type warnings also remain.

No frontend file changed. The previously documented whole-file AdminConfigurationPage.jsx formatting condition remains outside this slice; it was neither rewritten nor used to waive new formatting failures.

Earlier failing implementation iterations included outdated transaction mocks, historical fixtures without access state, fabricated history mappings, attachment preparation/retry integration defects, and tests pausing at preparation when they intended final admission. These were corrected and the affected backend suites rerun; failed invocations are not represented as passing results.

### Deterministic concurrency coverage

| Requirement | Disposable proof                                                                                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A–C         | Permission, Department and Division revocation before/after lifecycle barrier.                                                                                                                                                     |
| D–F         | Assignment and routing before/after permission revocation; target membership writer wins before assignment eligibility.                                                                                                            |
| G           | Routing versus assignment: one expectedRevision winner.                                                                                                                                                                            |
| H–I         | Tracking and submitted-answer disclosure before/after permission revocation; existing Contact/answer audit-failure withholding retained.                                                                                           |
| J           | Competing lifecycle commands on one request: one revision winner.                                                                                                                                                                  |
| K–L         | Two different requests hold shared Organization barriers concurrently; another Organization remains independent of a writer.                                                                                                       |
| M–N         | Staff and Organization deactivation before/after the request barrier.                                                                                                                                                              |
| O           | Scanner pause allows authority revocation and final upload rejects; a parent-blocked attachment leaves its batch lock available to an independent NOWAIT probe. Existing concurrent upload/finalization and rollback tests remain. |
| P           | Repeatable-read snapshot before access-state revocation fails closed with 40001, including the actual requester-history service.                                                                                                   |
| Q           | Injected Activity failure rolls back request/revision/history; existing required disclosure/child/attachment audit failures remain covered.                                                                                        |
| R           | Three independently coordinated sessions: authenticated legacy assignment, aligned operation and queued authority writer complete without deadlock.                                                                                |

These tests establish the supported application lock protocol under the exercised orderings. They do not claim arbitrary SQL writers are deadlock-free. No 55P03 allowlist addition is needed: NOWAIT is used only by a disposable test probe; production preserves existing bounded statement timeout and sanitized 40001/40P01 handling.

## Safety and review

No live request, access, provisioning or fixture operation is part of this implementation. No live migration execution, push, deployment or cloud change is authorized. Tests use disposable schemas and synthetic data. All 39 migration files remain unchanged; no Migration 40 or schema change exists. Live migration/table counts and fingerprints were not re-read as part of this implementation, and no live database connection was used for validation.

The proposed [transaction-time authorization ADR](../architecture/decisions/ADR-024-transaction-time-request-authorization.md) is not Accepted. Implementation, validation and the 32-file allocation have been reviewed and approved for one local commit; ADR acceptance remains separate. F058.2 remains unstarted. Pre-staging review checkpoint: main at `7d0e294f5977749c5bbe1ce60d17aa9f6b5c4503`, origin/main unchanged, 0 ahead / 0 behind, 32 unstaged files, nothing staged. Temporary validation logs remain ignored under .local-uat.

## Pre-commit React failure investigation

The original full invocation remains **710 passed / 2 failed**. Both failures occur in `react/test/IssueCreation.test.jsx`: the External Redirect creation test (starting at line 132) exceeds the unchanged 5,000 ms deadline; the next Availability test (line 175) fails the Category helper's `findByRole("option", { name: "Roads" })` at line 70.

**Roads classification: C — timeout-triggered test isolation leakage within the same file.** The original failure DOM contains `value="fictional service."` in the Category combobox and “Searching…”. That text is the suffix of the preceding test's `user.type` handoff message, “Continue to the fictional service.” The following test has not requested any Category search typing.

The execution chain is:

1. The first test awaits typing into Handoff message. Its deadline expires while that keyboard sequence is unfinished.
2. Vitest rejects the timed test and signals its context; this test/user-event sequence does not consume that cancellation signal. The pending JavaScript operation continues. The shared setup calls React Testing Library `cleanup()`, which unmounts the old DOM but does not cancel the pending keyboard promise.
3. The next test renders a new Issue drawer and focuses Category. User-event resolves `document.activeElement` for each key, so the old sequence's remaining characters now enter this new combobox.
4. `IssueCreationPicker` restarts its existing 300 ms debounce on each search change. The option query expires while the input is still changing/searching. This is not a missing fixture value or a backend result.

**Timeout classification: D — execution-budget/resource-pressure sensitivity during unfinished UI typing.** The timeout is the preceding External Redirect test, not the Availability assertion. There is no real HTTP request: each `setup()` constructs a fresh `vi.fn(async ...)` client; creation-category lookup returns a fresh Roads result, and post immediately resolves. The component owns its lookup state with React hooks and aborts stale lookups; no shared query cache participates. Vitest's file isolation remains enabled, with real timers. Neither fake timers nor a module cache override was introduced. F058.1 backend tests/builds can add resource demand when run concurrently, but the mocked React path imports no changed server implementation and cannot consume its authorization/database state. A deliberate CPU-pressure reproduction makes this same five-second overrun and cross-test continuation occur on the synchronized parent as well as the current frontend.

The original run overlapped backend/static validation. It did not capture an OS CPU/scheduling profile, so the exact original competing process or per-keystroke delay cannot be retrospectively proved. The demonstrated claim is a pressure-sensitive wall-clock overrun while work is progressing, followed by proven async leakage—not a permanently unresolved data request or a deterministic F058.1 production defect.

Diagnostic evidence uses ignored files under `.local-uat/f058-react-diagnosis`. The parent frontend was exported with canonical Git content from `7d0e294f5977749c5bbe1ce60d17aa9f6b5c4503`; no checkout/history was modified. Frontend, assets, package manifests/lockfile and Vitest config have no changes against that parent. A temporary instrumented test copy logs typing still pending at the first test's teardown and remaining handoff keystrokes entering the next test's Category input. Bounded CPU work during those synthetic keystrokes reproduces **both failures** on parent and current code. This is an explicit diagnostic stress experiment, not an ordinary regression invocation. No sleep, timeout increase, production change or weakened assertion is involved.

Normal reproductions retain the existing timeout:

| Invocation                                                                                                   | Result                                                                             |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Current Issue Creation isolation 1                                                                           | 17 passed; 22.75 s total.                                                          |
| Current Issue Creation isolation 2                                                                           | 17 passed; 23.46 s total.                                                          |
| Current Issue Creation isolation 3                                                                           | 17 passed; 23.93 s total.                                                          |
| Canonical parent original Issue Creation file                                                                | 17 passed; 18.51 s total.                                                          |
| Six related files: Issue Creation, Configuration, Discovery, Handling, Admin Configuration, Configure Access | 98 passed; 53.28 s total.                                                          |
| Parent controlled CPU/continuation diagnostic                                                                | Two selected tests intentionally reproduced the two failures; 15 unselected tests. |
| Current controlled CPU/continuation diagnostic                                                               | Same two failures and cross-test keyboard trace; 15 unselected tests.              |

**Final serial full React: 52 files / 712 tests passed, zero failures, 217.84 s.** Command: `node node_modules/vitest/vitest.mjs run --maxWorkers=1 --config vitest.config.mjs`. Timeout remains the default five seconds; no other backend/build validation ran concurrently with this invocation. The original 710-pass / two-failure invocation is preserved separately in this report and its original log.

The total remains **1,675 distinct tests** (318 backend unit + 41 API E2E + 540 PostgreSQL + 64 shared + 712 React). Repeated, related-file and diagnostic cases do not inflate this count. Backend/security, TypeScript and build evidence from the accepted implementation remains applicable: this investigation made no production or permanent test changes. Documentation formatting, whitespace and all 249 relative links pass.

No corrective frontend code, test setup, timer threshold or assertion change was made. The only durable additions are this failure classification/evidence and the future planning note, within the already allocated documentation. The coherent 32-file boundary remains correct (15 production, 11 test, six documentation files). ADR-024 remains Proposed. At the failure-classification checkpoint, Git remained main at the synchronized parent with nothing staged or committed. The 39 migration files remain unchanged, with no Migration 40; no database connection/mutation, provisioning, deployment or cloud action was used during this investigation. Shared teardown/test interaction hardening would be separate frontend test-maintenance scope; a blanket timer/mock reset would not itself cancel the in-flight keyboard operation. F058.1 does not introduce this pre-existing failure path, and no unrelated frontend workaround is included.

### F058.2 planning deferral

The [roadmap](../ROADMAP.md) records evaluation of Requester Communication for eligible INTERNAL requests with an identified staff requester, preserving staff-only Internal Notes. The approved future note wording is “Internal notes are visible only to authorized staff. Avoid entering sensitive information.” Current wording is unchanged. Before F058.2 implementation, review PUBLIC-specific eligibility, identity, tracking, independent authorization, required audit and correspondence visibility/delivery (including attachments). F058.1 retains its existing PUBLIC-only communication policy and implements none of these future changes.

## Approved F058.1 commit scope

One coherent F058.1 backend/security commit is approved: `feat(requests): harden request authorization consistency`. All hunks in the following files belong to this slice; wrapper indentation is formatter output, not a policy rewrite. There are no frontend, permission-registry, API DTO, dependency, migration, provisioning or runtime configuration changes. The allocation was reviewed before staging; no F058.2 implementation is included.

| Files                                                                                                                                                           | Hunk purpose                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/service-request/request-authorization.ts` (new)                                                                                                     | Shared Organization/access-state barrier, trusted authority resolver, explicit parent locks and READ COMMITTED wrapper.         |
| `server/src/service-request/internal-request-mutations.service.ts`                                                                                              | Fresh lifecycle/routing authority and parent-first locking.                                                                     |
| `server/src/service-request/request-ownership.service.ts`                                                                                                       | Fresh assignment/watcher authority and parent serialization.                                                                    |
| `server/src/service-request/staff-actions.service.ts`                                                                                                           | Authenticated legacy assignment alignment and Organization-first development compatibility; workforce workflow still delegates. |
| `server/src/service-request/request-tracking.service.ts`, `server/src/service-request/request-tracking.repository.ts`                                           | Staff tracking freshness and credential-only resident parent-lock compatibility.                                                |
| `server/src/service-request/request-contact.service.ts`, `server/src/service-request/request-answer.service.ts`                                                 | Fresh independent disclosure authority and explicit shared parent lock before protected data/audit.                             |
| `server/src/service-request/requester-history.service.ts`                                                                                                       | Fresh authority and anchor parent lock while retaining repeatable-read history/audit.                                           |
| `server/src/service-request/request-note.service.ts`, `server/src/service-request/request-communication.service.ts`                                             | Fresh child permissions, parent locks and attachment preparation handoff.                                                       |
| `server/src/service-request/create-service-request.service.ts`                                                                                                  | External preparation, exact-input revalidation, staff creation authority and receipt preservation.                              |
| `server/src/attachments/attachment.service.ts`                                                                                                                  | Parent-before-batch order, byte preparation outside final locks, metadata revalidation and compensation.                        |
| `server/src/service-request/internal-request.repository.ts`                                                                                                     | Authorized read-only repeatable-read count/page snapshot.                                                                       |
| `server/src/service-request/staff-live-search.ts`                                                                                                               | Explicit C0/DEL/C1 rejection.                                                                                                   |
| `server/test/database/request-authorization-checks.ts` (new)                                                                                                    | Deterministic authority/concurrency/snapshot/rollback/scale evidence.                                                           |
| `server/test/database/request-audience.integration.test.ts`                                                                                                     | Integrate existing access-state migration in historical synthetic fixture and invoke F058 checks.                               |
| `server/test/database/attachment-checks.ts`                                                                                                                     | Revocation during byte preparation and explicit parent-before-batch proof.                                                      |
| `server/test/database/admin-issue-checks.ts`, `server/test/database/issue-handling.integration.test.ts`, `server/test/database/governed-availability-checks.ts` | Distinguish external preparation from locked final admission and supply current persisted authority.                            |
| `server/test/database/participation-checks.ts`, `server/test/database/trusted-requester-history-checks.ts`                                                      | Persisted synthetic mappings and memberships replace guard-only test authority.                                                 |
| `server/test/unit/attachment.service.test.ts`, `server/test/unit/request-contact.service.test.ts`                                                               | Update transaction/query doubles for explicit authority/parent locks without weakening disclosure assertions.                   |
| `server/test/unit/staff-live-search.test.ts`                                                                                                                    | Control-character and preserved search behavior.                                                                                |
| `docs/features/F058-1-request-authorization-consistency.md` (new)                                                                                               | Implementation, validation, limitations and this complete allocation.                                                           |
| `docs/architecture/decisions/ADR-024-transaction-time-request-authorization.md` (new)                                                                           | Proposed architecture decision; not Accepted.                                                                                   |
| `docs/architecture/decisions/README.md`                                                                                                                         | Draft ADR link.                                                                                                                 |
| `docs/ARCHITECTURE.md`, `docs/CITYVUE_CONTEXT.md`, `docs/ROADMAP.md`                                                                                            | Current local checkpoint only; historical entries retained.                                                                     |
