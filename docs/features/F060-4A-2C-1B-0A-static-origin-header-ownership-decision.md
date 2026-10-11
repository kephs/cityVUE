# F060.4A-2C-1B-0A — Concrete Static-Origin & Header Ownership Decision

Status: architecture selection explicitly authorized on 2026-10-11; documentation-only decision recorded for final architecture review. Implementation of F060.4A-2C-1B remains stopped pending separate authorization.

**NGINX IN AZURE CONTAINER APPS IS THE APPROVED STATIC ORIGIN.**

**PUBLIC NETWORK ACCESS MUST REMAIN DISABLED.**

**FRONT DOOR PREMIUM IS THE PUBLIC EDGE.**

**THE MSAL BRIDGE REMAINS INACTIVE.**

**NO SECURITY HEADER CHANGED.**

**NO DEPLOYMENT OCCURRED.**

## 1. Baseline and authority

Freshly fetched origin/main and starting HEAD are **1a7ac702fa7da8f96a0cc75686329a8be8d7dae1**. Dedicated isolated branch: codex/f060-static-origin-ownership-decision. Starting tree/index were clean, 0 ahead / 0 behind. Fetch succeeded with an unrelated stale-worktree cleanup permission warning; no repair was attempted. The stopped codex/f060-static-origin-serving-foundation branch is untouched.

This explicit decision supplies the concrete server and header-owner choices missing from the [static-serving/COOP readiness assessment](F060-4A-2C-2A-auth-2-0-static-serving-coop-readiness.md). It refines the private static-container direction in [ADR-030](../architecture/decisions/ADR-030-production-serving-contract.md) and the proposed Container Apps topology in [F060.4A-2B-0](F060-4A-2B-0-edge-private-ingress-iac-readiness.md). Their hostname, admission, private ingress, TLS and API isolation requirements remain applicable. Historical assessments remain accurate descriptions of their checkpoints; their unresolved server selection is resolved by this dated decision.

The [MSAL redirect-bridge foundation](F060-4A-2C-2A-auth-1-msal-redirect-bridge-foundation.md) remains prepared but inactive. This document creates architecture authority only. It does not claim an implemented static server, deployed infrastructure, HTTP verification or authenticated compatibility.

## 2. Selected serving architecture

The approved production frontend path is:

```text
Client
  -> Azure Front Door Premium + WAF
  -> Private Link
  -> Azure Container Apps
  -> dedicated NGINX static-serving container
  -> Vite production artifacts
```

Azure Container Apps environment public network access must be disabled. The frontend origin must not be directly internet-accessible and must be reachable through the approved Front Door Private Link path. Existing origin admission and exact-hostname requirements remain; choosing NGINX does not satisfy or replace their future validation.

NGINX is the selected production static web server. Firebase Hosting, Azure Static Web Apps, Azure Storage Static Website, Nest static serving, Caddy, Apache and a custom Node static server are not alternatives authorized by this decision. A later architecture amendment is required to select one. Historical Firebase configuration is not production authority.

The API remains a separate origin/path under ADR-030. Neither the frontend container nor this decision introduces business API behavior or changes the API origin/admission architecture.

## 3. Container security requirements

The future implementation must provide:

- A dedicated frontend/static container with a non-root process and an unprivileged listener port.
- A production image/version pinned and supply-chain reviewed before use; no image tag, version or digest is selected here.
- Static-file serving that requires no application secrets merely to serve artifacts.
- No business API behavior.
- Container Apps environment public network access disabled, with the approved Front Door Private Link path as the origin access route.

No Dockerfile, nginx.conf, Bicep resource, network change or Azure resource is created. Operational evidence and deployment authorization remain separate gates.

## 4. Routing and MIME ownership

NGINX owns exact-file resolution, MIME types, approved client-route SPA fallback, missing-asset failures and redirect bridge precedence. Front Door owns public ingress and routes API traffic separately under ADR-030. NGINX must also reject API paths as SPA candidates, so incorrect edge routing cannot turn an API request into the frontend shell.

| Request class                                     | Required behavior                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| /redirect.html                                    | Exact bridge document before SPA fallback; a missing bridge fails rather than returning index.html |
| /assets/<existing>                                | Exact existing asset with the appropriate MIME type                                                |
| /assets/<missing>                                 | Real 404, never index.html                                                                         |
| Known root static files and other built artifacts | Exact files; missing file requests fail rather than becoming SPA navigation                        |
| /api/...                                          | Never SPA fallback; the approved edge/API path handles API requests                                |
| Client-side application navigation routes         | Serve index.html through the reviewed SPA fallback                                                 |

“All unknown paths return index.html” is not the serving contract. The future implementation must distinguish approved application navigation from file/API requests and validate that distinction. No new application route is introduced here.

NGINX owns text/html for index.html and redirect.html, JavaScript-compatible MIME for JS modules and text/css for CSS. Missing JS must never be a successful HTML shell response. The bridge must retain its dedicated artifact and dependency isolation from React, Router and business SPA modules.

