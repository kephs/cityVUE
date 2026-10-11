# F060.4A-2C-2-0 — CSP Compatibility & Report-Only Transition Readiness

Status: **Design only; proposed for security / architecture review. Production Report-Only activation and enforcement changes are NOT ready.** Assessed 2026-10-11.

**Preserve the existing enforcing CSP. Never replace it with Report-Only merely to collect evidence. No header, runtime, identity, infrastructure, dependency or telemetry behavior changes in this slice.**

## 1. Baseline, scope and evidence

Created isolated branch `codex/f060-4a-2c-2-0-csp-readiness` from freshly fetched `origin/main`, exact starting SHA `b7bbe83f01ba253d996ed5a35807166c8cb35202`. HEAD and origin/main matched; tree/index were clean, 0 ahead / 0 behind. Fetch succeeded with an unrelated stale-worktree cleanup permission diagnostic; no repair was attempted. Claude's concurrent F062 work is outside scope.

Only this new document is authorized. No existing F060 document, server/React source, Vite configuration, package, F061/F062, integration, migration, database role/grant/function, deploy or operator file is changed. No ADR is allocated.

Authorities: [protocol](../development/REQRO_CODEX_PROTOCOL.md), [architecture](../ARCHITECTURE.md), [security framework](../security/SECURITY_FRAMEWORK.md), [ADR-030](../architecture/decisions/ADR-030-production-serving-contract.md), [2C-0 assessment](F060-4A-2C-0-cache-browser-security-policy-readiness.md) and [2C-1A foundation](F060-4A-2C-1A-api-cache-header-preservation-foundation.md). Earlier 2C-0 wording about starting with Report-Only does not authorize dropping existing enforcement; source and the explicit preservation requirement govern.

Evidence levels: **proven source/build** means inspected code or generated artifacts; **inferred** means an expected browser consequence needing UAT; **unresolved** means no production/browser evidence establishes it. No live deployment, municipal account, authenticated browser session or reporting collector was exercised. Installed dependencies were inspected read-only; a local ignored dependency junction supported the build without installation.

## 2. Current ownership and exact policy

[Bootstrap](../../server/src/bootstrap.ts) registers uncustomized `helmet()` after the API cache default. Server lockfile pins Helmet 8.3.0. Inspecting that version's middleware output and the existing [HTTP regression assertions](../../server/test/e2e/api-cache-headers.e2e.test.ts) establishes this exact default header:

```text
default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests
```

These are inherited Helmet defaults, not a Reqro-specific resource allowlist. The current attachment download controller deliberately replaces the header with `default-src 'none'; sandbox`, alongside `private, no-store`, attachment disposition and nosniff; see [attachment controller](../../server/src/attachments/attachment.controller.ts). Preserve this response-specific policy.

Nest owns its API/document responses, including Swagger at /api/docs. It does not serve the React shell. [React HTML](../../react/index.html) has no CSP meta; [Vite](../../react/vite.config.mjs) sets no CSP headers; [historical Firebase configuration](../../firebase.json) declares no CSP. This proves repository configuration, not the absence of independently configured live edge headers. **Do not claim the React document currently receives Nest's policy.**

ADR-030 assigns future React HTML/static and worker response headers to approved static serving, API headers to Nest, and edge-generated documents to their generating layer. One owner produces each complete policy; edge pass-through must not append competing enforcement. Static serving remains unimplemented. Current HSTS `max-age=31536000; includeSubDomains`, X-Frame-Options SAMEORIGIN, nosniff and no-referrer remain intact. Helmet also emits COOP same-origin, relevant to a future auth bridge; no change is proposed here.

