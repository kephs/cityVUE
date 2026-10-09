# F060.4A-2A — Production Serving Configuration

Status: REACT VALIDATION GATE COMPLETE WITH DOCUMENTED BASELINE EXCEPTION. Synchronized with authoritative main at `d6676d7`; the preserved serving ADR is now ADR-030 and the operator-platform ADR-029 remains intact. Production-serving implementation and focused tests are unchanged. Post-synchronization validation and the local commit gate are complete, with the separately documented operator CRLF harness limitation. Ready for final F060.4A-2A acceptance review. The latest reconciliation checkpoint below supersedes historical pending-ADR dispositions. Historical failed invocations remain failures.

## Baseline and scope

Started from clean main at `ce281c4ddf0b23f55124cd594dc536fcd9087eee`,
0 ahead / 0 behind local origin/main; no remote contact. Work is isolated on
`codex/production-serving-configuration` in `.local-uat/production-serving-worktree`.
The user approved configuration implementation and a local commit conditional
on clean implementation and passing validation. Push/deployment are prohibited.

The approved architecture is recorded in [ADR-030 — Production Serving Contract](../architecture/decisions/ADR-030-production-serving-contract.md), restored after the Production Operator Platform decision landed. The historical allocation/release evidence below is retained.
Only repository configuration and validation belong to this slice.

## Server contract

AppModule uses `validateServingEnvironment`, which composes the existing
`validateEnvironment`. The extra rules apply only to NODE_ENV=production HTTP
applications. Operator and migration entry points retain the existing validator.
No operator execution, identity, database-role or grant behavior changes.

| Value                       | Production HTTP requirement                                               |
| --------------------------- | ------------------------------------------------------------------------- |
| NODE_ENV                    | production                                                                |
| CITYVUE_DEPLOYMENT_PROFILE  | client                                                                    |
| TENANT_RESOLUTION_STRATEGY  | registry                                                                  |
| TENANT_HOST_SOURCE          | forwarded                                                                 |
| TENANT_TRUSTED_PROXY_CIDRS  | 1–64 explicit final-hop addresses/CIDRs; no empty members or /0           |
| DEVELOPMENT_ORGANIZATION_ID | absent                                                                    |
| REQRO_PUBLIC_HOSTNAMES      | 1–64 distinct canonical public DNS hostnames, comma-separated             |
| CORS_ORIGINS                | 1–64 distinct exact HTTPS origins whose hostnames occur in that inventory |

The inventory reuses the existing normalizer and requires its canonical output:
lowercase ASCII/punycode, no ports, trailing dots, IP literals, localhost/local
names, wildcards, URL syntax or empty members. Total inventory/proxy/origin input
is bounded to 16,384 characters per field. Whitespace around list entries is
allowed. Production origins use standard HTTPS port 443 implicitly; no explicit
port, trailing slash, path, credentials, query or fragment is accepted. Inventory
names need not all occur in CORS; every configured CORS origin must belong to it.

Configuration approval is an infrastructure responsibility. This validator
cannot prove DNS ownership, tenant membership or final-hop network isolation.
An explicitly inventoried provider/platform hostname is not an automatic fallback
and still requires the existing verified registry binding to serve resident data.
No provider-specific suffix policy or browser hostname inventory is introduced.

Existing development/test bypass restrictions, database TLS, credential-free CORS,
attachment Origin checks, Entra/MSAL, tracking and hostname verification remain.
The inventory does not become an Organization selector or resolver allowlist.
Zero active bindings still boot and resolve no residents; readiness is future work.

## Frontend contract

Set `VITE_CITYVUE_DEPLOYMENT_PROFILE=client` and `VITE_CITYVUE_DATA_SOURCE=api`
for the customer production build. Leave `VITE_CITYVUE_API_BASE_URL` absent/empty;
the existing parser returns `/api/v1`. Do not set it to `/api/v1`: explicit
overrides retain their absolute-URL grammar in development and are all forbidden
for client builds. Development service-request reads must remain disabled.

The Vite config validates resolved public environment values before building;
the runtime configuration reader invokes the same pure guard. Client mode
requires Vite PROD=true. Production API builds must explicitly select client.
Mode names alone do not bypass the guard; validation uses Vite's resolved PROD.
The default development profile preserves legacy/demo optimized builds and local
API overrides. Such artifacts are not customer-serving artifacts; release review
must verify the selected profile and provenance rather than equating minification
with production readiness. Browser settings are public build-time values, not
secrets or a remotely loaded runtime configuration document.

MSAL callbacks remain `${window.location.origin}/` for redirect and logout.
Approved staff entry origins still need exact existing registration; no identity
registration, staff-domain consolidation or authentication redesign is included.

## Local validation procedure

Use the existing root/server scripts. In a shell without npm, invoke their
installed tools directly. No dependencies are added. Production frontend build:
set the two VITE client/API values above, remove the API override and development
read switch, then run the existing `build:react` command. Build output is local,
not deployment. Keep database suites on a separately configured disposable test
database; absence is reported as skipped, never repaired with development data.

## Validation triage and coordination (2026-10-09)

Starting HEAD: `ce281c4ddf0b23f55124cd594dc536fcd9087eee`, branch
`codex/production-serving-configuration`, empty index, 9 modified tracked files
and 7 untracked additions. Local origin/main matched HEAD (0 ahead / 0 behind).
The remote was not contacted.

### ADR ownership gate

The user assigned ADR-029 and the ADR index to the Production Operator Platform workstream.
F060 relinquished both paths after preserving byte-identical copies of its
production-serving ADR and modified index, plus a Git binary patch containing
only its index change. SHA-256 checks verified both complete copies before
restoration/removal. Preservation is outside the repository at
`C:/Users/stKyle/.codex/visualizations/2026/10/09/01a1219e-0df6-7741-a893-50c4a24cb4d4/serving-evidence/adr-preserved/`.
It is not a commit artifact.

The index was restored to HEAD and F060's provisional untracked serving ADR removed in both
F060 worktrees. The other agent's files were not edited. This leaves 14 changed
files (8 modified, 6 untracked). No replacement ADR number is reserved. The
three F060 documentation references to the preserved ADR remain pending the
user's restoration gate; they must be reconciled before commit, not silently
redirected to the Production Operator Platform ADR-029.

### Reproducible comparison environment

Validation uses Node v24.19.0 and the existing package-script tools directly
because npm is unavailable in this shell. There was no dependency installation
or lockfile change. Clean detached baseline and feature-copy worktrees are
outside `.local-uat`, under the same visualization root as the evidence:
`serving-baseline` and `serving-feature`. A third unchanged baseline at
`.local-uat/serving-baseline-blocked` reproduces the denied-path condition.
All baseline checkouts start at the exact SHA above. Root/server node_modules
junctions use the same physical installed dependencies as the original feature.
Root and server lockfile hashes match across trees. No local environment or test
secret files were copied; inherited DATABASE_URL, TEST_DATABASE_URL, NODE_ENV
and VITE settings were absent. Tests supply their existing synthetic settings.

All remaining 14 feature files were verified byte-identical between original
and validation copy, and their tracked binary diffs matched. The subsequent
README formatting change was copied to the validation tree. The interrupted
first allowed-path React run was terminated at the ownership conflict and is
not a completed or passing invocation. Comparisons below were run sequentially
without concurrent validation from this task.

Evidence logs, exact command arguments, exits and durations are in
`serving-evidence/`, including `results.jsonl` and `environment.json`. Earlier
logs remain in the original feature worktree's ignored
`.local-uat/serving-validation/`. These logs and temporary worktrees are not
feature files and must not enter the commit.

### Every original failed test

The original full results remain failures: backend units 755 passed / 2 failed
of 757, API E2E 85 passed / 1 failed / 1 skipped of 87, shared 63 passed / 1 failed
of 64, React 895 passed / 15 failed of 910. The later unit total is 758 because
the fixed-diagnostic unit test was added before this triage, not because tests
were added or altered to repair these failures. Focused results overlap full
results and are not added to distinct test totals.

