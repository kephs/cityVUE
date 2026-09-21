# F041 — Implementation and validation report

Status: implementation, personal migration, incremental authenticated manual UAT, all three responsive/theme states and keyboard checks passed. The final approved eighteen development permissions are restored and retained. Temporary-log cleanup and the required post-cleanup automated validation passed. After restarting the API normally, the operator confirmed both authenticated request details, their existing Notes and composers were restored. All completion gates passed for the local F041 commit.

## Repository and scope

Starting HEAD: `5b562d692f43c01d260ec49d008d6feb94feea2e` on main, initially 22 commits ahead of origin/main. Recorded origin/main: `6eb836892089bde09ab4255e9f6871a304065fca`. Intended local commit: `feat(requests): add internal staff notes`. The containing commit's hash, clean working-tree result and final ahead count will be supplied in the operator completion message rather than embedded recursively in this file. Expected final count is 23 ahead, zero behind. No push, deployment, remote/cloud/client change or F042 work is authorized or included.

The [feature record](F041-internal-notes-staff-collaboration.md) preserves the implementation decisions and actual chronological UAT evidence. Only personally controlled local PostgreSQL, normal personal Entra sign-in and fictional development requests were used. Computer Use was not used for this UAT; operator observations are distinguished from database, HTTP and automated evidence.

## Information domains and authorization

INTERNAL NOTES ARE STAFF-ONLY COLLABORATION AND ARE NOT LIMITED TO INTERNAL AUDIENCE REQUESTS.

INTERNAL NOTES ARE NOT OPERATIONAL ACTIVITY. INTERNAL NOTES ARE NOT RESIDENT COMMUNICATION. REQUEST ACCESS DOES NOT AUTOMATICALLY GRANT INTERNAL NOTES ACCESS. INTERNAL NOTES ARE APPEND-ONLY IN F041.

Description remains original problem information. Requester Contact remains the F039 protected structured identity/contact projection. Operational Activity remains F035/F037/F040 structured lifecycle, routing and ownership history. Notes are a separate free-text collaboration child stream. Resident communication remains unimplemented. No domains were merged; no INTERNAL_NOTE operational Activity type was introduced.

Persisted parent audience selects PUBLIC `service_request.view` or INTERNAL `service_request.internal.read`. Normal Entra validation, trusted active Organization, active staff and current effective Department/Division scope remain required. Request routing overrides catalog scope through the existing F040 predicate. Browser audience or Organization cannot select authorization. Explicit `service_request.note.read` is additionally required to read; creation also requires `service_request.note.create`. Creation deliberately requires read, avoiding blind posting. The same service, repository, endpoints and React component serve both audiences.

The following matrix passed disposable authenticated API/database tests for both PUBLIC and INTERNAL parents. Live revocations additionally exercised independent create, read, contact and PUBLIC parent-read keys.

| Parent request access | note.read | note.create | Read Notes | Create Note |
| --------------------- | --------- | ----------- | ---------- | ----------- |
| No                    | No        | No          | No         | No          |
| No                    | Yes       | Yes         | No         | No          |
| Yes                   | No        | No          | No         | No          |
| Yes                   | Yes       | No          | Yes        | No          |
| Yes                   | No        | Yes         | No         | No          |
| Yes                   | Yes       | Yes         | Yes        | Yes         |

NOTES PERMISSIONS DO NOT GRANT PARENT REQUEST ACCESS.

| Capability or relationship          | Grants Notes read? | Grants Notes create? |
| ----------------------------------- | ------------------ | -------------------- |
| Parent read alone                   | No                 | No                   |
| Parent update alone                 | No                 | No                   |
| Assignment                          | No                 | No                   |
| Watching                            | No                 | No                   |
| Operational Role membership         | No                 | No                   |
| Operational Team membership         | No                 | No                   |
| `service_request.contact.read`      | No                 | No                   |
| `service_request.note.read`         | With parent access | No                   |
| `service_request.note.create` alone | No                 | No                   |
| Both Notes keys                     | With parent access | With parent access   |

