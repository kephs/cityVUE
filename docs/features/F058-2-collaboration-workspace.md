# F058.2 — Collaboration and Service Request Workspace

## F058.2B final workspace composition refinement — current checkpoint

This bounded presentation/composition pass builds on the accepted F058.2B workspace, which is now committed as `ffe8e727527da545cbf584c81c470cef35e9b381`. The refinement is unstaged and uncommitted on the isolated branch `claude/f058-2b-layout-refinement`. Nothing in the backend, API contracts, authorization, permission keys, database, migrations, Migration 40, request revisions, routing/assignment/watcher/tracking semantics, F058.1 or F058.2A changed.

- **Actions card.** The former Work card is replaced by an `Actions` card using the lightning action icon. Available lifecycle commands sit side by side on the first row (Start Work + Close Request when open, Place on Hold + Close Request in progress, Resume Work + Close Request on hold, Reopen Request when closed), and `Route Request` is a full-width second row with the existing signpost icon. Buttons come only from the server-provided `workflowActions` and `canRoute`; when no lifecycle or routing command is authorized, the card is not rendered at all rather than shown empty. Lifecycle and routing semantics, narrative forms, revision guarding, focus restoration and error reconciliation are unchanged.
- **Request Management card.** A single card directly below Actions carries `Assignment`, `Watchers`, `Requester Contact` and `Request Tracker` in that order, each as a label / current-state / action row separated by dividers. `Requester History` is retained as a fifth row so the F050 capability is not removed; it remains gated on public audience, identified requester and `canReadRequesterHistory`.
- **Assignment** keeps its existing state, capability gate, dialog and API. Only the trigger wording changed to `Manage` (accessible name `Manage assignment`), matching the other management rows. The Assign/Unassign commands inside the dialog are untouched.
- **Watchers** keep the existing bounded count summary, capability handling and dialog. The one watcher summary read moved from the former Work card to the single Request Management card, so the request still performs exactly one watcher call.
- **Requester Contact** remains an explicit, audited, non-prefetched read. The row reads `Requester Contact / Separate, audited access` with a `View` action; anonymous requests keep an explicit absence (`Submitted anonymously · No contact information provided`) with no action.
- **Request Tracker** is the presentation rename of Requester Tracking. The row shows the safe issued state plus `Manage secure request tracking access`; no tracking URL is implied before one is issued. Backend concepts, API contracts, database fields and permission keys keep their existing names.
- **Overview.** Intake Channel moved into the upper Issue metadata row, which now reads `Request # → audience → Channel → Status` with wrapping at narrow widths. It uses the existing safe projected `intakeChannel` value; there is no new API call. Department / Division now precedes Service Category, ahead of Assigned to and Reported. The Issue icon, title, reference, audience badge, status and the truthful PUBLIC/INTERNAL banners are otherwise unchanged.
- **Additional Information** is the presentation rename of the Submitted Information heading and its action wording inside the staff workspace. `SubmittedInformation` takes an optional `label`; the older `ServiceRequestDetailsPage` keeps its existing wording byte for byte. The protected read stays explicit and capability-gated, with no prefetch and no backend or permission-key rename.
- **Request Details** and **Request Evidence** remain separate cards with their existing content and permissions. Collaboration and Recent Activity keep their accepted content, behavior and desktop placement.
- **Left-column gaps.** The wide-screen layout no longer uses `grid-template-areas` with coupled rows. Overview spans the full width, and two flex columns flow independently: `Request Details → Additional Information → Request Evidence → Collaboration` on the left, `Actions → Request Management → Recent Activity` on the right. No card is height-coupled to the opposite column, and measured left-column gaps are a uniform 20–21 px at every reviewed viewport in both themes.

### Service Requests list refinement

The list is included in the same uncommitted pass. Behavior, filtering, sorting, pagination, debounced live search, URL query state, server-side authorization and call counts are unchanged; only presentation moved.

- **Pagination-aware numbering** keeps `(page - 1) * pageSize + rowIndex + 1` from the authoritative response, and is now 18 px semibold in primary text colour with tabular figures. It carries no chip or badge treatment, so it cannot be mistaken for the reference, and routes and React keys still use the stable request identifier.
- **Dedicated Request # column.** Desktop order is `# | Issue | Request # | Audience | Status | Department / Division | Assigned to | Reported | Action`. The Issue column holds the category icon, the clickable Issue title and the Service Location beneath it; the reference is no longer duplicated there. `ReferenceDisplay` gained a `labelled` option so the cell shows only the value, with the column heading supplying the name. Both the Issue link and Manage Request keep their existing route and preserved query string.
- **Desktop width.** `main.request-workspace-container` moves from a 1600 px to a 1760 px cap, with the existing page gutters untouched. No viewport hack, transform or zoom is used. Measured content widths are 1760 px at 1920, 1372 px at 1440 and 1216 px at 1280.
- **Readability.** Table body text is 17 px, headings and sort controls 16 px semibold, the Issue title 19 px heading weight, Service Location 16 px secondary, the reference 15 px semibold tabular in its chip, and Manage Request 16 px. Row values no longer break mid-word: cells use `overflow-wrap: break-word`, the reference column stays on one line and Department / Division and Assigned to keep whole words.
- **Search toolbar.** The single-row desktop composition is unchanged — `Live Search | Sort By | Direction | Refresh` remain one `request-list-controls` grid row of `minmax(0, 1fr) 10rem 10rem auto`. Prominence comes only from colour and hierarchy: a stronger tint and border, a 4 px leading accent, a bolder Search Requests label and a taller 17 px input with a 2 px accent border on a card surface. The placeholder is now `Search by request #, issue, or service location`; `Results update as you type.`, the debounce, the clear control and the described-by help text are unchanged. Below 1100 px the existing rule lets Search take its own row, as accepted.
- **Filters** keep every control, label, semantic and URL behavior, and remain a visually separate panel above the search section.
- **Responsive breakpoint.** The nine-column table measurably overflowed at 1024 px, so the list card breakpoint moves from 991.98 px to 1199.98 px, matching the accepted "list cards below 1200px" description. Cards now carry the human row position in addition to Issue, Request #, Service Location, Audience, Status, Department / Division, Assigned to, Reported and Manage Request.

### Reading order — preferred order implemented

Manual review rejected the interim order that placed Actions and Request Management after Collaboration. The **preferred** order is now implemented in full:

`Overview → Request Details → Actions → Request Management → Additional Information → Request Evidence → Collaboration → Recent Activity`

The stated fallback was not needed. The order is achieved by splitting column 1 into two grid items instead of one wrapper, so the DOM can interleave without duplication or CSS order tricks:

| Grid item | Contents | Wide-screen placement |
| --------- | -------- | --------------------- |
| `.request-overview` | Overview | row 1, both columns |
| `.request-details` | Request Details | column 1, row 2 |
| `.request-column-controls` | Actions, Request Management | column 2, rows 2–3 |
| `.request-column-content` | Additional Information, Request Evidence, Collaboration, Recent Activity | column 1, row 3 |

The controls column spans both content rows rather than sharing one with Request Details. Because the content stack is always the far taller side (2,424 px against 809 px in the reviewed synthetic case, and larger still with real notes, messages and attachments), the span never grows a row, so no height coupling reaches the left column. Measured left-column gaps are a uniform 20–21 px at every viewport and both themes, between Request Details and Additional Information as well as within the content stack. There is one DOM element per card, visual order matches DOM and focus order within each column, and no `order`, `float` or negative-margin trick is used.

**One desktop consequence for UAT.** Recent Activity has to be the last DOM node to satisfy the requested order, and it must therefore sit at the end of the wide left column rather than at the bottom of the narrow right rail. Its content, behavior and card presentation are unchanged, and it gains reading width; the right rail now ends after Request Management. Keeping Recent Activity in the right rail is only possible by making it the fourth node in the DOM — which is the rejected ordering — or by giving column 2 its own shared grid row, which re-introduces the coupling this pass removed. Flagged for the reviewer to confirm or redirect.

### Refinement allocation — exactly 17 files

| File | Included refinement scope |
| ---- | ------------------------- |
| `react/src/staff/requests/InternalRequestWorkspace.jsx` | Workspace composition and preferred reading order; Actions card and capability-derived lifecycle/route buttons; Overview channel and metadata order; Additional Information label; single Request Management usage; live search placeholder. |
| `react/src/staff/requests/RequestManagement.jsx` | Single management card with the approved row order; `Manage` assignment wording; unchanged watcher, contact, tracking, history and dialog behavior. |
| `react/src/staff/requests/RequesterTracking.jsx` | Request Tracker labels, helper text, accessible names and dialog titles only. |
| `react/src/staff/requests/SubmittedInformation.jsx` | Optional presentation `label` with the previous copy retained as the default. |
| `react/src/staff/requests/requestRepository.js` | Exported `intakeChannelLabels` presentation map; no contract or projection change. |
| `react/src/staff/requests/staffRequests.css` | Independent column flow and interleaved wide-screen placement, Actions composition, Request Management rows, channel chip, list table columns and typography, search emphasis, narrow-width rules. |
| `react/test/WorkspaceRefinement.test.jsx` | Composition, Actions capability cases, management row order, channel placement, metadata order, Additional Information, independent stacking and reading order. |
| `react/test/StaffRequestWorkspace.test.jsx` | Updated composition/label assertions; existing security, lifecycle, routing, race and focus coverage retained. |
| `react/test/RequestManagement.test.jsx` | Single-card composition and Request Tracker terminology; existing protected-dialog behavior retained. |
| `react/test/RequesterTracking.test.jsx` | Accessible-name update only. |
| `react/test/RequesterHistory.test.jsx` | Single-card composition and contact copy; lazy history, navigation and focus coverage retained. |
| `react/src/staff/requests/RequestResults.jsx` | Dedicated Request # column and column order; Issue column composition; shared presentation-only position helper; card position; 1200 px list card breakpoint. |
| `react/src/components/ui/RequestPresentation.jsx` | Optional `labelled` mode on `ReferenceDisplay`; existing compact and default output unchanged. |
| `react/src/styles.css` | Staff request workspace width cap only (1600 px to 1760 px). |
| `react/test/StaffLiveSearch.test.jsx` | Placeholder and preserved single-row toolbar composition; debounce, query and race coverage retained. |
| `react/test/NavigationDesign.test.jsx` | Added application-shell coverage for both workspace routes; existing header, brand, menu and theme coverage retained. |
| `react/test/WorkspaceRefinement.test.jsx` (further) | Added projected Issue icon, category accent, catalog fallback and Recent Activity event/badge regression coverage. |
| `docs/features/F058-2-collaboration-workspace.md` | This checkpoint. |

### Final UAT regression restoration — presentation frozen

