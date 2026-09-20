# F037 — Assignment, Ownership & Watchers Foundation

Implemented and validated from F036 `d6b13516d498efe1f3a8920b71bee3264daade68`. Personal database migration and authenticated live UAT completed on September 20, 2026. No deployment or F038 work is included.

## Boundaries and target model

Routing selects the Department/Division responsible for work. Assignment selects one primary operational owner. Watching records an explicit following relationship. These remain separate; changing assignment never changes routing and assignment never automatically creates a watcher.

ASSIGNMENT IS OWNERSHIP, NOT AUTHORIZATION.

WATCHING IS FOLLOWING, NOT AUTHORIZATION.

OPERATIONAL ROLE/TEAM MEMBERSHIP DOES NOT GRANT RBAC PERMISSIONS.

DISTRIBUTION LISTS ARE NOT ASSIGNMENT OR WATCHER TARGETS IN F037.

The API uses repository-style lowercase `staff`, `role`, and `group`. STAFF references an existing internal StaffIdentity UUID, never email, name, Entra object ID or tenant ID. ROLE references the new `operational_role`, deliberately separate from the existing RBAC `role`. GROUP reuses F017's actual `work_group` and `work_group_membership`, not service-catalog grouping. The UI calls groups Teams. Operational roles and teams have Organization-owned Department/optional Division scope, active status and names limited to 200 characters. Memberships are explicit, active, Organization-constrained relationships; they do not inherit permissions. No production membership/role/team administration or directory synchronization is added.

## Eligibility and authorization

All reads retain normal Entra authentication, database-resolved INTERNAL read permission, trusted Organization and effective Department/Division scope. Assignment, unassignment, target discovery and managing other watchers require `service_request.internal.update`. No new permissions or default grants are introduced. Update does not imply read.

A normally authorized reader can watch or stop watching themselves using dedicated endpoints that accept only expectedRevision. The server resolves the principal; the browser cannot supply another identity to those endpoints. Managing someone else's relationship requires update permission.

Targets must be active, same-Organization, and valid in the request's current active Department/Division. STAFF additionally requires independent current `internal.read` RBAC, Department membership and the applicable Division membership. A department-only request requires Department membership; a Division request requires both. Teams/operational roles must own the same Department; null target Division covers that Department, while a specific Division must match. Role/team membership never grants a member read access: normal request admission is still required. Empty teams can represent operational responsibility, but cannot give anyone access.

Mutation revalidates the target after locking the request and backing target; appearing in a picker is not proof of continued eligibility. Missing, foreign, inactive and ineligible targets fail safely. Existing inactive targets remain visible with an inactive label, pending explicit reassignment/removal. There is no automatic offboarding. Historical display snapshots are immutable after rename/deactivation. Existing watcher removal remains possible after the target becomes inactive or ineligible, subject to the operator's current request authorization.

Explicit assignee/watcher overlap is permitted as two independent operator choices. This preserves an intentional following relationship through later reassignment and supports self-watch independently of ownership. Neither relationship is created implicitly and neither sends notifications.

## Persistence and transaction model

Migration `20260920000000-add-assignment-watchers` adds operational roles/memberships and `service_request_watcher`. It extends F017 `service_request_assignment` with a role FK and normal staff actor support. Existing Department/individual/group/unassigned historical F017 semantics are retained for the existing PUBLIC development foundation; the F037 API accepts only STAFF/ROLE/GROUP and explicit unassignment. A missing current row means Unassigned. Existing authoritative F017 rows are preserved rather than fabricated or rewritten; the verified personal database had no assignment rows before F037.

Composite foreign keys constrain every target, member, actor and request to the same Organization. Separate nullable target FKs plus exactly-one-target CHECK constraints prevent type/ID mismatches. The existing partial unique current-assignment index prevents multiple primary owners. Watchers have per-target partial unique indexes and a normalized request relation. Application mutations serialize on the parent request; a bounded maximum of 100 current watchers keeps detail retrieval finite. Target search returns at most 25 entries and accepts at most 100 plain-text search characters. SQL parameters and escaped LIKE metacharacters prevent query injection and unintended wildcard directory searches.

Assignment changes end the previous row and insert the new owner where applicable. Explicit unassignment ends the current row. All assignment/watch changes increment the existing request revision, update its timestamp and append operational history plus safe metadata-only audit in the same transaction. Repeated/no-op assignment, duplicate watcher and already-removed watcher return 409 without revision/history changes. Concurrent identical commands from one revision produce one success and one conflict. Failed authorization, validation, stale revisions or event writes cannot leave partial changes.

