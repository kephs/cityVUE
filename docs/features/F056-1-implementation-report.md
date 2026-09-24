# F056.1 implementation report

## Checkpoint and outcome

Implemented on `main` from clean, synchronized F056 `36065c0693b4855fe3587576bf327aef31f7bbaf` (0 ahead / 0 behind the existing `origin/main` reference). Scope is Issue discovery and administration UX, with an authorized local commit only. No remote contact, push, deployment, migration, grant change, dynamic Issue intake or F057 work occurred.

The [feature specification](F056-1-issue-management-scalability-ux.md) records the endpoint contracts, complete parameter/default and sort/tie-breaker tables, interface behavior and threat model. Existing F056 list consumers retain their original bounded API response. New summary, Category, template-search and authoritative detail endpoints require the existing Admin read permission and trusted Organization context. Mutation authorization and contracts remain unchanged.

## Implementation and files

- Backend: new `server/src/admin/admin-issue-discovery.service.ts`; controller, module and Issue service add protected reads. Summary retrieval uses fixed count/count/page queries in a read-only repeatable-read transaction. A small fix in `requester-identity-policy.ts` disambiguates fallback subquery aliases exposed by synthetic Issues without explicit policy rows; it does not change intended policy semantics.
- React: new `issueDiscovery.js`, `IssueDiscoveryControls.jsx` and `IssueTemplatePicker.jsx`; `IssueConfiguration.jsx` integrates URL-backed server discovery, fresh detail, focused forms and query-preserving refresh. `AdminConfigurationPage.jsx` removes redundant introductory wording on Issues. Scoped `adminConfiguration.css` rules improve wrapping and density.
- Tests: new backend discovery unit/database checks and React discovery tests; existing Admin and Issue fixtures updated for the new reads while retaining mutation assertions. Database discovery checks run inside the existing disposable integration suite.
- Documentation: feature specification and this report, feature index, F056 cross-reference, architecture, context and roadmap. No dependency, lockfile, migration, deployment, identity configuration or unrelated application file changed.

## Discovery, presentation and template selection

Search is trimmed, bounded and case-insensitive over Issue/Category names only. SQL uses parameterized literal substring matching: percent, underscore, quotes and backslashes have no wildcard or executable meaning. Status, Category, requester policy and assignment filters combine with AND before the scoped count and page. Seven allowlisted sorts support both directions and end in stable Issue UUID. Sizes are exactly 25, 50, 100, 250 and 500; there is no unlimited All. Out-of-range pages normalize safely. Filter/sort/size changes reset page 1.

The heading and active/inactive counts establish context, with Add issue and Refresh beside them. Search leads the control surface; labeled filters, sort, direction and page size follow. Clear filters preserves sort/direction/size. A filtered count and page indicator precede compact rows, with pagination after them. Desktop uses a balanced four-column control grid, tablet two columns and mobile a single-column disclosure. Existing theme tokens, typography and status conventions remain authoritative. Search and result context stay visible without mounting hundreds of editors.

Each summary shows Issue name, Category, active/inactive text, requester policy, safe default-assignment label, display order and actions. Edit is primary; Change order and state changes are secondary. Descriptions are intentionally omitted from summaries to avoid large narrative payloads and improve scanning; they remain available in authoritative detail. Editable revisions, historical catalog versions, intake schema, requests, requester/Contact data, attachments and membership lists are also omitted. Full editable configuration is fetched only when an action needs it. A failed detail read cannot issue a mutation.

The Add-only template combobox searches independently of the current list filter/page. It debounces 300 ms, returns at most 25 eligible name/Category/stable-ID summaries, reports truncation, and supports loading, retry, no-results and selected-template states. Arrow keys and Enter select; Escape closes options; Tab follows normal focus order. Change template returns focus to search and preserves other drafts. Search results contain no full template configuration. Create resolves and revalidates the stable Issue ID inside the unchanged F056 transaction, copies approved fields and creates an inactive independent Issue. Selection/search creates neither inheritance nor configuration-change audit.

All nine discovery parameters are URL-backed: search, status, category, requesterPolicy, assignmentState, sort, direction, page and pageSize. Defaults are omitted; malformed values normalize; direct navigation, refresh and Back/Forward restore state. URL values never establish authorization. Abort plus ignore-stale guards protect search, filter, page and template responses even when a transport completes after cancellation. Tests make older search (`po` before `pothole`), filter, page 2 before page 3, and template results finish last; the newest result wins. Save refreshes the current query; an Issue outside its results has an explicit Review saved Issue action. Cancel restores focus without changing configuration.

## Automated validation

