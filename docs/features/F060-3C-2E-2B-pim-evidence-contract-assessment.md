# F060.3C-2e-2B — Microsoft Entra PIM evidence contract assessment

**Design and research only. Nothing was implemented, configured or provisioned.** Baseline `6c9f5df05b5c8bfbadf0771f867a35fe35026843` (authoritative `main`, which carries both ADR-029 and ADR-030).

**Review status: APPROVED WITH REQUIRED REVISION**, architecture review 2026-10-09. The required revision — **role-assignable** groups in place of non-role-assignable ones — is incorporated throughout, with the reasoning and the newly verified Microsoft facts behind it recorded in §1.6 and §2.2. The remaining required clarifications are incorporated in §2.3, §2.4, §2.7, §2.8 and §4.1.

**Inputs, not modified by this assessment:** [ADR-029 — First Production Operator Platform](../architecture/decisions/ADR-029-production-operator-platform.md) (`Proposed`) and [ADR-030 — Production Serving Contract](../architecture/decisions/ADR-030-production-serving-contract.md) (`Accepted with conditions`).

**Scope boundary.** F060.4A-2A (Production Serving Configuration) has landed on `main` as ADR-030. This assessment changes exactly one file — itself — and edits no serving implementation, no serving feature report, neither ADR, and not the ADR index.

**The question this assessment answers.** ADR-029's pipeline elevation step ships refusing, deliberately, because the authoritative way to answer one question had not been established:

> Is *this specific authenticated human* currently authorized, through Microsoft Entra Privileged Identity Management, to perform *this privileged operation*?

Everything below separates **verified Microsoft behaviour** (cited), **architectural recommendation** (mine), **unresolved decisions** (for the security team) and **future implementation work**.

---

## Part 1 — Verified Microsoft behaviour

Every statement in this part is from current official Microsoft documentation, cited at the end. Where the documentation is ambiguous or internally inconsistent, that is stated rather than resolved by guesswork.

### 1.1 Two candidate Graph surfaces exist, both on `v1.0`

**Directory roles (Model A)**

```http
GET https://graph.microsoft.com/v1.0/roleManagement/directory/roleAssignmentScheduleInstances
```

Returns `unifiedRoleAssignmentScheduleInstance`. Documented as "the instances of **active** role assignments", explicitly including both those made through PIM activation requests **and** those made directly through the role assignments API. Supports `$select`, `$filter`, `$expand`; no filter is required.

**PIM for Groups (Model B)**

```http
GET https://graph.microsoft.com/v1.0/identityGovernance/privilegedAccess/group/assignmentScheduleInstances?$filter=groupId eq '{groupId}'
GET https://graph.microsoft.com/v1.0/identityGovernance/privilegedAccess/group/assignmentScheduleInstances?$filter=principalId eq '{principalId}'
```

Returns `privilegedAccessGroupAssignmentScheduleInstance`. **`$filter` (`eq`) is required**, scoping to a `principalId` or a `groupId`.

### 1.2 A standing assignment is indistinguishable from an activation unless you check `assignmentType`

This is the single most important verified fact, and the one most likely to be got wrong.

Both endpoints return **active** assignments, which include permanent and time-bound *standing* assignments as well as genuine just-in-time activations. In the documented Model A sample response, permanent Global Administrator holders appear with `assignmentType: "Assigned"` and `startDateTime: null, endDateTime: null`. In the Model B sample, one member has a bounded window and `assignmentType: "Assigned"` — a *time-bound standing assignment*, not an activation.

So:

| Discriminator | Model A | Model B |
| --- | --- | --- |
| `assignmentType` | `Assigned` \| `Activated` (documented as `String`, capitalised), `$filter` `eq`/`ne` | `assigned` \| `activated` \| `unknownFutureValue` (documented as enum `privilegedAccessGroupAssignmentType`, lower-case), `$filter` `eq` |
| `activatedUsing` | relationship to `unifiedRoleEligibilityScheduleInstance`; **`null` unless the instance came from activating an eligibility**; supports `$expand` | relationship to `privilegedAccessGroupEligibilityScheduleInstance`; **`null` otherwise** |
| `memberType` | `Inherited` \| `Direct` \| `Group` | `direct` \| `group` \| `unknownFutureValue` |
| Scope field | `directoryScopeId` / `appScopeId` | `groupId`, plus `accessId` = `owner` \| `member` \| `unknownFutureValue` |

**`activatedUsing` is a stronger discriminator than `assignmentType` alone**, because it is *provenance*: a non-null value means this instance exists because an eligibility was activated. Checking both is belt and braces.

**But how it is retrieved is not settled, and the asymmetry above is real.** `activatedUsing` is a **Graph relationship, not a property**, so it must **not** be assumed to appear in the default `assignmentScheduleInstances` response. Microsoft documents `$expand` support for `activatedUsing` on the *directory-role* resource (`unifiedRoleAssignmentScheduleInstance`); the *PIM-for-Groups* resource documents `$expand` for its `group` and `principal` relationships but **says nothing about `$expand` on `activatedUsing`**. An earlier draft of this assessment assumed the expansion was available on the group resource; that assumption was unsupported and has been removed.

