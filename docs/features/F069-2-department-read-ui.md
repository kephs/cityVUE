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
