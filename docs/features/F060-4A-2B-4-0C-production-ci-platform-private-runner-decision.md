# F060.4A-2B-4-0C — Production CI Platform & Private Runner Architecture Decision

## Status and starting state

Documentation-only architecture review, 2026-10-11. **P4 / R4 / I2; C — PLATFORM BLOCKED; G2 retained.** The repository does not establish production frontend CI ownership. This assessment compares supported choices and freezes requirements without inventing that authority.

Fetched authoritative `origin/main` and starting HEAD: `8aa2cf68137a01d877310ef9226c0d6efb59014e`. Branch `codex/f060-ci-platform-private-runner-decision` began in an isolated worktree with clean tree/index and zero ahead/behind.

**NO CI RUNNER WAS CREATED. NO VM/VMSS/CONTAINER APP JOB WAS CREATED. NO FEDERATED CREDENTIAL WAS CREATED. NO MANAGED IDENTITY OR SERVICE PRINCIPAL WAS CREATED. NO ROLE ASSIGNMENT WAS ADDED. NO WORKFLOW WAS MODIFIED. NO ACR RESOURCE WAS CREATED. NO IMAGE WAS PUSHED. NO SIGNING KEY WAS CREATED. NO AZURE LOGIN OR WHAT-IF OCCURRED. NO F061 OR F062 CHANGE OCCURRED.**

No ARC, subnet, DNS, build-engine or deployment implementation is included.

## Authority before runner design

Directly inspected authorities:

- [4-0 supply chain](F060-4A-2B-4-0-container-registry-supply-chain-decision.md), [4-0A network/identity](F060-4A-2B-4-0A-acr-network-sku-identity-trust-decision.md) and [4-0B publisher trust](F060-4A-2B-4-0B-ci-publisher-network-federated-identity-decision.md).
- [ADR-029 operator platform](../architecture/decisions/ADR-029-production-operator-platform.md), still explicitly Proposed, not Accepted.
- [Request pipeline](../../server/azure-pipelines/tenant-domain-operator-request.yml), sibling approve/confirm pipelines, [identity template](../../server/azure-pipelines/templates/operator-identity.yml) and [private operator job template](../../server/azure-pipelines/templates/operator-job.yml).

Five tracked Azure Pipelines YAML files implement operator execution patterns. Their hosted `ubuntu-latest` agents orchestrate a separate private ACI operator; they are not private frontend publisher agents. Workload federation/service-connection inputs are operator-specific. No tracked `.github/workflows/*` file establishes Actions authority. No approved frontend runner pool, CI organization/project owner or production release platform statement was found.

**P4 — unresolved.** Azure DevOps is the stronger continuity recommendation because operator control-plane patterns exist, but that is not production frontend approval. GitHub source hosting does not select Actions; Azure hosting does not select Azure DevOps. No third platform has recorded authority. The requested assessment does not substitute an invented organizational policy.

The required owner decision is explicit selection of production release platform, organization/project or repository scope, accountable operations/security owners, plan/cost and target cloud, plus acceptance of approval and identity administration. No further implementation research alone can supply that authority.

## Platform comparison

| Criterion                | Azure DevOps candidate                                                                                                                                | GitHub Actions candidate                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Private execution        | Customer-managed VM/VMSS agents or Managed DevOps Pools with VNet integration. Ordinary hosted agents are not the private ACR path.                   | Self-hosted ephemeral runners or eligible larger runners with Azure private networking.                                               |
| Federation               | ARM service connections support workload federation to managed identity or application identity.                                                      | GitHub OIDC supports Azure federation without long-lived Azure credentials.                                                           |
| Approvals and scope      | Resource checks on environments, service connections and pools; project/pipeline permissions.                                                         | Protected environments, branch rules, repository/workflow runner groups and OIDC restrictions; plan eligibility matters.              |
| Auditability             | Retain job, service connection, commit, identity, artifact and approval evidence. Existing operator conventions help, but cannot be reused as grants. | Retain workflow/job, repository/ref/environment, federated identity, digest and reviewer evidence. No deployed convention found.      |
| Lifecycle and operations | Self-hosting owns hosts/images; managed pools reduce host operations but still require image, network, permission and incident ownership.             | Self-hosting owns registration/teardown/patches; larger runners reduce host work but add plan/network constraints.                    |
| Client isolation         | Separate production pools/connections and per-deployment identities.                                                                                  | Separate runner groups/protected contexts and per-deployment federation.                                                              |
| Cost and fit             | Potentially another control plane beside GitHub; continuity with operator direction.                                                                  | Source/workflow co-location, but not an established Reqro release architecture; private runner and approval entitlements need review. |