Cross-Organization, out-of-scope, inactive Organization, nonexistent request, forged body metadata and audience substitution cases are covered. Server-provided `canReadNotes` / `canCreateNotes` are derived only after parent access succeeds; they expose no raw permission list or Note count and are not the API security boundary.

## Storage, author, append-only and migration

Migration `20260920030000-add-request-internal-notes` adds `request_internal_note`, registers the two Notes permissions and permits one new security-audit action. Existing nineteen migrations remain applied. Personal reqro_dev now has **20 applied / zero pending**. Verified target was localhost:5432 / reqro_dev / reqro_dev_user; credentials were neither printed nor tracked.

Each Note has a server-generated UUID primary key, Organization, parent request, trusted staff-author relationship, safe author display snapshot, text body, server `clock_timestamp()` creation time and per-submission UUID. Composite foreign keys enforce same-Organization parent and staff relationships, with Organization validity inherited through those canonical records. No race-prone sequence allocation exists. CHECK constraints require a non-empty, non-whitespace bounded body and bounded non-empty author snapshot. Unique Organization/request/author/submission-key constraint enforces retry identity.

The author is resolved from the authenticated DB-backed staff context and an active same-Organization staff row. The existing safe-name projection substitutes `Staff member` for unsafe email/technical-ID/control-bearing names. Only `author.displayName` is exposed. Historical snapshots remain unchanged when a staff name changes; this behavior is tested. Entra object/tenant IDs, auth claims, RBAC permissions, technical author IDs and unnecessary email are absent from the Notes projection.

Application and repository expose no update or delete method. Database triggers `request_internal_note_immutable` and `request_internal_note_no_truncate` reject UPDATE, DELETE and TRUNCATE, protecting body, author and createdAt. Disposable tests verify rejection and unchanged original records. These are database protections, not merely hidden buttons. Privileged database administration is outside the normal application boundary.

Unused rollback removes the table/triggers/function and restores the prior audit constraint and permissions; apply/rollback/reapply passed in disposable schemas. Rollback takes exclusive locks and refuses meaningful Notes, Notes audit or Notes grants rather than destroying history. Meaningful-data refusal passed. No destructive rollback/failure injection was performed against personal reqro_dev.

Migration introduced zero grants, zero Notes and zero Activity. Pre-/post-application hashes preserved existing requests, references, requester contact, Activity, ownership/watchers, catalog/reference configuration and prior grants. The operator then observed Protected Notes before explicit provisioning, establishing that code/migration/sign-in did not silently grant access.

## API, projection, body safety and pagination

Only these unified staff Notes routes were added:

- `GET /api/v1/staff/service-requests/:requestId/notes`
- `POST /api/v1/staff/service-requests/:requestId/notes`

The create DTO accepts only `body`; existing strict validation rejects Organization, author, request ID, timestamps, audience, contact and arbitrary metadata. A UUID `Idempotency-Key` header is required for creation. No PUBLIC/INTERNAL duplicate Notes routes, editing, deletion, filters or search were added. Existing staff, legacy audience, resident intake and React routes retain their contracts.

Each authoritative Note projection contains exactly `id`, `body`, `author.displayName`, `createdAt`. The list adds `items`, `pageSize`, `hasMore`, `nextCursor`; **total count is omitted**. Ordinary staff detail contains capability booleans but no Note body, author, timestamp or count. Lists, dashboards, maps and AI surfaces receive no Notes.

Body maximum is **4,000 UTF-16 units**, checked before trimming by API/UI. PostgreSQL text CHECK allows at most 4,000 Unicode characters; the API bound is stricter for supplementary characters. Empty and Unicode-whitespace-only input is rejected. CRLF/CR normalize to LF; meaningful multiline Unicode remains. C0 controls except CR/LF, C1/DEL, bidi embedding/isolate controls and unpaired surrogate halves are rejected without reflecting submitted text. Ordinary HTML-like, script-like, Markdown-like, @-like and URL-like text is stored as text and escaped by React interpolation. There is no HTML/Markdown execution, automatic linkification or arbitrary URL handling.

