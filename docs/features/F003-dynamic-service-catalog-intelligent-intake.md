# F003 — Dynamic Service Catalog and Intelligent Intake

**Status:** Proposed product and architecture specification  
**Type:** Documentation only  
**Canonical development name:** CityVUE

## Purpose

CityVUE must evolve from the current static Report an Issue form into a configuration-driven municipal service intake platform. Authorized administrators should eventually be able to change services, questions, routing metadata, and required information without requiring a React source-code change for every administrative update.

This specification establishes the product direction and responsibility boundaries. It does not approve or implement a production schema, API, database, administrator portal, authentication system, rule engine, attachment service, or React dynamic form.

## Current MVP Compatibility Boundary

The current React Report Issue workflow is a temporary MVP compatibility form. It collects title, description, category, priority, reported-by, and location values, then saves the current `Issue` shape through `IssueService` under `cityvueIssues`.

F003 does not change that workflow, model, service, or storage schema. A separately approved Stage 5.1 may demonstrate catalog-driven intake while mapping only compatible values into `Issue`. Rich answers that cannot safely fit the existing shape require an explicit future domain and migration decision; they must not be added as arbitrary properties.

## Product Principles

- Residents should select what they need, not the internal department that owns it.
- Catalog names, descriptions, aliases, and questions should use resident-friendly language.
- Only questions relevant to the selected Service should be shown.
- Configuration is authoritative only when validated and published by the future CityVUE application/API layer.
- Historical requests must remain understandable after catalog changes.
- Routing and vendor mappings are internal concerns and must not leak into resident UI logic.
- CityVUE owns the canonical catalog; no vendor schema becomes the CityVUE model.

## Catalog Hierarchy

```text
Department
   +-- Category[]
           +-- Service[]
```

- Every `Service` belongs to one `Category`.
- Every `Category` belongs to one `Department`.
- Departments and Categories may contain many children.
- Department is primarily an internal ownership and routing concept.
- Resident intake normally begins with Category, followed by Service and relevant questions.
- Resident-facing wording may use “service,” “issue,” or “concern” after UX approval, while the neutral domain term remains `Service`.

Residents should not need to know which department, group, role, or enterprise system owns a Service.

## Target Resident Intake Flow

1. Select or search active Categories.
2. Select or search an active Service within the Category.
3. Answer service-specific follow-up questions.
4. Provide only the applicable location information.
5. Add supporting photos or files when permitted.
6. Choose anonymous or identified submission when policy allows.
7. Provide contact information when not anonymous.
8. Choose an available notification preference.
9. Review the request.
10. Submit.

The detailed UI and step structure remain subject to accessibility testing and product approval.

## Category Experience

Resident intake should preload active Categories with resident-friendly names, optional descriptions, and configurable display order. Category search may be introduced as the catalog grows. Internal departmental jargon should be avoided where it does not help residents. Administrators must eventually be able to manage Category metadata and its hidden Department relationship.

## Service Discovery and Live Search

After Category selection, the UI should show only active Services in that Category. Live search should match normalized resident-facing metadata including:

- canonical and display names;
- citizen-facing descriptions;
- keywords;
- aliases and synonyms; and
- common resident terminology.

For example, `Pothole` may match “hole in road,” “street damage,” “pavement damage,” “broken asphalt,” or “crater.” A future “Not sure which category?” experience may search the full active catalog. F003 does not introduce AI or chatbot behavior.

Search behavior requires future decisions for normalization, ranking, typo tolerance, localization, result limits, accessibility announcements, and analytics. Search configuration belongs in catalog data rather than hard-coded React conditionals.

## Conceptual ServiceDefinition

A future `ServiceDefinition` may include:

```text
ServiceDefinition
- serviceId
- name
- citizenDisplayName
- citizenDescription
- departmentId
- categoryId
- keywords[]
- aliases[]
- questions[]
- anonymousPolicy
- locationRequirements
- attachmentRules
- defaultPriority
- defaultGroup
- defaultRole
- routingRules[]
- notificationRules[]
- destinationSystem
- mappingProfile
- trackingCapabilities
- lifecycleStatus
- version
- createdAt
- updatedAt
- publishedAt
```

