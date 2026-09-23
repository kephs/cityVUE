# ADR-012 — Trusted requester identity is separate from Contact

Status: proposed for final F050 review; implemented under the authorized F050 specification. This is a development foundation, not production identity or deployment approval.

## Context

F049's explicit identified/anonymous state describes submission intent. Unverified Contact cannot prove that requests belong to the same person. Workforce Entra authenticates staff, not residents. No approved production resident provider currently exists.

## Decision

- `requester` uses a random UUID, Organization, controlled identity source, provider-defined stable subject and creation timestamp. Unique Organization/source/subject resolves concurrent first use. No display name, Contact, geography or behavioral profile is duplicated. Identity is immutable; merge/split/correction/deletion is deferred.
- Only DEVELOPMENT_SYNTHETIC is implemented. Its exact, bounded, lowercase fictional subject contract is deliberately distinct from future providers. A server-only adapter issues immutable, provenance-checked in-process contexts. Neither DTOs nor workforce staff claims can supply these. Adding a real provider requires its own authentication, subject-validation, Organization mapping and deployment review; do not expand the development source into resident authentication.
- A guarded CLI, with explicit environment and fictional-data opt-ins, provisions identities or creates new fictional requests through the canonical creation service. It verifies localhost:5432 / reqro_dev / reqro_dev_user and the existing fictional Organization. No HTTP synthetic identity selection, broad directory, historical linking or staff manual matching endpoint is added. Production/client contexts fail closed. Ordinary PUBLIC and assisted intake retain Contact-only identified or explicit anonymous behavior, with no persistent linkage.
- Optional `service_request.requester_id` is set only at creation. Composite Organization foreign key, eligibility check and immutable-link trigger reject cross-Organization, anonymous, INTERNAL and subsequent null-to-link/reassignment. Migration creates zero Requesters/links; missing Contact is never identity evidence.
- Requester resolution and request writes share the canonical creation transaction. Finalized F046 retries retain the original receipt. Trusted source/subject is included only in the in-memory submission digest input, so another context cannot replay an evidence claim into a different identity. No raw subject goes into receipt, Activity, audit or normal logs. Independent submissions without evidence remain independent creates; general intake idempotency is not introduced.
- Staff history is mediated by an authorized current identified PUBLIC request. `staffRequestReadScope` constrains all linked rows, counts and category aggregation. No extra identity permission is needed: each result must already be readable through the normal staff route. Contact permission is neither required nor conferred. Unknown, unlinked and out-of-scope parents fail safely; arbitrary requester IDs grant nothing.
- A repeatable-read transaction makes parent/rows/count/categories consistent within the admitted request, following existing Activity reads. Fresh requests resolve current staff permissions/scope. In-flight responses follow normal admission semantics; there is no promise to retract disclosed data or cancel already-admitted operations on concurrent revocation.
- History has default 25/max 100 rows, page 1–1,000,000, createdAt descending then UUID descending. Current request is included and marked. Rows expose only navigation ID, stored reference, versioned Issue name, status, createdAt and current marker. Category counts use the same authorized relation. Time/status summaries, Service Location, Contact, Notes, Communications, attachments, Activity, tracking and identity-source metadata are omitted.
- A dedicated typed append-only `requester_history_audit` follows the repository's separate attachment/configuration audit precedent. Allowlist: generated ID, Organization, current request, staff ID, fixed `history_viewed` action, server correlation UUID and timestamp. No requester subject/ID, result payload, hidden count or protected text. The audit commits before disclosure; failure denies the response. No Contact or operational Activity event is generated.
- The dialog is explicit-action lazy loading, never hover/prefetch. No durable cache, browser storage or URL identity metadata. Closing clears it; request/auth changes unmount it; aborted/late requests cannot restore old data. Normal staff navigation reauthorizes destinations.

## Security and residual risks

| Threat                                                | Mitigation / residual boundary                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Browser ID/source/subject forgery                     | Strict DTO rejection; no browser identity endpoint; context provenance checked server-side                                |
| Contact/email/phone/name inference                    | No identity queries use Contact; shared values may represent different subjects                                           |
| Anonymous, INTERNAL, historical or manual mis-linking | Creation-only constrained link; no backfill or manual linking UI/API                                                      |
| Cross-Organization substitution / enumeration         | Composite foreign keys and current-parent SQL authorization; no directory                                                 |
| Hidden row/count/category leakage                     | Identical authorized base relation before aggregation/pagination                                                          |
| Provider subject, Contact or payload leakage          | Explicit response/audit projections; existing log allowlist; live logging gate                                            |
| Duplicate first resolution                            | Database unique constraint plus insert-on-conflict-do-nothing and subsequent lookup                                       |
| Partial creation / failed audit                       | Transaction rollback and required audit-before-disclosure                                                                 |
| Stale browser authorization                           | No persistent cache; fresh explicit opens; next-request revocation semantics                                              |
| Behavioral judgment / future merge                    | Factual accessible counts only; no scores, labels, automated decisions or merge machinery                                 |
| Privileged local operator misuse                      | CLI is personal-development tooling, not production authorization; explicit fictional-data contract and restricted target |

Unique Organization/source/subject lookup and the partial Organization/requester/createdAt/UUID index support resolution and history. Each history read uses one parent query, count, category aggregate, joined row query and audit insert; no N+1 or protected-domain lookup. Count/aggregation cost grows with authorized linked history; no production load-test claim is made.

## Production prerequisites and related decisions

Production has no trusted resident provider and never falls back to Contact matching. It may create an identified Contact-only request with no trusted link. Real provider integration needs approved Organization mapping, stable subject/verification contract, lifecycle/correction and privacy/retention governance, operational controls, load/abuse testing and separately authorized deployment. Requester self-service/history/communication, geography/participation analytics and advanced routing remain future work.

This extends [ADR-011 explicit identity](ADR-011-explicit-requester-identity.md) without changing anonymity or the two Issue policies. It preserves [ADR-005 Contact privacy](ADR-005-requester-contact-privacy.md), [ADR-006 request authorization](ADR-006-public-internal-staff-authorization.md), [ADR-009 tracking](ADR-009-secure-requester-tracking.md) and [ADR-010 attachments](ADR-010-secure-attachment-architecture.md). See [F050](../../features/F050-trusted-requester-identity-history.md) for completion gates and evidence.
