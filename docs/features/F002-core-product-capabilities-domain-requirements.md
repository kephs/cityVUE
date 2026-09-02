# F002 — Core Product Capabilities and Domain Requirements

**Status:** Product/domain foundation; proposed capabilities, not implemented  
**Scope:** Documentation and architecture only  
**Canonical development name:** CityVUE  
**Related plan:** `F001-react-migration-plan.md` remains authoritative for the controlled React/Vite parity migration.

## Purpose

CityVUE is intended to become a vendor-neutral citizen-engagement and municipal service-request platform. This specification records the long-term product capabilities and conceptual domain needed to support that direction before further React migration work.

This document defines requirements and boundaries. It does not approve a production schema, API, database, identity system, workflow, notification channel, integration endpoint, or City policy.

## Current MVP and Migration Boundary

The current `Issue` model and `IssueService` are a temporary MVP compatibility implementation. They persist records in browser `localStorage` under the `cityvueIssues` key. They are not the future canonical CityVUE domain.

The React migration remains a controlled parity migration:

- The `Issue` record shape and `cityvueIssues` storage schema remain unchanged throughout parity stages unless a separately approved task changes them.
- React components must not prematurely implement the future `ServiceRequest` domain.
- New React code should avoid unnecessary coupling to storage, route state, component props, or vendor concepts so a later CityVUE API and canonical model can replace the MVP boundary deliberately.
- Domain implementation, persistence migration, and data conversion must not be combined silently with UI parity work.
- F001 remains the authoritative migration plan. F002 supplements it with future product/domain requirements and does not change its stages.

## Product Principles

1. CityVUE presents a consistent, citizen-friendly experience regardless of the destination enterprise system.
2. No VUEWorks, Trimble Cityworks, OpenGov Cartegraph, MGO, VistaShare, or future vendor schema becomes the canonical CityVUE model.
3. Vendor-specific identifiers, fields, statuses, endpoints, and transformations remain inside adapters and explicit mappings.
4. Service rules, routing, notification behavior, and destination metadata should become configuration/data-driven where practical.
5. Privileged operations, authorization, notification delivery, integration processing, and credentials belong behind a server-side boundary.
6. Significant request changes should be auditable rather than silently overwritten.
7. Public/requester-visible information and internal staff information require an explicit visibility boundary.
8. Canonical entities belong to an `Organization`; tenant isolation and Organization-scoped authorization are server-side invariants even when initial municipalities use separate deployments.

## Conceptual Domain Direction

The following concepts are architectural requirements only. F002 does not create production classes, schemas, collections, or tables.

```text
ServiceRequest
  |
  +-- Assignment(s)
  +-- Activity[]
  +-- Watcher[]
  +-- Attachment[]
  +-- WorkItem[]
  +-- ExternalSystemReference[]
  |
  +--> Notification orchestration
```

### Core concepts

| Concept | Responsibility |
| --- | --- |
| `Organization` | Canonical municipal/government customer and ownership boundary for domain data, staff/authorization, configuration, catalog, GIS, integrations, notifications, and storage context; “tenant” describes technical isolation. |
| `ServiceRequest` | CityVUE-owned representation of a citizen issue or service need, including request number, service/category, location, requester details when appropriate, priority, status, responsible department, and lifecycle timestamps. |
| `Service` | Catalog definition for a requestable service, intake requirements, ownership, routing metadata, notification rules, and destination metadata. |
| `Category` | Citizen- and staff-usable classification that may organize services and support dependent selection. |
| `Location` | Neutral representation of an address, intersection, park/facility, non-address place, coordinates, map selection, or linked GIS asset. |
| `Department` | City organizational responsibility without assuming an external vendor's organization model. |
| `RequestStatus` | CityVUE status and permitted workflow meaning, with approved mappings to external statuses kept separate. |
| `Assignment` | A timestamped assignment of a request to a staff identity, group/team/queue, or role, including assignment source and history. |
| `Activity` | Append-oriented, timestamped record of a significant request event, actor, visibility, changes, and supporting metadata. |
| `Watcher` | A follower interested in request activity who is distinct from the requester and assignee. |
| `Notification` | A delivery instance produced by orchestration, with recipient/channel/event context, state, attempts, timestamps, and deduplication identity. |
| `NotificationRule` | Centrally managed rule defining which events notify which audiences through which templates/channels and under what conditions. |
| `Attachment` | Securely handled file/photo plus metadata and optional external synchronization state. |
| `WorkItem` | Internal unit of work or reference to supported external work, such as a task or work order, without forcing one vendor's work model into CityVUE. |
| `StaffIdentity` / `User` | Authorized staff identity; workforce Microsoft Entra ID is a candidate, subject to an approved identity design. |
| `Group` / `Team` | Staff grouping or work queue used for responsibility, assignment, permissions, and notifications as approved. |
| `Role` | Named responsibility used for authorization or role-based routing where appropriate. |
| `Permission` | Server-enforced capability granted according to an approved authorization model and least privilege. |
| `ExternalSystemReference` | Link between a CityVUE entity and an external system record, including system, external identifier/type, synchronization context, and timestamps. |
| `IntegrationStatus` | CityVUE-owned state describing submission/synchronization progress and failures independently of the external record's business status. |

