# F040 — Implementation and validation report

Status: implementation, automated validation, authenticated operational/authorization UAT, responsive light/dark review and keyboard checks passed. The final approved sixteen development permissions are restored and retained. This report accompanies the separate F040 local commit.

## Repository and scope

Starting HEAD is `ebe473bea8c23135538d33932baaf547f1983161` on main, initially 21 commits ahead of origin/main. The recorded origin/main is `6eb836892089bde09ab4255e9f6871a304065fca`. The separate local commit message is `feat(requests): add public staff workspace`; the containing commit's hash and post-commit clean status/ahead count are supplied in the operator completion message rather than embedded recursively in this file. Nothing has been pushed or deployed. No remote/cloud/client resource was changed. F041 was not started.

The [feature specification](F040-public-service-request-staff-workspace.md) contains the complete permission and lifecycle matrices, API compatibility, query strategy, resident privacy matrix and operator runbook. The [validation record](F040-validation-checkpoint.md) preserves actual automated results and manual UAT observations. The [permission design review](F040-public-staff-workspace-design-review.md) records the approved granular model. This report summarizes their final implementation and evidence without repeating protected values.

## Architecture, authorization and API

There is one React staff list/detail route, `/staff/requests` and `/staff/requests/:requestId`, backed by `GET /api/v1/staff/service-requests` and `GET /api/v1/staff/service-requests/:id`. The existing F038 presentation, F031 lifecycle/routing, F035 history, F037 ownership/watchers and F039 contact service are shared. Backend class names retaining “internal” support compatibility; trusted server mode selects the shared implementation, not a browser-controlled policy.

The new controller requires normal Entra authentication and at least one audience-read permission. Persisted request audience then selects independent authorization. A single repository relation constrains trusted active Organization, allowed audience and effective Department/Division before any narrowing filter, count or pagination. Routed scope overrides catalog scope. It is an authorized PUBLIC/INTERNAL union, not all Organization rows filtered in React. Forged audience, cross-Organization substitution and out-of-scope IDs fail the server tests.

| Capability                                         | Parent request permission       | Additional requirement                                                                                                           |
| -------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| PUBLIC list/detail/Activity                        | `service_request.view`          | Organization/effective scope                                                                                                     |
| PUBLIC Start Work / Hold / Resume / Close / Reopen | `service_request.view`          | Respectively `service_request.start_work`, `.hold`, `.resume`, `.close`, `.reopen`; valid state, revision and required narrative |
| PUBLIC routing                                     | `service_request.view`          | `service_request.route`; current and target scope                                                                                |
| PUBLIC assignment                                  | `service_request.view`          | `service_request.assign`; eligible target and revision                                                                           |
| PUBLIC other-watcher management                    | `service_request.view`          | `service_request.watchers.manage`; eligible target and revision                                                                  |
| PUBLIC self-watch                                  | `service_request.view`          | Eligible current STAFF principal, current scope and revision                                                                     |
| PUBLIC contact                                     | `service_request.view`          | `service_request.contact.read`; successful required audit                                                                        |
| INTERNAL list/detail/Activity                      | `service_request.internal.read` | Organization/effective scope                                                                                                     |
| INTERNAL workspace mutations                       | `service_request.internal.read` | `service_request.internal.update`; applicable state, revision and target/scope rules                                             |
| INTERNAL self-watch                                | `service_request.internal.read` | Eligible current STAFF principal and revision                                                                                    |
| INTERNAL contact                                   | `service_request.internal.read` | `service_request.contact.read`; successful required audit                                                                        |

The five granular PUBLIC workflow permissions and assignment permission already existed. F040 reuses them instead of adding a generic PUBLIC update permission. Only route and watcher-management permissions are new. Read, operation authority and contact visibility remain separate. The capability projection contains `workflowActions`, `canRoute`, `canAssign`, `canManageWatchers`, `canWatchSelf` and `canReadContact`; it follows parent admission, current grants and lifecycle state. Execution additionally validates current targets and scope. React does not infer operation authority from audience.

