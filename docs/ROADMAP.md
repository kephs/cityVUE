# CityVUE — Roadmap

- [x] Phase E0 local canonical Location/geographic eligibility foundation: exact-version policy, vendor-neutral provider contract, deterministic production-forbidden test provider, fail-closed decisions, immutable eligible snapshot, safe errors/logging, and no-partial-write coverage. Authoritative City GIS, PostGIS choice, overrides, and deployment remain deferred.

- [x] Phase D3 local canonical staff Issue List foundation: minimal Organization-scoped DTO, dev-gated search and hierarchy filters, controlled sorting, bounded pagination/counts, and API-mode rendering on the existing `/issues` route. Production access remains deferred pending Entra/RBAC and deployment approval.

- [x] Phase D1 local resident intake transition foundation: explicit legacy/API repositories, canonical catalog identifiers, and canonical POST submission. Production cutover remains deferred.
- [x] Phase D2 local canonical ServiceRequest details foundation: Organization-scoped read model, fail-closed development endpoint, and gated read-only React details route. Production staff access remains deferred pending Entra/RBAC.

**Status:** Working development roadmap  
**Canonical development name:** CityVUE  
**Current stage:** Internal development/prototype

CityVUE should evolve from the existing MVP into a **vendor-neutral citizen-engagement platform** capable of communicating with VUEWorks, Cityworks, Cartegraph, MGO, VistaShare, and other future City systems.

Roadmap inclusion does not constitute City approval.

## Phase 0 — Development Baseline

**Goal:** Make the project safe, understandable, reproducible, and ready for AI-assisted development.

- [ ] Confirm Git/private remote strategy.
- [ ] Inventory technology stack and dependency versions.
- [ ] Document local setup and Firebase deployment.
- [ ] Add `docs/CITYVUE_CONTEXT.md`, root `AGENTS.md`, `docs/ARCHITECTURE.md`, and `docs/ROADMAP.md`.
- [ ] Create `docs/features/` and `docs/decisions/`.
- [ ] Review `.gitignore` and confirm `.env` is excluded.
- [ ] Check history for accidentally committed secrets.
- [ ] Add/update `.env.example`.
- [ ] Identify tests, lint, build, and type-check commands.
- [ ] Record bugs/technical debt.

**Exit:** Another developer or Codex can understand, run, build, and safely modify CityVUE.

## Phase 1 — Stabilize the MVP

- [ ] Inventory existing features against code.
- [ ] Review Report an Issue.
- [ ] Review responsive behavior/accessibility.
- [ ] Improve validation/error handling.
- [ ] Review search/filter/sort.
- [ ] Review edit/delete behavior and permissions.
- [ ] Standardize loading/success/error/empty states.
- [ ] Add critical tests where practical.
- [ ] Remove obsolete prototype code only after review.
- [ ] Keep development branding as CityVUE.

**Exit:** MVP workflows are stable, responsive, understandable, and testable.

## Phase 2 — Vendor-Neutral Domain Model

- [ ] Define canonical `Organization` ownership, lifecycle, business timezone, configuration references, and tenant-isolation invariants before or alongside Organization-owned tables.
- [ ] Define `ServiceRequest`, `Service`, `Category`, `Location`, and `RequestStatus`.
- [ ] Define `Department`, optional `Division`, `Assignment`, `Activity`, `Watcher`, `Notification`, `NotificationRule`, and `WorkItem` boundaries.
- [ ] Define staff identity, group/team, role, and permission references without coupling the domain to an identity vendor.
- [ ] Define external-system references.
- [ ] Separate business `RequestStatus` from transmission/synchronization `IntegrationStatus`.
- [ ] Define attachment and destination/integration metadata.
- [ ] Document CityVUE-owned versus external-system-owned fields.
- [ ] Define request/activity visibility boundaries for requester-visible and internal staff information.
- [ ] Create ADR for the vendor-neutral model.
- [ ] Define Organization-scoped uniqueness, repository/query context, exports, retention, archival, deletion, migration, backup/restore, and tenant-isolation test strategy; evaluate PostgreSQL RLS only as optional defense in depth.

