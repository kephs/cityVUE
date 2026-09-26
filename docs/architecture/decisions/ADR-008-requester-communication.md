# ADR-008 — Requester communication and truthful delivery semantics

**Dated amendment, 2026-09-26 — approved F058.2 scope, implementation under validation:** [F058.2](../../features/F058-2-collaboration-workspace.md) extends the existing correspondence model to eligible INTERNAL self-service requests. The persisted requester must be identified and linked to the same Organization-scoped staff identity as the submitter under the current intake contract. New messages and communication attachment admission/finalization require that requester to be active; independently authorized history remains readable after inactivity. The existing communication permission keys apply with contextual audience-specific parent authority and scope, preserving F058.1 transaction-time authorization. F057 metadata removes the obsolete universal PUBLIC-read dependency without grants, preset changes or sensitivity changes. Attachment contexts remain isolated. Migration 23 deliberately enforced the original PUBLIC-only communication attachment scope. Migration 40 narrowly extends that finalization function to Organization-matched PUBLIC or INTERNAL parents, retaining the composite communication-parent foreign key and every other guard. Active-requester eligibility remains transaction-time application policy; historical attachment relationships remain valid after requester inactivity. No requester self-view, named requester projection, INTERNAL assisted intake or outbound delivery is introduced. The original PUBLIC-only F042 decision below remains historical evidence; this amendment does not change ADR-024's Proposed status.

**Dated amendment, 2026-09-23:** [ADR-011 — Explicit requester identity](ADR-011-explicit-requester-identity.md) records approved F049 new-write eligibility: explicitly anonymous requests cannot create new correspondence or stage correspondence attachments. Existing records and authorized reads remain immutable and available. No delivery destination or identity is inferred from tracking. The original F042 decision is retained below.

**Status: Accepted** — F042 scope and authorization decision; release validation
and personal-development UAT are tracked separately in the feature record.

Terminology correction approved on 2026-09-21 before F042 commit/provisioning:
the product concept is **Requester Communication**, consistent with Requester
Contact. Requesters may be residents, customers, members, tenants, students or
other people served by a client. This correction changes no PUBLIC eligibility,
authorization, immutability or delivery decision. Historical resident intake and
resident-access boundaries retain their established meaning.

## Context

Staff need deliberate correspondence intended for a requester without publishing
Internal Notes or operational history. Reqro has no established secure resident
parent-request retrieval authorization, and F042 authorizes no external delivery.

## Decision

Persist correspondence separately in `request_communication`. Only PUBLIC
parents are eligible in F042. A trusted Entra-derived principal must have normal
PUBLIC request read, current Organization/scope access and
`service_request.communication.read`; creation additionally requires
`service_request.communication.create`. Contact, Notes, workflow and operational
relationships confer no communication authority. INTERNAL detail omits the
section and makes no history request.

Record OUTBOUND / PORTAL / RECORDED. This means saved in Reqro for future
authorized requester presentation, with no assertion of delivery, presentation,
notification or receipt. The recipient relationship is the parent requester;
no contact destination is copied or resolved through an external provider.
Staff see a safe immutable author display snapshot. The requester-safe allowlist
projection substitutes “Service team” and excludes staff-only domains and
identifiers. It is a projection function, not an HTTP authorization boundary.
Resident retrieval remains deferred; possession of a reference never grants it.

Use UUID identity, bounded plain text, database append-only protections,
request/author-scoped retry keys, bounded newest-first keyset pagination and an
atomic metadata-only creation audit. Creation changes neither request revision
nor operational updatedAt, Activity, Notes, contact, assignment or watchers.
The UI stores protected stream/draft state only in memory and clears on request
or known access changes; protected responses use no-store.

## Consequences and future extension

All F042 fields, including RECORDED, are immutable. No update/delete path or
provider is implemented. Direction, channel and state are explicit domain
columns rather than vendor payloads. A future delivery feature can add channels
and separately controlled delivery attempts/state transitions through reviewed
migrations while retaining immutable correspondence content. It still needs
provider selection, destination authorization, secrets, queue/retry/failure
handling and any approved consent/preferences. F042 provides none of those.

Meaningful correspondence/audit/grants prevent destructive rollback. Future
correction/redaction, retention rules and legal records classification require
separate governance; this decision claims no legal confidentiality status.

## Security and privacy

No body appears in ordinary list/detail, Activity, Notes, contact, security audit,
application logs, URLs, titles, persistent browser storage, analytics or AI.
Plain React text rendering does not execute HTML, Markdown or links. Intended
requester correspondence can still contain inappropriate free text; the UI warns
staff to avoid staff-only information, and no automated redaction is claimed.
No default grants, external messages or insecure resident endpoint are added.

## Evidence

[F042 specification](../../features/F042-requester-communication-foundation.md),
[service](../../../server/src/service-request/request-communication.service.ts),
[migration](../../../server/migrations/20260921000000-add-request-communications.ts),
[requester-facing projection](../../../server/src/service-request/requester-communication.projection.ts),
[integration tests](../../../server/test/database/request-communication-checks.ts),
[staff UI](../../../react/src/staff/requests/RequestCommunication.jsx).
