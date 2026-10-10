# F062 — Enterprise integration reliability and eventing architecture

**Design and research only. Nothing was implemented, migrated or provisioned.** Baseline `b805919e8de226bef3c1eea9fb63d0aeb3c67495` (authoritative `main`). No integration code, no migration, no queue, broker or cloud service, and no ADR number is allocated.

**Scope boundary.** This assessment adds exactly one file — itself. It modifies no observability, PIM or serving work, no ADR, and not the ADR index.

**Baseline note.** `origin/main` advanced during review and now also carries [F061 — Enterprise observability and resilience readiness](F061-enterprise-observability-resilience-readiness.md). F061 is treated as an **input** and is not modified; Part 13 is aligned to it rather than written in its absence. This branch has been synchronized onto that `main`, so F061 is present and is referenced as a resolving link.

**Review status: APPROVED WITH REQUIRED DOCUMENTATION HARDENING**, architecture review 2026-10-09. All ten required items are incorporated. Two of them corrected genuine errors in the first draft, and both corrections are recorded in place rather than silently repaired:

- **§3.2** — the first draft described projecting payloads from current state while elsewhere claiming *faithful replay*. Those cannot both be true. The resolution is an explicit split between immutable business events (type A) and desired-state synchronization intents (type B), with current-state projection permitted **only** for type B.
- **§2.1** — the first draft called "work order" a vendor-shaped word. It is ordinary industry terminology, and the vendor-containment rule has been narrowed to what it should always have said: vendor *schemas, identifiers, status semantics and API concepts* stay inside adapters, while legitimate domain vocabulary does not need avoiding.

**The central recommendation up front.** Reqro should **not** design a new enterprise integration architecture. [ADR-026](../architecture/decisions/ADR-026-outbound-notification-delivery-architecture.md) already decided — and justified for *this* repository — a transactional outbox, immutable Organization binding, structural idempotency, explicit capability declaration, a closed transient/permanent failure taxonomy, bounded retry with dead-lettering, and signature-authenticated inbound webhooks whose tenancy is never derived from the payload or the `Host` header. Every one of those answers generalises. F062's job is to **widen that proven boundary from one channel to many destination systems, and from one direction to two**, not to run the argument again with different words.

What genuinely is new in F062, and therefore what this document spends its effort on: **bidirectional** integration, **multiple heterogeneous destinations per tenant**, **external-system authority and synchronisation loops**, **ordering**, **schema evolution for connector-consumed contracts**, and **reconciliation**. ADR-026 needed none of those.

---

## Part 1 — Current integration behaviour and capabilities (verified against the repository)

### 1.1 What exists

| | |
| --- | --- |
| Enterprise integration code | **None.** No connector, adapter, router, transport or egress of any kind |
| Notification capability | **ADR-026 Slice 1 only** — six files under `server/src/notifications/`: Reqro-owned contracts, a deliberately **empty** provider registry, the resident-safe projection, code-based platform templates and a pure renderer |
| Integration persistence | **None.** Across all 49 migrations there is no outbox, inbox, idempotency, delivery-attempt, dead-letter or connector-configuration table (verified by search) |
| Outbound network egress | **None.** Nothing in the repository can send a message or call an external system |

So Reqro today records resident requests, operational activity, correspondence and alerts, and integrates with nothing. There is no legacy integration design to preserve and no compatibility debt — which is the one genuine advantage of this starting position.

### 1.2 Existing primitives F062 should build on rather than reinvent

These are real, implemented mechanisms, not aspirations:

- **Composite tenant-safe foreign keys.** 21 constraints of the form `foreign key (organization_id, x) references t(organization_id, x)` already make a cross-Organization reference *structurally impossible* rather than merely forbidden (ADR-001). Every F062 table must use this pattern.
- **A stable per-activity identity.** `operational_revision_slot_unique unique(organization_id, service_request_id, request_revision, event_index)` already exists. ADR-026's instruction — reuse an existing stable identity for idempotency rather than inventing a parallel one — applies directly.
- **Organization-first locking and revision discipline** (ADR-024), giving a natural per-aggregate sequence number.
- **A closed, provider-neutral failure taxonomy** with a deliberate transient/permanent split, and the deliberate exclusion of `provider_timeout` from "transient" because ambiguous acceptance routes to operator review rather than an automatic resend.
- **Explicit capability declaration**, including `reportsDelivery`, so a transport that cannot confirm an outcome is never presented as if it had.
- **Allowlist log sanitization** and the audit payload safety check from the operator platform.

### 1.3 One correction to a recorded blocker

ADR-026 records that its database test tier *"cannot currently be executed because `TEST_DATABASE_URL` is not configured"*. That is **no longer accurate**: F060.3C established a working gated disposable-database workflow (`npm run test:db`, a disposable PostgreSQL 17 harness, and the authorized `reqro_f0592_test` path), under which large database suites have been executed. A persistence-bearing integration slice is therefore **not** blocked on test infrastructure. Recorded here rather than by editing ADR-026, which is out of scope.

---

## Part 2 — Proposed architecture

### 2.1 Four layers, and the rule that keeps them apart

This matches the Integration Router topology AGENTS.md already authorizes, with the layers named explicitly:

```text
 Reqro domain                     ServiceRequest, WorkItem, Attachment, RequestStatus …
      |                           (no vendor concept may appear here, ever)
 Domain events          -->       immutable, provider-neutral envelopes (Part 3)
      |
 Integration router     -->       routes an event to the connectors a tenant owns
      |
 Connector adapters     -->       VueWorksConnector, CityworksConnector, CartegraphConnector,
      |                           MgoConnector, FutureConnector  (vendor schemas live HERE)
 Transport              -->       in-process worker first; a broker later, behind the same port
      |
 External system
```

**The rule:** a vendor name, schema, field, status code, SDK type or endpoint may appear **only inside a connector adapter**. It may not appear in a domain model, a domain event, the router, the transport, the database schema outside connector configuration, or any resident- or staff-facing surface. VueWorks, Cityworks, Cartegraph, MGO, Azure, Kafka and Service Bus are named in this document as *examples of destinations and transports* — they are explicitly **not** part of the Reqro domain model, and no F062 artefact may make them so.

