import { setupDevelopmentOperationalTargets } from '../../src/database/development-operational-targets.js';
import { up as ownershipUp } from '../../migrations/20260920000000-add-assignment-watchers.js';
import { up as eligibilityUp } from '../../migrations/20260902030000-add-location-eligibility-snapshot.js';
import { up as audienceUp } from '../../migrations/20260919000000-add-request-audience-assisted-intake.js';
import { up as lifecycleUp } from '../../migrations/20260919020000-add-internal-request-lifecycle.js';
import { up as operationalUp } from '../../migrations/20260919050000-add-request-operational-activity.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { StaffAccessGuard } from '../../src/auth/staff-access.guard.js';
import { EntraTokenService } from '../../src/auth/entra-token.service.js';
import { InternalRequestController } from '../../src/service-request/internal-request.controller.js';
import { InternalRequestRepository } from '../../src/service-request/internal-request.repository.js';

import { up as catalogUp } from '../../migrations/20260902000000-create-organization-service-catalog.js';
import { up as requestUp } from '../../migrations/20260902010000-create-service-request-foundation.js';
import { up as staffUp } from '../../migrations/20260903010000-add-staff-assignment-workflow-foundation.js';
import { up as authUp } from '../../migrations/20260903020000-add-entra-rbac-foundation.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { StaffAuthorizationService } from '../../src/auth/staff-authorization.service.js';
import {
  developmentOrganization,
  developmentStaffPermissions,
  selectedDevelopmentPermissions,
} from '../../src/database/development-staff-input.js';
import {
  changeDevelopmentStaffGrants,
  type DevelopmentStaffSelection,
} from '../../src/database/development-staff-grants.js';