## 5. Frontend header ownership

This matrix selects target ownership only. It does not supply new CSP values, activate headers or move existing API protections.

| Header or response concern | Authoritative target layer   | Boundary                                                                                                         |
| -------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| HSTS                       | Front Door edge              | Eventual public-facing owner; existing Nest HSTS remains until an independently reviewed and verified transition |
| CSP                        | NGINX static frontend origin | Existing policy is unchanged; frontend policy implementation requires its applicable review                      |
| Future CSP Report-Only     | NGINX static frontend origin | Unless later architecture changes ownership; no Report-Only policy is introduced                                 |
| X-Frame-Options            | NGINX                        | Preserve reviewed framing protections                                                                            |
| X-Content-Type-Options     | NGINX                        | Preserve MIME protection                                                                                         |
| Referrer-Policy            | NGINX                        | Frontend response policy owner                                                                                   |
| Cross-Origin-Opener-Policy | NGINX                        | Normal documents same-origin; exact bridge exception below                                                       |
| Cache-Control              | NGINX                        | HTML and hashed-asset classes remain distinct                                                                    |
| MIME types                 | NGINX                        | Correct document and asset types; no HTML fallback for missing modules                                           |

Front Door must preserve the reviewed origin-owned policies rather than independently appending conflicting frontend policies. Its TLS, WAF, public ingress, Private Link and eventual HSTS responsibilities do not make it the routine frontend COOP owner. Edge-generated responses retain responsibility at their generating layer.

Nest remains the API header owner. Current Nest/API headers, including HSTS, are unchanged. Edge HSTS ownership must be implemented and verified before any removal of existing application HSTS; such removal is outside this decision and requires separate review.

## 6. COOP policy and bridge exception

NGINX is the primary frontend COOP owner:

| Document                                                           | Target COOP behavior                          |
| ------------------------------------------------------------------ | --------------------------------------------- |
| Normal frontend documents, including the normal SPA shell/fallback | Cross-Origin-Opener-Policy: same-origin       |
| Exact /redirect.html bridge document                               | Cross-Origin-Opener-Policy **must be absent** |

The bridge exception is exact-path and narrow. Do not disable COOP globally, extend the exception to wildcard document/auth paths, or replace absence with unsafe-none or same-origin-allow-popups. All other applicable reviewed headers remain intact.

Front Door response-header removal is an emergency/edge capability, not the normal frontend COOP mechanism. Any future use requires separate review and must not create conflicting ownership or broaden the exception. Actual origin and public-edge responses must eventually prove the intended policy and absence of reintroduced bridge COOP.

This defines the target policy; no current response header changes in this slice.

## 7. Cache-policy boundary

NGINX owns semantic cache classes, not newly invented durations:

| Class                                        | Required semantics                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| HTML documents: index.html and redirect.html | Safely replaceable; never immutable hashed-asset caching. Retain ADR-030's no-store requirement    |
| Verified fingerprinted Vite assets           | Separate long-lived/static asset class; eligible only under approved immutable/public-asset policy |
| Errors and runtime configuration             | Preserve ADR-030 no-store boundaries; no negative or stale tenant-data caching                     |

No new max-age is selected. Historical Firebase durations do not independently authorize the new production origin's numeric policy. **The later 1B implementation must STOP if a numeric cache policy is required and no approved value exists.** Deployment/hostname separation remains required by ADR-030. Bridge updates and rollback must not be trapped behind immutable HTML caching.

## 8. Authentication, CSP and deployment boundaries

The bridge remains inactive. redirectUri, postLogoutRedirectUri, loginRedirect, acquireTokenSilent and Entra app registration remain unchanged. No authenticated UAT is performed.

No CSP policy changes, Microsoft host allowlists, CSP Report-Only policy or reporting endpoint are introduced. Assigning future Report-Only ownership is not permission to activate it. Authenticated compatibility and the existing bridge activation gates remain outstanding.

No resource creation, Azure login, deployment, Bicep implementation, Dockerfile or NGINX configuration occurs. F061/F062, database/migrations/roles/grants, integration/worker runtime, application API behavior, authentication runtime and dependencies remain untouched.

## 9. Implementation handoff and validation

The concrete server/ownership blocker is resolved by this decision. Do not resume F060.4A-2C-1B until separately authorized. Future implementation must still demonstrate exact-file priority, controlled SPA fallback, missing-asset/API isolation, MIME correctness, cache class separation, narrow COOP omission and unchanged authentication behavior. Infrastructure readiness and actual edge/private-origin verification remain separate from local origin tests.

This slice contains exactly this document. Validation covers relative links, unique heading anchors, Markdown tables, whitespace/control characters, formatting and git diff --check, plus exact one-file commit scope. No build, unit, database or Azure validation is required or claimed.

One local documentation commit is authorized. No push, deployment or implementation resumption is authorized.

**STOP FOR F060.4A-2C-1B-0A ARCHITECTURE REVIEW.**
