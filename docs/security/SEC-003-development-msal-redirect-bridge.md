# SEC-003 — Development MSAL redirect bridge integration

## Scope and baseline

Local source development starts at SEC-002 `8deda6d475cdae1ee7889d8c7ecde117d3ce7d89`, directly above F067 identity-binding baseline `a022a4ea1adc4563f38507c0ba22ea35f5ac12de`. Independent architectural review and real browser authentication acceptance remain required. Neither registration changes nor UAT activation are part of this change.

## Callback contract

`VITE_ENTRA_DEVELOPMENT_CALLBACK_MODE=f067-bridge` selects the existing standalone `/redirect.html` MSAL entry and the separate `/auth/signed-out` logout landing page. The selector must be exactly that string. Missing or empty retains both existing origin-root return URIs. Whitespace, case variants, arbitrary URLs and other values fail closed.

Selection requires Vite `DEV === true`, `PROD === false`, development deployment profile, and exact browser origin `http://localhost:5174`. Vite also rejects the selector for build commands, including builds with development-like environment flags. The build hook cannot know the eventual browser origin; the runtime and MSAL factory independently enforce it. A different hostname, port or scheme is not substituted or normalized. An unset deployment profile retains the established development default; an explicitly invalid profile is refused.

No environment file is modified. Future authorized activation supplies the selector only in the isolated Vite process. No production callback, authority, audience, scope, API endpoint or identity registration changes are introduced.

## Authentication and route behavior

MSAL retains ownership of Authorization Code Flow with PKCE, nonce/state, response parsing, code redemption, cache, refresh and iframe renewal. The existing bridge and its dependency-isolated build entry are unchanged. No custom URL parser, code exchange or token storage is added. The bridge handles the redirect response and returns to the initiating application; MsalProvider owns initialization and handleRedirectPromise. Application code does not call a second redirect handler.

The signed-out route is a top-level route outside AuthRoot, App and protected components. It presents an explicit staff-workspace link, with no automatic login or data request. It does not claim to prove global Microsoft session termination. MSAL performs logout/cache operations; the application does not manually clear all browser storage.

Authentication startup/redirect processing withholds application children. Concurrent interactive operations are refused, including double clicks before React updates. Explicit login cancellation/failure and callback failure display fixed generic messages without printing the exception, URL, response, account or token. There is no automatic interactive retry. Callback/logout failures block protected account presentation. Logout removes the token-provider boundary immediately, and token results started before logout, unmount or account replacement cannot be delivered afterward. Event handlers are removed on unmount. Silent interaction-required failures retain the existing application message and do not trigger automatic login.

This preserves server-side Entra issuer/tenant/audience/scope validation and staff/Organization authorization. The UI does not grant access. Resident tracking routes and credential handling are unchanged. The default-disabled authentication behavior and fictional previews remain unchanged when the configuration is absent.

## Proposed Entra changes — not performed

After independent review and separate administrator authorization:

1. Confirm the existing approved development tenant, API registration, SPA registration, delegated consent and staff-binding provenance.
2. Register `http://localhost:5174/redirect.html` on the existing SPA platform.
3. Register `http://localhost:5174/auth/signed-out` for the intended post-logout return.
4. Preserve `http://localhost:5173/`. Review consumers before retiring the old `http://localhost:5174/` entry.
5. Do not add matching new paths for a different localhost port as part of this scoped change.

No client secret, new application, permission, consent grant, identity binding or backend configuration is created by this implementation.

## Acceptance and rollback

Offline tests must cover rejected selectors/environments/origins, unchanged default configuration, event cleanup, errors, cancellation, concurrent interactions, logout, stale tokens, router isolation and exact-path standalone bridge serving. Existing bridge build-closure tests remain required. Production builds with the mode unset must still pass; mode-enabled builds must fail.

