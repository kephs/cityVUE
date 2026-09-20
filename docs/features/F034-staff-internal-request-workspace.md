# F034 — Staff Internal Request Workspace

Implemented locally from F033 (`beca29f867a78f8275ed17fe386b0d79e07b72e6`). Live authenticated staff browser UAT remains pending. No deployment is authorized by this feature.

## Purpose and boundaries

Provide an operational workspace for explicitly authorized staff to find, read, start/resume, and route INTERNAL Service Requests. PUBLIC operations, resident contact access, administration, branding migration, and F035 are outside this feature.

THE FRONTEND DOES NOT ESTABLISH AUTHORIZATION.

HIDING A BUTTON IS NOT A SECURITY CONTROL.

SERVICE REQUEST REFERENCES ARE DISPLAY IDENTIFIERS, NOT ACCESS TOKENS.

## Routes and authentication

`/staff/requests` opens the list; `/staff/requests/:requestId` independently loads authoritative detail. The existing AuthRoot, MSAL context, StaffRouteGuard with `requireEntra`, shared API client, and server StaffAccessGuard are reused. No fallback workforce identity or new authentication implementation is introduced. The primary navigation adds Service Requests for signed-in workforce users; unauthorized signed-in users still receive an API denial.

The server requires Entra identity and `service_request.internal.read` on list, detail, and workspace options. Existing F030 trusted Organization, active Organization, effective department/division membership, and INTERNAL audience restrictions remain authoritative. Creator status and UUID/reference possession grant nothing. F031 independently requires `service_request.internal.update` and rechecks current and target scope on every mutation. No permissions, default grants, or development grants are added.

Account changes remount the workspace. Sign-out removes it. Detail routes are keyed by UUID, preventing a previous record from appearing under a new route. In-flight reads are aborted/ignored when routes, filters, or components change. A 401 clears failed content and offers the existing sign-in action; 403/404 show safe generic states. No permission polling or protected persistent cache is introduced.

## API and data projection

The existing `/api/v1/staff/internal-service-requests` GET supports optional `search`, `status`, `departmentId`, and `divisionId`, in addition to existing `page` and `pageSize`. DTO validation rejects unknown parameters, unsupported statuses/sort, malformed UUIDs, search over 100 characters, noninteger/out-of-range pagination, and forged Organization parameters. Filters only narrow the server-authorized query.

Search matches a **complete reference**, trimming whitespace and canonicalizing query case to uppercase for F033 references. It does not parse reference components, search descriptions/contacts, or perform global lookup. Equal references in different Organizations remain isolated. Exact equality uses the existing `(organization_id, reference_number)` unique index; Issue-name substring search and date filters are deferred. Ordering remains `created_at DESC, id DESC`, with no browser-provided SQL ordering.

The UI requests 25 rows. The existing API permits integer page sizes 1–100 and pages 1–1,000,000. Count and items apply the same authorization/filter predicates; count reveals only authorized matches. Existing offset pagination is retained. Under concurrent writes, separate count/item queries can briefly differ; this is not a snapshot feed. Large-offset optimization and production-volume benchmarking remain future work.

List projection preserves F030 fields: serviceRequestId, referenceNumber, audience, status, priority, createdAt, updatedAt, issueName, categoryId, departmentId, divisionId. It adds readable departmentName/divisionName using Organization-constrained joins, without N+1 reads. Detail additionally exposes the existing description and revision. The client explicitly projects only fields used by its UI. List responses contain no description or contacts; detail adds no contact, requester profile, actor, or PII columns. Intake-channel metadata is not newly exposed.

New GET `.../workspace-options` returns `{canUpdate, departments: [{id,name}], divisions: [{id,name,departmentId}]}` from the guarded staff access and active Organization hierarchy. Department/division choices are limited to established memberships. `canUpdate` derives from the separate server-resolved update permission; it is a presentation hint, never mutation authority. Routing uses these choices, not hard-coded or free-text IDs. All protected GET responses use `Cache-Control: no-store`.

## Workflow, routing, and concurrency

Start Work is available for Open; Resume Work for On Hold. Cancelled has no workflow controls. The user explicitly approved **deferring Hold, Close, and Reopen UI actions**, because F031 validates their reason/resolution text without saving it. The workspace explains this limitation and collects no unsaved narrative. Existing F031 endpoints and lifecycle rules are unchanged. Durable narrative storage and these three controls need a separate feature.

Routing UI is implemented safely using the trusted workspace-options endpoint. It supports department-level or authorized division routing, disables unchanged/empty choices, and sends the current revision. Read-only staff see an explanation and no mutation controls. The UI conservatively omits routing for cancelled requests; this does not alter the API contract.

