# F069.2 — Department read-only frontend integration

## Scope and activation boundary

Baseline: `81620bf103b8dfab2b2a4c7da5481c19f76ec82f` (reviewed F069.1).
Implemented in the isolated `codex/f069-departments-read-ui` worktree. No backend,
production migration, permission, authentication provider or tenant-selection
contract changes. F069 fictional preview code remains intact.

Live reads are **disabled by default**. `DepartmentWorkspace` requires both Vite
`DEV === true` and `VITE_DEPARTMENT_READ_ENABLED === "true"`. Production builds
cannot enable this gate. No environment file is added and no feature is activated
by this task. Setting the development flag, signing in, and authenticated UAT
require separate authorization. No new deployment/production toggle is provided.

## Data and authority

Administration passes its existing authenticated client after configuration-read
admission. The existing Entra route guard remains in place. All four Department
routes use `client.get` with `authenticated: true` and an AbortSignal. URL paths
are relative to the existing `/api/v1` client base. Organization identifiers are
neither accepted nor sent. Server-side `admin.configuration.read` and derived
Organization authority remain authoritative.

The dedicated adapter accepts only approved query keys, statuses, sort columns,
directions and bounded page sizes. Search is encoded as a literal value. It
validates complete response shapes, UUIDs, nullable fields, statuses, integer
counts, pagination echoes, total/item consistency and unique item IDs. Detail IDs
and relationship parent IDs must match the request. Unexpected fields are refused
rather than rendered; additive API projection changes therefore need a deliberate
adapter update. Generic UI errors never display server diagnostics.

Fictional and live components have separate state trees. The preview never receives
the client or tenant records. Live failures never select preview mode. No writes,
local preview saves, token storage, persistent caching or localStorage are added.
Client or authentication-context changes replace the entire live session before
old records can render. Reauthorization unmounts live data; any 401/403 removes
both the directory and details. All obsolete requests are aborted and late results
(including late denials from another session) are ignored.

## Presentation and bounded reads

Directory search submits to the server. Status/sort/direction/page-size changes
reset to page one. Server totals describe current filters across all pages, not a
global status summary. Stable record IDs key the directory and selected detail.
The UI performs no filtering or sorting of a partial page.

Selection reads authoritative detail, Divisions and Categories in parallel. Each
relationship has its own page index (25 rows). Changing a relationship page
refreshes the bounded three-read detail view; this favors coherent loading/error
presentation over retaining stale sibling records. A 404 clears detail content
and offers safe retry/close. Null descriptions and Division links are preserved;
service definitions appear only as counts, explicitly not published-service counts.
No service names or routing information are invented.

Existing themed cards, responsive grids, focus styles and native IssueDrawer are
reused. Labels, status/alert announcements, named pagination, 44px controls,
keyboard opening, Escape close and focus restoration are covered offline. These
checks do not establish browser layout, native zoom or screen-reader acceptance;
authenticated and responsive manual UAT remain required before activation.

## Validation

Tests use synthetic fixtures and mock clients only. Validation results are recorded below. Frontend package scripts contain no lint command or
frontend ESLint configuration; backend lint is not a substitute. No new lint setup
is introduced in this bounded feature.

Completed offline validation:

- Initial focused run: 69/69 passed. Expanded run: 101/101 passed. Final focused run: 103/103 passed across the adapter, live UI, existing fictional preview and Administration tests. These overlap and are not additive totals.
- Frontend production build passed (exit 0), with Vite's existing warning about chunks larger than 500 kB. No deployment occurred.
- Commands invoke the existing Vitest/Vite entry points directly with Node 24.19.0 and the exact package-script arguments: `vitest run --config vitest.config.mjs --maxWorkers=1` and `vite build react --outDir ../dist-react --emptyOutDir`. Dependencies came from the unchanged root lockfile via `npm ci --ignore-scripts`; npm used the host Node 20 runtime and reported an engine warning for a transitive package requiring Node 22+. Installation succeeded; validation uses Node 24.
- Frontend lint is unavailable: there is no frontend lint script/configuration. No lint pass is claimed.
- New-file Prettier checks passed. A broader formatting invocation reported the existing feature index as unformatted. Read-only checks of the exact Git baseline confirmed that both the index and Administration page were already unformatted; unrelated formatting was preserved. The small additions were diff-reviewed. Git whitespace checks passed.

No live feature activation, API connection, Entra sign-in, PostgreSQL/Docker run,
F067 service/worktree operation or persistent configuration change occurred. Only
ignored dependency/build/test logs were generated outside the intended source
and documentation changes. Backend and existing API/authentication code are unchanged.

- Full frontend suite: **1,036/1,036 tests passed across 68 files**, exit 0, no failures or skips. Focused tests are included in this total. The run reported existing module-type warnings for `calendarDate.js`; no package-wide module change was made.
- Final new-file formatting and staged whitespace checks passed before the authorized local commit. No test assertions were weakened, no timeouts changed and no failing test invocation was discarded; all three focused invocations and the full invocation passed.