**Rule:** Never use a VUEWorks, Cityworks, or Cartegraph schema as CityVUE's central model.

**F008 architecture direction:** Implement this future domain behind a TypeScript/NestJS REST API and PostgreSQL only through separately approved work. The existing `Issue` model remains the production MVP compatibility model until a deliberate API migration.

## Phase 3 — Service Catalog and Dynamic Intake

- [ ] Define both Department → Category → Service and Department → optional Division → Category → Service ownership paths; validate that a Category's Division belongs to its Department.
- [ ] Design authorized Division Admin management for create, rename, activate/deactivate, display order, Category association/movement, audit, archival, and historical understanding.
- [ ] Design authorized Admin management for create/edit, reorder, activate, archive, clone, preview, and publish operations.
- [ ] Add an authorized Admin icon picker for Category and Service presentation metadata using stable approved icon keys, preview, fallback, and audit support; do not add icons to legacy `Issue` records.
- [ ] Add Category selection and live Service search using names, descriptions, keywords, aliases, and synonyms.
- [ ] Define and render standard/service-specific dynamic questions.
- [ ] Define a structured, typed Answer model with stable question identifiers and submission-time question/option display snapshots.
- [ ] Associate every canonical ServiceRequest with the exact published ServiceDefinition/form version used at submission.
- [ ] Validate structured answers server-side against the associated published definition, including required visible questions, types, options, constraints, and conditional applicability.
- [ ] Retain historical form definitions or equivalent immutable/versioned representations for safe request display and edit reconstruction.
- [ ] Render canonical Request Details/Edit views with separate resident-description and structured-answer fields rather than a combined description textarea.
- [x] Add a local-development read-only `/issues/:issueId` canonical ServiceRequest Details route; production authorization and Issue List navigation remain deferred.
- [ ] Make Issue names the primary Issue List links, relabel the visible Title column as Issue, and simplify row actions by placing authorized Edit/Delete on Details with an optional compact More menu only if needed.
- [ ] Add append-oriented answer edit history aligned with the Activity/audit model.
- [ ] Define a separately reviewed legacy compatibility and migration strategy that does not depend on reverse-parsing `Issue.description`.
- [ ] Add conditional follow-up questions and validate rule dependencies.
- [ ] Define required/optional fields.
- [ ] Define per-Service location modes and contextual location requirements.
- [ ] Define a separately configurable per-ServiceDefinition `LocationEligibilityPolicy`, including Admin association/versioning and an explicit `UnableToDetermine` policy; do not treat location-required and geographically eligible as the same rule.
- [ ] Define per-Service attachment policies and secure attachment-processing requirements.
- [ ] Define anonymous/contact and notification-preference policies.
- [ ] Add resident review-before-submit and configurable safety guidance.
- [ ] Define configuration lifecycle, versioning, draft/preview, publication, rollback, and historical-reference behavior.
- [ ] Audit Admin catalog changes.
- [ ] Define intelligent routing metadata and conditional routing without exposing internal ownership to residents.
- [ ] Define destination-system and mapping metadata behind vendor-neutral integration boundaries.
- [ ] Evaluate privacy-safe duplicate-request reduction.
- [ ] Determine catalog storage approach.
- [ ] Configure initial pilot services.

**Exit:** New services require minimal citizen-facing code duplication.

## Phase 4 — Location and GIS

