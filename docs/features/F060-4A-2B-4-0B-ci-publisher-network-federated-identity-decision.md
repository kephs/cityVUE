# F060.4A-2B-4-0B — CI Publisher Network & Federated Identity Decision

## Status and baseline

Documentation-only decision for architecture review, 2026-10-11. **C — PLATFORM BLOCKED; R4; I2; G2.** Production frontend CI ownership is not authoritative in the inspected repository. Ephemeral private execution and federation are the recommended direction, not implementation-ready resources.

Fetched authoritative `origin/main` and starting HEAD: `05c53ba526817a13bba986aaeff04b0c1fbbd641`. Isolated branch `codex/f060-ci-publisher-identity-decision` began with clean tree/index and zero ahead/behind.

**NO CI RUNNER WAS CREATED. NO FEDERATED CREDENTIAL WAS CREATED. NO MANAGED IDENTITY OR SERVICE PRINCIPAL WAS CREATED. NO ROLE ASSIGNMENT WAS ADDED. NO CI WORKFLOW WAS MODIFIED. NO ACR RESOURCE WAS CREATED. NO IMAGE WAS PUSHED. NO DOCKER LOGIN OCCURRED. NO SIGNING KEY WAS CREATED. NO AZURE LOGIN OR WHAT-IF OCCURRED. NO F061 OR F062 CHANGE OCCURRED.**

No deployment, resource provisioning, dependency or runtime change is included. This record freezes trust requirements and records missing authority honestly.

## Repository authority

The [supply-chain decision](F060-4A-2B-4-0-container-registry-supply-chain-decision.md) and [ACR network/identity decision](F060-4A-2B-4-0A-acr-network-sku-identity-trust-decision.md) remain authoritative requirements: Premium ACR, private endpoint, public access Disabled, private DNS, dedicated pull UAMI, digest identity, SBOM and both scan gates. Do not reopen public ACR for publisher convenience.

Direct inspection found five tracked Azure Pipelines YAML files for tenant-domain operator execution and no tracked GitHub Actions workflow. [ADR-029](../architecture/decisions/ADR-029-production-operator-platform.md) is **Proposed, not Accepted**; its Azure DevOps choice concerns privileged operator execution, not production frontend build/publication ownership.

The [request pipeline](../../server/azure-pipelines/tenant-domain-operator-request.yml) uses manual dispatch, GitHub source at main and a Microsoft-hosted pool. Approve/confirm are separate operator pipelines. The [identity template](../../server/azure-pipelines/templates/operator-identity.yml) describes workload federation; the [job template](../../server/azure-pipelines/templates/operator-job.yml) starts a one-shot private ACI operator, keeping the hosted agent outside the database network.

Those patterns do not establish a private image publisher. References such as `operatorServiceConnection`, `operatorResourceGroup` and `operatorManagedIdentityId` are deployment inputs, not proof of provisioned services or permission to reuse them. No publisher subscription/resource-group owner, runner pool, service connection or federation is established here.

Conclusion: **D in the platform-options assessment — no authoritative production frontend CI platform yet frozen.** Azure DevOps is the best-supported candidate for an explicit owner decision; GitHub hosting alone does not select Actions, and no other platform is approved. Do not rewrite the operator ADR or inherit its privileged identity.

## Execution options and lifecycle

| Option                                    | Security and operating tradeoff                                                                                                                                        | Disposition                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A. Persistent self-hosted VM              | Lower startup latency and reusable cache, but credential/workspace persistence, poisoned state, cross-build contamination and patching burden require strong controls. | Not approved as an interim shortcut. Any exception requires dedicated ownership, reimaging and explicit review. |
| B. Ephemeral self-hosted execution        | Fresh job boundary limits residual credentials/workspaces; teardown and cache isolation need proof. Startup latency, image maintenance and orchestration cost remain.  | Preferred lifecycle principle, conditional on platform/runner design.                                           |
| C. Managed private runner service         | Can reduce host operations while preserving a private path; product trust, region, cost, subnet and project restrictions need approval.                                | Evaluate if Azure DevOps is selected; not selected solely because it exists.                                    |
| D. ACA Job or other Azure-native executor | A custom control-plane/build integration adds lifecycle and privilege design. Existing operator ACI is not a build platform.                                           | No repository authority for this use; not selected.                                                             |
| E. Public ACR for hosted agents           | Simplifies reachability by weakening the frozen network posture.                                                                                                       | Rejected; solve CI placement instead.                                                                           |