Default page size is **25**, maximum **100**. Newest-first keyset pagination uses full PostgreSQL timestamp microseconds and descending UUID tie-breaker; opaque base64url cursors contain only that position. Scoped queries fetch pageSize+1, return a bounded page and an older cursor, without a count. Every page reauthorizes and applies Organization/request predicates. Disposable tests cover maximum bounds, exact timestamp ties, newer concurrent insert, multiple older pages, no duplicates/missing Notes and Organization isolation. React Load older appends/de-duplicates authoritative rows and focuses the first older Note. Live fixtures contain one Note each, so older-page interaction was not manufactured through unnecessary persistent data.

## Atomicity, retries and parent independence

Creation verifies trusted staff and parent/Notes permissions, normalizes body, locks the authorized parent/classification in shared mode, resolves and share-locks the active author, inserts the Note, inserts the required safe security audit, commits, then returns the persisted projection. Parent authorization uses persisted audience and current scope within the transaction. Required audit failure rolls back the Note; disposable failure injection proves no partial Note, parent/contact mutation or Activity change, and no Note body in the captured error log.

Concurrent authors independently append without changing parent revision or overwriting Notes. The unique submission key makes the same author/request/key and normalized body return the original Note without a second audit. A different body under the same key returns conflict. Retries always reauthorize. Tests cover parallel submissions, duplicate keys, differing-body conflicts, deterministic ordering and successful-retry denial after revocation.

React prevents duplicate-click submissions using a synchronous in-flight guard plus disabled pending controls. It holds body/key only in component memory, retains them on uncertain transient failure, and returns server identity/time rather than constructing an optimistic Note. Success clears the draft and restores textarea focus. Navigation/context loss discards the key; a new key is a new append. This is not a claim of globally exactly-once delivery across sessions.

Adding Notes changes neither request revision nor updatedAt, status, routing, assignment, watchers, contact, reference or operational Activity. Shared workflow revision behavior after Notes is covered by an actual disposable API mutation; no extra live workflow mutation was needed to preserve the accepted fixtures.

## Audit, logging, caching and exposure

Creation audit action is `service_request_internal_note_created` in the existing security `activity` table, separate from `request_operational_activity`. Existing columns store the trusted Organization, Service Request, staff actor, actor type and occurrence time; actor_reference is null. Metadata is exactly:

```text
policy: F041
action: internal_note_created
noteId: server-generated Note UUID
correlationId: server-owned HTTP correlation UUID
```

No body, contact payload, request description, auth token or Entra object ID is written into this Notes audit. Notes GET does not generate an additional read-audit stream; sanitized HTTP logging remains. Each of the two live Notes has exactly one correctly scoped audit, and each correlation matched a captured Notes POST returning 201. Subsequent live read/create denials also appeared as safe status metadata. Actual Note and contact values were compared against captured log text only in local process memory and were absent; none were printed in the report.

The logging boundary emits allowlisted route, method, status, correlation, time/duration and safe content-type/service metadata. It excludes bodies, auth headers, raw SQL and unsafe error serialization. Protected GET/POST responses carry `Cache-Control: no-store` before guards and validation, including denials/errors. Notes/drafts live only in React memory; no persistent browser storage, URL, title, analytics or AI payload is added.

| Surface                       | Note body present?                 |
| ----------------------------- | ---------------------------------- |
| Authorized Notes API          | Yes, explicit protected projection |
| Unauthorized Notes API        | No                                 |
| Staff request list            | No                                 |
| Normal staff detail payload   | No                                 |
| Operational Activity          | No                                 |
| Requester Contact endpoint    | No                                 |
| Security audit                | No                                 |
| Application/error logs        | No                                 |
| Browser URL / document title  | No                                 |
| Analytics                     | No                                 |
| localStorage / sessionStorage | No                                 |
| Resident/public API           | No                                 |
| AI Workspace / model context  | No                                 |

