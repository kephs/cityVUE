# F059.2 — Tenant-configurable resident experience

## Slice 1 scope and baseline

Backend/data foundation accepted after architecture/security review and dedicated
PostgreSQL validation. The user authorized staging the intended Slice 1 files and
one local commit. Push, deployment, live/development migration application and
Slice 2 remain unauthorized. Starting branch `codex/f059-tenant-config`, exact HEAD
`b1d0c4dff912501b0b546e1675d440ce863cd85f`, clean index/tree, 0 ahead/0 behind
local `main` and last-known `origin/main`. No remote fetch.

The approved composition remains: published Organization configuration → Resident
Experience DTO → existing HomePresentationProvider → frozen F059.1 components.
This slice implements none of the HTTP, public DTO projection, frontend loading,
editor, preview or publication flow. All homepage assets, CSS and JSX are unchanged.
F019 alerts, F054 organization_branding, staff requests, Activity, access UI,
attachments and AI are unchanged.

Related governance: [execution protocol](../development/REQRO_CODEX_PROTOCOL.md),
[Organization isolation](../architecture/decisions/ADR-001-organization-isolation.md),
[configuration authorization](../architecture/decisions/ADR-014-administrative-configuration-authorization.md),
[existing branding](../architecture/decisions/ADR-015-product-organization-branding.md),
and [F059.1 frozen UI](F059-1-reqro-homepage.md).

## Implemented persistence

Migration **41**, `20261011000000-add-resident-experience.ts`, follows the 40
pre-existing migration files. It introduces six independent tables:

| Table                            | Responsibility                                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| organization_resident_experience | Organization primary key, revision starting at 1, nullable draft/published pointers, timestamps                                                                   |
| resident_experience_revision     | Immutable UUID snapshot, Organization, resource revision, schema version 1, bounded JSON presentation, saved state, trusted creator/time, creation transaction ID |
| resident_experience_action       | Revision-owned stable logical ID, enabled/order, icon, text, CTA label, type, target/contact reference, tone                                                      |
| resident_experience_benefit      | Revision-owned stable logical ID, enabled/order, icon, title/description                                                                                          |
| resident_experience_contact      | Revision-owned reusable phone contact, classification, display value, normalized target, plain-text guidance                                                      |
| resident_experience_event        | Append-only actor/operation, old/new snapshot and resource revisions, bounded change paths/reasons, consequential flag, correlation/time                          |

Existing and subsequently created Organizations get an empty resource row. No
configuration revisions, contact defaults, publication or permission grants are
seeded. Resource ownership, actors, revision pointers and child/contact references
use Organization-aware foreign keys. Contact references also include revision ID;
one revision cannot borrow another revision's contact.

`saved` is an immutable snapshot state, not a mutable draft/published label. The
resource pointers express selection; publishing must not modify old content.
UPDATE/DELETE/TRUNCATE guards protect revisions, children and events. Child INSERT
requires the parent's creation transaction, preventing additions to committed
snapshots. Deferred checks require an associated save event and bind changed draft
pointers to the exact newly saved revision, prior pointer and resource revision.
Publication-pointer changes are explicitly rejected in Slice 1. A later approved
publication slice must replace that guard with transactional publication checks.

Rollback locks the affected tables and refuses if revisions, events or advanced
resource state would be lost. An empty-resource rollback preserves Organization,
F054 branding and permissions. Database constraints complement, rather than replace,
the complete application validator; the SQL layer does not claim to implement
every text, asset or URL policy.

## Validation and snapshot contract

`validateResidentSnapshot(unknown)` rejects missing/unknown fields recursively and
produces a detached canonical snapshot. Required sections are `schemaVersion`,
`presentation`, `actions`, `benefits`, `contacts`. Empty collections are explicit;
there is no merge with local defaults. Stable IDs are bounded lowercase logical
keys; IDs and display orders are unique within their collection. Actions/benefits
sort by order and contacts by logical ID. Numeric strings/booleans are not coerced.

Presentation holds application/optional Organization names, branding keys,
metadata, public navigation labels/links, tagline words, highlighted text segments,
hero key/alt/decorative behavior, section labels and footer content. Fixed staff
route/auth behavior and structural dimensions are deliberately absent.

Limits include 6 actions, 4 benefits, 12 contacts, 4 links per navigation/footer,
4 tagline words and headline segments; a 200-character combined headline and
64 KiB complete serialized snapshot. The validator defines additional per-field
bounds. Reject HTML delimiters, control/format/surrogate characters, unknown
styles/icons and malformed nested objects. Meaningful images require alt text;
decorative images require empty alt text. Navigation begins with a local home link.

