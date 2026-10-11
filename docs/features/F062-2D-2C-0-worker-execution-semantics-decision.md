# F062.2D-2C-0 — Claim lease, ordered delivery and retry readiness decision

> **DESIGN, SECURITY AND OPERATIONS DECISION ONLY. NOTHING IS IMPLEMENTED.**
>
> **NO MIGRATION, FUNCTION, ROLE OR GRANT IS CREATED OR CHANGED.**
>
> **NO WORKER EXISTS, RUNS OR RECEIVES AUTHORITY.**
>
> **`reqro_integration_worker` IS NOT CREATED AND NO `EXECUTE` IS GRANTED.**

This slice resolves the three pre-worker execution blockers F062.2D-2B recorded:
claim lease and expired-claim recovery, per-aggregate serialization for ordered
delivery, and retry eligibility for `retrying` obligations. It adds one
document and changes nothing else: no migration, no `server/src`, no
`deploy/database`, no `server/deploy`, no test, no F061 file, no prior F062
decision document, no ADR. **No ADR number is allocated.**

Baseline: `origin/main` at `b7bbe83f01ba253d996ed5a35807166c8cb35202`, which
carries F062.2D-2B (`30d52b6d663724018b37d47ab9fcf2bfbd615cbc`) as a verified
ancestor, merged as PR #25.

**The headline result is that most of this design already exists in the
repository and did not need inventing.** F062.2D-0 §5/§19 already decided the
ambiguous-recovery contract, F062.2D-0 §21 already decided that in-flight
exclusivity is per `(organization, connector, aggregate_type, aggregate_id)`,
the connector capability vocabulary already carries `supports_ordering`, the
delivery transition graph already carries a capability-gated
`ambiguous -> dispatching` edge, and F062.2D-1A already settled the layered
`min`-precedence policy model. What is genuinely missing is small, and §30 and
§31 enumerate it.

---

## 1. Baseline, read from source

Every value below was read from the repository on this branch, not from a prior
summary.

| Item                   | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| Branch                 | `claude/f062-2d-2c-0-worker-execution-semantics`                      |
| HEAD                   | `b7bbe83f01ba253d996ed5a35807166c8cb35202`                            |
| `origin/main`          | `b7bbe83f01ba253d996ed5a35807166c8cb35202` (fetched, 0 ahead 0 behind) |
| F062.2D-2B ancestor    | `30d52b6` — confirmed merged into `origin/main`                       |
| Working tree and index | clean before editing                                                  |

### 1.1 `integration_outbox` fields

From `20261021000000-add-integration-outbox.ts`:

`id`, `organization_id`, `integration_connector_id`, `integration_id`,
`contract_kind`, `integration_type`, `schema_version`, `aggregate_type`,
`aggregate_id`, `aggregate_revision`, `origin_kind`, `origin_connector_id`,
`correlation_id`, `causation_id`, `deployment_environment`, `payload_mode`,
`pinned_connector_configuration_revision`, `state`, `occurred_at`,
`created_at`.

**Absent, and relevant here:** `next_attempt_at`, `attempt_count`,
`claimed_until`, `claimed_by`, `claim_token`, `requires_ordered_delivery`, any
retry or lease field, any age field. `created_at` is database-assigned
(`clock_timestamp()`) and **immutable** — the F062.2D-2A guard lists it among
the fields an UPDATE may not change, so a lease expiry structurally cannot
reset pending-age history.

### 1.2 `integration_delivery_attempt` fields

From `20261022000000-add-integration-delivery-attempt.ts`:

`id`, `organization_id`, `integration_outbox_id`, `integration_connector_id`,
`attempt_number`, `claim_generation`, `claim_token_digest`,
`connector_configuration_revision`, `capability_snapshot`, `started_at`,
`completed_at`, `outcome`, `failure_category`, `mutation_txid`.

**Absent, and relevant here:** `claim_expires_at` / `claimed_until`,
`dispatch_started_at`, `reason_code`, `retry_eligible`, `idempotency_key_hash`,
`external_reference`, `duration_ms`, `claimed_by`, `renewed_at`.

Three structural facts matter for this decision:

- **`unique (organization_id, integration_outbox_id)` where `completed_at is null`** — the `integration_attempt_open` partial index. At most one open attempt per obligation, so "settle the existing attempt" is the only reachable recovery; inventing a second open attempt is a constraint violation.
- **`claim_generation` already exists and is already separate from `attempt_number`.** Its own comment states the reason: "a future lease renewal or re-claim of an existing attempt can advance ownership without fabricating an attempt."
- **The settle-UPDATE guard lists `claim_generation` among the immutable fields.** So reusing an attempt row with an advanced generation is *not possible today* without changing that guard. §9 turns on this.

`capability_snapshot` is pinned to exactly three keys with closed domains:
`supports_idempotency_key` (bool), `supports_read_after_write` (bool),
`side_effect_risk` in `('none','reversible','irreversible','physical')`.
**`supports_ordering` is not among them** — a gap §30 records.

### 1.3 Current claim function behaviour

`reqro_integration_api.claim_integration_intent(uuid, uuid, text)`, from
Migration 53:

1. Refuses a null Organization or connector; refuses a token shorter than 22 characters or longer than 512.
2. Reads the connector `FOR SHARE`, Organization-qualified. A connector in another Organization, a missing connector and a connector with no work are all **zero rows, no detail**.
3. Returns zero rows unless `lifecycle_state in ('active','degraded')` — F062.1 `dispatchingLifecycleStates`.
4. Selects **one** obligation with `state = 'pending'` and **no open attempt**, ordered by `created_at, id`, `FOR UPDATE SKIP LOCKED LIMIT 1`.
5. Loads the pinned audit snapshot; raises if it is missing.
6. Inserts an attempt omitting `attempt_number` and `claim_generation` (the guard assigns both), storing only the SHA-256 hex digest of the raw token.
7. `pending -> dispatching`.
8. Returns a bounded 20-column descriptor: no raw token, no digest, no `credential_reference`, no payload, no vendor metadata.

**No lease is set, no `retrying` obligation is eligible, and no aggregate
ordering is enforced.** Eligibility is `pending` only.

### 1.4 Current completion function behaviour

`reqro_integration_api.complete_integration_attempt(uuid, uuid, uuid, bigint, text, varchar, varchar)`:

1. Validates the outcome against the four F062.1 `attemptOutcomes`.
2. Requires a null category for `succeeded`, and otherwise one of the ten closed `integrationFailureCategories`.
3. Enforces **both halves** of F062.1's classification: `failed_transient` only with `destination_unavailable` or `rate_limited`; `destination_timeout` only as `ambiguous`.
4. One fenced `UPDATE` carrying Organization, obligation, attempt, openness, `claim_generation` and token digest as predicates — **no check-then-act window**. Zero rows returns a deliberately undifferentiated `false`.
5. Maps the outcome to a state: `succeeded -> accepted`, `failed_transient -> retrying`, `failed_permanent -> failed_permanent`, `ambiguous -> ambiguous`. Total over four outcomes; reaches none of `dead_lettered`, `acknowledged`, `refused`.
6. Updates the obligation only from `dispatching`, raising otherwise so nothing is left half-settled.

**No retry time is scheduled**, so a `retrying` obligation today is inert.

### 1.5 Current claimable delivery states

**`pending` only.** `retrying` is deliberately unclaimable (no approved
backoff), `ambiguous` is unclaimable (operator judgement), and a `dispatching`
obligation with an open attempt is skipped by the `not exists` predicate and by
`integration_attempt_open`.

### 1.6 Current transition graph

Database-enforced in the F062.2D-2A outbox guard, mirroring F062.1
`deliveryStateTransitions`:

| From               | To                                                                 |
| ------------------ | ------------------------------------------------------------------ |
| `pending`          | `dispatching`, `refused`                                           |
| `dispatching`      | `accepted`, `retrying`, `ambiguous`, `failed_permanent`, `dead_lettered` |
| `retrying`         | `dispatching`, `dead_lettered`                                     |
| `accepted`         | `acknowledged`                                                     |
| `ambiguous`        | `dispatching`, `accepted`, `failed_permanent`, `dead_lettered`     |
| `acknowledged`     | — terminal                                                         |
| `failed_permanent` | — terminal                                                         |
| `dead_lettered`    | — **no outgoing edge at all**                                      |
| `refused`          | — terminal                                                         |

Two edges carry a capability precondition read from the **pinned** snapshot,
not the connector's current row:

- `accepted -> acknowledged` requires `reports_terminal_state`;
- **`ambiguous -> dispatching` requires `supports_idempotency_key`.**

**That second edge is the single most important baseline fact in this
document.** The repository already has an approved, capability-gated path for
re-attempting an ambiguous delivery. Ambiguity recovery does not need a new
state, a new edge or a new capability — only the evidence and the policy to
drive the existing edge.

### 1.7 Current connector capability vocabulary

From `integration_connector` and, identically, from
`integration_connector_audit` (so every capability is pinnable per revision):

| Capability                    | Domain                                                    |
| ----------------------------- | --------------------------------------------------------- |
| `operations`                  | subset of `createRequest`, `getRequest`, `getRequestStatus`, `updateRequest`, `addAttachment`; cardinality 0–5 |
| `supports_idempotency_key`    | boolean                                                   |
| `supports_read_after_write`   | boolean                                                   |
| `supports_reconciliation`     | boolean                                                   |
| `supports_webhook_callback`   | boolean                                                   |
| **`supports_ordering`**       | **`none` \| `per_aggregate`**                             |
| `supports_update`             | boolean                                                   |
| `supports_cancel`             | boolean                                                   |
| `supports_delete`             | boolean                                                   |
| `supports_current_state_sync` | boolean                                                   |
| `reports_terminal_state`      | boolean                                                   |
| `side_effect_risk`            | `none` \| `reversible` \| `irreversible` \| `physical`     |

Lifecycle: `configured`, `active`, `degraded`, `disabled`, `retired`.

**`supports_ordering` already exists with exactly the two values this decision
needs.** §11 therefore identifies no missing ordering contract at the
capability layer — only missing *enforcement*.

### 1.8 Clock convention

**`clock_timestamp()` is the sole convention**: 16 uses across the four
integration migrations, and **zero** uses of `now()`,
`transaction_timestamp()` or `CURRENT_TIMESTAMP`. §28 preserves this.

---

## 2. Four clocks, kept separate

These four answer different questions and are deliberately not interchangeable.
Conflating any two of them is how a safety bound becomes bypassable.

| Clock                           | Question it answers                                            | Origin                                          | Owner                         | Resettable                                                 |
| ------------------------------- | -------------------------------------------------------------- | ----------------------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| **A. Pending age**              | How long has this obligation waited to be delivered at all?    | `integration_outbox.created_at`                 | F062.2D-1A — **not redesigned here** | **Never.** `created_at` is immutable by guard         |
| **B. Retry delay**              | When does a `retrying` obligation become eligible to be claimed again? | proposed `next_attempt_at` (§16, §30)   | platform baseline + connector | per settlement, recomputed forward only                     |
| **C. Claim lease lifetime**     | Is the current claimant's exclusive ownership still trustworthy? | proposed `claim_expires_at` on the attempt (§4) | platform + connector policy   | only by renewal, which §6 recommends against initially      |
| **D. Total obligation lifetime** | Has this obligation existed too long to remain automatically actionable? | `created_at`, with F062.2D-1A exclusions | F062.2D-1A platform ceiling   | **Never**                                                  |

### 2.1 Pending age — governed elsewhere, not redesigned

F062.2D-1A owns it. This decision restates only the three of its rules that
constrain the design below, and changes none of them:

- **Eligible age excludes every `disabled` interval**, reconstructed from the connector audit timeline. Disabling is an outage, not a discard.
- **Eligible age accrues while `degraded`** and **accrues during a genuine destination outage** — that is the central case the ceiling exists for.
- **The effective ceiling is the strictest of all layers.** `min`, never last-write-wins; "unset" inherits and never means unlimited.

### 2.2 The invariant that binds them

> **A lease expiry must never reset pending-age history, and a retry must never
> reset total obligation lifetime.**

This is already structurally guaranteed rather than merely stated:
`integration_outbox.created_at` is immutable by the F062.2D-2A guard, and every
proposed field below is additive. **No proposal in this document writes,
clears or recomputes `created_at`.**

---

## 3. What a claim lease protects

> **A lease answers exactly one question: _which worker currently owns the
> right to attempt this obligation?_**
>
> **A lease never means "the external side effect has not occurred."**

That distinction is the whole reason F062.2D-2B refused to implement recovery.
Ownership is a fact the database can know with certainty, because the database
issues it. Whether bytes reached a destination is a fact the database cannot
know at all unless something durably records it — which is §7.

| A lease **is**                                         | A lease is **not**                                           |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| An exclusivity grant with a database-authored deadline  | Evidence about the external world                            |
| The basis for fencing a stale claimant out of settlement | A guarantee the claimant is alive                           |
| A bound on how long one obligation may be held in-flight | A bound on how long a destination call may take             |
| Recoverable, because ownership is Reqro's to reassign    | A licence to retry, which depends on side-effect evidence    |

### 3.1 When the lease begins

**Recommendation: the lease begins when the attempt row is inserted, and its
start is the existing `integration_delivery_attempt.started_at`.**

- `started_at` is already assigned by the F062.2D-2A guard as `clock_timestamp()`, already immutable across the settle UPDATE, and already the moment the claim became exclusive.
- Claim success and attempt-open are the same instant: `claim_integration_intent` inserts exactly one attempt per claim, inside one statement.
- **No `claimed_at` column is needed.** Adding one would duplicate `started_at` and create two values that could disagree.

**Caller wall-clock time is refused.** Every durable timestamp in this design is
written by the database with `clock_timestamp()`, and every comparison happens
on the database's clock. A worker-supplied time is accepted nowhere, for
anything.

---

## 4. Lease fields — the minimum model

Evaluated against the standing requirement to prefer the smallest model that
can be proven safe.