Manual UAT reported two presentation regressions. **Both were synthetic harness/fixture regressions (B); neither was a production React regression.** `RequestActivity.jsx`, `presentation.js`, `categoryAccent.js`, `RequestPresentation.jsx`'s `IssueIcon` and `Attachments.jsx` all match accepted HEAD and were not modified. No production component was altered to make synthetic screenshots look correct.

**1. Issue icons.** `IssueIcon` renders `safeIssueIcon(row.issueIcon)` against the finite catalog in `components/ui/presentation.js`, falling back to `bi-file-earmark-text`, and colours the badge with `categoryAccent(row.categoryId)`. The repository already projects `issueIcon` (`requestRepository.js:142`). The ignored preview fixture simply never supplied `issueIcon` or `categoryId`, so every synthetic record legitimately took the generic fallback. The fixture now carries both as ordinary projected values. Restored consistently in the list table and the detail Overview, with one deliberately unmapped row retaining the catalog fallback, the existing accent palette unchanged, and every icon still `aria-hidden`. No second icon system was introduced and no icon is hard-coded in a component.

**2. Recent Activity presentation.** The accepted `RequestActivity` component already renders the tone-coloured marker, event-specific icon, title, timestamp, actor, `fromStatus → StatusBadge(toStatus)` transition, routing destination, assignment targets, intake channel, narrative card, timeline connector, bounded preview and View full activity. The preview fixture supplied only `type`, `occurredAt` and an out-of-vocabulary `actorDisplay`, with no status transitions, so the richer presentation had nothing to render. The fixture is now a faithful projection carrying the exact field set and actor vocabulary (`Staff member`, `System`, `Resident`) the repository validates, and the harness `activity` call is bounded and paginated like the real one. Status badges now come only from projected `fromStatus`/`toStatus`; `request_routed` correctly shows its destination and **no** badge, because the projection carries no status transition for it and the frontend must not manufacture one.

Focused regression tests were added so neither gap can recur silently: projected icon, category accent and safe fallback across list rows; the Overview icon for mapped and absent values; and Recent Activity event presentation with a badge only where a transition exists, including its right-sidebar placement and bounded single call.

### Final UAT corrections and presentation freeze

Manual UAT accepted the pass with exactly three corrections. F058.2B presentation is frozen after them; nothing else was changed, renamed, reformatted or rearranged.

**1. Application navigation in the UAT preview — synthetic harness omission, not a production regression.** Production routing is intact: `staff/requests` and `staff/requests/:requestId` are children of the `App` route in `react/src/app/router.jsx`, which renders `AppLayout` → `SiteHeader` → `PrimaryNavigation` with the brand, all six public links, the authorized Service Requests link, the Dark/Light Mode control, the signed-in staff identity and Sign out. No production navigation file was modified. The omission was entirely in the ignored preview: `.local-uat/f0582b/main.jsx` mounted `InternalRequestWorkspace` inside a hand-written `div.app-shell > main.container` instead of the real shell. The harness now renders the genuine `ThemeProvider` + `AppLayout`, so manual UAT uses the real navigation, the real theme control and the real footer. No duplicate navigation bar was created; the DOM contains exactly one `nav[aria-label="Primary navigation"]`. Because the real navigation only reveals Service Requests, the staff identity and Sign out when `auth.enabled && auth.isAuthenticated`, the preview substitutes a harness-only `syntheticAuth.jsx` through a Vite `resolve.alias`, so the signed-in state renders without a tenant, an MSAL redirect or any production change. It issues no token and contacts no identity service.

A focused production test now guards the composition this omission hid: `AppLayout` on both workspace routes must render the primary navigation, every link, the identity, Sign out and the theme control, with `main#main-content.request-workspace-container` holding the page content outside the navigation.

**2. Recent Activity returns to the right operational column.** `ActivityPanel` moved from the content column back into `.request-column-controls`, directly below Request Management. Desktop right column is now Actions → Request Management → Recent Activity, measured 21 px below Request Management in the same column, with exactly one `.request-history` element in the DOM. The component, timeline, bounded loading, permissions and behavior are untouched, and it is not merged with Request Management. This was a single-node move, the smallest available adjustment: no wrapper was added or removed, no CSS ordering trick was introduced, and the left column keeps its uniform 21 px rhythm. The single-column order becomes `Overview → Request Details → Actions → Request Management → Recent Activity → Additional Information → Request Evidence → Collaboration`, which keeps DOM, visual and focus order in agreement. This UAT decision supersedes the earlier left-column placement.

**3. Intake Channel label.** The Overview metadata row now reads `Intake Channel: API`, using the same already-projected value for every channel. `.request-overview .request-identity-meta` gains a `var(--space-5)` column gap, measured at 26 px between each item, so the row reads `Request # …    Public    Intake Channel: API    Open` with the existing responsive wrapping preserved. Presentation terminology only: no API field, persisted value, backend term or request contract changed.

### Final manual-review decisions applied

- **Search toolbar composition — accepted and unchanged.** `Live Search | Sort By | Direction | Refresh` remain one desktop row; wrapping below 1100 px is retained.
- **List breakpoint — accepted.** Nine-column table at 1200 px and wider, semantic cards below it, no horizontal table scrolling. The 1152 px list screenshot is provided for card-density review; those cards were not redesigned.
- **Request Management — final order confirmed** as Assignment, Watchers, Requester Contact, Request Tracker, Requester History. The F050 history capability is retained.
- **Reading order — preferred order implemented** (see above); the fallback was not required.

### Refinement validation

Focused React ran first: `WorkspaceRefinement`, `StaffRequestWorkspace`, `RequestManagement`, `RequesterTracking`, `RequesterHistory`, `StaffLiveSearch`, `DesignSystem`, `DynamicQuestions`, `ExtendedQuestions`, `IntakeUxRefinement`, `ServiceRequestDetailsPage`, `Attachments` and `CollaborationPanel` all pass.

Three full React invocations are recorded, none overwritten:

| Invocation | Result |
| ---------- | ------ |
| Workspace refinement | **767 passed / 0 failed**, 767 total, 54 files, 329.06 s |
| Plus list refinement | **771 passed / 0 failed**, 771 total, 54 files, 360.14 s |
| Plus reading-order correction | **770 passed / 1 failed**, 771 total, 54 files, 398.99 s |
| Plus final UAT corrections | **772 passed / 1 failed**, 773 total, 54 files, 303.39 s |
| Plus regression restoration (first) | **774 passed / 4 failed**, 778 total, 54 files, 233.64 s |
| Plus regression restoration (second) | **778 passed / 0 failed**, 778 total, 54 files, 229.36 s |

The first restoration invocation failed four scattered tests (`F041 Notes response 404`, `F058.2B mobile cards reuse list data`, `F042 load older appends server order`, `sign-out unmounts already rendered protected data`) in 233.64 s, a markedly faster run than the 300–400 s norm on this machine. All four pass in isolation and all four passed in the immediately following clean 778/778 invocation, which also passed the usually-flaky Issue Creation timeout. Both invocations are reported rather than only the clean one. The scattered timing failures are environmental, matching the flakiness history recorded below; no threshold was raised and no test was modified to obtain a pass.

The single failure in the three preceding invocations is `IssueCreation.test.jsx` → *F056.5 External Redirect is configured before one complete Create request*, which exceeded the existing 5,000 ms limit at 5,047 ms. It is unrelated to this scope and **demonstrably pre-existing**: with the entire refinement stashed away, a pristine HEAD checkout fails the same test at 5,031 ms, and the same test failed in both pre-refinement baseline invocations on this machine (756/3 and 758/1 of 759). No timeout was raised, no sleep added, no isolation workaround introduced and no authorization or behavioral assertion weakened. The clean 771/771 result remains valid validation history for the same tree minus the reading-order correction.

`StaffRequestWorkspace.test.jsx` → *F041 Notes response 401/404 clears the inaccessible parent/contact/Notes* is intermittently racy on this machine, failing roughly one run in three both before and after this pass; it passed in the recorded full invocations. It is recorded here rather than adjusted, since the flake is in the test's timing assumptions, not in product behavior.

New list coverage asserts the nine-column order, the dedicated reference column with no duplicate inside the Issue cell, the clickable Issue link and Service Location, pagination-aware numbering that never reaches a route, the card position and complete card fields, the 1199.98 px card query, the search placeholder, and the preserved toolbar and filter composition. Reading-order coverage asserts the four grid items, their exact contents, that neither column contains the other or Request Details, and the full landmark and focus sequence.

New list coverage asserts the nine-column order, the dedicated reference column with no duplicate inside the Issue cell, the clickable Issue link and Service Location, pagination-aware numbering that never reaches a route, the card position and complete card fields, the 1199.98 px card query, the search placeholder, and the preserved toolbar and filter composition.

Two pre-refinement baseline invocations of the same suite on this machine returned **756 passed / 3 failed** and **758 passed / 1 failed** out of 759, the failure being the previously recorded `IssueCreation.test.jsx` five-second External Redirect timeout and its demonstrated typing-leakage cascade. That history is retained rather than overwritten; the refinement run is clean, but the underlying timing sensitivity is environmental and unresolved.

Frontend production build passes and retains its existing >500 kB chunk warning. `styles.css` and `staffRequests.css` were rebuilt from HEAD and re-patched after a Prettier write reformatted them whole-file, so both diffs contain only intended changes and the baseline CSS formatting condition is retained. There is no configured frontend lint script. Canonical formatting was verified with the repository's Prettier on every changed JavaScript/JSX file using `--end-of-line auto`, since the working tree is CRLF; all changed files match. `RequesterTracking.test.jsx` retains a pre-existing formatting deviation identical to HEAD, and the whole-file CSS formatting baseline is likewise unchanged.

Backend, API E2E, PostgreSQL integration and shared suites were **not rerun**: this change touches no backend or shared code. Their last recorded results (320 / 41 / 578 / 64) are inherited evidence from the accepted checkpoint, not a fresh run.

### Refinement responsive, theme and keyboard evidence

A synthetic Chrome harness at `http://127.0.0.1:5198` renders the workspace from fictional in-memory data with no API client, network call or mutation. It lives in ignored `.local-uat/f0582b/` and accepts `?theme=dark`, `?audience=internal`, `?status=…` and `?readonly`.

