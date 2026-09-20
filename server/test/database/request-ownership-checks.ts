import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { down } from '../../migrations/20260920000000-add-assignment-watchers.js';

export async function checkRequestOwnership(
  t: TestContext,
  c: {
    app: INestApplication;
    db: Kysely<DatabaseSchema>;
    org: string;
    creator: string;
    publicOnly: string;
    noGrant: string;
    otherStaff: string;
    otherOrg: string;
    otherInternal: string;
    publicId: string;
    internalPayload: object;
    department: string;
    targetDepartment: string;
    targetDivision: string;
  },
) {
  const { db, app, org, creator } = c;
  const root = '/api/v1/staff/internal-service-requests';
  const post = (path: string, body: object, actor = creator) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${actor}`)
      .send(body);
  const get = (path: string, actor = creator) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${actor}`);
  await db
    .updateTable('staff_department_membership')
    .set({ active: true })
    .where('staff_identity_id', '=', creator)
    .execute();
  const readerRole = randomUUID();
  await db
    .insertInto('role')
    .values({
      id: readerRole,
      organization_id: org,
      name: 'F037 fictional reader',
      active: true,
      description: null,
    })
    .execute();
  await db
    .insertInto('role_permission')
    .values({
      organization_id: org,
      role_id: readerRole,
      permission_key: 'service_request.internal.read',
    })
    .execute();
  await db
    .insertInto('staff_role_assignment')
    .values({
      organization_id: org,
      role_id: readerRole,
      staff_identity_id: c.publicOnly,
      active: true,
    })
    .execute();
  const role = randomUUID(),
    group = randomUUID(),
    foreignRole = randomUUID(),
    inactive = randomUUID(),
    outOfScope = randomUUID();
  await db
    .insertInto('operational_role')
    .values([
      {
        id: role,
        organization_id: org,
        department_id: c.department,
        division_id: null,
        name: 'Fictional Field Reviewer',
        active: true,
      },
      {
        id: inactive,
        organization_id: org,
        department_id: c.department,
        division_id: null,
        name: 'Inactive reviewer',
        active: false,
      },
      {
        id: outOfScope,
        organization_id: org,
        department_id: c.targetDepartment,
        division_id: c.targetDivision,
        name: 'Other scope reviewer',
        active: true,
      },
    ])
    .execute();
  const foreignDepartment = (
    await db
      .selectFrom('department')
      .select('id')
      .where('organization_id', '=', c.otherOrg)
      .executeTakeFirstOrThrow()
  ).id;
  await db
    .insertInto('operational_role')
    .values({
      id: foreignRole,
      organization_id: c.otherOrg,
      department_id: foreignDepartment,
      division_id: null,
      name: 'Other organization role',
      active: true,
    })
    .execute();
  await db
    .insertInto('work_group')
    .values({
      id: group,
      organization_id: org,
      department_id: c.department,
      division_id: null,
      name: 'Fictional Team <script>text</script>',
      description: null,
      active: true,
    })
    .execute();
  for (const staff of [creator, c.noGrant]) {
    await db
      .insertInto('operational_role_membership')
      .values({
        organization_id: org,
        operational_role_id: role,
        staff_identity_id: staff,
        active: true,
      })
      .execute();
    await db
      .insertInto('work_group_membership')
      .values({
        organization_id: org,
        work_group_id: group,
        staff_identity_id: staff,
        active: true,
      })
      .execute();
  }
  const created = await post(
    '/api/v1/staff/service-requests',
    c.internalPayload,
  ).expect(201);
  const id = (created.body as { id: string }).id,
    path = `${root}/${id}`;
  const parent = () =>
    db
      .selectFrom('service_request')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  const events = () =>
    db
      .selectFrom('request_operational_activity')
      .selectAll()
      .where('service_request_id', '=', id)
      .orderBy('request_revision')
      .orderBy('event_index')
      .execute();
  const body = async (
    type: string | undefined,
    targetId: string | undefined,
  ) => ({
    expectedRevision: (await parent()).revision,
    targetType: type,
    targetId,
  });
  const detail = async () =>
    (await get(path).expect(200)).body as {
      assignment: {
        type: string;
        id: string;
        displayName: string;
        active: boolean;
      } | null;
    };
  const view = async (v: string, actor = creator) =>
    (
      (await get(`${root}?view=${v}`, actor).expect(200)).body as {
        items: { serviceRequestId: string }[];
      }
    ).items.some((r) => r.serviceRequestId === id);
  await t.test(
    'F037 normal guards, read-only assignment denial, IDOR and membership without RBAC',
    async () => {
      await request(app.getHttpServer())
        .post(`${path}/assignment`)
        .send(await body('role', role))
        .expect(401);
      await post(
        `${path}/assignment`,
        await body('role', role),
        c.publicOnly,
      ).expect(403);
      for (const endpoint of [
        path,
        `${path}/watchers`,
        `${root}?view=team`,
        `${root}?view=watching`,
      ])
        await get(endpoint, c.noGrant).expect(403);
      for (const wrong of [c.publicId, c.otherInternal, randomUUID()]) {
        await post(
          `${root}/${wrong}/assignment`,
          await body('role', role),
        ).expect(404);
        await get(`${root}/${wrong}/watchers`).expect(404);
        await get(`${root}/${wrong}/assignment-targets?type=role`).expect(404);
      }
      assert.equal((await events()).length, 1);
    },
  );
  await t.test(
    'F037 eligible targets are bounded, scoped and privacy minimized',
    async () => {
      for (const type of ['staff', 'role', 'group']) {
        const result = await get(
          `${path}/assignment-targets?type=${type}`,
        ).expect(200);
        assert.equal(result.headers['cache-control'], 'no-store');
        const items = (
          result.body as {
            items: { type: string; id: string; displayName: string }[];
          }
        ).items;
        assert.ok(items.length > 0 && items.length <= 25);
        items.forEach((item) => {
          assert.deepEqual(Object.keys(item).sort(), [
            'displayName',
            'id',
            'type',
          ]);
        });
        assert.ok(
          !items.some((r) =>
            [
              inactive,
              foreignRole,
              outOfScope,
              c.noGrant,
              c.otherStaff,
            ].includes(r.id),
          ),
        );
      }
      for (const query of [
        'type=email',
        'type=role&organizationId=' + c.otherOrg,
        'type=role&search=' + 'x'.repeat(101),
        'type=role&search=%0A',
      ])
        await get(`${path}/assignment-targets?${query}`).expect(400);
      const wildcard = await get(
        `${path}/assignment-targets?type=role&search=%25`,
      ).expect(200);
      assert.deepEqual((wildcard.body as { items: unknown[] }).items, []);
    },
  );
  await t.test(
    'F037 validates forged, inactive, out-of-scope, mismatched and unauthorized targets without writes',
    async () => {
      const before = await parent(),
        history = await events();
      for (const [type, targetId] of [
        ['role', foreignRole],
        ['role', inactive],
        ['role', outOfScope],
        ['role', randomUUID()],
        ['staff', role],
        ['staff', c.noGrant],
      ]) {
        for (const endpoint of ['assignment', 'watchers'])
          await post(`${path}/${endpoint}`, await body(type, targetId)).expect(
            404,
          );
      }
      for (const extra of [
        { organizationId: c.otherOrg },
        { targetEmail: 'fictional@example.com' },
        { entraObjectId: randomUUID() },
        { displayName: 'forged' },
      ])
        await post(`${path}/assignment`, {
          ...(await body('role', role)),
          ...extra,
        }).expect(400);
      for (const type of ['distribution_list', 'email', '*'])
        await post(`${path}/assignment`, await body(type, role)).expect(400);
      assert.deepEqual(await parent(), before);
      assert.deepEqual(await events(), history);
    },
  );
  await t.test(
    'F037 STAFF to ROLE to GROUP to unassigned preserves routing and historical snapshots',
    async () => {
      const route = (await parent()).routed_department_id;
      for (const [type, targetId] of [
        ['staff', creator],
        ['role', role],
        ['group', group],
      ]) {
        const before = await parent();
        await post(`${path}/assignment`, await body(type, targetId)).expect(
          200,
        );
        assert.equal((await detail()).assignment?.type, type);
        assert.equal((await parent()).revision, before.revision + 1);
        assert.equal((await parent()).routed_department_id, route);
        assert.equal(await view('mine'), type === 'staff');
        assert.equal(await view('team'), type !== 'staff');
      }
      const beforeRename = await events();
      await db
        .updateTable('operational_role')
        .set({ name: 'Renamed fictional reviewer' })
        .where('id', '=', role)
        .execute();
      assert.deepEqual(await events(), beforeRename);
      await post(`${path}/assignment/remove`, {
        expectedRevision: (await parent()).revision,
      }).expect(200);
      assert.equal((await detail()).assignment, null);
      assert.deepEqual(
        (await events()).slice(-4).map((r) => r.activity_type),
        [
          'request_assigned',
          'request_reassigned',
          'request_reassigned',
          'request_unassigned',
        ],
      );
      assert.equal(
        (await events()).at(-2)?.from_target_name,
        'Fictional Field Reviewer',
      );
    },
  );
  await t.test(
    'F037 assignment concurrency yields one success, one conflict and one current owner',
    async () => {
      const input = await body('role', role),
        before = (await events()).length;
      const results = await Promise.all([
        post(`${path}/assignment`, input),
        post(`${path}/assignment`, {
          ...input,
          targetType: 'group',
          targetId: group,
        }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      assert.equal((await events()).length, before + 1);
      const rows = await db
        .selectFrom('service_request_assignment')
        .selectAll()
        .where('service_request_id', '=', id)
        .where('ended_at', 'is', null)
        .execute();
      assert.equal(rows.length, 1);
    },
  );
  await t.test(
    'F037 watchers support all types, explicit overlap, duplicate conflicts and removal history',
    async () => {
      for (const [type, targetId] of [
        ['staff', creator],
        ['role', role],
        ['group', group],
      ])
        await post(`${path}/watchers`, await body(type, targetId)).expect(200);
      const state = (await get(`${path}/watchers`).expect(200)).body as {
        items: unknown[];
        watchingSelf: boolean;
      };
      assert.equal(state.items.length, 3);
      assert.equal(state.watchingSelf, true);
      assert.equal(await view('watching'), true);
      const count = (await events()).length;
      await post(`${path}/watchers`, await body('role', role)).expect(409);
      assert.equal((await events()).length, count);
      await post(`${path}/watchers/remove`, await body('role', role)).expect(
        200,
      );
      await post(`${path}/watchers/remove`, await body('role', role)).expect(
        409,
      );
      assert.equal((await events()).at(-1)?.activity_type, 'watcher_removed');
    },
  );
  await t.test(
    'F037 authorized reader self-watch cannot impersonate or manage another watcher',
    async () => {
      let revision = (await parent()).revision;
      await post(
        `${path}/watch-self`,
        { expectedRevision: revision, targetId: creator },
        c.publicOnly,
      ).expect(400);
      await post(
        `${path}/watchers`,
        await body('staff', creator),
        c.publicOnly,
      ).expect(403);
      await post(
        `${path}/watch-self`,
        { expectedRevision: revision },
        c.publicOnly,
      ).expect(200);
      assert.equal(await view('watching', c.publicOnly), true);
      revision = (await parent()).revision;
      await post(
        `${path}/unwatch-self`,
        { expectedRevision: revision },
        c.publicOnly,
      ).expect(200);
      assert.equal(await view('watching', c.publicOnly), false);
    },
  );
  await t.test(
    'F037 concurrent identical watcher additions emit exactly one event',
    async () => {
      const input = await body('role', role),
        before = (await events()).length;
      const results = await Promise.all([
        post(`${path}/watchers`, input),
        post(`${path}/watchers`, input),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      assert.equal((await events()).length, before + 1);
    },
  );
  await t.test(
    'F037 operational membership filters narrow results and never confer permissions',
    async () => {
      await post(`${path}/assignment`, await body('group', group));
      assert.equal(await view('team'), true);
      await db
        .updateTable('work_group_membership')
        .set({ active: false })
        .where('work_group_id', '=', group)
        .where('staff_identity_id', '=', creator)
        .execute();
      assert.equal(await view('team'), false);
      await get(`${root}?view=team`, c.noGrant).expect(403);
      await db
        .updateTable('work_group_membership')
        .set({ active: true })
        .where('work_group_id', '=', group)
        .where('staff_identity_id', '=', creator)
        .execute();
      const ref = (await parent()).reference_number;
      const list = await get(
        `${root}?view=team&search=${ref}&status=open&departmentId=${c.department}&pageSize=1`,
      ).expect(200);
      assert.equal((list.body as { total: number }).total, 1);
      await get(`${root}?view=all&staffPrincipalId=${c.noGrant}`).expect(400);
      await get(`${root}?view=forged`).expect(400);
    },
  );
  await t.test(
    'F037 failure injection rolls back assignment, watcher, revision and activity',
    async () => {
      await sql`create function fail_f037() returns trigger language plpgsql as $$ begin if new.activity_type in ('request_reassigned','watcher_removed') then raise exception 'synthetic failure'; end if; return new; end $$; create trigger fail_f037 before insert on request_operational_activity for each row execute function fail_f037()`.execute(
        db,
      );
      const before = await parent(),
        history = await events(),
        assignment = (await detail()).assignment;
      await post(`${path}/assignment`, await body('role', role)).expect(500);
      await post(
        `${path}/watchers/remove`,
        await body('staff', creator),
      ).expect(500);
      assert.deepEqual(await parent(), before);
      assert.deepEqual(await events(), history);
      assert.deepEqual((await detail()).assignment, assignment);
      await sql`drop trigger fail_f037 on request_operational_activity; drop function fail_f037()`.execute(
        db,
      );
    },
  );
  await t.test(
    'F037 routing clears ineligible assignment atomically, retains watchers, and revokes scope-based access',
    async () => {
      await post(
        `${path}/watch-self`,
        { expectedRevision: (await parent()).revision },
        c.publicOnly,
      ).expect(200);
      const before = await parent(),
        history = await events();
      for (const eventType of ['request_routed', 'request_unassigned']) {
        await sql`create function fail_route_f037() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end $$`.execute(
          db,
        );
        await sql`create trigger fail_route_f037 before insert on request_operational_activity for each row when (new.activity_type=${sql.lit(eventType)}) execute function fail_route_f037()`.execute(
          db,
        );
        await post(`${path}/routing`, {
          expectedRevision: before.revision,
          departmentId: c.targetDepartment,
          divisionId: c.targetDivision,
        }).expect(500);
        assert.deepEqual(await parent(), before);
        assert.deepEqual(await events(), history);
        await sql`drop trigger fail_route_f037 on request_operational_activity; drop function fail_route_f037()`.execute(
          db,
        );
      }
      await post(`${path}/routing`, {
        expectedRevision: before.revision,
        departmentId: c.targetDepartment,
        divisionId: c.targetDivision,
      }).expect(200);
      assert.equal((await detail()).assignment, null);
      const last = (await events()).slice(-2);
      assert.deepEqual(
        last.map((r) => r.activity_type),
        ['request_routed', 'request_unassigned'],
      );
      assert.equal(last[0]?.request_revision, last[1]?.request_revision);
      await get(path, c.publicOnly).expect(404);
      assert.equal(await view('watching', c.publicOnly), false);
      assert.ok(
        (
          await db
            .selectFrom('service_request_watcher')
            .selectAll()
            .where('service_request_id', '=', id)
            .execute()
        ).length >= 3,
      );
    },
  );
  await t.test(
    'F037 compatible routing preserves STAFF assignment with no spurious unassignment',
    async () => {
      await post(`${path}/assignment`, await body('staff', creator)).expect(
        200,
      );
      const before = (await events()).length;
      await post(`${path}/routing`, {
        expectedRevision: (await parent()).revision,
        departmentId: c.department,
        divisionId: null,
      }).expect(200);
      assert.equal((await detail()).assignment?.id, creator);
      assert.equal((await events()).length, before + 1);
    },
  );
  await t.test(
    'F037 inactive targets stay visible, cannot be newly selected, and keep snapshots',
    async () => {
      await post(`${path}/assignment`, await body('role', role)).expect(200);
      const history = await events();
      await db
        .updateTable('operational_role')
        .set({ active: false })
        .where('id', '=', role)
        .execute();
      assert.equal((await detail()).assignment?.active, false);
      assert.deepEqual(await events(), history);
      await post(`${path}/assignment`, await body('role', role)).expect(404);
      await post(`${path}/watchers/remove`, await body('role', role)).expect(
        200,
      );
      await post(`${path}/watchers`, await body('role', role)).expect(404);
    },
  );
  await t.test(
    'F037 polymorphic foreign keys, uniqueness, event shape and append-only constraints reject unsafe writes',
    async () => {
      const base = {
        organization_id: org,
        service_request_id: id,
        target_type: 'staff',
        staff_identity_id: role,
        operational_role_id: null,
        work_group_id: null,
        created_by_staff_identity_id: creator,
      };
      await assert.rejects(
        db.insertInto('service_request_watcher').values(base).execute(),
      );
      await assert.rejects(
        db
          .insertInto('service_request_watcher')
          .values({
            ...base,
            target_type: 'role',
            staff_identity_id: null,
            operational_role_id: foreignRole,
          })
          .execute(),
      );
      await assert.rejects(
        db
          .insertInto('service_request_watcher')
          .values({
            ...base,
            staff_identity_id: creator,
            operational_role_id: role,
          })
          .execute(),
      );
      await assert.rejects(
        db
          .insertInto('service_request_watcher')
          .values({ ...base, staff_identity_id: creator })
          .execute(),
      );
      await assert.rejects(
        db
          .insertInto('operational_role_membership')
          .values({
            organization_id: org,
            operational_role_id: role,
            staff_identity_id: c.otherStaff,
            active: true,
          })
          .execute(),
      );
      await assert.rejects(
        db
          .insertInto('operational_role_membership')
          .values({
            organization_id: org,
            operational_role_id: role,
            staff_identity_id: creator,
            active: true,
          })
          .execute(),
      );
      await assert.rejects(
        db
          .insertInto('request_operational_activity')
          .values({
            organization_id: org,
            service_request_id: id,
            activity_type: 'request_assigned',
            actor_type: 'staff',
            staff_identity_id: creator,
            request_revision: 999,
            to_target_name: 'Missing type',
          })
          .execute(),
      );
      await assert.rejects(
        db
          .insertInto('request_operational_activity')
          .values({
            organization_id: org,
            service_request_id: id,
            activity_type: 'request_unassigned',
            actor_type: 'staff',
            staff_identity_id: creator,
            request_revision: 999,
            event_index: 1,
            from_target_type: 'staff',
            from_target_name: 'Fictional',
          })
          .execute(),
      );
      const event = (await events()).at(-1);
      assert.ok(event);
      await assert.rejects(
        db
          .updateTable('request_operational_activity')
          .set({ from_target_name: 'rewrite' })
          .where('id', '=', event.id)
          .execute(),
      );
      await assert.rejects(
        db
          .deleteFrom('request_operational_activity')
          .where('id', '=', event.id)
          .execute(),
      );
      await assert.rejects(db.transaction().execute((trx) => down(trx)));
      const pages = await get(`${path}/activity?pageSize=2`).expect(200);
      assert.equal((pages.body as { items: unknown[] }).items.length, 2);
    },
  );
}