Legacy INTERNAL routes still reject PUBLIC and legacy PUBLIC routes still reject INTERNAL. Existing F039 audience-specific contact endpoints are retained. Authenticated legacy PUBLIC workflow now delegates to shared history/revision handling while retaining its response contract; legacy PUBLIC assignment retains its older command contract and parent authorization. No route was removed or deprecated, and no breaking response change is intended. Older explicitly gated development fallbacks remain unchanged; new unified endpoints require Entra/RBAC.

## Filters, presentation and pagination

All is the default and returns only authorized audiences. Public and Internal narrow that set; selecting an audience whose permission is absent returns a safe empty result when the other audience admits the workspace. Neither permission denies admission. All three labelled options remain visible. Empty wording does not disclose unauthorized counts or claim that no Organization records exist.

My Requests uses direct current STAFF assignment. My Team uses active server-resolved Role/Team membership and current assignment. Watching uses direct STAFF or active Role/Team watcher membership. All remain subordinate to audience/Organization/scope authorization and do not grant contact access. Reference search is exact and case-normalized; status and effective Department/Division filters compose with audience and operational view.

The server orders globally by `created_at DESC, id DESC`, with matching authorized count, default page size 25 and maximum 100. React does not merge independently paginated audiences. URL query state carries filters/page; filter changes reset page one. Offset pages can shift after concurrent inserts. PostgreSQL tests cover mixed pages/counts and operational-view composition; the five authorized live records fit one UI page, so live multi-page UI behavior is not claimed.

F038 Issue name/icon stays dominant, service location remains operational context, reference stays secondary, and separate textual audience/status badges remain understandable without color. AudienceBadge uses semantic light/dark tokens independent from client branding and lifecycle colors. Intake channel is separately rendered as Web, Phone, Walk-in, Staff or API. F029 resident creation enforces PUBLIC/WEB; authenticated staff intake independently accepts either audience and the established channels, with the extra INTERNAL creation/contact restrictions unchanged.

The final operator filter pass confirmed mixed All; exact SR-202609-000007 search; Public + Open; empty Internal + Open; Internal + On Hold containing DEV-202609-00000003; and All + Community Services / Parks containing that INTERNAL request and SR-202609-000007. Both deep-link audiences work after permission restoration. List contact values remained absent.

## Migration and live data integrity

F040 required `20260920020000-enable-public-staff-operations` to allow PUBLIC routing under existing composite scope integrity and register the two new permissions. It creates no default grants or historical events and rewrites no contact/request/reference/ownership data. Disposable-schema forward/unused rollback/reapply and refusal after dependent state/grants passed. Personal development application followed automated validation and verified development / localhost:5432 / reqro_dev / reqro_dev_user. There are **19 applied migrations, zero pending**; this is the latest migration.

Before/after personal migration comparisons matched all fifteen measured data tables and all six original request/contact/ownership/history hashes. Final UAT comparisons preserve SR-202609-000001, SR-202609-000002, SR-202609-000004, SR-202609-000005 and DEV-202609-00000003. All original structured contact remains unchanged. F032 Issue configuration and F033 reference configuration remain unchanged; the reference sequence legitimately advanced for the one new request.

| Reference           | Audience / channel | Final status / revision | Final scope                | Assignment; watchers; operational events                                                  |
| ------------------- | ------------------ | ----------------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| SR-202609-000005    | PUBLIC / Phone     | Open / 1                | Public Works / no Division | Unassigned; 0; 1. Existing name/email unchanged; not a no-contact fixture                 |
| SR-202609-000006    | PUBLIC / Phone     | Open / 2                | Public Works / no Division | One STAFF assignment; 0; 2. Operator intentionally assigned during UAT; contact unchanged |
| SR-202609-000007    | PUBLIC / Web       | Open / 25               | Community Services / Parks | Parks Queue Team; one F037 Fictional Reviewer - Parks Role watcher; 26                    |
| DEV-202609-00000003 | INTERNAL / Staff   | On Hold / 24            | Community Services / Parks | Existing Parks Queue assignment; 2 watchers; 25. Unchanged                                |