The new closed registry allows packaged Reqro mark, wordmark, favicon and scenery
keys in their matching roles. Action and benefit icons have separate allowlists.
Only the `reqro` palette and `primary`, `danger`, `warning` action tones are supported.
No raw paths/URLs for assets, CSS, layout values, uploads, remote fetches or
user-supplied SVG. Registry paths are code-owned and checked against packaged files.

Internal destinations are exactly `/` and `/report`, with no arbitrary query,
fragment, encoded path or staff/admin destination. External actions/footer links
reuse the existing HTTPS destination validator, including credential and local
address restrictions, with additional nested-encoding/control/markup rejection.
Validation performs no DNS/HTTP fetch. HTTPS is syntax/transport validation, not
proof of real-world destination trust; review remains required later.

## Contact safety and consequential changes

Only phone contacts are supported; email is deferred. Classification is emergency
or non_emergency. Display punctuation must normalize exactly to the canonical
phone target (optional leading plus, 2–15 digits). Short numbers are structurally
valid without claiming they are verified or appropriate to any jurisdiction.
No resident contact default is seeded.

Phone actions store a contact ID and null direct target. Their CTA label contains
no numeric characters. A future projection must construct both the visible number
and dial target from the referenced contact, e.g. number-free label + displayValue
and `tel:` + phoneTarget. Narrative correctness cannot be established by syntax;
operators must review prose and verify actual contact details. No renderer is
implemented here and no current F059.1 CTA is changed.

`classifyResidentChanges` compares canonical old/new snapshots on the server.
Every action or contact change is conservatively consequential, including additions,
removals, text, order, enable/disable, classification and type changes. Navigation
and footer link changes are also consequential. Cosmetic presentation-only changes
are separate. Free text cannot be automatically interpreted as correct emergency
guidance. Stored contact guidance and all action text are covered by classification.

Audit paths are fixed section names, never arbitrary IDs or content. At most 10
changed paths and 4 reason keys are emitted and constrained in SQL. Client claims
such as `isConsequential` are rejected. The classifier does not enforce approval or
second-person review in this slice.

## Repository, service and authorization boundary

`ResidentExperienceRepository` provides `getResource`, `getRevision`, transaction-
bound `loadRevision` and `insertRevision`. Every query binds Organization. Revision
reads check an active resource/Organization and load parent/children in a read-only
REPEATABLE READ transaction. Missing/cross-Organization IDs fail safely. These are
internal persistence methods, not an authorized disclosure API.

`ResidentExperienceService.saveDraft(access, command, correlationId)` validates a
complete snapshot and expected resource revision, then uses READ COMMITTED with
the existing Organization/access-state shared authorization barrier and fresh
database staff authority. It locks the resource FOR UPDATE, compares the expected
revision, loads the prior draft, computes changes, and invokes a policy boundary
using fresh authority and those computed changes. Stale saves return 409 with no
retry. A real change inserts a new snapshot/children, advances the draft pointer
and resource revision once, and appends save evidence within the same transaction.
No-op saves still check authority and do not advance state or append audit noise.

**Default-deny:** no concrete write policy exists. The service denies saves unless
a future explicitly approved policy is injected. It is not registered in a Nest
module, controller or CLI. Test fixtures inject a test policy to exercise persistence;
there is no runtime environment flag, fallback identity or development bypass.
Future endpoints must also authorize reads and must not expose repositories directly.

No existing permission keys, grants, bundles, access-policy classifications or
delegation behavior change. `resident_experience.write`,
`resident_experience.publish`, and `resident_experience.contact.manage` remain
proposals; no permission constants/types were registered. Existing identity/locking
helpers are reused without changing their behavior. ADR-024 remains Proposed.

## Audit and deferred publication

Immutable revisions retain content history. Separate append-only events contain
trusted actor/Organization, prior/new references, bounded diff metadata,
consequential classification, time and caller-supplied server correlation UUID.
The save path writes no draft payload to normal logs. Event failure aborts the
transaction; the deferred database check additionally prevents unaudited revisions.
Audit metadata is internal and must be excluded from all future public DTOs.

The event schema reserves `approved` and `published` operation names and exact
revision/actor bindings. No service methods implement those operations. Reviewer
separation, confirmation, publication policy, retention and history UI remain
deferred. Second-person review is explicitly **not mandatory in this slice**.

## Migration/environment status and validation

At the initial implementation checkpoint, Migration 41 was authored, **not applied**.
The authorized disposable PostgreSQL validation below supersedes this test status.
Migration 40's actual live/development
state remains uncertain. No database target or credentials were selected, copied
or invented. `TEST_DATABASE_URL` was absent in the execution environment; PostgreSQL
integration tests were authored but their database cases were not executed.

