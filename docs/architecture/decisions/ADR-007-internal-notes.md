# ADR-007 — Internal Notes

**Status: Accepted** — F041 staff collaboration.

## Context

Staff need discretionary collaboration on PUBLIC and INTERNAL requests without overloading structured Activity or publishing communication to residents. “Internal” describes Notes visibility, not parent audience.

## Decision

Reading requires normal persisted-audience parent access plus `service_request.note.read`. Creation also requires `service_request.note.create`; create without read is denied. Organization/current scope and normal Entra-derived staff context remain mandatory. No assignment, watcher, operational membership, contact or request-update shortcut exists.

Unified GET/POST `/api/v1/staff/service-requests/:requestId/notes` returns a dedicated projection of id, body, safe author display snapshot and server timestamp. Author is resolved from active same-Organization StaffIdentity, never browser input. Store immutable UUID/timestamp/author/body in `request_internal_note`; database UPDATE, DELETE and TRUNCATE are rejected. No edit/delete API or repository method exists.

Bodies are plain text bounded to 4,000 UTF-16 units at API/UI admission, normalized for line endings/edge whitespace, rejecting empty input, disallowed controls and unpaired surrogates. Database text constraints add non-empty/bounded checks. React escapes content; no HTML, Markdown, linkification, mentions or attachments execute.

Create Note and metadata-only `service_request_internal_note_created` audit atomically; required audit failure rolls back the Note. A UUID Idempotency-Key identifies a submission per Organization/request/author. Matching normalized-body retries return the original record without another audit; changed-body reuse conflicts and every retry reauthorizes. Default 25/max 100 keyset pages use descending full-precision timestamp/UUID; no total count is exposed.

## Consequences

Notes are independent child state: no parent revision, updatedAt, status, contact, ownership or operational Activity changes. They do not create request revision conflicts. The shared component supports Protected/read-only/composer states, retains uncertain-failure drafts in memory and prevents routine double-clicks. Navigation/auth changes discard state. Meaningful Notes/audit/grants prevent destructive migration rollback. Correction, deletion and redaction need separate future design.

## Security and privacy

Notes are neither resident communication nor Activity. Bodies are absent from ordinary list/detail, resident APIs, contact, audit, normal logs, URLs, titles and persistent browser storage. Responses use no-store. No automatic AI/model-context, analytics, export or notification use exists. Free text can still contain PII; existing retention applies without a new legal classification or expiry policy.

## Related evidence

[F041](../../features/F041-internal-notes-staff-collaboration.md), [F041 report](../../features/F041-implementation-report.md), [service](../../../server/src/service-request/request-note.service.ts), [repository](../../../server/src/service-request/request-note.repository.ts), [body policy](../../../server/src/service-request/request-note.domain.ts), [migration](../../../server/migrations/20260920030000-add-request-internal-notes.ts), [UI](../../../react/src/staff/requests/InternalNotes.jsx).
