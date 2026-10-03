# F059.2 — Tenant-configurable resident experience

**Current work: Slice 2 public read and frozen homepage integration.** Slice 1
was accepted, committed and pushed as `746a4f26a8d61fa2a1b34246dce578d3154267e1`.
The separately authorized Slice 2 scope and validation record follow the retained
Slice 1 history below. No Slice 2 staging, commit, push or deployment is authorized.

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

## Slice 2 — Published-only public read and homepage integration

Baseline verified before editing: this worktree, `codex/f059-tenant-config`, HEAD
`746a4f26a8d61fa2a1b34246dce578d3154267e1`, clean index/tree and an actual
`git ls-remote` match to `origin/codex/f059-tenant-config`. AGENTS.md and the
execution protocol were read. Frozen homepage reference:
`b1d0c4dff912501b0b546e1675d440ce863cd85f`.

### Implemented read contract

`GET /api/v1/resident-experience` is anonymous, read-only and initially
`Cache-Control: no-store`. All query parameters and nonempty GET bodies are
rejected with 400. The module registers only the public GET controller/read
service and an internal repository; it does not register the draft-write service
or any write, preview, history, approval or publication route. Existing global
throttling, validation, security headers, logging and error sanitation apply.

Organization resolution reuses `catalog.developmentOrganizationId`, the existing
server-owned anonymous catalog/Alerts convention. Host, X-Forwarded-Host, custom
browser headers, body and query values never choose Organization. Production
hostname/domain tenant resolution remains a separate deployment architecture
requirement; this slice does not implement or claim it.

The repository starts a read-only REPEATABLE READ transaction, selects only the
published pointer for the active Organization resource, and loads that immutable
revision and its Organization/revision-scoped children in the same transaction.
It never selects the draft pointer for this path, chooses a latest revision,
mixes revision children or substitutes another tenant. An inactive/missing
Organization is 404. No published pointer returns an explicit null configuration.
Invalid stored content or persistence failures produce sanitized 503 responses;
only the fixed operational message `Resident experience unavailable` is logged.
No full documents, contact history, raw errors or SQL are logged.

The versioned DTO is:

```text
{ schemaVersion: 1, configuration: null | {
  presentation: { branding, metadata, navigation, hero,
                  actionsTitle, benefitsLabel, footer },
  actions: [{ id, enabled: true, order, iconKey, title, description,
              ctaLabel, actionType, target, tone }],
  benefits: [{ id, enabled: true, order, iconKey, title, description }]
} }
```

Presentation carries the validated public text, structured headline/tagline,
navigation/footer links and packaged asset/theme keys from Slice 1. Actions and
benefits are deterministically ordered and disabled items omitted. Phone CTA
labels combine the number-free action label with the referenced contact's display
number; their normalized target comes from that same validated contact. The frozen
renderer constructs `tel:` from this target. Contact records, guidance/history,
Organization/revision/actor IDs, draft pointers, events, approval state and internal
debug/correlation fields are absent. There is no publication token or browser
cache because it is unnecessary for this no-store read.

### Frontend and fallback policy

The dedicated repository calls only `/resident-experience` in existing API mode,
without authentication or Organization selectors. Existing legacy mode uses the
same safe generic presentation without making a configuration request. The adapter
validates the complete bounded DTO before producing one complete homepage input;
there is no merge of partial configuration with defaults. Empty published action
collections remain empty. Malformed responses fail back to safe generic content.

The separate safe public fallback keeps packaged Reqro visuals, generic metadata,
hero/benefits/footer and only Report a Concern to `/report`. It contains no phone
actions, emergency numbers or tenant emergency guidance. The original three-action
configuration remains a code-owned reference/template, never the automatic public
fallback. Both the context default and runtime loader start safely, so initial
load, network delay and errors cannot flash unverified emergency contacts.

`AppLayout` mounts one loader above the existing `HomePresentationProvider` on the
homepage. The header, hero, actions, benefits, footer and metadata consume the same
atomic provider value. Requests are aborted and old completions suppressed on
unmount, account/login/logout changes and API-source changes. Prior-context content
is removed during render before the next effect. No tenant configuration is stored
in local/session storage or mutable process-wide globals. Explicit code-owned
presentation injection remains available for reference tests.

