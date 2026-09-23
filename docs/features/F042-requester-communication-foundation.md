# F042 — Requester Communication & Correspondence Foundation

Status: Implementation, final automated validation and cleanup complete; prepared
for local commit and review. See the [implementation report](F042-implementation-report.md).
The user approved retaining two fictional communications as the UAT automation
exception below. Neither record may be changed. Starting checkpoint:
`371ec3bd753b6054cdc5403ad0e88898ef0ea161`.

## Approved terminology correction — 2026-09-21

Requester Communication is the client-neutral product term, consistent with
Requester Contact. Contact is protected structured requester information;
communication is intended correspondence; Internal Notes are staff-only
collaboration; Request Activity is operational history. References to established
resident intake/tracking still describe those existing surfaces.

The uncommitted F042 component is `RequestCommunication`, and its future
requester-facing projection is `requesterCommunicationProjection`. New file names,
UI heading/helper IDs, tests, feature links and ADR-008 use this terminology.
Permission names, API routes, PUBLIC-only eligibility and all privacy boundaries
remain unchanged.

No migration correction or second migration is needed: the already applied
`20260921000000-add-request-communications` and its table, columns, permissions,
audit action and constraints were already client-neutral. Preserve that migration
byte-for-byte, without rollback/reapply or migration-history edits. Read-only
verification at the adjustment checkpoint confirmed 21 applied, zero pending,
zero communications, zero communication grants and the same 18 retained keys.

The user confirmed the pre-provisioning visual protected state:
Requester Communication / Protected / “You don't have permission to view
messages.” Provisioning was held until the terminology changes passed affected
validation. Read-only, creation, revocation and creation-log evidence is recorded
below; final results are in the [implementation report](F042-implementation-report.md).

### Terminology validation and read-only provisioning checkpoint

After the correction: backend unit 204 passed; affected React suites 134 passed
across three files; focused PostgreSQL/F036 regressions 142 passed with zero
skips. Test compilation, TypeScript no-emit, backend lint, backend/frontend builds,
backend and affected frontend/documentation formatting, 123 relative links and
Git whitespace checks passed. The private-configuration scan reported zero
findings. Frontend lint remains unconfigured; the existing Vite chunk-size
warning remains. Old generated projection files were removed before compiling
the renamed projection, preventing stale test discovery.

The migration file's SHA-256 remained identical. Read-only database comparison
confirmed all prior request/contact/Activity/Notes/ownership records, grants and
migration state unchanged by the terminology correction, with zero communications.

After those checks and the user's confirmed negative baseline, the established
F036 CLI dry-run and explicit provision added only
`service_request.communication.read` in the existing fictional Public Works /
Streets and Community Services / Parks scopes. The retained set is temporarily
the original 18 keys below plus that read key. No permission was removed;
`service_request.communication.create` remains absent. The authoritative
post-provisioning comparison confirmed 19 keys, zero communications and zero
communication audits, with 21 applied migrations and zero pending. Requests,
contact, Notes, Activity, assignments, watchers and operational memberships remain
unchanged. The user confirmed the read-only PUBLIC empty state with no composer or
Add Message control, and the absent/unavailable INTERNAL section with no composer.
The connected authenticated in-app browser then invoked the normal repository
POST for the PUBLIC fixture while create remained ungranted: HTTP 403. A temporary
local test control made this request through the existing API client and session;
it was removed immediately, with the original source restored byte-for-byte.
Database readback confirmed zero communications, zero communication audits and
unchanged inspected tables, protected records and Notes. No identity/token was
copied and no authorization bypass was used. The read-only gate has passed;
the creation stage follows below.

### Create-enabled provisioning checkpoint

After explicit acceptance of the read-only gate, F036 dry-run and confirmed
provisioning added only `service_request.communication.create` in the same two
fictional scopes. Database verification found the expected 20 retained keys,
no removals, and only `role_permission` changed among inspected tables. Requests,
contact, Activity, Notes, assignments/watchers and operational memberships remained
identical. Communications and their security audits were still zero.