- 12 detail viewport/theme combinations pass: 1440×1000, 1280×900, 1024×768, 768×1024, 390×844 and 1280×500, in light and dark. No horizontal overflow, no duplicate element ids, no unlabelled form field and no unnamed button in any combination. No browser page errors were observed; the only console entry is the harness's own missing favicon.
- 14 list viewport/theme combinations pass: 1920×1080, 1440×1000, 1280×900, 1152×900, 1024×768, 768×1024 and 390×844, in light and dark. No page or table horizontal scrolling at any width. The table renders at 1280 and wider, cards at 1152 and narrower, and Live Search, Sort By, Direction and Refresh share one row down to 1152 before the accepted narrow wrapping.
- Measured left-column gaps are 21 px at desktop widths and 20 px at 768/390 in both themes, with no card exceeding a 24 px separation, including the Request Details to Additional Information boundary that now crosses two grid rows. At 1440 the left column measures 2,424 px against an 809 px controls column, confirming the spanning column does not couple heights.
- Keyboard checks pass: tab order follows `Actions (Start Work, Close Request, Route Request) → Request Management (Assignment, Watchers, Requester Contact, Request Tracker, Requester History) → Additional Information → Collaboration → Recent Activity`, matching both the DOM and the single-column visual order. The Assignment dialog opens from Enter with initial focus inside it, forward and reverse tabbing stay contained, Escape dismisses it and focus returns to `Manage assignment`. Route Request moves focus to the department field and `Cancel routing` returns focus to the Route Request trigger. These are accessibility-oriented checks, not WCAG certification.
- Screenshots are ignored `.local-uat/f0582b-shots/` artifacts: full desktop detail at 1440/1280/1024/768/390 and short height in both themes; card-level captures of Overview, Actions, Request Management, Request Details, Additional Information, Request Evidence and the whole left column; Actions per lifecycle state; internal-audience and read-only compositions; and the Service Requests list at 1920/1440/1280/1152/1024/768/390 in both themes. All data is synthetic; the harness accepts `?list`.

Initial repository call counts are unchanged: 2 on the list and 8 on the detail in the writable configuration, with no per-row detail fetch, no Requester Contact prefetch and no protected-data prefetch. The `intakeChannel` value shown in Overview is the already-projected detail field. The list continues to rely on server-side filtering, search, sorting and pagination with its existing debounce; no client-side search was added.

Git state: branch `claude/f058-2b-layout-refinement`, parent `ffe8e727527da545cbf584c81c470cef35e9b381`, index empty, **16 files** (15 modified tracked files and this document). Screenshots, the synthetic harness and logs remain ignored local artifacts. No stage, commit, push, deployment, migration, provisioning, live-request mutation or cloud change occurred. **Stop for manual visual review.**

## F058.2B final manual visual review corrections — accepted foundation

This presentation-only pass supersedes the earlier review checkpoints below. Parent remains `114d3814306d45fa8391c93d7045fe650b8e6e1d`; all F058.2B work remains unstaged and uncommitted.

- Desktop results restore a narrow `#` column before Request. Positions use the authoritative response page and page size: `(page - 1) * pageSize + rowIndex + 1`. Routes and React keys continue using the stable request identifier. Mobile cards retain their existing identity hierarchy without an added number.
- Issue links, human references, optional Service Location, audience/status, routing, assignment, Reported, Manage Request and pagination remain. List text is now 16 px, with 18 px Issue titles; references remain secondary. Scoped workspace tokens use 17 px body and 15 px secondary text on desktop, with 16 px body on narrow mobile. Overview and Work values are 18 px on desktop and 17 px on narrow mobile. Division sublines are 16 px desktop / 15 px narrow mobile. No zoom/transform scaling or page-title enlargement was introduced.
- The existing authorized `categoryName` appears as Service Category in Overview before Department / Division, Assigned to and Reported. Request Details now contains Description and authorized Service Location only; Issue context is removed. There is no new API, field or fetch.
- Overview shows audience guidance in the same position: **Public Request — This request is part of the public service request workflow.** or **Internal Request — Visible only to authorized staff.** Text and the shared information icon supplement distinct theme-aware colors; PUBLIC does not imply publication, requester visibility or delivery.
- Work retains its position before Requester. Status, Assignment, Routing and Watchers group their current value and applicable controls at the same left edge, with deliberate spacing. Existing capabilities, command wording, mutation owners and dialogs remain authoritative.
- Submitted Information and Request Evidence stay separate protected cards. F058.2A Collaboration and Recent Activity keep their existing organization and behavior; scoped typography inherits into their content without redesigning them.

### Final review allocation — exactly 13 files

The proposed coherent single commit remains `feat(requests): refine service request workspace`: six production files, six test files and this record. This is a reviewed working-tree allocation, not staging approval.

| File                                                    | Complete included F058.2B scope                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react/src/staff/requests/InternalRequestWorkspace.jsx` | Workspace composition/order; Overview category and audience notices; ordinary Details; separate protected cards; Work action/routing slots; response pagination passed to results; list/footer labels; existing success/uncertain-result wording and focus restoration. |
| `react/src/staff/requests/RequestResults.jsx` (new)     | Semantic desktop table/mobile cards; response-based row positions; Issue and Manage Request links; reference, location, badges, metadata and existing sort controls.                                                                                                    |
| `react/src/staff/requests/RequestManagement.jsx`        | Work/Requester presentation, grouped Status and Assignment/Watchers, routing/action slots, existing dialogs and Work-only watcher summary.                                                                                                                              |
| `react/src/staff/requests/RequestOwnership.jsx`         | Human assignment/watcher/search/removal labels only.                                                                                                                                                                                                                    |
| `react/src/staff/requests/WorkflowNarrativeForm.jsx`    | Place on Hold capitalization only.                                                                                                                                                                                                                                      |
| `react/src/staff/requests/staffRequests.css`            | Appended responsive workspace/results/footer styles, scoped typography, audience notice and Work alignment; original CSS prefix unchanged.                                                                                                                              |
| `react/test/WorkspaceRefinement.test.jsx` (new)         | Call counts; protected response isolation; DOM order; URL preservation; responsive reuse; uncertain-result no-replay; links/location; Work grouping; four response-based numbering cases and two Overview/category/banner cases.                                        |
| `react/test/StaffRequestWorkspace.test.jsx`             | Presentation/section/heading and focus assertions; existing security, lifecycle, routing and race coverage retained.                                                                                                                                                    |
| `react/test/RequestManagement.test.jsx`                 | Split Work/Requester composition and Assignment heading; existing protected-dialog behavior tests.                                                                                                                                                                      |
| `react/test/StaffLiveSearch.test.jsx`                   | Human label/count/footer assertions; debounce/query/race expectations retained.                                                                                                                                                                                         |
| `react/test/IntakeUxRefinement.test.jsx`                | Filter/page-size/query assertions aligned with approved labels, footer and result actions.                                                                                                                                                                              |
| `react/test/RequesterHistory.test.jsx`                  | Requester-section composition and protected-contact copy; lazy history/navigation/focus coverage retained.                                                                                                                                                              |
| `docs/features/F058-2-collaboration-workspace.md`       | Ownership inventory, cumulative evidence history, corrections, exact allocation and review gate.                                                                                                                                                                        |

`Attachments.jsx` and `SubmittedInformation.jsx` still match synchronized HEAD and are excluded. No backend, API/repository contract, F058.1, permission, migration, request revision, assignment/routing or protected-resource semantics changed. ADR-024 remains Proposed.

### Final review validation

The first focused invocation returned **289 passed / 4 failed**: four existing assertions still expected the former Work heading “Assigned to.” The approved grouping now uses “Assignment”; only those presentation assertions were updated. The unchanged-settings rerun passed **293/293 in nine files**, including six additional numbering/Overview tests. No timeout was raised, sleep added or authorization assertion weakened.

The synthetic browser harness initially assumed a read-only Work panel should have no buttons. Existing watcher-list access correctly retains its Manage control; the harness was corrected to check absence of mutating lifecycle/assignment/routing actions, without changing product code. The full **48-case responsive/light-dark matrix** passes across 1440×1000, 1280×900, 1024×768, 768×1024, 390×844 and 1280×500. Both audiences, list/card representations and lifecycle/identity/read-only states are covered. Supplemental long-content mobile checks find no horizontal overflow, duplicate IDs or unlabelled form fields. No browser page errors were observed.

Short-height keyboard checks pass: explicit contact loading, safe initial dialog focus, forward/reverse containment, Escape dismissal, trigger focus restoration and Collaboration arrow-key switching. These are accessibility-oriented checks, not WCAG certification. Initial repository calls remain **2 list / 8 detail** in the accepted writable configuration; the established read-only case remains 7. No per-row detail, protected prefetch or category-specific call was introduced.

Fresh screenshots are ignored `.local-uat/f0582b-final-review-*.png` artifacts, including desktop list, both audience Overviews, Work, separate Submitted Information/Evidence, mobile list/detail and dark mode. The synthetic preview remains `http://127.0.0.1:5198/__f0582b`; append `?list`, `?audience=internal` or `?theme=dark` as appropriate. It uses fictional in-memory data and has no live API/mutation operations.

The new full React invocation completed with **757 passed / 2 failed**, 759 total in 54 files, in 229.20 seconds. Both failures are in unchanged `IssueCreation.test.jsx`: the External Redirect creation test exceeded the existing 5,000 ms limit (5,022 ms), and the following Availability test could not find the Roads option. Its failure DOM shows Category containing `" fictional service."`, the suffix of the preceding test's Handoff message, with an empty list and “Searching…”. This is direct evidence of the same timeout-triggered cross-test typing leakage previously demonstrated in the [F058.1 investigation](F058-1-request-authorization-consistency.md#pre-commit-react-failure-investigation), not an absent Category fixture or live API response. The exact system scheduling cause of this invocation's timeout was not profiled. The current mocked Issue Creation implementation, tests, setup and timeout configuration have no F058.2B diff.

The isolated affected-file rerun passed **17/17** in 23.39 seconds with unchanged settings. It is supplemental evidence, not a replacement for the failed complete invocation. The full React gate is **not clean**; no timeout or isolation workaround was added to this presentation-only scope. Earlier full results **738/8**, **748 clean**, **752/1 five-second timeout** and isolated **17 passed** remain historical evidence, not overwritten or double-counted.

| Final review gate                                         | Actual result                                                                            |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Backend unit                                              | 320 passed, zero failed/skipped                                                          |
| API E2E                                                   | 41 passed, zero failed/skipped                                                           |
| PostgreSQL integration                                    | 578 passed, zero failed/skipped                                                          |
| Shared                                                    | 64 passed, zero failed/skipped                                                           |
| Full React                                                | **757 passed / 2 failed**, 759 total; timeout and demonstrated subsequent typing leakage |
| Isolated Issue Creation                                   | 17 passed; supplemental                                                                  |
| Distinct tests                                            | **1,762** with passing evidence after retry; full React invocation remains failed        |
| Focused React                                             | 293 passed in nine files; included in the distinct total                                 |
| Responsive/light-dark                                     | 48 cases passed; supplemental                                                            |
| Keyboard/focus / mobile long-content labels               | Passed; accessibility-oriented only                                                      |
| TypeScript / backend build / configured backend lint      | Passed                                                                                   |
| Backend formatting / changed-content canonical formatting | Passed; baseline CSS whole-file formatting condition retained                            |
| Frontend production build                                 | Passed; existing large-chunk warning retained                                            |
| Whitespace / documentation links / private-value review   | Passed; 33 local links checked, no findings                                              |

