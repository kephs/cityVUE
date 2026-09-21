# F040 — PUBLIC Service Request Staff Workspace

Status: implemented and validated. The personal F040 migration is applied (19 applied, zero pending). The granular PUBLIC permission model and retained development selection were explicitly approved on 2026-09-20. Manual authenticated lifecycle, routing, ownership/watchers, mixed filters, contact revocation and both audience-read revocations passed. All sixteen approved development permissions are restored and retained. Authorized and Protected-state responsive light/dark checks passed at all five required widths, together with keyboard/focus checks. See the [implementation report](F040-implementation-report.md) and [validation record](F040-validation-checkpoint.md). No push, deployment or F041 work is included.

## Purpose and boundaries

One staff workspace serves authorized PUBLIC and INTERNAL requests at `/staff/requests` and `/staff/requests/:requestId`. It reuses the F038 Issue-first presentation, F031 lifecycle/routing, F035 operational history, F037 ownership/watchers and F039 on-demand contact projection.

A UNIFIED STAFF WORKSPACE DOES NOT MEAN UNIFIED AUTHORIZATION.

PUBLIC REQUEST ACCESS DOES NOT IMPLY REQUESTER CONTACT ACCESS.

ASSIGNMENT, WATCHING, AND OPERATIONAL MEMBERSHIP DO NOT GRANT REQUEST ACCESS.

PUBLIC CLASSIFICATION DOES NOT MAKE STAFF OPERATIONAL DATA PUBLICLY VISIBLE.

PUBLIC describes the resident service domain; it does not make contact, staff operations or operational narratives anonymous internet data. Service location remains operational request data governed by normal request access. Structured requester name/email remain separately protected; phone is not supported by the existing contact domain. Free-text request content can contain incidental PII; no redaction capability is added.

## Authorization and capabilities

The shared HTTP controller requires normal Entra identity and at least one of the two audience-read permissions. This admission does not grant both audiences. The repository admits each persisted row only under its own audience's permission and the trusted active Organization and effective Department/Division scope. Every command repeats that parent admission before checking its operation-specific permission. No request body, filter, assignment, watcher or operational membership selects authorization policy.

| Capability                                    | Parent permission               | Additional requirement                                                       |
| --------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| PUBLIC list/detail/history                    | `service_request.view`          | Trusted Organization/current scope                                           |
| PUBLIC Start Work                             | `service_request.view`          | `service_request.start_work`, valid state/revision                           |
| PUBLIC Hold                                   | `service_request.view`          | `service_request.hold`, reason, valid state/revision                         |
| PUBLIC Resume                                 | `service_request.view`          | `service_request.resume`, valid state/revision                               |
| PUBLIC Close                                  | `service_request.view`          | `service_request.close`, resolution, valid state/revision                    |
| PUBLIC Reopen                                 | `service_request.view`          | `service_request.reopen`, reason, valid state/revision                       |
| PUBLIC routing                                | `service_request.view`          | `service_request.route`, current and target scope/revision                   |
| PUBLIC assignment/reassignment/unassignment   | `service_request.view`          | `service_request.assign`, eligible target/revision                           |
| PUBLIC manage other watchers                  | `service_request.view`          | `service_request.watchers.manage`, eligible target/revision                  |
| PUBLIC self-watch/stop watching               | `service_request.view`          | Current read access and eligible current STAFF principal/revision            |
| PUBLIC contact                                | `service_request.view`          | `service_request.contact.read`, current scope, successful security audit     |
| INTERNAL list/detail/history                  | `service_request.internal.read` | Trusted Organization/current scope                                           |
| INTERNAL workspace workflow/routing/ownership | `service_request.internal.read` | `service_request.internal.update`, state/target/scope/revision as applicable |
| INTERNAL self-watch                           | `service_request.internal.read` | Current read access and eligible current STAFF principal/revision            |
| INTERNAL contact                              | `service_request.internal.read` | `service_request.contact.read`, current scope, successful security audit     |

The existing five PUBLIC workflow keys and `service_request.assign` are reused. There is no generic PUBLIC `service_request.update`. Only `service_request.route` and `service_request.watchers.manage` are new. See the [approved permission review](F040-public-staff-workspace-design-review.md).

Legacy INTERNAL mutation endpoints retain their existing `internal.update` contract; F040's unified workspace also requires the normal read boundary before exposing or operating on the parent. Legacy named routes do not become audience-agnostic.

