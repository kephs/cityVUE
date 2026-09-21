# F041 — Internal Notes & Staff Collaboration

Implementation and authenticated live UAT passed from accepted F040 `5b562d692f43c01d260ec49d008d6feb94feea2e`. Initial main was clean, 22 commits ahead of unchanged origin/main. The F041 migration was applied after automated validation: 20 applied, zero pending, with zero Notes and zero Notes grants immediately afterward. Explicit read-only and create provisioning followed the negative baseline. One fictional Note now persists on each UAT request, with verified audit/log correlation and unchanged parent state. Create, Notes-read, contact-independence and parent-access revocation checks passed, as did authorized, read-only and Protected responsive/theme checks and applicable keyboard checks. All eighteen approved permissions are restored and retained. Cleanup, the mandated final automated rerun and authenticated restored-page confirmation after a normal API restart passed. The local F041 commit concludes this feature; no F042 work, push or deployment is included.

INTERNAL NOTES ARE STAFF-ONLY COLLABORATION AND ARE NOT LIMITED TO INTERNAL AUDIENCE REQUESTS.

INTERNAL NOTES ARE NOT OPERATIONAL ACTIVITY.

INTERNAL NOTES ARE NOT RESIDENT COMMUNICATION.

REQUEST ACCESS DOES NOT AUTOMATICALLY GRANT INTERNAL NOTES ACCESS.

INTERNAL NOTES ARE APPEND-ONLY IN F041.

## Authorization and domain boundaries

The persisted parent audience selects F040's read policy: PUBLIC requires `service_request.view`; INTERNAL requires `service_request.internal.read`. The same SQL query enforces the trusted Organization, active Organization and current effective Department/Division scope. An inaccessible ID returns no Notes or existence/count information. Browser audience, author, Organization and timestamps are rejected as input.

| Parent access | note.read | note.create | Read | Create |
| ------------- | --------- | ----------- | ---- | ------ |
| No            | Any       | Any         | No   | No     |
| Yes           | No        | No          | No   | No     |
| Yes           | Yes       | No          | Yes  | No     |
| Yes           | No        | Yes         | No   | No     |
| Yes           | Yes       | Yes         | Yes  | Yes    |

The exact Notes keys are `service_request.note.read` and `service_request.note.create`. Creation deliberately requires read permission as well as create and parent access, avoiding blind posting. Server capabilities `canReadNotes` / `canCreateNotes` are hints for presentation; both endpoints independently authorize. Parent update, contact.read, assignment, watchers and operational Role/Team membership confer neither Notes permission. Notes permissions confer neither parent access nor contact access.

Description is original problem information. F039 structured requester contact is a separate protected projection. F035/F037/F040 Activity is structured lifecycle/routing/ownership history. Notes are discretionary staff collaboration. Resident communication is deferred. Adding a Note creates no operational Activity, marker, narrative or contact-view event and does not change parent status, revision, updatedAt, routing, assignment, watchers, reference or requester contact.

## Storage, author and immutable history

Migration `20260920030000-add-request-internal-notes` registers the two permissions, extends the existing security-audit action constraint and creates `request_internal_note`. No grants, Notes or operational history are seeded. Existing request rows remain unchanged.

The table stores a server-generated UUID, Organization/request composite relationship, same-Organization staff-author relationship, safe author display snapshot, plain-text body, server timestamp and a per-author/request submission UUID. Author identity comes from authenticated DB-backed staff access and an active same-Organization staff row. The existing safe staff-name projection replaces email/technical-ID/control-bearing display names with `Staff member`. Later staff rename/deactivation does not rewrite historical attribution. Only the display snapshot is exposed; Entra identifiers, email, permissions and technical author IDs are excluded.

Database triggers reject UPDATE, DELETE and TRUNCATE. No API/repository method edits or deletes Notes. Body CHECKs require non-whitespace text and a database maximum of 4,000 Unicode characters; the stricter API/UI limit is 4,000 UTF-16 units, matching existing textarea/narrative conventions. Composite foreign keys prevent cross-Organization parent/author relationships. An index on Organization, request, createdAt descending and ID descending supports scoped history reads. The unique submission constraint supports retries. Rollback locks dependent tables and refuses existing Notes, Notes audit or Notes grants; unused rollback/reapply is supported. Never destructively roll back personal development Notes.

