# F062.2D-1A — Pending age, expiry and dead-letter policy

Baseline `7e0992e5258d6ba286706f2b7d544bad86ba7f71` (authoritative `main`, carrying [F062.2D-1 worker identity decision](F062-2D-1-worker-identity-db-function-security-decision.md)).

> **NO CAPABILITY IS ENABLED BY THIS ASSESSMENT.** Policy decision only.

**Status: policy proposed for review.** No migration, no worker, no role, grant or function, no F062 implementation change, no new F062.1 state, no F061 edit, no ADR number. Migration count remains **51**. Nothing outside this document is modified.

This slice exists to resolve the maximum-pending-age blocker on F062.2D-2. Two framings are rejected at the outset, and the rest of the document is the argument for why:

- **"old = failed" is wrong.** An aged obligation is one nobody acted on. Nothing was attempted, nothing was refused, and the business fact behind it is usually still true.
- **"age threshold = automatic dead-letter" is wrong as a default.** It is the right outcome _once the semantics are proven_, and §7 proves them — but only after §2 and §3 establish which clock is being measured and whether the time even counts.

---

## 1. Baseline, read from source

| Fact                                                        | Value                                                                                                                                                                                         | Source                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Migration count                                             | **51**                                                                                                                                                                                        | `server/migrations/*.ts`                                     |
| F062.1 delivery states                                      | **nine**: `pending`, `dispatching`, `accepted`, `acknowledged`, `retrying`, `ambiguous`, `failed_permanent`, `dead_lettered`, `refused`                                                       | `delivery-contract.ts`                                       |
| Terminal states                                             | **four**: `acknowledged`, `failed_permanent`, `dead_lettered`, `refused`                                                                                                                      | same                                                         |
| **A `superseded`, `expired`, `stale` or `cancelled` state** | **does not exist** — zero occurrences                                                                                                                                                         | same                                                         |
| Failure taxonomy                                            | **ten** categories; **none** expresses age                                                                                                                                                    | `integration-envelope.ts`                                    |
| Outbox timestamps                                           | **exactly two**: `occurred_at` (caller-supplied) and `created_at` (`clock_timestamp()`)                                                                                                       | `20261021000000-add-integration-outbox.ts:91-92`             |
| Outbox dispatch columns                                     | **none** — `next_attempt_at`, `attempt_count`, `claimed_until` are all deferred to the dispatch slice                                                                                         | same, grep count 0                                           |
| Connector timestamps                                        | `created_at`, `updated_at`, `disabled_at`, `retired_at`                                                                                                                                       | `20261020000000-add-integration-connector-registry.ts:96-99` |
| `disabled_at` on re-enable                                  | **never cleared** — deliberately, so operational history survives                                                                                                                             | same, guard comment at line 318                              |
| Connector audit                                             | carries `lifecycle_state`, `prior_lifecycle_state`, `changed_at` and `record_revision` per accepted mutation, **append-only**                                                                 | same, lines 142-182                                          |
| Enqueueable today                                           | the reviewed `state_sync` / `current_state_projection` contract. **No immutable historical event type is enqueueable**, because both historical payload modes are refused by named constraint | `20261021000000`, F062.2A §2                                 |
| Maintenance or drain concept                                | **none exists** in `src/`                                                                                                                                                                     | grep                                                         |
| `pending_age_exceeded` in the F062.2A reason taxonomy       | **absent** — the taxonomy has no age code                                                                                                                                                     | F062.2A §8.1                                                 |

### The discovery that shapes §3

**The connector audit already contains a complete, append-only lifecycle timeline.** Every accepted connector mutation writes a row carrying `prior_lifecycle_state`, `lifecycle_state` and `changed_at`, so the intervals during which a connector was `configured`, `active`, `degraded`, `disabled` or `retired` are **fully reconstructable from existing evidence** — no new column, and no clock manipulation.

That matters because it makes "exclude time the connector was deliberately not dispatching" a computable property rather than an aspiration. §3 relies on it.

### What is _not_ reconstructable today

Secret-manager outage, worker downtime and planned maintenance leave **no durable record anywhere**. Time spent in those conditions cannot be excluded from an age computation after the fact, which constrains §13, §14 and §15 and is reported as a blocker rather than assumed away.

---

## 2. Which clock is being measured

Six candidate clocks exist conceptually; only two exist as columns today.

| Candidate                        | Available?                                                                                   | Assessment                                                                                                                                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `integration_outbox.created_at`  | **yes**, `clock_timestamp()`                                                                 | **The authoritative wall-clock origin.** Database-owned, immutable (the outbox guard refuses every UPDATE), and set at the moment Reqro accepted the obligation                                                                                            |
| `integration_outbox.occurred_at` | yes, **caller-supplied**                                                                     | **Must not drive durable policy.** It is the business-fact time, supplied by the application, so an age ceiling keyed to it is a ceiling a caller can move. It is the right clock for _business_ reporting and the wrong one for an authorization decision |
| First eligible-for-dispatch time | **no column**                                                                                | Derivable from `created_at` plus the connector's audit timeline (§3) rather than stored                                                                                                                                                                    |
| Time the connector became active | **no column**, but **derivable** from the connector audit's `changed_at` + `lifecycle_state` | §3                                                                                                                                                                                                                                                         |
| First delivery attempt time      | no — the attempt table does not exist                                                        | Would be `started_at` of attempt 1 once it does. Useful evidence, wrong clock: an obligation with zero attempts is exactly the case age policy must catch                                                                                                  |
| Most recent retry eligibility    | no — `next_attempt_at` is deferred                                                           | Belongs to the retry budget, not the age budget (§18)                                                                                                                                                                                                      |

### Recommended clock per scenario

> **Origin is always `created_at`. What varies is which intervals are excluded.**

**Eligible pending age** = `now() − created_at` **minus** the sum of intervals during which the obligation was _intentionally_ ineligible.

| Scenario                                          | Clock                                                                                           | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Newly created pending intent**               | `now() − created_at`, no exclusions                                                             | The simple case. The obligation was actionable from the moment it existed                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **B. Connector disabled at enqueue time**         | `created_at` origin, with the whole disabled interval **excluded**                              | F062.1 `mayEnqueue` deliberately permits enqueue while disabled, because disabling is an outage and not a discard. Expiring an obligation for time an administrator deliberately paused it would make "disable" a delayed data-loss operation                                                                                                                                                                                                                                                           |
| **C. Connector disabled after enqueue**           | same — exclude each disabled interval, reconstructed from the audit timeline                    | Identical reasoning; the intervals are simply later                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **D. Destination outage, connector `active`**     | `now() − created_at`, **no exclusion**                                                          | §12. Nobody paused this obligation. It was actionable throughout and simply was not delivered, which is exactly the condition an age ceiling exists to bound                                                                                                                                                                                                                                                                                                                                            |
| **E. Replay or manual requeue after dead-letter** | **a new bounded automatic-action window opens**, attributable to the authorizing action (§10.1) | The age clock does not resume from the original `created_at`, because an operator has just explicitly decided this obligation should be attempted again, and resuming an exhausted clock would re-expire it immediately. **`created_at` is never reset or rewritten** and prior eligible-age history is never erased; the original obligation lifetime and the current authorized window are separate quantities, and repeated requeue is cumulatively bounded so it cannot bypass the platform ceiling |

`occurred_at` is never used for an expiry decision. It remains the right value for "how late was this notification, in business terms", which is a reporting question.

---

## 3. Eligibility versus age

> **Pending means the record exists. Eligible means the worker is currently permitted to act on it. They are different, and only eligible time accrues toward automatic expiry.**

Causes of intentional ineligibility, and whether their time counts:

| Cause                                   | Counts toward expiry?                       | Why                                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connector `configured`, never activated | **No**                                      | Nobody has yet decided this destination should receive traffic. `mayDispatch` is false by design                                                                                    |
| Connector `disabled`                    | **No**                                      | An administrator deliberately paused it. Penalising an obligation for an operator's deliberate decision would turn `disable` into a silent discard, which F062.1 explicitly refuses |
| Connector `retired`                     | **No — and age is the wrong tool entirely** | §11: retirement requires explicit disposition, not expiry                                                                                                                           |
| Connector `degraded`                    | **Yes**                                     | `mayDispatch` is true. The worker is dispatching, just slowly; the obligation is actionable                                                                                         |
| Required secret unavailable             | **Yes, with a caveat**                      | §13                                                                                                                                                                                 |
| Deployment draining                     | **Yes, today**                              | §15 — no maintenance record exists to exclude it                                                                                                                                    |
| No worker running                       | **Yes, today**                              | §14 — and this is the uncomfortable case                                                                                                                                            |
| Operational hold                        | **No, once such a thing exists**            | §15 — it does not exist today                                                                                                                                                       |

**The governing principle:** _age expiry is a bound on how long Reqro will keep trying, not a punishment for how long an administrator chose not to try._ Time the platform or its administrators deliberately removed the obligation from service does not count; time it was genuinely actionable does.

**Mechanically**, the exclusion is computed from the connector audit timeline, which already records every lifecycle interval with `changed_at`. The two cases it cannot cover — worker downtime and secret-manager outage — are the subject of §13 and §14 and of blocker 2.

---

## 4. Policy ownership and precedence

Four layers, with a strict precedence rule.

| Layer                                | Owner                                         | Scope                                                                                                                                      |
| ------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Platform ceiling**                 | **Reqro platform, security and operations**   | An absolute upper bound. No configuration may exceed it, and no obligation may remain automatically actionable beyond it                   |
| **Connector policy**                 | **Deployment / client operations**            | Per-destination operational bound, within the platform ceiling                                                                             |
| **Integration-type policy**          | **Product / domain**                          | Some intents decay faster than others (§5, §6), within the above                                                                           |
| **Client, legal and records policy** | **Client, with legal and records management** | Whether an aged obligation may be _suppressed_ at all, how long its evidence is retained, and whether a late delivery is permissible (§27) |

### Precedence

> **The effective ceiling is the strictest of all layers that define one, and no layer may widen a stricter bound set above it.**

```text
effective = min( platformCeiling,
                 connectorPolicy    (if set),
                 integrationTypePolicy (if set) )
```

Three properties, each deliberate:

- **`min`, never last-write-wins.** A client operations team configuring a generous connector bound cannot escape the platform ceiling, and the platform tightening its ceiling cannot be overridden from below.
- **"Unset" inherits, it does not mean unlimited.** An unset connector or type policy falls through to the next layer, ultimately to the platform ceiling. There is no configuration path to an unbounded automatic-action window (§19, §20).
- **The legal layer gates the _outcome_, not the duration.** It does not set a number; it decides whether suppression is permissible at all and what evidence must survive. A legal constraint can therefore make an age policy _unenforceable by suppression_ while leaving the ceiling itself intact — in which case the outcome is operator review, which §7's recommendation already is.

---

## 5. Desired-state synchronisation staleness

The worked example: intent **A** says "make the destination reflect Reqro revision 7"; Reqro is now at revision 12.

### The finding that resolves it

**A `state_sync` intent carrying `current_state_projection` does not carry stale _data_, because its payload is projected at _attempt_ time rather than at enqueue time.**

**That is a claim about the payload, and it is not on its own a claim that repeated dispatch is safe.** An earlier draft of this section overstated it as "cannot become semantically stale", which elides the operation from the data: current data delivered through a non-convergent operation can still produce an unintended second effect. §5.1 states what must additionally be proven.

That is the F062 contract, and F062.2C enforces it structurally: `check ((contract_kind = 'state_sync') = (payload_mode = 'current_state_projection'))`. So dispatching A today does **not** send revision 7 — it sends current approved state, which is revision 12. A is not a stale message; it is a **redundant request to converge**, and converging is idempotent in effect.

Answering the question as posed:

| Option                                    | Verdict                                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Still dispatch?                           | **Yes — and it is correct to.** It projects current state and produces the intended outcome                                                                      |
| Be replaced or superseded?                | **Not required for correctness.** It would be an efficiency optimisation only                                                                                    |
| Require re-projection from current state? | **Already does, by contract.** There is nothing to change                                                                                                        |
| Become dead-lettered?                     | **No, not for staleness.** Only if it exceeds the age ceiling, and then for the age reason, not a staleness reason                                               |
| Require reconciliation?                   | **Only if it is never delivered.** A dead-lettered `state_sync` intent means the two systems are known to disagree, which is a divergence finding (F062 Part 12) |

### 5.1 Convergence is a separate property from projection currency

> **Automatic repeated dispatch of a `state_sync` intent is safe only when the
> integration operation itself is defined as convergent desired-state
> synchronisation. Current-state projection alone does not establish that.**

The distinction, concretely: "make the destination reflect current state" is
convergent — applying it twice leaves the same result. "Create a work item
describing current state" is **not** — applying it twice creates two work items,
however current each projection was. The payload mode governs _what data is
sent_; it says nothing about _what the destination does on receipt_.

Four conditions must all hold before a `state_sync` intent may be dispatched
automatically and repeatedly:

| Condition                                                                | Source of proof                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. `contract_kind` is the approved state-sync / current-state model**  | Structural already: F062.2C enforces `check ((contract_kind = 'state_sync') = (payload_mode = 'current_state_projection'))`                                                                                                                                 |
| **2. The connector declares `supportsCurrentStateSync`**                 | The **pinned** capability snapshot, never the connector's current row. `NO_CAPABILITIES` defaults it to `false`, so an undeclared connector fails this closed                                                                                               |
| **3. The specific operation's semantics are approved as convergent**     | A reviewed per-connector, per-operation determination. **Not inferable from F062.1**, and not inferable from the capability flag alone — a destination may declare state-sync support while implementing one operation convergently and another as a create |
| **4. Repeated application creates no unintended additional side effect** | The same reviewed determination, and the question that condition 3 is really asking                                                                                                                                                                         |

**Where a connector can only implement the operation as an action** — creating a
new external object, sending a notification, dispatching work — **then its
ordinary retry and idempotency rules govern, not this section's.** That means
F062.1's `resolveAmbiguity()` order, the `supportsIdempotencyKey` gate, and the
short-circuit to operator review for `irreversible` and `physical` side effects.
A `state_sync` label does not exempt an operation from the duplicate-prevention
machinery; it only describes the intent's payload contract.

**Consequence for this policy:** §5's conclusion that an aged `state_sync`
intent may still dispatch holds **only for operations proven convergent under
conditions 1-4**. For a `state_sync` intent whose operation is non-convergent,
age expiry is _more_ significant rather than less, because each late dispatch is
a fresh real-world action — and the recommended outcome moves toward §6's
treatment of a harmful late side effect: stop and ask.

Since no real connector exists, **no operation has yet been proven convergent**,
and condition 3 is therefore unsatisfied for every future connector until
reviewed. That is listed as a blocker in §30 rather than assumed.

### Supersession is not needed, and no state is invented

**F062.1 defines no `superseded` state, and this slice does not add one** — verified: zero occurrences of `superseded`, `expired`, `stale` or `cancelled` in `delivery-contract.ts`.

It is not needed because the redundancy is harmless and already bounded:

- the per-connector dedupe key already prevents an identical intent being enqueued twice;
- F062.2A §10's single-in-flight index serialises dispatch per aggregate, so a queue of redundant convergence requests is processed sequentially rather than concurrently;
- each one sends current state, so **they all produce the same destination outcome** and the last is indistinguishable from the only.

The cost is wasted destination capacity, which the age ceiling bounds as a side effect.

