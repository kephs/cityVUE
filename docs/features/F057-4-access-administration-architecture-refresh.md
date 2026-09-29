# F057.4 — Access Administration Documentation & Governance Reconciliation

Status: documentation and governance reconciliation. **F057.4 changes no runtime behavior.** No application, React, server, test, migration, SQL, permission-catalog, API-contract, authentication, configuration, dependency or lockfile change is part of this record. No database was accessed or mutated, and no Accepted UI Baseline was changed.

Baseline: branch `claude/f057-access-architecture`, HEAD `4709a8fe1f742e5dfc416d6fc53cf1198da439b7`, clean working tree, zero commits ahead of or behind `main`. Architecture-review decision **D1 is APPROVED**: F057.1 through F057.3D are accepted as delivered, and Administrative Access & Permissions must not be redesigned or reimplemented.

## Why this refresh was necessary

A fresh session was asked to produce an implementation-ready architecture for Administrative Access & Permissions and to slice it into F057.1, F057.2 and F057.3. Repository inspection found that all of that work was already implemented, validated, manually accepted and present on `main`.

The durable documentation set had not caught up with the repository. Specifically:

- Every F057 feature record still carried a `COMPLETE LOCALLY — NOT SYNCHRONIZED` or `stopped for review` status, although the corresponding commits are ancestors of `main`.
- The durable sections of [Architecture](../ARCHITECTURE.md) described F057 only inside dated checkpoint paragraphs; no durable section described the delivered access-administration domain alongside the other separate information streams and administration boundaries.
- The [security framework](../security/SECURITY_FRAMEWORK.md) still described workforce identity and permission code as "locally observed, outside this committed baseline", and listed provisioning and role-change audit entirely under Planned/future.
- The most recent roadmap and feature-index checkpoints predated the F057 commits, so the newest paragraph a reader encountered still described F057.3D as uncommitted.

The combined effect was that a protocol-compliant fresh session, reading the documents in the order [the Codex Protocol](../development/REQRO_CODEX_PROTOCOL.md) prescribes, could reasonably conclude that F057 remained unimplemented. F057.4 removes that failure mode without rewriting history.

## Verified delivered F057 architecture

The findings below were verified by reading the committed implementation, migrations and tests at the baseline HEAD, not by trusting prior reports.

### Authorization model

Microsoft Entra ID authenticates workforce identity only. Access tokens carry `tid`, `oid` and delegated scope; they carry no roles, groups or permissions. [EntraTokenService](../../server/src/auth/entra-token.service.ts) validates signature, issuer, audience, tenant and lifetime, and requires the configured delegated scope.

[StaffAuthorizationService](../../server/src/auth/staff-authorization.service.ts) resolves authorization from the database on every request: an active `staff_identity` matched on the tenant/object pair supplies the trusted `organizationId`; [effective-permissions](../../server/src/auth/effective-permissions.ts) joins `staff_role_assignment`, `role` and `role_permission` with both `active` flags required; and `recognizedPermissions` intersects the result with the code catalog so unknown database keys can never grant anything. Department and Division memberships are resolved into the same context as operational scope.

Because permissions are recomputed per request from the database, a revocation takes effect on the requester's next call. There is no permission claim in the token to go stale.

### Delivered administrative surface

The administrative surface is **`/admin/access`**, reached through the existing Admin shell and gated on the server-projected `canReadAccess` capability. Its API is [AdminAccessController](../../server/src/admin/admin-access.controller.ts) at `/api/v1/admin/access`, with five protected GET routes (`principals`, `permissions`, `scopes`, `principals/:id`, `principals/:id/history`) and one governed `PATCH principals/:staffId`. Every response is `no-store`. Capability booleans guide presentation only; each route reauthorizes independently.

### People-centric model

Administration is **people-centric**. An administrator selects a staff member and edits that person's access; there is no user-facing role concept, no role editor and no shared named role to assign. Single-principal roles named `f057-<kind>-<staffId>` are an internal persistence mechanism recorded in `access_role_ownership`, whose `kind` is constrained to `operational`, `administrator` or `reader`, unique per Organization, principal and kind. Database triggers permit ownership only over a role created in the current transaction with no prior provenance, no permissions and no assignments, so no pre-existing or shared role can be adopted.