The new database suite is opt-in through TEST_DATABASE_URL and uses a unique
disposable schema, following existing test conventions. It covers up/down/reapply,
F054 preservation, zero grants, save/no-op, concurrent stale writes, composite
ownership constraints, immutable/late child writes, missing audit, injected event
failure and retained-data rollback refusal. Until executed, PostgreSQL constraints,
DDL and real transaction rollback remain unverified.

Unit tests separately exercise strict validation, contact consistency, URL/asset
rules, deterministic snapshots, actual-diff classification and SQL recording-double
proofs of tenant predicates, fresh authority, commit/rollback commands and default
denial. A recording double is not proof of actual PostgreSQL rollback.

### Validation outcomes

| Invocation                                              | Outcome                                                                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused new backend unit files                          | 79 passed, 0 failed, 0 skipped; exit 0                                                                                                       |
| Full backend unit invocation                            | 405 tests: 403 passed, 2 failed, 0 skipped/cancelled; exit 1                                                                                 |
| Supplemental serial rerun of the two failing test names | 2 passed, 0 failed, 0 skipped; exit 0                                                                                                        |
| Full existing backend E2E invocation                    | 48 passed, 0 failed, 0 skipped/cancelled; exit 0                                                                                             |
| Final test compilation and backend typecheck            | Passed, exit 0                                                                                                                               |
| Whole-server ESLint                                     | Passed, exit 0                                                                                                                               |
| Whole-server format check                               | Failed, exit 1: 340 unchanged files flagged; none of the feature files                                                                       |
| Feature code/migration/test/document format check       | Passed, exit 0                                                                                                                               |
| Backend production build                                | Passed, exit 0                                                                                                                               |
| Migration static checks                                 | Timestamp/ordinal, packaged registry files and no permission/F054 mutation checks passed within unit coverage; TypeScript compilation passed |
| PostgreSQL integration                                  | Not executed: TEST_DATABASE_URL absent; no database fallback                                                                                 |
| Git whitespace/scope checks                             | Passed; protected surfaces and dependency manifests unchanged; index empty                                                                   |

The full unit failures were unchanged `development-startup.test` (60-second
subprocess ETIMEDOUT) and the startup-failure case in `logging-sanitization.test`
(child exit status null under its 10-second limit). Full checks ran concurrently;
resource contention is a plausible explanation, not a proven root cause. Both
tests passed on the subsequent isolated serial invocation at their original limits
(approximately 21.4 and 3.9 seconds). No assertions, limits or existing tests were
changed. The original failed full invocation remains a failed invocation; the
supplemental pass is not a clean full-suite result. The 79 new tests also passed
inside that full run and are not counted twice.

The broad Prettier warnings concern unchanged checkout files. A read-only probe
of `server/package.json` confirmed CRLF input fails and the identical content with
LF normalization passes. This explains that representative warning; it does not
claim every warning has the same cause. No unrelated formatting was performed.
Initial implementation checks also identified six nullable-test compile errors
and 19 lint errors in newly added code/tests; these were corrected before the
final successful compile/typecheck/lint and full test invocation.

Commands used the repository scripts' local entry points because npm was not on
PATH. The server dependencies were installed with `npm ci --ignore-scripts` using
the existing lockfile; no manifest/lockfile change or new project dependency.
The temporary npm runner, cache and logs are ignored under `.local-uat/`.

From `server/`, except where noted:

```text
node node_modules/typescript/bin/tsc -p tsconfig.test.json
node --test dist-test/test/unit/resident-experience.test.js dist-test/test/unit/resident-experience-service.test.js
node --test                                      (cwd: server/dist-test/test/unit)
node --test --test-concurrency=1                  (cwd: server/dist-test/test/e2e)
node --test --test-concurrency=1 --test-name-pattern="configured development compiler|migration, seed and API startup" dist-test/test/unit/development-startup.test.js dist-test/test/unit/logging-sanitization.test.js
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js .
node node_modules/prettier/bin/prettier.cjs --check "{src,test,migrations}/**/*.{ts,json,md}" "scripts/*.mjs" "*.{json,md,yml}"
node node_modules/prettier/bin/prettier.cjs --check src/resident-experience/*.ts src/database/database.types.ts migrations/20261011000000-add-resident-experience.ts test/unit/resident-experience*.ts test/helpers/resident-experience.fixture.ts test/database/resident-experience.integration.test.ts ../docs/features/F059-2-tenant-resident-experience.md
node node_modules/typescript/bin/tsc -p tsconfig.build.json
git diff --check
```

