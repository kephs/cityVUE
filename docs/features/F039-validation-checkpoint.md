# F039 validation and completion report — 2026-09-20

F039 includes the separately approved narrow PUBLIC contact endpoint. Populated live disclosure, contact revocation/restoration, HTTP/audit/log correlation, removal of temporary PUBLIC view and final normal PUBLIC-denial/INTERNAL-access checks passed. This report records the implementation and validation for the authorized local F039 commit.

## Repository state

- Starting HEAD: `870408c5e57ab56706f3778b8c7c5bbbe8ca8930`, branch main, initially 20 commits ahead of origin/main.
- Unchanged origin/main: `6eb836892089bde09ab4255e9f6871a304065fca`.
- Commit message: `feat(requests): add protected requester contact access`. Final hash/status are reported in the completion response.
- Nothing pushed/deployed; no remote/cloud/client resources or production branding changed. F040/F041 were not started.
- No PUBLIC queue, navigation, workflow, assignment or watcher UI was added. Existing PUBLIC list/detail authorization semantics remain unchanged.

See [the feature specification](F039-protected-resident-contact-access.md), [approved PUBLIC design](F039-public-contact-read-design-review.md), and [F036 runbook](F036-safe-development-staff-authorization-provisioning.md).

## Implementation and exposure

Actual protected fields: requester **name** and optional **email**. The current schema has no structured phone. Stored representations remain unchanged, including Unicode names. Requester contact is separate from staff submitter identity and service location. Normal authorized service-location display remains available independently of contact permission.

The new permission is `service_request.contact.read`, with no default grants. Normal INTERNAL request access and contact permission are both required. Trusted Organization, active Organization, audience and current effective department/division scope constrain the contact query. References, ownership, watching and operational membership never confer contact permission.

Dedicated contracts: `GET /api/v1/staff/internal-service-requests/:serviceRequestId/contact` and the separately approved `GET /api/v1/staff/public-service-requests/:serviceRequestId/contact`, returning only nullable `name` and `email`. Each independently requires its audience-specific parent-read permission/scope plus contact.read. It sends `Cache-Control: no-store`. Missing permission returns 403; unauthenticated access returns 401; admitted but inaccessible, unknown or wrong-audience records return safe 404. Unknown query parameters are rejected. No field-presence hints or masked values are disclosed to unauthorized callers.

| Request access | contact.read | Tested result                                                  |
| -------------- | ------------ | -------------------------------------------------------------- |
| No             | No           | Denied                                                         |
| No             | Yes          | Denied                                                         |
| Yes            | No           | Ordinary request available; contact denied                     |
| Yes            | Yes          | Explicit structured projection or authorized no-contact result |

Update permission without contact permission: denied. Assigned staff without contact permission: denied. Direct watcher without contact permission: denied. Operational Role/Team membership without contact permission: denied. The PostgreSQL HTTP harness exercises actual guards, resolver and repositories with only token verification replaced by synthetic test identities; this is automated evidence, not live personal-Entra evidence.

| Surface                         | Actual structured-contact behavior                                               |
| ------------------------------- | -------------------------------------------------------------------------------- |
| Staff request list              | Omitted                                                                          |
| Ordinary request-detail payload | Omitted, including the older PUBLIC detail path                                  |
| Dedicated contact endpoint      | Authorized only, after durable audit commit                                      |
| Operational Activity            | No contact values or contact-view event                                          |
| Security audit                  | Safe metadata only; no contact values                                            |
| Browser URL / document title    | No contact values                                                                |
| Console / application logs      | No contact values; tested on success, denial, malformed input and forced failure |
| Analytics                       | No contact integration                                                           |
| localStorage / sessionStorage   | No contact persistence; request-scoped memory only                               |

The reusable service takes a server-owned request-access policy. F040 could supply PUBLIC request authorization while retaining independent contact permission, the same dedicated projection and the same audience-neutral audit. The separately approved PUBLIC policy/route now requires existing service_request.view and PUBLIC category Department/Division scope. No PUBLIC workspace was implemented. A future PUBLIC reader without contact permission would receive operational data only. Assignment/watch/Role/Team and service-location boundaries remain independent.

## UI and contact-state lifecycle

