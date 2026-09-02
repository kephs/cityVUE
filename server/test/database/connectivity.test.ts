import assert from 'node:assert/strict';
import test from 'node:test';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test(
  'PostgreSQL accepts a connectivity query',
  { skip: testDatabaseUrl ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    assert.ok(testDatabaseUrl);
    const database = new Kysely<Record<string, never>>({
      dialect: new PostgresDialect({
        pool: new Pool({ connectionString: testDatabaseUrl, max: 1 }),
      }),
    });

    try {
      const result = await sql<{ value: number }>`select 1 as value`.execute(
        database,
      );
      assert.equal(result.rows[0]?.value, 1);
    } finally {
      await database.destroy();
    }
  },
);
