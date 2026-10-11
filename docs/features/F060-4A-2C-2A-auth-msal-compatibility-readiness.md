# F060.4A-2C-2A-auth — MSAL Callback Compatibility Readiness

**NO AUTHENTICATION BEHAVIOR CHANGES IN THIS SLICE.**

**NO CSP OR FRAMING POLICY CHANGES.**

**NO ENTRA APP REGISTRATION CHANGES.**

**NO PRODUCTION AUTHENTICATION UAT IS CLAIMED.**

## Baseline and recommendation

Started from freshly fetched origin/main `14ea8cb4d4e864c67358f076b30a780e94829ba8`, on isolated branch `codex/f060-4a-2c-2a-auth-msal-compatibility`, clean tree/index, 0 ahead / 0 behind. Fetch succeeded with the previously observed stale Claude worktree cleanup permission diagnostic; no repair occurred. Claude's concurrent F062 ordered-stream/retry persistence is outside scope.

**Recommendation B + C:** separately implement a dedicated same-origin MSAL v5 redirect bridge before advancing candidate CSP Report-Only work, then complete authenticated compatibility UAT. Source proves a bridge gap for the conditional silent-iframe fallback; it does not prove a currently observed login outage. Interactive top-level redirects do not establish that the fallback works. No broad framing relaxation is justified.

Authorities: [CSP compatibility assessment](F060-4A-2C-2-0-csp-compatibility-report-only-readiness.md), [existing header regression contract](F060-4A-2C-2A-existing-csp-regression-ownership-tests.md) and [ADR-030](../architecture/decisions/ADR-030-production-serving-contract.md). Source findings agree with their previously identified bridge/static-serving gaps. This report records the gap rather than fixing authentication runtime.

## Version and initialization evidence

[Package manifest](../../package.json), [lockfile](../../package-lock.json) and installed package metadata agree: @azure/msal-browser **5.21.0**, @azure/msal-react **5.7.0**, transitive @azure/msal-common **16.14.0**. No dependency update or install occurred.

[msalConfig.js](../../react/src/auth/msalConfig.js) directly constructs PublicClientApplication from msal-browser. [AuthContext.jsx](../../react/src/auth/AuthContext.jsx) supplies it to the msal-react MsalProvider wrapper and consumes useMsal. Both packages are used; this is not a browser-only integration.

[Runtime configuration](../../react/src/config/runtimeConfig.js) enables identity only in API data mode with all three public VITE_ENTRA settings present: tenant, web client and API scope. Partial settings throw; no client tenant is invented. AuthRoot constructs one instance per mount when enabled. Its disabled path constructs none.

Installed msal-react src/MsalProvider.tsx calls initialize(), then handleRedirectPromise(), registers/removes MSAL event callbacks and renders children while tracking startup. Reqro does not call those methods itself or provide a minimal pre-router callback handler. ActiveAuthProvider picks the active account or first cached account and sets an active account if needed. The tests mock this wrapper boundary; they do not certify its initialization internals.

## Current interaction and return URIs

| Flow                      | Exact application behavior                                                                                                             | Evidence boundary                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Login                     | signIn clears its error and calls loginRedirect({ scopes: [configured API scope] }); failures set the existing generic sign-in message | App-level mocked test; real sign-in not invoked                                          |
| Redirect URI              | Factory default origin is window.location.origin; redirectUri is origin plus /                                                         | Current path, query and fragment are not part of the configured URI                      |
| Logout                    | signOut calls logoutRedirect({ account }); configured postLogoutRedirectUri is the same origin plus /                                  | No per-request override, logoutPopup or front-channel logout route is authored           |
| Token                     | getAccessToken calls acquireTokenSilent({ account, scopes: [scope] }) and returns accessToken                                          | On demand, not an application renewal timer                                              |
| Interaction required      | Sets the existing administrator-approval message and rethrows; no automatic loginRedirect/acquireTokenRedirect fallback                | This message is not proof that every interaction-required cause is missing admin consent |
| Missing account / cleanup | No account means no registered token provider; unmount clears it                                                                       | No token or credentials stored by these tests                                            |

