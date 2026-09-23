# F047 — Implementation and validation record

Status: implemented and locally validated. Automated checks, authenticated UI UAT, data integrity and live logging privacy passed. No push or deployment authorized.

All gates passed for the authorized local commit of 20 files on `main`, with message `feat(requests): add staff live search`. The final commit hash and post-commit Git status are reported in the delivery message rather than embedded in the commit itself.

## Starting checkpoint

Verified clean `main`, HEAD `f54f1e612117e4213825a3d8499c8632b76df31f`, 0 ahead / 0 behind the local `origin/main` reference. No remote fetch was needed. `reqro_dev`: 23 applied migrations, zero pending; 8 requests; 3 attachments; tracking 1 active / 5 revoked.

Read-only baseline fingerprints were recorded outside the repository for requests, locations, Contact, assignments, watchers, operational Activity, Notes, Communications, attachment metadata, role grants, staff role assignments and reference sequence. All twelve final fingerprints match. Tracking aggregate counts remain 1 active / 5 revoked. No credential or digest was retrieved. Ordinary detail-navigation UAT rendered the existing management summary; no tracking-management dialog or requester tracking link was opened, and no tracking lifecycle action occurred.

## Implementation

The [feature contract](F047-service-request-live-search.md) specifies the three searchable fields, independent authorization, literal normalization, 300 ms debounce, bounds, URL privacy, all filter/sort/page interactions, empty/error/loading states and performance limitations.

Changes are limited to a reusable backend search helper, unified staff query DTO/repository, React list/repository/styles, focused tests and feature/governance documentation. No schema, migration, permission, authentication, attachment-storage or tracking implementation change. No new dependency. Existing exact-reference filtering remains available and ANDs with `q`.

## Automated evidence

| Check                           | Current result                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| React full suite                | 33 files / 487 tests passed                                                                                             |
| Focused live-search React tests | 10 passed, including stale filter/sort/page cases                                                                       |
| Backend e2e                     | 40 passed, zero skips                                                                                                   |
| Backend unit                    | 230 passed, zero skips                                                                                                  |
| PostgreSQL full suite           | 193 passed, zero skips; latest additional Activity/log/audit assertions reran the 148-check audience suite successfully |
| Backend typecheck/build         | Passed                                                                                                                  |
| Frontend production build       | Passed; existing >500 kB chunk advisory and plugin timing advisory retained                                             |
| Backend lint/format             | Passed; zero lint errors/warnings                                                                                       |
| Shared tests                    | 64 passed, zero skips                                                                                                   |
| Frontend lint                   | No frontend lint script exists; no command invented                                                                     |
| Diff/link/secret review         | Passed: no whitespace errors, broken local documentation links or secret-pattern findings                               |

An early test launch inherited the development Entra/attachment environment. That caused configuration and later Notes/Communications failures unrelated to F047. The corrected test launcher inherits only `TEST_DATABASE_URL` from the ignored local environment, preserving the tests' own isolated configuration. The corrected audience suite passed 148 checks before additional assertions. Test fixture mistakes and a nested test scheduling mistake were corrected; final runs must pass before completion.

A focused UI test found stale typed text after browser Back; clearing the local draft when URL state changes corrected it and the test now passes.

Security coverage includes independently authorized PUBLIC/INTERNAL/all callers, other Organization callers, no-read/contact-only/update-only callers, views, assignment states, Department/Division/status, exact Reference AND composition, all sort directions, five-row pagination/counts, revoked read permission, malformed and overlong queries, hostile SQL text, literal wildcards, Unicode and displayed-location fallback. Dedicated Notes, Communications and attachment tests assert their unique protected markers do not match, even for an authorized domain reader. The existing synthetic Activity narrative also yields zero matches. Structural SQL tests verify exactly three approved operands and parameterization, including exclusion of tracking without reading credential data.

## Performance evidence

Read-only plans on the unchanged eight-request development dataset:

| Synthetic/search case                | Count execution | List execution |
| ------------------------------------ | --------------- | -------------- |
| Existing fictional Request Reference | 0.446 ms        | 0.486 ms       |
| Issue fragment                       | 0.208 ms        | 0.837 ms       |
| No-match marker                      | 0.167 ms        | 0.393 ms       |

