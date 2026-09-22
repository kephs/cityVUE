# F036 — Safe Development Staff Authorization Provisioning

## Purpose and security boundary

F032–F035 authenticated UAT was repeatedly blocked by absent explicit personal-development staff grants. F036 adds local operator tooling using the existing F018 PostgreSQL roles, permissions and memberships. It introduces no production administration interface, migration, authentication change or React authorization logic.

DEVELOPMENT PROVISIONING CREATES REAL AUTHORIZATION DATA. IT DOES NOT BYPASS AUTHORIZATION.

AUTHENTICATION DOES NOT AUTOMATICALLY GRANT REQRO PERMISSIONS.

NO DEVELOPMENT GRANTS ARE CREATED AUTOMATICALLY DURING SIGN-IN, APPLICATION STARTUP, MIGRATION, OR DATABASE SETUP.

THE DEVELOPMENT PROVISIONING COMMAND MUST NEVER BE USED AGAINST A CLIENT OR PRODUCTION DATABASE.

## Environment and database safety

The standalone CLI requires raw explicit `NODE_ENV=development`, `CITYVUE_DEPLOYMENT_PROFILE=development`, external identity opt-in, complete existing Entra configuration, and `F036_PERSONAL_ENTRA_TENANT_ID` exactly matching `ENTRA_TENANT_ID`. Missing values cannot inherit the normal application's development defaults. Production, client, unknown and malformed profiles fail closed. Personal-tenant confirmation records the operator's explicit choice; software cannot independently prove tenant ownership. Never configure a client tenant here.

Before connecting, the CLI accepts only PostgreSQL on `localhost:5432`, database `reqro_dev`, role `reqro_dev_user`, without URL query/fragment overrides. It then verifies the actual database, role, port and loopback server address. Explicit connection fields prevent PG environment target overrides; the existing database TLS policy remains authoritative. `reqro_test`, remote hosts, alternate databases/roles and production-like targets are refused. Tests inject isolated synthetic schemas directly into the internal implementation; there is no test-mode switch in the operator CLI.

No HTTP route or application module imports provisioning. The compiled CLI may be present in backend build output but is invoked only through separate commands and retains all environment checks. Installation, startup, sign-in and migration never invoke it.

## Identity, Organization and scope

The CLI only accepts an explicitly selected existing active internal staff UUID. It resolves that row against the configured Entra tenant, non-null object ID and exact fictional Organization. It does not create or remap an unknown identity. The existing F027 mapping workflow remains available for initial personal identity mapping, using the operator's authoritative personal-tenant directory record rather than a copied JWT. No email/display-name matching, token decoding or public discovery endpoint is added.

`inspect` lists only internal staff IDs and the fictional Organization for active mappings in the configured personal tenant. It never prints Entra IDs, claims, email or tokens. Even one candidate requires explicit selection.

The existing seeded `CityVUE Development Municipality` is pinned by ID, name and slug. No new hierarchy is seeded. Explicit department/division pairs must belong to that active Organization; divisions must belong to the selected department. Department membership also permits that department's unassigned-to-division requests under the existing F030 policy. A division selection does not redefine that policy. Scope memberships are shared by the principal's existing permissions, so operators must review pre-existing grants before adding scope.

## Permissions and bundles

The development manifest accepts the sixteen explicit permissions in FULL_UAT_OPERATOR below plus optional `geospatial.read`. Unknown/typo/wildcard keys are rejected and never inserted into the permission catalog. F040's granular PUBLIC extension was explicitly approved; changing this manifest creates no stored grants.

| Bundle                    | Explicit expansion                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INTERNAL_REQUEST_READER   | service_request.internal.read                                                                                                                                                                                                                                                                                                                                                                                                                       |
| INTERNAL_REQUEST_OPERATOR | service_request.internal.read, service_request.internal.update                                                                                                                                                                                                                                                                                                                                                                                      |
| INTAKE_TESTER             | service_request.create, service_request.create_internal                                                                                                                                                                                                                                                                                                                                                                                             |
| CATALOG_ADMIN_TESTER      | catalog.issue_action.manage                                                                                                                                                                                                                                                                                                                                                                                                                         |
| REFERENCE_ADMIN_TESTER    | service_request.reference.manage                                                                                                                                                                                                                                                                                                                                                                                                                    |
| FULL_UAT_OPERATOR         | service_request.create, service_request.create_internal, service_request.internal.read, service_request.contact.read, service_request.internal.update, catalog.issue_action.manage, service_request.reference.manage, service_request.view, service_request.start_work, service_request.hold, service_request.resume, service_request.close, service_request.reopen, service_request.assign, service_request.route, service_request.watchers.manage |

