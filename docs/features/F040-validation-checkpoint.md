# F040 — Validation record

Status: automated checks passed, personal migration applied, and manual authenticated audience/read-operation separation, PUBLIC lifecycle, routing, assignment, watcher, contact revocation/restoration, both audience-read revocations and final composed-filter/deep-link checks passed. Responsive/theme/keyboard checks passed, including authorized and Protected states. All sixteen approved permissions are explicitly restored and retained. This durable validation record supports the [implementation report](F040-implementation-report.md); stage-by-stage observations below preserve what was known at each checkpoint.

## Repository and approved scope

Starting HEAD: `ebe473bea8c23135538d33932baaf547f1983161`, branch main, 21 commits ahead of origin/main before F040. Origin remains `6eb836892089bde09ab4255e9f6871a304065fca`. Final commit identity/status is supplied in the completion message. Work is limited to F040; no push, deployment, remote/cloud/client change or F041 work.

The operator approved the nine granular PUBLIC keys and retention in the existing fictional scopes. FULL_UAT_OPERATOR expands from seven to sixteen individual keys only as provisioning shorthand. The code change did not reprovision the personal principal. See the [feature specification](F040-public-service-request-staff-workspace.md) and [approved permission review](F040-public-staff-workspace-design-review.md).

## Automated checks

| Check                               | Current result                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Backend unit                        | 185 passed, zero failures/skips                                                                               |
| API E2E                             | 36 passed, zero failures/skips                                                                                |
| PostgreSQL integration              | 135 passed, zero failures/skips, disposable schemas in reqro_test                                             |
| F040-specific PostgreSQL            | 20 shared workspace cases plus one F036 sixteen-key bundle case included above                                |
| Shared JavaScript                   | 62 passed                                                                                                     |
| React                               | 288 passed across 24 files                                                                                    |
| TypeScript                          | Test compilation and backend no-emit check passed                                                             |
| Backend lint                        | Passed                                                                                                        |
| Frontend lint/typecheck             | No independent frontend lint/TypeScript script is configured; React tests and Vite build passed               |
| Formatting                          | Backend-wide check and changed React/documentation checks passed                                              |
| Production builds                   | Backend and frontend passed                                                                                   |
| Git whitespace                      | Passed                                                                                                        |
| Private configuration/secret review | Zero personal/private values, new credential URLs, private keys or JWT-like values found in changed/new files |

The five F040 unit cases cover explicit Entra union admission, malformed/ambiguous annotations, independent read policies and granular capabilities. The PostgreSQL suite covers secure All and counts/paging; audience/Organization/scope IDOR; legacy route substitution; PUBLIC lifecycle/revisions; scoped routing; STAFF/ROLE/Team assignment; direct/role/team Watching; mixed operational views; permission-specific pickers; independent contact access; targeted read revocation; concurrent assignments/watchers; migration forward/rollback/reapply; required-event failure rollback; append-only history; and resident-response privacy. Existing F029–F039 assertions remain in the passing regression suite.

F036's added integration case proves the approved sixteen-key bundle performs zero dry-run writes, provisions idempotently under concurrency, resolves through normal RBAC, and deprovisions only its own keys while preserving an unrelated geospatial grant, principal, requests and history in the disposable fixture. That unrelated synthetic fixture grant is not the personal-development grant state.

Initial execution issues were resolved without weakening assertions: running database tests from the compiled test subdirectory inherited an incomplete local identity environment; rerunning from the documented server context passed. The existing MapPreview test once observed its asynchronously created map before initialization; unchanged isolated and full React reruns passed. Under overlapping validation load, a backend logging-sanitization subprocess hit its existing timeout; the full unit suite passed with test concurrency one. These are recorded as validation-environment/timing limitations, not hidden skips.

Existing frontend warning: chunks exceed 500 kB after minification. This run also reported Vite worker/CSS plugin timing diagnostics. No dependency upgrades or unrelated bundling changes were made.

## Personal migration and integrity

