# F062.2D-2C-3B-0 — Execution policy persistence schema and trust-boundary decision

> **NO POLICY NUMBERS ARE SELECTED.**
>
> **NO LEASE IS AUTHORED.**
>
> **NO RETRY IS SCHEDULED.**
>
> **NO RECOVERY EXECUTES.**
>
> **NO WORKER HAS EXECUTE.**
>
> **NO POLICY GRANTS ARE ADDED.**
>
> **F062.2D-3 REMAINS BLOCKED.**

This slice is **documentation only**. No migration, no SQL function change, no
role or grant change, no handwritten database type, no test and no production
code. Nothing here creates a table, a column, a constraint, an index or a
privilege; it freezes the persistence shape and the authority contract that
F062.2D-2C-3B will implement and F062.2D-2C-3C will consume.

**No ADR number is allocated.** This resolves the 3-0 §31 gap-1 mechanism left open
by the already-accepted F062.2D-2C-3-0 decision.

Starting point: `origin/main` at `55894b3077c53d16bded92607c6dc9c87542d430`,
which carries F062.2D-2C-3A (`c1b0fdb`, merged as PR #44) as a verified
ancestor.

---

## 0. Architecture amendment record

This document was amended after its first architecture review. Nine
corrections were incorporated. Three of them **replace previously frozen
text**, and each is marked in place as an amendment rather than edited
silently.

| # | Correction | Effect |
| - | --- | --- |
| 1 | Lease derivation inverted — the platform maximum is a **permission ceiling**, not a truncating `min()` | **REPLACES FROZEN TEXT** (§5, §11, §25, §32) |
| 2 | `policy_revision` becomes **database-authored** `bigint`, caller cannot choose it, gaps acceptable | **REPLACES A MECHANISM** (§7, §28.3, §32) |
| 3 | `actor` **removed** from the platform policy schema; trusted attribution deferred | §7, §22, §28.3, §34 |
| 4 | Trust matrix clarified — tenant WRITE is **logical authority through the existing boundary**, not direct table `UPDATE` | §22, §29 |
| 5 | Retry horizon anchored at the **first non-null `dispatch_started_at`** | **REPLACES FROZEN WORDING** (§8.1, §28.3) |
| 6 | `effective_retry_max_delay` defined, with a fail-closed `base <= effective_max` requirement | §8.2, §11 |
| 7 | `effective_destination_attempt_ceiling` defined; `attempt_number` reaffirmed as an evidence ordinal | §8.2 |
| 8 | Rollback refusal broadened to **any** durable execution-policy evidence | §27 |
| 9 | Legacy-policy handling promoted from a consequence to an **activation gate** | §26.1 |

**No accepted architecture was weakened, and no numerical policy value was
selected by this amendment.** The twelve typed policy values, the two-class
authority split, the two attempt pins, the 3B-2 `Retry-After` model and the
3B-1 / 3B-2 / 3C split are all unchanged.

---

## 1. Authoritative contract source

| Source | What it governs here |
| --- | --- |
| **[F062.2D-2C-3-0](F062-2D-2C-3-0-worker-execution-policy-function-signatures.md)** | §6.2a the two frozen authority classes and the fail-closed lease rule, §12 destination retry budget derivation, §13.3/§17.3 the frozen exhaustion shape, §14 bounded exponential jitter, §17.2 platform ownership of the recovery bound, §19.2 the rate-limit block, §26 the thirteen unresolved numbers, §31 gap 1 and gap 4 |
| [F062.2D-2C-3A](F062-2D-2C-3A-strict-fifo-retry-dispatch-function-hardening.md) | the claim/marker functions this policy will feed, and the `claim_expires_at`-is-NULL precedent |
| [F062.2D-2C-2](F062-2D-2C-2-ordered-stream-retry-eligibility-persistence.md) | the pinned-snapshot derivation pattern reused here, and `next_attempt_at`'s authorship rules |
| [F062.2D-2C-1](F062-2D-2C-1-lease-dispatch-recovery-reason-persistence.md) | `claim_expires_at`, `dispatch_started_at`, `reason_code` and the write-once guard shape |
| [F062.2B](F062-2B-connector-metadata-persistence-foundation.md) | `configuration_revision` vs `record_revision`, the change-category vocabulary and the append-only audit snapshot |
| [F062.2D-1A](F062-2D-1A-pending-age-dead-letter-policy.md) | the layered `min` precedence model this reuses for ceilings |
| [ADR-027](../architecture/decisions/ADR-027-platform-operator-bootstrap-recovery.md) | the operator authority the platform policy class depends on |

### 1.1 Phase 0 — repository state, read from source

| Item | Value |
| --- | --- |
| Branch | `claude/f062-2d-2c-3b-0-policy-schema-decision` |
| HEAD | `55894b3077c53d16bded92607c6dc9c87542d430` |
| `origin/main` | `55894b3077c53d16bded92607c6dc9c87542d430` (identical; 0 ahead, 0 behind) |
| Working tree / index | clean |
| Migrations | **56**, highest ordinal `20261026000000` |

**`integration_connector`** — `id`, `organization_id`, `connector_key`,
`connector_kind`, `lifecycle_state`, `configuration_revision`,
`record_revision`, `operations`, ten capability columns
(`supports_idempotency_key`, `supports_read_after_write`,
`supports_reconciliation`, `supports_webhook_callback`, `supports_ordering`,
`supports_update`, `supports_cancel`, `supports_delete`,
`supports_current_state_sync`, `reports_terminal_state`), `side_effect_risk`,
`credential_reference`, `created_at`, `updated_at`, `disabled_at`,
`retired_at`. **No execution-policy column of any kind exists.**

**`integration_connector_audit`** — mirrors every capability column plus
`record_revision`, `configuration_revision`, `prior_record_revision`,
`revision_advanced`, `change_category`, `lifecycle_state`,
`credential_reference_present`, `prior_configuration_revision`,
`prior_lifecycle_state`, `actor`, `correlation_id`, `changed_at`,
`mutation_txid`. The pinned-snapshot lookup key
`(organization_id, integration_connector_id, configuration_revision)
where revision_advanced` is already covered by the unique index
`integration_connector_audit_revision`.

**Outbox pinned-revision evidence** —
`integration_outbox.pinned_connector_configuration_revision integer not null`,
documented as *"`configuration_revision`, never `record_revision`: the pin is
semantic"*, plus `requires_ordered_delivery` (derived at enqueue from the
pinned snapshot) and `next_attempt_at`.

**`integration_delivery_attempt`** — `id`, `organization_id`,
`integration_outbox_id`, `integration_connector_id`, `attempt_number`,
`claim_generation`, `claim_token_digest`, `connector_configuration_revision`,
`capability_snapshot`, `started_at`, `completed_at`, `outcome`,
`failure_category`, `claim_expires_at`, `dispatch_started_at`, `reason_code`,
`mutation_txid`. **No retry-floor, rate-limit or policy-revision column
exists.**

**Role and grant surfaces** — five identities: `reqro_owner`,
`reqro_migrate`, `reqro_runtime`, `reqro_operator`,
`reqro_integration_function_owner`. `reqro_runtime` holds **nothing on any
integration table** (zero `integration_` entries in the asserted runtime
matrix). The function owner holds `SELECT` on `integration_connector` and
`integration_connector_audit`, `SELECT, UPDATE` on `integration_outbox`, and
`INSERT, SELECT, UPDATE` on `integration_delivery_attempt`.
`reqro_integration_worker` **does not exist** and no identity holds `EXECUTE`
on any function in `reqro_integration_api`.

**Is there an existing general platform-settings table suitable for
security-sensitive worker policy?** **No.** The full table list was inspected
and the only policy-shaped relations are:

| Relation | Why it is unsuitable |
| --- | --- |
| `issue_requester_identity_policy` | organization-scoped and tenant-owned; a mutable current row with a `revision` and a separate audit table. A tenant-owned relation cannot hold a platform ceiling |
| `service_request_reference_config` | organization-scoped configuration, same objection |
| `tenant_domain_operator_approval` | **operator-owned, append-only and immutable — the right authority precedent**, but it is organization-scoped and models one-shot approvals, not durable global policy |

One related finding worth recording: `policy_version` already appears in the
repository (on `tenant_domain_operator_approval` and the resident-review
tables), but in **every** case it is a **source-code constant pinned into
evidence** — `policy_version: 1` is written literally in
`tenant-domain.operations.ts`, and `residentReviewPolicyVersion` is a
TypeScript constant. The repository therefore has a precedent for *pinning a
policy identifier into durable evidence*, and **no** precedent for storing
policy *values* in a table. Execution policy cannot follow that precedent for
the values, because a hard-coded SQL value is prohibited (3-0 §6.3) and the
database functions must perform arithmetic on them.

**Global (non-organization-scoped) tables do exist** — `organization`,
`permission` and `operational_role` — and `operational_role` is granted
`SELECT` only to `reqro_runtime`. A global, read-mostly, operator-written
relation is therefore architecturally consistent, not unprecedented.

**Unresolved numerical worker policy** — all **thirteen** rows of 3-0 §26
remain unresolved, and this slice resolves none of them: claim lease duration;
lease duration floor; lease duration ceiling; destination base retry delay;
destination max retry delay; destination retry ceiling; destination retry
horizon; `rate_limited` delay floor; pre-dispatch recovery bound; pre-dispatch
recovery delay; recovery scan frequency; recovery batch size; pending
eligible-age ceiling (and the non-distinct total obligation lifetime).

---

## 2. The two authority classes, preserved