Separately authorized browser acceptance must verify the exact registered redirect request, return to initiating staff/admin routes, malformed/missing state, cancellation, startup failure, storage restrictions, cache/refresh/conditional iframe renewal, sign-out and back-navigation, sanitized errors and no credential disclosure. Verify the bridge is not replaced by SPA fallback or path normalization and that response headers do not break bridge communication. Offline mocks and loopback serving checks are not real Entra or accessibility certification.

Rollback stops only owned UAT processes and removes the selector from the process-scoped launch configuration. The default root behavior is preserved, but the original localhost ambiguity remains a blocker to resuming authenticated UAT. Revert SEC-003 only after separate authorization; retain SEC-002 and never restart its wildcard-listener predecessor. Leave the database, session and bindings unchanged. Registration rollback requires its own administrator authorization.

## Exact file scope

- `react/src/config/developmentCallback.mjs` (new): strict selector, environment/profile/origin checks and fixed return URIs.
- `react/src/config/servingConfig.mjs`: validate the selector at the existing serving gate.
- `react/src/config/runtimeConfig.js`: enforce the exact origin even when authentication is disabled.
- `react/src/auth/msalConfig.js`: apply validated return URIs, preserving authority, client ID and session cache.
- `react/src/auth/AuthContext.jsx`: initialization/interaction coordination, sanitized errors, event cleanup, explicit logout and stale-token invalidation.
- `react/src/auth/SignedOutPage.jsx` (new): public landing content and explicit workspace link.
- `react/src/app/router.jsx`: place the landing route outside authentication and application data loading.
- `react/vite.config.mjs`: reject callback activation for build commands.
- `react/test/DevelopmentCallback.test.js` (new): selector/environment/origin/build-gate tests.
- `react/test/MsalCompatibility.test.jsx`: factory and lifecycle regressions.
- `react/test/SignedOutRoute.test.jsx` (new): router isolation and absence of automatic requests/login.
- `react/test/AIPreviewPage.test.jsx`: update the MSAL mock to expose interaction status and event registration; assertions unchanged.
- `test/DevelopmentCallbackServing.test.mjs` (new): exact-path loopback HTTP bridge and signed-out SPA serving.
- `docs/security/SEC-003-development-msal-redirect-bridge.md` (new): this design, validation and handoff record.

No backend, environment file, dependency manifest/lock, bridge implementation, Map Preview implementation/test, tracking or infrastructure file is changed.

## Validation record

Validation used Node 24.19.0 and Vitest 4.1.11, one worker and sequential runs. No assertions were weakened, timeouts extended, tests skipped or unrelated Map Preview source/tests edited. Root dependencies were installed with `npm ci --offline --ignore-scripts --no-audit --no-fund`; the shell's Node 20.20.2 produced a transitive engine warning, so all validation used the available Node 24 runtime. Package manifests and lockfiles are unchanged.

| Invocation                                                           | Result                                                               |
| -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Initial focused MSAL/config/router/auth/preview run                  | 79/79, 7 files, exit 0                                               |
| Bridge build closure, exact-path HTTP serving and private-file tests | 7/7, exit 0                                                          |
| Initial full frontend invocation                                     | Deliberately interrupted before completed totals; exit 1, not a pass |
| Revised focused run                                                  | 81/81, 7 files, exit 0, 30.83 s                                      |
| Complete frontend suite                                              | 1,019 passed, 1 failed, 68 files; exit 1, 347.27 s                   |
| Focused Map Preview diagnostic                                       | 25 passed, 1 failed; exit 1, 3.74 s                                  |
| Exact SEC-002 archive, Map Preview baseline diagnostic               | Four sequential 26/26 passes, each exit 0 (7.44, 3.58, 3.97, 3.80 s) |
| Production frontend build, selector unset                            | Passed, exit 0; existing large-chunk warning                         |
| Production build with `f067-bridge`                                  | Correctly rejected before build output, exit 1                       |