Validation used the established repository commands and disposable test database, with live `DATABASE_URL` excluded from test processes. Backend/static/database suites completed before the full React invocation. No new timeout, sleep, dependency or configuration change was introduced. There is no configured frontend lint script. Existing Node module-type diagnostics remain. The frontend build completed in 1.72 seconds and retains its >500 kB chunk warning.

All 346 accepted backend-file fingerprints match, including the 40 migration sources. Live read-only verification remains **39 applied / Migration 40 pending / 60 tables**, with the same attachment-protection function fingerprint. No live migration, request/access mutation, provisioning or fixture operation occurred; this is not a fresh all-table content fingerprint claim. ADR-024 remains **Proposed**.

Final Git state: `main`, HEAD/local `origin/main` `114d3814306d45fa8391c93d7045fe650b8e6e1d`, **0 ahead / 0 behind** against that tracking reference. Exactly **13 files**, all unstaged (11 modified tracked files and two new files); index empty. Screenshots, logs and the synthetic preview remain ignored local artifacts. No commit, push, deployment or cloud change. **Stop for manual review before staging or committing**, with the complete React failure explicitly unresolved as a clean-run gate.

## Previous F058.2B manual visual review corrections — historical checkpoint

Manual review supersedes the earlier presentation and 15-file allocation below. Accepted F058.2B behavior is retained except for the specifically requested corrections. Nothing is staged or committed; parent remains `114d3814306d45fa8391c93d7045fe650b8e6e1d`.

- Restored the Issue/title link in both desktop rows and semantic mobile cards, keeping the explicit Manage Request action. Both links preserve the same request route and current list query.
- Restored Service Location after the reference from the existing bounded list response. An absent location renders no line or placeholder; no detail call is added.
- Moved Work ahead of Requester in DOM order and the desktop secondary column. Work groups Status/lifecycle actions, Assignment/action, Routing/action and Watchers/action. Shared row alignment and spacing replace detached controls and excessive rule separators; no nested group cards or forced equal card heights were added. Narrow layouts consistently place the action below its label/value.
- Restored Submitted Information and Request Evidence as separate cards. Removed the optional embedded mode completely; both component files again match synchronized HEAD. Submitted Information still requires an explicit authorized View action, and Evidence retains its original policy/context/empty-state behavior.
- Request Details now contains ordinary Description, authorized Service Location and optional Issue context only. Collaboration is repositioned without changing its accepted F058.2A implementation or semantics.

**Final DOM/mobile order**, when the relevant sections are available: Overview → Request Details → Work → Requester → Submitted Information → Request Evidence → Collaboration → Recent Activity. Existing capability/feature gates may omit an unavailable protected section. Desktop places Overview full width; the primary column contains Details, Submitted Information, Evidence and Collaboration; the secondary column contains Work, Requester and Recent Activity. The desktop grid spans rows to avoid forcing equal-height cards while retaining the same underlying DOM. Mobile cards have consistent 20 px section gaps; scroll comes from actual content rather than blank layout tracks. Protected sections remain separate even on short/narrow screens.

Compact Overview, separate Public/Internal and Status badges, human action wording, Assigned to me, semantic mobile results, pagination, URL-state preservation, stale/uncertain-result handling, request-switch isolation and focus improvements remain. Server capabilities, permissions, revisions, transaction-time authorization, assignment/routing semantics, Contact protection, Evidence/answer authorization, attachment contexts and operational Activity are unchanged. No Migration 40 or F058.2A source changes were introduced.

### Corrected file/hunk allocation — 13 files

Proposed single commit remains `feat(requests): refine service request workspace`. The allocation is now **13 files: six production files, six test files and this feature record**. The previous 15-file allocation is historical. `react/src/attachments/Attachments.jsx` and `react/src/staff/requests/SubmittedInformation.jsx` have no remaining diff and are excluded.

| File                                                    | Complete F058.2B hunk scope                                                                                                                                                                                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react/src/staff/requests/InternalRequestWorkspace.jsx` | Workspace composition and corrected DOM order; ordinary Details; separate protected cards; Work action/routing slots; list results/footer; human labels; retained success/uncertain wording and focus restoration. Existing fetch/mutation owners retained. |
| `react/src/staff/requests/RequestResults.jsx` (new)     | Semantic desktop rows/mobile cards using bounded list data; restored Issue link and optional location; retained Manage Request, reference, badges, metadata and sort behavior.                                                                              |
| `react/src/staff/requests/RequestManagement.jsx`        | Work/Requester presentation, grouped status/actions and label/value/action rows; existing dialogs and Work-only watcher summary.                                                                                                                            |
| `react/src/staff/requests/RequestOwnership.jsx`         | Human assignment/watcher/search/removal labels only.                                                                                                                                                                                                        |
| `react/src/staff/requests/WorkflowNarrativeForm.jsx`    | Place on Hold capitalization only.                                                                                                                                                                                                                          |
| `react/src/staff/requests/staffRequests.css`            | Appended responsive layout, result cards/table, links/location, pagination and coherent Work spacing; existing CSS prefix retained.                                                                                                                         |
| `react/test/WorkspaceRefinement.test.jsx` (new)         | Call budgets, corrected section order, protected response isolation, URL preservation, responsive result reuse, uncertain-result no-replay, four link/location combinations and Work grouping.                                                              |
| `react/test/StaffRequestWorkspace.test.jsx`             | Corrected presentation/section assertions with existing security, routing, workflow and race coverage retained; focus assertion.                                                                                                                            |
| `react/test/RequestManagement.test.jsx`                 | Split Work/Requester composition with existing explicit-dialog tests.                                                                                                                                                                                       |
| `react/test/StaffLiveSearch.test.jsx`                   | Human label/count/footer assertions; unchanged debounce/query/race expectations.                                                                                                                                                                            |
| `react/test/IntakeUxRefinement.test.jsx`                | Existing filter/page-size/query tests aligned with approved labels, footer and result actions.                                                                                                                                                              |
| `react/test/RequesterHistory.test.jsx`                  | Requester-section composition and protected-contact copy; existing lazy history, navigation and focus expectations.                                                                                                                                         |
| `docs/features/F058-2-collaboration-workspace.md`       | Initial ownership inventory, implementation/evidence history, manual corrections, current allocation and validation/report gate.                                                                                                                            |

### Correction evidence completed before comprehensive rerun

The correction-focused suite passes **287 tests across nine files**. Five tests were added beyond the previous 748-test complete-suite checkpoint: four desktop/mobile × present/absent-location cases, and one grouped Work/DOM/protected-card case. Earlier correction run: **286 passed / 1 failed**, because the layout fixture expected Submitted Information without enabling its read capability; the fixture was corrected rather than weakening the production guard.

All **48 corrected synthetic responsive/light-dark cases pass** at 1440×1000, 1280×900, 1024×768, 768×1024, 390×844 and 1280×500. These comprise 24 PUBLIC/INTERNAL detail cases, 12 list cases and 12 lifecycle/identity/read-only cases. Screenshots were regenerated after final Work density tuning. Work precedes Requester visually and in DOM order; both list links and location are present, and no horizontal overflow or browser page error was observed. The first scratch browser selector matched both Issue and Manage Request because it used a partial accessible name; changing that test selector to exact matching resolved the harness ambiguity without changing product behavior.

Short-height keyboard checks pass for dialog initial focus, forward/reverse containment, Escape dismissal, focus restoration and Collaboration arrow-key switching. The mobile density review retained the separate protected cards and removed nested Work group surfaces rather than hiding information. These remain accessibility-oriented checks, not WCAG certification.

Initial repository calls remain **2 for list** and **8 for detail** in the accepted readable/creatable fixture configuration. The read-only synthetic configuration makes seven because it has no writable Collaboration attachment composer. No per-result detail call or new Contact/Submitted Information/history/target prefetch occurs. List query/permission behavior is unchanged; backend scale proofs remain in the required PostgreSQL run.

The synthetic preview remains `http://127.0.0.1:5198/__f0582b`, with `?list`, `?audience=internal`, `?theme=dark` and the existing fictional status/identity options. Current screenshots use ignored `.local-uat/f0582b-corrected-*.png` names and cover desktop list, PUBLIC and INTERNAL detail, mobile list/detail and dark mode. The virtual preview module was refreshed so its synthetic Open capability includes the supported `start_work` action. This is presentation evidence only: there is no live API, mutation operation or authenticated UAT in the preview.

Earlier **738 passed / 8 failed** and later **748 passed clean full React** invocations remain recorded below. They are not replaced by the correction results, and supplemental tests/reruns are not added to the distinct total.

### Corrected final validation — full React timeout retained

The corrected full React invocation completed with **752 passed / 1 failed**, 753 total across 54 files, in 264.86 seconds. The sole failure was the unchanged `IssueCreation.test.jsx` case “F056.5 External Redirect is configured before one complete Create request,” which exceeded the existing five-second limit (reported at 5,010 ms). The isolated affected-file rerun then passed **17/17** at unchanged settings. This is supplemental evidence; the full invocation is **not** reported as clean. The exact timing cause is not established by isolation alone. No Issue Creation source, test, setup, timeout or assertion was changed to address it. Earlier Issue Creation timeout history and the pre-correction clean 748-test run remain recorded below.

| Correction validation                                         | Actual result                                                                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Backend unit                                                  | 320 passed; zero failed/skipped                                                                                             |
| API E2E                                                       | 41 passed; zero failed/skipped                                                                                              |
| PostgreSQL integration                                        | 578 passed; zero failed/skipped                                                                                             |
| Shared                                                        | 64 passed; zero failed/skipped                                                                                              |
| Full React                                                    | **752 passed / 1 five-second timeout**, 753 total                                                                           |
| Isolated Issue Creation rerun                                 | 17 passed; supplemental, not a replacement full run                                                                         |
| Distinct tests                                                | **1,756**; all have passing evidence after the isolated retry, but the complete React invocation retains its timeout caveat |
| Focused corrected React                                       | 287 passed across nine files; already included in the React total                                                           |
| Synthetic responsive/light-dark                               | 48 passed; supplemental                                                                                                     |
| Keyboard/focus                                                | Passed; accessibility-oriented checks only                                                                                  |
| TypeScript / backend build / configured backend lint          | Passed                                                                                                                      |
| Backend formatting / changed-content canonical formatting     | Passed; existing CSS prefix/whole-file formatting limitation preserved                                                      |
| Frontend production build                                     | Passed                                                                                                                      |
| Whitespace / local documentation links / private-value review | Passed; 32 links checked, no private-pattern findings                                                                       |

