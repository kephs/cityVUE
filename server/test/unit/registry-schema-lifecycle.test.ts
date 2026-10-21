import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type Driver,
  type DatabaseConnection,
  type CompiledQuery,
  type QueryResult,
} from 'kysely';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import {
  registryInventory,
  registrySchemaNames,
  registryCleanupTargets,
  createRegistrySchemas,
  cleanupRegistrySchemas,
} from '../helpers/registry-schema-lifecycle.js';
import {
  registryMigrationPlan,
  registryRewrittenMigrations,
  assertRegistryMigrationCompletion,
} from '../helpers/registry-migrations.js';
import { applyFunctionHardening } from '../helpers/tenant-domain-hardening.js';
import {
  applyRuntimeReferenceLocks,
  applyAccessRevisionHardening,
} from '../helpers/runtime-reference-locks.js';
import {
  applyIntegrationWorkerFunctions,
  applyIntegrationWorkerHardening,
} from '../helpers/integration-worker-functions.js';
const schema = 'registry_e2e_' + 'a'.repeat(32);
const names = registrySchemaNames(schema);
const owned = names.map((name, i) => ({
  name,
  oid: String(100 + i),
  owner: 'reqro_test_user',
}));
const receipt = { schema, owned };
/** Offline SQL recorder only; never connects or simulates PostgreSQL semantics. */
class Recorder implements Driver, DatabaseConnection {
  queries: string[] = [];
  events: string[] = [];
  inventories: unknown[][] = [];
  async init() {
    /* offline */
  }
  async destroy() {
    /* offline */
  }
  async acquireConnection() {
    return this;
  }
  async releaseConnection() {
    /* offline */
  }
  async beginTransaction() {
    this.events.push('begin');
  }
  async commitTransaction() {
    this.events.push('commit');
  }
  async rollbackTransaction() {
    this.events.push('rollback');
  }
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    yield { rows: [] };
  }
  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    this.queries.push(query.sql);
    if (query.sql.includes('from pg_namespace')) {
      const rows = this.inventories.shift();
      if (!rows) throw new Error('Unreadable inventory');
      return { rows: rows as R[] };
    }
    return { rows: [] };
  }
}
function database(driver: Recorder) {
  return new Kysely<DatabaseSchema>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}