SR-202609-000007 was created anonymously through normal F029 resident intake for Damaged Street Sign, initially Public Works / no Division, with fictional location/description and no structured contact. The database has six PUBLIC records and one INTERNAL record; two PUBLIC records are outside this principal's authorized scope. No large artificial pagination dataset was added.

## Live operations and authorization proof

Evidence is operator-reported normal Chrome/Entra UI and API behavior plus read-only database verification. No fixture preview, browser automation workaround, synthetic authentication or direct SQL request mutation is used as live evidence. Tokens, authentication headers, contact response bodies and HAR files were neither requested nor recorded.

| State                                                              | Observed result                                                                                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Initial seven retained F039 grants, no PUBLIC view                 | All/Internal contained authorized INTERNAL; Public empty; PUBLIC deep link unavailable; INTERNAL detail loaded                           |
| Explicit PUBLIC view only                                          | Mixed All and audience filters worked; PUBLIC detail loaded; operation controls unavailable; authenticated workflow probe HTTP 403       |
| Explicit eight PUBLIC operation keys added                         | Controls appeared; valid workflow/routing/STAFF-Role-Team ownership and watcher operations persisted through refresh                     |
| Contact read removed, both audience reads retained                 | Both details/operation controls remained; Contact Protected; PUBLIC contact probe HTTP 403; no stale contact after refresh               |
| Contact read restored                                              | Same PUBLIC name/email visible through explicit protected fetch, no re-login; safe contact audit recorded                                |
| PUBLIC view removed, INTERNAL read/contact/operation keys retained | All INTERNAL-only; Public empty including My Team/Watching; PUBLIC detail HTTP 404 and contact HTTP 403; INTERNAL detail allowed         |
| PUBLIC view restored, INTERNAL read removed                        | All PUBLIC-only; Internal empty including My Team/Watching; PUBLIC detail/contact allowed; INTERNAL detail HTTP 404 and contact HTTP 403 |
| All sixteen explicitly restored                                    | Mixed filters and INTERNAL deep link passed; exact stored set and unchanged operational data verified                                    |

Read revocation denied SR-202609-000007 despite its Team assignment, Role watcher and active membership. Assignment/watching/membership do not grant parent access; contact permission cannot recover a denied parent. PostgreSQL cases separately prove direct STAFF, Role and Team relationships neither grant request access nor contact. PUBLIC read-only endpoint denial establishes operation separation beyond button visibility.

The authoritative SR-202609-000007 chronological sequence is below. The UI independently pages newest first; revision/event index here documents writes, including the atomic two-event route.

| Revision | Observed event(s)                                                           |
| -------- | --------------------------------------------------------------------------- |
| 1        | `request_created`                                                           |
| 2        | `work_started`                                                              |
| 3        | `placed_on_hold`                                                            |
| 4        | `work_resumed`                                                              |
| 5        | `placed_on_hold`                                                            |
| 6        | `work_resumed`                                                              |
| 7        | `request_routed` to Parks                                                   |
| 8        | `request_closed`                                                            |
| 9        | `request_reopened`                                                          |
| 10       | `request_assigned` to Development STAFF                                     |
| 11       | `request_reassigned` to Parks Role                                          |
| 12       | `request_reassigned` to Parks Queue Team                                    |
| 13       | `request_unassigned`                                                        |
| 14       | `watcher_added` direct STAFF self-watch                                     |
| 15       | `watcher_removed` direct STAFF                                              |
| 16       | `watcher_added` Parks Role                                                  |
| 17       | `watcher_added` Parks Team                                                  |
| 18       | `watcher_removed` Parks Role                                                |
| 19       | `request_assigned` Parks Team                                               |
| 20       | `request_routed` to Streets, then `request_unassigned` in the same revision |
| 21       | `request_assigned` Development STAFF                                        |
| 22       | `request_routed` back to Parks, STAFF assignment preserved                  |
| 23       | `watcher_removed` Parks Team                                                |
| 24       | `request_reassigned` to Parks Team                                          |
| 25       | `watcher_added` Parks Role                                                  |

