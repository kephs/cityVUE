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
} from '../../migrations/20260920030000-add-request-internal-notes.js';

interface Note {
  id: string;
  body: string;
  author: { displayName: string };
  createdAt: string;
}
interface Page {
  items: Note[];
  pageSize: number;
  hasMore: boolean;
  nextCursor: string | null;
}
export async function checkRequestNotes(
  t: TestContext,
  c: {
    app: INestApplication;
    db: Kysely<DatabaseSchema>;
    org: string;
    creator: string;
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
  const readKey = 'service_request.note.read',
    createKey = 'service_request.note.create';
  const marker = 'F041_FICTIONAL_BODY_独立';
  const get = (path: string, actor?: string) => {
    const call = request(app.getHttpServer()).get(path);
    return actor ? call.set('Authorization', `Bearer ${actor}`) : call;
  };
  const post = (
    id: string,
    actor?: string,
    body: object = { body: marker },
    key: string = randomUUID(),
  ) => {
    const call = request(app.getHttpServer())
      .post(`${root}/${id}/notes`)
      .set('Idempotency-Key', key)
      .send(body);
    return actor ? call.set('Authorization', `Bearer ${actor}`) : call;
  };
  const snapshot = async () => {
    const tables = [
      'service_request',
      'requester_contact',
      'request_operational_activity',
      'service_request_assignment',
      'service_request_watcher',
      'role_permission',
    ] as const;
    const result: Record<string, string> = {};
    for (const table of tables)
      result[table] = JSON.stringify(
        (await db.selectFrom(table).selectAll().execute())
          .map((row) => JSON.stringify(row))
          .sort(),
      );
    return result;
  };
  await t.test(
    'F041 migration adds no grants/history and preserves all request/contact/ownership state across rollback/reapply',
    async () => {
      const before = await snapshot();
      await db.transaction().execute(up);
      assert.deepEqual(await snapshot(), before);
      assert.equal(
        (
          await db
            .selectFrom('permission')
            .selectAll()
            .where('permission_key', 'in', [readKey, createKey])
            .execute()
        ).length,
        2,
      );
      assert.deepEqual(
        await db.selectFrom('request_internal_note').selectAll().execute(),
        [],
      );
      await db.transaction().execute(down);
      await db.transaction().execute(up);
      assert.deepEqual(await snapshot(), before);
      const indexes = await sql<{
        indexname: string;
      }>`select indexname from pg_indexes where schemaname=current_schema() and tablename='request_internal_note'`.execute(
        db,
      );
      assert.ok(
        indexes.rows.some(
          (row) => row.indexname === 'request_internal_note_page_idx',
        ),
      );
    },
  );
  const tenant = (
    await db
      .selectFrom('staff_identity')
      .select('entra_tenant_id')
      .where('id', '=', c.creator)
      .executeTakeFirstOrThrow()
  ).entra_tenant_id;
  const actor = async (keys: string[], departments = [c.department]) => {
    const id = randomUUID(),
      role = randomUUID();
    await db
      .insertInto('staff_identity')
      .values({
        id,
        organization_id: org,
        entra_tenant_id: tenant,
        entra_object_id: id,
        display_name: 'F041 Fictional Staff',
        email: null,
        active: true,
      })
      .execute();
    await db
      .insertInto('role')
      .values({
        id: role,
        organization_id: org,
        name: `F041 ${id}`,
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
    return { id, role };
  };
  const keys = [
    'service_request.view',
    'service_request.internal.read',
    readKey,
    createKey,
  ];
  const full = await actor(keys);
  const otherAuthor = await actor(keys);
  const noScope = await actor(keys, []);
  const fixtures: { id: string; audience: string; permission: string }[] = [];
  for (const [audience, payload, permission] of [
    ['public', c.publicPayload, 'service_request.view'],
    ['internal', c.internalPayload, 'service_request.internal.read'],
  ] as const) {
    const result = await request(app.getHttpServer())
      .post(root)
      .set('Authorization', `Bearer ${c.creator}`)
      .send(payload)
      .expect(201);
    fixtures.push({
      id: (result.body as { id: string }).id,
      audience,
      permission,
    });
  }
  const notes = () =>
    db.selectFrom('request_internal_note').selectAll().orderBy('id').execute();
  const audits = () =>
    db
      .selectFrom('activity')
      .selectAll()
      .where('activity_type', '=', 'service_request_internal_note_created')
      .orderBy('id')
      .execute();
  for (const { id, audience, permission } of fixtures) {
    await t.test(
      `F041 ${audience} parent/read/create authorization matrix and capability independence`,
      async () => {
        await get(`${root}/${id}/notes`)
          .expect(401)
          .expect('Cache-Control', 'no-store');
        await post(id).expect(401).expect('Cache-Control', 'no-store');
        for (const [parent, read, create] of [
          [false, false, false],
          [false, true, true],
          [true, false, false],
          [true, true, false],
          [true, false, true],
          [true, true, true],
        ]) {
          const a = await actor([
            ...(parent ? [permission] : []),
            ...(read ? [readKey] : []),
            ...(create ? [createKey] : []),
          ]);
          await get(`${root}/${id}/notes`, a.id)
            .expect(parent && read ? 200 : 403)
            .expect('Cache-Control', 'no-store');
          await post(id, a.id)
            .expect(parent && read && create ? 201 : 403)
            .expect('Cache-Control', 'no-store');
          if (parent) {
            const detail = await get(`${root}/${id}`, a.id).expect(200);
            const caps = (
              detail.body as { capabilities: Record<string, boolean> }
            ).capabilities;
            assert.equal(caps.canReadNotes, read);
            assert.equal(caps.canCreateNotes, read && create);
            assert.equal(caps.canReadContact, false);
          }
        }
        await get(`${root}/${id}/notes`, noScope.id).expect(404);
        await post(id, noScope.id).expect(404);
        const opposite = await actor([
          audience === 'public'
            ? 'service_request.internal.read'
            : 'service_request.view',
          readKey,
          createKey,
        ]);
        await get(`${root}/${id}/notes`, opposite.id).expect(404);
        await post(id, opposite.id).expect(404);
      },
    );
  }
  const publicFixture = fixtures[0],
    internalFixture = fixtures[1];
  assert.ok(publicFixture);
  assert.ok(internalFixture);
  const id = publicFixture.id;
  await t.test(
    'F041 current division, Organization activity and Notes-read revocation remain authoritative',
    async () => {
      const internalId = internalFixture.id;
      await db
        .updateTable('service_request')
        .set({
          routed_department_id: c.targetDepartment,
          routed_division_id: c.targetDivision,
        })
        .where('id', '=', internalId)
        .execute();
      const departmentOnly = await actor(keys, [c.targetDepartment]);
      await get(`${root}/${internalId}/notes`, departmentOnly.id).expect(404);
      await post(internalId, departmentOnly.id).expect(404);
      await db
        .insertInto('staff_division_membership')
        .values({
          organization_id: org,
          staff_identity_id: departmentOnly.id,
          department_id: c.targetDepartment,
          division_id: c.targetDivision,
          active: true,
        })
        .execute();
      await get(`${root}/${internalId}/notes`, departmentOnly.id).expect(200);
      await db
        .updateTable('service_request')
        .set({ routed_department_id: null, routed_division_id: null })
        .where('id', '=', internalId)
        .execute();
      await db
        .updateTable('organization')
        .set({ status: 'inactive' })
        .where('id', '=', org)
        .execute();
      try {
        await get(`${root}/${id}/notes`, full.id).expect(404);
        await post(id, full.id).expect(404);
      } finally {
        await db
          .updateTable('organization')
          .set({ status: 'active' })
          .where('id', '=', org)
          .execute();
      }
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', full.role)
        .where('permission_key', '=', readKey)
        .execute();
      await get(`${root}/${id}`, full.id).expect(200);
      await get(`${root}/${id}/notes`, full.id).expect(403);
      await post(id, full.id).expect(403);
      await db
        .insertInto('role_permission')
        .values({
          organization_id: org,
          role_id: full.role,
          permission_key: readKey,
        })
        .execute();
    },
  );
  await t.test(
    'F041 Notes permissions cannot cross Organization/scope or use forged audience/author/input metadata',
    async () => {
      for (const foreign of [c.otherInternal, randomUUID()]) {
        await get(`${root}/${foreign}/notes`, full.id).expect(404);
        await post(foreign, full.id).expect(404);
      }
      await get(`${root}/malformed/notes`, full.id).expect(404);
      for (const field of [
        'audience',
        'organizationId',
        'author',
        'createdAt',
        'permissions',
        'contact',
        'requestId',
        'metadata',
      ]) {
        await post(id, full.id, { body: marker, [field]: 'forged' }).expect(
          400,
        );
        await get(`${root}/${id}/notes?${field}=forged`, full.id).expect(400);
      }
      await post(id, full.id, { body: marker }, 'invalid').expect(400);
      await request(app.getHttpServer())
        .post(`${root}/${id}/notes`)
        .set('Authorization', `Bearer ${full.id}`)
        .send({ body: marker })
        .expect(400);
      for (const size of ['0', '101', '2.5', 'invalid'])
        await get(`${root}/${id}/notes?pageSize=${size}`, full.id).expect(400);
      for (const cursor of [
        'invalid',
        'e30',
        Buffer.from(
          JSON.stringify({ id: randomUUID(), createdAt: 'not-a-date' }),
        ).toString('base64url'),
      ])
        await get(`${root}/${id}/notes?cursor=${cursor}`, full.id).expect(400);
      for (const method of ['put', 'patch', 'delete'] as const) {
        const client = request(app.getHttpServer());
        await client[method](`${root}/${id}/notes/${randomUUID()}`)
          .set('Authorization', `Bearer ${full.id}`)
          .send({ body: marker })
          .expect(404);
      }
    },
  );
  await t.test(
    'F041 assignment/watching/Role/Team relationships and contact/update permissions do not grant Notes',
    async () => {
      // F037/F039 fixtures established all four operational relationships for creator.
      const assigned = await db
        .selectFrom('service_request_assignment')
        .selectAll()
        .where('staff_identity_id', '=', c.creator)
        .execute();
      const watched = await db
        .selectFrom('service_request_watcher')
        .selectAll()
        .where('staff_identity_id', '=', c.creator)
        .execute();
      assert.ok(assigned.length);
      assert.ok(watched.length);
      for (const table of [
        'operational_role_membership',
        'work_group_membership',
      ] as const)
        assert.ok(
          (
            await db
              .selectFrom(table)
              .selectAll()
              .where('staff_identity_id', '=', c.creator)
              .where('active', '=', true)
              .execute()
          ).length,
        );
      for (const requestId of new Set(
        [...assigned, ...watched].map((row) => row.service_request_id),
      )) {
        await get(`${root}/${requestId}/notes`, c.creator).expect(403);
        await post(requestId, c.creator).expect(403);
      }
      const contact = await actor([
        'service_request.view',
        'service_request.contact.read',
        'service_request.assign',
        'service_request.internal.update',
      ]);
      await get(`${root}/${id}/notes`, contact.id).expect(403);
      await post(id, contact.id).expect(403);
      await get(
        `/api/v1/staff/public-service-requests/${id}/contact`,
        contact.id,
      ).expect(200);
      await get(`${root}/${id}/notes`, full.id).expect(200);
      await get(
        `/api/v1/staff/public-service-requests/${id}/contact`,
        full.id,
      ).expect(403);
    },
  );
  let first: Note;
  await t.test(
    'F041 creation returns an explicit authoritative projection, safe author snapshot and metadata-only audit without parent changes',
    async () => {
      const before = await snapshot();
      const result = await post(id, full.id, {
        body: `${marker}\nUnicode ✓ <b>plain</b> @staff https://example.invalid`,
      }).expect(201);
      const correlation = result.headers['x-correlation-id'];
      assert.equal(typeof correlation, 'string');
      first = result.body as Note;
      assert.deepEqual(Object.keys(first).sort(), [
        'author',
        'body',
        'createdAt',
        'id',
      ]);
      assert.deepEqual(first.author, { displayName: 'F041 Fictional Staff' });
      assert.ok(Number.isFinite(Date.parse(first.createdAt)));
      assert.deepEqual(await snapshot(), before);
      const audit = (await audits()).find(
        (row) => (row.metadata as { noteId: string }).noteId === first.id,
      );
      assert.ok(audit);
      assert.equal(audit.organization_id, org);
      assert.equal(audit.service_request_id, id);
      assert.equal(audit.staff_identity_id, full.id);
      assert.equal(audit.actor_reference, null);
      assert.deepEqual(audit.metadata, {
        policy: 'F041',
        action: 'internal_note_created',
        noteId: first.id,
        correlationId: correlation,
      });
      const correlated = c.logs
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((line) => line.requestId === correlation);
      assert.equal(correlated.length, 1);
      const log = correlated[0];
      assert.ok(log);
      assert.equal(log.statusCode, 201);
      assert.equal(log.method, 'POST');
      assert.equal(log.route, `${root}/:serviceRequestId/notes`);
      await db
        .updateTable('staff_identity')
        .set({ display_name: 'changed@example.invalid' })
        .where('id', '=', full.id)
        .execute();
      const later = await post(id, full.id).expect(201);
      assert.deepEqual((later.body as Note).author, {
        displayName: 'Staff member',
      });
      const historical = (await get(`${root}/${id}/notes`, full.id).expect(200))
        .body as Page;
      assert.equal(
        historical.items.find((row) => row.id === first.id)?.author.displayName,
        'F041 Fictional Staff',
      );
    },
  );
  await t.test(
    'F041 bounded plain-text validation rejects invalid bodies without echo and accepts max Unicode/multiline/literal scripts',
    async () => {
      for (const body of [
        '',
        ' \n ',
        '\u00a0',
        marker + '\u0001',
        marker + '\t',
        marker + '\u202e',
        'a'.repeat(4001),
        null,
        {},
      ]) {
        const result = await post(id, full.id, { body })
          .expect(400)
          .expect('Cache-Control', 'no-store');
        assert.ok(!JSON.stringify(result.body).includes(marker));
      }
      for (const body of [
        'x',
        '😀'.repeat(2000),
        `${marker}\r\n<script>alert('note')</script>\n<img src=x onerror=alert(1)>\n[link](javascript:alert(1))`,
      ]) {
        const result = await post(id, full.id, { body }).expect(201);
        assert.equal((result.body as Note).body, body.replaceAll('\r\n', '\n'));
      }
    },
  );
  await t.test(
    'F041 concurrent authors and retry keys append exactly once without parent revision changes or duplicate audits',
    async () => {
      const before = await snapshot(),
        count = (await notes()).length,
        auditCount = (await audits()).length;
      const retryKey = randomUUID();
      const retries = await Promise.all(
        Array.from({ length: 5 }, () =>
          post(id, full.id, { body: marker }, retryKey).expect(201),
        ),
      );
      assert.equal(
        new Set(retries.map((result) => (result.body as Note).id)).size,
        1,
      );
      await post(
        id,
        full.id,
        { body: 'changed fictional retry' },
        retryKey,
      ).expect(409);
      await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          post(id, index % 2 ? full.id : otherAuthor.id, {
            body: `${marker} ${String(index)}`,
          }).expect(201),
        ),
      );
      assert.equal((await notes()).length, count + 9);
      assert.equal((await audits()).length, auditCount + 9);
      assert.deepEqual(await snapshot(), before);
      // Even a successful retry must re-authorize current Notes permissions.
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', full.role)
        .where('permission_key', '=', createKey)
        .execute();
      await post(id, full.id, { body: marker }, retryKey).expect(403);
      await db
        .insertInto('role_permission')
        .values({
          organization_id: org,
          role_id: full.role,
          permission_key: createKey,
        })
        .execute();
    },
  );
  await t.test(
    'F041 keyset pagination is bounded, newest-first and complete without duplicates despite newer concurrent additions',
    async () => {
      // Direct disposable inserts create an exact timestamp tie without mutating historical Notes.
      const tied = [
        '20000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000001',
      ];
      await db
        .insertInto('request_internal_note')
        .values(
          tied.map((noteId) => ({
            id: noteId,
            organization_id: org,
            service_request_id: id,
            author_staff_identity_id: full.id,
            author_display_name: 'Fictional tie author',
            submission_key: randomUUID(),
            body: marker,
            created_at: '2020-01-01T00:00:00.123456Z',
          })),
        )
        .execute();
      const expected = await db
        .selectFrom('request_internal_note')
        .select('id')
        .where('service_request_id', '=', id)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .execute();
      let page = (
        await get(`${root}/${id}/notes?pageSize=3`, full.id).expect(200)
      ).body as Page;
      assert.equal(page.pageSize, 3);
      assert.equal(page.items.length, 3);
      assert.ok(!('total' in page));
      const ids = page.items.map((row) => row.id);
      await post(id, full.id).expect(201);
      while (page.hasMore) {
        assert.ok(page.nextCursor);
        page = (
          await get(
            `${root}/${id}/notes?pageSize=3&cursor=${page.nextCursor}`,
            full.id,
          ).expect(200)
        ).body as Page;
        ids.push(...page.items.map((row) => row.id));
      }
      assert.deepEqual(
        ids,
        expected.map((row) => row.id),
      );
      assert.deepEqual(ids.slice(-2), tied);
      assert.equal(new Set(ids).size, ids.length);
      const last = (
        await get(`${root}/${id}/notes?pageSize=100`, full.id).expect(200)
      ).body as Page;
      assert.equal(last.pageSize, 100);
      assert.equal(last.hasMore, false);
      assert.equal(
        ((await get(`${root}/${id}/notes`, full.id).expect(200)).body as Page)
          .pageSize,
        25,
      );
      await get(
        `${root}/${c.otherInternal}/notes?cursor=${Buffer.from(JSON.stringify({ id: first.id, createdAt: first.createdAt })).toString('base64url')}`,
        full.id,
      ).expect(404);
    },
  );
  await t.test(
    'F041 audit failure rolls back the Note and preserves request/contact/Activity while sanitizing database errors',
    async () => {
      const before = await snapshot(),
        notesBefore = await notes(),
        auditsBefore = await audits();
      await sql`create function fail_note_audit() returns trigger language plpgsql as $$ begin if new.activity_type='service_request_internal_note_created' then raise exception 'F041_FICTIONAL_BODY_独立'; end if; return new; end $$; create trigger fail_note_audit before insert on activity for each row execute function fail_note_audit();`.execute(
        db,
      );
      try {
        const result = await post(id, full.id)
          .expect(500)
          .expect('Cache-Control', 'no-store');
        assert.ok(!JSON.stringify(result.body).includes(marker));
        assert.deepEqual(await notes(), notesBefore);
        assert.deepEqual(await audits(), auditsBefore);
        assert.deepEqual(await snapshot(), before);
      } finally {
        await sql`drop trigger fail_note_audit on activity; drop function fail_note_audit();`.execute(
          db,
        );
      }
    },
  );
  await t.test(
    'F041 database rejects cross-Organization/missing author and empty/overlong bodies; UPDATE DELETE TRUNCATE and destructive rollback fail safely',
    async () => {
      const before = await notes(),
        row = before[0];
      assert.ok(row);
      for (const change of [
        { organization_id: randomUUID() },
        { service_request_id: c.otherInternal },
        { author_staff_identity_id: randomUUID() },
        { body: '' },
        { body: ' \n ' },
        { body: 'a'.repeat(4001) },
      ]) {
        await assert.rejects(
          db
            .insertInto('request_internal_note')
            .values({
              ...row,
              id: randomUUID(),
              submission_key: randomUUID(),
              ...change,
            })
            .execute(),
        );
      }
      await assert.rejects(
        db
          .updateTable('request_internal_note')
          .set({
            body: 'changed',
            author_display_name: 'Changed',
            created_at: new Date(),
          })
          .where('id', '=', row.id)
          .execute(),
      );
      await assert.rejects(
        db
          .deleteFrom('request_internal_note')
          .where('id', '=', row.id)
          .execute(),
      );
      await assert.rejects(sql`truncate request_internal_note`.execute(db));
      await assert.rejects(db.transaction().execute(down));
      assert.deepEqual(await notes(), before);
    },
  );
  await t.test(
    'F041 Notes remain absent from ordinary list/detail/Activity/contact/resident access, audit and captured structured logs',
    async () => {
      for (const { id: requestId, audience } of fixtures) {
        for (const path of [
          root,
          `${root}/${requestId}`,
          `${root}/${requestId}/activity`,
        ]) {
          const result = await get(path, full.id).expect(200);
          assert.ok(!JSON.stringify(result.body).includes(marker));
          assert.ok(!Object.hasOwn(result.body as object, 'noteCount'));
        }
        await get(`/api/v1/service-requests/${requestId}`).expect(401);
        if (audience === 'public') {
          const legacy = await get(
            `/api/v1/service-requests/${requestId}`,
            full.id,
          ).expect(200);
          const output = JSON.stringify(legacy.body);
          for (const forbidden of [
            marker,
            'canReadNotes',
            'canCreateNotes',
            'noteCount',
            'internal_note_created',
          ])
            assert.ok(!output.includes(forbidden));
        }
        await get(
          `/api/v1/staff/${audience}-service-requests/${requestId}/notes`,
          full.id,
        ).expect(404);
      }
      assert.ok(c.logs.length > 0);
      assert.ok(!c.logs.join('').includes(marker));
      for (const row of await audits())
        assert.ok(!JSON.stringify(row).includes(marker));
      assert.ok(
        !(
          await db
            .selectFrom('request_operational_activity')
            .select('activity_type')
            .execute()
        ).some((row) => row.activity_type.includes('note')),
      );
    },
  );
  await t.test(
    'F041 independent Notes append leaves normal workflow revision and Activity behavior intact',
    async () => {
      const operator = await actor([
        'service_request.view',
        'service_request.start_work',
      ]);
      const before = await db
        .selectFrom('service_request')
        .select(['revision', 'status'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      assert.equal(before.revision, 1);
      assert.equal(before.status, 'open');
      const priorActivity = await db
        .selectFrom('request_operational_activity')
        .selectAll()
        .where('service_request_id', '=', id)
        .execute();
      await request(app.getHttpServer())
        .post(`${root}/${id}/workflow`)
        .set('Authorization', `Bearer ${operator.id}`)
        .send({ action: 'start_work', expectedRevision: before.revision })
        .expect(200);
      const after = await db
        .selectFrom('service_request')
        .select(['revision', 'status'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      assert.equal(after.revision, 2);
      assert.equal(after.status, 'in_progress');
      const history = await db
        .selectFrom('request_operational_activity')
        .selectAll()
        .where('service_request_id', '=', id)
        .execute();
      assert.equal(history.length, priorActivity.length + 1);
      assert.equal(
        history.filter((row) => row.activity_type === 'work_started').length,
        1,
      );
    },
  );
}
