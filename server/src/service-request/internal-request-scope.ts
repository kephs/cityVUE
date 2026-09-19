import { ForbiddenException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Permission, StaffAccess } from '../auth/auth.types.js';
import type { DatabaseSchema } from '../database/database.types.js';

export const internalRequestUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const internalDepartment = sql<string>`coalesce(request.routed_department_id, category.department_id)`;
export const internalDivision = sql<
  string | null
>`case when request.routed_department_id is null then category.division_id else request.routed_division_id end`;

export function assertInternalAccess(
  access: StaffAccess | undefined,
  permission: Permission,
): asserts access is StaffAccess {
  if (
    !access ||
    access.development ||
    !access.tenantId ||
    !access.objectId ||
    !internalRequestUuid.test(access.organizationId) ||
    !internalRequestUuid.test(access.staffIdentityId) ||
    !access.permissions.includes(permission)
  )
    throw new ForbiddenException('Access denied');
}

/** Caller must first authorize the operation-specific permission on guard-resolved access. */
export function internalRequestScope(
  db: Kysely<DatabaseSchema>,
  access: StaffAccess,
) {
  return db
    .selectFrom('service_request as request')
    .innerJoin('organization', 'organization.id', 'request.organization_id')
    .innerJoin('category', (join) =>
      join
        .onRef('category.id', '=', 'request.category_id')
        .onRef('category.organization_id', '=', 'request.organization_id'),
    )
    .where('request.organization_id', '=', access.organizationId)
    .where('organization.status', '=', 'active')
    .where('request.audience', '=', 'internal')
    .where((eb) =>
      access.departmentIds.length
        ? eb(internalDepartment, 'in', access.departmentIds)
        : sql<boolean>`false`,
    )
    .where((eb) =>
      access.divisionIds.length
        ? eb.or([
            eb(internalDivision, 'is', null),
            eb(internalDivision, 'in', access.divisionIds),
          ])
        : eb(internalDivision, 'is', null),
    );
}
