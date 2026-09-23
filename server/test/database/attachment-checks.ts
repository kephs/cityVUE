import { configureIssueDefault } from '../../src/service-request/issue-default-assignment.js';
import type { Server } from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import sharp from 'sharp';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import {
  up,
  down,
} from '../../migrations/20260923000000-add-secure-attachments.js';
import {
  AttachmentService,
  type AttachmentClaim,
} from '../../src/attachments/attachment.service.js';
import { RequestTrackingRepository } from '../../src/service-request/request-tracking.repository.js';
import { checksum } from '../../src/attachments/attachment.domain.js';
import { LocalAttachmentStorage } from '../../src/attachments/attachment-storage.js';

export async function checkAttachments(
  t: TestContext,
  c: {
    app: INestApplication;
    db: Kysely<DatabaseSchema>;
    org: string;
    creator: string;
    department: string;
    otherInternal: string;
    publicPayload: object;
    internalPayload: object;
    logs: string[];
  },
) {
  const { app, db, org } = c,
    api = app.getHttpServer() as Server,
    root = '/api/v1/staff/service-requests',
    uploads = '/api/v1/staff/attachments',
    intake = '/api/v1/intake/attachments';
  const service = app.get(AttachmentService),
    directory = await mkdtemp(join(tmpdir(), 'reqro-f046-db-'));
  const storage = new LocalAttachmentStorage(directory);
  Object.defineProperty(service, 'storage', {
    value: storage,
    configurable: true,
  });
  const beforeTracking = await db
    .selectFrom('request_tracking_credential')
    .select(['status', sql<number>`count(*)::int`.as('count')])
    .groupBy('status')
    .orderBy('status')
    .execute();
  const actor = async (keys: string[], departments = [c.department]) => {
    const id = randomUUID(),
      role = randomUUID();
    const tenant = (
      await db
        .selectFrom('staff_identity')
        .select('entra_tenant_id')
        .where('id', '=', c.creator)
        .executeTakeFirstOrThrow()
    ).entra_tenant_id;
    await db
      .insertInto('staff_identity')
      .values({
        id,
        organization_id: org,
        entra_tenant_id: tenant,
        entra_object_id: id,
        display_name: 'F046 Fictional Staff',
        email: null,
        active: true,
      })
      .execute();
    await db
      .insertInto('role')
      .values({
        id: role,
        organization_id: org,
        name: `F046 ${id}`,
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
  const allKeys = [
    'service_request.view',
    'service_request.internal.read',
    'service_request.note.read',
    'service_request.note.create',
    'service_request.communication.read',
    'service_request.communication.create',
  ];
  const full = await actor(allKeys),
    parentOnly = await actor(['service_request.view']),
    noScope = await actor(allKeys, []);
  const staffGet = (path: string, id = full.id) =>
    request(api).get(path).set('Authorization', `Bearer ${id}`);
  const png = await sharp({
    create: { width: 24, height: 16, channels: 3, background: '#345678' },
  })
    .withMetadata({ orientation: 6 })
    .withExifMerge({ IFD0: { Make: 'F046_PRIVATE_FILENAME_MARKER' } })
    .png()
    .toBuffer();
  const filename = 'F046_PRIVATE_FILENAME_MARKER.png';
  const claimOnly = (value: AttachmentClaim) => ({
    batchId: value.batchId,
    token: value.token,
  });
  const start = async (requestId: string, context: string, id = full.id) =>
    claimOnly(
      (
        await request(api)
          .post(`${uploads}/requests/${requestId}/batches`)
          .set('Authorization', `Bearer ${id}`)
          .send({ context })
          .expect(201)
      ).body as AttachmentClaim,
    );
  const upload = (
    claim: AttachmentClaim,
    id: string,
    bytes = png,
    name = filename,
    staff = true,
  ) => {
    const call = request(api)
      .post(`${staff ? uploads : intake}/batches/${claim.batchId}/files/${id}`)
      .set('X-Reqro-Attachment', claim.token);
    if (staff) call.set('Authorization', `Bearer ${full.id}`);
    return call.attach('file', bytes, {
      filename: name,
      contentType: 'image/png',
    });
  };
  const save = (
    requestId: string,
    domain: string,
    claim: AttachmentClaim | undefined,
    key = randomUUID(),
    id = full.id,
  ) =>
    request(api)
      .post(`${root}/${requestId}/${domain}`)
      .set('Authorization', `Bearer ${id}`)
      .set('Idempotency-Key', key)
      .send({
        body: 'F046 fictional collaboration',
        ...(claim ? { attachments: claim } : {}),
      });
  try {
    await t.test(
      'F046 migration apply/rollback/reapply preserves existing data and grants',
      async () => {
        const count = await db
          .selectFrom('role_permission')
          .select(sql<string>`count(*)`.as('n'))
          .executeTakeFirstOrThrow();
        await db.transaction().execute(up);
        await db.transaction().execute(down);
        await db.transaction().execute(up);
        assert.deepEqual(
          await db
            .selectFrom('role_permission')
            .select(sql<string>`count(*)`.as('n'))
            .executeTakeFirstOrThrow(),
          count,
        );
      },
    );
    Object.defineProperty(service, 'enabled', {
      value: true,
      configurable: true,
    });
    const parent = (
      await request(api)
        .post(root)
        .set('Authorization', `Bearer ${c.creator}`)
        .send(c.publicPayload)
        .expect(201)
    ).body as { id: string };
    const internal = (
      await request(api)
        .post(root)
        .set('Authorization', `Bearer ${c.creator}`)
        .send(c.internalPayload)
        .expect(201)
    ).body as { id: string };
    const trackingParents = [parent.id];
    const parentSnapshot = JSON.stringify(
      await db
        .selectFrom('service_request')
        .selectAll()
        .where('id', '=', parent.id)
        .execute(),
    );
    for (const [context, domain, read, create] of [
      [
        'INTERNAL_NOTE',
        'notes',
        'service_request.note.read',
        'service_request.note.create',
      ],
      [
        'REQUESTER_COMMUNICATION',
        'communications',
        'service_request.communication.read',
        'service_request.communication.create',
      ],
    ] as const) {
      let claim: AttachmentClaim = { batchId: '', token: '' },
        fileId = '',
        parentId = '';
      await t.test(
        `F046 ${context} ready file, protected stage preview and atomic parent finalization`,
        async () => {
          claim = await start(parent.id, context);
          fileId = randomUUID();
          const staged = await upload(claim, fileId).expect(201);
          assert.equal((staged.body as { state: string }).state, 'CLEAN');
          assert.ok(!JSON.stringify(staged.body).includes('storage_key'));
          const preview = await staffGet(
            `${uploads}/batches/${claim.batchId}/files/${fileId}`,
          )
            .set('X-Reqro-Attachment', claim.token)
            .expect(200);
          assert.ok(!(await sharp(preview.body as Buffer).metadata()).exif);
          const key = randomUUID(),
            results = await Promise.all([
              save(parent.id, domain, claim, key),
              save(parent.id, domain, claim, key),
            ]);
          assert.ok(results.every((x) => x.status === 201));
          const [first, second] = results.map(
            (x) => x.body as { id: string; attachments: { id: string }[] },
          );
          assert.ok(first && second);
          assert.equal(first.id, second.id);
          parentId = first.id;
          assert.equal(first.attachments[0]?.id, fileId);
          await save(parent.id, domain, undefined, key).expect(409);
          await request(api)
            .delete(`${uploads}/batches/${claim.batchId}/files/${fileId}`)
            .set('Authorization', `Bearer ${full.id}`)
            .set('X-Reqro-Attachment', claim.token)
            .expect(404);
        },
      );
      await t.test(
        `F046 ${context} authorization matrix, parent scope, unknown and cross-context denial`,
        async () => {
          const path = `${uploads}/requests/${parent.id}/${context}/${parentId}/files/${fileId}`;
          const download = await staffGet(path)
            .expect(200)
            .expect('Cache-Control', 'private, no-store')
            .expect('X-Content-Type-Options', 'nosniff');
          assert.match(
            String(download.headers['content-disposition']),
            /^attachment; filename="[a-zA-Z0-9._ -]+"$/,
          );
          assert.equal(
            Number(download.headers['content-length']),
            (download.body as Buffer).length,
          );
          await request(api).get(path).expect(401);
          await staffGet(path, parentOnly.id).expect(403);
          await staffGet(path, noScope.id).expect(404);
          await staffGet(path.replace(parent.id, c.otherInternal)).expect(404);
          await staffGet(path.replace(fileId, randomUUID())).expect(404);
          await staffGet(
            path.replace(
              context,
              context === 'INTERNAL_NOTE'
                ? 'REQUESTER_COMMUNICATION'
                : 'INTERNAL_NOTE',
            ),
          ).expect(404);
          for (const [keys, readStatus, createStatus] of [
            [[], 403, 403],
            [[read, create], 403, 403],
            [['service_request.view'], 403, 403],
            [['service_request.view', read], 200, 403],
            [['service_request.view', create], 403, 403],
            [['service_request.view', read, create], 200, 201],
          ] as [string[], number, number][]) {
            const caller = await actor(keys);
            await staffGet(path, caller.id).expect(readStatus);
            // Body-only create verifies inherited F041/F042 semantics without unnecessary stored objects.
            await save(
              parent.id,
              domain,
              undefined,
              randomUUID(),
              caller.id,
            ).expect(createStatus);
          }
          const readOnly = await actor(['service_request.view', read]);
          await request(api)
            .post(`${uploads}/requests/${parent.id}/batches`)
            .set('Authorization', `Bearer ${readOnly.id}`)
            .send({ context })
            .expect(403);
          const wrongDomain =
            context === 'INTERNAL_NOTE' ? 'communications' : 'notes';
          await save(parent.id, wrongDomain, claim).expect(404);
          await save(internal.id, domain, claim).expect(404);
          const search = await staffGet(
            `${root}?q=${encodeURIComponent(filename)}`,
          ).expect(200);
          assert.equal(
            (search.body as { total: number }).total,
            0,
            'F047 must not match protected attachment filenames',
          );
          assert.ok(
            !JSON.stringify(
              (await staffGet(`${root}/${parent.id}`).expect(200)).body,
            ).includes(filename),
          );
        },
      );
      await t.test(
        `F046 ${context} immutable association and missing object fail safely`,
        async () => {
          await assert.rejects(
            db
              .updateTable('attachment_batch')
              .set({ service_request_id: internal.id })
              .where('id', '=', claim.batchId)
              .execute(),
          );
          await assert.rejects(
            db.deleteFrom('attachment').where('id', '=', fileId).execute(),
          );
          await assert.rejects(
            db
              .updateTable('attachment')
              .set({ filename: 'changed.png' })
              .where('id', '=', fileId)
              .execute(),
          );
          const row = await db
            .selectFrom('attachment')
            .selectAll()
            .where('id', '=', fileId)
            .executeTakeFirstOrThrow();
          const bytes = await storage.read(org, row.storage_key);
          await storage.remove(org, row.storage_key);
          await staffGet(
            `${uploads}/requests/${parent.id}/${context}/${parentId}/files/${fileId}`,
          ).expect(404);
          await storage.write(org, row.storage_key, bytes);
        },
      );
    }
    await t.test(
      'F046 PUBLIC-only Communications and independent staff evidence permissions',
      async () => {
        await request(api)
          .post(`${uploads}/requests/${internal.id}/batches`)
          .set('Authorization', `Bearer ${full.id}`)
          .send({ context: 'REQUESTER_COMMUNICATION' })
          .expect(404);
        await request(api)
          .post(`${uploads}/requests/${parent.id}/batches`)
          .set('Authorization', `Bearer ${full.id}`)
          .send({ context: 'REQUEST_EVIDENCE' })
          .expect(400);
        await staffGet(
          `${uploads}/requests/${parent.id}/evidence`,
          parentOnly.id,
        ).expect(200);
      },
    );
    await t.test(
      'F046 request evidence binds Issue, retries exactly once and excludes tracking metadata',
      async () => {
        const payload = { ...c.publicPayload } as Record<string, unknown>;
        delete payload.audience;
        delete payload.intakeChannel;
        const claim = claimOnly(
          (
            await request(api)
              .post(`${intake}/batches`)
              .send({
                issueId: payload.serviceDefinitionId,
                versionId: payload.serviceDefinitionVersionId,
              })
              .expect(201)
          ).body as AttachmentClaim,
        );
        const issueId = payload.serviceDefinitionId as string;
        const teams = [randomUUID(), randomUUID()] as const;
        for (const [index, teamId] of teams.entries())
          await db
            .insertInto('work_group')
            .values({
              id: teamId,
              organization_id: org,
              department_id: c.department,
              division_id: null,
              name: `F048 Retry Team ${String(index)}`,
              description: 'Disposable',
              active: true,
            })
            .execute();
        await db.transaction().execute((trx) =>
          configureIssueDefault(trx, org, issueId, c.creator, {
            expectedRevision: 0,
            target: { type: 'group', id: teams[0] },
          }),
        );
        const id = randomUUID();
        await upload(claim, id, png, filename, false).expect(201);
        const result = await request(api)
          .post('/api/v1/service-requests')
          .send({ ...payload, attachments: claim })
          .expect(201);
        const requestId = (result.body as { id: string }).id;
        trackingParents.push(requestId);
        const assignmentsBefore = await db
          .selectFrom('service_request_assignment')
          .selectAll()
          .where('service_request_id', '=', requestId)
          .execute();
        const eventsBefore = await db
          .selectFrom('request_operational_activity')
          .selectAll()
          .where('service_request_id', '=', requestId)
          .orderBy('id')
          .execute();
        assert.equal(assignmentsBefore.length, 1);
        assert.equal(assignmentsBefore[0]?.work_group_id, teams[0]);
        await db.transaction().execute((trx) =>
          configureIssueDefault(trx, org, issueId, c.creator, {
            expectedRevision: 1,
            target: { type: 'group', id: teams[1] },
          }),
        );
        // Disposable fixture only: retry must not become an alternative status lookup.
        await db
          .updateTable('service_request')
          .set({ status: 'in_progress' })
          .where('id', '=', requestId)
          .execute();
        const retry = await request(api)
          .post('/api/v1/service-requests')
          .send({ ...payload, attachments: claim })
          .expect(201);
        assert.equal((retry.body as { id: string }).id, requestId);
        assert.deepEqual(retry.body, result.body);
        for (const concurrent of await Promise.all(
          [1, 2].map(() =>
            request(api)
              .post('/api/v1/service-requests')
              .send({ ...payload, attachments: claim })
              .expect(201),
          ),
        ))
          assert.deepEqual(concurrent.body, result.body);
        assert.deepEqual(
          await db
            .selectFrom('service_request_assignment')
            .selectAll()
            .where('service_request_id', '=', requestId)
            .execute(),
          assignmentsBefore,
        );
        assert.deepEqual(
          await db
            .selectFrom('request_operational_activity')
            .selectAll()
            .where('service_request_id', '=', requestId)
            .orderBy('id')
            .execute(),
          eventsBefore,
        );
        const manager = await actor([
          'service_request.view',
          'service_request.assign',
        ]);
        await request(api)
          .post(`${root}/${requestId}/assignment`)
          .set('Authorization', `Bearer ${manager.id}`)
          .send({
            expectedRevision: 2,
            targetType: 'group',
            targetId: teams[1],
          })
          .expect(200);
        const manuallyChanged = await db
          .selectFrom('service_request_assignment')
          .selectAll()
          .where('service_request_id', '=', requestId)
          .orderBy('id')
          .execute();
        const manualHistory = await db
          .selectFrom('request_operational_activity')
          .selectAll()
          .where('service_request_id', '=', requestId)
          .orderBy('id')
          .execute();
        const manualRetry = await request(api)
          .post('/api/v1/service-requests')
          .send({ ...payload, attachments: claim })
          .expect(201);
        assert.deepEqual(manualRetry.body, result.body);
        assert.deepEqual(
          await db
            .selectFrom('service_request_assignment')
            .selectAll()
            .where('service_request_id', '=', requestId)
            .orderBy('id')
            .execute(),
          manuallyChanged,
        );
        assert.deepEqual(
          await db
            .selectFrom('request_operational_activity')
            .selectAll()
            .where('service_request_id', '=', requestId)
            .orderBy('id')
            .execute(),
          manualHistory,
        );
        const next = await request(api)
          .post('/api/v1/service-requests')
          .send(payload)
          .expect(201);
        assert.equal(
          (
            await db
              .selectFrom('service_request_assignment')
              .select('work_group_id')
              .where(
                'service_request_id',
                '=',
                (next.body as { id: string }).id,
              )
              .executeTakeFirstOrThrow()
          ).work_group_id,
          teams[1],
        );
        await db.transaction().execute((trx) =>
          configureIssueDefault(trx, org, issueId, c.creator, {
            expectedRevision: 2,
            target: null,
          }),
        );
        assert.equal(
          (
            await db
              .selectFrom('service_request')
              .select('status')
              .where('id', '=', requestId)
              .executeTakeFirstOrThrow()
          ).status,
          'in_progress',
        );
        await request(api)
          .post('/api/v1/service-requests')
          .send({ ...payload, description: 'Changed', attachments: claim })
          .expect(409);
        const list = await staffGet(
          `${uploads}/requests/${requestId}/evidence`,
          parentOnly.id,
        ).expect(200);
        assert.equal(
          (list.body as { items: { id: string }[] }).items[0]?.id,
          id,
        );
        await staffGet(
          `${uploads}/requests/${requestId}/REQUEST_EVIDENCE/${requestId}/files/${id}`,
          parentOnly.id,
        ).expect(200);
        await save(parent.id, 'notes', claim).expect(404);
        await save(parent.id, 'communications', claim).expect(404);
        await request(api)
          .get(`${intake}/batches/${claim.batchId}/files/${id}`)
          .set('X-Reqro-Attachment', claim.token)
          .expect(404);
        assert.deepEqual(Object.keys(result.body).sort(), [
          'createdAt',
          'id',
          'referenceNumber',
          'status',
        ]);
      },
    );
    await t.test(
      'F046 upload admission rejects no capability, forged origin and invalid content without parent changes',
      async () => {
        await upload(
          { batchId: randomUUID(), token: 'x'.repeat(43) },
          randomUUID(),
        ).expect(404);
        await request(api)
          .post(`${intake}/batches`)
          .set('Origin', 'https://invalid.example')
          .send({ issueId: randomUUID(), versionId: randomUUID() })
          .expect(403);
        const claim = await start(parent.id, 'INTERNAL_NOTE');
        const before = await db.selectFrom('attachment').select('id').execute();
        await upload(
          claim,
          randomUUID(),
          Buffer.from('Harmless invalid content'),
        ).expect(400);
        assert.deepEqual(
          await db.selectFrom('attachment').select('id').execute(),
          before,
        );
        await save(parent.id, 'notes', claim).expect(409);
      },
    );
    await t.test(
      'F046 scan, storage, required audit and parent failures preserve atomicity',
      async () => {
        const claim = await start(parent.id, 'INTERNAL_NOTE'),
          id = randomUUID(),
          scanner = service.scanner;
        Object.defineProperty(service, 'scanner', {
          value: { scan: async () => 'REJECTED' },
          configurable: true,
        });
        await upload(claim, id).expect(400);
        Object.defineProperty(service, 'scanner', {
          value: scanner,
          configurable: true,
        });
        const write = storage.write.bind(storage);
        storage.write = async () => {
          throw new Error('FICTIONAL_STORAGE_PRIVATE_PATH');
        };
        await upload(claim, id).expect(500);
        storage.write = write;
        assert.equal(
          (
            await db
              .selectFrom('attachment')
              .select('id')
              .where('id', '=', id)
              .execute()
          ).length,
          0,
        );
        await upload(claim, id).expect(201);
        const before = await db
          .selectFrom('request_internal_note')
          .select('id')
          .execute();
        await sql`create function f046_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end $$; create trigger f046_failure before insert on attachment_audit for each row execute function f046_fail_audit();`.execute(
          db,
        );
        await save(parent.id, 'notes', claim).expect(500);
        assert.deepEqual(
          await db.selectFrom('request_internal_note').select('id').execute(),
          before,
        );
        assert.equal(
          (
            await db
              .selectFrom('attachment_batch')
              .select('state')
              .where('id', '=', claim.batchId)
              .executeTakeFirstOrThrow()
          ).state,
          'STAGED',
        );
        await sql`drop trigger f046_failure on attachment_audit; drop function f046_fail_audit();`.execute(
          db,
        );
        await save(parent.id, 'notes', claim).expect(201);
      },
    );
    await t.test(
      'F046 server upload bounds, concurrent idempotent upload and pending/rejected denial',
      async () => {
        const claim = await start(parent.id, 'INTERNAL_NOTE'),
          id = randomUUID();
        const results = await Promise.all([
          upload(claim, id),
          upload(claim, id),
        ]);
        assert.ok(results.every((x) => x.status === 201));
        assert.equal(
          (
            await db
              .selectFrom('attachment')
              .select('id')
              .where('batch_id', '=', claim.batchId)
              .execute()
          ).length,
          1,
        );
        await upload(claim, randomUUID(), Buffer.alloc(5242881)).expect(413);
        for (let i = 0; i < 4; i++)
          await upload(claim, randomUUID()).expect(201);
        await upload(claim, randomUUID()).expect(400);
        const pendingClaim = await start(parent.id, 'INTERNAL_NOTE');
        const template = await db
          .selectFrom('attachment')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        const pendingId = randomUUID();
        await db
          .insertInto('attachment')
          .values({
            ...template,
            id: pendingId,
            batch_id: pendingClaim.batchId,
            storage_key: randomUUID(),
            scan_state: 'PENDING_SCAN',
          })
          .execute();
        await staffGet(
          `${uploads}/batches/${pendingClaim.batchId}/files/${pendingId}`,
        )
          .set('X-Reqro-Attachment', pendingClaim.token)
          .expect(404);
        await save(parent.id, 'notes', pendingClaim).expect(409);
        await db
          .updateTable('attachment')
          .set({ scan_state: 'REJECTED' })
          .where('id', '=', pendingId)
          .execute();
        await staffGet(
          `${uploads}/batches/${pendingClaim.batchId}/files/${pendingId}`,
        )
          .set('X-Reqro-Attachment', pendingClaim.token)
          .expect(404);
        await assert.rejects(
          db
            .insertInto('attachment')
            .values({
              ...template,
              id: randomUUID(),
              batch_id: pendingClaim.batchId,
              storage_key: randomUUID(),
              context: 'REQUESTER_COMMUNICATION',
            })
            .execute(),
        );
        const wrongOrg = (
          await db
            .selectFrom('service_request')
            .select('organization_id')
            .where('id', '=', c.otherInternal)
            .executeTakeFirstOrThrow()
        ).organization_id;
        await assert.rejects(
          db
            .insertInto('attachment')
            .values({
              ...template,
              id: randomUUID(),
              batch_id: pendingClaim.batchId,
              storage_key: randomUUID(),
              organization_id: wrongOrg,
            })
            .execute(),
        );
      },
    );
    await t.test(
      'F046 metadata/audit failure compensates storage and missing staged bytes prevent parent creation',
      async () => {
        const claim = await start(parent.id, 'INTERNAL_NOTE'),
          id = randomUUID();
        const beforeObjects = (await storage.inventory()).length;
        await sql`create function f046_fail_file_update() returns trigger language plpgsql as $$ begin raise exception 'synthetic metadata failure'; end $$; create trigger f046_file_failure before update on attachment for each row execute function f046_fail_file_update();`.execute(
          db,
        );
        await upload(claim, id).expect(500);
        assert.equal((await storage.inventory()).length, beforeObjects);
        await sql`drop trigger f046_file_failure on attachment; drop function f046_fail_file_update();`.execute(
          db,
        );
        await upload(claim, id).expect(201);
        const row = await db
          .selectFrom('attachment')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        await storage.remove(org, row.storage_key);
        const before = await db
          .selectFrom('request_internal_note')
          .select('id')
          .execute();
        await save(parent.id, 'notes', claim).expect(500);
        assert.deepEqual(
          await db.selectFrom('request_internal_note').select('id').execute(),
          before,
        );
      },
    );
    await t.test(
      'F046 current parent-domain revocation and required download audit fail closed',
      async () => {
        const batch = await db
          .selectFrom('attachment_batch')
          .selectAll()
          .where('state', '=', 'FINALIZED')
          .where('context', '=', 'INTERNAL_NOTE')
          .executeTakeFirstOrThrow();
        const file = await db
          .selectFrom('attachment')
          .selectAll()
          .where('batch_id', '=', batch.id)
          .executeTakeFirstOrThrow();
        assert.ok(batch.note_id);
        const path = `${uploads}/requests/${parent.id}/INTERNAL_NOTE/${batch.note_id}/files/${file.id}`;
        await db
          .deleteFrom('role_permission')
          .where('role_id', '=', full.role)
          .where('permission_key', '=', 'service_request.note.read')
          .execute();
        await staffGet(path).expect(403);
        await db
          .insertInto('role_permission')
          .values({
            organization_id: org,
            role_id: full.role,
            permission_key: 'service_request.note.read',
          })
          .execute();
        await sql`create function f046_fail_download_audit() returns trigger language plpgsql as $$ begin raise exception 'synthetic audit failure'; end $$; create trigger f046_download_failure before insert on attachment_audit for each row execute function f046_fail_download_audit();`.execute(
          db,
        );
        const denied = await staffGet(path).expect(500);
        assert.equal(
          String(denied.headers['content-type']).includes('application/json'),
          true,
        );
        await sql`drop trigger f046_download_failure on attachment_audit; drop function f046_fail_download_audit();`.execute(
          db,
        );
        await staffGet(path).expect(200);
      },
    );
    await t.test(
      'F046 staging cleanup expires abandoned batches and safely removes orphans',
      async () => {
        const claim = await start(parent.id, 'INTERNAL_NOTE');
        await upload(claim, randomUUID()).expect(201);
        const cleanup = await service.cleanup(new Date(Date.now() + 7200000));
        assert.ok(cleanup.expiredBatches > 0);
        assert.ok(cleanup.orphansRemoved > 0);
        await upload(claim, randomUUID()).expect(404);
        assert.equal(
          (
            await db
              .selectFrom('attachment_batch')
              .select('id')
              .where('state', '=', 'STAGED')
              .execute()
          ).length,
          0,
        );
      },
    );
    await t.test(
      'F046 tracking projection excludes populated evidence, Note and Communication attachments',
      async () => {
        // Disposable test schema only; the synthetic resolver row always rolls back.
        // No personal development credential is read, generated or exercised.
        const rollback = new Error('Rollback synthetic projection fixture');
        for (const requestId of trackingParents) {
          await assert.rejects(
            db.transaction().execute(async (trx) => {
              const digest = checksum(randomUUID());
              await trx
                .insertInto('request_tracking_credential')
                .values({
                  organization_id: org,
                  service_request_id: requestId,
                  credential_digest: digest,
                  status: 'active',
                  created_by_staff_identity_id: full.id,
                  revoked_at: null,
                })
                .execute();
              const projected = await new RequestTrackingRepository().resolve(
                trx,
                digest,
              );
              assert.ok(projected);
              assert.deepEqual(Object.keys(projected).sort(), [
                'description',
                'issue',
                'reference',
                'serviceLocation',
                'status',
                'submittedAt',
              ]);
              assert.deepEqual(Object.keys(projected.issue).sort(), [
                'icon',
                'name',
              ]);
              assert.ok(!JSON.stringify(projected).includes(filename));
              throw rollback;
            }),
            (error) => error === rollback,
          );
        }
      },
    );
    await t.test(
      'F046 append-only attachments leave parent request and F044 state unchanged; audit/logs exclude private values',
      async () => {
        assert.equal(
          JSON.stringify(
            await db
              .selectFrom('service_request')
              .selectAll()
              .where('id', '=', parent.id)
              .execute(),
          ),
          parentSnapshot,
        );
        assert.deepEqual(
          await db
            .selectFrom('request_tracking_credential')
            .select(['status', sql<number>`count(*)::int`.as('count')])
            .groupBy('status')
            .orderBy('status')
            .execute(),
          beforeTracking,
        );
        const evidence =
          JSON.stringify(
            await db.selectFrom('attachment_audit').selectAll().execute(),
          ) + c.logs.join('\n');
        assert.ok(!evidence.includes(filename));
        assert.ok(!evidence.includes('FICTIONAL_STORAGE_PRIVATE_PATH'));
        assert.ok(!evidence.includes(png.toString('base64')));
        await assert.rejects(db.transaction().execute(down));
      },
    );
  } finally {
    Object.defineProperty(service, 'enabled', {
      value: false,
      configurable: true,
    });
    await rm(directory, { recursive: true, force: true });
  }
}
