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
- [ ] Define external-system references.
- [ ] Define attachment and destination/integration metadata.
- [ ] Document CityVUE-owned versus external-system-owned fields.
- [ ] Create ADR for the vendor-neutral model.

**Rule:** Never use a VUEWorks, Cityworks, or Cartegraph schema as CityVUE's central model.

## Phase 3 — Service Catalog and Dynamic Intake

- [ ] Define service catalog and ownership metadata.
- [ ] Add dependent category/service selection.
- [ ] Define standard/service-specific questions.
- [ ] Add conditional follow-up questions.
- [ ] Define required/optional fields.
- [ ] Add citizen-friendly descriptions.
- [ ] Define destination-system and mapping metadata.
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

## Phase 6 — CityVUE API and Integration Foundation

- [ ] Select API technology/hosting.
- [ ] Implement canonical request contracts.
- [ ] Define adapter interface and capability model.
- [ ] Implement integration router.
- [ ] Add validation, structured errors, and correlation IDs.
- [ ] Establish logging/monitoring and secret management.
- [ ] Determine persistence and queue/retry requirements.
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
- [ ] Add history/timeline where appropriate.
- [ ] Define email/SMS requirements.
- [ ] Add confirmation, status-change, and resolution notifications.
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