Consequently **no `$expand` or query contract for activation provenance is proposed here**, because doing so would be inventing vendor behaviour. The implementation slice must **prove, from documented Microsoft behaviour and real-tenant validation, how activation provenance is actually retrieved** — whether by expansion, by a separate `Get` on the instance, by a correlated read of the eligibility schedule instances, or not at all. **If activation provenance cannot be retrieved or validated, authorization must fail closed.** This is recorded in the unresolved decisions (Part 3) and the real-tenant validation list (§4.2).

**Merely checking group membership is insufficient**, and this is worth stating because it is the obvious shortcut. During a PIM-for-Groups activation the human genuinely *is* a member of the group, so `GET /groups/{id}/members` would return them — but it would equally return a permanently assigned member who never activated anything. Membership proves nothing about just-in-time elevation.

### 1.3 Two documented inconsistencies, flagged rather than resolved

1. **Enum casing differs between the two resources.** Model A documents `Assigned`/`Activated`; Model B documents `assigned`/`activated`, yet Model B's own sample response shows `"assignmentType": "Assigned"`. Implementation must therefore compare case-insensitively and must not depend on the casing of either.
2. **Model B documents `startDateTime` and `endDateTime` as "Required"**, yet its sample response shows `null` for both on a permanent assignment. For an *activated* instance a bounded window is expected, but code must treat a null or absent window as evidence that is **not** usable rather than as an open-ended grant.

Both are documentation ambiguities. Neither should be resolved by assumption; both should be confirmed against a real tenant during implementation UAT.

### 1.4 Permissions, verified

| Model | Least-privileged permission | Delegated | Application | Higher-privileged alternatives |
| --- | --- | --- | --- | --- |
| A | `RoleAssignmentSchedule.Read.Directory` | ✅ | ✅ | `RoleAssignmentSchedule.ReadWrite.Directory`, `RoleManagement.Read.All`, `RoleManagement.Read.Directory`, `RoleManagement.ReadWrite.Directory` |
| B | `PrivilegedAssignmentSchedule.Read.AzureADGroup` | ✅ | ✅ | `PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup` |

Both least-privileged permissions are available as **application** permissions, which is what a workload identity needs. Delegated access additionally requires the signed-in user to hold a supporting directory role (Model A: Global Reader, Security Reader/Operator, Security Administrator or Privileged Role Administrator for reads) — irrelevant to the app-only path recommended below, but relevant if anyone later proposes delegated access.

PIM for Groups supports both role-assignable and non-role-assignable groups; the documented delegated-role requirements differ between the two cases.

### 1.5 Role-assignable groups are materially better protected — verified

This is the evidence behind the required revision. A group created with `isAssignableToRole = true` carries protections an ordinary security group does not, **independently of whether any directory role is ever assigned to it**:

| Verified property | Consequence for Reqro |
| --- | --- |
| `isAssignableToRole` can be set **only at creation** and is **immutable**; an existing group cannot be converted | The authorization groups cannot be silently swapped for weaker look-alikes, and their protected status cannot be downgraded later |
| Creating one requires at least **Privileged Role Administrator** | Not something a general group administrator can mint |
| Membership is managed by Privileged Role Administrators by default, delegable only through explicit group owners | The eligible population is administered by a deliberately small set of principals |
| Via Microsoft Graph, managing membership requires **`RoleManagement.ReadWrite.Directory`** — **`Group.ReadWrite.All` will not work** | A compromised or over-permissioned group-management app **cannot** add itself to a Reqro authorization group. This is the single strongest protection gained |
| Membership type must be **Assigned**; dynamic membership is **not allowed** | No rule-based automation can populate the group |
| **Group nesting is not supported** — a group cannot be a member of a role-assignable group | `memberType = direct` becomes **structurally guaranteed** by Entra, not merely checked by Reqro |
| Changing credentials, resetting MFA or modifying sensitive attributes of members and owners requires **Privileged Authentication Administrator** | Closes the credential-reset path to impersonating an eligible operator |
| Deletion is soft, restorable within 30 days by group owners | Accidental deletion is recoverable rather than an outage |
| Maximum **500** role-assignable groups per tenant | Four groups is immaterial against that limit |

Microsoft's own guidance for groups used for elevation states that they should be created as role-assignable and that an **approval process for eligible member assignments** should be required.

**Crucially: `isAssignableToRole = true` only makes a group *capable* of holding a directory role. Assigning a role is a separate, deliberate act.** Reqro's four groups will have **no Microsoft Entra directory role assigned**, so they confer no directory authority whatsoever — they remain pure Reqro authorization assertions, now wrapped in Entra's strongest group-management protections. That is exactly the intent of the required revision.

### 1.6 What the documentation does **not** settle

