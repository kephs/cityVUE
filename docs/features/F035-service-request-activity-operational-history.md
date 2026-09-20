# F035 — Service Request Activity & Operational History

Implemented locally from F034 (`11ed40295355269d2e2575280bb38ec28965bc0d`). Production activation is not included. Authenticated live staff UAT remains pending; synthetic browser previews and automated authorization tests are distinguished below.

## Purpose and domain separation

F035 adds durable operational history and completes the Hold/Close/Reopen controls deliberately deferred in F034. Operational history explains what happened to a request. The existing security audit explains which trusted context performed a security-relevant action. Internal notes would be discretionary collaboration; resident communication would have different visibility. Neither is implemented here.

OPERATIONAL ACTIVITY IS APPEND-ONLY.

OPERATIONAL ACTIVITY IS NOT THE SECURITY AUDIT LOG.

OPERATIONAL ACTIVITY IS NOT AN INTERNAL NOTES SYSTEM.

OPERATIONAL NARRATIVES ARE PLAIN TEXT AND MAY CONTAIN SENSITIVE BUSINESS CONTEXT.

## Storage and integrity

Migration `20260919050000-add-request-operational-activity` creates `request_operational_activity`, separate from the existing `activity` audit table. It stores a technical UUID, trusted Organization and Service Request UUIDs, constrained activity/actor types, optional stable staff identity FK, authoritative timestamp, request revision, migration-baseline marker, lifecycle status snapshots, routing IDs/name snapshots, narrative, and optional creation intake channel. It does not duplicate the request reference, description, contacts, claims, email, or account profile.

Implemented event types are `request_created`, `work_started`, `placed_on_hold`, `work_resumed`, `request_closed`, `request_reopened`, and `request_routed`. Future event vocabulary requires an explicit schema/domain change; arbitrary event types are rejected.

Composite foreign keys enforce same-Organization request, staff actor, departments, and valid Department/Division relationships. Typed checks constrain event shape, actor/reference consistency, status vocabulary, creation metadata, and narrative lengths. A unique request/revision boundary prevents more than one operational event for a command revision; a partial unique index permits only one creation event per request. Routing stores both identifiers and names captured transactionally, so later renames/reroutes do not rewrite history.

UPDATE, DELETE, and TRUNCATE triggers reject normal mutation of historical rows. There are no repository update/delete methods and no activity write/edit/delete API. Privileged schema owners could deliberately change these protections; administrative retention/deletion requires a separate controlled design, not a product action.

## Baselines and migration safety

Migration locks request creation while creating the schema and inserts one `request_created` baseline for every existing request, PUBLIC and INTERNAL. It copies only Organization/request ID, authoritative `created_at`, and existing intake channel. Baselines have `is_baseline=true`, actor type System, no staff identity, no revision, no narrative, no lifecycle state, and no routing history. System represents the recorded baseline, not a fabricated staff action. The API does not expose technical migration flags or imply richer historical facts.

Rollback is permitted while the table contains only migration baselines; down/up reconstructs them from unchanged parents. After any new operational event exists, rollback fails rather than discarding it. Apply/rollback/reapply and refusal after active use were tested only in disposable schemas. Personal development history was not destructively rolled back.

After automated validation, the supported migration CLI applied F035 to verified `localhost:5432 / reqro_dev / reqro_dev_user`. All 16 migrations are applied; latest is `20260919050000-add-request-operational-activity`; pending count is zero. Exactly two existing requests were backfilled, both PUBLIC/WEB; no existing INTERNAL records were present. `SR-202609-000001` and `SR-202609-000002` each have one baseline with the exact stored creation timestamp, no fabricated narrative/actor, and unchanged references/audience/channel. Hash comparisons confirmed complete existing request rows, Issue action records, reference configurations, and grants were unchanged. No synthetic INTERNAL request or development grant was added.

## Trusted writes and atomicity

All supported resident PUBLIC, staff-assisted PUBLIC, and staff INTERNAL creation paths append one creation event inside the existing request/reference-allocation transaction. Actor type uses the authoritative creation context: Staff member with stable staff identity, Resident, or anonymous resident. No resident identity is invented. Activity references the technical request UUID; F033's persisted human reference remains exclusively authoritative on the parent for this model. F032 external redirects fail before allocation, request creation, or operational history.

F031 INTERNAL workflow/routing mutations insert an operational event in the same PostgreSQL transaction as the scoped request update, revision increment, and existing metadata-only audit. Narrative is stored only in operational history. F031 audit fields and semantics remain unchanged. The separate older development-only F0 PUBLIC action surface is not expanded into a PUBLIC operational workspace.

Expected revision plus request row locking serializes competing operations. Stale/repeated commands return conflict and append nothing. The unique event/revision constraint is a final integrity check. No-op routing retains F031's 409 behavior. Target authorization and active same-Organization hierarchy checks remain unchanged; routing requires current AND target scope.

