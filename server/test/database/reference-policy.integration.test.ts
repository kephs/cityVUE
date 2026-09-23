import { up as ownershipUp } from '../../migrations/20260920000000-add-assignment-watchers.js';
import { up as defaultAssignmentUp } from '../../migrations/20260924000000-add-issue-default-assignment.js';
import { up as operationalUp } from '../../migrations/20260919050000-add-request-operational-activity.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import { up as catalogUp } from '../../migrations/20260902000000-create-organization-service-catalog.js';
import { up as requestUp } from '../../migrations/20260902010000-create-service-request-foundation.js';
import { up as locationUp } from '../../migrations/20260902030000-add-location-eligibility-snapshot.js';
import { up as staffUp } from '../../migrations/20260903010000-add-staff-assignment-workflow-foundation.js';
import { up as authUp } from '../../migrations/20260903020000-add-entra-rbac-foundation.js';
import { up as audienceUp } from '../../migrations/20260919000000-add-request-audience-assisted-intake.js';
import { up as actionUp } from '../../migrations/20260919030000-add-issue-action.js';
import {
  up,
  down,
} from '../../migrations/20260919040000-configure-request-references.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';
import { CreateServiceRequestService } from '../../src/service-request/create-service-request.service.js';
import { ServiceRequestRepository } from '../../src/service-request/service-request.repository.js';
import { ReferenceConfigurationService } from '../../src/service-request/reference-configuration.service.js';
import { defaultReferencePolicy } from '../../src/service-request/reference-policy.domain.js';
const url = process.env.TEST_DATABASE_URL;
test(
  'F033 migration, reference integrity, concurrency and Organization isolation',
  { skip: !url },
  async (t) => {
    const schema = `reference_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: url });
    await prepareDatabaseExtensions(admin);
    await admin.query(`create schema "${schema}"`);
    const db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: url,
          max: 24,
          options: `-c search_path=${schema}`,
        }),
      }),
    });
    try {
      for (const migrate of [
        catalogUp,
        requestUp,
        locationUp,
        staffUp,
        authUp,
        audienceUp,
        actionUp,
      ])
        await migrate(db);
      await t.test(
        'unused migration rolls back and reapplies without grants',
        async () => {
          await up(db);
          assert.equal(
            (
              await db
                .selectFrom('role_permission')
                .where(
                  'permission_key',
                  '=',
                  'service_request.reference.manage',
                )
                .selectAll()
                .execute()
            ).length,
            0,
          );
          await down(db);
        },
      );
      const seeds: {
        org: string;
        category: string;
        service: string;
        version: string;
      }[] = [];
      for (let i = 0; i < 2; i++) {
        const org = randomUUID(),
          department = randomUUID(),
          category = randomUUID(),
          service = randomUUID(),
          version = randomUUID();
        await db
          .insertInto('organization')
          .values({
            id: org,
            name: 'Fictional',
            short_name: 'Test',
            slug: org,
            status: 'active',
            default_business_timezone: 'America/New_York',
          })
          .execute();
        await db
          .insertInto('department')
          .values({
            id: department,
            organization_id: org,
            name: 'Test',
            description: null,
            status: 'active',
            display_order: 1,
          })
          .execute();
        await db
          .insertInto('category')
          .values({
            id: category,
            organization_id: org,
            department_id: department,
            division_id: null,
            name: 'Test',
            description: 'Test',
            icon_key: 'test',
            aliases: [],
            keywords: [],
            status: 'active',
            display_order: 1,
          })
          .execute();
        await db
          .insertInto('service_definition')
          .values({
            id: service,
            organization_id: org,
            category_id: category,
            service_key: 'test',
            status: 'active',
            current_published_version_id: null,
          })
          .execute();
        await db
          .insertInto('service_definition_version')
          .values({
            id: version,
            organization_id: org,
            service_definition_id: service,
            version_number: 1,
            name: 'Test',
            resident_description: 'Test',
            icon_key: 'test',
            aliases: [],
            keywords: [],
            default_priority: 'medium',
            location_policy: 'not_applicable',
            geographic_eligibility_mode: 'no_geographic_restriction',
            anonymous_reporting_policy: 'allowed',
            status: 'published',
            published_at: new Date(),
            routing_metadata: null,
          })
          .execute();
        await db
          .updateTable('service_definition')
          .set({ current_published_version_id: version })
          .where('id', '=', service)
          .execute();
        seeds.push({ org, category, service, version });
      }
      const a = seeds[0],
        b = seeds[1];
      assert.ok(a);
      assert.ok(b);
      const historical = randomUUID();
      await db
        .insertInto('service_request')
        .values({
          id: historical,
          organization_id: a.org,
          reference_number: 'SR-202609-000007',
          service_definition_id: a.service,
          service_definition_version_id: a.version,
          category_id: a.category,
          status: 'open',
          priority: 'medium',
          description: 'Fictional historical request',
          reporting_identity: 'anonymous',
        })
        .execute();
      await sql`insert into service_request_reference_sequence(period_key,last_value) values ('202609',23)`.execute(
        db,
      );
      const before = await db
        .selectFrom('service_request')
        .selectAll()
        .execute();
      await up(db);
      await t.test(
        'migration preserves full historical rows and seeds authoritative global high-water per Organization',
        async () => {
          assert.deepEqual(
            await db.selectFrom('service_request').selectAll().execute(),
            before,
          );
          for (const seed of seeds)
            assert.equal(
              (
                await db
                  .selectFrom('service_request_reference_sequence')
                  .select('last_value')
                  .where('organization_id', '=', seed.org)
                  .executeTakeFirstOrThrow()
              ).last_value,
              '23',
            );
          await assert.rejects(db.transaction().execute((trx) => down(trx)));
        },
      );
      const saved = await db
        .selectFrom('service_request')
        .selectAll()
        .where('id', '=', historical)
        .executeTakeFirstOrThrow();
      await assert.rejects(
        db
          .insertInto('service_request')
          .values({ ...saved, id: randomUUID() })
          .execute(),
      );
      const repository = new ServiceRequestRepository();
      const database = { client: db } as DatabaseService;
      const configuration = new ReferenceConfigurationService(database);
      const access = (org: string): StaffAccess => ({
        organizationId: org,
        tenantId: randomUUID(),
        objectId: randomUUID(),
        staffIdentityId: randomUUID(),
        displayName: 'Test',
        scopes: [],
        permissions: ['service_request.reference.manage'],
        departmentIds: [],
        divisionIds: [],
        development: false,
      });
      await operationalUp(db);
      await ownershipUp(db);
      await defaultAssignmentUp(db);
      const create = (seed: typeof a, date = '2026-09-15T12:00:00Z') =>
        new CreateServiceRequestService(
          { get: () => seed.org } as never,
          database,
          repository,
          {
            execute: () => {
              throw Error('Unexpected GIS call');
            },
          } as never,
        ).execute(
          {
            serviceDefinitionId: seed.service,
            serviceDefinitionVersionId: seed.version,
            description: 'F033 synthetic',
            reportingIdentity: 'anonymous',
            answers: [],
          },
          new Date(date),
        );
      const set = async (
        org: string,
        change: Partial<typeof defaultReferencePolicy>,
      ) => {
        const current = await configuration.get(access(org));
        return configuration.set(
          { ...current, ...change, expectedRevision: current.revision },
          access(org),
        );
      };
      await t.test(
        '50 simultaneous requests per Organization have unique references and independent equal visible numbers',
        async () => {
          const [left, right] = await Promise.all([
            Promise.all(Array.from({ length: 50 }, () => create(a))),
            Promise.all(Array.from({ length: 50 }, () => create(b))),
          ]);
          for (const results of [left, right]) {
            assert.equal(
              new Set(results.map((r) => r.referenceNumber)).size,
              50,
            );
            assert.deepEqual(
              results
                .map((r) => Number(r.referenceNumber.slice(-6)))
                .sort((x, y) => x - y),
              Array.from({ length: 50 }, (_, i) => i + 24),
            );
          }
          for (const seed of seeds)
            assert.equal(
              (
                await db
                  .selectFrom('service_request_reference_sequence')
                  .select('last_value')
                  .where('organization_id', '=', seed.org)
                  .executeTakeFirstOrThrow()
              ).last_value,
              '73',
            );
          const lookup = await db
            .transaction()
            .execute((trx) =>
              repository.findByReference(b.org, 'SR-202609-000024', trx),
            );
          assert.equal(lookup?.organization_id, b.org);
          assert.equal(
            await db
              .transaction()
              .execute((trx) =>
                repository.findByReference(b.org, 'SR-202609-000007', trx),
              ),
            undefined,
          );
        },
      );
      await t.test(
        'format changes retain counters and immutable history; preview consumes nothing',
        async () => {
          const snapshot = await db
            .selectFrom('service_request')
            .select(['id', 'reference_number'])
            .orderBy('id')
            .execute();
          await set(a.org, { prefix: 'REQ' });
          assert.equal((await create(a)).referenceNumber, 'REQ-202609-000074');
          await set(a.org, { sequenceWidth: 8 });
          assert.equal(
            (await create(a)).referenceNumber,
            'REQ-202609-00000075',
          );
          await set(a.org, { separator: '' });
          assert.equal((await create(a)).referenceNumber, 'REQ20260900000076');
          const counters = await db
            .selectFrom('service_request_reference_sequence')
            .selectAll()
            .orderBy('organization_id')
            .execute();
          const preview = await configuration.get(
            access(a.org),
            new Date('2026-09-15T12:00:00Z'),
          );
          assert.equal(preview.exampleReference, 'REQ20260900000001');
          assert.deepEqual(
            await db
              .selectFrom('service_request_reference_sequence')
              .selectAll()
              .orderBy('organization_id')
              .execute(),
            counters,
          );
          for (const old of snapshot)
            assert.deepEqual(
              await db
                .selectFrom('service_request')
                .select(['id', 'reference_number'])
                .where('id', '=', old.id)
                .executeTakeFirstOrThrow(),
              old,
            );
          await assert.rejects(
            db
              .updateTable('service_request')
              .set({ reference_number: 'CHANGED' })
              .where('id', '=', historical)
              .execute(),
          );
        },
      );
      await t.test(
        'yearly and never policies, period boundaries, width overflow and formatting isolation',
        async () => {
          await set(a.org, {
            prefix: 'SR',
            dateComponent: 'year',
            resetPolicy: 'yearly',
            separator: '-',
            sequenceWidth: 6,
          });
          await set(b.org, {
            prefix: 'CASE',
            dateComponent: 'none',
            resetPolicy: 'never',
            separator: '-',
            sequenceWidth: 8,
          });
          assert.equal(
            (await create(a, '2026-12-31T23:00:00Z')).referenceNumber,
            'SR-2026-000001',
          );
          assert.equal((await create(b)).referenceNumber, 'CASE-00000001');
          assert.equal(
            (await create(a, '2027-01-01T04:59:59Z')).referenceNumber,
            'SR-2026-000002',
          );
          assert.equal(
            (await create(a, '2027-01-01T05:00:00Z')).referenceNumber,
            'SR-2027-000001',
          );
          assert.equal(
            (await create(b, '2027-01-01T05:00:00Z')).referenceNumber,
            'CASE-00000002',
          );
          await set(b.org, { sequenceWidth: 4 });
          await db
            .updateTable('service_request_reference_sequence')
            .set({ last_value: '9997' })
            .where('organization_id', '=', b.org)
            .where('period_key', '=', 'never')
            .execute();
          for (const number of [9998, 9999, 10000, 10001])
            assert.equal(
              (await create(b)).referenceNumber,
              `CASE-${String(number)}`,
            );
          await set(a.org, defaultReferencePolicy);
          assert.equal(
            (await create(a, '2026-10-01T03:59:59Z')).referenceNumber,
            'SR-202609-000077',
          );
          assert.equal(
            (await create(a, '2026-10-01T04:00:00Z')).referenceNumber,
            'SR-202610-000001',
          );
        },
      );
      await t.test(
        'unsafe historical format collisions and stale revisions fail without mutating counters',
        async () => {
          // This would reproduce existing SR-2026-000001 under a different, uninitialized counter.
          await assert.rejects(
            set(a.org, {
              prefix: 'SR-2026',
              dateComponent: 'none',
              resetPolicy: 'never',
            }),
          );
          // Alphanumeric/no-separator ambiguity can also collide: old REQ20260900000076 vs constant prefix.
          await assert.rejects(
            set(a.org, {
              prefix: 'REQ202609',
              dateComponent: 'none',
              resetPolicy: 'never',
              separator: '',
              sequenceWidth: 8,
            }),
            /conflicts with issued/,
          );
          const current = await configuration.get(access(a.org));
          const results = await Promise.allSettled([
            configuration.set(
              { ...current, prefix: 'X', expectedRevision: current.revision },
              access(a.org),
            ),
            configuration.set(
              { ...current, prefix: 'Y', expectedRevision: current.revision },
              access(a.org),
            ),
          ]);
          assert.equal(
            results.filter((r) => r.status === 'fulfilled').length,
            1,
          );
          assert.equal(
            results.filter((r) => r.status === 'rejected').length,
            1,
          );
        },
      );
      await t.test(
        'creation concurrent with configuration changes uses one complete policy, without rewriting history',
        async () => {
          const before = await db
            .selectFrom('service_request')
            .select(['id', 'reference_number'])
            .orderBy('id')
            .execute();
          const current = await configuration.get(access(a.org));
          const [created] = await Promise.all([
            Promise.all(
              Array.from({ length: 20 }, () =>
                create(a, '2028-03-01T12:00:00Z'),
              ),
            ),
            configuration.set(
              {
                ...current,
                prefix: 'NEW',
                sequenceWidth: 8,
                separator: '',
                expectedRevision: current.revision,
              },
              access(a.org),
            ),
          ]);
          for (const item of created)
            assert.match(
              item.referenceNumber,
              /^(?:[XY]-202803-[0-9]{6}|NEW202803[0-9]{8})$/,
            );
          assert.equal(new Set(created.map((r) => r.referenceNumber)).size, 20);
          for (const old of before)
            assert.deepEqual(
              await db
                .selectFrom('service_request')
                .select(['id', 'reference_number'])
                .where('id', '=', old.id)
                .executeTakeFirstOrThrow(),
              old,
            );
          await set(a.org, { prefix: 'X', sequenceWidth: 6, separator: '-' });
        },
      );
      await t.test(
        'concurrent Organizations retain different configured formats and isolated counters',
        async () => {
          await set(a.org, {
            prefix: 'SR',
            dateComponent: 'year',
            resetPolicy: 'yearly',
            sequenceWidth: 6,
            separator: '-',
          });
          await set(b.org, {
            prefix: 'CASE',
            dateComponent: 'none',
            resetPolicy: 'never',
            sequenceWidth: 8,
            separator: '-',
          });
          const [left, right] = await Promise.all([
            Promise.all(
              Array.from({ length: 15 }, () =>
                create(a, '2029-06-01T12:00:00Z'),
              ),
            ),
            Promise.all(
              Array.from({ length: 15 }, () =>
                create(b, '2029-06-01T12:00:00Z'),
              ),
            ),
          ]);
          assert.deepEqual(
            left.map((r) => r.referenceNumber).sort(),
            Array.from(
              { length: 15 },
              (_, i) => `SR-2029-${String(i + 1).padStart(6, '0')}`,
            ),
          );
          assert.deepEqual(
            right.map((r) => r.referenceNumber).sort(),
            Array.from(
              { length: 15 },
              (_, i) => `CASE-${String(i + 10002).padStart(8, '0')}`,
            ),
          );
          await set(a.org, defaultReferencePolicy);
        },
      );
      await t.test(
        'failed creation rolls back allocated counter and all request writes',
        async () => {
          const counter = await db
            .selectFrom('service_request_reference_sequence')
            .selectAll()
            .where('organization_id', '=', a.org)
            .where('period_key', '=', '202609')
            .executeTakeFirstOrThrow();
          const count = await db
            .selectFrom('service_request')
            .select(({ fn }) => fn.countAll().as('n'))
            .executeTakeFirstOrThrow();
          await sql`create function reject_f033_activity() returns trigger language plpgsql as $$ begin raise exception 'Synthetic activity failure'; end $$;create trigger f033_activity_failure before insert on activity for each row execute function reject_f033_activity()`.execute(
            db,
          );
          await assert.rejects(create(a));
          assert.deepEqual(
            await db
              .selectFrom('service_request_reference_sequence')
              .selectAll()
              .where('organization_id', '=', a.org)
              .where('period_key', '=', '202609')
              .executeTakeFirstOrThrow(),
            counter,
          );
          assert.deepEqual(
            await db
              .selectFrom('service_request')
              .select(({ fn }) => fn.countAll().as('n'))
              .executeTakeFirstOrThrow(),
            count,
          );
          await sql`drop trigger f033_activity_failure on activity;drop function reject_f033_activity()`.execute(
            db,
          );
          assert.ok((await create(a)).referenceNumber.endsWith('000078'));
        },
      );
    } finally {
      await db.destroy();
      await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  },
);