The legacy authenticated PUBLIC detail previously read the security activity relation. Review caught the new Notes audit event appearing there as metadata; the query now excludes Notes audit alongside contact-view audit. Regression asserts no Note body, capability, count or event in that legacy projection. No Note body was exposed by the intermediate implementation.

After live Notes existed, unauthenticated PUBLIC legacy detail and Notes GET both returned 401 with only `statusCode`, `error`, `requestId`; the Notes response also had no-store. There is no anonymous resident history GET. Existing resident creation still returns only id, referenceNumber, status and createdAt; confirmation displays the reference. Authenticated legacy staff detail is not mislabeled as resident-safe output. No resident Notes/count/author/timestamp/capabilities/audit marker, staff Activity, ownership/watchers or staff narrative was newly exposed. No resident functionality was added to manufacture a test surface.

## UI lifecycle and actual live observations

One F038 card in the existing main detail column serves both audiences, after existing Contact/ownership and before Issue Details. Notes retain their own list/composer presentation, separate from structured Actions and the Activity timeline. Issue prominence, service location, reference, audience/status and existing controls remain intact. Semantic tokens, wrapping, flex layout and a full-width textarea support narrow layouts and both themes.

Implemented states are `Protected` with `You don't have permission to view internal notes.`, `No internal notes have been added.`, accessible loading, a read-only stream, or `Add Internal Note` with `Internal Note` textarea, 4,000-unit character count and `Add Note`. Empty validation says `Enter an internal note.`; success says `Internal note added.`. Safe load/create errors do not reflect server text. Author text and semantic time precede the full multiline body. No Edit/Delete/Remove control exists.

Request/read/create capability changes remount the Notes stream immediately; in-flight work is aborted and late responses ignored. Parent/session loss unmounts the detail. Permission denial rechecks parent capabilities while preserving independently authorized contact. Unsaved drafts never cross requests. Unrelated workflow/ownership refresh does not refetch Notes. Revocation is effective on the next protected request/refresh; there is no permission polling or claim of instant remote erasure of already rendered content.

The operator used normal personal Entra and real database-backed authorization in Chrome. No fixture preview substituted for live evidence:

| Live phase                                        | Actual observed result                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No Notes grants after migration                   | Both parent details accessible; Notes Protected, no body/author/time/count/composer; existing sections normal                                             |
| Explicit read only                                | Both Notes streams readable/empty; no composer; no re-login                                                                                               |
| Explicit create after read                        | Composer available; one fictional Note created per audience; success, safe author/time, multiline text and persistence after refresh                      |
| Remove create, retain read                        | Notes readable; composer absent; direct POST 403 on both                                                                                                  |
| Restore create, remove read                       | Notes Protected; no body/author/time/count/composer; both GET and POST 403 despite create remaining granted                                               |
| Notes read absent, contact present                | Notes Protected; populated contact on SR-202609-000006 independently available                                                                            |
| Notes read present, contact absent                | Notes readable/composer available; Contact Protected; previously displayed populated contact clears on refresh                                            |
| Remove PUBLIC read, retain Notes and Contact keys | PUBLIC detail/Notes 404, PUBLIC contact 403; INTERNAL detail/Notes available; All contains authorized INTERNAL only                                       |
| Restore all eighteen keys                         | Exact retained set verified through normal DB authorization model; operator restored Notes/contact observation passed before the final visual revocations |

Direct live denied POST probes used an empty body to avoid adding an extra permanent Note if authorization unexpectedly differed; permission checks precede body normalization for those phases. Disposable valid-body authorization tests supply independent positive/negative evidence. No extra Note was created by the probes. Later visual-only temporary revocations were restored explicitly. During the normal API restart, the operator reported temporarily unavailable requests. Local health returned 200 and unauthenticated staff access correctly returned 401; database verification confirmed eighteen grants and intact Notes/requests. The operator subsequently confirmed: “API restarted normally; both restored.” Both authenticated request details, their existing Notes and composers returned, resolving the final browser gate without another Note. The earlier availability error's cause was not established; authenticated recovery is supported by the operator's observation, not health alone.

