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
import { permissions, type StaffAccess } from '../../src/auth/auth.types.js';
import { effectivePermissions } from '../../src/auth/effective-permissions.js';
import { changeManagedAccess } from '../../src/access/access-foundation.js';
import {
  accessDetail,
  accessHistory,
  accessRead,
  accessScopes,
  discoveryQuery,
  discoverySql,
  listAccess,
  permissionCatalog,
} from '../../src/access/access-discovery.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';

test(
  'F057.2 disposable discovery scale, isolation and read-only proofs',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const schema = `discovery_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await prepareDatabaseExtensions(admin);
    await admin.query(`create schema "${schema}"`);
    let queries: string[] = [];
    const db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: process.env.TEST_DATABASE_URL,
          options: `-c search_path=${schema}`,
        }),
      }),
      log: (event) => {
        if (event.level === 'query') queries.push(event.query.sql);
      },
    });
    const measurements: {
      population: number;
      pageSize: number;
      queryCount: number;
    }[] = [];
    const snapshot = async () =>
      Promise.all(
        [
          'organization_access_state',
          'access_change_set',
          'access_permission_delta',
          'access_role_ownership',
          'role',
          'role_permission',
          'staff_role_assignment',
          'staff_department_membership',
          'staff_division_membership',
        ].map(
          async (table) =>
            (
              await sql`select to_jsonb(t) row from ${sql.table(table)} t order by to_jsonb(t)::text`.execute(
                db,
              )
            ).rows,
        ),
      );
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
        .insertInto('permission')
        .values(permissions.map((permission_key) => ({ permission_key })))
        .onConflict((oc) => oc.column('permission_key').doNothing())
        .execute();
      const operandTypes = await sql<{
        left_type: string;
        right_type: string;
      }>`select
        pg_typeof(coalesce(array_agg(distinct permission_key),array[]::text[]))::text as left_type,
        pg_typeof(${['admin.access.read']}::text[])::text as right_type from permission`.execute(
        db,
      );
      assert.deepEqual(operandTypes.rows[0], {
        left_type: 'character varying[]',
        right_type: 'text[]',
      });
      t.diagnostic(
        `Original overlap operands: ${JSON.stringify(operandTypes.rows[0])}`,
      );
      for (const population of [20, 200, 2000])
        await t.test(
          `${String(population)} principals: bounded queries, deterministic pages, filters and privacy`,
          async () => {
            const org = randomUUID(),
              other = randomUUID(),
              tenant = randomUUID(),
              department = randomUUID(),
              division = randomUUID(),
              role = randomUUID(),
              actorRole = randomUUID(),
              foreign = randomUUID();
            await db
              .insertInto('organization')
              .values(
                [org, other].map((id) => ({
                  id,
                  name: 'Fictional discovery scale',
                  short_name: 'Test',
                  slug: id,
                  status: 'active',
                  default_business_timezone: 'UTC',
                })),
              )
              .execute();
            const staff = Array.from({ length: population }, (_, i) => ({
              id: randomUUID(),
              organization_id: org,
              display_name: `Development ${String(Math.floor(i / 2)).padStart(4, '0')}`,
              active: i === 0 || i % 5 !== 0,
              email: null,
              entra_tenant_id: tenant,
              entra_object_id: randomUUID(),
            }));
            const staffAt = (index: number) => {
              const row = staff[index];
              assert.ok(row);
              return row;
            };
            staffAt(4).display_name = 'Development 100%_literal';
            await db
              .insertInto('staff_identity')
              .values([
                ...staff,
                {
                  ...staffAt(0),
                  id: foreign,
                  organization_id: other,
                  entra_object_id: randomUUID(),
                },
              ])
              .execute();
            await db
              .insertInto('department')
              .values({
                id: department,
                organization_id: org,
                name: 'Synthetic department',
                description: null,
                status: 'inactive',
                display_order: 0,
              })
              .execute();
            await db
              .insertInto('division')
              .values({
                id: division,
                organization_id: org,
                department_id: department,
                name: 'Synthetic division',
                description: null,
                status: 'active',
                display_order: 0,
              })
              .execute();
            await db
              .insertInto('staff_department_membership')
              .values(
                staff
                  .filter((_, i) => i % 2 === 0)
                  .map((s) => ({
                    organization_id: org,
                    staff_identity_id: s.id,
                    department_id: department,
                    active: true,
                  })),
              )
              .execute();
            await db
              .insertInto('staff_division_membership')
              .values(
                staff
                  .filter((_, i) => i % 3 === 0)
                  .map((s) => ({
                    organization_id: org,
                    staff_identity_id: s.id,
                    department_id: department,
                    division_id: division,
                    active: true,
                  })),
              )
              .execute();
            await db
              .insertInto('role')
              .values(
                [role, actorRole].map((id) => ({
                  id,
                  organization_id: org,
                  name: `Synthetic shared role ${id}`,
                  active: true,
                })),
              )
              .execute();
            await db
              .insertInto('role_permission')
              .values([
                {
                  organization_id: org,
                  role_id: role,
                  permission_key: 'service_request.view',
                },
                ...[
                  'admin.configuration.read',
                  'admin.access.read',
                  'admin.access.manage',
                ].map((permission_key) => ({
                  organization_id: org,
                  role_id: actorRole,
                  permission_key,
                })),
              ])
              .execute();
            await db
              .insertInto('staff_role_assignment')
              .values([
                ...staff
                  .filter((_, i) => i % 7 !== 0)
                  .map((s) => ({
                    organization_id: org,
                    staff_identity_id: s.id,
                    role_id: role,
                    active: true,
                  })),
                {
                  organization_id: org,
                  staff_identity_id: staffAt(0).id,
                  role_id: actorRole,
                  active: true,
                },
              ])
              .execute();
            const actor: StaffAccess = {
              organizationId: org,
              staffIdentityId: staffAt(0).id,
              tenantId: tenant,
              objectId: staffAt(0).entra_object_id,
              displayName: 'Synthetic',
              development: false,
              scopes: [],
              departmentIds: [],
              divisionIds: [],
              permissions: [
                'admin.configuration.read',
                'admin.access.read',
                'admin.access.manage',
              ],
            };
            const revision = async () =>
              (
                await db
                  .selectFrom('organization_access_state')
                  .select('authorization_revision')
                  .where('organization_id', '=', org)
                  .executeTakeFirstOrThrow()
              ).authorization_revision;
            for (const i of [1, 3, 7])
              await changeManagedAccess(db, actor, {
                staffId: staffAt(i).id,
                expectedRevision: await revision(),
                permissions: ['service_request.view'],
              });
            await changeManagedAccess(db, actor, {
              staffId: staffAt(3).id,
              expectedRevision: await revision(),
              permissions: [],
            });
            // Additional category fixtures remain inside this disposable schema.
            const unknownRole = randomUUID();
            await db
              .insertInto('permission')
              .values({ permission_key: 'service_request.unregistered_test' })
              .onConflict((oc) => oc.column('permission_key').doNothing())
              .execute();
            await db
              .insertInto('role')
              .values({
                id: unknownRole,
                organization_id: org,
                name: 'Synthetic unknown permission',
                active: true,
              })
              .execute();
            await db
              .insertInto('role_permission')
              .values({
                organization_id: org,
                role_id: unknownRole,
                permission_key: 'service_request.unregistered_test',
              })
              .execute();
            await db
              .insertInto('staff_role_assignment')
              .values([
                {
                  organization_id: org,
                  staff_identity_id: staffAt(14).id,
                  role_id: unknownRole,
                  active: true,
                },
                {
                  organization_id: org,
                  staff_identity_id: staffAt(2).id,
                  role_id: actorRole,
                  active: true,
                },
              ])
              .execute();
            const before = await snapshot();
            const expected = [...staff]
              .sort(
                (a, b) =>
                  a.display_name
                    .toLowerCase()
                    .localeCompare(b.display_name.toLowerCase(), 'en') ||
                  a.id.localeCompare(b.id),
              )
              .map((s) => s.id);
            for (const pageSize of [25, 50, 100]) {
              queries = [];
              const first = await listAccess(db, actor, {
                pageSize: String(pageSize),
              });
              measurements.push({
                population,
                pageSize,
                queryCount: queries.length,
              });
              assert.ok(queries.length <= 10);
              assert.equal(first.total, population);
              assert.equal(first.organizationTotal, population);
              assert.equal(first.items.length, Math.min(pageSize, population));
              assert.deepEqual(
                first.items.map((s) => s.id),
                expected.slice(0, pageSize),
              );
              assert.deepEqual(
                Object.keys(first.items[0] ?? {}).sort(),
                [
                  'id',
                  'displayName',
                  'active',
                  'departments',
                  'divisions',
                  'categories',
                  'accessAdministrator',
                  'source',
                ].sort(),
              );
            }
            const all: string[] = [];
            for (let page = 1; page <= Math.ceil(population / 25); page++)
              all.push(
                ...(
                  await listAccess(db, actor, { page: String(page) })
                ).items.map((s) => s.id),
              );
            assert.equal(new Set(all).size, population);
            assert.deepEqual(all, expected);
            assert.equal(
              (await listAccess(db, actor, { search: '  100%_LITERAL  ' }))
                .total,
              1,
            );
            assert.equal(
              (await listAccess(db, actor, { search: "' OR 1=1 --" })).total,
              0,
            );
            assert.equal(
              (await listAccess(db, actor, { status: 'inactive' })).total,
              staff.filter((s) => !s.active).length,
            );
            assert.equal(
              (
                await listAccess(db, actor, {
                  status: 'inactive',
                  category: 'Service Requests',
                })
              ).total,
              0,
            );
            const category = 'Service Requests';
            const matching = staff.filter(
              (s, i) => s.active && (i % 7 !== 0 || i === 7),
            );
            const categoryResult = await listAccess(db, actor, {
              category,
              pageSize: '100',
            });
            assert.equal(categoryResult.total, matching.length);
            assert.ok(categoryResult.items.some((s) => s.id === staffAt(1).id));
            assert.equal(
              categoryResult.items.filter((s) => s.id === staffAt(2).id).length,
              1,
            );
            for (const excluded of [
              staffAt(0).id,
              staffAt(5).id,
              staffAt(14).id,
              foreign,
            ])
              assert.ok(!categoryResult.items.some((s) => s.id === excluded));
            assert.deepEqual(
              (await accessDetail(db, actor, staffAt(14).id)).effective,
              [],
            );
            const combined = {
              category,
              status: 'active',
              department,
              division,
              source: 'existing',
              search: 'Development',
            };
            assert.equal(
              (await listAccess(db, actor, combined)).total,
              staff.filter((s, i) => s.active && i % 7 !== 0 && i % 6 === 0)
                .length,
            );
            assert.equal(
              (await listAccess(db, actor, { ...combined, source: 'managed' }))
                .total,
              0,
            );
            assert.equal(
              (await listAccess(db, actor, { ...combined, status: 'inactive' }))
                .total,
              0,
            );
            assert.equal(
              (
                await listAccess(db, actor, {
                  ...combined,
                  search: 'No matching staff',
                })
              ).total,
              0,
            );
            assert.equal(
              (await listAccess(db, actor, { source: 'managed' })).total,
              1,
            );
            assert.equal(
              (await listAccess(db, actor, { source: 'mixed' })).total,
              1,
            );
            assert.equal(
              (await accessDetail(db, actor, staffAt(3).id)).contributions[0]
                ?.managed,
              false,
            );
            assert.equal(
              (await accessDetail(db, actor, staffAt(1).id)).contributions[0]
                ?.sourceCount,
              2,
            );
            assert.deepEqual(
              (await accessDetail(db, actor, staffAt(5).id)).effective,
              [],
            );
            assert.deepEqual(
              (await accessDetail(db, actor, staffAt(1).id)).effective,
              await effectivePermissions(db, org, staffAt(1).id),
            );
            assert.equal(
              (await listAccess(db, actor, { department, division })).total,
              staff.filter((_, i) => i % 6 === 0).length,
            );
            assert.equal(
              (await listAccess(db, actor, { department: randomUUID() })).total,
              0,
            );
            assert.equal(
              (await accessScopes(db, actor)).departments[0]?.status,
              'inactive',
            );
            assert.equal(
              (await accessHistory(db, actor, staffAt(1).id, {})).items.length,
              1,
            );
            assert.equal(
              (await accessHistory(db, actor, staffAt(2).id, {})).total,
              0,
            );
            assert.equal(
              await accessRead(db, actor, () =>
                Promise.resolve(permissionCatalog.length),
              ),
              32,
            );
            for (const id of [foreign, randomUUID()]) {
              await assert.rejects(accessDetail(db, actor, id), {
                message: 'Staff access unavailable',
              });
              await assert.rejects(accessHistory(db, actor, id, {}), {
                message: 'Staff access unavailable',
              });
            }
            for (const caller of [
              { ...actor, development: true },
              {
                ...actor,
                permissions: [
                  'admin.configuration.read',
                ] as StaffAccess['permissions'],
              },
              {
                ...actor,
                permissions: [
                  'admin.access.read',
                ] as StaffAccess['permissions'],
              },
            ])
              await assert.rejects(listAccess(db, caller, {}));
            for (const invalid of [
              { pageSize: '101' },
              { pageSize: '0' },
              { pageSize: '30' },
              { page: '-1' },
              { search: 'x'.repeat(101) },
              { search: 'a\n' },
              { organizationId: other },
            ])
              assert.throws(() => discoveryQuery(invalid));
            for (const input of [
              {},
              { search: 'Development' },
              { status: 'active' },
              { category: 'Service Requests' },
              { department, division },
              { source: 'mixed' },
            ]) {
              const q = discoverySql(db, org, input);
              for (const statement of [q.count, q.page]) {
                const plan =
                  await sql`explain (analyze,format json) ${statement}`.execute(
                    db,
                  );
                assert.equal(plan.rows.length, 1);
              }
            }
            assert.deepEqual(await snapshot(), before);
            // Re-resolve live authority rather than trusting the earlier context.
            await db
              .updateTable('staff_role_assignment')
              .set({ active: false })
              .where('role_id', '=', actorRole)
              .execute();
            await assert.rejects(listAccess(db, actor, {}));
          },
        );
      assert.equal(new Set(measurements.map((m) => m.queryCount)).size, 1);
      t.diagnostic(
        `Measured discovery SQL counts including transaction/authentication: ${JSON.stringify(measurements)}`,
      );
    } finally {
      await db.destroy();
      await admin.query(`drop schema "${schema}" cascade`);
      assert.equal(
        (
          await admin.query(
            'select 1 from information_schema.schemata where schema_name=$1',
            [schema],
          )
        ).rowCount,
        0,
      );
      await admin.end();
    }
  },
);