The adapter uses role-specific packaged asset mappings; unknown/wrong-role keys
select only the generic asset for that role. Missing required fields reject the
whole DTO. Unknown theme keys map to Reqro. Icon keys, semantic tones and internal
destinations have separate closed allowlists. CSS, arbitrary paths, styles,
dimensions and staff route destinations are not accepted from the DTO. Staff entry
stays code-owned. Frozen rendering components and `home.css` are unchanged.

F019 remains independent and unchanged above the hero: no alteration to polling,
eligibility, ordering, empty-space behavior or storage. No Alerts administration.

### Validation and review status

Focused backend units: **117 passed / 0 failed / 0 skipped**. Public API E2E:
**12 passed / 0 failed / 0 skipped**. Dedicated PostgreSQL suite: **26 passed /
0 failed / 0 skipped**, including its parent case (the accepted 20 plus six Slice 2
cases). The exact approved test database/user were verified before execution;
only TEST_DATABASE_URL was used and its value was not printed. Fixtures live in
unique disposable schemas which are removed afterward.

Test-only fixture SQL temporarily disables named triggers only within its own
disposable schema to seed publication/corruption states, then restores them.
Composite ownership checks remain active during publication setup, and tests
confirm the runtime publication guard still rejects changes afterward. No runtime
backdoor, migration change, new permission or grant exists. PostgreSQL tests prove
unpublished/latest drafts stay private, a differing published snapshot is returned,
other Organizations remain isolated, concurrent publication changes cannot tear a
read snapshot, malformed/missing assets fail closed, and inactive Organizations
cannot disclose publications. Unit/API tests also cover invalid destinations,
unknown themes/role substitution, missing contacts, phone mismatch, projection
privacy, unsupported selectors and absence of anonymous mutations.

Initial test compilation failed on a deliberately corrupted fixture update because
the accepted immutable column type correctly forbids UPDATE. The test was corrected
to controlled SQL in the disposable schema; runtime types and protections were
not weakened. The later compilation and focused suites passed.

Frontend dependencies were installed from the unchanged lockfile with scripts
disabled. The initial sandboxed install failed with registry EACCES errors; the
approved retry succeeded. npm reported six high-severity advisories in the existing
lockfile; no dependency upgrade or audit fix was performed.

The first full API E2E invocation found an integration defect: the new module
factory eagerly accessed the database client during initialization, violating the
existing AI and geospatial test harnesses' no-database-access boundary. That run
had 47 tests: 45 passed / 2 failed (their nested cases did not execute). The
repository now accepts a lazy client supplier; its module resolves the client only
when a repository operation runs. Existing tests and guards were not weakened.
The complete E2E rerun passed all 60 tests, including the restored nested cases.

| Invocation                                                            | Result                                                                      |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Final focused resident-experience units                               | 117 passed, 0 failed/skipped/cancelled; exit 0                              |
| Full backend unit invocation                                          | 443 total: 441 passed, 2 failed, 0 skipped/cancelled; exit 1                |
| Supplemental isolated rerun of both failing startup names             | 2 passed, 0 failed/skipped/cancelled; exit 0                                |
| Focused public API E2E                                                | 12 passed, 0 failed/skipped/cancelled; exit 0                               |
| First full E2E invocation                                             | 45 passed, 2 failed, 0 skipped/cancelled; exit 1                            |
| Final full E2E invocation                                             | 60 passed, 0 failed/skipped/cancelled; exit 0                               |
| Full PostgreSQL suite                                                 | 604 passed, 0 failed/skipped/cancelled; exit 0                              |
| Post-lazy-client focused PostgreSQL rerun                             | 26 passed, 0 failed/skipped/cancelled; exit 0                               |
| Shared suite                                                          | 64 passed, 0 failed/skipped/cancelled; exit 0                               |
| First focused React invocation                                        | 43 passed across 4 files, 2 worker-startup errors; exit 1                   |
| Unchanged focused React rerun outside sandbox                         | 82 passed across 6 files; exit 0                                            |
| Final adapter/provider focused React rerun                            | 82 passed across 6 files; exit 0                                            |
| Full React suite                                                      | 849 passed, 3 failed across 58 files (852 tests); exit 1                    |
| Supplemental isolated React timeout rerun                             | 2 passed, 1 failed, 30 skipped by name selection; exit 1                    |
| Final React production build                                          | Passed, exit 0; large-chunk warning                                         |
| Whole-server ESLint after ten new-code findings were corrected        | Passed, exit 0                                                              |
| Post-lazy-client compilation/typecheck/build and affected-file ESLint | Passed, exit 0                                                              |
| Whole-server Prettier                                                 | Failed, exit 1: 338 unchanged files flagged; no changed server file flagged |
| Changed backend/new frontend/feature-record Prettier                  | Passed after one test-file formatting correction, exit 0                    |
| Git whitespace and changed-file private-value/artifact checks         | Passed, exit 0                                                              |

