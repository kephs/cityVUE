import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { down } from '../../migrations/20260919050000-add-request-operational-activity.js';

export async function checkOperationalActivity(
  t: TestContext,
  c: {
    app: INestApplication;
    db: Kysely<DatabaseSchema>;
    org: string;
    creator: string;
    publicOnly: string;
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
  const created = await post(
    '/api/v1/staff/service-requests',
    c.internalPayload,
  ).expect(201);
  const id = (created.body as { id: string }).id;
  const events = () =>
    db
      .selectFrom('request_operational_activity')
      .selectAll()
      .where('service_request_id', '=', id)
      .orderBy('request_revision')
      .execute();
  const detail = () =>
    db
      .selectFrom('service_request')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  await t.test(
    'F035 new creation is one technical-ID event with no contact/description/reference duplication',
    async () => {
      const rows = await events();
      assert.equal(rows.length, 1);
      const firstEvent = rows[0];
      assert.ok(firstEvent);
      assert.equal(firstEvent.activity_type, 'request_created');
      assert.equal(firstEvent.organization_id, org);
      assert.equal(firstEvent.actor_type, 'staff');
      assert.equal(firstEvent.staff_identity_id, creator);
      assert.equal(firstEvent.narrative, null);
      assert.equal(firstEvent.is_baseline, false);
      const all = await db
        .selectFrom('request_operational_activity')
        .where('activity_type', '=', 'request_created')
        .where('is_baseline', '=', false)
        .selectAll()
        .execute();
      assert.ok(
        all.some(
          (r) =>
            r.actor_type === 'resident' ||
            r.actor_type === 'anonymous_resident',
        ),
      );
      assert.ok(
        all.some(
          (r) => r.actor_type === 'staff' && r.intake_channel === 'phone',
        ),
      );
      assert.ok(
        all.some(
          (r) => r.actor_type === 'staff' && r.intake_channel === 'staff',
        ),
      );
      assert.ok(all.every((r) => r.narrative === null));
    },
  );
  await t.test(
    'F035 history reads enforce identity/current scope/audience and bounded query contracts',
    async () => {
      const path = `${root}/${id}/activity`;
      await request(app.getHttpServer()).get(path).expect(401);
      await get(path, c.publicOnly).expect(403);
      await get(`${root}/${c.otherInternal}/activity`).expect(404);
      await get(`${root}/${c.publicId}/activity`).expect(404);
      for (const q of [
        'page=0',
        'page=-1',
        'pageSize=101',
        'pageSize=0',
        'page=1.5',
        `organizationId=${c.otherOrg}`,
        'actor=forged',
      ])
        await get(`${path}?${q}`).expect(400);
      const result = await get(path)
        .expect(200)
        .expect('Cache-Control', 'no-store');
      const item = (result.body as { items: Record<string, unknown>[] })
        .items[0];
      assert.ok(item);
      assert.deepEqual(
        Object.keys(item).sort(),
        [
          'id',
          'type',
          'occurredAt',
          'actorDisplay',
          'fromStatus',
          'toStatus',
          'fromDepartment',
          'fromDivision',
          'toDepartment',
          'toDivision',
          'narrative',
          'intakeChannel',
        ].sort(),
      );
      assert.equal(item.actorDisplay, 'Staff member');
      await db
        .updateTable('staff_department_membership')
        .set({ active: false })
        .where('staff_identity_id', '=', creator)
        .where('department_id', '=', c.department)
        .execute();
      await get(path).expect(404);
      await db
        .updateTable('staff_department_membership')
        .set({ active: true })
        .where('staff_identity_id', '=', creator)
        .where('department_id', '=', c.department)
        .execute();
      const client = request(app.getHttpServer());
      for (const verb of ['post', 'put', 'patch', 'delete'] as const)
        await client[verb](path)
          .set('Authorization', `Bearer ${creator}`)
          .send({ type: 'request_closed', narrative: 'forged' })
          .expect(404);
    },
  );
  await t.test(
    'F035 every lifecycle transition persists exactly one snapshot/narrative and stale retry persists none',
    async () => {
      const steps = [
        ['start_work', 'open', 'in_progress', 'work_started', null],
        [
          'hold',
          'in_progress',
          'on_hold',
          'placed_on_hold',
          "<script>alert('x')</script>\n**Fictional** café reason",
        ],
        ['resume', 'on_hold', 'in_progress', 'work_resumed', null],
        [
          'close',
          'in_progress',
          'closed',
          'request_closed',
          'Fictional resolution',
        ],
        ['reopen', 'closed', 'open', 'request_reopened', 'Fictional follow-up'],
        ['close', 'open', 'closed', 'request_closed', 'Resolved from open'],
        ['reopen', 'closed', 'open', 'request_reopened', 'Review'],
        ['start_work', 'open', 'in_progress', 'work_started', null],
        ['hold', 'in_progress', 'on_hold', 'placed_on_hold', 'Wait'],
        ['close', 'on_hold', 'closed', 'request_closed', 'Resolved from hold'],
        ['reopen', 'closed', 'open', 'request_reopened', 'Review again'],
      ] as const;
      let revision = 1;
      for (const [action, from, to, type, narrative] of steps) {
        const body = {
          expectedRevision: revision,
          action,
          ...(narrative
            ? {
                [action === 'close' ? 'resolutionSummary' : 'reason']:
                  `  ${narrative}  `,
              }
            : {}),
        };
        await post(`${root}/${id}/workflow`, body).expect(200);
        const rows = await events();
        const last = rows.at(-1);
        assert.ok(last);
        assert.equal(rows.length, revision + 1);
        assert.equal(last.activity_type, type);
        assert.equal(last.from_status, from);
        assert.equal(last.to_status, to);
        assert.equal(last.narrative, narrative);
        await post(`${root}/${id}/workflow`, body).expect(409);
        assert.equal((await events()).length, rows.length);
        revision++;
      }
      const audit = await db
        .selectFrom('activity')
        .select('metadata')
        .where('service_request_id', '=', id)
        .execute();
      assert.ok(!JSON.stringify(audit).includes('Fictional resolution'));
      assert.ok(!JSON.stringify(audit).includes('<script>'));
    },
  );
  await t.test(
    'F035 invalid/unauthorized commands never change state or history',
    async () => {
      const before = await detail(),
        history = await events();
      for (const body of [
        { action: 'hold', reason: 'Not valid while open' },
        { action: 'unknown' },
        { action: 'close' },
        { action: 'close', resolutionSummary: '  ' },
        { action: 'close', resolutionSummary: 'x'.repeat(2001) },
        { action: 'close', resolutionSummary: 'unsafe\ttext' },
        { action: 'close', resolutionSummary: 'valid', actorId: creator },
      ]) {
        const result = await post(`${root}/${id}/workflow`, {
          expectedRevision: before.revision,
          ...body,
        });
        assert.ok([400, 409].includes(result.status));
      }
      await post(
        `${root}/${id}/workflow`,
        { expectedRevision: before.revision, action: 'start_work' },
        c.publicOnly,
      ).expect(403);
      await post(`${root}/${c.otherInternal}/workflow`, {
        expectedRevision: 1,
        action: 'start_work',
      }).expect(404);
      assert.deepEqual(await detail(), before);
      assert.deepEqual(await events(), history);
    },
  );
  await t.test(
    'F035 routing records immutable names and rejects no-op/invalid targets',
    async () => {
      await db
        .insertInto('staff_department_membership')
        .values({
          organization_id: org,
          staff_identity_id: creator,
          department_id: c.targetDepartment,
          active: true,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('staff_division_membership')
        .values({
          organization_id: org,
          staff_identity_id: creator,
          department_id: c.targetDepartment,
          division_id: c.targetDivision,
          active: true,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      const before = await detail();
      const count = (await events()).length;
      await post(`${root}/${id}/routing`, {
        expectedRevision: before.revision,
        departmentId: c.department,
      }).expect(409);
      await post(`${root}/${id}/routing`, {
        expectedRevision: before.revision,
        departmentId: randomUUID(),
      }).expect(404);
      assert.equal((await events()).length, count);
      const body = {
        expectedRevision: before.revision,
        departmentId: c.targetDepartment,
        divisionId: c.targetDivision,
      };
      await post(`${root}/${id}/routing`, body).expect(200);
      await post(`${root}/${id}/routing`, body).expect(409);
      const event = (await events()).at(-1);
      assert.ok(event);
      assert.equal(event.activity_type, 'request_routed');
      assert.equal(event.from_department_id, c.department);
      assert.equal(event.to_department_id, c.targetDepartment);
      assert.equal(event.to_division_id, c.targetDivision);
      assert.ok(event.to_department_name);
      await db
        .updateTable('department')
        .set({ name: 'Fictional renamed department' })
        .where('id', '=', c.targetDepartment)
        .execute();
      assert.deepEqual((await events()).at(-1), event);
    },
  );
  await t.test(
    'F035 workflow/routing/creation insert failures roll back state, revision, counters and audit',
    async () => {
      const before = await detail(),
        history = await events();
      const count = async (
        table: 'service_request' | 'activity' | 'request_operational_activity',
      ) => (await db.selectFrom(table).selectAll().execute()).length;
      const counts = [
        await count('service_request'),
        await count('activity'),
        await count('request_operational_activity'),
      ];
      const counters = await db
        .selectFrom('service_request_reference_sequence')
        .selectAll()
        .orderBy('organization_id')
        .orderBy('period_key')
        .execute();
      await sql`create function reject_f035_test() returns trigger language plpgsql as $$ begin raise exception 'F035 injected failure'; end $$; create trigger reject_f035_test before insert on request_operational_activity for each row execute function reject_f035_test()`.execute(
        db,
      );
      try {
        await post(`${root}/${id}/workflow`, {
          expectedRevision: before.revision,
          action: 'start_work',
        }).expect(500);
        await post(`${root}/${id}/routing`, {
          expectedRevision: before.revision,
          departmentId: c.department,
        }).expect(500);
        await post('/api/v1/staff/service-requests', c.internalPayload).expect(
          500,
        );
      } finally {
        await sql`drop trigger reject_f035_test on request_operational_activity; drop function reject_f035_test()`.execute(
          db,
        );
      }
      assert.deepEqual(await detail(), before);
      assert.deepEqual(await events(), history);
      assert.deepEqual(
        [
          await count('service_request'),
          await count('activity'),
          await count('request_operational_activity'),
        ],
        counts,
      );
      assert.deepEqual(
        await db
          .selectFrom('service_request_reference_sequence')
          .selectAll()
          .orderBy('organization_id')
          .orderBy('period_key')
          .execute(),
        counters,
      );
    },
  );
  await t.test(
    'F035 concurrent duplicate commands append one event and tied timestamps use the ID tie-breaker',
    async () => {
      const before = await detail(),
        count = (await events()).length;
      const results = await Promise.all([
        post(`${root}/${id}/workflow`, {
          expectedRevision: before.revision,
          action: 'start_work',
        }),
        post(`${root}/${id}/workflow`, {
          expectedRevision: before.revision,
          action: 'start_work',
        }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      assert.equal((await events()).length, count + 1);
      const tied = [
        'f0000000-0000-4000-8000-000000000001',
        'f0000000-0000-4000-8000-000000000002',
      ];
      for (const [index, eventId] of tied.entries())
        await db
          .insertInto('request_operational_activity')
          .values({
            id: eventId,
            organization_id: org,
            service_request_id: id,
            activity_type: 'work_started',
            actor_type: 'system',
            request_revision: 10000 + index,
            from_status: 'open',
            to_status: 'in_progress',
            occurred_at: '2099-01-01T00:00:00Z',
          })
          .execute();
      const result = await get(`${root}/${id}/activity?pageSize=2`).expect(200);
      assert.deepEqual(
        (result.body as { items: { id: string }[] }).items.map((r) => r.id),
        [...tied].reverse(),
      );
      const plan = await sql<{
        'QUERY PLAN': unknown;
      }>`explain (format json) select id from request_operational_activity where organization_id=${org}::uuid and service_request_id=${id}::uuid order by occurred_at desc,id desc limit 25`.execute(
        db,
      );
      assert.ok(plan.rows.length);
      const indexes = await sql<{
        indexname: string;
      }>`select indexname from pg_indexes where schemaname=current_schema() and tablename='request_operational_activity'`.execute(
        db,
      );
      assert.ok(
        indexes.rows.some(
          (i) => i.indexname === 'request_operational_timeline_idx',
        ),
      );
    },
  );
  await t.test(
    'F035 append-only database constraints and meaningful-history rollback fail closed',
    async () => {
      const event = (await events())[0];
      assert.ok(event);
      await assert.rejects(
        db
          .updateTable('request_operational_activity')
          .set({ narrative: 'rewrite' })
          .where('id', '=', event.id)
          .execute(),
      );
      await assert.rejects(
        db
          .deleteFrom('request_operational_activity')
          .where('id', '=', event.id)
          .execute(),
      );
      await assert.rejects(
        sql`truncate request_operational_activity`.execute(db),
      );
      await assert.rejects(
        db
          .insertInto('request_operational_activity')
          .values({
            organization_id: c.otherOrg,
            service_request_id: id,
            activity_type: 'request_created',
            actor_type: 'system',
            request_revision: 99,
          })
          .execute(),
      );
      await assert.rejects(db.transaction().execute((trx) => down(trx)));
      assert.ok((await events()).length > 1);
    },
  );
  await t.test(
    'F035 newest-first history pagination is deterministic and revocation clears access',
    async () => {
      const path = `${root}/${id}/activity?pageSize=2`;
      const first = await get(path).expect(200),
        second = await get(`${path}&page=2`).expect(200);
      assert.deepEqual((await get(path).expect(200)).body, first.body);
      const a = first.body as { items: { id: string }[]; hasNextPage: boolean };
      const b = second.body as { items: { id: string }[] };
      assert.equal(a.items.length, 2);
      assert.equal(a.hasNextPage, true);
      assert.ok(b.items.every((x) => !a.items.some((y) => y.id === x.id)));
      const rows = await events();
      const ordered = [...rows].sort(
        (a, b) =>
          new Date(b.occurred_at).getTime() -
            new Date(a.occurred_at).getTime() || b.id.localeCompare(a.id),
      );
      assert.deepEqual(
        a.items.map((x) => x.id),
        ordered.slice(0, 2).map((x) => x.id),
      );
      await db
        .updateTable('staff_department_membership')
        .set({ active: false })
        .where('staff_identity_id', '=', creator)
        .where('department_id', '=', c.targetDepartment)
        .execute();
      await get(path).expect(404);
    },
  );
}