- [ ] Define address-validation requirements.
- [ ] Evaluate approved autocomplete/address source.
- [ ] Add autocomplete/validation.
- [ ] Support intersections, parks, facilities, and non-address locations.
- [ ] Evaluate map selection.
- [ ] Identify City-approved authoritative boundary, service-area, property/facility, roadway, and asset layers, including ownership, refresh cadence, and availability expectations.
- [ ] Define a canonical/configurable `ServiceArea` concept and vendor-neutral GIS/location service abstraction without embedding provider schemas or layer URLs in React.
- [ ] Implement later location resolution from resident input to canonical coordinates and appropriate GIS/facility/parcel/asset references.
- [ ] Define API-authoritative point/polygon, service-area, ownership/maintenance, and GIS-asset eligibility validation with `Eligible`, `Ineligible`, and `UnableToDetermine` results.
- [ ] Define per-ServiceDefinition behavior for ineligible and indeterminate results, including correction, manual triage/staff review, and plain-language resident guidance without invented external-agency information.
- [ ] Design permission-controlled staff resolution/override with actor, timestamp, reason, and Activity/audit history.
- [ ] Define GIS timeout, retry, degraded-operation/manual-review, observability, and data-refresh behavior.
- [ ] Complete geographic privacy/security review covering precision, authorization, public/staff visibility, retention, exports, logs, and attachment metadata.
- [ ] Define GIS asset integration needs while keeping EAM/GIS vendor fields in adapters and mapping profiles.
- [ ] Scope municipal boundaries, ServiceAreas, authoritative layers, providers/endpoints, and GIS configuration to Organization with no cross-Organization leakage.
- [ ] Maintain accessible alternatives.

Future geographic tests must cover clearly inside/outside and exact/near-boundary locations, differing service areas, eligible and non-City assets, missing and ambiguous locations, GIS unavailability, override authorization/audit, and bypassed or malicious client validation.

## Phase 5 — Staff Identity and Authorization

- [ ] Define staff roles and protected functions.
- [ ] Design Microsoft Entra ID architecture.
- [ ] Complete required security review.
- [ ] Configure approved app registrations.
- [ ] Implement staff authentication.
- [ ] Implement UI protection and server/API authorization.
- [ ] Add logout/session handling.
- [ ] Define audit requirements.
- [ ] Associate each Organization with its approved identity-provider/Entra tenant configuration while keeping secrets in approved secret management rather than Organization rows.
- [ ] Enforce Organization-scoped StaffIdentity membership, roles, permissions, and API access; do not design cross-tenant administration in Phase B.

**F008 architecture direction:** Use separate single-tenant Entra SPA and API registrations, authorization code + PKCE, no SPA secret, API token validation, and hybrid authorization: Entra for workforce identity/coarse admission plus CityVUE database roles and granular permissions. Registration and implementation still require Cybersecurity/Microsoft Admin approval.

## Phase 5A — Assignment, Workflow, and Staff Work Management

- [ ] Define individual, group/team/queue, and role-based assignment semantics.
- [ ] Define manual assignment, reassignment, department/group transfer, and unassigned-queue behavior.
- [ ] Design configurable automatic routing using approved request attributes and explicit fallback behavior.
- [ ] Define My Assignments, My Group's Requests, Group Assignments, and Unassigned Requests views.
- [ ] Preserve assignment history, timestamps, and actor/system attribution.
- [ ] Define statuses, permitted transitions, work items/work orders, due dates, resolution codes, and closure reasons.
- [ ] Define future SLA/escalation requirements without inventing City targets.
- [ ] Add an authenticated staff Dashboard scope selector whose default is **My Assigned Issues**, unless an authorized role/configuration defines another default.
- [ ] Provide authorized **My Department**, **Selected Category**, and permission-controlled **All Issues** scopes; selecting a scope or Category must never override RBAC.
- [ ] Define server-authorized scoped request queries and ensure Total, status, priority, Category, and recent-request metrics all reflect the active authorized scope.
- [ ] Derive Department scope from authoritative staff membership and permissions, never resident-facing Category values; decide combined versus selectable views for staff authorized across multiple Departments.
- [ ] Support explicit multi-Department/multi-Division staff scope and authorized selected-Division Dashboard views where useful; never infer Division permission from Category selection.
- [ ] Decide whether My Assigned Issues includes only direct individual assignments or also active group/queue assignments, and distinguish **My Work** from **My Group / Queue Work** where necessary.
- [ ] Decide whether and how a preferred scope is remembered, with safe fallback when a saved scope is no longer authorized.
- [ ] Define a controlled canonical `ServiceRequest` lifecycle, conceptually including Open, In Progress, On Hold, Closed, and Reopened without treating these illustrative names or transitions as final City policy.
- [ ] Model status changes as explicit actions such as Start Work, Place On Hold, Resume Work, Close Request, and Reopen Request rather than arbitrary status-field replacement.
- [ ] Define each transition's allowed source/result, permissions, roles/groups, required reason/comment/fields, timestamp, actor, notification behavior, and integration behavior.
- [ ] Define configurable Hold reasons; Close reasons, notes, completion time, actor, and Service-specific closure requirements; and permission-controlled Reopen reasons that preserve prior closure history.
- [ ] Define configurable assignment/status interactions, including whether In Progress requires an assignee, Close requires responsible staff, Reopen changes assignment, or Hold retains assignment.
- [ ] Evaluate constrained Admin configuration for approved transitions, Hold/closure reasons, Service-specific requirements, and routing/workflow behavior without committing to a fully generic workflow engine.

