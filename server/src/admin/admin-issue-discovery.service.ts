import { BadRequestException, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { StaffAccess } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import { safeStaffName } from '../service-request/ownership-targets.js';
import { requestUuid } from '../service-request/staff-request-scope.js';
import { assertConfigurationRead } from './admin-configuration.domain.js';
import { issueAvailabilities } from '../catalog/issue-availability.js';

export interface IssueDiscoveryInput {
  availability?: string;
  handling?: string;
  search?: string;
  status?: string;
  category?: string;
  requesterPolicy?: string;
  assignmentState?: string;
  sort?: string;
  direction?: string;
  page?: string;
  pageSize?: string;
}
export function issueDiscoveryQuery(input: IssueDiscoveryInput) {
  const invalid = () => new BadRequestException('Invalid Issue list query');
  const choice = (
    value: string | undefined,
    fallback: string,
    allowed: string[],
  ) => {
    if (value === undefined) return fallback;
    if (!allowed.includes(value)) throw invalid();
    return value;
  };
  const integer = (value: string | undefined, fallback: number) => {
    if (value === undefined) return fallback;
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
      throw invalid();
    return Number(value);
  };
  const search = input.search?.trim() ?? '';
  if (
    search.length > 100 ||
    Array.from(search).some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    })
  )
    throw invalid();
  const pageSize = integer(input.pageSize, 25);
  if (![25, 50, 100, 250, 500].includes(pageSize)) throw invalid();
  if (input.category && !requestUuid.test(input.category)) throw invalid();
  return {
    availability: choice(input.availability, 'all', [
      'all',
      ...issueAvailabilities,
    ]),
    handling: choice(input.handling, 'all', [
      'all',
      'internal_intake',
      'external_redirect',
    ]),
    search,
    category: input.category === '' ? null : (input.category ?? null),
    status: choice(input.status, 'all', ['all', 'active', 'inactive']),
    requesterPolicy: choice(input.requesterPolicy, 'all', [
      'all',
      'IDENTIFIED_REQUIRED',
      'ANONYMOUS_ALLOWED',
    ]),
    assignmentState: choice(input.assignmentState, 'all', [
      'all',
      'assigned',
      'none',
    ]),
    sort: choice(input.sort, 'default', [
      'default',
      'name',
      'category',
      'order',
      'status',
      'policy',
      'assignment',
    ]),
    direction: choice(input.direction, 'asc', ['asc', 'desc']),
    page: integer(input.page, 1),
    pageSize,
  };
}
const assignmentName = sql`case a.target_type when 'staff' then ${safeStaffName} when 'role' then r.name when 'group' then g.name end`;
const policy = sql`coalesce(p.policy,case when v.anonymous_reporting_policy in ('allowed','allowed_with_limitations') then 'ANONYMOUS_ALLOWED' else 'IDENTIFIED_REQUIRED' end)`;
export function issueDiscoverySql(org: string, input: IssueDiscoveryInput) {
  const query = issueDiscoveryQuery(input);
  const joins = sql`from service_definition i
    join category c on c.organization_id=i.organization_id and c.id=i.category_id
    left join service_definition_version v on v.organization_id=i.organization_id and v.id=i.current_published_version_id
    left join issue_requester_identity_policy p on p.organization_id=i.organization_id and p.service_definition_id=i.id
    left join issue_default_assignment a on a.organization_id=i.organization_id and a.service_definition_id=i.id`;
  const conditions = [sql`i.organization_id=${org}`];
  if (query.availability !== 'all')
    conditions.push(sql`i.availability=${query.availability}`);
  if (query.handling !== 'all')
    conditions.push(sql`i.action_type=${query.handling}`);
  if (query.search)
    conditions.push(
      sql`(strpos(lower(coalesce(v.name,'Unpublished Issue')),lower(${query.search}))>0 or strpos(lower(c.name),lower(${query.search}))>0)`,
    );
  if (query.status !== 'all') conditions.push(sql`i.status=${query.status}`);
  if (query.category) conditions.push(sql`i.category_id=${query.category}`);
  if (query.requesterPolicy !== 'all')
    conditions.push(sql`${policy}=${query.requesterPolicy}`);
  if (query.assignmentState !== 'all')
    conditions.push(
      query.assignmentState === 'assigned'
        ? sql`a.target_type is not null`
        : sql`a.target_type is null`,
    );
  const where = sql`where ${sql.join(conditions, sql` and `)}`;
  const direction = query.direction === 'desc' ? sql`desc` : sql`asc`;
  const sorts = {
    default: sql`c.display_order ${direction},c.name ${direction},c.id ${direction},i.display_order ${direction},coalesce(v.name,'Unpublished Issue') ${direction}`,
    name: sql`coalesce(v.name,'Unpublished Issue') ${direction},c.name asc,i.display_order asc`,
    category: sql`c.name ${direction},i.display_order asc,coalesce(v.name,'Unpublished Issue') asc`,
    order: sql`i.display_order ${direction},coalesce(v.name,'Unpublished Issue') asc,c.name asc`,
    status: sql`(i.status='active') ${direction},coalesce(v.name,'Unpublished Issue') asc,c.name asc`,
    policy: sql`${policy} ${direction},coalesce(v.name,'Unpublished Issue') asc,c.name asc`,
    assignment: sql`coalesce(${assignmentName},'') ${direction},coalesce(v.name,'Unpublished Issue') asc,c.name asc`,
  };
  return {
    query,
    count: sql<{
      total: number;
    }>`select count(*)::int as total ${joins} ${where}`,
    page: (
      offset: number,
    ) => sql`select i.id,i.availability,i.action_type as "actionType",coalesce(v.name,'Unpublished Issue') as name,
      c.id as "categoryId",c.name as category,(i.status='active') as active,
      i.display_order as "displayOrder",${policy} as "requesterPolicy",
      case when a.target_type is null then null else coalesce(${assignmentName},'Configured target unavailable') end as "assignmentLabel"
      ${joins}
      left join staff_identity s on s.organization_id=i.organization_id and s.id=a.staff_identity_id and a.target_type='staff'
      left join operational_role r on r.organization_id=i.organization_id and r.id=a.operational_role_id and a.target_type='role'
      left join work_group g on g.organization_id=i.organization_id and g.id=a.work_group_id and a.target_type='group'
      ${where} order by ${sorts[query.sort as keyof typeof sorts]},i.id asc limit ${query.pageSize} offset ${offset}`,
  };
}

