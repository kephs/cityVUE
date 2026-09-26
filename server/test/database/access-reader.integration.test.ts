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
import {
  provisionAccessReader,
  provisionAccessAdministrator,
} from '../../src/access/access-foundation.js';
import { effectivePermissions } from '../../src/auth/effective-permissions.js';
import {
  up,
  down,
} from '../../migrations/20261009000000-controlled-access-reader.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';

test(
  'Controlled Reader PostgreSQL proofs',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const schema = `reader_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await prepareDatabaseExtensions(admin);
    await admin.query(`create schema "${schema}"`);
    const db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: process.env.TEST_DATABASE_URL,
          options: `-c search_path=${schema}`,
        }),
      }),
    });
    const org = randomUUID(),
      foreignOrg = randomUUID(),
      staff = randomUUID(),
      manager = randomUUID(),
      foreign = randomUUID(),
      inactive = randomUUID();
    const state = async () =>
      db
        .selectFrom('organization_access_state')
        .selectAll()
        .where('organization_id', '=', org)
        .executeTakeFirstOrThrow();
    const snapshot = async () => {
      const tables = [
        'role',
        'role_permission',
        'staff_role_assignment',
        'access_role_ownership',
        'access_change_set',
        'access_permission_delta',
        'organization_access_state',
      ];
      return Promise.all(
        tables.map(
          async (table) =>
            (
              await sql`select to_jsonb(t) row from ${sql.table(table)} t order by to_jsonb(t)::text`.execute(
                db,
              )
            ).rows,
        ),
      );
    };
    const reader = async (
      operation: 'grant-reader' | 'remove-reader',
      extra: Partial<Parameters<typeof provisionAccessReader>[1]> = {},
    ) => {
      const s = await state();
      return provisionAccessReader(db, {
        organizationId: org,
        staffId: staff,
        expectedRevision: s.authorization_revision,
        expectedBootstrap: s.bootstrap_established,
        operation,
        dryRun: false,
        ...extra,
      });
    };
    try {
      const folder = path.resolve(__dirname, '../../migrations');
      for (const file of (await readdir(folder))
        .filter((f) => f.endsWith('.js'))
        .sort()) {
        const m = (await import(
          pathToFileURL(path.join(folder, file)).href
        )) as { up: (db: Kysely<DatabaseSchema>) => Promise<void> };
        await db.transaction().execute((trx) => m.up(trx));
      }
      await db
        .insertInto('organization')
        .values(
          [org, foreignOrg].map((id) => ({
            id,
            name: 'Synthetic Reader Test',
            short_name: 'Test',
            slug: id,
            status: 'active',
            default_business_timezone: 'UTC',
          })),
        )
        .execute();
      await db
        .insertInto('staff_identity')
        .values(
          [staff, manager, foreign, inactive].map((id) => ({
            id,
            organization_id: id === foreign ? foreignOrg : org,
            display_name: 'Synthetic Reader',
            active: id !== inactive,
            email: null,
            entra_tenant_id: null,
            entra_object_id: null,
          })),
        )
        .execute();
      await t.test(
        'Migration 39 down/up before Reader state preserves data and grants nothing',
        async () => {
          const before = await snapshot();
          await db.transaction().execute((trx) => down(trx));
          await db.transaction().execute((trx) => up(trx));
          assert.deepEqual(await snapshot(), before);
        },
      );
      await t.test('dry run and absent removal are mutation-free', async () => {
        const before = await snapshot();
        const p = await reader('grant-reader', { dryRun: true });
        assert.deepEqual(p.added, ['admin.access.read']);
        assert.equal(p.remainsAccessAdministrator, false);
        assert.equal(p.bootstrapEstablished, false);
        await reader('remove-reader');
        assert.deepEqual(await snapshot(), before);
      });
      await t.test(
        'stale state, cross-Organization and inactive targets reject without mutation',
        async () => {
          const before = await snapshot();
          for (const extra of [
            { expectedRevision: '999999' },
            { expectedBootstrap: true },
            { staffId: foreign },
            { staffId: inactive },
          ])
            await assert.rejects(reader('grant-reader', extra));
          assert.deepEqual(await snapshot(), before);
        },
      );
      await t.test(
        'audit failure rolls back fresh role, ownership, grant and revision',
        async () => {
          const before = await snapshot();
          await sql`create function fail_reader_audit() returns trigger language plpgsql as $$ begin raise exception 'Injected Reader audit failure'; end $$; create trigger test_reader_audit before insert on access_permission_delta for each row execute function fail_reader_audit()`.execute(
            db,
          );
          await assert.rejects(reader('grant-reader'));
          assert.deepEqual(await snapshot(), before);
          await sql`drop trigger test_reader_audit on access_permission_delta; drop function fail_reader_audit()`.execute(
            db,
          );
        },
      );
      await t.test(
        'grant is audited atomically, read-only authority, one revision, no bootstrap',
        async () => {
          const before = await state();
          await reader('grant-reader');
          const after = await state();
          assert.equal(
            BigInt(after.authorization_revision),
            BigInt(before.authorization_revision) + 1n,
          );
          assert.equal(after.bootstrap_established, false);
          assert.deepEqual(await effectivePermissions(db, org, staff), [
            'admin.access.read',
          ]);
          const a = await db
            .selectFrom('access_change_set')
            .selectAll()
            .executeTakeFirstOrThrow();
          assert.equal(a.operation, 'provision_access_reader');
          assert.equal(a.source, 'controlled_provisioning');
          assert.equal(a.actor_staff_id, null);
          assert.equal(
            BigInt(a.after_revision),
            BigInt(a.before_revision) + 1n,
          );
          assert.equal(
            (
              await sql<{
                n: string;
              }>`select effective_access_managers(${org})::text n`.execute(db)
            ).rows[0]?.n,
            '0',
          );
        },
      );
      await t.test(
        'repeat grant is a no-op; stale replay rejects',
        async () => {
          const before = await snapshot();
          const s = await state();
          assert.equal((await reader('grant-reader')).changed, false);
          await assert.rejects(
            reader('grant-reader', {
              expectedRevision: String(BigInt(s.authorization_revision) - 1n),
            }),
          );
          assert.deepEqual(await snapshot(), before);
        },
      );
      await t.test(
        'Reader ownership cannot grant manage or impersonate administrator audit',
        async () => {
          const w = await db
            .selectFrom('access_role_ownership')
            .selectAll()
            .where('kind', '=', 'reader')
            .executeTakeFirstOrThrow();
          await assert.rejects(
            db
              .insertInto('role_permission')
              .values({
                organization_id: org,
                role_id: w.role_id,
                permission_key: 'admin.access.manage',
              })
              .execute(),
          );
          const s = await state();
          await assert.rejects(
            db
              .insertInto('access_change_set')
              .values({
                id: randomUUID(),
                organization_id: org,
                target_staff_id: staff,
                role_id: w.role_id,
                actor_staff_id: null,
                source: 'controlled_provisioning',
                operation: 'provision_access_administrator',
                correlation_id: randomUUID(),
                before_revision: s.authorization_revision,
                after_revision: String(BigInt(s.authorization_revision) + 1n),
                mutation_txid: '0',
              })
              .execute(),
          );
        },
      );
      await t.test(
        'Reader removal is audited once and no-op removal retains history',
        async () => {
          const before = await state();
          await reader('remove-reader');
          assert.deepEqual(await effectivePermissions(db, org, staff), []);
          assert.equal(
            BigInt((await state()).authorization_revision),
            BigInt(before.authorization_revision) + 1n,
          );
          const snapshotBefore = await snapshot();
          assert.equal((await reader('remove-reader')).changed, false);
          assert.deepEqual(await snapshot(), snapshotBefore);
        },
      );
      await t.test(
        'separate locked access survives Reader grant and removal',
        async () => {
          const role = randomUUID();
          await db
            .insertInto('role')
            .values({
              id: role,
              organization_id: org,
              name: 'Synthetic existing source',
              active: true,
            })
            .execute();
          await db
            .insertInto('role_permission')
            .values({
              organization_id: org,
              role_id: role,
              permission_key: 'admin.access.read',
            })
            .execute();
          await db
            .insertInto('staff_role_assignment')
            .values({
              organization_id: org,
              staff_identity_id: staff,
              role_id: role,
              active: true,
            })
            .execute();
          await reader('grant-reader');
          const removal = await reader('remove-reader');
          assert.equal(removal.effectiveAccessRead, true);
          assert.deepEqual(await effectivePermissions(db, org, staff), [
            'admin.access.read',
          ]);
          assert.equal(
            (
              await db
                .selectFrom('role_permission')
                .selectAll()
                .where('role_id', '=', role)
                .execute()
            ).length,
            1,
          );
        },
      );
      await t.test(
        'existing bootstrap/add/remove and last-manager protection coexist',
        async () => {
          const s = await state();
          await provisionAccessAdministrator(db, {
            organizationId: org,
            staffId: manager,
            operation: 'bootstrap',
            expectedRevision: s.authorization_revision,
            expectedBootstrap: false,
            dryRun: false,
          });
          const initial = await state();
          await reader('grant-reader');
          assert.equal((await state()).bootstrap_established, true);
          await reader('remove-reader');
          const current = await state();
          await assert.rejects(
            provisionAccessAdministrator(db, {
              organizationId: org,
              staffId: manager,
              operation: 'remove-manager',
              expectedRevision: current.authorization_revision,
              expectedBootstrap: true,
              dryRun: false,
            }),
          );
          assert.equal(
            (await effectivePermissions(db, org, manager)).length,
            3,
          );
          assert.ok(
            BigInt(current.authorization_revision) >
              BigInt(initial.authorization_revision),
          );
          await provisionAccessAdministrator(db, {
            organizationId: org,
            staffId: staff,
            operation: 'add-manager',
            expectedRevision: current.authorization_revision,
            expectedBootstrap: true,
            dryRun: false,
          });
          const next = await state();
          await provisionAccessAdministrator(db, {
            organizationId: org,
            staffId: staff,
            operation: 'remove-manager',
            expectedRevision: next.authorization_revision,
            expectedBootstrap: true,
            dryRun: false,
          });
          assert.deepEqual(await effectivePermissions(db, org, staff), [
            'admin.access.read',
          ]);
        },
      );
      await t.test(
        'same-revision concurrent Reader commands serialize and reject stale completion',
        async () => {
          const s = await state();
          const results = await Promise.allSettled([
            reader('grant-reader', {
              expectedRevision: s.authorization_revision,
            }),
            reader('grant-reader', {
              expectedRevision: s.authorization_revision,
            }),
          ]);
          assert.equal(
            results.filter((r) => r.status === 'fulfilled').length,
            1,
          );
          assert.equal(
            results.filter((r) => r.status === 'rejected').length,
            1,
          );
          assert.equal(
            BigInt((await state()).authorization_revision),
            BigInt(s.authorization_revision) + 1n,
          );
          await reader('remove-reader');
        },
      );
      await t.test(
        'late grant failure rolls back audit, role permission and revision',
        async () => {
          const before = await snapshot();
          await sql`create function fail_reader_assignment() returns trigger language plpgsql as $$ begin raise exception 'Injected late Reader failure'; end $$; create trigger test_reader_assignment before insert on staff_role_assignment for each row execute function fail_reader_assignment()`.execute(
            db,
          );
          await assert.rejects(reader('grant-reader', { staffId: manager }));
          assert.deepEqual(await snapshot(), before);
          await sql`drop trigger test_reader_assignment on staff_role_assignment; drop function fail_reader_assignment()`.execute(
            db,
          );
        },
      );
      await t.test(
        'Reader can complete independent manager authority and cannot remove the last manager',
        async () => {
          // Only the disposable fixture creates pre-existing shared contributions.
          const id = randomUUID(),
            role = randomUUID();
          await db
            .insertInto('staff_identity')
            .values({
              id,
              organization_id: org,
              display_name: 'Synthetic combined manager',
              active: true,
              email: null,
              entra_tenant_id: null,
              entra_object_id: null,
            })
            .execute();
          await db
            .insertInto('role')
            .values({
              id: role,
              organization_id: org,
              name: 'Synthetic prerequisites',
              active: true,
            })
            .execute();
          await db
            .insertInto('role_permission')
            .values(
              ['admin.configuration.read', 'admin.access.manage'].map(
                (permission_key) => ({
                  organization_id: org,
                  role_id: role,
                  permission_key,
                }),
              ),
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
          const grant = await reader('grant-reader', { staffId: id });
          assert.equal(grant.remainsAccessAdministrator, true);
          const s = await state();
          await provisionAccessAdministrator(db, {
            organizationId: org,
            staffId: manager,
            operation: 'remove-manager',
            expectedRevision: s.authorization_revision,
            expectedBootstrap: true,
            dryRun: false,
          });
          const before = await snapshot();
          await assert.rejects(
            reader('remove-reader', { staffId: id, dryRun: true }),
          );
          await assert.rejects(reader('remove-reader', { staffId: id }));
          assert.deepEqual(await snapshot(), before);
        },
      );
      await t.test(
        'retained Reader history refuses down without deleting or rewriting state',
        async () => {
          const before = await snapshot();
          await assert.rejects(db.transaction().execute((trx) => down(trx)));
          assert.deepEqual(await snapshot(), before);
        },
      );
    } finally {
      await db.destroy();
      await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  },
);
