# F060.4A-2C-1B-1 — NGINX Routing, SPA-Fallback & COOP Configuration Foundation

Status: configuration foundation implemented for security/hosting review; no runtime NGINX or production-serving claim.

**THE MSAL REDIRECT BRIDGE REMAINS INACTIVE.**

**NO ENTRA CONFIGURATION CHANGED.**

**NO CSP POLICY WAS ADDED.**

**NO HSTS WAS MOVED.**

**NO CONTAINER IMAGE WAS SELECTED.**

**NO AZURE RESOURCE WAS CREATED.**

**NO DEPLOYMENT OCCURRED.**

## Authority and baseline

Fetched origin/main is **7f4ab2ef97d01056624e440c9af3fd22e18e0053**. Verified ownership-decision commit 2403b4e8241731a811b8b4d23b4cd6f67961b4dd is its ancestor. Reused the clean codex/f060-static-origin-serving-foundation worktree and fast-forwarded from 1a7ac702fa7da8f96a0cc75686329a8be8d7dae1 without conflicts. Initial tree/index were empty; ahead/behind was 0/0 after synchronization. Git reported the previously observed unrelated stale-worktree cleanup permission warning; no repair was attempted.

Authority is the [concrete ownership decision](F060-4A-2C-1B-0A-static-origin-header-ownership-decision.md), [ADR-030](../architecture/decisions/ADR-030-production-serving-contract.md), [COOP readiness assessment](F060-4A-2C-2A-auth-2-0-static-serving-coop-readiness.md) and [bridge foundation](F060-4A-2C-2A-auth-1-msal-redirect-bridge-foundation.md). This slice explicitly authorizes conservative no-cache asset behavior pending numerical performance-policy review.

Approved topology remains Front Door Premium/WAF → Private Link → private Azure Container Apps → dedicated NGINX → Vite artifacts. The API remains separate. No existing frontend NGINX directory was present; repository deploy/ conventions support the new [deploy/frontend/nginx/nginx.conf](../../deploy/frontend/nginx/nginx.conf).

## Configuration and packaging contract

The standalone configuration expects Vite output at /usr/share/nginx/html: index.html, redirect.html and assets/. This path does not select a container image. Future packaging must supply the standard /etc/nginx/mime.types file, retain its HTML/JS/CSS mappings and verify .mjs mapping compatibility.

The foundation listens only on 127.0.0.1:8080. It does not expose a public listener or establish production origin admission. Production listener/admission integration needs separate review; this loopback configuration cannot simply be treated as a complete Container Apps deployment. PID and client-body temporary paths are under /tmp, the process user/image remains a later non-root packaging requirement, and directory listing is disabled. Access logging is off to avoid introducing callback-query logging; future sanitized operational logging requires review.

No Dockerfile, image reference, container composition, Front Door rule, Bicep or other IaC is added.

## Routing contract

| Request                            | Configured behavior                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| /redirect.html                     | Exact-match location; actual file or 404, never index fallback                                                      |
| /index.html                        | Exact-match location; actual file or 404                                                                            |
| /                                  | Resolves the normal index document through the navigation fallback                                                  |
| /assets and /assets/...            | Bare prefix rejected; descendants use exact file lookup or 404                                                      |
| /api and /api/...                  | Immediate 404, no SPA fallback and no Nest proxy                                                                    |
| File-like paths                    | A dot in any path segment selects file lookup or 404, including missing JS/CSS/images/fonts/maps and file/path-info |
| Remaining extensionless navigation | Existing file first, otherwise internal redirect to /index.html                                                     |

Exact locations win before regex evaluation. The /api/ and /assets/ prefixes use ^~ to retain their isolation. The file-like regular expression is /[^/]_\\.[^/]_(/|$). It intentionally treats dotted navigation segments as file-like; such paths cannot silently become the SPA shell. Extensionless application examples /staff, /admin, /map-preview and /service-requests/123 remain eligible without defining new React routes. Unknown extensionless paths reach the SPA's own routing; this is not an application-route allowlist.

There is no global error_page rewrite and no directory-probing $uri/ fallback. Missing assets and API errors cannot become successful SPA HTML. Encoded/normalized paths, query variants, filesystem behavior and platform-specific path handling remain runtime validation cases.

## Headers, inheritance and COOP

All five add_header directives live at server scope with always. No child location declares add_header, avoiding accidental replacement of inherited baseline headers.

| Header                     | Configured value                        |
| -------------------------- | --------------------------------------- |
| X-Frame-Options            | SAMEORIGIN                              |
| X-Content-Type-Options     | nosniff                                 |
| Referrer-Policy            | no-referrer                             |
| Cross-Origin-Opener-Policy | same-origin except the exact bridge URI |
| Cache-Control              | Status/document-class mapping below     |

