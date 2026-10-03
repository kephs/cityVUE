import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { ForbiddenException, ConflictException } from '@nestjs/common';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';
import { ResidentExperienceRepository } from '../../src/resident-experience/resident-experience.repository.js';
import { AdminResidentExperienceService } from '../../src/resident-experience/resident-experience.admin.service.js';
import {
  up,
  down,
  residentPermissionKeys,
} from '../../migrations/20261012000000-register-resident-experience-permissions.js';
import { prepareDatabaseExtensions } from '../helpers/database-extensions.js';
import { phoneFixture } from '../helpers/resident-experience.fixture.js';
import { manageablePermissions } from '../../src/access/access-policy.js';
import { managedPermissionKeys } from '../../migrations/20261008000000-add-administrative-access-foundation.js';

test(
  'F059.2 Slice 3 disposable migration and admin behavior',
  { skip: !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL missing' },
  async (t) => {
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const schema = `resident_admin_${randomUUID().replaceAll('-', '')}`;
    let db: Kysely<DatabaseSchema> | undefined;
    let created = false;
    try {
      assert.deepEqual(
        (
          await admin.query(
            'select current_database() as database, current_user as role',
          )
        ).rows,
        [{ database: 'reqro_f0592_test', role: 'reqro_test_user' }],
      );
      await prepareDatabaseExtensions(admin);
      await admin.query(`create schema "${schema}"`);
      created = true;
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
      for (const file of (await readdir(folder))
        .filter((f) => f.endsWith('.js') && f < '20261012000000')
        .sort()) {
        const migration = (await import(
          pathToFileURL(path.join(folder, file)).href
        )) as { up: (db: Kysely<DatabaseSchema>) => Promise<void> };
        await database.transaction().execute(migration.up);
      }
      // Nonempty pre-existing grant fixture makes preservation checks meaningful.
      const existingOrg = randomUUID(),
        existingRole = randomUUID();
      await database
        .insertInto('organization')
        .values({
          id: existingOrg,
          name: 'Existing synthetic',
          short_name: 'Existing',
          slug: existingOrg,
          status: 'active',
          default_business_timezone: 'UTC',
        })
        .execute();
      await database
        .insertInto('role')
        .values({
          id: existingRole,
          organization_id: existingOrg,
          name: 'Existing synthetic role',
          active: true,
          description: null,
        })
        .execute();
      await database
        .insertInto('role_permission')
        .values({
          organization_id: existingOrg,
          role_id: existingRole,
          permission_key: 'admin.configuration.read',
        })
        .execute();
      const oldRoles = await database
        .selectFrom('role')
        .selectAll()
        .orderBy('id')
        .execute();
      const oldPermissions = await database
        .selectFrom('permission')
        .selectAll()
        .orderBy('permission_key')
        .execute();
      const oldGrants = await database
        .selectFrom('role_permission')
        .selectAll()
        .execute();
      await t.test(
        '42 registers exactly three keys, no grants; rollback and reapply preserve existing state/delegation',
        async () => {
          await database.transaction().execute(up);
          const added = await database
            .selectFrom('permission')
            .select('permission_key')
            .where('permission_key', 'in', residentPermissionKeys)
            .orderBy('permission_key')
            .execute();
          assert.deepEqual(
            added.map((r) => r.permission_key),
            [...residentPermissionKeys].sort(),
          );
          assert.equal(
            (await database.selectFrom('permission').selectAll().execute())
              .length,
            oldPermissions.length + 3,
          );
          assert.deepEqual(
            await database.selectFrom('role_permission').selectAll().execute(),
            oldGrants,
          );
          assert.deepEqual(
            await database
              .selectFrom('role')
              .selectAll()
              .orderBy('id')
              .execute(),
            oldRoles,
          );
          assert.deepEqual(
            [...managedPermissionKeys].sort(),
            manageablePermissions,
          );
          await database.transaction().execute(down);
          assert.deepEqual(
            await database
              .selectFrom('permission')
              .selectAll()
              .orderBy('permission_key')
              .execute(),
            oldPermissions,
          );
          assert.deepEqual(
            await database.selectFrom('role_permission').selectAll().execute(),
            oldGrants,
          );
          await database.transaction().execute(up);
        },
      );
      const organizationId = randomUUID(),
        staffIdentityId = randomUUID(),
        tenantId = randomUUID(),
        objectId = randomUUID(),
        roleId = randomUUID();
      await database
        .insertInto('organization')
        .values({
          id: organizationId,
          name: 'Synthetic',
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
          display_name: 'Synthetic',
          active: true,
          email: null,
          entra_tenant_id: tenantId,
          entra_object_id: objectId,
        })
        .execute();
      await database
        .insertInto('role')
        .values({
          id: roleId,
          organization_id: organizationId,
          name: 'Synthetic test only',
          active: true,
          description: null,
        })
        .execute();
      await database
        .insertInto('staff_role_assignment')
        .values({
          organization_id: organizationId,
          staff_identity_id: staffIdentityId,
          role_id: roleId,
          active: true,
        })
        .execute();
      const access: StaffAccess = {
        organizationId,
        staffIdentityId,
        tenantId,
        objectId,
        displayName: 'Synthetic',
        development: false,
        scopes: [],
        departmentIds: [],
        divisionIds: [],
        permissions: [
          'admin.configuration.read',
          'resident_experience.write',
          'resident_experience.contact.manage',
        ],
      };
      const repository = new ResidentExperienceRepository(database),
        service = new AdminResidentExperienceService(repository);
      const grant = async (permission_key: string) => {
        await database
          .insertInto('role_permission')
          .values({
            organization_id: organizationId,
            role_id: roleId,
            permission_key,
          })
          .execute();
      };
      await t.test(
        'fresh database authority rejects ungranted/stale claimed permissions and foreign identity',
        async () => {
          await assert.rejects(service.summary(access), ForbiddenException);
          await grant('admin.configuration.read');
          await assert.rejects(
            service.summary({ ...access, staffIdentityId: randomUUID() }),
            ForbiddenException,
          );
          await assert.rejects(
            service.save(
              access,
              { expectedRevision: 1, snapshot: phoneFixture() },
              randomUUID(),
            ),
            ForbiddenException,
          );
          await grant('resident_experience.write');
          await assert.rejects(
            service.save(
              access,
              { expectedRevision: 1, snapshot: phoneFixture() },
              randomUUID(),
            ),
            ForbiddenException,
          );
          await grant('resident_experience.contact.manage');
        },
      );
      let snapshot = phoneFixture();
      await t.test(
        'complete draft, no-op, preview and no-publication isolation',
        async () => {
          assert.deepEqual(
            await service.save(
              access,
              { expectedRevision: 1, snapshot },
              randomUUID(),
            ),
            { revision: 2, changed: true },
          );
          assert.deepEqual(
            await service.save(
              access,
              { expectedRevision: 2, snapshot },
              randomUUID(),
            ),
            { revision: 2, changed: false },
          );
          assert.equal(await repository.getPublished(organizationId), null);
          const preview = await service.preview(access);
          assert.equal(preview.revision, 2);
          assert.equal(
            preview.presentation.configuration?.actions[1]?.ctaLabel,
            'Call +1 (202) 555-0100',
          );
          assert.doesNotMatch(
            JSON.stringify(preview.presentation),
            /draftRevisionId|actor|organization_id|contacts|event/,
          );
          await assert.rejects(
            service.save(
              access,
              { expectedRevision: 1, snapshot },
              randomUUID(),
            ),
            ConflictException,
          );
          await assert.rejects(
            service.save(
              access,
              { expectedRevision: 2, snapshot, organizationId: randomUUID() },
              randomUUID(),
            ),
          );
        },
      );
      const prior = await repository.getResource(organizationId);
      assert.ok(prior?.draft_revision_id);
      const priorId = prior.draft_revision_id;
      await t.test(
        'ordinary copy save succeeds without contact authority; old revision is immutable and public stays unpublished',
        async () => {
          await database
            .deleteFrom('role_permission')
            .where('role_id', '=', roleId)
            .where('permission_key', '=', 'resident_experience.contact.manage')
            .execute();
          snapshot = structuredClone(snapshot);
          snapshot.presentation.branding.applicationName = 'Updated draft';
          await service.save(
            access,
            { expectedRevision: 2, snapshot },
            randomUUID(),
          );
          assert.equal(
            (await repository.getRevision(organizationId, priorId)).presentation
              .branding.applicationName,
            'Synthetic Community',
          );
          assert.equal(
            (await service.preview(access)).presentation.configuration
              ?.presentation.branding.applicationName,
            'Updated draft',
          );
          assert.equal(await repository.getPublished(organizationId), null);
          const consequential = structuredClone(snapshot);
          assert.ok(consequential.contacts[0]);
          consequential.contacts[0].guidance = 'Changed guidance';
          await assert.rejects(
            service.save(
              access,
              { expectedRevision: 3, snapshot: consequential },
              randomUUID(),
            ),
            ForbiddenException,
          );
        },
      );
      await t.test(
        'audit failure rolls back and write revocation is authoritative',
        async () => {
          await sql`create function reject_resident_test_event() returns trigger language plpgsql as $$ begin raise exception 'synthetic audit failure'; end $$`.execute(
            database,
          );
          await sql`create trigger reject_resident_test_event before insert on resident_experience_event for each row execute function reject_resident_test_event()`.execute(
            database,
          );
          snapshot.presentation.metadata.title = 'Unsaved';
          await assert.rejects(
            service.save(
              access,
              { expectedRevision: 3, snapshot },
              randomUUID(),
            ),
          );
          assert.equal((await service.summary(access)).revision, 3);
          await sql`drop trigger reject_resident_test_event on resident_experience_event`.execute(
            database,
          );
          await database
            .deleteFrom('role_permission')
            .where('role_id', '=', roleId)
            .where('permission_key', '=', 'resident_experience.write')
            .execute();
          await assert.rejects(
            service.save(
              access,
              { expectedRevision: 3, snapshot },
              randomUUID(),
            ),
            ForbiddenException,
          );
        },
      );
      await t.test(
        '42 rollback refuses future grants without deleting anything',
        async () => {
          await grant('resident_experience.publish');
          await assert.rejects(
            database.transaction().execute(down),
            /Retained/,
          );
          assert.equal(
            (
              await database
                .selectFrom('permission')
                .selectAll()
                .where('permission_key', 'in', residentPermissionKeys)
                .execute()
            ).length,
            3,
          );
        },
      );
      await t.test(
        'draft writes never move publication; concurrent saves conflict; revoked reads fail',
        async () => {
          await grant('resident_experience.write');
          await database.transaction().execute(async (trx) => {
            await sql`alter table organization_resident_experience disable trigger resident_resource_audited`.execute(
              trx,
            );
            await trx
              .updateTable('organization_resident_experience')
              .set({
                published_revision_id: priorId,
                revision: sql`revision + 1`,
              })
              .where('organization_id', '=', organizationId)
              .execute();
            await sql`alter table organization_resident_experience enable trigger resident_resource_audited`.execute(
              trx,
            );
          });
          const publication = await repository.getPublished(organizationId);
          snapshot.presentation.branding.applicationName = 'Latest saved draft';
          await service.save(
            access,
            { expectedRevision: 4, snapshot },
            randomUUID(),
          );
          assert.deepEqual(
            await repository.getPublished(organizationId),
            publication,
          );
          assert.equal(
            (await service.preview(access)).presentation.configuration
              ?.presentation.branding.applicationName,
            'Latest saved draft',
          );
          snapshot.presentation.metadata.title = 'Concurrent draft';
          const saves = await Promise.allSettled([
            service.save(
              access,
              { expectedRevision: 5, snapshot },
              randomUUID(),
            ),
            service.save(
              access,
              { expectedRevision: 5, snapshot },
              randomUUID(),
            ),
          ]);
          assert.equal(saves.filter((s) => s.status === 'fulfilled').length, 1);
          const rejected = saves.find((s) => s.status === 'rejected');
          assert.ok(
            rejected?.status === 'rejected' &&
              rejected.reason instanceof ConflictException,
          );
          await database
            .deleteFrom('role_permission')
            .where('role_id', '=', roleId)
            .where('permission_key', '=', 'admin.configuration.read')
            .execute();
          await assert.rejects(service.preview(access), ForbiddenException);
          assert.deepEqual(
            await repository.getPublished(organizationId),
            publication,
          );
        },
      );
    } finally {
      await db?.destroy();
      if (created) await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  },
);