### Permissions

`admin.access.read` and `admin.access.manage` **already exist** in the [permission catalog](../../server/src/auth/auth.types.ts), registered by Migration 38 with zero default grants. Both are classified `provisioning-only` in [access-policy](../../server/src/access/access-policy.ts) and therefore cannot be granted through the runtime administrative API. Reading requires `admin.configuration.read` and `admin.access.read`; managing additionally requires `admin.access.manage`.

The catalog holds 32 registered keys, of which 27 are runtime-manageable. The five provisioning-only keys are both access keys, `geospatial.read` and both AI keys. No new permission key is required for the remaining F057 candidates described below, and F057.4 creates none.

### Organization scoping and fail-closed behavior

Authorization is Organization-scoped and fail-closed. The Organization is resolved solely from the authenticated staff context and is never accepted from a request body, query or route. Composite foreign keys bind ownership, assignments and audit rows to `(organization_id, …)`. A foreign or unknown target returns the same safe not-found response, so no existence oracle is created. `assertAccessAuthority` rejects the development fallback principal and any principal lacking a provider tenant/object pair, and the controller additionally carries `@RequireEntra()`, so the non-bearer development path cannot reach these routes at all.

### Governed atomic transactions and concurrency

Access mutations use governed atomic transactions. One command occupies one database transaction. The writer locks the `organization` row and then the `organization_access_state` row before any authorization DML, preserving the existing Organization-first order shared with F036, F027 and configuration writers. The supplied `expectedAuthorizationRevision` is compared **after** the lock is held, and the actor's identity and effective permissions are re-resolved inside the same transaction rather than trusted from the admission check.

The authorization revision is database-maintained: `advance_access_revision` refuses to run outside trigger depth, and triggers observe role, permission, assignment, staff-eligibility, membership and Organization-status changes. A transaction advances the Organization revision at most once. Stale commands fail with a conflict and require a deliberate authoritative refresh; there is no automatic retry and no idempotency key, so a consequential access command can never be silently replayed.

### Durable access-change audit evidence

Durable access-change audit evidence exists in `access_change_set` and `access_permission_delta`. Each change set records the actor, target, Organization, source, constrained operation, server-generated correlation UUID, transaction identity, before/after revisions and timestamp; each delta records the permission key and direction. Triggers reject UPDATE, DELETE and TRUNCATE on the audit and ownership tables, require matching same-transaction delta evidence before any owned permission or assignment write, and verify completeness through deferred constraint triggers at COMMIT. An access mutation and its audit therefore cannot partially commit.

This is a dedicated security-audit stream. It is deliberately separate from `request_operational_activity`, which remains staff-facing operational history.

### Ownership boundaries preserved

Externally and provisioning-owned access remains outside normal Access & Permissions editing. Administrator and Reader ownership are established only through the controlled local operator command, never at runtime. F036 development provisioning, F027 geospatial provisioning, seeded roles and any other pre-existing contribution are read-only to the runtime command; removing an owned contribution never negates another source, and the interface reports the resulting effective access honestly. A runtime command that would change the target's effective Access Administrator status in either direction is rejected, including indirect change through `admin.configuration.read`.

Department and Division membership remains **read-only** in Access & Permissions. The delivered drawer lists memberships for context and explains that Division access is listed separately from Department access, but no F057 route, service or UI mutates `staff_department_membership` or `staff_division_membership`.

### Accepted UI Baseline

The delivered Access & Permissions UI passed user-performed authenticated manual UAT. Under [AGENTS.md](../../AGENTS.md), any screen, component or layout that has passed manual UAT is an **Accepted UI Baseline**. The Access & Permissions discovery table, its Manage Access menu and pagination, the View Access drawer and the Configure Access draft, review and confirmation flow are therefore Accepted UI Baselines and are immutable unless a future feature explicitly authorizes changing a named area.

The Service Request List and Service Request Workspace Accepted UI Baselines at `6732837d86dd5a03a3e7604d869bd156fd010fa5` remain unchanged and outside F057 scope, together with Overview, Actions, Request Management, Recent Activity, Additional Information, Request Evidence, Collaboration, Activity narrative presentation, responsive and light/dark behavior, navigation, issue icons and terminology.

