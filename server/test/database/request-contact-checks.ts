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
} from '../../migrations/20260920010000-add-request-contact-access.js';

export async function checkRequestContact(
  t: TestContext,
  c: {
    app: INestApplication;
    db: Kysely<DatabaseSchema>;
    org: string;
    creator: string;
    publicOnly: string;
    noGrant: string;
    otherOrg: string;
    otherInternal: string;
    publicId: string;
    internalPayload: object;
    department: string;
    targetDepartment: string;
    targetDivision: string;
    logs: string[];
  },
) {
  const { app, db, org, creator } = c;
  const root = '/api/v1/staff/internal-service-requests';
  const get = (path: string, actor = creator) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${actor}`);
  const snapshot = async () =>
    Promise.all([
      db.selectFrom('service_request').selectAll().orderBy('id').execute(),
      db.selectFrom('requester_contact').selectAll().orderBy('id').execute(),
      db
        .selectFrom('role_permission')
        .selectAll()
        .orderBy('role_id')
        .orderBy('permission_key')
        .execute(),
      db
        .selectFrom('request_operational_activity')
        .selectAll()
        .orderBy('id')
        .execute(),
      db
        .selectFrom('service_request_assignment')
        .selectAll()
        .orderBy('service_request_id')
        .execute(),
      db
        .selectFrom('service_request_watcher')
        .selectAll()
        .orderBy('id')
        .execute(),
    ]);
  await t.test(
    'F039 migration registers permission with zero grants, preserves data, rolls back and reapplies',
    async () => {
      const before = await snapshot();
      await db.transaction().execute(up);
      assert.ok(
        await db
          .selectFrom('permission')
          .selectAll()
          .where('permission_key', '=', 'service_request.contact.read')
          .executeTakeFirst(),
      );
      assert.deepEqual(await snapshot(), before);
      await db.transaction().execute(down);
      await db.transaction().execute(up);
      assert.deepEqual(await snapshot(), before);
    },
  );
  await db
    .updateTable('staff_department_membership')
    .set({ active: true })
    .where('staff_identity_id', '=', creator)
    .execute();
  // Dedicated role lets each key be revoked independently of previous feature fixtures.
  const contactRole = randomUUID();
  await db
    .insertInto('role')
    .values({
      id: contactRole,
      organization_id: org,
      name: 'F039 fictional privacy role',
      active: true,
    })
    .execute();
  for (const actor of [creator, c.noGrant])
    await db
      .insertInto('staff_role_assignment')
      .values({
        organization_id: org,
        role_id: contactRole,
        staff_identity_id: actor,
        active: true,
      })
      .execute();
  const changeContact = async (grant: boolean) => {
    if (grant)
      await db
        .insertInto('role_permission')
        .values({
          organization_id: org,
          role_id: contactRole,
          permission_key: 'service_request.contact.read',
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    else
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', contactRole)
        .where('permission_key', '=', 'service_request.contact.read')
        .execute();
  };
  const created = await request(app.getHttpServer())
    .post('/api/v1/staff/service-requests')
    .set('Authorization', `Bearer ${creator}`)
    .send(c.internalPayload)
    .expect(201);
  const id = (created.body as { id: string }).id,
    detailPath = `${root}/${id}`,
    path = `${detailPath}/contact`;
  const audits = () =>
    db
      .selectFrom('activity')
      .selectAll()
      .where('service_request_id', '=', id)
      .where('activity_type', '=', 'service_request_contact_viewed')
      .orderBy('occurred_at')
      .execute();
  await t.test(
    'F039 read/update, assignment, watching and operational membership do not grant contact',
    async () => {
      await request(app.getHttpServer()).get(path).expect(401);
      await get(path, c.noGrant).expect(403);
      const detail = await get(detailPath).expect(200);
      assert.equal(
        (detail.body as { canReadContact: boolean }).canReadContact,
        false,
      );
      await get(path).expect(403);
      // Explicit operational relationships do not change RBAC. No implicit contact grant.
      await request(app.getHttpServer())
        .post(`${detailPath}/assignment`)
        .set('Authorization', `Bearer ${creator}`)
        .send({ expectedRevision: 1, targetType: 'staff', targetId: creator })
        .expect(200);
      await db
        .insertInto('service_request_watcher')
        .values({
          organization_id: org,
          service_request_id: id,
          target_type: 'staff',
          staff_identity_id: creator,
          created_by_staff_identity_id: creator,
        })
        .execute();
      assert.ok(
        await db
          .selectFrom('operational_role_membership')
          .selectAll()
          .where('staff_identity_id', '=', creator)
          .executeTakeFirst(),
      );
      assert.ok(
        await db
          .selectFrom('work_group_membership')
          .selectAll()
          .where('staff_identity_id', '=', creator)
          .executeTakeFirst(),
      );
      await get(path).expect(403);
      assert.deepEqual(await audits(), []);
    },
  );
  await changeContact(true);
  await t.test(
    'F039 contact permission alone cannot replace request access; query forgery and inaccessible IDs fail closed',
    async () => {
      await get(path, c.noGrant).expect(403);
      for (const denied of [
        c.otherInternal,
        c.publicId,
        randomUUID(),
        'invalid',
        'SR-202609-000001',
      ])
        await get(`${root}/${denied}/contact`).expect(404);
      for (const query of [
        'canReadContact=true',
        `organizationId=${c.otherOrg}`,
        'audience=public',
      ])
        await get(`${path}?${query}`).expect(400);
      assert.deepEqual(await audits(), []);
    },
  );
  await t.test(
    'F039 authorized no-contact response is distinct from denial and safely audited once',
    async () => {
      const result = await get(path)
        .expect(200)
        .expect('Cache-Control', 'no-store');
      assert.deepEqual(result.body, { name: null, email: null });
      const rows = await audits();
      assert.equal(rows.length, 1);
      const event = rows[0];
      assert.ok(event);
      assert.equal(event.staff_identity_id, creator);
      assert.equal(event.organization_id, org);
      assert.equal(event.actor_type, 'staff');
      assert.equal(event.actor_reference, null);
      assert.ok(event.occurred_at);
      assert.deepEqual(Object.keys(event.metadata as object).sort(), [
        'action',
        'correlationId',
        'policy',
      ]);
      assert.equal(
        (event.metadata as Record<string, unknown>).correlationId,
        result.headers['x-correlation-id'],
      );
      assert.equal(
        (event.metadata as Record<string, unknown>).action,
        'contact_viewed',
      );
    },
  );
  // Imported structured-contact fixture only in this disposable schema. F029 intake stays unchanged.
  const contact = {
    name: 'Alex Example 山 <script>fictional</script>',
    email: 'alex@example.com',
  };
  await db
    .insertInto('requester_contact')
    .values({
      id: randomUUID(),
      organization_id: org,
      service_request_id: id,
      ...contact,
    })
    .execute();
  await t.test(
    'F039 populated projection is explicit; ordinary list/detail/activity omit structured contact and create no view audit',
    async () => {
      const detail = await get(detailPath).expect(200);
      assert.equal(
        (detail.body as { canReadContact: boolean }).canReadContact,
        true,
      );
      const before = (await audits()).length;
      for (const url of [root, detailPath, `${detailPath}/activity`]) {
        const result = await get(url).expect(200);
        for (const value of Object.values(contact))
          assert.ok(!JSON.stringify(result.body).includes(value));
        assert.ok(!JSON.stringify(result.body).includes('contact_viewed'));
      }
      assert.equal((await audits()).length, before);
      const result = await get(path).expect(200);
      assert.deepEqual(result.body, contact);
      assert.equal((await audits()).length, before + 1);
      for (const value of Object.values(contact))
        assert.ok(!JSON.stringify(await audits()).includes(value));
    },
  );
  await t.test(
    'F039 partial contact preserves authoritative Unicode name without inventing absent fields',
    async () => {
      await db
        .updateTable('requester_contact')
        .set({ email: null })
        .where('service_request_id', '=', id)
        .execute();
      assert.deepEqual((await get(path).expect(200)).body, {
        name: contact.name,
        email: null,
      });
      await db
        .updateTable('requester_contact')
        .set({ email: contact.email })
        .where('service_request_id', '=', id)
        .execute();
    },
  );
  await t.test(
    'F039 current department/division scope remains authoritative even with contact and watcher relationship',
    async () => {
      const membership = await db
        .selectFrom('staff_department_membership')
        .selectAll()
        .where('staff_identity_id', '=', creator)
        .execute();
      await db
        .updateTable('staff_department_membership')
        .set({ active: false })
        .where('staff_identity_id', '=', creator)
        .execute();
      await get(path).expect(404);
      await get(detailPath).expect(404);
      for (const row of membership)
        await db
          .updateTable('staff_department_membership')
          .set({ active: row.active })
          .where('staff_identity_id', '=', creator)
          .where('department_id', '=', row.department_id)
          .execute();
      const parent = await db
        .selectFrom('service_request')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      const divisionMembership = await db
        .selectFrom('staff_division_membership')
        .selectAll()
        .where('staff_identity_id', '=', creator)
        .execute();
      await db
        .updateTable('staff_division_membership')
        .set({ active: false })
        .where('staff_identity_id', '=', creator)
        .execute();
      await db
        .updateTable('service_request')
        .set({
          routed_department_id: c.targetDepartment,
          routed_division_id: c.targetDivision,
        })
        .where('id', '=', id)
        .execute();
      await get(path).expect(404);
      await db
        .updateTable('service_request')
        .set({
          routed_department_id: parent.routed_department_id,
          routed_division_id: parent.routed_division_id,
        })
        .where('id', '=', id)
        .execute();
      for (const row of divisionMembership)
        await db
          .updateTable('staff_division_membership')
          .set({ active: row.active })
          .where('staff_identity_id', '=', creator)
          .where('division_id', '=', row.division_id)
          .execute();
    },
  );
  await t.test(
    'F039 immediate contact revocation preserves ordinary read and operational grants',
    async () => {
      await changeContact(false);
      await get(path).expect(403);
      assert.equal(
        (
          (await get(detailPath).expect(200)).body as {
            canReadContact: boolean;
          }
        ).canReadContact,
        false,
      );
      await changeContact(true);
      assert.deepEqual((await get(path).expect(200)).body, contact);
    },
  );
  await t.test(
    'F039 audit insert failure prevents all contact disclosure and preserves request/contact/operational data',
    async () => {
      const before = await snapshot(),
        auditBefore = await audits();
      await sql`create function fail_contact_audit() returns trigger language plpgsql as $$ begin
      if new.activity_type='service_request_contact_viewed' then raise exception 'Alex Example alex@example.com +1 555 0100'; end if;
      return new; end $$;
      create trigger fail_contact_audit before insert on activity for each row execute function fail_contact_audit();`.execute(
        db,
      );
      try {
        const failed = await get(path).expect(500);
        for (const value of [
          'Alex Example',
          'alex@example.com',
          '+1 555 0100',
          'fictional</script>',
        ])
          assert.ok(!JSON.stringify(failed.body).includes(value));
        assert.deepEqual(await snapshot(), before);
        assert.deepEqual(await audits(), auditBefore);
      } finally {
        await sql`drop trigger fail_contact_audit on activity; drop function fail_contact_audit();`.execute(
          db,
        );
      }
    },
  );
  await t.test(
    'F039 success/denial/malformed/failure logs omit contacts and rollback preserves meaningful audit',
    async () => {
      assert.ok(c.logs.length > 0);
      for (const value of [
        'Alex Example',
        'alex@example.com',
        '+1 555 0100',
        'fictional</script>',
      ])
        assert.ok(!c.logs.join('').includes(value));
      await assert.rejects(db.transaction().execute(down));
      await changeContact(false); // Audit alone also prevents rollback.
      await assert.rejects(db.transaction().execute(down));
      assert.ok((await audits()).length > 0);
      await changeContact(true);
    },
  );
}