| Directive                 | Exact current value           | Apparent reason and dependency evidence                                                                                                    | Production disposition                                                                                |
| ------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| default-src               | 'self'                        | Helmet fallback. Same-origin scripts, CSS, API and assets are proven source/build needs; absent fetch directives inherit this restriction. | Retain conservative fallback; SPA compatibility unresolved for Entra/blob images.                     |
| base-uri                  | 'self'                        | Limits base URL substitution. No base element found in modern entry.                                                                       | Protective, not a required resource. Preserve; later 'none' needs review.                             |
| font-src                  | 'self' https: data:           | Self-hosted Bootstrap Icons proven. Broad schemes inherited; no modern external/data font dependency found.                                | Self proven; https/data tightening candidates, not approved removals.                                 |
| form-action               | 'self'                        | Constrains form submissions. Application mutations use fetch; current MSAL defaults to GET navigation.                                     | Preserve. No proven external form need for configured flow.                                           |
| frame-ancestors           | 'self'                        | Embedding protection; same-origin auth callback may be framed during silent flow.                                                          | Same-origin protection remains; callback compatibility unresolved.                                    |
| img-src                   | 'self' data:                  | Local branding and CSS SVG data images proven. Attachment blob images also proven in source, but blob is not explicit here.                | Not established as sufficient for SPA; blob compatibility is a blocker.                               |
| object-src                | 'none'                        | No modern object/embed plugin consumer found.                                                                                              | Protective production restriction; preserve.                                                          |
| script-src                | 'self'                        | Vite emits same-origin external JS, dynamic chunks and worker asset. No authored eval or inline executable entry found.                    | Supported by current app path; library optional loaders and auth UAT remain review items.             |
| script-src-attr           | 'none'                        | No string HTML event attributes in modern entry. React handlers are JS listeners, not HTML onclick strings.                                | Preserve; no exception established.                                                                   |
| style-src                 | 'self' https: 'unsafe-inline' | Self CSS proven. Broad sources inherited; runtime style operations need classification below.                                              | No proof that broad https or unsafe-inline is essential to current production SPA. UAT gates removal. |
| upgrade-insecure-requests | empty directive value         | Helmet default; no app-specific enabling decision found. ADR-030 requires HTTPS.                                                           | Preserve as defense in depth, not a repair for insecure dependencies or a substitute for HSTS.        |

No connect-src, worker-src, frame-src, manifest-src, media-src, child-src, report-uri, report-to, Trusted Types or Report-Only configuration exists in the inspected app policy. A missing directive is not automatically permission: fallback rules apply.

## 3. Inline styles and external CSS

Authored React scan found **12 JSX style props in nine files**:

| Source under react/src                                             | Count  | Classification                                                                                                                      |
| ------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| admin/AccessActions.jsx; admin/IssueResults.jsx                    | 1 each | Active dynamic menu positioning. Preserve layout; CSS refactor is separate scope.                                                   |
| admin/FollowUpQuestions.jsx; admin/IssueHandling.jsx               | 1 each | Active wrapping rules; plausible class extraction candidates.                                                                       |
| pages/report/DynamicQuestion.jsx; pages/report/ReportIssuePage.jsx | 2 each | Active intake wrapping/preformatted content and display sizing. Static rules may be removable into CSS; dynamic values need review. |
| staff/requests/SubmittedInformation.jsx                            | 2      | Active wrapping/plain-text presentation; class extraction candidate.                                                                |
| staff/ServiceParticipationPage.jsx                                 | 1      | Active wrapping; class extraction candidate.                                                                                        |
| pages/dashboard/DashboardPage.jsx                                  | 1      | Legacy-data dashboard still routed/bundled in modern shell; variable chart height. Not dead HTML.                                   |

Additional imperative styles: IssueDrawer saves/sets/restores body overflow; DashboardChart updates the cursor. MapLibre sets marker transforms/opacity, canvas sizing and control properties; Chart.js sizes/styles canvas; MSAL's hidden iframe sets individual visibility/position/size/border properties.

**Inline-looking DOM output does not prove a need for unsafe-inline.** Inspected React DOM 19.2.8 `setValueForStyle` uses individual property assignment / setProperty. CSP distinguishes these CSSOM operations from literal style attributes, setAttribute('style', ...) and cssText; see [MDN style-src-attr](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src-attr). The inspected MapLibre/Chart.js/MSAL paths likewise use property setters. These are active runtime requirements, but the requirement for the CSP keyword remains **unproven**. Do not remove the keyword on this evidence alone: test browsers, every route, libraries and dynamic menus/markers first.

No authored CSS-in-JS framework, style-element injection or cssText/setAttribute-style call was found in react/src. Bootstrap and Bootstrap Icons enter via package CSS imports in [main.jsx](../../react/src/main.jsx); MapLibre CSS is package-imported. Production emits external CSS. Vite development injects style elements with textContent for HMR: **development-only**, not a production allowance. Root legacy dashboard HTML has seven literal style attributes: **legacy-only**, still available through explicit rollback tooling, not the active React entry.

