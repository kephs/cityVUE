# F062.2D-2C-3B-2 — Destination `Retry-After` evidence persistence

> **NO POLICY NUMBERS ARE SELECTED.**
>
> **NO PLATFORM POLICY ROW IS INSERTED.**
>
> **NO VALUE IS CLAMPED.**
>
> **NO RETRY IS SCHEDULED.**
>
> **NO `next_attempt_at` IS AUTHORED.**
>
> **NO FUNCTION SIGNATURE CHANGES.**
>
> **NO WORKER ROLE OR EXECUTE GRANT EXISTS.**
>
> **THE COLUMN IS NULL-ONLY UNTIL F062.2D-2C-3C.**
>
> **F062.2D-3 REMAINS BLOCKED.**

This slice is **persistence only**. It adds one column, three constraints and
one guard extension, plus the type and the tests that describe them. It changes
**no worker function**, reads no policy at runtime and calculates nothing.

Starting point: `origin/main` at
`786b50a52c0ac7fdac6405da64373650fa0a3d17`, which carries the merged
F062.2D-2C-3B-1 persistence slice (`e440e5d`, PR #54) as a verified ancestor.

---

## 1. Architecture source

| Source | What it governs here |
| --- | --- |
| **[F062.2D-2C-3B-0](F062-2D-2C-3B-0-execution-policy-persistence-schema-decision.md)** | the whole shape: §14 the evidence model and the three rejected alternatives, §15 the authority chain and the no-signature-change rule, §16 the persistence location, §17 the structural bounds and the deliberate non-constraint, §28 the exact schema row, §32 invariants 15 and 16 |
| [F062.2D-2C-3-0](F062-2D-2C-3-0-worker-execution-policy-function-signatures.md) | §19.1 that nothing was persisted, §19.2 that automatic `rate_limited` scheduling is BLOCKED until this evidence exists, §19.3 and §27.3 that the completion signature is frozen |
| [F062.2D-2C-3B-1](F062-2D-2C-3B-1-execution-policy-persistence.md) | §14 which names this slice and its six properties, and the Migration 57 attempt guard this slice extends |
| [F062.2D-2C-1](F062-2D-2C-1-lease-dispatch-recovery-reason-persistence.md) | the attempt guard's write-once and settle-once structure, and the dispatch-boundary update path |

**No new decision record was required.** Unlike 3B-1, which needed 3B-0's Phase 0
resolution, every question this slice could raise was answered by 3B-0 in
advance. The implementation deviates from it nowhere; §9 records the one place
where 3B-0's prose had to be read as SQL rather than transcribed as SQL.

---

## 2. Migration identity

**Ordinal 58**,
`server/migrations/20261028000000-add-integration-destination-retry-after-evidence.ts`.

Migrations 50 and 52–57 are **byte-unchanged**; 58 extends one guard function
with `CREATE OR REPLACE`, built by **asserted transformation** of Migration 57's
live definition.

**Migration 58 hardcodes no schema name.** Like 57, and unlike 48, 49, 53 and
56, it qualifies nothing with `public.`, so this slice's suite imports and
applies it to a disposable schema. The migration-import guard asserts this
rather than assuming it.

---

## 3. The evidence column

One column on `integration_delivery_attempt`:

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| `destination_retry_after_seconds` | `integer` | yes | **none** |

**No default, deliberately.** A default would be a policy number chosen by a
migration. The absence is asserted by test, not just intended.

**Integer seconds, not `interval`** (3B-0 §6): no `interval` column exists
anywhere in the schema.

**Not mirrored anywhere.** This is per-try destination response evidence, not
connector configuration, so it appears on neither `integration_connector`, nor
its audit snapshot, nor `integration_outbox` — the last of which would be
overwritten on each retry and lose the per-try record (3B-0 §16). Asserted by
test in all three.

### 3.1 What is stored, and what is not

A **normalized non-negative delay**, and nothing else (3B-0 §14, option B).

| Rejected | Why |
| --- | --- |
| The raw `Retry-After` header text | unbounded, externally controlled, privacy-relevant, and it would force the database to parse both `delta-seconds` and HTTP-date forms in SQL |
| A caller-supplied absolute `retry_not_before_at` | converting a stated delay into an instant needs a clock, and that would put the *adapter's* clock into durable schedule evidence. The database authors timestamps |
| Both raw and normalized | the raw form answers nothing once the delay is captured |

The absolute floor is **computed, never stored** — 3B-0 §14's derivation is 3C's
to perform at schedule time. Storing it would duplicate `next_attempt_at`
whenever the two agree and be mistaken for the authored schedule whenever they
do not.

---

## 4. Three structural bounds

> **This is the first caller-supplied, externally-influenced value ever
> persisted on `integration_delivery_attempt`** (3B-0 §17). Every other caller
> input on that table is either a fence argument that is compared and discarded,
> or a value the guard overwrites with its own (`dispatch_started_at`). That
> makes this validation list a security boundary, not hygiene.

| Constraint | Form |
| --- | --- |
| `integration_attempt_retry_after_nonnegative` | `… is null or … >= 0` |
| `integration_attempt_retry_after_rate_limited` | `… is null or failure_category is not distinct from 'rate_limited'` |
| `integration_attempt_retry_after_settled` | `… is null or completed_at is not null` |

**Zero is legal.** A destination may state "retry immediately". This is the one
place the repository's usual `> 0` rule does not apply, and 3B-0 §17 says so
explicitly. Zero is therefore also *evidence*, which §7 returns to.

**The platform ceiling is deliberately not a table constraint** (3B-0 §17).
`max_destination_retry_delay_seconds` is enforced in the function at settlement
time, because the bound is a policy revision that may change while this evidence
is immutable. **Nothing is clamped in this slice.**

**No numeric maximum is chosen.**

### 4.1 The rate-limited constraint is NULL-safe, and that is load-bearing

> ### FROZEN: the category comparison uses `is not distinct from`, never `=`.

3B-0 §17 states the rule as *"Absent for success, and for every other category —
the same constraint, since `failure_category` is null for a success."* Read as
an intent that is correct. Transcribed into SQL as
`failure_category = 'rate_limited'` it is **wrong**, and silently so.

PostgreSQL satisfies a `CHECK` when the expression evaluates to **true or
NULL**. For a successful settlement Migration 52 requires `failure_category` to
be NULL, so:

```
destination_retry_after_seconds is null   -> false
failure_category = 'rate_limited'         -> NULL
false or NULL                             -> NULL            -> CHECK SATISFIED
```

The naive form would therefore have admitted destination retry evidence onto a
**successful** settlement by *unknown* — the exact case 3B-0 believed it was
closing. `is not distinct from` is two-valued, so a NULL category is refused
like any other wrong one.

This is recorded as an implementation reading of the frozen contract, not a
change to it: the rule 3B-0 chose is enforced, and only the expression that
enforces it differs from a literal transcription. A unit test asserts the
null-safe spelling is present and the three-valued one is absent, and a database
test proves the refusal against a real successful settlement.

---

## 5. Guard semantics

The existing guard is **extended, not replaced**: all **149** lines of Migration
57's definition are preserved in order and **33** are added, proven
clause-by-clause against the live `pg_get_functiondef` rather than against the
source text.

| Path | Behaviour |
| --- | --- |
| at creation | **refused** — *"Integration delivery attempt must be created without destination retry evidence"*. An attempt is created open, before any transmission |
| on the dispatch-boundary update | **refused** — *"Destination retry evidence requires a settled attempt"*. The attempt is still open |
| during settlement | **permitted**, with `completed_at` and `failure_category = 'rate_limited'` |
| with any other category, including a success | **refused** — *"Destination retry evidence is legal only for a rate_limited settlement"*, written null-safely for the §4.1 reason |
| after settlement | **refused** — settled rows are already immutable, and the write-once clause is asserted explicitly so a later relaxation of that rule cannot silently open the column |

`complete_integration_attempt`, `claim_integration_intent` and
`mark_integration_dispatch_started` are **not modified** by this slice.

---

## 6. The column is NULL-only until 3C

Four independent, individually sufficient reasons:

1. **No writer exists.** `complete_integration_attempt` is the only function
   that settles an attempt; its seven-parameter signature is frozen by 3-0 §27.3
   and has no parameter that could carry a delay. The eighth parameter is a
   reviewed signature change owned by 3C (3B-0 §15, 3-0 §19.3). Asserted against
   the live catalogue, including that no parameter is an `integer`.
2. **No caller exists.** There is no TypeScript worker, polling loop, transport,
   adapter or npm script; `reqro_integration_api` appears nowhere in
   `server/src`.
3. **No principal could execute one.** `EXECUTE` is revoked from `PUBLIC` and
   granted to nobody, and `reqro_integration_worker` does not exist.
4. **No table or column grant.** The attempt table's column-level ACL list stays
   empty, asserted in the disposable schema and on a real cluster by the
   role-separation suite.

3B-0 §15 states the consequence directly: *"between 3B-2 and 3C the column
exists and is NULL-only, because no function writes it."* It is the established
pattern — `claim_expires_at` landed in 2C-1 and stayed NULL until 3A;
`next_attempt_at` landed in 2C-2 and stayed NULL until 3A.

Tests drive the table directly to exercise the constraints. That is persistence
verification; it creates **no production authoring authority**.

---

## 7. Existing rows, and rollback

**Nothing is backfilled.** Every existing attempt — open, settled, and settled
as `rate_limited` — keeps NULL, which is the true statement that the destination
stated no retry floor for it. All three constraints are one-directional, so no
pre-existing row becomes illegal; in particular a `rate_limited` settlement
**with no delay remains legal**, which is the row 3B-0 §18's parking
recommendation exists for.

`down()` **refuses** if any `integration_delivery_attempt` row carries a non-null
`destination_retry_after_seconds` — the single-condition analogue of Migration
57's five. A stated retry floor is what a destination asked for during a real
transmission, so it is business evidence and the refusal protects it rather than
deleting it.

**Zero is retained evidence too.** A refusal keyed on truthiness rather than on
NULL would miss a stored `0`, so the refusal is `is not null` and a test settles
an attempt at exactly zero and proves rollback is still refused.

A clean rollback is legal **only** from the state immediately after apply, where
it destroys nothing. It then restores Migration 57's guard **verbatim** — proven
by capturing `pg_get_functiondef` before apply and asserting byte equality after
`down()` — and only then drops the three constraints and the column, so the
function never references a column that is gone.

---

## 8. Handwritten types

`server/src/database/database.types.ts` gains
`destination_retry_after_seconds: number | null` on
`IntegrationDeliveryAttemptTable`. **No business DTO, no API request type, no
vocabulary member and no policy-calculation code is added.**
`connector-metadata.ts` is untouched: this slice introduces no audit change
category, because the evidence is not connector configuration.

---

## 9. Deviations from the frozen contract

**One, and it is a spelling rather than a decision:** 3B-0 §17 writes the
category rule as `failure_category = 'rate_limited'`; it is implemented as
`failure_category is not distinct from 'rate_limited'` for the §4.1 reason. The
rule 3B-0 chose is enforced exactly; the literal expression would not have
enforced it.

Two naming choices are implementation detail, stated rather than decided:
constraints use the `integration_attempt_retry_after_*` prefix, matching
Migration 57's existing `integration_attempt_settlement_policy_settled` rather
than 3B-0's shorthand; and the guard refuses at creation and on the
dispatch-boundary update **explicitly**, as defence in depth over the
`…_settled` table check.

---

## 10. Validation

Environment: a **disposable** `postgres:17-alpine` container (**PostgreSQL
17.11**), database `reqro_f0592_test`, user `reqro_test_user`, bound to
`127.0.0.1` only and destroyed afterwards. No development or production
database was contacted, and no credential was reused.

| Check | Result |
| --- | --- |
| `npm run typecheck` | **pass** |
| `npm run lint` | **pass** |
| `npm run build` | **pass** |
| New destination retry-after suite | **20/20 pass** (19 subtests), no sleeps |
| Unit suite | **994 tests, 993 pass, 1 fail** — pre-existing, see below |
| Database suite, serial | **943 tests, 941 pass, 2 fail** — pre-existing, see below |
| `git diff --check` | clean |

### 10.1 Baseline comparison, run rather than assumed

The database suite was run **serially** (`--test-concurrency=1`) on this branch
and on a pristine worktree of `main` at `786b50a`, against the same disposable
cluster:

| | `main` @ `786b50a` | This branch |
| --- | --- | --- |
| tests | 923 | **943** (+20) |
| pass | 921 | **941** (+20) |
| fail | **2** | **2** |

The two failures are **the same two files on both sides** —
`tenant-domain-registry.integration.test.ts` and
`resident-experience-review.integration.test.ts` — and both fail on the same
assertion, that the client address is `::1/128` or `127.0.0.1/32`. A
containerized PostgreSQL reached through a published port sees the Docker
bridge gateway instead, so this is an **environment property of the harness,
not a defect in either tree**. The slice adds exactly its own 20 tests and
regresses nothing.

### 10.2 Failures and flakes, recorded rather than smoothed over

- **Unit suite, 1 pre-existing failure.** *"the acting human cannot be supplied
  by a pipeline parameter"* in `tenant-domain-operator-platform.test.ts`
  asserts on `azure-pipelines/tenant-domain-operator-request.yml`, which **does
  not exist and is not tracked anywhere in the repository**. It fails
  identically on unmodified `main` (1 of 25 in that file).
- **One unreproduced unit discrepancy.** The *first* full unit invocation
  reported **2** failures; three later invocations of the same compiled output
  reported **1**, and only the failure above was ever named in the output. The
  second failure was not identified and is recorded as an unexplained flake
  rather than dismissed.
- **The database suite is flaky in parallel, which is why serial is the
  evidence.** Two default (parallel) invocations reported 20 and then 11
  failures. The mechanism is visible in the output: assertions that query
  catalogue metadata without scoping to their own disposable schema see other
  concurrently-live test schemas — one reported finding `claim_token_digest`
  five times where it expected one. This is a pre-existing property of those
  suites and is unrelated to this slice, which touches none of them. The
  parallel run was **not** repeated on the baseline, so the comparison above is
  the serial one.

### 10.3 `format:check` fails, and is pre-existing

`npm run format:check` reports style issues across the repository on **`main`
itself** (237 files at baseline). Each of the five pre-existing files this
slice edits was **already** prettier-dirty at `786b50a`, verified by checking
the unmodified blobs out of `HEAD` and running prettier on them. They were
deliberately **not** reformatted, because doing so would be unrelated cleanup
during feature work. The two files this slice creates are prettier-clean.

### 10.4 Synthetic test values are not policy

The suite uses small, obviously artificial, mutually distinct integers so a
mis-mapped column surfaces as a wrong number rather than a passing test.
**They are test fixtures, not policy decisions, and no deployment may adopt
them.** All thirteen numerical policies of F062.2D-2C-3-0 §26 remain
unresolved, and nothing in this slice proposes a value for any of them.

---

## 11. Remaining work

| Slice | Owns |
| --- | --- |
| **F062.2D-2C-3C** | reading policy in the worker functions, authoring `claim_expires_at`, the completion-signature extension that supplies this delay, clamping it to `max_destination_retry_delay_seconds`, scheduling retries, jitter, the retry horizon, and recovery. Also the 3B-1 §9.1 activation gate and the operator-authoring boundary for platform policy |
| F062.2D-3 | the worker identity, its `EXECUTE` grant and the runtime. **Remains blocked**, and F061.3D remains the telemetry gate before any activation |

**3B-0 §18's fallback is now unnecessary but not withdrawn.** With this evidence
contract in place, 3C may honour a stated rate under option B. Where a
`rate_limited` settlement carries **no** delay — which stays legal — parking per
§18 remains the approved behaviour.

### Reported separately, not fixed here

`writeAudit()` in `server/src/integration/persistence/connector-metadata.repository.ts`
enumerates audit columns explicitly and omits the four F062.2D-2C-3B-1
execution-policy columns. If a connector row ever carries non-null policy, the
next repository mutation would write an audit row with NULL policy and Migration
57's extended audit guard would refuse it. It is latent — no authoring path
populates connector policy today — and **outside this slice's scope**, which
touches the attempt table only. It must be resolved by, or before, whichever
slice first authors connector execution policy.

---

## Related

- [F062.2D-2C-3B-0 — Execution policy persistence schema and trust-boundary decision](F062-2D-2C-3B-0-execution-policy-persistence-schema-decision.md) — the decision this implements
- [F062.2D-2C-3B-1 — Execution policy persistence](F062-2D-2C-3B-1-execution-policy-persistence.md) — the sibling slice, and the guard extended here
- [F062.2D-2C-3-0 — Worker execution policy and function signatures](F062-2D-2C-3-0-worker-execution-policy-function-signatures.md) — §19 rate-limit semantics and the frozen completion signature
- [F062.2D-2C-3A — Strict FIFO, retry eligibility and dispatch-marker hardening](F062-2D-2C-3A-strict-fifo-retry-dispatch-function-hardening.md) — the functions this slice leaves unchanged
- [F062.2D-2C-1 — Lease, dispatch boundary and recovery-reason persistence](F062-2D-2C-1-lease-dispatch-recovery-reason-persistence.md) — the attempt guard's write-once structure
