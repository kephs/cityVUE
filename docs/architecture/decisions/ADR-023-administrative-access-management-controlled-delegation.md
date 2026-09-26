# ADR-023 — Administrative Access Management and Controlled Delegation

Status: Accepted design by explicit F057.1 approval. Implementation evidence is maintained in the [feature record](../../features/F057-1-administrative-access-security-foundation.md).

## Context

Entra authenticates workforce identity; Reqro authorizes through active local staff, active role assignments, active roles and code-recognized role permissions. Department/Division memberships are independent shared operational scope. F036 provisioning provenance is structured JSON in role.description; neither role names nor development bundles are runtime authority.

## Decision

Retain the existing RBAC evaluator. Introduce provisioning-only `admin.access.read` and `admin.access.manage` with zero default grants. Read requires `admin.configuration.read` and access.read; manage additionally requires access.manage. Access Administrators are Organization-wide. Legacy development fallback is ineligible. No sign-in, startup, migration or existing Admin permission promotes a principal.

Future runtime management targets another active local staff principal in the trusted active Organization. Re-resolve actor identity and effective permissions after acquiring the authorization lock. The actor may grant any of the 27 explicitly manageable permissions without personally possessing it. They cannot grant access-management, geospatial or AI authority through F057. There is no self-edit or runtime management-authority delegation.

F057 creates fresh single-principal operational RBAC roles, with explicit `access_role_ownership` records. A separate `administrator` ownership kind identifies operator-provisioned manager roles; the two kinds cannot share a role. One role per principal/kind, composite Organization foreign keys and assignment triggers protect ownership. Database-stamped role creation transaction IDs, empty role contents and null prior provenance prohibit adoption. Existing roles receive no creation stamp or ownership during migration. Owned metadata is immutable. Retain active empty roles/assignments when their final contribution is removed; never delete history.

Existing shared, seeded, F036 and F027 contributions remain locked to runtime F057. Removing an owned contribution does not negate any other contribution. Permission metadata is code-defined and exhaustive. Migration 38 freezes the approved 27-key integrity restriction for owned operational roles; parity tests require coordinated forward migration for future changes. Registry membership alone never implies manageability. Metadata labels and audit rows do not confer authority.

Validate desired operational access against the union of desired owned and existing locked contributions. F032 grant authoring requires Admin read and Issue write alongside Handling management; its existing scoped action-only read remains unchanged. Contextual audience/parent checks remain resource policies, not fabricated universal INTERNAL-read dependencies. Existing provisioning may contain legacy combinations that new F057 authoring will reject; F057 does not repair or rewrite those contributions.

## Transactions, revisions and writers

`organization_access_state` starts at revision zero and bootstrap false. Database triggers observe role, permission-contribution, assignment, staff eligibility/provider mapping, membership and Organization-status changes. Meaningful authorization writes advance the Organization revision once per database transaction, identified by a database-generated transaction ID. Metadata-only and equal-value updates do not advance it. Desired-state no-ops write nothing. A transaction that changes and reverses authorization may conservatively advance once.

Supported writer order is Organization row, access-state row, then authorization resources. This preserves the existing Organization-first F036/F027/configuration order and avoids state-first inversion. F036, F027 and seed acquire the new state lock before authorization DML; old-schema compatibility supports historical migration tests. Database triggers also invalidate revisions for direct DML. Out-of-order direct SQL may deadlock and roll back; it is not a supported command/retry contract. No automatic retry silently replays an access command.

One governed command occupies one transaction; a unique Organization/transaction change set prevents combining independent governed commands. Compare expected revision after locking. Re-resolve runtime authority there. Concurrent same-Organization writers serialize; unrelated Organizations have separate locks. This deliberately causes broad stale-editor conflicts and some same-Organization configuration contention. It does not cancel already executing authorized HTTP requests or erase disclosed browser content.

Deferred database checks require at least one effective Access Administrator in each active bootstrapped Organization. Count distinct active staff with all three required permissions across active roles/assignments, not role names. Unbootstrapped Organizations may have zero. Deactivation is allowed; reactivation must end with a manager. Bootstrap cannot be cleared. Organization lifecycle HTTP administration is not introduced.

## Bootstrap and audit

The controlled local operator command supports read-only preview, bootstrap, add-manager and remove-manager with explicit internal target, Organization, expected revision and expected bootstrap state. Targets must already exist and be active. Bootstrap grants only missing prerequisites through its dedicated provisioning role. Pre-existing contributions remain untouched. Provisioning source is explicitly typed; it does not impersonate the target as authenticated actor. Identical current-state operations are no-ops; stale retries require a new preview. A local active manager is not proof that an external identity provider account remains usable.

`access_change_set` and `access_permission_delta` record internal identities, constrained operation/source, server correlation UUID, transaction identity, revisions and actual contribution changes. Owned permission writes require matching current-transaction delta evidence; assignment/ownership changes require the change set. Deferred verification checks committed revision, deltas, retained assignment and bootstrap completion. Audit failure rolls back the entire operation. UPDATE, DELETE and TRUNCATE are rejected. History begins with governed operations; pre-F057 history is not fabricated. No requester content, claims, tokens or profile snapshots are stored.

PostgreSQL protects structural and transactional integrity. The API and controlled operator boundary authorize the human. Shared database credentials cannot attest the HTTP actor; a privileged database owner can alter schema/disable triggers. No session bypass or reusable authorization token is introduced. Audit is evidence, not a grant evaluator.

Migration 38 is one transactional forward migration. Migrations 1–37 remain unchanged. Up adds schema and two registry entries without changing existing grants, identities or memberships. Down refuses retained ownership, bootstrap, audit or dependent permission grants. Before use it removes only F057 schema/registrations and restores the previous schema.

## Consequences and deferred work

F057.1 exposes no runtime access HTTP route, directory API, history API, React page or navigation. Department/Division memberships are read-only inputs; Department does not imply Division and Division alone does not satisfy Department scope. Existing inactive Department/Division behavior is not uniformly fail-closed and remains unchanged.

No direct staff-permission table, per-permission scope, role hierarchy, deny rules, expiring grants, Access Profile persistence, bulk tools, notifications, free-text reason, approval workflow or risk scoring. No Entra group/App Role mapping, directory sync, provider rebinding change, staff account creation or machine-principal administration. Emergency break-glass is not implemented. Production operator provisioning remains separately governed; the delivered CLI is limited to explicitly selected local synthetic development validation.

Related: [Organization isolation](ADR-001-organization-isolation.md), [Admin authorization](ADR-014-administrative-configuration-authorization.md), [F036 provisioning](../../features/F036-safe-development-staff-authorization-provisioning.md), [execution protocol](../../development/REQRO_CODEX_PROTOCOL.md). Prior decisions remain intact.