The [token provider](../../react/src/auth/tokenProvider.js) is consumed by the [API client](../../react/src/api/apiClient.js) for authenticated requests. Existing tests prove anonymous calls do not receive a staff token. Sign-in/out buttons and guards in navigation, HomeShell and staff surfaces call the context methods. Source contains no app call to loginPopup, acquireTokenPopup, acquireTokenRedirect or ssoSilent. This does **not** mean the library cannot create an iframe through acquireTokenSilent.

The factory accepts an explicit origin argument as a test seam; production AuthRoot passes none. No environment-specific redirect path, fixed central callback host or deployment alias canonicalization exists. SessionStorage is explicitly selected. The factory is not a hostname/protocol validator: tests with HTTPS example origins prove their output contains no localhost/wildcard, not that running a production build on localhost would be rejected by this factory. Origin admission belongs to the separately governed serving boundary.

Installed RedirectClient.ts defaults handleRedirectPromise's navigateToLoginRequestUrl option to true and can navigate from the root return to the stored initiating page. Reqro passes no override through its wrapper. Root is the configured redirect landing page, not a promise that the user remains on Home after sign-in. Logout returns to root under the configured end-session flow, with provider/session behavior still requiring UAT.

## Silent acquisition and the missing bridge

Repository-proven call: acquireTokenSilent has no forceRefresh, cacheLookupPolicy, redirectUri or iframe override. Installed StandardController.ts uses CacheLookupPolicy.Default, tries the no-iframe path, and conditionally invokes acquireTokenBySilentIframe for resolvable refresh-token errors. Installed SilentIframeClient.ts creates a hidden iframe, navigates the authorization request and waits for the redirect-bridge response. Cached access-token use needs no network; a refresh-token exchange uses fetch; fallback needs the hidden authorization frame and callback response. These are inspected library paths reachable from the app call, not a claim they occurred in a browser session.

Microsoft's [token renewal guidance](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/token-lifetimes) likewise distinguishes cached tokens, refresh-token exchange and hidden-iframe renewal after refresh-token expiry. Silent success is conditional on identity session and browser behavior, not guaranteed by an API name.

No redirect-bridge import, broadcastResponseToMainFrame call, dedicated auth callback route/page or separate bridge build input exists in [router](../../react/src/app/router.jsx), [main](../../react/src/main.jsx), [HTML](../../react/index.html), public assets or [Vite config](../../react/vite.config.mjs). Root is currently a full SPA redirect landing page, **not an implemented v5 redirect bridge**.

Microsoft's [v5 bridge guidance](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/redirect-bridge) describes a dedicated bridge entry for Vite, requires exact matching registration after a redirect URI change, and warns against COOP headers on that bridge. The [v5 migration guidance](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/v4-migration) explains the BroadcastChannel-based bridge response mechanism. These current documents were checked during this assessment against the installed version; generic older blank-page advice is insufficient for this pinned v5 fallback. No sample code or registration change is applied here.

## Framing: distinguish destination from ancestor

| Question                                      | Finding                                                                                                                                                                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Must Microsoft pages embed Reqro?          | No such parent embedding is required by the inspected app flow. Microsoft is navigated inside Reqro's child frame during conditional silent auth; it is not thereby the ancestor of the final callback. No front-channel logout integration is established. |
| B. Must Reqro embed its same-origin callback? | Conditional silent fallback navigates a child frame back to the same-origin return URI. A future minimal bridge must support that relationship.                                                                                                             |
| C. Must Reqro embed Microsoft content?        | Conditional silent authorization navigates the child frame to the authority. This requires suitable frame-src in the parent document. It is not permission to embed interactive credential/consent UI.                                                      |
| D. Is framing unnecessary?                    | Yes for ordinary top-level redirect login/logout and cache/refresh-fetch-only paths; no for the supported conditional fallback.                                                                                                                             |

frame-src controls the child destinations that Reqro can load. frame-ancestors controls who can embed a Reqro response. SAMEORIGIN and frame-ancestors self are compatible in principle with a top-level Reqro document embedding its same-origin callback. No evidence warrants adding Microsoft as an allowed ancestor or removing SAMEORIGIN. Arbitrary cross-origin embedding of the whole application is not a requirement.