| Candidate            | Required?                 | Authority | In fencing? | Mutable                       | Audit evidence retained                   |
| -------------------- | ------------------------- | --------- | ----------- | ----------------------------- | ----------------------------------------- |
| `claimed_at`         | **No — already exists**   | database  | no          | immutable                     | `started_at`, unchanged                   |
| **`claim_expires_at`** | **Yes**                 | database  | **yes**     | write-once at claim; §6 defers renewal | retained on the settled attempt row |
| `claim_generation`   | **No — already exists**   | database  | **yes**     | immutable per row             | already retained                          |
| `claimed_by`         | **No**                    | —         | —           | —                             | —                                         |
| `renewed_at`         | **No — deferred**         | —         | —           | —                             | —                                         |
| `heartbeat_at`       | **No — rejected**         | —         | —           | —                             | —                                         |

### 4.1 `claim_expires_at` — the one new lease field

**Required**, because nothing in the schema currently distinguishes a live
claim from an abandoned one. Today an obligation whose claimant died stays
`dispatching` with an open attempt forever.

- **Authority: database.** Computed as `started_at + <approved policy interval>` inside the claim function, from policy the function reads — never from a caller-supplied interval. §5.
- **Participates in fencing: yes, but only as a recovery precondition.** It must *not* join the completion fence. A live worker that finishes one millisecond after expiry has still genuinely delivered, and refusing its settlement would discard the truest evidence in the system and manufacture ambiguity. `claim_generation` plus the token digest already fence correctly; expiry governs *recovery*, not settlement. §8.4 resolves the resulting race in full.
- **Mutable: no, in the recommended model.** Written once at claim. §6.
- **Evidence: retained.** It stays on the settled attempt row, so "this attempt was recovered after its lease expired at T" remains permanently reconstructable.

### 4.2 Why `claimed_by` is rejected

A worker identity label would be either unbounded free text or a value a worker
chooses for itself. It adds no safety — `claim_generation` and the token digest
already answer "is this the current claimant?" with cryptographic rather than
nominal evidence — and it creates a label that could leak a hostname into
evidence. F061's label policy already forbids hostnames in telemetry; this
keeps the same discipline in persistence. **Operational attribution belongs in
bounded telemetry, not in a tenant-scoped evidence row.**

### 4.3 Why no heartbeat column

A heartbeat is a liveness signal that must be written frequently, which turns a
low-write evidence table into a high-write one and puts a per-dispatch write
amplification on the hot path. It is also unnecessary under §6's recommendation.
**Rejected on both grounds.**

---

## 5. Lease duration ownership and precedence

> **No numerical duration is chosen here.** Every value remains provisional
> until the first real connector's API contract is reviewed, exactly as
> F062.2D-0 §17 already recorded.

### 5.1 Who owns the policy

| Layer                           | Owner                                       | May it widen a stricter bound? |
| ------------------------------- | ------------------------------------------- | ------------------------------ |
| **Platform ceiling**            | Reqro platform, security and operations     | —                              |
| **Integration-type policy**     | Reqro product + platform                    | **No**                         |
| **Connector policy**            | Deployment / client operations              | **No**                         |
| **Operation-specific override** | **Deferred — see §5.3**                     | **No**                         |
| **The worker**                  | **Nothing. No authority at any layer.**     | **No**                         |

### 5.2 Recommended precedence

**Adopt F062.2D-1A's model unchanged**, because an identical rule applied to a
second quantity is far safer than a second rule:

> **The effective lease is the strictest of all layers that define one. `min`,
> never last-write-wins. "Unset" inherits downward to the platform ceiling and
> never means unlimited.**

Two consequences stated explicitly:

- **"Unlimited" is unreachable by configuration.** There is no path — unset, null, zero or omitted — that yields an unbounded lease. An unset layer falls through to the platform ceiling, which is always a finite number.
- **A floor is required as well as a ceiling.** F062.2D-0 §17 establishes that the total request budget must be **strictly less** than the lease, because a lease shorter than a legitimate dispatch fences a live worker mid-call, recovery marks a healthy delivery ambiguous, and a capability permitting retry then produces a genuine duplicate from an entirely healthy dispatch. **A lease that is too short is a more dangerous misconfiguration than one that is too long**, and the schema must therefore refuse a lease below the configured total request budget rather than accept it and fence live work.

### 5.3 Operation-specific override — deferred

`operations` is a bounded five-value set, so a per-operation lease is
expressible. It is nonetheless **deferred**: no connector exists, no operation
has a measured latency profile, and a per-operation matrix multiplies the
configuration surface by five before a single real number is known. Revisit
when a real connector's per-operation timeouts are documented.

### 5.4 The worker never chooses

**`claim_integration_intent` must not accept a lease or interval parameter.**
Note that F062.2D-0 §12's sketch listed the signature as
`claim_integration_intent(connector, lease, worker_label)` — **that sketch is
superseded here.** A caller-controlled lease lets an untrusted worker grant
itself an effectively unlimited claim, and a caller-controlled label adds an
unbounded string. The implemented F062.2D-2B signature already takes neither,
and the enhancement in §31 keeps it that way.

---

## 6. Lease renewal

| Model                             | Assessment                                                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. No renewal** — one bounded lease | **RECOMMENDED for the first implementation.**                                                                                                   |
| B. Explicit heartbeat / renewal   | Deferred. Safe only under the five constraints below, and unnecessary until a long-running operation exists                                          |
| C. Operation-specific renewal     | Rejected for now — strictly more surface than B with no additional capability                                                                       |

### 6.1 Why no renewal is the right starting point

**The lease already strictly exceeds the total request budget (§5.2), so a
legitimate dispatch fits inside one lease by construction.** Renewal exists to
serve dispatches that legitimately outlive a bounded request budget — a
long-running destination job, a polled asynchronous operation — and **no
declared capability describes one.** `operations` is five synchronous
request/response operations; `supports_webhook_callback` describes an inbound
callback, which is a separate inbound slice, not a long-held claim.

Adding renewal now would therefore add a mutable fencing-adjacent field, a new
function, a new grant and a new cumulative-bound policy to serve a case that
does not yet exist. **That is the definition of speculative design, which
F062.2A already ruled out for indexes and which applies with more force to a
security-relevant mutable field.**

### 6.2 If renewal is later adopted, these five constraints are mandatory

Recorded now so a future slice inherits them rather than rediscovering them:

1. **Only the current generation and token holder may renew.** The renewal function must carry the same full fencing predicate as completion — Organization, obligation, attempt, openness, `claim_generation`, token digest — in **one** statement. A renewal with a check-then-act window is a lease-stealing primitive.
2. **Renewal must not change attempt identity.** Not `id`, not `attempt_number`, not `claim_generation`, not `claim_token_digest`, not `started_at`, not the pinned revision or capability snapshot. Only `claim_expires_at` moves, and only forward.
3. **Renewal must not erase original claim time.** `started_at` stays. "This claim has been held since T" must remain answerable after any number of renewals, because that is the quantity every ceiling is measured against.
4. **Renewal must have a bounded cumulative limit.** Either a maximum renewal count, a maximum total held duration, or an absolute horizon from `started_at`. **Unbounded renewal is indefinite ownership**, which lets one worker hold an obligation forever and makes the lease decorative.
5. **A dead worker must eventually lose ownership regardless.** The cumulative bound must be enforced database-side, so a worker that renews in a tight loop and then dies still expires.

And one rule that is not negotiable:

> **Renewal must never extend an obligation past the F062.2D-1A pending-age
> platform ceiling.** A renewal loop that outlived the age ceiling would be a
> configuration-free bypass of §19's guarantee that nothing stays automatically
> actionable forever.

---

## 7. The side-effect boundary

> **This is the question F062.2D-2B could not answer, and the reason recovery
> was blocked. It is answerable with one nullable timestamp.**

### 7.1 The problem, precisely

Today every open attempt is **externally ambiguous**. The schema records that a
claim was issued and nothing about whether the worker got as far as contacting
the destination. So an expired lease is indistinguishable between "the worker
died three milliseconds after claiming, having done nothing" and "the worker
transmitted a `createRequest` and died waiting for the response." The first is
trivially safe to retry; the second may already have created a work item.
**Because the two are indistinguishable, the conservative reading must apply to
both**, which is exactly what F062.2D-0 §19 decided and why all recovery today
would have to produce `ambiguous`.

### 7.2 The recommended boundary — one write-once timestamp

**Recommendation: add `integration_delivery_attempt.dispatch_started_at
timestamptz null`, write-once, database-stamped, monotonic.**

| Value        | Meaning                                                    | Recovery consequence                      |
| ------------ | ---------------------------------------------------------- | ----------------------------------------- |
| **`null`**   | **PRE-DISPATCH.** No external call was ever begun          | Automatic recovery is **safe** (§8)       |
| **non-null** | **POSSIBLY-DISPATCHED / OUTCOME-UNKNOWN.** A call may have been transmitted | Automatic blind retry is **forbidden** (§8) |

This is **attempt-phase evidence, not a delivery state**, exactly as the
authorization anticipated. It adds no delivery state, no transition edge, no
capability and no reason code to the F062.1 vocabulary. The obligation stays
`dispatching` throughout; only the attempt gains a phase marker.

### 7.3 Why this is sound, and the one rule that makes it sound

The marker is only meaningful if it is **durably committed before the first
byte can leave the process.** The worker's protocol must therefore be:

```
tx1:  claim_integration_intent(...)                 -> commit
tx2:  mark_integration_dispatch_started(...)        -> commit   <-- the boundary
      [ external call may now begin ]
tx3:  complete_integration_attempt(...)             -> commit
```

> **A worker may not transmit anything to a destination until its
> dispatch-started marker is committed. That ordering is the entire safety
> property, and it must be stated as a worker obligation in F062.2D-3 and
> proven by the loopback slice.**

The failure mode is one-directional and that is deliberate:

- Worker dies **between tx2 and the send**: marker set, nothing transmitted. Recovery treats it as possibly-dispatched and produces `ambiguous`. **A false ambiguity — conservative, safe, and the acceptable error.**
- Worker dies **before tx2 commits**: marker absent, so nothing can have been transmitted, because the protocol forbids transmitting first. **Provably pre-dispatch.**

**The unsafe direction — transmitted but unmarked — is impossible by protocol
rather than unlikely by timing.** No elapsed-time reasoning is involved
anywhere.

### 7.4 Finer phases, evaluated and rejected

The authorization lists six candidate phases. Mapping them to the minimum
boundary:

| Candidate phase                        | Needs its own durable field?                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| Claim acquired, no external call started | **No** — this is `dispatch_started_at is null`                                 |
| External call about to start           | **No** — this *is* the marker. "About to start" and "may have started" must be the same durable state, or the gap between them is exactly the unsafe window |
| External request transmitted           | **No, and deliberately not.** A worker cannot durably record "transmitted" before transmitting, and recording it after is unreliable precisely when it matters — the crash case. A field that is accurate only when nothing went wrong is worse than no field |
| Transport returned timeout after send  | **No** — that is a settled outcome: `ambiguous` + `destination_timeout`, already enforced |
| Destination acknowledged               | **No** — `succeeded -> accepted`, and `accepted -> acknowledged` where `reports_terminal_state` |
| Outcome ambiguous                      | **No** — `ambiguous`, already in the vocabulary                                 |

**One field, two states. Everything else is already expressible.**

### 7.5 The `side_effect_risk` interaction

`capability_snapshot.side_effect_risk` is already pinned per attempt with
domain `none | reversible | irreversible | physical`. It does not replace the
dispatch boundary — it **modulates what may be done after one**:

- `side_effect_risk = 'none'` (a loopback or pure read): a possibly-dispatched expiry is far less consequential, and a reviewed policy **may** permit automatic retry even without idempotency support.
- `irreversible` or `physical`: a possibly-dispatched expiry must never be blind-retried, whatever the lease says. **`physical` — a dispatched crew, a printed notice — is unrecoverable by definition and should additionally require operator disposition rather than capability-gated automatic retry.**

**Recommendation: make the `ambiguous -> dispatching` automatic path
conditional on `side_effect_risk <> 'physical'` in addition to
`supports_idempotency_key`.** This is a tightening of an existing edge's
policy, not a new edge.

---

## 8. Safe automatic recovery

### 8.1 The rule

| Precondition                                                                 | Automatic recovery                                                                                         |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Lease expired **and** `dispatch_started_at is null`                          | **PERMITTED.** Settle the open attempt as a pre-dispatch failure; obligation `dispatching -> retrying`; schedule `next_attempt_at` by policy |
| Lease expired **and** `dispatch_started_at is not null`                      | **FORBIDDEN as a blind retry.** Settle the open attempt as `ambiguous` with `lease_expired_uncertain`; obligation `dispatching -> ambiguous` |
| Lease not expired                                                            | **No recovery.** The claim is live, whatever the worker is doing                                            |

The second row is **exactly F062.2D-0 §19 and F062.2D-1 §9.1, unchanged**. This
decision does not relax it; it carves out the one case that is provably outside
it. The obligation **never** returns silently to `pending` in either row.

### 8.2 Elapsed time never erases uncertainty

Stated as a flat prohibition, because it is the single most tempting unsafe
shortcut in this whole design:

> **No duration, however long, may convert `ambiguous` into
> retryable-as-transient. An ambiguous attempt leaves `ambiguous` only through
> the existing capability-gated `ambiguous -> dispatching` edge, or through
> `accepted` on reconciliation evidence, or through `failed_permanent` or
> `dead_lettered` under operator authority. There is no fifth exit and no
> timer.**

### 8.3 What the possibly-dispatched case preserves

| Preserved        | How                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Ambiguity        | The obligation sits in `ambiguous`, a first-class state, surfaced by `integration_ambiguous_count`                              |
| Idempotency      | Re-attempt only where the **pinned** snapshot declares `supports_idempotency_key`, enforced today by the F062.2D-2A guard        |
| Read-after-write | Where the pinned snapshot declares `supports_read_after_write`, a reconciliation read may resolve ambiguity to `accepted` without re-mutating |
| Reconciliation   | Where `supports_reconciliation` is declared; §25                                                                                |
| Operator review  | Always available, and the only path for a connector declaring none of the three; §26                                            |

