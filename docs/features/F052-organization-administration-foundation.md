# F052 — Organization Administration & Configuration Foundation

Status: implemented and validated; local checkpoint prepared for review. Starting checkpoint: synchronized `main` at `4deeb9d3ad99fa9c4d67563cd0dfb9baa1050b9e`, clean, 0 ahead / 0 behind. Personal development baseline verified read-only: 28 applied migrations / 0 pending, 13 requests, three active fictional Participation Areas, collection enabled, tracking 1 active / 5 revoked, and no Admin permission definition. No push, deployment or F053 is authorized.

Completed test, migration and live UAT evidence are recorded in the [implementation report](F052-implementation-report.md).

## Scope and authorization

F052 establishes a **read-only administration foundation**, not a complete production Admin Portal. The new explicit `admin.configuration.read` permission fits the existing dotted permission taxonomy. It has zero migration/default grants and is excluded from every broad development bundle. F036's explicit permission allowlist supports narrow personal-development provisioning only after user-confirmed authenticated pre-grant 403. No write permission is registered.

`GET /api/v1/admin/configuration` requires Entra validation, active trusted staff/Organization resolution, and the Admin permission. Service-level identity/permission checks supplement the route guard. No development fallback principal, global Admin boolean or Organization switch exists. Only bounded `issuePage` and `areaPage` queries are accepted; arbitrary Organization queries are rejected without configuration disclosure. No F052 POST/PUT/PATCH/DELETE configuration route exists.

Administration is not an authorization bypass into operational data. Request read, Contact, Notes, Communication, attachments, tracking management, requester history, assignment, geospatial and participation analytics each retain their independent authorization. None confers Admin read, and Admin read confers none of them. A safe default-assignee display does not confer access to that person's request scope or provider identity.

## Authoritative views

| Route                  | Content                                                                                                                           | Backend source                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `/admin`               | Configuration counts and health only                                                                                              | Authorized configuration snapshot           |
| `/admin/issues`        | Issue/category, catalog availability, published version, effective requester policy, default assignment and independent revisions | Catalog, F049 policy and F048 configuration |
| `/admin/intake`        | Participation collection enabled/disabled and collection revision                                                                 | Organization collection resource            |
| `/admin/participation` | Area display name, active state, display order and individual revision                                                            | Organization-scoped Participation Areas     |
| `/admin/privacy`       | Deployment-owned suppression threshold and privacy/access explanation                                                             | Validated server deployment configuration   |
| `/admin/status`        | Deterministic OK/WARNING diagnostics                                                                                              | Same snapshot's configuration evaluation    |

All use the same permission and GET API. Issue and area lists are independently paginated at 25 rows with stable ordering. Counts describe configuration resources only. No request metrics, requester counts, requester records, Contact, provider subjects, credentials/digests, attachment paths, location/geometry or suppressed analytics values are retrieved or projected. Area IDs identify independently versioned configuration resources in the API; technical IDs are not displayed in the UI. Assignment target IDs and identity-provider identifiers are not projected. Staff display names reuse F037's safe-name projection.

`/admin-preview` remains a separate explicitly marked demonstration surface, with no authoritative API access. F052 does not import its fixtures, demo metrics or client-specific branding. The real shell uses existing theme tokens, one section navigation, a return-to-staff link, responsive cards, clear loading/denied/error/empty states and Refresh. No pretend edit controls or browser configuration overrides exist. Data stays in component memory and clears on refresh/client changes/denial; cancelled responses cannot repopulate another authentication context.

## Approved resource revisions

The user approved resource-level revisions on 2026-09-23. There is no global Organization configuration revision. Existing Issue action, F048 default-assignment and F049 identity-policy revisions remain unchanged and are projected separately. Published catalog versions retain their existing immutable version concept; the action revision is not presented as a version for the entire Issue/catalog.

The new migration adds `organization.participation_collection_revision` and `participation_area.revision`, each initialized to 1 without inferring historical change counts. Database triggers advance only the changed resource for meaningful collection or area name/active/order changes. Reads, dry runs, identical assignments and unrelated resource updates do not increment it. Area ownership/id cannot be reassigned. Repeated F051 provisioning is idempotent. The collection CLI uses an internal provisioning helper and reports its resource revision; its existing target/profile/opt-in guards remain intact. Existing area creation uses default revision 1 and conflict-do-nothing behavior.

Future write contract: authorize the resource operation; submit expected revision; validate; conditionally update the Organization-scoped resource at that revision; advance revision and append required safe audit atomically. A failed comparison returns **409 Conflict**, never silent overwrite. Area A at revision 4 can advance to 5 while a stale expected 4 fails; changes to Area B or an Issue do not stale Area A. F052 exposes no write endpoint implementing this future HTTP contract; disposable tests validate the underlying compare/update behavior.