The implementation is ready for independent review, not live activation.
Authenticated Entra UAT must separately verify account/tenant transitions,
permission denial, actual API errors, keyboard/screen-reader behavior, native zoom,
and narrow/light/dark layouts. No production activation mechanism is included.

## F069.3A — focus and narrow viewport correction

The isolated F069.3 browser run reproduced focus loss after closing the native
Department dialog and 15px horizontal overflow at a nominal 320px viewport with
classic scrollbars. The immediate close-handler focus call ran while the native
modal still made its background inert. The global `body` and `.app-shell`
320px minimum widths exceeded the 305px content viewport.

The live directory now records an explicit close request and restores focus in
its effect after the dialog is removed and its cleanup has run. It chooses the
connected original opener, otherwise the connected directory heading. Replacing
or revoking the session unmounts the directory and its restoration effect; no
timer or global callback survives it. Shared IssueDrawer and fictional preview
behavior remain unchanged.

Both existing minimum-width rules now use `min(320px, 100%)`, retaining the
existing floor where it fits and yielding to narrower containing blocks. No
horizontal-overflow hiding, control-size reduction or broader layout redesign
is introduced. API, authorization, data isolation and the default-disabled
development gate remain unchanged.

Regression coverage adds modal-removal-before-focus assertions for Close and
cancel, missing-opener heading fallback, session replacement/revocation, and
responsive width/wrapping/touch-target contracts. Native dialog behavior must
also pass the isolated browser retest; jsdom is not proof of browser modality.

### F069.3A validation outcome: partial, not committed

The isolated native-browser retest corrected both reported defects. Mouse/Close
and keyboard/Escape returned focus to the exact opener; Tab advanced normally;
removing the opener during a synthetic background refresh restored the directory
heading. Light/dark directory and drawer checks covered 1440x900, 1024x768,
768x1024, 390x844 and 320x720. At 320px, the directory's document scroll width
now equals its 305px content width rather than 320px. Controls retained 44px
minimum heights and the drawer remained usable. The unchanged fictional preview
also fit the narrow viewport. Search, filter, sorting, page-size/pagination,
independent relationship pagination, retry, session clearing and the gate
contract were rechecked using synthetic GET responses only.

Offline results (Node 24.19.0, unchanged assertions/timeouts):

- Two initial default-pool focused invocations were interrupted after stalling without results; neither is a pass.
- An initial six-file thread-pool run had 161 passed and 2 failed (163 total). Both failures were new tests using an unavailable `fireEvent.cancel` helper. The tests were corrected to dispatch the repository's existing native cancel-event pattern; assertions were preserved.
- Full frontend run with `--maxWorkers=1 --pool=threads --no-cache`: **1,038 passed, 4 failed, 68 files**, exit 1. Failures: Issue Creation External Redirect timeout; two Map Preview missing mock-map instances; Intake UX missing expected history/page text. The six new regression cases passed. This is not a clean full-suite pass.
- Nine-file diagnostic rerun using the normal fork pool and `--maxWorkers=1 --no-cache`: **215 passed, 2 failed (217 total)**, exit 1. All 163 Department/Administration/drawer/design-system cases passed, as did Issue Creation and Intake UX. Map Preview still failed (WebGL fallback message and protected-map instance). The isolated rerun does not erase the earlier failures. These outside-scope failures were not repaired or asserted to be pre-existing.
- Production build passed, exit 0, with large-chunk and plugin-timing warnings. Scoped component/test/document formatting and Git whitespace checks passed. Existing global stylesheet formatting was preserved; its two changed declarations were diff-reviewed. No frontend lint script exists; no lint pass is claimed.

Browser: Codex in-app Chromium, user agent Chrome/152.0.0.0. One loopback Vite
process used a temporary harness and process-only feature flag, with no env-file
changes. Audit: 39 fake-client calls, all GET; observed resource destinations
were loopback-only; local/session storage were empty. The audit is resource
observation, not a complete independent HAR. No real API, tokens or sign-in.

Native browser zoom control is unavailable in the exposed browser interface;
100% was not independently read and 200%/400% were not tested. Viewport resizing
is not native zoom validation. Actual screen-reader and authenticated Entra UAT
remain pending. The full suite covered major-page regressions but was not fully
passing; other major pages were not individually visually accepted in this run.

The test server and owned browser tab were stopped, temporary harness removed,
viewport override reset, and port 5186 verified closed. No persistent activation
occurred. The conditional commit gate was not met: these five-file corrections
remain unstaged and uncommitted. No push, PR update, backend, F067, database,
Docker, Entra, Azure or production operation occurred. Re-establish clean offline
validation before creating a passing checkpoint.

### F069.3A diagnostic continuation and local acceptance — 2026-10-21

