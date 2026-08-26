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

Document durable decisions as ADRs under `docs/decisions/`.