export function issueTemplateSql(org: string, search = '') {
  const query = issueDiscoveryQuery({ search });
  return sql`select i.id,v.name,c.name as category
      from service_definition i join category c on c.organization_id=i.organization_id and c.id=i.category_id
      join department d on d.organization_id=c.organization_id and d.id=c.department_id
      left join division dv on dv.organization_id=c.organization_id and dv.id=c.division_id
      join service_definition_version v on v.organization_id=i.organization_id and v.id=i.current_published_version_id
      where i.organization_id=${org} and i.status='active' and c.status='active' and d.status='active'
      and (c.division_id is null or dv.status='active') and i.action_type='internal_intake' and v.status='published'
      and (strpos(lower(v.name),lower(${query.search}))>0 or strpos(lower(c.name),lower(${query.search}))>0)
      order by v.name,c.name,i.id limit 26`;
}

@Injectable()
export class AdminIssueDiscoveryService {
  constructor(private readonly database: DatabaseService) {}
  async list(access: StaffAccess | undefined, input: IssueDiscoveryInput) {
    assertConfigurationRead(access);
    const statements = issueDiscoverySql(access.organizationId, input);
    return this.database.client
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        await sql`set transaction read only`.execute(trx);
        const counts = (
          await sql<{
            organizationTotal: number;
            active: number;
            inactive: number;
          }>`select count(*)::int as "organizationTotal",count(*) filter(where status='active')::int as active,count(*) filter(where status<>'active')::int as inactive from service_definition where organization_id=${access.organizationId}`.execute(
            trx,
          )
        ).rows[0];
        const filtered = (await statements.count.execute(trx)).rows[0];
        if (!counts || !filtered) throw new Error('Issue counts unavailable');
        const total = filtered.total;
        const page = Math.min(
          statements.query.page,
          Math.max(1, Math.ceil(total / statements.query.pageSize)),
        );
        const items = (
          await statements
            .page((page - 1) * statements.query.pageSize)
            .execute(trx)
        ).rows;
        return {
          ...counts,
          total,
          page,
          pageSize: statements.query.pageSize,
          items,
          canWrite: access.permissions.includes('admin.issues.write'),
        };
      });
  }
  async categories(access: StaffAccess | undefined) {
    assertConfigurationRead(access);
    return {
      items: (
        await sql`select id,name from category where organization_id=${access.organizationId} order by display_order,name,id`.execute(
          this.database.client,
        )
      ).rows,
    };
  }
  async templates(access: StaffAccess | undefined, search?: string) {
    assertConfigurationRead(access);
    const items = (
      await issueTemplateSql(access.organizationId, search).execute(
        this.database.client,
      )
    ).rows;
    return { items: items.slice(0, 25), hasMore: items.length > 25 };
  }
}
