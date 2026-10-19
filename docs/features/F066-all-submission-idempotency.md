# F066 — All-submission idempotency

Secure retry handling, duplicate prevention and tracking-credential recovery for every authorized Reqro service-request submission.

The durable decisions are in [ADR-031](../architecture/decisions/ADR-031-submission-idempotency.md). This record covers scope, contract, validation and limitations.

## Why this exists

A resident submits a request, the response is lost, and the resident submits again. Before F066 that created a second Service Request.

Only attachment-bearing submissions were protected, de-duplicated on the attachment batch token plus a content checksum. The common case — an attachment-free submission — had nothing. [ADR-009](../architecture/decisions/ADR-009-secure-requester-tracking.md) made that consequential: automatic requester-intake issuance would mint a second tracking credential and a second issuance audit event for the duplicate. All-submission idempotency is therefore F065's first activation prerequisite, and closing it is the point of this slice.

## The contract

Resident intake requires an `Idempotency-Key` request header: a client-generated UUID. Reuse it for safe retries of the same submission; generate a new one for a new submission. A missing or malformed key is refused with 400 — never defaulted, because a server-generated key would make every retry look like a new submission.

The staff intake route accepts the header and honours it, but does not require it, so its published contract is unchanged. A malformed key there is refused rather than ignored: silently dropping it would promise deduplication that was not applied.

Five outcomes are distinguished.

| Situation | Result |
|---|---|
| First authorized submission | 201 with the ordinary receipt, no `replay` field |
| Exact replay of a committed submission | 201 with the **original** receipt and `replay.tracking` |
| An earlier copy still in progress | 409 `SUBMISSION_IN_PROGRESS` — retrying with the same key is safe |
| Key reused with a different payload | 409 `SUBMISSION_KEY_REUSED` — send it as a new submission |
| Retry window closed | 409 `SUBMISSION_RETRY_WINDOW_CLOSED` — send it as a new submission |

A replay returns the original identity, reference number and creation timestamp, and `status: 'open'` — the original creation receipt, never current workflow state, matching the existing attachment-batch replay. It runs before every creation side effect, so no second request, credential, audit event or attachment association is produced.

## Schema

`request_submission_idempotency`, added by `server/migrations/20261031000000-add-submission-idempotency.ts`:

- `unique (organization_id, submission_scope, key_digest)` — the guarantee, enforced by PostgreSQL
- `key_digest`, `fingerprint` — SHA-256 hex, checked by regex; the raw key never reaches the database
- `service_request_id` — `not null`, with a **deferrable initially deferred** composite foreign key, so the reservation can be taken before the request it names while still being verified at commit
- `tracking_issued` — whether the original submission minted an F065 credential
- `created_at`, `expires_at` — written from `clock_timestamp()`, with `expires_at > created_at`
- append-only: update, delete and truncate are refused by trigger, and the runtime role is granted `SELECT`/`INSERT` only

There is deliberately **no** persisted in-progress state. The reservation lives inside the creation transaction, so an uncommitted one is invisible and a rolled back or killed submission releases its key automatically.

## Key lifecycle in the resident client

The key is minted when the submission's content changes and reused for every retry of the same content, mirroring the key handling the internal-note and correspondence clients already use. A timeout or lost response can therefore be retried safely; an edited submission is sent under a new key and is never mistaken for a replay of the previous attempt. The existing in-flight guard still prevents double-click submission.

A `SUBMISSION_KEY_REUSED` or `SUBMISSION_RETRY_WINDOW_CLOSED` refusal discards the key, because retrying under it would be refused forever. `SUBMISSION_IN_PROGRESS` keeps it, because retrying with it is exactly what resolves to the original request.

**The key is held in memory only.** It is never written to `localStorage`, `sessionStorage`, a query string, the document title or an analytics call. Persisting it was assessed and rejected: a reload discards the in-progress form too, so a stored key could no longer be paired with the submission it belonged to and the server would correctly refuse it as a different payload. Nothing is stored, so no F065 bearer credential can be stored either.

