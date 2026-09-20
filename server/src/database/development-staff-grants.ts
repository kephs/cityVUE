import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { Permission } from '../auth/auth.types.js';
import type { DatabaseSchema } from './database.types.js';
import {
  developmentOrganization,
  developmentStaffPermissions,
  developmentUuid,
  selectedDevelopmentScopes,
  type DevelopmentStaffScope,
} from './development-staff-input.js';

interface OwnedMembership {
  departmentId: string;
  divisionId: string | null;
  previous: 'missing' | 'inactive';
}
interface Provenance {
  source: 'F036';
  permissions: Permission[];
  memberships: OwnedMembership[];
}
export interface DevelopmentStaffSelection {
  tenantId: string;
  staffId: string;
  organizationId: string;
  scopes: DevelopmentStaffScope[];
  permissions: Permission[];
}

function validateSelection(input: DevelopmentStaffSelection) {
  if (
    !developmentUuid.test(input.staffId) ||
    !developmentUuid.test(input.tenantId) ||
    input.organizationId !== developmentOrganization.id ||
    input.permissions.length === 0 ||
    input.permissions.some(
      (key) => !developmentStaffPermissions.some((known) => known === key),
    )
  )
    throw new Error('Invalid explicit development selection');
  selectedDevelopmentScopes(JSON.stringify(input.scopes));
}

function provenance(value: string | null): Provenance {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value ?? '');
  } catch {
    throw new Error('Unrecognized development role provenance');
  }
  const record = parsed as Partial<Provenance> | null;
  if (
    record?.source !== 'F036' ||
    !Array.isArray(record.permissions) ||
    !Array.isArray(record.memberships) ||
    record.permissions.some(
      (key) => !developmentStaffPermissions.some((known) => known === key),
    ) ||
    (record.memberships as unknown[]).some((entry) => {
      if (!entry || typeof entry !== 'object') return true;
      const item = entry as Partial<OwnedMembership>;
      return (
        typeof item.departmentId !== 'string' ||
        !developmentUuid.test(item.departmentId) ||
        !(
          item.divisionId === null ||
          (typeof item.divisionId === 'string' &&
            developmentUuid.test(item.divisionId))
        ) ||
        !['missing', 'inactive'].includes(item.previous ?? '')
      );
    })
  )
    throw new Error('Unrecognized development role provenance');
  return record as Provenance;
}

/** Internal local-tool implementation; CLI validates environment and actual DB first.
 * Tests inject disposable schemas; this module is never imported by application modules.
 */
