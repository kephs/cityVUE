import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import {
  down,
  up,
} from '../../migrations/20260902000000-create-organization-service-catalog.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import { CatalogRepository } from '../../src/catalog/catalog.repository.js';

const url = process.env.TEST_DATABASE_URL;

test(
  'Phase C0 migration enforces ownership and immutable versions',
  { skip: !url },
  async () => {
    const schema = `catalog_${randomUUID().replaceAll('-', '')}`;
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
      await up(db);
      const org1 = randomUUID();
      const org2 = randomUUID();
      const department1 = randomUUID();
      const department2 = randomUUID();
      await db
        .insertInto('organization')
        .values([
          {
            id: org1,
            name: 'One',
            short_name: 'One',
            slug: `one-${schema}`,
            status: 'active',
            default_business_timezone: 'America/New_York',
          },
          {
            id: org2,
            name: 'Two',
            short_name: 'Two',
            slug: `two-${schema}`,
            status: 'active',
            default_business_timezone: 'America/Chicago',
          },
        ])
        .execute();
      await db
        .insertInto('department')
        .values([
          {
            id: department1,
            organization_id: org1,
            name: 'Works',
            description: null,
            status: 'active',
            display_order: 1,
          },
          {
            id: department2,
            organization_id: org2,
            name: 'Works',
            description: null,
            status: 'active',
            display_order: 1,
          },
        ])
        .execute();
      await assert.rejects(
        db
          .insertInto('division')
          .values({
            id: randomUUID(),
            organization_id: org1,
            department_id: department2,
            name: 'Crossed',
            description: null,
            status: 'active',
            display_order: 1,
          })
          .execute(),
      );
      const division = randomUUID();
      await db
        .insertInto('division')
        .values({
          id: division,
          organization_id: org1,
          department_id: department1,
          name: 'Roads',
          description: null,
          status: 'active',
          display_order: 1,
        })
        .execute();
      await assert.rejects(
        db
          .insertInto('category')
          .values({
            id: randomUUID(),
            organization_id: org2,
            department_id: department2,
            division_id: division,
            name: 'Crossed',
            description: '',
            icon_key: 'road',
            aliases: [],
            keywords: [],
            status: 'active',
            display_order: 1,
          })
          .execute(),
      );
      const category = randomUUID();
      await db
        .insertInto('category')
        .values({
          id: category,
          organization_id: org1,
          department_id: department1,
          division_id: division,
          name: 'Roads',
          description: 'Broken asphalt',
          icon_key: 'road',
          aliases: ['streets'],
          keywords: ['crater'],
          status: 'active',
          display_order: 1,
        })
        .execute();
      const service = randomUUID();
      await db
        .insertInto('service_definition')
        .values({
          id: service,
          organization_id: org1,
          category_id: category,
          service_key: 'pothole',
          status: 'active',
          current_published_version_id: null,
        })
        .execute();
      await assert.rejects(
        db
          .insertInto('service_definition')
          .values({
            id: randomUUID(),
            organization_id: org2,
            category_id: category,
            service_key: 'crossed',
            status: 'active',
            current_published_version_id: null,
          })
          .execute(),
      );
      const version = randomUUID();
      const versionData = {
        organization_id: org1,
        service_definition_id: service,
        name: 'Pothole',
        resident_description: 'Street damage',
        icon_key: 'cone',
        aliases: ['road hole'],
        keywords: ['asphalt'],
        default_priority: 'medium',
        location_policy: 'required',
        geographic_eligibility_mode: 'city_maintained_roadway',
        anonymous_reporting_policy: 'allowed',
        routing_metadata: null,
      };
      await db
        .insertInto('service_definition_version')
        .values({
          ...versionData,
          id: version,
          version_number: 1,
          status: 'published',
          published_at: new Date(),
        })
        .execute();
      await db
        .insertInto('service_definition_version')
        .values({
          ...versionData,
          id: randomUUID(),
          version_number: 2,
          status: 'draft',
          published_at: null,
        })
        .execute();
      await assert.rejects(
        db
          .insertInto('service_definition_version')
          .values({
            ...versionData,
            id: randomUUID(),
            version_number: 1,
            status: 'draft',
            published_at: null,
          })
          .execute(),
      );
      await db
        .updateTable('service_definition')
        .set({ current_published_version_id: version })
        .where('id', '=', service)
        .execute();
      await assert.rejects(
        db
          .updateTable('service_definition_version')
          .set({ name: 'Changed' })
          .where('id', '=', version)
          .execute(),
      );
      assert.equal(
        (
          await db
            .selectFrom('service_definition_version')
            .select('id')
            .where('service_definition_id', '=', service)
            .execute()
        ).length,
        2,
      );
      const question = randomUUID();
      await db
        .insertInto('question')
        .values({
          id: question,
          organization_id: org1,
          service_definition_version_id: version,
          question_key: 'blocked',
          label: 'Blocked?',
          help_text: null,
          question_type: 'yes_no',
          is_required: true,
          display_order: 1,
          validation_metadata: null,
          visibility_condition: null,
          status: 'active',
        })
        .execute();
      await db
        .insertInto('question')
        .values({
          id: randomUUID(),
          organization_id: org1,
          service_definition_version_id: version,
          question_key: 'details',
          label: 'Details',
          help_text: null,
          question_type: 'long_text',
          is_required: true,
          display_order: 2,
          validation_metadata: null,
          visibility_condition: {
            questionKey: 'blocked',
            operator: 'equals',
            value: 'yes',
          },
          status: 'active',
        })
        .execute();
      await assert.rejects(
        db
          .insertInto('question')
          .values({
            id: randomUUID(),
            organization_id: org1,
            service_definition_version_id: version,
            question_key: 'bad',
            label: 'Bad',
            help_text: null,
            question_type: 'short_text',
            is_required: false,
            display_order: 3,
            validation_metadata: null,
            visibility_condition: { executable: 'no' },
            status: 'active',
          })
          .execute(),
      );
      await db
        .insertInto('question_option')
        .values({
          id: randomUUID(),
          organization_id: org1,
          question_id: question,
          option_key: 'yes',
          label: 'Yes',
          display_order: 1,
          status: 'active',
        })
        .execute();
      await assert.rejects(
        db
          .insertInto('question_option')
          .values({
            id: randomUUID(),
            organization_id: org2,
            question_id: question,
            option_key: 'bad',
            label: 'Bad',
            display_order: 2,
            status: 'active',
          })
          .execute(),
      );
      const repository = new CatalogRepository({
        client: db,
      } as DatabaseService);
      assert.equal(
        (await repository.listActiveCategories(org1, 'CRATER')).length,
        1,
      );
      assert.equal(
        (await repository.listActiveCategories(org2, 'crater')).length,
        0,
      );
      assert.equal(
        (await repository.listPublishedIssues(org1, category, 'ROAD HOLE'))
          .length,
        1,
      );
      const detail = await repository.getPublishedIssue(org1, service);
      assert.ok(detail);
      assert.equal(detail.questions[0]?.question_key, 'blocked');
      assert.equal(detail.questions[1]?.question_key, 'details');
      assert.equal(
        await repository.getPublishedIssue(org2, service),
        undefined,
      );
      await db
        .updateTable('category')
        .set({ status: 'inactive' })
        .where('id', '=', category)
        .execute();
      assert.equal(
        (await repository.listPublishedIssues(org1, category)).length,
        0,
      );
      assert.equal(
        await repository.getPublishedIssue(org1, service),
        undefined,
      );
      await db
        .updateTable('category')
        .set({ status: 'active' })
        .where('id', '=', category)
        .execute();
      await down(db);
    } finally {
      await db.destroy();
      await admin.query(`drop schema if exists "${schema}" cascade`);
      await admin.end();
    }
  },
);