The F038-styled **Requester Contact** card is supporting information, below the primary operational information. It uses an explicit **View requester contact** action, followed by **Refresh requester contact** or **Retry requester contact**. No automatic contact fetch occurs for list rows, initial detail render, React Strict Mode replay or routine workflow/activity refresh.

Actual states:

- Protected: “Protected” and “You don't have permission to view requester contact information.” No values or field-presence hints remain in the DOM.
- Authorized before disclosure: “View protected structured contact for this request. Access is audited.”
- Loading: “Loading requester contact…”.
- Populated: Name and Email as escaped plain text; only supplied fields appear.
- Empty: “No contact information was provided.”
- Error: “Requester contact could not be loaded. Please try again.”

No mailto/tel links are created: contact remains text, avoiding execution of stored schemes/commands. No copy/export/communication action is provided. Long content wraps; Unicode is preserved. Loading and failure feedback use status/alert semantics, headings and definition lists provide reading structure, and pending requests disable duplicate activation.

Request A contact is aborted/cleared when detail unmounts for Request B. Late responses are ignored. Auth identity changes/sign-out unmount protected state. Contact 401/404 clears parent and contact; contact 403 clears contact and rechecks normal request access. Parent denial clears everything; retained parent access keeps ordinary detail visible. Known capability loss clears contact. Transient contact errors clear old values while retaining authorized detail. There is no real-time revocation push: current database grants are enforced on the next API request.

## Audit, atomicity and query review

Successful disclosure, including authorized empty contact, writes one `service_request_contact_viewed` event to the existing append-only `activity` security table per endpoint request. It stores internal staff principal, Organization, technical request ID, staff actor type, database timestamp and `{ policy: "F039", action: "contact_viewed", correlationId }`. Actor reference is null. No requester name/email/phone/contact payload/description/narrative or identity-provider identifiers are copied into metadata.

The transaction performs the authorized parent select with shared request/category/Organization locks, the narrow Organization/request contact select, and the audit insert. The response waits for commit. Existing primary/composite keys and contact uniqueness support lookup; no Organization-wide contact scan, history load, N+1 actor lookup or requester identity-provider call exists. Normal RBAC resolution and one audit write add per-disclosure cost. Retention is unchanged; production abuse/rate monitoring remains future work.

Disposable failure injection forced a security-audit insert error for an otherwise authorized populated contact read. The HTTP result was a safe 500 with no partial contact response. Request rows, contact values, existing grants, operational activity and ownership/watchers matched their pre-call snapshots. No unsafe contact values appeared in captured logs. Personal reqro_dev audit infrastructure was not damaged or failure-injected.

## Migration and existing data

Migration: `20260920010000-add-request-contact-access`. It registers the permission and adds the contact-view type to the security-audit allowlist. No contact-data schema change, default grant, rewrite, normalization or automatic provisioning occurs.

Apply/rollback/reapply passed in disposable schemas. Rollback refuses when meaningful contact-view audit or grants exist. The personal database was not rolled back. Local application verified development profile, localhost, port 5432, database reqro_dev, role reqro_dev_user, and actual loopback server identity without printing credentials. The initial tsx launcher failed before migration execution because of an OS user-information error; verification found zero F039 migration entries, and the same compiled migration CLI then applied successfully. No manual schema repair was performed.

Personal state: **18 applied migrations, zero pending**, latest F039 migration above. Immediately after application: **zero contact.read grants and zero contact-view audits**.

Integrity hashes preserve all pre-existing requests, requester_contact, assignment, watchers, operational history, Issue definitions/versions and reference configuration. Reference counters legitimately advanced only through normal creation of the new fictional requests below. Existing permission grants also match when the explicitly added contact permission is excluded. This preserves SR-202609-000001, SR-202609-000002 and DEV-202609-00000003 as found at this checkpoint. DEV was already On Hold/revision 24 when the fresh baseline was captured; this task did not change that status. An additional pre-existing SR-202609-000004 was likewise preserved. Two normal fictional PUBLIC intake records were subsequently created during the approved populated UAT and are disclosed below.

## F036 manifest and personal grants

FULL_UAT_OPERATOR previously contained six non-geospatial permissions. It now expands to seven, in manifest order:

1. `service_request.create`
2. `service_request.create_internal`
3. `service_request.internal.read`
4. `service_request.contact.read`
5. `service_request.internal.update`
6. `catalog.issue_action.manage`
7. `service_request.reference.manage`

Optional `geospatial.read` remains outside that bundle and unprovisioned personally. Existing `service_request.view` is also accepted only as a separate explicit permission. It was temporarily provisioned for the approved PUBLIC API UAT, then removed; it is absent from the seven-key bundle and final stored grants. Other bundles are unchanged. A manifest edit never changes stored grants; runtime resolves individual permission rows, not bundle names.

The supported F036 dry run and explicit provisioning succeeded for adding only contact.read to the existing selected personal development principal, CityVUE Development Municipality, Public Works / Streets and Community Services / Parks. After the operator confirmed authorized no-contact access, the same tooling explicitly revoked only contact.read. The operator then confirmed the Protected state. A further reviewed dry run and explicit provisioning restored contact.read. Each command verified the development profile and actual local database identity. Read-only comparisons verified that the original six grants, staff role assignment, department/division memberships, requests, contact, operational activity, assignment and watchers were unchanged. No direct SQL grant writes or runtime authorization changes were used.

**Development grants retained for future UAT.** The selected principal now has the seven permissions below; no personal identity values are included here. Automated F036 tests additionally prove zero-write dry run, repeated provisioning, targeted revocation and preservation of unrelated permissions and operational data.

| Permission                       | Purpose                               | Effective scope                                                                  |
| -------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| service_request.create           | Staff-assisted intake                 | Existing fictional Organization and authorized catalog scopes                    |
| service_request.create_internal  | INTERNAL staff intake                 | Same fictional scopes; existing intake prerequisites remain                      |
| service_request.internal.read    | INTERNAL workspace and activity       | Public Works / Streets and Community Services / Parks under existing scope rules |
| service_request.internal.update  | Lifecycle, routing and ownership      | Same fictional scopes; current/target authorization remains enforced             |
| catalog.issue_action.manage      | Fictional Issue action UAT            | Same authorized catalog scopes                                                   |
| service_request.reference.manage | Reference configuration UAT           | Fictional Organization                                                           |
| service_request.contact.read     | Independent structured contact access | Fictional Organization plus separately authorized parent request scope           |

## Manual live UAT

Computer Use stopped because Chrome's URL could not be reliably established for its safety rules. Subsequent browser steps were operator-driven. No restriction was bypassed, no authentication state/token was extracted, and no alternate authentication or fabricated StaffAccess was used. The temporary local page used the existing AuthRoot/MSAL/API client and normal local API/database authorization. It was an API validation harness, not a PUBLIC workspace or fixture preview.

### INTERNAL no-contact UI proof

For DEV-202609-00000003, the operator observed Protected before explicit contact permission, authorized no-contact plus Refresh requester contact after grant, Protected after targeted revocation, then authorized no-contact after restoration. Restored normal detail/contact succeeded **without re-login**. Safe security audits were recorded at **14:53:00.705 UTC** and **14:58:33.108 UTC**, with correct actor/Organization/request and only safe metadata. The existing 25 operational events remained unchanged. The final post-PUBLIC-view-removal check also successfully read authorized empty INTERNAL contact through the same audited path. This is live empty-contact UI evidence, not populated-contact evidence.

### Populated PUBLIC proof

Approved intent was one fictional request. **Two** normal manual intake creations were observed and retained: **SR-202609-000005** at **15:48:56.339 UTC**, and **SR-202609-000006** at **15:50:04.115 UTC**. Both use clearly fictional PUBLIC/PHONE data and structured name/email; phone is unsupported. No existing request/contact was altered. The creation control was removed when the additional record was identified. Neither record/history was deleted to conceal the extra creation.

Selected UAT request: **SR-202609-000006**, Issue **Damaged Street Sign**, category **Roads & Streets**, scope **Public Works**, PUBLIC audience, PHONE intake, **Open revision 1**. It has one request_created operational event. Requester contact is distinct from staff submitter and service location. Both new request/contact/history snapshots remain unchanged after contact reads.

