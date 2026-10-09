# F060.4A-1 — HTTP authority hardening and evidence

Status: security review approved at the 2026-10-09 final checkpoint. Staging,
committing and pushing the exact 16-file F060.4A-1 scope on
`codex/http-authority-hardening` are authorized. Merge, deployment and migration
remain unauthorized. Validation limitations below remain unchanged.

## Baseline and scope

Authoritative main was clean at
`1751922c77039d0c41380f5e861f22d666025008`, 0 ahead / 0 behind the local
`origin/main` reference; the remote was not contacted. Work is isolated on
`codex/http-authority-hardening` in `.local-uat/http-authority-worktree`.

Only HTTP hostname authority, its evidence, and factual serving-status
documentation are changed. F060.3C-2e operator execution/IAM/JIT/job-runner/audit,
operator configuration, database roles/grants and Migration 49 are untouched.
No Migration 50, schema change, dependency, UI, edge, DNS, TLS, cache policy,
CORS, throttling, hosting route or public-link implementation is introduced.

## Authority contract

The existing chain remains middleware → trusted host selection → shared
`normalizeHostname` → `TenantResolverService` → registry/Organization query →
frozen resident context → explicit service Organization arguments.

`selectTrustedHost` now requires Node's `rawHeaders` in addition to the collapsed
header map and immediate socket peer. It counts authoritative field names
case-insensitively and requires exactly one original field. The original value
must match the scalar projection in `headers`; absent evidence, repeated fields
(including identical values), arrays and inconsistent projections fail closed.
The existing normalizer rejects comma-combined values and invalid hostname
syntax. There is no second canonicalizer or resolver.

Direct mode selects only Host. Forwarded mode first checks the immediate peer
against the existing explicit address/CIDR policy, then selects only
X-Forwarded-Host. There is no Host fallback. Forwarded is ignored in both modes;
non-authoritative headers do not participate in tenant selection. Express trust
proxy stays disabled.

Malformed authority attaches `invalid_authority` with the existing sanitized
`malformed_host` reason; the resident accessor produces generic HTTP 400.
Middleware still continues, preserving unrelated health/staff/non-tenant
contracts. Untrusted forwarded peers retain generic 404. Valid unknown,
unverified, inactive/deactivated/revoked and inactive-Organization bindings
retain generic 404; registry exceptions retain generic 503. Invalid authority
never reaches the registry, so 400 cannot disclose registration state. This
is not a guarantee that every HTTP request reaches Nest: Node may independently
reject invalid HTTP syntax first.

The log sanitizer allowlists the new resolution status without adding raw host,
forwarded chain, Organization identifiers or operator audit fields.

## Evidence design

`http-authority.e2e.test.ts` boots real AppModule/Nest/Express applications on
ephemeral IPv4 loopback ports in direct and trusted-loopback forwarded modes.
It writes literal TCP requests, including repeated mixed-case Host or
X-Forwarded-Host fields. The real middleware, selector, normalizer, resolver,
resident accessor/controller and exception filter execute. The domain repository
and response service are synthetic doubles; DatabaseService is replaced and
no PostgreSQL connection is made. This proves HTTP authority wiring, not
database predicates or live production proxy configuration.

The tests count repository calls, check tenant A versus a second active tenant B,
reject duplicate/empty/missing/comma/malformed authority, ignore non-authoritative
headers, reject browser selector substitution, preserve 404/503 and preserve
health/staff admission. Each duplicate test reports whether rejection occurred
in Node or at the Nest accessor, using the server correlation header as evidence.

On supported Node **v24.19.0**, duplicates of both authoritative headers reached
Nest and were rejected there with 400, with zero additional registry calls.
This is actual socket evidence, not the earlier IncomingMessage-only probe.
The repository supports Node `^20.19.0 || >=22 <25`; its container currently
names Node 22. A separate Node 22 execution has not been performed.

Existing normalization, resolver and propagation tests retain case/trailing-dot/
port/IDNA acceptance, invalid-input rejection, active/verified/Organization
conditions, no development fallback, and resident/staff authority separation.
The registry/database E2E fixture changes only its expected malformed-host
statuses from 404 to the authorized 400; valid unknown hosts remain 404.

