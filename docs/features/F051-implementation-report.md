# F051 — Implementation and validation record

Status: implemented and validated; automated, functional UAT and developer-log privacy gates passed. Starting HEAD: `a093cfa3ec635250b2f44128652a075dd5a4ab81`, synchronized `main`. No push, deployment or F052. The intended local commit is `feat(analytics): add service participation geography foundation`; its hash and final Git status will be reported after completion gates pass.

This record groups the original specification's completion items by subject. The approved design is in [F051](F051-requester-geography-service-participation.md) and [ADR-013](../architecture/decisions/ADR-013-operational-participation-geography.md).

## Meaning, model and collection (items 10–58, 189–205)

Requester Geography means **self-reported service-participation area**, not residence. The requester-facing question is **“Which area do you associate with this service request? (Optional)”**, with No selection and Prefer not to say. Help explicitly states that the answer is optional, does not change or derive from Service Location, and can be supplied anonymously. The sole source is **EXPLICIT REQUESTER SELECTION**. Service Location, device location, photo GPS/EXIF, Contact/address, IP, previous history, attachments and trusted identity never establish it.

| Property                         | Final behavior                                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Area scope / identity            | Organization; opaque stable UUID                                                                                                    |
| Display name / optional code     | Bounded `display_name`; no separate code                                                                                            |
| Active state / order             | Active areas admit new selections; `display_order`, label and UUID give deterministic order                                         |
| Geometry / requester coordinates | Neither stored; no new geography provider, point map or enrichment                                                                  |
| Rename / deactivation            | Historical references retained, current display label used; inactive areas unavailable for new selection                            |
| Deletion                         | Referenced areas cannot be deleted                                                                                                  |
| Request storage                  | Immutable `requester_geography_state` and nullable `participation_area_id` on ServiceRequest                                        |
| PROVIDED                         | Explicit active same-Organization area required                                                                                     |
| DECLINED                         | Explicit Prefer not to say; area must be absent                                                                                     |
| NOT_COLLECTED                    | Omitted optional input or legacy request; no area; clients cannot explicitly assert this state                                      |
| Historical migration             | Default NOT_COLLECTED only; no inference, area backfill or identity rewrite                                                         |
| New-write strictness             | Strict DTO plus service checks, state/area CHECKs, PUBLIC-only participation, composite Organization FK and immutable-field trigger |
| Configuration                    | Guarded `dev:participation` dry-run/confirm creates/reuses three fictional areas only; no startup provisioning                      |
| Production administration        | Deferred, including configuration audit and approved area/retention/correction governance                                           |

PUBLIC web/API and assisted intake accept voluntary explicit selection. Anonymous PROVIDED and DECLINED remain Contact-free and Requester-link-free; identified intake retains F039 name-required/email-optional Contact protection. Contact-only identified intake stays unlinked. Trusted F050 intake can link the same Requester to requests with different areas without changing the Requester entity. Assisted PUBLIC keeps authenticated staff submitter attribution. INTERNAL rejects participation input and preserves staff attribution.

Back/Edit and Review preserve selection; identified/anonymous switching preserves area while the existing anonymous transition erases Contact draft. Review separates optional participation from Service Location. Confirmation retains the existing safe receipt rather than adding geography. Changing manual Service Location leaves participation unchanged and vice versa. Mocked device geolocation affects Service Location only; no live device location was requested. Synthetic EXIF/GPS evidence is stripped under F046 and cannot provide area or identity. Finalized attachment retries retain the original receipt/area even after deactivation; altered input fails, concurrent retries produce one request, and required creation audit failure rolls back.

F050 Requester has no geography/profile field. History, Contact, F047 search, F044 tracking, F042 communications and ordinary staff list/detail do not gain individual geography. Geography creates no Contact or identity evidence and affects neither F048 default assignment nor workflow/routing. F046 storage, evidence limits and metadata handling remain intact. No tracking credential operation was performed.

## Analytics contract and disclosure (items 59–96, 206–226)

`GET /api/v1/staff/analytics/service-participation` requires normal Entra identity, trusted active staff/Organization, dedicated `analytics.service_participation.read`, and existing `service_request.view` plus actual Department/Division scope. PUBLIC scope is applied in SQL before grouping. INTERNAL and inaccessible requests never contribute. The new key has zero migration/default/broad-bundle grants and is not inferred from geospatial/read permissions. Public area choices use the server-configured intake Organization; authenticated assisted choices use trusted staff Organization. Browser Organization claims cannot widen either.

