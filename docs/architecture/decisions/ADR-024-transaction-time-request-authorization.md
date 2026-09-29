# ADR-024 — Transaction-Time Authorization Coordination for Request Operations

Status: **Proposed** — not Accepted.

**Implementation state (F058.4 reconciliation).** The architecture described below **is implemented on `main`** and is the live authorization model for request operations. Its implementing slice, [F058.1](../../features/F058-1-request-authorization-consistency.md), is **delivered and synchronized** as `cc5439c8c48e574e9c5f82f51c2cc1e93147c726`. This ADR nevertheless **remains Proposed**, pending separate architecture and security ratification: implementation is not architectural approval, and F058.4 records the discrepancy rather than resolving it. Nothing in the decision below is amended by that record. When ratification is separately authorized, assess the "Evidence required before acceptance" section against the delivered evidence, noting that the deterministic disposable PostgreSQL coverage it requires cannot currently be re-executed because `TEST_DATABASE_URL` is not configured in this environment.

## Context

HTTP authorization precedes request transactions. A permission or operational membership may be revoked between guard resolution and mutation/disclosure. Request revision controls concurrent request edits but does not establish current actor authority. Access Administration already coordinates supported authorization writers through Organization-first exclusive locks and an authorization-state row.

## Decision proposed for review

Use Organization FOR SHARE, then access-state FOR SHARE, then fresh trusted actor mapping, active status, effective permissions and Department/Division memberships. Reuse the existing authorization model without requiring Access Administration permissions. READ COMMITTED mutation transactions resolve authority after waiting for a preceding writer.

Acquire the request separately after the barrier: FOR UPDATE initially when mutating its state, otherwise FOR SHARE for protected child operations. Follow with current/destination scope, selected target, attachment batch and child writes. Preserve request expectedRevision, tracking versions and child submission keys. Avoid lock upgrades and first acquiring authority coordination after request/batch locks.

Supported authority writers retain Organization FOR UPDATE followed by access-state FOR UPDATE before authority DML. Trigger invalidation is a commit barrier, not a substitute for writer ordering. Arbitrary out-of-band SQL is not certified by this application discipline. Operational Role/Team tooling also uses Organization exclusivity; access-state-only locking is insufficient as the common protocol.

## Revocation and disclosure

A writer that wins first commits before fresh authorization is resolved. A request that wins first holds stable authority until its transaction ends; a later writer waits. Two unrelated requests can hold shared barriers concurrently. Different Organizations coordinate on different rows.

Contact, submitted answers and requester history remain independently authorized and explicitly requested. Mandatory audit failure releases no protected response. Notes, correspondence, attachments and tracking retain separate policies; parent access alone is insufficient. Resident tracking remains credential-authorized. No guarantee extends to the time HTTP bytes arrive at the client.

## Preparation and ordinary reads

External eligibility, image processing, scanning and storage preparation happen outside the final authority barrier. Final transactions revalidate their exact inputs, metadata and eligibility. Preserve original finalized-intake receipts and existing object compensation/orphan handling. Do not add production provider capabilities.

Ordinary unified lists use a read-only repeatable-read snapshot containing fresh authority, count and page queries, without authorization locks. Audited requester history retains a coherent snapshot; a conflicting access-state locking read fails closed rather than silently retrying an old snapshot.

## Failures and consequences

Required request/child/Activity/audit writes remain atomic. Do not automatically retry consequential mutations after deadlock, serialization failure or an uncertain result. Return sanitized errors with correlation identifiers; never SQL, provider identifiers or protected content. Existing statement timeout and error sanitation remain in place; no additional PostgreSQL error-code allowlist entry is needed by this implementation.

Shared barriers add database queries and may delay exclusive authority/configuration writers. They do not serialize unrelated request rows against one another. Keep transactions bounded and never wait for frontend interaction while holding locks.

No browser authorization revision, new permission model, schema change or migration is required.

## Evidence required before acceptance

Deterministic disposable PostgreSQL tests must cover both revocation orderings, membership and status changes, target eligibility, lifecycle/routing/assignment/tracking/disclosure interactions, attachment parent/batch ordering, repeatable-read conflicts, rollback and the three-session legacy/aligned/writer queue. Count/page tests must prove authorized snapshot coherence and bounded pages under concurrent changes. Comprehensive regressions and user review remain acceptance gates.

See [F058.1 implementation and validation](../../features/F058-1-request-authorization-consistency.md) and [ADR-023 — Administrative Access Management](ADR-023-administrative-access-management-controlled-delegation.md). Existing PUBLIC/INTERNAL, operational scope and child-resource decisions remain in force.
