# ADR-025 — Trusted Production Organization Resolution

Status: **Accepted** — approved at architecture/security review on 2026-10-04.

**Acceptance scope.** The architecture below is accepted as Reqro's decided direction for anonymous/public Organization resolution, and the Slice 0 configuration boundary is accepted as implemented. Acceptance of the decision is **not** implementation: the sections describing the tenant-domain registry, hostname normalization, trusted-proxy policy, request TenantContext, staff/hostname consistency, same-origin API direction and domain onboarding remain **target architecture to be built under later reviewed slices**, each still subject to the repository's migration, security and deployment gates.

**Implementation state.** Only the configuration boundary described under "Slice 0" is implemented. No tenant-domain registry, hostname normalizer, forwarded-header policy, request TenantContext or service/repository Organization refactor exists. Nothing in this record authorizes shared multi-Organization hosting, cross-tenant administration, a production deployment or a domain purchase. Product and domain naming below is recorded as an approved product decision, not as evidence that any domain is registered, provisioned or certified.

## Context

Reqro is a client-neutral municipal platform in which **Organization is the tenant boundary** ([ADR-001](ADR-001-organization-isolation.md)). Each Organization owns its resident-facing branding, Resident Experience configuration, Service Requests, alerts, staff, permissions and future integrations.

Protected staff APIs already derive Organization from verified Entra identity and an active provisioned `staff_identity` row. Anonymous resident surfaces do not. They read one server-configured value, `catalog.developmentOrganizationId`, captured from `DEVELOPMENT_ORGANIZATION_ID` at process start and frozen for the life of the process. ADR-001 records this explicitly: _"Anonymous catalog/intake currently uses server-configured development context; this is not a production multi-tenant resolver."_

That convention has two defects. It cannot serve two Organizations from one process at all, and — until the Slice 0 change below — it carried a hardcoded repository fixture UUID default with no production or client-profile guard, so a production process could start and serve a development fixture Organization on every anonymous surface.

A production resolver is therefore required before any multi-Organization deployment, and the development convention must be prevented from reaching production in the meantime. This record decides the target architecture and the immediate configuration boundary; it does not implement the resolver.

## Decision

### Product and domain model

`getreqro.com` is the Reqro company and product domain. Intended uses may include `www.getreqro.com` (marketing), `docs.getreqro.com` (documentation), `status.getreqro.com` (platform status) and `staff.getreqro.com` (a future centralized staff/admin surface). **Residents are never required to use a `*.getreqro.com` address.**

A Reqro customer may serve residents from a verified domain the customer controls — for example `requests.example.gov`, `report.example.gov` or `services.example.com` — and that domain may be the **public canonical resident-facing address**. This supports civic trust, white-label presentation, customer branding and `.gov` identity, which a platform-branded address cannot.

Reqro may additionally maintain a platform-controlled operational hostname of the form `example.platform.getreqro.com` for onboarding, diagnostics, support, DNS transition and recovery. This is a **platform fallback, not necessarily the public canonical address**, and it must never force a customer to expose `getreqro.com` to residents.

The model must therefore distinguish at least three domain roles:

| Role                | Meaning                                                                     |
| ------------------- | --------------------------------------------------------------------------- |
| `public_canonical`  | The single public resident-facing address for an Organization               |
| `public_alias`      | An additional verified address resolving to the same Organization           |
| `platform_fallback` | A Reqro-controlled operational address for onboarding, support and recovery |

One Organization may hold several verified domains across these roles. **One hostname maps to exactly one Organization**, globally and unconditionally.

### Tenant architecture

Approve **hostname-based tenant resolution** as the production application architecture for anonymous resident surfaces.

**Reject path-based tenancy** (for example `getreqro.com/example`) as the default multi-tenant model. A single origin places every tenant in one browser security context, sharing `localStorage`, `sessionStorage`, service workers, cookie jar and MSAL cache, so a path-handling defect becomes a cross-tenant breach that no amount of server-side correctness compensates for.