- Whether `$filter` on the Model B endpoint accepts a **conjunction** (`groupId eq '…' and principalId eq '…'`). The documentation states the filter is required and scopes to "a **principalId** or a **groupId**", and shows only single-predicate examples. **Treat the conjunction as unverified.**
- Graph throttling limits and retry semantics for these specific endpoints.
- Licensing: PIM requires Microsoft Entra ID P2 or an equivalent governance SKU. Not re-verified here; it must be confirmed as a prerequisite.

---

## Part 2 — Architectural recommendation

### 2.1 Authorization model: **Model B — PIM for Groups** (recommended)

| Criterion | Model A — directory role | **Model B — dedicated role-assignable group, no role assigned** | Verdict |
| --- | --- | --- | --- |
| Least privilege | Activating a *directory role* grants real Entra powers (read or administer directory objects) that Reqro does not need and cannot revoke | A dedicated role-assignable group **with no directory role assigned grants nothing anywhere**. It is a pure authorization assertion that only Reqro interprets, while gaining Entra's strongest group-management protections (§1.5) | **B, decisively** |
| Operational simplicity | Reuses built-in roles; tempting but overloads a role with a second meaning | Four purpose-named groups, one per Reqro permission. Creation needs Privileged Role Administrator and the type is immutable, so provisioning is deliberate and one-time | B |
| Auditability | Role activation audited, but the role's meaning is shared with other systems | Group is single-purpose, so every activation means exactly one thing | B |
| Graph queryability | No required filter; large tenant-wide result set to page through | Required `$filter` bounds the query to one small dedicated group; `assignmentType`, `accessId`, `memberType` all `$filter`-able | B |
| Azure DevOps integration | Identical — both are app-only Graph reads from the pipeline | Identical | tie |
| Requester/approver separation | Would need distinct directory roles, forcing unrelated privilege onto each party | One group per Reqro permission, so separation is expressed directly | B |
| Cross-tenant safety | Identical — both scoped by the tenant of the token | Identical | tie |
| Portability of Reqro's design | Role IDs are Microsoft's; the concept does not generalise | A group is just an opaque "authorization set" ID — the nearest equivalent exists in every IdP | B |
| Proving active elevation | `assignmentType` + `activatedUsing` | `assignmentType` + `activatedUsing` + `accessId` + `memberType` | B (slightly) |

**Recommendation: Model B.** The deciding argument is least privilege, and it is not close. Under Model A, to express "may approve a tenant-domain change" we would have to elevate a human into a Microsoft-defined directory role that grants *actual directory authority* — authority Reqro neither needs nor controls, granted to satisfy a check Reqro performs itself. Under Model B the group confers nothing; it exists only to be asserted, and PIM supplies the MFA, approval, justification and time-bounding workflow around it. The group is the *marker*, not the *power*.

The bounded `$filter` is a real secondary benefit: querying one dedicated group exposes only the membership of a group whose entire purpose is this, rather than requiring the ability to enumerate tenant-wide role assignments.

**Model C — considered and rejected.** Authentication-context / Conditional Access step-up (`acrs` claim) was examined as a materially different approach. It proves a human satisfied a CA policy *at token issuance* for an interactive session, but the Reqro flow's actor is resolved from an Azure DevOps queue event, not from a token Reqro receives, so there is no end-user token to carry an `acrs` claim. It is a potential *additional* control on the Azure DevOps sign-in path, not a substitute for PIM evidence. Recorded as a future option, not a recommendation.

### 2.2 Group topology

Four groups, mapping one-to-one onto the existing permission model; `emergency.breakglass` deliberately gets **no group**, preserving its unimplemented-and-refused status.

| Reqro permission | Entra group (dedicated, **role-assignable with no directory role assigned**, PIM-managed) |
| --- | --- |
| `tenant-domain.request` | `reqro-tenant-domain-request` |
| `tenant-domain.approve` | `reqro-tenant-domain-approve` |
| `tenant-domain.execute` | `reqro-tenant-domain-execute` |
| `deployment.migrate` | `reqro-deployment-migrate` |
| `emergency.breakglass` | **none — unimplemented** |

Each group is created with `isAssignableToRole = true` and is **never assigned a Microsoft Entra directory role**. The role-assignable flag is used solely for the management protections in §1.5 — above all that membership can only be changed with `RoleManagement.ReadWrite.Directory`, so `Group.ReadWrite.All` cannot reach it — and never to grant Microsoft directory authority.

Request and approve remain **mutually exclusive eligibility assignments**, enforced where eligibility is granted. Nothing about this assessment weakens that, and the database `requested_by <> approved_by` check remains the authoritative self-approval control.

Who may *own and administer* these groups is itself privileged authority, and is a separate trust boundary — see §2.13.

**Ordinary or direct group membership never grants Reqro production authority.** Standing membership — permanent or time-bound — confers nothing. Only a *verified active PIM activation* satisfying every condition in §2.4 authorizes an operation. This is stated as a requirement, not an implementation detail, because it is the property the entire design rests on: during an activation the human genuinely *is* a member, so membership alone can never be the test (§1.2).

### 2.3 The authoritative identity

**Unchanged and preserved: the Entra object ID (`oid`) resolved by the existing ADR-029 chain.** Both Graph surfaces key on `principalId`, which *is* the directory object ID — so no translation is required, and the existing authority chain feeds the PIM lookup directly.

