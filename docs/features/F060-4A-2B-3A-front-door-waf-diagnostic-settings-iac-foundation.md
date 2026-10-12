# F060.4A-2B-3A — Front Door/WAF Diagnostic Settings IaC Foundation

## Status and authority

Deployment-disabled source foundation, not deployment-ready. Baseline is fetched
authoritative `origin/main`, `4f6a698371dd2b58df47e1f730fa82e7c48dd156`.
Branch `codex/f060-waf-diagnostics-iac` began with clean tree/index and zero
ahead/behind. The existing Claude worktree-metadata cleanup warning was not repaired.

Authority is the approved [diagnostics ownership decision](F060-4A-2B-3-0-front-door-waf-diagnostics-logging-decision.md),
[WAF foundation](F060-4A-2B-2-front-door-waf-security-policy-foundation.md) and
[private frontend foundation](F060-4A-2B-1-private-static-origin-front-door-iac-foundation.md).
Repository inspection found no existing workspace/diagnostic setting or approved
Monitor private-network architecture satisfying this requirement. No Azure inventory
was queried.

- NO RETENTION DURATION WAS SELECTED.
- NO LOG ANALYTICS SKU WAS SELECTED WITHOUT AUTHORITY.
- NO AZURE RESOURCE WAS CREATED.
- NO AZURE LOGIN OR WHAT-IF OCCURRED.
- NO WAF MODE CHANGED.
- NO WAF EXCLUSION OR CUSTOM RULE WAS ADDED.
- NO RBAC ROLE ASSIGNMENT WAS ADDED.
- NO STORAGE OR EVENT HUB SINK WAS ADDED.
- NO ENTRA/MSAL CONFIGURATION CHANGED.
- NO F061 OR F062 CHANGE OCCURRED.

## Resource graph and API decision

[main.bicep](../../deploy/azure/frontend/main.bicep) adds a fifth module under the
existing constant false deployment gate. The
[diagnostics module](../../deploy/azure/frontend/modules/diagnostics.bicep) creates
one platform-owned workspace and outputs only its resource ID. Main passes that
conditional output safely to the [edge module](../../deploy/azure/frontend/modules/front-door.bicep),
which scopes the diagnostic setting directly to its existing `profile` symbol.
Bicep infers workspace-before-edge and profile-before-setting ordering from these
references; no manual dependency or circular module relationship is introduced.

| Resource                                   | Exact API                           | Reason                                                                               |
| ------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------ |
| `Microsoft.OperationalInsights/workspaces` | `2026-03-01`                        | Current stable schema supports required SKU, retention and network fields            |
| `Microsoft.Insights/diagnosticSettings`    | `2016-09-01`                        | Documented stable singleton schema supports all required fields and compiles cleanly |
| Existing source profile                    | `Microsoft.Cdn/profiles@2025-04-15` | Unchanged Front Door Premium profile                                                 |

