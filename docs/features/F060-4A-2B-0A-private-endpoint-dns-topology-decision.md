# F060.4A-2B-0A — Private Endpoint & DNS Topology Decision

Status: explicitly authorized documentation-only architecture decision, recorded on 2026-10-11 for final architecture review. F060.4A-2B-1 remains stopped until review.

**REQRO USES BOTH FRONT DOOR-MANAGED PRIVATE LINK AND A CUSTOMER-MANAGED ACA PRIVATE ENDPOINT WITH AZURE PRIVATE DNS.**

**ACA PUBLIC NETWORK ACCESS REMAINS DISABLED; THE ENVIRONMENT VIP IS INTERNAL.**

**FRONT DOOR CONNECTION APPROVAL REMAINS MANUAL.**

**NO BICEP, AZURE RESOURCE, LOGIN, PUBLIC DNS OR DEPLOYMENT IS CREATED OR PERFORMED BY THIS SLICE.**

## 1. Baseline and decision authority

Authoritative freshly fetched origin/main and starting HEAD: **afb9704da95d89a691fba00fed6090db88c5f32b**. The isolated documentation branch is codex/f060-private-endpoint-dns-decision; starting tree/index were clean with 0 ahead / 0 behind. Fetch succeeded with the previously observed unrelated stale-worktree cleanup permission warning; no repair was attempted.

This explicit decision resolves the topology blocker found during F060.4A-2B-1 inspection. It supplements [ADR-030](../architecture/decisions/ADR-030-production-serving-contract.md), [F060.4A-2B-0 readiness](F060-4A-2B-0-edge-private-ingress-iac-readiness.md) and the [static-origin ownership decision](F060-4A-2C-1B-0A-static-origin-header-ownership-decision.md). The earlier readiness document allowed a customer-VNet endpoint only for an explicitly approved need: this dated decision supplies that approval for Reqro's selected custom-VNet topology. Earlier documents remain historical evidence and are not edited here.

The selected design follows Microsoft's [custom-VNet Container Apps and Front Door guidance](https://learn.microsoft.com/en-us/azure/container-apps/front-door-custom-virtual-network-private-link). It is Reqro's approved topology, not a claim that every Azure Front Door deployment requires a customer-managed endpoint. No deployment evidence is asserted.

The stopped codex/f060-private-static-origin-iac branch is untouched. This slice creates only this document and does not resume its implementation.

## 2. Two separate Private Link relationships

| Relationship                                      | Endpoint location and owner                                                                                          | Target and responsibility                                                                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Front Door Premium-managed Private Link           | Microsoft-managed regional private network; endpoint created by Azure Front Door                                     | Front Door origin targets Microsoft.App/managedEnvironments with target subresource managedEnvironments; carries the public entry path after manual connection approval |
| Customer-managed ACA environment private endpoint | Dedicated nondelegated subnet inside the Reqro VNet; lifecycle owned by Reqro IaC under ordinary Azure authorization | Separate private endpoint to the ACA managed environment, integrated with Azure Private DNS for private/VNet resolution                                                 |

The customer-managed endpoint does not replace Front Door's managed endpoint and does not expose the environment publicly. Do not point Front Door at the customer endpoint's raw private IP.

Microsoft's [Front Door Private Link documentation](https://learn.microsoft.com/en-us/azure/frontdoor/private-link) describes the managed regional endpoint and pending approval relationship. The [ACA private-endpoint and DNS guidance](https://learn.microsoft.com/en-us/azure/container-apps/private-endpoints-with-dns) describes customer private-network access and regional Private DNS. Their resource relationships must remain distinct in the later IaC.

The exact customer-private-endpoint resource schema/group identifier must be verified during implementation. Do not mechanically copy Front Door's subresource spelling into a different resource contract without checking its authoritative schema.

## 3. Network and ingress contract

The ACA environment remains a workload-profile environment using a custom VNet, an internal VIP and public network access explicitly Disabled. No public fallback is approved.

