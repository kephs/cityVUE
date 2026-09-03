# CityVUE — Architecture

Phase D3 adds a minimal Organization-scoped canonical `ServiceRequest` list at `GET /api/v1/service-requests`. It reuses the fail-closed D2 development-read gate and accepts no client Organization context. PostgreSQL provides safe search, canonical hierarchy filters, allow-listed sorting, bounded pagination, and counts without returning requester, description, answers, location, or activity. React `/issues` consumes it only in API/dev-read mode; production legacy mode remains localStorage-backed. See F014.

React `/report` selects paired catalog and request repositories from centralized Vite configuration. Legacy mode remains fixture/localStorage-backed; local API mode normalizes canonical catalog DTOs and submits canonical request DTOs through a shared fetch client. Organization context remains backend-owned.

**Status:** Working architecture / target direction  
**Canonical development name:** CityVUE  
**Important:** Proposed/TBD items are not final City decisions.

## Architectural Objective

CityVUE should provide a stable, City-controlled citizen experience while allowing internal enterprise systems to change over time.

It should be possible to integrate with VUEWorks today and later add, migrate to, or coexist with Cityworks, Cartegraph, MGO, or other systems without rebuilding the citizen-facing application.

```text
Residents / City Staff
          |
          v
        CityVUE
          |
          v
     CityVUE API
       Proposed
          |
          v
 Integration / Routing Layer
          |
   +------+------+------+------+
   |      |      |      |      |
   v      v      v      v      v
VUEWorks Cityworks Cartegraph MGO  Future
 Adapter   Adapter   Adapter Adapter Adapter
```

## Fundamental Rule

> **No enterprise vendor's data model should become the CityVUE domain model.**

Core code should use neutral concepts such as `ServiceRequest`, `Service`, `Category`, `Location`, `Department`, `WorkItem`, `Attachment`, and `RequestStatus`.

## Current Application

Known direction:

- Web application
- Modern JavaScript front end
- Firebase Hosting used for the MVP
- Citizen service-request experience
- Dashboard/search/filter/edit/delete capabilities

Inspect the repository to establish exact versions, packages, persistence, routing, and state management.

## Logical Architecture

### Presentation Layer

Responsibilities include the home page, service discovery, Report an Issue, dynamic forms, address/location input, confirmation, request tracking, citizen-friendly statuses, staff/admin UI, authentication UI, search/filter, and loading/error states.

The UI must not contain privileged enterprise credentials or vendor-specific integration logic.

Catalog presentation metadata may include application-approved logical icon keys for Categories and Services. The presentation layer maps those keys to the installed approved icon library and applies a safe Service → Category → generic fallback; arbitrary markup, script, CSS class input, and remote image URLs are not catalog data.

### CityVUE Application/API Layer — Phase A, C0, and D0 Foundations Implemented

Potential responsibilities:

- Authentication and authorization enforcement
- Request validation
- Service catalog
- Dynamic form definitions
- Canonical request handling
- Integration routing
- Status normalization
- Logging/audit hooks
- Notification orchestration
- API versioning
- Assignment/routing and workflow enforcement
- Append-oriented activity/audit recording
- Watcher management and visibility enforcement
- Notification-rule evaluation and delivery orchestration
- Request-number generation and idempotency controls

F008 selects a TypeScript/NestJS modular REST API with an OpenAPI contract and PostgreSQL persistence. Phase A implements the isolated platform foundation. Phase C0 adds Organization-owned Department, optional Division, Category, stable ServiceDefinition, immutable published ServiceDefinitionVersion, Question, and QuestionOption persistence plus Organization-scoped resident catalog reads. Composite foreign keys prohibit cross-Organization relationships. A configured development Organization is temporary and is not a production tenant-security boundary; Phase B remains deferred. React continues to use its fixture. See F009 and `docs/features/F010-phase-c0-organization-service-catalog-persistence.md`.

Phase D0 adds transactional canonical ServiceRequest creation, globally unique timezone-aware monthly references, typed and snapshotted Answers, optional requester/contact and Location foundations, initial append-only Activity, and an Organization-scoped exact-reference repository lookup. The public React application remains unconnected, and authentication, staff reads/workflow, GIS, notifications, attachments, and integrations remain deferred. See `docs/features/F011-phase-d0-canonical-service-request-persistence.md`.

