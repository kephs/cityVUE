import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { type Kysely, type Transaction } from 'kysely';
import type { StaffAccess, Permission } from '../auth/auth.types.js';
import { effectivePermissions } from '../auth/effective-permissions.js';
import type { DatabaseSchema } from '../database/database.types.js';
import {
  assertStaffRequestIdentity,
  requestUuid,
} from './staff-request-scope.js';

type Db = Kysely<DatabaseSchema>;

/** Lock the parent separately so joined scope queries cannot choose the lock order. */
export async function lockRequestRow(
  db: Db,
  organizationId: string,
  id: string,
  write: boolean,
) {
  if (!requestUuid.test(id)) throw new NotFoundException();
  let query = db
    .selectFrom('service_request')
    .select('id')
    .where('organization_id', '=', organizationId)
    .where('id', '=', id);
  query = write ? query.forUpdate() : query.forShare();
  if (!(await query.executeTakeFirst())) throw new NotFoundException();
}

/** Acquire before any request, scope, target or attachment lock. */
export async function lockRequestOrganization(db: Db, organizationId: string) {
  const organization = await db
    .selectFrom('organization')
    .select('id')
    .where('id', '=', organizationId)
    .where('status', '=', 'active')
    .forShare()
    .executeTakeFirst();
  if (!organization) throw new NotFoundException();
}

/** No locks: caller supplies either the authorization barrier or a coherent read snapshot. */
export async function resolveRequestAuthority(
  db: Db,
  trusted: StaffAccess | undefined,
): Promise<StaffAccess> {
  assertStaffRequestIdentity(trusted);
  const { tenantId, objectId } = trusted;
  if (!tenantId || !objectId) throw new ForbiddenException('Access denied');
  const actor = await db
    .selectFrom('staff_identity as s')
    .innerJoin('organization as o', 'o.id', 's.organization_id')
    .select(['s.id', 's.display_name'])
    .where('s.id', '=', trusted.staffIdentityId)
    .where('s.organization_id', '=', trusted.organizationId)
    .where('s.entra_tenant_id', '=', tenantId)
    .where('s.entra_object_id', '=', objectId)
    .where('s.active', '=', true)
    .where('o.status', '=', 'active')
    .executeTakeFirst();
  if (!actor) throw new ForbiddenException('Access denied');
  const permissions = await effectivePermissions(
    db,
    trusted.organizationId,
    actor.id,
  );
  const departments = await db
    .selectFrom('staff_department_membership')
    .select('department_id')
    .where('organization_id', '=', trusted.organizationId)
    .where('staff_identity_id', '=', actor.id)
    .where('active', '=', true)
    .execute();
  const divisions = await db
    .selectFrom('staff_division_membership')
    .select('division_id')
    .where('organization_id', '=', trusted.organizationId)
    .where('staff_identity_id', '=', actor.id)
    .where('active', '=', true)
    .execute();
  return {
    ...trusted,
    displayName: actor.display_name,
    permissions,
    departmentIds: departments.map((row) => row.department_id),
    divisionIds: divisions.map((row) => row.division_id),
  };
}

export async function authorizeRequestTransaction(
  db: Db,
  trusted: StaffAccess | undefined,
  required: readonly Permission[] = [],
) {
  assertStaffRequestIdentity(trusted);
  await lockRequestOrganization(db, trusted.organizationId);
  const state = await db
    .selectFrom('organization_access_state')
    .select('organization_id')
    .where('organization_id', '=', trusted.organizationId)
    .forShare()
    .executeTakeFirst();
  if (!state) throw new ForbiddenException('Access denied');
  const access = await resolveRequestAuthority(db, trusted);
  if (required.some((permission) => !access.permissions.includes(permission)))
    throw new ForbiddenException('Access denied');
  return access;
}

/** READ COMMITTED resolves authority after waiting; never retries a consequential operation. */
export function requestTransaction<T>(
  db: Db,
  trusted: StaffAccess | undefined,
  required: readonly Permission[],
  operation: (
    trx: Transaction<DatabaseSchema>,
    access: StaffAccess,
  ) => Promise<T>,
) {
  return db
    .transaction()
    .setIsolationLevel('read committed')
    .execute(async (trx) => {
      const access = await authorizeRequestTransaction(trx, trusted, required);
      return operation(trx, access);
    });
}