**Exit:** Assignment and workflow behavior is approved, vendor-neutral, auditable, and ready for server-enforced implementation.

## Phase 5B — Activity Timeline, Watchers, and Audit History

- [ ] Define the significant event/activity taxonomy.
- [ ] Define append-oriented activity data, actor attribution, old/new values, and metadata.
- [ ] Separate requester-visible activity/comments from internal staff activity/notes.
- [ ] Define audit retention, correction, access, export, and privacy rules.
- [ ] Define watcher eligibility, add/remove permissions, and future preferences.
- [ ] Ensure requester, assignee, and watcher remain distinct concepts.
- [ ] Require every canonical status transition to append Activity/audit history containing previous/new status, actor, timestamp, reason/comment, and relevant metadata; reopening must not erase the prior Closed event.

**Exit:** Request history and watcher behavior are approved, auditable, and protected by explicit visibility rules.

## Phase 6 — CityVUE API and Integration Foundation

- [x] Select API technology/hosting direction through F008: TypeScript/NestJS REST/OpenAPI, PostgreSQL, and Azure Container Apps; implementation and City platform approval remain pending.
- [x] Complete Phase A local backend platform foundation through F009: isolated strict-TypeScript NestJS workspace, Kysely/PostgreSQL connectivity and migrations, configuration validation, health/readiness, OpenAPI, structured logging/correlation, security defaults, tests, and container definitions; no cloud deployment or business schema.
- [x] Complete Phase C0 through F010: canonical Organization/service-catalog persistence, composite Organization constraints, transactional development seed, scoped resident reads/search, OpenAPI, and tests; React cutover, ServiceRequest, Entra/RBAC, GIS, and deployment remain deferred.
- [x] Complete Phase D0 through F011: canonical transactional ServiceRequest creation, global monthly references using Organization business time, typed Answer snapshots, requester/contact, Location foundation, initial append-only Activity, read-safe API DTOs, and concurrency/rollback tests; frontend cutover and later workflows remain deferred.
- [ ] Implement canonical request contracts.
- [ ] Implement Organization before or alongside Organization-owned canonical models; require exactly one Organization per ServiceRequest and prevent ownership changes through Department/Division transfer.
- [ ] Generate immutable, searchable `SR-YYYYMM-NNNNNN` ServiceRequest reference numbers server-side and atomically with creation, using a global six-digit monthly sequence with a namespace of 999,999 references per calendar month while complete references remain globally unique.
- [ ] Derive the `YYYYMM` period from an explicitly configured, authoritative CityVUE business timezone rather than a client clock; allocate safely across month boundaries and add boundary tests for the last request of one month and the first request of the next.
- [ ] Use a PostgreSQL allocation strategy that is atomic and concurrency-safe so simultaneous requests cannot receive the same reference; do not use `MAX(referenceNumber) + 1` or equivalent race-prone logic, and enforce uniqueness on the complete canonical reference.
- [ ] Preserve separate immutable internal IDs and external-system references; add reference-number search/display to approved API, UI, notification, export, and audit contexts.
- [ ] Define adapter interface and capability model.
- [ ] Scope adapter configuration, mapping profiles, credentials, external references, notifications, background jobs, and telemetry context to Organization.
- [ ] Implement integration router.
- [ ] Add validation, structured errors, and correlation IDs.
- [ ] Establish logging/monitoring and secret management.
- [ ] Determine persistence and queue/retry requirements.
- [ ] Provide server-side assignment, workflow, activity, watcher, and authorization boundaries.
- [ ] Enforce Dashboard scope and status-transition authorization in the API; React may request a scope or action but cannot determine record access or transition validity.
- [ ] Define background processing, idempotency/deduplication, and failure recovery for integrations and notifications.
- [ ] Define environment configuration.
- [ ] Record major decisions as ADRs.