The connected authenticated PUBLIC page refreshed successfully and showed the
authorized empty stream, Message textarea and enabled Add Message button. No
message has been added at this checkpoint. The existing API and frontend both
passed HTTP health/reachability checks. The required local F042 API capture file
was absent; creation is waiting for capture to start before the exactly-one
fictional message and authoritative before/after comparison.

### Live creation and revocation evidence

After the user started API capture, the normal authenticated staff UI created a
fictional multiline communication on SR-202609-000007. The response was HTTP 201,
with OUTBOUND / PORTAL / RECORDED state, trusted author snapshot and timestamp.
It persisted after refresh, the draft cleared, and no edit/delete controls existed.
The matching security audit and structured HTTP log shared correlation ID
`dcaffdd7-cb04-4508-940c-c84268318189`; both omitted the body. No external delivery
occurred. The pure requester projection used “Service team” and omitted staff
identity; no resident HTTP retrieval endpoint was introduced.

The following live checks used explicit F036 dry-runs and targeted changes, with
normal authenticated API calls and temporary UI probes removed byte-for-byte:

| State                                                      | Observed result                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Create revoked, read retained                              | Existing message readable; composer absent; direct POST 403                                                        |
| Read revoked, create retained                              | Request accessible; communication Protected, no list/composer; GET/POST 403; Notes readable; populated Contact 200 |
| Contact revoked, communication read/create retained        | Message and composer available; Contact Protected; protected contact API 403                                       |
| Notes read revoked, communication retained                 | Message and composer available; Notes Protected/API 403                                                            |
| PUBLIC parent read revoked, communication retained         | PUBLIC detail 404; communication GET/POST 403; INTERNAL detail 200                                                 |
| INTERNAL request with parent and communication permissions | Communication API 404; unsupported UI remains absent                                                               |

All 20 intended permissions were restored. Existing request/contact/Notes/
operational-Activity/assignment/watcher records remained unchanged. Only
correspondence and security-audit child data were appended.

### Approved UAT exception — two immutable fictional communications

During subsequent keyboard testing, the assistant's browser automation
unexpectedly submitted the temporary fictional keyboard draft. This created a
second immutable communication on SR-202609-000007, exceeding the original
exactly-one live fixture limit. Further mutating UAT was stopped on discovery.
No data was deleted, no history or migration was rewritten, and no append-only
protection was weakened. The user explicitly approved retaining both records as
an F042 UAT exception and continuing only non-mutating live validation. The final
fixture count is **2, not 1**. No compensating mutation is authorized.

The first record is the intended creation UAT. The second is an accidental later
keyboard-automation submission. Both contain fictional/synthetic test content;
neither caused external delivery. This is a UAT automation incident, not an
identified server retry or concurrency defect. The immutable design intentionally
prevents silently correcting history: neither record will be deleted, edited,
redacted or otherwise modified. If subsequent investigation identifies an
application defect as the cause, stop and report it before commit.

| Record                                        | ID                                     | Persisted time (development database) | Security audit         |
| --------------------------------------------- | -------------------------------------- | ------------------------------------- | ---------------------- |
| Intended fictional multiline UAT message      | `87c32b8d-c281-4481-badd-70f0e864d133` | `2026-09-21 19:00:57.16496-05`        | One, matching HTTP 201 |
| Unintended fictional keyboard-test submission | `929294bb-d59b-4d3f-9dcb-81a67acdbf62` | `2026-09-21 19:13:12.696911-05`       | One, matching HTTP 201 |

The second correlation ID is `eaed9124-1637-4d2d-8ddb-2ae2305cef24`. Both bodies
remain absent from the captured application logs and security-audit metadata.
Both records are OUTBOUND / PORTAL / RECORDED with no external delivery. No body
is reproduced in this report. All 20 permissions were restored after the
interrupted presentation checks; the composer was left empty, the original light
theme restored, and the temporary viewport override reset.

