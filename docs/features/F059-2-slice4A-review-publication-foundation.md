# F059.2 Slice 4A — Review/publication security foundation

Status: architecture/security review PASSED. Slice 4A is approved for one local
commit: `feat(resident-experience): add review and publication security foundation`.
No Slice 4B work is authorized or started.

## Authorization and baseline

Human approval covers Slice 4A persistence/security primitives and Migration 43,
including disposable PostgreSQL validation only. Verified baseline:
`codex/f059-tenant-config` in `cityVUE-codex-f059-2`, HEAD
`bb4546ac540a43032eb971943a4c09be4acd4828`, clean index/tree and 0 ahead/behind
last-known `origin/main`. Forty-two migrations existed before this work.

Migration 43 is `20261013000000-resident-experience-review-foundation.ts`.
It must not be applied to `reqro_dev`, staging or production under this approval.
No grants, default content, F054 branding changes, controllers, runtime publication
routes or UI are authorized. The subsequent acceptance authorizes staging only the
nine intended Slice 4A files and one local commit. Push, merge, deployment,
development migration application and Slice 4B remain unauthorized.

Follow the [execution protocol](../development/REQRO_CODEX_PROTOCOL.md),
[Organization isolation](../architecture/decisions/ADR-001-organization-isolation.md),
[Admin admission](../architecture/decisions/ADR-014-administrative-configuration-authorization.md)
and existing transaction-time authorization coordination. [ADR-024](../architecture/decisions/ADR-024-transaction-time-request-authorization.md)
remains formally Proposed; this work does not change that status.

## Approval evidence

`resident_experience_review_request` is immutable and binds Organization, exact
committed revision, draft pointer, current published pointer (including null),
resource revision, authorization revision, draft/historical purpose, policy and
classifier versions, server-derived bounded changes/reasons, requester and time.
Review sequence is database assigned under the resource lock. The caller must
identify the previous review request explicitly; concurrent stale replacement
fails. A newer request supersedes earlier requests without rewriting them.

`resident_experience_review_decision` is immutable, Organization-bound to one
request and reviewer, and records one terminal approved/rejected outcome per
request. Database-assigned decision and expiry times define a half-open 24-hour
window. Caller timestamps cannot backdate or extend approval. Request and decision
must be separate committed transactions, as must decision and publication.

The effective pending/approved/rejected/superseded/expired/consumed states derive
from retained evidence and current context, never mutable approval history.
Any content resource revision, draft/publication pointer, authorization revision,
policy/classifier or current review selection mismatch makes approval unusable.
All authorization revision changes conservatively invalidate approvals, including
revoke/regrant and unrelated authority changes in the same Organization.

Publication evidence refers to the exact request and decision. An approval can
be consumed only once. Historical republication must target a previously published
revision and acquire a fresh request/decision against the current publication;
it preserves the working draft pointer.

## Classification and independent review

The existing draft classifier and save authorization remain unchanged. Separate
publication classification compares the complete target against the current
publication. Every first publication adds `first_publication` and is consequential.
All action/contact edits and navigation/footer link changes retain conservative
classification, including disabled content. No semantic analysis of emergency
prose is claimed. Independent review is mandatory for ordinary publication too.

Contributor lineage follows Organization-bound immutable `draft_saved` ancestry,
not a caller-supplied actor list. Always exclude the target saver. Exclude authors
of consequential edges on both divergent ancestry branches after their nearest
common ancestor, including changes a historical republication undoes. With no
publication, inspect the complete target lineage. A cosmetic successor therefore
cannot launder an earlier consequential author's identity. Missing/cyclic lineage
or traversal beyond 10,000 revisions fails closed; no partial list is authorized.
The publisher must differ from the reviewer. There is no emergency or single-person
bypass. Database identity separation cannot prove distinct real-world operators.

The domain implementation and PostgreSQL implementation share the same rule;
classification and lineage agreement are validation obligations. Immutable snapshot
identity and Organization-scoped children establish exact content; no mutable copy
or inferred latest revision is published. Code-owned policy/classifier version 1
must change deliberately when those contracts change.

## Permission and transaction boundaries

The approved metadata change makes `resident_experience.contact.manage` depend on
`admin.configuration.read`, not draft-write authority. Draft saving still requires
read + write, and consequential draft saving additionally requires contact.manage.
Review/publication requires read + publish; consequential review/publication also
requires contact.manage. No permission keys, grants, bundles, default roles,
provisioning CLI or frozen 27-key delegation list change.

`ResidentReviewRepository` contains internal transaction-bound insert/read
primitives only. It is not registered as a Nest provider, controller or CLI. Trusted
staff is re-resolved under the existing Organization/access-state shared barrier
before locking the resource. There is no application publish command. Disposable
tests issue explicit transaction DML to prove the future publication contract.