| | **A. Connector / destination-pinned** | **B. Platform / operator-owned safety** |
| --- | --- | --- |
| Describes | how Reqro interacts with one destination | Reqro's own execution safety ceilings |
| Scope | organization + connector | **global** |
| Stored in | `integration_connector`, mirrored into `integration_connector_audit` | a separate operator-owned relation |
| Versioned by | `configuration_revision`, pinned per obligation | its own append-only `policy_revision` |
| Who may write | the reviewed connector-authoring boundary | **platform operators only** |
| Applied as | the destination's requested behaviour | a **tightening** bound over class A — a clamp where the two authorities propose comparable values (§8.2), and a **permission ceiling that refuses** where truncation would be unsafe (§5) |
| Historical value | **immutable**; a later connector revision never reinterprets an existing obligation | **not** per-obligation semantics; a ceiling consulted when a new action is authored |

**These are not collapsed into one table or one configuration object.** A
tenant administrator must never be able to widen a bound that exists to protect
the platform and the destination.

---

## 3. Connector-pinned policy candidates

| Candidate | Destination-specific? | Pin in audit? | Needed by 3C? | Verdict |
| --- | --- | --- | --- | --- |
| **Request execution budget** | yes — a slow destination legitimately needs a longer window | **yes** | **yes** — the fail-closed lease relation is checked against it | **REQUIRED** |
| **Destination retry base delay** | yes — and it is also the jitter floor (3-0 §14) | **yes** | **yes** — the backoff curve's floor | **REQUIRED** |
| **Destination retry maximum delay** | yes — the exponential cap | **yes** | **yes** | **REQUIRED** |
| **Destination retry attempt ceiling** | yes — a fragile destination warrants fewer | **yes** | **yes** — 3-0 §12 exhaustion | **REQUIRED** |
| Requested claim lease duration | no — the lease governs when *Reqro* reclaims *its own* work | — | no | **REJECTED**, see §5 |
| Destination retry horizon | 3-0 §26 already assigns the horizon to the **platform**, bounded by the pending-age ceiling | — | no | **LATER** — a connector-level horizon could only tighten; adding it later is non-breaking, and adding it now would be a second authority for one bound |
| Connector-specific rate-limit fallback | would substitute a tenant-configured guess for a rate the destination stated | — | no | **UNNECESSARY**, see §18 |

**Four connector-pinned fields.** Nothing speculative is added merely because
retry systems commonly have it.

---

## 4. Request execution budget — terminology FROZEN

> ### FROZEN: the term is **request execution budget**. It must NOT be called a **timeout**.

It is the complete wall-clock interval, measured from the **committed dispatch
boundary** (`dispatch_started_at`), within which the worker must have finished
the entire external interaction **and committed its settlement**:

```
prepare + connect + send + receive + settlement-margin
```

A reader who sees `timeout` will assume a socket or HTTP read timeout and
configure a number that excludes connection setup, response reading and the
settlement write — producing a budget smaller than reality and, through §5's
derivation, a lease that fences live workers. The naming is a security control,
not a style preference.

**It must itself be persisted as connector-pinned policy**, for two
independent reasons:

1. The fail-closed relation `effective lease > request execution budget` is
   enforced **in the database**, which cannot know a budget held only in worker
   deployment configuration.
2. It is destination-specific and must be **pinned**, so an administrator
   shortening the budget later cannot retroactively change how an
   already-claimed obligation was governed.

**No numeric value is selected.**

---

## 5. Lease policy shape — recommendation **B**

> ### ARCHITECTURE AMENDMENT — this section replaces previously frozen text
>
> The original derivation was
> `effective_lease = min(max_claim_lease, budget + margin)`. That `min()` was
> **wrong**, and the correction is recorded here rather than quietly applied.
> See the amendment note below the property table for the defect it allowed.

| Option | Verdict |
| --- | --- |
| A. Connector stores a requested claim lease duration | **REJECTED** — it invites a configuration that violates the lease relation, which the database must then detect and refuse. A contradiction that cannot be represented is better than one that must be caught |
| **B. Connector stores the request execution budget only; platform policy derives the lease** | **RECOMMENDED** |
| C. Both | **REJECTED** — two independently writable numbers for one invariant, with the weaker authority able to propose the unsafe side of it |
| D. Another source-backed model | **REJECTED** — no other source of destination timing exists; worker deployment configuration is not durable, not pinnable and not operator-controlled |

Under **B**:

```
required_lease  = pinned.request_execution_budget
                    + platform.lease_safety_margin

permitted       = required_lease <= platform.max_claim_lease

effective_lease = required_lease        -- only when permitted
                                        -- otherwise FAIL CLOSED: no lease,
                                        --   the obligation is not claimable
```

**`platform.max_claim_lease` is a hard permission ceiling, never a truncating
clamp.** It decides *whether* a lease may be authored. It never shortens one.

| Property | How B preserves it |
| --- | --- |
| **Auditability** | the budget is pinned by `configuration_revision`; the platform revision is pinned per §9; the derivation is a documented two-input expression |
| **Fail-closed** | `lease_safety_margin > 0` is a table constraint, so `required_lease > budget` holds **structurally** for every representable policy row. The derivation cannot produce a lease that fails to cover the budget, because the only alternative to `required_lease` is no lease at all |
| **Later tightening** | an operator lowers `max_claim_lease` fleet-wide by adding one platform revision, touching no connector. A revision that drops below some connector's `required_lease` does not shorten that connector's leases — it makes those obligations **unclaimable** until the connector's budget is reduced. Tightening is therefore always visible as refused work, never as a silently inadequate lease |
| **Tenant isolation** | a tenant can lengthen its *budget*, which only requests a longer window; the ceiling that decides whether that is allowed is not tenant-writable |
| **Worker owns nothing** | the worker supplies no lease, no budget and no margin |
| **No hard-coded SQL value** | both derivation inputs are rows |

**The worker/caller still cannot choose a lease duration, and no numeric value
is selected.**

> ### Amendment note: the defect the original `min()` allowed
>
> With `effective_lease = min(max_claim_lease, budget + margin)`, consider the
> band `budget < max_claim_lease < budget + margin`. The `min()` returns
> `max_claim_lease`, which is **longer than the budget but shorter than the
> required margin** — so the lease looks superficially valid while the entire
> safety margin has been silently eaten. A worker still inside its granted
> execution budget could then have its lease expire and be recovered
> mid-call: precisely the failure the margin exists to prevent.
>
> §11's original refusal did not catch this, because it only refused
> `max_claim_lease <= budget` — the band above is strictly wider. The margin
> is a **requirement**, not a preference, so the platform maximum must gate
> the lease rather than truncate it. A deployment whose ceiling is too low to
> cover a connector's required lease is a **misconfiguration to refuse**, not
> a lease to shorten.

> **3C implementation requirement: overflow-safe arithmetic and comparison.**
> `budget + margin` is addition over two independently operator- and
> tenant-supplied integers, and the comparison against `max_claim_lease`
> decides a security boundary. 3C must perform the addition and the comparison
> in a width that cannot wrap — `bigint` arithmetic, or an equivalent
> rearrangement such as comparing
> `budget <= max_claim_lease - margin` — so that no combination of stored
> values can produce a wrapped sum that *appears* to satisfy the ceiling. The
> positivity constraints bound each input, but they do not by themselves bound
> the sum, and a wrapped sum would fail **open**. This is an implementation
> obligation on 3C, recorded here because the amended derivation creates it.

---

## 6. Representation — integer seconds, FROZEN, and why not `interval`

**No `interval` column exists anywhere in the schema.** Intervals appear only
as literals inside expressions (two sites in `src/`). Every policy duration is
therefore proposed as `integer` seconds, with the unit **in the column name**
(`..._seconds`), and the database composes it with
`make_interval(secs => …)`.

| Candidate type | Verdict |
| --- | --- |
| **`integer` seconds** | **FROZEN.** Comparison is plain integer comparison; there is no calendar dependence; the unit is unambiguous because it is in the name |
| `interval` | **REJECTED.** `clock_timestamp() + interval '1 mon'` is calendar-dependent, and `interval` comparison normalises a month to thirty days — a deterministic but surprising rule to place underneath a security-sensitive `lease > budget` comparison. It is also unprecedented in this schema |
| `numeric` / fractional seconds | **REJECTED** — no approved semantic requires sub-second policy, and a float introduces rounding into a safety comparison |

Counts (attempts, recoveries, batch size) are plain `integer`.

`check (… > 0)` and `check (… >= 0)` bounds in this document are **structural
bounds, not policy numbers**: zero or negative values are meaningless, not
merely untuned.

---

## 7. Platform safety policy persistence model

| Option | Verdict |
| --- | --- |
| Singleton mutable table | **REJECTED** — a silent `UPDATE` destroys the only record of what governed a past lease, which is exactly the §9 audit question |
| **Append-only versioned revisions, current derived as the greatest `policy_revision`** | **RECOMMENDED** |
| Current pointer + immutable revisions | **REJECTED** — the pointer is a second mutable object that can disagree with the rows it points at, and it needs its own single-row guard |
| `is_active` boolean on otherwise immutable rows | **REJECTED** — a mutable flag on an immutable row, requiring a partial unique index to stay single, for information the revision order already carries |

**Current = the row with the greatest `policy_revision`.** Unambiguous,
immutable, and it needs no flag, no pointer and no extra index beyond the
primary key.

