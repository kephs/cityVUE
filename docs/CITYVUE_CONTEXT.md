# CityVUE — Project Context

Phase F0 adds a local-development-only staff assignment and controlled canonical ServiceRequest workflow foundation. Organization-scoped synthetic staff profiles, explicit memberships, WorkGroups/queues, one-current-assignment history, revision-guarded assignment and workflow commands, and append-only Activity are implemented behind a production-forbidden development-action gate. This is not authentication or authorization: Entra mapping, RBAC, production staff APIs/UI, My Work, notifications, EAM synchronization, and deployment remain deferred. See F017.

F016 documents a planning-only production hosting and deployment readiness path. The preferred first-municipality target uses Azure Static Web Apps, Container Apps, Container Registry, PostgreSQL Flexible Server, Key Vault, Entra ID, future Blob Storage, and Application Insights/Azure Monitor, subject to City architecture/security approval and separate Development, Test/QA, and Production boundaries. No infrastructure is provisioned: production remains Firebase Hosting with legacy/localStorage behavior, while the NestJS/PostgreSQL platform remains local. Canonical staff routes still require Entra/RBAC before production exposure. See F016.

Phase E0 adds a local-development canonical Location and geographic eligibility foundation. Canonical intake now evaluates restrictive exact-version policies through a vendor-neutral provider before the write transaction, persists an eligible Location snapshot, and fails closed with distinct safe outcomes for ineligible, indeterminate, and unavailable validation. Unrestricted services skip evaluation. The deterministic provider is explicitly gated and forbidden in production; real GIS data/providers, maps, PostGIS selection, overrides, Entra/RBAC, and deployment remain deferred. See F015.

Phase D3 adds a local-development-only canonical staff Issue List foundation. The minimal list is Organization-scoped, reuse-gated by the D2 development-read flag, searchable/filterable/sortable/paginated, and PII/location-minimized. React `/issues` uses it only in explicit API/dev-read mode; production remains legacy/localStorage-backed. See F014.

Phase D1 adds a local-only resident intake API mode behind repository boundaries. Phase D2 adds an Organization-scoped canonical ServiceRequest details read model and a read-only React `/issues/:issueId` experience, both guarded by explicit local-development flags. Production remains on the default fixture/`IssueService` path, and other resident/staff surfaces are not cut over. See F012 and F013.

The legacy-backed React Dashboard also presents transitional **Issues by Department** analytics. Department is derived at presentation time only by an exact `Issue.category` match to the active fixture Category and that Category's owning Department, including ownership through an optional Division. Missing, unmatched, ambiguous, or invalid relationships are counted as **Unassigned Department**. Counts sort highest first with an alphabetical tie-break. No Department or Division value is persisted on legacy Issues, and Department drill-down remains deferred until the Dashboard and Issue List use API-authorized canonical ServiceRequests.

## Project Identity

**CityVUE** is the canonical name of the application during development.

CityVUE is currently an internal development/prototype project intended to explore and build a modern, City-controlled citizen-engagement platform. **Ask Rockville** was previously considered as a possible future public-facing name, but it is not the current application name and should not be treated as approved branding.

- **Development name:** CityVUE
- **Current status:** Internal development/prototype
- **Future public-facing name:** TBD
- **Previously considered name:** Ask Rockville

Do not rename the application, repository, deployment resources, package identifiers, or documentation to Ask Rockville unless explicitly instructed.

## Project Vision

CityVUE should provide residents with a simple way to find City services, report issues, submit service requests, provide location/supporting information, track requests where supported, and receive useful status information without needing to know which internal enterprise application processes the request.

CityVUE should be treated as a potential **City-owned digital front door and citizen-engagement layer**, not merely as a custom front end for one Enterprise Asset Management (EAM) product.

## Current Status

A working MVP has been developed and deployed. Known capabilities include:

- Report an Issue workflow
- Search, filtering, and sorting
- Editing and deleting records
- Dashboard statistics
- Category visualization
- Toast notifications
- Delete confirmation
- Dark mode
- Citizen-facing home/hero experience

Firebase Hosting has been used for MVP deployment. The repository is authoritative for exact framework versions, dependencies, routing, state management, persistence, and implementation details.

React migration Stage 8 defines the current React MVP routes as Home, Report an Issue, Issue List, Edit Issue, Dashboard, and Not Found. Legacy About and Contact shells are intentionally excluded because approved substantive content and supported contact functionality are not available. Future informational, support, privacy, accessibility, legal, emergency-use, and feedback content requires City ownership and approval; see `docs/features/F005-react-stage-8-informational-routes.md`.

