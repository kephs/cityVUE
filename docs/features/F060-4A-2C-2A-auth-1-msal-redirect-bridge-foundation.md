# F060.4A-2C-2A-auth-1 — Dedicated MSAL Redirect Bridge Foundation

**THE REDIRECT BRIDGE EXISTS BUT IS NOT YET ACTIVE.**

**REQRO STILL USES ITS EXISTING REDIRECT URI.**

**NO ENTRA APP REGISTRATION WAS CHANGED.**

**NO CSP OR FRAMING POLICY WAS CHANGED.**

**NO AUTHENTICATED UAT IS CLAIMED.**

## Baseline and scope

Started from freshly fetched origin/main `1584bc03d41e3b260621c9a5244b099e0ef4a6ba`, with clean tree/index and 0 ahead / 0 behind, on isolated branch `codex/f060-msal-redirect-bridge-foundation`. Fetch succeeded with the previously observed stale Claude worktree cleanup permission diagnostic; no repair was attempted. Claude's concurrent F062 work is outside scope.

The [MSAL assessment](F060-4A-2C-2A-auth-msal-compatibility-readiness.md) identified a missing v5 bridge for conditional silent-iframe renewal. This slice prepares the build artifact only; it does not resolve that gap for active authentication or supersede the assessment's UAT gates.

Installed and locked Vite is **8.2.2**, MSAL Browser **5.21.0**. The existing MSAL package exports @azure/msal-browser/redirect-bridge. No dependency change or installation is needed.

Exact changed files:

- react/redirect.html — new minimal bridge HTML.
- react/vite.config.mjs — explicit SPA and bridge build entries.
- test/MsalRedirectBridge.test.mjs — source, error-privacy and production dependency-graph tests.
- This document.

No auth runtime/configuration, React route, SPA entry, package, backend/header, F061/F062, database, migration, role/grant/function, worker or deployment file changes.

## Artifact and build configuration

The Vite project root is react, established by the existing build:react command: vite build react --outDir ../dist-react --emptyOutDir. [index.html](../../react/index.html) remains the normal SPA entry.

[redirect.html](../../react/redirect.html) sits alongside it and is emitted as dist-react/redirect.html. Its only script imports broadcastResponseToMainFrame from @azure/msal-browser/redirect-bridge and invokes it once without arguments. The page has basic metadata and a short processing message. The catch handler accepts no error argument and logs only a fixed generic string; it never prints an exception, URL, query, fragment, code, token or account. Response handling belongs to the installed library; no custom parsing, storage, networking or authentication processing is added.

