import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import { up as catalogUp } from '../../migrations/20260902000000-create-organization-service-catalog.js';
import { up as requestUp } from '../../migrations/20260902010000-create-service-request-foundation.js';
import { up as eligibilityUp } from '../../migrations/20260902030000-add-location-eligibility-snapshot.js';
import { up as staffUp } from '../../migrations/20260903010000-add-staff-assignment-workflow-foundation.js';
import { up as authUp } from '../../migrations/20260903020000-add-entra-rbac-foundation.js';
import {
  up,
  down,
} from '../../migrations/20260917000000-add-geospatial-read-permission.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';

const url = process.env.TEST_DATABASE_URL;
test(
  'geospatial permission catalog migration is repeat-safe and grants no role',
  { skip: !url },
  async () => {
    const schema = 'geospatial_' + randomUUID().replaceAll('-', '');
    const admin = new Pool({ connectionString: url });
    try {
      await prepareDatabaseExtensions(admin);
    } catch (error) {
      await admin.end();
      throw error;
    }
    await admin.query('create schema "' + schema + '"');
    const db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: url,
          options: '-c search_path=' + schema,
        }),
      }),
    });
    try {
      await catalogUp(db);
      await requestUp(db);
      await eligibilityUp(db);
      await staffUp(db);
      await authUp(db);
      await up(db);
      await up(db);
      assert.deepEqual(
        await db.selectFrom('permission').selectAll().execute(),
        [{ permission_key: 'geospatial.read' }],
      );
      assert.deepEqual(
        await db.selectFrom('role_permission').selectAll().execute(),
        [],
      );
      assert.deepEqual(
        await db.selectFrom('staff_role_assignment').selectAll().execute(),
        [],
      );
      await down(db);
      assert.deepEqual(
        await db.selectFrom('permission').selectAll().execute(),
        [],
      );
      await up(db);
      assert.deepEqual(
        await db.selectFrom('permission').selectAll().execute(),
        [{ permission_key: 'geospatial.read' }],
      );
      assert.deepEqual(
        await db.selectFrom('role_permission').selectAll().execute(),
        [],
      );
    } finally {
      await db.destroy();
      await admin.query('drop schema "' + schema + '" cascade');
      await admin.end();
    }
  },
);
