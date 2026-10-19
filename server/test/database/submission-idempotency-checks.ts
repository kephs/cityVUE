import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import type { DatabaseSchema } from '../../src/database/database.types.js';

/**
 * F066 — submission idempotency over HTTP, against the real application and a
 * real PostgreSQL instance.
 *
 * This is the whole path: the resident controller's key requirement, the
 * creation transaction's reservation, the database constraint that enforces
 * at-most-once, and the replay receipt that comes back. The pure decisions
 * are proven separately in `test/unit/submission-idempotency.test.ts`, and the
 * schema-level guarantees in
 * `test/database/submission-idempotency.integration.test.ts`.
 *
 * The feature flag `REQRO_ENABLE_REQUESTER_INTAKE_TRACKING` is off in this
 * fixture, as it is by default, so a replay here reports `not_issued` rather
 * than an unrecoverable link. The issued-and-unrecoverable case is proven at
 * the row level in the integration test, where issuance can be driven
 * directly without enabling the feature.
 */
export async function checkSubmissionIdempotency(
  t: TestContext,
  c: {
    app: INestApplication;
    db: Kysely<DatabaseSchema>;
    publicPayload: object;
    logs: string[];
  },
) {
  const path = '/api/v1/service-requests';
  const api = () => request(c.app.getHttpServer());
  const requests = async () =>
    Number(
      (
        await sql<{
          count: string;
        }>`select count(*)::text count from service_request`.execute(c.db)
      ).rows[0]?.count ?? '-1',
    );
  const reservations = async () =>
    Number(
      (
        await sql<{
          count: string;
        }>`select count(*)::text count from request_submission_idempotency`.execute(
          c.db,
        )
      ).rows[0]?.count ?? '-1',
    );
  interface Receipt {
    id: string;
    referenceNumber: string;
    status: string;
    createdAt: string;
    replay?: { tracking: string };
    tracking?: unknown;
  }

  await t.test(
    'F066 a resident submission requires a well-formed idempotency key',
    async () => {
      const before = await requests();
      // Missing entirely. Refused rather than defaulted: a server-generated
      // key would make every retry look like a new submission, which is the
      // duplicate this feature exists to prevent.
      await api().post(path).send(c.publicPayload).expect(400);
      // Malformed. Refused rather than ignored, because silently dropping it
      // would promise deduplication that was not applied.
      // Surrounding whitespace is deliberately absent from this list: HTTP
      // header values are trimmed by the transport, so ` <uuid> ` arrives as a
      // well-formed key and is correctly accepted.
      for (const key of [
        '',
        '   ',
        'not-a-uuid',
        randomUUID().replaceAll('-', ''),
        '00000000-0000-0000-0000-000000000000',
        `${randomUUID()}-extra`,
        `${randomUUID()}${randomUUID()}`,
      ])
        await api()
          .post(path)
          .set('Idempotency-Key', key)
          .send(c.publicPayload)
          .expect(400);
      assert.equal(
        await requests(),
        before,
        'a refused submission must create nothing',
      );
    },
  );

  await t.test(
    'F066 a retried submission returns the original receipt and creates nothing',
    async () => {
      const key = randomUUID();
      const beforeRequests = await requests();
      const beforeReservations = await reservations();

      const first = await api()
        .post(path)
        .set('Idempotency-Key', key)
        .send(c.publicPayload)
        .expect(201);
      const created = first.body as Receipt;
      assert.match(created.id, /^[0-9a-f-]{36}$/);
      assert.equal(created.status, 'open');
      // A genuine creation says nothing about replay.
      assert.equal('replay' in created, false);
      assert.equal(await requests(), beforeRequests + 1);
      assert.equal(await reservations(), beforeReservations + 1);
      const activity = async () =>
        Number(
          (
            await sql<{
              count: string;
            }>`select count(*)::text count from activity where service_request_id=${created.id}`.execute(
              c.db,
            )
          ).rows[0]?.count ?? '-1',
        );
      const createdActivity = await activity();
      assert.ok(createdActivity > 0, 'creation records its own audit event');

      // The retry: this is the lost-response case the whole feature is for.
      const retry = await api()
        .post(path)
        .set('Idempotency-Key', key)
        .send(c.publicPayload)
        .expect(201);
      const replayed = retry.body as Receipt;
      assert.equal(replayed.id, created.id);
      assert.equal(replayed.referenceNumber, created.referenceNumber);
      // The original creation receipt, not current workflow state.
      assert.equal(replayed.status, 'open');
      assert.equal(replayed.createdAt, created.createdAt);
      // Explicitly marked, and explicit that no link can be returned.
      assert.deepEqual(replayed.replay, { tracking: 'not_issued' });
      assert.equal('tracking' in replayed, false);
      // Nothing was created a second time: not the request, not the
      // reservation, not the audit event.
      assert.equal(await requests(), beforeRequests + 1);
      assert.equal(await reservations(), beforeReservations + 1);
      assert.equal(await activity(), createdActivity);
      // A replay still carries a one-time credential's protections, because
      // the client cannot know in advance that it is a replay.
      assert.equal(retry.headers['cache-control'], 'no-store');
      assert.equal(retry.headers['referrer-policy'], 'no-referrer');
      // A third attempt is equally safe; replay is not single-use.
      const third = await api()
        .post(path)
        .set('Idempotency-Key', key)
        .send(c.publicPayload)
        .expect(201);
      assert.equal((third.body as Receipt).id, created.id);
      assert.equal(await requests(), beforeRequests + 1);
    },
  );

  await t.test(
    'F066 one key cannot be reused for a different submission',
    async () => {
      const key = randomUUID();
      const first = await api()
        .post(path)
        .set('Idempotency-Key', key)
        .send(c.publicPayload)
        .expect(201);
      const before = await requests();
      // Returning the first receipt here would silently discard the second,
      // materially different submission.
      const conflict = await api()
        .post(path)
        .set('Idempotency-Key', key)
        .send({ ...c.publicPayload, description: 'A different narrative' })
        .expect(409);
      const body = conflict.body as { code?: string; message?: string };
      // The code must reach the client: an unrecognised 409 from intake is
      // treated as a stale catalog version, which discards the submission.
      assert.equal(body.code, 'SUBMISSION_KEY_REUSED');
      assert.ok(typeof body.message === 'string' && body.message.length > 0);
      // And it must not disclose the request it collided with.
      const serialized = JSON.stringify(body);
      assert.equal(
        serialized.includes((first.body as Receipt).id),
        false,
        'a conflict must not disclose the original request identity',
      );
      assert.equal(
        serialized.includes((first.body as Receipt).referenceNumber),
        false,
        'a conflict must not disclose the original reference number',
      );
      assert.equal(await requests(), before);
    },
  );

  await t.test('F066 a different key is a different submission', async () => {
    const before = await requests();
    // Deduplication is keyed on the key, never on the payload: two
    // residents reporting the same problem must both be recorded.
    const one = await api()
      .post(path)
      .set('Idempotency-Key', randomUUID())
      .send(c.publicPayload)
      .expect(201);
    const two = await api()
      .post(path)
      .set('Idempotency-Key', randomUUID())
      .send(c.publicPayload)
      .expect(201);
    assert.notEqual((one.body as Receipt).id, (two.body as Receipt).id);
    assert.notEqual(
      (one.body as Receipt).referenceNumber,
      (two.body as Receipt).referenceNumber,
    );
    assert.equal(await requests(), before + 2);
  });

  await t.test(
    'F066 concurrent retries of one submission commit one request',
    async () => {
      const key = randomUUID();
      const before = await requests();
      // The real shape of a double-click or a client retrying while the first
      // attempt is still in flight.
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          api().post(path).set('Idempotency-Key', key).send(c.publicPayload),
        ),
      );
      const accepted = results.filter((response) => response.status === 201);
      const conflicted = results.filter((response) => response.status === 409);
      // Every response is either the one request or an explicit, retryable
      // conflict. Nothing else is acceptable, and in particular no response
      // may report a second request.
      assert.equal(
        accepted.length + conflicted.length,
        results.length,
        `unexpected statuses: ${results.map((r) => r.status).join(',')}`,
      );
      for (const response of conflicted)
        assert.equal(
          (response.body as { code?: string }).code,
          'SUBMISSION_IN_PROGRESS',
        );
      assert.ok(accepted.length >= 1);
      assert.equal(
        new Set(accepted.map((r) => (r.body as Receipt).id)).size,
        1,
        'concurrent submissions must agree on exactly one request',
      );
      assert.equal(
        await requests(),
        before + 1,
        'exactly one request commits for one key',
      );
      // A retry after the contention resolves returns that same request.
      const settled = await api()
        .post(path)
        .set('Idempotency-Key', key)
        .send(c.publicPayload)
        .expect(201);
      assert.equal(
        (settled.body as Receipt).id,
        (accepted[0]?.body as Receipt).id,
      );
      assert.equal(await requests(), before + 1);
    },
  );

  await t.test(
    'F066 the key is never persisted in clear text or written to the log',
    async () => {
      const key = randomUUID();
      await api()
        .post(path)
        .set('Idempotency-Key', key)
        .send(c.publicPayload)
        .expect(201);
      // Only the digest is stored, so a disclosed backup cannot be replayed
      // against the submission endpoint.
      const stored = await sql<{
        key_digest: string;
      }>`select key_digest from request_submission_idempotency`.execute(c.db);
      for (const row of stored.rows) {
        assert.match(row.key_digest, /^[0-9a-f]{64}$/);
        assert.notEqual(row.key_digest, key);
      }
      const dump = JSON.stringify(stored.rows);
      assert.equal(dump.includes(key), false, 'the raw key must not be stored');
      // And it must not reach the structured log, which is where a header
      // would otherwise be the easiest thing to leak.
      assert.equal(
        c.logs.some((line) => line.includes(key)),
        false,
        'the idempotency key must not appear in logs',
      );
      assert.equal(
        c.logs.some((line) => line.toLowerCase().includes('idempotency-key')),
        false,
        'the idempotency header name must not be logged with a value',
      );
    },
  );

  await t.test(
    'F066 a reservation records only safe metadata and resolves to its own request',
    async () => {
      const rows = await sql<{
        submission_scope: string;
        fingerprint: string;
        tracking_issued: boolean;
        service_request_id: string;
        organization_id: string;
      }>`select r.submission_scope, r.fingerprint, r.tracking_issued,
                r.service_request_id, r.organization_id
           from request_submission_idempotency r`.execute(c.db);
      assert.ok(rows.rows.length > 0);
      // Resident intake must be represented; the harness also submits through
      // the staff route, whose keys are additionally bound to the acting
      // staff identity.
      assert.ok(
        rows.rows.some((row) => row.submission_scope === 'public:web'),
        'resident submissions must be scoped to the resident channel',
      );
      for (const row of rows.rows) {
        // Every scope is server-derived and stays within the accepted shape.
        // An anonymous resident scope carries no identity, because there is
        // none to bind and none is invented.
        assert.match(
          row.submission_scope,
          /^(?:public|internal):[a-z_]+(?::staff:[0-9a-f-]{36})?$/,
          `unexpected scope ${row.submission_scope}`,
        );
        assert.match(row.fingerprint, /^[0-9a-f]{64}$/);
        // The F065 flag is off in this fixture, so nothing was issued.
        assert.equal(row.tracking_issued, false);
        // Every reservation resolves to a request in its own Organization,
        // which is what the deferred foreign key guarantees.
        const parent = await c.db
          .selectFrom('service_request')
          .select(['id', 'organization_id', 'audience'])
          .where('id', '=', row.service_request_id)
          .executeTakeFirst();
        assert.ok(parent, 'a reservation must resolve to a real request');
        assert.equal(parent.organization_id, row.organization_id);
        // The scope's audience is the request's audience: a PUBLIC-scoped key
        // can never resolve to an INTERNAL request.
        assert.equal(
          row.submission_scope.split(':')[0],
          parent.audience,
          'the reservation scope must agree with the request audience',
        );
      }
      // One reservation per request: a second key never claims an existing
      // request and hands its receipt to another caller.
      const duplicated = await sql<{
        count: string;
      }>`select count(*)::text count from (
           select service_request_id from request_submission_idempotency
           group by organization_id, service_request_id having count(*) > 1
         ) t`.execute(c.db);
      assert.equal(duplicated.rows[0]?.count, '0');
    },
  );
}