## Responsive and accessibility evidence

The operator confirmed the following matrix on PUBLIC and INTERNAL detail. Each PASS covers both light and dark themes. Authorized checks included Notes placement, multiline body, author/time, composer/count/buttons/focus and separation from Contact/Activity, with no horizontal overflow. Read-only checks covered readable Notes, absent composer and keyboard Refresh Notes. Protected checks covered readable explanatory text with no protected fields/count/composer, independent surrounding sections and sensible reading order.

| Width  | Authorized light/dark | Read-only light/dark | Protected light/dark | Horizontal overflow |
| ------ | --------------------- | -------------------- | -------------------- | ------------------- |
| 1440px | PASS / PASS           | PASS / PASS          | PASS / PASS          | None observed       |
| 1280px | PASS / PASS           | PASS / PASS          | PASS / PASS          | None observed       |
| 1024px | PASS / PASS           | PASS / PASS          | PASS / PASS          | None observed       |
| 768px  | PASS / PASS           | PASS / PASS          | PASS / PASS          | None observed       |
| 390px  | PASS / PASS           | PASS / PASS          | PASS / PASS          | None observed       |

Manual keyboard checks passed for Tab/Shift+Tab, readable labels, visible focus, empty-draft validation and textarea focus, multiline Enter, draft clearing on navigation and keyboard Refresh Notes. Initial creation confirmed success feedback and cleared drafts. Automated React checks additionally cover pending/single-flight behavior, authoritative result/focus, safe transient errors, retry keys, XSS text, long/unbroken text, session/context clearing and older-page focus. Older pagination, long/hostile body extremes and server failure injection rely on disposable/automated evidence, not invented live observations. No formal assistive-technology or contrast-ratio certification is claimed. **This validation is not a WCAG certification.**

## Development grants and final fictional data

FULL_UAT_OPERATOR before F041 contained exactly these sixteen keys, all retained after F040:

```text
service_request.create
service_request.create_internal
service_request.internal.read
service_request.contact.read
service_request.internal.update
catalog.issue_action.manage
service_request.reference.manage
service_request.view
service_request.start_work
service_request.hold
service_request.resume
service_request.close
service_request.reopen
service_request.assign
service_request.route
service_request.watchers.manage
```

After F041, the exact bundle/final personal grant set is those sixteen **plus** `service_request.note.read` and `service_request.note.create` (eighteen total). Both new keys are RETAINED for future authorized development UAT. `geospatial.read` remains optional and ungranted; no wildcard or temporary unrelated permission is retained. Scope remains Public Works / Streets and Community Services / Parks. No private identity value is included here.

The bundle is development provisioning shorthand only; runtime does not inspect bundle names. Manifest/migration/sign-in/startup changed no stored grant. Every addition, revocation and restoration used F036 dry-run followed by explicit targeted confirmation. Existing profile, localhost database/role, fictional Organization/scope and personal Entra safeguards remain; production/client provisioning remains refused. F036 tests cover the exact eighteen-key bundle and no automatic reprovisioning.

The table below records both before and after Note creation: every parent field shown is unchanged. Only the Note count changes 0 → 1 and one safe security audit is added per request.

| Field                | PUBLIC SR-202609-000007       | INTERNAL DEV-202609-00000003          |
| -------------------- | ----------------------------- | ------------------------------------- |
| Audience / channel   | PUBLIC / WEB                  | INTERNAL / STAFF                      |
| Status               | Open                          | On Hold                               |
| Revision             | 25                            | 24                                    |
| updatedAt            | 2026-09-20 21:04:29.607261-05 | 2026-09-20 04:56:47.99994-05          |
| Scope                | Community Services / Parks    | Community Services / Parks            |
| Assignment           | Parks Queue Team              | Parks Queue Team                      |
| Watchers             | 1 (fictional Reviewer Role)   | 2 (development staff and Parks Queue) |
| Operational Activity | 26                            | 25                                    |
| Notes                | 1 fictional UAT Note          | 1 fictional UAT Note                  |
| Structured contact   | None supplied                 | None supplied                         |