Bundles exist only in the local tooling manifest. Runtime sees individual ordinary permission rows, never bundle names. Changing a bundle definition does not change existing grants. PUBLIC assisted creation uses create; INTERNAL creation additionally requires create_internal. Neither grants read/update. Catalog management remains scope-constrained; reference administration is Organization-wide. Geospatial is excluded from the comprehensive UAT bundle because normal request intake does not require its protected map-preview endpoint.

## Transactions, provenance and revocation

Each principal receives a dedicated Organization-local role named from its internal staff UUID, with individual role_permission rows and an ordinary staff_role_assignment. The role description contains version-specific F036 provenance: owned permission keys and which scope memberships were newly created or reactivated. It contains no tokens or external identity values. Existing active memberships are never claimed as owned. A shared role, inactive role or role permissions inconsistent with provenance fails closed rather than being repaired automatically.

All writes are one transaction. An Organization row lock serializes cooperating commands, including first creation. Repeated/concurrent provisioning creates no duplicate roles, assignments, permissions or memberships. Provisioning is additive; omitted permissions are not implicitly revoked. Separate deprovisioning removes only selected permissions from the dedicated F036 role. Other roles and grants remain untouched. Partial revocation retains scope for remaining F036 permissions. Removing the final F036 permission restores only owned membership changes and disables its assignment; the role/provenance remain reusable. Identity, Organization, catalog, requests and operational history are preserved.

Scope provenance cannot detect a later independent administrator's reliance on a membership originally created by F036. Review such changes before complete removal; production grant ownership/audit administration remains deferred. Foreign-key conflicts fail transactionally instead of cascading unrelated records away.

Dry runs use a PostgreSQL read-only transaction and perform the same identity, hierarchy, permission catalog and role ownership validation without writes. They report the selected scopes/permissions and which F036 permission rows would change. They do not reserve a role or grant. Another explicit command may change state afterward; the write command revalidates inside its transaction.

The runtime resolves database authorization on every protected request. Grants/revocation take effect on the next request without changing Entra claims, restarting the API or re-signing in. An already executing authorized request is not retroactively cancelled. Unrelated roles can independently confer the same permission and are deliberately preserved.

## Local operator runbook

1. Use only the already configured personal Entra development tenant and local database. No cloud changes are performed by these commands. Complete normal Microsoft authentication personally; never copy access/refresh tokens into scripts.
2. Load the existing ignored local backend configuration into the command process. The CLI does not automatically read `.env`. Keep all personal inputs outside Git. Explicitly set `F036_PERSONAL_ENTRA_TENANT_ID` to the already configured personal tenant, after confirming ownership.
3. From `server/`, run `npm run dev:staff:inspect`. If no mapping exists, use the documented F027 explicit personal identity mapping process first. Do not use an email or guessed object ID.
4. Set `F036_STAFF_ID` to the deliberately selected internal candidate ID and `F036_ORGANIZATION_ID` to the fictional development Organization ID. Set `F036_SCOPES` to a JSON array of explicit `{ "departmentId": "<fictional-department-uuid>", "divisionId": "<fictional-division-uuid>" }` objects; use null only for a deliberate department-level selection.
5. Set either `F036_PERMISSIONS` to exact comma-separated names or `F036_BUNDLE` to one listed bundle. Do not set both. Do not grant geospatial simply because it exists.
6. Run `npm run dev:staff:provision -- --dry-run`. Review the verified profile/database, redacted principal, fictional scope names and exact permission list.
7. Run `npm run dev:staff:provision -- --confirm` only after reviewing the explicit selection. Without `--confirm` or `--dry-run`, writes are refused. `--help` documents inputs. A failed command exits nonzero and does not serialize driver/configuration errors or personal inputs.
8. Verify access through the normal Entra-authenticated application/API. Verify an ungranted capability remains denied. Use fictional requests only, preserve existing PUBLIC requests and their immutable references, restore temporary Issue/reference configuration after UAT, and read operational history back after refresh.
9. Retain explicitly approved development grants for future UAT, or deliberately remove selected grants using `npm run dev:staff:deprovision -- --dry-run`, review, then `npm run dev:staff:deprovision -- --confirm`. Use the same selected principal, Organization, scopes and the exact permission list to remove. Do not remove an unrelated role to force denial.