The full test settings remain `vitest run --config vitest.config.mjs --maxWorkers=1`, without sleeps or raised timeouts. The isolated rerun adds only `react/test/IssueCreation.test.jsx`. Backend test compilation and unit/API/database/shared commands used the existing supported test harness and disposable test database; live `DATABASE_URL` was excluded. No completed focused or responsive checks were repeated during the continuation. The complete-suite timeout remains a review caveat; it has not been waived or concealed.

The production build retains the existing >500 kB chunk warning and also emitted a plugin-timing diagnostic (67% of its 4.8 seconds in plugin hooks). Existing Node module-type diagnostics remain. No configuration was broadened or changed to suppress them. There is no configured frontend lint script. All 346 backend-file fingerprints still match the accepted baseline, including all 40 migration sources. A read-only live check confirms **39 applied / 1 pending, 60 tables**, and the attachment-protection function fingerprint remains unchanged; Migration 40 was not applied live. This does not claim a fresh all-table content fingerprint comparison. ADR-024 stays **Proposed**.

Final corrected Git state: `main`; HEAD and local `origin/main` remain `114d3814306d45fa8391c93d7045fe650b8e6e1d`; **0 ahead / 0 behind** against that tracking reference. Exactly 13 proposed files remain (11 modified tracked files and two new files), all unstaged; the index is empty. No commit, push, deployment, live mutation, provisioning, fixture operation, migration or cloud change occurred. No other feature started. **Stop for manual visual review before staging or committing**, retaining the full React timeout caveat above.

## F058.2B ownership inventory before layout changes

F058.2A is synchronized at `114d3814306d45fa8391c93d7045fe650b8e6e1d`. F058.2B starts from that clean parent and remains local, uncommitted and subject to visual/commit review. The earlier 2A checkpoints below are historical evidence.

| State/resource                                          | Existing owner and preservation plan                                                                                                                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detail, capabilities, request revision, status, routing | `InternalRequestWorkspace` / keyed `RequestDetail` loads authoritative detail/options, submits existing commands with expected revision, then refreshes. Keep that owner and abort lifecycle. |
| Assignment/watchers                                     | `RequestManagement` owns count and dialogs; `RequestOwnership` owns explicit discovery/forms. Keep those reads and mutations; compose them under Work.                                        |
| Contact                                                 | `RequestDetail` owns explicit audited load and abort; management opens its dialog. Move only Requester presentation/dialog composition to a Requester panel.                                  |
| Submitted Information                                   | `SubmittedInformation` owns explicitly triggered protected read, identity/request-key state and abort. Nest it in Request Details without prefetch.                                           |
| Evidence                                                | `RequestEvidence` owns existing policy-gated metadata list and explicit downloads. Reuse unchanged inside Request Details.                                                                    |
| Collaboration                                           | Keyed F058.2A `CollaborationPanel` owns audience tabs; each stream owns draft/read/submission state. Reposition the component without changing internals.                                     |
| Activity                                                | `ActivityPanel` owns full-history dialog; `RequestActivity` loads five-event preview or explicit 25-event history. Preserve separate operational stream.                                      |
| Tracking/requester history                              | Existing PUBLIC-only components and explicit history dialog; move under Requester without broadening eligibility.                                                                             |
| Dialogs                                                 | `RequestDialog` retains focus containment/restoration; request-keyed composition invalidates dialogs on request change. Routing/narrative forms remain in the detail owner.                   |
| List query/filter/page state                            | `RequestList` owns URL parameters, 300 ms search debounce, abort/newest-intent guards and existing filter apply behavior. Mobile results reuse the same bounded projection.                   |

Before restructuring JSX, three deterministic baseline tests passed. Initial PUBLIC and INTERNAL detail each make eight repository calls with both streams readable/creatable, evidence enabled and tracking management unavailable: detail 1, options 1, watcher summary 1, Activity preview 1, selected Collaboration stream 1, attachment policy 2, evidence metadata 1. The other stream, Contact, answers, requester history, target discovery and full Activity are not fetched. An initial list makes one list and one options call, with zero per-result detail/protected-child calls. These are frontend repository-call counts, not SQL counts or a constant-time performance claim. Existing backend query/scale tests remain authoritative for database behavior.

## Initial F058.2B implementation (superseded by manual review corrections)

The local workspace now uses Overview → Request Details → Requester → Work → Collaboration → Recent Activity in DOM order. At 1200 px and wider, Overview spans both columns, Request Details and Collaboration occupy the wider column, and Requester, Work and Recent Activity occupy the secondary column. At tablet/mobile widths, the same DOM becomes one column. There is no nested workspace scrolling region or sticky obstruction.

Overview emphasizes Issue, a secondary human reference, separate Audience/Status badges, routing, assignment and Reported time. The INTERNAL notice is “Internal Request / Visible only to authorized staff.” Request Details groups Description, meaningful authorized Service Location, explicit Submitted Information, policy-gated Request Evidence and optional Issue context. It neither introduces a map nor exposes coordinates. Requester uses existing identity/contact/tracking/history projections; it does not introduce a named INTERNAL requester or broaden Contact access. Work composes existing status, routine actions, narrative actions, assignment, routing and watcher components. Primary lifecycle actions remain capability-gated; a disappearing routine-action trigger restores focus to the Issue heading after authoritative refresh.

F058.2A Collaboration is repositioned without changing its component, streams, drafts, attachment contexts, eligibility, delivery statement or privacy notices. Activity remains a separate five-event preview with explicit full-history disclosure. No Collaboration record is reclassified as operational Activity. No API, repository projection, backend, permission, grant, schema, migration or revision behavior changes.

The list retains its six filters, 300 ms search, existing sort/query semantics and server pagination (25/50/100, default 25). “Assigned to me” retains the existing `view=mine` contract. A single Manage Request action replaces the issue/detail link pair. Desktop uses a semantic table; below 992 px, semantic result cards render the same bounded response. There is no per-result detail lookup. Authoritative total and page range remain distinct, and the footer stacks deliberately on mobile. The URL query survives list → detail → back, including filters, search, legacy reference search, sort/direction and pagination.

### Initial F058.2B proposed allocation (historical 15-file checkpoint)

One coherent proposed commit, `feat(requests): refine service request workspace`, parent `114d3814306d45fa8391c93d7045fe650b8e6e1d`. All changes remain unstaged. Exactly 15 files:

| File                                                    | Included hunks                                                                                                                                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react/src/staff/requests/InternalRequestWorkspace.jsx` | Six-section composition; list result extraction/footer and human labels; Overview/details grouping; Work slots; success/failure presentation and focus restoration. Existing request/command ownership retained. |
| `react/src/staff/requests/RequestResults.jsx` (new)     | Semantic table/mobile cards over existing list data, sort controls and one Manage Request link.                                                                                                                  |
| `react/src/staff/requests/RequestManagement.jsx`        | Requester/Work presentation sections, existing dialogs, watcher summary only in Work; capability-gated controls.                                                                                                 |
| `react/src/staff/requests/RequestOwnership.jsx`         | Assignment/watcher/search/removal labels only.                                                                                                                                                                   |
| `react/src/staff/requests/WorkflowNarrativeForm.jsx`    | Place on Hold capitalization only.                                                                                                                                                                               |
| `react/src/staff/requests/SubmittedInformation.jsx`     | Optional embedded section/heading presentation; protected load unchanged.                                                                                                                                        |
| `react/src/attachments/Attachments.jsx`                 | Optional embedded Request Evidence section/heading only; Collaboration composer/list unchanged.                                                                                                                  |
| `react/src/staff/requests/staffRequests.css`            | Appended F058.2B responsive workspace, result-card/table and footer styles only; baseline CSS retained.                                                                                                          |
| `react/test/WorkspaceRefinement.test.jsx` (new)         | Before/after call budgets, section order, protected late-response isolation, URL round trip and responsive-data reuse.                                                                                           |
| `react/test/StaffRequestWorkspace.test.jsx`             | Presentation assertions updated while retaining mutation/security/race coverage; disappearing-action focus assertion.                                                                                            |
| `react/test/RequestManagement.test.jsx`                 | Exercise split Requester/Work composition with existing explicit-dialog tests.                                                                                                                                   |
| `react/test/IntakeUxRefinement.test.jsx`                | Existing filter/query/page-size regression assertions updated for the approved labels, count footer and single Manage Request action.                                                                            |
| `react/test/RequesterHistory.test.jsx`                  | Exercise the existing lazy history/contact/focus tests in the Requester section; no eligibility change.                                                                                                          |
| `react/test/StaffLiveSearch.test.jsx`                   | Human labels/count/footer assertions; query, debounce and race semantics retained.                                                                                                                               |
| `docs/features/F058-2-collaboration-workspace.md`       | Ownership inventory, before/after evidence, implementation, validation, allocation and review limitations.                                                                                                       |

### F058.2B validation and review evidence

The final focused invocation passes **282 tests in nine files**, including Collaboration/attachments, workspace, management/history, intake/list, live search and the new refinement coverage. No timeout threshold changed and no sleeps were added. Protected request A → B tests abort late Contact, Submitted Information, Communication and full Activity responses and verify they cannot appear on B. Existing revocation, assignment/watcher, stale revision, single-flight, routing/narrative and access-loss checks remain in the suite. New uncertain-result tests verify factual language and that Try again performs an authoritative detail read without replaying the command. A successful command followed by a failed refresh has separate truthful wording. Existing 409 behavior refreshes authoritative state and asks staff to review before trying again; it neither merges nor resubmits a draft.

Before/after frontend call counts are unchanged: eight initial detail repository calls in the documented configuration, and two list calls (list/options) with zero per-result detail calls. Synthetic browser instrumentation independently observes the same eight-call detail profile. No Contact, answers, requester-history, target-discovery or unselected-stream call occurs before its explicit action. These are repository-boundary measurements, not a new live network benchmark. Existing PostgreSQL tests retain exactly eight list queries for 20/200/2,000-request datasets and page sizes 25/50/100, and for Communication/Notes query counts at 0/1/25/26 records plus older pages. SQL authorization, bounded pagination and query projections are unchanged.

**48 synthetic responsive cases pass:** 24 workspace cases (PUBLIC/INTERNAL × light/dark × 1440×1000, 1280×900, 1024×768, 768×1024, 390×844 and 1280×500); 12 list cases (same sizes/themes); and 12 lifecycle/identity cases (open/in_progress/on_hold/closed × anonymous/assigned/read-only at 390 px). Long descriptions/titles, neutral saved conversation cards, privacy guidance, authoritative counts, single mobile Manage Request actions and usable pagination were checked. No horizontal overflow or browser page error was observed. Desktop Collaboration retains a broad column; Activity sits below Work without an artificial oversized gap. Work exposes no unavailable mutating action in the read-only case.

Supplemental short-height keyboard checks pass for explicit Contact loading, safe dialog entry, forward/reverse containment, Escape cancellation, trigger focus restoration and arrow-key Collaboration switching. Field-label and duplicate-ID checks pass for both audiences. Existing focused tests cover draft access loss and stream fallback. These are accessibility-oriented checks, **not WCAG certification**. Human visual acceptance is still pending.

The ignored local preview is `http://127.0.0.1:5198/__f0582b` (add `?audience=internal&theme=dark`, `?list`, `?anonymous`, `?assigned`, `?readonly` or `?status=on_hold`). It mounts production presentation against fictional in-memory reads; it has no live API or mutation operations. Screenshot artifacts are excluded under `.local-uat/f0582b-*.png`: desktop light, desktop dark, tablet, 390 px light/dark, short-height and mobile/desktop list examples. These are synthetic review cases, not authenticated UAT; mutation controls must not be used as an authorization test in this preview.

