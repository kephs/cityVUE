import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import type { DatabaseSchema } from '../../src/database/database.types.js';

interface Summary {
  id: string;
  reference: string;
  issue: { name: string; icon: string | null };
  status: string;
  submittedAt: string;
  lastUpdateAt: string | null;
  serviceLocation: string | null;
}
interface Detail extends Summary {
  description: string;
  updates: {
    id: string;
    body: string;
    createdAt: string;
    direction: string;
    channel: string;
    deliveryState: string;
    sender: { displayName: string };
  }[];
}

const MINE = '/api/v1/my/internal-service-requests';

export async function checkInternalRequester(
  t: TestContext,
  c: {
    app: INestApplication;
    db: Kysely<DatabaseSchema>;
    org: string;
    creator: string;
    department: string;
    targetDepartment: string;
    otherInternal: string;
    otherOrg: string;
    otherStaff: string;
    publicPayload: object;
    internalPayload: object;
    logs: string[];
  },
) {
  const { app, db, org } = c;
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
        display_name: 'F064 Fictional Staff',
        email: null,
        active: true,
      })
      .execute();
    await db
      .insertInto('role')
      .values({
        id: role,
        organization_id: org,
        name: `F064 ${id}`,
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
  const mine = (who: string, path = '') =>
    request(app.getHttpServer())
      .get(`${MINE}${path}`)
      .set('Authorization', `Bearer ${who}`);
  const listBody = (response: { body: unknown }) =>
    response.body as { items: Summary[]; page: number; hasMore: boolean };
  const detailBody = (response: { body: unknown }) => response.body as Detail;

  // The requester submits their own INTERNAL request, which the database
  // CHECK constraint forces to be self-attributed.
  // Exactly the grants intake requires -- notably never
  // service_request.internal.read, so this requester has never held a staff
  // internal read permission at any point.
  const owner = await actor([
    'service_request.create',
    'service_request.create_internal',
    'service_request.view',
  ]);
  const created = await request(app.getHttpServer())
    .post('/api/v1/staff/service-requests')
    .set('Authorization', `Bearer ${owner.id}`)
    .send(c.internalPayload)
    .expect(201);
  const owned = (created.body as { id: string }).id;
  const publicCreated = await request(app.getHttpServer())
    .post('/api/v1/staff/service-requests')
    .set('Authorization', `Bearer ${owner.id}`)
    .send(c.publicPayload)
    .expect(201);
  const assisted = (publicCreated.body as { id: string }).id;
  // Strip every grant: the requester endpoints must work on ownership alone.
  await db
    .updateTable('staff_role_assignment')
    .set({ active: false })
    .where('organization_id', '=', org)
    .where('staff_identity_id', '=', owner.id)
    .execute();

  await t.test(
    'F064.1 an employee with zero staff permissions reads their own INTERNAL request and nobody else can',
    async () => {
      const list = listBody(await mine(owner.id).expect(200));
      assert.deepEqual(
        list.items.map((item) => item.id),
        [owned],
        'own internal request is listed; the public assisted intake is not',
      );
      assert.equal(list.hasMore, false);
      assert.equal(
        detailBody(await mine(owner.id, `/${owned}`).expect(200)).reference,
        list.items[0]?.reference,
      );
      // 21: submitting a PUBLIC request as staff confers no requester ownership.
      await mine(owner.id, `/${assisted}`).expect(404);
      assert.equal(
        (
          await db
            .selectFrom('service_request')
            .select('requester_staff_identity_id')
            .where('id', '=', assisted)
            .executeTakeFirstOrThrow()
        ).requester_staff_identity_id,
        null,
      );
      // 2, 3, 4: a colleague in the same department holding broad internal
      // staff permissions still cannot reach it through this endpoint.
      const colleague = await actor([
        'service_request.view',
        'service_request.internal.read',
        'service_request.internal.update',
        'service_request.communication.read',
        'service_request.communication.create',
        'service_request.assign',
        'service_request.route',
      ]);
      assert.deepEqual(
        listBody(await mine(colleague.id).expect(200)).items,
        [],
      );
      await mine(colleague.id, `/${owned}`).expect(404);
      // 23: that colleague's existing staff access is unchanged.
      await request(app.getHttpServer())
        .get(`/api/v1/staff/internal-service-requests/${owned}`)
        .set('Authorization', `Bearer ${colleague.id}`)
        .expect(200);
      // An employee with no department membership is equally refused.
      const outsider = await actor([], []);
      assert.deepEqual(listBody(await mine(outsider.id).expect(200)).items, []);
      await mine(outsider.id, `/${owned}`).expect(404);
    },
  );

  await t.test(
    'F064.1 another Organization, an unprovisioned identity, anonymity and tracking credentials are all refused',
    async () => {
      // 5: same Entra tenant, different Reqro Organization.
      assert.equal(
        (
          await db
            .selectFrom('staff_identity')
            .select('organization_id')
            .where('id', '=', c.otherStaff)
            .executeTakeFirstOrThrow()
        ).organization_id,
        c.otherOrg,
      );
      // That employee legitimately owns internal requests in their own
      // Organization, so the meaningful property is not an empty list: it is
      // that every row they receive is theirs, in their Organization, and that
      // this Organization's request is absent and unreadable.
      const foreignList = listBody(await mine(c.otherStaff).expect(200)).items;
      assert.ok(
        !foreignList.some((item) => item.id === owned),
        'another Organization never sees this request',
      );
      for (const item of foreignList) {
        const row = await db
          .selectFrom('service_request')
          .select([
            'organization_id',
            'requester_staff_identity_id',
            'audience',
          ])
          .where('id', '=', item.id)
          .executeTakeFirstOrThrow();
        assert.equal(row.organization_id, c.otherOrg);
        assert.equal(row.requester_staff_identity_id, c.otherStaff);
        assert.equal(row.audience, 'internal');
      }
      // Refused before ownership is even considered: that Organization has no
      // administrative access state, so its callers are rejected outright. The
      // status depends only on the caller's own Organization, never on whether
      // the target request exists, so it enumerates nothing.
      const foreignDetail = await mine(c.otherStaff, `/${owned}`);
      assert.ok(
        [403, 404].includes(foreignDetail.status),
        `another Organization must be refused, got ${String(foreignDetail.status)}`,
      );
      assert.ok(!JSON.stringify(foreignDetail.body).includes(owned));
      // 8: authenticated but never provisioned in any Organization.
      await mine(randomUUID()).expect(403);
      await mine(randomUUID(), `/${owned}`).expect(403);
      // 9: no development fallback exists on these routes.
      await request(app.getHttpServer()).get(MINE).expect(401);
      await request(app.getHttpServer()).get(`${MINE}/${owned}`).expect(401);
      await request(app.getHttpServer())
        .get(MINE)
        .set('Authorization', 'Basic fictional')
        .expect(401);
      // A malformed bearer value cannot authenticate.
      await request(app.getHttpServer())
        .get(MINE)
        .set('Authorization', 'Bearer not-a-uuid')
        .expect(401);
      // 10: a guest tracking credential is neither accepted here nor issuable
      // for an INTERNAL request at all.
      await request(app.getHttpServer())
        .get(`${MINE}/${owned}`)
        .set('X-Requester-Tracking', 'A'.repeat(43))
        .expect(401);
      // Even a staff member who legitimately manages guest tracking links
      // cannot mint one for an INTERNAL request: that boundary stays PUBLIC
      // only, so no bearer credential can ever reach this request.
      const tracker = await actor([
        'service_request.view',
        'service_request.tracking.manage',
      ]);
      await request(app.getHttpServer())
        .post(
          `/api/v1/staff/service-requests/${owned}/requester-tracking/issue`,
        )
        .set('Authorization', `Bearer ${tracker.id}`)
        .send({ expectedVersion: null })
        .expect(404);
      assert.equal(
        (
          await db
            .selectFrom('request_tracking_credential')
            .select('id')
            .where('service_request_id', '=', owned)
            .execute()
        ).length,
        0,
      );
      // 22: unowned, absent and malformed ids are indistinguishable.
      const absent = await mine(owner.id, `/${randomUUID()}`).expect(404);
      const malformed = await mine(owner.id, '/not-a-uuid').expect(404);
      const foreign = await mine(owner.id, `/${c.otherInternal}`).expect(404);
      // Identical apart from the per-request correlation id, which carries no
      // information about the target: an absent id, a malformed id and a real
      // request belonging to another Organization are indistinguishable.
      const shape = (response: { body: unknown }) => {
        const body = { ...(response.body as Record<string, unknown>) };
        delete body.requestId;
        return body;
      };
      assert.deepEqual(shape(absent), { error: 'NotFound', statusCode: 404 });
      assert.deepEqual(shape(malformed), shape(absent));
      assert.deepEqual(shape(foreign), shape(absent));
    },
  );

  await t.test(
    'F064.1 requester-visible updates are bounded, ordered and free of notes, staff identity and other requests',
    async () => {
      const correspond = async (
        requestId: string,
        organizationId: string,
        author: string,
        body: string,
        minute: number,
      ) =>
        sql`insert into request_communication(id,organization_id,service_request_id,author_staff_identity_id,author_display_name,submission_key,body,created_at)
          values(${randomUUID()},${organizationId},${requestId},${author},'Fictional employee',${randomUUID()},${body},${`2026-09-24T00:${String(minute).padStart(2, '0')}:00Z`}::timestamptz)
          returning id`.execute(db);
      const authored: string[] = [];
      for (let minute = 0; minute < 26; minute++) {
        const inserted = await correspond(
          owned,
          org,
          owner.id,
          `Fictional internal update ${String(minute)}`,
          minute,
        );
        authored.push((inserted.rows[0] as { id: string }).id);
      }
      // 13: a different request in the same tenant.
      await correspond(assisted, org, owner.id, 'OTHER_REQUEST_BODY', 40);
      // 14: a different Organization entirely.
      await correspond(
        c.otherInternal,
        c.otherOrg,
        c.otherStaff,
        'OTHER_TENANT_BODY',
        41,
      );
      // 11: an internal note on the very same request.
      await sql`insert into request_internal_note(id,organization_id,service_request_id,author_staff_identity_id,author_display_name,submission_key,body)
        values(${randomUUID()},${org},${owned},${owner.id},'Fictional employee',${randomUUID()},'INTERNAL_NOTE_BODY')`.execute(
        db,
      );
      const detail = detailBody(await mine(owner.id, `/${owned}`).expect(200));
      // 16, 17: the fixed ceiling and deterministic newest-first ordering.
      assert.equal(detail.updates.length, 25);
      assert.deepEqual(
        detail.updates.map((update) => update.id),
        authored.slice(1).reverse(),
      );
      // 18: exact response key sets, list and detail.
      assert.deepEqual(Object.keys(detail).sort(), [
        'description',
        'id',
        'issue',
        'lastUpdateAt',
        'reference',
        'serviceLocation',
        'status',
        'submittedAt',
        'updates',
      ]);
      for (const update of detail.updates) {
        assert.deepEqual(Object.keys(update).sort(), [
          'body',
          'channel',
          'createdAt',
          'deliveryState',
          'direction',
          'id',
          'sender',
        ]);
        assert.deepEqual(Object.keys(update.sender), ['displayName']);
        assert.equal(update.sender.displayName, 'Service team');
      }
      const summary = listBody(await mine(owner.id).expect(200)).items[0];
      assert.ok(summary);
      assert.deepEqual(Object.keys(summary).sort(), [
        'id',
        'issue',
        'lastUpdateAt',
        'reference',
        'serviceLocation',
        'status',
        'submittedAt',
      ]);
      assert.equal(summary.lastUpdateAt, '2026-09-24T00:25:00.000Z');
      // 12: no staff-only or internal field survives the projection.
      const serialized = JSON.stringify(detail) + JSON.stringify(summary);
      for (const forbidden of [
        'OTHER_REQUEST_BODY',
        'OTHER_TENANT_BODY',
        'INTERNAL_NOTE_BODY',
        'Fictional employee',
        'author_display_name',
        'author_staff_identity_id',
        'submission_key',
        'organization_id',
        'routed_department_id',
        'priority',
        'revision',
        'permissions',
        'departmentIds',
        owner.id,
        org,
        c.otherOrg,
        c.otherStaff,
        c.department,
      ])
        assert.ok(
          !serialized.includes(forbidden),
          `${forbidden} must never reach a requester`,
        );
      assert.ok(!c.logs.join('').includes('INTERNAL_NOTE_BODY'));
    },
  );

  await t.test(
    'F064.1 ownership survives routing, reads mutate nothing, and deactivation revokes access',
    async () => {
      const snapshot = async () => {
        const result: Record<string, string> = {};
        for (const table of [
          'service_request',
          'request_communication',
          'request_internal_note',
        ] as const)
          result[table] = JSON.stringify(
            (await db.selectFrom(table).selectAll().execute())
              .map((row) => JSON.stringify(row))
              .sort(),
          );
        return result;
      };
      // 19: routing the request to a department the requester does not belong
      // to must not remove their own access.
      await db
        .updateTable('service_request')
        .set({ routed_department_id: c.targetDepartment })
        .where('organization_id', '=', org)
        .where('id', '=', owned)
        .execute();
      const before = await snapshot();
      await mine(owner.id).expect(200);
      await mine(owner.id, `/${owned}`).expect(200);
      assert.deepEqual(
        listBody(await mine(owner.id).expect(200)).items.map((x) => x.id),
        [owned],
        'a routed request stays visible to its requester',
      );
      // 20: reads are side-effect free.
      assert.deepEqual(await snapshot(), before);
      // 7: deactivating the identity revokes access immediately.
      await db
        .updateTable('staff_identity')
        .set({ active: false })
        .where('organization_id', '=', org)
        .where('id', '=', owner.id)
        .execute();
      await mine(owner.id).expect(403);
      await mine(owner.id, `/${owned}`).expect(403);
      await db
        .updateTable('staff_identity')
        .set({ active: true })
        .where('organization_id', '=', org)
        .where('id', '=', owner.id)
        .execute();
      await mine(owner.id, `/${owned}`).expect(200);
      // Deactivating the Organization refuses the requester as well.
      await db
        .updateTable('organization')
        .set({ status: 'inactive' })
        .where('id', '=', org)
        .execute();
      await mine(owner.id).expect(403);
      await db
        .updateTable('organization')
        .set({ status: 'active' })
        .where('id', '=', org)
        .execute();
      await mine(owner.id, `/${owned}`).expect(200);
      // 15: the eligibility the read depends on cannot be flipped underneath
      // the requester. The database refuses to make a request's identity or
      // internal attribution inconsistent, so an INTERNAL request can never
      // become ineligible while its recorded correspondence stays readable.
      // The read-time eligibility gate is therefore defence in depth rather
      // than a reachable state, and these rejections are the real control.
      await assert.rejects(
        db
          .updateTable('service_request')
          .set({ reporting_identity: 'anonymous' })
          .where('organization_id', '=', org)
          .where('id', '=', owned)
          .execute(),
        /identity is immutable/,
      );
      await assert.rejects(
        db
          .updateTable('service_request')
          .set({ requester_staff_identity_id: c.creator })
          .where('organization_id', '=', org)
          .where('id', '=', owned)
          .execute(),
      );
      await assert.rejects(
        db
          .updateTable('service_request')
          .set({ audience: 'public' })
          .where('organization_id', '=', org)
          .where('id', '=', owned)
          .execute(),
      );
      assert.equal(
        detailBody(await mine(owner.id, `/${owned}`).expect(200)).updates
          .length,
        25,
      );
      assert.deepEqual(await snapshot(), before);
    },
  );
}
