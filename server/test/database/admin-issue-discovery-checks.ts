import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { AdminIssueService } from '../../src/admin/admin-issue.service.js';
import {
  issueDiscoverySql,
  issueTemplateSql,
  type IssueDiscoveryInput,
} from '../../src/admin/admin-issue-discovery.service.js';

function present<T>(value: T | undefined): T {
  assert.notEqual(value, undefined);
  return value as T;
}
interface Summary {
  id: string;
  name: string;
  categoryId: string;
  category: string;
  active: boolean;
  displayOrder: number;
  requesterPolicy: string;
  assignmentLabel: string | null;
}
interface Page {
  items: Summary[];
  total: number;
  page: number;
  pageSize: number;
}
export async function checkAdminIssueDiscovery(
  t: TestContext,
  c: {
    db: Kysely<DatabaseSchema>;
    app: INestApplication;
    org: string;
    actor: string;
    logs: string[];
    templateId: string;
  },
) {
  const { db, org, actor } = c,
    api = c.app.getHttpServer() as Server;
  const get = (suffix: string) =>
    request(api)
      .get(`/api/v1/admin/issues/${suffix}`)
      .set('Authorization', `Bearer ${actor}`);
  const list = async (query: IssueDiscoveryInput = {}) =>
    (
      await get(
        `summaries?${new URLSearchParams(query as Record<string, string>).toString()}`,
      ).expect(200)
    ).body as Page;
  const template = await db
    .selectFrom('service_definition')
    .selectAll()
    .where('id', '=', c.templateId)
    .executeTakeFirstOrThrow();
  const category = await db
    .selectFrom('category')
    .selectAll()
    .where('id', '=', template.category_id)
    .executeTakeFirstOrThrow();
  const categoryIds = [randomUUID(), randomUUID()];
  for (const [index, id] of categoryIds.entries())
    await db
      .insertInto('category')
      .values({
        ...category,
        id,
        name: `Scale Category ${String(index)}`,
        display_order: index,
      })
      .execute();
  const ids: string[] = [];
  await db.transaction().execute(async (trx) => {
    for (let n = 0; n < 525; n++) {
      const id = randomUUID(),
        version = randomUUID();
      ids.push(id);
      const name = `Scale ${String(n).padStart(3, '0')}${n === 1 ? ' Café 100%_ literal' : ''}`;
      await trx
        .insertInto('service_definition')
        .values({
          id,
          organization_id: org,
          category_id: present(categoryIds[n % 2]),
          availability: 'INTERNAL_AND_EXTERNAL',
          service_key: `scale-${String(n)}`,
          status: n % 3 ? 'active' : 'inactive',
          current_published_version_id: null,
          display_order: n % 5,
          current_display_name: name,
        })
        .execute();
      await trx
        .insertInto('service_definition_version')
        .values({
          id: version,
          organization_id: org,
          service_definition_id: id,
          version_number: 1,
          name,
          resident_description:
            'Private synthetic configuration excluded from summaries',
          icon_key: 'test',
          aliases: [],
          keywords: [],
          default_priority: 'medium',
          location_policy: 'not_applicable',
          geographic_eligibility_mode: 'no_geographic_restriction',
          anonymous_reporting_policy: n % 2 ? 'allowed' : 'not_allowed',
          status: 'published',
          published_at: new Date(),
          routing_metadata: null,
        })
        .execute();
      await trx
        .updateTable('service_definition')
        .set({ current_published_version_id: version })
        .where('id', '=', id)
        .execute();
    }
  });
  await t.test(
    'F056.1 525 disposable Issues: complete pagination, bounded sizes, normalized page and minimal projection',
    async () => {
      const seen: string[] = [];
      for (let page = 1; page <= 21; page++) {
        const result = await list({ search: 'Scale', page: String(page) });
        assert.equal(result.total, 525);
        assert.equal(result.items.length, 25);
        seen.push(...result.items.map((i) => i.id));
        for (const row of result.items)
          assert.deepEqual(
            Object.keys(row).sort(),
            [
              'id',
              'name',
              'categoryId',
              'category',
              'active',
              'displayOrder',
              'requesterPolicy',
              'assignmentLabel',
              'availability',
              'actionType',
            ].sort(),
          );
      }
      assert.deepEqual(seen.toSorted(), ids.toSorted());
      assert.equal(new Set(seen).size, 525);
      for (const size of [25, 50, 100, 250, 500]) {
        const result = await list({ search: 'Scale', pageSize: String(size) });
        assert.equal(result.items.length, size);
        const last = await list({
          search: 'Scale',
          pageSize: String(size),
          page: '99999',
        });
        assert.equal(last.page, Math.ceil(525 / size));
      }
      assert.equal(
        (await list({ search: 'Scale', pageSize: '500', page: '2' })).items
          .length,
        25,
      );
    },
  );
  await t.test(
    'F056.1 literal search, Unicode, AND filters, sorting, template cap, detail and cross-Organization isolation',
    async () => {
      for (const search of ['  café  ', '100%_', '%_'])
        assert.equal((await list({ search })).total, 1);
      assert.equal((await list({ search: "' OR 1=1 --" })).total, 0);
      const filtered = await list({
        search: 'Scale',
        status: 'active',
        category: present(categoryIds[1]),
        requesterPolicy: 'ANONYMOUS_ALLOWED',
        assignmentState: 'none',
        pageSize: '500',
      });
      assert.equal(filtered.total, 175);
      for (const sort of [
        'default',
        'name',
        'category',
        'order',
        'status',
        'policy',
        'assignment',
      ])
        for (const direction of ['asc', 'desc']) {
          const first = await list({
            search: 'Scale',
            sort,
            direction,
            pageSize: '500',
          });
          const second = await list({
            search: 'Scale',
            sort,
            direction,
            pageSize: '500',
            page: '2',
          });
          assert.deepEqual(
            [...first.items, ...second.items].map((i) => i.id).toSorted(),
            ids.toSorted(),
          );
          assert.deepEqual(
            (await list({ search: 'Scale', sort, direction, pageSize: '500' }))
              .items,
            first.items,
          );
        }
      const templates = (await get('templates?search=Scale').expect(200))
        .body as {
        items: { id: string; name: string; category: string }[];
        hasMore: boolean;
      };
      assert.equal(templates.items.length, 25);
      assert.equal(templates.hasMore, true);
      assert.ok(
        templates.items.every((item) => ids.indexOf(item.id) % 3 !== 0),
      );
      for (const item of templates.items)
        assert.deepEqual(
          Object.keys(item).sort(),
          ['id', 'name', 'category'].sort(),
        );
      await c.app.get(AdminIssueService).detail(
        {
          organizationId: org,
          staffIdentityId: actor,
          tenantId: 'fixture',
          objectId: actor,
          displayName: 'Fixture',
          scopes: [],
          permissions: ['admin.configuration.read'],
          departmentIds: [],
          divisionIds: [],
          development: false,
        },
        present(ids[0]),
      );
      const detail = (await get(present(ids[0])).expect(200)).body as {
        issue: { description: string; coreRevision: number };
      };
      assert.equal(
        detail.issue.description,
        'Private synthetic configuration excluded from summaries',
      );
      assert.equal(detail.issue.coreRevision, 2);
      const foreign = await db
        .selectFrom('service_definition')
        .select(['id', 'category_id'])
        .where('organization_id', '!=', org)
        .executeTakeFirstOrThrow();
      assert.equal((await list({ category: foreign.category_id })).total, 0);
      await get(foreign.id).expect(404);
      assert.ok(!templates.items.some((i) => i.id === foreign.id));
      const categories = (await get('categories').expect(200)).body as {
        items: { id: string }[];
      };
      assert.ok(!categories.items.some((i) => i.id === foreign.category_id));
    },
  );
  await t.test(
    'F056.1 strict DTO validation and authenticated read permission',
    async () => {
      for (const query of [
        'page=0',
        'page=-1',
        'page=1.5',
        'pageSize=501',
        'pageSize=all',
        'pageSize=0',
        'pageSize=26',
        'sort=forged',
        'direction=forged',
        'status=forged',
        'organizationId=forged',
        'category=bad',
        'search=' + 'x'.repeat(101),
        'search=a&search=b',
      ])
        await get(`summaries?${query}`).expect(400);
      for (const route of [
        'summaries',
        'categories',
        'templates',
        present(ids[0]),
      ])
        await request(api).get(`/api/v1/admin/issues/${route}`).expect(401);
      await get('templates?organizationId=forged').expect(400);
      await get('categories?search=forged').expect(400);
      const role = await db
        .selectFrom('staff_role_assignment')
        .select('role_id')
        .where('staff_identity_id', '=', actor)
        .executeTakeFirstOrThrow();
      const readGrant = await db
        .selectFrom('role_permission')
        .selectAll()
        .where('role_id', '=', role.role_id)
        .where('permission_key', '=', 'admin.configuration.read')
        .executeTakeFirstOrThrow();
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', role.role_id)
        .where('permission_key', '=', 'admin.configuration.read')
        .execute();
      try {
        for (const route of [
          'summaries',
          'templates',
          'categories',
          present(ids[0]),
        ])
          await get(route).expect(403);
      } finally {
        await db.insertInto('role_permission').values(readGrant).execute();
      }
      const writeGrant = await db
        .selectFrom('role_permission')
        .selectAll()
        .where('role_id', '=', role.role_id)
        .where('permission_key', '=', 'admin.issues.write')
        .executeTakeFirstOrThrow();
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', role.role_id)
        .where('permission_key', '=', 'admin.issues.write')
        .execute();
      try {
        for (const route of [
          'summaries',
          'templates',
          'categories',
          present(ids[0]),
        ])
          await get(route).expect(200);
        assert.equal(
          ((await get('summaries').expect(200)).body as { canWrite: boolean })
            .canWrite,
          false,
        );
      } finally {
        await db.insertInto('role_permission').values(writeGrant).execute();
      }
    },
  );
  await t.test(
    'F056.1 representative SQL plans and timings on disposable scale data',
    async () => {
      await sql`analyze service_definition`.execute(db);
      await sql`analyze service_definition_version`.execute(db);
      const cases: [string, IssueDiscoveryInput][] = [
        ['default25', {}],
        ['default500', { pageSize: '500' }],
        ['nameSearch', { search: 'Scale 1' }],
        ['categorySearch', { search: 'Scale Category 1' }],
        [
          'combined',
          {
            search: 'Scale',
            status: 'active',
            category: present(categoryIds[1]),
            requesterPolicy: 'ANONYMOUS_ALLOWED',
            assignmentState: 'none',
          },
        ],
        ['assignmentSort', { sort: 'assignment' }],
        ['availability', { availability: 'INTERNAL_AND_EXTERNAL' }],
        ['handling', { handling: 'internal_intake' }],
        [
          'availabilityHandling',
          { availability: 'EXTERNAL_ONLY', handling: 'external_redirect' },
        ],
      ];
      for (const [name, query] of cases) {
        const statements = issueDiscoverySql(org, query);
        for (const [kind, statement] of [
          ['page', statements.page(0)],
          ['count', statements.count],
          ...(name === 'default25'
            ? ([['templates', issueTemplateSql(org, 'Scale')]] as const)
            : []),
        ] as const) {
          interface PlanNode {
            'Node Type': string;
            'Index Name'?: string;
            'Actual Rows': number;
            'Plan Rows': number;
            'Actual Loops': number;
            Plans?: PlanNode[];
          }
          const planResult = (
            await sql<{
              'QUERY PLAN': {
                Plan: PlanNode;
                'Execution Time': number;
                'Planning Time': number;
              }[];
            }>`explain (analyze,buffers,format json) ${statement}`.execute(db)
          ).rows[0];
          const plan = present(present(planResult)['QUERY PLAN'][0]);
          const nodes: object[] = [];
          const visit = (node: PlanNode) => {
            nodes.push({
              type: node['Node Type'],
              index: node['Index Name'],
              actual: node['Actual Rows'],
              estimated: node['Plan Rows'],
              loops: node['Actual Loops'],
            });
            node.Plans?.forEach(visit);
          };
          visit(plan.Plan);
          t.diagnostic(
            `${name}/${kind}: ${JSON.stringify({ executionMs: plan['Execution Time'], planningMs: plan['Planning Time'], nodes })}`,
          );
        }
      }
    },
  );
  assert.ok(!c.logs.join('\n').includes("' OR 1=1 --"));
  assert.ok(
    !c.logs
      .join('\n')
      .includes('Private synthetic configuration excluded from summaries'),
  );
}
