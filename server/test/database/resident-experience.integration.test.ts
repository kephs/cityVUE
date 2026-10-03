import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { ConflictException } from '@nestjs/common';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';
import { ResidentExperienceRepository } from '../../src/resident-experience/resident-experience.repository.js';
import { ResidentExperienceService } from '../../src/resident-experience/resident-experience.service.js';
import {
  up,
  down,
} from '../../migrations/20261011000000-add-resident-experience.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import {
  residentFixture,
  phoneFixture,
} from '../helpers/resident-experience.fixture.js';

test(
  'F059.2 disposable PostgreSQL persistence proofs',
  {
    skip:
      !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL is not configured',
  },
  async (t) => {
    const schema = `resident_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    let db: Kysely<DatabaseSchema> | undefined;
    let schemaCreated = false;
    try {
      const identity = await admin.query(
        'select current_database() as database, current_user as role',
      );
      assert.deepEqual(identity.rows, [
        { database: 'reqro_f0592_test', role: 'reqro_test_user' },
      ]);
      await prepareDatabaseExtensions(admin);
      await admin.query(`create schema "${schema}"`);
      schemaCreated = true;
      db = new Kysely<DatabaseSchema>({
        dialect: new PostgresDialect({
          pool: new Pool({
            connectionString: process.env.TEST_DATABASE_URL,
            options: `-c search_path=${schema}`,
          }),
        }),
      });
      const database = db;
      const folder = path.resolve(__dirname, '../../migrations');
      const migrations = (await readdir(folder))
        .filter(
          (f) =>
            f.endsWith('.js') &&
            f <= '20261011000000-add-resident-experience.js',
        )
        .sort();
      assert.equal(migrations.length, 41);
      assert.equal(migrations[40], '20261011000000-add-resident-experience.js');
      for (const file of migrations.slice(0, 40)) {
        const migration = (await import(
          pathToFileURL(path.join(folder, file)).href
        )) as { up: (db: Kysely<DatabaseSchema>) => Promise<void> };
        await database.transaction().execute(migration.up);
      }
      const repository = new ResidentExperienceRepository(database);
      async function actor() {
        const organizationId = randomUUID(),
          staffIdentityId = randomUUID(),
          tenantId = randomUUID(),
          objectId = randomUUID();
        await database
          .insertInto('organization')
          .values({
            id: organizationId,
            name: 'Synthetic Resident Test',
            short_name: 'Test',
            slug: organizationId,
            status: 'active',
            default_business_timezone: 'UTC',
          })
          .execute();
        await database
          .insertInto('staff_identity')
          .values({
            id: staffIdentityId,
            organization_id: organizationId,
            display_name: 'Synthetic Staff',
            active: true,
            email: null,
            entra_tenant_id: tenantId,
            entra_object_id: objectId,
          })
          .execute();
        const access: StaffAccess = {
          organizationId,
          staffIdentityId,
          tenantId,
          objectId,
          displayName: 'Synthetic Staff',
          scopes: [],
          permissions: [],
          departmentIds: [],
          divisionIds: [],
          development: false,
        };
        // Test-only injected policy; no permission/bypass is registered in application code.
        const service = new ResidentExperienceService(
          repository,
          async (fresh) => {
            assert.equal(fresh.staffIdentityId, staffIdentityId);
            assert.equal(fresh.organizationId, organizationId);
            assert.deepEqual(fresh.permissions, []);
          },
        );
        return { access, service };
      }
      const primary = await actor(),
        other = await actor();
      const org = primary.access.organizationId;
      const residentTables = [
        'organization_resident_experience',
        'resident_experience_revision',
        'resident_experience_action',
        'resident_experience_benefit',
        'resident_experience_contact',
        'resident_experience_event',
      ];
      async function residentRows() {
        const result: Record<string, unknown[]> = {};
        for (const table of residentTables) {
          result[table] = (
            await sql`select to_jsonb(r) as row from ${sql.table(table)} r order by to_jsonb(r)::text`.execute(
              database,
            )
          ).rows;
        }
        return result;
      }
      await t.test(
        'forward migration, empty defaults, safe down/up, existing branding and permissions preserved',
        async () => {
          await database
            .updateTable('organization_branding')
            .set({
              display_name: 'Synthetic preserved branding',
              tagline: 'Existing fictional identity',
              logo_key: 'example-organization',
            })
            .where('organization_id', '=', org)
            .execute();
          const branding = await database
            .selectFrom('organization_branding')
            .selectAll()
            .orderBy('organization_id')
            .execute();
          const permissions = await database
            .selectFrom('permission')
            .selectAll()
            .orderBy('permission_key')
            .execute();
          const grants = await database
            .selectFrom('role_permission')
            .selectAll()
            .execute();
          assert.equal(grants.length, 0);
          const beforeTables = await sql<{
            tablename: string;
          }>`select tablename from pg_tables where schemaname = ${schema} order by tablename`.execute(
            database,
          );
          await database.transaction().execute(up);
          const afterTables = await sql<{
            tablename: string;
          }>`select tablename from pg_tables where schemaname = ${schema} order by tablename`.execute(
            database,
          );
          assert.deepEqual(
            afterTables.rows
              .map((r) => r.tablename)
              .filter(
                (name) => !beforeTables.rows.some((r) => r.tablename === name),
              )
              .sort(),
            [...residentTables].sort(),
          );
          assert.equal(
            permissions.some((p) =>
              p.permission_key.startsWith('resident_experience.'),
            ),
            false,
          );
          assert.deepEqual(await repository.getResource(org), {
            organization_id: org,
            revision: 1,
            draft_revision_id: null,
            published_revision_id: null,
          });
          async function preserved() {
            for (const table of residentTables.slice(1)) {
              assert.deepEqual(
                (await sql`select * from ${sql.table(table)}`.execute(database))
                  .rows,
                [],
              );
            }
            assert.deepEqual(
              await database
                .selectFrom('organization_branding')
                .selectAll()
                .orderBy('organization_id')
                .execute(),
              branding,
            );
            assert.deepEqual(
              await database
                .selectFrom('permission')
                .selectAll()
                .orderBy('permission_key')
                .execute(),
              permissions,
            );
            assert.deepEqual(
              await database
                .selectFrom('role_permission')
                .selectAll()
                .execute(),
              grants,
            );
          }
          await preserved();
          await database.transaction().execute(down);
          assert.deepEqual(
            (
              await sql<{
                tablename: string;
              }>`select tablename from pg_tables where schemaname = ${schema} order by tablename`.execute(
                database,
              )
            ).rows,
            beforeTables.rows,
          );
          await database.transaction().execute(up);
          await preserved();
          const later = await actor();
          assert.deepEqual(
            await repository.getResource(later.access.organizationId),
            {
              organization_id: later.access.organizationId,
              revision: 1,
              draft_revision_id: null,
              published_revision_id: null,
            },
          );
          const foreignKeys = await sql<{
            name: string;
            definition: string;
          }>`select c.conname as name, pg_get_constraintdef(c.oid) as definition from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace where n.nspname=${schema} and r.relname = any(${residentTables}::text[]) and c.contype='f'`.execute(
            database,
          );
          assert.equal(foreignKeys.rows.length, 13);
          assert.equal(
            foreignKeys.rows.filter((r) =>
              r.definition.startsWith('FOREIGN KEY (organization_id,'),
            ).length,
            10,
          );
          assert.ok(
            foreignKeys.rows.some((r) =>
              r.definition.startsWith(
                'FOREIGN KEY (organization_id, revision_id, contact_id)',
              ),
            ),
          );
        },
      );
      let savedId = '';
      await t.test(
        'save complete immutable snapshot, event binding, no-op and default deny policy',
        async () => {
          await assert.rejects(
            () =>
              new ResidentExperienceService(repository).saveDraft(
                primary.access,
                { expectedRevision: 1, snapshot: phoneFixture() },
                randomUUID(),
              ),
            /not enabled/,
          );
          const saved = await primary.service.saveDraft(
            primary.access,
            { expectedRevision: 1, snapshot: phoneFixture() },
            randomUUID(),
          );
          assert.equal(saved.revision, 2);
          assert.ok(saved.draftRevisionId);
          savedId = saved.draftRevisionId;
          assert.deepEqual(
            await repository.getRevision(org, savedId),
            phoneFixture(),
          );
          const event = await database
            .selectFrom('resident_experience_event')
            .selectAll()
            .where('organization_id', '=', org)
            .executeTakeFirstOrThrow();
          assert.equal(event.actor_id, primary.access.staffIdentityId);
          assert.equal(event.new_revision_id, savedId);
          assert.equal(event.prior_revision_id, null);
          assert.equal(event.consequential, true);
          assert.equal(event.resource_revision, 2);
          assert.ok(event.changed_fields.length <= 10);
          assert.equal(
            (
              await primary.service.saveDraft(
                primary.access,
                { expectedRevision: 2, snapshot: phoneFixture() },
                randomUUID(),
              )
            ).changed,
            false,
          );
          assert.equal(
            (
              await database
                .selectFrom('resident_experience_event')
                .selectAll()
                .where('organization_id', '=', org)
                .execute()
            ).length,
            1,
          );
        },
      );
      await t.test(
        'stale conflict and complete replacement preserve old revision and stable IDs',
        async () => {
          await assert.rejects(
            () =>
              primary.service.saveDraft(
                primary.access,
                { expectedRevision: 1, snapshot: residentFixture() },
                randomUUID(),
              ),
            /changed/,
          );
          const saved = await primary.service.saveDraft(
            primary.access,
            { expectedRevision: 2, snapshot: residentFixture() },
            randomUUID(),
          );
          assert.ok(saved.draftRevisionId);
          const current = await repository.getRevision(
            org,
            saved.draftRevisionId,
          );
          assert.equal(current.actions[0]?.id, 'report');
          assert.deepEqual(current.contacts, []);
          assert.deepEqual(
            await repository.getRevision(org, savedId),
            phoneFixture(),
          );
        },
      );
      await t.test(
        'concurrent saves admit one winner and do not retry stale content',
        async () => {
          const a = residentFixture(),
            b = residentFixture();
          a.presentation.metadata.title = 'A';
          b.presentation.metadata.title = 'B';
          const results = await Promise.allSettled([
            primary.service.saveDraft(
              primary.access,
              { expectedRevision: 3, snapshot: a },
              randomUUID(),
            ),
            primary.service.saveDraft(
              primary.access,
              { expectedRevision: 3, snapshot: b },
              randomUUID(),
            ),
          ]);
          assert.equal(
            results.filter((r) => r.status === 'fulfilled').length,
            1,
          );
          assert.equal(
            results.filter((r) => r.status === 'rejected').length,
            1,
          );
          assert.equal((await repository.getResource(org))?.revision, 4);
          const rejected = results.find((r) => r.status === 'rejected');
          assert.ok(rejected?.status === 'rejected');
          assert.ok(rejected.reason instanceof ConflictException);
          assert.equal(rejected.reason.getStatus(), 409);
          const winner = results.findIndex((r) => r.status === 'fulfilled');
          const resource = await repository.getResource(org);
          assert.ok(resource?.draft_revision_id);
          assert.deepEqual(
            await repository.getRevision(org, resource.draft_revision_id),
            winner === 0 ? a : b,
          );
          assert.equal(
            (
              await database
                .selectFrom('resident_experience_revision')
                .selectAll()
                .where('organization_id', '=', org)
                .execute()
            ).length,
            3,
          );
          assert.equal(
            (
              await database
                .selectFrom('resident_experience_event')
                .selectAll()
                .where('organization_id', '=', org)
                .execute()
            ).length,
            3,
          );
        },
      );
      await t.test(
        'cross-Organization revision creator is rejected by composite foreign key',
        async () => {
          await assert.rejects(
            () =>
              database.transaction().execute((trx) =>
                repository.insertRevision(
                  trx,
                  {
                    organizationId: org,
                    actorId: other.access.staffIdentityId,
                    revisionId: randomUUID(),
                    resourceRevision: 5,
                  },
                  residentFixture(),
                ),
              ),
            { code: '23503' },
          );
        },
      );
      for (const table of [
        'resident_experience_action',
        'resident_experience_benefit',
        'resident_experience_contact',
      ] as const) {
        await t.test(
          `cross-Organization ${table} insert is rejected`,
          async () => {
            const source = await database
              .selectFrom(table)
              .selectAll()
              .where('revision_id', '=', savedId)
              .executeTakeFirstOrThrow();
            await assert.rejects(
              () =>
                database.transaction().execute(async (trx) => {
                  const revisionId = randomUUID();
                  await repository.insertRevision(
                    trx,
                    {
                      organizationId: org,
                      actorId: primary.access.staffIdentityId,
                      revisionId,
                      resourceRevision: 5,
                    },
                    residentFixture(),
                  );
                  await trx
                    .insertInto(table)
                    .values({
                      ...source,
                      organization_id: other.access.organizationId,
                      revision_id: revisionId,
                      logical_id: 'foreign',
                    })
                    .execute();
                }),
              /Resident revision is closed/,
            );
          },
        );
        await t.test(`late ${table} insert is rejected`, async () => {
          const source = await database
            .selectFrom(table)
            .selectAll()
            .where('revision_id', '=', savedId)
            .executeTakeFirstOrThrow();
          await assert.rejects(
            () =>
              database
                .insertInto(table)
                .values({
                  ...source,
                  logical_id: 'late',
                  ...('display_order' in source ? { display_order: 50 } : {}),
                })
                .execute(),
            /Resident revision is closed/,
          );
        });
      }
      for (const pointer of ['prior_revision_id', 'new_revision_id'] as const) {
        await t.test(
          `cross-Organization event ${pointer} is rejected`,
          async () => {
            const eventActor = await actor();
            const own = await eventActor.service.saveDraft(
              eventActor.access,
              {
                expectedRevision: 1,
                snapshot: residentFixture(),
              },
              randomUUID(),
            );
            assert.ok(own.draftRevisionId);
            const event = {
              id: randomUUID(),
              organization_id: eventActor.access.organizationId,
              actor_id: eventActor.access.staffIdentityId,
              operation: 'approved' as const,
              prior_revision_id: own.draftRevisionId,
              new_revision_id: own.draftRevisionId,
              prior_resource_revision: 2,
              resource_revision: 2,
              changed_fields: [],
              consequential: false,
              reasons: [],
              correlation_id: randomUUID(),
            };
            await assert.rejects(
              () =>
                database
                  .insertInto('resident_experience_event')
                  .values({ ...event, [pointer]: savedId })
                  .execute(),
              { code: '23503' },
            );
          },
        );
      }
      await t.test(
        'same-Organization publication pointer rejects changes at commit',
        async () => {
          const before = await residentRows();
          const resource = await repository.getResource(org);
          assert.ok(resource?.draft_revision_id);
          await assert.rejects(
            () =>
              database.transaction().execute(async (trx) => {
                await trx
                  .updateTable('organization_resident_experience')
                  .set({
                    revision: resource.revision + 1,
                    published_revision_id: resource.draft_revision_id,
                  })
                  .where('organization_id', '=', org)
                  .execute();
              }),
            /Resident publication is not implemented/,
          );
          assert.deepEqual(await residentRows(), before);
        },
      );
      await t.test(
        'cross-Organization revision reads, actor forgery and pointer foreign keys fail',
        async () => {
          await assert.rejects(
            () => repository.getRevision(other.access.organizationId, savedId),
            /Not Found/,
          );
          await assert.rejects(() =>
            primary.service.saveDraft(
              {
                ...primary.access,
                organizationId: other.access.organizationId,
              },
              { expectedRevision: 1, snapshot: residentFixture() },
              randomUUID(),
            ),
          );
          for (const column of [
            'draft_revision_id',
            'published_revision_id',
          ] as const)
            await assert.rejects(
              () =>
                database
                  .updateTable('organization_resident_experience')
                  .set({ revision: 2, [column]: savedId })
                  .where('organization_id', '=', other.access.organizationId)
                  .execute(),
              { code: '23503' },
            );
        },
      );
      await t.test(
        'child ownership, revision-specific contacts, duplicate logical IDs/order and audit actors constrained',
        async () => {
          for (const variant of [
            'foreign-child',
            'foreign-contact',
            'duplicate-id',
            'duplicate-order',
            'foreign-actor',
          ] as const) {
            await assert.rejects(
              () =>
                database.transaction().execute(async (trx) => {
                  const revisionId = randomUUID();
                  await repository.insertRevision(
                    trx,
                    {
                      organizationId: org,
                      actorId: primary.access.staffIdentityId,
                      revisionId,
                      resourceRevision: 5,
                    },
                    residentFixture(),
                  );
                  if (variant === 'foreign-actor') {
                    await trx
                      .insertInto('resident_experience_event')
                      .values({
                        id: randomUUID(),
                        organization_id: org,
                        actor_id: other.access.staffIdentityId,
                        operation: 'draft_saved',
                        prior_revision_id: null,
                        new_revision_id: revisionId,
                        prior_resource_revision: 4,
                        resource_revision: 5,
                        changed_fields: [],
                        consequential: false,
                        reasons: [],
                        correlation_id: randomUUID(),
                      })
                      .execute();
                  } else {
                    await trx
                      .insertInto('resident_experience_action')
                      .values({
                        organization_id:
                          variant === 'foreign-child'
                            ? other.access.organizationId
                            : org,
                        revision_id: revisionId,
                        logical_id:
                          variant === 'duplicate-id' ? 'report' : 'next',
                        enabled: true,
                        display_order: variant === 'duplicate-order' ? 10 : 20,
                        icon_key: 'report',
                        title: 'Synthetic',
                        description: 'Synthetic',
                        cta_label: 'Call',
                        action_type:
                          variant === 'foreign-contact' ? 'phone' : 'internal',
                        target:
                          variant === 'foreign-contact' ? null : '/report',
                        contact_id:
                          variant === 'foreign-contact' ? 'help' : null,
                        tone: 'primary',
                      })
                      .execute();
                  }
                }),
              variant === 'foreign-child'
                ? /closed/
                : { code: variant.startsWith('duplicate') ? '23505' : '23503' },
            );
          }
        },
      );
      await t.test(
        'revisions, children and events reject update/delete/truncate and late child insert',
        async () => {
          for (const table of [
            'resident_experience_revision',
            'resident_experience_action',
            'resident_experience_contact',
            'resident_experience_benefit',
            'resident_experience_event',
          ]) {
            await assert.rejects(
              () =>
                sql`update ${sql.table(table)} set organization_id = organization_id`.execute(
                  database,
                ),
              /immutable/,
            );
            await assert.rejects(
              () => sql`delete from ${sql.table(table)}`.execute(database),
              /immutable/,
            );
            await assert.rejects(() =>
              sql`truncate ${sql.table(table)} cascade`.execute(database),
            );
          }
          await assert.rejects(
            () =>
              database
                .insertInto('resident_experience_benefit')
                .values({
                  organization_id: org,
                  revision_id: savedId,
                  logical_id: 'late',
                  enabled: true,
                  display_order: 50,
                  icon_key: 'residents',
                  title: 'Late',
                  description: 'Late',
                })
                .execute(),
            /closed/,
          );
          await assert.rejects(
            () =>
              database.transaction().execute((trx) =>
                repository.insertRevision(
                  trx,
                  {
                    organizationId: org,
                    actorId: primary.access.staffIdentityId,
                    revisionId: randomUUID(),
                    resourceRevision: 5,
                  },
                  residentFixture(),
                ),
              ),
            /save evidence/,
          );
        },
      );
      await t.test(
        'event failure rolls back revision, children and pointer together',
        async () => {
          const before = await residentRows();
          await sql`create function reject_resident_event_test() returns trigger language plpgsql as $$ begin raise exception 'injected event failure'; end $$; create trigger reject_resident_event_test before insert on resident_experience_event for each row execute function reject_resident_event_test()`.execute(
            database,
          );
          try {
            await assert.rejects(
              () =>
                primary.service.saveDraft(
                  primary.access,
                  { expectedRevision: 4, snapshot: phoneFixture() },
                  randomUUID(),
                ),
              /injected event failure/,
            );
            assert.deepEqual(await residentRows(), before);
          } finally {
            await sql`drop trigger reject_resident_event_test on resident_experience_event; drop function reject_resident_event_test()`.execute(
              database,
            );
          }
        },
      );
      await t.test(
        'retained history blocks migration rollback without data loss',
        async () => {
          const before = await residentRows();
          await assert.rejects(
            () => database.transaction().execute(down),
            /Retained resident experience history/,
          );
          assert.deepEqual(await residentRows(), before);
          assert.deepEqual(
            await repository.getRevision(org, savedId),
            phoneFixture(),
          );
        },
      );
      await t.test(
        'Slice 2: unpublished drafts and latest revisions are never public',
        async () => {
          assert.equal(await repository.getPublished(org), null);
          assert.equal(
            await repository.getPublished(other.access.organizationId),
            null,
          );
          await assert.rejects(
            () => repository.getPublished(randomUUID()),
            /Not Found/,
          );
        },
      );
      // Test-only publication setup in this unique disposable schema. No runtime
      // publisher, session replication bypass or migration changes are introduced.
      async function publishFixture(revisionId: string) {
        await database.transaction().execute(async (trx) => {
          await sql`alter table organization_resident_experience disable trigger resident_resource_audited`.execute(
            trx,
          );
          await trx
            .updateTable('organization_resident_experience')
            .set({
              published_revision_id: revisionId,
              revision: sql`revision + 1`,
            })
            .where('organization_id', '=', org)
            .execute();
          await sql`alter table organization_resident_experience enable trigger resident_resource_audited`.execute(
            trx,
          );
        });
      }
      await t.test(
        'Slice 2: published snapshot stays separate from newer current draft and other tenants',
        async () => {
          await publishFixture(savedId);
          assert.deepEqual(await repository.getPublished(org), phoneFixture());
          assert.equal(
            await repository.getPublished(other.access.organizationId),
            null,
          );
          const resource = await repository.getResource(org);
          assert.notEqual(resource?.draft_revision_id, savedId);
          assert.ok(resource);
          await assert.rejects(
            () =>
              database
                .updateTable('organization_resident_experience')
                .set({
                  published_revision_id: savedId,
                  revision: 2,
                })
                .where('organization_id', '=', other.access.organizationId)
                .execute(),
            { code: '23503' },
          );
          await assert.rejects(
            () =>
              database
                .updateTable('organization_resident_experience')
                .set({
                  published_revision_id: resource.draft_revision_id,
                  revision: resource.revision + 1,
                })
                .where('organization_id', '=', org)
                .execute(),
            /publication is not implemented/,
          );
        },
      );
      await t.test(
        'Slice 2: read pins one published snapshot while a later fixture publication commits',
        async () => {
          const resource = await repository.getResource(org);
          assert.ok(resource?.draft_revision_id);
          const original = repository.loadRevision.bind(repository);
          await sql`alter table organization_resident_experience disable trigger resident_resource_audited`.execute(
            database,
          );
          repository.loadRevision = async (trx, organizationId, revisionId) => {
            await database
              .updateTable('organization_resident_experience')
              .set({
                published_revision_id: resource.draft_revision_id,
                revision: sql`revision + 1`,
              })
              .where('organization_id', '=', org)
              .execute();
            return original(trx, organizationId, revisionId);
          };
          try {
            assert.deepEqual(
              await repository.getPublished(org),
              phoneFixture(),
            );
          } finally {
            repository.loadRevision = original;
            await sql`alter table organization_resident_experience enable trigger resident_resource_audited`.execute(
              database,
            );
          }
          assert.notDeepEqual(
            await repository.getPublished(org),
            phoneFixture(),
          );
          await publishFixture(savedId);
        },
      );
      for (const assetKey of ['unknown', null]) {
        await t.test(
          `Slice 2: malformed stored publication asset ${assetKey ?? 'missing'} fails closed`,
          async () => {
            const presentation = structuredClone(phoneFixture().presentation);
            if (assetKey === null)
              Reflect.deleteProperty(presentation.hero, 'assetKey');
            else presentation.hero.assetKey = assetKey;
            async function setPresentation(value: typeof presentation) {
              await database.transaction().execute(async (trx) => {
                await sql`alter table resident_experience_revision disable trigger resident_revision_immutable`.execute(
                  trx,
                );
                await sql`update resident_experience_revision set presentation = ${JSON.stringify(value)}::jsonb where organization_id = ${org} and id = ${savedId}`.execute(
                  trx,
                );
                await sql`alter table resident_experience_revision enable trigger resident_revision_immutable`.execute(
                  trx,
                );
              });
            }
            try {
              await setPresentation(presentation);
              await assert.rejects(
                () => repository.getPublished(org),
                /Invalid resident/,
              );
            } finally {
              await setPresentation(phoneFixture().presentation);
            }
          },
        );
      }
      await t.test(
        'Slice 2: inactive Organization cannot disclose a published snapshot',
        async () => {
          await database
            .updateTable('organization')
            .set({ status: 'inactive' })
            .where('id', '=', org)
            .execute();
          await assert.rejects(() => repository.getPublished(org), /Not Found/);
          await database
            .updateTable('organization')
            .set({ status: 'active' })
            .where('id', '=', org)
            .execute();
        },
      );
    } finally {
      await db?.destroy();
      if (schemaCreated)
        await admin.query(`drop schema if exists "${schema}" cascade`);
      await admin.end();
    }
  },
);