Two additional disposable component regressions exercise clearing a multiline
draft, confirming the empty counter, and activating Add Message by Enter/Space.
Both pass with no repository POST, among 31 passing communication component tests.
These checks did not reproduce an application defect. They support the approved
distinction between the acknowledged keyboard automation incident and a product
retry/concurrency defect; they do not erase the incident. Live keyboard UAT is
not marked passed overall. Further submission checks use disposable tests only.

At approval and subsequent read-only verification: SR-202609-000007 remains Open,
revision 25, the same operational
updatedAt, Community Services / Parks, Team assignment, one watcher, 26 Activity,
one Internal Note and two communications. DEV-202609-00000003 remains On Hold,
revision 24, the same updatedAt/scope/Team assignment, two watchers, 25 Activity,
one Note and zero communications. F039 fixture records/contact are unchanged.

Authorized layout checks at 1440/1280/1024/768/390 in light/dark showed no page or
message overflow, readable plain-text wrapping, fitting composer, timestamps and
separate content cards. Read-only layout checks also fit those widths; they
revealed the second record. Protected states were observed during earlier live
revocations, but their full width/theme matrix was not completed. The approved
non-mutating continuation does not revoke permissions again; automated protected
state coverage and this explicit live limitation remain the evidence.
The capture was stopped, the normal API restored, and the released log removed.
Final validation passed: 204 backend unit, 38 API E2E, 166 PostgreSQL (zero skips),
62 shared and 361 React tests. TypeScript, configured lint, formatting, both
builds, links, whitespace and private-content checks passed. Complete evidence
and the final safe database/grant state are in the implementation report.
This validation is not a WCAG certification. Nothing has been pushed or deployed.

## Scope and chosen policy

REQUESTER COMMUNICATION IS NOT INTERNAL NOTES.

REQUESTER COMMUNICATION IS NOT OPERATIONAL ACTIVITY.

RECORDING A PORTAL COMMUNICATION DOES NOT MEAN EMAIL OR SMS WAS DELIVERED.

REQUEST REFERENCES DO NOT AUTHORIZE REQUESTER CORRESPONDENCE ACCESS.

F042 records deliberate, plain-text correspondence intended for the requester
of a PUBLIC Service Request. INTERNAL requests are ineligible; they do not
inherently represent requester correspondence. Their UI does not fetch or compose
communications. Description, structured requester contact, operational Activity,
Internal Notes and correspondence remain independently stored and projected.

Read requires parent PUBLIC access (`service_request.view`) plus
`service_request.communication.read`. Creation additionally requires
`service_request.communication.create`. Trusted Organization and effective scope
apply to every operation; persisted audience controls eligibility. Contact,
Notes, workflow, assignment, watching and operational membership grant neither
communication permission. Communication permissions grant no parent access.

## Model and boundaries

The separate `request_communication` table stores a UUID, Organization/request
relationship, immutable body, trusted staff author relationship and safe display
snapshot, timestamp and request/author-scoped retry key. Direction is `outbound`,
channel is `portal`, and state is `recorded`. The state means persisted in Reqro
for future authorized requester presentation, not presented, delivered or read.
No external provider, notification or queue is connected.

The recipient is the requester relationship of the parent PUBLIC request. F042
neither needs nor copies a name, email or telephone destination. Staff see the
safe author snapshot; the requester-safe allowlist projection substitutes the
generic sender “Service team.” Existing request references establish no resident
authorization. Resident HTTP correspondence retrieval is deferred pending secure
resident tracking authorization. The pure projection is preparation, not an
access mechanism or an assertion that arbitrary staff-written text is safe.

GET and POST use `/api/v1/staff/service-requests/:requestId/communications`.
POST accepts only `body` and a UUID `Idempotency-Key` header. The server resolves
the parent, author, direction, channel, state, ID and timestamp. Creation and its
body-free security audit commit atomically. No operational Activity is appended;
request revision, updatedAt, contact, Notes and ownership remain unchanged.

Bodies allow 1–4,000 UTF-16 code units before normalization. CRLF becomes LF and
outer whitespace is trimmed. Empty text, unsupported controls, bidi overrides
and unpaired surrogates are rejected. Unicode and line breaks are preserved;
HTML, Markdown and URLs remain plain text. The database stores bounded nonempty
text and enforces parent/author Organization integrity.