**What the rule does and does not prohibit.** An earlier draft of this assessment overreached by implying that "work order" was a vendor-shaped word to be avoided. It is not — it is ordinary EAM and public-works terminology that predates and outlives any particular product, and banning legitimate domain vocabulary because a vendor also uses it would make Reqro's own domain language worse, not more neutral.

The rule is narrower and more useful:

| Must stay inside adapters | May appear in the domain |
| --- | --- |
| Vendor **schemas** and field names | Industry and domain terminology in general use |
| Vendor **identifiers** and key formats | Reqro's own neutral abstractions |
| Vendor **status semantics** and enum values | Concepts the problem domain genuinely has |
| Vendor **API concepts**, endpoints, SDK types, error codes, auth schemes | |

`WorkItem` remains the **recommended neutral abstraction** for Reqro's domain model, because it is deliberately broader than any one destination's resource and keeps Reqro's model independent of whichever system a client runs. But the reason is model independence, not word avoidance: a connector is free to speak of work orders internally, and documentation may use the industry term when that is what it means. What a connector must not do is let its destination's *status values*, *key format* or *API shape* leak outward.

### 2.2 The connector contract

One port, capability-declared, mirroring the notification provider contract that already exists:

```text
ConnectorId                 stable identifier, unchanged by credential rotation (9.4)
operations                  subset of: createRequest, getRequest, getRequestStatus,
                            updateRequest, addAttachment
capabilities                a CLOSED contract, declared explicitly, never assumed
dispatch(envelope, projection, context) -> ConnectorOutcome
```

**The closed capability contract.** Each is a deliberate question a destination must answer, because assuming any of them wrongly causes a specific, identifiable harm:

| Capability | What it decides | Harm if wrongly assumed |
| --- | --- | --- |
| `supportsIdempotencyKey` | Whether an **ambiguous** attempt may be auto-retried | A duplicate work item a crew physically acts on |
| `supportsReadAfterWrite` | Whether Reqro may verify an ambiguous mutation by reading back instead of retrying | Ambiguity resolved by guessing rather than by asking |
| `supportsReconciliation` | Whether periodic divergence detection is possible at all (Part 12) | Silent long-term drift presented as consistency |
| `supportsWebhookCallback` | Push versus poll; whether an inbox is needed for this connector | Polling a destination that would have told us, or waiting forever for a callback that never comes |
| `supportsOrdering` | Whether the destination honours per-aggregate order, or Reqro must serialise | A status change applied before the creation it depends on |
| `supportsUpdate` | Whether an existing external record can be amended | Corrections silently dropped, or a duplicate created instead of an update |
| `supportsCancel` / `supportsDelete` | Whether withdrawal is expressible, where the destination has the concept | A withdrawn request remaining live and dispatched to a crew |
| `supportsCurrentStateSync` | Whether a type B desired-state intent (§3.2) may be sent | A create-once destination receiving repeated convergence instructions |
| `reportsTerminalState` | Whether `acknowledged` may ever be recorded (Part 8) | Claiming an outcome no destination confirmed |
| `sideEffectRisk` | Bounded classification — `none` \| `reversible` \| `irreversible` \| `physical` | The decisive input to retry policy. An `irreversible` or `physical` side effect must never be auto-retried on ambiguity regardless of other capabilities |

`sideEffectRisk` deserves emphasis: it is the capability that distinguishes "retrying costs a wasted API call" from "retrying dispatches a second crew to a site". It is a **bounded classification, not a free-text note**, and `physical` is its own value because a work order that reaches a crew has consequences no software rollback addresses.

**No capability may encode a vendor name**, and none is a proxy for one. Capabilities describe what a destination *can do*; they never identify which product it is. A connector that needs behaviour conditional on its own product identity has pushed vendor logic into the wrong layer.

**Do not force an adapter to support what its destination cannot.** AGENTS.md states this and it is load-bearing: an unsupported capability is declared `false` and the router routes around it or refuses — it is never emulated, and never assumed because a sibling connector has it.

Concretely: a connector that cannot report terminal state must leave Reqro showing `accepted`, never `acknowledged`, exactly as a non-reporting notification transport must never show `delivered`.

**ADR-026's rule carries forward and tightens.** An ambiguous acceptance must **not** be retried automatically unless the destination supports reliable idempotency keys. For enterprise systems the stakes exceed a duplicate email: a blind retry after an ambiguous timeout can create a second work item that a crew physically acts on. Where `supportsIdempotencyKey` is false, an ambiguous attempt resolves by `supportsReadAfterWrite` if available, and otherwise routes to operator review — never to a blind retry.

### 2.3 Transport is a detail, deliberately

The first implementation should be an **in-process outbox worker**, for the same reason ADR-026 chose one: it requires no infrastructure provisioning, degrades by accumulating rows, and fits the existing single-transaction discipline. A broker — Service Bus, Kafka, SQS, anything — may later sit behind the same port **without any domain or event-contract change**. If introducing a broker would require changing the envelope, the boundary was drawn wrongly.

For multi-instance deployments the outbox needs row **claim-and-lease** semantics, which ADR-026 already designed and which its test plan already covers (two workers claim a row once; a lease expiry re-claims safely).

---

## Part 3 — The event contract

### 3.1 Envelope

Provider-neutral, immutable once written, and carrying **no PII**:

| Field | Notes |
| --- | --- |
| `eventId` | UUID. The identity a consumer deduplicates on |
| `organizationId` | **Immutable, captured when the business event occurs, never re-derived** from hostname, current deployment state, retry context or inbound payload (ADR-026) |
| `deploymentEnvironment` | The serving authority that produced it; prevents a staging event being accepted by a production connector |
| `aggregateType` / `aggregateId` | e.g. `service_request` + its UUID. Neutral names only |
| `aggregateRevision` | The per-aggregate sequence (Part 4.6). Pins *which* version of the aggregate the intent was formed against |
| `eventType` | Closed vocabulary, e.g. `service_request.submitted`, `service_request.status_changed`, `work_item.assigned`. Never a vendor verb |
| `schemaVersion` | Integer, per `eventType` (Part 7) |
| `occurredAt` | When the business fact happened |
| `recordedAt` | When Reqro durably recorded it; distinct from `occurredAt` and both are needed for honest lateness measurement |
| `correlationId` | Spans an entire user- or operator-initiated flow |
| `causationId` | The `eventId` or inbound-delivery ID that *caused* this event. **The loop-prevention mechanism** (Part 9.3) |
| `origin` | `reqro` or `external:{connectorId}` — whether Reqro authored this fact or mirrored it |
| `contractKind` | `event` (immutable business fact) or `state_sync` (desired-state intent). **Declared per `eventType`, never inferred** — see §3.2 |

