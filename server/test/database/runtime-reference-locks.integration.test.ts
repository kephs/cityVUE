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
  startControlledCluster,
  type ControlledCluster,
} from '../helpers/operator-role-cluster.js';

/**
 * ADR-027 F060.3C-2d. Behavioural proof for Migration 49 against a disposable
 * **PostgreSQL 17** cluster this suite owns, with a genuinely constrained
 * non-owner role standing in for the future runtime role.
 *
 * What it proves, in the reviewers' terms:
 *
 * - Migration 49 applies, rolls back and reapplies, with the exact catalog
 *   properties the design specifies and no data loss.
 * - `category.id` is independently immutable, so the one lock-only column
 *   privilege the design accepts confers no authority.
 * - A role holding only `SELECT` plus `UPDATE (id)` on Category can take both
 *   the single-relation and the multi-relation `FOR SHARE OF` locks the hot
 *   request paths use, and can mutate nothing.
 * - Each retained helper's lock genuinely blocks the competing mutation.
 * - The invariants that carry the three approved lock removals hold without
 *   those locks.
 * - Neither the helpers nor the hardened revision functions can be redirected
 *   by a hostile `search_path` or `pg_temp` decoy, and the F060.3C-2c-3
 *   operator boundary is unchanged.
 *
 * Docker-gated. A skip is not a pass.
 */
const MIGRATION_48 = '20261018000000-harden-tenant-domain-functions.ts';
const MIGRATION_49 = '20261019000000-harden-runtime-reference-locks.ts';

const HELPERS = [
  'lock_active_category',
  'lock_active_department',
  'lock_active_division',
  'lock_assignment_target',
  'lock_department',
  'lock_division',
  'lock_staff',
] as const;

/** Reads a migration's own SQL text. The cluster's application schema is
 * `public`, so the literal deployment qualification is exercised rather than
 * rewritten. */
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
  cluster: ControlledCluster,
  role: { user: string; password: string },
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

