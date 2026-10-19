# ADR-031 — Submission idempotency

**Status: Accepted** — F066 implementation decision. Release validation and live UAT remain separate gates in the [feature record](../../features/F066-all-submission-idempotency.md). Nothing here authorizes activating [ADR-009](ADR-009-secure-requester-tracking.md)'s automatic requester tracking.

## Context

A resident submits a request, the response is lost to a timeout or a dropped connection, and the resident presses Submit again. Before F066 the server had no way to recognize the second attempt, so it created a second Service Request.

Partial protection existed. A submission carrying attachments was de-duplicated on the attachment batch token plus a `submission_digest` content checksum, because the batch is finalized against the request it created. An attachment-free submission — the common case — had nothing.

[ADR-009](ADR-009-secure-requester-tracking.md) made this consequential rather than merely untidy. Automatic requester-intake issuance mints a tracking credential inside the creation transaction, so a duplicated submission would also mint a second credential and a second issuance audit event. That is why F065 shipped disabled and why all-submission idempotency is its first activation prerequisite.

The repository already had an idempotency convention. Internal notes and requester correspondence accept an `Idempotency-Key` header, carry it to an `INSERT ... ON CONFLICT DO NOTHING RETURNING`, compare the stored payload on conflict, and write their audit event only on a genuine insert. What was missing was the harder case: for a note the parent request already exists, so the uniqueness constraint can live on the note row. For request *creation* there is no parent yet — the request is the thing being created.

## Decision

Accept a client-generated `Idempotency-Key` on submission and bind it, in one database row, to the request it created.

**Required on resident PUBLIC intake, optional on staff and trusted intake.** The resident controller refuses a missing or malformed key, so no resident submission can reach the creation path without an idempotency scope — which is what lets F065's prerequisite be stated as a property of the system rather than a hope about clients. A server-generated fallback was rejected: it would make every retry a new key, and therefore a new request, which is the exact failure being prevented. The staff and trusted routes keep their published contracts and honour a key when one is supplied.

**Scoped server-side.** The reservation is keyed on `(organization_id, submission_scope, key_digest)`. The Organization comes from the resolved tenant context and is a separate column and a separate foreign key, so no client-supplied value participates in tenant scoping. The scope string carries the audience and channel, and for staff intake the acting staff identity, so one staff member's key can neither collide with nor replay another's. Anonymous resident intake has no requester identity to bind; the fingerprint binding below is what prevents a key collision from returning someone else's receipt.

**Digest only.** Only `sha256(domain-separator || key)` is stored. A disclosed backup cannot be replayed against the submission endpoint, and the stored value has a fixed shape regardless of what a client sent.

**Bound to a canonical fingerprint.** The key is stored alongside a fingerprint built on the digest the creation path already computed for attachment binding, with the attachment batch's identity folded in. One canonical shape therefore serves both mechanisms and they cannot drift apart. A key presented with a different payload is refused rather than being answered with the first submission's receipt, which would silently discard the second submission. The batch *token* is excluded: a bearer value does not belong in a stored digest, and `batchId` identifies the batch without it.

**No persisted in-progress state.** The reservation is inserted inside the same transaction that creates the request, so an uncommitted reservation is invisible to other sessions and a rolled back or killed submission releases its key automatically. A persisted `pending` marker was rejected: it would have to be reaped after a process dies, and until it was it would refuse the retry it exists to serve.

**Concurrency resolved by the database.** `ON CONFLICT DO NOTHING` is the serialization point. A second transaction presenting the same key waits on the first, then either observes the committed row — a replay — or, if the first rolled back, wins the key itself. Exactly one request commits per key, enforced by PostgreSQL rather than by application sequencing. The wait is bounded by a transaction-local `lock_timeout` and a timeout is reported as an explicit, retryable conflict; it is never retried in the server, because retrying contention is how a duplicate gets created.

**The foreign key is deferred.** The application generates the request UUID before inserting either row, so the reservation can be taken *first* — which is what makes concurrent callers block before performing expensive validation rather than after — while the reference is still verified at commit. A committed reservation therefore always resolves to a request that exists, with no nullable column and no deferred check trigger needed to express it.

