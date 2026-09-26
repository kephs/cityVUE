import { governedAvailabilityChecks } from './governed-availability-checks.js';
import { reviewedCreation } from './issue-creation-fixture.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IssueChange } from '../../src/admin/admin-issue.domain.js';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { Permission, StaffAccess } from '../../src/auth/auth.types.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { StaffAccessGuard } from '../../src/auth/staff-access.guard.js';
import { StaffAuthorizationService } from '../../src/auth/staff-authorization.service.js';
import { EntraTokenService } from '../../src/auth/entra-token.service.js';
import { IssueActionController } from '../../src/catalog/issue-action.controller.js';
import { IssueActionService } from '../../src/catalog/issue-action.service.js';
import { AdminIssueService } from '../../src/admin/admin-issue.service.js';
import { AdminIssueController } from '../../src/admin/admin-issue.controller.js';
import { AdminIssueDiscoveryService } from '../../src/admin/admin-issue-discovery.service.js';
import { CatalogRepository } from '../../src/catalog/catalog.repository.js';
import { CreateServiceRequestService } from '../../src/service-request/create-service-request.service.js';
import { ServiceRequestRepository } from '../../src/service-request/service-request.repository.js';
import type { AppConfiguration } from '../../src/config/configuration.js';
import type { CreateServiceRequestDto } from '../../src/service-request/service-request.dto.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import {
  up,
  down,
} from '../../migrations/20261005000000-issue-availability-external-history.js';