## API, pagination and transaction

`GET /api/v1/staff/service-requests/:requestId/notes` accepts only optional `pageSize` (default 25, maximum 100) and an opaque `cursor`. It returns `{ items, pageSize, hasMore, nextCursor }`, with no total count. Items contain only `{ id, body, author: { displayName }, createdAt }`.

Newest-first keyset pagination uses PostgreSQL timestamp microseconds and descending UUID as a stable tie-breaker. It fetches at most pageSize+1 rows. Newer concurrent additions do not shift older pages. Every page reauthorizes the parent and applies the same Organization/request predicates. Cursors confer no authorization.

`POST` at the same route accepts only `{ body }` and requires a UUID `Idempotency-Key` header. The browser holds a fresh key for a logical draft submission in component memory. Retries of the same normalized body by the same author/request return the original authoritative Note and create no additional audit. A different body with the same key returns conflict. Every retry reauthorizes. A new draft/key is a new append; this is not a global exactly-once delivery promise. Navigation clears memory, including retry keys.

One transaction locks the authorized parent/classification in shared mode, resolves the active trusted author, inserts the immutable Note and inserts the required security audit before returning. Audit failure rolls back the Note. Concurrent submissions need no parent revision token and never allocate a sequence using MAX+1. Reads share-lock the parent during the scoped projection. Creation takes a staff-row shared lock for the author snapshot. No contact or Activity join is used; there are no per-Note author lookups or identity-provider requests.

Security audit action: `service_request_internal_note_created`. Existing audit columns identify trusted staff actor, Organization, request and timestamp; actor_reference is null. Metadata contains only `{ policy: 'F041', action: 'internal_note_created', noteId, correlationId }`. Correlation is server-owned, not an echoed client header. Body/contact/description are never included. Notes reads do not generate a second audit stream or noisy view events; existing sanitized request logs remain in effect.

Middleware applies `Cache-Control: no-store` before guards/validation for GET/POST successes and failures. Existing allowlist logging and exception sanitation exclude request/response bodies, SQL text and raw errors. Note text is absent from list and ordinary detail payloads, Activity, contact projections, resident APIs, URLs, titles, analytics and persistent browser storage. New capability booleans are staff-only.

## Plain text and UI

The API checks the input length before trimming. CRLF/CR normalize to LF; leading/trailing whitespace is trimmed; meaningful line breaks and Unicode remain. Empty/whitespace-only input, C0 controls other than line breaks, C1/DEL and bidi embedding/isolate controls are rejected without echoing input. HTML-like, Markdown-like, @mention-like and URL-like strings remain plain text. React interpolates text; no HTML/Markdown execution, automatic links, uploads or identity resolution exists.

One shared F038 card serves both audiences, in the main information column after the existing Contact/ownership areas and before Issue Details. Activity and lifecycle Actions retain separate panels. The existing F038 DOM order is preserved, with Notes added without rearranging ownership/contact. Notes have safe author text, semantic time, full multiline text and wrapping for long unbroken strings. Load older appends a bounded page and focuses the first older Note. Refresh is explicit; unrelated operational refresh does not refetch Notes.

States: `Protected` / `You don't have permission to view internal notes.`; authorized empty `No internal notes have been added.`; `Loading internal notes…`; readable stream without composer; or stream plus `Add Internal Note`. The textarea has a visible label, 4,000-unit count and concise sensitive-information guidance. Enter inserts a line. Add Note is single-flight and disabled while pending. Success announces `Internal note added.`, uses the server projection, clears the draft and restores textarea focus. Ordinary transient failure retains the draft/key with a safe error. Known access denial clears protected state and rechecks the parent independently.