Failure-injection tests prove workflow, routing, and creation activity insert failures roll back request state, revision, audit, and reference-counter changes. Concurrent duplicate commands produce one success, one conflict, and one event. Invalid transition, missing/invalid narrative, unauthorized/foreign request, or invalid target creates no operational event.

## Narrative policy and lifecycle

Hold and Reopen require a nonblank reason, at most 500 input characters. Close requires a nonblank resolution, at most 2,000 input characters. Limits preserve the existing DTO contract and are independently enforced by the operational domain. Length is checked before trimming. Leading/trailing whitespace is trimmed; CRLF/CR becomes LF; meaningful internal line breaks remain. C0 controls except CR/LF, C1/DEL, and bidi embedding/isolate controls are rejected. Tabs are rejected. HTML/markdown-like content, quotes, and Unicode remain plain text and are never interpreted. No configurable policy engine is added.

Start/Resume require no narrative; routing adds none. Extra optional reason/resolution fields do not create arbitrary notes. Errors never echo input. Existing logging serializes allowlisted metadata and excludes request bodies; no new narrative logging, analytics, notifications, or audit payload is added.

| Current state | Action | Narrative | Next state | Operational activity |
| --- | --- | --- | --- | --- |
| Open | Start Work | None | In Progress | work_started |
| Open | Close Request | Resolution required | Closed | request_closed |
| In Progress | Place On Hold | Reason required | On Hold | placed_on_hold |
| In Progress | Close Request | Resolution required | Closed | request_closed |
| On Hold | Resume Work | None | In Progress | work_resumed |
| On Hold | Close Request | Resolution required | Closed | request_closed |
| Closed | Reopen Request | Reason required | Open | request_reopened |
| Cancelled | None | — | Cancelled | None |

Reopen appends a new event; previous closure and resolution remain. F031 is authoritative; no Cancel action or new transition is introduced.

## Read API and privacy

`GET /api/v1/staff/internal-service-requests/:id/activity?page=1&pageSize=25` uses the existing Entra-only `service_request.internal.read` guard and independently applies current trusted Organization, active Organization, effective department/division, and INTERNAL audience scope. Read does not imply update. No new permission or grant is added. Forged Organization/query fields cannot establish authority. PUBLIC records cannot be obtained through this route; there is no public/resident activity endpoint.

A repeatable-read transaction checks the parent and retrieves history from a consistent snapshot. Concurrent revocation does not retroactively cancel an already-authorized request, but subsequent calls resolve current permissions/scope. Historical access is not permanent. Routing/current-scope changes therefore affect subsequent detail and history reads.

Responses contain only `id`, `type`, `occurredAt`, `actorDisplay`, `fromStatus`, `toStatus`, `fromDepartment`, `fromDivision`, `toDepartment`, `toDivision`, `narrative`, and `intakeChannel`, plus page metadata. Stable staff identity, Entra IDs, audit payloads, technical revision/baseline flags, contact data, and hierarchy IDs are not projected. Actors display neutral Staff member, System, or Resident labels; names are not inferred.

An authorized request reader may see the historical department/division **name snapshots** needed to understand that request even without current catalog access to those historical scopes. No unrelated hierarchy metadata or cross-Organization lookup is exposed. This is deliberately a minimal request-history projection.

Pages are newest-first by `occurred_at DESC, id DESC`. API page size is 1–100 (default 25), page is 1–1,000,000. It fetches one extra row for hasNextPage rather than a global count. The UI uses 25 rows with Older activity/Newer activity controls, replacing pages instead of accumulating unlimited records. Equal timestamps have a tested deterministic ID tie-breaker. Offset pages are not a cross-request snapshot: new events between page loads may shift boundaries; refresh returns current history.

Protected responses use `Cache-Control: no-store`. No browser persistence, service-worker cache, arbitrary activity write endpoint, or new resident visibility is introduced.

## Workspace UX and accessibility

The existing request detail adds Request Activity with a semantic ordered list, event headings, timestamps, neutral actors, readable status/routing transitions, and escaped narrative. Timestamps use the existing locale presentation; server time remains authoritative. Narrative over 1,000 characters uses a native disclosure so full text remains available. References are opaque and wrap without parsing.

Hold/Close/Reopen open focused inline forms, not notes boxes. Visible required labels, associated validation/help, exact length limits, focus entry, Escape/Cancel, focus restoration, and pending feedback support keyboard use. Start/Resume remain direct actions without extra dialogs. Read-only users see activity but no mutation controls. Existing server-provided update capability remains a UI hint only.

Controls disable during submission and the existing in-flight guard blocks duplicate clicks. No optimistic event/status is fabricated. Success refetches detail/revision/status/routing/options and remounts activity to fetch current events; returning to the list refreshes it. Recoverable command errors retain the draft in memory. Conflict discards the form, refreshes state, and requires deliberate review/retry. Authorization failures clear protected detail/history and drafts. A committed command followed by a failed refresh shows a safe retry state without replaying its narrative.

