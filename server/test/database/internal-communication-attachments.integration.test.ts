import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  FileMigrationProvider,
  Kysely,
  Migrator,
  PostgresDialect,
  sql,
} from 'kysely';
import { Pool } from 'pg';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';

const before = '20261009000000-controlled-access-reader';
const current = '20261010000000-extend-internal-communication-attachments';

test(
  'F058.2 Migration 40 structural integrity and transactional rollback',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const schema = `communication_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await prepareDatabaseExtensions(admin);
    await admin.query(`create schema "${schema}"`);
    const db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: process.env.TEST_DATABASE_URL,
          options: `-c search_path=${schema}`,
        }),
      }),
    });
    const migrator = new Migrator({
      db,
      migrationTableSchema: schema,
      provider: new FileMigrationProvider({
        fs,
        path,
        migrationFolder: path.resolve(__dirname, '../../migrations'),
      }),
    });
    const migrate = async (target: string) => {
      const result = await migrator.migrateTo(target);
      assert.equal(result.error, undefined);
    };
    const definition = async () =>
      (
        await sql<{
          definition: string;
        }>`select pg_get_functiondef('protect_attachment_batch()'::regprocedure) definition`.execute(
          db,
        )
      ).rows[0]?.definition ?? '';
    const tables = async () =>
      (
        await sql<{
          tablename: string;
        }>`select tablename from pg_tables where schemaname=${schema} order by tablename`.execute(
          db,
        )
      ).rows;
    const rows = async () =>
      Promise.all(
        (await tables())
          .filter((r) => !r.tablename.startsWith('kysely_'))
          .map(async (r) => ({
            table: r.tablename,
            rows: (
              await sql`select to_jsonb(t) row from ${sql.table(r.tablename)} t order by to_jsonb(t)::text`.execute(
                db,
              )
            ).rows,
          })),
      );
    const structure = async () => ({
      triggers: (
        await sql`select tgname, tgfoid, tgfoid::regprocedure::text function, pg_get_triggerdef(oid) definition from pg_trigger where tgrelid in (select oid from pg_class where relnamespace=${schema}::regnamespace) order by tgname, definition`.execute(
          db,
        )
      ).rows,
      indexes: (
        await sql`select indexname,indexdef from pg_indexes where schemaname=${schema} order by indexname`.execute(
          db,
        )
      ).rows,
      constraints: (
        await sql`select conname,pg_get_constraintdef(oid) definition from pg_constraint where connamespace=${schema}::regnamespace order by conname,definition`.execute(
          db,
        )
      ).rows,
      columns: (
        await sql`select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema=${schema} order by table_name,ordinal_position`.execute(
          db,
        )
      ).rows,
    });
    const ledger = async () =>
      (await sql`select * from kysely_migration order by name`.execute(db))
        .rows;
    try {
      await migrate(before);
      const org = randomUUID(),
        foreign = randomUUID(),
        staff = randomUUID(),
        department = randomUUID(),
        category = randomUUID(),
        issue = randomUUID(),
        version = randomUUID();
      await sql`insert into organization(id,name,short_name,slug,default_business_timezone) values
        (${org},'Fictional attachment organization','Test',${org},'Etc/UTC'),
        (${foreign},'Fictional other organization','Other',${foreign},'Etc/UTC')`.execute(
        db,
      );
      await sql`insert into staff_identity(id,organization_id,entra_tenant_id,entra_object_id,display_name,active)
          values(${staff},${org},${randomUUID()},${randomUUID()},'Fictional requester',true)`.execute(
        db,
      );
      await sql`insert into department(id,organization_id,name) values(${department},${org},'Fictional department')`.execute(
        db,
      );
      await sql`insert into category(id,organization_id,department_id,name,icon_key) values(${category},${org},${department},'Fictional category','test')`.execute(
        db,
      );
      await sql`insert into service_definition(id,organization_id,category_id,service_key,availability) values(${issue},${org},${category},'fictional','INTERNAL_AND_EXTERNAL')`.execute(
        db,
      );
      await sql`insert into service_definition_version(id,organization_id,service_definition_id,version_number,name,resident_description,icon_key,default_priority,location_policy,geographic_eligibility_mode,anonymous_reporting_policy,status)
          values(${version},${org},${issue},1,'Fictional issue','Fictional description','test','medium','not_applicable','no_geographic_restriction','allowed','draft');`.execute(
        db,
      );
      const request = async (audience: 'public' | 'internal') => {
        const id = randomUUID();
        await sql`insert into service_request(id,organization_id,reference_number,service_definition_id,service_definition_version_id,category_id,status,priority,description,reporting_identity,audience,submitted_by_staff_identity_id,requester_staff_identity_id)
          values(${id},${org},${'TEST-' + id.replaceAll('-', '').toUpperCase()},${issue},${version},${category},'open','medium','Fictional request','identified',${audience},${staff},${audience === 'internal' ? staff : null})`.execute(
          db,
        );
        return id;
      };
      const publicRequest = await request('public'),
        internal = await request('internal'),
        other = await request('internal');
      const communication = async (parent: string) => {
        const id = randomUUID();
        await sql`insert into request_communication(id,organization_id,service_request_id,author_staff_identity_id,author_display_name,submission_key,body)
          values(${id},${org},${parent},${staff},'Fictional author',${randomUUID()},'Fictional message')`.execute(
          db,
        );
        return id;
      };
      const publicMessage = await communication(publicRequest),
        message = await communication(internal),
        wrongMessage = await communication(other);
      const batch = async (parent: string, scan = 'CLEAN') => {
        const id = randomUUID();
        await sql`insert into attachment_batch(id,organization_id,context,token_digest,staff_identity_id,service_request_id,expires_at)
          values(${id},${org},'REQUESTER_COMMUNICATION',${'a'.repeat(64)},${staff},${parent},clock_timestamp()+interval '30 minutes')`.execute(
          db,
        );
        await sql`insert into attachment(id,organization_id,batch_id,context,storage_key,filename,media_type,byte_size,source_byte_size,content_checksum,scan_state)
          values(${randomUUID()},${org},${id},'REQUESTER_COMMUNICATION',${randomUUID()},'fictional.png','image/png',10,10,${'b'.repeat(64)},${scan})`.execute(
          db,
        );
        await sql`insert into attachment_audit(organization_id,context,action,batch_id,service_request_id,staff_identity_id)
          values(${org},'REQUESTER_COMMUNICATION','staged',${id},${parent},${staff});`.execute(
          db,
        );
        return id;
      };
      const finalize = (id: string, parent: string) =>
        sql`update attachment_batch set state='FINALIZED',communication_id=${parent},finalized_at=clock_timestamp(),submission_digest=${'c'.repeat(64)} where id=${id}`.execute(
          db,
        );
      // Retain a real finalized PUBLIC batch through every migration direction.
      const existingPublic = await batch(publicRequest);
      await finalize(existingPublic, publicMessage);
      let oldDefinition = '';
      await t.test(
        '39 → 40 → 39 → 40 preserves all rows, schema objects and exact old function',
        async () => {
          oldDefinition = await definition();
          const original = await rows(),
            objects = await structure(),
            oldLedger = await ledger();
          assert.equal(oldLedger.length, 39);
          assert.equal((await tables()).length, 60);
          await migrate(current);
          assert.equal((await ledger()).length, 40);
          assert.equal(
            await definition(),
            oldDefinition.replace(
              "where id=NEW.service_request_id and audience='public'",
              "where id=NEW.service_request_id and organization_id=NEW.organization_id and audience in ('public','internal')",
            ),
          );
          assert.deepEqual(await structure(), objects);
          assert.deepEqual(await rows(), original);
          await migrate(before);
          assert.equal(await definition(), oldDefinition);
          assert.deepEqual(await ledger(), oldLedger);
          assert.deepEqual(await rows(), original);
          await migrate(current);
          assert.equal((await ledger()).length, 40);
          assert.equal((await tables()).length, 60);
          assert.deepEqual(await structure(), objects);
          assert.deepEqual(await rows(), original);
        },
      );
      await t.test(
        'PUBLIC finalization and finalized update/delete/truncate protection',
        async () => {
          const newPublic = await request('public');
          const id = await batch(newPublic);
          await finalize(id, await communication(newPublic));
          for (const action of [
            sql`update attachment_batch set token_digest=${'d'.repeat(64)} where id=${id}`,
            sql`delete from attachment_batch where id=${id}`,
            sql`truncate attachment_batch cascade`,
          ])
            await assert.rejects(
              action.execute(db),
              /immutable|protected|finalization/i,
            );
        },
      );
      const staged = await batch(internal);
      for (const state of ['STAGED', 'FINALIZED']) {
        if (state === 'FINALIZED') await finalize(staged, message);
        await t.test(
          `${state} INTERNAL state refuses down with all rows, function and ledger unchanged`,
          async () => {
            const original = await rows(),
              fn = await definition(),
              history = await ledger();
            const result = await migrator.migrateTo(before);
            assert.match(
              String(result.error),
              /Retained INTERNAL communication attachment batches prevent safe rollback/,
            );
            assert.deepEqual(await rows(), original);
            assert.equal(await definition(), fn);
            assert.deepEqual(await ledger(), history);
          },
        );
      }
      await t.test(
        'Requester inactivity preserves finalized history without trigger staff lookup',
        async () => {
          const original = (
            await sql`select * from attachment_batch where id=${staged}`.execute(
              db,
            )
          ).rows;
          await sql`update staff_identity set active=false where id=${staff}`.execute(
            db,
          );
          assert.deepEqual(
            (
              await sql`select * from attachment_batch where id=${staged}`.execute(
                db,
              )
            ).rows,
            original,
          );
          assert.doesNotMatch(
            await definition(),
            /from staff_identity|for update|for share/i,
          );
        },
      );
      for (const [name, parent] of [
        ['wrong request communication', wrongMessage],
        ['nonexistent communication', randomUUID()],
      ] as const)
        await t.test(name, async () => {
          const id = await batch(internal);
          await assert.rejects(finalize(id, parent), /foreign key/);
        });
      for (const [name, change] of [
        ['request reassignment', sql`service_request_id=${other}`],
        ['Organization reassignment', sql`organization_id=${foreign}`],
        [
          'Note masquerade',
          sql`context='INTERNAL_NOTE',note_id=${randomUUID()}`,
        ],
        ['Evidence masquerade', sql`context='REQUEST_EVIDENCE'`],
        ['protected owner', sql`staff_identity_id=${randomUUID()}`],
        ['invalid transition', sql`state='STAGED'`],
      ] as const)
        await t.test(name, async () => {
          const id = await batch(internal);
          await assert.rejects(
            sql`update attachment_batch set ${change} where id=${id}`.execute(
              db,
            ),
            /Invalid attachment finalization/,
          );
        });
      await t.test('Non-CLEAN file prevents finalization', async () => {
        const id = await batch(internal, 'PENDING_SCAN');
        await assert.rejects(
          finalize(id, wrongMessage),
          /Invalid attachment finalization/,
        );
      });
      await t.test(
        'Foreign Organization and nonexistent request cannot form a batch',
        async () => {
          for (const [organization, parent] of [
            [foreign, internal],
            [org, randomUUID()],
          ])
            await assert.rejects(
              sql`insert into attachment_batch(organization_id,context,token_digest,staff_identity_id,service_request_id,expires_at)
            values(${organization},'REQUESTER_COMMUNICATION',${'a'.repeat(64)},${staff},${parent},clock_timestamp()+interval '30 minutes')`.execute(
                db,
              ),
              /foreign key/,
            );
        },
      );
    } finally {
      await db.destroy();
      await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  },
);
