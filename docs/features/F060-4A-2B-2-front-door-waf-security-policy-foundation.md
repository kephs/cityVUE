# F060.4A-2B-2 — Front Door WAF Policy & Security Association Foundation

## Status and authority

Deployment-disabled IaC only, based on fetched authoritative `origin/main`
`d4bb864c1fbb93d55e4deeb96ad40ad8986a3bd6`, on
`codex/f060-front-door-waf-foundation`. Starting tree/index were clean.
This slice implements the explicitly approved WAF foundation under
[ADR-030](../architecture/decisions/ADR-030-production-serving-contract.md) and
[edge readiness](F060-4A-2B-0-edge-private-ingress-iac-readiness.md), extending the
[private frontend foundation](F060-4A-2B-1-private-static-origin-front-door-iac-foundation.md).
Earlier documents' unbound-WAF statements describe their historical slice.
Policy and association are now modeled; live coverage and production readiness
are not established.

- WAF IS ENABLED IN DETECTION MODE ONLY.
- NO WAF EXCLUSION EXISTS.
- NO CUSTOM ALLOW RULE EXISTS.
- NO RATE LIMIT IS CONFIGURED.
- NO BOT MANAGER RULE SET IS CONFIGURED YET.
- PREVENTION MODE REQUIRES A SEPARATE REVIEWED CHANGE.
- WAF DIAGNOSTICS ARE A PRE-DEPLOYMENT GATE.
- NO AZURE RESOURCE WAS CREATED.
- NO AZURE LOGIN OR WHAT-IF OCCURRED.
- NO ENTRA OR MSAL CONFIGURATION CHANGED.
- NO F061 OR F062 CHANGE OCCURRED.

These statements describe source configuration, not a deployed WAF. Detection
inspects and records matches rather than blocking malicious traffic. Its enabled
state is not a bypass or Disabled state, but it is not Prevention protection.

## Resources and fixed policy

| Resource                                                    | Stable API   | Configuration                                                 |
| ----------------------------------------------------------- | ------------ | ------------------------------------------------------------- |
| `Microsoft.Network/FrontDoorWebApplicationFirewallPolicies` | `2025-11-01` | Global, Premium, Enabled, Detection, body inspection enabled  |
| `Microsoft.Cdn/profiles/securityPolicies`                   | `2025-04-15` | WebApplicationFirewall association under the existing profile |

The [new WAF module](../../deploy/azure/frontend/modules/waf.bicep) is called from
[front-door.bicep](../../deploy/azure/frontend/modules/front-door.bicep). The existing
source-disabled edge module in main gates both additions. Main and the three
private-origin/network modules are unchanged. There are fourteen resource declarations,
plus the generated module deployment wrappers. Module files remain independently
deployable definitions; targeting them directly is not authorized.