The PIM lookup must **never** key on a UPN, email address, display name, Azure DevOps display identity or any manually supplied value. Those are reassignable; `principalId` is not.

**Recommended query shape — the documented single-predicate `groupId` scope only.** No compound filter is used, and none may be relied upon:

```http
GET /v1.0/identityGovernance/privilegedAccess/group/assignmentScheduleInstances
  ?$filter=groupId eq '{reqroGroupId}'
  &$select=id,principalId,groupId,accessId,memberType,assignmentType,startDateTime,endDateTime,assignmentScheduleId
```

**Activation provenance is deliberately absent from this query.** `activatedUsing` is a relationship whose retrieval mechanism on this resource is unproven (§1.2), so no `$expand` is specified. How the implementation obtains provenance is an open item it must settle against documented behaviour and a real tenant, and until it does, the predicate condition that depends on it refuses.

**Every other condition is then matched locally**, against the response. This is a requirement, not an optimisation:

- the `groupId and principalId` conjunction is **undocumented** (§1.6), so the implementation must not depend on it;
- adding `assignmentType` to the filter would be a *second* predicate and therefore the same undocumented dependency, even though `assignmentType` is individually filterable;
- filtering by `groupId` rather than `principalId` is deliberate least exposure: the response is bounded to one small purpose-built group, rather than returning everything a given human is privileged for across the tenant.

Local matching must find **exactly one** instance whose `principalId` equals the previously verified Entra `oid`, and that instance must satisfy all of §2.4.

### 2.4 Acceptance predicate — all conditions required

A qualifying PIM evidence record must match **all** of the following. Anything else refuses; there is no partial credit and no permissive fallback.

1. **`groupId` equals the exact infrastructure-configured group** for the permission being exercised.
2. **`principalId` equals the exact, previously verified Entra principal ID** (`oid`) from the ADR-029 identity chain.
3. **`accessId` = `member`** (never `owner`).
4. **`memberType` = `direct`** (never `group`). Entra additionally forbids nesting in role-assignable groups (§1.5), so this is belt and braces.
5. **`assignmentType` semantically = `activated`** — see the casing rule below.
6. **Activation provenance is retrieved and non-null** — `activatedUsing` present and not null, evidencing that the instance exists because an eligibility was activated. Because `activatedUsing` is a **relationship** and its retrieval mechanism on this resource is unproven (§1.2), this condition **fails closed whenever provenance cannot be retrieved, cannot be parsed, or cannot be validated** — an unobtainable provenance is treated exactly like an absent one, never as "not applicable".
7. **Activation start is present and valid**, and not in the future beyond the clock-skew allowance.
8. **Activation end is non-null and valid.** A null, absent or unparseable end is **not** an open-ended grant; it is unusable evidence (§1.3).
9. **Current time is inside the activation window**, within the clock-skew allowance.
10. **Sufficient activation lifetime remains for the execution window** — see §2.7.
11. Exactly **one** instance matches. Zero → refuse. More than one → refuse as **ambiguous**; never select one.

Plus, as preconditions on the evidence itself: Graph returned `200` with a parseable collection; the querying token's tenant equals the configured expected tenant and matches the tenant of the resolved identity; and the evidence is fresh (§2.7).

**Defensive handling of Microsoft's documented enum-casing inconsistency (§1.3).** The two resources document opposite casing, and Model B's own sample response contradicts its own enum table. The implementation must therefore:

- normalize casing **only for the known documented values** — for `assignmentType`, the set `{assigned, activated}`; for `accessId`, `{owner, member}`; for `memberType`, `{direct, group}`;
- **fail closed on anything else**, including `unknownFutureValue`, an empty value, an absent property or any value outside those sets.

A value that cannot be mapped to a known documented member is not "probably fine in a different case" — it is unrecognised evidence, and unrecognised evidence refuses. Normalization is a casing accommodation, never a tolerance for unknown values.

### 2.5 Permissions analysis

**Recommended: exactly one application permission —** `PrivilegedAssignmentSchedule.Read.AzureADGroup`.

| | |
| --- | --- |
| Type | **Application** (app-only), on a dedicated workload identity |
| Admin consent | **Required** (tenant-wide application permission) |
| Why necessary | It is the documented least-privileged permission for the one endpoint that can distinguish an activation from a standing assignment |
| What else it exposes | PIM-for-Groups assignment schedules across groups in the tenant — i.e. who is assigned or activated into which PIM-managed groups, and when. It does **not** grant group management, nor read of user profile attributes, nor directory role data |
| Narrower alternative | **None exists at the Graph permission level.** Graph permissions are not scopable to a single group. The practical narrowing is architectural: isolate the permission on a workload identity that does nothing else |