Request or capability changes remount Notes immediately, abort pending operations and discard stream/draft; late responses cannot populate another request. Parent loss/session loss unmounts the detail. There is no permission polling: revocation is reflected when the next authorized detail/Notes operation resolves. No note-count hint is shown without read permission.

## Development and validation gates

F036's manifest/FULL_UAT_OPERATOR expands from the accepted sixteen F040 keys to eighteen by adding note.read and note.create. Other bundles and optional geospatial remain unchanged. This is provisioning shorthand only; runtime never evaluates bundle names and existing stored grants never change automatically. Automated validation and the safe migration passed. After the negative manual baseline passed, explicit read-only provisioning added note.read to the original sixteen personal permissions. After the read-only browser check passed, a separate explicit provisioning added only note.create.

Sequence: verify localhost:5432 / reqro_dev / reqro_dev_user without printing credentials; preserve fixture hashes; apply the tested migration (expected 20 total, zero pending); prove zero grants/Notes. Use normal personal Entra authentication in manual Chrome UAT. First both audiences must show Protected. Explicitly provision read alone and prove read-only/empty state; only then provision create. Add one fictional Note each to SR-202609-000007 and DEV-202609-00000003, recording parent and Activity invariants. Test targeted create/read/contact/parent-read revocations and restorations, safe audit/log correlation, resident privacy, five viewport widths, light/dark and keyboard/reading order. Retain the two Notes keys and the prior sixteen after successful UAT. All existing F036 production/client/profile safeguards remain.

Current automated evidence and live observations will be recorded in the final implementation report. Disposable integration tests provide append-only, concurrency, migration rollback and audit-failure evidence. Personal reqro_dev is never used for destructive failure injection. Final suites must be rerun after live UAT/cleanup before a local F041-only commit. Nothing is pushed or deployed.

## Limits and deferred work

Notes can contain incidental sensitive information. Authorization is not automated PII detection/redaction and does not establish legal privilege, public-records status or jurisdictional retention rules. Existing platform/request governance applies; no new retention or expiry is implemented. Future redaction requires accountable, non-destructive design.

No editing, deletion, correction/version chains, search/filters, attachments, mentions, notifications, resident messaging, exports, analytics, AI/provider/model/embedding use, rich text, automatic linkification, production Notes administration or F042 work is included. No resident count or indication of a particular Note is added. Production-volume query performance remains unclaimed; bounded keyset/index reads and no N+1 projection keep this foundation modest.

## Pre-UAT validation record

This paragraph records the historical pre-UAT checkpoint; the final results appear below. Backend unit: 194 passed; API E2E: 37 passed; PostgreSQL integration: 150 passed, zero skipped; shared: 62 passed; React: 323 passed across 25 files. The nine Notes unit checks also passed after the lint-compatible control-character implementation. F036 includes 19 passing PostgreSQL provisioning subtests, including explicit read/create separation and the exact eighteen-key bundle, plus existing input/unit safety checks. TypeScript, backend lint, backend formatting, both production builds, Git whitespace and private-value/credential checks passed. No frontend lint script is configured.

Security review caught the new note-creation security-audit event appearing in the legacy authenticated PUBLIC detail activity projection; the query now excludes it alongside contact-view audit. The regression explicitly checks absence of the event and all Notes data/capabilities. No Notes body was exposed by that intermediate implementation. The inactive-Organization test was corrected to the established opaque 404 response. Exact capability expectations were extended without relaxing prior assertions. Lint issues were corrected without disabling rules. The existing MapPreview initialization timing test failed once; its isolated 26-test suite and subsequent full 323-test React run passed unchanged. Vite retains the existing large-chunk/plugin timing warnings.

The migration applied only to verified localhost:5432 / reqro_dev / reqro_dev_user. PostgreSQL reports 20 applied, zero pending, with `20260920030000-add-request-internal-notes` latest. Both append-only triggers are present. Immediately after migration there were zero Notes and zero Notes permission grants across the database. Existing sixteen development permissions, all prior table hashes and all seven request hashes matched the accepted F040 baseline. HEAD remains `5b562d692f43c01d260ec49d008d6feb94feea2e`; no commit, push, deployment or F042 work occurred. The mandated final validation rerun remains due after live UAT and cleanup.

