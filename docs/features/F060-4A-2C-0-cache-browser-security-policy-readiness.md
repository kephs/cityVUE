# F060.4A-2C-0 — Cache & Browser Security Policy Readiness

Status: **Proposed for security / architecture review. Design only; production policy enforcement is not ready.** Assessed 2026-10-10. No header, runtime, infrastructure, package, ADR, F061 or F062 implementation is authorized by this record.

## 1. Baseline and evidence boundary

Starting HEAD, local main, refreshed origin/main and FETCH_HEAD were all `0ae4e8105957fe8b0f7137bf80df9e0f5609b94d`. `git fetch origin main` succeeded before branch creation; this is remote evidence at inspection time, not a promise the remote remains unchanged. Git also reported an unrelated stale-worktree cleanup permission error; no repair was attempted. The initial tree/index were clean, 0 ahead / 0 behind.

Created `codex/f060-4a-2c-0-browser-security-readiness` in `.local-uat/f060-4a-2c-0-browser-security-readiness` at that exact commit. The only deliverable is this document. Claude's worktree and active F062 work are outside scope.

Authorities: [execution protocol](../development/REQRO_CODEX_PROTOCOL.md), [context](../CITYVUE_CONTEXT.md), [architecture](../ARCHITECTURE.md), [roadmap](../ROADMAP.md), [security framework](../security/SECURITY_FRAMEWORK.md), [ADR-030 production serving contract](../architecture/decisions/ADR-030-production-serving-contract.md), [F060.4A-2A](F060-4A-2A-production-serving-configuration.md) and [F060.4A-2B-0](F060-4A-2B-0-edge-private-ingress-iac-readiness.md). Historical checkpoint statements do not override current source or Git evidence.

**Existing** below means inspected source, **Required** means the accepted ADR-030 boundary, **Proposed** means a reviewable future policy, and **Blocked** means further design or browser/deployment evidence is required. No production response, authenticated browser flow, cloud resource or live database was exercised. Public standards/vendor references were consulted; documentation is not deployment proof.

## 2. Current implementation inventory

| Evidence                                                                                                                                                                                                                                 | Current behavior and implication                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Root scripts](../../package.json), [Vite config](../../react/vite.config.mjs), [lockfile](../../package-lock.json)                                                                                                                      | React/Vite build targets dist-react; Vite 8.2.2, MapLibre 6.10.0, MSAL browser 5.21.0, React 19.2.8 and Bootstrap 5.3.8 are locked. No build filename override, CDN base, PWA plugin or custom output template is configured.                                                                       |
| Vite 8.2.2 installed implementation inspected read-only                                                                                                                                                                                  | Default application entry/chunk/asset names contain `[hash]`; worker output also contains `[hash]`. This establishes current configured content-hashed output behavior, not validation of a newly produced release artifact. Future release tests must inspect actual emitted files and references. |
| [HTML entry](../../react/index.html), [React entry](../../react/src/main.jsx)                                                                                                                                                            | One external module entry, no inline executable script or inline stylesheet in the HTML. Existing no-referrer meta. Bootstrap CSS/icons are package imports, not CDN tags. Vite extracts production CSS and emits bundled fonts/assets.                                                             |
| [Public assets](../../react/public/branding/reqro/README.txt), [branding component](../../react/src/branding/ReqroBrand.jsx), [presentation policy](../../react/src/pages/home/presentationPolicy.js)                                    | Unhashed /branding resources; fixed registry/local paths, not arbitrary branding URLs. No standalone fetched runtime-config file or web manifest was found.                                                                                                                                         |
| [Runtime config](../../react/src/config/runtimeConfig.js), [client guard](../../react/src/config/servingConfig.mjs)                                                                                                                      | Settings are build-time import.meta.env values. Client builds require API mode and absent/empty API override; API base becomes same-origin /api/v1. Development permits an absolute HTTP(S) override.                                                                                               |
| [Nest bootstrap](../../server/src/bootstrap.ts)                                                                                                                                                                                          | Uncustomized helmet(), explicit CORS origin list, credentials false, enumerated methods, api/v1 prefix; Swagger also exists at /api/docs and /api/docs-json and needs production exposure review. Nest does not serve the React shell.                                                              |
| [Serving validator](../../server/src/config/serving-environment.ts)                                                                                                                                                                      | Production CORS origins must be exact approved HTTPS origins from the deployment hostname set. This neither enables caching nor authenticates a tenant.                                                                                                                                             |
| [Error filter](../../server/src/common/errors/http-exception.filter.ts), [catalog](../../server/src/catalog/catalog.controller.ts), [public presentation](../../server/src/resident-experience/resident-experience.public.controller.ts) | Many routes explicitly use no-store, including public reads. The global error filter does not set Cache-Control; bootstrap has no universal no-store middleware. Route decorators alone do not establish cache protection on early guard/parser/tenant failures or unmatched paths.                 |
| [Firebase configuration](../../firebase.json)                                                                                                                                                                                            | Historical static host has a global SPA rewrite, general no-cache/no-store/must-revalidate and /assets immutable configuration. It is not the approved private static origin and must not be copied as an API-safe fallback contract.                                                               |
| React/public, React source, imported legacy assets and root package search                                                                                                                                                               | No service-worker registration, Workbox/PWA integration or offline manifest found. No offline HTTP-cache substitute is approved. Existing browser-local legacy data and MSAL SessionStorage are separate from HTTP caching.                                                                         |

