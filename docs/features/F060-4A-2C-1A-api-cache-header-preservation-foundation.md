# F060.4A-2C-1A — API Cache & Header Preservation Foundation

Status: implementation awaiting security review. This narrows the approved F060.4A-2C-1 feasibility work to the existing API listener.

**NO STATIC-ORIGIN CACHE POLICY IS IMPLEMENTED.**

**NO CSP POLICY IS REMOVED OR REPLACED.**

**NO HSTS PROTECTION IS REMOVED.**

**NO CDN CACHE ACTIVATION IS INTRODUCED.**

## Baseline and feasibility

Continued the clean isolated branch `codex/f060-4a-2c-1-static-cache-security-headers` at `9fd79e35eb33ad4d5e8c0e75f9e0f51ea701b326`, matching origin/main at the initial fetch, 0 ahead / 0 behind. Reviewed assessment commit `68e27a8b259b992b586d06800a26db861419589b` is an ancestor. No branch restart, rebase or unrelated worktree mutation occurred.

The [readiness assessment](F060-4A-2C-0-cache-browser-security-policy-readiness.md), [ADR-030](../architecture/decisions/ADR-030-production-serving-contract.md) and direct feasibility-review correction govern this slice. Repository source, not historical status prose, establishes current protections.

| Gate                   | Finding and disposition                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — static origin      | BLOCKED. No approved production static server exists. The Nest container serves the API; historical Firebase fallback is not the approved private static origin.                                         |
| B — immutable assets   | BLOCKED for activation. Vite 8.2.2 application and worker output templates contain hashes, but no verified release asset inventory/static classifier is implemented. No immutable cache policy is added. |
| C — API default        | PROVEN through the existing pre-init middleware seam. Explicit review authorized retaining specialized attachment private,no-store while adding a default. See lifecycle evidence below.                 |
| D — SPA fallback       | BLOCKED. React route declarations do not establish HTTP file/fallback behavior; no static implementation or asset-404 claim here.                                                                        |
| E — Permissions-Policy | DEFERRED. Source shows geolocation, camera input capture and clipboard writing. Header serialization alone cannot prove browser/document compatibility. No Permissions-Policy is added.                  |

## Small centralized change

[api-cache.middleware.ts](../../server/src/common/http/api-cache.middleware.ts) exports one Express RequestHandler, registered by [bootstrap](../../server/src/bootstrap.ts) immediately before the unchanged helmet() call and CORS registration. It sets Cache-Control: no-store only if response.hasHeader('Cache-Control') is false, then invokes next() synchronously. There is no response-finalization hook, intercepting setter, status/body mutation, path parsing or framework extension.

Nest registers its body parsers during app.init(); configureApplication is called before initialization/listen in the existing HTTP entry point and test harnesses. This ordering puts the default ahead of malformed-body errors, preflight termination, module privacy middleware, guards, controller headers and the exception filter. Later explicit headers retain their ordinary precedence. An already-present header also remains untouched.

The entire dedicated Nest HTTP listener receives the default, including health, public/staff/admin APIs, API errors, redirects, OPTIONS, documentation routes and unmatched paths. This intentionally avoids a fragile /api string matcher. Nest is not the React static origin; a future static server must not reuse this registration blindly.

There is no production/development branch in this API default: API data is no-store in both. Vite/HMR/static serving remains unchanged. No new package, configuration flag, tenant identifier, Azure dependency or database access is introduced.

## Cache contracts preserved

| Response class                                                                 | Effective policy                                                       |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Ordinary API success and errors without a specialized policy                   | no-store                                                               |
| Existing controller-declared no-store                                          | no-store, unchanged                                                    |
| Attachment privacy middleware, previews and protected downloads                | private, no-store, unchanged                                           |
| An earlier middleware or later explicit handler policy                         | Existing explicit value wins; this is a default, not a policy enforcer |
| Static HTML, hashed/nonhashed files, tenant-config files, SPA fallback and CDN | Not implemented by this slice                                          |

