import { NotFoundException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import type { Permission, StaffAccess } from '../auth/auth.types.js';
import { permissions } from '../auth/auth.types.js';
import {
  effectivePermissionContributions,
  recognizedPermissions,
} from '../auth/effective-permissions.js';
import {
  accessPermissionMetadata,
  accessPrerequisites,
  manageablePermissions,
} from './access-policy.js';
import { safeStaffName } from '../service-request/ownership-targets.js';
const permissionCatalog = permissions.map((key) => ({
  key,
  ...accessPermissionMetadata[key],
}));
async function accessPrincipal(
  db: Kysely<DatabaseSchema>,
  org: string,
  id: string,
) {
  const result = await db
    .selectFrom('staff_identity as s')
    .select(['s.id', 's.active', safeStaffName.as('displayName')])
    .where('s.organization_id', '=', org)
    .where('s.id', '=', id)
    .executeTakeFirst();
  if (!result) throw new NotFoundException('Staff access unavailable');
  return result;
}
export async function accessDetailProjection(
  trx: Kysely<DatabaseSchema>,
  access: StaffAccess,
  id: string,
  authorizationRevision: string,
) {
  const org = access.organizationId,
    staff = await accessPrincipal(trx, org, id);
  const rows = await effectivePermissionContributions(trx, org)
    .leftJoin('access_role_ownership as w', 'w.role_id', 'role.id')
    .select('w.kind')
    .where('assignment.staff_identity_id', '=', id)
    .execute();
  const rawOwned = await trx
    .selectFrom('access_role_ownership as w')
    .innerJoin('role as r', 'r.id', 'w.role_id')
    .leftJoin('role_permission as p', 'p.role_id', 'r.id')
    .leftJoin('staff_role_assignment as a', (join) =>
      join
        .onRef('a.role_id', '=', 'r.id')
        .onRef('a.staff_identity_id', '=', 'w.staff_identity_id'),
    )
    .select([
      'p.permission_key',
      'r.active as roleActive',
      'a.active as assignmentActive',
    ])
    .where('w.organization_id', '=', org)
    .where('w.staff_identity_id', '=', id)
    .where('w.kind', '=', 'operational')
    .execute();
  const integrityWarning = rawOwned.some(
    (r) =>
      !r.roleActive ||
      !r.assignmentActive ||
      (r.permission_key !== null &&
        !manageablePermissions.includes(r.permission_key as Permission)),
  );
  const canConfigure =
    staff.active &&
    id !== access.staffIdentityId &&
    !access.development &&
    accessPrerequisites.every((k) => access.permissions.includes(k)) &&
    !integrityWarning;
  const effective = staff.active
    ? recognizedPermissions(rows.map((r) => r.permission_key))
    : [];
  const contributions = effective.map((key) => ({
    key,
    managed: rows.some(
      (r) => r.permission_key === key && r.kind === 'operational',
    ),
    existing: rows.some(
      (r) => r.permission_key === key && r.kind !== 'operational',
    ),
    sourceCount: new Set(
      rows.filter((r) => r.permission_key === key).map((r) => r.role_id),
    ).size,
  }));
  const departments = await trx
    .selectFrom('staff_department_membership as m')
    .innerJoin('department as d', 'd.id', 'm.department_id')
    .select(['d.id', 'd.name', 'd.status'])
    .where('m.organization_id', '=', org)
    .where('m.staff_identity_id', '=', id)
    .where('m.active', '=', true)
    .orderBy('d.name')
    .execute();
  const divisions = await trx
    .selectFrom('staff_division_membership as m')
    .innerJoin('division as d', 'd.id', 'm.division_id')
    .select(['d.id', 'd.name', 'd.status', 'm.department_id as departmentId'])
    .where('m.organization_id', '=', org)
    .where('m.staff_identity_id', '=', id)
    .where('m.active', '=', true)
    .orderBy('d.name')
    .execute();
  return {
    staff,
    effective,
    contributions,
    departments,
    divisions,
    authorizationRevision,
    readOnly: !canConfigure,
    canConfigure,
    integrityWarning,
    accessAdministrator: accessPrerequisites.every((k) =>
      effective.includes(k),
    ),
    permissions: permissionCatalog,
  };
}