Validation history is retained rather than rewritten:

| Invocation                      | Result and correction                                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before-layout baseline          | 3/3 passed.                                                                                                                                                          |
| Initial four-file targeted run  | 97 passed / 67 failed; old labels/layout assertions and a new sibling-key collision. Distinct keys restored component identity.                                      |
| Second targeted run             | 152 passed / 12 failed; old layout/copy assertions plus missing footer whitespace.                                                                                   |
| Third targeted run              | 167 passed / 5 failed; count announcement, sort-label and new-test whitespace/empty-query expectations corrected.                                                    |
| Seven-file focused run          | 265/265 passed.                                                                                                                                                      |
| Focus/Watcher follow-up         | 264 passed / 1 failed; Watcher type label assertion corrected.                                                                                                       |
| First complete React invocation | 738 passed / 8 failed, 746 total; six older intake/list presentation assertions and two RequesterHistory tests still mounting the former combined panel. No timeout. |
| Expanded focused review         | 275 passed / 7 failed; Requester section/copy setup and missing error-message prop wiring corrected.                                                                 |
| Final focused run               | 282/282 passed across nine files, including two new uncertain-result tests.                                                                                          |

The synthetic preview initially failed to compile because its scratch harness used deprecated Vite `transformWithEsbuild`; changing only that ignored harness to the installed Vite `transformWithOxc` resolved it. No dependency or product build configuration changed. The CSS formatting checker initially treated the separator blank line before the appended tail as a formatting failure; canonical comparison proves the existing CSS prefix is byte-for-byte retained, the new tail is formatted, and formatting the complete file produces only the documented baseline differences.

### Initial F058.2B working-tree validation (historical 748-test checkpoint)

Final complete React rerun: **748 passed, 0 failed, 54 files**, 236.88 seconds. No timeout or isolated retry was needed for this invocation. The earlier 738/8 invocation remains recorded above. Thirteen new refinement tests bring the baseline React count from 735 to 748; reruns are not double-counted.

| Final gate                            | Result                                                    |
| ------------------------------------- | --------------------------------------------------------- |
| Backend unit                          | 320 passed, 0 failed / skipped                            |
| API E2E                               | 41 passed, 0 failed / skipped                             |
| PostgreSQL integration                | 578 passed, 0 failed / skipped                            |
| Shared                                | 64 passed, 0 failed / skipped                             |
| Full React                            | 748 passed, 0 failed                                      |
| Distinct test total                   | **1,751**                                                 |
| Supplemental focused React            | 282 passed (subset of the full React suite)               |
| Supplemental responsive/light-dark    | 48 synthetic cases passed                                 |
| Keyboard/focus and field-label checks | Passed; accessibility-oriented only                       |
| TypeScript / backend production build | Passed                                                    |
| Configured backend lint / formatting  | Passed; no frontend lint script exists                    |
| Frontend production build             | Passed; existing large-chunk warning retained             |
| Changed-content canonical formatting  | Passed; baseline CSS formatting condition retained        |
| Whitespace                            | Passed                                                    |
| Local documentation links             | 32 checked; no missing targets                            |
| Private-value review                  | No findings in added/changed source or proposed artifacts |

Validation used the repository's installed TypeScript, ESLint, Prettier, Vite and Vitest tools: test TypeScript compilation; Node test suites from `server/dist-test/test/unit`, `e2e` and `database`; the root shared suite; `vitest run --config vitest.config.mjs --maxWorkers=1`; and `vite build react --outDir ../dist-react --emptyOutDir`. Backend tests used the established development deployment profile and disposable test database, with live `DATABASE_URL` excluded from the test process. No migration was applied live. The existing module-type diagnostic from `calendarDate.js` and Vite chunk-size warning remain; neither was hidden or corrected through unrelated configuration changes.

All **346 backend-file fingerprints** match the accepted pre-refinement baseline, including Migration 40. The new CSS is appended; the pre-existing file prefix and its formatting condition are preserved without unrelated normalization. The final private-value and hunk review found only the 15 files listed above; screenshots, preview harnesses and logs remain ignored local artifacts.

Git remains `main`, HEAD and local `origin/main` both `114d3814306d45fa8391c93d7045fe650b8e6e1d`, **0 ahead / 0 behind** against that tracking reference. No fresh remote synchronization claim is made. There are 13 modified tracked files and two new source/test files, all unstaged; the index is empty and there is no new commit. **Stop for manual visual review before staging or committing.**

### F058.2B safety and deferred work

No staging, commit, push, deployment, live mutation, provisioning or live fixture operation is authorized here. Migration inventory stays 40; Migration 40 remains unapplied to live development, with 39 applied / 1 pending and 60 tables confirmed by a read-only transaction. The live attachment-protection function fingerprint matches the retained pre-Migration-40 checkpoint. This is not a fresh all-table fingerprint assertion. All backend and migration source files are unchanged. ADR-024 remains **Proposed**.

Synthetic preview evidence is presentation/test evidence, not authenticated UAT. Manual visual approval and any later authenticated request mutation are separate gates. Outbound Requester Communication delivery, INTERNAL requester self-service, named INTERNAL requester projection, provider integrations, SLA/escalation, bulk operations and analytics/dashboard work remain deferred. F058.3 and other features are not started. F058.2B is not committed or synchronized, and F058 as a whole is not declared complete.

## Historical F058.2A checkpoints

Starting synchronized baseline: `cc5439c8c48e574e9c5f82f51c2cc1e93147c726`.

Status: **F058.2A locally validated; single local commit approved**. Live migration, authenticated mutation UAT and synchronization remain separate approval gates. F058.2B has not started. No live mutation, provisioning, push or deployment is authorized. Earlier unstaged checkpoints below are retained as historical validation evidence.

## INTERNAL attachment finalization and Migration 40

The earlier read-only design assessment that no migration was needed was incomplete. Disposable PostgreSQL validation found that migration 23, `20260923000000-add-secure-attachments.ts`, defines `protect_attachment_batch()` with an explicit PUBLIC-only guard for REQUESTER_COMMUNICATION finalization. The then-new INTERNAL attachment test received HTTP 500 at finalization. The application eligibility extension cannot override this database guard safely.

The user approved the narrow forward correction after read-only design review. Migration 40, `20261010000000-extend-internal-communication-attachments.ts`, replaces only `protect_attachment_batch()` with an Organization-matched PUBLIC/INTERNAL communication predicate. Composite parent foreign keys and all other guards remain unchanged. No core correspondence redesign, new table/index/constraint, backfill or permission change is introduced. Migrations 1–39 remain unchanged. Migration 40 is tested only in disposable schemas; it has not been applied to the live development database.

Up uses a five-second lock timeout and a write-excluding batch lock. Down locks request before batch and refuses retained STAGED or FINALIZED INTERNAL communication batches, without deleting or rewriting history. With no incompatible batches, down restores the exact Migration 23 function. These are transactional maintenance operations, not wait-free runtime operations. Requester activity remains application eligibility rather than a volatile trigger condition.

The remaining sections describe the uncommitted F058.2A implementation. Automated validation and synthetic responsive review are recorded below; authenticated mutation UAT remains unauthorized.

## F058.2A — Collaboration eligibility and semantics

The existing communications endpoints and immutable storage now support eligible INTERNAL self-service requests. No parallel API or permission key is introduced. Migration 40 aligns attachment structural integrity only. Internal Notes remain independently authorized.

The persisted INTERNAL request must be identified, link its requester and submitter to the same valid staff identity within its Organization, and have an active requester for a new message. Channel, Contact, handler identity, tracking and the F050 PUBLIC requester link do not establish eligibility. Invalid attribution fails closed. Authorized history remains readable after requester inactivity; reactivation can restore new-write eligibility. No recipient identifier or directory name/email is added to ordinary detail.

One SQL eligibility expression is reused by the communication parent query, attachment admission/finalization and server detail capabilities. Capabilities are advisory: mutations and protected child reads retain F058.1 Organization/access-state shared coordination, fresh trusted actor permissions/memberships, parent locking and current scope checks. Supported authorization writers serialize before or after that barrier. No automatic consequential retry is added.

PUBLIC behavior remains compatible: anonymous new messages/attachment staging are prohibited, while authorized historical reads remain available. Tracking and F050 history remain PUBLIC-only. Wrong-audience parent authority is rejected through the scoped parent lookup; an actor with only the other audience's read permission receives a safe unavailable response.

Existing communication grants now apply to eligible INTERNAL requests **only when their holders independently have INTERNAL parent read and operational scope**. F057 metadata removes PUBLIC read as a universal dependency; create still requires communication read. Parent authority is contextual, following the existing Notes pattern. Keys, sensitivity, manageability, grants, presets and ownership are unchanged. Deploying this code does not grant access or mutate authorization state.

Messages and Notes retain separate immutable bodies and author display snapshots, plain text, 4,000 UTF-16-code-unit input limits, bounded newest-first history and request/author submission-key replay/conflict handling. Append writes and metadata-only security audit are atomic. Communication listing does not acquire a new disclosure audit. Neither stream changes parent revision/operational updated time or creates operational Activity entries.

Attachment contexts remain distinct: REQUESTER_COMMUNICATION, INTERNAL_NOTE and REQUEST_EVIDENCE. Finalization revalidates requester eligibility in addition to existing actor, parent, scope, ownership, context and integrity rules. Existing five-image, 5 MiB/file, 15 MiB total, JPEG/PNG/WebP, image bounds and metadata-removal behavior remains unchanged. The development scanner remains a stub, visibly separate from ordinary guidance; current production/development feature gates remain authoritative.

## Collaboration presentation

Only readable streams appear. PUBLIC defaults to Requester Communication when available; INTERNAL defaults to Internal Notes. The other readable stream is the fallback; neither readable means no Collaboration card. Only the selected stream loads initially. Tab switching preserves authorized in-memory drafts; permission loss removes inaccessible streams, aborts responses and restores focus to an available tab or workspace heading. No polling or persistent draft storage is introduced.

