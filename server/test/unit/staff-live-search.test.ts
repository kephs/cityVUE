import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  Kysely,
  DummyDriver,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { StaffRequestListQueryDto } from '../../src/service-request/staff-request.controller.js';
import {
  normalizeStaffSearch,
  staffSearchPattern,
  staffLiveSearch,
} from '../../src/service-request/staff-live-search.js';

test('search SQL has exactly three approved operands and binds hostile text as data', () => {
  const db = new Kysely({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (database) => new PostgresIntrospector(database),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  const input = "x' OR true; -- %_\\";
  const compiled = staffLiveSearch(input).compile(db);
  assert.equal(compiled.parameters.length, 3);
  assert.ok(
    compiled.parameters.every((value) => value === staffSearchPattern(input)),
  );
  assert.ok(!compiled.sql.includes(input));
  assert.equal((compiled.sql.match(/ ilike /g) ?? []).length, 3);
  for (const excluded of [
    'requester_contact',
    'request_internal_note',
    'request_communication',
    'attachment',
    'tracking',
    'digest',
    'activity',
    'description',
    'staff_identity',
    'reference_sequence',
  ])
    assert.ok(!compiled.sql.includes(excluded));
  assert.ok(compiled.sql.includes('request.reference_number ilike'));
  assert.ok(compiled.sql.includes('version.name ilike'));
  assert.ok(!compiled.sql.includes('request.id ilike'));
});

test('live search trims only edges and accepts bounded literal Unicode phrases', () => {
  for (const [input, expected] of [
    [undefined, ''],
    ['', ''],
    [' \t\n ', ''],
    ['  Tree  debris  ', 'Tree  debris'],
    ['café 東京', 'café 東京'],
    ["O'Neil %_\\", "O'Neil %_\\"],
    ['a'.repeat(160), 'a'.repeat(160)],
  ]) {
    assert.equal(normalizeStaffSearch(input), expected);
  }
  for (const value of [null, [], {}, 42, 'x', ' x ', 'a'.repeat(161)])
    assert.throws(() => normalizeStaffSearch(value));
  assert.equal(staffSearchPattern('a%_\\b'), '%a\\%\\_\\\\b%');
  assert.equal(
    staffSearchPattern("'; DROP TABLE service_request; --"),
    "%'; DROP TABLE service\\_request; --%",
  );
});
test('live search DTO rejects arrays, objects and oversized strings', () => {
  for (const q of [[], ['tree'], {}, 42, 'x'.repeat(161)])
    assert.ok(
      validateSync(plainToInstance(StaffRequestListQueryDto, { q })).length,
    );
  for (const q of ['', ' ', 'tree', 'x'.repeat(160)])
    assert.equal(
      validateSync(plainToInstance(StaffRequestListQueryDto, { q })).length,
      0,
    );
});