**Rejected as unnecessarily broad:** `RoleManagement.Read.All` and `RoleManagement.Read.Directory` (Model A's higher-privileged options) expose all directory role assignment data; `*.ReadWrite.*` in either family would grant the ability to *create* elevations, which is categorically wrong for a read-only evidence check. If Model A were ever chosen instead, the equivalent minimum is `RoleAssignmentSchedule.Read.Directory` and nothing wider.

**Not required and must not be added:** `User.Read.All`, `Directory.Read.All`, `Group.Read.All`. The existing ADR-029 identity step already proves tenant membership; nothing here needs profile attributes.

### 2.6 Querying identity — a dedicated Graph-reader workload identity

| Candidate | Assessment |
| --- | --- |
| The existing Azure DevOps federated service connection identity | Already used for ACI orchestration. Adding Graph directory-read to it **merges two authorities** — "can start containers" and "can read who is elevated" — into one principal. Rejected |
| The ACI managed identity (holds the PostgreSQL token) | Would put Graph credentials **inside the mutation container**. Rejected on the same reasoning that kept every other token out of it |
| **A dedicated Graph-reader workload identity** | Holds exactly one application permission, can start nothing and mutate nothing, reachable only from the pipeline through its own federated credential. **Recommended** |

**The human operator never receives a Graph token.** The mutation container does not receive Graph credentials, because it does not need them under the pre-flight design below.

**Evidence resolution happens in the pipeline, immediately before the container starts** — in a step that holds the Graph-reader credential and emits only bounded evidence into the existing trusted channel. This preserves the established trust model exactly: the container continues to receive *resolved values, never credentials*.

### 2.7 Evidence contract — minimal, and placed deliberately

Each field is justified; anything merely *available* was left out.

| Field | Where it belongs | Why |
| --- | --- | --- |
| verified Entra `oid` | runtime claims (**already exists**) | the actor |
| tenant ID | runtime claims (**already exists**) | cross-tenant refusal |
| authorization model (`pim-group`) | runtime claims | lets the contract refuse evidence from a model it does not implement |
| required group ID | runtime claims | the permission actually proven |
| activation instance ID (`id`) | runtime claims + audit | the single citable identifier for this elevation |
| activation start / expiry | runtime claims | window enforcement and the job-timeout margin check |
| evidence retrieved at | runtime claims | freshness enforcement; the anti-staleness control |
| evidence source + contract version | runtime claims | lets a future format change fail closed rather than be misread |
| requester activation instance ID + expiry | **canonical request artifact** | proves the requester was elevated *when planning*; digest-bound, so unforgeable |
| approver activation instance ID + expiry | **approval evidence** | proves the approver was elevated *when approving* |
| Graph `client-request-id` | **restricted audit telemetry only** | support correlation; of no authorization value |
| group display name, UPN, mail, display name, job title, manager | **nowhere** | reassignable or irrelevant; IDs carry the meaning |
| access tokens, `Authorization` headers, raw Graph payloads | **nowhere, ever** | credentials and unbounded third-party data |

**Freshness, and the lifetime margin.** Two separate rules, both required:

1. **Evidence age.** Evidence carries `evidenceRetrievedAt`, and the contract refuses it if older than a tight bound. **120 seconds is proposed and is explicitly provisional**, pending final implementation review — it is a starting point chosen to be comfortably longer than a Graph round trip and container start, and much shorter than any elevation, not a measured value.
2. **Remaining lifetime.** The contract refuses unless

   ```text
   activationEnd - now  >=  maximum execution window (15-minute job timeout)
                            + explicit clock-skew allowance
   ```

   The clock-skew allowance is a **named, explicit constant**, not an implicit tolerance folded into the comparison, so it can be reviewed and changed on its own. The effect is that an activation which could expire part-way through the job is refused *before* the job starts, rather than expiring mid-mutation.

Clock skew is permitted to shorten the usable window, never to extend it: skew is applied so that marginal evidence is refused, not accepted.

**The existing rule is preserved absolutely: authorization authority never derives from a human-supplied value.**

**Required once PIM integration is implemented:** effective Reqro operator permissions must be **derived from the verified active PIM groups**, and `REQRO_OPERATOR_IAM_PERMISSIONS` **must not remain an independent authorization authority**. Today it is an *asserted* comma-separated list, which was acceptable only while no evidence source existed. Leaving it authoritative alongside real evidence would create a second, weaker path to the same decision — and a control is only as strong as its weakest path. It may survive at most as a **declaration cross-checked against** the derived set, with any disagreement refusing; it may not survive as a source of authority.

### 2.8 Timing, and the TOCTOU risk stated plainly

| Question | Answer |
| --- | --- |
| Active when the request is created? | **Yes** — the requester must be elevated to plan |
| Active when approval occurs? | **Yes** — for the *approver*, checked in that separate invocation |
| Active when the mutation executes? | **Yes** — for the *executing* human, freshly checked |
| Elevation expires between approval and execution? | The confirm invocation fails closed on its own fresh check. The approval row remains valid but unusable until its holder re-elevates |
| Access revoked after the artifact is created? | The artifact keeps its (now historical) evidence, but confirm's fresh check refuses. **The artifact is not an authorization token** — it binds *who requested what*, and never substitutes for current elevation |
| Freshly query before mutation? | **Required. PIM evidence must be freshly queried immediately before privileged execution**, in the pipeline step immediately preceding the container. Evidence from the request or approval invocation must never be reused to authorize execution |

**TOCTOU residual, explicit.** A window remains between the pre-flight Graph read and the database commit — bounded in practice to seconds, worst case the 15-minute job timeout. If elevation is revoked inside that window the mutation can still commit. Eliminating it entirely would require either the container holding a Graph credential (rejected above) or the database itself validating elevation (impossible). It is **bounded, not closed** — and this document does not claim it is eliminated — by: the tight evidence-freshness window, the requirement that the activation outlive the maximum execution window plus the clock-skew allowance, the 60-minute elevation ceiling, and the single-use approval.

**This residual must be carried forward into the implementation slice, the eventual ADR and the operator runbook**, and accepted explicitly by the security team rather than discovered later. Any future claim that fresh Graph evaluation makes execution authorization atomic would be false: Graph is consulted before the container starts, and the database commit happens afterwards.

### 2.9 Requester / approver separation

**Both need PIM, against different groups.** Each invocation checks the elevation of *its own* actor:

| Invocation | Required active activations |
| --- | --- |
| request (plan, `--dry-run`) | `reqro-tenant-domain-request` |
| approve (`--confirm`) | `reqro-tenant-domain-approve` **and** `reqro-tenant-domain-execute` |
| confirm (`--confirm`) | `reqro-tenant-domain-request` **and** `reqro-tenant-domain-execute` |

Requiring only the requester to be elevated would let a never-elevated human approve. Requiring only the approver would let a never-elevated human both plan and apply. Both is the only coherent answer. Separation of duties is *strengthened*, not weakened: it now needs two humans who are **each independently, currently elevated into different groups**, on top of the existing mutual exclusivity and the database self-approval check.

### 2.10 Failure behaviour — fail closed, no exceptions

| Condition | Behaviour |
| --- | --- |
| Graph timeout / unavailable / 5xx | Refuse. Bounded retry with backoff is acceptable **for transport errors only**; exhaustion refuses |
| Graph 401 / 403 | Refuse, and treat as a configuration defect (consent or federation broken), not a transient fault — **no retry** |
| Throttling (429) | Honour `Retry-After` for a small bounded number of attempts, then refuse |
| Malformed / unparseable response | Refuse |
| Multiple matching assignments | Refuse as ambiguous — never select one |
| No matching assignment | Refuse |
| Eligible but not activated | Refuse — this is the central case the whole design exists to catch |
| Expired activation | Refuse |
| Wrong tenant | Refuse |
| Wrong group | Refuse |
| Disabled or deleted account | Refuse. Note: Graph may still return an instance for a disabled account, so absence of an instance is **not** the control here — account state is handled by the identity step and by Entra ceasing to issue tokens |
| Clock skew | Small bounded tolerance on the window edges only; never extend an expiry |

No permissive fallback, no cached-evidence fallback, no "warn and continue". Serving execution refuses.

### 2.11 Audit and privacy

Retain as proof of authorization: the activation instance ID, group ID, tenant ID, `oid`, activation start and expiry, evidence-retrieval timestamp, evidence contract version, and a closed result code. That is a complete and citable authorization record in bounded fields.

Never retain: bearer tokens, `Authorization` headers, unrestricted Graph payloads, or user profile attributes beyond the IDs above. This fits the existing architecture unchanged — `assertAuditPayloadSafe` already refuses forbidden key names and credential-shaped values, and the pino allowlist sanitizer already governs log output. **A new sink is not required**; a new *field set* is.

### 2.12 Provider-neutral boundary

Entra and Graph specifics must stay behind an adapter, exactly as ADR-028 requires. Concretely:

- **A new narrow interface is justified.** Identity ("who is this human?") and elevation ("is this human currently authorized?") are different questions with different sources, different failure modes and different freshness semantics. Overloading `TrustedIdentityAdapter` with the elevation lookup would make a Graph outage indistinguishable from a malformed identity, and would blur a clean seam.
- Recommended shape: an `ElevationEvidenceAdapter` that returns a provider-neutral `ElevationEvidence` value (model, authorization-set ID, subject, window, instance ID, retrieval time) or refuses with a closed code. `operator-execution.ts` consumes the neutral value and knows nothing about Graph.
- **No Azure or Graph concept may enter Reqro's domain models.** `ServiceRequest`, `Organization`, `TenantDomain` and the tenancy layer must remain untouched; this is operator-platform configuration, not domain data.
- Words like `group`, `role` and `activation` should appear in the adapter and its Entra implementation only — never in the canonical operator contract, which should speak of an opaque *authorization set*.

**Recommended, not implemented in this slice.**

---

### 2.13 Group ownership and PIM administration is a higher trust boundary

The four groups are the authorization substrate, so **the ability to own them or to change their PIM configuration is more privileged than any operator permission they express**. Eligibility to *activate* into a group is ordinary operator authority; the ability to decide *who is eligible*, *what the activation policy is*, or *who owns the group* is administrative authority over the control plane itself.

Required properties:

- **Routine Reqro operators must not be standing owners of these groups.** An operator who owns the group they activate into can grant themselves eligibility, remove the approval requirement, or extend the activation maximum — collapsing every control this design rests on into a self-service loop.
- **Holding `tenant-domain.request` or `tenant-domain.approve` eligibility does not and must not confer group ownership.** The two are unrelated grants and must be administered separately. In particular, the requester/approver mutual exclusivity is meaningless if either party can administer the other's group.
- **Group ownership and PIM-policy administration must be controlled through a separately governed administrative role and process**, distinct from the operator population and subject to its own approval. Entra already forces part of this: creating a role-assignable group needs Privileged Role Administrator, membership changes need `RoleManagement.ReadWrite.Directory`, and credential or MFA changes for members and owners need Privileged Authentication Administrator (§1.5). Those are necessary, not sufficient — the *governance* of who holds those roles is the control.
- **Owner and PIM-policy changes require audit and monitoring.** Adding an owner, changing eligibility, altering the activation maximum, or removing the approval or MFA requirement are all security-relevant events in their own right and should be alerted on, independently of Reqro. Reqro cannot observe them: by the time an invocation runs, a weakened policy looks exactly like a strong one.
- **Reqro never derives operator authority from group ownership.** Ownership is not membership and is not activation. An owner who has not activated is not authorized, and the predicate in §2.4 has no clause that ownership could satisfy — `accessId` must be `member`, never `owner`, which refuses the ownership relationship explicitly.
- **Administrators and owners able to change PIM configuration remain a higher-level administrative trust boundary outside Reqro's runtime authorization decision.** Reqro evaluates *evidence produced by* that configuration; it cannot and does not attest to the configuration's integrity. Anyone who can rewrite the policy is outside the model, exactly as the runner's environment is outside the runner-trust check. Stating this plainly is the honest position; implying that Reqro's checks constrain a PIM administrator would be false.

**Unchanged by all of the above:** direct or standing `Assigned` membership is still refused by Reqro (§2.2, §2.4). Nothing in this section introduces a path by which ownership, eligibility or standing membership authorizes an operation — only a verified active activation does.

### 2.14 Role-assignable group capacity

Microsoft's current limit is **500 role-assignable groups per Microsoft Entra tenant** (§1.5).

**Four groups for one Reqro deployment is not a practical concern** — it is under one percent of the limit, and the deployment-per-tenant model that ADR-027 and ADR-029 assume keeps it that way.

**It would become a design constraint** for any future model that centralizes many customer authorization boundaries inside a single Entra tenant: four groups per customer deployment implies a ceiling around 125 customer boundaries before the tenant limit is reached, before counting any role-assignable group used for other purposes. That arithmetic should be done deliberately rather than discovered.

**This slice does not redesign deployment-per-tenant architecture**, and nothing here should be read as proposing a change to it. The limit is recorded so a future multi-customer-in-one-tenant proposal has to account for it explicitly.

## Part 3 — Unresolved decisions (security team / infrastructure)

1. **Model confirmation.** Accept Model B, or direct Model A with reasons.
2. **The two documentation ambiguities** in §1.3 — enum casing and the nullable window — confirmed against a real tenant.
3. **Whether the Model B `$filter` conjunction is supported** (§1.6). Does not block the recommended design, which matches the principal client-side.
4. **Licensing** — Microsoft Entra ID P1 or P2 for role-assignable groups, and P2 / Entra ID Governance for just-in-time activation (§4.1).
5. **Activation policy per group**: approvers, MFA, justification, ticket, and the activation maximum, which must not exceed the contract's 60-minute ceiling.
6. **How activation provenance (`activatedUsing`) is retrieved on the PIM-for-Groups resource** (§1.2). Microsoft documents `$expand` for it on the directory-role resource but **not** on the group resource. This must be proven from documented behaviour and **real-tenant validation** before implementation; until it is, the predicate condition that depends on it refuses. If provenance proves unretrievable, the security team must decide whether `assignmentType = activated` alone is acceptable evidence — a materially weaker position this assessment does **not** recommend — or whether the model changes.
7. **Governance of group ownership and PIM administration** (§2.13) — which separately governed role holds it, and how owner and policy changes are audited and alerted on.
8. **The TOCTOU residual** in §2.8 — accepted explicitly, or closed by a mechanism not yet identified.
9. **Freshness window** — is 120 seconds right?
10. **Whether the derived-permissions change** (§2.7) is in scope for the implementation slice.
11. **Conditional Access / authentication context** on the Azure DevOps sign-in path as an additional control.
12. **Whether a new ADR is warranted** — see below.

**Is a new ADR recommended?** **Yes, and this recommendation stands.** Selecting the PIM authorization model, the group topology, the single Graph permission, the fresh-evidence timing rule and the accepted TOCTOU residual are durable architectural decisions that neither ADR-029 nor ADR-030 makes.

**No number is allocated in this slice, deliberately.** ADR numbering is now settled through **ADR-030 (Production Serving Contract)**, but allocating the next number here would race any other workstream doing the same. The implementation/design slice that follows must **inspect the authoritative index at that moment and allocate the next unused number**, and this assessment must not be read as reserving one. The ADR index is not edited by this slice.

---

## Part 4 — Future implementation work

### 4.1 Infrastructure prerequisites — listed, not created

| Category | Item |
| --- | --- |
| **Entra configuration** | Four dedicated groups (§2.2), each created **role-assignable** (`isAssignableToRole = true`, immutable, requires Privileged Role Administrator) and **assigned no directory role**; assigned — not dynamic — membership; PIM for Groups enabled on each; per-group activation policy (MFA, justification, ticket, **approval required for eligible member assignments**, ≤60-minute activation maximum); eligibility assignments, with request and approve mutually exclusive |
| **Licensing** | **Microsoft Entra ID P1 or P2 is required for role-assignable groups, and Microsoft Entra ID P2 / Entra ID Governance is required for PIM just-in-time activation.** This is an explicit prerequisite, not an assumption: without P2 there is no activation to evidence and the entire model is unavailable |
| **Entra app / workload identity** | A dedicated Graph-reader app registration; a federated credential trusted from the Azure DevOps service connection; `PrivilegedAssignmentSchedule.Read.AzureADGroup` **application** permission with **admin consent** |
| **Azure DevOps configuration** | A service connection for the Graph-reader identity, separate from the ACI orchestration connection; variable group entries for the four group IDs and the expected tenant; protected-environment reviewers unchanged |
| **Conditional Access** | Policy review for the operator population; optional authentication-context requirement |
| **Repository implementation** | A **separate `ElevationEvidenceAdapter`** interface (recommended rather than overloading `TrustedIdentityAdapter`) and its Entra implementation; evidence fields in the trusted execution contract, request artifact and approval evidence; the fresh pre-execution query replacing the refusing pipeline step; permissions derived from verified activations, with `REQRO_OPERATOR_IAM_PERMISSIONS` demoted from authority; the named clock-skew allowance; runbook and new-ADR updates |
| **Security-team approval** | The model, the permission and its consent, the activation policies, the TOCTOU residual, and the new ADR |

### 4.2 Test matrix

**Unit (pure, no network)** — window arithmetic including both edges; clock-skew tolerance; case-insensitive `assignmentType`; the full §2.4 predicate as a verdict map; forged and absent evidence fields; stale `evidenceRetrievedAt`; activation expiring before the job timeout; human-supplied identity and permission attempts refused; derived-permission mapping.

**Mocked Graph contract tests (no tenant)** — active authorized activation accepted; eligible-but-not-activated refused; expired refused; wrong tenant, wrong user, wrong group each refused; `accessId: owner` refused; `memberType: group` refused; `activatedUsing: null` refused; multiple matches refused as ambiguous; malformed body, empty collection, unexpected enum, missing window each refused; 401/403 refused without retry; 429 honouring `Retry-After` then refusing; timeout refused. Fixtures should be **derived from the documented sample responses** so they cannot drift into fiction.

**Integration (no live tenant)** — the three-invocation flow against a stubbed Graph; evidence correctly populating artifact, approval and runtime claims; assignment expiring between request and apply; requester/approver separation across two distinct subjects; audit records containing the bounded fields and no token.

**Live tenant UAT (separately authorized, not part of this assessment)** — a real activation end to end; a real expiry; a real revocation mid-window; confirmation of the two §1.3 ambiguities; **proof of how activation provenance is retrieved on the PIM-for-Groups resource** (§1.2), including that authorization refuses when it cannot be retrieved; and confirmation that a standing `Assigned` member — permanent and time-bound — is refused while an activated member is accepted.

### 4.3 What stays unchanged

No migration. No SQL, grant or schema change. No change to the DNS verifier, the tenancy layer or any Reqro domain model. The database boundary stays exactly as F060.3C-2c-3 established it, and `reqro_operator` remains the single operator role.

---

## Status

**Assessment complete; nothing implemented.** The PIM gate remains **fail-closed** and production privileged execution remains **disabled**. ADR-029 remains `Proposed` and unmodified. **Production deployment remains unauthorized.**

## Sources

- [List roleAssignmentScheduleInstances (Graph v1.0)](https://learn.microsoft.com/en-us/graph/api/rbacapplication-list-roleassignmentscheduleinstances)
- [unifiedRoleAssignmentScheduleInstance resource type](https://learn.microsoft.com/en-us/graph/api/resources/unifiedroleassignmentscheduleinstance)
- [List PIM for Groups assignmentScheduleInstances (Graph v1.0)](https://learn.microsoft.com/en-us/graph/api/privilegedaccessgroup-list-assignmentscheduleinstances)
- [privilegedAccessGroupAssignmentScheduleInstance resource type](https://learn.microsoft.com/en-us/graph/api/resources/privilegedaccessgroupassignmentscheduleinstance)
- [Configure PIM for Groups settings](https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/groups-role-settings)
- [ADR-029 — First production operator platform](../architecture/decisions/ADR-029-production-operator-platform.md) (input; unmodified)
