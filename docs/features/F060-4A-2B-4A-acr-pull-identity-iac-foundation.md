# F060.4A-2B-4A — ACR + Pull Identity IaC Foundation

Status: reviewed repository-only implementation, including the audit freshness
correction; staging and one local feature-branch commit authorized. No push, PR,
merge, deployment, provisioning, permission grant, publication or activation authorized.

## Baseline and authority

Baseline main: `786b50a52c0ac7fdac6405da64373650fa0a3d17`, clean tree/index,
0/0 against origin/main; remote main verified at this SHA in the preceding assessment.
Isolated branch: `codex/f060-acr-pull-identity`, worktree
`.local-uat/f060-acr-pull-identity`. Both `04b056e` (F060 release trust, PR #53)
and `e440e5d` (F062 policy persistence, PR #54) are integrated ancestors.
The user explicitly authorized only repository implementation and local validation.
No staging, commit, push, PR, cloud operation or grant is authorized.

Follow [4-0E](F060-4A-2B-4-0E-azure-devops-private-runner-federation-contract.md),
including its explicit amendment of the earlier non-ABAC/AcrPull candidate;
[4-0A](F060-4A-2B-4-0A-acr-network-sku-identity-trust-decision.md) retains the
network and trusted-services boundaries. ADR-030 serving and existing edge/WAF/
diagnostics remain unchanged. Azure DevOps owns production CI/CD; GitHub owns
source collaboration. Private runners, Entra workload identity federation and
separate publisher/signing/deployment/application/worker identities remain required.

## Implementation contract and acceptance

- One client/environment Premium registry, ABAC mode, public/admin/anonymous
  access disabled. Deny network default, no IP allowlist, no credentials or keys.
- Dedicated nondelegated ACR endpoint subnet, distinct from ACA infrastructure,
  ACA endpoint and future CI subnets. Required CIDR, no invented address/capacity.
  Private endpoint targets registry group `registry`. Zone group owns service-
  generated login and regional data endpoint records in `privatelink.azurecr.io`;
  VNet link disables registration. No static IPs, manual A records or hosts hacks.
- Dedicated pull UAMI, one registry-scoped Repository Reader assignment with
  exact `reqro/frontend` condition, no unconditioned intermediate grant.
- ACA explicitly attaches/references that UAMI for the registry; identity lifecycle
  `None` keeps tokens unavailable to init/main container code. No system identity.
- ARM-audience registry authentication enabled for managed-identity image retrieval.
- Image input becomes a required 64-character lowercase SHA-256 digest (without
  prefix); image is assembled as the service-returned login server plus fixed
  `reqro/frontend@sha256:` plus that digest. This intentionally replaces the old
  arbitrary `frontendImageReference` input. Length decorators are not hex/provenance
  verification; release input validation and evidence remain activation gates.
  Malformed digest characters cannot become a tag or an alternate registry.
- Registry module completion precedes origin wiring (including Reader assignment,
  endpoint and DNS), but ARM ordering is not evidence of RBAC/DNS propagation.
- Keep source constant `deploymentEnabled = false`, gate every root module, retain
  disabled edge endpoint/origin/route. No enable parameter or automatic activation.

## Permission and ABAC semantics

Reader role `b93aa761-3e63-49ed-ac28-beffa264f7ac` has no control-plane actions;
its data actions are `repositories/content/read` and `repositories/metadata/read`.
The assignment scope is the declared registry, principal is the newly declared pull
UAMI service principal, condition version is `2.0`. The official conditional form
exempts actions outside these two from the condition, and requires repository-name
equality for both read actions. The role itself grants only those two actions;
the condition is a restriction, never an additional permission. Test both layers.
No prefix/wildcard matching, catalog listing, legacy AcrPull, write, delete,
artifact-lock modification, custom role, subscription/RG-wide assignment or
publisher authority. Built-in role changes require re-review before activation.

## Defender exception: actual breadth

`networkRuleBypassOptions: AzureServices` records the approved scanning-purpose
exception while public access stays Disabled. It is not a Defender-only allowlist.
Microsoft currently lists Container Instances, Defender for Cloud, Machine Learning
and ACR import scenarios. Services retain their authentication/authorization
requirements; the table specifies no customer MI/RBAC configuration for Defender.
This slice creates neither a Defender identity/grant nor a Defender plan.
No other bypass-dependent workload is authorized. ACR Tasks bypass is explicitly
disabled; no export, purge, retention period, scanner or signing policy is invented.
Entitlement, service-set review, cost ownership and digest-correlated scan evidence
remain deployment gates. If this breadth becomes unacceptable, stop for review;
never open public access as a workaround.

## Pre-code compatibility review — 2026-10-13

Checked official schemas and guidance before implementation:

- [Registry schema, stable 2025-11-01](https://learn.microsoft.com/en-us/azure/templates/microsoft.containerregistry/2025-11-01/registries): ABAC mode, anonymous/admin/public settings, trusted-services and ARM-audience policies.
- [ABAC conditions](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-abac-repository-permissions): exact repository condition across both Reader actions; legacy roles are not honored.
- [Built-in Reader role](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/containers#container-registry-repository-reader): role ID and two data actions, no catalog listing.
- [Managed identity authentication](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-authentication-managed-identity): Repository Reader for ABAC registries.
- [ACA pull](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull): UAMI and ARM-audience authentication; its legacy AcrPull examples do not override newer ABAC guidance.
- [ACA identities](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity#control-managed-identity-availability): lifecycle None retains image pull without exposing identity to container code.
- [ACA schema, stable 2025-01-01](https://learn.microsoft.com/en-us/azure/templates/microsoft.app/2025-01-01/containerapps): registry and identitySettings fields.
- [Role assignment schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.authorization/2022-04-01/roleassignments) and [UAMI schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.managedidentity/2024-11-30/userassignedidentities).
- [Private endpoints](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-private-endpoints) and [trusted-service breadth](https://learn.microsoft.com/en-us/azure/container-registry/allow-access-trusted-services).
- [Private DNS zone groups](https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns-integration): service-managed record lifecycle, including registry data endpoint records.

These support the bounded design without a broader role. Compiler and local tests
cannot prove live authorization, DNS or image pull. Azure Government compatibility
is not claimed; this is the approved commercial-cloud reference.

## Remaining activation gates

Approved names/region/nonoverlapping CIDRs, registry name availability, endpoint
capacity and network ownership; central DNS ownership/linking if a zone already
exists; actual login/data DNS resolution, TLS and public denial; positive pull
and wrong-repository/write/delete/catalog denial; identity lifecycle validation;
RBAC propagation; reviewed published digest/SBOM/scans/signature and release
approval. Registry creation precedes publication, which precedes app activation:
the root remains disabled and is not a first-deployment orchestration plan.
Do not use a public quickstart image to bootstrap this missing release sequence.

4B separately owns runners, generated federation values, publisher authority and
protected resources. No F062 runtime/policy/schema/grant changes, API/auth changes,
UI changes, dependency additions or tenant resources belong here.

## Validation evidence — 2026-10-13

Local validation uses existing official image
`mcr.microsoft.com/azure-cli:2.90.0-azurelinux3.0` and Bicep 0.48.1 in a disposable
container. Only `deploy/azure/frontend` is mounted at `/src` read-only and ignored
`.local-uat/validation` at `/out` for generated ARM. An empty local Docker client
configuration avoids host credentials. No host Azure profile or Docker socket is
mounted. No login, what-if, deployment or other Azure cloud operation runs.

Commands inside that container, chained on success:

```sh
az bicep install --version v0.48.1
az bicep version
az bicep lint --file /src/main.bicep
az bicep build --file /src/main.bicep --outfile /out/main.json
```

Lint/build: **exit 0, zero Bicep errors/warnings**. Installation emits only its
configuration notice about `bicep.use_binary_from_path=false` inside the discarded
container. No linter suppressions. Generated output remains ignored.

Historical pre-freshness-correction command (superseded by the entry point below;
direct invocation now refuses missing run evidence):

```sh
node --test test/PrivateFrontendIacContract.test.mjs test/AcrPullIdentityIac.test.mjs test/NginxImagePin.test.mjs test/NginxStaticServingContract.test.mjs
```

**79 passed / 0 failed / 0 skipped / 0 cancelled**: 31 private frontend contracts
with bounded inventory/input amendments, 30 new compiled/ABAC tests and 18 unchanged
NGINX pin/static-serving regressions. This is a focused invocation, not a full
application suite.

The first two-file invocation was **59 passed / 2 failed / 0 skipped** (61 total).
The old mutation test merely found any Disabled public-access setting; adding ACR
meant another Disabled occurrence concealed an Enabled mutation. Added an explicit
prohibition on Enabled. The diagnostics test had a global roleAssignments ban;
it now bans assignments in every module except registry and requires exactly one
there, with exact compiled role/principal/scope/condition assertions. These are
bounded authorized scope changes, not weakened runtime protections. The subsequent
four-file invocation is the 79/79 result above.

Compiled inspection verifies six disabled root modules and 23 resource declarations,
exact registry properties, one Reader/one UAMI, no default deployment inputs,
dedicated endpoint/DNS, registry-before-origin dependency, service-returned login
server, fixed repository/digest and lifecycle None. Negative mutations cover
activation, public/admin/anonymous access, legacy mode/role, Tasks bypass,
ARM audience, missing/widened conditions, metadata-read escape, broad scope,
caller-chosen principal, subnet reuse, incorrect DNS, container token exposure,
floating tag and removed dependency. The bounded interpreter evaluates the actual
compiled condition together with the documented Reader action set. It is not an
Azure authorization emulator or live denial proof.

No live Azure pull/DNS/public-denial/ABAC test, NGINX runtime container test,
database suite, application unit/E2E/React suite, application build or authenticated
UAT ran. None is reported passed. Application, database, NGINX source and accepted
UI are unchanged. Cloud behavior and published-image readiness remain unverified.
No broader grants were required by schema/compatibility review.

Final local review: Prettier check passed for both changed test files and this
record. Both local feature links resolve. Exact eight-file allocation,
control-character/credential-pattern scan and manual private-value review passed.
`git diff --check` passed; Git's LF-to-CRLF notices are checkout-normalization
warnings, not whitespace errors. The post-format four-file rerun also passed
(79 tests, dot reporter, exit 0); it is not added to the distinct test total.
Feature index changes are a single new entry, preserving historical formatting.
Index remains empty and HEAD unchanged, 0/0 against last-known origin/main.

## Files and review boundary

- `deploy/azure/frontend/modules/registry.bicep`: new bounded registry/identity/network module.
- `deploy/azure/frontend/main.bicep`: gated module, explicit registry/CIDR/digest inputs and guarded wiring.
- `deploy/azure/frontend/modules/network.bicep`: dedicated third subnet and ID output.
- `deploy/azure/frontend/modules/static-origin.bicep`: identity isolation, registry association and digest construction.
- `test/PrivateFrontendIacContract.test.mjs`: topology/input contracts and strengthened mutation rejection.
- `test/AcrPullIdentityIac.test.mjs`: source/compiled/ABAC security evidence.
- This record and the feature index: implementation contract and evidence.

The gated root is the supported foundation entry point. Individual resource modules
are not independently gated and must not be invoked as a deployment workaround.
Source gates are review controls, not a replacement for protected deployment
permissions. All files remain unstaged, with no feature commit or synchronization.

## Audit correction — compilation freshness

Only the Low-severity validation finding was authorized for correction. No Bicep,
ABAC, networking, identity, image or deployment-gate definition was changed.

The supported entry point is now:

```sh
npm run validate:frontend:iac
```

This invokes `node scripts/validate-frontend-iac.mjs`. It creates a unique empty
directory under ignored `.local-uat`, snapshots every file in the local frontend
IaC dependency/configuration tree, and computes SHA-256 fingerprints including
relative paths. Symlink sources are refused. The pinned Azure CLI/Bicep container
lints and builds the snapshot immediately before testing. Source is mounted
read-only; output is isolated; no host Azure credentials or Docker socket is
mounted. Missing Docker/tooling, unsuccessful lint/build, missing/invalid output
or edits during compilation abort validation without publishing success evidence.

Evidence binds the run ID, canonical source root, full source/snapshot fingerprints
and compiled ARM hash. The existing security suite requires that evidence through
runner-supplied context, verifies it before inspecting ARM, and has no fallback to
`.local-uat/validation/main.json`. The runner checks freshness before and after
the test process as well. Added, deleted or modified source/configuration files,
replaced/missing output and evidence from another run are refused. The exact newly
created run directory is containment-checked and removed on success or failure.
No timestamp-based freshness inference or silent skipped assertion is used.

Correction files:

- `scripts/validate-frontend-iac.mjs`: fresh compilation/evidence validation and test orchestration.
- `package.json`: one validation command; no dependency or deployment-script changes.
- `test/AcrPullIdentityIac.test.mjs`: replace cached ARM loading with the mandatory evidence loader; all existing security assertions retained.
- `test/IacCompilationFreshness.test.mjs`: 19 focused evidence lifecycle and failure regressions.
- This record: corrected execution instructions and evidence.

Validation outcomes:

- Initial freshness-only invocation: **18 passed, 1 failed, 0 skipped**. The standalone
  child-process test inherited Node's test-runner context and exited 0. Removing only
  `NODE_TEST_CONTEXT` from that child makes it exercise an independent invocation;
  the expected nonzero assertion was preserved. Corrected rerun: **19/19 passed**.
- `node scripts/validate-frontend-iac.mjs`: **exit 0**, fresh Bicep 0.48.1 lint/build
  passed with no Bicep diagnostics. The same disposable installer configuration
  notice described above is emitted. All **8 current source files** matched the
  snapshot and final source fingerprints.
- Fresh artifact SHA-256:
  `3f3682b4638a5ad058ff81684c4f9337500705585cf35a1c83c80cebed19bade`.
- Combined security/freshness/serving regressions: **98 passed, 0 failed, 0 skipped,
  0 cancelled** (79 retained tests plus 19 new tests). Standalone reruns are not
  added to this distinct total. The expected rejected child invocation is a passing
  negative regression, not a silently skipped security suite.
- Negative tests cover missing context/evidence/artifact, unsuccessful compilation
  even when output exists, unavailable tooling, stale main and dependency changes,
  new configuration, deleted dependencies, replaced artifact, wrong run ID, failed
  evidence status, source/snapshot edits during compilation, reused output directory,
  malformed output and direct contract invocation without fresh evidence.

The synthetic compiler in unit tests tests evidence handling only. Actual security
contracts in the combined run inspect real freshly compiled ARM. Evidence is a local
freshness safeguard, not a signed attestation against a malicious local process able
to rewrite code and evidence. Docker and public tool-download access are required;
unavailable tooling is an error, never permission to reuse old ARM. All prior live
Azure, release provenance and deployment limitations remain unchanged.

## Final integration preparation

The owner subsequently authorized staging exactly the approved feature files and
one local commit on `codex/f060-acr-pull-identity`, directly above baseline
`786b50a52c0ac7fdac6405da64373650fa0a3d17`. Earlier unstaged/no-commit statements
record the implementation and audit stop points, not this later authorization.
The complete allocation is 11 files: the eight implementation files plus
`package.json`, the validation runner and the freshness test file listed above.
Generated ARM, evidence, temporary snapshots, credentials and unrelated F062 work
are excluded. Deployment definitions and disabled root/edge controls are unchanged
by this preparation. Push, PR creation and integration into main require separate
authorization; cloud actions and grants remain unauthorized.

Final requested `npm run validate:frontend:iac` invocation: exit 0; fresh Bicep
lint/build passed without Bicep diagnostics; **98 passed, 0 failed, 0 skipped,
0 cancelled**. Eight source files and artifact hash matched the freshness evidence
above, with post-test verification successful. This rerun is not added to distinct
test totals. Formatting and `git diff --check` passed; only Git's existing line-
ending notices and the disposable Bicep installer's configuration notice remain.

**STOP AFTER THE LOCAL FEATURE COMMIT; REQUEST PUSH AND PR AUTHORIZATION.**