The [Microsoft iframe guidance](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/iframe-usage) notes that interactive Entra prompts are not supported inside ordinary iframes and that browser third-party-cookie restrictions affect silent behavior. A failed silent request must not be treated as a reason to weaken framing.

The existing **Nest/API** policy has frame-ancestors self and X-Frame-Options SAMEORIGIN, but no frame-src or child-src, so default-src self supplies the frame fallback. If that policy were copied to the parent React document, cross-origin silent authorization could be blocked. Nest does not serve that document; this is a conditional compatibility finding, not an observed production conflict. Existing API headers remain untouched and tested. React document/static-origin header ownership is still unresolved.

A future bridge candidate could be /redirect.html on each approved staff origin, but neither that route nor URI is selected or registered here. Its embedding origin would be the same approved Reqro origin. SAMEORIGIN/self ancestor controls should be sufficient for the inspected topology; route-specific delivery, COOP and browser evidence must still be reviewed. Do not copy Helmet's API COOP same-origin onto the bridge without addressing the documented requirement. No whole-site exception is proposed.

## Network-origin inventory and CSP implications

No authenticated network trace was captured. The only Microsoft authority origin explicitly built by Reqro is **https://login.microsoftonline.com**, with the configured tenant in its path. A configured API scope is an identifier, not proof of a browser request to that URI.

| Traffic                                                             | Origin classification                                                                                                                        | Future policy implication                                                                                              |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Interactive authorization navigation                                | Authority origin source-proven; authorization endpoint resolved from metadata by installed MSAL                                              | Top-level navigation, not connect-src/frame-src permission; exact return registration and navigation evidence required |
| Authority/instance discovery and token POST                         | Same authority origin is the inspected standard/default candidate; actual discovery/cache use, endpoint metadata and aliases are conditional | connect-src on the initiating document for reviewed fetch destinations                                                 |
| Silent authorization iframe                                         | Authority origin library-default/conditional; session and federation behavior unresolved                                                     | Parent frame-src must cover proven authorization destinations and the same-origin return                               |
| Callback landing / future bridge                                    | Current window.location.origin is source-proven, root path today                                                                             | Parent frame-src allows same-origin return; callback frame-ancestors/X-Frame-Options allow its actual parent           |
| Logout navigation                                                   | End-session endpoint from authority metadata; configured return is current origin root                                                       | Top-level navigation; not evidence of a Reqro-owned external form POST                                                 |
| API calls                                                           | Same-origin /api/v1 in the production client profile; development can override                                                               | connect-src self; these are Reqro API requests, not Microsoft Graph calls                                              |
| Federation, account/session redirects, cloud aliases and IdP assets | Unresolved until authenticated UAT for the approved tenant/browser                                                                           | Record actual necessary origins by traffic class; do not guess domains or widen policy                                 |

Installed FetchClient, msal-common Authority.ts and RedirectClient establish fetch, metadata-resolved endpoints and navigation respectively. No hard-coded Microsoft Graph request or external MSAL script CDN is present in the inspected auth flow. Bundled MSAL is first-party JavaScript. Assets loaded inside Microsoft's document do not automatically become Reqro script/font/style allowlist entries.

Current app requests do not select POST authorization; the inspected library defaults authorization navigation to GET. form-action is separate from token fetch (connect-src), framing and top-level navigation. No external form-action expansion is justified here. No wildcard Microsoft list, unsafe-eval or CSP modification is proposed.

## Root callback side effects and client-neutral activation

[Router](../../react/src/app/router.jsx) mounts AuthRoot and App at /. [main](../../react/src/main.jsx) loads the normal styles, theme, tracking initialization and router. MsalProvider renders children during its startup state; Reqro does not isolate an iframe callback before SPA bootstrap. AppLayout selects the Home shell at root. PublishedHomePresentationProvider starts resident-experience loading in API mode; ResidentAlertBanner starts alert loading/polling. Those public API requests can reach normal server tenant resolution. MSAL itself does not select Reqro Organization authority.