Repository searches found explicit API cache values of no-store and private, no-store. Existing attachment policy metadata can explicitly set no-store, while attachment content/privacy handling retains private,no-store. Those declarations are not rewritten. A future cache-permitting endpoint policy still requires separate review; this default deliberately cannot prevent a later handler from replacing it.

The focused tests use the real attachment preview controller and privacy middleware with a synthetic service result, and real attachment origin/workforce guards for refusals. They do not replace authorization guards. This proves cache/header order and response preservation, not database/storage authorization correctness. Existing attachment tests provide additional regression coverage. The protected download controller's specialized sandbox CSP and disposition remain untouched.

## Existing security baseline

The bootstrap still calls uncustomized helmet(). The following exact values are captured by HTTP regression assertions:

| Header                              | Existing value retained             |
| ----------------------------------- | ----------------------------------- |
| X-Content-Type-Options              | nosniff                             |
| Referrer-Policy                     | no-referrer                         |
| X-Frame-Options                     | SAMEORIGIN                          |
| Strict-Transport-Security           | max-age=31536000; includeSubDomains |
| Content-Security-Policy             | The exact policy below              |
| Content-Security-Policy-Report-Only | Absent; none introduced             |
| Permissions-Policy                  | Absent; deferred                    |

```text
default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests
```

The broad style/font sources and style unsafe-inline are **existing Helmet defaults**, not newly approved allowances. No unsafe-eval, wildcard source, new CSP enforcement or Report-Only header is introduced. The unchanged attachment download response separately sets `default-src 'none'; sandbox`. Its presence is not a defect to remove.

nosniff is checked alongside actual JSON/image MIME in the focused suite. no-referrer and redirect Location remain unchanged; no sensitive query/reference is added to a redirect. Existing authentication, CORS allowlists/credentials behavior and SAMEORIGIN remain intact. There is no claim that API headers secure the independently served React document.

## Ownership and deferred follow-up

Current: Nest owns its existing Helmet/security responses and now supplies default API no-store. Attachment handlers retain their specialized privacy behavior. Existing application HSTS remains active.

Target under ADR-030: static origin owns HTML/static headers; Nest owns API response policy; edge owns public HSTS and edge-generated responses. This implementation does not transition that ownership.

Future HSTS removal requires an existing production edge, verified edge HSTS on applicable responses, approved customer-domain/subdomain implications and evidence that no protection gap can occur. No includeSubDomains/preload change or new HSTS directive is made here.

Future F060.4A-2C-2 is not CSP introduction from zero. It must inventory the current enforcing policy, compare production resource needs, decide whether controlled Report-Only evaluation is appropriate before tightening/replacement, and preserve protection until the reviewed replacement is ready. MSAL redirect/silent iframe compatibility remains a browser review item.

F060.4A-2C-1B — Static-Origin Cache & SPA-Fallback Foundation remains blocked until a production static-serving implementation is approved. No server is selected here. HTML/runtime/nonhashed no-store, verified hashed-public immutable policy, MIME mapping and missing-file/SPA separation must be implemented there, not inferred from this API work. Actual build inventory and successful-file identity must precede immutable policy; a filename regex is not sufficient.

CDN hostname/deployment isolation, cache activation and edge-generated redirects/errors still require infrastructure evidence. API middleware cannot control upstream failures. No static/edge test is claimed, and the dedicated API listener's JSON 404 tests are not SPA-fallback proof.

## Security searches and scope

Changed runtime files introduce only one Cache-Control literal, no-store, and its registration. Header names CSP/HSTS/framing/nosniff/referrer appear in new test expectations documenting unchanged behavior. The test's unsafe-inline and https: matches pin the existing CSP; its localhost origin is synthetic CORS test input, never production policy. Private,no-store test values prove preservation. No new cache value permits shared API storage.

Permissions-Policy appears only in an absence assertion and this documentation. No wildcard CORS, unsafe-eval, CSP policy configuration, HSTS configuration, static policy, dependency or deployment change is added. Existing CSP/HSTS matches in bootstrap's dependency and the attachment controller remain baseline evidence.

Exact intended scope:

- server/src/common/http/api-cache.middleware.ts
- server/src/bootstrap.ts
- server/test/e2e/api-cache-headers.e2e.test.ts
- docs/features/F060-4A-2C-1A-api-cache-header-preservation-foundation.md

