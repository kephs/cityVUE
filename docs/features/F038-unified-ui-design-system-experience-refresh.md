# F038 — Unified UI Design System & Experience Refresh

Implemented September 20, 2026 from `cf0d0337ca5d9b6206f14269edb7ade8dbc2cf40`. The approved Service Request detail concept establishes the visual direction; its sample content, tree icon, address and logo are not production data or approved production assets. No reference image is stored in the repository. Reqro remains the client-neutral platform direction; the application still presents CityVUE.

## Principles and hierarchy

1. ISSUE BEFORE REFERENCE: the Issue name is the primary operational identity.
2. LOCATION WHEN MEANINGFUL: show authorized service location when available.
3. REFERENCE FOR IDENTIFICATION: keep the opaque persisted reference visible and secondary.
4. COLOR SUPPORTS MEANING: labels remain explicit.
5. ICONS SUPPORT SCANNING: decorative icons never replace accessible labels.
6. OPERATIONAL DENSITY WITH CLARITY: readable compact operational information.
7. RESIDENT AND STAFF EXPERIENCES SHARE A DESIGN SYSTEM, NOT IDENTICAL LAYOUTS.
8. CLIENT BRANDING MUST NOT BREAK SEMANTIC STATUS DESIGN.

Before, the staff detail emphasized the reference above the Issue and placed operational sections in a long uniform column. Now it presents configured Issue icon, category, prominent Issue name, optional service location, secondary reference, and immediately visible status. Department, Division, Created and Updated precede plain-text description and the INTERNAL privacy notice. Assignment/watchers remain in the primary column; Actions and Request Activity occupy the supporting column on desktop. An Issue Details card uses real Issue/category data, without invented service types or nonfunctional buttons.

The implementation follows the approved direction rather than copying its pixels: restrained cards, larger Issue typography, semantic activity markers, separated actions and readable metadata. It intentionally uses the actual sign icon and recorded fictional location instead of the concept's tree and street address. Assignment/watchers added by F037 remain available. On narrow screens the complete content stacks in reading order.

## Shared presentation architecture

`react/src/theme/designTokens.css` defines brand, page/card/subtle surfaces, primary/secondary/muted text, borders, focus, typography, spacing, radii, elevation and semantic foreground/background pairs. Existing Bootstrap and theme preference mechanisms remain. No framework, dependency, font or icon package was added.

Typography uses body 1rem, secondary .875rem, section 1.25rem, page title 1.6–2rem and Issue 1.75–2.25rem. Spacing spans .25–3rem; controls use .5rem radius, cards .75rem, badges pill radius. Card and overlay elevations are deliberately restrained. `primitives.css` bridges shared tokens into Bootstrap controls, keyboard focus, cards, labels and the application shell. Staff layout rules remain local in `staffRequests.css`; older surfaces alias their existing variables to shared tokens.

Brand primary/hover/accent/on-primary variables are distinct from platform-controlled status/activity variables. Light and dark themes define separate contrast-conscious palettes. The header supports optional safe local logo and brand-name props, wrapping long names; default CityVUE name/building mark remain unchanged. Logo URLs are restricted to local root-relative image paths. No client theme editor, arbitrary CSS, runtime white-label configuration, final Reqro logo or repository/resource rename was introduced. Existing CityVUE footer/title text and historical admin preview branding remain limitations for a future branding feature. Long brand-name behavior is covered by component tests, not a live client-brand deployment.

| Actual primitive/module     | Purpose                                                        | Actual use                                                                                         |
| --------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `StatusBadge`               | Explicit status text plus decorative icon and semantic tone    | Staff list/detail/activity; Issue List through `IssueStatusBadge`; Home recent activity; Dashboard |
| `IssueIcon`                 | Finite configured icon with neutral fallback                   | Staff list/detail                                                                                  |
| `LocationDisplay`           | Optional plain-text service location                           | Staff list/detail                                                                                  |
| `ReferenceDisplay`          | Opaque secondary reference                                     | Staff list/detail                                                                                  |
| `ContentCard`               | Shared information/action surface                              | Staff detail primary, Issue Details and Actions                                                    |
| `SectionHeading`            | Consistent section label/icon                                  | Staff detail                                                                                       |
| `presentation.js`           | Central status/activity mappings and safe icon vocabulary      | Above primitives, timeline and catalog icon adapters                                               |
| Existing `RequestActivity`  | Authoritative paginated timeline, now shared card/tone styling | Staff detail only; not claimed as cross-page reuse                                                 |
| Existing `RequestOwnership` | Assignment/watchers and secure pickers, visually normalized    | Staff detail only                                                                                  |

Repeated status styles and obsolete reference-link styling were removed. Existing dashboard keyword icon guessing was removed. Existing page-specific layout CSS is intentionally retained; total CSS increases to establish reusable primitives and richer staff presentation. This is not a claim that every legacy style has been deduplicated.

