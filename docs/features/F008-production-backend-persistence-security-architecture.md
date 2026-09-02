# F008 — Production Backend, Persistence, and Security Architecture

**Status:** Approved architecture direction; implementation requires separately approved phases
**Scope:** Architecture and design decision only
**Canonical development name:** CityVUE
**Decision date:** August 30, 2026

## Decision Summary

CityVUE should evolve into a modular, vendor-neutral platform built around a TypeScript/NestJS REST API, PostgreSQL, Azure Container Apps, Microsoft Entra ID for workforce identity, Azure Blob Storage for attachments, Azure Key Vault for secrets, and Azure Monitor/Application Insights with OpenTelemetry-compatible instrumentation. The React web application may remain on Firebase Hosting while it transitions from `IssueService` to an injected CityVUE API repository. A future React Native/Expo client consumes the same versioned REST contract.

This document approves a direction, not infrastructure or source code. Tenant identifiers, client identifiers, scopes, roles, permissions, redirect URIs, retention rules, external mappings, credentials, resource names, and City policies remain subject to City ownership and security review.

## Current Production MVP Boundary

```text
React/Vite
    ↓
IssueService
    ↓
browser localStorage
    ↓
cityvueIssues
```

The MVP has no centralized persistence, shared multi-user state, authentication, server-side authorization, backup, assignments, canonical Activity, notifications, attachments, or EAM synchronization. `Issue`, `IssueService`, and `cityvueIssues` remain unchanged during F008. Browser records are origin- and profile-specific and may be demonstration data.

## Target Enterprise Architecture

```text
Residents                     City staff
    |                             |
React Web                   Entra ID sign-in
React Native later                |
    +-------------+---------------+
                  |
           CityVUE REST API
        public + protected routes
                  |
      Application / Domain Services
        |         |          |
 PostgreSQL   Object Store   Outbox/Jobs
        |                    /        \
  canonical data     Notifications  Integration Router
                                      |
                    +---------+-------+--------+
                    |         |       |        |
                 VUEWorks Cityworks Cartegraph MGO/Future
                  Adapter   Adapter   Adapter    Adapter
```

The API is the validation, authorization, workflow, and transaction boundary. React never calls an EAM directly and never holds privileged credentials. Public resident intake and protected staff operations are distinct API surfaces even if deployed in one modular application initially.

## Technology Decision Matrix

| Area | Options considered | Recommendation | Rationale and principal tradeoff |
| --- | --- | --- | --- |
| Language | TypeScript; JavaScript; C# | **TypeScript** | Aligns with the current JavaScript/React team, enables explicit DTO/domain/integration contracts, and supports web/mobile contract reuse. Requires disciplined runtime validation because types disappear at runtime. |
| Backend framework | NestJS; Express/Fastify directly; ASP.NET Core | **NestJS on Node.js**, using its default HTTP adapter initially | Modules, dependency injection, guards, validation, testing, scheduling/queue integrations, and OpenAPI support fit a growing municipal application. It adds framework conventions and runtime reflection compared with lightweight Fastify. ASP.NET Core is an excellent alternative if City operational standards or staffing mandate .NET. |
| API style | REST; GraphQL | **REST, contract-first with OpenAPI** | Resource queries plus explicit workflow actions are simple to secure, observe, cache, document, and consume from web/mobile and integrations. GraphQL adds resolver-level authorization and operational complexity without a demonstrated initial need. |
| Database | PostgreSQL; SQL Server | **PostgreSQL** | Strong relational integrity, transactions, concurrency, reporting, portable SQL, and selective JSON support without making documents canonical. SQL Server remains viable if City support/licensing standards outweigh portability. |
| API hosting | Azure App Service; Azure Container Apps; Functions | **Azure Container Apps** | Managed container deployment, revisions, autoscaling, managed identity, and a path for separate workers/jobs. Container operations are more involved than App Service; App Service is the fallback if City operations prefer it. Functions are reserved for narrow event/scheduled workloads, not the core domain API. |
| Database hosting | Azure Database for PostgreSQL; Azure SQL | **Azure Database for PostgreSQL Flexible Server** | Managed backups, encryption, HA options, monitoring, scaling, and reduced operational burden. Exact HA/networking tiers require environment and recovery objectives. |
| Staff identity | Entra ID; application-local accounts | **Single-tenant Microsoft Entra ID** | Fits workforce identity, MFA/Conditional Access, lifecycle, and City administration. Resident identity remains separate. |
| Authorization | Entra roles; groups; database RBAC; hybrid | **Hybrid** | Entra controls workforce admission and optional coarse app roles/groups; CityVUE stores granular roles, permissions, scopes, memberships, and effective dates. This avoids Graph directory permissions and keeps business authorization auditable. |
| Background work | In-process scheduler; PostgreSQL job/outbox; Service Bus/queue | **Transactional outbox plus PostgreSQL-backed jobs initially** | Preserves atomic business changes and reliable retries without premature distributed infrastructure. Add Azure Service Bus when throughput, independent scaling, or cross-service delivery proves necessary. |
| Attachments | Database blobs; filesystem; Azure Blob Storage | **Azure Blob Storage plus relational metadata** | Purpose-built object storage, lifecycle/security controls, and no base64/blob burden in PostgreSQL. Requires malware-scanning and authorized transfer design. |
| Secrets | environment files; platform config; Key Vault | **Azure Key Vault via managed identity** | Centralizes server secrets and rotation while avoiding committed or browser-visible credentials. Local development uses approved developer-secret tooling/placeholders. |
| Observability | Console logs; Azure Monitor/App Insights; third party | **Structured OpenTelemetry-compatible telemetry to Application Insights/Azure Monitor** | Correlated traces, logs, metrics, dependencies, dashboards, and alerts in the likely Azure estate. Business Activity remains separately persisted. |
| Mobile | Responsive web only; native; React Native/Expo | **React Native with Expo, when approved** | Builds on React/TypeScript knowledge and API contracts. Share contracts and logic, not web UI components or browser assumptions. |

