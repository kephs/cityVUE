import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  FileMigrationProvider,
  Kysely,
  Migrator,
  PostgresDialect,
  sql,
} from 'kysely';
import { Pool } from 'pg';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
// Imported so the migration is compiled alongside the tests; the migrator
// below loads it from the built directory by filename, as the application's
// migration runner does.
import {
  down as submissionDown,
  up as submissionUp,
} from '../../migrations/20261031000000-add-submission-idempotency.js';
import {
  submissionKeyDigest,
  submissionScope,
} from '../../src/service-request/submission-idempotency.js';
import { reserveSubmission } from '../../src/service-request/submission-reservation.js';

/**
 * F066 — submission idempotency, proven against real PostgreSQL.
 *
 * The guarantee this feature makes is a database guarantee, so the parts that
 * matter cannot be proven with mocks. What is exercised here is the unique
 * constraint under genuine concurrency, the deferred foreign key, the
 * append-only triggers, the retry-window semantics and the migration's own
 * ordering and rollback behaviour.
 *
 * **No sleeps anywhere.** The concurrency case is deterministic by
 * construction: the winning transaction takes its reservation before the
 * second statement is issued, so the second must wait on it, and its outcome
 * is read only after the winner has committed.
 *
 * All fixture data is fictional. No persistent database is touched: every run
 * creates its own schema inside the disposable instance and the migration is
 * applied there and nowhere else.
 */

const url = process.env.TEST_DATABASE_URL;
const PRECEDING = '20261030000000-add-requester-intake-tracking-issuance';
const CURRENT = '20261031000000-add-submission-idempotency';
const SCOPE = submissionScope({
  audience: 'public',
  intakeChannel: 'web',
  staffId: null,
});
const FINGERPRINT = 'a'.repeat(64);
const OTHER_FINGERPRINT = 'b'.repeat(64);

