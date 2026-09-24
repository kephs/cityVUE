import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { Permission } from '../../src/auth/auth.types.js';
import { ParticipationService } from '../../src/service-request/participation.service.js';
import { setParticipationCollection } from '../../src/database/participation-configuration.js';
import { validateParticipationArea } from '../../src/service-request/participation.domain.js';
import {
  up,
  down,
} from '../../migrations/20261002000000-add-admin-participation-area-write.js';

export async function checkAdminParticipationAreas(
  t: TestContext,
  c: {
    app: INestApplication;
    db: Kysely<DatabaseSchema>;
    org: string;
    creator: string;
    logs: string[];
  },
) {
  const { db, app, org } = c,
    api = app.getHttpServer() as Server,
    path = '/api/v1/admin/participation-areas';
  const rows = () =>
    db.selectFrom('participation_area').selectAll().orderBy('id').execute();
  const audits = () =>
    db
      .selectFrom('participation_area_audit')
      .selectAll()
      .orderBy('id')
      .execute();
  const collection = () =>
    db
      .selectFrom('organization')
      .select([
        'service_participation_collection_enabled',
        'participation_collection_revision',
      ])
      .where('id', '=', org)
      .executeTakeFirstOrThrow();
  const requests = () =>
    db.selectFrom('service_request').selectAll().orderBy('id').execute();
  const priorRequests = await requests(),
    priorAreas = await rows(),
    priorCollection = await collection();
  const priorGrants = await db
    .selectFrom('role_permission')
    .selectAll()
    .orderBy('role_id')
    .orderBy('permission_key')
    .execute();
  const priorAudits = await db
    .selectFrom('participation_collection_audit')
    .selectAll()
    .orderBy('id')
    .execute();
  await t.test(
    'F055 migration apply/rollback/reapply preserves all existing data and zero grants',
    async () => {
      await db.transaction().execute(up);
      await db.transaction().execute(down);
      await assert.rejects(() =>
        db.transaction().execute(async (trx) => {
          await trx
            .insertInto('participation_area')
            .values([
              { organization_id: org, display_name: 'F055 Collision' },
              { organization_id: org, display_name: ' f055 collision ' },
            ])
            .execute();
          await up(trx);
        }),
      );
      assert.deepEqual(await rows(), priorAreas);
      await db.transaction().execute(up);
      assert.deepEqual(await rows(), priorAreas);
      assert.deepEqual(await requests(), priorRequests);
      assert.deepEqual(await collection(), priorCollection);
      assert.equal(
        (
          await db
            .selectFrom('role_permission')
            .selectAll()
            .where('permission_key', '=', 'admin.participation_areas.write')
            .execute()
        ).length,
        0,
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
      display_name: 'Fictional F055 administrator',
      active: true,
    })
    .execute();
  await db
    .insertInto('role')
    .values({
      id: role,
      organization_id: org,
      name: 'F055 isolated role',
      active: true,
    })
    .execute();
  await db
    .insertInto('staff_role_assignment')
    .values({
      organization_id: org,
      staff_identity_id: actor,
      role_id: role,
      active: true,
    })
    .execute();
  const grant = (permission_key: Permission) =>
    db
      .insertInto('role_permission')
      .values({ organization_id: org, role_id: role, permission_key })
      .execute();
  const clear = () =>
    db.deleteFrom('role_permission').where('role_id', '=', role).execute();
  const post = (body: object) =>
    request(api).post(path).set('Authorization', `Bearer ${actor}`).send(body);
  const patch = (id: string, body: object) =>
    request(api)
      .patch(`${path}/${id}`)
      .set('Authorization', `Bearer ${actor}`)
      .send(body);
  const own = () =>
    db
      .selectFrom('participation_area')
      .selectAll()
      .where('organization_id', '=', org)
      .orderBy('display_order')
      .orderBy('display_name')
      .orderBy('id')
      .execute();
  const get = (id: string) =>
    db
      .selectFrom('participation_area')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  await t.test(
    'F055 HTTP 401/403 and all independent permission states fail closed',
    async () => {
      const old = await rows();
      await request(api).post(path).send({ displayName: 'Denied' }).expect(401);
      for (const permission of [
        null,
        'admin.configuration.read',
        'admin.participation_areas.write',
        'admin.intake_settings.write',
        'analytics.service_participation.read',
        'service_request.view',
      ] as const) {
        await clear();
        if (permission) await grant(permission);
        await post({ displayName: 'Denied' }).expect(403);
        if (permission !== 'admin.configuration.read')
          await request(api)
            .get('/api/v1/admin/configuration')
            .set('Authorization', `Bearer ${actor}`)
            .expect(403);
      }
      await clear();
      await grant('admin.configuration.read');
      await grant('admin.participation_areas.write');
      for (const route of [
        '/api/v1/staff/service-requests',
        '/api/v1/staff/analytics/service-participation?startDate=2020-01-01&endDate=2020-02-29',
      ])
        await request(api)
          .get(route)
          .set('Authorization', `Bearer ${actor}`)
          .expect(403);
      assert.deepEqual(await rows(), old);
      assert.equal((await audits()).length, 0);
    },
  );
  let id = '';
  await t.test(
    'F055 create trims, preserves capitalization, starts active/revision 1 and atomically audits',
    async () => {
      const response = await post({
        displayName: ' \u00a0 F055 North District \u3000 ',
      }).expect(201);
      id = (response.body as { area: { id: string } }).area.id;
      const row = await get(id);
      assert.equal(row.display_name, 'F055 North District');
      assert.equal(row.revision, 1);
      assert.equal(row.active, true);
      assert.equal(row.organization_id, org);
      const audit = (await audits())[0];
      assert.ok(audit);
      assert.equal(audit.action, 'created');
      assert.equal(audit.area_id, id);
      assert.equal(audit.staff_identity_id, actor);
      assert.equal(audit.prior_revision, null);
      assert.equal(audit.revision, 1);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.deepEqual(await collection(), priorCollection);
    },
  );
  await t.test(
    'F055 duplicate create/rename/inactive names fail safely, retain exact original state, other Organizations can reuse names',
    async () => {
      const before = await get(id),
        history = await audits();
      for (const name of [
        'f055 north district',
        'F055 NORTH DISTRICT',
        'F055 North District ',
        '\u3000F055 North District\u00a0',
      ]) {
        const r = await post({ displayName: name }).expect(400);
        assert.equal(
          (r.body as { message: string }).message,
          'A Participation Area with this name already exists.',
        );
      }
      assert.deepEqual(await get(id), before);
      assert.deepEqual(await audits(), history);
      const other = await post({ displayName: 'F055 Other District' }).expect(
          201,
        ),
        otherId = (other.body as { area: { id: string } }).area.id;
      const otherBefore = await get(otherId);
      await patch(otherId, {
        displayName: ' f055 NORTH district ',
        expectedRevision: 1,
      }).expect(400);
      assert.deepEqual(await get(otherId), otherBefore);
      await patch(id, { active: false, expectedRevision: 1 }).expect(200);
      const inactive = await get(id);
      await post({ displayName: 'F055 NORTH DISTRICT' }).expect(400);
      assert.deepEqual(await get(id), inactive);
      const foreignOrg = randomUUID();
      await db
        .insertInto('organization')
        .values({
          id: foreignOrg,
          name: 'Fictional F055 second Organization',
          short_name: 'F055',
          slug: foreignOrg,
          status: 'active',
          default_business_timezone: 'Etc/UTC',
        })
        .execute();
      const foreign = await db
        .insertInto('participation_area')
        .values({
          organization_id: foreignOrg,
          display_name: 'F055 North District',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const denied = await patch(foreign.id, {
        displayName: 'Changed',
        expectedRevision: 1,
      }).expect(404);
      const missing = await patch(randomUUID(), {
        displayName: 'Changed',
        expectedRevision: 1,
      }).expect(404);
      assert.equal(
        (denied.body as { error: string }).error,
        (missing.body as { error: string }).error,
      );
      assert.deepEqual(await get(foreign.id), foreign);
    },
  );
  await t.test(
    'F055 database enforces duplicate races directly, independent of API checks',
    async () => {
      const results = await Promise.allSettled(
        ['F055 Database Race', ' f055 database race '].map((display_name) =>
          db
            .insertInto('participation_area')
            .values({ organization_id: org, display_name })
            .execute(),
        ),
      );
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const [a, b] = await Promise.all(
        ['F055 Race A', 'F055 Race B'].map((display_name) =>
          db
            .insertInto('participation_area')
            .values({ organization_id: org, display_name })
            .returningAll()
            .executeTakeFirstOrThrow(),
        ),
      );
      assert.ok(a && b);
      const rename = await Promise.allSettled(
        [a, b].map((area, index) =>
          db
            .updateTable('participation_area')
            .set({
              display_name: index ? 'f055 rename race' : 'F055 Rename Race',
            })
            .where('id', '=', area.id)
            .execute(),
        ),
      );
      assert.equal(rename.filter((r) => r.status === 'fulfilled').length, 1);
      const loser = rename.findIndex((r) => r.status === 'rejected');
      const unchanged = [a, b][loser];
      assert.ok(unchanged);
      assert.deepEqual(await get(unchanged.id), unchanged);
    },
  );
  await t.test(
    'F055 HTTP duplicate create and rename races allow only one success',
    async () => {
      const result = await Promise.all([
        post({ displayName: 'F055 API Race' }),
        post({ displayName: ' f055 api race ' }),
      ]);
      assert.deepEqual(result.map((r) => r.status).sort(), [201, 400]);
      const a = (
        (await post({ displayName: 'F055 API Rename A' })).body as {
          area: { id: string };
        }
      ).area;
      const b = (
        (await post({ displayName: 'F055 API Rename B' })).body as {
          area: { id: string };
        }
      ).area;
      const race = await Promise.all([
        patch(a.id, { displayName: 'F055 Rename Target', expectedRevision: 1 }),
        patch(b.id, {
          displayName: ' f055 rename target ',
          expectedRevision: 1,
        }),
      ]);
      assert.deepEqual(race.map((r) => r.status).sort(), [200, 400]);
      const loser = race.findIndex((r) => r.status === 400);
      const unchanged = [a, b][loser];
      assert.ok(unchanged);
      assert.equal((await get(unchanged.id)).revision, 1);
    },
  );
  await t.test(
    'F055 strict DTOs, forged Organization/query and missing revisions reject without writes; no DELETE',
    async () => {
      const before = await rows(),
        history = await audits(),
        row = await get(id);
      for (const key of [
        'organizationId',
        'privacyThreshold',
        'collectionEnabled',
        'geometry',
        'latitude',
        'longitude',
        'assignmentTarget',
        'requesterId',
      ]) {
        await post({ displayName: 'Forbidden', [key]: 'forged' }).expect(400);
        await patch(id, {
          active: true,
          expectedRevision: row.revision,
          [key]: 'forged',
        }).expect(400);
      }
      for (const body of [
        { active: true },
        { active: true, expectedRevision: 0 },
        { displayName: ' ' },
        { displayOrder: '1', expectedRevision: row.revision },
        { active: null, expectedRevision: row.revision },
        { active: true, displayName: 'Mix', expectedRevision: row.revision },
        { expectedRevision: row.revision },
      ])
        await patch(id, body).expect(400);
      await request(api)
        .post(path + '?organizationId=' + randomUUID())
        .set('Authorization', `Bearer ${actor}`)
        .send({ displayName: 'Forged' })
        .expect(400);
      await request(api)
        .delete(path + '/' + id)
        .set('Authorization', `Bearer ${actor}`)
        .expect(404);
      assert.deepEqual(await rows(), before);
      assert.deepEqual(await audits(), history);
    },
  );
  await t.test(
    'F055 same-area concurrent revisions: one 200/one 409; no-op and GET do not mutate or audit',
    async () => {
      const old = await get(id),
        before = (await audits()).length;
      const responses = await Promise.all([
        patch(id, {
          displayName: 'F055 Current Label',
          expectedRevision: old.revision,
        }),
        patch(id, {
          displayName: 'F055 Concurrent Label',
          expectedRevision: old.revision,
        }),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
      const row = await get(id);
      assert.equal(row.revision, old.revision + 1);
      assert.equal((await audits()).length, before + 1);
      await patch(id, {
        displayName: row.display_name,
        expectedRevision: old.revision,
      }).expect(409);
      const noop = await patch(id, {
        displayName: row.display_name,
        expectedRevision: row.revision,
      }).expect(200);
      assert.equal((noop.body as { changed: boolean }).changed, false);
      const getResponse = await request(api)
        .get('/api/v1/admin/configuration')
        .set('Authorization', `Bearer ${actor}`)
        .expect(200);
      assert.equal(
        (
          getResponse.body as {
            capabilities: { canWriteParticipationAreas: boolean };
          }
        ).capabilities.canWriteParticipationAreas,
        true,
      );
      assert.deepEqual(await get(id), row);
      assert.equal((await audits()).length, before + 1);
    },
  );
  await t.test(
    'F055 independent-area order edits both succeed; stale reorder conflicts and ties remain deterministic',
    async () => {
      const [a, b] = (await own()).slice(0, 2);
      assert.ok(a && b);
      const responses = await Promise.all([
        patch(a.id, { displayOrder: -100, expectedRevision: a.revision }),
        patch(b.id, { displayOrder: -100, expectedRevision: b.revision }),
      ]);
      assert.deepEqual(
        responses.map((r) => r.status),
        [200, 200],
      );
      const before = await rows(),
        history = await audits();
      await patch(a.id, {
        displayOrder: 50,
        expectedRevision: a.revision,
      }).expect(409);
      assert.deepEqual(await rows(), before);
      assert.deepEqual(await audits(), history);
      assert.equal(history.filter((a) => a.action === 'reordered').length, 2);
    },
  );
  await t.test(
    'F055 last-active guard, collection independence, reactivation and current requester projection',
    async () => {
      await db
        .updateTable('participation_area')
        .set({ active: false })
        .where('organization_id', '=', org)
        .where('id', '!=', id)
        .execute();
      const old = await get(id);
      await patch(id, { active: true, expectedRevision: old.revision }).expect(
        200,
      );
      const only = await get(id),
        history = await audits(),
        setting = await collection();
      assert.equal(setting.service_participation_collection_enabled, true);
      const r = await patch(id, {
        active: false,
        expectedRevision: only.revision,
      }).expect(400);
      assert.equal(
        (r.body as { code: string }).code,
        'PARTICIPATION_AREA_LAST_ACTIVE',
      );
      assert.deepEqual(await get(id), only);
      assert.deepEqual(await audits(), history);
      const projection = await app.get(ParticipationService).areas(org);
      assert.deepEqual(projection.items, [{ id, label: only.display_name }]);
      await db
        .updateTable('organization')
        .set({ service_participation_collection_enabled: false })
        .where('id', '=', org)
        .execute();
      const disabled = await collection();
      await patch(id, {
        active: false,
        expectedRevision: only.revision,
      }).expect(200);
      assert.equal((await own()).filter((a) => a.active).length, 0);
      assert.deepEqual(await collection(), disabled);
      await patch(id, {
        active: true,
        expectedRevision: (await get(id)).revision,
      }).expect(200);
      await post({ displayName: 'F055 Disabled Creation' }).expect(201);
      assert.deepEqual(await collection(), disabled);
      assert.deepEqual(await app.get(ParticipationService).areas(org), {
        collectionEnabled: false,
        items: [],
      });
      await db
        .updateTable('organization')
        .set({ service_participation_collection_enabled: true })
        .where('id', '=', org)
        .execute();
    },
  );
  await t.test(
    'F055 simultaneous final-two deactivations cannot leave enabled collection empty',
    async () => {
      const active = (await own()).filter((a) => a.active);
      assert.equal(active.length, 2);
      const results = await Promise.all(
        active.map((a) =>
          patch(a.id, { active: false, expectedRevision: a.revision }),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
      assert.equal((await own()).filter((a) => a.active).length, 1);
    },
  );
  await t.test(
    'F055 required audit failure rolls back create/rename/order/state and revision',
    async () => {
      const row = await get(id),
        before = await rows(),
        history = await audits();
      await sql`create function fail_f055_audit() returns trigger language plpgsql as $$ begin raise exception 'Disposable failure'; end $$; create trigger fail_f055 before insert on participation_area_audit for each row execute function fail_f055_audit();`.execute(
        db,
      );
      try {
        await post({ displayName: 'F055 Rolled Back' }).expect(500);
        await patch(id, {
          displayName: 'F055 Rollback Rename',
          expectedRevision: row.revision,
        }).expect(500);
        await patch(id, {
          displayOrder: 1234,
          expectedRevision: row.revision,
        }).expect(500);
        if (!row.active)
          await patch(id, {
            active: true,
            expectedRevision: row.revision,
          }).expect(500);
      } finally {
        await sql`drop trigger fail_f055 on participation_area_audit; drop function fail_f055_audit();`.execute(
          db,
        );
      }
      assert.deepEqual(await rows(), before);
      assert.deepEqual(await audits(), history);
    },
  );
  await t.test(
    'F055 collection enable racing final-area deactivation cannot commit an invalid configuration',
    async () => {
      await db
        .updateTable('organization')
        .set({ service_participation_collection_enabled: false })
        .where('id', '=', org)
        .execute();
      await db
        .updateTable('participation_area')
        .set({ active: false })
        .where('organization_id', '=', org)
        .where('id', '!=', id)
        .execute();
      await db
        .updateTable('participation_area')
        .set({ active: true })
        .where('id', '=', id)
        .execute();
      const row = await get(id);
      await Promise.allSettled([
        db
          .transaction()
          .execute((trx) => setParticipationCollection(trx, org, true)),
        patch(id, { active: false, expectedRevision: row.revision }),
      ]);
      const current = await collection();
      assert.ok(
        !current.service_participation_collection_enabled ||
          (await own()).some((a) => a.active),
      );
      await db
        .updateTable('participation_area')
        .set({ active: true })
        .where('id', '=', id)
        .execute();
      await db
        .transaction()
        .execute((trx) => setParticipationCollection(trx, org, true));
    },
  );
  await t.test(
    'F055 stable-ID resident drafts survive rename/order but reject subsequent inactive selection',
    async () => {
      const area = await post({ displayName: 'F055 Stale Draft' }).expect(201);
      const draft = (area.body as { area: { id: string } }).area;
      const admission = () =>
        db.transaction().execute((trx) =>
          validateParticipationArea(trx, org, {
            state: 'PROVIDED',
            areaId: draft.id,
          }),
        );
      await admission();
      await patch(draft.id, {
        displayName: 'F055 Renamed Draft',
        expectedRevision: 1,
      }).expect(200);
      await admission();
      await patch(draft.id, { displayOrder: -500, expectedRevision: 2 }).expect(
        200,
      );
      await admission();
      await patch(draft.id, { active: false, expectedRevision: 3 }).expect(200);
      await assert.rejects(admission);
      const projection = await app.get(ParticipationService).areas(org);
      assert.ok(!projection.items.some((a) => a.id === draft.id));
    },
  );
  await t.test(
    'F055 historical references survive rename, order and deactivation; requests and F053 audits unchanged',
    async () => {
      const referenced = priorRequests.find(
        (r) => r.participation_area_id,
      )?.participation_area_id;
      assert.ok(referenced);
      let row = await get(referenced);
      await patch(row.id, {
        displayName: 'F055 Historical Current Label',
        expectedRevision: row.revision,
      }).expect(200);
      row = await get(referenced);
      await patch(row.id, {
        displayOrder: 99,
        expectedRevision: row.revision,
      }).expect(200);
      row = await get(referenced);
      if (row.active)
        await patch(row.id, {
          active: false,
          expectedRevision: row.revision,
        }).expect(200);
      assert.deepEqual(await requests(), priorRequests);
      assert.deepEqual(
        await db
          .selectFrom('participation_collection_audit')
          .selectAll()
          .orderBy('id')
          .execute(),
        priorAudits,
      );
      assert.deepEqual(
        await db
          .selectFrom('role_permission')
          .selectAll()
          .where('role_id', '!=', role)
          .orderBy('role_id')
          .orderBy('permission_key')
          .execute(),
        priorGrants,
      );
    },
  );
  await t.test(
    'F055 audit immutable/retained rollback refusal and normal logging excludes payloads/actors',
    async () => {
      await assert.rejects(() =>
        db
          .updateTable('participation_area_audit')
          .set({ name: 'Forged' })
          .execute(),
      );
      await assert.rejects(() =>
        db.deleteFrom('participation_area_audit').execute(),
      );
      await assert.rejects(() =>
        sql`truncate participation_area_audit`.execute(db),
      );
      await assert.rejects(() => db.transaction().execute(down));
      const logs = c.logs.join('\n');
      for (const marker of [
        'F055 North District',
        'F055 Rollback Rename',
        actor,
        'expectedRevision',
        'prior_display_order',
      ])
        assert.ok(!logs.includes(marker));
    },
  );
}