Microsoft documents Managed DevOps Pools with customer-VNet injection and an exclusive subnet delegated to `Microsoft.DevOpsInfrastructure/pools`; stateless pools can provide a fresh agent per job. This is a distinct product from ordinary Microsoft-hosted agents, so the latter's private-ACR limitation does not rule it out. No region/cloud/cost suitability is inferred. Sources: [networking](https://learn.microsoft.com/en-us/azure/devops/managed-devops-pools/configure-networking?view=azure-devops), [stateless lifecycle comparison](https://learn.microsoft.com/en-us/azure/devops/managed-devops-pools/migrate-from-scale-set-agents?view=azure-devops).

**R4 — execution platform is not authoritative enough to choose a concrete runner.** Prefer ephemeral execution; do not claim R1 architecture readiness or approve R2 persistence without evidence.

Future runner acceptance requires a reproducible patched base, minimal reviewed tooling, pinned versions where practical, restricted administration, security logs, isolated workspaces and verified teardown on success, failure and cancellation. Docker/build caches must not carry untrusted state into release jobs or cross client boundaries. Shared credential-bearing caches are prohibited.

A Docker socket can confer host-level authority. Compare isolated build VMs, rootless builders and BuildKit isolation in the runner decision; containerizing a builder alone is not proof of isolation. No engine is selected here. Prefer separate build execution from the release/signing environment so source/package scripts never execute with release credentials.

## Trusted source, build and release boundary

PR/fork validation has **no production ACR push, signing or deployment authority**, and no access to the privileged private release runner pool. Arbitrary developer scripts and unrelated client pipelines cannot share that context.

Trusted build means reviewed source and a controlled pipeline definition, but it still receives no production registry write credential. A successful build produces a candidate plus evidence; it does not approve publication.

A protected release stage consumes a pinned artifact from a known trusted build/run, verifies its digest and provenance, and obtains publisher authority only after approved checks. It must not execute arbitrary artifact-supplied scripts. Require reviewed commit, protected branch/tag/release state, trusted pipeline definition and protected environment/stage. Main is the integration authority, but an exact production trigger/tag policy is not yet frozen.