**If supersession is ever wanted as an optimisation, it needs a contract F062 does not have** — a way to record "not delivered because a newer intent expressed the same desire", which is neither a failure nor an acceptance. **That is reported as a blocker for any future optimisation slice, not solved here**, and nothing in this policy depends on it.

---

## 6. Immutable historical event lateness

**No immutable event type is enqueueable today** (§1), so this section is forward-looking by necessity — but the policy must not be written as though `state_sync` rules generalise, because they do not.

The asymmetry is fundamental:

|                         | `state_sync`                                  | immutable `event`                                                               |
| ----------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| What age affects        | **redundancy** — the payload refreshes itself | **nothing about truth** — the fact remains historically true                    |
| Is late delivery wrong? | No; it converges on current state             | **It depends on what the destination does with it**, which is the whole problem |
| May it be dropped?      | Harmlessly, in effect                         | **Potentially not at all** — a records obligation may require it                |

Three ways age can matter for an event, none of which `state_sync` has:

1. **Operationally late but still true.** A `service_request.closed` notification delivered a week late is accurate and probably still wanted. Age is a reporting concern, not grounds for suppression.
2. **Chronological delivery required.** A destination that rejects an event whose revision precedes the last it acknowledged makes a late event _undeliverable_ rather than merely late. That is a connector capability question (`supportsOrdering`), not an age question, and it will surface as `destination_rejected` rather than expiry.
3. **A late side effect would be harmful.** This is the serious case: an event that dispatches crew work, sends a resident notification, or triggers a billing action days after the fact can cause real harm by executing correctly but untimely. **For these, age expiry is a safety control, and the correct outcome is a stop plus human review — never silent suppression and never automatic late delivery.**

> **Therefore the policy is per `contract_kind`, and per `integration_type` where a type's side effect warrants it.** A single platform duration applied to both kinds would be wrong in one direction or the other.

Case 3 is also exactly where §27's legal questions bite hardest, and it is why the recommended outcome for events is _more_ conservative than for `state_sync`: stop and ask, rather than deliver or discard.

---

## 7. The age-expiry outcome

Evaluated strictly within F062.1's nine existing states.

| Option                                  | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A — `dead_lettered`**                 | **Recommended.** See below                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **B — remain `pending` but ineligible** | **Rejected as the terminal outcome, but adopted as a precursor.** An obligation that stays `pending` forever is indefinitely actionable, which §19 forbids; and "overdue but still pending" has no evidence trail and no authorization boundary. It _is_ however the correct state while an obligation is merely approaching its ceiling, surfaced by the oldest-pending-age metric                                                                    |
| **C — `failed_permanent`**              | **Rejected. The semantics do not match.** F062.1 reserves it for "retrying cannot succeed", which is a statement about the _destination_. An aged obligation has often had **zero attempts**, and the destination may be perfectly healthy. Recording it as a permanent failure would assert something about the destination that nobody observed — the same class of error as collapsing `ambiguous` into `failed`                                    |
| **D — `refused`**                       | **Rejected, narrowly.** It is tempting: F062.1 describes `refused` as a routing, version or projection failure that never reached a destination, and an aged intent also never reached one. But `refused` is reached _instead of_ dispatch at decision time, carries no attempt history, and — decisively — **F062.2A's transition table gives it no replay edge**. An aged obligation is precisely one a human may legitimately decide to send anyway |

### Why `dead_lettered`, precisely

**Because it is the only terminal state with a defined, authorized replay path.** F062.2A specifies `dead_lettered → pending` as the single exit, requiring audit evidence in the same transaction, enforced by a deferred constraint trigger. An aged obligation needs exactly that: automatic processing stops, the evidence survives, and a human decides whether it should still be delivered.

**What it means, stated so it cannot be misread:**

> `dead_lettered` with reason `pending_age_exceeded` means **"Reqro stopped trying automatically and a person must decide."**
>
> It does **not** mean the business event was invalid, that the destination refused it, that delivery failed, or that the obligation has been discarded. The fact remains true, the evidence remains intact, and the obligation remains re-dispatchable under authorization.

That distinction has to live in the reason code, the operator surface and the metric label class — not in prose — because `dead_lettered` is also the state reached by attempt-budget exhaustion, which _does_ indicate a destination problem. The two share a state and must not share a reading. Hence §8.

**Automatic dead-lettering is permitted only under an explicit, pre-approved policy** (§9). Absent an approved ceiling for a given connector and contract kind, the obligation stays `pending` and overdue — visible, not expired. **Fail-closed here means "do not expire", not "expire by default".**

---

## 8. Reason-code contract

F062.2A §8.1 defines a closed, Reqro-owned `reason_code` taxonomy. It currently has **no age code** (verified: zero occurrences of `pending_age`).

> **Recommended addition: `pending_age_exceeded`**, in the taxonomy's worker group alongside `lease_expired_uncertain` and `fenced_stale_completion`.

It must be distinguishable from every adjacent condition, which is the point of a closed taxonomy:

| Must not be confused with     | Existing code                                          | The distinction                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permanent destination refusal | `rejected_validation`, `rejected_unprocessable`        | The destination answered. Age expiry means it was never asked                                                                                                                                      |
| Authentication failure        | `credential_rejected`                                  | A credential problem is fixable and attributable; age is neither                                                                                                                                   |
| Ambiguous delivery            | `lease_expired_uncertain`                              | Ambiguity means something _may have happened_. Age expiry means nothing did (§17)                                                                                                                  |
| Manual disablement            | no code — it is a lifecycle state, not an outcome      | Disablement pauses the clock; it never expires an obligation (§3)                                                                                                                                  |
| Unsupported schema            | `version_unsupported`, `version_withdrawn`             | A contract mismatch, detected at dispatch                                                                                                                                                          |
| Attempt budget exhaustion     | a transient-failure code with `retry_eligible = false` | **Both reach `dead_lettered`, and this is the pair most at risk of conflation.** Budget exhaustion means the destination repeatedly could not take it; age exhaustion means nobody got round to it |

A second code may prove necessary once immutable events are enqueueable — something like `pending_age_exceeded_event_hold` for §6's case 3, where the outcome is a deliberate safety stop rather than a capacity bound. **Deferred, not invented**: it needs a real event type and its product contract first.

**No free text, and no raw vendor value**, consistent with F062.2A's rule that a vendor diagnostic token is unbounded in practice and meaningless without that vendor's documentation.

---

## 9. Dead-letter authorization boundary

**Automatic dead-lettering on age is permitted only where the policy is explicit and pre-approved** for that connector and contract kind. An unset policy produces no expiry (§7).

Subsequent actions, mapped to Reqro's trusted operator architecture:

| Action                                                           | Authorization                                                                                | Two-person / PIM                                                                                                                                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inspect dead-letter evidence**                                 | Staff or operator read, Organization-scoped                                                  | No — reading changes nothing                                                                                                                                            |
| **Approve retry / requeue**                                      | Operator identity, reason, correlation; dry-run → confirm; audit row in the same transaction | **Yes.** Re-dispatching an aged obligation sends something to a live external system that deliberately stopped being sent, and §6 case 3 makes that potentially harmful |
| **Resolve without retry** (accept that it will not be delivered) | Same, plus the reason recorded                                                               | **Yes.** It is a decision to leave two systems knowingly divergent, and it is the action a records obligation may forbid                                                |
| **Suppress future action** for a class of obligations            | Same, plus policy change under change control                                                | **Yes**, and additionally a **policy** change, not a per-row one                                                                                                        |
| **Change an age policy**                                         | Change control, and it advances the connector's configuration revision (§21)                 | **Yes** for tightening, because §22 shows tightening can expire a backlog                                                                                               |

The precedent to reuse is concrete and already in the repository: `tenant_domain_operator_approval` implements independent approval with `expected_revision`, a single-use partial unique index on the approval, and a deferred constraint trigger that aborts a change lacking evidence. **PIM evidence** follows F060.3C-2e-2B — `assignmentType = activated` **and** a non-null `activatedUsing`.