## Tracking-link recovery

**A replay is a safe receipt, not tracking-link recovery.** ADR-031 records the four designs assessed. Where the original submission minted a credential, the replay reports `issued_unrecoverable` and the confirmation says the link cannot be shown again and to contact the service team for a new one. Staff rotation under the existing `service_request.tracking.manage` permission remains the only replacement path; no permission and no public recovery endpoint were added, and no reversible credential storage was introduced.

## Validation

Backend `npm run validate` and the frontend suite and build are recorded in the completion report for the implementing commit. New and updated coverage:

| Layer | File | What it proves |
|---|---|---|
| Unit (12 tests) | `server/test/unit/submission-idempotency.test.ts` | Key shape, digest, scope derivation, fingerprint binding, every classification branch, the retention clamp, fail-closed on unreadable rows |
| PostgreSQL (15 subtests) | `server/test/database/submission-idempotency.integration.test.ts` | Migration ordering on top of F065, the unique constraint and deferred foreign key as PostgreSQL reports them, genuine concurrency, cross-tenant and cross-scope isolation, rollback releasing a key, append-only triggers, malformed-row refusal, no second credential on replay, and rollback integrity in both directions |
| HTTP + PostgreSQL (7 subtests) | `server/test/database/submission-idempotency-checks.ts` | The whole path through the real application: the key requirement, replay with no duplicate request, reservation or audit event, conflict codes that disclose nothing, concurrent retries committing one request, the key absent from storage and logs, and scope agreeing with request audience |
| Frontend (9 tests) | `react/test/SubmissionIdempotency.test.jsx` | Retries reuse the key, edited submissions get a new one, each refusal code is handled correctly, nothing reaches browser storage or the URL, and the replay confirmation makes no recovery claim |

Concurrency is proven against real PostgreSQL rather than mocked, and no test sleeps: the winning transaction takes its reservation before the contending statement is issued, so the contender must wait, and its outcome is read only after the winner commits.

## Known limitations

1. **Retention is bounded in semantics, not in storage.** Nothing deletes reservations; a privileged scheduler is not authorized in this slice. Rows are one per committed submission and carry no payload, and `expires_at` with its index make a future, separately authorized retention job straightforward.
2. **The retry window is a single platform default** of 24 hours (bounded 1–168). There is no tenant administration surface, so changing it is a reviewed code change rather than configuration.
3. **An attachment-bearing retry is de-duplicated by the attachment-batch mechanism** and returns the original receipt *without* the `replay` marker, because that check necessarily runs before a reservation can name a request. One request is created either way; only the response shape differs.
4. **A key collision between two anonymous residents** would require both the same 122-bit random key and the same canonical payload. A differing payload is refused rather than answered with the other submission's receipt, and the receipt carries no contact information.
5. **A conflict reveals that a key is in use.** Inherent to any idempotency contract, not enumerable at this key size, and it discloses no reference, identity or tenant.
6. **A page reload loses the key and the in-progress form,** so a submission reconstructed after a reload is a new submission. Where attachments are present the batch mechanism still de-duplicates it.
7. **The lost-response tracking link is unrecoverable by design.** See above; this is a property of ADR-009's digest-only storage, not a defect introduced here.

## Pre-activation requirements for F065

F066 implements ADR-009 activation prerequisite 1. It does **not** satisfy the rest, and nothing here activates anything.

- `REQRO_ENABLE_REQUESTER_INTAKE_TRACKING` remains **off**; F066 does not read, set or reference it for activation.
- Independent validation of this implementation is still outstanding; the evidence above is locally generated.
- The F065 migration and this one have **not** been applied to any persistent database.
- ADR-009 prerequisites 2–6 — migration applied under separate authorization, credential lifecycle and recovery support accepted, security regression tests passed, non-production rollout approved, explicit feature activation approved — all remain open.
