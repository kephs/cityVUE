# F062.2D-2C-0A — Worker execution contract amendment

> **CONTRACT AMENDMENT ONLY. NOTHING IS IMPLEMENTED.**
>
> **NO MIGRATION, FUNCTION, ROLE, GRANT, TEST OR TypeScript CHANGE.**
>
> **NO PRIOR DOCUMENT IS EDITED. THIS AMENDMENT SUPERSEDES BY RECORD, NOT BY REWRITE.**
>
> **NO ADR NUMBER IS ALLOCATED.**

This is the authoritative contract that must be integrated **before**
F062.2D-2C-1 persistence implementation begins. F062.2D-2B and F062.2D-2C-0
exposed several places where earlier F062 decisions are now incomplete or too
coarse to implement safely. This document reconciles them into one explicit
contract, and changes nothing else.

Baseline: `origin/main` at `95cf1a5e5dc8a86cc5080faf1057cb5356253d50`, which
carries F062.2D-2C-0 (`037fed72c4395e5839b3d67b3ef28574dbe4b387`) as a verified
ancestor, merged as PR #27.

**The single most consequential finding is in §1.5: the current schema cannot
record either lease-recovery case truthfully.** `integration_delivery_attempt`
carries `check (outcome is null or outcome = 'succeeded' or failure_category is
not null)`, so every non-successful settlement requires a destination failure
category — including a settlement where no destination was ever contacted.
**Both recovery paths are therefore unimplementable until that constraint is
amended**, which is why this amendment exists and why §24 makes it a hard
prerequisite for F062.2D-2C-1.

---

## 1. Baseline, read from source

Every value below was read from the repository on this branch. Nothing is taken
from a prior summary.