No external stylesheet tag/import was found in the modern React app or generated CSS. `style-src https:` currently permits any HTTPS stylesheet because it is a Helmet default, not because an approved stylesheet host was found. Removal is a candidate only after production document/header ownership and runtime/UAT evidence. Keep existing enforcement untouched.

## 4. Fonts, images, branding and external origins

| Resource            | Evidence and classification                                                                                                                                                       | CSP consequence                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bootstrap Icons     | Local package font-face; build emits two same-origin WOFF/WOFF2 files.                                                                                                            | font-src self is proven. No modern HTTPS/data font found.                                                                                                         |
| Text fonts          | Bootstrap system font stack; retained legacy CSS names Inter/Segoe UI/Roboto without downloading them.                                                                            | A font-family name is not a network dependency. No Google Fonts loader found.                                                                                     |
| Branding/icons      | [ReqroBrand](../../react/src/branding/ReqroBrand.jsx), [presentationPolicy](../../react/src/pages/home/presentationPolicy.js): local /branding paths and fixed logo key registry. | img-src self supports current sources; future uploads/CDN hosts remain separately gated.                                                                          |
| CSS images          | Bootstrap/MapLibre and two admin CSS declarations contain data SVG images; generated CSS confirms them.                                                                           | img-src data: has a concrete current dependency. This does not justify font-src data:.                                                                            |
| Attachment previews | [Attachments.jsx](../../react/src/attachments/Attachments.jsx) fetches authorized blobs, creates object URLs, renders img and revokes URLs.                                       | Candidate must explicitly assess img-src blob:; do not assume self interoperably covers it. Current API CSP on image responses is not the parent document policy. |
| Downloads           | Same component creates a blob URL and download anchor; server download response has its own restrictive CSP/disposition.                                                          | Test navigation/download behavior independently; img-src does not govern the entire download flow.                                                                |
| Maps                | Current style objects contain local GeoJSON, background/fill/line/circle layers, not external tile/style/glyph/sprite URLs.                                                       | No map host is approved. Final production imagery/glyph/sprite hosting remains unresolved.                                                                        |
| Microsoft           | Configured authority is https://login.microsoftonline.com plus deployment tenant path; MSAL network client uses fetch.                                                            | Conditional connect/frame needs for enabled workforce identity; not script/CSS/font permission.                                                                   |
| External actions    | Validated HTTPS links and telephone links; no embedded municipal portal found.                                                                                                    | Navigation is distinct from connect-src and resource loading. Preserve existing link validation and privacy.                                                      |
| jsDelivr            | Root index and legacy dashboard reference Bootstrap Icons; dashboard loads Chart.js externally.                                                                                   | Legacy-only HTML dependencies; do not add this origin to modern CSP.                                                                                              |

The modern build has no external stylesheet or script tags. String references in JS include documentation/error URLs and library fallback values, so a URL grep is not an outbound request inventory. No arbitrary external image origin was found in the authored modern components. Build output and source are not proof of future tenant configuration or runtime third-party requests.

## 5. MapLibre worker, rendering and optional loaders

Both [ServiceLocationMap](../../react/src/residentIntake/ServiceLocationMap.jsx) and [CityVUEMap](../../react/src/map/CityVUEMap.jsx) import `maplibre-gl-worker.mjs?worker&url` and call setWorkerUrl. The actual client build emits `/assets/maplibre-gl-worker-CD0Mhlp9.js` (507.75 kB). A separate 1,030.67 kB chunk named `maplibre-gl-worker-oLGrGvDU.js` contains the library/application exports and the root-relative worker URL; its name alone does not make it another instantiated worker.

Installed MapLibre 6.10.0 workerFactory constructs a Worker directly for same-origin URLs; cross-origin worker paths use blob wrappers. The configured path is therefore **proven bundled same-origin**, with runtime delivery/MIME/CSP still requiring UAT. Candidate `worker-src 'self'` is justified; no blob worker permission is established by current setup. The worker response itself needs an owned policy for its requests/script execution; document worker-src controls creation, not all worker internals.

Current map configuration has no symbol/glyph/sprite/tile URL. CSS data images and DOM styling exist. WebGL/shader execution is not JavaScript eval and does not justify unsafe-eval. Test rendering, resize, selection, markers, controls and WebGL context loss/recovery.