| File                                                        | Exact test name                                                                                                                         | Original error                                                                                                       | F060 path intersection                                                                                                                | Isolated/focused comparison and classification                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/test/unit/attachment-multipart-parser.test.ts`      | SEC-001 the configured parser enforces file size, count and field-name length                                                           | `MulterError: File too large`, `LIMIT_FILE_SIZE`, expected `undefined` at exactly 5 MiB                              | No: directly exercises the unchanged attachment interceptor/parser                                                                    | Exact-name runs fail identically on feature and unchanged baseline (each 0 passed / 1 failed). Proven baseline environment/dependency mismatch; see below.                                                                                                                                           |
| `server/test/unit/logging-sanitization.test.ts`             | migration, seed and API startup configuration failures never echo credentials or CA paths                                               | `AssertionError: main.js: Error`, `null !== 1` under the 10,000 ms spawn timeout                                     | Yes: real main/AppModule startup traverses the new wrapper and startup sanitizer                                                      | Exact-name run passes on both trees (1/1 each); two full-file reruns pass on each (8/8 each); final feature full units and serving/logging run also pass. Non-deterministic startup timing failure, not a reproduced deterministic baseline defect. Underlying machine scheduling cause is unproven. |
| `server/test/e2e/attachment-multipart-security.e2e.test.ts` | SEC-001 parser limits and malformed multipart surface sanitized HTTP failures                                                           | Expected HTTP 201, got 413 at exactly 5 MiB                                                                          | AppModule wrapper is traversed with NODE_ENV=test, where it delegates unchanged; multipart/body middleware is untouched               | Exact-name runs fail identically on feature and baseline (each 0 passed / 1 failed). Same proven baseline dependency mismatch as the unit failure.                                                                                                                                                   |
| `test/VitePrivateFiles.test.mjs`                            | Vite denies private development files while serving the frontend                                                                        | `403 !== 200` at line 80, application entry request                                                                  | Yes: imports changed Vite config; the deny policy itself is unchanged                                                                 | Both blocked-path trees produce the identical error (1 passed / 1 failed each). Both allowed-path full shared suites pass 64/64. Proven validation-path issue: `**/.local-uat/**` intentionally denies the application entry too.                                                                    |
| `react/test/IssueCreation.test.jsx`                         | a restricted source still requires deliberate supported-policy review                                                                   | Test timed out in 5000ms                                                                                             | No changed component/interaction path; supplied mock client                                                                           | Passes in both matched five-file runs; timed out again in first resumed full feature run. Timing-sensitive test/harness failure; full comparisons below.                                                                                                                                             |
| `react/test/IssueCreation.test.jsx`                         | Source replacement Keep preserves edits; Replace applies reviewed source without window.confirm                                         | Test timed out in 5000ms                                                                                             | No changed component/interaction path; supplied mock client                                                                           | Passes in both matched five-file runs and first resumed full feature run. Timing-sensitive test/harness failure; full comparisons below.                                                                                                                                                             |
| `react/test/Participation.test.jsx`                         | F051 anonymous intake preserves area across Review/Back and maps only explicit geography                                                | Test timed out in 5000ms                                                                                             | Intake component imports runtime configuration transitively, but this test supplies repositories and bypasses repository construction | Passes in both matched five-file runs and first resumed full feature run. Timing-sensitive test/harness failure; full comparisons below.                                                                                                                                                             |
| `react/test/Participation.test.jsx`                         | F051 identified intake preserves area across Review/Back and maps only explicit geography                                               | Test timed out in 5000ms                                                                                             | Same supplied-repository path as anonymous case                                                                                       | Passes in both matched five-file runs and first resumed full feature run. Timing-sensitive test/harness failure; full comparisons below.                                                                                                                                                             |
| `react/test/ReportIssueApiMode.test.jsx`                    | API mode loads asynchronously, submits once, and displays the API reference verbatim                                                    | Test timed out in 5000ms                                                                                             | Supplies repositories; bypasses changed runtime configuration construction                                                            | Passes in both matched five-file runs and first resumed full feature run. Timing-sensitive test/harness failure; full comparisons below.                                                                                                                                                             |
| `react/test/ReportIssueApiMode.test.jsx`                    | offers canonical details navigation only when development reads are enabled                                                             | Test timed out in 5000ms                                                                                             | Supplies repositories and detailsEnabled; bypasses changed runtime configuration construction                                         | Passes in both matched five-file runs and first resumed full feature run. Timing-sensitive test/harness failure; full comparisons below.                                                                                                                                                             |
| `react/test/ReportIssuePage.test.jsx`                       | ReportIssuePage configuration-driven intake > Category filtering hides without destroying the selected Category, Issue, or intake state | Test timed out in 5000ms                                                                                             | Yes: default repository construction calls runtime guard, which returns for development/legacy; UI code unchanged                     | Passes in both matched five-file runs and first resumed full feature run. Timing-sensitive test/harness failure; full comparisons below.                                                                                                                                                             |
| `react/test/ReportIssuePage.test.jsx`                       | ReportIssuePage configuration-driven intake > conditional questions show and hide while clearing stale answers                          | Test timed out in 5000ms                                                                                             | Same default development/legacy configuration path                                                                                    | Passes in both matched five-file runs and first resumed full feature run. Timing-sensitive test/harness failure; full comparisons below.                                                                                                                                                             |
| `react/test/ReportIssuePage.test.jsx`                       | ReportIssuePage configuration-driven intake > changing Service clears old answers                                                       | Test timed out in 5000ms                                                                                             | Same default development/legacy configuration path                                                                                    | Passes in both matched five-file runs and first resumed full feature run. Timing-sensitive test/harness failure; full comparisons below.                                                                                                                                                             |
| `react/test/ReportIssuePage.test.jsx`                       | ReportIssuePage configuration-driven intake > explicitly choosing a different Category clears stale Issue selection and answers         | Test timed out in 5000ms                                                                                             | Same default development/legacy configuration path                                                                                    | Passes in both matched five-file runs and first resumed full feature run. Timing-sensitive test/harness failure; full comparisons below.                                                                                                                                                             |
| `react/test/ReportIssuePage.test.jsx`                       | ReportIssuePage configuration-driven intake > anonymous needs no name while identified reporting requires it                            | TestingLibraryElementError: Unable to find an accessible element with the role "radio" and name "Report anonymously" | Same default development/legacy configuration path                                                                                    | Passes in both matched five-file runs and first resumed full feature run. One-off harness/interaction failure amid timeouts; asynchronous interference is plausible but not independently proven. Not claimed as a reproduced baseline defect.                                                       |
| `react/test/ReportIssuePage.test.jsx`                       | ReportIssuePage configuration-driven intake > F049 requires an explicit choice and erases Contact when switching to anonymous           | Test timed out in 5000ms                                                                                             | Same default development/legacy configuration path                                                                                    | Passes in both matched five-file runs and first resumed full feature run. Timing-sensitive test/harness failure; full comparisons below.                                                                                                                                                             |
| `react/test/ReportIssuePage.test.jsx`                       | ReportIssuePage configuration-driven intake > review summarizes values and Back preserves relevant state                                | Test timed out in 5000ms                                                                                             | Same default development/legacy configuration path                                                                                    | Passes in both matched five-file runs and first resumed full feature run. Timing-sensitive test/harness failure; full comparisons below.                                                                                                                                                             |
| `react/test/ReportIssuePage.test.jsx`                       | ReportIssuePage configuration-driven intake > submits the exact compatibility payload once and navigates successfully                   | Test timed out in 5000ms                                                                                             | Same default development/legacy configuration path                                                                                    | Passes in both matched five-file runs and first resumed full feature run. Timing-sensitive test/harness failure; full comparisons below.                                                                                                                                                             |
| `react/test/ReportIssuePage.test.jsx`                       | ReportIssuePage configuration-driven intake > save failure preserves review state and allows retry                                      | Test timed out in 5000ms                                                                                             | Same default development/legacy configuration path                                                                                    | Passes in both matched five-file runs and first resumed full feature run. Timing-sensitive test/harness failure; full comparisons below.                                                                                                                                                             |

The multipart cause is concrete: `server/package-lock.json` specifies Multer
2.4.0, but the shared installed `server/node_modules/multer/package.json` reports
2.2.0. Installed Busboy 1.6.0 emits `limit` at `fileSize === fileSizeLimit`, and
installed Multer aborts with LIMIT_FILE_SIZE. The unchanged tests encode the
inclusive 2.4.0 contract. Both trees use this exact same installation. No package,
attachment code, body middleware, assertion or upload limit was changed.
These remain failed tests, not passes; dependency reconciliation is separate work.

The startup exact-name runs passed in 2445.7 ms on baseline and 2638.6 ms on
feature. Feature full-file repeats took 2316.1 and 2406.9 ms for that test;
the final full-unit invocation took 2453.5 ms. The ten-second timeout was not
increased. These measurements do not support a deterministic startup regression,
but cannot establish what caused the earlier machine-level delay.

### React invocation history and final comparison

The earlier focused six-file run passed 81/81. The first resumed full run from
the allowed path failed: **904 passed / 6 failed of 910**, 58 passed / 2 failed
files of 60, duration 679.39 seconds. Every failure was a 5000 ms timeout:

- `IssueCreation.test.jsx`: F056.5 External Redirect is configured before one complete Create request
- `IssueCreation.test.jsx`: F056.5 changing Availability retains an invalid redirect draft until explicitly resolved; capability never grants authority
- `IssueCreation.test.jsx`: F056.5 ordinary creator is not offered unauthorized redirect selection
- `IssueCreation.test.jsx`: blank creation saves Optional with the sole supported geographic default
- `IssueCreation.test.jsx`: a restricted source still requires deliberate supported-policy review
- `IssueDiscovery.test.jsx`: F056.5 polish numbers authoritative pages and renumbers sorted/filtered results without new API fields

The matched focused comparison includes IssueCreation, IssueDiscovery,
Participation, ReportIssueApiMode and ReportIssuePage. Baseline passed 74/74 in
5/5 files (112.18 seconds); unchanged feature passed 74/74 in 5/5 files
(100.65 seconds). All original 15 and the six failures above are included.
The differing full-run failure set and unchanged passing focused runs demonstrate
non-determinism, not an identified production-serving error. The exact host
resource cause is not established. No test, fixture, timeout, worker-count option
or Vite protection was changed.

The unchanged baseline full suite passed **892/892 tests in 59/59 files**, exit 0, in 290.44 seconds.
The matching feature full comparison then produced **908 passed / 2 failed of
910**, 58 passed / 2 failed files, exit 1, in 378.34 seconds. All original 15
failures and all six timeouts from the preceding run passed. Two previously
passing, unchanged tests failed instead:

- `react/test/WorkspaceRefinement.test.jsx` — `F058.2B Recent Activity presents projected events and never manufactures a status`: `TypeError: Cannot read properties of null (reading 'querySelectorAll')` at line 1088. The test awaits the always-rendered Recent Activity heading, then queries a timeline rendered only after an asynchronous repository response. It can reach that query before the timeline exists. The repository and authentication are supplied mocks; the failing component path is unchanged.
- `react/test/MapPreview.test.jsx` — `sign-out unmounts already rendered protected data immediately`: `TypeError: Cannot read properties of undefined (reading 'remove')` at line 267. The test awaits a rendered request button, captures `maps.instances[0]`, and assumes the map setup effect has already run. The UI sign-out assertions preceding the failing `map.remove` access passed. Its repository construction traverses the runtime guard with development/API settings, which returns normally; the map/effect and sign-out implementation are unchanged.

The same two-file command was run eight times on the unchanged baseline: every
invocation passed 67/67. Feature repetitions passed 67/67 twice and failed 66/67
once on the identical activity assertion. These are observed nondeterministic
initialization/observation failures in the feature test harness; they are **not
claimed as conclusively reproduced baseline defects**. The source-level
synchronization assumptions explain how the assertions can race, but why those
schedules occurred only in the observed feature runs is not established. No
assertion, timeout, test or accepted UI was changed. These failed invocations
remain evidence even if a subsequent complete invocation passes.
The final unchanged feature full run finished **909 passed / 1 failed of 910**,
59 passed / 1 failed files of 60, exit 1, in 580.73 seconds. All original 15
failures and both later initialization races passed in this invocation. The
remaining failure is `react/test/IssueCreation.test.jsx` > `F056.5 External
Redirect is configured before one complete Create request`, which timed out in
5000 ms at line 127 (observed 5043 ms). It passed in the clean baseline full
suite, both matched five-file runs, and the preceding feature full run. This is
observed timing instability, but its feature-only full-run occurrences have not
been conclusively explained or reproduced on baseline. **It is not accepted as
a baseline exception. The full React validation gate remains unmet.** No
further repetitions were used to select a passing invocation, and no timeout,
assertion, implementation or accepted UI was changed to suppress the failure.

### Final applicable validation

| Check                                                                                   | Result                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend test compilation                                                                | Passed for clean baseline and feature                                                                                                                                                             |
| Full backend units (`node --test --test-concurrency=1` in `server/dist-test/test/unit`) | 758 tests: 757 passed, 1 failed, 0 skipped; exit 1. Only the baseline-reproduced multipart failure                                                                                                |
| Full API E2E (same command in `server/dist-test/test/e2e`)                              | 87 tests: 85 passed, 1 failed, 1 skipped; exit 1. Only baseline multipart failure; registry DB suite skipped for absent dedicated DB configuration                                                |
| Serving units + production-serving E2E + logging-sanitization file                      | 51 passed, 0 failed, 0 skipped; exit 0, including production negative cases                                                                                                                       |
| Full shared root script, direct Node invocation of its eight files                      | Baseline 64/64 passed; feature 64/64 passed, both outside `.local-uat`                                                                                                                            |
| Full React                                                                              | Final feature: 909 passed / 1 failed of 910, 59 passed / 1 failed files; exit 1. Baseline: 892/892 passed in 59 files. Feature timeout remains unresolved; no clean full feature pass is claimed. |
| Backend typecheck (`tsc -p tsconfig.json --noEmit`)                                     | Passed                                                                                                                                                                                            |
| Backend build (`tsc -p tsconfig.build.json`)                                            | Passed                                                                                                                                                                                            |
| Backend lint (`eslint .`)                                                               | Passed                                                                                                                                                                                            |
| Client production frontend build                                                        | Passed outside `.local-uat`; existing large-chunk and plugin-timing warnings retained                                                                                                             |
| Production build with explicit API override `/api/v1`                                   | Correctly refused by the serving guard before build, expected exit 1                                                                                                                              |
| Changed backend formatter-supported files                                               | Passed: README, AppModule, main, serving validator, serving unit and E2E tests                                                                                                                    |
| Full server formatter                                                                   | Clean baseline 442 warned files; feature before README normalization 440; final feature 439. Zero new warned paths; all remaining warnings are in the baseline set                                |
| PostgreSQL integration                                                                  | Not executed — no schema/query/persistence change in F060.4A-2A and required dedicated test configuration is unavailable.                                                                         |

Full formatter uses the package-script scope:
`prettier --check '{src,test,migrations}/**/*.{ts,json,md}' 'scripts/*.mjs' '*.{json,md,yml}'`.
The three baseline warnings absent from final feature are `src/app.module.ts`,
`src/main.ts` and `README.md`. Fresh Windows checkouts include CRLF; line-ending
normalization accounts for the README warning, and its semantic Git diff remains
only the eight F060 documentation lines. The earlier feature count of 441 was
recorded before the final main.ts change. No broad formatting was performed.
`.env.example` is not a supported Prettier input in this project; its scoped diff
is reviewed instead. There is no root frontend lint script, so no frontend lint
pass is claimed. The new frontend helper/config/test formatting is checked
separately; the existing runtimeConfig surrounding style is preserved.

No changed execution path adds database integration behavior: the HTTP validator
composes existing configuration validation before connection, the diagnostic is
pure formatting, and the frontend guard is pure build/runtime configuration.
The new E2E exercises real HTTP setup with synthetic database/registry providers.
No query, schema, migration, registry-binding semantics or persistence operation
changed. Missing dedicated database configuration alone is not this slice's gate.

### Security regression review

- No browser Organization selector or tenant fallback. The server-only hostname
  inventory is metadata, not a tenant binding or replacement registry.
- Production host inventory and CORS reject wildcards and localhost; browser
  origins must be exact HTTPS origins from the inventory. `credentials: false`
  and the existing hostname normalizer are unchanged.
- Production client HTTP serving requires forwarded authority and explicit
  final-hop peers. Existing verified tenant bindings remain authoritative;
  DEVELOPMENT_ORGANIZATION_ID remains prohibited in production.
- Customer frontend builds require API mode and an absent/empty API override,
  producing same-origin `/api/v1`. No Azure IDs or headers enter the Reqro domain.
- Entra/MSAL authorization, attachments, body parsing and accepted UI are
  unchanged. No permission, grant, identity architecture or database role changed.
- No production deployment, infrastructure, DNS, TLS, cloud resource or fallback
  was created. F060.4A-2B through 2F remain out of scope.

### Final file set and next gate

Modified (8): `.env.example`,
`docs/features/F016-production-hosting-deployment-readiness-plan.md`,
`react/src/config/runtimeConfig.js`, `react/vite.config.mjs`,
`server/.env.example`, `server/README.md`, `server/src/app.module.ts`,
`server/src/main.ts`.

Added (6): this feature record, `react/src/config/servingConfig.mjs`,
`react/test/ServingConfiguration.test.js`,
`server/src/config/serving-environment.ts`,
`server/test/unit/serving-environment.test.ts`,
`server/test/e2e/production-serving.e2e.test.ts`.

No production-serving implementation correction was made during triage.
Only the user-directed ADR release, existing README formatting and this evidence
record changed. The final React failure is unresolved and does not qualify for the user's
baseline exception. A functional production-serving defect has not been
isolated, but the possible feature/test-harness relationship is not dismissed
merely because isolated runs pass. The commit gate is not satisfied.

Authoritative main and local origin/main still equal the starting SHA. The
other workstream has not landed there, so no final ADR number is assigned and
no authoritative index reconciliation has occurred. The other workstream's
content was not overwritten. Final feature HEAD remains the starting SHA,
branch `codex/production-serving-configuration`, 0 ahead / 0 behind local
origin/main, empty index, 8 modified tracked files and 6 untracked additions.
Main remains clean. No commit SHA exists for F060.4A-2A. No remote contact,
staging, commit, push, deployment or F060.4A-2B work occurred.

Final scoped formatting and `git diff --check` passed. A narrow private-key/token
pattern scan of the 14 changed files returned no matches; the scoped diff was
also reviewed. All 14 files match the validation copy byte-for-byte. Relative
links in the three changed documentation files resolve except the three
explicitly pending links to the preserved serving ADR (F016, this report and
server README). There are no other unresolved links in that checked scope.
Neither released ADR path is modified/owned by this feature worktree.

Final `git status --short`:

```text
 M .env.example
 M docs/features/F016-production-hosting-deployment-readiness-plan.md
 M react/src/config/runtimeConfig.js
 M react/vite.config.mjs
 M server/.env.example
 M server/README.md
 M server/src/app.module.ts
 M server/src/main.ts
?? docs/features/F060-4A-2A-production-serving-configuration.md
?? react/src/config/servingConfig.mjs
?? react/test/ServingConfiguration.test.js
?? server/src/config/serving-environment.ts
?? server/test/e2e/production-serving.e2e.test.ts
?? server/test/unit/serving-environment.test.ts
```

After the other workstream lands on authoritative main, verify its exact state,
inspect the current ADR index and filenames, allocate the next genuinely unused
number, restore the preserved F060 decision, and reconcile the index and all F060
references without overwriting the other decision. Recheck unique numbering,
links, stale serving-decision references and final feature scope. Only then reassess the
conditional authorization for one local F060 commit. No push or deployment.

Stop for final F060.4A-2A acceptance review before F060.4A-2B.

## 2026-10-09 — redirect-test-only stability investigation

This checkpoint follows the validation-only instruction. The sole investigated
failure is `react/test/IssueCreation.test.jsx` →
`F056.5 External Redirect is configured before one complete Create request`.
The previously accepted backend, shared-path, formatting, build, database and
security dispositions above were not reopened. No F060.4A-2B work occurred.

### Frozen inputs and execution method

Before testing, authoritative main, local origin/main, the active
`codex/production-serving-configuration` worktree and both allowed-path
validation trees were verified at
`ce281c4ddf0b23f55124cd594dc536fcd9087eee`. The feature index was empty,
with 0 ahead / 0 behind the local tracking reference. No remote contact occurred.
The tracked binary diff matched the previously reviewed diff; SHA-256 comparison
confirmed all 14 feature files matched the active worktree and validation copy.
The implementation, tests, dependencies and timeout remained unchanged for all
runs below. All 14 starting hashes were rechecked after the three feature suites.

Evidence is retained outside tracked repository paths in
`serving-evidence/react-stability/` under the allowed validation root recorded
above. It includes each run's console log and JSON report, `results.jsonl`, the
starting manifest/diff, import-graph and closure comparisons, phase diagnostics,
host samples and full-suite failure inventory. Node v24.19.0 and installed
Vitest v4.1.11 were used with existing dependencies. No installation or dependency
change occurred.

The uninstrumented command was the existing root React runner, invoked directly:

```text
node node_modules/vitest/vitest.mjs run --config vitest.config.mjs --maxWorkers=1 --reporter=default --reporter=json --outputFile=<external-run.json>
```

File runs append `react/test/IssueCreation.test.jsx`. Isolated runs additionally
append `--testNamePattern "^F056.5 External Redirect is configured before one complete Create request$"`.
Runs were sequential, with no competing test invocation started by this task.
The three full feature runs used identical source and settings. A fresh full
baseline run followed. A fixed follow-up set of three paired isolated and three
paired file runs was declared before it began; it was not extended until green.
Follow-up labels 6–8 identify that set on both trees (baseline labels 4–5 were
not run).

Every target failure in the unchanged-test runs below reports
`Error: Test timed out in 5000ms.` No timeout was increased. Each isolated run
selected one test and skipped the other 19 in the file; those selection skips
are not full-suite skips. Each containing-file run contains 20 tests. Durations
are rounded to three decimals here; full precision remains in the JSON records.
Invocation duration includes startup; file and target durations are separate.
The immediately preceding case is
`F056.5 Add Category drives assignment lookup without a source`.
Timeout phase was not observed in uninstrumented runs; the separate instrumented
runs below provide direct phase evidence without retroactively assigning it to
other invocations.

### Isolated unchanged-test repetitions

| Run              | Target result | Target s | Invocation s | Phase at timeout |
| ---------------- | ------------- | -------- | ------------ | ---------------- |
| feature-exact-1  | failed        | 5.035    | 12.39        | Not observed     |
| feature-exact-2  | failed        | 5.049    | 12.33        | Not observed     |
| feature-exact-3  | failed        | 5.040    | 10.95        | Not observed     |
| feature-exact-4  | failed        | 5.052    | 10.17        | Not observed     |
| feature-exact-5  | failed        | 5.033    | 9.33         | Not observed     |
| baseline-exact-1 | failed        | 5.046    | 9.01         | Not observed     |
| baseline-exact-2 | failed        | 5.043    | 8.75         | Not observed     |
| baseline-exact-3 | failed        | 5.165    | 11.64        | Not observed     |
| feature-exact-6  | failed        | 5.777    | 12.98        | Not observed     |
| baseline-exact-6 | failed        | 5.152    | 16.48        | Not observed     |
| feature-exact-7  | failed        | 5.113    | 18.16        | Not observed     |
| baseline-exact-7 | failed        | 5.158    | 11.95        | Not observed     |
| feature-exact-8  | failed        | 5.161    | 17.12        | Not observed     |
| baseline-exact-8 | failed        | 5.064    | 9.60         | Not observed     |

### Containing-file unchanged-test repetitions

| Run             | Passed / failed | File s | Invocation s | Target result / s | Preceding result / s |
| --------------- | --------------- | ------ | ------------ | ----------------- | -------------------- |
| feature-file-1  | 18 / 2          | 44.210 | 48.77        | failed / 5.066    | passed / 0.986       |
| feature-file-2  | 19 / 1          | 43.825 | 50.87        | failed / 5.044    | passed / 0.781       |
| feature-file-3  | 19 / 1          | 40.581 | 47.67        | failed / 5.032    | passed / 0.891       |
| feature-file-4  | 19 / 1          | 40.241 | 43.91        | failed / 5.052    | passed / 0.730       |
| feature-file-5  | 20 / 0          | 37.547 | 40.35        | passed / 4.764    | passed / 0.720       |
| baseline-file-1 | 19 / 1          | 46.777 | 52.49        | failed / 5.072    | passed / 0.748       |
| baseline-file-2 | 18 / 2          | 38.539 | 48.96        | failed / 5.041    | passed / 0.893       |
| baseline-file-3 | 19 / 1          | 38.532 | 44.05        | failed / 5.072    | passed / 0.849       |
| feature-file-6  | 13 / 7          | 68.943 | 78.72        | failed / 5.014    | passed / 0.904       |
| baseline-file-6 | 18 / 2          | 52.748 | 57.65        | failed / 5.039    | passed / 0.819       |
| feature-file-7  | 18 / 2          | 44.115 | 52.99        | failed / 5.024    | passed / 0.692       |
| baseline-file-7 | 18 / 2          | 49.000 | 59.15        | failed / 5.024    | passed / 1.061       |
| feature-file-8  | 19 / 1          | 38.749 | 46.42        | failed / 5.033    | passed / 0.716       |
| baseline-file-8 | 19 / 1          | 41.342 | 46.71        | failed / 5.094    | passed / 0.756       |

### Full-suite unchanged-source repetitions

| Run             | Passed / failed / total | Invocation s | Target result / s | Containing file s | Preceding result / s |
| --------------- | ----------------------- | ------------ | ----------------- | ----------------- | -------------------- |
| feature-full-1  | 902 / 8 / 910           | 964.82       | passed / 4.831    | 39.911            | passed / 0.692       |
| feature-full-2  | 885 / 25 / 910          | 890.81       | failed / 5.143    | 52.535            | passed / 0.798       |
| feature-full-3  | 893 / 17 / 910          | 646.03       | failed / 5.327    | 85.567            | failed / 5.178       |
| baseline-full-1 | 890 / 2 / 892           | 627.04       | failed / 5.034    | 37.373            | passed / 0.702       |

Other failed cases are retained in the external full-suite failure inventory; no unrelated failure was repaired or waived.

### Separate phase diagnostics

| Run              | Result / target s | Dialog opened s | Redirect fields shown s | Near-timeout s / URL chars | Last sample s / URL chars | Message chars | Initialization pending |
| ---------------- | ----------------- | --------------- | ----------------------- | -------------------------- | ------------------------- | ------------- | ---------------------- |
| baseline-phase-1 | failed / 5.078    | 0.879           | 3.820                   | 4.899 / 17                 | 5.051 / 20                | 0             | No                     |
| baseline-phase-2 | failed / 5.069    | 0.859           | 3.374                   | 4.875 / 26                 | 4.920 / 27                | 0             | No                     |
| feature-phase-1  | failed / 5.096    | 0.919           | 3.536                   | 4.856 / 22                 | 5.061 / 26                | 0             | No                     |
| feature-phase-2  | failed / 5.090    | 0.968           | 4.260                   | 4.857 / 7                  | 5.064 / 11                | 0             | No                     |

### Phase, ordering and resource findings

The four phase runs use a separate external configuration that retains the root
Vitest configuration and normal setup, adding only a DOM MutationObserver and a
4.8-second observation timer. Application code, original test source, request
mocks, assertions and the 5-second test timeout are unchanged. Observer overhead
can affect timing, so these runs are diagnostic evidence only and are excluded
from the unchanged-test repetition totals.

All four diagnostic targets timed out. The dialog opened at 0.859–0.968 seconds;
redirect fields appeared at 3.374–4.260 seconds. At the near-timeout samples,
initialization had completed, the issue name was fully entered, and the test was
entering or finishing the destination URL. Handoff-message length remained zero
and Create had not been reached. Loading and creating indicators were false.
The final observed URL lengths were 26, 11, 20 and 27 characters for feature-1,
feature-2, baseline-1 and baseline-2 respectively (complete URL length 27).
These traces demonstrate active interaction progress after initialization, not
an unresolved initial lookup, in these four runs. They do not establish the
phase of earlier uninstrumented timeouts.

The failure is not limited to full-suite load: it reproduces in isolated fresh
processes on both trees. The target is third in its file. Its preceding case
passed in feature full runs 1 and 2 (0.692 and 0.798 seconds), but timed out in
run 3 (5.178 seconds). A preceding timeout could compound that invocation;
it cannot explain the isolated failures or the failures following a passing
preceding case. File order across the suite varied; the target file ran first
in full run 1, before the new serving-configuration tests. No consistent
feature-specific ordering or accumulated-state dependency was established.

The target's client uses fresh `vi.fn` async functions returning local fixtures;
there is no MSW initialization or external request in this path. Test interactions
are awaited. Global setup performs React Testing Library cleanup after each test.
Component debounce timers are cleared, lookup controllers aborted, late responses
checked, event listeners removed and dialog body styling restored by cleanup.
Existing focus `requestAnimationFrame` callbacks are not explicitly cancelled,
but use current nullable refs; no evidence ties them to this failure. A cleanup
or isolation defect was not demonstrated, and none was silently fixed.

Two three-reading Windows performance-counter samples during full runs showed
100% total CPU throughout. Available memory was 937–1,088 MiB in the first sample
and 478–495 MiB in the second. This establishes resource pressure at those sample
times, not the cause of every earlier timeout, the identity of a competing
process, or that F060 introduced the pressure. No other process was modified or
stopped. No timeout increase, fake-timer conversion, mock relaxation, dependency
repair or unrelated application change was made.

### F060 execution-path review

A TypeScript-AST import trace from the target file reached 16 local JavaScript
modules, with no unresolved local imports and no F060-changed module reachable.
Those modules, the two referenced stylesheets, root Vitest config, test setup,
package manifest and lockfile were byte-identical between feature and baseline.
Both validation trees use the same existing physical dependency installations.

- `react/src/config/runtimeConfig.js` adds a synchronous configuration assertion,
  but is absent from this test's import graph.
- The actual helper is `react/src/config/servingConfig.mjs` (the instruction's
  `.js` spelling refers to this file). It validates supplied values without
  timers, async work, request mocks or global mutation and is not reachable here.
- `react/vite.config.mjs` adds a `configResolved` production-serving validation
  hook. The unchanged root `vitest.config.mjs` is standalone and does not import
  or merge this Vite config; it is not a plugin in the target test environment.
- `react/test/ServingConfiguration.test.js` adds 18 tests using local objects and
  a direct hook call. It does not install global mocks, change timers or mutate
  the process environment. Normal Vitest file isolation remains enabled. This
  new file was absent from isolated/file comparisons and ran after the target
  in the first full feature run.

There is no credible execution path from the reviewed F060 React changes to
Create initialization, redirect editing, timers, request mocks or target module
startup. The identical clean-baseline test also fails in isolation, in its file
and in a fresh full suite. No F060 implementation was reverted or changed to
obtain a pass.

### Classification, limits and next gate

Across unchanged isolated repetitions, feature passed 0/8 and baseline passed
0/6. Whole-file repetitions passed 1/8 on feature and 0/6 on baseline; the target
had the same pass/fail distribution within those file runs. In the three full
feature suites the target passed once and timed out twice; it also timed out in
the fresh full baseline suite. The four separate diagnostic attempts timed out.

**Classification: unresolved, baseline-reproducible test-body timeout; no F060
regression demonstrated.** The evidence does not satisfy the user's formal
flaky/environmental classification: the exact test did not pass repeatedly in
isolation. Variable full-suite failures and observed host pressure do not replace
that requirement. No baseline exception has been applied. The React validation
gate therefore remains open; ADR reconciliation is not yet the sole remaining
gate. The successful historical focused checks and one current full-suite target
pass do not erase the failed invocations above.

Each feature full invocation contains 910 distinct tests; the baseline contains
892, with the difference being the 18 serving tests. Focused repetitions and
instrumented runs are not added to those repository-wide distinct totals. Full
suite failures outside the target were preserved, not investigated or waived
under this narrowly scoped instruction. Missing database configuration and the
previously accepted non-React dispositions remain as recorded above.

This checkpoint changes only this feature evidence record, copied to the
validation tree after testing. All other 13 feature files retain their starting
hashes; the full 14-file set remains synchronized between the active feature
worktree and validation copy. No runtime, test, timeout, dependency or accepted
UI change occurred. Final Git state remains HEAD
`ce281c4ddf0b23f55124cd594dc536fcd9087eee`, branch
`codex/production-serving-configuration`, 0 ahead / 0 behind local origin/main,
empty index, 8 modified tracked files and 6 untracked additions (the same file
list shown above). Authoritative main is clean at the same SHA; no remote state
is inferred from that last-known tracking reference.

The F060 ADR and index content remain preserved only in the external
`adr-preserved/` evidence directory. The released ADR file is absent from this
feature worktree and its ADR index has no diff. The competing workstream has not
landed on local authoritative main at this checkpoint. Do not restore, renumber
or reconcile the ADR under this validation-only instruction; after that work
lands, stop and report for the next coordination decision. This supersedes the
earlier next-step wording as an execution instruction.

The updated evidence record passed an explicit, unignored Markdown formatter
check in the allowed validation path, and `git diff --check` passed. The first
formatter invocation against `.local-uat` skipped the ignored file and is not
counted as validation. No accepted backend/shared checks were repeated merely
for this documentation update.

Recommended next step: review this new clean-baseline reproduction and the unmet
repeat-pass criterion. Either obtain a controlled-capacity validation opportunity
for a fixed targeted comparison or explicitly decide whether to accept a
baseline exception. That decision is not inferred here. Retain the current
5-second limit and unchanged F060 implementation. No staging, commit, push,
deployment, authoritative-main modification, ADR restoration or F060.4A-2B work
occurred. Stop for review with both React validation and ADR reconciliation
outstanding.

## 2026-10-09 — accepted exception and complete React failure review

**REACT VALIDATION GATE COMPLETE WITH DOCUMENTED BASELINE EXCEPTION.**

The user explicitly accepted the following classification for
`react/test/IssueCreation.test.jsx` / `F056.5 External Redirect is configured before one complete Create request`:
**Pre-existing baseline-reproducible timing instability; no demonstrated
F060.4A-2A regression.** The exception applies to that pre-existing instability;
it is not a passing test. All recorded failures, timings, phase observations and
limitations above are retained. Host CPU saturation is supporting environmental
evidence only, not a proven root cause. No further run of this accepted test was
performed for this review. Its 5-second timeout and all F056.5/Issue Creation
implementation remain unchanged. The production-serving implementation and its
focused serving tests also remain unchanged.

### Audit scope and resolution of remaining evidence gaps

The review enumerated every failed case in the original full React run, resumed
full run, matched full comparison, previous final full run and the latest three
feature / one baseline full runs. The union contains **62 distinct cases**:

- 1 accepted redirect timing exception, as explicitly reviewed by the user.
- 1 additional baseline-reproduced timing failure:
  `ServiceRequestDetailsPage.test.jsx` / `renders the complete canonical read model with persisted answer snapshots`.
  It timed out in clean `baseline-full-1` and passed in all three latest feature
  full runs. This is not an F060-only failure and is not relabeled as a pass.
- 60 nondeterministic cases with passing focused evidence and no credible F060
  failure path. Each also passed in at least one unchanged latest feature full
  run. The ledger below maps each exact case to its evidence.

The existing matched five-file 74/74 feature and baseline runs cover 32 of those
60 cases (IssueCreation excluding the accepted exception, IssueDiscovery,
Participation, ReportIssueApiMode and ReportIssuePage). Existing two-file runs
cover seven (MapPreview and WorkspaceRefinement): feature 67/67 twice and
baseline 67/67 eight times, with the failed feature rerun preserved.

The later full runs added **21 cases across ten files** with no recorded focused
pass. Only these exact names were selected for new validation; this was not a
full-suite rerun or an attempt to obtain a cosmetically green total. The command
used the same runner/configuration and `--maxWorkers=1`, ten explicit file paths
and an escaped name-alternation pattern selecting the 21 cases. The exact command
and selection are retained in `react-review/focused-command.json` and
`focused-cases.json` outside the tracked repository.

| Review invocation                       | Result                                                                       | Duration                | Disposition                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| Selected 21 feature cases               | 20 passed / 1 failed / 166 selection-skipped; 9 passed files / 1 failed file | 182.78 s                | Retained failed invocation; 20 missing focused-pass observations obtained |
| Exact remaining case, clean baseline    | 1 passed / 15 selection-skipped                                              | 10.23 s; target 3.584 s | Supplemental focused evidence                                             |
| Exact remaining case, unchanged feature | 1 passed / 15 selection-skipped                                              | 8.35 s; target 3.117 s  | Supplemental focused evidence; does not rewrite the failed invocation     |

The remaining case was `IssueConfiguration.test.jsx` /
`F056.5 template-free create requires explicit Category, priority, location, geography and deliberate submission`.
Its selected-run failure was `Test timed out in 5000ms` at 5.107 seconds; the
exact-name baseline and feature comparisons both passed. It also passed in
unchanged `feature-full-1`. Its component/test import graph has no F060 module.
It therefore meets the user's nondeterministic/focused-pass/no-credible-path
classification, without a timeout or code change.

**Zero unclassified full-suite failures remain.** Selected-test skips above are
not repository-suite skips. These focused counts are not added to the 910
feature or 892 baseline distinct-test totals. The prior full-suite totals and
failed exit outcomes remain unchanged; no all-green full React run is claimed.

### Execution-path review for all affected files

Import traces cover all 18 affected test files, not only the accepted redirect
case. Their application/test modules are identical to baseline except the two
known runtime-configuration files. No unresolved local imports were found.
The changed Vite build configuration and new serving test file are not imported
by these failure paths; the root test configuration remains standalone.

- Attachments, ConfigureAccess, IntakeCollectionEditor, IssueConfiguration,
  IssueCreation and IssueDiscovery have no F060 module in their local graph.
- ExtendedQuestions imports resident modules elsewhere in its file, but the
  failed case renders a local Builder using unchanged FollowUpQuestions.
- IntakeUxRefinement, StaffLiveSearch, WorkspaceRefinement, RequestCommunication
  and RequesterHistory supply repository mocks to their unchanged components.
  Importing requestRepository does not invoke its runtime-config factory.
- ResidentExperienceEditor supplies a mock client and mocked authentication.
  Its tab/review/publish observations do not call the serving validator.
- Participation and ReportIssueApiMode supply repositories. ReportIssuePage's
  legacy development configuration leaves the new guard as a synchronous no-op.
- MapPreview's mock/effect observation paths are unchanged. The explicit API
  environment has DEV=true and no client profile/PROD=true; the serving assertion
  returns under the development profile without changing the resulting config.
  The map-instance access failures are observations before asynchronous map
  initialization is guaranteed, as in the earlier sign-out analysis.
- ServiceRequestDetailsPage's timeout reproduced on baseline; it uses the
  existing supplied repository/read-model path.

The non-timeout observations (missing menu/option/result elements, enabled-state
expectation, absent map instance, missing timeline and unset media listener)
are included in the ledger and have focused passes. For the mobile-card case,
the test invokes a listener assigned by a responsive effect after awaiting a
separately rendered results list; that observation does not guarantee the
listener exists. No cleanup bug, host-load root cause or new production defect
is asserted merely from these scheduling-sensitive observations. Nothing was
changed to force a pass. Detailed graphs, source comparisons, raw failures and
per-case classifications are retained under `serving-evidence/react-review/`.

### Complete full-run failure classification ledger

Every row is a previously failed case; classification does not turn the failed invocation into a pass. Full-pass references below identify the unchanged feature runs in the preceding section. Exact source logs and assertions are retained in `react-review/classified-ledger.json`.

| File                                 | Exact case                                                                                                                              | Classification                                                | Evidence                                                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Attachments.test.jsx`               | F046 tab switches preserve separate Note and Communication files; successful create clears one draft                                    | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-1, feature-full-3.                                         |
| `ConfigureAccess.test.jsx`           | Alex review groups three additions and preserves unchanged context and sensitive confirmation                                           | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-1, feature-full-3.                                         |
| `ExtendedQuestions.test.jsx`         | F056.2C builder switches unsaved types, preserves choice options, clears incompatible fields and renders Information controls           | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-1, feature-full-3.                                         |
| `IntakeCollectionEditor.test.jsx`    | F053 dirty choice is separate from current; Cancel never writes                                                                         | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-2, feature-full-3.                                         |
| `IntakeUxRefinement.test.jsx`        | filter refinement keeps live reference search independent and Reset clears legacy URL state                                             | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-2, feature-full-3.                                         |
| `IntakeUxRefinement.test.jsx`        | filter refinement keeps two semantic rows, action priority and keyboard order                                                           | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-2, feature-full-3.                                         |
| `IssueConfiguration.test.jsx`        | F056 Cancel restores action focus and performs no write                                                                                 | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-1, feature-full-3.                                         |
| `IssueConfiguration.test.jsx`        | F056 deactivation confirmation cancels by keyboard and only confirm sends state mutation                                                | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-1, feature-full-3.                                         |
| `IssueConfiguration.test.jsx`        | F056 duplicate rejection gives reactivation guidance and keeps the draft                                                                | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-1.                                                         |
| `IssueConfiguration.test.jsx`        | F056 editor uses independent expected revisions and authoritative response/focus                                                        | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-1, feature-full-3.                                         |
| `IssueConfiguration.test.jsx`        | F056 read-only shows human configuration and no mutation controls                                                                       | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-1, feature-full-3.                                         |
| `IssueConfiguration.test.jsx`        | F056 unsafe markup and negative order cannot be saved                                                                                   | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-1, feature-full-2.                                         |
| `IssueConfiguration.test.jsx`        | F056.5 Escape protects dirty drafts and Cancel keeps unsaved values                                                                     | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-1, feature-full-3.                                         |
| `IssueConfiguration.test.jsx`        | F056.5 summary and menu are lazy, keyboard operable, and restore focus                                                                  | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-1, feature-full-3.                                         |
| `IssueConfiguration.test.jsx`        | F056.5 template-free create requires explicit Category, priority, location, geography and deliberate submission                         | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check failed; exact feature 1/1 and baseline 1/1 passed. Full passes: feature-full-1.                                            |
| `IssueCreation.test.jsx`             | a restricted source still requires deliberate supported-policy review                                                                   | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2.                                                 |
| `IssueCreation.test.jsx`             | blank creation saves Not Used with the sole supported geographic default                                                                | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2.                                                 |
| `IssueCreation.test.jsx`             | blank creation saves Optional with the sole supported geographic default                                                                | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2.                                                 |
| `IssueCreation.test.jsx`             | Copied Urgent requires deliberate replacement priority without changing the source                                                      | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2.                                                 |
| `IssueCreation.test.jsx`             | F056.5 Add Category drives assignment lookup without a source                                                                           | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2.                                                 |
| `IssueCreation.test.jsx`             | F056.5 Add starts with Category, no priority/location assumptions and sole geography default and optional source hidden                 | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2.                                                 |
| `IssueCreation.test.jsx`             | F056.5 changing Availability retains an invalid redirect draft until explicitly resolved; capability never grants authority             | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1.                                                                 |
| `IssueCreation.test.jsx`             | F056.5 External Redirect is configured before one complete Create request                                                               | Accepted baseline timing exception                            | User review; baseline isolated/file/full reproductions. Not a pass. Full passes: feature-full-1.                                                 |
| `IssueCreation.test.jsx`             | F056.5 failed Create preserves draft, and pending Create is single flight                                                               | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2.                                                 |
| `IssueCreation.test.jsx`             | F056.5 ordinary creator is not offered unauthorized redirect selection                                                                  | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2.                                                 |
| `IssueCreation.test.jsx`             | F056.5 selecting Category preserves manually chosen blank-creation policies                                                             | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2.                                                 |
| `IssueCreation.test.jsx`             | F056.5 source is Category-scoped, reviewed once and guarded against discarded edits                                                     | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2.                                                 |
| `IssueCreation.test.jsx`             | F056.5 stale source blocks retry until deliberate refresh and review                                                                    | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2.                                                 |
| `IssueCreation.test.jsx`             | Source replacement Keep preserves edits; Replace applies reviewed source without window.confirm                                         | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2, feature-full-3.                                 |
| `IssueDiscovery.test.jsx`            | F056.1 late filter response cannot overwrite newer query and loading hides old rows                                                     | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-3.                                                 |
| `IssueDiscovery.test.jsx`            | F056.5 polish numbers authoritative pages and renumbers sorted/filtered results without new API fields                                  | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2, feature-full-3.                                 |
| `IssueDiscovery.test.jsx`            | F056.5 save supersedes a pending history-navigation list response                                                                       | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-3.                                                 |
| `MapPreview.test.jsx`                | a map runtime error leaves the textual alternative available                                                                            | Nondeterministic; focused pass; no credible F060 failure path | Two-file focus: feature 67/67 twice, baseline 67/67 eight times; failures retained. Full passes: feature-full-2, feature-full-3.                 |
| `MapPreview.test.jsx`                | API mode authenticates the protected request without a browser Organization hint                                                        | Nondeterministic; focused pass; no credible F060 failure path | Two-file focus: feature 67/67 twice, baseline 67/67 eight times; failures retained. Full passes: feature-full-1, feature-full-3.                 |
| `MapPreview.test.jsx`                | preview keeps warnings, details and list controls available when WebGL fails                                                            | Nondeterministic; focused pass; no credible F060 failure path | Two-file focus: feature 67/67 twice, baseline 67/67 eight times; failures retained. Full passes: feature-full-2, feature-full-3.                 |
| `MapPreview.test.jsx`                | preview loads through the repository and handles unavailable or invalid data safely                                                     | Nondeterministic; focused pass; no credible F060 failure path | Two-file focus: feature 67/67 twice, baseline 67/67 eight times; failures retained. Full passes: feature-full-2, feature-full-3.                 |
| `MapPreview.test.jsx`                | sign-out unmounts already rendered protected data immediately                                                                           | Nondeterministic; focused pass; no credible F060 failure path | Two-file focus: feature 67/67 twice, baseline 67/67 eight times; failures retained. Full passes: feature-full-1, feature-full-2, feature-full-3. |
| `Participation.test.jsx`             | F051 anonymous intake preserves area across Review/Back and maps only explicit geography                                                | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-3.                                                 |
| `Participation.test.jsx`             | F051 disabled intake preserves area across Review/Back and maps only explicit geography                                                 | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-3.                                                 |
| `Participation.test.jsx`             | F051 identified intake preserves area across Review/Back and maps only explicit geography                                               | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-3.                                                 |
| `Participation.test.jsx`             | F051 incomplete intake preserves area across Review/Back and maps only explicit geography                                               | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-3.                                                 |
| `ReportIssueApiMode.test.jsx`        | API mode loads asynchronously, submits once, and displays the API reference verbatim                                                    | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2, feature-full-3.                                 |
| `ReportIssueApiMode.test.jsx`        | offers canonical details navigation only when development reads are enabled                                                             | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2, feature-full-3.                                 |
| `ReportIssueApiMode.test.jsx`        | shows safe geographic error LOCATION_ELIGIBILITY_UNAVAILABLE and preserves review state                                                 | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-3.                                                 |
| `ReportIssuePage.test.jsx`           | ReportIssuePage configuration-driven intake > anonymous needs no name while identified reporting requires it                            | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2, feature-full-3.                                 |
| `ReportIssuePage.test.jsx`           | ReportIssuePage configuration-driven intake > Category filtering hides without destroying the selected Category, Issue, or intake state | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2, feature-full-3.                                 |
| `ReportIssuePage.test.jsx`           | ReportIssuePage configuration-driven intake > changing Service clears old answers                                                       | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2, feature-full-3.                                 |
| `ReportIssuePage.test.jsx`           | ReportIssuePage configuration-driven intake > conditional questions show and hide while clearing stale answers                          | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2, feature-full-3.                                 |
| `ReportIssuePage.test.jsx`           | ReportIssuePage configuration-driven intake > explicitly choosing a different Category clears stale Issue selection and answers         | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2, feature-full-3.                                 |
| `ReportIssuePage.test.jsx`           | ReportIssuePage configuration-driven intake > F049 requires an explicit choice and erases Contact when switching to anonymous           | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2, feature-full-3.                                 |
| `ReportIssuePage.test.jsx`           | ReportIssuePage configuration-driven intake > review summarizes values and Back preserves relevant state                                | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2, feature-full-3.                                 |
| `ReportIssuePage.test.jsx`           | ReportIssuePage configuration-driven intake > save failure preserves review state and allows retry                                      | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2, feature-full-3.                                 |
| `ReportIssuePage.test.jsx`           | ReportIssuePage configuration-driven intake > submits the exact compatibility payload once and navigates successfully                   | Nondeterministic; focused pass; no credible F060 failure path | Matched five-file feature and baseline: 74/74 each. Full passes: feature-full-1, feature-full-2, feature-full-3.                                 |
| `RequestCommunication.test.jsx`      | F042 authorized stream renders plain multiline Unicode, safe author and semantic timestamp                                              | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-2, feature-full-3.                                         |
| `RequesterHistory.test.jsx`          | F050 history is lazy, Contact independent, factual and closes/restores focus; reopen retrieves afresh                                   | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-1, feature-full-2.                                         |
| `ResidentExperienceEditor.test.jsx`  | approved review exposes distinct Publish control and exact confirmation request                                                         | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-1, feature-full-3.                                         |
| `ResidentExperienceEditor.test.jsx`  | keyboard arrows wrap tabs, Home and End select endpoints, and Tab reaches the active panel                                              | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-1, feature-full-3.                                         |
| `ResidentExperienceEditor.test.jsx`  | read-only staff can switch every tab without gaining editing controls                                                                   | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-1, feature-full-3.                                         |
| `ServiceRequestDetailsPage.test.jsx` | renders the complete canonical read model with persisted answer snapshots                                                               | Baseline-reproduced timeout                                   | baseline-full-1; feature full runs pass. Full passes: feature-full-1, feature-full-2, feature-full-3.                                            |
| `StaffLiveSearch.test.jsx`           | results hierarchy follows filters, consolidated controls, summary and rows in DOM and keyboard order                                    | Nondeterministic; focused pass; no credible F060 failure path | Review targeted check: this case passed (20/21 invocation). Full passes: feature-full-2, feature-full-3.                                         |
| `WorkspaceRefinement.test.jsx`       | F058.2B mobile cards reuse list data and viewport changes do not refetch                                                                | Nondeterministic; focused pass; no credible F060 failure path | Two-file focus: feature 67/67 twice, baseline 67/67 eight times; failures retained. Full passes: feature-full-1, feature-full-3.                 |
| `WorkspaceRefinement.test.jsx`       | F058.2B Recent Activity presents projected events and never manufactures a status                                                       | Nondeterministic; focused pass; no credible F060 failure path | Two-file focus: feature 67/67 twice, baseline 67/67 eight times; failures retained. Full passes: feature-full-1, feature-full-2, feature-full-3. |

### ADR ownership and final checkpoint

Local authoritative main, local origin/main and feature HEAD remain
`ce281c4ddf0b23f55124cd594dc536fcd9087eee`. Main is clean; the feature branch
`codex/production-serving-configuration` remains 0 ahead / 0 behind the local
tracking reference, with an empty index, 8 modified tracked files and 6 untracked
additions. Only this feature evidence record changed during this review. No
remote state is claimed from the last-known tracking reference.

ADR-029 belongs to the Production Operator Platform workstream. Its work has
not landed on local authoritative main at this checkpoint. No F060 ADR was
restored or numbered, and the shared ADR index remains untouched. The preserved
serving ADR/index evidence remains outside tracked paths. No synchronization or
final commit gate was attempted before the structural prerequisite was met.

After the operator-platform work lands, preserve the existing feature diff while
synchronizing with the authoritative state; inspect the updated ADR index and
all filenames; allocate the next genuinely unused number without assuming
ADR-030; restore the preserved serving decision under that number; update all
internal references and the ADR index; verify the operator-platform ADR/index
content remains intact; search for stale provisional serving-decision references; and run the
affected documentation/diff checks. Then perform the final F060.4A-2A commit
gate. This checkpoint does not stage or commit anything.

The report's explicit unignored Markdown-format check and `git diff --check`
passed. The unchanged implementation diff and active/validation-copy parity were
reverified. No production-serving or unrelated application/test code, dependency,
timeout, authoritative main or ADR ownership changed. No staging, commit, push,
deployment or F060.4A-2B work occurred.

**REACT VALIDATION GATE COMPLETE — WAITING FOR ADR RECONCILIATION BEFORE F060.4A-2A COMMIT.**

## 2026-10-09 — Authoritative synchronization and ADR reconciliation

This checkpoint supersedes the historical waiting-for-ADR checkpoint above.
The user authorized lossless synchronization, ADR reconciliation, scoped
post-synchronization validation, and one local feature commit conditional on the
final gates. No push, deployment or F060.4A-2B is authorized.

### Preservation and synchronization

- Pre-sync feature branch: `codex/production-serving-configuration`, HEAD
  `ce281c4ddf0b23f55124cd594dc536fcd9087eee`; empty index, eight tracked
  modifications and six untracked additions.
- Authoritative local main and last-known local origin/main:
  `d6676d791cc24b17d01e552f7f68935d9ade3c6f`, including operator-platform
  commit `92635ae36d596abd9f842bcbcea38a6255ac018d`. No remote contact.
- Before changing branch state, preserved all 14 files, a binary/full-index
  tracked patch, modes and a SHA-256/byte-length manifest outside tracked paths.
  Independently reconstructed all 14 files and verified every hash before
  synchronization. Evidence remains under
  `C:/Users/stKyle/.codex/visualizations/2026/10/09/01a1219e-0df6-7741-a893-50c4a24cb4d4/serving-evidence/reconciliation-backup`.
- Restored only the eight backed-up tracked paths to the old HEAD and removed
  only the six verified backed-up untracked paths; fast-forwarded the feature
  branch to `d6676d7`; restored all 14 files. No destructive reset, rebase, merge
  conflict or authoritative-main modification occurred. The restored tracked
  patch and all 14 file hashes matched their pre-sync backups.
- Git's successful fast-forward emitted an automatic-maintenance permission
  warning for the unrelated `.git/worktrees/cityVUE-claude` metadata path.
  No repair or prune was attempted. Later Git mutations disable automatic
  maintenance; no other agent's worktree was edited.
- Eleven original non-documentation configuration/code/test files remain
  byte-identical to the backup and to the synchronized validation copy. No
  production-serving implementation or focused test changed during reconciliation.

### Final ADR allocation and documentation scope

Inspected authoritative ADR filenames and index entries 001–029 before choosing 030. Restored [ADR-030 — Production Serving Contract](../architecture/decisions/ADR-030-production-serving-contract.md)
from the externally preserved decision with only its ADR number changed. The
index now contains 30 unique decision numbers; the full authoritative index is
an exact prefix of the updated index. ADR-029 still refers exclusively to the
Production Operator Platform. Its content and all 18 non-index files newly
landed since `ce281c4` remain byte-identical to authoritative main.

Reconciliation-only changes are the restored/renumbered serving decision, its
appended index entry, serving references in F016/server README/this report,
this evidence checkpoint, and whitespace-only alignment of F016's existing
Markdown table. No stale serving reference to the operator-platform number
remains. Intentional operator-platform ADR references are retained.

The final F060 file allocation is 16 paths: the original 14 plus the restored
serving ADR and ADR index. Temporary backups, diagnostics, dependency junctions,
compiled outputs and validation logs stay outside the feature commit.

### Post-sync validation evidence

Validation uses the synchronized detached copy at
`C:/Users/stKyle/.codex/visualizations/2026/10/09/01a1219e-0df6-7741-a893-50c4a24cb4d4/serving-feature`.
Logs, commands, exit codes and elapsed times are retained in
`serving-evidence/post-sync` alongside the existing evidence directories.
Installed package-script executables run directly through Node v24.19.0;
no dependencies were installed or changed.

The affected operator check ran the boundary, CLI, execution and platform unit
files: **104 passed, 1 failed, 105 total**, exit 1. The failure is
`the acting human cannot be supplied by a pipeline parameter`, asserting that a
pipeline declares a parameters block. Its unchanged static-source regex expects
`\nparameters:\n`; all three authoritative pipeline files have CRLF line endings.
The feature/validation copies match main byte-for-byte. Applying the identical
regex to main fails on CRLF and succeeds on LF for all three files. A focused
run of the unchanged test with only the validation copy's three pipeline inputs
temporarily converted to LF passed **1/1**; every input was then restored and
verified byte-for-byte against main. The original 104/105 run remains failed.
This is a confirmed line-ending-sensitive test-harness limitation in the landed
operator test, with no F060 execution path or operator implementation change.
The diagnostic does not claim that the original invocation passed and is not
added to distinct test totals. Evidence: `operator-affected.log`,
`operator-line-ending-diagnostic.json`, and `operator-lf-diagnostic.log`.

### Retained React exception, database and security disposition

**REACT VALIDATION GATE COMPLETE WITH DOCUMENTED BASELINE EXCEPTION.**
Zero unclassified React failures remain in the accepted 62-case ledger. The
F056.5 redirect classification remains **Pre-existing baseline-reproducible
timing instability; no demonstrated F060.4A-2A regression.** The exception is
not a passing test. All failed full invocations, baseline repetitions and phase
diagnostics above remain evidence. The other baseline timeout and focused
nondeterministic cases retain their accepted classifications. CPU saturation is
supporting environmental evidence only, not a proven root cause. No timeout,
F056.5 or unrelated Issue Creation code changed. Main synchronization changed no
React implementation, dependency or React test infrastructure; therefore no new
broad React rerun is justified or performed.

Database integration not executed — no schema/query/persistence change in F060.4A-2A and required dedicated test configuration is unavailable.

The reconciled feature diff introduces no migration, grant or persistence
change. The serving guard continues to compose the existing validator: production
client/registry tenancy, required forwarded authority, explicit trusted final-hop
peers and deployment-owned hostname inventory, no wildcard tenant fallback or
browser Organization selector, and no production `DEVELOPMENT_ORGANIZATION_ID`.
CORS permits only exact inventoried HTTPS origins, no localhost/wildcards, with
unchanged `credentials: false`. Client frontend builds require API mode and an
absent/empty API override yielding same-origin `/api/v1`. Hostname normalization,
verified tenant bindings, Entra/MSAL behavior, attachment controls and isolation
remain unchanged; no cross-tenant fallback or Azure-specific infrastructure
identifier enters the core domain. Firebase production is not repurposed and
no infrastructure is provisioned. These checks establish repository behavior,
not a deployed or production-ready environment.

### Final integration results and commit gate

| Check                                                | Post-sync result                      | Invocation elapsed |
| ---------------------------------------------------- | ------------------------------------- | ------------------ |
| Backend type-check (`tsc -p tsconfig.json --noEmit`) | Pass, exit 0                          | 90.74 s            |
| Backend build (`tsc -p tsconfig.build.json`)         | Pass, exit 0                          | 23.20 s            |
| Test compilation (`tsc -p tsconfig.test.json`)       | Pass, exit 0                          | 36.68 s            |
| Serving environment unit tests                       | 41 passed, 0 failed/skipped           | 0.71 s             |
| Logging sanitization tests                           | 8 passed, 0 failed/skipped            | 4.94 s             |
| Production-serving E2E                               | 2 passed, 0 failed/skipped            | 9.25 s             |
| Affected operator tests                              | 104 passed, 1 failed; diagnosed above | 23.25 s            |
| React ServingConfiguration                           | 18 passed, 0 failed/skipped           | 4.20 s             |
| Shared suite, all eight package-script files         | 64 passed, 0 failed/skipped           | 6.28 s             |
| Backend lint (`eslint .`)                            | Pass, exit 0                          | 193.02 s           |
| React production client/API build                    | Pass, exit 0                          | 11.05 s            |
| Nine-file code/README Prettier check                 | Pass, exit 0                          | 6.45 s             |

The focused serving total is **69 passed**: 41 unit + 8 logging + 2 E2E +
18 React. This total excludes shared/operator checks and all historical reruns.
The React production build explicitly sets the public client profile, API data
source, empty API override and disabled development reads; it retains the normal
chunk-size/plugin-timing warnings. No frontend TypeScript/type-check script is
configured for this JavaScript React project; frontend type-check is not
applicable and is not reported as a passed command.

The explicit unignored formatting scope covers new/edited serving modules,
Vite configuration, serving tests and server README. The two added statements in
`runtimeConfig.js` preserve its existing style; the previously documented
whole-file baseline formatting limitation is retained without unrelated
reformatting. Environment examples were diff-reviewed. Documentation checks
cover the serving ADR, feature report, F016 and index. The initial documentation
format invocation warned on F016's existing table and the CRLF index: F016's
table was aligned; the authoritative index passes with its existing CRLF setting.
The initial warnings remain in `docs-format-initial.log`. No operator/index
content was rewritten to satisfy the formatter.

Final documentation checks verify unique ADR files/index entries, preserved
ADR-029 operator-platform content and all other landed operator files, preserved
index prefix, valid relative links and zero stale serving references. Final
whitespace checks pass. The credential-pattern review found only two unchanged
baseline placeholders in `server/.env.example`; no new secret/private
configuration was introduced. The feature contains no temporary evidence or
compiled artifacts.

All required serving, shared, type-check, build, lint and scoped formatting
checks pass. The React gate remains accepted; the affected operator failure is
fully explained by the unchanged CRLF-sensitive static test and is not a serving
regression. Production-serving application/test bytes still match the verified
backup, and the authoritative main/tracking references remain at `d6676d7`.
The user-authorized next action is exactly one local commit:
`feat(serving): enforce production serving configuration`, parent `d6676d7`.
The resulting SHA and clean status are reported after commit rather than
embedded in their own commit. No push, deployment, infrastructure action or
F060.4A-2B work is performed.

**STOP FOR FINAL F060.4A-2A ACCEPTANCE REVIEW BEFORE F060.4A-2B.**