There are two synthetic Notes and two corresponding Notes audit events in personal reqro_dev. Actual bodies and contact values are omitted. All seven existing request hashes remain unchanged across F041; this includes SR-202609-000001/000002/000004/000005/000006/000007 and DEV-202609-00000003. SR-202609-000005 remains PUBLIC/PHONE, Open revision 1, Public Works/no Division, unassigned, zero watchers, one Activity and populated synthetic contact. SR-202609-000006 remains PUBLIC/PHONE, Open revision 2, same scope, its intentionally retained F040 STAFF assignment, zero watchers, two Activity and unchanged populated contact. Existing F032 catalog, F033 reference configuration, F035 history, F037 ownership and all original grants/scopes remain intact. Security-audit changes from authorized contact views and Note creation are deliberate and separate from parent hashes.

## Performance and limits

Notes list uses one scoped parent authorization query and one bounded child projection inside a transaction, in addition to existing authentication/RBAC resolution. New creation uses parent lookup, active-author lookup, Note insert and audit insert; a replay uses the conflict lookup and no second audit. Author snapshots eliminate per-Note author/identity-provider lookups. Neither contact nor Activity is joined into Notes. The list does not load Organization-wide Notes or full history; count is omitted. React does not refetch Notes for unrelated operational mutations.

Indexes are the UUID primary key, unique Organization/request/author/submission constraint and `request_internal_note_page_idx` over Organization/request/createdAt DESC/id DESC. A safe local EXPLAIN returned Limit over Index Scan on the page index for the scoped first-page query. The tiny two-Note dataset establishes query shape/index choice, not production-scale performance. Future volume/abuse monitoring and retention design remain separate work; no speculative indexes, text search or large rate subsystem were introduced.

Notes may contain incidental sensitive free text. F039 protects structured contact and does not promise that authorized descriptions/answers/Notes contain no PII. No automated detection, redaction or AI processing exists. Existing platform/request retention applies without automatic expiry; legal records treatment, privilege and jurisdictional categories are client governance decisions, not claims made by this feature. Append-only correction/redaction needs future accountable design.

## Automated validation and security review

The following results are the completed post-UAT, post-cleanup final validation. No implementation assertion was weakened for these checks. The operator separately confirmed authenticated browser recovery following the normal API restart.

| Check                                   | Final result                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| Backend unit                            | 194 passed, zero skipped; includes 9 Notes unit tests                                   |
| API E2E                                 | 37 passed, zero skipped                                                                 |
| PostgreSQL integration                  | 150 passed, zero skipped; includes 14 Notes subtests                                    |
| Shared                                  | 62 passed                                                                               |
| React                                   | 323 passed across 25 files; includes 29 Notes-component cases and workspace regressions |
| F036 provisioning                       | 19 PostgreSQL subtests plus 4 input/unit tests passed                                   |
| TypeScript                              | Test compilation and backend typecheck passed                                           |
| Backend lint / formatting               | Passed                                                                                  |
| Frontend lint                           | No script configured                                                                    |
| Changed frontend formatting             | Passed within existing file conventions                                                 |
| Backend / frontend production builds    | Passed                                                                                  |
| Git whitespace                          | Passed                                                                                  |
| Private configuration / credential scan | Zero findings across all 34 changed files; three unchanged synthetic test URL matches   |

Notes authorization matrices, parent-scope and forged-input checks, assignment/watcher/Role-Team/contact independence, immutable DB constraints, concurrent authors/retries, audit-failure rollback, logging/caching/projection privacy, keyset pagination and plaintext/XSS behavior passed. Resident privacy and F040 secure union, audience/read/operation boundaries, workflows, routing, ownership/watchers and revision/transaction behavior remain covered by the existing full suites.