Two actual Hold/Resume cycles are recorded. Both reasons persisted; the later Hold reason, Close resolution and Reopen reason match supplied fictional text. Close resolution survives Reopen. Refresh observations and subsequent database reads establish persistence. Creation remains anonymously attributed; staff events resolve to the trusted principal without publishing personal identity. Atomic routing failure injection, competing workflow/assignment commands and duplicate watcher additions pass PostgreSQL tests; no destructive failure injection occurred in personal reqro_dev.

## Contact, audit and resident privacy

Protected structured name/email is available only through F039's on-demand endpoint with audience read plus `service_request.contact.read` and a successful audit. Phone remains unsupported. Contact is excluded from normal list/detail and operational Activity, held in memory only, and cleared on route/auth changes, known parent denial, capability loss or contact denial. It is not polled or automatically re-fetched after unrelated operations. Revocation applies on the next server request; no push revocation channel is claimed. Free-text request content may still contain incidental PII.

Live populated PUBLIC and PUBLIC/INTERNAL no-contact states were observed; Protected and restoration passed without re-login. Safe audit readback verified trusted actor, Organization, request, timestamp and correlation metadata. Metadata contains only `action=contact_viewed`, `policy=F039` and correlation ID; no name/email/description/narrative/contact payload. No contact-view event appears in operational Activity. Automated capture verifies application logs contain no fictional contact values; separate F040 live log correlation was not performed. No contact is put into list URLs, document title, analytics or persistent browser storage by this change.

Anonymous creation returns only ID, reference, initial status and creation timestamp. Existing legacy and unified list/detail GETs remain staff protected. After all staff mutations, unauthenticated calls to both legacy and unified list/detail returned 401. The tested resident receipt excludes assignment, watchers, routing history, staff actors, operational Activity, Hold/Close/Reopen narratives, capabilities and requester contact. There is no new resident history/status endpoint and no resident communication. PUBLIC classification does not expose staff operational data publicly.

## Files added or changed

The change comprises shared staff policies/controllers/repositories and operation reuse, the minimal migration, granular development provisioning, audience/capability presentation, permanent tests and documentation. No dependency, hosting, deployment, environment or unrelated application file is changed.

- `docs/ARCHITECTURE.md`
- `docs/CITYVUE_CONTEXT.md`
- `docs/ROADMAP.md`
- `docs/features/F036-safe-development-staff-authorization-provisioning.md`
- `docs/features/F040-implementation-report.md`
- `docs/features/F040-public-service-request-staff-workspace.md`
- `docs/features/F040-public-staff-workspace-design-review.md`
- `docs/features/F040-validation-checkpoint.md`
- `react/src/components/ui/RequestPresentation.jsx`
- `react/src/components/ui/primitives.css`
- `react/src/staff/requests/InternalRequestWorkspace.jsx`
- `react/src/staff/requests/RequestOwnership.jsx`
- `react/src/staff/requests/requestRepository.js`
- `react/src/theme/designTokens.css`
- `react/test/StaffRequestRepository.test.js`
- `react/test/StaffRequestWorkspace.test.jsx`
- `server/migrations/20260920020000-enable-public-staff-operations.ts`
- `server/src/auth/auth.decorators.ts`
- `server/src/auth/auth.types.ts`
- `server/src/auth/staff-access.guard.ts`
- `server/src/database/development-staff-input.ts`
- `server/src/service-request/internal-request-mutations.service.ts`
- `server/src/service-request/internal-request-scope.ts`
- `server/src/service-request/internal-request.repository.ts`
- `server/src/service-request/ownership-targets.ts`
- `server/src/service-request/public-request-contact.policy.ts`
- `server/src/service-request/request-ownership.service.ts`
- `server/src/service-request/service-request.module.ts`
- `server/src/service-request/service-request.repository.ts`
- `server/src/service-request/staff-actions.service.ts`
- `server/src/service-request/staff-request-policy.ts`
- `server/src/service-request/staff-request-scope.ts`
- `server/src/service-request/staff-request.controller.ts`
- `server/test/database/development-staff.integration.test.ts`
- `server/test/database/request-audience.integration.test.ts`
- `server/test/database/service-request.integration.test.ts`
- `server/test/database/staff-actions.integration.test.ts`
- `server/test/database/staff-workspace-checks.ts`
- `server/test/unit/development-staff-input.test.ts`
- `server/test/unit/staff-access.guard.test.ts`
- `server/test/unit/staff-request-policy.test.ts`