No direct SQL is required for the normal operator workflow. Do not commit local configuration, screenshots showing personal identity or UAT artifacts. Examples intentionally contain no personal identifiers or credential-bearing connection strings.

## Validation and live UAT

Validation passed: F036 unit 4, F036 PostgreSQL integration 15 (including its parent test); full backend unit 174, API E2E 36, PostgreSQL 77 with zero skips, shared 62, React 210. TypeScript, ESLint, formatting, backend/frontend production builds, whitespace and private-configuration scans passed. Existing Vite large-chunk warnings remain. The final focused database rerun additionally uses populated fictional request/activity records for preservation checks.

Tests cover explicit/missing/unsafe profiles, local target restrictions and URL overrides, personal-tenant mismatch, known permissions and bundle expansion, invalid inputs/hierarchy, unknown principals, zero-write dry run, repeated/five-way concurrent provisioning, real read-only RBAC, scoped HTTP options, localhost without grants, authenticated-but-unprovisioned denial, next-request revocation, provisioning/deprovisioning failure rollback, unrelated grant/membership preservation, and externally altered role refusal. Existing F029–F035 regression suites remain unchanged. No startup/sign-in/migration imports the tooling.

Automated tests use fictional principals in disposable reqro_test schemas and the real database resolver/HTTP guard; token verification is replaced only inside the isolated test harness. This is separate from signed personal-Entra live evidence.

## Personal live UAT result

The operator explicitly selected the existing F027 personal mapping, the fictional Organization, Public Works / Streets and Community Services / Parks, and the six FULL_UAT_OPERATOR permissions. No geospatial or Environmental Services grant was added. The supported inspection command, read-only dry run and explicit confirmation command were exercised. Private selection remains only in ignored local configuration. No Entra/cloud configuration was changed.

Development grants retained for future UAT.

| Authorization state                                      | Observed live result                                      |
| -------------------------------------------------------- | --------------------------------------------------------- |
| Same normally authenticated principal before F036 grants | Workspace read denied, HTTP 403                           |
| Explicit six-permission provisioning                     | Normal workspace and approved administrative APIs succeed |
| Deliberately ungranted capability/scope                  | Geospatial 403; Environmental Services Issue action 404   |
| Remove only internal.read                                | Same session denied; protected detail/history withheld    |
| Explicitly restore internal.read                         | Same session reads again without re-login                 |

No default grant or authorization bypass was used. A temporary local button-driven test page imported the existing AuthRoot/MSAL and API client for administrative APIs without existing UI. It used real signed-token/live-database requests, not fixtures, and was removed before commit. F034/F035 workflow used the normal production workspace components. Tokens were never displayed or copied into scripts.

F032: the seeded fictional Damaged Street Sign Issue changed from internal_intake to external_redirect with example.com. Resident and staff catalog APIs returned the stored handoff and no questions; the normal resident page showed the interstitial, hostname and Go Back without immediate navigation. Both direct resident and staff submissions returned 409. Request count remained two. Switching back restored the same question ID and three options. Final action is internal_intake, revision 3. No real external client system was used.

F033: initial policy SR / year_month / width 6 / monthly / hyphen, revision 1. Read/preview did not reserve a reference. Temporary DEV / year_month / width 8 / monthly / hyphen, revision 2, produced DEV-202609-00000003. A stale update returned 409. Final policy is restored to SR / year_month / width 6 / monthly / hyphen, revision 3. The uninterrupted next sequence also confirms handoff/rejected submissions consumed no number. Existing SR-202609-000001 and SR-202609-000002 were compared by complete-row hashes before/after UAT and remain unchanged PUBLIC/WEB records.

The only new request is **DEV-202609-00000003**, INTERNAL / STAFF, fictional Damaged Street Sign, initially Public Works / department-level. It finishes Open, revision 7, in Community Services / Parks. The normal authenticated workspace showed one INTERNAL request while excluding both PUBLIC requests. Exact reference search succeeded; Closed status and the other scope filters correctly returned no matches before routing. Reference remained opaque and readable; contact fields were absent from the UI and covered by existing server projection tests. Only one request exists in the live workspace, so multi-page navigation remains automated-test evidence rather than live evidence.

Observed chronological operational history:

1. request_created
2. work_started
3. placed_on_hold — fictional reason persisted
4. work_resumed
5. request_routed — Public Works to Community Services / Parks
6. request_closed — fictional resolution persisted
7. request_reopened — fictional reason persisted; prior closure retained

All seven events, neutral Staff member actor labels and all three narratives were read back by the normal authenticated API after full-document direct navigation to the detail URL. Focus entered narrative textareas and returned to the request heading; normal success feedback appeared. No history was edited/deleted and no unrelated request was modified. Existing responsive/accessibility coverage was retained; this task does not claim new exhaustive viewport or screen-reader certification. No separate inaccessible INTERNAL request existed for live cross-Organization IDOR testing; existing automated isolation suites cover it, and the live out-of-scope catalog check remained denied.

No F036 database migration required. Personal reqro_dev retains 16 applied migrations, latest 20260919050000-add-request-operational-activity, zero pending. No rollback or destructive repair was performed. The normal backend was started locally for UAT; no deployment occurred.

## Deferred work

Production staff/role administration, invitations, Entra group mapping, SCIM, approval workflows and durable grant audit history require separate designs. F036 is not a production onboarding tool or an ownership proof for arbitrary configured resources. It adds no default grant, permission UI, client integration, notification, resident-contact access, PUBLIC staff workspace or F037 feature.

## F037 operational target setup extension

After F037 migration and automated validation, `setup-operations` can explicitly create/reuse fictional operational reviewer roles, compatible existing work groups, and the selected principal's operational memberships. It uses the same required development profile, personal tenant confirmation, exact local database identity, existing fictional Organization and explicitly selected scopes. Department/Division memberships must already exist; this command never grants permissions or creates staff identities.

From `server`, with the same ignored local configuration documented above:

```powershell
node --env-file=.env --env-file=.env.f036 node_modules/tsx/dist/cli.mjs src/database/development-staff-cli.ts setup-operations --dry-run
node --env-file=.env --env-file=.env.f036 node_modules/tsx/dist/cli.mjs src/database/development-staff-cli.ts setup-operations --confirm
```

Equivalent package command with environment already loaded: `npm run dev:staff:setup-operations -- --dry-run` / `--confirm`. Dry run performs zero writes. Setup is transactional and idempotent under the same Organization lock as grant provisioning. It rejects inactive existing memberships instead of silently reactivating them. Synthetic memberships may be explicitly retained for future UAT. No bulk operational-target cleanup or production membership-management capability is introduced; the existing targeted permission deprovision command remains separate. See F037 for operational eligibility and the final UAT state.

## F039 contact permission runbook addition

F039 adds `service_request.contact.read` to the known manifest and FULL_UAT_OPERATOR. The previous six-permission expansion did not include contact. Stored grants never change from a bundle edit; explicit provisioning is required after the F039 migration. Other bundles and optional geospatial behavior remain unchanged.

To grant/revoke contact alone with the already selected fictional principal, Organization and scopes, set `F036_PERMISSIONS=service_request.contact.read` in the command process and unset `F036_BUNDLE`. Run the existing `dev:staff:provision -- --dry-run`, then `--confirm`; use `dev:staff:deprovision` with the same flags to revoke only contact. Keep all identity/configuration in ignored local files. Ordinary read/update and unrelated grants must remain. No re-login is needed: subsequent protected requests resolve current database grants. See F039 for the approved PUBLIC UAT procedure and final recorded grant state.

### Historical F039 optional PUBLIC-view UAT selection

The existing `service_request.view` permission can be selected individually using `F036_PERMISSIONS=service_request.view` and no F036_BUNDLE. It enables existing scoped PUBLIC list/detail APIs as well as the parent-read key for the dedicated PUBLIC contact endpoint. It does not grant contact access by itself. At F039 completion FULL_UAT_OPERATOR contained exactly seven permissions, including contact.read but excluding view and geospatial. The approved F040 expansion below supersedes that manifest while preserving F039's recorded seven-grant checkpoint. No bundle is automatically reprovisioned.

For the approved F039 populated-contact UAT, capture the original grants, confirm view is absent, run the normal dry run and explicit provision, and preserve the selected fictional scopes. After UAT, use the same individual selection with targeted deprovisioning, and verify PUBLIC list/detail/contact denial through normal authenticated APIs. Retain contact.read and the original six grants. Do not remove unrelated/pre-existing grants. No F040 workspace or production administration is introduced.

