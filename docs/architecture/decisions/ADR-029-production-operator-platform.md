# ADR-029 — First Production Operator Platform

Status: **Proposed, not Accepted.** The repository artifacts described below are implemented under F060.3C-2e-2A and stop for security review.

**What this record selects.** The first concrete implementation of the ADR-028 trusted operator execution contract:

```text
GitHub source repository
  -> Azure DevOps control plane
  -> Microsoft Entra + PIM
  -> one-shot Azure Container Instance in a private VNet
  -> managed-identity token
  -> Azure Database for PostgreSQL Flexible Server
```

**What it does not change.** ADR-028 stays in force and the provider-neutral interfaces stay provider-neutral. `TrustedIdentityAdapter`, `OperatorAuditSink` and `TrustedRunnerAssertion` are untouched as seams; this record picks the first implementation behind them, it does not collapse them.

**What it does not authorize.** No Azure DevOps organization or project, service connection, Entra group, PIM policy, federated credential, managed identity, PostgreSQL server, container instance, registry, VNet, private endpoint, storage account, Log Analytics workspace, Key Vault, DNS record or secret exists, and none is approved by this record. No migration is added. **Production deployment remains unauthorized.**

## Context

F060.3C-2e-2 assessed three platforms and surfaced two facts that decided this.

**GitHub cannot name the human in the form the contract requires.** The GitHub Actions OIDC token's `actor`/`actor_id` identify a GitHub account, not an Entra object ID. ADR-028 requires the recorded subject to be the immutable Entra `oid`, so GitHub Actions can only satisfy the contract through GitHub Enterprise Cloud with Entra SSO/SCIM and a cross-vendor identity join. Azure DevOps organizations are Entra-backed, so the human is a first-party directory principal.

**Execution must happen inside the VNet.** A private PostgreSQL endpoint is unreachable from hosted agents, so the control plane and the execution substrate are separate choices. Keeping them separate turns out to be a security property rather than a compromise: the agent never holds database reachability at all.

## Decision

### 1. Azure DevOps is the control plane; GitHub remains the source of truth

Source control does not move. Azure DevOps consumes the GitHub repository through the Azure Pipelines GitHub App service connection — no PAT, no deploy key. Azure DevOps contributes the authenticated human, the approval gates and the run identity; GitHub contributes the commit.

**GitHub Actions remains a supported alternate future control plane** if GitHub Enterprise Cloud with Entra SAML/SCIM is adopted. The container contract is identical, because the trusted channel is environment variables and the identity adapter is provider-neutral; only the resolution steps differ.

**A hardened administrative runner is emergency/break-fix only** and is not a steady-state production path. It inherits the same contract and the same refusals.

### 2. The acting human is resolved, never asserted

**An Azure DevOps identity ID is not an Entra object ID**, and must never be treated as one. The resolution chain is explicit:

```text
Build.RequestedForId                       (set by the platform, not a parameter)
  -> Azure DevOps Identities API           -> subjectDescriptor
  -> Azure DevOps Graph Users API          -> origin, originId, subjectKind
  -> require origin = aad, subjectKind = user
  -> Microsoft Graph in the expected tenant -> prove directory membership
  -> originId                               = the Entra object ID
  -> iam:<tenant>/<hyphenated-oid>
```

**Fail closed if the principal is not backed by the configured Entra tenant.** Azure DevOps organizations contain principals whose origin is `vsts` (organization-local), `msa` (personal Microsoft account) or `ghb`; none is a directory object and none can be attributed to a named human in the client's directory. The container re-checks this: it requires `REQRO_OPERATOR_IAM_ORIGIN = aad` and the resolved tenant to equal the expected tenant, so a guest, a cross-tenant principal or a mis-targeted control plane is refused rather than recorded.

`userPrincipalName`, `mailAddress` and `displayName` remain **non-authoritative** — they are reassignable, so an audit row written years earlier would resolve to the wrong human. They are recorded as secondary context only.

The container cannot verify that the Graph calls happened; that is the pipeline's responsibility, asserted by the pipeline contract test, which proves no pipeline exposes a human-fillable parameter for any trusted field.

### 3. The requester is bound by a trusted request artifact

**The defect this closes.** `REQRO_OPERATOR_REQUESTER_IDENTITY` was an ordinary environment value, so the operator recording an approval chose who the requester was. Two humans were still structurally required — request and approve are mutually exclusive assignments, and the database refuses `requested_by = approved_by` — but the *recorded* requester was whatever the approver typed. An approval could name a requester who never requested, and the audit trail would show a two-person flow that never happened. That is an attribution-integrity defect.

The request (dry-run) invocation now emits a **provider-neutral trusted request artifact** carrying the requester identity, operation, Organization, hostname, role, expected revision, reason, ticket, correlation ID, commit SHA, image digest, originating run ID, creation time and expiry.

