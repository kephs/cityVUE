# F062.2D-2C-3-0 — Worker execution policy and function signatures

> **POLICY AND SIGNATURE DECISION ONLY. NOTHING IS IMPLEMENTED.**
>
> **NO MIGRATION, NO SQL FUNCTION CHANGE, NO GRANT, NO WORKER RUNTIME, NO EXTERNAL TRAFFIC.**
>
> **F062.2D-3 REMAINS BLOCKED.**

This is the mandatory policy gate immediately before **F062.2D-2C-3 — Worker
claim, retry scheduling, recovery and strict-FIFO function hardening**. It adds
one document and changes no production source.

**No ADR number is allocated.**

> **STATUS: the decisions below were frozen by the F062.2D-2C-3-0 architecture
> review.** Recommendation C was accepted. Ten review decisions are
> authoritative and are marked **FROZEN BY REVIEW** where they appear: the
> recovery function name (§2.1), `dead_lettered` as an ordered blocker
> (§4.3), destination budget exhaustion (§13.3), pre-dispatch recovery
> exhaustion (§17.3), recovery `EXECUTE` ownership (§27.4), `rate_limited`
> scheduling (§19), backoff terminology (§14), the claim return expansion
> (§22, §28.1), the 3B policy ownership split (§6.2) and the observability
> gate (§25). **No numerical value is selected anywhere.**

Baseline: `origin/main` at `1584bc03d41e3b260621c9a5244b099e0ef4a6ba`, which
carries F062.2D-2C-2 (`5015c20`) as a verified ancestor, merged as PR #33.

**The headline conclusion is recommendation C (§30): a policy and persistence
gap must be closed before any part of 2C-3's retry or lease behaviour can be
implemented without forcing arbitrary constants into a security-sensitive
migration.** Three gaps are named in §31, and one sub-slice is identified that
is implementable immediately because it needs no number at all.

---

## 1. Baseline, reconstructed from source

| Item | Value |
| --- | --- |
| `origin/main` | `1584bc03d41e3b260621c9a5244b099e0ef4a6ba` (fetched) |
| Migrations | **55**, highest ordinal `20261025000000`; next would be **56 / `20261026000000`** |
| Claimable states | **`pending` only** — Migration 53 selects `state = 'pending'` with no open attempt |
| Current claim signature | `claim_integration_intent(target_organization uuid, target_connector uuid, raw_claim_token text)` returning a **20-column** table |
| Current completion signature | `complete_integration_attempt(target_organization uuid, target_obligation uuid, target_attempt uuid, expected_claim_generation bigint, raw_claim_token text, attempt_outcome varchar(18), attempt_failure_category varchar(28))` returning `boolean` |
| Persisted lease / dispatch / reason fields | `integration_delivery_attempt.claim_expires_at`, `.dispatch_started_at`, `.reason_code` (Migration 54) |
| Persisted ordering / retry fields | `integration_outbox.requires_ordered_delivery` (NOT NULL, database-derived), `.next_attempt_at` (nullable) (Migration 55) |
| Failure categories | **ten**: `destination_unavailable`, `destination_timeout`, `destination_rejected`, `rate_limited`, `authentication_failed`, `destination_unconfigured`, `projection_failed`, `contract_unsupported`, `malformed_request`, `internal_failure` |
| `transientIntegrationFailures` | **exactly two**: `destination_unavailable`, `rate_limited` |
| Lifecycle reason codes persisted | **exactly two**: `lease_expired_pre_dispatch`, `lease_expired_uncertain` |
| Ordering vocabulary | `orderingGuarantees = ['none', 'per_aggregate']`, pinned per revision in `integration_connector_audit.supports_ordering` |
| Ordered-stream index | `integration_outbox_ordered_stream_in_flight` — unique on the stream key `where requires_ordered_delivery and state in ('dispatching','ambiguous')`. **Mutual exclusion only** |
| `dead_lettered` outgoing edges | **none** — `deliveryStateTransitions.dead_lettered = []` |

### 1.1 Every numerical policy is unresolved

A repository-wide search for an authoritative lease duration, base or maximum
retry delay, retry ceiling or horizon returns **nothing**. No approved document
supplies a number. §26 tabulates all thirteen.

### 1.2 Observability: contracts exist, emission does not

