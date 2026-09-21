# F040 — PUBLIC staff operation permission review

Status: approved by the operator on 2026-09-20. Approval covers the granular PUBLIC policy, two new narrow permissions and explicit retention of the nine additional PUBLIC UAT keys in the existing fictional scopes. Personal provisioning still requires automated validation and the INTERNAL-only live baseline. Implementation and verification are in progress.

## Existing authorization

The repository defines `service_request.view` for PUBLIC read, five PUBLIC workflow action permissions, and `service_request.assign`. It does not define `service_request.update`, a routing permission or a watcher-management permission. Existing INTERNAL operations use `service_request.internal.read` and `service_request.internal.update` and retain that boundary.

Sources: [permission constants](../../server/src/auth/auth.types.ts), [existing PUBLIC controller](../../server/src/service-request/service-request.controller.ts), [INTERNAL mutations](../../server/src/service-request/internal-request-mutations.service.ts), and [ownership service](../../server/src/service-request/request-ownership.service.ts).

## Approved PUBLIC policy

Every operation first requires normal Entra authentication, trusted active Organization, persisted PUBLIC audience, `service_request.view` and current Department/Division scope. Each mutation then requires its operation-specific permission. Contact remains independently protected by `service_request.contact.read`.

| Operation                        | Additional permission             | Origin                                 |
| -------------------------------- | --------------------------------- | -------------------------------------- |
| Start Work                       | `service_request.start_work`      | Existing                               |
| Hold                             | `service_request.hold`            | Existing                               |
| Resume                           | `service_request.resume`          | Existing                               |
| Close                            | `service_request.close`           | Existing                               |
| Reopen                           | `service_request.reopen`          | Existing                               |
| Assign, reassign, unassign       | `service_request.assign`          | Existing                               |
| Route                            | `service_request.route`           | Approved new narrow permission         |
| Add/remove other watcher targets | `service_request.watchers.manage` | Approved new narrow permission         |
| Self-watch / stop watching self  | None beyond normal request read   | Existing F037 policy applied to PUBLIC |

Routing also requires authorized target scope. STAFF target eligibility requires the target's normal read permission for the request's persisted audience. Operational Role/Team membership, assignment and watching confer neither request nor contact access. The shared lifecycle/history/ownership engines will enforce revisions and atomicity; the browser only displays per-request capabilities returned by the server.

This preserves the existing granular PUBLIC action permissions instead of introducing a competing broad update permission. The two new permissions have no default grants and confer no read or contact access.

## Migration requirement

The F031 `request_routing_check` permits routed Department/Division overrides only for INTERNAL requests. F040 requires a narrow change allowing the same constrained scope overrides for PUBLIC requests, while retaining Organization and Department/Division foreign keys. PUBLIC list/detail, contact and mutation authorization must consistently use the effective routed scope. Unrouted records keep their existing catalog scope.

Register only the two approved new permission keys. Do not create grants, rewrite request/contact/history data, infer routing, or fabricate activity. Rollback must refuse when PUBLIC routing or dependent new grants make rollback unsafe. Apply/rollback/reapply testing belongs in disposable schemas before any personal-development application.

## Approved explicit development selection

Retain the existing seven-key `FULL_UAT_OPERATOR` expansion:

- `service_request.create`
- `service_request.create_internal`
- `service_request.internal.read`
- `service_request.contact.read`
- `service_request.internal.update`
- `catalog.issue_action.manage`
- `service_request.reference.manage`

Add these nine explicit keys for comprehensive F040 UAT, producing a sixteen-key bundle:

- `service_request.view`
- `service_request.start_work`
- `service_request.hold`
- `service_request.resume`
- `service_request.close`
- `service_request.reopen`
- `service_request.assign`
- `service_request.route`
- `service_request.watchers.manage`

After automated validation and explicit provisioning, retain the selected grants for future UAT on the existing fictional CityVUE Development Municipality, Public Works / Streets and Community Services / Parks scopes. Do not add scopes or geospatial permission. Bundle expansion alone changes no stored grants; runtime authorization never evaluates bundle names. F036 dry run, target checks and targeted deprovisioning remain required.

No production permission administration, default authorization, notifications or F041 work is included.
