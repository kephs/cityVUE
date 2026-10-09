import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import {
  dockerAvailable,
  startSeparatedCluster,
  type SeparatedCluster,
  type SeparatedRole,
} from '../helpers/role-separation-cluster.js';

/**
 * ADR-027 F060.3C-2d. Proves owner/migration/runtime/operator separation on a
 * disposable **PostgreSQL 17** cluster carrying all five identities.
 *
 * The reproducible environment previously collapsed owner, migration and
 * runtime into one superuser. This suite proves each is now genuinely
 * constrained: the owner cannot log in, the migration login holds nothing
 * until it assumes the owner role, objects belong to the owner regardless of
 * which credential applied them, and the runtime can do its job while being
 * unable to escalate, mutate reference data, or reach the operator surface.
 *
 * Docker-gated. A skip is not a pass.
 */
const BOOTSTRAP_ARTIFACT = 'bootstrap-roles.sql';
const RUNTIME_ARTIFACT = 'runtime-role.sql';
const OPERATOR_ARTIFACT = 'operator-role.sql';
const MIGRATION_48 = '20261018000000-harden-tenant-domain-functions.ts';
const MIGRATION_49 = '20261019000000-harden-runtime-reference-locks.ts';

/** The canonical runtime table privilege matrix from F060.3C-2d-B, including
 * every correction the five-technique cross-check produced. Asserted by
 * equality so a drift in either direction fails. */
const RUNTIME_MATRIX: Readonly<Record<string, readonly string[]>> = {
  access_change_set: ['INSERT', 'SELECT'],
  access_permission_delta: ['INSERT', 'SELECT'],
  access_role_ownership: ['INSERT', 'SELECT'],
  activity: ['INSERT', 'SELECT'],
  ai_audit_event: ['INSERT'],
  ai_usage: ['INSERT', 'SELECT', 'UPDATE'],
  answer: ['INSERT', 'SELECT'],
  answer_selected_option: ['INSERT', 'SELECT'],
  attachment: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  attachment_audit: ['INSERT', 'SELECT'],
  attachment_batch: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  category: ['SELECT'],
  department: ['SELECT'],
  division: ['SELECT'],
  issue_default_assignment: ['INSERT', 'SELECT', 'UPDATE'],
  issue_default_assignment_audit: ['INSERT'],
  issue_requester_identity_audit: ['INSERT'],
  issue_requester_identity_policy: ['INSERT', 'SELECT', 'UPDATE'],
  location: ['INSERT', 'SELECT'],
  operational_role: ['SELECT'],
  operational_role_membership: ['SELECT'],
  organization: ['SELECT', 'UPDATE'],
  organization_access_state: ['SELECT'],
  organization_branding: ['INSERT', 'SELECT', 'UPDATE'],
  organization_resident_experience: ['INSERT', 'SELECT', 'UPDATE'],
  participation_area: ['INSERT', 'SELECT', 'UPDATE'],
  participation_area_audit: ['INSERT'],
  participation_collection_audit: ['INSERT'],
  question: ['INSERT', 'SELECT'],
  question_option: ['INSERT', 'SELECT'],
  request_communication: ['INSERT', 'SELECT'],
  request_internal_note: ['INSERT', 'SELECT'],
  request_operational_activity: ['INSERT', 'SELECT'],
  request_tracking_credential: ['INSERT', 'SELECT', 'UPDATE'],
  requester: ['INSERT', 'SELECT'],
  requester_contact: ['INSERT', 'SELECT'],
  requester_history_audit: ['INSERT'],
  resident_alert: ['SELECT'],
  resident_experience_action: ['INSERT', 'SELECT'],
  resident_experience_benefit: ['INSERT', 'SELECT'],
  resident_experience_contact: ['INSERT', 'SELECT'],
  resident_experience_event: ['INSERT', 'SELECT'],
  resident_experience_review_decision: ['INSERT', 'SELECT'],
  resident_experience_review_request: ['INSERT', 'SELECT'],
  resident_experience_revision: ['INSERT', 'SELECT'],
  role: ['INSERT', 'SELECT'],
  role_permission: ['DELETE', 'INSERT', 'SELECT'],
  service_definition: ['INSERT', 'SELECT', 'UPDATE'],
  service_definition_version: ['INSERT', 'SELECT', 'UPDATE'],
  service_participation_audit: ['INSERT'],
  service_request: ['INSERT', 'SELECT', 'UPDATE'],
  service_request_assignment: ['INSERT', 'SELECT', 'UPDATE'],
  service_request_reference_config: ['INSERT', 'SELECT', 'UPDATE'],
  service_request_reference_sequence: ['INSERT', 'SELECT', 'UPDATE'],
  service_request_watcher: ['DELETE', 'INSERT', 'SELECT'],
  staff_department_membership: ['SELECT'],
  staff_division_membership: ['SELECT'],
  staff_identity: ['SELECT'],
  staff_role_assignment: ['INSERT', 'SELECT'],
  tenant_domain: ['SELECT'],
  work_group: ['SELECT'],
  work_group_membership: ['SELECT'],
};

