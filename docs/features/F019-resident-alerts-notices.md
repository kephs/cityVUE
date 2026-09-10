# F019 — Resident Alerts & Notices

Status: local foundation; no seeded alerts, administrative publishing, or deployment.

## Purpose and resident experience

Organization-owned municipal notices cover notice, service_disruption, utility, closure and emergency, with info, advisory, warning and critical severity. Multiple simultaneous notices are supported to avoid hiding a second disruption. The API orders critical first, then warning, advisory and info, followed by newest publication and stable ID. All active notices appear compactly above the Home hero.

No results, legacy mode, invalid content or a failed read renders nothing and reserves no space. Failure does not assert that there are no City emergencies. This is a supplemental notice surface, not a guaranteed emergency delivery system. In existing API mode, the shared anonymous API client loads on mount, polls every 60 seconds and refreshes on returning to the tab. A local expiration timer removes notices between polls. Deactivation may take up to one polling interval to reach an already-open page. No persistent client alert cache or dismiss control is added.

## Persistence and public API

Migration `20260910000000-create-resident-alerts.ts` creates `resident_alert`, following PostgreSQL snake_case and Kysely conventions. Fields: UUID id and organization_id; controlled type/severity; bounded plain-text title/message; nullable image_url/link_url/link_label; starts_at/expires_at; is_active (false by default); published_at/deactivated_at; created_at/updated_at; nullable created_by/updated_by/published_by/deactivated_by references to canonical StaffIdentity in the same Organization. There is an Organization/start/expiration partial index for active rows. No records are seeded. No normal delete operation exists; migration rollback is destructive schema rollback only.

`GET /api/v1/alerts/active` returns an array of explicit public DTOs: id, type, severity, title, message, linkUrl, linkLabel, startsAt, expiresAt, publishedAt, updatedAt. It returns `[]` when empty and `Cache-Control: no-store`. Organization, actor IDs, state flags and image URLs are excluded. Existing global correlation IDs, structured sanitized request logging, error filter, rate limiter, CORS and Helmet apply without overrides. Repository failures return sanitized platform errors; alert bodies are not logged.

SQL requires the server-configured Organization, is_active=true, publication at or before server time, no deactivation, starts_at <= server time, and expires_at null or strictly greater than server time. Expiration is enforced without a scheduled write/job. The existing `catalog.developmentOrganizationId` setting supplies local Organization context; no query/body parameter selects an Organization. Production Organization resolution remains part of the existing deployment readiness work.

## Validation and images

The domain validator explicitly invokes existing class-transformer/class-validator practices even without an HTTP write controller. It rejects unknown fields, unrecognized types/severities, blank or oversized text (title 160, message 4000, link label 100), angle-bracket markup, invalid calendar dates, dates without timezones, expiration at/before start, a link label without a URL, and non-HTTPS or credential-bearing URLs. Empty optional strings normalize to null. URL lengths are bounded to 2048. Database checks complement application validation; future writes must invoke the domain validator, not rely on the database's coarse HTTPS constraint alone.

Images are reserved nullable validated HTTPS metadata only. No approved media-host policy was found, so the public API omits image URLs and React never renders/downloads them. No upload route, proxy, arbitrary external image request, or CSP change is introduced. Future image support needs City-approved hosts/storage, privacy/CSP review and meaningful alternative-text policy. Links use HTTPS, new-tab disclosure and noopener/noreferrer. React renders text only, never injected HTML.

## Authorization and audit boundary

The Resident Alerts & Notices foundation does not bypass Microsoft Entra authentication. Administrative publishing remains subject to CityVUE server-side RBAC authorization.

Administrative HTTP routes, administrative UI, repository writes and role grants are intentionally withheld. F018's development staff fallback must not become an alert publishing path. Its current permission list has no alert management capability; this slice leaves those in-progress files untouched. The future `alerts.manage` key fits the existing resource.action convention but is planned, not registered or granted here. Integrate it into F018's `Permission` allowlist and StaffAuthorizationService, require verified Entra admission (never development fallback), derive Organization/actor from trusted StaffAccess, and authorize every transactional write before enabling management routes. City approval of role grants and live Entra UAT remain prerequisites.