The first full invocation was stopped after code review identified that MSAL can return a fresh account object for the same session. Authentication now memoizes the session and invalidates it on active-account events; two additional tests cover these cases. The revised focused run supersedes the earlier focused evidence for the final source; overlapping test counts are not additive.

The completed full-suite failure was `API mode authenticates the protected request without a browser Organization hint`, at `react/test/MapPreview.test.jsx:164:30`: `TypeError: Cannot read properties of undefined (reading 'options')`. The focused diagnostic instead failed `sign-out unmounts already rendered protected data immediately`, at `react/test/MapPreview.test.jsx:267:16`: `TypeError: Cannot read properties of undefined (reading 'remove')`. These are test-body errors accessing an absent mock map, not timeout, cleanup or process-start failures. The protected-request assertion passed in the focused diagnostic, while its sign-out assertion failed.

The tests wait for a rendered request button, then immediately access a map instance created by a React effect. Effect completion versus DOM visibility is a plausible timing issue, but causation is not established. Map components, Map Preview tests, global test setup and Vitest configuration match the baseline byte-for-byte in Git. The separate archive contains exact commit `8deda6d475cdae1ee7889d8c7ecde117d3ce7d89` and reused the same installed dependency versions without moving any checkout. Its four passing runs do not prove the failures are pre-existing or that SEC-003 is unrelated. No unrelated repair or repeated full-suite retry was attempted. The full-suite requirement remains unsatisfied: **no staging or commit is authorized by this result**.

Commands (using the Node 24 executable):

```text
node node_modules/vitest/vitest.mjs run --config vitest.config.mjs --maxWorkers=1 --no-cache react/test/DevelopmentCallback.test.js react/test/MsalCompatibility.test.jsx react/test/SignedOutRoute.test.jsx react/test/ServingConfiguration.test.js react/test/StaffAuthentication.test.js react/test/AIPreviewPage.test.jsx react/test/AdminPreviewPage.test.jsx
node --test --test-concurrency=1 test/MsalRedirectBridge.test.mjs test/DevelopmentCallbackServing.test.mjs test/VitePrivateFiles.test.mjs
node node_modules/vitest/vitest.mjs run --config vitest.config.mjs --maxWorkers=1 --no-cache
node node_modules/vitest/vitest.mjs run --config vitest.config.mjs --maxWorkers=1 --no-cache react/test/MapPreview.test.jsx
node node_modules/vite/bin/vite.js build react --outDir ../dist-react --emptyOutDir
```

Sanitized logs and explicit exit-code records are retained locally under ignored `node_modules/.cache/sec003-evidence/`. The baseline archive/extraction is removed after diagnostics. Exact-path HTTP checks used temporary ephemeral IPv4 loopback servers, closed in `finally`; no F067 API/frontend service was started. The rejection probe restored its process-scoped selector afterward. No environment file was edited. No frontend lint script exists. Node emitted existing typeless-package warnings during the full suite. Formatting/whitespace checks cover the scoped edits; no backend/database suites were run because this task prohibits database operations and changes only frontend behavior.

## Review checkpoint

All 14 intended source/test/documentation files remain unstaged on `codex/sec003-msal-redirect-bridge`; HEAD remains the SEC-002 baseline. The active F067 UAT checkout remains clean at `a022a4ea1adc4563f38507c0ba22ea35f5ac12de`; the SEC-002 checkout remains clean at `8deda6d475cdae1ee7889d8c7ecde117d3ce7d89`.

Recommendation: independent architectural review may inspect this uncommitted implementation, but local commit and UAT activation remain NO-GO until the full-suite failure is diagnosed and the applicable validation gate passes. Any unrelated Map Preview repair needs separately approved scope. Approved Entra configuration handoff, administrator-approved URI updates, identity/consent verification, SEC-002 loopback preflight and explicit UAT authorization remain prerequisites. Real authentication, browser token/renewal/logout acceptance, screen-reader and native-zoom acceptance are not certified by these offline tests.