Target reconfirmed immediately before application: development profile, localhost:5432, reqro_dev, reqro_dev_user, actual loopback server address. Eighteen migrations were applied before F040. Migration `20260920020000-enable-public-staff-operations` applied successfully; now **19 applied, zero pending**.

The local tsx wrapper failed before opening the migration with Windows `uv_os_get_passwd` ENOMEM. The already compiled, tested version of the same repository migration CLI succeeded under the installed Node runtime. No migration code or safety policy was weakened. Migration adds only the two registered permissions and PUBLIC routing allowance; it adds no grants.

Before/after hashes and counts matched for all fifteen compared tables: requests, structured contact, operational Activity, assignments, watchers, security audit, role grants, staff role/scope memberships, Issue definitions/versions, Organization, reference configuration and reference sequence. These include all six pre-existing request records and their associated contact/ownership/operational history.

Per-request hashes combine complete request, contact, assignment, watcher and operational-history rows; protected values remain undisclosed:

| Existing reference  | Pre/post migration SHA-256                                         |
| ------------------- | ------------------------------------------------------------------ |
| DEV-202609-00000003 | `8ecad17442942fd1d89a302e781ac8a17585c63b5bd6ce935bf45617efe8db04` |
| SR-202609-000001    | `7675b9c91f102e952f99090141e64bd1ac6beccc782d2e120d2b34aa154f7793` |
| SR-202609-000002    | `a39772a50891ebca25daa26f2c702074fd537395b4e52a5796862bd32cc80a6c` |
| SR-202609-000004    | `3db151327f4771e95d68143c6021d73577a7d8d24dfedc2dab482dc4bd5b8547` |
| SR-202609-000005    | `130aa4364b4299147f9a586863a8a44fbe179f10557b6fcf6272763451d8d42a` |
| SR-202609-000006    | `50d017222ada117cfa1c725aa10b93b31b92e6d591262f27b8220baedd0a92b2` |

| Fixture             | Classification   | State at baseline    | Scope                      | Operational history / current ownership |
| ------------------- | ---------------- | -------------------- | -------------------------- | --------------------------------------- |
| DEV-202609-00000003 | INTERNAL / STAFF | On Hold, revision 24 | Community Services / Parks | 25 events; one assignment; two watchers |
| SR-202609-000005    | PUBLIC / PHONE   | Open, revision 1     | Public Works, no Division  | One event; unassigned; zero watchers    |
| SR-202609-000006    | PUBLIC / PHONE   | Open, revision 1     | Public Works, no Division  | One event; unassigned; zero watchers    |

Both PUBLIC privacy fixtures have structured name/email. Neither is a no-contact fixture. No values were printed or changed. The INTERNAL request has no structured contact. SR-202609-000001/000002/000004 also remain unchanged. The subsequently created F040 operational fixture is recorded below.

## Current personal grants and next manual phase

Safe principal reference: development-principal-…6f6d34. Organization: CityVUE Development Municipality. Existing approved scopes: Public Works / Streets and Community Services / Parks.

The seven retained F039 permissions remain:

- `catalog.issue_action.manage`
- `service_request.contact.read`
- `service_request.create`
- `service_request.create_internal`
- `service_request.internal.read`
- `service_request.internal.update`
- `service_request.reference.manage`

After the operator's successful State A observation and explicit instruction to proceed, F036 initially provisioned only `service_request.view`, producing eight permissions for the read-only stage. After that stage passed, F036 explicitly added the remaining eight approved PUBLIC operation keys:

- `service_request.start_work`
- `service_request.hold`
- `service_request.resume`
- `service_request.close`
- `service_request.reopen`
- `service_request.assign`
- `service_request.route`
- `service_request.watchers.manage`

The selected principal now has sixteen permissions. Geospatial remains ungranted. Immediately after provisioning, existing grants, scope memberships and all six original request/contact/ownership/history hashes remained intact; only the expected role-permission table changed among the compared data tables. Later intentional UAT mutations are recorded below.