Future management supports create/edit draft, publish/schedule, extend expiration, deactivate and history. Populate actor/timestamp fields server-side, preserve previous publication/deactivation records as appropriate, and add optimistic concurrency with transactional authorization tests. Nullable actor fields are schema preparation, not permission for anonymous writes. Latest-content metadata supports eventual auditing but is not a complete history: immutable content versions, repeat publication history, security audit events and retention policy remain future hardening. No event-sourcing system is introduced.

## Accessibility and visual behavior

The named section contains semantic articles with linked headings, visible severity words and decorative Bootstrap icons. Critical severity or emergency type uses role=alert; ordinary notices are not live regions. There is no focus movement or repeated clock announcement. Text wraps on mobile, uses existing Bootstrap theme variables, and retains underlined links. Images cannot carry essential information because none render. Manual screen-reader and responsive browser UAT remain required before production activation.

## Local validation and next steps

Run existing server unit/E2E/database scripts, React tests, typecheck, lint and builds. Database tests use TEST_DATABASE_URL and a unique disposable schema; without that variable they skip. The new database test exercises migration up/down, actual SQL visibility/order, defaults, constraints and cross-Organization actors. Never apply migrations to production as part of this foundation.

For local use, review/apply normal migrations in a development database and use existing VITE_CITYVUE_DATA_SOURCE=api / VITE_CITYVUE_API_BASE_URL and configured development Organization. No new environment settings are required. There is deliberately no publishing command or temporary password workaround. Next: complete F018 consent/UAT and approve alert administrator permissions before implementing transactional management and its UI. Later opt-in email/SMS/push channels require separate consent, accessibility, delivery/retry, deduplication and operations design.

## Implementation completion report

### Changes delivered

- Architecture: Organization-scoped vendor-neutral read foundation, multiple concurrent notices, explicit public DTOs, server-side expiration, no seeded content and no administrative publishing path.
- Added backend files: `server/src/alerts/alert.dto.ts`, `alert.domain.ts`, `alerts.repository.ts`, `alerts.service.ts`, `alerts.controller.ts`, `alerts.module.ts` (all under that directory).
- Added migration: `server/migrations/20260910000000-create-resident-alerts.ts`. Added only; not applied to a running database.
- Added frontend files: `react/src/alerts/alertsRepository.js`, `ResidentAlertBanner.jsx`, `residentAlerts.css` (all under that directory).
- Added tests: `server/test/unit/alerts.test.ts`, `server/test/e2e/alerts.e2e.test.ts`, `server/test/database/alerts.integration.test.ts`, `react/test/ResidentAlertBanner.test.jsx`.
- Added documentation: this F019 feature document and completion report.
- Modified existing files for this feature only: `react/src/pages/HomePage.jsx` (import/render banner), `server/src/app.module.ts` (register AlertsModule), `server/src/database/database.types.ts` (alert table/types).
- Endpoint: anonymous read-only `GET /api/v1/alerts/active`; no administrative write endpoints or UI. Management permission remains planned, not granted.
- Resident behavior: no banner/blank space by default; compact severity-labelled notices above the hero in API mode; secure optional links; images withheld; publication/expiration defense and refresh behavior described above.
- Security: server-owned Organization, parameterized SQL, default inactive state, explicit public field projection, bounded validated plain text/HTTPS links, platform logging/correlation/errors/rate limiting/TLS/CORS/security headers preserved, same-Organization audit actor foreign keys.
- Entra/RBAC: F018 remains intact, no new credentials or development publishing fallback. Future writes must use verified Entra and CityVUE server-side authorization.

### Validation results

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Backend unit suite | 83 | 0 | 0 |
| Backend E2E suite | 16 | 0 | 0 |
| React full suite, final run | 89 | 0 | 0 |
| Legacy unit suite | 62 | 0 | 0 |
| PostgreSQL integration suite | 0 | 0 | 5 |
| Focused alert backend tests (included above) | 38 | 0 | 0 |
| Focused alert React tests (included above) | 8 | 0 | 0 |