## Status and activity semantics

| Status        | Visible label | Semantic category       | Decorative Bootstrap icon |
| ------------- | ------------- | ----------------------- | ------------------------- |
| `open`        | Open          | open / green            | circle                    |
| `in_progress` | In Progress   | work / blue             | play-fill                 |
| `on_hold`     | On Hold       | hold / amber            | pause-fill                |
| `closed`      | Closed        | closed / rose           | check-lg                  |
| `cancelled`   | Cancelled     | cancelled / muted slate | slash-circle              |

| Event                | Visible label      | Semantic category | Decorative Bootstrap icon |
| -------------------- | ------------------ | ----------------- | ------------------------- |
| `request_created`    | Request created    | created / slate   | file-earmark-plus         |
| `work_started`       | Work started       | work / blue       | play-fill                 |
| `placed_on_hold`     | Placed on hold     | hold / amber      | pause-fill                |
| `work_resumed`       | Work resumed       | work / blue       | play-fill                 |
| `request_closed`     | Request closed     | closed / rose     | check-lg                  |
| `request_reopened`   | Request reopened   | open / green      | arrow-counterclockwise    |
| `request_routed`     | Request routed     | routing / purple  | signpost-split            |
| `request_assigned`   | Request assigned   | assignment / teal | person-check              |
| `request_reassigned` | Request reassigned | assignment / teal | people                    |
| `request_unassigned` | Request unassigned | assignment / teal | person-dash               |
| `watcher_added`      | Watcher added      | watcher / slate   | eye                       |
| `watcher_removed`    | Watcher removed    | watcher / slate   | eye-slash                 |

Both themes use readable foregrounds on tinted backgrounds; all new semantic text/background pairs pass automated 4.5:1 contrast assertions. Labels remain meaningful without color or icons. Unknown status shows Unavailable. These mappings never select or authorize lifecycle transitions. Activity ordering, pagination, actor privacy, persisted snapshots and plain-text narratives remain unchanged. Assignment history explicitly distinguishes From/To, previous assignment and watcher removal. No historical lookup, editing, deletion, new event type or notification was added.

## Icon and location authority

Staff list/detail add three safe display fields to the existing authorized INTERNAL projection: `issueIcon`, `categoryName`, `serviceLocation`. Icon comes from the request's ServiceDefinitionVersion `icon_key`, category from its existing catalog relationship. A finite vocabulary maps identifiers to existing Bootstrap icon classes. Missing, malformed, unknown or markup-like identifiers use `file-earmark-text`. No arbitrary SVG/HTML is interpreted and no Issue-name keyword guessing remains in the changed presentation path.

Resident intake uses the same configured catalog icon vocabulary and safe mapping. Existing legacy Issue/Dashboard presentation resolves exact catalog matches and otherwise falls back neutrally. The older canonical Issue List read contract does not yet supply the version icon; it is not claimed to have the same complete icon fidelity as the staff projection. Existing Bootstrap icon font loading is reused; no second icon library or image asset was added.

Service location is the existing request-owned `location` row, constrained by request and Organization. Nonblank normalized address is preferred, then nonblank entered address. It is an indexed correlated lookup in the existing list/detail SQL, not an application N+1 lookup. No contact table, resident contact address, coordinates or geocoder is consulted. Missing location is omitted, not invented; long text wraps on mobile. Resident and staff source data remain distinct from contact information. The location is authorized operational free text, not independently verified by F038.

Regression coverage proves normalized/entered fallback, missing location, same-Organization/request linkage, safe projections, PUBLIC exclusion and cross-Organization denial. The new fields are allowlisted by the browser repository. No authority comes from a reference, icon, location, status class, color or client state.

## Surface coverage and explicit remaining work

Section 112's bounded normalization option is used. The staff workspace is the complete reference implementation; older surfaces receive low-risk shared styling without unrelated redesign.

| Surface                      | Classification                           | Changes / remaining work                                                                                                                         |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Global navigation            | Fully normalized for current application | Shared brand/focus tokens, semantic menu button, active links, theme control, collapse below 1200px; future actual client configuration deferred |
| Staff Service Request list   | Fully normalized                         | Issue-first semantic links, configured icon, optional location, secondary reference, status, responsive rows and existing scoped filters         |
| Staff Service Request detail | Fully normalized                         | Identity/metadata/description cards, assignment/watchers, Actions, timeline, themes, responsive stacking                                         |
| Home                         | Partially normalized                     | Shared shell/controls and recent status primitive; existing home layout/illustration styling retained                                            |
| Dashboard                    | Partially normalized                     | Shared surfaces/borders, recent status and safe catalog icon mapping; chart palette/summary-card composition retained                            |
| Issue List                   | Partially normalized                     | Shared status, surfaces and safe fallback icons; legacy editing/filter layout and canonical icon projection deferred                             |
| Report an Issue              | Partially normalized                     | Shared surfaces/controls and safe configured catalog icons; existing progressive intake layout/step styling retained                             |
| Map                          | Partially normalized                     | Surrounding surface/text/border tokens; map renderer, layer symbology, geospatial permission model unchanged                                     |
| AI Workspace                 | Partially normalized                     | Surface/border/text/elevation token aliases; existing preview/guarded feature layout and behavior retained                                       |
| Admin preview                | Partially normalized                     | Surface/border/text/elevation token aliases; preview layout and pre-existing branding remain, no production administration added                 |

