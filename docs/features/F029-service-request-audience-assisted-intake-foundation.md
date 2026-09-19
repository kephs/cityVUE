# F029 — Service Request Audience & Assisted Intake Foundation

## Domain and boundaries

Reqro is the commercial/platform working name; historical CityVUE identifiers remain unchanged. Display terminology may be white-labelled without changing canonical persisted meanings. F029 adds API/domain intake foundations, not a CRM, staff portal, HR policy, or new citizen identity system.

Audience is explicit persisted state: `public` or `internal` (repository-standard lower-case values for PUBLIC/INTERNAL). PUBLIC means an external/public-facing service request, **not** publicly readable data. INTERNAL means an Organization-internal request. Neither value is inferred from category, department, status, channel, or sign-in. Audience is not sensitivity: a future restricted HR case may require stronger controls than internal facilities work. No sensitivity field or policy is implemented here.

`intake_channel` independently records `web`, `phone`, `walk_in`, `staff`, or `api`. It conveys arrival channel, not visibility. Existing records originated through the resident intake path and are deterministically backfilled to PUBLIC + WEB; no prior channel column exists to preserve.

Requester contact continues to use the existing `reporting_identity` and `requester_contact` name/email model. F029 adds no duplicate contact directory. Public resident submitters have no verified resident identity today; their anonymous/identified reporting choice and existing creation activity remain the available attribution. For staff intake, `submitted_by_staff_identity_id` references the stable existing StaffIdentity. Internal self-service additionally stores `requester_staff_identity_id`, derived from that same staff principal. Assisted public intake leaves that staff requester reference null and preserves the resident contact separately. Staff cannot supply either identity reference.

Examples:

| Intake | Audience | Channel | Submitter | Requester |
| --- | --- | --- | --- | --- |
| Resident web report | public | web | Existing anonymous/identified resident attribution | Existing resident contact, where applicable |
| Staff phone intake | public | phone | Verified, provisioned staff identity | Resident contact |
| Employee self-service | internal | staff | Verified, provisioned staff identity | Same staff identity |

## API and authorization

`POST /api/v1/service-requests` remains resident intake. The DTO has no audience, channel, submitter or Organization authority fields. Global whitelist/forbid validation rejects those fields, including `audience=internal`; the service itself always supplies PUBLIC + WEB from server-owned context. Sending a bearer token to this public route does not turn it into staff intake.

`POST /api/v1/staff/service-requests` uses F018's Entra-only StaffAccessGuard and `service_request.create`. INTERNAL additionally requires `service_request.create_internal`, checked by the application service before persistence. The service also rejects development fallback principals. Both permission keys are added to the catalog/allowlist **without any role or identity grants**. A future separately approved administration workflow must assign them; the F027 geospatial provisioning command is not an intake grant mechanism.

The staff DTO extends the existing form fields with required `audience` and `intakeChannel`. PUBLIC uses existing anonymous/identified requester policy and optional resident contact. INTERNAL is narrowly self-service: `reportingIdentity=identified`, no resident contact object, requester derived from authenticated staff. Creating for another employee is deferred. Existing published service/version, answer, location and eligibility rules remain; no HR/IT/benefit categories are seeded.

Organization is derived from verified StaffAccess, never the body. Catalog lookup, validation, reference allocation, contact, answers, location, request, and append-only activity use the same Organization context. Composite staff foreign keys enforce Organization ownership. Creation activity uses `actor_type=staff` with the existing stable `staff_identity_id`; metadata records audience/channel without copying contact PII. Request creation timestamp remains database-owned. Creation responses retain only ID, reference, status and timestamp.

## Reads, privacy and mutations

All existing canonical request list/count, detail and reference lookup queries explicitly withhold INTERNAL. This includes development reads and the creating staff member: creation permission implies no internal read permission. Existing assignment/workflow paths also refuse INTERNAL. There is no new internal discovery or detail endpoint. A later feature must define least-privilege internal read and mutation policies before these records become available through those surfaces.

PUBLIC retains existing staff/read authorization and projections. The minimal list and creation response do not gain contact, submitter, answers, notes or internal metadata. Authenticated lists now handle empty Department/Division membership arrays without generating invalid SQL: no Departments yields no rows, and no Divisions limits matches to Department-owned requests without a Division. This preserves fail-closed scope. Existing authorized details retain their existing fields; this feature does not make them public. Organization and department/division scope checks remain in place. React hiding is never the confidentiality boundary.

## Migration and operations

`20260919000000-add-request-audience-assisted-intake.ts` adds constrained audience/channel columns, nullable Organization-scoped staff references, and internal self-service consistency checks. Existing rows become public/web with null staff references. Existing indexes already support Organization-filtered reads; no speculative audience index is added.

Rollback locks the dependent request/activity/grant tables before its safety check and refuses if classified/staff-attributed/non-WEB intake, staff creation activity, or dependent permission grants exist. It must not erase classification and make INTERNAL rows readable by old code. Operators must use a separately approved retention/export/removal plan rather than rewriting INTERNAL as PUBLIC to force rollback. With no dependent data/grants, down/up is supported. Apply migrations through the normal migration workflow before running the updated API. Do not roll application code back over INTERNAL data.

No migration is applied to a personal development or production database by this implementation task; validation uses disposable schemas in the separately configured test database. No personal identity receives intake permission.

## UI and deferred work

Resident Report an Issue is unchanged and has no audience selector. There is no appropriate staff creation screen today, so F029 intentionally adds no large new staff portal. A future UI should explain Public / Resident Request versus Internal Staff Request, offer channel/contact fields for assisted public intake, and display server-derived submitter attribution without allowing impersonation.

The next planned intake feature is an administrator-selectable Issue action: continue normal Reqro intake with follow-up questions, or redirect to an approved external URL. That feature is documented only; redirect behavior is not implemented in F029. F028 map-preview, GIS architecture, MapLibre and personal geospatial grant state remain unchanged. ArcGIS remains deferred.

## Validation

Validation passed: backend unit 124/124, E2E 36/36, PostgreSQL 24/24 with zero skips, React 155/155 (including F028), shared 62/62, backend typecheck/lint/format/build and React production build. The final rollback-lock change was additionally verified by the focused F029 PostgreSQL suite (10/10, including its parent test). React retains its existing large-chunk warning. Controlled API validation used disposable local PostgreSQL schemas and real HTTP through Nest; no additional browser UI or live personal-Entra intake session was exercised because this feature adds no staff UI and grants no real intake permissions. Database-backed HTTP tests replace only token signature verification with fictional test principals; they retain the real F018 guard, PostgreSQL permission resolution, creation transaction and read repositories. This is test-only evidence, not live Entra UAT or a runtime bypass.