Phase D2 adds a separate canonical details read-model service. It uses one database transaction and trusted configured Organization context to assemble the exact persisted ServiceDefinitionVersion classification, Answer snapshots, requester/contact, Location foundation, and ordered Activity. Its HTTP route and React details consumer are disabled by default, explicitly local/test-only, and cannot be enabled when the API runs with `NODE_ENV=production`. Protected production staff access remains blocked on Entra/RBAC. See `docs/features/F013-phase-d2-service-request-read-model-details.md`.

### Integration Router — Proposed

```text
Service Request
      |
      v
Service Definition
      |
      +-- destinationSystem
      +-- mappingProfile
      +-- requiredCapabilities
      |
      v
Integration Router
      |
      v
Appropriate Adapter
```

Routing should be configuration-driven where practical.

### Vendor Adapters — Proposed

Conceptually:

```text
integrations/
+-- vueworks/VueWorksAdapter
+-- cityworks/CityworksAdapter
+-- cartegraph/CartegraphAdapter
+-- mgo/MgoAdapter
+-- future-system/FutureSystemAdapter
```

Potential common operations include `createRequest()`, `getRequest()`, `getRequestStatus()`, `updateRequest()`, and `addAttachment()`.

Adapters do not need to implement unsupported vendor capabilities. Differences should be represented explicitly.

## Vendor Portability

Current example:

```text
CityVUE -> VueWorksAdapter -> VUEWorks
```

Future migration:

```text
CityVUE -> CityworksAdapter -> Cityworks
```

Coexistence:

```text
CityVUE
   |
Integration Router
   +-- Service A -> VUEWorks
   +-- Service B -> Cityworks
   +-- Service C -> Cartegraph
   +-- Permitting -> MGO
```

This architecture can support phased migrations where departments move at different times.

## Organization / Tenant Architecture — Approved Direction

`Organization` is the canonical business/domain term for a municipal or government customer. “Tenant” describes the corresponding technical isolation boundary where useful. CityVUE is intended to be a reusable Organization-aware municipal platform; canonical names and behavior must not hard-code one municipality or require source-code forks such as municipality-specific service classes or `if city === ...` logic.

The preferred initial enterprise deployment model is one isolated tenant/environment per municipality. Each Organization may receive separate application runtime, database, object storage, Microsoft Entra configuration, secrets, integrations, telemetry, backup/restore, disaster recovery, and maintenance windows. This reduces cross-Organization exposure risk and simplifies security, procurement, authorization, operations, and troubleshooting. A future shared CityVUE SaaS platform is optional and must not be implemented until tenant isolation, operations, billing, procurement, security, and customer-data requirements justify it.

Even in isolated deployments, the canonical domain remains Organization-aware. Conceptually, an Organization has a stable ID, name, short name, slug, active/inactive state, default business timezone, branding/configuration references, and timestamps; possible later metadata includes primary domain, support information, locale, default map extent, and service-area references. Exact schema remains TBD. Organization owns Departments, optional Divisions, Categories, ServiceDefinitions, ServiceRequests, StaffIdentity records, Groups, Roles/Permissions, ServiceAreas, integration configuration, notifications/workflow configuration, and other tenant data. No owned relationship may cross Organization boundaries.

```text
Organization
   +-- Department
         +-- Category
         +-- Division [optional, 0..many]
               +-- Category
                     +-- ServiceDefinition / Issue
   +-- ServiceRequest[]
   +-- Staff / Groups / Roles / Permissions
   +-- ServiceAreas / GIS configuration
   +-- Integration / Notification configuration
```

Every canonical ServiceRequest belongs to exactly one Organization independently of Department, Division, Category, or Assignment. Department transfer never changes Organization ownership. Staff identity, memberships, RBAC scopes, API access, catalog configuration, GIS/service areas, integrations/mapping profiles, external references, notification rules/templates, attachments/storage, exports, retention, archival, deletion, and migrations all retain Organization context. `ExternalSystemReference` is meaningful with its Organization and integration context; vendor credentials or mappings must never leak between Organizations.