Routing retains an eligible assignment. Otherwise it atomically ends the assignment and appends both `request_routed` and `request_unassigned` under the single resulting revision. F035's previous one-event-per-revision constraint becomes one event per revision/slot: slot zero remains the normal command event; slot one is permitted only for unassignment, with a deferred database constraint requiring a matching routing event and staff actor. Existing events retain slot zero and their original meaning. UPDATE/DELETE/TRUNCATE activity protections remain intact. Watchers survive routing as explicit relationships, but scope loss immediately prevents subsequent reads and excludes the request from Watching.

The migration creates no roles, groups, memberships, assignments, watchers or fabricated activity. It leaves requests, references, routing, Issue configuration, reference policies and RBAC data unchanged. Empty-state rollback/reapply is supported. Rollback refuses after operational role/state/history becomes meaningful. Personal operational history must never be destructively rolled back for cleanup.

## API and privacy

All paths below are under `/api/v1/staff/internal-service-requests/:id`, return `Cache-Control: no-store`, and independently enforce permission and request scope:

| Operation          | Endpoint                                       | Input / permission                                      |
| ------------------ | ---------------------------------------------- | ------------------------------------------------------- |
| Eligible targets   | GET `assignment-targets?type=staff&search=...` | internal.update; bounded current-scope search           |
| Assign/reassign    | POST `assignment`                              | expectedRevision, targetType, targetId; internal.update |
| Unassign           | POST `assignment/remove`                       | expectedRevision; internal.update                       |
| Watcher list       | GET `watchers`                                 | internal.read                                           |
| Add watcher        | POST `watchers`                                | expectedRevision, targetType, targetId; internal.update |
| Remove watcher     | POST `watchers/remove`                         | same explicit target contract; internal.update          |
| Watch self         | POST `watch-self`                              | expectedRevision; internal.read                         |
| Stop watching self | POST `unwatch-self`                            | expectedRevision; internal.read                         |

Target discovery exposes only `{type,id,displayName}`. Current assignment/watch projections additionally report active status; watchers report whether the trusted caller is directly watching. No email, tenant/object ID, token claims, RBAC permissions, membership inventory or unrelated directory data is returned. Staff display names resembling emails, UUIDs or containing control characters fall back to Staff member. Multiple ambiguous safe names may require a future approved display-name administration policy. Historical snapshots store only safe target type/name, not identity-provider identifiers.

Structured resident contact remains omitted. Request descriptions and target names are untrusted plain text rendered through React escaping, never HTML or automatic links. There is no PUBLIC workspace expansion, resident assignment/watch visibility, activity editing/deletion/creation API, notification delivery, analytics or external integration.

## Views and workspace

OPERATIONAL VIEW FILTERS NARROW AUTHORIZED RESULTS. THEY DO NOT EXPAND AUTHORIZATION.

The existing list endpoint adds a validated `view` allowlist:

| View                  | Server-resolved relationship, always inside normal INTERNAL authorization     |
| --------------------- | ----------------------------------------------------------------------------- |
| `all` / All Requests  | Existing authorized collection                                                |
| `mine` / My Requests  | Current direct STAFF assignment to the trusted caller only                    |
| `team` / My Team      | Current ROLE/GROUP assignment with active caller membership and active target |
| `watching` / Watching | Direct STAFF watcher, or active membership in an active ROLE/GROUP watcher    |

All compose with reference, status, Department/Division, ordering, scoped counts and pagination. No browser principal/membership claims are accepted. The view select resets pagination and preserves non-sensitive filters through detail links/back navigation. References remain opaque persisted display identifiers. No fixed-format parsing or access by reference possession is introduced.

Detail presents assignment and watchers separately from workflow and routing. Updaters get scoped target pickers, explicit Search, Assign/Change/Unassign, Add/Remove Watcher; readers get self-watch convenience only. Pickers provide loading, no-result and error states, semantic labeled native controls, Escape/Cancel and focus restoration. Mutation controls disable during a pending request, and success/conflict refreshes authoritative state and activity. Authorization failures clear protected detail. Watcher-specific service failures have retry without discarding otherwise-authorized detail.

