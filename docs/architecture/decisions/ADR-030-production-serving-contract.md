# ADR-030 — Production Serving Contract

Status: **Accepted with conditions** — architecture review on 2026-10-09.
Only F060.4A-2A repository configuration implementation is authorized. Acceptance
does not authorize infrastructure creation, deployment, shared hosting, operator
execution changes or subsequent F060.4A slices.

## Context and decision

[ADR-025](ADR-025-trusted-production-organization-resolution.md) remains the
authority for deployment-per-tenant, verified hostname resolution and independent
staff identity. [F060.4A-1](../../features/F060-4A-1-http-authority-hardening.md)
already hardens HTTP authority. Preserve both without adding another resolver.

The approved logical path is resident browser → public customer DNS/hostname →
TLS edge → React static origin or `/api/v1` private API origin → trusted final-hop
proxy → Nest → existing registry resolver. Public React and API share one HTTPS
origin. No browser Organization selector, provider-host fallback or cross-tenant
origin failover is permitted.

An isolated deployment owns an explicit public hostname set and one approved
Organization/data boundary. Hostname inventory is deployment configuration, not
DNS verification, canonical-domain selection, registry authority or permission.
It constrains configured CORS origins; it does not filter the resolver's results.
The isolated database/domain set and future ingress allowlists remain necessary.

## Provider-neutral requirements

- Production HTTP uses the client profile, registry resolution, forwarded host
  source and explicitly configured final-hop peers. Express proxy trust stays off.
- The edge validates public authority, rejects duplicate/ambiguous authority,
  overwrites forwarded host and denies unknown hosts. The application preserves
  its existing wire-header, immediate-peer and registry checks.
- Nest is unreachable except through the approved ingress. CIDR syntax validation
  is not evidence of network isolation or ownership of those peers.
- Public and origin TLS verify certificate names/chains. Certificate ownership,
  renewal and expiry monitoring belong to infrastructure. HTTP redirects, HSTS,
  SNI behavior and origin bypass tests require later deployment evidence.
- `/api/v1` and its descendants reach Nest unchanged before any SPA fallback.
  API failures never become HTML or legacy persistence. Missing assets return 404.
- Cache only immutable public hashed assets, separated by public hostname and
  deployment. HTML, runtime configuration, all API responses and errors are
  no-store; no negative or stale tenant-data caching.
- Static HTML security headers belong to static hosting/edge. Nest Helmet does
  not secure independently served HTML. CSP compatibility requires later review.
- Layer edge abuse control, origin admission, tenant resolution and application
  throttling. Client-address trust is separate from hostname trust; current
  proxy-IP throttling remains unchanged and is not production validation.
- Infrastructure health does not prove tenant readiness. Zero bindings may boot;
  real-hostname DNS/TLS/React/API evidence must establish launch readiness.
- Pre-activation infrastructure evidence and post-activation tenant checks are
  distinct. Activation/deactivation and operator execution semantics are unchanged.
- Future absolute public URLs derive from active verified public_canonical
  registry bindings. Current tracking credentials remain hostname-independent.

## Azure reference implementation and F016 refinement

The approved reference is Front Door Premium/WAF with private static and API
origins, proposed as Container Apps, with a controlled admission proxy before
Nest. Public environment access is disabled; approved Private Link connections
and exact hostname routes establish the edge path. Actual final-hop addresses,
forwarded-header preservation and all bypass paths must be measured and tested.

This explicitly refines the earlier **Azure Static Web Apps preference** in
[F016](../../features/F016-production-hosting-deployment-readiness-plan.md).
A static-serving container permits controlled headers and SPA routing on the
private-origin path. F016's other prerequisites and approval boundaries remain.
No historical accepted decision is silently replaced.

Microsoft documents [Container Apps behind Front Door Private Link](https://learn.microsoft.com/en-us/azure/container-apps/how-to-integrate-with-azure-front-door),
[forwarded-host overwrite](https://learn.microsoft.com/en-us/azure/frontdoor/front-door-http-headers-protocol)
and [Private Link support/limitations](https://learn.microsoft.com/en-us/azure/frontdoor/private-link).
These references are architectural inputs, not proof of an actual deployment.
No Azure identifier or header enters the Reqro domain model. Other providers or
a single reverse proxy can implement the same logical contract after review.

## Implemented configuration boundary

F060.4A-2A adds HTTP-only production validation and an explicit frontend client
build profile. See the [configuration and evidence record](../../features/F060-4A-2A-production-serving-configuration.md).
Server operator/migration environment validation remains unchanged. Development
and test serving retain their existing direct-host and localhost workflows.
Legacy production-optimized demo builds remain distinct from client API builds.

## Remaining work and conditions

No Front Door, static origin, private network, DNS, certificate, WAF, proxy,
security-header policy, cache policy, readiness gate, new throttler or canonical
URL service is implemented by 2A. Firebase remains untouched. No schema change or
Migration 50 is required. No production-readiness claim is made.

Review 2A before separately authorizing 2B (edge/TLS/private ingress), 2C
(cache/security headers), 2D (real-hostname evidence), 2E (proxy-aware abuse
controls) or 2F (public URLs). Operator integration remains separately coordinated.