The new TypeScript-syntax boundary assertion checks the selector/canonicalizer/
registry call boundaries and prevents configuration/browser fallback in the
registry branch. It is complementary to behavioural tests, not a substitute
for them or a proof against arbitrary future server code.

## Documentation reconciliation

Current resolver, middleware, decorator, TenancyModule and environment type
comments now describe implemented guarded serving and real consumers. ADR-025
and the security framework have explicit dated factual amendments; historical
rationale and accepted architecture are retained. Production prerequisites
remain separate and are not represented as implemented infrastructure.

## Validation history

Commands run from `server` unless a different directory is stated. This shell
has Node but no npm executable. The attempted `npm run test:compile` could not
start (`npm` not found); subsequent commands directly invoke the existing
package-script tools. No package installation or dependency upgrade occurred.

| Invocation                                                                                           | Outcome                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:compile`                                                                               | Did not start: npm is unavailable in this shell                                                                                                                     |
| Initial `node node_modules/typescript/bin/tsc -p tsconfig.test.json`                                 | No diagnostics; surrounding npm-discovery command ended 1 because no npm executable was found                                                                       |
| Standalone and subsequent test compilation                                                           | Passed except one intermediate TS2558 in the new HTTP test; replaced unsupported generic with a typed Server assertion; subsequent compilation passed               |
| First raw HTTP run: `node --test --test-concurrency=1 dist-test/test/e2e/http-authority.e2e.test.js` | 16 passed, 0 failed, 0 skipped                                                                                                                                      |
| Initial focused tenancy run, serial (files below)                                                    | 95 passed, 0 failed, 0 skipped                                                                                                                                      |
| Full backend units: `node --test --test-concurrency=1` from `dist-test/test/unit`                    | **677 tests: 674 passed, 3 failed, 0 skipped**, exit 1                                                                                                              |
| Full API E2E: `node --test --test-concurrency=1` from `dist-test/test/e2e`                           | **85 tests: 83 passed, 1 failed, 1 skipped**, exit 1                                                                                                                |
| Exact-baseline focused reproduction (three existing files below)                                     | **39 tests: 35 passed, 4 failed, 0 skipped**, exit 1; reproduces every full-suite failure                                                                           |
| Final combined tenancy + raw HTTP run after corrections and expanded boundary assertion              | **111 passed, 0 failed, 0 skipped**, exit 0                                                                                                                         |
| Boundary-only follow-up after TypeScript deprecated-API correction                                   | 1 passed, 0 failed, 0 skipped, exit 0; final test compilation passed; no application code changed                                                                   |
| Typecheck: `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`                          | Passed initially and after application/test typing corrections                                                                                                      |
| Build: `node node_modules/typescript/bin/tsc -p tsconfig.build.json`                                 | Passed initially and after application corrections                                                                                                                  |
| Full lint: `node node_modules/eslint/bin/eslint.js .`                                                | First run: 17 new-code errors; second: 2 remaining HTTP-server typing errors; third: passed                                                                         |
| Boundary-test lint after dependency-graph expansion                                                  | First: 1 TypeScript 6 deprecated `isTypeOnly` error; changed to `phaseModifier`; final targeted lint passed                                                         |
| Full package-script formatting scope                                                                 | **Failed: 426 warned files, all untouched by this change**; no broad formatting performed                                                                           |
| Changed-source formatting and final whitespace/scope review                                          | All 13 changed TypeScript files pass Prettier; git diff --check passed; 3 added Markdown links resolve; scoped sensitive-pattern scan and manual diff review passed |

Focused files: tenant-hostname, tenant-host-source, tenant-resolver,
tenant-resolution, tenant-resolution-middleware, tenant-authority-propagation,
attachment-tenant-authority and http-authority-boundary, each under
`dist-test/test/unit/*.test.js`. Focused counts overlap the full suite and are
not added to its distinct total. Raw HTTP subtests likewise overlap API E2E.

Neither main's `.env.test.local` nor `server/.env.test.local` is available;
`TEST_DATABASE_URL` is absent. Database-backed registry tenancy and cross-tenant
integration validation cannot be claimed passed. No development database or
borrowed credentials are used. No production or real-edge UAT was performed.

### Baseline failures and reproduction

The full suites ran against the first compiled implementation. Later edits
corrected typing/lint and strengthened the syntax-based assertion; the final
111-test focused rerun covers all changed runtime behaviour. It does not erase
or relabel either failed full-suite invocation.

An ignored `git archive HEAD server` snapshot at the exact baseline was compiled
with the same installed dependencies and Node v24.19.0. The following command
reproduced all four failures without feature changes:

`node --test --test-concurrency=1 dist-test/test/unit/attachment-multipart-parser.test.js dist-test/test/unit/tenant-domain-operator-cli.test.js dist-test/test/e2e/attachment-multipart-security.e2e.test.js`

- Unit: “SEC-001 the configured parser enforces file size, count and field-name length” — boundary upload returns Multer LIMIT_FILE_SIZE instead of success.
- E2E: “SEC-001 parser limits and malformed multipart surface sanitized HTTP failures” — expected 201, received 413.
- Unit: “there is no discovery, onboarding, raw-SQL or database-url surface” — emitted CLI text contains a CR before LF; exact string assertion expects no CR.
- Unit: “the operator cannot supply or override the schema” — same CRLF-sensitive assertion.

These are baseline/environment regression findings, not passing tests. Neither
multipart controls nor operator files/tests were edited. No timeout, assertion,
expected multipart behaviour or lint rule was weakened. The only changed
existing HTTP expectations are the explicitly authorized malformed-host
404 → 400 cases.

Full formatting used the package-script glob scope, from the worktree root:
`node server/node_modules/prettier/bin/prettier.cjs --check 'server/{src,test,migrations}/**/*.{ts,json,md}' 'server/scripts/*.mjs' 'server/*.{json,md,yml}'`.
Every warned path was checked against the changed/new file set: zero overlap.
The source changes were individually formatted and checked.

### File inventory

Modified:

- `server/src/tenancy/tenant-host-source.ts`
- `server/src/tenancy/tenant-resolution.middleware.ts`
- `server/src/tenancy/tenant-context.ts`
- `server/src/tenancy/resident-tenant.decorator.ts`
- `server/src/common/logging/log-sanitization.ts` — only request-tenancy status vocabulary/comment; no operator audit change
- `server/src/tenancy/tenant-resolver.service.ts` — comments only
- `server/src/tenancy/tenancy.module.ts` — comments only
- `server/src/config/environment.ts` — comments only
- `server/test/unit/tenant-host-source.test.ts`
- `server/test/unit/tenant-resolution-middleware.test.ts`
- `server/test/e2e/registry-tenancy.e2e.test.ts`
- `docs/architecture/decisions/ADR-025-trusted-production-organization-resolution.md`
- `docs/security/SECURITY_FRAMEWORK.md`

Added:

- `server/test/e2e/http-authority.e2e.test.ts`
- `server/test/unit/http-authority-boundary.test.ts`
- This feature record.

Scratch logs and the pristine baseline snapshot are ignored local artifacts.
Dependencies are reused through an ignored worktree-local node_modules junction;
no installation, lockfile update or source modification occurred on main.

## Pre-approval repository snapshot

Branch `codex/http-authority-hardening` remains at the exact baseline HEAD,
0 ahead / 0 behind local `origin/main`. Thirteen tracked files are modified and
three files are new, all unstaged; the index is empty. Authoritative main
remains clean at the expected checkpoint. No Migration 50 or Claude/F060.3C-2e
file was changed. Nothing was staged, committed, pushed or deployed.

## Final checkpoint authorization

Security review is approved. The user authorized a new commit with subject
`fix(tenancy): harden HTTP authority selection` and a push of this branch only.
The snapshot above records the earlier pre-approval state. Final Git hashes and
remote verification are reported after the authorized operations. No merge to
main or deployment is authorized.

Registry-backed hostname serving already exists; F060.4A-1 hardens HTTP authority
selection and rejects duplicate wire authority. It does not implement edge, TLS,
CDN or routing. Remaining production blockers belong to later F060.4A slices.
