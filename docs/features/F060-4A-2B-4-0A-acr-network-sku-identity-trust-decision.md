# F060.4A-2B-4-0A — ACR Network, SKU & Identity Trust Decision

## Status and baseline

Documentation-only architecture decision for review, 2026-10-11.

**B — NETWORK READY / CI BLOCKED.** Freeze the target ACR network/runtime design below; stage progress through a separate publisher decision before implementation. “Network ready” means the design is specified, not that connectivity has been deployed or tested. Do not start 4A while the private publisher path is unresolved. No temporary public fallback is approved.

Authoritative fetched `origin/main`: `9ff3da889efe104089050636c747023796076982`. Branch `codex/f060-acr-network-identity-decision` starts at that exact HEAD with clean tree/index and zero ahead/behind.

**NO ACR WAS CREATED. NO MANAGED IDENTITY WAS CREATED. NO PRIVATE ENDPOINT OR DNS RESOURCE WAS CREATED. NO ROLE ASSIGNMENT WAS ADDED. NO AZURE LOGIN OR WHAT-IF OCCURRED. NO IMAGE WAS PUSHED. NO CI RUNNER WAS CREATED. NO SECRET WAS CREATED. NO F061 OR F062 CHANGE OCCURRED.**

No Docker login, deployment, CI workflow or runtime change occurred.

## Source architecture and inspected implementation

- [Registry/supply-chain decision](F060-4A-2B-4-0-container-registry-supply-chain-decision.md) preserves digest pinning, SBOM, dual scan gates, signing before deployment and separate publisher/pull identities.
- [Private frontend foundation](F060-4A-2B-1-private-static-origin-front-door-iac-foundation.md) and [endpoint/DNS decision](F060-4A-2B-0A-private-endpoint-dns-topology-decision.md) establish internal workload-profile ACA in a custom VNet, behind Front Door Premium.
- [Network module](../../deploy/azure/frontend/modules/network.bicep) declares `aca-infrastructure`, delegated to `Microsoft.App/environments`, and nondelegated `private-endpoints` for the customer-managed ACA endpoint. CIDRs are parameters.
- [Private connectivity](../../deploy/azure/frontend/modules/private-connectivity.bicep) uses a private DNS zone, VNet link with registration disabled and endpoint zone group. Its ACA zone is separate from ACR DNS.
- [Static-origin module](../../deploy/azure/frontend/modules/static-origin.bicep) has no identity or registry configuration. Its required `frontendImageReference` is documented as a published Reqro digest reference; the current minimum-length check does not fully validate that syntax.
- [ADR-029](../architecture/decisions/ADR-029-production-operator-platform.md) is explicitly **Proposed, not Accepted** and concerns operator execution: GitHub source, Azure DevOps control plane and a separate private execution substrate. It does not approve a frontend publisher or reusable runner. Its operator identity must not acquire registry publisher privileges.
- Inspection found no deployed registry identity or reusable frontend UAMI resource module in `deploy/azure`. Existing naming uses deployment-supplied prefixes; logical role separation below does not invent resource names.

This decision narrows the earlier registry recommendation without changing the existing inbound Front Door/ACA topology, image or runtime.

## Network alternatives

| Option                                              | Runtime and publisher reachability                                                                 | Scanning, DNS and operations                                                             | Isolation, cost and decision                                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| A. Public endpoint, Entra/RBAC only                 | ACA and public CI can reach it; identity limits operations but does not restrict network exposure. | Simple public DNS; Defender still needs enablement and policy.                           | Lowest network burden, broader attack surface; no Premium requirement solely from this model. Rejected for the target posture. |
| B. Public endpoint with IP rules                    | ACA/CI require approved egress; hosted-agent address churn creates maintenance risk.               | Public DNS, firewall lifecycle and scanner exception review.                             | IP rules require Premium; public exposure persists. Rejected without a compelling public CI requirement.                       |
| C. Private endpoint, public disabled                | ACA uses VNet/private DNS; publisher must have private reachability.                               | Private DNS and controlled operator access required; Defender exception addressed below. | Premium plus endpoint/operations cost; limits data-plane reachability. Selected target, staged behind CI decision.             |
| D. Private endpoint plus restricted public endpoint | Private runtime pull with public CI path possible.                                                 | Two access paths, IP-rule maintenance, split resolution and scanner review.              | Premium and greater configuration/blast-radius burden. No temporary hybrid approved.                                           |
| E. Service endpoint                                 | Narrower supported host/service compatibility; no established ACA solution here.                   | Public service endpoint addressing; different exception limitations.                     | Premium and preview limitations, no advantage for Reqro. Rejected.                                                             |

