# F030 — Internal Service Request Access Policy

## Purpose and threat model

F030 adds read-only access to F029 INTERNAL requests. **INTERNAL does not mean "visible to all employees."** Access requires explicit authorization within the trusted Organization. Creation and read authorization are intentionally separate; being the requester or submitter grants no read access.

Threats include anonymous discovery, ordinary staff or creator privilege escalation, guessed IDs, forged Organization/identity/audience inputs, cross-Organization reads, stale grants, count/pagination leakage, and accidental contact exposure. Only local fictional data was used. No client systems or remote resources are required or modified.

## Permission and scope

The existing Entra-only StaffAccessGuard verifies identity and delegated scope, then resolves active PostgreSQL staff identity, role assignments, roles and membership on each request. The new catalog/allowlist key is `service_request.internal.read`, following the existing singular `service_request` namespace. No roles, memberships or grants are created by the migration or seed. `service_request.create_internal` and `service_request.view` do not imply this permission. Conversely, internal.read does not imply the existing PUBLIC/contact read permission.

Organization comes solely from guard-resolved StaffAccess, never route, query, body or arbitrary headers. The dedicated repository rejects missing/malformed Organization or staff identity, missing verified identity, development fallback and missing permission before querying. SQL requires the trusted Organization, active Organization status, INTERNAL audience, Department membership and applicable Division membership. Empty Department scope returns no records; empty Division scope admits only Department-level requests. Revocation takes effect on the next request through the existing database authorization resolver.

## API behavior

- `GET /api/v1/staff/internal-service-requests`: paginated INTERNAL-only collection, default page 1 / pageSize 25, maximum pageSize 100. Stable newest-first ordering with ID tie-break. Returns items, total, page, pageSize, hasPreviousPage and hasNextPage. Count and rows share the same authorization constraints.
- `GET /api/v1/staff/internal-service-requests/:serviceRequestId`: minimal INTERNAL detail. Invalid, missing, PUBLIC, inactive-Organization, out-of-membership and other-Organization records return 404 without revealing existence.
- Both require Entra identity and internal.read. Missing/invalid authentication returns 401; unprovisioned or insufficiently permitted identities return 403. The development fallback cannot enter these routes. Successful responses have `Cache-Control: no-store`.
- List query supports only page/pageSize (page bounded to 1,000,000); unknown query fields including Organization, audience and identity are rejected. Detail accepts the same validated query shape but ignores pagination. Headers and GET bodies cannot alter authorization. No mutation endpoints are added.

Items contain serviceRequestId, referenceNumber, audience, status, priority, createdAt, updatedAt, issueName, categoryId, departmentId and divisionId. Detail adds description. These are new API projections; existing React screens are not connected to them.

## Repository enforcement and PUBLIC compatibility

`InternalRequestRepository` is a dedicated authorization-aware query boundary. Both list/count and detail apply Organization, audience and membership predicates in SQL before returning records. No load-all/in-memory audience filtering is used. The existing `ServiceRequestRepository` remains unchanged and PUBLIC-only for list/count, detail and reference lookup. Existing resident intake, staff-assisted intake, PUBLIC read projections and internal mutation denial remain unchanged. A dedicated endpoint avoids broadening existing staff/development routes or accidentally mixing INTERNAL into existing clients.

## PII separation

No contact permission exists in the current permission catalog; existing authorized PUBLIC detail access includes its established contact projection. F030 leaves that policy unchanged. Internal reads never join requester_contact, staff identities, answers, locations, assignments or activity, and never return requester/submitter identity. Even an imported contact row attached to an INTERNAL request is omitted. Assisted PUBLIC resident/contact information remains separate from staff submitter attribution.

Description is authorized request content and may contain user-entered personal information; this feature does not classify or redact free text. Structured contact, answer, location, activity, attachment and employee-directory visibility need separately approved field-level policies before inclusion.

## Migration and configuration

`20260919010000-add-internal-request-read-permission.ts` adds only the permission catalog row; no business schema changes, indexes or automatic grants. The existing foreign key refuses permission rollback while dependent role grants exist. Ungranted down/up is supported. Apply through the normal migration workflow before separately authorized provisioning. This task applies migrations only to disposable test schemas, not the personal development application database. No personal identity was granted access. No new environment variables, packages, cloud configuration or UI are introduced.

## Validation

Automated coverage uses real Nest HTTP, StaffAccessGuard, PostgreSQL permission resolution and repository queries, replacing only token verification with fictional principals in the existing F029 database harness. F029 assertions are retained. Added tests cover anonymous/invalid/unprovisioned callers, ordinary staff and creator denial, no default grant, permission rollback, authorized list/count/detail, mixed Organization datasets, PUBLIC exclusion/compatibility, independent PUBLIC permission denial, imported contact omission, forged query/header/body scope, pagination, Department/Division restrictions, inactive Organization, grant revocation and Entra-only admission. Unit tests cover absent/malformed trusted context, development fallback and creation permission without read permission. Final validation passed: backend unit 125/125, API E2E 36/36, PostgreSQL integration 30/30 with zero skips, shared 62/62, React 155/155, backend TypeScript/lint/format/build and React production build. React retains the existing large-chunk warning. The initial DB invocation without TEST_DATABASE_URL skipped all tests; the final configured run above executed all database tests. New synthetic fixture setup errors were corrected without weakening existing assertions. No live personal-Entra UAT or personal grant was needed for this API-only implementation.

## Deferred capabilities

Internal editing, assignment, workflow/status mutation, comments, attachments, administrative UI, permission management UI, automatic grants, resident access, richer detail fields, sensitivity/HR policies and creator shortcuts are not implemented. Production activation and live Entra UAT remain separate work. No push or deployment is part of F030.

## Pre-commit security review

- Residents, ordinary staff, and creators without explicit internal.read cannot retrieve INTERNAL data.
- Cross-Organization detail and collection reads fail closed; forged Organization identifiers do not change scope. Both Organizations have real synthetic INTERNAL rows in the tests.
- Department/Division scopes and active Organization status constrain both rows and counts. Missing authorization context is rejected; revoked role assignments deny the next request.
- internal.read never unlocks PUBLIC/contact reads or adds contact fields to its own response. Generic repositories remain PUBLIC-only.
- Existing PUBLIC behavior and F029 creation/assisted-intake tests remain unchanged. Internal assignment/workflow remains denied.
- The permission migration and application allowlist grant nothing by default; no seed, personal identity, remote resource or production configuration was changed.
