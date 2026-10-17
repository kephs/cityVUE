import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import {
  generateTrackingCredential,
  trackingLifetimeDays,
} from './request-tracking.domain.js';

/**
 * F065: automatic tracking issuance for a successfully created PUBLIC request.
 *
 * This is a plain function rather than a service method because it must run
 * inside the caller's already-authorized creation transaction. No HTTP route
 * reaches it: the only call site is the resident PUBLIC intake path in
 * `CreateServiceRequestService`, which supplies the Organization and request
 * identity. Neither is ever taken from a caller.
 *
 * It consults no permission and grants none, so there is no path by which a
 * requester could issue a credential for an arbitrary existing request. The
 * caller gates it on its own feature flag; this function does not re-read
 * configuration, so it cannot be reached by accident with the flag off.
 *
 * Because the insert shares the caller's transaction, request, credential and
 * audit commit together: a failure here rolls the submission back rather than
 * leaving a request whose credential was never recorded. INTERNAL requests are
 * excluded by the caller and, independently, by the insert trigger's
 * PUBLIC-parent requirement.
 */
export async function issueIntakeTrackingCredential(
  trx: Transaction<DatabaseSchema>,
  organizationId: string,
  requestId: string,
  actorType: 'anonymous_resident' | 'identified_resident',
): Promise<{ credential: string; expiresAt: string }> {
  // The tenant's approved lifetime, read inside the authorizing transaction.
  // Migration backfills every Organization and a trigger initializes new
  // ones, so a missing row should be impossible; the domain clamp bounds
  // whatever is read regardless, so a relaxed CHECK could not widen it.
  const policy = await trx
    .selectFrom('request_tracking_policy')
    .select('credential_lifetime_days')
    .where('organization_id', '=', organizationId)
    .forShare()
    .executeTakeFirst();
  const lifetime = trackingLifetimeDays(policy?.credential_lifetime_days);
  const generated = generateTrackingCredential();
  const row = await trx
    .insertInto('request_tracking_credential')
    .values({
      organization_id: organizationId,
      service_request_id: requestId,
      credential_digest: generated.digest,
      status: 'active',
      // A resident has no staff_identity row and none is invented; issuer_type
      // carries the attribution instead.
      created_by_staff_identity_id: null,
      issuer_type: 'requester_intake',
      // Computed by the database, so the creation stamp and its expiry share
      // one clock and the expiry CHECK holds strictly.
      expires_at: sql<Date>`clock_timestamp() + make_interval(days => ${sql.lit(lifetime)})`,
      revoked_at: null,
    })
    .returning(sql<string>`expires_at::text`.as('expires_at'))
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('activity')
    .values({
      id: randomUUID(),
      organization_id: organizationId,
      service_request_id: requestId,
      activity_type: 'requester_tracking_issued',
      actor_type: actorType,
      actor_reference: null,
      staff_identity_id: null,
      metadata: {
        policy: 'F065',
        action: 'tracking_issued',
        issuerType: 'requester_intake',
        correlationId: randomUUID(),
      },
    })
    .execute();
  // The raw value exists only here and in the one-time creation response.
  // Only the digest was persisted.
  return {
    credential: generated.credential,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}
