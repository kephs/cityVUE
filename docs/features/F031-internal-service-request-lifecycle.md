# F031 — Internal Service Request Lifecycle & Mutations

## Purpose and threat model

F031 adds backend-only INTERNAL workflow and routing commands on F030's authenticated API. **READ AUTHORIZATION DOES NOT IMPLY WRITE AUTHORIZATION.** Creation, read, and mutation privileges remain separate security capabilities. Requester/creator identity and UUID knowledge grant no mutation authority.

Threats addressed: anonymous or read-only writes, forged Organization/actor/audience, cross-Organization or out-of-scope writes, routing-based escalation, arbitrary status changes, lost updates, partial audit commits and contact/free-text leakage. Development uses fictional organizations/users/data and local test infrastructure only.

## Permission and identity

`service_request.internal.update` is the sole new permission. Both lifecycle and routing are narrow operational updates; both require the same explicit grant, while routing additionally checks current AND target membership. A separate routing permission would not add a boundary needed by this slice. No default grants, seed grants, personal grants or permission-management UI are added.

The existing Entra-only StaffAccessGuard validates signed identity/delegated scope and resolves active staff/roles/assignments and memberships from PostgreSQL for each call. The service independently rejects missing identity, development fallback, malformed trusted identifiers and missing update permission. It never uses Organization, actor or permissions from client input. Update does not imply internal.read or existing PUBLIC/contact access; the command receipt is not a general read endpoint.

## API contracts

Both commands use `POST /api/v1/staff/internal-service-requests/:serviceRequestId/…`, return HTTP 200 with `Cache-Control: no-store`, and require internal.update:

- `workflow`: existing `WorkflowActionDto` with `expectedRevision` and `action`; reuses existing bounded reason/resolutionSummary inputs and validation. No arbitrary status, description, audience, Organization, contact or actor fields are allowed.
- `routing`: `{ expectedRevision, departmentId, divisionId? }`. Missing/null divisionId means Department-level routing; a supplied Division must belong to that Department. A no-op route returns 409. Routing is permitted in any existing lifecycle state because it does not change status or reopen work.

Receipt fields: serviceRequestId, status, revision, updatedAt, departmentId, divisionId. No contact, description, names, reasons or resolution summary is returned. F030 detail adds revision so a separately authorized reader can prepare commands. Its existing minimal list/description/contact policy is preserved; departmentId/divisionId now reflect effective request routing.

Unknown DTO fields/invalid shapes return 400; missing/invalid authentication 401; missing permission 403. Missing, PUBLIC, wrong-Organization, inactive-Organization, out-of-scope requests and unauthorized/unavailable routing targets use generic 404. Revision conflicts, invalid transitions and unchanged routes return deterministic 409. Unexpected failures retain existing sanitized platform errors.

## Lifecycle

Reuses `resolveWorkflowTransition` and `validateWorkflowInput`; no new status vocabulary or workflow engine:

| Current | Action | Next | Existing input requirement |
| --- | --- | --- | --- |
| open | start_work | in_progress | None |
| open | close | closed | Nonblank resolutionSummary |
| in_progress | hold | on_hold | Nonblank reason |
| in_progress | close | closed | Nonblank resolutionSummary |
| on_hold | resume | in_progress | None |
| on_hold | close | closed | Nonblank resolutionSummary |
| closed | reopen | open | Nonblank reason |

All other combinations fail. Persisted cancelled requests have no transition in the existing domain and remain terminal; this slice adds no cancellation action. Operational reason/resolution inputs are validated but intentionally not retained or returned in F031: the metadata-only audit records action and state transition. Durable operational narrative storage needs a separately approved visibility/retention policy. No additional free-text field is introduced.

## Routing, scope and persistence

Existing scope derives from the shared catalog Category; changing it would reroute every request in that Category. Existing assignment history supports Department/individual/group targets but has no Division routing or ownership policy. F031 therefore adds nullable `routed_department_id` and `routed_division_id` to ServiceRequest, restricted to INTERNAL records. Composite foreign keys enforce same-Organization Department and correct Department/Division relationships. PUBLIC must retain null routes; Division cannot exist without a routed Department.