| Field | Needed? | Decision |
| --- | --- | --- |
| Revision number | **YES** | `policy_revision bigint`, primary key, **database-authored** and monotonically increasing. **AMENDED:** the original mechanism required the caller to insert `max + 1`; the caller must not choose the value at all. Gaps are acceptable |
| `created_at` | **YES** | `recorded_at timestamptz`, **database-assigned** — a caller cannot backdate a policy revision |
| Effective / active indicator | **NO** | derived from the revision order; see above |
| Supersedes relationship | **NO** | implied by the monotonic sequence. An explicit column would be derivable data, and a non-linear policy history is speculative |
| Descriptive reason | **YES** | bounded text. §9's "why was this allowed?" needs human context, and `tenant_domain_operator_approval.reason` is the precedent |
| Actor attribution | **NO — DEFERRED (AMENDED)** | the original design carried a bounded `actor` text column for traceability, following `integration_connector_audit.actor`. It is **removed**. There is no trusted operator identity model for this write surface, so the column could hold only self-declared text: attribution that looks authoritative in an audit and is not. Deferred until a reviewed operator-authoring path can produce **verifiable** attribution. `reason` and `correlation_id` carry the human and operational context in the meantime |

---

## 8. Platform safety fields — classification

| Field | Class | Why |
| --- | --- | --- |
| `max_claim_lease_seconds` | **REQUIRED FOR 3C** | the hard permission ceiling in §5's derivation; it gates whether a lease may be authored and never truncates one |
| `lease_safety_margin_seconds` | **REQUIRED FOR 3C** | the derivation input that makes the required lease exceed the budget |
| `max_destination_retry_delay_seconds` | **REQUIRED FOR 3C** | clamps the connector's exponential cap; the class-B guarantee of §2 |
| `max_destination_retry_attempts` | **REQUIRED FOR 3C** | clamps the connector's attempt ceiling |
| `max_retry_horizon_seconds` | **REQUIRED FOR 3C** | 3-0 §26 retry exhaustion, platform-owned |
| `max_pre_dispatch_recoveries` | **REQUIRED FOR 3C** | 3-0 §17.2, platform-only by design |
| `recovery_delay_seconds` | **REQUIRED FOR 3C** | 3-0 §18.2 |
| `max_recovery_batch_size` | **REQUIRED FOR 3C** | §13's clamp |
| A connector-level retry horizon | **LATER** | §3 |
| Pending eligible-age ceiling | **LATER, and not this feature's** | F062.2D-1A owns it. 3-0 §26 requires `max_retry_horizon <= pending-age ceiling`; that cross-constraint becomes enforceable only when the age ceiling is itself persisted, and persisting it here would annex another feature's decision |
| Recovery scan frequency | **UNNECESSARY as database policy** | §12 |

> **One naming discrepancy, surfaced rather than silently resolved.** The
> authorization lists *"maximum platform recovery delay"*. A **maximum** implies
> a second authority proposing a value to be clamped — but 3-0 §17.2 makes the
> pre-dispatch recovery delay **platform-only**, with no connector input. A
> `min()` over a single authority is meaningless, so the field is proposed as
> **`recovery_delay_seconds`**: the platform *is* the delay, not a ceiling over
> someone else's. The same reasoning does **not** apply to the other seven,
> each of which clamps a connector-proposed or caller-proposed value.

**Eight platform fields and four connector fields: twelve typed policy values
in total.** Every one is proposed because an approved 3C semantic consumes it.

### 8.1 Retry-horizon anchor — ARCHITECTURE AMENDMENT

> **AMENDMENT.** This replaces previously frozen wording that measured the
> destination retry horizon from the obligation's immutable `created_at`.

> ### FROZEN: `max_retry_horizon_seconds` begins at the FIRST non-null
> ### `dispatch_started_at` recorded for the obligation.

It does **not** begin at `integration_outbox.created_at`, at enqueue time, or
at first claim. **Before the first external dispatch, the destination retry
horizon has not started.**

| Rejected anchor | Why it is wrong |
| --- | --- |
| `created_at` / enqueue time | time spent awaiting first eligibility is **pending age**, which already has an owner (F062.2D-1A). Anchoring here makes one clock answer two questions, and lets queue backlog silently consume a destination's retry budget before Reqro has spoken to the destination once |
| First claim | a claim that expires before dispatch is a **pre-dispatch recovery** (3-0 §17.2) and explicitly does not advance the retry curve. Anchoring at first claim would let recovery churn exhaust the horizon with **zero** requests reaching the destination |
| First *settled* attempt | later than the first dispatch, so it would under-count a horizon that the destination has already begun experiencing |

**No new persistence is required.** The anchor is
`min(dispatch_started_at)` over the obligation's attempt evidence — written by
3A's `mark_integration_dispatch_started`, made immutable by the write-once
guard, and already recorded per attempt. A NULL anchor means the horizon has
not started, which is a true statement rather than a missing value.

Four clocks remain separate, and this amendment exists to keep them separate:

| Clock | Measures | Anchor | Bounded by |
| --- | --- | --- | --- |
| **Pending age** | time awaiting first eligibility | `integration_outbox.created_at` | F062.2D-1A's ceiling (not persisted here) |
| **Destination retry horizon** | how long Reqro keeps retrying one destination | **first non-null `dispatch_started_at`** | `max_retry_horizon_seconds` |
| **Claim lease** | one worker's exclusive execution window | that attempt's claim | §5's derivation |
| **Total obligation lifetime** | enqueue to terminal state | `created_at` | F062.2D-1A (3-0 §26 treats it as non-distinct from the age ceiling) |

### 8.2 Effective destination retry bounds — FROZEN

Both bounds have a connector-proposed value **and** a platform ceiling, so
both are a `min()` over the two authority classes of §2:

```
effective_retry_max_delay =
  min( pinned_connector.destination_retry_max_delay_seconds,
       platform.max_destination_retry_delay_seconds )

effective_destination_attempt_ceiling =
  min( pinned_connector.destination_retry_attempt_ceiling,
       platform.max_destination_retry_attempts )
```

**Required, and fail-closed when violated:**

```
pinned_connector.destination_retry_base_delay_seconds
  <= effective_retry_max_delay
```

| Rule | Reason |
| --- | --- |
| The base delay is **never clamped downward** | silently shortening a destination's stated minimum spacing is exactly how a client converts its own backoff policy into a faster retry storm against a destination that asked for slower. Clamping the base would make the violation invisible and the behaviour worse |
| A violation makes the obligation **policy-ineligible** | it is excluded from the claim candidate set, the same fail-closed shape an incomplete pinned snapshot already uses (§11) |
| **No fallback is invented** | the base is not replaced by the effective max, by the platform ceiling, or by any constant |

> **Why §28.1's connector constraint is not sufficient.** The connector row
> already enforces
> `destination_retry_base_delay_seconds <= destination_retry_max_delay_seconds`
> at write time. But the platform clamp can pull the **effective** max *below*
> a validly configured base — a configuration that was legal when written and
> becomes contradictory later, when a tighter platform revision is recorded
> and no connector row changed at all. The check must therefore be evaluated
> at derivation time against the **effective** value, not only at write time
> against the connector's own pair. This is a genuine gap in the original
> document, not a restatement of an existing constraint.

**`attempt_number` remains the immutable monotonic ordinal of attempt
evidence, NOT a destination retry count** (3-0 §12). Consumed destination
budget stays **derived** from qualifying dispatched, retryable attempt
evidence, so a pre-dispatch recovery records an attempt without consuming
destination budget.

---

## 9. Pinning the platform policy — the critical decision

The enterprise requirement is that an operator can later answer:

> *"Why was this lease / schedule allowed to have this value?"*

The connector half is already answered: the obligation pins
`pinned_connector_configuration_revision`, and the attempt independently
records `connector_configuration_revision` and `capability_snapshot`. The
platform half is answered by nothing today.

| Option | Audit consequence |
| --- | --- |
| Do not pin; rely on timestamps | **REJECTED.** The answer becomes *"whichever revision we believe was current at `started_at`"* — an inference across a clock boundary, not evidence, and 3-0 §9's own instruction is not to rely on what the policy says today |
| Pin on the **outbox obligation** | **REJECTED.** `next_attempt_at` is rewritten on every retry, so a single obligation-level pin would be overwritten too and would describe only the latest schedule. A mutable column is not evidence |
| Pin on **generated schedule evidence** (a new per-schedule table) | **REJECTED.** It answers the question, but it adds a row per retry and a new table for information the settling attempt already anchors. 3-0 §12 and §17.1 both rejected denormalised retry bookkeeping on the same principle |
| **Pin on the delivery attempt** | **RECOMMENDED.** The attempt is already the immutable, settle-once carrier of every other execution fact: the lease, the dispatch boundary, the reason code, the pinned connector revision and the capability snapshot |

### 9.1 FROZEN: two pins on the attempt, not one

A single column cannot answer both questions, because the lease is authored at
**claim** and the schedule or recovery consequence is authored at
**settlement** — and the platform policy may legitimately change in between.

| Column | Written | Answers |
| --- | --- | --- |
| `claim_policy_revision` | at claim, write-once, database-assigned | *"why was this `claim_expires_at` allowed?"* |
| `settlement_policy_revision` | at settlement, with `completed_at`, database-assigned | *"why was the `next_attempt_at` (or recovery delay) this settlement produced allowed?"* |

Both fall inside the existing write-once / settle-once guard shape, so they
need **no new guard mechanism** — only an extension of the one that already
governs `claim_expires_at`, `dispatch_started_at` and `reason_code`.

### 9.2 Per action

