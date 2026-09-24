# F053 — Admin Intake Settings Management implementation report

F053 is implemented and validated on personal development resources. Starting branch/HEAD: `main`, `c67c38d0823c4b1e781653c9069b487c7b6abecb`, initially clean and synchronized with the existing `origin/main`. The local feature commit is identified in the completion message and Git history with subject `feat(admin): manage service participation collection`. No push, deployment, cloud/client change or F054 work is authorized or performed.

This report groups the requested completion checklist by contract, evidence and retained state. See the [feature specification](F053-admin-intake-settings-management.md) and [ADR-014](../architecture/decisions/ADR-014-administrative-configuration-authorization.md). F053 realizes ADR-014's existing narrow-write/resource-revision contract; it does not replace that decision or introduce a global configuration revision.

## Authorization and API

| Effective permission state         | GET Admin configuration | PATCH collection         |
| ---------------------------------- | ----------------------- | ------------------------ |
| Neither                            | 403                     | 403                      |
| `admin.configuration.read` only    | 200                     | 403                      |
| `admin.intake_settings.write` only | 403                     | 403                      |
| Both                               | 200                     | Allowed after validation |

Missing/invalid authentication is 401. Entra validation, trusted active staff/Organization resolution and server authorization remain mandatory. Development fallback identity is rejected. Route admission requires Admin read; the service independently requires read plus write. Operational permissions and analytics permission cannot substitute. Both Admin permissions alone still fail operational request and analytics access in real-guard HTTP integration tests.

| Capability               | Independent authorization                                                        |
| ------------------------ | -------------------------------------------------------------------------------- |
| Read Admin configuration | `admin.configuration.read`                                                       |
| Change collection        | Admin read plus `admin.intake_settings.write`                                    |
| Participation analytics  | `analytics.service_participation.read` plus existing PUBLIC request access/scope |
| Service Requests         | Existing audience/read/scope authorization                                       |
| Requester Contact        | Existing F039 contact permission plus parent access                              |
| Requester History        | Existing F050 history permission and parent/scope rules                          |

The new permission has **zero default grants**, no broad-bundle inclusion, and one explicitly provisioned personal development grant. Existing read, analytics and operational grants remain independent. No permission-management UI exists.

The only mutation is `PATCH /api/v1/admin/intake-settings/service-participation`. Its DTO is exactly `{ enabled: boolean, expectedRevision: integer }`; expectedRevision is required in 1–2147483647. Unknown body/query fields, coercion, missing/invalid revisions and Organization injection fail 400. There is no client-selected Organization or resource path. Trusted Organization determines both the setting and active-area query; a forged Organization route is absent (404). This is not a generic configuration mutator.

Success is 200, `Cache-Control: no-store`, with only `{ enabled, revision, changed }`. Authorization failure is 403, invalid enabling/input is 400, stale revision is 409, and unexpected persistence failure is sanitized 500. At revision exhaustion an actual change fails safely with 409. No private SQL or provider details reach UI error feedback.

## Transaction, concurrency and performance

The service authorizes and validates before opening one transaction. It loads the active trusted Organization's collection value and revision with `FOR UPDATE`; compares expectedRevision **before** no-op handling; returns a current-value no-op when appropriate; validates one active own-Organization Area with `FOR SHARE` when enabling; changes the boolean through the shared helper; lets the existing F052 trigger advance only the collection revision; inserts the required safe audit; and commits. Any validation, update or audit failure rolls the transaction back. Audit insertion failure was injected only in the disposable test database and left both setting and revision unchanged.

The source of truth is PostgreSQL's independently versioned collection resource. Successful changes increment exactly once. GET/Refresh, rejected requests and current-value no-ops do not increment. Area and Issue revisions remain independent. No global `organizationConfigurationRevision` was added.