Sequential request scans occur. Existing unique location, Organization/catalog, effective scope and ownership indexes appear in the plans. No index/migration is added. Count and rows remain separate SQL statements using the same predicate; no application N+1 is added. Debounce reduces calls, page bounds reduce transfer, neither removes full predicate/count work. Large-volume and concurrent-write limitations are documented in the specification; production load testing remains outstanding.

## Authenticated UAT

The user confirmed the developer-launched API and completed normal personal Entra sign-in. The agent then performed read-only browser UAT through the normal UI. No auth bypass, grant change or token handling. The signing-key lesson is documented in the feature specification.

| Live check       | Observed result                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline         | 6 authorized rows from 8 stored requests                                                                                                                                     |
| Reference        | `SR-202609-000008` returns its one authorized request                                                                                                                        |
| Issue            | `street sign` returns 5; edge whitespace is trimmed                                                                                                                          |
| Service Location | An existing displayed street-name fragment returns its one request                                                                                                           |
| Audience         | Issue term + PUBLIC = 4; + INTERNAL = 1                                                                                                                                      |
| Work view        | Same Issue term: My Requests = 0, My Team = 1, Watching = 2, All = 5                                                                                                         |
| Unassigned       | Issue term + Unassigned = 2; adding Open and Public Works retains those 2                                                                                                    |
| Sort             | Issue/Reference and Created ascending/descending reverse the two expected references without changing total                                                                  |
| Rapid typing     | Several changing terms settle on the final Reference and one correct result                                                                                                  |
| Clear            | Immediate clear preserves applied Unassigned/Open/Department filters; count expands to 3; keyboard focus returns to search                                                   |
| Reset            | Clears search and controls, restores 6 authorized rows and Created descending                                                                                                |
| Refresh          | Preserves search, filters and sorted two-row results                                                                                                                         |
| Minimum/empty    | One character shows guidance and hides stale rows; synthetic no-match phrase shows zero and a distinct empty state                                                           |
| Keyboard         | Search input → Tab reaches Clear; Enter in search preserves query; Enter on Clear works and returns focus                                                                    |
| Navigation       | Same tab opens the filtered request; Back to requests and browser Back restore query and one-row result                                                                      |
| Responsive       | Visual inspection passed at 1440/1280/1024/768/390 in light and dark; search field/Clear remain visible and page has no horizontal overflow; 390 uses existing request cards |
| Live logging     | User confirmed the synthetic marker was **absent** from the developer API terminal logs                                                                                      |

No live multi-page dataset exists: the principal has only six visible requests. Paging/count completeness and page-relative row numbering are covered by disposable database and React fixtures. My Requests has no matching live fixture; its empty state was verified, with positive ownership coverage in automated fixtures. This validation is not a WCAG certification; no screen-reader product was exercised. Semantic label/help, status live region, error alert, keyboard focus/order and non-color textual meanings were checked. Existing compact-width navigation/table wrapping was observed; F047 introduces no horizontal overflow or new row layout.

## Search contract and fields

| Property               | Final behavior                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Query parameter        | Optional `q` on existing staff-list GET                                                                                            |
| Minimum / maximum      | Empty or 2–160 UTF-16 units; raw bound checked before trim                                                                         |
| Debounce               | 300 ms typing; settled filter/sort/page actions apply immediately                                                                  |
| Case / partial         | Case-insensitive PostgreSQL substring                                                                                              |
| Multiword / whitespace | One literal phrase; preserve repeated internal spaces; trim edges                                                                  |
| Wildcards / SQL        | `%`, `_`, backslash escaped literally; patterns bound, never concatenated into SQL                                                 |
| Page reset             | Search/filter changes and Clear reset page 1                                                                                       |
| Clear                  | Search only; preserves applied controls and focuses input                                                                          |
| Reset                  | All list state to existing defaults                                                                                                |
| URL                    | `q` retained for reload/detail/back; browser history may contain operational location terms; no application search-history storage |

