import 'reflect-metadata';
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { DatabaseService } from '../../src/database/database.service.js';

/**
 * ADR-025 F060.3C-1 activated-runtime proof.
 *
 * Boots the real application under `TENANT_RESOLUTION_STRATEGY=registry`
 * against the disposable database, with two synthetic Organizations and two
 * verified, active tenant-domain bindings, and drives it over actual HTTP.
 *
 * The lower-level F060.3B and F060.3B-A suites prove service and repository
 * isolation; they cannot prove that a real `Host` header reaches the right
 * Organization through the booted pipeline, which is exactly what activation
 * changes.
 */
const url = process.env.TEST_DATABASE_URL;
const HOST_A = 'a.example.gov';
const HOST_B = 'b.example.gov';

interface Seeded {
  org: string;
  category: string;
  service: string;
  version: string;
  label: string;
}

let app: INestApplication | undefined;
let db: Kysely<DatabaseSchema> | undefined;
let admin: Pool | undefined;
let schema = '';
let a: Seeded | undefined;
let b: Seeded | undefined;
let previous: Record<string, string | undefined> = {};

before(async () => {
  if (!url) return;
  const parsed = new URL(url);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname));
  assert.equal(parsed.pathname, '/reqro_f0592_test');
  assert.equal(decodeURIComponent(parsed.username), 'reqro_test_user');
  admin = new Pool({ connectionString: url });
  assert.deepEqual(
    (await admin.query('select current_database() db,current_user usr')).rows,
    [{ db: 'reqro_f0592_test', usr: 'reqro_test_user' }],
  );
  schema = `registry_e2e_${randomUUID().replaceAll('-', '')}`;
  await admin.query(
    'create extension if not exists pgcrypto with schema public',
  );
  await admin.query(`create schema "${schema}"`);
  db = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: url,
        options: `-c search_path=${schema}`,
        max: 8,
      }),
    }),
  });
  const database = db;
  const folder = path.resolve(__dirname, '../../migrations');
  for (const file of (await readdir(folder))
    .filter((name) => name.endsWith('.js'))
    .sort()) {
    const migration = (await import(
      pathToFileURL(path.join(folder, file)).href
    )) as { up: (db: Kysely<DatabaseSchema>) => Promise<void> };
    await database.transaction().execute(migration.up);
  }

  async function seed(label: string, hostname: string): Promise<Seeded> {
    const org = randomUUID(),
      department = randomUUID(),
      category = randomUUID(),
      service = randomUUID(),
      version = randomUUID(),
      operator = randomUUID();
    await database
      .insertInto('organization')
      .values({
        id: org,
        name: `Synthetic ${label}`,
        short_name: label,
        slug: `${label}-${org}`,
        status: 'active',
        default_business_timezone: 'UTC',
      })
      .execute();
    await database
      .insertInto('department')
      .values({
        id: department,
        organization_id: org,
        name: `${label} Works`,
        description: null,
        status: 'active',
        display_order: 1,
      })
      .execute();
    await database
      .insertInto('category')
      .values({
        id: category,
        organization_id: org,
        department_id: department,
        division_id: null,
        name: `${label} Roads`,
        description: `${label} roads`,
        icon_key: 'road',
        status: 'active',
        display_order: 1,
        aliases: [],
        keywords: [],
      })
      .execute();
    await database
      .insertInto('service_definition')
      .values({
        id: service,
        organization_id: org,
        category_id: category,
        service_key: `${label}-pothole`,
        status: 'active',
        availability: 'INTERNAL_AND_EXTERNAL',
        current_published_version_id: null,
      })
      .execute();
    await database
      .insertInto('service_definition_version')
      .values({
        id: version,
        organization_id: org,
        service_definition_id: service,
        version_number: 1,
        name: `${label} Pothole`,
        resident_description: `${label} pothole`,
        icon_key: 'road',
        aliases: [],
        keywords: [],
        default_priority: 'medium',
        location_policy: 'optional',
        geographic_eligibility_mode: 'no_geographic_restriction',
        geographic_eligibility_policy_reference: null,
        anonymous_reporting_policy: 'allowed',
        status: 'published',
        published_at: new Date('2026-10-01T00:00:00Z'),
        routing_metadata: null,
      })
      .execute();
    await database
      .updateTable('service_definition')
      .set({ current_published_version_id: version })
      .where('id', '=', service)
      .execute();
    await database
      .insertInto('resident_alert')
      .values({
        id: randomUUID(),
        organization_id: org,
        type: 'notice',
        severity: 'info',
        title: `${label} alert`,
        message: `${label} alert body`,
        link_url: null,
        link_label: null,
        starts_at: new Date('2026-10-01T00:00:00Z'),
        expires_at: null,
        published_at: new Date('2026-10-01T00:00:00Z'),
        is_active: true,
        deactivated_at: null,
      } as never)
      .execute();

    // Drive the tenant-domain binding to verified + active through the real
    // audited lifecycle; the database refuses any shortcut.
    const domain = randomUUID();
    await database.transaction().execute(async (trx) => {
      await sql`insert into tenant_domain(id,organization_id,hostname,role)
        values(${domain}::uuid,${org}::uuid,${hostname},'public_canonical')`.execute(
        trx,
      );
      await sql`insert into tenant_domain_audit(organization_id,tenant_domain_id,hostname,action,actor,
          prior_revision,revision,prior_role,role,prior_verification_state,verification_state,prior_active,active)
        select d.organization_id,d.id,d.hostname,'registered',${operator},null,d.revision,null,d.role,null,
          d.verification_state,null,d.active from tenant_domain d where d.id=${domain}::uuid`.execute(
        trx,
      );
    });
    const advance = async (set: string, action: string, priorState: string) => {
      await database.transaction().execute(async (trx) => {
        await sql`update tenant_domain set revision=revision+1, ${sql.raw(set)} where id=${domain}::uuid`.execute(
          trx,
        );
        await sql`insert into tenant_domain_audit(organization_id,tenant_domain_id,hostname,action,actor,
            prior_revision,revision,prior_role,role,prior_verification_state,verification_state,prior_active,active)
          select d.organization_id,d.id,d.hostname,${action},${operator},d.revision-1,d.revision,d.role,d.role,
            ${priorState},d.verification_state,
            case when ${action}='activated' then false else d.active end, d.active
          from tenant_domain d where d.id=${domain}::uuid`.execute(trx);
      });
    };
    await advance(
      `verification_state='pending',verification_method='dns_txt',verification_challenge='challenge-${domain}',verification_token_id=gen_random_uuid(),verification_requested_at=clock_timestamp(),verification_expires_at=clock_timestamp()+interval '14 days'`,
      'verification_requested',
      'unverified',
    );
    await advance(
      `verification_state='verified',verified_at=clock_timestamp(),verification_evidence='{"observed":"challenge"}'::jsonb`,
      'verified',
      'pending',
    );
    await advance(`active=true`, 'activated', 'verified');
    return { org, category, service, version, label };
  }

  a = await seed('alpha', HOST_A);
  b = await seed('bravo', HOST_B);

  previous = {
    NODE_ENV: process.env.NODE_ENV,
    CITYVUE_DEPLOYMENT_PROFILE: process.env.CITYVUE_DEPLOYMENT_PROFILE,
    TENANT_RESOLUTION_STRATEGY: process.env.TENANT_RESOLUTION_STRATEGY,
    DEVELOPMENT_ORGANIZATION_ID: process.env.DEVELOPMENT_ORGANIZATION_ID,
    CORS_ORIGINS: process.env.CORS_ORIGINS,
    DATABASE_URL: process.env.DATABASE_URL,
    LOG_LEVEL: process.env.LOG_LEVEL,
    ENABLE_DEVELOPMENT_ATTACHMENTS: process.env.ENABLE_DEVELOPMENT_ATTACHMENTS,
    CITYVUE_ENABLE_EXTERNAL_IDENTITY:
      process.env.CITYVUE_ENABLE_EXTERNAL_IDENTITY,
  };
  process.env.NODE_ENV = 'test';
  process.env.CITYVUE_DEPLOYMENT_PROFILE = 'development';
  process.env.TENANT_RESOLUTION_STRATEGY = 'registry';
  // Registry mode refuses to start with a lingering development Organization.
  delete process.env.DEVELOPMENT_ORGANIZATION_ID;
  delete process.env.CITYVUE_ENABLE_EXTERNAL_IDENTITY;
  process.env.CORS_ORIGINS = `https://${HOST_A},https://${HOST_B}`;
  process.env.DATABASE_URL =
    'postgresql://cityvue:placeholder@localhost:5432/cityvue_test';
  process.env.LOG_LEVEL = 'silent';
  process.env.ENABLE_DEVELOPMENT_ATTACHMENTS = 'true';

  const [{ AppModule }, { configureApplication }] = await Promise.all([
    import('../../src/app.module.js'),
    import('../../src/bootstrap.js'),
  ]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DatabaseService)
    .useValue({ client: database, status: () => Promise.resolve('up') })
    .compile();
  app = moduleRef.createNestApplication();
  // Registry mode now boots. This call is itself the activation proof.
  configureApplication(app);
  await app.init();
});