## Strategic Goal: Vendor Neutrality

CityVUE must not be designed as “the VUEWorks front end.”

The long-term architecture should allow integration with different EAM, work-management, permitting, case-management, or other enterprise systems, including:

- VUEWorks
- Trimble Cityworks
- OpenGov Cartegraph
- MyGovernmentOnline (MGO)
- VistaShare Outcome Tracker
- Other current or future City systems

The City should be able to replace an enterprise system without requiring a complete rewrite of the CityVUE citizen experience.

> **No enterprise vendor's data model should become the CityVUE domain model.**

Core vendor-neutral concepts should include items such as `ServiceRequest`, `Service`, `Category`, `Location`, `Department`, `WorkItem`, `Attachment`, and `RequestStatus`. Vendor adapters translate these concepts to and from external-system APIs/data models.

## Business Goals

CityVUE should:

1. Make it easy for residents to report problems and request City services.
2. Provide a consistent citizen-facing experience.
3. Support request tracking where available.
4. Hide unnecessary internal organizational and vendor complexity.
5. Support multiple departments and service categories.
6. Integrate with multiple enterprise systems.
7. Minimize vendor lock-in.
8. Support secure staff access and administration.
9. Remain maintainable as City systems and vendors change.

## Relationship to the Current VUEWorks Program

The City is currently implementing VUEWorks for EAM/CRM-related capabilities. CityVUE is being developed while citizen service requests, CitizenVUE, Survey123, and enterprise integrations are active considerations.

VUEWorks provides useful requirements and a potential first EAM integration, but CityVUE's architecture should remain independent of VUEWorks.

CityVUE may eventually submit selected requests to VUEWorks, retrieve/synchronize status, route other services to different systems, and continue providing the same citizen interface during a future EAM migration.

Exact integration scope remains subject to City decisions, technical discovery, security review, and vendor API capability.

## Multi-System Routing Vision

```text
Citizen
   |
   v
CityVUE
   |
   v
Service Catalog / Routing Rules
   |
   +--> Service A -----------> VUEWorks
   +--> Service B -----------> Cityworks
   +--> Service C -----------> Cartegraph
   +--> Permitting ----------> MGO
   +--> Other Service -------> Other System
```

These routes are illustrative only. Residents should not need to know the destination system.

## Intended Users

### Residents

Residents should eventually be able to find services, report issues, enter/select locations, answer service-specific questions, submit supporting information, receive confirmation, track status where supported, receive updates, and find answers without unnecessary submissions.

### City Staff

Authorized staff may eventually authenticate using Microsoft Entra ID, review/search requests, view details, perform permitted administrative actions, troubleshoot integrations, and access reporting or operational dashboards.

Privileged authorization must not depend solely on client-side controls.

## Planned / Candidate Capabilities

These are not implemented unless confirmed in the repository:

- Microsoft Entra ID SSO
- Role-based staff access
- Address autocomplete/validation
- Dependent service/category lists
- Dynamic follow-up questions
- Configurable service catalog/forms
- Chatbot/conversational service discovery
- Live search
- Citizen request tracking and notifications
- VUEWorks integration
- Cityworks integration capability
- Cartegraph integration capability
- MGO integration
- VistaShare integration
- Additional APIs
- Central CityVUE API/integration layer

The expected long-term domain also includes vendor-neutral assignment/routing, append-oriented request activity and audit history, watchers, centrally configured notification orchestration, attachments, work items, external-system references, and explicit integration status. Staff workspaces should eventually support My Assignments, group work, and unassigned queues while keeping requester, assignee, watcher, public comments/activity, and internal notes/activity distinct. These capabilities are requirements, not current implementation; see `docs/features/F002-core-product-capabilities-domain-requirements.md` for the detailed reference.

The current browser-backed `Issue`/`cityvueIssues` implementation remains a temporary MVP compatibility model during the controlled React parity migration. It must not be silently reshaped into the future `ServiceRequest` domain. F001 remains authoritative for migration sequencing, and React components should stay behind neutral service boundaries so later API/domain work can be introduced separately.

Approved future staff requirements include an API-authorized Dashboard that defaults to **My Assigned Issues**, with additional authorized Department, Category, group/queue, and permission-controlled All Issues scopes. Dashboard metrics must reflect the selected authorized scope. Future canonical `ServiceRequest` status changes use controlled, permission-validated actions with append-oriented Activity/audit history rather than arbitrary status replacement.