Database triggers independently check current active staff/Organization and grants,
exact review context, committed immutable target, independent reviewer, publication
classification and permission requirements. All callers must use the established
Organization → access state → resource lock order. Publication evidence is inserted
before the pointer update and receives a database transaction stamp. Deferred checks
require the corresponding pointer/revision transition and same-transaction evidence,
rechecking approval lifetime and supersession/authorization at constraint evaluation.
Audit/evidence failure aborts the entire transaction. Automatic retry is not provided.

One transaction cannot save and publish an unreviewed revision. Resource insertion
must start at revision 1 with null pointers. Existing immutable snapshot, child,
event and late-child-insert protections remain in force. The reserved but previously
unsupported `approved` event operation cannot serve as fabricated approval evidence;
review decisions now live in their own immutable table.

The anonymous read path, frozen renderer, protected Slice 3 editor/preview and
public/published separation are unchanged. Exact error mapping, HTTP commands,
review presentation and publication workflow remain later-slice work.

## Rollback and database boundary

Down acquires the maintenance locks and refuses any retained review request,
decision, publication evidence or published pointer. It never deletes retained
history. With no Slice 4 evidence it removes only the new structures, restores the
Slice 3 publication prohibition and preserves existing saved drafts and children,
branding, permissions and grants. No CASCADE is used by the migration.

Integration tests verify `reqro_f0592_test` / `reqro_test_user` before creating a
unique disposable `resident_review_<uuid>` schema. They never use the normal
development configuration or existing Slice 3 UAT schema. Schema cleanup is limited
to the test's generated schema. No rollback is exercised on a development database.

## Development UAT provenance prerequisite

The preceding read-only observation of `reqro_dev.public` found 42 migrations,
two empty Resident Experience resources, no retained drafts/events/publications,
and no publication grants, despite reports of prior saved-draft/preview UAT.
This observation does not establish where that UAT occurred or that data was lost.
Reconcile the UAT environment/provenance before later Slice 4 development UAT.
It does not block disposable Slice 4A work. This implementation does not modify
`reqro_dev` or automatically provision publication authority.

## Validation record

Final test compilation passed after the initial timestamp-type correction.
Migration 43 was validated only against the verified disposable PostgreSQL
database and was not applied to `reqro_dev`. Acceptance does not reclassify any
failed invocation below as a clean run.

Validation uses the existing server TypeScript, Node test runner, ESLint and
Prettier tools. Test compilation uses `tsc -p tsconfig.test.json`; later local
iterations add `--incremental --tsBuildInfoFile ../.local-uat/slice4a-test.tsbuildinfo`
without changing the repository compiler configuration. Focused unit invocation
selects the five `resident-experience*.test.js` files including review, plus
`access-policy.test.js`. Disposable invocation uses `node --test --test-concurrency=1`
for the three `resident-experience*.integration.test.js` files. All paths are under
`server/dist-test/test/{unit,database}`. Private test configuration stays in the
environment. No normal development configuration is loaded by these tests.

| Invocation                                                | Result                                                                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Initial test compilation                                  | Failed: five timestamp-type errors in the new review test/table types; corrected                                 |
| Initial five-file focused unit run                        | 127 tests: 126 passed / 1 failed; new fixture IDs were rejected by the existing trusted-identity guard           |
| Initial Slice 4A PostgreSQL run                           | 25 tests: 3 passed / 22 failed; ambiguous SQL parameter and rollback dependency order errors; fixture cleaned up |
| Corrected Slice 4A PostgreSQL run                         | 25 passed / 0 failed / 0 skipped                                                                                 |
| Expanded focused units including access-policy regression | 134 passed / 0 failed / 0 skipped                                                                                |
| Expanded PostgreSQL regression run                        | 62 passed / 0 failed / 0 skipped: 28 Slice 4A and 34 existing Resident Experience tests                          |
| Initial changed-file lint                                 | Failed: 14 new-file import, assertion and void-expression style errors; corrected without disabling rules        |
| Whole-server ESLint                                       | Passed, exit 0                                                                                                   |
| Backend typecheck (`tsc -p tsconfig.json --noEmit`)       | Passed, exit 0                                                                                                   |
| Backend production build (`tsc -p tsconfig.build.json`)   | Passed, exit 0                                                                                                   |

Counts retain Node's parent-test accounting and are not summed across overlapping
invocations. The failed invocations remain historical evidence. Expiry boundaries
are exercised against the production SQL time predicate using explicit instants,
and against the domain usability predicate; no test waits 24 hours or weakens
timestamp/immutability triggers. Caller-supplied expiry extension/backdating is
also rejected by database timestamp stamping. The final safety check additionally
asserts the connected server is loopback and the actual search path is the newly
created disposable schema before any migration is applied.

Final boundary-hardened Slice 4A rerun: **28 passed / 0 failed / 0 skipped**,
exit 0; this overlaps the 62-test run and is not an additional distinct total.
The modified fixture passed its final lint check. All nine changed files passed
Prettier checking; `git diff --check` passed and the index remains empty. Git
reported only the repository's LF-to-CRLF conversion notices. No runtime route,
UI, normal development database or permission provisioning was changed.
