import { ConflictException } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import {
  classifySubmission,
  submissionRetentionHours,
  SUBMISSION_IN_PROGRESS,
  SUBMISSION_RETENTION_DEFAULT_HOURS,
  type SubmissionOutcome,
} from './submission-idempotency.js';

/**
 * PostgreSQL raises this when a lock wait exceeds `lock_timeout`. A
 * speculative insert that conflicts with an *uncommitted* row waits on that
 * transaction, so this is precisely the "an earlier submission is still in
 * progress" signal rather than a generic failure.
 */
const LOCK_NOT_AVAILABLE = '55P03';
const SERIALIZATION_FAILURE = '40001';
const DEADLOCK_DETECTED = '40P01';

function contentionCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * F066: claims a submission key, or reports what an existing reservation means.
 *
 * A plain function rather than a service method, for the same reason F065's
 * issuance is one: it must run inside the caller's already-authorized creation
 * transaction, and that is what makes the guarantee hold without a persisted
 * pending state. An uncommitted reservation is invisible to other sessions,
 * and a rolled back or killed submission releases its key automatically, so
 * nothing has to be reaped and no in-progress record can outlive the attempt
 * it describes.
 *
 * Being a function also means it cannot be absent. An injected, optional
 * collaborator that resolved to `undefined` would silently disable
 * deduplication, and a silently-skipped reservation is exactly the duplicate
 * this exists to prevent.
 *
 * No update or delete path exists here, and the table's triggers refuse both,
 * so a reservation can never be repointed at a different request.
 */
export async function reserveSubmission(
  trx: Transaction<DatabaseSchema>,
  input: {
    organizationId: string;
    scope: string;
    keyDigest: string;
    fingerprint: string;
    requestId: string;
    trackingIssued: boolean;
    retentionHours?: number;
  },
): Promise<SubmissionOutcome> {
  const hours = submissionRetentionHours(
    input.retentionHours ?? SUBMISSION_RETENTION_DEFAULT_HOURS,
  );
  let claimed: { id: string } | undefined;
  try {
    // Bounded, and scoped to this transaction only. Restored immediately after
    // so the rest of the creation path keeps the server's configured waits.
    await sql`set local lock_timeout = '5s'`.execute(trx);
    // `ON CONFLICT DO NOTHING` is the serialization point. When a concurrent
    // transaction holds this key uncommitted, PostgreSQL makes this statement
    // wait on it and then resolves honestly: if that transaction committed, no
    // row is inserted here and its result is read back below as a replay; if
    // it rolled back, the key is free and this caller wins it. Either way
    // exactly one request commits per key, enforced by the database rather
    // than by application sequencing.
    claimed = await trx
      .insertInto('request_submission_idempotency')
      .values({
        organization_id: input.organizationId,
        submission_scope: input.scope,
        key_digest: input.keyDigest,
        fingerprint: input.fingerprint,
        service_request_id: input.requestId,
        tracking_issued: input.trackingIssued,
        expires_at: sql<Date>`clock_timestamp() + make_interval(hours => ${sql.lit(hours)})`,
      })
      .onConflict((oc) =>
        oc
          .columns(['organization_id', 'submission_scope', 'key_digest'])
          .doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
  } catch (error) {
    const code = contentionCode(error);
    // Reported, never retried. Retrying contention is how a duplicate gets
    // created; an explicit conflict lets the client retry the whole
    // submission with the same key and resolve deterministically.
    if (
      code === LOCK_NOT_AVAILABLE ||
      code === SERIALIZATION_FAILURE ||
      code === DEADLOCK_DETECTED
    )
      throw new ConflictException({
        code: SUBMISSION_IN_PROGRESS,
        message:
          'An earlier copy of this submission is still being processed. Wait a moment and try again.',
      });
    throw error;
  }
  if (claimed) {
    await sql`set local lock_timeout = default`.execute(trx);
    return { kind: 'first' };
  }
  // The conflicting row is committed: `DO NOTHING` only declines once the
  // competing transaction has resolved, and a rolled back competitor would
  // have left the key free.
  const recorded = await trx
    .selectFrom('request_submission_idempotency')
    .select([
      'fingerprint',
      'service_request_id',
      'tracking_issued',
      // Evaluated by the database against the same clock that wrote
      // `expires_at`, so an application clock cannot widen the window.
      sql<boolean>`expires_at <= clock_timestamp()`.as('expired'),
    ])
    .where('organization_id', '=', input.organizationId)
    .where('submission_scope', '=', input.scope)
    .where('key_digest', '=', input.keyDigest)
    .executeTakeFirst();
  await sql`set local lock_timeout = default`.execute(trx);
  // The insert declined but no row is visible. That should be unreachable --
  // the table has no delete path and the competitor had committed -- so it is
  // refused rather than interpreted. Treating an absent row as a free key is
  // the one mistake here that would create the duplicate.
  if (recorded === undefined)
    throw new ConflictException({
      code: SUBMISSION_IN_PROGRESS,
      message:
        'An earlier copy of this submission is still being processed. Wait a moment and try again.',
    });
  return classifySubmission(
    {
      fingerprint: recorded.fingerprint,
      service_request_id: recorded.service_request_id,
      tracking_issued: recorded.tracking_issued,
      expired: recorded.expired,
    },
    input.fingerprint,
  );
}