Azure approvals/checks can be owned outside YAML on protected resources; branch and template checks complement approvals. Neither YAML stage conditions nor agent demands alone are access control. [Azure approval authority](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals?view=azure-devops).

GitHub environment protection and required-reviewer availability depend on repository visibility and plan. Do not assume the current account has required private-repository protections. [GitHub environment authority](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

Both platforms can support separate protected publication and signing contexts if their permissions and approvals are configured appropriately. Platform approval does not replace Azure PIM, operator authorization or explicit deployment review.

## Supported runner options, not selections

| Option                       | Support and lifecycle                                                                                                                     | Reqro disposition                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Azure self-hosted VM         | Customer controls placement, patching, registration and cleanup; a persistent host can retain poisoned state.                             | Feasible candidate, no interim approval.                                         |
| Azure VMSS agents            | Network placement and disposable execution options exist, with image/OS constraints; customer compute ownership remains.                  | Evaluate only after platform selection.                                          |
| Managed DevOps Pools         | GA service, stateless agents and customer-VNet integration; service runs compute in Microsoft-managed subscriptions.                      | Serious Azure DevOps candidate; not selected under P4.                           |
| GitHub ephemeral self-hosted | One job per ephemeral registration; operator must destroy/wipe the environment and export logs.                                           | Feasible private candidate, teardown is not automatic proof from deregistration. |
| GitHub larger runners        | Azure private networking for supported Ubuntu/Windows larger runners; eligibility, region and organization configuration must be checked. | Managed alternative if Actions and entitlements are approved.                    |
| ARC / runner scale sets      | ARC introduces Kubernetes operations; scale-set mechanisms do not by themselves justify that dependency.                                  | No existing need justifies Kubernetes/ARC here.                                  |
| ACA Jobs/custom executor     | No recorded production CI authority for this execution model.                                                                             | Do not introduce it.                                                             |

Managed DevOps Pools reached [GA](https://devblogs.microsoft.com/devops/managed-devops-pools-ga/); this does not make every later feature GA. Current [architecture documentation](https://learn.microsoft.com/en-us/azure/devops/managed-devops-pools/architecture-overview?view=azure-devops) limits support to Azure DevOps Services and Azure public cloud, excluding national clouds. Reverify region, capacity and feature status before selection. Microsoft owns managed compute; Reqro still owns configuration, image choices, identity and network policy.

Microsoft's [VMSS/pool comparison](https://learn.microsoft.com/en-us/azure/devops/managed-devops-pools/migrate-from-scale-set-agents?view=azure-devops) documents stateless options and differing image/operational constraints. The [networking guide](https://learn.microsoft.com/en-us/azure/devops/managed-devops-pools/configure-networking?view=azure-devops) requires an exclusive delegated subnet for VNet-injected pools. Workload federation is a service-connection/job concern, not an automatic benefit of the pool.

GitHub documents [ephemeral self-hosted execution](https://docs.github.com/en/actions/reference/runners/self-hosted-runners) and [Azure private networking for larger runners](https://docs.github.com/en/enterprise-cloud%40latest/organizations/managing-organization-settings/about-azure-private-networking-for-github-hosted-runners-in-your-organization). Product capability is not proof of this project's entitlement or government-cloud support.

**R4 — unresolved because platform authority remains unresolved.** Prefer ephemeral/effectively disposable execution to limit credentials, cache poisoning and cross-build contamination. No R1 architecture is approved and no R2 persistent fallback is accepted.

Persistent fallback would require separate review of dedicated release-only use, no developer interactive use or untrusted PR jobs, controlled patching/reimaging, deterministic cleanup, restricted admin access, reproducible tools, no persisted cloud credentials, outbound CI connectivity and retained security logs. Lower startup latency does not compensate for an unowned long-lived host.

## Network boundary and operations requirements

Preserve Premium ACR + private endpoint + public access Disabled + `privatelink.azurecr.io` + dedicated pull UAMI. No public ACR fallback.

| Placement                              | Assessment                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Dedicated CI subnet in deployment VNet | Smallest topology candidate; requires explicit isolation from application/database workloads and sufficient capacity. |
| Dedicated connected CI VNet            | Stronger network administration separation; introduces routing, DNS forwarding/linking and incident ownership.        |
| Managed runner VNet integration        | Product-specific subnet/delegation/region rules; still a dedicated CI boundary.                                       |
| Shared central cross-client network    | Larger routing/host compromise blast radius; no authority to select it.                                               |

Freeze a dedicated production CI execution boundary, but do not select a concrete placement while P4 holds. Never place runners in ACA infrastructure, ACA private-endpoint or ACR private-endpoint subnets. No actual subnet or address is selected.

Runner DNS must resolve the registry login FQDN through approved private DNS to private addresses and cover data endpoints needed for pull/verification. Another VNet requires reviewed DNS linking/forwarding and routes. No hosts-file workaround or hard-coded private IP. TLS hostname verification remains required.

Required outbound categories are CI agent/control plane and registration, GitHub source/artifacts, npm/packages, GHCR for the exact reviewed base digest, Microsoft Entra token exchange, narrowly required Azure APIs, ACR private endpoints, eventual signing service and scan/update feeds. Private does not mean no internet egress. No firewall implementation or blanket allowlist is approved.

Prefer outbound agent connectivity and no public inbound SSH/RDP. Administration uses a separately reviewed path; no Bastion/jumpbox is invented. Future network acceptance must prove DNS, authenticated push/pull/attachments, public denial and necessary egress from the actual execution environment.

Compare always-on compute against on-demand/scale-to-zero and cold-start latency, quota/availability, patching and image maintenance, DNS operations, incident response, evidence retention and per-client onboarding. No dollar amount or capacity is selected.

## Federation, registration and permissions

**I2 — federation direction approved; exact issuer/subject awaits platform finalization.** Use short-lived job federation, never a client secret, Docker password, registry admin credential or personal developer identity.

For Azure DevOps, evaluate a dedicated publisher UAMI with federated credential or an Entra app/SP with federation; both are documented. Restrict the service connection to explicitly authorized pipelines and use platform-provided issuer/subject values. [Azure federation](https://learn.microsoft.com/en-us/azure/devops/pipelines/release/configure-workload-identity?view=azure-devops).

For Actions, the documented Entra app/SP federation pattern binds Azure trust to GitHub OIDC and approved repository/environment context. Use current subject rules for the actual repository: formats can differ with repository history. An environment subject needs branch protection as a complementary control, not an assumed branch claim. [GitHub Azure OIDC](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-azure).

No broad all-repository, all-branch or all-environment trust. Freeze exact organization/project/repository, trusted definition and protected release context in the eventual identity contract. No subject string, tenant or principal is invented.

Runner registration/control-plane credentials are distinct from Azure federation. Use narrowly scoped, short-lived bootstrap authorization where supported, protect agent listener credentials, revoke/deregister at retirement and never turn registration credentials into cloud publisher authority. Exact mechanism remains product-dependent. Host managed identity must not confer ambient publishing rights.

Carry forward 4-0B's publisher-permission blocker: AcrPush is not proven to meet the required no-delete/no-unlock boundary for referrers and evidence. Do not grant it merely because it enables push, invent a custom-role fix or silently enable ABAC. This gate remains alongside platform/network readiness.

## Build, release, signing and PR isolation

| Trust plane                  | Allowed responsibility                                                      | Excluded authority                                                              |
| ---------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| PR validation                | Nonproduction compile/test and candidate checks                             | Production network/publisher federation, signing and deployment                 |
| Trusted build                | Reviewed source, compile/test/containerize, digest, pre-push scan and SBOM  | Production registry write, signer key access                                    |
| Release publisher            | Protected candidate consumption, controlled push and evidence attachment    | Arbitrary source scripts, signing key access, deletion/configuration/deployment |
| Protected signer/verifier    | Sign reviewed digest under separate identity; verify against approved trust | Generic build execution or self-approval of deployment                          |
| Independent release approver | Accept complete evidence for exact digest                                   | Inherited publisher privilege                                                   |
| Deployment identity/operator | Separately authorized what-if/deploy                                        | Publisher/signing authority by default                                          |
| Runtime pull UAMI            | Platform image retrieval only                                               | Push/delete/business resource access                                            |
| Application identity         | Approved business access                                                    | Registry publishing or deployment                                               |

PR validation and production release are distinct execution planes. Fork code, untrusted PRs, arbitrary developer scripts and unrelated projects must not run on the privileged release pool, even without a cloud token: network access and persistent state are themselves sensitive.

GitHub warns that forks can execute dangerous code through workflows on larger runners. Runner groups and protected workflows must prevent that route; do not combine a privileged event context with checkout/execution of untrusted code. [Runner access guidance](https://docs.github.com/en/actions/how-tos/using-larger-runners/controlling-access-to-larger-runners). Azure pool permissions and protected resources must similarly prevent arbitrary job admission.

Prefer a dedicated production pool/group with a fresh isolated instance per release and per-client/environment publisher identity. Do not share mutable workers/caches across production and nonproduction. Shared infrastructure administration does not authorize shared job execution, identity or cross-client routes; any shared service design needs explicit blast-radius review.

## Toolchain, artifacts and evidence

Future runner images must be patched and reproducible in configuration, with controlled Azure CLI, Node/npm, builder and approved SBOM/scanner/signing tools. No unmanaged global drift, new tool selection or version pin is introduced here.

A root Docker socket can grant host-level control. Evaluate isolated VM builds, rootless operation and BuildKit boundaries; a containerized builder is not automatically safe. Separate builds from release credentials regardless of engine choice. A managed build service needs its own authority rather than being introduced as a shortcut.

Ephemeral workspace destruction must occur after every outcome, with sanitized logs exported first. Persistent cleanup, if later approved, must be deterministic and tested. Never retain OIDC/Azure tokens, Docker auth state, signing material or candidate secrets in caches or artifacts.

Preserve the sequence: reviewed source → trusted build → candidate digest → pre-push scan → SBOM → controlled private ACR push → registry scan → findings review → sign digest → verify → release approval → deployment handoff. Push is not deployment authorization. Signing key custody, scan tools/thresholds and approval identities remain unresolved; do not sign mutable tags.

Prefer build once and promote the same digest when inputs are identical. Retain 4-0B's Vite caveat: environment-specific compiled inputs can change artifacts, so cross-environment same-digest promotion is not yet universally proven. No runtime configuration redesign or reproducibility claim follows.

Retain source SHA, Dockerfile/base digest, toolchain/nonsecret inputs, job identity, manifest digest, SBOM, scan decisions, signature/verification and approvals. Log sanitation and lifecycle ownership remain future controls; no observability implementation or F061 change is introduced.

## Decision and exact next step

| Decision   | Outcome and reason                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| Platform   | **P4**: no authoritative production frontend CI owner/platform; operator conventions are insufficient.  |
| Runner     | **R4**: no concrete platform-specific runner approval under P4; disposable private execution preferred. |
| Federation | **I2**: required direction established, exact identity and trust await platform choice.                 |
| Readiness  | **C — PLATFORM BLOCKED**, with runner/network and publisher-permission gates also unresolved.           |
| ACR gate   | **G2 retained**: material publisher trust/network decisions remain; 4A cannot begin.                    |

G1 does not require a physically provisioned runner in principle: independent ACR/pull IaC could follow a fully frozen architecture with runner provisioning separate. That condition is not met. Do not equate absence of implementation with the current absence of architectural authority, or advance 4A using guessed decisions.

Recommend exactly one next slice: **F060.4A-2B-4-0D — Production CI Platform Ownership Decision**. Its required owner input is platform selection, accountable organization/project ownership, security/release/identity/network administrators, plan and target cloud approval, and acceptance of the operational cost boundary. Use this comparison as evidence; another technical survey cannot invent those choices. Then determine which supported private execution model and federation contract can be approved.

No next slice starts here. Government portability remains deployment validation: Managed DevOps Pools explicitly excludes national clouds; do not imply a GitHub private-network option or alternate federation model establishes Azure Government/GCC compatibility.

Validation is documentation-only: internal links, first-party source review, headings/tables, formatting, whitespace/control characters, private-value review, single-file scope and `git diff --check`. No build, container or Azure tests are claimed.

**STOP FOR F060.4A-2B-4-0C PRODUCTION CI / PRIVATE RUNNER ARCHITECTURE REVIEW.**