## Live UAT checkpoint — read-only provisioning

The operator confirmed that the API was restarted with normal F041 log capture and that both PUBLIC and INTERNAL request details loaded normally before any Notes grant. Both showed Protected, with no Note body, author, timestamp, count or composer. Existing Contact, Activity, Assignment/Watchers and operational controls appeared normal. This is operator-observed authenticated browser evidence, separate from automated tests.

After that confirmation, F036 dry-run selected only `service_request.note.read`; explicit provisioning added exactly that one permission in the existing Public Works / Streets and Community Services / Parks scopes. A fresh safe database inspection confirmed seventeen retained permissions, no note.create, one Notes permission grant and zero Notes. No prior permission was removed. Only the role_permission integrity hash changed; all other prior table hashes and all seven request hashes remained unchanged. Migrations remain 20 applied / zero pending.

The operator confirmed the manual PUBLIC/INTERNAL read-only check passed: authorized empty Notes streams with no composer. F036 then dry-ran and explicitly provisioned only `service_request.note.create`. The resulting eighteen-key permission set retained all prior grants; only role_permission changed and all seven request integrity hashes remained unchanged. At that checkpoint there were still zero Notes, and migration state remained 20 applied / zero pending.

Before Note creation, inspection found that the expected `server/.env.f041-api.log` capture was absent. The repository-root `.env.f041-api.log` contained a MODULE_NOT_FOUND startup failure and no HTTP entries. The operator restarted the normal API capture from the server directory. Verification then matched a fresh unauthenticated Notes GET's server-owned correlation ID to its captured HTTP entry: 401, no-store, and no startup failure. The captured entry contained only the existing allowlisted operational metadata; no log body or private configuration was printed. Both ignored temporary F041 capture files must be removed before finalization.

## Live UAT checkpoint — before Note creation

After capture verification, both Notes permissions remain explicitly granted and all eighteen permissions match the post-provisioning set. There are zero Notes; all seven existing request integrity hashes remain unchanged. The following authoritative database baseline was recorded before requesting one fictional Note on each fixture:

| Request             | Status  | Revision | updatedAt (database timestamp) | Scope                      | Assignment       | Watchers | Activity | Notes |
| ------------------- | ------- | -------- | ------------------------------ | -------------------------- | ---------------- | -------- | -------- | ----- |
| SR-202609-000007    | Open    | 25       | 2026-09-20 21:04:29.607261-05  | Community Services / Parks | Parks Queue Team | 1        | 26       | 0     |
| DEV-202609-00000003 | On Hold | 24       | 2026-09-20 04:56:47.99994-05   | Community Services / Parks | Parks Queue Team | 2        | 25       | 0     |

Both fixtures have no structured requester contact. This baseline precedes Note creation. Adding Notes must leave these parent operational values and existing contact/ownership/Activity hashes unchanged.

## Live UAT checkpoint — creation, audit and create revocation

The operator confirmed both creation checks passed: composer availability, multiline Enter behavior, successful creation feedback, cleared draft, staff author and timestamp, persistence after refresh, no Edit/Delete controls, and unchanged request status. Database inspection confirmed exactly one Note per fixture (two total), each authored by the selected trusted staff principal with a safe display snapshot. The PUBLIC Note was created at 2026-09-21T17:52:24.245Z and the INTERNAL Note at 2026-09-21T17:53:02.189Z.

All seven request integrity hashes remain identical to the pre-Note baseline. Both UAT requests retain the status, revision, exact updatedAt, assignment, watcher count and Activity count in the table above. Their Note counts alone change from zero to one. Existing contact and operational Activity remain unchanged, with no Note event. Among previously existing tables, only the separate security-audit table changed.

