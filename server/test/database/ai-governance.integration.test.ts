import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../../src/config/configuration.js';
import { up as catalogUp } from '../../migrations/20260902000000-create-organization-service-catalog.js';
import { up as requestUp } from '../../migrations/20260902010000-create-service-request-foundation.js';
import { up as eligibilityUp } from '../../migrations/20260902030000-add-location-eligibility-snapshot.js';
import { up as staffUp } from '../../migrations/20260903010000-add-staff-assignment-workflow-foundation.js';
import { up as authUp } from '../../migrations/20260903020000-add-entra-rbac-foundation.js';
import {
  up,
  down,
} from '../../migrations/20260913010000-add-ai-governance-metadata.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import { AiUsageService } from '../../src/ai/ai-usage.service.js';
import { AiQuotaService } from '../../src/ai/ai-quota.service.js';
import { AiRouterService } from '../../src/ai/ai-router.service.js';
import { AiPolicyService } from '../../src/ai/ai-policy.service.js';
import type { AiModelDescriptor } from '../../src/ai/ai.types.js';
import type { AiQuotaPolicy } from '../../src/ai/ai-governance.types.js';
import { TestAiProvider } from '../fixtures/ai-test-provider.js';
const url = process.env.TEST_DATABASE_URL;
test(
  'AI governance persists only metadata, serializes quota admission, scopes writes and rolls back safely',
  { skip: !url },
  async (t) => {
    const schema = 'ai_governance_' + randomUUID().replaceAll('-', '');
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
          max: 8,
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
      const org = randomUUID(),
        otherOrg = randomUUID(),
        staffId = randomUUID();
      for (const id of [org, otherOrg])
        await db
          .insertInto('organization')
          .values({
            id,
            name: 'Test',
            short_name: 'Test',
            slug: id,
            status: 'active',
            default_business_timezone: 'UTC',
          })
          .execute();
      await sql`insert into staff_identity(id,organization_id,display_name) values (${staffId},${org},'Test')`.execute(
        db,
      );
      const quota: AiQuotaPolicy = {
        id: 'test-quota',
        rules: [{ scope: 'user', period: 'daily', requestLimit: 1 }],
      };
      const quotas = new AiQuotaService({ get: () => quota });
      const usage = new AiUsageService(
        { client: db } as DatabaseService,
        quotas,
      );
      const model: AiModelDescriptor = {
        id: 'test-model',
        providerId: 'test-only',
        displayName: 'Test',
        description: 'Test',
        enabled: true,
        availability: 'available',
        capabilities: ['text-generation'],
        classificationPolicyId: 'test-data',
        governance: {
          staffOnly: true,
          classificationPolicyId: 'test-data',
          quotaPolicyId: quota.id,
          requiredPermissions: ['ai.workspace.access'],
        },
      };
      const registry = { list: () => [model] };
      const config = new ConfigService<AppConfiguration, true>({
        app: { environment: 'test' },
        ai: { enabled: true, chatEnabled: false, testExecutionEnabled: true },
      });
      const router = new AiRouterService(
        new AiPolicyService(config, registry),
        registry,
        { resolve: () => new TestAiProvider() },
        quotas,
        usage,
        config,
      );
      const staff = {
        organizationId: org,
        staffIdentityId: staffId,
        tenantId: 'test',
        objectId: 'test',
        displayName: 'NAME_SECRET',
        scopes: ['access_as_user'],
        permissions: ['ai.workspace.access'] as ['ai.workspace.access'],
        departmentIds: [],
        divisionIds: [],
        development: false,
      };
      const input = {
        selection: { kind: 'explicit', modelId: model.id },
        messages: [{ author: 'employee', text: 'PROMPT_SECRET' }],
      };
      await t.test(
        'concurrent last-slot requests yield one provider completion and a recorded quota denial',
        async () => {
          const outcomes = await Promise.allSettled([
            router.generate(input, { staff, requestId: randomUUID() }),
            router.generate(input, { staff, requestId: randomUUID() }),
          ]);
          assert.equal(
            outcomes.filter((x) => x.status === 'fulfilled').length,
            1,
          );
          const rows = await db.selectFrom('ai_usage').selectAll().execute();
          assert.equal(rows.length, 2);
          assert.equal(rows.filter((x) => x.outcome === 'completed').length, 1);
          assert.equal(
            rows.filter((x) => x.failure_category === 'quota_exceeded').length,
            1,
          );
          assert.deepEqual(
            (
              await db
                .selectFrom('ai_audit_event')
                .select('event')
                .orderBy('event')
                .execute()
            ).map((x) => x.event),
            ['accepted', 'completed', 'denied'],
          );
          assert.doesNotMatch(
            JSON.stringify(rows),
            /PROMPT_SECRET|Deterministic|NAME_SECRET|content|messages|Bearer/,
          );
        },
      );
      await t.test(
        'metadata schema has no free-form payload columns and validates counts and organization identity',
        async () => {
          const columns = await sql<{
            column_name: string;
          }>`select column_name from information_schema.columns where table_schema=${schema} and table_name in ('ai_usage','ai_audit_event')`.execute(
            db,
          );
          assert.doesNotMatch(
            columns.rows.map((x) => x.column_name).join(','),
            /prompt|response|content|payload|token_secret|credential|message/,
          );
          const meta = {
            requestId: randomUUID(),
            organizationId: otherOrg,
            staffIdentityId: staffId,
            modelId: null,
            providerId: null,
            quotaPolicyId: null,
          };
          await assert.rejects(usage.begin(meta, null, 'unknown_model'));
          const row = await db
            .selectFrom('ai_usage')
            .selectAll()
            .where('outcome', '=', 'completed')
            .executeTakeFirstOrThrow();
          await assert.rejects(
            db
              .updateTable('ai_usage')
              .set({ input_tokens: -1 })
              .where('id', '=', row.id)
              .execute(),
          );
          await assert.rejects(
            db
              .updateTable('ai_usage')
              .set({ input_tokens: 1, output_tokens: 1, total_tokens: 9 })
              .where('id', '=', row.id)
              .execute(),
          );
          await assert.rejects(
            usage.begin(
              { ...meta, organizationId: org, requestId: row.request_id },
              null,
              'unknown_model',
            ),
          );
        },
      );
      await t.test(
        'completion is organization scoped and single-use; metadata extras are omitted',
        async () => {
          const metadata = {
            requestId: randomUUID(),
            organizationId: org,
            staffIdentityId: staffId,
            modelId: model.id,
            providerId: model.providerId,
            quotaPolicyId: quota.id,
            prompt: 'PROMPT_SECRET',
          };
          const id = await usage.begin(metadata, {
            ...quota,
            rules: [
              { scope: 'organization', period: 'monthly', requestLimit: 100 },
            ],
          });
          const result = {
            outcome: 'completed' as const,
            failureCategory: null,
            inputTokens: 2,
            outputTokens: 3,
            totalTokens: 5,
            durationMs: 9,
            response: 'RESPONSE_SECRET',
          };
          await assert.rejects(usage.finish(id, otherOrg, result));
          await usage.finish(id, org, result);
          await assert.rejects(usage.finish(id, org, result));
          const row = await db
            .selectFrom('ai_usage')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirstOrThrow();
          assert.equal(row.total_tokens, 5);
          assert.doesNotMatch(JSON.stringify(row), /SECRET/);
        },
      );
      await t.test(
        'rollback affects only F021 tables and reapply grants no permissions',
        async () => {
          await down(db);
          await up(db);
          assert.deepEqual(
            await db.selectFrom('ai_usage').selectAll().execute(),
            [],
          );
          assert.equal(
            (await db.selectFrom('staff_identity').selectAll().execute())
              .length,
            1,
          );
          assert.deepEqual(
            await db.selectFrom('role_permission').selectAll().execute(),
            [],
          );
        },
      );
    } finally {
      await db.destroy();
      await admin.query('drop schema "' + schema + '" cascade');
      await admin.end();
    }
  },
);