NestJS officially supports structured controllers/providers, validation/security techniques, versioning, task scheduling, queues, testing, and OpenAPI generation. Microsoft recommends authorization code flow with PKCE for SPAs and explicitly states that a SPA cannot safely store a client secret. See [NestJS documentation](https://docs.nestjs.com/), [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction), and [Microsoft authorization-code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

## TypeScript and Contract Direction

All new production API, domain, worker, and adapter code should use strict TypeScript. React Web should migrate gradually when a module is touched for API integration; F008 does not convert it. Keep transport DTOs, domain types, and persistence models distinct. OpenAPI is the canonical external contract; generated TypeScript clients/types may be shared by web and mobile, while server domain objects remain internal. Every request still receives runtime schema validation and authorization.

## API Architecture and Versioning

Start with a modular monolith whose modules express Catalog, Service Requests, Identity/Authorization, Assignments, Workflow, Activity, Notifications, Attachments, and Integrations. Controllers translate HTTP; application services coordinate use cases; domain policies enforce invariants; repositories isolate persistence; adapters isolate vendors.

Use HTTPS JSON REST under `/api/v1`. Ordinary retrieval uses resources and filters; consequential transitions use commands/actions such as `start-work`, `hold`, `resume`, `close`, `reopen`, and `assign`, rather than arbitrary status replacement. Publish an OpenAPI document, use consistent problem details/errors, pagination, correlation IDs, idempotency keys for creation/external effects, and explicit deprecation windows. Introduce `/v2` only for genuinely breaking contracts; prefer additive compatible changes.

## Persistence and Canonical Domain

PostgreSQL is authoritative for CityVUE-owned business data. Use normalized relational tables and constraints for identities, catalog versions, requests, answers, assignments, activities, permissions, external references, notifications, and attachment metadata. JSON/JSONB is appropriate only for bounded metadata or typed values whose contract remains validated—not as an ungoverned replacement for relational design.

Conceptually:

```text
ServiceRequest
  +-- cityvueRequestId / public request number
  +-- ServiceDefinitionVersion
  +-- description
  +-- Answer[]
  +-- Location
  +-- Requester / Contact
  +-- Attachment[]
  +-- Assignment[]
  +-- Activity[]
  +-- Watcher[]
  +-- WorkItem[]
  +-- ExternalSystemReference[]
  +-- IntegrationStatus[]
  +-- RequestStatus / priority / lifecycle timestamps / version token
```

The legacy `Issue` is not this model. Vendor IDs and vendor status fields never become the request identity or canonical workflow.

## Organization / Tenant Architecture

`Organization` is CityVUE's canonical business/domain term for a municipal or government customer; “tenant” describes technical isolation. CityVUE is designed as a reusable Organization-aware product without municipality-specific source forks. The preferred initial government deployment model is one isolated tenant per municipality, including separate application environment, PostgreSQL database, storage, Entra configuration, secrets, integrations, telemetry, backup/restore, disaster recovery, and maintenance windows. This provides stronger isolation and simpler security, procurement, authorization, support, and operational troubleshooting than an initially shared SaaS platform.

Canonical entities remain Organization-scoped even when deployed to separate databases. Conceptually, Organization owns Departments, optional Divisions, Categories, ServiceDefinitions/questions, ServiceRequests, StaffIdentity records, Groups, Roles/Permissions, Assignments, ServiceAreas/GIS configuration, integration configuration/mapping profiles, notification/workflow settings, and attachment context. Organization may later include stable ID, name, short name, slug, active state, `defaultBusinessTimezone`, branding/configuration references, timestamps, and approved metadata; exact schema is deferred. Department, Division, Category, and ServiceDefinition ownership cannot cross Organization boundaries. Every ServiceRequest belongs to exactly one Organization, and Department/Division transfer never changes that ownership.

Phase B identity and authorization must derive a trusted Organization context from the approved deployment and identity configuration, associate each Organization with its Entra tenant and separate SPA/API registrations, scope StaffIdentity/membership/RBAC to that Organization, and enforce isolation server-side. Credentials remain in Key Vault or equivalent secret management rather than ordinary Organization rows. A valid identity, guessed UUID, route/query/body modification, or client-state manipulation must never grant another Organization's data. Cross-tenant administration is explicitly out of scope.

Future repositories and application services must make unscoped access difficult through required `organizationId`, scoped repositories/request context, or an equivalent reviewed design. PostgreSQL Row-Level Security is optional defense in depth only if later justified; it is not automatically selected. Some catalog or authorization names/keys may use Organization-scoped uniqueness, while exact constraints remain TBD. Reference numbers retain globally unique immutable `SR-YYYYMM-NNNNNN` values with no Organization prefix. The monthly period uses `Organization.defaultBusinessTimezone`; a future shared database must allocate the sequence atomically across all Organizations.

Catalog content, presentation/branding references, GIS boundaries/providers/layers, ServiceAreas, EAM adapter configuration, mapping profiles, credentials, `ExternalSystemReference` context, notification senders/rules/templates, attachment storage partitions, background jobs, exports, retention/archival/deletion/migration, and safe telemetry context all remain Organization-scoped. Separate storage accounts/containers per municipality or strongly partitioned Organization containers/paths remain deployment options; the initial isolated model naturally reduces risk. Operational telemetry may include a safe Organization identifier for diagnosis without unnecessary tenant data, while business Activity/audit stays separate.

F008 continues to recommend Azure managed services for the initial enterprise deployment, but the core domain and API remain portable to approved Docker/container hosts, customer-managed VPS environments, or other clouds. Azure-specific managed identity, Key Vault, Blob Storage, and telemetry code belongs at infrastructure boundaries. A shared multi-Organization SaaS model is a future option only after explicit security, tenant-isolation, operational, billing, procurement, backup/restore, and data-governance design and testing. Commercial licensing, intellectual-property ownership, customer contracting, procurement, and data ownership are legal/organizational matters outside this architecture.

Phase A runtime behavior remains unchanged and contains no Organization schema, middleware, or migration. Organization context should join correlation/request context only during an approved identity/domain phase. Canonical database work must implement Organization before or alongside Organization-owned entities; Department or ServiceRequest tables must not precede an explicit ownership/isolation strategy. Future tests must prove cross-Organization denial for IDs, requests, catalog, roles, attachments, integrations, background work, exports, and other tenant data.

### Structured answers

`ServiceRequest.description` remains separate from `answers[]`. Each Answer retains stable `questionId`, exact ServiceDefinition/form version, label/type snapshots, stable option identifiers, option/display snapshots where relevant, typed value, display value where useful, ordering, and audit timestamps. Canonical reconstruction uses the stored version plus Answers; it never reverse-parses a compatibility description. Binary attachment content is referenced, never embedded.

### Catalog persistence and versioning

Persist both `Department → Category → ServiceDefinition → Question` and `Department → optional Division → Category → ServiceDefinition → Question` ownership paths with stable identities and immutable published versions. Draft edits do not change the current published version. Publication is validated, authorized, atomic, audited, and recoverable. Lifecycle states are Draft, Published/Active, Inactive, and Archived. Referenced definitions/options remain resolvable; deactivate/archive rather than hard-delete. Hard deletion is limited to never-used records when approved retention and audit rules permit. Routing metadata and `iconKey` are versioned/audited presentation or routing data; only allow application-controlled icon keys.

## Identity and Security Boundaries

### Entra registration model

Use two single-tenant app registrations:

1. **CityVUE Web SPA** — public client for staff interactive sign-in through MSAL, authorization code + PKCE, and acquisition of a delegated CityVUE API access token. It has approved SPA redirect URIs and no secret.
2. **CityVUE API** — protected resource that exposes a minimal delegated scope and validates issuer, audience, tenant, signature, lifetime, and required claims. It maps the immutable Entra object/subject identity to `StaffIdentity`, then performs CityVUE authorization.

ID tokens establish UI session identity; access tokens authorize API calls. The API does not trust client-supplied roles or route guards. Service-to-service integrations use separately approved workload identity/managed identity or confidential credentials held server-side, never the SPA registration.

Initial staff sign-in should require no broad Microsoft Graph application permissions. Do not request `Directory.Read.All`, `Group.Read.All`, `User.Read.All`, mail permissions, or other Graph access merely to authenticate. Basic token claims plus an application profile can support the first phase. Add Graph only for a specific approved requirement, with least privilege, consent, privacy review, and failure design.

### Authorization and RBAC

Authentication and authorization are separate. Entra establishes the workforce identity and may provide coarse application admission/app roles or approved group claims. CityVUE stores granular roles and permissions, department/group scope, effective dates, and audit history. The API computes effective permissions server-side and defaults to deny.

Permission examples—not final City role policy—include:

```text
ServiceRequests.ViewAssigned     ServiceRequests.ViewDepartment
ServiceRequests.ViewAll          ServiceRequests.Update
ServiceRequests.Assign           ServiceRequests.StartWork
ServiceRequests.Hold             ServiceRequests.Close
ServiceRequests.Reopen           Catalog.Manage
Users.Manage                     Reports.View
```

Role labels such as Staff, Supervisor, Department Manager, Administrator, or System Administrator require business and Cybersecurity approval. Permissions, not labels alone, authorize operations.

### Staff, groups, departments, and assignments

`StaffIdentity` stores the immutable Entra tenant/object identity plus CityVUE profile and active/disabled state; do not key business records by mutable email. Staff may belong to multiple Departments, Divisions, and Groups/Queues and hold multiple scoped roles. Memberships are explicit, effective-dated where needed, and auditable. Division membership must be valid within its Department and is not inferred from Category selection. A disabled staff profile cannot receive new work or sign in, while historical attribution remains.

Assignments are authoritative API/domain records targeting an individual, Group/Queue, Role, or Department ownership. They support unassigned state, transfers, reassignment, source, actor, timestamps, active/current designation, and full history. Direct individual assignment and group queue responsibility are distinct.

### Dashboard scopes

Default staff scope is **My Assigned Issues / My Work**, meaning direct active assignments to that staff identity unless workflow policy later explicitly expands it. **My Group / Queue Work** is separate and does not automatically become My Work merely because the user belongs to the group. Additional scopes—My Department, Selected Division where useful, Selected Category, and All Issues—require explicit permissions and membership. The API applies row-level query constraints, and every count/chart/list uses the same authorized scope; React selection can only narrow or request an allowed scope.

### Residents

Public intake remains separate from workforce Entra. Supported conceptual modes are anonymous, identified contact without an account, and a future resident identity/account only if approved. Public endpoints need abuse controls, rate limiting, privacy-safe responses, and non-enumerable tracking. Do not put `/report` behind workforce sign-in.

## Workflow, Activity, and Transactions

Canonical illustrative statuses are Open, In Progress, On Hold, Closed, and Reopened. Change them through controlled actions—Start Work, Place On Hold, Resume, Close, Reopen—not generic field updates. Each action validates source status, permission, assignment/business prerequisites, reason, closure information, actor, time, and service-specific rules; then records the resulting status, append-oriented Activity, notification outbox events, and integration effects.

Activity is canonical business history, not an application log. It records request creation, answer changes, assignments, transitions, watcher changes, catalog administration, attachments, and integration events with actor/system, timestamp, visibility, old/new values where appropriate, and correlation metadata. Append by default; corrections and retention require governance. Public and internal visibility are explicit and server-authorized.

Use database transactions for request + Answers + initial Activity, assignment + Activity, transition + Activity, notification outbox insertion, catalog publication, and external-reference/integration-status changes. The outbox row is committed with the business change, then processed asynchronously. External network calls occur outside the database transaction with idempotency and recorded outcomes.

Use optimistic concurrency (`version`/row token plus `updatedAt`) on mutable aggregates. Reject stale business-critical writes with a conflict response containing safe current-version context; never silently last-write-wins assignments, answers, or workflow transitions.

## Notifications and Background Jobs

Central NotificationRules select approved recipient classes—requester, assignee, group, watchers—and versioned templates for created, assigned/reassigned, status change, close/reopen, comment/update, and appropriate integration failure events. Persist delivery records with channel, recipient reference, event/activity correlation, template/rule version, queued/attempted/sent/failed timestamps, bounded retry, deduplication key, and terminal failure state.

Begin with a transactional outbox and PostgreSQL-backed job leasing processed by a separately scalable worker in Azure Container Apps. Scheduled Container Apps Jobs may handle periodic maintenance/escalation. Do not depend on in-process timers for durable delivery. Introduce Azure Service Bus only when load, isolation, independent services, or operational requirements justify it.

## Attachments

Use Azure Blob Storage for file bodies and PostgreSQL for Attachment metadata and request/answer associations. Upload/download occurs through API-authorized short-lived flows; object names are opaque and never trust filenames as paths. Enforce approved count/size/type limits, inspect actual content, quarantine pending malware scanning, prevent public containers, log access and lifecycle events, and apply approved retention/deletion/legal-hold rules. Never store base64 in localStorage or the relational database. Exact scanning service, allowed formats, maximums, and retention are City decisions.

## EAM Integration Architecture

```text
ServiceRequest
   ↓
Integration Router
   ↓
Mapping Profile + Capability Check
   ↓
Vendor Adapter
   ↓
External EAM / City system
```

Mapping profiles transform canonical requests/Answers/location/attachments/routing into a target contract. When supported, adapters create or synchronize Work Orders using the CityVUE request ID, Service, description, structured answers, location/GIS or asset references, priority, permitted requester information, attachments, and routing metadata. Responses populate `ExternalSystemReference` with external system/type/ID and synchronization context.

Conceptual adapter responsibilities:

```text
validateConfiguration()
capabilities()
createWorkItem()
updateWorkItem()
fetchStatus()
mapOutboundRequest()
mapInboundResponse()
health()
```

Adapters expose capability gaps explicitly. External status maps through approved per-system mapping profiles: for example, external Active may propose In Progress and Complete may propose Closed. Source-of-truth, direction, conflict resolution, reconciliation frequency, and auto-transition authority remain TBD. Integration events cannot bypass workflow authorization/invariants or Activity; system actors and mapping versions remain auditable.

## Environments, Hosting, Secrets, and Operations

Maintain isolated Development, Test/QA, and Production environments; add ephemeral Preview and dedicated Integration environments where useful. Separate API, database, object storage, secret vault, telemetry, Entra redirect URIs, and EAM credentials. Never use production credentials or personal data in lower environments without explicit authorization and protection.

Initial deployment direction:

- React static web may remain on Firebase Hosting; Firebase does not host or define the API.
- Containerized NestJS API and worker run in Azure Container Apps with managed identities.
- PostgreSQL runs in Azure Database for PostgreSQL Flexible Server.
- Attachments use private Azure Blob Storage.
- Secrets use Key Vault; non-secret client configuration is environment-specific and reviewed.
- Application Insights/Azure Monitor receives operational telemetry.

Use managed identity wherever supported. Secrets never enter React bundles, Git, committed `.env` files, logs, or client configuration. Define CI/CD approvals, image provenance/scanning, least-privilege deployment identities, rollback, database migration gates, backup/restore tests, recovery objectives, private networking posture, and production change control before implementation.

Operational telemetry includes structured logs, request/correlation IDs, traces, latency/error/rate metrics, database/storage/dependency health, authentication/authorization failures, background-job and dead-letter/terminal failures, adapter health, dashboards, alerts, and sensitive-data redaction. Business Activity/audit remains a separate persisted capability with its own access and retention governance.

## Privacy, Validation, and Security Review

Names, email addresses, phone numbers, street/location data, photos/files, staff identities, and audit histories require classification, minimization, purpose limitation, access control, encryption, retention/disposal, records, privacy, breach/incident, and legal review. Do not invent City retention policy.

All authoritative validation is server-side: published ServiceDefinition version, conditional questions, required values, allowed options, types/constraints, geographic eligibility, assignment, permissions, scope, workflow transitions, file policy, and integration capability. React validation only improves UX. Apply TLS, secure headers/CORS allowlists, rate limiting, abuse protection, safe errors, dependency/OS patching, supply-chain controls, and threat modeling.

## Migration from `cityvueIssues` and Frontend Boundary

Do not automatically upload browser-local records. Default production policy is **no automatic migration** because provenance and data quality are unknown. Options requiring separate approval are: leave prototype data behind; provide a user-controlled export; build an administrator-only validated import; or perform a one-time reviewed migration of an explicitly identified data set. Never infer structured Answers by parsing legacy descriptions.

Evolve React through an injected repository boundary:

```text
Components / hooks
      ↓
ServiceRequestRepository interface
      +-- LegacyIssueRepository (temporary local compatibility)
      +-- CityVUEApiRepository (target)
```

Centralize authenticated HTTP, serialization, errors, retries, cancellation, pagination, and concurrency tokens in the API client/repository. Do not scatter `fetch` across components. Cut over deliberately with coexistence/read-only rules, data policy, rollback, and UAT.

## Mobile Direction

React Native with Expo is the likely future Android/iOS path. Share generated OpenAPI client/types, domain/value types safe for clients, validation schemas used for UX, constants, permission identifiers, and catalog contracts. Do not assume web DOM components, CSS, browser storage, or route implementation are reusable.

The API must later support secure mobile Entra staff flow where appropriate, camera/photo attachment flows, GPS/location with consent and accessible alternatives, push-notification registration, deep links, and offline-tolerant UX. Offline writes require explicit conflict, encryption, privacy, and synchronization design rather than silent local queues.

## Testing Strategy

- Pure domain tests for invariants, workflow, routing, and answer validation.
- API unit tests for controllers/application services and error contracts.
- PostgreSQL integration tests using real schema/migrations and transaction behavior.
- Authentication and authorization matrices, including cross-scope denial tests.
- Catalog-version and historical reconstruction tests.
- Adapter unit tests, mapping fixtures, capability tests, and contract tests without production vendor calls.
- Background job/outbox idempotency, retry, and recovery tests.
- Attachment authorization, type/size, scanning, and malicious-file tests.
- React component/contract tests and generated-client compatibility tests.
- End-to-end tests across public intake and protected staff workflows in nonproduction.
- OpenAPI compatibility, database migration, dependency, SAST/DAST, container, penetration, accessibility, load, backup/restore, and disaster-recovery testing appropriate to release risk.

Manual browser testing remains useful but is not the security or regression foundation.

## Implementation Phasing After F008

1. **A — Platform foundation:** repository boundaries, NestJS skeleton, OpenAPI, PostgreSQL, migrations, Development/Test/Production patterns, CI/CD, telemetry, health, Key Vault/managed identity design.
2. **B — Staff identity and authorization:** Entra registrations after approval, token validation, StaffIdentity, hybrid RBAC, denial-first tests. Keep public intake separate.
3. **C — Catalog:** versioned Department/optional Division/Category/ServiceDefinition/Question persistence, ownership validation, publication, server validation, and Admin audit foundation.
4. **D — Canonical requests and Location/GIS:** ServiceRequest internal ID and atomic `SR-YYYYMM-NNNNNN` monthly reference generation, canonical Location persistence, GIS/location service abstraction, per-ServiceDefinition boundary/service-area/property/asset eligibility, Requester/Contact, structured Answers, public create/read boundaries, transactions and concurrency.
5. **E — Staff work:** assignments, authorized dashboard scopes, controlled transitions, Activity/audit, watchers foundation.
6. **F — Notifications:** rules/templates, outbox, worker, delivery/retry/failure operations.
7. **G — Attachments:** Blob Storage, secure transfers, scanning, metadata, retention controls.
8. **H — Integration foundation:** router, capability contract, mapping profiles, reference/mock adapter; then separately approved EAM pilot.
9. **I — Frontend cutover:** API repository, read-only `/issues/:issueId` Details, clickable Issue names, simplified authorized list actions, coexistence/migration decision, production UAT, and deliberate retirement—not reshaping—of legacy storage.
10. **J — Mobile foundation:** React Native/Expo shell and selected workflows after API/security maturity.

Each phase requires its own acceptance criteria, threat/privacy review proportional to scope, tests, rollback, and deployment approval. Do not create cloud resources or production code merely because F008 is approved.

## Addendum — Geographic Eligibility and GIS Boundary

For location-based requests, the CityVUE API is the authoritative geographic eligibility boundary. React and future mobile clients may resolve input and provide immediate feedback, but the API revalidates before ServiceRequest creation so modified JavaScript, payloads, browser-only boundaries, or phone GPS cannot bypass policy. Eligibility is configured per published ServiceDefinition rather than imposed as one universal municipal-limit rule. Conceptual policy modes may include City boundary, canonical ServiceArea, City-maintained roadway, City-owned property/facility/park, GIS asset, utility service area, no geographic restriction, or another approved rule; exact schema and official Service mappings remain TBD.

```text
Resident location input
        ↓
CityVUE API location resolution
        ↓
canonical coordinates / facility / parcel / GIS asset reference
        ↓
vendor-neutral GIS/location service boundary
        ↓
City-approved authoritative boundary, service-area, property, and asset sources
        ↓
Eligible / Ineligible / UnableToDetermine
```

Where eligibility is required, an API-confirmed ineligible result normally prevents creation with plain-language guidance rather than accepting and silently discarding the request. Each ServiceDefinition requires an approved policy for `UnableToDetermine`, such as resident correction, staff review, or manual triage. GIS timeouts, transient failure, retry, degraded/manual-review operation, telemetry, layer ownership, refresh frequency, and availability expectations must be designed explicitly; no provider is assumed always available. City-boundary production checks use authoritative polygon data, not approximate bounding boxes or client definitions.

Canonical Location may retain appropriate entered/display and normalized address, coordinates, type, facility/park/parcel/GIS-asset references, eligibility policy/reference, result, and validation timestamp; exact schema remains TBD. Retain enough context to explain acceptance, rejection, review, or override without automatically storing an entire polygon snapshot. Authorized staff resolution or override requires permission, actor, timestamp, reason, and Activity/audit history. Location precision, authorization, public/staff visibility, retention, exports, logs, and attachment metadata require City privacy/security review.

The GIS boundary remains independent of GIS and EAM vendors. External field formats stay in provider integrations, adapters, and mapping profiles. Geographic eligibility is also separate from Department/Division/Group routing; eligibility may inform an approved routing rule but must not determine ownership by implication. Future tests cover inside/outside and near-boundary points, service-area differences, City and non-City assets, missing/ambiguous locations, GIS unavailability, override authorization/audit, and bypassed client validation. Phase A includes no GIS implementation; canonical Location, GIS abstraction, eligibility validation, resilience, and Admin policy configuration belong to later approved Location/GIS, catalog, and ServiceRequest work.

## Addendum — Division, Details, and Reference Numbers

The canonical organizational model supports `Department → Category` and `Department → Division → Category`. Division is optional: a Department has zero, one, or many Divisions, and each Division belongs to exactly one Department. A Category belongs to exactly one Department ownership hierarchy, either directly or through a Division owned by that same Department. The API/database must reject cross-Department Division references and inconsistent duplicate ownership.

Division is a canonical organizational concept with a stable ID, Department ID, name, optional description, active/inactive lifecycle, order where useful, and timestamps; exact schema awaits implementation. Authorized Admin capabilities eventually include create, rename, activate/deactivate, reorder, associate/move Categories, and audited history. Organizational changes must preserve historical ServiceRequest meaning through archival, versioning, or snapshots. Staff may have multiple Department/Division associations, but Division authorization is explicit rather than inferred from Category. Future Dashboard scopes may include an authorized selected Division without changing the MVP Dashboard.

Canonical ServiceRequest has both an immutable internal UUID/equivalent and an immutable, searchable reference number formatted `SR-YYYYMM-NNNNNN`: `SR` identifies a Service Request, `YYYY` is the four-digit year, `MM` is the two-digit month from `01` through `12`, and `NNNNNN` is the zero-padded six-digit monthly sequence. Examples include `SR-202608-000001`, `SR-202608-012845`, `SR-202609-000001`, and `SR-202701-000001`.

The sequence is global across CityVUE, not daily and not per Department or Division. It restarts at `000001` at the beginning of every calendar month and provides 999,999 references in each `YYYYMM` namespace; this namespace capacity is not a limit on total technical record storage. Complete `referenceNumber` values remain globally unique, so `SR-202608-000001` and `SR-202609-000001` are distinct unique references even though both use sequence component `000001`. PostgreSQL must eventually enforce uniqueness on the complete canonical reference.

The API allocates the monthly sequence and constructs the reference server-side with an atomic, concurrency-safe PostgreSQL strategy so simultaneous requests never receive the same reference. `MAX(referenceNumber) + 1` and equivalent race-prone client or application logic are prohibited. Creation of the ServiceRequest, allocation of its `YYYYMM` sequence, construction of `referenceNumber`, creation of Answers, and creation of initial Activity participate in an appropriate transaction. The exact PostgreSQL counter/sequence design belongs to canonical ServiceRequest persistence, not Phase A.

The canonical `YYYYMM` period comes from an authoritative server-side time policy using an explicitly configured CityVUE business timezone, never the resident's browser clock or an arbitrary client timezone. A request immediately before the configured month boundary uses the previous namespace; the first request after it uses the new namespace beginning at `000001`. The approved business timezone and exact boundary implementation/tests remain decisions for the ServiceRequest persistence phase and are not hard-coded here.

Department and Division are structured canonical relationships and are not encoded in the reference because organizational ownership may change during a request's lifecycle. For example, a request may retain `SR-202608-004821` after transfer from Public Works/Streets to another Department. Once generated, `referenceNumber` never changes through Department or Division transfer, reassignment, Category change, status transitions, reopening, EAM integration, or archival. Database relationships use the internal ID rather than parsing or depending on reference components.

Users must eventually be able to search by the full reference. Reference numbers appear prominently in Details, appropriate lists, resident submission confirmation, notifications, print/export, integrations, and Activity/audit context. External work-order IDs such as `WO-483921` remain separate `ExternalSystemReference` values and are not derived from CityVUE references unless a future approved integration explicitly requires a mapping.

The future Issue List presents **Issue** rather than **Title** and makes each Issue name the primary link to read-only `/issues/:issueId` Details. Details shows only available/authorized sections: reference, Issue, Department/Division, Category, status, priority, reported date, reporter/contact, location, resident description, structured Answers, attachments, assignment, Activity, watchers, external references, and integration status. View does not imply Edit/Delete permission. Authorized Edit/Delete actions should live on Details; a compact list More menu remains an implementation option. The API authorizes each operation independently.

These requirements do not enter Phase A. Division/ownership belongs to the later catalog/domain phase, reference generation to canonical ServiceRequest persistence, and Details/list changes to frontend API transition. Existing browser-local records receive no fabricated or backfilled references; any legacy migration remains separately reviewed.

## Conflicts and Open Decisions

No conflict was found with F002, F003, `ARCHITECTURE.md`, or `ROADMAP.md`. F008 resolves technologies those documents intentionally marked TBD and preserves all governing domain and migration boundaries.

Still requiring City decisions: authoritative systems/field ownership; infrastructure standards and procurement; recovery/availability objectives; catalog governance; role/permission grants; workflow reasons and transitions; resident identity/tracking; data classification/retention; attachment limits/scanning; notification channels/content/consent; EAM capabilities/endpoints/mappings/source-of-truth; and operational ownership.

## Appendix A — City Cybersecurity / Microsoft Admin Request Checklist

### Context

- CityVUE is a City-controlled, vendor-neutral resident service-request platform with a future protected staff workspace and API.
- Resident public intake is not workforce authentication. Anonymous and identified-contact modes remain available according to approved policy.
- Staff authentication is single-tenant Microsoft Entra ID; API authorization remains server-side and application-specific.

### Requested identity review and inputs

- [ ] Confirm City business owner, application owner, registration owner, support owner, and Cybersecurity reviewer.
- [ ] Approve a **CityVUE Web SPA** app registration, single-tenant supported account type, and associated Enterprise Application.
- [ ] Provide/approve Tenant ID and SPA Application (client) ID through approved configuration channels.
- [ ] Approve authorization code + PKCE through MSAL; disable reliance on implicit flow.
- [ ] Confirm that no client secret or certificate will be created for or placed in the SPA.
- [ ] Approve exact production SPA redirect/logout URI(s) and exact localhost development redirect URI(s); register each by environment and remove stale URIs.
- [ ] Approve a separate **CityVUE API** app registration/Enterprise Application as a protected resource.
- [ ] Approve API Application ID URI and minimal delegated scope naming/consent direction; do not invent values before review.
- [ ] Confirm access-token issuer/audience/tenant/claim validation requirements and acceptable token libraries.
- [ ] Decide whether Enterprise Application user assignment is required and how break-glass/support access is governed.
- [ ] Confirm Conditional Access, MFA, compliant-device/location/session policies, and non-interactive/workload identity policy.
- [ ] Define delegated-permission/admin-consent workflow and who may grant/revoke consent.
- [ ] Review whether coarse Entra app roles or security groups should gate application admission; CityVUE database permissions remain granular authorization.
- [ ] Review group-claim overage and lifecycle implications before relying on token groups; do not assume Graph fallback.
- [ ] Approve initial **no broad Graph permission** posture. `Directory.Read.All`, `Group.Read.All`, `User.Read.All`, mail permissions, and other Graph access are excluded unless a specific reviewed requirement demonstrates need.
- [ ] Confirm staff provisioning/deprovisioning, disabled-user behavior, immutable object-ID mapping, audit, access review, and privileged-role governance.
- [ ] Complete threat modeling, privacy/data classification, logging/redaction, penetration/security testing, dependency/container review, incident response, and production approval requirements.
- [ ] Confirm owners/process for credential or certificate rotation for any future confidential server integration; SPA remains secretless.

No credentials, tenant values, application identifiers, scopes, or production URIs are contained in this architecture decision.

## References

- [Microsoft identity platform: authorization code flow and PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Microsoft identity platform protocols and app registrations](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols)
- [NestJS documentation](https://docs.nestjs.com/)
- [NestJS OpenAPI support](https://docs.nestjs.com/openapi/introduction)
- [Azure Container Apps documentation](https://learn.microsoft.com/en-us/azure/container-apps/)
- [Azure Database for PostgreSQL documentation](https://learn.microsoft.com/en-us/azure/postgresql/)
- [Azure Key Vault documentation](https://learn.microsoft.com/en-us/azure/key-vault/)
- [Azure Monitor Application Insights documentation](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview)