## Delivered F057 status

All listed commits are ancestors of `main` at the F057.4 baseline.

| Slice                         | Record                                                        | Commit                                      |
| ----------------------------- | ------------------------------------------------------------- | ------------------------------------------- |
| F057.1 security foundation    | [record](F057-1-administrative-access-security-foundation.md) | `e495d9bae5b30aa57674c71a169c8fa1a146540f`  |
| Controlled Access Reader      | [record](F057-access-reader-prerequisite.md)                  | `7c00f80e16732b2c018119ba731cc62e8b1a08d5`  |
| F057.2 read-only discovery    | [record](F057-2-read-only-access-discovery.md)                | `f866fa21193174a4e053251fe70ec4c5f2b15048`  |
| F057.3A atomic managed access | [record](F057-3-configure-access.md)                          | `9d4181909c222f55e8905b3e544f6a349510a54a`  |
| F057.3B/C Configure Access UX | [record](F057-3-configure-access.md)                          | `210086dd83c290f2751a540a182577b50b6f2928`  |
| Personal manager UAT tooling  | [record](F057-personal-manager-uat-prerequisite.md)           | `52ecbcbd0cf0b84291297326fae3d8755d336caa`  |
| Mixed-source UAT fixture      | [record](F057-mixed-source-uat-fixture.md)                    | `7d0e294f5977749c5bbe1ce60d17aa9f6b5c4503`  |
| F057.3D final validation      | [record](F057-3D-final-validation.md)                         | documented against the F057.3 commits above |

Migration 38 introduced the access foundation and Migration 39 introduced Controlled Access Reader provisioning. Migration 40 in the repository belongs to F058, not to F057.

The design of record remains [ADR-023](../architecture/decisions/ADR-023-administrative-access-management-controlled-delegation.md), including its Reader amendment and its approved F057.3 amendment. F057.4 makes no decision change and does not amend that ADR.

### Historical evidence preserved

The validation counts, manual UAT statements, live-state observations, migration counts, table counts, retried React timeout and documented limitations inside the F057.1, Reader, F057.2, F057.3 and F057.3D records describe **the state at those checkpoints** and are retained verbatim. F057.4 adds a short reconciliation line to each record rather than editing those historical facts.

### Current repository-known state versus historical live state

The historical records state a personal development database at 39 migrations applied, 0 pending, 60 tables, authorization revision 9 and bootstrap true. That was the observed state at the F057.3D checkpoint on 2026-09-26.

**F057.4 did not inspect any database.** Migration 40 has since been added to the repository by F058 work, so the applied migration count and table count in a personal development database are expected to differ from those historical figures. No current live migration state, revision or table count is claimed here; an operator must verify actual state through the repository migration CLI before any work that depends on it.

## Remaining gaps and open decisions

These are recorded so they are not rediscovered, and so they are not mistaken for delivered behavior. None is approved for implementation.

| #   | Gap                                                                                                                                                                                    | Related candidate |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| G1  | No production bootstrap path. The operator command is restricted to a development profile and an approved local database, so a real deployment has no route to its first administrator | F057.7            |
| G2  | No break-glass or recovery. The deferred last-manager invariant guarantees at least one local administrator record, not a usable sign-in                                               | F057.7            |
| G3  | Department/Division membership has no production writer or resolved owner; only development provisioning and the development seed write those rows                                     | F057.8            |
| G4  | No Organization-wide access audit read. History is retrievable only one principal at a time                                                                                            | F057.5            |
| G5  | Bootstrap state and effective-administrator count are not exposed by any route                                                                                                         | F057.6            |
| G6  | Access reads are not audited. Reading another staff member's permission state and history leaves no durable evidence                                                                   | F057.9            |
| G7  | Access mutation relies on the global throttler; there is no endpoint-specific abuse control                                                                                            | open              |
| G8  | Single-principal roles grow linearly with staff and per kind; there is no reusable Access Profile                                                                                      | open              |
| G10 | No staff lifecycle or deprovisioning administration surface exists                                                                                                                     | F057.10           |
| G11 | `admin.configuration.read` is both runtime-manageable and an Access Administrator prerequisite. This coupling is the reason the effective-union preservation check exists              | accepted          |