**Exit:** An enterprise integration can be added without embedding vendor logic in the citizen UI.

Implement Phase 6 incrementally: Phase A completed the platform foundation and Phase C0 completed the Organization/service-catalog persistence foundation without GIS. Phase B remains separately authorized staff identity/authorization work. A separately approved Phase D0 may add canonical Location and ServiceRequest persistence plus monthly reference allocation; add GIS validation and frontend API transition only in their later phases. Then proceed with staff workflow/Activity, notifications, attachments, integration router/adapters, and mobile foundations. See F008, F009, and `docs/features/F010-phase-c0-organization-service-catalog-persistence.md`.

**Organization deployment baseline:** Prefer one isolated application environment, database, storage boundary, identity configuration, secrets set, integrations, telemetry scope, backup/restore plan, and maintenance window per municipality. Preserve container/domain portability for other approved clouds or customer-managed hosting. Evaluate a shared multi-Organization SaaS model only after explicit tenant-isolation, security, operations, procurement, billing, and data-governance approval.

## Phase 7 — First EAM Pilot: VUEWorks

- [ ] Confirm approved VUEWorks integration capabilities.
- [ ] Define narrow pilot services.
- [ ] Map CityVUE requests to VUEWorks.
- [ ] Define statuses, attachments, and failure behavior.
- [ ] Implement `VueWorksAdapter`.
- [ ] Implement submission and supported status synchronization.
- [ ] Define vendor-neutral status mapping, synchronization direction, source-of-truth/conflict handling, and authorization/audit behavior so adapter updates cannot bypass controlled CityVUE transitions.
- [ ] Add logging/support documentation.
- [ ] Conduct end-to-end UAT.

Existing Roads/Street Trees concepts may inform pilot selection, but scope must be explicitly approved.

## Phase 8 — Prove EAM Portability

This does not require purchasing another EAM.

- [ ] Review adapter interface for accidental VUEWorks assumptions.
- [ ] Refactor vendor-specific assumptions.
- [ ] Create a mock/reference second EAM adapter.
- [ ] Model capability differences.
- [ ] Test routing, external IDs, and normalized statuses.
- [ ] Document EAM migration procedure.
- [ ] Optionally validate against Cityworks, Cartegraph, or another approved test API if available.

**Exit:** A second EAM can be supported without rewriting CityVUE's citizen experience or canonical model.

## Phase 9 — Additional Enterprise Integrations

Candidate systems: MGO, VistaShare, Cityworks if adopted, Cartegraph if adopted, and other City systems.

For each:

- [ ] Confirm business value/owner.
- [ ] Confirm API and security requirements.
- [ ] Define capability profile and mappings.
- [ ] Implement adapter.
- [ ] Test errors/retries.
- [ ] Conduct UAT.
- [ ] Document support.

## Phase 10 — Citizen Tracking and Communications

