import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import { TenantResolverService } from '../../src/tenancy/tenant-resolver.service.js';
import { TenantDomainRepository } from '../../src/tenancy/tenant-domain.repository.js';
import {
  deactivateTenantDomain,
  listTenantDomains,
  registerTenantDomain,
} from '../../src/tenancy/tenant-domain.operations.js';
import {
  up,
  down,
} from '../../migrations/20261015000000-add-tenant-domain-registry.js';

const MIGRATION = '20261015000000';

/** Matches whichever of the `ADR-025` database controls refused the write. */
async function refuses(
  action: () => Promise<unknown>,
  expected: RegExp,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.match((error as Error).message, expected);
    return true;
  });
}

test(
  'ADR-025 Slice 1a disposable tenant-domain registry invariants',
  { skip: !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL missing' },
  async (t) => {
    const testUrl = process.env.TEST_DATABASE_URL;
    assert.ok(testUrl);
    const url = new URL(testUrl);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    assert.equal(url.pathname, '/reqro_f0592_test');
    assert.equal(decodeURIComponent(url.username), 'reqro_test_user');
    const admin = new Pool({ connectionString: testUrl });
    const schema = `tenant_domain_${randomUUID().replaceAll('-', '')}`;
    let db: Kysely<DatabaseSchema> | undefined,
      created = false;
    try {
      assert.deepEqual(
        (await admin.query('select current_database() db,current_user usr'))
          .rows,
        [{ db: 'reqro_f0592_test', usr: 'reqro_test_user' }],
      );
      const address = await admin.query<{ address: string }>(
        'select inet_server_addr()::text address',
      );
      assert.ok(
        ['::1/128', '127.0.0.1/32'].includes(address.rows[0]?.address ?? ''),
      );
      await prepareDatabaseExtensions(admin);
      await admin.query(`create schema "${schema}"`);
      created = true;
      db = new Kysely<DatabaseSchema>({
        dialect: new PostgresDialect({
          pool: new Pool({
            connectionString: testUrl,
            options: `-c search_path=${schema}`,
            max: 8,
          }),
        }),
      });
      const database = db;
      assert.equal(
        (
          await sql<{
            schema: string;
          }>`select current_schema() as schema`.execute(database)
        ).rows[0]?.schema,
        schema,
      );

      const folder = path.resolve(__dirname, '../../migrations');
      const earlier = (await readdir(folder))
        .filter((file) => file.endsWith('.js') && file < MIGRATION)
        .sort();
      assert.equal(earlier.length, 44);
      for (const file of earlier) {
        const migration = (await import(
          pathToFileURL(path.join(folder, file)).href
        )) as { up: (db: Kysely<DatabaseSchema>) => Promise<void> };
        await database.transaction().execute(migration.up);
      }

      const organizationA = randomUUID();
      const organizationB = randomUUID();
      const suspended = randomUUID();
      // All three start active: a binding can only be registered for an
      // active Organization, so suspension is applied later, as it would be
      // in operation.
      for (const id of [organizationA, organizationB, suspended])
        await database
          .insertInto('organization')
          .values({
            id,
            name: `Synthetic tenancy ${id}`,
            short_name: 'Test',
            slug: id,
            status: 'active',
            default_business_timezone: 'UTC',
          })
          .execute();

      await t.test(
        'migration 45 applies, rolls back and reapplies',
        async () => {
          await database.transaction().execute(up);
          assert.equal(
            (
              await sql<{
                count: string;
              }>`select count(*)::text as count from tenant_domain`.execute(
                database,
              )
            ).rows[0]?.count,
            '0',
            'the registry must ship with no default or seeded hostname',
          );
          assert.equal(
            (
              await sql<{
                count: string;
              }>`select count(*)::text as count from tenant_domain_audit`.execute(
                database,
              )
            ).rows[0]?.count,
            '0',
          );
          await database.transaction().execute(down);
          assert.equal(
            (
              await sql<{
                present: boolean;
              }>`select to_regclass('tenant_domain') is not null as present`.execute(
                database,
              )
            ).rows[0]?.present,
            false,
          );
          await database.transaction().execute(up);
        },
      );

      /** Registers through the operator path, which never verifies or
       * activates, then forces the lifecycle forward with direct SQL so the
       * database controls themselves are what is under test. */
      async function register(
        organizationId: string,
        hostname: string,
        role:
          | 'public_canonical'
          | 'public_alias'
          | 'platform_fallback' = 'public_canonical',
      ) {
        return registerTenantDomain(database, {
          organizationId,
          hostname,
          role,
          actor: 'synthetic-operator',
          dryRun: false,
        });
      }

      async function advance(
        organizationId: string,
        id: string,
        set: string,
        action: 'verification_requested' | 'verified' | 'activated',
      ): Promise<void> {
        await database.transaction().execute(async (trx) => {
          const before = await trx
            .selectFrom('tenant_domain')
            .select(['role', 'verification_state', 'active', 'revision'])
            .where('organization_id', '=', organizationId)
            .where('id', '=', id)
            .forUpdate()
            .executeTakeFirstOrThrow();
          await sql`update tenant_domain set revision=revision+1, ${sql.raw(set)}
              where organization_id=${organizationId}::uuid and id=${id}::uuid`.execute(
            trx,
          );
          const after = await trx
            .selectFrom('tenant_domain')
            .select([
              'hostname',
              'role',
              'verification_state',
              'active',
              'revision',
            ])
            .where('organization_id', '=', organizationId)
            .where('id', '=', id)
            .executeTakeFirstOrThrow();
          await trx
            .insertInto('tenant_domain_audit')
            .values({
              organization_id: organizationId,
              tenant_domain_id: id,
              hostname: after.hostname,
              action,
              actor: 'synthetic-operator',
              prior_revision: before.revision,
              revision: after.revision,
              prior_role: before.role,
              role: after.role,
              prior_verification_state: before.verification_state,
              verification_state: after.verification_state,
              prior_active: before.active,
              active: after.active,
              evidence: null,
            })
            .execute();
        });
      }

      /** Drives a binding all the way to resolvable: challenge issued,
       * evidence recorded, then activated. Each step is a separate audited
       * revision because the database refuses to collapse them. */
      async function makeResolvable(
        organizationId: string,
        hostname: string,
        role:
          | 'public_canonical'
          | 'public_alias'
          | 'platform_fallback' = 'public_canonical',
      ): Promise<string> {
        const { domain } = await register(organizationId, hostname, role);
        await advance(
          organizationId,
          domain.id,
          `verification_state='pending',verification_method='dns_txt',verification_challenge='challenge-${domain.id}',verification_requested_at=clock_timestamp()`,
          'verification_requested',
        );
        await advance(
          organizationId,
          domain.id,
          `verification_state='verified',verified_at=clock_timestamp(),verification_evidence='{"observed":"challenge"}'::jsonb`,
          'verified',
        );
        await advance(organizationId, domain.id, `active=true`, 'activated');
        return domain.id;
      }

      await t.test(
        'registration produces an unverified inactive binding',
        async () => {
          const { domain, applied } = await register(
            organizationA,
            'Requests.Example.GOV.',
          );

          assert.equal(applied, true);
          assert.equal(domain.hostname, 'requests.example.gov');
          assert.equal(domain.verificationState, 'unverified');
          assert.equal(domain.active, false);
          assert.equal(domain.revision, 1);
          assert.equal(domain.resolvable, false);
          assert.deepEqual(
            (await listTenantDomains(database, organizationA)).map(
              (record) => record.hostname,
            ),
            ['requests.example.gov'],
          );
        },
      );

      await t.test('a dry run leaves no registry row behind', async () => {
        const outcome = await registerTenantDomain(database, {
          organizationId: organizationB,
          hostname: 'dry-run.example.gov',
          role: 'public_alias',
          actor: 'synthetic-operator',
          dryRun: true,
        });

        assert.equal(outcome.applied, false);
        assert.deepEqual(await listTenantDomains(database, organizationB), []);
      });

      await t.test(
        'hostnames are globally unique across Organizations',
        async () => {
          await refuses(
            () => register(organizationB, 'requests.example.gov'),
            /already registered/,
          );
          // The application check above is a courtesy; the database is the control.
          await refuses(
            () =>
              sql`insert into tenant_domain(organization_id,hostname,role)
                values(${organizationB}::uuid,'requests.example.gov','public_alias')`.execute(
                database,
              ),
            /duplicate key|unique/i,
          );
        },
      );

      await t.test(
        'one public canonical hostname per Organization',
        async () => {
          await refuses(
            () => register(organizationA, 'second.example.gov'),
            /already holds a public canonical hostname/,
          );
          await refuses(
            () =>
              sql`insert into tenant_domain(organization_id,hostname,role)
                values(${organizationA}::uuid,'second.example.gov','public_canonical')`.execute(
                database,
              ),
            /tenant_domain_canonical|duplicate key/i,
          );
          // Additional verified addresses are still allowed under other roles.
          const alias = await register(
            organizationA,
            'alias.example.gov',
            'public_alias',
          );
          assert.equal(alias.domain.role, 'public_alias');
        },
      );

      await t.test('only canonical hostname forms are storable', async () => {
        for (const hostname of [
          'Requests.Example.GOV',
          '*.example.gov',
          'requests.example.gov.',
          'requests.example.gov:443',
          'a_b.example.gov',
          'a.example.gov,b.example.gov',
          '127.0.0.1',
          `${'a'.repeat(64)}.example.gov`,
          'example..gov',
          '-example.gov',
        ])
          await refuses(
            () =>
              sql`insert into tenant_domain(organization_id,hostname,role)
                  values(${organizationB}::uuid,${hostname},'public_alias')`.execute(
                database,
              ),
            /tenant_domain_hostname_check|violates check constraint/i,
          );
      });

      await t.test(
        'an unverified or pending binding cannot be active',
        async () => {
          const { domain } = await register(
            organizationB,
            'pending.example.gov',
            'platform_fallback',
          );
          await refuses(
            () =>
              sql`update tenant_domain set active=true,revision=revision+1
                where id=${domain.id}::uuid`.execute(database),
            /Only a verified tenant domain can be activated|violates check constraint/i,
          );
          // A binding cannot jump straight to verified either.
          await refuses(
            () =>
              sql`update tenant_domain set verification_state='verified',verified_at=clock_timestamp(),
                  verification_method='dns_txt',verification_challenge='x',
                  verification_requested_at=clock_timestamp(),
                  verification_evidence='{}'::jsonb,revision=revision+1
                where id=${domain.id}::uuid`.execute(database),
            /Unsupported tenant domain verification transition/,
          );
        },
      );

      await t.test(
        'verification requires an issued challenge and recorded evidence',
        async () => {
          const { domain } = await register(
            organizationB,
            'challenge.example.gov',
            'public_alias',
          );
          await advance(
            organizationB,
            domain.id,
            `verification_state='pending',verification_method='dns_txt',verification_challenge='issued',verification_requested_at=clock_timestamp()`,
            'verification_requested',
          );
          await refuses(
            () =>
              sql`update tenant_domain set verification_state='verified',verified_at=clock_timestamp(),revision=revision+1
                where id=${domain.id}::uuid`.execute(database),
            /recorded ownership evidence|violates check constraint/i,
          );
          await refuses(
            () =>
              sql`update tenant_domain set verification_state='verified',verified_at=clock_timestamp(),
                  verification_challenge='different',verification_evidence='{}'::jsonb,revision=revision+1
                where id=${domain.id}::uuid`.execute(database),
            /recorded ownership evidence/,
          );
        },
      );

      await t.test(
        'every change must carry matching operator audit evidence',
        async () => {
          await refuses(
            () =>
              sql`insert into tenant_domain(organization_id,hostname,role)
                values(${organizationB}::uuid,'unaudited.example.gov','public_alias')`.execute(
                database,
              ),
            /require matching operator audit evidence/,
          );
          const rows = await sql<{
            hostname: string;
          }>`select hostname from tenant_domain where hostname='unaudited.example.gov'`.execute(
            database,
          );
          assert.equal(rows.rows.length, 0);
        },
      );

      await t.test(
        'audit rows are append-only and bound to their binding',
        async () => {
          await refuses(
            () =>
              sql`update tenant_domain_audit set actor='rewritten'`.execute(
                database,
              ),
            /append-only/,
          );
          await refuses(
            () => sql`delete from tenant_domain_audit`.execute(database),
            /append-only/,
          );
          await refuses(
            () => sql`truncate tenant_domain_audit`.execute(database),
            /append-only/,
          );
          // An audit row cannot be attributed to another Organization's binding.
          const binding = await sql<{ id: string }>`
          select id from tenant_domain where organization_id=${organizationA}::uuid limit 1`.execute(
            database,
          );
          const id = binding.rows[0]?.id;
          assert.ok(id);
          await refuses(
            () =>
              sql`insert into tenant_domain_audit(organization_id,tenant_domain_id,hostname,action,actor,revision,role,verification_state,active)
                values(${organizationB}::uuid,${id}::uuid,'requests.example.gov','registered','operator',1,'public_canonical','unverified',false)`.execute(
                database,
              ),
            /requires its binding|foreign key/i,
          );
        },
      );

      await t.test(
        'bindings are deactivated, never deleted or truncated',
        async () => {
          await refuses(
            () => sql`delete from tenant_domain`.execute(database),
            /deactivated, never deleted/,
          );
          await refuses(
            () => sql`truncate tenant_domain cascade`.execute(database),
            /deactivated, never deleted/,
          );
        },
      );

      await t.test(
        'the resolver reads only active verified bindings of active Organizations',
        async () => {
          const resolver = new TenantResolverService(
            new TenantDomainRepository({
              client: database,
            } as never),
          );

          const canonicalId = await makeResolvable(
            organizationB,
            'portal.example.gov',
            'public_canonical',
          );
          const resolved = await resolver.resolve('Portal.Example.GOV.:443');
          assert.deepEqual(resolved, {
            domainId: canonicalId,
            organizationId: organizationB,
            hostname: 'portal.example.gov',
            role: 'public_canonical',
          });

          // Unknown, unverified and inactive bindings are indistinguishable.
          assert.equal(await resolver.resolve('never.example.gov'), null);
          assert.equal(await resolver.resolve('requests.example.gov'), null);
          assert.equal(await resolver.resolve('challenge.example.gov'), null);

          // An inactive Organization cannot be reached through a hostname that
          // is itself still verified and active.
          await makeResolvable(suspended, 'suspended.example.gov');
          assert.ok(await resolver.resolve('suspended.example.gov'));
          await sql`update organization set status='inactive' where id=${suspended}::uuid`.execute(
            database,
          );
          assert.equal(await resolver.resolve('suspended.example.gov'), null);

          // Deactivation removes a hostname from resolution immediately.
          const deactivated = await deactivateTenantDomain(database, {
            organizationId: organizationB,
            hostname: 'portal.example.gov',
            expectedRevision: 4,
            actor: 'synthetic-operator',
            dryRun: false,
          });
          assert.equal(deactivated.domain.active, false);
          assert.equal(deactivated.domain.resolvable, false);
          assert.equal(await resolver.resolve('portal.example.gov'), null);
        },
      );

      await t.test(
        'rollback refuses to discard retained registry evidence',
        async () => {
          await refuses(
            () => database.transaction().execute(down),
            /Retained tenant domain evidence prevents rollback/,
          );
          assert.equal(
            (
              await sql<{
                present: boolean;
              }>`select to_regclass('tenant_domain') is not null as present`.execute(
                database,
              )
            ).rows[0]?.present,
            true,
          );
        },
      );
    } finally {
      if (db) await db.destroy();
      if (created) {
        assert.match(schema, /^tenant_domain_[a-f0-9]{32}$/);
        await admin.query(`drop schema "${schema}" cascade`);
      }
      await admin.end();
    }
  },
);