/** The eleven functions the runtime may execute directly. */
const RUNTIME_FUNCTIONS = [
  'effective_access_managers',
  'issue_name_key',
  'lock_active_category',
  'lock_active_department',
  'lock_active_division',
  'lock_assignment_target',
  'lock_department',
  'lock_division',
  'lock_staff',
  'resident_review_authorized',
  'resident_review_contributors',
] as const;

async function migrationSql(file: string, section: 'up' | 'down') {
  const source = await readFile(
    path.resolve(__dirname, '../../../migrations', file),
    'utf8',
  );
  const pattern = new RegExp(
    `export async function ${section}[\\s\\S]*?await sql\`([\\s\\S]*?)\`\\.execute`,
  );
  const body = pattern.exec(source)?.[1];
  if (body === undefined)
    throw new Error(`${file} ${section}() body not found`);
  return body;
}

function connect(
  cluster: SeparatedCluster,
  role: SeparatedRole,
  options?: string,
): Kysely<DatabaseSchema> {
  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool(
        options === undefined
          ? { connectionString: cluster.url(role), max: 4 }
          : { connectionString: cluster.url(role), max: 4, options },
      ),
    }),
  });
}

async function refuses(
  operation: () => Promise<unknown>,
  expected: RegExp,
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.match((error as Error).message, expected);
    return true;
  });
}

const artifact = (name: string) =>
  path.resolve(__dirname, '../../../../deploy/database', name);