The API enforces Organization scope server-side as an authorization invariant. Authentication alone never permits cross-Organization access, and changing IDs, route/query parameters, bodies, UUIDs, or client state must not bypass scope. Future repositories must make accidental unscoped queries difficult through explicit `organizationId`, scoped repository/application context, or an equivalent reviewed pattern. PostgreSQL Row-Level Security may provide defense in depth only if later justified; it is not selected automatically here. Some names/keys may be unique only within an Organization, while exact indexes remain TBD.

Each Organization may reference its own approved `IdentityProviderConfiguration`, including Entra tenant and separate SPA/API application identifiers and identity settings. Credentials remain in approved secret management such as Key Vault, not ordinary Organization rows. Cross-tenant administration is not designed. Phase B must establish trusted Organization identity context, Entra-tenant association, staff membership, and server-side Organization authorization.

Organization configuration supplies the authoritative business timezone used for `SR-YYYYMM-NNNNNN`, never a browser timezone. The reference remains immutable, server-generated, globally unique, and free of Organization/Department prefixes. If a future shared database serves several Organizations, concurrency-safe allocation and uniqueness enforcement still operate across all Organizations.

Organization-owned presentation configuration may later supply name, logo, colors, portal title, support text, and footer content while **CityVUE** remains the canonical product name. GIS providers/layers, service areas, storage partitions, EAM adapters, notification senders/templates, and telemetry context are Organization-scoped behind existing abstractions. Operational telemetry may include a safe non-sensitive Organization identifier where appropriate; business Activity/audit remains separate.

The core domain remains infrastructure-portable. F008's preferred initial enterprise implementation uses Azure managed services, but Organization-aware application/domain code should remain deployable through containers on a customer-managed VPS, another approved cloud, or other suitable host. Azure-specific identity, secret, storage, and telemetry integrations stay at infrastructure boundaries. Commercial licensing, intellectual-property ownership, contracting, procurement, and customer/data ownership are legal and organizational matters outside this software architecture and require separate review.

## Canonical Service Request Model — Proposed

Potential fields:

```text
ServiceRequest
- id (immutable internal UUID or equivalent)
- organizationId
- referenceNumber (immutable SR-YYYYMM-NNNNNN)
- externalReferences[]
- serviceId
- categoryId
- description
- location
- requester/contact information, when appropriate
- answers[]
- attachments[]
- submittedAt
- status
- responsibleDepartment
- destinationSystem
- integrationStatus
```

The final schema is TBD.

The internal ID is the technical relationship/primary identifier and is never replaced by or derived from the human reference number. The CityVUE API generates `referenceNumber` in `SR-YYYYMM-NNNNNN` format, where `YYYYMM` is the server-authoritative calendar month in the owning Organization's configured business timezone and `NNNNNN` is a zero-padded six-digit sequence. The sequence restarts at `000001` at each month boundary in that timezone, is global across CityVUE rather than per Organization, Department, or Division, and provides a namespace of 999,999 references per calendar month; this namespace does not limit total database storage. The complete reference remains globally unique even when sequence components repeat in different months.

Reference allocation is atomic and concurrency-safe within the ServiceRequest creation transaction so simultaneous requests never receive the same reference. Request creation, monthly-sequence allocation, reference construction, Answers, and initial Activity participate in the appropriate transactional boundary. The browser must never generate the authoritative reference or determine its period from the resident's clock, and a future PostgreSQL implementation must not use `MAX(referenceNumber) + 1` or equivalent race-prone logic. The exact allocation mechanism and approved business timezone will be established during canonical ServiceRequest persistence, not Phase A.

Department and Division are structured ownership relationships, not encoded reference prefixes, because ownership can change throughout a request's lifecycle. Once assigned, a reference remains unchanged through Department or Division transfer, reassignment, Category changes, status transitions, reopening, EAM integration, and archival. Full-reference search and display are future requirements for details, appropriate lists, resident confirmations, notifications, exports, integrations, and Activity/audit context. External EAM work-order numbers remain separate `ExternalSystemReference` values.

