# F001 — React and Vite Migration Plan

**Status:** Proposed for review
**Type:** Assessment and implementation plan only
**Canonical development name:** CityVUE
**Decision state:** React/Vite is a preferred direction, not yet an approved framework decision

## Current-state summary

CityVUE is a framework-free, multi-page JavaScript MVP built by Parcel 2 and hosted as static files on Firebase Hosting. npm manages the project. The application currently uses:

- One root `index.html` and separate HTML documents under `pages/`.
- ES modules under `assets/`, with page controllers that query and mutate the DOM directly.
- An `Issue` model and static `IssueService` backed by browser `localStorage` under the `cityvueIssues` key.
- Bootstrap 5.3.8 and Bootstrap Icons 1.13.1 as installed packages, although loading is inconsistent by page.
- Chart.js from a CDN on the dashboard; it is not an npm dependency.
- A large shared `assets/css/styles.css` file containing the custom home design, responsive rules, accessibility preferences, and dark-mode rules.
- Two independent theme implementations and storage keys: the home page uses `askRockvilleTheme` and a `body.dark-mode` class, while operational pages use `cityvueTheme` and Bootstrap's `data-bs-theme` attribute.
- Repeated navigation, footer, toast, and layout markup across HTML documents. The nominal `navbar.js`, `footer.js`, and `cards.js` modules are empty.
- Node's built-in test runner for the current `Issue` and `IssueService` regression suite.
- Firebase Hosting with `dist` as the public directory, clean URLs enabled, and no SPA rewrite.

Parcel follows links from the root HTML entry and currently emits the linked Report, Issue List, and Dashboard pages into `dist/pages/`. About and Contact exist as skeletal, navigation-only HTML files but are not linked from the active application, do not load their corresponding JavaScript modules, and contain root-relative assumptions that are incorrect for their location. They should be inventoried, not treated as completed user workflows.

The repository also contains empty placeholder modules and backup files (`app_backup.js` and `styles_backup.css`). They may represent earlier experiments but should not be removed until parity work explicitly determines that they are obsolete.

## Goals

1. Transition the presentation layer incrementally from direct DOM manipulation and multiple HTML documents to a React application.
2. Use Vite for development and production bundling after an approved implementation stage.
3. Use React Router for the current MVP routes while preserving direct navigation, bookmarks, and refresh behavior.
4. Retain the current visual design and Bootstrap-based UI behavior during migration.
5. Preserve the working Parcel MVP as a rollback baseline until React parity is verified.
6. Keep domain, storage, validation, filtering, sorting, formatting, and statistics logic framework-independent.
7. Retain Firebase Hosting for the static front end unless implementation discovery identifies a concrete incompatibility.
8. Keep the future CityVUE API and integration architecture separate from React.

## Non-goals

- Migrating application code in this planning task.
- Redesigning the interface or changing citizen-facing behavior.
- Defining or implementing the future canonical `ServiceRequest` model.
- Changing the existing `Issue` model during the UI migration.
- Adding authentication, authorization, Firebase database functionality, an API, or an enterprise integration.
- Coupling the front end to VUEWorks, Cityworks, Cartegraph, MGO, VistaShare, or another vendor.
- Replacing Firebase Hosting without a separate, evidence-based decision.
- Adopting TypeScript, Redux, Next.js, Create React App, or a broad component framework during initial migration.
- Removing legacy pages or backup/placeholder files before verified parity.
- Deploying as part of assessment or initial scaffolding.

## Target-stack assessment

| Technology | Fit for CityVUE | Migration implications and compatibility | Recommendation |
| --- | --- | --- | --- |
| React | Good fit for repeated layouts, interactive forms, filter state, modal/toast state, dashboard composition, and future configuration-driven intake. It is not required for the current MVP's size, but it becomes more valuable as workflows grow. | Direct DOM controllers must become declarative components. React must not absorb storage or domain logic. Existing semantic markup and accessibility behavior need parity checks. | Adopt after this plan is approved. Keep the migration separate from domain and API work. |
| JavaScript initially | Good fit because the repository and developer workflow are already JavaScript-based. It lowers the number of simultaneous changes and lets the migration focus on React concepts. | Use ES modules, clear prop contracts, small modules, and JSDoc where useful. Avoid patterns that would make later TypeScript adoption unnecessarily difficult. | Adopt initially. Reassess TypeScript after React parity or when shared API contracts make its value concrete. |
| Vite | Good fit for a modern React SPA, fast local feedback, straightforward static production output, and Firebase-compatible `dist` artifacts. | Parcel scripts and its `source` field eventually become Vite scripts/configuration. HTML becomes the Vite entry. Asset paths and environment variables require deliberate conversion. Parcel and Vite should not compete in the final package. | Adopt with the React shell. Keep Parcel available during the parallel migration, then remove it only after cutover. |
| React Router | Good fit once the application becomes a single React shell. It replaces document navigation with explicit current-MVP routes and nested shared layout. | Firebase requires SPA fallback. Existing `.html` URLs, query-string edit links, dashboard hash filters, and clean URLs need compatibility redirects or route aliases. | Adopt with the React shell. Define only current MVP routes. |
| Bootstrap | Already installed and deeply represented by operational-page class names, modal/toast behavior, layout utilities, and `data-bs-theme`. Retaining it reduces visual and behavioral risk. | Import Bootstrap CSS and only needed JavaScript through the React/Vite entry rather than mixing package paths and CDNs. Prefer React-controlled modal/toast state; avoid having Bootstrap and React mutate the same nodes. | Retain as-is during visual-parity migration. Reconsider styling strategy only after parity. |
| Bootstrap Icons | Already installed, but the home/dashboard also use CDN versions and one CDN reference is an older version. | Normalize to the installed package through Vite so builds do not depend on a public CDN and icon versions are consistent. Verify rendered glyph parity. | Retain, but load from the installed package during migration. |
| Firebase Hosting | Compatible with a Vite static SPA and already part of the established deployment model. | `dist` can remain the output directory. An SPA rewrite and 404 strategy will be required at cutover. Hosting changes must be reviewed before deployment. | Retain for the front end. Do not infer Firebase database, authentication, or API use. |
| Node `node:test` | Strong fit for existing framework-independent domain/service tests with no additional dependency. | Existing tests can continue to import unchanged modules. Node alone does not render React components or JSX. Vite configuration must not make pure modules browser-only. | Retain for domain/service/unit logic. Add UI tooling only when the first meaningful interactive React page needs it. |
| Next.js | No current requirement for server rendering, React server components, server routes, or framework-managed hosting has been established. It would add architectural and deployment choices beyond the current static MVP. | It would complicate the migration and Firebase static-hosting assumptions without demonstrated value. | Do not adopt unless a later approved requirement materially needs it. |

