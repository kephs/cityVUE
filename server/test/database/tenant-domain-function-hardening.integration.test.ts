import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import {
  deactivateTenantDomain,
  issueTenantDomainChallenge,
  registerTenantDomain,
} from '../../src/tenancy/tenant-domain.operations.js';

/**
 * ADR-027 F060.3C-2c-2. Behavioural evidence for the Migration 48 hardening,
 * not an inspection of function text.
 *
 * **Harness adaptation, stated openly.** Migration 48 schema-qualifies every
 * application object as `public.*`, which is correct for the deployment where
 * the application schema is `public`. Every database suite in this repository
 * runs in a disposable per-test schema instead, so the migration SQL is
 * applied here with `public.` rewritten to that schema. The security property
 * under test — that references are qualified and the function-local
 * `search_path` is pinned, so `pg_temp` cannot redirect them — is unaffected
 * by the schema's name. What this adaptation does **not** verify is the
 * literal `public` spelling, so that is asserted separately against the
 * migration source.
 */
const PUBLIC_QUALIFIER = /\bpublic\./g;

async function migrationSql(file: string, schema: string): Promise<string> {
  const source = await readFile(
    path.resolve(__dirname, '../../../migrations', file),
    'utf8',
  );
  return source.replace(PUBLIC_QUALIFIER, `${schema}.`);
}