| State                               | Actual evidence                                                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A: temporary view, no contact.read  | Operator PASS: ordinary PUBLIC list/detail 200 and contact-free; protected endpoint 403/no-store. Zero contact-view audits.                                                                                        |
| B: contact.read explicitly restored | Operator PASS: protected endpoint 200/no-store; exact fictional name/email compared in memory, only name/email returned. Ordinary list/detail contact-free.                                                        |
| C: only contact.read removed        | Operator PASS: ordinary request still accessible, contact 403/no-store. No additional disclosure audit. Captured ordinary reads used authenticated wire 304 revalidation, presented by browser fetch as 200.       |
| D: contact.read explicitly restored | Fresh live GET200 at 16:07:12.879 UTC matched a second safe audit, without re-login or new request creation.                                                                                                       |
| E: only temporary view removed      | Operator PASS: PUBLIC list/detail/contact 403, contact no-store; existing INTERNAL request/contact 200 with authorized no-contact result. Captured normal GET logs and the final seven-grant database check agree. |

Successful populated reads at **15:56:55.442 UTC** and **16:07:12.879 UTC** each correlate to exactly one captured normal GET200 log by the same server request/correlation ID as the security audit. Correct trusted actor, Organization, request, action, timestamp and metadata were verified. The captured normal log was scanned in memory for the actual fictional contact values and description; none occurred. Audits and operational history also contain no contact payload. Exactly two successful populated disclosure audits exist; contact viewing added no operational activity.

The operator supplied OPTIONS204 preflight headers rather than the successful GET's correlation header. No independent browser-header capture is claimed. Actual successful HTTP log records, matching security audit and manual populated response validation establish the required correlation. No CORS or authentication change was made to retrieve a header. Tokens, authentication headers, response bodies and HARs were not collected.

Before PUBLIC UAT, the principal had the original six permissions plus contact.read and no PUBLIC view. F036 dry-run/explicit provisioning added temporary view individually, and contact.read was selectively removed/restored. At the end, F036 removed only PUBLIC view; the exact seven-key grant set and original scopes remain. The selected principal is reported only as **development-principal-…6f6d34**. All pre-existing request/contact/configuration/history/ownership and scope hashes remain unchanged. The extra fictional request remains preserved.

### Responsive, theme and accessibility evidence

Earlier browser checks found no horizontal overflow at **1280, 1024, 768 and 390px**, in **light and dark** themes. Protected live UI was inspected; a clearly labeled fictional component preview checked populated, partial, empty and protected layouts, long email wrapping, Unicode, Tab/Shift+Tab, Space activation, visible focus and semantic reading order. Those preview files were removed. These are visual/accessibility checks, not live populated authorization evidence. Populated authorization comes from the separate real PUBLIC API checks above. No live PUBLIC contact-presentation UI, structured phone, full screen-reader test or WCAG certification is claimed.

## Automated validation

| Check                           | Result                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend unit                    | 180 passed, including the independent PUBLIC policy permission test                                                                                       |
| API E2E                         | 36 passed                                                                                                                                                 |
| PostgreSQL integration          | 114 passed, zero skips; includes INTERNAL/PUBLIC contact HTTP/migration and explicit F036 contact/view provisioning coverage                              |
| Shared                          | 62 passed                                                                                                                                                 |
| React                           | 278 passed across 24 files                                                                                                                                |
| F036 provisioning               | 4 unit tests plus complete PostgreSQL provisioning suite passed; exact seven-permission bundle and explicit individual contact/view grant/removal covered |
| TypeScript                      | Passed                                                                                                                                                    |
| Backend lint                    | Passed                                                                                                                                                    |
| Frontend lint                   | No configured frontend lint command                                                                                                                       |
| Formatting                      | Backend check and focused changed React formatting passed; legacy compact page/test style preserved                                                       |
| Backend production build        | Passed                                                                                                                                                    |
| Frontend production build       | Passed                                                                                                                                                    |
| Git whitespace                  | Passed                                                                                                                                                    |
| Private configuration / secrets | No personal configuration values, credentials, JWT-like tokens or full credential-bearing DATABASE_URL in added content; local env files remain ignored   |

F029–F038 regression coverage passes: audience/intake and scope boundaries, read/update independence, lifecycle/revisions, redirect refusal, reference isolation, workspace protections, append-only operational history, development provisioning, ownership/watchers and presentation. The intended privacy tightening removes structured contact from the old ordinary PUBLIC detail projection. Existing PUBLIC request-read scope is unchanged; the added contact route requires the independent contact permission.

