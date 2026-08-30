# CityVUE — Architecture

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

### CityVUE Application/API Layer — Proposed

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

Technology and hosting are TBD.

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

## Canonical Service Request Model — Proposed

Potential fields:

```text
ServiceRequest
- cityvueRequestId
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
- destinationSystem
- mappingProfile
- notificationRules
- trackingCapabilities
```

The catalog hierarchy is `Department → Category → Service`. Department is primarily an internal ownership and routing concept; resident intake normally begins with resident-friendly Categories and Services. A Service may supply versioned dynamic questions, conditional visibility, location requirements, attachment policy, anonymous/contact policy, safety guidance, notification references, and routing metadata.

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

Microsoft Entra ID is a candidate. Potential requirements include City staff sign-in, roles/permissions, protected functions, secure token handling, API authentication, and server-side authorization.

Exact configuration is TBD.

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

Authenticated staff Dashboard scopes are API-authorized views over canonical `ServiceRequest` records. The default future staff view is My Assigned Issues, with Department, Category, group/queue, and All Issues views available only where the signed-in user's roles, memberships, and permissions allow them. Scope selection in React never expands RBAC, and every Dashboard metric must be calculated from the same authorized active scope. Exact API routes and multi-Department/group-work UX remain TBD.

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

Firebase Hosting has been used for the MVP. Future front-end, API, integration, persistence, and background-processing hosting are TBD.

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

1. Production API technology and hosting
2. Persistence/database and system-of-record boundaries
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
