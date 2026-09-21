# ADR-006 — PUBLIC and INTERNAL staff authorization

**Status: Accepted** — F040 unified workspace and retained legacy contracts.

## Context

A single staff workspace must combine authorized work without combining the underlying authorization policies. PUBLIC classification cannot make operational data publicly accessible.

## Decision

Use `/staff/requests` and its UUID detail route with unified APIs under `/api/v1/staff/service-requests`. Persisted audience chooses parent read authorization: PUBLIC requires `service_request.view`; INTERNAL requires `service_request.internal.read`. Both require trusted active Organization and effective Department/Division scope.

All is a single scoped SQL relation constrained to independently permitted persisted audiences before filters, count and pagination. Audience selection only narrows that set. My Requests, My Team and Watching add server-resolved relationship predicates. Exact reference search remains Organization-scoped; order is createdAt descending with UUID tie-breaker, default page size 25 and maximum 100. React never merges independently paginated audiences.

After parent authorization, unified operations require:

| Operation             | PUBLIC additional permission      | INTERNAL additional permission    |
| --------------------- | --------------------------------- | --------------------------------- |
| Start Work            | `service_request.start_work`      | `service_request.internal.update` |
| Hold                  | `service_request.hold`            | `service_request.internal.update` |
| Resume                | `service_request.resume`          | `service_request.internal.update` |
| Close                 | `service_request.close`           | `service_request.internal.update` |
| Reopen                | `service_request.reopen`          | `service_request.internal.update` |
| Route                 | `service_request.route`           | `service_request.internal.update` |
| Assign/unassign       | `service_request.assign`          | `service_request.internal.update` |
| Manage other watchers | `service_request.watchers.manage` | `service_request.internal.update` |
| Self-watch/unwatch    | No extra operation key            | No extra operation key            |

State, revision, eligible targets and current/target routing scope remain independently checked. There is no generic PUBLIC update key. Capabilities describe permitted actions after read admission; they never authorize an endpoint.

## Consequences

Reuse workflow, routing, ownership and Activity engines. Named legacy INTERNAL/PUBLIC routes stay audience-specific. Legacy INTERNAL workflow/routing retain their established `service_request.internal.update` admission; the unified workspace additionally requires parent read. Do not silently broaden or rewrite that compatibility contract. Offset counts/pages can shift under concurrent writes.

## Security and privacy

No permission is granted automatically. Assignment, watching and operational membership do not broaden the SQL authorization set. Contact requires its separate key and audit; Notes require their own keys. Resident creation/status projections never inherit staff Activity, narratives, ownership or Notes. Authenticated legacy detail is not a resident-safe anonymous endpoint.

## Related evidence

[F040](../../features/F040-public-service-request-staff-workspace.md), [permission review](../../features/F040-public-staff-workspace-design-review.md), [policy](../../../server/src/service-request/staff-request-policy.ts), [scope](../../../server/src/service-request/staff-request-scope.ts), [unified query repository](../../../server/src/service-request/internal-request.repository.ts).
