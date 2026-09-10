import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { up as catalog } from '../../migrations/20260902000000-create-organization-service-catalog.js';
import { up as requests } from '../../migrations/20260902010000-create-service-request-foundation.js';
import { up as staff } from '../../migrations/20260903010000-add-staff-assignment-workflow-foundation.js';
import {
  up,
  down,
} from '../../migrations/20260910000000-create-resident-alerts.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import { AlertsRepository } from '../../src/alerts/alerts.repository.js';

const url = process.env.TEST_DATABASE_URL;
test(
  'resident alert migration, SQL visibility, ordering, ownership and constraints',
  { skip: !url },
  async () => {
    const schema = `alerts_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: url });
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
      await catalog(db);
      await requests(db);
      await staff(db);
      await up(db);
      const organizationId = randomUUID();
      const otherOrganizationId = randomUUID();
      for (const id of [organizationId, otherOrganizationId])
        await sql`insert into organization(id,name,short_name,slug,status,default_business_timezone) values (${id},'Test','Test',${id},'active','UTC')`.execute(
          db,
        );
      const repository = new AlertsRepository({
        client: db,
      } as DatabaseService);
      const now = new Date('2026-09-10T12:00:00Z');
      assert.deepEqual(await repository.listActive(organizationId, now), []);
      const base = {
        organization_id: organizationId,
        type: 'notice' as const,
        severity: 'info' as const,
        title: 'Test notice',
        message: 'Update',
        image_url: null,
        link_url: null,
        link_label: null,
        starts_at: now,
        expires_at: null,
        published_at: now,
        deactivated_at: null,
        created_by: null,
        updated_by: null,
        published_by: null,
        deactivated_by: null,
      };
      await db.insertInto('resident_alert').values(base).execute(); // defaults to inactive
      assert.deepEqual(await repository.listActive(organizationId, now), []);
      const visibleId = randomUUID();
      const criticalId = randomUUID();
      await db
        .insertInto('resident_alert')
        .values([
          { ...base, id: visibleId, is_active: true },
          { ...base, id: criticalId, is_active: true, severity: 'critical' },
          { ...base, is_active: true, starts_at: new Date(now.getTime() + 1) },
          {
            ...base,
            is_active: true,
            starts_at: new Date(now.getTime() - 1000),
            expires_at: now,
          },
          { ...base, is_active: false, deactivated_at: now },
          { ...base, is_active: true, organization_id: otherOrganizationId },
        ])
        .execute();
      assert.deepEqual(
        (await repository.listActive(organizationId, now)).map((row) => row.id),
        [criticalId, visibleId],
      );
      await assert.rejects(
        sql`insert into resident_alert(organization_id,type,severity,title,message,starts_at) values (${organizationId},'notice','invalid','Test','Test',${now})`.execute(
          db,
        ),
      );
      await assert.rejects(
        db
          .insertInto('resident_alert')
          .values({ ...base, expires_at: now })
          .execute(),
      );
      await assert.rejects(
        db
          .insertInto('resident_alert')
          .values({ ...base, is_active: true, published_at: null })
          .execute(),
      );
      const actor = randomUUID();
      await sql`insert into staff_identity(id,organization_id,display_name) values (${actor},${otherOrganizationId},'Test')`.execute(
        db,
      );
      await assert.rejects(
        db
          .insertInto('resident_alert')
          .values({ ...base, created_by: actor })
          .execute(),
      );
      await down(db);
      await up(db);
      assert.deepEqual(await repository.listActive(organizationId, now), []);
    } finally {
      await db.destroy();
      await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  },
);