| Contract             | Behavior                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metric               | Requests, not people, residents, households or unique requesters                                                                                        |
| Period               | Required strict `startDate`/`endDate`, UTC YYYY-MM-DD, inclusive end implemented by half-open timestamp range                                           |
| Bounds               | 28–366 days, no future end; preview defaults to last 365 days including today                                                                           |
| Threshold            | Server `PARTICIPATION_SUPPRESSION_THRESHOLD`, integer 5–1000, default and hard minimum 5                                                                |
| Suppression          | Positive count below threshold becomes `{suppressed:true,count:null}` on the server; at/above threshold exact, zero remains zero                        |
| Secondary buckets    | DECLINED and NOT_COLLECTED receive the identical suppression rule                                                                                       |
| Areas                | All configured Organization areas, including inactive historical areas, in deterministic order; response presence does not reveal inaccessible requests |
| Response             | Period/timezone, threshold, area IDs/labels and safe cells, declined and notCollected cells only                                                        |
| Totals / percentages | Omitted, with no hidden exact-count or alternative total field                                                                                          |
| Cache                | No-store, including authorization denial; no persistent analytics cache                                                                                 |
| Audit                | Required append-only participation_read before disclosure; actor/Organization/period/threshold/correlation/time only; audit failure fails closed        |
| Logging              | Existing safe route/status/correlation metadata; no requester selection, body, aggregate cell, token or exact suppressed-count logging                  |

There are no individual records, Requester IDs, request IDs/references, Contact, Service Location, coordinates, narratives, attachments, identity-mode breakdowns, arbitrary cross-tabs, drill-down, exports, requester-point maps, demographics, population denominators/rates, equity scores or geographic classifications. The preview is a direct protected route at `/staff/analytics/service-participation`; no global navigation item was added.

Complementary disclosure is addressed by suppressing all applicable small cells and omitting grand totals/percentages. Example: counts 7 and 3 disclose 7 and suppressed/null, never total 10. Limited dimensions and minimum periods reduce but do not eliminate differencing across overlapping periods, changing data/scope or independently available totals. This is deterministic suppression, not differential privacy or a production statistical-disclosure guarantee.

## Migration, development state and integrity (items 7–9, 109–141)

Migration required: **Yes**, `20260927000000-add-service-participation`. Disposable apply/down/reapply passed before personal development migration. Retained area/audit/participation data prevents destructive rollback. The target was verified as localhost:5432 / reqro_dev / reqro_dev_user, explicit development environment/profile. Final migration state: **27 applied / zero pending**.

The guarded CLI passed read-only dry-run and confirmation. It retained three active fictional areas (North, Central, South); inactive count zero. It created no requests or grants. Production/client infrastructure and configuration were not changed.

Before provisioning, the authenticated analytics page exposed no controls/counts and the user independently confirmed **HTTP 403**. A reviewed F036 dry-run selected only `analytics.service_participation.read`; confirmation added exactly that key to the already-owned personal-development role. Existing Public Works/Streets and Community Services/Parks memberships were verified active before execution and remained unchanged. No permission replacement, broad bundle or scope expansion occurred. Exactly one role_permission row was added; the owned role provenance description was updated accordingly. Existing staff identities, role assignments and all memberships remain unchanged.

| Final development check                                       | Result                                                                                              |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Requests / state distribution                                 | 13: PROVIDED 1, DECLINED 0, NOT_COLLECTED 12                                                        |
| Anonymous + PROVIDED                                          | 1                                                                                                   |
| Anonymous + Requester link                                    | 0                                                                                                   |
| Cross-Organization area references / invalid state-area pairs | 0 / 0                                                                                               |
| Retained F051 request                                         | SR-202609-000013, created once through normal public intake                                         |
| New request identity / Contact / link                         | Anonymous; zero Contact; null F050 Requester link                                                   |
| New request operational state                                 | Open; one normal Service Location, one answer, one active STAFF default assignment                  |
| New operational/security history                              | Two creation/default-assignment events and two security Activity rows                               |
| F050 Requester / existing trusted links                       | One Requester and two earlier links preserved; no new identity                                      |
| Tracking                                                      | 1 active / 5 revoked, unchanged; new request not issued                                             |
| Attachments / private files                                   | Three attachment rows and four private files unchanged; no new upload                               |
| Analytics audit                                               | Three successful participation_read rows at threshold 5 at final audit check; no data/count columns |

