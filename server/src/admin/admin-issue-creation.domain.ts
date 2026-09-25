import { BadRequestException } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { requestUuid } from '../service-request/staff-request-scope.js';
import { validateTargetSearch } from '../service-request/ownership-targets.js';

export interface CreationCategory {
  id: string;
  name: string;
  department_id: string;
  division_id: string | null;
}
export function categoryHandlingCapability(
  access: StaffAccess,
  category: CreationCategory,
) {
  return (
    !access.development &&
    !!access.tenantId &&
    !!access.objectId &&
    access.permissions.includes('admin.configuration.read') &&
    access.permissions.includes('admin.issues.write') &&
    access.permissions.includes('catalog.issue_action.manage') &&
    access.departmentIds.includes(category.department_id) &&
    (category.division_id === null ||
      access.divisionIds.includes(category.division_id))
  );
}
export async function lockCreationCategory(
  trx: Transaction<DatabaseSchema>,
  org: string,
  id: string | undefined,
) {
  if (!id || !requestUuid.test(id))
    throw new BadRequestException({ code: 'ISSUE_CATEGORY_UNAVAILABLE' });
  const row = await trx
    .selectFrom('category as c')
    .innerJoin('department as d', (j) =>
      j
        .onRef('d.id', '=', 'c.department_id')
        .onRef('d.organization_id', '=', 'c.organization_id'),
    )
    .select(['c.id', 'c.name', 'c.department_id', 'c.division_id'])
    .where('c.organization_id', '=', org)
    .where('c.id', '=', id)
    .where('c.status', '=', 'active')
    .where('d.status', '=', 'active')
    .forShare(['c', 'd'])
    .executeTakeFirst();
  if (!row)
    throw new BadRequestException({ code: 'ISSUE_CATEGORY_UNAVAILABLE' });
  if (
    row.division_id &&
    !(await trx
      .selectFrom('division')
      .select('id')
      .where('organization_id', '=', org)
      .where('department_id', '=', row.department_id)
      .where('id', '=', row.division_id)
      .where('status', '=', 'active')
      .forShare()
      .executeTakeFirst())
  )
    throw new BadRequestException({ code: 'ISSUE_CATEGORY_UNAVAILABLE' });
  return row;
}
export async function findCreationCategories(
  db: Kysely<DatabaseSchema>,
  access: StaffAccess,
  search = '',
) {
  const term = validateTargetSearch(search);
  const { rows } = await sql<
    CreationCategory & { department: string; division: string | null }
  >`
    select c.id,c.name,c.department_id,c.division_id,d.name as department,dv.name as division
    from category c join organization o on o.id=c.organization_id
    join department d on d.organization_id=c.organization_id and d.id=c.department_id
    left join division dv on dv.organization_id=c.organization_id and dv.department_id=c.department_id and dv.id=c.division_id
    where c.organization_id=${access.organizationId} and o.status='active' and c.status='active' and d.status='active'
    and (c.division_id is null or dv.status='active') and strpos(lower(c.name),lower(${term}))>0
    order by c.name,c.id limit 26`.execute(db);
  return {
    items: rows.slice(0, 25).map((c) => ({
      id: c.id,
      name: c.name,
      department: c.department,
      division: c.division,
      canManageHandling: categoryHandlingCapability(access, c),
    })),
    hasMore: rows.length > 25,
  };
}
