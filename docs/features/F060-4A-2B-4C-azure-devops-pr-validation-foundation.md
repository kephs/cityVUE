# F060.4A-2B-4C — Azure DevOps PR Validation Foundation

## Authority and dependency boundary

Proposed feature identifier: **F060.4A-2B-4C**. Repository implementation and
local validation only, following the PR #55 merge-governance assessment.
Baseline: `786b50a52c0ac7fdac6405da64373650fa0a3d17`, verified clean locally and
equal to remote main on 2026-10-13. Isolated branch:
`codex/azure-devops-pr-validation-foundation`. No staging, commit, push,
pipeline registration, pool provisioning, grant, ruleset configuration or
deployment is authorized. F062 and existing operator pipelines are unchanged.

The [4-0E contract](F060-4A-2B-4-0E-azure-devops-private-runner-federation-contract.md)
retains Azure DevOps Services orchestration and GitHub source/review. This is
separate from future 4B production pool/publisher federation work.

**Execution dependency, not copied here:** [PR #55](https://github.com/kephs/cityVUE/pull/55),
approved commit `2d4609133a0c94dc5d505424d10672c9c8a2eece`, supplies
`npm run validate:frontend:iac`, the fresh-compilation runner, and ACR/freshness
tests. They are absent from this main baseline. The preflight fails until those
changes are integrated through separately approved governance. This branch must
not cherry-pick, amend or otherwise modify that feature to make a demonstration
pass. Its recorded 98-test result is historical evidence, not a run of this branch.

## Pipeline design and acceptance criteria

- [Entry YAML](../../server/azure-pipelines/frontend-iac-pr.yml) enables PRs
  targeting main, including drafts; automatic cancellation supersedes obsolete
  builds. Push CI is disabled and there are no path filters or schedules.
- [Extends template](../../server/azure-pipelines/templates/frontend-iac-pr.yml)
  defines one ordinary validation job. The string parameter `prAgentPool` has
  exactly one allowed value, `reqro-pr-validation`. This is a **proposed logical
  pool name**, not a statement that any pool exists. Actual organization/project,
  pool ID, host image, network, administrators and capacity remain unresolved.
  A different binding requires reviewed YAML changes; an unavailable pool must
  prevent execution, never select a hosted or production fallback.
- Clean workspace and clean self checkout, no retained checkout credentials,
  submodules or LFS. Validate the PR merge checkout; do not replace it with main
  or an earlier compiled ARM artifact. Record source/head, base, tested merge
  SHA and run URL as evidence when the platform is configured.
- `UseNode@1` selects exact Node `24.14.0`, with `checkLatest: false`; preflight
  confirms that version, npm, a reachable Linux Docker daemon, the validator file
  and the exact package script. The pin is a reproducibility choice, not a claim
  of perpetual patch currency. Platform owners must review tool patches.
- Invoke the existing validator from `$(Build.SourcesDirectory)` under
  `set -euo pipefail`. No failure masking, optional validation, retries of tests,
  `continueOnError`, deployment stages, image pushes or extra step parameters.
- No AzureCLI task, service connection, variable group, credential environment,
  signing key, publisher/application/pull identity or production resource is
  attached. The separate PR security suite installs the existing server lockfile
  dependencies with lifecycle scripts disabled, as described below.

The PR #55 runner supplies the pinned Azure CLI Docker image
`mcr.microsoft.com/azure-cli:2.90.0-azurelinux3.0` and Bicep `v0.48.1` install,
lint/build, source snapshot and hash checks, test execution, post-test freshness
verification and normal-exit cleanup. Do not bypass it with direct test execution
or an ignored pre-existing ARM file. Docker/Bicep/download failure must fail CI.
Host Azure CLI, Azure login and private ACR access are unnecessary.

## Threat model and disposable agent requirements

Treat all PR contents, package scripts (including npm lifecycle hooks), tests,
Docker commands and pipeline changes as untrusted code. A shell with access to
the Docker daemon can potentially control the host. The compiler container's
read-only input mount and absence of a mounted Docker socket do **not** remove
the host job's Docker authority. Use one disposable VM per job, in a dedicated
PR-only private pool; no production/release agent reuse, interactive sessions,
cross-job workspace or shared writable release caches. A Docker socket must not
expose a shared host. Rootless alternatives need compatibility review before use.

The preferred MDP stateless VNet-injected model needs a separate delegated PR
subnet and enforced separation from production networks, private ACR, ACA,
databases, vaults and administrative endpoints. No production or business roles
may be obtainable through host IMDS or cached credentials. Pool names, labels,
YAML conditions and capability demands cannot establish this boundary.

Allow only reviewed outbound agent/control-plane, GitHub checkout, Node download,
MCR image/layer and Bicep release/CDN traffic, including required DNS/TLS paths.
Resolve the actual domain list from current vendor documentation and observed
downloads before activation; no invented complete allowlist. Private agents still
need bounded internet egress. No inbound public SSH/RDP or production routes.
Limit Azure DevOps job-token scope and Build Service permissions; do not expose
System.AccessToken to scripts or grant repository write/admin privileges to jobs.

Because GitHub source is public, **disable fork builds initially** in Azure
DevOps platform settings. This cannot be enforced by `pr` YAML alone. Enable only
after explicit security approval, isolated-pool verification, and authorized-user
admission of fork runs. Keep fork secrets and equivalent-to-internal permissions
disabled. Internal PR code also remains lower trust.

Discard the entire agent, Docker state, workspace, tool caches and transient auth
after success, failure, cancellation, timeout or agent loss. Checkout cleaning and
the validator's `finally` block are insufficient for abrupt termination. Require
platform teardown/reaping evidence. Retain bounded sanitized logs (tool versions,
SHA provenance, ARM hash, results); define access/retention owners before execution.
Do not publish credentials, full environments, source snapshots or arbitrary PR
artifacts. This foundation publishes no artifacts and creates no cleanup resources.

## Template protection: implemented structure versus external authority

The local `extends` template has no arbitrary job/step hooks, but **both YAML
files and these tests are editable in a PR**. CODEOWNERS is review routing, not a
tamper-proof execution boundary. Static policy tests can themselves be changed;
freshness checks do not prove validator integrity.

Microsoft documents protected-resource checks (including agent pools), required
extends templates, and templates anchored to reviewed refs. Before claiming
enforcement, platform administrators must establish and test a required-template
check on the dedicated PR pool and restricted pipeline authorization, using a
trusted template resolved from a protected ref in the existing GitHub repository.
Resolve the exact repository/ref/path and App-backed resource binding as real
configuration inputs; this foundation does not invent a service-connection name
or add an external repository reference. Do not treat a same-PR relative template
as that trusted ref. The repository need not move to Azure Repos.

Negative activation tests must prove that removing extends, substituting a PR
template/ref, adding steps, using another pool, or omitting validation cannot
produce the accepted required check. A pool check alone is insufficient if altered
YAML can avoid that pool or finish green without a job. Verify end-to-end check
identity and mandatory execution, restrict pipeline editing/queue permissions,
and escalate any enforcement gap rather than claiming the template solves it.
Separately protect and review validator/test/package changes. Required-template
enforcement does not make the code under test or npm scripts trustworthy.

## GitHub integration, check identity and rules

Install/authorize the Azure Pipelines GitHub App only for the approved repository.
Create the dedicated pipeline from this entry path after dependency review; no
developer PAT or personal OAuth production dependency. The App integration posts
overall-run and job Checks. Preserve failure/cancellation conclusions. Native
check publication does not require a custom status-posting script or JUnit upload.

The **actual check context and App ID remain unresolved** until a registered PR
run is observed. `frontend_iac_validation` is a YAML job identifier, not a promise
of the emitted GitHub check name. Select the exact observed overall validation
check and expected Azure Pipelines App as the required source. Test current SHA
association, red/green/cancelled/missing behavior and reject stale successes.
Do not accept a manually posted status or prior local test report as CI evidence.
GitHub can accept skipped/neutral required-check conclusions; therefore prevent
an omitted validation from becoming such an acceptable result during activation.

Minimum main ruleset: Active, PR required, at least one independent approval,
dismiss stale approvals, require approval after the latest reviewable push, resolve
threads, require code-owner review, require the verified App-scoped status, require
up-to-date base, block force pushes/deletion, and no standing bypass actors.
Ruleset administration remains privileged: an owner able to edit policy can
disable it. Restrict administrative ownership and require independently recorded
approval for governance changes; personal repository ownership is a residual risk.
Public-repository rulesets are available without a paid GitHub upgrade; verify
entitlement again if visibility/ownership changes. Do not make a workflow-specific
GitHub Actions rule a substitute for this Azure DevOps check.

[CODEOWNERS](../../.github/CODEOWNERS) contains **commented candidate patterns
only**. It assigns no owners. Independent infrastructure/security, CI and governance
identities are unresolved. Assign verified users/teams with write access, protect
CODEOWNERS itself and review last-match precedence. Do not invent handles, assign
the author as the independent approver, or enable an owner requirement and claim
coverage while this file is comments. The base branch's CODEOWNERS must be in place
before relying on it for PR review routing.

## Dependency order, activation and rollback

1. Approve this repository design and identify platform/security/reviewer owners.
2. Resolve governance bootstrap with PR #55. It supplies the validator but this
   branch supplies its CI definition. Neither authorizes merging the other.
   Separately approve how an externally registered validation run tests the exact
   PR #55 candidate and how these foundations integrate. Do not bypass protection
   or falsely require an unobserved check to hide the bootstrap dependency.
3. Review/register App access, Azure DevOps organization/project, pipeline identity,
   pool permissions and governance administrators. These are platform changes,
   not repository-only work. Inspect existing resources before proposing new ones.
4. If absent, provision approved PR-only MDP/agents, subscription/provider/quota,
   Dev Center/project, network, image and scoped service networking permissions.
   Confirm Entra-linked organization and pool-administration permissions. This is
   separately authorized cloud provisioning; the PR job receives none of that
   provisioning authority. Verify self-hosted parallel-job entitlement separately
   from pool capacity and Azure costs. Publisher federation is not a prerequisite.
5. Bind an enforced trusted template/ref, pipeline/pool permissions and fork policy;
   validate toolchain, failure paths, isolation and cancellation teardown.
6. Observe real App checks, configure active rules and independent CODEOWNERS,
   verify direct-push/bypass restrictions, then reassess the current PR revision.

Rollback requires separately authorized administrative action: disable pipeline
queueing/triggers or revoke its pool authorization and quarantine compromised
agents. Keep the required check blocking merges while diagnosing; do not remove
the check, substitute a green status or fall back to a production/hosted pool.
Restore a reviewed known-good template/toolchain through normal change control,
rerun on the current revision and obtain fresh approval. App uninstall can affect
other pipelines and requires explicit impact review. Retire newly provisioned
resources only under separate cloud authorization. No rollback command runs here.

## Validation evidence

### M1 / L1 audit corrections

The correction starts at the same HEAD with the foundation files already
uncommitted; HEAD is 0 ahead / 0 behind the local `origin/main` reference. No
remote refresh is claimed. Only the template, contract test and this record are
edited by this correction. The entry YAML, inactive CODEOWNERS and feature-index
entry are retained from the foundation.

**M1:** The template requires, in order, preflight, `npm ci --prefix server
--include=dev --ignore-scripts --no-audit --no-fund`, the unchanged
`npm run validate:frontend:iac`, and the separate
`node --test test/PrValidationPipelineContract.test.cjs`. Every script uses
`set -euo pipefail`; no custom condition or failure masking is permitted.
The parser is loaded explicitly from `server/node_modules/js-yaml`, preventing
an ancestor/global `NODE_PATH` package from concealing a missing installation.
The existing server manifest and lockfile remain the dependency source; no
dependency or lockfile changes are introduced. npm registry egress is an additional
external agent prerequisite. Lifecycle scripts are disabled for this parser-only
use of the dependency tree.

Bash is a preinstalled agent prerequisite, not an unpinned runtime download:
require GNU Bash **5.2.15(1)-release** (GNU Bash 5.2 source plus upstream patches
001 through 015) in the reviewed disposable Linux agent image. Agent activation
must record the image digest, source/package provenance and checksums; no image
is provisioned or claimed to exist here. The preflight checks the exact Bash
version, and the contract step passes its executing `$BASH` as `REQRO_TEST_BASH`,
so subprocess tests use the same executable. Missing Bash prevents the Azure
Bash task from starting; a wrong version fails preflight. This pin, like Node's,
needs separate patch review before agent activation.

**L1:** Durable subprocess tests execute the parsed YAML preflight and subsequent
scripts against temporary package/file fixtures. Tool functions supply controlled
results, and PATH is replaced with a nonexistent directory; no real Docker,
cloud executable or production connection can be invoked. The package command
check uses the real local Node executable against the synthetic package file.
Each child status gates the next script, modeling default Azure step success
conditions; the structural audit rejects condition overrides. This is local
execution evidence, not Azure DevOps scheduling or protected-template enforcement.

| Fixture                                         | Expected exit | Later steps                                       |
| ----------------------------------------------- | ------------- | ------------------------------------------------- |
| Missing Docker executable                       | 127           | None                                              |
| Docker daemon failure                           | 37            | None                                              |
| Wrong container OS                              | 1             | None                                              |
| Wrong Node or Bash version                      | 1             | None                                              |
| Missing IaC validator                           | 1             | None                                              |
| Missing or incorrect package validation command | 1             | None                                              |
| Valid prerequisites                             | 0             | Install, parser probe, IaC, PR contracts in order |
| Failed dependency installation                  | 38            | No parser probe or suites                         |
| Missing parser probe                            | 1             | No suites                                         |
| IaC failure                                     | 39            | No PR suite                                       |
| PR contract failure                             | 40            | Job fails                                         |

Additional tests verify missing Bash returns `ENOENT` and missing checkout-local
parser prevents the actual test file loading (exit 1). Existing validation exit
37/127 tests and all negative structural mutations are retained; omission and
failure masking checks now cover each required install/validation step.

### Audit correction validation results

- Initial local combined invocation: **94 passed, 0 failed, 0 skipped,
  0 cancelled**. After adding the actual missing-parser loading regression,
  final combined invocation: **95 passed, 0 failed, 0 skipped, 0 cancelled**
  (46 PR contracts, 31 private frontend contracts, 18 Nginx contracts).
  Command: `node --test test/PrValidationPipelineContract.test.cjs
test/PrivateFrontendIacContract.test.mjs test/NginxImagePin.test.mjs
test/NginxStaticServingContract.test.mjs`, with `REQRO_TEST_BASH` selecting
  Git Bash. These two runs are not summed as distinct coverage.
- Local scratch composition: exported exact PR #55 commit
  `2d4609133a0c94dc5d505424d10672c9c8a2eece` into ignored
  `.local-uat/audit-composed`, then overlaid the entry/template, contract test
  and inactive CODEOWNERS. No merge, branch modification or copied validator
  entered the feature's source changes. No F060 ACR IaC was edited.
- In that composition, the exact `npm ci --prefix server --include=dev
--ignore-scripts --no-audit --no-fund` command succeeded (297 packages).
  The unchanged `npm run validate:frontend:iac` successfully used local Docker
  29.7.2/Linux containers, the runner's pinned Azure CLI image and Bicep v0.48.1
  to lint/build eight current source files. **98 passed, 0 failed, 0 skipped,
  0 cancelled**, including the retained compilation-failure/freshness tests.
  Fresh ARM SHA-256:
  `26c27ed6bcc172cd23cf8bcaf127f45a4a0cf1cbf59325babb4e4024985777ae`.
  Post-test freshness verification succeeded. The separate PR suite then
  executed successfully: **46 passed, 0 failed, 0 skipped, 0 cancelled**.
  Overlapping local/composed runs are not summed into a repository-wide total.
- Local host Node was **v20.20.2**, using Git Bash for subprocess fixtures.
  The exact Linux agent Node/Bash selection and real Azure scheduling remain
  activation checks; the composed run proves both suites execute together,
  not that the Azure pipeline ran. Real Docker was used only for the separate
  unchanged IaC validator, never by preflight/tool fixtures.
- Formatting checks passed for both YAML files, the test and this record;
  `git diff --check` passed. Complete tracked diff and untracked foundation
  file contents were reviewed. Protected IaC/operator/runtime files and package
  manifests/lockfiles remain unchanged. Index remains empty and HEAD unchanged.
- Execution-helper startup failed inside the sandbox; local shell validation
  proceeded through approved escalated commands. An ancillary Node `-e`
  dependency-version probe hit PowerShell quoting syntax failure; it was
  followed by two unsuccessful Windows PowerShell JSON probes (empty-key and
  unsupported `AsHashtable` errors), then plain-text version inspection.
  These ancillary probe failures were not test-suite failures.

The final stop is architectural review before staging. External prerequisites
remain PR #55 integration approval, a reviewed disposable PR-only agent image
and pinned tool provenance, bounded npm/download egress, pool isolation and
permissions, trusted protected-template enforcement, App/check registration,
fork policy, required-check rules and approved independent CODEOWNERS identities.
Local YAML security tests do **not** enforce a protected template. No platform
configuration, staging, commit, push, PR, merge, provisioning or deployment occurred.

### Initial foundation evidence (historical)

The contract test parses both YAML files with `js-yaml`, already present in the
server lockfile; no dependency or lockfile is added. In a normal checkout with
server dependencies installed, run:

```sh
node --test test/PrValidationPipelineContract.test.cjs
node --test test/PrivateFrontendIacContract.test.mjs test/NginxImagePin.test.mjs test/NginxStaticServingContract.test.mjs
```

The shell propagation tests need Bash (`REQRO_TEST_BASH` may specify its executable).
Missing parser/Bash fails rather than skipping. In the initial foundation run, local
validation resolves the existing main checkout's locked server dependencies through
`NODE_PATH`; it does not modify that checkout. Tests use shell-function substitutes
for npm to execute the actual YAML command and observe exact exit codes, with no
Docker/cloud action. YAML parsing is not Azure DevOps server-side template expansion
or proof of a configured pool/check. Real CI and the integrated 98-test downstream
suite remain blocked by the dependency and external activation gates above.

Initial focused result: **28 passed, 0 failed, 0 skipped, 0 cancelled**.
Final combined invocation of the four test files above: **77 passed, 0 failed,
0 skipped, 0 cancelled** (28 new pipeline contracts, 31 existing private frontend
contracts and 18 existing Nginx contracts). The focused rerun is not added to
distinct totals. Local test runtime was Node `v20.20.2` with Git Bash; execution
on the selected Linux/Node `24.14.0` agent remains an activation check.

Prettier checks passed for both new YAML files, the contract test and this feature
record. The feature-index addition follows the existing Markdown format;
CODEOWNERS is a plain-text comment-only scaffold. `git diff --check` passed.
No Azure DevOps schema expansion, real agent execution or downstream fresh Bicep
run is claimed. All deployment Bicep, tenant-domain operator YAML/templates,
existing tests and F062 runtime files remain byte-for-byte unchanged from baseline.

## Sources checked for this foundation

- [Azure GitHub integration, PR YAML and Checks](https://learn.microsoft.com/en-us/azure/devops/pipelines/repos/github?view=azure-devops)
- [UseNode task](https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/use-node-v1?view=azure-pipelines) and [Node 24.14.0 release](https://nodejs.org/en/blog/release/v24.14.0)
- [Security templates](https://learn.microsoft.com/en-us/azure/devops/pipelines/security/templates?view=azure-devops) and [external approvals/checks](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals?view=azure-devops)
- [MDP prerequisites](https://learn.microsoft.com/en-us/azure/devops/managed-devops-pools/prerequisites?view=azure-devops), [networking](https://learn.microsoft.com/en-us/azure/devops/managed-devops-pools/configure-networking?view=azure-devops) and [parallel-job capacity](https://learn.microsoft.com/en-us/azure/devops/managed-devops-pools/troubleshooting?view=azure-devops)
- [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) and [CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)

**STOP for architectural review. No integration or activation is authorized.**