Content and all state are append-only in F042, including `recorded`. UPDATE,
DELETE and TRUNCATE are blocked. There are no editing/deletion APIs or repository
paths. Future delivery must introduce deliberate delivery attempts/state
transitions separately from immutable message content through a reviewed
migration; no provider interface or fake sender implementation is claimed here.

Listing uses an Organization/request index and descending `(created_at,id)`
keyset, preserving timestamp microseconds. Default 25, maximum 100; the UI loads
25 at a time. No message count or preview is included in lists or ordinary
detail. No author N+1 lookup, contact/Notes/Activity join or full-text index is
needed. Production-volume performance remains unmeasured.

The UI prevents concurrent duplicate activation. A retry with the same key,
author, parent and normalized body returns the original without another audit;
changed content with the same key conflicts. A new key can append another
message. Draft/key state exists only in component memory and is discarded on
navigation or access loss. This is not a global exactly-once delivery claim.

## Validation and release gates

Disposable migration, authorization, append-only, concurrency, pagination,
audit-failure, logging, requester-facing projection and React privacy tests must pass
before applying the migration to personal development. Migration registers only
two permission names with zero default grants or fabricated messages. Unused
rollback/reapply is supported; meaningful communication, audit or grant state
prevents destructive rollback.

Live UAT must first prove the protected baseline, then explicit read-only and
create provisioning. The original plan called for exactly one fictional PORTAL
communication; the explicitly approved exception above retains two. Compare
parent values, prove revocations and
independent content domains, and restore the deliberate retained grant set.
Record actual validation evidence here before committing. No push, deployment,
external message, client/cloud resource change or F043 work is authorized.

## Pre-UAT validation checkpoint — 2026-09-21

Implementation is not yet committed or accepted through full live UAT. The
protected baseline was confirmed by the user with the terminology correction.
No communication grant had been added and no live correspondence created at this
pre-provisioning checkpoint.

| Check                             | Result                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| Backend unit                      | 204 passed, zero skipped; serialized rerun                                                       |
| API E2E                           | 38 passed, zero skipped                                                                          |
| PostgreSQL full suite             | 166 passed, zero skipped                                                                         |
| Final focused database regression | 142 passed, zero skipped after adding explicit missing-resident-endpoint assertion               |
| Shared                            | 62 passed                                                                                        |
| React                             | 359 passed across 26 files                                                                       |
| F036                              | Exact 20-key bundle and explicit read/create dry-run/provision/revoke tested; no automatic grant |
| TypeScript                        | Passed test compilation and explicit no-emit check                                               |
| Backend lint                      | Passed                                                                                           |
| Frontend lint                     | No configured script                                                                             |
| Formatting                        | Backend check and affected React files passed                                                    |
| Production builds                 | Backend and frontend passed                                                                      |
| Documentation links               | 123 relative links checked, zero broken at checkpoint                                            |
| Git whitespace                    | Passed                                                                                           |
| Private-configuration scan        | Zero findings; three unchanged synthetic test URL matches                                        |

The initial concurrent suite run timed out in the development startup check and
four existing resident intake React tests. The same tests passed with lower
concurrency; no test assertion or timeout was weakened. The existing Vite warning
for chunks exceeding 500 kB remains. No production-volume claim is made.

The `tsx` launcher failed before opening a database connection with Windows
`uv_os_get_passwd` / `ENOMEM`. The already compiled, unchanged migration CLI ran
successfully with Node and the established local configuration. No tooling or
environment configuration was modified to work around the launcher failure.

### Personal migration evidence

Verified local target: localhost, port 5432, database `reqro_dev`, role
`reqro_dev_user`. Migration `20260921000000-add-request-communications` applied;
21 migrations are now applied and zero are pending. All prior table hashes,
request records, structured contact, Activity, assignments/watchers and both
existing Notes remained identical. All 18 prior permissions remained identical.
The two new permission names are registered, with zero grants; communication
table and corresponding audit count are zero. UPDATE/DELETE and TRUNCATE
protections are installed. The local read query uses
`request_communication_page_idx` beneath a bounded Limit.