[Vite asset documentation](https://vite.dev/guide/assets) confirms imported assets participate in the build graph/hash naming while public-directory files are copied without renaming. Do not equate a filename merely resembling a hash with proof of content addressing.

## 3. Header ownership contract

One policy authority per response class. The layer generating a response owns its representation and cache policy; the edge owns public transport policy. Nest headers on JSON cannot secure HTML served elsewhere.

| Header / directive                                                                 | Static origin                                                                                          | Nest/API                                                                                                                                                                                | Public edge / admission                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content-Security-Policy, initially Content-Security-Policy-Report-Only for the SPA | Own the complete HTML policy and separately reviewed worker-response policy. No meta-based substitute. | Own API/document policy; proposed restrictive inert-document policy for JSON/errors. Swagger must be private/disabled or separately reviewed, never force SPA allowances to support it. | Pass origin policy unchanged. Own restrictive policy on edge-generated HTML errors; admission owns its own errors.                                         |
| frame-ancestors and X-Frame-Options                                                | Own matching framing pair by document class; see section 10.                                           | Proposed frame-ancestors 'none' and DENY for API/error documents.                                                                                                                       | Own DENY and frame-ancestors 'none' for generated documents; do not append a second SPA policy.                                                            |
| Referrer-Policy                                                                    | no-referrer on HTML and static responses.                                                              | no-referrer.                                                                                                                                                                            | no-referrer on generated responses/redirects; preserve origin value.                                                                                       |
| Permissions-Policy                                                                 | Own browser document capabilities from section 11.                                                     | Deny unused document capabilities on API/errors.                                                                                                                                        | Deny unused capabilities on generated errors. Do not globally override a valid SPA geolocation policy.                                                     |
| X-Content-Type-Options                                                             | nosniff on all static responses, including errors.                                                     | nosniff on API successes and errors.                                                                                                                                                    | nosniff on generated responses.                                                                                                                            |
| Cache-Control                                                                      | Response classification in section 4.                                                                  | no-store across every API result; private, no-store acceptable for protected responses.                                                                                                 | Disable caching except explicitly reviewed immutable static hits. Own no-store on generated errors/redirects. Admission must do the same for its refusals. |
| Content-Type                                                                       | Exact file MIME table and error representation.                                                        | JSON or explicitly authorized image/content representation, including errors.                                                                                                           | Exact generated representation; never rewrite JSON to HTML.                                                                                                |
| Strict-Transport-Security                                                          | No independent public policy.                                                                          | No independent public policy in the future serving profile.                                                                                                                             | Sole public owner on HTTPS, including errors and HTTPS redirects, after customer-domain approval. Never accept a client-supplied policy.                   |

The inspected installed Helmet implementation enables HSTS by default (one year, includeSubDomains), uses SAMEORIGIN, and includes broad HTTPS/style-inline allowances in its default CSP. **This is existing API behavior, not the proposed HTML policy.** A future serving change must coordinate suppression/normalization of origin HSTS with edge activation; it must not simply remove a protection before its replacement is verified. No change is made here.

Identical nosniff/no-referrer values applied independently to different response classes are harmless. Repeated identical values on one wire response are unnecessary: future tests require a single effective value. Multiple CSP headers intersect rather than merge into a more permissive union; two writers can break login/workers. Conflicting cache directives, HSTS lifetimes/subdomain scope, frame restrictions or Content-Type are dangerous. Use explicit set/replace rules only within the declared owner's response class, not global append rules.

## 4. Cache policy

### HTML alternatives and decision

| Option                                | Evaluation                                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| no-store                              | **Required and recommended.** Do not retain shell responses in browser/shared HTTP caches. Consistent with ADR-030 and tenant/config deployment changes. The relatively small shell does not justify stale release references. |
| no-cache, must-revalidate             | Permits storage but requires validation before reuse; viable generally, but not the accepted Reqro shell contract. Validator/CDN behavior adds complexity without changing the existing no-store requirement.                  |
| Short freshness TTL plus revalidation | Creates a deliberate stale-shell window and mixed-release risk. Not recommended.                                                                                                                                               |

Use **Cache-Control: no-store** for /index.html, /, every approved SPA fallback, auth callback and tracking shell. No stale-while-revalidate, stale-if-error, negative cache, s-maxage or override TTL for them. This is HTTP caching behavior, not guaranteed clearing of an already open page, history entry, JavaScript memory, localStorage or a previously populated cache. Prior incorrectly cached shells need a reviewed migration/purge procedure. [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html) defines the storage/revalidation distinction.

### Exact response classes

| Class                                                                                                              | Proposed Cache-Control                                   | Edge behavior                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Successful public content-hashed JS/CSS/fonts/images and MapLibre worker from the verified release inventory       | public, max-age=31536000, immutable                      | Initially disabled until isolation evidence; later opt in only these actual successful file responses. Correct encoding variants and MIME required. |
| Nonhashed /branding assets, icons, favicon, logos and any future manifest                                          | no-store                                                 | Bypass; ADR-030 permits caching only immutable hashed public assets. Filename version numbers without enforced byte immutability are insufficient.  |
| HTML, tenant configuration and any future runtime-config response                                                  | no-store                                                 | Bypass. Build-time config changes require a coherent new release; API config remains no-store.                                                      |
| All /api and /api/* responses, including public GET, HEAD, OPTIONS and unknown API paths                           | no-store; protected content may retain private, no-store | Caching disabled for the entire namespace, independently of status, cookie, Authorization or query.                                                 |
| 400, 401, 403, 404, 429, 500 and other errors, including missing hashed assets, origin/admission/WAF/edge failures | no-store                                                 | No negative caching or stale tenant response on origin failure.                                                                                     |
| Redirects, including hostname/HTTPS/legacy navigation                                                              | no-store                                                 | No shared redirect cache. Only approved destinations; no reflected unvalidated Host or sensitive query propagation.                                 |

Only a real, release-inventoried static success qualifies for immutable. Do not configure /assets/* alone as unconditional proof: its missing-file errors, unexpected files and any protected response must remain no-store. Assets must be public and independent of credentials. Unknown query-bearing asset requests conservatively bypass edge caching; do not discard query parameters on dynamic routes. Compression must preserve correct Content-Encoding and representation selection.

No current public API GET was found with an approved shared-cache/invalidation contract. Catalog, intake/location, alerts and resident presentation depend on tenant/config state; public does not mean interchangeable. **No API cache exception is approved.** Browser request cache settings do not replace response headers; the general API client does not globally request no-store, while tracking does.

### Nonhashed resource inventory

All current public files live under /branding, copied unchanged:

- /branding/city-of-rockville-logo-circle.jpg.
- /branding/examples/example-organization.png and its README.md.
- /branding/reqro/reqro-{mark,logo}-{light,dark}.png, reqro-mark-transparent.png, reqro-favicon-{32,192,512}.png and favicon.ico.
- /branding/reqro/branding/reqro-wordmark-white-transparent.png and reqro-mark-transparent.png.
- /branding/reqro/hero/reqro-home-background.png.
- /branding/reqro/icons/ui/ui-theme-moon.svg; icons/actions/action-{water,report,emergency}.svg; icons/benefits/benefit-{responsive,residents,operations,community}.svg.
- /branding/reqro/README.txt and README-favicon.txt.

The text files are also copied public resources, not secret/private documentation; a future release inventory should decide whether to exclude them. No change here. No root manifest or runtime configuration file was found. Future tenant-uploaded branding requires a separate hosting/content/versioning contract before any immutable policy. The existing closed logo registry is not upload support; see [ADR-015](../architecture/decisions/ADR-015-product-organization-branding.md).

## 5. Hostname and tenant isolation

Cache eligibility is evaluated **after** exact deployment hostname admission. Cache identity must include the validated external HTTPS authority, deployment/environment boundary, exact asset path and supported representation variant. Never key solely on origin FQDN or path after rewriting. Use the existing trusted authority chain; no new tenant resolver or browser-selected Organization. Reject duplicate/ambiguous Host, unapproved ports, provider-default hosts and unknown hosts before cache lookup.

Even identical public asset bytes may not collapse customer cache namespaces. Separate customer origin groups and deployment scopes remain required by ADR-030/2B-0; aliases are explicitly inventoried. A hostname is a routing/cache partition input, not permission or evidence that a registry binding is active. Tenant-specific HTML/config, authenticated data, errors and redirects remain uncached, regardless of partitions.

CORS is not cache isolation. Vary: Origin or Vary: Host is not a substitute for a proven CDN cache key. Unknown-host denials must never expose a warmed customer's object. Do not cache binding failures, then reuse them after activation; do not serve stale tenant content after deactivation. A hostname leaving a deployment needs route removal and scoped cached-object retirement before reassignment.

Front Door caching starts disabled, as specified by 2B-0. [Microsoft's caching guidance](https://learn.microsoft.com/en-us/azure/frontdoor/front-door-caching) documents explicit cache behavior, query handling and purge limitations. The deployed hostname/deployment partition and effective rules must be demonstrated; no vendor default is assumed sufficient. If they cannot be proved, immutable edge caching stays disabled (browser immutable caching can still work).

## 6. SPA fallback and MIME contract

Order: validate host/method/path → reserve API namespace → exact permitted file → approved React route → real 404. Only GET/HEAD document navigation can reach the SPA shell. Accept: text/html never rescues a missing JS/CSS/image/font/manifest. Reject ambiguous encoded separators/dot segments, duplicate slashes and API-lookalike paths consistently with 2B-0.

The [router](../../react/src/app/router.jsx) currently declares /, /report, /track, /admin/:section?, /staff/requests, /staff/requests/:requestId, /staff/analytics/service-participation, /staff/ai, /issues, /issues/:issueId, /issues/:issueId/edit and /dashboard. It also declares /admin-preview, /ai-preview, /map-preview and three /pages/*.html compatibility routes. This inventory **does not approve every route for production**. The static implementation needs an explicit production subset with bounded parameter syntax; preview/legacy eligibility is unresolved. The React wildcard NotFoundPage is not permission for global server fallback.

Explicit legacy .html routes conflict with a simplistic extensionless-only rule: default to actual 404 unless separately approved as exact compatibility redirects/routes, preserving intended semantics without a blanket *.html fallback. No route changed here.

| Request                                                        | Required response                                                                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Approved React route                                           | Shell, text/html; charset=utf-8, no-store, HTML security policy. HEAD has the same headers/status and no body. |
| Existing release asset                                         | Exact bytes and correct MIME; cache policy by actual inventory.                                                |
| Missing JS/CSS/image/font/manifest, including a plausible hash | Real 404, no-store, nosniff; proposed bounded text/plain error. Never successful HTML.                         |
| /api/v1 and descendants                                        | API unchanged; JSON errors, no-store.                                                                          |
| /api and other /api/*, /api/v10, /api/v1evil                   | Non-HTML API/admission 404; never SPA fallback.                                                                |
| Unknown route or disallowed method                             | Real 404/405 as appropriate, no-store, safe error body.                                                        |

MIME map: JavaScript and worker .js/.mjs → text/javascript; CSS → text/css; JSON → application/json; WOFF/WOFF2 → font/woff and font/woff2; PNG/JPEG/WebP/AVIF → matching image type; SVG → image/svg+xml; ICO → image/vnd.microsoft.icon; HTML → text/html. Future web manifests use application/manifest+json. Use charset=utf-8 for text where appropriate. HTML error documents must be labelled HTML and receive their own inert CSP; JSON errors must never be labelled HTML. Do not serve arbitrary unknown extensions as executable types.

Require nosniff on successes and errors; it complements correct MIME, not file existence/status checks. [Fetch's nosniff rules](https://fetch.spec.whatwg.org/#x-content-type-options-header) explain script/style rejection, not a universal content-validation guarantee.

## 7. Browser external-origin inventory

Source inventory includes React, imported legacy modules, public assets, package imports, examples and retained legacy HTML; ignored environment values were not read. Configurable destinations cannot be enumerated as actual approved production origins without deployment inputs.

| Origin / source                                                                                     | Classification                                                              | CSP disposition                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Current page HTTPS origin, same-origin /api/v1 and /branding                                        | Required production first-party dependency                                  | self for specifically needed resource types; hostname deployment contract applies.                                                                                                                           |
| https://login.microsoftonline.com                                                                   | Required external dependency **only when optional Entra is enabled**        | Proposed exact connect-src and conditional frame-src source; Microsoft-hosted top-level sign-in/logout navigation. Final tenant/cloud/redirect trace still required.                                         |
| Microsoft discovery/federation/tenant-specific destinations not fixed in Reqro source               | Unresolved                                                                  | Record actual supported deployment flow; no *.microsoft.com, arbitrary https: or assumed identity CDN allowances. Resources inside Microsoft's document are governed by that document, not Reqro script-src. |
| .env.example localhost:3000 API; localhost:5173 / 127.0.0.1:5173 tooling and Vite HMR websocket     | Development/test-only                                                       | Reject in production build/policy/response; no production HTTP/WS wildcard.                                                                                                                                  |
| https://cdn.jsdelivr.net in root index.html and pages/dashboard.html (Bootstrap icons and Chart.js) | Legacy/demo-only; should remain self-hosted for React production            | These are not react/index.html dependencies. React uses package imports; do not import legacy CDN allowances into its policy.                                                                                |
| Configured issue external redirects / published home external HTTPS links                           | Unresolved per-deployment navigation destinations, not fetched subresources | Governed destination validation and no-referrer; no connect-src/img-src expansion merely for links. tel: links are OS navigation, not an external fetch origin.                                              |
| Legacy Firebase initialization uses environment-provided project/auth/storage settings              | Legacy-only scaffold; no React import of Firebase initialization found      | No literal project origin established and no production Firebase allowance. Installed dependency alone proves no network requirement.                                                                        |
| Map style/tile/glyph/sprite service                                                                 | None currently referenced by the two map consumers                          | Future provider/hosting/privacy decision; public demo services are not approved dependencies.                                                                                                                |
| Attachment/object-storage/signed-URL host                                                           | None currently used by the browser attachment path                          | Future separate approval; no arbitrary https: images or blob-storage domain wildcard.                                                                                                                        |
| blob: and data: images                                                                              | Local URL schemes, not remote origins                                       | Narrow img-src allowances justified below; never use them as general script/connect/worker allowances.                                                                                                       |
| XML namespace http://www.w3.org/2000/svg in SVG/data CSS                                            | Identifier, not browser fetch                                               | No network allowance.                                                                                                                                                                                        |

No Google Fonts, external script CDN, external font CDN, public map resource or service worker was found in the current React resource path. This is a source finding, not a complete authenticated network trace. Release/browser inventory must catch transitive SDK behavior and future configuration.

## 8. CSP candidate and compatibility gates

**Candidate for controlled Report-Only evaluation, not an enforcement-ready configuration.** Base profile without Entra:

```text
default-src 'none';
script-src 'self';
script-src-attr 'none';
style-src 'self';
style-src-elem 'self';
style-src-attr 'none';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self';
worker-src 'self';
frame-src 'none';
frame-ancestors 'none';
object-src 'none';
base-uri 'none';
form-action 'self';
manifest-src 'none';
media-src 'none';
```

For the current Entra-enabled shell, replace connect-src with `'self' https://login.microsoftonline.com`, frame-src with `'self' https://login.microsoftonline.com`, and frame-ancestors with `'self'` pending the callback review in section 10. Do not send duplicate versions of a directive. Entra-disabled deployments need no identity-origin allowance. A future verified manifest can change manifest-src to self; none exists now.

| Directive                                   | Repository reason / outstanding evidence                                                                                                                                                                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| default-src / script-src / script-src-attr  | Deny unlisted fetches; bundled external modules and lazy chunks same-origin; no executable inline bootstrap required by current HTML. React event handlers are not HTML onclick strings. No unsafe-eval, unsafe-inline, script data/blob, wildcard or arbitrary HTTPS source approved. |
| style-src / style-src-elem / style-src-attr | Packaged CSS is same-origin. React style props, positioned menus, Chart.js and MapLibre make runtime style writes; those require production-browser evidence, not a blanket claim of incompatibility or compliance.                                                                    |
| img-src                                     | Same-origin branding; trusted CSS contains data:image/svg+xml (also Bootstrap styles); attachment preview uses API-fetched blob URLs. These allowances are limited to images. Evaluate removing unused allowances for a narrower deployment only with UI evidence.                     |
| font-src                                    | Packaged Bootstrap icon fonts; verify release output does not inline a font before enforcing self-only. No external font source found.                                                                                                                                                 |
| connect-src                                 | API same-origin; Entra authority only for enabled auth profile. Map source objects are in-memory, not external style URLs. No frontend telemetry/reporting endpoint currently approved.                                                                                                |
| worker-src                                  | Explicit bundled same-origin MapLibre worker. No current need for blob: or data: workers.                                                                                                                                                                                              |
| frame-src / frame-ancestors                 | Child-frame destinations and who may embed Reqro are different controls; handle silent MSAL separately from municipal portal embedding.                                                                                                                                                |
| object-src / base-uri                       | No plugin/object embed or base element required. Deny both.                                                                                                                                                                                                                            |
| form-action                                 | Same-origin target ceiling. React forms submit via application logic; governed external links/MSAL top-level redirects are not form posts. Test submit handlers and auth failures before enforcement.                                                                                  |
| manifest-src / media-src                    | No installed PWA or audio/video player requirement found; deny. Image file capture is not a media-src load.                                                                                                                                                                            |

This is a host-based CSP, not proof of protection against compromised same-origin scripts. Keep uploaded active content off the application executable namespace. No nonce is currently needed for the static entry; if a future inline block is unavoidable, review exact build hashes or secure per-response nonces. A fixed reusable nonce is not an acceptable solution. Do not introduce broad allowances to silence unexplained reports.

Style review must distinguish literal style attributes / setAttribute or injected style elements from individual CSSOM property assignments. Seeing `style={...}` in source does not itself prove unsafe-inline is needed. Inspect actual browser violations and rendering (including menus, maps, theme, charts and responsive layout); prefer equivalent external classes for fixed styles in a separately authorized UI-preserving change. If an unavoidable attribute exception remains, it needs explicit security approval, scope and tests; none is approved here. Do not add unsafe-eval for CSSOM or copy Helmet's style defaults.

CSP header processing and Report-Only behavior follow [CSP Level 3](https://www.w3.org/TR/CSP3/). Worker creation permission does not by itself govern all worker-internal fetches: the static layer must review the worker script's own response CSP against its emitted imports/data use, without copying DOM/frame directives blindly.

## 9. MapLibre, images and attachments

[Resident map](../../react/src/residentIntake/ServiceLocationMap.jsx) and [map preview](../../react/src/map/CityVUEMap.jsx) both import maplibre-gl-worker.mjs?worker&url and call setWorkerUrl. Their style objects contain GeoJSON with background/fill/line/circle layers; neither declares a tile URL, glyph endpoint, sprite URL or external style. [Location search](../../react/src/residentIntake/locationSearch.js) uses synthetic locations obtained through the API/local data, not a browser geocoder.

**Recommendation: worker-src self**, retaining bundled worker delivery. Installed MapLibre's same-origin branch creates the worker directly; its cross-origin path can create a blob worker. The [MapLibre v6 guide](https://maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide/) confirms that self-hosted workers avoid that blob requirement. Do not switch to a CDN worker to work around packaging. Verify actual worker URL/imports, MIME, missing-file behavior and its response policy in production build tests.

WebGL2 availability is a device/browser requirement for MapLibre v6, not justification for camera, gyroscope, accelerometer or fullscreen permission. Existing NavigationControl has no FullscreenControl. Preserve the map's context-loss/error handling, manual location/search alternatives and explicit user geolocation. Real production maps/geocoding still require provider, licensing, availability, exact style/tile/glyph/sprite origin and location-disclosure approval; no public MapLibre demo origin is approved.

[Attachment repository](../../react/src/attachments/attachmentRepository.js) fetches authorized API images; [UI](../../react/src/attachments/Attachments.jsx) creates/revokes object URLs. There is no browser signed-object URL or direct object-storage fetch. JPEG/PNG/WebP validation and private,no-store downloads remain separate server protections. img-src blob: preserves these previews; connect-src stays self. data: images support inspected static CSS, not a new attachment data-URL pipeline.

Production storage/scanning remains blocked under [ADR-010](../architecture/decisions/ADR-010-secure-attachment-architecture.md). A future signed URL is credential-bearing and needs expiry, authorized issuance, referrer/log/report privacy, origin restrictions and cache review. It must not be added to HTML/runtime logs or a shared cache. Future external images/tenant assets need exact origins and content validation; an arbitrary https: image source is rejected. CSP is not malware scanning or attachment authorization.

## 10. MSAL, framing and referrer policy

[MSAL config](../../react/src/auth/msalConfig.js) uses the explicit Microsoft authority, same-origin / for login and post-logout redirect, and SessionStorage. [AuthContext](../../react/src/auth/AuthContext.jsx) uses loginRedirect, logoutRedirect and acquireTokenSilent; no popup or explicit ssoSilent call was found. Tokens go to the same-origin API through the existing token provider, not to an enterprise destination.

Silent acquisition is not always a cache-only operation: the [Microsoft token-lifetime guidance](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/token-lifetimes) describes refresh and hidden-iframe fallback. The installed library also contains this path. Thus frame-src none and frame-ancestors none on the current / callback cannot be declared compatible just because interactive sign-in uses top-level navigation.

**Proposed framing disposition:**

- No externally embedded municipal portal requirement exists. Never allow arbitrary ancestors or a municipality wildcard.
- Entra-disabled SPA, tracking shell, API and error documents: frame-ancestors 'none' plus X-Frame-Options: DENY.
- Current Entra-enabled application shell/callback: frame-ancestors 'self' plus X-Frame-Options: SAMEORIGIN is the bounded candidate preserving same-origin silent callback loading; frame-src admits only self and the exact Microsoft authority.
- Prefer a separately reviewed minimal callback page if the supported MSAL version/flow can isolate this requirement; then ordinary pages can deny framing and only that callback retains self. No callback is created here. Do not allow Microsoft as a frame ancestor merely because Reqro loads a Microsoft child frame.
- A different callback/flow choice, popup flow or client-specific federation requires fresh evidence and authorization, not a CSP-only workaround.

The full SPA currently loads on /. This makes router/hash handling, nested AuthRoot startup and silent callback completion an explicit compatibility blocker. Exercise successful login, cancellation, logout, expired access and refresh tokens, denied consent, hidden iframe return, browser third-party-cookie restrictions and direct callback navigation using synthetic/personal-authorized identity. Prove bounded reauthentication without loops or blank pages. [Microsoft's MSAL error guidance](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/errors) warns about router and callback interference. Never proxy Microsoft credentials or relax script-src to load Microsoft's account chooser inside Reqro.

Recommend **Referrer-Policy: no-referrer everywhere**, including redirects and errors. It matches the existing HTML meta and [tracking session](../../react/src/tracking/trackingSession.js), which removes the fragment before routing and sends the credential in a dedicated header. Do not introduce a query-token flow. Compared with strict-origin-when-cross-origin, no-referrer also avoids same-origin path/query disclosure through Referer. The [Referrer Policy specification](https://www.w3.org/TR/referrer-policy/) defines this behavior.

Reference/search URLs, signed URLs and sensitive query values still need minimization: no-referrer does not sanitize destination URLs, browser history, CSP reports or server/edge logs. Existing tracking noindex/nofollow remains a complementary control. No route needs weaker referrer treatment for analytics or external redirects.

## 11. Permissions Policy

Proposed document policy, subject to target-browser tests:

```text
geolocation=(self), camera=(self), microphone=(), payment=(),
fullscreen=(), clipboard-read=(), clipboard-write=(self),
accelerometer=(), gyroscope=(), magnetometer=(), usb=(), serial=(),
hid=(), display-capture=(), publickey-credentials-get=()
```

| Capability                                             | Evidence and decision                                                                                                                                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Geolocation                                            | ServiceLocationInput uses explicit getCurrentPosition. Keep self with browser consent and manual fallback; never enable for third-party frames or infer residence/tenant authority.                            |
| Camera                                                 | Attachment input uses accept=image/* and capture=environment. Keep a bounded self candidate to preserve mobile photo capture pending device tests. No getUserMedia/live camera stream was found or authorized. |
| Microphone                                             | No audio capture; deny.                                                                                                                                                                                        |
| Payment / fullscreen                                   | No payment or Fullscreen API consumer; deny. Map canvas rendering is not fullscreen.                                                                                                                           |
| Clipboard                                              | RequesterTracking copies the link using navigator.clipboard.writeText on user action. Keep write for self; no clipboard read need found. Retain gesture/secure-context requirements.                           |
| Accelerometer / gyroscope / magnetometer               | No consumer; deny. Map rotation/compass UI does not justify physical sensor access.                                                                                                                            |
| USB / serial / HID / display capture / direct WebAuthn | No Reqro consumer found; deny. Microsoft sign-in is a separate top-level document and keeps its own capabilities.                                                                                              |

HTML file capture and MediaDevices are different mechanisms; do not claim camera=() necessarily blocks or preserves every browser's file chooser. A tighter camera=() may be selected only after mobile capture evidence proves no regression; camera self here reflects the existing photo workflow, not approval for live video. [HTML Media Capture](https://w3c.github.io/html-media-capture/) defines the input feature. [Permissions Policy](https://www.w3.org/TR/permissions-policy/) provides the allowlist model; feature/browser support varies, so unsupported directives are not enforceable protections. Do not emit fictitious WebGL directives.

Navigation within the SPA retains the original document policy. Do not rely on server route-specific geolocation/clipboard headers changing during client-side navigation; either use this bounded shell-wide policy or prove an explicit document boundary. API/edge error documents need none of these capabilities and can deny them all.

## 12. HSTS and error policy

Public HSTS belongs to the edge on approved HTTPS hosts. **Proposed staged domain-only rollout:** max-age=300 in authorized controlled validation, then 86400, then 31536000 after owner-approved TLS/renewal and rollback evidence. These are review candidates, not enacted durations. No includeSubDomains or preload by default. Every HTTPS response, including edge-generated failure, must use the single approved value; HTTP responses do not establish HSTS.

includeSubDomains affects descendants of the served hostname, not only Reqro endpoints. A client-owned apex can cover unrelated departmental/vendor systems. Require domain-owner inventory, HTTPS support and explicit approval before expanding scope. Existing parent preload/HSTS may already apply; inspect it before launch. Lowering max-age does not reach offline clients immediately. Certificate expiry under HSTS is an availability incident, not grounds to permit HTTP.

Preload is a separate long-lived browser-list decision; do not submit a customer's domain or add the token casually. [RFC 6797](https://www.rfc-editor.org/rfc/rfc6797.html) defines HSTS scope; [the preload operator](https://hstspreload.org/) describes eligibility and removal implications. Reqro does not own all customer subdomains.

All 400/401/403/404/429/500 and gateway errors receive no-store, nosniff and no-referrer; JSON errors stay JSON. Safe generated HTML errors use default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none', DENY and denied permissions, with no inline executable content or reflected request/tenant values. Preserve safe authentication/rate-limit headers as applicable; do not expose stacks or retry secrets.

Provider-generated WAF/TLS/platform failures may not support every custom header/body. Their controllability is **unresolved**, not passed: capture exact response behavior, require no sensitive reflection/no cross-tenant cache, and obtain review for unavoidable provider limits before readiness. TLS failures before HTTP cannot carry HTTP headers. No error may fall back to another tenant/origin or stale API data.

## 13. Rollout, reporting and development separation

1. Freeze the release resource/route inventory and approved hostname/auth/map/asset inputs.
2. Generate explicit production candidate policy; reject localhost, loopback/IP development origins, HMR ws/wss, wildcards, broad HTTPS sources and unsafe script allowances. A production-optimized demo build is not a client release.
3. Separately authorize a controlled static/edge environment with synthetic data and CSP Report-Only. Report-Only is observation, not protection. Baseline enforced framing/nosniff/referrer controls require their own compatibility checks.
4. Prefer local sanitized browser violation capture initially. No CSP reporting endpoint or third-party collector is currently approved. Raw reports can carry document/referrer/blocked URLs, paths, queries and samples; omit report-sample. Receiver-side redaction alone does not prevent collection at intermediaries.
5. Before remote reporting, approve destination, bounded receive/body/rate/queue limits, no raw access-log query capture, sanitization-before-retention, retention/access/incident owners and abuse handling. Never route CSP reports through F061 by assumption. Use only synthetic sessions until privacy is proven.
6. Classify each violation as required resource, defect, malicious/unexpected input, extension noise or unsupported behavior. Do not auto-allowlist reports. Fix or explicitly approve the smallest necessary exception in a separately authorized slice.
7. Enforce only after browser regression evidence and security/identity owners accept the exact policy; retain a reviewed restrictive rollback version.
8. Keep release artifact and real-response tests. Policy rollback must not silently add unsafe-inline, unsafe-eval, wildcard origins or arbitrary customer embedding.

Vite HMR, dev injected styles/websockets and local API origins remain development-only. Do not attach the production policy to the Vite development server as part of this assessment. Future policy generation should fail closed on development values instead of “temporarily” shipping them. No service worker/offline fallback is proposed.

## 14. Deployment visibility and rollback

Publish a complete immutable release asset set before switching shell traffic. New no-store HTML references new hashed bytes; never overwrite bytes behind an existing immutable URL. Retain old assets long enough for active tabs, lazy imports and the approved rollback window, with a named release owner deciding retention. A new request for an old lazy chunk must still work; browser cache alone is insufficient because the chunk may never have been fetched.

Retain previous HTML plus all referenced assets as a coherent rollback artifact. Rolling replicas must serve the union of supported old/new asset sets or an equivalently proven version-routing design. Switch the shell/config atomically per deployment; no cross-tenant fallback. No-store refreshes the next shell request but cannot force an open tab to load a new release; an update UX would be separate work.

Tenant API configuration remains no-store. Packaged nonhashed branding remains no-store; future versioned URLs may qualify for immutable only with a byte-stability contract. Do not depend on global CDN purge for ordinary hashed-asset releases. Purge is exceptional for previously miscached mutable content or compromised assets, scoped to the approved deployment/domains; document propagation and browser-cache limits. A CDN purge cannot erase a browser's immutable copy or revoke data already disclosed. Required release/policy rollback must be tested without a security downgrade.

## 15. Future automated security test matrix

These are acceptance requirements, **not tests run in this assessment**.

| Surface                       | Required assertions                                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML and SPA routes           | /, /index.html, /track, approved direct deep links and callback: no-store, correct HTML MIME, exactly one effective policy set; GET/HEAD parity; no stale shell during rollout/rollback.                                                                |
| Hashed assets                 | Actual build inventory and references; content hash changes with bytes; successful JS/CSS/worker/fonts/images get one-year immutable; unknown files cannot gain immutable solely by path/regex.                                                         |
| Nonhashed resources           | Every public-directory asset, favicon and any future manifest/runtime config follows no-store; tenant branding updates visible on a new request.                                                                                                        |
| APIs                          | Anonymous catalog/presentation, authenticated staff, tracking and attachment responses no-store; no edge hits regardless of method/auth/query; API 404 never HTML.                                                                                      |
| Errors                        | 400/401/403/404/429/500, body/parser/tenant/guard failures and origin outage all no-store; missing hashed paths never cache an error; no tenant-context reflection.                                                                                     |
| Fallback                      | Missing JS/CSS/image/font/manifest returns real 404 even with Accept:text/html and plausible hash; /api namespace, encoded ambiguities and non-GET methods never become shell.                                                                          |
| CSP                           | Present on HTML in correct Report-Only/enforcement phase; exact approved sources only; forbidden wildcard/unsafe/development sources absent; lazy import and worker response policy compatible.                                                         |
| Browser behavior              | Map worker and rendering, theme/icons/fonts, positioned menus/charts, photo chooser and blob previews, location consent/denial/manual input, clipboard copy and protected workflows preserved.                                                          |
| Identity                      | Redirect login/logout/cancel; cold login; cached/expired tokens, refresh-token expiry/hidden iframe, cookie restrictions and callback error paths; no loops, no credential leakage.                                                                     |
| Framing                       | External frame denied; same-origin callback permitted only by reviewed profile; nonauth/tracking/error DENY; matching X-Frame-Options and frame-ancestors.                                                                                              |
| Referrer/permissions          | Synthetic sensitive URL never appears in Referer to same/third-party endpoint; required location/copy/capture works; unused APIs denied where browser supports it.                                                                                      |
| MIME/nosniff                  | JS, CSS, JSON, worker, fonts, images and HTML/plain errors correct; no missing JS accepted as valid document/script; encoding variants correct.                                                                                                         |
| Host cache isolation          | Warm tenant A then same paths under B and unknown/default host, in both orders; repeat aliases, queries, errors and redirects. Body/headers/config never cross; host removal/reassignment cannot reuse stale tenant content. Use synthetic deployments. |
| Header owners                 | Exactly one effective CSP/HSTS/cache/MIME value; no origin HSTS leaks through; edge, admission and API generated failures checked independently.                                                                                                        |
| Edge evidence                 | Actual AFD rules/key behavior, cache hit/miss, no-store bypass, disabled nonstatic caching, WAF/edge errors, domain-only HSTS and private-origin failure behavior where testable. Unobservable cases remain blockers.                                   |
| Release safety/report privacy | Coherent old/new lazy chunks and rollback; sanitized synthetic CSP violations only; no sample, raw token/query or private path retained/exported.                                                                                                       |

Local static/container tests can validate classification and policies without production credentials. Full chain/cache isolation and identity tests need separately authorized controlled deployment/identity resources. A successful localhost run cannot certify Front Door or a customer's hostname.

## 16. Production blockers and smallest follow-up slices

| Blocker / decision                                   | Owner and exit evidence                                                                                                                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static-serving technology and artifact contract      | Application/infrastructure: approve server/image, exact-file allowlist, MIME handling, fallback parser, worker policy, atomic release/rollback and asset retention. None selected here.       |
| Public hostname set and isolation                    | Domain/infrastructure/security: exact canonical/aliases, one deployment boundary, trusted authority and cross-host cache/bypass tests from 2B-0.                                              |
| API universal no-store and header ordering           | API/security: separately scoped bootstrap/early-error coverage and regressions; current route decorators are not sufficient proof.                                                            |
| CSP dynamic styles and packaged output               | Frontend/security: actual production browser evidence and any approved minimal remedies without altering accepted UI. No broad style exception approved.                                      |
| MSAL callback/framing/origin inventory               | Identity/frontend/security: exact public redirect/logout registration, authority/cloud/federation behavior and cold/expired-token evidence; decide minimal callback vs current root behavior. |
| Production maps                                      | Product/privacy/infrastructure: choose whether synthetic map is disabled or replaced; approve map/geocoder/tile/glyph/sprite providers and exact resource origins.                            |
| Tenant branding and attachments                      | Product/security/storage: approved packaged branding scope; upload/storage/scanning and signed-URL policy remain separately gated.                                                            |
| CSP reporting                                        | Privacy/security/operations: choose local-only evidence or approved bounded sanitized destination/retention; no unreviewed third party.                                                       |
| Front Door rules/cache ownership and provider errors | Infrastructure/security: prove effective hostname/deployment keys, response coverage, no accidental error/redirect caching and no origin bypass.                                              |
| HSTS customer policy                                 | Domain/security/operations: confirm parent policy, safe lifetime/renewal/incident ownership; explicit subdomain/preload decision.                                                             |
| Production route exposure                            | Product/security: explicit SPA subset, preview/legacy decisions, /api/docs exposure and compatibility redirects; no global fallback.                                                          |
| Browser acceptance and operations                    | Product/release: supported browser/device matrix, geolocation/capture/clipboard/framing evidence and owners for rollback, alerts and cache incidents.                                         |

Recommended sequence, each requiring separate approval:

1. **F060.4A-2C-1 — Static cache/header foundation.** Approve static server and route inventory; implement no-store/immutable classification, MIME/nosniff/referrer/permissions/framing with local response tests. Include a separately delineated API no-store/header-ownership sub-slice in its review so a static-only change cannot falsely claim API coverage. No cloud activation.
2. **F060.4A-2C-2 — CSP Report-Only foundation.** Approved production profile generation, map/style/auth inventory tests and sanitized controlled observation; resolve callback/compatibility blockers. No third-party report export by default.
3. **F060.4A-2C-3 — CSP enforcement and regression tests.** Only after accepted Report-Only evidence; explicit policy, identity/mobile/map tests and reviewed rollback.
4. **F060.4A-2C-4 — Edge/CDN cache-isolation evidence.** Coordinate with authorized 2B implementation; verify response ownership, hostname partitions, customer HSTS and generated failures in a separately approved environment before enabling any CDN caching. No production launch implied by earlier slices.

**Recommendation: do not activate production cache/CSP/header enforcement from this assessment.** ADR-030's no-store/tenant-isolation requirements are retained; the candidates here make implementation reviewable but do not close the source/runtime/infrastructure blockers. No defect elsewhere was fixed, no ADR allocated and no following slice begun.

## 17. Assessment validation and handoff

Documentation-only validation consists of relative Markdown link/anchor checks, heading uniqueness/reference checks, whitespace/control-character checks, explicit Prettier formatting/check/idempotence, git diff --check and one-file scope with an empty index. Since the file is untracked, inspect its bytes directly as well; a clean ordinary git diff alone does not validate an untracked file.

Validation: all 35 relative Markdown links resolve; 21 heading anchors are unique; all 17 numbered sections and prose section references resolve. Whitespace/control-character checks, explicit Prettier check and byte-for-byte formatting idempotence pass. git diff --check passes; direct inspection covers the untracked file. Exactly one untracked document, zero tracked changes and an empty index remain at the starting HEAD, 0 ahead / 0 behind the local origin/main reference.

Application builds/suites, database suites, browser UAT and cloud tests are not required or run for this assessment. Source/default build-template inspection is not a new build result. No staging, commit, push or deployment occurred.

**STOP FOR F060.4A-2C-0 SECURITY / ARCHITECTURE REVIEW.**