| Regression | Coverage retained                                                                 |
| ---------- | --------------------------------------------------------------------------------- |
| F029       | Audience/intake/contact policy and canonical creation                             |
| F030       | INTERNAL scoped read model and projection                                         |
| F031       | Explicit workflow transitions, narratives and revision protection                 |
| F032       | Issue-action/catalog configuration and authorization                              |
| F033       | Reference configuration/allocation and administration                             |
| F034       | Staff detail, scope and stale-state protection                                    |
| F035       | Append-only operational Activity, narratives, ordering/pagination                 |
| F036       | Explicit development grants, bundle exactness, safety refusals                    |
| F037       | Ownership/watchers, eligible targets and relationship independence                |
| F038       | Shared UI, Issue-first hierarchy, tokens and responsive layout                    |
| F039       | Independent scoped contact, no-store, fail-closed audit and state clearing        |
| F040       | Mixed audience union, persisted policy, legacy compatibility and resident privacy |

No existing security assertion was weakened. Capability expectations were extended for two new booleans, and ambiguous UI selectors were made section-specific. The inactive-Organization test follows the existing opaque 404 contract. Review's legacy audit-projection issue was fixed and regression-tested. Logging lint issues were fixed without disabling rules. The existing MapPreview initialization timing test failed once in pre-UAT testing; its isolated 26 cases and subsequent full runs passed unchanged. The final React run passed all 323 tests across 25 files in 237.63 seconds. Final formatting identified one workspace-test formatting issue; Prettier corrected formatting only before the passing React run and repeated formatting check. Existing Vite chunk-size/plugin timing warnings remain; no unrelated map or build refactor was introduced.

Post-suite personal-database verification reconfirmed 20 migrations with zero pending, the exact eighteen retained permissions, two Notes and two Notes audit events, both append-only triggers, unchanged Note hashes and unchanged hashes for all seven requests. Test failure injection and migration rollback remained confined to disposable test schemas.

## Files, cleanup and deferred work

Added: the F041 migration; `request-note.domain.ts`, `.repository.ts`, `.service.ts`, `.controller.ts`, and `request-note-privacy.middleware.ts`; Notes domain/service unit tests and `request-note-checks.ts`; `InternalNotes.jsx` and its React tests; the F041 feature record and this report.

Changed backend files: `auth.types.ts`, `database.types.ts`, `development-staff-input.ts`, `service-request.module.ts`, `service-request.repository.ts`, `staff-request-policy.ts`; existing request-audience/F036 PostgreSQL harnesses, API E2E and development-input/policy unit tests. Changed frontend files: `apiClient.js` (retry header option only), staff request repository, `InternalRequestWorkspace.jsx`, staff CSS and repository/workspace tests. Documentation updates: ARCHITECTURE, CITYVUE_CONTEXT, ROADMAP and F036 runbook. No dependency/lockfile, deployment, auth architecture or unrelated UI change is included.

Both temporary F041 capture logs were removed after the server log was released by the normal API restart. No F041 browser harness, preview, screenshot, temporary environment file or one-time script was added. Permanent tests, documentation and legitimate F036 tooling are retained. The post-cleanup and staged scans checked all 34 changed files against private configuration and nine live protected values in local memory, with zero findings; three unchanged synthetic credential-URL fixtures were recognized. No values were printed. Staged scope review and Git whitespace passed. A final database check after authenticated browser restoration confirmed the same eighteen permissions, two immutable Notes, two Notes audits and all seven unchanged request hashes.

No Note editing, deletion, correction/redaction, search/filters, attachments/uploads, mentions, notifications, email/SMS/Teams, resident communication, resident Notes/count, rich text/Markdown, automatic links, AI summaries/model context/embeddings, analytics, exports, separate retention rules or production Notes administration were introduced. F042 remains unselected and unstarted. After the local F041 commit/report, stop for product review; do not push or deploy.
