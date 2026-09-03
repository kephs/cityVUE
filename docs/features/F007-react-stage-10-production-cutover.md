# F007 — React Stage 10 Production Cutover

**Status:** Complete

**Scope:** Firebase Hosting production cutover from the retained Parcel MVP to the approved React/Vite MVP

## Production Result

The React/Vite MVP became the current production frontend on August 29, 2026 at approximately 11:07 PM America/New_York. The live Hosting URL is `https://cityvue-1.web.app`.

Only Firebase Hosting was deployed:

```powershell
firebase deploy --only hosting --config firebase.json --project cityvue-1
```

Firebase uploaded 19 files from `dist-react`, finalized the version, and released it successfully. Authentication, Firestore, Realtime Database, Functions, Storage, Remote Config, Extensions, and other Firebase services were not deployed or changed. Unlike the Stage 9 preview deployment, the live deployment emitted no Firebase Auth-domain synchronization warning.

## Git Safety and Reproducibility

The reviewed Stage 9 state was committed locally as `24658bf` (`chore: checkpoint React MVP cutover readiness`) and tagged `pre-react-production-cutover`. The production Hosting and script configuration was committed locally as `9635948` (`chore: configure React production Hosting cutover`). Neither commit nor the tag was pushed by Stage 10.

The pre-cutover tag points to the last configuration where the default `firebase.json` still serves Parcel `dist`. The production-config commit changes the default production target to React `dist-react` while adding a dedicated legacy rollback config.

## Production and Rollback Commands

React is now the intentional default:

```powershell
npm run build
npm run deploy
```

The explicit equivalents are `npm run build:react` and `npm run deploy:react`. Both deployment scripts restrict Firebase to Hosting for project `cityvue-1`.

Parcel remains available as the emergency rollback frontend:

```powershell
npm run build:legacy
npm run deploy:legacy
```

`firebase.legacy.rollback.json` serves `dist` and preserves the former production Hosting behavior. A rollback should restore or use the known-good legacy state, rebuild Parcel, deploy Hosting only through the rollback configuration, validate the legacy live site, and retain the React work for diagnosis. The `pre-react-production-cutover` tag and Firebase Hosting release history provide additional reference points; an operator must verify the intended project, site, config, and release before changing the live channel.

## Production Hosting Behavior

`firebase.json` now serves `dist-react`, rewrites unmatched URLs to `/index.html`, disables persistent caching for SPA documents, and gives hashed `/assets/**` files a one-year immutable cache lifetime. The React router preserves `/pages/report.html`, `/pages/issues.html`, and `/pages/dashboard.html`, including safe query-based historical edit reconstruction for `/pages/report.html?id=<issue-id>`.

Direct live loads passed for `/`, `/report`, `/issues`, `/dashboard`, `/about`, `/contact`, `/arbitrary-unknown-route`, and the three legacy URLs. `/about`, `/contact`, and arbitrary unknown paths render the React Not Found experience. Direct refreshes passed for `/report`, `/issues`, and `/dashboard`; no Firebase routing 404 occurred.

## Validation Evidence

- Node tests: 58 passed, 0 failed.
- React tests: 42 passed, 0 failed.
- Parcel rollback production build: passed.
- React/Vite production build: passed.
- `git diff --check`: passed for Stage 10 changes.
- `npm audit`: zero vulnerabilities.
- Production-config Firebase Hosting emulator: passed routes, refreshes, legacy mappings, assets, SPA fallback, overflow, and console review.
- Live Home and navigation: passed.
- Live Report workflow: Category selection, Service search, dynamic questions, Review, and create passed.
- Live Issue List: created record display, search, and Category filter passed.
- Live Edit: direct refresh, location update, and save passed.
- Live Dashboard: metrics, recent activity, charts, and Road category chart drill-down passed.
- Live theme: dark mode passed.
- Live console: no warnings or errors.
- Live route and chunk requests: HTTP 200; no broken or failed chunk requests observed.
- Cache headers: SPA documents use `no-cache, no-store, must-revalidate`; hashed JavaScript uses `public, max-age=31536000, immutable`.
- Production output: no source maps and no private-key, service-account, client-secret, bearer-token, or credential-bearing URL markers found.

The disposable live `Pothole` issue created at `310 Stage 10 Live Test Way` and edited to `312 Stage 10 Live Test Way` was permanently deleted after explicit confirmation. The live origin was verified at zero issues and the empty state afterward.

## Home and Report UX Production Promotion