**Delivery-attempt metadata is deliberately NOT in the envelope**, and the prohibition list for envelope content is in §3.3.

### 3.2 Two contract kinds, and why conflating them is a correctness bug

An earlier draft of this assessment described a single mechanism — project the payload at attempt time from current state — while elsewhere claiming the envelope preserved **faithful replay**. **Those two statements cannot both be true, and the contradiction is recorded rather than quietly removed.** Re-projecting a historical event from mutable current state and calling the result a replay of that event is wrong: it re-sends *today's* facts under *yesterday's* intent.

There are two distinct contract kinds, and every `eventType` must declare which one it is.

#### A. Immutable business/domain event

*Example: `service_request.created` at revision N.* An assertion that a thing happened, at a point in time, and it is still true that it happened.

**Requirement: the payload must be reconstructable as it was at that revision.** One of exactly two mechanisms, declared per `eventType`:

- **A1 — immutable payload data.** The fields the connector needs are captured into the envelope at enqueue time and never change. Bounded by a declared minimal field set, and subject to the privacy prohibitions in §3.3. Use where the field set is small and non-sensitive.
- **A2 — a reference to an immutable or reconstructable historical revision.** The envelope carries `(aggregateId, aggregateRevision)`, and the payload is reconstructed *for that revision* from append-only history — not from current state. This requires the aggregate to have genuinely reconstructable history; `request_operational_activity` is append-only and revision-keyed, which makes it a candidate, but **each aggregate's reconstructability must be proven, not assumed.**

**A2 fails closed.** If the historical revision cannot be reconstructed — history pruned, aggregate deleted, reconstruction unimplemented for that aggregate — the attempt refuses. It must never silently fall back to current state, because that is precisely the bug this section exists to prevent.

**Replay of a type A event re-sends what was true at that revision**, and is faithful in the strict sense. Nothing else may be called a replay.

#### B. Current-state synchronization intent

*Example: `work_item.sync_requested` — ensure the external WorkItem reflects Reqro's current approved state.* Not an assertion about the past; a **desired-state** instruction whose meaning is "converge the destination on what is true now".

**Current-state projection at attempt time is allowed here, and only here**, because it is the *defined semantics* of the contract rather than a convenient shortcut. Re-dispatching a type B intent later legitimately sends newer data — that is correct behaviour, not drift.

Required properties for type B:

- the contract is **explicitly declared** as desired-state synchronization, in the `eventType` registry, not inferred;
- it is **not** called a replay. Re-dispatch is *re-synchronization*;
- it is **idempotent by construction** — converging twice on the same state is a no-op;
- superseded intents for the same aggregate may be **collapsed** (only the newest need dispatch), which type A events must never be;
- the connector declares `supportsCurrentStateSync` (§2.2); a destination offering only create-once semantics cannot receive one.

#### The rule in one line

> **Type A answers "what happened?" and must be reconstructable as of its revision. Type B answers "what should be true now?" and is projected at attempt time. A single `eventType` is never both.**

### 3.3 Envelope privacy and bounded metadata

**No PII in envelopes**, and more strongly: the envelope stores **references, not copies** wherever a reference suffices. ADR-026 established this for destinations ("the outbox never becomes a shadow copy of resident PII"), and it generalises. A type A1 payload is the bounded exception, and its declared field set is reviewed precisely because it is an exception.

**Delivery-attempt metadata stays outside the immutable business envelope** — attempt number, timestamps, failure category, backoff state, circuit-breaker state and the connector involved all belong on the per-attempt record. The envelope describes the business fact; the attempt record describes the plumbing. Keeping them apart is what lets the envelope be immutable at all, and the envelope fans out to several connectors whose attempt histories differ.

**Explicitly prohibited in the envelope, and in attempt records and telemetry:**

| Prohibited | Why |
| --- | --- |
| Resident names, email addresses, phone numbers, postal addresses | PII; the envelope is retained long after the business need and fans out widely |
| Any credential, token, signing key, API key or secret-manager payload | A credential in an append-only, widely-read row cannot be rotated out of history |
| Tracking credentials or provider authentication material | Same, and a tracking identifier is often bearer-equivalent |
| Raw vendor error bodies | Untrusted third-party text; a plausible carrier of a credential or resident PII. Classify to a closed failure category; retain a bounded excerpt only if a review approves it |
| Unrestricted free-form status or notes | Unbounded, unsanitisable, and a path for staff free text to leave the boundary unreviewed — the exact concern ADR-026 raised about correspondence |
| High-cardinality or unbounded identifiers used as metadata | Defeats bounded telemetry and turns the envelope into a de-facto index of tenants or residents |

**Envelope metadata must stay bounded and provider-neutral:** closed vocabularies, identifiers, revisions, timestamps and closed failure categories. If a field cannot be enumerated or bounded, it does not belong in the envelope.

---

## Part 4 — Reliability model

### 4.0 Delivery semantics, stated plainly

> **Reqro uses at-least-once delivery with idempotent processing.**

**No claim of distributed exactly-once execution is made, and none should ever be made.** Exactly-once delivery across a network to a system Reqro does not control is not achievable; what *is* achievable is at-least-once delivery combined with processing that is idempotent, so a duplicate arrival has no additional effect. That is the property to build and the property to claim. Describing the result as "exactly once" would be marketing rather than engineering, and it would mislead whoever later debugs a duplicate.

The consequence is that **duplicates are expected, not exceptional**, and every mechanism in Part 5 exists to make them harmless.

**`ambiguous` is a distinct delivery outcome**, not a flavour of failure and not a flavour of success. It is the honest representation of *"the external mutation may or may not have taken effect, and we cannot tell"* — typically a response lost after a request that may already have succeeded, or a connection reset after send. Collapsing it into `failed` invites a retry that duplicates; collapsing it into `accepted` invents an outcome nobody observed.

**A non-idempotent ambiguous mutation must not be blindly retried.** Resolution order:

1. `supportsIdempotencyKey` → retry safely with the same key;
2. else `supportsReadAfterWrite` → read back and resolve to `accepted` or `failed` on evidence;
3. else, or where `sideEffectRisk` is `irreversible` or `physical` → **operator review**. A human decides, with the attempt record as evidence.

### 4.1 Is a transactional outbox appropriate for Reqro? **Yes.**

Not by analogy — for reasons specific to this codebase:

- **Atomicity is otherwise unobtainable.** A resident request and the intent to tell an external system about it must commit or fail together. Without an outbox the options are a dual write (which loses events) or a distributed transaction (which no destination here supports).
- **The one-transaction discipline already exists**, in request creation and in ADR-024's Organization-first locking. The outbox fits the grain of the code rather than cutting across it.
- **It is a table, not infrastructure.** No broker to provision, secure, licence or operate — which matters, because the operator platform's secret management and private networking are themselves still open.
- **It degrades correctly.** When a connector or worker is unavailable, rows accumulate. Nothing is lost, and the backlog is itself the alert signal (Part 11).

**The honest cost:** an outbox needs a worker, introduces end-to-end latency, and makes the oldest-pending-row age a metric somebody must actually watch. It also means "the request was accepted" and "the external system knows" are different moments, which the UI must represent truthfully.

### 4.2 Inbox / idempotency ledger — required for inbound

Outbound idempotency is structural (4.3). Inbound needs a ledger: a durable record of `(connectorId, externalEventId)` with a uniqueness constraint, scoped by `organization_id`. A redelivered callback hits the constraint and is acknowledged without re-applying. This is a generalisation of the provider-event-ID deduplication ADR-026 already specified for delivery webhooks.

### 4.3 Structural outbound idempotency

**Duplicate prevention must be structural, not procedural** — `unique(organization_id, dedupe_key)`, with the key derived deterministically from the triggering business fact, reusing the existing `(organization_id, service_request_id, request_revision, event_index)` identity wherever it applies. A re-run of a handler is then safe *by construction*; no code path has to remember to check. This is ADR-026's rule and it needs no amendment.

### 4.4 Retry, dead-letter, poison isolation

- Bounded attempts, **exponential backoff with full jitter**, classified by the closed transient/permanent taxonomy. Permanent failures are **not** retried: retrying cannot succeed and only delays the operator signal.
- **Ambiguous outcomes** (timeout, connection reset after send) are their own category — neither transient nor permanent. Auto-retry only when `supportsIdempotencyKey`; otherwise route to operator review.
- A terminal **dead-letter** state with operator visibility, per tenant and per connector (Part 6).
- **Poison isolation:** one event that repeatedly fails must not block its aggregate's queue indefinitely nor stall the connector. Recommended: dead-letter the event after its bounded attempts and **halt only that aggregate's ordered stream** (Part 4.6) while other aggregates continue — then surface it. A single malformed request must never stop an entire tenant's integration.

### 4.5 Replay

Replay must be an **explicit, authorized, audited operator action**, never automatic and never a side effect of a deploy. It should reuse the operator-platform discipline already built: a dry run that reports what *would* be re-dispatched, a separate confirm, and an attributed audit record. Replay re-dispatches an existing envelope; it never fabricates one.

### 4.6 Ordering

**Per-aggregate ordering only. No global ordering is provided, and none is needed.** Global ordering would serialise every tenant behind one stream for no benefit.

Per-aggregate ordering *is* needed: a status change must not overtake the creation it depends on. Mechanism: `aggregateRevision` is monotonic per aggregate; the worker dispatches at most one in-flight event per `(organizationId, aggregateType, aggregateId)`; and a connector may refuse an event whose revision precedes the last it acknowledged for that aggregate. Connectors declare `orderingGuarantee` so a destination that cannot honour ordering is known rather than assumed.

---

## Part 5 — Idempotency across the four cases

| Case | Mechanism |
| --- | --- |
| **Outbound create/update** | Structural `unique(organization_id, dedupe_key)` at enqueue; plus the connector's idempotency key on the wire where `supportsIdempotencyKey`. Without that capability, an ambiguous attempt goes to operator review rather than being retried |
| **Inbound callbacks** | Inbox ledger uniqueness on `(organization_id, connector_id, external_event_id)`; a duplicate is acknowledged and discarded. Apply-once is enforced in the same transaction that records the ledger row |
| **Webhooks** | As inbound callbacks, plus signature over the **raw body**, timestamp replay window, and **tenancy derived from the correlated Reqro record — never from the payload or the `Host` header** (ADR-026). Reaching the endpoint is not authority to assert an outcome |
| **Retries and replay** | Retries reuse the same `eventId` and idempotency key, so a destination that honours keys collapses them. Replay is explicit and audited, and is the one case where a duplicate *may* legitimately reach a destination — so connectors must state what a replayed event does, and operators must be told before confirming |

---

## Part 6 — Tenant isolation

Non-negotiable, and mostly achievable structurally rather than procedurally:

- **No cross-tenant routing.** Every outbox, inbox, attempt and connector-configuration row carries `organization_id` and uses the composite-FK pattern, so a reference across tenants cannot be expressed in the schema.
- **No shared fallback destination.** There is no default connector, no catch-all queue and no shared dead-letter. An event with no owning connector is an explicit refusal, not a redirect. A shared fallback is how one tenant's data reaches another.
- **Exact connector ownership.** Routing resolves `(organizationId, eventType)` to connectors that Organization owns. Unresolved → refuse and surface; never guess, never broadcast.
- **Tenant-scoped credentials and configuration.** One credential set per Organization per connector, resolved at attempt time by reference, never copied into an event row. Reuses the operator-platform rule that credentials live in a secret manager and are never in argv, env files, workspace files, logs or audit records.
- **Tenant-safe retry and dead-letter.** Backoff, circuit-breaker state and dead-letter queues are **per `(organization, connector)`**. One tenant's failing endpoint must not throttle, trip or dead-letter another's traffic — the obvious shared-circuit-breaker design is a cross-tenant coupling.
- `organizationId` is **immutable on the envelope** and never re-derived on retry or from an inbound payload.

---

## Part 7 — Schema evolution

Versioning is per `eventType`, with `schemaVersion` on the envelope.