If Azure DevOps is chosen, restrict pool/service-connection access to the intended project and explicit pipeline, with externally controlled checks and protected templates. Do not grant all pipelines access. Branch/environment checks supplement federation; do not claim every restriction is encoded in an OIDC subject. [Pipeline resource security](https://learn.microsoft.com/en-us/azure/devops/pipelines/security/resources?view=azure-devops).

Publication, signing and deployment checks need separate authority. CI environment approval complements existing operator/PIM controls; it cannot replace them or confer tenant-domain operator permission.

## Federation and identity ownership

**I2 — federation direction approved for this design, exact CI issuer/subject and identity object blocked on platform finalization.** No secret-based fallback is authorized.

Require OIDC/workload federation using short-lived tokens, scoped per client deployment/environment and registry. Logical owner is that deployment's platform/release engineering authority, with identity administration under security governance. Actual groups, tenant, subscription and resource group remain unset. No platform-wide cross-client writer is permitted.

For the Azure DevOps candidate, Microsoft supports either a dedicated UAMI with federated credential or an Entra application/service principal with federated credential. Prefer evaluating a **dedicated publisher UAMI** to fit the Azure-owned lifecycle; do not confuse it with the ACA pull UAMI or attach it to a runner host for ambient use. An application/SP is a supported alternative if the eventual identity owner requires it. Neither is selected as implementation-ready while platform authority is absent.

Use exact platform-generated issuer/subject/audience values, no wildcard trust or invented strings. Current guidance describes changing Azure DevOps issuer conventions; do not copy a historical subject example blindly. Limit the service connection and enforce branch/environment/pipeline restrictions in the appropriate control plane. [Federated service connection authority](https://learn.microsoft.com/en-us/azure/devops/pipelines/release/configure-workload-identity?view=azure-devops).

The runner machine identity may manage only approved host operations; it must not supply registry publication authority through a metadata endpoint. Bind release access to the federated job. Do not persist or cache OIDC/access tokens between jobs. Agent registration/bootstrap authentication is a separate unresolved runner concern; Azure federation does not automatically solve it.

No client secret, raw CI certificate, ACR admin credential, developer personal login or Docker password is an approved production authentication model.

## Publisher permission boundary

Required capabilities are image/layer/manifest push and pull, approved tag operations and digest-bound SBOM/signature attachment publication. Registry control-plane configuration, endpoint management, role assignment, delete/purge and Azure deployment are excluded.

In the frozen non-ABAC registry mode, **AcrPush at the specific registry is a practical candidate, not an approved no-delete implementation**. The short RBAC definition lists pull/read and push/write. Microsoft's detailed ACR role directory additionally describes OCI referrer deletion, tag untagging and repository/image lock management under AcrPush. Therefore excluding the separate AcrDelete role does not prove the required preservation of signatures, SBOMs or locks. Sources: [RBAC definition](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/containers), [detailed role semantics](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-built-in-roles-directory-reference).

This is an explicit **permission implementation gate**: prove a supported authorization design that prevents publisher deletion/unlocking of approved artifacts/evidence, or obtain a separately reviewed trust-policy decision. Do not invent a custom role that magically splits inseparable operations. Do not enable ABAC as a workaround without approval. No ACR Contributor/Owner or broad subscription role is justified.

Registry-scoped legacy roles do not isolate candidate/release repositories from the same writer. Pipeline conventions alone are not an authorization boundary. Runtime pull UAMI remains AcrPull-only and receives no publisher permissions.

## Signing and deployment separation

| Signing option                                | Assessment                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Same publisher identity signs                 | Simpler, but a compromised publisher can also produce trusted signatures. Reject as default.                                      |
| Separate signing identity and protected stage | Preferred trust boundary: only reviewed digest/evidence is eligible; generic build and publisher cannot invoke signing.           |
| External managed signing service              | Can improve key custody, but service choice, trust and network integration have no current authority. Candidate for later review. |

Keys must remain outside source, images, plaintext variables and persistent runner storage. Evaluate managed signing, Key Vault/HSM-backed keys or an approved identity-based signing flow; no concrete service or key is selected. Key/trust authority, signer authorization, rotation/revocation and verification policy are **pre-publication implementation gates**, even though signing the candidate happens after controlled push.

A separate signer may need tightly reviewed registry access to publish the signature, with the same referrer-permission caveat above. Signer key access is distinct from registry attachment writing. The publisher can transport evidence but cannot manufacture approved signing identity.

Prefer read-only verification in a protected release context, bound to the exact digest, signer policy and retained results. No native ACA signature admission is claimed. Prevent direct deployment bypass through deployment permission control.

Deployment identity/operator is separate from publisher, signer, runtime pull and business identities. Publishing is not deployment approval. An independently designated release approver accepts evidence; a separately authorized deployment path performs what-if and awaits explicit deployment authorization. No role overlap is assumed.

## Private network and DNS requirements

Preserve Premium ACR, private endpoint and public access Disabled. Ordinary Microsoft-hosted Azure DevOps agents cannot directly reach that private-only registry. [ACR private endpoint guidance](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-private-endpoints).

Reserve a dedicated CI execution subnet or approved equivalent boundary; not the ACA delegated subnet, ACR endpoint subnet or an unrelated workload subnet. Exact runner technology determines delegation and capacity. No topology, CIDR or peering is invented.

The publisher, signer and verifier must resolve `<registry>.azurecr.io` through `privatelink.azurecr.io` to the correct private addresses, including relevant data endpoints for pull/verification. Never use hosts-file overrides or raw private IPs. A different runner VNet/network requires explicit routing and DNS linking/forwarding ownership before readiness.

| Dependency                           | Required future network proof                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| ACR                                  | TLS reachability to private login/artifact paths and data endpoints; authenticated push/pull/attach/verify and denial of public access. |
| CI control plane and agent bootstrap | Documented outbound agent connectivity, registration, artifacts/log transport; no routine public SSH/RDP ingress.                       |
| Microsoft identity and Azure APIs    | Token exchange and narrowly required control-plane access, with TLS verification and no inherited deployment permission.                |
| Source and packages                  | Approved GitHub source, npm/package sources and exact pinned GHCR base; approved egress and integrity checks.                           |
| Scan services                        | Vulnerability database/API access, licensing and bounded failure handling selected with the scanner.                                    |
| Signing service                      | Approved key/signing endpoint and identity access through the reviewed release path; no public ACR exception.                           |

“Inside the VNet” is insufficient, and private ACR does not mean no internet egress. Network operations must own required destinations, routing, DNS, policy updates and restricted administrative recovery. Routine developer work requires neither production network access nor production push rights.

Defender registry scanning retains 4-0A's reviewed trusted-services purpose and documented breadth; it is not a general CI access bypass. Pre-push scanning uses the candidate artifact, not inherently production-registry credentials. Registry-side findings arrive after candidate push; future workflow must obtain complete, digest-correlated results and fail closed if unavailable. No polling or telemetry implementation occurs here.

## Artifact flow, promotion and evidence

Freeze this sequence:

1. Trusted source/build → exact candidate digest and build evidence.
2. Pre-push scan/review → SBOM generated during trusted build, before any controlled ACR push.
3. Protected candidate push → verify published digest → attach existing SBOM/provenance as OCI evidence.
4. Registry-side scan → security findings review under approved policy.
5. Separate signer signs the approved digest → protected verification → independent release approval.
6. Approved digest supplied to deployment → separately authorized what-if → explicit deployment authorization.

No mutable tag is signing or deployment identity. No scanner, generator or severity threshold is selected. The existing base digest must be consumed exactly; no silent tag resolution. Candidate publication is not a production release.

Prefer one `reqro/frontend` repository in each isolated deployment/environment registry with candidate/release labels and digest-bound approval evidence, **conditional on the unresolved write/delete boundary**. Separate repositories add organization but not isolation under registry-wide AcrPush. Separate registries for candidates may provide stronger separation at real cost; require that design review if permission proof cannot satisfy the boundary. No promotion topology change is approved here.

Prefer build once and promote the same digest where build inputs are identical. However, [frontend configuration](../../react/src/config/runtimeConfig.js) includes Vite environment-dependent values. Cross-environment digest reuse cannot be frozen until approved build inputs are shown identical or separately reviewed configuration architecture allows it. Distinct build inputs require separately identified, scanned, signed and reviewed artifacts; do not claim a rebuild preserves the digest.

Retain Git SHA, Dockerfile, base digest, nonsecret build inputs/toolchain, build/run identity, output manifest digest, SBOM, both scan results, signature/verification and approvals. This establishes traceability, not proven bit-for-bit reproducibility.

Preserve approved rollback digests and associated evidence; deletion/purge belongs to separate lifecycle authority with no numeric retention invented. Tags remain navigation labels only.

## Separation-of-duties matrix

Intended authority only, not grants. Y = permitted within the reviewed role; L = local/nonproduction; C = separately controlled permission/evidence gate; N = none. “Runtime pull” means platform image retrieval, not read-only release verification.

| Actor                        | Source change | Build | Pre-push scan | Registry push     | SBOM attach | Sign | Verify          | Approve release     | Delete | Configure registry | Deploy Azure | Runtime pull |
| ---------------------------- | ------------- | ----- | ------------- | ----------------- | ----------- | ---- | --------------- | ------------------- | ------ | ------------------ | ------------ | ------------ |
| Developer                    | Reviewed      | L     | L             | N                 | N           | N    | Public evidence | N                   | N      | N                  | N            | N            |
| PR validation                | N             | L     | L             | N                 | N           | N    | N               | N                   | N      | N                  | N            | N            |
| Trusted build                | N             | Y     | Y             | N                 | N           | N    | Evidence        | N                   | N      | N                  | N            | N            |
| Release publisher            | N             | N     | Consume       | C                 | C           | N    | Digest/evidence | N                   | N      | N                  | N            | N            |
| Signing identity             | N             | N     | Consume       | Signature only, C | N           | C    | C               | N                   | N      | N                  | N            | N            |
| Deployment operator/identity | N             | N     | Consume       | N                 | N           | N    | C               | Separate human role | N      | No implicit grant  | C            | N            |
| Container App pull UAMI      | N             | N     | N             | N                 | N           | N    | N               | N                   | N      | N                  | N            | Y            |
| Application runtime          | N             | N     | N             | N                 | N           | N    | N               | N                   | N      | N                  | N            | N            |
| Platform operator            | N             | N     | N             | N                 | N           | N    | C               | No default          | C      | C                  | No default   | N            |
| Independent release approver | N             | N     | Review        | N                 | N           | N    | Review          | C                   | N      | N                  | N            | N            |

A deployment execution identity cannot approve its own release. The separate human approval role above must be explicitly appointed and separated from artifact production. A Reqro tenant administrator receives none of these infrastructure authorities by application role.

CI logs must not expose tokens, Docker auth configuration or signing material. Temporary auth state must be removed on every exit path and never retained in caches/artifacts. Export sanitized security evidence before teardown: pipeline/job, commit, federated principal, pushed digest, scan decisions, signing/verification result and approval. Future retention/log ownership remains a decision, not new observability infrastructure.

## Readiness and exact next gate

- **R4:** no authoritative production CI execution platform; ephemeral private execution is preferred.
- **I2:** federation direction established; exact platform-generated trust and Azure identity object remain blocked.
- **C — PLATFORM BLOCKED:** operator Azure DevOps patterns are insufficient to claim frontend CI ownership. Runner and publisher-permission gaps also remain.
- **G2:** 4A stays blocked until private publisher network architecture is implementation-ready and accepted. This preserves 4-0A's gate.

An implemented runner need not logically precede all future registry IaC once architecture is approved, but architecture approval has not happened here. Independent drafting would currently bake in unapproved ownership, DNS/runner assumptions and lifecycle authority. This decision grants no 4A or publisher IaC implementation authorization.

Recommend exactly one next slice: **F060.4A-2B-4-0C — Private CI Runner Architecture Decision**. Its entry decision must establish production CI platform/owner; then select runner product/lifecycle, private placement/DNS/egress, bootstrap and federation trust, and resolve the publisher no-delete/referrer protection design. Name accountable platform, network, identity, security and release authorities without inventing their identities. If organizational authority is absent, record the unresolved decision rather than forcing readiness.

No next slice begins here. Source, package and government-cloud compatibility, region/cost and actual subscription/resource-group ownership remain deployment-specific validation.

Documentation validation only: repository/internal links, official external-source review, headings, tables, whitespace/control characters, private-value review, exact one-file scope and `git diff --check`. No build, container or Azure tests are claimed.

**STOP FOR F060.4A-2B-4-0B CI PUBLISHER ARCHITECTURE REVIEW.**