Local logs: `.local-uat/f059-2-unit.log`, `f059-2-e2e.log`,
`f059-2-timeout-rerun.log`, `f059-2-lint.log`, `f059-2-format.log`.
Frontend/shared/browser suites were not run for this backend-only slice. No
manual visual UAT or live identity/database UAT is claimed.

## Phone-validation correction after architecture/security review

The review found excessive backtracking in the phone display regex: repeated
digit groups separated by an optional separator allowed many equivalent digit
partitions before rejection. Malformed 20-, 24-, and 26-digit values followed by
`!` took approximately 31 ms, 460 ms, and 1.6 seconds in the review probe despite
the existing length bound.

`validatePhone` now uses a forward-only parser with explicit ASCII digits,
optional leading `+`, nonempty parenthesized digit groups, and single space,
dot or hyphen separators. The 32-character display bound, 2–15 digit normalized
target, exact display/target consistency, and fail-closed structural grammar are
preserved. `911` remains structurally supported; no jurisdictional validity is
inferred. Each input character is consumed at most once, without backtracking.

Twenty-eight added regression cases cover 20/24/26/31 digits plus an invalid
suffix, overlength input, excessive separators, repeated/leading/trailing
whitespace, malformed parentheses, non-ASCII characters, valid short/formatted
numbers and mismatched targets. A worker-isolated corpus check has a generous
10-second watchdog starting after module loading so a regressed synchronous
validator cannot block the watchdog. Existing test timeouts were not changed.

A local post-correction sample rejected 20/24/26/31 digits plus `!` in approximately
2.4/0.3/0.5/0.2 ms respectively. These are observational samples, not timing
guarantees or brittle millisecond assertions.

The corrected resident-experience domain and service focused invocation passed:
107 tests, 107 passed, 0 failed, 0 skipped/cancelled; exit 0. Test compilation,
backend typecheck, production build, changed-file ESLint and TypeScript-file
Prettier checks passed. Three new-code lint findings and a formatting finding
were corrected before those final successful checks.

The single post-correction full backend unit invocation (`node --test` from
`server/dist-test/test/unit`) passed: **433 tests, 433 passed, 0 failed,
0 skipped/cancelled**, exit 0, approximately 44.5 seconds. Both previously failing
subprocess tests passed at their unchanged limits; no isolated rerun was needed.
This is a new clean invocation and does not rewrite the earlier failed 405-test
run. The 107 focused cases are included in the 433 total, not additive. Logs are
`.local-uat/f059-2-phone-focused.log` and `.local-uat/f059-2-phone-unit.log`.
Git whitespace checks passed. The correction changes only this feature record,
the domain validator and its unit test file; all other Slice 1 files remain as
reviewed. No migration, permission, API, homepage or architectural change was made.

At the phone-correction checkpoint, `TEST_DATABASE_URL` was checked again and was absent. No database integration
tests or migrations were executed, and no fallback database or credentials were
used. Migration 41 apply/schema/rollback/reapply, F054 and permission/default-data
preservation, all cross-tenant relationships and pointers, revision/child/event
immutability (including late insertion and applicable TRUNCATE), atomic audit
commit and rollback, audit-metadata constraints and required evidence, concurrent
save/stale-write behavior, same-tenant publication-pointer protection, and
retained-history rollback refusal remain **unverified against PostgreSQL**.
Unit/recording-double results do not establish these database guarantees.

## Authorized Slice 1 disposable PostgreSQL validation

The user explicitly authorized migration and integration validation using only
the existing process `TEST_DATABASE_URL`. Read-only identity checks confirmed
database `reqro_f0592_test` and user `reqro_test_user` before each database test
invocation. No connection string was printed, no other database was used, and no
`.env` was read or copied. The test now also checks that exact disposable identity
before any schema/extension mutation and cleans up only a schema it created.

Baseline: branch `codex/f059-tenant-config`, HEAD
`b1d0c4dff912501b0b546e1675d440ce863cd85f`, empty index, existing uncommitted Slice 1
files, 0 ahead/0 behind last-known `origin/main` at the same commit. No fetch.

The existing database test mechanism calls the compiled migrations' `up`/`down`
functions in transactions inside a unique disposable schema. It applied migrations
1–40, created fictional Organizations/staff and nonempty F054 branding, applied
migration 41, rolled back 41 with empty resident history, and reapplied 41. All
steps passed. The test verified exactly six added tables, 13 foreign keys including
10 composite Organization-scoped keys and the revision-specific contact key.
F054 values/revision/timestamps and the complete permission registry were preserved;
role grants stayed empty. Revision/action/benefit/contact/event tables were empty
after apply/reapply, with no emergency/contact defaults. Existing and newly created
Organizations received empty resource rows with revision 1 and null pointers.