**Integrity.** The artifact's canonical bytes are hashed; the digest travels through the **trusted execution channel** while the content travels as a published, immutable run artifact from a pinned run. The container recomputes the digest over the canonical form and refuses a mismatch. Substituting the artifact therefore requires also controlling the trusted channel — the same boundary every other trusted field already relies on. No signing key is introduced, because a key would need storing, rotating and protecting to buy a property the trusted channel already provides; the canonical form is defined precisely so a deployment can sign it later without changing what is signed.

An approval **derives** the requester from the artifact and **refuses** a human-supplied one. The approver still states the context they believe they are approving, and a mismatch in operation, Organization, hostname or revision is refused rather than resolved in the human's favour. An expired artifact is refused, and a maximum lifetime is enforced on both write and read.

**No database request table and no Migration 50.** The artifact is not persisted by Reqro; approval consumption remains guarded by the existing `tenant_domain_operator_approval` row and its context checks.

### 4. Permission model unchanged

`tenant-domain.request` covers the six non-approve verbs; `tenant-domain.approve` covers `approve` only; `tenant-domain.execute` authorizes no verb and is the additional authority a serving-mode `--confirm` requires; `deployment.migrate` authorizes no tenant-domain verb; `emergency.breakglass` is unimplemented and refused. Request and approve remain mutually exclusive IAM assignments; execute may accompany either. The database `requested_by <> approved_by` check remains the authoritative self-approval control.

### 5. Three invocations, three pipeline definitions

Request, approve and confirm are **separate pipeline definitions**, not stages of one run, so a single queued run can never both request and approve. All three are manual-dispatch only — no push, pull-request or schedule trigger. Approve and confirm run in protected environments with required reviewers. Jobs time out at **15 minutes**, well inside the **60-minute** elevation ceiling.

PIM activation requires MFA, justification and a ticket number, with approval required for the approve and execute roles, and an activation maximum duration of one hour. The pipeline's elevation-evidence step **ships refusing**: the exact Microsoft Graph privileged-access query and its directory permissions are an infrastructure decision that has not been made, and shipping a plausible-looking query would be inventing vendor behaviour. Failing closed is the honest state.

### 6. One-shot container, no interactive shell

An Azure Container Instance in the VNet, `restartPolicy: Never`, image pinned by immutable `sha256` digest, entry point the compiled operator artifact. Trusted fields arrive as environment; the command line carries only the verb, the approved operation and the mode. The agent never reaches the database.

### 7. Managed-identity database authentication

Azure Database for PostgreSQL Flexible Server with Microsoft Entra authentication. The access token *is* the password, and the token→role match is by object ID, so `pgaadauth_create_principal_with_oid('reqro_operator', <identity-oid>, 'service', false, false)` maps the literal role name `reqro_operator` to the job's user-assigned managed identity.

**No human receives a token, no production database password exists, and no database grant changes.** The role name stays literal, so the existing connection-identity assertion is satisfied unchanged. Verified against the code: `DATABASE_URL` accepts the token in the password position and `databaseConnectionOptions` passes it through, so **no database-client source change is required**.

### 8. Two execution network profiles

`verify` is structurally different from every other verb: the verifier discovers a zone's authoritative name servers and queries **each of them directly**, so it needs outbound UDP and TCP 53 to arbitrary internet hosts. Every other verb needs none.

- **`dns-verification`** — the required 53 egress. `verify` only.
- **`restricted`** — no arbitrary internet DNS egress. Every other verb.

The platform declares the profile it started the job under, and the contract checks it **in both directions**: `verify` on the restricted profile is refused, and a mutating verb on the DNS-capable profile is refused too, so that egress is never held by an invocation that does not need it. An unknown verb is refused rather than defaulted.

**The DNS verifier is not weakened.** Its quorum rules, direct authoritative queries and fail-closed disagreement handling are untouched; only where the verb may run is constrained.

### 9. Audit: searchable and immutable are separate concerns

`OperatorAuditSink` stays provider-neutral and the shipped stream adapter is unchanged. **No Azure sink is added in this slice**, because an Azure Storage implementation requires a new SDK dependency and could not be unit-tested without live resources — adding it on those terms would be worse than deferring it.

Searchability (a log workspace) and immutable retention (write-once storage, independently administered, with no delete permission for the operator identity) are separate concerns and should be satisfied separately. Serving remains **fail closed** if the audit start record cannot be established.

**Retention is configurable by client and governance policy, not a Reqro constant.** No duration is compiled in, and the retention period is set on the storage policy rather than in application code, so it is configurable per deployment without a release. The documentation reference baseline is **two years**, pending the client's records-retention requirements, which may well be longer.

### 10. Artifact provenance, replay and DNS least privilege

