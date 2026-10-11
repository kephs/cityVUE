# F060.4A-2B-1 — Private Static Origin & Front Door Private Link IaC Foundation

## Status and authority

Deployment-disabled source foundation; not production-ready or cloud-validated.
Baseline: `c6465c99689fe23f75c71d310e3b7443acda6c15` on authoritative fetched `origin/main`.
The previously stopped slice resumes after the integrated
[two-endpoint topology decision](F060-4A-2B-0A-private-endpoint-dns-topology-decision.md).
It preserves the [private-ingress readiness](F060-4A-2B-0-edge-private-ingress-iac-readiness.md),
[header ownership](F060-4A-2C-1B-0A-static-origin-header-ownership-decision.md),
[NGINX foundation](F060-4A-2C-1B-1-nginx-routing-spa-fallback-coop-foundation.md), and
[image validation gates](F060-4A-2C-1B-2-nginx-image-pinning-runtime-validation.md).

- NO AZURE RESOURCE WAS CREATED.
- NO AZURE LOGIN WAS PERFORMED.
- NO IMAGE WAS PUSHED.
- THE FRONTEND IMAGE PARAMETER HAS NO PRODUCTION DEFAULT.
- PUBLIC NETWORK ACCESS IS DISABLED BY CONTRACT.
- FRONT DOOR PREMIUM IS REQUIRED.
- PRIVATE LINK APPROVAL REMAINS MANUAL.
- THE MSAL BRIDGE REMAINS INACTIVE.
- NO ENTRA CONFIGURATION CHANGED.
- NO CSP OR HSTS POLICY MOVED.
- NO F061 OR F062 CHANGE OCCURRED.
- WAF POLICY BINDING IS A PRE-DEPLOYMENT BLOCKER.

## Source inventory and deployment gate

[main.bicep](../../deploy/azure/frontend/main.bicep) uses a source constant,
`deploymentEnabled = false`, for all four modules. Enabling requires a separately
reviewed source change. There is no deployment workflow, executable deployment script,
production parameter file, or deployment command. Module files are reusable resource
definitions, not independently disabled entry points; targeting them directly would
bypass the main gate and is not authorized.

| Module                                                                                 | Resource declarations                                                                     |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [network](../../deploy/azure/frontend/modules/network.bicep)                           | VNet with two inline subnets                                                              |
| [static-origin](../../deploy/azure/frontend/modules/static-origin.bicep)               | ACA managed environment and frontend Container App                                        |
| [private-connectivity](../../deploy/azure/frontend/modules/private-connectivity.bicep) | Customer PE, Private DNS zone, VNet link, PE DNS zone group                               |
| [front-door](../../deploy/azure/frontend/modules/front-door.bicep)                     | Premium profile, disabled endpoint, origin group, disabled private origin, disabled route |

There are twelve resource declarations. Main exposes only a static status output;
internal module outputs carry resource IDs and the app FQDN, not secrets.

## Network and Private Link relationships

Public traffic is intended to follow Front Door Premium → AFD-managed Private Link →
ACA managed environment → environment ingress → Reqro frontend NGINX.
The AFD origin uses the app FQDN for hostname and origin host header, HTTPS forwarding,
certificate-name verification, the managed-environment resource ID, and group
`managedEnvironments`. It never targets the customer PE's raw private IP.

Microsoft creates the AFD-managed endpoint in its regional managed network.
Its request requires an authorized operator to verify the expected profile, target
environment and request before approving, followed by connectivity validation.
The source writes no approval status and contains no generic pending-request approver.
No request was created during this work.
See Microsoft's [Front Door Private Link model](https://learn.microsoft.com/en-us/azure/frontdoor/private-link).

Separately, the customer-managed PE targets that environment with group
`managedEnvironments` in Reqro's nondelegated PE subnet. Its lifecycle uses ordinary
Reqro IaC/Azure authorization; this does not approve the separate AFD request.
Azure Private DNS `privatelink.${location}.azurecontainerapps.io` is linked to the
Reqro VNet with registration disabled and associated with the customer PE through a
DNS zone group. VNet clients resolve through that private DNS relationship.
The region input must be the actual Azure deployment region identifier.

