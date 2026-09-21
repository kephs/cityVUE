# Reqro — Current Architecture

Reqro is a client-neutral resident-engagement and staff-work platform. This is the current system map through accepted F041; historical CityVUE identifiers remain in code and deployment configuration. The [development protocol](development/REQRO_CODEX_PROTOCOL.md) governs execution, [ADRs](architecture/decisions/README.md) explain durable decisions, [feature records](features/README.md) retain implementation evidence, and the [roadmap](ROADMAP.md) separates future work. Code/tests/database remain authoritative; investigate conflicts before changing behavior.

## Runtime and repository boundaries

```text
React/Vite
  resident intake/catalog       authenticated staff workspace
              \                 /       MSAL workforce identity
               versioned NestJS API     -> verified token + DB authorization
                       |
          domain services / scoped Kysely repositories
                       |
                   PostgreSQL

Separate compatibility boundary: legacy IssueService -> browser localStorage
Separate future boundary: integration router -> approved vendor adapters
```

- [React source](../react/src/) uses React Router, injected repositories, component state and existing theme/auth contexts. API mode is explicitly configured; legacy/demo data remains a separate prototype path. Shared staff list/detail routes are `/staff/requests` and `/staff/requests/:requestId`. Earlier `/issues` and resident intake routes retain their contracts.
- [NestJS server](../server/src/) uses strict TypeScript, versioned REST/OpenAPI controllers, validation, authentication/authorization guards, focused services and Kysely/PostgreSQL repositories. Health/readiness, sanitized errors, request correlation, structured logging and security defaults form the platform foundation.
- [Migrations](../server/migrations/) own canonical schema evolution. The personal development checkpoint has 20 applied migrations; that is evidence in the [F041 report](features/F041-implementation-report.md), not a fixed future invariant. Database tests use disposable infrastructure separate from personal development state.
- [Legacy entry point](../index.html) and Parcel build remain compatibility/rollback assets. Browser Issue records are not canonical ServiceRequests and are not automatically migrated. Legacy dashboard/home metrics are not proof of Organization-wide operational analytics.
- Firebase configuration hosts static frontend output; it is not canonical persistence or workforce authentication. Backend Azure hosting is a planned target, not a deployment established by local feature work.

## Canonical domain and catalog

Organization is the tenant/ownership boundary. It owns Departments, optional Divisions, catalog configuration, staff identities and requests. A Category belongs to a Department, optionally through a Division in that Department. Composite Organization-aware relationships and scoped queries prevent cross-Organization ownership. There is no claim of database row-level security or an implemented shared-SaaS administration plane. See [Organization isolation](architecture/decisions/ADR-001-organization-isolation.md).

Stable ServiceDefinitions and immutable published versions supply service-specific questions, typed Answer snapshots, location policy and intake configuration. Historical answers stay tied to the submitted version; do not reconstruct them from a flattened description. F032 adds an Issue action choice: platform intake or validated external redirect. Its `internal_intake` action means intake inside the platform, not INTERNAL audience. Action administration requires `catalog.issue_action.manage`; a full production catalog administration workspace remains future work.

ServiceRequest has a UUID identity plus a persisted immutable human reference. F033 replaces the earlier global fixed-width allocation with Organization-scoped configuration and atomic bigint counters. The default format remains familiar, but formatting is configurable and minimum width is not a fixed maximum. Allocation and creation are transactional; uniqueness and collision checks are Organization-scoped. Readers use stored references as opaque identifiers. See [F033](features/F033-configurable-service-request-reference-numbers.md).

## Identity, authorization and audience

Optional Microsoft Entra workforce identity uses MSAL and delegated API tokens. Server validation establishes the trusted identity pair; active pre-provisioned StaffIdentity and database roles, permission grants and Department/Division scope establish authorization. Sign-in is not provisioning. Development/client profiles require deliberate opt-in for personally controlled external identity and do not authorize City/client resources. Resident identity remains a separate, unresolved production concern.