These fields are conceptual. Identifiers, cardinalities, constraints, ownership, and persistence format require later design approval.

## Dynamic Questions

A Service may define zero or more ordered follow-up questions. A conceptual `DynamicQuestion` or `FormQuestion` may contain:

```text
DynamicQuestion
- questionId
- serviceId
- label
- helpText
- placeholder
- fieldType
- required
- displayOrder
- options
- validationRules
- visibilityRules
- internalMappingName
- lifecycleStatus
- version
```

Potential field types include short text, long text, number, yes/no, single-select, multi-select, checkbox, date, time, date/time, email, phone, address/location, file/photo upload, and acknowledgement. These are available capabilities, not fields every Service must use.

Configuration must support required or optional questions and appropriate minimum/maximum numbers, text length, format, allowed-option, and date constraints. The future API must repeat authoritative validation; browser validation is not a security or integrity boundary.

## Conditional Questions

Questions may be conditionally visible based on earlier answers. Candidate conditions include equals, not-equals, contains, selected option, numeric comparison, and answer-present. For example, answering Yes to “Is the tree blocking the roadway?” may reveal “Is the roadway completely blocked?”

The eventual rule format must be deterministic, testable, cycle-safe, versioned, and supported by both presentation and server validation. F003 does not define a general-purpose production rule engine.

## Location Requirements

Each Service should declare whether location is required, optional, or not applicable and which modes it supports. Candidate modes are street address, intersection, park, City facility, trail, parcel, map pin, current/GPS location, GIS asset, and free-text description.

Contextual location questions may include nearest intersection, landmark, direction of travel, side of street, lane, asset number, facility name, and additional description. Residents should not be forced through irrelevant fields. Address validation, GIS resolution, geolocation permissions, and asset lookup remain later capabilities with accessible non-map alternatives.

## Attachment Policy

Service-level configuration may specify whether attachments are allowed, required, or recommended; maximum count and size; and allowed types. Future attachment metadata may record an attachment identifier, original filename, content type, size, upload time, uploader identity/type, request association, and optional question association.

Production attachments require secure storage, authorization, malware scanning, content and type validation, privacy controls, retention rules, and safe download behavior. No attachment storage or upload behavior is implemented by F003.

## Anonymous and Contact Policies

A Service should configure anonymous submission as `Allowed`, `Not Allowed`, or `Allowed With Limitations`. Anonymous intake must not require contact information and should explain that clarification and updates may be unavailable. Services may require identity or contact information only under approved business, legal, or operational policy.

Identified submissions may collect name, email, phone, and preferred contact method. Email verification is a potential future capability, not an F003 implementation. Notification preferences such as email updates should be collected only where supported; delivery remains governed by F002 notification orchestration.

## Review Before Submit

Before final submission, residents should be able to review the selected Service and Category, location, answers, attachments, contact information, and notification preference. They should be able to return to earlier steps to correct information or submit the reviewed request. Final multi-step navigation and state-retention behavior require a later UX specification.

## Safety and Emergency Guidance

CityVUE must state that it is not a replacement for emergency services. General guidance such as “For emergencies or immediate threats to life or safety, call 911” and approved Service-specific warnings should be centrally configurable rather than scattered through React code. Content, placement, escalation wording, and links require City approval and accessibility review.

## Duplicate Request Reduction

Duplicate detection is a candidate future capability. It may consider Service, geographic proximity, time window, and open status, then offer similar nearby requests before submission. Residents may be able to view an existing request or continue when appropriate. Privacy, false matches, authoritative status, override rules, and performance must be resolved before implementation.

## Contextual Information

Service-specific questions may gather severity, dimensions, affected-item count, first-observed date, time, duration, frequency, direction of travel, landmark, property relationship, facility, accessibility impact, hazard indicators, vehicle information, asset identifiers, or comments. CityVUE must not combine these examples into one universal form.