**A connector declaring no idempotency, no read-after-write and no
reconciliation has exactly one honest recovery path: a human.** That is a
correct and intentional outcome, not a gap.

### 8.4 Lease expiry versus generation rollover — the race, resolved

> ### Expiry authorizes recovery; successful generation rollover fences the stale claimant.

**Claim expiry alone does not invalidate settlement.** This is the rule, and it
is deliberately not symmetric with recovery:

| Condition                                                                                              | May the current claimant still settle? |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `claim_expires_at` has passed, **no recovery has succeeded**, and the same generation and token remain current | **YES.** It records the genuine outcome |
| Recovery has succeeded, so ownership has rolled over                                                   | **NO.** The stale claimant is fenced   |

### Why a late-but-genuine completion must be accepted

A worker that returns at `expiry + 1ms` holding a real destination response has
the **truest evidence in the system**. Rejecting it on a clock test would
discard an observed fact and replace it with manufactured ambiguity — inventing
operator work out of a healthy delivery, and in the worst case inviting a
duplicate where the capability permits retry. **That is strictly worse than
accepting a slightly late settlement.**

This is why §4.1 keeps `claim_expires_at` **out of the completion fence**.
Expiry is a precondition for *recovery*, never a predicate on *settlement*.

### The fence that actually catches a stale claimant

Precisely, because the mechanism matters more than the slogan: under §9's
Option B, recovery **settles** the open attempt rather than relabelling it, so
a stale claimant is fenced in **two layers**, and the first is the one that
fires:

1. **`completed_at is null` fails.** Recovery closed that attempt, and the existing completion fence already requires openness. **This is the layer that fences the stale worker, and it is already implemented and tested in F062.2D-2B.**
2. **Generation rollover.** The next claim creates a **new** attempt with the next `claim_generation` and a fresh token, so ownership of the obligation has genuinely moved. A stale worker's `expected_claim_generation` and token digest now match no open row at all.

Both layers return the same deliberately undifferentiated `false`, so a stale
claimant cannot distinguish "I was recovered" from "I had the wrong token".

### The race window, bounded exactly

Recovery and a late settlement can genuinely collide. The collision is safe
because **both contend for the same row under the same lock**, and exactly one
wins:

- **Settlement commits first:** the attempt is closed with the real outcome. Recovery's own fence requires `completed_at is null`, so it matches zero rows and does nothing. **The genuine outcome stands.**
- **Recovery commits first:** the attempt is closed as recovered. The late settlement matches zero rows and returns `false`. The worker's outcome is lost to ambiguity — scenario §10 E, and an acknowledged residual risk (§35.1) rather than a correctness defect.

There is no interleaving in which both succeed, and none in which the row is
left half-settled: each is a single fenced `UPDATE`.

### The prohibition this preserves

> **No elapsed-time test may erase a genuine completion result.** Expiry
> permits recovery to *attempt* to take ownership; it never, on its own,
> invalidates an outcome a worker actually observed. A completion is refused
> only because ownership demonstrably moved — never because a clock passed.

---

## 9. Recovery generation — attempt reuse versus a new attempt

| Option                                                              | Auditability                                                                                      | Fencing                                                                           | Verdict         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------- |
| **A. Reuse the same attempt row, advance `claim_generation`**       | **Poor.** Overwrites the generation that produced the possible side effect, so the evidence stops being attributable to the dispatch that caused it | Sound in principle, but requires making a fencing field mutable                   | **Rejected**    |
| **B. Settle the old attempt; a later claim creates a new attempt**  | **Strong.** Every claim keeps its own immutable row, digest, pinned revision, capability snapshot and dispatch marker | Sound, and requires no change to any immutability rule                            | **RECOMMENDED** |

### 9.1 Why B

Four reasons, the first two decisive:

1. **A is not possible today without weakening an accepted guard.** The F062.2D-2A settle-UPDATE explicitly refuses any change to `claim_generation`, `claim_token_digest`, `attempt_number`, `started_at` or the pinned snapshot. Option A requires making `claim_generation` mutable — turning an immutable fencing field into a mutable one to save a row. **That is a direct weakening of an established protection.**
2. **Evidence must stay attributable.** If generation 1 may have transmitted a `createRequest` and the row is then relabelled generation 2, the system has destroyed the record of which dispatch could have caused the external effect. F062.1 `mayEraseEvidence()` returns `false`; overwriting is erasure by another name.
3. **B is already what F062.2D-0 §19 decided**: "the ambiguous attempt is settled first, because that is what happened; the retry is a new attempt with the next number."
4. **B needs no new uniqueness reasoning.** `integration_attempt_open` permits a new open attempt the instant the old one is settled, and both `unique (org, outbox, attempt_number)` and `unique (org, outbox, claim_generation)` are satisfied by monotonic assignment the guard already performs.

### 9.2 The recovery sequence

Recovery **settles only**. It does not re-claim:

1. Fence on expiry: the open attempt for this obligation with `claim_expires_at < clock_timestamp()`.
2. Settle it — outcome by the §8 rule, `completed_at = clock_timestamp()`, preserving `claim_generation`, `claim_token_digest`, `started_at`, `dispatch_started_at` and the pinned snapshot untouched.
3. Move the obligation: `dispatching -> retrying` (pre-dispatch) or `dispatching -> ambiguous` (possibly-dispatched).
4. For the pre-dispatch case, set `next_attempt_at` from policy (§16, §18).
5. **Stop.** The next ordinary claim creates the next attempt with the next `attempt_number` and `claim_generation`, under the ordinary eligibility rules.

**The stale claimant cannot settle afterwards**, because the attempt is now
closed and the fence already requires `completed_at is null`. It receives
`false` — undifferentiated, leaking nothing. **No token is ever reused**: each
claim mints a fresh token whose digest is stored on its own row.

---

## 10. Worker crash scenarios

Assuming the §7.3 protocol. "Evidence" means what is durably in the database.

| # | Scenario                                                   | Durable evidence                                                                | Automatic recovery           | Result ambiguous? | Operator or reconciliation needed                   |
| - | ---------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------- | ----------------- | --------------------------------------------------- |
| **A** | Dies after claim, before any external I/O                  | Open attempt, `dispatch_started_at is null`, lease expires                      | **Yes** — `retrying`         | **No**            | No                                                  |
| **B** | Dies immediately before send (marker committed)            | Open attempt, marker **set**, lease expires                                     | No — settles `ambiguous`     | **Yes**           | Per §8.3; capability-gated re-attempt or a human    |
| **C** | Dies after bytes may have been transmitted                 | Identical to B — and **indistinguishable by design**                            | No — settles `ambiguous`     | **Yes**           | Same as B                                           |
| **D** | Destination accepted, Reqro never recorded success          | Open attempt, marker set, lease expires. **The worst case**                      | No — settles `ambiguous`     | **Yes**           | **Yes.** Read-after-write or reconciliation should resolve to `accepted` via the existing `ambiguous -> accepted` edge, *not* a retry |
| **E** | Loses DB connectivity while the destination call runs       | Open attempt, marker set. Settlement cannot be written, so the lease expires     | No — settles `ambiguous`     | **Yes**           | Same as D. **Note:** the worker may still hold a correct outcome it cannot persist. §25 |
| **F** | Process hangs but the lease expires                        | Open attempt, marker state as reached                                           | Per marker — A's rule or B's | Per marker        | Per marker                                           |
| **G** | Worker resumes after another generation took ownership      | Its attempt is settled; a newer attempt may exist                               | n/a                          | n/a               | No. Its `complete_integration_attempt` returns `false` and mutates nothing — **already proven by F062.2D-2B's fencing tests** |

**B and C are deliberately indistinguishable.** Distinguishing them would
require a durable write *between* "about to send" and "sent", and no such write
can be made reliably by a process that is about to crash. **Collapsing them to
the conservative answer is the correct engineering decision, not a limitation.**

Scenario **D** is the case that justifies `supports_read_after_write` and
`supports_reconciliation` existing as capabilities at all: it is resolved by
*looking*, never by *retrying*.

---

## 11. Aggregate ordering objective

### 11.1 Does the repository already express ordering? Yes

**`supports_ordering` already exists** on both `integration_connector` and
`integration_connector_audit`, with domain exactly `('none','per_aggregate')`.
It is therefore already per-connector and already pinnable per configuration
revision. **No new capability contract is required, and none should be
invented.**

### 11.2 What ordering means, by dimension

| Dimension             | Ordering required?                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Organization          | **No.** Cross-tenant ordering is meaningless and a per-Organization serialization point would be a tenant-scale bottleneck   |
| Connector             | **No.** Connector-wide ordering would serialize all delivery to one destination — a global head-of-line block by another name |
| Integration type      | **No.** Two unrelated aggregates' status changes have no ordering relationship                                              |
| **Aggregate identity** | **Yes, where declared.** `(organization_id, integration_connector_id, aggregate_type, aggregate_id)` — exactly F062.2D-0 §21 |
| Operation stream      | **No, and deliberately not.** Ordering per `(aggregate, operation)` would let an `updateRequest` overtake the `createRequest` it depends on — the precise bug ordering exists to prevent |

**Recommended ordered-stream key:
`(organization_id, integration_connector_id, aggregate_type, aggregate_id)`,
applied only where the pinned snapshot declares
`supports_ordering = 'per_aggregate'`.**

Tenant safety is structural: `organization_id` leads the key, so no stream can
span Organizations, and the connector is included so two connectors serving the
same aggregate progress independently — a fan-out to two destinations must not
make one destination's backlog block the other's.

### 11.3 Ordering within a stream

Order by **`aggregate_revision`, then `created_at`, then `id`** —
`aggregate_revision` first because it is the aggregate's own causal sequence and
the only field that genuinely orders two mutations of one aggregate;
`created_at` as the tiebreak for `state_sync` intents, whose
`aggregate_revision` is nullable; `id` last for total determinism.

**Note the divergence from today:** Migration 53 orders by `created_at, id`
only. That is correct for an unordered connector and insufficient for an
ordered one, so the §31 claim enhancement must order by `aggregate_revision`
first. Recorded as a deliberate change, not an oversight.

---

## 12. Serialization-point options

### Option A — advisory locks

| Aspect                | Assessment                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope                 | Transaction-scoped (`pg_try_advisory_xact_lock`) releases on commit or crash — correct. Session-scoped leaks on a pooled connection          |
| Crash behaviour       | **Good** — transaction-scoped locks vanish with the backend                                                                                 |
| Key design            | **The decisive flaw.** The key space is two `int4` or one `int8`, and the ordering key is four values including two UUIDs. Any mapping is a hash, and **a hash collision silently serializes two unrelated aggregates** — a correctness-affecting, invisible, intermittent bug |
| Connection lifecycle  | Fragile under pooling: the lock must be held by the same backend for the claim's whole transaction                                            |
| Observability         | **Poor.** `pg_locks` shows integers. An operator cannot answer "which aggregate is blocked?"                                                 |
| Auditability          | **None.** Locks leave no durable evidence that an obligation was ever blocked                                                                |
| **Verdict**           | **Rejected.** Collision risk plus zero auditability                                                                                          |

### Option B — a durable aggregate coordination table

A new `integration_delivery_stream` row per ordered aggregate, locked `FOR UPDATE`.

| Aspect            | Assessment                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| Row locking       | Sound and exact — no hashing                                                                                    |
| Tenant-safe key   | Sound — `organization_id` leads, composite FK to the connector                                                   |
| Lifecycle         | **The flaw.** Who creates a stream row, and when? Lazily at claim means an upsert race; eagerly at enqueue means the outbox guard writes a second table |
| Cleanup           | **Unresolved.** Rows accumulate per aggregate forever, or need a reaper — new machinery, new failure mode        |
| Contention        | Acceptable — one row per aggregate                                                                               |
| Orphan behaviour  | Streams outlive their obligations and become unreferenced garbage                                                |
| **Verdict**       | **Rejected as unnecessary.** It is the right shape for a *queue position* model, but ordering here needs only mutual exclusion, and Option E achieves that with no new table and no lifecycle |

### Option C — lock an existing durable row

The only rows guaranteed to exist and be common to a whole ordered stream are
the **connector** and the **Organization**. Both are *too coarse by exactly the
amount that matters*: locking either serializes every aggregate on that
connector or tenant, which is the global serialization point §14 forbids.
**There is no existing per-aggregate row.** Rejected — and specifically
rejected on the authorization's own grounds, that a row must not be chosen
merely because it exists.

### Option D — no strict ordering

**Correct and recommended wherever the pinned snapshot declares
`supports_ordering = 'none'`**, which is the column default. Such a connector
has declared that it does not need ordering; imposing it would reduce
throughput and add head-of-line blocking for no contract benefit. **This is not
a weaker fallback — for most connectors it is the right answer**, and the
default must stay `none` so ordering is opt-in by declaration.

### Option E — a partial unique index on the obligation itself (RECOMMENDED)

Not among the listed options, and strictly better than all four, so it is
proposed explicitly.

```
-- Conceptual. Not implemented in this slice.
unique index on integration_outbox
  (organization_id, integration_connector_id, aggregate_type, aggregate_id)
  where state in ('dispatching', 'ambiguous')
    and requires_ordered_delivery
```