| Action | Pinned? | Where |
| --- | --- | --- |
| **Claim** | yes | `claim_policy_revision` |
| **Retry scheduling** | yes | `settlement_policy_revision` on the attempt whose settlement produced the schedule |
| **Pre-dispatch recovery** | yes | `settlement_policy_revision` on the attempt the recovery settles — distinct from the `claim_policy_revision` that authorised the expired lease, which is exactly the pair an operator needs to see |
| **Recovery scanning** | **NO** | a scan that acted on nothing has nothing to explain, and every row it *did* act on becomes a settled attempt carrying `settlement_policy_revision`. Pinning the scan itself would require a scan-log table for no additional answer |

**Minimum evidence frozen: two integers on the attempt, and no new table.**

---

## 10. Policy change semantics

| Class | Behaviour when policy changes |
| --- | --- |
| **May tighten immediately** | every class-B ceiling — consulted at the moment a *new* lease, schedule or recovery is authored. A new revision therefore governs the next action and nothing already recorded |
| **Pinned for determinism** | every class-A field, pinned by `pinned_connector_configuration_revision`. A connector revision never reinterprets an existing obligation |
| **Consulted only when a new attempt / schedule is created** | the entire platform class. There is **no background re-evaluation**, no sweep and no job that revisits existing rows |

> **Already-authored timestamps are durable facts.** A policy change must never
> `UPDATE` `claim_expires_at` or `next_attempt_at`. Tightening
> `max_claim_lease_seconds` does **not** shorten an outstanding lease: doing so
> would rewrite a durable fact and could fence a worker that is mid-call under
> the lease it was granted — the precise failure §5's relation exists to
> prevent. The shorter ceiling applies to the next claim, and per §5 it
> applies there as a **permission** decision: a connector whose `required_lease`
> no longer fits the new ceiling stops being claimable rather than receiving a
> truncated lease.

`claim_expires_at` is already write-once by guard. `next_attempt_at` is
rewritten only by an authoritative state transition, so the rule reduces to:
**a policy change is not a transition.**

---

## 11. Fail-closed policy completeness

> ### FROZEN: a per-obligation policy defect makes the obligation
> ### unclaimable. A deployment-level policy absence refuses the call.

The asymmetry is deliberate and forced by §26's backfill decision.

| Condition | Outcome | Why |
| --- | --- | --- |
| Pinned connector snapshot missing or not `revision_advanced` | already refused by the existing guard | unchanged |
| Pinned snapshot is **not execution-policy complete** (§25) | **the obligation is excluded from the claim candidate set** — zero rows, no exception | After 3B, **every** pre-existing audit row carries NULL policy (§26). If this raised, the claim function would be unusable until every connector was reconfigured *and* every historical obligation disposed of. Exclusion is the only workable fail-closed answer, and it is the same shape as the already-accepted ordering activation barrier (3-0 §4.0b) |
| Derived `required_lease > max_claim_lease` (§5) | **excluded from the candidate set** | data-dependent on a *pinned historical* budget, so it can be true for one old obligation and false for the next on the same connector. Raising would let one historical row block unrelated work. No lease is authored, and the platform ceiling is never applied by truncation |
| Derived `base_delay > effective_retry_max_delay` (§8.2) | **excluded from the candidate set** | same shape and same reason: a legal connector configuration can be contradicted by a later, tighter platform revision. The base delay is never clamped downward to rescue it |
| **No platform policy revision exists at all** | **the claim RAISES** | there is exactly one platform policy, globally. Its absence is a deployment-incomplete condition, cannot be caused by tenant data, and silence would hide it. Loud is correct |
| Retry scheduling: computed schedule would exceed `max_retry_horizon_seconds` | **park** — `retrying` + `next_attempt_at = NULL` | this *is* exhaustion, already frozen by 3-0 §13.3 |
| Pre-dispatch recovery: recovery bound reached | settle the attempt (the expiry is a real fact) and **park** the obligation | already frozen by 3-0 §17.3, with **no new reason code** |
| Inconsistent policy (e.g. base delay > max delay) | **unrepresentable** — a table constraint refuses the write | better than detecting it at claim time |

**No fallback constant is chosen. No default "reasonable" value exists
anywhere in this model.** Absence of policy is never substituted; it only ever
prevents an action.

> **Recorded, not implemented:** an operator needs to be able to list
> obligations that are unclaimable *because* their pinned revision is not
> policy-complete. The condition is derivable by query from existing evidence,
> so no new persistence is implied — but without the surface, a correctly
> fail-closed deployment looks like a silently stalled one. Same consequence,
> and same deferral, as 3-0 §29.2.

---

## 12. Recovery scan frequency — NOT database policy

> **FROZEN: scan cadence is worker deployment / runtime configuration.**

No database function consumes it: it governs how often a caller calls, not what
any function computes. 3-0 §26 already records it as *"required before a
recovery caller (not 2C-3)"*.

**It is not persisted here, and it must not be added to the platform policy
table merely because it appeared on an unresolved list.** Database policy is
limited to values database functions need.

---

## 13. Recovery batch size — clamp, FROZEN

> **FROZEN: the caller's `max_rows` is CLAMPED to the persisted operator
> ceiling. The function never trusts it and never rejects it for being large.**

```
effective_rows = least( greatest(max_rows, 1), platform.max_recovery_batch_size )
```

| Option | Verdict |
| --- | --- |
| Database platform-policy ceiling, caller input clamped | **FROZEN** |
| Hard function cap | **PROHIBITED** — an arbitrary constant in SQL, which 3-0 §6.3 forbids |
| Reject when `max_rows` exceeds the ceiling | **REJECTED** — it forces a caller to guess an operator-owned number that may tighten at any time, and a caller that guesses high simply fails instead of doing bounded work |
| Trust the caller | **REJECTED** — an arbitrarily large recovery batch is exactly the unbounded work the ceiling exists to prevent |

A non-positive `max_rows` is refused as a malformed argument. Absence of
platform policy refuses the call, per §11.

**No numeric ceiling is chosen.**

---

## 14. Destination `Retry-After` evidence model

| Option | Verdict |
| --- | --- |
| A. Raw `Retry-After` header text | **REJECTED.** Unbounded, externally controlled, privacy-relevant, and it would force the database to parse both `delta-seconds` and HTTP-date formats in SQL to do arithmetic on it |
| **B. Normalized non-negative duration, supplied by the adapter** | **FROZEN as the input and as the stored evidence** |
| C. Normalized absolute `retry_not_before_at`, supplied by the caller | **REJECTED.** Converting a stated delay into an absolute instant requires a clock, and a caller-supplied timestamp would put the *adapter's* clock into durable schedule evidence. The database authors timestamps |
| D. Both raw and normalized | **REJECTED** — the raw form is not needed once the delay is captured, and persisting it adds an unbounded external string for no answer |
| E. Adapter-produced bounded structured metadata | **Narrowed and adopted in substance** — this *is* bounded adapter-produced evidence, reduced to a single typed scalar rather than a structured object, because SQL performs arithmetic on it (§23) |

**One new column:** `destination_retry_after_seconds integer`, the delay the
destination stated. The **absolute floor is computed, never stored**:

```
floor        = clock_timestamp() + make_interval(secs => destination_retry_after_seconds)
policy_delay = bounded exponential jitter, per 3-0 §14
next_attempt_at = least( greatest(floor, clock_timestamp() + policy_delay),
                         clock_timestamp()
                           + make_interval(secs => platform.max_destination_retry_delay_seconds) )
```

Storing the computed floor as well would duplicate `next_attempt_at` whenever
the two agree and be mistaken for the authored schedule whenever they do not.
The stated delay plus `settlement_policy_revision` plus the pinned connector
revision answer the audit question without it.

---

## 15. `Retry-After` authority — future contract, frozen conceptually

```
adapter observes the destination response
  -> supplies a bounded non-negative delay to the completion function
     -> the function VALIDATES it structurally (§17)
        -> the DATABASE computes and stores next_attempt_at
           using its own clock and the clamping policy
```

> **The worker never supplies `next_attempt_at`, directly or indirectly.** A
> destination-stated delay is **input to an approved policy**, never a
> destination-controlled timestamp written into a schedule.

**No function signature changes in this slice**, and none in 3B. The frozen 3A
completion signature is
`complete_integration_attempt(uuid, uuid, uuid, bigint, text, varchar(18), varchar(28))
returns boolean`; accepting the delay requires one additional parameter, which
is a **reviewed signature change deferred to 3C** (3-0 §19.3 and §30 both say
so).

Consequence: between 3B-2 and 3C the column exists and is NULL-only, because no
function writes it. **That is the established pattern in this program** —
`claim_expires_at` landed in 2C-1 and stayed NULL until 3A widened the
descriptor, and `next_attempt_at` landed in 2C-2 and stayed NULL until 3A made
it eligible. It is safe for the same reason: no identity holds `EXECUTE`.

---

## 16. `Retry-After` persistence location

> **FROZEN: `integration_delivery_attempt`.**

| Candidate | Verdict |
| --- | --- |
| **`integration_delivery_attempt`** | **FROZEN.** An attempt records what happened during one external transmission, and a `Retry-After` is precisely that: per-try destination response evidence. 3-0 §19.2 option B states it directly. It also sits alongside `dispatch_started_at`, `failure_category` and `reason_code`, under the guard that already makes attempt evidence settle-once and immutable |
| `integration_outbox` | **REJECTED** — the obligation is *what must be delivered*, not what a destination said during one try. It would also be overwritten each retry, losing the per-try evidence |
| A separate response-evidence table | **REJECTED** — a 1:0..1 table for one bounded scalar, with its own tenant-scoping, guard and rollback surface, for no additional answer |