Strict TypeScript typecheck, backend build, final React/Vite production build, whole-server ESLint, feature-file Prettier checks and git diff whitespace checks passed. No dependencies or package scripts changed. Because npm was absent from the shell PATH, the installed Node runtime invoked the existing local compiler, test runner, linter and build entry points with the repository script arguments.

The initial full React run had 87 passes and two 5-second timeouts in existing ReportIssuePage tests. Its isolated rerun passed all 15 tests, and the final unchanged full suite passed all 89 tests; no timeout settings or existing tests were altered.

Limitations: TEST_DATABASE_URL is unset, no PostgreSQL listener was available on localhost:5432, and Docker inspection was denied by local pipe/config permissions. Accordingly all five PostgreSQL tests skipped, including the new migration test; live migration/SQL execution is not claimed. Final Vite build warns about the main 541.77 kB minified chunk exceeding 500 kB. Manual browser/responsive/screen-reader UAT remains pending. External images, transactional administrative writes, full historical versions and production activation remain deferred.

### Configuration and next step

No new environment settings. Review the migration and validate it against an isolated local PostgreSQL database using the existing test setup; then complete F018 consent/UAT and approve alert role grants before implementing administrative publishing. Existing API mode/base URL and development Organization configuration govern local reads. No alert content was inserted.

### Preservation and repository state

A pre-edit SHA-256 inventory covered 45 existing modified/untracked files. Forty-three remain byte-for-byte identical. Removing only this feature's additions from the two shared backend files reproduces their exact pre-edit hashes, confirming that their F018 content is preserved as well. HomePage was previously clean. No unrelated F018 or uncommitted work was reset, discarded, overwritten, reverted, stashed or cleaned.

No deployment, push, commit, reset, stash or repository cleanup was performed. Build commands regenerated their normal ignored build outputs. No production configuration was changed.

`git status --short` at completion (includes all pre-existing work):

```text
 M .env.example
 M docs/ARCHITECTURE.md
 M docs/CITYVUE_CONTEXT.md
 M docs/ROADMAP.md
 M package-lock.json
 M package.json
 M react/src/api/apiClient.js
 M react/src/app/router.jsx
 M react/src/components/navigation/PrimaryNavigation.jsx
 M react/src/config/runtimeConfig.js
 M react/src/main.jsx
 M react/src/pages/HomePage.jsx
 M react/src/residentIntake/residentIntakeRepositories.js
 M react/src/serviceRequests/serviceRequestDetailsData.js
 M react/src/serviceRequests/serviceRequestRepositories.js
 M server/.env.example
 M server/package-lock.json
 M server/package.json
 M server/src/app.module.ts
 M server/src/bootstrap.ts
 M server/src/config/configuration.ts
 M server/src/config/environment.ts
 M server/src/database/database.types.ts
 M server/src/database/seed-development.ts
 M server/src/service-request/get-service-request-details.service.ts
 M server/src/service-request/list-service-requests.service.ts
 M server/src/service-request/service-request.controller.ts
 M server/src/service-request/service-request.repository.ts
 M server/src/service-request/staff-actions.service.ts
 M server/test/database/staff-actions.integration.test.ts
 M server/test/e2e/service-request.e2e.test.ts
 M server/test/unit/environment.test.ts
?? docs/features/F018-phase-b-entra-authentication-rbac-foundation.md
?? docs/features/F019-resident-alerts-notices.md
?? react/src/alerts/
?? react/src/auth/
?? react/test/ResidentAlertBanner.test.jsx
?? react/test/StaffAuthentication.test.js
?? server/migrations/20260903020000-add-entra-rbac-foundation.ts
?? server/migrations/20260910000000-create-resident-alerts.ts
?? server/src/alerts/
?? server/src/auth/
?? server/test/database/alerts.integration.test.ts
?? server/test/e2e/alerts.e2e.test.ts
?? server/test/unit/alerts.test.ts
?? server/test/unit/entra-token.service.test.ts
```