## Exact development permission manifest

The existing fictional Organization is CityVUE Development Municipality; scopes remain Public Works / Streets and Community Services / Parks. Principal is reported only as `development-principal-…6f6d34`. No personal identity is committed. The prior seven FULL_UAT_OPERATOR keys are retained and nine approved PUBLIC keys added:

| Permission                         | Before F040 | Final retained | Purpose                          |
| ---------------------------------- | ----------- | -------------- | -------------------------------- |
| `service_request.create`           | Yes         | Yes            | Staff-assisted PUBLIC intake     |
| `service_request.create_internal`  | Yes         | Yes            | INTERNAL intake                  |
| `service_request.internal.read`    | Yes         | Yes            | INTERNAL request read            |
| `service_request.internal.update`  | Yes         | Yes            | INTERNAL operations              |
| `catalog.issue_action.manage`      | Yes         | Yes            | F032 Issue action configuration  |
| `service_request.reference.manage` | Yes         | Yes            | F033 reference configuration     |
| `service_request.contact.read`     | Yes         | Yes            | Separate F039 contact projection |
| `service_request.view`             | No          | Yes            | PUBLIC request read              |
| `service_request.start_work`       | No          | Yes            | PUBLIC Start Work                |
| `service_request.hold`             | No          | Yes            | PUBLIC Hold                      |
| `service_request.resume`           | No          | Yes            | PUBLIC Resume                    |
| `service_request.close`            | No          | Yes            | PUBLIC Close                     |
| `service_request.reopen`           | No          | Yes            | PUBLIC Reopen                    |
| `service_request.assign`           | No          | Yes            | PUBLIC primary ownership         |
| `service_request.route`            | No          | Yes            | PUBLIC scope routing             |
| `service_request.watchers.manage`  | No          | Yes            | PUBLIC other-watcher management  |

This is the exact FULL_UAT_OPERATOR expansion, seven before and sixteen after. Geospatial remains optional and unprovisioned; Environmental Services remains outside the selected scope. Bundle names are provisioning shorthand only, never runtime policy. Code/migration/sign-in/startup made no stored grants. Each addition, revocation and restoration used F036's verified development-only target, read-only dry run and explicit confirmed operation. Dry-run hashes remained unchanged. Targeted removals preserved unrelated keys, principal, scope memberships and operational records. Development grants are retained for future UAT.

## Validation, performance and remaining limits

| Check                              | Result                                                       |
| ---------------------------------- | ------------------------------------------------------------ |
| Backend unit                       | 185 passed, zero failures/skips                              |
| API E2E                            | 36 passed, zero failures/skips                               |
| PostgreSQL integration             | 135 passed, zero failures/skips                              |
| F040 PostgreSQL coverage           | 20 workspace cases plus one F036 bundle case included above  |
| Shared tests                       | 62 passed                                                    |
| React                              | 288 passed in 24 files                                       |
| TypeScript                         | Backend no-emit and test compilation passed                  |
| Backend lint                       | Passed                                                       |
| Frontend lint/typecheck            | No separate configured script; React tests/Vite build passed |
| Formatting                         | Passed, including final documentation                        |
| Backend/frontend production builds | Passed                                                       |
| Whitespace and private-value scan  | Passed; zero private/credential findings                     |

F029–F039 regressions remain in the passing suites: audience/intake, scoped INTERNAL read, lifecycle, Issue action, references, workspace, history, development provisioning, ownership/watchers, presentation and protected contact. Assertions were not weakened. F040 covers authorization/IDOR/forged audience, legacy contracts, contact independence, no default grants, resident privacy, concurrent revision protection and transactional rollback. F036's sixteen-key test proves read-only dry run, concurrent/idempotent provisioning and targeted removal preserving unrelated grants/data. Its existing profile/client/unsafe-target refusals remain intact.