Canonical requests must separate the resident's general description from structured dynamic answers:

```text
ServiceRequest
  +-- description
  +-- serviceDefinitionId
  +-- serviceDefinitionVersion
  +-- Answer[]
        +-- questionId
        +-- question/version display snapshots
        +-- typed value
```

Future edit reconstruction must use the exact versioned ServiceDefinition and authoritative structured Answer records associated with the request. Human-readable description summaries may be generated for presentation or integration, but parsing description text is not a canonical reconstruction strategy. Historical definitions and submitted display snapshots must keep older requests understandable after questions or options change. See `docs/features/F003-dynamic-service-catalog-intelligent-intake.md` for the detailed requirement.

The detailed capability and domain requirements are recorded in `docs/features/F002-core-product-capabilities-domain-requirements.md`. The production model must also account for neutral `Assignment`, `Activity`, `Watcher`, `Notification`, `NotificationRule`, `WorkItem`, `ExternalSystemReference`, and `IntegrationStatus` concepts. These are proposed domain boundaries, not implemented schemas.

```text
ServiceRequest
  +-- Assignment(s)
  +-- Activity[]
  +-- Watcher[]
  +-- Attachment[]
  +-- WorkItem[]
  +-- ExternalSystemReference[]
  +--> Notification orchestration
```

Assignments may target staff identities, groups/teams/queues, or roles and must preserve reassignment history, timestamps, and the responsible actor/system. Configurable automatic routing may consider service, category, department, location/GIS asset, priority, and other approved request attributes. Requester, assignee, watcher, and external-system owner remain distinct.

Significant request changes should append timestamped `Activity` records with actor, visibility, old/new values where appropriate, and metadata. Public/requester-visible activity and internal staff activity require explicit separation and server-side authorization; audit history must not be silently overwritten.

Watchers follow activity but do not become assignees. `NotificationRule` represents centrally managed event/recipient/template conditions, while `Notification` represents a delivery instance and its queued, sent, retrying, or failed lifecycle. Notification and assignment rules must not be embedded in React components.

## Service Catalog — Proposed

A service definition may include:

```text
Service
- serviceId
- displayName
- citizenDescription
- category
- responsibleDepartment
- requiredFields
- dynamicQuestions
- locationRequirements
- locationEligibilityPolicy
- destinationSystem
- mappingProfile
- notificationRules
- trackingCapabilities
```

Within one Organization, the catalog hierarchy supports both `Department → Category → Service` and `Department → Division → Category → Service`. A Department may have zero, one, or multiple Divisions; Division is optional, and each Division belongs to exactly one Department in the same Organization. Every Category belongs to one Organization and Department ownership hierarchy and may either be owned directly by that Department or by one of that Department's Divisions. Cross-Organization ownership and cross-Department Division references are invalid, and the Department relationship must not be duplicated inconsistently.

Department is primarily an internal ownership and routing concept; resident intake normally begins with resident-friendly Categories and Services. A Service may supply versioned dynamic questions, conditional visibility, location requirements, attachment policy, anonymous/contact policy, safety guidance, notification references, and routing metadata. Departments, Divisions, and Category ownership must support audited organizational change, including rename, activation/deactivation, and Category movement, while historical requests remain understandable through archival/version/snapshot strategy rather than unsafe hard deletion.

Location requirement and geographic eligibility are separate per-ServiceDefinition policies. A Service may require, optionally accept, or omit a Location while independently selecting an approved `LocationEligibilityPolicy`, such as City boundary, ServiceArea, City-maintained roadway, City-owned property/facility/park, GIS asset, utility service area, no geographic restriction, or another configured rule; the exact schema remains TBD. CityVUE must not reduce all services to one inside-city/accepted versus outside-city/rejected rule because operational boundaries, ownership, and maintenance responsibility may differ by Service.

