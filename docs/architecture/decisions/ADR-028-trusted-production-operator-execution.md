# ADR-028 — Trusted Production Operator Execution

Status: **Accepted** — approved at security architecture review on 2026-10-09.

**What acceptance means.** Accepted means the **Reqro trusted operator execution contract** is accepted: where the actor comes from, what must be true before the first mutation, how authority is split, and which parts are deliberately not Reqro's to implement. The provider-neutral Reqro side is implemented under F060.3C-2e-1.

**What acceptance does not mean.** Acceptance is **not** authorization to deploy, and it does **not** mean any of the following production infrastructure exists. None of it does:

- Entra / privileged-identity-management configuration
- real OIDC federation
- a protected production runner
- immutable off-host audit retention
- a production secret manager
- production database authentication
- a production network boundary

No cloud resource, identity-provider group, PIM policy, CI workflow, service principal, OIDC federation, secret, production database user or grant change is approved by this record, and none exists. **Production deployment remains unauthorized.**

**Relationship to ADR-027.** ADR-027 decision 10 named per-human IAM, just-in-time elevation and invocation audit as prerequisites for production operator execution and left them to infrastructure. This record does not move that boundary. It defines the *contract* Reqro enforces against whatever infrastructure supplies, so the prerequisite becomes checkable rather than assumed.

## Context

F060.3C-2b built the production-capable tenant-domain operator command. F060.3C-2c-3 proved a least-privilege operator database role, and F060.3C-2d separated the owner, migration and runtime database identities. The database side is as narrow as it can usefully be made.

The remaining gap was never a database gap. It was that the command's notion of *who is acting* was a human-editable environment value:

```
REQRO_OPERATOR_IDENTITY=iam:someone
```

The command validated that string's shape and refused a `dev:` scheme in a serving environment, and its own documentation said plainly that this records attribution and never authentication. That is honest, but it means the production audit trail's actor field is whatever the person running the job typed. Every control downstream — the independent-approval requirement, the `requested_by <> approved_by` constraint, the audit record — is anchored to a value the acting human chooses. Two-person control over a field one person writes is not two-person control.

Three further properties were absent. Nothing bounded how long an elevation remained usable, so a credential or job definition obtained once stayed usable indefinitely. Nothing recorded which code actually ran, so an audit record could not be tied to a reviewed artifact. And nothing recorded that an invocation was *attempted*: `tenant_domain_audit` exists only if the mutation reached the database, so a refused or crashed production invocation left no trace at all.

## Decision

### 1. Humans choose the action, never the actor

Every input to a production operator invocation belongs to exactly one of two disjoint channels.

**Trusted execution metadata** — identity, granted permissions, elevation window, runner identity and platform, job run identifier, commit SHA, image digest — is injected by infrastructure. It is not settable through a command argument, and no ordinary operator environment field overlaps it. Disjointness is asserted structurally rather than asserted in prose.

**Human-selectable operation inputs** — the verb, the mode, the approved operation, the Organization, the hostname, the domain role, the expected revision, the approval identifier — are chosen freely and validated as before, together with the human-authored reason and correlation identifier.

In a serving environment `REQRO_OPERATOR_IDENTITY` is **refused outright**, not ignored. An identity identical to the derived one is refused too, so the rule is "you do not set the actor" rather than "you may set it if you guess correctly". Outside a serving environment the gated `test` target keeps the F060.3C-2b attribution path unchanged, which is why that target may never name a non-test database.

### 2. The recorded identity is the immutable subject, in a database-compatible form

The canonical recorded identity is `iam:<issuer-or-tenant-id>/<hyphenated-subject>`. For Microsoft Entra ID the subject is the immutable `oid` claim — never a UPN, mail address or display name, all of which are reassignable and would make an old audit row resolve to the wrong human. Display name and email are recorded as secondary context and are never a key.

**The format is constrained by the database, not by preference.** Migration 47 requires `~ '^(iam|oidc|dev):[A-Za-z0-9][A-Za-z0-9._@/+-]{1,180}$'` and `!~ '[A-Za-z0-9]{32,}'` on `operator_identity`, `requested_by` and `approved_by`. A bare 32-hex GUID is a 32-character alphanumeric run and would be **rejected by the database**, so the hyphenated form is mandatory rather than cosmetic.