Mutations send expectedRevision, disable controls while pending, and use an in-flight guard against rapid duplicate clicks. There is no optimistic status change. On success, authoritative detail and options are refetched; returning to the list fetches current data. A 409 reloads current detail and asks the user to review it, without silently replaying the command. Other failures clear the stale detail and show sanitized recovery text. F031 transactional authorization, routing validation, audit behavior, and revision checks remain unchanged.

## Presentation and accessibility

References are opaque, prominent strings, including `SR-202609-000002`, `REQ-2026-000123`, `CASE-00000001`, `311-2026-00000001`, and longer values. No substring assumptions or fixed-format date extraction are used. Status badges include readable words. Description is escaped React text with preserved line breaks; long descriptions expose a native disclosure after a 1,200-character preview. There is no HTML injection, automatic link conversion, payload logging, description in title/URL, or analytics integration.

The list uses a semantic table with reference links, becoming stacked rows on small screens. Forms have labels, actions use native buttons, feedback uses status/alert regions, routing uses a fieldset/legend, and focus moves to loaded detail and routing controls. Cancelling routing restores its trigger focus. Buttons have a minimum 44px height and visible keyboard outlines. Bootstrap theme variables support light/dark themes; existing application branding and typography remain intact.

Explicit Apply filters avoids per-keystroke API traffic. Reset clears filters. Non-sensitive filter/page state is stored in query parameters and retained across detail/back navigation. Protected narrative is never placed in route state or URLs. Direct routes do not depend on an earlier list visit. Document title is the generic `Service Requests | CityVUE`; timestamps use local `toLocaleString()` presentation only, with no effect on authorization or server time semantics.

## Database and development resources

**No F034 database migration required.** Existing Organization/date/status and F033 Organization/reference indexes support the bounded queries. Personal `localhost / reqro_dev / reqro_dev_user` migration status was checked read-only: all 15 migrations through `20260919040000-configure-request-references` are applied, none pending. `SR-202609-000001` and `SR-202609-000002` remain PUBLIC/WEB with unchanged references. No personal synthetic INTERNAL records were created, existing history was not edited, and no grants were provisioned. Integration fixtures exist only in isolated test schemas.

## Validation and UAT

Backend unit tests: 166 passed. API E2E: 36 passed. PostgreSQL: 52 passed, zero skips. Shared tests: 62 passed. React: 195 passed. TypeScript, backend ESLint, server formatting, focused new React formatting, backend production build, and frontend production build pass. The repository has no separate React TypeScript or ESLint pipeline; its established Vite/Vitest checks were used. Existing Vite large-chunk warnings remain unsuppressed.

Database coverage includes scoped filters/counts, stable pagination, malformed/forged queries, no PII list projection, trusted hierarchy/capability metadata, same visible reference across Organizations, revocation, and retained F029–F033 security/regression suites. React covers list/detail loading/errors/empty states, query state, variable references, XSS text, read-only controls, approved lifecycle subset, authoritative mutation refresh, revision conflicts, duplicate clicks, routing failures, session expiry/sign-out, and clearing detail on UUID changes.

Actual local staff list and direct detail URLs display the established sign-in boundary without exposing request data. Authenticated staff workspace UAT is **pending due to absence of safe development grant provisioning** for internal read/update. The existing geospatial provisioning mechanism is not repurposed. No live staff permissions were available to exercise these operations, and no authentication bypass was added.

A temporary, explicitly labeled synthetic browser preview imported the real workspace component with an in-memory fixture repository, making no API/database/authentication calls. It was removed before commit. Desktop (1280px), 1024px, 768px, and 390px layout checks found no horizontal page overflow. Light/dark rendering, mobile list/detail/routing, filtering/reset/empty state, keyboard activation, routing focus/return focus, and status feedback were inspected. This is component browser validation, **not authenticated end-to-end acceptance**. Automated tests cover authorized/unauthorized server operations and unavailable live states. Semantic and keyboard checks do not constitute WCAG certification or full assistive-technology testing.

## Security review and deferred work

F029 audience/channel and trusted creation rules, F030 INTERNAL isolation, F031 read/update separation and concurrency, F032 external-redirect rejection, and F033 reference generation/immutability remain covered and unchanged. Filters, search, pagination, and target discovery never broaden Organization/scope authority. No open PII surface, raw SQL sort, unsafe HTML, protected console logging, default grant, auth shortcut, or public INTERNAL endpoint was introduced.

Deferred: authenticated live UAT; Hold/Close/Reopen and durable narratives; production-scale query benchmarking; Issue-name/date search and additional sorting; PUBLIC workspace; contact reveal; notes/activity/files; individual assignment; notifications; real-time updates; bulk/export/reporting; administrative portals and permission provisioning. No GIS/vendor integrations, remote/cloud/client resources, final Reqro branding assets, or F035 work were changed.