React may resolve input and provide immediate feedback, but the CityVUE API revalidates eligibility before authoritative ServiceRequest creation through a vendor-neutral GIS/location service boundary backed by City-approved boundary, service-area, property/facility, and asset sources. Production City-boundary checks use an authoritative polygon rather than hand-entered ranges, approximate bounding boxes, or browser-only definitions. Evaluation distinguishes `Eligible`, `Ineligible`, and `UnableToDetermine`; each ServiceDefinition governs whether an indeterminate result requires correction, permits staff review, or routes to manual triage. Where eligibility is required, an API-confirmed ineligible request is normally blocked with plain-language guidance rather than accepted and silently discarded, subject to future approved exception policy.

Canonical Location may retain the entered/display and normalized address, coordinates, location type, appropriate facility/park/parcel/GIS-asset references, eligibility policy/reference, result, and validation timestamp without adopting a GIS vendor schema. Authorized staff resolution or override requires permission, actor, timestamp, reason, and Activity/audit history. Eligibility context must be sufficient to explain acceptance, rejection, review, or override without requiring a full polygon snapshot. Location precision, visibility, retention, export, logging, and attachment-metadata implications require City privacy/security review.

The GIS/location boundary must handle timeouts, transient failures, retries, degraded/manual-review paths, and observability without assuming a GIS provider is always available. Geographic eligibility is distinct from organizational routing: an eligible Location may inform an approved routing rule, but Department/Division/Group must not be inferred solely from a boundary. EAM adapters receive only supported canonical location or asset references through vendor-specific mappings. Mobile GPS, map pins, photo geolocation, or nearby-asset UX remain inputs—not authoritative proof of eligibility.

The future CityVUE API/application layer owns authoritative catalog persistence, Admin authorization, validation, versioning, publication, routing, audit, and request creation. React renders published configuration and collects resident answers; it must not become authoritative for Admin rules or routing. Published definitions referenced by historical requests should remain resolvable and should normally be archived rather than hard-deleted.

During a separately approved React migration Stage 5.1, a repository-local preloaded fixture may sit behind a catalog abstraction. That fixture is temporary and replaceable by the future API; browser storage is not the future catalog authority. See `docs/features/F003-dynamic-service-catalog-intelligent-intake.md`.

Routing examples are illustrative, not approved City routing decisions.

## Capability Model — Proposed

External systems may differ. CityVUE should be able to represent capabilities such as:

```text
CREATE_REQUEST
READ_STATUS
UPDATE_REQUEST
ATTACHMENTS
WEBHOOK_STATUS
GIS_ASSET_LINKING
WORK_ORDER_CREATION
```

## Authentication

### Staff

F008 selects single-tenant Microsoft Entra ID for future workforce authentication using separate Web SPA and CityVUE API registrations. The SPA uses MSAL authorization code + PKCE with no client secret; the API validates access tokens and enforces authorization. Entra may provide coarse admission/app-role or group signals, while CityVUE persists granular permissions and organizational scopes. Exact tenant/client identifiers, scopes, redirects, role grants, and Conditional Access policy remain subject to City Cybersecurity/Microsoft Admin approval.

### Citizens

TBD. Options may include anonymous submission, email-based tracking, optional accounts, or another identity provider. Do not assume workforce Entra identity is appropriate.

## Authorization

```text
UI protection
      +
API authentication
      +
API authorization
      =
Protected operation
```

Client-side guards are not the security boundary.

Authenticated staff Dashboard scopes are API-authorized views over canonical `ServiceRequest` records. The default future staff view is My Assigned Issues, with Department, optional selected Division, Category, group/queue, and All Issues views available only where the signed-in user's roles, memberships, and permissions allow them. Staff may be associated with multiple Departments and/or Divisions; Division access is explicit and is not inferred solely from Category selection. Scope selection in React never expands RBAC, and every Dashboard metric must be calculated from the same authorized active scope. Exact API routes and multi-Department/Division/group-work UX remain TBD.

## ServiceRequest Details — Approved Future Direction

The future Issue List should label the current visible `Title` concept as **Issue** without renaming legacy `Issue.title`. Each Issue name becomes the primary link to a read-only `/issues/:issueId` details route; selecting it must not enter edit mode automatically. The details experience presents only applicable lifecycle data, potentially including reference number, Issue, Department/Division, Category, status, priority, date reported, reporter/contact, location, resident description, structured Answers, attachments, assignment, Activity, watchers, external references, and integration status.