| Field                                                          | Searchable? | Semantics / exclusion evidence                                                        |
| -------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| Human Reference                                                | Yes         | Literal substring; exact Reference filter separately ANDed                            |
| Versioned Issue name                                           | Yes         | Literal substring, no rank/suggestions                                                |
| Displayed Service Location                                     | Yes         | Same normalized/fallback value as display; hidden alternative does not match          |
| Request UUID                                                   | No          | Existing authorized UUID term yields zero                                             |
| Contact                                                        | No          | Unique synthetic name/email terms yield zero                                          |
| Internal Notes                                                 | No          | Unique existing note marker yields zero even with read permission                     |
| Communications                                                 | No          | Unique existing correspondence marker yields zero even with read permission           |
| Activity                                                       | No          | Unique persisted workflow narrative yields zero                                       |
| Attachment filename                                            | No          | Unique attachment filename yields zero even with domain read permission               |
| Attachment content/metadata                                    | No          | Absent from predicate; no storage/content retrieval for matching                      |
| Tracking                                                       | No          | No tracking table, credential or digest in predicate; active credential not inspected |
| Description, assignment/watch identities, audit/Entra metadata | No          | Not among the three SQL operands                                                      |

## Authorization, counts and composition evidence

**Search is a filter over the already-authorized request set. A search match never grants request access. F047 searches operational request metadata only.**

The repository constructs the Organization/active Organization/effective scope/audience-authorized relation, adds the parenthesized three-field predicate plus operational view and structured filters with AND, then counts or orders/pages it. Physical PostgreSQL execution order is planner-owned. Count and rows reuse `filtered`; inaccessible matches never contribute to totals, pages or rendering. Cross-Organization/audience test results equal a test-oracle subset of each caller's separately authorized baseline. Ownership and watching remain narrowing predicates; neither substitutes for an audience read permission.

| Composition     | Tested example/evidence                                                                  |
| --------------- | ---------------------------------------------------------------------------------------- |
| Audience        | Live 5 → PUBLIC 4 / INTERNAL 1; automated independent read-key matrix and denied callers |
| Request view    | Live All/My Requests/My Team/Watching 5/0/1/2; automated relationship-scoped baselines   |
| Exact Reference | Matching Reference + matching `q` gives 1; same Reference + missing `q` gives 0          |
| Status          | Live Open composition; automated Open subset                                             |
| Department      | Live Public Works composition; automated explicit Department subset                      |
| Division        | Automated explicit Division query matches only the baseline's authorized matching rows   |
| Assignment      | Live Unassigned positive 2; automated assigned/unassigned and current/removed ownership  |
| Sort            | All five fixed sorts, both directions, equal globally sorted matching baseline           |
| Pagination      | Five-row pages concatenate to the complete sorted match set; totals and has-next agree   |

## Response ordering, logging and accessibility

Typing updates local input immediately and starts a cancellable timer. URL state captures settled search and all list controls. The full serialized state keys each response; cleanup aborts old requests and callbacks reject aborted work. Pending or invalid text suppresses old rows/counts. Tests cover out-of-order search completion, clear/reset during a request, late failed responses after filter/sort changes and a late page after a new search. Older responses cannot replace current results. Filter options remain available while requests load.

Captured real test-API structured logs omit the synthetic query marker on success, validation failure and denied access. Audit row counts do not change for those searches. Existing safe exception/log sanitation remains unchanged. The user separately confirmed the live developer-terminal marker was absent. Search history/analytics are not persisted by the application; URL/browser history is the documented exception inherent in existing navigation state.

Visible label **Search requests**, described help, explicit **Clear search**, status/live count, zero-result text, separate `role=alert` failures and text-labeled controls preserve accessible meaning without reliance on color. Search is outside the filter form, so Enter cannot unexpectedly apply its draft fields. Reading order remains search → filters → list controls → count → results → paging.

## Data integrity and scope

