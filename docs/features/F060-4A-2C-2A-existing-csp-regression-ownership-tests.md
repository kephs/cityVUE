# F060.4A-2C-2A — Existing CSP Ownership & Regression Tests

**NO CSP BEHAVIOR CHANGES IN F060.4A-2C-2A.**

**NO CSP REPORT-ONLY POLICY IS INTRODUCED.**

**NO HSTS OWNERSHIP CHANGES.**

**NO STATIC-ORIGIN POLICY IS IMPLEMENTED.**

## Baseline and scope

Started from freshly fetched origin/main at `01bf9ee1a0004ac66dba66ab2ca38c5777919eea`, in isolated branch `codex/f060-4a-2c-2a-csp-regression-tests`. Starting tree/index were clean, 0 ahead / 0 behind. Fetch succeeded with the previously observed stale Claude worktree cleanup permission diagnostic; no repair was attempted. Claude's F062 persistence worktree is outside scope.

Only the existing [API cache/header test](../../server/test/e2e/api-cache-headers.e2e.test.ts) and this document change. Extending the existing focused header suite reuses its real application bootstrap, synthetic service providers and unchanged guard-refusal coverage; no second application harness or helper module is introduced. No production source, package, configuration, F061/F062, database, migration, deployment, React/Vite or worker file changes.

Inspected authorities: [readiness](F060-4A-2C-0-cache-browser-security-policy-readiness.md), [API cache foundation](F060-4A-2C-1A-api-cache-header-preservation-foundation.md), [CSP compatibility assessment](F060-4A-2C-2-0-csp-compatibility-report-only-readiness.md) and [ADR-030](../architecture/decisions/ADR-030-production-serving-contract.md). Current source agrees with their current-behavior descriptions. Earlier no-universal-cache-default statements in 2C-0 describe its historical checkpoint, before 2C-1A.

## Exact current header inventory

[Bootstrap](../../server/src/bootstrap.ts) registers the API cache default, uncustomized Helmet 8.3.0 and then CORS before application initialization. The exact general enforcing CSP asserted over HTTP is:

```text
default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests
```

| Header                              | Asserted value                                            |
| ----------------------------------- | --------------------------------------------------------- |
| Content-Security-Policy             | Exact policy above; eleven unique directives              |
| Strict-Transport-Security           | max-age=31536000; includeSubDomains                       |
| X-Frame-Options                     | SAMEORIGIN                                                |
| X-Content-Type-Options              | nosniff                                                   |
| Referrer-Policy                     | no-referrer                                               |
| Cache-Control                       | no-store by default; preserved explicit private, no-store |
| Content-Security-Policy-Report-Only | Absent                                                    |
| Permissions-Policy                  | Absent                                                    |

This is the requested regression inventory, not an exhaustive list of every Helmet response header. Existing tests already asserted these exact wire values, cache precedence and absent headers on successes, filtered errors, malformed JSON, unmatched paths, guard/throttler refusals, redirects and preflight. Those assertions remain. They test the Nest/API surface, not Vite, HMR or an independently hosted React document.

## Strengthened regression contract

A local test-only parser splits directives, normalizes whitespace and source ordering, rejects duplicate directive names and duplicate source tokens, and compares all eleven directive names/value sets explicitly. The pre-existing exact serialized comparison also remains. Missing CSP, missing object-src, unexpected directives or broadened script/framing/default sources fail.

Explicit token assertions reject unsafe-eval and wildcard sources, including wildcard hostnames, in every directive. unsafe-inline must occur only in style-src. Its existing presence and broad HTTPS style/font allowance are descriptive baseline facts, not approval of long-term retention or a permanent requirement. Nothing adds unsafe-inline elsewhere.

A focused mutation test proves that absent/empty policies, duplicate identical or conflicting script directives, missing object-src, unsafe-eval, script unsafe-inline, an unexpected script origin and wildcard script-src/default-src/frame-ancestors are refused. Whitespace-only differences remain parseable. This is a small test helper, not a general CSP parser library.

Future explicitly reviewed CSP migrations must deliberately update these expectations and the ownership/compatibility evidence. Passing this regression contract is not a veto on approved future policy changes and does not establish browser compatibility.

## Attachment separation and limits

The [attachment controller](../../server/src/attachments/attachment.controller.ts) distinguishes previews from protected downloads. The existing real preview HTTP test retains general Helmet CSP, private, no-store, image MIME, attachment disposition and bytes. Existing HTTP origin/workforce guard denials remain covered without guard overrides.

The protected download method explicitly replaces the general CSP with:

```text
default-src 'none'; sandbox
```

The new controller-boundary test seeds a response double with actual ordinary API headers, invokes the real unchanged download controller using its existing synthetic service seam, and verifies exact replacement with only default-src and sandbox. It also checks private, no-store, nosniff, retained HSTS/framing/referrer headers, absent Report-Only/Permissions-Policy, image MIME, named attachment disposition and streamed bytes. It never merges the policies.

This direct controller test is **not an authenticated protected-download HTTP test**, database authorization test or storage proof. Authentication and database permissions are not bypassed in production or changed here. Its purpose is deterministic header-writing and StreamableFile regression coverage, alongside the retained real HTTP preview/denial tests. No database credentials or external network access are needed.

## Current versus target ownership

| Layer                                      | Current                                                                                    | Separately reviewed production target                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Nest / Helmet                              | Owns headers on its API/document responses, including application-emitted HSTS             | Nest retains API response policy                                                |
| Attachment controller / privacy middleware | Owns specialized download CSP and attachment privacy/cache headers                         | Remains a distinct response class; do not merge with general policy             |
| API cache middleware                       | Default no-store; earlier explicit header preserved and later explicit header can override | No change here                                                                  |
| React static origin                        | No selected production serving implementation or established document CSP                  | Owns React HTML/static and applicable worker response policy                    |
| Public edge                                | No ownership transition implemented by this slice                                          | Owns public HSTS and edge-generated responses after infrastructure verification |

Application HSTS remains max-age=31536000 with includeSubDomains and without preload. A future transition requires a real production edge, approved hostname/subdomain implications and proof that public transport protection has no gap. Do not remove application HSTS merely because edge ownership is the target.

CSP frame-ancestors self and SAMEORIGIN both remain asserted. MSAL authenticated redirect, silent-acquisition and callback/framing compatibility UAT remains a prerequisite for future framing changes. No permission to tighten or broaden framing follows from these API tests.

Report-Only remains absent. F060.4A-2C-2B owns any future candidate, with an owned privacy-reviewed reporting collector required before reporting activation. Permissions-Policy remains absent/deferred pending browser capability evidence. No reporting endpoint is added.

React document CSP coverage remains unresolved until production static serving is selected. API headers do not protect a separately served React shell. Removal of unsafe-inline is unproven; MapLibre does not currently justify unsafe-eval; blob/image allowances remain evidence-driven. No development-origin/HMR allowance enters these policy expectations.

## Validation

The focused compiled header suite passed **17/17**, with zero failures/skips (291.527 seconds). This includes the original fifteen tests plus two new tests; existing HTTP header checks were strengthened throughout. The focused result is supplemental to the full API E2E invocation, not an additional distinct-test total.

Eight relevant compiled unit files passed **94/94**, with zero failures/skips (142.582 seconds): attachment.domain, attachment.service, attachment-tenant-authority, attachment-storage, attachment-multipart-parser, environment, serving-environment and tenant-resolution. These cover attachment security and the bootstrap serving boundary without database access.

Full compiled API E2E (`node --test --test-concurrency=1 --test-reporter=tap`) completed with **104 tests: 103 passed, 0 failed, 1 skipped** (231.779 seconds). The existing database-backed E2E guard skipped because TEST_DATABASE_URL was absent; it was not executed or counted as passed. The 17 focused header tests are included in this total. API E2E and the relevant unit subset together cover 198 distinct tests: 197 passed and one skipped.

Backend typecheck (tsc -p tsconfig.json --noEmit), build (tsc -p tsconfig.build.json), test compilation (tsc -p tsconfig.test.json) and full backend lint (eslint .) passed on the final test source. Initial compilation/typecheck exposed a test-helper narrowing error, and initial lint exposed a void-callback style error; both were corrected only in the new test code before successful validation. A focused lint invocation used the wrong working-directory-relative path and ran no checks; the subsequent full backend lint passed.

Changed-file Prettier, seven local documentation links, seven unique heading anchors, whitespace/control-character checks and git diff --check passed. Existing dependency manifests/lockfile match the reused ignored local dependency junction; no package install occurred.

The optional full backend unit run was not performed: this test-only slice used the relevant 94-test subset on a slow host. No claim is made about broad startup/CRLF-sensitive suites, and no timeout, logging implementation or pipeline assertion was changed. No database integration or browser UAT was executed. No runtime implementation or security policy change is authorized by this slice.

No push, deployment or F060.4A-2C-2B work is authorized.

**STOP FOR F060.4A-2C-2A REVIEW.**