Commands below use the existing package scripts; the installed local Node executable was used to invoke their underlying binaries because Node was not on the shell PATH. TypeScript tests were compiled with `tsconfig.test.json` before Node test execution. Approved database configuration was loaded without printing values.

| Check                                                                                    | Result                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| Backend unit (`server:test`)                                                             | 252 passed, 0 failed/skipped                |
| API E2E (`server:test:e2e`)                                                              | 40 passed, 0 failed/skipped                 |
| PostgreSQL full suite (`server:test:db`)                                                 | 304 passed, 0 failed/skipped                |
| Final affected PostgreSQL integration rerun after read/write permission matrix additions | 258 passed, 0 failed/skipped                |
| Shared/root (`test`)                                                                     | 64 passed                                   |
| Final complete React (`test:react`)                                                      | 580 passed, 42 files                        |
| Backend TypeScript/typecheck, lint and production build                                  | PASS                                        |
| Backend format check; changed frontend/Markdown formatting                               | PASS                                        |
| Frontend production build                                                                | PASS; existing large-bundle warning remains |
| Changed Markdown links, whitespace and private-value review                              | PASS                                        |

There is no configured frontend lint script. An early 500-row React test exceeded the default five-second timeout during concurrent validation; its focused timeout is now 15 seconds, without weakening assertions. The final full React suite passed. F048 assignment, F049 requester policy, F050 trusted Requester, F051 participation/privacy, F052 authorization, F053 intake configuration, F054 branding/Admin shell and F055 Participation Setup regressions passed. F056 creation, inactive default, copy-on-create, immutable versions, stable identity, uniqueness, editing, policies, assignments, numeric order, activation/deactivation, four expected revisions, 409 conflicts, audit atomicity, concurrent deactivation and historical references remain covered. No destructive DELETE was introduced.

New authorization checks deny all discovery endpoints with no Admin read even when Issue write remains, and allow reads without Issue write while returning `canWrite: false`. Foreign Organization Category/detail/template data stays unavailable. DTO validation, injection strings, exact lean projections and template eligibility are tested.

## Disposable scale and query review

The database fixture adds 525 synthetic Issues in two synthetic Categories in the disposable test schema only. There are 531 scoped Issues including existing integration fixtures, and 532 across Organizations. Iterating the 525 matching synthetic Issues at size 25 gives 21 pages: first, middle and final pages each contain 25; the union has exactly 525 stable IDs, zero duplicates and zero missing IDs. All seven sorts in both directions produce complete, repeatable sequences. The combined filter returns 175. Every approved page size is bounded; size 500 returns 500, then 25 on page 2. Oversized page normalization and no-results behavior pass.

The following final `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` observations use the exact production SQL builders. Values are local execution milliseconds, not production benchmarks. Temporary plan output retained only sanitized node statistics and was removed before commit.

| Query             | Page execution | Filtered count execution |
| ----------------- | -------------: | -----------------------: |
| Default, size 25  |          1.757 |                    0.164 |
| Default, size 500 |          3.050 |                    0.610 |
| Name search       |          3.557 |                    0.542 |
| Category search   |          2.992 |                    0.510 |
| Combined filters  |          4.272 |                    0.649 |
| Assignment sort   |          3.728 |                    0.179 |

Template search executed in 0.712 ms, fetching 26 to return 25 plus `hasMore`. Planning times varied from 2.867–10.585 ms for pages, 0.246–0.597 ms for counts and 0.598 ms for templates.

Default Limit nodes estimated and returned 25/500 as appropriate. The Issue sequential scan estimated and visited 531 rows; current-version scan 536. These are scoped catalog scans, not per-Issue history downloads. Existing Organization/Category, policy, assignment, staff, role and team keys support joins. Counts omit assignment labels and the planner removes unused policy/version joins for base counts. An initial union-label approach showed repeated scans and was replaced with direct scoped joins; final unfiltered page plans have maximum loop count 1.

Combined filtering scanned 175 Issues versus 173 estimated, with indexed lookups up to 175 loops; its top Limit estimate underpredicted 25 actual rows as 1. Template joins use existing Category/Department/Division keys, the Issue Category index and version primary key, with up to 351 nested-loop iterations and a 2-row estimate versus 26 returned. These are joins within single SQL statements, not application N+1 calls. Estimate underprediction and substring scans should be revisited with real catalog distributions if needed. No speculative index or migration was justified by this fixture.

A separate temporary browser fixture mounted the real component with 525 in-memory summaries and a client with no API/database connection. Size 500 rendered 500 rows and zero edit forms; page 2 rendered 25 and Previous restored 500. Pagination focus returned to the refresh feedback. Long names wrapped at mobile width in both themes without horizontal scrolling. This is UI scale evidence, distinct from authenticated UAT. The fixture was removed; durable tests remain. Size 500 is a long scroll; default 25 remains appropriate. No synthetic scale Issues were inserted into or retained in `reqro_dev`.

