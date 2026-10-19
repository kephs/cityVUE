import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

/**
 * F066: tenant-scoped idempotency for service-request submission.
 *
 * One row records one authorized submission that committed. Three structural
 * decisions carry the invariant, and each exists because the obvious
 * alternative is unsafe.
 *
 * First, there is no `pending` lifecycle state and no reservation that
 * outlives its transaction. The row is inserted inside the same transaction
 * that creates the request, so an uncommitted row is invisible and a rolled
 * back or killed submission leaves nothing behind. A persisted `pending`
 * marker would have to be reaped after a process dies, and until it was it
 * would refuse the retry it exists to serve. Concurrency is instead resolved
 * by the unique constraint: a second transaction inserting the same key waits
 * on the first, then either observes the committed row -- a replay -- or, if
 * the first rolled back, wins the key itself.
 *
 * Second, the foreign key to the created request is `deferrable initially
 * deferred`. The application generates the request UUID before inserting
 * either row, so the reservation can be taken *first* -- which is what makes
 * concurrent callers block before performing expensive validation rather than
 * after -- while the reference is still verified at commit. A committed row
 * therefore always resolves to a request that exists, and no nullable column
 * or deferred check trigger is needed to express it.
 *
 * Third, no receipt fields are copied here. Reference number and status are
 * read back through `service_request_id`, so the request row stays the single
 * source of truth and a replay cannot serve a stale reference. The one piece
 * of recorded metadata is `tracking_issued`, because whether the original
 * submission minted an F065 credential cannot be inferred later: the raw
 * credential is unrecoverable by design, and a replay must be able to say
 * "a link was issued and cannot be recovered" without consulting -- or
 * weakening -- the credential table.
 *
 * `expires_at` bounds the retry window. It governs semantics, not deletion:
 * nothing here deletes rows, because a privileged retention worker is not
 * authorized in this slice. Past that horizon a key is refused rather than
 * being allowed to silently create a second request that a client would read
 * as an exact replay.
 */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    create table request_submission_idempotency (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organization(id),
      -- The authorized submission context, derived server-side. A client
      -- cannot supply or influence it, so one caller's key can never address
      -- another caller's scope.
      submission_scope text not null
        check (length(submission_scope) between 1 and 120
               and submission_scope ~ '^[a-z][a-z0-9:_-]*$'),
      -- Only the digest of the client key is stored. The raw key never
      -- reaches the database, so a disclosed backup cannot be replayed
      -- against the submission endpoint.
      key_digest text not null check (key_digest ~ '^[0-9a-f]{64}$'),
      -- Canonical submission fingerprint. Binding it to the key is what makes
      -- "same key, different payload" a refusal instead of a wrong receipt.
      fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
      service_request_id uuid not null,
      tracking_issued boolean not null,
      created_at timestamptz not null default clock_timestamp(),
      expires_at timestamptz not null check (expires_at > created_at),
      -- Deferred, so the reservation may precede the request it names while
      -- still being verified before commit.
      foreign key (organization_id, service_request_id)
        references service_request(organization_id, id)
        deferrable initially deferred,
      -- The whole guarantee: at most one committed submission per authorized
      -- scope and key, enforced by PostgreSQL rather than by application
      -- sequencing.
      unique (organization_id, submission_scope, key_digest)
    );
    -- One committed submission occupies one key, so a request is named at
    -- most once. Without this, a second key could claim an existing request
    -- and hand its receipt to a different caller.
    create unique index request_submission_idempotency_request_idx
      on request_submission_idempotency(organization_id, service_request_id);
    -- Supports a future, separately authorized retention job. Nothing in this
    -- slice reads or deletes by expiry.
    create index request_submission_idempotency_expiry_idx
      on request_submission_idempotency(organization_id, expires_at);
    -- Append-only. A rewritable reservation could be repointed at another
    -- request, which is the one way this table could leak a receipt across
    -- requesters.
    create function prevent_request_submission_idempotency_mutation()
      returns trigger language plpgsql as $$
      begin raise exception 'submission idempotency records are append-only'; end $$;
    create trigger request_submission_idempotency_immutable
      before update or delete on request_submission_idempotency
      for each row execute function prevent_request_submission_idempotency_mutation();
    create trigger request_submission_idempotency_no_truncate
      before truncate on request_submission_idempotency
      for each statement execute function prevent_request_submission_idempotency_mutation();
  `.execute(db);
}

/**
 * Fail-closed. Dropping the table while reservations exist would silently
 * restore duplicate submission: every recorded key would become unknown, so
 * the next retry of an already-committed submission would create a second
 * request and a second F065 credential. The guard refuses instead, and never
 * deletes a reservation to make itself pass.
 */
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table request_submission_idempotency in access exclusive mode;
    do $$ begin
      if exists(select 1 from request_submission_idempotency)
      then raise exception 'Recorded submission idempotency reservations prevent rollback'; end if;
    end $$;
    drop trigger request_submission_idempotency_no_truncate on request_submission_idempotency;
    drop trigger request_submission_idempotency_immutable on request_submission_idempotency;
    drop table request_submission_idempotency;
    drop function prevent_request_submission_idempotency_mutation();
  `.execute(db);
}
