import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import {
  configureRequesterPolicy,
  inspectRequesterPolicy,
  type RequesterIdentityPolicy,
} from '../../src/service-request/requester-identity-policy.js';
import { down } from '../../migrations/20260925000000-add-requester-identity-policy.js';

export async function checkRequesterIdentityPolicy(
  t: TestContext,
  c: {
    app: INestApplication;
    db: Kysely<DatabaseSchema>;
    org: string;
    creator: string;
    publicPayload: object;
    internalPayload: object;
    logs: string[];
  },
) {
  const { db, org, creator } = c,
    api = c.app.getHttpServer() as Server;
  const assisted = c.publicPayload as Record<string, unknown>,
    issue = assisted.serviceDefinitionId as string;
  const publicPayload = { ...assisted };
  delete publicPayload.audience;
  delete publicPayload.intakeChannel;
  const anonymous = {
    ...publicPayload,
    reportingIdentity: 'anonymous',
    contact: undefined,
  };
  const current = () => inspectRequesterPolicy(db, org, issue);
  const set = async (policy: RequesterIdentityPolicy) =>
    db.transaction().execute(async (trx) =>
      configureRequesterPolicy(trx, org, issue, creator, {
        policy,
        expectedRevision: (await inspectRequesterPolicy(trx, org, issue))
          .revision,
      }),
    );
  const rows = () =>
    db.selectFrom('service_request').selectAll().orderBy('id').execute();
  const configSnapshot = () =>
    db
      .selectFrom('issue_default_assignment')
      .selectAll()
      .orderBy('service_definition_id')
      .execute();
  const original = await rows(),
    defaults = await configSnapshot();
  let anonymousId = '';

  await t.test(
    'F049 configuration validates two policies, Organization, revision, no-op and read-only dry run',
    async () => {
      const before = await current();
      for (const policy of ['IDENTIFIED_OPTIONAL', 'allowed', 'invalid'])
        await assert.rejects(
          db.transaction().execute((trx) =>
            configureRequesterPolicy(trx, org, issue, creator, {
              policy: policy as RequesterIdentityPolicy,
              expectedRevision: before.revision,
            }),
          ),
        );
      await assert.rejects(
        db.transaction().execute((trx) =>
          configureRequesterPolicy(trx, randomUUID(), issue, creator, {
            policy: 'IDENTIFIED_REQUIRED',
            expectedRevision: 0,
          }),
        ),
      );
      await assert.rejects(
        db.transaction().execute((trx) =>
          configureRequesterPolicy(trx, org, issue, creator, {
            policy: 'IDENTIFIED_REQUIRED',
            expectedRevision: before.revision + 1,
          }),
        ),
      );
      await db.transaction().execute(async (trx) => {
        await sql`set transaction read only`.execute(trx);
        await configureRequesterPolicy(
          trx,
          org,
          issue,
          creator,
          { policy: 'IDENTIFIED_REQUIRED', expectedRevision: before.revision },
          true,
        );
      });
      assert.deepEqual(await current(), before);
      assert.equal((await set(before.policy)).changed, false);
      assert.deepEqual(await rows(), original);
      assert.deepEqual(await configSnapshot(), defaults);
    },
  );
  await t.test(
    'F049 allowed policy still requires explicit identity; anonymous rejects Contact and identified requires name',
    async () => {
      await set('ANONYMOUS_ALLOWED');
      const before = await rows();
      for (const body of [
        { ...anonymous, reportingIdentity: undefined },
        { ...anonymous, contact: { name: 'Forbidden Contact' } },
        { ...anonymous, contact: {} },
        { ...publicPayload, contact: undefined },
        { ...publicPayload, contact: { name: ' ' } },
        { ...anonymous, reportingIdentity: 'IDENTIFIED_OPTIONAL' },
      ])
        await request(api)
          .post('/api/v1/service-requests')
          .send(body)
          .expect(400);
      assert.deepEqual(await rows(), before);
      const result = await request(api)
        .post('/api/v1/service-requests')
        .send(anonymous)
        .expect(201);
      anonymousId = (result.body as { id: string }).id;
      const row = await db
        .selectFrom('service_request')
        .selectAll()
        .where('id', '=', anonymousId)
        .executeTakeFirstOrThrow();
      assert.equal(row.reporting_identity, 'anonymous');
      assert.equal(row.submitted_by_staff_identity_id, null);
      assert.equal(
        (
          await db
            .selectFrom('requester_contact')
            .selectAll()
            .where('service_request_id', '=', anonymousId)
            .execute()
        ).length,
        0,
      );
      const detail = await request(api)
        .get(`/api/v1/staff/service-requests/${anonymousId}`)
        .set('Authorization', `Bearer ${creator}`)
        .expect(200);
      const value = detail.body as {
        requesterIdentity: string;
        canReadContact: boolean;
        capabilities: { canCreateCommunication: boolean };
      };
      assert.equal(value.requesterIdentity, 'anonymous');
      assert.equal(value.canReadContact, false);
      assert.equal(value.capabilities.canCreateCommunication, false);
    },
  );
  await t.test(
    'F049 PUBLIC assisted anonymous channels retain staff submitter and INTERNAL forbids anonymity',
    async () => {
      for (const intakeChannel of ['web', 'phone', 'walk_in', 'staff', 'api']) {
        const result = await request(api)
          .post('/api/v1/staff/service-requests')
          .set('Authorization', `Bearer ${creator}`)
          .send({
            ...assisted,
            intakeChannel,
            reportingIdentity: 'anonymous',
            contact: undefined,
          })
          .expect(201);
        const row = await db
          .selectFrom('service_request')
          .selectAll()
          .where('id', '=', (result.body as { id: string }).id)
          .executeTakeFirstOrThrow();
        assert.equal(row.reporting_identity, 'anonymous');
        assert.equal(row.submitted_by_staff_identity_id, creator);
      }
      await request(api)
        .post('/api/v1/staff/service-requests')
        .set('Authorization', `Bearer ${creator}`)
        .send({ ...c.internalPayload, reportingIdentity: 'anonymous' })
        .expect(400);
    },
  );
  await t.test(
    'F049 required policy applies to future PUBLIC requests while INTERNAL staff attribution remains independent',
    async () => {
      const before = await rows();
      await set('IDENTIFIED_REQUIRED');
      await request(api)
        .post('/api/v1/service-requests')
        .send(anonymous)
        .expect(400);
      await request(api)
        .post('/api/v1/staff/service-requests')
        .set('Authorization', `Bearer ${creator}`)
        .send({
          ...assisted,
          reportingIdentity: 'anonymous',
          contact: undefined,
        })
        .expect(400);
      assert.deepEqual(await rows(), before);
      await request(api)
        .post('/api/v1/service-requests')
        .send({ ...publicPayload, contact: { name: 'F049 Fictional Name' } })
        .expect(201);
      await request(api)
        .post('/api/v1/staff/service-requests')
        .set('Authorization', `Bearer ${creator}`)
        .send(c.internalPayload)
        .expect(201);
      const row = await db
        .selectFrom('service_request')
        .select('reporting_identity')
        .where('id', '=', anonymousId)
        .executeTakeFirstOrThrow();
      assert.equal(row.reporting_identity, 'anonymous');
    },
  );
  await t.test(
    'F049 database blocks identity rewriting and anonymous Contact; preserves all historical parents and F048 configuration',
    async () => {
      await assert.rejects(
        db
          .updateTable('service_request')
          .set({ reporting_identity: 'identified' })
          .where('id', '=', anonymousId)
          .execute(),
      );
      await assert.rejects(
        db
          .insertInto('requester_contact')
          .values({
            id: randomUUID(),
            organization_id: org,
            service_request_id: anonymousId,
            name: 'Forbidden Contact',
            email: null,
          })
          .execute(),
      );
      assert.deepEqual(
        (await rows()).filter((row) =>
          original.some((old) => old.id === row.id),
        ),
        original,
      );
      assert.deepEqual(await configSnapshot(), defaults);
    },
  );
  await t.test(
    'F049 anonymous Contact has no audit and new correspondence is denied even with independent permissions',
    async () => {
      const role = await db
        .selectFrom('staff_role_assignment')
        .select('role_id')
        .where('staff_identity_id', '=', creator)
        .where('active', '=', true)
        .executeTakeFirstOrThrow();
      await db
        .insertInto('role_permission')
        .values(
          [
            'service_request.contact.read',
            'service_request.communication.read',
            'service_request.communication.create',
          ].map((permission_key) => ({
            organization_id: org,
            role_id: role.role_id,
            permission_key,
          })),
        )
        .onConflict((oc) => oc.doNothing())
        .execute();
      const before = await db
        .selectFrom('activity')
        .selectAll()
        .where('service_request_id', '=', anonymousId)
        .execute();
      await request(api)
        .get(`/api/v1/staff/public-service-requests/${anonymousId}/contact`)
        .set('Authorization', `Bearer ${creator}`)
        .expect(404);
      await request(api)
        .post(`/api/v1/staff/service-requests/${anonymousId}/communications`)
        .set('Authorization', `Bearer ${creator}`)
        .set('Idempotency-Key', randomUUID())
        .send({ body: 'F049 prohibited correspondence' })
        .expect(403);
      assert.deepEqual(
        await db
          .selectFrom('activity')
          .selectAll()
          .where('service_request_id', '=', anonymousId)
          .execute(),
        before,
      );
      const list = await request(api)
        .get(`/api/v1/staff/service-requests/${anonymousId}/communications`)
        .set('Authorization', `Bearer ${creator}`)
        .expect(200);
      assert.deepEqual((list.body as { items: unknown[] }).items, []);
      const details = await request(api)
        .get(`/api/v1/staff/service-requests/${anonymousId}`)
        .set('Authorization', `Bearer ${creator}`)
        .expect(200);
      assert.equal(
        (details.body as { canReadContact: boolean }).canReadContact,
        false,
      );
    },
  );
  await t.test(
    'F049 concurrent policy changes use revision CAS and safe audit; meaningful rollback refuses loss',
    async () => {
      const before = await current();
      const parentsBefore = await rows();
      const results = await Promise.allSettled(
        [1, 2].map(() =>
          db.transaction().execute((trx) =>
            configureRequesterPolicy(trx, org, issue, creator, {
              policy: 'ANONYMOUS_ALLOWED',
              expectedRevision: before.revision,
            }),
          ),
        ),
      );
      assert.equal(
        results.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      assert.equal(
        results.filter((result) => result.status === 'rejected').length,
        1,
      );
      assert.deepEqual(await rows(), parentsBefore);
      await assert.rejects(db.transaction().execute(down));
      const events = await db
        .selectFrom('issue_requester_identity_audit')
        .selectAll()
        .where('organization_id', '=', org)
        .execute();
      assert.ok(events.length >= 2);
      for (const event of events)
        assert.deepEqual(
          Object.keys(event).sort(),
          [
            'id',
            'organization_id',
            'service_definition_id',
            'staff_identity_id',
            'revision',
            'prior_policy',
            'policy',
            'occurred_at',
          ].sort(),
        );
      for (const text of c.logs)
        assert.ok(
          !text.includes('Forbidden Contact') &&
            !text.includes('F049 Fictional Name'),
        );
    },
  );
  await t.test(
    'F049 required policy audit failure rolls configuration back without changing requests',
    async () => {
      const before = await current(),
        parents = await rows();
      await sql`create function reject_f049_audit() returns trigger language plpgsql as $$ begin raise exception 'Disposable audit failure'; end $$; create trigger reject_f049_audit before insert on issue_requester_identity_audit for each row execute function reject_f049_audit()`.execute(
        db,
      );
      try {
        await assert.rejects(set('IDENTIFIED_REQUIRED'));
      } finally {
        await sql`drop trigger reject_f049_audit on issue_requester_identity_audit; drop function reject_f049_audit()`.execute(
          db,
        );
      }
      assert.deepEqual(await current(), before);
      assert.deepEqual(await rows(), parents);
    },
  );
  await t.test(
    'F049 creation racing a policy change is coherent and denied creation writes nothing',
    async () => {
      const before = await rows();
      const [, response] = await Promise.all([
        set('IDENTIFIED_REQUIRED'),
        request(api).post('/api/v1/service-requests').send(anonymous),
      ]);
      assert.ok([201, 400].includes(response.status));
      const after = await rows(),
        added = after.filter((row) => !before.some((old) => old.id === row.id));
      assert.equal(added.length, response.status === 201 ? 1 : 0);
      for (const row of added)
        assert.equal(row.reporting_identity, 'anonymous');
      assert.deepEqual(
        after.filter((row) => before.some((old) => old.id === row.id)),
        before,
      );
      await request(api)
        .post('/api/v1/service-requests')
        .send(anonymous)
        .expect(400);
      await set('ANONYMOUS_ALLOWED');
      assert.deepEqual(await rows(), after);
    },
  );
  await t.test(
    'F049 preserves authorized reads of historical anonymous correspondence',
    async () => {
      // Disposable legacy fixture: direct seed represents a pre-F049 record, not a new supported operation.
      const communicationId = randomUUID();
      await db
        .insertInto('request_communication')
        .values({
          id: communicationId,
          organization_id: org,
          service_request_id: anonymousId,
          author_staff_identity_id: creator,
          author_display_name: 'Fictional Staff',
          submission_key: randomUUID(),
          body: 'Retained historical correspondence',
          created_at: new Date('2026-01-01T00:00:00Z'),
        })
        .execute();
      const before = await db
        .selectFrom('request_communication')
        .selectAll()
        .where('id', '=', communicationId)
        .execute();
      const response = await request(api)
        .get(`/api/v1/staff/service-requests/${anonymousId}/communications`)
        .set('Authorization', `Bearer ${creator}`)
        .expect(200);
      assert.equal(
        (response.body as { items: { id: string }[] }).items[0]?.id,
        communicationId,
      );
      assert.deepEqual(
        await db
          .selectFrom('request_communication')
          .selectAll()
          .where('id', '=', communicationId)
          .execute(),
        before,
      );
    },
  );
}