Each Note has exactly one `service_request_internal_note_created` audit record with the correct trusted actor, Organization, request, Note ID and timestamp. Metadata keys are exactly action, correlationId, noteId and policy; actor_reference is null. Each audit's server-owned correlation ID matched a captured POST to the Notes route returning HTTP 201. Both Note bodies were absent from audit records and captured logs; existing structured contact values were absent from the captured logs. HTTP log fields matched the existing allowlist, including safe request/response content types. No raw Note body, contact value or private actor identifier was printed for these checks.

F036 then dry-ran and explicitly removed only `service_request.note.create`. Seventeen permissions remained: note.read plus the original sixteen. Both persisted Note hashes and all request hashes remained unchanged. The operator confirmed readable Notes without a composer on both audiences and direct POST denial (HTTP 403 for both). Capture inspection found four denied Notes POSTs and still only the two original successful creations; no additional Note was persisted. The denial probe used an empty body so that unexpected authorization could not create another permanent Note; automated valid-body authorization tests remain separate evidence. Note bodies remained absent from captured logs.

## Live UAT checkpoint — Notes read revocation

After create-revocation confirmation, F036 dry-ran and explicitly restored only `service_request.note.create`, returning to eighteen permissions. It then separately dry-ran and removed only `service_request.note.read`. That seventeen-key set retained note.create, contact.read, both audience read permissions and all existing operational permissions. Persisted Notes and all seven request integrity hashes remained unchanged; migrations remained 20 applied / zero pending.

The operator confirmed all checks passed: Protected Notes on both audiences with no body, author, timestamp, count or composer; parent details and independent Contact/Activity/ownership/workflow remained authorized. Both Notes GET and POST returned HTTP 403 for both audiences despite note.create remaining present. Populated Contact on SR-202609-000006 remained independently accessible while Notes were Protected. Capture inspection confirmed the additional two GET 403 and two POST 403 results. Notes and all request hashes were unchanged, and neither Note bodies nor contact values appeared in captured logs.

## Live UAT checkpoint — contact independence

After Notes-read revocation passed, F036 dry-ran and explicitly restored only `service_request.note.read`, returning to eighteen permissions. It then separately dry-ran and removed only `service_request.contact.read`. That seventeen-key set retained both Notes permissions, both parent read permissions and every other existing permission. Note hashes and all seven request integrity hashes remained unchanged.

The operator confirmed this opposite independence state passed: existing Notes readable and composer available on both UAT requests, with Requester Contact Protected. Previously loaded populated contact on SR-202609-000006 cleared on refresh and became Protected. Existing operational sections remained available. No additional Notes were created; database inspection confirmed both Note hashes and all seven request hashes unchanged. Neither Note bodies nor contact values appeared in the captured logs.

## Live UAT checkpoint — parent request read revocation

After contact independence passed, F036 dry-ran and explicitly restored only `service_request.contact.read`, returning to eighteen permissions. It then separately dry-ran and removed only `service_request.view`. That seventeen-key set retained both Notes permissions, contact.read, INTERNAL read and all other previously granted permissions. Persisted Notes and all seven request hashes remained unchanged.

The operator confirmed all parent-access checks passed: the unified All list contained only authorized INTERNAL requests; PUBLIC detail and Notes were unavailable (both direct GETs returned 404); PUBLIC contact returned 403 despite contact.read; INTERNAL detail and Notes remained accessible. Captured Notes HTTP metadata included the denied 404 alongside successful INTERNAL reads. Notes permissions did not grant parent request access.

F036 subsequently dry-ran and explicitly restored only `service_request.view`. The exact eighteen-key approved set matches the initial full F041 provisioned set, with no unrelated additions or removals. Both Note hashes and all seven request hashes remain unchanged. Migrations remain 20 applied / zero pending. The final intended retained set is all sixteen F040 keys plus `service_request.note.read` and `service_request.note.create`; geospatial remains ungranted.

## Live privacy and remaining visual checks

