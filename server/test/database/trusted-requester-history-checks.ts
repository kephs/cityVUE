import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';
import { CreateServiceRequestService } from '../../src/service-request/create-service-request.service.js';
import type { CreateServiceRequestDto } from '../../src/service-request/service-request.dto.js';
import {
  developmentRequesterContext,
  resolveTrustedRequester,
} from '../../src/service-request/trusted-requester.js';
import { RequesterHistoryService } from '../../src/service-request/requester-history.service.js';
import { down } from '../../migrations/20260926000000-add-trusted-requester-history.js';
import { AttachmentService } from '../../src/attachments/attachment.service.js';
import type { AttachmentStorage } from '../../src/attachments/attachment-storage.js';
import { Readable } from 'node:stream';
import sharp from 'sharp';

function required<T>(value: T | undefined): T {
  assert.notEqual(value, undefined);
  if (value === undefined) throw new Error('Missing test fixture');
  return value;
}

export async function checkTrustedRequesterHistory(
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
  const { db, org, app } = c;
  const api = app.getHttpServer() as Server;
  const create = app.get(CreateServiceRequestService);
  const history = new RequesterHistoryService({
    client: db,
  } as DatabaseService);
  const environment = {
    NODE_ENV: 'test',
    CITYVUE_DEPLOYMENT_PROFILE: 'development',
    F050_ENABLE_SYNTHETIC: 'true',
  };
  const trusted = developmentRequesterContext(
    environment,
    org,
    'fictional-concurrency-history',
  );
  const second = developmentRequesterContext(
    environment,
    org,
    'fictional-separate-history',
  );
  const payload = { ...c.publicPayload } as Record<string, unknown>;
  delete payload.audience;
  delete payload.intakeChannel;
  const input = payload as unknown as Pick<
    CreateServiceRequestDto,
    keyof CreateServiceRequestDto
  >;
  const path = (id: string) =>
    `/api/v1/staff/service-requests/${id}/requester-history`;
  const access: StaffAccess = {
    organizationId: org,
    staffIdentityId: c.creator,
    tenantId: randomUUID(),
    objectId: randomUUID(),
    permissions: ['service_request.view'],
    departmentIds: [c.department],
    divisionIds: [],
    development: false,
    displayName: 'Fictional staff',
    scopes: ['access_as_user'],
  };
  const original = await db
    .selectFrom('service_request')
    .selectAll()
    .orderBy('id')
    .execute();
  const originalContacts = await db
    .selectFrom('requester_contact')
    .selectAll()
    .orderBy('id')
    .execute();
  const tracking = await db
    .selectFrom('request_tracking_credential')
    .select(['id', 'status'])
    .orderBy('id')
    .execute();
  let ids: string[] = [],
    requesterId = '';

  await t.test(
    'F050 concurrent first trusted requests resolve one identity despite different Contact',
    async () => {
      const receipts = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          create.executeTrusted(
            {
              ...input,
              contact: {
                name: `Fictional Contact ${String(i)}`,
                email: `fictional-${String(i)}@example.test`,
              },
            },
            trusted,
          ),
        ),
      );
      ids = receipts.map((row) => row.id);
      const identities = await db
        .selectFrom('requester')
        .selectAll()
        .where('organization_id', '=', org)
        .execute();
      assert.equal(identities.length, 1);
      requesterId = required(identities[0]).id;
      assert.notEqual(requesterId, trusted.subject);
      const rows = await db
        .selectFrom('service_request')
        .selectAll()
        .where('id', 'in', ids)
        .execute();
      assert.equal(rows.length, 5);
      assert.ok(
        rows.every(
          (row) =>
            row.requester_id === requesterId &&
            row.audience === 'public' &&
            row.reporting_identity === 'identified',
        ),
      );
      assert.equal(new Set(rows.map((row) => row.reference_number)).size, 5);
      assert.ok(
        receipts.every(
          (row) =>
            Object.keys(row).sort().join(',') ===
            'createdAt,id,referenceNumber,status',
        ),
      );
      assert.equal(
        await db
          .transaction()
          .execute((trx) => resolveTrustedRequester(trx, trusted)),
        requesterId,
      );
    },
  );
  await t.test(
    'F050 independent simultaneous first resolutions use unique identity without relying on request reference locks',
    async () => {
      const racing = developmentRequesterContext(
        environment,
        org,
        'fictional-direct-resolution-race',
      );
      const resolved = await Promise.all(
        Array.from({ length: 8 }, () =>
          db
            .transaction()
            .execute((trx) => resolveTrustedRequester(trx, racing)),
        ),
      );
      assert.equal(new Set(resolved).size, 1);
      const rows = await db
        .selectFrom('requester')
        .select('id')
        .where('organization_id', '=', org)
        .where('identity_source', '=', racing.source)
        .where('identity_subject', '=', racing.subject)
        .execute();
      assert.equal(rows.length, 1);
      assert.equal(required(rows[0]).id, resolved[0]);
    },
  );
  await t.test(
    'F050 same Contact under different trusted subjects does not merge; ordinary intake remains unlinked',
    async () => {
      const sharedContact = {
        name: 'Fictional Contact 0',
        email: 'fictional-0@example.test',
      };
      const one = await create.executeTrusted(
        { ...input, contact: sharedContact },
        second,
      );
      const two = await create.execute(input);
      const rows = await db
        .selectFrom('service_request')
        .select(['id', 'requester_id'])
        .where('id', 'in', [one.id, two.id])
        .execute();
      assert.notEqual(
        required(rows.find((row) => row.id === one.id)).requester_id,
        requesterId,
      );
      assert.equal(
        required(rows.find((row) => row.id === two.id)).requester_id,
        null,
      );
      const shared = await db
        .selectFrom('requester_contact')
        .select(['name', 'email'])
        .where('service_request_id', 'in', [required(ids[0]), one.id])
        .execute();
      assert.equal(shared.length, 2);
      assert.ok(
        shared.every(
          (row) =>
            row.name === sharedContact.name &&
            row.email === sharedContact.email,
        ),
      );
      await request(api)
        .get(path(two.id))
        .set('Authorization', `Bearer ${c.creator}`)
        .expect(404);
      const detail = await request(api)
        .get(`/api/v1/staff/service-requests/${two.id}`)
        .set('Authorization', `Bearer ${c.creator}`)
        .expect(200);
      assert.equal(
        (detail.body as { canReadRequesterHistory: boolean })
          .canReadRequesterHistory,
        false,
      );
    },
  );
  await t.test(
    'F050 browser identity claims rejected on public and assisted paths; forged in-process context denied',
    async () => {
      for (const extra of [
        { requesterId },
        { identitySource: 'DEVELOPMENT_SYNTHETIC' },
        { identitySubject: trusted.subject },
        { trustedRequester: trusted },
      ]) {
        await request(api)
          .post('/api/v1/service-requests')
          .send({ ...input, ...extra })
          .expect(400);
        await request(api)
          .post('/api/v1/staff/service-requests')
          .set('Authorization', `Bearer ${c.creator}`)
          .send({ ...c.publicPayload, ...extra })
          .expect(400);
      }
      await assert.rejects(create.executeTrusted(input, { ...trusted }));
      const anonymous = { ...input, reportingIdentity: 'anonymous' };
      delete anonymous.contact;
      await assert.rejects(create.executeTrusted(anonymous, trusted));
    },
  );
  await t.test(
    'F050 SQL rejects anonymous, INTERNAL, cross-Organization and missing requester links; existing null links immutable',
    async () => {
      const template = await db
        .selectFrom('service_request')
        .selectAll()
        .where('id', '=', required(ids[0]))
        .executeTakeFirstOrThrow();
      const otherOrg = await db
        .selectFrom('staff_identity')
        .select('organization_id')
        .where('id', '=', c.otherStaff)
        .executeTakeFirstOrThrow();
      const foreignContext = developmentRequesterContext(
        environment,
        otherOrg.organization_id,
        trusted.subject,
      );
      const foreignId = await db
        .transaction()
        .execute((trx) => resolveTrustedRequester(trx, foreignContext));
      assert.notEqual(foreignId, requesterId);
      for (const patch of [
        { reporting_identity: 'anonymous' },
        {
          audience: 'internal',
          intake_channel: 'staff',
          submitted_by_staff_identity_id: c.creator,
          requester_staff_identity_id: c.creator,
        },
        { requester_id: foreignId },
        { requester_id: randomUUID() },
      ])
        await assert.rejects(
          db
            .insertInto('service_request')
            .values({
              ...template,
              id: randomUUID(),
              reference_number: `TEST-${randomUUID()}`,
              ...patch,
            })
            .execute(),
        );
      for (const requester_id of [null, foreignId])
        await assert.rejects(
          db
            .updateTable('service_request')
            .set({ requester_id })
            .where('id', '=', required(ids[0]))
            .execute(),
        );
      await assert.rejects(
        db
          .updateTable('service_request')
          .set({ requester_id: requesterId })
          .where('id', '=', required(original[0]).id)
          .execute(),
      );
      await assert.rejects(
        db
          .updateTable('requester')
          .set({ identity_subject: 'fictional-changed' })
          .where('id', '=', requesterId)
          .execute(),
      );
      await assert.rejects(
        db.deleteFrom('requester').where('id', '=', requesterId).execute(),
      );
      await assert.rejects(db.transaction().execute(down));
    },
  );
  await t.test(
    'F050 5 linked requests / 3 authorized: rows, counts and categories exclude inaccessible records before aggregation',
    async () => {
      await db
        .updateTable('service_request')
        .set({
          routed_department_id: c.targetDepartment,
          routed_division_id: null,
        })
        .where('id', 'in', ids.slice(3))
        .execute();
      const result = await history.read(required(ids[0]), access, 1, 2);
      assert.equal(result.total, 3);
      assert.equal(result.items.length, 2);
      assert.equal(result.hasNextPage, true);
      assert.equal(
        result.categories.reduce((sum, row) => sum + row.count, 0),
        3,
      );
      assert.ok(
        result.items.every((row) =>
          ids.slice(0, 3).includes(row.serviceRequestId),
        ),
      );
      const secondPage = await history.read(required(ids[0]), access, 2, 2);
      assert.equal(secondPage.items.length, 1);
      const combined = [...result.items, ...secondPage.items];
      assert.equal(
        new Set(combined.map((row) => row.serviceRequestId)).size,
        3,
      );
      assert.equal(combined.filter((row) => row.current).length, 1);
      for (const row of combined)
        assert.deepEqual(Object.keys(row).sort(), [
          'createdAt',
          'current',
          'issueName',
          'referenceNumber',
          'serviceRequestId',
          'status',
        ]);
      const text = JSON.stringify(result);
      for (const hidden of [
        ...ids.slice(3),
        trusted.subject,
        requesterId,
        'fictional-0@example.test',
        'identity_source',
        'credential',
        'attachments',
        'description',
      ])
        assert.equal(text.includes(hidden), false);
      const emptyPage = await history.read(required(ids[0]), access, 9, 2);
      assert.equal(emptyPage.items.length, 0);
      assert.equal(emptyPage.total, 3);
    },
  );
  await t.test(
    'F050 authorization gain/revocation changes projection without changing links; stable tie-break',
    async () => {
      const before = await db
        .selectFrom('service_request')
        .select(['id', 'requester_id'])
        .where('id', 'in', ids)
        .orderBy('id')
        .execute();
      const expanded = {
        ...access,
        departmentIds: [c.department, c.targetDepartment],
      };
      assert.equal((await history.read(required(ids[0]), expanded)).total, 5);
      assert.equal((await history.read(required(ids[0]), access)).total, 3);
      await assert.rejects(history.read(required(ids[3]), access));
      await assert.rejects(
        history.read(required(ids[0]), { ...access, permissions: [] }),
      );
      await assert.rejects(
        history.read(required(ids[0]), { ...access, departmentIds: [] }),
      );
      await sql`update service_request set created_at='2026-01-01T00:00:00Z' where id in (${sql.join(ids.slice(0, 3))})`.execute(
        db,
      );
      assert.deepEqual(
        (await history.read(required(ids[0]), access)).items.map(
          (row) => row.serviceRequestId,
        ),
        ids.slice(0, 3).sort().reverse(),
      );
      assert.deepEqual(
        await db
          .selectFrom('service_request')
          .select(['id', 'requester_id'])
          .where('id', 'in', ids)
          .orderBy('id')
          .execute(),
        before,
      );
    },
  );
  await t.test(
    'F050 authenticated HTTP current-parent admission, strict pagination/query and no-store denial',
    async () => {
      for (const suffix of [
        '',
        '?page=0',
        '?page=1.5',
        '?pageSize=101',
        '?pageSize=0',
        '?requesterId=' + requesterId,
        '?identitySubject=forged',
      ]) {
        const response = await request(api)
          .get(path(required(ids[0])) + suffix)
          .set('Authorization', `Bearer ${c.publicOnly}`)
          .expect(suffix ? 400 : 200);
        assert.equal(response.headers['cache-control'], 'no-store');
      }
      await request(api)
        .get(path(required(ids[0])))
        .expect(401);
      await request(api)
        .get(path(required(ids[0])))
        .set('Authorization', `Bearer ${c.otherStaff}`)
        .expect(404);
      for (const id of [randomUUID(), requesterId, 'invalid'])
        await request(api)
          .get(path(id))
          .set('Authorization', `Bearer ${c.creator}`)
          .expect(404);
      for (const row of original
        .filter(
          (row) =>
            row.audience === 'internal' ||
            row.reporting_identity === 'anonymous',
        )
        .slice(0, 4))
        await request(api)
          .get(path(row.id))
          .set('Authorization', `Bearer ${c.creator}`)
          .expect(404);
      const response = await request(api)
        .get(`/api/v1/staff/service-requests/${required(ids[0])}`)
        .set('Authorization', `Bearer ${c.publicOnly}`)
        .expect(200);
      assert.equal(
        (response.body as { canReadRequesterHistory: boolean })
          .canReadRequesterHistory,
        true,
      );
      assert.equal('requester_id' in (response.body as object), false);
      await request(api)
        .get(
          `/api/v1/staff/public-service-requests/${required(ids[0])}/contact`,
        )
        .set('Authorization', `Bearer ${c.publicOnly}`)
        .expect(403);
    },
  );
  await t.test(
    'F050 history changes only minimal audit; no Contact audit, parent mutation or protected-domain retrieval',
    async () => {
      const parent = await db
        .selectFrom('service_request')
        .selectAll()
        .where('id', 'in', ids)
        .orderBy('id')
        .execute();
      const audits = await db
        .selectFrom('activity')
        .selectAll()
        .orderBy('id')
        .execute();
      await history.read(required(ids[0]), access);
      assert.deepEqual(
        await db.selectFrom('activity').selectAll().orderBy('id').execute(),
        audits,
      );
      assert.deepEqual(
        await db
          .selectFrom('service_request')
          .selectAll()
          .where('id', 'in', ids)
          .orderBy('id')
          .execute(),
        parent,
      );
      const audit = await db
        .selectFrom('requester_history_audit')
        .selectAll()
        .orderBy('created_at', 'desc')
        .executeTakeFirstOrThrow();
      assert.deepEqual(Object.keys(audit).sort(), [
        'action',
        'correlation_id',
        'created_at',
        'id',
        'organization_id',
        'service_request_id',
        'staff_identity_id',
      ]);
      assert.equal(audit.action, 'history_viewed');
      assert.equal(JSON.stringify(audit).includes(trusted.subject), false);
      await assert.rejects(
        db
          .deleteFrom('requester_history_audit')
          .where('id', '=', audit.id)
          .execute(),
      );
    },
  );
  await t.test(
    'F050 required audit failure prevents disclosure and does not mutate parent',
    async () => {
      await sql`create function reject_f050_audit() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end $$;
      create trigger fail_f050_audit before insert on requester_history_audit for each row execute function reject_f050_audit();`.execute(
        db,
      );
      try {
        await assert.rejects(history.read(required(ids[0]), access));
        const response = await request(api)
          .get(path(required(ids[0])))
          .set('Authorization', `Bearer ${c.creator}`)
          .expect(500);
        assert.equal(
          JSON.stringify(response.body).includes(trusted.subject),
          false,
        );
        assert.equal('items' in (response.body as object), false);
      } finally {
        await sql`drop trigger fail_f050_audit on requester_history_audit; drop function reject_f050_audit();`.execute(
          db,
        );
      }
    },
  );
  await t.test(
    'F050 trusted evidence retries serialize to one original receipt; context substitution fails without duplicate side effects',
    async () => {
      const attachments = app.get(AttachmentService);
      const savedStorage = attachments.storage,
        enabled = attachments.policy().enabled;
      const blobs = new Map<string, Buffer>();
      const storage: AttachmentStorage = {
        async write(org, key, bytes) {
          blobs.set(org + key, bytes);
        },
        async read(org, key) {
          const value = blobs.get(org + key);
          if (!value) throw new Error('Missing test image');
          return value;
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
          create: { width: 4, height: 4, channels: 3, background: '#345678' },
        })
          .png()
          .toBuffer();
        await attachments.upload(claim, randomUUID(), {
          buffer: image,
          originalname: 'fictional.png',
          mimetype: 'image/png',
        });
        const submission = { ...input, attachments: claim };
        const results = await Promise.all([
          create.executeTrusted(submission, trusted),
          create.executeTrusted(submission, trusted),
        ]);
        assert.deepEqual(results[0], results[1]);
        const createdId = required(results[0]).id;
        const snapshot = async () => ({
          requesters: await db
            .selectFrom('requester')
            .selectAll()
            .orderBy('id')
            .execute(),
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
          assignments: await db
            .selectFrom('service_request_assignment')
            .selectAll()
            .orderBy('id')
            .execute(),
          activity: await db
            .selectFrom('activity')
            .selectAll()
            .orderBy('id')
            .execute(),
          operational: await db
            .selectFrom('request_operational_activity')
            .selectAll()
            .orderBy('id')
            .execute(),
          attachments: await db
            .selectFrom('attachment')
            .selectAll()
            .orderBy('id')
            .execute(),
          reference: await db
            .selectFrom('service_request_reference_sequence')
            .selectAll()
            .execute(),
        });
        await db
          .updateTable('service_request')
          .set({ status: 'in_progress' })
          .where('id', '=', createdId)
          .execute();
        const before = await snapshot();
        assert.deepEqual(
          await create.executeTrusted(submission, trusted),
          results[0],
        );
        await assert.rejects(create.executeTrusted(submission, second));
        await assert.rejects(create.execute(submission));
        assert.deepEqual(await snapshot(), before);
        assert.equal(
          required(before.requests.find((row) => row.id === createdId))
            .requester_id,
          requesterId,
        );
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
    'F050 required creation audit failure rolls back newly resolved identity and all request writes',
    async () => {
      const failed = developmentRequesterContext(
        environment,
        org,
        'fictional-failure-rollback',
      );
      const before = await db
        .selectFrom('requester')
        .selectAll()
        .orderBy('id')
        .execute();
      const requests = await db
        .selectFrom('service_request')
        .selectAll()
        .orderBy('id')
        .execute();
      await sql`create function reject_f050_creation() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end $$;
      create trigger fail_f050_creation before insert on activity for each row execute function reject_f050_creation();`.execute(
        db,
      );
      try {
        await assert.rejects(create.executeTrusted(input, failed));
      } finally {
        await sql`drop trigger fail_f050_creation on activity; drop function reject_f050_creation();`.execute(
          db,
        );
      }
      assert.deepEqual(
        await db.selectFrom('requester').selectAll().orderBy('id').execute(),
        before,
      );
      assert.deepEqual(
        await db
          .selectFrom('service_request')
          .selectAll()
          .orderBy('id')
          .execute(),
        requests,
      );
    },
  );
  await t.test(
    'F050 preserves original requests/Contact/tracking and keeps provider subject/payload out of logs',
    async () => {
      assert.deepEqual(
        await db
          .selectFrom('service_request')
          .selectAll()
          .where(
            'id',
            'in',
            original.map((row) => row.id),
          )
          .orderBy('id')
          .execute(),
        original,
      );
      assert.deepEqual(
        await db
          .selectFrom('requester_contact')
          .selectAll()
          .where(
            'id',
            'in',
            originalContacts.map((row) => row.id),
          )
          .orderBy('id')
          .execute(),
        originalContacts,
      );
      assert.deepEqual(
        await db
          .selectFrom('request_tracking_credential')
          .select(['id', 'status'])
          .orderBy('id')
          .execute(),
        tracking,
      );
      for (const forbidden of [
        trusted.subject,
        second.subject,
        'fictional-0@example.test',
        '"categories"',
        '"identitySubject"',
      ])
        assert.equal(c.logs.join('').includes(forbidden), false);
    },
  );
}