| Change | Rule |
| --- | --- |
| **Additive** | Optional fields may be added without a version bump. Consumers must ignore unknown fields — stated as a contract requirement, because a connector that rejects unknown fields makes every future addition breaking |
| **Breaking** | Removing or renaming a field, narrowing a type, changing semantics, or making an optional field required. Requires a new `schemaVersion`, and both versions are emitted during migration |
| **Negotiation** | Each connector declares the versions it accepts per `eventType`. The router emits the highest mutually supported version. **No silent downgrade of meaning**: if no mutually supported version exists, that is a refusal with an operator signal, not a best-effort send |
| **Deprecation** | A version is announced deprecated, remains emitted for a defined window, and is removed only once no active connector declares it. Removal is a reviewed decision, and the envelope's own `schemaVersion` history is the evidence |

The `eventType` vocabulary is closed and additive: new types may be added; existing ones may not change meaning. A changed meaning under an unchanged name is the one evolution failure no consumer can defend against.

**The compatibility rules, stated as rules:**

1. **Additive optional fields are normally backward compatible** — and only *normally*, because the guarantee depends on consumers ignoring unknown fields. That obligation is part of the connector contract, not an assumption about good behaviour. A connector that rejects unknown fields makes every future addition breaking, so the contract states the requirement explicitly.
2. **A change in semantic meaning requires a new version**, even when the field shape is untouched. Re-interpreting an existing field is the most dangerous change available, because no type system and no schema check detects it.
3. **Removal or rename requires deprecation**, never immediate removal: announce, continue emitting through a defined window, and remove only once no active connector declares the version.
4. **Connectors declare the versions they support**, per `eventType`. The router emits the highest mutually supported version.
5. **Unsupported versions fail safely.** If no mutually supported version exists, the event is **refused with an operator signal** — never silently downgraded to a version whose meaning differs, and never dispatched on a best-effort basis. A silent downgrade is a semantic corruption disguised as resilience.
6. **Replay preserves the schema version associated with the original integration intent.** A replayed type A event is re-emitted at the version it was recorded with, not at today's newest, because the point of a replay is to reproduce the original intent. If the only connector that supported that version is gone, the replay **refuses** rather than re-encoding the intent into a newer contract. (Type B re-synchronization is not a replay and legitimately uses the current version — §3.2.)

**CloudEvents** is recorded as a **future evaluation option, not a required dependency.** Its envelope covers several fields designed here independently (`id`, `source`, `type`, `subject`, `time`, `dataschema`), so adopting its wire format later could ease interoperability with third-party tooling. It is explicitly **not** adopted now: it would introduce an external specification dependency before a single destination exists, some of its optional conventions do not map cleanly onto the tenancy and authority fields this architecture requires, and nothing in the design would have to change to adopt it later — the envelope is already a bounded, named field set. Evaluate it when a concrete interoperability requirement appears, not in anticipation of one.

---

## Part 8 — Integration state

Internal, staff/operator-facing state:

```text
pending  ->  dispatching  ->  accepted  ->  acknowledged
   |              |              |
   |              +-> retrying --+
   |              |
   |              +-> ambiguous (operator review)
   +-> refused (routing/version/projection failure)
                  +-> failed -> dead_lettered
```

- `accepted` means the external system took responsibility. It never asserts the work happened.
- `acknowledged` is recorded **only** for connectors whose `reportsTerminalState` is true. Otherwise the state honestly stops at `accepted`, exactly as ADR-026 forbids implying delivery no provider confirmed.
- `ambiguous` is a first-class state, not an error — it is the honest representation of "we do not know", and it is where a non-idempotent connector's timeouts go.

**Residents must never see any of this.** Residents see Reqro's own request status, which Reqro owns and can always answer. `retrying`, `dead_lettered`, `ambiguous` and connector identities are internal plumbing; showing them would expose vendor complexity, which AGENTS.md forbids, and would alarm a resident about something they cannot act on. The integration state surface is **staff and operator only**.

---

## Part 9 — External-system authority

### 9.1 Authority is an explicit, enforced contract — not a convention

**Field-level authority must be declared data that the router enforces**, not a shared understanding among developers. The declaration states, for each mirrorable fact, which single connector's external system is its authority. The representative matrix below is the *shape* of that declaration; the actual values are a product and City decision (Part 17, item 2).

| Fact | Declared authority | Notes |
| --- | --- | --- |
| Service request intake, reference number, requester contact, resident-facing status, correspondence, attachments | **Reqro** | Never inbound-writable by any connector |
| Work item lifecycle state, crew assignment, labour and equipment cost, completion | **External EAM / work management** | Mirrored inward; Reqro never authors |
| Permit or case status, conditions, approvals | **External permitting system** | Mirrored inward |
| Financial posting, account coding, invoice state | **External ERP** | Mirrored inward |
| Asset identity and geometry | **External GIS** | Mirrored inward |

No vendor API, endpoint or schema is claimed or implied by this table — it names *categories of system*, and each entry's binding to a real product and its real field names belongs in that connector.

**The enforcement rule, and the part that matters most:**

> **`origin` and `causationId` are loop-prevention evidence. They are not authorization.**

An inbound delivery that is correctly signed, correctly deduplicated, correctly tenant-scoped and demonstrably not an echo is *still not* permitted to write a fact its system does not own. Those checks establish **who is speaking and that we have not heard it before** — a different question from **whether this speaker may assert this fact**. Conflating them would let any authenticated connector write anything, which is the integration equivalent of treating authentication as authorization.

Therefore:

- **A connector must not modify a fact for which its external system is not the declared authority.** The write is refused and surfaced, not merged, not partially applied, and not accepted-with-a-warning.
- Authority is checked **per field**, not per message: one inbound payload may legitimately carry an authoritative field and a non-authoritative one, and the correct behaviour is to apply the first and refuse the second as a distinct, visible outcome.
- An attempt to write outside declared authority is a **security-relevant event**, not a data-quality one. It means a destination is sending more than its contract allows, or a connector is mapping fields wrongly.
- Reqro-authoritative facts have **no** inbound write path at all. The absence is structural, not a permission check that could be misconfigured.

### 9.2 Mirrored facts are read-only in Reqro