`2025-11-01` is the newest stable WAF API in the
[Microsoft template reference](https://learn.microsoft.com/en-us/azure/templates/microsoft.network/2025-11-01/frontdoorwebapplicationfirewallpolicies)
and is validated by the selected compiler. It supplies the required existing policy
properties without introducing optional features. No preview version is used.
The security-policy API matches the existing
[Front Door stable schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.cdn/2025-04-15/profiles/securitypolicies).

SKU, enabled state, mode and managed-rule baseline are literals, not caller-selectable
parameters. The sole WAF module input is its policy name. The edge derives a neutral
alphanumeric name from the approved naming prefix by removing hyphens and appending
`frontendwaf`; future deployment preflight must validate the prefix/name and uniqueness.

Managed rules contain exactly `Microsoft_DefaultRuleSet` version `2.2`. No custom
rules, rule-group overrides, exceptions, exclusions, disabled-rule overrides or
action overrides are provided. This preserves Microsoft's default rule behavior.
DRS 2.2's service-managed baseline has PL2 rules disabled by default; “no disabled
rules” here means Reqro introduces no disabling override, not that every
Microsoft-managed rule is enabled. See the
[DRS 2.2 documentation](https://learn.microsoft.com/en-us/azure/web-application-firewall/afds/waf-front-door-drs).

The schema exposes `requestBodyCheck` as Enabled/Disabled without specifying a
default in its property description. The source explicitly selects Enabled to
make the inspection contract unambiguous. It chooses no body-size limits or
rule-set action override. Detection/inspection availability still requires actual
service validation; compilation does not verify a live rule catalog or body handling.

## Endpoint association and routing

The security policy references `waf.outputs.policyId`; the WAF module outputs the
actual policy resource ID. Its single association uses `endpoint.id` and
`patternsToMatch: ['/*']`. Microsoft's
[managed-WAF quickstart](https://github.com/Azure/azure-quickstart-templates/blob/master/quickstarts/microsoft.cdn/front-door-premium-waf-managed/main.bicep)
demonstrates this default-endpoint association model. No ID or custom domain is invented.

Only the existing Azure-provided endpoint/default domain is modeled. There is one
endpoint and one WAF association; no alternate frontend endpoint is added.
Endpoint, origin and route remain Disabled; `linkToDefaultDomain` remains Disabled.
Associating WAF does not activate serving on the raw Azure hostname or authorize it
as a production tenant hostname.

The security-policy wildcard covers all paths on that associated domain. It does
not broaden origin routing. The frontend route remains exactly:

```text
/, /index.html, /redirect.html, /assets/*,
/staff, /staff/*, /admin, /admin/*,
/map-preview, /track, /report, /issues, /issues/*, /dashboard
```

Every future public Reqro custom domain must be associated with an approved WAF
security policy before activation; default-endpoint coverage does not protect
unassociated custom domains. Production routing, host admission and separate API
routing remain review gates. No API route/origin/infrastructure is added. If an API
later shares this profile/domain, its WAF coverage and tuning need separate review.

## Diagnostics and operational gates

**Before Detection is deployed for tuning**, approve a diagnostic sink and enable
Front Door access and WAF logging. Review retention, access, privacy and operational
ownership so detections can actually be investigated. No workspace, Event Hub,
Storage destination, retention period or diagnostic resource is invented here.
Detection without reviewable diagnostics is not ready for tuning or production.

The required lifecycle is Detection → diagnostics → representative traffic →
false-positive review → narrowly justified tuning → separately reviewed Prevention
commit. There is no mode toggle or automatic promotion.

Before Prevention, require:

- Representative resident/public browsing, static assets, service-request submission
  and tracking flows tested.
- Staff/MSAL authentication tested, including the redirect bridge once activated.
- False positives reviewed with WAF diagnostics available.
- Each proposed exclusion individually justified by legitimate-request evidence,
  exact attribute and managed rule/group, and the narrowest scope.
- A documented, reviewed rollback procedure and operational ownership.

The prepared `/redirect.html` remains inactive and gets no exclusion. Only actual
authenticated UAT evidence may justify later tuning; authentication is unchanged.
Bot Manager remains a future hardening candidate after bot/automation compatibility
review. Rate limiting, geo restrictions, custom block/allow rules, CAPTCHA and
JavaScript challenges are deferred; no thresholds or trusted-IP bypasses are selected.

## Preserved boundaries

ACA public access stays Disabled with internal networking, port 8080 and both
approved Private Link relationships. Regional private DNS and manual AFD connection
approval remain unchanged. WAF complements the private-origin boundary.

NGINX/header ownership is unchanged. No CSP, CSP Report-Only, HSTS or COOP edge rules
are introduced. No secrets, role assignments, registry resources, image changes,
production domains, authentication changes or deployment workflows are included.
Registry/published digest, SBOM/vulnerability review, domain/TLS, capacity, routing,
header and controlled deployment-validation gates remain open.

## Validation

The focused [IaC contract suite](../../test/PrivateFrontendIacContract.test.mjs)
retains the nineteen prior tests, updating the authorized WAF absence/resource
inventory assertions, and adds six WAF tests: 25 total. The initial run was 24/25:
the old mutation assertion accepted a Standard substitution when another Premium
literal remained. It now rejects any Standard SKU; no boundary was relaxed.

Use the disposable official `mcr.microsoft.com/azure-cli:2.90.0-azurelinux3.0`
container, Azure CLI 2.90.0 and Bicep 0.48.1. Only the Bicep directory is mounted,
read-only; no host Azure/SSH/Docker credentials or subscription configuration are
mounted. Bicep installation and generated ARM stay inside the disposable container.
The install notice sets `bicep.use_binary_from_path=false` only there; no diagnostics
are suppressed and no host tooling is installed.

Root lint/build passed with zero errors and zero warnings; all 25 contract tests
passed after the mutation-check correction. Compiled inspection passed and checked
the exact policy and association, all fourteen resource declarations, stable APIs,
guarded disabled module references, original private networking and bounded routes.
Local checks also cover formatting, documentation links/tables/headings,
whitespace/control characters, exact file scope and `git diff --check`.

No cloud validation, login, what-if, deployment, image push, frontend build, F062
or database suite is run. Source and compiler evidence does not prove deployed
WAF behavior. Stop for F060.4A-2B-2 WAF security review.