| Property                | Why it wins                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Atomic by construction** | This is the point. F062.2D-2B's blocker was that two claimants taking *different* obligations for one aggregate each see the other's uncommitted state as absent. A unique index is evaluated by the index itself: the second `UPDATE ... SET state='dispatching'` **blocks on the first's uncommitted index entry and then fails**. There is no check-then-act window because there is no check |
| **No new table, no lifecycle, no cleanup** | The coordination state *is* the obligation's own `state` column                                                                                      |
| **Exact key, no hashing** | Four real columns. No collisions                                                                                                                                  |
| **Poison isolation, free** | Including `ambiguous` in the predicate means an unresolved ambiguity holds that aggregate's slot and **no other aggregate's** — precisely F062.2D-0 §21.3        |
| **Auditable**           | The blocking obligation is a queryable row, and an operator can ask "what is blocking aggregate X?" in SQL                                                           |
| **Observable**          | Ordered-stream backlog is a `count(*)`, which is what §27's proposed metrics need                                                                                     |
| **Matches established idiom** | `integration_attempt_open` is already exactly this pattern, and Migration 53 already pairs it with a `not exists` pre-filter so the common case is a clean skip and the index is the authoritative backstop |

**Recommendation: Option E, paired with a `not exists` pre-filter in the claim
query for graceful skipping, and Option D wherever `supports_ordering = 'none'`.**

### 12.1 The one field Option E needs

A partial index cannot join to another table, so the ordering requirement must
be **on the obligation row**: `requires_ordered_delivery boolean not null`,
**pinned at enqueue** from the pinned audit snapshot's `supports_ordering`, and
immutable thereafter.

Pinning rather than re-reading is deliberate and consistent with every other
semantic in F062: an administrator switching a connector from `per_aggregate` to
`none` must not retroactively unblock obligations that were enqueued under an
ordering promise, and the reverse switch must not retroactively block
in-flight work that was enqueued without one.

### 12.2 The index is mutual exclusion ONLY

> **Stated prominently because it is the most dangerous thing to misread in
> this document: the partial unique index provides MUTUAL EXCLUSION and nothing
> else. It does not provide FIFO sequence. Strict ordering requires a second,
> independent control.**

The index guarantees that at most one obligation per ordered stream is
`dispatching` or `ambiguous` at a time. It says nothing about *which* one, and
nothing about sequence. §13 supplies the sequence control, and the two must be
implemented and reviewed as **two separate controls with two separate failure
modes**:

| Control                        | Guarantees                                                      | Fails by                                                       |
| ------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------- |
| **Partial unique index**       | At most one in-flight or ambiguous obligation per ordered stream | Two concurrent dispatches for one aggregate                     |
| **Predecessor predicate** (§13) | No obligation is claimed while an earlier unresolved sibling exists | A newer obligation overtaking an older, temporarily ineligible one |

Neither substitutes for the other. The index cannot express sequence because it
has no notion of earlier; the predicate cannot express exclusivity because it
is a query predicate evaluated against committed rows.

### 12.3 Ordered-identity integrity, and PostgreSQL NULL uniqueness

A unique index treats NULLs as **distinct** by default (`NULLS DISTINCT`), so a
NULL in any key component would let unlimited rows coexist in what should be one
exclusive stream — silently, with no error. The ordered design is therefore only
sound if every key component is non-null.

**Read from source, the four index-key components are already `NOT NULL` by
existing F062.2C constraints, so the hazard does not apply to the index key:**

| Index-key component        | Existing declaration                                              | Source                                  |
| -------------------------- | ----------------------------------------------------------------- | --------------------------------------- |
| `organization_id`          | `uuid not null`                                                   | `20261021000000-add-integration-outbox.ts:52` |
| `integration_connector_id` | `uuid not null`                                                   | same, `:53`                             |
| `aggregate_type`           | `varchar(20) not null`, closed to three values                    | same, `:63`                             |
| `aggregate_id`             | `uuid not null`                                                   | same, `:65`                             |
| `requires_ordered_delivery` | proposed `boolean not null` (§30 item 5)                          | —                                       |

**No new constraint is required for the index key.** That is a genuine
pre-existing guarantee, not an assumption, and a future slice must not relax
any of the four.

#### The one real gap: `aggregate_revision`

`aggregate_revision integer check (aggregate_revision > 0)` is **nullable**,
and is forced non-null only for immutable events, by
`check (contract_kind <> 'event' or aggregate_revision is not null)`
(`:66` and `:123`). `work_item.sync_requested` is the only declared
`state_sync` type, so **a `state_sync` intent may legitimately carry a NULL
`aggregate_revision` today.**

`aggregate_revision` is not in the index key, so it cannot break mutual
exclusion. It *is* the leading component of the FIFO sequence key, so a NULL
breaks **sequence**: PostgreSQL sorts NULLs last in ascending order, which
would place an unrevisioned `state_sync` intent after every revisioned sibling
regardless of when it was enqueued, and would leave two unrevisioned siblings
ordered only by the tiebreak.

> **Required in F062.2D-2C-2: a CHECK constraint requiring the FIFO revision
> component to be present whenever ordering is required — conceptually
> `requires_ordered_delivery = false or aggregate_revision is not null`.**

**The consequence is stated plainly rather than hidden:** a `state_sync` intent
destined for a connector declaring `supports_ordering = 'per_aggregate'` must
then carry an `aggregate_revision`, or its enqueue is refused. That is the
correct fail-closed direction — **a caller asking for ordered delivery must
supply the field that defines the order** — but it is a real new enqueue
requirement on an accepted path, and it must be reviewed as such rather than
introduced quietly. The alternative, ordering unrevisioned intents by
`created_at` alone, is rejected: `created_at` is enqueue time, not the
aggregate's causal sequence, and two mutations enqueued out of causal order
would then be delivered out of causal order while appearing correctly ordered.

---

## 13. Ordering semantics with a blocked head

**Case: intent A for aggregate X is `retrying` or stuck; intent B for aggregate
X is newer.**

| Policy                           | Assessment                                                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Strict FIFO blocking**         | **RECOMMENDED where `requires_ordered_delivery`.** B waits for A. That is what the connector's `per_aggregate` declaration *means*             |
| Skip the blocked intent          | **Forbidden where ordering is declared.** Skipping A to deliver B is reordering — exactly the `status_changed` overtaking `submitted` bug        |
| State-sync coalescing            | **Not approved.** See §13.4                                                                                                                      |
| Operator disposition             | **Always available**, and the only exit when A is genuinely stuck                                                                                |

### 13.0 `ORDER BY` alone does NOT guarantee FIFO

**This is the correction the review required, and it matters.** An earlier
formulation of this section said sequence was guaranteed by the claim query's
ordering. **That is wrong**, and the counterexample is ordinary rather than
exotic:

```
A = older obligation, state 'retrying', next_attempt_at 30 seconds in the future
B = newer obligation, state 'pending',  eligible now
```

A is **filtered out of the candidate set** by the retry-clock predicate, so it
never reaches the `ORDER BY` at all. `ORDER BY` can only order candidates it is
given. B is then the only candidate, sorts first trivially, and **is claimed
and delivered before A** — a strict-ordering violation produced by a retry
delay, with no concurrency involved and no constraint violated.

The same failure occurs whenever an earlier sibling is temporarily ineligible
for **any** reason: a retry delay, an unresolved ambiguity, a connector that
was briefly non-dispatchable, or a pending-age gate.

> **An obligation must not become claimable merely because its predecessor was
> filtered from the eligible candidate set.**

### 13.1 The predecessor predicate

**Required as a distinct control.** For an obligation with
`requires_ordered_delivery = true`, it is claimable **only when no earlier
unresolved obligation exists for the same ordered stream** — the same
`organization_id`, `integration_connector_id`, `aggregate_type` and
`aggregate_id`.

Conceptually a `not exists` over siblings, evaluated against **committed rows
and independently of eligibility**:

| Element            | Definition                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Stream key**     | `(organization_id, integration_connector_id, aggregate_type, aggregate_id)` — all four already `NOT NULL` (§12.3)                   |
| **Sequence key**   | `(aggregate_revision, created_at, id)`, ascending, with the revision component required non-null for ordered streams (§12.3)        |
| **"Earlier"**      | a sibling whose sequence key sorts strictly before the candidate's                                                                 |
| **"Unresolved"**   | **any non-terminal state**: `pending`, `dispatching`, `retrying`, `ambiguous`. Deliberately **not** "currently eligible" and **not** "in-flight" |
| **Terminal, so not blocking** | `accepted`, `acknowledged`, `failed_permanent`, `dead_lettered`, `refused` — exactly F062.1 `terminalDeliveryStates` plus `accepted`, which is awaiting acknowledgement rather than delivery |

**Eligibility and blocking are deliberately asymmetric, and that asymmetry is
the whole point.** A predecessor blocks by *existing unresolved*, not by being
claimable. So:

- **A retry delay on A blocks newer B.** A is `retrying` — non-terminal — so B is not claimable, whatever A's `next_attempt_at` says. B becomes claimable only when A reaches a terminal state.
- **An ambiguous A likewise blocks later work** until the ambiguity reaches authorized resolution (§15). This is the same rule, not a special case.
- **A `pending` A blocks B** even if both are eligible, which is what makes the order deterministic rather than a race.

Note that `accepted` is treated as **non-blocking**: the destination took the
work, and waiting for an acknowledgement that may never come (a connector
without `reports_terminal_state` can never reach `acknowledged`) would block
the stream forever. **This is a deliberate line and should be confirmed in
review**: it means a successor may dispatch while a predecessor is delivered
but unacknowledged.

### 13.2 Two controls, two failure modes

| | Partial unique index (§12) | Predecessor predicate (§13.1) |
| --- | --- | --- |
| **Guarantees** | mutual exclusion | strict FIFO sequence |
| **Blocking states** | `dispatching`, `ambiguous` | **all** non-terminal states |
| **Mechanism** | index constraint, atomic | query predicate over committed rows |
| **Enforced by** | the database, unconditionally | the claim function |
| **Failure mode** | two concurrent dispatches | a newer obligation overtaking an older one |

**Both are required. Neither is sufficient alone**, and because the predicate
is enforced by the claim function rather than by a constraint, **it must be
covered by its own concurrency tests** — the index will not catch a predicate
bug, since two obligations in one stream claimed in the wrong order never
violate exclusivity if the first is settled before the second is claimed.

### 13.3 Why queue depth is never blocked

Only `dispatching` and `ambiguous` appear in the index predicate, so **any
number of `pending` and `retrying` obligations may exist for one aggregate.**
The index constrains *concurrency*, never enqueue. F062.1 `mayEnqueue` stays
intact, and an outage builds a backlog rather than rejecting intents.

### 13.4 State-sync coalescing is NOT approved

Tempting and explicitly refused: for a `state_sync` intent carrying
`current_state_projection`, one might skip older obligations for the same
aggregate because the newest projection subsumes them.

**That inference is invalid as stated, and F062.2D-1A already said why:**
current data delivered through a **non-convergent operation** can still produce
an unintended second effect. Convergence requires a reviewed per-connector,
per-operation determination; the capability flag alone is insufficient, because
a destination may implement one state-sync operation convergently and another
as a create. **F062.2D-1A records that no operation has yet been proven
convergent.**

> **Therefore: no coalescing, no skipping of older obligations, and no
> reprojection shortcut is approved for any operation today.** When an
> operation is proven convergent under F062.2D-1A's four-part test, coalescing
> becomes available **for that operation only**, and must be recorded against
> that operation rather than inferred from `contract_kind` or from
> `supports_current_state_sync`.

---

## 14. Poison isolation

> **One failing aggregate must block at most its own ordered stream.**

| Scope                         | May be blocked?                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------- |
| Aggregate X itself            | **Yes**, where `requires_ordered_delivery` — that is what ordering means        |
| Another aggregate Y           | **Never**                                                                       |
| The connector as a whole      | **Never** by one aggregate                                                      |
| Another connector             | **Never**                                                                       |
| Another Organization          | **Never**                                                                       |
| The platform                  | **Never**                                                                       |

Option E delivers this structurally: the index key *includes* the aggregate, so
one stream's occupied slot is invisible to every other key. **No global
serialization point is introduced, and none may be.** A per-connector or
per-Organization in-flight cap is a separate concurrency-budget concern
(F062.2D-0 §21.2) and must not be implemented by narrowing this key.

One corollary worth stating: because an unordered connector
(`supports_ordering = 'none'`) is excluded from the index predicate entirely, a
poison aggregate on such a connector blocks **nothing at all** — its siblings
dispatch concurrently.

---

## 15. Ordering and ambiguity

**Case: aggregate X has an unresolved `ambiguous` attempt. Should later X
obligations run?**

| Connector declares                   | Answer                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `supports_ordering = 'per_aggregate'` | **No.** The stream is blocked until the ambiguity is resolved                                                     |
| `supports_ordering = 'none'`          | **Yes.** Later obligations proceed; the ambiguous one is resolved on its own track                                 |

### 15.1 Why ordered streams must block on ambiguity

An `ambiguous` attempt means a mutation **may already have taken effect at the
destination**. Delivering the next mutation for that aggregate on top of an
unknown state is not merely a reordering risk — it is applying a change to a
base state nobody can describe. For a connector that declared
`per_aggregate`, blocking is the only coherent behaviour.

This is already the reason `ambiguous` appears in Option E's index predicate.
**The ordering block and the poison-isolation mechanism are the same mechanism**,
which is a strong signal the design is right rather than two overlapping rules.

### 15.2 The prohibition

> **Neither pending age nor lease expiry may silently release an ordered stream
> blocked by an unresolved ambiguous side effect.**

Concretely: if age exhaustion dead-letters the ambiguous obligation, the stream
does **not** silently unblock, because `dead_lettered` is not in the index
predicate and the ambiguity was never resolved — it was abandoned. The
honest treatments are:

1. Resolve the ambiguity — reconciliation or read-after-write to `accepted`, or capability-gated re-attempt, or an operator decision to `failed_permanent`; **then** the stream unblocks legitimately; or
2. An explicit, audited operator **release** of the ordered stream (§26), which records that a human accepted the reordering risk.

**Dead-lettering an ambiguous obligation must not be a back door to unblocking
its stream.** A future slice implementing age-based dead-lettering must
therefore decide explicitly whether the stream stays blocked — the recommended
answer is **yes, it stays blocked until operator release**, because the
underlying uncertainty is unchanged.