G9 in the originating review was this documentation drift, which F057.4 resolves.

Open decisions requiring human approval: the production bootstrap mechanism (G1); whether a recovery operation is authorized (G2); whether Reqro owns Department/Division membership or consumes it from an external system (G3); whether an Organization-wide audit index is approved (G4); whether access reads must be audited (G6); whether endpoint-specific rate limiting is warranted (G7); and whether the single-principal role model is accepted indefinitely (G8).

## Future candidates — recorded, not approved

**None of the following is approved for implementation.** Each requires its own reviewed task and explicit authorization. They are recorded here only so that remaining work is clearly distinguished from delivered work.

| Candidate   | Purpose                                                     | Gating                                                                                                                                                                   |
| ----------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **F057.5**  | Organization-wide access audit read and view                | **May require an additive database index and therefore remains behind the migration approval gate.** Adds an administrative surface requiring manual UAT                 |
| **F057.6**  | Bootstrap and effective-administrator-count visibility      | Touches an Accepted UI Baseline; requires manual UAT. Shares files with F057.5 and must be serialized after it                                                           |
| **F057.7**  | Production bootstrap and recovery design and implementation | **Must not be implemented before separate architecture and security approval.** Likely requires a migration to extend the audit operation vocabulary                     |
| **F057.8**  | Department/Division ownership decision                      | **Blocked on determining whether Reqro owns Department/Division membership** or consumes it from an external system. A decision record precedes any implementation scope |
| **F057.9**  | Optional access-read auditing                               | Policy question first. Current reads are read-only transactions, so auditing would require restructuring them                                                            |
| **F057.10** | Future staff lifecycle and deprovisioning administration    | Depends on the F057.8 identity-ownership conclusion                                                                                                                      |

Suggested order if and when each is separately approved: F057.5, then F057.6, with F057.7 and F057.8 preceded by their own decision records.

## Multi-agent classification

Classification under the [Multi-Agent Engineering Protocol](../../AGENTS.md#multi-agent-engineering-protocol). This describes suitability only; it authorizes nothing.

| Item                                                             | Class                                              | Rationale                                                                                                                                          |
| ---------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| F057.4 (this record)                                             | **A — safe for Claude before Codex returns**       | Documentation and governance only; no source, schema or security semantics                                                                         |
| F057.5                                                           | **B — Claude may implement, Codex should review**  | New protected read on an established pattern; Organization isolation and pagination correctness warrant review. Any migration hunk becomes class C |
| F057.6                                                           | **B — Claude may implement, Codex should review**  | Small additive read that touches an Accepted UI Baseline                                                                                           |
| F057.7                                                           | **C — wait for Codex**                             | Production bootstrap, recovery and the last-administrator invariant; likely migration                                                              |
| F057.8                                                           | **C — wait for Codex**                             | Authorization-ownership ambiguity affecting request scope platform-wide                                                                            |
| F057.9, F057.10                                                  | **C — wait for Codex**                             | Security- and identity-sensitive                                                                                                                   |
| Regression execution, EXPLAIN capture, responsive/theme matrices | **D — suitable future Gemini/Antigravity support** | Mechanical and independently verifiable; produces evidence only and must be re-verified rather than trusted                                        |

Concurrency restrictions: F057.5 and F057.6 both touch `admin-access.controller.ts`, `access-discovery.ts`, `AdminConfigurationPage.jsx` and `accessDiscovery.css`, and must be serialized rather than parallelized. Migration-bearing work must be serialized against everything because migration numbering is a global ordering constraint. `auth.types.ts`, `access-policy.ts` and the frozen allowlist in Migration 38 form a three-way parity set that must change together or not at all. `AdminConfigurationPage.jsx` carries a documented pre-existing formatter baseline in its navigation mapping block and must not be whole-file formatted.

## F057.4 scope statement

F057.4 reconciles durable documentation with the as-built repository. It changes no runtime behavior, no permission, no grant, no API contract, no schema and no user interface. It performs no database access, no provisioning, no staging, no commit, no push, no deployment and no migration.
