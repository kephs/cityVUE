# ADR-027 — Platform Operator Bootstrap and Recovery

Status: **Accepted** — approved at architecture/security review on 2026-10-04.

**Acceptance scope.** This record establishes the accepted architecture for establishing and recovering privileged production administration. **Acceptance is not authorization to implement.** No bootstrap CLI, platform principal, recovery operation, permission key, schema change, migration or authentication change is approved by this record; each remains separately gated. ADR-027 is documentation only and changes no runtime behavior.

**Implementation state.** Nothing described here is implemented. A production deployment still has no route to its first Organization, its first staff identity or its first administrator. The controlled provisioning command remains restricted to a development profile and an approved local database.

## Context

Reqro already carries a strong administrative-access substrate from F057. `organization_access_state.bootstrap_established` starts false, may only be set inside a transaction that writes matching audit evidence, and **cannot be cleared** — the database raises an exception on any true-to-false transition. A deferred constraint trigger requires every active bootstrapped Organization to retain at least one effective Access Administrator. Access history, permission deltas and role ownership reject UPDATE, DELETE and TRUNCATE. A database CHECK prevents an actor from approving a change to their own access. Composite foreign keys make a cross-Organization role assignment impossible, and a permission key takes effect only when it is both registered in the `permission` table and recognized by the application allowlist.

What is missing is the production entry point, and the gap is a chain rather than a single command. Organizations and staff identities are created only by development seeding and development provisioning tooling, and the access provisioning command refuses any target that is not a local development database. [F057.4](../../features/F057-4-access-administration-architecture-refresh.md) records this as gap **G1** (no production bootstrap path) and gap **G2** (no break-glass or recovery), both assigned to F057.7 and both recorded as open decisions requiring human approval.

G2 states the recovery problem precisely: the deferred invariant _"guarantees at least one local administrator record, not a usable sign-in."_ In almost every realistic failure the permissions are intact and the **authentication binding** is broken. That observation shapes the decision below.

## Decision

### 1. No bootstrap token

Reqro will **not** use a reusable or web-accessible bootstrap token as the primary production bootstrap mechanism.

Production bootstrap authority comes from **existing trusted infrastructure and deployment authority** executing an explicit production-mode operator CLI. There is no default administrator account, no default password, no hardcoded bootstrap identity and no permanent alternate authentication path.

A token would have to be generated, transmitted, stored, expired, revoked and kept out of logs, and anyone able to deliver it to the server could instead have run the command directly. It adds a bearer secret without adding a security property.

### 2. Bootstrap CLI

The future bootstrap mechanism is a production-capable operator CLI. It must:

- require **explicit environment targeting**, validated against the running configuration;
- **refuse development shortcuts in production**;
- operate through **reviewed service and domain logic**, not arbitrary SQL;
- write **immutable audit evidence**;
- **never embed database credentials** and never accept them as arguments;
- **never expose secrets**, including in output or error text;
- become **unusable for first bootstrap** once initialization has succeeded;
- **fail closed** on any ambiguity.

The existing `bootstrap_established` flag already provides the one-time property: the database refuses to clear it, and re-running bootstrap against an established Organization is rejected. **CLI implementation is not authorized by this record.**

### 3. Platform operator is a separate principal concept

Platform operator authority **must not** be represented as a powerful tenant `staff_identity`. Normal tenant staff remain Organization-bound, and **tenant RBAC must not be capable of manufacturing platform authority by granting ordinary permissions**.

A tenant Access Administrator legitimately manages permissions. Any platform capability expressible as an ordinary permission row is therefore reachable through a legitimate tenant action plus one mistake or one compromise. The boundary must be a structure the tenant grant path cannot write, not a classification on a row it can.

Exact persistence and principal implementation remain for a later reviewed slice.

### 4. Control-plane / data-plane separation

Formalize the following as an architectural principle and a **security boundary**:

```text
Reqro Control Plane
├── deployment administration
├── tenant/domain lifecycle
├── provider/infrastructure configuration
├── administrative recovery
└── platform audit

Tenant Data Plane
├── service requests
├── resident contacts
├── communications
├── workflow/operational records
└── tenant business data
```

**Platform-control authority does not automatically grant tenant data-plane access.** Every control-plane capability listed above is satisfiable without reading tenant business data, and that is the property which makes platform operations compatible with Organization isolation.

### 5. Deployment model

