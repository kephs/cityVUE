# F042 — Requester Communication implementation report

Status: Implementation, final automated validation and cleanup complete for local
feature review, with the approved UAT exception and limitations below.

Starting branch: main. Starting HEAD and unchanged locally cached origin/main:
`371ec3bd753b6054cdc5403ad0e88898ef0ea161`.
Commit message: `feat(requests): add requester communication foundation`.
The final hash, clean-tree status and ahead/behind result are recorded in the
post-commit completion response; this report is included in that feature commit.
No push, deployment or F043 work is authorized.

## Approved UAT exception: two immutable fictional records

**The final personal reqro_dev count for SR-202609-000007 is 2, not 1.**
The user explicitly approved retaining both records and continuing non-mutating
validation. The first was the intended F042 creation UAT. The second was
accidentally created by later keyboard automation. Both contain fictional/synthetic
test content; neither resulted in external delivery.

This is an acknowledged UAT automation incident, **not an identified server
retry/concurrency defect**. Two added disposable React regressions clear a
multiline draft before Enter/Space activation and verify no POST; both pass.
The live keyboard exercise is not claimed as an overall pass. If investigation
identifies an application defect as the cause, work must stop before commit.

The append-only design intentionally prevents silently correcting history.
Neither record was deleted, edited, redacted or otherwise modified. No
compensating mutating live UAT was performed after approval. All 20 intended
permissions were restored. Request status/revision/updatedAt, Contact, Internal
Notes, operational Activity, assignment and watchers remained unchanged.

| Record                         | Communication ID                     | Created at (UTC)            | HTTP/audit correlation               |
| ------------------------------ | ------------------------------------ | --------------------------- | ------------------------------------ |
| Intended creation UAT          | 87c32b8d-c281-4481-badd-70f0e864d133 | 2026-09-22T00:00:57.164960Z | dcaffdd7-cb04-4508-940c-c84268318189 |
| Accidental keyboard automation | 929294bb-d59b-4d3f-9dcb-81a67acdbf62 | 2026-09-22T00:13:12.696911Z | eaed9124-1637-4d2d-8ddb-2ae2305cef24 |

Each has one matching HTTP 201 and one metadata-only creation security audit.
The approval, original checkpoints and detailed UAT sequence are retained in the
[feature record](F042-requester-communication-foundation.md).

## Domain and delivery decisions

| Domain                  | Purpose                                          | Staff-only?                          | Requester-safe?                                     |
| ----------------------- | ------------------------------------------------ | ------------------------------------ | --------------------------------------------------- |
| Description             | Original reported/requested information          | Existing projection policy           | Existing policy                                     |
| Requester Contact       | Structured requester information                 | Independently protected staff access | Existing requester policy                           |
| Request Activity        | Structured workflow/routing/ownership history    | Yes                                  | No automatic exposure                               |
| Internal Notes          | Staff collaboration                              | Yes                                  | No                                                  |
| Requester Communication | Deliberate correspondence intended for requester | Staff management is protected        | Intended content with a minimized future projection |

Correspondence is independently persisted and authorized. It neither publishes
other domains nor converts Notes into messages. The approved client-neutral term
is Requester Communication; historical resident intake/tracking terminology is
unchanged. [ADR-008](../architecture/decisions/ADR-008-requester-communication.md)
records the accepted separation and truthful delivery semantics.

Only PUBLIC parents are eligible. INTERNAL does not imply a resident/requester
correspondence use case: no section, composer or history fetch; API rejects it.
Direction is OUTBOUND, channel PORTAL, delivery state RECORDED. These mean stored
in Reqro for future authorized requester presentation. They do not mean presented,
read, emailed, texted or notified. EMAIL, SMS and PUSH delivery are not implemented.

Resident HTTP correspondence retrieval was intentionally deferred because a
request reference alone is not authorization and F042 does not introduce an
insecure resident-access mechanism. No sufficiently secure resident parent
retrieval mechanism was found. The pure requester projection returns id, body,
createdAt, direction, channel, deliveryState and sender “Service team.”
It strips staff identity and other domains but does not authorize retrieval or
automatically classify arbitrary staff prose as safe.