| Item                   | Value                                                               |
| ---------------------- | ------------------------------------------------------------------- |
| Branch                 | `claude/f062-2d-2c-0a-worker-contract-amendment`                    |
| HEAD                   | `95cf1a5e5dc8a86cc5080faf1057cb5356253d50`                          |
| Authoritative `origin/main` | `95cf1a5e5dc8a86cc5080faf1057cb5356253d50` (fetched; 0 ahead 0 behind) |
| F062.2D-2C-0 ancestor  | `037fed7` — confirmed merged (PR #27)                               |
| Working tree and index | clean before editing                                                |

### 1.1 Exact current attempt outcomes

`src/integration/delivery-contract.ts`, `attemptOutcomes` — **four**:

`succeeded`, `failed_transient`, `failed_permanent`, `ambiguous`

`unsettledAttemptOutcomes` is `['ambiguous']`, and `isSettledOutcome` returns
false for it alone.

### 1.2 Exact current failure categories

`src/integration/integration-envelope.ts`,
`integrationFailureCategories` — **ten**:

`destination_unavailable`, `destination_timeout`, `destination_rejected`,
`rate_limited`, `authentication_failed`, `destination_unconfigured`,
`projection_failed`, `contract_unsupported`, `malformed_request`,
`internal_failure`

`transientIntegrationFailures` is **exactly two**:
`['destination_unavailable', 'rate_limited']`. `destination_timeout` is
deliberately absent.

### 1.3 Exact current delivery states

`deliveryStates` — **nine**: `pending`, `dispatching`, `accepted`,
`acknowledged`, `retrying`, `ambiguous`, `failed_permanent`, `dead_lettered`,
`refused`. `terminalDeliveryStates` — **four**: `acknowledged`,
`failed_permanent`, `dead_lettered`, `refused`.

Transitions (`deliveryStateTransitions`, mirrored by the F062.2D-2A guard):
`pending → dispatching|refused`; `dispatching → accepted|retrying|ambiguous|failed_permanent|dead_lettered`;
`retrying → dispatching|dead_lettered`; `accepted → acknowledged`;
`ambiguous → dispatching|accepted|failed_permanent|dead_lettered`;
`acknowledged`, `failed_permanent`, `dead_lettered`, `refused` have no outgoing
edge. Two edges carry a pinned-capability precondition:
`accepted → acknowledged` requires `reports_terminal_state`;
**`ambiguous → dispatching` requires `supports_idempotency_key`.**

### 1.4 Existing bounded reason-code vocabulary

**A reason-code taxonomy already exists as an accepted design, and it is not
implemented anywhere.** Both halves matter.

- **Designed:** F062.2A §8.1 defines `reason_code` as `varchar(40)` with a closed `CHECK`, organised in **ten groups** — Routing, Envelope refusal, Contract negotiation, Payload eligibility, Credential, Transport, Destination refusal, Throttling, **Worker**, Internal. The **Worker** group is exactly `lease_expired_uncertain` and `fenced_stale_completion`. Several groups are reused verbatim from F062.1 constants (`connectorResolutionFailures`, `EnvelopeRefusalCode`).
- **Not implemented:** `grep` over `server/src`, `server/migrations` and `server/test` finds **no** integration `reason_code` identifier. The only `reasonCode` occurrences belong to location eligibility, an unrelated subsystem. `integration_delivery_attempt` has **no `reason_code` column.**
- **Deliberately deferred, with a stated condition.** F062.2D-2A records: the taxonomy "has **no TypeScript authority yet**, nothing in this slice can write it, and committing a ~30-value DB-only vocabulary would create exactly the drift §2 forbids. It arrives with the settle function that classifies outcomes, **alongside its TS source**."

> **That deferral condition is binding on this amendment: `reason_code` may
> only be persisted together with its F062.1 TypeScript authority. §8 and §24
> enforce it.**

### 1.5 Current SQL attempt-state invariants

`20261022000000-add-integration-delivery-attempt.ts`, lines 121–124, verbatim:

```sql
check ((outcome is null) = (completed_at is null)),
check (outcome is null or outcome = 'succeeded' or failure_category is not null),
check (outcome is null or outcome <> 'succeeded' or failure_category is null),
check (completed_at is null or completed_at >= started_at),
```

Plus, inside `complete_integration_attempt` (Migration 53): `failed_transient`
is accepted **only** with `destination_unavailable` or `rate_limited`, and
`destination_timeout` is accepted **only** with outcome `ambiguous`.

> **Line 122 is the blocking defect.** Every non-successful settlement
> currently **requires** a destination failure category. A pre-dispatch
> recovery contacted no destination and a possibly-dispatched expiry observed
> no response, so **neither can be recorded without fabricating destination
> behaviour.** §6 and §7 define the replacement.

And a second, smaller defect: F062.2A §8.1's own declaration includes
`check ((outcome is null) = (reason_code is null))`, which requires a
non-null `reason_code` for **every** settlement including `succeeded` — while
all ten groups of the taxonomy describe failures and none contains a success
value. **As drafted that biconditional is unsatisfiable for a successful
attempt.** §7 amends it.

---

## 2. Amendment authority and precedence

This is an **implementation-driven amendment**. It is authoritative for worker
execution semantics from this point forward.

> **It does not erase any prior document.** F062.1, F062.2A, F062.2C,
> F062.2D-0, F062.2D-1, F062.2D-1A, F062.2D-2A, F062.2D-2B and F062.2D-2C-0
> all remain in force except on the specific points listed below. **Where this
> amendment and an earlier statement conflict, this amendment governs, and the
> conflict is named explicitly rather than left to be discovered.**

### 2.1 Amendment register

| # | Document and statement                                                                                                | Old statement                                                                 | Amended statement                                                                                                     | Reason                                                                                                                 |
| - | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **A1** | **F062.2D-1 §6/§13** — function inventory                                                                        | "three functions, one caller, no judgement"                                   | **Four functions** (§10)                                                                                              | The dispatch-boundary marker is what makes safe automatic recovery possible, and the three-function inventory predates it |
| **A2** | **F062.2D-1 §9** — definer `search_path`                                                                         | "`SET search_path = pg_catalog, pg_temp`", application schema not in the path  | **`pg_catalog, public, pg_temp`** (§9)                                                                                | Accepted F062.2C/F062.2D-2A trigger guards resolve the application schema unqualified when fired inside definer functions |
| **A3** | **F062.2D-0 §12** — claim signature sketch                                                                       | `claim_integration_intent(connector, lease, worker_label)`                    | **No worker-supplied lease, expiry, label or retry time** (§11)                                                        | A caller-controlled lease is self-granted unbounded ownership; a label is an unbounded string and a hostname-leak path   |
| **A4** | **F062.2D-2A line 122 / F062.1 settlement rule** — a non-successful settlement requires a destination category   | `outcome <> 'succeeded' ⇒ failure_category is not null`                        | **Category required only for destination-derived settlement; lifecycle-derived settlement carries a `reason_code` and a NULL category** (§6, §7) | A recovery that contacted no destination cannot name destination behaviour without fabricating evidence                 |
| **A5** | **Migration 53 transient rule**                                                                                  | `failed_transient` ⇒ category ∈ {`destination_unavailable`, `rate_limited`}    | **Unchanged when a category is present**, plus one precisely bounded lifecycle case with a NULL category (§6 B)        | Keeps the destination taxonomy closed while permitting the one provably-safe pre-dispatch retry                          |
| **A6** | **F062.2A §8.1** — `(outcome is null) = (reason_code is null)`                                                   | `reason_code` non-null for every settlement, including `succeeded`            | **`reason_code` is NULL for `succeeded`**, and required only for lifecycle-derived settlement (§7)                     | The taxonomy contains no success value, so the biconditional as drafted is unsatisfiable                                |
| **A7** | **F062.2A §8.1** — `reason_code` maps many-to-one **onto** `failure_category`, pairing validated                  | Every reason code refines some category                                       | **The mapping is partial.** Lifecycle codes map to **no** category, by design (§3, §7)                                 | "Reqro's machinery did something" is not a refinement of "the destination did something"                                |
| **A8** | **F062.2D-2C-0 §13 (pre-review draft)** — sequence guaranteed by claim ordering                                   | `ORDER BY` guarantees FIFO                                                    | **A separate predecessor predicate is mandatory** (§15)                                                                | `ORDER BY` cannot order candidates that eligibility filtered out                                                        |
| **A9** | **F062.2D-2C-0 §13.1** — `accepted` non-blocking, flagged for confirmation                                       | Open judgement call                                                           | **RESOLVED: `accepted` is non-blocking** (§17)                                                                         | Requiring `acknowledged` would permanently block streams on connectors without terminal-state reporting                 |
| **A10** | **F062.2D-2C-0 §16.2 and this document's own earlier draft** — attempt counting                                 | "`max(attempt_number)` already **is** the attempt count"                      | **`attempt_number` is evidence only; the destination retry count derives from boundary-crossing attempts** (§18.2)       | The two were numerically equal only while every attempt was a destination attempt. Pre-dispatch recovery breaks that equality, and counting a recovery as a destination attempt would let a Reqro-side crash loop exhaust a healthy destination's budget |

**Not amended, and explicitly reaffirmed:** F062.1's nine states, four
outcomes, ten categories and two transient categories; the transition graph and
both capability preconditions; F062.1 `mayEraseEvidence()` returning `false`;
F062.2D-1A's pending-age clock, `min` precedence and convergence test;
F062.2D-2A's immutability guards; every F062.2D-2B hardening property.

---

## 3. Two semantic namespaces

> **`failure_category` and `reason_code` are two different questions with two
> different owners. They are not alternatives, not synonyms, and not a fallback
> for one another.**

| | **`failure_category`** | **`reason_code`** |
| --- | --- | --- |
| **Answers** | *What did the destination or external transport do?* | *What did Reqro's own delivery machinery do?* |
| **Domain** | the existing **ten** F062.1 `integrationFailureCategories`, unchanged and unwidened | a **closed, bounded, Reqro-owned** lifecycle and recovery set |
| **Requires** | an actual external interaction to have occurred and been observed | nothing external; it describes Reqro's internal lifecycle |
| **Written by** | an adapter, from a real destination response or transport event | the **database-authored** recovery path, and later the classifying settle path |
| **Retry decidability** | **yes** — the coarse value is what retry policy reads | no; it refines or explains, and for lifecycle origins it authorizes |
| **Free text** | impossible — closed `CHECK` | impossible — closed `CHECK` |
| **Vendor text, PII** | **never** | **never** |

### 3.1 Prohibitions

- **No Reqro-internal lifecycle condition may be added to `failure_category`.** Not a lease code, not a worker-crash code, not a scheduler condition. The ten values describe destinations, and widening them would force every adapter to map into a vocabulary containing things **no adapter can ever observe**.
- **No `reason_code` value may duplicate a destination failure category.** Where F062.2A's taxonomy contains names that resemble categories (`rate_limited` in the Throttling group), they are *refinements recorded alongside* the category, never substitutes for it.
- **Neither column may ever accept free text, a vendor error string, a vendor error code, a hostname, a URL or any resident value.** Both are closed enumerations checked by constraint. F062.2A §8.1 already establishes that a closed enumeration *is* the privacy control, and that it is strictly stronger than a character-class pattern.

### 3.2 `reason_code` belongs on the delivery attempt only

**Attempt-level, not obligation-level.** The attempt is where per-try evidence
lives: `started_at`, `completed_at`, `outcome`, `failure_category`,
`claim_generation`, `claim_token_digest`, the pinned revision and the
capability snapshot are all attempt columns, and a reason code explains **one
settlement**, not the obligation's whole life.

Putting it on the obligation would be actively wrong: an obligation may have
many attempts with different reasons, so a single obligation-level value would
either be overwritten — erasing evidence, which F062.1 forbids — or
disagree with the attempt it supposedly describes. **No repository requirement
argues the other way**, and F062.2A §8.1 already places it on the attempt.

---

## 4. The exact pre-dispatch recovery reason

F062.2D-2C-0 deliberately deferred naming authority to this amendment. **It is
resolved here.**

> ### The identifier is `lease_expired_pre_dispatch`.

### 4.1 Why this exact form, and not the candidate

The authorization offers `claim_lease_expired_pre_dispatch` and instructs that
it be used **only if** it matches repository naming conventions. It does not,
and the existing Worker group settles the question:

| Existing Worker-group value | Shape                     |
| --------------------------- | ------------------------- |
| `lease_expired_uncertain`   | `lease_expired_<qualifier>` |
| `fenced_stale_completion`   | `<mechanism>_<condition>` |

`lease_expired_uncertain` is the **direct sibling** of the value being named:
same subject (an expired claim lease), same grammatical shape, differing only
in the qualifier that distinguishes the two cases. The repository-consistent
parallel is therefore `lease_expired_pre_dispatch`. A `claim_` prefix would be
redundant — a lease exists only as a property of a claim, and no other Worker
value carries it — and would make the two halves of one distinction look like
members of different families.

Both candidates fit F062.2A's declared `varchar(40)`
(26 and 32 characters), so length does not decide it. **Convention does.**

### 4.2 What it means, precisely

> **`lease_expired_pre_dispatch` asserts exactly: the claim lease expired while
> `dispatch_started_at` was NULL, therefore no external transmission could have
> occurred.**

| It **does** mean                                                       | It does **not** mean                                           |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| The lease passed its database-authored expiry                          | A generic internal failure                                     |
| The dispatch boundary was never crossed, proven by a NULL marker        | "Something went wrong inside Reqro"                            |
| No destination interaction is possible, so a retry cannot duplicate     | "The destination was unavailable"                              |
| Automatic retry is authorized by **evidence**, not by elapsed time      | That any Reqro-side fault is automatically retryable            |

**The precision is the safety property.** A broad "internal failure" reason
would make every Reqro-side fault look like a safe pre-dispatch recovery —
including faults that occurred *after* dispatch began, which is precisely the
unsafe case. This value is unwritable unless `dispatch_started_at is null`, and
§6 makes that enforceable in SQL.

### 4.3 The vocabulary this amendment actually introduces

**One new value.** Everything else is F062.2A's existing design, preserved.

| Value                        | Status in this amendment                                     | Writable by                            |
| ---------------------------- | ------------------------------------------------------------ | -------------------------------------- |
| **`lease_expired_pre_dispatch`** | **NEW.** Named by this amendment                         | the recovery function only             |
| `lease_expired_uncertain`    | **Existing** — F062.2A §8.1 Worker group, authority preserved | the recovery function only             |
| `fenced_stale_completion`    | **Existing, but deferred** — see §4.4                        | **nothing today**                      |
| The other ~26 values across nine groups | **Existing, and deliberately not yet persisted** — see §8.2 | the future classifying settle path |

### 4.4 `fenced_stale_completion` has no writer, and is therefore deferred

Noted because it would otherwise look like an omission. F062.2A places it in
the Worker group, but **the implemented fence records nothing on refusal**: a
stale claimant's `UPDATE` matches zero rows, `complete_integration_attempt`
returns an undifferentiated `false`, and no row is mutated — deliberately, so
that a wrong token, a stale generation, an already-settled attempt and another
Organization's attempt are indistinguishable.

There is therefore **no row on which to record it**, and recording one would
require writing to an attempt the caller does not own — which is the exact
thing the fence exists to prevent. It is a **telemetry and audit concept, not
an attempt column value**, and it must not enter the `CHECK` until something can
legitimately write it. Admitting an unwritable value would make the
vocabulary-equality test assert a vocabulary nothing produces.

---

## 5. Possibly-dispatched lease expiry

### 5.1 `lease_expired_uncertain` already exists, and its authority is preserved

**Confirmed from source.** It is in F062.2A §8.1's Worker group, and
F062.2D-0 §19, F062.2D-0 §25, F062.2D-1 §9.1 and F062.2A §9.1 all specify the
same settlement. **This amendment preserves that exact authority and renames
nothing.**

### 5.2 Settlement semantics

For: `claim_expires_at` passed **and** `dispatch_started_at is not null`
**and** the destination outcome cannot be established.

| Required property                           | How it is met                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **No blind retry**                          | The obligation moves `dispatching → ambiguous`, which is **not reachable by the retry predicate** (§18)           |
| **Delivery becomes ambiguous**              | Attempt `outcome = 'ambiguous'`; obligation state `ambiguous`                                                      |
| **Reconciliation / operator path applies**  | The existing capability-gated `ambiguous → dispatching` edge, or `ambiguous → accepted` on read-after-write or reconciliation evidence, or operator disposition |
| **Elapsed time does not erase uncertainty** | There is **no** timer edge out of `ambiguous`. The only exits are the four existing reviewed ones                  |

### 5.3 Which fields it uses — resolved exactly

> **`reason_code` only. `failure_category` is NULL.**

| Field              | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| `outcome`          | `ambiguous`                                                            |
| `failure_category` | **NULL** — nothing was observed                                        |
| `reason_code`      | **`lease_expired_uncertain`**                                          |

**Because no destination response was observed, no destination failure may be
fabricated.** The recovery function did not time out waiting for a destination;
it found an abandoned claim. `destination_timeout` would be the tempting value
and it would be false — it asserts that Reqro sent a request and waited, which
the recovery path cannot know and did not do.

**The distinction is operationally load-bearing**, not pedantic:
`failureReasonDimension` maps `destination_timeout` onto F061's `timeout`
reason, so fabricating it would tell an operator a destination was slow during
what was purely a Reqro-side worker crash — and would do so in a metric, where
the correction never reaches.

### 5.4 A worker-observed timeout is a different, and still valid, row

The same `ambiguous` outcome has **two legitimate shapes**, distinguished by
origin, and both must remain writable:

| Origin                                        | `outcome`   | `failure_category`                | `reason_code`              |
| --------------------------------------------- | ----------- | --------------------------------- | -------------------------- |
| **Adapter observed a timeout after sending**  | `ambiguous` | `destination_timeout`             | NULL now; later a Transport-group refinement |
| **Recovery found an abandoned claim past the boundary** | `ambiguous` | **NULL**                | `lease_expired_uncertain`  |

Both are honest. They differ in what was observed, and the schema must record
that difference rather than flatten it.

---

## 6. Attempt settlement combinations — normative

This section resolves the §1.5 blocking defect. **Four settlement origins,
four exact permitted shapes.**

| # | Settlement origin                     | Authored by                 | `outcome`                                         | `failure_category`                   | `reason_code`                   |
| - | ------------------------------------- | --------------------------- | ------------------------------------------------- | ------------------------------------ | ------------------------------- |
| **A** | **Normal adapter success**         | worker, via completion      | `succeeded`                                       | **NULL**                             | **NULL**                        |
| **B** | **Normal adapter failure**         | worker, via completion      | `failed_transient` \| `failed_permanent` \| `ambiguous` | **NOT NULL**, one of the ten    | **NULL** now; later a destination-derived refinement |
| **C** | **Pre-dispatch lease recovery**    | **database**, via recovery  | `failed_transient`                                | **NULL**                             | **`lease_expired_pre_dispatch`** |
| **D** | **Possibly-dispatched lease expiry** | **database**, via recovery | `ambiguous`                                       | **NULL**                             | **`lease_expired_uncertain`**   |

### 6.1 Why C is `failed_transient` with a NULL category

The preferred model offered by the authorization was
`outcome = failed_transient`, `failure_category = null`,
`reason_code = <pre-dispatch code>`. **Compared against current F062.1
semantics, it is the cleanest amendment, and it is adopted** — but the
comparison is recorded rather than assumed, because the authorization required
it not be accepted blindly.

| Alternative                                                      | Assessment                                                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`failed_transient` + NULL category + lifecycle reason**        | **ADOPTED.** `failed_transient` is the only outcome that maps to `retrying`, which is the correct destination state. The NULL category is *truthful* — no destination acted. The lifecycle reason carries the authorization |
| `failed_transient` + `internal_failure`                          | **Rejected.** Fabricates a category, and `internal_failure` is not in `transientIntegrationFailures`, so it would require widening the transient set — the exact broadening §8 forbids |
| A new `failure_category` member                                  | **Rejected.** Widens a vocabulary every adapter maps into, to describe something no adapter can observe (§3.1)                                             |
| `ambiguous` for the pre-dispatch case too                        | **Rejected.** It is *not* ambiguous — the NULL marker proves nothing was sent. Recording ambiguity would manufacture operator work from a provably safe case, and would forfeit the entire benefit of the dispatch boundary |
| A fifth `outcome` value                                          | **Rejected.** F062.1's four outcomes are reaffirmed; the settlement origin is carried by `reason_code`, which is what it is for                            |

### 6.2 The amended transient rule, stated exactly

`failed_transient` becomes reachable two ways, and **only** two:

1. **With a category** — then the category must be `destination_unavailable` or `rate_limited`, exactly as Migration 53 enforces today. **Unchanged.**
2. **With a NULL category** — then `reason_code` must be **exactly** `lease_expired_pre_dispatch`, and nothing else.

> **This does not make internal failures generally retryable.** The NULL-category
> path admits one named value with one provable precondition. Every other
> Reqro-side fault still settles as `failed_permanent` with `internal_failure`,
> or — preferably — never claims at all (§19.2).

### 6.3 Impossible combinations, all SQL-rejectable

The contract's test is that nonsense cannot be written. Each row below must be
**refused by constraint**, not merely avoided by convention:

| Rejected combination                                                      | Why                                                              |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `succeeded` with any `failure_category`                                   | already enforced (line 123); reaffirmed                          |
| `succeeded` with any `reason_code`                                        | **new** — amends F062.2A's biconditional (§2.1 A6)               |
| non-`succeeded` with **both** NULL                                        | a settlement with no explanation at all                          |
| non-`succeeded` with a category **and** a lifecycle reason                | two mutually exclusive origins claimed at once (§7)              |
| `failed_transient`, NULL category, reason ≠ `lease_expired_pre_dispatch`  | only that one value authorizes a category-free transient retry   |
| `failed_transient`, NULL category, reason `lease_expired_uncertain`       | uncertainty is never transient — this is the duplicate-producing combination |
| `ambiguous`, NULL category, reason ≠ `lease_expired_uncertain`            | the only category-free ambiguity is lease-expiry uncertainty      |
| `ambiguous`, NULL category, reason `lease_expired_pre_dispatch`           | contradiction: pre-dispatch proves non-ambiguity                 |
| `failed_permanent` with NULL category                                     | **no lifecycle origin produces `failed_permanent`**; a permanent failure is always a destination or configuration fact |
| `lease_expired_pre_dispatch` on an attempt with non-NULL `dispatch_started_at` | the reason asserts a fact the row contradicts                |
| any `reason_code` while `completed_at is null`                            | a reason explains a settlement; an open attempt has none          |

**The last two are the ones that matter most.** The `dispatch_started_at`
cross-check is what makes `lease_expired_pre_dispatch` an *assertion the
database verifies* rather than a label the writer chooses — without it, the
whole safe-recovery argument rests on the recovery function being bug-free.
F062.2D-2C-1 must implement it as a table constraint, not only as function
logic.

---

## 7. The namespace partition invariant

**Question: may `failure_category` and `reason_code` both be populated?**

> **Yes — but never a destination category together with a lifecycle reason.**
> The exclusion is between the two **namespaces**, not between the two
> **columns**.

This is the strongest rule that is also valid, and it is stronger than a plain
column-level mutual exclusion, which would have been wrong: F062.2A's design
has a destination-derived reason code *refining* a category, and that pairing is
preserved (§2.1 A7 makes the mapping partial, not absent).

### 7.1 The partition

Every `reason_code` value belongs to exactly one of two disjoint classes:

| Class                    | Members                                                                                | Category rule                                     |
| ------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Destination-derived**  | F062.2A's Routing, Envelope refusal, Contract negotiation, Payload eligibility, Credential, Transport, Destination refusal, Throttling and Internal groups | `failure_category` **must be NOT NULL** and the pairing must be valid |
| **Lifecycle-derived**    | the **Worker** group — today `lease_expired_pre_dispatch`, `lease_expired_uncertain`   | `failure_category` **must be NULL**               |

So, as a single rule:

> **A settled, non-successful attempt is explained by exactly one namespace.
> `failure_category is not null` implies the reason (when present) is
> destination-derived. `failure_category is null` implies `reason_code` is
> present and lifecycle-derived. Both NULL is not a settlement, and a category
> with a lifecycle reason is a contradiction.**

### 7.2 Legitimate cases where both are populated

Named explicitly, because the authorization asks for them:

- **A destination-derived refinement of a category** — F062.2A's primary design. `failure_category = 'destination_timeout'` with Transport-group `reason_code = 'connection_reset_after_send'` records both the coarse retry-decidable value and what Reqro actually observed. Retry policy reads the category; diagnosis reads the reason.
- **`internal_failure`** sits in both the category list and F062.2A's Internal reason group. It stays **destination-derived-class** for this partition — meaning it pairs *with* a category and is **not** a lifecycle code. It is the terminal catch-all for a Reqro fault observed during a real dispatch attempt, and it is **not** retryable. It must not be confused with the Worker group, and that confusion is exactly what §8.1 forbids.

**No column is left optional with meaningless combinations.** Every
(`outcome`, `failure_category`, `reason_code`) triple is either one of §6's four
shapes or constraint-rejected.

---

## 8. Required F062.1 TypeScript amendment

**No TypeScript is implemented here.** This specifies exactly what the future
amendment must contain, so F062.2D-2C-1 can land `reason_code` *with* its
authority, satisfying F062.2D-2A's deferral condition (§1.4).

### 8.1 What must be added

| Item                                | Requirement                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A bounded reason-code constant**  | A closed `as const` array, the single source of truth, mirrored exactly by the SQL `CHECK`                                                                   |
| **A lifecycle subset constant**     | The Worker-group values, so the partition of §7.1 is expressible in code and not restated in prose                                                            |
| **A settlement-combination predicate** | A total function over (`outcome`, `failure_category`, `reason_code`) returning whether the triple is one of §6's four shapes — the TypeScript twin of the constraints |
| **A recovery-origin predicate**     | "Is this settlement database-authored lifecycle recovery?", derived from the reason code rather than from a separate flag column                              |
| **Vocabulary-equality enforcement** | F062.2A's existing test approach extended: read the live `CHECK` from `pg_constraint` via `pg_get_constraintdef`, parse the literals, assert **set equality** in both directions with the TypeScript constant |

### 8.2 Scope: the lifecycle subset only

> **F062.2D-2C-1 must persist only the two lifecycle values it can actually
> write: `lease_expired_pre_dispatch` and `lease_expired_uncertain`.**

The remaining ~26 destination-derived values stay deferred, for F062.2D-2A's
own reason, which has not changed: no adapter exists to produce them, and
committing a vocabulary nothing can write creates drift and makes the
set-equality test assert something unreal. They arrive with the classifying
settle path. `fenced_stale_completion` stays out for §4.4's reason.

**This is a deliberate narrowing of F062.2A §8.1's scope, not a rejection of
it.** The taxonomy's design, groups and verbatim F062.1 reuse all stand; only
the *timing* of each group's persistence is staged.

### 8.3 The prohibition, restated

> **`internal_failure` must NOT be added to `transientIntegrationFailures`.**

It would make every unrelated internal fault appear automatically retryable —
including a deterministic `projection_failed`-class defect that will fail
identically forever, and including faults occurring *after* the dispatch
boundary. **The pre-dispatch recovery authorization must remain precise: one
named reason, one provable precondition, verified against
`dispatch_started_at`.** `transientIntegrationFailures` stays exactly
`['destination_unavailable', 'rate_limited']`.

---

## 9. `search_path` amendment

| | |
| --- | --- |
| **Old recommendation** (F062.2D-1 §9, §13) | `SET search_path = pg_catalog, pg_temp` — the application schema deliberately not in the path, so an unqualified reference **fails** rather than resolving unexpectedly |
| **Amended requirement** (implemented and reviewed in F062.2D-2B) | **`SET search_path = pg_catalog, public, pg_temp`** |

### 9.1 Why

The old recommendation remains correct for Migration 49's nine definer
functions, which only `SELECT ... FOR SHARE`, fire no trigger and never
exercise nested resolution.

It is **not usable** for the worker functions, for a measured reason: a
function's `SET` clause stays in effect for everything it calls, including
trigger functions, unless the callee carries its own `SET` clause. The accepted
F062.2C and F062.2D-2A guards — `guard_integration_outbox` and
`guard_integration_delivery_attempt` — declare composite variables
(`declare obligation integration_outbox;`) and read tables **unqualified**,
with **no `SET search_path` clause**, deliberately, because that is what keeps
the schema portable for the disposable-schema test harness.

**Measured:** with the application schema absent from the path, the first claim
fails with `type "integration_outbox" does not exist`, raised from inside the
attempt guard during the `INSERT`. **This is a production failure, not a harness
artifact** — the deployment's application schema is `public`, equally absent
from `pg_catalog, pg_temp`.

### 9.2 The security condition, preserved

> **`public` is permitted in a `SECURITY DEFINER` path only while effective
> `CREATE` on the application schema remains denied to every untrusted
> execution principal.**

**Database tests already enforce this invariant.**
`database-role-separation.integration.test.ts` subtest *"F062.2D-2B no
untrusted principal holds effective CREATE on the application schema"* proves,
on PostgreSQL 17 where the application schema is literally `public`: effective
`CREATE` absent via `has_schema_privilege` for `PUBLIC`, `reqro_runtime`,
`reqro_operator`, `reqro_integration_function_owner` and `reqro_migrate`
without an explicit privileged `SET ROLE`; the schema ACL granting `CREATE` to
exactly one principal; no membership or default-privilege path; and behavioural
refusal of `CREATE TABLE` and `CREATE FUNCTION` for all of them, while the
explicit ownership path succeeds. The pin's exact shape — `pg_catalog` first,
`public` second, `pg_temp` last, no fourth schema, no caller-controlled form —
is asserted positionally by
`worker-function-api-contract.test.ts`, and independently from the live
catalogue via `proconfig`.

### 9.3 Future hardening, explicitly not a prerequisite

A future slice may fully qualify and harden the older F062.2C/F062.2D-2A
trigger functions and then remove `public` from the definer path, returning it
to `pg_catalog, pg_temp`.

> **That hardening is NOT a prerequisite for F062.2D-2C-1, 2C-2, 2C-3 or
> F062.2D-3.** It redefines accepted objects and breaks harness portability, so
> it belongs in its own slice with its own review. The tested invariant of §9.2
> is what makes the current path safe in the meantime.

---

## 10. Function inventory amendment — four functions

F062.2D-1 §13 concluded "three functions, one caller, no judgement".
**Implementation evidence supersedes it.** The minimal safe target is **four**,
and the fourth is not an addition for convenience — it is what makes safe
automatic recovery possible at all.

| Function                                                  | Status      | Responsibility boundary                                                                                                                                                | Must NOT                                                                                           |
| --------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **`claim_integration_intent`**                            | implemented, to be enhanced | Select **one** eligible obligation; validate connector dispatch eligibility; apply retry, ordering and age gates; open exactly one attempt; store only the token digest; set the lease from policy; transition `pending`/`retrying` → `dispatching`; return a bounded descriptor | accept a lease, expiry, label or retry time; return a raw token, digest or credential locator; claim `ambiguous` or `dead_lettered` |
| **`mark_integration_dispatch_started`**                   | **NEW**     | Record the dispatch boundary, write-once, under the **full** fencing predicate in one statement                                                                         | be callable twice; move a delivery state; be callable by a non-owner; accept a timestamp            |
| **`complete_integration_attempt`**                        | implemented, to be enhanced | Settle the open attempt under the full fence; validate the §6 combination; map outcome to state; compute and persist `next_attempt_at` for a transient settlement; enforce the attempt ceiling and horizon | accept `claim_expires_at` as a fence predicate (§12); write a lifecycle `reason_code`; accept a caller retry time |
| **`recover_expired_integration_claim`**                   | **NEW**     | Settle expired claims per §14 — pre-dispatch to `failed_transient` + `lease_expired_pre_dispatch`, possibly-dispatched to `ambiguous` + `lease_expired_uncertain`       | claim; re-claim; advance a generation on an existing row; accept a duration, interval, timeout or force parameter |

**Net: two new, two enhanced. Four total, from two implemented today.**

### 10.1 Boundaries that must not blur

- **Recovery settles; it never claims.** The next ordinary claim creates the next attempt. This keeps every claim's evidence immutable and attributable (F062.2D-2C-0 §9, Option B).
- **Retry scheduling lives inside completion and recovery, not in a separate function.** It must be in the **same transaction** as the settlement that caused it, or a scheduled retry can be lost or doubled.
- **Ordered-stream coordination is not a function.** Mutual exclusion is the partial unique index; FIFO is a predicate inside the claim function (§15).
- **No fifth function for operator actions.** Those live on the operator surface under a different principal (§22).

### 10.2 Hardening carried forward

Every F062.2D-2B property applies unchanged to both new functions: owned by
`reqro_integration_function_owner`; `SECURITY DEFINER`; `VOLATILE`; typed
parameters with no catch-all JSON or text; no caller-controlled object
identifier; no dynamic SQL; every application object fully qualified;
`search_path` pinned per §9; `PUBLIC EXECUTE` revoked by full signature; raw
claim tokens never persisted, returned, interpolated into SQL or named in an
exception.

---

## 11. Claim signature amendment

F062.2D-0 §12 sketched
`claim_integration_intent(connector, lease, worker_label)`. **Those two
parameters are superseded and must never be implemented.**

| The worker must NOT supply   | Why                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Lease duration**           | A caller-controlled lease is self-granted ownership. A worker could request an effectively unlimited lease and wedge an obligation for as long as it liked |
| **Claim expiration**         | Same, stated absolutely: the deadline is computed by the database from policy, never accepted                                  |
| **Worker hostname or label** | An unbounded string in a tenant-scoped evidence row, and a hostname-leak path. F061's label policy forbids hostnames in telemetry; persistence keeps the same discipline. `claim_generation` plus the token digest already answer "is this the current claimant?" with cryptographic rather than nominal evidence |
| **Arbitrary retry timestamp** | A worker that can choose its own next-attempt time can schedule an immediate retry and defeat backoff entirely                |

> **Lease and retry policy are database- and policy-owned, without exception.**

### 11.1 The one thing the worker does supply

**The raw claim token, and only that.** It remains worker-generated CSPRNG
material under F062.2D-0, it is the single worker-provided ownership secret,
and the database stores only its SHA-256 digest — never the value, which is
never persisted, returned, interpolated into SQL or named in an exception.

The database can bound a token's **encoding** but not its **entropy**: the
implemented claim refuses a value shorter than 22 characters, the shortest
base64url encoding of 128 bits, and longer than 512. **The CSPRNG obligation
remains the worker's**, and no constraint can verify it.

---

## 12. Lease settlement race — normative

> ### Expiry authorizes recovery; successful generation rollover fences the stale claimant.

| Condition                                                                                                      | May the current claimant still settle? |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `claim_expires_at` passed, **no recovery has succeeded**, same generation and token still current              | **YES** — it records the genuine outcome |
| Recovery has succeeded, so ownership rolled over                                                               | **NO** — the stale claimant is fenced  |

### 12.1 Why expiry alone must not invalidate a completion

A worker returning at `expiry + 1ms` holding a real destination response has
**the truest evidence in the system**. Rejecting it on a clock test would
discard an observed fact, replace it with manufactured ambiguity, invent
operator work out of a healthy delivery, and — where the pinned capability
permits re-attempt — invite a genuine duplicate from an entirely healthy
dispatch.

> **`claim_expires_at` must NOT appear in the normal completion fence.** The
> fence stays exactly as implemented and tested: Organization, obligation,
> attempt, openness, `claim_generation`, token digest.

### 12.2 Atomic contention, and what fences the stale claimant

Recovery and a late completion **contend on the same open attempt row under the
same lock**, each as a single fenced `UPDATE`. Exactly one wins, and the winner
determines the evidence:

- **Completion wins:** the attempt closes with the real outcome. Recovery's own fence requires `completed_at is null`, matches zero rows, and does nothing. **The genuine outcome stands.**
- **Recovery wins:** the attempt closes as recovered. The late completion matches zero rows and returns `false`. The worker's outcome is lost to ambiguity — an acknowledged residual risk, not a correctness defect.

**No interleaving leaves the row half-settled, and none lets both succeed.**

Precisely, a stale claimant is fenced in **two layers**, and the first is the
one that fires:

1. **`completed_at is null` fails** — recovery closed that attempt, and the existing fence already requires openness. **This layer is already implemented and tested in F062.2D-2B.**
2. **Generation rollover** — the next claim opens a **new** attempt with the next `claim_generation` and a fresh token, so the obligation's ownership has genuinely moved and the stale worker's expected generation and digest match no open row.

Both return the same deliberately undifferentiated `false`.

> **No elapsed-time test may erase a genuine completion result.** A completion
> is refused only because ownership demonstrably moved — never because a clock
> passed.

---

## 13. Dispatch boundary protocol — normative

### 13.1 The required worker protocol

```
1. claim                                   -> commit
2. prepare the request locally             (no I/O)
3. call mark_integration_dispatch_started
4. COMMIT that marker                      <-- THE BOUNDARY
5. only then transmit externally
6. settle                                  -> commit
```

> **A worker must not transmit anything to a destination until its
> dispatch-started marker is committed.**

**Never** transmit first and mark afterwards. A crash between those two actions
would create a **transmitted-but-unmarked** attempt, which automatic recovery
would then treat as provably pre-dispatch and retry — producing exactly the
duplicate external side effect the whole design exists to prevent.

### 13.2 The failure mode is one-directional, by design

| Crash point                            | Durable state                | Recovery treats it as      | Correct? |
| -------------------------------------- | ---------------------------- | -------------------------- | -------- |
| After step 4, before transmitting      | marker set, nothing sent     | possibly-dispatched → `ambiguous` | **Conservative.** A false ambiguity — the acceptable error |
| Before step 4 commits                  | marker absent                | pre-dispatch → safe retry  | **Correct**, because the protocol forbids transmitting first |
| After transmitting                     | marker set                   | possibly-dispatched → `ambiguous` | **Correct** |

**The unsafe direction is impossible by protocol rather than unlikely by
timing**, and no elapsed-time reasoning is involved anywhere.

### 13.3 `dispatch_started_at` semantics

| Property      | Value                                                                  |
| ------------- | ---------------------------------------------------------------------- |
| Authority     | **database** — `clock_timestamp()`, never a caller-supplied time        |
| Mutability    | **write-once**, NULL → non-NULL only. Never cleared, never re-stamped   |
| Nullability   | NULL while pre-dispatch                                                |
| Fencing       | the marker call carries the full fencing predicate; the column itself is a recovery precondition, not a completion predicate |
| Evidence      | retained permanently on the settled attempt row                        |

> **It means "external transmission may now occur." It does NOT mean "the
> destination definitely received the request."**

That distinction is the same one `ambiguous` exists to express. A set marker
says only that Reqro crossed its own boundary; what happened beyond it is
exactly what the schema cannot know.

### 13.4 The residual risk, named

**This protocol is a worker obligation, not a database guarantee.** The
database cannot verify that a worker committed its marker before transmitting.
A buggy or malicious worker could transmit first, and the pre-dispatch recovery
path would then wrongly treat a possibly-dispatched attempt as safe.

> **F062.2D-3 must state this as an explicit worker contract, and F062.2D-4
> must prove the ordering by test against the loopback adapter.**

Mitigating factors, stated honestly rather than as a dismissal: the worker is
Reqro-owned code rather than third-party; the loopback slice can observe the
ordering directly; and `capability_snapshot.side_effect_risk` modulates the
consequence, with `physical` risk requiring operator disposition rather than
automatic re-attempt.

---

## 14. Safe recovery contract — normative

### 14.1 Automatic recovery is permitted only when all five hold

1. the attempt **remains open** (`completed_at is null`);
2. the claim lease has **expired** under approved policy (`claim_expires_at < clock_timestamp()`, compared on the database's clock);
3. **`dispatch_started_at IS NULL`**;
4. no recovery or settlement has already won the row;
5. identity, tenant and fencing predicates match.

**All five are predicates on one statement.** There is no check-then-act window.

### 14.2 Automatic recovery must

| Requirement                               | How                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Preserve old attempt evidence**         | Settle in place, preserving `claim_generation`, `claim_token_digest`, `started_at`, `dispatch_started_at`, the pinned revision and the capability snapshot. **Never relabel, never delete** — F062.1 `mayEraseEvidence()` is `false` |
| **Prevent stale claimant settlement**     | The attempt is now closed, so the existing fence's `completed_at is null` refuses it (§12.2)                                          |
| **Schedule retry per reviewed policy**    | Set `next_attempt_at` from pinned policy in the **same transaction** (§20)                                                            |
| **Never infer destination failure**       | `failure_category` stays **NULL**; the explanation is `lease_expired_pre_dispatch` (§6 C)                                             |

### 14.3 Possibly-dispatched expiry must not use this path

> **A non-NULL `dispatch_started_at` disqualifies an attempt from automatic
> recovery absolutely.** It takes the §5 path instead: settle `ambiguous` with
> `lease_expired_uncertain`, obligation `dispatching → ambiguous`, no
> `next_attempt_at`, and re-attempt only through the existing
> capability-gated `ambiguous → dispatching` edge or an operator decision.

No duration, however long, converts that case into the automatic path.

---

## 15. Ordered delivery amendment — the two-control model

> **Two independent controls, two guarantees, two failure modes. Neither
> substitutes for the other.**

### 15.1 Control one — mutual exclusion

A **partial unique index** on the obligation, over:

```
organization_id, integration_connector_id, aggregate_type, aggregate_id
  where requires_ordered_delivery = true
    and state in (<the reviewed in-flight / blocking states>)
```

The reviewed blocking states are **`dispatching` and `ambiguous`**: an
in-flight dispatch holds the slot, and an unresolved ambiguity holds it too —
which is what implements poison isolation, since only that aggregate's slot
halts while every other aggregate on the connector continues.

It is **atomic by construction**: the second `UPDATE ... SET state='dispatching'`
blocks on the first's uncommitted index entry and then fails. There is no
check-then-act window because there is no check. `pending` and `retrying` are
**not** in the predicate, so the index constrains concurrency and never queue
depth — `mayEnqueue` stays intact and an outage builds a backlog rather than
rejecting intents.

> **This index provides MUTUAL EXCLUSION ONLY. It does not provide FIFO.**

### 15.2 Control two — the strict FIFO predecessor predicate, mandatory

`ORDER BY` **cannot** guarantee FIFO, because it can only order candidates it
is given, and an earlier obligation may be filtered out of the candidate set by
eligibility:

```
A = older obligation, state 'retrying', next_attempt_at 30 seconds in the future
B = newer obligation, state 'pending',  eligible now
```

A never reaches the `ORDER BY`. B sorts first trivially and is delivered before
A — a strict-ordering violation from a retry delay, **with no concurrency
involved and no constraint violated.**

> **A newer obligation is claimable only when no earlier unresolved obligation
> exists for the same ordered stream.**

| Element           | Definition                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Stream key**    | `(organization_id, integration_connector_id, aggregate_type, aggregate_id)`                                                           |
| **Sequence key**  | `(aggregate_revision, created_at, id)` ascending — see §15.3                                                                          |
| **"Earlier"**     | a sibling whose sequence key sorts strictly before the candidate's                                                                    |
| **"Unresolved"**  | **any non-terminal state**: `pending`, `dispatching`, `retrying`, `ambiguous`. Deliberately **not** "currently eligible", **not** "in-flight" |
| **Non-blocking**  | `accepted` (§17), `acknowledged`, `failed_permanent`, `dead_lettered`, `refused`                                                       |

**Eligibility and blocking are deliberately asymmetric, and that asymmetry is
the point.** A predecessor blocks by *existing unresolved*, not by being
claimable — so a retry delay on A blocks newer B whatever A's `next_attempt_at`
says, and an unresolved ambiguous A likewise blocks later work until authorized
resolution.

| | Partial unique index | Predecessor predicate |
| --- | --- | --- |
| **Guarantees** | mutual exclusion | strict FIFO sequence |
| **Blocking states** | `dispatching`, `ambiguous` | **all** non-terminal |
| **Enforced by** | the database, unconditionally | the claim function |
| **Fails by** | two concurrent dispatches | a newer obligation overtaking an older |

**Because the predicate is function-enforced rather than constraint-enforced,
it requires its own concurrency tests.** The index will not catch a predicate
bug: two obligations claimed in the wrong order never violate exclusivity if
the first is settled before the second is claimed.

### 15.3 Ordering must be causal, not enqueue-time

**`aggregate_revision` leads the sequence key** because it is the aggregate's
own causal sequence and the only field that genuinely orders two mutations of
one aggregate. `created_at` is the tiebreak and `id` the final determinant.

Ordering by `created_at` alone is **rejected**: it is enqueue time, not causal
order, so two mutations enqueued out of causal order would be delivered out of
causal order **while appearing correctly ordered**. No stronger canonical key
exists in the repository — `aggregate_revision` is the only causal field on the
obligation, and source confirms there is no sequence or ordinal column.

**Note the divergence from today:** Migration 53 orders by `created_at, id`
only, which is correct for an unordered connector and insufficient for an
ordered one. F062.2D-2C-3 must order by `aggregate_revision` first.

### 15.4 Isolation level

| Scope                    | May be blocked?                                            |
| ------------------------ | ---------------------------------------------------------- |
| The aggregate itself     | **Yes**, where `requires_ordered_delivery`                 |
| Another aggregate        | **Never**                                                  |
| The connector as a whole | **Never** by one aggregate                                 |
| Another connector, another Organization, the platform | **Never**             |

**No global serialization point is introduced, and none may be.** A
per-connector or per-Organization in-flight cap is a separate concurrency-budget
concern and must not be implemented by narrowing this key. An aggregate on a
connector declaring `supports_ordering = 'none'` is excluded from the index
entirely and blocks nothing at all.

---

## 16. Ordered-key invariant

> **`requires_ordered_delivery = true` implies `aggregate_revision` is
> non-null.**

### 16.1 Stream-identity columns are already non-null

**Verified from source — no new constraint is needed for the index key:**

| Index-key component        | Existing declaration                           | Source                                        |
| -------------------------- | ----------------------------------------------- | --------------------------------------------- |
| `organization_id`          | `uuid not null`                                 | `20261021000000-add-integration-outbox.ts:52` |
| `integration_connector_id` | `uuid not null`                                 | same, `:53`                                   |
| `aggregate_type`           | `varchar(20) not null`, closed to three values  | same, `:63`                                   |
| `aggregate_id`             | `uuid not null`                                 | same, `:65`                                   |

This matters because a unique index treats NULLs as **distinct** by default
(`NULLS DISTINCT`), so a NULL in any key component would let unlimited rows
coexist in one supposedly exclusive stream — silently, with no error. **All four
are already non-null, so the hazard does not apply to the index key, and a
future slice must not relax any of them.**

### 16.2 The missing rule: `aggregate_revision`

`aggregate_revision integer check (aggregate_revision > 0)` is **nullable**
(`:66`), forced non-null only for immutable events by
`check (contract_kind <> 'event' or aggregate_revision is not null)` (`:123`).
`work_item.sync_requested` is the only declared `state_sync` type, so **a
`state_sync` intent may legitimately carry a NULL `aggregate_revision` today.**

It is not in the index key, so it cannot break mutual exclusion. It **is** the
leading component of the sequence key, so a NULL breaks **sequence**:
PostgreSQL sorts NULLs last ascending, placing an unrevisioned intent after
every revisioned sibling regardless of enqueue time, and leaving two
unrevisioned siblings ordered only by the tiebreak.

> **F062.2D-2C-2 must enforce it: conceptually
> `check (requires_ordered_delivery = false or aggregate_revision is not null)`.**

### 16.3 Compatibility impact, stated and not hidden

> **This introduces a NEW ENQUEUE REQUIREMENT on an accepted path: a
> `state_sync` intent destined for a connector declaring
> `supports_ordering = 'per_aggregate'` must carry an `aggregate_revision`, or
> its enqueue is refused.**

That is the correct fail-closed direction — **a caller asking for ordered
delivery must supply the field that defines the order** — but it changes
accepted enqueue behaviour and must be reviewed as such, with regression tests
in F062.2D-2C-2 (§26). The alternative of ordering unrevisioned intents by
`created_at` alone is rejected for §15.3's reason.

---

## 17. `accepted` semantics — resolved

F062.2D-2C-0 §13.1 flagged this as an open judgement call. **It is resolved
here.**

> **For `supports_ordering = 'per_aggregate'`, `accepted` is NON-BLOCKING.**

A successor may be claimed and dispatched while a predecessor is `accepted` —
delivered and externally accepted, but not yet `acknowledged`.

### 17.1 Why

**Because requiring `acknowledged` would permanently block the stream for
connectors that cannot reach it.** `accepted → acknowledged` requires the
pinned snapshot to declare `reports_terminal_state`; a connector that does not
would leave every ordered stream blocked at its first delivery, forever. That
is not strict ordering — it is a deadlock with an ordering justification.

### 17.2 What ordered delivery therefore means

| Ordered delivery **is**                                                      | Ordered delivery is **not**                                                            |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Ordering of **Reqro's external delivery and acceptance operations** for one aggregate | Serialization until the destination finishes all downstream business work        |
| "Reqro will not send mutation N+1 until mutation N has been accepted or has reached a terminal outcome" | "Reqro will not send mutation N+1 until the destination has fully processed mutation N" |

The guarantee is about **Reqro's send order**, which Reqro controls and can
honour. What a destination does internally after accepting is outside Reqro's
observation and therefore outside any guarantee Reqro can truthfully make.

### 17.3 If a future connector needs terminal-completion serialization

> **The current `supports_ordering` capability is insufficient for it, and a
> separate reviewed capability and contract are required.**

Recorded explicitly so that a future connector requiring "do not send N+1 until
N is fully processed downstream" is recognised as needing a **new declared
capability** — not as a reinterpretation of `per_aggregate`, and not as an
implementation detail of the predecessor predicate. Silently extending
`per_aggregate` to mean terminal-completion serialization would change the
delivery semantics of every existing ordered connector.

---

## 18. Retry eligibility — normative

| State                                   | Claimable?                                                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pending`                               | **Yes**, immediately, when all other gates pass                                                                 |
| `retrying`                              | **Only** when the database-owned `next_attempt_at` is **non-null and due** (`<= clock_timestamp()`)             |
| `ambiguous`                             | **Never** ordinary retry-claimable. It leaves `ambiguous` only via the capability-gated `ambiguous → dispatching` edge, `ambiguous → accepted` on reconciliation or read-after-write evidence, or operator disposition |
| `dead_lettered`                         | **Never** ordinary claimable. Only authorized replay, whose audit evidence does not yet exist                    |
| `dispatching` with an open attempt      | **Not independently claimable.** Only recovery semantics (§14) may change ownership                             |
| `accepted`, `acknowledged`, `failed_permanent`, `refused` | **No**                                                                        |

### 18.1 The worker cannot provide a retry time

> **`next_attempt_at` is computed and persisted by the database, in the same
> transaction as the settlement that caused it. The worker has no parameter,
> no hint and no override.**

A `null` `next_attempt_at` means **not scheduled**, never *eligible now* — the
predicate requires a non-null value, so the fail-closed reading is structural.
It is set per settlement, **forward-only**, and never cleared to make an
obligation immediately eligible.

### 18.2 `attempt_number` is evidence, NOT the destination retry budget

> **This distinction did not matter before pre-dispatch recovery existed. It
> matters now, and conflating the two would let a crash-looping worker exhaust
> a destination's retry budget without ever contacting the destination.**

#### `attempt_number` — the final definition

> **`attempt_number` is the immutable, monotonic ordinal of
> delivery-attempt EVIDENCE for one obligation. It counts attempt ROWS, not
> destination interactions.**

| Property       | Value                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Assigned by    | the F062.2D-2A guard, as `max(attempt_number) + 1` per obligation                                   |
| Authority      | database; never caller-supplied                                                                     |
| Mutability     | **immutable** — the settle guard lists it among the fields an UPDATE may not change                    |
| Uniqueness     | `unique (organization_id, integration_outbox_id, attempt_number)`                                   |
| Monotonic      | **always**, across every settlement origin, including pre-dispatch recovery                         |
| Meaning        | "this is the Nth attempt row recorded for this obligation"                                          |
| **NOT**        | **the destination retry-budget counter, and not the backoff exponent input**                        |

Every settlement origin of §6 produces an attempt row and therefore advances
the ordinal. **That is correct and must not change**: the ordinal is the
evidence trail, and a gap in it would mean evidence was discarded, which
F062.1 `mayEraseEvidence()` forbids.

#### A pre-dispatch recovery is evidence of a Reqro event, not a destination attempt

An attempt settled as `outcome = 'failed_transient'`,
`reason_code = 'lease_expired_pre_dispatch'`, `dispatch_started_at IS NULL`
**provably never contacted the destination** (§4.2, §13). It therefore must NOT:

- **consume the destination retry-attempt ceiling**;
- **advance the destination retry or backoff exponent**;
- **be counted as a destination attempt merely because it carries an `attempt_number`.**

Counting it would mean a worker fleet crash-looping before the dispatch
boundary could exhaust a healthy destination's retry budget and dead-letter a
large backlog of perfectly deliverable obligations — **converting a Reqro-side
incident into permanent delivery loss**, which is the same failure mode §19.2
exists to prevent, arriving by a different route.

#### The destination retry count — conceptual definition

> **Destination retry-budget accounting derives ONLY from attempt evidence that
> actually crossed the dispatch boundary and is relevant to the reviewed
> retryable destination policy.**

At minimum that means, conceptually:

| Element                     | Requirement                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| **Crossed the boundary**    | `dispatch_started_at IS NOT NULL`                                                                |
| **Plus destination semantics** | the reviewed outcome and category semantics — a settled attempt whose `failure_category` is one of the approved retryable destination categories (§19) |
| **Excludes**                | every lifecycle-origin settlement, because `failure_category` is NULL for all of them (§6 C, §6 D) |

**No `attempt_count` column is added**, and no final SQL expression is fixed
here. The accounting is derivable from existing attempt evidence plus the two
fields §24.1 adds; a denormalized counter would be able to disagree with the
evidence it counts, which is why F062.2D-0 §12's `attempt_count + 1` sketch
stays superseded.

#### The invariant

> **`max(attempt_number)` ≠ destination retry count, once pre-dispatch recovery
> exists.**

They were numerically equal only while every attempt was a destination attempt.
From F062.2D-2C-1 onward they are **different quantities with different
meanings**, and any code, query, metric or policy that treats the ordinal as
the retry count is wrong by construction. §24 requires this to be tested
directly rather than assumed.

---

## 19. Retryable destination categories

Source confirms the current recommendation; it is preserved and **not
broadened**.

| Category                   | Current outcome rule                     | Automatically schedulable?                                             |
| -------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| `destination_unavailable`  | `failed_transient` permitted             | **YES**                                                                |
| `rate_limited`             | `failed_transient` permitted             | **YES**, with a higher delay floor (§20)                               |
| **`destination_timeout`**  | **`ambiguous` only, enforced**           | **NO** — the side effect may already have occurred                     |
| `destination_rejected`     | `failed_permanent`                       | No — the destination decided                                           |
| `authentication_failed`    | `failed_permanent`                       | No — needs a credential or configuration fix                           |
| `destination_unconfigured` | `failed_permanent`                       | No — configuration error                                               |
| `projection_failed`        | `failed_permanent`                       | No — Reqro could not build the payload; a code or data defect          |
| `contract_unsupported`     | `failed_permanent`                       | No — retrying cannot make a destination support an operation           |
| `malformed_request`        | `failed_permanent`                       | No — identical input produces an identical rejection                   |
| `internal_failure`         | `failed_permanent`                       | **No** — see §19.2                                                     |

**Automatically schedulable set: exactly `destination_unavailable` and
`rate_limited`** — identical to `transientIntegrationFailures`, which is
reaffirmed unchanged.

### 19.1 Ambiguity never becomes an ordinary retry

Four independent controls, **three already implemented**: `failed_transient`
accepts only the two transient categories; `destination_timeout` is accepted
only as `ambiguous`; `ambiguous` is unreachable by the retry predicate (§18);
and `ambiguous → dispatching` is capability-gated in the F062.2D-2A guard.

**A worker therefore cannot relabel an ambiguous timeout as a transient failure
to earn itself a blind retry.** No adapter may introduce a new category, and an
unmapped vendor error must map to the most conservative applicable category
rather than defaulting to a retryable one.

### 19.2 Reqro-owned infrastructure failures

> **A Reqro infrastructure failure is not a destination failure and must never
> be recorded as one, must not consume attempt budget, and must not trip a
> destination circuit breaker.**

The recommended treatment is **prevention, not classification**: a worker
lacking its prerequisites — unresolvable secrets, for example — reports
`worker_readiness = not_ready` and **does not claim**. No claim, no attempt, no
budget consumed. Where a claim was already taken and a prerequisite then fails
before the dispatch boundary, the §14 pre-dispatch path applies honestly,
because `dispatch_started_at` really is NULL.

A circuit breaker, when one exists, must be tripped only by destination
evidence — `destination_unavailable`, `rate_limited`, `destination_timeout`.
Telemetry failure must never fail delivery.

---

## 20. Retry backoff

> **Capped exponential backoff with full jitter. The database computes and
> persists `next_attempt_at`.**

```
base     = min(max_delay, min_delay * 2 ^ (attempts - 1))
delay    = random_between(min_delay, base)        -- full jitter
eligible = clock_timestamp() + delay
```

Full jitter rather than equal jitter, because it is the stronger
de-synchronizer and directly addresses thundering-herd resumption after an
outage. Jitter source: `pg_catalog.random()` — on the pinned path, no extension,
and jitter has no security requirement.

> **`random()` must never generate a claim token.** Claim tokens are
> worker-generated CSPRNG material (§11.1). The two uses must not be confused
> because they share a function name.

**All numerical values remain unresolved and provisional, and none appears in
this contract** (§25). A higher delay floor for `rate_limited` is recommended in
direction only; where a destination supplies a retry-after value, honouring it
is adapter-level **input to an approved policy**, never a
destination-controlled timestamp written into `next_attempt_at`.

### 20.1 Destination retry drives the backoff sequence

> **Only an actual destination attempt consumes destination retry budget and
> advances the destination backoff sequence.**

The currently approved automatic destination-retry categories are preserved
unchanged (§19):

| Category                  | Consumes destination retry budget | Advances the destination backoff exponent |
| ------------------------- | --------------------------------- | ----------------------------------------- |
| `destination_unavailable` | **Yes**                           | **Yes**                                   |
| `rate_limited`            | **Yes**                           | **Yes**, from its own higher floor        |

Both require `dispatch_started_at IS NOT NULL` to be truthful at all — a
destination cannot have been unavailable to a request that was never sent — so
the boundary condition of §18.2 and the category condition agree rather than
competing.

### 20.2 Three independent bounds, plus age

**These are four different quantities. None implies, caps or substitutes for
another, and exhausting any one of them stops automatic processing on its own.**

| Bound                                      | Counts / measures                                                              | Driven by                                        | Owner                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------- |
| **Destination retry attempt ceiling**      | attempts that **crossed the boundary** with an approved retryable destination category | `destination_unavailable`, `rate_limited`        | platform ceiling; connector may lower     |
| **Destination backoff exponent**           | the same set of attempts                                                       | the same categories                              | platform baseline + connector             |
| **Platform pre-dispatch recovery bound**   | **pre-dispatch recoveries** — attempts settled with `lease_expired_pre_dispatch` | Reqro-side lease expiry before the boundary   | **platform only** — never connector          |
| **Pending-age ceiling**                    | eligible age from immutable `created_at`                                        | elapsed time, excluding `disabled` intervals     | F062.2D-1A's owners                       |

### 20.3 The pre-dispatch recovery bound

> **A pre-dispatch recovery must be bounded independently, so a crash-looping
> worker cannot recover the same obligation indefinitely.**

Without such a bound the obligation is not wedged — it is worse: it cycles
forever, generating an unbounded evidence trail, consuming database writes and
destination-free claim capacity, while every destination-facing budget remains
untouched and therefore never trips.

| Property                     | Decision                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Owner**                    | **Platform only.** A pre-dispatch recovery is a Reqro-side event; the destination had no part in it, so a per-connector override would let a deployment tune a bound on Reqro's own fault behaviour |
| **Shape**                    | a bounded recovery count, a recovery horizon, or a reviewed policy combining them — **not decided here**       |
| **Numeric value**            | **NOT CHOSEN.** Recorded as unresolved platform policy (§25 item 12)                                           |
| **New field**                | **NONE added by this amendment.** Whether the bound is derivable from existing evidence — a count of settled attempts carrying `lease_expired_pre_dispatch` — or needs persistence is an implementation question for F062.2D-2C-3 |
| **Distinct from**            | the destination retry attempt ceiling, the destination backoff exponent, **and** the pending-age ceiling    |

**What happens on exhaustion** needs a reviewed decision in F062.2D-2C-3 and is
**not settled here**. The recommended provisional direction, using existing
states only: settle the open attempt, **park the obligation in `retrying` with
`next_attempt_at` NULL** — which §18.1 already defines as *not scheduled* and
therefore not claimable — and surface it for operator disposition. It must
**not** be `dead_lettered` automatically until F062.2A's authorized
`dead_lettered → pending` replay evidence exists (§20.5), and it must not be
left `dispatching` with an open attempt, which is the permanent wedge
F062.2D-2C-0 §33 refuses to make possible.

**Pending age is unaffected by any of this.** It accrues from the immutable
`created_at` regardless of how an obligation's attempts were settled, so a
crash-looping worker does not pause the age clock, and the age ceiling remains
the outermost absolute bound.

### 20.4 Backoff after a pre-dispatch recovery

> **A pre-dispatch recovery MAY schedule a bounded future `next_attempt_at` to
> avoid hot-loop recovery, but it does NOT advance the destination-specific
> exponential-backoff sequence.**

| | Destination transient failure           | Pre-dispatch recovery                        |
| --- | --------------------------------------- | -------------------------------------------- |
| **Writes `next_attempt_at`** | yes                    | **yes** — to avoid an immediate re-claim loop   |
| **Schedule source**          | the pinned destination backoff policy (§20) | a **platform recovery delay policy**   |
| **Advances the destination exponent** | **yes**       | **no**                                       |
| **Consumes destination retry budget** | **yes**       | **no**                                       |
| **Numeric value**            | provisional (§25)                      | **provisional (§25 item 13)**                 |

**One column, two schedule sources.** `next_attempt_at` is written by either
policy, and which policy wrote it is reconstructable from the settling
attempt's `reason_code` — lifecycle-origin settlements carry
`lease_expired_pre_dispatch`, destination-origin settlements carry a
`failure_category`. **No flag column is needed to distinguish them**, and none
should be added: the evidence already says which path produced the schedule.

**No numerical delay is chosen here**, for either policy.

### 20.5 Retry budget remains distinct from pending-age budget

Neither implies, caps or substitutes for the other; exhausting either stops
automatic processing on its own. Both reach **`dead_lettered`** — existing
states only, nothing invented — but must carry distinguishable reasons, or an
operator is told a destination is broken when nothing ever tried.

> **Automatic dead-lettering must not be implemented before F062.2A's
> authorized `dead_lettered → pending` replay evidence exists.**
> `dead_lettered` currently has **no outgoing edge at all**, so automatic entry
> into it would convert a bounded retry policy into permanent delivery loss.
> **Entry and exit must land together, or entry must wait.**

---

## 21. Policy pinning

> **Lease and retry policy must be deterministic and reconstructable for any
> obligation, at any later date.**

### 21.1 The model

- **The schedule comes from the policy pinned at the obligation's `pinned_connector_configuration_revision`.** The connector audit already snapshots the full capability set per revision, and the enqueue guard already refuses an intent that does not pin an existing revision-advancing snapshot.
- **The platform ceiling applies as a strictly-tightening `min` at evaluation time.** A pinned policy can never be widened by a later change, and can always be tightened by the platform.

### 21.2 A semantic policy change must advance `configuration_revision`

`record_revision` exists for semantically inert changes such as credential
rotation. **Retry and lease policy are not inert**, so a change to either must
advance `configuration_revision`, with audit `change_category =
'capabilities_changed'`.

### 21.3 No new pinning field is required

Because the obligation already pins the configuration revision and the audit
already snapshots per revision, policy stored as connector configuration is
**already pinned and already reconstructable** — no `retry_policy_revision`
column and no policy-epoch table. The attempt's
`connector_configuration_revision` records which policy produced each schedule.

### 21.4 Non-retroactive operational tuning, preserved

> **F062.2D-1A's principle is preserved: administrators tuning backoff must not
> silently reinterpret obligations already in flight.** An obligation pinned at
> revision N keeps revision N's schedule for its whole life. A new revision
> applies only to obligations enqueued after it.
>
> **The single exception** is a separately approved platform safety ceiling that
> **tightens** behaviour, which applies immediately and everywhere. Tightening
> is always permitted; widening never is.

---

## 22. Operator authority

> **Worker functions must not expose "force" parameters, override flags,
> privileged modes, or any parameter that changes the authority of the call.**

A flag that elevates behaviour is a flag that can be set, so operator actions
must live in **separate functions** on the operator surface, under a different
principal, with durable evidence — never as a parameter on the worker API.

| The worker must NEVER be able to    | Remains                                   |
| ----------------------------------- | ----------------------------------------- |
| Force recovery of ambiguous work    | trusted operator / PIM, durable evidence  |
| Bypass ordering                     | trusted operator / PIM, durable evidence  |
| Override retry exhaustion           | trusted operator / PIM, durable evidence  |
| Requeue dead-lettered obligations   | trusted operator / PIM, with F062.2A's required same-transaction audit evidence |
| Change a policy epoch               | trusted operator / PIM, durable evidence  |
| Suppress an obligation              | trusted operator / PIM, durable evidence  |

**F062.2D-3 must enforce this by grant**: `EXECUTE` on exactly the four
functions of §10, named individually by full signature, and on nothing else.

An operator may **tighten** retroactively but never **widen** retroactively;
widening must create a new revision applying only to future obligations, or an
explicit individually-bounded authorization whose repetition is cumulatively
bounded so it cannot become an unlimited bypass.

---

## 23. Observability dependency

**No F061 concept is added, changed or implemented here.** F061.3A and F061.3B
own the vocabulary. F062.2D-2C-0's gaps are carried forward unchanged.

### 23.1 Production release gates

| Gate                                 | Status                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| **Active / in-flight claim count**   | **GAP — release gate.** `integration_claim_count` counts claim *events*; nothing reports how many claims are open **now**, so an in-flight leak would be invisible |
| **Expired lease count**              | **GAP — release gate.** Nothing describes leases past expiry awaiting recovery, which is the primary signal that workers are dying |
| **Oldest pending age**               | **Already covered** by F061.3A `integration_oldest_pending_age`, itself already a release gate |

### 23.2 Remaining F061.3C concepts, recorded not implemented

1. **Lease-recovery count, split pre-dispatch versus ambiguous** — the operationally decisive split: pre-dispatch recoveries are cheap, ambiguous ones create human work.
2. **Oldest retry-eligible age** — distinct from oldest *pending* age; the signature of a stalled retry wave.
3. **Retry-exhaustion count** — F061.3B warns dead-letter count is not an age-transition count; budget exhaustion needs its own distinguishable signal.
4. **Ordered-stream blocked count / backlog** — the head-of-line signal.
5. **Ambiguous ordered-stream blockage** — how much *other* work is blocked behind an ambiguity, which is the impact measure.

### 23.3 Label bounds

> **No Organization ID, no connector ID, no aggregate ID, no attempt or outbox
> ID, no hostname, no vendor text, no destination URL.**

All are bounded aggregate counts or ages. Per-tenant attribution belongs in the
queryable delivery record under tenant authorization, never in a metric label;
F061.1's policy owns this and `assertIntegrationLabels` already enforces it.

---

## 24. Exact implementation gates

### 24.1 F062.2D-2C-1 — lease and dispatch-boundary persistence

> **PREREQUISITE: this amendment must be integrated first.**

| Scope item                                     | Detail                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **`claim_expires_at`**                         | on the attempt; database-authored; write-once at claim                                                              |
| **`dispatch_started_at`**                      | on the attempt; nullable; **write-once, NULL → non-NULL only**                                                      |
| **Bounded `reason_code`**                      | on the attempt; `varchar(40)`; closed `CHECK` over **exactly** `lease_expired_pre_dispatch` and `lease_expired_uncertain` (§8.2) |
| **The F062.1 TypeScript authority**            | **MANDATORY in the same slice** (§8). F062.2D-2A's deferral condition is that `reason_code` arrives *with* its TS source, plus the set-equality test |
| **Amended attempt settlement constraints**     | Replace line 122; implement §6's four shapes and §6.3's rejections, including the `dispatch_started_at` cross-check  |
| **Recovery scan support**                      | A partial index for the recovery scan, `where completed_at is null`                                                  |
| **Guard extension**                            | The F062.2D-2A settle guard must permit the marker NULL → non-NULL once, and `reason_code` write-once at settle, while keeping every existing immutability rule |

**No worker or function runtime change** unless strictly required by integrity.
The existing two functions continue to work: they write no `reason_code`, and
the amended constraints must leave their current behaviour valid.

### 24.2 F062.2D-2C-2 — ordered-stream and retry-eligibility persistence

| Scope item                              | Detail                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| **`next_attempt_at`**                   | on the obligation; nullable; non-null only while `retrying`; partial index `where state = 'retrying'` |
| **`requires_ordered_delivery`**         | on the obligation; `not null`; **pinned at enqueue** from the pinned snapshot's `supports_ordering`; immutable |
| **Ordered aggregate revision constraint** | §16.2's `CHECK`. **A new enqueue requirement on an accepted path** (§16.3)                 |
| **Partial unique serialization index**  | §15.1                                                                                        |
| **Outbox guard updates**                | Assign `requires_ordered_delivery` at enqueue; permit `next_attempt_at` to change on a state transition, while keeping every other field immutable |

### 24.3 F062.2D-2C-3 — function API

| Scope item                                   | Detail                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Enhance `claim_integration_intent`**       | `retrying` eligibility with the retry clock; ordered-stream gating; `aggregate_revision`-first ordering; lease assignment; pending-age gating. **Signature unchanged** (§11) |
| **Enhance `complete_integration_attempt`**   | §6 combination validation; `next_attempt_at` computation; attempt ceiling and horizon. **Signature unchanged** |
| **Add `mark_integration_dispatch_started`**  | §13                                                                                                     |
| **Add `recover_expired_integration_claim`**  | §14. No duration, interval, timeout or force parameter                                                   |
| **Strict FIFO predecessor predicate**        | §15.2, **with its own concurrency tests** — the index will not catch a predicate bug                     |
| **Retry scheduling and backoff**             | §20, inside the settling transaction                                                                     |
| **Concurrency tests**                        | Claim races, the recovery/completion race (§12.2) in both orders, ordered-stream exclusion and FIFO, stale-claimant fencing |
| **Retry-budget separation tests**            | The five assertions of §24.4, which are the executable form of §18.2 and §20                                                 |

### 24.4 Mandatory retry-budget separation tests — 2C-2 and 2C-3

**The §18.2 invariant is the kind that silently stops holding, so it must be
asserted directly rather than inferred from the absence of failures.** All five
are required before F062.2D-3:

| # | Assertion                                                                                                   | Slice |
| - | ----------------------------------------------------------------------------------------------------------- | ----- |
| 1 | **A pre-dispatch lease recovery does NOT consume destination retry budget** — the destination retry count is unchanged across one, and an obligation at the ceiling minus one does not become exhausted by a recovery | 2C-3  |
| 2 | **A pre-dispatch recovery does NOT increase the destination retry exponent** — the delay scheduled after N recoveries equals the delay scheduled after zero, under the platform recovery policy rather than the destination curve | 2C-3  |
| 3 | **An actual retryable destination failure DOES consume budget and DOES advance the exponent** — the positive half, so test 1 cannot pass vacuously by nothing counting at all | 2C-3  |
| 4 | **`attempt_number` remains monotonic across both origins** — a sequence mixing destination failures and pre-dispatch recoveries yields a gapless ordinal, with `max(attempt_number)` **≠** the destination retry count | 2C-2, 2C-3 |
| 5 | **Repeated pre-dispatch recoveries are nevertheless bounded** by the separate platform recovery policy, and the obligation stops being automatically recovered on exhaustion (§20.3) | 2C-3  |

**Test 3 is what makes test 1 meaningful**, and test 4's inequality is the
contract's observable signature: a build in which the ordinal and the retry
count are still equal after a pre-dispatch recovery has lost the distinction.

### 24.5 F062.2D-3 — worker identity and grants

> **STILL BLOCKED.** It requires F062.2D-2C-1, 2C-2 and 2C-3 all accepted,
> **and** the two mandatory observability gates of §23.1 accepted.

Granting `EXECUTE` before then would hand a worker authority over an API that
cannot express these safety rules: a worker that claims and dies would **wedge
the obligation permanently**, a `failed_transient` settlement would reach
`retrying` and be **never claimable again**, ordering would be silently
violated, and a rate-limited destination would face a retry storm. **Three of
those are permanent wedges.**

F062.2D-3 must additionally state §13.4's worker protocol obligation as an
explicit contract.

---

## 25. Unresolved numerical values

**No value is chosen here, and none appears anywhere in this contract.**

| # | Value                                       | Owner                                            |
| - | ------------------------------------------- | ------------------------------------------------ |
| 1 | Platform default lease duration             | Reqro platform, security and operations          |
| 2 | Per-connector lease overrides               | Deployment / client operations, within the ceiling |
| 3 | **Lease floor** (total request budget)      | **Platform, non-overridable**                    |
| 4 | Minimum retry delay                         | Platform baseline; connector may raise           |
| 5 | Maximum retry delay (cap)                   | Platform ceiling; connector may lower            |
| 6 | Retry attempt ceiling                       | Platform ceiling; connector may lower            |
| 7 | Maximum retry horizon                       | Platform ceiling; must be `<=` the pending-age ceiling |
| 8 | `rate_limited` delay floor                  | Platform baseline, informed by published destination limits |
| 9 | Recovery batch size and scan frequency      | Platform operations                              |
| 10 | Pending-age platform ceiling                | F062.2D-1A's owners — platform, legal, product, connector |
| 11 | Cumulative renewal bound, **if** renewal is ever adopted | Platform; renewal is currently deferred |
| 12 | **Pre-dispatch recovery bound** — count, horizon, or a reviewed combination (§20.3) | **Platform only** — never connector |
| 13 | **Platform recovery delay** applied after a pre-dispatch recovery (§20.4) | **Platform only** — never connector, and never the destination backoff curve |

**The lease floor is a security control, not a tuning preference.** A lease
shorter than the total request budget fences a live worker mid-call, recovery
marks a healthy delivery ambiguous, and a capability permitting retry then
produces a genuine duplicate from an entirely healthy dispatch. The total
request budget must be **strictly less** than the lease.

> **These may be measured in F062.2D-4 against the loopback adapter and in UAT
> before production.** Until then every value is provisional, and
> "unlimited" must remain unreachable by configuration: unset inherits downward
> to a finite platform ceiling.

### 25.1 Open policy questions, not numbers

| # | Question                                                                                        | Provisional direction                                            |
| - | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1 | ~~Do **pre-dispatch** recoveries consume the attempt budget?~~ **RESOLVED by §18.2 and §20.3** | **No.** They consume no destination retry budget and advance no destination exponent, and are bounded by a separate platform recovery policy |
| 1a | What is the **outcome when the pre-dispatch recovery bound is exhausted**? (§20.3)              | Provisionally: settle the attempt and park the obligation in `retrying` with `next_attempt_at` NULL, for operator disposition. **Owed a decision in 2C-3** |
| 2 | Does an ordered stream stay blocked when its ambiguous obligation is dead-lettered for age?      | **Yes**, until explicit operator release — the uncertainty is unchanged |
| 3 | Should `retired` dead-letter outstanding obligations immediately?                                | Open — a data-retention and operator-authority question          |
| 4 | Should automatic `ambiguous → dispatching` additionally require `side_effect_risk <> 'physical'`? | **Yes** — recommended as a tightening of existing edge policy    |

---

## 26. Compatibility and migration impacts

**Every item below changes accepted behaviour and must receive regression tests
in the implementing slice.** None may be introduced quietly.

| # | Impact                                                                                      | Slice      | Required regression evidence                                                                                                  |
| - | ------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1 | **Ordered `state_sync` now requires `aggregate_revision`** (§16.3)                          | 2C-2       | Enqueue refused for an ordered connector without a revision; **still accepted** for `supports_ordering = 'none'`; existing event enqueue unaffected |
| 2 | **`failed_transient` combination rules change** (§6.2)                                      | 2C-1       | The two destination categories still accepted; NULL category accepted **only** with `lease_expired_pre_dispatch`; every §6.3 row refused |
| 3 | **`reason_code` becomes durable**                                                           | 2C-1       | Closed `CHECK` set-equality with the F062.1 constant in both directions; free text, vendor text and out-of-set values refused; write-once at settle |
| 4 | **Recovery may produce `retrying` with no destination `failure_category`**                   | 2C-1, 2C-3 | A recovered obligation reaches `retrying` with NULL category; metrics do **not** attribute a destination failure; the `dispatch_started_at` cross-check refuses the reason on a marked attempt |
| 5 | **`accepted` is explicitly non-blocking for ordered delivery** (§17)                        | 2C-3       | A successor claimable while its predecessor is `accepted`; **not** claimable while the predecessor is `pending`, `dispatching`, `retrying` or `ambiguous` |
| 6 | **The attempt settle guard admits two new write-once fields**                                | 2C-1       | Marker NULL → non-NULL once, second write refused; `reason_code` write-once; **every existing immutability rule still enforced** |
| 7 | **Line 122 is replaced**                                                                     | 2C-1       | Existing adapter-shaped settlements (§6 A, B) remain valid and unchanged — the amendment must not invalidate currently-legal rows |
| 8 | **Claim ordering changes to `aggregate_revision` first**                                     | 2C-3       | Unordered connectors behave as today; ordered connectors deliver in causal order                                               |
| 9 | **`max(attempt_number)` ceases to equal the destination retry count** (§18.2)               | 2C-2, 2C-3 | The five assertions of §24.4. Any existing query, metric or policy reading the ordinal as a retry count must be found and corrected |
| 10 | **`next_attempt_at` acquires a second schedule source** — the platform recovery delay (§20.4) | 2C-3    | A recovery-scheduled retry is distinguishable from a destination-scheduled one by the settling attempt's `reason_code`, with **no new flag column** |

**Item 7 deserves emphasis:** the constraint replacement must be proven
*non-regressive* for the settlements that are legal today, not merely permissive
for the new ones. The existing 22-test worker-function suite and the 72-test
persistence suites are the baseline that must still pass unchanged.

---

## Related

- [F062.1 — Enterprise integration contracts foundation](F062-1-integration-contracts-foundation.md) — the four outcomes, ten categories, nine states, transition graph and two transient categories this amendment reaffirms; §8 specifies the amendment it needs
- [F062.2A — Transactional outbox persistence readiness](F062-2A-transactional-outbox-persistence-readiness.md) — §8.1's `reason_code` taxonomy, whose Worker group this amendment extends by one value and whose category pairing §7 makes partial
- [F062.2C — Transactional outbox and atomic enqueue](F062-2C-transactional-outbox-atomic-enqueue.md) — the enqueue guard that must assign `requires_ordered_delivery`, and the non-null stream-identity columns of §16.1
- [F062.2D-0 — Delivery worker security and operational readiness](F062-2D-0-delivery-worker-security-readiness.md) — the ambiguous-recovery contract and the lease-versus-request-budget rule; §11 supersedes its claim-signature sketch
- [F062.2D-1 — Worker identity and database function security decision](F062-2D-1-worker-identity-db-function-security-decision.md) — the function-security model; §9 and §10 amend its `search_path` recommendation and three-function inventory
- [F062.2D-1A — Pending age, expiry and dead-letter policy](F062-2D-1A-pending-age-dead-letter-policy.md) — the pending-age clock, `min` precedence, non-retroactive tuning and the convergence test, all preserved
- [F062.2D-2A — Delivery attempt and fencing persistence](F062-2D-2A-delivery-attempt-fencing-persistence.md) — the attempt table and immutability guards every proposal here extends rather than relaxes, and the `reason_code` deferral condition §24.1 honours
- [F062.2D-2B — Worker claim and completion database function API](F062-2D-2B-worker-database-function-api.md) — the two implemented functions, the tested `CREATE`-denial invariant of §9.2, and the fencing already proven
- [F062.2D-2C-0 — Worker execution semantics decision](F062-2D-2C-0-worker-execution-semantics-decision.md) — the design decisions this amendment makes contractual
- [F061.3A — Integration worker observability contracts](F061-3A-integration-worker-observability-contracts.md) — the existing worker metric and health vocabulary §23 maps onto
- [F061.3B — Age and dead-letter observability contracts](F061-3B-age-dead-letter-observability-contracts.md) — why dead-letter count must not be read as an age-transition count
- [ADR-024 — Transaction-time request authorization](../architecture/decisions/ADR-024-transaction-time-request-authorization.md) — the uncertain-result rule forbidding automatic retry after an ambiguous outcome
- [ADR-027 — Platform operator bootstrap and recovery](../architecture/decisions/ADR-027-platform-operator-bootstrap-recovery.md) — the trusted operator architecture §22 reuses conceptually