## Authenticated UAT, accessibility and privacy

The user signed in through the existing personal Entra session. No new grant or token copying was used. Live checks used GETs, searches, filters and drafts/Cancel only. Search trimming/case, zero matches, Category/policy/assignment combinations, sorting and size selection, native Back/Forward/refresh, clear filters, fresh Edit/Change order, long draft names, template search outside the list filter, keyboard selection/Change, nonexistent template results and deactivation-dialog Cancel/Escape were exercised. Automated tests cover failures, rapid response races and all ordering/page-size permutations; no live fault or mutation was injected into development data.

Actual viewport measurements and screenshot review covered 1440, 1280, 1024, 768 and 390 px in light/dark themes across the list, long drafts, numeric editor, template flow and dialog. Controls and metadata wrapped; the mobile filter disclosure kept search/results reachable. Measured content widths equaled scroll widths (for example 1440/1440, 1280/1280 and mobile 375/375; scrollbar widths account for smaller content widths). Tablet long drafts measured 753/753 and 1009/1009. The real 500-row fixture also measured 375/375 in both themes. There was no horizontal overflow in observed states.

Labels, semantic headings, focus visibility, dialog initial Cancel focus and Escape/focus restoration, combobox keyboard behavior, loading feedback, error/retry and no-results states were reviewed through browser UAT and component tests. Not every artificial loading/failure state was injected at every live viewport; those branches are automated coverage. This is an accessibility-oriented development review, not WCAG certification. The compact summaries, clear primary action and grouped controls improve scanability and balance for a commercial client-neutral administration surface without changing the authorization model.

**Live API logging privacy: PASS**, explicitly confirmed by the user after searches, filters, detail and template reads. The check excluded raw search/full query strings, returned Issue arrays, full descriptions/template configuration, requester/Contact data, provider subjects, bearer tokens, assignment membership, tracking credentials/digests and private attachment paths. No raw logs are included here. Ordinary discovery, refresh, template search and selection introduce no configuration-change audit. Existing protected analytics reads are a separate feature; analytics pages were closed for this task and their audit baseline stayed unchanged.

## Development integrity

A read-only repeatable-read comparison of all 52 public tables reported `unchanged: true`, with no changed tables, after live UAT. The helper compared row counts and hashes without outputting row contents; credential/token/secret/password/digest columns were excluded from reading/hashing. No Requester Tracking operation was performed. The helper and baseline were removed physically before commit.

| Accepted state                              | Final state                                                                                                                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migrations                                  | 33 applied; 33 migration files, 0 pending; no schema/index change                                                                                                                                              |
| Issues                                      | 7 total, 7 active, 0 inactive                                                                                                                                                                                  |
| Fictional Sidewalk Marker                   | Active, order 3; core revision 7, action revision 1, catalog version 2; identified-required policy revision 3; no default assignment, revision 2                                                               |
| Other Issue identities/revisions/versions   | All unchanged; other core revisions 1, order 0, catalog version 1; Damaged Street Sign action revision 3/default revision 1/policy revision 1; other action revisions 1/default revisions 0/policy revisions 1 |
| Policy/default assignment rows and audits   | 7 policy rows, 2 assignment rows; policy audits 3, default-assignment audits 3; unchanged                                                                                                                      |
| F056 configuration audits                   | 7, unchanged                                                                                                                                                                                                   |
| Service Requests / current catalog versions | 13 requests / 8 version rows, unchanged; `SR-202609-000013` and historical references preserved                                                                                                                |
| Collection                                  | Enabled, revision 3; F053 audits 2                                                                                                                                                                             |
| Participation Areas                         | 5 total, 5 active, 0 inactive; F055 audits 9                                                                                                                                                                   |
| West Demo District                          | Active, revision 8, order 3                                                                                                                                                                                    |
| Fictional North-East Area                   | Active, revision 1, order 4; intentional user-created development data between earlier checkpoints, preserved with its audit                                                                                   |
| Privacy / analytics audits                  | Threshold 5; analytics-read audits 53, unchanged from reconciled F056 baseline                                                                                                                                 |
| Existing grants                             | Admin read, intake write, Participation Area write, Issue write and analytics read each remain in the existing deliberate set; no changes                                                                      |
| Branding                                    | `REQRO_DEFAULT`, revision 3                                                                                                                                                                                    |
| Tracking baseline                           | 6 records: 1 active, 5 revoked; no operation or credential inspection                                                                                                                                          |

All other captured tables, including Activity, answers, attachments, Questions/options and provisioning records, remained unchanged. No application-data reconciliation mutation occurred.