These are source-derived potential callback side effects, subject to execution timing and redirects: full resource loading, public API/tenant resolution work, root metadata/theme work and navigation back to an initiating route. Home does not mount a map: map and report routes are lazy; unconditional root map initialization is not proven. Actual duplicate requests, visible flashes, lost URL state, authentication loops, iframe failures or user-visible delay are **unverified**, not observed defects. The missing bridge is a source-confirmed gap; the user impact needs UAT.

Return URIs are deployment-hostname-derived and alias-sensitive, not centrally fixed or derived from the Entra tenant ID. Each origin includes scheme/host/port; path is /. Aliases can create distinct redirect registrations, browser storage and sessions. Public tenant/client settings are deployment configuration; hostname-derived redirects alone cannot guarantee correct tenant admission.

Production activation must verify for every approved staff-facing origin: exact registered redirect and post-logout return URI; scheme, host, port and path agreement; alias/canonical-host behavior; callback asset delivery without accidental SPA fallback; owned document/bridge CSP, frame and COOP behavior; and unknown-host rejection before it can authenticate into or access the wrong deployment. Verify logout return registration/provider rules separately from any future front-channel logout registration. No identity app registration, hostname list, credentials or production tenant was inspected or changed.

## Tests, UAT gates and bounded next work

The new [MsalCompatibility tests](../../react/test/MsalCompatibility.test.jsx) exercise the real factory/context with MSAL mocked: two explicit HTTPS origins, browser-origin root construction, disabled auth, wrapper selection and explicit loginRedirect, account-scoped on-demand tokens/logout, provider cleanup and interaction-required propagation without automatic interaction. They do not test MSAL internals or claim popup/iframe success. Existing StaffAuthentication and ServingConfiguration tests supplement these boundaries. The existing F060 header suite is unchanged.

Before production readiness, authenticated UAT must cover interactive login and initiating-route return; cached token use, refresh and expired-refresh-token silent fallback; MFA/consent/expired or blocked session behavior; logout/return; callback framing and browser cookie restrictions; and actual console/CSP/network behavior. Evidence must identify origins and outcomes without exporting tokens, authorization codes, cookies, identity payloads or credential-bearing HAR files. No authenticated UAT was performed in this slice.

Proposed order, each separately authorized:

1. F060.4A-2C-2A-auth-1: design and implement the minimal same-origin v5 bridge, build/serving ownership, deliberate registration transition and route-specific security tests; preserve unrelated auth behavior.
2. F060.4A-2C-2A-auth-2: authenticated compatibility UAT and reviewed origin/callback inventory.
3. F060.4A-2C-2B: candidate CSP Report-Only work only after those gates, with separate owned/privacy-reviewed reporting collection.

## Validation and exact scope

The focused Vitest invocation (vitest run --config vitest.config.mjs --maxWorkers=1 with MsalCompatibility, StaffAuthentication and ServingConfiguration) passed **27/27 tests across three files**, zero failures (84.28 seconds). Seven tests are new app-boundary cases. No real authentication or external network was invoked.

Backend typecheck (tsc -p tsconfig.json --noEmit), test compilation (tsc -p tsconfig.test.json) and full backend lint (eslint .) passed. The repository has no configured frontend lint or frontend typecheck command; backend checks do not cover the JSX test. Vitest transformed/executed the new JSX, and changed-file Prettier passed. A frontend build was not needed for this source-only callback/entry inspection and was not run; no emitted bridge artifact or serving compatibility is claimed.

The unchanged compiled F060 API cache/header regression suite passed **17/17**, zero failures/skips (67.150 seconds), using node --test --test-concurrency=1 --test-reporter=tap. It retains CSP, SAMEORIGIN, HSTS, attachment sandbox, cache and absent Report-Only/Permissions-Policy assertions. Combined distinct focused test count is **44 passed, zero failed, zero skipped**.

Documentation checks passed for 17 local links, ten unique heading anchors, whitespace/control characters and git diff --check. Four official Microsoft guidance pages were read; no external account or Entra tenant was accessed.

Exact intended files are this document and react/test/MsalCompatibility.test.jsx only. No runtime-auth, routes, headers, Entra registration, F061/F062, database, migration, package or deployment files change. No database suite is required. No push, deployment or future implementation slice is authorized.

**STOP FOR F060.4A-2C-2A-auth REVIEW.**