Implement for **isolated deployment-per-tenant first**. ADR-027 **does not authorize shared SaaS hosting or general cross-tenant administration**. [ADR-001](ADR-001-organization-isolation.md) remains in force.

Under deployment-per-tenant there is no cross-tenant plane to protect: one deployment holds one Organization, and the platform operator is the operator of that deployment. The control-plane and data-plane distinction is then enforced by what the tooling does rather than by a multi-tenant authorization model.

### 6. Recovery is identity re-binding

Recovery is approved **only** as a narrowly bounded capability to restore a trusted identity to **already-authorized** administrative authority.

Recovery must not invent new permission keys, silently create broader roles, grant platform authority to tenant staff, create unrestricted resident-data access, bypass audit, or provide persistent local authentication.

Future recovery cases include an administrator's Entra object identifier changing, a trusted administrator account being replaced, a tenant administrator identity mapping becoming broken, and a privileged identity being accidentally disabled. In each the authorization record survives and only the binding to an external identity is broken.

Exact implementation remains separately gated.

### 7. No local authentication fallback

Do **not** introduce local username and password authentication as an Entra backup. An identity-provider outage does not authorize an alternate permanent login path: an outage is temporary, and a local credential path would exist permanently to serve it.

Offline and operator recovery tooling may repair identity bindings, but **normal application authentication remains external-identity based**. This preserves a meaningful property — Reqro stores no credential that can be stolen and replayed as a person.

### 8. Infrastructure authority as trust root

Acknowledge explicitly: **anyone capable of running production bootstrap or recovery tooling already possesses high infrastructure authority.** An unrestricted database administrator can alter schema, disable triggers and rewrite records, so every control described here is subordinate to that authority.

The goal is therefore **not** to pretend application RBAC protects against unrestricted infrastructure or database administrators. The goal is to:

- constrain legitimate operator workflows;
- ensure attribution;
- prevent accidental privilege expansion;
- require auditable, explicit operations;
- avoid hidden backdoors.

This is consistent with the trust boundary [ADR-023](ADR-023-administrative-access-management-controlled-delegation.md) already records: _"PostgreSQL protects structural and transactional integrity. The API and controlled operator boundary authorize the human."_ Defence against database-administrator compromise is an infrastructure-layer concern, including least-privilege runtime roles separate from migration and owner roles, and audit evidence shipped to an append-only store outside the database.

### 9. Production audit requirement

Future platform bootstrap and recovery operations must produce **immutable platform-level audit evidence** containing safe metadata:

operator identity or reference · operation · target Organization · target identity · reason · approval reference where required · correlation ID · timestamp · outcome.

Audit must **never** store bootstrap or recovery secrets, access tokens, credentials, raw Entra claims, or resident data.

### 10. Controlled provisioning attribution gap

Recorded as an implementation prerequisite, not fixed here.

Existing controlled provisioning can record `actor_staff_id IS NULL` without a production-grade operator reason or approval reference. The current database CHECK requires that NULL for the `controlled_provisioning` source, and [ADR-023](ADR-023-administrative-access-management-controlled-delegation.md) explains the intent: the provisioning source _"does not impersonate the target as authenticated actor."_ That is correct for a local operator acting on a synthetic development database.

For production it is insufficient: the audit stream could not state **which human** bootstrapped or recovered a deployment, and there is no reason or approval field anywhere in the access audit schema.

**Future operator-originated actions must carry attributable platform-level identity and evidence rather than anonymous NULL actor semantics.** This is a prerequisite for production bootstrap and recovery and must be resolved before either is implemented. **Do not fix it under this record.**

### 11. Separation of duties

Routine bootstrap and recovery operations may use **one authorized infrastructure operator** where appropriate. High-impact operations **should support independent approval where justified**, with candidates including:

- granting new platform-control authority;
- emergency tenant administrative reset;
- changing trusted Organization identity configuration;
- emergency tenant-data elevation, **if such a capability is ever approved**.

**This record does not authorize emergency tenant-data elevation.**

Software cannot enforce two-person control for the first operator, because at initialization there is nobody to approve. That gate is organizational; the software's contribution is to record it through mandatory reason and approval-reference evidence.

## Relationships to existing decisions

**[ADR-023](ADR-023-administrative-access-management-controlled-delegation.md)** — its statement that _"Emergency break-glass is not implemented"_ **remains factually true**. ADR-027 establishes the accepted architecture for future production bootstrap and recovery; implementation remains separately gated. ADR-023 is preserved in full and is **not** superseded, amended or rewritten by this record. Its bootstrap irreversibility, last-manager invariant, immutable audit and provisioning-source semantics all remain in force.

