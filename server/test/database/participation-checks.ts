import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import sharp from 'sharp';
import { Readable } from 'node:stream';
import { AttachmentService } from '../../src/attachments/attachment.service.js';
import type { AttachmentStorage } from '../../src/attachments/attachment-storage.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';
import { CreateServiceRequestService } from '../../src/service-request/create-service-request.service.js';
import type { CreateServiceRequestDto } from '../../src/service-request/service-request.dto.js';
import { ParticipationService } from '../../src/service-request/participation.service.js';
import { staffRequestReadScope } from '../../src/service-request/staff-request-scope.js';
import { RequesterHistoryService } from '../../src/service-request/requester-history.service.js';
import { developmentRequesterContext } from '../../src/service-request/trusted-requester.js';
import {
  up,
  down,
} from '../../migrations/20260927000000-add-service-participation.js';

import {
  up as collectionUp,
  down as collectionDown,
} from '../../migrations/20260928000000-add-participation-collection-setting.js';

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw Error('Missing test fixture');
  return value;
}

export async function checkParticipation(
  t: TestContext,
  c: {
    app: INestApplication;
    db: Kysely<DatabaseSchema>;
    org: string;
    creator: string;
    publicOnly: string;
    otherStaff: string;
    department: string;
    targetDepartment: string;
    publicPayload: object;
    internalPayload: object;
    logs: string[];
  },
) {
  const { app, db, org } = c,
    api = app.getHttpServer() as Server;
  const create = app.get(CreateServiceRequestService),
    analytics = app.get(ParticipationService);
  const original = await db
    .selectFrom('service_request')
    .selectAll()
    .orderBy('id')
    .execute();
  const grants = await db
    .selectFrom('role_permission')
    .selectAll()
    .orderBy('role_id')
    .orderBy('permission_key')
    .execute();
  await t.test(
    'F051 migration apply/down/reapply keeps historical geography unknown and grants unchanged',
    async () => {
      await db.transaction().execute(up);
      const rows = await db
        .selectFrom('service_request')
        .selectAll()
        .orderBy('id')
        .execute();
      assert.deepEqual(
        rows,
        original.map((x) => ({
          ...x,
          requester_geography_state: 'NOT_COLLECTED',
          participation_area_id: null,
        })),
      );
      assert.deepEqual(
        await db
          .selectFrom('role_permission')
          .selectAll()
          .orderBy('role_id')
          .orderBy('permission_key')
          .execute(),
        grants,
      );
      await db.transaction().execute(down);
      assert.deepEqual(
        await db
          .selectFrom('service_request')
          .selectAll()
          .orderBy('id')
          .execute(),
        original,
      );
      await db.transaction().execute(up);
    },
  );
  await t.test(
    'F051 collection setting defaults every Organization off, migrates down/up without grants or request changes',
    async () => {
      await db.transaction().execute(collectionUp);
      assert.ok(
        (
          await db
            .selectFrom('organization')
            .select('service_participation_collection_enabled')
            .execute()
        ).every((x) => !x.service_participation_collection_enabled),
      );
      await db.transaction().execute(collectionDown);
      await db.transaction().execute(collectionUp);
      assert.deepEqual(
        await db
          .selectFrom('role_permission')
          .selectAll()
          .orderBy('role_id')
          .orderBy('permission_key')
          .execute(),
        grants,
      );
      await db
        .updateTable('organization')
        .set({ service_participation_collection_enabled: true })
        .where('id', '=', org)
        .execute();
    },
  );
  const foreign = (
    await db
      .selectFrom('staff_identity')
      .select('organization_id')
      .where('id', '=', c.otherStaff)
      .executeTakeFirstOrThrow()
  ).organization_id;
  const areaIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const a = required(areaIds[0]),
    b = required(areaIds[1]),
    inactive = required(areaIds[2]),
    zero = required(areaIds[3]),
    other = randomUUID();
  for (const [i, id] of areaIds.entries())
    await db
      .insertInto('participation_area')
      .values({
        id,
        organization_id: org,
        display_name: `Fictional Participation Sentinel ${String(i)}`,
        display_order: i,
        active: id !== inactive,
      })
      .execute();
  await db
    .insertInto('participation_area')
    .values({
      id: other,
      organization_id: foreign,
      display_name: 'Fictional Participation Sentinel 0',
    })
    .execute();
  const payload = { ...c.publicPayload } as Record<string, unknown>;
  delete payload.audience;
  delete payload.intakeChannel;
  const input = {
    ...payload,
    location: { enteredAddress: 'Fictional Participation Test Lane' },
  } as unknown as Pick<CreateServiceRequestDto, keyof CreateServiceRequestDto>;
  // A separate disposable version permits location tests without changing an
  // immutable published definition or any historical request.
  const locationVersion = randomUUID();
  await sql`insert into service_definition_version select * from jsonb_populate_record(null::service_definition_version,
    (select to_jsonb(v) || jsonb_build_object('id',${locationVersion}::text,'version_number',(select max(version_number)+1 from service_definition_version where service_definition_id=v.service_definition_id),'location_policy','optional') from service_definition_version v where id=${input.serviceDefinitionVersionId}))`.execute(
    db,
  );
  input.serviceDefinitionVersionId = locationVersion;
  input.answers = [];
  const access: StaffAccess = {
    organizationId: org,
    staffIdentityId: c.creator,
    tenantId: randomUUID(),
    objectId: randomUUID(),
    permissions: [
      'service_request.view',
      'analytics.service_participation.read',
    ],
    departmentIds: [c.department],
    divisionIds: [],
    development: false,
    displayName: 'Fictional analytics staff',
    scopes: ['access_as_user'],
  };
  const period = ['2020-01-01', '2020-02-29'] as const;
  const date = new Date('2020-01-15T12:00:00Z');
  const path = `/api/v1/staff/analytics/service-participation?startDate=${period[0]}&endDate=${period[1]}`;
  const snapshot = async () => ({
    requests: await db
      .selectFrom('service_request')
      .selectAll()
      .orderBy('id')
      .execute(),
    contacts: await db
      .selectFrom('requester_contact')
      .selectAll()
      .orderBy('id')
      .execute(),
    activity: await db
      .selectFrom('activity')
      .selectAll()
      .orderBy('id')
      .execute(),
    reference: await db
      .selectFrom('service_request_reference_sequence')
      .selectAll()
      .orderBy('organization_id')
      .orderBy('period_key')
      .execute(),
  });
  await t.test(
    'F051 requester-safe areas contain only current Organization active catalog, never counts',
    async () => {
      const response = await request(api)
        .get('/api/v1/intake/participation-areas')
        .expect(200);
      const body = response.body as { items: { id: string; label: string }[] };
      assert.deepEqual(
        body.items.map((x) => x.id),
        [a, b, zero],
      );
      assert.deepEqual(Object.keys(required(body.items[0])).sort(), [
        'id',
        'label',
      ]);
      assert.equal(response.headers['cache-control'], 'no-store');
    },
  );
  await t.test(
    'F051 invalid state/area/Organization and INTERNAL geography fail atomically',
    async () => {
      const before = await snapshot();
      for (const participation of [
        { state: 'PROVIDED' },
        { state: 'DECLINED', areaId: a },
        { state: 'NOT_COLLECTED' },
        { state: 'PROVIDED', areaId: inactive },
        { state: 'PROVIDED', areaId: other },
        { state: 'PROVIDED', areaId: randomUUID() },
        { state: 'PROVIDED', areaId: a, latitude: 12 },
      ])
        await request(api)
          .post('/api/v1/service-requests')
          .send({ ...input, participation })
          .expect(400);
      await request(api)
        .post('/api/v1/staff/service-requests')
        .set('Authorization', `Bearer ${c.creator}`)
        .send({ ...c.internalPayload, participation: { state: 'DECLINED' } })
        .expect(400);
      assert.deepEqual(await snapshot(), before);
    },
  );
  let anonymousId = '',
    trustedId = '';
  await t.test(
    'F051 explicit anonymous and Contact-only geography remain identity-independent; location does not determine area',
    async () => {
      const anonymous = { ...input };
      delete anonymous.contact;
      const r = await create.execute(
        {
          ...anonymous,
          reportingIdentity: 'anonymous',
          participation: { state: 'PROVIDED', areaId: a },
        },
        date,
      );
      anonymousId = r.id;
      const row = await db
        .selectFrom('service_request')
        .selectAll()
        .where('id', '=', r.id)
        .executeTakeFirstOrThrow();
      assert.equal(row.reporting_identity, 'anonymous');
      assert.equal(row.requester_id, null);
      assert.equal(row.participation_area_id, a);
      assert.equal(
        (
          await db
            .selectFrom('requester_contact')
            .select('id')
            .where('service_request_id', '=', r.id)
            .execute()
        ).length,
        0,
      );
      const second = await create.execute(
        { ...input, participation: { state: 'PROVIDED', areaId: b } },
        date,
      );
      assert.equal(
        (
          await db
            .selectFrom('service_request')
            .select('requester_id')
            .where('id', '=', second.id)
            .executeTakeFirstOrThrow()
        ).requester_id,
        null,
      );
      const locations = await db
        .selectFrom('location')
        .select(['entered_address'])
        .where('service_request_id', 'in', [r.id, second.id])
        .execute();
      assert.equal(locations.length, 2);
      assert.equal(
        required(locations[0]).entered_address,
        required(locations[1]).entered_address,
      );
      await assert.rejects(
        db
          .updateTable('service_request')
          .set({ participation_area_id: b })
          .where('id', '=', r.id)
          .execute(),
      );
      await assert.rejects(
        db
          .updateTable('service_request')
          .set({ requester_id: randomUUID() })
          .where('id', '=', r.id)
          .execute(),
      );
      await assert.rejects(
        db.deleteFrom('participation_area').where('id', '=', a).execute(),
      );
    },
  );
  await t.test(
    'F051 trusted Requester can select different areas without profile/history exposure',
    async () => {
      const trusted = developmentRequesterContext(
        {
          NODE_ENV: 'test',
          CITYVUE_DEPLOYMENT_PROFILE: 'development',
          F050_ENABLE_SYNTHETIC: 'true',
        },
        org,
        'fictional-participation-test',
      );
      const first = await create.executeTrusted(
        { ...input, participation: { state: 'PROVIDED', areaId: a } },
        trusted,
        date,
      );
      trustedId = first.id;
      const second = await create.executeTrusted(
        { ...input, participation: { state: 'PROVIDED', areaId: b } },
        trusted,
        date,
      );
      const rows = await db
        .selectFrom('service_request')
        .select(['requester_id', 'participation_area_id'])
        .where('id', 'in', [first.id, second.id])
        .execute();
      assert.equal(
        required(rows[0]).requester_id,
        required(rows[1]).requester_id,
      );
      assert.notEqual(
        required(rows[0]).participation_area_id,
        required(rows[1]).participation_area_id,
      );
      const body = await app
        .get(RequesterHistoryService)
        .read(first.id, access);
      assert.equal(body.total, 2);
      assert.ok(!JSON.stringify(body).includes('participation'));
      const entity = await db
        .selectFrom('requester')
        .selectAll()
        .where('id', '=', required(required(rows[0]).requester_id))
        .executeTakeFirstOrThrow();
      assert.deepEqual(Object.keys(entity).sort(), [
        'created_at',
        'id',
        'identity_source',
        'identity_subject',
        'organization_id',
      ]);
    },
  );
  await t.test(
    'F051 SQL constraints prohibit contradictory/cross-Organization geography and historical changes',
    async () => {
      const row = await db
        .selectFrom('service_request')
        .selectAll()
        .where('id', '=', anonymousId)
        .executeTakeFirstOrThrow();
      for (const patch of [
        { requester_geography_state: 'PROVIDED', participation_area_id: null },
        { requester_geography_state: 'DECLINED', participation_area_id: a },
        { requester_geography_state: 'wrong', participation_area_id: null },
        { participation_area_id: other },
        { audience: 'internal' },
      ])
        await assert.rejects(
          sql`insert into service_request select * from jsonb_populate_record(null::service_request,${JSON.stringify({ ...row, id: randomUUID(), reference_number: randomUUID(), ...patch })}::jsonb)`.execute(
            db,
          ),
        );
      await assert.rejects(db.transaction().execute(down));
    },
  );
  await t.test(
    'F051 aggregates only independent PUBLIC scope; zeros, positive small cells and secondary buckets',
    async () => {
      // Isolated historical period: A starts with 2 and B with 2.
      for (let i = 0; i < 4; i++)
        await create.execute(
          { ...input, participation: { state: 'PROVIDED', areaId: a } },
          date,
        );
      await create.execute(
        { ...input, participation: { state: 'PROVIDED', areaId: b } },
        date,
      );
      for (let i = 0; i < 5; i++)
        await create.execute(
          { ...input, participation: { state: 'DECLINED' } },
          date,
        );
      await create.execute(input, date);
      for (let i = 0; i < 2; i++) {
        const hidden = await create.execute(
          { ...input, participation: { state: 'PROVIDED', areaId: b } },
          date,
        );
        await db
          .updateTable('service_request')
          .set({
            routed_department_id: c.targetDepartment,
            routed_division_id: null,
          })
          .where('id', '=', hidden.id)
          .execute();
      }
      await sql`update service_request set created_at='2020-01-15T12:00:00Z' where id not in (${sql.join(original.map((x) => x.id))})`.execute(
        db,
      );
      const body = await analytics.read(access, ...period);
      assert.equal(required(body.areas.find((x) => x.areaId === a)).count, 6);
      assert.deepEqual(
        body.areas.find((x) => x.areaId === b),
        {
          areaId: b,
          label: 'Fictional Participation Sentinel 1',
          suppressed: true,
          count: null,
        },
      );
      assert.equal(
        required(body.areas.find((x) => x.areaId === zero)).count,
        0,
      );
      assert.deepEqual(body.declined, { suppressed: false, count: 5 });
      assert.deepEqual(body.notCollected, { suppressed: true, count: null });
      assert.deepEqual(Object.keys(body).sort(), [
        'areas',
        'declined',
        'notCollected',
        'period',
        'suppressionThreshold',
      ]);
      for (const prohibited of [
        'requesterId',
        'referenceNumber',
        'contact',
        'location',
        'tracking',
        'total',
        'percentage',
        'description',
      ])
        assert.ok(!JSON.stringify(body).includes(prohibited));
      const empty = await analytics.read(
        { ...access, departmentIds: [] },
        ...period,
      );
      assert.ok(empty.areas.every((x) => x.count === 0));
      const gained = await analytics.read(
        { ...access, departmentIds: [c.department, c.targetDepartment] },
        ...period,
      );
      assert.equal(required(gained.areas.find((x) => x.areaId === b)).count, 5);
      const plan = await staffRequestReadScope(db, access, 'public')
        .select([
          'request.requester_geography_state',
          'request.participation_area_id',
          sql<number>`count(*)::integer`.as('count'),
        ])
        .where(
          sql<boolean>`request.created_at >= ${new Date('2020-01-01T00:00:00Z')} and request.created_at < ${new Date('2020-03-01T00:00:00Z')}`,
        )
        .groupBy([
          'request.requester_geography_state',
          'request.participation_area_id',
        ])
        .explain('json', sql`analyze, buffers`);
      const nodes: string[] = [];
      const visit = (value: unknown): void => {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
          if (key === 'Node Type' && typeof child === 'string')
            nodes.push(child);
          else visit(child);
        }
      };
      visit(plan);
      assert.ok(nodes.includes('Aggregate'));
      t.diagnostic(
        `F051 scoped aggregate EXPLAIN ANALYZE node types: ${nodes.join(', ')}`,
      );
      const foreignBody = await analytics.read(
        { ...access, organizationId: foreign, staffIdentityId: c.otherStaff },
        ...period,
      );
      assert.equal(foreignBody.areas.length, 1);
      assert.equal(required(foreignBody.areas[0]).count, 0);
    },
  );
  await t.test(
    'F051 permission alone grants no PUBLIC scope and request/geospatial permission grants no analytics',
    async () => {
      for (const permissions of [
        [],
        ['service_request.view'],
        ['geospatial.read'],
        ['analytics.service_participation.read'],
      ])
        await assert.rejects(
          analytics.read(
            {
              ...access,
              permissions: permissions as StaffAccess['permissions'],
            },
            ...period,
          ),
        );
      await request(api).get(path).expect(401);
      const denied = await request(api)
        .get(path)
        .set('Authorization', `Bearer ${c.publicOnly}`)
        .expect(403);
      assert.equal(denied.headers['cache-control'], 'no-store');
      const role = (
        await db
          .selectFrom('staff_role_assignment')
          .select('role_id')
          .where('staff_identity_id', '=', c.publicOnly)
          .executeTakeFirstOrThrow()
      ).role_id;
      await db
        .insertInto('role_permission')
        .values({
          organization_id: org,
          role_id: role,
          permission_key: 'analytics.service_participation.read',
        })
        .execute();
      await request(api)
        .get(path)
        .set('Authorization', `Bearer ${c.publicOnly}`)
        .expect(200);
      for (const suffix of [
        '&status=open',
        '&areaId=' + a,
        '&organizationId=' + foreign,
      ])
        await request(api)
          .get(path + suffix)
          .set('Authorization', `Bearer ${c.publicOnly}`)
          .expect(400);
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', role)
        .where('permission_key', '=', 'analytics.service_participation.read')
        .execute();
      await request(api)
        .get(path)
        .set('Authorization', `Bearer ${c.publicOnly}`)
        .expect(403);
    },
  );
  await t.test(
    'F051 reads only append minimal audit; audit failure prevents disclosure',
    async () => {
      const before = await snapshot();
      await analytics.read(access, ...period);
      assert.deepEqual(await snapshot(), before);
      const audit = await db
        .selectFrom('service_participation_audit')
        .selectAll()
        .executeTakeFirstOrThrow();
      assert.deepEqual(Object.keys(audit).sort(), [
        'action',
        'correlation_id',
        'created_at',
        'end_date',
        'id',
        'organization_id',
        'staff_identity_id',
        'start_date',
        'threshold',
      ]);
      await assert.rejects(
        db.deleteFrom('service_participation_audit').execute(),
      );
      await sql`create function fail_participation_audit() returns trigger language plpgsql as $$ begin raise exception 'test audit unavailable'; end $$; create trigger fail_participation before insert on service_participation_audit for each row execute function fail_participation_audit()`.execute(
        db,
      );
      try {
        await assert.rejects(analytics.read(access, ...period));
      } finally {
        await sql`drop trigger fail_participation on service_participation_audit; drop function fail_participation_audit()`.execute(
          db,
        );
      }
    },
  );
  await t.test(
    'F051 evidence metadata never supplies geography; retries preserve inactive original area and rollback failures',
    async () => {
      const attachments = app.get(AttachmentService),
        savedStorage = attachments.storage,
        enabled = attachments.policy().enabled;
      const blobs = new Map<string, Buffer>();
      const storage: AttachmentStorage = {
        async write(org, key, bytes) {
          blobs.set(org + key, bytes);
        },
        async read(org, key) {
          const bytes = blobs.get(org + key);
          if (!bytes) throw Error('Missing fixture');
          return bytes;
        },
        async stream(org, key) {
          return Readable.from(await this.read(org, key));
        },
        async remove(org, key) {
          blobs.delete(org + key);
        },
      };
      Object.defineProperty(attachments, 'enabled', {
        value: true,
        configurable: true,
      });
      Object.defineProperty(attachments, 'storage', {
        value: storage,
        configurable: true,
      });
      try {
        const claim = await attachments.startPublic(
          input.serviceDefinitionId,
          input.serviceDefinitionVersionId,
        );
        const image = await sharp({
          create: { width: 12, height: 8, channels: 3, background: '#123456' },
        })
          .withExif({
            IFD0: { Make: 'FICTIONAL_CAMERA' },
            IFD3: {
              GPSLatitudeRef: 'N',
              GPSLatitude: '0/1 0/1 0/1',
              GPSLongitudeRef: 'E',
              GPSLongitude: '0/1 0/1 0/1',
            },
          })
          .jpeg()
          .toBuffer();
        assert.ok((await sharp(image).metadata()).exif);
        await attachments.upload(claim, randomUUID(), {
          buffer: image,
          originalname: 'fictional.jpg',
          mimetype: 'image/jpeg',
        });
        for (const bytes of blobs.values())
          assert.equal((await sharp(bytes).metadata()).exif, undefined);
        const submission = {
          ...input,
          attachments: claim,
          participation: { state: 'PROVIDED' as const, areaId: a },
        };
        const results = await Promise.all([
          create.execute(submission),
          create.execute(submission),
        ]);
        assert.deepEqual(results[0], results[1]);
        await db
          .updateTable('participation_area')
          .set({ active: false, display_name: 'Fictional Renamed Area' })
          .where('id', '=', a)
          .execute();
        const before = await snapshot();
        assert.deepEqual(await create.execute(submission), results[0]);
        assert.deepEqual(await snapshot(), before);
        await assert.rejects(
          create.execute({
            ...input,
            participation: { state: 'PROVIDED', areaId: a },
          }),
        );
        await assert.rejects(
          create.execute({
            ...submission,
            participation: { state: 'PROVIDED', areaId: b },
          }),
        );
        const row = await db
          .selectFrom('service_request')
          .select(['requester_id', 'participation_area_id'])
          .where('id', '=', required(results[0]).id)
          .executeTakeFirstOrThrow();
        assert.equal(row.requester_id, null);
        assert.equal(row.participation_area_id, a);
        const claim2 = await attachments.startPublic(
          input.serviceDefinitionId,
          input.serviceDefinitionVersionId,
        );
        await attachments.upload(claim2, randomUUID(), {
          buffer: image,
          originalname: 'fictional.jpg',
          mimetype: 'image/jpeg',
        });
        const noSelection = await create.execute({
          ...input,
          attachments: claim2,
        });
        assert.equal(
          (
            await db
              .selectFrom('service_request')
              .select('requester_geography_state')
              .where('id', '=', noSelection.id)
              .executeTakeFirstOrThrow()
          ).requester_geography_state,
          'NOT_COLLECTED',
        );
        await sql`create function fail_participation_creation() returns trigger language plpgsql as $$ begin raise exception 'test unavailable'; end $$; create trigger fail_participation_creation before insert on activity for each row execute function fail_participation_creation()`.execute(
          db,
        );
        const beforeFailure = await snapshot();
        try {
          await assert.rejects(
            create.execute({
              ...input,
              participation: { state: 'PROVIDED', areaId: b },
            }),
          );
          assert.deepEqual(await snapshot(), beforeFailure);
        } finally {
          await sql`drop trigger fail_participation_creation on activity; drop function fail_participation_creation()`.execute(
            db,
          );
        }
      } finally {
        Object.defineProperty(attachments, 'enabled', {
          value: enabled,
          configurable: true,
        });
        Object.defineProperty(attachments, 'storage', {
          value: savedStorage,
          configurable: true,
        });
      }
    },
  );
  await t.test(
    'F051 assisted anonymous participation preserves staff attribution and declined stays unlinked',
    async () => {
      const anonymous = { ...input, reportingIdentity: 'anonymous' };
      delete anonymous.contact;
      for (const participation of [
        { state: 'PROVIDED', areaId: b },
        { state: 'DECLINED' },
      ]) {
        const response = await request(api)
          .post('/api/v1/staff/service-requests')
          .set('Authorization', `Bearer ${c.creator}`)
          .send({
            ...anonymous,
            audience: 'public',
            intakeChannel: 'phone',
            participation,
          })
          .expect(201);
        const id = (response.body as { id: string }).id;
        const row = await db
          .selectFrom('service_request')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        assert.equal(row.submitted_by_staff_identity_id, c.creator);
        assert.equal(row.reporting_identity, 'anonymous');
        assert.equal(row.requester_id, null);
        assert.equal(row.requester_geography_state, participation.state);
        assert.equal(row.participation_area_id, participation.areaId ?? null);
        assert.equal(
          (
            await db
              .selectFrom('requester_contact')
              .select('id')
              .where('service_request_id', '=', id)
              .execute()
          ).length,
          0,
        );
      }
    },
  );
  await t.test(
    'F051 ordinary detail/history/search omit geography and original records remain unchanged',
    async () => {
      const detail = await request(api)
        .get(`/api/v1/staff/service-requests/${trustedId}`)
        .set('Authorization', `Bearer ${c.creator}`)
        .expect(200);
      assert.ok(!JSON.stringify(detail.body).includes('participation'));
      assert.ok(
        !JSON.stringify(detail.body).includes(
          'Fictional Participation Sentinel',
        ),
      );
      const list = await request(api)
        .get(
          '/api/v1/staff/service-requests?audience=public&q=Fictional%20Participation%20Sentinel',
        )
        .set('Authorization', `Bearer ${c.creator}`)
        .expect(200);
      assert.equal((list.body as { total: number }).total, 0);
      const rows = await db
        .selectFrom('service_request')
        .selectAll()
        .where(
          'id',
          'in',
          original.map((x) => x.id),
        )
        .orderBy('id')
        .execute();
      assert.deepEqual(
        rows,
        original.map((x) => ({
          ...x,
          requester_geography_state: 'NOT_COLLECTED',
          participation_area_id: null,
        })),
      );
      assert.ok(
        !c.logs.join('\n').includes('Fictional Participation Sentinel'),
      );
    },
  );
  await t.test(
    'F051 collection disable/incomplete rejects web, assisted and trusted input; normal intake and retained analytics remain independent',
    async () => {
      const beforeRequests = await db
        .selectFrom('service_request')
        .selectAll()
        .orderBy('id')
        .execute();
      const beforeAreas = await db
        .selectFrom('participation_area')
        .selectAll()
        .orderBy('id')
        .execute();
      const beforeGrants = await db
        .selectFrom('role_permission')
        .selectAll()
        .orderBy('role_id')
        .orderBy('permission_key')
        .execute();
      const beforeAnalytics = await analytics.read(access, ...period);
      const anonymous = { ...input, reportingIdentity: 'anonymous' as const };
      delete anonymous.contact;
      await db
        .updateTable('organization')
        .set({ service_participation_collection_enabled: false })
        .where('id', '=', org)
        .execute();
      const catalog = await request(api)
        .get('/api/v1/intake/participation-areas')
        .expect(200);
      assert.deepEqual(catalog.body, { collectionEnabled: false, items: [] });
      assert.deepEqual(
        await analytics.read(access, ...period),
        beforeAnalytics,
      );
      const beforeInvalid = await snapshot();
      for (const participation of [
        { state: 'PROVIDED', areaId: b },
        { state: 'DECLINED' },
      ]) {
        await request(api)
          .post('/api/v1/service-requests')
          .send({ ...anonymous, participation })
          .expect(400);
        await request(api)
          .post('/api/v1/staff/service-requests')
          .set('Authorization', `Bearer ${c.creator}`)
          .send({
            ...anonymous,
            audience: 'public',
            intakeChannel: 'phone',
            participation,
          })
          .expect(400);
        const trusted = developmentRequesterContext(
          {
            NODE_ENV: 'test',
            CITYVUE_DEPLOYMENT_PROFILE: 'development',
            F050_ENABLE_SYNTHETIC: 'true',
          },
          org,
          'fictional-disabled-collection',
        );
        await assert.rejects(
          create.executeTrusted(
            {
              ...input,
              participation: participation as {
                state: 'PROVIDED' | 'DECLINED';
                areaId?: string;
              },
            },
            trusted,
          ),
        );
      }
      assert.deepEqual(await snapshot(), beforeInvalid);
      const skipped = await create.execute(anonymous);
      const skippedRow = await db
        .selectFrom('service_request')
        .selectAll()
        .where('id', '=', skipped.id)
        .executeTakeFirstOrThrow();
      assert.equal(skippedRow.requester_geography_state, 'NOT_COLLECTED');
      assert.equal(skippedRow.participation_area_id, null);
      assert.equal(skippedRow.requester_id, null);
      assert.equal(
        (
          await db
            .selectFrom('requester_contact')
            .select('id')
            .where('service_request_id', '=', skipped.id)
            .execute()
        ).length,
        0,
      );
      await db
        .updateTable('organization')
        .set({ service_participation_collection_enabled: true })
        .where('id', '=', org)
        .execute();
      assert.equal((await analytics.areas(org)).collectionEnabled, true);
      const declined = await create.execute({
        ...anonymous,
        participation: { state: 'DECLINED' },
      });
      assert.equal(
        (
          await db
            .selectFrom('service_request')
            .select('requester_geography_state')
            .where('id', '=', declined.id)
            .executeTakeFirstOrThrow()
        ).requester_geography_state,
        'DECLINED',
      );
      await db
        .updateTable('participation_area')
        .set({ active: false })
        .where('organization_id', '=', org)
        .execute();
      assert.deepEqual(await analytics.areas(org), {
        collectionEnabled: true,
        items: [],
      });
      for (const participation of [
        { state: 'PROVIDED' as const, areaId: b },
        { state: 'DECLINED' as const },
      ])
        await assert.rejects(create.execute({ ...anonymous, participation }));
      const incomplete = await create.execute(anonymous);
      assert.equal(
        (
          await db
            .selectFrom('service_request')
            .select('requester_geography_state')
            .where('id', '=', incomplete.id)
            .executeTakeFirstOrThrow()
        ).requester_geography_state,
        'NOT_COLLECTED',
      );
      for (const area of beforeAreas)
        await db
          .updateTable('participation_area')
          .set({ active: area.active })
          .where('id', '=', area.id)
          .execute();
      assert.deepEqual(
        await db
          .selectFrom('participation_area')
          .selectAll()
          .orderBy('id')
          .execute(),
        beforeAreas,
      );
      assert.deepEqual(
        await db
          .selectFrom('service_request')
          .selectAll()
          .where(
            'id',
            'in',
            beforeRequests.map((x) => x.id),
          )
          .orderBy('id')
          .execute(),
        beforeRequests,
      );
      assert.deepEqual(
        await db
          .selectFrom('service_request')
          .selectAll()
          .where('id', '=', skipped.id)
          .executeTakeFirstOrThrow(),
        skippedRow,
      );
      assert.deepEqual(
        await db
          .selectFrom('role_permission')
          .selectAll()
          .orderBy('role_id')
          .orderBy('permission_key')
          .execute(),
        beforeGrants,
      );
      await assert.rejects(db.transaction().execute(collectionDown));
    },
  );
}