After Notes existed, direct unauthenticated HTTP reads of the PUBLIC legacy detail and Notes endpoint both returned 401. Each response contained only statusCode, error and requestId; neither contained Note data, Note capabilities, audit events, assignment, watchers or Activity. The Notes denial also carried no-store. The legacy detail route is an authenticated development staff route, not a resident history API. Existing resident creation still returns only id, referenceNumber, status and createdAt, and the confirmation displays the reference. No resident history was added or broadened. Automated regression additionally verifies that the authenticated legacy projection excludes Notes and their security-audit event.

The operator confirmed restored authorized Notes/Contact and all ten width/theme combinations passed on both PUBLIC and INTERNAL fixtures. Checked widths were 1440, 1280, 1024, 768 and 390px in light and dark themes. Notes placement, multiline text, author/timestamp, composer, character count, buttons, focus and separation from Contact/Activity remained usable without horizontal overflow. Keyboard checks passed for Tab/Shift+Tab, labels, visible focus, empty-draft Add Note validation and textarea focus, multiline Enter behavior, and clearing an unsaved draft when navigating away/back. Populated contact on SR-202609-000006 was available again. No additional Note was saved; both Note hashes and all seven request hashes remained unchanged. This validation is not a WCAG certification.

F036 then dry-ran and temporarily removed only note.create again to inspect the read-only visual state. The operator confirmed all ten width/theme combinations passed on both PUBLIC and INTERNAL: existing Note/author/timestamp readable, composer/Add Note absent, Refresh Notes keyboard accessible with visible focus, Contact/Activity separate and no horizontal overflow. No additional Notes or parent changes were found. F036 then dry-ran and removed only note.read, leaving the original sixteen permissions intact for the final Protected visual check. The operator confirmed all ten Protected width/theme combinations passed on both audiences: readable Protected text, no Note body/author/timestamp/count/composer, Contact/Activity independently available, sensible reading order and no horizontal overflow. Both Notes keys were then explicitly restored after a dry run; the exact approved eighteen-key set is retained. There is one Note per live fixture, so older-page behavior is covered by disposable pagination tests rather than manufacturing extra personal-development Notes. Final cleanup and automated reruns remain due before commit.

| Width  | Authorized light/dark | Read-only light/dark | Protected light/dark |
| ------ | --------------------- | -------------------- | -------------------- |
| 1440px | Operator PASS / PASS  | Operator PASS / PASS | Operator PASS / PASS |
| 1280px | Operator PASS / PASS  | Operator PASS / PASS | Operator PASS / PASS |
| 1024px | Operator PASS / PASS  | Operator PASS / PASS | Operator PASS / PASS |
| 768px  | Operator PASS / PASS  | Operator PASS / PASS | Operator PASS / PASS |
| 390px  | Operator PASS / PASS  | Operator PASS / PASS | Operator PASS / PASS |

Final log inspection again matched exactly one safe audit and HTTP 201 per Note, with no Note/contact values in captured logs and no operational Note event. Both temporary F041 capture logs have now been removed after the normal API restart released the server log. The operator initially reported temporarily unavailable requests. Local API health returned 200 and anonymous staff access returned the expected 401; the eighteen retained grants, two Notes and all seven request hashes remained intact. The operator then confirmed “API restarted normally; both restored,” establishing that both authenticated request details, existing Notes and composers returned. No extra Note was added. The earlier availability error's cause was not established. Final automated validation and the authenticated recovery gate both passed.

The post-cleanup final run passed 194 backend unit tests, 37 API E2E tests, 150 PostgreSQL tests with zero skips, 62 shared tests and 323 React tests across 25 files. Test compilation, TypeScript, backend lint/formatting, changed frontend formatting, both production builds and Git whitespace passed. Frontend lint has no configured script. Private-configuration and live protected-value scans found no matches in the 34 changed files. Existing Vite chunk-size/plugin-timing warnings remain. The [implementation report](F041-implementation-report.md) records full matrices, limitations and final database verification.

A read-only EXPLAIN of the scoped first-page Notes query on personal development data returned Limit over Index Scan using `request_internal_note_page_idx`. This confirms the intended index is selected on the tiny local dataset, not production-scale performance. The query projects only a bounded Notes page and uses stored author snapshots, without contact/Activity joins or per-row author lookups.