The visible tab order follows the audience: INTERNAL shows Internal Notes then Requester Communication; PUBLIC shows Requester Communication then Internal Notes. Unreadable streams are omitted without changing that order.

Requester Communication uses a prominent non-alert information/privacy panel:

> Messages added here are intended for the requester.
> Reqro records these messages, but does not currently send them to the requester.
> Do not include staff-only or sensitive information.

The composer is “Message to Requester”; the action remains “Add Message”; records say “Recorded in Reqro.” Inactive-requester history explains why new messages cannot be added. Internal Notes now has a matching ordinary information panel:

> Internal Notes
> Internal notes are visible only to authorized staff.
> Use them for internal updates, troubleshooting, and coordination.
> Avoid entering sensitive information.

Saved entries use a consistent single-column case-history surface, with a prominent immutable author display snapshot, secondary localized timestamp, comfortably spaced plain-text body and associated saved attachments. Notes identify themselves as “Internal Note”; communication uses “Recorded in Reqro”, without delivery claims. Existing newest-first order, timestamp semantics, focus targets and protected attachment behavior are preserved. Refresh controls remain secondary and do not poll.

The Collaboration attachment picker is compact and explicitly optional. It shows “JPEG, PNG or WebP · Up to 5 images · 5 MiB each”; a collapsed “Attachment details” disclosure contains the 15 MiB total and metadata-removal explanation. Selected files show wrapping filenames, readable sizes, named remove actions and an “X of 5” count. Stream-specific privacy guidance stays concise. The separate, smaller “Development environment” notice still says “Use fictional images only. Malware detection is not enabled.” Errors remain prominent. The presentation prop defaults off for other attachment consumers; upload, validation, limits and submission behavior are unchanged.

Internal Notes guidance and both attachment privacy callouts use an information-colored background and leading border, clearly distinct from neutral saved entries. They are ordinary named informational content, never alerts or warning/error styling. Beneath Attachments / Optional, the requester callout reads “Requester-visible attachments”, “Attachments added here are intended for the requester.” and an emphasized “Do not include staff-only or sensitive information.” The equivalent Notes callout reads “Staff-only attachments” and “Attachments added here are visible only to authorized staff.” Technical helper text remains secondary, and the development notice remains separate. The parent communication panel still explicitly explains that delivery is not enabled; the callout does not add delivery or requester self-access capability.

## Deliberately deferred

F058.2B will reorganize the existing full-page workspace into Overview, Request Details, Requester, Work, Collaboration and Activity after A is reviewed. It must preserve explicit protected Contact/answer reads and existing operational semantics.

INTERNAL requester self-view, named requester/submitter disclosure, INTERNAL assisted intake, rich text, mentions, editing/deletion, notifications and outbound delivery are not implemented. The requester relationship does not confer handling authority. “Recorded” does not mean delivered, viewed or readable by the requester.

Future provider-neutral delivery requires separately approved destination authority, channels, queueing/retries, failures, truthful delivery states, privacy, secrets, audit and communication preferences. It is distinct from a future requester self-service surface and is not part of F058.2.

## Validation and UAT gate

Automated validation uses disposable synthetic data. The final review report records exact suite counts, failures/retries, query counts, responsive checks and static/build results. No changed timeout or fabricated passing result is permitted.

Authenticated mutation UAT remains pending. Before any Add Message/Add Note, separately review the synthetic target and actor, effective parent/communication/Notes permissions and memberships, expected immutable record, and unchanged parent-state consequences. Missing authority requires a separate provisioning dry-run and approval. Inactive-requester cases should use disposable tests; no real identity is deactivated for visual UAT. UAT records must not be deleted afterward.

Migrations 1–39 remain unchanged; Migration 40 is present but not applied to live development. [ADR-008](../architecture/decisions/ADR-008-requester-communication.md) retains its historical decision with a dated amendment. [ADR-024](../architecture/decisions/ADR-024-transaction-time-request-authorization.md) remains Proposed.

## Proposed F058.2A commit allocation

One approved coherent 30-file local commit from `cc5439c8c48e574e9c5f82f51c2cc1e93147c726`: `feat(requests): extend requester communication to internal requests`. The original 23 files are retained, with six necessary additions to scope: Migration 40, its dedicated PostgreSQL proof, the ADR-010 cross-reference, the existing attachment React regression test updated for the approved PUBLIC default tab, and the frontend repository projection plus its tests. The final presentation refinement increases the previous 29-file allocation to 30 by adding changes to the existing Internal Notes test file; its other changes stay within that allocation. F058.2B is excluded.

- [docs/architecture/decisions/ADR-008-requester-communication.md](../architecture/decisions/ADR-008-requester-communication.md)
- [docs/architecture/decisions/ADR-010-secure-attachment-architecture.md](../architecture/decisions/ADR-010-secure-attachment-architecture.md)
- [docs/features/F058-2-collaboration-workspace.md](F058-2-collaboration-workspace.md)
- [react/src/attachments/Attachments.jsx](../../react/src/attachments/Attachments.jsx)
- [react/src/staff/requests/CollaborationPanel.jsx](../../react/src/staff/requests/CollaborationPanel.jsx)
- [react/src/staff/requests/InternalNotes.jsx](../../react/src/staff/requests/InternalNotes.jsx)
- [react/src/staff/requests/RequestCommunication.jsx](../../react/src/staff/requests/RequestCommunication.jsx)
- [react/src/staff/requests/requestRepository.js](../../react/src/staff/requests/requestRepository.js)
- [react/src/staff/requests/staffRequests.css](../../react/src/staff/requests/staffRequests.css)
- [react/test/Attachments.test.jsx](../../react/test/Attachments.test.jsx)
- [react/test/CollaborationPanel.test.jsx](../../react/test/CollaborationPanel.test.jsx)
- [react/test/InternalNotes.test.jsx](../../react/test/InternalNotes.test.jsx)
- [react/test/RequestCommunication.test.jsx](../../react/test/RequestCommunication.test.jsx)
- [react/test/StaffRequestRepository.test.js](../../react/test/StaffRequestRepository.test.js)
- [react/test/StaffRequestWorkspace.test.jsx](../../react/test/StaffRequestWorkspace.test.jsx)
- [server/migrations/20261010000000-extend-internal-communication-attachments.ts](../../server/migrations/20261010000000-extend-internal-communication-attachments.ts)
- [server/src/access/access-policy.ts](../../server/src/access/access-policy.ts)
- [server/src/attachments/attachment.service.ts](../../server/src/attachments/attachment.service.ts)
- [server/src/service-request/internal-request.repository.ts](../../server/src/service-request/internal-request.repository.ts)
- [server/src/service-request/request-communication-policy.ts](../../server/src/service-request/request-communication-policy.ts)
- [server/src/service-request/request-communication.controller.ts](../../server/src/service-request/request-communication.controller.ts)
- [server/src/service-request/request-communication.service.ts](../../server/src/service-request/request-communication.service.ts)
- [server/src/service-request/staff-request-policy.ts](../../server/src/service-request/staff-request-policy.ts)
- [server/test/database/attachment-checks.ts](../../server/test/database/attachment-checks.ts)
- [server/test/database/internal-communication-attachments.integration.test.ts](../../server/test/database/internal-communication-attachments.integration.test.ts)
- [server/test/database/request-authorization-checks.ts](../../server/test/database/request-authorization-checks.ts)
- [server/test/database/request-communication-checks.ts](../../server/test/database/request-communication-checks.ts)
- [server/test/unit/request-communication-policy.test.ts](../../server/test/unit/request-communication-policy.test.ts)
- [server/test/unit/request-communication.service.test.ts](../../server/test/unit/request-communication.service.test.ts)
- [server/test/unit/staff-request-policy.test.ts](../../server/test/unit/staff-request-policy.test.ts)

## Validation evidence and retained failures

Migration 40 isolated proof: 16 passed, zero failures/skips. The initial new synthetic fixture omitted the existing required Issue availability value; that test setup was corrected without a migration/product workaround. The successful proof uses the real Kysely ledger, validates 39 → 40 → 39 → 40, compares the exact function body and trigger bindings (including function OIDs), and preserves all application rows including a PUBLIC attachment finalized at Migration 39, columns, indexes and constraints. Both staged and finalized INTERNAL batches refuse downgrade transactionally. Disposable schemas contain 40 ledger entries and 60 tables after up.

The previous PostgreSQL invocation (557 passed / 2 failed) remains historical evidence of the Migration 23 blocker. The first complete invocation after Migration 40 passed 578 / 578 with no skips, including the normal INTERNAL attachment creation path. The final rerun also covers retained attachment downloads after requester inactivity and compares trigger function OIDs. No live database was used for these migration proofs.

The earlier unit result (319 passed / one outdated capability assertion) was not a pass. The complete corrected unit rerun passed 320 / 320. F057 metadata coverage confirms unchanged keys, sensitivity and manageability, contextual parent authority, and create requiring communication read.

React evidence is retained without combining retries into the original invocation. Earlier partial-implementation runs also remain recorded: the seven-file focused run had 249 passed / 14 failed; the next workspace/Collaboration run had 137 passed / 6 failed; the subsequent corrected workspace/Collaboration rerun passed 143 / 143. Those results are supplemental historical evidence, not additional distinct tests.

Final implementation runs:

- Initial full invocation: 718 passed / 2 failed, 53 files. Issue Creation hit its existing five-second timeout during concurrent validation. The attachment regression still assumed PUBLIC opened on Notes, contrary to the approved new default.
- Targeted Issue Creation/Attachments invocation: 48 passed / 1 failed. All 17 Issue Creation tests passed at the unchanged timeout. After selecting Notes explicitly, the attachment test exposed an unscoped file-input query against two mounted streams.
- Attachment regression correction scopes selection to the active panel, preserving the draft-isolation assertions; its isolated rerun passed all 32 tests.
- Serial full React invocation before the final repository-projection correction: 720 passed / 720, 53 files, zero failures, 262.11 seconds. No timeout increase or sleep was introduced. This passing rerun does not rewrite earlier failed runs.

Synthetic browser validation used the production Collaboration components with a fictional in-memory repository and no live API. Both streams passed at 1440×900, 1280×800, 1024×768, 768×1024, 390×844 and 1280×500, in light and dark themes: 24 layout cases, no horizontal overflow or browser errors, plus 12 keyboard tab-selection cases. Mobile dark and short-height light/inactive-requester rendering were visually inspected. Inactive history retained the record-only notice and omitted Add Message. Component tests cover capability loss, late-response aborts, focus restoration and independent drafts. These are synthetic accessibility-oriented checks, not authenticated UAT or WCAG certification.

