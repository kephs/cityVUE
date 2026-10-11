# F060.4A-2C-2A-auth-2-0 — Production Static Serving & COOP Ownership Readiness

Status: assessment complete; **decision B**. Per-path capability likely exists, but the approved production static-serving implementation is missing. Implementation and production evidence are required before bridge activation. Assessment date: 2026-10-11.

**NO STATIC-SERVING BEHAVIOR CHANGED.**

**NO COOP HEADER CHANGED.**

**THE MSAL BRIDGE REMAINS INACTIVE.**

**NO ENTRA CONFIGURATION CHANGED.**

**NO CSP POLICY CHANGED.**

**NO DEPLOYMENT OCCURRED.**

The future requirement is **no Cross-Origin-Opener-Policy header on the exact bridge document**, while normal pages retain their reviewed security posture. This is not authorization to disable COOP globally, substitute another COOP value, or relax framing/CSP.

## 1. Verified baseline and evidence limits

Fetched authoritative origin/main and created isolated branch codex/f060-static-serving-coop-readiness at **efcd7585d2a31c521432b1a1e56ff8bf3c8ff48d**, matching origin/main. Starting tree and index were clean, 0 ahead / 0 behind. Fetch succeeded but reported a stale worktree cleanup permission warning; no unrelated worktree repair was attempted.

Sources inspected include the [auth compatibility assessment](F060-4A-2C-2A-auth-msal-compatibility-readiness.md), [bridge foundation](F060-4A-2C-2A-auth-1-msal-redirect-bridge-foundation.md), [serving configuration](F060-4A-2A-production-serving-configuration.md), [edge/private-ingress readiness](F060-4A-2B-0-edge-private-ingress-iac-readiness.md), [ADR-030](../architecture/decisions/ADR-030-production-serving-contract.md), [cache/header assessment](F060-4A-2C-0-cache-browser-security-policy-readiness.md), [CSP assessment](F060-4A-2C-2-0-csp-compatibility-report-only-readiness.md), and the runtime/configuration artifacts below.

Repository evidence describes code and plans, not the current contents of a cloud account. No production request, Azure CLI, cloud inventory, Entra operation or authenticated UAT was performed. No local Vite server was started for this assessment; development conclusions below are source inspection, not HTTP verification.

## 2. Current, target and unresolved serving ownership

| Question                                         | Answer and evidence                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Is production SPA/static hosting implemented? | Historical Firebase hosting configuration exists. The accepted ADR-030 production private-static-origin architecture is **not implemented** in this repository. No current live production frontend owner is established by this inspection.                                                               |
| B. What owns existing serving?                   | Development uses Vite. Historical Firebase configuration serves dist-react. Neither is proof of an active, approved ADR-030 production deployment. Nest does not serve the React SPA.                                                                                                                      |
| C. What is the approved target?                  | ADR-030 approves a Front Door Premium/WAF reference with private static/API origins. Its static-serving container is intended to control HTML headers and SPA routing. Container Apps is the proposed private hosting platform; detailed resource graph remains proposed in the edge readiness assessment. |
| D. Can the owner express per-path headers?       | Front Door supports path conditions and header deletion. The static container must support exact-file/header handling, but its webserver and configuration are unselected/unimplemented. Capability is supportable in principle, not proven end to end.                                                    |
| E. Who owns SPA fallback?                        | Firebase's historical configuration has a global index.html rewrite. In the target, the static server should own file resolution and approved SPA fallback; the edge routes API traffic separately. Concrete rule order and implementation remain unresolved.                                              |

The [root package scripts](../../package.json) build React through Vite into dist-react. [Vite configuration](../../react/vite.config.mjs) has separate index.html and redirect.html inputs. [The bridge](../../react/redirect.html) imports only MSAL's redirect-bridge helper and uses a fixed sanitized failure message. [MSAL configuration](../../react/src/auth/msalConfig.js) still uses the origin root for redirectUri and postLogoutRedirectUri. Creating the bridge artifact did not activate it.