Create React App should not be used; it is not the proposed build path and would add an unnecessary intermediate migration before Vite.

## Current UI and workflow inventory

The prototype does not enforce user roles. The home and report experiences are citizen-oriented. Issue management and dashboard capabilities appear staff-oriented or administrative in function, but they are currently public client-side pages with no authentication or authorization. The migration must preserve this current behavior without implying that it is an approved security model.

| Page or workflow | Current sources | Dependencies and state | Duplication / coupling | Likely React boundaries | Complexity |
| --- | --- | --- | --- | --- | --- |
| Home | `index.html`, `assets/js/app.js`, `assets/css/styles.css`, `assets/rockville-logo.png`, `assets/ask-rockville-hero.png` | Static content; custom mobile navigation; home-only theme state in `localStorage`; Bootstrap Icons CDN. Displayed impact statistics and recent activity are hard-coded, not read from `IssueService`. | Home navigation/footer differ from operational pages. Theme duplicates `theme.js`. Markup is large but behavior is limited. | `HomePage`, `Hero`, `ServiceHighlights`, `QuickActions`, `ImpactSummary`, `RecentActivity`, `FeedbackPanel`; shared `AppLayout`, `SiteHeader`, `SiteFooter`, `ThemeToggle`. | Medium because layout is straightforward but visual parity and responsive custom CSS are substantial. |
| Report an Issue — create | `pages/report.html`, `assets/pages/report.js`, `IssueService`, `Issue`, `theme.js`, `toast.js`, `app.js`, `styles.css` | Form fields and native constraint validation; page-local edit/create mode; `IssueService.saveIssue`; `localStorage`; delayed document redirect; Bootstrap toast. | Direct selectors and writes; duplicated layout/toast markup; both theme systems are imported, although home selectors are absent on this page. Categories and priorities are embedded in HTML. | `ReportIssuePage`, `IssueForm`, form-field components only when reuse is real, `ToastProvider` or shared notification component. A form hook may be extracted after behavior is understood. | High because create/edit behavior, validation, defaults, feedback timing, persistence errors, and navigation must remain equivalent. |
| Edit issue | `pages/report.html?id=<id>`, `assets/pages/report.js`, `IssueService.getIssueById/updateIssue` | Query parameter controls edit mode; existing issue populates DOM fields; missing issue shows a toast then redirects; status/date are preserved. | Create and edit share one DOM controller, which is useful behavior to retain. URL and timer effects are tightly coupled to `window`. | Reuse `ReportIssuePage`/`IssueForm`; route loader/effect for the ID; explicit missing state; React Router navigation. | High. Preserve existing query-link compatibility even if a clearer route is introduced. |
| Issue/request listing | `pages/issues.html`, `assets/pages/issues.js`, `IssueService`, `theme.js`, `toast.js`, Bootstrap `Modal`, `styles.css` | Page-local arrays for all and filtered issues; reads `localStorage`; DOM table rendering; empty state; modal state; URL query/hash filters. | Search/filter/sort/render/delete live in one 612-line controller. Shared date/status formatting is duplicated. Layout, toast, and footer markup are repeated. | `IssuesPage`, `IssueFilters`, `IssueTable`, `IssueRow`, `IssueStatusBadge`, `EmptyIssuesState`, `DeleteIssueDialog`, shared notification component. | High. It is the largest interactive workflow and should be decomposed without changing semantics. |
| Search | `assets/pages/issues.js` | Case-insensitive substring match over title, description, category, reporter, and location. Search text is local page state and is not reflected in the URL. | Logic is embedded in `applyFilters` and immediately triggers sort/render. | Controlled `SearchInput`; pure `filterIssues` function independent of React. | Medium. Pure logic extraction should be regression-tested first. |
| Category, priority, and status filters | `pages/issues.html`, `assets/pages/issues.js` | Select values are local state. Initial category/priority/status can come from either query parameters or hash parameters. Matching is exact after case-insensitive option resolution. | Options are HTML data; filtering and URL parsing are DOM-coupled. Dashboard creates hash-filter links. | `IssueFilters`; pure filter and URL-compatibility utilities; React Router search parameters for canonical state. | Medium. Preserve dashboard deep links and existing bookmarks. |
| Sort | `pages/issues.html`, `assets/pages/issues.js` | Newest, oldest, title ascending/descending, and priority order. Sorting mutates the filtered array. Invalid dates rely on JavaScript date comparison behavior. | Sorting is embedded in the page controller. Priority order is page-local. | Controlled `SortSelect`; pure non-mutating `sortIssues` utility. | Low to medium once extracted and tested. |
| Delete | `pages/issues.html`, `assets/pages/issues.js`, Bootstrap modal, `IssueService.deleteIssue`, toast | Selected issue ID is page state; successful deletion reloads from storage; missing/delete failure paths display feedback. | Bootstrap owns modal DOM state while the page controller owns selected-record state. | `DeleteIssueDialog` controlled by React state; call the framework-neutral service; shared notification handling. | Medium to high because destructive-action and failure semantics need parity. |
| Dashboard/statistics | `pages/dashboard.html`, `assets/pages/dashboard.js`, `IssueService`, `theme.js`, `styles.css`, global CDN Chart.js | Reads issues from `localStorage`; computes status/priority/category totals; renders three charts; shows five recent issues; chart/category and cards deep-link to filters. | The 805-line controller duplicates functions already present in `assets/js/utils/statistics.js` and `assets/components/charts.js`; neither shared module is used here. Chart instances and DOM creation are page globals. | `DashboardPage`, `StatisticsGrid`, `StatisticCard`, `StatusChart`, `PriorityChart`, `CategoryChart`, `RecentIssues`; pure statistics selectors. | High because Chart lifecycle, responsive canvas behavior, deep links, empty/error states, and duplicated logic need reconciliation. |
| Dark mode/theme | `assets/js/app.js`, `assets/components/theme.js`, `assets/css/styles.css`, Bootstrap theme attributes | Two keys (`askRockvilleTheme`, `cityvueTheme`), two DOM strategies (`body.dark-mode`, `data-bs-theme`), system preference listener, and two button IDs. | Functionality and persistence are duplicated and can produce inconsistent preferences across pages. | `ThemeProvider` only if the preference is truly app-wide; `useTheme`; shared `ThemeToggle`. Keep storage access behind a small adapter and apply one documented DOM contract. | Medium. Selecting a compatibility rule for the two existing keys is an unresolved product/technical decision. |
| Navigation | Repeated in every HTML document; custom markup on home, Bootstrap collapse markup elsewhere; `app.js` handles only home mobile menu | Current links use relative document paths. Active state is hard-coded per page. About/Contact are not linked. | Extensive repeated markup and two navigation implementations; placeholder `navbar.js` is empty. | `AppLayout`, `SiteHeader`, `PrimaryNavigation`, router-aware `NavLink`, accessible mobile-menu state. | Medium because responsive and keyboard behavior must retain parity. |
| Footer | Repeated in active HTML documents with custom home version and Bootstrap operational version | Static links/content. | Repeated and visually inconsistent; placeholder `footer.js` is empty. | `SiteFooter` with the smallest page-specific variation necessary. | Low. |
| Toast feedback | Repeated toast markup in report/issues; `assets/components/toast.js` wraps Bootstrap's imperative API | Module-level Bootstrap instance and DOM selectors. | Repeated HTML and DOM ownership conflict risk in React. | Shared `ToastProvider`/notification region or page-level controlled toast. Maintain accessible live-region behavior. | Medium. |
| About and Contact | `pages/about.html`, `pages/contact.html`; one-line `assets/pages/about.js` and `contact.js` exist but are not loaded | No substantive page content; no active links; paths are written as if the files were at repository root; Bootstrap behavior/styles are not loaded by the documents. | The two files are nearly identical skeletal navigation pages. | `AboutPage` and `ContactPage` only if their content and inclusion are confirmed. Otherwise retain as known incomplete legacy artifacts until a decision. | Low technically; product scope is unresolved. |

