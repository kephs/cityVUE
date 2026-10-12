# F060.4A-2B-4-0E — Azure DevOps Private Runner & Federation Contract

## Authority, scope and baseline

**P1 — Azure DevOps Services is the Reqro production CI/CD reference platform**, explicitly selected by the project owner in this task. GitHub remains source control, pull requests, collaboration and code review. GitHub Actions is a possible future alternative, not the reference production path.

**B — ACR IMPLEMENTATION READY / RUNNER IMPLEMENTATION SEPARATE. G1 recommended for the bounded 4A foundation after this contract's review and separate implementation authorization.** No runner or publication readiness is claimed.

Fetched authoritative `origin/main` and starting HEAD: `0de1557d315cddacdebc0af35cda3b850492b216`.
Branch: `codex/f060-azure-devops-runner-federation-contract`, isolated worktree, initially clean tree/index, zero ahead/behind. Review date: 2026-10-11.

**NO AZURE DEVOPS PIPELINE WAS CREATED. NO MANAGED DEVOPS POOL WAS CREATED. NO SELF-HOSTED AGENT WAS CREATED. NO SERVICE CONNECTION WAS CREATED. NO FEDERATED CREDENTIAL WAS CREATED. NO MANAGED IDENTITY OR APP REGISTRATION WAS CREATED. NO ROLE ASSIGNMENT WAS ADDED. NO ACR CONFIGURATION WAS CHANGED. NO IMAGE WAS PUSHED. NO AZURE LOGIN OR WHAT-IF OCCURRED. NO DEPLOYMENT OCCURRED. NO F061 OR F062 CHANGE OCCURRED.**

No VM/VMSS, endpoint, DNS resource, signing key or workflow implementation occurs here.

## Sources and explicit amendments

Inspected [4-0 supply chain](F060-4A-2B-4-0-container-registry-supply-chain-decision.md), [4-0A registry/network](F060-4A-2B-4-0A-acr-network-sku-identity-trust-decision.md), [4-0B publisher](F060-4A-2B-4-0B-ci-publisher-network-federated-identity-decision.md), [4-0C runner assessment](F060-4A-2B-4-0C-production-ci-platform-private-runner-decision.md) and [4-0D ownership](F060-4A-2B-4-0D-production-ci-platform-ownership-decision.md).

The owner's P1 decision resolves their historical P4 ownership gap. This record also amends 4-0A's non-ABAC/AcrPull candidate to the ABAC Reader/Writer model below. Earlier records are retained unchanged.

The [network module](../../deploy/azure/frontend/modules/network.bicep) has delegated ACA infrastructure and a separate ACA endpoint subnet, but no CI subnet. The [static-origin module](../../deploy/azure/frontend/modules/static-origin.bicep) has internal/private ACA and a required documented digest image parameter, but no registry identity wiring.

Existing [operator YAML](../../server/azure-pipelines/tenant-domain-operator-request.yml), [identity template](../../server/azure-pipelines/templates/operator-identity.yml) and [ADR-029](../architecture/decisions/ADR-029-production-operator-platform.md) supply conventions, not reusable publisher authority. ADR-029 remains Proposed; this owner decision does not silently accept all its deployment details.

## Source and control-plane ownership

GitHub holds source and version-controlled production pipeline YAML. No repository move or separate pipeline-source repository is justified. Azure DevOps owns trusted build orchestration, protected publication, SBOM/scan/sign orchestration and deployment handoff.