Activity loading/error/empty states are independent. A generic activity fetch failure preserves authorized detail and offers Retry activity. A 401/403/404 clears protected request/history according to F034 patterns. Empty history says no activity has been recorded rather than inventing rows. Route/account/unmount changes abort or ignore stale reads. Pagination moves focus to the activity heading when the new page arrives. No polling, real-time infrastructure, or global cache is added.

Theme variables, native controls, readable status words, visible focus outlines, and wrapping narratives support light/dark and narrow layouts. Semantic/keyboard checks are not WCAG certification or full assistive-technology testing.

## Validation and UAT

Backend unit: 170 passed. API E2E: 36 passed. PostgreSQL: 62 passed, zero skips. Shared: 62 passed. React: 210 passed. Backend TypeScript, ESLint, formatting, backend build, frontend Vite build, focused React formatting, and git whitespace checks pass. No separate frontend lint/TypeScript pipeline is configured. Existing frontend chunk-size and observed plugin-timing warnings remain unsuppressed.

Coverage includes baseline migration/down/up, rollback refusal after use, all lifecycle transitions, retained narratives, creation paths, F032 no-activity rejection, routing snapshots, authorization/IDOR/scope checks, no write/edit/delete routes, immutable rows, cross-Organization FKs, bounded/ordered pagination, concurrent retries, injected write failures, safe actor projection, XSS/plain text, failure states, form recovery, duplicate clicks, conflict refresh, and access-loss clearing. F029–F034 regression suites remain passing. Narrative absence from metadata-only audit is explicitly asserted; existing body-free logging boundaries were inspected.

Authenticated staff browser UAT remains pending because the current personal development environment has no safe explicit provisioning mechanism for the required staff permissions. This is a development-environment limitation, not a product defect. No default grants, personal grants, forged identity, token bypass, localhost trust, or client resources were used.

An explicitly labeled temporary in-memory preview imported the real workspace components without API/auth/database access. It exercised creation display, Start, Hold with reason, Resume, routing, Close with long resolution, Reopen, retained previous closure, and older-history navigation. Desktop 1280px, 1024px, 768px, and 390px screenshots/DOM checks showed no horizontal overflow. Light/dark rendering, long reference/narrative wrapping, disclosure, required/whitespace validation, focus entry/return, Escape, Tab/Shift+Tab, Enter/Space, and feedback were checked. Empty/error states are covered in React tests. These previews do not prove live persistence; disposable PostgreSQL integration tests do. Temporary preview files were removed before commit.

## Performance, classification, retention, and deferred work

The timeline index begins with Organization/request and then ordered timestamp/ID. The query uses both equality predicates and a bounded LIMIT; EXPLAIN and index presence were inspected in integration coverage. No audit parsing, request-description retrieval, global Organization-history scan, or N+1 actor lookup is required. Small fixtures can legitimately use sequential plans; production-volume and very deep offset performance remain future measurement work.

Conceptual handling expectations, not a formal regulatory classification:

| Data | Handling expectation |
| --- | --- |
| Activity type/status transition | Operational metadata, still protected with the request |
| Routing snapshot | Potentially internal organizational information; names only in authorized history |
| Actor display | Internal identity information; neutral labels minimize exposure |
| Narrative | Potentially sensitive free text; protected read, no logs/analytics/public visibility |
| Request reference | Human identifier, never authorization proof |

Operational history is durable platform data. Retention, legal deletion/redaction, configurable policy, and audit retention require separate designs; there is no Delete History action. Internal notes, resident communication/history, PUBLIC staff workspace, contacts, files, assignment, SLA, priority, exports, notifications, analytics, AI, integrations, admin portals, and F036 remain unimplemented. No final branding assets, deployment, push, cloud, or client resources were changed. Safe explicit development permission provisioning is a natural future prerequisite for authenticated live UAT, not part of F035.

## Fictional example (documentation only)

Oldest-to-newest here for readability; the actual UI starts with the newest event:

1. Request created — September 19, 2026, 09:14, Staff member, Staff intake.
2. Work started — September 19, 10:32, Open → In Progress.
3. Placed on hold — September 19, 13:47, In Progress → On Hold. Reason: Waiting for fictional contractor access.
4. Work resumed — September 20, 08:06, On Hold → In Progress.
5. Request routed — September 20, 09:20, Operations / District A → Facilities / District B.
6. Request closed — September 20, 15:42, In Progress → Closed. Resolution: Fictional damaged equipment replaced and inspected.
7. Request reopened — September 21, 08:30, Closed → Open. Reason: Additional fictional follow-up required.

This example was not inserted into reqro_dev.
