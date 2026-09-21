import { ForbiddenException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Permission, StaffAccess } from '../auth/auth.types.js';
import type { DatabaseSchema } from '../database/database.types.js';

export type StaffRequestAudience = 'public' | 'internal';
export type StaffRequestAudienceFilter = StaffRequestAudience | 'all';
export const requestUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const requestDepartment = sql<string>`coalesce(request.routed_department_id, category.department_id)`;
export const requestDivision = sql<
  string | null
>`case when request.routed_department_id is null then category.division_id else request.routed_division_id end`;

export const requestReadPermission = {
  public: 'service_request.view',
  internal: 'service_request.internal.read',
} as const satisfies Record<StaffRequestAudience, Permission>;

export function assertStaffRequestIdentity(
  access: StaffAccess | undefined,
): asserts access is StaffAccess {
  if (
    !access ||
    access.development ||
    !access.tenantId ||
    !access.objectId ||
    !requestUuid.test(access.organizationId) ||
    !requestUuid.test(access.staffIdentityId)
  )
    throw new ForbiddenException('Access denied');
}

export function assertStaffRequestPermission(
  access: StaffAccess | undefined,
  permission: Permission,
): asserts access is StaffAccess {
  assertStaffRequestIdentity(access);
  if (!access.permissions.includes(permission))
    throw new ForbiddenException('Access denied');
}

export function readableRequestAudiences(
  access: StaffAccess,
): StaffRequestAudience[] {
  return (['public', 'internal'] as const).filter((audience) =>
    access.permissions.includes(requestReadPermission[audience]),
  );
}

export function assertStaffRequestRead(
  access: StaffAccess | undefined,
  audience: StaffRequestAudienceFilter = 'all',
): asserts access is StaffAccess {
  assertStaffRequestIdentity(access);
  if (
    audience === 'all'
      ? !readableRequestAudiences(access).length
      : !access.permissions.includes(requestReadPermission[audience])
  ) {
    throw new ForbiddenException('Access denied');
  }
}

/** Trusted Organization and effective operational scope. Callers must also apply an audience policy. */
export function staffRequestScope(
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
    .where((eb) =>
      access.departmentIds.length
        ? eb(requestDepartment, 'in', access.departmentIds)
        : sql<boolean>`false`,
    )
    .where((eb) =>
      access.divisionIds.length
        ? eb.or([
            eb(requestDivision, 'is', null),
            eb(requestDivision, 'in', access.divisionIds),
          ])
        : eb(requestDivision, 'is', null),
    );
}

/** One SQL authorization union; filters and pagination may only narrow this result. */
export function staffRequestReadScope(
  db: Kysely<DatabaseSchema>,
  access: StaffAccess,
  audience: StaffRequestAudienceFilter = 'all',
) {
  assertStaffRequestRead(access, audience);
  const allowed = readableRequestAudiences(access).filter(
    (value) => audience === 'all' || value === audience,
  );
  return staffRequestScope(db, access).where('request.audience', 'in', allowed);
}