const url = process.env.TEST_DATABASE_URL;
test(
  'F036 explicit development provisioning uses existing PostgreSQL authorization',
  { skip: !url },
  async (t) => {
    const schema = `development_staff_${randomUUID().replaceAll('-', '')}`;
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
    const tenantId = randomUUID(),
      staffId = randomUUID(),
      objectId = randomUUID();
    const departmentId = randomUUID(),
      divisionId = randomUUID(),
      otherDepartment = randomUUID(),
      otherDivision = randomUUID();
    const input: DevelopmentStaffSelection = {
      tenantId,
      staffId,
      organizationId: developmentOrganization.id,
      scopes: [{ departmentId, divisionId }],
      permissions: ['service_request.internal.read'],
    };
    const auth = new StaffAuthorizationService({
      client: db,
    } as DatabaseService);
    const principal = {
      tenantId,
      objectId,
      name: 'Fictional',
      scopes: ['access_as_user'],
      tokenVersion: '2.0',
    };
    const state = async () => {
      const result: Record<string, unknown> = {};
      for (const table of [
        'staff_identity',
        'role',
        'role_permission',
        'staff_role_assignment',
        'staff_department_membership',
        'staff_division_membership',
        'service_request',
        'activity',
        'request_operational_activity',
      ] as const)
        result[table] = (await db.selectFrom(table).selectAll().execute())
          .map((row) => JSON.stringify(row))
          .sort();
      return result;
    };
    const module = await Test.createTestingModule({
      controllers: [InternalRequestController],
      providers: [
        StaffAccessGuard,
        StaffAuthorizationService,
        InternalRequestRepository,
        { provide: DatabaseService, useValue: { client: db } },
        { provide: ConfigService, useValue: { get: () => undefined } },
        {
          provide: EntraTokenService,
          useValue: {
            enabled: true,
            validate: async () => principal,
            hasRequiredScope: () => true,
          },
        },
      ],
    }).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    const protectedOptions =
      '/staff/internal-service-requests/workspace-options';
    try {
      for (const migrate of [
        catalogUp,
        requestUp,
        eligibilityUp,
        staffUp,
        authUp,
        audienceUp,
        lifecycleUp,
        operationalUp,
        ownershipUp,
      ])
        await migrate(db);
      await db
        .insertInto('organization')
        .values({
          ...developmentOrganization,
          short_name: 'Development',
          status: 'active',
          default_business_timezone: 'Etc/UTC',
        })
        .execute();
      for (const id of [departmentId, otherDepartment])
        await db
          .insertInto('department')
          .values({
            id,
            organization_id: input.organizationId,
            name: `Fictional department ${id}`,
            description: null,
            status: 'active',
            display_order: 1,
          })
          .execute();
      for (const [id, department] of [
        [divisionId, departmentId],
        [otherDivision, otherDepartment],
      ] as const)
        await db
          .insertInto('division')
          .values({
            id,
            organization_id: input.organizationId,
            department_id: department,
            name: 'Fictional division',
            description: null,
            status: 'active',
            display_order: 1,
          })
          .execute();
      await db
        .insertInto('staff_identity')
        .values({
          id: staffId,
          organization_id: input.organizationId,
          entra_tenant_id: tenantId,
          entra_object_id: objectId,
          display_name: 'Fictional staff',
          email: null,
          active: true,
        })
        .execute();
      await db
        .insertInto('permission')
        .values(
          developmentStaffPermissions.map((permission_key) => ({
            permission_key,
          })),
        )
        .onConflict((oc) => oc.column('permission_key').doNothing())
        .execute();

      // Nonempty operational data makes deletion/preservation assertions meaningful.
      const categoryId = randomUUID(),
        serviceId = randomUUID(),
        versionId = randomUUID(),
        requestId = randomUUID();
      await db
        .insertInto('category')
        .values({
          id: categoryId,
          organization_id: input.organizationId,
          department_id: departmentId,
          division_id: null,
          name: 'Fictional category',
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
          id: serviceId,
          organization_id: input.organizationId,
          category_id: categoryId,
          service_key: 'fictional',
          status: 'active',
          current_published_version_id: null,
        })
        .execute();
      await db
        .insertInto('service_definition_version')
        .values({
          id: versionId,
          organization_id: input.organizationId,
          service_definition_id: serviceId,
          version_number: 1,
          name: 'Fictional Issue',
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
      await db
        .insertInto('service_request')
        .values({
          id: requestId,
          organization_id: input.organizationId,
          reference_number: 'SR-200001-000001',
          service_definition_id: serviceId,
          service_definition_version_id: versionId,
          category_id: categoryId,
          status: 'open',
          priority: 'medium',
          description: 'Fictional preservation fixture',
          reporting_identity: 'anonymous',
        })
        .execute();
      await db
        .insertInto('request_operational_activity')
        .values({
          organization_id: input.organizationId,
          service_request_id: requestId,
          activity_type: 'request_created',
          actor_type: 'anonymous_resident',
          occurred_at: new Date(),
          request_revision: 1,
          intake_channel: 'web',
        })
        .execute();

      await t.test(
        'normal HTTP guard denies localhost and authenticated principals without grants',
        async () => {
          const before = await state();
          await request(app.getHttpServer())
            .get(protectedOptions)
            .set('Host', 'localhost')
            .set('Origin', 'http://localhost:5173')
            .expect(401);
          await request(app.getHttpServer())
            .get(protectedOptions)
            .set('Authorization', 'Bearer fictional-test-principal')
            .set('Host', 'localhost')
            .expect(403);
          assert.deepEqual(await state(), before);
        },
      );
      await t.test(
        'authentication identity mapping alone grants no permissions and creates no grants',
        async () => {
          const before = await state();
          const access = await auth.resolve(principal);
          assert.deepEqual(access.permissions, []);
          assert.throws(() => {
            auth.assertPermission(access, 'service_request.internal.read');
          });
          await assert.rejects(
            auth.resolve({ ...principal, objectId: randomUUID() }),
          );
          assert.deepEqual(await state(), before);
        },
      );
      await t.test(
        'unknown identity, wrong tenant, Organization and hierarchy fail without writes',
        async () => {
          const before = await state();
          for (const invalid of [
            { ...input, staffId: randomUUID() },
            { ...input, staffId: '' },
            { ...input, tenantId: randomUUID() },
            { ...input, organizationId: randomUUID() },
            { ...input, scopes: [{ departmentId: randomUUID(), divisionId }] },
            { ...input, scopes: [{ departmentId, divisionId: otherDivision }] },
          ])
            await assert.rejects(
              changeDevelopmentStaffGrants(db, invalid, 'provision', false),
            );
          assert.deepEqual(await state(), before);
        },
      );
      await t.test(
        'dry run validates and reports intended grants with byte-identical database state',
        async () => {
          const before = await state();
          const result = await changeDevelopmentStaffGrants(
            db,
            input,
            'provision',
            true,
          );
          assert.deepEqual(result.changedPermissions, input.permissions);
          assert.deepEqual(await state(), before);
        },
      );
      await t.test(
        'read-only grant resolves through real RBAC, with explicit department/division scope',
        async () => {
          await changeDevelopmentStaffGrants(db, input, 'provision', false);
          const access = await auth.resolve(principal);
          assert.deepEqual(access.permissions, [
            'service_request.internal.read',
          ]);
          assert.deepEqual(access.departmentIds, [departmentId]);
          assert.deepEqual(access.divisionIds, [divisionId]);
          assert.equal(access.organizationId, input.organizationId);
          assert.equal(access.development, false);
          for (const permission of [
            'service_request.internal.update',
            'catalog.issue_action.manage',
            'service_request.reference.manage',
          ] as const)
            assert.throws(() => {
              auth.assertPermission(access, permission);
            });
        },
      );
      await t.test(
        'normal protected HTTP options reflect only provisioned scope and no update capability',
        async () => {
          const response = await request(app.getHttpServer())
            .get(protectedOptions)
            .set('Authorization', 'Bearer fictional-test-principal')
            .expect(200);
          const body = response.body as {
            canUpdate: boolean;
            departments: { id: string }[];
            divisions: { id: string }[];
          };
          assert.equal(body.canUpdate, false);
          assert.deepEqual(
            body.departments.map((item: { id: string }) => item.id),
            [departmentId],
          );
          assert.deepEqual(
            body.divisions.map((item: { id: string }) => item.id),
            [divisionId],
          );
          assert.equal(response.headers['cache-control'], 'no-store');
          await request(app.getHttpServer())
            .get(
              '/staff/internal-service-requests?organizationId=' + randomUUID(),
            )
            .set('Authorization', 'Bearer fictional-test-principal')
            .expect(400);
        },
      );
      await t.test(
        'repeated and concurrent provisioning produces exactly one role/grant/membership',
        async () => {
          const before = await state();
          await Promise.all(
            Array.from({ length: 5 }, () =>
              changeDevelopmentStaffGrants(db, input, 'provision', false),
            ),
          );
          assert.deepEqual(await state(), before);
        },
      );
      await t.test(
        'explicit updater grant becomes effective on next resolution, without unrelated rights',
        async () => {
          await changeDevelopmentStaffGrants(
            db,
            { ...input, permissions: ['service_request.internal.update'] },
            'provision',
            false,
          );
          const access = await auth.resolve(principal);
          auth.assertPermission(access, 'service_request.internal.update');
          assert.throws(() => {
            auth.assertPermission(access, 'catalog.issue_action.manage');
          });
          assert.throws(() => {
            auth.assertPermission(access, 'service_request.reference.manage');
          });
        },
      );
      await t.test(
        'injected provisioning failure rolls back new scopes and all permission changes',
        async () => {
          const before = await state();
          await sql`create function reject_f036_write() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end $$;
        create trigger reject_f036_write before insert on role_permission for each row execute function reject_f036_write();`.execute(
            db,
          );
          try {
            await assert.rejects(
              changeDevelopmentStaffGrants(
                db,
                {
                  ...input,
                  scopes: [
                    {
                      departmentId: otherDepartment,
                      divisionId: otherDivision,
                    },
                  ],
                  permissions: ['catalog.issue_action.manage'],
                },
                'provision',
                false,
              ),
            );
          } finally {
            await sql`drop trigger reject_f036_write on role_permission; drop function reject_f036_write()`.execute(
              db,
            );
          }
          assert.deepEqual(await state(), before);
        },
      );
      await t.test(
        'injected deprovisioning failure rolls back all removal',
        async () => {
          const before = await state();
          await sql`create function reject_f036_delete() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end $$;
          create trigger reject_f036_delete before update on staff_role_assignment for each row execute function reject_f036_delete();`.execute(
            db,
          );
          try {
            await assert.rejects(
              changeDevelopmentStaffGrants(
                db,
                {
                  ...input,
                  permissions: [
                    'service_request.internal.read',
                    'service_request.internal.update',
                  ],
                },
                'deprovision',
                false,
              ),
            );
          } finally {
            await sql`drop trigger reject_f036_delete on staff_role_assignment; drop function reject_f036_delete()`.execute(
              db,
            );
          }
          assert.deepEqual(await state(), before);
        },
      );
      await t.test(
        'partial revocation removes only selected F036 permission and retains current scope',
        async () => {
          await changeDevelopmentStaffGrants(db, input, 'deprovision', false);
          const access = await auth.resolve(principal);
          assert.throws(() => {
            auth.assertPermission(access, 'service_request.internal.read');
          });
          auth.assertPermission(access, 'service_request.internal.update');
          assert.deepEqual(access.divisionIds, [divisionId]);
        },
      );
      await t.test(
        'same authenticated HTTP principal loses read immediately after revocation',
        async () => {
          await request(app.getHttpServer())
            .get(protectedOptions)
            .set('Authorization', 'Bearer fictional-test-principal')
            .expect(403);
        },
      );
      await t.test(
        'full deprovision preserves unrelated grants, identity and pre-existing memberships',
        async () => {
          const unrelated = randomUUID();
          await db
            .insertInto('role')
            .values({
              id: unrelated,
              organization_id: input.organizationId,
              name: 'Unrelated fictional role',
              description: null,
              active: true,
            })
            .execute();
          await db
            .insertInto('role_permission')
            .values({
              organization_id: input.organizationId,
              role_id: unrelated,
              permission_key: 'geospatial.read',
            })
            .execute();
          await db
            .insertInto('staff_role_assignment')
            .values({
              organization_id: input.organizationId,
              role_id: unrelated,
              staff_identity_id: staffId,
              active: true,
            })
            .execute();
          await db
            .insertInto('staff_department_membership')
            .values({
              organization_id: input.organizationId,
              staff_identity_id: staffId,
              department_id: otherDepartment,
              active: true,
            })
            .execute();
          const before = await state();
          await changeDevelopmentStaffGrants(
            db,
            { ...input, permissions: ['service_request.internal.update'] },
            'deprovision',
            false,
          );
          const access = await auth.resolve(principal);
          assert.deepEqual(access.permissions, ['geospatial.read']);
          assert.deepEqual(access.departmentIds, [otherDepartment]);
          assert.deepEqual(access.divisionIds, []);
          const after = await state();
          assert.deepEqual(after.staff_identity, before.staff_identity);
          assert.deepEqual(after.service_request, before.service_request);
          assert.deepEqual(after.activity, before.activity);
          assert.deepEqual(
            after.request_operational_activity,
            before.request_operational_activity,
          );
          await changeDevelopmentStaffGrants(db, input, 'deprovision', false);
          assert.deepEqual(await state(), after);
        },
      );
      await t.test(
        'F039 contact permission requires explicit provisioning and supports targeted revocation',
        async () => {
          const before = await state();
          const selected: DevelopmentStaffSelection = {
            ...input,
            permissions: ['service_request.contact.read'],
          };
          assert.ok(
            !(await auth.resolve(principal)).permissions.includes(
              'service_request.contact.read',
            ),
          );
          await changeDevelopmentStaffGrants(db, selected, 'provision', true);
          assert.deepEqual(await state(), before);
          await changeDevelopmentStaffGrants(db, selected, 'provision', false);
          await changeDevelopmentStaffGrants(db, selected, 'provision', false);
          assert.deepEqual((await auth.resolve(principal)).permissions.sort(), [
            'geospatial.read',
            'service_request.contact.read',
          ]);
          await changeDevelopmentStaffGrants(
            db,
            selected,
            'deprovision',
            false,
          );
          assert.deepEqual((await auth.resolve(principal)).permissions, [
            'geospatial.read',
          ]);
          const after = await state();
          assert.deepEqual(after.service_request, before.service_request);
          assert.deepEqual(
            after.request_operational_activity,
            before.request_operational_activity,
          );
        },
      );
      await t.test(
        'F039 temporary PUBLIC view is explicit and targeted removal preserves contact permission and data',
        async () => {
          const contact = {
            ...input,
            permissions: ['service_request.contact.read'],
          } as DevelopmentStaffSelection;
          const view = {
            ...input,
            permissions: ['service_request.view'],
          } as DevelopmentStaffSelection;
          await changeDevelopmentStaffGrants(db, contact, 'provision', false);
          const before = await state();
          await changeDevelopmentStaffGrants(db, view, 'provision', true);
          assert.deepEqual(await state(), before);
          for (let repeat = 0; repeat < 2; repeat++)
            await changeDevelopmentStaffGrants(db, view, 'provision', false);
          assert.deepEqual((await auth.resolve(principal)).permissions.sort(), [
            'geospatial.read',
            'service_request.contact.read',
            'service_request.view',
          ]);
          await changeDevelopmentStaffGrants(db, view, 'deprovision', false);
          assert.deepEqual((await auth.resolve(principal)).permissions.sort(), [
            'geospatial.read',
            'service_request.contact.read',
          ]);
          const after = await state();
          for (const key of [
            'staff_identity',
            'staff_department_membership',
            'staff_division_membership',
            'service_request',
            'activity',
            'request_operational_activity',
          ])
            assert.deepEqual(after[key], before[key]);
          await changeDevelopmentStaffGrants(db, contact, 'deprovision', false);
        },
      );
      await t.test(
        'F040 approved sixteen-permission bundle remains explicit, read-only in dry run, idempotent and targeted on removal',
        async () => {
          const before = await state();
          const selected: DevelopmentStaffSelection = {
            ...input,
            permissions: selectedDevelopmentPermissions(
              undefined,
              'FULL_UAT_OPERATOR',
            ),
          };
          assert.equal(selected.permissions.length, 16);
          assert.deepEqual((await auth.resolve(principal)).permissions, [
            'geospatial.read',
          ]);
          await changeDevelopmentStaffGrants(db, selected, 'provision', true);
          assert.deepEqual(await state(), before);
          await Promise.all([
            changeDevelopmentStaffGrants(db, selected, 'provision', false),
            changeDevelopmentStaffGrants(db, selected, 'provision', false),
          ]);
          assert.deepEqual(
            (await auth.resolve(principal)).permissions.sort(),
            [...selected.permissions, 'geospatial.read'].sort(),
          );
          const provisioned = await state();
          await changeDevelopmentStaffGrants(db, selected, 'provision', false);
          assert.deepEqual(await state(), provisioned);
          await changeDevelopmentStaffGrants(
            db,
            selected,
            'deprovision',
            false,
          );
          assert.deepEqual((await auth.resolve(principal)).permissions, [
            'geospatial.read',
          ]);
          const after = await state();
          for (const key of [
            'staff_identity',
            'service_request',
            'activity',
            'request_operational_activity',
          ])
            assert.deepEqual(after[key], before[key]);
        },
      );
      await t.test(
        'externally altered or shared F036 role fails closed',
        async () => {
          const role = await db
            .selectFrom('role')
            .select('id')
            .where('name', '=', `f036-staff-${staffId}`)
            .executeTakeFirstOrThrow();
          await db
            .insertInto('role_permission')
            .values({
              organization_id: input.organizationId,
              role_id: role.id,
              permission_key: 'geospatial.read',
            })
            .execute();
          const before = await state();
          await assert.rejects(
            changeDevelopmentStaffGrants(db, input, 'provision', false),
          );
          await assert.rejects(
            changeDevelopmentStaffGrants(db, input, 'deprovision', false),
          );
          assert.deepEqual(await state(), before);
        },
      );
      await t.test(
        'F037 explicit operational setup is read-only in dry run, idempotent, atomic and grants no RBAC',
        async () => {
          await db
            .insertInto('staff_department_membership')
            .values({
              organization_id: input.organizationId,
              staff_identity_id: staffId,
              department_id: departmentId,
              active: true,
            })
            .onConflict((oc) =>
              oc
                .columns(['staff_identity_id', 'department_id'])
                .doUpdateSet({ active: true }),
            )
            .execute();
          await db
            .insertInto('staff_division_membership')
            .values({
              organization_id: input.organizationId,
              staff_identity_id: staffId,
              department_id: departmentId,
              division_id: divisionId,
              active: true,
            })
            .onConflict((oc) =>
              oc
                .columns(['staff_identity_id', 'division_id'])
                .doUpdateSet({ active: true }),
            )
            .execute();
          const opState = async () => ({
            rbac: await state(),
            roles: await db
              .selectFrom('operational_role')
              .selectAll()
              .execute(),
            groups: await db.selectFrom('work_group').selectAll().execute(),
            roleMembers: await db
              .selectFrom('operational_role_membership')
              .selectAll()
              .execute(),
            groupMembers: await db
              .selectFrom('work_group_membership')
              .selectAll()
              .execute(),
          });
          const before = await opState();
          await setupDevelopmentOperationalTargets(db, input, true);
          assert.deepEqual(await opState(), before);
          for (const bad of [
            { ...input, tenantId: randomUUID() },
            { ...input, staffId: randomUUID() },
            { ...input, organizationId: randomUUID() },
            {
              ...input,
              scopes: [{ departmentId: otherDepartment, divisionId }],
            },
          ])
            await assert.rejects(
              setupDevelopmentOperationalTargets(db, bad, false),
            );
          assert.deepEqual(await opState(), before);
          await sql`create function fail_op_member() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end $$; create trigger fail_op_member before insert on work_group_membership for each row execute function fail_op_member()`.execute(
            db,
          );
          await assert.rejects(
            setupDevelopmentOperationalTargets(db, input, false),
          );
          assert.deepEqual(await opState(), before);
          await sql`drop trigger fail_op_member on work_group_membership; drop function fail_op_member()`.execute(
            db,
          );
          await Promise.all(
            Array.from({ length: 3 }, () =>
              setupDevelopmentOperationalTargets(db, input, false),
            ),
          );
          const after = await opState();
          assert.equal(after.roles.length, 1);
          assert.equal(after.groups.length, 1);
          assert.equal(after.roleMembers.length, 1);
          assert.equal(after.groupMembers.length, 1);
          assert.deepEqual(after.rbac, before.rbac);
          await setupDevelopmentOperationalTargets(db, input, false);
          assert.deepEqual(await opState(), after);
          const access = await auth.resolve(principal);
          assert.ok(
            !access.permissions.includes('service_request.internal.read'),
          );
          assert.ok(
            !access.permissions.includes('service_request.internal.update'),
          );
        },
      );
    } finally {
      await app.close();
      await db.destroy();
      await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  },
);