Where Reqro displays an externally owned fact it stores a **mirror**, explicitly marked as externally owned, with the owning connector and the observation time. Mirrors are **never writable by Reqro's own domain logic or UI**, and are never promoted to authoritative. A mirror whose source has gone silent must be presented as stale rather than current — which requires storing *when* it was observed, not only its value.

### 9.3 Loop prevention

Dual-master ambiguity and infinite echo are prevented by the envelope, not by convention:

- Every event carries `origin` (`reqro` or `external:{connectorId}`) and `causationId`.
- An event whose `origin` is `external:{c}` **must not** produce an outbound event back to connector `c`. The router refuses it structurally rather than relying on a connector to notice.
- Mirror writes do not generate domain events in the Reqro-authored sense; they generate a distinct `mirror.updated` type that **no connector is permitted to subscribe to for write-back**.
- `causationId` makes the chain auditable, so an echo that does occur is diagnosable instead of mysterious.

**The rule stated plainly: a fact may be mirrored inward or published outward, never both for the same field.** Any proposal for bidirectional ownership of one field should be rejected; the correct resolution is to split the field.

### 9.4 Connector lifecycle

A connector is a long-lived, per-tenant configured thing, and its states have operational meaning:

| State | Meaning | Dispatch behaviour |
| --- | --- | --- |
| `configured` | Exists with configuration, not yet authorized to run | Events **enqueue** and wait. Nothing dispatches |
| `active` | Normal operation | Dispatches |
| `degraded` | Reachable but impaired — elevated transient failures, circuit breaker open, or a declared capability failing | Dispatches with backoff; **surfaced to operators**. A distinct state because "working slowly" and "not working" need different responses |
| `disabled` / `suspended` | Deliberately stopped — by an operator, or by governance | Events **continue to enqueue**, nothing dispatches. Reversible |
| `retired` | Permanently decommissioned | No enqueue, no dispatch. Terminal |

Required properties:

- **Disabling or retiring a connector must never erase delivery history, dead-letter rows, reconciliation findings or audit evidence.** Those records are the evidence of what was and was not sent, and they outlive the connector that produced them. Decommissioning is a **state transition, not a deletion** — the rows remain queryable, attributed to a connector that is no longer active.
- **`disabled` accumulates; it does not discard.** A disabled connector behaves like an outage (Part 11), bounded by the same maximum-pending-age policy. Silently dropping events on disable would make "disable" a data-loss operation, which an operator would not expect.
- **`retired` is the only state that refuses new enqueue**, and it is deliberately terminal. Re-enabling a retired connector is a new configuration, not a state change, so that a decommissioned integration cannot quietly resume and flush a months-old backlog at a destination.
- **Credential rotation must not change connector identity.** `connectorId` is stable across rotation, re-keying, endpoint change and configuration edits, because delivery history, reconciliation findings and the authority declaration are all keyed to it. A rotation that minted a new identity would orphan the evidence and silently reset the authority binding — so credentials are referenced by the connector, never part of what identifies it.
- **State changes are themselves audited**, with actor attribution. Disabling an integration is a privileged operational act, and reusing the operator platform's attribution discipline is the natural fit.

---

## Part 10 — Security model

- **Outbound credential isolation.** Per `(organization, connector)` credentials in a secret manager, resolved at attempt time by reference. Never in envelopes, attempt records, configuration tables, argv, env files, workspace files, logs or audit records. One connector's compromise must not expose another's or another tenant's.
- **Inbound authenticity.** Signature over the **raw body** (not a re-serialised form), constant-time comparison, timestamp window for replay defence, and event-ID deduplication via the inbox. **Reaching the endpoint is not authorization**, and **the `Host` header is not authentication** — hostname answers which tenant a request is *for*, not whether the caller may assert anything. Tenancy comes from the correlated Reqro record.
- **Replay prevention.** Timestamp window plus inbox uniqueness. Both: a window alone admits fast replays, and uniqueness alone admits very old ones.
- **Least privilege.** Each connector credential holds the narrowest scope the destination offers; read-only where Reqro only reads. The operator platform's `reqro_operator` precedent applies — derive the needed surface empirically, do not request convenience scopes.
- **Secret rotation.** Overlapping validity so rotation needs no outage; rotation must not invalidate in-flight attempts; and no secret is ever written into an event, attempt or audit row, so rotation never requires rewriting history.
- **Sanitized integration logs.** Reuse the existing allowlist sanitizer and audit-payload safety check. Vendor error bodies are **untrusted third-party text** and must not be logged raw — classify to a closed failure category and retain a bounded excerpt only if a review approves it. A vendor error body is a plausible place for a credential or resident PII to appear.

---

## Part 11 — Backpressure and outages

**Resident request creation must not fail because a downstream system is unavailable.** The outbox makes this structural rather than aspirational: the request and its integration intent commit together, and dispatch is asynchronous. A destination down for hours or days produces a growing backlog, not failed intake.

- **Per-`(organization, connector)` circuit breaker.** Open on sustained transient failure, probe periodically, close on success. Per-pair so one tenant's outage is invisible to others.
- **The alert signal is the age of the oldest pending event**, per connector, not the queue depth. Depth is confounded by volume; age is not.
- **Multi-day outages:** keep accumulating, keep alerting, never drop. Bounded in practice by storage and by an explicit maximum-pending-age policy whose expiry action — dead-letter, or escalate and hold — is an **unresolved product decision** (Part 17), not something to decide in code.
- **Synchronous processing is the exception** and requires an explicit product contract. If a destination must be called synchronously during intake, the resident-visible failure mode becomes a product decision requiring approval, and that path must be scoped to the narrowest possible operation.

---

## Part 12 — Reconciliation

**Reconciliation is a first-class integration capability, not a maintenance afterthought.** It is declared per connector (`supportsReconciliation`), it has its own state and its own operator surface, and a connector that cannot support it is *known* to be unverifiable rather than assumed to be consistent.

> **Successful transport does not prove long-term consistency.** An `accepted` or even `acknowledged` outcome proves one message was handled at one moment. It says nothing about whether the two systems still agree a week later. Treating delivery success as a consistency guarantee is the most common way integrations drift silently for months.

Divergence arises even with perfect delivery: a dead-lettered event, a manual change made directly in the external system, a record deleted or merged there, a mirror whose update was missed, or a destination restored from a backup older than Reqro's history.

**Future discrepancy outcomes** — a closed classification, so a finding is actionable rather than a free-text note:

| Outcome | Meaning |
| --- | --- |
| `in_agreement` | Both systems report the same authoritative values |
| `reqro_ahead` | Reqro holds a fact the destination has not applied — typically an undelivered or dead-lettered event |
| `external_ahead` | The destination holds an authoritative change Reqro has not mirrored — typically a missed callback or a manual edit |
| `conflicting` | Both changed the same fact. Resolvable **only** by the declared authority (Part 9.1); never by a timestamp heuristic and never by last-writer-wins |
| `missing_external` | Reqro expects a counterpart that does not exist there |
| `missing_reqro` | The destination references a Reqro aggregate that does not exist — **or belongs to another tenant, which is a security signal, not a data-quality one** |
| `unverifiable` | The connector cannot support the comparison. An honest state, distinct from `in_agreement` |

**Operator review and repair handling** — designed here, implemented later:

- Findings are **recorded and surfaced; nothing self-heals.** First implementation detects only.
- Repair is an **authorized operator action** reusing the established dry-run → independent approval → confirm discipline, with the discrepancy record as the evidence an approver reviews.
- Repair direction is dictated by the **declared authority**, not by recency: a `conflicting` finding on an externally owned fact is repaired by accepting the external value; on a Reqro-owned fact, by re-dispatching Reqro's. Where authority is undeclared, repair is **refused** until it is declared.
- `missing_reqro` with a cross-tenant reference escalates as a **security event** and is never repaired by creating the missing record.
- Reconciliation runs are themselves audited, bounded in window and rate, and must never mutate as a side effect of scanning.

Design direction, deliberately read-only first:

1. **Periodic comparison** per connector, over a bounded window, of Reqro's expected external linkage against what the destination reports via `getRequest` / `getRequestStatus` — for connectors that declare those operations.
2. **A divergence report**, not an automatic repair. First implementation should **detect and surface only**. Automatic repair is a mutation driven by data Reqro does not own, and it needs its own authorization story.
3. **Repair as an authorized operator action**, reusing the dry-run → approve → confirm discipline from the operator platform, with the divergence record as the evidence an approver reviews.
4. **Orphan detection in both directions**: a Reqro request with no external counterpart, and an external record referencing a Reqro aggregate that does not exist or belongs to another tenant — the latter being a security signal, not just a data-quality one.

---

## Part 13 — Observability interface for F061

[F061 — Enterprise observability and resilience readiness](F061-enterprise-observability-resilience-readiness.md) landed on `main` while this assessment was in review, so this section is aligned to it rather than written in its absence. The dependency direction is unchanged and deliberate: **F062 emits through a narrow interface; F061 implements it.** No monitoring vendor concept may enter F062.

Three points of alignment, two of which independently corroborate decisions reached here before F061 was visible:

- **F061 recommends OpenTelemetry APIs, context and OTLP as the provider-neutral metrics and tracing contract**, with Azure Monitor / Application Insights as "an optional deployment adapter, never a domain dependency". That is exactly the boundary F062 needs, so F062 should emit through the OTel *API* at the integration boundary and adopt no exporter or vendor SDK of its own.
- **F061 states that telemetry SDK objects must not be introduced into "integration payload schemas"** — a rule aimed directly at this work. F062 accepts it: no telemetry type may appear in an envelope, a projection or a connector contract. Telemetry is emitted *about* an envelope, never *inside* one.
- **F061 independently reaches the same conclusion on label cardinality**, recording that request UUIDs are "lookup keys, not metric labels" and that canonical hostname is customer-identifying and should be omitted or remapped for metrics and general exports. That is the same reasoning applied below to `organizationId`, arrived at separately — which is some evidence it is the right call.

One F061 constraint that F062 must honour explicitly: F061 requires that queue and delivery SLIs be **marked "not implemented", never reported as green or as zero failures**, until they exist. So until F062.2 ships, integration telemetry must be absent or explicitly unimplemented — never a zero that reads as health.

- **Counters** — events enqueued, dispatch attempts, outcomes by closed failure category, dead-letters, inbound deliveries accepted/deduplicated/rejected, replay invocations.
- **Gauges** — oldest pending event age (the primary health signal), pending depth, circuit-breaker state.
- **Label cardinality is bounded on purpose:** `connectorId`, `eventType`, `outcome`, `failureCategory`. **`organizationId` is deliberately not a metric label** — it is unbounded as tenants grow and it turns a metrics endpoint into a customer list. Per-tenant detail belongs in the queryable integration-state tables, which are already access-controlled, not in telemetry.
- **Traces** — `correlationId` and `causationId` are already in the envelope and are the join keys; F062 should not adopt a tracing SDK to expose them.
- **No PII, no payloads, no credentials, no raw vendor error bodies** in telemetry. The existing sanitization architecture governs this.

---

## Part 14 — AI and future readiness

The same architecture supports governed automation **provided one rule holds: an AI model is an actor, never an authority.**

- An AI-driven workflow calls the same Reqro APIs under the same authorization as any other caller. It gets no privileged path, no direct outbox write and no ability to synthesise an envelope. An envelope is produced only as a consequence of a committed domain mutation.
- AI output is a **proposal**. Anything privileged requires the same human approval the operator platform already requires, with the same separation between who proposes and who approves.
- An AI-authored fact is marked as such through `origin`, so it is never indistinguishable from a human-authored or externally mirrored one.
- Bypassing a connector's capability declaration is not available to an AI caller any more than to a human: the capability model is enforced in the router, below any caller.
- The existing provider-neutral staff AI gateway decision (`docs/decisions/ADR-001-provider-neutral-staff-ai-gateway.md`) already establishes the adapter posture; F062 should align with it rather than introduce a second AI boundary.

---

## Part 15 — Migration and schema implications

**No migration is created by this assessment.** Implementation will eventually require roughly:

| Table | Purpose |
| --- | --- |
| `integration_outbox` | envelope + state + `unique(organization_id, dedupe_key)` |
| `integration_delivery_attempt` | per-attempt record; append-only |
| `integration_inbox` | `unique(organization_id, connector_id, external_event_id)` |
| `connector_configuration` | per-tenant connector enablement, accepted schema versions, **secret references — never secrets** |
| `external_reference` | mapping between a Reqro aggregate and its external key, per connector |
| `integration_mirror` *(or per-domain mirror columns)* | externally owned facts, marked as mirrors, with observation time |

