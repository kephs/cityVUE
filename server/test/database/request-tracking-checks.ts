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
} from '../../migrations/20260922000000-add-requester-tracking.js';
import { trackingDigest } from '../../src/service-request/request-tracking.domain.js';

function responseBody(response: { body: unknown }) {
  return response.body as {
    id: string;
    credential: string;
    version: string;
    status: string;
    reference: string;
    issue: Record<string, unknown>;
  };
}
export async function checkRequestTracking(
  t: TestContext,
  c: {
    app: INestApplication;
    db: Kysely<DatabaseSchema>;
    org: string;
    creator: string;
    otherInternal: string;
    department: string;
    publicPayload: object;
    internalPayload: object;
    logs: string[];
  },
) {
  const { app, db, org } = c,
    key = 'service_request.tracking.manage';
  const snapshot = async () => {
    const result: Record<string, string> = {};
    for (const table of [
      'service_request',
      'requester_contact',
      'request_internal_note',
      'request_communication',
      'request_operational_activity',
      'service_request_assignment',
      'service_request_watcher',
    ] as const)
      result[table] = JSON.stringify(
        (await db.selectFrom(table).selectAll().execute())
          .map((x) => JSON.stringify(x))
          .sort(),
      );
    return result;
  };
  await t.test(
    'F044 disposable migration preserves data, creates no secrets/grants, rolls back and reapplies',
    async () => {
      const before = await snapshot();
      await db.transaction().execute(up);
      assert.deepEqual(await snapshot(), before);
      assert.equal(
        (
          await db
            .selectFrom('request_tracking_credential')
            .selectAll()
            .execute()
        ).length,
        0,
      );
      assert.equal(
        (
          await db
            .selectFrom('role_permission')
            .selectAll()
            .where('permission_key', '=', key)
            .execute()
        ).length,
        0,
      );
      await db.transaction().execute(down);
      await db.transaction().execute(up);
      assert.deepEqual(await snapshot(), before);
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
        display_name: 'F044 Fictional Staff',
        email: null,
        active: true,
      })
      .execute();
    await db
      .insertInto('role')
      .values({
        id: role,
        organization_id: org,
        name: `F044 ${id}`,
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
    return id;
  };
  const full = await actor([
    'service_request.view',
    'service_request.internal.read',
    key,
  ]);
  const create = async (payload: object) =>
    responseBody(
      await request(app.getHttpServer())
        .post('/api/v1/staff/service-requests')
        .set('Authorization', `Bearer ${c.creator}`)
        .send(payload)
        .expect(201),
    ).id;
  const id = await create(c.publicPayload),
    internal = await create(c.internalPayload);
  // F045 projection regression: coordinates remain operational data, tracking stays text-only.
  await sql`insert into location(id,organization_id,service_request_id,entered_address,latitude,longitude,location_type) values (${randomUUID()},${org},${id},'Fictional F045 service landmark',0.012345,-0.023456,'other')`.execute(
    db,
  );
  const root = (requestId = id) =>
    `/api/v1/staff/service-requests/${requestId}/requester-tracking`;
  const state = (who: string = full, requestId = id) =>
    request(app.getHttpServer())
      .get(root(requestId))
      .set('Authorization', `Bearer ${who}`);
  const change = (
    op: string,
    version: string | null,
    who: string = full,
    requestId = id,
    extra: object = {},
  ) =>
    request(app.getHttpServer())
      .post(`${root(requestId)}/${op}`)
      .set('Authorization', `Bearer ${who}`)
      .send({ expectedVersion: version, ...extra });
  const track = (credential: string) =>
    request(app.getHttpServer())
      .get('/api/v1/requester-tracking')
      .set('X-Requester-Tracking', credential);
  await t.test(
    'F044 parent/manage matrix, unrelated permissions, Organization/scope and INTERNAL are enforced',
    async () => {
      await request(app.getHttpServer()).get(root()).expect(401);
      await request(app.getHttpServer())
        .post(`${root()}/issue`)
        .send({ expectedVersion: null })
        .expect(401);
      for (const keys of [
        [],
        [key],
        ['service_request.view'],
        [
          'service_request.view',
          'service_request.contact.read',
          'service_request.note.read',
          'service_request.note.create',
          'service_request.communication.read',
          'service_request.communication.create',
          'service_request.assign',
          'service_request.watchers.manage',
          'service_request.internal.update',
        ],
      ]) {
        const who = await actor(keys);
        await state(who).expect(403);
        for (const op of ['issue', 'rotate', 'revoke'])
          await change(op, null, who).expect(403);
      }
      const noScope = await actor(['service_request.view', key], []);
      await state(noScope).expect(404);
      await change('issue', null, noScope).expect(404);
      await state(full, internal).expect(404);
      await change('issue', null, full, internal).expect(404);
      await state(full, c.otherInternal).expect(404);
      await change('issue', null, full, c.otherInternal).expect(404);
      await state(full, randomUUID()).expect(404);
      await change('issue', null, full, id, {
        audience: 'public',
        organizationId: org,
      }).expect(400);
      const result = await state().expect(200);
      assert.deepEqual(result.body, { status: 'not_issued', version: null });
    },
  );
  await t.test(
    'F044 assignment, watching and operational Role/Team membership grant no tracking management',
    async () => {
      for (const table of [
        'service_request_assignment',
        'service_request_watcher',
        'operational_role_membership',
        'work_group_membership',
      ] as const) {
        assert.ok(
          (
            await db
              .selectFrom(table)
              .select('staff_identity_id')
              .where('staff_identity_id', '=', c.creator)
              .execute()
          ).length,
        );
      }
      await state(c.creator).expect(403);
      for (const op of ['issue', 'rotate', 'revoke'])
        await change(op, null, c.creator).expect(403);
    },
  );
  const before = await snapshot();
  let a = '',
    b = '',
    version = '';
  await t.test(
    'F044 concurrent issuance yields one active digest, one safe audit and one-time credential',
    async () => {
      const responses = await Promise.all([
        change('issue', null),
        change('issue', null),
      ]);
      assert.deepEqual(responses.map((x) => x.status).sort(), [201, 409]);
      const result = responses.find((x) => x.status === 201);
      assert.ok(result);
      a = responseBody(result).credential;
      version = responseBody(result).version;
      assert.equal(result.headers['cache-control'], 'no-store');
      assert.equal(result.headers['referrer-policy'], 'no-referrer');
      const rows = await db
        .selectFrom('request_tracking_credential')
        .selectAll()
        .execute();
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.credential_digest, trackingDigest(a));
      assert.ok(!JSON.stringify(rows).includes(a));
      assert.deepEqual((await state().expect(200)).body, {
        status: 'active',
        version,
      });
      await assert.rejects(
        db
          .insertInto('request_tracking_credential')
          .values({
            organization_id: org,
            service_request_id: id,
            credential_digest: 'a'.repeat(64),
            status: 'active',
            created_by_staff_identity_id: full,
            revoked_at: null,
          })
          .execute(),
      );
    },
  );
  await t.test(
    'F044 bearer access is allowlisted, reference/UUID/malformed/unknown are insufficient and headers protect failures',
    async () => {
      const result = await track(a).expect(200);
      assert.equal(
        (result.body as { serviceLocation: string }).serviceLocation,
        'Fictional F045 service landmark',
      );
      for (const field of [
        'latitude',
        'longitude',
        'accuracy',
        'permission',
        'provenance',
        'deviceLocation',
        'requesterGeography',
      ])
        assert.equal(field in result.body, false);
      assert.deepEqual(Object.keys(result.body).sort(), [
        'description',
        'issue',
        'reference',
        'serviceLocation',
        'status',
        'submittedAt',
      ]);
      assert.deepEqual(Object.keys(responseBody(result).issue).sort(), [
        'icon',
        'name',
      ]);
      assert.equal(result.headers['cache-control'], 'no-store');
      assert.equal(result.headers['referrer-policy'], 'no-referrer');
      assert.equal(result.headers['x-robots-tag'], 'noindex, nofollow');
      for (const token of [
        '',
        id,
        responseBody(result).reference,
        'A'.repeat(43),
        'malformed',
      ]) {
        const denied = await track(token).expect(404);
        assert.equal(denied.headers['cache-control'], 'no-store');
        assert.deepEqual(Object.keys(denied.body).sort(), [
          'error',
          'requestId',
          'statusCode',
        ]);
      }
      await request(app.getHttpServer())
        .get(
          `/api/v1/requester-tracking?reference=${responseBody(result).reference}`,
        )
        .expect(404);
      await request(app.getHttpServer())
        .get(root())
        .set('Authorization', `Bearer ${a}`)
        .expect(401);
      const substituted = await request(app.getHttpServer())
        .get(
          `/api/v1/requester-tracking?requestId=${c.otherInternal}&organizationId=${randomUUID()}&audience=internal`,
        )
        .set('X-Requester-Tracking', a)
        .expect(200);
      assert.deepEqual(substituted.body, result.body);
      await db
        .updateTable('service_request')
        .set({ audience: 'internal', requester_staff_identity_id: c.creator })
        .where('id', '=', id)
        .execute();
      try {
        await track(a).expect(404);
      } finally {
        await db
          .updateTable('service_request')
          .set({ audience: 'public', requester_staff_identity_id: null })
          .where('id', '=', id)
          .execute();
      }
      await db
        .updateTable('organization')
        .set({ status: 'inactive' })
        .where('id', '=', org)
        .execute();
      try {
        await track(a).expect(404);
      } finally {
        await db
          .updateTable('organization')
          .set({ status: 'active' })
          .where('id', '=', org)
          .execute();
      }
    },
  );
  await t.test(
    'F044 required audit failure atomically preserves old active credential on rotation',
    async () => {
      await sql`create function fail_f044_audit() returns trigger language plpgsql as $$ begin if NEW.activity_type like 'requester_tracking_%' then raise exception 'synthetic audit failure'; end if; return NEW; end $$;
      create trigger fail_f044_audit before insert on activity for each row execute function fail_f044_audit();`.execute(
        db,
      );
      try {
        await change('rotate', version).expect(500);
        await change('revoke', version).expect(500);
        await track(a).expect(200);
        assert.equal(
          (
            await db
              .selectFrom('request_tracking_credential')
              .selectAll()
              .execute()
          ).length,
          1,
        );
        assert.deepEqual(await snapshot(), before);
      } finally {
        await sql`drop trigger fail_f044_audit on activity; drop function fail_f044_audit();`.execute(
          db,
        );
      }
    },
  );
  await t.test(
    'F044 rotation/revocation/reissue invalidate old credentials without operational mutations',
    async () => {
      const rotated = await change('rotate', version).expect(201);
      b = responseBody(rotated).credential;
      version = responseBody(rotated).version;
      await track(a).expect(404);
      await track(b).expect(200);
      await change(
        'rotate',
        (
          await db
            .selectFrom('request_tracking_credential')
            .select('id')
            .where('credential_digest', '=', trackingDigest(a))
            .executeTakeFirstOrThrow()
        ).id,
      ).expect(409);
      await change('revoke', version).expect(201);
      await track(b).expect(404);
      assert.equal(responseBody(await state()).status, 'revoked');
      const reissued = await change('issue', version).expect(201);
      await track(responseBody(reissued).credential).expect(200);
      await change('revoke', responseBody(reissued).version).expect(201);
      assert.deepEqual(await snapshot(), before);
      const audits = await db
        .selectFrom('activity')
        .selectAll()
        .where('activity_type', 'like', 'requester_tracking_%')
        .execute();
      assert.equal(audits.length, 5);
      const evidence = JSON.stringify(audits) + c.logs.join('');
      for (const secret of [a, b, trackingDigest(a), trackingDigest(b)])
        assert.ok(
          !evidence.includes(secret),
          'credentials and digests are absent from audit/logs',
        );
    },
  );
  await t.test(
    'F044 database protects immutable credential history, tenant integrity, PUBLIC eligibility and meaningful rollback',
    async () => {
      await assert.rejects(
        db
          .updateTable('request_tracking_credential')
          .set({ credential_digest: 'b'.repeat(64) })
          .execute(),
      );
      await assert.rejects(
        db.deleteFrom('request_tracking_credential').execute(),
      );
      await assert.rejects(
        sql`truncate request_tracking_credential`.execute(db),
      );
      for (const parent of [internal, c.otherInternal, randomUUID()])
        await assert.rejects(
          db
            .insertInto('request_tracking_credential')
            .values({
              organization_id: org,
              service_request_id: parent,
              credential_digest: 'c'.repeat(64),
              status: 'active',
              created_by_staff_identity_id: full,
              revoked_at: null,
            })
            .execute(),
        );
      await assert.rejects(db.transaction().execute(down));
    },
  );
}