test('registry: empty inventory is clean and only proven pair is eligible for cleanup', () => {
  assert.deepEqual(registryInventory([]), []);
  assert.deepEqual(registryCleanupTargets(receipt, [...owned].reverse()), [
    names[1],
    names[0],
  ]);
});
for (const [label, live] of Object.entries({
  missing: undefined,
  unreadable: null,
  notArray: {},
  incomplete: owned.slice(0, 1),
  unknown: [
    ...owned,
    { name: 'unexpected', oid: '999', owner: 'reqro_test_user' },
  ],
  global: [
    ...owned,
    { name: 'reqro_integration_api', oid: '998', owner: 'reqro_test_user' },
  ],
  replaced: owned.map((r) => ({ ...r, oid: '9' + r.oid })),
  wrongOwner: owned.map((r) => ({ ...r, owner: 'somebody_else' })),
  duplicate: [owned[0], owned[0]],
  malformed: [{ name: names[0], oid: 100, owner: 'reqro_test_user' }],
})) {
  test('registry: refuses ' + label + ' live ownership evidence', () => {
    assert.throws(() => registryCleanupTargets(receipt, live));
  });
}
test('registry: source/name familiarity cannot replace a creation receipt', () => {
  assert.throws(() => registryCleanupTargets({ schema, owned: [] }, owned));
  assert.throws(() =>
    registryCleanupTargets({ schema: 'reqro_integration_api', owned }, owned),
  );
  assert.throws(() =>
    registryCleanupTargets(
      {
        schema,
        owned: [
          ...owned,
          { name: 'other', oid: '999', owner: 'reqro_test_user' },
        ],
      },
      owned,
    ),
  );
});
test('registry: create and cleanup transact only the positively identified pair', async () => {
  const driver = new Recorder();
  driver.inventories = [[], owned, owned, []];
  const db = database(driver);
  try {
    const result = await createRegistrySchemas(db, schema);
    await cleanupRegistrySchemas(db, result);
    assert.deepEqual(driver.events, ['begin', 'commit', 'begin', 'commit']);
    assert.deepEqual(
      driver.queries.filter((q) => /^(create|drop) schema/.test(q)),
      [
        `create schema "${names[0]}"`,
        `create schema "${names[1]}"`,
        `drop schema "${names[1]}" cascade`,
        `drop schema "${names[0]}" cascade`,
      ],
    );
  } finally {
    await db.destroy();
  }
});
test('registry: pre-existing schema is never adopted or dropped', async () => {
  const driver = new Recorder();
  driver.inventories = [owned];
  const db = database(driver);
  try {
    await assert.rejects(
      createRegistrySchemas(db, schema),
      /clean schema baseline/,
    );
    assert.equal(driver.queries.length, 1);
    assert.deepEqual(driver.events, ['begin', 'rollback']);
  } finally {
    await db.destroy();
  }
});
test('registry: ambiguous cleanup issues no DROP and fails closed', async () => {
  const driver = new Recorder();
  driver.inventories = [
    [...owned, { name: 'unknown', oid: '999', owner: 'reqro_test_user' }],
  ];
  const db = database(driver);
  try {
    await assert.rejects(
      cleanupRegistrySchemas(db, receipt),
      /ownership changed/,
    );
    assert.equal(driver.queries.length, 1);
    assert.deepEqual(driver.events, ['begin', 'rollback']);
  } finally {
    await db.destroy();
  }
});
test('registry: unreadable or incomplete post-cleanup inventory rolls back', async () => {
  for (const remaining of [undefined, owned.slice(0, 1)]) {
    const driver = new Recorder();
    driver.inventories = remaining ? [owned, remaining] : [owned];
    const db = database(driver);
    try {
      await assert.rejects(cleanupRegistrySchemas(db, receipt));
      assert.deepEqual(driver.events, ['begin', 'rollback']);
    } finally {
      await db.destroy();
    }
  }
});
const sources = [
  ...registryRewrittenMigrations.map((n) => n + '.ts'),
  '20260101000000-example.ts',
];
const compiled = ['20260101000000-example.js'];
test('registry: plan includes text-applied migrations even when absent from compiled output', () => {
  const plan = registryMigrationPlan(sources, compiled);
  assert.equal(plan.length, 5);
  assert.equal(plan.filter((s) => s.mode === 'rewritten').length, 4);
  assert.deepEqual(
    registryMigrationPlan(sources, [
      ...compiled,
      ...registryRewrittenMigrations.map((n) => n + '.js'),
    ]),
    plan,
  );
  assertRegistryMigrationCompletion(
    plan,
    plan.map((s) => s.name),
  );
});
test('registry: rejects malformed, missing and stale migration inventories', () => {
  for (const source of [
    [],
    sources.slice(1),
    [...sources, '20260101000000-example.ts'],
    [...sources, 'invalid.ts'],
  ])
    assert.throws(() => registryMigrationPlan(source, compiled));
  for (const files of [
    [],
    [...compiled, ...compiled],
    [...compiled, 'unknown.js'],
  ])
    assert.throws(() => registryMigrationPlan(sources, files));
});
test('registry: incomplete, duplicate and out-of-order execution receipts are refused', () => {
  const plan = registryMigrationPlan(sources, compiled),
    applied = plan.map((s) => s.name);
  for (const evidence of [
    [],
    applied.slice(1),
    [...applied].reverse(),
    applied.map(() => '20260101000000-example'),
    [...applied, 'unknown'],
  ])
    assert.throws(() => {
      assertRegistryMigrationCompletion(plan, evidence);
    });
  assert.throws(() => {
    assertRegistryMigrationCompletion([], []);
  });
});
test('registry: current source inventory plans every migration without relying on stale compilation', async () => {
  const source = await readdir(path.resolve(__dirname, '../../../migrations'));
  const output = await readdir(path.resolve(__dirname, '../../migrations'));
  const plan = registryMigrationPlan(
    source.filter((f) => f.endsWith('.ts')),
    output.filter((f) => f.endsWith('.js')),
  );
  assert.equal(plan.length, 60);
  assert.deepEqual(
    plan.filter((s) => s.mode === 'rewritten').map((s) => s.name),
    [...registryRewrittenMigrations],
  );
});
test('registry: all four hardcoded migrations generate SQL confined to the fixture namespaces', async () => {
  const driver = new Recorder(),
    db = database(driver);
  try {
    await applyFunctionHardening(db, schema);
    await applyRuntimeReferenceLocks(db, schema);
    await applyAccessRevisionHardening(db, schema);
    await applyIntegrationWorkerFunctions(db, schema);
    await applyIntegrationWorkerHardening(db, schema);
    assert.equal(driver.queries.length, 5);
    for (const query of driver.queries) {
      assert.doesNotMatch(query, /\bpublic\.|\breqro_integration_api\b/);
      assert.ok(query.includes(schema));
    }
    assert.equal(typeof driver.queries[3], 'string');
    assert.ok(driver.queries[3]?.includes(names[1]));
    assert.equal(typeof driver.queries[4], 'string');
    assert.ok(driver.queries[4]?.includes(names[1]));
  } finally {
    await db.destroy();
  }
});
