# ADR-004 — Assignment and watchers

**Status: Accepted** — F037 relationships reused across audiences by F040.

## Context

Routing, ownership, following and authorization answer different questions. Conflating them would let an operational relationship broaden access to protected requests or content.

## Decision

Routing selects responsible Department/Division. Assignment selects one current primary owner, protected by a partial unique database index; no current assignment means Unassigned. Explicit watchers are independent following relationships. Assignment never automatically adds a watcher, although deliberate assignee/watcher overlap is allowed.

API target types are `staff`, `role` and `group`. STAFF uses existing StaffIdentity. Operational ROLE uses `operational_role`, separate from RBAC `role`. GROUP uses `work_group`; the UI calls it Team. No Distribution Lists, arbitrary emails or resident targets exist. Active same-Organization targets must be eligible for the current scope. STAFF targets additionally require independent read permission for the parent's persisted audience. Operational membership grants no RBAC.

Managing ownership/others' watchers requires the audience-specific operation permission and normal parent access in the unified workspace. An authorized reader may watch/unwatch themselves through a server-resolved principal and expected revision. Commands revalidate target eligibility and atomically update relationships, revision, Activity and safe audit.

Routing preserves an eligible owner; otherwise it atomically unassigns and records both events. Watchers survive routing as relationships but cannot retain access after scope loss. All/My Requests/My Team/Watching only narrow the authorized query.

## Consequences

Safe target snapshots preserve history. Inactive targets need deliberate reassignment/removal; no automatic offboarding or notifications are implied. Production Role/Team administration and directory synchronization remain future work.

## Security and privacy

Assignment, watching and membership grant neither parent request access, contact access nor Notes access. Pickers return minimal safe display data, not email, directory claims or permission inventories. Foreign/ineligible targets and stale revisions fail without partial writes.

## Related evidence

[F037](../../features/F037-assignment-ownership-watchers-foundation.md), [F040](../../features/F040-public-service-request-staff-workspace.md), [target eligibility and views](../../../server/src/service-request/ownership-targets.ts), [ownership service](../../../server/src/service-request/request-ownership.service.ts), [authorization ADR](ADR-006-public-internal-staff-authorization.md).
