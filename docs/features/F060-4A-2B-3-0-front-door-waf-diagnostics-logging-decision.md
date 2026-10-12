# F060.4A-2B-3-0 — Front Door/WAF Diagnostics & Logging Ownership Decision

## Decision and scope

**Outcome B: recommend a new platform-owned Log Analytics workspace as the primary
Front Door/WAF diagnostic sink, isolated by deployment/client and environment.**
This is the smallest proposed architecture that supports interactive WAF tuning
without requiring another SIEM. Archive/export is optional future work, not a
prerequisite selected here. Acceptance of this record does not authorize provisioning.

- NO AZURE RESOURCE WAS CREATED.
- NO DIAGNOSTIC SETTING WAS DEPLOYED.
- NO RETENTION VALUE WAS SELECTED.
- NO WAF MODE CHANGED.
- NO WAF EXCLUSION WAS ADDED.
- NO AZURE LOGIN OR WHAT-IF OCCURRED.
- NO F061 OR F062 CHANGE OCCURRED.

Detection deployment remains blocked on approved privacy safeguards, retention,
restricted access and working diagnostics. Choosing a sink does not approve raw
request-data capture.

## Baseline and repository evidence

Fetched authoritative `origin/main`:
`55894b3077c53d16bded92607c6dc9c87542d430`.
Created `codex/f060-waf-diagnostics-readiness` at that HEAD with a clean tree/index,
initially zero ahead/behind. The fetched state includes the WAF foundation and newer
integrated work; none of that work is edited. Fetch emitted the existing unrelated
Claude worktree-metadata cleanup warning; no repair was attempted.

Inspected the [private frontend foundation](F060-4A-2B-1-private-static-origin-front-door-iac-foundation.md),
[WAF foundation](F060-4A-2B-2-front-door-waf-security-policy-foundation.md),
[ADR-030](../architecture/decisions/ADR-030-production-serving-contract.md),
[edge readiness](F060-4A-2B-0-edge-private-ingress-iac-readiness.md) and their actual
[main](../../deploy/azure/frontend/main.bicep),
[edge](../../deploy/azure/frontend/modules/front-door.bicep) and
[WAF](../../deploy/azure/frontend/modules/waf.bicep) definitions.
Front Door uses `Microsoft.Cdn/profiles@2025-04-15`; WAF uses stable
`2025-11-01`, Premium, Enabled/Detection, DRS 2.2 and request-body inspection.
Main is source-disabled; endpoint/origin/route are disabled.

Tracked repository searches and deploy inventory found no implemented Log Analytics
workspace, Application Insights resource, Azure Storage diagnostic sink, Event Hub
or diagnostic setting suitable for reuse. This is repository evidence, not an Azure
resource inventory; no subscription was inspected. There is no approved
organization-wide edge logging/SIEM standard in the inspected authority.

[ADR-029](../architecture/decisions/ADR-029-production-operator-platform.md) discusses
searchable logs and separately administered immutable operator audit storage, but
does not establish an existing sink. Its operator-audit retention reference is not
authority for edge-log retention. The
[application export assessment](F061-2C-0-telemetry-export-monitoring-readiness.md)
identifies a prospective application telemetry backend, not a provisioned workspace.
Neither justifies automatic resource reuse.

The [security framework](../security/SECURITY_FRAMEWORK.md) and
[requester privacy authority](../architecture/decisions/ADR-005-requester-contact-privacy.md)
apply. Existing application log sanitation deliberately omits raw URLs, queries,
bodies and most headers; it does not sanitize independently generated edge logs.
No application privacy policy is amended or relaxed by this decision.

## Diagnostic categories

Use explicit category names for the Premium profile, not Classic spelling or a broad
category group that could expand capture silently. Microsoft's
[Microsoft.Cdn/profiles category inventory](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-logs/microsoft-cdn-profiles-logs)
lists the following categories. Categories are service diagnostic capabilities, not
fields guaranteed merely by pinning the profile API. Reverify availability for the
actual resource during separately authorized pre-deployment work.

