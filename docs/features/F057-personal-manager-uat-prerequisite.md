# F057 personal-development manager-UAT prerequisite

Current-state reconciliation: this development-only tooling is **DELIVERED AND SYNCHRONIZED** on `main` as commit `52ecbcbd0cf0b84291297326fae3d8755d336caa`. It remains separately governed local provisioning support and authorizes no production, client or cloud provisioning. The approval-boundary statements below describe the authorizations in force at their own checkpoints and are retained unchanged as historical record. See the [F057.4 architecture refresh](F057-4-access-administration-architecture-refresh.md).

Initial approval on 2026-09-26 covered implementation and dry-run only. A subsequent explicit user approval authorized exactly the reviewed personal bootstrap and minimum synthetic target preparation; see the execution record below. No runtime mutation UAT, commit, push, deployment, migration or cloud change was authorized.

## Selection and execution boundary

Load ignored server configuration into the process. Do not place credentials or provider IDs in command arguments or tracked files. Existing `dev:access` supports `bootstrap|add-manager|remove-manager --dry-run|--confirm`. Personal manager selection additionally requires `F057_PERSONAL_MANAGER_UAT=true`, explicit development NODE_ENV/profile, enabled personal external identity, matching `F036_PERSONAL_ENTRA_TENANT_ID` / configured tenant, and matching nonempty `F036_STAFF_ID` / `F057_STAFF_ID` and `F036_ORGANIZATION_ID` / `F057_ORGANIZATION_ID`. The selected existing identity must be active and mapped in that tenant; this is rechecked inside the locked transaction. Local database URL restrictions remain enforced before connecting. The CLI is not registered in HTTP modules.

Specify fresh `F057_EXPECTED_REVISION` as a canonical decimal string and `F057_EXPECTED_BOOTSTRAP=true|false`. The existing `F057_PERSONAL_READER_UAT` flag cannot authorize manager commands. Synthetic manager mode remains available through its existing explicit flag. No mode permits client/production profiles.

Use the supported bootstrap dry-run for an unbootstrapped Organization. It is a repeatable-read read-only transaction: no roles, grants, assignments, audit or revision are written. Output describes missing prerequisite additions, proposed revision/bootstrap, reuse of outside configuration-read, independent Reader ownership, resulting effective Administrator status and proposed audit counts. It never impersonates the target as a runtime actor.

## Consequences requiring provisioning approval

Bootstrap grants only missing prerequisites through separate Administrator ownership and sets bootstrap true. Existing configuration-read and Reader contributions remain untouched. A changed operation writes one immutable controlled-provisioning change set with actual contribution deltas and advances the Organization revision once. Dry-run records none of these.

Later remove-manager removes only permissions in this Administrator-owned contribution. It preserves outside/Reader grants, retained empty ownership/assignment, audit, and the bootstrap latch. An active bootstrapped Organization must retain another effective manager before this identity can lose its last effective manager prerequisite. Any alternative manager and its provisioning require separate authorization. A mapped active local manager is not proof of usable provider access. No rollback-to-unbootstrapped or audit deletion is offered.

## Validation and actual dry-run

Implementation validation passed: backend typecheck/build, ESLint, configured Prettier, frontend build, 317 backend unit, 41 API E2E, 472 PostgreSQL, 64 shared and 698 distinct React tests (696 full plus two new focused regressions). See [F057.3 evidence](F057-3-configure-access.md) for reruns and limits. Personal authenticated mutation UAT remains deferred.

The supported `bootstrap --dry-run` was executed on 2026-09-26 against the existing explicitly selected personal-development identity, using ignored process configuration. No `--confirm` was executed. Private identifiers and connection values are omitted.

