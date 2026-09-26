import { BadRequestException, NotFoundException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import { permissions, type StaffAccess } from '../auth/auth.types.js';
import {
  effectivePermissionContributions,
  recognizedPermissions,
} from '../auth/effective-permissions.js';
import { currentActor } from './access-foundation.js';
import {
  accessPermissionMetadata,
  accessPrerequisites,
} from './access-policy.js';
import { safeStaffName } from '../service-request/ownership-targets.js';

type Db = Kysely<DatabaseSchema>;
export const permissionCatalog = permissions.map((key) => ({
  key,
  ...accessPermissionMetadata[key],
}));
export const accessCategories = [
  ...new Set(permissionCatalog.map((p) => p.category)),
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function reference(id: string) {
  if (!uuid.test(id)) throw new BadRequestException('Invalid staff reference');
  return id;
}
export function discoveryQuery(
  input: Record<string, unknown>,
  history = false,
) {
  const allowed = history
    ? ['page', 'pageSize']
    : [
        'page',
        'pageSize',
        'search',
        'status',
        'category',
        'department',
        'division',
        'source',
      ];
  const invalid = () =>
    new BadRequestException('Invalid access discovery query');
  if (
    Object.entries(input).some(
      ([k, v]) => !allowed.includes(k) || typeof v !== 'string',
    )
  )
    throw invalid();
  const value = (k: string, fallback = '') =>
    (input[k] as string | undefined) ?? fallback;
  const page = value('page', '1'),
    pageSize = value('pageSize', '25');
  if (
    !/^[1-9]\d*$/.test(page) ||
    !Number.isSafeInteger(Number(page)) ||
    Number(page) > 1000000 ||
    !['25', '50', '100'].includes(pageSize)
  )
    throw invalid();
  const search = value('search').trim(),
    status = value('status', 'all'),
    category = value('category'),
    source = value('source', 'all');
  if (
    search.length > 100 ||
    Array.from(value('search')).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    }) ||
    !['all', 'active', 'inactive'].includes(status) ||
    (category &&
      !accessCategories.includes(
        category as (typeof accessCategories)[number],
      )) ||
    !['all', 'managed', 'existing', 'mixed'].includes(source)
  )
    throw invalid();
  const department = value('department'),
    division = value('division');
  if ([department, division].some((v) => v && !uuid.test(v))) throw invalid();
  return {
    page: Number(page),
    pageSize: Number(pageSize),
    search,
    status,
    category,
    source,
    department,
    division,
  };
}
export async function accessRead<T>(
  db: Db,
  access: StaffAccess,
  read: (trx: Db, revision: string) => Promise<T>,
) {
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (trx) => {
      await sql`set transaction read only`.execute(trx);
      await currentActor(trx, access, false);
      const state = await trx
        .selectFrom('organization_access_state as a')
        .innerJoin('organization as o', 'o.id', 'a.organization_id')
        .select('a.authorization_revision')
        .where('o.id', '=', access.organizationId)
        .where('o.status', '=', 'active')
        .executeTakeFirst();
      if (!state)
        throw new NotFoundException('Access configuration unavailable');
      return read(trx, state.authorization_revision);
    });
}
async function principal(db: Db, org: string, id: string) {
  const result = await db
    .selectFrom('staff_identity as s')
    .select(['s.id', 's.active', safeStaffName.as('displayName')])
    .where('s.organization_id', '=', org)
    .where('s.id', '=', reference(id))
    .executeTakeFirst();
  if (!result) throw new NotFoundException('Staff access unavailable');
  return result;
}
// The same contribution query used by request authorization, aggregated once for discovery.
export function discoverySql(
  db: Db,
  org: string,
  input: Record<string, unknown>,
) {
  const q = discoveryQuery(input);
  const contributions = effectivePermissionContributions(db, org);
  const categoryKeys = permissionCatalog
    .filter((p) => p.category === q.category)
    .map((p) => p.key);
  const base = sql`with contributions as (${contributions}), summary as (
    select s.id,${safeStaffName} as "displayName",s.active,
      coalesce(array_agg(distinct c.permission_key) filter(where s.active and c.permission_key=any(${permissions}::text[])),array[]::text[]) as keys,
      coalesce(bool_or(s.active and c.permission_key=any(${permissions}::text[]) and w.kind='operational'),false) as managed,
      coalesce(bool_or(s.active and c.permission_key=any(${permissions}::text[]) and w.kind is distinct from 'operational'),false) as existing
    from staff_identity s left join contributions c on c.staff_identity_id=s.id
    left join access_role_ownership w on w.organization_id=s.organization_id and w.role_id=c.role_id and w.staff_identity_id=s.id
    where s.organization_id=${org} group by s.id
  )`;
  const conditions = [sql`true`];
  if (q.search)
    conditions.push(sql`strpos(lower("displayName"),lower(${q.search}))>0`);
  if (q.status !== 'all') conditions.push(sql`active=${q.status === 'active'}`);
  if (q.category) conditions.push(sql`keys::text[] && ${categoryKeys}::text[]`);
  if (q.source === 'managed') conditions.push(sql`managed and not existing`);
  if (q.source === 'existing') conditions.push(sql`existing and not managed`);
  if (q.source === 'mixed') conditions.push(sql`managed and existing`);
  if (q.department)
    conditions.push(
      sql`exists(select 1 from staff_department_membership m where m.organization_id=${org} and m.staff_identity_id=summary.id and m.active and m.department_id=${q.department}::uuid)`,
    );
  if (q.division)
    conditions.push(
      sql`exists(select 1 from staff_division_membership m where m.organization_id=${org} and m.staff_identity_id=summary.id and m.active and m.division_id=${q.division}::uuid)`,
    );
  const where = sql`where ${sql.join(conditions, sql` and `)}`;
  return {
    q,
    count: sql<{
      total: number;
      organizationTotal: number;
    }>` ${base} select count(*)::int as total,(select count(*)::int from staff_identity where organization_id=${org}) as "organizationTotal" from summary ${where}`,
    page: sql<{
      id: string;
      displayName: string;
      active: boolean;
      keys: string[];
      managed: boolean;
      existing: boolean;
      departments: number;
      divisions: number;
    }>`${base}
      select summary.*,
      (select count(*)::int from staff_department_membership m where m.organization_id=${org} and m.staff_identity_id=summary.id and m.active) as departments,
      (select count(*)::int from staff_division_membership m where m.organization_id=${org} and m.staff_identity_id=summary.id and m.active) as divisions
      from summary ${where} order by lower("displayName"),id limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`,
  };
}
export async function listAccess(
  db: Db,
  access: StaffAccess,
  input: Record<string, unknown>,
) {
  const query = discoverySql(db, access.organizationId, input);
  return accessRead(db, access, async (trx) => {
    const counts = (await query.count.execute(trx)).rows[0];
    const rows = (await query.page.execute(trx)).rows;
    return {
      ...counts,
      page: query.q.page,
      pageSize: query.q.pageSize,
      items: rows.map(({ keys, managed, existing, ...staff }) => ({
        ...staff,
        categories: [
          ...new Set(
            recognizedPermissions(keys).map(
              (k) => accessPermissionMetadata[k].category,
            ),
          ),
        ],
        accessAdministrator: accessPrerequisites.every((k) => keys.includes(k)),
        source: managed
          ? existing
            ? 'mixed'
            : 'managed'
          : existing
            ? 'existing'
            : 'none',
      })),
    };
  });
}
export async function accessScopes(db: Db, access: StaffAccess) {
  return accessRead(db, access, async (trx) => ({
    departments: await trx
      .selectFrom('department')
      .select(['id', 'name', 'status'])
      .where('organization_id', '=', access.organizationId)
      .orderBy('name')
      .orderBy('id')
      .execute(),
    divisions: await trx
      .selectFrom('division')
      .select(['id', 'name', 'status', 'department_id as departmentId'])
      .where('organization_id', '=', access.organizationId)
      .orderBy('name')
      .orderBy('id')
      .execute(),
  }));
}
export async function accessDetail(db: Db, access: StaffAccess, id: string) {
  return accessRead(db, access, async (trx, authorizationRevision) => {
    const org = access.organizationId,
      staff = await principal(trx, org, id);
    const rows = await effectivePermissionContributions(trx, org)
      .leftJoin('access_role_ownership as w', 'w.role_id', 'role.id')
      .select('w.kind')
      .where('assignment.staff_identity_id', '=', id)
      .execute();
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
      readOnly: true,
      accessAdministrator: accessPrerequisites.every((k) =>
        effective.includes(k),
      ),
      permissions: permissionCatalog,
    };
  });
}
export async function accessHistory(
  db: Db,
  access: StaffAccess,
  id: string,
  input: Record<string, unknown>,
) {
  const q = discoveryQuery(input, true);
  return accessRead(db, access, async (trx) => {
    await principal(trx, access.organizationId, id);
    const base = trx
      .selectFrom('access_change_set as a')
      .where('a.organization_id', '=', access.organizationId)
      .where('a.target_staff_id', '=', id);
    const count = await base
      .select(sql<number>`count(*)::int`.as('total'))
      .executeTakeFirstOrThrow();
    const rows = await base
      .leftJoin('staff_identity as s', 's.id', 'a.actor_staff_id')
      .select([
        'a.id',
        'a.operation',
        'a.source',
        'a.created_at as createdAt',
        'a.before_revision as beforeRevision',
        'a.after_revision as afterRevision',
        safeStaffName.as('actor'),
      ])
      .orderBy('a.created_at', 'desc')
      .orderBy('a.id', 'desc')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    const deltas = rows.length
      ? await trx
          .selectFrom('access_permission_delta')
          .select(['change_set_id', 'permission_key', 'direction'])
          .where(
            'change_set_id',
            'in',
            rows.map((r) => r.id),
          )
          .orderBy('permission_key')
          .execute()
      : [];
    return {
      total: count.total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({
        ...r,
        actor:
          r.source === 'controlled_provisioning'
            ? 'Controlled Provisioning'
            : r.actor || 'Staff member',
        beforeRevision: r.beforeRevision,
        afterRevision: r.afterRevision,
        deltas: deltas
          .filter((d) => d.change_set_id === r.id)
          .map((d) => ({
            key: d.permission_key,
            direction: d.direction,
            label:
              permissionCatalog.find((p) => p.key === d.permission_key)
                ?.label ?? 'Unrecognized capability',
          })),
      })),
    };
  });
}