PUBLIC/INTERNAL is persisted request classification. WEB, PHONE, WALK_IN, STAFF and API are separate intake-channel values; later authorization does not infer audience from channel. Resident creation uses PUBLIC/WEB. Staff-assisted creation requires explicit intake permissions, with an additional INTERNAL-create permission where applicable. INTERNAL self-service intake does not collect structured resident contact. See [audience decision](architecture/decisions/ADR-002-service-request-audience.md).

The unified staff workspace uses a single database relation constrained by trusted Organization, effective current routing scope and each independently authorized audience. All combines authorized PUBLIC and authorized INTERNAL before filtering, counting and pagination. Audience, status, exact reference, Department/Division and operational-view filters only narrow that relation. Ordering is createdAt descending with UUID tie-breaker; pages default to 25, maximum 100. React does not join separately paginated audience lists.

PUBLIC read requires `service_request.view`; INTERNAL read requires `service_request.internal.read`. Unified operations additionally require PUBLIC action-specific keys or `service_request.internal.update`. There is no generic PUBLIC update permission. Server capabilities guide controls without replacing endpoint checks. Named legacy APIs preserve audience-specific contracts, including earlier INTERNAL workflow/routing update admission. See the exact [authorization matrix and compatibility decision](architecture/decisions/ADR-006-public-internal-staff-authorization.md).

F036 is development-only explicit provisioning, with target/profile/identity/scope guards, dry run, additive idempotent apply and targeted deprovisioning. `FULL_UAT_OPERATOR` is shorthand for an explicit permission list; runtime never authorizes by bundle name. Bundle changes and migrations grant nothing automatically. The [runbook](features/F036-safe-development-staff-authorization-provisioning.md) and later feature addenda document accepted expansions.

## Operations, relationships and concurrency

Shared lifecycle services implement Start Work, Hold, Resume, Close and Reopen with explicit transitions and required narratives. Canonical requests have no arbitrary status editor. Routing changes Department/Division independently from ownership and checks current/target scope. Revision checks, locking, transactions and required history/audit writes protect mutations; stale commands require authoritative reload.

F037 assignment has one current owner: STAFF, operational ROLE or GROUP (presented as Team), with constrained eligible targets. Routing retains eligible assignment or appends unassignment in the same revision when necessary. Watchers are independent STAFF/ROLE/GROUP relationships. Self-watch requires normal request read; management of others requires the audience's operational permission. My Requests, My Team and Watching add relationship filters only after request authorization. Membership is not RBAC. See [ownership decision](architecture/decisions/ADR-004-assignment-watchers.md).

## Separate information streams

| Domain                             | Purpose and access boundary                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| Description and structured Answers | Original problem/intake information within authorized request projection                    |
| Service location                   | Operational location governed by request/location policy; distinct from requester contact   |
| Requester Contact                  | Structured name/email through dedicated parent-read + contact-read authorization            |
| Operational Activity               | Staff-safe append-only creation, lifecycle, routing and ownership history                   |
| Security audit                     | Minimal trusted actor/action/resource/time/correlation metadata; not staff timeline content |
| Internal Notes                     | Dedicated staff-only, permission-protected free-text collaboration on either audience       |
| Resident communication             | Future domain; not supplied by Activity or Notes                                            |

F035 Activity stores historical snapshots and approved plain-text narratives in `request_operational_activity`. UPDATE, DELETE and TRUNCATE protections enforce append-only history. Revision/event ordering accommodates multiple events in one atomic operation, such as route plus unassign. Activity remains separately paginated and never contains contact-view audit or Notes. See [Activity decision](architecture/decisions/ADR-003-operational-activity-history.md).

F039 requires independently authorized parent access and `service_request.contact.read`. A scoped transactional fetch persists metadata-only contact-view security audit before disclosure; audit failure fails closed. Ordinary list/detail omit structured contact. The domain supports name/email, not phone. Contact renders as plain text, uses no-store responses and component memory, and clears on navigation/auth changes or subsequent denied fetch. See [contact decision](architecture/decisions/ADR-005-requester-contact-privacy.md).