---

## 17. Retry evidence structural bounds

> **This would be the FIRST caller-supplied, externally-influenced value
> persisted on `integration_delivery_attempt`.** Every other caller input there
> is either a fence argument that is compared and discarded, or a value the
> guard overwrites with its own (`dispatch_started_at`). That makes the
> validation list a security boundary, not hygiene.

| Rule | Form |
| --- | --- |
| Non-negative | `check (destination_retry_after_seconds is null or destination_retry_after_seconds >= 0)`. **Zero is legal** — a destination may state "retry immediately" — unlike a lease or a budget, where zero is meaningless |
| Bounded by platform safety | enforced in the function against `max_destination_retry_delay_seconds`, **not** as a table constraint, because the bound is a policy revision that may change while the evidence is immutable |
| Legal only with `rate_limited` | `check (destination_retry_after_seconds is null or failure_category = 'rate_limited')` |
| Absent for success, and for every other category | the same constraint, since `failure_category` is null for a success |
| Absent while open | `check (destination_retry_after_seconds is null or completed_at is not null)` |
| Immutable after settlement | the existing settle-once guard; set with `completed_at`, never updated |
| Malformed values never persist | a non-integer, negative or out-of-bound value refuses the settlement rather than being coerced |

**No numeric maximum is chosen.**

---

## 18. `rate_limited` with no destination evidence — recommendation **A**

| Option | Verdict |
| --- | --- |
| **A. Park at `retrying` + `next_attempt_at = NULL`** | **RECOMMENDED — the safest enterprise behaviour** |
| B. Use a connector-configured rate-limit fallback | **REJECTED** — it reintroduces exactly what 3-0 §19.2 rejected: retrying a destination that *stated a rate* on a curve Reqro invented. Moving the invented number into tenant configuration does not make it the destination's rate |
| C. Another model | none identified that does not reduce to A or B |

Parking is the shape 3-0 already froze for both exhaustion cases
(3-0 §13.3 and 3-0 §17.3): visible, not automatically claimable,
successors blocked by strict FIFO, awaiting operator disposition.
Reusing it here adds no new state, no new reason code and no new
vocabulary.

**`destination_unavailable` behaviour is explicitly NOT changed by this** —
see §19.

---

## 19. `destination_unavailable` — the distinction preserved

No `Retry-After` evidence is required or expected. Nothing in a
destination-unavailable response expresses a requested delay, so there is no
instruction to ignore. Its schedule comes from **connector-pinned retry policy
constrained by platform safety policy**: bounded exponential jitter over
`destination_retry_base_delay_seconds` and
`destination_retry_max_delay_seconds`, clamped by
`max_destination_retry_delay_seconds`, with the exponent taken from the 3-0 §12
destination retry count.

**Exhaustion behaviour is unchanged by this slice.** Destination retry-budget
exhaustion and pre-dispatch recovery-budget exhaustion both park the obligation
as `retrying` + `next_attempt_at = NULL`. **No automatic dead-lettering. No new
attempt reason code.** 3B must not alter any of it.

---

## 20. Policy revision evidence and observability

| Use | Verdict |
| --- | --- |
| Audit logs and operator queries | **appropriate** — `claim_policy_revision`, `settlement_policy_revision` and `connector_configuration_revision` are exactly the identifiers that answer §9's question |
| **Metric labels / dimensions** | **PROHIBITED** — a revision identifier grows without bound over a deployment's life, so using it as a label is unbounded cardinality. The same objection already applies to `configuration_revision` |
| Policy **values** in metrics | **PROHIBITED** — a lease or delay value as a label is both high-cardinality and a disclosure of platform safety configuration |

**F061 is not changed by this slice**, and no telemetry concept is added.
F061.3D remains the emission gate before any worker activation.

---

## 21. Tenant isolation

| Risk | Prevented by |
| --- | --- |
| Organization A using Organization B's connector policy | every policy read is keyed `(organization_id, integration_connector_id, configuration_revision)` taken from the obligation's **own** pin — the exact key `integration_connector_audit_revision` already indexes, and the exact pattern Migration 55 uses to derive `requires_ordered_delivery` |
| A tenant admin weakening platform ceilings | the platform relation is **global and has no `organization_id` column at all**, so there is no tenant-scoped row to reach; it is not tenant-writable; and every ceiling is applied as a tightening `min`/`least` inside a `SECURITY DEFINER` function the tenant cannot execute |
| Current mutable connector configuration reinterpreting old obligations | the read is **by pinned revision**, never from `integration_connector`'s current row. `advancesConfigurationRevision` guarantees a policy change mints a new revision, leaving the old snapshot intact |

> **The platform policy table must never gain an `organization_id` column.** The
> moment it does, it stops being a platform ceiling and becomes tenant policy.
> This is listed as a mandatory test in §29.

---

## 22. Administrative write surface — conceptual, no grant here

| Policy class | Eventual authority mechanism |
| --- | --- |
| **Connector policy** | the **existing connector-authoring boundary** — `integration_connector` plus the audit guard and the `configuration_revision` advance. A reviewed admin/configuration function in a later slice; **not** a new path |
| **Platform policy** | **operator-only**, following the `reqro_operator` precedent in `deploy/database/operator-role.sql`: `SELECT, INSERT` on an append-only relation, **never `UPDATE` or `DELETE`**, with an immutability guard trigger behind it — the same two-barrier shape that makes `tenant_domain_operator_approval` inert |

| Identity | Platform policy | Connector policy columns |
| --- | --- | --- |
| `reqro_runtime` | **no access** | **no access** (it holds nothing on any integration table today, and must not gain any) |
| `reqro_integration_function_owner` | `SELECT` only | `SELECT` only (already holds it) |
| `reqro_operator` | `SELECT, INSERT` | no access |

**No grant is added in this slice, and no policy table is CRUD-exposed to any
application path.** Per §29, tenant authority over connector policy is
**logical authority through the reviewed authoring boundary** rather than a
direct table privilege, and the connector audit snapshot is database-authored
by that boundary. Platform policy creation awaits a **separately reviewed
operator-authoring boundary**; naming `reqro_operator` as the eventual
authority is not a decision to grant it anything here.

**Trusted actor attribution is deferred** (§7, §28.3). Until a reviewed
operator-authoring path can produce verifiable attribution, the policy row
records `reason` and `correlation_id` and claims no actor identity.

---

## 23. Append-only audit representation — typed columns

> **FROZEN: typed `integer` columns in `integration_connector_audit`, not an
> opaque JSON policy object.**

| Reason | Detail |
| --- | --- |
| SQL does arithmetic on these values | `budget + margin`, `base * 2 ^ n`, `least(...)`, `make_interval(secs => ...)`. A JSON object would be re-parsed and re-cast on **every claim and every settlement** |
| Constraints must express them | non-negativity, `base <= max`, and the all-or-nothing completeness rule of §25 are table constraints over columns, not over JSON paths |
| It matches the existing snapshot | every capability is already a typed column in the audit table, field for field |

The instructive contrast is already in the schema:
`integration_delivery_attempt.capability_snapshot` **is** JSON — and that is
correct, because it is a frozen copy kept for later interpretation that **no
SQL expression computes with**. Execution policy is the opposite case.

### 23.1 A new change category is required

`connectorChangeCategories` currently holds exactly four members:
`registered`, `lifecycle_changed`, `capabilities_changed`,
`credential_reference_rotated`. An execution-policy change is **semantic**, so
3B must add:

```
'execution_policy_changed'
```

and `advancesConfigurationRevision` must return `true` for it — the exclusion
applies only to `credential_reference_rotated`. Folding policy changes under
`capabilities_changed` is **rejected**: it would make an audit history unable to
distinguish a capability change from a timing change, and those have different
reviewers.

---

## 24. Connector update semantics — verified, supported

| Requirement | Repository state |
| --- | --- |
| A policy change increments `configuration_revision` | **supported** — `advancesConfigurationRevision` already governs this, and the new category joins the advancing set |
| It writes a new immutable audit snapshot | **supported** — the `integration_connector_audited` constraint trigger already requires one and verifies it against committed connector state |
| **No second revision counter is created** | **confirmed** — `configuration_revision` (semantic pin) and `record_revision` (concurrency token) are sufficient. 3B adds **no** policy revision counter to the connector; the only new revision sequence in this design is the platform table's own `policy_revision`, which is a different authority class |

---

## 25. Policy activation — derived completeness, no flag

> **FROZEN: a connector revision is execution-policy complete when ALL FOUR
> required policy columns are non-null. There is no `policy_ready` flag.**

| Option | Verdict |
| --- | --- |
| **All required fields non-null, derived** | **FROZEN** — a flag would be derivable data that can disagree with the data it describes |
| Explicit policy-ready flag | **REJECTED** — redundant, and it introduces a state where the flag is set and a field is null |
| Derived completeness check | this *is* the derived check |

And the hazard the authorization names — *"a connector should not become
worker-executable merely because one field was configured"* — is removed
**structurally** rather than by a runtime check:

```
check (   (all four policy columns are null)
       or (all four policy columns are non-null) )
```

A partially configured revision is **unrepresentable**. One table constraint
replaces both a flag and a class of bug.

Completeness is necessary but **not sufficient**. A claim additionally requires
a dispatching lifecycle state (`active` or `degraded`, per
`dispatchingLifecycleStates`), an existing platform policy revision, and a
permitted lease relation — `required_lease <= max_claim_lease` (§5).