after(async () => {
  if (app) await app.close();
  if (db) await db.destroy();
  if (admin) {
    if (schema) {
      assert.match(schema, /^registry_e2e_[a-f0-9]{32}$/);
      await admin.query(`drop schema "${schema}" cascade`);
    }
    await admin.end();
  }
  for (const [key, value] of Object.entries(previous))
    if (value === undefined) process.env[key] = '';
    else process.env[key] = value;
});

test(
  'registry mode boots and serves each Organization from its own hostname',
  { skip: !url && 'TEST_DATABASE_URL missing' },
  async (t) => {
    assert.ok(app && a && b && db);
    const alpha = a,
      bravo = b,
      database = db,
      server = app.getHttpServer() as Server;
    const get = (path: string, host: string) =>
      request(server).get(path).set('Host', host);

    await t.test('each hostname returns only its own alerts', async () => {
      const first = await get('/api/v1/alerts/active', HOST_A).expect(200);
      const second = await get('/api/v1/alerts/active', HOST_B).expect(200);

      assert.deepEqual(
        (first.body as { title: string }[]).map((entry) => entry.title),
        ['alpha alert'],
      );
      assert.deepEqual(
        (second.body as { title: string }[]).map((entry) => entry.title),
        ['bravo alert'],
      );
      assert.equal(JSON.stringify(first.body).includes('bravo'), false);
      assert.equal(JSON.stringify(second.body).includes('alpha'), false);
    });

    await t.test('each hostname returns only its own catalog', async () => {
      const first = await get('/api/v1/catalog/categories', HOST_A).expect(200);
      const second = await get('/api/v1/catalog/categories', HOST_B).expect(
        200,
      );

      assert.deepEqual(
        (first.body as { name: string }[]).map((entry) => entry.name),
        ['alpha Roads'],
      );
      assert.deepEqual(
        (second.body as { name: string }[]).map((entry) => entry.name),
        ['bravo Roads'],
      );
      // B's category id is not a selector under A's hostname.
      await get(`/api/v1/catalog/categories/${bravo.category}/issues`, HOST_A)
        .expect(200)
        .expect((response) => {
          assert.deepEqual(response.body, []);
        });
      // B's published issue cannot be loaded through A's hostname.
      await get(`/api/v1/catalog/issues/${bravo.service}`, HOST_A).expect(404);
      await get(`/api/v1/catalog/issues/${alpha.service}`, HOST_A).expect(200);
    });

    await t.test(
      'the resident experience read is hostname scoped',
      async () => {
        for (const host of [HOST_A, HOST_B]) {
          const response = await get(
            '/api/v1/resident-experience',
            host,
          ).expect(200);
          assert.deepEqual(response.body, {
            schemaVersion: 1,
            configuration: null,
          });
        }
      },
    );

    await t.test(
      'a request is created under the hostname Organization',
      async () => {
        const created = await request(server)
          .post('/api/v1/service-requests')
          .set('Host', HOST_A)
          .send({
            serviceDefinitionId: alpha.service,
            serviceDefinitionVersionId: alpha.version,
            description: 'Synthetic alpha intake',
            reportingIdentity: 'anonymous',
            answers: [],
          })
          .expect(201);
        const id = (created.body as { id: string }).id;

        const row = await sql<{ organization_id: string }>`
        select organization_id from service_request where id=${id}::uuid`.execute(
          database,
        );
        assert.equal(row.rows[0]?.organization_id, alpha.org);
        assert.equal(JSON.stringify(created.body).includes(bravo.org), false);
      },
    );

    await t.test(
      'a forged Organization body field cannot redirect authority',
      async () => {
        const created = await request(server)
          .post('/api/v1/service-requests')
          .set('Host', HOST_A)
          .send({
            organizationId: bravo.org,
            organization_id: bravo.org,
            tenant: bravo.org,
            serviceDefinitionId: alpha.service,
            serviceDefinitionVersionId: alpha.version,
            description: 'Synthetic forged intake',
            reportingIdentity: 'anonymous',
            answers: [],
          });

        // Either the DTO whitelist rejects the unknown fields outright, or the
        // request is created - but never under Organization B.
        assert.ok([201, 400].includes(created.status));
        if (created.status === 201) {
          const id = (created.body as { id: string }).id;
          const row = await sql<{ organization_id: string }>`
          select organization_id from service_request where id=${id}::uuid`.execute(
            database,
          );
          assert.equal(row.rows[0]?.organization_id, alpha.org);
        }
        const leaked = await sql<{ count: string }>`
        select count(*)::text as count from service_request
        where organization_id=${bravo.org}::uuid`.execute(database);
        assert.equal(leaked.rows[0]?.count, '0');
      },
    );

    await t.test(
      'resident attachment batches belong to the hostname Organization',
      async () => {
        const started = await request(server)
          .post('/api/v1/intake/attachments/batches')
          .set('Host', HOST_A)
          .set('Origin', `https://${HOST_A}`)
          .send({
            issueId: alpha.service,
            versionId: alpha.version,
          });

        if (started.status === 201 || started.status === 200) {
          const payload = started.body as { batchId?: string; id?: string };
          const batchId = payload.batchId ?? payload.id;
          assert.ok(batchId);
          const row = await sql<{ organization_id: string }>`
          select organization_id from attachment_batch where id=${batchId}::uuid`.execute(
            database,
          );
          assert.equal(row.rows[0]?.organization_id, alpha.org);
        }
        // B's issue is not addressable from A's hostname whatever the state.
        await request(server)
          .post('/api/v1/intake/attachments/batches')
          .set('Host', HOST_A)
          .set('Origin', `https://${HOST_A}`)
          .send({ issueId: bravo.service, versionId: bravo.version })
          .expect((response) => {
            assert.notEqual(response.status, 201);
          });
        const foreign = await sql<{ count: string }>`
        select count(*)::text as count from attachment_batch
        where organization_id=${bravo.org}::uuid`.execute(database);
        assert.equal(foreign.rows[0]?.count, '0');
      },
    );

    await t.test(
      'an unknown hostname fails closed with a generic 404',
      async () => {
        for (const host of ['unknown.example.gov', 'evil.example.com']) {
          const response = await get('/api/v1/alerts/active', host).expect(404);
          const body = JSON.stringify(response.body);
          assert.equal(body.includes(alpha.org), false);
          assert.equal(body.includes(bravo.org), false);
          assert.equal(body.toLowerCase().includes('tenant'), false);
        }
      },
    );

    await t.test(
      'a malformed or forwarded host cannot select a tenant',
      async () => {
        // Direct mode ignores X-Forwarded-Host entirely.
        await get('/api/v1/alerts/active', 'unknown.example.gov')
          .set('X-Forwarded-Host', HOST_A)
          .expect(404);
        await get('/api/v1/alerts/active', `${HOST_A},${HOST_B}`).expect(404);
        await get('/api/v1/alerts/active', '*.example.gov').expect(404);
      },
    );

    await t.test(
      'deactivating a binding immediately stops resolution',
      async () => {
        await get('/api/v1/alerts/active', HOST_B).expect(200);
        await database.transaction().execute(async (trx) => {
          await sql`update tenant_domain set active=false, revision=revision+1 where hostname=${HOST_B}`.execute(
            trx,
          );
          await sql`insert into tenant_domain_audit(organization_id,tenant_domain_id,hostname,action,actor,
            prior_revision,revision,prior_role,role,prior_verification_state,verification_state,prior_active,active)
          select d.organization_id,d.id,d.hostname,'deactivated','synthetic-operator',d.revision-1,d.revision,
            d.role,d.role,d.verification_state,d.verification_state,true,d.active
          from tenant_domain d where d.hostname=${HOST_B}`.execute(trx);
        });

        await get('/api/v1/alerts/active', HOST_B).expect(404);
        // A is unaffected.
        await get('/api/v1/alerts/active', HOST_A).expect(200);
      },
    );

    await t.test('health remains reachable on any hostname', async () => {
      // Readiness must not depend on tenant resolution.
      await get('/api/v1/health/live', 'unknown.example.gov').expect(200);
      await get('/api/v1/health/live', HOST_A).expect(200);
    });

    await t.test(
      'staff routes stay identity-authoritative, not hostname driven',
      async () => {
        // No Entra token and no development staff gate under this profile, so a
        // staff route refuses regardless of which verified hostname is used.
        for (const host of [HOST_A, HOST_B]) {
          const response = await get('/api/v1/service-requests', host);
          assert.ok(
            [401, 403, 404].includes(response.status),
            `staff route must not be opened by hostname ${host}`,
          );
          assert.equal(
            JSON.stringify(response.body).includes(alpha.org),
            false,
          );
        }
      },
    );
  },
);