The current React Dashboard has no staff identity or assignments, reads all locally stored legacy `Issue` records, and supports display and filter drill-down only. The future staff Dashboard is assignment-aware, permission-aware, scope-aware, and API-backed; current Issue editing and status display remain unchanged.

React migration Stage 9 prepares the current MVP for cutover validation with route-level code splitting and a separate Firebase Hosting preview configuration. The live Hosting configuration and Parcel rollback build remain unchanged. Browser `localStorage` data is origin-specific and is not synchronized between localhost, preview channels, or the live site. See `docs/features/F006-react-stage-9-cutover-preparation.md`.

React migration Stage 10 completed the Firebase Hosting production cutover to the approved React/Vite MVP on August 29, 2026. React `dist-react` is now the live frontend; Parcel source and `dist` build/deployment capability remain available through a dedicated rollback configuration. The production application still uses the unchanged browser-local `Issue`/`cityvueIssues` compatibility model. Backend/API, database, authentication, and future canonical-domain implementation have not begun. See `docs/features/F007-react-stage-10-production-cutover.md`.

The React Home page now derives its issue totals, current status counts, and three most recent Issues from the current browser's `IssueService` records through the shared statistics helpers. These values remain origin-specific local-browser MVP data, not centralized analytics. Unsupported static average-resolution and resident-engagement metrics were removed because the current `Issue` model has no authoritative resolution timestamp or authenticated resident identity.

F008 approves the backend architecture direction: strict TypeScript with NestJS, a versioned REST/OpenAPI CityVUE API, PostgreSQL, Azure Container Apps for API/workers, Azure Database for PostgreSQL, private Blob Storage, Key Vault/managed identity, and Application Insights/Azure Monitor. Future staff authentication uses separate single-tenant Microsoft Entra SPA and API registrations with authorization code + PKCE and no SPA secret; CityVUE remains authoritative for granular server-side permissions. Public resident intake stays separate from workforce identity. React should later replace `IssueService` through an injected API repository, with no automatic migration of browser-local `cityvueIssues`. See `docs/features/F008-production-backend-persistence-security-architecture.md`.

F009 implements Phase A locally as an isolated `server/` NestJS 11 platform foundation with strict TypeScript, validated configuration, Kysely/PostgreSQL pooling and migration tooling, health/readiness, OpenAPI, Pino request correlation/logging, sanitized errors, security defaults, tests, Docker Compose, and a non-root multi-stage Dockerfile. It creates no business endpoints, migrations/tables, Entra/RBAC, reference generation, GIS, integrations, Azure resources, or React/Firebase connection. Phase B is not started. See `docs/features/F009-phase-a-backend-platform-foundation.md`.

F010 implements Phase C0 locally: PostgreSQL Organization, Department, optional Division, Category, stable ServiceDefinition, immutable published ServiceDefinitionVersion, Question, and QuestionOption persistence; composite Organization-aware constraints; a transactional idempotent sample seed; Organization-scoped catalog/search endpoints; resident DTOs and OpenAPI; and database/E2E tests. Its configured development Organization is not production tenant security. React stays fixture/localStorage-backed. ServiceRequest, references, Entra/RBAC, GIS, Admin CRUD, deployment, and frontend cutover remain deferred.

F011 implements Phase D0 locally: transaction-safe canonical ServiceRequest creation, a globally shared PostgreSQL monthly reference counter interpreted in Organization business time, exact published-version validation, typed/snapshotted Answers, optional requester/contact and Location rows, initial append-only Activity, and `POST /api/v1/service-requests`. Exact reference lookup remains repository-only pending privacy design. React and legacy browser records are unchanged; Entra/RBAC, GIS, notifications, attachments, staff workflow, EAM, and deployment remain deferred.

CityVUE is designed as an Organization-aware reusable municipal platform. `Organization` is the canonical domain ownership term and “tenant” describes technical isolation. Initial deployments prefer one isolated environment/database/storage/identity/integration boundary per municipality, while canonical entities remain Organization-scoped to preserve a future multi-city/shared-SaaS option. No tenant implementation exists yet, and Phase A behavior is unchanged.