Frontend localhost:5173 and API localhost:3000 respond. The unified staff API returns 401 without credentials, demonstrating registered protected route admission; this is not proof of live authenticated authorization. Normal API watch mode recompiles/restarts after successful changes. Browser automation is not being used because of the prior Chrome URL safety limitation.

State A passed through the operator's normal Chrome session: All/Internal showed authorized INTERNAL requests, Public showed no matching requests, the PUBLIC deep link was unavailable without contact, and the INTERNAL deep link loaded normally. This is operator-reported live evidence, not automated browser inspection.

Before provisioning, the F036 CLI reconfirmed development profile, exact local database/role, selected redacted principal and the two existing fictional scopes. A `service_request.view`-only dry run reported exactly that missing key; subsequent read-only hashes matched. Explicit confirmation then added that one key. A repeat dry run reports it already present with zero pending permission changes. The existing compiled F036 CLI was used with process-local permission selection, leaving ignored operator configuration unchanged.

The PUBLIC read-only stage passed through the operator's normal Chrome session: mixed PUBLIC/INTERNAL results appeared in All, Public/Internal filters worked, and PUBLIC detail loaded with Start Work, Close and Route unavailable. The operator also ran the normal API-client probe: its authenticated PUBLIC detail read succeeded, followed by HTTP 403 for the workflow request while the PUBLIC resume key was absent. The probe attempted Resume against the verified Open fixture with its current revision, so it could not produce a valid state transition even if a permission differed unexpectedly. No request mutation occurred; all original record hashes still match. This establishes live read/operation separation, not a positive workflow result.

Before adding the eight operation keys, the same F036 CLI reconfirmed development profile, localhost:5432 / reqro_dev / reqro_dev_user, the selected redacted principal and the two existing fictional scopes. The dry run proposed exactly those eight keys; all fifteen compared table hashes and all six record hashes remained unchanged. Explicit confirmation added exactly eight keys and removed none. A repeat dry run found all eight already present and proposed zero changes. Read-only database verification found the expected sixteen-key set, unchanged scope memberships and original records, and 19 applied migrations with zero pending. No operator configuration was modified.

The operator subsequently reported a pass for the normal PUBLIC detail refresh: Start Work, Close Request, Route Request, Assign Request and Add Watcher were available; explicit View requester contact displayed the fictional name/email; normal detail remained accessible without re-login. This verifies the positive controls/contact stage through manual Chrome observations. It is not yet a completed lifecycle test.

Read-only database inspection found a new `service_request_contact_viewed` security-audit record for SR-202609-000006 at 2026-09-21T01:07:22.777Z. The trusted actor matched the selected principal, Organization and request matched, actor type was staff and actor reference was null. Metadata contained exactly `action`, `correlationId` and `policy`, with the expected contact-view action, F039 policy and a correlation identifier. No contact values, request description or narrative were present. No contact-view event was present in operational Activity. Live application-log correlation has not yet been completed for F040.

The same inspection also found a new STAFF assignment on SR-202609-000006, with a `request_assigned` event at 2026-09-21T01:08:53.731Z. The operator confirmed that they completed this assignment during the check. This is an intentional live PUBLIC assignment result, not an unexplained integrity change. It remains Open in Public Works with no Division, now revision 2, two operational events, one assignment and zero watchers. Its structured contact hash is unchanged; the other five original request/contact/ownership/history hashes still match. No history was removed or rewritten to restore the prior hash.

The operator created SR-202609-000007 through the existing Report an Issue resident form for Damaged Street Sign, using the supplied fictional description/location and anonymous reporting. Initial read-only PostgreSQL verification found PUBLIC / WEB, Open, revision 1, Public Works with no Division, one creation event, no current assignment, zero watchers and no structured name/email. This is the dedicated F040 operational and PUBLIC no-contact fixture. The personal database still has nineteen applied migrations, zero pending and the same sixteen explicitly provisioned permissions.

