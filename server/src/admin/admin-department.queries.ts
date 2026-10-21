import { sql } from 'kysely';
import type { departmentQuery } from './admin-department.domain.js';
import {
  type DepartmentSummary,
  type DivisionSummary,
  type CategorySummary,
} from './admin-department.domain.js';

export type DepartmentCollection = 'departments' | 'divisions' | 'categories';
const metadata = sql`r.id,r.name,r.description,r.status,r.display_order as "displayOrder"`;
const departmentFields = sql`${metadata},
  (select count(*)::int from division v where v.organization_id=r.organization_id and v.department_id=r.id) as "divisionCount",
  (select count(*)::int from category c where c.organization_id=r.organization_id and c.department_id=r.id) as "categoryCount"`;
export function departmentDetailSql(org: string, id: string) {
  return sql<DepartmentSummary>`select ${departmentFields} from department r where r.organization_id=${org} and r.id=${id}`;
}
export function departmentCollectionSql(
  org: string,
  collection: DepartmentCollection,
  query: ReturnType<typeof departmentQuery>,
  id?: string,
) {
  const tables = {
    departments: sql`department`,
    divisions: sql`division`,
    categories: sql`category`,
  };
  const fields = {
    departments: departmentFields,
    divisions: sql`${metadata},r.department_id as "departmentId"`,
    categories: sql`${metadata},r.department_id as "departmentId",r.division_id as "divisionId",r.icon_key as "iconKey",
      (select count(*)::int from service_definition s where s.organization_id=r.organization_id and s.category_id=r.id) as "serviceDefinitionCount"`,
  };
  const conditions = [sql`r.organization_id=${org}`];
  if (collection !== 'departments') conditions.push(sql`r.department_id=${id}`);
  if (query.status !== 'all') conditions.push(sql`r.status=${query.status}`);
  // strpos implements literal substring search, including %, _ and backslash.
  if (query.search)
    conditions.push(
      sql`(strpos(lower(r.name),lower(${query.search}))>0 or strpos(lower(coalesce(r.description,'')),lower(${query.search}))>0)`,
    );
  const where = sql`from ${tables[collection]} r where ${sql.join(conditions, sql` and `)}`;
  const sort = {
    name: sql`r.name`,
    displayOrder: sql`r.display_order`,
    status: sql`r.status`,
  }[query.sort];
  const direction = query.direction === 'desc' ? sql`desc` : sql`asc`;
  return {
    count: sql<{ total: number }>`select count(*)::int as total ${where}`,
    items: sql<
      DepartmentSummary | DivisionSummary | CategorySummary
    >`select ${fields[collection]} ${where} order by ${sort} ${direction},r.id asc limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`,
  };
}
