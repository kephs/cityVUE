import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import {
  up,
  down,
} from '../../migrations/20260930000000-add-admin-intake-settings-write.js';

export async function checkAdminIntakeSettings(
  t: TestContext,
  c: {
    app: INestApplication;
    db: Kysely<DatabaseSchema>;
    org: string;
    creator: string;
    logs: string[];
  },
) {
  const { db, org, app } = c,
    api = app.getHttpServer() as Server;
  const path = '/api/v1/admin/intake-settings/service-participation';
  const beforeRequests = await db
    .selectFrom('service_request')
    .selectAll()
    .orderBy('id')
    .execute();
  const beforeGrants = await db
    .selectFrom('role_permission')
    .selectAll()
    .orderBy('role_id')
    .orderBy('permission_key')
    .execute();
  const collection = async () =>
    db
      .selectFrom('organization')
      .select([
        'service_participation_collection_enabled',
        'participation_collection_revision',
      ])
      .where('id', '=', org)
      .executeTakeFirstOrThrow();
  const audits = () =>
    db
      .selectFrom('participation_collection_audit')
      .selectAll()
      .where('organization_id', '=', org)
      .orderBy('revision')
      .execute();
  await t.test(
    'F053 migration preserves configuration/grants, zero default grants and safe unused rollback/reapply',
    async () => {
      const before = await collection();
      await db.transaction().execute(up);
      await db.transaction().execute(down);
      await db.transaction().execute(up);
      assert.deepEqual(await collection(), before);
      assert.deepEqual(
        await db
          .selectFrom('role_permission')
          .selectAll()
          .orderBy('role_id')
          .orderBy('permission_key')
          .execute(),
        beforeGrants,
      );
    },
  );
  const actor = randomUUID(),
    role = randomUUID();
  const identity = await db
    .selectFrom('staff_identity')
    .select('entra_tenant_id')
    .where('id', '=', c.creator)
    .executeTakeFirstOrThrow();
  await db
    .insertInto('staff_identity')
    .values({
      id: actor,
      organization_id: org,
      entra_tenant_id: identity.entra_tenant_id,
      entra_object_id: actor,
      display_name: 'Fictional F053 administrator',
      active: true,
    })
    .execute();
  await db
    .insertInto('role')
    .values({
      id: role,
      organization_id: org,
      name: 'F053 isolated role',
      active: true,
    })
    .execute();
  await db
    .insertInto('staff_role_assignment')
    .values({
      organization_id: org,
      role_id: role,
      staff_identity_id: actor,
      active: true,
    })
    .execute();
  const grant = (
    p: 'admin.configuration.read' | 'admin.intake_settings.write',
  ) =>
    db
      .insertInto('role_permission')
      .values({ organization_id: org, role_id: role, permission_key: p })
      .execute();
  const patch = (body: unknown, who: string = actor) =>
    request(api)
      .patch(path)
      .set('Authorization', `Bearer ${who}`)
      .send(body as object);
  await t.test(
    'F053 real HTTP auth matrix: neither/read-only/write-only denied; both permitted; no implicit operational access',
    async () => {
      const state = await collection(),
        body = {
          enabled: state.service_participation_collection_enabled,
          expectedRevision: state.participation_collection_revision,
        };
      await request(api).patch(path).send(body).expect(401);
      await patch(body).expect(403);
      await patch(body, c.creator).expect(403);
      await grant('admin.intake_settings.write');
      await patch(body).expect(403);
      await request(api)
        .get('/api/v1/admin/configuration')
        .set('Authorization', `Bearer ${actor}`)
        .expect(403);
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', role)
        .execute();
      await grant('admin.configuration.read');
      await patch(body).expect(403);
      await grant('admin.intake_settings.write');
      const ok = await patch(body).expect(200);
      assert.deepEqual(ok.body, {
        enabled: body.enabled,
        revision: body.expectedRevision,
        changed: false,
      });
      assert.equal(ok.headers['cache-control'], 'no-store');
      for (const route of [
        '/api/v1/staff/service-requests',
        '/api/v1/staff/analytics/service-participation?startDate=2020-01-01&endDate=2020-02-29',
      ])
        await request(api)
          .get(route)
          .set('Authorization', `Bearer ${actor}`)
          .expect(403);
      assert.equal((await audits()).length, 0);
    },
  );
  await t.test(
    'F053 strict payload/query/resource forgery fails without mutation or audit',
    async () => {
      const old = await collection(),
        body = {
          enabled: false,
          expectedRevision: old.participation_collection_revision,
        };
      for (const extra of [
        'organizationId',
        'privacyThreshold',
        'participationAreas',
        'issuePolicy',
      ])
        await patch({ ...body, [extra]: randomUUID() }).expect(400);
      for (const value of [null, 0, -1, 1.1, '1', 2147483648])
        await patch({ ...body, expectedRevision: value }).expect(400);
      await patch({ enabled: false }).expect(400);
      await patch({ ...body, enabled: 'false' }).expect(400);
      await request(api)
        .patch(path + '?organizationId=' + randomUUID())
        .set('Authorization', `Bearer ${actor}`)
        .send(body)
        .expect(400);
      await request(api)
        .patch(
          '/api/v1/organizations/' +
            randomUUID() +
            '/admin/intake-settings/service-participation',
        )
        .set('Authorization', `Bearer ${actor}`)
        .send(body)
        .expect(404);
      assert.deepEqual(await collection(), old);
      assert.equal((await audits()).length, 0);
    },
  );
  // Disposable setup deliberately creates valid starting configuration without Admin audit.
  await db
    .updateTable('participation_area')
    .set({ active: true })
    .where('organization_id', '=', org)
    .execute();
  await db
    .updateTable('organization')
    .set({ service_participation_collection_enabled: true })
    .where('id', '=', org)
    .execute();
  const originalAreas = await db
    .selectFrom('participation_area')
    .selectAll()
    .orderBy('id')
    .execute();
  await t.test(
    'F053 two concurrent writers: one commit, one 409, exact revision increment and one safe audit; stale same-value still conflicts',
    async () => {
      const old = await collection(),
        correlation = randomUUID();
      const results = await Promise.all([
        patch({
          enabled: false,
          expectedRevision: old.participation_collection_revision,
        }).set('X-Request-Id', correlation),
        patch({
          enabled: false,
          expectedRevision: old.participation_collection_revision,
        }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      const now = await collection();
      assert.equal(
        now.participation_collection_revision,
        old.participation_collection_revision + 1,
      );
      assert.equal(now.service_participation_collection_enabled, false);
      const history = await audits();
      assert.equal(history.length, 1);
      const a = history[0];
      assert.ok(a);
      assert.equal(a.action, 'service_participation_collection_changed');
      assert.equal(a.staff_identity_id, actor);
      assert.equal(a.prior_enabled, true);
      assert.equal(a.enabled, false);
      assert.equal(a.prior_revision, old.participation_collection_revision);
      assert.equal(a.revision, now.participation_collection_revision);
      assert.match(a.correlation_id, /^[0-9a-f-]{36}$/);
      await patch({
        enabled: false,
        expectedRevision: old.participation_collection_revision,
      }).expect(409);
      await patch({
        enabled: false,
        expectedRevision: now.participation_collection_revision,
      }).expect(200);
      assert.equal((await audits()).length, 1);
      const get = await request(api)
        .get('/api/v1/admin/configuration')
        .set('Authorization', `Bearer ${actor}`)
        .expect(200);
      const snapshot = get.body as {
        collection: { enabled: boolean; revision: number };
        capabilities: { canWriteIntakeSettings: boolean };
      };
      assert.deepEqual(snapshot.collection, {
        enabled: false,
        revision: now.participation_collection_revision,
      });
      assert.equal(snapshot.capabilities.canWriteIntakeSettings, true);
      assert.deepEqual(
        await db
          .selectFrom('participation_area')
          .selectAll()
          .orderBy('id')
          .execute(),
        originalAreas,
      );
    },
  );
  await t.test(
    'F053 enable validates active own-Organization area; disabled/no-area rejection and invalid-enabled disable',
    async () => {
      await db
        .updateTable('participation_area')
        .set({ active: false })
        .where('organization_id', '=', org)
        .execute();
      const old = await collection(),
        before = await audits();
      await patch({
        enabled: true,
        expectedRevision: old.participation_collection_revision,
      }).expect(400);
      assert.deepEqual(await collection(), old);
      assert.deepEqual(await audits(), before);
      // Existing manual invalid state remains disableable.
      await db
        .updateTable('organization')
        .set({ service_participation_collection_enabled: true })
        .where('id', '=', org)
        .execute();
      await patch({
        enabled: false,
        expectedRevision: (await collection())
          .participation_collection_revision,
      }).expect(200);
      await db
        .updateTable('participation_area')
        .set({ active: true })
        .where('organization_id', '=', org)
        .execute();
      const current = await collection();
      await patch({
        enabled: true,
        expectedRevision: current.participation_collection_revision,
      }).expect(200);
      assert.equal(
        (await collection()).participation_collection_revision,
        current.participation_collection_revision + 1,
      );
    },
  );
  await t.test(
    'F053 audit insert failure rolls back value and revision; successful audits reject update/delete/truncate and rollback',
    async () => {
      const old = await collection(),
        history = await audits();
      await sql`create function fail_f053_audit() returns trigger language plpgsql as $$ begin raise exception 'Disposable audit failure'; end $$; create trigger fail_f053 before insert on participation_collection_audit for each row execute function fail_f053_audit();`.execute(
        db,
      );
      try {
        await patch({
          enabled: !old.service_participation_collection_enabled,
          expectedRevision: old.participation_collection_revision,
        }).expect(500);
      } finally {
        await sql`drop trigger fail_f053 on participation_collection_audit; drop function fail_f053_audit();`.execute(
          db,
        );
      }
      assert.deepEqual(await collection(), old);
      assert.deepEqual(await audits(), history);
      await assert.rejects(() =>
        db
          .updateTable('participation_collection_audit')
          .set({ enabled: false })
          .execute(),
      );
      await assert.rejects(() =>
        db.deleteFrom('participation_collection_audit').execute(),
      );
      await assert.rejects(() =>
        sql`truncate participation_collection_audit`.execute(db),
      );
      await assert.rejects(() => db.transaction().execute(down));
    },
  );
  await t.test(
    'F053 historical requests, prior grants and logging privacy preserved',
    async () => {
      assert.deepEqual(
        await db
          .selectFrom('service_request')
          .selectAll()
          .orderBy('id')
          .execute(),
        beforeRequests,
      );
      const grants = await db
        .selectFrom('role_permission')
        .selectAll()
        .where('role_id', '!=', role)
        .orderBy('role_id')
        .orderBy('permission_key')
        .execute();
      assert.deepEqual(grants, beforeGrants);
      const text = c.logs.join('\n');
      assert.ok(!text.includes('expectedRevision'));
      assert.ok(!text.includes(actor));
      assert.ok(!text.includes('prior_enabled'));
    },
  );
}