The operator reported that the normal staff detail showed the authorized no-contact message and that Start Work, Hold and Resume passed with browser refreshes and persisted Activity. PostgreSQL readback found the actual sequence below. Two Hold/Resume cycles were performed, so the final revision at this stage is 6, rather than the planned revision 4. Both Hold narratives are present; the second exactly matches the supplied fictional training-inspection reason. The first uses different text, which is not reproduced here. Each staff event resolves to the selected development principal; creation retains anonymous-resident attribution.

| Revision | Persisted event   | State after event |
| -------- | ----------------- | ----------------- |
| 1        | `request_created` | Open              |
| 2        | `work_started`    | In Progress       |
| 3        | `placed_on_hold`  | On Hold           |
| 4        | `work_resumed`    | In Progress       |
| 5        | `placed_on_hold`  | On Hold           |
| 6        | `work_resumed`    | In Progress       |

At the end of that stage the request remained in Public Works with no Division, unassigned and unwatched, with six operational events and no structured contact. All six other request/contact/ownership/history hashes matched the previous checkpoint, including the intentional revision-2 assignment on SR-202609-000006. No permissions changed.

The operator subsequently reported a pass for routing, Close and Reopen with a browser refresh after each action. PostgreSQL verification confirmed:

| Revision | Persisted event    | Verified result                                                                       |
| -------- | ------------------ | ------------------------------------------------------------------------------------- |
| 7        | `request_routed`   | Public Works / no Division to Community Services / Parks; status remained In Progress |
| 8        | `request_closed`   | Closed; resolution exactly matches the supplied fictional training-inspection text    |
| 9        | `request_reopened` | Open; reopen reason exactly matches the supplied fictional follow-up text             |

The Close resolution survives Reopen, both Hold narratives remain, and the route has understandable from/to scope snapshots. All eight staff events through revision 9 match the selected development principal; the separate creation event retains anonymous-resident attribution. The nine-event ordering is deterministic by revision and event index. The normal UI refresh observations and subsequent database readback establish persistence rather than frontend-only state. The other six requests and current permissions remained unchanged. At that stage SR-202609-000007 was Open, revision 9, Community Services / Parks, unassigned, with zero watchers and no structured contact.

The ownership stage used existing same-scope targets: the selected Development staff principal, operational Role `F037 Fictional Reviewer - Parks` and Team `Parks Queue`. The role and team are active and the selected development principal has active membership in each; no membership or RBAC grant was added for this stage.

The operator reported a pass for direct STAFF assignment, reassignment to ROLE and then Team, unassignment, self-watch and stop-watching, with refresh persistence and the requested list checks. Direct assignment appeared in Public + My Requests and All + My Requests. Role assignment appeared in Public/All + My Team and disappeared from My Requests; Team assignment remained in Public + My Team; unassignment removed that request from My Team. Direct self-watch appeared in Public + Watching and All + Watching; stopping self-watch removed it, with no other watchers at this stage. These are normal authenticated UI observations; unrelated authorized rows need not disappear from the same views.

Read-only PostgreSQL inspection confirmed the actual appended history:

| Revision | Persisted event      | Target change                                   |
| -------- | -------------------- | ----------------------------------------------- |
| 10       | `request_assigned`   | Unassigned to selected STAFF principal          |
| 11       | `request_reassigned` | STAFF to `F037 Fictional Reviewer - Parks` ROLE |
| 12       | `request_reassigned` | ROLE to `Parks Queue` Team                      |
| 13       | `request_unassigned` | Team to Unassigned                              |
| 14       | `watcher_added`      | Direct STAFF self-watch                         |
| 15       | `watcher_removed`    | Direct STAFF self-watch removed                 |

At the end of that stage the state was Open, revision 15, Community Services / Parks, fifteen operational events, no assignment, zero watchers and no structured contact. All six other request/contact/ownership/history hashes and the sixteen-key permission set remained unchanged.

