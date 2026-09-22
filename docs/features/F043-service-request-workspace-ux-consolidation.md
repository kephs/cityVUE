# F043 — Service Request Workspace UX Consolidation

Implemented from accepted F042 commit `8018acf8f2caf9699faa682241a026f09b101e90` on `main`, initially clean and synchronized with the cached `origin/main`. Implementation, automated validation and authenticated UAT are complete. The local commit stops for review; this record does not authorize a push or deployment.

## Approved scope

Reduce the always-visible detail controls while preserving the Issue-first F038 hierarchy and all F037–F042 domain contracts. Request Management presents compact assignment, watcher and contact summaries with separate dialogs. Collaboration presents independently authorized Internal Notes and Requester Communication tabs. Recent Activity requests five events; full authorized, paginated history opens separately.

PRESENTATION DOES NOT GRANT AUTHORIZATION.

COLLABORATION IS A SHARED UI CONTAINER, NOT A SHARED SECURITY DOMAIN.

REQUESTER CONTACT REMAINS A SEPARATELY PROTECTED RESOURCE.

## Implementation decisions

- Reuse the existing repositories, capability projections, ownership pickers, protected streams and Activity presentation. Add no endpoint, permission, dependency or database migration.
- Use a shared native dialog with F038 tokens, named headings, Escape/Close, browser modal focus containment and focus restoration. Avoid sticky columns and nested page scrolling.
- Default to Internal Notes. Fetch a stream only after its first selection; retain visited streams and separate drafts in component memory on tab switches. Omit Requester Communication for INTERNAL requests. Navigation, session loss and authoritative access denial clear protected state.
- Fetch Contact only on explicit View, clear and abort on close, and perform a new protected fetch/audit on reopening. Summary text does not infer contact presence.
- Load assignment targets only when selection opens; load watcher relationships in the Watchers dialog and watcher targets only when adding. Secondary failures remain local while parent authorization failures still clear the page.
- Retain the mounted request during successful operational refresh so unrelated collaboration drafts and pages survive. Existing revision conflict handling requires deliberate review, never automatic replay.
- Keep tab/modal selection out of URLs and browser history. Do not persist drafts or protected content in browser storage.

## Validation and data preservation gates

The protocol suites, focused React coverage, final private-value checks and authenticated UAT pass as recorded below. The only persistent UAT operational change was the user-confirmed assignment described in the live record.

The initial read-only personal development snapshot confirms 21 applied migrations, zero pending and two immutable F042 communications. Preserve existing F041 Notes, both approved fictional F042 messages, request references/state, requester contact, assignment/watchers, operational Activity and all 20 development permissions. Contact-view security audits may be created by authorized read-only UAT. Do not submit drafts during F043 UAT.

No push, deployment, remote/client change or F044 work is authorized. Commit only after the feature's complete validation and UAT gates pass.

## Information architecture and component boundaries

The Issue icon/name, meaningful service location, status, audience and secondary reference remain visible in the information card. Metadata and Description follow. Desktop uses a 1.65:1 main/supporting grid: information opposite Actions/Request Management, Collaboration opposite recent Activity, and Issue Details beneath Collaboration. At widths below 1200px the DOM order stacks information, Actions, Request Management, Collaboration, Issue Details and recent Activity. No sticky columns, independent column scrolling or drawer dependency was introduced.

`RequestManagement` owns one open management dialog. `RequestOwnership` retains its existing command/picker behavior with a section selector for Assignment or Watchers. Assignment summaries reuse the safe STAFF/ROLE/Team projection, including inactive/unassigned states. Watchers deliberately use a neutral summary instead of eagerly retrieving identities for a count. Watchers load when their dialog opens; eligible targets load only when selection starts. Operational commands keep expected revision, single-flight behavior and authoritative refresh.

The Contact summary reveals neither values nor whether contact exists. Its View action calls the existing audience-specific protected endpoint exactly once per opening; Strict Mode does not duplicate that event handler. Closing clears values and aborts outstanding retrieval. Reopening fetches again and therefore invokes the unchanged F039 view audit. Refresh/Retry inside the dialog also performs an explicit protected read. Renders and unrelated operational changes do not fetch Contact. Permission/session/parent failure follows the established safe error policy.