| Consequence                    | Authoritative dry-run proposal                                                                                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization revision         | Current `1`; proposed `2`                                                                                                                                                                            |
| Permission additions           | Exactly `admin.access.manage`; no removals                                                                                                                                                           |
| Contribution                   | One new Administrator-owned role, ownership and target assignment containing only the missing manage permission                                                                                      |
| Configuration read             | Existing `admin.configuration.read` is reused, not duplicated                                                                                                                                        |
| Reader authority               | Existing Reader ownership and `admin.access.read` contribution remain separate and unchanged                                                                                                         |
| Other current access           | All 28 existing effective permissions remain; proposed effective count is 29                                                                                                                         |
| Bootstrap                      | `false` → `true` if separately approved and executed                                                                                                                                                 |
| Effective Administrator status | `false` → `true`; current effective manager count is zero, proposed count is one                                                                                                                     |
| Immutable audit                | Proposed one `controlled_provisioning` / `bootstrap_access_administration` change-set header and one added permission delta; current Organization header count is one, proposed total is two         |
| Last-manager protection        | The resulting identity becomes the only effective manager; loss of the last effective manager in the active bootstrapped Organization is rejected                                                    |
| Future `remove-manager`        | For this exact proposal, removes only the Administrator-owned `admin.access.manage` contribution, after last-manager requirements are met; existing Reader/configuration/other outside grants remain |
| Not automatically reversible   | Bootstrap stays true; retained ownership/assignment, advanced revision and immutable history remain. No automatic restoration of the exact pre-bootstrap database state                              |

Safe eventual removal requires separate authorization to establish another active, effective and actually usable Access Administrator in the same Organization, verify that replacement retains all three prerequisites, then review a fresh `remove-manager --dry-run` using the current revision/bootstrap state and separately approve execution. Re-read all contribution sources: another source of manage authority could keep this identity an Administrator even after removing the owned contribution. Deactivation/deletion or revocation is not a bypass for last-manager protection.

Read-only verification fingerprinted every one of the 60 public development tables before and after the CLI dry-run: all unchanged. Actual revision remains `1`, bootstrap remains false, access-manage remains absent, and the Organization still has one prior Reader audit header. No new change set or permission delta was written. No personal UAT target was created.

**STOPPED: explicit provisioning approval is required.** No bootstrap, manage grant, Reader change, deployment, push, cloud change, development migration or F057.3D UAT was performed.

## Subsequent approved execution and manual UAT handoff — 2026-09-26

The user explicitly approved the exact proposal above. Immediately before mutation, the supported bootstrap dry-run was repeated and compared field-for-field with the approved proposal; revision was exactly `1`, bootstrap false, and the only proposed addition was `admin.access.manage`. All 60 tables were snapshotted in read-only transactions. The supported controlled-provisioning CLI then executed `bootstrap --confirm` once with expected revision `1` and bootstrap false. No retry or runtime self-edit occurred.

All 16 requested postconditions passed. Revision became exactly `2`, bootstrap true, and the selected identity became the sole effective Access Administrator. Exactly one Administrator ownership, role, assignment and `admin.access.manage` role-permission row were added. Existing effective configuration-read and Reader-owned access-read were reused without duplication. Exactly one immutable controlled-provisioning bootstrap change set (revision 1→2) and one added manage delta were added. Existing rows in every table were unchanged except the selected Organization authorization-state row. Reader/F036/F027/shared roles, Department/Division memberships, operational managed permissions and migration rows remained unchanged. Table count remains 60; last-manager and immutable-audit protections remain enabled.

### Minimum synthetic target preparation

Reuse the existing supported development-seed fixture **Alex Example**, safe reference **staff-…000001** (the synthetic staff reference, not the Organization). It is a separate active identity in the same Organization with no Entra mapping. No extra identity, role, grant, membership or audit was needed or created for target preparation. Its starting state is:

- Effective and outside-only permissions: `service_request.view`, `service_request.assign`, `service_request.start_work`, `service_request.hold`, `service_request.resume`.
- Access & Permissions-managed permissions: none; no F057-owned role exists for this target.
- Department: **Public Works** (active). Division: **Streets** (active).
- Effective Access Administrator: false.
- Organization revision after preparation: **`2`**.

Frontend `http://localhost:5173/admin/access` and API `http://localhost:3000/api/v1/health` responded 200. Open the frontend URL, use normal personal Entra sign-in, navigate **Admin → Access & Permissions**, search **Alex Example**, and select **View Access**, then **Configure Access**. Refresh the page first if it was open before provisioning. The five outside permissions should remain effective and read-only, with no managed selections. Do not select the personal manager identity; runtime self-edit remains prohibited.

**STOPPED FOR USER-PERFORMED MANUAL UAT.** No Configure Access mutation was sent, no authenticated mutation UAT was performed on the user's behalf, and F057.3D is not complete. Source changes remain uncommitted; no push, deployment, migration or Entra/cloud change occurred. The earlier dry-run-only stop remains historical evidence.
