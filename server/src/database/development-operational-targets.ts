import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from './database.types.js';
import {
  developmentOrganization,
  developmentUuid,
  selectedDevelopmentScopes,
  type DevelopmentStaffScope,
} from './development-staff-input.js';

/** Explicit local CLI only. No grants, identity creation, request changes, or runtime imports. */
export async function setupDevelopmentOperationalTargets(
  db: Kysely<DatabaseSchema>,
  input: {
    tenantId: string;
    staffId: string;
    organizationId: string;
    scopes: DevelopmentStaffScope[];
  },
  dryRun: boolean,
) {
  if (
    !developmentUuid.test(input.staffId) ||
    !developmentUuid.test(input.tenantId) ||
    input.organizationId !== developmentOrganization.id
  )
    throw new Error('Invalid development selection');
  selectedDevelopmentScopes(JSON.stringify(input.scopes));
  return db.transaction().execute(async (trx) => {
    if (dryRun) await sql`set transaction read only`.execute(trx);
    let q = trx
      .selectFrom('organization')
      .selectAll()
      .where('id', '=', input.organizationId);
    if (!dryRun) q = q.forUpdate();
    const org = await q.executeTakeFirst();
    if (
      org?.name !== developmentOrganization.name ||
      org.slug !== developmentOrganization.slug ||
      org.status !== 'active'
    )
      throw new Error('Fictional organization required');
    const staff = await trx
      .selectFrom('staff_identity')
      .select('id')
      .where('id', '=', input.staffId)
      .where('organization_id', '=', input.organizationId)
      .where('entra_tenant_id', '=', input.tenantId)
      .where('entra_object_id', 'is not', null)
      .where('active', '=', true)
      .executeTakeFirst();
    if (!staff) throw new Error('Mapped personal principal required');
    const results = [];
    for (const scope of input.scopes) {
      const dept = await trx
        .selectFrom('department')
        .select(['id', 'name'])
        .where('id', '=', scope.departmentId)
        .where('organization_id', '=', input.organizationId)
        .where('status', '=', 'active')
        .executeTakeFirst();
      const membership = await trx
        .selectFrom('staff_department_membership')
        .select('staff_identity_id')
        .where('organization_id', '=', input.organizationId)
        .where('staff_identity_id', '=', input.staffId)
        .where('department_id', '=', scope.departmentId)
        .where('active', '=', true)
        .executeTakeFirst();
      if (!dept || !membership)
        throw new Error('Existing explicit development scope required');
      const division = scope.divisionId
        ? await trx
            .selectFrom('division')
            .innerJoin('staff_division_membership as m', (join) =>
              join
                .onRef('m.organization_id', '=', 'division.organization_id')
                .onRef('m.division_id', '=', 'division.id')
                .onRef('m.department_id', '=', 'division.department_id'),
            )
            .select(['division.name', 'division.id'])
            .where('division.organization_id', '=', input.organizationId)
            .where('division.department_id', '=', scope.departmentId)
            .where('division.id', '=', scope.divisionId)
            .where('division.status', '=', 'active')
            .where('m.staff_identity_id', '=', input.staffId)
            .where('m.active', '=', true)
            .executeTakeFirst()
        : null;
      if (scope.divisionId && !division)
        throw new Error('Existing explicit division scope required');
      const roleName = `F037 Fictional Reviewer - ${division?.name ?? dept.name}`;
      if (roleName.length > 200) throw new Error('Fictional name too long');
      const role = await trx
        .selectFrom('operational_role')
        .selectAll()
        .where('organization_id', '=', input.organizationId)
        .where('department_id', '=', scope.departmentId)
        .where('name', '=', roleName)
        .executeTakeFirst();
      if (role && (!role.active || role.division_id !== scope.divisionId))
        throw new Error('Existing role differs from explicit scope');
      const group = await trx
        .selectFrom('work_group')
        .selectAll()
        .where('organization_id', '=', input.organizationId)
        .where('department_id', '=', scope.departmentId)
        .where((eb) =>
          scope.divisionId
            ? eb.or([
                eb('division_id', 'is', null),
                eb('division_id', '=', scope.divisionId),
              ])
            : eb('division_id', 'is', null),
        )
        .where('active', '=', true)
        .orderBy('name')
        .orderBy('id')
        .executeTakeFirst();
      const roleId = role?.id ?? randomUUID(),
        groupId = group?.id ?? randomUUID();
      const groupName =
        group?.name ?? `F037 Fictional Team - ${division?.name ?? dept.name}`;
      if (groupName.length > 200) throw new Error('Fictional name too long');
      const roleMember = role
        ? await trx
            .selectFrom('operational_role_membership')
            .select('active')
            .where('operational_role_id', '=', roleId)
            .where('staff_identity_id', '=', input.staffId)
            .executeTakeFirst()
        : undefined;
      const groupMember = group
        ? await trx
            .selectFrom('work_group_membership')
            .select('active')
            .where('work_group_id', '=', groupId)
            .where('staff_identity_id', '=', input.staffId)
            .executeTakeFirst()
        : undefined;
      // Never silently reactivate an explicitly deactivated membership.
      if (roleMember?.active === false || groupMember?.active === false)
        throw new Error('Inactive membership requires separate review');
      if (!dryRun) {
        if (!role)
          await trx
            .insertInto('operational_role')
            .values({
              id: roleId,
              organization_id: input.organizationId,
              department_id: scope.departmentId,
              division_id: scope.divisionId,
              name: roleName,
              active: true,
            })
            .execute();
        if (!group)
          await trx
            .insertInto('work_group')
            .values({
              id: groupId,
              organization_id: input.organizationId,
              department_id: scope.departmentId,
              division_id: scope.divisionId,
              name: groupName,
              description: 'Explicit F037 fictional development team',
              active: true,
            })
            .execute();
        if (!roleMember)
          await trx
            .insertInto('operational_role_membership')
            .values({
              organization_id: input.organizationId,
              operational_role_id: roleId,
              staff_identity_id: input.staffId,
              active: true,
            })
            .execute();
        if (!groupMember)
          await trx
            .insertInto('work_group_membership')
            .values({
              organization_id: input.organizationId,
              work_group_id: groupId,
              staff_identity_id: input.staffId,
              active: true,
            })
            .execute();
      }
      results.push({
        department: dept.name,
        division: division?.name ?? null,
        role: roleName,
        team: groupName,
        newTargets: Number(!role) + Number(!group),
        newMemberships: Number(!roleMember) + Number(!groupMember),
      });
    }
    return {
      organization: org.name,
      dryRun,
      scopes: results,
      permissionsChanged: false,
    };
  });
}