**Append-only.** Update and delete are refused by trigger, and the runtime role is granted `SELECT` and `INSERT` only. A rewritable reservation could be repointed at another request, which is the one way this table could hand a receipt to the wrong caller.

**No copied receipt.** Reference number and status are read back through `service_request_id`, so the request row stays the single source of truth and a replay cannot serve a stale reference. A replay returns the original creation receipt — `status: 'open'` — never current workflow state, matching the existing attachment-batch replay.

**The retry window is decided by the database clock.** `expires_at` is written from `clock_timestamp()` and expiry is evaluated in SQL against the same clock, exactly as ADR-009 evaluates credential expiry, so an application clock that is skewed or that a caller could influence cannot widen a window the database recorded. Only a positive answer that the window is still open permits a replay.

**Past the window, a key is refused.** It is neither replayed nor allowed to quietly create a second request, because a duplicate that a client reads as an exact replay is worse than an honest refusal. The default window is 24 hours, bounded at 1 and 168, clamped the way ADR-009 clamps a credential lifetime so a future configuration surface cannot exceed the platform maximum.

**Refusals carry codes.** `SUBMISSION_KEY_REUSED`, `SUBMISSION_RETRY_WINDOW_CLOSED` and `SUBMISSION_IN_PROGRESS` are admitted through the error filter's allowlist. This is behavioural, not cosmetic: an unrecognized 409 from intake is treated by the resident client as a stale catalog version and discards the submission the resident just made. Each code concerns only a key the caller supplied and names no request, reference or tenant.

## Interaction with ADR-009 requester tracking

The credential-security model is unchanged. Digest-only storage, the one-active-credential rule, credential immutability, PUBLIC-only parents and staff-only rotation all stand, and nothing here introduces reversible credential storage.

A replay returns before every creation side effect, so it mints no second credential, rotates and revokes nothing, and writes no second issuance audit event.

**The lost-response problem is not fully solvable and is not claimed to be.** When the server commits a submission and the client loses the response, the raw credential is gone: it was returned exactly once and only its digest was stored. Four recovery designs were assessed.

1. *Return the original safe receipt without the credential.* *Adopted.* The replay carries the request identity, reference and creation timestamp.
2. *Hold the raw credential briefly in a trusted delivery mechanism.* **Rejected.** Any such mechanism is reversible credential storage, which this slice is not authorized to introduce and which would weaken ADR-009 to solve a different problem.
3. *A separately authenticated recovery or rotation process.* *Already exists.* Staff rotation under `service_request.tracking.manage` is the sanctioned path, and F066 adds no permission and no new route. A public endpoint keyed on a reference number or any guessable identifier was rejected outright.
4. *Say plainly that the link cannot be recovered and name the path that can help.* *Adopted.* A replay reports `issued_unrecoverable` when the original submission minted a credential, and the confirmation tells the resident to contact the service team for a new link.

So a replay is a safe receipt, **not** tracking-link recovery, and the response is deliberately worded so it cannot be read as the latter. Whether a credential existed is recorded on the reservation at insert time, because it cannot be inferred later without consulting — or weakening — the credential table.

## Residual risks

A key collision between two anonymous residents would require both the same 122-bit random key and the same canonical payload; a differing payload is refused rather than answered with the other submission's receipt. A caller who guessed a key would learn that it is in use, which is inherent to any idempotency contract and is not enumerable at this key size; no reference, identity or tenant is disclosed.

Retention is bounded in semantics but not yet in storage. Nothing deletes reservations, because a privileged scheduler is not authorized here; rows are one per committed submission and carry no payload, and `expires_at` plus its index make a future, separately authorized retention job straightforward.

The window is a single platform default. There is no tenant administration surface, so changing it requires a reviewed code change rather than configuration.

An attachment-bearing retry is still de-duplicated by the attachment-batch mechanism, which returns the original receipt without the replay marker, because that check necessarily runs before the reservation can name a request. The outcome — one request — is the same; only the response shape differs between the two paths.