**Provenance.** The approval flow selects *which* request to approve and can supply nothing else. The source pipeline definition is an infrastructure-owned variable rather than a parameter, so an operator cannot point the download at a pipeline they control; the run is pinned (`buildType: specific`, `buildVersionToDownload: specific`) rather than "latest"; and the artifact content and digest are derived from that download by a step and passed on as step outputs, never as parameters. Every one of the fifteen canonical fields -- including the requester identity, originating run ID, commit SHA, image digest, Organization, hostname, operation and expected revision -- is covered by the digest, so editing any of them is refused. The confirmation flow deliberately takes no artifact: it consumes the approval row the approval flow created, which the database binds to the same context.

**Replay.** The distinction matters and is stated explicitly, because the obvious assumption is wrong:

- **the request artifact is _not_ the single-use object.** It authorizes only the creation of an approval, and it can be presented more than once within its validity window;
- **the resulting approval _is_ single-use.** Consuming it writes its ID into the audit row, and the partial unique index `tenant_domain_approval_single_use` on `tenant_domain_audit(approval_id)` makes a second consumption a unique-index violation. Consumption evidence is the committed audit row rather than a mutable flag on the approval, which keeps the approval immutable;
- **two concurrent mutations cannot both commit the same approval**, for the same reason: whichever transaction commits second violates that index;
- **expected-revision and state preconditions add independent mutation-replay resistance.** Every mutating verb requires the expected revision to still be current, a commit advances it, and the state preconditions (activate requires verified-and-inactive, revoke requires deactivated) refuse a second application;
- **approvals expire** 24 hours after they are recorded, independently of the artifact's own shorter ceiling.

So the *effect* cannot repeat, through these existing controls: the approval is single-use, enforced by the partial unique index `tenant_domain_approval_single_use` on `tenant_domain_audit(approval_id)` -- consumption evidence is the committed audit row rather than a mutable flag, so double spending is a unique-index violation; every mutating verb requires the expected revision to still be current and a committed mutation advances it, so a replayed request is `revision has moved`; and the state preconditions refuse a second application. **No new migration or replay-state table is introduced, because the existing invariants already prevent it.**

**DNS least privilege, stated honestly.** `verify` legitimately needs the database -- it records the verification attempt and the resulting state -- so the isolation is not "no database access". What the container never receives is any *other* authority: no Azure DevOps OAuth token, no Microsoft Graph token, no PIM or directory mutation capability, and no mounted content other than the request artifact. Identity and elevation resolution happen agent-side and pass on resolved values, not credentials. The credential surface does not vary by profile -- one managed identity, no profile-conditional logic in the job template -- so `dns-verification` gains nothing over `restricted` except network egress, which is enforced outside the container. Its database authority remains the unchanged `reqro_operator` grant set from F060.3C-2c-3. **Residual, recorded rather than hidden:** `verify` shares that one operator role with the other verbs, because splitting authority per verb would be a database grant change that this slice does not authorize.

### 11. Production privileged execution is not enabled by this slice

This is the reason ADR-029 stays **Proposed**. All of the following require a separate infrastructure and security decision, and none is made here:

- the exact Microsoft Graph privileged-access query that proves an active elevation;
- the Graph and directory permissions that query requires, and which identity holds them;
- the group, role and elevation policy (eligibility, approvers, MFA, justification, ticket, activation duration);
- live Azure configuration of every resource.

The pipeline's elevation step therefore **ships refusing**, and no plausible-looking query was written in its place. Inventing one would have produced an artifact that looked ready and was not.

## Consequences

Human attribution becomes a first-party directory fact rather than a cross-vendor join, and the recorded requester becomes evidence rather than a claim. The cost is a second platform in the toolchain: Azure DevOps for execution control while GitHub remains the source of truth, which means two sets of permissions to administer.

The elevation-evidence gap is now explicit and failing closed rather than implied. That is the most likely next blocker.

## Security and privacy implications

A non-directory or cross-tenant principal can no longer be recorded as an operator. An approver can no longer name a fictitious requester. DNS egress is scoped to the one verb that needs it. No credential is introduced anywhere: no PAT, no database password, no signing key, and no token reaching a human. No authorization semantics, permission key, schema change, migration or database grant is modified, and fail-closed behaviour is preserved throughout.

Residual risks, stated rather than implied: runner trust remains a consistency check, not an authentication; immutable off-host retention does not exist yet; and Reqro still authenticates nobody.

## Related evidence

- [ADR-028 — Trusted production operator execution](ADR-028-trusted-production-operator-execution.md)
- [ADR-027 — Platform operator bootstrap and recovery](ADR-027-platform-operator-bootstrap-recovery.md)
- [ADR-025 — Trusted production Organization resolution](ADR-025-trusted-production-organization-resolution.md)
- [F060.3C-2e — Trusted production operator execution](../../features/F060-3C-2E-trusted-operator-execution.md)
- [Tenant-domain operator runbook](../../operations/TENANT_DOMAIN_OPERATOR_RUNBOOK.md)
- [CityVUE security framework](../../security/SECURITY_FRAMEWORK.md)