The reviewed Home live-data enhancement and resident-facing Report intake enhancement were promoted together on August 30, 2026 at approximately 2:37 PM America/New_York. The prior production state is tagged locally as `pre-home-report-production-promotion` at `e2b38de`; the combined reviewed implementation is commit `23ab040` (`feat: promote reviewed Home and report UX enhancements`).

Only Firebase Hosting was deployed with the existing React production configuration. Firebase uploaded 20 files from `dist-react`, finalized the version, and released it successfully at `https://cityvue-1.web.app`. No other Firebase service was deployed or changed.

The promotion passed 58 Node tests and 48 React tests, the Parcel rollback build, the React/Vite production build, `git diff --check`, and `npm audit` with zero vulnerabilities. Hosted verification passed at 1440 px, 768 px, and 390 px in light and dark mode for the Home CTA, live zero-data metrics, Recent Issues empty state, responsive layout, Report Issue terminology, prominent Issue selection, icons, search, mobile focus/scroll behavior, and selection flow. Direct loads and refreshes for `/`, `/report`, `/issues`, and `/dashboard` passed with a clean browser console. SPA HTML and hashed JavaScript retained their intended no-cache and immutable cache headers, respectively. No synthetic production Issue was created.

The existing origin-specific browser-local persistence boundary and Parcel rollback path remain unchanged.

## Category Live Search Production Promotion

The reviewed Category Live Search enhancement and compatible Browserslist security remediation were promoted to production on September 1, 2026 at approximately 10:56 PM America/New_York. The prior production state is tagged locally as `pre-category-live-search-promotion` at `4e9507c`; the reviewed implementation is commit `3c9465a` (`feat: add Category live search and remediate Browserslist`). Browserslist was updated from 4.28.6 to 4.28.8 with its compatible browser-data dependencies.

Only Firebase Hosting was deployed with the existing React production configuration. Firebase uploaded 20 files from `dist-react`, finalized the version, and released it successfully at `https://cityvue-1.web.app`. No other Firebase service was deployed or changed.

The promotion passed 62 Node tests, 52 React tests, 11 backend unit tests, 2 backend E2E tests, backend typecheck/build/lint, the Parcel rollback build, the React/Vite production build, `git diff --check`, and root/backend audits with zero vulnerabilities. The database connectivity test was skipped because `TEST_DATABASE_URL` was not configured; no production or shared database was used.

Live verification passed Category name and description filtering, singular/plural/zero counts, both clear controls and focus restoration, full-width alignment, selected Category/Issue preservation while filtered, explicit different-Category reset, unchanged Issue search, mobile Category-to-Issue focus/scroll, 1440/768/390 responsive layouts, light/dark themes, direct loads and refreshes for `/`, `/report`, `/issues`, and `/dashboard`, and console/asset review. Category search produced no additional asset or network activity. No synthetic production Issue was created. `Issue`, `IssueService`, `cityvueIssues`, backend runtime behavior, Firebase configuration, and the Parcel rollback path were unchanged.

## Dashboard Department Analytics Production Promotion

The reviewed **Issues by Department** enhancement was promoted on September 2, 2026 at approximately 8:53 PM America/New_York. The prior committed production baseline is tagged `pre-dashboard-department-analytics-promotion` at `eeccdb1`. Only Firebase Hosting was deployed to `https://cityvue-1.web.app`; backend behavior and other Firebase services were unchanged.

The promotion passed 62 Node tests, 65 React tests, 16 backend unit tests, 7 backend E2E tests, backend typecheck/build, Parcel and React/Vite production builds, `git diff --check`, and root/backend audits with zero vulnerabilities. Direct production loads and refreshes passed for `/`, `/report`, `/issues`, and `/dashboard`; responsive empty-state checks passed at 1440, 768, and 390 px in light and dark mode with no horizontal overflow or console errors. The production browser origin contained zero Issues, so no synthetic production data was created and populated production verification relied on the approved populated local UAT and automated chart/count/lifecycle coverage.

Department analytics remain transitional presentation logic derived from exact legacy `Issue.category` matching against the active fixture Category and its owning Department, including optional Division ownership. Missing, unmatched, ambiguous, or invalid relationships are reported as **Unassigned Department**. Department and Division are not persisted on legacy Issues, `IssueService` and `cityvueIssues` remain unchanged, and no Department drill-down was added.

## Global Visual Scale and Readability Production Promotion

The reviewed presentation-only visual-scale refinement was promoted on September 2, 2026 at approximately 9:22 PM America/New_York. The prior production baseline is tagged `pre-global-visual-scale-promotion` at `e67f76b`. Only Firebase Hosting was deployed to `https://cityvue-1.web.app`; backend behavior and all other Firebase services were unchanged.