| Signal                 | Exact category or metric                                                                                  | Decision                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| WAF matches            | `FrontDoorWebApplicationFirewallLog`                                                                      | REQUIRED FOR WAF TUNING: managed-rule matches, action, policy/mode and investigation evidence       |
| Request access         | `FrontDoorAccessLog`                                                                                      | REQUIRED FOR WAF TUNING: request outcomes and correlation with WAF matches, subject to privacy gate |
| Origin probes          | `FrontDoorHealthProbeLog`                                                                                 | OPTIONAL OPERATIONS SIGNAL: investigate private-origin/probe failures; not part of minimum capture  |
| Platform metrics       | Examples: `WebApplicationFirewallRequestCount`, `RequestCount`, `OriginHealthPercentage`, `OriginLatency` | OPTIONAL OPERATIONS SIGNAL; metrics export into the sink is NOT REQUIRED FOR THIS GATE              |
| Other CDN category     | `AzureCdnAccessLog`                                                                                       | NOT REQUIRED FOR THIS GATE; not the chosen Front Door access category                               |
| Control-plane activity | Azure Activity Log                                                                                        | Separate configuration-change evidence; not a replacement for WAF/access records                    |

Metrics are distinct from log categories and cannot substitute for per-request
rule-match investigation. The [Front Door metric reference](https://learn.microsoft.com/en-us/azure/frontdoor/monitor-front-door-reference)
documents the examples above. This record does not select a metric-export category,
alert threshold or metric retention. Optional signals require separate capture,
privacy and cost review.

For the selected categories, Microsoft currently lists `AzureDiagnostics` as the
table and no ingestion-time transformation support. Do not assume a dedicated table
or workspace transformation can remove sensitive fields before storage.
The exact later ingestion/table configuration must be verified, not guessed.

## Sink analysis

The comparison below is architectural evaluation, not a selected service tier,
cost estimate or organizational records policy.

| Option                            | Queryability and tuning                                                                   | Retention/access ownership                                                                                           | Cost and archive implications                                                               | Downstream dependency                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Log Analytics                     | Direct operational queries and correlation; best fit for rule-hit/false-positive review   | Platform controls configuration; designated security/operations readers; approved workspace/table retention required | Ingestion, retention, queries and exports drive cost; not assumed to be immutable archive   | No separate SIEM needed for this tuning gate                                         |
| Azure Storage                     | Preserves objects but needs an additional analysis workflow for interactive investigation | Separate object access, lifecycle and any immutability/hold controls need approval                                   | Storage, transactions, retrieval and lifecycle costs; candidate for later long-term archive | Query tooling/consumer needed; SIEM optional                                         |
| Event Hub                         | Transport to consumers, not a sufficient investigation interface alone                    | Stream access and downstream store/readers require separate ownership                                                | Throughput, processing and downstream storage costs; not the archival system of record      | A managed consumer and searchable destination required; possibly an established SIEM |
| Log Analytics plus archive/export | Adds independent archival or external analysis capability                                 | Every copy needs its own access, retention, deletion and residency review                                            | Duplicate capture/export and operational complexity                                         | Justified only by a real records or organizational integration requirement           |

Recommend Log Analytics alone initially. Do not inherit the operator audit sink,
application telemetry workspace, or an unrelated client's workspace. Before reuse
of any later-discovered resource, prove ownership, environment scope, residency,
client neutrality, data separation, access and retention compatibility. No existing
sink is approved for reuse by this assessment.

## Access ownership and tenant separation

These are conceptual responsibilities, not Azure role names, identities or grants.
Separate policy approval from execution; least-privilege Azure role mapping and
effective inherited permissions require a later reviewed access contract.

| Principal                              | WAF/access log READ and QUERY                                                       | Diagnostic settings                                | Retention settings                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| Reqro application runtime              | NO ACCESS                                                                           | NO ACCESS                                          | NO ACCESS                                                                  |
| Tenant/product administrator           | NO ACCESS by product role                                                           | NO ACCESS                                          | NO ACCESS                                                                  |
| Future worker identity                 | NO ACCESS                                                                           | NO ACCESS                                          | NO ACCESS                                                                  |
| Designated security/operations analyst | Restricted READ/QUERY for assigned deployment/environment                           | Read approved configuration; no ordinary CONFIGURE | Read approved policy; no ordinary CONFIGURE                                |
| Authorized platform operator           | Only separately approved investigation access; not implicit from configuration duty | CONFIGURE through reviewed infrastructure change   | Apply approved policy through reviewed change, not choose it independently |
| Security/privacy/records policy owners | Minimum evidence needed for review; no blanket data access                          | Approve capture/access boundaries                  | Approve retention, residency, holds and deletion with operations           |

Edge diagnostics are platform operational telemetry, not tenant-facing product data.
Use deployment/client and environment separation for the baseline workspace decision.
Do not rely on hostname filters, saved queries, dashboards or tenant IDs inside log
rows as authorization. A pooled cross-client workspace is not approved here.
Cross-client incident access requires separate authorization. Product administrators
must not gain infrastructure log access through application permissions.

Record who approved and executed changes. Restrict exports, downloads and incident
attachments as well as queries. No read/query/configure RBAC assignments are created.

## Sensitive-data findings and capture gate

The [Front Door log field reference](https://learn.microsoft.com/en-us/azure/frontdoor/monitor-front-door)
documents full request URIs including query strings, client/socket IP, user agent,
referrer, route/outcome metadata and tracking references. These can reveal resident
or staff identity, tracking identifiers, requested services and authentication paths.
Client-derived fields are untrusted evidence, never identity or tenant authority.

The [WAF category field reference](https://learn.microsoft.com/en-us/azure/web-application-firewall/afds/waf-front-door-monitor)
documents match-variable names and values, URI and rule details. Match values can
contain sensitive header, query or body fragments. Body inspection is not permission
to retain bodies. No full request-body capture, authorization header, cookie, code,
token or credential logging is approved; even partial matching text can leak them.

Login redirects, callbacks, future staff routes and `/redirect.html` require explicit
privacy validation. Do not assume the selected MSAL flow never carries query data;
do not copy codes/tokens into tests, tickets or this document. The bridge remains
inactive. No auth configuration changes are proposed.

Before any real traffic capture:

1. Approve a field-level inventory and minimum diagnostic projection, including
   URI/query, referrer, IP, header-related match details and body fragments.
2. Verify supported source-side sanitation/redaction and its coverage separately
   for WAF and access logs. Current WAF IaC establishes no reviewed scrubbing policy.
   Do not assume WAF scrubbing sanitizes access logs.
3. Prove with synthetic, non-secret sentinels that auth-like query/header/body
   values cannot reach persisted logs, exports or diagnostic side channels.
4. Retain only approved rule identifiers, action/outcome, time, deployment scope
   and bounded correlation evidence necessary for tuning; privacy owners must
   approve any additional identifying fields.
5. If the required categories cannot satisfy the privacy policy, keep deployment
   blocked and return for a narrowly scoped capture decision. Do not weaken WAF
   inspection, add exclusions, or rely on post-query masking to solve leakage.

Choosing both categories is a tuning requirement, not blanket permission to ingest
their default contents. Broad access restrictions alone do not resolve prohibited
secret capture. No new sanitizer or log pipeline is implemented here.

## Retention and cost

**SECURITY / RECORDS / OPERATIONS POLICY INPUT REQUIRED.**
No edge retention duration is approved or selected. Operations proposes investigation
needs; security/privacy and records/legal approve retention, residency, holds,
deletion and export-copy treatment, with the deployment/client owner as applicable.
Platform operators implement that policy. No operator-audit reference or service
default is adopted as edge policy. Missing approval blocks deployment.

Review ingestion volume, request/match multiplicity, retention, query frequency,
archive retrieval and each additional sink/export. No volumes, budgets, prices,
retention numbers or service tier are chosen. Cost pressure cannot authorize
unreviewed capture, privacy relaxation or silent gaps in tuning evidence.

## Diagnostic completeness and Prevention gates

Before a controlled Detection tuning rollout, require approved sink/resource scope,
effective restricted readers/configurators, retention and privacy controls, explicit
WAF/access categories and named operations ownership. Establish evidence collection
before admitting representative traffic. In that separately authorized rollout,
synthetic probes must prove logs arrive, UTC timestamps and tracking references are
usable, authorized staff can query, unauthorized identities cannot, and loss/delay
is detectable. Arrival cannot be proven by documentation or pre-deployment compilation;
failure of this post-provisioning check blocks real traffic/tuning and promotion.

Before Detection → Prevention, record representative resident browsing, submission,
tracking, staff/MSAL login, static assets, the bridge once active and approved
automation/integration compatibility evidence. Correlate outcomes with managed-rule
hits; distinguish malicious requests from legitimate false positives. No match or
low traffic is not proof of compatibility. Document observation coverage, gaps,
reviewers, diagnostics availability and a tested rollback plan. Promotion requires
a separate reviewed commit, never a deployment parameter or automatic transition.

Every future exclusion proposal must record rule ID/group/version, affected Reqro
route/behavior, sanitized legitimate-request characteristic, false-positive reasoning,
narrowest attribute/scope, security impact, alternatives, validation and reviewer/
approval reference. Do not retain raw sensitive request samples as evidence.
No exclusions are added; a match alone does not justify disabling a rule.

Diagnostics collection is separate from alerting. Future candidates include missing
logs, diagnostic configuration drift, unusual detected/blocked traffic, repeated
attack patterns and origin-health degradation. Baselines, thresholds, responders
and escalation belong to a later operations slice; no alerts are configured here.

## Application observability boundary

F061 remains application/integration observability. This decision concerns Azure
edge diagnostics only; no F061 code, vocabulary, exporter or backend choice changes.
Azure tracking references can connect access and WAF records alongside timestamps
and deployment identity. A later approved application correlation design may help,
but there is no assumption they equal Reqro request IDs or authorization claims.
Do not add raw URLs, IPs or edge match payloads to application logs to facilitate joins.
Edge telemetry is not authoritative business/security audit and cannot grant
organization access.

## Later IaC ownership and next slice

Recommend **F060.4A-2B-3A — Front Door/WAF Diagnostic Settings IaC Foundation**,
after acceptance and separate authorization. Prefer a dedicated diagnostics module
rather than growing `front-door.bicep`: the edge supplies its profile resource
reference, and the module owns the diagnostic setting and approved sink reference
or separately bounded sink resource. Keep the source deployment gate intact.

Its contract should cover explicit WAF/access categories, optional probes/metrics
only if separately approved, workspace isolation, required retention inputs with no
invented defaults, and access-policy inputs. Exact resource API/table/access-mode
choices and privacy mechanisms need verification during that slice. Do not invent
principal IDs, roles, retention or diagnostic destinations. Local Bicep lint/build
and source/compiled contracts should verify these boundaries without deployment.

That future source foundation may remain disabled while policy inputs are unresolved;
it cannot activate capture until the privacy, retention, access and completeness gates
above pass. No diagnostics IaC begins here.

## Validation and limits

Exactly this document is allocated. Validate local links, heading uniqueness,
tables, section references, whitespace/control characters, Markdown formatting,
single-file scope and `git diff --check`. External category references were inspected
from current Microsoft documentation; no subscription category query ran.
No build, unit, database or Bicep execution is needed or claimed for this document.
No push, deployment, resource creation or infrastructure/code change is authorized
by this work. Stop for diagnostics architecture review.
