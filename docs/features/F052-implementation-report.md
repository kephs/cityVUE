# F052 implementation and validation record

Status: **implemented and validated; local commit checkpoint for review**. Starting HEAD and unchanged `origin/main`: `4deeb9d3ad99fa9c4d67563cd0dfb9baa1050b9e` on `main`. No push, deployment or F053 work.

See the [specification](F052-organization-administration-foundation.md) and [ADR-014](../architecture/decisions/ADR-014-administrative-configuration-authorization.md) for design, API/route inventory, source of truth, query strategy, threat model, approved resource revisions, audit contract and deferred production prerequisites.

## Automated evidence — 2026-09-23

| Check                                     | Result                                                 |
| ----------------------------------------- | ------------------------------------------------------ |
| Backend unit                              | 239 passed                                             |
| API E2E                                   | 40 passed                                              |
| Full PostgreSQL integration               | 254 passed, zero skips                                 |
| Shared JavaScript                         | 64 passed                                              |
| Full React                                | 520 passed, 36 files                                   |
| Focused Admin React                       | 11 passed                                              |
| TypeScript test compilation               | Passed                                                 |
| Backend build and typecheck               | Passed                                                 |
| Backend ESLint                            | Passed                                                 |
| Frontend production build                 | Passed; existing >500 kB chunk advisory                |
| Frontend lint                             | No configured script                                   |
| Formatting                                | Passed after the final test-only formatting correction |
| Local Markdown links / private-value scan | Passed for the final implementation file set           |
| Whitespace                                | Passed                                                 |

The 1,117 full-suite test passes include focused F052 and prior-feature regression coverage. Existing script entrypoints were executed using installed Node binaries because npm is unavailable in this environment. PostgreSQL used `TEST_DATABASE_URL` only in the process and disposable schemas; no test fixtures were written to personal development.

F052 database tests exercise migration apply/down/reapply and zero grants, 401/403/200 real guards, strict query/route forgery, own-Organization isolation despite forged headers, absent write routes, concurrent read consistency, no-store safe projections, independent revisions/no-op behavior, conditional stale-write rejection at the database layer, enabled/no-area versus disabled/no-area health, safe unavailable default-target warnings, revocation and logging privacy. The HTTP Admin-only principal is denied request, analytics, Contact, Notes, Communication, attachments, tracking, history, assignment-target and geospatial access. Unit tests cover every existing permission in both directions and broad-bundle exclusion. F036's real provisioning helper is dry-run safe, idempotent, narrowly additive and independently revocable with unchanged existing scopes.

Fixture corrections during validation were confined to disposable tests: the foreign Organization already had an Issue; a broken-target test needed its own valid assignment fixture; the provisioning test must run before deliberate role corruption and select an existing scope rather than restore one removed by earlier tests. Final full PostgreSQL validation passes with those assertions active. No production guard was weakened.

## Development migration and integrity checkpoint

The verified personal development target was `localhost:5432 / reqro_dev / reqro_dev_user`, with explicit development profile. Applied only `20260929000000-add-admin-configuration-foundation` after disposable validation. Development now has **29 applied migrations / 0 pending**, one Admin permission definition and **zero Admin grants immediately after migration**. After the required denial confirmation, one explicit development grant was provisioned. Collection remains enabled at initial resource revision 1; all three active areas have individual revision 1. Existing F048/F049/action revisions are unchanged. No global configuration revision or Admin write permission exists.

A before/after hash comparison excludes only the two newly introduced revision columns. All original configuration, requests, Contact, requester links, location, assignment/watchers, Activity, Notes, Communication, attachments remain unchanged. Existing permission and membership rows remain unchanged; the deliberate Admin grant adds one role-permission row and updates its existing role provisioning metadata. This includes all 13 requests and SR-202609-000013. Safe tracking id/state/timestamp metadata is unchanged at **1 active / 5 revoked**; no credential/digest inspection or tracking operation occurred. Four private attachment file hashes and deployment threshold are unchanged.

