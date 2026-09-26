import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { AdminAccessController } from '../../src/admin/admin-access.controller.js';
import { StaffAccessGuard } from '../../src/auth/staff-access.guard.js';
import { StaffAuthorizationService } from '../../src/auth/staff-authorization.service.js';
import { EntraTokenService } from '../../src/auth/entra-token.service.js';
import { DatabaseService } from '../../src/database/database.service.js';
import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { HttpException } from '@nestjs/common';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import {
  permissions,
  type Permission,
  type StaffAccess,
} from '../../src/auth/auth.types.js';
import { accessPrerequisites } from '../../src/access/access-policy.js';
import {
  changeManagedAccess,
  provisionAccessAdministrator,
  provisionAccessReader,
} from '../../src/access/access-foundation.js';
import {
  accessDetail,
  accessHistory,
} from '../../src/access/access-discovery.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import { assertPersonalAccessTarget } from '../../src/database/personal-access-uat.js';

test(
  'F057.3 atomic runtime and personal provisioning prerequisite',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const schema = `configure_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await prepareDatabaseExtensions(admin);
    await admin.query(`create schema "${schema}"`);
    const db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: process.env.TEST_DATABASE_URL,
          options: `-c search_path=${schema}`,
          max: 8,
        }),
      }),
    });
    const org = randomUUID(),
      actorId = randomUUID(),
      tenant = randomUUID();
    const actor: StaffAccess = {
      organizationId: org,
      staffIdentityId: actorId,
      tenantId: tenant,
      objectId: actorId,
      displayName: 'Synthetic actor',
      permissions: [...accessPrerequisites],
      development: false,
      scopes: [],
      departmentIds: [],
      divisionIds: [],
    };
    const revision = async () =>
      (
        await db
          .selectFrom('organization_access_state')
          .select('authorization_revision')
          .where('organization_id', '=', org)
          .executeTakeFirstOrThrow()
      ).authorization_revision;
    const staff = async () => {
      const id = randomUUID();
      await db
        .insertInto('staff_identity')
        .values({
          id,
          organization_id: org,
          display_name: 'Synthetic access target',
          active: true,
          email: null,
          entra_tenant_id: tenant,
          entra_object_id: id,
        })
        .execute();
      return id;
    };
    const outside = async (id: string, keys: Permission[]) => {
      const role = randomUUID();
      await db
        .insertInto('role')
        .values({ id: role, organization_id: org, name: role, active: true })
        .execute();
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
          staff_identity_id: id,
          role_id: role,
          active: true,
        })
        .execute();
      return role;
    };
    const change = async (
      id: string,
      permissions: string[],
      expectedRevision?: string,
    ) =>
      changeManagedAccess(db, actor, {
        staffId: id,
        permissions,
        expectedRevision: expectedRevision ?? (await revision()),
      });
    const fingerprint = async () => {
      const result: unknown[] = [];
      for (const table of [
        'organization_access_state',
        'role',
        'role_permission',
        'staff_role_assignment',
        'access_role_ownership',
        'access_change_set',
        'access_permission_delta',
      ])
        result.push(
          (
            await sql`select row_to_json(t) as row from ${sql.table(table)} t order by row_to_json(t)::text`.execute(
              db,
            )
          ).rows,
        );
      return result;
    };
    const code = (expected: string) => (error: unknown) =>
      error instanceof HttpException &&
      (error.getResponse() as { code?: string }).code === expected;
    try {
      const folder = path.resolve(__dirname, '../../migrations');
      for (const file of (await readdir(folder))
        .filter((f) => f.endsWith('.js'))
        .sort()) {
        const migration = (await import(
          pathToFileURL(path.join(folder, file)).href
        )) as { up: (d: Kysely<DatabaseSchema>) => Promise<void> };
        await db.transaction().execute((trx) => migration.up(trx));
      }
      await db
        .insertInto('permission')
        .values(permissions.map((permission_key) => ({ permission_key })))
        .onConflict((oc) => oc.column('permission_key').doNothing())
        .execute();
      await db
        .insertInto('organization')
        .values({
          id: org,
          name: 'Synthetic configure test',
          short_name: 'Test',
          slug: org,
          status: 'active',
          default_business_timezone: 'UTC',
        })
        .execute();
      await db
        .insertInto('staff_identity')
        .values({
          id: actorId,
          organization_id: org,
          display_name: 'Synthetic actor',
          email: null,
          active: true,
          entra_tenant_id: tenant,
          entra_object_id: actorId,
        })
        .execute();
      await provisionAccessAdministrator(db, {
        organizationId: org,
        staffId: actorId,
        expectedRevision: await revision(),
        expectedBootstrap: false,
        operation: 'bootstrap',
        dryRun: false,
      });

      await t.test(
        'F057.3D same-target concurrent saves accept exactly one and preserve loser snapshot',
        async () => {
          const id = await staff(),
            rev = await revision();
          const results = await Promise.allSettled([
            change(id, ['service_request.view'], rev),
            change(id, ['service_request.create'], rev),
          ]);
          assert.equal(
            results.filter((r) => r.status === 'fulfilled').length,
            1,
          );
          assert.equal(
            results.filter(
              (r) =>
                r.status === 'rejected' && code('ACCESS_STATE_STALE')(r.reason),
            ).length,
            1,
          );
          assert.equal(await revision(), (BigInt(rev) + 1n).toString());
          assert.equal((await accessHistory(db, actor, id, {})).total, 1);
        },
      );
      await t.test(
        'F057.3D outside and membership writers make open drafts stale without rejected-save effects',
        async () => {
          const id = await staff();
          const department = randomUUID();
          await db
            .insertInto('department')
            .values({
              id: department,
              organization_id: org,
              name: 'Synthetic scope',
              description: null,
              status: 'active',
              display_order: 1,
            })
            .execute();
          for (const write of [
            () => outside(id, ['service_request.view']),
            () =>
              db
                .insertInto('staff_department_membership')
                .values({
                  organization_id: org,
                  staff_identity_id: id,
                  department_id: department,
                  active: true,
                })
                .execute(),
          ]) {
            const loaded = await accessDetail(db, actor, id);
            await write();
            const before = await fingerprint(),
              rev = await revision();
            await assert.rejects(
              change(
                id,
                ['service_request.create'],
                loaded.authorizationRevision,
              ),
              code('ACCESS_STATE_STALE'),
            );
            assert.equal(await revision(), rev);
            assert.deepEqual(await fingerprint(), before);
          }
        },
      );
      await t.test(
        'F057.3D revalidates target deactivation and cached actor authority, including fallback',
        async () => {
          const id = await staff(),
            rev = await revision();
          await db
            .updateTable('staff_identity')
            .set({ active: false })
            .where('id', '=', id)
            .execute();
          let before = await fingerprint();
          await assert.rejects(
            change(id, ['service_request.create'], rev),
            code('ACCESS_STATE_STALE'),
          );
          await assert.rejects(
            change(id, ['service_request.create']),
            code('ACCESS_TARGET_INACTIVE'),
          );
          const detail = await accessDetail(db, actor, id);
          assert.equal(detail.canConfigure, false);
          assert.equal(detail.staff.active, false);
          assert.deepEqual(await fingerprint(), before);
          const reader = await staff();
          await outside(reader, [
            'admin.configuration.read',
            'admin.access.read',
          ]);
          const cached = {
            ...actor,
            staffIdentityId: reader,
            objectId: reader,
          };
          before = await fingerprint();
          assert.equal(
            (await accessDetail(db, cached, id)).canConfigure,
            false,
          );
          await assert.rejects(
            changeManagedAccess(db, cached, {
              staffId: id,
              permissions: [],
              expectedRevision: await revision(),
            }),
          );
          await assert.rejects(
            changeManagedAccess(
              db,
              { ...actor, development: true },
              {
                staffId: id,
                permissions: [],
                expectedRevision: await revision(),
              },
            ),
          );
          assert.deepEqual(await fingerprint(), before);
        },
      );
      await t.test(
        'F057.3D actor revoked during edit cannot use cached manager authority',
        async () => {
          const manager = await staff(),
            id = await staff();
          await provisionAccessAdministrator(db, {
            organizationId: org,
            staffId: manager,
            operation: 'add-manager',
            expectedRevision: await revision(),
            expectedBootstrap: true,
            dryRun: false,
          });
          const cached = {
            ...actor,
            staffIdentityId: manager,
            objectId: manager,
          };
          const loaded = await accessDetail(db, cached, id);
          assert.equal(loaded.canConfigure, true);
          await provisionAccessAdministrator(db, {
            organizationId: org,
            staffId: manager,
            operation: 'remove-manager',
            expectedRevision: await revision(),
            expectedBootstrap: true,
            dryRun: false,
          });
          const before = await fingerprint();
          await assert.rejects(
            changeManagedAccess(db, cached, {
              staffId: id,
              permissions: ['service_request.create'],
              expectedRevision: loaded.authorizationRevision,
            }),
            (e: unknown) => e instanceof HttpException && e.getStatus() === 403,
          );
          assert.deepEqual(await fingerprint(), before);
        },
      );
      await t.test(
        'F057.3D unknown and foreign targets have identical safe responses',
        async () => {
          const otherOrg = randomUUID(),
            foreign = randomUUID();
          await db
            .insertInto('organization')
            .values({
              id: otherOrg,
              name: 'Other synthetic',
              short_name: 'Test',
              slug: otherOrg,
              status: 'active',
              default_business_timezone: 'UTC',
            })
            .execute();
          await db
            .insertInto('staff_identity')
            .values({
              id: foreign,
              organization_id: otherOrg,
              display_name: 'Other synthetic',
              active: true,
              email: null,
              entra_object_id: null,
            })
            .execute();
          const before = await fingerprint();
          const errors: unknown[] = [];
          for (const id of [foreign, randomUUID()]) {
            try {
              await change(id, ['service_request.create']);
              assert.fail('Unexpected acceptance');
            } catch (e) {
              assert.ok(e instanceof HttpException);
              assert.equal(e.getStatus(), 404);
              errors.push(e.getResponse());
            }
          }
          assert.deepEqual(errors[0], errors[1]);
          assert.deepEqual(await fingerprint(), before);
        },
      );
      await t.test(
        'F057.3D runtime rollback at every write stage and deferred commit',
        async (t) => {
          for (const table of [
            'role',
            'access_role_ownership',
            'staff_role_assignment',
            'role_permission',
            'organization_access_state',
            'access_change_set',
            'access_permission_delta',
            'deferred',
          ])
            await t.test(table, async () => {
              const id = await staff(),
                before = await fingerprint();
              const actual = table === 'deferred' ? 'access_change_set' : table;
              await sql
                .raw(
                  `create function fail_final() returns trigger language plpgsql as $$ begin raise exception 'Synthetic final failure'; end $$; create ${table === 'deferred' ? 'constraint ' : ''}trigger fail_final ${table === 'deferred' ? 'after' : 'before'} insert or update on ${actual} ${table === 'deferred' ? 'deferrable initially deferred' : ''} for each row execute function fail_final()`,
                )
                .execute(db);
              try {
                await assert.rejects(
                  change(id, ['service_request.create']),
                  /Synthetic final failure/,
                );
                assert.deepEqual(await fingerprint(), before);
              } finally {
                await sql
                  .raw(
                    `drop trigger fail_final on ${actual};drop function fail_final()`,
                  )
                  .execute(db);
              }
            });
          await t.test('permission removal rollback', async () => {
            const id = await staff();
            await change(id, ['service_request.create']);
            const before = await fingerprint();
            await sql`create function fail_final() returns trigger language plpgsql as $$ begin raise exception 'Synthetic final removal failure'; end $$; create trigger fail_final before delete on role_permission for each row execute function fail_final()`.execute(
              db,
            );
            try {
              await assert.rejects(
                change(id, []),
                /Synthetic final removal failure/,
              );
              assert.deepEqual(await fingerprint(), before);
            } finally {
              await sql`drop trigger fail_final on role_permission;drop function fail_final()`.execute(
                db,
              );
            }
          });
        },
      );
      await t.test(
        'first grant returns committed projection, delta and exactly one revision; equal state writes nothing',
        async () => {
          const id = await staff(),
            before = await revision();
          const result = await change(id, [
            'service_request.view',
            'service_request.view',
          ]);
          assert.equal(
            result.authorizationRevision,
            (BigInt(before) + 1n).toString(),
          );
          assert.deepEqual(result.detail.effective, ['service_request.view']);
          assert.equal(result.detail.contributions[0]?.managed, true);
          assert.deepEqual(result.changes.addedEffectivePermissionKeys, [
            'service_request.view',
          ]);
          const snapshot = await fingerprint();
          assert.equal(
            (await change(id, ['service_request.view'])).changed,
            false,
          );
          assert.deepEqual(await fingerprint(), snapshot);
          const history = await accessHistory(db, actor, id, {});
          assert.equal(history.items.length, 1);
          assert.equal(history.items[0]?.operation, 'update_managed_access');
        },
      );
      await t.test(
        'outside-only redundant addition rejects; mixed removal retains effective access and ownership',
        async () => {
          const id = await staff();
          await change(id, ['service_request.view']);
          await outside(id, ['service_request.view']);
          const result = await change(id, []);
          assert.deepEqual(
            result.changes.removedManagedStillEffectivePermissionKeys,
            ['service_request.view'],
          );
          assert.deepEqual(result.detail.effective, ['service_request.view']);
          const before = await fingerprint();
          await assert.rejects(
            change(id, ['service_request.view']),
            code('ACCESS_REDUNDANT_ASSIGNMENT'),
          );
          assert.deepEqual(await fingerprint(), before);
          assert.equal(
            (
              await db
                .selectFrom('access_role_ownership')
                .select('role_id')
                .where('staff_identity_id', '=', id)
                .execute()
            ).length,
            1,
          );
        },
      );
      await t.test(
        'indirect Administrator promotion and demotion reject even with another manager; ordinary manager edits remain valid',
        async () => {
          const promotion = await staff();
          await outside(promotion, [
            'admin.access.read',
            'admin.access.manage',
          ]);
          const before = await fingerprint();
          await assert.rejects(
            change(promotion, ['admin.configuration.read']),
            code('ACCESS_ADMINISTRATOR_CHANGE_REQUIRES_PROVISIONING'),
          );
          assert.deepEqual(await fingerprint(), before);
          const demotion = await staff();
          await change(demotion, ['admin.configuration.read']);
          await outside(demotion, ['admin.access.read', 'admin.access.manage']);
          const snapshot = await fingerprint();
          await assert.rejects(
            change(demotion, []),
            code('ACCESS_ADMINISTRATOR_CHANGE_REQUIRES_PROVISIONING'),
          );
          assert.deepEqual(await fingerprint(), snapshot);
          const changed = await change(demotion, [
            'admin.configuration.read',
            'service_request.view',
          ]);
          assert.equal(changed.detail.accessAdministrator, true);
          await outside(demotion, ['admin.configuration.read']);
          assert.equal(
            (await change(demotion, ['service_request.view'])).detail
              .accessAdministrator,
            true,
          );
        },
      );
      await t.test(
        'dependencies include outside dependents and reject equal invalid legacy state without mutation',
        async () => {
          const id = await staff();
          await outside(id, ['service_request.note.create']);
          const before = await fingerprint();
          await assert.rejects(
            change(id, []),
            code('ACCESS_DEPENDENCY_INVALID'),
          );
          assert.deepEqual(await fingerprint(), before);
          await change(id, ['service_request.note.read']);
          await assert.rejects(
            change(id, []),
            code('ACCESS_DEPENDENCY_INVALID'),
          );
        },
      );
      await t.test(
        'same revision different-target saves serialize, one commits and one rejects stale',
        async () => {
          const first = await staff(),
            second = await staff(),
            rev = await revision();
          const results = await Promise.allSettled([
            change(first, ['service_request.view'], rev),
            change(second, ['service_request.view'], rev),
          ]);
          assert.equal(
            results.filter((r) => r.status === 'fulfilled').length,
            1,
          );
          assert.equal(
            results.filter(
              (r) =>
                r.status === 'rejected' && code('ACCESS_STATE_STALE')(r.reason),
            ).length,
            1,
          );
          assert.equal(await revision(), (BigInt(rev) + 1n).toString());
        },
      );
      await t.test(
        'inactive/self/non-manageable input rejects atomically',
        async () => {
          const id = await staff();
          await db
            .updateTable('staff_identity')
            .set({ active: false })
            .where('id', '=', id)
            .execute();
          const before = await fingerprint();
          await assert.rejects(change(id, []), code('ACCESS_TARGET_INACTIVE'));
          await assert.rejects(
            change(actorId, []),
            code('ACCESS_SELF_EDIT_FORBIDDEN'),
          );
          for (const key of [
            'admin.access.manage',
            'admin.access.read',
            'geospatial.read',
            'ai.workspace.access',
            'ai.administration.access',
            'forged',
          ])
            await assert.rejects(
              change(id, [key]),
              code('ACCESS_PERMISSION_NOT_MANAGEABLE'),
            );
          assert.deepEqual(await fingerprint(), before);
        },
      );
      await t.test(
        'audit failure rolls back fresh role, ownership, deltas and revision',
        async () => {
          const id = await staff(),
            before = await fingerprint();
          await sql`create function fail_configure() returns trigger language plpgsql as $$ begin raise exception 'Synthetic injected failure'; end $$; create trigger fail_configure before insert on access_permission_delta for each row execute function fail_configure()`.execute(
            db,
          );
          try {
            await assert.rejects(change(id, ['service_request.view']));
            assert.deepEqual(await fingerprint(), before);
          } finally {
            await sql`drop trigger fail_configure on access_permission_delta;drop function fail_configure()`.execute(
              db,
            );
          }
        },
      );
      await t.test(
        'personal selected mapping is required and rechecked inside provisioning transaction',
        async () => {
          const id = await staff();
          const env = {
            F057_STAFF_ID: id,
            F057_ORGANIZATION_ID: org,
            ENTRA_TENANT_ID: tenant,
          };
          await assertPersonalAccessTarget(db, env);
          await assert.rejects(
            assertPersonalAccessTarget(db, {
              ...env,
              ENTRA_TENANT_ID: randomUUID(),
            }),
          );
          const before = await fingerprint();
          await assert.rejects(
            provisionAccessAdministrator(db, {
              organizationId: org,
              staffId: id,
              personalTenantId: randomUUID(),
              expectedRevision: await revision(),
              expectedBootstrap: true,
              operation: 'add-manager',
              dryRun: true,
            }),
          );
          assert.deepEqual(await fingerprint(), before);
        },
      );
      await t.test(
        'personal-like Reader dry-run adds only manage, retains independent configuration and Reader; no writes',
        async () => {
          const id = await staff();
          await outside(id, ['admin.configuration.read']);
          await provisionAccessReader(db, {
            organizationId: org,
            staffId: id,
            expectedRevision: await revision(),
            expectedBootstrap: true,
            operation: 'grant-reader',
            dryRun: false,
          });
          const before = await fingerprint();
          const rev = await revision();
          const preview = await provisionAccessAdministrator(db, {
            organizationId: org,
            staffId: id,
            personalTenantId: tenant,
            expectedRevision: rev,
            expectedBootstrap: true,
            operation: 'add-manager',
            dryRun: true,
          });
          assert.deepEqual(preview.added, ['admin.access.manage']);
          assert.equal(
            preview.proposedAuthorizationRevision,
            (BigInt(rev) + 1n).toString(),
          );
          assert.equal(preview.reusesConfigurationRead, true);
          assert.equal(preview.readerOwnershipRemainsSeparate, true);
          assert.equal(preview.remainsAccessAdministrator, true);
          assert.ok(preview.proposedAudit);
          assert.equal(preview.proposedAudit.permissionDeltas, 1);
          assert.deepEqual(await fingerprint(), before);
          assert.equal(
            (await accessDetail(db, actor, id)).accessAdministrator,
            false,
          );
        },
      );
      await t.test(
        'HTTP PATCH commits through actual guard and database authorization and returns no-store projection',
        async () => {
          const id = await staff();
          const module = await Test.createTestingModule({
            controllers: [AdminAccessController],
            providers: [
              StaffAccessGuard,
              StaffAuthorizationService,
              Reflector,
              { provide: DatabaseService, useValue: { client: db } },
              { provide: ConfigService, useValue: { get: () => false } },
              {
                provide: EntraTokenService,
                useValue: {
                  enabled: true,
                  validate: async () => ({
                    tenantId: tenant,
                    objectId: actorId,
                    scopes: ['access_as_user'],
                  }),
                  hasRequiredScope: () => true,
                },
              },
            ],
          }).compile();
          const app = module.createNestApplication({ logger: false });
          app.setGlobalPrefix('api/v1');
          await app.init();
          try {
            const result = await request(app.getHttpServer())
              .patch(`/api/v1/admin/access/principals/${id}`)
              .set('Authorization', 'Bearer synthetic-test-only')
              .send({
                expectedAuthorizationRevision: await revision(),
                managedPermissionKeys: ['service_request.view'],
              })
              .expect(200);
            assert.equal(result.headers['cache-control'], 'no-store');
            const body = result.body as {
              changed: boolean;
              detail: { effective: string[]; staff: { id: string } };
            };
            assert.equal(body.changed, true);
            assert.deepEqual(body.detail.effective, ['service_request.view']);
            assert.equal(body.detail.staff.id, id);
            const serialized = JSON.stringify(body);
            assert.ok(!serialized.includes(tenant));
            assert.ok(!serialized.includes('role_id'));
            const inactive = await staff();
            await db
              .updateTable('staff_identity')
              .set({ active: false })
              .where('id', '=', inactive)
              .execute();
            for (const [selected, status] of [
              [actorId, 403],
              [inactive, 409],
              [randomUUID(), 404],
            ] as const) {
              const before = await fingerprint();
              await request(app.getHttpServer())
                .patch(`/api/v1/admin/access/principals/${selected}`)
                .set('Authorization', 'Bearer synthetic-test-only')
                .send({
                  expectedAuthorizationRevision: await revision(),
                  managedPermissionKeys: ['service_request.create'],
                })
                .expect(status);
              assert.deepEqual(await fingerprint(), before);
            }
            const loadedRevision = await revision();
            await outside(id, ['service_request.create']);
            const beforeStale = await fingerprint();
            const stale = await request(app.getHttpServer())
              .patch(`/api/v1/admin/access/principals/${id}`)
              .set('Authorization', 'Bearer synthetic-test-only')
              .send({
                expectedAuthorizationRevision: loadedRevision,
                managedPermissionKeys: [],
              })
              .expect(409);
            assert.equal(
              (stale.body as { code: string }).code,
              'ACCESS_STATE_STALE',
            );
            assert.deepEqual(await fingerprint(), beforeStale);
          } finally {
            await app.close();
          }
        },
      );
      await t.test(
        'unbootstrapped personal-like Reader bootstrap preview is read-only and reports the permanent transition',
        async () => {
          const selectedOrg = randomUUID(),
            id = randomUUID(),
            role = randomUUID();
          await db
            .insertInto('organization')
            .values({
              id: selectedOrg,
              name: 'Synthetic personal UAT',
              short_name: 'Test',
              slug: selectedOrg,
              status: 'active',
              default_business_timezone: 'UTC',
            })
            .execute();
          await db
            .insertInto('staff_identity')
            .values({
              id,
              organization_id: selectedOrg,
              display_name: 'Synthetic personal Reader',
              email: null,
              active: true,
              entra_tenant_id: tenant,
              entra_object_id: id,
            })
            .execute();
          await db
            .insertInto('role')
            .values({
              id: role,
              organization_id: selectedOrg,
              name: 'Synthetic configuration contribution',
              active: true,
            })
            .execute();
          await db
            .insertInto('role_permission')
            .values({
              organization_id: selectedOrg,
              role_id: role,
              permission_key: 'admin.configuration.read',
            })
            .execute();
          await db
            .insertInto('staff_role_assignment')
            .values({
              organization_id: selectedOrg,
              staff_identity_id: id,
              role_id: role,
              active: true,
            })
            .execute();
          const current = async () =>
            await db
              .selectFrom('organization_access_state')
              .selectAll()
              .where('organization_id', '=', selectedOrg)
              .executeTakeFirstOrThrow();
          await provisionAccessReader(db, {
            organizationId: selectedOrg,
            staffId: id,
            expectedRevision: (await current()).authorization_revision,
            expectedBootstrap: false,
            operation: 'grant-reader',
            dryRun: false,
          });
          const before = await fingerprint(),
            rev = (await current()).authorization_revision;
          const preview = await provisionAccessAdministrator(db, {
            organizationId: selectedOrg,
            staffId: id,
            personalTenantId: tenant,
            expectedRevision: rev,
            expectedBootstrap: false,
            operation: 'bootstrap',
            dryRun: true,
          });
          assert.deepEqual(preview.added, ['admin.access.manage']);
          assert.equal(preview.bootstrapEstablished, false);
          assert.equal(preview.proposedBootstrapEstablished, true);
          assert.ok(preview.proposedAudit);
          assert.equal(
            preview.proposedAudit.operation,
            'bootstrap_access_administration',
          );
          assert.ok(preview.proposedAudit);
          assert.equal(preview.proposedAudit.changeSets, 1);
          assert.ok(preview.proposedAudit);
          assert.equal(preview.proposedAudit.permissionDeltas, 1);
          assert.equal(preview.reusesConfigurationRead, true);
          assert.equal(preview.readerOwnershipRemainsSeparate, true);
          assert.deepEqual(await fingerprint(), before);
          assert.equal((await current()).bootstrap_established, false);
        },
      );
    } finally {
      await db.destroy();
      await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  },
);
