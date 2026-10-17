import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { type Kysely, type Transaction } from 'kysely';
import type { RequesterAccess } from '../auth/auth.types.js';
import type { DatabaseSchema } from '../database/database.types.js';
import { lockStaff } from '../database/reference-locks.js';
import { lockRequestOrganization } from './request-authorization.js';
import { requestUuid } from './staff-request-scope.js';

type Db = Kysely<DatabaseSchema>;

export function assertRequesterIdentity(
  access: RequesterAccess | undefined,
): asserts access is RequesterAccess {
  if (
    !access?.tenantId ||
    !access.objectId ||
    !requestUuid.test(access.organizationId) ||
    !requestUuid.test(access.staffIdentityId)
  )
    throw new ForbiddenException('Access denied');
}

/**
 * F064.1: re-establish the requester's identity inside the transaction.
 *
 * The guard resolved the identity before the request reached the service, so
 * it is re-checked here under a shared lock: a deactivation, an organization
 * suspension or a revoked access state that lands between admission and query
 * must take effect on this read, not the next one. Mirrors the staff barrier in
 * authorizeRequestTransaction, minus every permission lookup.
 */
export async function authorizeRequesterTransaction(
  trx: Transaction<DatabaseSchema>,
  trusted: RequesterAccess | undefined,
): Promise<RequesterAccess> {
  assertRequesterIdentity(trusted);
  await lockRequestOrganization(trx, trusted.organizationId);
  const state = await trx
    .selectFrom('organization_access_state')
    .select('organization_id')
    .where('organization_id', '=', trusted.organizationId)
    .forShare()
    .executeTakeFirst();
  if (!state) throw new ForbiddenException('Access denied');
  // Liveness is asserted through the owner-owned helper, which carries the
  // same active predicate. staff_identity must never take a native row lock
  // here: the helper exists precisely so this path needs no extra database
  // privilege, and the runtime reference-lock boundary enforces that.
  if (!(await lockStaff(trx, trusted.organizationId, trusted.staffIdentityId)))
    throw new ForbiddenException('Access denied');
  const identity = await trx
    .selectFrom('staff_identity as identity')
    .innerJoin(
      'organization as organization',
      'organization.id',
      'identity.organization_id',
    )
    .select('identity.id')
    .where('identity.id', '=', trusted.staffIdentityId)
    .where('identity.organization_id', '=', trusted.organizationId)
    .where('identity.entra_tenant_id', '=', trusted.tenantId)
    .where('identity.entra_object_id', '=', trusted.objectId)
    .where('identity.active', '=', true)
    .where('organization.status', '=', 'active')
    .executeTakeFirst();
  if (!identity) throw new ForbiddenException('Access denied');
  return trusted;
}

/**
 * F064.1: the only query root a requester path may read requests through.
 *
 * Ownership is the authorization, expressed in SQL on a trusted identity:
 * the organization and requester identity come from the resolved context, never
 * from a caller. There is deliberately no department or division predicate --
 * unlike staffRequestScope -- because a requester keeps their own request after
 * it is routed elsewhere, and conversely a staff member's departmental reach
 * must not become requester ownership. `audience = 'internal'` keeps this path
 * off public requests, which have their own guest tracking boundary.
 */
export function internalRequesterScope(db: Db, access: RequesterAccess) {
  return db
    .selectFrom('service_request as request')
    .innerJoin('organization', 'organization.id', 'request.organization_id')
    .where('request.organization_id', '=', access.organizationId)
    .where('organization.status', '=', 'active')
    .where('request.audience', '=', 'internal')
    .where('request.requester_staff_identity_id', '=', access.staffIdentityId);
}

/**
 * A request this requester does not own is reported exactly as one that does
 * not exist, so the endpoint cannot be used to discover whether a colleague's
 * request is present. A malformed id takes the same path.
 */
export function requesterRequestId(id: string): string {
  if (!requestUuid.test(id)) throw new NotFoundException();
  return id;
}
