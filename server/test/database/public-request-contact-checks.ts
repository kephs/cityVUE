import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import type { DatabaseSchema } from '../../src/database/database.types.js';

export async function checkPublicRequestContact(
  t: TestContext,
  c: {
    app: INestApplication;
    db: Kysely<DatabaseSchema>;
    org: string;
    creator: string;
    otherOrg: string;
    otherInternal: string;
    internalId: string;
    publicPayload: object;
    department: string;
    targetDepartment: string;
    targetDivision: string;
    logs: string[];
  },
) {
  const { app, db, org } = c;
  const root = '/api/v1/staff/public-service-requests';
  const contact = {
    name: 'F039 Contact Test 山 <b>fictional</b>',
    email: 'f039-contact@example.com',
  };
  const get = (path: string, actor?: string) => {
    const call = request(app.getHttpServer()).get(path);
    return actor ? call.set('Authorization', `Bearer ${actor}`) : call;
  };
  const create = async (overrides: object) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/staff/service-requests')
      .set('Authorization', `Bearer ${c.creator}`)
      .send({ ...c.publicPayload, ...overrides })
      .expect(201);
    return (response.body as { id: string }).id;
  };
  const tenant = (
    await db
      .selectFrom('staff_identity')
      .select('entra_tenant_id')
      .where('id', '=', c.creator)
      .executeTakeFirstOrThrow()
  ).entra_tenant_id;
  const actor = async (keys: string[]) => {
    const id = randomUUID(),
      role = randomUUID();
    await db
      .insertInto('staff_identity')
      .values({
        id,
        organization_id: org,
        entra_tenant_id: tenant,
        entra_object_id: id,
        display_name: 'F039 fictional PUBLIC reader',
        email: null,
        active: true,
      })
      .execute();
    await db
      .insertInto('role')
      .values({
        id: role,
        organization_id: org,
        name: `F039 ${id}`,
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
    return { id, role };
  };
  const neither = await actor([]),
    contactOnly = await actor(['service_request.contact.read']),
    viewOnly = await actor(['service_request.view']),
    both = await actor([
      'service_request.view',
      'service_request.contact.read',
    ]);
  const id = await create({ contact }),
    path = `${root}/${id}/contact`,
    detailPath = `/api/v1/service-requests/${id}`;
  const audits = () =>
    db
      .selectFrom('activity')
      .selectAll()
      .where('service_request_id', '=', id)
      .where('activity_type', '=', 'service_request_contact_viewed')
      .orderBy('occurred_at')
      .execute();
  const operational = () =>
    db
      .selectFrom('request_operational_activity')
      .selectAll()
      .where('service_request_id', '=', id)
      .orderBy('id')
      .execute();
  const originalActivity = await operational();
  const assertPrivate = (value: unknown) => {
    const text = JSON.stringify(value);
    for (const field of Object.values(contact))
      assert.ok(!text.includes(field), 'Structured contact must be omitted');
  };
  await t.test(
    'F039 PUBLIC contact requires both independent keys and rejects unauthenticated callers with no-store',
    async () => {
      await get(path).expect(401).expect('Cache-Control', 'no-store');
      for (const reader of [neither, contactOnly, viewOnly]) {
        const result = await get(path, reader.id)
          .expect(403)
          .expect('Cache-Control', 'no-store');
        assertPrivate(result.body);
      }
      await get(detailPath, contactOnly.id).expect(403);
      assertPrivate((await get(detailPath, viewOnly.id).expect(200)).body);
      assertPrivate(
        (await get('/api/v1/service-requests', viewOnly.id).expect(200)).body,
      );
      assert.deepEqual(await audits(), []);
      assert.deepEqual(await operational(), originalActivity);
    },
  );
  await t.test(
    'F039 PUBLIC populated projection correlates real HTTP, sanitized log and safe audit without operational changes',
    async () => {
      const result = await get(path, both.id)
        .expect(200)
        .expect('Cache-Control', 'no-store');
      assert.deepEqual(result.body, contact);
      const events = await audits();
      assert.equal(events.length, 1);
      const event = events[0];
      assert.ok(event);
      assert.equal(event.organization_id, org);
      assert.equal(event.staff_identity_id, both.id);
      assert.equal(event.service_request_id, id);
      assert.equal(event.actor_type, 'staff');
      assert.equal(event.actor_reference, null);
      assert.ok(event.occurred_at);
      const correlation = result.headers['x-correlation-id'];
      assert.ok(typeof correlation === 'string');
      assert.match(correlation, /^[0-9a-f-]{36}$/i);
      assert.deepEqual(event.metadata, {
        policy: 'F039',
        action: 'contact_viewed',
        correlationId: correlation,
      });
      const logs = c.logs
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((line) => line.requestId === correlation);
      assert.equal(logs.length, 1);
      const log = logs[0];
      assert.ok(log);
      assert.equal(log.statusCode, 200);
      assert.equal(log.method, 'GET');
      assert.equal(log.route, `${root}/:serviceRequestId/contact`);
      assertPrivate(logs);
      assertPrivate(events);
      assert.deepEqual(await operational(), originalActivity);
      const row = await db
        .selectFrom('service_request')
        .select([
          'audience',
          'intake_channel',
          'submitted_by_staff_identity_id',
          'requester_staff_identity_id',
        ])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      assert.equal(row.audience, 'public');
      assert.equal(row.intake_channel, 'phone');
      assert.equal(row.submitted_by_staff_identity_id, c.creator);
      assert.equal(row.requester_staff_identity_id, null);
    },
  );
  await t.test(
    'F039 PUBLIC ordinary reads and both timelines omit contact and do not create view audits',
    async () => {
      const before = await audits();
      for (const url of ['/api/v1/service-requests', detailPath]) {
        const result = await get(url, both.id).expect(200);
        assertPrivate(result.body);
        assert.ok(
          !JSON.stringify(result.body).includes(
            'service_request_contact_viewed',
          ),
        );
      }
      assertPrivate(await operational());
      assert.deepEqual(await operational(), originalActivity);
      assert.deepEqual(await audits(), before);
    },
  );
  await t.test(
    'F039 PUBLIC contact refuses same-reference cross-Organization, INTERNAL, unknown IDs and forged scope queries',
    async () => {
      const other = await db
        .selectFrom('service_request')
        .selectAll()
        .where('id', '=', c.otherInternal)
        .executeTakeFirstOrThrow();
      const otherId = randomUUID();
      const parent = await db
        .selectFrom('service_request')
        .select('reference_number')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      await db
        .insertInto('service_request')
        .values({
          ...other,
          id: otherId,
          reference_number: parent.reference_number,
          audience: 'public',
          requester_staff_identity_id: null,
        })
        .execute();
      for (const invalid of [
        otherId,
        c.internalId,
        randomUUID(),
        'invalid',
        '10000000-0000-1000-8000-000000000001',
      ])
        assertPrivate(
          (
            await get(`${root}/${invalid}/contact`, both.id)
              .expect(404)
              .expect('Cache-Control', 'no-store')
          ).body,
        );
      for (const query of [
        'audience=internal',
        'canReadContact=true',
        `organizationId=${c.otherOrg}`,
      ])
        await get(`${path}?${query}`, both.id)
          .expect(400)
          .expect('Cache-Control', 'no-store');
      await get(
        `/api/v1/staff/internal-service-requests/${id}/contact`,
        c.creator,
      ).expect(404);
    },
  );
  await t.test(
    'F039 PUBLIC policy preserves category Department/Division read scope and fails closed for inactive Organization',
    async () => {
      await db
        .updateTable('staff_department_membership')
        .set({ active: false })
        .where('staff_identity_id', '=', both.id)
        .execute();
      await get(detailPath, both.id).expect(404);
      await get(path, both.id).expect(404);
      await db
        .updateTable('staff_department_membership')
        .set({ active: true })
        .where('staff_identity_id', '=', both.id)
        .execute();
      const parent = await db
        .selectFrom('service_request')
        .select('category_id')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      const category = await db
        .selectFrom('category')
        .selectAll()
        .where('id', '=', parent.category_id)
        .executeTakeFirstOrThrow();
      await db
        .updateTable('category')
        .set({
          department_id: c.targetDepartment,
          division_id: c.targetDivision,
        })
        .where('id', '=', category.id)
        .execute();
      await get(path, both.id).expect(404);
      await db
        .insertInto('staff_department_membership')
        .values({
          organization_id: org,
          staff_identity_id: both.id,
          department_id: c.targetDepartment,
          active: true,
        })
        .execute();
      await get(detailPath, both.id).expect(404);
      await get(path, both.id).expect(404);
      await db
        .insertInto('staff_division_membership')
        .values({
          organization_id: org,
          staff_identity_id: both.id,
          department_id: c.targetDepartment,
          division_id: c.targetDivision,
          active: true,
        })
        .execute();
      await get(detailPath, both.id).expect(200);
      assert.deepEqual((await get(path, both.id).expect(200)).body, contact);
      await db
        .updateTable('category')
        .set({
          department_id: category.department_id,
          division_id: category.division_id,
        })
        .where('id', '=', category.id)
        .execute();
      await db
        .updateTable('organization')
        .set({ status: 'inactive' })
        .where('id', '=', org)
        .execute();
      await get(path, both.id).expect(404);
      await db
        .updateTable('organization')
        .set({ status: 'active' })
        .where('id', '=', org)
        .execute();
    },
  );
  await t.test(
    'F039 PUBLIC anonymous and partial contact use normal staff-assisted intake without contact rewrites',
    async () => {
      const emptyId = await create({
        reportingIdentity: 'anonymous',
        contact: undefined,
      });
      const partialId = await create({ contact: { name: contact.name } });
      const before = await db
        .selectFrom('activity')
        .selectAll()
        .where('service_request_id', '=', emptyId)
        .execute();
      await get(`${root}/${emptyId}/contact`, both.id).expect(404);
      assert.deepEqual(
        await db
          .selectFrom('activity')
          .selectAll()
          .where('service_request_id', '=', emptyId)
          .execute(),
        before,
      );
      assert.deepEqual(
        (await get(`${root}/${partialId}/contact`, both.id).expect(200)).body,
        { name: contact.name, email: null },
      );
    },
  );
  await t.test(
    'F039 PUBLIC contact revocation preserves ordinary reads; parent-read revocation prevents contact-only access',
    async () => {
      const change = async (key: string, grant: boolean) => {
        if (grant)
          await db
            .insertInto('role_permission')
            .values({
              organization_id: org,
              role_id: both.role,
              permission_key: key,
            })
            .execute();
        else
          await db
            .deleteFrom('role_permission')
            .where('role_id', '=', both.role)
            .where('permission_key', '=', key)
            .execute();
      };
      const before = await audits();
      await change('service_request.contact.read', false);
      await get(detailPath, both.id).expect(200);
      await get(path, both.id).expect(403);
      assert.deepEqual(await audits(), before);
      await change('service_request.contact.read', true);
      assert.deepEqual((await get(path, both.id).expect(200)).body, contact);
      await change('service_request.view', false);
      await get('/api/v1/service-requests', both.id).expect(403);
      await get(detailPath, both.id).expect(403);
      await get(path, both.id).expect(403);
      await change('service_request.view', true);
    },
  );
  await t.test(
    'F039 PUBLIC audit failure prevents disclosure and preserves contact/request/history; logs exclude populated data',
    async () => {
      const snapshot = async () => ({
        request: await db
          .selectFrom('service_request')
          .selectAll()
          .where('id', '=', id)
          .execute(),
        contact: await db
          .selectFrom('requester_contact')
          .selectAll()
          .where('service_request_id', '=', id)
          .execute(),
        audit: await audits(),
        operational: await operational(),
      });
      const before = await snapshot();
      await sql`create function fail_public_contact_audit() returns trigger language plpgsql as $$ begin
      if new.activity_type='service_request_contact_viewed' then raise exception 'F039 Contact Test f039-contact@example.com'; end if; return new; end $$;
      create trigger fail_public_contact_audit before insert on activity for each row execute function fail_public_contact_audit();`.execute(
        db,
      );
      try {
        const result = await get(path, both.id)
          .expect(500)
          .expect('Cache-Control', 'no-store');
        assertPrivate(result.body);
        assert.deepEqual(await snapshot(), before);
      } finally {
        await sql`drop trigger fail_public_contact_audit on activity; drop function fail_public_contact_audit();`.execute(
          db,
        );
      }
      assertPrivate(c.logs);
      assert.ok(!c.logs.join('').includes('F039 Contact Test'));
      assert.deepEqual(await operational(), originalActivity);
    },
  );
}
