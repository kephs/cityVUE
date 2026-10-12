# F060.4A-2B-4-0 — Container Registry, Image Publication & Supply-Chain Decision

## Status and authority

Documentation-only decision for architecture review, 2026-10-11. Outcome **B: ACR is preferred but network/SKU/identity questions require another decision.** This record freezes the requirements below; it does not authorize publication or establish production readiness.

Baseline: fetched authoritative `origin/main` at `9e936adf5f72827d61b19ea888e6a487d549eb3b`; isolated branch `codex/f060-registry-supply-chain-decision` began at that commit with a clean tree and index.

**NO REGISTRY WAS CREATED. NO IMAGE WAS PUSHED. NO DOCKER LOGIN OCCURRED. NO SIGNING KEY WAS CREATED. NO ROLE ASSIGNMENT WAS ADDED. NO AZURE LOGIN OR DEPLOYMENT OCCURRED. THE PRODUCTION IMAGE MUST REMAIN DIGEST-PINNED. NO F061 OR F062 CHANGE OCCURRED.**

No CI workflow, dependency, runtime, Bicep, image pin, database or authentication implementation is included.

Repository authorities inspected:

- [Static-origin ownership](F060-4A-2C-1B-0A-static-origin-header-ownership-decision.md): NGINX in private ACA behind Front Door Premium.
- [Image pin and local runtime validation](F060-4A-2C-1B-2-nginx-image-pinning-runtime-validation.md): evidence and unresolved supply-chain gates.
- [Private frontend IaC foundation](F060-4A-2B-1-private-static-origin-front-door-iac-foundation.md) and [private endpoint topology](F060-4A-2B-0A-private-endpoint-dns-topology-decision.md).
- [Image pin](../../deploy/frontend/nginx/image-pin.json), [Dockerfile](../../deploy/frontend/Dockerfile), [frontend module](../../deploy/azure/frontend/modules/static-origin.bicep) and [IaC entry point](../../deploy/azure/frontend/main.bicep).
- [Security framework](../security/SECURITY_FRAMEWORK.md).

The inspected repository establishes no approved production registry, completed SBOM, accepted vulnerability threshold, or signing trust policy. Existing GHCR base consumption is not production registry approval. The IaC image parameter is mandatory and documented as digest-required; its current length constraint alone is not complete digest validation.

## Registry choice and isolation

| Option                            | Integration and identity                                                                                                                                                  | Network, artifacts and assurance                                                                                                                                                                                               | Ownership and disposition                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Azure Container Registry          | ACA supports managed-identity pulls, avoiding runtime registry secrets.                                                                                                   | Public authenticated access or reviewed network restrictions/private endpoints; OCI artifacts/signatures; Defender scanning is a separate security/cost decision. Azure identity and registry audit evidence must be retained. | Preferred production technology; deployment platform owner operates it under security review.                                         |
| GHCR                              | ACA can consume registry images, but an equivalent Entra managed-identity pull path is not established here. GitHub documents token-based private package authentication. | OCI support; do not assume ACR-equivalent private networking, integrated scanning, or signature enforcement. Scans, signature handling and audit retention need an owned workflow.                                             | Keep existing upstream-base/development use. Private runtime credential lifecycle adds an unnecessary boundary for this Azure target. |
| Another approved private registry | No approved alternative was found in inspected repository evidence.                                                                                                       | Identity, networking, scan, artifact and audit support would need proof.                                                                                                                                                       | No enterprise registry is invented or selected.                                                                                       |