Two concurrent test writers using the same revision produce one 200 and one 409, one increment and one successful audit. Live independent editor snapshots both read Enabled/revision 1. A changed it to Disabled/revision 2. B submitted Disabled with expectedRevision 1 and received the product's 409 conflict state, even though Disabled already matched the committed value. Only explicit Refresh loaded revision 2; the subsequent deliberate enable produced revision 3. No automatic merge/replay or silent last-write-wins occurs. Automatic retry could overwrite an administrator's newer decision, so the UI requires review of current state.

A live same-value Enabled/revision 1 PATCH after provisioning returned 200 without a change, increment or audit. Replaying an actual completed mutation with its old revision instead conflicts. The UI also blocks duplicate in-flight Saves. Aborting a browser request is not represented as a server rollback guarantee; after uncertain network outcomes, the UI advises Refresh.

Excluding authentication/authorization lookups and BEGIN/COMMIT, mutation SQL is bounded: one setting lookup; zero or one active-area existence query; one update returning the authoritative setting; one audit insert. Disable uses three application queries, enable four, and no-op/stale conflict one. Trigger and foreign-key checks run inside PostgreSQL. The Organization primary key supports the lookup; `participation_area_active_order` begins with Organization/active for the existence predicate; audit primary/unique Organization-revision indexes enforce history integrity. Writers on the same Organization serialize briefly on its row. Unrelated resource revisions are not made stale, though existing shared-row storage can briefly serialize other Organization writes. No request-history scan or N+1 operation is introduced. No production load/throughput claim is made.

## Audit and migration

Migration required: **Yes**, `20260930000000-add-admin-intake-settings-write`. It registers the permission and creates resource-specific append-only `participation_collection_audit` plus immutable UPDATE/DELETE/TRUNCATE triggers. The audit action is `service_participation_collection_changed`. Fields are trusted Organization, internal staff actor, safe prior/new booleans, prior/new revisions, sanitized correlation UUID and occurrence time. It has no arbitrary JSON, requester/Contact/identity claims, full configuration, tracking credential/digest, body or secret.

| Outcome                       | Successful-change audit                        |
| ----------------------------- | ---------------------------------------------- |
| Disable                       | One, atomically committed                      |
| Enable                        | One, atomically committed                      |
| Same-value no-op              | None                                           |
| Stale conflict                | None                                           |
| Input/area validation failure | None                                           |
| Authorization failure         | None                                           |
| Transaction/audit failure     | None committed; setting and revision roll back |
| Configuration GET/Refresh     | None                                           |

Safe live example: authenticated administrator changed Enabled → Disabled, revision 1 → 2. The second retained record is Disabled → Enabled, revision 2 → 3. Read-only database verification confirmed exactly **two** records, correct trusted actor/Organization, timestamp and correlation presence. Both remain; no revision reset, audit deletion or rewritten history was attempted.

Disposable apply/down/reapply and existing-data preservation passed before the development migration. Verified personal target: localhost:5432 / reqro_dev / reqro_dev_user, development profile. Final migration state: **30 applied / 0 pending**. Down migration refuses retained audit history or write grants rather than destroying meaningful data. No rollback was attempted against development UAT data. Development participation provisioning reuses active-area validation and existing resource revision semantics; dry-run remains read-only. CLI provisioning is a distinct controlled path, not a fabricated authenticated Admin actor.

## UI and collection behavior

The authoritative capability projection controls whether Intake Settings renders an editor. Readers see the setting without a select or Save. Writers see a labelled Enabled/Disabled select, saved current value distinct from draft, dirty explanation, Save and Cancel. Save requires a valid meaningful change; Cancel restores the loaded value without writing. Refresh explicitly discards edits. State remains in memory; no new browser persistence was added.