**No operator API is implemented here.**

---

## 10. Retry after age expiry

The non-negotiables, all consistent with F062.2A:

- **No silent automatic resurrection.** There is no `dead_lettered → dispatching` edge at all.
- **No timer may move it back to `pending`.** The only exit is an authorized transition carrying audit evidence.
- **Retry re-checks connector semantics at the moment of retry** — current lifecycle state, and a freshly resolved pinned revision for the new dispatch.
- **Ambiguity and history rules still apply.** A requeued obligation that becomes ambiguous resolves through §17's order, not through age.

### Same intent identity, or a new one?

> **Recommendation: the same `integration_id`, with a new attempt sequence and a new eligible window.**

This is not an obvious call, so the reasoning:

| Consideration               | Same identity                                                                                                                                                                                                                                                                                             | New intent                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Destination idempotency** | **Decisive in favour.** A destination honouring idempotency keys collapses the replay against the original, which is exactly the protection wanted when re-sending something that may have been partially delivered. A new `integration_id` would present as a _different_ obligation and could duplicate | A new key defeats the destination's own duplicate protection                                                                |
| **Audit continuity**        | One obligation, one identity, a complete attempt history across expiry and replay                                                                                                                                                                                                                         | Two rows for one obligation, with the relationship recorded only by convention                                              |
| **Dedupe constraint**       | `unique(organization_id, integration_connector_id, integration_id)` already holds; reusing the identity means re-dispatch cannot accidentally create a second row                                                                                                                                         | A new intent would satisfy the constraint and sit alongside the old one, which is how one obligation becomes two deliveries |
| **Operational clarity**     | "This obligation was expired, reviewed and re-authorized"                                                                                                                                                                                                                                                 | "There is an old dead one and a new live one" — an operator must infer the link                                             |

So: reuse the identity, open a **new automatic-action window** (§10.1), preserve `created_at` as evidence of total lifetime, and append attempts rather than restarting their numbering. **F062's structural idempotency is the deciding factor** — it exists precisely so a duplicate arrival is harmless, and a new identity would discard it at the one moment it matters most.

### 10.1 The requeue age epoch, stated precisely

Two different quantities must stay separate, and conflating them is how a
requeue would quietly become either impossible or unbounded:

| Quantity                                       | Meaning                                                                       | Behaviour on requeue                                                                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Original obligation lifetime**               | `now() − created_at`. How long this obligation has existed, in total          | **Never reset, never rewritten.** `created_at` is immutable — the outbox guard refuses every UPDATE — and it remains the answer to "how late is this, in total?" |
| **Current authorized automatic-action window** | The bounded period during which the worker may act _under this authorization_ | **A new one opens**, attributable to the requeue that created it                                                                                                 |

> **An authorized requeue never resets or rewrites `created_at`, and never erases prior eligible-age history.** It opens a _new_ bounded window alongside the existing record, rather than editing the obligation's past.

Everything that must survive a requeue:

- **`created_at`** — unchanged and immutable;
- **prior delivery evidence** — every attempt, with its outcome, reason and generation;
- **the dead-letter record itself** — including the `pending_age_exceeded` reason that caused it, so the fact that it once expired is permanent;
- **the original `integration_id`** — §10's conclusion, which is also what lets the destination collapse the replay;
- **the requeue authorization evidence** — who authorized it, when, with what reason and correlation.

**The new window must be durably and auditably attributable to the authorizing action**, not implied by a state change. An obligation that is `pending` again must be able to answer "under whose authority, and until when?" from evidence — otherwise a requeued obligation is indistinguishable from one that never expired, and the audit trail for the most consequential operator action in this design would be a state transition with no explanation attached.

**Repeated requeue must not become an unlimited bypass of the platform safety ceiling.** This is the loophole the rule exists to close: if each requeue simply granted a fresh window with no cumulative bound, an operator could keep an obligation automatically executable forever one authorization at a time, defeating §19 entirely. At least one cumulative bound is therefore required, and the options — a maximum number of requeues, a cumulative automatic-action budget across all windows, or an absolute wall-clock horizon from `created_at` beyond which no window may be opened — are a **policy decision for the platform ceiling's owner**, listed in §30.

**No schema is designed here.** Whether the window and its authorization are columns on the outbox row, rows in an authorization table, or a projection over the audit trail is for the implementing slice. What this policy fixes is the **semantic requirement**: original lifetime is immutable and separate from the current window; every window is attributable; and windows are cumulatively bounded.

---

## 11. Connector lifecycle interaction

