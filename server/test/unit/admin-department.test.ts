import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  departmentQuery,
  departmentId,
} from '../../src/admin/admin-department.domain.js';
import { departmentCollectionSql } from '../../src/admin/admin-department.queries.js';
import { AdminDepartmentService } from '../../src/admin/admin-department.service.js';
import { StaffAuthorizationService } from '../../src/auth/staff-authorization.service.js';
import { buildErrorResponse } from '../../src/common/errors/http-exception.filter.js';
import {
  departmentAccess as access,
  departmentFixture,
  departmentTestDatabase,
} from '../helpers/admin-department.fixture.js';

test('Department query defaults and approved choices are bounded', () => {
  assert.deepEqual(departmentQuery({}), {
    page: 1,
    pageSize: 25,
    search: '',
    status: 'all',
    sort: 'displayOrder',
    direction: 'asc',
  });
  for (const size of [10, 25, 50, 100])
    assert.equal(departmentQuery({ pageSize: String(size) }).pageSize, size);
  for (const status of ['active', 'inactive', 'archived', 'all'])
    assert.equal(departmentQuery({ status }).status, status);
  assert.equal(
    departmentQuery({ page: '10000', search: ' Café %_\\ 😀 ' }).search,
    'Café %_\\ 😀',
  );
});
for (const input of [
  { organizationId: 'forged' },
  { page: '0' },
  { page: '-1' },
  { page: '1.5' },
  { page: '01' },
  { page: '10001' },
  { page: '1e3' },
  { pageSize: '11' },
  { pageSize: '101' },
  { sort: 'name; drop table department' },
  { direction: 'ASC' },
  { status: 'deleted' },
  { search: 'x'.repeat(101) },
  { search: 'x\n' },
  { search: '\u0000' },
  { search: '\ud800' },
  { search: ['x', 'y'] },
  { page: 2 },
  { search: { text: 'x' } },
  { search: null },
]) {
  test(`Department query rejects ${JSON.stringify(input)}`, () => {
    assert.throws(() => departmentQuery(input), BadRequestException);
  });
}
test('Department identifiers reject malformed values', () => {
  for (const id of ['', 'bad', '1 OR true'])
    assert.throws(() => departmentId(id), BadRequestException);
});
test('All collection SQL is tenant-scoped, literal-search, bounded and deterministically sorted', async () => {
  const { client } = departmentTestDatabase();
  try {
    for (const collection of [
      'departments',
      'divisions',
      'categories',
    ] as const)
      for (const sort of ['name', 'displayOrder', 'status'])
        for (const direction of ['asc', 'desc']) {
          const search = "%' OR true; -- _\\";
          const statements = departmentCollectionSql(
            access.organizationId,
            collection,
            departmentQuery({
              search,
              sort,
              direction,
              page: '2',
              pageSize: '10',
            }),
            departmentFixture.id,
          );
          for (const statement of [statements.count, statements.items]) {
            const q = statement.compile(client);
            assert.match(q.sql, /r.organization_id=\$\d+/);
            assert.ok(q.parameters.includes(access.organizationId));
            assert.ok(q.parameters.includes(search));
            assert.ok(!q.sql.includes(search));
            assert.match(q.sql, /strpos\(lower/);
            assert.doesNotMatch(q.sql, /\bilike\b|\blike\b/i);
            if (collection !== 'departments') {
              assert.match(q.sql, /r.department_id=\$\d+/);
              assert.ok(q.parameters.includes(departmentFixture.id));
            }
          }
          const q = statements.items.compile(client);
          assert.match(q.sql, /r.id asc limit \$\d+ offset \$\d+/);
          assert.deepEqual(q.parameters.slice(-2), [10, 10]);
          assert.doesNotMatch(
            q.sql,
            /select \*|staff_identity|routing_metadata|service_definition_version|\brevision\b/,
          );
          if (collection === 'departments') {
            assert.match(
              q.sql,
              /v.organization_id=r.organization_id and v.department_id=r.id/,
            );
            assert.match(
              q.sql,
              /c.organization_id=r.organization_id and c.department_id=r.id/,
            );
          }
          if (collection === 'categories')
            assert.match(
              q.sql,
              /s.organization_id=r.organization_id and s.category_id=r.id/,
            );
        }
  } finally {
    await client.destroy();
  }
});
test('Service uses read-only repeatable-read snapshot, scoped counts and explicit projections', async () => {
  const { client, database, driver } = departmentTestDatabase();
  const service = new AdminDepartmentService(database);
  try {
    const result = await service.list(access, {});
    assert.deepEqual(result, {
      items: [departmentFixture],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    assert.deepEqual(driver.transactions, ['begin:repeatable read', 'commit']);
    assert.equal(driver.queries[0]?.sql, 'set transaction read only');
    for (const query of driver.queries.slice(1)) {
      assert.match(query.sql, /^select /);
      assert.ok(query.parameters.includes(access.organizationId));
    }
    assert.equal(
      (await service.detail(access, departmentFixture.id)).description,
      null,
    );
    const categories = await service.list(
      access,
      {},
      'categories',
      departmentFixture.id,
    );
    assert.equal(
      categories.items[0] &&
        'divisionId' in categories.items[0] &&
        categories.items[0].divisionId,
      null,
    );
    await service.list(access, {}, 'divisions', departmentFixture.id);
  } finally {
    await client.destroy();
  }
});
test('Service denies fallback, untrusted and ordinary request identities before any SQL', async () => {
  const { client, database, driver } = departmentTestDatabase();
  const service = new AdminDepartmentService(database);
  try {
    for (const invalid of [
      undefined,
      { ...access, development: true },
      { ...access, tenantId: null },
      { ...access, objectId: null },
      { ...access, permissions: ['service_request.view'] as const },
    ]) {
      const candidate = invalid && {
        ...invalid,
        permissions: [...invalid.permissions],
      };
      await assert.rejects(service.list(candidate, {}), ForbiddenException);
      await assert.rejects(
        service.detail(candidate, departmentFixture.id),
        ForbiddenException,
      );
    }
    assert.equal(driver.queries.length, 0);
  } finally {
    await client.destroy();
  }
});
test('Inactive Organization and unavailable/cross-tenant Department fail closed', async () => {
  const { client, database, driver } = departmentTestDatabase();
  const service = new AdminDepartmentService(database);
  try {
    driver.active = false;
    await assert.rejects(service.list(access, {}), ForbiddenException);
    assert.equal(driver.queries.length, 2);
    driver.active = true;
    driver.found = false;
    for (const collection of ['divisions', 'categories'] as const)
      await assert.rejects(
        service.list(access, {}, collection, departmentFixture.id),
        NotFoundException,
      );
    await assert.rejects(service.detail(access, departmentFixture.id), {
      message: 'Department not found',
    });
    assert.ok(driver.transactions.includes('rollback'));
  } finally {
    await client.destroy();
  }
});
test('Existing identity resolver rejects an unprovisioned principal', async () => {
  const { client, database } = departmentTestDatabase();
  try {
    await assert.rejects(
      new StaffAuthorizationService(database).resolve({
        tenantId: 'fictional',
        objectId: 'missing',
        name: 'Fictional',
        tokenVersion: '2.0',
        scopes: [],
      }),
      ForbiddenException,
    );
  } finally {
    await client.destroy();
  }
});
test('Database failures roll back and existing error boundary sanitizes diagnostics', async () => {
  const { client, database, driver } = departmentTestDatabase();
  driver.fail = true;
  try {
    await assert.rejects(new AdminDepartmentService(database).list(access, {}));
    assert.ok(driver.transactions.includes('rollback'));
    assert.ok(
      !JSON.stringify(
        buildErrorResponse(
          new Error('private database diagnostic'),
          'fictional',
        ),
      ).includes('private database'),
    );
  } finally {
    await client.destroy();
  }
});