Disabling opens a native labelled/described modal explaining preservation of historical responses and analytics, initially focused on Cancel. Keyboard Tab/Shift+Tab cycling, Escape, Cancel and return to Save were exercised in the browser. Background content is inert through native modality; browser chrome remains browser-controlled. Success uses the returned authoritative value/revision, announces success and reloads the configuration snapshot. Component coverage verifies exact DTO, safe feedback and ignored completion after unmount. 401/403 removes editing, 409 disables stale saving and exposes explicit Refresh, 400 explains active-area requirements, and unexpected failure shows sanitized recovery advice. Native dialog behavior was checked in the browser rather than inferred from jsdom shims.

At 1440, 1280, 1024, 768 and 390 pixels, both light and dark actual Admin layouts were visually checked. Labels, select, Save/Cancel, explanatory text and navigation remain usable without horizontal clipping. At 390, controls/text wrap and vertical scrolling is available. Mobile light/dark confirmation and conflict feedback were checked. No product defect was observed. These are accessibility-oriented development checks, not WCAG certification or comprehensive assistive-technology testing.

Enabled with active Areas presents the unchanged optional self-reported participation question, including Prefer not to say. Disabled removes that question from fresh resident intake; it does **not** delete historical geography, rewrite PROVIDED/DECLINED/NOT_COLLECTED, remove Area relationships, delete Areas, revoke analytics permission or change suppression. Re-enable restores choices for future submissions and performs no backfill. Enabling from Disabled with no active own-Organization Area returns 400 without mutation/audit. An existing invalid Enabled/no-area configuration may still be disabled.

Existing F051 authority rejects supplied participation geography from stale resident, assisted or API clients after disabling. Returning to the details step re-reads participation configuration while the parent form retains unrelated fields. There is no automatic stale-draft rewrite and no bypass through the UI. This regression is covered in existing integration/frontend tests; no permanent request was created solely to repeat it in live UAT.

Fresh real Overview, Intake Settings, Analytics & Privacy and Configuration Status agreed after UAT: Enabled, three active Areas, healthy configuration and deployment threshold 5. Other pages remain read-only. `/admin-preview` remains an isolated preview. No Area, Issue, identity-policy, default-assignment, privacy-threshold or permission editor was introduced.

## Authenticated live UAT and final integrity

The developer-launched API ran outside the restricted sandbox to preserve normal Entra signing-key retrieval. No token was copied, decoded, printed or inspected. Before provisioning, the real page was read-only and a normal authenticated same-value PATCH returned 403; the user explicitly confirmed it. The established F036 dry-run was reviewed and then only the narrow write grant was provisioned on the existing personal principal/scope. A subsequent same-value PATCH returned 200.

The browser exposed one accessible tab after the second-tab sign-in. The specification-permitted temporary controlled harness therefore held two independent snapshots in memory and reused the actual product editor, normal AuthRoot/API client and actual resident participation component. It added no product test controls or authorization bypass. Successful writes and stale rejection used the normal endpoint; state was not changed through SQL.

| Step                                          | Value/revision/result                       |
| --------------------------------------------- | ------------------------------------------- |
| Initial / both snapshots                      | Enabled / 1                                 |
| Authorized A disable                          | Disabled / 2; one audit                     |
| Fresh participation control                   | Absent                                      |
| Independently authorized historical analytics | Suppressed projection unchanged             |
| Stale B save using 1                          | Conflict; value/revision/audit unchanged    |
| Explicit B Refresh                            | Disabled / 2                                |
| Deliberate B enable                           | Enabled / 3; second audit                   |
| Fresh participation control                   | Present, same three Areas                   |
| Historical analytics recheck                  | Suppressed projection unchanged             |
| Final                                         | Enabled / 3; two legitimate audits retained |

The harness made three intentional analytics reads: baseline, disabled, re-enabled. Four additional analytics reads used the existing principal/Organization and threshold 5; the user confirmed opening/refreshing analytics during F053. Thus analytics-read audit count 26 → 33 is reconciled; all original audit rows remain unchanged. Configuration writes do not produce those read events. No audit records were removed to force baseline counts.