After parent authorization, detail returns `capabilities`: permitted and currently valid `workflowActions`, `canRoute`, `canAssign`, `canManageWatchers`, `canWatchSelf`, and `canReadContact`. Target eligibility is checked separately against current data when a command executes. React uses those capabilities to present controls; the API remains authoritative. A global INTERNAL update flag is not used to infer PUBLIC capabilities.

## Secure All query, filters and pagination

`staffRequestReadScope` computes the allowed persisted audiences from current database-backed permissions. A single SQL query applies trusted Organization, active Organization, allowed audience and effective scope. Effective Department uses the routed override or catalog Department; effective Division uses the routed value (including null) whenever a route override exists. Legacy PUBLIC read and protected-contact policies use the same effective scope.

Conceptually the admitted set is authorized PUBLIC union authorized INTERNAL, expressed as a parameterized audience predicate on one scoped relation. User audience choice only narrows it. Operational views then add correlated relationship predicates, followed by status, effective Department/Division and complete reference search. Unauthorized rows never reach React.

AUDIENCE FILTERING DOES NOT SELECT THE AUTHORIZATION POLICY FOR A REQUEST.

| Audience selection | Result                                            | Unavailable-audience UX                                                                     |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| All (default)      | Authorized records from either permitted audience | One permitted audience works independently; neither read permission denies workspace access |
| Public             | Authorized PUBLIC records only                    | Safe empty result when only INTERNAL read exists                                            |
| Internal           | Authorized INTERNAL records only                  | Safe empty result when only PUBLIC read exists                                              |

All three labelled options remain visible. Empty results say no requests match the filters, not that no records exist in the Organization. Counts use the same authorization and narrowing predicates. Reference search is exact, case-normalized and Organization scoped; references remain opaque display identifiers rather than authorization evidence.

Operational views:

- All Requests: the normally authorized set.
- My Requests: direct current STAFF assignment to the authenticated principal.
- My Team: current ROLE/GROUP assignment with active server-resolved operational membership and active target.
- Watching: direct STAFF watcher or active ROLE/GROUP member watcher relationship, independently constrained by current audience read and scope.

Global order is `created_at DESC, id DESC`. Default page size is 25 and maximum 100. Offset/count pagination is performed server-side; React never merges separately paginated audience pages. Filter changes reset page to one. Audience/view/status/scope/reference/page use existing URL search state and browser navigation conventions. Concurrent inserts can shift offset pages; this is not snapshot pagination across separate HTTP requests.

## Shared operations and history

| Current state | Action              | Required narrative | Next state  | Operational event  |
| ------------- | ------------------- | ------------------ | ----------- | ------------------ |
| Open          | Start Work          | None               | In Progress | `work_started`     |
| Open          | Close               | Resolution         | Closed      | `request_closed`   |
| In Progress   | Hold                | Reason             | On Hold     | `placed_on_hold`   |
| In Progress   | Close               | Resolution         | Closed      | `request_closed`   |
| On Hold       | Resume              | None               | In Progress | `work_resumed`     |
| On Hold       | Close               | Resolution         | Closed      | `request_closed`   |
| Closed        | Reopen              | Reason             | Open        | `request_reopened` |
| Cancelled     | No lifecycle action | —                  | Cancelled   | None               |

Each accepted mutation locks the scoped parent, checks expected revision, changes state, increments revision, writes safe security metadata and appends the typed operational event in one transaction. Stale simultaneous commands yield one success and one conflict. Hold, Close and Reopen reuse existing validation and plain-text narrative rules. Historical close resolution survives reopening. No email or notification is sent.

Routing requires both current and target scope. Eligible current assignment persists. An ineligible assignment clears in the same transaction as routing, with `request_routed` then `request_unassigned` at one revision and separate event indices. Failure inserting either event rolls everything back. Watchers remain as explicit relationships; a watcher who loses request scope loses access and no longer sees that request in Watching.

Assignment targets remain STAFF, operational ROLE and operational GROUP/Team. Catalog Group and RBAC Role are separate concepts. STAFF eligibility now uses the request audience's read permission; inactive, foreign or out-of-scope targets cannot be newly assigned or watched. Picker purpose independently checks assignment or watcher-management permission. Existing bounded search, keyboard controls, database uniqueness, foreign keys, snapshots and target-deactivation behavior remain. Assignment never automatically adds a watcher; explicit overlap retains F037 behavior. Role/Team membership is not directory permission mapping.

Operational history remains append-only, newest first by `occurred_at DESC, id DESC`, paged separately. Actor display is privacy-minimized. Target/routing names are historical snapshots. Security audits and requester contact are never included in Activity.

## API compatibility