F035 timeline adds `request_assigned`, `request_reassigned`, `request_unassigned`, `watcher_added`, `watcher_removed`. Previous/from and new/to names are captured transactionally, preserving historical meaning after target renaming. Events use existing newest-first timestamp/ID ordering and bounded activity pagination. There is no competing assignment-history screen. Light/dark theme foundations and responsive wrapping are reused; visual/keyboard UAT is reported separately from automated tests and is not WCAG certification.

## Explicit development setup

F036 now provides `npm run dev:staff:setup-operations -- --dry-run` or `--confirm` from `server`, with the same ignored local environment-loading approach as its runbook. The standalone CLI requires explicit development profile, personal-tenant confirmation, verified loopback `localhost:5432 / reqro_dev / reqro_dev_user`, selected existing principal and selected already-provisioned fictional scopes. It has no runtime HTTP entry point and is not invoked by startup, sign-in or migrations.

For each selected scope it creates/reuses a clearly labeled fictional reviewer role and reuses a compatible existing work group where possible. It adds only missing operational memberships; inactive or incompatible existing records fail closed. Organization locking serializes concurrent setup; dry run performs no writes; failures roll back the transaction. It never adds RBAC or Department/Division grants, creates identities, or changes requests. Repeated execution is idempotent. Synthetic targets/memberships may be deliberately retained for future UAT; there is no broad cleanup command that might destroy another workflow's membership or operational history. F036 grant deprovisioning remains unchanged and targeted.

## Performance, evidence and deferred work

Current owner projection uses indexed current-assignment lookup. View filtering uses SQL EXISTS against scoped relationship/membership indexes before pagination; no client-side protected-data filtering is used. Target discovery is bounded and Organization/current-scope constrained; current watcher retrieval is bounded to 100 and uses one joined query. No per-row application directory/member queries are introduced. Name substring search may still need further measured indexing at large tenant volumes; no speculative search infrastructure is added.

Automated coverage includes real PostgreSQL/Nest guards and database authorization with isolated fictional token-verifier fixtures, migration round-trip, foreign keys/type integrity, one owner, duplicate watchers, all target types, stale/concurrent commands, self-watch vs managing others, membership without RBAC, scope loss after routing, current inactive targets, immutable snapshots, failure injection for both routing events, and append-only/history rollback protections. React tests cover escaped target names, picker state/search/cancel/focus, assignment for all types, watcher management, self-watch readers, double clicks, conflicts, access loss and composing operational views.

The completed validation and personal-development evidence below distinguish automated fixtures from live Entra UAT.

Deferred: notifications/preferences, automatic assignment, load balancing, directory synchronization/SCIM, production staff/role/team administration, ambiguous-name resolution policy, assignment narratives, notes, contact access, PUBLIC operations, analytics, bulk actions, workload/SLA/priority policy, and F038. Operational metadata is not a permission model, messaging system or security-audit replacement.

## Completion evidence — September 20, 2026

### Supported target matrix

| Target                               | Assignment                       | Watcher                              | Operational membership                                       |
| ------------------------------------ | -------------------------------- | ------------------------------------ | ------------------------------------------------------------ |
| STAFF                                | Yes, eligible active Reqro staff | Yes, including authorized self-watch | Independent RBAC/scope remains required                      |
| ROLE                                 | Yes, operational role            | Yes                                  | Active operational-role membership supports My Team/Watching |
| GROUP / Team                         | Yes, F017 operational work group | Yes                                  | Active work-group membership supports My Team/Watching       |
| Distribution list or arbitrary email | No                               | No                                   | Not implemented                                              |

There is no DISTRIBUTION_LIST target enum, Exchange dependency, email target or Microsoft-specific ownership model. Entra remains the established authentication adapter; ownership references canonical Reqro records.

### Automated results

| Check                                           | Result                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| Backend unit tests                              | 177 passed; includes 3 focused F037 tests                                  |
| API E2E tests                                   | 36 passed                                                                  |
| PostgreSQL integration tests                    | 93 passed, zero skipped                                                    |
| F037 PostgreSQL coverage within that total      | 14 ownership scenarios, 1 migration scenario, 1 development-setup scenario |
| Shared tests                                    | 62 passed                                                                  |
| React tests                                     | 227 passed across 21 files; includes 17 F037 cases                         |
| TypeScript                                      | Passed                                                                     |
| Backend ESLint                                  | Passed; no separate frontend lint script is configured                     |
| Formatting                                      | Backend configured check and focused changed-file checks passed            |
| Backend and frontend production builds          | Passed                                                                     |
| Git whitespace and private-configuration review | Passed                                                                     |

