# ADR-026 — Outbound Notification and Delivery Architecture

Status: **Accepted** — approved at architecture/security review on 2026-10-04.

**Acceptance scope.** This architecture is accepted as Reqro's decided direction for outbound notification and delivery, and is approved for implementation in bounded, separately reviewed slices. **Acceptance is not authorization to send live email or to provision infrastructure.** Real provider integration, network egress of any kind, secret retrieval, database migrations, SMS, inbound webhooks, background workers and deployment each remain **separately gated** and are not approved by this record.

**Implementation state.** Only Slice 1 is implemented: Reqro-owned contracts, an intentionally empty provider registry, the resident-safe projection, code-based platform templates and a pure renderer. There is no outbox table, no worker, no provider adapter, no destination resolution, no suppression or consent model, no webhook route and no outbound transport. Nothing in the repository can send a message.

## Context

Reqro records resident requests, requester contact, operational activity, correspondence and alerts, but has no outbound delivery capability of any kind. [ADR-010](ADR-010-secure-attachment-architecture.md) records the current implementation state as _"OUTBOUND / PORTAL / RECORDED, without email/SMS/external delivery."_ [ADR-008](ADR-008-requester-communication.md) records correspondence as _"saved in Reqro for future authorized requester presentation, with no assertion of delivery, presentation, notification or receipt."_

Discovery confirmed the gap and its shape. There is no queue, job table, scheduler or worker. The server makes **no outbound HTTP calls at all** apart from the Entra JWKS fetch, so notifications would introduce the platform's first egress. `requester_contact` holds `{ name, email }` and **no phone column exists for a resident**. There is no Organization email address, reply-to or from-identity anywhere in the schema. No template, preference, consent or suppression model exists.

Several foundations do exist and shape this decision: `request_operational_activity` is an append-only lifecycle stream with `unique(organization_id, service_request_id, request_revision, event_index)`; `requesterStatus()` already collapses internal workflow status to a resident-safe value; `requesterCommunicationProjection` already demonstrates an allowlist projection; `AiProviderRegistry` already demonstrates a provider-neutral registry; and `ai_usage` already demonstrates an Organization-scoped outcome and failure-category model.

[F002 Notification Orchestration](../../features/F002-core-product-capabilities-domain-requirements.md) records the requirement baseline, including queued/sent/failed/retrying states, bounded retry, deduplication, template versioning, correlation to the causing activity, and that _"channels beyond email, including SMS or push, require separate approval."_

## Decision

### MVP scope

The first supported channel is **transactional resident email**. The initial events are **system-generated only**: request submitted, resident-safe status changed, and request closed.

**Free-text staff correspondence is deliberately not the first email feature.** `request_communication.body` is staff-authored free text bounded only to 1–4,000 characters, and ADR-008 states that _"no automated redaction is claimed"_ and the UI merely warns authors. Emailing it would send unreviewed free text outside Reqro's boundary irrevocably. Correspondence delivery follows once the outbox, retry, audit and operator-visibility machinery is proven on content Reqro generates itself.

**SMS remains separately gated** by existing F002 governance and additionally requires a resident phone destination, a consent model and legal review, none of which exist. **Alert and newsletter subscriptions are not part of this workstream**: bulk messaging carries a different consent regime, different sender-reputation management and different legal exposure, and requires its own decision.

### Delivery architecture — transactional outbox

Delivery intent is written as a row in the same database transaction as the business change that caused it. If the business transaction rolls back, the intent rolls back with it.

Three alternatives are **rejected**:

- **Synchronous provider send from business services.** The provider may accept while the transaction later rolls back, telling a resident their request closed when it did not.
- **Best-effort after-commit dispatch.** A crash between COMMIT and dispatch loses the notification with no record it was ever intended.
- **Dual-write direct queue enqueue.** Either the queue accepts and the database rolls back (phantom notification), or the database commits and the queue write fails (lost intent).

The outbox is also the right fit for this repository specifically: the one-transaction discipline already exists in request creation and in [ADR-024](ADR-024-transaction-time-request-authorization.md)'s Organization-first locking; an outbox is a table, requiring no infrastructure provisioning; and it degrades correctly, accumulating rows when a worker or provider is unavailable rather than losing them.

### Organization isolation

Every notification intent carries an immutable `organization_id`, captured when the business event is created. It is **never re-derived** from hostname, current deployment state, retry context or webhook payload. Retries and delivery receipts remain bound to the original Organization, and provider configuration, template resolution and provider-message correlation are all Organization-bound.

### Structural idempotency

Duplicate prevention is **structural, not procedural**: `unique(organization_id, dedupe_key)`, where the key is deterministically derived from the triggering business event. Where a stable activity identity already exists — `(service_request_id, request_revision, event_index)` is already unique in `request_operational_activity` — reuse it rather than inventing a parallel one. A re-run of a handler is then safe by construction; no code path has to remember to check.