Existing participation analytics-read audit records increased from 7 to 22 during the development interval; all seven original rows are unchanged. These append-only read audit additions are reported separately from domain/configuration changes. F052 Admin reads append no audits and run in read-only transactions. Final post-UAT comparison confirms all original rows are unchanged. Their initiating analytics reads were not established by this check; they are not attributed to F052 Admin reads.

## Live Admin UAT — 2026-09-23

The developer restarted the API outside the restricted sandbox. Normal personal Entra sign-in produced the protected Admin denial; the user explicitly confirmed HTTP 403 before provisioning. F036 inspect found one existing personal development principal. A reviewed dry run and confirmed operation added only `admin.configuration.read` using an existing Public Works scope. Existing memberships and all prior permission rows were preserved. Authorized reads then populated all six Admin views.

Live projections show six Issues, three active Participation Areas, collection enabled at revision 1, area revisions 1, existing independent Issue revisions, and deployment-owned threshold 5 without an Admin revision. Health checks pass. Navigation and Refresh perform no configuration writes. All six views were checked at 1440/1280/1024/768/390 pixels in light and dark themes: no horizontal overflow; section navigation focuses the heading; mobile navigation collapses after selection. Keyboard Tab reaches Refresh, and the Staff workspace link returns to the operational surface. Viewport override and light theme were restored. This is development accessibility evidence, not certification.

Live review found poor theme-button contrast on the light header and weak outlined-button contrast in dark mode. Admin-scoped Bootstrap button variables now use theme emphasis/body colors; shared components remain unchanged. Revalidated visually, reran all 11 focused Admin React tests and the frontend production build successfully (existing large-chunk advisory remains).

Post-grant integrity: all original domain/configuration rows, 13 requests, memberships, tracking metadata and four private attachment files unchanged. Role-permission rows increased 35 to 36; one existing development role changed its provisioning metadata. Participation audit rows increased 7 to 22 over the development interval, with all original rows unchanged; their initiating reads were not established by this check and are not attributed to Admin reads. Admin queries remain read-only and append no audit.

One explicit development Admin grant is retained. Final collection and all three area revisions remain 1. The user confirmed normal-log privacy with “Absent” after denied and authorized reads. Logging privacy gate: **PASS**. No logs, tokens, screenshots or response captures are included in this checkpoint.

## Administrative authorization and source of truth

Authenticated Entra staff → trusted active Organization → exact `admin.configuration.read` → guarded `AdminConfigurationController` → `AdminConfigurationService` → authoritative configuration. No global Admin flag or Organization switch exists. The only added HTTP route is `GET /api/v1/admin/configuration`; no normal Admin POST, PUT, PATCH or DELETE route exists. The UI's guards and navigation are not security boundaries.

| Capability                   | Admin configuration read alone | Required independent authorization                      |
| ---------------------------- | ------------------------------ | ------------------------------------------------------- |
| Read configuration           | Yes, own Organization          | Exact Admin permission                                  |
| Read Service Requests        | No                             | Existing PUBLIC/INTERNAL permissions and scope          |
| Read Requester Contact       | No                             | Parent access plus Contact permission                   |
| Read Internal Notes          | No                             | Parent access plus Notes permission                     |
| Read Requester Communication | No                             | Parent access plus Communication permission             |
| Read attachments             | No                             | Existing parent and attachment authorization            |
| Read F050 Requester History  | No                             | Existing F050 authorization and request scope           |
| Read participation analytics | No                             | Analytics permission plus existing PUBLIC request scope |
| Manage assignment            | No                             | Existing F037 command authorization                     |
| Manage requester tracking    | No                             | Existing F044 authorization                             |
| Read geospatial data         | No                             | Existing geospatial authorization                       |

Administration is not an authorization bypass into operational data. Analytics, operational and other permissions do not grant Admin access. Migration grants remain zero by default; broad bundles are unchanged. Live personal UAT proves authenticated denial before the explicit grant and successful loading afterward. Disposable real-guard tests prove HTTP 200, Admin-only operational denial, permission independence and revocation. No tokens were copied for UAT.