export async function changeDevelopmentStaffGrants(
  db: Kysely<DatabaseSchema>,
  input: DevelopmentStaffSelection,
  mode: 'provision' | 'deprovision',
  dryRun: boolean,
) {
  validateSelection(input);
  return db.transaction().execute(async (trx) => {
    if (dryRun) await sql`set transaction read only`.execute(trx);
    // Serialize cooperating CLI writes, including first role/membership creation.
    let organizationQuery = trx
      .selectFrom('organization')
      .selectAll()
      .where('id', '=', input.organizationId);
    if (!dryRun) organizationQuery = organizationQuery.forUpdate();
    const organization = await organizationQuery.executeTakeFirst();
    if (
      organization?.status !== 'active' ||
      organization.name !== developmentOrganization.name ||
      organization.slug !== developmentOrganization.slug
    )
      throw new Error('Existing fictional development Organization required');
    const staff = await trx
      .selectFrom('staff_identity')
      .select(['id', 'entra_object_id'])
      .where('id', '=', input.staffId)
      .where('organization_id', '=', input.organizationId)
      .where('entra_tenant_id', '=', input.tenantId)
      .where('active', '=', true)
      .executeTakeFirst();
    if (!staff?.entra_object_id)
      throw new Error('Known active personal-development principal required');
    const scopeLabels: string[] = [];
    for (const scope of input.scopes) {
      const department = await trx
        .selectFrom('department')
        .select('name')
        .where('id', '=', scope.departmentId)
        .where('organization_id', '=', input.organizationId)
        .where('status', '=', 'active')
        .executeTakeFirst();
      if (!department) throw new Error('Invalid development department');
      let label = department.name;
      if (scope.divisionId !== null) {
        const division = await trx
          .selectFrom('division')
          .select('name')
          .where('id', '=', scope.divisionId)
          .where('department_id', '=', scope.departmentId)
          .where('organization_id', '=', input.organizationId)
          .where('status', '=', 'active')
          .executeTakeFirst();
        if (!division)
          throw new Error('Invalid development division hierarchy');
        label += ` / ${division.name}`;
      }
      scopeLabels.push(label);
    }
    const catalog = await trx
      .selectFrom('permission')
      .select('permission_key')
      .where('permission_key', 'in', input.permissions)
      .execute();
    if (
      new Set(catalog.map((row) => row.permission_key)).size !==
      new Set(input.permissions).size
    )
      throw new Error('Required permission migrations are not applied');
    const name = `f036-staff-${input.staffId}`;
    const role = await trx
      .selectFrom('role')
      .selectAll()
      .where('organization_id', '=', input.organizationId)
      .where('name', '=', name)
      .executeTakeFirst();
    const owned: Provenance = role
      ? provenance(role.description)
      : { source: 'F036', permissions: [], memberships: [] };
    if (role) {
      if (!role.active) throw new Error('Development role is inactive');
      const assigned = await trx
        .selectFrom('staff_role_assignment')
        .select('staff_identity_id')
        .where('role_id', '=', role.id)
        .execute();
      const grants = await trx
        .selectFrom('role_permission')
        .select('permission_key')
        .where('role_id', '=', role.id)
        .execute();
      if (
        assigned.some((row) => row.staff_identity_id !== input.staffId) ||
        JSON.stringify(grants.map((row) => row.permission_key).sort()) !==
          JSON.stringify([...owned.permissions].sort())
      )
        throw new Error(
          'Development role ownership or permissions changed externally',
        );
    }
    const changed = input.permissions.filter((key) =>
      mode === 'provision'
        ? !owned.permissions.includes(key)
        : owned.permissions.includes(key),
    );
    const result = {
      dryRun,
      mode,
      principal: `development-principal-…${input.staffId.slice(-6)}`,
      organization: organization.name,
      scopes: scopeLabels,
      permissions: input.permissions,
      changedPermissions: changed,
      alreadyPresentOrAbsent: input.permissions.length - changed.length,
    };
    if (dryRun) return result;
    const roleId = role?.id ?? randomUUID();
    if (!role && mode === 'deprovision') return result;
    if (!role)
      await trx
        .insertInto('role')
        .values({
          id: roleId,
          organization_id: input.organizationId,
          name,
          description: JSON.stringify(owned),
          active: true,
        })
        .execute();
    if (mode === 'provision') {
      // Preserve pre-existing active memberships. Record only changes owned by this tool.
      for (const scope of input.scopes) {
        const department = await trx
          .selectFrom('staff_department_membership')
          .select('active')
          .where('organization_id', '=', input.organizationId)
          .where('staff_identity_id', '=', input.staffId)
          .where('department_id', '=', scope.departmentId)
          .executeTakeFirst();
        if (!department?.active) {
          owned.memberships.push({
            departmentId: scope.departmentId,
            divisionId: null,
            previous: department ? 'inactive' : 'missing',
          });
          await trx
            .insertInto('staff_department_membership')
            .values({
              organization_id: input.organizationId,
              staff_identity_id: input.staffId,
              department_id: scope.departmentId,
              active: true,
            })
            .onConflict((oc) =>
              oc
                .columns(['staff_identity_id', 'department_id'])
                .doUpdateSet({ active: true }),
            )
            .execute();
        }
        if (scope.divisionId !== null) {
          const division = await trx
            .selectFrom('staff_division_membership')
            .select('active')
            .where('organization_id', '=', input.organizationId)
            .where('staff_identity_id', '=', input.staffId)
            .where('division_id', '=', scope.divisionId)
            .executeTakeFirst();
          if (!division?.active) {
            owned.memberships.push({
              ...scope,
              previous: division ? 'inactive' : 'missing',
            });
            await trx
              .insertInto('staff_division_membership')
              .values({
                organization_id: input.organizationId,
                staff_identity_id: input.staffId,
                department_id: scope.departmentId,
                division_id: scope.divisionId,
                active: true,
              })
              .onConflict((oc) =>
                oc
                  .columns(['staff_identity_id', 'division_id'])
                  .doUpdateSet({ active: true }),
              )
              .execute();
          }
        }
      }
      for (const key of changed)
        await trx
          .insertInto('role_permission')
          .values({
            organization_id: input.organizationId,
            role_id: roleId,
            permission_key: key,
          })
          .execute();
      owned.permissions = [
        ...new Set([...owned.permissions, ...input.permissions]),
      ];
      await trx
        .insertInto('staff_role_assignment')
        .values({
          organization_id: input.organizationId,
          staff_identity_id: input.staffId,
          role_id: roleId,
          active: true,
        })
        .onConflict((oc) =>
          oc
            .columns(['staff_identity_id', 'role_id'])
            .doUpdateSet({ active: true }),
        )
        .execute();
    } else {
      for (const key of changed)
        await trx
          .deleteFrom('role_permission')
          .where('organization_id', '=', input.organizationId)
          .where('role_id', '=', roleId)
          .where('permission_key', '=', key)
          .execute();
      owned.permissions = owned.permissions.filter(
        (key) => !input.permissions.includes(key),
      );
      if (owned.permissions.length === 0) {
        // Restore owned scope changes only after the final F036 permission is removed.
        // Divisions precede departments to respect membership foreign keys.
        for (const item of [...owned.memberships].sort(
          (a, b) =>
            Number(b.divisionId !== null) - Number(a.divisionId !== null),
        )) {
          if (item.divisionId !== null) {
            if (item.previous === 'missing')
              await trx
                .deleteFrom('staff_division_membership')
                .where('organization_id', '=', input.organizationId)
                .where('staff_identity_id', '=', input.staffId)
                .where('division_id', '=', item.divisionId)
                .execute();
            else
              await trx
                .updateTable('staff_division_membership')
                .set({ active: false })
                .where('organization_id', '=', input.organizationId)
                .where('staff_identity_id', '=', input.staffId)
                .where('division_id', '=', item.divisionId)
                .execute();
          } else {
            if (item.previous === 'missing')
              await trx
                .deleteFrom('staff_department_membership')
                .where('organization_id', '=', input.organizationId)
                .where('staff_identity_id', '=', input.staffId)
                .where('department_id', '=', item.departmentId)
                .execute();
            else
              await trx
                .updateTable('staff_department_membership')
                .set({ active: false })
                .where('organization_id', '=', input.organizationId)
                .where('staff_identity_id', '=', input.staffId)
                .where('department_id', '=', item.departmentId)
                .execute();
          }
        }
        owned.memberships = [];
        await trx
          .updateTable('staff_role_assignment')
          .set({ active: false })
          .where('organization_id', '=', input.organizationId)
          .where('staff_identity_id', '=', input.staffId)
          .where('role_id', '=', roleId)
          .execute();
      }
    }
    await trx
      .updateTable('role')
      .set({ description: JSON.stringify(owned) })
      .where('id', '=', roleId)
      .execute();
    return result;
  });
}