## Actual authorization and capabilities

PUBLIC parent access means `service_request.view`, trusted active Organization
and current effective Department/Division scope. The following table uses
`service_request.communication.read` and
`service_request.communication.create`:

| Parent access | Read permission | Create permission | Read messages | Create |
| ------------- | --------------- | ----------------- | ------------- | ------ |
| No            | No              | No                | No            | No     |
| No            | Yes             | Yes               | No            | No     |
| Yes           | No              | No                | No            | No     |
| Yes           | Yes             | No                | Yes           | No     |
| Yes           | No              | Yes               | No            | No     |
| Yes           | Yes             | Yes               | Yes           | Yes    |

COMMUNICATION PERMISSIONS DO NOT GRANT PARENT REQUEST ACCESS.

INTERNAL is denied even with those keys and its own
`service_request.internal.read`. Cross-Organization and out-of-scope requests
are denied. Assignment, watching, operational Role/Team membership, contact.read,
note.read/create and workflow permissions grant neither communication read nor
create. Persisted audience is authoritative; browser-supplied audience, author,
Organization, recipient, timestamp, direction, channel or state cannot change it.

The server projects `canReadCommunications` and `canCreateCommunication` from
request authorization, PUBLIC eligibility and explicit permissions. React uses
these for presentation only. Every endpoint independently checks authorization.

## Persistence, API and immutability

The new `request_communication` table has a database-generated UUID,
Organization/request composite relationship, trusted staff author composite
relationship, safe immutable author display snapshot, body, direction, channel,
delivery state, UUID submission key and database clock timestamp. No requester
name/email/destination is copied into messages. Staff author display is resolved
from the active principal, with the existing safe-name fallback; historical
snapshots remain stable when the staff display name changes. Neither projection
exposes Entra identifiers, claims, RBAC keys or unnecessary staff email.

Staff GET and POST:
`/api/v1/staff/service-requests/:serviceRequestId/communications`.
POST accepts only body in its strict DTO plus a UUID Idempotency-Key header.
GET accepts bounded page size and cursor. Ordinary list/detail carry no bodies,
previews, latest sender or count.

Bodies allow 1–4,000 UTF-16 code units before normalization, trim outer whitespace
and normalize CRLF to LF. Whitespace-only input, unsupported controls, bidi
overrides and unpaired surrogates are rejected. Unicode/multiline text is
preserved. The database stores bounded nonempty text with its own CHECK;
application validation is stricter. React renders escaped text, preserving line
breaks and wrapping long lines. HTML, Markdown, scripts and URLs remain text;
no linkification or rich text is introduced.

No update/delete API or repository method exists. Database triggers reject
UPDATE, DELETE and TRUNCATE, protecting body, author, createdAt, direction,
channel and delivery state. RECORDED is immutable in F042. A future external
delivery feature needs reviewed schema/state changes or a separate delivery
attempt stream; it must preserve message-content history.

List order is newest first by `created_at DESC, id DESC`, retaining PostgreSQL
microseconds in the opaque keyset cursor. Default 25, maximum 100, UI 25 per page.
The query reads page size +1 to determine nextCursor/hasMore; no total count.
Load older appends authoritative rows, deduplicates boundaries and focuses the
first added item. Disposable pagination tests prove deterministic ties, no
duplicates/missing rows, bounds and Organization isolation. Two live messages do
not expose Load older; its behavior is automated evidence.

Single-flight UI prevents routine repeated activation. The unique
Organization/request/author/submission-key constraint makes same-key,
same-normalized-body retries return the original record without another audit.
Changed content with the same key returns 409; a new key can append a new message.
The UI retains a retry key with an uncertain in-memory draft. This is not a
global exactly-once delivery claim. The approved second live record does not
invalidate the passing same-key retry/concurrency tests.

## Atomicity, audit and privacy