**No preview exception is used.** The
[current diagnostic-settings reference](https://learn.microsoft.com/en-us/azure/templates/microsoft.insights/diagnosticsettings)
lists both modern preview APIs and older stable APIs. The
[stable 2016-09-01 schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.insights/2016-09-01/diagnosticsettings)
supports profile extension scope, workspaceId, explicit log categories and enabled
flags. It requires the singleton name `service` and location; this source uses
`global` to match Front Door. Per-category retention is optional and omitted.
This avoids claiming that no stable API exists. No modern named-setting,
category-group or dedicated-table feature is required here.

The contract pins both versions and rejects preview versions. The compiler normalizes
the diagnostic namespace to lowercase in generated ARM; Azure resource-type casing
is not an additional resource. Compiler/schema success is not live provider acceptance:
verify legacy singleton compatibility with the actual Front Door profile during
separately authorized pre-deployment validation. Do not silently upgrade to preview
or suppress a provider error; return for review if that compatibility fails.

The [workspace schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.operationalinsights/2026-03-01/workspaces)
is stable. No optional identity, export, replication, capping or collection feature
is added.

## Workspace input contract

One workspace belongs to one client deployment/environment. Its name is derived as
`<namingPrefix>-frontend-logs`; the approved deployment prefix and resource scope
must uniquely identify that boundary. Naming alone is not access isolation. Region
comes from the existing required `location` parameter.

| Input                         | Contract                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `logAnalyticsSku`             | Required string, no default or selected tier                                        |
| `logRetentionInDays`          | Required integer, no default or selected duration                                   |
| `logQueryPublicNetworkAccess` | Required Enabled/Disabled choice, no default; requires security/operations approval |

Inputs are required at main and workspace-module boundaries. No production parameter
file is committed. Missing values fail parameter validation rather than selecting a
conventional production value, even though resource creation remains source-disabled.
The generic SKU string does not approve all service tiers: preflight must validate
supported SKU/retention combinations, service bounds and any additional capacity
requirements. If a chosen tier requires further settings, review that extension
before deployment. No capacity or retention numbers are fabricated.

Retention belongs to the approved workspace/table policy, not category-level
`retentionPolicy.days`. Review actual table inheritance/overrides against approved
policy after provisioning; this foundation does not guarantee retention compliance
solely from a parameter's presence.

## Categories and destination

Microsoft's [profile category inventory](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-logs/microsoft-cdn-profiles-logs)
confirms these categories on `Microsoft.Cdn/profiles`, mapping them to
`AzureDiagnostics`:

| Category                             | Source selection                                      |
| ------------------------------------ | ----------------------------------------------------- |
| `FrontDoorWebApplicationFirewallLog` | Enabled; rule matches and false-positive review       |
| `FrontDoorAccessLog`                 | Enabled; request correlation and route/status context |
| `FrontDoorHealthProbeLog`            | Omitted, not enabled                                  |

There is one setting scoped to the profile, not its endpoint, WAF policy, ACA or
NGINX. It targets only the newly created workspace. No `allLogs`, category group,
metrics, Storage, Event Hub or partner destination is configured.
`logAnalyticsDestinationType` is omitted: no Dedicated table claim is made.
No diagnostic-setting retention object is necessary in the selected schema.
No alerts, DCR, transformation, custom table, data export or SIEM integration is added.

## Network and access gates

Workspace `publicNetworkAccessForIngestion` is fixed to Disabled.
Microsoft's [Monitor network-access guidance](https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/private-link-design#control-network-access-to-ampls-resources)
explicitly states that diagnostic-setting logs/metrics use a secure private Microsoft
channel and are exempt from these network controls. This supports the intended
Front Door delivery path without an agent, workspace keys or an invented AMPLS.
Actual delivery must still be proven later.

Query network access is a required approved input, not an implicit default:

- Enabled permits authenticated/authorized queries over public network endpoints;
  it does not mean anonymous access. That network exposure needs explicit approval.
- Disabled restricts public querying and requires a separately approved, functioning
  private query path. None is created here; selecting it alone does not establish
  queryability for Security/Operations.

No AMPLS, Monitor endpoint, private DNS or DCE is added. Until the query posture and
usable reader path are approved, deployment remains blocked. No source switch is
enabled by supplying an input.

RBAC remains unimplemented: designated Security/Operations need scoped READ/QUERY;
separately authorized platform operators configure settings. Application runtime,
integration workers and tenant administrators must have no direct log access.
No principal/object-ID parameters, role assignments, broad Contributor grant,
shared keys, `listKeys` call or secret output is introduced.

Review inherited subscription/resource-group/workspace permissions, workspace
access-control mode, resource-context query rights and local-auth defaults before
deployment. Omitted access features do not establish least privilege. The future
access implementation must prove unauthorized query/configuration denial; no
assumption is made that the absence of new grants removes inherited access.

## Privacy and preserved boundaries

Diagnostic settings select categories, not a field-level privacy projection.
Front Door/WAF records can include path/query, address, host, status, route metadata,
rule identifiers/messages and matched attributes; WAF match fragments can contain
body or header data even without full body logging. No request-body collection is
authorized here. No source-side scrubber or transformation is implemented.

Before real capture, validate actual emitted schema and safeguards with synthetic
non-secret sentinels for resident data, tracking URLs, staff login/callback queries,
`/redirect.html`, codes and token-like values. Do not use real credentials as test
data. If unacceptable values can persist, live deployment remains blocked until
the data flow is redesigned or adequately mitigated. Query-time masking and
restricted readers do not cure prohibited ingestion. Auth-related query validation
is a production gate; no Entra/MSAL or application logging changes occur.

WAF remains Enabled/Detection with DRS 2.2 and unchanged body inspection. No
Prevention, exclusions, custom rules, Bot Manager or rate limits are added.
All existing route patterns, endpoint settings, WAF association, origin group,
Private Link and ACA/private DNS topology remain unchanged. CSP/HSTS/COOP/framing
ownership is unchanged. No frontend, NGINX, image, dependency or pipeline changes occur.

## Validation

The unchanged baseline passed root Bicep lint/build and compiled invariant checks
before editing. Validation uses disposable official
`mcr.microsoft.com/azure-cli:2.90.0-azurelinux3.0`, Azure CLI 2.90.0 and Bicep
0.48.1. Only the Bicep source directory is mounted read-only; no host credentials,
subscription configuration or host tool installation is involved. Generated ARM
and installed Bicep exist only inside the removed container.

The feature lint/build pass with zero errors/warnings. The installer emits its
configuration notice for `bicep.use_binary_from_path=false` within the container;
no linter settings or diagnostics are suppressed. The initial compiled inspection
failed on a case-sensitive namespace lookup after successful compilation; the
inspector was corrected for Azure resource-type normalization.

The source suite retains the prior 25 tests with approved scope/inventory updates
and adds six diagnostics tests: 31 total. The first run was 30/31 because the old
blanket prohibition on SKU parameters also rejected the newly authorized workspace
SKU input. It now preserves fixed edge/WAF SKUs while allowing workspace policy
input. The corrected full suite passes 31/31.

Compiled inspection checks the sixteen resource declarations, required inputs
without defaults, disabled provisioning, guarded workspace reference, exact
profile-scoped categories and single sink, stable APIs and original WAF/private
topology. Source tests also exercise unsafe category/scope/destination mutations.
Formatting, documentation links/headings/tables, whitespace/control characters,
exact file scope and staged `git diff --check` complete local validation.

No login, what-if, cloud deployment, live query/ingestion, database/F062 suite or
frontend build is run. Compiler success does not prove delivery, field privacy,
access control, retention enforcement or query availability.

## Deployment gate and future acceptance

Deployment remains unauthorized until retention, SKU, query-network posture,
RBAC/inherited access, privacy/schema safeguards and controlled Detection rollout
are separately approved. Source remains disabled; module files are resource
definitions and must not be deployed individually to bypass that gate.

Future controlled validation, not performed here:

1. Provision the approved workspace/diagnostics and source under separate authority,
   with policy inputs and restricted access reviewed first.
2. Generate known benign synthetic traffic and, only if authorized, a safe
   WAF-detectable synthetic request.
3. Confirm both WAF/access categories arrive; correlate timestamps and supported
   tracking references. Absence of WAF events without a matching request proves nothing.
4. Verify designated readers can query and unauthorized runtime/worker/tenant-admin
   identities cannot query or configure, including inherited-access paths.
5. Inspect persisted schema and exports for sensitive sentinels; prove auth/tracking
   privacy and approved retention behavior.
6. If any check fails, block real traffic and tuning rather than accepting partial
   evidence. Logs becoming queryable is post-provisioning evidence, not a claim
   this source-only slice can make.

Prevention still requires representative authenticated UAT, false-positive analysis,
narrowly justified tuning, rollback evidence and a separate reviewed change.
Stop for F060.4A-2B-3A diagnostics infrastructure review.