The operator next reported that adding the Parks Role watcher made SR-202609-000007 appear in Public + Watching, and that adding the Parks Team watcher then removing the Role watcher kept it there through active Team membership. Assigning Parks Queue and routing to Public Works / Streets cleared the ineligible assignment, retained the Parks Queue watcher, kept status Open and preserved authorized Watching access after refresh.

PostgreSQL readback confirmed the next events and their safe target/scope snapshots:

| Revision | Event index | Persisted event      | Result                                               |
| -------- | ----------- | -------------------- | ---------------------------------------------------- |
| 16       | 0           | `watcher_added`      | `F037 Fictional Reviewer - Parks` ROLE added         |
| 17       | 0           | `watcher_added`      | `Parks Queue` Team added                             |
| 18       | 0           | `watcher_removed`    | Parks ROLE removed                                   |
| 19       | 0           | `request_assigned`   | `Parks Queue` Team assigned                          |
| 20       | 0           | `request_routed`     | Community Services / Parks to Public Works / Streets |
| 20       | 1           | `request_unassigned` | Ineligible `Parks Queue` assignment cleared          |

The route and assignment-clear events share revision 20 with distinct ordered event indices, consistent with the shared transactional path whose failure rollback is covered by the PostgreSQL tests. At that stage the watcher was exactly Parks Queue and the selected principal still had active Team membership; ordinary PUBLIC authorization independently permitted the Streets scope. State was Open, revision 20, Public Works / Streets, unassigned, one watcher and twenty-one operational events. All six other requests and the sixteen-key grant set remained unchanged.

The operator next reported a pass for assigning Development staff in Streets, routing back to Parks with that assignment preserved, removing the Team watcher, reassigning to Parks Queue and adding the Parks Role watcher. Refreshes preserved the changes, and Public + My Team and Public + Watching both included the request. PostgreSQL confirmed the following appended events:

| Revision | Persisted event      | Result                                                                                      |
| -------- | -------------------- | ------------------------------------------------------------------------------------------- |
| 21       | `request_assigned`   | Development STAFF assigned in Streets                                                       |
| 22       | `request_routed`     | Public Works / Streets to Community Services / Parks; STAFF retained, no unassignment event |
| 23       | `watcher_removed`    | `Parks Queue` Team watcher removed                                                          |
| 24       | `request_reassigned` | STAFF to `Parks Queue` Team                                                                 |
| 25       | `watcher_added`      | `F037 Fictional Reviewer - Parks` ROLE watcher added                                        |

The deliberate operational-fixture state is now Open, revision 25, Community Services / Parks, assigned to Parks Queue, with exactly one watcher (F037 Fictional Reviewer - Parks), twenty-six operational events and no structured contact. The event count exceeds revision by one because revision 20 correctly contains both routing and automatic unassignment. Other request records are unchanged from the preceding checkpoint.

## Contact revocation and restoration

With all sixteen approved permissions present, F036 dry-run deprovisioning selected only `service_request.contact.read`. The tool reconfirmed the development profile, localhost:5432 / reqro_dev / reqro_dev_user, selected redacted principal and existing scopes. All compared hashes remained unchanged after the dry run. Explicit confirmation removed exactly that one key. Read-only verification found the other fifteen permissions unchanged, all seven request/contact/ownership/history hashes unchanged, and only the role-permission table changed among the compared tables. Request read and operation permissions remained intact. No operator configuration was changed.

The operator confirmed that both the populated PUBLIC fixture and the existing INTERNAL detail remained accessible, their operation controls remained available, and Requester Contact showed Protected without contact values after refresh. The manual Chrome probe used the normal application API client and reported `PUBLIC detail: allowed; contact: HTTP 403`. This is direct endpoint denial alongside the UI result, without sharing contact response bodies, tokens or authentication headers. No re-login was requested for the stage.