Select the **Azure Pipelines GitHub App**, restricted to required Reqro repositories, with Checks reporting build/test status where configured. No developer PAT or individual OAuth identity is a production release dependency. This follows [Microsoft's recommended GitHub integration](https://learn.microsoft.com/en-us/azure/devops/pipelines/repos/github?view=azure-devops). Nothing is installed here.

Deployment platform engineering owns project/pool/service-connection administration; security owns trust-policy review; independently appointed release approvers own release approval. Actual names, organization/project IDs, tenant, subscription and resource groups are future deployment inputs. GitHub contribution rights confer none of those Azure DevOps permissions.

## Public-cloud runner reference and fallback

| Model                                                | Decision and responsibility                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Managed DevOps Pools, VNet-injected stateless agents | Preferred Azure public-cloud reference. Disposable agents reduce persistent state; platform engineering still owns images, network, pool permissions, evidence and incident response.      |
| Traditional private self-hosted agents               | Fallback where MDP is unavailable or unsuitable, including national-cloud scenarios subject to compatibility validation. Customer owns host patching, registration, isolation and cleanup. |

MDP supports Azure DevOps Services and Azure public cloud, not national-cloud offerings. Its compute is service-managed; VNet integration does not transfer workload permission governance to Microsoft. [MDP architecture](https://learn.microsoft.com/en-us/azure/devops/managed-devops-pools/architecture-overview?view=azure-devops).

Use stateless/disposable agents for each job. Discard workspace and local auth state after success, failure or cancellation; export sanitized evidence first. No cross-client or PR-to-release cache reuse. Pool image changes require review, predictable tool versions and patch ownership. No persistent production credentials may survive teardown. [Stateless pool support](https://learn.microsoft.com/en-us/azure/devops/managed-devops-pools/migrate-from-scale-set-agents?view=azure-devops).

Fallback contract: dedicated client/environment release boundary, private ACR/DNS access, outbound agent connectivity, no public SSH/RDP by default, no PR or developer interactive use, no long-lived publisher secrets, controlled toolchain/patching, deterministic cleanup and operational logs. Prefer disposable hosts; persistent operation requires explicit reviewed cleanup and recovery controls. No VM size/count is selected.

Self-hosted fallback is a reference direction, not blanket Azure Government certification. Validate Azure DevOps connectivity, sovereign endpoints, identity support, client policy and tool availability before that deployment. Do not replace federation with a secret to bypass incompatibility.

## Network, DNS and service networking authority

Use the existing client/environment Reqro VNet with a **dedicated CI execution subnet**, exclusive to its MDP pool and delegated to `Microsoft.DevOpsInfrastructure/pools`. Pool and VNet must share region. Never reuse ACA infrastructure, ACA endpoint or ACR endpoint subnets. No region/CIDR is chosen.

Microsoft requires `DevOpsInfrastructure` service-principal `Reader` and `Network Contributor` on the VNet, or its documented custom-permission alternative:

- `Microsoft.Network/virtualNetworks/*/read`
- `Microsoft.Network/virtualNetworks/subnets/join/action`
- `Microsoft.Network/virtualNetworks/subnets/serviceAssociationLinks/validate/action`
- `Microsoft.Network/virtualNetworks/subnets/serviceAssociationLinks/write`
- `Microsoft.Network/virtualNetworks/subnets/serviceAssociationLinks/delete`

Source: [MDP networking requirements](https://learn.microsoft.com/en-us/azure/devops/managed-devops-pools/configure-networking?view=azure-devops). This service principal is **not** the publisher UAMI. Future 4B must review exact scope and verify service identity, subnet capacity, reserved-range conflicts and service-association-link/lock lifecycle. No grant is made here.

Keep Premium ACR, private endpoint and public access Disabled. Agents use private routing and `privatelink.azurecr.io` for login and data endpoints; TLS hostname verification remains mandatory. No static IP or hosts-file workaround. Central DNS requires explicit linking/forwarding ownership. No cross-client routing is approved.

Current MDP startup/control-plane endpoint categories include `*.prod.manageddevops.microsoft.com`, `rmprodbuilds.azureedge.net`, `*.queue.core.windows.net`, `download.agent.dev.azure.com` and `dev.azure.com`. The same networking source specifies additional OS, artifact, identity and feature endpoints; Linux provisioning includes HTTP `azure.archive.ubuntu.com`. This is an inventory seed, not a complete firewall allowlist.

Future egress review must additionally cover GitHub/App source integration, npm packages, pinned GHCR base, Entra token exchange, Azure APIs and chosen signing/scan services. Reverify Microsoft's endpoint list, OS/CDN requirements and effective routing before 4B. No firewall or public ingress is introduced. Private execution does not mean no internet egress.

Default pools, identities and network boundaries are client/environment isolated. Sharing requires explicit acceptance of pipeline permissions, cross-client routing and host compromise blast radius; it is not the default.

## Federated publisher service-connection contract

Prefer a **dedicated user-assigned managed identity per client/environment**, backed by a federated credential and an Azure Resource Manager service connection. This aligns identity lifecycle with Azure deployment ownership without an application secret. An app registration/SP is a supported exception requiring an explicit operational reason.

New eligible public-cloud connections must use the **Microsoft Entra issuer model**. The legacy `https://vstoken.dev.azure.com` issuer is deprecated for eligible Azure-public-cloud connections and scheduled for retirement **July 1, 2027**. Do not intentionally create a new eligible connection on that issuer. National-cloud and multitenant exceptions are outside that migration scope; validate their supported issuer separately. [Current federation guidance](https://learn.microsoft.com/en-us/azure/devops/pipelines/release/configure-workload-identity?view=azure-devops).

Bind exact generated issuer/subject/audience values to the dedicated connection; no invented strings or wildcard repository/project trust. Platform authorization and branch/environment checks supply restrictions that are not encoded in the federation subject.

Freeze service-connection controls:

- No “Grant access permission to all pipelines”; explicitly authorize only the trusted production-release pipeline.
- No project sharing without separate review.
- Azure role scope limited to the target registry/repository condition; no subscription-wide Contributor.
- Connection administration separate from pipeline authorship; no host-attached publisher identity or ambient metadata privilege.
- Short-lived tokens only, no service-principal secret, authentication certificate, admin password or long-lived Docker credential.
- Sanitize logs and remove temporary token/Docker configuration on every exit; do not cache credentials across jobs.

Agent registration/control-plane authentication is separate from release-job federation. MDP service networking authority and host identity confer no publishing rights.

## ACR permission-mode amendment

Select **RBAC Registry + ABAC Repository Permissions** for the future production registry. Microsoft recommends this model for repository-level scoping; existing legacy-role assumptions must not be carried into the new registry. [ABAC authority](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-abac-repository-permissions).

| Principal           | Future role/condition                                                                                  | Exclusions                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Publisher UAMI      | Container Registry Repository Writer, registry assignment conditioned to the exact frontend repository | No Repository Contributor, image/artifact delete, registry control plane, role assignment, network/DNS administration or deployment |
| Runtime pull UAMI   | Container Registry Repository Reader, condition to the same exact repository                           | No legacy AcrPull, write, delete or business-resource authority                                                                     |
| Lifecycle authority | Separately reviewed role and procedure                                                                 | Never inherited by publisher/pull identities                                                                                        |
| Catalog listing     | No Catalog Lister by default                                                                           | Add only on proven workflow need under separate review                                                                              |

The logical repository is `reqro/frontend`; actual condition syntax must be validated in implementation, covering all relevant operations. Legacy AcrPull/AcrPush are not honored in ABAC mode. Do not grant an unconditioned role while waiting to add a condition.

Repository Writer supports read/write, tag metadata and OCI referrers without image/artifact deletion or registry control-plane permissions. **It still permits tag changes and artifact-lock management.** ABAC repository scope is not tag-level immutability or separation among artifacts in that repository. [Detailed role authority](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-built-in-roles-directory-reference).

Therefore the older no-delete concern is addressed by the selected role, but protected evidence/lock policy still requires validation before granting publisher access. Do not claim Writer enforces no-unlock. Preserve approvals and digest evidence outside publisher mutation authority; any requirement to prevent all lock modification needs additional reviewed design. This is a 4B/publication gate, not a blocker to creating an empty private registry with only runtime Reader access.

No Publisher Contributor role, automatic purge or numeric retention is authorized. Preserve rollback digests and required evidence. Admin and anonymous access remain disabled; no credential outputs. The 4-0A Defender trusted-services purpose and actual switch breadth remain unchanged.

## Protected execution and approvals

| Pipeline/context  | Authorized scope                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| PR validation     | Lower-trust pool, no publisher/signing/deployment connection or production pool                                  |
| Trusted build     | Checkout, compile/test/containerize, scan and SBOM; no production ACR writer                                     |
| Protected release | Explicitly authorized pool and publisher connection; controlled candidate push and scan/evidence coordination    |
| Protected signing | Separate signing workload identity and protected stage; key authority independent of generic build and publisher |
| Deployment        | Separate connection and authorization under existing operator/PIM governance; no publisher connection reuse      |

The private pool is itself protected; restrict it to approved pipelines. Fork authorship, GitHub membership and YAML editing cannot imply pool/service-connection access.

Require branch control, approved protected source, independent approval and pipeline authorization on the publisher connection/release environment. Use a required trusted template where appropriate; use an exclusive lock when concurrent publication could conflict. Main remains repository integration authority; the exact permitted release refs are deployment policy inputs, never arbitrary feature branches.

Azure branch control checks linked source resources and protection status. For GitHub, verify the resolved ref and actual protection through the App integration; fail closed when protection status is unknown. Do not assume a matching branch name proves reviewed content. Protect pipeline templates and source-artifact provenance too. Checks are owned outside YAML by resource administrators. [Approvals/checks authority](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals?view=azure-devops).

Release publication approval is not final release acceptance or Azure deployment authorization. A pipeline cannot approve its own release. These controls complement, not replace, PIM/operator rules. No deployment roles are designed here.

The signing identity may receive narrowly conditioned OCI write access for signature attachment, while its signing service/key permissions remain independently protected. Publisher identity may attach SBOMs but does not gain signing authority. Key custody, signer trust and exact signing tool remain signing-implementation gates, not 4A blockers. Signature verification is a protected release gate; no ACA-native signature enforcement is claimed.

## Toolchain and immutable release flow

Future managed/private images provide controlled Node/npm, Azure CLI, builder, SBOM, scanner and signing/verification tools. No arbitrary tool/version is selected. Custom pinned pool images require justified maintenance ownership.

Review Docker socket privilege, BuildKit/rootless isolation and isolated VM builds before runner implementation; no unrestricted socket for arbitrary jobs. Source/package build scripts must never execute with production publication credentials.

Freeze **build once → immutable digest → promote that same reviewed digest**. No rebuild after approval unless a separately approved deterministic-build policy permits it. Vite input differences create a different candidate requiring its own preapproval build/evidence; do not treat environment-specific rebuilds as promotion.

Sequence: reviewed GitHub commit → trusted Azure DevOps build → candidate → pre-push scan → SBOM → protected release stage → private ACR candidate push → registry scan → findings review → separate signing → signature verification → release approval → deployment handoff. Candidate push is not production approval.

Retain commit, build/run and workload identity, base/output digest, nonsecret build inputs, SBOM, scan decisions and signed approval evidence. Exact base pin is mandatory. No scanner, severity threshold, key or runtime validation is invented.

## Readiness, independent implementation and next slices

**B — ACR implementation ready; runner implementation separate. G1 replaces the prior G2 for the bounded 4A architecture.** Platform, private path, permission mode, runtime Reader and publisher trust are now defined without requiring public registry exposure. MDP/federation need not be provisioned before registry foundation code is written.

Next: **F060.4A-2B-4A — ACR + Pull Identity IaC Foundation**, after review and separate implementation authorization. Bound it to Premium private ACR in ABAC mode, admin/anonymous disabled, dedicated ACR endpoint/DNS, pull UAMI with conditioned Repository Reader, and ACA registry/identity wiring with focused validation. No publisher grant, pool, service connection, image push or deployment.

Separately future: **F060.4A-2B-4B — Azure DevOps Managed Pool & Publisher Federation IaC Foundation**. It must validate pool image/engine, service network permissions, protected-resource ownership, generated federation values, repository-condition behavior and evidence/lock protection before publisher access. Publication still requires scan/SBOM/signing policy and separately authorized actions.

G1 is not a claim that production deployment, national-cloud fallback, actual pull connectivity or release tooling is validated. Remaining deployment parameters and procurement/role approvals belong to their implementation scopes. If runtime Reader/ABAC support fails validation, stop rather than restore broad legacy roles.

Documentation validation only: repository links, current first-party sources, headings/tables, formatting, whitespace/control characters, private-value review, exact one-file scope and `git diff --check`. No builds, Azure commands or CI runs.

**STOP FOR F060.4A-2B-4-0E AZURE DEVOPS RELEASE-TRUST REVIEW.**