The two full-unit failures are the unchanged development compiler subprocess's
60-second ETIMEDOUT and the logging startup subprocess returning null under its
10-second limit. Both passed on the isolated serial rerun at their original
limits (approximately 35.0 and 9.1 seconds). This is supplemental evidence, not
a clean 443-test invocation. The first React run failed to start workers for
HomePage and ResidentExperienceAdapter; the same six files passed outside the
sandbox without timeout/assertion changes. Focused and repeated counts are
subsets, never added to full-suite totals. No aggregate all-green claim is made.

The full React failures were the unchanged IssueCreation External Redirect and
changing Availability tests, plus ReportIssuePage Category filtering, each at the
existing 5-second limit. The isolated rerun passed Availability and Category
filtering; External Redirect timed out again. Its timeout is also recorded in the
accepted F059.1 history. These unrelated tests/components were not changed, and
the full-suite failure remains recorded. No assertion or timeout was weakened.
The final six-file focused rerun passed 82 tests after the adapter review edits.
The final React production build passed with a large-chunk warning. No standalone
frontend lint script exists; no frontend lint pass is claimed. The original
AppLayout/context formatting is preserved around the narrow integration edits.

The browser tool currently reports no browser available. The nine-width visual
matrix (360/480/720/900/1200/1366/1440/1536/1920, light/dark) is therefore unverified,
not passed. The explicit publication fixture uses `Call 240-314-8567` under the
accepted number-free-label/contact derivation contract; the frozen reference's
water CTA is just the number. This content difference does not change CSS/layout.

Commands use the bundled Node executable and existing package-script entry points.
Backend commands, from `server/`: `tsc -p tsconfig.test.json`,
`tsc -p tsconfig.json --noEmit`, `tsc -p tsconfig.build.json`, `eslint .`, and the
package's Prettier glob check. Compiled tests use `node --test` from each
`server/dist-test/test/{unit,database}` directory and
`node --test --test-concurrency=1` from `server/dist-test/test/e2e`.
Focused commands select the resident-experience files; the supplemental unit
invocation uses `--test-concurrency=1` and the unchanged name pattern
`configured development compiler|migration, seed and API startup`.
Frontend: `node node_modules/vitest/vitest.mjs run --config vitest.config.mjs
--maxWorkers=1` (six named files for the focused invocation, no file selectors
for the full suite), and `node node_modules/vite/bin/vite.js build react
--outDir ../dist-react --emptyOutDir`. Shared tests use the root package's eight
explicit test files and its module-warning flag. No new validation command was
added to the manifests.

Ignored evidence logs are under `.local-uat/f059-2-s2-*.log`, including
`focused-unit`, `focused-unit-final`, `focused-e2e`, `focused-db`,
`focused-db-final`, `full-unit`, `unit-timeout-rerun`, `full-e2e`,
`full-e2e-final`, `full-db`, `shared`, `focused-react`, `focused-react-rerun`,
`focused-react-final`, `full-react`, `react-timeout-rerun`, `react-build`,
`react-build-final`, `lint`, `lint-final`, and `format-full`.

### Deferred and stop gate