Creation checks PUBLIC parent read and both communication permissions, validates
the body/key, resolves the persisted eligible parent under shared locks and
resolves the active trusted author. Insert and
`service_request_communication_created` security audit commit together.
Audit failure rolls the message back. Disposable failure injection verifies no
partial message and no parent/Activity/Notes/contact change or body in error logs.

Audit contains trusted actor/Organization/request relationships, communication ID,
action, F042 policy, correlation and timestamp; it excludes body, contact,
description and authentication credentials. Read does not create a separate
communication-view audit. F039 contact-view audits remain separate.

Both live creation records were read back from PostgreSQL and correlated with
their captured HTTP 201 entries and one security audit each. Safe audit metadata
keys are action, communicationId, correlationId and policy. Both bodies were
absent from the captured structured application logs and security-audit metadata.
No audit entry appears in Request Activity.

| Surface                                    | Communication body       |
| ------------------------------------------ | ------------------------ |
| Authorized staff communication API         | Yes                      |
| Unauthorized API                           | No                       |
| Staff request list / ordinary detail       | No                       |
| Notes / Contact API / operational Activity | No                       |
| Security audit / application logs          | No                       |
| Browser URL / document title / analytics   | No                       |
| localStorage / sessionStorage              | No                       |
| Pure requester-safe projection             | Yes, with neutral sender |
| Resident HTTP endpoint                     | No endpoint introduced   |
| AI Workspace / model context               | No                       |

No-store middleware runs before authentication and validation on GET/POST,
including denial responses. Protected response/cache tests cover both.
Draft, retry key and stream are component memory only. Request changes,
PUBLIC/INTERNAL navigation, known permission/access loss, sign-out/unmount and
expired-session failures clear or unmount protected content and abort/ignore
old responses. A create-only 403 removes the composer while refreshing parent
capabilities; read denial clears content. Authorized content already disclosed
cannot be remotely erased before the next authoritative operation.

## Live authorization evidence

| Gate/state                        | Observed result                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Before grants                     | PUBLIC protected without body/sender/time/count/composer; INTERNAL omitted; existing domains normal   |
| Explicit read only                | PUBLIC empty history, no composer; authenticated POST 403; INTERNAL omitted                           |
| Explicit create added             | Composer; intended fictional POST 201, persisted after refresh                                        |
| Create revoked                    | History readable, composer absent, direct POST 403                                                    |
| Read revoked with create retained | PUBLIC detail accessible; messages Protected, GET/POST 403; populated Contact 200, Notes readable     |
| PUBLIC parent read revoked        | Detail 404, communication GET/POST 403; INTERNAL detail 200                                           |
| Contact revoked                   | Communication available; Contact Protected/API 403                                                    |
| Notes read revoked                | Communication available; Notes Protected/API 403                                                      |
| All restored                      | 20 keys; PUBLIC communication, Notes and Contact independently authorized; INTERNAL communication 404 |

Contact-positive checks used the existing populated synthetic F039 fixture
without changing contact. Notes-positive/communication-negative and the inverse
were exercised; no Note became correspondence. Workflow and ownership remained
available under their own keys but were not mutated for F042.
Temporary API probes used the normal authenticated repository/session and were
removed byte-for-byte. No token was copied and no authorization bypass was used.

## Final local database and parent-state comparison

Verified target: localhost:5432, reqro_dev, reqro_dev_user.
Migration `20260921000000-add-request-communications`:21 applied, 0 pending.
Its SHA-256 remained
`D0428861D7483225723F63CEEAA82BD4DE18F880E0D175C2C80A290A4A0BA898`
through the terminology correction. Existing identifiers were already neutral;
no second migration, rollback/reapply or history edit was required on personal dev.

Disposable tests cover forward, permissions, constraints, indexes, zero default
grants/messages, preservation, unused rollback/reapply and safe refusal once
messages, corresponding audit or grants exist. Personal migration preserved all
20 earlier migrations, existing requests/contact/Notes/Activity/ownership and 18
prior permissions. Both new keys existed with zero grants before explicit F036.