Initial validation launcher mistakes were corrected without weakening tests: personal identity environment variables were excluded from isolated test runs, and suites were rerun with less contention after timing failures. Existing Vite warnings about chunks over 500 kB remain. Pre-existing untyped F038 test response accesses in the already modified integration file were given explicit types to satisfy strict lint, with assertions retained.

## Files added and changed

Added:

- `server/migrations/20260920010000-add-request-contact-access.ts`
- `server/src/service-request/request-contact.controller.ts`
- `server/src/service-request/request-contact-privacy.middleware.ts`
- `server/src/service-request/public-request-contact.controller.ts`
- `server/src/service-request/public-request-contact.policy.ts`
- `server/src/service-request/request-contact.service.ts`
- `server/test/database/request-contact-checks.ts`
- `server/test/database/public-request-contact-checks.ts`
- `server/test/unit/request-contact.service.test.ts`
- `react/src/staff/requests/RequesterContact.jsx`
- `react/test/RequesterContact.test.jsx`
- `docs/features/F039-protected-resident-contact-access.md`
- `docs/features/F039-public-contact-read-design-review.md` (approved and implemented).
- This validation checkpoint.

Changed:

- Permission/manifest: `server/src/auth/auth.types.ts`, `server/src/database/development-staff-input.ts`.
- Service registration/projections: `service-request.module.ts`, `internal-request.repository.ts`, `service-request.repository.ts`, `get-service-request-details.service.ts`, `service-request.dto.ts` under `server/src/service-request/`.
- Staff UI: `InternalRequestWorkspace.jsx`, `requestRepository.js`, `staffRequests.css` under `react/src/staff/requests/`; older `react/src/pages/issues/ServiceRequestDetailsPage.jsx`.
- Backend tests: `request-audience.integration.test.ts`, `service-request.integration.test.ts`, `development-staff.integration.test.ts` under `server/test/database/`; `development-staff-input.test.ts`, `service-request-details.service.test.ts` under `server/test/unit/`.
- React tests: `StaffRequestWorkspace.test.jsx`, `StaffRequestRepository.test.js`, `ServiceRequestDetailsPage.test.jsx`.
- Documentation: `docs/ARCHITECTURE.md`, `docs/CITYVUE_CONTEXT.md`, `docs/ROADMAP.md`, F036 provisioning feature/runbook.

## Final cleanup and security review

The temporary manual harness, helper, integrity snapshots, test logs and captured API log were removed after final evidence verification. Windows initially kept the active capture log open; it was removed once the terminal released it. Operator-owned ignored environment configuration is preserved. Final TypeScript, backend lint/formatting and both production builds passed. Focused React/documentation formatting, whitespace and private-configuration checks passed. No personal configuration values, credentials, JWT-like values or credential-bearing connection strings were introduced into tracked content; two pre-existing synthetic test URL matches were reviewed and left unchanged.

Both permission keys are enforced on the server. Request-read/update, assignment, watching and operational membership never imply contact.read. Normal Organization/scope/audience and current database grants remain authoritative. Required audit failure prevents disclosure. Contact is absent from ordinary projections, operational activity, URLs, titles, analytics and persistent browser storage. No default grant, sign-in/startup/migration grant, production grant API or development bypass was added.

The reusable service and separate audience policies let a future F040 workspace show authorized PUBLIC operational data while leaving contact Protected without the second permission. With both keys, the dedicated contact endpoint/audit can be reused without copying contact into ordinary detail. Future PUBLIC routing must review category-based scope consistently across related policies. F040 itself is not implemented.

F039 protects **structured** contact, not every possible incidental PII location. Description, follow-up answers and future notes/files/communications require separately designed guidance, classification and redaction policies. No automatic redaction/AI detection or formal regulatory classification is claimed. Service location may itself be sensitive but remains distinct from requester name/email. Staff attribution is independently governed.

Retention remains unchanged. Contact search, editing, export/import, profiles, field-level permissions, masking, communication, consent/preferences, notes, attachments, AI detection/redaction and production administration remain deferred. Contact access does not authorize communication. Stop after F039; no F040/F041 work, push or deployment.