Microsoft recommends Private Link over service endpoints in most scenarios; ACR service endpoints have limited supported host types and cannot coexist with Private Link in this configuration. [Service endpoint authority](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-vnet). IP restrictions require Premium and hosted-agent ranges need maintenance. [Public network rules](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-access-selected-networks).

## Selected target and cost

Select **ACR Premium + private endpoint + public network access Disabled + Azure Private DNS + authenticated UAMI pull**. Premium follows from Private Link, not a throughput estimate. Registry, endpoint, DNS, runner operations and Defender licensing create real costs; no price, capacity, geo-replication or zone-redundancy requirement is invented.

Microsoft documents Premium as required, and private-only ACR cannot be reached directly by Microsoft-hosted Azure DevOps agents. Outside the connected network, portal/CLI repository and tag browsing is unavailable. [ACR private endpoint authority](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-private-endpoints).

Freeze one registry per client deployment/environment, including separate production isolation. No cross-client shared registry or implicit cross-environment publisher trust. Lifecycle consolidation would require review. Repository concept remains `reqro/frontend`; names, addresses, region and subscription remain parameters.

The staged decision permits design review only. It neither approves an unusable private registry deployment nor opens public access to work around missing CI.

## Runtime path, subnet and DNS ownership

Runtime path: ACA platform image retrieval through the Reqro VNet, resolving the registry FQDN privately, reaching the ACR private endpoint over TLS and authenticating with the dedicated pull UAMI. Custom-VNet ACA supports access to private endpoints; internal ingress configuration does not by itself prove registry egress. [ACA network authority](https://learn.microsoft.com/en-us/azure/container-apps/networking).

Require a **dedicated nondelegated ACR private-endpoint subnet** in the Reqro VNet. Do not use the ACA delegated infrastructure subnet. Although the existing ACA endpoint subnet is nondelegated, its reuse/capacity/security rules are not approved for ACR; this decision does not authorize reuse. Exact subnet name, CIDR, capacity and network-policy treatment belong to the future reviewed IaC parameters/design.

Use `privatelink.azurecr.io` for this Azure commercial target, with VNet linking and an ACR endpoint DNS zone group following the existing private-DNS pattern. Platform network operations owns endpoint/DNS lifecycle and approvals. Avoid conflicting duplicate zones; any existing centrally owned zone requires an explicit ownership/link agreement.

Resolution and firewall design must cover the login endpoint and dedicated regional data endpoints. Private endpoint creation enables dedicated data endpoints automatically; pulls download layers through those endpoints, whereas blob uploads use the login endpoint. Do not verify login DNS alone and declare pulls ready. [Dedicated data endpoints](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-dedicated-data-endpoints).

Future 4A must derive endpoint records from service configuration, not fixed IPs, and retain TLS hostname verification. The ACA VNet must resolve all required records and allow the documented platform/identity dependencies. Future deployment evidence must prove authenticated pulls and public denial.

A publisher in another VNet/network needs an explicitly approved route and DNS forwarding/link design. No peering, resolver, VPN or cross-VNet topology is assumed here. That path belongs to 4-0B. Controlled operator inspection uses the same reviewed network boundary; developer laptops need no production network access for routine development.

## Pull identity and permissions

Freeze a dedicated deployment/environment-specific **user-assigned managed identity**, attached to the frontend Container App and referenced specifically in its registry configuration. It is for platform retrieval only, separate from business runtime, worker, deployment operator and publisher identities.

For the current isolated-registry foundation choose registry RBAC with **`AcrPull` on that registry only** as the future implementation candidate. No Contributor/Owner, push or delete. No subscription scope. No ABAC enablement in this slice or implicit future 4A scope.

If a later decision selects repository ABAC, replace the role design with supported repository-reader permissions/conditions; legacy `AcrPull` is not honored by ABAC-enabled registries. [Role-mode authority](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-abac-repository-permissions).

Microsoft recommends UAMI when possible and requires the relevant ARM-audience authentication support for managed-identity pulls. Validate that registry setting in future work. [Pull guidance](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull).

Container code does **not** need the pull identity. Require identity availability restricted to platform use, using the supported `identitySettings` lifecycle `None` model after verifying the selected stable ACA API/profile supports it. Do not confuse this with removing the app's identity attachment. If unavailable, stop for security review rather than silently exposing tokens. [Identity availability controls](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity).

Freeze `adminUserEnabled = false`, no username/password outputs and no `listCredentials`/`listKeys` behavior. Anonymous pull remains disabled: Microsoft documents it as disabled by default and an opt-in Standard/Premium feature. Future IaC must verify the selected API schema rather than inventing properties. [Anonymous access authority](https://learn.microsoft.com/en-us/azure/container-registry/anonymous-pull-access).

No long-lived service principal secret, registry password, public artifact export, unauthenticated repository access or external sharing is authorized.

## Publisher and CI decision boundary

Production publisher direction is **federated CI/workload identity**, owned logically by deployment platform/release engineering, scoped per client deployment/environment. Named owner, federation issuer/subject/audience, service connection, protected source/environment and private execution location are absent. Publisher identity is **IMPLEMENTATION-BLOCKED**, not rejected.

| CI option                                                      | Decision                                                                                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| CI-1: self-hosted Azure DevOps agent with private reachability | Preferred candidate, consistent with repository control-plane direction; no trusted frontend runner architecture exists yet. |
| CI-2: retain public ACR access for CI                          | Rejected for this target. No temporary firewall opening or hosted-agent range exception.                                     |
| CI-3: another approved private publisher environment           | None is established. Could be assessed in 4-0B without reusing operator/worker authority.                                    |

A private runner decision is a **hard prerequisite for 4A implementation**, not merely for the eventual push. Runner resources/workflows belong to a separate CI platform slice. 4-0B must decide runner isolation and maintenance, protected job admission, private DNS/routes, required outbound identity/source/scanner services, nonsecret federation and operator recovery. Do not run untrusted pull-request jobs with production publisher authority or network access.

Future publisher permissions may include scoped write/push, manifests/tags and signature/SBOM attachments. Do not automatically grant configuration, role assignment, endpoint management, delete/purge or deployment approval. Exact role selection is reserved until the chosen permission model is checked against those requirements.

## Defender and trusted-service boundary

Accept, as the architecture recommendation subject to this review, the ACR **trusted Microsoft services bypass for the purpose of Defender registry scanning** while public network access stays Disabled. This is an explicit trust exception, not general public access.

The Azure switch applies to Microsoft's supported trusted-service set; it is **not a configurable Defender-only allowlist**. It does not grant arbitrary Azure tenants registry access. Service authentication/authorization still apply; ordinary RBAC permissions remain necessary where the service requires them. Microsoft's table specifically does not require a customer-configured managed identity/RBAC assignment for Defender scanning. Do not fabricate an `AcrPull` identity for Defender. [Trusted-service authority](https://learn.microsoft.com/en-us/azure/container-registry/allow-access-trusted-services).

No other bypass-dependent workload is approved by this purpose statement. Platform/security review must acknowledge the switch's actual breadth, track supported-service changes and prevent unrelated identity grants. If that breadth is rejected, registry-side scanning remains a deployment blocker until a separately reviewed private scanner design replaces it; do not enable public access.

Defender entitlement, cost, accountable security owner and successful digest-correlated scanning remain activation/deployment gates. No Defender plan is enabled here. Network-restricted registry scanning requires the exception in current guidance. [Defender scanning](https://learn.microsoft.com/en-us/azure/container-registry/scan-images-defender).

Pre-push scanning operates on the built artifact before ACR publication; it does not inherently need production ACR pull access. Its vulnerability database/service egress and licensing still need review. Defender reads the registry through its service authority after push; neither scan replaces the other or proves runtime protection.

## Signing, verification and release sequence

Signing and verification reuse the approved private release execution path. No public registry exception for signing. The signer also needs separately approved access to its signing service/key boundary; no key, identity or endpoint is created here.

Prefer fail-closed signature verification in the protected release stage, bound to the exact image digest and retained evidence, before an independent release approval. Controlled operator verification is a separately authorized recovery path. No native ACA signature enforcement is claimed; bypass-resistant deployment permissions are required.

Refine the prior release order to:

1. Reviewed source → production frontend/container build and digest.
2. Pre-push vulnerability scan/review → mandatory digest-bound SBOM/provenance.
3. Controlled ACR candidate push → published digest verification.
4. Registry-side scan → findings review under approved policy.
5. Signing → signature verification → release approval.
6. Exact immutable digest supplied to IaC → separately authorized Azure what-if → deployment authorization.

Candidate push is **not production approval**. Missing SBOM, failed scan, unknown severity acceptance, untrusted signer or digest mismatch blocks progression. The prior signing/SBOM/severity-policy blockers remain; no threshold or tool is invented.

## Trust and lifecycle matrix

Intended authority only; no grants exist from this decision.

| Principal                      | Registry/network authority                                                                                                 | Release authority                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Developer                      | Local builds; no production push or mandatory private access; exceptional inspection through approved read-only operations | No default signing, risk acceptance or deployment approval         |
| CI publisher                   | Scoped push/pull and evidence attachment on approved private path; no configuration, role grants or automatic delete       | Produces candidate; cannot self-approve deployment                 |
| Pull UAMI                      | Pull-only target registry, platform retrieval; no business access, write or delete                                         | None                                                               |
| Application runtime / worker   | No use of frontend pull identity; no registry publishing authority                                                         | None                                                               |
| Platform operator              | Separately authorized configuration, endpoint approval, incident response and lifecycle functions                          | No automatic signer or release-approver role                       |
| Security / release authorities | Review findings/trust evidence through controlled access                                                                   | Separate named approvers required; not inferred from CI permission |
| Reqro tenant administrator     | No infrastructure registry or network rights from application role                                                         | None                                                               |

Lifecycle deletion/purge belongs to separately authorized platform operations. Publisher cannot automatically delete or unlock releases; pull identity cannot delete. Preserve approved rollback digests with signatures, SBOMs and provenance until an approved lifecycle policy permits retirement. Numeric retention/purge remains unset.

## Readiness, next slice and validation

**Final classification B: NETWORK READY / CI BLOCKED.** The selected registry network, isolation, DNS/subnet and runtime pull trust model is frozen for review. Operational reachability is untested and the publisher federation/private path is not approved.

Next: **F060.4A-2B-4-0B — CI Publisher Network & Federated Identity Decision**. It must resolve publisher trust and private connectivity before 4A. No next slice begins here.

After its acceptance and separate implementation authorization, the bounded 4A candidate is: Premium ACR with public/admin/anonymous access disabled, reviewed trusted-services posture, dedicated pull UAMI and registry-scoped AcrPull, dedicated nondelegated ACR endpoint subnet/endpoint, ACR private DNS/link/zone group, and ACA registry/identity availability wiring, plus focused tests/documentation. No runner, publisher role/federation implementation, image push, signing infrastructure, what-if or deployment is included automatically. **No future IaC implementation is authorized by this documentation task alone.**

Region, CIDRs, names, actual principals, runner location, operational access details, scanner/SBOM tools, severity acceptance and signing trust still need the identified owners/decisions. Premium is a real procurement/cost decision, with no dollar estimate. Preserve client neutrality; verify cloud-specific suffixes, feature/identity/Defender availability and APIs for any government deployment. No GCC/Azure Government compatibility claim is made.

Validation is documentation-only: source links, local references, headings, tables, formatting, whitespace/control characters, private-value review, exact single-file scope and `git diff --check`. No build, container, database or Azure tests are claimed.

**STOP FOR F060.4A-2B-4-0A NETWORK / IDENTITY ARCHITECTURE REVIEW.**