test(
  'F066 submission idempotency: constraints, concurrency, replay and rollback',
  { skip: !url },
  async (t) => {
    const schema = `idempotency_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: url });
    try {
      await prepareDatabaseExtensions(admin);
    } catch (error) {
      await admin.end();
      throw error;
    }
    await admin.query(`create schema "${schema}"`);
    const connect = () =>
      new Pool({
        connectionString: url,
        options: `-c search_path=${schema}`,
      });
    const pool = connect();
    const db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({ pool }),
    });
    const racePool = connect();
    const migrator = new Migrator({
      db,
      migrationTableSchema: schema,
      provider: new FileMigrationProvider({
        fs,
        path,
        migrationFolder: path.resolve(__dirname, '../../migrations'),
      }),
    });
    const migrate = async (target: string) => {
      const result = await migrator.migrateTo(target);
      assert.equal(result.error, undefined, `migrating to ${target}`);
      return result;
    };
    const tableExists = async (name: string) =>
      (
        await sql<{
          present: boolean;
        }>`select exists(select 1 from pg_tables where schemaname=${schema} and tablename=${name}) present`.execute(
          db,
        )
      ).rows[0]?.present === true;
    const constraints = async () =>
      (
        await sql<{ conname: string; definition: string }>`
          select conname, pg_get_constraintdef(oid) definition
          from pg_constraint
          where conrelid = (select oid from pg_class
                            where relname='request_submission_idempotency'
                              and relnamespace=${schema}::regnamespace)
          order by conname`.execute(db)
      ).rows;
    const reservations = async () =>
      (
        await sql<{
          submission_scope: string;
          key_digest: string;
          fingerprint: string;
          service_request_id: string;
          tracking_issued: boolean;
          organization_id: string;
        }>`select organization_id, submission_scope, key_digest, fingerprint,
                  service_request_id, tracking_issued
             from request_submission_idempotency
             order by key_digest, organization_id, submission_scope`.execute(db)
      ).rows;
    const requestCount = async () =>
      Number(
        (
          await sql<{
            count: string;
          }>`select count(*)::text count from service_request`.execute(db)
        ).rows[0]?.count ?? '-1',
      );
    const credentialCount = async () =>
      Number(
        (
          await sql<{
            count: string;
          }>`select count(*)::text count from request_tracking_credential`.execute(
            db,
          )
        ).rows[0]?.count ?? '-1',
      );

    const org = randomUUID(),
      foreign = randomUUID(),
      staff = randomUUID();
    /**
     * Each Organization gets its own catalog. `service_request` references
     * `service_definition` by the composite
     * (organization_id, category_id, service_definition_id), so a request
     * cannot borrow another tenant's definition -- which is one of the
     * isolation properties this file relies on rather than restates.
     */
    const catalog = new Map<
      string,
      { category: string; issue: string; version: string }
    >([
      [
        org,
        { category: randomUUID(), issue: randomUUID(), version: randomUUID() },
      ],
      [
        foreign,
        { category: randomUUID(), issue: randomUUID(), version: randomUUID() },
      ],
    ]);
    const catalogFor = (organizationId: string) => {
      const entry = catalog.get(organizationId);
      assert.ok(entry, 'every fixture Organization needs a catalog');
      return entry;
    };

    /** A fictional request row, inserted the way the creation path inserts one. */
    const insertRequest = async (
      id: string,
      organizationId: string,
      audience: 'public' | 'internal' = 'public',
    ) => {
      const { category, issue, version } = catalogFor(organizationId);
      await sql`insert into service_request(id,organization_id,reference_number,service_definition_id,service_definition_version_id,category_id,status,priority,description,reporting_identity,audience,submitted_by_staff_identity_id,requester_staff_identity_id)
        values(${id},${organizationId},${'TEST-' + id.replaceAll('-', '').toUpperCase().slice(0, 18)},${issue},${version},${category},'open','medium','Fictional request','anonymous',${audience},null,null)`.execute(
        db,
      );
      return id;
    };

    try {
      await migrate(PRECEDING);
      assert.equal(
        await tableExists('request_submission_idempotency'),
        false,
        'the F066 table must not exist before its own migration',
      );

      await sql`insert into organization(id,name,short_name,slug,default_business_timezone) values
        (${org},'Fictional idempotency organization','Test',${org},'Etc/UTC'),
        (${foreign},'Fictional other organization','Other',${foreign},'Etc/UTC')`.execute(
        db,
      );
      await sql`insert into staff_identity(id,organization_id,entra_tenant_id,entra_object_id,display_name,active)
        values(${staff},${org},${randomUUID()},${randomUUID()},'Fictional staff',true)`.execute(
        db,
      );
      for (const organizationId of [org, foreign]) {
        const { category, issue, version } = catalogFor(organizationId);
        const department = randomUUID();
        await sql`insert into department(id,organization_id,name) values(${department},${organizationId},'Fictional department')`.execute(
          db,
        );
        await sql`insert into category(id,organization_id,department_id,name,icon_key) values(${category},${organizationId},${department},'Fictional category','test')`.execute(
          db,
        );
        await sql`insert into service_definition(id,organization_id,category_id,service_key,availability) values(${issue},${organizationId},${category},'fictional','INTERNAL_AND_EXTERNAL')`.execute(
          db,
        );
        await sql`insert into service_definition_version(id,organization_id,service_definition_id,version_number,name,resident_description,icon_key,default_priority,location_policy,geographic_eligibility_mode,anonymous_reporting_policy,status)
          values(${version},${organizationId},${issue},1,'Fictional issue','Fictional description','test','medium','not_applicable','no_geographic_restriction','allowed','draft')`.execute(
          db,
        );
      }

      await t.test(
        'the migration applies on top of F065 and is additive',
        async () => {
          // Both directions exist. A migration without a working `down` is
          // not reviewable, and the rollback behaviour is asserted below.
          assert.equal(typeof submissionUp, 'function');
          assert.equal(typeof submissionDown, 'function');
          await migrate(CURRENT);
          assert.equal(
            await tableExists('request_submission_idempotency'),
            true,
          );
          // F065's objects are untouched by an additive migration.
          for (const name of [
            'request_tracking_credential',
            'request_tracking_policy',
            'service_request',
          ])
            assert.equal(await tableExists(name), true, `${name} preserved`);
          const rows = await constraints();
          const normalized = rows
            .map((row) => row.definition.replaceAll(/\s+/g, ' ').toLowerCase())
            .join('\n');
          for (const needle of [
            // The guarantee is enforced by the database, not by
            // application sequencing.
            'unique (organization_id, submission_scope, key_digest)',
            // Deferred, so a reservation may precede the request it names
            // while still being verified before commit.
            'foreign key (organization_id, service_request_id)',
            'references service_request(organization_id, id)',
            'deferrable initially deferred',
            // Only a digest is accepted, and a reservation cannot be born
            // with a closed window.
            'key_digest ~',
            'expires_at > created_at',
          ])
            assert.ok(
              normalized.includes(needle),
              `expected a constraint containing "${needle}", found:\n${normalized}`,
            );
        },
      );

      await t.test(
        'a first submission claims the key and a retry replays it without creating anything',
        async () => {
          const requestId = randomUUID();
          const key = randomUUID();
          const digest = submissionKeyDigest(key);
          const before = await requestCount();
          const first = await db.transaction().execute(async (trx) => {
            const outcome = await reserveSubmission(trx, {
              organizationId: org,
              scope: SCOPE,
              keyDigest: digest,
              fingerprint: FINGERPRINT,
              requestId,
              trackingIssued: false,
            });
            // The reservation is taken before the request exists; the deferred
            // foreign key is satisfied by the insert that follows.
            await insertRequest(requestId, org);
            return outcome;
          });
          assert.deepEqual(first, { kind: 'first' });
          assert.equal(await requestCount(), before + 1);

          // The retry. No request is created and the original identity comes
          // back, which is the whole contract.
          const replay = await db.transaction().execute((trx) =>
            reserveSubmission(trx, {
              organizationId: org,
              scope: SCOPE,
              keyDigest: digest,
              fingerprint: FINGERPRINT,
              requestId: randomUUID(),
              trackingIssued: false,
            }),
          );
          assert.deepEqual(replay, {
            kind: 'replay',
            serviceRequestId: requestId,
            trackingIssued: false,
          });
          assert.equal(
            await requestCount(),
            before + 1,
            'a replay must not create a second request',
          );
          // The raw key was never stored.
          const stored = (await reservations()).filter(
            (row) => row.key_digest === digest,
          );
          assert.equal(stored.length, 1);
          assert.equal(stored[0]?.key_digest, digest);
          assert.notEqual(stored[0].key_digest, key);
          assert.equal(JSON.stringify(stored).includes(key), false);
        },
      );

      await t.test(
        'the same key with a different payload is refused and creates nothing',
        async () => {
          const key = randomUUID();
          const digest = submissionKeyDigest(key);
          const original = randomUUID();
          await db.transaction().execute(async (trx) => {
            await reserveSubmission(trx, {
              organizationId: org,
              scope: SCOPE,
              keyDigest: digest,
              fingerprint: FINGERPRINT,
              requestId: original,
              trackingIssued: false,
            });
            await insertRequest(original, org);
          });
          const before = await requestCount();
          const outcome = await db.transaction().execute((trx) =>
            reserveSubmission(trx, {
              organizationId: org,
              scope: SCOPE,
              keyDigest: digest,
              fingerprint: OTHER_FINGERPRINT,
              requestId: randomUUID(),
              trackingIssued: false,
            }),
          );
          assert.deepEqual(outcome, { kind: 'mismatch' });
          assert.equal(await requestCount(), before);
        },
      );

      await t.test(
        'a different key with an identical payload is a separate submission',
        async () => {
          const before = await requestCount();
          for (const _ of [0, 1]) {
            const requestId = randomUUID();
            const outcome = await db.transaction().execute(async (trx) => {
              const result = await reserveSubmission(trx, {
                organizationId: org,
                scope: SCOPE,
                keyDigest: submissionKeyDigest(randomUUID()),
                fingerprint: FINGERPRINT,
                requestId,
                trackingIssued: false,
              });
              await insertRequest(requestId, org);
              return result;
            });
            assert.deepEqual(outcome, { kind: 'first' });
            void _;
          }
          // Deduplication is keyed on the key, never on the payload: two
          // genuinely separate reports of the same pothole must both exist.
          assert.equal(await requestCount(), before + 2);
        },
      );

      await t.test(
        'the same key in another tenant or another scope is a different reservation',
        async () => {
          const key = randomUUID();
          const digest = submissionKeyDigest(key);
          const mine = randomUUID();
          await db.transaction().execute(async (trx) => {
            await reserveSubmission(trx, {
              organizationId: org,
              scope: SCOPE,
              keyDigest: digest,
              fingerprint: FINGERPRINT,
              requestId: mine,
              trackingIssued: false,
            });
            await insertRequest(mine, org);
          });
          // Another tenant presenting the identical key must not be handed
          // this tenant's request.
          const theirs = randomUUID();
          const crossTenant = await db.transaction().execute(async (trx) => {
            const result = await reserveSubmission(trx, {
              organizationId: foreign,
              scope: SCOPE,
              keyDigest: digest,
              fingerprint: FINGERPRINT,
              requestId: theirs,
              trackingIssued: false,
            });
            await insertRequest(theirs, foreign);
            return result;
          });
          assert.deepEqual(crossTenant, { kind: 'first' });
          // And a different authorized scope within the same tenant is also
          // distinct, so a staff key cannot replay a resident submission.
          const staffScope = submissionScope({
            audience: 'public',
            intakeChannel: 'phone',
            staffId: staff,
          });
          const staffRequest = randomUUID();
          const scoped = await db.transaction().execute(async (trx) => {
            const result = await reserveSubmission(trx, {
              organizationId: org,
              scope: staffScope,
              keyDigest: digest,
              fingerprint: FINGERPRINT,
              requestId: staffRequest,
              trackingIssued: false,
            });
            await insertRequest(staffRequest, org);
            return result;
          });
          assert.deepEqual(scoped, { kind: 'first' });
          const rows = (await reservations()).filter(
            (row) => row.key_digest === digest,
          );
          assert.equal(rows.length, 3);
          assert.deepEqual(
            [...new Set(rows.map((row) => row.service_request_id))].sort(),
            [mine, theirs, staffRequest].sort(),
          );
        },
      );

      await t.test(
        'a key past its retry window is refused rather than silently recreating the submission',
        async () => {
          const digest = submissionKeyDigest(randomUUID());
          const requestId = randomUUID();
          await insertRequest(requestId, org);
          // Back-dated directly, because the window is decided by the
          // database clock that wrote the expiry -- there is no application
          // clock to move, and the test must not wait for real time to pass.
          // `created_at` moves with it so the row still satisfies its own
          // `expires_at > created_at` constraint.
          await sql`insert into request_submission_idempotency
                      (organization_id, submission_scope, key_digest, fingerprint,
                       service_request_id, tracking_issued, created_at, expires_at)
                    values(${org},${SCOPE},${digest},${FINGERPRINT},${requestId},false,
                           clock_timestamp() - interval '26 hours',
                           clock_timestamp() - interval '2 hours')`.execute(db);
          const before = await requestCount();
          const outcome = await db.transaction().execute((trx) =>
            reserveSubmission(trx, {
              organizationId: org,
              scope: SCOPE,
              keyDigest: digest,
              fingerprint: FINGERPRINT,
              requestId: randomUUID(),
              trackingIssued: false,
            }),
          );
          assert.deepEqual(outcome, { kind: 'expired' });
          assert.equal(
            await requestCount(),
            before,
            'an expired key must not create a second request',
          );
          // A reservation still inside its window replays, which shows the
          // refusal above came from the expiry and not from the lookup.
          const liveDigest = submissionKeyDigest(randomUUID());
          const liveRequest = randomUUID();
          await db.transaction().execute(async (trx) => {
            await reserveSubmission(trx, {
              organizationId: org,
              scope: SCOPE,
              keyDigest: liveDigest,
              fingerprint: FINGERPRINT,
              requestId: liveRequest,
              trackingIssued: false,
              retentionHours: 1,
            });
            await insertRequest(liveRequest, org);
          });
          assert.equal(
            (
              await db.transaction().execute((trx) =>
                reserveSubmission(trx, {
                  organizationId: org,
                  scope: SCOPE,
                  keyDigest: liveDigest,
                  fingerprint: FINGERPRINT,
                  requestId: randomUUID(),
                  trackingIssued: false,
                }),
              )
            ).kind,
            'replay',
          );
        },
      );

      await t.test(
        'concurrent identical submissions commit exactly one request',
        async () => {
          const key = randomUUID();
          const digest = submissionKeyDigest(key);
          const winnerRequest = randomUUID();
          const loserRequest = randomUUID();
          const before = await requestCount();
          const winner = await racePool.connect();
          const loser = await racePool.connect();
          try {
            await winner.query('begin');
            await loser.query('begin');
            const reserve = (requestId: string) => ({
              text: `insert into request_submission_idempotency
                       (organization_id, submission_scope, key_digest, fingerprint,
                        service_request_id, tracking_issued, expires_at)
                     values ($1,$2,$3,$4,$5,false, clock_timestamp() + interval '24 hours')
                     on conflict (organization_id, submission_scope, key_digest)
                     do nothing
                     returning id`,
              values: [org, SCOPE, digest, FINGERPRINT, requestId],
            });
            // The winner takes the reservation first and holds it uncommitted.
            const claimed = await winner.query(reserve(winnerRequest));
            assert.equal(claimed.rowCount, 1);
            // The loser's identical insert is issued now. It cannot proceed:
            // PostgreSQL makes a conflicting speculative insert wait on the
            // uncommitted transaction that holds the key. The promise is
            // deliberately not awaited until the winner has committed.
            const contended = loser.query(reserve(loserRequest));
            await winner.query({
              text: `insert into service_request(id,organization_id,reference_number,service_definition_id,service_definition_version_id,category_id,status,priority,description,reporting_identity,audience,submitted_by_staff_identity_id,requester_staff_identity_id)
                     values($1,$2,$3,$4,$5,$6,'open','medium','Fictional request','anonymous','public',null,null)`,
              values: [
                winnerRequest,
                org,
                `RACE-${winnerRequest.replaceAll('-', '').toUpperCase().slice(0, 14)}`,
                catalogFor(org).issue,
                catalogFor(org).version,
                catalogFor(org).category,
              ],
            });
            await winner.query('commit');
            // Now it resolves, and it lost: nothing was inserted.
            const result = await contended;
            assert.equal(
              result.rowCount,
              0,
              'the second submission must not claim the key',
            );
            // The loser can read the winner's committed reservation and
            // replay it rather than creating anything.
            const seen = await loser.query<{ service_request_id: string }>({
              text: `select service_request_id from request_submission_idempotency
                     where organization_id=$1 and submission_scope=$2 and key_digest=$3`,
              values: [org, SCOPE, digest],
            });
            assert.equal(seen.rows[0]?.service_request_id, winnerRequest);
            await loser.query('rollback');
          } finally {
            winner.release();
            loser.release();
          }
          assert.equal(
            await requestCount(),
            before + 1,
            'exactly one request commits for one key',
          );
          assert.equal(
            (await reservations()).filter((row) => row.key_digest === digest)
              .length,
            1,
          );
        },
      );

      await t.test(
        'a rolled back submission leaves no reservation and frees its key',
        async () => {
          const key = randomUUID();
          const digest = submissionKeyDigest(key);
          const abandoned = randomUUID();
          await assert.rejects(
            db.transaction().execute(async (trx) => {
              await reserveSubmission(trx, {
                organizationId: org,
                scope: SCOPE,
                keyDigest: digest,
                fingerprint: FINGERPRINT,
                requestId: abandoned,
                trackingIssued: false,
              });
              await insertRequest(abandoned, org);
              // Stands in for a process failure after the reservation but
              // before commit.
              throw new Error('fictional failure before commit');
            }),
          );
          // No in-progress record survives, so nothing has to be reaped and
          // the retry is not refused by a ghost of the failed attempt.
          assert.equal(
            (await reservations()).filter((row) => row.key_digest === digest)
              .length,
            0,
          );
          const retried = randomUUID();
          const outcome = await db.transaction().execute(async (trx) => {
            const result = await reserveSubmission(trx, {
              organizationId: org,
              scope: SCOPE,
              keyDigest: digest,
              fingerprint: FINGERPRINT,
              requestId: retried,
              trackingIssued: false,
            });
            await insertRequest(retried, org);
            return result;
          });
          assert.deepEqual(outcome, { kind: 'first' });
        },
      );

      await t.test(
        'a reservation naming no real request cannot commit',
        async () => {
          // The deferred foreign key is what makes "a committed reservation
          // always resolves to a request" true by construction rather than by
          // convention.
          await assert.rejects(
            db.transaction().execute((trx) =>
              reserveSubmission(trx, {
                organizationId: org,
                scope: SCOPE,
                keyDigest: submissionKeyDigest(randomUUID()),
                fingerprint: FINGERPRINT,
                requestId: randomUUID(),
                trackingIssued: false,
              }),
            ),
            /foreign key|violates/i,
          );
          // And it cannot borrow another tenant's request either.
          const theirs = randomUUID();
          await db.transaction().execute(async (trx) => {
            await reserveSubmission(trx, {
              organizationId: foreign,
              scope: SCOPE,
              keyDigest: submissionKeyDigest(randomUUID()),
              fingerprint: FINGERPRINT,
              requestId: theirs,
              trackingIssued: false,
            });
            await insertRequest(theirs, foreign);
          });
          await assert.rejects(
            db.transaction().execute((trx) =>
              reserveSubmission(trx, {
                organizationId: org,
                scope: SCOPE,
                keyDigest: submissionKeyDigest(randomUUID()),
                fingerprint: FINGERPRINT,
                requestId: theirs,
                trackingIssued: false,
              }),
            ),
            /foreign key|violates/i,
          );
        },
      );

      await t.test('a reservation is append-only', async () => {
        const existing = (await reservations())[0];
        assert.ok(existing, 'a reservation is needed for this check');
        // A rewritable reservation could be repointed at another request,
        // which is the one way this table could hand a receipt to the wrong
        // caller.
        await assert.rejects(
          sql`update request_submission_idempotency set fingerprint=${OTHER_FINGERPRINT}`.execute(
            db,
          ),
          /append-only/,
        );
        await assert.rejects(
          sql`delete from request_submission_idempotency`.execute(db),
          /append-only/,
        );
        await assert.rejects(
          sql`truncate request_submission_idempotency`.execute(db),
          /append-only/,
        );
        assert.deepEqual(await reservations(), await reservations());
      });

      await t.test(
        'a malformed reservation is refused by the database',
        async () => {
          const target = (await reservations())[0];
          assert.ok(target);
          const bad = async (
            scope: string,
            digest: string,
            fingerprint: string,
          ) =>
            assert.rejects(
              sql`insert into request_submission_idempotency
                    (organization_id, submission_scope, key_digest, fingerprint,
                     service_request_id, tracking_issued, expires_at)
                  values(${org},${scope},${digest},${fingerprint},
                         ${target.service_request_id}, false,
                         clock_timestamp() + interval '1 hour')`.execute(db),
              /violates check constraint|value too long/i,
            );
          await bad('Public:Web', 'a'.repeat(64), FINGERPRINT);
          await bad('', 'a'.repeat(64), FINGERPRINT);
          await bad(SCOPE, 'not-a-digest', FINGERPRINT);
          await bad(SCOPE, 'A'.repeat(64), FINGERPRINT);
          await bad(SCOPE, 'a'.repeat(63), FINGERPRINT);
          await bad(SCOPE, 'a'.repeat(64), 'nope');
          // An expiry that is not in the future relative to its own creation
          // stamp would be a reservation that is born closed.
          await assert.rejects(
            sql`insert into request_submission_idempotency
                  (organization_id, submission_scope, key_digest, fingerprint,
                   service_request_id, tracking_issued, created_at, expires_at)
                values(${org},${SCOPE},${'c'.repeat(64)},${FINGERPRINT},
                       ${target.service_request_id}, false,
                       clock_timestamp(), clock_timestamp() - interval '1 hour')`.execute(
              db,
            ),
            /violates check constraint/i,
          );
        },
      );

      await t.test(
        'a replay issues no F065 credential and mints no second one',
        async () => {
          const key = randomUUID();
          const digest = submissionKeyDigest(key);
          const requestId = randomUUID();
          // Stands in for an intake issuance: the committed submission
          // recorded that a credential was minted, and only its digest is
          // stored.
          const before = await credentialCount();
          await db.transaction().execute(async (trx) => {
            await reserveSubmission(trx, {
              organizationId: org,
              scope: SCOPE,
              keyDigest: digest,
              fingerprint: FINGERPRINT,
              requestId,
              trackingIssued: true,
            });
            await insertRequest(requestId, org);
            await sql`insert into request_tracking_credential
                        (organization_id, service_request_id, credential_digest, status,
                         created_by_staff_identity_id, issuer_type, expires_at)
                      values(${org},${requestId},${'d'.repeat(64)},'active',null,'requester_intake',
                             clock_timestamp() + interval '180 days')`.execute(
              trx,
            );
          });
          assert.equal(await credentialCount(), before + 1);
          const replay = await db.transaction().execute((trx) =>
            reserveSubmission(trx, {
              organizationId: org,
              scope: SCOPE,
              keyDigest: digest,
              fingerprint: FINGERPRINT,
              requestId: randomUUID(),
              trackingIssued: true,
            }),
          );
          assert.deepEqual(replay, {
            kind: 'replay',
            serviceRequestId: requestId,
            trackingIssued: true,
          });
          // The replay path returns before issuance, so no credential is
          // created, rotated or revoked.
          assert.equal(
            await credentialCount(),
            before + 1,
            'a replay must not mint a second credential',
          );
          const credentials = (
            await sql<{
              status: string;
              issuer_type: string;
              credential_digest: string;
            }>`select status, issuer_type, credential_digest
                 from request_tracking_credential
                where service_request_id=${requestId}`.execute(db)
          ).rows;
          assert.equal(credentials.length, 1);
          assert.equal(credentials[0]?.status, 'active');
          assert.equal(credentials[0].issuer_type, 'requester_intake');
          // Only a digest is held; no column carries a usable credential.
          assert.match(credentials[0].credential_digest, /^[0-9a-f]{64}$/);
        },
      );

      await t.test(
        'rollback is refused while reservations exist and succeeds once empty',
        async () => {
          assert.ok((await reservations()).length > 0);
          // Dropping the table with reservations recorded would silently
          // restore duplicate submission, so it refuses rather than
          // destroying the evidence that prevents it.
          const blocked = await migrator.migrateTo(PRECEDING);
          assert.ok(blocked.error, 'rollback must refuse while rows exist');
          const reason =
            blocked.error instanceof Error
              ? blocked.error.message
              : JSON.stringify(blocked.error);
          assert.match(reason, /prevent rollback/i);
          assert.equal(
            await tableExists('request_submission_idempotency'),
            true,
            'a refused rollback must leave the table intact',
          );
          // The append-only triggers mean even this cannot clear them, so the
          // empty-table path is proven on a fresh schema below.
          await assert.rejects(
            sql`delete from request_submission_idempotency`.execute(db),
            /append-only/,
          );
        },
      );

      await t.test(
        'rollback removes the table cleanly when nothing was reserved',
        async () => {
          const clean = `idempotency_clean_${randomUUID().replaceAll('-', '')}`;
          await admin.query(`create schema "${clean}"`);
          const cleanPool = new Pool({
            connectionString: url,
            options: `-c search_path=${clean}`,
          });
          const cleanDb = new Kysely<DatabaseSchema>({
            dialect: new PostgresDialect({ pool: cleanPool }),
          });
          const cleanMigrator = new Migrator({
            db: cleanDb,
            migrationTableSchema: clean,
            provider: new FileMigrationProvider({
              fs,
              path,
              migrationFolder: path.resolve(__dirname, '../../migrations'),
            }),
          });
          try {
            assert.equal(
              (await cleanMigrator.migrateTo(CURRENT)).error,
              undefined,
            );
            const present = async (schemaName: string) =>
              (
                await sql<{
                  present: boolean;
                }>`select exists(select 1 from pg_tables where schemaname=${schemaName} and tablename='request_submission_idempotency') present`.execute(
                  cleanDb,
                )
              ).rows[0]?.present === true;
            assert.equal(await present(clean), true);
            assert.equal(
              (await cleanMigrator.migrateTo(PRECEDING)).error,
              undefined,
            );
            assert.equal(await present(clean), false);
            // The function the triggers used goes with it: a rollback leaves
            // no orphaned object behind.
            const leftover = (
              await sql<{
                count: string;
              }>`select count(*)::text count from pg_proc
                   where proname='prevent_request_submission_idempotency_mutation'
                     and pronamespace=${clean}::regnamespace`.execute(cleanDb)
            ).rows[0]?.count;
            assert.equal(leftover, '0');
            // F065 survives the rollback untouched.
            assert.equal(
              (
                await sql<{
                  present: boolean;
                }>`select exists(select 1 from pg_tables where schemaname=${clean} and tablename='request_tracking_policy') present`.execute(
                  cleanDb,
                )
              ).rows[0]?.present,
              true,
            );
          } finally {
            await cleanDb.destroy();
            // Dropped here, not left to the outer teardown: the launcher's
            // post-run census counts every non-system schema, and a leftover
            // one both fails that census and denies the next suite the clean
            // disposable baseline it refuses to run without.
            await admin.query(`drop schema if exists "${clean}" cascade`);
          }
        },
      );
    } finally {
      await db.destroy();
      await racePool.end();
      await admin.query(`drop schema if exists "${schema}" cascade`);
      await admin.end();
    }
  },
);