### Provider-neutral adapter model

Follow the registry pattern the AI subsystem already uses. Notification domain logic depends only on Reqro-owned interfaces; vendor SDK types, credentials and provider payloads stay private to adapters and never cross the boundary in either direction.

The provider contract states its capabilities **explicitly**, including **whether it reports final delivery**. Plain SMTP cannot; API providers can. Without an explicit capability, messages sent through a non-reporting transport would appear perpetually unconfirmed, and consumers would be unable to distinguish "we never heard back" from "this provider cannot tell us." This preserves the truthfulness discipline ADR-008 established for `RECORDED`.

### Resident-safe content boundary

**This is a required security boundary, not a formatting convenience.**

Templates must not render against `ServiceRequest` domain objects, raw activity rows, staff identity, internal notes, internal statuses, routing or assignment data, or requester contact objects. They render against a dedicated allowlisted **`ResidentSafeNotificationView`**.

Internal data is **absent by construction rather than removed after the fact**: the view has no field for it, the projection takes narrow explicit inputs rather than a domain aggregate, and the renderer accepts nothing else. Adding an internal field to the domain therefore cannot silently widen what a resident notification can say.

Resident status must use the **existing resident-safe status projection** (`requesterStatus`), so a notification can never present an internal value such as `on_hold` that the resident tracking page deliberately hides. Staff-channel notifications use a separate view and must not share a template namespace with resident channels.

### Templates

Initial templates are **platform-owned and code-based**. No tenant-editable template persistence is introduced; that is a later reviewed capability.

Requirements: a plain-text part is **required**; HTML is optional and the text part remains authoritative; there is **no executable template language** — no eval, expressions, loops, includes or filters; no arbitrary HTML, no scripts, and **no hidden tracking pixels**, since open and click tracking is surveillance of residents and must not arrive as a side effect of HTML email; no arbitrary tenant-supplied URLs; and context-aware escaping wherever HTML exists. Subjects carry the request reference only, not issue details, locations or other request content.

When tenant-configurable wording is eventually approved, tenants supply plain text for named slots and the platform renders the surrounding layout. Tenants do not author raw markup.

### Tracking links

**The long-lived requester tracking bearer credential must not be emailed.** It is a 43-character bearer secret whose plaintext is currently returned once at issue time and stored only as a digest; placing it in a mailbox discloses it permanently to anything that later reads that mailbox, with no revocation point.

A future email link must use a **short-lived, single-use exchange mechanism**, or another separately reviewed secure mechanism. Until that exists, templates must not embed the current tracking credential, and lifecycle messages either carry an already-trusted link supplied by the caller or render with no link at all. This record does not implement exchange tokens.

Resident links use the tenant's verified public canonical domain under [ADR-025](ADR-025-trusted-production-organization-resolution.md). A platform domain is never substituted for a tenant's own address.

### Provider timeout and ambiguous acceptance

When provider acceptance is ambiguous because the request timed out after the message may already have been submitted:

- **do not retry automatically** unless the provider supports reliable idempotency keys;
- route the delivery to **operator review / dead-letter**;
- prefer a **surfaced uncertain-delivery condition** over silently sending a duplicate resident notification.

Under-delivering once, visibly, is better than messaging a resident twice about their request invisibly. SMTP in particular offers no idempotency mechanism.

### Provider ownership

**Tenant-owned email provider accounts first.** The current deployment strategy is isolated-per-tenant, which makes a tenant-owned account the natural configuration, and it preserves sender-reputation isolation, billing isolation, tenant domain and DKIM ownership, and incident isolation. Email sending reputation is shared fate: on a shared account one tenant's complaint rate degrades deliverability for every other tenant. Shared Reqro provider accounts may be supported later.

### Secrets

Provider credentials are **never** in browser code, **never** in ordinary tenant configuration tables, **never** in logs, and **never** in notification DTOs. Configuration tables may hold a secret _reference_; the secret itself is resolved through a secret manager, Key Vault or managed identity where available, with managed identity preferred because it stores no secret at all. **No secret retrieval is implemented in this slice.**

### Delivery state, retry and receipts

Delivery state is modeled **separately** from correspondence (see ADR relationships below). `sent` means a provider accepted responsibility; it never asserts delivery, and `delivered` is only ever recorded for a provider whose delivery-reporting capability is true. Retry uses bounded attempts with exponential backoff and full jitter, a closed transient/permanent failure taxonomy, and a terminal dead-letter state with operator visibility.

Inbound provider webhooks, when implemented, authenticate by **signature over the raw body**, with timestamp replay defence and provider event-ID deduplication. **A webhook's hostname is not authentication**: hostname answers which tenant a request is for, not whether the caller may assert a delivery outcome, and anyone who can reach the endpoint can set a `Host` header. Organization is derived from the matched outbox row, never from the payload or the host.