Sources: [ACA managed-identity image pulls](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull), [GHCR documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

Prefer a registry isolated by client deployment and environment, with a dedicated production trust boundary. This costs more than sharing, but limits publisher mistakes, deletion and policy changes to that deployment. Do not silently create a shared cross-client platform registry. Consolidation would require a separate hosting/trust decision.

Use client-neutral repository concepts such as `reqro/frontend`. Registry hostnames, resource names, subscription and region remain deployment decisions; no customer-specific naming or domains are selected.

## Runtime pull and publisher identities

Preferred runtime model: dedicated user-assigned managed identity for the frontend deployment, linked as the Container App registry identity, with pull-only access to the selected registry. System-assigned identity is supported, but user-assigned identity permits explicit lifecycle and authorization before app creation. ACR must support the ARM-audience authentication required by the documented ACA managed-identity pull flow; validate that setting later. [Microsoft pull guidance](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull).

Freeze ACR admin user **disabled**, anonymous pull disabled, and no long-lived registry username/password, repository password or Docker credential secret in the production Container App. No Contributor or Owner role is justified for image pulling.

Role mode must be explicit before IaC:

- Under registry RBAC, prefer `AcrPull` scoped to the specific isolated registry, never subscription-wide.
- If repository ABAC is selected, legacy `AcrPull` is not honored. Use the supported `Container Registry Repository Reader` model with a reviewed repository condition instead; do not describe `AcrPull` as repository-scoped. No catalog listing permission is presumed necessary.
- Confirm the chosen role mode works with ACA pull identity before claiming readiness. [ACR ABAC authority](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-abac-repository-permissions).

Prefer a separate CI publisher using workload federation and short-lived credentials. Freeze no production publication through a developer's personal Docker login. CI platform, issuer, subject/audience restrictions, protected source/environment, role mode and authorized approvers remain unassigned. Future publisher permission permits the approved repository's pushes, not registry configuration or lifecycle deletion. Runtime pull identity receives no push permission.

Application code requires no registry access. Future identity configuration must restrict exposure of the pull identity to application code where supported and prove that boundary; attaching a managed identity alone is not proof of token isolation. [ACA identity controls](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity).

## Registry networking and SKU gate

The existing private ACA origin does not automatically require or authorize ACR Private Link. Registry access is a separate outbound dependency for image pulls and publishing.

| Candidate                                 | Required proof before selection                                                                                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public endpoint with authenticated access | Explicit acceptance of public network reachability; anonymous/admin access disabled; least privilege, audit and reliable ACA/CI egress. Authentication is not network isolation.       |
| Public endpoint with network rules        | Known permitted ACA and runner paths, supported rule semantics, DNS and data endpoint reachability; no assumed stable egress addresses.                                                |
| Private endpoint                          | Approved runner and ACA connectivity, private DNS and registry data endpoint resolution, firewall paths, operational recovery and cost. No endpoint is added here.                     |
| Trusted Azure services exception          | Verify the exact service and operation are supported and authorized. It is neither a universal ACA bypass nor a substitute for identity/network design. No blanket exception approved. |

ACR Private Link requires **Premium**. Networking remains unresolved until the ACA pull path and CI publisher path are designed together. The existing ACA private endpoints do not serve as ACR endpoints. [ACR private endpoint guidance](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-private-endpoints).

No Basic/Standard/Premium SKU is selected. Before selecting one, evaluate Private Link, any geo-replication and zone redundancy requirements, retention/purge feature availability, artifact/referrer support and encryption interactions. No availability, retention or replication feature is assumed necessary. Cost ownership is a prerequisite.

## Artifact identity, platform and provenance

Production references MUST use `<registry>/reqro/frontend@sha256:<digest>`. Tags are navigation aids only; `latest`, `stable` and `production` without a digest are prohibited deployment identities. Keep `frontendImageReference` digest-required and verify the complete reference before future IaC use.

The reviewed base is `ghcr.io/nginx/nginx-unprivileged:1.30.5-trixie`, pinned to OCI index digest `sha256:d715f7a85cdfea820fec743ea5aee8a22f91e00ff310ad6275d2638112d8cf8d`. It is not the Reqro application image. The published Reqro image must contain the production Vite output, reviewed NGINX configuration and pinned base. No image digest for that future artifact is invented.

Current [ACA container authority](https://learn.microsoft.com/en-us/azure/container-apps/containers) requires Linux x86-64 (`linux/amd64`). Therefore prefer a single-platform `linux/amd64` Reqro image for this target, reverified before implementation. This follows platform documentation, not the local test host. The upstream multi-platform index does not make Reqro multi-platform. Publishing a multi-platform Reqro index would require a separate need, build/scan evidence for every included platform and correct index/child digest linkage.

Before any publication, retain provenance connecting:

- Exact Git commit and reviewed source state; production frontend build command, lockfiles, tool versions and nonsecret Vite build inputs.
- Dockerfile path `deploy/frontend/Dockerfile`, build context controls, NGINX configuration and frontend artifact hashes.
- Pinned base index and selected platform child digest; generated output manifest digest and target platform.
- Build timestamp, builder identity, execution evidence and links to tests/review.

Use standard OCI source/revision/created metadata and standard digest-bound provenance attestations where supported; do not invent a proprietary format. Metadata is not proof of a trusted builder by itself. The output identity must be the distributable manifest digest, not a local Docker image/config ID. Verify it after publication; stop on any mismatch.

## SBOM and vulnerability gates

An SBOM is **mandatory before publication**, covering the final image's operating-system packages and bundled frontend dependencies, with scope/coverage limitations recorded. Prefer machine-readable SPDX JSON; CycloneDX is also a standard alternative if the approved tooling and consumer require it. An OCI-attached artifact is the transport/association mechanism, not a competing SBOM schema. Bind the SBOM to the exact image digest and retain it with provenance; future tooling must prove generation and registry attachment compatibility.

No generator is approved or installed here. The earlier record found Docker Scout installed but its scan required login and did not complete; that does not prove a usable approved SBOM pipeline. A generator and usable noninteractive authentication/licensing model must be reviewed before publication.

Require both gates:

1. Pre-push local/CI scan of the final artifact, with scanner/version, vulnerability database freshness, platform, digest, coverage and findings retained. Failed or incomplete scans block publication.
2. Registry-side scan of the published candidate, with digest correlation and completed review before production promotion/deployment. New findings or material evidence changes reopen review.

Defender for Cloud is the preferred ACR registry-scan candidate, subject to supported image/platform/network coverage, plan licensing, cost and ownership approval. Registry assessment after push/import cannot replace the pre-push gate. Registry vulnerability assessment is distinct from CI scanning and runtime security; no ACA runtime protection is claimed. [Defender registry scanning](https://learn.microsoft.com/en-us/azure/container-registry/scan-images-defender).

| Findings   | Required decision                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Critical   | Security owner review; block until remediation or an explicitly authorized, documented risk decision under an approved exception policy. |
| High       | Security owner and release owner review with remediation/mitigation evidence; unresolved findings block until an authorized decision.    |
| Medium/Low | Triage by maintenance/release owner, with security escalation, tracking and approved acceptance policy.                                  |

Named owners, acceptance criteria, exception authority, evidence age and remediation deadlines are **unresolved**. No numeric SLA or zero-vulnerability rule is invented. Until policy and accountable approvers exist, no production publication/deployment is authorized.

## Signing and release verification

Recommend OCI-compatible signing **required before deployment**, with Notation/Notary-based ACR workflows as the preferred direction. Signing authenticates artifact provenance/integrity; it does not make vulnerable content safe. Keys, certificates, signer identity, trust roots, rotation/revocation, timestamp policy and verifier ownership are unresolved deployment blockers. No key or self-signed tutorial trust is created/adopted.

Microsoft documents ACR-attached signatures and explicit Notation verification. Its workflow pushes the artifact before signing its registry digest. [Notation/ACR guidance](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-tutorial-sign-build-push).

No native ACA signature admission enforcement is established by the current repository or reviewed ACA container configuration documentation. Treat verification as a mandatory, fail-closed CI/release gate, not as an implemented ACA runtime control. Microsoft's [Ratify/Azure Policy enforcement guidance](https://learn.microsoft.com/en-us/azure/security/container-secure-supply-chain/articles/validating-image-signatures-using-ratify-aks) targets AKS; do not transplant it or invent an admission controller.

The release gate must verify the exact deployed digest against approved signer/trust policy, preserve evidence, and prevent unreviewed digest substitution or direct deployment bypass. Deployment permission ownership and protection of that gate remain required; a voluntary CI check is insufficient.

## Publication sequence and lifecycle

Freeze the logical release sequence:

1. Review source commit; build production frontend and container; calculate distributable digest.
2. Generate digest-bound SBOM/provenance, scan locally/in CI and obtain security review.
3. Obtain signing approval and use pre-publication signing if the approved tooling supports it.
4. Publish only an approved candidate to the approved registry; verify published digest and attach evidence.
5. Complete registry scanning/review. For registry-based Notation, sign the published digest here and verify it before production promotion; candidate publication is not deployment approval.
6. Protect the approved artifact, verify signature/evidence for the exact digest, update IaC with that immutable reference, perform separately authorized authenticated Azure what-if, then obtain deployment authorization.

This separates the conceptual sign-before-release requirement from registry tooling that needs a candidate push first. No unsigned candidate may become deployable. No push, signing, what-if or deployment is authorized by this record.

Platform operations owns lifecycle policy, with security/release approval. Retain previously approved rollback digests, SBOMs, signatures and provenance together. Numeric retention, untagged-manifest handling, purge schedules and exception processes remain unset; no automatic purge is authorized.

Recommend write protection for release tags and write/delete protection for approved production manifests and their required evidence. ACR supports image locking; tag protection alone is insufficient to preserve the underlying manifest. [ACR image locks](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-image-lock).

Pull/deployment identities cannot delete. The future CI publisher should not delete or unlock production artifacts; exact role definitions must prove this. Only a separately authorized lifecycle operator may retire artifacts after rollback/dependency review. Locks complement least privilege; an operator able to unlock still needs controlled authority and audit.

## Proposed trust matrix

These are intended responsibilities, not existing grants. “Scoped” requires future identity design; “review” is not a cloud role. Tenant admin means a Reqro application tenant administrator, not an Azure subscription administrator.

| Principal                      | Build            | Push                              | Pull                              | Delete                             | Configure registry      | View findings              | Sign                                | Approve deployment                          |
| ------------------------------ | ---------------- | --------------------------------- | --------------------------------- | ---------------------------------- | ----------------------- | -------------------------- | ----------------------------------- | ------------------------------------------- |
| Developer                      | Local/review     | No production                     | Approved development only         | No                                 | No                      | Scoped review              | No production                       | No by default                               |
| CI publisher                   | Reviewed CI      | Scoped candidate/release workflow | Scoped build inputs/output        | No                                 | No                      | Scoped gate evidence       | Separate approved signer stage only | No                                          |
| Platform operator              | No routine build | No routine push                   | Scoped verification               | Separate approved lifecycle action | Change-controlled scope | Scoped operations/security | No by default                       | Only separately appointed release authority |
| Container App managed identity | No               | No                                | Specific registry/repository only | No                                 | No                      | No                         | No                                  | No                                          |
| Application runtime            | No               | No                                | No direct registry need           | No                                 | No                      | No                         | No                                  | No                                          |
| Tenant admin                   | No               | No                                | No                                | No                                 | No                      | No infrastructure findings | No                                  | No                                          |

A security owner reviews findings and trust policy; a separately appointed release approver authorizes deployment. Actual persons/groups and separation-of-duty enforcement remain unset. CI publication alone confers neither risk acceptance nor deployment approval.

## Existing evidence and remaining deployment proof

The prior local runtime record reports non-root UID/GID 101, port 8080, read-only root filesystem, tmpfs runtime paths, all capabilities dropped, no-new-privileges, successful `nginx -t` and real HTTP routing/header checks. Its 44 distinct checks (15 runtime, 22 pin/routing/bridge, seven MSAL) are historical evidence, not tests rerun here. The blocked scanner is not a vulnerability pass.

Image-level invariants include the reviewed content, user declaration and listen port. Read-only mounts, capabilities and no-new-privileges depend on platform enforcement. Future ACA validation must map each local assumption to supported controls and prove the resulting boundary, or stop for review of unsupported controls. Do not claim ACA accepts every Docker security flag.

No passwords, API keys, Entra secrets, private certificates/keys or registry credentials may enter image layers, frontend build inputs or output. Future validation must inspect image environment, Docker history and filesystem, including prior layers and build context exposure, with sanitized evidence.

Before deployment, prove approved registry/identity/network design, authenticated pull reachability, SBOM and both scan reviews, trusted signing and enforced release verification, digest equivalence, runtime control mapping, rollback availability and separate what-if/deployment authorization.

## Next decision and validation scope

Recommend **F060.4A-2B-4-0A — Registry Network, SKU & Identity Trust Decision** as the smallest next architecture slice. Resolve registry/runner network paths, SKU/cost, registry isolation ownership, RBAC versus ABAC and federated publisher/pull identity trust boundaries. Assign security/release/lifecycle owners and identify the approval path for scanner/SBOM tooling, severity policy and signing trust.

Only after that decision may a separately authorized F060.4A-2B-4A ACR + Pull Identity IaC Foundation be considered. Publication and deployment remain separately gated. Neither slice starts here.

Validation for this change is limited to Markdown formatting, links/internal references, headings, tables, whitespace/control characters, private-value review, `git diff --check` and exact one-file scope. No build, container, database or Azure tests are needed or claimed. No production addresses, resources, identities, retention values or secrets are selected.

**STOP FOR F060.4A-2B-4-0 SUPPLY-CHAIN ARCHITECTURE REVIEW.**
