import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import {
  up,
  down,
} from '../../migrations/20260920020000-enable-public-staff-operations.js';
import { publicWorkflowPermissions } from '../../src/service-request/staff-request-policy.js';

interface ListBody {
  items: {
    serviceRequestId: string;
    audience: string;
    referenceNumber: string;
    issueName: string;
    serviceLocation: string | null;
    status: string;
    departmentName: string;
    divisionName: string | null;
    createdAt: string;
    assignment: { displayName: string; type: string } | null;
  }[];
  total: number;
  page: number;
  hasNextPage: boolean;
}
interface DetailBody {
  audience: string;
  revision: number;
  status: string;
  departmentId: string;
  divisionId: string | null;
  assignment: { id: string; type: string; displayName: string } | null;
  capabilities: {
    workflowActions: string[];
    canRoute: boolean;
    canAssign: boolean;
    canManageWatchers: boolean;
    canReadContact: boolean;
  };
}

export async function checkStaffWorkspace(
  t: TestContext,
  c: {
    app: INestApplication;
    db: Kysely<DatabaseSchema>;
    org: string;
    creator: string;
    otherOrg: string;
    otherInternal: string;
    department: string;
    targetDepartment: string;
    targetDivision: string;
    publicPayload: object;
    internalPayload: object;
    logs: string[];
  },
) {
  const { app, db, org } = c;
  const root = '/api/v1/staff/service-requests';
  const get = (path: string, actor?: string) => {
    const call = request(app.getHttpServer()).get(path);
    return actor ? call.set('Authorization', `Bearer ${actor}`) : call;
  };
  const post = (path: string, body: object, actor: string) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${actor}`)
      .send(body);
  const snapshot = async () => {
    const tables = [
      'service_request',
      'requester_contact',
      'request_operational_activity',
      'service_request_assignment',
      'service_request_watcher',
      'role_permission',
      'activity',
    ] as const;
    const values: Record<string, string> = {};
    for (const table of tables) {
      const rows = await db.selectFrom(table).selectAll().execute();
      values[table] = JSON.stringify(
        rows.map((row) => JSON.stringify(row)).sort(),
      );
    }
    return values;
  };
  await t.test(
    'F040 migration changes only permitted schema and permission registration; rollback/reapply preserves all prior data and grants',
    async () => {
      const before = await snapshot();
      await db.transaction().execute(up);
      assert.deepEqual(await snapshot(), before);
      await db.transaction().execute(down);
      assert.deepEqual(await snapshot(), before);
      await db.transaction().execute(up);
      assert.deepEqual(await snapshot(), before);
      const keys = await db
        .selectFrom('permission')
        .select('permission_key')
        .where('permission_key', 'in', [
          'service_request.route',
          'service_request.watchers.manage',
        ])
        .execute();
      assert.equal(keys.length, 2);
    },
  );
  const tenant = (
    await db
      .selectFrom('staff_identity')
      .select('entra_tenant_id')
      .where('id', '=', c.creator)
      .executeTakeFirstOrThrow()
  ).entra_tenant_id;
  const actor = async (
    keys: string[],
    departments = [c.department],
    division = false,
  ) => {
    const id = randomUUID(),
      role = randomUUID();
    await db
      .insertInto('staff_identity')
      .values({
        id,
        organization_id: org,
        entra_tenant_id: tenant,
        entra_object_id: id,
        display_name: 'F040 fictional staff',
        email: null,
        active: true,
      })
      .execute();
    await db
      .insertInto('role')
      .values({
        id: role,
        organization_id: org,
        name: `F040 ${id}`,
        active: true,
      })
      .execute();
    if (keys.length)
      await db
        .insertInto('role_permission')
        .values(
          keys.map((permission_key) => ({
            organization_id: org,
            role_id: role,
            permission_key,
          })),
        )
        .execute();
    await db
      .insertInto('staff_role_assignment')
      .values({
        organization_id: org,
        role_id: role,
        staff_identity_id: id,
        active: true,
      })
      .execute();
    if (departments.length)
      await db
        .insertInto('staff_department_membership')
        .values(
          departments.map((department_id) => ({
            organization_id: org,
            staff_identity_id: id,
            department_id,
            active: true,
          })),
        )
        .execute();
    if (division)
      await db
        .insertInto('staff_division_membership')
        .values({
          organization_id: org,
          staff_identity_id: id,
          department_id: c.targetDepartment,
          division_id: c.targetDivision,
          active: true,
        })
        .execute();
    return { id, role };
  };
  const publicKeys = [
    'service_request.view',
    ...Object.values(publicWorkflowPermissions),
    'service_request.assign',
    'service_request.route',
    'service_request.watchers.manage',
  ];
  const publicReader = await actor(['service_request.view']);
  const internalReader = await actor(['service_request.internal.read']);
  const bothReader = await actor([
    'service_request.view',
    'service_request.internal.read',
  ]);
  const neither = await actor([]),
    contactOnly = await actor(['service_request.contact.read']);
  const updaterOnly = await actor(
    publicKeys.filter((key) => key !== 'service_request.view'),
  );
  const operator = await actor(
    [
      ...publicKeys,
      'service_request.internal.read',
      'service_request.internal.update',
      'service_request.contact.read',
    ],
    [c.department, c.targetDepartment],
    true,
  );
  const internalOperator = await actor([
    'service_request.internal.read',
    'service_request.internal.update',
  ]);
  const create = async (payload: object) =>
    (await post(root, payload, c.creator).expect(201)).body as {
      id: string;
      referenceNumber: string;
    };
  const contact = {
    name: 'F040 Fictional Requester 山',
    email: 'f040-fixture@example.com',
  };
  const publicRequest = await create({ ...c.publicPayload, contact });
  const internalRequest = await create(c.internalPayload);
  const path = `${root}/${publicRequest.id}`;
  const contactPath = `/api/v1/staff/public-service-requests/${publicRequest.id}/contact`;
  const detail = async (who = operator.id) =>
    (await get(path, who).expect(200)).body as DetailBody;
  const events = () =>
    db
      .selectFrom('request_operational_activity')
      .selectAll()
      .where('organization_id', '=', org)
      .where('service_request_id', '=', publicRequest.id)
      .orderBy('request_revision')
      .orderBy('event_index')
      .execute();
  const parent = () =>
    db
      .selectFrom('service_request')
      .selectAll()
      .where('id', '=', publicRequest.id)
      .executeTakeFirstOrThrow();
  const assertPrivate = (value: unknown) => {
    const text = JSON.stringify(value);
    for (const field of Object.values(contact))
      assert.ok(
        !text.includes(field),
        'Contact must not appear outside the protected projection',
      );
  };

  await t.test(
    'F040 unified list/detail require independent audience keys; anonymous/contact-only/update-only cannot read',
    async () => {
      await get(root).expect(401);
      for (const access of [neither, contactOnly, updaterOnly])
        for (const route of [
          root,
          path,
          `${root}/${internalRequest.id}`,
          `${root}/workspace-options`,
        ])
          await get(route, access.id).expect(403);
      for (const [access, allowed] of [
        [publicReader, ['public']],
        [internalReader, ['internal']],
        [bothReader, ['public', 'internal']],
      ] as const) {
        const list = (await get(`${root}?pageSize=100`, access.id).expect(200))
          .body as ListBody;
        assert.ok(list.items.length > 0);
        assert.ok(
          list.items.every((row) =>
            (allowed as readonly string[]).includes(row.audience),
          ),
        );
        assertPrivate(list);
        await get(path, access.id).expect(
          allowed.includes('public' as never) ? 200 : 404,
        );
        await get(`${root}/${internalRequest.id}`, access.id).expect(
          allowed.includes('internal' as never) ? 200 : 404,
        );
      }
      assertPrivate(await detail());
      assert.deepEqual(
        (await detail(publicReader.id)).capabilities.workflowActions,
        [],
      );
      assert.equal(
        (await detail(publicReader.id)).capabilities.canReadContact,
        false,
      );
    },
  );

  await t.test(
    'F040 All is one ordered scoped union with audience/reference/status narrowing and globally correct counts/pages',
    async () => {
      const all = (await get(`${root}?pageSize=100`, bothReader.id).expect(200))
        .body as ListBody;
      const pub = (
        await get(`${root}?audience=public&pageSize=100`, bothReader.id).expect(
          200,
        )
      ).body as ListBody;
      const internal = (
        await get(
          `${root}?audience=internal&pageSize=100`,
          bothReader.id,
        ).expect(200)
      ).body as ListBody;
      assert.equal(all.total, pub.total + internal.total);
      assert.equal(
        new Set(all.items.map((row) => row.serviceRequestId)).size,
        all.items.length,
      );
      assert.ok(pub.items.every((row) => row.audience === 'public'));
      assert.ok(internal.items.every((row) => row.audience === 'internal'));
      const first = (await get(`${root}?pageSize=1`, bothReader.id).expect(200))
        .body as ListBody;
      const second = (
        await get(`${root}?pageSize=1&page=2`, bothReader.id).expect(200)
      ).body as ListBody;
      assert.deepEqual(
        [first.items[0], second.items[0]],
        all.items.slice(0, 2),
      );
      assert.equal(first.total, all.total);
      const reference = (await parent()).reference_number;
      const exact = (
        await get(
          `${root}?audience=public&status=open&departmentId=${c.department}&search=${encodeURIComponent(reference.toLowerCase())}`,
          publicReader.id,
        ).expect(200)
      ).body as ListBody;
      assert.deepEqual(
        exact.items.map((row) => row.serviceRequestId),
        [publicRequest.id],
      );
      assert.equal(
        (
          (await get(`${root}?audience=internal`, publicReader.id).expect(200))
            .body as ListBody
        ).total,
        0,
      );
      assert.equal(
        (
          (await get(`${root}?audience=public`, internalReader.id).expect(200))
            .body as ListBody
        ).total,
        0,
      );
      for (const query of [
        'audience=other',
        'pageSize=101',
        'page=0',
        'organizationId=forged',
      ])
        await get(`${root}?${query}`, bothReader.id).expect(400);
    },
  );

  await t.test(
    'F040 persisted audience wins over forged query/body; cross-Organization IDs and legacy audience substitution remain denied',
    async () => {
      const foreignPublic = await db
        .selectFrom('service_request')
        .select('id')
        .where('organization_id', '=', c.otherOrg)
        .where('audience', '=', 'public')
        .executeTakeFirstOrThrow();
      await get(`${path}?audience=internal`, internalReader.id).expect(404);
      await get(
        `${root}/${internalRequest.id}?audience=public`,
        publicReader.id,
      ).expect(404);
      for (const suffix of [
        '',
        '/activity',
        '/watchers',
        '/assignment-targets?type=staff',
      ])
        for (const foreignId of [c.otherInternal, foreignPublic.id])
          await get(`${root}/${foreignId}${suffix}`, operator.id).expect(404);
      for (const foreignId of [c.otherInternal, foreignPublic.id])
        for (const [suffix, input] of [
          ['workflow', { action: 'start_work' }],
          ['routing', { departmentId: c.department }],
          ['assignment', { targetType: 'staff', targetId: operator.id }],
          ['watchers', { targetType: 'staff', targetId: operator.id }],
        ] as const)
          await post(
            `${root}/${foreignId}/${suffix}`,
            { expectedRevision: 1, ...input },
            operator.id,
          ).expect(404);
      await get(
        `/api/v1/staff/internal-service-requests/${publicRequest.id}`,
        operator.id,
      ).expect(404);
      await get(
        `/api/v1/service-requests/${internalRequest.id}`,
        operator.id,
      ).expect(404);
      await post(
        `${path}/workflow`,
        { expectedRevision: 1, action: 'start_work', audience: 'internal' },
        operator.id,
      ).expect(400);
      await get(`${root}/${randomUUID()}`, operator.id).expect(404);
    },
  );

  await t.test(
    'F040 PUBLIC read does not grant workflow/routing/assignment/other-watch management; self-watch remains a normal read capability',
    async () => {
      const before = await events();
      for (const access of [publicReader, internalOperator, updaterOnly]) {
        for (const [suffix, body] of [
          ['workflow', { action: 'start_work' }],
          ['routing', { departmentId: c.targetDepartment }],
          ['assignment', { targetType: 'staff', targetId: publicReader.id }],
          ['watchers', { targetType: 'staff', targetId: publicReader.id }],
        ] as const)
          await post(
            `${path}/${suffix}`,
            { expectedRevision: 1, ...body },
            access.id,
          ).expect(access === internalOperator ? 404 : 403);
      }
      assert.deepEqual(await events(), before);
      await post(
        `${path}/watch-self`,
        { expectedRevision: 1 },
        publicReader.id,
      ).expect(200);
      await get(contactPath, publicReader.id).expect(403);
      await post(
        `${path}/unwatch-self`,
        { expectedRevision: 2 },
        publicReader.id,
      ).expect(200);
    },
  );

  await t.test(
    'F040 PUBLIC lifecycle reuses required narratives, revisions, safe audit and append-only history',
    async () => {
      const sequence = [
        ['start_work', 'in_progress', {}],
        ['hold', 'on_hold', { reason: 'F040 fictional hold' }],
        ['resume', 'in_progress', {}],
        ['close', 'closed', { resolutionSummary: 'F040 fictional resolution' }],
        ['reopen', 'open', { reason: 'F040 fictional follow-up' }],
      ] as const;
      for (const [action, status, narrative] of sequence) {
        const revision = (await detail()).revision;
        if (action === 'hold' || action === 'close' || action === 'reopen')
          await post(
            `${path}/workflow`,
            { action, expectedRevision: revision },
            operator.id,
          ).expect(400);
        await post(
          `${path}/workflow`,
          { action, expectedRevision: revision, ...narrative },
          operator.id,
        ).expect(200);
        const current = await detail();
        assert.equal(current.status, status);
        assert.equal(current.revision, revision + 1);
        await post(
          `${path}/workflow`,
          { action, expectedRevision: revision, ...narrative },
          operator.id,
        ).expect(409);
      }
      const history = await events();
      assert.deepEqual(
        history.slice(-5).map((row) => row.activity_type),
        [
          'work_started',
          'placed_on_hold',
          'work_resumed',
          'request_closed',
          'request_reopened',
        ],
      );
      assert.equal(
        history.find((row) => row.activity_type === 'request_closed')
          ?.narrative,
        'F040 fictional resolution',
      );
      const audit = await db
        .selectFrom('activity')
        .selectAll()
        .where('service_request_id', '=', publicRequest.id)
        .execute();
      assertPrivate(audit);
      assert.ok(!JSON.stringify(audit).includes('F040 fictional resolution'));
      await assert.rejects(
        sql`update request_operational_activity set narrative='changed' where service_request_id=${publicRequest.id}`.execute(
          db,
        ),
      );
      await assert.rejects(
        sql`delete from request_operational_activity where service_request_id=${publicRequest.id}`.execute(
          db,
        ),
      );
    },
  );

  await t.test(
    'F040 simultaneous PUBLIC workflow commands permit exactly one revision and one event',
    async () => {
      const revision = (await detail()).revision,
        count = (await events()).length;
      const outcomes = await Promise.all(
        [1, 2].map(() =>
          post(
            `${path}/workflow`,
            { action: 'start_work', expectedRevision: revision },
            operator.id,
          ),
        ),
      );
      assert.deepEqual(outcomes.map((res) => res.status).sort(), [200, 409]);
      assert.equal((await detail()).revision, revision + 1);
      assert.equal((await events()).length, count + 1);
    },
  );

  const role = randomUUID(),
    team = randomUUID(),
    inactiveRole = randomUUID();
  await db
    .insertInto('operational_role')
    .values([
      {
        id: role,
        organization_id: org,
        department_id: c.department,
        division_id: null,
        name: 'F040 fictional role',
        active: true,
      },
      {
        id: inactiveRole,
        organization_id: org,
        department_id: c.department,
        division_id: null,
        name: 'F040 inactive role',
        active: false,
      },
    ])
    .execute();
  await db
    .insertInto('work_group')
    .values({
      id: team,
      organization_id: org,
      department_id: c.department,
      division_id: null,
      name: 'F040 fictional team',
      description: null,
      active: true,
    })
    .execute();
  for (const member of [publicReader, bothReader, neither, internalReader]) {
    await db
      .insertInto('operational_role_membership')
      .values({
        organization_id: org,
        operational_role_id: role,
        staff_identity_id: member.id,
        active: true,
      })
      .execute();
    await db
      .insertInto('work_group_membership')
      .values({
        organization_id: org,
        work_group_id: team,
        staff_identity_id: member.id,
        active: true,
      })
      .execute();
  }
  const command = async (
    suffix: string,
    input: object = {},
    who = operator.id,
  ) =>
    post(
      `${path}/${suffix}`,
      { expectedRevision: (await parent()).revision, ...input },
      who,
    );
  const viewIds = async (who: string, view: string, audience = 'all') =>
    (
      (
        await get(
          `${root}?audience=${audience}&view=${view}&pageSize=100`,
          who,
        ).expect(200)
      ).body as ListBody
    ).items.map((row) => row.serviceRequestId);

  await t.test(
    'F040 PUBLIC target eligibility is scoped, bounded and uses PUBLIC read; target projections contain no identity/RBAC/contact',
    async () => {
      const targets = (
        await get(`${path}/assignment-targets?type=staff`, operator.id).expect(
          200,
        )
      ).body as { items: { id: string; displayName: string }[] };
      assert.ok(targets.items.some((target) => target.id === publicReader.id));
      assert.ok(
        !targets.items.some(
          (target) =>
            target.id === internalReader.id || target.id === neither.id,
        ),
      );
      assert.ok(targets.items.length <= 25);
      assertPrivate(targets);
      for (const target of targets.items)
        assert.deepEqual(Object.keys(target).sort(), [
          'displayName',
          'id',
          'type',
        ]);
      for (const query of [
        'type=email',
        `type=staff&search=${'x'.repeat(101)}`,
        'type=staff&purpose=other',
      ])
        await get(`${path}/assignment-targets?${query}`, operator.id).expect(
          400,
        );
      for (const target of [
        { targetType: 'role', targetId: inactiveRole },
        { targetType: 'staff', targetId: internalReader.id },
        { targetType: 'staff', targetId: randomUUID() },
      ])
        assert.equal((await command('assignment', target)).status, 404);
      const before = await events();
      await post(
        `${path}/assignment`,
        {
          expectedRevision: (await parent()).revision,
          targetType: 'email',
          targetId: 'example@example.com',
        },
        operator.id,
      ).expect(400);
      assert.deepEqual(await events(), before);
    },
  );

  await t.test(
    'F040 picker permissions are operation-specific and legacy PUBLIC mutations still require parent read',
    async () => {
      const assigner = await actor([
        'service_request.view',
        'service_request.assign',
      ]);
      const watcherManager = await actor([
        'service_request.view',
        'service_request.watchers.manage',
      ]);
      for (const [who, purpose, status] of [
        [assigner.id, 'assignment', 200],
        [assigner.id, 'watchers', 403],
        [watcherManager.id, 'assignment', 403],
        [watcherManager.id, 'watchers', 200],
      ] as const)
        await get(
          `${path}/assignment-targets?type=role&purpose=${purpose}`,
          who,
        ).expect(status);
      const before = await snapshot();
      await post(
        `/api/v1/service-requests/${publicRequest.id}/assignment`,
        {
          assignmentType: 'unassigned',
          expectedRevision: (await parent()).revision,
        },
        updaterOnly.id,
      ).expect(403);
      await post(
        `/api/v1/service-requests/${publicRequest.id}/workflow`,
        {
          action: 'hold',
          reason: 'F040 denied legacy hold',
          expectedRevision: (await parent()).revision,
        },
        publicReader.id,
      ).expect(403);
      assert.deepEqual(await snapshot(), before);
    },
  );

  await t.test(
    'F040 PUBLIC assignment supports STAFF/ROLE/TEAM and operational views without granting contact or another audience',
    async () => {
      const direct = await command('assignment', {
        targetType: 'staff',
        targetId: publicReader.id,
      });
      assert.equal(direct.status, 200);
      assert.ok(
        (await viewIds(publicReader.id, 'mine', 'public')).includes(
          publicRequest.id,
        ),
      );
      assert.ok(
        !(await viewIds(bothReader.id, 'mine')).includes(publicRequest.id),
      );
      await get(contactPath, publicReader.id).expect(403);
      for (const [targetType, targetId] of [
        ['role', role],
        ['group', team],
      ]) {
        assert.equal(
          (await command('assignment', { targetType, targetId })).status,
          200,
        );
        assert.equal((await detail()).assignment?.id, targetId);
        assert.ok(
          (await viewIds(publicReader.id, 'team', 'public')).includes(
            publicRequest.id,
          ),
        );
        assert.ok(
          (await viewIds(bothReader.id, 'team')).includes(publicRequest.id),
        );
        assert.ok(
          !(await viewIds(internalReader.id, 'team')).includes(
            publicRequest.id,
          ),
        );
        assert.ok(
          !(await viewIds(publicReader.id, 'mine')).includes(publicRequest.id),
        );
        await get(root + '?view=team', neither.id).expect(403);
        await get(contactPath, publicReader.id).expect(403);
      }
      await db
        .updateTable('work_group_membership')
        .set({ active: false })
        .where('staff_identity_id', '=', publicReader.id)
        .where('work_group_id', '=', team)
        .execute();
      assert.ok(
        !(await viewIds(publicReader.id, 'team')).includes(publicRequest.id),
      );
      await db
        .updateTable('work_group_membership')
        .set({ active: true })
        .where('staff_identity_id', '=', publicReader.id)
        .where('work_group_id', '=', team)
        .execute();
      const before = await events();
      await db
        .updateTable('work_group')
        .set({ name: 'F040 renamed team' })
        .where('id', '=', team)
        .execute();
      assert.equal(
        (await detail()).assignment?.displayName,
        'F040 renamed team',
      );
      assert.deepEqual(await events(), before);
      assert.equal((await command('assignment/remove')).status, 200);
      assert.equal((await detail()).assignment, null);
    },
  );

  await t.test(
    'F040 concurrent assignment and duplicate watcher additions produce one relationship, revision and successful event',
    async () => {
      for (const suffix of ['assignment', 'watchers']) {
        const revision = (await parent()).revision,
          count = (await events()).length;
        const results = await Promise.all(
          [1, 2].map(() =>
            post(
              `${path}/${suffix}`,
              {
                expectedRevision: revision,
                targetType: 'staff',
                targetId: publicReader.id,
              },
              operator.id,
            ),
          ),
        );
        assert.deepEqual(
          results.map((result) => result.status).sort(),
          [200, 409],
        );
        assert.equal((await parent()).revision, revision + 1);
        assert.equal((await events()).length, count + 1);
      }
      assert.equal(
        (
          await db
            .selectFrom('service_request_watcher')
            .selectAll()
            .where('service_request_id', '=', publicRequest.id)
            .where('staff_identity_id', '=', publicReader.id)
            .execute()
        ).length,
        1,
      );
    },
  );

  await t.test(
    'F040 Watching composes direct/ROLE/TEAM membership with independent audience read and contact permission',
    async () => {
      assert.ok(
        (await viewIds(publicReader.id, 'watching', 'public')).includes(
          publicRequest.id,
        ),
      );
      for (const [targetType, targetId] of [
        ['role', role],
        ['group', team],
      ])
        assert.equal(
          (await command('watchers', { targetType, targetId })).status,
          200,
        );
      assert.ok(
        (await viewIds(bothReader.id, 'watching')).includes(publicRequest.id),
      );
      assert.ok(
        !(await viewIds(internalReader.id, 'watching')).includes(
          publicRequest.id,
        ),
      );
      await get(`${root}?view=watching`, neither.id).expect(403);
      await get(contactPath, publicReader.id).expect(403);
      await db
        .insertInto('role_permission')
        .values({
          organization_id: org,
          role_id: publicReader.role,
          permission_key: 'service_request.contact.read',
        })
        .execute();
      assert.deepEqual(
        (await get(contactPath, publicReader.id).expect(200)).body,
        contact,
      );
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', publicReader.role)
        .where('permission_key', '=', 'service_request.contact.read')
        .execute();
      assert.ok(
        (await viewIds(publicReader.id, 'watching')).includes(publicRequest.id),
      );
      await get(contactPath, publicReader.id).expect(403);
      for (const [targetType, targetId] of [
        ['role', role],
        ['group', team],
      ])
        assert.equal(
          (await command('watchers/remove', { targetType, targetId })).status,
          200,
        );
      assert.ok(
        !(await viewIds(bothReader.id, 'watching')).includes(publicRequest.id),
      );
    },
  );

  await t.test(
    'F040 assignment/watch relationships do not survive PUBLIC read revocation as authorization',
    async () => {
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', publicReader.role)
        .where('permission_key', '=', 'service_request.view')
        .execute();
      await get(path, publicReader.id).expect(403);
      await get(`${root}?view=mine`, publicReader.id).expect(403);
      await get(`${root}?view=watching`, publicReader.id).expect(403);
      await get(contactPath, publicReader.id).expect(403);
      await db
        .insertInto('role_permission')
        .values({
          organization_id: org,
          role_id: publicReader.role,
          permission_key: 'service_request.view',
        })
        .execute();
      await get(path, publicReader.id).expect(200);
    },
  );

  const failActivity = async (type: string, action: () => Promise<void>) => {
    await sql`create function fail_f040_activity() returns trigger language plpgsql as $$ begin raise exception 'F040 synthetic failure'; end $$`.execute(
      db,
    );
    await sql`create trigger fail_f040_activity before insert on request_operational_activity for each row when (new.activity_type=${sql.lit(type)}) execute function fail_f040_activity()`.execute(
      db,
    );
    try {
      await action();
    } finally {
      await sql`drop trigger fail_f040_activity on request_operational_activity; drop function fail_f040_activity()`.execute(
        db,
      );
    }
  };
  await t.test(
    'F040 required routing/unassignment events are atomic with scope, revision, owner and security audit',
    async () => {
      for (const type of ['request_routed', 'request_unassigned']) {
        const before = await snapshot();
        await failActivity(type, async () => {
          assert.equal(
            (
              await command('routing', {
                departmentId: c.targetDepartment,
                divisionId: c.targetDivision,
              })
            ).status,
            500,
          );
        });
        assert.deepEqual(await snapshot(), before);
      }
      assert.equal(
        (
          await command('routing', {
            departmentId: c.targetDepartment,
            divisionId: c.targetDivision,
          })
        ).status,
        200,
      );
      const row = await detail();
      assert.equal(row.departmentId, c.targetDepartment);
      assert.equal(row.divisionId, c.targetDivision);
      assert.equal(row.assignment, null);
      assert.deepEqual(
        (await events()).slice(-2).map((event) => event.activity_type),
        ['request_routed', 'request_unassigned'],
      );
      for (const route of [
        path,
        `${path}/watchers`,
        `${path}/activity`,
        contactPath,
        `/api/v1/service-requests/${publicRequest.id}`,
      ])
        await get(route, publicReader.id).expect(
          route === contactPath ? 403 : 404,
        );
      assert.ok(
        !(await viewIds(publicReader.id, 'watching')).includes(
          publicRequest.id,
        ),
      );
      const watchers = (await get(`${path}/watchers`, operator.id).expect(200))
        .body as { items: { id: string }[] };
      assert.ok(watchers.items.some((target) => target.id === publicReader.id));
      const wrongDivision = await actor(
        ['service_request.view', 'service_request.contact.read'],
        [c.targetDepartment],
      );
      await get(path, wrongDivision.id).expect(404);
      await get(contactPath, wrongDivision.id).expect(404);
      assert.deepEqual(
        (await get(contactPath, operator.id).expect(200)).body,
        contact,
      );
    },
  );

  await t.test(
    'F040 routing preserves eligible PUBLIC STAFF assignment and rejects unauthorized/foreign targets without writes',
    async () => {
      assert.equal(
        (
          await command('assignment', {
            targetType: 'staff',
            targetId: operator.id,
          })
        ).status,
        200,
      );
      assert.equal(
        (await command('routing', { departmentId: c.department })).status,
        200,
      );
      assert.equal((await detail()).assignment?.id, operator.id);
      assert.equal((await events()).at(-1)?.activity_type, 'request_routed');
      const before = await snapshot();
      for (const target of [
        { departmentId: randomUUID() },
        { departmentId: c.department, divisionId: c.targetDivision },
      ])
        assert.equal((await command('routing', target)).status, 404);
      assert.deepEqual(await snapshot(), before);
      await assert.rejects(
        db.transaction().execute(down),
        /F040 rollback requires review/,
      );
    },
  );

  await t.test(
    'F040 PUBLIC workflow/assignment/watch failure injection leaves all operational data and audit unchanged',
    async () => {
      for (const [type, suffix, input] of [
        [
          'placed_on_hold',
          'workflow',
          { action: 'hold', reason: 'F040 failed fictional hold' },
        ],
        [
          'request_reassigned',
          'assignment',
          { targetType: 'role', targetId: role },
        ],
        ['watcher_added', 'watchers', { targetType: 'role', targetId: role }],
      ] as const) {
        const before = await snapshot();
        await failActivity(type, async () => {
          assert.equal((await command(suffix, input)).status, 500);
        });
        assert.deepEqual(await snapshot(), before);
      }
    },
  );

  await t.test(
    'F040 independent read revocation changes All immediately; contact permission cannot recover its parent',
    async () => {
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', operator.role)
        .where('permission_key', '=', 'service_request.view')
        .execute();
      const internalOnly = (await get(root, operator.id).expect(200))
        .body as ListBody;
      assert.ok(internalOnly.items.every((row) => row.audience === 'internal'));
      await get(path, operator.id).expect(404);
      await get(contactPath, operator.id).expect(403);
      await db
        .insertInto('role_permission')
        .values({
          organization_id: org,
          role_id: operator.role,
          permission_key: 'service_request.view',
        })
        .execute();
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', operator.role)
        .where('permission_key', '=', 'service_request.internal.read')
        .execute();
      const publicOnly = (await get(root, operator.id).expect(200))
        .body as ListBody;
      assert.ok(publicOnly.items.every((row) => row.audience === 'public'));
      await get(`${root}/${internalRequest.id}`, operator.id).expect(404);
      await db
        .insertInto('role_permission')
        .values({
          organization_id: org,
          role_id: operator.role,
          permission_key: 'service_request.internal.read',
        })
        .execute();
    },
  );

  await t.test(
    'F040 contact is on-demand, audited separately and omitted from ordinary reads/history/logs; unauthenticated staff endpoints remain denied',
    async () => {
      const audits = () =>
        db
          .selectFrom('activity')
          .selectAll()
          .where('service_request_id', '=', publicRequest.id)
          .where('activity_type', '=', 'service_request_contact_viewed')
          .execute();
      const before = (await audits()).length,
        history = await events();
      assertPrivate((await get(root, operator.id).expect(200)).body);
      assertPrivate(await detail());
      const page = (
        await get(`${path}/activity?pageSize=1`, operator.id).expect(200)
      ).body as { items: { type: string }[]; hasNextPage: boolean };
      assert.equal(page.items.length, 1);
      assert.equal(page.hasNextPage, true);
      assertPrivate(page);
      assert.equal((await audits()).length, before);
      await get(contactPath, operator.id)
        .expect(200)
        .expect('Cache-Control', 'no-store');
      assert.equal((await audits()).length, before + 1);
      assertPrivate(await audits());
      assert.deepEqual(await events(), history);
      assertPrivate(c.logs);
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', operator.role)
        .where('permission_key', '=', 'service_request.contact.read')
        .execute();
      assert.equal((await detail()).capabilities.canReadContact, false);
      await get(contactPath, operator.id)
        .expect(403)
        .expect('Cache-Control', 'no-store');
      await get(`/api/v1/service-requests/${publicRequest.id}`).expect(401);
      for (const suffix of ['', '/activity', '/watchers'])
        await get(`${path}${suffix}`).expect(401);
      assertPrivate(publicRequest);
      assert.deepEqual(Object.keys(publicRequest).sort(), [
        'createdAt',
        'id',
        'referenceNumber',
        'status',
      ]);
    },
  );

  await t.test(
    'F040 mixed My Requests/My Team/Watching apply audience authorization before composed filters and pagination',
    async () => {
      const ids = [publicRequest.id, internalRequest.id];
      const mutate = async (id: string, suffix: string, input: object) => {
        const row = (await get(`${root}/${id}`, operator.id).expect(200))
          .body as DetailBody;
        await post(
          `${root}/${id}/${suffix}`,
          { expectedRevision: row.revision, ...input },
          operator.id,
        ).expect(200);
      };
      const assertViews = async (view: string) => {
        for (const [who, audience, allowed] of [
          [bothReader.id, 'all', ids],
          [bothReader.id, 'public', [publicRequest.id]],
          [bothReader.id, 'internal', [internalRequest.id]],
        ] as const) {
          const actual = (await viewIds(who, view, audience)).filter((id) =>
            ids.includes(id),
          );
          assert.deepEqual(actual.sort(), [...allowed].sort());
          const pages: string[] = [];
          const all = (
            await get(
              `${root}?audience=${audience}&view=${view}&pageSize=100&departmentId=${c.department}`,
              who,
            ).expect(200)
          ).body as ListBody;
          for (let page = 1; page <= all.total; page++) {
            const result = (
              await get(
                `${root}?audience=${audience}&view=${view}&pageSize=1&page=${String(page)}&departmentId=${c.department}`,
                who,
              ).expect(200)
            ).body as ListBody;
            assert.equal(result.total, all.total);
            pages.push(...result.items.map((row) => row.serviceRequestId));
          }
          assert.deepEqual(
            pages,
            all.items.map((row) => row.serviceRequestId),
          );
        }
      };
      for (const id of ids)
        await mutate(id, 'assignment', {
          targetType: 'staff',
          targetId: bothReader.id,
        });
      await assertViews('mine');
      await get(contactPath, bothReader.id).expect(403);
      for (const [targetType, targetId] of [
        ['role', role],
        ['group', team],
      ]) {
        for (const id of ids)
          await mutate(id, 'assignment', { targetType, targetId });
        await assertViews('team');
        assert.ok(
          !(await viewIds(bothReader.id, 'mine')).some((id) =>
            ids.includes(id),
          ),
        );
        assert.ok(
          !(await viewIds(publicReader.id, 'team')).includes(
            internalRequest.id,
          ),
        );
        assert.ok(
          !(await viewIds(internalReader.id, 'team')).includes(
            publicRequest.id,
          ),
        );
        await get(contactPath, bothReader.id).expect(403);
        for (const id of ids)
          await mutate(id, 'watchers', { targetType, targetId });
        await assertViews('watching');
        assert.ok(
          !(await viewIds(publicReader.id, 'watching')).includes(
            internalRequest.id,
          ),
        );
        assert.ok(
          !(await viewIds(internalReader.id, 'watching')).includes(
            publicRequest.id,
          ),
        );
        for (const id of ids)
          await mutate(id, 'watchers/remove', { targetType, targetId });
      }
      for (const id of ids)
        await mutate(id, 'watchers', {
          targetType: 'staff',
          targetId: bothReader.id,
        });
      await assertViews('watching');
      for (const id of ids)
        await mutate(id, 'watchers/remove', {
          targetType: 'staff',
          targetId: bothReader.id,
        });
      assert.ok(
        !(await viewIds(bothReader.id, 'watching')).some((id) =>
          ids.includes(id),
        ),
      );
      await mutate(internalRequest.id, 'assignment/remove', {});
      await mutate(publicRequest.id, 'assignment', {
        targetType: 'staff',
        targetId: operator.id,
      });
    },
  );

  await t.test(
    'F040 legacy authenticated PUBLIC workflow shares revision/history/audit semantics while retaining its response contract',
    async () => {
      const before = (await events()).length;
      for (const [action, extra] of [
        ['hold', { reason: 'F040 legacy fictional hold' }],
        ['resume', {}],
      ] as const) {
        const row = await parent();
        const response = await post(
          `/api/v1/service-requests/${publicRequest.id}/workflow`,
          { action, expectedRevision: row.revision, ...extra },
          operator.id,
        ).expect(200);
        const body = response.body as {
          referenceNumber: string;
          revision: number;
        };
        assert.deepEqual(Object.keys(body).sort(), [
          'referenceNumber',
          'revision',
          'serviceRequestId',
          'status',
          'updatedAt',
        ]);
        assert.equal(body.referenceNumber, row.reference_number);
        assert.equal(body.revision, row.revision + 1);
      }
      const history = await events();
      assert.equal(history.length, before + 2);
      assert.deepEqual(
        history.slice(-2).map((row) => row.activity_type),
        ['placed_on_hold', 'work_resumed'],
      );
      assert.equal(history.at(-2)?.narrative, 'F040 legacy fictional hold');
      const audit = await db
        .selectFrom('activity')
        .select('metadata')
        .where('service_request_id', '=', publicRequest.id)
        .execute();
      assert.ok(!JSON.stringify(audit).includes('F040 legacy fictional hold'));
      assertPrivate(audit);
    },
  );
  await t.test(
    'staff list sorting/filtering is global, stable, scoped and validated',
    async (listContext) => {
      const ids: string[] = [];
      for (let i = 0; i < 28; i++) {
        const fixture = await create(
          i % 2 ? c.internalPayload : c.publicPayload,
        );
        ids.push(fixture.id);
        await sql`update service_request set created_at=${new Date(Date.UTC(2026, 0, 1 + Math.floor(i / 2))).toISOString()}::timestamptz where id=${fixture.id}::uuid`.execute(
          db,
        );
        await db
          .updateTable('service_request')
          .set({
            status: i % 3 ? 'open' : 'on_hold',
          })
          .where('id', '=', fixture.id)
          .execute();
      }
      const owned = ids[0];
      const removed = ids[2];
      assert.ok(owned && removed);
      for (const requestId of [owned, removed]) {
        await post(
          root + '/' + requestId + '/assignment',
          { expectedRevision: 1, targetType: 'group', targetId: team },
          operator.id,
        ).expect(200);
      }
      await post(
        root + '/' + removed + '/assignment/remove',
        { expectedRevision: 2 },
        operator.id,
      ).expect(200);
      await post(
        root + '/' + removed + '/watch-self',
        { expectedRevision: 3 },
        operator.id,
      ).expect(200);
      const list = async (query: string, actorId: string = operator.id) =>
        (await get(root + '?pageSize=100&' + query, actorId).expect(200))
          .body as ListBody;
      const baseline = await list('');
      assert.ok(baseline.total >= 28);
      assertPrivate(baseline);
      await listContext.test(
        'F047 search composes with authorized audiences, views, filters, every sort and pagination',
        async () => {
          const location = { id: randomUUID() };
          await sql`insert into location (id, organization_id, service_request_id, entered_address) values (${location.id}::uuid, ${org}::uuid, ${owned}::uuid, 'F047 temporary location')`.execute(
            db,
          );
          try {
            await db
              .updateTable('location')
              .set({
                normalized_address: "  F047 café 東京 50%_\\ O'Neil Lane  ",
                entered_address: 'F047-hidden-alternative',
              })
              .where('id', '=', location.id)
              .execute();
            for (const term of [
              'CAFÉ',
              '東京',
              '50%_',
              '%_\\',
              "O'Neil",
              '  F047 café  ',
            ]) {
              const matches = await list('q=' + encodeURIComponent(term));
              assert.equal(matches.total, 1);
              assert.equal(matches.items[0]?.serviceRequestId, owned);
            }
            assert.equal((await list('q=F047-hidden-alternative')).total, 0);
            assert.equal((await list('q=cafe')).total, 0);
            await db
              .updateTable('location')
              .set({
                normalized_address: ' ',
                entered_address: 'F047  entered fallback',
              })
              .where('id', '=', location.id)
              .execute();
            assert.equal((await list('q=F047%20%20entered')).total, 1);
            assert.equal((await list('q=F047%20entered')).total, 0);
            await db
              .deleteFrom('location')
              .where('id', '=', location.id)
              .execute();
            assert.equal((await list('q=F047%20%20entered')).total, 0);
          } finally {
            await db
              .deleteFrom('location')
              .where('id', '=', location.id)
              .execute();
          }
          const firstRow = baseline.items[0];
          assert.ok(firstRow);
          const term = firstRow.issueName.slice(0, 3).toLowerCase();
          const matches = (row: ListBody['items'][number]) =>
            [row.referenceNumber, row.issueName, row.serviceLocation].some(
              (value) => value?.toLowerCase().includes(term),
            );
          for (const actorId of [
            operator.id,
            publicReader.id,
            internalReader.id,
            bothReader.id,
            c.otherOrg,
            c.otherInternal,
          ]) {
            for (const filter of [
              '',
              'audience=public',
              'audience=internal',
              'view=mine',
              'view=team',
              'view=watching',
              'assignment=assigned',
              'assignment=unassigned',
              'status=open',
              'departmentId=' + c.department,
              'divisionId=' + c.targetDivision,
            ]) {
              const response = await get(
                root + '?pageSize=100&' + filter,
                actorId,
              );
              if (response.status === 403) {
                await get(
                  root + '?q=' + encodeURIComponent(term) + '&' + filter,
                  actorId,
                ).expect(403);
                continue;
              }
              assert.equal(response.status, 200);
              const expected = (response.body as ListBody).items.filter(
                matches,
              );
              const result = await list(
                filter + '&q=' + encodeURIComponent('  ' + term + '  '),
                actorId,
              );
              assert.deepEqual(result.items, expected);
              assert.equal(result.total, expected.length);
              assertPrivate(result);
            }
          }
          for (const sort of [
            'issue',
            'created',
            'status',
            'department',
            'assignment',
          ]) {
            for (const direction of ['asc', 'desc']) {
              const controls = `sort=${sort}&direction=${direction}`;
              const expected = (await list(controls)).items.filter(matches);
              const query = controls + '&q=' + encodeURIComponent(term);
              const result = await list(query);
              assert.deepEqual(result.items, expected);
              const pages = [];
              for (
                let page = 1;
                page <= Math.ceil(expected.length / 5);
                page++
              ) {
                const response = await get(
                  root + `?${query}&pageSize=5&page=${String(page)}`,
                  operator.id,
                ).expect(200);
                const body = response.body as ListBody;
                assert.equal(body.total, expected.length);
                assert.equal(body.hasNextPage, page * 5 < expected.length);
                pages.push(...body.items);
              }
              assert.deepEqual(pages, expected);
            }
          }
          const reference = firstRow.referenceNumber;
          assert.equal(
            (await list('q=' + encodeURIComponent(reference.toLowerCase())))
              .total,
            1,
          );
          assert.equal(
            (await list('q=zzmissing47&search=' + reference)).total,
            0,
          );
          assert.equal(
            (await list('q=' + reference + '&search=' + reference)).total,
            1,
          );
          assert.deepEqual(await list('q=%20%20'), baseline);
          for (const term of [
            publicRequest.id,
            contact.name,
            contact.email,
            'F040 legacy fictional hold',
            'zzmissing47',
            "'; DROP TABLE service_request; --",
            '%_',
            'x'.repeat(160),
          ]) {
            assert.equal(
              (await list('q=' + encodeURIComponent(term))).total,
              0,
            );
          }
          for (const query of [
            'q=x',
            'q=%20x%20',
            'q=a&q=b',
            'q[field]=tree',
            'q=' + 'x'.repeat(161),
          ])
            await get(root + '?' + query, operator.id).expect(400);
          await get(root + '?q=tree').expect(401);
          for (const denied of [neither, contactOnly, updaterOnly])
            await get(root + '?q=tree', denied.id).expect(403);
          const revoked = await actor(['service_request.view']);
          await get(root + '?q=' + encodeURIComponent(term), revoked.id).expect(
            200,
          );
          await db
            .deleteFrom('role_permission')
            .where('role_id', '=', revoked.role)
            .execute();
          await get(root + '?q=' + encodeURIComponent(term), revoked.id).expect(
            403,
          );
          const marker = 'F047-log-privacy-999-Fictional-Lane';
          const logStart = c.logs.length;
          const auditBefore = await db
            .selectFrom('activity')
            .select(sql<number>`count(*)::integer`.as('total'))
            .executeTakeFirstOrThrow();
          await list('q=' + marker);
          await get(root + '?q=' + marker.repeat(6), operator.id).expect(400);
          await get(root + '?q=' + marker, neither.id).expect(403);
          const logs = c.logs.slice(logStart).join('\n');
          assert.ok(logs.includes('/api/v1/staff/service-requests'));
          assert.ok(!logs.includes(marker));
          assert.deepEqual(
            await db
              .selectFrom('activity')
              .select(sql<number>`count(*)::integer`.as('total'))
              .executeTakeFirstOrThrow(),
            auditBefore,
          );
        },
      );
      const defaultOrder = await list('sort=created&direction=desc');
      assert.deepEqual(baseline, defaultOrder);
      const keys = ['issue', 'status', 'department', 'assignment', 'created'];
      const primary = (
        row: ListBody['items'][number],
        key: string,
      ): (string | null)[] =>
        key === 'issue'
          ? [row.issueName, row.referenceNumber]
          : key === 'status'
            ? [row.status]
            : key === 'department'
              ? [row.departmentName, row.divisionName]
              : key === 'assignment'
                ? [
                    row.assignment?.displayName ?? null,
                    row.assignment?.type ?? null,
                  ]
                : [row.createdAt];
      for (const sort of keys)
        for (const direction of ['asc', 'desc']) {
          const result = await list('sort=' + sort + '&direction=' + direction);
          assert.equal(result.total, baseline.total);
          assert.deepEqual(
            result.items.map((r) => r.serviceRequestId).sort(),
            baseline.items.map((r) => r.serviceRequestId).sort(),
          );
          for (let i = 1; i < result.items.length; i++) {
            const a = result.items[i - 1],
              b = result.items[i];
            assert.ok(a && b);
            const av = primary(a, sort),
              bv = primary(b, sort);
            let comparison = 0;
            for (let j = 0; j < av.length; j++) {
              const x = av[j],
                y = bv[j];
              if (x === y) continue;
              if (x == null) {
                comparison = 1;
                break;
              }
              if (y == null) {
                comparison = -1;
                break;
              }
              comparison = (x < y ? -1 : 1) * (direction === 'asc' ? 1 : -1);
              break;
            }
            assert.ok(
              comparison < 0 ||
                (comparison === 0 && a.serviceRequestId > b.serviceRequestId),
              'sort ' +
                sort +
                ' ' +
                direction +
                ' must include deterministic descending ID ties and NULL last',
            );
          }
          const first = (
            await get(
              root +
                '?pageSize=25&page=1&sort=' +
                sort +
                '&direction=' +
                direction,
              operator.id,
            ).expect(200)
          ).body as ListBody;
          const second = (
            await get(
              root +
                '?pageSize=25&page=2&sort=' +
                sort +
                '&direction=' +
                direction,
              operator.id,
            ).expect(200)
          ).body as ListBody;
          assert.deepEqual(
            [...first.items, ...second.items].map((r) => r.serviceRequestId),
            result.items.map((r) => r.serviceRequestId),
          );
          assert.equal(second.total, result.total);
        }
      for (const assignment of ['assigned', 'unassigned']) {
        const result = await list(
          'assignment=' + assignment + '&sort=issue&direction=asc',
        );
        assert.deepEqual(
          result.items.map((r) => r.serviceRequestId).sort(),
          baseline.items
            .filter(
              (r) => Boolean(r.assignment) === (assignment === 'assigned'),
            )
            .map((r) => r.serviceRequestId)
            .sort(),
        );
        assert.equal(result.total, result.items.length);
        for (const audience of ['public', 'internal']) {
          const scoped = await list(
            'audience=' +
              audience +
              '&assignment=' +
              assignment +
              '&sort=created&direction=desc',
          );
          assert.ok(
            scoped.items.every(
              (r) =>
                r.audience === audience &&
                Boolean(r.assignment) === (assignment === 'assigned'),
            ),
          );
        }
      }
      const unassigned = await list('assignment=unassigned');
      assert.ok(unassigned.items.some((r) => r.serviceRequestId === removed));
      assert.ok(!unassigned.items.some((r) => r.serviceRequestId === owned));
      const openUnassigned = await list(
        'status=open&departmentId=' +
          c.department +
          '&assignment=unassigned&sort=issue&direction=asc',
      );
      assert.ok(openUnassigned.items.length);
      assert.ok(
        openUnassigned.items.every((r) => r.status === 'open' && !r.assignment),
      );
      for (const view of ['mine', 'team', 'watching'])
        for (const assignment of ['assigned', 'unassigned']) {
          const all = await list('view=' + view, bothReader.id);
          const narrowed = await list(
            'view=' +
              view +
              '&assignment=' +
              assignment +
              '&sort=created&direction=desc',
            bothReader.id,
          );
          assert.deepEqual(
            narrowed.items.map((r) => r.serviceRequestId).sort(),
            all.items
              .filter(
                (r) => Boolean(r.assignment) === (assignment === 'assigned'),
              )
              .map((r) => r.serviceRequestId)
              .sort(),
          );
        }
      assert.ok(
        (await list('view=team&assignment=assigned', bothReader.id)).items.some(
          (r) => r.serviceRequestId === owned,
        ),
      );
      for (const actorId of [
        publicReader.id,
        internalReader.id,
        c.otherOrg,
        c.otherInternal,
      ]) {
        const baselineResponse = await get(root + '?pageSize=100', actorId);
        if (baselineResponse.status === 403) {
          await get(
            root + '?assignment=unassigned&sort=assignment&direction=desc',
            actorId,
          ).expect(403);
          continue;
        }
        assert.equal(baselineResponse.status, 200);
        const allowed = baselineResponse.body as ListBody;
        for (const sort of keys) {
          const result = await list(
            'sort=' + sort + '&direction=asc&assignment=unassigned',
            actorId,
          );
          assert.ok(
            result.items.every((r) =>
              allowed.items.some(
                (a) => a.serviceRequestId === r.serviceRequestId,
              ),
            ),
          );
        }
      }
      for (const query of [
        'sort=secret',
        'sort=request.id%20desc',
        'direction=up',
        'assignment=watching',
      ])
        await get(root + '?' + query, operator.id).expect(400);
      await get(
        root + '?assignment=unassigned&sort=created',
        neither.id,
      ).expect(403);
    },
  );
}