The emitted worker **does contain globalThis.eval** in an optional external-script loader, plus optional blob module loading. Source ties this to plugin/worker-source loading; no app calls to setRTLTextPlugin, custom worker imports or these plugin registrations were found. This is not proof the current GeoJSON path needs unsafe-eval. Keep it disallowed and test; any future plugin requires independent review. [MapLibre's current guidance](https://maplibre.org/maplibre-gl-js/docs/#csp-directives) recommends self workers and self/data/blob images; its current examples are newer than the pinned 6.10.0 and are not permission to use demo tiles.

## 6. MSAL, navigation and framing

[msalConfig](../../react/src/auth/msalConfig.js) constructs authority `https://login.microsoftonline.com/<configured tenant>`, callback `<current origin>/`, post-logout return `<current origin>/`, SessionStorage. [AuthContext](../../react/src/auth/AuthContext.jsx) uses loginRedirect, logoutRedirect and acquireTokenSilent, not loginPopup or explicit ssoSilent. Identity is optional and enabled only with complete public deployment settings.

Installed MSAL Browser 5.21.0 distinguishes cached token use, refresh-token fetch and silent iframe fallback. Metadata discovery/token exchange require connect-src permission for the exact reviewed authority/network origins. Merely allowing top-level login navigation does not allow those fetches. The local authority supports a concrete login.microsoftonline.com candidate when identity is enabled, but aliases, federation, regional/cloud authority and actual redirects require deployment evidence; no blanket Microsoft wildcard, Graph, login CDN or script-source additions are approved.

Source defaults to AAD protocol and GET authorization navigation when no httpMethod is supplied. Reqro does not request POST or EAR. Library POST/EAR paths create and submit forms, but their existence alone does not justify broadening form-action for this configured path. Logout is external navigation followed by the configured root return.

Silent authorization can load an IdP iframe and return to a same-origin callback: parent frame-src and callback frame-ancestors/X-Frame-Options answer different questions. The copied Helmet policy's default-src self would not allow an external auth iframe. Same-origin callback framing does not require allowing arbitrary external parents.

**Unresolved baseline compatibility gap:** no dedicated callback/redirect bridge or broadcastResponseToMainFrame usage is present. Current [Microsoft v5 bridge guidance](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/redirect-bridge) requires a dedicated bridge for popup/silent flows, with route/build handling and no COOP on that bridge. Existing root callback cannot be certified for those flows from source or historical UAT. No authenticated reproduction was attempted, and no identity/configuration fix is made here. A separate bounded review must reconcile the pinned library, root redirect handling, router, registration and bridge behavior. Do not copy the API's COOP default onto a future bridge blindly.

Retain ordinary same-origin framing protections. No municipal portal embedding requirement or authored iframe was found; live external embedding is unknown. Prefer a dedicated same-origin callback with the narrowest reviewed route policy if evidence requires an exception; never weaken the entire site to accommodate authentication. [Microsoft iframe guidance](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/iframe-usage) also distinguishes silent frames from interactive login, which cannot simply be placed in an arbitrary iframe.

## 7. Scripts, development and legacy boundaries

The modern HTML/build has one external module entry and no inline executable script, inline stylesheet, style attribute or event attribute. React uses createRoot, not SSR hydration with embedded state. Dynamic chunks/preloads are self-hosted. No authored eval/new Function, script injection or dangerous HTML sink was found in react/src. Current script-src self and script-src-attr none are supported for the inspected modern app path, subject to dependency/browser tests; no unsafe-inline/unsafe-eval script expansion is justified.

Development uses Vite localhost serving, HMR WebSocket and injected style elements. No dev proxy is configured. API absolute HTTP(S) overrides are permitted in development; client builds require same-origin /api/v1, API mode and development reads disabled. No authored development eval requirement was found. Production build emits no source maps by default. Never add localhost, ws:, development API origins, HMR clients or development style permissions to production policy.

Build scan found a React Router internal `http://localhost` fallback literal, not an emitted resource URL; this is a residual library string, not proof of a development connection. Future tests must distinguish executable resource destinations from incidental strings and require zero actual development-origin requests. Do not falsely claim the bundle contains no localhost text.

Legacy root index/pages and Parcel build remain in source, with explicit legacy deploy/rollback scripts. They are **legacy/rollback-capable, not the active modern build**; actual live deployment status was not inspected. Root index has jsDelivr icon CSS; legacy dashboard has jsDelivr icon CSS/Chart.js and seven style attributes; other legacy pages point at local scripts. Retained legacy JS uses innerHTML. Conversely some IssueService/statistics/filter helpers and the dashboard route are still imported by the modern shell: not all assets/ code is dead. Do not widen modern policy to support legacy HTML or external legacy scripts.

## 8. Candidate directives, nonces, hashes and Trusted Types

These are review directions, **not an executable approved policy**:

| Directive/control                         | Recommendation                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| connect-src                               | Needed explicitly for self API; exact Entra origins only when enabled and verified. Map network origins unresolved. No universal https: or wildcard.             |
| worker-src                                | Explicit self candidate, supported by emitted worker. No blanket blob:.                                                                                          |
| frame-src                                 | Needed for measured silent auth if retained; self plus exact approved IdP destinations. No auth-disabled iframe requirement identified.                          |
| manifest-src                              | No manifest/PWA found; explicit none is an optional restriction, not required functionality.                                                                     |
| media-src                                 | No audio/video playback path found; file input is not media playback. None candidate after attachment coverage confirms this.                                    |
| child-src                                 | No independent need with tested modern frame-src/worker-src. Older-browser fallback support remains a target-browser decision; do not duplicate divergent lists. |
| navigate-to                               | Not a dependable supported control in the current CSP standard/browser model; do not rely on it. Preserve application navigation validation.                     |
| style-src-elem / style-src-attr           | Evaluate self external styles and tighter attribute rules separately, after real CSSOM/library tests. No immediate removal of current unsafe-inline.             |
| img-src                                   | Self and data have proof; explicit blob candidate for previews/library imagery needs browser acceptance. Future image host approval separate.                    |
| font-src                                  | Self candidate; broad https/data removals await runtime evidence.                                                                                                |
| trusted-types / require-trusted-types-for | Defer enforcement until sink/dependency inventory and browser support review. No permissive default policy to suppress failures.                                 |

Do not introduce a nonce-heavy architecture for an SPA already using external self-hosted scripts. Nonces require unpredictable per-response values and coordinated HTML/header generation/cache behavior, which static serving does not yet implement. Script hashes/SRI can be evaluated against release artifacts if a concrete need arises; asset filename hashes are not CSP hashes.

For styles, prefer class extraction for static rules when separately authorized. Dynamic property assignments may already work under restrictive attribute policy. Style hashes suit stable style-element content; attribute hashes require unsafe-hashes and exact matching, with broader reuse risks. Nonces authorize style elements, not arbitrary style attributes. Retaining narrowly justified style unsafe-inline is a fallback only after measured incompatibility and review, not a consequence of finding React style props.

Trusted Types may reduce future DOM injection risk, but no authored modern dangerous sink was found. MapLibre contains DOMParser/innerHTML utilities and optional popup/attribution sinks, React internals contain generic sink support, and legacy HTML has its own risks. Global enforcement could break dependencies without delivering a proven benefit on current paths. Do a future sink reachability audit and controlled evaluation rather than inventing an allow-all Trusted Types policy.

upgrade-insecure-requests remains unchanged. Production resources must already be HTTPS or approved local schemes; do not use silent upgrades to excuse insecure URLs. Local HTTP behavior can differ, and [Helmet documentation](https://helmetjs.github.io/) warns of development implications. HSTS ownership transition remains separately gated on a real verified edge.

## 9. Dual-policy transition and reporting compatibility

[CSP3 delivery semantics](https://www.w3.org/TR/CSP3/#policy-delivery) support enforced and Report-Only headers together. The enforced policy still blocks; Report-Only observes independently and cannot permit what enforcement rejects. Multiple enforced policies constrain cumulatively, not as an allowlist union. Do not append a second enforcing candidate expecting it to replace the first.

Future owner emits the existing enforcement unchanged plus one separately constructed candidate in Content-Security-Policy-Report-Only. Helmet's reportOnly option selects the reporting header for that middleware; changing the existing call to reportOnly would remove that instance's enforcement. Prefer a dedicated candidate-CSP layer over duplicating all Helmet middleware. Test exact values and header multiplicity at the public response, including origin/edge composition and attachment exceptions.

Sequence: preserve enforcement; construct versioned candidate; approve serving/reporting boundaries; emit candidate in controlled evaluation; collect minimized evidence; distinguish app/library/extensions/invalid reports; fix genuine incompatibilities under separate authorization; tighten candidate; obtain UAT and security approval; promote through an atomic reviewed enforcement change. Retire superseded policy only with compatibility and protection-equivalence evidence plus rollback. Report-Only cannot test behavior blocked earlier by enforcement, so use synthetic laboratory fixtures for those gaps without weakening production protection.

As consulted on 2026-10-11, MDN marks [report-to](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/report-to) Baseline 2026 (March) and [Reporting-Endpoints](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Reporting-Endpoints) Baseline 2024 (September), with older-browser caveats. Reverify the actual supported desktop/mobile/WebView matrix before activation. Reporting-Endpoints maps a group name to an HTTPS endpoint; report-to names that group. Prefer it over the legacy Report-To header.

[report-uri](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/report-uri) is deprecated but can be a reviewed compatibility fallback for supported older browsers. If both directives are used, supporting browsers prefer report-to. An owned collector must validate both application/csp-report single-report and application/reports+json batch formats, deduplicate and tolerate loss/delay. No delivery guarantee or proof of safety follows from zero reports. Do not implement either mechanism now; no owned safe reporting endpoint exists in inspected source.

## 10. Reporting privacy and tenant isolation

Network reporting is blocked until security/operations approve collection before any real-user exposure. Browser reports can transmit full same-origin paths/query data, document/referrer/source URLs and policy context even when some cross-origin URLs are reduced. Collector-side sanitization cannot undo transmission; prefer synthetic controlled UAT first. Exclude sensitive routes from real-user reporting until their URL/report exposure is reviewed; do not assume no-referrer sanitizes report bodies.

Required boundary:

- An owned, fixed, approved HTTPS collector with verified TLS and deployment-owned routing. No third-party reporting service, tenant-supplied endpoint or arbitrary endpoint override.
- Treat every report as attacker-controlled. Bounded payload size, batch count, schema, rate, parsing time, queue and retention; exact numerical budgets and owners are activation gates. Drop invalid/oversized fields before persistence. Reporting failure must not change API readiness or authorization.
- Allowlist only bounded policy version, disposition, directive, resource category, coarse browser family and counts where needed. Do not retain raw URLs, query/fragment, referrer, sourceFile, samples, original-policy strings, tokens, request/attachment identifiers, identity or resident text. Do not enable report-sample. No raw-body/access-log/error-log leakage at edge, proxy, collector or backups.
- Deployment/hostname routing separates tenant-sensitive collection and storage/access. Neither payload documentURL nor arbitrary Host establishes tenant authority. Validate the configured ingress mapping; no cross-tenant aggregation of raw evidence.
- No tenant ID, hostname, tracking token or per-request value as a high-cardinality telemetry label. No F061 telemetry is added. Policy ownership is security; ingress/retention/availability ownership is operations; tenant evidence access is explicitly approved and audited.
- Document retention duration, deletion/backup treatment, reviewer access, incident handling and safe synthetic examples before activation. No legal retention period is invented here.

## 11. Browser features and control ownership

| Feature                     | CSP relevance                                                                                    | Other controlling boundary                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Device geolocation          | API network calls use connect-src; geolocation itself is not granted by CSP.                     | Secure context, explicit user action/permission, Permissions-Policy and existing location validation.          |
| Camera/photo input          | Existing file input capture=environment; upload fetch and preview images need connect/img rules. | Browser/OS chooser and permissions, server validation/processing; not evidence of getUserMedia/video playback. |
| Clipboard                   | No CSP source permission creates clipboard authority.                                            | Secure context, user activation/browser permission; no-referrer and token privacy remain.                      |
| File upload                 | FormData API fetch is connect-src, not automatically form-action.                                | Existing authorization, size/type/processing limits.                                                           |
| Attachment preview/download | Blob image compatibility and independent download document protections.                          | Existing private,no-store, access checks, disposition and sandbox response.                                    |
| External links/login/logout | Navigation differs from fetched scripts or API connections.                                      | Approved URL validation, user handoff, identity redirect registration and referrer control.                    |

CSP is not Permissions-Policy, CORS, authentication, tenant resolution or malware scanning. No Permissions-Policy is introduced.

## 12. Build evidence and limits

Ran the existing build command's Vite equivalent: `node node_modules/vite/bin/vite.js build react --outDir ../dist-react --emptyOutDir`, with process-only client profile, API data source, empty API override, development reads false and no Entra values. No env/config file changed or credentials were used.

Result: **PASS**, 354 modules, 9.58 seconds. Existing >500 kB chunk and plugin-timing warnings were reported, not suppressed. Generated assets: **52 files: 35 JS, 15 CSS, two font files**; public branding assets are separately copied unchanged. Build HTML references external self module/preloads/CSS; no inline scripts/styles or external resource tags. CSS URLs are same-origin fonts or data SVG; no external stylesheet/font download found. No source-map files emitted. Worker URL and artifact verified as above.

Static output cannot establish authenticated renewal, all CSSOM behavior, framing/COOP, blob image interoperability, final production hostname/resource delivery or reports. No browser UAT, network capture or application suite was run; none is claimed. The auth-disabled build proves asset packaging, not configured Entra compatibility. Future client configuration must repeat build/runtime checks.

## 13. Future tests and production blockers

Later automated tests must pin unchanged enforcement and all current security headers, independently verify the candidate Report-Only value, reject duplicate enforcement, wildcard/unsafe-eval/unexpected unsafe-inline expansion, and assert exact approved script/connect origins. Test attachment overrides, self worker creation and worker response policy, image blob/data boundaries, framing and callback policy, cache/header ownership on errors/redirects and absence of real development-origin requests.

Controlled browser matrix must cover supported Chromium/Firefox/WebKit desktop and mobile targets; login/logout/callback, cached/refresh/iframe renewal with cookie/storage restrictions; MapLibre loading/markers/controls/context recovery; wrapping/menus/dialogs/light-dark presentation; geolocation and manual alternatives; camera/file selection, upload/preview/download; clipboard/tracking privacy; tenant branding; legacy exclusion. Validate both reporting formats and unsupported-browser behavior, sanitization, cross-tenant spoofing, access, retention, rate/size bounds, outage and rollback. Tests are future scope, not implemented here.

Hard blockers for production candidate emission:

1. Approved production static implementation and measured public header ownership, including worker and auth callback responses.
2. Pinned-version MSAL bridge/root callback reconciliation and authenticated flow evidence; exact connect/frame destinations.
3. Controlled inline-style/CSSOM and library compatibility evidence; no automatic retention/removal of unsafe-inline.
4. Blob preview and final branding/attachment/map resource origin decisions; no demo tile authorization.
5. Owned reporting endpoint, privacy-before-transmission review, numerical limits, retention/access and deployment isolation.
6. Approved browser matrix, policy version/rollback ownership, duplicate-header tests and evidence-based promotion criteria.

Proposed bounded slices, each requiring separate authorization:

- **2C-2A:** strengthen existing API CSP/attachment/ownership regressions; define static response tests once 2C-1B serving is approved. Current 2C-1A assertions already cover baseline preservation; extend rather than duplicate.
- **Auth compatibility prerequisite:** separately review the v5 bridge/callback gap and any required identity/build changes; no broad framing exception.
- **2C-2B:** candidate Report-Only and owned reporting/privacy foundation after the gates above; synthetic-only evaluation first, no enforcement replacement.
- **2C-2C:** controlled browser UAT and sanitized report classification; resolve legitimate incompatibilities.
- **2C-2D:** reviewed enforcement hardening and controlled replacement/rollback after evidence is accepted.

## 14. Documentation validation and disposition

Documentation validation passed: 20 relative links resolve, 15 heading anchors are unique, and the nine external references were consulted during assessment. Formatting/idempotence, trailing-whitespace/control-character checks and git diff --check passed. Exactly this one new document is untracked; no tracked file differs and the index is empty. HEAD remains the starting SHA, 0 ahead / 0 behind local origin/main. No application test suite was run or required for this documentation-only assessment. Build evidence above is supplemental and does not establish production readiness.

**Recommendation: preserve current enforcement; do not activate production Report-Only collection or change CSP now.** The next safe work is bounded regression/ownership and auth compatibility evidence, not policy rollout.

No staging, commit, push, deployment, runtime implementation or concurrent-agent file change.

**STOP FOR F060.4A-2C-2-0 SECURITY / ARCHITECTURE REVIEW.**
