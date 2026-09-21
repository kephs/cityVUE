import { BadRequestException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import { internalRequestUuid } from './internal-request-scope.js';
import {
  requestReadPermission,
  type StaffRequestAudience,
} from './staff-request-scope.js';

export const targetTypes = ['staff', 'role', 'group'] as const;
export type TargetType = (typeof targetTypes)[number];
export interface OwnershipTarget {
  type: TargetType;
  id: string;
  displayName: string;
  active: boolean;
}
export function validateTarget(type: unknown, id: unknown) {
  if (
    !targetTypes.includes(type as TargetType) ||
    typeof id !== 'string' ||
    !internalRequestUuid.test(id)
  )
    throw new BadRequestException('Invalid operational target');
}
export function validateTargetSearch(search: unknown): string {
  if (
    typeof search !== 'string' ||
    search.length > 100 ||
    Array.from(search).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    })
  )
    throw new BadRequestException('Invalid target search');
  return search.trim();
}

/** No authentication identifiers or emails are projected, including accidental login-style display names. */
export const safeStaffName = sql<string>`case when s.display_name like '%@%' or s.display_name ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  or s.display_name ~ '[[:cntrl:]]' then 'Staff member' else s.display_name end`;

export function targetCatalog(organizationId: string) {
  return sql`(
    select 'staff'::text as type,s.id,${safeStaffName} as name,s.active from staff_identity s where s.organization_id=${organizationId}
    union all select 'role',r.id,r.name,r.active from operational_role r where r.organization_id=${organizationId}
    union all select 'group',g.id,g.name,g.active from work_group g where g.organization_id=${organizationId}
  )`;
}

export async function eligibleTargets(
  db: Kysely<DatabaseSchema>,
  organizationId: string,
  departmentId: string,
  divisionId: string | null,
  type: TargetType,
  search = '',
  targetId?: string,
  audience: StaffRequestAudience = 'internal',
): Promise<OwnershipTarget[]> {
  if (!targetTypes.includes(type))
    throw new BadRequestException('Invalid target type');
  const term = validateTargetSearch(search).replace(/[\\%_]/g, '\\$&');
  const rows = await sql<OwnershipTarget>`
    select t.type,t.id,t.name as "displayName",t.active from ${targetCatalog(organizationId)} t
    where t.active and t.type=${type} and (${targetId ?? null}::uuid is null or t.id=${targetId ?? null}::uuid)
      and t.name ilike ${`%${term}%`} escape '\'
      and exists(select 1 from department d where d.organization_id=${organizationId} and d.id=${departmentId} and d.status='active')
      and (${divisionId}::uuid is null or exists(select 1 from division d where d.organization_id=${organizationId} and d.department_id=${departmentId} and d.id=${divisionId} and d.status='active'))
      and (
        (t.type='staff' and exists(select 1 from staff_department_membership m where m.organization_id=${organizationId} and m.staff_identity_id=t.id and m.department_id=${departmentId} and m.active)
          and (${divisionId}::uuid is null or exists(select 1 from staff_division_membership m where m.organization_id=${organizationId} and m.staff_identity_id=t.id and m.department_id=${departmentId} and m.division_id=${divisionId} and m.active))
          and exists(select 1 from staff_role_assignment a join role r on r.organization_id=a.organization_id and r.id=a.role_id and r.active
            join role_permission p on p.organization_id=r.organization_id and p.role_id=r.id and p.permission_key=${requestReadPermission[audience]}
            where a.organization_id=${organizationId} and a.staff_identity_id=t.id and a.active))
        or (t.type='role' and exists(select 1 from operational_role r where r.organization_id=${organizationId} and r.id=t.id and r.department_id=${departmentId} and (r.division_id is null or r.division_id=${divisionId})))
        or (t.type='group' and exists(select 1 from work_group g where g.organization_id=${organizationId} and g.id=t.id and g.department_id=${departmentId} and (g.division_id is null or g.division_id=${divisionId})))
      ) order by t.name,t.id limit 25
  `.execute(db);
  return rows.rows;
}

export const assignmentType = sql<string>`case a.assignment_type when 'individual' then 'staff' else a.assignment_type end`;
export const assignmentTargetId = sql<string>`coalesce(a.staff_identity_id,a.operational_role_id,a.work_group_id)`;
export function assignmentProjection(organizationId: string) {
  return sql<OwnershipTarget | null>`(select json_build_object('type',t.type,'id',t.id,'displayName',t.name,'active',t.active)
    from service_request_assignment a join ${targetCatalog(organizationId)} t on t.type=${assignmentType} and t.id=${assignmentTargetId}
    where a.organization_id=${organizationId} and a.service_request_id=request.id and a.ended_at is null)`;
}

export function operationalView(
  view: string,
  organizationId: string,
  staffId: string,
) {
  const member = (
    type: ReturnType<typeof sql>,
    id: ReturnType<typeof sql>,
  ) => sql<boolean>`(
    (${type}='staff' and ${id}=${staffId}) or
    (${type}='role' and exists(select 1 from operational_role_membership m join operational_role r on r.organization_id=m.organization_id and r.id=m.operational_role_id and r.active where m.organization_id=${organizationId} and m.staff_identity_id=${staffId} and m.operational_role_id=${id} and m.active)) or
    (${type}='group' and exists(select 1 from work_group_membership m join work_group g on g.organization_id=m.organization_id and g.id=m.work_group_id and g.active where m.organization_id=${organizationId} and m.staff_identity_id=${staffId} and m.work_group_id=${id} and m.active)))`;
  if (view === 'all') return sql<boolean>`true`;
  if (view === 'watching')
    return sql<boolean>`exists(select 1 from service_request_watcher w where w.organization_id=${organizationId} and w.service_request_id=request.id and ${member(sql`w.target_type`, sql`coalesce(w.staff_identity_id,w.operational_role_id,w.work_group_id)`)})`;
  if (!['mine', 'team'].includes(view))
    throw new BadRequestException('Invalid operational view');
  return sql<boolean>`exists(select 1 from service_request_assignment a where a.organization_id=${organizationId} and a.service_request_id=request.id and a.ended_at is null and
    ${view === 'mine' ? sql`a.assignment_type='individual' and a.staff_identity_id=${staffId}` : sql`a.assignment_type in ('role','group') and ${member(assignmentType, assignmentTargetId)}`})`;
}