Consequently, **arbitrary OIDC `sub` values are not claimed to be supported.** An opaque base64url subject is a long alphanumeric run and is refused at the boundary with a distinct code, rather than written and rejected by a constraint. A future provider's compatibility is proven at the adapter, not assumed. Identity remains a provider-neutral adapter boundary with Entra as the first adapter.

### 3. Five permissions on two independent axes, and `tenant-domain.request` never authorizes `approve`

| Permission | Authorizes |
| --- | --- |
| `tenant-domain.request` | the six non-approve verbs: `register`, `issue-challenge`, `verify`, `activate`, `deactivate`, `revoke` |
| `tenant-domain.approve` | `approve`, **and nothing else** |
| `tenant-domain.execute` | no verb of its own; the **distinct** authority `--confirm` requires |
| `deployment.migrate` | no tenant-domain verb and no commit; **distinct** migration authority |
| `emergency.breakglass` | nothing. **Unimplemented**, and presenting it is refused |

Authority is split along two axes and a permission belongs to exactly one. *Verb authority* (`request`, `approve`) says which operation may be performed. *Execution authority* (`execute`) says whether a change may be **committed** rather than only planned. A `--dry-run` needs only the verb, which is how a requester produces the pre-approval plan a second operator reviews; `--confirm` additionally requires `tenant-domain.execute`.

The practical effect is that deciding *what* should change, approving it, and actually applying it to a serving deployment can be held by three different people, and none of the three is implied by either of the others.

**`tenant-domain.request` and `tenant-domain.approve` are intended to be mutually exclusive IAM assignments**; `tenant-domain.execute` may coexist with either. That exclusivity is a **grant-assignment rule, enforced where grants are assigned**, and Reqro deliberately does not refuse an elevation carrying both: refusing would introduce a new authorization semantic, and the authoritative self-approval control already exists in the database. Migration 47's `requested_by <> approved_by` check, together with the operations layer's refusal to consume an approval whose approver is the acting operator, remains the enforcement that holds even when the IAM assignment rule is violated.

**`tenant-domain.request` must never authorize `approve`.** A permission that let the requester also approve would collapse two-person control into one. The authorization check is made against the chosen verb, so recording an approval *for* `activate` requires `tenant-domain.approve`; holding activate authority grants no part of it.

Holding both permissions is still not self-approval. **Migration 47's `requested_by <> approved_by` enforcement and the refusal to consume an approval whose approver is the acting operator remain the authoritative control**; the permission split is independent defence in depth over the same property, and neither is load-bearing alone.

`deployment.migrate` is named here precisely so it can be shown to confer nothing in this path: migration authority must never be reusable as control-plane change authority. `emergency.breakglass` is named so its absence is explicit — **no break-glass capability exists anywhere in Reqro**, and an invocation presenting that permission is refused outright rather than silently proceeding on whatever other authority it holds, because an operator acting on a false belief about their powers must be told so.

### 4. Elevation is just-in-time and bounded

An invocation must present a live elevation window: granted in the past (allowing a minute of clock skew), not yet expired, and no wider than **60 minutes**. A window wider than the ceiling is **refused, not trimmed**, because an over-wide grant is an IAM policy error and silently narrowing it would conceal that. The recommended infrastructure job timeout is **15 minutes**, deliberately far below the ceiling so a job cannot outlive the elevation that authorized it; a process cannot bound its own wall clock, so that timeout is asserted by the runner and not by Reqro.

### 5. Code provenance requires both a commit SHA and an image digest

A full 40-character commit SHA and an immutable `sha256:` image digest are both required. A branch name, a mutable tag such as `:latest`, or a short SHA is **not provenance** and is refused. A SHA alone does not say what ran; a digest alone does not say what it was built from.

### 6. Invocation audit is a separate trail, and it fails closed