F061, F062, integration runtime, migrations, database types/roles/grants, deploy/, Azure pipelines, operator implementation, React/Vite/static configuration and package manifests/locks remain unchanged.

## Validation record

Focused HTTP tests cover normal 200/201, filtered 400/401/403/404/409/429/500, malformed JSON before controllers, unmatched routes, prior/later explicit policies, real attachment preview and guard refusals, real throttling, redirects and CORS preflight. DatabaseService and AttachmentService are synthetic replacements; no live database or external service is needed for these tests.

Validation uses the existing TypeScript, ESLint, Prettier and Node test runner commands. No dependencies were installed or changed. The ignored worktree dependency junction points at an existing dependency tree with identical package manifests and lockfile.

| Check                                                                                                               | Result                                                                    |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Focused compiled API cache/header E2E                                                                               | 15 passed, 0 failed, 0 skipped                                            |
| Full compiled backend unit suite, Node default concurrency                                                          | 957 tests: 954 passed, 3 failed, 0 skipped; not a clean full-suite pass   |
| Full compiled API E2E, `node --test --test-concurrency=1 --test-reporter=tap`                                       | 102 tests: 101 passed, 0 failed, 1 skipped                                |
| Supplemental unchanged development-startup, logging-sanitization and tenant-domain-operator-platform suites, serial | 34 tests: 32 passed, 2 failed; supplemental, not added to distinct totals |
| Backend typecheck, `tsc -p tsconfig.json --noEmit`                                                                  | Passed                                                                    |
| Build, `tsc -p tsconfig.build.json`                                                                                 | Passed                                                                    |
| Test compilation, `tsc -p tsconfig.test.json`                                                                       | Passed, including after fixture lint corrections                          |
| Changed TypeScript formatting                                                                                       | Passed                                                                    |

The full unit failures are preserved:

- `development-startup.test`: the configured compiler/application startup subprocess exceeded its existing 60-second timeout, with `ETIMEDOUT`; the supplemental run also timed out. This host-dependent startup check remains unresolved, not passed.
- `logging-sanitization.test`: the API startup subprocess returned a null exit status under the existing 10-second subprocess limit in the full run. The unchanged suite passed in the supplemental serial run. That result does not erase the original failure.
- `tenant-domain-operator-platform.test`: the existing parameters-block expression requires LF line endings, but the Windows checkout has CRLF. The expression matches the HEAD blob and fails against the checked-out YAML; content is otherwise identical after CRLF normalization. The supplemental run reproduces the failure. No pipeline, existing test, line ending or timeout was changed to obtain a pass.

The database-backed E2E guard was preserved: `TEST_DATABASE_URL` was absent, so its test was skipped, not executed or passed. No database credentials were supplied. Existing attachment, bootstrap, security, tracing, metrics and privacy coverage ran within the reported suites. Frontend/shared checks are not applicable to this server-only change.

Initial checks against an incomplete dependency junction failed on missing already-declared OpenTelemetry packages and optional Content-Type assertion typing. The junction was corrected without installing packages, and the new fixture typing was fixed. Initial lint found five issues in the new fixture; those were corrected without altering production behavior. An earlier lint invocation against incomplete dependencies was interrupted. Final checks supersede these setup/fixture attempts, while the full-suite failures above remain part of the result.

Final full backend lint (`eslint .`) passed after the fixture corrections. The final focused HTTP rerun also passed all 15 tests. Documentation validation passed all four relative links and eight unique heading anchors; control-character/trailing-whitespace checks and `git diff --check` passed. The index is empty, the exact four-file scope is intact, HEAD is unchanged, and the branch is 0 ahead / 0 behind the local origin/main reference.

The slice is ready for security review with the unit-suite caveats above; it is not a claim of clean full-suite validation. Staging/commit requires explicit review acceptance of those caveats and separate authorization.

No staging, commit, push, deployment, F060.4A-2C-1B or F060.4A-2C-2 work is authorized.

**STOP FOR F060.4A-2C-1A SECURITY REVIEW.**
