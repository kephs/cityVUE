# F050 — Trusted Requester Identity & Authorized History Foundation

Status: implemented and validated as a development foundation; see the [completion evidence](F050-implementation-report.md). Starting checkpoint: `cea121b1e0614a7fed7ca72993ab5277c3f32655`, clean `main`, synchronized tracking reference. Starting personal development baseline: 25 migrations applied, zero pending; tracking 1 active / 5 revoked. Final development state: 26 applied / zero pending; tracking unchanged. Local commit only, no push/deployment or F051.

## Contract and decisions

No resident authentication provider exists. Workforce Entra, unverified Contact, Service Location, attachments and tracking never establish requester identity. Normal PUBLIC intake and assisted intake remain unchanged and unlinked. Anonymous and INTERNAL requests cannot link. No historical backfill or manual linking is permitted.

Implement an Organization-scoped opaque UUID Requester with controlled source and stable subject, unique per Organization/source/subject. A guarded local synthetic provider issues server-only trusted contexts. No browser DTO accepts requester ID/source/subject. Production has no provider and no Contact-matching fallback. Development provisioning is an explicit CLI operation restricted to the personal development target, with read-only dry run and explicit confirmation. Only new fictional requests use it.

Optional `service_request.requester_id` is constrained to identified PUBLIC requests in the same Organization and immutable after insertion, including null-to-link changes. Resolve identity in the creation transaction; preserve F046 finalized retry behavior, F049 policy, Contact requirements, references, assignment and Activity. Synthetic subject is never ordinary UI, log, audit or response data.

History uses `GET /api/v1/staff/service-requests/:serviceRequestId/requester-history`. Authorize current PUBLIC request using existing staff read/scope checks, then use the same SQL-authorized relation for linked rows, count and category summary. No new permission or requester directory. Current request is included and marked. Newest first with UUID descending tie-break; default 25/max 100, bounded page. Safe rows: request UUID for navigation, reference, Issue name, status, created date and current marker. Category counts use current repository taxonomy. Time/status summaries and Service Location are deliberately omitted from this minimal projection.

History reads create a minimal append-only security audit in the same transaction before disclosure. No Contact read/audit or operational Activity is caused. A request-consistent snapshot supplies rows/count/category summary; next retrieval reauthorizes. No persistent history cache. UI uses existing modal, explicit lazy loading, safe errors, pagination, Close/Escape/focus restoration and standard navigation. No automatic fetching on page load/hover/focus. Unlinked, anonymous and INTERNAL requests have no history action/count.

## Completion gates

Disposable migration apply/down/reapply; no backfill; immutable links; synthetic provider production/client denial; forged body/context denial; Organization isolation; identity resolution concurrency; creation retry; per-row/count/category authorization; safe audit failure; protected projection; regression suites per protocol. Then verified personal-development migration, minimal one-Requester/two-or-three-request fixture, authenticated staff UAT including existing unlinked/anonymous/INTERNAL records, 1440/1280/1024/768/390 light/dark, keyboard, logging privacy and integrity comparison. No credential operations. Remove temporary artifacts, document actual evidence and commit locally only after all gates pass. No push, deployment or F051.

Production identity integration, manual corrections/merge/split, requester portal/history/communication, Requester Geography, service-participation analytics, scoring, behavioral labels, automated decisions and advanced routing remain outside this feature.