Authorized Edit and Delete actions should move to the details experience. The list may retain a compact More menu where implementation review demonstrates a need, but should avoid large Edit/Delete controls in every row. View, edit, and delete permissions are independent and enforced by the CityVUE API; rendering or hiding React controls is not authorization.

Canonical status changes are server-authoritative domain/application actions rather than arbitrary field overwrites. Permitted transitions, reasons, required information, and permissions remain configurable future workflow decisions; each completed transition appends Activity/audit history and may invoke centralized Notification orchestration. External EAM statuses remain vendor-neutral mappings handled through adapters and mapping profiles, with source-of-truth and conflict policies still to be designed.

## Data Ownership — TBD

Before production integration determine CityVUE persistence, authoritative systems, external ID mappings, status synchronization, attachment handling, audit history, reporting, retention, privacy, and backup/recovery.

Avoid unnecessary duplication of enterprise data.

## Integration Reliability — Proposed

```text
Citizen submits
      |
      v
CityVUE validates
      |
      v
Persist / queue request
      |
      v
Integration Adapter
      |
      v
Enterprise System
      |
 success / retry / failure
```

Specific persistence/queue/retry technology is TBD.

Notification delivery and reliable integration work should run through server-side/background processing capable of queuing, bounded retry, deduplication/idempotency, timestamps, correlation, observable terminal failure, and recovery. React may initiate operations and display state, but it is not the execution or authorization boundary.

`IntegrationStatus` describes transmission/synchronization state and is separate from a request's business `RequestStatus`. `ExternalSystemReference` links a CityVUE entity to a vendor record without making the vendor identifier or schema canonical.

## Status Normalization — Proposed

External statuses may be mapped to citizen-friendly CityVUE statuses. Actual mappings require business-owner approval.

## Enterprise Migration Strategy

```text
Initial:   CityVUE -> VUEWorks
Migration: CityVUE -> VUEWorks + New EAM
Future:    CityVUE -> New EAM
```

The goal is to change integration configuration/adapters rather than rebuild the citizen portal.

## Hosting

Firebase Hosting remains the current React static-frontend host and Parcel rollback target. F008 recommends Azure Container Apps for the future API and worker, Azure Database for PostgreSQL Flexible Server, private Azure Blob Storage, Key Vault through managed identity, and Application Insights/Azure Monitor. Firebase Hosting does not become the API or persistence platform by implication.

Evaluate future hosting against City standards, security, identity, networking, supportability, cost/licensing, monitoring, backup/recovery, procurement, and disaster recovery.

## Environment Strategy — Proposed

```text
Development
Test / Training
Production
```

Do not hard-code environment-specific configuration.

## Security Principles

- Least privilege
- Defense in depth
- Server-side authorization
- No secrets in source control
- TLS
- Input validation
- Safe error handling
- Dependency hygiene
- Auditability
- Minimize sensitive data
- Secure integration credentials
- Explicit production change control

Formal City security review should precede production enterprise integrations.

## Architecture Decisions Still Required

1. Detailed production API deployment topology and City operational approval for the F008-selected stack
2. System-of-record and field-ownership boundaries within the selected PostgreSQL persistence direction
3. Citizen identity/tracking model
4. Staff Entra authentication/authorization
5. Canonical request schema
6. Service catalog storage
7. Integration adapter contract/capabilities
8. VUEWorks integration method
9. Cityworks integration method if needed
10. Cartegraph integration method if needed
11. MGO integration method
12. VistaShare integration need/method
13. Attachment storage
14. Queue/retry architecture
15. Notifications
16. Logging/monitoring
17. Data retention
18. Deployment/change management
19. Assignment targets, routing precedence, fallbacks, transfers, and escalation rules
20. Activity taxonomy, visibility, retention, correction, and audit access
21. Watcher eligibility, management permissions, privacy, and preferences
22. Notification channels, consent, templates, deduplication, retry, and operational ownership
23. Workflow transitions, work-item ownership, due dates, resolution codes, and closure reasons

Document durable decisions as ADRs under `docs/decisions/`.