Deferred normalization is explicitly limited to these older layouts, chart/map palettes, preview branding and remaining local typography/decorative values. No new product feature is selected by this deferral.

## Browser and accessibility validation

Live localhost UAT used the existing normally authenticated personal Entra session and database-backed F036 grants. No fixture preview substitutes for live evidence. No permissions were added, no sign-in bypass introduced, and no operational mutations were necessary to demonstrate this presentation change.

Existing fictional INTERNAL/STAFF request `DEV-202609-00000003` displays Damaged Street Sign, Roads & Streets, configured signpost icon and `Fictional training site, Example Campus`. Status remains Open, revision 22, scope Community Services / Parks, owner Parks Queue, and two watchers (Development staff and Parks Queue). All 23 existing activity entries and all 12 supported event labels were read through the real workspace. Issue, reference, status, location, hierarchy, timestamps, description, owner, watchers and activity were checked against the existing local data. No concept-image placeholder was inserted.

| Width  | Navigation       | Detail / Actions / Activity                                       | Metadata / ownership                                   | Overflow                  |
| ------ | ---------------- | ----------------------------------------------------------------- | ------------------------------------------------------ | ------------------------- |
| 1440px | Expanded         | Two columns; Actions above Activity on right                      | Two metadata columns; ownership on left                | None observed, light/dark |
| 1280px | Expanded         | Two columns; Actions above Activity on right                      | Two metadata columns; ownership on left                | None observed, light/dark |
| 1024px | Collapsible menu | One column; supporting Actions/Activity after primary information | Two metadata columns, controls wrap                    | None observed, light/dark |
| 768px  | Collapsible menu | One column; Actions then Activity                                 | Two metadata columns, controls wrap                    | None observed, light/dark |
| 390px  | Collapsible menu | One column, readable timeline/narrative wrapping                  | One metadata column; ownership and picker controls fit | None observed, light/dark |

The list was checked at all five widths: table rows on larger widths, stacked rows at 390px, no page overflow. My Team and Watching include the team-owned fictional request; My Requests is correctly empty. Exact reference plus Open filter returns the request. Clearing filters and following the Issue link work. The detail route was reloaded and fetched authoritative content successfully.

At 390px, assignment and watcher pickers open with type-selector focus; Tab/Shift+Tab, Escape/Cancel and trigger focus restoration were exercised. Close's labeled resolution textarea and buttons fit; Cancel restores focus. Routing opens at its department selector and cancels safely. These checks did not submit mutations; existing automated workflow/ownership regressions validate successful mutations and conflicts. All 23 events fit the current first page, so live load-older behavior was not manufactured; automated pagination coverage remains.

Resident intake reached Damaged Street Sign's details step using live catalog choices, with no submission and no mobile overflow. Dashboard fit all five widths. Home was inspected at desktop/tablet/mobile widths. At mobile width the Issue List safely reports the existing permission denial, Map reports the deliberately ungranted geospatial capability, and AI preview remains a preview. These are not claims of authorized public-list, geospatial or live AI operation. Admin preview token changes were covered by the existing React suite; no new live admin capability was exercised.

Checks include h1/h2/h3/h4 hierarchy, main/navigation landmarks, semantic list/table links, labeled controls, keyboard opening/canceling, focus indicators/restoration, mobile menu, explicit status/activity text, decorative icon hiding, timeline reading order, theme contrast assertions and mobile wrapping. Long references, absent locations, malicious icon identifiers and plain-text XSS-oriented activity fixtures are covered automatically. Screen-reader certification, all legacy-page contrast combinations and every OS/browser were not tested. This validation is not a WCAG certification.

## Validation and regression evidence

