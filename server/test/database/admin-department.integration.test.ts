import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { up } from '../../migrations/20260902000000-create-organization-service-catalog.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import { AdminDepartmentService } from '../../src/admin/admin-department.service.js';
import { departmentAccess } from '../helpers/admin-department.fixture.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';

// Compile only for F069.1. Execution requires separate approval and disposable TEST_DATABASE_URL.
const url = process.env.TEST_DATABASE_URL;
test(
  'F069.1 Department reads in a fresh disposable catalog schema',
  { skip: !url && 'TEST_DATABASE_URL missing' },
  async (t) => {
    assert.ok(url);
    const databaseName = decodeURIComponent(new URL(url).pathname.slice(1));
    assert.match(
      databaseName,
      /test/i,
      'Only an explicitly named test database is allowed',
    );
    assert.notEqual(databaseName, 'reqro_dev');
    const admin = new Pool({ connectionString: url });
    const schema = `department_read_${randomUUID().replaceAll('-', '')}`;
    let db: Kysely<DatabaseSchema> | undefined;
    let created = false;
    try {
      assert.deepEqual(
        (
          await admin.query(
            'select current_database() as database, current_user as role',
          )
        ).rows,
        [{ database: 'reqro_f0592_test', role: 'reqro_test_user' }],
      );
      await prepareDatabaseExtensions(admin);
      await admin.query(`create schema "${schema}"`);
      created = true;
      db = new Kysely<DatabaseSchema>({
        dialect: new PostgresDialect({
          pool: new Pool({
            connectionString: url,
            options: `-c search_path=${schema},public`,
          }),
        }),
      });
      await up(db);
      const database = db;
      const org = randomUUID(),
        other = randomUUID(),
        department = randomUUID(),
        sibling = randomUUID(),
        foreign = randomUUID(),
        division = randomUUID(),
        category = randomUUID();
      const access = { ...departmentAccess, organizationId: org };
      for (const id of [org, other])
        await db
          .insertInto('organization')
          .values({
            id,
            name: 'Fictional',
            short_name: 'Test',
            slug: id,
            status: 'active',
            default_business_timezone: 'UTC',
          })
          .execute();
      const departmentRows = [
        {
          id: department,
          organization_id: org,
          name: 'Literal %_ Department',
          status: 'active',
          display_order: 0,
          description: null,
        },
        {
          id: sibling,
          organization_id: org,
          name: 'Sibling',
          status: 'inactive',
          display_order: 0,
          description: 'Searchable',
        },
        {
          id: foreign,
          organization_id: other,
          name: 'Literal %_ Department',
          status: 'active',
          display_order: 0,
          description: null,
        },
        ...Array.from({ length: 12 }, (_, i) => ({
          id: randomUUID(),
          organization_id: org,
          name: `Archived ${String(i)}`,
          status: 'archived',
          display_order: 1,
          description: null,
        })),
      ];
      await db.insertInto('department').values(departmentRows).execute();
      for (const [id, owner, parent, status] of [
        [division, org, department, 'inactive'],
        [randomUUID(), org, sibling, 'active'],
        [randomUUID(), other, foreign, 'active'],
      ] as const)
        await db
          .insertInto('division')
          .values({
            id,
            organization_id: owner,
            department_id: parent,
            name: 'Division',
            description: null,
            status,
            display_order: 0,
          })
          .execute();
      for (const [id, owner, parent, div] of [
        [category, org, department, division],
        [randomUUID(), org, department, null],
        [randomUUID(), org, sibling, null],
        [randomUUID(), other, foreign, null],
      ] as const)
        await db
          .insertInto('category')
          .values({
            id,
            organization_id: owner,
            department_id: parent,
            division_id: div,
            name: id,
            description: 'Fictional category',
            status: 'active',
            display_order: 0,
            icon_key: 'tree',
            aliases: [],
            keywords: [],
          })
          .execute();
      for (const status of ['active', 'inactive', 'archived'])
        await db
          .insertInto('service_definition')
          .values({
            id: randomUUID(),
            organization_id: org,
            category_id: category,
            service_key: status,
            status,
            current_published_version_id: null,
          })
          .execute();
      const service = new AdminDepartmentService({
        client: db,
      } as DatabaseService);
      const before =
        await sql`select (select jsonb_agg(d order by id) from department d) as departments,(select jsonb_agg(c order by id) from category c) as categories,(select jsonb_agg(v order by id) from division v) as divisions,(select jsonb_agg(s order by id) from service_definition s) as services`.execute(
          db,
        );
      await t.test(
        'scoped totals, literal search, status and stable bounded pages',
        async () => {
          const first = await service.list(access, { pageSize: '10' }),
            second = await service.list(access, { pageSize: '10', page: '2' });
          assert.equal(first.total, 14);
          assert.equal(first.items.length, 10);
          assert.equal(second.items.length, 4);
          assert.equal(
            new Set([...first.items, ...second.items].map((r) => r.id)).size,
            14,
          );
          assert.deepEqual(
            await service.list(access, { pageSize: '10' }),
            first,
          );
          const literal = await service.list(access, { search: '%_' });
          assert.equal(literal.total, 1);
          assert.equal(literal.items[0]?.id, department);
          assert.equal(
            (await service.list(access, { search: 'Searchable' })).total,
            1,
          );
          assert.equal(
            (await service.list(access, { status: 'archived' })).total,
            12,
          );
          assert.equal(
            (await service.list(access, { status: 'inactive' })).total,
            1,
          );
          assert.equal(
            (await service.list(access, { page: '10000' })).items.length,
            0,
          );
        },
      );
      await t.test(
        'relationship ownership, optional division and all-status aggregates',
        async () => {
          const detail = await service.detail(access, department);
          assert.equal(detail.divisionCount, 1);
          assert.equal(detail.categoryCount, 2);
          assert.equal(detail.description, null);
          const divisions = await service.list(
            access,
            {},
            'divisions',
            department,
          );
          assert.equal(divisions.total, 1);
          assert.equal(divisions.items[0]?.status, 'inactive');
          const categories = await service.list(
            access,
            {},
            'categories',
            department,
          );
          assert.equal(categories.total, 2);
          assert.ok(
            categories.items.some(
              (r) => 'divisionId' in r && r.divisionId === null,
            ),
          );
          const related = categories.items.find((r) => r.id === category);
          assert.ok(related && 'serviceDefinitionCount' in related);
          assert.equal(related.serviceDefinitionCount, 3);
          for (const kind of ['divisions', 'categories'] as const)
            await assert.rejects(
              service.list(access, {}, kind, foreign),
              NotFoundException,
            );
          await assert.rejects(
            service.detail(access, foreign),
            NotFoundException,
          );
          await assert.rejects(
            service.detail(access, randomUUID()),
            NotFoundException,
          );
        },
      );
      await t.test(
        'reads preserve all catalog rows; PostgreSQL enforces read-only statements',
        async () => {
          const after =
            await sql`select (select jsonb_agg(d order by id) from department d) as departments,(select jsonb_agg(c order by id) from category c) as categories,(select jsonb_agg(v order by id) from division v) as divisions,(select jsonb_agg(s order by id) from service_definition s) as services`.execute(
              database,
            );
          assert.deepEqual(after.rows, before.rows);
          await assert.rejects(
            database.transaction().execute(async (trx) => {
              await sql`set transaction read only`.execute(trx);
              await sql`update department set name=name where false`.execute(
                trx,
              );
            }),
            (error: unknown) =>
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              error.code === '25006',
          );
          await database
            .updateTable('organization')
            .set({ status: 'inactive' })
            .where('id', '=', org)
            .execute();
          await assert.rejects(service.list(access, {}), ForbiddenException);
        },
      );
    } finally {
      await db?.destroy();
      if (created) await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  },
);