The list uses one bounded projection and a matching count, with catalog/scope joins and SQL assignment/location projections; no application N+1, contact join or Activity join. Existing Organization/time/status/reference, current assignment, watcher and active-membership indexes were inspected. No speculative index was added. Effective-scope expressions, correlated projections, offset pagination and exact counts need production-volume measurement; neither a benchmark nor production-scale performance is claimed.

Retained warnings: Vite large chunks and worker/CSS timing diagnostics. Initial unchanged MapPreview timing failure passed isolated/full reruns; a unit subprocess timeout under parallel load passed serial full rerun; database setup succeeded from the documented server context. Windows tsx failed before migration connection; the compiled version of the same tested CLI succeeded without weakening checks. See the validation record for details.

## Responsive and accessibility matrix

The operator reported all ten authorized-state width/theme combinations passed in normal Chrome. Each row covers navigation, audience/view/status/scope controls, mixed list, PUBLIC/INTERNAL details, Actions, Contact, Assignment/Watchers and Activity. Populated PUBLIC, no-contact PUBLIC and existing INTERNAL details were inspected. Issue dominance, badge readability and reference/location wrapping were included.

| Width | Light theme | Dark theme | Listed surfaces and controls | Ordinary horizontal overflow |
| ----- | ----------- | ---------- | ---------------------------- | ---------------------------- |
| 1440  | Passed      | Passed     | Passed                       | None observed                |
| 1280  | Passed      | Passed     | Passed                       | None observed                |
| 1024  | Passed      | Passed     | Passed                       | None observed                |
| 768   | Passed      | Passed     | Passed                       | None observed                |
| 390   | Passed      | Passed     | Passed                       | None observed                |

The operator confirmed keyboard/reading-order checks passed: Tab/Shift+Tab, Enter/Space, visible focus and labels; Close, routing, assignment and watcher forms opened then cancelled without mutation; focus restoration, list/detail links, Activity pagination where available and mobile navigation. Contact is plain text, so there are no mailto/tel links to test. Audience/status meaning is textual rather than color-only. This validation is not a WCAG certification.

The operator then confirmed Protected-state checks passed for PUBLIC and INTERNAL detail at all five widths in both themes: no stale contact, readable text/lock meaning, visible focus, no ordinary horizontal overflow, and normal detail/actions still available. Only contact.read was temporarily removed for that check. F036 explicitly restored that one key after a zero-write dry run; subsequent database resolution verified exactly sixteen permissions, unchanged scopes/operational records and 19 applied migrations with zero pending. A repeat provision dry run proposed no changes.

No live sign-out/session-expiry or multi-page list UI result is invented; existing automated stale-content/state-lifecycle and PostgreSQL pagination tests provide that evidence. No temporary F040 browser harness, preview or API capture log was created. Operator configuration remains ignored. The final private-value scan found zero personal/private values, credentials, added credential URLs, private keys or JWT-like values; two unchanged synthetic test URLs were reviewed and preserved.

## Final security review

No unresolved violation was found in the reviewed F040 boundaries. Persisted audience, active Organization and effective scope govern every new path; read, granular operations and contact remain independent. Assignment/watching/membership cannot grant either read or contact. There are no default PUBLIC grants, runtime provisioning endpoints, new resident staff-data exposure, contact search/edit/export, or messaging. F036's development/profile/database safeguards remain unchanged. Contact is excluded from list/ordinary detail, operational Activity and safe audit metadata; required audit failure remains fail-closed under F039 regressions. New paths use server revision checks and atomic history/audit writes. Browser code supplies no authoritative Organization, principal, membership or capability. Legacy audience contracts, append-only history and resident receipt privacy pass regression tests.

Validation remains local and synthetic. Production-scale performance, external deployment, production permission administration and formal accessibility certification are not established by these checks.

Deferred: F041 notes, resident history/communication, notifications, contact editing/search/export, bulk operations, priority/SLA/escalation, automatic assignment, production membership administration, directory sync, integrations and AI. No such work was started.