Admin editor, draft/preview/history UI, approval/publication workflows, production
hostname resolution, uploads, arbitrary remote assets, permissions/grants and
Slice 3 remain unimplemented. Slice 1 publication-pointer protections stay intact.
STOP FOR ARCHITECTURE / SECURITY / MANUAL HOMEPAGE REVIEW after validation. No
staging, commit, push or deployment is authorized.

### Manual-preview correction: explicit Reqro publication fixture

The manual preview showed the safe one-action fallback. The normal frontend
defaults to legacy mode, and the public loader intentionally returns the safe
fallback in that mode. The earlier three-action test fixture was not connected
to an executable preview API. The user's specific preview URL/launch command was
not supplied, so its exact runtime mode could not be independently established.
Do not fix this by turning emergency contacts into automatic defaults.

An explicit local harness now serves the approved Reqro publication through the
ordinary API loader: `node react/test/preview-resident-experience.mjs`, after
`npm --prefix server run test:compile`. It binds only `127.0.0.1:5173`, uses no
environment files or database, and uses the real compiled server validator/DTO
projection. Startup asserts that the projected snapshot equals the expected
public fixture. It serves only the fixture GET and an empty Alerts result; other
API operations return 404. This is a visual test harness, not a runtime tenant
resolver, publication workflow, live database seed, or production fallback.
Normal application startup and production builds do not import it.

The prior water-CTA difference is corrected and supersedes the earlier recorded
exception. The exact stored phone label `{phone}` now means display the validated
contact number alone. Other phone labels retain prefix-plus-contact behavior.
This explicit whole-label marker is number-free/nonempty and requires no schema
or validation relaxation. It does not interpolate arbitrary templates. Phone
display and target still derive from the same validated contact. The approved
Reqro fixture now reproduces `Report Issue`, `Call 911`, and `240-314-8567` exactly.

The fixture's complete presentation is compared against the frozen reference,
with only invisible normalized telephone targets/explicit highlight booleans.
Added rendering checks cover the delayed safe-to-three-action transition and
exact CTA links, plus explicit no-publication rendering. Existing checks cover
failure, empty/disabled actions, atomic metadata/content, stale responses and
logout/unmount protection. The safe fallback and runtime loader are unchanged;
the fallback contains no unverified tenant phone actions.

Correction validation: **118 focused backend units passed**, **12 public API E2E
tests passed**, **84 focused React tests passed across six files**; test compilation,
backend typecheck/build and React production build passed (existing chunk warning).
Affected-file lint passed after removing one redundant optional chain in the new
test; its first invocation reported that error. The local preview homepage and public fixture
API both returned HTTP 200; the API returned `Cache-Control: no-store` and all
three expected actions/labels. Frozen CSS/rendering source comparison and
`git diff --check` passed. No database operation was performed for this correction.
The earlier full-suite failures remain recorded above and were not overwritten
by these focused results. One initial formatting command used the wrong working
directory and failed module resolution; the corrected command passed.

Browser inventory was empty and opening the running preview returned "No browser
is available". **1440 light/dark and 360 light/dark remain visually unverified**;
source/DTO/rendering tests do not replace screenshot comparison or manual UAT.
No layout/CSS changes were needed or made. STOP FOR MANUAL VISUAL UAT. Nothing is
staged, committed, pushed or deployed.

### Final Slice 2 gate closure

The user explicitly reported **manual visual UAT PASSED** on the corrected
published Reqro preview. This supersedes the earlier pending-manual-UAT status,
without converting earlier automated browser limitations into passes. On this
closure pass the browser inventory still returned no available browsers. The
automated nine-width, two-theme matrix remains unavailable; the user's manual
UAT is the accepted visual evidence. No further frontend/layout/CSS changes were
made. Frozen source comparison still matches
`b1d0c4dff912501b0b546e1675d440ce863cd85f`; approved headline/card/benefits/footer
structure, proportions and responsive rules remain intact. No new claim of
automated overflow or screenshot testing is made.

Baseline: `codex/f059-tenant-config`, HEAD
`746a4f26a8d61fa2a1b34246dce578d3154267e1`, empty index, intended uncommitted
Slice 2 files only. No Slice 3 implementation, migration, permission grant,
publication command or admin controller was found.