F041 Notes use shared GET/POST `/api/v1/staff/service-requests/:requestId/notes`. Parent access plus `service_request.note.read` permits retrieval; creation additionally requires `service_request.note.create`. An immutable author display snapshot avoids identity-provider lookup. Plain-text admission is bounded to 4,000 UTF-16 units. Database append-only protections, scoped idempotency keys, atomic metadata-only creation audit and keyset pagination protect the independent stream. Notes do not alter parent revision, updatedAt, Activity, assignment, watchers or contact. See [Notes decision](architecture/decisions/ADR-007-internal-notes.md).

Protected Contact/Notes are neither resident data nor AI inputs by implication. Their bodies stay out of ordinary logs, URLs, titles and persistent browser storage. Structured-contact protection is not a guarantee that free text contains no PII. No automatic redaction exists.

## Resident and location boundaries

The resident-facing creation response retains its minimal receipt, not staff detail. No general resident history GET was added by F040/F041. Earlier canonical GET APIs are authenticated/gated staff contracts, not evidence of anonymous resident visibility. Staff assignment, watchers, operational narratives, Activity and Notes do not flow into the resident receipt. Production resident identity, access, tracking and communication require separate design.

F015 evaluates configured geographic eligibility through a provider-neutral server boundary before creation writes; unrestricted policies avoid a provider call. Accepted requests persist an eligibility snapshot. Restrictive policies fail safely on ineligible, indeterminate, timeout or unavailable-provider results. Only the controlled development provider is implemented; authoritative client GIS layers, overrides and production routing are not implied.

F023–F028 add a separate MapLibre presentation and protected geospatial read path. Synthetic neutral GeoJSON and local map styling support development without live tile/geocoding resources. Trusted Organization and `geospatial.read` gate protected API access. Preview geometry is not canonical creation eligibility. Live providers, geographic routing and production spatial persistence remain separately reviewed work.

## UI, AI and administration boundaries

F038 shared tokens/primitives establish Issue-first hierarchy, secondary reference, meaningful location, distinct audience/status text, light/dark surfaces and responsive wrapping. Brand colors remain separate from semantic status/Activity colors. Unified detail composes Contact, Assignment, Watchers, Notes, Issue Details, Actions and Activity without merging privacy domains. Request/auth changes clear protected state and discard stale responses. Accessibility-oriented tests and manual UAT are evidence, not WCAG certification.

F020/F021 supply provider-neutral staff AI authorization and metadata-governance foundations. Provider registries do not establish an enabled live generation provider. Stakeholder/admin previews are not production configuration or permissions administration. Notes are not automatically supplied to model context. Existing [AI gateway](decisions/ADR-001-provider-neutral-staff-ai-gateway.md) and [AI governance](decisions/ADR-002-ai-governance-metadata.md) decisions remain in force.

## Future integration and deployment architecture

The approved direction is an API-owned integration router with vendor adapters for supported capabilities such as create, status retrieval, update and attachments. No VUEWorks, Cityworks, Cartegraph, MGO or VistaShare adapter is implemented. Vendor schemas, credentials and status mappings belong inside adapters. External references must remain separate from request UUID/reference and be scoped by Organization/adapter context.

An adapter must explicitly state supported capabilities; vendors need not support identical operations. Future asynchronous delivery needs approved idempotency/deduplication, bounded retry, recovery, audit and source-of-truth/conflict rules. External delivery status must not silently overwrite canonical business lifecycle. Switching vendors should change mappings/adapters, not the resident domain.

F008/F016 describe Azure Container Apps/API-workers, managed PostgreSQL, private Blob Storage, Key Vault/managed identity and monitoring as a target requiring separate authorization. Initial client deployment direction remains an isolated environment/database/storage/identity/integration boundary per municipality, with portability to other approved hosting. Shared multi-Organization SaaS needs its own isolation and operating-model decision. Containers and local profiles are not evidence of deployed cloud infrastructure.

Production identity activation, resident-safe history/communication, notifications, attachments, administration, retention/redaction, integration reliability and production-volume performance remain reviewed future work. See [Roadmap](ROADMAP.md); F042 has not been selected or started.