## Administrator Catalog Management

Future authorized administrators may manage Departments, Categories, Services, and Questions through create, edit/rename, reorder, activate, deactivate, archive, clone, preview, and publish operations. Authorization must be enforced by the future API; hiding UI controls is insufficient.

Catalog configuration should support preview and validation before publication. Changes to ownership, questions, routing, safety content, anonymous policy, and integrations require appropriate permissions and governance.

### Admin-Selectable Presentation Icons

Future authorized administrators should be able to select presentation icons for Categories and Services/Issue Types. Department icons may be considered later but are not required for the resident interface. Icon selection is presentation metadata and must not affect ownership, routing, validation, priority, or integration behavior.

Conceptual Category and ServiceDefinition metadata may include a stable logical `iconKey`; the exact persistence schema remains TBD:

```text
Category { id, name, iconKey: "signpost-split" }
ServiceDefinition { id, name, iconKey: "cone-striped" }
```

Administrators must choose from an approved, application-controlled library through a searchable picker that previews the icon, supports change and default/fallback selection, and stores only the stable logical key. Bootstrap Icons is the initial candidate library. Arbitrary HTML, SVG markup, JavaScript, CSS class strings, and remote image URLs are prohibited. The presentation layer maps an approved key to an installed icon and must tolerate missing or retired keys.

Canonical rendering precedence is `Service.iconKey → Category.iconKey → CityVUE generic service/request icon`. Icons normally remain decorative when visible text supplies the accessible name. A missing icon must never prevent Category, Service, or request content from rendering.

The selected metadata may be reused consistently in Report intake, Issue/Request List, Request Details, edit context, Dashboard, search results, a future mobile application, and future Admin preview. Administrators choose once and CityVUE presentation surfaces render the same approved selection.

Icon changes are auditable catalog-presentation changes under the F002/F003 Admin-change audit direction. Historical ServiceRequests do not need to snapshot an earlier icon unless a future requirement mandates exact historical visual reproduction. Icon changes may participate in catalog metadata versioning and audit without forcing request business-data changes; detailed version and rollback policy remains TBD.

## Lifecycle and Deletion

Catalog entities should use explicit lifecycle states such as Draft, Published/Active, Inactive, and Archived. Entities referenced by historical requests should normally not be physically deleted. Hard deletion may be considered only when an entity has never been used and approved audit, retention, and business rules permit it.

Archived or changed definitions must remain resolvable for historical requests. Display snapshots may be needed in addition to immutable identifiers and versions.

## Versioning and Publishing

Administrators should be able to edit and test a draft without changing the currently published resident experience. For example, Service version 4 may remain Published while version 5 is Draft. Publication should be atomic, validated, authorized, auditable, and recoverable according to future governance.

A submitted `ServiceRequest` must retain enough information to identify the exact Service and form version used. Decisions remain for effective dates, rollback, concurrent drafts, dependency versioning, and whether published versions are immutable.

## Administrator Audit

Future catalog changes must record actor, timestamp, action, affected entity, and appropriate previous/new values. Auditable events include renames, reassignment, required-field changes, routing changes, publication, and archival. This aligns with F002's append-oriented Activity and audit direction; visibility, retention, correction, and export policies remain unresolved.

## Routing Metadata and Conditional Routing

Service configuration may reference responsible Department, default Group, default Role, default Priority, routing and escalation rules, destination system, mapping profile, and notification rules. These details are internal and should not be shown to residents unless they provide approved, useful status information.

Routing may later consider submitted answers. A Fallen Tree request might route differently for a City park, roadway obstruction, or immediate hazard. Routing must be authoritative, deterministic, testable, versioned, observable, and enforced server-side. F003 does not define or implement a production routing engine or City routing decisions.

## Vendor Neutrality

CityVUE owns the canonical Department, Category, Service, Question, and policy concepts. VUEWorks, Cityworks, Cartegraph, MGO, VistaShare, and other schemas must remain behind `destinationSystem`, `mappingProfile`, the Integration Router, and vendor adapters. Catalog configuration must not require resident UI components to understand a vendor schema.