The infrastructure subnet is delegated to `Microsoft.App/environments`; the separate
PE subnet is nondelegated. No peering, public DNS, NSG or firewall policy is added.
CIDRs have no defaults. Before deployment, validate containment, nonoverlap and
capacity against current Azure requirements; the dedicated guidance's /23
infrastructure and /24 PE examples are planning references, not assigned production
addresses. Both endpoints, including ACA dedicated private-endpoint infrastructure,
add accepted Azure costs. See Microsoft's
[custom-VNet Front Door guidance](https://learn.microsoft.com/en-us/azure/container-apps/front-door-custom-virtual-network-private-link)
and [ACA endpoint instructions](https://learn.microsoft.com/en-us/azure/container-apps/how-to-use-private-endpoint).

## ACA boundary and runtime

The workload-profile environment has fixed `internal: true` and
`publicNetworkAccess: 'Disabled'`. Neither is caller-toggleable.
The app's `external: true` exposes ingress at that internal environment boundary;
it does not authorize public Internet ingress. Direct public access to the default
ACA endpoint must fail in future authorized deployment validation.
Target port is 8080, insecure ingress is disabled, and no container port 80 or
container certificate is introduced.
See [ACA networking](https://learn.microsoft.com/en-us/azure/container-apps/networking).

Workload profile name/type/node counts and container CPU/memory are required inputs.
No SKU, node count, replica count, scale rule, probe interval or log retention is
chosen. CPU is supplied as a JSON-number string and converted using `json()`.
Future input validation must establish valid positive CPU, compatible memory,
approved profile/capacity, minimum/maximum ordering, region support and valid names.
Omitting optional scale/probe configuration does not establish an approved production
policy; platform defaults and behavior still need review.

The validated image/runtime expectations remain non-root, port 8080, no application
secrets, no privileged mode or broad capabilities, and a desired read-only filesystem.
No unsupported Docker host flags are invented as ACA properties. Verify achievable
platform controls and required writable runtime paths before deployment.

## Image and registry contract

`frontendImageReference` is required with no default. It must identify the published
Reqro frontend runtime image as
`<approved-registry>/<reqro-image>@sha256:<64 lowercase hex>`.
The upstream NGINX base alone is not the Reqro runtime.

The minimum-length decorator is not a complete digest validator. Focused source
tests check the documented shape with positive and negative examples; they do not
validate future supplied values. Actual deployment inputs require a separate
fail-closed digest and artifact verification gate.

Registry selection, pull identity/permissions, publication pipeline, complete
SBOM/vulnerability review, immutable publication and digest verification remain
blocked/unresolved. No ACR, registry credentials, managed identity, role assignment,
application secret or production GHCR pull is authorized by this foundation.

## Edge routing and header ownership

Premium is fixed; Standard is not a parameter. Endpoint, origin and route are disabled.
The route also disables default-domain association; no custom-domain association is
provided. Thus there is no usable public serving route in this foundation.

The bounded patterns cover root/index/redirect, assets, staff/admin, map-preview,
track/report/issues/dashboard. They exclude a catch-all and all API paths.
Tests include negative API matching. This is intentionally not a complete production
route or root-asset inventory. Before enabling, review all required paths and the
separate same-origin API route without allowing static NGINX to become the API backend.
No API infrastructure, API hostname, proxy or API private endpoint is introduced.

The single origin group omits optional probe timing and balancing values. Omission
is supported by the published template schema but is not proof of service acceptance;
compilation and controlled what-if/deployment validation remain required.
The route omits cache configuration, which the route schema documents as disabling
caching; no numerical cache policy is selected.
NGINX retains frontend COOP, future CSP, XFO, nosniff, Referrer-Policy, cache and MIME
ownership. No edge header rules or COOP removal are added.
Existing API CSP/HSTS remain unchanged. Future public HSTS and frontend CSP work
remain separately reviewed gates.

WAF is deliberately unbound: mode, rule version, exclusions and rules remain undecided.
An approved WAF policy and binding are required before any production public exposure.
Custom domain, public DNS, certificates and TLS ownership also remain gates.

## Verified schema references

Resource property names were checked against these Microsoft template references.
Stable API versions are explicit; compilation/provider availability must still be
verified before deployment.

| Resources           | API version and authority                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Managed environment | [2026-07-01](https://learn.microsoft.com/en-us/azure/templates/microsoft.app/2026-07-01/managedenvironments), including publicNetworkAccess |
| Container App       | [2025-01-01](https://learn.microsoft.com/en-us/azure/templates/microsoft.app/2025-01-01/containerapps)                                      |
| VNet                | [2025-01-01](https://learn.microsoft.com/en-us/azure/templates/microsoft.network/2025-01-01/virtualnetworks)                                |
| Customer PE         | [2025-01-01](https://learn.microsoft.com/en-us/azure/templates/microsoft.network/2025-01-01/privateendpoints)                               |
| PE DNS zone group   | [2025-01-01](https://learn.microsoft.com/en-us/azure/templates/microsoft.network/2025-01-01/privateendpoints/privatednszonegroups)          |
| Private DNS zone    | [2024-06-01](https://learn.microsoft.com/en-us/azure/templates/microsoft.network/2024-06-01/privatednszones)                                |
| VNet DNS link       | [2024-06-01](https://learn.microsoft.com/en-us/azure/templates/microsoft.network/2024-06-01/privatednszones/virtualnetworklinks)            |
| AFD profile         | [2025-04-15](https://learn.microsoft.com/en-us/azure/templates/microsoft.cdn/2025-04-15/profiles)                                           |
| AFD endpoint        | [2025-04-15](https://learn.microsoft.com/en-us/azure/templates/microsoft.cdn/2025-04-15/profiles/afdendpoints)                              |
| AFD origin group    | [2025-04-15](https://learn.microsoft.com/en-us/azure/templates/microsoft.cdn/2025-04-15/profiles/origingroups)                              |
| AFD origin          | [2025-04-15](https://learn.microsoft.com/en-us/azure/templates/microsoft.cdn/2025-04-15/profiles/origingroups/origins)                      |
| AFD route           | [2025-04-15](https://learn.microsoft.com/en-us/azure/templates/microsoft.cdn/2025-04-15/profiles/afdendpoints/routes)                       |

## Validation and limits

`node --test test/PrivateFrontendIacContract.test.mjs`: 19/19 passing.
The first run was 18/19 because the no-resource assertion matched the words
"resource names" in a parameter description; the declaration-aware assertion was
corrected and the full focused file rerun. No product invariant was weakened.

The tests inspect source structure and selected unsafe mutations, not compiled ARM
or cloud behavior. Local Azure CLI/Bicep tooling is unavailable; nothing was installed.
**Bicep compilation is pending**, including compiler diagnostics for conditional-module
references and provider types. No cloud what-if, deployment, login or live resource
verification ran. Existing NGINX/image files and references were not changed, so their
runtime suites were not rerun. No frontend build, database or F062 suites ran.

Changed-file formatting, documentation links/anchors/tables/headings, whitespace,
control characters, exact seven-file scope and `git diff --check` are local review
checks. They do not establish cloud readiness.

## Remaining approval gates

Before a separately authorized deployment: compile every Bicep file; validate the
actual region, subscription/resource group, names, CIDRs, capacity, CPU/memory and
image inputs; resolve registry/pull authorization and artifact security gates; approve
WAF, domain/DNS/certificates, routes/API isolation, probes/scaling, cache and header
policies; review costs and operational ownership. Run authorized what-if in a
controlled target, then separately approve deployment, verify the specific AFD
connection manually, and test private connectivity and public-origin denial.

No live deployment, bridge activation, Entra change or production readiness is
claimed. Stop for F060.4A-2B-1 infrastructure security review.
