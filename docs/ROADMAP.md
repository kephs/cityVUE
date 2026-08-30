# CityVUE — Roadmap

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

- [ ] Define `ServiceRequest`, `Service`, `Category`, `Location`, and `RequestStatus`.
- [ ] Define `Department`, `Assignment`, `Activity`, `Watcher`, `Notification`, `NotificationRule`, and `WorkItem` boundaries.
- [ ] Define staff identity, group/team, role, and permission references without coupling the domain to an identity vendor.
- [ ] Define external-system references.
- [ ] Separate business `RequestStatus` from transmission/synchronization `IntegrationStatus`.
- [ ] Define attachment and destination/integration metadata.
- [ ] Document CityVUE-owned versus external-system-owned fields.
- [ ] Define request/activity visibility boundaries for requester-visible and internal staff information.
- [ ] Create ADR for the vendor-neutral model.

**Rule:** Never use a VUEWorks, Cityworks, or Cartegraph schema as CityVUE's central model.

## Phase 3 — Service Catalog and Dynamic Intake

- [ ] Define Department → Category → Service hierarchy, catalog ownership, and resident-friendly metadata.
- [ ] Design authorized Admin management for create/edit, reorder, activate, archive, clone, preview, and publish operations.
- [ ] Add an authorized Admin icon picker for Category and Service presentation metadata using stable approved icon keys, preview, fallback, and audit support; do not add icons to legacy `Issue` records.
- [ ] Add Category selection and live Service search using names, descriptions, keywords, aliases, and synonyms.
- [ ] Define and render standard/service-specific dynamic questions.
- [ ] Define a structured, typed Answer model with stable question identifiers and submission-time question/option display snapshots.
- [ ] Associate every canonical ServiceRequest with the exact published ServiceDefinition/form version used at submission.
- [ ] Validate structured answers server-side against the associated published definition, including required visible questions, types, options, constraints, and conditional applicability.
- [ ] Retain historical form definitions or equivalent immutable/versioned representations for safe request display and edit reconstruction.
- [ ] Render canonical Request Details/Edit views with separate resident-description and structured-answer fields rather than a combined description textarea.
- [ ] Add append-oriented answer edit history aligned with the Activity/audit model.
- [ ] Define a separately reviewed legacy compatibility and migration strategy that does not depend on reverse-parsing `Issue.description`.
- [ ] Add conditional follow-up questions and validate rule dependencies.
- [ ] Define required/optional fields.
- [ ] Define per-Service location modes and contextual location requirements.
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
- [ ] Define GIS asset integration needs.
- [ ] Maintain accessible alternatives.

## Phase 5 — Staff Identity and Authorization

- [ ] Define staff roles and protected functions.
- [ ] Design Microsoft Entra ID architecture.
- [ ] Complete required security review.
- [ ] Configure approved app registrations.
- [ ] Implement staff authentication.
- [ ] Implement UI protection and server/API authorization.
- [ ] Add logout/session handling.
- [ ] Define audit requirements.

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

- [ ] Select API technology/hosting.
- [ ] Implement canonical request contracts.
- [ ] Define adapter interface and capability model.
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
