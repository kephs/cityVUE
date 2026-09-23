import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { configureIssueDefault } from '../../src/service-request/issue-default-assignment.js';
import type { TargetType } from '../../src/service-request/ownership-targets.js';
import { down } from '../../migrations/20260924000000-add-issue-default-assignment.js';
function required<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined);
  return value;
}
export async function checkIssueDefaults(
  t: TestContext,
  c: {
    app: INestApplication;
    db: Kysely<DatabaseSchema>;
    org: string;
    creator: string;
    department: string;
    publicPayload: object;
    internalPayload: object;
    logs: string[];
  },
) {
  const { app, db, org } = c,
    api = app.getHttpServer() as Server,
    root = '/api/v1/staff/service-requests';
  const issueId = (
    c.publicPayload as {
      serviceDefinitionId: string;
    }
  ).serviceDefinitionId;
  const tenant = (
    await db
      .selectFrom('staff_identity')
      .select('entra_tenant_id')
      .where('id', '=', c.creator)
      .executeTakeFirstOrThrow()
  ).entra_tenant_id;
  const staff = async (keys: string[]) => {
    const id = randomUUID(),
      role = randomUUID();
    await db
      .insertInto('staff_identity')
      .values({
        id,
        organization_id: org,
        entra_tenant_id: tenant,
        entra_object_id: id,
        display_name: 'F048 Fictional Staff',
        email: null,
        active: true,
      })
      .execute();
    await db
      .insertInto('role')
      .values({
        id: role,
        organization_id: org,
        name: `F048 ${role}`,
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
        staff_identity_id: id,
        role_id: role,
        active: true,
      })
      .execute();
    await db
      .insertInto('staff_department_membership')
      .values({
        organization_id: org,
        staff_identity_id: id,
        department_id: c.department,
        active: true,
      })
      .execute();
    return id;
  };
  const operator = await staff([
    'service_request.create',
    'service_request.create_internal',
    'service_request.view',
    'service_request.internal.read',
    'service_request.assign',
    'service_request.internal.update',
  ]);
  const denied = await staff([]),
    publicReader = await staff(['service_request.view']);
  const groupA = randomUUID(),
    groupB = randomUUID(),
    role = randomUUID();
  for (const [id, name] of [
    [groupA, 'F048 Fictional Team A'],
    [groupB, 'F048 Fictional Team B'],
  ] as const)
    await db
      .insertInto('work_group')
      .values({
        id,
        organization_id: org,
        department_id: c.department,
        division_id: null,
        name,
        description: 'F048 disposable',
        active: true,
      })
      .execute();
  await db
    .insertInto('operational_role')
    .values({
      id: role,
      organization_id: org,
      department_id: c.department,
      division_id: null,
      name: 'F048 Fictional Role',
      active: true,
    })
    .execute();
  await db
    .insertInto('work_group_membership')
    .values({
      organization_id: org,
      work_group_id: groupA,
      staff_identity_id: denied,
      active: true,
    })
    .execute();
  await db
    .insertInto('operational_role_membership')
    .values({
      organization_id: org,
      operational_role_id: role,
      staff_identity_id: denied,
      active: true,
    })
    .execute();
  let revision =
    (
      await db
        .selectFrom('issue_default_assignment')
        .select('revision')
        .where('service_definition_id', '=', issueId)
        .executeTakeFirst()
    )?.revision ?? 0;
  const configure = async (type: TargetType | null, id?: string) => {
    const result = await db.transaction().execute((trx) =>
      configureIssueDefault(trx, org, issueId, operator, {
        expectedRevision: revision,
        target: type ? { type, id: required(id) } : null,
      }),
    );
    revision = result.revision;
    return result;
  };
  const create = async (payload = c.publicPayload) => {
    const result = await request(api)
      .post(root)
      .set('Authorization', `Bearer ${operator}`)
      .send(payload)
      .expect(201);
    return result.body as {
      id: string;
      referenceNumber: string;
      status: string;
    };
  };
  const get = (path: string, actor = operator) =>
    request(api).get(path).set('Authorization', `Bearer ${actor}`);
  const owner = async (id: string) =>
    db
      .selectFrom('service_request_assignment')
      .selectAll()
      .where('service_request_id', '=', id)
      .where('ended_at', 'is', null)
      .execute();
  const events = async (id: string) =>
    db
      .selectFrom('request_operational_activity')
      .selectAll()
      .where('service_request_id', '=', id)
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();
  await t.test(
    'F048 None preserves receipt, revision, reference, creation history and no owner',
    async () => {
      const r = await create();
      assert.equal((await owner(r.id)).length, 0);
      assert.deepEqual(
        (await events(r.id)).map((e) => e.activity_type),
        ['request_created'],
      );
      assert.equal(
        (
          await db
            .selectFrom('service_request')
            .select('revision')
            .where('id', '=', r.id)
            .executeTakeFirstOrThrow()
        ).revision,
        1,
      );
      assert.deepEqual(Object.keys(r).sort(), [
        'createdAt',
        'id',
        'referenceNumber',
        'status',
      ]);
    },
  );
  await t.test(
    'F048 configuration validates type, Organization, eligibility, revision and zero-write dry run',
    async () => {
      for (const target of [
        { type: 'staff' as const, id: groupA },
        { type: 'group' as const, id: randomUUID() },
        { type: 'staff' as const, id: denied },
      ])
        await assert.rejects(
          db.transaction().execute((trx) =>
            configureIssueDefault(trx, org, issueId, operator, {
              expectedRevision: revision,
              target,
            }),
          ),
        );
      const foreign = (
        await db
          .selectFrom('staff_identity')
          .select('id')
          .where('organization_id', '!=', org)
          .executeTakeFirstOrThrow()
      ).id;
      await assert.rejects(
        db.transaction().execute((trx) =>
          configureIssueDefault(trx, org, issueId, operator, {
            expectedRevision: revision,
            target: { type: 'staff', id: foreign },
          }),
        ),
      );
      const dry = await db.transaction().execute(async (trx) => {
        await sql`set transaction read only`.execute(trx);
        return configureIssueDefault(
          trx,
          org,
          issueId,
          operator,
          { expectedRevision: revision, target: { type: 'group', id: groupA } },
          true,
        );
      });
      assert.equal(dry.changed, true);
      assert.equal(
        (
          await db
            .selectFrom('issue_default_assignment')
            .select('target_type')
            .where('service_definition_id', '=', issueId)
            .executeTakeFirst()
        )?.target_type ?? null,
        null,
      );
      await configure('group', groupA);
      assert.equal((await configure('group', groupA)).changed, false);
      await assert.rejects(
        db.transaction().execute((trx) =>
          configureIssueDefault(trx, org, issueId, operator, {
            expectedRevision: 0,
            target: null,
          }),
        ),
      );
      const template = await db
        .selectFrom('issue_default_assignment')
        .selectAll()
        .where('service_definition_id', '=', issueId)
        .executeTakeFirstOrThrow();
      await assert.rejects(
        db
          .updateTable('issue_default_assignment')
          .set({ target_type: 'staff' })
          .where('service_definition_id', '=', issueId)
          .execute(),
      );
      await assert.rejects(
        db
          .updateTable('issue_default_assignment')
          .set({
            target_type: 'staff',
            staff_identity_id: foreign,
            work_group_id: null,
          })
          .where('service_definition_id', '=', issueId)
          .execute(),
      );
      assert.deepEqual(
        await db
          .selectFrom('issue_default_assignment')
          .selectAll()
          .where('service_definition_id', '=', issueId)
          .executeTakeFirstOrThrow(),
        template,
      );
    },
  );
  await t.test(
    'F048 configuration audit failure is atomic and referenced targets cannot be deleted',
    async () => {
      await assert.rejects(
        db.deleteFrom('work_group').where('id', '=', groupA).execute(),
      );
      const before = await db
        .selectFrom('issue_default_assignment')
        .selectAll()
        .where('service_definition_id', '=', issueId)
        .executeTakeFirstOrThrow();
      await sql`create function f048_config_fail() returns trigger language plpgsql as $$ begin raise exception 'F048 audit failure'; end $$;
      create trigger f048_config_fail before insert on issue_default_assignment_audit for each row execute function f048_config_fail()`.execute(
        db,
      );
      try {
        await assert.rejects(configure('group', groupB));
      } finally {
        await sql`drop trigger f048_config_fail on issue_default_assignment_audit; drop function f048_config_fail()`.execute(
          db,
        );
      }
      assert.deepEqual(
        await db
          .selectFrom('issue_default_assignment')
          .selectAll()
          .where('service_definition_id', '=', issueId)
          .executeTakeFirstOrThrow(),
        before,
      );
      await assert.rejects(
        db
          .updateTable('issue_default_assignment_audit')
          .set({ action: 'clear' })
          .execute(),
      );
    },
  );
  await t.test(
    'F048 STAFF, ROLE and TEAM create exactly one owner with System history and no watchers',
    async () => {
      for (const [type, id] of [
        ['staff', operator],
        ['role', role],
        ['group', groupA],
      ] as const) {
        await configure(type, id);
        for (const payload of [c.publicPayload, c.internalPayload]) {
          const r = await create(payload),
            rows = await owner(r.id),
            history = await events(r.id);
          assert.equal(rows.length, 1);
          assert.equal(required(rows[0]).assigned_by_actor_type, 'system');
          assert.equal(required(rows[0]).assigned_by_staff_identity_id, null);
          assert.deepEqual(
            history.map((e) => e.activity_type),
            ['request_created', 'request_auto_assigned'],
          );
          assert.equal(required(history[1]).actor_type, 'system');
          assert.equal(required(history[1]).to_target_type, type);
          assert.equal(required(history[1]).request_revision, 2);
          assert.ok(
            required(history[1]).occurred_at > required(history[0]).occurred_at,
          );
          assert.equal(
            (
              await db
                .selectFrom('service_request_watcher')
                .selectAll()
                .where('service_request_id', '=', r.id)
                .execute()
            ).length,
            0,
          );
          await get(`${root}/${r.id}`, denied).expect(403);
          for (const view of ['mine', 'team', 'watching'])
            await get(`${root}?view=${view}`, denied).expect(403);
          const timeline = await get(`${root}/${r.id}/activity`).expect(200);
          assert.equal(
            required(
              (
                timeline.body as {
                  items: {
                    type: string;
                    actorDisplay: string;
                  }[];
                }
              ).items[0],
            ).actorDisplay,
            'System',
          );
          await get(
            `/api/v1/staff/${payload === c.internalPayload ? 'internal' : 'public'}-service-requests/${r.id}/contact`,
            operator,
          ).expect(403);
          for (const path of ['notes', 'communications'])
            await get(`${root}/${r.id}/${path}`, operator).expect(403);
          await get(
            `/api/v1/staff/attachments/requests/${r.id}/evidence`,
            denied,
          ).expect(403);
        }
      }
    },
  );
  await t.test(
    'F048 retained STAFF ownership cannot bypass revoked request or protected-content permission',
    async () => {
      const ownerId = await staff(['service_request.view']);
      await configure('staff', ownerId);
      const r = await create();
      assert.equal(required((await owner(r.id))[0]).staff_identity_id, ownerId);
      const roleId = (
        await db
          .selectFrom('staff_role_assignment')
          .select('role_id')
          .where('staff_identity_id', '=', ownerId)
          .executeTakeFirstOrThrow()
      ).role_id;
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', roleId)
        .execute();
      for (const suffix of ['', '/notes', '/communications'])
        await get(`${root}/${r.id}${suffix}`, ownerId).expect(403);
      await get(
        `/api/v1/staff/public-service-requests/${r.id}/contact`,
        ownerId,
      ).expect(403);
      await get(
        `/api/v1/staff/attachments/requests/${r.id}/evidence`,
        ownerId,
      ).expect(403);
      assert.equal(required((await owner(r.id))[0]).staff_identity_id, ownerId);
    },
  );
  await t.test(
    'F048 PUBLIC web and assisted channels share defaults; requester assignment forgery is rejected',
    async () => {
      await configure('group', groupA);
      const {
        audience: _audience,
        intakeChannel: _channel,
        ...payload
      } = c.publicPayload as Record<string, unknown>;
      void _audience;
      void _channel;
      const web = await request(api)
        .post('/api/v1/service-requests')
        .send(payload)
        .expect(201);
      assert.equal(
        required(
          (
            await owner(
              (
                web.body as {
                  id: string;
                }
              ).id,
            )
          )[0],
        ).work_group_id,
        groupA,
      );
      for (const intakeChannel of ['web', 'phone', 'walk_in', 'staff', 'api'])
        assert.equal(
          required(
            (
              await owner(
                (await create({ ...c.publicPayload, intakeChannel })).id,
              )
            )[0],
          ).work_group_id,
          groupA,
        );
      for (const forged of [
        { targetType: 'group' },
        { targetId: groupB },
        { assignment: { type: 'group', id: groupB } },
        { assignmentSource: 'issue_default' },
        { organizationId: org },
      ])
        await request(api)
          .post('/api/v1/service-requests')
          .send({ ...payload, ...forged })
          .expect(400);
    },
  );
  await t.test(
    'F048 unavailable targets degrade safely; STAFF needs actual audience read; clear affects future requests only',
    async () => {
      for (const [type, id, table] of [
        ['staff', publicReader, 'staff_identity'],
        ['role', role, 'operational_role'],
        ['group', groupA, 'work_group'],
      ] as const) {
        await configure(type, id);
        if (type === 'staff') {
          const r = await create(c.internalPayload);
          assert.equal((await owner(r.id)).length, 0);
        }
        await db
          .updateTable(table)
          .set({ active: false })
          .where('id', '=', id)
          .execute();
        const r = await create();
        assert.equal((await owner(r.id)).length, 0);
        assert.equal((await events(r.id)).length, 1);
        const audit = await db
          .selectFrom('activity')
          .select('metadata')
          .where('service_request_id', '=', r.id)
          .executeTakeFirstOrThrow();
        assert.equal(
          (
            audit.metadata as {
              defaultAssignment: {
                outcome: string;
              };
            }
          ).defaultAssignment.outcome,
          'target_unavailable',
        );
        const list = await get(
          `${root}?assignment=unassigned&q=${r.referenceNumber}`,
        ).expect(200);
        assert.equal(
          (
            list.body as {
              total: number;
            }
          ).total,
          1,
        );
        await assert.rejects(configure(type, id));
        await db
          .updateTable(table)
          .set({ active: true })
          .where('id', '=', id)
          .execute();
      }
      await configure('group', groupA);
      const a = await create();
      await configure('group', groupB);
      assert.equal(required((await owner(a.id))[0]).work_group_id, groupA);
      assert.equal(
        required((await owner((await create()).id))[0]).work_group_id,
        groupB,
      );
      await configure(null);
      assert.equal((await owner((await create()).id)).length, 0);
      assert.equal(required((await owner(a.id))[0]).work_group_id, groupA);
    },
  );
  await t.test(
    'F048 different Service Locations do not select different owners',
    async () => {
      await configure('group', groupA);
      const locationVersion = randomUUID();
      const originalVersion = (
        c.publicPayload as {
          serviceDefinitionVersionId: string;
        }
      ).serviceDefinitionVersionId;
      await sql`insert into service_definition_version(id,organization_id,service_definition_id,version_number,name,resident_description,icon_key,aliases,keywords,default_priority,location_policy,geographic_eligibility_mode,anonymous_reporting_policy,status,published_at)
        select ${locationVersion},organization_id,service_definition_id,999,name,resident_description,icon_key,aliases,keywords,default_priority,'optional',geographic_eligibility_mode,anonymous_reporting_policy,'published',clock_timestamp() from service_definition_version where id=${originalVersion}`.execute(
        db,
      );
      for (const enteredAddress of [
        'F048 fictional location A',
        'F048 fictional location B',
      ]) {
        const r = await create({
          ...c.publicPayload,
          serviceDefinitionVersionId: locationVersion,
          location: { enteredAddress },
        });
        assert.equal(required((await owner(r.id))[0]).work_group_id, groupA);
      }
    },
  );
  await t.test(
    'F048 manual reassignment/unassignment, list filters, search and reads never reapply defaults',
    async () => {
      await configure('group', groupA);
      const r = await create();
      const list = await get(
        `${root}?assignment=assigned&sort=assignment&q=${r.referenceNumber}`,
      ).expect(200);
      assert.equal(
        (
          list.body as {
            total: number;
          }
        ).total,
        1,
      );
      assert.equal(
        (
          (
            await get(
              `${root}?assignment=unassigned&q=${r.referenceNumber}`,
            ).expect(200)
          ).body as {
            total: number;
          }
        ).total,
        0,
      );
      await request(api)
        .post(`${root}/${r.id}/assignment`)
        .set('Authorization', `Bearer ${operator}`)
        .send({ expectedRevision: 2, targetType: 'staff', targetId: operator })
        .expect(200);
      await get(`${root}/${r.id}`).expect(200);
      assert.equal(
        required((await owner(r.id))[0]).staff_identity_id,
        operator,
      );
      await request(api)
        .post(`${root}/${r.id}/assignment/remove`)
        .set('Authorization', `Bearer ${operator}`)
        .send({ expectedRevision: 3 })
        .expect(200);
      await get(`${root}/${r.id}`).expect(200);
      assert.equal((await owner(r.id)).length, 0);
      assert.equal(
        (
          (
            await get(
              `${root}?assignment=unassigned&q=${r.referenceNumber}`,
            ).expect(200)
          ).body as {
            total: number;
          }
        ).total,
        1,
      );
      assert.deepEqual(
        (await events(r.id)).map((e) => e.activity_type),
        [
          'request_created',
          'request_auto_assigned',
          'request_reassigned',
          'request_unassigned',
        ],
      );
    },
  );
  await t.test(
    'F048 valid assignment, Activity and audit failures roll back request/reference writes',
    async () => {
      await configure('group', groupA);
      for (const table of [
        'service_request_assignment',
        'request_operational_activity',
        'activity',
      ]) {
        const before = await db
          .selectFrom('service_request')
          .select('id')
          .orderBy('id')
          .execute();
        const sequence = await db
          .selectFrom('service_request_reference_sequence')
          .selectAll()
          .orderBy('period_key')
          .execute();
        await sql`create function f048_fail() returns trigger language plpgsql as $$ begin raise exception 'F048 injected failure'; end $$`.execute(
          db,
        );
        await sql`create trigger f048_fail before insert on ${sql.table(table)} for each row execute function f048_fail()`.execute(
          db,
        );
        try {
          await request(api)
            .post(root)
            .set('Authorization', `Bearer ${operator}`)
            .send(c.publicPayload)
            .expect(500);
        } finally {
          await sql`drop trigger f048_fail on ${sql.table(table)}; drop function f048_fail()`.execute(
            db,
          );
        }
        assert.deepEqual(
          await db
            .selectFrom('service_request')
            .select('id')
            .orderBy('id')
            .execute(),
          before,
        );
        assert.deepEqual(
          await db
            .selectFrom('service_request_reference_sequence')
            .selectAll()
            .orderBy('period_key')
            .execute(),
          sequence,
        );
      }
    },
  );
  await t.test(
    'F048 concurrent configuration uses revision CAS; concurrent creates have one coherent owner each',
    async () => {
      await configure(null);
      const expectedRevision = revision;
      const results = await Promise.allSettled(
        [groupA, groupB].map((id) =>
          db.transaction().execute((trx) =>
            configureIssueDefault(trx, org, issueId, operator, {
              expectedRevision,
              target: { type: 'group', id },
            }),
          ),
        ),
      );
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
      revision = (
        await db
          .selectFrom('issue_default_assignment')
          .select('revision')
          .where('service_definition_id', '=', issueId)
          .executeTakeFirstOrThrow()
      ).revision;
      await configure('group', groupA);
      const creations = await Promise.all([create(), create(), create()]);
      for (const r of creations) {
        assert.equal((await owner(r.id)).length, 1);
        assert.equal(required((await owner(r.id))[0]).work_group_id, groupA);
        assert.equal((await events(r.id)).length, 2);
      }
      const [created] = await Promise.all([
        create(),
        configure('group', groupB),
      ]);
      assert.ok(
        ([groupA, groupB] as string[]).includes(
          required(required((await owner(created.id))[0]).work_group_id),
        ),
      );
      await assert.rejects(db.transaction().execute(down));
      await configure(null);
      assert.equal(c.logs.join('').includes('F048 Fictional'), false);
    },
  );
}