**F061.3C has landed** (PR #29) and adds exactly the five concepts earlier
slices identified as gaps. But:

- `integration-telemetry.ts:173` — `export function integrationSlisImplemented(): false { return false; }`
- `NO_TELEMETRY` is a no-op port;
- only the two contract modules reference the concept vocabulary — **no producer emits anything**;
- F061.3C states it directly: *"Concept declarations are not instruments or an emission API."*

§25 reports the gate per item.

---

## 2. The four-function API

**Confirmed correct. No change in count or boundary**, so no STOP condition
under the authorization's §1.

| # | Function | Status |
| - | --- | --- |
| 1 | `claim_integration_intent` | implemented; to be enhanced |
| 2 | `mark_integration_dispatch_started` | **not implemented** |
| 3 | `complete_integration_attempt` | implemented; to be enhanced |
| 4 | **`recover_expired_integration_claim`** | **not implemented**; name **FROZEN BY REVIEW** — see §2.1 |

No generic CRUD-style worker function is proposed, and no fifth function: the
operator surface stays separate under a different principal.

### 2.1 Naming discrepancy, surfaced rather than silently resolved

This authorization names the fourth function
**`recover_expired_integration_attempt`**. **Every prior repository document
uses `recover_expired_integration_claim`** — 13 occurrences across eight
documents including F062.2D-0, F062.2D-1, F062.2D-2A, F062.2D-2B, F062.2D-2C-0,
F062.2D-2C-0A, F062.2D-2C-1 and F062.2D-2C-2.

> ### FROZEN BY REVIEW: the name is permanently `recover_expired_integration_claim`.
>
> **`recover_expired_integration_attempt` must not be used.**
>
> **Reason, as accepted:** the **claim** expires; the **attempt** is the
> evidence that recovery settles. The attempt is never "recovered" — it is
> settled, immutably, as the record of what that claim did or failed to do.

This also preserves the `_claim` references already merged in eight documents,
and the rest of this document uses it throughout.

---

## 3. `claim_integration_intent` — future responsibilities

**Must eventually own**, all inside one statement-level atomic selection:

1. candidate selection (§21);
2. Organization isolation — already implemented, and a cross-tenant request is indistinguishable from "no work": zero rows, no detail;
3. connector eligibility — `lifecycle_state in ('active','degraded')`, already implemented;
4. retry eligibility (§5);
5. **strict-FIFO predecessor exclusion (§4)**;
6. ordered-stream concurrency — the Migration 55 index is the authoritative backstop, with a `not exists` pre-filter for a clean skip;
7. attempt evidence creation — already implemented;
8. claim generation — assigned by the F062.2D-2A guard, not by the function;
9. token digest storage — already implemented;
10. **lease expiry creation (§6)**;
11. stale-claim fencing foundation — the generation and digest the later fence reads.

**Must NOT**: perform network I/O; start dispatch; mark external success;
perform recovery; calculate a destination outcome; accept a caller-created
durable timestamp. **And must not accept a lease duration** (§6.3).

---

## 4. Strict FIFO semantics — FROZEN

> **For an obligation with `requires_ordered_delivery = true`, candidate B is
> claimable only if no earlier unresolved obligation A exists in the same
> ordered stream.**

| Element | Value |
| --- | --- |
| **Stream key** | `(organization_id, integration_connector_id, aggregate_type, aggregate_id)` — all four already `NOT NULL` |
| **Sequence key** | `(aggregate_revision, created_at, id)` ascending. `aggregate_revision` is `NOT NULL` for ordered obligations by the Migration 55 constraint |
| **"Earlier"** | a sibling whose sequence key sorts strictly before the candidate's |

### 4.1 Which predecessor states block

| State | Blocks? | Authority |
| --- | --- | --- |
| `pending` | **BLOCKS** | non-terminal |
| `retrying` | **BLOCKS** | non-terminal — **including when `next_attempt_at` is in the future** (§4.2) |
| `dispatching` | **BLOCKS** | non-terminal |
| `ambiguous` | **BLOCKS** | non-terminal; F061.3C names this class `ambiguous_predecessor` |
| `accepted` | **does not block** | F062.2D-2C-0A §17, resolved: a connector without `reports_terminal_state` can never reach `acknowledged`, so requiring it would deadlock the stream |
| `acknowledged` | does not block | terminal |
| `failed_permanent` | does not block | terminal |
| `refused` | does not block | terminal |
| **`dead_lettered`** | **BLOCKS** | **FROZEN BY REVIEW** — §4.3 |

### 4.2 Temporary ineligibility never permits overtaking

> **An older `retrying` obligation whose `next_attempt_at` is in the future
> still blocks a newer ordered obligation.**

This is the whole reason the predecessor predicate exists as a **separate
control** from the ordered-stream index. Eligibility and blocking are
deliberately asymmetric: a predecessor blocks by *existing unresolved*, not by
being claimable. `ORDER BY` cannot express it, because an ineligible
predecessor is filtered out of the candidate set before the sort — so a newer
sibling would be claimed first with no concurrency involved and no constraint
violated.

The same applies to a predecessor made temporarily ineligible by a
non-dispatchable connector or a pending-age gate.

### 4.3 `dead_lettered` as an ordered predecessor — FROZEN BY REVIEW

> ### `dead_lettered` MUST BLOCK strict FIFO.
>
> **Ordered-stream resolution is a separate question from generic
> state-machine terminality.** Until a reviewed replay, skip or
> manual-disposition evidence model exists, a `dead_lettered` predecessor is
> **not considered resolved for ordered-predecessor purposes**, even though
> F062.1 lists it among `terminalDeliveryStates`.

The two notions were conflated in the first draft of this document, and the
review separated them. They answer different questions:

| Notion | Question it answers | Where it lives |
| --- | --- | --- |
| **State-machine terminality** | May automatic processing move this obligation any further? | F062.1 `terminalDeliveryStates` |
| **Ordered-stream resolution** | Is it safe for a *successor* to proceed past this obligation? | the §4 predecessor predicate |

An obligation can be terminal for its own processing and still unresolved for
its stream, and `dead_lettered` is exactly that case: dead-lettering an
obligation **abandons** it rather than establishing what happened at the
destination. For an `ambiguous` obligation that is dead-lettered, the unknown
side effect is not resolved — only given up on. Letting a successor proceed
would reorder around destination state nobody can describe, and that is the
irreversible direction.

**Consequence, stated plainly:** a dead-lettered obligation holds its ordered
stream until an operator disposes of it with evidence. That is deliberate —
the stream stops rather than silently reordering — and it makes the future
replay, skip or disposition evidence model a prerequisite for unblocking, not
an optimisation.

This also makes §13.3 and §17.3 coherent: a parked obligation keeps its
successors blocked, which is the same property by a different route.

---

## 5. Retry eligibility semantics — FROZEN

| Condition | Claimable? |
| --- | --- |
| `pending` | **Yes**, subject to every other gate |
| `retrying` and `next_attempt_at IS NULL` | **No** — nothing scheduled it, so it is not eligible. The fail-closed reading, and the only shape anything produces today |
| `retrying` and `next_attempt_at > ` database time | **No** |
| `retrying` and `next_attempt_at <= ` database time | **Yes**, subject to every other gate |
| every other state | **No** |

**Database time only** — `clock_timestamp()`, which is the repository's sole
convention (zero uses of `now()` or `transaction_timestamp()` across the
integration migrations). No worker clock has authority over anything, and **no
timer changes state**: a due schedule is inert until a claim reads it.

One carried-forward consequence of Migration 55: a `retrying` obligation
holding a schedule cannot transition to `dispatching` unless the same statement
clears `next_attempt_at`. **2C-3's claim must clear it when claiming a retrying
row.**

---

## 6. Lease duration authority

### 6.1 The four options, assessed

| Option | Assessment |
| --- | --- |
| **A. Hard-coded SQL constant** | **Rejected.** Changing it would require a migration, it cannot differ per connector, and §5 of the authorization forbids inventing the number — so the constant would be arbitrary and unreviewable at the one place it matters |
| **B. Caller-supplied duration** | **Rejected outright on security grounds.** A worker could request a near-zero lease (fencing itself mid-call and manufacturing ambiguity from healthy dispatches) or an effectively permanent one (wedging an obligation for as long as it liked). F062.2D-0 §12's `claim_integration_intent(connector, lease, worker_label)` sketch is already superseded by F062.2D-2C-0A §11 |
| **C. Reviewed database / platform configuration** | **RECOMMENDED in principle — but no suitable mechanism exists yet.** §6.2 |
| **D. Another existing authoritative mechanism** | **Partially available.** The connector + its append-only audit snapshot is already the repository's pinned-policy mechanism and needs no new pinning machinery (F062.2D-2C-0A §21.3). The admin-configuration foundation (`20260929000000`) is **unsuitable for a platform ceiling** because it is tenant-admin writable, and a tenant must not be able to widen a platform safety bound |

### 6.2 Smallest safe architecture, recommended

Two layers, reusing what exists wherever possible:

1. **Connector-level policy** stored as additional `integration_connector` columns **and mirrored into `integration_connector_audit`**, exactly as capabilities already are. An obligation's `pinned_connector_configuration_revision` then pins its policy **for free** — no `retry_policy_revision` column, no policy-epoch table, and reproducibility comes from machinery already proven by Migration 55's ordering derivation.
2. **A platform ceiling** in a new single-row, operator-only policy relation, applied as a **strictly tightening `min`** at evaluation time (F062.2D-1A's rule, reused for a second quantity rather than invented again).

> **Critically, this architecture does not require the numbers to be decided.**
> Policy stored as configuration means the migration encodes a *mechanism*, not
> a constant: a deployment supplies the value and the operator seeds the
> ceiling. That is what makes it possible to proceed without forcing an
> arbitrary constant into a security-sensitive migration — **but it is
> persistence work, and therefore cannot live inside 2C-3's function slice**
> (§30).

### 6.2a FROZEN BY REVIEW: two authority classes, not one layered number

The review refined §6.2 into two **trust classes**, which must not be
collapsed:

| Class | Stored where | Who may change it | Versioning |
| --- | --- | --- | --- |
| **Destination / connector-pinned policy** | `integration_connector`, mirrored into `integration_connector_audit` | deployment and client operations, within the platform bound | **versioned with the connector audit snapshot** where appropriate, so an obligation's pinned revision pins its policy |
| **Platform / operator-owned safety policy** | a separate operator-owned relation | **platform operators only** | not tenant-versioned; it is a ceiling, not a per-obligation semantic |

> **Platform recovery and safety limits must NOT be placed in ordinary
> tenant-admin connector configuration.** A tenant administrator must not be
> able to widen a bound that exists to protect the platform and the
> destination — which is precisely why the existing admin-configuration
> foundation is unsuitable (§6.1 option D).

**And one fail-closed rule, frozen:**

> **Effective lease policy must FAIL CLOSED if the platform constraints would
> make the lease shorter than or equal to the complete request execution
> budget.** It must refuse to issue a lease rather than issue one that fences a
> live worker mid-call — which would mark healthy deliveries ambiguous and,
> where a capability permits re-attempt, manufacture duplicates from entirely
> healthy dispatches.

Note that this is stricter than “strictly greater than” as a comment: the
equality case is also refused, because a lease exactly equal to the budget
leaves no margin for the settlement write itself.

**No numerical value or default is chosen here.**

### 6.3 Ownership mechanism and numbers, reported separately

| | |
| --- | --- |
| **Ownership mechanism** | **DECIDED** — connector configuration (pinned via the existing audit) plus an operator-only platform ceiling applied as a tightening `min`. The worker owns nothing |
| **Numeric value** | **UNRESOLVED.** No approved document supplies a lease duration, and none is chosen here |
| **Floor** | **DECIDED as a rule, UNRESOLVED as a number.** F062.2D-0 §17: the total request budget must be **strictly less** than the lease. A lease shorter than a legitimate dispatch fences a live worker mid-call, recovery marks a healthy delivery ambiguous, and a capability permitting retry then produces a genuine duplicate. **This is a security control, not a tuning preference** |

---

## 7. Lease timing semantics — FROZEN

```
claim_expires_at = clock_timestamp() + <reviewed lease duration>
```

assigned by the database when a new claim succeeds. No worker clock. **No
renewal in the initial worker design** (F062.2D-2C-0's Model A: the lease
already strictly exceeds the total request budget, so a legitimate dispatch
fits inside one lease by construction, and no declared capability describes a
long-running operation).

> **Expiry authorizes recovery; successful generation rollover fences the stale
> claimant.**

Expiry alone does **not** invalidate a legitimate claimant and does **not**
prevent completion. `claim_expires_at` therefore appears in **no** completion
fence predicate — a property already implemented and tested in F062.2D-2C-1,
which must be preserved.

One implementation note for 2C-3: `started_at` is assigned by the F062.2D-2A
guard, and `claim_expires_at` is immutable after insert, so the claim function
cannot compute `started_at + interval` *after* the insert. Either the guard
authors the expiry from policy, or the function supplies a value it computes
from `clock_timestamp()` in the same statement. **The guard-authored variant is
preferred** because it keeps the one authority in one place; it is a
persistence change, which reinforces §30.

---

## 8. `mark_integration_dispatch_started` — contract FROZEN

### 8.1 Signature

```sql
reqro_integration_api.mark_integration_dispatch_started(
  target_organization      uuid,
  target_attempt           uuid,
  expected_claim_generation bigint,
  raw_claim_token          text
) returns boolean
```

**Four parameters — the minimum that proves ownership.** The obligation id is
deliberately *absent*, unlike completion: completion needs it because it also
updates the outbox row, whereas the marker touches only the attempt, and the
attempt row is already Organization-qualified. Adding it would be
defence-in-depth against nothing.

### 8.2 Required behaviour

- validate current attempt ownership: Organization, attempt, `claim_generation`, token digest;
- require an **open** attempt (`completed_at is null`);
- require `dispatch_started_at IS NULL` **or** an existing marker belonging to this same claim (§8.3);
- **database-author the timestamp** — Migration 54's guard already discards whatever a caller supplies and stores `clock_timestamp()`, proven by forging a 1999 value;
- refuse a stale generation or token;
- refuse an already-completed attempt — Migration 54's guard already refuses any update to a settled row;
- **change no outbox state.** The obligation stays `dispatching` throughout.

### 8.3 Idempotency — safe, and deliberately so

> **Recommended: idempotent for the rightful owner, fenced for everyone else.**

Returns `true` when the fence matches, whether or not the marker needed
setting; `false` when the fence fails. **The timestamp is never re-stamped**, so
Migration 54's write-once property is preserved intact.

This matters operationally: if a worker's first marker call commits but the
response is lost, a naive non-idempotent design would raise on retry and leave
the worker unable to distinguish *"I already marked this"* from *"someone else
owns it"* — pushing it toward either abandoning safe work or transmitting
without a committed marker.

To avoid a check-then-act window the read and the conditional write must be one
statement, conceptually a CTE that locks the fenced row `FOR UPDATE` and
updates only where the marker is null. **A blind `UPDATE … WHERE fence AND
dispatch_started_at IS NULL` is insufficient**, because zero rows cannot
distinguish "already marked" from "fence failed".

### 8.4 The protocol is not collapsible

```
claim                       -> COMMIT
prepare the request locally (NO external I/O)
mark dispatch started       -> COMMIT      <-- the boundary
only then transmit externally
settle                      -> COMMIT
```

**The marker and the transmission must not share a transaction**, and the
marker must not be collapsed into the claim. A worker that transmits before its
marker commits creates a transmitted-but-unmarked attempt, which recovery would
treat as provably pre-dispatch and retry — producing exactly the duplicate the
boundary exists to prevent. This is a worker obligation the database cannot
verify, and F062.2D-3 must state it as a contract.

---

## 9. Recovery function contract — FROZEN

Operates only on attempts that are **still open** and **truly expired**
(`completed_at is null` and `claim_expires_at < clock_timestamp()`, compared on
the database clock).

### 9.1 Path A — pre-dispatch expiry (`dispatch_started_at IS NULL`)

| | |
| --- | --- |
| Attempt evidence | `outcome = 'failed_transient'`, `failure_category = NULL`, `reason_code = 'lease_expired_pre_dispatch'` |
| Meaning | **a Reqro execution failure, not a destination failure.** The destination was provably never contacted |
| Destination retry budget | **not consumed** (§12) |
| Destination retry exponent | **not advanced** (§14) |
| Outbox result | **`dispatching → retrying`**, with `next_attempt_at` from a **platform recovery delay** — see §18, where the transition graph makes this the only available answer |

### 9.2 Path B — possibly-dispatched expiry (`dispatch_started_at IS NOT NULL`)

| | |
| --- | --- |
| Attempt evidence | `outcome = 'ambiguous'`, `failure_category = NULL`, `reason_code = 'lease_expired_uncertain'` |
| Outbox result | **`dispatching → ambiguous`**, with **no** `next_attempt_at` (Migration 55 forbids a schedule outside `retrying`) |
| Retry | **none, blind or otherwise.** `ambiguous` is unreachable by the retry predicate |
| Resolution | the existing capability-gated `ambiguous → dispatching` edge (requires pinned `supports_idempotency_key`), or `ambiguous → accepted` on reconciliation / read-after-write evidence, or operator disposition |

**A human or reconciliation is required** unless a later architecture
explicitly proves otherwise. No duration converts Path B into Path A.

Both shapes are already **constraint-enforced** by Migration 54, including the
boundary cross-checks, so a recovery function cannot write either shape
dishonestly even if its own logic were wrong.

---

## 10. Recovery concurrency and fencing

### 10.1 Required semantics

> **Lease expiry alone does not fence the original claimant. Whichever
> transaction first establishes authoritative recovery or completion determines
> the durable outcome. After recovery, stale completion must fail.**

| Race | Outcome |
| --- | --- |
| Original claimant completes first | The attempt closes with the real outcome. Recovery's own fence requires `completed_at is null`, matches zero rows, and does nothing. **The genuine outcome stands** |
| Recovery wins first | The attempt closes as recovered. The late completion matches zero rows and returns `false`. The worker's outcome is lost to ambiguity — an acknowledged residual risk, not a correctness defect |
| Another claimant | Cannot claim the obligation while an open attempt exists (`integration_attempt_open` partial unique index plus the claim's `not exists` pre-filter) |
| Two recovery calls | Both contend on the same row; the second finds it closed and does nothing |

**No interleaving leaves the row half-settled, and none lets both succeed**,
because each is a single fenced `UPDATE` on the same row.

### 10.2 The fence that actually fires

Two layers, in order:

1. **`completed_at is null` fails** — recovery closed that attempt, and the existing completion fence already requires openness. **This is the layer that fires, and it is already implemented and tested.**
2. **Generation rollover** — the next claim opens a *new* attempt with the next `claim_generation` and a fresh token, so the obligation's ownership has genuinely moved.

Both return the same deliberately undifferentiated `false`.

### 10.3 Required locks and compare-and-set conditions, conceptually

- **Recovery selection**: `FOR UPDATE SKIP LOCKED` over expired open attempts, so two concurrent recovery passes neither block nor double-settle.
- **Recovery settlement**: a single `UPDATE` whose predicates include attempt identity, `completed_at is null`, `claim_expires_at < clock_timestamp()` and the boundary state that selects Path A or B. Zero rows means another party won.
- **Outbox transition**: predicated on `state = 'dispatching'`, so a concurrent completion that already moved it loses rather than producing a second transition.
- **No advisory locks**, and no lock spanning obligations.

---

## 11. Retryable destination categories — verified from source

| Category | Automatically retryable? |
| --- | --- |
| `destination_unavailable` | **Yes** |
| `rate_limited` | **Yes**, with its own higher floor (§19) |
| every other category | **No** |

`transientIntegrationFailures` is **exactly** `['destination_unavailable',
'rate_limited']`, verified in `integration-envelope.ts`. **The list is not
broadened.**

**`destination_timeout` is not and must not become an ordinary automatic
retry.** It is excluded from the transient set deliberately, because a timeout
may already have taken effect; Migration 53 enforces that it settles **only**
as `ambiguous`, and Migration 54 additionally forbids it on any non-ambiguous
outcome. Three independent controls, two of them already in the database.

---

## 12. Destination retry budget — derivation FROZEN

> **The destination retry budget counts settled attempt evidence for the same
> obligation that crossed the dispatch boundary and carries reviewed retryable
> destination semantics. It is NOT `attempt_number`.**

Conceptually:

```
count of integration_delivery_attempt rows where
      organization_id      = <obligation's Organization>
  and integration_outbox_id = <obligation>
  and completed_at          is not null
  and dispatch_started_at   is not null          -- crossed the boundary
  and failure_category      in ('destination_unavailable', 'rate_limited')
```

| Evidence | Counted? | Why |
| --- | --- | --- |
| Adapter transient failure after dispatch | **Yes** | a real destination attempt |
| Pre-dispatch lease recovery | **No** | `dispatch_started_at` is null **and** `failure_category` is null — excluded twice over |
| Possibly-dispatched recovery (`ambiguous`) | **No** | `failure_category` is null, and ambiguity is not an ordinary retryable failure |
| `destination_timeout` settled as ambiguous | **No** | not in the retryable set |
| A successful attempt | **No** | not a failure |

**`attempt_number` remains the immutable monotonic ordinal of attempt
evidence**, and `max(attempt_number) ≠ destination retry count` once
pre-dispatch recovery exists (F062.2D-2C-0A §18.2). F061.3C independently
warns: *"a producer must never infer destination budget exhaustion from that
ordinal alone."*

**Derived by query, not denormalised.** No `attempt_count`, `retry_count` or
`recovery_count` column — a counter that can disagree with the evidence it
counts is a liability.

---

## 13. Retry ceiling and exhaustion

### 13.1 The number

**UNRESOLVED.** No authoritative numerical destination retry ceiling exists
anywhere in the repository. **No conventional value is chosen here** — not 3,
not 5, not any other.

### 13.2 `attempt_budget_exhausted` — the authority is F061, not F062

An important distinction, easily missed:

| Vocabulary | Where | What it is |
| --- | --- | --- |
| `attempt_budget_exhausted` | `src/observability/telemetry-contracts.ts:54`, defined by F061.3B and reused by F061.3C | an **F061 observability dead-letter reason class** — a bounded *metric label* |
| F062 `reason_code` | `delivery-contract.ts`, persisted by Migration 54 | **delivery evidence**, and it has **exactly two values**, neither of which is budget exhaustion |

F061.3C states the boundary explicitly: *"Unknown/raw F062 codes such as
`lease_expired_uncertain` remain invalid metric reason values."* The two
namespaces are not interchangeable in either direction.

> **There is therefore no F062 `reason_code` representing destination budget
> exhaustion.** Recording it as delivery evidence would require an F062.1
> amendment. **Marked UNRESOLVED**, and named as contract gap 2 in §31.

### 13.3 What happens on exhaustion — FROZEN BY REVIEW

> ### On destination retry-budget exhaustion, PARK the obligation.
>
> ```
> state           = retrying
> next_attempt_at = NULL
> ```
>
> **Do not automatically dead-letter, and do not invent a terminal
> transition.**

| Property | Consequence |
| --- | --- |
| **Not automatically claimable** | §5 already defines `retrying` with a NULL schedule as ineligible. The fail-closed reading needs no new rule |
| **Visible for operations** | the obligation stays in the pending population for `integration_pending_count` while `integration_ready_count` excludes it, so the backlog does not hide it |
| **Ordered successors remain blocked** | `retrying` is a blocking predecessor (§4.1), so the stream stops rather than reordering past unfinished work |
| **Awaiting explicit operator disposition** | the only exit is a reviewed operator action, which is the correct authority for abandoning delivery |

This is reachable with **existing states and existing edges only**. No new
state, no new transition, and nothing is dead-lettered — which §20 requires,
because `dead_lettered` has no outgoing edge and the authorized replay evidence
does not exist.

---

## 14. Retry backoff formula — bounded exponential jitter, FROZEN

Verified from F062.2D-2C-0A §20: **capped exponential backoff with a jitter
floor**, computed in the database. **FROZEN BY REVIEW, this is named
“bounded exponential jitter”.**

```
cap_n = min(max_delay, base_delay * 2 ^ destination_retry_count)
delay = uniform(base_delay, cap_n)       -- floor is base_delay, never zero
next_attempt_at = clock_timestamp() + delay
```

> ### FROZEN BY REVIEW: call this **bounded exponential jitter**.
>
> **It must NOT be called canonical or full jitter**, because the lower bound
> is `base_delay`, not zero. The distinction is substantive, not cosmetic:
> jittering down to zero would permit an immediate retry against a destination
> that just failed, defeating the first interval entirely. A reader who sees
> “full jitter” will assume `uniform(0, cap)` and implement the wrong
> thing.
>
> **No numeric value is selected for `base_delay` or `max_delay`.**

The exponent input is the **destination retry count of §12**, never
`attempt_number`, so a pre-dispatch recovery does not advance the curve.

Jittering across the whole `[base_delay, cap_n]` band rather than a narrow
window around the cap, because the wider band is the stronger de-synchroniser
and directly addresses thundering-herd resumption after an outage — while the
floor keeps the first interval meaningful.

---

## 15. Retry schedule authorship and randomness

### 15.1 Authorship

`next_attempt_at` is **database-authored** in the completion and recovery
functions, from database time plus reviewed policy, **in the same transaction
as the settlement that caused it** — a schedule written separately from its
cause can be lost or doubled. The worker supplies no durable timestamp, no hint
and no override. Migration 55 already refuses a caller-supplied schedule at
enqueue and permits one only at a transition.

### 15.2 Randomness

**`pg_catalog.random()` is acceptable** for jitter: it is on the pinned
`search_path`, needs no extension, and jitter exists to de-correlate timing
rather than to resist prediction.

> **It must never generate a claim token.** Claim tokens are worker-generated
> CSPRNG material; the database sees only a SHA-256 digest. The two uses must
> not be confused because they share a function name.

### 15.3 Deterministic tests without weakening production

Recommended, in order of preference:

1. **Bounds assertions** — over many samples, assert `base_delay ≤ delay ≤ cap_n` and that the distribution is not degenerate (at least two distinct values). This validates the contract without constraining the value.
2. **Monotonic cap growth** — assert `cap_n` doubles up to `max_delay` and then stops, by driving the destination retry count directly.
3. **`setseed()` inside a test transaction only**, if a specific value is ever needed. **No production switch, no "deterministic mode" parameter, and no injectable clock** — each would be a production weakness introduced for test convenience.

---

## 16. The six separate clocks and budgets — kept separate

| # | Quantity | Measures | Owner |
| - | --- | --- | --- |
| 1 | **Lease duration** | how long one claim owns an obligation | platform + connector (§6) |
| 2 | **Destination retry backoff** | the delay before the next destination attempt | platform + connector |
| 3 | **Destination attempt budget** | how many boundary-crossing retryable destination failures | platform ceiling; connector may lower |
| 4 | **Destination retry horizon** | wall-clock bound on the whole retry sequence | platform ceiling |
| 5 | **Pending eligible age** | F062.2D-1A's age from immutable `created_at`, excluding `disabled` intervals | F062.2D-1A |
| 6 | **Pre-dispatch recovery bound** | how many platform recoveries one obligation may receive | **platform only** (§17) |

Plus **total obligation lifetime**, which F062.2D-1A anchors to immutable
`created_at` and which is **not distinct from #5's origin** — the same
timestamp, bounded by the same ceiling. It is listed in §26 for completeness
and should not be given its own number.

**None implies, caps or substitutes for another**, and exhausting any one stops
automatic processing on its own. **Only #5 has an owner with an existing
policy document; none has a number.**

---

## 17. Pre-dispatch recovery budget

> **Pre-dispatch recovery is a platform execution problem and must not permit
> an infinite crash loop.**

### 17.1 Accounting — derived, not denormalised

```
count of integration_delivery_attempt rows where
      organization_id       = <obligation's Organization>
  and integration_outbox_id = <obligation>
  and reason_code           = 'lease_expired_pre_dispatch'
```

**No `recovery_count` column.** The evidence already exists and is immutable,
and Migration 54's constraints guarantee the reason code can only appear on a
genuinely pre-dispatch settlement.

### 17.2 Owner and bound

**Platform only, never connector** — a pre-dispatch recovery is a Reqro-side
event, and a per-connector override would let a deployment tune a bound on
Reqro's own fault behaviour. The shape may be a bounded count, a horizon, or a
reviewed combination. **The number is UNRESOLVED.**

### 17.3 Exhaustion — FROZEN BY REVIEW, and no new reason code

> ### On pre-dispatch recovery-budget exhaustion, PARK the obligation.
>
> ```
> state           = retrying
> next_attempt_at = NULL
> ```
>
> The same parked shape as §13.3, for the same reasons.

> ### Do NOT add or propose a new attempt `reason_code` for this.
>
> **The attempt reason remains `lease_expired_pre_dispatch`.**

The first draft of this document proposed a new lifecycle reason for recovery
exhaustion. **The review rejected that, and the reasoning is a useful
distinction to keep:**

| Layer | Question | Where it lives |
| --- | --- | --- |
| **Attempt-cause evidence** | *What happened to this one attempt?* | `integration_delivery_attempt.reason_code` — and for every pre-dispatch recovery the honest answer is, and stays, `lease_expired_pre_dispatch` |
| **Obligation-policy outcome** | *Has this obligation used up its recovery allowance?* | **derived**, not stored |

Recovery-budget exhaustion is an **obligation-level derived condition**:

```
pinned recovery policy
  +
count of settled attempts for this obligation with
    reason_code = 'lease_expired_pre_dispatch'
```

**Keeping attempt-cause evidence separate from obligation-policy outcome** is
what avoids a second, redundant vocabulary. A new reason code would record a
*policy verdict* in a field that exists to record *what happened*, and two
attempts with identical causes would then carry different reasons purely
because one happened to be the last one allowed. The cause did not differ; the
allowance ran out.

This also closes what the first draft listed as a contract gap: **no F062.1
amendment and no F061 classification decision is required** for recovery
exhaustion, because nothing new is recorded.

---

## 18. Pre-dispatch recovery delay and resulting state

### 18.1 The state is forced by the transition graph

| Option | Verdict |
| --- | --- |
| A. return immediately to `pending` | **Structurally impossible.** `deliveryStateTransitions.dispatching` is `['accepted','retrying','ambiguous','failed_permanent','dead_lettered']` — **there is no `dispatching → pending` edge**, in F062.1 or in the database guard |
| **B. return to `retrying` with a platform recovery delay** | **DECIDED — the only available answer**, and it matches F062.2D-2C-0A §20.4 |
| C. another state | No other edge from `dispatching` is semantically defensible for a provably-undelivered obligation |

This also satisfies Migration 55's constraint that `next_attempt_at` exists
only while `retrying`.

### 18.2 The delay is a platform recovery delay, not destination backoff

| | Destination transient failure | Pre-dispatch recovery |
| --- | --- | --- |
| Writes `next_attempt_at` | yes | **yes** — to avoid a hot recovery loop |
| Schedule source | pinned destination backoff policy | **platform recovery delay policy** |
| Advances the destination exponent | **yes** | **no** |
| Consumes destination budget | **yes** | **no** |

**One column, two schedule sources**, distinguishable from the settling
attempt's `reason_code` — so **no schedule-source column is needed**, and none
should be added.

**The numeric delay is UNRESOLVED**, and must not be conflated with
`base_delay`.

---

## 19. Rate-limit semantics

### 19.1 Nothing is persisted

A repository-wide search for `retry_after`, `rate_limit_until`,
`destination_retry_at` and adapter retry metadata returns **nothing** in
`server/src` or `server/migrations`. The attempt table has no field for it, and
F062.2D-2A explicitly deferred `response_classification` and
`external_reference` to the settle path.

> **A robust `Retry-After`-aware algorithm cannot be implemented today.** Any
> claim that a destination's requested delay is honoured would be false.

### 19.2 FROZEN BY REVIEW: automatic scheduling is BLOCKED

> **`rate_limited` remains an approved retryable classification, but automatic
> scheduling is BLOCKED until reviewed destination retry-floor evidence
> exists.**
>
> **Generic exponential retry must NOT be applied while ignoring `Retry-After`
> semantics.**

This reverses the first draft of this section, which recommended generic
backoff. The review's reasoning holds: a destination that returns
`rate_limited` has **stated a rate**. Retrying it on a curve Reqro invented,
while discarding the delay the destination asked for, is not a conservative
approximation — it is ignoring an explicit instruction from the system Reqro
is trying not to overwhelm, and it would look correct in every test that does
not involve a real destination.

| Option | Verdict |
| --- | --- |
| A. Generic reviewed backoff for `rate_limited` | **REJECTED BY REVIEW** |
| **B. 3B introduces the required evidence contract and persistence** | **PREFERRED.** The field is per-try evidence and belongs on the **attempt**, alongside the other dispatch evidence |
| **C. 3C parks `rate_limited` as `retrying` + `next_attempt_at = NULL`** | **ACCEPTABLE FALLBACK** if 3B does not deliver the evidence |

So 3B **either** introduces the destination retry-floor evidence contract,
**or** 3C parks `rate_limited` in the same shape as §13.3 and §17.3: visible,
not automatically claimable, successors blocked, awaiting operator disposition.

**`destination_unavailable` is unaffected** and remains automatically
schedulable under §14 — nothing in a destination-unavailable response
expresses a requested delay, so there is no instruction to ignore.

### 19.3 Consequence for the completion signature

Where a destination does supply a retry-after value, honouring it remains
adapter-level **input to an approved policy** that clamps it to platform
bounds — never a destination-controlled timestamp written straight into
`next_attempt_at`.

> **`complete_integration_attempt`'s parameter list is FIXED for 3A** (§27.3).
> **It may require a later reviewed extension if 3B establishes destination
> retry evidence**, because the adapter is the only party that observes a
> `Retry-After` header and the database cannot infer it. Any such extension is
> a reviewed signature change in its own right, not an implementation detail of
> 3C.

---

## 20. Dead-letter semantics and replay

### 20.1 Verified from source

| Question | Answer |
| --- | --- |
| What does `dead_lettered` mean? | Automatic processing stopped; a human decides |
| Which conditions may enter it? | Legal edges exist from `dispatching`, `retrying` and `ambiguous`. **No automatic predicate sets any of them today** |
| Does replay exist? | **No.** `deliveryStateTransitions.dead_lettered = []` |
| Does `dead_lettered → pending` replay evidence exist? | **No.** `delivery-contract.ts` states it directly: F062.2A requires an authorized replay to carry audit evidence in the same transaction, *"and no replay authorization record exists yet; enabling `dead_lettered -> pending` before it would permit an unaudited replay to a live external system"* |

### 20.2 The consequence, stated explicitly

> **2C-3 MUST NOT automatically dead-letter any obligation.** Entry into a
> state with no exit would convert a bounded retry policy into permanent
> delivery loss. **Entry and exit must land together, or entry must wait.**

This directly shapes retry-exhaustion implementation (§13.3) and pre-dispatch
recovery exhaustion (§17.3): both must park rather than dead-letter, and both
therefore need the §13.3 decision confirmed.

---

## 21. Claim candidate query semantics

Gates in the order they must apply:

1. **Organization isolation** — Organization-qualified; a foreign or absent connector is indistinguishable from "no work". *Implemented.*
2. **Connector eligibility** — `lifecycle_state in ('active','degraded')`, read `FOR SHARE` to close the read-then-pin race. *Implemented.*
3. **State eligibility** — `pending`, or `retrying` with a due `next_attempt_at` (§5). *New.*
4. **No open attempt for the obligation.** *Implemented.*
5. **Ordered-stream mutual exclusion** — `not exists` pre-filter over blocking siblings, with the Migration 55 unique index as the authoritative backstop. *New.*
6. **Strict-FIFO predecessor exclusion** (§4). *New.*
7. **Pending-age ceiling** — F062.2D-1A, and **UNRESOLVED**, so 2C-3 must either omit the gate or read it from the policy mechanism of §6.2.
8. **Pinned snapshot exists.** *Implemented* (raises if missing).
9. **`FOR UPDATE SKIP LOCKED LIMIT 1`.** *Implemented*, and already the approved concurrency behaviour.

### 21.1 Candidate ordering across unrelated work

> **Keep the existing `created_at, id` global ordering. Do not invent a
> fairness policy, because none exists.**

The sequence key `(aggregate_revision, created_at, id)` defines **"earlier"
within one ordered stream** and is consumed by the predecessor predicate. It is
**not** the global candidate sort. Conflating the two would make
`aggregate_revision` — a per-aggregate counter with no cross-aggregate
meaning — into a cross-tenant priority, which would be arbitrary.

This is a refinement of F062.2D-2C-0A §15.3, which specified the sequence key
without separating the two roles.

---

## 22. Claim transaction outputs

The descriptor currently returns 20 columns. **One addition is needed:**

| Field | Add? | Why |
| --- | --- | --- |
| **`claim_expires_at`** | **Yes** | The worker must know its own deadline to decide whether to abandon work rather than transmit near expiry. Without it the worker cannot honour the lease it holds |
| `delivery_attempt_id`, `attempt_number`, `claim_generation` | already present | — |
| `dispatch_started_at` | **No** | always null at claim |
| `next_attempt_at` | **No** | irrelevant once claimed |

**Must never be exposed:** `claim_token_digest`, `credential_reference`, any
secret, and any internal policy metadata the worker does not need. The raw
claim token remains worker-generated, passed as a **typed bind value**, hashed
and stored as a digest only, and **never persisted, returned, interpolated into
SQL or named in an exception** — all already implemented and tested.

§28 records the decisive consequence of this one addition.

---

## 23. Completion function changes

| Outcome | Attempt | Outbox | `next_attempt_at` |
| --- | --- | --- | --- |
| `succeeded` | `succeeded`, no category, no reason | **`accepted`** | **NULL** |
| `failed_transient` with a reviewed retryable category | settles with that category | **`retrying`** | **database-authored future time** (§14) |
| `failed_permanent` | settles with its category | **`failed_permanent`** | **NULL** |
| `ambiguous` | settles with its category | **`ambiguous`** | **NULL** — no automatic retry schedule |

Every mapping above is **already authorized and already implemented** in
Migration 53; the only additions are the schedule, the budget and horizon
checks, and clearing `next_attempt_at` when leaving `retrying`. **No
unauthorized transition is introduced.**

---

## 24. Fencing requirements

`complete_integration_attempt` and `mark_integration_dispatch_started` must
both validate, as predicates of a **single statement** so there is no
check-then-act window:

Organization · attempt · `claim_generation` · token digest · open attempt
(`completed_at is null`) · and for completion, the attempt/obligation
relationship.

Recovery invalidates stale completion through **authoritative attempt state and
generation rollover** (§10.2), never through wall-clock expiry.

> **`claim_expires_at` must not appear in any completion fence.** A live worker
> finishing one millisecond after expiry has genuinely delivered, and refusing
> its settlement would discard the truest evidence in the system and
> manufacture ambiguity — in the worst case inviting a duplicate from an
> entirely healthy dispatch.

A failed fence returns a deliberately **undifferentiated `false`**: a wrong
token, a stale generation, an already-settled attempt and another
Organization's attempt must remain indistinguishable.

---

## 25. Observability gate status

**No F061 change is made here.** The required distinction is between a concept
being *declared* and a producer *emitting* it.

| Required before production activation | A. Contract defined | B. Runtime emitted | C. Alerting / backend connected |
| --- | --- | --- | --- |
| Active / in-flight claims | **Yes** — `integration_active_claim_count` (F061.3C) | **No** | **No** |
| Expired leases | **Yes** — `integration_expired_lease_count` (F061.3C) | **No** | **No** |
| Completed lease recoveries | **Yes** — `integration_lease_recovery_count`, classified `pre_dispatch_recovery` / `uncertain_dispatch_recovery` (F061.3C) | **No** | **No** |
| Oldest retry-eligible age | **Yes** — `integration_oldest_retry_eligible_age` (F061.3C) | **No** | **No** |
| Ordered-blocked obligations | **Yes** — `integration_ordered_stream_blocked_count`, classified `ordered_predecessor` / `ambiguous_predecessor` (F061.3C) | **No** | **No** |
| Pending-age and dead-letter metrics | **Yes** — `integration_oldest_pending_age`, `integration_dead_letter_count`, `integration_age_policy_transition_count` (F061.3A/3B) | **No** | **No** |

> **The gate is NOT satisfied.** Every concept exists; **nothing emits**.

Evidence: `integrationSlisImplemented()` returns `false`; `NO_TELEMETRY` is a
no-op port; only the two contract modules reference the vocabulary, with no
producer; and F061.3C states *"Concept declarations are not instruments or an
emission API."*

F061.3C also constrains the future producer in ways 2C-3 must respect:
`integration_expired_lease_count` requires **F062** to qualify which open
claims are lease-expired (*"no lease calculation in F061"*), and
*"null/unassigned transitional lease evidence is not automatically expired"* —
which matters because `claim_expires_at` is nullable today.

> **FROZEN BY REVIEW: F062.2D-3 worker grants remain blocked until runtime
> emission exists**, at minimum for active claims and expired leases.
>
> The work is a named parallel slice: **F061.3D — Integration Worker Runtime
> Telemetry Emission**, which **must occur before worker activation or
> grants**. No F061 change is made in this slice.

---

## 26. Unresolved policy table

| Policy | Architecture decided? | Numeric value decided? | Source | Required before |
| --- | --- | --- | --- | --- |
| Claim lease duration | **DECIDED** — connector config + platform ceiling, `min` (§6.2) | **UNRESOLVED** | none | lease creation in the claim function |
| Lease duration floor | **DECIDED** as a rule — strictly greater than the total request budget (F062.2D-0 §17) | **UNRESOLVED** | F062.2D-0 §17 (rule only) | lease creation |
| Lease duration ceiling | **DECIDED** — platform ceiling applied as `min` | **UNRESOLVED** | none | lease creation |
| Destination base retry delay | **DECIDED** — capped exponential, and it is also the jitter floor (§14) | **UNRESOLVED** | F062.2D-2C-0A §20 | retry scheduling |
| Destination max retry delay | **DECIDED** — the exponential cap | **UNRESOLVED** | F062.2D-2C-0A §20 | retry scheduling |
| Destination retry ceiling (attempt budget) | **DECIDED** — derived by query (§12) | **UNRESOLVED** | none | retry exhaustion |
| Destination retry horizon | **DECIDED** — platform ceiling, `<=` the pending-age ceiling | **UNRESOLVED** | F062.2D-2C-0A §25 | retry exhaustion |
| `rate_limited` delay floor | **DECIDED** — automatic scheduling **blocked** until destination retry-floor evidence exists; otherwise park (§19.2) | **UNRESOLVED** | F062.2D-2C-0A §20.3, amended by review | 3B's evidence contract, or 3C parking |
| Pre-dispatch recovery bound | **DECIDED** — derived by query, platform-owned (§17) | **UNRESOLVED** | F062.2D-2C-0A §20.3 | recovery |
| Pre-dispatch recovery delay | **DECIDED** — platform recovery delay, `dispatching → retrying` (§18) | **UNRESOLVED** | F062.2D-2C-0A §20.4 | recovery |
| Recovery scan frequency | **UNRESOLVED** | **UNRESOLVED** | none | a recovery caller (not 2C-3) |
| Recovery batch size | **DECIDED** — a bounded `limit` parameter is acceptable; a policy parameter is not | **UNRESOLVED** | F062.2D-2C-0A §31.2 | recovery |
| Pending eligible-age ceiling | **DECIDED** — layered, `min`, "unset" inherits | **UNRESOLVED** | F062.2D-1A | the pending-age gate |
| Total obligation lifetime | **DECIDED** — not distinct; same immutable `created_at` origin and ceiling as pending age (§16) | **UNRESOLVED** | F062.2D-1A | the pending-age gate |
| Retry-exhaustion outcome state | **DECIDED** — park as `retrying` + NULL (§13.3) | n/a | **FROZEN BY REVIEW** | retry exhaustion |
| Recovery-exhaustion representation | **DECIDED** — **no new reason code**; derived at obligation level from pinned policy plus settled `lease_expired_pre_dispatch` attempts (§17.3) | n/a | **FROZEN BY REVIEW** | recovery exhaustion |
| `dead_lettered` as an ordered predecessor | **DECIDED** — it **BLOCKS**; ordered resolution is separate from terminality (§4.3) | n/a | **FROZEN BY REVIEW** | strict FIFO |

**Thirteen numerical values, every one UNRESOLVED. No value is filled in.**

**Architecture is now DECIDED for every row.** The four rows the first draft
left architecturally open were frozen by this review, so what remains is
exclusively numerical — and 3B's mechanism defers those to configuration
rather than requiring them to be chosen before implementation can begin.

---

## 27. Proposed function signatures

### 27.1 `claim_integration_intent`

```sql
reqro_integration_api.claim_integration_intent(
  target_organization uuid,
  target_connector    uuid,
  raw_claim_token     text
) returns table (
  …the existing 20 columns…,
  claim_expires_at timestamptz          -- ADDED (§22)
)
```

**Signature unchanged — three parameters.**

| Parameter | Why the caller controls it |
| --- | --- |
| `target_organization` | The worker's tenant scope. It cannot be inferred, and passing it explicitly is what makes cross-tenant requests indistinguishable from "no work" |
| `target_connector` | Which destination this worker serves. A worker may be deployed per connector |
| `raw_claim_token` | **The one worker-provided secret.** CSPRNG material the worker must retain to prove ownership later; the database stores only its digest and can bound encoding but not entropy |

**The database controls everything else**, specifically: candidate selection,
ordering, `attempt_number`, `claim_generation`, `started_at`, the token digest,
the capability snapshot, the state transition and — newly — `claim_expires_at`
from policy. **No lease, expiry, label, interval or retry-time parameter**, per
F062.2D-2C-0A §11.

### 27.2 `mark_integration_dispatch_started`

```sql
reqro_integration_api.mark_integration_dispatch_started(
  target_organization       uuid,
  target_attempt            uuid,
  expected_claim_generation bigint,
  raw_claim_token           text
) returns boolean
```

All four parameters exist **solely to prove ownership**; the timestamp is
database-authored and a caller-supplied value is discarded by the Migration 54
guard. No obligation id (§8.1). No timestamp parameter.

### 27.3 `complete_integration_attempt`

```sql
reqro_integration_api.complete_integration_attempt(
  target_organization       uuid,
  target_obligation         uuid,
  target_attempt            uuid,
  expected_claim_generation bigint,
  raw_claim_token           text,
  attempt_outcome           varchar(18),
  attempt_failure_category  varchar(28)
) returns boolean
```

**Signature unchanged — seven parameters**, the first five proving ownership
and the last two carrying the **reviewed destination classification** the
adapter observed and the database cannot know. The database controls
`completed_at`, the outcome-to-state mapping, `next_attempt_at`, the budget and
horizon checks, and the validity of every combination. **No `next_attempt_at`
parameter**: a worker that could choose its own retry time could schedule an
immediate retry and defeat backoff entirely.

### 27.4 `recover_expired_integration_claim`

```sql
reqro_integration_api.recover_expired_integration_claim(
  target_organization uuid,
  max_rows            integer DEFAULT 1
) returns integer
```

| Parameter | Why the caller controls it |
| --- | --- |
| `target_organization` | Tenant scope, consistent with every other function, and it prevents an unbounded cross-tenant sweep |
| `max_rows` | A **bounded work limit**, not policy. F062.2D-2C-0A §31.2 permits a bounded row limit and forbids a bounded policy parameter |

Returns the number of claims recovered. **The database selects which attempts
are expired, decides Path A or Path B from `dispatch_started_at`, authors every
timestamp, and chooses the reason code.** Explicitly **no** duration, interval,
timeout, `force` or attempt-id parameter — a caller-supplied interval would let
a worker recover live claims belonging to other workers, which is lease
stealing with extra steps.

> ### FROZEN BY REVIEW: `EXECUTE` ownership is NOT decided here.
>
> **All four functions remain ungranted through 3A, 3B and 3C.** No identity
> holds `EXECUTE` on any of them until F062.2D-3.
>
> **F062.2D-3 will decide** between:
>
> - **delivery-worker authority** — the worker itself may recover; or
> - **a separate, narrowly scoped maintenance/recovery identity.**
>
> **Broad `reqro_operator` must not become the default recurring recovery
> executor.** `reqro_operator` is a human-elevation surface under ADR-027, and
> wiring a continuous automated sweep through it would turn an audited
> break-glass identity into routine machinery.

The first draft recommended operator-only; the review set that aside as
premature. Either outcome leaves this signature unchanged, which is why the
decision can safely wait.

### 27.5 Hardening carried forward

All four: owned by `reqro_integration_function_owner`; `SECURITY DEFINER`;
`VOLATILE`; typed parameters with no catch-all JSON or text; no
caller-controlled object identifier; no dynamic SQL; every application object
fully qualified; `search_path` pinned to `pg_catalog, public, pg_temp` per the
reviewed contract; `PUBLIC EXECUTE` revoked by full signature; raw tokens never
persisted, returned, interpolated or named in an exception.

---

## 28. Migration strategy

**A new migration is required. Likely Migration 56 / ordinal
`20261026000000`**, derived from the repository. **It is not created in this
slice, and Migration 53 is not edited.**

### 28.1 One measured constraint that changes the plan

> **`CREATE OR REPLACE FUNCTION` cannot widen a `RETURNS TABLE`.** Measured on
> this repository's PostgreSQL: adding one output column to an existing
> `returns table` function fails with **`cannot change return type of existing
> function`**. `DROP` followed by `CREATE` succeeds, and a body-only replacement
> succeeds.

Consequently:

| Function | Mechanism in Migration 56 |
| --- | --- |
| `claim_integration_intent` | **`DROP FUNCTION` then `CREATE FUNCTION`**, because §22 adds `claim_expires_at` to its return table |
| `complete_integration_attempt` | `CREATE OR REPLACE` — the return type stays `boolean` |
| `mark_integration_dispatch_started` | `CREATE FUNCTION` (new) |
| `recover_expired_integration_claim` | `CREATE FUNCTION` (new) |

### 28.1a FROZEN BY REVIEW: the claim return expansion and its ordering

> **The `claim_expires_at` return field is APPROVED.**
>
> **PostgreSQL cannot widen a `RETURNS TABLE` via `CREATE OR REPLACE`** —
> measured on this repository's PostgreSQL, which refuses with *"cannot change
> return type of existing function"*. **The future migration must `DROP` then
> `CREATE` `claim_integration_intent`.**
>
> **This must happen before any F062.2D-3 `EXECUTE` grants.** A `DROP FUNCTION`
> also drops every grant on that function, so performing it after 2D-3 would
> silently revoke the worker's access. No grant exists yet, so doing it now is
> harmless.
>
> **If 3A introduces the field before lease policy is active, a NULL
> `claim_expires_at` is transitional and acceptable**, precisely because no
> identity holds `EXECUTE` and therefore no worker can observe or depend on
> it (§27.4).

One consequence to carry into 3A's tests: a transitional NULL must not be read
as “expired”. F061.3C independently requires the same discipline of a future
producer — *“null/unassigned transitional lease evidence is not automatically
expired”* — so the two contracts already agree.

### 28.2 Ownership and rollback

Migration 56 must reproduce Migration 53's ownership sequence: capture the prior
role, `SET ROLE reqro_integration_function_owner` (authorized against
`session_user`, which is why the `reqro_migrate → function_owner` edge
suffices), create or replace, then restore the prior role. It must also
hardcode `public.` and therefore be **applied as text**, not imported — like
Migrations 48, 49 and 53.

**Rollback must restore the previous reviewed functions exactly**, which means
`down()` carries Migration 53's two function bodies **verbatim** and drops the
two new functions. It must also refuse while evidence only the new contract can
produce exists — at minimum any non-null `next_attempt_at` authored by the new
scheduling path.

---

## 29. Mandatory security tests for 2C-3

Recorded now so the next slice inherits them rather than rediscovering them.
**All must pass before F062.2D-3.**

| # | Invariant |
| - | --- |
| 1 | Tenant isolation — a foreign Organization's parameters yield zero rows with no detail |
| 2 | Stale token refused |
| 3 | Stale generation refused |
| 4 | **Expired-but-unrecovered claimant may still settle** |
| 5 | **Recovered claimant may not settle** |
| 6 | Dispatch marker is database-authored — a forged past or future value is discarded |
| 7 | Dispatch marker is write-once |
| 8 | No dispatch marker after completion |
| 9 | No completion without a matching open claim |
| 10 | **Strict FIFO: an older unresolved sibling blocks a newer ordered obligation** |
| 11 | **An older `retrying` sibling with a future `next_attempt_at` still blocks** |
| 12 | Unordered streams remain independent |
| 13 | Unrelated aggregates proceed concurrently |
| 14 | The same ordered aggregate cannot concurrently dispatch |
| 15 | A due retry may be claimed |
| 16 | A future retry may not |
| 17 | `retrying` with NULL schedule may not |
| 18 | **Pre-dispatch recovery does not consume destination budget** |
| 19 | **Pre-dispatch recovery does not advance the destination exponent** |
| 20 | A real retryable destination failure **does** consume budget and advance the exponent |
| 21 | Uncertain dispatch becomes `ambiguous` |
| 22 | No automatic `ambiguous` retry |
| 23 | Raw token never durable and never logged |
| 24 | No credential or digest returned |
| 25 | `attempt_number` monotonic across every settlement origin, and `≠` the destination retry count |
| 26 | Backoff bounds: `base_delay ≤ delay ≤ cap_n`, with a non-degenerate distribution |
| 27 | No obligation is automatically dead-lettered |

Tests 10, 11 and 14 need their **own concurrency coverage**: the predecessor
predicate is function-enforced, so the ordered-stream index cannot catch a bug
in it.

---

## 30. Slice recommendation: **C**

> **A policy and persistence gap must be resolved before 2C-3's lease, retry or
> recovery behaviour can be implemented.**

### 30.1 Why not A

2C-3 as a single slice would have to supply a lease duration, a base and
maximum retry delay, a retry ceiling, a horizon, a rate-limit floor, a recovery
bound and a recovery delay — **seven numbers, none of which has an
authoritative source** — inside a `SECURITY DEFINER` migration. Every one would
be an arbitrary constant in the most security-sensitive file in the slice.

### 30.2 Why not plain B

The authorization's 3A bundles "claim/recovery function structure" with strict
FIFO. But **recovery has nothing to fence on until `claim_expires_at` is
populated**, and populating it needs the lease duration and therefore the
policy mechanism. So 3A as drafted is still blocked on the gap, and the split
alone does not resolve it.

### 30.3 FROZEN implementation sequence

| Slice | Scope | Numerical policy required? |
| --- | --- | --- |
| **F062.2D-2C-3A** — strict FIFO, retry eligibility and dispatch-marker / function structural hardening | The §4 predecessor predicate with its own concurrency tests; `mark_integration_dispatch_started`; retry **eligibility** in the claim predicate (reading `next_attempt_at`, clearing it on the transition out of `retrying`); `aggregate_revision` as the intra-stream sequence; the §28.1a `DROP`/`CREATE` of the claim function | **None.** No timing policy required, and every input already exists in the schema |
| **F062.2D-2C-3B** — execution-policy persistence and trust boundaries | The two authority classes of §6.2a: connector-pinned policy mirrored into the audit, and the operator-owned platform safety relation; the `min` evaluation with the §6.2a fail-closed lease rule; **and either the destination retry-floor evidence contract of §19.2 or an explicit decision to park `rate_limited`** | **None.** **No arbitrary numerical constants or defaults** — it stores a mechanism, and values are configuration |
| **F062.2D-2C-3C** — claim lease authorship, retry scheduling and recovery | `claim_expires_at` authorship from persisted policy; `recover_expired_integration_claim`; `next_attempt_at` authorship in completion and recovery; budget, horizon and bounded exponential jitter, all **reading** policy from 3B | Reads policy; **no hardcoded constant** |
| **F061.3D** — Integration Worker Runtime Telemetry Emission (**parallel**) | A producer for the §25 concepts, at minimum active claims and expired leases. **Must occur before worker activation or grants** | — |
| **F062.2D-3** — worker identity and `EXECUTE` grants | Creates the identity and decides recovery authority per §27.4. **Blocked until 3A, 3B, 3C and the F061.3D emission gate all pass** | — |

**3A carries no policy risk and may proceed first or in parallel** with closing
the §31 gaps. That is the one carve-out from recommendation C, and it is the
reason C does not stall all progress.

### 30.4 Decisions the review has now frozen

The first draft listed three decisions as needed before 3C. **All three are
now decided**, and are recorded at the sections that own them:

| Was open | Now |
| --- | --- |
| Retry-exhaustion outcome state | **DECIDED** — park as `retrying` + NULL (§13.3) |
| Platform recovery-exhaustion reason code | **DECIDED** — no new reason code; derived at the obligation level (§17.3) |
| `dead_lettered` as an ordered predecessor | **DECIDED** — it **blocks** (§4.3) |

What remains is the thirteen numerical values of §26, which 3B defers to
configuration rather than resolving, and the §31 gaps.

## 31. Open contract gaps

| # | Gap | Blocks |
| - | --- | --- |
| **1** | **No policy configuration mechanism** for lease and retry values. Connector capabilities exist and are pinnable; the admin-configuration foundation is tenant-writable and unsuitable for a platform ceiling | 3C, and every number in §26 |
| **2** | **No F062 `reason_code` for destination budget exhaustion** — `attempt_budget_exhausted` is an F061 *metric* class, not delivery evidence. **Downgraded from blocking by review:** §13.3 parks the obligation without recording a terminal reason, so no F062.1 amendment is required to proceed. It remains a gap for the eventual operator surface and for F061 mapping | the operator disposition surface, not 3A–3C |
| **3** | ~~No reason code for platform recovery exhaustion~~ **CLOSED BY REVIEW.** No new reason code is needed or wanted: the attempt reason stays `lease_expired_pre_dispatch` and exhaustion is an obligation-level derived condition (§17.3) | — |
| **4** | **No destination retry-floor / `Retry-After` persistence**, so correct rate-limit scheduling is impossible. **Escalated by review:** generic backoff is now rejected, so `rate_limited` automatic scheduling is **blocked** until 3B introduces the evidence contract, or 3C parks it (§19.2) | `rate_limited` automatic scheduling |
| **5** | **No `dead_lettered` replay authorization record**, so automatic dead-lettering must not ship | retry and recovery exhaustion outcomes |
| **6** | **No runtime telemetry emission**, only contracts. Closed by the parallel slice **F061.3D — Integration Worker Runtime Telemetry Emission**, which must land before worker activation or grants | F062.2D-3 grants |

---

## Related

- [F062.2D-2C-2 — Ordered-stream and retry-eligibility persistence](F062-2D-2C-2-ordered-stream-retry-eligibility-persistence.md) — the ordering and schedule columns this policy drives
- [F062.2D-2C-1 — Lease, dispatch boundary and recovery-reason persistence](F062-2D-2C-1-lease-dispatch-recovery-reason-persistence.md) — the lease, boundary and reason evidence
- [F062.2D-2C-0A — Worker execution contract amendment](F062-2D-2C-0A-worker-execution-contract-amendment.md) — the contract this slice freezes into signatures
- [F062.2D-2C-0 — Worker execution semantics decision](F062-2D-2C-0-worker-execution-semantics-decision.md) — the design behind it
- [F062.2D-2B — Worker claim and completion database function API](F062-2D-2B-worker-database-function-api.md) — the two implemented functions and their hardening
- [F062.2D-1A — Pending age, expiry and dead-letter policy](F062-2D-1A-pending-age-dead-letter-policy.md) — the age clock and the `min` precedence model reused for leases
- [F062.1 — Enterprise integration contracts foundation](F062-1-integration-contracts-foundation.md) — states, outcomes, categories and the transition graph
- [F061.3A — Integration worker observability contracts](F061-3A-integration-worker-observability-contracts.md) — the baseline worker metric vocabulary
- [F061.3B — Age and dead-letter observability contracts](F061-3B-age-dead-letter-observability-contracts.md) — the four dead-letter classes
- [F061.3C — Worker execution observability contracts](F061-3C-worker-execution-observability-contracts.md) — the five new concepts and the recovery/blocker classifications the §25 gate measures
- [ADR-024 — Transaction-time request authorization](../architecture/decisions/ADR-024-transaction-time-request-authorization.md) — the uncertain-result rule behind Path B
- [ADR-027 — Platform operator bootstrap and recovery](../architecture/decisions/ADR-027-platform-operator-bootstrap-recovery.md) — the operator authority §27.4 defers recovery to