The approved pre-Phase-A addendum adds an optional canonical Division level: a Department may have zero, one, or multiple Divisions, and a Category belongs either directly to one Department or to one Division within that same Department. It also requires immutable ServiceRequest references in `SR-YYYYMM-NNNNNN` format, allocated by an atomic server-side monthly sequence alongside internal IDs, and a future read-only `/issues/:issueId` details experience reached through clickable Issue names. Authorized Edit/Delete actions should move toward Details while the future API independently authorizes view, edit, and delete. These are later domain/catalog, ServiceRequest, and frontend API-transition requirements; Phase A remains platform foundation only, and the current `Issue`/`IssueService`/`cityvueIssues` MVP is unchanged.

CityVUE will support API-authoritative geographic eligibility configured per Issue/ServiceDefinition using City-approved boundaries, service areas, City-owned/maintained properties, facilities, roadways, or GIS assets. Ineligible locations may be blocked and indeterminate locations may be corrected or routed for authorized review according to published ServiceDefinition policy. React/mobile checks are UX assistance only; the vendor-neutral GIS abstraction and canonical Location implementation belong to later Location/GIS work, not Phase A.

F003 defines the future dynamic service-catalog and intelligent-intake direction. The canonical hierarchy is `Department → Category → Service`, while residents normally select resident-friendly Categories and Services without choosing an internal Department. Published Service definitions may eventually drive live search, service-specific questions, location and attachment policies, anonymous/contact behavior, safety guidance, and routing metadata. The future CityVUE API is authoritative for catalog administration, validation, versioning, publication, routing, and audit; React only renders supplied configuration and collects answers. See `docs/features/F003-dynamic-service-catalog-intelligent-intake.md`. API-authoritative catalog administration and publication are not implemented.

The React/Vite resident intake now supports immediate, accessible search of active Categories by catalog-provided name and resident-facing description, with live counts, clear and zero-result controls, and selection-state preservation when filtering hides the selected Category. The catalog helper can also consume future configured Category aliases and keywords; no official search terms are hard-coded in the component.

Category and Service icons are future Admin-managed presentation metadata selected from an approved application-controlled library. Current fixture icons are prototype-only and are not official City selections; they do not alter `Issue`, routing, or persistence.

Stage 5.1 currently flattens the resident description and visible dynamic answers into legacy `Issue.description` for compatibility. Future canonical `ServiceRequest` records require a separate description and structured, typed `Answer[]` tied to stable question identifiers and the exact ServiceDefinition version used at submission. Reverse-parsing compatibility descriptions is prohibited as a canonical edit-reconstruction strategy.

## Architectural Principles

- **Citizen experience first:** use citizen-friendly terminology.
- **Vendor neutrality:** keep vendor assumptions out of core workflows.
- **Loose coupling:** avoid direct browser dependency on enterprise APIs.
- **Canonical CityVUE model:** translate between CityVUE and vendor models.
- **Adapter-based integrations:** isolate vendor-specific behavior.
- **API/middleware preference:** use a City-controlled integration boundary where practical.
- **Security by design:** authentication, authorization, secrets, logging, privacy, and data protection are first-class requirements.
- **Configurability:** increasingly drive services, questions, routing, and mappings from configuration/data.
- **Incremental delivery:** validate through manageable phases and pilots.

## Security Expectations

- Never commit credentials, secrets, tokens, private certificates, or production connection strings.
- Keep `.env` and equivalent secret-bearing files out of Git.
- Provide `.env.example` with placeholders only.
- Never expose privileged enterprise credentials in browser code.
- Client-side route protection is not sufficient authorization.
- Protected APIs must independently authenticate and authorize users.
- Apply least privilege.
- Validate untrusted input.
- Avoid unnecessary storage/logging of personal information.
- Do not use production personal information in development/test unless explicitly authorized and protected.

## Development Approach

For substantial features:

1. Define the business problem.
2. Document requirements and acceptance criteria.
3. Review architecture/security implications.
4. Create/update a feature specification under `docs/features/`.
5. Implement on a focused branch when practical.
6. Run available tests/build/lint/type checks.
7. Review the diff.
8. Update architecture/decision documentation.
9. Commit a logical unit of work.

## Source of Truth

When information conflicts, use this order:

1. Current approved City requirements and decisions
2. Current repository behavior/code
3. Approved feature specifications
4. Architecture Decision Records
5. `ARCHITECTURE.md`
6. `CITYVUE_CONTEXT.md`
7. `ROADMAP.md`

Identify conflicts rather than silently guessing.