F036 then dry-ran and explicitly restored only `service_request.contact.read` against the same verified local target and existing principal/scopes. The dry run changed no compared table hashes; confirmation added exactly one key. PostgreSQL verification found the exact approved sixteen-key permission set restored, unchanged staff scope memberships and unchanged hashes for all seven requests with their contact/ownership/history. Operational Activity was unchanged and the security-audit row count remained 64 throughout denial/restoration, so the denied contact request created no successful contact-view event.

The operator confirmed that after refresh and explicit View requester contact, the fictional name/email appeared again on SR-202609-000006, its detail and operation controls remained available, and no re-login was needed. A new contact-view security audit at 2026-09-21T02:20:52.398Z matched the selected staff principal, Organization and request. Its metadata again contained only action, policy and correlation identifier; no contact-view event appeared in operational Activity. This completes the manual positive/revoked/restored contact proof.

## PUBLIC-read revocation and restoration

F036 selected only `service_request.view` for dry-run deprovisioning after reconfirming the development profile, localhost:5432 / reqro_dev / reqro_dev_user, selected principal and existing fictional scopes. The dry run changed no compared table hashes. Explicit confirmation removed exactly PUBLIC view. Read-only verification found the remaining fifteen permissions unchanged, including INTERNAL read, contact.read and every operation key. All seven request/contact/ownership/history hashes and scope memberships remained unchanged; only the role-permission table changed among compared data tables.

The operator confirmed that All became INTERNAL-only, Public returned no matching requests in All Requests, My Team and Watching, and INTERNAL detail remained accessible. The direct normal authenticated probe returned `PUBLIC detail: HTTP 404`, `PUBLIC contact: HTTP 403`, and `INTERNAL detail: allowed`. The PUBLIC detail probe targeted SR-202609-000007, which still has Team assignment, a Role watcher and the selected principal's active operational membership. Those relationships did not recover access. The populated contact probe targeted SR-202609-000006: retained contact.read did not bypass missing parent PUBLIC-read permission. No re-login or request mutation was required for the check.

F036 dry-ran and explicitly restored only `service_request.view`. The read-only dry run left compared hashes unchanged, and verification after the one-key restoration found the exact approved sixteen-key set and unchanged request/ownership/history and scope memberships.

## INTERNAL-read revocation and final grant restoration

After restoring PUBLIC view, F036 selected only `service_request.internal.read` for the reverse isolation test. Profile, local database identity, principal and existing scopes were reconfirmed through the same tooling. The dry run changed no compared hashes; explicit confirmation removed exactly that key. PostgreSQL verification found PUBLIC view, contact.read and all operation keys retained, all seven request/contact/ownership/history hashes unchanged, and only the expected role-permission table changed among compared tables. The personal database still has nineteen applied migrations and zero pending.

The operator reported that All contained authorized PUBLIC records only, Internal showed no matches including My Team/Watching, and PUBLIC detail/contact remained available without re-login. The direct normal authenticated probe returned `PUBLIC detail: allowed`, `PUBLIC contact: allowed`, `INTERNAL detail: HTTP 404`, and `INTERNAL contact: HTTP 403`. Retained internal.update and contact.read did not bypass the missing INTERNAL parent-read permission. This also provides a live positive PUBLIC result after PUBLIC-view restoration.

F036 then dry-ran and explicitly restored only `service_request.internal.read`. The verified local target and existing scopes were unchanged; the dry run performed zero compared writes. Database readback found exactly the approved sixteen-key set restored, unchanged scope memberships and unchanged hashes for all seven request/contact/ownership/history records. Development grants are retained for future UAT.

## Final composed filters and restored deep link

The operator confirmed the final manual checks passed after restoration: All + All Requests included authorized PUBLIC and INTERNAL records; complete-reference search for SR-202609-000007 returned that request alone; Public + Open returned PUBLIC Open records; Internal + Open was empty; Internal + On Hold returned DEV-202609-00000003; and All + Community Services / Parks returned that INTERNAL record with SR-202609-000007. The INTERNAL deep link loaded normally again. No structured requester contact appeared in the list. These checks used the normal authenticated workspace with URL filter state and no request mutation.