Baseline hash comparison covers all original requests (status/revision/updatedAt and other pre-F051 fields), locations, Contact, Requester/history, assignment, watchers, Activity, Notes, communications, attachments, catalog, policies and configuration. **All original domain rows are unchanged.** Only the intentional role provenance update differs among original authorization rows. F049 policies, F048 defaults, Contact count eight, watcher count three, Notes three, communications four, attachment audit 48 and Requester history audit three remain unchanged. Private-file hashes and safe tracking id/status/timestamp snapshots match baseline; no credential/digest was read for this comparison.

## Live UAT and accessibility-oriented observations (items 97–117)

The developer restarted the API outside the restricted sandbox for normal Entra signing-key retrieval. No token copying, decoding, authentication bypass or permission change was used to repair a 401. The pre-grant denial was separately confirmed as 403 before provisioning.

Both intake and authorized analytics were visually checked at **1440, 1280, 1024, 768 and 390** pixels in light and dark modes. F051 controls and content remained readable and reachable; mobile labels and date controls wrapped without horizontal overflow. The pre-existing full navigation is crowded at 1280 with a signed-in name (including branding wrapping); F051 adds no navigation entry or global layout change. No F051-specific layout defect was found. Final review corrected the new page's unconfigured-auth fallback text to say Service Participation instead of inheriting the shared AI-workspace default.

Intake selector has associated label/help, optional semantics, visible focus and normal Tab order into the next control. Back/Edit, identified draft, declined draft and anonymous Review were exercised. A fictional Contact draft was removed before anonymous submission. The sole successful request was SR-202609-000013; no second request was created. Confirmation explicitly said no Contact was collected. Changing Service Location preserved the selected area; changing area/declining preserved Service Location. Live device geolocation was intentionally not requested; mocked automated coverage verifies the separation without accessing personal location.

Authorized analytics showed the provided area as “Fewer than 5 requests,” two zero area cells, zero declined and nine authorized not-collected requests, with no total/percentage. Its labels identify request counts, self-reporting, scope and limitations. A one-day period failed safely while keeping editing controls available; restoring a valid period with keyboard Enter recovered the result. Permission-loss cleanup, cancelled/stale response handling and audit-failure denial have automated coverage. Ordinary authenticated staff detail for the new request displayed normal assignment and anonymous Contact state, with no participation area.

Theme restored to light and viewport override reset. No screenshots, HAR, tokens or private browser exports are retained for commit. These are development accessibility checks, not WCAG certification. **User confirmed “Absent” for discarded Contact draft, raw bodies, individual selections, analytics response bodies/hidden counts and bearer tokens in normal API logs.** Live audit inspection returned only column names/action/threshold/row count; no sensitive metadata values were printed.

## Validation evidence (items 142–183)

| Check                                            | Result                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend unit                                     | 237 passed                                                                                                                                  |
| API E2E                                          | 40 passed                                                                                                                                   |
| PostgreSQL integration                           | 241 passed, zero skips; subsequent added assisted-anonymous case passed with all 197 affected-suite cases, giving 242 covered cases overall |
| Shared                                           | 64 passed                                                                                                                                   |
| React                                            | 505 passed across 35 files                                                                                                                  |
| TypeScript                                       | Test compile, application typecheck and production compilation passed                                                                       |
| Backend lint / server formatting                 | Passed; final new test also checked after its addition                                                                                      |
| Frontend lint                                    | No configured script; not claimed                                                                                                           |
| Backend / frontend builds                        | Passed; existing frontend >500 kB chunk advisory remains                                                                                    |
| Whitespace                                       | git diff --check passed; Windows LF/CRLF notices only                                                                                       |
| Documentation links / staged private-data review | Passed; final staged review required before commit                                                                                          |

Commands follow package scripts using installed Node entrypoints because npm is unavailable in the tool shell: TypeScript `tsc -p tsconfig.test.json`, compiled `node --test` suites (E2E concurrency 1), Vitest with `vitest.config.mjs --maxWorkers=1`, ESLint, Prettier, TypeScript build/typecheck and Vite build. PostgreSQL tests receive only the configured disposable TEST_DATABASE_URL without printing it. No dependencies were added or upgraded.

Focused tests pass for area catalog/projection/order; state/area consistency; cross-Organization, unknown and inactive input; anonymous/Contact-only/trusted identity separation; assisted staff attribution; immutable legacy fields; location and mocked geolocation independence; synthetic EXIF/GPS handling; retries/concurrency; zero default grants and broad-bundle exclusion; dedicated permission plus scope; suppression at 0, 1, 4, 5 and 6; secondary buckets; no response totals/individual fields; mandatory append-only audit and failure atomicity. A scope-gain fixture changes a suppressed three-count bucket to five only when its additional two requests become independently accessible.

