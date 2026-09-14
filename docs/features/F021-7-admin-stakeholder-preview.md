# F021.7 — Admin Stakeholder Preview

**Date:** 2026-09-13. **Baseline:** main `a3ea16dcbf48312044b962127a8f8cc99ab26fd5`, initially clean.

## Purpose and route

`/admin-preview` is a presentation-only CityVUE Admin Portal for stakeholder demonstrations. It is a separate lazy React route outside AuthRoot, following F021.6's preview isolation. Existing routes, identity configuration, StaffRouteGuard and server authorization remain unchanged. The route is accessed directly; global resident and AI navigation targets are unchanged.

The preview uses CityVUE's Bootstrap theme tokens, typography, buttons, card radius, blue header and existing circular Rockville logo. It adds the requested dark blue grouped sidebar and local dashboard. The approved Admin Portal image was not found in the request attachment or repository; the detailed written layout requirements are the implementation reference pending image comparison. No alternate logo or generated mockup was introduced.

## Demo data and interactions

`adminPreviewData.js` owns explicitly fictional frontend data: totals 1,842 / 1,564 / 278 / 3, five sample activity rows, department counts 180 / 95 / 62 / 48 / 32, demo operational statuses and zero AI usage placeholders. Status indicators do not represent actual City infrastructure, Entra availability or monitoring. Date/user labels explicitly describe sample events and demo accounts.

Navigation updates the local active item and opens an explanatory panel. All six quick actions and the notification button open the same inert panel; they do not launch production workflows. Closing restores focus to the triggering button. The department selector chooses between two fixed sample arrays and reuses the existing DashboardChart/Chart.js implementation. Sidebar collapse and the existing ThemeToggle remain local UI interactions. No new dependency, fake provider or administrative backend module was added.

## Security isolation and persistence

AdminPreviewPage imports presentation, sample data and theme/chart components only. It has no auth context, token provider, repository, API client or backend configuration dependency. No Entra initialization, identity inheritance, City data request, admin write, alert publication, user/role change, service-catalog update, AI execution or monitoring request is implemented. The dedicated preview header cannot display an authenticated account: it always says Administrator (Demo).

Demo state stays in React memory and resets on refresh/unmount. No localStorage/sessionStorage/IndexedDB persistence is added for administrative data. The existing shared theme component may persist a theme preference; it never receives administrative data. No database, usage or audit record is written. Static assets and page resources are required to render the preview; there are no generic public-data calls from its shell.

## Responsive and accessibility

The desktop sidebar remains at the left with official branding at its bottom. Smaller viewports start with the navigation collapsed, expose an accessible toggle, and reflow navigation groups when expanded. Metrics form two columns on smaller screens; main panels stack. Activity rows retain semantic table headings and can scroll within a labelled keyboard-focusable region, without widening the page. The chart resizes and has an expandable text equivalent for every value.

Semantic headings, a skip link, labelled controls, focus outlines, informational panels with focus/return behavior, text status labels and descriptive logo alt text are included. The logo preserves its intrinsic aspect ratio. No modal focus trap is needed because actions open inline information. Dark mode uses the existing ThemeProvider and Chart.js theme behavior.

## Validation

Browser validation used the actual `/admin-preview` route in installed headless Edge at 390, 768 and 1440 CSS pixels, in light and dark themes. All six cases passed without page-level horizontal overflow. Logo aspect ratio, chart resize/text values, local navigation, focus/return behavior and panel actions passed. Smaller screens started with collapsed navigation. The activity table scrolls inside its own accessible region.

Browser traps for fetch, XHR, sendBeacon, IndexedDB and storage writes recorded zero calls during navigation/actions/chart selection; request inspection found no administrative, AI, public-data or identity API calls. Only local static/Vite resources were loaded. Screenshots were inspected at `%TEMP%/cityvue-admin-{width}-{theme}.png`; logo detail captures verified both themes. The subsequent built-page check verifies final dark-mode contrast and the shared theme toggle.

Final validation:

- React: 129 tests across 18 files passed; zero failed/skipped (six new admin tests).
- Backend unit: 106 passed; E2E: 29 passed; shared/legacy: 62 passed; zero failed/skipped.
- Server TypeScript, ESLint, Prettier and backend build: passed.
- React production build: passed, with the existing large-chunk advisory (534.60 kB main bundle). Existing DashboardChart code is shared between dashboard and admin preview chunks.
- All six final built-page viewport/theme cases passed without horizontal page overflow. Real theme toggles, refresh resetting panels and zero API requests were verified. Final captures: `%TEMP%/cityvue-admin-final-{width}-{theme}.png`.
- No separate frontend lint/typecheck/format scripts exist. Database suites were not repeated because backend/schema code is unchanged.

An initial ambiguous demo-account test query exposed a duplicate banner landmark; the dashboard welcome block was corrected. The lazy preview module is preloaded in test setup to avoid measuring transform latency as UI failure. No production guard or backend behavior was changed.

## Production Boundary

This feature is not the production admin system and does not grant administrative access. The banner explicitly states that actual administrative access requires City authentication and appropriate permissions.

A future production admin portal requires separately approved Entra authentication, RBAC, server-side authorization, audit logging, real API validation, organization scoping and controlled write operations. Build that portal behind protected routes and independently authorized APIs; do not turn this anonymous demo into a write-capable route. Review or remove sample navigation/data at that transition, retaining isolation and authorization regressions.

No deployment, live administrative function, provider connection, credentials, production admin development or F022 work is included.