The route/source table in the specification describes every section. Issues use the catalog and F048/F049 configuration; intake uses the Organization collection resource; areas use Organization-scoped area rows; privacy uses validated deployment policy; health evaluates those resources. No demo fixture is authoritative. `/admin-preview` remains the clearly separate demonstration route; `/admin` requires the real guarded API.

Snapshot reads use four bounded/set-based data queries in a repeatable-read, read-only database transaction. Issue and area pages contain at most 25 items each. Database resources have independent revisions; runtime deployment policy has none and is outside database snapshot consistency. Refresh clears old component data and requests a new snapshot. No persistent browser configuration cache, unbounded request scan or per-Issue query exists. Production-volume performance has not been benchmarked.

## Health, concurrency and audit examples

Actual safe health wording includes:

- **OK — Service Participation:** “Collection is enabled with 3 active Participation Areas.”
- **WARNING — Service Participation:** “Collection is enabled but no active Participation Areas are configured. Intake will not collect participation geography until an area is available.”
- **OK — Issue default assignment:** “Configured default assignment targets are available. No default assignment is also valid.”
- **WARNING — Issue default assignment:** “1 Issues have a configured target that is unavailable. Review Issues for details.” The per-Issue label is “Configured target unavailable.”

Warning states were tested in disposable schemas; no broken development configuration was retained. Health performs no repair. Reads leave revisions unchanged. Future Area A revision 4 → authorized validated conditional update → revision 5; another writer submitting expected revision 4 must receive 409 Conflict. Updating Area B or an unrelated Issue does not stale Area A. F052 tests the database comparison foundation and exposes no write endpoint implementing that future HTTP contract.

Existing F048/F049 immutable configuration audits remain. The new typed allowlisted mutation contract covers trusted actor/Organization/correlation, resource, changed fields and prior/new revision; it contains no arbitrary protected payload. Future write features must add appropriate immutable persistence and atomic audit failure behavior. F052 does not manufacture mutation events for reads or claim the contract is an implemented audit store.

## Files and scope

- Backend: new Admin module/controller/service/domain; registration and exact permission; revision migration, schema types and shared collection provisioning helper; narrowly extended existing development tooling.
- Frontend: real Admin page, scoped responsive/theme styles and protected route. Existing preview remains unchanged.
- Tests: Admin unit/database/React coverage plus integration-suite registration and F036 provisioning regression coverage.
- Documentation: F052 specification/report, ADR-014 and indexes; architecture, context, roadmap and server runbook.

Security/configuration/tracking/logging gates pass. All historical request and configuration values, including SR-202609-000013, remain unchanged. No Issue, default assignment, identity policy, collection setting, area or privacy-threshold mutation was used for live UAT. No grant-management UI, Entra administration, requester directory/merge/split, database/deployment controls, secret management, audit editing/deletion, impersonation, import/export or additional analytics surface was introduced. No new dependency, production/client/cloud resource change, push, deployment or F053 work occurred.

The two ignored F052 integrity files were physically removed after the final comparison. No F052 logs, screenshots, temporary fixtures, database dumps or generated private files are retained. Final local Markdown links, private-configuration/credential-pattern scan and whitespace checks passed across the 28 changed/new files.

## Development foundation and production prerequisites

This delivers a development read-only administration foundation: protected responsive portal, explicit Admin permission, Organization-scoped authoritative projections, health diagnostics and independent revision infrastructure. Development migration is required and applied; the developer API was restarted normally outside the restricted sandbox. One narrow Admin grant is deliberately retained alongside unchanged prior grants and scopes.

It is not a complete production administration capability. Production requires approved administrative governance/roles and provisioning, resource ownership, audit retention, separate future write authorization and 409 enforcement, change control, Participation Area administration, privacy and Issue governance, and security review. Existing large frontend chunk warnings remain; frontend lint has no configured script. Accessibility checks are development observations, not certification.

The local feature commit is based on `4deeb9d3ad99fa9c4d67563cd0dfb9baa1050b9e`; its exact resulting hash and final working-tree/ahead-behind verification are reported with delivery rather than self-referenced inside the commit. Recommended next step: review this local checkpoint. GitHub synchronization requires separate authorization.