| Subnet                               | Delegation                      | Purpose                                           |
| ------------------------------------ | ------------------------------- | ------------------------------------------------- |
| Container Apps infrastructure subnet | Microsoft.App/environments      | ACA workload-profile infrastructure               |
| Private endpoint subnet              | None; separate and nondelegated | Customer-managed ACA environment private endpoint |

CIDR ranges remain deployment parameters. This decision supplies no production addresses, region, subnet sizes or resource names. Future implementation must verify Azure sizing and nonoverlap requirements without inventing address space.

The frontend Container App retains external ingress at the ACA environment boundary and targetPort 8080. In this internal/private environment, that setting does not authorize public internet access. The ACA default endpoint must fail direct public access; this is a future verification requirement, not a test performed here. No API origin, API ingress or API infrastructure change is authorized.

## 4. Private DNS model

The customer-managed endpoint uses Azure Private DNS with the zone:

```text
privatelink.{region}.azurecontainerapps.io
```

Construct the zone using the actual approved deployment region; the placeholder is not a deployment value. Link the zone to the Reqro VNet as required by Azure's ACA private-endpoint model. Endpoint records and zone association must correspond to the customer-managed ACA endpoint rather than an invented address.

This DNS relationship serves the private/VNet path. It must not be mistaken for ownership of Front Door's Microsoft-managed network or endpoint DNS. No public DNS record, production custom domain or certificate is selected or created here.

## 5. Traffic responsibilities

Public user traffic:

```text
Public user
  -> Front Door Premium / WAF
  -> AFD-managed Private Link
  -> ACA managed environment
  -> ACA ingress
  -> Reqro frontend Container App / NGINX :8080
```

Private/VNet resolution and access:

```text
Reqro VNet client
  -> Azure Private DNS resolution
  -> customer-managed ACA private endpoint
  -> ACA managed environment
```

The second diagram describes name resolution followed by private access; DNS is not an HTTP proxy. Front Door remains the public entry point. Neither relationship grants application authority, changes API routing or bypasses existing admission requirements. No new VNet peering or other private access path is approved by this decision.

## 6. Approval and lifecycle boundaries

Front Door's managed endpoint produces a pending connection request at the ACA environment. An authorized operator must review the actual requesting resource, target environment and request before explicit approval. Connectivity validation follows an Approved state.

There is no automatic approval and no Bicep resource or script that blindly approves arbitrary pending Front Door requests. A matching description alone is not sufficient identity evidence.

Reqro IaC owns the customer-managed endpoint lifecycle, subject to ordinary Azure authorization. That ownership does not authorize generic endpoint auto-approval logic or extend to Front Door's managed endpoint. No endpoint is provisioned or approved in this documentation slice.

## 7. Accepted cost and unresolved choices

The additional customer-managed private endpoint and ACA dedicated private-endpoint infrastructure incur Azure charges. Their cost and complexity are accepted as part of this private/custom-VNet topology. No price, region, capacity or budget is selected here.

The following remain unresolved and must not be inferred from this decision:

- Production CIDRs, region and resource names.
- WAF policy and its settings.
- Workload profile SKU/capacity.
- Registry, pull authorization and image publication.
- Custom domain, public DNS and certificates.
- Health-probe timing.

Existing image SBOM/vulnerability and publication gates remain in the [NGINX runtime validation record](F060-4A-2C-1B-2-nginx-image-pinning-runtime-validation.md). No image is pushed. This decision does not change CSP, HSTS, frontend COOP, authentication or Entra registration. The MSAL bridge remains inactive.

## 8. Validation and handoff

This slice changes exactly this feature document. Validation covers relative links, unique headings, table structure, whitespace/control characters, formatting and git diff --check. No Bicep, build, unit/database suite, Azure compilation, login, what-if, resource operation or deployment is required or performed.

After final architecture review, separately authorize resuming F060.4A-2B-1. That work must verify current schemas for both endpoint relationships, model the customer endpoint/DNS separately from Front Door-managed Private Link, preserve manual Front Door approval and retain the unresolved deployment inputs and security gates.

One local commit is authorized with subject docs(hosting): define private endpoint dns topology. No push, deployment or 2B-1 resumption is authorized.

**STOP FOR F060.4A-2B-0A ARCHITECTURE REVIEW.**