The promotion passed 62 Node tests, 65 React tests, 16 backend unit tests, 7 backend E2E tests, backend typecheck/build, Parcel and React/Vite production builds, `git diff --check`, and root/backend audits with zero vulnerabilities. The production bundle contained no source maps or backend source, loaded all reviewed chunks successfully, and retained legacy data mode.

Live direct-load and refresh checks passed for `/`, `/report`, `/issues`, `/dashboard`, an unavailable `/issues/:id/edit`, and an unknown route. Responsive checks passed at 1920, 1440, 1024, 768, and 390 px in light and dark mode, including mobile navigation, page gutters, controls, cards, empty states, and visible keyboard focus. Native browser zoom percentages could not be measured reliably by the automation environment; the approved preview and production review instead covered equivalent responsive reflow widths for 125%, 150%, and 200%, with no clipping, overlap, inaccessible controls, or critical horizontal overflow observed. A human native-zoom spot-check remains appropriate when operationally convenient.

Production contained zero Issues, so no synthetic production record was created. Populated Issue List, Dashboard, Department analytics, and Edit presentation remained covered by the approved preview/local UAT and automated regression suite. The refinement did not change filters, sorting, search, routing, chart-click behavior, edit/delete behavior, theme persistence, API-mode behavior, `Issue`, `IssueService`, or the `cityvueIssues` storage key. Production remains legacy/localStorage-backed, the backend remains undeployed, and Phase D2 has not started.

## Home Emergency Information Cards Production Promotion

The reviewed Home emergency-information cards were promoted on September 3, 2026 at approximately 2:35 PM America/New_York. The prior committed production baseline is tagged `pre-home-emergency-cards-promotion` at `34e05f6`. Only Firebase Hosting was deployed to `https://cityvue-1.web.app`; backend behavior and all other Firebase services were unchanged.

Home retains the unchanged Report an Issue card and replaces its former Issue List and Dashboard shortcuts with Police or Fire Emergency guidance linked to `tel:911` and Water/Sewer Emergency guidance linked to `tel:2403148567`. The call links use descriptive accessible names, decorative icons, visible keyboard focus, compact aligned buttons, and a consistent `0.5rem` icon/text gap.

The promotion passed 62 Node tests, 79 React tests, 26 backend unit tests, 10 backend E2E tests, backend typecheck/build, Parcel and React/Vite production builds, `git diff --check`, and offline root/backend audits with zero vulnerabilities. Live direct-load and refresh checks passed for `/`, `/report`, `/issues`, and `/dashboard`; responsive checks passed at 1440, 768, and 390 px in light and dark mode with equal-height card presentation, no horizontal overflow, missing assets, or console errors. No synthetic production Issue was created. `Issue`, `IssueService`, `cityvueIssues`, legacy persistence, and the Parcel rollback path remain unchanged.

## Bundle and Performance Record

The initial JavaScript is 288.45 kB minified / 92.05 kB gzip. Dashboard and Chart.js remain isolated in a deferred 214.49 kB minified / 72.74 kB gzip chunk. Page chunks range from 5.34 kB to 15.95 kB minified. The 311.98 kB shared CSS compresses to 45.25 kB gzip. The approximately 2.12 MB Home hero PNG remains a known later optimization candidate and did not block cutover.

## MVP Boundaries and Known Limitations

Production remains a browser-only MVP. `IssueService` persists the unchanged legacy `Issue` shape under the origin-specific `cityvueIssues` localStorage key. Data is confined to one browser/profile and production origin; it is not synchronized with the Stage 9 preview, emulator, other browsers, devices, or users. There is no backend, database, authentication, server authorization, centralized persistence, backup, multi-user collaboration, or enterprise-system integration.

Parcel source, legacy HTML, Parcel dependencies, `dist` build capability, and rollback documentation remain intact. Stage 10 did not change `Issue`, `IssueService`, `cityvueIssues`, catalog relationships/search semantics, dynamic-question behavior, anonymous behavior, the compatibility mapper, or future canonical-domain requirements. It did not begin backend/API, identity, Assignment, workflow, structured `Answer[]`, attachment, Admin, notification, or EAM work.

## Next Phase Boundary

Do not begin implementation automatically. The next development phase should start with an approved design decision for the vendor-neutral CityVUE API and persistence boundary, including data ownership, security, identity/authorization sequencing, migration of browser-only records, observability, backup/recovery, and canonical `ServiceRequest` contracts. F002 and F003 remain requirements inputs rather than implemented production schemas.
