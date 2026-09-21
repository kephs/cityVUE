# ADR-003 — Operational Activity history

**Status: Accepted** — F035 history, extended by F037 ownership and F040 PUBLIC operations.

## Context

Staff need durable, understandable history without turning security audit or discretionary collaboration into a general request timeline.

## Decision

Store structured operational events in `request_operational_activity`, separate from the security `activity` table and F041 Notes. Creation, workflow, routing, assignment and watcher mutations append their typed events atomically with parent changes and required audit. Expected revision plus row locking prevents stale commands from adding misleading history.

Hold/Reopen reasons are bounded to 500 input characters; Close resolution is bounded to 2,000. Narratives are normalized plain text stored in operational history, not security audit. Routing and ownership events retain safe historical name/state snapshots; renaming a current target does not rewrite history. F035's explicit migration creation baselines are identified as baselines, not fabricated staff actions.

Database UPDATE, DELETE and TRUNCATE protections enforce append-only Activity. There is no arbitrary Activity write/edit/delete API. Routing that invalidates an owner can append routing and unassignment events under one revision using the constrained event slots introduced by F037. Timeline access reauthorizes the parent and returns a bounded safe projection ordered by timestamp and UUID; offset pages are not a snapshot across separate requests.

## Consequences

Failure to persist required history rolls back the operational mutation. Reopening preserves the prior closure and resolution. Meaningful history blocks destructive migration rollback. Retention/correction and privileged database administration need separate controlled design.

## Security and privacy

Operational narratives can contain incidental sensitive text. Activity remains staff-authorized, not automatically resident-visible. Contact views are security audit only. Notes do not add or modify Activity. Security audit contains safe accountability metadata rather than narratives, Notes or contact values.

## Related evidence

[F035](../../features/F035-service-request-activity-operational-history.md), [F037](../../features/F037-assignment-ownership-watchers-foundation.md), [F040](../../features/F040-public-service-request-staff-workspace.md), [Activity domain](../../../server/src/service-request/request-activity.domain.ts), [append-only migration](../../../server/migrations/20260919050000-add-request-operational-activity.ts), [ownership migration](../../../server/migrations/20260920000000-add-assignment-watchers.ts).