## Limits, cleanup and stop point

Substring search may scan a scoped catalog; offset pages can change when other administrators edit between requests. Neither production load capacity nor a frozen multi-request catalog snapshot is claimed. Categories remain a scoped choice list. The compatibility Admin snapshot remains bounded. Existing large frontend bundles still produce Vite's warning; bundle redesign was outside scope.

Temporary browser scale entry points, integrity helper/baseline, local test/plan logs and captures were physically removed before commit. No new setup or manual configuration is required. No follow-up questions, question types, form schema/conditions, external redirects/URL/handling mode, workflow/SLA, destructive deletion, permission expansion or future Issue Intake & Redirect feature was implemented.

Final delivery is the local commit `feat(admin): scale issue management experience`; its full hash and clean Git state are reported with delivery. The next step is review. Push, deployment, dynamic intake and F057 remain separately unauthorized.

## Final security and integrity answers

The following answers address the supplied §300 gate. Evidence and limitations are recorded above and in the feature threat model.

1. Does Issue Live Search remain Organization-scoped?
   YES.

2. Can Organization A search Organization B Issues?
   NO.

3. Do filters broaden authorization?
   NO.

4. Does pagination broaden authorization?
   NO.

5. Does sorting broaden authorization?
   NO.

6. Is search parameterized/safely constructed?
   YES.

7. Are sort fields allowlisted?
   YES.

8. Is sort direction allowlisted?
   YES.

9. Is page number validated?
   YES.

10. Is page size validated?
    YES.

11. Is 500 the maximum approved page size?
    YES.

12. Is an unlimited All option implemented?
    NO.

13. Does list retrieval load full Issue configuration for every row?
    NO.

14. Does list retrieval load historical catalog versions for every row?
    NO.

15. Does list retrieval load Service Requests?
    NO.

16. Does list retrieval load requester data?
    NO.

17. Does list retrieval load Contact?
    NO.

18. Does list retrieval enumerate assignment membership?
    NO.

19. Is paginated ordering deterministic?
    YES.

20. Can records duplicate/disappear across stable pages because of missing
    tie-breaker?
    NO.

21. Do search/filter/sort changes reset page safely?
    YES.

22. Does page-size change reset page safely?
    YES.

23. Can unsupported page size request an unbounded result?
    NO.

24. Can stale search response overwrite newer results?
    NO.

25. Can stale filter response overwrite newer results?
    NO.

26. Can stale pagination response overwrite newer page?
    NO.

27. Can stale template-search response overwrite newer results?
    NO.

28. Is template search Organization-scoped?
    YES.

29. Does template search require Admin read authorization?
    YES.

30. Does template search return full template configuration?
    NO.

31. Does template selection use stable Issue identity?
    YES.

32. Does backend revalidate template eligibility at Create?
    YES.

33. Does template selection create an audit?
    NO.

34. Does template search create a configuration-change audit?
    NO.

35. Does template selection create ongoing inheritance?
    NO.

36. Does F056 Issue creation remain Inactive by default?
    YES.

37. Does F056 copy-on-create behavior remain unchanged?
    YES.

38. Does F056 Issue editing remain unchanged?
    YES.

39. Does F056 requester-policy behavior remain unchanged?
    YES.

40. Does F056 default-assignment behavior remain unchanged?
    YES.

41. Does F056 expected-revision/409 behavior remain unchanged?
    YES.

42. Does F056 immutable catalog-version behavior remain unchanged?
    YES.

43. Does F056 concurrent-deactivation protection remain unchanged?
    YES.

44. Is destructive Issue deletion introduced?
    NO.

45. Are follow-up questions introduced?
    NO.

46. Is dynamic form schema introduced?
    NO.

47. Is external redirect handling introduced?
    NO.

48. Is workflow/SLA behavior introduced?
    NO.

49. Are existing Admin permissions changed?
    NO.

50. Is a new F056.1 permission introduced?
    NO.

51. Are existing grants changed?
    NO.

52. Is Service Participation changed?
    NO.

53. Are Participation Areas changed?
    NO.

54. Is privacy threshold changed?
    NO.

55. Is branding changed?
    NO.

56. Is Requester Tracking operated?
    NO.

57. Are synthetic 250+ scale-test Issues retained in reqro_dev?
    NO.

58. Are raw search strings excluded from normal logs according to final logging
    policy?
    YES.

59. Are returned Issue arrays excluded from normal logs?
    YES.

60. Are full template configurations excluded from normal logs?
    YES.

61. Are temporary UAT/log artifacts removed?
    YES.

62. Is deployment performed?
    NO.

63. Are production/client/cloud resources changed?
    NO.
