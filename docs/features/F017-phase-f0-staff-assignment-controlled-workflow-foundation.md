# F017 — Phase F0 Staff Assignment and Controlled Workflow Foundation

**Status:** Implemented for local development; production identity, authorization, UI, and deployment are excluded

## Outcome

Phase F0 adds Organization-scoped staff profiles, explicit Department/Division/WorkGroup memberships, WorkGroups/queues, one-current-assignment history, controlled ServiceRequest workflow actions, optimistic concurrency, and append-only Activity. It does not authenticate staff. The two mutation endpoints are hidden unless `ENABLE_DEVELOPMENT_STAFF_ACTIONS=true`, and startup rejects that gate in production.

The configured `DEVELOPMENT_STAFF_ACTOR_ID` must resolve to an active synthetic development `StaffIdentity`. Seeded examples use internal UUIDs, `example.test` addresses, and null `entraObjectId`; they never pretend to be Entra identities. Future production access remains Entra token → StaffIdentity → Organization → explicit memberships → roles/permissions → server authorization.

## Assignment model

F0 supports `unassigned`, `department`, `group`, and `individual`. An explicit unassigned row preserves the full sequence of assignment decisions. A partial unique index permits only one assignment with no `endedAt` per request. Reassignment transactionally validates the active Organization-owned target and development actor, revision-guards the ServiceRequest, ends the current row, inserts the next row, and appends `service_request_assigned`, `service_request_reassigned`, or `service_request_unassigned` Activity.

Owning Department/Division classification continues to come from the immutable submitted ServiceDefinitionVersion relationship and is not changed by assignment. Generic role assignment is deferred because a functional assignment role has not yet been specified separately from authorization RBAC.

## Controlled workflow

Clients submit an action rather than a target status:

| Current | Action | Result |
| --- | --- | --- |
| `open` | `start_work` | `in_progress` |
| `open` | `close` | `closed` |
| `in_progress` | `hold` | `on_hold` |
| `in_progress` | `close` | `closed` |
| `on_hold` | `resume` | `in_progress` |
| `on_hold` | `close` | `closed` |
| `closed` | `reopen` | `open` |

Hold and reopen require a reason; close requires a resolution summary. Open-to-hold is intentionally invalid. Each successful command uses `expectedRevision`, increments the request revision in the same transaction, and appends a safe allow-listed Activity snapshot. A stale revision returns 409 with refresh guidance.

## Development API

- `POST /api/v1/service-requests/:id/assignment`
- `POST /api/v1/service-requests/:id/workflow`

Responses contain only request ID/reference, status, revision, current assignment summary where applicable, and update time. They contain no resident PII or staff email. D2 details now expose current assignment, assignment history, and allow-listed assignment/workflow Activity metadata. No production staff UI or Dashboard scope changes are included.

## Persistence and constraints

Migration `20260903010000-add-staff-assignment-workflow-foundation.ts` adds `staff_identity`, explicit Department/Division memberships, `work_group`, group membership, and `service_request_assignment`; expands canonical statuses; and expands the immutable Activity taxonomy. Composite foreign keys prohibit cross-Organization targets and memberships. Inactive staff/groups cannot receive new assignments.

## Deferred boundaries

F0 sends no notifications and performs no EAM synchronization. Activity can later feed transactional outbox and Integration Router work after separate approval. Real My Work, queue dashboards, assignment-role semantics, effective-dated RBAC, Entra mapping, production staff authorization, staff UI, attachment/work-item behavior, GIS changes, and canonical deletion remain deferred. Future permissions include `service_request.view`, `service_request.assign`, `service_request.start_work`, `service_request.hold`, `service_request.close`, and `service_request.reopen` but are not implemented by the development gate.

Production remains React/legacy `IssueService`/`cityvueIssues`; the backend remains local and undeployed.