The five authorized development records fit on one default 25-row page. Correct mixed-audience multi-page ordering/counts and operational-filter pagination are proved by PostgreSQL tests; a multi-page live UI dataset was not fabricated solely for this check.

## Resident privacy and query review

After the PUBLIC operational fixture reached its deliberate revision-25 state, unauthenticated requests to both legacy PUBLIC list/detail and unified staff list/detail returned HTTP 401 from the running local API. The inspected detail was SR-202609-000007. No response body was printed. The existing resident surface remains anonymous creation with a receipt containing only ID, reference, initial status and creation timestamp; no new resident status/history route exists. The PostgreSQL HTTP regression checks the exact receipt field allowlist and excludes contact, assignment/watchers, staff Activity, actor identity and narratives. Live creation used the existing resident form, and these subsequent unauthenticated denials show that staff mutations did not make the operational record publicly readable.

The F040 PostgreSQL privacy case verifies that normal list/detail/history do not create contact-view audits, that a successful protected fetch creates exactly one safe audit with no-store, that operational history is unchanged by contact reads, and that captured application logs omit the fictional contact values. Live audit metadata inspection corroborates actor/Organization/request/correlation context without contact values. No new personal API capture log was created; F040 live application-log correlation is not claimed separately from that automated log-sanitization evidence.

## Responsive and accessibility observations

The operator confirmed all ten authorized-state combinations passed: widths 1440, 1280, 1024, 768 and 390px in both light and dark themes. The manual Chrome review covered mixed list; populated PUBLIC SR-202609-000006 after explicit contact fetch; no-contact PUBLIC SR-202609-000007; and INTERNAL DEV-202609-00000003. Navigation, audience/view/status/scope filters, Issue-first layout, audience/status text, wrapping, contact, assignment/watchers, Actions and Activity passed without ordinary horizontal overflow. These are operator observations, not automated viewport inspection.

The operator also confirmed Tab/Shift+Tab, Enter/Space, visible focus, readable labels and reading order. Close, routing, assignment and watcher forms were opened then cancelled without submitting. Focus restoration, list/detail links, Activity pagination where available and mobile navigation passed. Audience and status remain textual, not color-only. This validation is not a WCAG certification.

For the last Protected-state visual check, F036 again dry-ran and explicitly removed only contact.read. The dry run changed no compared data; confirmation changed only role-permission rows. The other fifteen grants and all seven request/contact/ownership/history hashes remained unchanged. The operator confirmed the PUBLIC and INTERNAL Protected cards passed at 1440, 1280, 1024, 768 and 390px in light/dark themes: no stale contact, readable Protected text/lock meaning, visible focus, no ordinary horizontal overflow and normal detail/actions still available.

F036 then dry-ran and explicitly restored only contact.read. The dry run changed no compared hashes. Final database readback resolved the exact approved sixteen permissions through the existing RBAC tables, with unchanged scope memberships and all seven request/contact/ownership/history hashes. Only the expected role-permission rows changed. A repeat provision dry run found contact.read already present and proposed zero changes. The final migration state is nineteen applied, zero pending. Original structured contact, F032 Issue configuration and F033 reference configuration hashes still match the starting baseline. SR-202609-000001, SR-202609-000002, SR-202609-000004, SR-202609-000005 and DEV-202609-00000003 remain unchanged; SR-202609-000006 retains the operator-confirmed assignment, and SR-202609-000007 retains its deliberate revision-25 state.

No temporary preview, browser harness or capture log was created for F040. Operator-owned environment files remain ignored. Final documentation formatting, Git whitespace and private-value checks pass. The scan found zero personal/private values, credentials, added credential URLs, private keys or JWT-like values in changed/new files. Two pre-existing synthetic test connection-string matches were reviewed and left unchanged. No application code changed during the manual UAT/documentation phase, so the recorded full automated suites/builds remain applicable. No tests or assertions were weakened.