---

## 16. Retry eligibility

### 16.1 The eligibility timestamp

**Recommendation: `integration_outbox.next_attempt_at timestamptz null`.**

| Question                        | Answer                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who calculates it?              | **The database**, inside `complete_integration_attempt` and the recovery function, from pinned policy (§20) and the existing attempt count                 |
| Who persists it?                | **The database**, in the same transaction as the settlement. A retry that is scheduled separately from the settlement that caused it can be lost or doubled |
| Can the worker influence it?    | **No.** No parameter, no hint, no override. A worker that could choose its own next-attempt time could schedule an immediate retry and defeat backoff entirely |
| How does the claim query use it? | `state = 'retrying' and next_attempt_at <= clock_timestamp()`                                                                                             |
| Is database time authoritative? | **Yes**, exclusively. §28                                                                                                                                  |
| Mutability                      | Set at each settlement; **monotonically forward within one retry sequence**. Never cleared to make an obligation immediately eligible                      |
| When null                       | Whenever the state is not `retrying`. A `null` must mean **not scheduled**, never *eligible now* — the predicate requires a non-null value, so the fail-closed reading is structural |

### 16.2 No attempt counter is needed

**`attempt_count` on the outbox is unnecessary and should not be added.** The
attempt rows *are* the count: `max(attempt_number)` for the obligation is
exactly the number of attempts, it is already uniquely indexed per obligation,
and it cannot drift from the evidence the way a denormalized counter can. The
backoff exponent and the attempt ceiling both read it.

This is a deliberate rejection of F062.2D-0 §12's sketch, which listed
`attempt_count + 1` on the outbox. **A counter that can disagree with the
evidence it counts is a liability**; the index `integration_attempt_obligation`
(`organization_id, integration_outbox_id, claim_generation desc`) already makes
the lookup cheap.

---

## 17. Retryable failure classes

Using the existing ten-value `integrationFailureCategories` and the existing
`transientIntegrationFailures`. **No category is reclassified.**

| Category                     | Outcome today                | Enters retry scheduling?                                                                 |
| ---------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------- |
| `destination_unavailable`    | `failed_transient` permitted | **Yes** — a transient destination outage is the canonical retry case                     |
| `rate_limited`               | `failed_transient` permitted | **Yes**, and it should honour a longer floor than a plain outage; §18.3                  |
| **`destination_timeout`**    | **`ambiguous` only, enforced** | **No, not as a transient retry.** It may already have taken effect. Only the ambiguity path |
| `destination_rejected`       | `failed_permanent`           | **No.** The destination made a decision                                                   |
| `authentication_failed`      | `failed_permanent`           | **No** automatic retry. A credential or configuration fix is required; §23.2              |
| `destination_unconfigured`   | `failed_permanent`           | **No.** Configuration error                                                               |
| `projection_failed`          | `failed_permanent`           | **No.** Reqro could not build the payload — a code or data defect, not a destination state |
| `contract_unsupported`       | `failed_permanent`           | **No.** Retrying cannot make a destination support an operation                           |
| `malformed_request`          | `failed_permanent`           | **No.** Identical input produces an identical rejection                                   |
| `internal_failure`           | `failed_permanent` today     | **See §23.** Reqro-owned, and the only genuinely contested case                           |

### 17.1 Ambiguity never becomes an ordinary retry

The database **already enforces** both halves of this, and the enforcement must
survive every future change:

- `failed_transient` is accepted only with `destination_unavailable` or `rate_limited`;
- `destination_timeout` is accepted only with outcome `ambiguous`.

> **A worker therefore cannot relabel an ambiguous timeout as a transient
> failure to earn itself a blind retry.** An ambiguous outcome reaches
> `retrying` only through the capability-gated `ambiguous -> dispatching` edge
> — never through `next_attempt_at`.

### 17.2 Vendor errors are never classified directly

A destination's HTTP status, error body or vendor code must be mapped to one of
the ten categories **inside the adapter**, by an approved mapping, before it
reaches the database. The function API accepts only the closed vocabulary and
rejects anything else structurally. **No adapter may introduce a new
category**, and an unmapped vendor error must map to the most conservative
applicable category rather than defaulting to a retryable one.

---

## 18. Backoff algorithm

| Algorithm                       | Assessment                                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Fixed delay                     | Rejected. Does not relieve a struggling destination, and synchronizes every retry into a repeating pulse                             |
| Exponential, uncapped           | Rejected. Reaches absurd delays and interacts badly with the age ceiling                                                             |
| **Capped exponential + full jitter** | **RECOMMENDED**                                                                                                                 |
| Jitter alone                    | Rejected. Spreads load without relieving it                                                                                          |

### 18.1 The recommended baseline

```
base      = min(max_delay, min_delay * 2 ^ (attempts - 1))
delay     = random_between(min_delay, base)          -- full jitter
eligible  = clock_timestamp() + delay
```

Evaluated **in the database**, at settlement, from pinned policy. Full jitter
rather than equal jitter because it is the stronger de-synchronizer and
directly addresses the thundering-herd threat in §35.

### 18.2 Parameters — all provisional

| Parameter             | Owner                                            | Value                                                                    |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| Minimum delay         | platform baseline, connector may **raise**       | **PROVISIONAL**                                                          |
| Maximum delay (cap)   | platform ceiling, connector may **lower**        | **PROVISIONAL**                                                          |
| Maximum attempt count | platform ceiling, connector may **lower**        | **PROVISIONAL**                                                          |
| Maximum retry horizon | platform ceiling                                 | **PROVISIONAL**, and must be `<=` the pending-age ceiling                |
| Jitter source         | database `pg_catalog.random()`                   | **Decided** — see §18.4                                                  |
| Policy layering       | platform baseline + connector/type specialization | **Decided** — `min` precedence, as §5.2                                  |

**No production number is proposed.** Every value stays provisional until the
first connector's real API contract, published rate limits and retry guidance
are reviewed, exactly as F062.2D-0 §17 already requires for the lease.

### 18.3 `rate_limited` deserves its own floor

A destination that says "too many requests" has stated a rate, and retrying it
on the same curve as an unreachable host is both impolite and
counterproductive. **Recommendation: a separate, higher minimum delay for
`rate_limited`.** Where a destination supplies a retry-after value, honouring
it is preferable — but that is adapter-level input to an **approved** policy,
never a destination-controlled timestamp written straight into
`next_attempt_at`. The policy must clamp it to the platform's own bounds.

### 18.4 Jitter source

**`pg_catalog.random()`.** It is on the pinned `search_path`, needs no
extension, and jitter has no security requirement — it exists to de-correlate
timing, not to resist prediction.

> **`random()` must never be used to generate a claim token.** Claim tokens are
> worker-generated from a CSPRNG under F062.2D-0, and the database only ever
> sees a SHA-256 digest. The two uses must not be confused because they share a
> function name.

---

## 19. Retry budget versus pending-age budget

> **These are two independent budgets. Neither implies, caps or substitutes for
> the other, and exhausting either stops automatic processing on its own.**

| Budget          | Measures                                           | Owner           | Exhaustion means                                 |
| --------------- | -------------------------------------------------- | --------------- | ------------------------------------------------ |
| **Retry**       | attempts made and the retry horizon                | §18 policy      | "The destination repeatedly could not take it"    |
| **Pending age** | eligible age from immutable `created_at`           | F062.2D-1A      | "Nobody got round to it in time"                  |

### 19.1 The four cases

| Case                                                  | Behaviour                                                                                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Retry budget exhausts first                           | Automatic processing stops. `dead_lettered`, with a transient category and the retry-exhaustion reason                                   |
| Pending-age ceiling reached with retries remaining    | Automatic processing stops anyway. `dead_lettered` for the **age** reason. The remaining retry budget is irrelevant — the ceiling is absolute |
| Connector `disabled`                                  | **Eligible age pauses** (F062.2D-1A) **and no retries are generated** — the connector is not dispatch-eligible, so no claim occurs and no attempt is made. Neither budget is consumed |
| Destination outage, connector `active` or `degraded`  | **Both** are consumed: attempts fail and are counted, and eligible age accrues. Whichever bound is reached first stops automatic work    |

### 19.2 States used

**Only existing F062 states.** Both exhaustion paths reach **`dead_lettered`**,
which F062.2D-1A chose precisely because it is the only terminal state with a
defined authorized replay path. **No state is invented.**

The two share a state and must not share a reading, which is why the **reason**
must distinguish them: F062.2D-1A's `pending_age_exceeded` for age exhaustion,
and a transient category with retry-exhaustion evidence for budget exhaustion.
Conflating them would tell an operator a destination is broken when in fact
nothing ever tried.

### 19.3 Reaching `dead_lettered` requires an edge that does not exist

`retrying -> dead_lettered` **does** exist in the transition graph.
`dispatching -> dead_lettered` exists too. So budget exhaustion is reachable
today in principle. **But `dead_lettered` has no outgoing edge at all in the
database**, because F062.2A's authorized `dead_lettered -> pending` replay
requires audit evidence that does not exist. **Automatic dead-lettering must
therefore not be implemented before that replay evidence exists**, or
obligations become permanently wedged — which is exactly the wedging §33 refuses
to grant a worker the power to cause.

---

## 20. Retry policy pinning

**Is retry/backoff policy semantic connector configuration? Yes.** It changes
what Reqro *does* to a destination, so it belongs with the semantics an
obligation pins.

| Model                                | Assessment                                                                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pinned policy (revision N)**       | **RECOMMENDED for the schedule.** Reproducible, and consistent with every other F062 semantic                                                      |
| Current policy                       | Rejected as the primary rule. Tuning backoff would silently rewrite the schedule of every in-flight obligation                                      |
| **Stricter current platform ceiling** | **RECOMMENDED as an overlay.** A platform tightening must take effect immediately, including on already-pinned obligations                         |
| Explicit operator policy epoch       | **Not needed now.** The connector's `configuration_revision` already *is* an epoch                                                                  |

### 20.1 The recommended model

> **The schedule comes from the policy pinned at
> `pinned_connector_configuration_revision`. The platform ceiling is applied as
> a strictly-tightening `min` at evaluation time. A pinned policy can never be
> widened by a later change, and can always be tightened by the platform.**

This is F062.2D-1A's rule applied to a second quantity, which is deliberate.

### 20.2 No new pinning field is required

**A notable minimality result.** Because:

- the obligation already pins `pinned_connector_configuration_revision`;
- the connector audit already snapshots the **full** capability set per revision;
- the enqueue guard already refuses an intent that does not pin an existing revision-advancing snapshot;

retry policy stored as connector configuration — advancing
`configuration_revision` when changed — is **already pinned and already
reconstructable**, with no `retry_policy_revision` column and no policy epoch
table. The attempt's `connector_configuration_revision` records which policy
produced each schedule.

**The one requirement: a retry-policy change must advance
`configuration_revision`, not merely `record_revision`.** `record_revision`
exists for semantically inert changes such as credential rotation; retry policy
is not inert. The audit's `change_category` would be `capabilities_changed`.

### 20.3 Administrators tuning backoff do not disturb old obligations

Follows directly: an obligation pinned at revision N keeps revision N's
schedule for its whole life. A new revision applies to obligations enqueued
after it. **Except** that a tightened platform ceiling applies immediately and
everywhere, by design — tightening is always permitted, widening never is.

---

## 21. The future claim eligibility predicate

Conceptual only. **No SQL is implemented in this slice.**