const url = process.env.TEST_DATABASE_URL;
test(
  'F056.2B governed Issue handling and availability',
  { skip: !url },
  async (t) => {
    const schema = `handling_${randomUUID().replaceAll('-', '')}`,
      admin = new Pool({ connectionString: url });
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
      division = randomUUID(),
      category = randomUUID(),
      template = randomUUID(),
      version = randomUUID(),
      actor = randomUUID(),
      role = randomUUID(),
      tenant = randomUUID();
    const module = await Test.createTestingModule({
      controllers: [IssueActionController, AdminIssueController],
      providers: [
        IssueActionService,
        AdminIssueService,
        AdminIssueDiscoveryService,
        StaffAccessGuard,
        StaffAuthorizationService,
        { provide: DatabaseService, useValue: { client: db } },
        { provide: ConfigService, useValue: { get: () => undefined } },
        {
          provide: EntraTokenService,
          useValue: {
            enabled: true,
            validate: async () => ({
              tenantId: tenant,
              objectId: actor,
              scopes: ['access_as_user'],
            }),
            hasRequiredScope: () => true,
          },
        },
      ],
    }).compile();
    const app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    const api = app.getHttpServer() as Server;
    const all: Permission[] = [
      'admin.configuration.read',
      'admin.issues.write',
      'catalog.issue_action.manage',
    ];
    const access: StaffAccess = {
      organizationId: org,
      staffIdentityId: actor,
      tenantId: tenant,
      objectId: actor,
      displayName: 'Fictional',
      scopes: [],
      departmentIds: [department],
      divisionIds: [division],
      permissions: all,
      development: false,
    };
    const grants = async (keys: Permission[]) => {
      await db
        .deleteFrom('role_permission')
        .where('role_id', '=', role)
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
    };
    const state = async (id: string) => ({
      issue: await db
        .selectFrom('service_definition')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
      history: (
        await sql`select * from issue_action_history where issue_id=${id} order by action_revision`.execute(
          db,
        )
      ).rows,
      audit: (
        await sql`select * from issue_action_audit where issue_id=${id} order by revision`.execute(
          db,
        )
      ).rows,
      coreAudit: (
        await sql`select * from issue_configuration_audit where issue_id=${id} order by occurred_at`.execute(
          db,
        )
      ).rows,
    });
    try {
      const folder = resolve(__dirname, '../../migrations');
      for (const file of (await readdir(folder))
        .filter((f) => /^\d.*\.js$/.test(f) && f < '20261005')
        .sort()) {
        const migration = (await import(
          pathToFileURL(join(folder, file)).href
        )) as { up: (db: Kysely<DatabaseSchema>) => Promise<void> };
        await db.transaction().execute(migration.up);
      }
      await sql`insert into organization(id,name,short_name,slug,status,default_business_timezone) values(${org},'Fictional','Test',${org},'active','UTC'),(${otherOrg},'Other fictional','Other',${otherOrg},'active','UTC')`.execute(
        db,
      );
      await sql`insert into department(id,organization_id,name,status,display_order) values(${department},${org},'Fictional department','active',0)`.execute(
        db,
      );
      await sql`insert into division(id,organization_id,department_id,name,status,display_order) values(${division},${org},${department},'Fictional division','active',0)`.execute(
        db,
      );
      await sql`insert into category(id,organization_id,department_id,division_id,name,icon_key,status,display_order) values(${category},${org},${department},${division},'Fictional category','test','active',0)`.execute(
        db,
      );
      await sql`insert into service_definition(id,organization_id,category_id,service_key,status) values(${template},${org},${category},'template','active')`.execute(
        db,
      );
      await sql`insert into service_definition_version(id,organization_id,service_definition_id,version_number,name,icon_key,default_priority,location_policy,geographic_eligibility_mode,anonymous_reporting_policy,status,published_at)
        values(${version},${org},${template},1,'Fictional template','test','medium','not_applicable','no_geographic_restriction','allowed','published',now())`.execute(
        db,
      );
      await sql`update service_definition set current_published_version_id=${version} where id=${template}`.execute(
        db,
      );
      await sql`insert into staff_identity(id,organization_id,entra_tenant_id,entra_object_id,display_name,active) values(${actor},${org},${tenant},${actor},'Fictional admin',true)`.execute(
        db,
      );
      await sql`insert into role(id,organization_id,name,active) values(${role},${org},'Fictional admin',true)`.execute(
        db,
      );
      await sql`insert into staff_role_assignment(organization_id,staff_identity_id,role_id,active) values(${org},${actor},${role},true)`.execute(
        db,
      );
      await sql`insert into staff_department_membership(organization_id,staff_identity_id,department_id,active) values(${org},${actor},${department},true)`.execute(
        db,
      );
      await sql`insert into staff_division_membership(organization_id,staff_identity_id,department_id,division_id,active) values(${org},${actor},${department},${division},true);`.execute(
        db,
      );
      const baseline = await db
        .selectFrom('service_definition')
        .selectAll()
        .execute();
      await t.test(
        'migration apply rollback reapply preserves existing fields and grants',
        async () => {
          await assert.rejects(
            db.transaction().execute(async (trx) => {
              await trx
                .updateTable('service_definition')
                .set({
                  action_type: 'external_redirect',
                  redirect_url: 'https://example.com/baseline',
                  redirect_message: 'Existing fictional handoff',
                  redirect_label: 'Continue',
                  action_revision: 4,
                })
                .where('id', '=', template)
                .execute();
              await up(trx);
              const baselineHistory = (
                await sql<{
                  baseline: boolean;
                  action_revision: number;
                }>`select baseline,action_revision from issue_action_history where issue_id=${template}`.execute(
                  trx,
                )
              ).rows;
              assert.deepEqual(baselineHistory, [
                { baseline: true, action_revision: 4 },
              ]);
              assert.equal(
                (
                  await trx
                    .selectFrom('service_definition')
                    .select('availability')
                    .where('id', '=', template)
                    .executeTakeFirstOrThrow()
                ).availability,
                'EXTERNAL_ONLY',
              );
              throw new Error('rollback synthetic baseline');
            }),
            /rollback synthetic baseline/,
          );
          await db.transaction().execute(up);
          assert.equal(
            (await state(template)).issue.availability,
            'INTERNAL_AND_EXTERNAL',
          );
          await db.transaction().execute(down);
          assert.deepEqual(
            await db.selectFrom('service_definition').selectAll().execute(),
            baseline,
          );
          await db.transaction().execute(up);
          assert.equal(
            (await db.selectFrom('role_permission').selectAll().execute())
              .length,
            0,
          );
        },
      );
      const service = app.get(AdminIssueService),
        legacy = app.get(IssueActionService);
      const create = {
        templateId: template,
        ...(await reviewedCreation(db, org, template)),
        name: 'Fictional handoff',
        description: 'Synthetic',
        displayOrder: 0,
        requesterPolicy: 'ANONYMOUS_ALLOWED' as const,
        defaultAssignment: null,
        availability: 'EXTERNAL_ONLY' as const,
      };
      await grants(all);
      const issue = (await service.create(access, create)).issue,
        id = issue.id;
      const legacyPath = `/staff/catalog/issues/${id}/action`,
        modernPath = `/admin/issues/${id}`;
      const input = {
        actionType: 'external_redirect',
        destination: 'https://example.com:8443/permit?static=value#next',
        message: 'Fictional handoff',
        label: 'Continue',
        expectedRevision: 1,
      };
      const body = async (): Promise<IssueChange> => {
        const i = (await service.detail(access, id)).issue;
        return {
          name: i.name,
          description: i.description,
          displayOrder: i.displayOrder,
          requesterPolicy: i.requesterPolicy as IssueChange['requesterPolicy'],
          defaultAssignment: null,
          active: i.active,
          expectedCoreRevision: i.coreRevision,
          expectedActionRevision: i.actionRevision,
          expectedPolicyRevision: i.policyRevision,
          expectedAssignmentRevision: i.assignmentRevision,
        };
      };
      await t.test(
        'explicit creation, inactive default, fixed availability and independent template',
        async () => {
          assert.equal(issue.availability, 'EXTERNAL_ONLY');
          assert.equal(issue.active, false);
          assert.notEqual(issue.catalogVersionId, version);
          const { availability: ignored, ...missing } = create;
          void ignored;
          await request(api)
            .post('/admin/issues')
            .set('Authorization', 'Bearer fictional')
            .send(missing)
            .expect(400);
          await request(api)
            .patch(modernPath)
            .set('Authorization', 'Bearer fictional')
            .send({ ...(await body()), availability: 'INVALID' })
            .expect(400);
          await assert.rejects(
            db
              .updateTable('service_definition')
              .set({ availability: 'INTERNAL_ONLY' })
              .where('id', '=', id)
              .execute(),
          );
          await assert.rejects(db.transaction().execute(down));
        },
      );
      await t.test(
        'both writers require every permission and retain scoped GET',
        async () => {
          const before = await state(id);
          for (const keys of [
            [],
            ['catalog.issue_action.manage'],
            ['admin.configuration.read', 'admin.issues.write'],
            ['admin.configuration.read', 'catalog.issue_action.manage'],
            ['admin.issues.write', 'catalog.issue_action.manage'],
          ]) {
            await grants(keys as Permission[]);
            await request(api)
              .post(legacyPath)
              .set('Authorization', 'Bearer fictional')
              .send(input)
              .expect(403);
            const { expectedRevision: ignored, ...handling } = input;
            void ignored;
            await request(api)
              .patch(modernPath)
              .set('Authorization', 'Bearer fictional')
              .send({ ...(await body()), handling })
              .expect(403);
          }
          await grants(['catalog.issue_action.manage']);
          await request(api)
            .get(legacyPath)
            .set('Authorization', 'Bearer fictional')
            .expect(200)
            .expect('Cache-Control', 'no-store');
          assert.deepEqual(await state(id), before);
          await grants(all);
        },
      );
      await t.test(
        'all permissions cannot bypass Organization or Department/Division scope',
        async () => {
          const before = await state(id);
          for (const scoped of [
            { ...access, organizationId: otherOrg },
            { ...access, departmentIds: [] },
            { ...access, divisionIds: [] },
          ]) {
            await assert.rejects(legacy.set(id, input, scoped));
            await assert.rejects(
              service.change(scoped, id, {
                ...(await body()),
                handling: {
                  actionType: input.actionType,
                  destination: input.destination,
                  message: input.message,
                  label: input.label,
                },
              }),
            );
          }
          assert.deepEqual(await state(id), before);
        },
      );
      await t.test(
        'legacy governed write creates one history/audit and stale/equivalent writes change nothing',
        async () => {
          await request(api)
            .post(legacyPath)
            .set('Authorization', 'Bearer fictional')
            .send(input)
            .expect(200);
          const before = await state(id);
          assert.equal(before.history.length, 1);
          assert.equal(before.audit.length, 1);
          assert.equal(before.issue.action_revision, 2);
          await request(api)
            .post(legacyPath)
            .set('Authorization', 'Bearer fictional')
            .send(input)
            .expect(409);
          await request(api)
            .post(legacyPath)
            .set('Authorization', 'Bearer fictional')
            .send({ ...input, expectedRevision: 2 })
            .expect(200);
          assert.deepEqual(await state(id), before);
        },
      );
      await t.test(
        'modern write uses same history/audit/no-op command and independent core revision',
        async () => {
          const before = await state(id),
            draft = await body();
          const handling = {
            actionType: 'external_redirect',
            destination: 'https://example.org/new',
            message: 'Updated fictional handoff',
            label: 'Continue',
          };
          await request(api)
            .patch(modernPath)
            .set('Authorization', 'Bearer fictional')
            .send({ ...draft, handling })
            .expect(200);
          const next = await state(id);
          assert.equal(next.issue.action_revision, 3);
          assert.equal(next.issue.core_revision, before.issue.core_revision);
          assert.equal(next.history.length, 2);
          assert.equal(next.audit.length, 2);
          await request(api)
            .patch(modernPath)
            .set('Authorization', 'Bearer fictional')
            .send({ ...draft, handling })
            .expect(409);
          await request(api)
            .patch(modernPath)
            .set('Authorization', 'Bearer fictional')
            .send({ ...(await body()), handling })
            .expect(200);
          assert.deepEqual(await state(id), next);
        },
      );
      await t.test(
        'history and audit failures roll back combined modern Save and legacy writes',
        async () => {
          for (const table of ['issue_action_history', 'issue_action_audit']) {
            await sql`create function fail_action_test() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end $$`.execute(
              db,
            );
            await sql`create trigger fail_action_test before insert on ${sql.table(table)} for each row execute function fail_action_test()`.execute(
              db,
            );
            const before = await state(id);
            await assert.rejects(
              legacy.set(id, { ...input, expectedRevision: 3 }, access),
            );
            await assert.rejects(
              service.change(access, id, {
                ...(await body()),
                name: 'Must roll back',
                handling: { actionType: 'internal_intake' },
              }),
            );
            assert.deepEqual(await state(id), before);
            await sql`drop trigger fail_action_test on ${sql.table(table)}; drop function fail_action_test()`.execute(
              db,
            );
          }
        },
      );
      await t.test(
        'create/action races have one winner, and history is immutable',
        async () => {
          const race = await Promise.allSettled([
            legacy.set(id, { ...input, expectedRevision: 3 }, access),
            legacy.set(
              id,
              { ...input, expectedRevision: 3, message: 'Competing' },
              access,
            ),
          ]);
          assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
          for (const table of ['issue_action_history', 'issue_action_audit']) {
            await assert.rejects(
              sql`update ${sql.table(table)} set issue_id=issue_id`.execute(db),
            );
            await assert.rejects(
              sql`delete from ${sql.table(table)}`.execute(db),
            );
            await assert.rejects(sql`truncate ${sql.table(table)}`.execute(db));
          }
        },
      );
      await t.test(
        'redirect suppresses questions, external-only discovery excludes internal context',
        async () => {
          await service.change(access, id, { ...(await body()), active: true });
          const catalog = new CatalogRepository({
            client: db,
          } as DatabaseService);
          assert.ok(await catalog.getPublishedIssue(org, id, 'external'));
          assert.equal(
            await catalog.getPublishedIssue(org, id, 'internal'),
            undefined,
          );
          assert.deepEqual(
            (await catalog.getPublishedIssue(org, id, 'external'))?.questions,
            [],
          );
          const result = await app
            .get(AdminIssueDiscoveryService)
            .list(access, {
              availability: 'EXTERNAL_ONLY',
              handling: 'external_redirect',
            });
          assert.equal(result.total, 1);
          assert.ok(!JSON.stringify(result).includes('https://'));
          const broad = (
            await service.detail(
              { ...access, permissions: ['admin.configuration.read'] },
              id,
            )
          ).issue;
          assert.equal(broad.handling, undefined);
        },
      );
      await t.test(
        'invalid stored destination is repairable but cannot activate or resolve publicly',
        async () => {
          await service.change(access, id, {
            ...(await body()),
            active: false,
          });
          await db
            .updateTable('service_definition')
            .set({ redirect_url: 'https://127.0.0.1/private' })
            .where('id', '=', id)
            .execute();
          const detail = await service.detail(access, id);
          assert.equal(
            detail.issue.handling?.redirect?.destination,
            'https://127.0.0.1/private',
          );
          const before = await state(id);
          await assert.rejects(
            service.change(access, id, { ...(await body()), active: true }),
          );
          assert.deepEqual(await state(id), before);
          await legacy.set(
            id,
            { ...input, expectedRevision: before.issue.action_revision },
            access,
          );
          await service.change(access, id, { ...(await body()), active: true });
        },
      );
      await t.test(
        'resident and authorized staff contexts enforce availability independently of API channel',
        async () => {
          const creator = new CreateServiceRequestService(
            { get: () => org } as unknown as ConfigService<
              AppConfiguration,
              true
            >,
            { client: db } as DatabaseService,
            new ServiceRequestRepository(),
            {
              execute: async () => ({
                result: 'eligible',
                policyType: 'no_geographic_restriction',
                validatedAt: new Date(),
                providerKey: 'development',
                providerReference: null,
                reasonCode: 'development_match',
              }),
            } as never,
          );
          const creatorAccess = {
            ...access,
            permissions: [
              ...all,
              'service_request.create',
              'service_request.create_internal',
            ] as Permission[],
          };
          for (const availability of [
            'INTERNAL_ONLY',
            'EXTERNAL_ONLY',
            'INTERNAL_AND_EXTERNAL',
          ] as const) {
            const created = (
              await service.create(access, {
                ...create,
                name: `Fictional ${availability}`,
                availability,
              })
            ).issue;
            await service.change(access, created.id, {
              name: created.name,
              description: created.description,
              displayOrder: created.displayOrder,
              requesterPolicy: 'ANONYMOUS_ALLOWED',
              defaultAssignment: null,
              active: true,
              expectedCoreRevision: created.coreRevision,
              expectedActionRevision: created.actionRevision,
              expectedPolicyRevision: created.policyRevision,
              expectedAssignmentRevision: created.assignmentRevision,
            });
            assert.ok(created.catalogVersionId);
            const input = {
              serviceDefinitionId: created.id,
              serviceDefinitionVersionId: created.catalogVersionId,
              description: 'Fictional availability test',
              reportingIdentity: 'anonymous',
              answers: [],
            } satisfies CreateServiceRequestDto;
            if (availability === 'INTERNAL_ONLY') {
              await assert.rejects(creator.execute(input));
              await assert.rejects(
                creator.executeStaff(
                  { ...input, audience: 'public', intakeChannel: 'api' },
                  creatorAccess,
                ),
              );
            } else {
              await creator.execute(input);
              await creator.executeStaff(
                { ...input, audience: 'public', intakeChannel: 'api' },
                creatorAccess,
              );
            }
            const internal = {
              ...input,
              reportingIdentity: 'identified' as const,
              audience: 'internal' as const,
              intakeChannel: 'api' as const,
            };
            if (availability === 'EXTERNAL_ONLY')
              await assert.rejects(
                creator.executeStaff(internal, creatorAccess),
              );
            else await creator.executeStaff(internal, creatorAccess);
          }
          const before = (
            await sql`select (select count(*) from service_request) requests,(select count(*) from answer) answers,(select count(*) from requester_contact) contacts,(select count(*) from request_tracking_credential) credentials`.execute(
              db,
            )
          ).rows;
          const redirect = (await service.detail(access, id)).issue;
          assert.ok(redirect.catalogVersionId);
          await assert.rejects(
            creator.execute({
              serviceDefinitionId: id,
              serviceDefinitionVersionId: redirect.catalogVersionId,
              description: 'Cannot submit redirect',
              reportingIdentity: 'anonymous',
              answers: [],
            }),
          );
          assert.deepEqual(
            (
              await sql`select (select count(*) from service_request) requests,(select count(*) from answer) answers,(select count(*) from requester_contact) contacts,(select count(*) from request_tracking_credential) credentials`.execute(
                db,
              )
            ).rows,
            before,
          );
        },
      );
      await t.test(
        'creation admitted under the shared Issue lock completes before redirect; subsequent creation is rejected',
        async () => {
          const item = (
            await service.create(access, {
              ...create,
              name: 'Fictional creation race',
            })
          ).issue;
          await service.change(access, item.id, {
            name: item.name,
            description: item.description,
            displayOrder: item.displayOrder,
            requesterPolicy: 'ANONYMOUS_ALLOWED',
            defaultAssignment: null,
            active: true,
            expectedCoreRevision: item.coreRevision,
            expectedActionRevision: item.actionRevision,
            expectedPolicyRevision: item.policyRevision,
            expectedAssignmentRevision: item.assignmentRevision,
          });
          assert.ok(item.catalogVersionId);
          let admit: () => void = () => {
              throw new Error('gate not initialized');
            },
            resume: () => void = () => {
              throw new Error('gate not initialized');
            };
          const entered = new Promise<void>((resolve) => {
              admit = resolve;
            }),
            release = new Promise<void>((resolve) => {
              resume = resolve;
            });
          const repository = new ServiceRequestRepository(),
            load = repository.loadSubmissionDefinition.bind(repository);
          repository.loadSubmissionDefinition = async (
            ...args: Parameters<
              ServiceRequestRepository['loadSubmissionDefinition']
            >
          ) => {
            const result = await load(...args);
            admit();
            await release;
            return result;
          };
          const creator = new CreateServiceRequestService(
            { get: () => org } as unknown as ConfigService<
              AppConfiguration,
              true
            >,
            { client: db } as DatabaseService,
            repository,
            {
              execute: async () => ({
                result: 'eligible',
                policyType: 'no_geographic_restriction',
                validatedAt: new Date(),
                providerKey: 'development',
                providerReference: null,
                reasonCode: 'development_match',
              }),
            } as never,
          );
          const requestInput = {
            serviceDefinitionId: item.id,
            serviceDefinitionVersionId: item.catalogVersionId,
            description: 'Fictional admitted creation',
            reportingIdentity: 'anonymous' as const,
            answers: [],
          };
          const creating = creator.execute(requestInput);
          await Promise.race([
            entered,
            creating.then(() => {
              throw new Error('Creation bypassed gate');
            }),
          ]);
          const changing = legacy.set(
            item.id,
            { ...input, expectedRevision: 1 },
            access,
          );
          resume();
          const [receipt, changed] = await Promise.all([creating, changing]);
          assert.ok(receipt.id);
          assert.equal(changed.revision, 2);
          await assert.rejects(creator.execute(requestInput));
        },
      );
      await governedAvailabilityChecks(
        t,
        db,
        service,
        access,
        create,
        otherOrg,
      );
    } finally {
      await app.close();
      await db.destroy();
      await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  },
);
