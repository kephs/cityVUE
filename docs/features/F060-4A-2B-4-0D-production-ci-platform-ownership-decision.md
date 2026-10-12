# F060.4A-2B-4-0D — Production CI Platform Ownership Decision

## Result and baseline

**P4 — production CI platform ownership remains unresolved. G2 retained. OWNER DECISION REQUIRED.**
This documentation-only governance assessment stops technical selection; it does not initiate another runner design.

Review date: 2026-10-11.
Fetched authoritative `origin/main` and starting HEAD: `7d7d5c32a8f8c6fd5cd10038d936d0081f0f112c`.
Isolated branch: `codex/f060-production-ci-platform-ownership`.
Starting tree/index were clean, with zero ahead/behind.

**NO CI PLATFORM WAS IMPLEMENTED.**
**NO RUNNER WAS CREATED.**
**NO WORKFLOW WAS MODIFIED.**
**NO IDENTITY OR FEDERATED CREDENTIAL WAS CREATED.**
**NO ROLE ASSIGNMENT WAS ADDED.**
**NO ACR RESOURCE WAS CREATED.**
**NO IMAGE WAS PUSHED.**
**NO AZURE LOGIN OR DEPLOYMENT OCCURRED.**
**NO F061 OR F062 CHANGE OCCURRED.**

## Evidence hierarchy and scope

Authority is assessed in this order:

1. Explicit Reqro architecture/governance decision.
2. Active production CI configuration committed to the repository.
3. Established project release documentation.
4. Explicitly documented Reqro organization/project convention.
5. Repository-hosting inference, which is insufficient by itself.

This is repository evidence, not an audit of unaccessed organization settings.
No absence claim below proves that an external service does not exist.

Reviewed [4-0 supply chain](F060-4A-2B-4-0-container-registry-supply-chain-decision.md),
[4-0A registry network/identity](F060-4A-2B-4-0A-acr-network-sku-identity-trust-decision.md),
[4-0B publisher trust](F060-4A-2B-4-0B-ci-publisher-network-federated-identity-decision.md)
and [4-0C platform/runner assessment](F060-4A-2B-4-0C-production-ci-platform-private-runner-decision.md).
These establish requirements and unresolved gates, not a chosen production CI owner.

Also inspected tracked pipeline files, workflow/configuration paths, architecture/ADR records,
project context/roadmap references and development governance documentation for CI/CD,
service connections, federation and other platform names.

## Azure DevOps evidence

**Classification: supporting; authoritative production build/release designation absent.**

[ADR-029](../architecture/decisions/ADR-029-production-operator-platform.md) remains
**Proposed, not Accepted**. It describes an Azure DevOps operator control plane with
GitHub source and private ACI execution. Its scope is tenant-domain operator activity,
not the frontend trusted build/publication/SBOM/scan/signing release lifecycle.

Five tracked files exist under `server/azure-pipelines`: request, approve and confirm
operator pipelines plus identity/job templates. The
[request pipeline](../../server/azure-pipelines/tenant-domain-operator-request.yml)
and its siblings use manual dispatch (`trigger: none`, `pr: none`) and hosted agents.
The [identity template](../../server/azure-pipelines/templates/operator-identity.yml)
references workload federation; the [job template](../../server/azure-pipelines/templates/operator-job.yml)
orchestrates the private operator.

References to `reqro-github`, `operatorServiceConnection`, expected tenant and
operator resource inputs demonstrate intended conventions, not an approved frontend
CI organization/project, actual service connection, release pool owner or publisher grant.
No root `azure-pipelines.yml` or production frontend release pipeline was found.

The operator patterns are relevant supporting evidence. They neither transfer operator
privileges to publishing nor establish that Azure DevOps owns all Reqro production CI.

## GitHub Actions and other platforms

**GitHub Actions classification: incidental references; authoritative configuration absent.**

The inspected worktree has no `.github/workflows` directory or tracked Actions workflow.
No committed production/release workflow, Azure OIDC job, protected release-environment
configuration or branch/tag publication trigger establishes Actions ownership.
ADR-029 mentions Actions as a possible alternate operator control plane; 4-0C compares it.
Those references and GitHub repository hosting are not production CI authority.

**Other platforms: absent as production CI authority/configuration.**
Searches found no Jenkinsfile, GitLab CI, CircleCI or Bitbucket Pipelines configuration.
Mentions in operator provider-neutrality documentation are test/portability references,
not platform selection. No other approved enterprise CI platform was identified.

The [2026-09-21 governance review](../development/GOVERNANCE_REVIEW.md) reported no CI
configuration at its checkpoint. Its “no Azure Pipelines” statement predates today's
operator YAML and is historical, not current evidence. It is not changed in this slice.

## Owner decision brief

**Question: Which platform should own Reqro production CI/release?**

| Option                          | Already-established Reqro-relevant tradeoffs                                                                                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. Azure DevOps                 | Existing operator conventions provide continuity. Private execution, workload federation and protected-resource approvals are documented options. Requires an explicitly owned production project, private execution path and service-connection governance; operator authority cannot be reused implicitly. |
| B. GitHub Actions               | Co-locates source and workflow administration. Private runner options, Azure OIDC and protected environments were assessed in 4-0C. Requires plan/approval eligibility, runner ownership and repository/environment trust decisions; hosting alone supplies none of these.                                   |
| C. Other approved enterprise CI | Requires the owner to identify the platform and its actual approval/ownership evidence, then establish compatibility with the existing private-registry and release controls. No speculative product is proposed.                                                                                            |

This brief carries forward 4-0C's sourced comparisons; it does not repeat product research
or select a platform for the owner. Both A and B require private ACR reachability.
Premium ACR, public access Disabled, private DNS and separate runtime pull identity remain
unchanged. Public registry access is not an alternative to an owned publisher path.

The Reqro product/platform owner must record the platform choice with infrastructure/platform
engineering, security and the CI/CD governance owner where one exists.
No established organizational production CI governance owner was found in the reviewed records.
No personal name, organization/project name, subscription or approval is invented.

The decision should identify accountable platform administration, security/release approval,
identity and network operations; applicable organization/project or repository boundary;
target cloud/plan and cost responsibility. These are owner inputs, not code-generation tasks.

## Gate and exact next action

**P4** follows because supporting operator conventions do not meet the evidence threshold
for production build/release ownership. No P1/P2/P3 selection is justified.

**G2 — F060.4A-2B-4A remains blocked.**
Private runner placement/federation trust and the 4-0B publisher permission boundary remain
unresolved; no newly authoritative decision satisfies G1.
Physical runner provisioning need not always precede independent ACR IaC, but the required
architectural authority is still missing.

**Exact next action: OWNER DECISION REQUIRED — choose A, B or an explicitly approved C above.**
**No further technical CI slice is recommended or started while P4 remains.**

CI ownership covers trusted build, release candidates, registry publication and the
SBOM/scan/sign release flow. It does not grant Azure deployment authority, PIM/operator
privilege or infrastructure approval. Local PowerShell, Docker validation, package scripts
and deployment tooling are not substitutes for CI ownership.

## Validation and stop

Documentation-only checks cover repository links, headings, tables, internal references,
formatting, whitespace/control characters, private-value review and `git diff --check`.
Exactly this document is added. No builds, tests or Azure commands are required or claimed.
No workflow, Bicep, Dockerfile, image pin, auth, package, F061/F062 or database file changes.

**STOP FOR F060.4A-2B-4-0D CI OWNERSHIP REVIEW.**