---

## 26. Existing-row backfill — NULL, FROZEN

> **FROZEN: every existing `integration_connector` row and every existing
> `integration_connector_audit` row receives NULL for every new policy column.
> NOTHING is backfilled.**

**NULL means "execution policy was not established for this revision"** — a
true statement about history. No value is fabricated, no default is invented,
and the all-or-nothing constraint of §25 is satisfied by the all-null side.

Consequence, verified as acceptable: **every currently-enqueued obligation
becomes permanently unclaimable by 3C** unless its connector is reconfigured
and the work is re-enqueued or disposed of by an operator.

| Why that is acceptable | |
| --- | --- |
| No obligation is claimable by anything today | no worker exists, no identity holds `EXECUTE`, and 3A proved the api schema is closed to PUBLIC and to `reqro_runtime` |
| Fail-closed is the required behaviour | 3C must never invent missing policy, and an obligation whose governing policy was never established has no correct lease |
| The shape is already accepted | it is the same one-time barrier as the ordering activation barrier (3-0 §4.0b): historical rows drain or are disposed of, and the condition is queryable from existing evidence |

### 26.1 Pre-3C activation gate — PROMOTED FROM CONSEQUENCE (AMENDED)

The pre-policy backlog was originally recorded as an *operational
consequence*. That understates it: it is a **precondition on activation**, and
it is frozen here as one.

> ### FROZEN GATE: before F062.2D-2C-3C ships, and before any worker `EXECUTE`
> ### grant is created, the deployment MUST inventory every obligation pinned
> ### to a connector revision that lacks complete execution policy, and each
> ### such obligation requires explicit operator disposition through a
> ### separately reviewed process.

| Gate requirement | Detail |
| --- | --- |
| **Inventory** | enumerate every non-terminal obligation whose pinned `configuration_revision` snapshot is not execution-policy complete (§25). Derivable by query from existing evidence — the pinned key is already covered by `integration_connector_audit_revision` — so **no new persistence is implied** |
| **Disposition** | explicit and operator-driven: reconfigure the connector and re-enqueue, or dispose of the obligation. This decision defines **neither** mechanism and authorizes neither |
| **Prohibited remedy** | **rewriting an immutable historical audit snapshot to make old work claimable.** The snapshot records what policy governed revision N, and that answer is NULL. Editing it would fabricate history to serve throughput, and the audit guard refuses it in any case |
| **Prohibited remedy** | backfilling invented policy values into historical rows (§26) — the same fabrication by another route |
| **Ordering** | the gate precedes 3C **and** precedes any `EXECUTE` grant. It is not a post-activation cleanup task, because after activation an un-dispositioned obligation is indistinguishable from a stalled one |
| **Why a gate rather than a consequence** | a correctly fail-closed deployment and a silently broken one look identical from the outside. Requiring the inventory **before** activation is what makes the difference observable at the only moment it can still be acted on cheaply |

The no-backfill rule of §26 is **unchanged** and this gate depends on it:
historical connector audit revisions keep NULL/incomplete policy, and the gate
is the reviewed path by which affected work is dealt with instead.

---

## 27. Rollback rules for the future 3B migration

> ### FROZEN (AMENDED, strengthened): 3B-1's `down()` must refuse if ANY
> ### durable execution-policy evidence exists — not merely evidence that an
> ### attempt references.

The original rule keyed the refusal on policy evidence *referenced by an
obligation or attempt*. That is too narrow: a recorded platform policy
revision that no attempt has used yet, and a connector policy value written
but not yet claimed against, are both durable records of an authorized
decision. Rollback must refuse on **any** of them.

| `down()` must REFUSE when any of these holds | Why it is durable evidence |
| --- | --- |
| any `integration_connector` row has a non-null execution-policy field | a tenant exercised configuration authority through the reviewed boundary |
| any `integration_connector_audit` row has a non-null mirrored policy field | an immutable historical snapshot of that authorized change |
| **any row exists in `integration_execution_safety_policy`** | an operator recorded a reviewed platform safety decision. Unreferenced is not unimportant |
| any `integration_delivery_attempt` has a non-null `claim_policy_revision` | the authority under which a lease was granted |
| any `integration_delivery_attempt` has a non-null `settlement_policy_revision` | the authority under which a schedule or recovery consequence was authored |

| Rollback must NOT | Why |
| --- | --- |
| delete policy rows | destroying the record of a decision to make a schema change succeed inverts the purpose of keeping it |
| NULL out policy evidence | the same destruction, performed column-wise |
| rewrite historical audit snapshots | the audit table is immutable by guard; a migration must not be the one exception |
| fabricate compatibility | no default, placeholder or synthesised revision may be written to let `down()` proceed |

| A clean rollback is permitted ONLY when ALL of these hold | |
| --- | --- |
| every new `integration_connector` policy field is NULL in every row | |
| every new `integration_connector_audit` policy field is NULL in every row | |
| `integration_execution_safety_policy` is **empty** | |
| every attempt policy pin (`claim_policy_revision`, `settlement_policy_revision`) is NULL | |

That is the state immediately after apply, and it is the **only** rollback
path that can succeed. Dropping columns that are NULL everywhere and an empty
policy table destroys nothing.

| Additional structural defence | Form |
| --- | --- |
| **Referential, not merely procedural** | the two foreign keys from the attempt to `integration_execution_safety_policy(policy_revision)` make part of this guarantee referential: the table cannot be dropped, and a referenced policy row cannot be deleted, while attempt evidence points at it. The explicit `down()` checks above cover what referential integrity cannot — notably an **unreferenced** policy row and non-null policy columns that no attempt has pinned |
| Rollback never erases business evidence | as in 3A: a `destination_retry_after_seconds` or policy revision written while 3B was active is durable evidence; the refusal protects it rather than deleting it |

---

## 28. Proposed schema — exact, and NOT created

### 28.1 `integration_connector` — four new columns

| Name | Type | Nullable | Default | Authority | Meaning |
| --- | --- | --- | --- | --- | --- |
| `request_execution_budget_seconds` | `integer` | yes | none | connector config writer, within the platform bound | §4's complete external interaction window, from the committed dispatch boundary through the settlement write |
| `destination_retry_base_delay_seconds` | `integer` | yes | none | connector config writer | 3-0 §14 `base_delay`, and the jitter floor |
| `destination_retry_max_delay_seconds` | `integer` | yes | none | connector config writer | 3-0 §14 exponential cap, before the platform clamp |
| `destination_retry_attempt_ceiling` | `integer` | yes | none | connector config writer | 3-0 §12 destination retry budget, before the platform clamp |

| Constraint | Form |
| --- | --- |
| `integration_connector_execution_policy_positive` | each of the four is null or `> 0` |
| `integration_connector_execution_policy_complete` | all four null **or** all four non-null (§25) |
| `integration_connector_retry_delay_ordered` | `destination_retry_base_delay_seconds <= destination_retry_max_delay_seconds` when both are non-null |

**No new index.** No query filters on these columns; they are read by primary
key or by the already-indexed audit key.

### 28.2 `integration_connector_audit` — the same four columns, mirrored

Identical names, types and nullability; `_audit_`-prefixed constraint names.
The audit snapshot is the **pinned** source every policy read uses; the live
connector columns exist only so a configuration writer has somewhere to write
and the guard has something to verify the snapshot against — exactly the
existing capability arrangement.

**No new index** — `integration_connector_audit_revision` already covers
`(organization_id, integration_connector_id, configuration_revision)
where revision_advanced`.

### 28.3 `integration_execution_safety_policy` — new table, global, append-only

| Name | Type | Nullable | Default | Authority | Meaning |
| --- | --- | --- | --- | --- | --- |
| `policy_revision` | `bigint` | no | identity | **database** | primary key; monotonic; the pin target. **The caller cannot choose it** |
| `max_claim_lease_seconds` | `integer` | no | none | operator | ceiling on any derived lease |
| `lease_safety_margin_seconds` | `integer` | no | none | operator | added to the pinned budget to derive the lease |
| `max_destination_retry_delay_seconds` | `integer` | no | none | operator | clamp on the connector's cap |
| `max_destination_retry_attempts` | `integer` | no | none | operator | clamp on the connector's attempt ceiling |
| `max_retry_horizon_seconds` | `integer` | no | none | operator | retry exhaustion horizon, measured from the **first non-null `dispatch_started_at`** for the obligation (§8.1, amended) |
| `max_pre_dispatch_recoveries` | `integer` | no | none | operator | 3-0 §17.2 bound |
| `recovery_delay_seconds` | `integer` | no | none | operator | 3-0 §18.2 platform recovery delay — the value itself, not a ceiling (§8) |
| `max_recovery_batch_size` | `integer` | no | none | operator | §13's clamp for `max_rows` |
| `reason` | `varchar(200)` | no | none | operator | why this revision exists; human context for §9's question |
| `correlation_id` | `uuid` | no | none | operator | ties the change to its originating operation |
| `recorded_at` | `timestamptz` | no | `clock_timestamp()` | **database** | a caller cannot backdate a revision |
| `mutation_txid` | `bigint` | no | `txid_current()` | **database** | matches the `integration_connector_audit` and `integration_delivery_attempt` convention |