Final identifiers, fields, cardinalities, retention rules, authoritative ownership, and storage technology remain TBD and require approved design/ADRs. Every canonical ServiceRequest belongs to exactly one Organization independently of Department/Division/Category/Assignment, and owned relationships may not cross Organization boundaries. Canonical domain implementation must introduce Organization before or alongside Organization-owned entities.

## Assignment and Routing

A future `ServiceRequest` must support:

- manual assignment to an individual staff user;
- assignment to a group, team, or work queue;
- role-based assignment where appropriate;
- automatic assignment through configurable rules;
- reassignment and transfer between departments/groups;
- an unassigned queue;
- staff views for My Assignments, My Group's Requests, and Unassigned Requests;
- complete assignment history, assignment timestamps, and the actor or system responsible;
- future escalation rules.

Automatic routing may consider the selected service, category, department, location, GIS asset, priority, and other approved request attributes. Routing rules must be explicit, configurable, observable, and neutral to the destination vendor. They must define predictable fallback/failure behavior rather than silently dropping a request.

Requester, assignee, watcher, responsible department, and destination enterprise record are distinct concepts. An assignment must not be inferred merely from request creation, notification delivery, watcher membership, or an external-system owner.

## Activity History and Auditability

Every significant `ServiceRequest` event should eventually create a timestamped `Activity` record. Expected event types include:

- request created, updated, resolved, reopened, cancelled, or closed;
- assigned, reassigned, group changed, or transferred;
- status or priority changed;
- public comment or internal note added;
- attachment added;
- watcher added or removed;
- integration submitted, succeeded, or failed;
- work order or other work item created.

An activity should be capable of recording:

- activity ID and request ID;
- activity type and timestamp;
- actor type and actor ID when applicable, including system-generated actions;
- old and new values where appropriate;
- visibility classification;
- structured metadata and correlation context where appropriate.

Activity is an auditable history, not merely the latest value. Corrections, retention, deletion, and access policies require approved governance; implementations should not silently rewrite history. Public/requester-visible activity and internal staff activity must be explicitly distinguished and protected by server-side authorization. Sensitive internal metadata must not leak into public timelines or notifications.

## Watchers

CityVUE should support watchers/followers who may receive request activity notifications. Watchers can be added or removed and may later have notification preferences.

A watcher does not automatically become the assignee, requester, owner, or authorized editor. Adding/removing a watcher should itself be auditable. Eligibility, who may manage watchers, public watcher support, and privacy rules remain TBD.

## Notification Orchestration

CityVUE should eventually orchestrate notifications for requesters, assignees, watchers, and configured groups/recipients. Candidate events include submission, assignment, reassignment, status change, comment/update, resolution, reopening, cancellation, escalation, and integration failure.

Notifications should provide only information appropriate to the recipient and visibility context, potentially including the CityVUE request number, request summary, triggering activity, activity timestamp, current status, and an appropriate request link.

Notification rules and templates must be centrally managed/configurable. React components may request an operation or display notification state, but must not hard-code recipient/routing rules or deliver email. Delivery should use server-side/background processing and conceptually support:

- queued, sent, failed, and retrying states;
- creation, attempt, sent, failure, and next-retry timestamps;
- bounded retry and observable terminal failures;
- idempotency/deduplication to prevent duplicate notifications;
- template/rule version or equivalent traceability;
- correlation to the activity/request that caused delivery;
- audit and operational reporting without exposing sensitive content unnecessarily.

Channels beyond email, including SMS or push, require separate approval and channel-specific consent, security, accessibility, and operational requirements.

## Long-Term Product Capabilities

### Service request management

- Report an issue or request a service and receive a unique CityVUE request number.
- Capture appropriate requester information, service/category, location, priority, department, status, and lifecycle dates.
- Search, filter, and sort requests; track progress and present citizen-friendly status.
- Support permitted edits, cancellation, deletion, resolution, reopening, and closure under approved authorization, records, and workflow rules.

### Service catalog and dynamic intake

- Maintain a service catalog with dependent categories/services, citizen-friendly descriptions, required/optional fields, and dynamic questions.
- Support conditional follow-up questions and validation.
- Configure routing, responsible department, notifications, destination system, mapping, and capability metadata per service.

### Location and GIS

- Support approved address autocomplete and validation sources.
- Represent intersections, parks/facilities, non-address locations, coordinates, map/drop-pin selection, and GIS asset links.
- Determine geographic eligibility per ServiceDefinition through an API-authoritative configured policy rather than one universal municipal-boundary rule; approved policies may use City boundaries, ServiceAreas, City-owned/maintained property or roadway, facilities/parks, GIS assets, utility areas, or no geographic restriction.
- Resolve Location to canonical coordinates or appropriate facility/parcel/asset references and distinguish `Eligible`, `Ineligible`, and `UnableToDetermine`; Service-specific policy governs correction, blocking, staff review, or manual triage.
- Use a vendor-neutral GIS/location service boundary over authoritative City-approved sources, with resilience, observability, privacy, audit, and permission-controlled override requirements.
- Provide accessible non-map alternatives and avoid making a vendor GIS schema canonical.