This follows [Microsoft's Vite bridge pattern](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/redirect-bridge). The existing [Vite config](../../react/vite.config.mjs) gains only explicit main/index.html and redirect/redirect.html inputs under build.rolldownOptions, using resolve(import.meta.dirname, filename). This is the installed Vite 8 configuration API for the [multi-page build](https://vite.dev/guide/build.html#multi-page-app); the Microsoft example uses the older rollupOptions spelling. Existing serving-profile validation and private-file denial remain unchanged.

The bridge is not a React route and loads no React, React Router, MsalProvider, Reqro state, tenant resolver, business API, map, service request, admin UI, telemetry or service worker. Future approved bridge changes must preserve this narrow purpose.

## Production output proof

The final production build used the existing script's exact Vite command through node because npm was unavailable on this shell's PATH. Explicit public fixtures selected the production client/API profile, same-origin API, disabled development reads and empty Entra settings. No local secret-bearing environment file was introduced or read from another worktree. The build is not authentication activation or deployment.

| Output                           | Evidence                                                                |
| -------------------------------- | ----------------------------------------------------------------------- |
| dist-react/index.html            | Normal SPA HTML remains emitted with its own application entry          |
| dist-react/redirect.html         | Separate HTML; one module script, no SPA root or application stylesheet |
| assets/redirect-D4rLFgKk.js      | Bridge entry, 1,210 bytes                                               |
| assets/Configuration-CJXbJz9K.js | Required shared MSAL/Vite utility chunk, 63,386 bytes                   |

The bridge HTML references the redirect entry and preloads its required companion. It does not reference the SPA entry. The shared utility chunk is not the Reqro application bootstrap; independent entry does not imply MSAL utilities must be duplicated in each bundle. The build-output test recursively walks actual emitted static imports, rejects dynamic imports and unrelated dependency/source modules, and proves no React/Router/MsalProvider/Reqro source enters the bridge's reachable chunks. Permitted module origins are the bridge/its Vite HTML proxy, Vite virtual helpers and the installed MSAL Browser/Common packages. It checks package boundaries rather than library-internal algorithms.

Asset names and sizes describe this build, not permanent interface guarantees. Generated artifacts remain ignored and are not committed. The production build passed with a large-application-chunk advisory and plugin timing diagnostics; thresholds were not changed. A build proves artifact separation, not successful browser authentication or public serving headers.

## Authentication remains inactive for this bridge

[msalConfig.js](../../react/src/auth/msalConfig.js) is byte-for-byte unchanged: redirectUri and postLogoutRedirectUri remain `${window.location.origin}/`. [AuthContext.jsx](../../react/src/auth/AuthContext.jsx) is unchanged: loginRedirect receives only the existing scope, acquireTokenSilent receives account/scopes without a URI override, and logoutRedirect receives the account. Authority, tenant/client settings, initialization and SessionStorage remain unchanged.

No Entra registration was inspected or modified. The presence of /redirect.html in a build does not make MSAL use it. Changing the active URI before exact registration approval could cause a mismatch. The existing root-based silent-renewal compatibility gap remains until the later activation/UAT work.

## COOP, CSP and framing boundary

**COOP finding C: production static-serving ownership is unresolved.** Vite config contains no custom COOP header, and historical Firebase header configuration contains none. Nest's uncustomized Helmet emits COOP same-origin on API responses, but Nest is not the React static origin. These source facts do not prove what a future/live public edge emits.

Microsoft's bridge guidance requires the bridge response to have **no Cross-Origin-Opener-Policy header**. Future static-origin/edge owners must prove this on the actual bridge route and all applicable delivery paths before activation. Do not copy Nest's Helmet policy to the static bridge, remove global protection or invent an unreviewed exception. No server/header configuration changes here.

Existing CSP, SAMEORIGIN and frame-ancestors self remain untouched. A same-origin callback foundation gives no basis to relax them or add Microsoft connect-src/frame-src sources. Future authenticated UAT must establish actual document/bridge framing and CSP needs. No Report-Only header or reporting endpoint is introduced.

Historical Firebase uses cleanUrls and a SPA fallback. It is not the selected production static origin, and this build does not prove /redirect.html is delivered without normalization or fallback there. Exact-path serving, MIME, callback preservation, cache/privacy behavior, hostname admission and no-COOP evidence remain activation gates. No hosting configuration is altered.

## Validation and failure attribution

Final applicable checks:

| Check                                                                                | Result                                                                                       |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| New bridge tests plus existing Vite private-file tests                               | 6 passed, 0 failed/skipped, 4.797 seconds in isolated validation checkout outside .local-uat |
| Existing MsalCompatibility, StaffAuthentication and ServingConfiguration             | 27 passed, 0 failed, 16.92 seconds                                                           |
| Unchanged F060 API/cache/CSP header regressions                                      | 17 passed, 0 failed/skipped, 78.330 seconds                                                  |
| Final React production build                                                         | Passed; both HTML artifacts and bridge dependency closure verified                           |
| Backend test compilation needed for header regression                                | Passed                                                                                       |
| Changed-file formatting, document links/anchors/control characters, git diff --check | Passed                                                                                       |

These are **50 distinct passing tests**; supplemental runs below are not added to that total. No database tests, backend full suite or authenticated UAT ran. No frontend/root lint command is configured, so no frontend lint pass is claimed. No backend source changed.

Initial validation findings are retained:

- The new dependency-graph assertion initially omitted Vite's generated redirect.html?html-proxy&index=0.js module. It now admits that exact bridge proxy while retaining the package/source boundary checks. The corrected bridge tests passed 4/4 in the feature worktree before the final six-test validation.
- Initial auth validation had two files / nine tests pass, while ServingConfiguration failed during config import because jsdom provides a non-file import.meta.url. Entry resolution now uses import.meta.dirname; final auth/serving validation passed all 27 tests. No existing test assertion was weakened.
- The first combined bridge/private-file run was 4 passed / 2 failed: the new proxy assertion above and the existing Vite test's normal-page status check (403 instead of 200). The feature worktree resides under .local-uat, which the unchanged deny policy intentionally blocks. A separate clean checkout at the exact baseline outside that path passed both existing private-file tests. Applying byte-identical bridge/config/test files to that checkout then passed all six tests. The initial failed invocation is not rewritten as a pass; final evidence uses an appropriate serving location without changing deny rules, timeouts or existing tests.
- npm was not available; the build was subsequently executed successfully via the installed Vite CLI and the unchanged script arguments. No package-manager installation or script change occurred.

The auxiliary validation checkout is local evidence only and enters no commit.

## Future activation contract

Each step remains separately authorized:

1. Approve the exact bridge URI for every staff-facing production origin, including aliases, scheme, port and /redirect.html path. Establish actual route delivery and the no-COOP gate.
2. Register the exact URI in the approved Entra application; do not infer registration from an artifact or source string.
3. Change MSAL redirectUri in a bounded reviewed slice. Review any logout return change separately rather than assuming it must use the bridge.
4. Verify loginRedirect and return to the initiating route.
5. Verify acquireTokenSilent cache, refresh and conditional iframe renewal, including expired/blocked sessions.
6. Verify logout and return behavior.
7. Capture privacy-safe browser console, network-origin, CSP and framing outcomes without tokens, codes or credential-bearing captures.
8. Only then design candidate CSP Report-Only policy under its separate ownership/privacy gates.

No push, deployment, bridge activation or subsequent implementation task occurred.

**STOP FOR F060 MSAL REDIRECT BRIDGE FOUNDATION REVIEW.**