### Live fixture baseline

| Reference           | Audience/channel | Status/revision | Scope                      | Assignment | Watchers | Activity | Notes | Communications |
| ------------------- | ---------------- | --------------- | -------------------------- | ---------- | -------- | -------- | ----- | -------------- |
| SR-202609-000007    | PUBLIC / WEB     | Open / 25       | Community Services / Parks | Team       | 1        | 26       | 1     | 0              |
| DEV-202609-00000003 | INTERNAL / STAFF | On Hold / 24    | Community Services / Parks | Team       | 2        | 25       | 1     | 0              |

PUBLIC parent updatedAt baseline: `2026-09-20 21:04:29.607261-05`.
INTERNAL parent updatedAt baseline: `2026-09-20 04:56:47.99994-05`.
Neither fixture contains populated structured name/email. Use the existing
populated F039 PUBLIC fixture for contact authorization observations without
changing its contact or adding another communication.

### Authorization and data-domain matrix

For an eligible PUBLIC parent, with trusted Organization and current scope:

| Parent access | communication.read | communication.create | Read | Create |
| ------------- | ------------------ | -------------------- | ---- | ------ |
| No            | No                 | No                   | No   | No     |
| No            | Yes                | Yes                  | No   | No     |
| Yes           | No                 | No                   | No   | No     |
| Yes           | Yes                | No                   | Yes  | No     |
| Yes           | No                 | Yes                  | No   | No     |
| Yes           | Yes                | Yes                  | Yes  | Yes    |

Keys are `service_request.communication.read` and
`service_request.communication.create`. INTERNAL is ineligible even with all
keys. Tests pass for foreign Organization, missing/current Division scope,
persisted audience, forged author/channel/state/recipient metadata, parent and
child revocation, and unrelated contact/Notes/workflow/relationship permissions.
COMMUNICATION PERMISSIONS DO NOT GRANT PARENT REQUEST ACCESS.

| Domain                  | Purpose                                | Staff-only?                          | Requester-safe?                                                        |
| ----------------------- | -------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| Description             | Original problem/intake                | Existing projection policy           | Existing policy                                                        |
| Requester Contact       | Structured name/email                  | Independently protected staff access | Existing requester policy only                                         |
| Operational Activity    | Structured lifecycle/routing/ownership | Yes                                  | No automatic exposure                                                  |
| Internal Notes          | Free-text staff collaboration          | Yes                                  | No                                                                     |
| Requester Communication | Deliberate requester correspondence    | Management is protected              | Intended content, minimized future projection; no resident HTTP access |

Authorized communication responses contain only id, body, safe author display,
createdAt, direction, channel and deliveryState. Body is absent from unauthorized
responses, ordinary staff list/detail, Notes, Activity, contact, security audit,
logs, URLs, titles, analytics, persistent browser storage and AI. The pure
requester-facing projection includes intended body and “Service team” rather than the
staff author. Automated tests verify no resident HTTP route exists and prior
resident receipt/legacy privacy contracts remain intact.

### Development permission baseline and intended expansion

The F041 retained set and FULL_UAT_OPERATOR before F042 contain these 18 keys:

```text
catalog.issue_action.manage
service_request.assign
service_request.close
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

The tested F042 bundle contains exactly that set plus
`service_request.communication.read` and `service_request.communication.create`.
`geospatial.read` remains absent. Runtime does not evaluate bundle names;
existing grants did not change when the manifest changed. Explicit incremental
F036 provisioning follows the confirmed negative live baseline and validated
terminology correction, then read-only proof and creation proof.

## F046 attachment integration

[F046](F046-secure-attachments-photos-foundation.md) adds development-only private image attachments with independent parent authorization, immutable finalized relationships and separate in-memory drafts. Existing read/create permissions, PUBLIC-only Communication eligibility, recorded/no-delivery semantics, F044 exclusions and F045 Service Location remain unchanged. Photo GPS does not set or modify location. Final validation/UAT are tracked in the F046 record.