`RequestDialog` uses native `showModal()` for background isolation, a labelled heading, initial Close-button focus, explicit forward/reverse focus wrapping (including narrative disclosure controls), Escape/Close and restoration to the still-connected trigger. Busy operational commands prevent premature closing. Each dialog scrolls within the viewport when necessary; the underlying page has no nested scrolling columns. Local picker, Contact and full-Activity failures retain the parent page. A secondary 403 rechecks parent authorization where appropriate; genuine parent/session failure clears the workspace.

## Independent Collaboration tabs

`CollaborationPanel` supplies the shared card and accessible tablist. Internal Notes is the predictable default even if protected. PUBLIC requests have both tabs; INTERNAL requests omit Requester Communication. Each selected tab has its own labelled panel, protected/read-only/create states and the unchanged domain-specific stream component. No shared collaboration permission or count exists. Arrow keys, Home and End select/focus tabs; button Enter/Space activation follows normal browser semantics.

The initially inactive stream is not mounted or fetched. After first selection, it stays mounted but hidden during tab changes, preserving loaded pages and its own unsent draft in memory. Only one composer is visible. Notes and Communication still use separate APIs, cursor pagination, trusted responses, retry keys, plain-text validation, success/error announcements and duplicate-submit guards. Creation clears only its own successful draft; errors retain that draft where previously permitted. A hidden stream cannot steal focus when an outstanding operation finishes.

Request navigation unmounts both streams and aborts pending reads. Sign-out/session expiry and parent access loss remove both. Authoritative read/create capability changes clear the affected stream/draft; an inactive remounted stream waits for selection before authorized retrieval. Permission changes are observed on the next authoritative operation; this is not a claim of instantaneous revocation of already disclosed browser content. No draft, body, tab or modal state is added to URLs, titles or persistent storage. Refresh starts with no dialog, Notes selected and no restored drafts.

Successful workflow/routing/ownership refresh now retains the mounted workspace until authoritative detail arrives, so unrelated drafts and loaded collaboration pages survive. A failed parent refresh still clears the page safely. Revision conflicts refresh current state and require deliberate review, never replay. This changes presentation lifetime only; server revision, audit, Activity and authorization semantics remain unchanged.

## Recent and full Activity

`ActivityPanel` requests exactly five events using the existing bounded Activity API. `RequestActivity` accepts a preview mode and reuses existing event labels, icons, semantic colors, safe actor and timestamp projection. Preview routing/ownership summaries are concise; lifecycle narratives remain in the full view. No history is lost or rewritten.

View full activity opens a large shared dialog and requests the normal 25-event page. Newest-first ordering, stable server pagination, Newer/Older controls, empty/loading/retry states, routing and ownership snapshots and complete narratives remain available. Long narratives keep their semantic disclosure control. Closing restores the trigger and discards the full-view state. Reopening starts at page one. Both preview and an open full view refresh on authoritative parent revision changes. Notes, Communication and tab changes create no Activity and do not trigger these refreshes.

## Fetch and performance review

| Resource                      | Previous behavior                    | F043 behavior                                             |
| ----------------------------- | ------------------------------------ | --------------------------------------------------------- |
| Detail and authorized options | Initial load and operational refresh | Preserved                                                 |
| Notes                         | Initial authorized load              | Default selected tab; retained after first visit          |
| Communication                 | Initial authorized PUBLIC load       | First selection only; retained thereafter                 |
| Watchers                      | Every initial detail load            | Dialog opening, then relevant revision refresh while open |
| Assignment targets            | Picker opening                       | Preserved, inside the Assignment dialog                   |
| Watcher targets               | Picker opening                       | Preserved, inside the Watchers dialog                     |
| Contact                       | Explicit protected read              | Explicit dialog opening/Refresh/Retry only                |
| Activity                      | Initial page of 25                   | Preview of 5; full pages of 25 only when opened           |

For an authorized PUBLIC request, initial calls reduce from six (detail, options, watchers, Notes, Communication, Activity) to four (detail, options, Notes, Activity). INTERNAL similarly avoids its initial watcher call. The backend queries, indexes and authorization predicates are unchanged; no N+1 lookup, new joins or new API was added. This is a request-count/bounded-data review, not production load testing. A visited collaboration stream retains loaded pages until navigation or access-context reset; long-lived sessions can accumulate pages through deliberate Load older actions. Opening full Activity refetches the latest page rather than reusing a five-event preview as complete history.