## Current module reuse analysis

### Reusable without production changes during initial migration

- `assets/models/Issue.js`: framework-independent and covered by tests. Keep it unchanged until the separately approved canonical-domain effort.
- `assets/services/IssueService.js`: no DOM dependency and covered by isolated storage tests. It directly uses the browser storage global, but React can call it as-is initially.
- `assets/js/utils/statistics.js`: pure calculations suitable for React, although its case-sensitivity and invalid-date semantics differ from the dashboard's duplicated implementations and must be reconciled through tests before replacement.
- `assets/js/utils/helpers.js` and `validators.js`: framework-independent, but lightly implemented and apparently unused by active workflows. Validate desired formatting/validation semantics before adopting them.
- `assets/js/config.js`: framework-independent constants, currently minimal.

### Reusable with minor adaptation

- Storage behavior: `IssueService` can remain unchanged for parity. A later injected storage adapter would improve testing and future persistence replacement, but is not required for React and must not be bundled into the first UI stage.
- Filtering and sorting code in `assets/pages/issues.js`: algorithms are reusable after extraction into pure functions that return new arrays and accept explicit criteria rather than reading controls.
- Dashboard statistics and recent-item calculations: reusable after selecting one canonical implementation and adding regression tests for normalization, invalid dates, categories, and limits.
- Date and status presentation rules: extract only after current differences between issue listing, dashboard, helpers, and badges are documented in tests.
- Theme persistence: behavior is reusable after an explicit compatibility decision for the two existing storage keys and DOM theme mechanisms.

### Tightly coupled to DOM/UI and should be refactored during page migration

- `assets/pages/report.js`, `issues.js`, and `dashboard.js` page controllers.
- `assets/js/app.js` navigation and home-theme DOM manipulation.
- `assets/components/theme.js`, `toast.js`, and `charts.js`, which directly select and mutate DOM nodes or maintain imperative UI instances.
- Markup-driven category/priority/status option data embedded in HTML.

### Obsolete or duplicated candidates — retain until parity is verified

- Empty `assets/components/cards.js`, `navbar.js`, and `footer.js`.
- Empty `assets/css/components.css`, `darkmode.css`, and `variables.css`.
- One-line/empty `home.js`, `about.js`, `contact.js`, and `firebaseService.js` modules.
- `assets/js/app_backup.js` and `assets/css/styles_backup.css`.
- The standalone `assets/js/storage.js`, which is less defensive than `IssueService` and appears unused.
- `assets/components/charts.js` and dashboard-local chart functions, which duplicate each other.
- `assets/js/utils/statistics.js` and dashboard-local statistics functions, which overlap but are not behaviorally identical.
- Duplicate logo/hero assets in `assets/` and `assets/images/`.

No candidate should be removed merely because it appears unused. Confirm usage through the Vite graph and parity review first.

## Stage 0 parity findings

Stage 0 extracted the active Issue List calculations into framework-independent `issueFilters.js` and `issueSort.js` utilities, and made `statistics.js` reproduce the Dashboard controller's active calculations. The existing controllers now consume those utilities without changing their rendering or storage behavior.

Confirmed behaviors that a later React implementation must preserve unless changed in a separately approved task:

- Issue search trims the entered search text, compares case-insensitively, and searches title, description, category, reporter, and location. Missing or null searchable fields behave as empty strings.
- Category, priority, and status filtering uses exact, case-sensitive equality after the HTML control has supplied its canonical option value.
- URL filter values are recognized case-insensitively against the current HTML options. Hash values take precedence per filter, while absent or empty hash values fall back to query values. Unrecognized values leave that filter inactive.
- Unknown and missing priorities sort after High, Medium, and Low. Their relative input order is stable.
- Issue List date comparators return `NaN` for invalid or missing dates. JavaScript's stable sort therefore treats those comparisons as equal; this can prevent otherwise valid dates on opposite sides of an invalid entry from being globally reordered. This unintuitive behavior is intentionally covered as parity, not corrected during Stage 0.
- Dashboard status and priority totals trim and compare values case-insensitively. This is more tolerant than Issue List filter equality.
- Dashboard category labels are trimmed and remain case-sensitive. Missing, null, empty, or whitespace-only categories are grouped as `Uncategorized`.
- Dashboard recent-issue ordering converts invalid or missing dates to timestamp `0`, places valid modern dates ahead of them, preserves equal-date input order, and defaults to five results.

Before Stage 0, `assets/js/utils/statistics.js` was not used by the Dashboard and disagreed with the active UI: it used exact case-sensitive status/priority comparisons, grouped missing categories under `Other`, did not trim category labels, and allowed invalid dates to produce `NaN` in its comparator. The active Dashboard controller was selected as the authoritative parity baseline, and the shared utility now implements those active semantics.

## Stage 1 shell decision

Stage 1 uses `react/` as an isolated Vite root with application source under `react/src/` and production output under ignored `dist-react/`. The repository-root `index.html`, Parcel's `dist/` output, Firebase Hosting configuration, and existing `start`/`build` commands remain the legacy MVP and deployment baseline. Explicit `legacy:*` and `react:*` scripts make both applications independently runnable during the parallel phase.

Vite's built-in JSX transformation is sufficient for this minimal shell, so Stage 1 does not add `@vitejs/plugin-react`. Bootstrap and Bootstrap Icons are imported from the existing installed packages. The shell defines only `/` and `*`; it does not create placeholder routes for workflows that have not been migrated.

## Proposed React application structure

The following is a target structure, not a request to create directories in this planning task:

```text
src/
├── app/
│   ├── App.jsx
│   ├── router.jsx
│   └── providers.jsx
├── pages/
│   ├── HomePage.jsx
│   ├── ReportIssuePage.jsx
│   ├── IssuesPage.jsx
│   ├── DashboardPage.jsx
│   ├── AboutPage.jsx
│   ├── ContactPage.jsx
│   └── NotFoundPage.jsx
├── components/
│   ├── layout/
│   ├── navigation/
│   ├── issues/
│   ├── dashboard/
│   ├── feedback/
│   └── common/
├── services/
│   └── IssueService.js
├── models/
│   └── Issue.js
├── hooks/
│   ├── useIssues.js
│   └── useTheme.js
├── utils/
│   ├── issueFilters.js
│   ├── issueSort.js
│   ├── statistics.js
│   ├── formatters.js
│   └── validators.js
├── data/
│   └── issueOptions.js
├── styles/
│   ├── index.css
│   ├── tokens.css
│   ├── layout.css
│   └── pages/
├── main.jsx
└── test/
```

Responsibilities:

- `app/`: application composition, route definitions, error boundaries, and genuinely application-wide providers.
- `pages/`: route-level composition and data-loading orchestration; pages should not become collections of low-level reusable controls.
- `components/`: presentational and interaction components grouped by feature where practical. Shared components should be created only after real reuse appears.
- `services/`: browser-facing application service boundaries. Initially preserve `IssueService`; later it can call a CityVUE API without components knowing vendor details.
- `models/`: framework-independent domain objects. React must not define the future canonical model.
- `hooks/`: reusable React-specific state/effect orchestration. Hooks should call services and pure utilities, not duplicate business rules.
- `utils/`: pure filtering, sorting, statistics, validation, and formatting functions with Node tests.
- `data/` or `config/`: static citizen-facing option data and configuration. This is not the future authoritative service catalog.
- `styles/`: retained global tokens/base rules plus progressively separated layout and page-specific styles. Avoid per-component fragmentation during visual-parity work.

The final location of existing modules can be chosen during scaffolding. Moving them merely for aesthetics before they are consumed by React would create noisy changes without value.

## State-management recommendation

React's built-in state and effects are sufficient for the current MVP. Do not add Redux or another external state library.

Keep local:

- Form field values, validation display, submission state, and create/edit mode details.
- Search text, filter selections, sort selection, and delete-dialog selection on the Issue List page.
- Modal open state and individual toast/notification visibility unless a shared notification provider proves simpler.
- Chart instances inside chart components via refs and effects.
- Mobile-navigation open state.

Derive rather than store:

- Filtered and sorted issues from the issue collection plus filter/sort criteria, using pure functions and `useMemo` only if measurement shows value.
- Dashboard counts and chart datasets from the current issue collection.
- Current route/active navigation from React Router.

Potentially shared:

- Theme preference, because it affects the entire application shell. A small context is justified if it prevents prop drilling and owns the document-level theme effect.
- Current issue collection only if multiple mounted route components truly need synchronized data. Initially, a focused `useIssues` hook per route can read/write through `IssueService`; localStorage events do not fire in the same tab, so explicit refresh after mutation is required.
- Notifications may use context once more than one migrated workflow needs a common live region.

The eventual API cache, staff identity, and authorization state are outside this migration. Their future needs should not dictate a state library now.

## Routing recommendation

Proposed canonical current-MVP routes:

| Route | Purpose |
| --- | --- |
| `/` | Home |
| `/report` | Create an issue |
| `/issues` | Issue list, search, filters, and sort |
| `/issues/:issueId/edit` | Edit an existing issue |
| `/dashboard` | Dashboard/statistics |
| `/about` | About, only if substantive content is confirmed |
| `/contact` | Contact, only if substantive content is confirmed |
| `*` | Accessible not-found page |

Compatibility requirements:

- Preserve or redirect `/pages/report.html`, `/pages/issues.html`, and `/pages/dashboard.html` at cutover so existing bookmarks do not silently fail.
- Accept `?id=<id>` on the legacy report URL during the transition. The canonical edit route may use a path parameter, but the migration must not strand existing links.
- Continue to interpret existing issue filters supplied as query parameters or hash parameters (`status`, `priority`, and `category`). Prefer URL search parameters for new canonical links because they are easier to compose, inspect, and test.
- Use React Router links for in-app navigation after cutover, while maintaining meaningful `href` behavior.
- Direct navigation and browser refresh on any React route require Firebase Hosting to serve `index.html` as the fallback.
- Define an explicit `NotFoundPage`. An unconditional Hosting fallback should not result in a blank React screen for unknown paths.
- Record the expected behavior of trailing slashes and Firebase `cleanUrls` during implementation testing.

## CSS, Bootstrap, and theme migration

Visual parity is the default. Do not redesign CityVUE while changing frameworks.

1. Import the installed Bootstrap CSS and Bootstrap Icons once in the Vite entry. Remove page-level `node_modules` paths and CDN icon references only when equivalent rendering is verified.
2. Retain `assets/css/styles.css` initially as a global stylesheet. Its design tokens, base typography, responsive home layout, reduced-motion support, forced-colors support, print rules, and home dark-mode rules are valuable baseline behavior.
3. Establish import order explicitly: Bootstrap base, Bootstrap Icons, then CityVUE overrides. Verify that this matches current operational-page behavior before decomposing CSS.
4. Separate global tokens/base/layout and page-specific styles progressively after each migrated page reaches parity. Do not convert all styles to CSS modules or CSS-in-JS during the initial migration.
5. Preserve semantic markup, focus-visible treatment, responsive navigation, reduced-motion behavior, and mobile layouts.
6. Replace the two theme implementations with one only after deciding how to migrate existing preferences. Bootstrap's `data-bs-theme` is the better shared DOM contract because operational pages already use it, but the custom home selectors must be adapted without changing appearance.
7. Avoid combining React-controlled DOM with Bootstrap's data API for stateful components. Bootstrap layout/utilities can remain; modal, collapse, and toast state should be controlled from React or carefully wrapped.
8. Replace the dashboard's global Chart.js CDN usage with an approved npm dependency only when the dashboard is migrated. That dependency is not needed for initial shell/home stages.
9. Move the few dashboard inline sizing declarations to an appropriate stylesheet during dashboard migration, preserving dimensions.

Observed compatibility concerns include inconsistent Bootstrap loading between pages, differing Bootstrap Icons versions, global `.navbar`/`.nav-link` custom rules that can affect Bootstrap markup, and duplicated dark-mode selectors. These should be resolved through page snapshots/manual parity checks, not through a redesign.

## Testing strategy

### Retain immediately

The current 11 Node tests for `Issue` and `IssueService` remain valid if those modules remain framework-independent. Continue using the isolated `MemoryStorage`; never use developer browser storage in automated tests.

### Add before or alongside interactive page migration

- Pure search tests across every currently searched field, including missing values and case behavior.
- Filter tests for category, priority, status, and combined criteria.
- Sort tests for all five current modes, unknown priorities, and invalid/missing dates.
- URL compatibility tests for query and hash filters.
- Statistics tests for status, priority, category fallback, recent ordering, and limits.
- Formatting and validation tests once one canonical implementation is selected.
- Additional `IssueService` tests for `getIssueById`, deleting a missing issue, clearing issues, and relevant read/remove failures.

### React UI testing

Do not add a browser or component test dependency merely to scaffold React. Introduce a focused component testing setup when the first meaningful interactive page is migrated—likely Issue List or Report Issue. At that point, Vitest plus React Testing Library is the natural Vite-aligned option because tests need JSX transformation, DOM semantics, and user-level interaction. Keep Node's built-in suite for pure modules unless consolidating runners later provides demonstrated maintenance value.

Initial component tests should cover behavior rather than styling details: form submission/error feedback, filter controls, delete confirmation, empty/error states, accessible names, and navigation outcomes. Full browser end-to-end tooling is not necessary for the shell or Home page. Consider Playwright only when several routed workflows exist and cross-route behavior, direct navigation, refresh, or deployment-like routing needs reliable end-to-end coverage.

Manual responsive and accessibility checks remain necessary for visual parity. Automated component tests do not replace keyboard, focus, contrast, mobile navigation, or chart accessibility review.

## Parcel-to-Vite considerations

Likely eventual changes, after approval:

- Replace Parcel development/build scripts with `vite`, `vite build`, and optionally `vite preview` after the migration cutover. During the parallel phase, give Parcel and Vite scripts explicit names so the working MVP remains runnable.
- Remove Parcel and its package `source` field only after React has parity and the rollback point is recorded.
- Make root `index.html` the Vite application entry with a module script for `src/main.jsx` and a React root element.
- Import Bootstrap, Bootstrap Icons, and CityVUE CSS from the application entry rather than HTML references to `node_modules` or CDNs.
- Use Vite's normal imported-asset handling for images referenced by components. Use `public/` only for assets that must retain exact public URLs; do not copy every asset there by default.
- Review all existing relative URLs. Current pages depend on `../` and `./pages/` document locations; router links and imported assets should replace those assumptions.
- Vite exposes client variables through `import.meta.env` and normally requires a `VITE_` prefix. Parcel's `process.env` use in `assets/js/firebase.js` cannot be copied unchanged if that module becomes active in Vite. No Firebase module is currently imported by the active MVP, and no environment-variable conversion should occur until an approved client-configuration requirement exists.
- Never place privileged credentials in Vite-exposed environment variables. Any Vite client variable is bundled for the browser.
- Vite's default output is `dist`, matching current Firebase Hosting output. Set `base` only if the React app is intentionally hosted below a subpath; root hosting should not need a custom base.
- Decide whether source maps are appropriate for the deployed environment as part of deployment review.
- Normalize Chart.js to a package import during dashboard migration rather than relying on a global `Chart` loaded from a CDN.

Repository-specific migration issues:

- About/Contact are not active Parcel-linked pages and have incorrect relative asset/link assumptions from `pages/`.
- The current Firebase configuration relies on physical HTML output and `cleanUrls`, not an SPA fallback.
- Two theme keys and DOM contracts must be reconciled without unexpectedly resetting user preference.
- Home content contains static statistics/recent activity that should remain static for parity unless a separate product change is approved.
- Parcel currently discovers linked pages from the root document; Vite SPA routing will not create physical HTML files for them.
- Custom global selectors overlap Bootstrap selector names, so CSS import order can change appearance.
- Existing images include duplicate and legacy-named assets. Asset cleanup is separate from migration parity.

## Firebase Hosting considerations

The current Firebase project can continue hosting a Vite-built React front end. No evidence in the repository requires changing Firebase projects or hosting providers.

- Keep `dist` as the Hosting `public` directory if Vite uses its default output.
- At SPA cutover, add and review a rewrite conceptually equivalent to routing unmatched paths to `/index.html`. Do not add it while production still depends on physical legacy pages without a tested coexistence rule.
- Verify direct navigation and refresh for every canonical and compatibility route against the Firebase emulator before any authorized deployment.
- Keep hashed Vite assets under `dist/assets/` and confirm Firebase's ignore rules do not exclude them.
- Preserve an explicit client-side not-found route because the SPA rewrite returns `index.html` for unknown paths.
- Review `cleanUrls` and `trailingSlash` together with legacy `.html` redirects. Their behavior should be tested rather than assumed.
- The existing `npm run deploy` workflow can conceptually remain `build` followed by `firebase deploy`, but it must point to the approved Vite build only after cutover. During migration, deployment commands should be unambiguous and should never accidentally publish a preview build to the current project.
- Use a local emulator and, if authorized later, a separate Firebase preview channel or non-production site for migration validation. This plan does not authorize creating or deploying one.
- Firebase Hosting remains only the static front-end host. It does not become the future CityVUE API, database, identity provider, or integration layer by implication.

## Migration options comparison

| Option | Description | Advantages | Risks / disadvantages | Assessment |
| --- | --- | --- | --- | --- |
| A — Parallel React application | Build React/Vite on a focused migration branch and local/preview target while the Parcel MVP remains intact and runnable. Validate page parity before switching Hosting. | Lowest production and rollback risk; clear React learning environment; avoids mixed DOM ownership; permits route-by-route review; preserves baseline. | Temporary duplication of markup/styles and two build paths; data compatibility must be maintained; preview routing needs care. | **Recommended**, with strict time limits and stage gates to prevent indefinite dual maintenance. |
| B — Embed React gradually in existing pages | Mount isolated React roots inside current HTML documents and continue Parcel during migration. | Individual widgets can migrate in place; current URLs remain physical documents. | React and legacy code may mutate the same DOM; repeated roots/providers; harder routing transition; more concepts for a developer learning React; creates code likely to be discarded at SPA cutover. | Not recommended for this repository. The interactive pages are page-level controllers, not isolated widgets with clean ownership. |
| C — Immediate Vite shell and route-by-route production replacement | Switch build/routing first, serve legacy behavior around or through the new shell, and replace routes one at a time. | Avoids two long-lived build systems and moves quickly to target tooling. | Early changes to build and Hosting increase rollback risk; mixing legacy document scripts into an SPA is awkward; direct links can break before parity. | Possible only after a small proof of concept, but less safe than Option A for the current working MVP. |

### Recommended compatibility method

Use Option A as a controlled parallel migration:

1. Preserve a known-good Parcel build and current regression results.
2. Develop React/Vite on a focused branch, locally at first. If external review is later authorized, use an isolated preview target rather than the current production site.
3. Keep the same `cityvueIssues` localStorage schema and key so behavior can be compared in the same browser profile. Do not migrate stored data as part of React scaffolding.
4. Migrate and review complete routes, not fragments embedded into legacy documents.
5. Keep the parallel period bounded. Once every approved current route meets parity, switch the build/Hosting configuration in one reviewed cutover and retain the prior deploy/revision as rollback.
6. Remove legacy code only in a later cleanup after the React deployment is stable and the rollback window is approved.

This method favors a developer learning React because each route can be understood as a coherent component tree, while business logic remains in plain JavaScript modules.

## Recommended incremental migration sequence

Each stage should be a focused reviewable change. No stage should silently begin the canonical-domain refactor.

### Stage 0 — Record parity baseline

**Scope:** Capture current routes, representative desktop/mobile screenshots, keyboard behavior, storage fixtures, theme behavior, and build/test results. Add pure logic tests before moving logic.
**Likely files:** tests and planning/checklist documentation only; no framework dependencies yet.
**Risks:** Encoding accidental behavior as a requirement or missing broken/incomplete legacy behavior.
**Validation:** Existing Node suite/build; manual route inventory; known-good storage fixture; accessibility smoke check.
**Rollback:** Documentation/tests can be reverted independently.
**Done:** The team agrees what “visual and functional parity” means and which known defects are preserved versus separately scheduled.

### Stage 1 — Establish the parallel React/Vite shell

**Scope:** Add React, React DOM, Vite, and React Router only; create the application root, router, not-found route, and minimal global CSS imports. Keep Parcel scripts explicitly runnable.
**Likely files:** `package.json`, lockfile, Vite entry/configuration if needed, root React entry, `src/app/`, minimal `src/styles/`. Do not modify Firebase Hosting yet.
**Risks:** Dependency/version mismatch, unclear dual scripts, CSS reset differences, or premature removal of Parcel.
**Validation:** React development server and production build; existing Node tests; direct local route checks; no production deployment.
**Rollback:** Remove the isolated React files/dependencies and continue using the unchanged Parcel scripts.
**Done:** A minimal accessible shell and not-found page build with Vite while the Parcel MVP still starts/builds.

### Stage 2 — Shared layout, navigation, and theme contract