- [ ] Define public tracking and identity requirements.
- [ ] Normalize citizen-friendly statuses.
- [ ] Present an authorized requester-visible activity timeline without exposing internal activity.
- [ ] Define email/SMS/push requirements, consent, accessibility, privacy, and operational ownership.
- [ ] Define centrally managed notification rules, recipients, templates, and event coverage.
- [ ] Configure approved transition notifications for requesters, assignees, groups, and watchers through server-side Notification orchestration rather than React.
- [ ] Add confirmation, assignment/reassignment, status-change, comment/update, resolution, reopening, cancellation, escalation, and integration-failure notifications as approved.
- [ ] Implement queued/sent/retrying/failed delivery state, timestamps, bounded retry, deduplication, correlation, and failure monitoring.
- [ ] Protect sensitive request information.

**Exit:** Residents can understand progress without knowing the back-end vendor.

## Phase 11 — Search, Self-Service, and Conversational Assistance

- [ ] Improve/live service search.
- [ ] Add synonyms/common-language matching.
- [ ] Integrate approved City knowledge.
- [ ] Evaluate chatbot/conversational interface.
- [ ] Route users to correct service intake.
- [ ] Prevent invented City policies/services.
- [ ] Measure self-service effectiveness.

## Phase 12 — Production Hardening and City Adoption

- [ ] Security, privacy, records-retention, and accessibility reviews.
- [ ] Performance/load testing.
- [ ] Backup/recovery and disaster-recovery planning.
- [ ] Monitoring/alerting.
- [ ] Support/escalation ownership.
- [ ] Deployment/change-management process.
- [ ] Production/integration runbooks.
- [ ] Support documentation/training.
- [ ] Analytics/reporting validation.
- [ ] Validate assignment/group workload, unassigned work, aging, and resolution-time reporting.
- [ ] Validate integration-failure and notification-failure reporting/alerting.
- [ ] Present platform for City evaluation/adoption.
- [ ] Validate tenant-isolation matrices covering IDs/query tampering, catalog, RBAC, ServiceRequests, attachments, integrations, background jobs, exports, retention/deletion, backup/restore, and telemetry redaction.
- [ ] Decide whether future shared SaaS is justified or isolated per-municipality deployments remain the supported product model.

### Branding Decision

Only after City evaluation/adoption should the project decide whether the production name remains **CityVUE**, changes to **Ask Rockville**, or uses another City-approved name.

## Suggested Near-Term Priorities

1. Repository/documentation baseline
2. MVP assessment/stabilization
3. Vendor-neutral domain model
4. Service catalog/dynamic intake
5. Location/GIS design
6. Staff Entra architecture
7. CityVUE API/integration architecture
8. Controlled VUEWorks pilot
9. EAM portability validation

## Feature Specifications

Use `docs/features/F00X-feature-name.md` and include problem, goal, users, requirements, non-goals, user flow, data/security/integration/vendor-neutrality considerations, acceptance criteria, tests, and open questions.

## Architecture Decisions

Use `docs/decisions/ADR-00X-decision-name.md` and include status, context, decision, alternatives, consequences, vendor-lock-in implications, and security/operations implications.

## Governance

```text
Candidate -> Designed -> Approved -> Implemented -> Validated
```

Do not interpret roadmap inclusion as approval to modify City production systems.

## React MVP Cutover Gate

React migration Stage 9 is limited to route-level performance preparation, isolated Firebase Hosting preview configuration, emulator validation, preview-channel UAT, and a documented rollback/cutover checklist. It does not authorize a live Firebase deployment or removal of the Parcel rollback path. See `docs/features/F006-react-stage-9-cutover-preparation.md`.

React migration Stage 10 completed the approved production Hosting cutover to the React/Vite MVP on August 29, 2026. Parcel remains a tested emergency rollback target. This frontend cutover does not complete or authorize the still-pending vendor-neutral domain, backend/API, persistence, identity, security, or enterprise-integration roadmap phases. See `docs/features/F007-react-stage-10-production-cutover.md`.

F008 approves the target backend, persistence, identity, security, hosting, and migration direction without implementing it. Subsequent phases must follow its sequencing and retain the public-resident versus protected-workforce boundary. See `docs/features/F008-production-backend-persistence-security-architecture.md`.