This supersedes the preceding partial checkpoint's commit decision without
reclassifying its failed invocations. Node 24.19.0 and Vitest 4.1.11 were used.
The controlled full frontend run passed **1,042/1,042 tests across 68 files**,
exit 0, in 262.83 seconds (`--maxWorkers=1 --no-cache`, normal fork pool).
The current-tree focused Map Preview run passed 26/26, exit 0. No redundant full
suite was run for the subsequent documentation and browser acceptance work.

Exact retained failure history:

- `F056.5 External Redirect is configured before one complete Create request`: `Test timed out in 5000ms`, `react/test/IssueCreation.test.jsx:134:1`.
- `API mode authenticates the protected request without a browser Organization hint`: `TypeError: Cannot read properties of undefined (reading 'options')`, `react/test/MapPreview.test.jsx:164:30`.
- `sign-out unmounts already rendered protected data immediately`: `TypeError: Cannot read properties of undefined (reading 'remove')`, `react/test/MapPreview.test.jsx:267:16`.
- `F056.3 approved sizes use server query, reset page and restore URL through history`: `TestingLibraryElementError: Unable to find an element with the text: Showing 51–75 of 327 requests.`, `react/test/IntakeUxRefinement.test.jsx:162:17`.
- The subsequent nine-file diagnostic failed the same API-mode test and `preview keeps warnings, details and list controls available when WebGL fails`: `TestingLibraryElementError: Unable to find an element with the text: /interactive map is unavailable/.`, `react/test/MapPreview.test.jsx:79:25`, through `wait-for.js:163:27` and `query-helpers.js:86:33`. Its DOM still showed the loading state. The other three initial failures passed that invocation.

These comprise a test timeout, two test-body undefined-instance errors and DOM
query failures, not evidence of a shared process or cleanup failure. An isolated
archive of exact baseline `50bd9a8e847f1ce924435dc43f06d174f9f8a42f`
passed Map Preview 26/26 once with forks and three times with threads (each exit
0). Nine relevant Map, setup, theme, configuration and dependency files were
byte-identical. Neither a reproducible regression nor a defective baseline was
established. Waiting for a list button does not explicitly await the MapLibre
passive effect; that readiness assumption is a plausible weakness, not a proved
root cause. Timer/environment restoration and map cleanup were inspected without
a demonstrated leak. No assertions, timeouts or Map source were changed.

Historical failing runs did not record resource or competing-process telemetry.
During controlled validation, CPU snapshots were 15–40% and free physical memory
approximately 3.22–2.63 GiB of 31.8 GiB; these are not peaks. No competing Node
test runner was detected, and runs were sequential. Resource exhaustion or
competition is unproved. Intermittent failures remain a reliability risk; the
clean invocation does not establish permanent resolution or definitive absence
of a relationship to this correction.

Final browser compatibility acceptance used actual AppLayout/SiteHeader,
InternalRequestWorkspace and IssuesPage components with injected synthetic
repositories. Light/dark checks at 1440, 390 and 320 CSS-pixel viewport widths
showed document scroll width equal to content width (1425, 375 and 305px), with
no form controls extending beyond the viewport. Mobile navigation opened and
closed; staff filters applied; Tab moved from Audience to Request View, and
from Issue List Search to Department. Full-page narrow screenshots showed
readable, wrapped result cards, filters, pagination and footer. No clipping
attributable to the minimum-width correction was observed. Body horizontal
overflow remained visible; no blanket overflow suppression was introduced.
This is representative layout acceptance, not exhaustive acceptance of every
application screen or a new contrast audit. Existing adjacent dark-theme
contrast limitations remain outside this correction.

The Department native dialog was rechecked at 320px: Close and Escape restored
the exact `View Synthetic Works` opener. The earlier wider/theme matrix and
missing-opener fallback evidence remain applicable. A temporary fixture first
included extra pagination properties rejected by the strict response adapter;
only that disposable fixture was corrected. No application correction changed.

Browser capabilities expose viewport sizing and visibility, not native zoom.
100% was not independently established; 200% and 400% native zoom remain
untested. Narrow viewport evidence is not zoom evidence. Screen-reader acceptance
and authenticated Entra UAT remain separate requirements, not certified here.
The explicit continuation permits recording unsupported native zoom rather than
claiming a pass; the supported acceptance checks found no new correction defect.

The harness mounted the Department component directly with an in-memory client;
it did not activate live mode or mount AuthRoot. No feature flag or env file was
changed. Its resource audit observed only `http://127.0.0.1:5186`, empty local
and session storage, and no console errors/warnings. This is resource observation,
not a complete HAR. No real API call, Department write or Entra sign-in occurred.
Only the owned browser tab/server were stopped; the exact temporary harness was
removed, viewport override reset, and port 5186 verified closed. Source/test
hashes still match the validated correction. Browser evidence remains outside
Git. The five-file correction is eligible for the authorized local-only commit;
no remote Git/PR, F067, database, Docker, Azure or production changes are included.