Tests in `server/test/database/request-ownership-checks.ts` provide the following authorization proof using normal API guards and database authorization in disposable schemas:

- **Assignment:** unauthorized, inactive, foreign, mismatched and out-of-scope STAFF targets are rejected before a relationship can confer anything. Read-only callers cannot assign. Public/cross-Organization request substitution returns 404, unauthenticated mutation returns 401, and an ungranted operational member remains denied with 403.
- **Watching:** an authorized reader can add/remove only themselves without update permission. Forged self identity is rejected. Routing outside that reader's authorized scope preserves the watcher relationship but denies subsequent request access and excludes it from the reader's view.
- **Role/team membership:** the no-grant principal is an operational member yet detail, watchers, My Team and Watching remain 403. Deactivating membership removes the corresponding My Team result. Membership does not create read or update grants.
- **Concurrency:** concurrent assignments from one revision yield one success and one conflict, one current owner and one event. Concurrent identical watcher additions yield one relationship and one event. Failed or stale commands do not change revision/history.
- **Atomicity:** injected assignment/watcher activity failures roll back state, revision and event writes. Failure of either required event during routing rolls back route, owner and revision. Foreign-key/type-shape, current-owner uniqueness, watcher uniqueness, snapshot preservation and append-only protections pass.

`server/test/database/request-audience.integration.test.ts` verifies migration apply/unused rollback/reapply and preservation. `server/test/database/development-staff.integration.test.ts` verifies zero-write dry run, unsafe inputs, transaction rollback and repeated/concurrent idempotent setup without RBAC changes. The broader suites retain F029 audience/intake checks, F030 scope isolation, F031 workflow/revision security, F032 redirect rejection, F033 reference generation and F034/F035 workspace/activity regressions. Existing Vite chunk-size and Windows line-ending warnings were retained, not suppressed.

### Personal database and explicit setup

Migration `20260920000000-add-assignment-watchers` was applied through the supported migration CLI only after automated checks, with target verified as `localhost:5432 / reqro_dev / reqro_dev_user`. Final state: **17 applied migrations, zero pending**. Rollback/reapply was tested in disposable schemas; meaningful personal history was not rolled back.

The existing three fictional requests remain. Both `SR-202609-000001` and `SR-202609-000002` match their complete pre-migration row hashes. The original nine operational events across all requests match their prior content after excluding the newly added empty snapshot columns/default slot. Issue configuration, reference configuration, RBAC permissions/assignments and Department/Division memberships match their pre-F037 hashes. No historical reference, original activity or PUBLIC request classification was rewritten.

The explicit F036 extension ran a read-only dry run followed by confirmed setup for the existing selected development principal and **CityVUE Development Municipality**:

| Authorized fictional scope | Operational role created          | Existing team reused |
| -------------------------- | --------------------------------- | -------------------- |
| Public Works / Streets     | F037 Fictional Reviewer - Streets | Streets Queue        |
| Community Services / Parks | F037 Fictional Reviewer - Parks   | Parks Queue          |

Two roles and four operational memberships were created: one role and one group membership for each scope. No new teams were needed; two existing teams were reused. Final synthetic totals are three requests, two operational roles, two teams, two role memberships and four team memberships (including two pre-existing memberships). These targets/memberships are intentionally retained for future UAT. A final setup dry run reported zero new targets, zero new memberships and no permission changes. Setup adds no permissions or Department/Division grants. The six retained F036 permission keys remain `service_request.create`, `service_request.create_internal`, `service_request.internal.read`, `service_request.internal.update`, `catalog.issue_action.manage`, and `service_request.reference.manage`. Geospatial and Environmental Services access were not added. Personal identity values are confined to ignored local configuration.

### Authenticated live UAT

All results in this subsection used the normally signed-in personal Entra session, real protected APIs and personal PostgreSQL data. No fixture/component preview, token substitution, manual SQL mutation or authorization bypass was used as live evidence.

Existing fictional INTERNAL/STAFF request **DEV-202609-00000003** was used; no new Service Request was created. Final state is **Open, revision 22, Community Services / Parks, assigned to Parks Queue**. There is one current assignment and two current watchers: Development staff (STAFF) and Parks Queue (GROUP). Its timeline contains **23 persisted events**, including the original seven F035 events. Existing Hold reason, Close resolution and Reopen reason remain unchanged.

