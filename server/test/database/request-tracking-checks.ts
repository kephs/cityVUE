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
import {
  up as f065Up,
  down as f065Down,
} from '../../migrations/20261030000000-add-requester-intake-tracking-issuance.js';
import {
  trackingDigest,
  generateTrackingCredential,
} from '../../src/service-request/request-tracking.domain.js';
import { RequestTrackingRepository } from '../../src/service-request/request-tracking.repository.js';

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
    otherOrg: string;
    otherStaff: string;
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

  // ===================================================================
  // F065: the issuer-attribution and expiry schema is applied here, before
  // the F044 management tests, because the application code under test now
  // writes issuer_type and reads expires_at.
  //
  // Only assertions that create no credential are made here. Every F065
  // assertion that inserts a credential is deferred to the end of this
  // suite, because the F044 tests below count rows across the whole table.
  // ===================================================================
  await t.test(
    'F065 migration gives every Organization a bounded lifetime policy and issues no credential',
    async () => {
      const before = await snapshot();
      await db.transaction().execute(f065Up);
      // Parent request data is untouched by this migration.
      assert.deepEqual(await snapshot(), before);
      // Migration issues nothing, which is also what keeps the F044
      // whole-table counts below valid.
      assert.equal(
        (
          await db
            .selectFrom('request_tracking_credential')
            .selectAll()
            .execute()
        ).length,
        0,
      );
      const policies = await db
        .selectFrom('request_tracking_policy')
        .select(['credential_lifetime_days', 'revision'])
        .execute();
      const organizations = await db
        .selectFrom('organization')
        .select('id')
        .execute();
      assert.equal(policies.length, organizations.length);
      for (const policy of policies) {
        assert.equal(policy.credential_lifetime_days, 180);
        assert.equal(policy.revision, 1);
      }
    },
  );
  await t.test(
    'F065 a new Organization is initialized with a valid policy rather than relying on the backfill',
    async () => {
      const fresh = randomUUID();
      await db
        .insertInto('organization')
        .values({
          id: fresh,
          name: 'Fictional F065 organization',
          short_name: 'F065',
          slug: fresh,
          // Inactive, so this fixture cannot be resolved or served anywhere.
          status: 'inactive',
          default_business_timezone: 'Etc/UTC',
        })
        .execute();
      const policy = await db
        .selectFrom('request_tracking_policy')
        .select(['credential_lifetime_days', 'revision'])
        .where('organization_id', '=', fresh)
        .executeTakeFirstOrThrow();
      assert.equal(policy.credential_lifetime_days, 180);
      assert.equal(policy.revision, 1);
    },
  );
  await t.test(
    'F065 the tenant lifetime policy is bounded at 30..365 by the database',
    async () => {
      for (const days of [30, 180, 365])
        await db
          .updateTable('request_tracking_policy')
          .set({ credential_lifetime_days: days })
          .where('organization_id', '=', org)
          .execute();
      for (const refused of [29, 366, 0, -1, 10000])
        await assert.rejects(
          db
            .updateTable('request_tracking_policy')
            .set({ credential_lifetime_days: refused })
            .where('organization_id', '=', org)
            .execute(),
          /credential_lifetime_days/,
          `${String(refused)} days must be refused by the database`,
        );
      // Restore the approved default, which rollback below also requires.
      await db
        .updateTable('request_tracking_policy')
        .set({ credential_lifetime_days: 180 })
        .where('organization_id', '=', org)
        .execute();
    },
  );
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
      assert.deepEqual(result.body, {
        status: 'not_issued',
        version: null,
        // F065 safe management metadata. Nothing is issued, so there is no
        // issuer, no expiry and nothing expired.
        issuerType: null,
        expired: false,
        expiresAt: null,
      });
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
        // F065: staff issuance, and non-expiring because the intake issuance
        // feature is off by default, which is the shipped rollout state.
        issuerType: 'staff',
        expired: false,
        expiresAt: null,
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
            issuer_type: 'staff',
            expires_at: null,
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
      // F063.1 adds exactly one approved key. The assertion stays an exact
      // whitelist, so any further field still fails here.
      assert.deepEqual(Object.keys(result.body).sort(), [
        'description',
        'issue',
        'reference',
        'serviceLocation',
        'status',
        'submittedAt',
        'updates',
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
              issuer_type: 'staff',
              expires_at: null,
              revoked_at: null,
            })
            .execute(),
        );
      await assert.rejects(db.transaction().execute(down));
    },
  );
  await t.test(
    'F063.1 resident updates are bounded, ordered, request/tenant scoped and carry no staff or internal data',
    async () => {
      const issued = responseBody(
        await change('issue', responseBody(await state()).version).expect(201),
      );
      const updatesFor = async (credential: string) => {
        const response = await track(credential).expect(200);
        const body = response.body as {
          updates: {
            id: string;
            body: string;
            createdAt: string;
            sender: { displayName: string };
          }[];
        };
        return { body, updates: body.updates, raw: JSON.stringify(body) };
      };
      // A request with no correspondence reports an empty collection, never a
      // missing field the requester page would have to guess at.
      assert.deepEqual((await updatesFor(issued.credential)).updates, []);
      const correspond = async (
        requestId: string,
        organizationId: string,
        author: string,
        body: string,
        minute: number,
      ) => {
        const messageId = randomUUID();
        await sql`insert into request_communication(id,organization_id,service_request_id,author_staff_identity_id,author_display_name,submission_key,body,created_at)
          values(${messageId},${organizationId},${requestId},${author},'Fictional employee',${randomUUID()},${body},${`2026-09-21T00:${String(minute).padStart(2, '0')}:00Z`}::timestamptz)`.execute(
          db,
        );
        return messageId;
      };
      // One more than the ceiling, so the oldest must fall outside the page.
      const authored: string[] = [];
      for (let minute = 0; minute < 26; minute++)
        authored.push(
          await correspond(
            id,
            org,
            full,
            `Fictional update ${String(minute)}`,
            minute,
          ),
        );
      // Same tenant, a different request.
      await correspond(internal, org, full, 'OTHER_REQUEST_BODY', 30);
      // A different tenant entirely, authored by that tenant's own staff.
      await correspond(
        c.otherInternal,
        c.otherOrg,
        c.otherStaff,
        'OTHER_TENANT_BODY',
        31,
      );
      // An internal note on the very same request must stay unreachable.
      await sql`insert into request_internal_note(id,organization_id,service_request_id,author_staff_identity_id,author_display_name,submission_key,body)
        values(${randomUUID()},${org},${id},${full},'Fictional employee',${randomUUID()},'INTERNAL_NOTE_BODY')`.execute(
        db,
      );
      const { updates, raw } = await updatesFor(issued.credential);
      assert.equal(updates.length, 25, 'the fixed ceiling bounds the page');
      assert.deepEqual(
        updates.map((update) => update.id),
        authored.slice(1).reverse(),
        'newest first by created_at then id, oldest beyond the ceiling dropped',
      );
      assert.deepEqual(
        updates.map((update) => update.sender.displayName),
        Array.from({ length: 25 }, () => 'Service team'),
        'staff identity stays masked behind a generic label',
      );
      for (const update of updates)
        assert.deepEqual(
          Object.keys(update).sort(),
          [
            'body',
            'channel',
            'createdAt',
            'deliveryState',
            'direction',
            'id',
            'sender',
          ],
          'each entry exposes only the agreed resident-safe fields',
        );
      for (const forbidden of [
        'OTHER_REQUEST_BODY',
        'OTHER_TENANT_BODY',
        'INTERNAL_NOTE_BODY',
        'Fictional employee',
        'author_display_name',
        'author_staff_identity_id',
        'submission_key',
        'organization_id',
        'service_request_id',
        full,
        c.otherOrg,
        c.otherStaff,
        org,
      ])
        assert.ok(
          !raw.includes(forbidden),
          `${forbidden} must never reach a requester`,
        );
      // A revoked credential loses the correspondence with the request.
      const live = responseBody(await state()).version;
      await change('revoke', live).expect(201);
      await track(issued.credential).expect(404);
      // Reissue, confirm access returns, then prove the read mutated nothing.
      const reissued = responseBody(
        await change('issue', responseBody(await state()).version).expect(201),
      );
      const committed = JSON.stringify(
        (await db.selectFrom('request_communication').selectAll().execute())
          .map((row) => JSON.stringify(row))
          .sort(),
      );
      await updatesFor(reissued.credential);
      await updatesFor(reissued.credential);
      assert.equal(
        JSON.stringify(
          (await db.selectFrom('request_communication').selectAll().execute())
            .map((row) => JSON.stringify(row))
            .sort(),
        ),
        committed,
        'tracking reads never mutate correspondence',
      );
      // An internal-audience request stays unreachable even with a credential.
      assert.equal(
        (
          await db
            .selectFrom('request_tracking_credential')
            .select('id')
            .where('service_request_id', '=', internal)
            .execute()
        ).length,
        0,
        'no credential can exist for an internal request',
      );
      await change('revoke', responseBody(await state()).version).expect(201);
      const evidence = JSON.stringify(
        await db
          .selectFrom('activity')
          .selectAll()
          .where('activity_type', 'like', 'requester_tracking_%')
          .execute(),
      );
      for (const secret of [
        issued.credential,
        reissued.credential,
        trackingDigest(issued.credential),
        trackingDigest(reissued.credential),
      ])
        assert.ok(
          !(evidence + c.logs.join('')).includes(secret),
          'credentials and digests stay out of audit and logs',
        );
    },
  );

  // ===================================================================
  // F065 credential assertions, deliberately last: every F044 test above
  // counts rows across the whole table, so nothing here may run earlier.
  // ===================================================================
  await t.test(
    'F065 rollback preserves every credential and reapplying classifies them as staff-issued',
    async () => {
      const columns = [
        'credential_digest',
        'created_by_staff_identity_id',
        'status',
      ] as const;
      const existing = await db
        .selectFrom('request_tracking_credential')
        .select(columns)
        .orderBy('credential_digest', 'asc')
        .execute();
      assert.ok(
        existing.length > 0,
        'the F044 tests left real credentials for this to preserve',
      );
      const before = await snapshot();
      // Rollback is allowed while nothing is requester-issued or expiring,
      // and it discards no credential to make itself pass.
      await db.transaction().execute(f065Down);
      assert.deepEqual(
        await db
          .selectFrom('request_tracking_credential')
          .select(columns)
          .orderBy('credential_digest', 'asc')
          .execute(),
        existing,
      );
      // Reapplying classifies every pre-existing row as staff-issued and
      // non-expiring, which is exactly what those rows are.
      await db.transaction().execute(f065Up);
      const restored = await db
        .selectFrom('request_tracking_credential')
        .select([...columns, 'issuer_type', 'expires_at'])
        .orderBy('credential_digest', 'asc')
        .execute();
      assert.equal(restored.length, existing.length);
      for (const [index, row] of restored.entries()) {
        assert.equal(row.issuer_type, 'staff');
        assert.equal(row.expires_at, null);
        assert.equal(row.credential_digest, existing[index]?.credential_digest);
        assert.equal(
          row.created_by_staff_identity_id,
          existing[index]?.created_by_staff_identity_id,
        );
        assert.equal(row.status, existing[index]?.status);
        assert.ok(row.created_by_staff_identity_id);
      }
      assert.deepEqual(await snapshot(), before);
    },
  );
  await t.test(
    'F065 issuer attribution admits exactly the staff and requester-intake shapes',
    async () => {
      const parent = await create(c.publicPayload);
      const insert = (values: Record<string, unknown>) =>
        db
          .insertInto('request_tracking_credential')
          .values({
            organization_id: org,
            service_request_id: parent,
            status: 'active',
            revoked_at: null,
            ...values,
          } as never)
          .execute();
      // A staff row without an author is refused.
      await assert.rejects(
        insert({
          credential_digest: 'b'.repeat(64),
          created_by_staff_identity_id: null,
          issuer_type: 'staff',
        }),
        /request_tracking_issuer_attribution/,
      );
      // A requester-intake row that borrows a staff author is refused.
      await assert.rejects(
        insert({
          credential_digest: 'c'.repeat(64),
          created_by_staff_identity_id: c.creator,
          issuer_type: 'requester_intake',
        }),
        /request_tracking_issuer_attribution/,
      );
      // An unknown issuer classification is refused.
      await assert.rejects(
        insert({
          credential_digest: 'd'.repeat(64),
          created_by_staff_identity_id: null,
          issuer_type: 'borrowed',
        }),
        /issuer_type/,
      );
      // An expiry at or before creation is refused.
      await assert.rejects(
        insert({
          credential_digest: 'e'.repeat(64),
          created_by_staff_identity_id: null,
          issuer_type: 'requester_intake',
          expires_at: sql`clock_timestamp() - interval '1 day'`,
        }),
        /request_tracking_expiry_after_issue/,
      );
      // The accepted requester-intake shape: no staff author, bounded expiry.
      await insert({
        credential_digest: 'f'.repeat(64),
        created_by_staff_identity_id: null,
        issuer_type: 'requester_intake',
        expires_at: sql`clock_timestamp() + make_interval(days => 180)`,
      });
      const stored = await db
        .selectFrom('request_tracking_credential')
        .select([
          'issuer_type',
          'created_by_staff_identity_id',
          sql<boolean>`expires_at > clock_timestamp()`.as('future'),
        ])
        .where('credential_digest', '=', 'f'.repeat(64))
        .executeTakeFirstOrThrow();
      assert.equal(stored.issuer_type, 'requester_intake');
      assert.equal(stored.created_by_staff_identity_id, null);
      assert.equal(stored.future, true);
      // Issuer type and expiry join the immutable set; only revocation moves.
      for (const mutation of [{ issuer_type: 'staff' }, { expires_at: null }])
        await assert.rejects(
          db
            .updateTable('request_tracking_credential')
            .set(mutation as never)
            .where('credential_digest', '=', 'f'.repeat(64))
            .execute(),
          /immutable except revocation/,
        );
      // A second active credential for one parent is still impossible.
      await assert.rejects(
        insert({
          credential_digest: '0'.repeat(64),
          created_by_staff_identity_id: null,
          issuer_type: 'requester_intake',
          expires_at: sql`clock_timestamp() + make_interval(days => 180)`,
        }),
        /request_tracking_one_active/,
      );
    },
  );
  await t.test(
    'F065 an INTERNAL parent refuses a requester-intake credential at the database',
    async () => {
      await assert.rejects(
        db
          .insertInto('request_tracking_credential')
          .values({
            organization_id: org,
            service_request_id: internal,
            credential_digest: '1'.repeat(64),
            status: 'active',
            created_by_staff_identity_id: null,
            issuer_type: 'requester_intake',
            expires_at: sql`clock_timestamp() + make_interval(days => 180)`,
            revoked_at: null,
          } as never)
          .execute(),
        /Tracking requires PUBLIC parent/,
      );
    },
  );
  await t.test(
    'F065 expiry is enforced by the database clock, and no raw credential is stored',
    async () => {
      const live = generateTrackingCredential();
      const dead = generateTrackingCredential();
      const unknown = generateTrackingCredential();
      const liveParent = await create(c.publicPayload);
      const deadParent = await create(c.publicPayload);
      await sql`insert into request_tracking_credential(organization_id,service_request_id,credential_digest,status,created_by_staff_identity_id,issuer_type,expires_at)
        values(${org},${liveParent},${live.digest},'active',null,'requester_intake',clock_timestamp() + interval '180 days')`.execute(
        db,
      );
      // Already lapsed. The CHECK only forbids expiry at or before creation,
      // so a backdated pair is legitimate state for testing the predicate.
      await sql`insert into request_tracking_credential(organization_id,service_request_id,credential_digest,status,created_by_staff_identity_id,issuer_type,expires_at,created_at)
        values(${org},${deadParent},${dead.digest},'active',null,'requester_intake',clock_timestamp() - interval '1 day',clock_timestamp() - interval '2 days')`.execute(
        db,
      );
      // Only digests are persisted; no column holds a usable credential.
      for (const credential of [live.credential, dead.credential]) {
        const found = await sql<{
          hits: string;
        }>`select count(*)::text as hits from request_tracking_credential where credential_digest = ${credential}`.execute(
          db,
        );
        assert.equal(
          found.rows[0]?.hits,
          '0',
          'a raw credential must never be stored',
        );
      }
      const repository = new RequestTrackingRepository();
      await db.transaction().execute(async (trx) => {
        const resolved = await repository.resolve(trx, live.digest);
        assert.ok(resolved, 'a live credential resolves');
        assert.equal(typeof resolved.reference, 'string');
      });
      await db.transaction().execute(async (trx) => {
        assert.equal(
          await repository.resolve(trx, dead.digest),
          null,
          'an expired credential must not resolve',
        );
      });
      // Expired and never-issued are indistinguishable over HTTP, and
      // neither discloses that the request exists.
      await track(live.credential).expect(200);
      await track(dead.credential).expect(404);
      await track(unknown.credential).expect(404);
    },
  );
  await t.test(
    'F065 rollback fails closed once requester-issued or expiring credentials exist',
    async () => {
      await assert.rejects(
        db.transaction().execute(f065Down),
        /Requester-issued or expiring tracking credentials prevent rollback/,
      );
      // Refusing left the schema intact rather than half-reverted, and
      // deleted nothing to make itself pass.
      assert.ok(
        (
          await db
            .selectFrom('request_tracking_credential')
            .select('credential_digest')
            .where('issuer_type', '=', 'requester_intake')
            .execute()
        ).length > 0,
      );
    },
  );
}