| Check                                          | Result                                                                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend unit                                   | 177 passed                                                                                                                                    |
| API E2E                                        | 36 passed                                                                                                                                     |
| PostgreSQL integration                         | 94 passed; zero skipped                                                                                                                       |
| Shared JavaScript                              | 62 passed                                                                                                                                     |
| React                                          | 263 passed across 23 files                                                                                                                    |
| TypeScript / test compilation                  | Passed                                                                                                                                        |
| Backend ESLint                                 | Passed                                                                                                                                        |
| Frontend lint                                  | No configured frontend lint command                                                                                                           |
| Backend formatting                             | Passed                                                                                                                                        |
| New shared UI/staff files and tests formatting | Passed; older page styles retain existing formatting rather than unrelated whole-file rewrites                                                |
| Backend production build                       | Passed                                                                                                                                        |
| Frontend production build                      | Passed; existing large-chunk warning retained                                                                                                 |
| Git whitespace                                 | Passed                                                                                                                                        |
| Private configuration / secret review          | No private local value, JWT-like token, credential-bearing URL or personal email in added diff/new files; local configuration remains ignored |

F029 audience/intake, F030 protected reads, F031 workflow/routing/revisions, F032 redirect guards, F033 reference immutability, F034 protected workspace, F035 activity/narratives, F036 provisioning isolation and F037 ownership/watchers remain covered by the full passing regression suites. F036 tooling was not modified. New tests add centralized status/icon/activity/contrast coverage, long-name navigation/logo safety, Issue-first detail and missing-location behavior, and real PostgreSQL display projection isolation. Existing assertions were adapted for Issue-primary link/headings while retaining reference checks; tests were not deleted or security assertions weakened.

## Security, database, performance and cleanup

The only backend functional change is the three-field safe read projection. Authentication, permissions, Organization/scope predicates, PUBLIC/INTERNAL classification, mutations, revision checks, assignment/watch eligibility and append-only history are unchanged. No new protected content is placed in URLs, titles, logs or analytics. React text escaping remains; no unsafe HTML was introduced. Location is service location, never contact substitution. No new permission, grant, schema, external service or geocoding was added.

No F038 database migration required. Personal reqro_dev has 17 applied migrations, latest `20260920000000-add-assignment-watchers`, zero pending. F038 makes no development data writes; existing PUBLIC references `SR-202609-000001` and `SR-202609-000002` and the existing INTERNAL history remain intact. No synthetic records were created.

No new dependency or large asset was added. Final frontend main chunk is 536.73 kB (154.88 kB gzip), compared with checkpoint 536.55 kB (154.77 kB gzip). Map remains 1,028.86 kB (278.44 kB gzip); staff chunk is 32.83 kB (8.74 kB gzip). The existing >500 kB Vite warning is retained, not suppressed. No performance improvement is claimed. Shared components add modest presentation code/CSS; no decoration-only API request or actor N+1 lookup was added. Timeline request behavior remains covered by tests. Broader bundle splitting and production-scale query profiling are deferred.

Temporary test logs/runner and the reload-only index.html change are removed before commit. No screenshots or reference-image assets are committed. `.f037-final-verify.cjs` was neither tracked nor present at the starting checkpoint, so no cleanup/history rewrite was necessary. No debug payload logging was added. Unused presentation imports and obsolete status/reference styling were removed where safe; older layout rules remain deliberately scoped.

No push, deployment, cloud/client resource change, final production branding migration, repository-wide rename or F039 work is part of F038. Future product work requires separate review.

## File inventory

Added: `react/src/theme/designTokens.css`; `react/src/components/ui/presentation.js`, `RequestPresentation.jsx`, `primitives.css`; `react/test/DesignSystem.test.jsx`, `NavigationDesign.test.jsx`; this feature document.

Changed:

- `react/src/main.jsx`, `styles.css` (shared styling entry and responsive shell).
- `react/src/components/layout/AppLayout.jsx`, `SiteHeader.jsx`; `react/src/components/navigation/PrimaryNavigation.jsx` (shell/navigation).
- `react/src/catalog/catalogRepositories.js`; `react/src/pages/issues/issueIconPresentation.js`, `IssueStatusBadge.jsx`, `issues.css` (safe catalog/status presentation).
- `react/src/pages/home/RecentActivity.jsx`; `react/src/pages/dashboard/DashboardPage.jsx`, `dashboard.css` (shared status/icon/surface presentation).
- `react/src/pages/report/report.css`, `react/src/map/mapPreview.css`, `react/src/ai/aiWorkspace.css`, `react/src/admin/adminPreview.css` (focused token aliases).
- `react/src/staff/requests/InternalRequestWorkspace.jsx`, `RequestActivity.jsx`, `RequestOwnership.jsx`, `requestRepository.js`, `staffRequests.css` (staff reference implementation and display projection).
- `react/test/StaffRequestWorkspace.test.jsx` (Issue-first and location coverage; existing regressions retained).
- `server/src/service-request/internal-request.repository.ts`; `server/test/database/request-audience.integration.test.ts` (safe display fields and PostgreSQL isolation coverage).
- `docs/ARCHITECTURE.md`, `docs/CITYVUE_CONTEXT.md`, `docs/ROADMAP.md` (architecture, current direction and explicit normalization deferrals).