**[ADR-001](ADR-001-organization-isolation.md)** — Organization isolation and the prohibition on casual cross-tenant administration remain in force. ADR-027 introduces no cross-tenant data administration and no shared-SaaS authorization.

**[ADR-025](ADR-025-trusted-production-organization-resolution.md)** — platform and domain control-plane operations, including tenant-domain registration, verification and activation, may eventually require platform authority. **This does not create tenant data-plane authority.** ADR-025's position that tenant administrators must not activate arbitrary domains is consistent with the principal separation recorded here.

**[ADR-026](ADR-026-outbound-notification-delivery-architecture.md)** — notification provider configuration remains a platform-control concern and **does not grant resident or service-request access**. Its placement of provider configuration outside tenant permissions is an instance of the control-plane principle formalized here.

## Adjacent architecture gap — Organization lifecycle

`organization.status` currently has **no production mutation path**. The value is read throughout authorization predicates, but no service, controller, command or migration changes it, consistent with ADR-023's statement that Organization lifecycle HTTP administration is not introduced.

Tenant activation and deactivation therefore belongs to **future control-plane implementation** and is **not part of bootstrap or recovery implementation**. It is recorded here so the gap has a named owner rather than being discovered during an incident.

## Consequences

Production bootstrap becomes an explicitly operated, auditable event rather than an implicit consequence of deployment, which is slower and intentionally so. Operators gain a narrow, attributable recovery path for broken identity bindings without gaining a second way to authenticate. The control-plane and data-plane split gives future platform capabilities a test to satisfy — an operation that must read tenant business data is not a control-plane operation — which should settle many later decisions by inspection.

Two prerequisites follow directly: operator attribution with reason and approval evidence (decision 10), and a staff-identity lifecycle surface, since bootstrap alone leaves a production tenant unable to add its second employee.

## Security and privacy

The controls recorded here address application-layer threats: application defects, compromised staff accounts, mistaken operators and accidental privilege expansion. They do not, and are not claimed to, defend against an attacker holding unrestricted database administrative access (decision 8).

The highest-ranked residual risks are a database restored from a pre-bootstrap backup, which recreates an unbootstrapped state in a database that already holds tenant data; a recovery or bootstrap action executed against the wrong environment; and a tenant administrator obtaining platform authority through an ordinary permission grant. The first requires post-restore verification before a restored production deployment serves traffic. The second requires explicit environment targeting and confirmation. The third is addressed structurally by keeping platform authority outside the tenant permission graph (decision 3).

Entra remains the only authentication mechanism. Multi-factor authentication and Conditional Access for administrators depend on the customer's Microsoft policy and **cannot be enforced by Reqro**; no customer security policy is assumed or asserted here.

## Testing note

This Claude worktree and session did not have `TEST_DATABASE_URL` configured, so the `server/test/database` suite reported as skipped and not executed during the assessment that preceded this record. The project has previously used an authorized disposable PostgreSQL test environment in another isolated workstream.

Any future migration-bearing bootstrap or recovery implementation **must** run against an explicitly authorized disposable database and **must never** use `reqro_dev` for automated testing. The database tier matters more here than elsewhere, because for bootstrap and recovery the database constraints **are** the security control: one-time bootstrap, irreversibility, audit coupling, self-approval rejection, cross-Organization rejection and the last-administrator invariant are all database-enforced and can only be proven there.

## Related evidence

[ADR-001 — Organization isolation](ADR-001-organization-isolation.md), [ADR-023 — Administrative Access Management and Controlled Delegation](ADR-023-administrative-access-management-controlled-delegation.md), [ADR-025 — Trusted Production Organization Resolution](ADR-025-trusted-production-organization-resolution.md), [ADR-026 — Outbound Notification and Delivery Architecture](ADR-026-outbound-notification-delivery-architecture.md), [F057.4 access administration refresh](../../features/F057-4-access-administration-architecture-refresh.md) recording gaps G1 and G2, the [administrative access foundation migration](../../../server/migrations/20261008000000-add-administrative-access-foundation.ts), the [access foundation service](../../../server/src/access/access-foundation.ts), the [controlled provisioning command](../../../server/src/database/access-administrator-cli.ts), and the [security framework](../../security/SECURITY_FRAMEWORK.md).