| Domain                                | Final verification                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Migrations                            | 23 applied / 0 pending / no new migration                                                                               |
| Requests / references / parent fields | All 8 request-row fingerprints and reference sequence unchanged, including status, revision, updatedAt and descriptions |
| Service Location                      | All 8 unchanged                                                                                                         |
| Contact                               | All 6 unchanged                                                                                                         |
| Assignment / Watchers                 | All 14 assignment records / 3 watcher records unchanged                                                                 |
| Operational Activity                  | All 59 unchanged                                                                                                        |
| Notes / Communications                | All 3 Notes / 4 Communications unchanged                                                                                |
| Attachments                           | All 3 metadata records unchanged; no upload, preview, download, deletion or filesystem content access                   |
| Tracking                              | 1 active / 5 revoked; no issue/rotate/revoke/link use or credential/digest retrieval                                    |
| Grants                                | 34 role-permission records / 4 staff-role assignments unchanged                                                         |

No intentional runtime-data mutations. Test data changes occurred only in disposable `reqro_test` schemas. One interrupted test schema was identified and removed from that database; completed suites clean up their own schemas. The `tsx` migration-status command encountered the restricted runtime's `uv_os_get_passwd` error; a read-only comparison of the migration table with the 23 repository migration files independently confirmed zero pending/unexpected entries.

No separate ADR is needed: the query extends ADR-006's existing authorized list relation, with feature-specific decisions recorded here and in Architecture. Deferred work includes contact/collaboration/attachment/Activity/UUID/identity-history search, OCR, fuzzy matching, ranking, autocomplete, recent/saved searches, analytics, full-text/trigram/external engines, cross-Organization search and exports. Consider indexing only after representative workload measurements miss an agreed latency/throughput target; no production threshold is invented here. Preserve Issue-Based Default Assignment and all other accepted future roadmap requirements.

## Completion boundary

Changed files (20 total):

| Area                           | Files                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend implementation         | `server/src/service-request/staff-live-search.ts` (new), `staff-request.controller.ts`, `internal-request.repository.ts`                                            |
| Frontend implementation        | `react/src/staff/requests/InternalRequestWorkspace.jsx`, `requestRepository.js`, `staffRequests.css`                                                                |
| Unit/UI/repository tests       | `server/test/unit/staff-live-search.test.ts` (new), `react/test/StaffLiveSearch.test.jsx` (new), `react/test/StaffRequestRepository.test.js`                        |
| Database regression assertions | `server/test/database/staff-workspace-checks.ts`, `request-note-checks.ts`, `request-communication-checks.ts`, `attachment-checks.ts`                               |
| New feature records            | This report and `docs/features/F047-service-request-live-search.md`                                                                                                 |
| Existing documentation         | `docs/ARCHITECTURE.md`, `docs/CITYVUE_CONTEXT.md`, `docs/ROADMAP.md`, `docs/features/README.md`, `docs/features/F043-service-request-workspace-ux-consolidation.md` |

Precommit security answers: unauthorized results/counts, cross-Organization matching, assignment-as-authority, watcher audience bypass, protected Contact/Notes/Communications/attachment/Activity/tracking/UUID matching, app-managed search history, analytics and stale-result overwrite are all **No**. Parameterized queries, literal SQL wildcard handling, server length bounds, search before pagination, unchanged attachment storage/tracking and unchanged cloud/client resources are all **Yes**. Automated success/error/denial logs exclude raw search text; the user independently confirmed the marker was absent from the live developer API logs. URL/browser history retains search state as explicitly permitted; this is not app-managed recent-search history.

No production or external client resources were used. Normal personally controlled Entra sign-in supplies workforce identity only. No migration/apply/rollback step, permission provisioning, new configuration variable, dependency install, cloud resource, deployment, push, merge or F048 work is part of F047. Production-scale load, assistive-technology certification and deferred search domains remain limitations, not implicit completion claims.

Temporary F047 test logs, baseline fingerprints and query-plan/review scripts were removed after their safe results were recorded here. No screenshots or local environment files are staged. The interrupted disposable test schema was also removed; development data and attachment storage remain intact.

Required validation, authenticated UAT, live logging and integrity gates passed. Deliver the local commit only; do not push, deploy or start F048. Recommended next step: user review of the local commit. F048 remains unassigned. Deferred roadmap items retain their existing scope.