The database portion is read in one repeatable-read, read-only transaction. It is a coherent snapshot containing multiple independently versioned resources, not a globally versioned object. Deployment privacy configuration is captured from validated process configuration, has no invented Admin revision and is not part of a database transaction. Different API replicas must receive consistent approved deployment policy operationally; F052 does not create deployment policy management.

## Configuration health

Collection disabled is OK, including with no areas. Enabled with active areas is OK; enabled without active areas is WARNING and explains that intake does not collect geography until an area is available. Available Issues use F049's effective policy, including its existing safe legacy fallback. No default assignment is valid; configured but inactive/ineligible targets show “Configured target unavailable” and WARNING. Target eligibility follows F037/F048 for either supported audience, using a set-based query rather than per-Issue round trips. Invalid privacy threshold is rejected by existing startup validation and defended by the read service; no invalid value is represented as healthy.

Diagnostics never repair, activate, provision or mutate anything. They are not infrastructure monitoring, vulnerability scanning or certification. Health summaries cover all Organization configuration, including beyond the current page; Issue details remain paginated.

## Audit foundation and privacy

Existing resource-specific append-only configuration audits (F048/F049) are retained. F052 defines the typed future mutation metadata contract: trusted Organization/actor, correlation ID, action, resource type and safe resource identifier, prior/new revision, changed-field allowlist and timestamp. No arbitrary before/after payload, provider subject, credential or secret belongs in it. A future write feature must implement resource-specific immutable persistence and atomic failure behavior before exposing writes; the contract alone is not a working mutation audit store.

Harmless read-only configuration GETs do not append security or operational mutation events. Existing allowlisted HTTP logging records safe operational metadata; it must omit full snapshots and protected values. No audit read/edit/delete UI or extra audit permission is introduced. Live logging UAT must cover both denial and success; user confirmation is required before commit.

## Migration, performance and validation gates

Migration: `20260929000000-add-admin-configuration-foundation`. Permission definition only, zero grants; independent revision columns/triggers only. No historical requests, geography, areas, collection choice or existing resource revisions change. Unused rollback/reapply is tested; retained new revisions or Admin grants prevent rollback. Personal development migration is applied only after disposable validation.

The service executes four data queries per snapshot (Organization, configuration totals/health, Issue page, area page), plus transaction setup and existing authentication/authorization queries. Health is set-based and no per-Issue application query exists. Existing Organization/composite keys and area ordering indexes are reused. Health/count work scales with configuration volume; there is no production-scale performance claim or unbounded request scan.

Required validation includes backend unit, API E2E, PostgreSQL with zero skips, shared, React, TypeScript, lint where configured, formatting, builds, whitespace, links and private-value review. Focused cases cover 401/403/200, no default grants, isolation/forgery, permission independence, safe projections, health variants, migration preservation, resource independence/no-op revisions, stale comparisons, read consistency and log sanitation. Browser UAT covers all six views at 1440/1280/1024/768/390, both themes, keyboard/focus, Refresh, return navigation and before/after integrity.

Live sequence: developer-launched API outside sandbox; user-confirmed pre-grant 403; dry-run and narrowly provision only Admin read; post-grant 200; view/refresh/navigation UAT; user-confirmed log privacy; compare existing configuration/request/private-file hashes and safe tracking metadata. No persistent broken fixture or new request is needed. Preserve SR-202609-000013 and existing analytics grant/scopes. Physically remove temporary artifacts before a separate local commit.

## Threat model and deferred scope

Explicit permissions and server guards address operational/Admin confusion and frontend-only authorization. Trusted Organization predicates, strict query allowlists and safe denials address scope substitution and enumeration. Explicit projections and log allowlists address secrets, requester data, tracking and snapshot leakage. Resource-local revisions, database enforcement across CLI writes and the future 409 contract address divergence and lost updates; future writers must still implement authorization/validation/audit. Preview separation prevents demo data becoming authority. Health reveals only authorized configuration diagnostics. Offset pages are fresh snapshots per request, not a durable multi-page transaction.

Production prerequisites remain approved administrator governance/provisioning, configuration ownership, audit retention, write authorization and concurrency enforcement, change control, production area/privacy/Issue governance and security review. Configuration writes, area CRUD, grants/users, Entra, Requester merge/directory, secrets, database/deployment administration, audit editing, impersonation, imports/exports, operational/analytics dashboards and cross-Organization administration are deferred. F053 is unstarted.

## F055 management follow-up

[F055](F055-admin-participation-area-management.md) extends only Participation Areas with independent read-plus-area-write authorization. The existing per-area revisions and paginated read projection remain; numeric order changes check the affected area revision without introducing a global revision. The snapshot adds an independently derived canWriteParticipationAreas capability.