## ADR relationships

- **[ADR-008](ADR-008-requester-communication.md) remains in force.** All F042 correspondence fields, including `RECORDED`, are immutable. **Delivery state is therefore modeled separately from immutable correspondence**, as ADR-008 itself anticipates: _"a future delivery feature can add channels and separately controlled delivery attempts/state transitions through reviewed migrations while retaining immutable correspondence content."_ Destination values are not copied onto correspondence rows.
- **[ADR-010](ADR-010-secure-attachment-architecture.md)** records the current implementation state as _"without email/SMS/external delivery."_ That statement of **current implementation** is amended by this accepted **future architecture**; it remains accurate today, and nothing in ADR-010's attachment decisions is changed.
- **[ADR-025](ADR-025-trusted-production-organization-resolution.md)** governs Organization/tenant binding and public canonical domains. Notification links use the tenant's verified canonical domain; background work carries explicit persisted Organization context, as ADR-025 already requires for jobs.
- **[ADR-001](ADR-001-organization-isolation.md)** remains in force: Organization is the trusted tenant boundary, deployment-per-tenant is preferred, and no cross-tenant administration is introduced.
- **Acceptance of ADR-026 does not authorize live outbound egress.**

No prior ADR is rewritten or deleted.

## Consequences

Notifications introduce the platform's first outbound network egress, which brings egress policy, credential handling, timeouts and connection management into a process that has none of them; this warrants its own infrastructure review alongside the ingress/proxy-trust item the security framework already flags. Operators gain a new failure surface — dead-letter queues, bounce rates and provider outages — that needs visibility before volume grows. Cache keys, throttle keys, suppression lists and provider identifiers each acquire a tenant dimension that must be designed rather than inherited from defaults.

Two schema gaps block parts of the roadmap: there is no Organization email address or reply-to field, and no resident phone column. Both require their own reviewed migrations.

## Security and privacy

Destinations are **referenced, not copied**: the outbox stores a contact reference and resolves the address at send time, so corrections take effect on retry, deletions fail closed, and the outbox never becomes a shadow copy of resident PII. Suppression lists store a digest rather than an address, so a compromised list yields no contact data. Audit records metadata only; a rendered body is reproducible from `(template_key, template_version, variables)`, which is stronger evidence than a stored copy and stores far less.

Recipient addresses, phone numbers, subjects and rendered bodies must not appear in logs, metric labels or audit rows. The existing log-sanitization allowlist drops unknown keys, so any new diagnostic field requires explicit allowlist review.

The highest-ranked residual risks are a mis-addressed message reaching the wrong resident, internal status or notes reaching notification content, and provider-dashboard exposure of addresses and bodies to anyone with provider console access. The first two are addressed structurally by the resident-safe boundary and composite Organization-scoped references. The third is largely outside Reqro's control and is a further argument for tenant-owned provider accounts and for linking to the portal rather than restating request content in the message body.

Anonymity remains structurally protected: a database trigger already makes a `requester_contact` row impossible for an `anonymous` request, so such a request has no destination by construction rather than by policy.

## Legal review required

This record draws no legal conclusions. Counsel must determine whether lifecycle notifications qualify as transactional rather than commercial; applicable public-records and retention obligations for outbound municipal communication; SMS consent, opt-out and carrier policy requirements; accessibility obligations for outbound communication; and whether suppression may ever be shared across tenants.

## Evidence required before each later slice

A disposable PostgreSQL tier proving that two Organizations never cross in claim, suppression, template resolution, webhook correlation or retry; concurrency coverage proving two workers claim a row once and that a lease expiry re-claims safely; webhook coverage for valid, tampered, replayed and duplicate events, and that an event referencing one tenant's provider message ID cannot mutate another's row; and rendering coverage proving internal sentinels never reach output. That database tier **cannot currently be executed** because `TEST_DATABASE_URL` is not configured; configuring it is a prerequisite for any persistence-bearing slice.

## Related evidence

[ADR-008 — Requester communication](ADR-008-requester-communication.md), [ADR-010 — Secure attachment architecture](ADR-010-secure-attachment-architecture.md), [ADR-024 — Transaction-time authorization](ADR-024-transaction-time-request-authorization.md), [ADR-025 — Trusted production Organization resolution](ADR-025-trusted-production-organization-resolution.md), [F002 Notification Orchestration](../../features/F002-core-product-capabilities-domain-requirements.md), [notification contracts](../../../server/src/notifications/notification.types.ts), [resident-safe projection](../../../server/src/notifications/resident-safe-notification.ts), [platform templates](../../../server/src/notifications/notification-templates.ts), and the existing [resident tracking status mapping](../../../server/src/service-request/request-tracking.domain.ts).