Two audit trails exist and answer different questions. `tenant_domain_audit` records what changed and exists only if the mutation reached the database. The infrastructure invocation trail records that an invocation was attempted — by whom, under what elevation, on what runner, from what code — written before anything is attempted and again when the outcome is known. A refusal, a crash and a dry run all leave a record there.

**In a serving environment, execution does not begin if the start record cannot be established.** There is no silent fallback to "no audit", because an unobserved production mutation is precisely what this boundary exists to prevent. A lost *outcome* record is reported rather than thrown, so an audit failure never replaces the real failure; the start record already proves the invocation happened, and an outcome gap is visible as a record with no partner.

No secret may enter a record. Payloads are assembled field by field from an allowlist and re-checked before emission; `DATABASE_URL`, passwords, tokens, authorization headers and secret-manager payloads are not read by the audit path at all.

### 7. Runner trust is an adapter, and its current strength is stated honestly

The runner asserts its own identity; infrastructure declares which identity is trusted; Reqro asserts they agree. **This is a consistency check, not an authentication of the runner.** Both values arrive through the same environment, so it reliably catches the artifact being executed outside its intended job definition, a job copied between deployments, and a misconfigured runner — and it cannot catch a runner whose environment an attacker already controls. Making the runner independently verifiable requires a signed workload assertion from the platform, which is provider-specific and out of scope; the adapter shape is what lets it be added later without touching the operator path.

### 8. There is no workstation path

A serving invocation that cannot produce complete trusted context is refused. No flag, environment value or development shortcut relaxes that, and none was added. The intended execution model remains a one-shot job inside the target deployment running the **compiled** operator artifact from a digested image, not a working tree transpiled on the fly.

### 9. Runner, cloud and identity-provider selection are deliberately deferred

This record selects no CI system, cloud provider, log store or secret manager, and creates nothing. Choosing between GitHub Actions, Azure DevOps or another runner, creating identity-provider groups, configuring privileged identity management, establishing OIDC federation, provisioning production database users and establishing immutable off-host log retention are each separately gated decisions.

## Consequences

Production operator execution becomes refusable on evidence rather than trusted by convention: an incomplete deployment configuration, a stale elevation, an unexpected runner, unprovenanced code, an insufficient grant, an attempted actor override and an unavailable audit sink are each a distinct closed failure code in job logs.

The cost is that a serving invocation now has eleven infrastructure prerequisites plus a trusted-runner declaration and an audit adapter, all of which must be configured before anything works. That is intentional: the alternative is a partial mode, and a partial mode would be the path every incident takes.

**Immutable off-host retention remains an open infrastructure blocker.** The only implemented adapter writes structured records to the process's error stream, so durability is the runner's log pipeline. That is not immutable retention and is not claimed to be. Production remains blocked until a real, independently administered, off-host, immutable and retention-controlled sink exists; the adapter interface is not a substitute for one.

## Security and privacy implications

The production audit actor stops being human-editable. Elevation becomes time-bounded. Audit coverage extends to attempted and refused invocations, not only committed ones. Code provenance becomes verifiable. No new authorization semantics, permission key, schema change or migration is introduced, no database grant is modified, and fail-closed behaviour is preserved throughout. React remains no part of this boundary.

The honest residual risks are recorded above rather than in a footnote: Reqro authenticates nobody, runner trust is a consistency check, and audit durability is the runner's.

## Related evidence

- [F060.3C-2e — Trusted production operator execution](../../features/F060-3C-2E-trusted-operator-execution.md)
- [Tenant-domain operator runbook](../../operations/TENANT_DOMAIN_OPERATOR_RUNBOOK.md)
- [ADR-027 — Platform operator bootstrap and recovery](ADR-027-platform-operator-bootstrap-recovery.md)
- [ADR-025 — Trusted production Organization resolution](ADR-025-trusted-production-organization-resolution.md)
- [ADR-023 — Administrative access management](ADR-023-administrative-access-management-controlled-delegation.md)
- [F060.3C-2d — Database role separation](../../features/F060-3C-2D-database-role-separation.md)
- [CityVUE security framework](../../security/SECURITY_FRAMEWORK.md)