**Scope:** Implement `AppLayout`, header/navigation, footer, responsive menu, and one theme API. Define compatibility behavior for both current theme keys before coding it.
**Likely files:** layout/navigation components, theme hook/provider, global styles, component tests if justified.
**Risks:** Visual drift between home and operational layouts, focus/menu regressions, conflicting Bootstrap/custom selectors, preference reset.
**Validation:** Desktop/mobile visual comparison; keyboard and screen-reader-name checks; system/light/dark preference matrix; reduced-motion check.
**Rollback:** React shell can revert to its minimal layout without affecting Parcel.
**Done:** Shared layout matches approved baseline and theme choice persists predictably without touching issue data.

### Stage 3 — Home page

**Scope:** Migrate static home sections and assets with visual parity. Keep hard-coded statistics/recent activity as current behavior unless separately approved.
**Likely files:** `HomePage` and home components; home styles/assets; router link wiring.
**Risks:** Image-path handling, responsive layout drift, confusing static values with live Issue data.
**Validation:** Screenshot comparison at representative widths; link, focus, mobile menu, print, forced-colors, and reduced-motion checks.
**Rollback:** Continue using legacy root page; no issue data changes.
**Done:** Home is visually and semantically equivalent and all current quick-action links reach intended React routes.

### Stage 4 — Pure issue collection logic, then Issue List read behavior

**Scope:** Extract/test pure search, filter, sorting, formatting, and URL compatibility functions. Build the read-only issue list and empty states against unchanged `IssueService`.
**Likely files:** `src/utils/issueFilters.js`, `issueSort.js`, tests, `IssuesPage`, filter/table/status components, `useIssues`.
**Risks:** Changed ordering, invalid-date behavior, filter deep links, unsafe rendering, stale localStorage state.
**Validation:** Unit matrices; seeded in-memory/manual browser data; parity for all filter/sort combinations; XSS regression checks; current hash/query links.
**Rollback:** Legacy Issue List remains available and uses the same storage schema.
**Done:** React displays, searches, filters, sorts, counts, and deep-links exactly as the agreed current behavior.

### Stage 5 — Report an Issue create flow

**Scope:** Migrate creation form, native-equivalent validation, save/error feedback, reset, and navigation. Reuse the existing `Issue`/`IssueService`.
**Likely files:** `ReportIssuePage`, `IssueForm`, option data/config, notification component, focused component tests.
**Risks:** Default/date/ID changes, double submission, changed validation, failed-write reporting, or mismatched category options.
**Validation:** Node service tests; component tests for valid/invalid/failure flows; manual persistence and redirect checks without network/Firebase.
**Rollback:** Legacy report page remains compatible with records created by React.
**Done:** Create behavior and stored JSON are compatible with the current MVP and failures are never reported as success.

### Stage 6 — Edit and delete flows

**Scope:** Add canonical edit route plus legacy query compatibility; populate and update form; add controlled delete confirmation and feedback.
**Likely files:** report/issues route components, dialog and notification components, compatibility utilities/tests.
**Risks:** Lost status/date fields, stale selected IDs, missing-record behavior changes, accidental deletion, timer/navigation races.
**Validation:** Existing and expanded service tests; component tests for found/missing/update/delete/failure states; keyboard focus restoration for dialog.
**Rollback:** Shared storage contract keeps the legacy CRUD pages usable.
**Done:** Existing records can be edited/deleted with parity, missing records are handled explicitly, and destructive actions remain confirmed.

### Stage 7 — Dashboard

**Scope:** Select and test canonical pure statistics functions; migrate cards, recent issues, and charts. Add Chart.js as an npm dependency only at this stage if still approved.
**Likely files:** statistics utilities/tests, dashboard components, chart wrappers/styles, package files for Chart.js.
**Risks:** Duplicated implementations disagree; chart lifecycle leaks; canvas accessibility; category filter link changes; CDN/package version visual differences.
**Validation:** Unit tests using representative/invalid data; chart mount/update/unmount checks; no-data/error states; responsive visual comparison; deep-link tests.
**Rollback:** Legacy dashboard continues reading the same issue data; remove isolated chart dependency/code if necessary.
**Done:** Counts, recent ordering, charts, empty/error states, and filter navigation match approved behavior without a global CDN script.

### Stage 8 — Remaining informational routes

**Scope:** Confirm whether About and Contact belong in the MVP. Add substantive approved content or explicitly exclude them; do not migrate empty shells solely for route count.
**Likely files:** optional page components and navigation configuration.
**Risks:** Inventing content, policy, contact details, or approved scope.
**Validation:** Content-owner review, links, metadata, accessibility.
**Rollback:** Exclude unapproved routes.
**Done:** Inclusion/exclusion is explicit; no placeholder route is presented as complete.

### Stage 9 — Cutover preparation and Firebase emulator validation

**Scope:** Make Vite the primary build, define legacy URL compatibility, propose the Firebase SPA rewrite, and test the full production artifact locally. Do not deploy without separate authorization.
**Likely files:** package scripts/lockfile, final Vite configuration, root HTML, Firebase Hosting configuration, route compatibility, deployment documentation.
**Risks:** Refresh/404 failures, old bookmark breakage, incorrect deployment target, asset caching/path issues, ambiguous `deploy` script.
**Validation:** Full tests/build; Firebase emulator direct-navigation matrix; old URLs; unknown routes; static assets; browser console/network inspection; accessibility and responsive smoke suite.
**Rollback:** Keep the prior Parcel build instructions and last known-good Hosting release; revert the reviewed cutover commit/configuration.
**Done:** A release candidate meets parity and Hosting behavior is proven locally, with a written rollback procedure and explicit deployment approval still pending.

### Stage 10 — Post-cutover cleanup

**Scope:** Only after stable, authorized cutover: remove Parcel, physical legacy pages, duplicate controllers, confirmed-unused placeholders/backups, CDN references, and obsolete assets. Update architecture/setup documentation.
**Likely files:** legacy HTML/assets, package files, README/docs.
**Risks:** Removing a hidden dependency or reducing rollback options too early.
**Validation:** Dependency/asset usage search; full tests/build; Hosting emulator; diff review; approved rollback window elapsed.
**Rollback:** Revert cleanup independently; retain source-control tag/release for the last Parcel version.
**Done:** One understandable React/Vite application and one production build path remain, with no unverified legacy removal.