test(
  'ADR-027 F060.3C-2c-2 tenant-domain function hardening',
  { skip: !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL missing' },
  async (t) => {
    const testUrl = process.env.TEST_DATABASE_URL;
    assert.ok(testUrl);
    const url = new URL(testUrl);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    assert.equal(url.pathname, '/reqro_f0592_test');
    assert.equal(decodeURIComponent(url.username), 'reqro_test_user');
    const admin = new Pool({ connectionString: testUrl });
    const schema = `hardening_${randomUUID().replaceAll('-', '')}`;
    let db: Kysely<DatabaseSchema> | undefined,
      created = false;
    try {
      assert.deepEqual(
        (await admin.query('select current_database() db,current_user usr'))
          .rows,
        [{ db: 'reqro_f0592_test', usr: 'reqro_test_user' }],
      );
      await prepareDatabaseExtensions(admin);
      await admin.query(`create schema "${schema}"`);
      created = true;
      db = new Kysely<DatabaseSchema>({
        dialect: new PostgresDialect({
          pool: new Pool({
            connectionString: testUrl,
            options: `-c search_path=${schema}`,
            max: 6,
          }),
        }),
      });
      const database = db;

      const folder = path.resolve(__dirname, '../../migrations');
      const earlier = (await readdir(folder))
        .filter((file) => file.endsWith('.js') && file < '20261018000000')
        .sort();
      assert.equal(earlier.length, 47);
      for (const file of earlier) {
        const migration = (await import(
          path.join(folder, file).replace(/\\/g, '/').replace(/^/, 'file:///')
        )) as { up: (db: Kysely<DatabaseSchema>) => Promise<void> };
        await database.transaction().execute(migration.up);
      }

      // Migration 48 is applied as rewritten SQL rather than by importing its
      // module, because its `public.` qualification is deployment correct and
      // must be redirected to the disposable schema here.
      const hardenUp = await migrationSql(
        '20261018000000-harden-tenant-domain-functions.ts',
        schema,
      );
      const upBody =
        /export async function up[\s\S]*?await sql`([\s\S]*?)`\.execute/.exec(
          hardenUp,
        );
      const downBody =
        /export async function down[\s\S]*?await sql`([\s\S]*?)`\.execute/.exec(
          hardenUp,
        );
      const hardenUpSql = upBody?.[1];
      const hardenDownSql = downBody?.[1];
      assert.ok(hardenUpSql);
      assert.ok(hardenDownSql);
      const applyHardening = () => sql.raw(hardenUpSql).execute(database);
      const rollbackHardening = () => sql.raw(hardenDownSql).execute(database);

      const organizationA = randomUUID();
      const suspended = randomUUID();
      for (const id of [organizationA, suspended])
        await database
          .insertInto('organization')
          .values({
            id,
            name: `Synthetic hardening ${id}`,
            short_name: 'Test',
            slug: id,
            status: 'active',
            default_business_timezone: 'UTC',
          })
          .execute();

      await t.test('migration 48 applies', async () => {
        await applyHardening();
        const helper = await sql<{ present: boolean }>`
          select to_regprocedure(${`${schema}.tenant_domain_lock_organization(uuid)`}) is not null as present`.execute(
          database,
        );
        assert.equal(helper.rows[0]?.present, true);
      });

      await t.test(
        'the helper is VOLATILE, SECURITY DEFINER and path pinned',
        async () => {
          const row = await sql<{
            volatility: string;
            security_definer: boolean;
            config: string[] | null;
            owner: string;
          }>`
            select p.provolatile as volatility, p.prosecdef as security_definer,
              p.proconfig as config, pg_get_userbyid(p.proowner) as owner
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname=${schema} and p.proname='tenant_domain_lock_organization'`.execute(
            database,
          );
          const helper = row.rows[0];
          assert.ok(helper);
          // 'v' is VOLATILE. The function exists to take a row lock, so the
          // optimizer must not be allowed to elide or reorder it.
          assert.equal(helper.volatility, 'v');
          assert.equal(helper.security_definer, true);
          assert.deepEqual(helper.config, ['search_path=pg_catalog, pg_temp']);
          // Owned by the role that ran the migration, never by a caller.
          assert.equal(helper.owner, 'reqro_test_user');
        },
      );

      await t.test('PUBLIC cannot execute the helper', async () => {
        const row = await sql<{ granted: boolean }>`
          select has_function_privilege('public',
            ${`${schema}.tenant_domain_lock_organization(uuid)`}, 'EXECUTE') as granted`.execute(
          database,
        );
        assert.equal(
          row.rows[0]?.granted,
          false,
          'PUBLIC EXECUTE must be revoked by the migration itself',
        );
      });

      await t.test(
        'every hardened function pins a deterministic search_path',
        async () => {
          const rows = await sql<{ name: string; config: string[] | null }>`
            select p.proname as name, p.proconfig as config
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname=${schema} and p.proname in
              ('guard_tenant_domain','guard_tenant_domain_attempt','guard_tenant_domain_audit',
               'verify_tenant_domain_audited','guard_tenant_domain_approval',
               'tenant_domain_approval_consumed','tenant_domain_lock_organization')
            order by p.proname`.execute(database);
          assert.equal(rows.rows.length, 7);
          for (const row of rows.rows)
            assert.deepEqual(
              row.config,
              ['search_path=pg_catalog, pg_temp'],
              `${row.name} must pin its search_path`,
            );
        },
      );

      await t.test(
        'the helper reports servable status and exposes nothing else',
        async () => {
          const active = await sql<{ servable: boolean }>`
            select ${sql.raw(`${schema}.tenant_domain_lock_organization`)}(${organizationA}::uuid) as servable`.execute(
            database,
          );
          assert.equal(active.rows[0]?.servable, true);
          const missing = await sql<{ servable: boolean }>`
            select ${sql.raw(`${schema}.tenant_domain_lock_organization`)}(${randomUUID()}::uuid) as servable`.execute(
            database,
          );
          assert.equal(
            missing.rows[0]?.servable,
            false,
            'a missing Organization is false, not an error',
          );
          // Its only output is a boolean: there is no column through which a
          // name, slug or short name could leave.
          const shape = await sql<{ result: string }>`
            select pg_get_function_result(p.oid) as result from pg_proc p
            join pg_namespace n on n.oid=p.pronamespace
            where n.nspname=${schema} and p.proname='tenant_domain_lock_organization'`.execute(
            database,
          );
          assert.equal(shape.rows[0]?.result, 'boolean');
        },
      );

      /** Registers and drives a binding forward with attributed direct SQL. */
      const OPERATOR = 'dev:hardening-operator';
      const APPROVER = 'dev:hardening-approver';
      const REASON = 'F060.3C-2c-2 synthetic function hardening evidence';

      const attribution = () => ({
        operatorIdentity: OPERATOR,
        reason: REASON,
        correlationId: randomUUID(),
      });

      async function registerBinding(
        organizationId: string,
        hostname: string,
      ): Promise<string> {
        const id = randomUUID();
        await database.transaction().execute(async (trx) => {
          await sql`insert into tenant_domain(id,organization_id,hostname,role)
            values(${id}::uuid,${organizationId}::uuid,${hostname},'public_alias')`.execute(
            trx,
          );
          await sql`insert into tenant_domain_audit(organization_id,tenant_domain_id,hostname,action,actor,
              attribution_version,operator_identity,reason,correlation_id,outcome,
              prior_revision,revision,prior_role,role,prior_verification_state,verification_state,prior_active,active)
            select d.organization_id,d.id,d.hostname,'registered',${OPERATOR},
              2,${OPERATOR},${REASON},gen_random_uuid(),'applied',
              null,d.revision,null,d.role,null,d.verification_state,null,d.active
            from tenant_domain d where d.id=${id}::uuid`.execute(trx);
        });
        return id;
      }

      await t.test(
        'hostile caller search_path cannot redirect hardened references',
        async () => {
          const hostname = 'hostile-path.example.gov';
          await registerBinding(organizationA, hostname);
          // A caller search_path that does not contain the application schema
          // at all would break every unqualified reference. The hardened
          // functions must still work, because they qualify everything and
          // pin their own path.
          await database.transaction().execute(async (trx) => {
            await sql`set local search_path to pg_catalog`.execute(trx);
            const updated = await sql<{ revision: number }>`
              update ${sql.raw(schema)}.tenant_domain set role='platform_fallback', revision=revision+1
              where hostname=${hostname} returning revision`.execute(trx);
            assert.equal(updated.rows[0]?.revision, 2);
            await sql`insert into ${sql.raw(schema)}.tenant_domain_audit(organization_id,tenant_domain_id,hostname,action,actor,
                attribution_version,operator_identity,reason,correlation_id,outcome,
                prior_revision,revision,prior_role,role,prior_verification_state,verification_state,prior_active,active)
              select d.organization_id,d.id,d.hostname,'role_changed',${OPERATOR},
                2,${OPERATOR},${REASON},gen_random_uuid(),'applied',
                d.revision-1,d.revision,'public_alias',d.role,d.verification_state,d.verification_state,d.active,d.active
              from ${sql.raw(schema)}.tenant_domain d where d.hostname=${hostname}`.execute(
              trx,
            );
          });
        },
      );

      await t.test(
        'a temporary relation and composite type cannot shadow the hardened references',
        async () => {
          const hostname = 'shadow.example.gov';
          await registerBinding(organizationA, hostname);
          await database.transaction().execute(async (trx) => {
            // A temp table creates both a relation and a composite type of the
            // same name, and pg_temp is implicitly searched first for both.
            // The hardened functions declare `<schema>.tenant_domain` and read
            // qualified relations, so neither can be redirected.
            await sql`create temporary table tenant_domain(id uuid, hostname text, revision integer) on commit drop`.execute(
              trx,
            );
            await sql`create temporary table tenant_domain_audit(id uuid) on commit drop`.execute(
              trx,
            );
            await sql`create temporary table organization(id uuid, status text) on commit drop`.execute(
              trx,
            );
            await sql`insert into pg_temp.organization values(${organizationA}::uuid,'suspended')`.execute(
              trx,
            );
            // The mutation still succeeds and still enforces the real audit
            // invariant against the real tables.
            await sql`update ${sql.raw(schema)}.tenant_domain set role='public_canonical', revision=revision+1
              where hostname=${hostname}`.execute(trx);
            await sql`insert into ${sql.raw(schema)}.tenant_domain_audit(organization_id,tenant_domain_id,hostname,action,actor,
                attribution_version,operator_identity,reason,correlation_id,outcome,
                prior_revision,revision,prior_role,role,prior_verification_state,verification_state,prior_active,active)
              select d.organization_id,d.id,d.hostname,'role_changed',${OPERATOR},
                2,${OPERATOR},${REASON},gen_random_uuid(),'applied',
                d.revision-1,d.revision,'public_alias',d.role,d.verification_state,d.verification_state,d.active,d.active
              from ${sql.raw(schema)}.tenant_domain d where d.hostname=${hostname}`.execute(
              trx,
            );
          });
          // The shadowed Organization status never took effect: the binding
          // changed in the real table.
          const live = await sql<{ role: string; revision: number }>`
            select role, revision from tenant_domain where hostname=${hostname}`.execute(
            database,
          );
          assert.equal(live.rows[0]?.role, 'public_canonical');
        },
      );

      await t.test(
        'the deferred audit invariant still refuses an unaudited change under a hostile path',
        async () => {
          const hostname = 'shadow-refusal.example.gov';
          await registerBinding(organizationA, hostname);
          await assert.rejects(
            () =>
              database.transaction().execute(async (trx) => {
                await sql`create temporary table tenant_domain_audit(id uuid) on commit drop`.execute(
                  trx,
                );
                // Writing the decoy audit row must not satisfy the invariant.
                await sql`insert into pg_temp.tenant_domain_audit values(gen_random_uuid())`.execute(
                  trx,
                );
                await sql`update ${sql.raw(schema)}.tenant_domain set revision=revision+1
                  where hostname=${hostname}`.execute(trx);
              }),
            (error: unknown) => {
              assert.match(
                (error as Error).message,
                /attributed operator audit evidence/,
              );
              return true;
            },
          );
        },
      );

      await t.test(
        'the Organization lock is real and transaction scoped',
        async () => {
          const holder = new Pool({
            connectionString: testUrl,
            options: `-c search_path=${schema}`,
            max: 1,
          });
          const waiter = new Pool({
            connectionString: testUrl,
            options: `-c search_path=${schema}`,
            max: 1,
          });
          const held = await holder.connect();
          const blocked = await waiter.connect();
          try {
            await held.query('begin');
            await held.query(
              `select ${schema}.tenant_domain_lock_organization($1::uuid)`,
              [organizationA],
            );
            // A concurrent status mutation must wait while the helper's lock
            // is held by the other transaction.
            await blocked.query('begin');
            await blocked.query("set local lock_timeout = '750ms'");
            await assert.rejects(
              () =>
                blocked.query(
                  `update organization set status='inactive' where id=$1::uuid`,
                  [organizationA],
                ),
              (error: unknown) => {
                assert.match(
                  (error as Error).message,
                  /lock timeout|canceling/i,
                );
                return true;
              },
            );
            await blocked.query('rollback');

            // Releasing the helper's transaction lets the mutation proceed,
            // which proves the lock was transaction scoped rather than
            // function scoped.
            await held.query('rollback');
            await blocked.query('begin');
            await blocked.query("set local lock_timeout = '5s'");
            await blocked.query(
              `update organization set status='inactive' where id=$1::uuid`,
              [suspended],
            );
            await blocked.query('commit');
          } finally {
            held.release();
            blocked.release();
            await holder.end();
            await waiter.end();
          }
          const after = await sql<{ status: string }>`
            select status from organization where id=${suspended}::uuid`.execute(
            database,
          );
          assert.equal(after.rows[0]?.status, 'inactive');
        },
      );

      await t.test(
        'safe-direction operations survive a non-active Organization',
        async () => {
          const hostname = 'safe-direction.example.gov';
          const id = await registerBinding(suspended, hostname);
          await sql`update organization set status='inactive' where id=${suspended}::uuid`.execute(
            database,
          );
          assert.equal(
            (
              await sql<{ status: string }>`
                select status from organization where id=${suspended}::uuid`.execute(
                database,
              )
            ).rows[0]?.status,
            'inactive',
            'the Organization must actually be non-active for this to mean anything',
          );
          // guard_tenant_domain takes the Organization lock but must not
          // reject an existing non-active Organization, so a safe-direction
          // mutation stays possible exactly when it is most needed.
          await database.transaction().execute(async (trx) => {
            await sql`update tenant_domain set role='platform_fallback', revision=revision+1
              where id=${id}::uuid`.execute(trx);
            await sql`insert into tenant_domain_audit(organization_id,tenant_domain_id,hostname,action,actor,
                attribution_version,operator_identity,reason,correlation_id,outcome,
                prior_revision,revision,prior_role,role,prior_verification_state,verification_state,prior_active,active)
              select d.organization_id,d.id,d.hostname,'role_changed',${OPERATOR},
                2,${OPERATOR},${REASON},gen_random_uuid(),'applied',
                d.revision-1,d.revision,'public_alias',d.role,d.verification_state,d.verification_state,d.active,d.active
              from tenant_domain d where d.id=${id}::uuid`.execute(trx);
          });
          const live = await sql<{ role: string }>`
            select role from tenant_domain where id=${id}::uuid`.execute(
            database,
          );
          assert.equal(live.rows[0]?.role, 'platform_fallback');
        },
      );

      await t.test(
        'approval still requires an active Organization',
        async () => {
          const hostname = 'approval-suspended.example.gov';
          const id = await registerBinding(suspended, hostname);
          assert.equal(
            (
              await sql<{ status: string }>`
                select status from organization where id=${suspended}::uuid`.execute(
                database,
              )
            ).rows[0]?.status,
            'inactive',
          );
          await assert.rejects(
            () =>
              sql`insert into tenant_domain_operator_approval(organization_id,tenant_domain_id,operation,
                  expected_revision,expected_hostname,expected_role,expected_verification_state,expected_active,
                  requested_by,approved_by,reason,correlation_id,policy_version)
                select d.organization_id,d.id,'activated',d.revision,d.hostname,d.role,'verified',false,
                  ${OPERATOR},${APPROVER},${REASON},gen_random_uuid(),1
                from tenant_domain d where d.id=${id}::uuid`.execute(database),
            (error: unknown) => {
              assert.match(
                (error as Error).message,
                /requires an active Organization|operator_approval_check|must record the committed binding state/,
              );
              return true;
            },
          );
        },
      );

      await t.test(
        'migration 48 rolls back to the exact prior definitions and reapplies',
        async () => {
          const before = await sql<{ name: string; body: string }>`
            select p.proname as name, pg_get_functiondef(p.oid) as body
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname=${schema} and p.proname like 'guard_tenant_domain%'
            order by p.proname`.execute(database);
          const audited = await sql<{ count: string }>`
            select count(*)::text as count from tenant_domain_audit`.execute(
            database,
          );

          await rollbackHardening();
          const helper = await sql<{ present: boolean }>`
            select to_regprocedure(${`${schema}.tenant_domain_lock_organization(uuid)`}) is not null as present`.execute(
            database,
          );
          assert.equal(
            helper.rows[0]?.present,
            false,
            'rollback drops the helper and therefore the hardening',
          );
          const restored = await sql<{ config: string[] | null }>`
            select p.proconfig as config from pg_proc p
            join pg_namespace n on n.oid=p.pronamespace
            where n.nspname=${schema} and p.proname='guard_tenant_domain'`.execute(
            database,
          );
          assert.equal(
            restored.rows[0]?.config,
            null,
            'the pre-48 definitions carried no pinned search_path',
          );
          // No evidence was lost.
          assert.equal(
            (
              await sql<{
                count: string;
              }>`select count(*)::text as count from tenant_domain_audit`.execute(
                database,
              )
            ).rows[0]?.count,
            audited.rows[0]?.count,
          );
          assert.equal(
            (
              await sql<{
                count: string;
              }>`select count(*)::text as count from tenant_domain_audit where attribution_version=1`.execute(
                database,
              )
            ).rows[0]?.count,
            '0',
            'legacy rows are counted honestly; this fixture wrote none',
          );

          await applyHardening();
          const after = await sql<{ name: string; body: string }>`
            select p.proname as name, pg_get_functiondef(p.oid) as body
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname=${schema} and p.proname like 'guard_tenant_domain%'
            order by p.proname`.execute(database);
          assert.deepEqual(
            after.rows.map((row) => row.name),
            before.rows.map((row) => row.name),
          );
          for (const row of after.rows)
            assert.match(row.body, /SET search_path TO/i);
        },
      );
      await t.test(
        'a missing Organization is still refused, by the foreign key',
        async () => {
          // Deliberate observable change: guard_tenant_domain no longer raises
          // its own message, because it now only takes the lock. Integrity is
          // unchanged -- the foreign key is authoritative and no orphan row
          // can commit.
          const orphan = randomUUID();
          await assert.rejects(
            () =>
              sql`insert into tenant_domain(organization_id,hostname,role)
          values(${orphan}::uuid,'orphan.example.gov','public_alias')`.execute(
                database,
              ),
            (error: unknown) => {
              assert.match(
                (error as Error).message,
                /foreign key|violates/i,
                'the refusal is now a referential-integrity error, not a trigger message',
              );
              return true;
            },
          );
          assert.equal(
            (
              await sql<{ count: string }>`
          select count(*)::text as count from tenant_domain
          where hostname='orphan.example.gov'`.execute(database)
            ).rows[0]?.count,
            '0',
            'no orphan binding may commit',
          );
        },
      );

      await t.test(
        'only the Organization helper is SECURITY DEFINER',
        async () => {
          const rows = await sql<{
            name: string;
            definer: boolean;
            owner: string;
            volatility: string;
          }>`
      select p.proname as name, p.prosecdef as definer,
        pg_get_userbyid(p.proowner) as owner, p.provolatile as volatility
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname=${schema}
        and (p.proname like 'tenant_domain%' or p.proname like 'guard_tenant_domain%'
          or p.proname like 'protect_tenant_domain%' or p.proname='verify_tenant_domain_audited')
      order by p.proname`.execute(database);
          const definers = rows.rows
            .filter((row) => row.definer)
            .map((row) => row.name);
          assert.deepEqual(
            definers,
            ['tenant_domain_lock_organization'],
            'no guard or audit function may become SECURITY DEFINER',
          );
          for (const row of rows.rows)
            assert.equal(
              row.owner,
              'reqro_test_user',
              `${row.name} must be owned by the migration role, never a caller`,
            );
        },
      );

      await t.test(
        'every supported operator path acquires the Organization lock',
        async () => {
          // Behavioural proof of the lock, path by path: another session holds
          // the Organization row exclusively, so any path that takes the
          // Organization lock must block. Ordering is asserted separately at
          // source level, because mid-operation lock introspection is not
          // deterministic.
          const hostname = 'lock-order.example.gov';
          await registerBinding(organizationA, hostname);
          const blocker = new Pool({
            connectionString: testUrl,
            options: `-c search_path=${schema}`,
            max: 1,
          });
          // The bound must be set at connection level: a `SET` issued on
          // one pooled connection does not reach the connection the code
          // under test actually uses, and the operations open their own
          // transactions so no `SET` can be injected into them.
          const bounded = new Kysely<DatabaseSchema>({
            dialect: new PostgresDialect({
              pool: new Pool({
                connectionString: testUrl,
                options: `-c search_path=${schema} -c lock_timeout=900ms`,
                max: 2,
              }),
            }),
          });
          const holder = await blocker.connect();
          try {
            await holder.query('begin');
            await holder.query(
              'select * from organization where id=$1::uuid for update',
              [organizationA],
            );
            for (const [label, run] of [
              [
                'register',
                () =>
                  registerTenantDomain(bounded, {
                    organizationId: organizationA,
                    hostname: 'blocked-register.example.gov',
                    role: 'public_alias',
                    attribution: attribution(),
                    dryRun: false,
                  }),
              ],
              [
                'deactivate',
                () =>
                  deactivateTenantDomain(bounded, {
                    organizationId: organizationA,
                    hostname,
                    expectedRevision: 1,
                    attribution: attribution(),
                    dryRun: false,
                  }),
              ],
            ] as const) {
              await assert.rejects(
                run,
                (error: unknown) => {
                  assert.match(
                    (error as Error).message,
                    /lock timeout|canceling/i,
                    `${label} must block on the Organization lock`,
                  );
                  return true;
                },
                label,
              );
            }
          } finally {
            await holder.query('rollback');
            holder.release();
            await blocker.end();
            await bounded.destroy();
          }
          // Nothing partially applied.
          assert.equal(
            (
              await sql<{ count: string }>`
          select count(*)::text as count from tenant_domain
          where hostname='blocked-register.example.gov'`.execute(database)
            ).rows[0]?.count,
            '0',
          );
        },
      );

      await t.test(
        'the active-status matrix holds through real operations',
        async () => {
          // Safe-direction verbs stay available once the Organization is
          // non-active; reachability-granting verbs do not.
          const hostname = 'matrix.example.gov';
          await registerBinding(organizationA, hostname);
          await sql`update organization set status='inactive' where id=${organizationA}::uuid`.execute(
            database,
          );
          try {
            await assert.rejects(
              () =>
                registerTenantDomain(database, {
                  organizationId: organizationA,
                  hostname: 'matrix-register.example.gov',
                  role: 'public_alias',
                  attribution: attribution(),
                  dryRun: false,
                }),
              /not an active servable target/,
              'register requires an active Organization',
            );
            // issue-challenge is a safe direction and must remain available.
            const issued = await issueTenantDomainChallenge(database, {
              organizationId: organizationA,
              hostname,
              expectedRevision: 1,
              attribution: attribution(),
              dryRun: false,
              lifetimeDays: 14,
            });
            assert.equal(issued.applied, true);
            // And deactivation must get past the Organization gate. This
            // fixture never activated the binding, so the refusal that does
            // come back is about the binding's own state — which is precisely
            // the point: a non-active Organization did not stop it. Were the
            // gate closed, the message would name the Organization instead.
            await assert.rejects(
              () =>
                deactivateTenantDomain(database, {
                  organizationId: organizationA,
                  hostname,
                  expectedRevision: 2,
                  attribution: attribution(),
                  dryRun: true,
                }),
              (error: unknown) => {
                const message = (error as Error).message;
                assert.match(message, /already inactive/);
                assert.doesNotMatch(
                  message,
                  /active servable target/,
                  'deactivation must never be refused for the Organization being non-active',
                );
                return true;
              },
            );
          } finally {
            await sql`update organization set status='active' where id=${organizationA}::uuid`.execute(
              database,
            );
          }
        },
      );
    } finally {
      await db?.destroy();
      if (created) await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  },
);

test('Migration 48 qualifies application objects as public in source', async () => {
  // The disposable suite above rewrites `public.` to its per-test schema, so
  // the literal deployment spelling is asserted here instead.
  const source = await readFile(
    path.resolve(
      __dirname,
      '../../../migrations/20261018000000-harden-tenant-domain-functions.ts',
    ),
    'utf8',
  );
  const up =
    /export async function up[\s\S]*?await sql`([\s\S]*?)`\.execute/.exec(
      source,
    );
  assert.ok(up?.[1]);
  const body = up[1];
  for (const object of [
    'public.organization',
    'public.tenant_domain',
    'public.tenant_domain_audit',
    'public.tenant_domain_operator_approval',
    'public.tenant_domain_lock_organization',
    'public.tenant_domain_challenge_live',
    'public.tenant_domain_approval_live',
  ])
    assert.ok(body.includes(object), `expected ${object} to be qualified`);
  assert.equal(
    [...body.matchAll(/set search_path = pg_catalog, pg_temp as \$\$/g)].length,
    7,
    'six hardened functions plus the helper must pin search_path',
  );
  assert.match(body, /volatile security definer/);
  assert.match(body, /revoke execute on function public\./);
  assert.ok(
    !/grant execute/i.test(body),
    'deployment-specific grants belong to F060.3C-2c-3, not this migration',
  );
});