The browser never chooses the Organization. Query parameters, request bodies, custom Organization headers and `localStorage`/`sessionStorage` are **not** Organization authority and must not become one. The existing anonymous contracts that already reject such selectors remain in force.

### Deployment model — ADR-001 isolation preserved

**Deployment-per-tenant remains the approved first deployment model.** Building tenant-domain resolution does **not** authorize shared SaaS hosting. Under an isolated deployment the registry contains only that deployment's approved Organization and domain mappings, and the resolver behaves identically with one row as with many.

Shared multi-Organization hosting remains a **separately gated architecture and operating-model decision**, consistent with ADR-001 and with the roadmap's _"Prefer isolated client environments initially; shared SaaS needs its own tenancy and operating-model decision."_ This ADR does not supersede that principle, and no part of it should be read as approval for it.

### Anonymous resident resolution

```text
Resident request
      ↓
trusted edge / direct trusted host
      ↓
normalized hostname
      ↓
verified tenant-domain registry
      ↓
exactly one active Organization
      ↓
immutable request TenantContext
      ↓
branding / alerts / catalog / intake / tracking
```

**The hostname is a lookup key, not an authentication credential.** A hostname does not grant access; it selects which Organization's public surface is being served, and only when an operator has provisioned and verified a matching registry row. Every subsystem in one request reads the same resolved context, so one response can never combine one tenant's branding with another's catalog, alerts or requests.

Unknown, inactive, unverified, malformed, missing, duplicate and ambiguous hosts **fail closed** with one indistinguishable response, so the resolver cannot become a tenant-enumeration oracle. Resolution failures are never cached.

### Staff architecture

Resident surfaces use the customer-controlled verified domain. Staff and Admin surfaces are intended to consolidate on a future centralized Reqro-controlled domain such as `staff.getreqro.com`.

**Staff Organization remains derived from verified Entra identity and the active provisioned `staff_identity` record, never from a resident hostname.** A hostname may at most be required to agree with identity; it may never select, widen or substitute staff Organization. `staff_identity` already carries a global `unique (entra_tenant_id, entra_object_id)` constraint, so one workforce identity resolves to exactly one Organization.

**This ADR does not authorize cross-tenant platform staff access.** ADR-001's prohibition on cross-tenant administration remains in force. If such access is ever required it needs its own reviewed decision, a distinct principal type, explicit audited tenant selection and its own security review.

### Same-origin API direction

The intended production shape serves the resident frontend and its API from one origin:

```text
Resident frontend   https://requests.example.gov
API                 https://requests.example.gov/api/v1/...
```

Prefer a **relative** frontend API base path (`/api/v1`) over a build-time tenant-specific absolute API origin, so the browser's own hostname reaches the server on every request and one build serves any tenant. This is architectural direction only and is **not implemented by this record**.

### DNS, TLS and domain ownership

Domain ownership must be **verified before activation**, with DNS `TXT` verification preferred initially. An unverified domain can never resolve a tenant. Certificate issuance, renewal and revocation are infrastructure responsibilities, separate from this application decision. Domain activation and deactivation must be **audited**.

**Tenant administrators must not be able to activate arbitrary domains themselves.** The hostname namespace is global across customers, so registration, verification, activation, canonical promotion and revocation are platform-operator capabilities. A tenant administrator may request a domain and read its own domains' state.

Where domain verification would fetch a customer-supplied URL, the existing validation discipline and the residual risks recorded in [ADR-019](ADR-019-issue-availability-governed-handoff.md) apply; preferring DNS `TXT` avoids that outbound-fetch surface entirely.

#### Accepted clarifications

Added at security review of the ownership-verification design, and implemented by [F060.2](../../features/F060-2-tenant-domain-ownership-verification.md). These refine how the requirement above is met; they change no decision recorded elsewhere in this record.