## Automated validation record

| Check                        | Observed result                                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend unit                 | 204 passed                                                                                                                                                     |
| API E2E                      | 38 passed; zero skips                                                                                                                                          |
| PostgreSQL integration       | 166 passed; zero skips, including F029–F042 and F036 provisioning regressions                                                                                  |
| Shared                       | 62 passed                                                                                                                                                      |
| React                        | 384 passed in 27 files; zero skips; 23 focused F043 tests                                                                                                      |
| TypeScript                   | Test compilation and application no-emit check passed                                                                                                          |
| Backend lint                 | Passed                                                                                                                                                         |
| Frontend lint                | No configured script; not claimed as run                                                                                                                       |
| Backend formatting           | Passed                                                                                                                                                         |
| Backend production build     | Passed                                                                                                                                                         |
| Frontend production build    | Passed; existing Vite chunks-over-500-kB warning remains                                                                                                       |
| Whitespace                   | Passed after cleanup                                                                                                                                           |
| Secret/private configuration | Zero findings after cleanup                                                                                                                                    |
| Protected content scan       | Zero matches against local structured contact, Note and Communication values in changed/new source; values were compared in memory, not included in the report |

Focused F043 coverage exercises lazy management/stream retrieval, five-event requests and page-size rejection, Contact close/abort/reopen, modal names/focus/cancel/busy behavior, independent read/create/protected tabs, keyboard selection, separate drafts and successful/failed creation, navigation/sign-out clearing, hidden permission revocation, secondary errors, ownership permission loss, conflict/refresh draft preservation and full-Activity retry. Existing tests were adapted to open the new UI explicitly, retaining their authoritative mutation, privacy and denial assertions. Standalone F041/F042 validation, XSS, pagination and retry tests remain intact. Native focus isolation and responsive layout require actual browser observations in addition to jsdom tests.

No backend source, migration, dependency manifest, authorization rule, grant tooling or provider configuration changed. Assignment, watcher/self-watch, Contact, Notes, Communication, Activity and PUBLIC/INTERNAL access regressions pass. Contact remains dedicated; collaboration bodies remain in their own protected streams; no resident exposure or new domain permission was introduced.

## Live UAT and data-integrity record

Normal personal Entra authentication and existing development grants were used. The user reported **all ten width/theme combinations passed** on PUBLIC SR-202609-000007 and INTERNAL DEV-202609-00000003: 1440, 1280, 1024, 768 and 390px in light/dark, covering hierarchy, wrapping, dialogs, management controls, tabs, five-event preview/full Activity and no horizontal overflow. This includes balanced desktop columns and stacked tablet/mobile behavior.

Agent observations confirmed native modal status, Close focus, forward/reverse focus wrapping and Escape restoration for Assignment. Temporary fictional drafts were typed into both collaboration textareas without submission; Enter added a newline, switching preserved separate drafts and one visible composer, and navigation away/back cleared both. The default tab returned to Notes with no open dialog. The authorized PUBLIC stream displayed the original one Note and two Communications. Full Activity initially retrieved 25 rows while the preview retained five; the user subsequently confirmed older/newer pagination and complete authorized narratives/snapshots.

The user confirmed that the route-only Chrome Network check passed: initial detail does not retrieve Contact, Communication, watchers or targets; Notes and five-event Activity load initially; each deferred resource loads only when opened; full Activity uses pageSize=25; repeated tab switching causes no fetch loop. The user also confirmed all keyboard/full-history checks passed on PUBLIC and INTERNAL: Tab/Shift+Tab, tab arrows/Home/End, named dialogs, focus entry/wrapping/restoration, Escape/Close, visible focus, reading order, pagination and existing narratives/snapshots. Protected/read-only/revocation states are covered automatically without changing live grants. No WCAG certification is claimed: **This validation is not a WCAG certification.**