| PUBLIC SR-202609-000007 | Before                        | After approved exception |
| ----------------------- | ----------------------------- | ------------------------ |
| Audience/channel        | PUBLIC/WEB                    | Same                     |
| Status/revision         | Open/25                       | Same                     |
| updatedAt               | 2026-09-20 21:04:29.607261-05 | Same                     |
| Scope                   | Community Services/Parks      | Same                     |
| Assignment              | Team: Parks Queue             | Same                     |
| Watchers                | 1                             | 1                        |
| Operational Activity    | 26                            | 26                       |
| Internal Notes          | 1                             | 1                        |
| Structured contact      | No populated name/email       | Same                     |
| Communications          | 0                             | 2                        |

INTERNAL DEV-202609-00000003: INTERNAL/STAFF, On Hold/revision 24,
updatedAt 2026-09-20 04:56:47.99994-05, Community Services/Parks, Team assignment,
2 watchers, 25 Activity, 1 Note, 0 communications; unchanged.
SR-202609-000005: PUBLIC/PHONE, Open/revision 1, Public Works/no Division,
no assignment/watchers,1 Activity; contact unchanged.
SR-202609-000006: PUBLIC/PHONE, Open/revision 2, Public Works/no Division,
STAFF assignment,0 watchers, 2 Activity; contact unchanged.

Total personal communications: 2; both on SR7. Communication audits: 2.
All prior fixture and Notes hashes match the before-creation baseline. Only
correspondence and security-audit child records changed; security audit also
contains deliberately performed protected-contact view records. No operational
Activity event/type was added for communication.

## Development provisioning

