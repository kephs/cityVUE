# F011 — Phase D0 Canonical ServiceRequest Persistence

**Status:** Implemented and validated locally; not committed or deployed

## Outcome

Phase D0 adds canonical resident ServiceRequest creation behind `POST /api/v1/service-requests`. The production React application remains on `IssueService`, its fixture, compatibility mapper, and browser `localStorage`. No legacy records are migrated or assigned fabricated references.

## Persistence model

`service_request` has an immutable UUID primary key, globally unique human reference, explicit Organization, exact ServiceDefinition and published version, Category, initial `open` status, catalog-authoritative priority, resident description, anonymous/identified mode, explicit integer revision, and UTC database timestamps. Composite foreign keys prevent cross-Organization catalog relationships. The revision begins at one for future optimistic-concurrency predicates; D0 provides no edit endpoint.

Requester contact is a separate optional one-to-one Organization-owned row containing identified resident name and optional email. Anonymous submissions persist no contact row. Email is stored but never used for notifications. Resident identity is self-asserted and unauthenticated.

Location is an optional one-to-one Organization-owned row with entered address, future normalized address/coordinates, constrained location type, nullable facility/park/parcel/GIS-asset references, nullable eligibility result, and validation timestamp. D0 writes only the resident-entered address/type. It never calls GIS or marks eligibility.

Answers use a hybrid typed-column strategy: text, numeric, boolean, or stable option key occupy mutually constrained columns alongside an explicit question type. Each row snapshots question key, label, type, order, and selected option display label. This preserves semantic values and historical interpretation without reducing everything to display text or adopting unconstrained JSON values.

Activity is Organization-owned, append-only, and separate from operational logs. Creation appends one `service_request_created` row with anonymous-resident or identified-resident actor type, no fabricated actor ID, and minimal safe reference metadata. A database trigger rejects Activity updates/deletes.

## Reference allocation and time

References use `SR-YYYYMM-NNNNNN`. `periodKeyFor` applies `Organization.defaultBusinessTimezone` to the server-provided instant using the platform IANA `Intl.DateTimeFormat` implementation. PostgreSQL timestamps remain UTC; only business-month interpretation uses the Organization timezone.

`service_request_reference_sequence` has one globally shared row per `YYYYMM`, not one row per Organization. `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` atomically increments the period counter inside the request transaction. This works for isolated deployments and a possible shared database while preserving the approved reference format without an Organization prefix. The complete reference also has a unique constraint. Transaction rollback restores the counter update, although gaplessness is not promised because correctness and future operational recovery take precedence. Capacity is constrained to 999,999 per month.

## Creation transaction and validation

The application service loads the active Organization, active ServiceDefinition/Category, and exact published version in the configured Organization. Clients must submit `serviceDefinitionVersionId`; a still-published version that rendered the form remains valid after a newer publication, preventing silent reinterpretation.

Before allocation it validates reporting and location policies, duplicate/foreign question IDs, equality-only visibility, required visible answers, rejection of hidden stale answers, supported semantic types, numeric/text metadata limits, and active single-select options. Description and structured answers remain separate. One Kysely transaction then allocates the reference and writes ServiceRequest, optional contact, optional Location, Answer snapshots, and initial Activity. Any validation or write failure rolls everything back.

The response contains only request UUID, reference number, status, and creation timestamp. Organization, contact, answers, Activity, routing, and integration internals are omitted. Exact reference lookup exists at the Organization-scoped repository boundary but no unauthenticated read/search endpoint is exposed pending privacy and access-control design.

No transactional outbox is added because notifications/background processing remain a later phase. HTTP idempotency remains required future design work; adding a durable idempotency-key contract without retention/replay policy would be premature. Duplicate-request detection is separate.

## API and security boundary

The global Phase A rate limiter applies to POST. Production needs endpoint-specific abuse limits and may later evaluate approved bot mitigation. Request logging does not log bodies, so descriptions, answers, contact, and locations are not emitted. Existing correlation and sanitized-error handling applies. OpenAPI documents request/response DTOs and safe 400/404/409 outcomes.

The configured `DEVELOPMENT_ORGANIZATION_ID` remains a local foundation rather than trusted tenant authorization. The POST route is intended to become public resident submission, but D0 is not production-ready multi-Organization isolation. Entra/RBAC is deferred and is not the resident identity model.

## Validation and boundaries

Unit tests cover reference formatting, timezone month boundaries, conditional equality, typed normalization, requester policy, and location policy. PostgreSQL tests cover migration, concurrent allocation, monthly reset, exact timezone boundary, global uniqueness, Organization FKs, exact version, Answer snapshots, requester/location, append-only Activity, reference lookup, and rollback. E2E tests cover successful anonymous/identified responses, DTO safety, malformed IDs, policy failures, missing location, missing versions, and response-field boundaries.

No Admin management, editing/deletion, status workflow, assignments, watchers, notifications, outbox, attachments, GIS, EAM, Entra/RBAC, frontend cutover, Firebase/Azure change, or deployment is included.