**Live normal-log privacy: PASS**, explicitly confirmed by the user as “absent” for full mutation/configuration bodies, requester data, provider subjects, tracking credentials/digests, bearer tokens and private attachment paths. No log values or captures were requested or committed.

Final permissions: one retained Admin read grant, one intentional intake-write grant, one unchanged analytics grant; all previous operational grants and memberships unchanged. The provisioning role's provenance metadata changed as expected. Role-permission rows 36 → 37; no broad role or scope expansion.

A private read-only before/after comparison verified all original rows unchanged across 13 Service Requests (including SR-202609-000013), one F050 Requester, eight Contacts, 13 Locations, 16 answers, 18 assignments, three watchers, 105 Activity rows, 68 operational activity rows, three Notes, four Communications, three attachments/three batches and associated attachment/history audit rows. Existing geography and Requester links are part of the unchanged request rows. Three Participation Areas and their revisions, all Issues/categories/definitions/questions, six identity policies and the default-assignment configuration are unchanged. Four private attachment files match their baseline; their paths/content were not published. Deployment threshold remains 5. Tracking safe state/timestamps are unchanged: **1 active / 5 revoked**. No tracking link was opened and no credential operation occurred.

## Validation

| Check                                                       | Result                                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Backend unit                                                | 241 passed                                                        |
| API E2E                                                     | 40 passed                                                         |
| Full PostgreSQL integration                                 | 261 passed, zero skips                                            |
| Shared                                                      | 64 passed                                                         |
| React                                                       | 530 passed in 37 files                                            |
| Focused Admin React after final success-focus change        | 21 passed                                                         |
| TypeScript/test compile/backend production build            | Passed                                                            |
| Backend lint / full formatting check                        | Passed                                                            |
| Frontend production build                                   | Passed; existing large-chunk advisory                             |
| Frontend lint                                               | No configured script                                              |
| Final whitespace, documentation links, private-value review | Passed: whitespace; 190 local links; 26 changed/new files scanned |

Full-suite passes total **1,136**. Installed Node entrypoints execute the existing package scripts because npm is unavailable: TypeScript's tsc for build/typecheck/test compile, Node test runner for compiled server suites (final unit and E2E serial), the root shared test file list, Vitest with the configured one-worker suite, ESLint/Prettier and Vite build. Initial parallel unit execution timed out in two subprocess startup/logging tests; the complete serial unit suite passed with unchanged timeout/security assertions. Initial lint findings were corrected and lint passed. The focused database run passed 215 tests before the final full database suite.

Focused F053 unit, actual HTTP/PostgreSQL and React tests cover independent permissions/no bundles, trusted scope and input forgery, DTO bounds, mandatory expectedRevision, successful enable/disable, no-op, stale same-value, concurrent writers, exact increments, GET revision stability, safe audit persistence/immutability, injected audit rollback, active-area validation, invalid-enabled disabling, request/grant preservation, logging privacy, read-only/editable UI, dirty/cancel, disable confirmation, 400/401/403/409/500 feedback and duplicate/unmount safety. Existing F051/F052 suites cover resource independence, public/API/assisted stale intake, analytics suppression/scope and configuration projections. Full regressions for F039 Contact, F042 Communications, F044 Tracking, F045 Location, F046 attachments/EXIF, F047 Live Search, F048 assignments, F049 identity policy, F050 identity/history, F051 participation and F052 Admin passed. Their implementation boundaries were not expanded.

## Threat review and remaining boundaries