| Constraint | Form |
| --- | --- |
| primary key | `(policy_revision)` |
| `…_positive` | every one of the eight numeric policy columns `> 0` |
| `…_margin_positive` | `lease_safety_margin_seconds > 0` — this is what makes `budget + margin > budget` **structural** (§5) |
| `…_revision_positive` | `policy_revision > 0` — retained as a cheap backstop, because a sufficiently privileged writer can still bypass identity generation with `OVERRIDING SYSTEM VALUE` |
| guard trigger `guard_integration_execution_safety_policy` | refuses `UPDATE`, `DELETE` and `TRUNCATE`; forces `recorded_at` and `mutation_txid`. **AMENDED:** it no longer checks `max + 1`, because revision authorship moved to the database (below) |

> ### AMENDED: `policy_revision` is database-authored
>
> The original design made `policy_revision` an `integer` that the operator
> inserted as `max + 1`, enforced by the guard trigger. That is replaced.
>
> | Property | Decision |
> | --- | --- |
> | Type | `bigint` — a revision counter should not be the thing that runs out |
> | Authorship | **the database**, via PostgreSQL identity (`generated … as identity`) or an equivalent repository-consistent database authority |
> | Caller | **cannot choose the value**; it supplies policy values, `reason` and `correlation_id` only |
> | Monotonicity | guaranteed by the sequence, not by a read-then-write the caller performs |
> | **Gaps** | **acceptable.** A rolled-back transaction consumes a sequence value, so the history may read 1, 2, 5. Nothing depends on contiguity — "current" is the **greatest committed** revision, and pins reference a revision by value |
> | Why it is safer | `max + 1` is a read-modify-write across two statements. Two concurrent operator inserts either collide on the primary key or, under a weaker isolation level, require the unique index to be the real serializer. Identity removes the race rather than detecting it |
>
> Unchanged: **current = the greatest committed `policy_revision`**. There is
> still **no `is_active` flag** and **no mutable current-policy pointer**.

**No `organization_id`, ever** (§21). **No index beyond the primary key** — the
only read is "the greatest revision", which the primary key index serves, and
the only other read is by `policy_revision` from a foreign key.

### 28.4 `integration_delivery_attempt` — three new columns

| Name | Type | Nullable | Default | Authority | Meaning |
| --- | --- | --- | --- | --- | --- |
| `claim_policy_revision` | `bigint` | yes | none | **database**, write-once at claim | which platform revision authorised this lease (§9) |
| `settlement_policy_revision` | `bigint` | yes | none | **database**, written with `completed_at` | which platform revision authored this settlement's schedule or recovery consequence (§9) |
| `destination_retry_after_seconds` | `integer` | yes | none | **caller-supplied, database-validated** (3B-2 only) | the retry floor the destination stated (§14) |

| Constraint | Form |
| --- | --- |
| FK `…_claim_policy_fk` | `claim_policy_revision` → `integration_execution_safety_policy(policy_revision)`, no action on delete |
| FK `…_settlement_policy_fk` | `settlement_policy_revision` → same, no action on delete |
| `…_settlement_policy_settled` | `settlement_policy_revision is null or completed_at is not null` |
| `…_retry_after_nonnegative` | `destination_retry_after_seconds is null or destination_retry_after_seconds >= 0` |
| `…_retry_after_rate_limited` | `destination_retry_after_seconds is null or failure_category = 'rate_limited'` |
| `…_retry_after_settled` | `destination_retry_after_seconds is null or completed_at is not null` |
| guard extension | both revision columns are database-assigned and write-once; `destination_retry_after_seconds` is immutable after settlement |

> **Both pins are `bigint` to match the amended `policy_revision`** (§28.3).
> A narrower referencing column would make every foreign-key check a
> cross-type comparison and would cap the pin below the range of the value it
> references.

> **The settled constraints are deliberately one-directional.** A biconditional
> (`settlement_policy_revision is null` **iff** `completed_at is null`) would
> break every pre-3B settled attempt, which has `completed_at` non-null and the
> new column NULL. §26's backfill decision forces the weaker form.

**No new index.** A reverse lookup ("which attempts used revision N") is an
operator-audit query that does not yet have a surface; adding an index for it
now would be speculative.

**Totals: zero new tables for evidence, one new table for platform policy,
eleven new columns, thirteen new constraints, two foreign keys, one new guard
trigger, one guard extension, and no new index.**

---

## 29. Proposed trust matrix

| Data | Tenant admin / config writer | `reqro_runtime` | Function owner | `reqro_operator` | Worker (F062.2D-3, **does not exist**) |
| --- | --- | --- | --- | --- | --- |
| `integration_connector` policy columns | **LOGICAL AUTHORITY** over its own Organization's values, exercised **through the existing reviewed connector-authoring boundary**. **NOT direct table `UPDATE`** | **NO ACCESS** | **READ** | NO ACCESS | NO ACCESS |
| `integration_connector_audit` policy columns | **NO DIRECT INSERT.** The snapshot is **database-authored** by that same boundary as a consequence of an authorized connector change | **NO ACCESS** | **READ** | NO ACCESS | NO ACCESS |
| `integration_execution_safety_policy` | **NO ACCESS** | **NO ACCESS** | **READ** | **READ + INSERT** (append-only), through a future separately reviewed operator-authoring boundary | NO ACCESS |
| `integration_delivery_attempt.claim_policy_revision` | NO ACCESS | **NO ACCESS** | **WRITE** (write-once at claim) | NO ACCESS | NO ACCESS — it never names a value |
| `integration_delivery_attempt.settlement_policy_revision` | NO ACCESS | **NO ACCESS** | **WRITE** (at settlement) | NO ACCESS | NO ACCESS — it never names a value |
| `integration_delivery_attempt.destination_retry_after_seconds` | NO ACCESS | **NO ACCESS** | **WRITE** (validated) | NO ACCESS | **supplies a validated argument only**, and only through a future reviewed function signature |
| Lease / schedule authorship | NO ACCESS | NO ACCESS | **sole author** | NO ACCESS | NO ACCESS |

> ### AMENDED: what "WRITE" means in row 1
>
> A tenant administrator's authority over connector execution policy is
> **logical**, not physical. It is exercised by invoking the existing reviewed
> connector-authoring boundary, which validates the change, advances
> `configuration_revision` and writes the audit snapshot. A tenant
> administrator does **not** hold `UPDATE` on `integration_connector` and does
> **not** `INSERT` audit rows; the audit snapshot is database-authored.
>
> | Surface | Clarified position |
> | --- | --- |
> | `integration_connector` policy columns | written only through the reviewed authoring boundary; no direct table privilege is implied or added |
> | `integration_connector_audit` policy columns | **database-authored** by that boundary; no identity inserts audit rows by hand |
> | `integration_execution_safety_policy` | receives **no** runtime grant, **no** tenant grant and **no** worker grant. A future, separately reviewed **operator-authoring boundary** owns platform policy creation; §22 fixes the authority, not the mechanism |
> | 3B-1 | **adds no direct grant of any kind** |

**No privilege is granted by this slice.** `reqro_runtime` holds nothing on any
integration table today and gains nothing. `reqro_integration_worker` does not
exist and no `EXECUTE` grant is proposed.

---

## 30. Proposed 3B migration scope

| Area | Change |
| --- | --- |
| `integration_connector` | four nullable policy columns, three constraints |
| `integration_connector_audit` | the same four columns mirrored, three constraints |
| **New**: `integration_execution_safety_policy` | the table, its constraints and its immutability guard. **Zero rows** — no policy revision is seeded, because seeding one would be choosing numbers |
| `integration_delivery_attempt` | `claim_policy_revision`, `settlement_policy_revision`, two foreign keys, one constraint, guard extension (3B-1); `destination_retry_after_seconds` and its three constraints (3B-2) |
| `src/integration/persistence/connector-metadata.ts` | add `execution_policy_changed` to `connectorChangeCategories`; it advances `configuration_revision` |
| `src/database/database.types.ts` | the new columns and the new table, typed by the same unions the constraints use |
| Focused database tests | §32 |
| Docs | the 3B feature record |

**Explicitly NOT in 3B:**

- **no worker function change.** The claim does not yet read policy, the
  completion does not yet accept a retry floor, and no recovery function
  exists. Every function consumption is 3C's;
- no role, grant or membership change;
- no policy row, and therefore no number;
- no change to the exhaustion shape, the transition graph, the reason-code
  vocabulary or F061.

Per the authorization: because `Retry-After` persistence requires a future
completion-signature change, **that function modification is deferred to 3C**
and 3B adds persistence only.

---

## 31. Slice recommendation: **B — split**

| | |
| --- | --- |
| A. Single 3B | **NOT RECOMMENDED** |
| **B. 3B-1 execution-policy persistence, then 3B-2 destination rate-limit evidence persistence** | **RECOMMENDED** |
| C. Another blocker exists | no — every architectural question this slice was asked is answered above |

The split is recommended on reviewability, not on commit count:

1. **The two halves have different security characters.** 3B-1 adds
   database-authored and operator-authored policy. 3B-2 adds the **first
   caller-supplied, externally-influenced value persisted on the attempt**, with
   its own validation surface (§17) and its own guard change. Reviewing a
   twelve-field authority model and a new external-input boundary in one pass
   dilutes both.
2. **3B-2 is independently deferrable and already has an approved fallback.**
   3-0 §19.2 option C permits 3C to park `rate_limited` instead. If 3B-2 is not
   approved, 3C proceeds on 3B-1 alone with `rate_limited` parked per §18 —
   which is this document's recommendation regardless.
3. **3B-1 unblocks 3C on its own.** Lease authorship, retry scheduling for
   `destination_unavailable`, and recovery all depend only on 3B-1.
