import { up as referenceUp } from '../../migrations/20260919040000-configure-request-references.js';
import {
  up as actionUp,
  down as actionDown,
} from '../../migrations/20260919030000-add-issue-action.js';
import {
  up as lifecycleUp,
  down as lifecycleDown,
} from '../../migrations/20260919020000-add-internal-request-lifecycle.js';
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

import {
  up as internalReadUp,
  down as internalReadDown,
} from '../../migrations/20260919010000-add-internal-request-read-permission.js';

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
      await lifecycleUp(db);
      await actionUp(db);
      await referenceUp(db);
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
        const internalPath = '/api/v1/staff/internal-service-requests';
        const getInternal = (path: string, actor: string = noGrant) =>
          request(app.getHttpServer())
            .get(path)
            .set('Authorization', `Bearer ${actor}`);
        await t.test(
          'F030 permission migration grants nothing and supports ungranted rollback',
          async () => {
            await internalReadUp(db);
            assert.equal(
              (
                await db
                  .selectFrom('role_permission')
                  .selectAll()
                  .where('permission_key', '=', 'service_request.internal.read')
                  .execute()
              ).length,
              0,
            );
            await internalReadDown(db);
            await internalReadUp(db);
          },
        );
        await t.test(
          'F030 anonymous, invalid, unprovisioned and creator identities have no internal read access',
          async () => {
            for (const path of [
              internalPath,
              `${internalPath}/${internalId}`,
            ]) {
              await request(app.getHttpServer()).get(path).expect(401);
              await getInternal(path, 'invalid').expect(401);
              await getInternal(path, randomUUID()).expect(403);
              for (const actor of [creator, publicOnly, noGrant])
                await getInternal(path, actor).expect(403);
            }
          },
        );
        const readerRole = await db
          .selectFrom('staff_role_assignment')
          .select('role_id')
          .where('staff_identity_id', '=', noGrant)
          .executeTakeFirstOrThrow();
        for (const actor of [noGrant, otherStaff]) {
          const assignment = await db
            .selectFrom('staff_role_assignment')
            .selectAll()
            .where('staff_identity_id', '=', actor)
            .executeTakeFirstOrThrow();
          await db
            .insertInto('role_permission')
            .values({
              organization_id: assignment.organization_id,
              role_id: assignment.role_id,
              permission_key: 'service_request.internal.read',
            })
            .execute();
        }
        const otherDepartment = randomUUID(),
          otherCategory = randomUUID(),
          otherService = randomUUID(),
          otherVersion = randomUUID(),
          otherInternal = randomUUID();
        await sql`insert into department(id,organization_id,name,status,display_order)
          values(${otherDepartment},${otherOrg},'Other fictional department','active',1);
        `.execute(db);
        await sql`insert into category(id,organization_id,department_id,name,description,icon_key,aliases,keywords,status,display_order)
          select ${otherCategory},${otherOrg},${otherDepartment},name,description,icon_key,aliases,keywords,status,display_order from category where id=${category}`.execute(
          db,
        );
        await sql`insert into service_definition(id,organization_id,category_id,service_key,status)
          values(${otherService},${otherOrg},${otherCategory},'other-test','active')`.execute(
          db,
        );
        await sql`insert into service_definition_version(id,organization_id,service_definition_id,version_number,name,resident_description,icon_key,aliases,keywords,default_priority,location_policy,geographic_eligibility_mode,anonymous_reporting_policy,status,published_at)
          select ${otherVersion},${otherOrg},${otherService},1,name,resident_description,icon_key,aliases,keywords,default_priority,location_policy,geographic_eligibility_mode,anonymous_reporting_policy,status,published_at from service_definition_version where id=${version}`.execute(
          db,
        );
        await db
          .insertInto('staff_department_membership')
          .values({
            organization_id: otherOrg,
            staff_identity_id: otherStaff,
            department_id: otherDepartment,
            active: true,
          })
          .execute();
        await db
          .insertInto('service_request')
          .values({
            id: otherInternal,
            organization_id: otherOrg,
            reference_number: 'SR-200001-000002',
            service_definition_id: otherService,
            service_definition_version_id: otherVersion,
            category_id: otherCategory,
            status: 'open',
            priority: 'medium',
            description: 'Other organization internal request',
            reporting_identity: 'identified',
            audience: 'internal',
            intake_channel: 'staff',
            submitted_by_staff_identity_id: otherStaff,
            requester_staff_identity_id: otherStaff,
          })
          .execute();
        await t.test(
          'F030 authorized internal list/count/detail are scoped and omit protected contact fields',
          async () => {
            // Defense against a future/imported contact row: the read projection must never join it.
            await db
              .insertInto('requester_contact')
              .values({
                organization_id: org,
                service_request_id: internalId,
                id: randomUUID(),
                name: 'Protected contact',
                email: 'private@example.test',
              })
              .execute();
            const list = await getInternal(internalPath).expect(200);
            const body = list.body as {
              total: number;
              items: { serviceRequestId: string }[];
            };
            assert.equal(body.total, 1);
            assert.deepEqual(
              body.items.map((row) => row.serviceRequestId),
              [internalId],
            );
            assert.equal(list.headers['cache-control'], 'no-store');
            const detail = await getInternal(
              `${internalPath}/${internalId}`,
            ).expect(200);
            assert.equal(
              (detail.body as { description: string }).description,
              internal.description,
            );
            assert.deepEqual(
              Object.keys(detail.body as object).sort(),
              [
                'serviceRequestId',
                'referenceNumber',
                'audience',
                'status',
                'priority',
                'createdAt',
                'updatedAt',
                'issueName',
                'categoryId',
                'departmentId',
                'divisionId',
                'description',
                'revision',
              ].sort(),
            );
            assert.equal(
              JSON.stringify(detail.body).includes('private@example.test'),
              false,
            );
            await getInternal(`${internalPath}/${publicId}`).expect(404);
            const publicList = await getInternal(publicPath).expect(200);
            assert.equal((publicList.body as { total: number }).total, 3);
            assert.equal(
              JSON.stringify(publicList.body).includes(internalId),
              false,
            );
            await getInternal(`${publicPath}/${internalId}`).expect(404);
            // This grant alone does not unlock existing PUBLIC/contact details.
            await db
              .deleteFrom('role_permission')
              .where('role_id', '=', readerRole.role_id)
              .where('permission_key', '=', 'service_request.view')
              .execute();
            await getInternal(`${publicPath}/${publicId}`).expect(403);
            await getInternal(`${internalPath}/${internalId}`).expect(200);
            await assert.rejects(internalReadDown(db));
          },
        );
        await t.test(
          'F030 cross-organization and forged query/header/body scope cannot reveal internal records',
          async () => {
            await getInternal(
              `${internalPath}/${internalId}`,
              otherStaff,
            ).expect(404);
            const otherList = await getInternal(
              internalPath,
              otherStaff,
            ).expect(200);
            assert.equal((otherList.body as { total: number }).total, 1);
            assert.equal(
              JSON.stringify(otherList.body).includes(internalId),
              false,
            );
            await getInternal(`${internalPath}/${otherInternal}`).expect(404);
            await getInternal(
              `${internalPath}/${otherInternal}`,
              otherStaff,
            ).expect(200);
            for (const path of [
              internalPath,
              `${internalPath}/${internalId}`,
            ]) {
              for (const extra of [
                { organizationId: org },
                { audience: 'internal' },
                { staffIdentityId: noGrant },
              ])
                await getInternal(path, otherStaff).query(extra).expect(400);
              const forged = await getInternal(path, otherStaff)
                .set('X-Organization-Id', org)
                .send({ organizationId: org, staffIdentityId: noGrant })
                .expect(path === internalPath ? 200 : 404);
              assert.equal(
                JSON.stringify(forged.body).includes(internalId),
                false,
              );
            }
            await getInternal(`${internalPath}/invalid`).expect(404);
            await getInternal(internalPath).query({ page: 0 }).expect(400);
            await getInternal(internalPath)
              .query({ pageSize: 101 })
              .expect(400);
            const page = await getInternal(internalPath)
              .query({ page: 2, pageSize: 1 })
              .expect(200);
            assert.equal((page.body as { total: number }).total, 1);
            assert.deepEqual((page.body as { items: unknown[] }).items, []);
          },
        );
        await t.test(
          'F030 division scope and Entra-only admission cannot be bypassed',
          async () => {
            const division = randomUUID();
            await db
              .insertInto('division')
              .values({
                id: division,
                organization_id: org,
                department_id: department,
                name: 'Fictional division',
                description: null,
                status: 'active',
                display_order: 1,
              })
              .execute();
            await db
              .updateTable('category')
              .set({ division_id: division })
              .where('id', '=', category)
              .execute();
            await getInternal(`${internalPath}/${internalId}`).expect(404);
            assert.equal(
              (
                (await getInternal(internalPath).expect(200)).body as {
                  total: number;
                }
              ).total,
              0,
            );
            await db
              .insertInto('staff_division_membership')
              .values({
                organization_id: org,
                staff_identity_id: noGrant,
                division_id: division,
                department_id: department,
                active: true,
              })
              .execute();
            await getInternal(`${internalPath}/${internalId}`).expect(200);
            await db
              .updateTable('category')
              .set({ division_id: null })
              .where('id', '=', category)
              .execute();
            const tokens = app.get(EntraTokenService);
            Reflect.set(tokens, 'enabled', false);
            try {
              await request(app.getHttpServer()).get(internalPath).expect(401);
              await request(app.getHttpServer())
                .get(`${internalPath}/${internalId}`)
                .expect(401);
            } finally {
              Reflect.set(tokens, 'enabled', true);
            }
          },
        );
        await t.test(
          'F030 department membership, organization status and permission revocation fail closed',
          async () => {
            await db
              .updateTable('staff_department_membership')
              .set({ active: false })
              .where('staff_identity_id', '=', noGrant)
              .execute();
            await getInternal(`${internalPath}/${internalId}`).expect(404);
            assert.equal(
              (
                (await getInternal(internalPath).expect(200)).body as {
                  total: number;
                }
              ).total,
              0,
            );
            await db
              .updateTable('staff_department_membership')
              .set({ active: true })
              .where('staff_identity_id', '=', noGrant)
              .execute();
            await db
              .updateTable('organization')
              .set({ status: 'inactive' })
              .where('id', '=', org)
              .execute();
            await getInternal(`${internalPath}/${internalId}`).expect(404);
            assert.equal(
              (
                (await getInternal(internalPath).expect(200)).body as {
                  total: number;
                }
              ).total,
              0,
            );
            await db
              .updateTable('organization')
              .set({ status: 'active' })
              .where('id', '=', org)
              .execute();
            await db
              .updateTable('staff_role_assignment')
              .set({ active: false })
              .where('staff_identity_id', '=', noGrant)
              .execute();
            await getInternal(internalPath).expect(403);
            await getInternal(`${internalPath}/${internalId}`).expect(403);
            await db
              .updateTable('staff_role_assignment')
              .set({ active: true })
              .where('staff_identity_id', '=', noGrant)
              .execute();
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
        const workflowPath = `${internalPath}/${internalId}/workflow`;
        const routingPath = `${internalPath}/${internalId}/routing`;
        const postAs = (path: string, body: object, actor: string = noGrant) =>
          request(app.getHttpServer())
            .post(path)
            .set('Authorization', `Bearer ${actor}`)
            .send(body);
        const start = { expectedRevision: 1, action: 'start_work' };
        await t.test(
          'F031 migration adds no grants and safely rolls back/reapplies before use',
          async () => {
            assert.equal(
              (
                await db
                  .selectFrom('role_permission')
                  .selectAll()
                  .where(
                    'permission_key',
                    '=',
                    'service_request.internal.update',
                  )
                  .execute()
              ).length,
              0,
            );
            await lifecycleDown(db);
            await lifecycleUp(db);
          },
        );
        await t.test(
          'F031 denies anonymous, invalid, ordinary staff, creator and read-only mutation',
          async () => {
            for (const [path, body] of [
              [workflowPath, start],
              [routingPath, { expectedRevision: 1, departmentId: department }],
            ] as const) {
              await request(app.getHttpServer())
                .post(path)
                .send(body)
                .expect(401);
              await postAs(path, body, 'invalid').expect(401);
              for (const actor of [publicOnly, creator, noGrant, otherStaff])
                await postAs(path, body, actor).expect(403);
            }
          },
        );
        for (const actor of [noGrant, otherStaff]) {
          const role = await db
            .selectFrom('staff_role_assignment')
            .selectAll()
            .where('staff_identity_id', '=', actor)
            .executeTakeFirstOrThrow();
          await db
            .insertInto('role_permission')
            .values({
              organization_id: role.organization_id,
              role_id: role.role_id,
              permission_key: 'service_request.internal.update',
            })
            .execute();
        }
        await t.test(
          'F031 scope forgery and PUBLIC/cross-organization targets fail without mutation',
          async () => {
            await postAs(workflowPath, start, otherStaff).expect(404);
            await postAs(
              `${internalPath}/${otherInternal}/workflow`,
              start,
            ).expect(404);
            await postAs(`${internalPath}/${publicId}/workflow`, start).expect(
              404,
            );
            await postAs(workflowPath, {
              ...start,
              organizationId: org,
            }).expect(400);
            await postAs(workflowPath, start, otherStaff)
              .set('X-Organization-Id', org)
              .expect(404);
            for (const extra of [
              { status: 'closed' },
              { audience: 'public' },
              { description: 'forged' },
              { staffIdentityId: noGrant },
            ])
              await postAs(workflowPath, { ...start, ...extra }).expect(400);
            await postAs(workflowPath, {
              ...start,
              action: 'arbitrary',
            }).expect(400);
            await postAs(workflowPath, { ...start, action: 'resume' }).expect(
              409,
            );
            await postAs(workflowPath, { ...start, action: 'close' }).expect(
              400,
            );
            await db
              .updateTable('staff_department_membership')
              .set({ active: false })
              .where('staff_identity_id', '=', noGrant)
              .execute();
            await postAs(workflowPath, start).expect(404);
            await db
              .updateTable('staff_department_membership')
              .set({ active: true })
              .where('staff_identity_id', '=', noGrant)
              .execute();
          },
        );
        await t.test(
          'F031 workflow is revision guarded, minimally projected and atomically audited',
          async () => {
            const responses = await Promise.all([
              postAs(workflowPath, start),
              postAs(workflowPath, start),
            ]);
            assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
            const ok = responses.find((r) => r.status === 200);
            assert.ok(ok);
            assert.deepEqual(
              Object.keys(ok.body as object).sort(),
              [
                'serviceRequestId',
                'status',
                'revision',
                'updatedAt',
                'departmentId',
                'divisionId',
              ].sort(),
            );
            assert.equal(ok.headers['cache-control'], 'no-store');
            let revision = 2;
            for (const [action, status] of [
              ['hold', 'on_hold'],
              ['resume', 'in_progress'],
              ['close', 'closed'],
              ['reopen', 'open'],
            ] as const) {
              const response = await postAs(workflowPath, {
                expectedRevision: revision,
                action,
                reason: 'Private operational reason',
                resolutionSummary: 'Private operational summary',
              }).expect(200);
              assert.equal(
                (response.body as { status: string }).status,
                status,
              );
              revision++;
            }
            const audit = await db
              .selectFrom('activity')
              .selectAll()
              .where('service_request_id', '=', internalId)
              .where('actor_type', '=', 'staff')
              .execute();
            const changes = audit.filter(
              (row) => (row.metadata as { policy?: string }).policy === 'F031',
            );
            assert.equal(changes.length, 5);
            for (const row of changes) {
              assert.equal(row.organization_id, org);
              assert.equal(row.staff_identity_id, noGrant);
              assert.deepEqual(
                Object.keys(row.metadata as object).sort(),
                [
                  'action',
                  'changedField',
                  'fromStatus',
                  'toStatus',
                  'policy',
                  'revision',
                ].sort(),
              );
            }
            assert.equal(
              JSON.stringify(changes).includes('Private operational'),
              false,
            );
            assert.equal(
              JSON.stringify(changes).includes('private@example.test'),
              false,
            );
            assert.equal(
              JSON.stringify(changes).includes(internal.description),
              false,
            );
            await assert.rejects(lifecycleDown(db));
          },
        );
        const targetDepartment = randomUUID(),
          targetDivision = randomUUID();
        await db
          .insertInto('department')
          .values({
            id: targetDepartment,
            organization_id: org,
            name: 'Synthetic operations',
            description: null,
            status: 'active',
            display_order: 2,
          })
          .execute();
        await db
          .insertInto('division')
          .values({
            id: targetDivision,
            organization_id: org,
            department_id: targetDepartment,
            name: 'Synthetic unit',
            description: null,
            status: 'active',
            display_order: 1,
          })
          .execute();
        await t.test(
          'F031 routing requires valid same-organization targets and both current/target memberships',
          async () => {
            const route = {
              expectedRevision: 6,
              departmentId: targetDepartment,
              divisionId: targetDivision,
            };
            await postAs(routingPath, route).expect(404);
            await postAs(routingPath, {
              ...route,
              departmentId: otherDepartment,
            }).expect(404);
            await postAs(routingPath, {
              ...route,
              departmentId: randomUUID(),
            }).expect(404);
            await postAs(routingPath, {
              ...route,
              organizationId: otherOrg,
            }).expect(400);
            await db
              .insertInto('staff_department_membership')
              .values({
                organization_id: org,
                staff_identity_id: noGrant,
                department_id: targetDepartment,
                active: true,
              })
              .execute();
            await postAs(routingPath, route).expect(404);
            await db
              .insertInto('staff_division_membership')
              .values({
                organization_id: org,
                staff_identity_id: noGrant,
                department_id: targetDepartment,
                division_id: targetDivision,
                active: true,
              })
              .execute();
            await postAs(routingPath, {
              ...route,
              departmentId: department,
            }).expect(404);
            await db
              .updateTable('division')
              .set({ status: 'inactive' })
              .where('id', '=', targetDivision)
              .execute();
            await postAs(routingPath, route).expect(404);
            await db
              .updateTable('division')
              .set({ status: 'active' })
              .where('id', '=', targetDivision)
              .execute();
            await postAs(routingPath, route).expect(200);
            const detail = await getInternal(
              `${internalPath}/${internalId}`,
            ).expect(200);
            assert.equal(
              (detail.body as { departmentId: string }).departmentId,
              targetDepartment,
            );
            assert.equal(
              (detail.body as { divisionId: string }).divisionId,
              targetDivision,
            );
            const categoryRow = await db
              .selectFrom('category')
              .select('department_id')
              .where('id', '=', category)
              .executeTakeFirstOrThrow();
            assert.equal(categoryRow.department_id, department);
            await db
              .updateTable('staff_division_membership')
              .set({ active: false })
              .where('staff_identity_id', '=', noGrant)
              .where('division_id', '=', targetDivision)
              .execute();
            await getInternal(`${internalPath}/${internalId}`).expect(404);
            assert.equal(
              (
                (await getInternal(internalPath).expect(200)).body as {
                  total: number;
                }
              ).total,
              0,
            );
            await postAs(workflowPath, {
              expectedRevision: 7,
              action: 'start_work',
            }).expect(404);
            await postAs(routingPath, {
              expectedRevision: 7,
              departmentId: department,
            }).expect(404);
            await db
              .updateTable('staff_division_membership')
              .set({ active: true })
              .where('staff_identity_id', '=', noGrant)
              .where('division_id', '=', targetDivision)
              .execute();
            await postAs(routingPath, {
              expectedRevision: 7,
              departmentId: department,
            }).expect(200);
            const routingAudit = await db
              .selectFrom('activity')
              .select('metadata')
              .where('service_request_id', '=', internalId)
              .where('activity_type', '=', 'service_request_reassigned')
              .execute();
            assert.equal(routingAudit.length, 2);
            assert.equal(
              (routingAudit[0]?.metadata as { changedField: string })
                .changedField,
              'routing',
            );
          },
        );
        await t.test(
          'F031 audit failure rolls back the status/revision and update does not confer read access',
          async () => {
            await sql`create function reject_f031_test() returns trigger language plpgsql as $$ begin if NEW.metadata->>'policy'='F031' then raise exception 'synthetic audit failure'; end if; return NEW; end $$`.execute(
              db,
            );
            await sql`create trigger reject_f031_test before insert on activity for each row execute function reject_f031_test()`.execute(
              db,
            );
            try {
              await postAs(workflowPath, {
                expectedRevision: 8,
                action: 'start_work',
              }).expect(500);
            } finally {
              await sql`drop trigger reject_f031_test on activity; drop function reject_f031_test()`.execute(
                db,
              );
            }
            const row = await db
              .selectFrom('service_request')
              .select(['revision', 'status'])
              .where('id', '=', internalId)
              .executeTakeFirstOrThrow();
            assert.equal(row.revision, 8);
            assert.equal(row.status, 'open');
            await db
              .deleteFrom('role_permission')
              .where('role_id', '=', readerRole.role_id)
              .where('permission_key', '=', 'service_request.internal.read')
              .execute();
            await getInternal(`${internalPath}/${internalId}`).expect(403);
            await postAs(workflowPath, {
              expectedRevision: 8,
              action: 'start_work',
            }).expect(200);
            await getInternal(`${publicPath}/${publicId}`).expect(403);
            await db
              .deleteFrom('role_permission')
              .where('role_id', '=', readerRole.role_id)
              .where('permission_key', '=', 'service_request.internal.update')
              .execute();
            await postAs(workflowPath, {
              expectedRevision: 9,
              action: 'close',
              resolutionSummary: 'completed',
            }).expect(403);
            await assert.rejects(
              db
                .updateTable('service_request')
                .set({ routed_department_id: otherDepartment })
                .where('id', '=', internalId)
                .execute(),
            );
            await assert.rejects(
              db
                .updateTable('service_request')
                .set({ routed_department_id: department })
                .where('id', '=', publicId)
                .execute(),
            );
          },
        );
        const configPath = `/api/v1/staff/catalog/issues/${service}/action`;
        await t.test(
          'F032 defaults existing Issues to intake, grants nothing and supports unused rollback/reapply',
          async () => {
            const row = await db
              .selectFrom('service_definition')
              .selectAll()
              .where('id', '=', service)
              .executeTakeFirstOrThrow();
            assert.equal(row.action_type, 'internal_intake');
            assert.equal(row.redirect_url, null);
            assert.equal(
              (
                await db
                  .selectFrom('role_permission')
                  .selectAll()
                  .where('permission_key', '=', 'catalog.issue_action.manage')
                  .execute()
              ).length,
              0,
            );
            await actionDown(db);
            await actionUp(db);
          },
        );
        const external = {
          actionType: 'external_redirect',
          expectedRevision: 1,
          destination: 'https://example.com/service?allowed=value',
        };
        await t.test(
          'F032 unauthorized/creator/request-operation identities cannot manage catalog actions',
          async () => {
            await request(app.getHttpServer())
              .post(configPath)
              .send(external)
              .expect(401);
            for (const actor of [creator, noGrant, otherStaff])
              await postAs(configPath, external, actor).expect(403);
          },
        );
        await db
          .insertInto('role_permission')
          .values({
            organization_id: org,
            role_id: readerRole.role_id,
            permission_key: 'catalog.issue_action.manage',
          })
          .execute();
        const questionId = randomUUID();
        // Published questions are immutable: add a question to a new draft version, then publish it.
        const actionVersion = randomUUID();
        await sql`insert into service_definition_version(id,organization_id,service_definition_id,version_number,name,resident_description,icon_key,aliases,keywords,default_priority,location_policy,geographic_eligibility_mode,anonymous_reporting_policy,status)
          select ${actionVersion},organization_id,service_definition_id,2,name,resident_description,icon_key,aliases,keywords,default_priority,location_policy,geographic_eligibility_mode,anonymous_reporting_policy,'draft' from service_definition_version where id=${version}`.execute(
          db,
        );
        await db
          .insertInto('question')
          .values({
            id: questionId,
            organization_id: org,
            service_definition_version_id: actionVersion,
            question_key: 'followup',
            label: 'Synthetic follow-up',
            help_text: null,
            question_type: 'short_text',
            is_required: false,
            display_order: 1,
            validation_metadata: null,
            visibility_condition: null,
            status: 'active',
          })
          .execute();
        await db
          .updateTable('service_definition_version')
          .set({ status: 'published', published_at: new Date() })
          .where('id', '=', actionVersion)
          .execute();
        await db
          .updateTable('service_definition')
          .set({ current_published_version_id: actionVersion })
          .where('id', '=', service)
          .execute();
        await t.test(
          'F032 explicit catalog administration validates URL, scope and expected revision',
          async () => {
            await postAs(configPath, {
              ...external,
              organizationId: otherOrg,
            }).expect(400);
            await postAs(
              `/api/v1/staff/catalog/issues/${otherService}/action`,
              external,
            ).expect(404);
            for (const destination of [
              'javascript:alert(1)',
              'data:text/html,test',
              'file:///etc/passwd',
              'http://example.com',
              'https://a:b@example.com',
            ])
              await postAs(configPath, { ...external, destination }).expect(
                400,
              );
            await postAs(configPath, external).expect(200);
            await postAs(configPath, external).expect(409);
            await assert.rejects(actionDown(db));
            await assert.rejects(
              db
                .updateTable('service_definition')
                .set({ action_type: 'invalid' })
                .where('id', '=', service)
                .execute(),
            );
          },
        );
        await t.test(
          'F032 redirects suppress but preserve questions and reject direct resident/staff submission including old versions',
          async () => {
            await request(app.getHttpServer())
              .get('/api/v1/staff/catalog/issues/invalid')
              .set('Authorization', `Bearer ${creator}`)
              .expect(400);
            const catalog = await request(app.getHttpServer())
              .get(`/api/v1/catalog/issues/${service}`)
              .expect(200);
            const detail = catalog.body as {
              actionType: string;
              questions: unknown[];
              redirect: { destination: string };
            };
            assert.equal(detail.actionType, 'external_redirect');
            assert.deepEqual(detail.questions, []);
            assert.equal(detail.redirect.destination, external.destination);
            const staffCatalog = await request(app.getHttpServer())
              .get(`/api/v1/staff/catalog/issues/${service}`)
              .set('Authorization', `Bearer ${creator}`)
              .expect(200);
            assert.deepEqual(
              (staffCatalog.body as { questions: unknown[] }).questions,
              [],
            );
            assert.equal(
              (
                await db
                  .selectFrom('question')
                  .select('id')
                  .where('id', '=', questionId)
                  .execute()
              ).length,
              1,
            );
            const before = await db
              .selectFrom('service_request')
              .select('id')
              .execute();
            const counterBefore = await db
              .selectFrom('service_request_reference_sequence')
              .selectAll()
              .orderBy('organization_id')
              .orderBy('period_key')
              .execute();
            await request(app.getHttpServer())
              .post(publicPath)
              .send(base)
              .expect(409);
            for (const payload of [assisted, internal])
              await postAs(staffPath, payload, creator).expect(409);
            for (const extra of [
              { actionType: 'internal_intake' },
              { redirectUrl: 'https://evil.example' },
              { organizationId: otherOrg },
            ]) {
              await request(app.getHttpServer())
                .post(publicPath)
                .send({ ...base, ...extra })
                .expect(400);
              await postAs(
                staffPath,
                { ...assisted, ...extra },
                creator,
              ).expect(400);
            }
            assert.equal(
              (await db.selectFrom('service_request').select('id').execute())
                .length,
              before.length,
            );
            assert.deepEqual(
              await db
                .selectFrom('service_request_reference_sequence')
                .selectAll()
                .orderBy('organization_id')
                .orderBy('period_key')
                .execute(),
              counterBefore,
            );
            await postAs(configPath, {
              actionType: 'internal_intake',
              expectedRevision: 2,
            }).expect(200);
            const restored = await request(app.getHttpServer())
              .get(`/api/v1/catalog/issues/${service}`)
              .expect(200);
            assert.equal(
              (restored.body as { questions: unknown[] }).questions.length,
              1,
            );
            assert.equal(
              (restored.body as { redirect?: unknown }).redirect,
              undefined,
            );
            await request(app.getHttpServer())
              .post(publicPath)
              .send({
                ...base,
                serviceDefinitionVersionId: actionVersion,
                answers: [{ questionId, value: 'preserved' }],
              })
              .expect(201);
            await postAs(staffPath, assisted, creator).expect(201);
            await postAs(staffPath, internal, creator).expect(201);
          },
        );
        await t.test(
          'F033 reference configuration is Entra-only, explicit-permission and trusted-Organization scoped',
          async () => {
            const path =
              '/api/v1/staff/service-request-reference-configuration';
            await request(app.getHttpServer()).get(path).expect(401);
            const proposed = {
              prefix: 'REQ',
              dateComponent: 'year',
              resetPolicy: 'yearly',
              separator: '-',
              sequenceWidth: 8,
              expectedRevision: 1,
            };
            for (const who of [creator, publicOnly, noGrant]) {
              await request(app.getHttpServer())
                .get(path)
                .set('Authorization', `Bearer ${who}`)
                .expect(403);
              await request(app.getHttpServer())
                .post(path)
                .set('Authorization', `Bearer ${who}`)
                .send(proposed)
                .expect(403);
            }
            assert.equal(
              (
                await db
                  .selectFrom('role_permission')
                  .selectAll()
                  .where(
                    'permission_key',
                    '=',
                    'service_request.reference.manage',
                  )
                  .execute()
              ).length,
              0,
            );
            // Prove other administrative/request permissions do not imply reference management.
            const roleRow = await db
              .selectFrom('staff_role_assignment')
              .select('role_id')
              .where('staff_identity_id', '=', creator)
              .executeTakeFirstOrThrow();
            for (const key of [
              'service_request.internal.read',
              'service_request.internal.update',
              'catalog.issue_action.manage',
            ])
              await db
                .insertInto('role_permission')
                .values({
                  organization_id: org,
                  role_id: roleRow.role_id,
                  permission_key: key,
                })
                .onConflict((oc) => oc.doNothing())
                .execute();
            await request(app.getHttpServer())
              .get(path)
              .set('Authorization', `Bearer ${creator}`)
              .expect(403);
            await db
              .insertInto('role_permission')
              .values({
                organization_id: org,
                role_id: roleRow.role_id,
                permission_key: 'service_request.reference.manage',
              })
              .execute();
            const beforeOther = await db
              .selectFrom('service_request_reference_config')
              .selectAll()
              .where('organization_id', '=', otherOrg)
              .executeTakeFirstOrThrow();
            const get = await request(app.getHttpServer())
              .get(path)
              .set('Authorization', `Bearer ${creator}`)
              .expect(200);
            assert.equal((get.body as { revision: number }).revision, 1);
            for (const changed of [
              { prefix: 'unsafe\n' },
              { separator: '/' },
              { sequenceWidth: 0 },
              { dateComponent: 'none' },
              { resetPolicy: 'unknown' },
              { organizationId: otherOrg },
              { nextSequence: 123 },
              { referenceNumber: 'CHOSEN' },
            ])
              await request(app.getHttpServer())
                .post(path)
                .set('Authorization', `Bearer ${creator}`)
                .send({ ...proposed, ...changed })
                .expect(400);
            await request(app.getHttpServer())
              .post(path)
              .set('Authorization', `Bearer ${creator}`)
              .send({})
              .expect(400);
            await request(app.getHttpServer())
              .post(path)
              .set('Authorization', `Bearer ${creator}`)
              .send(proposed)
              .expect(200);
            await request(app.getHttpServer())
              .post(path)
              .set('Authorization', `Bearer ${creator}`)
              .send(proposed)
              .expect(409);
            const scoped = await request(app.getHttpServer())
              .get(`${path}?organizationId=${otherOrg}`)
              .set('Authorization', `Bearer ${creator}`)
              .expect(200);
            assert.equal((scoped.body as { prefix: string }).prefix, 'REQ');
            assert.deepEqual(
              await db
                .selectFrom('service_request_reference_config')
                .selectAll()
                .where('organization_id', '=', otherOrg)
                .executeTakeFirstOrThrow(),
              beforeOther,
            );
            await request(app.getHttpServer())
              .get(`${path}/${otherOrg}`)
              .set('Authorization', `Bearer ${creator}`)
              .expect(404);
            // F032 preserved question must still be answered for this version.
            const definition = await request(app.getHttpServer())
              .get(`/api/v1/catalog/issues/${service}`)
              .expect(200);
            const detail = definition.body as {
              publishedVersionId: string;
              questions: { id: string }[];
            };
            const current = await db
              .selectFrom('service_definition')
              .select('current_published_version_id')
              .where('id', '=', service)
              .executeTakeFirstOrThrow();
            const submission = {
              ...base,
              serviceDefinitionVersionId: current.current_published_version_id,
              answers: detail.questions.map((q) => ({
                questionId: q.id,
                value: 'F033 synthetic',
              })),
            };
            const refs: string[] = [];
            for (const [endpoint, payload, who] of [
              [publicPath, submission, null],
              [
                staffPath,
                { ...assisted, ...submission, reportingIdentity: 'identified' },
                creator,
              ],
              [
                staffPath,
                { ...internal, ...submission, reportingIdentity: 'identified' },
                creator,
              ],
            ] as const) {
              const call = request(app.getHttpServer()).post(endpoint);
              if (who) call.set('Authorization', `Bearer ${who}`);
              const result = await call.send(payload).expect(201);
              refs.push(
                (result.body as { referenceNumber: string }).referenceNumber,
              );
            }
            assert.deepEqual(
              refs.map((r) => r.slice(-8)),
              ['00000001', '00000002', '00000003'],
            );
            for (const fields of [
              { referenceNumber: 'CUSTOM' },
              { nextSequence: 999 },
              { organizationId: otherOrg },
            ])
              await request(app.getHttpServer())
                .post(publicPath)
                .send({ ...submission, ...fields })
                .expect(400);
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