| Threat                                                                | Mitigation / residual boundary                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Reader, write-only, operational or analytics principal attempts write | Server requires both independent Admin permissions; tested 403                                        |
| Cross-Organization mutation / Organization injection                  | Server-resolved active Organization; no target parameter; strict DTO/query and absent alternate route |
| Mass assignment / arbitrary configuration                             | Exactly two typed fields and one resource-specific endpoint                                           |
| Stale overwrite / concurrent writers / replay                         | Locked resource revision comparison, 409, exact increment; no automatic replay                        |
| Duplicate Save                                                        | In-flight UI guard plus backend revision contract                                                     |
| Enable without Areas                                                  | Own-Organization active existence validation in transaction                                           |
| Audit failure leaves changed setting                                  | Atomic rollback; tested fault injection                                                               |
| Revision changes without value / value without revision               | Existing database trigger; no-op/failed-write/GET tests                                               |
| Forged participation after disable                                    | Existing authoritative F051 intake validation and locking                                             |
| Historical deletion or analytics coupling                             | No historical mutation/query branch; integrity and aggregate checks                                   |
| Frontend-only enforcement                                             | Real route guard and service checks independent of capability UI                                      |
| Full body/config/identity logging                                     | Existing sanitized logging, automated checks and user-confirmed live PASS                             |
| Production over-provisioning                                          | Zero defaults and explicit development grant; production governance still required                    |

The reusable pattern is read the actual resource revision → edit an approved field → typed mutation with expectedRevision → authenticate and resolve trusted scope → require narrow permissions → validate and compare under lock → atomic change/revision/audit → authoritative response and explicit conflict refresh. Future Admin work should reuse the authorization, transaction, safe audit and UI recovery patterns, not silently reuse this permission for other resources.

This is a **development Admin write foundation**. Production needs approved administrator roles and provisioning/deprovisioning, separation-of-duties review where required, change management, audit retention, security review, operational support/recovery, Area ownership and broader write governance. Database-owner privileges can bypass ordinary application controls and require deployment governance. Native dialog/browser support and large Organization configuration performance need production-specific review; no load-test claim is made.

Deferred: Participation Area CRUD, Issue/identity-policy/default-assignment editing, privacy-threshold management, analytics/Admin/staff permission management, Entra administration, Requester identity/merge/split, database/deployment/secret controls, audit editing/deletion, bulk import/export, cross-Organization administration and arbitrary mutation. Roadmap candidates such as analytics dashboards, Issue Geography, production resident identity and advanced routing remain unassigned; F054 was not begun.

## Changed files and completion gates

Backend: the new migration, `admin-intake-settings.controller.ts`, `admin-intake-settings.service.ts`; Admin module/configuration capability; auth permission registry; database schema types; explicit development staff allowlist; participation validation/helper/CLI. Frontend: `IntakeCollectionEditor.jsx`, AdminConfigurationPage/CSS and API client's PATCH method. Tests: new backend unit/database checks, database runner registration/configuration expectation, new editor tests and existing Admin test adjustment. Documentation: this report, feature specification, Architecture, Context, Roadmap and feature index. No dependencies, branding, framework, hosting, authentication architecture or preview implementation changed.

User-confirmed gates: pre-grant 403, log privacy and extra analytics-read reconciliation. Technical gates: transaction/security suites, live disable/conflict/re-enable, responsive checks, safe audit verification, final integrity and historical preservation. The temporary integrity baseline/script and both browser harness files were physically removed and their absence verified before staging. No browser captures, logs or database dumps belong in the commit. Final diff review and whitespace check passed. All 190 local documentation links resolved. Private configuration comparisons and credential-pattern checks across the 26 changed/new files found no issues; no private values were printed. The four temporary F053 files are absent, with no UAT logs/screenshots/dumps staged. The local commit is the single feature commit above the unchanged F052 origin/main reference; post-commit hash and working-tree/ahead state are reported in the completion message.

## Post-F055 presentation refinement

See [Participation Setup consolidation](F055-participation-setup-refinement.md). The canonical `/admin/participation` composes Service Participation and Participation Areas; `/admin/intake` redirects there. Backend resources, write permissions, revisions, APIs and audits remain separate. The approved numeric Change order workflow retains persisted values. Historical evidence above describes its original checkpoint; the user subsequently created Fictional North-East Area, producing the reconciled five-area/nine-audit baseline.
