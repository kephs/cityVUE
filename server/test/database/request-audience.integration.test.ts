import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import request from 'supertest';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import { up as catalogUp } from '../../migrations/20260902000000-create-organization-service-catalog.js';
import { up as requestUp } from '../../migrations/20260902010000-create-service-request-foundation.js';
import { up as eligibilityUp } from '../../migrations/20260902030000-add-location-eligibility-snapshot.js';
import { up as staffUp } from '../../migrations/20260903010000-add-staff-assignment-workflow-foundation.js';
import { up as authUp } from '../../migrations/20260903020000-add-entra-rbac-foundation.js';
import {
  up,
  down,
} from '../../migrations/20260919000000-add-request-audience-assisted-intake.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { EntraTokenService } from '../../src/auth/entra-token.service.js';
import { ServiceRequestRepository } from '../../src/service-request/service-request.repository.js';

const url = process.env.TEST_DATABASE_URL;
test(
  'F029 database-backed intake enforces audience, identity, permissions and read isolation',
  { skip: !url },
  async (t) => {
    const schema = `audience_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: url });
    await prepareDatabaseExtensions(admin);
    await admin.query(`create schema "${schema}"`);
    const db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: url,
          options: `-c search_path=${schema}`,
        }),
      }),
    });
    const org = randomUUID(),
      otherOrg = randomUUID(),
      department = randomUUID(),
      category = randomUUID(),
      service = randomUUID(),
      version = randomUUID(),
      tenant = randomUUID();
    const creator = randomUUID(),
      publicOnly = randomUUID(),
      otherStaff = randomUUID(),
      noGrant = randomUUID();
    try {
      for (const migrate of [
        catalogUp,
        requestUp,
        eligibilityUp,
        staffUp,
        authUp,
      ])
        await migrate(db);
      for (const id of [org, otherOrg])
        await db
          .insertInto('organization')
          .values({
            id,
            name: 'Fictional intake organization',
            short_name: 'Test',
            slug: id,
            status: 'active',
            default_business_timezone: 'Etc/UTC',
          })
          .execute();
      await db
        .insertInto('department')
        .values({
          id: department,
          organization_id: org,
          name: 'Test service',
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
          name: 'Test category',
          description: 'Fictional',
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
          name: 'Test intake',
          resident_description: 'Fictional',
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
      const historical = randomUUID();
      await db
        .insertInto('service_request')
        .values({
          id: historical,
          organization_id: org,
          reference_number: 'SR-200001-000001',
          service_definition_id: service,
          service_definition_version_id: version,
          category_id: category,
          status: 'open',
          priority: 'medium',
          description: 'Historical resident request',
          reporting_identity: 'anonymous',
        })
        .execute();
      await t.test(
        'migration backfills historical PUBLIC/WEB without staff attribution and rolls back/reapplies safely',
        async () => {
          await up(db);
          let row = await db
            .selectFrom('service_request')
            .selectAll()
            .where('id', '=', historical)
            .executeTakeFirstOrThrow();
          assert.equal(row.audience, 'public');
          assert.equal(row.intake_channel, 'web');
          assert.equal(row.submitted_by_staff_identity_id, null);
          assert.equal(row.requester_staff_identity_id, null);
          assert.equal(
            (await db.selectFrom('role_permission').selectAll().execute())
              .length,
            0,
          );
          await down(db);
          await up(db);
          row = await db
            .selectFrom('service_request')
            .selectAll()
            .where('id', '=', historical)
            .executeTakeFirstOrThrow();
          assert.equal(row.audience, 'public');
        },
      );
      await t.test(
        'database rejects invalid audience/channel, unaffiliated internal data and cross-Organization staff references',
        async () => {
          await assert.rejects(
            db
              .updateTable('service_request')
              .set({ audience: 'invalid' })
              .where('id', '=', historical)
              .execute(),
          );
          await assert.rejects(
            db
              .updateTable('service_request')
              .set({ intake_channel: 'invalid' })
              .where('id', '=', historical)
              .execute(),
          );
          await assert.rejects(
            db
              .updateTable('service_request')
              .set({ audience: 'internal' })
              .where('id', '=', historical)
              .execute(),
          );
        },
      );
      await db
        .insertInto('permission')
        .values(
          [
            'service_request.view',
            'service_request.assign',
            'service_request.start_work',
          ].map((permission_key) => ({ permission_key })),
        )
        .execute();
      for (const [id, owner, keys] of [
        [
          creator,
          org,
          [
            'service_request.create',
            'service_request.create_internal',
            'service_request.view',
            'service_request.assign',
            'service_request.start_work',
          ],
        ],
        [publicOnly, org, ['service_request.create', 'service_request.view']],
        [
          otherStaff,
          otherOrg,
          [
            'service_request.create',
            'service_request.create_internal',
            'service_request.view',
          ],
        ],
        [noGrant, org, ['service_request.view']],
      ] as const) {
        await db
          .insertInto('staff_identity')
          .values({
            id,
            organization_id: owner,
            entra_tenant_id: tenant,
            entra_object_id: id,
            display_name: 'Fictional staff',
            email: null,
            active: true,
          })
          .execute();
        const role = randomUUID();
        await db
          .insertInto('role')
          .values({ id: role, organization_id: owner, name: id, active: true })
          .execute();
        for (const key of keys)
          await db
            .insertInto('role_permission')
            .values({
              organization_id: owner,
              role_id: role,
              permission_key: key,
            })
            .execute();
        await db
          .insertInto('staff_role_assignment')
          .values({
            organization_id: owner,
            staff_identity_id: id,
            role_id: role,
            active: true,
          })
          .execute();
        if (owner === org)
          await db
            .insertInto('staff_department_membership')
            .values({
              organization_id: org,
              staff_identity_id: id,
              department_id: department,
              active: true,
            })
            .execute();
      }
      await assert.rejects(
        db
          .updateTable('service_request')
          .set({ submitted_by_staff_identity_id: otherStaff })
          .where('id', '=', historical)
          .execute(),
      );
      process.env.NODE_ENV = 'test';
      process.env.CITYVUE_DEPLOYMENT_PROFILE = 'development';
      process.env.DATABASE_URL =
        'postgresql://example:placeholder@localhost/test';
      process.env.LOG_LEVEL = 'silent';
      process.env.DEVELOPMENT_ORGANIZATION_ID = org;
      process.env.RATE_LIMIT_MAX = '1000';
      delete process.env.ENTRA_TENANT_ID;
      delete process.env.ENTRA_API_CLIENT_ID;
      delete process.env.ENTRA_EXPECTED_AUDIENCE;
      const [{ AppModule }, { configureApplication }] = await Promise.all([
        import('../../src/app.module.js'),
        import('../../src/bootstrap.js'),
      ]);
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(DatabaseService)
        .useValue({ client: db, status: async () => 'up' })
        .overrideProvider(EntraTokenService)
        .useValue({
          enabled: true,
          validate: async (token: string) => {
            if (!/^[0-9a-f-]{36}$/.test(token))
              throw new UnauthorizedException();
            return {
              tenantId: tenant,
              objectId: token,
              scopes: ['access_as_user'],
              tokenVersion: '2.0',
            };
          },
          hasRequiredScope: () => true,
        })
        .compile();
      const app = module.createNestApplication();
      configureApplication(app);
      await app.init();
      const publicPath = '/api/v1/service-requests',
        staffPath = '/api/v1/staff/service-requests';
      const base = {
        serviceDefinitionId: service,
        serviceDefinitionVersionId: version,
        description: 'Fictional request',
        reportingIdentity: 'anonymous',
        answers: [],
      };
      const assisted = {
        ...base,
        audience: 'public',
        intakeChannel: 'phone',
        reportingIdentity: 'identified',
        contact: { name: 'Fictional Resident', email: 'resident@example.test' },
      };
      const internal = {
        ...base,
        audience: 'internal',
        intakeChannel: 'staff',
        reportingIdentity: 'identified',
      };
      let publicId = '',
        internalId = '';
      try {
        await t.test(
          'public intake persists PUBLIC/WEB and rejects classification/submitter/Organization forgery',
          async () => {
            const response = await request(app.getHttpServer())
              .post(publicPath)
              .send(base)
              .expect(201);
            const body = response.body as { id: string };
            publicId = body.id;
            assert.deepEqual(Object.keys(body).sort(), [
              'createdAt',
              'id',
              'referenceNumber',
              'status',
            ]);
            const row = await db
              .selectFrom('service_request')
              .selectAll()
              .where('id', '=', publicId)
              .executeTakeFirstOrThrow();
            assert.equal(row.audience, 'public');
            assert.equal(row.intake_channel, 'web');
            assert.equal(row.submitted_by_staff_identity_id, null);
            for (const extra of [
              { audience: 'internal' },
              { audience: 'public' },
              { intakeChannel: 'staff' },
              { submittedBy: creator },
              { submittedByStaffIdentityId: creator },
              { organizationId: otherOrg },
              { isStaff: true },
            ])
              await request(app.getHttpServer())
                .post(publicPath)
                .send({ ...base, ...extra })
                .expect(400);
          },
        );
        await t.test(
          'staff route rejects anonymous, invalid, unprovisioned and insufficient-permission callers',
          async () => {
            await request(app.getHttpServer())
              .post(staffPath)
              .send(assisted)
              .expect(401);
            await request(app.getHttpServer())
              .post(staffPath)
              .set('Authorization', 'Bearer invalid')
              .send(assisted)
              .expect(401);
            await request(app.getHttpServer())
              .post(staffPath)
              .set('Authorization', `Bearer ${randomUUID()}`)
              .send(assisted)
              .expect(403);
            await request(app.getHttpServer())
              .post(staffPath)
              .set('Authorization', `Bearer ${noGrant}`)
              .send(assisted)
              .expect(403);
            await request(app.getHttpServer())
              .post(staffPath)
              .set('Authorization', `Bearer ${publicOnly}`)
              .send(internal)
              .expect(403);
          },
        );
        await t.test(
          'assisted PUBLIC preserves resident requester and stable authenticated staff submitter/activity',
          async () => {
            const response = await request(app.getHttpServer())
              .post(staffPath)
              .set('Authorization', `Bearer ${publicOnly}`)
              .send(assisted)
              .expect(201);
            const body = response.body as { id: string };
            assert.deepEqual(Object.keys(body).sort(), [
              'createdAt',
              'id',
              'referenceNumber',
              'status',
            ]);
            const row = await db
              .selectFrom('service_request')
              .selectAll()
              .where('id', '=', body.id)
              .executeTakeFirstOrThrow();
            assert.equal(row.audience, 'public');
            assert.equal(row.intake_channel, 'phone');
            assert.equal(row.submitted_by_staff_identity_id, publicOnly);
            assert.equal(row.requester_staff_identity_id, null);
            const contact = await db
              .selectFrom('requester_contact')
              .selectAll()
              .where('service_request_id', '=', body.id)
              .executeTakeFirstOrThrow();
            assert.equal(contact.name, 'Fictional Resident');
            assert.equal(contact.email, 'resident@example.test');
            const activity = await db
              .selectFrom('activity')
              .selectAll()
              .where('service_request_id', '=', body.id)
              .executeTakeFirstOrThrow();
            assert.equal(activity.actor_type, 'staff');
            assert.equal(activity.staff_identity_id, publicOnly);
            assert.equal(
              JSON.stringify(activity.metadata).includes(
                'resident@example.test',
              ),
              false,
            );
          },
        );
        await t.test(
          'authorized INTERNAL self-service persists separate stable requester/submitter references',
          async () => {
            const response = await request(app.getHttpServer())
              .post(staffPath)
              .set('Authorization', `Bearer ${creator}`)
              .send(internal)
              .expect(201);
            internalId = (response.body as { id: string }).id;
            const row = await db
              .selectFrom('service_request')
              .selectAll()
              .where('id', '=', internalId)
              .executeTakeFirstOrThrow();
            assert.equal(row.audience, 'internal');
            assert.equal(row.intake_channel, 'staff');
            assert.equal(row.submitted_by_staff_identity_id, creator);
            assert.equal(row.requester_staff_identity_id, creator);
            assert.equal(
              (
                await db
                  .selectFrom('requester_contact')
                  .selectAll()
                  .where('service_request_id', '=', internalId)
                  .execute()
              ).length,
              0,
            );
            await request(app.getHttpServer())
              .post(staffPath)
              .set('Authorization', `Bearer ${creator}`)
              .send({ ...internal, contact: assisted.contact })
              .expect(400);
          },
        );
        await t.test(
          'staff cannot forge actors/scope or create using another Organizations catalog',
          async () => {
            for (const extra of [
              { organizationId: otherOrg },
              { submittedByStaffIdentityId: otherStaff },
              { requesterStaffIdentityId: otherStaff },
            ])
              await request(app.getHttpServer())
                .post(staffPath)
                .set('Authorization', `Bearer ${creator}`)
                .send({ ...assisted, ...extra })
                .expect(400);
            await request(app.getHttpServer())
              .post(staffPath)
              .set('Authorization', `Bearer ${otherStaff}`)
              .send(assisted)
              .expect(404);
          },
        );
        await t.test(
          'all existing reads withhold INTERNAL even from creator; PUBLIC list omits PII and cross-org reads fail',
          async () => {
            await request(app.getHttpServer())
              .get(`${publicPath}/${internalId}`)
              .expect(401);
            for (const id of [creator, publicOnly, noGrant, otherStaff])
              await request(app.getHttpServer())
                .get(`${publicPath}/${internalId}`)
                .set('Authorization', `Bearer ${id}`)
                .expect(404);
            await request(app.getHttpServer())
              .get(`${publicPath}/${publicId}`)
              .set('Authorization', `Bearer ${otherStaff}`)
              .expect(404);
            const response = await request(app.getHttpServer())
              .get(publicPath)
              .set('Authorization', `Bearer ${creator}`)
              .expect(200);
            assert.equal(
              JSON.stringify(response.body).includes(internalId),
              false,
            );
            assert.equal(
              JSON.stringify(response.body).includes('resident@example.test'),
              false,
            );
            const repository = new ServiceRequestRepository();
            assert.equal(
              await db
                .transaction()
                .execute((trx) => repository.loadDetails(trx, org, internalId)),
              undefined,
            );
            const list = await repository.listForOrganization(db, org, {
              sort: 'newest',
              page: 1,
              pageSize: 100,
            });
            assert.equal(
              list.rows.some((row) => row.id === internalId),
              false,
            );
            assert.equal(list.total, 3);
            const empty = await request(app.getHttpServer())
              .get(publicPath)
              .set('Authorization', `Bearer ${otherStaff}`)
              .expect(200);
            assert.equal((empty.body as { total: number }).total, 0);
            const internalRow = await db
              .selectFrom('service_request')
              .select('reference_number')
              .where('id', '=', internalId)
              .executeTakeFirstOrThrow();
            assert.equal(
              await db
                .transaction()
                .execute((trx) =>
                  repository.findByReference(
                    org,
                    internalRow.reference_number,
                    trx,
                  ),
                ),
              undefined,
            );
            await request(app.getHttpServer())
              .post(`${publicPath}/${internalId}/assignment`)
              .set('Authorization', `Bearer ${creator}`)
              .send({ expectedRevision: 1, assignmentType: 'unassigned' })
              .expect(404);
            await request(app.getHttpServer())
              .post(`${publicPath}/${internalId}/workflow`)
              .set('Authorization', `Bearer ${creator}`)
              .send({ expectedRevision: 1, action: 'start_work' })
              .expect(404);
            const unchanged = await db
              .selectFrom('service_request')
              .select(['revision', 'status'])
              .where('id', '=', internalId)
              .executeTakeFirstOrThrow();
            assert.equal(unchanged.revision, 1);
            assert.equal(unchanged.status, 'open');
          },
        );
        await t.test(
          'rollback refuses to lose audience, staff attribution, or active permission dependencies',
          async () => {
            await assert.rejects(down(db));
            assert.equal(
              (
                await db
                  .selectFrom('service_request')
                  .select('audience')
                  .where('id', '=', internalId)
                  .executeTakeFirstOrThrow()
              ).audience,
              'internal',
            );
            const count = await sql<{
              n: number;
            }>`select count(*)::int n from activity where actor_type='staff'`.execute(
              db,
            );
            assert.equal(count.rows[0]?.n, 2);
          },
        );
      } finally {
        await app.close();
      }
    } finally {
      await db.destroy();
      await admin.query(`drop schema if exists "${schema}" cascade`);
      await admin.end();
    }
  },
);