The [Nest bootstrap](../../server/src/bootstrap.ts) installs API cache middleware and uncustomized Helmet. Tracked server source has no React express.static/ServeStatic/useStaticAssets/sendFile implementation. [The server container](../../server/Dockerfile) copies the server build, not dist-react. The operator container and Azure operator pipelines are unrelated database-operation infrastructure, not static serving. No tracked NGINX/Envoy static/proxy configuration, Front Door serving IaC, Bicep/Terraform serving resources or Static Web Apps configuration establishes a production frontend owner.

[Firebase configuration](../../firebase.json) retains cleanUrls, redirects, SPA rewrite and cache rules. [Legacy rollback configuration](../../firebase.legacy.rollback.json) targets dist with cleanUrls/trailingSlash settings and no explicit header policy. These are repository deployment configurations, not verified live state. The older [F016 hosting preference](F016-production-hosting-deployment-readiness-plan.md) does not supersede ADR-030's private-origin reference. This assessment selects neither Storage/static website nor App Service nor a new webserver.

## 3. COOP inventory across plausible layers

Tracked-file searches covered Cross-Origin-Opener-Policy, COOP, same-origin, same-origin-allow-popups and unsafe-none, plus generic middleware/header and serving configuration. Exact COOP references were in prior assessment documents; generic Helmet is the indirect runtime source. Same-origin occurrences also describe URLs, fetch policy and tenancy and are not evidence of a COOP header.

| Layer/source                                                        | Classification                                               | Finding                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nest app.use(helmet())                                              | Runtime active when the API runs                             | Installed Helmet 8.3.0 enables COOP with default same-origin. No application COOP override was found. It applies to responses through this listener, including its HTML/error paths, not just JSON.        |
| React index/bridge HTML and MSAL configuration                      | Runtime/build artifacts                                      | No HTTP COOP emitter. HTML referrer metadata is not COOP. The bridge remains inactive.                                                                                                                     |
| Vite server/preview configuration                                   | Development-only                                             | No configured COOP/custom security-header set. Vite development behavior cannot establish production behavior.                                                                                             |
| Firebase current and rollback JSON                                  | Deployment configuration present; live activation unverified | No declared COOP header. Cannot prove provider/edge behavior or exact bridge delivery merely from absence in JSON.                                                                                         |
| Server/operator containers and operator pipelines                   | Existing container/deployment artifacts                      | No additional COOP/static response-header emitter found. Server image remains API-only. Operator automation does not serve browser documents.                                                              |
| Static container, admission proxy, ACA ingress and Front Door/WAF   | Target architecture only                                     | Potential delivery/header layers must be reviewed together. No implemented COOP rule or deployed public-response proof exists. Do not assume a platform adds, strips or preserves COOP without validation. |
| Prior CSP/auth/bridge assessments and referenced Microsoft guidance | Documentation/reference only                                 | Explain the bridge no-COOP requirement; do not create response headers. No same-origin-allow-popups or unsafe-none application policy is selected.                                                         |

A request incorrectly routed to Nest for /redirect.html would encounter Nest's response handling and Helmet, not the prepared bridge. Conversely, API Helmet does not automatically reach a correctly routed static-origin document. The API and static origin are different components behind the **same intended public origin**.

## 4. Header ownership matrix

This records existing evidence and target responsibilities; it neither transfers ownership nor chooses a new frontend policy. Static-origin versus edge assignment still requires detailed review where shown. The reverse proxy should preserve reviewed origin policies; any header synthesis/override there requires explicit ownership.