During UAT, SR-202609-000007 was observed reassigned from Parks Queue (Team) to Jordan Example (Staff), with revision 25→26 and Activity count 26→27. Browser interaction was paused and the user was asked whether this was their intentional assignment. No restoration or compensating mutation was performed. **The user explicitly confirmed they intentionally performed this assignment during F043 UAT.** It is retained and documented as an intentional operational test, not an unexplained product defect. No compensating mutation was performed. Agent browser UAT submitted no assignment, workflow, watcher, Note or Communication command.

| Fixture             | Baseline                                                                                                                                    | Current read-only observation                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| SR-202609-000007    | PUBLIC/web; open; revision 25; Community Services/Parks; one Team assignment; one watcher; 26 Activity; one Note; two Communications        | Open; revision 26; one Staff assignment; one watcher; 27 Activity; unchanged Note and Communications |
| DEV-202609-00000003 | INTERNAL/staff; on hold; revision 24; Community Services/Parks; one Team assignment; two watchers; 25 Activity; one Note; no Communications | Unchanged                                                                                            |

The final read-only comparison found changes only in the PUBLIC fixture's request/assignment and security/operational history (including authorized Contact-view audits). The PUBLIC updatedAt changed intentionally to `2026-09-21 20:47:20.47891-05` with the user's assignment. INTERNAL updatedAt remained `2026-09-20 04:56:47.99994-05`. Note and Communication content fingerprints, structured contact, watcher relationships, references, other requests and all 20 permissions remained unchanged. Both snapshots retained 21 migrations with zero pending. F043 has introduced no migration or grant.

## Completion and limitations

The assignment is reconciled, all live gates passed, and final formatting, whitespace, private-value and documentation-link checks passed. Three temporary local JSON test-result files were removed and verified absent; no F043 capture/harness/log remains. The commit message is `feat(ui): consolidate service request workspace`. The post-commit report supplies the resulting hash and Git status; the expected local state is one commit ahead and zero behind the unchanged F042 `origin/main`, with no push.

No new Note or Communication was submitted by agent F043 UAT. Both immutable F042 fictional messages remain the accepted historical UAT exception, not a new F043 defect. No message editing/deletion, notification, external delivery or resident tracking work is included. No push, deployment, cloud/client modification or F044 work occurred. Desktop page height still depends on actual description/collaboration content; protected streams can contain long text and are not arbitrarily truncated to make the page shorter.

## Changed files and report coverage

New UI components: `ActivityPanel.jsx`, `CollaborationPanel.jsx`, `RequestDialog.jsx` and `RequestManagement.jsx` under `react/src/staff/requests/`. Adapted existing modules: `InternalNotes.jsx`, `InternalRequestWorkspace.jsx`, `RequestActivity.jsx`, `RequestCommunication.jsx`, `RequestOwnership.jsx`, `RequesterContact.jsx`, `requestRepository.js` and `staffRequests.css` in the same directory. Tests: new `react/test/RequestDialog.test.jsx`; updated `StaffRequestWorkspace.test.jsx`, `StaffRequestRepository.test.js` and `setup.js`. Documentation: this feature record and Architecture, CITYVUE_CONTEXT, Roadmap and the feature index. No new ADR is needed for this presentation change.

Completion-report items 1–9 are covered by the checkpoint/commit record, file list and 21/0 migration and unchanged-permission evidence. Items 10–40 are covered by the information architecture, management, Collaboration, Activity and state-lifetime sections. Items 41–56 are covered by the five-width/two-theme manual matrix, live draft/focus observations and user-confirmed keyboard/route/history checks. Items 57–62 are covered by the final data comparison and intentional assignment exception. Items 63–84 are covered by the validation table and focused security/privacy regression summary. Items 85–92 are covered by fetch/performance findings, the existing build warning, limitations and the explicit no-creation/no-deployment/no-F044 statements.

Documentation navigation checked 106 repository-relative links across five changed/new Markdown files with zero missing targets. Final scanning compared changed/new source against 11 protected local values in memory and found no disclosure. No full Note, Communication or Contact value is reproduced here. Live UAT did not revoke permissions or fabricate protected/read-only fixtures; those states are covered by component/API/database tests. Live selected fixtures have no populated structured contact; populated contact and its authorization/error regressions are covered by automated F039 tests.