**What a DNS `TXT` check proves, and what it does not.** Verification proves **current DNS control** of the name, not legal or organizational ownership of the domain. It also **cannot distinguish legitimate DNS control from a compromised DNS administrative account**: to the platform, both look identical. These are properties of the method rather than defects in any implementation of it, and they bound what the registry can be said to attest.

**Verification and activation are separate controls.** A successful check moves a binding to verified and **inactive**. Making a hostname resolvable is a distinct, separately attributed operator decision. Verification establishes ownership; activation decides that residents should now be served from that address, and the two are not the same judgement — a verified domain routinely waits on certificate issuance, DNS transition or content readiness before it should serve anyone.

**Customer domains verify by DNS `TXT`.** Verification of platform-owned fallback hostnames under a Reqro-controlled zone is **deferred**: a `TXT` challenge against Reqro's own zone would prove only that Reqro controls its own DNS, so a distinct infrastructure-issued binding method is required and is not yet decided. Every fallback hostname nevertheless remains an explicit registry row; no wildcard matching is introduced.

**Automated periodic re-verification and automatic deactivation are deferred.** Re-confirming ownership on a schedule, and deactivating a binding whose record has disappeared, are desirable and address the stale-mapping risk recorded under "Security and privacy". Both are withheld pending a scheduler — none exists in the platform — and a separate review of unattended availability-affecting actions. Until then, re-verification is an operator-initiated action.

### Trusted proxy boundary

Future policy, not implemented here:

- **Default-deny** forwarded-host trust.
- **Direct-host mode by default**: only the literal `Host` is read.
- A forwarded tenant-host value is trusted **only** behind explicitly configured trusted edge/proxy infrastructure, identified by configuration rather than by a header.
- **No unconditional `X-Forwarded-Host` trust**, consistent with the security framework's existing requirement not to _"trust forwarded headers indiscriminately."_

Hostname normalization, trusted-proxy configuration and the registry lookup are a later slice.

## Slice 0 — implemented configuration boundary

Only this part is implemented at the time of writing.

`TENANT_RESOLUTION_STRATEGY` selects `development` or `registry` and defaults to `development`, matching the existing default-development posture of `CITYVUE_DEPLOYMENT_PROFILE`.

The `development` strategy serves one explicitly configured Organization to anonymous callers. It is valid only under a development `NODE_ENV` and an explicit development deployment profile, and it **requires an explicit `DEVELOPMENT_ORGANIZATION_ID`**. The previous hardcoded fixture default `10000000-0000-4000-8000-000000000001` is **removed** from both the validation schema and the configuration factory, so no process can silently select a repository-known tenant. The `registry` strategy rejects a lingering `DEVELOPMENT_ORGANIZATION_ID` so a stale development tenant cannot survive into a client configuration.

`registry` is accepted configuration state — a client deployment's environment validates — but **no resolver exists**, so the API refuses to start under it rather than serving with no Organization authority. Migration and operator CLIs continue to validate a client configuration, which keeps a future production migration path open.

The practical consequence is deliberate: **a production process cannot currently start as an HTTP API.** Production requires a client profile, a client profile forbids the development strategy, and the registry strategy is not yet servable. That is the correct fail-closed state while production tenant resolution is unimplemented, and it is honest about a capability the platform does not have. No backend is deployed, so nothing in operation is affected.

## Relationship to ADR-001

[ADR-001 — Organization isolation](ADR-001-organization-isolation.md) **remains in force and is not rewritten, superseded or weakened.** Specifically:

- Organization remains the trusted tenant boundary; Organization-scoped predicates, composite foreign keys and safe not-found denial remain required.
- Staff Organization remains identity-derived. ADR-025 changes nothing about protected staff authorization.
- ADR-025 **refines only the anonymous/public Organization resolution** that ADR-001 explicitly left open as _"not a production multi-tenant resolver."_
- ADR-025 **does not approve shared SaaS hosting** and does not alter ADR-001's preference for isolated deployment.
- ADR-025 **does not introduce cross-tenant administration**.