test(
  'ADR-027 F060.3C-2d owner, migration, runtime and operator role separation on PostgreSQL 17',
  {
    skip:
      !dockerAvailable() &&
      'Docker unavailable; the role separation proof is skipped',
  },
  async (t) => {
    const cluster = await startSeparatedCluster();
    const admin = connect(cluster, cluster.bootstrap);
    const migrate = connect(cluster, cluster.migrate);
    const runtime = connect(cluster, cluster.runtime);
    const extra: Kysely<DatabaseSchema>[] = [];
    try {
      const organizationId = randomUUID();

      await t.test('the cluster is PostgreSQL 17', async () => {
        const version = await sql<{ major: number }>`
          select (current_setting('server_version_num')::int / 10000) as major`.execute(
          admin,
        );
        assert.equal(version.rows[0]?.major, 17);
      });

      await t.test(
        'the bootstrap artifact establishes exactly the four-role topology',
        async () => {
          const applied = cluster.applySqlFileAs(
            cluster.bootstrap,
            artifact(BOOTSTRAP_ARTIFACT),
            {
              owner: cluster.owner.user,
              migrate: cluster.migrate.user,
              runtime: cluster.runtime.user,
              operator: cluster.operator.user,
              schema: cluster.schema,
              db: cluster.database,
            },
          );
          assert.equal(
            applied.status,
            0,
            `the bootstrap artifact failed: ${applied.stderr || applied.stdout}`,
          );
          assert.ok(!(applied.stdout + applied.stderr).includes('refusing:'));

          // Idempotent: a provisioning rerun is a clean no-op.
          const again = cluster.applySqlFileAs(
            cluster.bootstrap,
            artifact(BOOTSTRAP_ARTIFACT),
            {
              owner: cluster.owner.user,
              migrate: cluster.migrate.user,
              runtime: cluster.runtime.user,
              operator: cluster.operator.user,
              schema: cluster.schema,
              db: cluster.database,
            },
          );
          assert.equal(again.status, 0, again.stderr || again.stdout);

          const roles = await sql<{
            rolname: string;
            rolcanlogin: boolean;
            rolsuper: boolean;
            rolinherit: boolean;
            rolcreaterole: boolean;
            rolcreatedb: boolean;
            rolbypassrls: boolean;
          }>`
            select rolname, rolcanlogin, rolsuper, rolinherit, rolcreaterole,
                   rolcreatedb, rolbypassrls
            from pg_roles where rolname = any(${[
              cluster.owner.user,
              cluster.migrate.user,
              cluster.runtime.user,
              cluster.operator.user,
            ]}) order by rolname`.execute(admin);
          assert.equal(roles.rows.length, 4);
          for (const row of roles.rows) {
            assert.equal(row.rolsuper, false, `${row.rolname} superuser`);
            assert.equal(row.rolcreaterole, false, `${row.rolname} createrole`);
            assert.equal(row.rolcreatedb, false, `${row.rolname} createdb`);
            assert.equal(row.rolbypassrls, false, `${row.rolname} bypassrls`);
            assert.equal(
              row.rolinherit,
              false,
              `${row.rolname} must be NOINHERIT`,
            );
            assert.equal(
              row.rolcanlogin,
              row.rolname !== cluster.owner.user,
              `${row.rolname} login attribute`,
            );
          }

          // Exactly one membership: migrate -> owner.
          const members = await sql<{ member: string; grantee: string }>`
            select (select rolname from pg_roles r where r.oid = m.member) as member,
                   (select rolname from pg_roles r where r.oid = m.roleid) as grantee
            from pg_auth_members m
            where (select rolname from pg_roles r where r.oid = m.member)
                    = any(${[
                      cluster.owner.user,
                      cluster.migrate.user,
                      cluster.runtime.user,
                      cluster.operator.user,
                    ]})
            order by 1`.execute(admin);
          assert.deepEqual(members.rows, [
            { member: cluster.migrate.user, grantee: cluster.owner.user },
          ]);

          // Database and schema ownership, and the PUBLIC posture.
          const posture = await sql<{
            schema_owner: string;
            public_temp: boolean;
            public_create: boolean;
            public_connect: boolean;
            defaults: string;
          }>`
            select pg_get_userbyid(nspowner) as schema_owner,
                   has_database_privilege('public', ${cluster.database}, 'TEMPORARY') as public_temp,
                   has_schema_privilege('public', ${cluster.schema}, 'CREATE') as public_create,
                   has_database_privilege('public', ${cluster.database}, 'CONNECT') as public_connect,
                   (select count(*) from pg_default_acl) as defaults
            from pg_namespace where nspname = ${cluster.schema}`.execute(admin);
          assert.deepEqual(posture.rows, [
            {
              schema_owner: cluster.owner.user,
              public_temp: false,
              public_create: false,
              public_connect: true,
              defaults: '0',
            },
          ]);
        },
      );

      await t.test('the NOLOGIN owner cannot connect', () => {
        // Proven by the connection itself being refused, not by reading the
        // catalog flag.
        const attempt = cluster.applySqlFileAs(
          { user: cluster.owner.user, password: 'irrelevant' },
          artifact(BOOTSTRAP_ARTIFACT),
          {
            owner: cluster.owner.user,
            migrate: cluster.migrate.user,
            runtime: cluster.runtime.user,
            operator: cluster.operator.user,
            schema: cluster.schema,
            db: cluster.database,
          },
        );
        assert.notEqual(attempt.status, 0);
        assert.match(
          attempt.stderr + attempt.stdout,
          /is not permitted to log in/,
        );
      });

      await t.test(
        'the migration login holds nothing until it assumes the owner role',
        async () => {
          // This is the NOINHERIT guarantee, and it is the main reason the
          // topology uses SET ROLE rather than direct ownership.
          await refuses(
            () =>
              sql
                .raw('create table migrate_without_set_role(x int)')
                .execute(migrate),
            /permission denied for schema/,
          );
          const identity = await sql<{
            current_user: string;
            session_user: string;
          }>`select current_user, session_user`.execute(migrate);
          assert.deepEqual(identity.rows, [
            {
              current_user: cluster.migrate.user,
              session_user: cluster.migrate.user,
            },
          ]);
        },
      );

      await t.test(
        'with SET ROLE the migration login applies all 49 migrations, owned by the owner',
        async () => {
          const assumed = connect(
            cluster,
            cluster.migrate,
            '-c role=reqro_owner',
          );
          extra.push(assumed);
          const identity = await sql<{
            current_user: string;
            session_user: string;
          }>`select current_user, session_user`.execute(assumed);
          // current_user is the owner, so objects belong to the owner;
          // session_user remains the migration login, so the audit trail
          // survives the assumption.
          assert.deepEqual(identity.rows, [
            {
              current_user: cluster.owner.user,
              session_user: cluster.migrate.user,
            },
          ]);

          const folder = path.resolve(__dirname, '../../migrations');
          const files = (await readdir(folder))
            .filter((file) => file.endsWith('.js'))
            .sort();
          assert.equal(files.length, 47);
          for (const file of files) {
            const migration = (await import(
              path
                .join(folder, file)
                .replace(/\\/g, '/')
                .replace(/^/, 'file:///')
            )) as { up: (db: Kysely<DatabaseSchema>) => Promise<void> };
            await assumed.transaction().execute(migration.up);
          }
          await sql
            .raw(await migrationSql(MIGRATION_48, 'up'))
            .execute(assumed);
          await sql
            .raw(await migrationSql(MIGRATION_49, 'up'))
            .execute(assumed);

          // Every application object belongs to the owner, and nothing to the
          // migration login.
          const owners = await sql<{ owner: string; objects: string }>`
            select pg_get_userbyid(c.relowner) as owner, count(*) as objects
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = ${cluster.schema} and c.relkind in ('r','v','m','S','p')
            group by 1 order by 1`.execute(admin);
          assert.deepEqual(
            owners.rows.map((row) => row.owner),
            [cluster.owner.user],
          );
          assert.ok(Number(owners.rows[0]?.objects ?? '0') > 50);

          // Extension functions are excluded: pgcrypto belongs to whichever
          // identity installed the extension, which is the bootstrap admin,
          // not the application owner. Only APPLICATION functions are the
          // migration's output.
          const functionOwners = await sql<{ owner: string }>`
            select distinct pg_get_userbyid(p.proowner) as owner
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = ${cluster.schema}
              and not exists (select 1 from pg_depend d
                              where d.objid = p.oid and d.deptype = 'e')`.execute(
            admin,
          );
          assert.deepEqual(functionOwners.rows, [
            { owner: cluster.owner.user },
          ]);
        },
      );

      await t.test(
        'the runtime and operator own nothing and cannot escalate',
        async () => {
          const owned = await sql<{ rows: string }>`
            select count(*) as rows from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            join pg_roles r on r.oid = c.relowner
            where n.nspname = ${cluster.schema}
              and r.rolname = any(${[cluster.runtime.user, cluster.operator.user]})`.execute(
            admin,
          );
          assert.deepEqual(owned.rows, [{ rows: '0' }]);

          for (const target of [
            cluster.owner.user,
            cluster.migrate.user,
            cluster.operator.user,
          ])
            await refuses(
              () => sql.raw(`set role ${target}`).execute(runtime),
              /permission denied to set role/,
            );
          const operatorSession = connect(cluster, cluster.operator);
          extra.push(operatorSession);
          for (const target of [
            cluster.owner.user,
            cluster.migrate.user,
            cluster.runtime.user,
          ])
            await refuses(
              () => sql.raw(`set role ${target}`).execute(operatorSession),
              /permission denied to set role/,
            );
        },
      );

      await t.test(
        'the runtime and operator grant artifacts apply as the owner',
        async () => {
          for (const [file, variables] of [
            [
              RUNTIME_ARTIFACT,
              { runtime: cluster.runtime.user, schema: cluster.schema },
            ],
            [
              OPERATOR_ARTIFACT,
              { operator: cluster.operator.user, schema: cluster.schema },
            ],
          ] as const) {
            const applied = cluster.applySqlFileAs(
              cluster.migrate,
              artifact(file),
              variables,
              cluster.owner.user,
            );
            assert.equal(
              applied.status,
              0,
              `${file} failed: ${applied.stderr || applied.stdout}`,
            );
            assert.ok(!(applied.stdout + applied.stderr).includes('refusing:'));
            // Idempotent.
            const again = cluster.applySqlFileAs(
              cluster.migrate,
              artifact(file),
              variables,
              cluster.owner.user,
            );
            assert.equal(again.status, 0, again.stderr || again.stdout);
          }
        },
      );

      await t.test(
        'the runtime table privilege surface is exactly the canonical matrix',
        async () => {
          const exposure = await sql<{ relname: string; privilege: string }>`
            select c.relname, p.privilege
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as p(privilege)
            where n.nspname = ${cluster.schema}
              and c.relkind in ('r','p','v','m','f')
              and has_table_privilege(${cluster.runtime.user}, c.oid, p.privilege)
            order by c.relname, p.privilege`.execute(admin);
          const actual: Record<string, string[]> = {};
          for (const row of exposure.rows)
            (actual[row.relname] ??= []).push(row.privilege);
          // Equality in both directions: a missing grant and a surplus grant
          // both fail, and a table added later is covered without being named
          // in a forbidden list.
          assert.deepEqual(actual, RUNTIME_MATRIX);
          assert.equal(Object.keys(actual).length, 62);
        },
      );

      await t.test(
        'the runtime function EXECUTE surface is exactly eleven direct grants',
        async () => {
          const granted = await sql<{ proname: string }>`
            select distinct p.proname
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            cross join lateral aclexplode(p.proacl) a
            where n.nspname = ${cluster.schema}
              and a.privilege_type = 'EXECUTE'
              and a.grantee = (select r.oid from pg_roles r
                               where r.rolname = ${cluster.runtime.user})
            order by 1`.execute(admin);
          assert.deepEqual(
            granted.rows.map((row) => row.proname),
            [...RUNTIME_FUNCTIONS],
          );
          // The owner-only and operator-only functions are not among them.
          for (const forbidden of [
            'advance_access_revision',
            'invalidate_access_revision',
            'tenant_domain_lock_organization',
            'protect_category_identity',
          ])
            assert.ok(
              !granted.rows.some((row) => row.proname === forbidden),
              `${forbidden} must not be granted to the runtime`,
            );
        },
      );

      await t.test(
        'Category carries UPDATE on id alone, and identity mutation is impossible',
        async () => {
          const posture = await sql<{
            table_update: boolean;
            id_update: boolean;
            others: string | null;
          }>`
            select has_table_privilege(${cluster.runtime.user}, 'category', 'UPDATE') as table_update,
                   has_column_privilege(${cluster.runtime.user}, 'category', 'id', 'UPDATE') as id_update,
                   (select string_agg(a.attname, ',' order by a.attname)
                      from pg_attribute a
                      where a.attrelid = 'category'::regclass and a.attnum > 0
                        and not a.attisdropped and a.attname <> 'id'
                        and has_column_privilege(${cluster.runtime.user}, a.attrelid, a.attname, 'UPDATE')) as others`.execute(
            admin,
          );
          assert.deepEqual(posture.rows, [
            { table_update: false, id_update: true, others: null },
          ]);

          // Fixtures, created by the owner.
          const assumed = connect(
            cluster,
            cluster.migrate,
            '-c role=reqro_owner',
          );
          extra.push(assumed);
          const departmentId = randomUUID();
          const categoryId = randomUUID();
          await sql`insert into organization(id,name,short_name,slug,status,default_business_timezone)
            values (${organizationId}::uuid,'Role probe','Probe',${organizationId},'active','UTC')`.execute(
            assumed,
          );
          await sql`insert into department(id,organization_id,name,status,display_order)
            values (${departmentId}::uuid,${organizationId}::uuid,'Probe dept','active',1)`.execute(
            assumed,
          );
          await sql`insert into category(id,organization_id,department_id,name,icon_key,status,display_order)
            values (${categoryId}::uuid,${organizationId}::uuid,${departmentId}::uuid,'Probe cat','probe-icon','active',1)`.execute(
            assumed,
          );

          const digestBefore = await sql<{ digest: string }>`
            select md5(string_agg(category::text, '|' order by id::text)) as digest
            from category`.execute(admin);
          // The same-value assignment is permitted and changes nothing.
          await sql`update category set id=id where id=${categoryId}::uuid`.execute(
            runtime,
          );
          const digestAfter = await sql<{ digest: string }>`
            select md5(string_agg(category::text, '|' order by id::text)) as digest
            from category`.execute(admin);
          assert.deepEqual(digestAfter.rows, digestBefore.rows);
          assert.ok(digestBefore.rows[0]?.digest);

          // A real identity change is refused by the Migration 49 trigger.
          await refuses(
            () =>
              sql`update category set id=${randomUUID()}::uuid where id=${categoryId}::uuid`.execute(
                runtime,
              ),
            /Category identity is immutable/,
          );
          // Everything else is refused at the privilege layer.
          for (const statement of [
            "update category set status='inactive'",
            "update category set name='renamed'",
            'update category set department_id=gen_random_uuid()',
            'update category set display_order=99',
            "update category set icon_key='other'",
            'delete from category',
          ])
            await refuses(
              () => sql.raw(statement).execute(runtime),
              /permission denied for table category/,
            );
        },
      );

      await t.test(
        'access state carries UPDATE on bootstrap_established alone, and the revision chain still advances',
        async () => {
          const posture = await sql<{
            table_update: boolean;
            bootstrap: boolean;
            others: string | null;
          }>`
            select has_table_privilege(${cluster.runtime.user}, 'organization_access_state', 'UPDATE') as table_update,
                   has_column_privilege(${cluster.runtime.user}, 'organization_access_state', 'bootstrap_established', 'UPDATE') as bootstrap,
                   (select string_agg(a.attname, ',' order by a.attname)
                      from pg_attribute a
                      where a.attrelid = 'organization_access_state'::regclass
                        and a.attnum > 0 and not a.attisdropped
                        and a.attname <> 'bootstrap_established'
                        and has_column_privilege(${cluster.runtime.user}, a.attrelid, a.attname, 'UPDATE')) as others`.execute(
            admin,
          );
          assert.deepEqual(posture.rows, [
            { table_update: false, bootstrap: true, others: null },
          ]);

          // The decisive proof: a role write must still advance the revision,
          // through the Migration 49 hardened trigger chain, even though the
          // runtime holds no UPDATE on the maintained columns and no EXECUTE
          // on either revision function.
          const before = await sql<{ revision: string }>`
            select authorization_revision::text as revision
            from organization_access_state where organization_id=${organizationId}::uuid`.execute(
            admin,
          );
          await sql`insert into role(id,organization_id,name)
            values (${randomUUID()}::uuid,${organizationId}::uuid,${`probe-${randomUUID()}`})`.execute(
            runtime,
          );
          const after = await sql<{ revision: string }>`
            select authorization_revision::text as revision
            from organization_access_state where organization_id=${organizationId}::uuid`.execute(
            admin,
          );
          assert.notEqual(after.rows[0]?.revision, before.rows[0]?.revision);
          assert.ok(
            Number(after.rows[0]?.revision) > Number(before.rows[0]?.revision),
          );

          // And a direct attempt on the maintained columns is still refused.
          for (const statement of [
            'update organization_access_state set authorization_revision=999',
            'update organization_access_state set mutation_txid=1',
            'update organization_access_state set updated_at=now()',
          ])
            await refuses(
              () => sql.raw(statement).execute(runtime),
              /permission denied for table organization_access_state/,
            );
          await refuses(
            () =>
              sql`select advance_access_revision(${organizationId}::uuid)`.execute(
                runtime,
              ),
            /permission denied for function/,
          );
        },
      );

      await t.test('the runtime can exercise its lock helpers', async () => {
        const verdicts = await sql<Record<string, boolean>>`
          select lock_active_department(${organizationId}::uuid, (select id from department limit 1)) as dept,
                 lock_department(${organizationId}::uuid, (select id from department limit 1)) as dept_any,
                 lock_active_category(${organizationId}::uuid, (select id from category limit 1)) as cat`.execute(
          runtime,
        );
        assert.deepEqual(verdicts.rows, [
          { dept: true, dept_any: true, cat: true },
        ]);
        await refuses(
          () =>
            sql`select lock_assignment_target(${organizationId}::uuid, 'bogus', ${randomUUID()}::uuid)`.execute(
              runtime,
            ),
          /Unknown assignment target type/,
        );
      });

      await t.test(
        'the runtime cannot perform DDL or disable protections',
        async () => {
          const denied: readonly (readonly [string, RegExp])[] = [
            ['create table runtime_ddl(x int)', /permission denied for schema/],
            [
              "create function runtime_fn() returns int language sql as 'select 1'",
              /permission denied for schema/,
            ],
            [
              'create type runtime_type as (x int)',
              /permission denied for schema/,
            ],
            ['create schema runtime_schema', /permission denied for database/],
            [
              'alter table category add column probe int',
              /must be owner of table/,
            ],
            ['drop table category', /must be owner of table/],
            [
              'alter table service_request disable trigger all',
              /must be owner of table/,
            ],
            ['truncate activity', /permission denied for table/],
            ['truncate service_request', /permission denied for table/],
            [
              'create role runtime_escape login',
              /permission denied to create role/,
            ],
            [
              "set session_replication_role = 'replica'",
              /permission denied to set parameter/,
            ],
          ];
          for (const [statement, expected] of denied)
            await refuses(() => sql.raw(statement).execute(runtime), expected);
        },
      );

      await t.test(
        'the operator boundary is unchanged and the two roles are mutually isolated',
        async () => {
          // The operator keeps exactly its F060.3C-2c-3 surface.
          const operatorTables = await sql<{
            relname: string;
            privilege: string;
          }>`
            select c.relname, p.privilege
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as p(privilege)
            where n.nspname = ${cluster.schema} and c.relkind = 'r'
              and has_table_privilege(${cluster.operator.user}, c.oid, p.privilege)
            order by c.relname, p.privilege`.execute(admin);
          assert.deepEqual(operatorTables.rows, [
            { relname: 'tenant_domain', privilege: 'INSERT' },
            { relname: 'tenant_domain', privilege: 'SELECT' },
            { relname: 'tenant_domain', privilege: 'UPDATE' },
            { relname: 'tenant_domain_audit', privilege: 'INSERT' },
            { relname: 'tenant_domain_audit', privilege: 'SELECT' },
            { relname: 'tenant_domain_operator_approval', privilege: 'INSERT' },
            { relname: 'tenant_domain_operator_approval', privilege: 'SELECT' },
            {
              relname: 'tenant_domain_verification_attempt',
              privilege: 'INSERT',
            },
          ]);
          const operatorFunctions = await sql<{ signature: string }>`
            select p.oid::regprocedure::text as signature
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            cross join lateral aclexplode(p.proacl) a
            where n.nspname = ${cluster.schema} and a.privilege_type = 'EXECUTE'
              and a.grantee = (select r.oid from pg_roles r
                               where r.rolname = ${cluster.operator.user})
            order by 1`.execute(admin);
          assert.deepEqual(operatorFunctions.rows, [
            { signature: 'tenant_domain_lock_organization(uuid)' },
          ]);

          // The runtime reaches no operator control-plane table, and may only
          // read tenant_domain.
          for (const table of [
            'tenant_domain_audit',
            'tenant_domain_operator_approval',
            'tenant_domain_verification_attempt',
          ]) {
            const exposure = await sql<{ privilege: string }>`
              select p.privilege
              from unnest(array['SELECT','INSERT','UPDATE','DELETE']) as p(privilege)
              where has_table_privilege(${cluster.runtime.user},
                ${`${cluster.schema}.${table}`}, p.privilege)`.execute(admin);
            assert.deepEqual(
              exposure.rows,
              [],
              `${table} must stay operator only`,
            );
          }
          const tenantDomainWrites = await sql<{ privilege: string }>`
            select p.privilege
            from unnest(array['INSERT','UPDATE','DELETE']) as p(privilege)
            where has_table_privilege(${cluster.runtime.user},
              ${`${cluster.schema}.tenant_domain`}, p.privilege)`.execute(
            admin,
          );
          assert.deepEqual(tenantDomainWrites.rows, []);

          // The operator reaches none of the runtime's application surface.
          const operatorReach = await sql<{ relname: string }>`
            select c.relname from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = ${cluster.schema} and c.relkind = 'r'
              and c.relname not like 'tenant_domain%'
              and has_table_privilege(${cluster.operator.user}, c.oid, 'SELECT')
            order by 1`.execute(admin);
          assert.deepEqual(operatorReach.rows, []);
          // And the operator cannot execute a runtime lock helper.
          const operatorSession = connect(cluster, cluster.operator);
          extra.push(operatorSession);
          await refuses(
            () =>
              sql`select lock_staff(${organizationId}::uuid, ${randomUUID()}::uuid)`.execute(
                operatorSession,
              ),
            /permission denied for function/,
          );
        },
      );

      await t.test(
        'a future table created by the owner is unreachable by both constrained roles',
        async () => {
          const assumed = connect(
            cluster,
            cluster.migrate,
            '-c role=reqro_owner',
          );
          extra.push(assumed);
          await sql
            .raw('create table future_object(id uuid primary key)')
            .execute(assumed);
          try {
            const defaults = await sql<{ rows: string }>`
              select count(*) as rows from pg_default_acl`.execute(admin);
            assert.deepEqual(defaults.rows, [{ rows: '0' }]);
            for (const session of [
              runtime,
              connect(cluster, cluster.operator),
            ]) {
              if (session !== runtime) extra.push(session);
              for (const statement of [
                'select 1 from future_object limit 1',
                'insert into future_object(id) values (gen_random_uuid())',
                'update future_object set id = id',
                'delete from future_object',
              ])
                await refuses(
                  () => sql.raw(statement).execute(session),
                  /permission denied for table future_object/,
                );
            }
          } finally {
            await sql.raw('drop table future_object').execute(assumed);
          }
        },
      );

      await t.test(
        'the runtime credential cannot run migrations and the owner role is not reachable through it',
        async () => {
          // A migration attempted with the runtime credential fails before any
          // DDL, because the runtime is not a member of the owner.
          await refuses(
            () => sql.raw(`set role ${cluster.owner.user}`).execute(runtime),
            /permission denied to set role/,
          );
          await refuses(
            () =>
              sql
                .raw('create table runtime_migration_attempt(x int)')
                .execute(runtime),
            /permission denied for schema/,
          );
          // And the migration login cannot read application data it was never
          // granted, so it is not a back door into the runtime surface.
          await refuses(
            () =>
              sql.raw('select 1 from service_request limit 1').execute(migrate),
            /permission denied for table/,
          );
        },
      );
    } finally {
      for (const session of extra)
        await session.destroy().catch(() => undefined);
      await runtime.destroy().catch(() => undefined);
      await migrate.destroy().catch(() => undefined);
      await admin.destroy().catch(() => undefined);
      await cluster.destroy();
    }
  },
);