| State        | Dispatch                          | Age clock                                 | Disposition                                                                                                                                                                                                                                                                                   |
| ------------ | --------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configured` | **no** — `mayDispatch` false      | **paused**                                | Obligations accumulate. Activation is an explicit audited action                                                                                                                                                                                                                              |
| `active`     | yes                               | **accruing**                              | Normal policy                                                                                                                                                                                                                                                                                 |
| `degraded`   | yes                               | **accruing**                              | The worker is dispatching, so the obligation is actionable. Age continues — stated explicitly because the opposite assumption is tempting and would let a connector sit `degraded` indefinitely with no bound                                                                                 |
| `disabled`   | **no**                            | **paused**                                | **This is the deliberate answer, not an operator judgement call.** An administrator paused it; expiring obligations for that interval would make `disable` a delayed discard, which F062.1's `mayEnqueue` explicitly refuses. The paused interval is reconstructable from the connector audit |
| `retired`    | **no**, and `mayEnqueue` is false | **stopped — age is the wrong instrument** | Pending obligations require **explicit disposition** by an operator: requeue to a _newly configured_ connector as new intents, or resolve-without-retry per §9. Age expiry would quietly convert a decommissioning decision into a bulk dead-letter event                                     |

> **No pending obligation is ever automatically retargeted to another connector, in any state.** There is no default connector, no catch-all and no substitution on miss; F062.2C made `integration_connector_id` `not null` precisely so an obligation cannot be parked or re-pointed. A shared fallback is how one tenant's data reaches another.

Retirement therefore leaves obligations that need a human decision — which is the honest consequence of a terminal lifecycle state, and better than inventing an automatic path.

---

## 12. Destination outage

> **Age accrues during a genuine destination outage. This is the central case the ceiling exists for.**

The distinction from §11's `disabled`:

|                   | Connector `active`, destination down for days | Connector deliberately `disabled` |
| ----------------- | --------------------------------------------- | --------------------------------- |
| Who paused it     | **nobody**                                    | an administrator                  |
| Is it actionable? | **yes** — the worker is trying and failing    | no                                |
| Age accrues?      | **yes**                                       | no                                |
| What it means     | the obligation is genuinely overdue           | the obligation is parked          |

Behaviour at the threshold: the obligation becomes `dead_lettered` with `pending_age_exceeded`, under an approved policy. The circuit breaker will already be open per `(organization, connector)`, so the operator signal exists before expiry — expiry is the backstop, not the first notification.

**Retry-count exhaustion and age exhaustion are independent limits**, and conflating them is a real risk because both end in `dead_lettered`:

- a destination down for a week may produce **few** attempts (backoff spreads them) and still exceed the age ceiling;
- a destination failing fast may exhaust a **retry budget** in minutes with the age clock barely started;
- an obligation behind a `disabled` connector has **zero** attempts and a paused clock.

They answer different questions — "has the destination had enough chances?" versus "is this still worth sending?" — and §18 keeps their configuration separate.

---

## 13. Secret-manager outage

F062.2D-0 classified a temporary secret-manager outage as **infrastructure** failure, not destination failure. Two consequences follow, and they point in different directions:

| Question                                        | Answer                                                                                                                                                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the time count toward pending age?         | **Yes, today — unavoidably.** No durable record of a secret-manager outage exists, so the interval cannot be excluded after the fact. It is Reqro-side unavailability counting against the obligation, which is not ideal and is honest |
| Does it trip the destination's circuit breaker? | **No.** A manager outage is not evidence the destination is unhealthy. Tripping the breaker would suppress dispatch to a healthy destination and misattribute the fault                                                                 |

The reason codes must keep this legible: `credential_unavailable` (transient, infrastructure) is distinct from `credential_rejected` (permanent, configuration), and neither is a destination refusal. **The distinction must survive into the operator surface**, so an operator reading a dead-letter can tell "we could not fetch our own credential for three days" from "the destination rejected us".

If the exclusion becomes operationally important, it requires a durable record of platform-unavailability intervals — the same mechanism §14 and §15 need, and the same blocker.

---

## 14. Worker downtime

The uncomfortable case, stated plainly: **if no worker runs for hours, obligations age for a reason that is entirely Reqro's fault and not the destination's.**

| Question                                                     | Answer                                                                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| May age expiry occur during platform-caused worker downtime? | **Yes, today** — there is no record to exclude the interval. But see the mitigation, which is not optional       |
| Should it?                                                   | **Arguably not**, and the honest position is that the current answer is a limitation rather than a design choice |

**Required mitigation, and it is a gate rather than a nicety:** the oldest-pending-age metric and worker liveness must be monitored **together**, so a growing backlog with no live worker is unmistakably a platform incident. Expiring obligations in bulk because the platform was down, and surfacing that as a destination problem, would be the worst possible failure of this design — it would blame a City's system for Reqro's outage.

Three safeguards follow:

1. **Operational alerts must distinguish platform-caused backlog from destination-caused backlog.** Oldest pending age alone cannot: it rises identically in both cases. Pairing it with worker liveness (§25, and an F061 blocker) is what separates them.
2. **The reason code must not imply destination fault.** `pending_age_exceeded` is deliberately neutral and says nothing about the destination — which is why §8 keeps it distinct from every refusal code.
3. **Bulk expiry deserves a circuit breaker of its own.** An age-expiry transition rate far above normal is itself evidence of a platform problem, and the implementation should surface it rather than quietly process thousands of rows. **Recommended, and listed as an implementation requirement in §24.**

---

## 15. Deployment drain and maintenance

| Question                                        | Answer                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| Should planned maintenance pause the age clock? | **Yes, in principle** — it is deliberate ineligibility, exactly like `disabled` (§3) |
| Can it today?                                   | **No.** No maintenance or drain concept exists in `src/`, verified by inspection     |

> **Recommendation: an explicit, durable maintenance record — never implicit clock manipulation.**

The tempting shortcut is to adjust timestamps or subtract a configured "expected downtime". Both are wrong for the same reason: they make the age computation depend on a value nobody can audit, and they corrupt `created_at`, which the outbox guard deliberately makes immutable. An explicit record — a durable, operator-attributed maintenance interval per deployment — keeps the computation reproducible and the evidence intact.

Until it exists, drain and maintenance time **counts**, which is the same limitation as §13 and §14 and part of the same blocker.

**Not implemented here**, and it is a candidate for its own small slice rather than a rider on the dispatch slice.

---

## 16. Ordering interaction

Intent **A** is old and stuck; intent **B** is newer, same ordered aggregate stream. A exceeds the age ceiling and becomes `dead_lettered`. May B proceed?

> **Recommendation: yes for `state_sync`, and it requires an explicit decision for immutable events.**

The mechanism already permits it: F062.2A §10's single-in-flight index covers only `dispatching` and `ambiguous`. `dead_lettered` is **not** in the predicate, so A's expiry **releases the in-flight slot** and B becomes claimable without any further rule. That is exactly F062 Part 4.4's poison isolation — one obligation that cannot be delivered must not block its aggregate's stream indefinitely.

For the two contract kinds:

| Kind                  | May B proceed?                                                         | Why                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`state_sync`**      | **Yes, and it should**                                                 | B projects current state. It does not depend on A having been delivered, and it will in fact _repair_ the divergence A left — which makes letting B proceed strictly better than blocking it                                                                                                                                                                                        |
| **Immutable `event`** | **Only where the destination does not require chronological delivery** | If a destination rejects an event whose revision precedes the last it acknowledged, delivering B after A was dropped produces a permanent gap in that destination's history. Where `supportsOrdering` is `per_aggregate` **and** the destination's contract requires strict chronology, **B must not proceed automatically: A's disposition must be resolved by an operator first** |

Stated as the rule: **strict ordering is a connector capability, not an age policy.** Where it is declared and the destination's documented contract requires it, an expired predecessor becomes an operator gate on its successors. Where it is not, poison isolation applies and the stream continues. The implementation must read this from the pinned capability snapshot rather than assuming either answer — and since no immutable event is enqueueable today, the conservative branch is unreachable for now.

---

## 17. Ambiguous interaction

> **Maximum pending age must never automatically convert `ambiguous` → `dead_lettered`. Age cannot erase uncertainty.**

`ambiguous` means an external side effect **may already have occurred**. An obligation sitting in that state for a long time is not neglected work — it is _unresolved knowledge_, and time does not resolve it. Automatically dead-lettering it on age would convert "we do not know whether a crew was dispatched" into "we have stopped asking", with the evidence still saying the opposite.

What must be preserved regardless of age:

- **idempotency evidence** — a keyed retry remains the first resolution where the pinned capabilities permit it;
- **read-after-write** — reading back remains available and becomes _more_ valuable as time passes, not less;
- **reconciliation** — an old ambiguity is exactly what a divergence scan is for;
- **operator review** — the terminal resolution, and the only one for an `irreversible` or `physical` side effect.

**An aged `ambiguous` obligation therefore escalates rather than expires.** It is surfaced as overdue-unresolved — a distinct operational signal from overdue-undelivered — and its transition out of `ambiguous` requires either evidence or an authorized human decision, both of which already carry audit requirements (§9).

Separately: the age clock for an `ambiguous` obligation should stop at the moment it entered that state, because from then on the question is no longer "will we deliver this?" but "what happened?". Mixing the two under one counter would make the oldest-pending-age metric unreadable.

---

## 18. Retry budget versus age budget

Three independent policies, configured separately, answering different questions:

| Policy                     | Question                                | Unit                                   |
| -------------------------- | --------------------------------------- | -------------------------------------- |
| **Retry attempt ceiling**  | Has the destination had enough chances? | count                                  |
| **Retry timing / backoff** | How often may we ask?                   | interval, exponential with full jitter |
| **Maximum pending age**    | Is this still worth sending at all?     | elapsed eligible time                  |

> **None may be encoded as a proxy for another.**

The three scenarios that prove they are orthogonal, all realistic:

- **Few retries over a long outage.** Backoff with a capped maximum interval produces a handful of attempts across a multi-day outage. The attempt budget is nowhere near exhausted; the age ceiling is the only thing that bounds it.
- **Many quick retries.** A destination failing fast exhausts an attempt budget in minutes. The age clock has barely moved, and treating age as the limit would never fire.
- **Zero attempts while disabled.** Both budgets are untouched and the age clock is paused (§3). All three policies correctly say "do nothing".

A fourth combination is worth naming because it is the one that causes incidents: **attempt budget exhausted while age remains** — the obligation dead-letters for a _destination_ reason, and its reason code must say so rather than attributing it to age. §8 keeps those codes distinct precisely for this.

---

## 19. Platform ceiling

> **Yes. Reqro needs an absolute hard ceiling, and the implementation must reject an unbounded or infinite automatic-action window.**

The argument is not about tidiness. An obligation that remains automatically executable indefinitely is a **latent external side effect of unbounded age** — a work order that could dispatch a crew, or a notification that could reach a resident, months after the fact, with nobody having decided that was acceptable. §6 case 3 is the harm; the ceiling is the bound.

| Property             | Decision                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Value                | **Provisional and unresolved.** No number is proposed                                                                                                      |
| Owner                | **Reqro platform, security and operations** (§4)                                                                                                           |
| Configuration bounds | Every configurable layer is bounded above by this ceiling and below by a sane floor; `min` precedence makes that structural (§4)                           |
| Unbounded permitted? | **No.** Not as a configuration value, not as a null meaning "forever", and not as an absent policy. Absent policy inherits (§20); it never means unlimited |
| Per contract kind    | **Yes** — §6 shows one duration cannot serve both kinds                                                                                                    |

**The implementation must refuse to start, or refuse to apply a policy, rather than silently defaulting to unlimited.** Fail-closed here means a missing ceiling is a configuration error, not an infinite window.

---

## 20. Configuration model

Conceptual only. **No environment variable and no database column is added here.**

| Input                              | Owner             | Scope                                  |
| ---------------------------------- | ----------------- | -------------------------------------- |
| `platformMaximumPendingAge`        | platform          | absolute ceiling, per contract kind    |
| `connectorMaximumPendingAge`       | client operations | per connector, within the ceiling      |
| `integrationTypeMaximumPendingAge` | product           | per integration type, within the above |

| Property           | Rule                                                                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Precedence**     | effective = `min` of every layer that defines a value (§4). Never last-write-wins                                                                                                                                      |
| **"Unset"**        | **inherits from the next layer up**, ultimately the platform ceiling. Never unlimited, never zero                                                                                                                      |
| **Unlimited**      | **prohibited at every layer** (§19)                                                                                                                                                                                    |
| **Minimum bound**  | A floor, so a policy cannot be set so short that obligations expire before a realistic retry sequence completes — which would make the age budget silently override the retry budget, the exact conflation §18 forbids |
| **Maximum bound**  | The platform ceiling, enforced on write rather than on read, so an out-of-range configuration is refused at the point someone sets it                                                                                  |
| **Where it lives** | Part of the connector's **semantic** configuration (§21), so it is carried by the per-revision audit snapshot                                                                                                          |
| **Validation**     | Bounded interval type, range-checked; no free-text duration parsing                                                                                                                                                    |

---

## 21. Revision and audit

> **Recommendation: an age policy change is semantic and advances `configuration_revision`; an outbox intent's age policy is pinned to the revision it already pins.**

The reasoning, since F062.2B drew the semantic line carefully:

F062.2B's rule is that anything changing _how a destination behaves_ is semantic, and a credential rotation is not. An age policy does not change the destination's behaviour — so a narrow reading says `record_revision` only. **But the pinned revision's purpose is broader than destination behaviour: it is the semantics an intent's processing is interpreted against.** F062.2D-0 §12 already extended it to destination, account namespace and authentication mode for the same reason. An age ceiling determines the obligation's lifetime, which is as much a part of how it will be processed as whether a retry is safe.

Pinning it gives the property that matters most here:

> **A later administrator changing an age policy does not silently reinterpret obligations that already exist.**

### Replay does not substitute current policy for pinned policy

One corollary is worth stating because the convenient implementation does the
wrong thing: **an authorized replay or requeue does not silently swap the
obligation's pinned historical policy for the connector's current one.**

A requeued obligation still pins the `configuration_revision` it was enqueued
against, so by default its age policy remains the policy that governed it then.
The tempting shortcut — "it is being retried now, so use today's settings" —
would mean every requeue quietly re-based an old obligation onto a policy nobody
reviewed in that context, and would make an operator's narrow decision to retry
one obligation also a decision to change the rules it is judged by.

The only way the policy changes is if **the authorizing action expressly creates
a new policy epoch**: the operator, with the authority of §9, states that this
requeue adopts the current policy, and that choice is recorded as part of the
same authorization evidence §10.1 requires. Expressly, auditably, and per
action — never as a side effect of the state transition.

The platform ceiling is the one exception and it is not a substitution: it
applies as a stricter safety bound to everything, old rows included (§22),
because it is a safety limit rather than a tuning value.

Without pinning, tightening a ceiling retroactively re-reads every pending row against a rule that did not exist when it was accepted — §22's mass-expiry hazard. With pinning, the obligation keeps the deal it was made under, and the change applies to what comes next.

| Aspect                            | Decision                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Changing a connector's age policy | **advances `configuration_revision`** (and therefore `record_revision` too, per F062.2B's invariant)                                |
| Where the value lives             | the revision-advancing connector audit snapshot — the same extension F062.2D-0 blocker 6 already requires for destination semantics |
| What an intent pins               | the policy as of its pinned `configuration_revision`                                                                                |
| Reproducibility                   | an investigator can answer "what ceiling governed this obligation?" from evidence, not from current configuration                   |

---

## 22. Existing pending rows when policy changes

| Option                                       | Assessment                                                                                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — pinned policy only**                   | Safe against retroactive expiry, but lets a dangerously generous old pin persist indefinitely, defeating §19                                                          |
| **B — current policy**                       | **Rejected.** Tightening a ceiling would expire a backlog immediately and in bulk, with no review — the precise outcome §14 warns is the worst failure of this design |
| **C — stricter of pinned and current**       | **Recommended, with one refinement**                                                                                                                                  |
| **D — operator-controlled reclassification** | **Adopted as the companion to C**                                                                                                                                     |

> **Recommendation: the effective ceiling for an existing row is the stricter of its pinned policy and the _current platform ceiling_ — not the current connector or type policy.**

That refinement is the whole decision. It separates two different intents:

- **The platform ceiling is a safety bound**, owned by platform security, and must apply to everything including old rows — otherwise §19's "nothing indefinitely actionable" is false for exactly the rows most likely to be old.
- **Connector and type policies are operational tuning**, owned lower down, and must **not** apply retroactively — otherwise routine tuning becomes a bulk dead-letter event.

And because even a platform-ceiling tightening could expire a backlog, **D applies on top**: a policy change that _would_ immediately expire existing rows must surface them for explicit review rather than processing them silently. Concretely — an implementation requirement, not a wish:

- the age-expiry transition must be **rate-bounded**, so a policy change cannot dead-letter thousands of rows in one pass;
- an expiry rate far above baseline must raise an operational signal (§14 safeguard 3);
- tightening a ceiling should be preceded by a **dry run** reporting how many existing obligations it would expire — reusing the operator platform's established dry-run → confirm discipline.

---

## 23. Time source

> **The database owns durable age determination. `clock_timestamp()`, consistent with repository convention.**

| Decision                                                                   | Reason                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Origin is `created_at`, set by `clock_timestamp()`                         | Already the case, and the outbox guard makes it immutable. 26 of 51 migrations use `clock_timestamp()`; it is the established convention                                                                                              |
| Comparison happens **in the database**                                     | The age determination is a predicate on the transition statement, so the comparison and the mutation are one statement. A worker computing age and then asking for a transition introduces a check-then-act window and a second clock |
| **No caller-supplied wall-clock value** is accepted for an expiry decision | A caller-supplied "now" is a caller-supplied authorization. F062.2D-1 §7 already establishes that server-owned timestamps are generated, never accepted                                                                               |
| `clock_timestamp()` not `now()`                                            | `now()` is transaction-start time; for a long transaction it understates elapsed time, and it collapses distinct events in one transaction                                                                                            |

**Clock skew:** because both the origin and the comparison are database-side, the age computation involves **one clock** and skew does not enter it. The worker's clock is used only for scheduling _when to ask_ — which polls to run, when a lease looks stale locally — and a skewed worker therefore asks at the wrong moment but can never cause a wrong expiry. That is a deliberate division: **the worker decides when to look; the database decides what is true.**

---

## 24. State-transition enforcement

> **The age transition must be enforced in the database state machine, not only in worker application code.**

The reason is the same one that put the delivery state machine in the database in the first place (F062.2D-1 §3): a transition implemented only in application code is a rule a future call site can forget, and an age expiry is a _terminal_ transition on an obligation Reqro accepted.

Future tests the dispatch slice must include:

| Assertion                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Threshold not reached → transition refused**, with the row left `pending`                                                              |
| **Threshold reached under an approved, pinned policy → transition permitted**                                                            |
| **No approved policy → transition refused** (fail-closed means do not expire)                                                            |
| **Wrong source state → refused** for every state other than the permitted sources                                                        |
| **`ambiguous` is never age-transitioned**, asserted by name (§17)                                                                        |
| **Terminal states unchanged** — `acknowledged`, `failed_permanent`, `dead_lettered`, `refused` are not age-transitionable                |
| **Paused intervals are excluded** — an obligation behind a connector that was `disabled` for longer than the ceiling does **not** expire |
| **`degraded` time accrues** — the complementary case                                                                                     |
| Policy version matches the intent's pinned `configuration_revision`, and a mismatch refuses                                              |
| Attempt and outbox evidence remain consistent — the transition writes its reason and leaves prior attempts intact                        |
| **The transition is rate-bounded** (§22) — a single pass cannot expire an unbounded number of rows                                       |
| The reason code is `pending_age_exceeded` and is distinguishable from budget exhaustion in the stored evidence                           |
| Ordering: an expired predecessor **releases** the in-flight slot for `state_sync` (§16)                                                  |

**No SQL is implemented now**, and no state is added: every assertion above is over F062.1's existing nine.

---

## 25. Observability

F061 remains the authority. The worker needs, in bounded form:

| Concept                                   | F061 status                                                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Pending count                             | **missing** — F061-owned                                                                                                          |
| **Oldest pending age**                    | **missing, and a production release gate**                                                                                        |
| Age-policy transition count               | **missing**                                                                                                                       |
| Dead-letter count by bounded reason class | `integration_dead_letter_count` **exists**; the reason-class dimension needs confirming against F061's closed `reason` vocabulary |

**Never as metric labels:** `organizationId`, `connectorId`, hostname and outbox ID — the first three are F061 `restrictedAttributes` with `metricLabels: 'forbidden'`, and an outbox ID is an unbounded per-row identifier. Also excluded for the same reasons: `correlationId`, `traceId`, `spanId`, `externalRecordId`.

Two observations specific to this policy:

- **Oldest pending age must exclude paused obligations**, or it reports a connector an administrator deliberately disabled as a stalled integration — and the metric's whole value is that it distinguishes stalled from idle.
- **Age-expiry count and attempt-budget-exhaustion count must be separable**, because they are different incidents with different owners (§18). If both land in `integration_dead_letter_count` with no distinguishing bounded dimension, an operator cannot tell a platform backlog from a destination failure.

**F061 is not edited here.** These remain F061-owned prerequisites, with oldest pending age the gate for any worker reaching a real destination.

---

## 26. Resident and customer experience

> **Default, and recommended: internal integration delivery state is _not_ resident-facing case state. "Dead-lettered" is never shown to a resident.**

This follows existing contract rather than being a new position: F062.1's `residentVisibleDeliveryStates` is **empty**, and F062 Part 8 states residents see Reqro's own request status, which Reqro owns and can always answer.

The reasoning holds specifically for age expiry: a resident's request _was_ received, _is_ recorded, and is being handled by the City. That an external system has not yet been told is a Reqro-and-City operational matter the resident can do nothing about, and surfacing it would expose vendor complexity — which AGENTS.md forbids — while alarming someone about something outside their control.

| Audience     | Treatment                                                                                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Resident** | **Nothing.** No status change, no notification, no mention                                                                                                                          |
| **Staff**    | **Yes — an operational warning is warranted.** Staff may reasonably need to know that a request's external counterpart was never created, because it changes how they work the case |
| **Operator** | Full evidence and the §9 actions                                                                                                                                                    |

Staff warning design is deliberately left open: it must be an _operational_ indicator, not a case-status change, and the wording must avoid vendor detail. **No UI is implemented**, and whether product wants it at all is a product decision.

**Only an explicit product mapping may ever change this**, and such a mapping would need its own review — it would mean a resident's view of their request depends on a third-party system's availability.

---

## 27. Legal and records questions

Each needs client, legal or records-management approval. **No assumption is made here.**

1. **May a late external action be suppressed at all?** If a City is obliged to record a service request in its system of record, choosing not to deliver it may not be Reqro's decision to make.
2. **How long must dead-letter evidence be retained?** It is a record of what the City was and was not told. F062.2A §17 already flags this as the longest-lived retention class and unresolved.
3. **Who may resolve an obligation without retrying?** This is a decision to leave two systems knowingly divergent, and it may require a named authority rather than any operator.
4. **May old obligations be reprocessed in bulk?** Replaying a month of backlog could produce a flood of late notifications or work orders with real-world consequences.
5. **Immutable event delivery after a statutory or business deadline.** §6 case 3's harm case. There may be deadlines after which delivery is _worse_ than non-delivery, and that is a legal determination.
6. **Does an aged obligation need affirmative disclosure?** If a City's system never learned of a request, somebody may be obliged to say so.

Items 1 and 5 are the ones that could change this policy's recommended outcome; the rest shape retention and authorization.

---

## 28. Recommended baseline policy

| Dimension                          | Policy                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Clock origin**                   | `integration_outbox.created_at`, database-owned and immutable. Never `occurred_at`                                                                                                                                                                                                                                 |
| **Eligible pending time**          | wall-clock since `created_at`, **minus** intentionally ineligible intervals                                                                                                                                                                                                                                        |
| **Paused / ineligible time**       | **excluded**: connector `configured`, `disabled` or `retired`; and future maintenance holds. Reconstructed from the connector audit timeline                                                                                                                                                                       |
| **Accruing time**                  | connector `active` or `degraded`, including during destination outage                                                                                                                                                                                                                                              |
| **Destination outage**             | **accrues.** Nobody paused it; this is the case the ceiling exists for                                                                                                                                                                                                                                             |
| **Administrative disablement**     | **excluded.** An operator's deliberate pause must not become a delayed discard                                                                                                                                                                                                                                     |
| **Worker outage**                  | **accrues today** — a stated limitation, mitigated by paired liveness alerting and a rate-bounded transition, not by clock manipulation                                                                                                                                                                            |
| **Secret-manager outage**          | **accrues today**; never trips the destination circuit breaker; reason codes keep it attributable                                                                                                                                                                                                                  |
| **`state_sync` staleness**         | **The projected data is never stale** — it is computed at attempt time. But repeated automatic dispatch is safe **only for operations proven convergent** under §5.1's four conditions; a non-convergent operation falls back to ordinary retry and idempotency rules. **No `superseded` state invented**          |
| **Immutable event lateness**       | **policy varies by `contract_kind` and may vary by `integration_type`.** The harm case is a correct-but-untimely side effect, where the outcome is a safety stop and human review — never silent suppression, never automatic late delivery                                                                        |
| **`ambiguous`**                    | **never age-expired.** Age cannot erase uncertainty. The clock stops on entry; the obligation escalates as overdue-unresolved                                                                                                                                                                                      |
| **Outcome at the ceiling**         | `dead_lettered` with reason `pending_age_exceeded`, meaning _automatic delivery ceased, review required_ — not _the event was invalid_                                                                                                                                                                             |
| **Absent approved policy**         | **no expiry.** The obligation stays `pending` and overdue. Fail-closed is "do not expire"                                                                                                                                                                                                                          |
| **Existing rows on policy change** | stricter of the pinned policy and the **current platform ceiling**; connector and type changes are not retroactive; rate-bounded with a dry run before tightening                                                                                                                                                  |
| **Policy pinning**                 | semantic — advances `configuration_revision`, carried in the per-revision audit snapshot                                                                                                                                                                                                                           |
| **Retry after expiry**             | same `integration_id`; **`created_at` never reset**; a new bounded automatic-action window attributable to the authorization; prior evidence preserved; cumulatively bounded so repeated requeue cannot bypass the platform ceiling; pinned policy retained unless the authorization expressly creates a new epoch |

**Every duration in this policy is provisional and unresolved.** No number is proposed for the platform ceiling, any connector or type bound, the floor, or the rate limit. They require the owners of §4 and, for §27 items 1 and 5, legal input.

---

## 29. The F062.2D-2 gate

**The policy semantics are now decided. One state-machine input remains unresolved, and it is a number rather than a semantic.**

| Input                                       | Status                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Which clock, and what accrues               | **Decided** (§2, §3, §28)                                                                                                   |
| The outcome state                           | **Decided** — `dead_lettered`, within F062.1's existing nine (§7)                                                           |
| The reason code                             | **Decided** — `pending_age_exceeded`, extending F062.2A §8.1 (§8)                                                           |
| `ambiguous` exclusion                       | **Decided** (§17)                                                                                                           |
| Ordering release                            | **Decided** for convergent `state_sync`; the strict-ordering branch is unreachable while no event type is enqueueable (§16) |
| Pinning model                               | **Decided** — semantic, in the audit snapshot (§21)                                                                         |
| Existing-row behaviour                      | **Decided** (§22)                                                                                                           |
| Enforcement location                        | **Decided** — database state machine (§24)                                                                                  |
| **The platform ceiling value**              | **UNRESOLVED** — owner identified, no number. Blocks the age transition only, not F062.2D-2A                                |
| **Policy fields in the connector snapshot** | **UNRESOLVED** — the same snapshot extension F062.2D-0 blocker 6 requires. Blocks the age transition only                   |

### Verdict

> **Split the slice.** Authorize **`F062.2D-2A`** — Delivery Attempt and
> Fencing Persistence Foundation — now, and defer the age-based transition to a
> separate policy-implementation slice.

### F062.2D-2A — authorized conceptually, once this policy is integrated

May implement:

- `integration_delivery_attempt`, with its columns and constraints;
- the **one-open-attempt invariant** (`integration_attempt_open` partial unique index);
- the **open → settled complete-once guard**;
- **`claim_generation` and claim-token-digest fencing**;
- **attempt and outbox consistency** — evidence and state moving in one transaction;
- **all non-age F062.1 state transitions**, with the whitelist enforced in the database;
- **state-machine parity tests**, including the full off-diagonal transition sweep;
- dropping `integration_outbox_state_inert` **by name**, in the same migration that adds the transition guard.

**It must NOT implement an age-based automatic dead-letter transition.**

### The age transition — deferred to its own slice

Deferred until **all four** are satisfied:

1. **numerical pending-age bounds are approved** (§19, §20);
2. **policy configuration ownership is finalized** — which layer holds which value, and who may change it (§4);
3. **maintenance and worker-outage handling is approved** (§13, §14, §15) — because today those intervals accrue, and expiring obligations for platform downtime is the failure mode §14 warns about;
4. **the required F061 age observability is available** (§25) — `oldest pending age` above all, since a worker cannot honestly operate an age policy it cannot measure.

> **No placeholder duration goes into SQL.** Not as a default, not as a
> commented-out constant, and not as a check constraint with a provisional
> number. A duration in the state machine is a policy decision wherever it
> lives, and a placeholder is how a provisional value becomes a production
> default that nobody approved.

### Why this split is the right boundary

The two halves have genuinely different blockers, which is the test for whether
a split is real rather than cosmetic. Everything in 2D-2A is **mechanism**: it
depends on F062.1's vocabulary, F062.2A's fencing model and F062.2D-1's identity
decision, all of which are settled. The age transition is **policy**: its shape
is decided by this document, but its threshold, its ownership and its
measurability are not. Shipping the mechanism now means the fencing and
complete-once guarantees — which protect against duplicate external side effects
— land as early as possible, while the one edge that needs a number waits for
the number.

**Neither slice runs a worker or contacts an external destination.**

That split is clean and worth taking, because the two halves have different blockers:

- **Safe now:** the delivery-attempt table, the complete-once guard, the one-open-attempt index, the fencing model, the transition whitelist for every non-age edge, dropping `integration_outbox_state_inert` by name, and §28's full parity suite. None of it depends on a duration.
- **Not yet:** the age-expiry edge itself. Its _shape_ is decided, but a transition whose threshold nobody has set is a guessed edge — the exact objection that blocked this slice. It should be added with the ceiling, in the same reviewed change.

The alternative — implementing the edge with a placeholder duration — would put a number into the state machine that no owner approved, which is how a provisional value becomes a production default.

**F062.2D-2 still runs no worker and contacts no external destination**, unchanged.

---

## 30. Blockers

**Hard:**

1. **Platform ceiling value** (§19). Owner: Reqro platform, security and operations. Blocks the age-expiry edge, not the rest of 2D-2.
2. **Durable platform-unavailability record** (§13, §14, §15). Without it, worker downtime, secret-manager outage and maintenance all count toward age. Needed before age expiry is trustworthy in production; candidate for its own small slice.
3. **Connector snapshot extension** to carry age policy (§21) — the same extension F062.2D-0 blocker 6 requires for destination semantics. One change, two reasons.
4. **Convergence proof per connector operation** (§5.1 condition 3). No operation has yet been proven convergent, because no real connector exists. Until a per-connector, per-operation determination is reviewed, no `state_sync` operation may be dispatched automatically and repeatedly on the strength of its payload mode alone. Blocks the first real connector, not F062.2D-2A.
5. **The cumulative requeue bound** (§10.1). Whether repeated requeue is limited by a maximum count, a cumulative automatic-action budget, or an absolute horizon from `created_at` is a platform-ceiling-owner decision. Without it, repeated authorization is an unlimited bypass of §19.
6. **Legal determinations §27 items 1 and 5** — whether suppression is permissible, and whether statutory deadlines make late delivery worse than none. These could change §28's recommended outcome for immutable events.
7. Carried forward unchanged: secret-manager decisions; the first destination's API documentation; the approved-snapshot or reconstruction invariant for immutable events.

**F061-owned:** pending count, **oldest pending age** (release gate), age-policy transition count, and a bounded reason-class dimension for dead-letter counts (§25). **Not edited here.**

**Reported, not acted on:** F062's lack of any contract for _supersession_ of a redundant `state_sync` intent (§5). Nothing in this policy depends on it; it would be needed only for a future efficiency optimisation, and adding a state for it is explicitly out of scope.

---

## Related

- [F062 — Enterprise integration reliability and eventing architecture](F062-enterprise-integration-eventing-architecture.md)
- [F062.1 — Enterprise integration contracts foundation](F062-1-integration-contracts-foundation.md) — the nine states and ten failure categories this policy works within
- [F062.2A — Transactional outbox persistence readiness](F062-2A-transactional-outbox-persistence-readiness.md) — the reason taxonomy, ordering predicate and replay edge
- [F062.2B — Connector metadata persistence foundation](F062-2B-connector-metadata-persistence-foundation.md) — the audit timeline §3 relies on, and the two-revision model §21 extends
- [F062.2C — Transactional outbox and atomic enqueue](F062-2C-transactional-outbox-atomic-enqueue.md) — the two timestamps and the payload-mode constraints
- [F062.2D-0 — Delivery worker security and operational readiness](F062-2D-0-delivery-worker-security-readiness.md) — the retry, ambiguity and circuit-breaker model
- [F062.2D-1 — Worker identity and database function security decision](F062-2D-1-worker-identity-db-function-security-decision.md) — the function-mediated enforcement §24 relies on
- [ADR-024 — Transaction-time request authorization](../architecture/decisions/ADR-024-transaction-time-request-authorization.md) — the uncertain-result rule behind §17
