import { ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { EntraPrincipal } from './entra-token.service.js';
import {
  permissions,
  type Permission,
  type StaffAccess,
} from './auth.types.js';

@Injectable()
export class StaffAuthorizationService {
  constructor(private readonly database: DatabaseService) {}
  async resolve(principal: EntraPrincipal): Promise<StaffAccess> {
    const staff = await this.database.client
      .selectFrom('staff_identity')
      .select(['id', 'organization_id', 'display_name'])
      .where('entra_tenant_id', '=', principal.tenantId)
      .where('entra_object_id', '=', principal.objectId)
      .where('active', '=', true)
      .executeTakeFirst();
    if (!staff)
      throw new ForbiddenException(
        'CityVUE staff access has not been provisioned',
      );
    const [permissionRows, departments, divisions] = await Promise.all([
      this.database.client
        .selectFrom('staff_role_assignment as assignment')
        .innerJoin('role', 'role.id', 'assignment.role_id')
        .innerJoin('role_permission', 'role_permission.role_id', 'role.id')
        .select('role_permission.permission_key')
        .where('assignment.organization_id', '=', staff.organization_id)
        .where('assignment.staff_identity_id', '=', staff.id)
        .where('assignment.active', '=', true)
        .where('role.active', '=', true)
        .execute(),
      this.database.client
        .selectFrom('staff_department_membership')
        .select('department_id')
        .where('organization_id', '=', staff.organization_id)
        .where('staff_identity_id', '=', staff.id)
        .where('active', '=', true)
        .execute(),
      this.database.client
        .selectFrom('staff_division_membership')
        .select('division_id')
        .where('organization_id', '=', staff.organization_id)
        .where('staff_identity_id', '=', staff.id)
        .where('active', '=', true)
        .execute(),
    ]);
    const allowed = new Set<string>(permissions);
    const effective = [
      ...new Set(
        permissionRows
          .map((row) => row.permission_key)
          .filter((key): key is Permission => allowed.has(key)),
      ),
    ];
    return {
      tenantId: principal.tenantId,
      objectId: principal.objectId,
      staffIdentityId: staff.id,
      organizationId: staff.organization_id,
      displayName: staff.display_name,
      ...(principal.preferredUsername
        ? { preferredUsername: principal.preferredUsername }
        : {}),
      scopes: principal.scopes,
      permissions: effective,
      departmentIds: departments.map((row) => row.department_id),
      divisionIds: divisions.map((row) => row.division_id),
      development: false,
    };
  }
  assertPermission(access: StaffAccess, permission: Permission): void {
    if (!access.permissions.includes(permission))
      throw new ForbiddenException('Access denied');
  }
}