**Logging disposition: retain the one-line literal allowlist addition.**
`Resident experience unavailable` preserves a useful sanitized operational
diagnostic; without it the existing logger would replace that message with
`Application event`. The shared allowlist recognizes only that exact string,
not prefixes, interpolation, raw errors or arbitrary context fields. This
technically makes the fixed literal available to all logger callers, but changes
no unrelated route behavior, serializer, log level, field retention or HTTP
logging policy. The public service passes only that fixed string on failure.
HTTP logs retain existing safe request IDs, route templates, timing/status and
error classifications; no presentation, contacts, phone numbers, URLs, tenant
IDs, actors, authorization headers, bodies, drafts, error messages or stacks
are admitted by this change. New focused unit coverage checks exact-message
matching and direct/child payload exclusion. Public E2E now captures the real
operational logger and verifies success, selector/body rejection and service
failure do not log publication content or injected private sentinels. Existing
global logging tests remain intact.

**Endpoint review:** the module registers only the public GET controller and
read service/repository. No other controller exposes resident-experience writes.
Only the server-owned development Organization configuration participates in
resolution. Query parameters are rejected, browser headers cannot select tenant,
and missing/inactive Organizations fail safely. The repository reads the published
pointer in one Organization-scoped snapshot, without draft/latest substitution.
The DTO excludes actor/persistence IDs and draft/audit/history/admin metadata;
successful reads remain no-store. Framework-provided HEAD handling is read-only;
no separate HEAD or mutation handler is registered.

One closure defect was found and fixed: key-count body rejection allowed empty
JSON containers or non-JSON request bytes to evade rejection. The GET controller
now rejects parsed bodies or indicated body framing (positive Content-Length or
Transfer-Encoding), including `{}`, `[]` and text. New E2E coverage verifies 400
before the repository is read. This changes only request validation; persistence
and published projection are unchanged, so no database work was needed.

**Frontend review:** initial/loading/error/malformed/no-publication states use
generic Reqro and only the internal Report action, with neither phone number nor
emergency guidance. The provider clears prior-context content during render,
aborts on cleanup and suppresses stale completions. One loader above the existing
provider supplies one complete atomic value; sections do not fetch independently,
and no tenant presentation is stored in browser storage or mutable globals.
Valid publication restores all three approved actions and exact labels
`Report Issue`, `Call 911`, `240-314-8567`; empty published actions stay empty.
Closed role-specific asset mappings prevent paths/remote URLs/role substitution;
strict DTO fields prevent CSS/classes/styles. Unknown themes fall back to Reqro,
with semantic action tones governed separately.

Closure tests: **126/126 focused unit tests** (118 resident-experience plus 8
logging tests), **14/14 public API E2E tests**, zero failed/skipped/cancelled,
both commands exit 0. Test compilation, backend typecheck/build, affected-file
ESLint/Prettier and final `git diff --check` passed. These are focused runs, not new
full-suite passes. Previous evidence remains: final full E2E 60/60, focused
PostgreSQL 26/26, full PostgreSQL 604/604, shared 64/64, corrected focused React
84/84. Historical full backend units remain 441 passed/2 failed, full React
849 passed/3 failed; supplemental reruns retain their separate outcomes above.
Whole-server format's 338 unchanged-file findings remain recorded. No timeout
or assertion was weakened. No database identity/credentials were changed or read
for this closure; previous disposable validation was only `reqro_f0592_test` /
`reqro_test_user`.

Admin/editor/preview/history UI, approval/publication workflows, permission
registration/grants, uploads, production tenant resolution and Slice 3 remain
deferred. STOP FOR FINAL SLICE 2 HUMAN REVIEW. No staging, commit, push or deploy.

### Slice 2 acceptance

The user accepted Slice 2 after architecture/security review and passed manual
visual UAT, authorizing the intended 24 files for one local commit with subject
`feat(resident-experience): add published tenant homepage configuration`.
The validation history above is preserved, including failed full-suite
invocations and supplemental reruns. The automated nine-width/two-theme matrix
was not executed because browser tooling was unavailable. Push, merge,
deployment and Slice 3 remain unauthorized.