| Header                     | Current evidence                                                                       | Intended owner / unresolved detail                                                                                | Duplicate or conflict risk                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| HSTS                       | Nest Helmet emits it; production static delivery unverified                            | Edge/TLS infrastructure under ADR-030; existing application emission remains unchanged pending coordinated review | Edge and origin may disagree on duration/subdomains; no numeric change here                         |
| CSP                        | Nest enforcing Helmet policy, with attachment-specific policy where applicable         | Application for API documents; static origin/edge for frontend, exact owner/policy unresolved                     | Multiple enforcing policies combine restrictively and may break auth; never copy API policy blindly |
| CSP Report-Only            | Not configured by this slice/current inspected header baseline                         | Unresolved, separately gated static/edge policy plus owned privacy-reviewed reporting collector                   | Duplicate reports/privacy exposure; no header or endpoint added                                     |
| X-Frame-Options            | Nest SAMEORIGIN                                                                        | Application for API; static origin/edge for frontend, concrete emitter unresolved                                 | Conflicting edge policy can block same-origin bridge frames                                         |
| X-Content-Type-Options     | Nest nosniff                                                                           | Application for API; static origin for assets/documents, edge-generated responses need edge ownership             | Bad asset MIME plus nosniff blocks modules; preserve protection                                     |
| Referrer-Policy            | Nest no-referrer; frontend/bridge HTML meta no-referrer; Firebase /track response rule | Application for API; static origin/edge for frontend HTTP policy                                                  | Meta alone does not establish all HTTP responses; multiple emitters can diverge                     |
| Cross-Origin-Opener-Policy | Nest same-origin; no configured frontend HTTP value                                    | Application for API; static origin/edge frontend responsibility unresolved; exact bridge must omit header         | A downstream/global rule can re-add it; do not infer the normal frontend value from API Helmet      |
| Cache-Control              | API default no-store, attachment private, no-store; Firebase rules below               | Application for API; static origin for HTML/assets; edge honors approved policy and owns its generated responses  | Edge override or overlapping static rules can cache HTML/errors or strip attachment privacy         |

Existing CSP, HSTS, SAMEORIGIN, nosniff, no-referrer and attachment privacy remain untouched. No Permissions-Policy or CSP Report-Only is added. Absence of a proven production frontend policy is a review gap, not permission to weaken or fabricate one.

## 5. Exact bridge route, edge and origin capability