All routes below are under `/api/v1`.

| Route                                                                       | Contract                                                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /staff/service-requests`                                               | Unified authorized list; accepts `audience=all\|public\|internal` plus existing narrowing filters |
| `GET /staff/service-requests/workspace-options`                             | Authorized scope options and readable audiences                                                   |
| `GET /staff/service-requests/:id`                                           | Persisted-audience detail and per-request capabilities                                            |
| `GET /staff/service-requests/:id/activity`                                  | Authorized staff operational timeline                                                             |
| `POST /staff/service-requests/:id/workflow`                                 | Shared lifecycle command                                                                          |
| `POST /staff/service-requests/:id/routing`                                  | Shared scoped routing command                                                                     |
| `GET /staff/service-requests/:id/assignment-targets`                        | Eligible bounded targets; `purpose=assignment\|watchers`                                          |
| `POST /staff/service-requests/:id/assignment` and `/assignment/remove`      | Shared F037 owner commands                                                                        |
| `GET/POST /staff/service-requests/:id/watchers`, `POST .../watchers/remove` | Current watchers and controlled management                                                        |
| `POST /staff/service-requests/:id/watch-self` and `/unwatch-self`           | Current principal convenience commands                                                            |
| `/staff/internal-service-requests/...`                                      | Retained INTERNAL-only compatibility routes                                                       |
| `/service-requests/...`                                                     | Retained existing PUBLIC-only contracts; scoped reads follow effective routing                    |
| `GET /staff/public-service-requests/:id/contact`                            | Retained F039 two-key protected PUBLIC contact                                                    |
| `GET /staff/internal-service-requests/:id/contact`                          | Retained F039 two-key protected INTERNAL contact                                                  |

Legacy authenticated PUBLIC workflow delegates to the shared lifecycle/history engine and preserves its response shape. The older PUBLIC assignment endpoint retains its legacy department/individual/group command contract; the unified workspace uses F037 assignment commands and eligible-target APIs. Existing development fallback gates on older endpoints are unchanged; the new unified endpoints always require Entra and database-backed RBAC. No route is silently reclassified or removed.

Malformed/forged mutation fields fail validation; missing identity returns 401, missing admission/operation permission 403, inaccessible scoped request 404, stale revision 409. Inaccessible responses do not identify another Organization or disclose contact presence. Protected endpoints use no-store. Invalid transitions and targets create no history.

## Contact, presentation and resident privacy

Requester Contact uses the existing explicit View/Refresh control and separate protected endpoint selected from the authoritative detail audience. No list preload, polling or automatic contact re-fetch follows unrelated operations. Stored name/email render as plain text. Contact is held in memory only and clears with route/auth changes, known parent denial, contact denial and capability loss. Late responses are ignored. Revocation takes effect on the next protected request; there is no push revocation channel.

Successful protected fetch persists F039's minimal `service_request_contact_viewed` security audit before disclosure. Audit failure fails closed. The record contains request/Organization/actor/time; metadata contains only policy `F039`, action `contact_viewed` and correlation ID. It contains no contact values, field-presence details, description or narratives. List/detail/history do not create contact-view audits. No-contact is distinct from Protected. Contact read does not authorize editing, search, export or communication.

| Data                                                            | Authorized staff                            | Resident/public response                                                         |
| --------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| Reference and status                                            | Existing safe projection                    | Normal creation receipt only; no new resident status/history route               |
| Issue and service location                                      | Scoped operational projection               | Existing intake/catalog behavior unchanged                                       |
| Assignment, watchers, routing history                           | Scoped staff projection                     | Not exposed                                                                      |
| Operational Activity, staff actor, Hold/Close/Reopen narratives | Scoped staff projection                     | Not exposed                                                                      |
| Requester name/email                                            | Separate contact permission and parent read | Existing requester input behavior unchanged; never copied into staff list/detail |
| Contact-view audit                                              | Backend security audit only                 | Not exposed in either operational timeline or resident response                  |

The existing unauthenticated request creation response contains only ID, reference, status and creation timestamp. Legacy request GET endpoints remain staff guarded. F040 does not invent a resident history surface to demonstrate privacy.

F038 Issue-first hierarchy is preserved: configured Issue icon/name dominates; audience and lifecycle status are distinct text badges; location is operational context; reference is secondary. AudienceBadge uses independent semantic light/dark tokens rather than client brand or lifecycle colors. Audience and intake channel remain separate. F029 resident intake enforces PUBLIC/WEB. Its authenticated staff path independently accepts PUBLIC or INTERNAL with WEB, PHONE, WALK_IN, STAFF or API channels; INTERNAL additionally requires its intake permission, identified staff requester and no resident contact. F040 presents the persisted combination and introduces no new intake combinations.

Responsive selects retain accessible labels and URL state. Shared layout, actions, dialogs, ownership pickers, Activity and contact states are reused. Browser checks must cover 1440, 1280, 1024, 768 and 390px in light/dark themes with keyboard/focus and overflow observations. Automated React rendering is not live browser UAT or WCAG certification.

## Migration and performance

`20260920020000-enable-public-staff-operations` permits PUBLIC routing overrides under the existing Organization/scope foreign keys and registers only the two new keys. It grants nothing, changes no contact/request/reference/activity/ownership data, and fabricates no history. Existing requests keep their audience, route, owner, watchers and history. Rollback refuses dependent PUBLIC routing, route/watcher history or grants for either new key. Unused forward/rollback/reapply is tested in disposable schemas.

The list executes one bounded projection and one matching count query. Catalog/scope joins and correlated assignment/location projections run inside SQL; there are no application-level per-row fetches, contact joins or Activity joins. Ownership/member views use correlated EXISTS predicates. Detail, Activity, Contact and eligible targets remain separate scoped reads. Contact requires no identity-provider lookup.

Existing indexes cover Organization/created time, Organization/status/created time, reference uniqueness, request/catalog keys, current assignment by STAFF/ROLE/GROUP, watchers and active operational membership. No speculative index is added. Effective routed/catalog scope expressions, offset paging, exact counts and correlated target projections warrant real-volume measurement before production-scale claims; the local synthetic suite does not establish production throughput.

## Development runbook

Use the [F036 safe provisioning runbook](F036-safe-development-staff-authorization-provisioning.md), normal personal Entra authentication and only the existing fictional Organization/scopes. No browser code may grant permissions. Keep identity and database configuration in ignored operator files. Migration/provisioning require verified development profile, `localhost:5432`, `reqro_dev`, `reqro_dev_user`; never use reqro_test for live UAT.

1. Complete automated checks and record safe existing fixture/configuration/grant hashes. Verify starting 18 applied migrations and the seven retained F039 permissions, with PUBLIC keys absent.
2. Safely apply the F040 migration, verify 19 applied/zero pending and unchanged data/grants. Restart normal API/frontend with F040 code.
3. Manual State A: All/Internal show authorized INTERNAL; Public is empty and PUBLIC direct detail/contact denied. Retained contact.read does not recover PUBLIC access.
4. Dry run then explicitly grant only `service_request.view`. Verify PUBLIC detail succeeds, mutations remain denied by API as well as controls.
5. Dry run then explicitly grant the other eight approved PUBLIC keys. Verify mixed list/detail, all audience and operational filters, lifecycle, routing, targets, watchers and persisted history through normal APIs/UI.
6. Preserve SR-202609-000005/000006 privacy fixtures. Both had name/email at the initial F040 inspection; neither should be assumed to be a no-contact fixture. Use a new clearly fictional PUBLIC request through normal F029 creation for operational mutations. Keep existing INTERNAL and historical references intact unless a documented UAT operation intentionally changes them.
7. Verify populated F039 contact on SR-202609-000006; revoke only contact.read, confirm both audience details remain and contact clears/becomes Protected, then restore. Verify separate safe audit/log metadata without printing contact.
8. Revoke only PUBLIC view, confirm All becomes INTERNAL-only and PUBLIC contact remains denied, then restore. Safely test INTERNAL-read revocation if practical; otherwise cite automated coverage explicitly.
9. Verify resident response privacy, deep links/refresh, all responsive/theme/keyboard cases, and intentional final fixture state. Retain exactly the approved sixteen permissions and existing scopes; geospatial remains ungranted.
10. Remove temporary UAT helpers/logs/previews, run final checks, record actual results, and commit only F040. No push/deploy, remote/client changes or F041 work.

Browser automation previously could not enforce Chrome URL safety. Manual browser coordination remains the UAT method; do not work around that restriction or request tokens, authentication headers, contact response bodies or HAR files. Actual observations and database readback are recorded in the linked validation record; the runbook does not substitute expected results for evidence.

## Deferred work

F041 Internal Notes remains planned only. Resident-visible staff history, communications, notifications, contact editing/search/export, bulk operations, priority/SLA/escalation, automatic assignment, production Role/Team administration, directory synchronization, work orders, integrations and AI are outside F040. Existing retention and client-neutral development isolation remain unchanged.