Every one must use the composite tenant-safe FK pattern, carry an immutable `organization_id`, and respect the established runtime/migration/owner role separation and the least-privilege runtime grant matrix. New tables mean new runtime grants, which is a reviewed change — not an incidental one.

---

## Part 16 — Implementation slices

| Slice | Content | Needs persistence? |
| --- | --- | --- |
| **F062.1 — Contracts** | Envelope type with `contractKind`, closed `eventType` vocabulary, connector port, the closed capability contract, closed failure taxonomy, projection contract, authority-declaration shape, lifecycle states. Empty connector registry | No |
| **F062.2 — Outbox and worker** | Outbox + attempt tables, enqueue inside the domain transaction, claim-and-lease worker, retry/backoff, dead-letter, operator visibility. Still **no real connector** — a loopback connector proves the machinery | Yes |
| **F062.3 — First real connector** | One destination, outbound only, `createRequest` + `getRequestStatus`. **Requires the destination's actual API documentation** | Yes |
| **F062.4 — Inbound** | Inbox ledger, signed callbacks, mirror writes, loop prevention | Yes |
| **F062.5 — Reconciliation** | Divergence detection and reporting, read-only | Yes |
| **F062.6 — Replay and repair** | Authorized, audited operator actions | Yes |

F062.1 deliberately mirrors ADR-026 Slice 1, which is the pattern that worked: contracts first, provably inert, with no transport to get wrong.

---

## Part 17 — Unresolved decisions

1. **Which destination system is first**, and whether its real API documentation is available. **This blocks F062.3 and cannot be worked around** — AGENTS.md forbids inventing undocumented vendor API behaviour, and a connector designed against a guess is worse than none.
2. **Which facts each external system owns** (Part 9) — a product and City decision, not an engineering one.
3. **Whether any flow requires synchronous external processing** during intake, and if so the resident-visible failure contract.
4. **Maximum-pending-age policy** and what happens at expiry: dead-letter, or escalate and hold.
5. **Whether mirrored external state is resident-visible at all**, or staff-only. Part 8 recommends staff-only; this is a product decision.
6. **Secret management for connector credentials**, which depends on the still-open operator-platform secret-manager decision.
7. **The F061 observability interface shape.** Partly answered now that F061 is on `main`: it recommends OpenTelemetry APIs and OTLP as the provider-neutral contract, and independently reaches the same bounded-label conclusion. What remains is confirming the specific integration counter and gauge set, and the no-`organizationId`-label position, with that workstream.
8. **Point-in-time payload retention** for any connector that genuinely needs it (Part 3.2), as a reviewed exception to reference-not-copy.
9. **Whether an ADR is warranted.** **Recommended: yes** — the outbox decision, the authority model and the loop-prevention rule are durable. **No number is allocated here**, per instruction; the implementing slice must inspect the authoritative index and take the next unused number.
10. **Transport choice beyond the in-process worker**, deferred until a scale requirement exists rather than anticipated.

---

## Part 18 — Is implementation ready to begin?

**Partly, and the split is deliberate.**

**Ready now: F062.1 (contracts), and nothing else.** It needs no destination, no credential, no infrastructure and no migration; it is provably inert; and it mirrors a slice pattern this repository has already executed successfully. Its only inputs are decisions already made in ADR-001, ADR-024 and ADR-026.

**F062.1 must remain inert. The boundary is explicit, and each exclusion is testable:**

| F062.1 contains | F062.1 must NOT contain |
| --- | --- |
| Interfaces, types and contracts only | **No outbound network access** of any kind — no HTTP client, no socket, no DNS |
| The envelope type and `contractKind` | **No credentials**, secret reference or configuration that could hold one |
| Closed vocabularies: `eventType`, failure categories, capabilities, lifecycle states, discrepancy outcomes | **No transport** — no broker client, no queue, no worker loop, no scheduler |
| The connector port signature and capability contract | **No migration** and no persistence — no table, no repository, no query |
| The authority-declaration and projection *shapes* | **No worker** or background process |
| A deliberately **empty** connector registry | **No connector implementation**, and no vendor name anywhere |

That inertness should be **asserted by test**, exactly as ADR-026 Slice 1 and the operator platform's boundary suites do: a module-graph assertion that the new code reaches no HTTP client, no database module and no transport, and a registry assertion that it resolves nothing. Those tests are what make "inert" a verified property rather than an intention.

**Not ready: F062.2 and beyond.**

- F062.2 needs new tables, which means new runtime grants and a reviewed migration — and the decision in item 4 above, because a dead-letter policy is part of the schema's meaning.
- **F062.3 is hard-blocked** on item 1: no real connector can be designed without the destination's actual API contract.
- F062.4 onward additionally needs the authority matrix (item 2) and connector secret management (item 6).

**Recommendation: authorize F062.1 only**, and treat items 1, 2 and 6 as the gating questions for everything after it. Building the outbox before knowing what it will deliver to, or to whom, would be building machinery to a guess.

---

## Status

**Assessment complete. Nothing implemented, migrated or provisioned.** No integration code, no migration (count remains 49), no queue, broker or cloud service, no ADR number allocated, no ADR or index modified, and no observability, PIM or serving work touched. **Production deployment remains unauthorized.**

## Related

- [ADR-026 — Outbound notification and delivery architecture](../architecture/decisions/ADR-026-outbound-notification-delivery-architecture.md) — the precedent this generalises
- [ADR-001 — Organization isolation](../architecture/decisions/ADR-001-organization-isolation.md) — composite tenant-safe references
- [ADR-024 — Transaction-time request authorization](../architecture/decisions/ADR-024-transaction-time-request-authorization.md) — one-transaction discipline and revisions
- [ADR-008 — Requester communication](../architecture/decisions/ADR-008-requester-communication.md) — the truthfulness discipline for recorded-not-delivered
- [ADR-010 — Secure attachment architecture](../architecture/decisions/ADR-010-secure-attachment-architecture.md) — current outbound/recorded posture
- [Provider-neutral staff AI gateway](../decisions/ADR-001-provider-neutral-staff-ai-gateway.md) — existing AI adapter posture
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md), [docs/ROADMAP.md](../ROADMAP.md)