test(
  'ADR-027 F060.3C-2d Migration 49 runtime reference locks on PostgreSQL 17',
  {
    skip: !dockerAvailable() && 'Docker unavailable; the lock proof is skipped',
  },
  async (t) => {
    const cluster = await startControlledCluster();
    const owner = connect(cluster, cluster.owner);
    /** Stands in for the future runtime role: a constrained non-owner login
     * that owns nothing. */
    const runtime = connect(cluster, cluster.operator);
    const extra: Kysely<DatabaseSchema>[] = [];
    try {
      const organizationId = randomUUID();
      const departmentId = randomUUID();
      const divisionId = randomUUID();
      const categoryId = randomUUID();
      const staffId = randomUUID();
      const operationalRoleId = randomUUID();
      const workGroupId = randomUUID();
      const definitionId = randomUUID();

      await t.test('the cluster is PostgreSQL 17', async () => {
        const version = await sql<{ major: number }>`
          select (current_setting('server_version_num')::int / 10000) as major`.execute(
          owner,
        );
        assert.equal(version.rows[0]?.major, 17);
      });

      await t.test(
        'the schema applies as a non-superuser owner through Migration 48',
        async () => {
          const folder = path.resolve(__dirname, '../../migrations');
          const files = (await readdir(folder))
            .filter((file) => file.endsWith('.js'))
            .sort();
          assert.equal(files.length, 50);
          for (const file of files) {
            const migration = (await import(
              path
                .join(folder, file)
                .replace(/\\/g, '/')
                .replace(/^/, 'file:///')
            )) as { up: (db: Kysely<DatabaseSchema>) => Promise<void> };
            await owner.transaction().execute(migration.up);
          }
          await sql.raw(await migrationSql(MIGRATION_48, 'up')).execute(owner);
          const before = await sql<{ definers: string }>`
            select count(*) as definers from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef`.execute(owner);
          assert.deepEqual(before.rows, [{ definers: '1' }]);
        },
      );

      await t.test('fixtures', async () => {
        await owner
          .insertInto('organization')
          .values({
            id: organizationId,
            name: 'Runtime lock probe',
            short_name: 'Probe',
            slug: organizationId,
            status: 'active',
            default_business_timezone: 'UTC',
          })
          .execute();
        await sql`insert into department(id,organization_id,name,status,display_order)
          values (${departmentId}::uuid,${organizationId}::uuid,'Probe dept','active',1)`.execute(
          owner,
        );
        await sql`insert into division(id,organization_id,department_id,name,status,display_order)
          values (${divisionId}::uuid,${organizationId}::uuid,${departmentId}::uuid,'Probe div','active',1)`.execute(
          owner,
        );
        await sql`insert into category(id,organization_id,department_id,division_id,name,icon_key,status,display_order)
          values (${categoryId}::uuid,${organizationId}::uuid,${departmentId}::uuid,${divisionId}::uuid,'Probe cat','probe-icon','active',1)`.execute(
          owner,
        );
        await sql`insert into staff_identity(id,organization_id,display_name,active)
          values (${staffId}::uuid,${organizationId}::uuid,'Probe staff',true)`.execute(
          owner,
        );
        await sql`insert into operational_role(id,organization_id,department_id,name,active)
          values (${operationalRoleId}::uuid,${organizationId}::uuid,${departmentId}::uuid,'Probe role',true)`.execute(
          owner,
        );
        await sql`insert into work_group(id,organization_id,department_id,name,active)
          values (${workGroupId}::uuid,${organizationId}::uuid,${departmentId}::uuid,'Probe group',true)`.execute(
          owner,
        );
        // A Service Definition referencing the Category, which is both the
        // third relation for the multi-relation lock proof and the referencing
        // row that makes the Category undeletable.
        await sql`insert into service_definition(id,organization_id,category_id,service_key,status,availability)
          values (${definitionId}::uuid,${organizationId}::uuid,${categoryId}::uuid,'probe-key','active','INTERNAL_AND_EXTERNAL')`.execute(
          owner,
        );
      });

      await t.test(
        'Migration 49 applies with exactly the designed catalog properties',
        async () => {
          await sql.raw(await migrationSql(MIGRATION_49, 'up')).execute(owner);

          const definers = await sql<{ definers: string }>`
            select count(*) as definers from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef`.execute(owner);
          // One from Migration 48, seven helpers, two hardened revision
          // functions. protect_category_identity is SECURITY INVOKER and is
          // deliberately not part of this surface.
          assert.deepEqual(definers.rows, [{ definers: '10' }]);

          const properties = await sql<{
            proname: string;
            prosecdef: boolean;
            provolatile: string;
            proconfig: string[] | null;
            owner: string;
            result: string;
            public_execute: boolean;
          }>`
            select p.proname, p.prosecdef, p.provolatile, p.proconfig,
                   pg_get_userbyid(p.proowner) as owner,
                   pg_get_function_result(p.oid) as result,
                   coalesce(p.proacl::text like '%,=X/%' or p.proacl::text like '{=X/%', false) as public_execute
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and (p.proname = any(${[...HELPERS]})
                or p.proname in ('advance_access_revision','invalidate_access_revision','protect_category_identity'))
            order by p.proname`.execute(owner);
          assert.equal(properties.rows.length, 10);
          for (const row of properties.rows) {
            assert.equal(
              row.provolatile,
              'v',
              `${row.proname} must be VOLATILE`,
            );
            assert.equal(
              row.owner,
              cluster.owner.user,
              `${row.proname} must be owned by the schema owner`,
            );
            assert.deepEqual(
              row.proconfig,
              row.proname === 'protect_category_identity'
                ? null
                : ['search_path=pg_catalog, pg_temp'],
              `${row.proname} search_path configuration`,
            );
            assert.equal(
              row.public_execute,
              false,
              `${row.proname} must not retain PUBLIC EXECUTE`,
            );
            assert.equal(
              row.prosecdef,
              row.proname !== 'protect_category_identity',
              `${row.proname} security mode`,
            );
          }
          // Every helper returns a boolean and nothing else.
          for (const row of properties.rows.filter((entry) =>
            (HELPERS as readonly string[]).includes(entry.proname),
          ))
            assert.equal(row.result, 'boolean', `${row.proname} return type`);
        },
      );

      await t.test('the helpers answer only true or false', async () => {
        const verdicts = await sql<Record<string, boolean>>`
          select lock_active_category(${organizationId}::uuid, ${categoryId}::uuid) as a,
                 lock_active_department(${organizationId}::uuid, ${departmentId}::uuid) as b,
                 lock_department(${organizationId}::uuid, ${departmentId}::uuid) as c,
                 lock_active_division(${organizationId}::uuid, ${departmentId}::uuid, ${divisionId}::uuid) as d,
                 lock_division(${organizationId}::uuid, ${departmentId}::uuid, ${divisionId}::uuid) as e,
                 lock_staff(${organizationId}::uuid, ${staffId}::uuid) as f,
                 lock_assignment_target(${organizationId}::uuid, 'staff', ${staffId}::uuid) as g,
                 lock_assignment_target(${organizationId}::uuid, 'role', ${operationalRoleId}::uuid) as h,
                 lock_assignment_target(${organizationId}::uuid, 'group', ${workGroupId}::uuid) as i,
                 lock_active_category(${organizationId}::uuid, ${randomUUID()}::uuid) as missing,
                 lock_staff(${organizationId}::uuid, ${randomUUID()}::uuid) as absent_staff`.execute(
          owner,
        );
        assert.deepEqual(verdicts.rows, [
          {
            a: true,
            b: true,
            c: true,
            d: true,
            e: true,
            f: true,
            g: true,
            h: true,
            i: true,
            missing: false,
            absent_staff: false,
          },
        ]);
        // An unrecognised target type raises rather than answering false, so a
        // typo can never be read as "target unavailable".
        await refuses(
          () =>
            sql`select lock_assignment_target(${organizationId}::uuid, 'bogus', ${staffId}::uuid)`.execute(
              owner,
            ),
          /Unknown assignment target type/,
        );
      });

      await t.test(
        'an inactive reference row is reported false by the active variants and true by the existence variants',
        async () => {
          await sql`update department set status='inactive' where id=${departmentId}::uuid`.execute(
            owner,
          );
          try {
            const verdicts = await sql<{
              active_department: boolean;
              department: boolean;
              active_category: boolean;
            }>`
              select lock_active_department(${organizationId}::uuid, ${departmentId}::uuid) as active_department,
                     lock_department(${organizationId}::uuid, ${departmentId}::uuid) as department,
                     lock_active_category(${organizationId}::uuid, ${categoryId}::uuid) as active_category`.execute(
              owner,
            );
            // The existence variant must NOT have acquired a status rule, and
            // the Category helper fails because its Department is no longer
            // active -- exactly the predicate its call site always required.
            assert.deepEqual(verdicts.rows, [
              {
                active_department: false,
                department: true,
                active_category: false,
              },
            ]);
          } finally {
            await sql`update department set status='active' where id=${departmentId}::uuid`.execute(
              owner,
            );
          }
        },
      );

      await t.test(
        'Category identity is immutable while every other Category field stays mutable',
        async () => {
          const before = await sql<{ digest: string }>`
            select md5(category::text) as digest from category
            where id=${categoryId}::uuid`.execute(owner);

          // A same-value assignment is permitted and changes nothing.
          await sql`update category set id=id where id=${categoryId}::uuid`.execute(
            owner,
          );
          // Any real change is refused, even for the schema owner.
          await refuses(
            () =>
              sql`update category set id=${randomUUID()}::uuid where id=${categoryId}::uuid`.execute(
                owner,
              ),
            /Category identity is immutable/,
          );
          const after = await sql<{ digest: string }>`
            select md5(category::text) as digest from category
            where id=${categoryId}::uuid`.execute(owner);
          assert.deepEqual(after.rows, before.rows);
          assert.ok(before.rows[0]?.digest);

          // Ordinary Category fields were deliberately NOT made immutable.
          await sql`update category set display_order=7 where id=${categoryId}::uuid`.execute(
            owner,
          );
          await sql`update category set status='inactive' where id=${categoryId}::uuid`.execute(
            owner,
          );
          await sql`update category set status='active', display_order=1 where id=${categoryId}::uuid`.execute(
            owner,
          );
          const restored = await sql<{ digest: string }>`
            select md5(category::text) as digest from category
            where id=${categoryId}::uuid`.execute(owner);
          // updated_at is not maintained by a trigger here, so the row text is
          // unchanged after restoring the two fields.
          assert.deepEqual(restored.rows, before.rows);
        },
      );

      await t.test(
        'a role holding only SELECT and UPDATE (id) on Category can lock it and mutate nothing',
        async () => {
          const grant = (clause: string) =>
            sql
              .raw(`grant ${clause} to ${cluster.operator.user}`)
              .execute(owner);
          await grant('usage on schema public');
          await grant('select on category');
          await grant('update (id) on category');
          // organization and service_request are genuinely mutated by the
          // runtime, so their UPDATE is a real mutation grant -- and it is
          // also what lets the multi-relation OF lock include them. Category
          // is the only one whose UPDATE exists purely for locking.
          await grant('select, update on organization');
          await grant('select, update on service_definition');
          await grant('select on department');
          await grant('select on division');

          // 3 and 4: the exact privilege posture the design accepts.
          const posture = await sql<{
            table_update: boolean;
            id_update: boolean;
            name_update: boolean;
            status_update: boolean;
            department_update: boolean;
            division_update: boolean;
            order_update: boolean;
            icon_update: boolean;
            delete_allowed: boolean;
          }>`
            select has_table_privilege(${cluster.operator.user}, 'public.category', 'UPDATE') as table_update,
                   has_column_privilege(${cluster.operator.user}, 'public.category', 'id', 'UPDATE') as id_update,
                   has_column_privilege(${cluster.operator.user}, 'public.category', 'name', 'UPDATE') as name_update,
                   has_column_privilege(${cluster.operator.user}, 'public.category', 'status', 'UPDATE') as status_update,
                   has_column_privilege(${cluster.operator.user}, 'public.category', 'department_id', 'UPDATE') as department_update,
                   has_column_privilege(${cluster.operator.user}, 'public.category', 'division_id', 'UPDATE') as division_update,
                   has_column_privilege(${cluster.operator.user}, 'public.category', 'display_order', 'UPDATE') as order_update,
                   has_column_privilege(${cluster.operator.user}, 'public.category', 'icon_key', 'UPDATE') as icon_update,
                   has_table_privilege(${cluster.operator.user}, 'public.category', 'DELETE') as delete_allowed`.execute(
            owner,
          );
          assert.deepEqual(posture.rows, [
            {
              table_update: false,
              id_update: true,
              name_update: false,
              status_update: false,
              department_update: false,
              division_update: false,
              order_update: false,
              icon_update: false,
              delete_allowed: false,
            },
          ]);
          // Every other Category column must also be non-updatable, asserted
          // as a complement so a new column is covered without being named.
          const updatable = await sql<{ attname: string }>`
            select a.attname from pg_attribute a
            join pg_class c on c.oid = a.attrelid
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname='public' and c.relname='category'
              and a.attnum > 0 and not a.attisdropped
              and has_column_privilege(${cluster.operator.user}, c.oid, a.attnum, 'UPDATE')
            order by a.attname`.execute(owner);
          assert.deepEqual(updatable.rows, [{ attname: 'id' }]);

          // 1: the single-relation lock the default-assignment preflight uses.
          const single = await sql<{ department_id: string }>`
            select department_id from category
            where organization_id=${organizationId}::uuid and id=${categoryId}::uuid
            for share`.execute(runtime);
          assert.equal(single.rows[0]?.department_id, departmentId);

          // 2: the representative multi-relation form, with three relations
          // locked in one statement by an OF clause. The hot request paths
          // name `request, category, organization`; this uses
          // `definition, category, organization` because building a valid
          // service_request fixture requires a long chain of NOT NULL columns
          // that have nothing to do with the privilege question, while the
          // locking mechanics and the privilege check are identical --
          // service_definition, like service_request, carries a genuine
          // runtime UPDATE grant.
          const multi = await sql<{ locked: number }>`
            select 1 as locked
            from service_definition definition
            join organization on organization.id = definition.organization_id
            join category on category.id = definition.category_id
              and category.organization_id = definition.organization_id
            where definition.id=${definitionId}::uuid
            for share of definition, category, organization`.execute(runtime);
          assert.deepEqual(multi.rows, [{ locked: 1 }]);

          // 6 and 8: nothing can be mutated.
          await refuses(
            () =>
              sql`update category set id=${randomUUID()}::uuid where id=${categoryId}::uuid`.execute(
                runtime,
              ),
            /Category identity is immutable/,
          );
          for (const statement of [
            "update category set status='inactive'",
            "update category set name='renamed'",
            'update category set display_order=99',
            "update category set icon_key='other-icon'",
            'update category set department_id=gen_random_uuid()',
            'update category set division_id=null',
            'delete from category',
            'truncate category',
          ])
            await refuses(
              () => sql.raw(statement).execute(runtime),
              /permission denied for table category|must be owner of table category/,
            );

          // 7: the no-op assignment is permitted and changes nothing.
          const digestBefore = await sql<{ digest: string }>`
            select md5(string_agg(category::text, '|' order by id::text)) as digest from category`.execute(
            owner,
          );
          await sql`update category set id=id where id=${categoryId}::uuid`.execute(
            runtime,
          );
          const digestAfter = await sql<{ digest: string }>`
            select md5(string_agg(category::text, '|' order by id::text)) as digest from category`.execute(
            owner,
          );
          assert.deepEqual(digestAfter.rows, digestBefore.rows);
          assert.ok(digestBefore.rows[0]?.digest);
        },
      );

      await t.test(
        'each retained helper lock blocks the competing reference mutation',
        async () => {
          for (const helper of HELPERS)
            await sql
              .raw(
                `grant execute on function ${helper}(${
                  helper === 'lock_assignment_target'
                    ? 'uuid, varchar, uuid'
                    : helper.endsWith('division')
                      ? 'uuid, uuid, uuid'
                      : 'uuid, uuid'
                }) to ${cluster.operator.user}`,
              )
              .execute(owner);

          // Session B carries a short lock_timeout, so "blocks" is proven by a
          // deterministic timeout rather than by waiting.
          const competitor = connect(
            cluster,
            cluster.owner,
            '-c lock_timeout=900ms',
          );
          extra.push(competitor);

          // Each scenario carries an EXPLICIT restore statement. An earlier
          // version derived the restore by string replacement on the competing
          // statement, which is exactly the kind of cleverness that leaves
          // state dirty for a later subtest.
          const scenarios: readonly (readonly [
            string,
            string,
            string,
            string,
          ])[] = [
            [
              'department',
              `select lock_active_department('${organizationId}','${departmentId}')`,
              `update department set status='inactive' where id='${departmentId}'`,
              `update department set status='active' where id='${departmentId}'`,
            ],
            [
              'division',
              `select lock_active_division('${organizationId}','${departmentId}','${divisionId}')`,
              `update division set status='inactive' where id='${divisionId}'`,
              `update division set status='active' where id='${divisionId}'`,
            ],
            [
              'staff_identity',
              `select lock_staff('${organizationId}','${staffId}')`,
              `update staff_identity set active=false where id='${staffId}'`,
              `update staff_identity set active=true where id='${staffId}'`,
            ],
            [
              'operational_role',
              `select lock_assignment_target('${organizationId}','role','${operationalRoleId}')`,
              `update operational_role set active=false where id='${operationalRoleId}'`,
              `update operational_role set active=true where id='${operationalRoleId}'`,
            ],
            [
              'work_group',
              `select lock_assignment_target('${organizationId}','group','${workGroupId}')`,
              `update work_group set active=false where id='${workGroupId}'`,
              `update work_group set active=true where id='${workGroupId}'`,
            ],
            [
              'category and department together (site 1)',
              `select lock_active_category('${organizationId}','${categoryId}')`,
              `update category set status='inactive' where id='${categoryId}'`,
              `update category set status='active' where id='${categoryId}'`,
            ],
          ];

          for (const [label, acquire, compete, restore] of scenarios) {
            const holder = connect(cluster, cluster.operator);
            extra.push(holder);
            await holder.connection().execute(async (held) => {
              await sql.raw('begin').execute(held);
              await sql.raw(acquire).execute(held);
              // While the helper's share lock is held, the competing mutation
              // must not proceed.
              await refuses(
                () => sql.raw(compete).execute(competitor),
                /canceling statement due to lock timeout/,
              );
              await sql.raw('rollback').execute(held);
            });
            // Once released, the same mutation proceeds, then the fixture is
            // restored explicitly so no later subtest inherits dirty state.
            await sql.raw(compete).execute(competitor);
            await sql.raw(restore).execute(competitor);
            await holder.destroy();
            assert.ok(label.length > 0);
          }
        },
      );

      await t.test(
        'a native Category OF lock still blocks a competing Category mutation under the constrained privilege',
        async () => {
          const competitor = connect(
            cluster,
            cluster.owner,
            '-c lock_timeout=900ms',
          );
          extra.push(competitor);
          const holder = connect(cluster, cluster.operator);
          extra.push(holder);
          await holder.connection().execute(async (held) => {
            await sql.raw('begin').execute(held);
            await sql
              .raw(
                `select 1 from category join organization on organization.id = category.organization_id
                 where category.id='${categoryId}' for share of category, organization`,
              )
              .execute(held);
            await refuses(
              () =>
                sql
                  .raw(
                    `update category set status='inactive' where id='${categoryId}'`,
                  )
                  .execute(competitor),
              /canceling statement due to lock timeout/,
            );
            await sql.raw('rollback').execute(held);
          });
          await holder.destroy();
        },
      );

      await t.test(
        'the invariants carrying the removed Resident Experience locks hold without them',
        async () => {
          // The removal rests on two unique partial indexes rather than on the
          // review-row locks. Proven at the invariant level: two sessions that
          // both try to record a published event for one decision cannot both
          // commit. Driving the whole publication service is out of scope here
          // and is covered by its own suite.
          const indexes = await sql<{ indexdef: string }>`
            select indexdef from pg_indexes
            where schemaname='public'
              and indexname in ('resident_approval_consumed','resident_publication_transition')
            order by indexname`.execute(owner);
          assert.equal(indexes.rows.length, 2);
          assert.match(
            indexes.rows[0]?.indexdef ?? '',
            /CREATE UNIQUE INDEX[\s\S]*resident_experience_event[\s\S]*review_decision_id[\s\S]*'published'/i,
          );
          assert.match(
            indexes.rows[1]?.indexdef ?? '',
            /CREATE UNIQUE INDEX[\s\S]*resident_experience_event[\s\S]*resource_revision[\s\S]*'published'/i,
          );
          // And nothing anywhere updates or deletes the review tables, which is
          // why no writer was excluded by removing the locks.
          // Stronger than the F060.3C-2d-A argument, and found by this test
          // rather than by reading migrations: both review tables carry
          // `resident_review_immutable`, a BEFORE UPDATE OR DELETE trigger
          // running protect_resident_history(), which raises unconditionally.
          // The earlier migration scan missed it because those triggers are
          // created in a loop with an interpolated table name, so no literal
          // `on <table>` text exists to grep. The rows are therefore
          // database-enforced immutable: removing the FOR UPDATE locks could
          // not have excluded a writer, because no writer is possible.
          const immutability = await sql<{ relname: string; tgname: string }>`
            select c.relname, t.tgname
            from pg_trigger t join pg_class c on c.oid = t.tgrelid
            where not t.tgisinternal
              and c.relname in ('resident_experience_review_request','resident_experience_review_decision')
              and (t.tgtype & 16) > 0 and (t.tgtype & 8) > 0
            order by c.relname`.execute(owner);
          assert.deepEqual(immutability.rows, [
            {
              relname: 'resident_experience_review_decision',
              tgname: 'resident_review_immutable',
            },
            {
              relname: 'resident_experience_review_request',
              tgname: 'resident_review_immutable',
            },
          ]);
          // A BEFORE ROW trigger cannot be demonstrated against an empty
          // table, and building a valid review-request fixture needs the whole
          // publication chain, so the guarantee is established from the
          // function body instead: protect_resident_history raises
          // unconditionally, with no branch that can return.
          const guard = await sql<{ body: string; secdef: boolean }>`
            select p.prosrc as body, p.prosecdef as secdef
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname='public' and p.proname='protect_resident_history'`.execute(
            owner,
          );
          const body = guard.rows[0]?.body ?? '';
          assert.match(
            body,
            /raise exception 'Resident experience history is immutable'/,
          );
          // No conditional and no return path: every invocation raises.
          assert.ok(
            !/\bif\b/i.test(body),
            'the guard must have no conditional path',
          );
          assert.ok(
            !/\breturn\b/i.test(body),
            'the guard must have no return path',
          );
        },
      );

      await t.test(
        'the removed Category lock leaves referential integrity as the serializing invariant',
        async () => {
          // Stated precisely, because the first version of this proof was
          // wrong: service_request has NO direct foreign key to category. The
          // chain is service_request -> service_definition -> category, so the
          // insert takes its implicit FOR KEY SHARE on the service_definition
          // row, and the Category behind it cannot be deleted while any
          // service_definition references it.
          const requestFk = await sql<{ referenced: string }>`
            select confrelid::regclass::text as referenced
            from pg_constraint
            where conrelid='public.service_request'::regclass and contype='f'
            order by 1`.execute(owner);
          const referenced = requestFk.rows.map((row) => row.referenced);
          assert.ok(referenced.includes('service_definition'));
          assert.ok(!referenced.includes('category'));

          const definitionFk = await sql<{ referenced: string }>`
            select confrelid::regclass::text as referenced
            from pg_constraint
            where conrelid='public.service_definition'::regclass and contype='f'
            order by 1`.execute(owner);
          assert.ok(
            definitionFk.rows.map((row) => row.referenced).includes('category'),
          );

          // The probe's own precondition, asserted first so a missing fixture
          // names itself instead of looking like a failed invariant.
          const dependents = await sql<{ definitions: string }>`
            select count(*) as definitions from service_definition
            where organization_id=${organizationId}::uuid
              and category_id=${categoryId}::uuid`.execute(owner);
          assert.deepEqual(dependents.rows, [{ definitions: '1' }]);

          // So no orphan can arise: the Category cannot be deleted at all
          // while a service_definition still references it.
          //
          // Both probes run inside a transaction that always rolls back. An
          // earlier version ran them in autocommit, and when a fixture was
          // missing the delete SUCCEEDED and removed the Category, which then
          // failed two unrelated later subtests. A destructive probe must not
          // be able to damage the fixture it is probing.
          await owner.connection().execute(async (session) => {
            await sql.raw('begin').execute(session);
            try {
              await refuses(
                () =>
                  sql`delete from category where id=${categoryId}::uuid`.execute(
                    session,
                  ),
                /violates foreign key constraint|still referenced/,
              );
            } finally {
              await sql.raw('rollback').execute(session);
            }
          });
        },
      );

      await t.test(
        'no helper or hardened function can be redirected by a hostile search_path',
        async () => {
          const hostile = connect(
            cluster,
            cluster.operator,
            '-c search_path=pg_temp,public',
          );
          extra.push(hostile);
          const observed = await sql<{ path: string }>`
            select current_setting('search_path') as path`.execute(hostile);
          assert.equal(observed.rows[0]?.path, 'pg_temp,public');

          // A same-signature decoy for every helper, owned by the caller.
          for (const helper of HELPERS) {
            const args =
              helper === 'lock_assignment_target'
                ? 'uuid, varchar, uuid'
                : helper.endsWith('division')
                  ? 'uuid, uuid, uuid'
                  : 'uuid, uuid';
            await sql
              .raw(
                `create function pg_temp.${helper}(${args}) returns boolean language sql as 'select false'`,
              )
              .execute(hostile);
          }
          // A pg_temp relation and composite-type decoy as well.
          await sql
            .raw(
              'create temporary table category as select * from public.category where false',
            )
            .execute(hostile);

          // Resolution still reaches the owner-created SECURITY DEFINER
          // functions, and the verdicts are the real ones, not the decoys.
          const resolved = await sql<{
            schema: string;
            owner: string;
            secdef: boolean;
          }>`
            select n.nspname as schema, pg_get_userbyid(p.proowner) as owner, p.prosecdef as secdef
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where p.oid = 'lock_active_category(uuid,uuid)'::regprocedure`.execute(
            hostile,
          );
          assert.deepEqual(resolved.rows, [
            { schema: 'public', owner: cluster.owner.user, secdef: true },
          ]);
          const verdicts = await sql<{ a: boolean; f: boolean }>`
            select lock_active_category(${organizationId}::uuid, ${categoryId}::uuid) as a,
                   lock_staff(${organizationId}::uuid, ${staffId}::uuid) as f`.execute(
            hostile,
          );
          // The decoys all return false; the real helpers return true.
          assert.deepEqual(verdicts.rows, [{ a: true, f: true }]);
          // The qualified decoy exists and would have answered differently.
          const decoy = await sql<{ v: boolean }>`
            select pg_temp.lock_staff(${organizationId}::uuid, ${staffId}::uuid) as v`.execute(
            hostile,
          );
          assert.deepEqual(decoy.rows, [{ v: false }]);
        },
      );

      await t.test(
        'the operator boundary is unchanged and the runtime holds none of it',
        async () => {
          const operatorHelper = await sql<{
            secdef: boolean;
            config: string[] | null;
            runtime_execute: boolean;
          }>`
            select p.prosecdef as secdef, p.proconfig as config,
                   has_function_privilege(${cluster.operator.user}, p.oid, 'EXECUTE') as runtime_execute
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname='public' and p.proname='tenant_domain_lock_organization'`.execute(
            owner,
          );
          assert.deepEqual(operatorHelper.rows, [
            {
              secdef: true,
              config: ['search_path=pg_catalog, pg_temp'],
              runtime_execute: false,
            },
          ]);
          // And no tenant-domain table is reachable by this role.
          for (const table of [
            'tenant_domain',
            'tenant_domain_audit',
            'tenant_domain_operator_approval',
            'tenant_domain_verification_attempt',
          ]) {
            const exposure = await sql<{ privilege: string }>`
              select p.privilege
              from unnest(array['SELECT','INSERT','UPDATE','DELETE']) as p(privilege)
              where has_table_privilege(${cluster.operator.user},
                ${`public.${table}`}, p.privilege)`.execute(owner);
            assert.deepEqual(
              exposure.rows,
              [],
              `${table} must stay unreachable`,
            );
          }
        },
      );

      await t.test(
        'Migration 49 rolls back and reapplies without data loss',
        async () => {
          const rows = await sql<{ categories: string; staff: string }>`
            select (select count(*) from category) as categories,
                   (select count(*) from staff_identity) as staff`.execute(
            owner,
          );

          await sql
            .raw(await migrationSql(MIGRATION_49, 'down'))
            .execute(owner);

          const remaining = await sql<{ helpers: string; trigger: string }>`
            select (select count(*) from pg_proc p
                      join pg_namespace n on n.oid=p.pronamespace
                      where n.nspname='public'
                        and (p.proname = any(${[...HELPERS]})
                          or p.proname='protect_category_identity')) as helpers,
                   (select count(*) from pg_trigger
                      where tgname='category_identity_immutable') as trigger`.execute(
            owner,
          );
          assert.deepEqual(remaining.rows, [{ helpers: '0', trigger: '0' }]);

          const restored = await sql<{
            proname: string;
            prosecdef: boolean;
            proconfig: string[] | null;
            public_execute: boolean;
          }>`
            select p.proname, p.prosecdef, p.proconfig,
                   coalesce(p.proacl::text like '%,=X/%' or p.proacl::text like '{=X/%', false) as public_execute
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public'
              and p.proname in ('advance_access_revision','invalidate_access_revision')
            order by p.proname`.execute(owner);
          for (const row of restored.rows) {
            assert.equal(
              row.prosecdef,
              false,
              `${row.proname} back to INVOKER`,
            );
            assert.equal(
              row.proconfig,
              null,
              `${row.proname} search_path cleared`,
            );
            // EFFECTIVE privileges are restored: PUBLIC can execute again.
            // The ACL representation is NOT byte-identical -- it was NULL
            // before Migration 49 and becomes an explicit entry once touched,
            // which PostgreSQL cannot return to NULL. Recorded rather than
            // claimed as exact restoration.
            assert.equal(
              row.public_execute,
              true,
              `${row.proname} PUBLIC EXECUTE restored`,
            );
          }
          // After rollback the Category identity invariant is gone, which is
          // precisely why the runtime grant must be withdrawn in the same
          // operation.
          await sql`update category set id=${categoryId}::uuid where id=${categoryId}::uuid`.execute(
            owner,
          );
          const definers = await sql<{ definers: string }>`
            select count(*) as definers from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef`.execute(owner);
          assert.deepEqual(definers.rows, [{ definers: '1' }]);

          await sql.raw(await migrationSql(MIGRATION_49, 'up')).execute(owner);
          const reapplied = await sql<{ definers: string }>`
            select count(*) as definers from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef`.execute(owner);
          assert.deepEqual(reapplied.rows, [{ definers: '10' }]);

          const after = await sql<{ categories: string; staff: string }>`
            select (select count(*) from category) as categories,
                   (select count(*) from staff_identity) as staff`.execute(
            owner,
          );
          assert.deepEqual(after.rows, rows.rows);
        },
      );
    } finally {
      for (const session of extra)
        await session.destroy().catch(() => undefined);
      await runtime.destroy().catch(() => undefined);
      await owner.destroy().catch(() => undefined);
      await cluster.destroy();
    }
  },
);