The security framework's statement that _"the Organization is resolved only from authenticated staff context and never accepted from a request"_ describes protected staff and administrative surfaces and continues to govern them. When this ADR is considered for acceptance, that sentence should be scoped explicitly to those surfaces so the anonymous resident path is described accurately rather than by omission.

## Consequences

A verified registry becomes an operational dependency of every anonymous response, so registry availability, caching and operator tooling become production concerns. Domain onboarding gains a human review gate, which is slower than self-service and is intended to be. Customers gain genuinely white-label resident addresses without Reqro branding. Cache keys, CORS origins, throttle keys and tenant-bearing credentials each acquire a tenant dimension that must be designed rather than inherited from defaults.

Because the browser's hostname becomes meaningful, the current build-time absolute API base URL is incompatible with serving multiple tenant domains from one build and must change before custom domains ship.

## Security and privacy

A forged `Host` selects nothing unless an operator has already provisioned and verified that hostname, so header spoofing cannot reach an arbitrary tenant. Forwarded headers are untrusted by default. Fail-closed, indistinguishable responses prevent tenant enumeration through differential errors. Resolution failures are never cached, so a transient failure cannot be served to later callers.

The highest-ranked residual risks are a CDN or reverse-proxy cache key that omits the hostname, a stale registry mapping for a domain a customer no longer controls, and any code path that selects an Organization by falling back when a resolved context is absent. **No fallback is permitted: absent tenant context is an error, never a default.** Existing composite Organization foreign keys remain a complementary structural control and are not replaced by resolution correctness.

## Evidence required before implementing the resolver

Exhaustive normalization unit coverage, including control characters, duplicate and comma-joined `Host` values, ports, trailing dots, IDN/punycode A-label conversion, IP literals and oversized labels. Resolver coverage for hit, miss, inactive, unverified, wrong-environment, ambiguous and registry-unavailable cases, each proving fail-closed behavior and no default tenant. Trusted-proxy coverage proving default-deny and peer-gated acceptance. Disposable PostgreSQL coverage proving that two Organizations on two hostnames never cross in branding, catalog, alerts, intake or tracking, and that a staff/hostname mismatch and a cross-tenant tracking credential both fail closed. Explicit verification that CDN and proxy cache keys include the hostname.

That database coverage **is now executable**. A dedicated disposable database, `reqro_f0592_test`, and a dedicated role, `reqro_test_user`, exist; the integration harness verifies the target database and user and refuses any other target; and the suite runs whenever `TEST_DATABASE_URL` is supplied. [F060.1](../../features/F060-1-tenant-domain-registry-foundation.md) exercised it, passing 14/14 focused tenant-domain registry tests and 678/678 in a full serial run under `--test-concurrency=1`. Default parallel execution still has a known cross-suite isolation problem, tracked separately as TEST-MAINT in the [roadmap](../../ROADMAP.md). Being executable is not the same as being satisfied: the two-Organization hostname-crossing, staff/hostname mismatch, cross-tenant tracking credential, trusted-proxy and cache-key coverage listed above has not been produced, and it remains a prerequisite for any later slice that changes Organization isolation behavior.

Review resolved the deployment model (deployment-per-tenant first, shared SaaS separately gated) and the ADR-001 scoping recorded below. The user-visible behavior of a cross-tenant tracking credential remains an open product decision for the slice that implements staff/hostname consistency.

## Related evidence

[ADR-001 — Organization isolation](ADR-001-organization-isolation.md), [ADR-019 — Issue availability and governed handoff](ADR-019-issue-availability-governed-handoff.md) (URL validation and residual DNS/homograph risks), [ADR-023 — Administrative Access Management](ADR-023-administrative-access-management-controlled-delegation.md) (immutable audit pattern for future domain events), [client-neutral isolated development](../../decisions/ADR-003-client-neutral-platform-isolated-development.md), [security framework](../../security/SECURITY_FRAMEWORK.md), [environment validation](../../../server/src/config/environment.ts) and [application bootstrap](../../../server/src/bootstrap.ts).
