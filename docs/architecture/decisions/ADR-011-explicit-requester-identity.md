# ADR-011 — Explicit requester identity and Issue creation policy

**Status: Accepted, 2026-09-23.** The user explicitly approved the two-policy F049 decision. This is a development foundation, not production privacy or deployment approval.

## Context

Requests already persist `identified` or `anonymous`, independently of audience, staff submitter, Service Location and protected requester Contact. Earlier catalog versions carry legacy anonymous-reporting configuration. Missing Contact alone cannot establish anonymity. A third IDENTIFIED_OPTIONAL policy would duplicate the semantics of allowing an explicit choice.

## Decision

- Stable Organization-scoped Issues use IDENTIFIED_REQUIRED or ANONYMOUS_ALLOWED. Identified PUBLIC intake requires the existing Contact name; email remains optional. Allowed intake requires explicit identified/anonymous selection. Anonymous intake rejects Contact, including contradictory empty/null input.
- Reuse persisted request identities; make them immutable. Preserve historical identities and contacts without inference, deletion or fabrication. No legacy state is needed because the existing required identity column already supplies historical evidence. INTERNAL remains an identified authenticated staff requester without resident Contact; anonymous assisted PUBLIC intake retains staff submitter attribution.
- Keep identity policy in its own revisioned Issue table, separate from default assignment. Configuration and creation serialize through the stable Issue lock. Configuration audit is append-only, minimally typed and transactional. The guarded personal-development CLI is the available configuration path; production administration and its permission model remain deferred.
- Seed current Issue configuration from its current published version: legacy `not_allowed` maps to required; `allowed` and `allowed_with_limitations` map to allowed. New Issues without an explicit row use the current published version's compatible mapping until configured; absent publication requires identification. Explicit configuration overrides submitted version policy. Historical version rows remain immutable.
- A valid finalized F046 creation retry returns its original receipt before current identity/assignment policy evaluation. New independent submissions obey current policy. No general idempotency capability is introduced.
- Anonymous staff detail states that Contact was not provided and has no View action. Authorized anonymous Contact requests return safe absence without a Contact-view audit; requests lacking permissions still fail existing authorization. Identified Contact retains F039 protection and audit, including truthful authorized absence for historical identified Contact-less requests.
- Anonymous requests cannot create new F042 correspondence or stage correspondence attachments. Existing correspondence and attachments retain authorized reads and immutable history. Tracking does not supply identity or a communication destination; no credential operation is part of F049.
- Choosing anonymous clears the in-memory Contact draft permanently for that draft; choosing identified again starts empty. No requester profile, cross-request history, identity matching, Requester Geography, network/device fingerprint, or tracking-based correlation is introduced.

## Consequences and boundaries

Application-level anonymous means no structured requester Contact is stored or linked. It does not mean an untraceable person: free text/images can contain identifying content, and separately governed infrastructure logs can exist. Service Location remains the problem location and can be precise. Evidence checksums serve existing attachment integrity/idempotency only, never requester correlation. Staff authorization, F047 search fields, F048 assignment, F044 minimized tracking projection and F046 EXIF removal remain independent.

The database enforces identity values, identity immutability, Organization relationships and anonymous/Contact contradiction. The service enforces current Issue policy, explicit PUBLIC choice, Contact validation and authenticated INTERNAL/assisted attribution. Migration refuses contradictory historical data and rollback refuses loss of policy changes or audit history. Production policy governance, approved privacy wording, records/legal review, infrastructure logging review, abuse controls and deployment validation remain prerequisites.

## Related decisions and evidence

This explicitly amends the anonymous-absence behavior in [ADR-005 — Contact privacy](ADR-005-requester-contact-privacy.md) and the new-write eligibility in [ADR-008 — Requester communication](ADR-008-requester-communication.md); their other protections remain accepted. See the [F049 specification](../../features/F049-anonymous-request-policy.md) and [validation report](../../features/F049-implementation-report.md).
