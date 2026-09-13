import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { up as catalogUp } from '../../migrations/20260902000000-create-organization-service-catalog.js';
import { up as requestUp } from '../../migrations/20260902010000-create-service-request-foundation.js';
import { up as eligibilityUp } from '../../migrations/20260902030000-add-location-eligibility-snapshot.js';
import { up as staffUp } from '../../migrations/20260903010000-add-staff-assignment-workflow-foundation.js';
import { up as authUp } from '../../migrations/20260903020000-add-entra-rbac-foundation.js';
import {
  up,
  down,
} from '../../migrations/20260913000000-add-ai-permissions.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';

const url = process.env.TEST_DATABASE_URL;
test(
  'AI permission migration is additive, repeat-safe, grants nothing and rolls back cleanly',
  { skip: !url },
  async () => {
    const schema = 'ai_' + randomUUID().replaceAll('-', '');
    const admin = new Pool({ connectionString: url });
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
      await db
        .insertInto('permission')
        .values({ permission_key: 'service_request.view' })
        .execute();
      await up(db);
      await up(db);
      assert.deepEqual(
        await db
          .selectFrom('permission')
          .selectAll()
          .orderBy('permission_key')
          .execute(),
        [
          { permission_key: 'ai.administration.access' },
          { permission_key: 'ai.workspace.access' },
          { permission_key: 'service_request.view' },
        ],
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
        [{ permission_key: 'service_request.view' }],
      );
    } finally {
      await db.destroy();
      await admin.query('drop schema "' + schema + '" cascade');
      await admin.end();
    }
  },
);
