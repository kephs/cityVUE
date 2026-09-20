# F032 — Issue Action & External Redirect Foundation

## Identity, history and scope

Reqro is the commercial/platform working name; historical CityVUE names, packages, environment keys and deployments are unchanged. Earlier planning called this Issue Action feature F030; F030 and F031 were subsequently used for Internal Service Request Access Policy and Internal Service Request Lifecycle & Mutations. This implementation is F032; Git history is not rewritten.

A catalog Issue is the existing `service_definition`, with published version data and follow-up questions in `service_definition_version` / `question` / `question_option`. It is not the legacy browser Issue record and is not a new parallel catalog model. Some services should hand users to another website rather than produce a ServiceRequest. External handoff is neither local submission nor evidence of successful external submission.

## Action model and migration

`service_definition.action_type` explicitly stores `internal_intake` or `external_redirect`. Existing definitions default/backfill to internal_intake, with null redirect fields and action_revision=1. Behavior is never inferred from URL presence. **INTERNAL_INTAKE is not INTERNAL request audience**: ordinary intake still creates PUBLIC or INTERNAL requests according to the existing authorized F029 path.

The action belongs to the stable definition rather than an immutable published version so changes govern even submissions referencing older versions. Published questions remain immutable and untouched. External mode suppresses loading/execution/projection of follow-up questions; switching back exposes the same questions again without recreation. The action applies across current/future published versions.

The F032 migration adds action_type, redirect_url (2048), redirect_message (500), redirect_label (80) and action_revision. Database constraints allow only known actions and consistent field combinations; existing Organization relationships remain intact. INTERNAL_INTAKE clears redirect configuration explicitly when configured. Questions are never deleted. Rollback locks relevant tables and refuses any configured/revised action or dependent permission grant, including a definition switched back to intake. It never silently discards meaningful configuration. Untouched down/up is tested.

## Administration and scope

No functioning Issue configuration UI exists: `/admin-preview` is explicitly a demo. F032 therefore adds protected API configuration without promoting the demo or building an admin portal.

- `GET /api/v1/staff/catalog/issues/:id/action`: scoped configuration plus revision.
- `POST /api/v1/staff/catalog/issues/:id/action`: explicit `{ actionType, expectedRevision, destination?, message?, label? }`; no generic PATCH.

Both use existing Entra-only StaffAccessGuard with the new narrow `catalog.issue_action.manage` permission. No default/seed/personal grants are created. F029 creation and F030/F031 request read/update permissions confer no catalog authority. Trusted Organization, active Organization and Department/Division membership constrain reads and the atomic UPDATE. Empty Department scope denies access. IDs alone, body Organization, isAdmin/role/approval flags and arbitrary fields cannot establish authority. Optimistic action_revision prevents silent configuration overwrites; stale revisions return 409 and unavailable/out-of-scope definitions return 404. Development fallback is denied. Successful responses use no-store.

External mode requires a valid destination. Optional blank/missing copy uses neutral defaults: “This service is handled through another online service.” and “Continue to External Service”. Text is bounded and rendered as text, not HTML. INTERNAL_INTAKE rejects non-null redirect fields, preventing ambiguous configurations.

## URL policy and no-open-redirect boundary

The server uses the URL parser plus strict lexical checks. Only absolute HTTPS URLs are accepted. HTTP has no development exception. Reject relative/protocol-relative URLs, malformed hosts, non-HTTPS schemes, whitespace/control characters, encoded ASCII controls, backslash normalization tricks, extra authority slashes, and userinfo (including empty userinfo). URL canonicalization normalizes hosts/default ports. Query strings are allowed but do not change scheme/host checks; never put secrets into configured destinations.

“Approved” means configured by an explicitly authorized catalog administrator and passing this foundation's URL validation; it does not certify remote website content. An Organization domain policy can later be applied at the centralized destination validator/configuration service. F032 deliberately does not build an allowlist/governance subsystem. Enterprise deployment still needs approved-domain review, change control, redirect-chain/content review and retention/audit decisions.

There is no `/redirect?url=` endpoint, server-side URL fetch, external integration, credential forwarding or redirect analytics. Browser navigation consumes the persisted catalog projection, never resident input or a URL query parameter. The client validates the response defensively as well; the server is authoritative.

## Catalog and intake enforcement

Resident catalog list/detail expose actionType and, only for external mode, redirect `{ destination, message, label }`. Internal mode adds no redirect fields. They expose no action revision/admin permissions/audit metadata. Existing active/published filtering remains. Resident Organization resolution retains the existing server-configured catalog Organization boundary; it is not supplied by the browser.

Staff can obtain the same handoff detail at `GET /api/v1/staff/catalog/issues/:id`, requiring Entra and `service_request.create`, scoped to their server-resolved Organization. No staff creation UI exists yet; a future UI can use this contract. Catalog configuration remains a separate permission.