Until explicitly routed, effective scope remains the existing Category Department/Division. After routing, the request-specific Department and optional Division control both F030 reads and F031 mutations. Category/service classification, published versions, answers and assignment records are untouched. An explicit Department-only route does not fall back to the Category Division.

Current AND target scope must be authorized. The target must be active, in the same trusted Organization, and in the actor's Department membership plus Division membership when present. Empty Department scope denies all records; empty Division scope admits only Department-level requests. Routing never grants membership. Another employee's existing explicit target-scope access can legitimately make the routed request visible there; the caller cannot route outside scopes they already possess. Sensitivity/HR restrictions beyond Department/Division remain deferred.

`internalRequestScope` shares SQL audience/Organization/effective-membership predicates between the dedicated read and mutation paths. Mutation services authorize the operation-specific permission before using it. The final UPDATE repeats scoped-ID, Organization, INTERNAL and expected-revision conditions. Generic PUBLIC repositories/actions remain PUBLIC-only and unchanged.

## Concurrency and audit

A transaction locks the scoped request, checks expectedRevision, applies the existing transition or validated route, increments revision/updatedAt and inserts Activity. Request locking serializes competing commands, and the expected revision makes a second concurrent writer receive 409. Shared locks on the Category/Organization and routing targets protect the checked classification/active target state while committing. Audit failure rolls back the mutation and revision. Membership/grant checks use the existing guard snapshot for that request; concurrent revocation may not cancel an already authorized in-flight operation, but subsequent requests re-resolve authorization.

Append-only Activity uses the existing staff actor and stable staff identity FK, Organization/request IDs and database timestamp. Workflow uses existing event types; routing uses `service_request_reassigned` with `changedField=routing`, not an assignment-history mutation. Metadata is allowlisted: policy=F031, action, changedField, revision, from/to status or from/to Department/Division IDs. No descriptions, resident contacts, tokens, credentials, reason text or resolution text enter audit. HTTP logging continues using the existing sanitized correlation/template policy; no raw body logging is added. No new correlation storage is invented.

## Migration and operation

`20260919020000-add-internal-request-lifecycle.ts` adds the two routing columns/constraints and permission catalog key. No speculative indexes or dependencies are added. Ungranted/unused down/up is supported. Rollback takes locks and refuses while routes, F031 audit events or permission grants depend on the feature, preventing accidental restoration of catalog visibility. Removal of audit/route data requires a separately approved retention process; do not force rollback or run older F030 code over routed records.

Apply normal migrations before running updated API code. This task migrates disposable local test schemas only, not the personal application database. No real identity grants, cloud changes, pushes or deployments are performed.

## Validation and security review

The existing F029/F030 PostgreSQL HTTP harness retains its assertions; its only response-contract adjustment is the additive revision field. Added coverage tests permission migration/no default grants/down/up, anonymous/read-only/creator denial, PUBLIC/cross-Organization/forged scope denial, allowed/invalid/arbitrary transitions, required inputs, concurrent expected revisions, current and target Department/Division scope, invalid/cross-Organization/inactive targets, effective read scope after routing, contact-free receipts, allowlisted audit, transactional rollback on audit failure, update/read independence, revocation and database routing constraints. Unit checks deny unauthorized service calls before any database access. Token verification alone is stubbed with fictional principals; actual guards/RBAC/SQL/transactions are exercised.

Security review: read and creation do not permit writes; UUID knowledge and forged scope cannot bypass checks; routing cannot escape current/target authorization; arbitrary status fields are rejected; no contact or description is copied to audit/receipts; PUBLIC paths remain unchanged; no default grant or generic INTERNAL update path is introduced.

Validation passed: backend unit 126/126; API E2E 36/36; PostgreSQL integration 36/36 with zero skips; shared 62/62; React 155/155; backend typecheck, lint, formatting and production build; frontend production build. The existing frontend large-chunk warning remains. The focused F029–F031 database suite also passed 22/22. Local-secret comparison and git diff checks passed. No live Entra session was exercised.

## Deferred work and risks

No staff UI, attachments, comments, resident PII editing, deletion, bulk updates, notifications, vendor integrations, AI, permission-management UI or workflow engine. Free-text request descriptions remain unredacted under the existing F030 read policy. Durable reasons/resolution narratives, sensitivity controls, richer audit presentation, and production/live Entra UAT remain separately scoped.