4. **Rollback surfaces differ.** 3B-1's refusal is about policy evidence
   referenced by attempts; 3B-2's is about destination response evidence. They
   are separately provable.

### 31.1 Exact proposed next slice

> **F062.2D-2C-3B-1 — Execution policy persistence**
>
> The four connector policy columns and their audit mirror; the
> `integration_execution_safety_policy` table with its append-only guard and
> **no rows**; `claim_policy_revision` and `settlement_policy_revision` with
> their foreign keys and guard extension; the `execution_policy_changed`
> category; the database types; the §32 tests other than the `Retry-After`
> group; the feature record.
>
> **No function change. No grant. No number.**

---

## 32. Mandatory security invariants for implementation

| # | Must prove |
| - | --- |
| 1 | Connector policy pinning survives a later connector change — an obligation pinned to revision N still reads revision N's policy after the connector advances to N+1 with different values |
| 2 | Existing audit rows retain **NULL** policy; the migration backfills nothing |
| 3 | No column, constraint or function supplies a default or fallback policy value |
| 4 | Tenant isolation — Organization A's policy read cannot return Organization B's row, proven on the pinned key |
| 5 | Platform policy is **not tenant-writable**, and the table **has no `organization_id` column** |
| 6 | `reqro_runtime` cannot read or mutate either policy surface, and holds nothing new |
| 7 | Policy revision history is immutable — `UPDATE`, `DELETE` and `TRUNCATE` all refused; the trigger cannot be disabled or dropped by the writing role; rows compared by content digest before and after |
| 8 | `policy_revision` is **database-authored** — a caller cannot choose it, revisions increase monotonically, and a gap in the sequence is accepted without error; `recorded_at` and `mutation_txid` are database-authored and a caller-supplied value is discarded |
| 9 | An unsafe lease relation is refused — `required_lease > max_claim_lease` excludes the obligation from the candidate set and authors **no** lease; the platform ceiling is proven **never** to truncate `required_lease` into a lease shorter than `budget + margin` |
| 10 | Missing platform policy fails closed — the claim **raises**, and no lease, schedule or recovery is authored |
| 11 | A partially configured connector revision is **unrepresentable**; the all-or-nothing constraint refuses it |
| 12 | Policy completeness alone does not make a connector executable — lifecycle state and the lease relation are also required |
| 13 | A policy change does **not** rewrite `claim_expires_at` or `next_attempt_at` on any existing row |
| 14 | Policy revisions are auditable — the pair (`claim_policy_revision`, `settlement_policy_revision`) answers §9's question for a lease and for the schedule its settlement produced |
| 15 | *(3B-2)* `destination_retry_after_seconds` is legal **only** with `failure_category = 'rate_limited'`; refused for a success and for every other category |
| 16 | *(3B-2)* It is refused while the attempt is open, and immutable after settlement; a negative value is refused |
| 17 | **No caller-authored `next_attempt_at`** — no path accepts a caller timestamp for a schedule, and the database remains the sole author |
| 18 | Rollback preserves evidence — `down()` refuses while **any** of §27's five conditions holds, including a platform policy row that **no attempt references**; the foreign keys make part of it referential; no policy row is deleted, no policy column is NULLed, and no audit snapshot is rewritten to make rollback succeed |
| 19 | A clean rollback immediately after apply succeeds and destroys nothing — proven against all four of §27's permitted-rollback conditions |
| 20 | `execution_policy_changed` advances `configuration_revision` and writes an audit snapshot; **no second revision counter exists** on the connector |
| 21 | Caller-supplied `max_rows` is **clamped**, not trusted and not rejected; a non-positive value is refused |
| 22 | The retry horizon is anchored at the **first non-null `dispatch_started_at`** (§8.1) — an obligation that has never dispatched has **no** started horizon, and pre-dispatch recovery churn does not advance it |
| 23 | `effective_retry_max_delay` and `effective_destination_attempt_ceiling` are the `min()` of the pinned connector value and the platform ceiling; `base_delay > effective_retry_max_delay` makes the obligation policy-ineligible, and the base delay is **never** clamped downward (§8.2) |
| 24 | The §26.1 activation inventory is answerable **by query from existing evidence** — obligations pinned to revisions without complete execution policy are enumerable without new persistence and without rewriting any snapshot |

---

## 33. Unresolved numerical values

**All thirteen rows of 3-0 §26 remain UNRESOLVED, and this slice resolves
none of them.** It resolves only *where each value lives, who may write it, and
what happens when it is absent*.

| Value | Will live in |
| --- | --- |
| Claim lease duration | derived (§5); no stored lease |
| Lease duration floor | structural — `lease_safety_margin_seconds > 0` makes `required_lease > budget` unconditional (§5) |
| Lease duration ceiling | `integration_execution_safety_policy.max_claim_lease_seconds`, applied as a **permission ceiling** that refuses, not a clamp that truncates (§5) |
| Destination base retry delay | `integration_connector(_audit).destination_retry_base_delay_seconds` |
| Destination max retry delay | `…destination_retry_max_delay_seconds`, clamped by `max_destination_retry_delay_seconds` |
| Destination retry ceiling | `…destination_retry_attempt_ceiling`, clamped by `max_destination_retry_attempts` |
| Destination retry horizon | `max_retry_horizon_seconds` |
| `rate_limited` delay floor | `destination_retry_after_seconds` evidence (3B-2), or **park** (§18) |
| Pre-dispatch recovery bound | `max_pre_dispatch_recoveries` |
| Pre-dispatch recovery delay | `recovery_delay_seconds` |
| Recovery scan frequency | **not persisted** — worker runtime configuration (§12) |
| Recovery batch size | `max_recovery_batch_size`, clamping the caller (§13) |
| Pending eligible-age ceiling / obligation lifetime | **not this feature's** — F062.2D-1A (§8) |

**Request execution budget** is newly named and newly located
(`request_execution_budget_seconds`) and its number is likewise **UNRESOLVED**.

> **Not one number is chosen. The platform policy table ships with zero rows,
> so 3C fails closed until an operator records a reviewed revision.**

---

## 34. Gaps carried forward

| 3-0 §31 gap | Status after this decision |
| --- | --- |
| **1. No policy configuration mechanism** | **RESOLVED architecturally** by §2's authority split and §28's schema. The numbers remain unresolved by design |
| 2. No F062 reason code for destination budget exhaustion | unchanged — parking records no terminal reason, so no F062.1 amendment is required. Still a gap for the operator surface |
| 3. Reason code for platform recovery exhaustion | remains **CLOSED**; no new reason code is introduced here |
| **4. No destination retry-floor persistence** | **RESOLVED architecturally** by §14–§17, implemented by 3B-2, with §18's parking as the approved fallback |
| 5. No `dead_lettered` replay authorization record | unchanged — automatic dead-lettering still must not ship |
| 6. No runtime telemetry emission | unchanged — F061.3D remains the gate before worker activation or grants |

New items this decision records rather than resolves:

1. No operator surface lists obligations unclaimable because their pinned
   revision is not policy-complete (§11, §26).
2. No operator surface exists for recording a platform policy revision; §22
   fixes the authority, not the mechanism. A separately reviewed
   operator-authoring boundary must own it before any policy row is written.
3. **No trusted operator attribution exists for the platform policy write
   surface**, which is why `actor` was removed (§7, §28.3). Verifiable
   attribution is deferred to that reviewed authoring path; `reason` and
   `correlation_id` are the interim record.
4. The `max_retry_horizon <= pending-age ceiling` cross-constraint is
   unenforceable until F062.2D-1A's ceiling is persisted (§8). The two
   clocks now have explicitly different anchors (§8.1), so the constraint
   relates a horizon measured from first dispatch to an age measured from
   enqueue — which is correct, and which makes the comparison a policy
   decision rather than an arithmetic identity.
5. The pre-policy obligation backlog needs operator disposition in any
   deployment that has accumulated one, now frozen as an activation gate
   (§26.1).

---

## Related

- [F062.2D-2C-3-0 — Worker execution policy and function signatures](F062-2D-2C-3-0-worker-execution-policy-function-signatures.md) — the decision this implements the mechanism for
- [F062.2D-2C-3A — Strict FIFO, retry eligibility and dispatch-marker hardening](F062-2D-2C-3A-strict-fifo-retry-dispatch-function-hardening.md) — the functions this policy will feed
- [F062.2D-2C-2 — Ordered-stream and retry-eligibility persistence](F062-2D-2C-2-ordered-stream-retry-eligibility-persistence.md) — the pinned-snapshot derivation pattern reused here
- [F062.2D-2C-1 — Lease, dispatch boundary and recovery-reason persistence](F062-2D-2C-1-lease-dispatch-recovery-reason-persistence.md) — the write-once evidence columns extended here
- [F062.2D-2C-0A — Worker execution contract amendment](F062-2D-2C-0A-worker-execution-contract-amendment.md) — the contract behind the two authority classes
- [F062.2B — Connector metadata persistence foundation](F062-2B-connector-metadata-persistence-foundation.md) — `configuration_revision`, the change categories and the append-only snapshot
- [F062.2D-1A — Pending age, expiry and dead-letter policy](F062-2D-1A-pending-age-dead-letter-policy.md) — the layered `min` precedence model and the age ceiling this defers to
- [F062.1 — Enterprise integration contracts foundation](F062-1-integration-contracts-foundation.md) — states, outcomes, categories and the transition graph
- [ADR-027 — Platform operator bootstrap and recovery](../architecture/decisions/ADR-027-platform-operator-bootstrap-recovery.md) — the operator authority the platform policy class depends on