A case-sensitive anchored map regular expression matches only /redirect.html in NGINX's normalized $uri, supplying an empty COOP value so that header is omitted. Query parameters do not broaden the path exception. Uppercase paths, /auth/redirect.html and /redirect.html/extra do not match it. All other responses retain same-origin, including the normal index/fallback. Other bridge baseline headers remain inherited; there is no global COOP removal or edge rule.

NGINX's [map documentation](https://nginx.org/en/docs/http/ngx_http_map_module.html) distinguishes case-insensitive string matching from case-sensitive regex matching; the latter is deliberate here. Review used the [headers module](https://nginx.org/en/docs/http/ngx_http_headers_module.html) and [core routing/MIME documentation](https://nginx.org/en/docs/http/ngx_http_core_module.html). Static tests verify configuration contracts, not the installed server's execution.

No CSP, CSP Report-Only, Microsoft allowlist or HSTS directive is introduced. NGINX remains the future frontend CSP owner; authenticated compatibility review is still required. Front Door remains eventual public HSTS owner. Nest/API headers, including HSTS, are unchanged.

## Cache and MIME

HTML paths, including index.html and redirect.html, use no-store. SPA internal redirects terminate at index.html and therefore use the HTML class. Successful non-HTML static responses use interim no-cache, including hashed Vite assets. Errors use no-store independently of the requested path. This foundation deliberately adds no max-age, s-maxage, immutable or stale-while-revalidate value.

Future performance optimization remains open and requires numeric policy review. No-store HTML preserves bridge update/rollback flexibility. Only built frontend artifacts belong in the document root; runtime configuration and secrets must not be packaged as arbitrary assets.

Standard NGINX mime.types is included for text/html, JavaScript and text/css; .mjs receives an explicit application/javascript mapping. The default for unmapped extensions is application/octet-stream. Missing module responses may be NGINX-generated error HTML with a failure status; they must never be 200 index.html. The actual standard MIME file, syntax and HTTP headers require validation with the later approved NGINX runtime.

## Validation evidence

| Check                                    | Result                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| New NGINX source/configuration contracts | 13 passed, 0 failed; final run 230.735 ms                                                                                                        |
| Existing MSAL redirect-bridge tests      | 4 passed, 0 failed; 9.524 seconds; production dependency closure excludes React/Router/business SPA modules                                      |
| Existing MSAL compatibility tests        | 7 passed, 0 failed; 48.05 seconds                                                                                                                |
| React production build                   | Passed with installed Vite 8.2.2 CLI; both HTML entries and 54 asset files verified                                                              |
| NGINX syntax / actual HTTP tests         | Pending: no existing binary found on PATH or checked standard Windows installation paths; none installed and no image pulled                     |
| Formatting and documentation             | Changed JS/Markdown formatting, links/headings/tables, config indentation, whitespace/control checks and git diff --check required before commit |

There are **24 distinct passing tests**, zero failures/skips in these suites. The repeated 13-test configuration run is not added again. The first contract run passed; subsequent review tightened the COOP map and added negative path cases before the final passing run.

The npm command was unavailable on PATH, so the initial npm build invocation did not start. The equivalent installed Vite CLI ran build react --outDir ../dist-react --emptyOutDir successfully. It reported large-chunk and plugin-timing warnings; no bundle tuning was attempted.

The source parser is deliberately bounded to this configuration's directives/blocks. It does not emulate NGINX, prove installed MIME mappings, prove actual header omission, or substitute for nginx -t and request/response testing. No production/edge behavior is claimed. NGINX formatting has no installed formatter; four-space indentation and trailing-whitespace checks are used. No root/frontend lint script exists; no lint pass is claimed. No backend/database/F062 suites were run or required.

## Preserved boundaries and remaining work

Only the configuration, [focused test](../../test/NginxStaticServingContract.test.mjs) and this document change. Existing MSAL root redirectUri and postLogoutRedirectUri, loginRedirect/acquireTokenSilent behavior, bridge HTML, Vite configuration and all auth runtime remain byte-for-byte unchanged against the starting commit. Tests retain the inactive bridge contract.

No F061/F062, database, migration, worker/integration runtime, package/dependency, API, Entra or Azure IaC change is included.

Before deployment, separately approve image/version/digest and supply-chain review, non-root packaging, the standard MIME file, writable runtime paths, listener/admission wiring, exact hostname handling, private environment access, Front Door/Private Link/TLS and final response-header verification. Run NGINX syntax and HTTP cases for root/index, bridge present/missing, SPA routes, existing/missing assets, API paths, MIME, cache and COOP before claiming runtime readiness. Public Container Apps environment access must remain disabled.

Bridge URI approval/registration, reviewed MSAL activation, login/silent-renewal/logout UAT and CSP/framing/console checks remain future gates. No subsequent container/IaC work has begun.

**STOP FOR F060.4A-2C-1B-1 SECURITY / HOSTING REVIEW.**