The common resident/staff creation path checks persisted action before questions and eligibility. It checks again under a shared definition lock inside the creation transaction, before reference allocation/writes. Configuration updates contend with that lock. A creation admitted before an action switch may finish first; subsequent/stale submissions fail. External actions return safe 409 and create no request, contact, answers, location, activity or reference. Extra client actionType, destination, Organization or redirect fields fail DTO validation. Both assisted PUBLIC and INTERNAL staff creation are covered; no staff override exists.

F029 audience/channel/identity attribution is unchanged. F030 internal.read and F031 internal.update permissions, scope, lifecycle, routing and audits are unchanged. No coupling exists between action and request audience.

## Resident UX and accessibility

Selecting an external Issue opens an in-page handoff, never immediate navigation. It replaces normal questions/details/review, focuses the heading, displays neutral copy and a human-readable hostname, and explains that no request has been submitted here. Continue is an ordinary HTTPS link with no-referrer; it opens in the **same tab**, with an accessible external-site indication. Go Back returns to Issue selection and clears the selection/answers. No delayed popup or new-tab behavior exists. Neither selection nor Continue calls submission.

Existing INTERNAL_INTAKE flows and legacy fixtures retain their behavior. Missing action in historical client fixtures/older API contracts is treated as internal_intake; current backend responses always include explicit action. Unknown or unsafe external client data fails closed. No branding or real client destination is introduced.

Keyboard tests wait for heading focus, then verify Tab reaches Go Back and Continue, and Enter on Continue creates no request. Responsive browser inspection covered 1280, 768 and 390 widths without horizontal overflow. Light/dark checks found and corrected low Go Back contrast by using a filled secondary button. Native link/button semantics and text destination information support screen readers; no full screen-reader certification is claimed.

## Audit, analytics and future work

Existing Activity belongs to actual ServiceRequests; anonymous handoffs are not requests. Handoff analytics and durable catalog configuration history are deferred rather than misusing Activity or adding an analytics subsystem. Action revision provides concurrency metadata, not an audit trail. Existing sanitized HTTP logging retains route/correlation/status metadata without request/response bodies or full configured URLs. Do not log destination query strings. Enterprise administrative audit/change control remains future work.

Possible future action types include integration handoff, information-only, appointment and form; none is implemented. No real payment/permitting/vendor integration, ArcGIS change, MapLibre architecture change, staff workspace, reference-number configuration or F033 work is included.

## Personal development migrations and UAT

Verified target before both migration runs: localhost:5432, database reqro_dev, role reqro_dev_user; no credentials were printed. Applied committed prerequisites via supported `npm run database:migrate`:

- 20260919000000-add-request-audience-assisted-intake
- 20260919010000-add-internal-request-read-permission
- 20260919020000-add-internal-request-lifecycle

After backend and PostgreSQL security tests passed, applied 20260919030000-add-issue-action. `database:status` confirmed every migration executed, none pending. reqro_test was used only for disposable integration schemas.

No explicit development administrative grant was provisioned: the existing grant CLI is geospatial-specific. Authenticated personal-admin configuration UAT remains pending, without bypassing authorization. Database-backed HTTP tests use fictional principals with only token verification stubbed, retaining real guard/RBAC/SQL behavior.

Browser external UAT used a temporary development-only synthetic repository preview of the real intake component, removed afterward. It showed zero submission calls on handoff, preserved Go Back, and Continue navigated to https://example.com/ in the same tab. Normal preview intake retained a follow-up and completed one stub submission. These are UI checks, not proof of authenticated admin provisioning. Separately, the actual app against the migrated personal API completed normal intake with real follow-up answers and created one clearly labeled fictional PUBLIC request, **SR-202609-000001**, which remains in reqro_dev. The API process started for UAT was stopped; the user's existing Vite session was left running. Temporary tabs/files were removed and viewport restored.

## Validation and security review

Coverage includes URL parser/normalization attacks; no default grants; missing/insufficient admin permission; cross-Organization and forged scope; migration default/down/up/refused destructive rollback; question preservation across both modes; canonical resident/staff projection; direct/stale-version creation denial; no records created by rejected redirects; switching back restores follow-ups and assisted PUBLIC/INTERNAL intake; React keyboard, safe link and no-submission behavior. Existing F029/F030/F031 assertions remain intact.

Security review found no open redirect, browser-selected destination, executable/HTTP/userinfo URL, immediate navigation, unauthorized/cross-Organization configuration, audience bypass, hidden request creation, question deletion, implicit request permissions or default admin grants. Backend body/URL logging remains sanitized. No City data, credentials, infrastructure or remote/cloud resource was modified. Only the safe documentation domain was visited. No push or deployment is authorized.

Final validation: backend unit tests **147/147**; API E2E **36/36**; PostgreSQL integration **40/40, zero skips**; shared **62/62**; React **157/157**. TypeScript checks, lint, formatting checks, backend production build and frontend production build passed. `git diff --check` passed. The frontend build retains its existing chunk-size warning (>500 kB); the fixed-argument local npm orchestration emitted Node DEP0190, and Git reported its configured LF-to-CRLF conversion notices. No warning was suppressed. The final staff catalog UUID-validation change was included in the successful backend checks/build and database-backed HTTP run.
