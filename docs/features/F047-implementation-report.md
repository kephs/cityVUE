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

Visible label **Search requests**, described help, explicit **Clear search**, status/live count, zero-result text, separate `role=alert` failures and text-labeled controls preserve accessible meaning without reliance on color. Search is outside the filter form, so Enter cannot unexpectedly apply its draft fields. After the final control-row follow-up, reading order is filters → consolidated Search / Clear / Sort / Direction / Refresh → count → results → paging.

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

## F047 placement polish follow-up

Starting checkpoint: clean `main` at `7142d2c7928122e9cf8f7e2dcfb0c3d135961f5a`, 1 ahead / 0 behind local `origin/main`. This separate presentation-only follow-up moves the unchanged search JSX block in the actual DOM, with no CSS ordering or absolute positioning. The accepted F047 commit is not amended.

Final desktop hierarchy: structured filter card → Requests heading with Sort by / Direction / Refresh → full-width Live Search and adjacent Clear → associated help → settled count/page → results. At 390px the existing toolbar wraps, search fills its own row, Clear wraps beneath the input, then help/count/request cards follow. No styling/color or search-handler changes were needed.

Validation:

- Affected React tests: 153 passed across `StaffLiveSearch`, `StaffRequestWorkspace` and `StaffRequestRepository`; the new test checks DOM hierarchy, preserved controls/help, responsive class structure and default keyboard order.
- Authenticated browser UAT: normal list, active Issue search, search plus Unassigned, Clear and empty results at each of 1440/1280/1024/768/390 in light and dark (50 combinations). Counts were respectively 6/5/2/3/0; no horizontal overflow. Screenshots confirmed useful search width and mobile wrapping. No new UAT records or request mutations.
- Real keyboard sequence: Reset → Sort by → Direction → Refresh → Search requests → Clear search. Enter on Clear restores input focus. Labels, help association, settled status announcement, error/empty distinction and sortable-header semantics are preserved. Not a WCAG certification.
- Frontend production build passed; the existing >500 kB chunk warning remains. Formatting, whitespace, documentation links and private-value checks passed. Backend/database/security suites were not rerun for a JSX-only move.

Files changed: `react/src/staff/requests/InternalRequestWorkspace.jsx`, `react/test/StaffLiveSearch.test.jsx`, this report and `F047-service-request-live-search.md`. No backend/API/search-semantic changes: Reference/Issue/Service Location matching, exclusions, debounce, authorization, Organization/count privacy, parameterization, wildcard escaping, filtering/sorting/pagination, cancellation and logging remain unchanged. No database, migration, grant or Requester Tracking changes or actions.

Separate local commit: `fix(ui): align live search with request results`; final hash and clean-tree/ahead status are reported in the delivery message. No push/deployment; F048 not started. Stop for review.

## Final F047 control-row polish

Starting checkpoint: clean main at 22ef9c9856285d9e7017ad5f08d1074c2164e981, 2 ahead / 0 behind local origin/main. This final presentation-only follow-up supersedes the preceding placement arrangement without amending either accepted commit.

The page-level Service Requests heading and structured filters remain. One labeled result-control group now contains Search, inline X Clear, Sort by, Direction and Refresh in actual DOM/tab order. Existing surface-subtle, border, radius, spacing, text and focus-ring tokens provide a differentiated surface in light and dark themes. No CSS order changes. Search is outside the filter form and receives the flexible width; Sort and Direction occupy compact 10rem columns on desktop, with content-sized Refresh. Labels align above the fields; help remains directly below Search only. The settled count/page sits immediately outside and below the surface, followed by results and pagination. The separate visible Requests heading is removed, retaining its screen-reader heading and existing pagination focus target.

Clear retains the existing handler and disabled-empty behavior. Its decorative X has accessible name Clear search, a 44px-wide target (46px measured height), reserved input padding and a theme-aware focus ring. The browser-native duplicate cancel glyph is suppressed. No dependency or optional search icon was added.

| Viewport | Light and dark UAT result                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| 1440     | One aligned main control row; Search approximately 854px versus 170px selectors.                                  |
| 1280     | One aligned main control row; Search approximately 698px versus 170px selectors.                                  |
| 1024     | Search approximately 939px across first row; Sort / Direction / Refresh wrap together below.                      |
| 768      | Search approximately 687px across first row; remaining controls share second row.                                 |
| 390      | Search approximately 325px; help, Sort, Direction and full-width Refresh stack cleanly. Clear remains 44 by 46px. |

All ten viewport/theme combinations were checked in the authenticated developer-API workspace using existing requests. Screenshots and DOM measurements confirmed one control surface, help placement, summary placement, useful widths, no horizontal overflow and no control clipping. Light/dark surfaces, borders, labels, input, Clear, help, selectors and Refresh remained distinguishable. The truthful long placeholder naturally exceeds the phone input's visible capacity; the full accessible label and helper remain available.

Actual keyboard order is Search → Clear → Sort → Direction → Refresh, including Reset → Search at the filter boundary. Light and dark focus outlines were checked; Enter on Clear returns focus to Search. Empty Clear is disabled. Settled status announcements, empty-result wording, error distinction and sort-header semantics remain covered by the existing tests. This is accessibility-oriented validation, not assistive-technology/WCAG certification.

Live read-only behavior checks returned 6 default requests, 5 matching street sign, 2 with Unassigned combined, 3 after clearing while retaining Unassigned, and 0 for a fictional no-match query. Separately, settled Issue/ascending sorting survived Refresh and Clear; Refresh retained the active search. Reset restored defaults. No records were created or modified; no tracking credential or protected tracking state was inspected.

Validation:

- Affected React suites: 153 tests passed across StaffLiveSearch, StaffRequestWorkspace and StaffRequestRepository. Layout assertions now cover the single surface, filter/control/summary/result hierarchy, labels/placeholder/help, responsive class structure, unique controls and actual keyboard order. Existing behavioral tests were retained.
- Frontend production build passed. The pre-existing greater-than-500-kB chunk warning remains.
- Formatting, git whitespace checks, local Markdown link targets and changed-file private-value scans passed.
- Backend/PostgreSQL suites were not rerun: changes are limited to list JSX presentation, scoped styles, two React tests and the two F047 documents.

Files changed: react/src/staff/requests/InternalRequestWorkspace.jsx; react/src/staff/requests/staffRequests.css; react/test/StaffLiveSearch.test.jsx; react/test/StaffRequestWorkspace.test.jsx; docs/features/F047-service-request-live-search.md; this report.

No backend/API/query/search-semantic, authentication, authorization, Organization isolation, count/privacy, normalization, debounce, parameterization, wildcard, filter/sort/page, cancellation or logging changes. No database, migration, grant, permission or configuration changes. Requester Tracking was untouched; the previously approved 1 active / 5 revoked baseline was not re-inspected. No new manual setup is required.

Separate local commit: fix(ui): consolidate live search and list controls. The delivery message records the final hash and verified repository state. No push or deployment; F048 not started. Stop for user review of this local commit.
