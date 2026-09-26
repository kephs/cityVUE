import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';
import { permissions } from '../../src/auth/auth.types.js';
import { accessPrerequisites } from '../../src/access/access-policy.js';
import {
  changeManagedAccess,
  provisionAccessAdministrator,
} from '../../src/access/access-foundation.js';
import {
  accessDetail,
  accessHistory,
} from '../../src/access/access-discovery.js';
import { developmentOrganization } from '../../src/database/development-staff-input.js';
import {
  mixedAccessEnvironment,
  mixedAccessFixture as fixture,
  mixedAccessUat,
  type MixedAccessInput,
} from '../../src/database/mixed-access-uat.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';

test(
  'Jordan mixed-source fixture isolation and lifecycle',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const schema = `mixed_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await prepareDatabaseExtensions(admin);
    await admin.query(`create schema "${schema}"`);
    const db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: process.env.TEST_DATABASE_URL,
          options: `-c search_path=${schema}`,
          max: 1,
        }),
      }),
    });
    const org = developmentOrganization.id,
      actorId = randomUUID(),
      tenant = randomUUID();
    const env = {
      NODE_ENV: 'development',
      CITYVUE_DEPLOYMENT_PROFILE: 'development',
      CITYVUE_ENABLE_EXTERNAL_IDENTITY: 'true',
      F057_MIXED_SOURCE_UAT: 'true',
      ENTRA_TENANT_ID: tenant,
      F036_PERSONAL_ENTRA_TENANT_ID: tenant,
      F036_STAFF_ID: actorId,
      F036_ORGANIZATION_ID: org,
      DATABASE_URL:
        'postgresql://reqro_dev_user:synthetic@localhost:5432/reqro_dev',
    };
    const actor: StaffAccess = {
      organizationId: org,
      staffIdentityId: actorId,
      tenantId: tenant,
      objectId: actorId,
      displayName: 'Synthetic operator',
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
    const run = async (extra: Partial<MixedAccessInput> = {}) =>
      mixedAccessUat(db, env, {
        operation: 'add',
        staffId: fixture.staffId,
        permission: fixture.permission,
        expectedRevision: await revision(),
        dryRun: false,
        ...extra,
      });
    const fingerprint = async () => {
      const result = [];
      for (const table of [
        'organization_access_state',
        'staff_identity',
        'role',
        'role_permission',
        'staff_role_assignment',
        'staff_department_membership',
        'staff_division_membership',
        'access_role_ownership',
        'access_change_set',
        'access_permission_delta',
      ])
        result.push(
          (
            await sql`select row_to_json(t) row from ${sql.table(table)} t order by row_to_json(t)::text`.execute(
              db,
            )
          ).rows,
        );
      return result;
    };
    const managed = async (keys: string[]) =>
      changeManagedAccess(db, actor, {
        staffId: fixture.staffId,
        permissions: keys,
        expectedRevision: await revision(),
      });
    try {
      for (const file of (
        await readdir(path.resolve(__dirname, '../../migrations'))
      )
        .filter((f) => f.endsWith('.js'))
        .sort()) {
        const migration = (await import(
          pathToFileURL(path.resolve(__dirname, '../../migrations', file)).href
        )) as { up: (db: Kysely<DatabaseSchema>) => Promise<void> };
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
          ...developmentOrganization,
          short_name: 'Test',
          status: 'active',
          default_business_timezone: 'UTC',
        })
        .execute();
      await db
        .insertInto('staff_identity')
        .values([
          {
            id: actorId,
            organization_id: org,
            display_name: 'Synthetic operator',
            active: true,
            email: null,
            entra_tenant_id: tenant,
            entra_object_id: actorId,
          },
          {
            id: fixture.staffId,
            organization_id: org,
            display_name: 'Jordan Example',
            active: true,
            email: 'jordan@example.test',
            entra_tenant_id: null,
            entra_object_id: null,
          },
        ])
        .execute();
      await provisionAccessAdministrator(db, {
        organizationId: org,
        staffId: actorId,
        expectedRevision: await revision(),
        expectedBootstrap: false,
        operation: 'bootstrap',
        dryRun: false,
        personalTenantId: tenant,
      });
      await t.test(
        'environment rejects missing opt-in, nondevelopment, unapproved tenant and remote database',
        () => {
          mixedAccessEnvironment(env);
          for (const key of Object.keys(env))
            assert.throws(() => mixedAccessEnvironment({ ...env, [key]: '' }));
          for (const patch of [
            { NODE_ENV: 'production' },
            { CITYVUE_DEPLOYMENT_PROFILE: 'production' },
            {
              DATABASE_URL:
                'postgresql://reqro_dev_user:x@remote:5432/reqro_dev',
            },
            { F036_PERSONAL_ENTRA_TENANT_ID: randomUUID() },
          ])
            assert.throws(() => mixedAccessEnvironment({ ...env, ...patch }));
        },
      );
      await t.test(
        'dry-run blocked before manual grant; execution rejects with no changes',
        async () => {
          const before = await fingerprint();
          const result = await run({ dryRun: true });
          assert.equal(result.ready, false);
          assert.equal(result.proposedAuthorizationRevision, null);
          await assert.rejects(run(), /manually/);
          assert.deepEqual(await fingerprint(), before);
        },
      );
      await t.test(
        'exact target, permission and canonical revision required',
        async () => {
          const before = await fingerprint();
          for (const patch of [
            { staffId: actorId },
            { permission: 'admin.access.manage' },
            { permission: 'service_request.view' },
            { expectedRevision: '01' },
            { expectedRevision: '0' },
          ])
            await assert.rejects(run(patch));
          assert.deepEqual(await fingerprint(), before);
        },
      );
      await t.test(
        'mapped or altered Jordan and cross-Organization target reject',
        async () => {
          for (const patch of [
            { entra_tenant_id: tenant, entra_object_id: randomUUID() },
            { display_name: 'Real person' },
            { active: false },
          ]) {
            await db
              .updateTable('staff_identity')
              .set(patch)
              .where('id', '=', fixture.staffId)
              .execute();
            const before = await fingerprint();
            await assert.rejects(run());
            assert.deepEqual(await fingerprint(), before);
            await db
              .updateTable('staff_identity')
              .set({
                entra_tenant_id: null,
                entra_object_id: null,
                display_name: 'Jordan Example',
                active: true,
              })
              .where('id', '=', fixture.staffId)
              .execute();
          }
          const other = randomUUID();
          await db
            .insertInto('organization')
            .values({
              id: other,
              name: 'Other synthetic',
              slug: other,
              short_name: 'Other',
              status: 'active',
              default_business_timezone: 'UTC',
            })
            .execute();
          await db
            .updateTable('staff_identity')
            .set({ organization_id: other })
            .where('id', '=', fixture.staffId)
            .execute();
          const before = await fingerprint();
          await assert.rejects(run(), /Organization/);
          assert.deepEqual(await fingerprint(), before);
          await db
            .updateTable('staff_identity')
            .set({ organization_id: org })
            .where('id', '=', fixture.staffId)
            .execute();
        },
      );
      const departmentId = randomUUID(),
        divisionId = randomUUID();
      await db
        .insertInto('department')
        .values({
          id: departmentId,
          organization_id: org,
          name: 'Synthetic department',
          description: null,
          status: 'active',
          display_order: 1,
        })
        .execute();
      await db
        .insertInto('division')
        .values({
          id: divisionId,
          department_id: departmentId,
          organization_id: org,
          name: 'Synthetic division',
          description: null,
          status: 'active',
          display_order: 1,
        })
        .execute();
      await db
        .insertInto('staff_department_membership')
        .values({
          organization_id: org,
          staff_identity_id: fixture.staffId,
          department_id: departmentId,
          active: true,
        })
        .execute();
      await db
        .insertInto('staff_division_membership')
        .values({
          organization_id: org,
          staff_identity_id: fixture.staffId,
          department_id: departmentId,
          division_id: divisionId,
          active: true,
        })
        .execute();
      await managed([fixture.permission]);
      const owner = await db
        .selectFrom('access_role_ownership')
        .selectAll()
        .where('staff_identity_id', '=', fixture.staffId)
        .executeTakeFirstOrThrow();
      const historyBefore = await accessHistory(db, actor, fixture.staffId, {});
      await t.test(
        'ready dry-run reports one outside permission without writing',
        async () => {
          const before = await fingerprint(),
            rev = await revision(),
            report = await run({ dryRun: true });
          assert.equal(report.ready, true);
          assert.equal(report.mixedAfter, true);
          assert.deepEqual(report.managed, [fixture.permission]);
          assert.equal(
            report.proposedAuthorizationRevision,
            (BigInt(rev) + 1n).toString(),
          );
          assert.deepEqual(await fingerprint(), before);
        },
      );
      await t.test(
        'shared role name or ID collisions reject without adoption',
        async () => {
          for (const role of [
            { id: randomUUID(), name: fixture.roleName },
            { id: fixture.roleId, name: 'F036 or shared role' },
          ]) {
            await db
              .insertInto('role')
              .values({
                ...role,
                organization_id: org,
                description: 'Unrelated role',
                active: true,
              })
              .execute();
            const before = await fingerprint();
            await assert.rejects(run(), /ownership mismatch/);
            assert.deepEqual(await fingerprint(), before);
            await db.deleteFrom('role').where('id', '=', role.id).execute();
          }
        },
      );
      await t.test(
        'failure on assignment rolls back role, permission and revision',
        async () => {
          await sql`create function fail_fixture_assignment() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end $$`.execute(
            db,
          );
          await sql
            .raw(
              `create trigger fail_fixture before insert on staff_role_assignment for each row when (new.role_id='${fixture.roleId}') execute function fail_fixture_assignment()`,
            )
            .execute(db);
          const before = await fingerprint();
          await assert.rejects(run(), /synthetic failure/);
          assert.deepEqual(await fingerprint(), before);
          await sql`drop trigger fail_fixture on staff_role_assignment`.execute(
            db,
          );
        },
      );
      await t.test(
        'add is atomic, outside-only, target-only and advances revision once',
        async () => {
          const before = await fingerprint(),
            rev = await revision();
          const report = await run();
          assert.equal(
            report.proposedAuthorizationRevision,
            (BigInt(rev) + 1n).toString(),
          );
          assert.equal(await revision(), report.proposedAuthorizationRevision);
          assert.deepEqual(
            await db
              .selectFrom('role_permission')
              .select('permission_key')
              .where('role_id', '=', fixture.roleId)
              .execute(),
            [{ permission_key: fixture.permission }],
          );
          assert.deepEqual(
            await db
              .selectFrom('staff_role_assignment')
              .select('staff_identity_id')
              .where('role_id', '=', fixture.roleId)
              .execute(),
            [{ staff_identity_id: fixture.staffId }],
          );
          assert.equal(
            (
              await db
                .selectFrom('access_role_ownership')
                .selectAll()
                .where('role_id', '=', fixture.roleId)
                .execute()
            ).length,
            0,
          );
          const after = await fingerprint();
          for (const index of [2, 3, 4]) {
            const original = before[index] ?? [];
            const current = after[index] ?? [];
            assert.equal(current.length, original.length + 1);
            for (const row of original)
              assert.ok(
                current.some(
                  (value) => JSON.stringify(value) === JSON.stringify(row),
                ),
              );
          }
          for (const index of [1, 5, 6, 7, 8, 9])
            assert.deepEqual(after[index], before[index]);
          assert.deepEqual(
            await accessHistory(db, actor, fixture.staffId, {}),
            historyBefore,
          );
          assert.deepEqual(
            await db
              .selectFrom('access_role_ownership')
              .selectAll()
              .where('staff_identity_id', '=', fixture.staffId)
              .executeTakeFirstOrThrow(),
            owner,
          );
        },
      );
      await t.test('repeat add is no-op and stale replay rejects', async () => {
        const before = await fingerprint();
        assert.equal((await run()).wouldChange, false);
        await assert.rejects(
          run({ expectedRevision: (BigInt(await revision()) - 1n).toString() }),
        );
        assert.deepEqual(await fingerprint(), before);
      });
      await t.test(
        'cleanup rejects extra assignment or permission; no repair',
        async () => {
          await db
            .insertInto('staff_role_assignment')
            .values({
              organization_id: org,
              staff_identity_id: actorId,
              role_id: fixture.roleId,
              active: true,
            })
            .execute();
          let before = await fingerprint();
          await assert.rejects(run({ operation: 'cleanup' }));
          assert.deepEqual(await fingerprint(), before);
          await db
            .deleteFrom('staff_role_assignment')
            .where('role_id', '=', fixture.roleId)
            .where('staff_identity_id', '=', actorId)
            .execute();
          await db
            .insertInto('role_permission')
            .values({
              organization_id: org,
              role_id: fixture.roleId,
              permission_key: 'service_request.view',
            })
            .execute();
          before = await fingerprint();
          await assert.rejects(run({ operation: 'cleanup' }));
          assert.deepEqual(await fingerprint(), before);
          await db
            .deleteFrom('role_permission')
            .where('role_id', '=', fixture.roleId)
            .where('permission_key', '=', 'service_request.view')
            .execute();
        },
      );
      await t.test(
        'tampered fixture provenance rejects cleanup without adoption',
        async () => {
          await db
            .updateTable('role')
            .set({ description: 'F036 shared role' })
            .where('id', '=', fixture.roleId)
            .execute();
          const before = await fingerprint();
          await assert.rejects(
            run({ operation: 'cleanup' }),
            /ownership mismatch/,
          );
          assert.deepEqual(await fingerprint(), before);
          await db
            .updateTable('role')
            .set({ description: fixture.description })
            .where('id', '=', fixture.roleId)
            .execute();
        },
      );
      await t.test('cleanup failure rolls back all changes', async () => {
        await sql`create function fail_fixture_delete() returns trigger language plpgsql as $$ begin raise exception 'synthetic cleanup failure'; end $$`.execute(
          db,
        );
        await sql
          .raw(
            `create trigger fail_fixture_delete before delete on role for each row when (old.id='${fixture.roleId}') execute function fail_fixture_delete()`,
          )
          .execute(db);
        const before = await fingerprint();
        await assert.rejects(
          run({ operation: 'cleanup' }),
          /synthetic cleanup failure/,
        );
        assert.deepEqual(await fingerprint(), before);
        await sql`drop trigger fail_fixture_delete on role`.execute(db);
      });
      await t.test(
        'runtime mixed removal retains effective access and truthful history',
        async () => {
          const result = await managed([]);
          assert.deepEqual(
            result.changes.removedManagedStillEffectivePermissionKeys,
            [fixture.permission],
          );
          assert.deepEqual(result.detail.effective, [fixture.permission]);
          const history = await accessHistory(db, actor, fixture.staffId, {});
          assert.equal(history.total, 2);
          assert.deepEqual(
            history.items[0]?.deltas.map((d) => [d.key, d.direction]),
            [[fixture.permission, 'removed']],
          );
          await assert.rejects(managed([fixture.permission]));
        },
      );
      await t.test(
        'cleanup dry-run, execution, retained F057 ownership/history and idempotency',
        async () => {
          const before = await fingerprint(),
            rev = await revision();
          const preview = await run({ operation: 'cleanup', dryRun: true });
          assert.deepEqual(await fingerprint(), before);
          assert.equal(
            preview.proposedAuthorizationRevision,
            (BigInt(rev) + 1n).toString(),
          );
          const history = await accessHistory(db, actor, fixture.staffId, {});
          await run({ operation: 'cleanup' });
          assert.equal(await revision(), preview.proposedAuthorizationRevision);
          assert.equal(
            (
              await db
                .selectFrom('role')
                .select('id')
                .where('id', '=', fixture.roleId)
                .execute()
            ).length,
            0,
          );
          assert.deepEqual(
            await accessHistory(db, actor, fixture.staffId, {}),
            history,
          );
          assert.deepEqual(
            await db
              .selectFrom('access_role_ownership')
              .selectAll()
              .where('staff_identity_id', '=', fixture.staffId)
              .executeTakeFirstOrThrow(),
            owner,
          );
          assert.deepEqual(
            (await accessDetail(db, actor, fixture.staffId)).effective,
            [],
          );
          const after = await fingerprint();
          for (const index of [2, 3, 4]) {
            const original = before[index] ?? [];
            const current = after[index] ?? [];
            assert.equal(current.length, original.length - 1);
            for (const row of current)
              assert.ok(
                original.some(
                  (value) => JSON.stringify(value) === JSON.stringify(row),
                ),
              );
          }
          for (const index of [1, 5, 6, 7, 8, 9])
            assert.deepEqual(after[index], before[index]);
          assert.equal(
            (await run({ operation: 'cleanup' })).wouldChange,
            false,
          );
          assert.deepEqual(await fingerprint(), after);
        },
      );
    } finally {
      await db.destroy();
      await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  },
);