Focused coverage additions prove cross-Organization revision-creator rejection,
action/benefit/contact insert rejection, both event revision references, all three
late child inserts, and same-Organization publication-pointer rejection at commit.
Existing read/actor/resource-pointer, revision-specific contact, duplicate ID/order
and event-actor checks remain. UPDATE/DELETE/TRUNCATE rejection covers revisions,
all child tables and events. Missing save evidence is rejected. Injected event
failure restores the exact contents of all six tables. Concurrent draft saves
produce one winner and one HTTP 409 conflict, one revision/event increment, and
the winning content; stale expected revisions are rejected. Publication failure
and retained-history rollback refusal preserve all six tables exactly.

| Invocation                                   | Result                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Original F059.2 PostgreSQL suite             | 10 passed, 0 failed/skipped/cancelled; exit 0                                                    |
| First expanded PostgreSQL suite              | 20 total: 18 passed, 2 failed (one child assertion plus its parent), 0 skipped/cancelled; exit 1 |
| Final complete F059.2 PostgreSQL suite       | 20 passed, 0 failed/skipped/cancelled; exit 0                                                    |
| Post-PostgreSQL focused domain/service units | 107 passed, 0 failed/skipped/cancelled; exit 0                                                   |

The first expanded run exposed a test-fixture interaction: the new event test
advanced the other Organization's resource before the pre-existing pointer test,
so revision validation rejected the write before the expected foreign-key failure.
The new event cases now create independent Organizations. The original foreign-key
assertion and application protections were preserved. One intermediate test
compilation also failed because the new fixture's operation literal widened to
`string`; its type was corrected. No implementation defect was found, and no
runtime or migration code changed during this validation task.

Final test totals are **127 runner-counted tests passed**, including the PostgreSQL
parent test (19 PostgreSQL child cases plus 107 units), with zero failures/skips/
cancellations in the final invocations. Earlier runs are not added to that total.
This is the complete F059.2 integration file, not the repository-wide database
suite; unrelated database suites, full backend units/E2E and frontend suites were
not rerun in this validation-only task. Prior invocation results above remain
historical evidence, including their failures.

Final test compilation, backend typecheck, backend production build, changed-test
ESLint, changed-test/feature-record Prettier and `git diff --check` passed (exit 0).
The reviewed integration and unit invocations repeated the same 20/107 passes
after adding an explicit `ConflictException` type assertion for the concurrent
loser; these reruns are not additive. The connection-string scan of the three
changed files passed. Protected tracked UI/authentication/admin surfaces and
dependency manifests remained unchanged; the index is empty.

Commands use the existing package scripts' local entry points because Node/npm
are not on PATH (the available bundled Node executable was invoked by absolute
path). From `server/`:

```text
node node_modules/typescript/bin/tsc -p tsconfig.test.json
node --test dist-test/test/database/resident-experience.integration.test.js
node --test dist-test/test/unit/resident-experience.test.js dist-test/test/unit/resident-experience-service.test.js
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.build.json
node node_modules/eslint/bin/eslint.js test/database/resident-experience.integration.test.ts
node node_modules/prettier/bin/prettier.cjs --check test/database/resident-experience.integration.test.ts ../docs/features/F059-2-tenant-resident-experience.md
git diff --check
```

Ignored local logs: `.local-uat/f059-2-pg-initial.log`,
`f059-2-pg-expanded-first.log`, `f059-2-pg-final.log`, `f059-2-pg-unit.log`,
`f059-2-pg-reviewed.log`, and `f059-2-pg-reviewed-unit.log`.
Each database invocation cleaned up its disposable schema. This validates migration
behavior without applying anything to a live/development database or retaining a
test application schema. No permissions/grants, controllers, homepage changes,
asset/theme registry changes, dependencies, or Slice 2 implementation were added.

This validation task changed only this record, the feature index, and
`server/test/database/resident-experience.integration.test.ts`; other existing
Slice 1 changes remain uncommitted and unchanged by this task.

## Slice 1 acceptance and local commit gate

The user accepted Slice 1 after architecture/security review and dedicated
PostgreSQL validation and authorized only the intended Slice 1 files for a local
commit with subject:
`feat(resident-experience): add tenant configuration persistence foundation`.
The validation history above is preserved, including earlier failed invocations
and the explicit limitation that the repository-wide database suite was not run.

STOP after the local commit and Git-state report. No push, deployment,
live/development migration application or Slice 2 is authorized. No public/admin
controllers, homepage integration, preview/publish UI, Alerts administration,
tenant domain resolver or uploads were added.