## F040 approved PUBLIC operation runbook addition

The operator approved adding nine PUBLIC keys to the prior seven-permission FULL_UAT_OPERATOR on 2026-09-20: `service_request.view`, `service_request.start_work`, `service_request.hold`, `service_request.resume`, `service_request.close`, `service_request.reopen`, `service_request.assign`, `service_request.route`, and `service_request.watchers.manage`. The bundle now has sixteen individual permissions; other bundles are unchanged. Runtime authorization never evaluates the bundle name. No migration, startup, sign-in or bundle edit reprovisions an existing principal.

After automated checks and the safe F040 migration, establish the INTERNAL-only manual baseline before granting PUBLIC access. With the existing ignored principal/Organization/scope selection, set only the current process's `F036_PERMISSIONS` and clear `F036_BUNDLE`. Use `service_request.view` alone for the read-only phase, then the remaining eight keys for the operation phase. For each selection follow the same dry run then explicit confirmation commands above. Do not broaden scope or grant geospatial permission.

For revocation, select only the key being tested (`service_request.view`, `service_request.internal.read`, or `service_request.contact.read`) and use targeted deprovisioning. Verify subsequent normal authenticated requests reflect the current grants and restore the selected key explicitly. Do not deprovision the whole bundle merely to test one boundary. Final retention of all sixteen approved keys in Public Works / Streets and Community Services / Parks is authorized. F040's manual authenticated operations and all three independent revocation/restoration sequences passed without re-login; direct API denial accompanied UI observations. Read-only hashes verified dry-run behavior and preservation of unrelated grants, scopes and operational records. See the [F040 report](F040-implementation-report.md) for the final database selection and any remaining validation stage.

See [F040](F040-public-service-request-staff-workspace.md) for the independent PUBLIC workflow keys, migration prerequisites, safe manual UAT sequence and completion evidence. This remains personal development tooling, with all F036 profile/database/identity checks unchanged.

## F041 Notes provisioning addition

The F041 implementation expands the known manifest and FULL_UAT_OPERATOR from sixteen to eighteen explicit keys by adding `service_request.note.read` and `service_request.note.create`. The sixteen F040 keys above remain; other bundles are unchanged and geospatial remains optional. No stored grant changes from this edit, migration, sign-in or startup. Runtime never evaluates bundle names.

After automated validation and the safe F041 migration, prove the manual PUBLIC/INTERNAL Protected baseline before any Notes grant. Using the existing ignored personal identity/Organization/scope selection, select `service_request.note.read` only through F036_PERMISSIONS (clear F036_BUNDLE), dry-run and explicitly provision. Verify readable/empty Notes without a composer. Only then select, dry-run and provision `service_request.note.create`. Creation requires parent read plus both Notes keys. Test targeted create/read revocations and contact/parent-access independence, restoring only the selected permissions afterward. Do not deprovision the entire bundle for a single-key test.

The final retained set is the prior sixteen plus both Notes keys, eighteen total, explicitly restored after successful manual authorization and responsive UAT. Personal migration state is 20 applied / zero pending. There were zero Notes/grants immediately after migration; explicit read-only then create provisioning followed the Protected baseline. Two fictional Notes now exist. Targeted read/create/contact/PUBLIC-read revocations passed; unrelated grants/scopes and parent records remained intact. Existing development-only profile, localhost database/role, fictional scope, personal Entra and production/client refusal safeguards are unchanged. See [F041](F041-internal-notes-staff-collaboration.md) and its [implementation report](F041-implementation-report.md) for API semantics, final evidence and validation status.

## F042 correspondence provisioning extension

F042 adds `service_request.communication.read` and `service_request.communication.create` to the explicit known-permission manifest and FULL_UAT_OPERATOR, expanding its F041 set from 18 to 20 keys. All prior keys are preserved; geospatial.read remains optional and outside the bundle. This is development provisioning shorthand only, never a runtime role or automatic database grant. Existing principals gain nothing from code or migration alone.

Follow the [F042 sequence](F042-requester-communication-foundation.md): prove the ungranted protected baseline, explicitly provision read alone, verify read-only UI/direct POST denial, then explicitly provision create. Creation requires both read and create plus independently authorized PUBLIC parent access. Verify targeted revocations and restore the documented final set. Continue all existing profile, personal identity, local target and fictional Organization/scope safeguards. Never grant a wildcard or bypass Entra authentication.