Prior F029, F039, F042, F044, F045, F046, F047, F048, F049 and F050 regression coverage passed within the suites. Geography never becomes a search term, assignment criterion, Contact field, tracking field or trusted identity property. Original request snapshots remain unchanged across the F051 disposable migration and operations.

## Performance, threat review and production boundary (items 184–188)

The backend executes one scoped SQL aggregate, one configured-area query and one audit insert in repeatable-read isolation, plus existing authentication/authorization lookups. It never downloads all request rows to React and has no N+1 request retrieval. A PUBLIC partial Organization/created_at/area index supports date restriction; an active-area ordering index supports choices. EXPLAIN ANALYZE on the actual scope/grouping shape showed Aggregate/Sort/Nested Loop with index scans; one small-fixture run chose a sequential scan. This is local fixture evidence, not a production-scale benchmark. Cost grows with scoped period volume and configured area count; future optimization must preserve authorization/suppression and avoid hidden totals.

Threat review covers unauthorized aggregate disclosure, cross-Organization substitution, inactive selections, historical rewriting, anonymous reidentification, location/Contact/GPS inference, profile linkage, audit/log leakage, suppressed-cell reconstruction, repeated-window differencing and statistical misinterpretation. Controls and residual risks are recorded in ADR-013. No consequential design decision beyond the user's approved model was introduced.

Classification: **development foundation, not production-ready analytics governance**. Production needs approved coarse area labels/ownership, administration authorization/audit, tenant-resolution deployment review, retention/correction policy, access governance, statistical-disclosure review and representative load evaluation. Data describes voluntarily supplied areas attached to requests; it cannot establish residence, service need, access equality, population participation or causal fairness. Demographics, population rates, equity scoring/classification, exports, individual drill-down, maps, identity enrichment and geography-based assignment remain deferred.

## Changed files and completion boundary (items 1–6, 227–231)

Backend additions: one migration; participation domain/service/controllers; guarded development provisioning CLI; unit/database checks. Backend edits: typed schema, DTO/creation transaction, module registration, permission registry and explicit development-key allowlist, configuration/environment validation, package script, example environment and operator README. Frontend additions: optional ParticipationInput, protected ServiceParticipationPage and component tests. Frontend edits: router, intake repository wiring, Issue form/Review and canonical payload mapping. Documentation: F051 specification/report, ADR-013 and architecture/context/roadmap/feature/ADR indexes.

No tracking operation, production/client resource change, deployment, push or F052 work. Completion includes final privacy/link/staged review, removal of task-created temporary baseline artifacts, and the authorized local commit. Full hash/status/ahead-behind will be reported after that commit.

## File inventory

- `docs/ARCHITECTURE.md`
- `docs/CITYVUE_CONTEXT.md`
- `docs/ROADMAP.md`
- `docs/architecture/decisions/ADR-013-operational-participation-geography.md`
- `docs/architecture/decisions/README.md`
- `docs/features/F051-implementation-report.md`
- `docs/features/F051-requester-geography-service-participation.md`
- `docs/features/README.md`
- `react/src/app/router.jsx`
- `react/src/pages/report/IssueForm.jsx`
- `react/src/pages/report/ReportIssuePage.jsx`
- `react/src/residentIntake/ParticipationInput.jsx`
- `react/src/residentIntake/residentIntakeRepositories.js`
- `react/src/serviceRequests/canonicalSubmission.js`
- `react/src/staff/ServiceParticipationPage.jsx`
- `react/test/Participation.test.jsx`
- `server/.env.example`
- `server/README.md`
- `server/migrations/20260927000000-add-service-participation.ts`
- `server/package.json`
- `server/src/auth/auth.types.ts`
- `server/src/config/configuration.ts`
- `server/src/config/environment.ts`
- `server/src/database/database.types.ts`
- `server/src/database/development-participation-cli.ts`
- `server/src/database/development-staff-input.ts`
- `server/src/service-request/create-service-request.service.ts`
- `server/src/service-request/participation.controller.ts`
- `server/src/service-request/participation.domain.ts`
- `server/src/service-request/participation.service.ts`
- `server/src/service-request/service-request.dto.ts`
- `server/src/service-request/service-request.module.ts`
- `server/test/database/participation-checks.ts`
- `server/test/database/request-audience.integration.test.ts`
- `server/test/unit/participation.test.ts`