| State               | Claimable?                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pending`           | **Yes**, immediately, if every other gate passes                                                                                                 |
| `retrying`          | **Only** when `next_attempt_at is not null and next_attempt_at <= clock_timestamp()`                                                              |
| `ambiguous`         | **No.** Not claimable by this predicate at all. It leaves `ambiguous` only via the capability-gated `ambiguous -> dispatching` edge under a reviewed resolution path |
| `dead_lettered`     | **No.** Not without authorized replay, whose audit evidence does not exist                                                                        |
| `dispatching`       | **Not independently.** An open attempt blocks it, and the only route is lease recovery under §8, which settles rather than claims                  |
| `accepted`          | **No.** Awaiting acknowledgement, not delivery                                                                                                    |
| `acknowledged`, `failed_permanent`, `refused` | **No.** Terminal                                                                                                       |

The complete conceptual gate, in the order a claim must apply it:

1. Connector `lifecycle_state in ('active','degraded')` — F062.1 `mayDispatch`. **Already implemented.**
2. State eligible per the table above, with the retry clock evaluated in the database.
3. No open attempt for the obligation. **Already implemented.**
4. **Mutual exclusion:** ordered-stream slot free, where `requires_ordered_delivery` — `not exists` pre-filter plus the Option E index as the authoritative backstop.
5. **Strict FIFO:** the §13.1 predecessor predicate — no **earlier unresolved** sibling in the same ordered stream, where "unresolved" means any non-terminal state and **not** "currently eligible".
6. Pending-age ceiling not exceeded — F062.2D-1A.
7. Pinned snapshot exists. **Already implemented** (raises if missing).
8. `FOR UPDATE SKIP LOCKED LIMIT 1`, ordered by `aggregate_revision, created_at, id`.

Gates 1, 3, 7 and most of 8 exist today. Gates 2, 4, 5, 6 and the ordering
change in 8 are what the implementation slices add.

---

## 22. Retry and connector lifecycle

| Lifecycle     | `mayDispatch` | Claim eligible | Retries generated                         | Eligible age   |
| ------------- | ------------- | -------------- | ----------------------------------------- | -------------- |
| `configured`  | **No**        | **No**         | **No** — never dispatched, so nothing fails | not accruing   |
| `active`      | Yes           | Yes            | Yes                                       | **accruing**   |
| `degraded`    | Yes           | Yes            | Yes                                       | **accruing**   |
| `disabled`    | **No**        | **No**         | **No**                                    | **paused**     |
| `retired`     | **No**        | **No**         | **No**                                    | see §22.2      |

Preserved from F062.2D-1A without change: `degraded` accrues age because the
worker is dispatching, just slowly; `disabled` pauses age because an
administrator deliberately paused it and expiring obligations for that interval
would make `disable` a delayed discard.

### 22.1 No retries while deliberately disabled

A `disabled` connector is not dispatch-eligible, so **no claim occurs, no
attempt is made and no retry is scheduled.** Existing `retrying` obligations
keep whatever `next_attempt_at` they had; that time may pass while disabled,
and on re-enable they become immediately eligible. That is correct — the delay
was served — but it creates a **re-enable surge** that §35 treats as a
thundering-herd case. The mitigation is the worker's own claim-rate bound, not
a rewrite of `next_attempt_at`, because rewriting it on re-enable would be the
worker influencing its own schedule.

### 22.2 `retired`

`mayEnqueue` is false, so no new intents arrive. Existing obligations for a
retired connector cannot dispatch and will reach the age ceiling. **Whether
retirement should dead-letter outstanding obligations immediately, with
evidence, is an open operator-policy question** — recorded in §36 rather than
decided here, because it is a data-retention and operator-authority question,
not an execution-semantics one.

### 22.3 No fallback retargeting

> **A retry is always to the same connector. There is no fallback, no
> failover, no retargeting to a different connector, and no inference that two
> connectors are interchangeable.**

The obligation pinned one connector's semantics at one revision. Delivering it
elsewhere would deliver it under semantics it never pinned, and the
`unique (organization_id, integration_connector_id, integration_id)` key exists
precisely so that fan-out to a second connector is a **separate obligation**,
deliberately enqueued, not a retry destination.

---

## 23. Reqro-owned infrastructure failures

> **A Reqro infrastructure failure is not a destination failure and must never
> be recorded as one.**

| Failure                       | Category         | Is it a destination signal? | Consumes attempt budget?        |
| ----------------------------- | ---------------- | --------------------------- | ------------------------------- |
| Secret-manager outage         | `internal_failure` | **No**                    | **No** — recommended            |
| Worker infrastructure failure | `internal_failure` | **No**                    | **No**                          |
| Internal database contention  | `internal_failure` | **No**                    | **No**                          |
| Internal telemetry failure    | **not a delivery failure at all** | **No**     | **No** — must not fail delivery |

### 23.1 Why they must not consume attempt budget

The attempt budget exists to bound how long Reqro keeps bothering a destination
that cannot take the work. A secret-manager outage never bothered the
destination at all. Consuming the budget would let a Reqro-side incident
dead-letter a large backlog of perfectly deliverable obligations, turning an
internal outage into permanent delivery loss. **That is the failure mode this
rule exists to prevent.**

### 23.2 How to express "retry but do not count"

`internal_failure` is not in `transientIntegrationFailures`, so it cannot
settle an attempt as `failed_transient` today, and that is correct — it is not
a *destination* transient. Two candidate expressions:

| Option                                                    | Assessment                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Add `internal_failure` to `transientIntegrationFailures`  | **Rejected.** It would make every internal defect — including a genuine code bug in projection — silently retryable forever      |
| **Do not claim at all when a prerequisite is unavailable** | **RECOMMENDED.** If secrets are unresolvable, the worker is `not_ready` and must not claim. No claim, no attempt, no budget consumed |

**The recommended answer is prevention, not classification.** F061.3A's
`worker_readiness` dimension already exists for exactly this: a worker lacking
its prerequisites reports `not_ready` and refuses to claim, rather than
claiming and failing. Where a claim has *already* been taken and a prerequisite
then fails before dispatch, the attempt is settled by the §8 pre-dispatch path
— which is honest, because `dispatch_started_at` really is null — and the
budget question becomes §36's open item on whether pre-dispatch recoveries
count against the attempt ceiling. **The conservative provisional answer is
that they do not count, but they must be separately bounded** so a crash-looping
worker cannot generate unlimited attempt rows.

### 23.3 No destination circuit breaker on internal failures

> **A circuit breaker, when one exists, must be tripped only by destination
> evidence** — `destination_unavailable`, `rate_limited`, `destination_timeout`.
> Tripping it on `internal_failure` would mark a healthy destination unhealthy
> during a Reqro incident, and the recovery would then be gated on a signal
> that was never about the destination.

Telemetry failure must never fail delivery: F061's integration telemetry port
already has a `NO_TELEMETRY` no-op implementation, which is the right posture
— observability degrades, delivery continues.

---

## 24. Idempotency identity

Four identities, deliberately distinct. Conflating any two breaks either
duplicate protection or evidence.

| Identity                        | Scope                            | Stable across retries?             | Purpose                                              |
| ------------------------------- | -------------------------------- | ---------------------------------- | ---------------------------------------------------- |
| **`integration_id`**            | the intent crossing the boundary | **YES — stable, and must be**      | Downstream duplicate protection                      |
| `integration_outbox.id`         | this obligation row              | stable                             | Reqro-internal row identity                          |
| `integration_delivery_attempt.id` | one attempt                    | **No — new per attempt**           | Evidence of one try                                  |
| `claim_generation`              | one claim's ownership            | **No — advances per claim**        | Fencing                                              |
| Destination idempotency key     | the destination's dedupe window  | **Derived from `integration_id`**  | Makes a retry safe at the destination                |

### 24.1 The rule

> **`integration_id` is the stable identity across every retry of one
> obligation, and a destination idempotency key must be derived from it — never
> from the attempt id, never from `claim_generation`, and never freshly
> generated per retry.**

Generating a new business operation identity per retry would present each retry
as a *new* operation and defeat the destination's duplicate protection
entirely. `integration_id` is already documented in the outbox as "the envelope
identity consumers deduplicate on", already distinct from the row `id`, and
already unique per `(organization, connector, integration_id)` — so it is
already the right value and needs no new field.

### 24.2 Where a key hash would go

F062.2D-0 §9 lists `idempotency_key_hash` as a settle-time field proving a key
was used without storing the key. **Not required for this decision** and
deferred: it is dispatch evidence, and no dispatch exists. When dispatch is
implemented it should be added to the attempt, not the outbox — the attempt is
where per-try evidence lives.

---

## 25. Reconciliation

> **Retries must stop and reconciliation must begin whenever the question
> changes from "can this be delivered?" to "what already happened?"**

| Trigger                                            | Why retrying is wrong                                                                            | Required path                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Ambiguous external outcome                         | A retry may duplicate an effect that already occurred                                            | Read-after-write or reconciliation to `accepted`; capability-gated re-attempt; or operator disposition      |
| Destination accepted but Reqro settlement failed (§10 D/E) | The work is **done**. Retrying creates a duplicate of a success                            | Read-after-write resolving `ambiguous -> accepted`. **Never a retry**                                       |
| Idempotency state unknown                          | The safety property a retry depends on cannot be established                                     | Reconciliation, or operator                                                                                 |
| Read-after-write disagreement                      | Reqro and the destination disagree on reality; a write cannot settle a disagreement about a write | **Operator review.** Automatic resolution must not pick a winner                                            |

### 25.1 Capability dependence, stated plainly

Reconciliation requires `supports_reconciliation`, and read-after-write
requires `supports_read_after_write` — both read from the **pinned** snapshot,
not the connector's current row. **A connector declaring neither has no
automatic ambiguity resolution available at all**, and every ambiguous outcome
on it becomes operator work. That is an honest consequence of a destination's
real capabilities, and it should be visible at connector registration rather
than discovered during an incident.

### 25.2 No endless retry loop

Three independent bounds, each sufficient alone:

1. The maximum attempt count (§18.2);
2. The maximum retry horizon (§18.2);
3. The pending-age platform ceiling (F062.2D-1A, absolute).

And the structural one: **`ambiguous` is not reachable by the retry predicate at
all** (§21), so an ambiguous outcome cannot enter the retry loop in the first
place.

---

## 26. Operator boundary

Conceptually reusing the established trusted-operator architecture — the
`reqro_operator` identity under ADR-027 and the PIM elevation model. **No
operator action is implemented, designed in detail, or granted here.**

| Action                                           | Trusted operator / PIM required? | Must leave durable evidence |
| ------------------------------------------------ | -------------------------------- | --------------------------- |
| Force recovery of an **ambiguous** attempt        | **Yes**                          | **Yes**                     |
| Release an ordered aggregate blocked by ambiguity | **Yes** — accepts reordering risk | **Yes**                     |
| Override retry exhaustion                         | **Yes**                          | **Yes**                     |
| Requeue dead-lettered work                        | **Yes**                          | **Yes** — F062.2A requires audit evidence in the same transaction |
| Suppress an obligation                            | **Yes**                          | **Yes**                     |
| Change a pinned policy epoch                      | **Yes**, and see §26.2           | **Yes**                     |

### 26.1 What the worker may never do

> **Every row above is outside the worker's authority. The worker identity must
> never receive EXECUTE on any function implementing them.** A worker may claim,
> mark dispatch started, and settle. It may not resolve ambiguity, release an
> ordered stream, override a budget, requeue, suppress, or change policy.

This is the authority boundary F062.2D-3 must enforce by grant, and it is why
operator actions should live in **separate functions** from the worker API
rather than as privileged parameters on the worker's functions — a flag that
elevates behaviour is a flag that can be set.

### 26.2 Retroactive policy change is the sharpest operator risk

Changing a pinned policy epoch retroactively could silently extend ceilings on
obligations already past them. **Recommendation: an operator may tighten
retroactively but never widen retroactively.** Widening must create a new
revision applying only to future obligations, or — for a specific stuck
obligation — an explicit, audited, individually-bounded authorization, which is
F062.2D-1A's requeue model and is already cumulatively bounded so that repeated
authorization cannot become an unlimited bypass.

---

## 27. Observability requirements and gaps

**No F061 concept is added, changed or implemented in this slice.** F061.3A and
F061.3B own the vocabulary; this section only maps need to existing concepts and
enumerates gaps for a future F061 task.

### 27.1 Already sufficient

| Need                                | Existing concept                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| Pending backlog                     | `integration_pending_count`                                                      |
| Retry-eligible subset               | `integration_ready_count` — already defined as the subset "eligible to be claimed now under the delivery policy", which includes the retry clock |
| Oldest pending age                  | `integration_oldest_pending_age` — already a release gate                        |
| Claim events                        | `integration_claim_count`                                                        |
| Unresolved ambiguity                | `integration_ambiguous_count`                                                    |
| Dead-letter volume                  | `integration_dead_letter_count`                                                  |
| Retry volume                        | `integration_retry_count`                                                        |
| Reconciliation need                 | `integration_reconciliation_failure`                                             |
| Destination health                  | `integration_connector_health`                                                   |
| Worker liveness, drain, progress    | `worker_readiness`, `worker_draining`, `worker_progress`                         |

### 27.2 Gaps — a future F061 task, not this slice

| # | Gap                                      | Why existing concepts do not cover it                                                                                                   |
| - | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | **Active / in-flight claim count**       | `integration_claim_count` counts claim **events**; nothing reports how many claims are open **now**. Without it an in-flight leak is invisible |
| 2 | **Expired lease count**                  | No concept describes leases past expiry awaiting recovery — the primary signal that workers are dying                                   |
| 3 | **Lease recovery count**, split pre-dispatch versus ambiguous | The split is the operationally decisive one: pre-dispatch recoveries are cheap, ambiguous ones create human work |
| 4 | **Oldest retry-eligible age**            | `integration_oldest_pending_age` measures the pending population from `created_at`; it does not answer "how overdue is the most overdue *scheduled retry*?" — a stalled retry wave's signature |
| 5 | **Retry exhaustion count**               | `integration_dead_letter_count` aggregates all causes. F061.3B explicitly warns dead-letter count is not age-policy transition count; budget exhaustion needs its own distinguishable signal |
| 6 | **Ordered-stream blocked count / backlog** | No concept expresses "aggregates whose ordered slot is occupied" — the head-of-line signal                                            |
| 7 | **Ambiguous ordered-stream blockage**    | `integration_ambiguous_count` counts ambiguity; it does not say how much *other* work is blocked behind it, which is the impact measure |

**Recommendation: one future F061 slice — provisionally F061.3C — adds these
seven, reusing existing units and dimensions.** Gaps 1 and 2 should be treated
as release gates for a production worker alongside `oldest pending age`,
because without them a stalled or crash-looping worker is indistinguishable
from an idle one.

### 27.3 Label bounds — non-negotiable

> **No Organization ID, no connector ID, no aggregate ID, no attempt or outbox
> ID, no hostname, no vendor text, no destination URL.**

All seven are bounded aggregate counts or ages. Per-tenant and per-connector
attribution belongs in the queryable delivery record under tenant
authorization, never in a metric label — F061.1's label policy owns this and
`assertIntegrationLabels` already enforces it. F061's `SliDefinition.scope`
already distinguishes `tenant_deployment` from `platform` for deployment-level
separation, so no identifying label is needed to tell deployments apart.

---

## 28. Clock authority

> **Every durable timing decision is made by the database. A worker's
> wall-clock has no authority over anything.**

| Decision                        | Evaluated where               | With what                                      |
| ------------------------------- | ----------------------------- | ---------------------------------------------- |
| Lease expiry comparison         | **Database**, in the recovery function | `clock_timestamp()`                     |
| Lease expiry assignment         | **Database**, in the claim function    | `started_at + policy interval`          |
| Retry eligibility comparison    | **Database**, in the claim function    | `next_attempt_at <= clock_timestamp()`  |
| Backoff schedule computation    | **Database**, at settlement            | `clock_timestamp() + jittered delay`    |
| Pending age                     | **Database**                           | F062.2D-1A, from immutable `created_at` |
| Dispatch-started marker         | **Database**                           | `clock_timestamp()`                     |

### 28.1 `clock_timestamp()` versus transaction time

**Repository convention is unambiguous: `clock_timestamp()` is used 16 times
across the four integration migrations, and `now()`,
`transaction_timestamp()` and `CURRENT_TIMESTAMP` are used zero times.**
Preserve it, for reasons that are substantive and not merely consistency:

- **`clock_timestamp()` advances within a transaction; `now()` is frozen at transaction start.** For a lease comparison, frozen time is wrong in the dangerous direction: a long-running recovery transaction would evaluate every expiry against a timestamp from when it began, recovering leases that expired *after* it started — and the longer the transaction, the more aggressively it over-recovers.
- **For writing a lease deadline, `clock_timestamp()` measures from the statement**, so a claim that waited on a lock gets its full lease rather than one silently shortened by the wait.
- **`completed_at`, `started_at` and `created_at` already use it**, so a mixed convention would produce orderings that disagree across columns of the same row.

### 28.2 Clock skew

**All comparisons happen on one clock — the database's — so skew between
workers is irrelevant to correctness.** A skewed worker cannot expire its own
lease early, extend it, or make an obligation eligible. Skew matters only for
recovery *scheduling* (how promptly something runs), never for the decision
itself. **Keeping the comparison database-side is what reduces skew from a
correctness problem to a latency one**, and is the reason no design here accepts
a caller-supplied time.

---

## 29. Configuration ownership and precedence

| Policy                      | Owner                                            | Layering                                                    |
| --------------------------- | ------------------------------------------------ | ----------------------------------------------------------- |
| **Lease duration**          | Reqro platform, security and operations          | Platform ceiling + connector specialization, `min`          |
| **Lease floor**             | **Platform, non-overridable**                    | Must exceed the total request budget (§5.2)                  |
| **Ordering requirement**    | The **connector / integration contract** — `supports_ordering` | Declared per connector, pinned per revision |
| **Retry / backoff**         | Platform baseline + connector/type specialization | Pinned schedule, tightening-only platform overlay (§20)     |
| **Attempt ceiling**         | Platform ceiling; connector may lower            | `min`                                                        |
| **Retry horizon**           | Platform ceiling                                 | `min`, and `<=` the pending-age ceiling                      |
| **Pending-age ceiling**     | F062.2D-1A — platform, legal, product, connector | Unchanged                                                    |
| **Operator overrides**      | Trusted operator only, audited                   | Tighten retroactively; widen only forward (§26.2)            |
| **The worker**              | **Owns no policy at any layer**                  | —                                                            |

### 29.1 Precedence, stated once

> **The effective value of every bound is the strictest of all layers that
> define one. `min`, never last-write-wins. "Unset" inherits downward and never
> means unlimited. No layer may widen a stricter bound set above it. No
> configuration path yields unbounded automatic behaviour.**

One rule, applied to leases, retries, attempt ceilings, horizons and ages
alike. **A single precedence rule across five quantities is substantially safer
than five rules**, because there is one place to audit and no gap between them.

---

## 30. Minimum future persistence changes

Smallest set that makes the decisions above implementable. **Nothing here is
implemented in this slice.**

| # | Field                                                | Table                          | Purpose                               | Authority | Mutability                                     | Index need                                           |
| - | ---------------------------------------------------- | ------------------------------ | ------------------------------------- | --------- | ---------------------------------------------- | ---------------------------------------------------- |
| 1 | **`claim_expires_at timestamptz not null`**           | `integration_delivery_attempt` | Lease deadline                        | database  | write-once at claim                            | partial, `where completed_at is null`, for recovery scans |
| 2 | **`dispatch_started_at timestamptz null`**            | `integration_delivery_attempt` | The §7 side-effect boundary           | database  | **write-once, null -> non-null only**          | none — read with the row                              |
| 3 | **`reason_code varchar(n) null`**                     | `integration_delivery_attempt` | Worker-group settlement reason        | database  | write-once at settle                           | none                                                  |
| 4 | **`next_attempt_at timestamptz null`**                | `integration_outbox`           | Retry eligibility (§16)               | database  | per settlement, forward-only                   | partial, `where state = 'retrying'`                   |
| 5 | **`requires_ordered_delivery boolean not null`**      | `integration_outbox`           | Makes Option E's partial index possible (§12.1) | database, pinned at enqueue | **immutable**            | part of the Option E index                            |
| 6 | **The Option E partial unique index**                 | `integration_outbox`           | Ordered-stream mutual exclusion       | database  | n/a                                            | **is** the index                                      |
| 7 | **Retry/backoff + lease policy columns**              | `integration_connector` **and** `integration_connector_audit` | Pinnable policy (§20.2) | operator/admin | per revision; audit append-only | none                                                  |

**Deliberately NOT proposed:** `claimed_at` (duplicates `started_at`),
`claimed_by` (§4.2), `heartbeat_at` / `renewed_at` (§6), `attempt_count`
(§16.2), `retry_policy_revision` or a policy-epoch table (§20.2), any
coordination table (§12 Option B), any age column (F062.2D-1A needs none),
`idempotency_key_hash` / `external_reference` / `duration_ms` (dispatch
evidence, no dispatch exists).

### 30.1 Migration compatibility

| # | Compatibility                                                                                                                                                           |
| - | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | **`not null` needs care.** Existing open attempts have no lease. Since no worker exists, the table is empty in every real environment, but the migration must not *assume* that: add nullable, backfill, then set `not null`, or refuse to apply while an unsettled attempt exists — the pattern Migration 53's `down()` already uses |
| 2 | Nullable by nature. No backfill                                                                                                                                          |
| 3 | Nullable. The settle guard must additionally refuse changing it once set                                                                                                   |
| 4 | Nullable. **The outbox guard's immutability list must be extended to permit this one field to change on a state transition**, which is a change to an accepted guard and must be reviewed as such |
| 5 | **`not null` with a pinned default is the hard one.** It must be derived from the pinned snapshot per row, so the migration backfills by joining the audit, then sets `not null`. The enqueue guard must then assign it, as it already assigns `created_at` |
| 6 | **A unique index on existing data can fail.** It must be created after #5 is populated, and on an empty table in practice. `concurrently` is unavailable inside a transactional migration, which is acceptable at current volumes but should be stated |
| 7 | Additive with defaults. The audit table is append-only, so new columns need `not null` defaults or a nullable-then-backfill sequence |

### 30.2 The `reason_code` question, stated honestly

**This is the one place where the existing vocabulary genuinely does not
stretch, and it needs a reviewed decision rather than an implementer's
judgement.**

A pre-dispatch lease recovery (§8, row 1) should settle its attempt as
`failed_transient` so the obligation may legitimately move to `retrying`. But
the database **enforces** that `failed_transient` carries only
`destination_unavailable` or `rate_limited`, and neither is true — the
destination was never contacted. The ten-value `failure_category` taxonomy is
entirely about *destinations* and has no worker-owned member.

### The semantic separation, stated once

| Field                  | Domain                                                                 | Answers                                             | Observable by                       |
| ---------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------- |
| **`failure_category`** | the existing **bounded destination / external-delivery taxonomy**, ten closed values | *What did the destination do, or fail to do?*  | an adapter, from a real destination interaction |
| **`reason_code`**      | bounded **Reqro-owned worker and lifecycle causes**                    | *What did Reqro's own machinery do?*                | only Reqro, never a destination     |

> **A pre-dispatch lease recovery never contacted the destination, and
> therefore must not fabricate a destination failure category.** There is no
> destination behaviour to report. Recording one would put a fiction in the
> evidence row and, worse, in the metric that maps categories onto F061's
> `reason` dimension — telling an operator a destination misbehaved during what
> was purely a Reqro-side crash.

The two fields are therefore **not alternatives and not a fallback for each
other.** `failure_category` stays exactly as it is: closed, destination-shaped,
and the only thing an adapter may populate. `reason_code` carries the
Reqro-owned lifecycle cause, and only the database-authored recovery path may
write the worker-group values.

| Option                                                                 | Assessment                                                                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Add `reason_code` carrying a precise bounded pre-dispatch recovery cause**, written only by the database-authored recovery path | **RECOMMENDED.** Keeps the destination taxonomy clean and unwidened; the recovery function is `SECURITY DEFINER` and database-authored, so it may legitimately write a combination the worker API refuses |
| Add a new `failure_category` member such as a worker lease code         | **Rejected.** It widens a vocabulary every adapter maps into, in order to describe something **no adapter can ever observe**      |
| Add `internal_failure` to `transientIntegrationFailures`                | **Rejected twice over** — it makes every internal defect retryable forever (§23.2), **and** it would classify a Reqro crash as a destination transient, which is the exact conflation this section exists to prevent |

### What the F062.1 amendment must define

> **The amendment must define a precise, bounded reason for pre-dispatch lease
> recovery specifically — not a generic internal-failure catch-all, and not a
> rule that turns ordinary internal failures into retryable destination
> failures.**

Precision matters because the reason is what authorizes automatic retry without
ambiguity. A broad "something internal went wrong" code would make every
internal fault look like a safe pre-dispatch recovery, including faults that
occurred *after* dispatch began. The reason must mean exactly: *the lease
expired while `dispatch_started_at` was null, so no destination interaction
could have occurred.*

**Naming authority belongs to that amendment, not to this document, so no
F062.1 constant is finalized here.** For readability only, this document refers
to the concept as *the pre-dispatch recovery reason* — the final approved
equivalent of something like `claim_lease_expired_pre_dispatch`. The existing
`lease_expired_uncertain`, already named by F062.2A, is the matching reason for
the **possibly-dispatched** case and needs no new name.

F062.2D-1A set the precedent for a worker-group reason by recommending
`pending_age_exceeded` alongside `lease_expired_uncertain` and
`fenced_stale_completion`, so this is an established direction rather than a new
invention.

---

## 31. Minimum future function changes

| Function                                | Needed?                        | Why                                                                                                                                             |
| --------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **`claim_integration_intent`** enhanced | **Yes**                        | Add `retrying` + `next_attempt_at` eligibility, ordered-stream gating, `aggregate_revision` ordering, lease assignment, pending-age gating. **Signature unchanged — no lease or label parameter (§5.4)** |
| **`mark_integration_dispatch_started`** | **Yes — new**                  | The §7 boundary. Must carry the **full** fencing predicate in one statement, and must be write-once                                             |
| **`recover_expired_integration_claim`** | **Yes — new**                  | Settles expired leases per §8. **Settles only; never claims**                                                                                   |
| **`complete_integration_attempt`** enhanced | **Yes**                    | Compute and persist `next_attempt_at` for `failed_transient`; enforce the attempt ceiling and horizon. **Signature unchanged**                   |
| `renew_integration_claim`               | **No — deferred** (§6)         | No capability needs it yet                                                                                                                      |
| Ordered-stream coordination function    | **No**                         | Option E needs no function: the index *is* the coordination                                                                                     |
| Retry scheduling as a separate function | **No**                         | It must be in the **same transaction** as the settlement that caused it, so it belongs inside completion                                         |

**Net: two new functions, two enhanced. Four total, from two today.**

### 31.1 The earlier three-function inventory is superseded

F062.2D-1 §9 named `claim_integration_intent`,
`complete_integration_attempt` and `recover_expired_integration_claim`.
F062.2D-2B proved that inventory was premature. The evidence now supports a
different split: **the dispatch-boundary marker is a fourth function that the
original inventory did not anticipate, and it is the one that makes safe
automatic recovery possible at all.** A three-function inventory is not a
requirement to preserve.

### 31.2 Hardening carried forward

Every F062.2D-2B property applies unchanged to both new functions: owned by
`reqro_integration_function_owner`; `SECURITY DEFINER`; `VOLATILE`; typed
parameters with no catch-all JSON or text; no caller-controlled object
identifier; no dynamic SQL; every application object fully qualified;
`search_path` pinned to `pg_catalog, public, pg_temp` per the reviewed
contract; `PUBLIC EXECUTE` revoked by full signature; raw claim tokens never
persisted, returned, interpolated or named in an exception.

And one addition specific to recovery:

> **`recover_expired_integration_claim` must not accept a duration, timeout,
> interval or "force" parameter.** It reads expiry from
> `claim_expires_at` and policy from pinned configuration. A caller-supplied
> interval would let a worker recover live claims belonging to other workers,
> which is lease stealing with extra steps. A bounded `limit` on rows processed
> per call is acceptable; a bounded policy parameter is not.

---

## 32. Recommended F062.2D-1 amendment

**F062.2D-1 is not edited here or on this branch.** Amending an accepted
decision record is a separate, explicitly authorized act. The amendment should
cover exactly five points:

| # | Amendment                                                                                                                                                                                 |
| - | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | **`search_path` refinement.** §9's `pg_catalog, pg_temp` becomes `pg_catalog, public, pg_temp`, conditional on the tested invariant that no untrusted principal holds `CREATE` on the application schema. Reviewed and approved under F062.2D-2B |
| 2 | **Recovery deferral, and its replacement.** §9's recovery function is not a placeholder: it becomes implementable only once the dispatch boundary exists. Record the §8 rule — expired lease plus pre-dispatch proof permits automatic recovery; expired lease plus possible dispatch produces `ambiguous` |
| 3 | **The dispatch-boundary function model.** `mark_integration_dispatch_started` is new and was not in the three-function inventory. Record the worker-protocol obligation: **nothing may be transmitted before the marker commits** |
| 4 | **Lease model and ownership.** One `claim_expires_at` on the attempt; no `claimed_by`; no renewal initially; **no caller-supplied lease parameter**, superseding §12's `claim_integration_intent(connector, lease, worker_label)` sketch |
| 5 | **Aggregate serialization and retry eligibility.** Record Option E as the serialization mechanism, `supports_ordering` as the existing governing capability, and database-owned `next_attempt_at` as the retry gate with no worker influence |

Plus the F062.1 amendment §30.2 identifies: a `reason_code` field carrying
bounded Reqro-owned worker and lifecycle causes, kept semantically separate
from the destination-shaped `failure_category`; **a precise bounded
pre-dispatch recovery reason, whose final name that amendment owns**; and the
narrow permission for the database-authored recovery path to settle
`failed_transient` without fabricating a destination category.

**A decision amendment is required before production worker activation**, not
merely desirable: the accepted record and the implementation currently differ on
point 1 already.

---

## 33. The F062.2D-3 gate

> ### Is it safe to create `reqro_integration_worker` and grant EXECUTE immediately after this decision?
>
> # NO.

**This decision resolves the *semantics*. It implements none of the
*persistence or functions* those semantics require.** Granting a worker
EXECUTE today would hand it authority over an API that cannot express the
safety rules decided above.

### 33.1 Exactly what would go wrong

| Grant EXECUTE today and…                                                                      | Consequence                                                                                        |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| …a worker claims and dies                                                                     | **The obligation is wedged permanently.** No lease exists, so nothing can ever recover it          |
| …a worker claims an ordered aggregate                                                         | **Ordering is silently violated.** Nothing enforces one in-flight obligation per aggregate         |
| …an attempt settles `failed_transient`                                                        | The obligation reaches `retrying` and is **never claimable again** — a second permanent wedge       |
| …a worker crashes before dispatch                                                             | Indistinguishable from a possibly-dispatched crash, so the only honest recovery is `ambiguous` — **manufacturing operator work from a trivially safe case** |
| …a destination rate-limits                                                                    | No backoff exists, so the worker would retry as fast as it can claim — **a retry storm against a destination that asked for less** |

**The first, third and fourth are precisely the "authority that can wedge
obligations permanently" the authorization forbids granting.**

### 33.2 Required before worker grants

- **Mandatory:** persistence items 1, 2, 4, 5, 6 and the function work in §31 — lease, dispatch boundary, retry eligibility, ordered-stream enforcement, and the four functions.
- **Mandatory:** the F062.1 `reason_code` amendment (§30.2), without which recovery cannot record what it did.
- **Mandatory:** observability gaps 1 and 2 (§27.2), without which a wedged or crash-looping worker is invisible.
- **Not required for a loopback worker:** policy item 7 may remain provisional, and `renew_integration_claim` stays deferred. A loopback adapter performs no network I/O, so provisional numbers are adequate for proving the cycle — which is F062.2D-0's own staging.

### 33.3 One consequence worth stating

> **Automatic dead-lettering must not be implemented before F062.2A's
> authorized `dead_lettered -> pending` replay evidence exists.** `dead_lettered`
> currently has **no outgoing edge in the database at all**, so an obligation
> that reaches it is permanently unreachable. Adding automatic entry to a state
> with no exit would convert a bounded retry policy into permanent delivery
> loss. **Entry and exit must land together, or entry must wait.**

---

## 34. Recommended implementation sequence

The authorization sketches five slices. The evidence supports **four**, because
two of the sketched persistence slices touch the same table with the same guard
and reviewing them together is safer than reviewing them apart.

| Slice                                                              | Scope                                                                                                                              | Depends on | Why grouped this way                                                                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| **F062.2D-2C-1** — lease and dispatch-boundary persistence          | Attempt fields 1, 2, 3; extend the settle guard for write-once marker and reason code; the recovery-scan partial index; the F062.1 `reason_code` amendment | 2C-0       | All three fields live on one table behind one guard. Splitting them means amending the same guard three times      |
| **F062.2D-2C-2** — ordered-stream and retry-eligibility persistence | Outbox fields 4, 5; the Option E partial unique index; **the ordered-key CHECK requiring the FIFO revision component when `requires_ordered_delivery` (§12.3)**; extend the outbox guard to permit `next_attempt_at` on a transition and to assign `requires_ordered_delivery` at enqueue | 2C-1       | Same table, same guard, same reasoning. The ordering index needs field 5, so they cannot sensibly be separated. **The CHECK adds a new enqueue requirement on an accepted path and must be reviewed as such** |
| **F062.2D-2C-3** — function API hardening                           | Enhance claim and completion; **implement the §13.1 predecessor predicate with its own concurrency tests**; add `mark_integration_dispatch_started` and `recover_expired_integration_claim`; policy columns (item 7) | 2C-1, 2C-2 | Functions should land only once every field they reference exists, so no function is written against a moving schema. **The predecessor predicate is function-enforced, so the index will not catch a bug in it** |
| **F062.2D-3** — worker identity and EXECUTE grants                  | Create `reqro_integration_worker`; grant `USAGE` on the API schema and `EXECUTE` on exactly four functions by full signature         | 2C-3       | Unchanged in purpose, now with a complete and safe API to grant                                                   |
| **F061.3C** — observability gaps (parallel)                         | The seven concepts in §27.2                                                                                                        | 2C-0       | F061-owned, independent of F062 persistence, and can proceed concurrently                                          |
| **F062.2D-4** — loopback claim loop                                 | The full cycle against a loopback adapter. No egress, no credentials                                                                | 2D-3       | Already F062.2D-0's planned staging. **This is where provisional numbers get measured**                            |

**Each of 2C-1 and 2C-2 modifies an accepted guard** — F062.2D-2A's attempt and
outbox guards respectively — and must be reviewed as a change to an accepted
protection, with the existing immutability tests extended rather than relaxed.

---

## 35. Threat model

| Threat                                              | Control                                                                                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Duplicate external side effects**                  | The §7 dispatch boundary; `ambiguous` never blind-retried (§8.2); re-attempt only where the **pinned** snapshot declares `supports_idempotency_key`; idempotency key derived from the stable `integration_id` (§24); lease floor above the request budget so a live worker is never fenced mid-call (§5.2) |
| **Stale worker settlement**                          | The existing single-statement fence — Organization, obligation, attempt, openness, `claim_generation`, token digest — **already implemented and tested** in F062.2D-2B. Returns undifferentiated `false` |
| **Expired worker resuming**                          | Its attempt is already settled, so `completed_at is null` fails. Scenario §10 G, already proven                                                                       |
| **Lease stealing**                                   | No caller-supplied interval or force parameter (§31.2); recovery fences on `claim_expires_at` written by the database; renewal, if ever added, carries the full fencing predicate (§6.2) |
| **Indefinite lease renewal**                         | Renewal deferred entirely (§6). If adopted: bounded cumulative limit, enforced database-side, never past the pending-age ceiling                                      |
| **Aggregate reordering**                             | **Two independent controls:** Option E's partial unique index makes mutual exclusion atomic rather than check-then-act (§12.2), and the §13.1 predecessor predicate enforces strict FIFO over **all** non-terminal siblings — so a retry delay or an unresolved ambiguity on an earlier obligation blocks a newer one instead of letting it overtake. Ordered-key components are all `NOT NULL` so the index cannot be silently defeated by NULL uniqueness (§12.3). No state-sync coalescing approved (§13.4) |
| **Poison aggregate / head-of-line blocking**         | The index key includes the aggregate, so blocking is per-stream (§14). No global serialization point. Unordered connectors are excluded from the index entirely        |
| **Retry storms**                                     | Capped exponential backoff with full jitter, database-computed; attempt ceiling; retry horizon; `rate_limited` floor (§18.3); worker cannot influence `next_attempt_at` |
| **Thundering herd after an outage**                  | Full jitter de-correlates resumption. **Residual risk on connector re-enable** (§22.1), where delays were served while disabled — mitigated by the worker's claim-rate bound, **not** by rewriting schedules |
| **Retry amplification during secret-manager failure** | Prevention, not classification: `worker_readiness = not_ready` means no claim at all (§23.2). Internal failures consume no attempt budget and trip no destination breaker (§23.1, §23.3) |
| **Policy change retroactivity**                      | Schedules come from the **pinned** revision; the platform ceiling applies only as a tightening `min` (§20); operators may tighten retroactively but never widen (§26.2) |
| **Operator bypass**                                  | Every override is trusted-operator/PIM only, leaves durable evidence, and lives in **separate functions** the worker never receives EXECUTE on (§26.1). Requeue windows are cumulatively bounded |
| **Ambiguous outcome retried as ordinary transient**  | **Four independent controls.** `destination_timeout` is accepted only as `ambiguous`; `failed_transient` is accepted only with two destination categories; `ambiguous` is unreachable by the retry predicate (§21); the `ambiguous -> dispatching` edge is capability-gated in the database guard. **Three of the four are already implemented** |

### 35.1 The residual risks, named

Not controls — honest limitations a reviewer should see:

1. **The §7.3 protocol is a worker obligation, not a database guarantee.** The database cannot verify that a worker committed its marker before transmitting. A buggy or malicious worker could transmit first, and the pre-dispatch recovery path would then wrongly treat a possibly-dispatched attempt as safe. **This is the single most important thing F062.2D-3 must state as a worker contract and F062.2D-4 must prove by test.** Mitigations: the worker is Reqro-owned code, not third-party; the loopback slice can prove ordering by observation; and `side_effect_risk` modulates the consequence (§7.5).
2. **Connector re-enable surge** (§22.1) has no complete control, only a bound.
3. **Every numerical value is provisional** (§36), and §5.2 establishes that a too-short lease is actively dangerous rather than merely suboptimal.
4. **Scenario §10 E** leaves a worker holding a correct outcome it cannot persist. The outcome is lost to ambiguity even though it was known. No control recovers it; reconciliation resolves it afterwards.

---

## 36. Unresolved numerical values and open questions

**Every number below is deliberately unresolved.** All require either the first
real connector's API contract or a platform/operations decision.

| # | Value                                                   | Blocked on                                                              |
| - | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1 | Platform default lease duration                         | First connector's measured total request budget                          |
| 2 | Per-connector lease overrides                           | Per-destination timeouts                                                 |
| 3 | Lease floor (total request budget)                      | Connection, response and processing budgets                              |
| 4 | Minimum retry delay                                     | Destination rate limits and retry guidance                               |
| 5 | Maximum retry delay (cap)                               | Operations' acceptable staleness                                         |
| 6 | Maximum attempt count                                   | Platform/product decision                                                |
| 7 | Maximum retry horizon                                   | Must be `<=` the pending-age ceiling, itself unresolved in F062.2D-1A    |
| 8 | `rate_limited` minimum delay (§18.3)                    | Published destination rate limits                                        |
| 9 | Pending-age platform ceiling                            | F062.2D-1A, still open                                                   |
| 10 | Recovery scan frequency and per-call row limit          | Expected claim volume                                                    |
| 11 | Cumulative renewal bound, **if** renewal is ever adopted | Only if §6's deferral is revisited                                      |

### 36.1 Open policy questions, not numbers

| # | Question                                                                                                                           | Recommended provisional answer                                                           |
| - | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1 | Do **pre-dispatch** lease recoveries consume the attempt budget? (§23.2)                                                            | **No**, but bound them separately so a crash-looping worker cannot generate unlimited attempts |
| 2 | Does an ordered stream stay blocked when its ambiguous obligation is **dead-lettered** for age? (§15.2)                             | **Yes, it stays blocked** until explicit operator release — the uncertainty is unchanged  |
| 3 | Should `retired` dead-letter outstanding obligations immediately? (§22.2)                                                           | Open. A data-retention and operator-authority question, not an execution-semantics one   |
| 4 | Which `failure_category`/`reason_code` shape is adopted? (§30.2)                                                                    | `reason_code` plus the narrow database-authored permission                                |
| 5 | Should the `ambiguous -> dispatching` automatic path additionally require `side_effect_risk <> 'physical'`? (§7.5)                   | **Yes** — recommended as a tightening of existing edge policy                             |

---

## Related

- [F062.1 — Enterprise integration contracts foundation](F062-1-integration-contracts-foundation.md) — the authoritative state, outcome, category and capability vocabularies this decision reuses without extension, except as §30.2 records
- [F062.2A — Transactional outbox persistence readiness](F062-2A-transactional-outbox-persistence-readiness.md) — the `reason_code` worker group, `retry_eligible`, and the authorized `dead_lettered -> pending` replay model
- [F062.2B — Connector metadata persistence foundation](F062-2B-connector-metadata-persistence-foundation.md) — the capability columns and the two-revision model that makes policy pinning free
- [F062.2C — Transactional outbox and atomic enqueue](F062-2C-transactional-outbox-atomic-enqueue.md) — the obligations a claim selects, and the enqueue guard that would assign `requires_ordered_delivery`
- [F062.2D-0 — Delivery worker security and operational readiness](F062-2D-0-delivery-worker-security-readiness.md) — the ambiguous-recovery contract (§5, §19), the per-aggregate in-flight model (§21), and the lease-versus-request-budget rule (§17)
- [F062.2D-1 — Worker identity and database function security decision](F062-2D-1-worker-identity-db-function-security-decision.md) — the function-security model; §32 records the amendment it needs
- [F062.2D-1A — Pending age, expiry and dead-letter policy](F062-2D-1A-pending-age-dead-letter-policy.md) — the pending-age clock, the `min` precedence model this decision reuses, and the convergence test that forbids state-sync coalescing
- [F062.2D-2A — Delivery attempt and fencing persistence](F062-2D-2A-delivery-attempt-fencing-persistence.md) — the attempt table, the immutability guards every proposal here must extend rather than relax, and the `claim_generation` separation that made §9 decidable
- [F062.2D-2B — Worker claim and completion database function API](F062-2D-2B-worker-database-function-api.md) — the two implemented functions, the three blockers this decision resolves, and the hardening §31.2 carries forward
- [F061.3A — Integration worker observability contracts](F061-3A-integration-worker-observability-contracts.md) — the existing worker metric and health vocabulary §27 maps onto
- [F061.3B — Age and dead-letter observability contracts](F061-3B-age-dead-letter-observability-contracts.md) — why dead-letter count must not be read as an age-transition count
- [ADR-024 — Transaction-time request authorization](../architecture/decisions/ADR-024-transaction-time-request-authorization.md) — the uncertain-result rule that forbids automatically retrying after an ambiguous outcome
- [ADR-027 — Platform operator bootstrap and recovery](../architecture/decisions/ADR-027-platform-operator-bootstrap-recovery.md) — the trusted operator architecture §26 reuses conceptually