## Presentation and API Responsibilities

```text
React presentation                         Future CityVUE API/application
------------------                         ------------------------------
Render supplied Categories                 Own authoritative catalog
Search supplied active catalog data        Authorize Admin operations
Render configured questions                Persist/version/publish configuration
Collect answers and location               Validate submissions server-side
Show validation and safety guidance        Route and create requests
Support accessible resident interaction    Own attachments, audit, notifications
                                             Orchestrate enterprise integrations
```

React must not become the authority for Admin rules, routing, publication, or vendor mappings.

## Structured Dynamic Answers and Edit Reconstruction

The Stage 5.1 compatibility workflow currently combines the resident's general description and visible dynamic question labels/answers into the legacy `Issue.description` string. This preserves the existing `Issue`/`cityvueIssues` boundary, but the resulting human-readable summary is lossy and is not an authoritative structured answer source. Existing compatibility descriptions must not be reverse-parsed to fabricate answers.

Future canonical `ServiceRequest` records must keep the resident's free-text `description` separate from structured `answers[]`. A conceptual `Answer` may include:

```text
Answer
- answerId
- serviceRequestId
- questionId
- serviceDefinitionVersion
- questionLabelSnapshot
- questionTypeSnapshot
- option/display-value snapshot, where applicable
- value
- normalizedValue, where appropriate
- displayValue, where appropriate
- displayOrder
- createdAt
- updatedAt
```

These properties are conceptual and do not define a production class, database schema, or storage technology.

Every configured question requires a stable `questionId`; answer identity must not depend on a visible label that an administrator may rename. Submitted answers should also retain appropriate version-time display metadata, including the question label and type and, where relevant, option/display-value snapshots. Historical requests must remain understandable if labels, help text, types, ordering, or options later change.

Each canonical request must reference the exact published ServiceDefinition/form version used at submission, conceptually through `serviceDefinitionId` and `serviceDefinitionVersion`. Historical published definitions, immutable snapshots, or an equivalent versioned representation may need to remain available. Old answers must not be silently reinterpreted using the latest definition. If an option is renamed or retired, its originally submitted display value must remain visible; policy for editing retired options is TBD and must avoid silent replacement.

Answers should preserve appropriate semantic types without prescribing database-specific types: text as strings, numbers as numeric values, yes/no as a boolean or approved canonical enum, single-select as a stable option identifier with a display snapshot where appropriate, multi-select as structured option identifiers, dates and times in canonical representations, and file/photo responses as references to `Attachment` entities. Binary data, blobs, and base64 content must not be embedded in answer text fields.

Canonical edit reconstruction must use the request's associated ServiceDefinition version plus its stored structured Answer records. The UI can then render a number input, yes/no control, select/radio control, textarea, or other approved control according to the versioned question definition. It must not reconstruct controls by parsing `description`. A future Request Details view should distinguish the resident description from an “Additional Information” section whose labeled values derive from structured answers and versioned questions.

Only answers for questions visible and applicable at submission should normally be persisted; hidden stale answers must not become canonical answers. The future CityVUE API/domain must validate required visible questions, types, allowed options, numeric constraints, conditional visibility, and applicable rules against the exact published definition version. React validation supports user experience but is not authoritative.

Administrators may later rename, reorder, modify, deactivate, or archive questions and options. Questions referenced by historical requests should normally be archived/versioned rather than hard-deleted. Answer changes should participate in F002's append-oriented Activity/audit model, conceptually recording actor, timestamp, affected question/answer, previous value, and new value.

Responsibility remains divided as follows:

- React renders versioned questions, collects answers, and displays structured edit fields.
- The future CityVUE API/domain authorizes edits, validates and persists Answer records, preserves definition versions and historical integrity, returns structured request details, and audits modifications.
- Integration mapping profiles may transform CityVUE `Answer[]` into VUEWorks, Cityworks, Cartegraph, MGO, or other destination fields, but no vendor representation becomes the canonical answer model.