## Vendor-neutrality and service boundaries

The React migration must preserve this conceptual direction:

```text
React CityVUE UI
        ↓
CityVUE application/service boundary
        ↓
future CityVUE API
        ↓
future Integration Router
        ↓
vendor adapters
```

- React components call CityVUE services/hooks using neutral CityVUE concepts; they do not know enterprise endpoints or vendor schemas.
- No privileged enterprise credentials or direct privileged API calls belong in browser components.
- The current `Issue` model remains a temporary prototype model during UI parity work.
- The future canonical `ServiceRequest` model must be designed independently of React and recorded through its own approved feature/ADR process.
- React Router route state and component prop shapes must not become the canonical business model.
- Firebase Hosting remains a delivery mechanism for static UI and does not define data ownership or integration architecture.

## Risks

1. **Combining migrations:** Changing framework, domain model, persistence, and routing together would make parity failures difficult to isolate. Keep them separate.
2. **Dual-system drift:** A parallel migration can become permanent. Use route-level stage gates and avoid feature development in both implementations where possible.
3. **Storage compatibility:** Both applications can read/write the same key, so any unapproved schema change could break rollback.
4. **Theme inconsistency:** Existing users may have one or both theme keys; an undocumented precedence rule could unexpectedly change appearance.
5. **Routing/Hosting mismatch:** A locally functioning SPA can still fail on Firebase refresh without rewrites.
6. **CSS import-order drift:** Global custom selectors and Bootstrap overlap; loading consolidation can materially change appearance.
7. **Chart dependency drift:** Moving from an unpinned CDN global to a package can alter APIs or visuals. Pin through the lockfile and test.
8. **Accessibility regression:** React does not automatically preserve semantic structure, focus behavior, modal focus, announcements, or keyboard navigation.
9. **Static-versus-live ambiguity:** Home statistics look data-driven but are hard-coded. Do not silently connect them to issue storage during parity work.
10. **Incomplete pages:** About/Contact should not be elevated into official routes without content and scope approval.
11. **Client-side security assumptions:** React routes provide no authorization boundary. Current management pages remain unprotected until a separate approved identity/API design.
12. **Learning complexity:** Premature abstractions, state libraries, or broad test stacks would obscure core React concepts and slow review.

## Rollback strategy

- Establish a source-control reference for the last validated Parcel MVP before implementation.
- Keep Parcel scripts and legacy pages intact throughout route migration.
- Keep the `cityvueIssues` key and record shape unchanged so legacy and React pages remain data-compatible.
- Develop and validate outside the current production Hosting target; any preview deployment requires separate authorization.
- Make the final Vite/Hosting switch a focused, reversible commit with emulator evidence.
- Retain the previous Firebase Hosting release/version for operational rollback when deployment is eventually authorized.
- Do not remove legacy code in the cutover change. Perform cleanup only after a defined stability period and explicit review.
- If a migrated route fails parity, route reviewers back to the legacy implementation or revert that isolated stage rather than patching production data.

## Acceptance criteria

This planning task is complete when:

- The actual Parcel/npm/Firebase/localStorage architecture is documented.
- Every major current page and workflow is mapped to sources, state, dependencies, React boundaries, and complexity.
- React, JavaScript, Vite, React Router, Bootstrap, Firebase Hosting, and Node testing are evaluated against repository evidence.
- Framework-independent logic and DOM-coupled code are classified.
- A proposed `src/` responsibility structure is documented without creating it.
- Built-in React state is recommended at the scope actually needed; no unjustified state library is introduced.
- Current routes, legacy URL compatibility, refresh behavior, SPA rewrites, and 404 handling are addressed.
- CSS, theme, Bootstrap, icons, Chart.js, asset, environment-variable, and Vite implications are documented.
- Incremental options are compared and a rollback-oriented method is recommended.
- Vendor neutrality and separation from the future API/integration layer are explicit.
- No production source, build tooling, Firebase configuration, dependency, or deployment is changed.
- Existing tests and production build pass, and `git diff --check` passes.

Future implementation is complete only after each approved stage meets its own definition of done; this document does not approve those changes.

## Unresolved questions

1. Is React/Vite formally approved after review of this assessment, or should a disposable proof of concept be evaluated first?
2. What browsers and device sizes form the required parity/support matrix?
3. Which current visual behaviors are intentional requirements, and which known defects should be fixed in separate tasks rather than preserved?
4. Should the React migration precede, follow, or pause around the vendor-neutral domain-model design? The recommendation is UI parity first or a clearly sequenced non-overlapping effort, never both in one change.
5. Are Issue List and Dashboard intended as future staff-only pages? If so, their current migration should preserve behavior without implying authorization, while the later security design determines access.
6. Should canonical routes use `/report` and `/issues/:issueId/edit`, or preserve current path shapes longer? What redirect lifetime is required for existing bookmarks?
7. Should search/filter state become fully URL-addressable, and must current hash links remain supported indefinitely or only through a defined compatibility period?
8. Which of the two existing theme keys takes precedence, and should preferences be migrated once or read compatibly for a period?
9. Are the hard-coded Home impact statistics and recent activity intentional prototype content, or should they be explicitly labeled before migration?
10. Are About and Contact approved MVP pages, and what content owner supplies their substantive content?
11. Should Chart.js remain the dashboard library when that stage begins, and which package version matches the currently rendered CDN behavior?
12. Is a Firebase preview channel or separate non-production site available and approved for migration review?
13. What accessibility acceptance process and tooling are required beyond keyboard/manual checks and focused component tests?
14. When should TypeScript be reconsidered: after UI parity, when the future API contract is defined, or not until project complexity warrants it?
15. What duration and evidence are required before deleting legacy Parcel pages after an eventual cutover?

## Recommended first implementation task

After this plan and the React/Vite direction are approved, perform **Stage 0 only**: create a concrete parity baseline and add regression tests for the pure issue-list filtering/sorting and dashboard-statistics behavior that React will reuse. This reduces migration risk without yet adding React or changing production behavior. React/Vite scaffolding should be a separately reviewed Stage 1 task after that baseline passes.