F041 retained18 keys and FULL_UAT_OPERATOR before expansion are documented
[exactly in the feature record](F042-requester-communication-foundation.md#development-permission-baseline-and-intended-expansion).
F042 adds only communication.read/create. The final actual retained 20 keys and
FULL_UAT_OPERATOR after expansion are:

```text
catalog.issue_action.manage
service_request.assign
service_request.close
service_request.communication.create
service_request.communication.read
service_request.contact.read
service_request.create
service_request.create_internal
service_request.hold
service_request.internal.read
service_request.internal.update
service_request.note.create
service_request.note.read
service_request.reference.manage
service_request.reopen
service_request.resume
service_request.route
service_request.start_work
service_request.view
service_request.watchers.manage
```

geospatial.read remains absent and optional outside the bundle. No wildcard,
default grant or automatic reprovisioning exists. Runtime never evaluates bundle
names. F036 explicit dry-run/provision/revoke restored the same fictional scopes;
production/client provisioning remains blocked. No personal identity is reported.

## Responsive, theme and accessibility evidence

Requester Communication uses the F038 card/tokens after Internal Notes and
before Issue Details, outside lifecycle Actions and Request Activity. Each message
shows safe staff author, semantic time and text Outbound / Portal / Recorded.
Protected/empty/read-only/composer states are distinct. Helper text explains
recording without requester delivery and warns against staff-only content.

| Width | Authorized light/dark | Read-only light/dark | Layout/overflow                                                                    |
| ----- | --------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| 1440  | Pass                  | Pass                 | Supporting Activity column; body/composer fit; no horizontal overflow              |
| 1280  | Pass                  | Pass                 | Cards, attribution and controls fit; no horizontal overflow                        |
| 1024  | Pass                  | Pass                 | Responsive columns/stack follow F038; no horizontal overflow                       |
| 768   | Pass                  | Pass                 | Stacked content readable; composer fits; no horizontal overflow                    |
| 390   | Pass                  | Pass                 | Wrapped author/time and multiline body; controls reachable; no horizontal overflow |

After the exception approval, non-mutating checks again confirmed both messages
fit all ten width/theme combinations, with empty composer. INTERNAL refresh
confirmed no communication card/composer. Light theme and viewport override were
restored. Contact, Notes and Activity remain separate cards in the DOM.

Protected states were observed during live revocations, with no body/sender/time/
count leak, but their full width/theme matrix was not completed. It was not
repeated because the approved continuation prohibits additional mutating live UAT.
Automated protected/no-fetch tests remain evidence; this is a disclosed live
coverage limitation, not a fabricated matrix pass.

Observed semantics include H1 Service Request, H2 Issue identity, H3 sections,
H4 composers; ordered history labeled newest first; time datetime attributes;
labeled textarea with associated help/count; non-color state text; live status
region. Live checks observed Tab/Shift+Tab focus, multiline Enter, validation and
focus behavior, but the keyboard automation incident means the overall live
keyboard exercise is not marked passed. Submission, empty/maximum validation,
pending/success/error, focus restoration, XSS and duplicate-click assertions are
covered by disposable React tests. Load older is not live-testable with 2 records.
This validation is not a WCAG certification.

## Performance, limitations and deferred work

Listing uses one bounded Organization/request query with
request_communication_page_idx; the actual local plan is Limit -> Index Scan.
The index supports createdAt/UUID global order within one request. A separate
unique index enforces scoped retries. Author snapshots avoid N+1 lookups.
Contact, Notes and Activity are not joined. React does not refetch correspondence
after unrelated request mutations. A successful new create costs a message insert
and one required audit insert in its transaction; retry reads the original.
No production-scale benchmark or throughput claim is made.

No external delivery, email, SMS, push, automated notifications, provider SDK,
attachments, rich text, linkification, inbound replies, receipts, templates,
signatures, preferences/consent, editing/deletion/redaction/correction, search,
bulk messaging, AI/translation, exports/analytics, separate retention rules,
production secrets, queues/retries/bounces or resident inbox was implemented.
Future providers can extend explicit direction/channel/state and preserve the
correspondence model, but no provider abstraction is claimed. Secure requester
access, delivery attempts and governance require separate approved work.
F043 has not been selected or started.

## Files changed

38 F042 files: 16 added and 22 updated. No dependencies,
deployment configuration, personal configuration or F043 files changed.

Added:

```text
docs/architecture/decisions/ADR-008-requester-communication.md
docs/features/F042-implementation-report.md
docs/features/F042-requester-communication-foundation.md
react/src/staff/requests/RequestCommunication.jsx
react/test/RequestCommunication.test.jsx
server/migrations/20260921000000-add-request-communications.ts
server/src/service-request/request-communication-privacy.middleware.ts
server/src/service-request/request-communication.controller.ts
server/src/service-request/request-communication.domain.ts
server/src/service-request/request-communication.repository.ts
server/src/service-request/request-communication.service.ts
server/src/service-request/requester-communication.projection.ts
server/test/database/request-communication-checks.ts
server/test/unit/request-communication.domain.test.ts
server/test/unit/request-communication.service.test.ts
server/test/unit/requester-communication.projection.test.ts
```

Updated:

```text
docs/ARCHITECTURE.md
docs/CITYVUE_CONTEXT.md
docs/ROADMAP.md
docs/architecture/decisions/README.md
docs/features/F036-safe-development-staff-authorization-provisioning.md
docs/features/README.md
react/src/staff/requests/InternalRequestWorkspace.jsx
react/src/staff/requests/requestRepository.js
react/src/staff/requests/staffRequests.css
react/test/StaffRequestRepository.test.js
react/test/StaffRequestWorkspace.test.jsx
server/src/auth/auth.types.ts
server/src/database/database.types.ts
server/src/database/development-staff-input.ts
server/src/service-request/service-request.module.ts
server/src/service-request/service-request.repository.ts
server/src/service-request/staff-request-policy.ts
server/test/database/development-staff.integration.test.ts
server/test/database/request-audience.integration.test.ts
server/test/e2e/service-request.e2e.test.ts
server/test/unit/development-staff-input.test.ts
server/test/unit/staff-request-policy.test.ts
```

## Final validation and cleanup

All final suites ran after the capture was stopped and removed. No prior
assertion was weakened. Node test runs used serialized backend execution and
Vitest used the established single-worker configuration.

| Check                                     | Final result                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| Backend unit                              | 204 passed, 0 skipped                                                             |
| API E2E                                   | 38 passed, 0 skipped                                                              |
| PostgreSQL integration                    | 166 passed, 0 skipped; disposable reqro_test schemas                              |
| Shared                                    | 62 passed, 0 skipped                                                              |
| React                                     | 361 passed across 26 files; includes 31 communication component tests             |
| F036                                      | 4 manifest unit tests and 20 integration subtests passed within the totals above  |
| TypeScript                                | Test compilation, no-emit check and backend production compilation passed         |
| Backend lint                              | Passed                                                                            |
| Frontend lint                             | No configured lint command; not claimed as run                                    |
| Backend formatting                        | Full configured source/test/migration/scripts check passed                        |
| Changed frontend/documentation formatting | Passed                                                                            |
| Backend production build                  | Passed                                                                            |
| Frontend production build                 | Passed; existing minified chunk-size warning above 500 kB                         |
| Documentation links                       | 132 relative links in 9 changed documents passed                                  |
| Git whitespace                            | Passed                                                                            |
| Private configuration/credentials         | Zero findings; three unchanged synthetic test URL matches                         |
| Protected live content                    | 38 changed/new files checked against 11 protected values in memory; zero findings |

F042-specific passing coverage includes PUBLIC parent/read/create authorization,
INTERNAL ineligibility, cross-Organization/scope and forged metadata denial,
contact/Notes/workflow/assignment/watcher/member independence, capability
projection, database constraints and immutability, concurrent authors and scoped
retries, duplicate-click/cleared-draft keyboard handling, bounded keyset paging,
required-audit rollback, safe logging/cache behavior, pure requester projection,
plain-text/XSS validation, request/session state clearing and resident privacy.

| Prior feature regression                          | Result |
| ------------------------------------------------- | ------ |
| F029 intake/audience/staff attribution            | Passed |
| F030 INTERNAL workspace read/scope                | Passed |
| F031 workflow/routing/revision/audit              | Passed |
| F032 catalog action configuration                 | Passed |
| F033 immutable references/concurrent allocation   | Passed |
| F034 filters/search/pagination                    | Passed |
| F035 operational Activity and atomicity           | Passed |
| F036 explicit development provisioning            | Passed |
| F037 assignment/watchers/membership               | Passed |
| F038 presentation/responsive components           | Passed |
| F039 contact authorization/privacy/audit          | Passed |
| F040 unified audience union and PUBLIC operations | Passed |
| F041 Notes authorization/append-only/privacy      | Passed |

Commands followed the repository scripts: TypeScript test/no-emit/build configs,
Node unit/E2E/database suites, the root shared-test file list, Vitest with
vitest.config.mjs and maxWorkers=1, server ESLint/Prettier, and Vite's React build.
The database runner loaded only the approved TEST_DATABASE_URL and asserted the
disposable local test target. No production/client database was used.

The user stopped the temporary capture, restarted the normal API, and confirmed
both messages restored with an empty composer. Only the released F042 capture log
was deleted. Temporary probes were already removed; no temporary preview, UAT
script, screenshot or debug output is included. Personal configuration is intact.
Subsequent read-only verification reconfirmed 21 migrations/0 pending, exactly
2 communications/2 corresponding audits, all 20 restored keys and unchanged
fixture/contact/Notes/operational records.

Security review found no unresolved product authorization/privacy violation.
The approved automation incident and incomplete protected-state live viewport
matrix remain explicit UAT exceptions/limitations, not hidden test passes.
The existing Vite warning remains; earlier pre-UAT resource-sensitive test and
launcher failures are documented in the feature record and did not recur in
final validation. No communication body or protected contact is reproduced here.

No real email, SMS, push or external provider call occurred. No notifications,
message editing/deletion, attachments or insecure resident endpoint exist.
Nothing was pushed or deployed; no remote/cloud/client resource was modified.
Local personal reqro_dev changes are exactly the documented F042 migration,
explicit provisioning and retained synthetic correspondence/audit state. The
approved continuation made no further live data or permission mutation. F043
remains unstarted. Stop after the local commit and completion report for review.
