import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import {
  up,
  down,
} from '../../migrations/20260902000000-create-organization-service-catalog.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';

const url = process.env.TEST_DATABASE_URL;

test(
  'concurrent extension setup survives isolated migration rollback and schema cleanup',
  { skip: !url },
  async () => {
    const admin = new Pool({ connectionString: url });
    const extension = () =>
      admin.query<{ oid: number; schema: string }>(
        `select e.oid, n.nspname as schema from pg_extension e
     join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pgcrypto'`,
      );
    try {
      const setup = await Promise.allSettled(
        Array.from({ length: 4 }, () => prepareDatabaseExtensions(admin)),
      );
      for (const result of setup) {
        if (result.status === 'rejected') throw result.reason;
      }
      const before = (await extension()).rows;
      assert.equal(before.length, 1);
      assert.equal(before[0]?.schema, 'public');
      const migrations = await Promise.allSettled(
        Array.from({ length: 2 }, async () => {
          const schema = `extension_test_${randomUUID().replaceAll('-', '')}`;
          await admin.query(`create schema "${schema}"`);
          const db = new Kysely<DatabaseSchema>({
            dialect: new PostgresDialect({
              pool: new Pool({
                connectionString: url,
                options: `-c search_path=${schema}`,
              }),
            }),
          });
          try {
            await up(db);
            await down(db);
            await up(db);
          } finally {
            await db.destroy();
            await admin.query(`drop schema "${schema}" cascade`);
          }
        }),
      );
      for (const result of migrations) {
        if (result.status === 'rejected') throw result.reason;
      }
      assert.deepEqual((await extension()).rows, before);
    } finally {
      await admin.end();
    }
  },
);