Microsoft documents [Front Door request-path conditions](https://learn.microsoft.com/en-us/azure/frontdoor/rules-match-conditions) and [response-header Delete actions](https://learn.microsoft.com/en-us/azure/frontdoor/front-door-rules-engine-actions). COOP is not listed among the latter page's reserved headers. These capabilities support a narrow exact-path rule in principle. They do not prove Reqro's future route associations, matching/normalization, ordering or final emitted headers.

The future origin must serve the real /redirect.html document without COOP while retaining all other reviewed headers. If a common edge rule adds COOP, its bridge exception must prevent reintroduction; a reviewed edge deletion can enforce the final boundary. Assign one accountable policy owner and validate all intervening layers. No rule is created here. Setting unsafe-none or same-origin-allow-popups is not the required header absence.

Container Apps hosting alone is not a static-file/header implementation. The future container's server must demonstrate per-path headers and exact-file precedence. No webserver is selected here. Edge routing must send /api/v1 and descendants to the API before any SPA fallback, preserving API errors as API responses. Static resolution must process:

1. Exact /redirect.html to its real document, with no index fallback or unexpected canonical redirect.
2. Existing static assets with correct types; missing asset requests return an appropriate not-found response, never index.html.
3. Approved frontend navigation routes to index.html, preserving reviewed normal-page headers.

Use an actual existing SPA route during validation; example paths in planning are not route additions. Exact-path matching must consider queries, normalization and rewrites without expanding the header exception to other documents. Historical Firebase cleanUrls and global rewrite require separate proof if ever reused; they are not evidence that the exact callback path currently survives unchanged.

## 6. Cache, MIME and same-origin constraints

Historical Firebase declares global no-cache, no-store, must-revalidate and /assets/** public, max-age=31536000, immutable. These overlapping declarations require effective-response validation and proof that cached assets are actually immutable; this document does not assert observed hosting precedence. The legacy rollback file declares no explicit cache header.

ADR-030 requires HTML/runtime configuration/API/errors to be no-store; only verified immutable public hashed assets qualify for caching with deployment/hostname separation. The static origin must give redirect.html HTML-appropriate no-store behavior, and the edge must not override it with long-lived asset caching. No new max-age is chosen.

The future bridge response must be text/html, and emitted module assets must have a valid JavaScript MIME type. Preserve nosniff and normal safe HTML handling. Verify the bridge's dependency closure loads without React/business SPA code; build existence alone does not prove delivery.

The bridge stays at /redirect.html on the **same approved HTTPS origin as the SPA**. No production hostname is invented. An unrelated origin would change browser origin/storage/message/framing assumptions and require a new reviewed authentication design. Internal origin hostnames do not become public callback URLs.

COOP is independent of future CSP Report-Only work. No-COOP does not establish a correct CSP allowlist. Authenticated UAT must still assess login, redirects, silent frames, logout and console violations. Neither Microsoft framing allowances nor unsafe-inline removal are approved by this assessment.

## 7. Activation gates

All remain future gates; none is performed or satisfied by this assessment alone:

1. Approve the exact production serving owner and header responsibilities.
2. Prove /redirect.html serves the actual bridge file, not SPA fallback.
3. Prove its final response contains no COOP header across applicable delivery paths.
4. Prove normal application security headers and all other bridge protections remain intact.
5. Approve the exact production redirect URI.
6. Register that exact URI in the authorized Entra application.
7. Switch MSAL redirect configuration in a separately reviewed change.
8. Complete authenticated login UAT.
9. Complete silent-renewal UAT.
10. Complete logout UAT, including the separately reviewed post-logout destination.
11. Complete CSP/framing/browser-console validation.

## 8. Future HTTP verification plan

After separately authorized implementation/deployment, inspect actual responses through the approved public origin. Capture sanitized evidence without authorization codes, tokens, cookies or callback query/fragment secrets. Inspect intermediate redirects and final responses, not just browser-visible success.

| Request/evidence                       | Required assertion                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET /                                  | Expected status and index document identity; reviewed normal-page header policy intact                                                                                         |
| GET /redirect.html                     | Expected successful status (normally 200), text/html, real bridge identity distinct from index; no unexpected canonical redirect; no COOP header including duplicate instances |
| GET an existing SPA navigation route   | Expected index fallback only for allowed navigation; normal-page headers preserved                                                                                             |
| GET emitted bridge module/dependencies | Expected successful statuses and JavaScript MIME; correct reviewed asset caching; bridge loads with no React/business SPA bundle                                               |
| Missing asset and API error requests   | No index fallback; appropriate status/type/cache; API security behavior retained                                                                                               |
| Edge/origin policy comparison          | No intermediate/global rule reintroduces bridge COOP, changes CSP/framing, or overrides HTML no-store; inspect cache-hit/revalidation behavior where applicable                |

Compare HSTS, CSP, Report-Only absence unless separately approved, framing, nosniff, referrer, COOP and Cache-Control for all three document requests. Verify body/build identity and dependency requests, not just response status. Use authorized origin-side evidence to distinguish origin output from edge mutations; do not bypass private-origin admission controls. Browser UAT remains necessary after HTTP checks.

## 9. Decision and bounded next slice

**B — Capability likely exists, but production static-serving implementation is still missing; implementation slice required first.**

Recommend separately authorizing **F060.4A-2C-1B — Static-Origin Cache, SPA-Fallback & Redirect-Bridge Header Foundation**. Its bounded deliverables should select/review the concrete static server within the accepted architecture, establish header ownership, exact-file precedence, safe navigation fallback, HTML/immutable-asset cache behavior, correct MIME, and the narrow bridge no-COOP requirement with response tests. It must retain private-origin/admission constraints and coordinate edge rules without silently activating the bridge, registering Entra URIs, changing CSP or deploying.

No next slice has begun. This finding does not override the unresolved infrastructure gates in the edge/private-ingress assessment.

## 10. Validation and scope

This assessment changes exactly this documentation file. Relative links, heading anchors/section references, Markdown table structure, formatting, whitespace/control characters and git diff --check are checked before commit. No unit, build, database suite, local HTTP server, production verification or authenticated UAT is required or claimed for this documentation-only slice.

No runtime, deployment/IaC, package, F061/F062, integration, worker, database, migration, role/grant, redirect document, Vite or authentication configuration changes. One local documentation commit is authorized; no push or deployment.

**STOP FOR F060 STATIC-SERVING / COOP READINESS REVIEW.**