### Attachments

- Support photos and multiple attachments with type, size, ownership, timestamps, visibility, security/scanning, retention, and accessibility metadata as appropriate.
- Track synchronization to external systems without making external attachment identifiers canonical.

### Staff workspace

- Provide dashboards and a request workspace with My Assignments, Group Assignments, Unassigned Requests, search/filter/sort, internal notes, public comments, watcher controls, workflow actions, and authorized administration.
- Clearly distinguish internal notes from requester-visible comments.

### Identity and authorization

- Evaluate Microsoft Entra ID for staff identity; citizen identity remains TBD.
- Define staff identities, groups, roles, and permissions under least privilege.
- Enforce authorization independently on protected APIs; route guards are not a security boundary.
- Audit privileged access and changes according to approved policy.

### Workflow and work management

- Define statuses and valid transitions, assignment/routing, work items/work orders, due dates, resolution codes, and closure reasons.
- Support future SLA/escalation rules without inventing City targets or vendor behavior.
- Represent destination capabilities explicitly when an adapter cannot perform a requested operation.

### Integrations

- Support VUEWorks, Trimble Cityworks, OpenGov Cartegraph, MGO, VistaShare, and future City systems through adapters and a configuration-driven integration router.
- Keep privileged credentials and direct enterprise calls out of browser code.
- Use explicit mappings and capability declarations; do not invent undocumented vendor APIs or status meanings.

### Analytics and reporting

- Report requests by status, category, service, and department; assignee/group workload; unassigned work; aging; resolution time; trends; integration failures; and notification failures.
- Apply authorization, privacy, retention, data-quality definitions, and accessible presentation to reporting.

### Mobile and accessibility

- Maintain responsive web behavior and allow future React Native evaluation without making it a requirement now.
- Future mobile capabilities may include camera, GPS, and push notifications.
- Support keyboard use, screen readers, accessible validation, focus management, reduced motion, sufficient contrast, and accessible alternatives to maps/visualizations.

### Security and operations

- Require TLS, input validation, safe output handling, secure credential management, least privilege, audit logs, retention rules, backups/recovery, and monitoring/alerting.
- Maintain separated Development, Test/Training, and Production environments with approved CI/CD, rollback, and change management.
- Define privacy, records ownership, data residency, support ownership, incident response, and disaster recovery before production use.

## Server-Side and Background Responsibilities

The future CityVUE API/application boundary should own or enforce canonical validation, authentication/authorization, workflow transitions, assignment rules, activity creation, watcher authorization, notification orchestration, request-number generation, persistence, integration routing, idempotency, and audit/observability controls.

Background workers or equivalent server-side processing should handle notification delivery and integration submission/synchronization where reliable queuing, retry, deduplication, and failure recovery are needed. Specific API, database, queue, hosting, and worker technologies are intentionally TBD.

## Data Ownership and Integration Boundaries

CityVUE-owned fields, external-system-owned fields, synchronization direction, conflict resolution, and system-of-record boundaries must be decided before implementation. `ExternalSystemReference` preserves links to vendor records; it does not make their schemas or identifiers the CityVUE request identity.

External business status and `IntegrationStatus` are different: a request can have a CityVUE workflow status while its transmission/synchronization is queued, successful, retrying, or failed. Any status normalization requires approved mappings.

## Non-Goals for F002

F002 does not:

- change application behavior, the `Issue` model, or the `cityvueIssues` schema;
- migrate another React page or start React Stage 2;
- create production domain classes, API contracts, database collections/tables, or migrations;
- implement a backend, database, authentication, authorization, email, notifications, watchers, assignments, routing, workflow, or integrations;
- define vendor endpoints/capabilities, City policy, workflow mappings, SLAs, roles, permissions, retention, or identity configuration;
- change Firebase Hosting, deployment configuration, dependencies, or deploy anything.

## Acceptance Criteria

- The future vendor-neutral concepts and their boundaries are documented.
- Assignment/routing, activity/audit, watchers, and notification orchestration requirements are explicit.
- Long-term product capabilities cover intake, GIS, attachments, staff work, identity, workflow, integrations, analytics, mobile, accessibility, security, and operations.
- Server-side/background responsibilities and public/internal visibility are explicit.
- React parity compatibility and the unchanged MVP `Issue`/`cityvueIssues` boundary are explicit.
- Architecture, roadmap, and concise project context reference this direction without claiming implementation.
- Existing regression tests, Parcel production build, React/Vite production build, and `git diff --check` pass, or failures are reported exactly.

## Decisions Required Before Implementation

At minimum, later approved work must decide canonical field/cardinality design; persistence and systems of record; identity and authorization; requester privacy; workflow transitions; assignment precedence/fallbacks; activity retention/correction rules; watcher eligibility; notification channels, consent, templates, and retry policy; attachment storage; queue/background architecture; vendor capabilities/mappings; reporting definitions; and operational ownership.
