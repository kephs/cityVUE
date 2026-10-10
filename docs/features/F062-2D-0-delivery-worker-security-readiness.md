# F062.2D-0 — Delivery worker security and operational readiness

Baseline `5552ec61562a25399df8c507ca8e14928e5cc1b0` (authoritative `main`, carrying [F062.1 contracts](F062-1-integration-contracts-foundation.md), [F062.2A readiness](F062-2A-transactional-outbox-persistence-readiness.md), [F062.2B connector metadata](F062-2B-connector-metadata-persistence-foundation.md), [F062.2C outbox and atomic enqueue](F062-2C-transactional-outbox-atomic-enqueue.md), and F061's [tracing](F061-2A-opentelemetry-request-tracing-foundation.md) and [request-metrics](F061-2B-safe-http-request-metrics-foundation.md) foundations).

> **NO EXTERNAL DELIVERY IS ENABLED BY THIS SLICE.** Assessment only.

**Status: assessment only.** No worker, no migration (count remains **51**), no grant change, no network client, no queue or broker, no vendor connector, no credential or secret resolution, no infrastructure, no ADR number. Nothing outside this document is modified.

Every statement about current behaviour below was read from source at this commit, and the measurements are given so a reviewer can re-derive them.

---

## 1. Baseline, read from source

| Fact                                 | Value                                                                                                                                                                   | Where                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Migration count                      | **51**                                                                                                                                                                  | `server/migrations/*.ts`                                      |
| Ordinal 50                           | F062.2B connector metadata                                                                                                                                              | `20261020000000-add-integration-connector-registry.ts` header |
| Ordinal 51                           | F062.2C integration outbox                                                                                                                                              | `20261021000000-add-integration-outbox.ts` header             |
| Database roles                       | `reqro_owner`, `reqro_migrate`, `reqro_runtime`, `reqro_operator`, `reqro_production`                                                                                   | `deploy/database/bootstrap-roles.sql`                         |
| Runtime grants                       | **76 grant statements, and exactly 0 on any `integration_*` table**                                                                                                     | `deploy/database/runtime-role.sql`                            |
| Operator grants                      | **7**, all scoped to the `tenant_domain` family                                                                                                                         | `deploy/database/operator-role.sql`                           |
| Default privileges                   | **none** for any role — a new table is unreachable until granted deliberately                                                                                           | `bootstrap-roles.sql`                                         |
| Outbox mutability                    | guard raises on **every** UPDATE, DELETE and TRUNCATE                                                                                                                   | `guard_integration_outbox()`                                  |
| Outbox state                         | pinned by `constraint integration_outbox_state_inert check (state = 'pending')`                                                                                         | migration 51, line 143                                        |
| Attempt table                        | **does not exist**                                                                                                                                                      | no `integration_delivery_attempt` anywhere                    |
| F061 metric concepts for integration | **5**: `integration_delivery_latency`, `integration_retry_count`, `integration_dead_letter_count`, `integration_reconciliation_failure`, `integration_connector_health` | `telemetry-contracts.ts`                                      |
| F061 `healthSignal` values           | **3**: `liveness`, `database_readiness`, `hostname_readiness`                                                                                                           | `telemetry-contracts.ts`                                      |
| F061 metrics runtime                 | private `MeterProvider`, **no global registration, no detectors, no exporters**; readers injected only in tests; `validateMetricLabels` is the sole label authority     | `request-metrics.ts`                                          |
| F061 restricted attributes           | `organizationId`, `customerHostname`, `tenantHostname`, `connectorId`, `operatorIdentity`, `entraObjectId` — `metricLabels: 'forbidden'`                                | `telemetry-contracts.ts`                                      |

**The consequence of row 5 is the central operational fact of this assessment:** `reqro_runtime` currently holds _nothing_ on `integration_connector`, `integration_connector_audit` or `integration_outbox`. No enqueue and no dispatch is possible today by privilege alone, independently of whether code exists. That is the correct fail-closed state, and it is why the worker-identity decision can be made before any code is written.

---

## 2. Worker database identity — the decisive blocker

### The models

|                          | Model A — dedicated principal                                                                                                                                                        | Model B — `reqro_runtime` + SECURITY DEFINER                       | Model C — split pools, one process                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Shape                    | `reqro_integration_worker` login, out-of-process worker                                                                                                                              | in-process worker, narrow functions                                | one process, two connection pools authenticating as different logins |
| **Principal separation** | **Yes.** `session_user` distinguishes dispatch from API                                                                                                                              | **No.** Same login; `session_user` cannot tell them apart          | Partial: two principals, one process                                 |
| Least privilege          | Yes, per function                                                                                                                                                                    | SQL surface narrowed, but the API path can call the same functions | Yes, per pool                                                        |
| Auditability             | Yes — DB-level attribution of every delivery write                                                                                                                                   | **No DB-level attribution** of who wrote what                      | Yes at the DB, ambiguous at the process                              |
| Credential lifecycle     | Third login secret to manage and rotate                                                                                                                                              | None added                                                         | Third login secret, plus pool-confusion risk                         |
| Blast radius             | API compromise cannot mark deliveries; worker compromise cannot write business tables                                                                                                | **API compromise inherits the worker's authority**                 | Depends entirely on the application never borrowing the other pool   |
| Operational complexity   | New deployment unit                                                                                                                                                                  | Lowest                                                             | Low infrastructure, subtle application risk                          |
| Entra / PG auth          | Compatible — Azure Flexible Server maps an Entra principal per role, and F060.3C-2e-2A already established that `pgaadauth_create_principal_with_oid` accepts an arbitrary role name | Compatible                                                         | Compatible, two tokens in one process                                |
| Deployment-per-tenant    | Fits: one worker per tenant deployment                                                                                                                                               | Fits                                                               | Fits                                                                 |

### The recommendation

> **Model A, with its writes mediated by reviewed SECURITY DEFINER functions.** Not A _or_ B — the two solve different problems and only the combination solves both.

- **Model A supplies what B cannot.** F062.2A §19.1 recorded it and inspection confirms it: SECURITY DEFINER narrows the _SQL surface_ but does not create a _principal_. Under Model B the API and the worker are one `session_user`, so "the application cannot mark a delivery accepted" is false, and no audit can attribute a delivery write. The privileges the worker needs — UPDATE on `integration_outbox` and INSERT+UPDATE on the attempt table — are **exactly** the privileges the application must never hold, which is the clearest possible signal that they belong to a different principal.
- **The function mediation supplies what A alone cannot.** A dedicated login holding raw table UPDATE could still write any transition, so the state machine would live in application code. Behind `claim_integration_intent(...)`, `record_integration_attempt(...)` and `settle_integration_attempt(...)`, the only reachable transitions are the whitelisted ones, and the fencing predicate cannot be forgotten at a call site.

**Model C is not recommended**, though it is worth recording rather than dismissing: it obtains two principals without a second deployment unit, but its entire guarantee rests on application code never borrowing the worker's pool — a property no database constraint can enforce and no test can prove for all future code paths. That is the kind of invariant this repository has consistently chosen to make structural instead.

### Required hardening for every worker function

A SECURITY DEFINER function is a privilege boundary, and an unhardened one is a
privilege escalation. Each of the following is mandatory, and each closes a
specific, known failure:

| Requirement                                                                                                        | What it closes                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owned by a dedicated non-login privileged function-owner role**                                                  | Owning them as `reqro_owner` would make every function run with authority over the whole schema, including tables the worker has no business touching. A narrow non-login owner bounds what a definer-rights function _can_ do even if its body is wrong. The role never logs in, so it cannot be used directly |
| **Fully-qualified object names throughout the body**                                                               | An unqualified name is resolved through `search_path` at execution time, so a relation or composite type earlier in the path can hijack it. Migration 48 and 49 already qualify every application object for this reason                                                                                        |
| **A controlled, pinned `search_path`** (`SET search_path = <app schema>, pg_temp` at minimum, with `pg_temp` last) | Without it the caller chooses resolution order. PostgreSQL never searches `pg_temp` for function or operator names, so the residual exposure is relations and composite types — which qualification closes, and pinning closes again                                                                            |
| **`REVOKE EXECUTE ... FROM PUBLIC` on every function**                                                             | PUBLIC EXECUTE on a definer-rights function hands its authority to every role in the cluster. The default grant is PUBLIC, so this must be explicit rather than assumed                                                                                                                                         |
| **`GRANT EXECUTE` only to the approved worker principal**                                                          | The whole point of §2's model. One principal, named                                                                                                                                                                                                                                                             |
| **No caller-controlled dynamic SQL and no caller-controlled object names**                                         | Any `EXECUTE format(...)` interpolating a caller value inside a definer-rights function is an injection boundary with owner privileges behind it. Parameters are values only; identifiers are literals in the function source                                                                                   |
| **Return only the bounded data the caller needs**                                                                  | A function returning `SETOF integration_outbox` leaks every column to a principal that needs a handful. Return an explicit narrow row type, and never the raw `claim_token` (§5)                                                                                                                                |

> **`reqro_runtime` must not receive these mutation capabilities, implicitly or
> otherwise.** That means three things concretely: no `GRANT EXECUTE` to
> `reqro_runtime` on any worker function; no PUBLIC EXECUTE that would reach it
> by default; and no membership path from `reqro_runtime` into the worker
> principal or the function owner. The bootstrap's fail-closed block already
> refuses unexpected role memberships and asserts that no role inherits
> silently, so the topology check extends naturally to cover the two new roles.

Migration 49's measured trap applies directly: **a plpgsql call to another
function is permission-checked against the effective user**, so every callee of
a hardened function must be hardened too. Migration 49 recorded that hardening
`advance_access_revision` alone was _not_ sufficient — its caller had to be
hardened as well — and the same will hold for any helper a worker function
calls.

**No role and no grant is created by this slice.**

---

## 3. Minimum future database privileges

Stated as function EXECUTE, which follows from §2. Table privileges are listed only to show what each function needs internally as the owner.

| Function                                                                    | Worker holds | Internal need                                                                                 | Purpose                                                                                                                                            |
| --------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claim_integration_intent(connector, lease, worker_label)`                  | EXECUTE      | SELECT + UPDATE on `integration_outbox`; SELECT on `integration_connector`; INSERT on attempt | Discover one eligible intent, validate connector eligibility, advance `claim_generation`, mint `claim_token`, set the lease, open attempt evidence |
| `settle_integration_attempt(outbox, token, generation, outcome, reason, …)` | EXECUTE      | UPDATE on attempt; UPDATE on `integration_outbox`                                             | Settle that exact attempt under fencing and transition the outbox row                                                                              |
| `read_pinned_connector_semantics(connector, configuration_revision)`        | EXECUTE      | SELECT on `integration_connector_audit`                                                       | The pinned capability snapshot and the current `credential_reference`                                                                              |
| `recover_expired_integration_claims(limit)`                                 | EXECUTE      | UPDATE on both                                                                                | Settle expired leases to `ambiguous`                                                                                                               |

**Explicitly withheld, and each for a reason:**

- **no arbitrary UPDATE on any `integration_*` table** — the state machine would move into application code;
- **no DELETE or TRUNCATE on anything** — F062.1 `mayEraseEvidence()` returns `false` for every state, and retention is a separate privileged operation (F062.2A §17.1);
- **no migration authority** — `reqro_migrate` is a distinct login that must `SET ROLE`, and nothing else may create objects;
- **no tenant-domain operator authority** — the operator surface is 7 grants over an unrelated family;
- **no business-table writes of any kind** — a delivery worker has no reason to touch `service_request`, `answer`, `attachment` or any resident data, and the outbox exists precisely so it does not need to;
- **no connector administration** — the worker _reads_ connector semantics and never changes lifecycle, capabilities or `credential_reference`.

One measured caveat: **`SELECT ... FOR UPDATE`/`FOR SHARE` requires UPDATE privilege on at least one column of the locked table** (Migration 49). Keeping the locks inside owner-executed functions is what stops that requirement leaking out as a table grant — the same technique Migration 49 used for six reference tables.

---

## 4. Future `integration_delivery_attempt`

Designed, **not created**. F062.2A's correction stands: **the row exists before the network call**, because an attempt row written only on completion records nothing about a dispatch that never returned.

| Column                             | Set at   | Notes                                                                                                                                                    |
| ---------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                               | claim    |                                                                                                                                                          |
| `organization_id`                  | claim    | immutable                                                                                                                                                |
| `integration_outbox_id`            | claim    | composite FK `(organization_id, integration_outbox_id)` → the `unique (organization_id, id)` F062.2C already exposes                                     |
| `integration_connector_id`         | claim    | composite FK; retired-connector evidence must stay attributable                                                                                          |
| `attempt_number`                   | claim    | `unique (organization_id, integration_outbox_id, attempt_number)`                                                                                        |
| `claim_generation`                 | claim    | the fencing generation this attempt belongs to                                                                                                           |
| `claim_token_digest`               | claim    | **a digest, not the token** — see below                                                                                                                  |
| `connector_configuration_revision` | claim    | the pinned semantic revision in force for _this_ attempt                                                                                                 |
| `capability_snapshot`              | claim    | bounded JSONB: `supports_idempotency_key`, `supports_read_after_write`, `side_effect_risk`, validated by check to those keys and their closed value sets |
| `started_at`                       | claim    | before any network activity                                                                                                                              |
| `outcome`                          | settle   | F062.1 `attemptOutcomes`; **null while open**                                                                                                            |
| `failure_category`                 | settle   | F062.1 `integrationFailureCategories`                                                                                                                    |
| `reason_code`                      | settle   | the closed Reqro taxonomy of F062.2A §8.1                                                                                                                |
| `response_classification`          | settle   | closed: `accepted`, `rejected`, `no_response`, `transport_error`, `unparseable`                                                                          |
| `retry_eligible`                   | settle   | the decision as evaluated then, retained rather than recomputed from a policy that may since have changed                                                |
| `external_reference`               | settle   | only where safe; `check (external_reference is null or outcome in ('succeeded','ambiguous'))`                                                            |
| `idempotency_key_hash`             | settle   | proof a key was used, without the key                                                                                                                    |
| `completed_at`, `duration_ms`      | settle   | `check (completed_at is null or completed_at >= started_at)`                                                                                             |
| `observed_at`, `mutation_txid`     | database | the established evidence columns                                                                                                                         |

**`claim_token_digest` rather than the token.** F062.2A proposed storing
`claim_token`; on reflection the digest is strictly better and costs nothing.
The token is a **bearer value**: whoever holds it can settle the attempt.
Storing it in a row that an operator read surface will eventually expose turns a
read permission into a settle capability. A digest proves ownership on
comparison while leaking no usable value, and the fencing predicate works
identically.

The full specification, since a weak token would quietly void the whole fencing
model:

| Property                            | Requirement                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Generation**                      | A **CSPRNG** — `crypto.randomUUID()` or `crypto.randomBytes`, never `Math.random`, never a counter, never a timestamp, and never derived from the outbox or attempt identity. A guessable token means an attacker — or a buggy replica — can settle an attempt it does not own |
| **Entropy**                         | High-entropy raw value, at least 128 bits                                                                                                                                                                                                                                      |
| **Raw value lifetime**              | **Worker process memory only**, for the duration of one dispatch. It is issued by the claim function, held for the settle call, and discarded                                                                                                                                  |
| **Storage**                         | PostgreSQL stores **only a cryptographic digest**. The raw token is never a column, in the outbox or the attempt table                                                                                                                                                         |
| **Never anywhere else**             | Not logged, not traced, not a metric label, not persisted outside the digest, **never in a URL or query string**, and never in an error message. F061's `forbiddenAttributes` already covers `token`, which makes the telemetry side structural rather than conventional       |
| **Binding**                         | The digest is bound to the **attempt, the outbox row and the `claim_generation`** together. A token valid for one attempt is useless for another, and useless for a later generation of the same row                                                                           |
| **Restart cannot recreate a claim** | Because the token is random rather than derived, a restarted worker cannot reconstruct a former claim's token even knowing every identifier involved. There is deliberately no deterministic path from `(outbox_id, attempt_number, generation)` to a token                    |
| **Abandoned claims**                | Recovered under the **ambiguous-state contract** of §5 and §19: the existing open attempt is settled as `ambiguous` with `reason_code = 'lease_expired_uncertain'`, the token is cleared, and the outbox moves to `ambiguous` — **never silently back to `pending`**           |
| **Comparison**                      | Constant-time digest comparison where performed in application code. Where the comparison happens inside the claim/settle functions as a SQL predicate, the database performs it and no token crosses back out                                                                 |

**Open → settled is the only ordinary mutation**, enforced by a complete-once guard rather than the plain append-only trigger: INSERT must be open; UPDATE is permitted only as open → settled and only under a matching `claim_generation`; **UPDATE of a settled row raises**; DELETE and TRUNCATE raise. Plus the structural one-open-attempt rule:

```sql
create unique index integration_attempt_open
  on integration_delivery_attempt (organization_id, integration_outbox_id)
  where completed_at is null;
```

That index is what makes "settle the existing attempt" the _only_ reachable recovery: inventing a second open attempt becomes a constraint violation rather than a judgement call.

**Never stored:** raw response body, unrestricted vendor error text, vendor status token, secret, token, or any free-text column.

---

## 5. Claim and fencing algorithm

`SELECT ... FOR UPDATE SKIP LOCKED` is recommended and is a **new pattern** here — it appears nowhere in the 51 existing migrations, so it must be introduced deliberately with its own tests rather than assumed.

**Transaction 1 — claim and open evidence** (short, no network):

1. select one eligible row for one connector `for update skip locked`, where `state in ('pending','retrying')`, `next_attempt_at` has elapsed, no in-flight row exists for that ordered aggregate stream, and the pending-age ceiling is not exceeded;
2. validate connector eligibility **now**: `mayDispatch(lifecycle_state)` is true (`active` or `degraded` only);
3. `claim_generation = claim_generation + 1`, fresh opaque `claim_token`, `claimed_by`, `claimed_until = clock_timestamp() + lease`, `attempt_count + 1`, `state = 'dispatching'`;
4. insert the **open** attempt row binding organization, outbox, attempt number, generation, token digest, pinned revision, capability snapshot and `started_at`;
5. commit, returning the token to the worker in memory only.

**Network call — outside every database transaction.** A row lock must never span a network call, or a slow destination becomes a database incident.

**Transaction 2 — settle** (short), both statements carrying the ownership predicate:

```sql
update integration_delivery_attempt
   set outcome = :outcome, …, completed_at = clock_timestamp()
 where organization_id = :org and integration_outbox_id = :id
   and claim_generation = :generation
   and claim_token_digest = digest(:token)
   and completed_at is null;

update integration_outbox
   set state = :next, claim_token = null, claimed_by = null, claimed_until = null
 where organization_id = :org and id = :id
   and claim_generation = :generation and claim_token = :token
   and state = 'dispatching';
```

**A stale worker's statements match zero rows each**, for two independent reasons: its token was cleared or replaced when the row was recovered, and the attempt it opened was already settled, so `completed_at is null` is false. It therefore cannot mutate the outbox and cannot overwrite a newer result — and the complete-once guard raises even for a statement without the predicate. If either statement does not report exactly one row, the transaction must abort rather than commit a partial settlement: evidence and state move together or not at all. Zero rows is a signal, not a no-op; the worker records a fenced completion in its own telemetry and discards its outcome without retrying.

**Recovery:** a row left `dispatching` past `claimed_until` settles its existing open attempt as `outcome = 'ambiguous'`, `reason_code = 'lease_expired_uncertain'`, and sets the outbox to `ambiguous` — **never silently to `pending`**. The attempt may already have reached the destination, and ADR-024 already forbids automatically retrying after an uncertain result. Only where the capabilities **pinned for that dispatch** declare `supportsIdempotencyKey` may the outbox then become `retrying`, and even then the ambiguous attempt is settled first, because that is what happened; the retry is a new attempt with the next number.

**No exactly-once external execution is claimed.** Delivery is at-least-once with idempotent processing. Fencing protects Reqro's _record_; it cannot un-send a request.

---

## 6. Lease duration

**Recommendation: connector-configuration-scoped, with a platform ceiling.** Not global, because a destination's realistic worst-case response time is a property of that destination; not per-operation-class in the first implementation, because no connector yet distinguishes operation classes and inventing the dimension now would be guessing.

The lease must exceed the sum of what a dispatch can legitimately take, or a live worker is fenced mid-call and a healthy delivery is recorded as ambiguous:

```text
lease  >  connection timeout + response timeout + processing overhead
          + clock-skew allowance + a safety margin
```

- **Clock skew matters and is often forgotten.** `claimed_until` is written and compared with `clock_timestamp()` **by the database**, so all comparisons happen on one clock and the skew allowance covers only recovery scheduling, not the comparison itself. Keeping the comparison database-side is deliberate for exactly this reason.
- **Crash detection is the opposing pressure:** a longer lease means a crashed worker's intent waits longer before recovery. The lease is therefore a _detection-latency versus false-fencing_ trade, and the honest resolution is to make it configurable per connector rather than pick one number for all destinations.

| Value               | Status                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Platform ceiling    | **provisional** — must be bounded, and must be smaller than the pending-age ceiling         |
| Per-connector lease | **provisional**, defaulting to the ceiling until a connector's real timeout budget is known |
| Floor               | **provisional** — must exceed the total request budget of §17                               |

**No final production number is proposed.** Every value here is provisional until the first connector's actual API contract is reviewed, and the schema should store the lease as a bounded connector configuration value rather than a constant in code.

---

## 7. Maximum pending age

### What it means

An intent whose business usefulness has decayed past the point where dispatching it automatically is responsible. The question is not "is the destination reachable" but "would sending this now be correct?"

The two kinds decay differently, which is the key observation:

- **A `state_sync` intent is self-superseding.** It asks a destination to converge on current approved state. An old one is not _wrong_, it is _redundant_ — a newer intent for the same aggregate expresses the same desire better. Age matters mainly because dispatching a long queue of superseded convergence requests wastes the destination's capacity.
- **An `event` asserts something happened.** An old one is not redundant; it is a late notification of a real fact, and suppressing it silently loses information a destination may be legally expected to hold.

That difference argues against one global duration and for a **per-contract-kind, connector-configurable ceiling with a platform maximum.**

### Who owns the decision

| Aspect                                                                 | Owner                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Whether a late notification is acceptable to a City at all             | **Product, with client policy** — this is a service-expectation question, not an engineering one |
| Records-retention and legal implications of suppressing a notification | **Legal / records management**                                                                   |
| The operational ceiling that protects the platform                     | **Operations**, bounded by the platform maximum                                                  |
| Per-destination value                                                  | **Connector configuration**, within the platform maximum                                         |

**This remains unresolved and is a hard blocker on the dispatch slice**, carried forward from F062 Part 17 item 4 and F062.2A §24 item 2. It is part of the state machine's _meaning_, not a runtime tunable: a transition whose criteria nobody has decided is a guessed edge.

### What happens at expiry — recommendation

**Dead-letter with a distinct `reason_code` (`pending_age_exceeded`), not a new state and not cancellation.**

- It uses the existing F062.1 terminal state `dead_lettered`, so **no state inconsistent with F062.1 is introduced** — which a "held" or "expired" state would be.
- It is durable evidence rather than deletion: prior attempts and the intent survive, and §21's replay authorization governs any re-dispatch.
- It produces an operator signal instead of silence. Cancellation would discard an obligation on a timer, which no operator would expect from an age policy.
- Reconciliation (F062 Part 12) then becomes the correct follow-up for a dead-lettered `state_sync` intent: the two systems are known to disagree, and that is a divergence finding rather than a delivery failure.

**No final duration is proposed.**

---

## 8. Retry policy, from the F062.1 capability model

The three-way distinction is the whole policy, and it is already code:

| Attempt outcome    | Meaning                                       | Retry                                                |
| ------------------ | --------------------------------------------- | ---------------------------------------------------- |
| `failed_transient` | the destination could not take it _now_       | eligible, under §9 backoff                           |
| `failed_permanent` | retrying cannot succeed                       | **never** — retrying only delays the operator signal |
| `ambiguous`        | the mutation may or may not have taken effect | **never blindly** — §resolution order below          |

`transientIntegrationFailures` is exactly `['destination_unavailable', 'rate_limited']`. **`destination_timeout` is deliberately absent**, because a timeout is ambiguous rather than transient — the mutation may already have landed. `authentication_failed` and `destination_unconfigured` are permanent: retrying a bad credential reference cannot succeed.

### Ambiguity resolution, read from the pinned snapshot

`resolveAmbiguity()` already encodes the order, and the worker must call it with the **pinned** capabilities, never the connector's current ones:

1. `supportsIdempotencyKey` → retry safely with the same key;
2. else `supportsReadAfterWrite` → read back and resolve on evidence to `accepted` or `failed_permanent`;
3. otherwise → **operator review**.

And the short circuit that matters most: where `sideEffectRisk` is `irreversible` or `physical`, `resolveAmbiguity()` returns `verify_by_read_after_write` or `operator_review` **even when an idempotency key exists**. `unretryableSideEffectRisks` is `['irreversible', 'physical']`, and `NO_CAPABILITIES` defaults `sideEffectRisk` to `'irreversible'` — so a connector that has declared nothing is treated as consequential. **A physical or irreversible ambiguous side effect is never blind-retried**, because being able to retry safely in the protocol sense is not the same as it being safe to repeat an action in the world: the difference is a second crew dispatched to a site.

Resolution never overwrites history. A settled attempt is immutable, so resolving an ambiguity **appends** a new attempt — a read-back, a keyed retry or an operator decision — and the original ambiguous attempt stays readable with its own generation and timestamps.

---

## 9. Backoff

**Exponential with full jitter**, per F062 Part 4.4. Full jitter rather than none, because synchronised retries across replicas after a shared outage are a self-inflicted thundering herd against a destination that is already struggling.

| Parameter              | Recommendation                                                                                                                  | Value           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Base / growth          | exponential                                                                                                                     | **provisional** |
| Jitter                 | full jitter over `[0, computed]`                                                                                                | fixed decision  |
| Maximum interval       | capped, so an intent cannot drift to effectively never                                                                          | **provisional** |
| Maximum attempts       | bounded, then `dead_lettered`                                                                                                   | **provisional** |
| Connector-level outage | **per-`(organization, connector)` circuit breaker** — open on sustained transient failure, probe periodically, close on success | fixed decision  |

**The circuit breaker must be per `(organization, connector)`, never shared.** A single shared breaker is a cross-tenant coupling: one tenant's failing endpoint would throttle or trip another's traffic. This also answers the capacity concern directly — a failing connector's work is skipped at claim time rather than retried in a tight loop, so it cannot consume worker capacity that unrelated connectors need. `next_attempt_at` participates in the claim predicate, so backoff is enforced by the query rather than by a sleeping worker.

**No final numbers.** They depend on the first destination's documented rate limits.

---

## 10. Concurrency and backpressure

Bounded at four levels, each answering a different failure:

| Limit                                                                        | Prevents                                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Per deployment** — total in-flight dispatches                              | unbounded resource use and database connection exhaustion                       |
| **Per connector**                                                            | one destination's latency absorbing the whole worker                            |
| **Per ordered aggregate stream** — at most one in-flight                     | a status change overtaking the creation it depends on                           |
| **Per side-effect risk** — tighter concurrency for `physical`/`irreversible` | many consequential actions in flight simultaneously before any outcome is known |

The aggregate limit is already specified by F062.2A §10 and must be preserved exactly:

```sql
create unique index integration_outbox_single_inflight
  on integration_outbox (organization_id, integration_connector_id, aggregate_type, aggregate_id)
  where state in ('dispatching', 'ambiguous');
```

**Only `dispatching` and `ambiguous` appear in the predicate.** `pending` and `retrying` do not, so **multiple pending intents for one aggregate remain storable and enqueue is never blocked** — the index constrains _concurrency_, not queue depth. Including `ambiguous` is what implements poison isolation: only that aggregate's in-flight slot halts while every other aggregate on the connector continues.

**No global serialization** is introduced at any level. Claiming is per connector, and two connectors may dispatch for the same aggregate concurrently because they are independent destinations.

**Deployment-per-tenant remains the preferred isolation architecture**, which makes "one tenant monopolising shared capacity" mostly moot. If shared execution ever exists, a per-Organization in-flight cap becomes mandatory rather than optional, and F061's `SliDefinition.scope` already distinguishes `tenant_deployment` from `platform`, so the measurement vocabulary supports both.

---

## 11. Connector lifecycle interaction

`mayDispatch()` already returns true only for `active` and `degraded`; `mayEnqueue()` refuses only `retired`.

| State        | Enqueue | Dispatch           | Behaviour                                                                                                                          |
| ------------ | ------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `configured` | yes     | **no**             | Intents accumulate. Activation is an explicit audited operator action, so a newly configured connector cannot dispatch by accident |
| `active`     | yes     | yes                | Normal                                                                                                                             |
| `degraded`   | yes     | **yes, throttled** | See below                                                                                                                          |
| `disabled`   | yes     | **no**             | Accumulates; **pending evidence preserved**. Disabling behaves as an outage, not a discard                                         |
| `retired`    | **no**  | **no**             | Terminal; historical evidence preserved and attributable through the attempt table's connector FK                                  |

**`degraded` is defined rather than guessed.** It means _dispatch continues under reduced concurrency and with the circuit breaker in probe posture._ It exists as a state distinct from `disabled` because "working slowly" and "not working" need different operational responses, and collapsing them would force an operator to choose between pretending a struggling destination is healthy and stopping its traffic entirely. Concretely: the per-connector concurrency limit drops to a provisional floor, backoff intervals use the upper end of their range, and the state is a reported connector-health category rather than a silent condition.

**No automatic fallback to another connector, in any state.** There is no default connector, no catch-all and no substitution on miss; F062.2C made `integration_connector_id` `not null` precisely so an unroutable intent cannot be parked in a shared place. A shared fallback is how one tenant's data reaches another.

**Disabling or retiring never erases evidence.** `mayEraseEvidence()` returns `false` for every state, and no DELETE grant is proposed for any role.

---

## 12. Connector revision semantics

F062.2C pins `configuration_revision` on every intent, and the guard proves the pin is the connector's current semantic revision **and** names a real authoritative snapshot in `integration_connector_audit` (`revision_advanced = true`).

**The worker must dispatch using the pinned revision, not today's capabilities.** The boundary splits cleanly in three:

| What the adapter needs              | Source                                           | Why                                                                                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Behavioural capability snapshot** | the **pinned** `integration_connector_audit` row | This governs retry safety and ambiguity resolution. Reading current capabilities would let a later `supportsIdempotencyKey` change retroactively authorise a blind retry of a prior ambiguous mutation — which is how a crew gets dispatched twice |
| **Credential reference**            | the connector's **current** row                  | A credential rotation is semantically inert _only under the four-part condition below_. Where it holds, using the current reference is what makes rotation possible without invalidating in-flight intents                                         |
| **Adapter revision**                | deferred — §13                                   |                                                                                                                                                                                                                                                    |

> **The boundary, stated precisely: a credential's _value_ is resolved as of
> _now_; everything about _what the destination is and how Reqro acts against
> it_ is interpreted as of _then_.**

Destination, account namespace, authentication mode and declared behaviour all
belong to the "as of then" side (see below), so the only thing read from the
present is the opaque locator — and even that only under the four-part condition
that follows.

### Approved destination semantics are part of the semantic revision

**The pinned `configuration_revision` must cover _where_ and _how_ an intent is
sent, not only _what the connector can do_.** Capabilities alone are not enough:
a connector whose capability set is unchanged but whose endpoint now points
somewhere else would silently redirect every older intent still in the queue.

So the following are **semantic** and each must advance
`configuration_revision`, exactly as a capability change does:

| Semantic property                                                                                       | Why a change to it must not reach an older intent                                                                                                                              |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Approved destination** — host, base path, and the operation endpoints behind each declared capability | An intent was formed to be delivered _there_. Re-pointing it after the fact delivers a City's service request to a system nobody authorized for it                             |
| **External account / tenant namespace**                                                                 | The same endpoint under a different account writes into a different organization's records at the destination — a cross-tenant outcome achieved entirely through configuration |
| **Authentication mode** — the scheme, not the secret                                                    | A change from one scheme to another changes what the destination will accept and how a failure must be classified                                                              |
| **Operation-to-capability mapping**                                                                     | If `createRequest` is re-bound to a different destination operation, the intent's meaning changes without its type changing                                                    |

> **Future dispatch resolves destination, operation and authentication-mode
> semantics from the snapshot identified by the outbox row's pinned
> `configuration_revision` — never from the connector's current row.** A later
> endpoint or namespace change therefore cannot redirect an intent enqueued
> before it.

The practical consequence for the schema is that the connector's
revision-advancing audit snapshot must carry these destination fields, not just
the capability booleans. F062.2B's snapshot carries capabilities and
`connector_kind` today; **adding destination semantics to it is work for the
slice that introduces a real destination**, and it is listed under §31 rather
than done here, because inventing the field set before a documented destination
exists would be guessing at its shape.

### When credential rotation is non-semantic — the exact condition

F062.2B treats a credential rotation as non-semantic, and that is correct **only
under a precise condition**, which is worth stating because the convenient
reading is broader than the safe one.

A rotation is non-semantic **if and only if it preserves all four**:

1. the **external identity or principal** the connector authenticates as;
2. the **authorized scope or permission set** that principal holds;
3. the **approved destination** and account namespace it acts against;
4. the connector's **declared behaviour**.

That is the ordinary case the design is built for: the same principal's secret
replaced with a fresh value, which changes nothing a dispatch depends on and so
must not invalidate in-flight pins.

**A change that materially alters the principal, the tenant or account scope,
the permissions, or the destination is a semantic connector configuration
change and must advance `configuration_revision`** — even though it is
superficially "just a new credential reference". Swapping to a service principal
with broader permissions, or to one belonging to a different tenant, changes
what Reqro can do and where, which is precisely what the semantic pin exists to
record.

**The secret-management boundary must be able to enforce or prove this
distinction**, and that capability is a requirement on it rather than an
assumption about it: at minimum the manager must expose enough metadata about an
entry — principal identity, scope, and target account — for rotation tooling to
assert "same principal, same scope, same destination" before treating a change
as non-semantic. **Where it cannot prove that, the safe default is to treat the
change as semantic** and advance the revision. This is an unresolved
secret-manager requirement, listed in §14.

The governing rule, stated once: **anything that changes what a destination
does, where it is, or who Reqro acts as is semantic and must bump the semantic
revision; only an opaque swap of a secret's value for the same principal, scope
and destination may not.**

The pinned snapshot is readable indefinitely because audit rows are append-only and never deleted, so a pin never dangles.

---

## 13. Adapter revision

**Recommendation: keep it deferred.** The core reliability contract does not need it.

What `adapter_revision` would capture is a _code-level_ behaviour change not reflected in configuration — a bug fix that alters how a response is classified, for instance. Three reasons to wait:

1. **Nothing can populate it meaningfully.** With a loopback adapter only, every attempt carries the same value, which is a column that looks like evidence while proving nothing.
2. **The reliability contract is already closed without it.** Retry safety derives from the pinned capability snapshot, which §4 stores on the attempt row directly — so the decisive inputs are recorded regardless of adapter versioning.
3. **Its correct granularity is unknowable now.** Whether an adapter revision is a semantic version, a build identifier or a content digest depends on what a real adapter turns out to be, and choosing now means choosing from a guess.

The cost of deferral is bounded and visible: an attempt's `capability_snapshot` tells an investigator what was _declared_, and if a code-level change is ever suspected, deployment records cover the gap. Adding the column later is additive.

**No vendor behaviour is invented here.**

---

## 14. Credential and secret boundary

Designed, not implemented. The invariants:

| Requirement                                                               | Mechanism                                                                                                                                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Metadata stores only a reference                                          | F062.2B's `credential_reference` is bounded by grammar and the audit records **presence only**, never the value                                                                            |
| Secrets live in an approved secret manager                                | out of scope here; the reference namespace is owned by that architecture                                                                                                                   |
| Just-in-time resolution                                                   | the worker resolves at attempt time, holds the secret in memory for the call, and never persists it                                                                                        |
| The application API never receives a secret                               | a consequence of §2 Model A: the API is a different principal with no secret-manager identity at all                                                                                       |
| Secrets never enter outbox, attempt, audit, log, trace or metric payloads | structurally: no column accepts free text; F061's `forbiddenAttributes` includes `secret`, `apiKey`, `token`, `authorization`; `metricOnlyForbiddenAttributes` adds the correlation family |
| Secret access is auditable                                                | the secret manager's own audit, attributed to the worker principal — which only Model A makes meaningful                                                                                   |
| Rotation does not change connector identity                               | F062.2B makes `id` and `connector_key` immutable, and rotation advances only `record_revision`                                                                                             |
| **Failure to resolve fails closed**                                       | Always — nothing is sent. But _fail closed_ and _fail permanently_ are different claims, and conflating them is a real defect: see the taxonomy below                                      |

### Secret-resolution failure taxonomy

**Not every secret-resolution failure is permanent, and treating them alike
would be wrong in both directions.** Classifying a manager timeout as permanent
dead-letters a delivery that would have succeeded moments later; classifying a
revoked credential as transient retries something that can never work and
delays the operator signal that is the only thing able to fix it.

| Classification                 | Causes                                                                                                                                                           | Failure category                                                                | Retry                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Permanent — configuration**  | unknown or missing reference; revoked or disabled credential; authorization or scope mismatch; malformed reference that nonetheless satisfied the stored grammar | `authentication_failed` (or `destination_unconfigured` for a missing reference) | **No.** Retrying cannot succeed; it needs an operator or an administrator         |
| **Transient — infrastructure** | secret-manager timeout; temporary backend outage; throttling; transient network failure reaching the manager                                                     | `destination_unavailable`, or `rate_limited` for throttling                     | **Yes**, under §9 backoff and the per-`(organization, connector)` circuit breaker |

Three properties must hold regardless of classification:

- **Both fail closed.** No dispatch occurs, and the attempt is recorded with
  its classification. The difference is only what happens _next_.
- **The failure is attributed to secret resolution, not to the destination.**
  A manager outage is not evidence that the destination is unhealthy, so it must
  not trip the destination's circuit breaker on its own — a `reason_code`
  distinguishing `credential_unavailable` from `credential_rejected` keeps the
  two readable apart in evidence.
- **Nothing is ambiguous here.** A failure to resolve a secret happens strictly
  _before_ any external call, so no external mutation can have occurred. This is
  one of the few paths in the whole design that is definitely retryable or
  definitely permanent and never ambiguous — which is worth stating, because the
  conservative instinct elsewhere in this document is the opposite.

**Unresolved secret-manager decisions, carried forward from F062 Part 17 item 6:**
which manager; the reference grammar and namespace; the worker's authentication
to it (managed identity preferred over a stored secret, which would otherwise
just move the bootstrap problem); rotation overlap semantics so rotation needs no
outage; whether a per-`(organization, connector)` secret is one entry or a
versioned set; and — added by this review — **whether the chosen manager can
expose enough entry metadata (principal identity, authorized scope, target
account) for rotation tooling to prove a rotation is non-semantic under §12's
four-part condition.** Where it cannot, the safe default is to treat every
rotation as semantic, which is correct but operationally heavier, so this is a
selection criterion rather than an afterthought.

**All remain blockers on the secret-resolution slice**, and none blocks the
attempt-schema or identity slices.

---

## 15. Network egress

| Control                               | Requirement                                                                                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Destination allowlist                 | The worker reaches **only** explicitly approved destinations for its configured connectors. Resolved from connector configuration, never from an intent, a payload or a response                     |
| **No unrestricted internet fallback** | The default posture is deny. A destination not on the allowlist is a refusal, not a best-effort attempt                                                                                              |
| DNS                                   | Resolution occurs inside the approved network boundary; a destination that resolves to a private or link-local address is refused (see §29 SSRF)                                                     |
| Proxy                                 | If the deployment requires an egress proxy, the worker honours it explicitly rather than inheriting ambient configuration, so an unproxied call is a configuration error rather than a silent bypass |
| Per-connector egress                  | Preferred where the platform supports it, so one connector's compromise cannot reach another's destination                                                                                           |
| Redirects                             | **Not followed automatically** — a redirect is an instruction from a remote party to contact a different host                                                                                        |

The API process needs **no** outbound integration egress at all, which is an additional argument for §25's separate deployment: egress can be granted to the worker alone.

---

## 16. TLS

Non-negotiable for any future connector traffic: **HTTPS only**; full certificate-chain validation against the platform trust store; **hostname and SNI verification**; modern protocol versions only; and **no path that disables certificate verification** — not for development, not for a self-signed test destination, not behind a flag. A disabled-verification switch is the one control that is always still enabled when it matters.

**Client certificates are deliberately out of scope.** They are connector-specific, and designing mutual TLS before a destination's documentation requires it would be inventing vendor behaviour.

---

## 17. Timeouts

Five categories, deliberately separate — one undifferentiated timeout cannot express "fail fast on an unreachable host but allow a slow legitimate response":

| Category                               | Governs                                                                                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Connection timeout**                 | TCP + TLS establishment. Short: an unreachable destination should not consume a lease                                                        |
| **Response / header timeout**          | time to first response. Detects a connected-but-unresponsive destination                                                                     |
| **Total request budget**               | the hard ceiling on one dispatch, and the value the lease must exceed                                                                        |
| **Database claim transaction timeout** | the claim transaction is short and must stay short; the repository already sets `lock_timeout` in migrations and the same discipline applies |
| **Worker shutdown / drain timeout**    | bounds §18                                                                                                                                   |

**All values provisional** until the first connector contract is known. Two fixed rules regardless: **no category may be unbounded**, and the total request budget must be **strictly less** than the lease, or a live worker gets fenced mid-call and a healthy delivery is recorded as ambiguous.

---

## 18. Worker shutdown

1. **Stop claiming immediately** on signal. Nothing new enters flight.
2. **Allow bounded in-flight completion** — in-flight dispatches finish within the drain timeout so their outcomes are recorded rather than abandoned, which converts avoidable ambiguity into recorded fact.
3. **If the drain window expires or the process is killed**, recovery settles the existing open attempt as `ambiguous` with `reason_code = 'lease_expired_uncertain'`. **Never reset to `pending`.**
4. **Never cancel an in-flight external call to shut down faster.** Cancelling after the request is sent produces exactly the ambiguity draining exists to avoid.

Because the attempt row is created at claim time, a hard kill still leaves dated, attributable evidence of what was attempted, under which connector revision and with which capabilities.

---

## 19. Crash recovery, case by case

| Crash point                                                | Durable state                         | Classification                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before the claim transaction commits                       | nothing written                       | **Definitely retryable.** The intent is untouched and still `pending`; nothing reached the destination                                                                                                                                                                                                      |
| After claim/attempt commit, **before** the request is sent | `dispatching` + open attempt          | **Ambiguous by the conservative rule, retryable in fact.** Reqro cannot distinguish "not yet sent" from "sent, no response", so it must assume the worse. Only where the **pinned** capabilities declare `supportsIdempotencyKey` may recovery route to `retrying`; otherwise §8's resolution order applies |
| During the network call                                    | `dispatching` + open attempt          | **Genuinely ambiguous.** The canonical case                                                                                                                                                                                                                                                                 |
| After external success, before the settle transaction      | `dispatching` + open attempt          | **Ambiguous, and the most costly case.** The destination mutated and Reqro has no record. Resolution is read-after-write where supported, else operator review; a blind retry here is what duplicates                                                                                                       |
| After the settle transaction commits                       | settled attempt + transitioned outbox | **Nothing to recover.** Evidence and state moved together in one transaction, so a crash after commit loses nothing                                                                                                                                                                                         |
| PostgreSQL restart                                         | all state is committed rows           | **Nothing lost.** In-flight claims become stale leases and recover as above. There is no in-memory queue to lose                                                                                                                                                                                            |

The honest summary: **exactly one case is definitely retryable** — a crash before the claim commits. Everything after the claim is ambiguous unless a capability permits better, which is why the capability snapshot is on the attempt row.

---

## 20. Ordering

Preserved exactly as F062.2A §10 specifies, restated here because it is easy to over-constrain:

- in-flight exclusivity is **per `(organization, connector, aggregate_type, aggregate_id)`** — not global, not per Organization, not per connector;
- the partial unique predicate covers **only `dispatching` and `ambiguous`**;
- **multiple `pending` and `retrying` intents for one aggregate remain storable**, and enqueue is never blocked by an unresolved prior dispatch;
- terminal rows never constrain new work;
- two connectors may dispatch for the same aggregate concurrently.

The claim query orders candidates by `aggregate_revision` and skips aggregates whose in-flight slot is occupied, so ordering is honoured without any lock spanning aggregates.

---

## 21. Dead-letter policy

Eligibility, defined but not implemented:

- transient failures with the attempt budget exhausted;
- an operator decision from `ambiguous`;
- maximum pending age exceeded (§7), with its own `reason_code`.

Requirements, all of which follow from existing contracts rather than new policy:

| Requirement                          | Mechanism                                                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Durable evidence, never deletion** | `dead_lettered` is a state on a tenant-owned row. There is **no dead-letter table**, so there is nothing for two tenants to share and no cross-tenant dead-letter semantics                            |
| Prior attempts preserved             | the attempt table is append-and-settle-once with no DELETE grant                                                                                                                                       |
| Bounded reason category              | the closed `reason_code` taxonomy, so a dead-letter is actionable rather than a free-text note                                                                                                         |
| Operator visibility                  | a read over `(organization_id, connector_id)` where `state = 'dead_lettered'`. The index for it belongs to the slice that adds the view, not before                                                    |
| Explicit replay authorization        | `dead_lettered → pending` only, with audit evidence required in the same transaction by a deferred constraint trigger — the `tenant_domain_audited` pattern, which makes a bare UPDATE abort at commit |
| **No silent automatic resurrection** | there is no `dead_lettered → dispatching` edge at all                                                                                                                                                  |

---

## 22. Operator resolution — authorization boundary

Four privileged production actions, mapped to the existing trusted-operator architecture rather than a new one:

| Action                                                                      | Authorization                                                                                                      | Two-person / PIM                                                                                                                                                 |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Resolve an ambiguous delivery** (assert accepted or failed)               | operator identity + reason + correlation, audit row in the same transaction                                        | **Yes where `sideEffectRisk` is `irreversible` or `physical`** — the operator is asserting an outcome nobody observed, about an action that cannot be undone     |
| **Retry a dead-lettered intent**                                            | explicit replay authorization, dry-run → confirm, attributed audit                                                 | **Yes** — replay is the one case where a duplicate may legitimately reach a destination, so an approver must see what _would_ be re-dispatched before confirming |
| **Suppress or cancel pending work**                                         | only if a product contract later permits it; **no such state exists today** and none should be added speculatively | **Yes** — discarding an accepted obligation                                                                                                                      |
| **Reactivate pending work** (clear a circuit breaker, resume after disable) | operator identity + audit                                                                                          | No — reversible and discards nothing                                                                                                                             |

The precedent to reuse is concrete: `tenant_domain_operator_approval` already implements independent approval with `expected_revision`, a single-use partial unique index on `approval_id`, and the `revision has moved` optimistic check. **PIM evidence** follows the F060.3C-2e-2B contract — `assignmentType = activated` **and** a non-null `activatedUsing`, since both Graph resources return standing assignments too.

**No operator endpoint is created here.**

---

## 23. Observability — F061 is the authority

### What the worker needs, and what F061 already has

F061 declares **five** `integration_*` metric concepts. Mapping the worker's needs against them exposes a concrete gap:

| Worker need                   | F061 concept                         | Status      |
| ----------------------------- | ------------------------------------ | ----------- |
| Delivery latency              | `integration_delivery_latency`       | **exists**  |
| Retry count                   | `integration_retry_count`            | **exists**  |
| Dead-letter count             | `integration_dead_letter_count`      | **exists**  |
| Reconciliation-required count | `integration_reconciliation_failure` | **exists**  |
| Connector-health category     | `integration_connector_health`       | **exists**  |
| **Ready / pending count**     | —                                    | **MISSING** |
| **Oldest pending age**        | —                                    | **MISSING** |
| **Claim rate**                | —                                    | **MISSING** |
| **Ambiguous count**           | —                                    | **MISSING** |

**Oldest pending age is the most important missing one.** F062 Part 11 identifies it as _the_ alert signal for a stalled integration, precisely because queue depth is confounded by volume and age is not. A worker shipped without it has no honest way to say "deliveries have silently stopped".

Similarly, `healthSignal` declares exactly three values — `liveness`, `database_readiness`, `hostname_readiness` — and **none covers worker liveness, drain status or connector dependency readiness** (§24).

> **This is an F061-owned prerequisite, and it is a release gate rather than a
> nicety.** Adding metric concepts or `healthSignal` values means editing
> `telemetry-contracts.ts`, which this slice must not modify and has not.

Stated as a condition rather than a wish: **a real worker loop is not
production-ready until F061 declares at minimum `oldest pending age`**, because
without it there is no honest signal that deliveries have silently stopped — a
worker can be alive, healthy and claiming nothing while a backlog grows. Pending
count, claim rate and ambiguous count are strongly recommended alongside it, and
the worker `healthSignal` values are required for §24's surface to be
expressible at all.

An inert or loopback-only worker slice (§30, F062.2D-4) may proceed without
them, because nothing it does is externally consequential and its purpose is to
prove the machinery. The gate applies to the first worker permitted to reach a
real destination. This is tracked as blocker 6 in §31 and must be raised with
the F061 workstream before that slice, **not** resolved here.

### Label discipline

Worker metrics use **only** F061's closed `metricDimensions`. Verified against source, the following must **never** be metric labels: `organizationId`, `connectorId`, `customerHostname`, `tenantHostname` (all `restrictedAttributes`, `metricLabels: 'forbidden'`); and `correlationId`, `traceId`, `spanId`, `externalRecordId`, `jobId`, `runId`, `serviceRequestId`, `residentId` (all `metricOnlyForbiddenAttributes`). The outbox ID and external ID are likewise unbounded per-row identifiers and are excluded for the same cardinality and privacy reasons.

The bounded dimensions a worker may legitimately use already exist: `component`, `operation`, `outcome` (`succeeded`/`failed`/`refused`/`unavailable`/`pending`), `reason`, `dependencyClass` (`integration`), `endpointClass` (`integration`), `environment`, `service`.

F062.1's `integration-telemetry.ts` already provides the mapping — `outcomeDimension()` sends `ambiguous` to `pending` rather than to `failed` or `succeeded`, because an ambiguous attempt is unresolved and reporting it as either asserts something nobody observed.

**Traces and logs** follow F061's privacy policy: `restrictedAttributePolicy.logsAndTraces` requires `explicit_privacy_and_operations_review_required`, so even in a trace these attributes are not free to add. Vendor error bodies are untrusted third-party text and must not be logged raw; they classify to a closed `reason_code`.

**No metrics are implemented in this slice**, and F061.2B's posture is the pattern to follow when they are: a private meter provider, no global registration, no exporters, and `validateMetricLabels` as the only label authority.

---

## 24. Health and readiness

| Signal                   | Means                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| **Liveness**             | the worker process is running and its loop is not wedged. Independent of any destination |
| **Readiness**            | it can claim work: database reachable, configuration loaded, secret resolution available |
| **Dependency readiness** | per-connector reachability, reported as a **category**, never as a global boolean        |
| **Drain status**         | shutting down, not claiming, finishing in-flight work                                    |

> **A worker being alive does not mean external connectors are healthy, and connector health must never make the Reqro resident API unhealthy.**

That separation is the point. A destination being down is a _backlog_ condition, not a Reqro outage: the outbox makes resident intake succeed regardless, so marking the resident API unhealthy because a City's work-management system is offline would convert someone else's outage into a self-inflicted one. Concretely: connector health is reported on the **worker's** surface and as a connector-health metric; the API's existing `/health/ready` must not gain an integration dependency; and §25's separate deployment makes that separation structural rather than a matter of care.

---

## 25. Deployment model

|                         | In-process (Nest API)                     | **Separate worker process/container**         | Managed cloud job                                                        |
| ----------------------- | ----------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| Blast radius            | shared with the resident API              | **isolated**                                  | isolated                                                                 |
| DB principal separation | **impossible** — same login               | **natural**                                   | natural                                                                  |
| Scaling                 | coupled to API scaling                    | **independent**                               | independent, provider-managed                                            |
| Networking              | API process would need integration egress | **egress to the worker only**                 | provider-dependent                                                       |
| Secret access           | API process gains secret-manager identity | **worker only**                               | worker only                                                              |
| Deployment independence | none                                      | **yes**                                       | yes                                                                      |
| Observability           | mixed into API telemetry                  | **separable**                                 | separable                                                                |
| Failure isolation       | a worker leak degrades resident intake    | **contained**                                 | contained                                                                |
| Complexity              | lowest                                    | moderate: one more unit to deploy and monitor | provider coupling, and a provider-neutral execution contract to maintain |

### Recommendation

> **A separate worker process/container, sharing the Reqro integration libraries.**

It is the only option that makes §2's identity recommendation real. In-process execution forces Model B and with it the admission that the API and the worker are one database principal — and it additionally requires granting the API process both integration egress and secret-manager access, neither of which a resident-facing API should hold. The managed cloud job is attractive operationally but adds provider coupling and a provider-neutral execution contract to maintain, for a first implementation whose throughput is unknown; it remains the natural second step if scheduling or scale-to-zero later justify it.

**Nothing is provisioned by this assessment.**

---

## 26. Scaling

`SKIP LOCKED` plus fencing stays correct across replicas by construction: `SKIP LOCKED` prevents two replicas claiming the same row, and fencing covers the case where the first defence is legitimately passed — a recovered and re-claimed row whose original worker later returns.

| Dimension                | Approach                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Horizontal scale         | add replicas; correctness is in the database, not in replica coordination                                                                                                                                          |
| Per-connector throttling | the per-connector concurrency limit and circuit breaker are evaluated at claim time, so adding replicas does not multiply pressure on one destination                                                              |
| Downstream rate limits   | `rate_limited` is transient and feeds backoff; a documented destination limit becomes connector configuration                                                                                                      |
| Database load            | the claim is a short indexed transaction against a **partial** index over `pending`/`retrying`, so the hot set stays small as settled rows accumulate — the dominant long-term shape, since most rows end terminal |
| Queue depth              | a symptom; **oldest pending age** is the signal (§23)                                                                                                                                                              |
| Worker saturation        | bounded concurrency means saturation shows as growing age rather than resource exhaustion                                                                                                                          |

**Scale is not a reason to add a broker** (§27).

---

## 27. Broker decision

> **PostgreSQL is sufficient for the first worker. No broker.**

Reasons specific to this codebase rather than by analogy: the outbox is **a table, not infrastructure** — nothing to provision, secure, licence or operate, which matters when the operator platform's secret management and private networking are themselves still open; atomicity with the domain transaction is the property that makes the design correct, and a broker cannot provide it without reintroducing the dual write; and it degrades correctly, with backlog as the alert signal.

Triggers that would justify revisiting, to be met with evidence rather than anticipation:

- sustained throughput where the claim transaction becomes a measurable bottleneck despite the partial index;
- **fan-out** to many connectors per intent, where a single table becomes a contention point;
- cross-region delivery, where a broker's geo-replication beats polling;
- an isolation requirement that database-level tenancy cannot satisfy;
- operational pressure on PostgreSQL — autovacuum unable to keep up with churn, or retention unable to keep settled rows bounded.

Adding a broker would also reopen decisions this design closes: at-least-once semantics, ordering, and the fencing model would all need restating against the broker's guarantees.

---

## 28. Required state-machine parity tests

F062.1 remains authoritative; SQL is derived. **No SQL-only state or type may exist.** The dispatch slice must prove, by database integration test:

| Assertion                                        | Method                                                                                                                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vocabulary equality**                          | read live `CHECK` definitions from `pg_constraint`, parse the literals, assert **set equality** with `deliveryStates`, `attemptOutcomes`, `integrationFailureCategories` and the `reason_code` taxonomy — equality in both directions |
| **Every allowed transition succeeds**            | exercise each whitelisted `(from, to)` pair                                                                                                                                                                                           |
| **Every forbidden transition raises**            | sweep all **72** off-diagonal pairs of the 9 states; a whitelist that only passes its happy path proves nothing about what it forbids                                                                                                 |
| Named prohibitions                               | `accepted → pending`, `acknowledged → pending`, `dead_lettered → dispatching`, and `ambiguous → dispatching` without a pinned `supportsIdempotencyKey` — asserted by name as well, so a regression says which rule broke              |
| Terminality                                      | the states from which nothing succeeds equal `terminalDeliveryStates`, with the single documented `dead_lettered → pending` replay edge                                                                                               |
| Ambiguity rules                                  | lease expiry settles the **existing** attempt as ambiguous and never returns the outbox to `pending`; resolution appends rather than overwrites                                                                                       |
| Attempt/outbox consistency                       | evidence and state move in one transaction, or neither moves                                                                                                                                                                          |
| Fencing                                          | a stale token settles nothing and transitions nothing; it cannot overwrite an attempt already settled by recovery                                                                                                                     |
| Complete-once                                    | a settled attempt refuses UPDATE; at most one open attempt per outbox row                                                                                                                                                             |
| Pinning                                          | changing a connector's capabilities does **not** change the resolution available to an already-recorded ambiguity                                                                                                                     |
| Resident invisibility                            | `residentVisibleDeliveryStates` is empty and no resident-facing query joins these tables                                                                                                                                              |
| **The inert constraint is dropped deliberately** | `integration_outbox_state_inert` is removed **by name** in the same migration that adds the transition guard, never incidentally                                                                                                      |

---

## 29. Threat analysis

| Threat                                | Primary mitigation                                                                                                                                                                                                    | Layer                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **Duplicate external side effect**    | at-least-once admitted honestly; idempotency key where supported; `ambiguous` never blind-retried; `irreversible`/`physical` short-circuit to read-back or operator review                                            | contract + worker     |
| **Forged connector selection**        | composite FK makes a cross-Organization connector reference inexpressible; `integration_connector_id` is `not null`, so no fallback destination exists                                                                | database              |
| **Cross-tenant dispatch**             | every row carries `organization_id`; connector, origin connector and attempt all composite-FK; no global connector lookup; destination allowlist resolved from connector configuration                                | database + network    |
| **Stolen credential reference**       | the reference is **not a credential** — it names an entry only, and resolution requires the worker's own secret-manager identity, which Model A keeps out of the API                                                  | identity              |
| **Secret leakage**                    | no column accepts free text; audit stores presence only; F061 `forbiddenAttributes` covers `secret`/`apiKey`/`token`/`authorization`; never logged, traced or labelled                                                | database + telemetry  |
| **Stale worker completion**           | fencing on `claim_generation` + token digest; zero-row updates; complete-once guard raises on a settled row                                                                                                           | database              |
| **Replay**                            | a replayed intent reuses `integration_id` so a key-honouring destination collapses it; replay is explicit, authorized and audited, never automatic                                                                    | contract + operator   |
| **SSRF**                              | destinations come **only** from connector configuration, never from an intent, payload or response; allowlist default-deny; refuse private, loopback and link-local resolutions                                       | network               |
| **Redirect to unapproved host**       | redirects **not followed automatically**; a redirect is an instruction from a remote party                                                                                                                            | worker                |
| **DNS rebinding**                     | resolve, validate the resolved address against policy, and connect to the validated address; prefer connector-specific egress so a rebind lands nowhere useful                                                        | network               |
| **Malicious vendor payload**          | responses classified into a closed vocabulary; **no raw body stored or logged**; vendor text is untrusted third-party input and never interpolated anywhere                                                           | worker + database     |
| **Oversized response**                | bounded read limit, with an exceeded limit classified as `response_unparseable` and the connection closed; never buffer an unbounded body                                                                             | worker                |
| **Worker compromise**                 | Model A's narrow EXECUTE surface: no business-table writes, no DELETE, no migration authority, no connector administration; separate deployment bounds lateral movement                                               | identity + deployment |
| **Denial of service through backlog** | bounded concurrency; per-`(organization, connector)` circuit breaker so one failing destination cannot consume capacity; the maximum-pending-age ceiling bounds unbounded growth; **oldest pending age** is the alert | worker + operations   |

Two findings worth separating from the table:

- **The most dangerous duplicate is not a retry bug; it is a lease that is too short.** A lease shorter than the total request budget fences a live worker mid-call, recovery marks the attempt ambiguous, and a capability that permits retry then produces a genuine duplicate from an entirely healthy dispatch. §17's rule — total request budget strictly less than the lease — is a security control, not a tuning preference.
- **`NO_CAPABILITIES` defaulting `sideEffectRisk` to `irreversible` is load-bearing.** A connector configured but not fully described is treated as consequential, so the failure mode of incomplete configuration is "sends to operator review" rather than "retries a physical action".

---

## 30. Recommended implementation slices

The suggested names are adopted with one change in order and one addition, because the identity decision determines the grants that the schema slice's tests assert.

| Slice                                                             | Content                                                                                                                                                                                                                 | Gating                                                                                                                                     |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **F062.2D-1 — worker identity and grant model decision**          | A reviewed decision record selecting §2's model, the function boundary and the grant matrix. **Decision only; no role, no grant.** Moved first because it determines what the next slice's role-separation tests assert | **Needs product/security approval.** Nothing else blocks it                                                                                |
| **F062.2D-2 — delivery-attempt schema and fencing state machine** | Migration: the attempt table, the complete-once guard, the one-open-attempt index, the transition guard, **dropping `integration_outbox_state_inert` by name**, and §28's full parity suite. **No worker**              | Needs 2D-1, and needs the **maximum-pending-age** decision because the dead-letter edge's criteria are part of the state machine's meaning |
| **F062.2D-3 — worker role and grants**                            | Create the principal and the reviewed functions; extend `database-role-separation` to assert the worker surface and that the runtime **cannot** transition a delivery                                                   | Needs 2D-1 and 2D-2                                                                                                                        |
| **F062.2D-4 — inert claim loop with a loopback adapter only**     | The claim/dispatch/settle cycle, lease recovery, backoff, circuit breaker — proven end to end against a **loopback adapter that performs no network I/O**. Still no egress and no credentials                           | Needs 2D-3 and provisional lease/timeout values                                                                                            |
| **F062.2D-5 — secret-resolution boundary**                        | Just-in-time resolution, fail-closed, auditable                                                                                                                                                                         | **Blocked** on the secret-manager decisions in §14                                                                                         |
| **F062.2D-6 — egress, TLS and network policy**                    | Allowlist, resolved-address validation, no redirects, bounded response reads                                                                                                                                            | Needs 2D-5 and a known destination                                                                                                         |
| **F062.2D-7 — operator resolution surface**                       | Resolve ambiguous, authorize replay, with two-person approval where §22 requires it                                                                                                                                     | Needs 2D-2 and the operator platform                                                                                                       |
| **F062.3 — first real connector**                                 | One destination, outbound only                                                                                                                                                                                          | **Hard-blocked** on the destination's **actual API documentation**                                                                         |

**A real connector remains blocked until genuine vendor API documentation is reviewed.** AGENTS.md forbids inventing undocumented vendor behaviour, and a connector designed against a guess is worse than none.

---

## 31. Blockers

**Hard — a named slice cannot proceed:**

1. **Worker identity and grant model** (§2). Blocks 2D-2's test expectations and 2D-3 entirely. Recommendation in hand; needs approval.
2. **Maximum pending age and its expiry action** (§7). Blocks 2D-2, because the dead-letter transition's criteria are part of the schema's meaning. Recommendation in hand: dead-letter with a distinct reason code; duration unowned.
3. **Secret-manager decisions** (§14). Block 2D-5 and everything after.
4. **First destination's actual API documentation.** Blocks F062.3 and any real egress.
5. **Approved snapshot payload mode or an exact reconstruction invariant** (F062.2A §2). No declared `event` type is enqueueable today, so the worker's first real traffic is limited to `state_sync` regardless of worker readiness.
6. **Destination semantics in the connector snapshot** (§12). The revision-advancing audit snapshot carries capabilities and `connector_kind` today, not destination, account namespace or authentication mode. Pinning destination authority requires extending it — additive, but it belongs to the slice that introduces a real destination, since the field set cannot be designed before one is documented. **Blocks any dispatch to a real destination**, not the inert slices.

**F061-owned, reported not acted on:**

7. **Four missing metric concepts** — ready/pending count, **oldest pending age**, claim rate, ambiguous count — and **missing `healthSignal` values** for worker liveness, drain and connector dependency readiness (§23, §24). Adding them edits `telemetry-contracts.ts`, which this slice must not touch and has not. **`oldest pending age` is a release gate**: a real worker loop is not production-ready without it, because nothing else distinguishes a healthy idle worker from a silently stalled one. The loopback slice may proceed without it.

**Provisional, not blocking:**

8. Lease duration, backoff parameters, retry and attempt ceilings, concurrency limits and all five timeout categories — all require the first connector's real contract (§6, §9, §10, §17).
9. Adapter revision — recommended **deferred** (§13).

---

## Is any worker implementation safe to begin?

**No worker. Two non-worker slices are safe, and the boundary is exact.**

- **F062.2D-1 (identity and grant decision)** is a decision record and depends on nothing unresolved. Safe now.
- **F062.2D-2 (attempt schema and state machine)** is safe **once blockers 1 and 2 are decided**, and not before: its grant assertions depend on the identity model, and its dead-letter edge depends on the pending-age policy.
- **F062.2D-3 (role and grants)** follows 2D-2.
- **F062.2D-4 is the first slice containing anything worker-shaped**, and even then only a loopback adapter with no egress and no credentials.
- **Nothing that can reach an external system is safe to begin**, and will not be until blockers 3 and 4 are resolved.

**Recommendation: authorize F062.2D-1 only**, and treat blockers 1 and 2 as the gate on the schema slice, then 3, 4, 6 and 7 as the gate on anything that reaches a real destination.

---

## Related

- [F062 — Enterprise integration reliability and eventing architecture](F062-enterprise-integration-eventing-architecture.md)
- [F062.1 — Enterprise integration contracts foundation](F062-1-integration-contracts-foundation.md) — the authoritative capability, outcome and lifecycle vocabularies
- [F062.2A — Transactional outbox persistence readiness](F062-2A-transactional-outbox-persistence-readiness.md) — the fencing, pinning and attempt-evidence model this extends
- [F062.2B — Connector metadata persistence foundation](F062-2B-connector-metadata-persistence-foundation.md) — the two-revision model the pin relies on
- [F062.2C — Transactional outbox and atomic enqueue](F062-2C-transactional-outbox-atomic-enqueue.md) — the intents this worker would dispatch
- [F061.1 — Telemetry schema and privacy foundation](F061-1-telemetry-schema-privacy-foundation.md) — the label policy and metric concepts
- [F061.2B — Safe HTTP request metrics foundation](F061-2B-safe-http-request-metrics-foundation.md) — the metrics runtime pattern to follow
- [ADR-024 — Transaction-time request authorization](../architecture/decisions/ADR-024-transaction-time-request-authorization.md) — the uncertain-result rule the ambiguity model rests on
- [ADR-026 — Outbound notification and delivery architecture](../architecture/decisions/ADR-026-outbound-notification-delivery-architecture.md) — the recorded-not-delivered discipline