Legacy `Issue` records remain unchanged. Their combined compatibility descriptions may continue to be edited and displayed as text without reverse parsing. Any future legacy-data migration requires separate design, review, validation, and authorization.

## Interim Stage 5.1 Strategy

A separately approved Stage 5.1 may use a controlled, repository-local static catalog fixture behind a catalog abstraction:

```text
Preloaded catalog fixture
        |
Catalog abstraction/service
        |
React Category and Service discovery
        |
Dynamic question rendering
```

Components should depend on the abstraction so the fixture can later be replaced by a CityVUE API and administrator-managed catalog without redesigning intake. Browser `localStorage` must not become the future authoritative catalog or Admin architecture. Fixture content is illustrative and must not fabricate approved City ownership, routing, policies, or services.

## Conceptual Relationships

```text
Department
   +-- Category[]
           +-- Service[]
                   +-- Question[]
                   +-- RoutingRule[]
                   +-- NotificationRule[]
                   +-- AttachmentPolicy
                   +-- LocationRequirements
                   +-- Version[]

ServiceRequest
   +-- selected ServiceDefinition/version
   +-- Answer[]
   +-- Location
   +-- Attachment[]
   +-- Requester/Contact
   +-- Assignment(s)
   +-- Activity[]
   +-- Watcher[]
   +-- ExternalSystemReference[]
```

These relationships are conceptual and do not establish production classes or persistence schemas.

## Security, Privacy, and Accessibility

- Authorize every Admin operation server-side with least privilege.
- Validate published configuration and every submission server-side.
- Minimize contact and location data and establish retention and records policies.
- Protect unpublished configuration and internal routing metadata.
- Treat configured labels, help text, options, and rules as untrusted content when rendered.
- Make live-search results, conditional changes, errors, progress, review, and attachments keyboard and assistive-technology accessible.
- Provide accessible alternatives to maps, GPS, and upload interactions.
- Log security-relevant and administrative changes without exposing sensitive values unnecessarily.

## Non-Goals

F003 does not implement React behavior, a catalog fixture, an Admin portal, persistence, an API, authentication, attachments, notifications, routing, duplicate detection, vendor integrations, or production domain classes. It does not alter `Issue`, `IssueService`, `cityvueIssues`, Firebase Hosting, F001 sequencing, or F002 concepts.

## Acceptance Criteria

- The Department → Category → Service hierarchy and hidden Department ownership are explicit.
- Resident discovery, live search, dynamic questions, location, attachments, anonymous/contact policy, review, safety, and duplicate-reduction directions are documented.
- Administrator lifecycle, versioning, publication, audit, and routing requirements are documented.
- Presentation, API, catalog ownership, and vendor-adapter responsibilities are separated.
- The Stage 5.1 fixture approach remains temporary and replaceable.
- Current MVP compatibility and prohibited schema changes are explicit.
- No application behavior or production schema changes are included.

## Decisions Required Before Implementation

1. Approved catalog governance, owners, and administrator roles.
2. Canonical identifiers, versioning, publication, rollback, and historical snapshot rules.
3. Catalog API, persistence technology, caching, availability, and environment promotion.
4. Search normalization, ranking, localization, accessibility, and analytics.
5. Dynamic question and conditional-rule contract with cycle and dependency validation.
6. Server-side validation contract and error representation.
7. Location modes, GIS sources, permissions, accuracy, and accessible fallbacks.
8. Attachment storage, malware scanning, file policy, privacy, retention, and authorization.
9. Anonymous eligibility, contact requirements, consent, verification, and notification preferences.
10. Safety-content ownership, approval, review cadence, and emergency escalation language.
11. Duplicate-detection thresholds, privacy, override, and false-match handling.
12. Routing precedence, fallbacks, escalation, destination capability checks, and audit behavior.
13. Stage 5.1 fixture scope and mapping limits for the temporary `Issue` model.