Live assignment sequence, with routing unchanged in Parks throughout the first four actions:

1. `request_assigned`: Development staff (STAFF).
2. `request_reassigned`: STAFF to F037 Fictional Reviewer - Parks (ROLE).
3. `request_reassigned`: ROLE to Parks Queue (GROUP).
4. `request_unassigned`: Parks Queue to Unassigned.

Live watcher sequence: self added, removed and added again; role added; team added; duplicate team rejected with conflict and no extra relationship/event; role removed. The role's original `watcher_added` remains alongside `watcher_removed`, while the current set contains only STAFF and GROUP.

For routing, Parks Queue was assigned again. Routing Parks to Public Works / Streets cleared that ineligible team and produced `request_routed` plus `request_unassigned` at revision 19, slots 0 and 1. Both watchers remained. Assigning eligible Development staff in Streets and routing back to Parks preserved that STAFF assignment at revision 21, with only `request_routed`. The final explicit reassignment to Parks Queue produced revision 22. Historical team/role display snapshots remained understandable after current ownership changed.

The complete 16-event F037 addition, in chronological order, was:

```text
request_assigned
request_reassigned
request_reassigned
request_unassigned
watcher_added
watcher_removed
watcher_added
watcher_added
watcher_added
watcher_removed
request_assigned
request_routed
request_unassigned
request_assigned
request_routed
request_reassigned
```

A full document reload of the direct detail route read assignment, both watchers and all 23 events back from the authenticated API. Database verification independently confirmed the final revision, event sequence and current relationships. No temporary refresh link or UAT artifact is included in the implementation.

Live **My Requests** included direct STAFF ownership and became empty after assignment to ROLE. **My Team** included ROLE and GROUP ownership through active membership. **Watching** included the self-watched request and became empty after self-removal when no other watcher qualified. My Team composed successfully with Open + Community Services + Parks; Watching composed with those filters and the complete configurable reference. PUBLIC requests remained excluded. All Requests retained the normal authorized list. Only one INTERNAL record existed, so multi-page navigation, membership revocation and simultaneous assignment conflict are proven by automated tests rather than overstated as live UAT. The live duplicate-watcher conflict was observed directly.

### Responsive, keyboard and privacy review

The live workspace was checked at 1280, 1024, 768 and 390 pixels. DOM width checks found no horizontal page overflow in light and dark themes. Visual inspection covered ownership/watchers, picker controls and timeline wrapping, including the 390px dark picker. Target search's no-result state was exercised live. Native field labels, focus entry, Tab/Shift+Tab order, Enter activation, Space cancellation, Escape and Cancel focus restoration were checked. Viewport and light theme were restored afterward. Loading/error, authorization-clearing, rapid-click protection, safe text rendering and filtered-empty behavior are additionally covered by React tests. No full screen-reader or WCAG certification is claimed.

Eligible targets exposed only type, opaque Reqro ID and safe display name; no contact fields, emails, provider identifiers, claims or permission lists were added. No protected payload logging, narrative logging, notification delivery, analytics or external-directory access was introduced. Diff review found no personal local identity values, credentials, JWT-like values or credential-bearing connection strings. Local environment and server logs remain ignored.

Index inspection confirmed per-type current assignment indexes, the one-current-owner unique index, per-type watcher lookup/unique indexes, request watcher lookup and staff membership indexes. Queries use Organization-scoped SQL predicates/EXISTS and bounded retrieval; there is no application N+1 directory lookup. This is an indexed-query design review on small synthetic data, not a production-volume benchmark. Substring target search and safe-name ambiguity remain documented scale/product limitations.

### Changed-file inventory

- Database: the F037 migration; `server/src/database/database.types.ts`; new `development-operational-targets.ts`; existing `development-staff-cli.ts`; `server/package.json`.
- Domain/API: new `ownership-targets.ts`, `request-ownership.service.ts`, `request-ownership.controller.ts`; existing internal request repository/controller/mutation service, activity domain and service-request module.
- React: new `RequestOwnership.jsx`; workspace, activity, repository and staff CSS extensions.
- Tests: new ownership unit/helper tests; existing request-audience/activity and development-staff PostgreSQL tests; React workspace tests.
- Documentation: this feature record, F036 runbook, architecture, context and roadmap.

No production administration UI, branding migration, Distribution Lists, notifications, cloud/client changes or F038 work is included. F037 is intended for a local-only commit after final review; pushing and deployment remain outside authorization.