Canonical formatting preserves a demonstrated baseline limitation in `staffRequests.css`: lines 31–32 and the compact existing rules around 823–831 already fail the formatter at the parent. The new appended rules pass independently, and formatting the current file introduces exactly the same legacy changes as formatting the parent. No unrelated formatting churn was applied. Configured backend formatting passes.

The existing frontend chunk-size warning and module-type warning remain. No frontend lint script exists; configured backend lint is the applicable lint gate.

Final data-flow review found that the frontend repository was dropping the new capability reason. The correction allowlists only anonymous/requester_inactive/unavailable reasons for readable, non-creatable communication; unknown values and identifiers are discarded. New repository/component coverage passes through the real projection. Two initial focused attempts were 26 passed / 1 failed because the new synthetic detail fixture omitted required existing projection fields; completing that fixture produced 27 / 27 passing tests without weakening projection validation. The final complete React rerun after this correction passed 729 / 729 across 53 files, zero failures, in 250.37 seconds at unchanged timeouts. The previous 720-test full pass remains evidence of the earlier tree, not the final tree.

The real repository plus production Collaboration components also passed 12 additional synthetic inactive-requester browser cases across all six viewports and both themes. The explanation remained visible, Add Message remained absent, and there were no browser errors or horizontal overflow.

## Accepted validation checkpoint before the final presentation refinement

| Gate                               | Final result                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| Backend unit                       | 320 passed, 0 failed, 0 skipped                                                          |
| API E2E                            | 41 passed, 0 failed, 0 skipped                                                           |
| PostgreSQL integration             | 578 passed, 0 failed, 0 skipped; final strengthened proof included                       |
| Shared                             | 64 passed, 0 failed, 0 skipped                                                           |
| Full React                         | 729 passed, 0 failed, 53 files                                                           |
| Isolated migration proof           | 16 passed; already included in PostgreSQL total                                          |
| TypeScript/test compilation        | PASS                                                                                     |
| Configured backend lint            | PASS                                                                                     |
| Backend/frontend production builds | PASS; existing frontend chunk warning retained                                           |
| Formatting                         | Backend PASS; changed canonical content PASS with the documented baseline CSS limitation |
| Whitespace                         | PASS                                                                                     |
| Local documentation links          | 45 resolved, no broken targets                                                           |
| Private-value review               | PASS; no private credentials/provider identifiers added                                  |

The five complete suite totals are 1,732 tests by runner counts, without adding isolated proofs or reruns again. The final PostgreSQL invocation completed in 110.39 seconds. The normal production-path INTERNAL attachment test passes with the real guard enabled; requester inactivity preserves authorized message history and attachment download while rejecting new messages. Existing context, parent, scope, scan, expiry, immutable audit and rollback tests pass. F058.1 race coverage retains both orderings for permission, Department/Division, actor, Organization and requester changes. History query counts remain 9/9/9/9/9 at 0/1/25/26/older for PUBLIC communication, INTERNAL communication and Internal Notes; this is the tested service path, not a production latency claim.

Migration 40 adds no runtime row locks or requester/actor/permission lookup. Existing request/communication primary and composite indexes remain unchanged. The migration adds no grants, roles, memberships, access-state revision or bootstrap change. Both rollback refusal cases preserve the function, ledger and all retained application data. Up/down/reapply preserves the existing PUBLIC attachment, function bindings and all non-target schema objects.

At that checkpoint Git remained `main`, HEAD and local `origin/main` at `cc5439c8c48e574e9c5f82f51c2cc1e93147c726`, 0 ahead / 0 behind against that tracking reference. All 29 files were unstaged and uncommitted. The original 23-file work was preserved and completed rather than reset. Exactly one new migration existed; Migrations 1–39 were unchanged.

Database tests used loopback `reqro_test` with disposable schemas; the harness did not forward live `DATABASE_URL`. Migration 40 was not applied to live development, and no live request/access mutation, provisioning, fixture operation, push, deployment or cloud change occurred. This is not a fresh live-table fingerprint verification. No INTERNAL requester self-view, outbound delivery or F058.2B work was introduced. ADR-024 remains Proposed. Stop for review before staging or committing.

## Final Collaboration presentation refinement

This continuation changes only Collaboration presentation, its React tests and this review record. SHA-256 comparison of all 346 tracked/nonignored backend files against the start of the refinement found no changed, added or missing backend files. That includes the accepted Migration 40 implementation. Migrations 1–39 still have no Git diff.

The first focused invocation passed 237 tests and failed two new history-card tests because their synthetic repository lacked the existing attachment-policy method. Completing that mock produced 239 / 239 passing tests across five files. No production capability or validation was weakened. The subsequent small-file-size display refinement is covered by the complete final React invocation below. Earlier validation failures above remain historical evidence and are not rewritten as passes.

Synthetic browser checks use the real repository projection and production Collaboration components with fictional in-memory responses. All 48 layout cases passed: both streams, normal and long unbroken content, six viewports (1440×900, 1280×800, 1024×768, 768×1024, 390×844, 1280×500), and light/dark themes. There was no horizontal overflow or browser error. Saved attachments remained associated with their entry; selected-file removal, file selection, attachment disclosure and Add Note/Add Message controls remained reachable. No Add Note/Add Message or upload action was executed. Mobile dark long-content and desktop light normal-content rendering were visually inspected. Twenty-four keyboard Home-selection checks passed; an additional mobile dark check verified End selection, empty messages and themed secondary Refresh styling. The existing component tests retain arrow/Home/End behavior, capability-loss focus restoration, append-history focus and composer focus. This is accessibility-oriented synthetic validation, not authenticated UAT or WCAG certification.

Temporary browser-harness setup initially failed to load because of a generated-string escape; the harness was corrected before these checks. This was not a production rendering failure. The synthetic preview server was stopped after validation.

### Final refined-tree validation

| Gate                               | Result                                                     |
| ---------------------------------- | ---------------------------------------------------------- |
| Backend unit                       | 320 passed, 0 failed, 0 skipped                            |
| API E2E                            | 41 passed, 0 failed, 0 skipped                             |
| PostgreSQL integration             | 578 passed, 0 failed, 0 skipped; 104.04 seconds            |
| Shared                             | 64 passed, 0 failed, 0 skipped                             |
| Full React                         | 732 passed, 0 failed, 53 files; 228.47 seconds             |
| TypeScript/test compilation        | PASS                                                       |
| Configured backend lint            | PASS                                                       |
| Backend/frontend production builds | PASS                                                       |
| Canonical formatting               | PASS for changed content; same pre-existing CSS limitation |
| Whitespace                         | PASS                                                       |
| Local documentation links          | 46 resolved, no broken targets                             |
| Private-value review               | PASS; no private credentials/provider identifiers added    |

The five complete suites total **1,735 tests**, without counting the focused rerun or Migration 40 proof twice. The full React invocation passed at existing timeouts; no sleep or timeout increase was added to tests. The existing frontend chunk-size and Node module-type warnings remain. There is no configured frontend lint script. Formatting did not normalize unrelated legacy CSS.

Final allocation is exactly the 30 files listed above: three documentation files, six frontend implementation files, six React test files, one migration, seven backend implementation files and seven backend test files. Git remains `main`, with HEAD and local `origin/main` at `cc5439c8c48e574e9c5f82f51c2cc1e93147c726`, 0 ahead / 0 behind against that tracking reference, nothing staged and no new commit. Ignored `.local-uat` evidence is excluded from the proposed allocation.

Backend tests used only the configured loopback disposable test database; the harness excluded live `DATABASE_URL`. No live database mutation or fresh live-table fingerprint claim is made. Migration 40 remains unapplied to live development. There was no provisioning, fixture activity against live development, push, deployment or cloud change. F058.2B remains unstarted and ADR-024 remains Proposed. Stop for review before staging or committing.

### Final privacy-callout adjustment

The follow-up presentation review replaces the neutral Internal Notes guidance treatment with the shared information/privacy surface, keeping its wording unchanged and saved entries neutral. Both attachment composers now contain a named compact privacy callout directly beneath the legend. Requester guidance emphasizes the sensitive-information restriction. Technical details remain secondary and the development notice remains separate. No authorization, selection, upload or submission code changed.

Audience-specific tab ordering, preferred defaults and readable-stream fallback already matched the approved behavior. Production tab logic was left unchanged. Tests now explicitly assert both audience orders and cover all readable-stream combinations for both audiences. The focused Collaboration, Attachments, Internal Notes and Requester Communication run passed 107 / 107 across four files at unchanged timeouts.

The updated presentation passed 48 synthetic browser cases: both streams for both audiences, six requested viewports and both themes, with long unbroken content. Computed styles confirm the guidance and attachment callouts differ from neutral saved entries. Each case exercised file selection/removal, keyboard disclosure and composer control reachability, with zero horizontal overflow or browser errors. All 24 audience/theme/viewport combinations passed Home/End tab selection. Mobile dark Internal Notes and desktop light requester-attachment callouts were visually reviewed. The preview used only fictional in-memory responses; no upload or Add Note/Add Message occurred. The preview browser and server were stopped afterward.

The proposed file allocation remains exactly 30, with no new file entering the boundary. All 346 backend-file fingerprints still match the accepted pre-refinement state, including Migration 40. Earlier validation evidence remains retained above; the complete follow-up results are recorded below without double-counting retries.

| Follow-up final gate                                           | Result                                            |
| -------------------------------------------------------------- | ------------------------------------------------- |
| Backend unit                                                   | 320 passed, 0 failed, 0 skipped                   |
| API E2E                                                        | 41 passed, 0 failed, 0 skipped                    |
| PostgreSQL integration                                         | 578 passed, 0 failed, 0 skipped                   |
| Shared                                                         | 64 passed, 0 failed, 0 skipped                    |
| Full React                                                     | 735 passed, 0 failed, 53 files; 210.31 seconds    |
| TypeScript/test compilation, configured backend lint           | PASS                                              |
| Backend/frontend production builds                             | PASS                                              |
| Changed canonical formatting, whitespace, private-value review | PASS; same documented pre-existing CSS limitation |
| Local documentation links                                      | 46 resolved, no broken targets                    |

The final complete suites total **1,738 tests**, without counting the 107 focused tests or earlier invocations again. Three additional PUBLIC readable-stream cases explain the increase from the previous 732-test React checkpoint to 735. No test failure or retry occurred in this follow-up. Existing frontend chunk and Node module-type warnings remain; no frontend lint script exists. No timeouts were changed.

Git remains `main` at `cc5439c8c48e574e9c5f82f51c2cc1e93147c726`, matching local `origin/main`, 0 ahead / 0 behind against that tracking reference. All 30 files remain unstaged and uncommitted. No live database was mutated; Migration 40 remains unapplied live. No provisioning, live fixture activity, push, deployment, cloud changes or F058.2B work occurred. Stop before staging or committing.
